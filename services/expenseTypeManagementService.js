'use strict';

const ExpenseTypeDefinition = require('../models/expenseTypeDefinition');

const expenseTypeValidation = require('./expenseTypeValidation');
const { requireExpenseTypeManagementEnabled } = require('../utils/rollout');
const { validateIdentifier } = require('../utils/transactionValidators');
const { TRANSACTION_TYPES } = require('../utils/constants');
const {
    AuthenticationError,
    AuthorizationError,
    DomainValidationError,
    PocketValidationError,
    PocketNameConflictError,
    PocketLifecycleConflictError,
    VersionConflictError,
    RecordNotFoundError
} = require('../utils/domainErrors');

/**
 * Expense Type Management service.
 *
 * A deliberately lighter sibling of PocketManagementService: an Expense_Type
 * is an emoji, a name, and an active/archived lifecycle, with no cadence,
 * default amount, or per-Budget_Month assignment step. Every Active type is
 * selectable on any transaction in any month, so there is nothing here that
 * needs a multi-document MongoDB transaction — each mutation is a single
 * compare-and-set write on one document, which Mongo already makes atomic.
 *
 * The generic `PocketValidationError`/`PocketNameConflictError`/etc. domain
 * error classes are reused rather than duplicated: their shape (a field, a
 * code, safe recovery details) has nothing pocket-specific about it, and the
 * error handler's response body never mentions "pocket" — only the field name
 * and code do the talking to the client.
 */

function executeQuery(query) {
    return typeof query?.exec === 'function' ? query.exec() : query;
}

function option(options, actor, name, fallback) {
    return options?.[name] ?? actor?.[name] ?? fallback;
}

function definitionModel(options, actor) {
    return option(options, actor, 'expenseTypeDefinitionModel', ExpenseTypeDefinition);
}

function actorIdFor(actor) {
    const value = actor && typeof actor === 'object'
        ? (actor.userId ?? actor.id ?? actor._id)
        : actor;
    if (value === undefined || value === null) throw new AuthenticationError();
    return validateIdentifier(value, 'by');
}

function requireWife(actor) {
    const actorId = actorIdFor(actor);
    if (actor?.role !== 'Wife') throw new AuthorizationError('Wife');
    return actorId;
}

function normalizeExpectedVersion(value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    throw new DomainValidationError('expectedVersion', 'expectedVersion must be a whole number.');
}

function isDuplicateKeyError(error) {
    return Boolean(error) && (error.code === 11000 || error.codeName === 'DuplicateKey');
}

function mapDuplicateKeyError(error) {
    return isDuplicateKeyError(error) ? new PocketNameConflictError() : error;
}

function definitionDto(doc) {
    return doc.toDTO();
}

function compareStrings(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function byDefinitionOrder(a, b) {
    return compareStrings(a.normalizedName, b.normalizedName) || compareStrings(a.id, b.id);
}

/**
 * Lazily seed the collection with the historical fixed 12 types the first
 * time anyone reads it (cheap no-op on every call after that). This is a
 * read-triggered side effect rather than a boot-time migration script because
 * seeding needs a valid User id for the audit fields, and the first caller —
 * whoever opens the management page or logs an expense first — already has
 * one. A concurrent first read racing this insert is resolved by the
 * `normalizedName` unique index: the loser's duplicate rows are rejected and
 * the caller's subsequent read reflects the single, correctly-seeded set
 * either way.
 */
async function ensureSeeded(Definition, actorId) {
    const count = await executeQuery(Definition.countDocuments({}));
    if (count > 0) return;

    const docs = Object.entries(TRANSACTION_TYPES).map(([name, emoji]) => ({
        name,
        normalizedName: expenseTypeValidation.normalizeTypeName(name).normalizedName,
        emoji,
        status: 'Active',
        createdBy: actorId,
        updatedBy: actorId,
        version: 1
    }));

    try {
        await Definition.insertMany(docs, { ordered: false });
    } catch (error) {
        if (!isDuplicateKeyError(error) && !Array.isArray(error?.writeErrors)) throw error;
    }
}

/**
 * Create an Active expense type. Wife-role only.
 */
async function createExpenseTypeDefinition(command, actor, options = {}) {
    requireExpenseTypeManagementEnabled(options, actor);
    const actorId = requireWife(actor);

    const { value, errors } = expenseTypeValidation.validateDefinitionFields(command || {}, 'create');
    if (errors.length > 0) throw new PocketValidationError(errors);

    const Definition = definitionModel(options, actor);

    try {
        const created = await Definition.create({
            name: value.name,
            normalizedName: value.normalizedName,
            emoji: value.emoji,
            status: 'Active',
            createdBy: actorId,
            updatedBy: actorId,
            version: 1
        });
        return definitionDto(created);
    } catch (error) {
        throw mapDuplicateKeyError(error);
    }
}

/**
 * Return ordered definition collections for an authenticated household
 * member. Active-only by default; an archived-inclusive read returns a
 * disjoint `archived` collection. Both are ordered by normalized name then
 * identifier.
 */
async function listExpenseTypeDefinitions(query = {}, actor, options = {}) {
    requireExpenseTypeManagementEnabled(options, actor);
    const actorId = actorIdFor(actor);

    const includeArchived = query === true
        || query?.includeArchived === true
        || query?.includeArchived === 'true';

    const Definition = definitionModel(options, actor);
    await ensureSeeded(Definition, actorId);
    const docs = await executeQuery(Definition.find({}));
    const dtos = docs.map(definitionDto);

    const active = dtos.filter((dto) => dto.status === 'Active').sort(byDefinitionOrder);
    if (!includeArchived) return { active };

    const archived = dtos.filter((dto) => dto.status === 'Archived').sort(byDefinitionOrder);
    return { active, archived };
}

/**
 * Every Active expense type's normalized name, for TransactionService's
 * transaction-time existence check. Deliberately does not gate on the
 * rollout flag or actor role itself: TransactionService only calls this when
 * it has already decided (via `isExpenseTypeManagementEnabled`) to enforce
 * the check, and the check runs for any authenticated household member, not
 * just Wife.
 */
async function listActiveTypeNormalizedNames(actor, options = {}) {
    const Definition = definitionModel(options, actor);
    await ensureSeeded(Definition, actorIdFor(actor));
    const docs = await executeQuery(Definition.find({ status: 'Active' }, { normalizedName: 1 }));
    return new Set((docs || []).map((doc) => doc.normalizedName));
}

/**
 * Partially update an Active expense type. Only supplied mutable fields may
 * change; omitted fields are preserved. A canonically equivalent request is a
 * no-op that preserves version, updater, and timestamp. A changed request uses
 * a compare-and-set on `_id` + version and increments version by exactly one.
 */
async function updateExpenseTypeDefinition(typeId, command, actor, options = {}) {
    requireExpenseTypeManagementEnabled(options, actor);
    const actorId = requireWife(actor);
    const id = validateIdentifier(typeId, 'typeId');

    const { value, errors } = expenseTypeValidation.validateDefinitionFields(command || {}, 'update');
    if (errors.length > 0) throw new PocketValidationError(errors);
    const expectedVersion = normalizeExpectedVersion(command?.expectedVersion ?? command?.version);

    const Definition = definitionModel(options, actor);

    const existing = await executeQuery(Definition.findById(id));
    if (!existing) throw new RecordNotFoundError('expense type');
    if (existing.status === 'Archived') {
        throw new PocketLifecycleConflictError('POCKET_ARCHIVED_CONFLICT', { typeId: id });
    }
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new VersionConflictError(existing.version, { typeId: id });
    }

    const patch = {};
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(value, 'name')
        && (existing.name !== value.name || existing.normalizedName !== value.normalizedName)) {
        patch.name = value.name;
        patch.normalizedName = value.normalizedName;
        changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'emoji') && existing.emoji !== value.emoji) {
        patch.emoji = value.emoji;
        changed = true;
    }

    if (!changed) return definitionDto(existing);

    let updated;
    try {
        updated = await executeQuery(Definition.findOneAndUpdate(
            { _id: id, version: existing.version },
            { $set: { ...patch, updatedBy: actorId }, $inc: { version: 1 } },
            { new: true, runValidators: true }
        ));
    } catch (error) {
        throw mapDuplicateKeyError(error);
    }
    if (!updated) throw new VersionConflictError(existing.version, { typeId: id });
    return definitionDto(updated);
}

/**
 * Shared compare-and-set lifecycle transition used by archive and restore.
 */
async function transitionLifecycle(typeId, command, actor, options, {
    fromStatus,
    toStatus,
    alreadyInStateCode
}) {
    requireExpenseTypeManagementEnabled(options, actor);
    const actorId = requireWife(actor);
    const id = validateIdentifier(typeId, 'typeId');
    const expectedVersion = normalizeExpectedVersion(command?.expectedVersion ?? command?.version);

    const Definition = definitionModel(options, actor);

    const existing = await executeQuery(Definition.findById(id));
    if (!existing) throw new RecordNotFoundError('expense type');
    if (existing.status !== fromStatus) {
        throw new PocketLifecycleConflictError(alreadyInStateCode, { typeId: id });
    }
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new VersionConflictError(existing.version, { typeId: id });
    }

    const updated = await executeQuery(Definition.findOneAndUpdate(
        { _id: id, version: existing.version, status: fromStatus },
        { $set: { status: toStatus, updatedBy: actorId }, $inc: { version: 1 } },
        { new: true, runValidators: true }
    ));
    if (!updated) throw new VersionConflictError(existing.version, { typeId: id });
    return definitionDto(updated);
}

/**
 * Archive an Active expense type. Unlike archiving a pocket (which can strand
 * assigned Budget_Month spending), archiving a type never orphans anything —
 * past transactions keep their stored type name regardless — so no explicit
 * confirmation flag is required here.
 */
function archiveExpenseTypeDefinition(typeId, command, actor, options = {}) {
    return transitionLifecycle(typeId, command, actor, options, {
        fromStatus: 'Active',
        toStatus: 'Archived',
        alreadyInStateCode: 'POCKET_ARCHIVED_CONFLICT'
    });
}

/**
 * Restore an Archived expense type to Active, making it selectable again.
 */
function restoreExpenseTypeDefinition(typeId, command, actor, options = {}) {
    return transitionLifecycle(typeId, command, actor, options, {
        fromStatus: 'Archived',
        toStatus: 'Active',
        alreadyInStateCode: 'POCKET_ACTIVE_CONFLICT'
    });
}

function createExpenseTypeManagementService(defaultOptions = {}) {
    const merge = (options) => ({ ...defaultOptions, ...options });
    return {
        createExpenseTypeDefinition: (command, actor, options) =>
            createExpenseTypeDefinition(command, actor, merge(options)),
        listExpenseTypeDefinitions: (query, actor, options) =>
            listExpenseTypeDefinitions(query, actor, merge(options)),
        listActiveTypeNormalizedNames: (actor, options) =>
            listActiveTypeNormalizedNames(actor, merge(options)),
        updateExpenseTypeDefinition: (typeId, command, actor, options) =>
            updateExpenseTypeDefinition(typeId, command, actor, merge(options)),
        archiveExpenseTypeDefinition: (typeId, command, actor, options) =>
            archiveExpenseTypeDefinition(typeId, command, actor, merge(options)),
        restoreExpenseTypeDefinition: (typeId, command, actor, options) =>
            restoreExpenseTypeDefinition(typeId, command, actor, merge(options))
    };
}

module.exports = {
    createExpenseTypeDefinition,
    listExpenseTypeDefinitions,
    listActiveTypeNormalizedNames,
    updateExpenseTypeDefinition,
    archiveExpenseTypeDefinition,
    restoreExpenseTypeDefinition,
    createExpenseTypeManagementService
};
