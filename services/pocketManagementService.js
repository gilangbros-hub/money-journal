'use strict';

const mongoose = require('mongoose');

const PocketDefinition = require('../models/pocketDefinition');
const PocketAssignment = require('../models/pocketAssignment');
const Transaction = require('../models/transaction');
const ClosedMonth = require('../models/closedMonth');

const pocketValidation = require('./pocketValidation');
const { planAssignments, deriveIntersectingWeeks } = require('./pocketAssignmentPlanner');
const { withOpenBudgetPeriods } = require('./budgetPeriodGuard');
const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    getActiveBudgetMonth,
    parseBudgetMonth,
    resolveBudgetMonth
} = require('./salaryCycleResolver');
const { requirePocketManagementEnabled } = require('../utils/rollout');
const { isDualReadActive, resolveTracker } = require('./pocketCompatibility');
const { pocketDefinitionId } = require('./migrationTransformService');
const { POCKETS } = require('../utils/constants');
const { validateIdentifier } = require('../utils/transactionValidators');
const {
    AuthenticationError,
    AuthorizationError,
    DomainValidationError,
    PocketValidationError,
    PocketNameConflictError,
    VersionConflictError,
    PocketLifecycleConflictError,
    ConfirmationRequiredError,
    PocketAssignmentConflictError,
    RecordNotFoundError,
    EditableWindowError
} = require('../utils/domainErrors');

/**
 * Pocket Management aggregate service.
 *
 * This is the transactional facade that turns validated commands into durable
 * Pocket_Definition and Pocket_Assignment state. It follows the same
 * dependency-injected factory convention as `createBudgetService` and
 * `createTransactionService`: models, the MongoDB connection, the household
 * time zone, the current instant, and the rollout flag are all supplied through
 * the actor/options pair so the service stays testable against injected doubles
 * and a replica-set fixture.
 *
 * Responsibilities that live here (and only here):
 *  - authentication and Wife-role defense in depth (the routes enforce the same
 *    rules first; the service never trusts that they did);
 *  - the disabled-by-default `POCKET_MANAGEMENT_ENABLED` gate, so managed reads
 *    and writes are unavailable while the primary flag is false;
 *  - compare-and-set optimistic versioning, canonical no-op detection, and the
 *    active/archived lifecycle rules;
 *  - deterministic normalized-name/identifier ordering of every collection;
 *  - `withOpenBudgetPeriods` fencing of every Budget_Month mutation inside a
 *    MongoDB transaction, with bounded retries for transient database conflicts
 *    and concurrent-create reconciliation;
 *  - atomic Assignment_Setup confirmation that validates the complete batch
 *    before any write, reconciles inserts/updates/no-ops together, preserves
 *    omitted assignments, and returns a fresh complete monthly result plus the
 *    combined allocation total only after commit.
 *
 * Pure canonicalization, emoji/name/amount validation, and salary-cycle-aware
 * allocation planning are delegated to `pocketValidation` and
 * `pocketAssignmentPlanner`; this module owns persistence, sessions, and policy.
 */

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

// ---------------------------------------------------------------------------
// Query plumbing (mirrors the existing budget/transaction service helpers so
// injected native-array or mock query doubles behave the same everywhere).
// ---------------------------------------------------------------------------

function executeQuery(query) {
    return typeof query?.exec === 'function' ? query.exec() : query;
}

function withSession(query, session) {
    return typeof query?.session === 'function' ? query.session(session) : query;
}

function option(options, actor, name, fallback) {
    return options?.[name] ?? actor?.[name] ?? fallback;
}

function definitionModel(options, actor) {
    return option(options, actor, 'definitionModel', PocketDefinition);
}

function assignmentModel(options, actor) {
    return option(options, actor, 'assignmentModel', PocketAssignment);
}

function transactionModel(options, actor) {
    return option(options, actor, 'transactionModel', Transaction);
}

function guardModel(options, actor) {
    return option(options, actor, 'guardModel', ClosedMonth);
}

async function findMany(model, filter, { session } = {}) {
    const query = withSession(model.find(filter), session);
    return executeQuery(query);
}

async function findOne(model, filter, { session, lean = false } = {}) {
    let query = withSession(model.findOne(filter), session);
    if (lean && typeof query?.lean === 'function') query = query.lean();
    return executeQuery(query);
}

async function findById(model, id, { session } = {}) {
    const query = withSession(model.findById(id), session);
    return executeQuery(query);
}

// ---------------------------------------------------------------------------
// Authentication / authorization
// ---------------------------------------------------------------------------

function actorIdFor(actor) {
    const value = actor && typeof actor === 'object'
        ? (actor.userId ?? actor.id ?? actor._id)
        : actor;
    if (value === undefined || value === null) throw new AuthenticationError();
    return validateIdentifier(value, 'by');
}

/**
 * Authenticate and require the Wife role. Authentication is checked first so an
 * unauthenticated caller receives an authentication error rather than a
 * role-specific one that could confirm the feature exists.
 */
function requireWife(actor) {
    const actorId = actorIdFor(actor);
    if (actor?.role !== 'Wife') throw new AuthorizationError('Wife');
    return actorId;
}

// ---------------------------------------------------------------------------
// Month / version normalization and the editable-window policy
// ---------------------------------------------------------------------------

function normalizeMonth(value, field = 'budgetMonth') {
    if (value && typeof value === 'object') {
        if (typeof value.key === 'string') return parseBudgetMonth(value.key);
        if (Number.isInteger(value.year) && Number.isInteger(value.month)) {
            return parseBudgetMonth(
                `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}`
            );
        }
    }
    if (typeof value === 'string') return parseBudgetMonth(value);
    throw new DomainValidationError(field, `${field} must use the YYYY-MM format.`);
}

function normalizeExpectedVersion(value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    throw new DomainValidationError('expectedVersion', 'expectedVersion must be a whole number.');
}

function editableMonths(active) {
    const nextYear = active.month === 12 ? active.year + 1 : active.year;
    const nextMonth = active.month === 12 ? 1 : active.month + 1;
    return [
        active.key,
        `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`
    ];
}

function resolveActiveMonth(actor, options) {
    return getActiveBudgetMonth({
        nowInstant: option(options, actor, 'nowInstant', new Date().toISOString()),
        timeZone: option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE)
    });
}

/**
 * The Editable_Window is the active Budget_Month and its immediate successor.
 * A mutation outside that window is rejected before (and again inside) the
 * transaction.
 */
function assertEditableWindow(month, actor, options) {
    const active = resolveActiveMonth(actor, options);
    const allowed = editableMonths(active);
    if (!allowed.includes(month.key)) {
        throw new EditableWindowError(month.key, active.key, allowed);
    }
    return active;
}

// ---------------------------------------------------------------------------
// Transactions, retries, and duplicate-key mapping
// ---------------------------------------------------------------------------

function isDuplicateKeyError(error) {
    return Boolean(error) && (error.code === 11000 || error.codeName === 'DuplicateKey');
}

function isTransientTransactionError(error) {
    const labels = error?.errorLabels;
    const hasTransientLabel = Array.isArray(labels) && labels.includes('TransientTransactionError');
    return hasTransientLabel
        || error?.code === 112
        || error?.codeName === 'WriteConflict'
        || error?.code === 'ALLOCATION_WRITE_CONFLICT';
}

/**
 * Identify which unique index produced a duplicate-key error so it can be
 * mapped to the correct typed domain error. The raw key value is never echoed
 * back to the client.
 */
function duplicateKeyFields(error) {
    if (error && error.keyPattern && typeof error.keyPattern === 'object') {
        return Object.keys(error.keyPattern);
    }
    if (error && typeof error.message === 'string') {
        if (/normalizedName/.test(error.message)) return ['normalizedName'];
        if (/pocketId/.test(error.message)) return ['pocketId'];
    }
    return [];
}

function mapDuplicateKeyError(error) {
    if (!isDuplicateKeyError(error)) return error;
    const fields = duplicateKeyFields(error);
    if (fields.includes('normalizedName')) return new PocketNameConflictError();
    if (fields.includes('pocketId')) {
        return new PocketAssignmentConflictError('POCKET_ASSIGNMENT_CONFLICT');
    }
    return error;
}

/**
 * Run an operation inside a MongoDB transaction with bounded retries.
 *
 * Only transient database conflicts (and, when the caller opts in via
 * `retryOn`, a duplicate-create race that needs reconciliation) are retried
 * with a fresh session. Business conflicts — version, lifecycle, validation,
 * authorization — are deterministic and are never auto-retried. When a session
 * is already supplied the operation joins it without opening a new transaction.
 */
async function runInTransaction(operation, {
    connection = mongoose.connection,
    session,
    retries = 3,
    retryOn = isTransientTransactionError,
    retryTracker
} = {}) {
    if (session) return operation(session);
    if (!connection || typeof connection.startSession !== 'function') {
        throw new Error('A MongoDB connection with startSession is required.');
    }

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const ownedSession = await connection.startSession();
        try {
            let result;
            await ownedSession.withTransaction(async () => {
                result = await operation(ownedSession);
            });
            return result;
        } catch (error) {
            // Business conflicts — version, lifecycle, validation, authorization
            // — are deterministic and never auto-retried. Only transient
            // database conflicts (and, when opted in, a duplicate-create race)
            // reach here as retryable, and the retry count is bounded.
            if (attempt >= retries || !retryOn(error)) throw error;
            attempt += 1;
            if (retryTracker && typeof retryTracker === 'object') {
                retryTracker.count = attempt;
            }
        } finally {
            await ownedSession.endSession();
        }
    }
}

function transactionContext(options, actor, extra = {}) {
    return {
        connection: option(options, actor, 'connection', mongoose.connection),
        session: options?.session,
        ...extra
    };
}

// ---------------------------------------------------------------------------
// Structured safe-operation observability events
// ---------------------------------------------------------------------------
//
// Every managed mutation reports a structured event through an optional,
// dependency-injected sink (mirroring the transaction service's best-effort
// `notificationQueue`). Events are the correlation companion to the request ID
// and carry only recovery-safe metadata: the operation name, the outcome, the
// authorized actor ID, the affected pocket ID and/or Budget Month, a mapped
// error code, the transaction duration, the bounded retry count, and the number
// of records actually changed. They intentionally never carry pocket names,
// emoji, amounts, allocations, expense notes, request bodies, session contents,
// or stack traces, matching the sanitized safe-detail conventions used by the
// typed domain errors and the HTTP error adapter.
//
// A success event is delivered only after the transaction commits; a no-op
// reports `changedRecordCount: 0`; a failure reports the mapped error code.
// Delivery is best effort — the financial write has already committed (or
// already failed) by the time an event is emitted, so a sink outage must never
// alter persisted state or the caller's result.

function operationEventSink(options, actor) {
    return option(options, actor, 'operationEvents', null)
        ?? option(options, actor, 'safeOperationEvents', null);
}

async function deliverOperationEvent(sink, event) {
    if (!sink) return;
    try {
        if (typeof sink === 'function') {
            await sink(event);
        } else if (typeof sink.enqueue === 'function') {
            await sink.enqueue(event);
        } else if (typeof sink.record === 'function') {
            await sink.record(event);
        } else if (typeof sink.notify === 'function') {
            await sink.notify(event);
        } else if (typeof sink.send === 'function') {
            await sink.send(event);
        }
    } catch {
        // Observability is deliberately best effort and cannot roll back a
        // committed financial operation. A sink failure is swallowed here so
        // it stays separately observable without affecting the result.
    }
}

/**
 * Build a client-safe structured operation event. Only allowlisted, non-sensitive
 * fields are ever attached; every value that could disclose financial data,
 * unauthorized record contents, or process internals is excluded by construction.
 */
function buildOperationEvent(operation, outcome, frame, startedAt) {
    const event = { operation, outcome };
    if (frame.actorId !== undefined && frame.actorId !== null) {
        event.actorId = String(frame.actorId);
    }
    if (frame.pocketId !== undefined && frame.pocketId !== null) {
        event.pocketId = String(frame.pocketId);
    }
    if (frame.budgetMonth) event.budgetMonth = frame.budgetMonth;
    if (outcome === 'error' && typeof frame.errorCode === 'string' && frame.errorCode) {
        event.errorCode = frame.errorCode;
    }
    if (Number.isFinite(frame.retryTracker?.count)) event.retryCount = frame.retryTracker.count;
    if (outcome === 'success' && Number.isFinite(frame.changedRecordCount)) {
        event.changedRecordCount = frame.changedRecordCount;
    }
    const elapsed = Date.now() - startedAt;
    if (Number.isFinite(elapsed) && elapsed >= 0) event.durationMs = elapsed;
    return event;
}

/**
 * Run one managed mutation with structured safe-operation observability.
 *
 * The `body` receives a mutable `frame` it fills in as it learns safe context
 * (`actorId` after authorization, `pocketId`/`budgetMonth` once known, and
 * `changedRecordCount` once the transaction has classified its writes). The
 * shared `frame.retryTracker` is threaded into the transaction context so the
 * bounded retry count is observable.
 *
 * Duplicate-key database errors are mapped to their typed domain error here so
 * the emitted error code and the error thrown to the caller are identical, and
 * so no raw index/key value ever reaches an event or the client.
 */
async function observeMutation(operation, options, actor, body) {
    const sink = operationEventSink(options, actor);
    const frame = { retryTracker: { count: 0 } };
    const startedAt = Date.now();
    try {
        const result = await body(frame);
        await deliverOperationEvent(sink, buildOperationEvent(operation, 'success', frame, startedAt));
        return result;
    } catch (error) {
        const mapped = mapDuplicateKeyError(error);
        frame.errorCode = typeof mapped?.code === 'string' ? mapped.code : undefined;
        await deliverOperationEvent(sink, buildOperationEvent(operation, 'error', frame, startedAt));
        throw mapped;
    }
}

// ---------------------------------------------------------------------------
// DTO / ordering helpers
// ---------------------------------------------------------------------------

function definitionDto(doc) {
    return typeof doc?.toDTO === 'function' ? doc.toDTO() : doc;
}

function assignmentDto(doc) {
    return typeof doc?.toDTO === 'function' ? doc.toDTO() : doc;
}

function compareStrings(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function byDefinitionOrder(a, b) {
    return compareStrings(a.normalizedName || '', b.normalizedName || '')
        || compareStrings(String(a.id), String(b.id));
}

function byAssignmentOrder(a, b) {
    return compareStrings(a.pocketNormalizedName || '', b.pocketNormalizedName || '')
        || compareStrings(String(a.pocketId), String(b.pocketId));
}

function tagEntryIndex(error, index) {
    if (error && typeof error === 'object' && Number.isInteger(index)) {
        error.details = { ...(error.details || {}), entryIndex: index };
    }
    return error;
}

// ---------------------------------------------------------------------------
// Definition commands
// ---------------------------------------------------------------------------

/**
 * Create exactly one Active_Pocket. All fields are validated (accumulating
 * every field error) before a single-record insert with version 1 and actor
 * audit fields. A normalized-name collision surfaces as a name conflict.
 */
async function createPocketDefinition(command, actor, options = {}) {
    return observeMutation('pocket.create', options, actor, async (frame) => {
        requirePocketManagementEnabled(options, actor);
        const actorId = requireWife(actor);
        frame.actorId = actorId;

        const { value, errors } = pocketValidation.validateDefinitionFields(command || {}, 'create');
        if (errors.length > 0) throw new PocketValidationError(errors);

        const Definition = definitionModel(options, actor);

        const created = await runInTransaction(async (session) => {
            const [doc] = await Definition.create([{
                name: value.name,
                normalizedName: value.normalizedName,
                emoji: value.emoji,
                cadence: value.cadence,
                defaultAmount: value.defaultAmount,
                bank: value.bank,
                status: 'Active',
                createdBy: actorId,
                updatedBy: actorId,
                version: 1
            }], { session });
            return doc;
        }, transactionContext(options, actor, { retryTracker: frame.retryTracker }));

        frame.pocketId = created?.id ?? created?._id;
        frame.changedRecordCount = 1;
        return definitionDto(created);
    });
}

/**
 * Return ordered definition collections for an authenticated household member.
 * Active-only by default; an archived-inclusive read returns a disjoint
 * `archived` collection. Both are ordered by normalized name then identifier.
 */
async function listPocketDefinitions(query = {}, actor, options = {}) {
    requirePocketManagementEnabled(options, actor);
    actorIdFor(actor);

    const includeArchived = query === true
        || query?.includeArchived === true
        || query?.includeArchived === 'true';

    const Definition = definitionModel(options, actor);
    const docs = await findMany(Definition, {}, { session: options.session });
    const dtos = docs.map(definitionDto);

    const active = dtos.filter((dto) => dto.status === 'Active').sort(byDefinitionOrder);
    if (!includeArchived) return { active };

    const archived = dtos.filter((dto) => dto.status === 'Archived').sort(byDefinitionOrder);
    return { active, archived };
}

/**
 * Partially update an Active_Pocket. Only supplied mutable fields may change;
 * omitted fields are preserved. A canonically equivalent request is a no-op
 * that preserves version, updater, and timestamp. A changed request uses a
 * compare-and-set on `_id` + version and increments version by exactly one.
 */
async function updatePocketDefinition(pocketId, command, actor, options = {}) {
    return observeMutation('pocket.update', options, actor, async (frame) => {
        requirePocketManagementEnabled(options, actor);
        const actorId = requireWife(actor);
        const id = validateIdentifier(pocketId, 'pocketId');
        frame.actorId = actorId;
        frame.pocketId = id;

        const { value, errors } = pocketValidation.validateDefinitionFields(command || {}, 'update');
        if (errors.length > 0) throw new PocketValidationError(errors);
        const expectedVersion = normalizeExpectedVersion(command?.expectedVersion ?? command?.version);

        const Definition = definitionModel(options, actor);

        const updated = await runInTransaction(async (session) => {
            const existing = await findById(Definition, id, { session });
            if (!existing) throw new RecordNotFoundError('pocket');
            if (existing.status === 'Archived') {
                throw new PocketLifecycleConflictError('POCKET_ARCHIVED_CONFLICT', { pocketId: id });
            }
            if (expectedVersion !== undefined && existing.version !== expectedVersion) {
                throw new VersionConflictError(existing.version, { pocketId: id });
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
            if (Object.prototype.hasOwnProperty.call(value, 'cadence') && existing.cadence !== value.cadence) {
                patch.cadence = value.cadence;
                changed = true;
            }
            if (Object.prototype.hasOwnProperty.call(value, 'defaultAmount')
                && existing.defaultAmount !== value.defaultAmount) {
                patch.defaultAmount = value.defaultAmount;
                changed = true;
            }
            if (Object.prototype.hasOwnProperty.call(value, 'bank') && existing.bank !== value.bank) {
                patch.bank = value.bank;
                changed = true;
            }

            // No-op: every supplied value already equals storage. Preserve the
            // stored record, version, updater, and update timestamp.
            if (!changed) {
                frame.changedRecordCount = 0;
                return existing;
            }

            const doc = await executeQuery(withSession(Definition.findOneAndUpdate(
                { _id: id, version: existing.version },
                { $set: { ...patch, updatedBy: actorId }, $inc: { version: 1 } },
                { new: true, runValidators: true }
            ), session));
            if (!doc) throw new VersionConflictError(existing.version, { pocketId: id });
            frame.changedRecordCount = 1;
            return doc;
        }, transactionContext(options, actor, { retryTracker: frame.retryTracker }));

        return definitionDto(updated);
    });
}

/**
 * Shared compare-and-set lifecycle transition used by archive and restore.
 */
async function transitionLifecycle(pocketId, command, actor, options, {
    operation,
    fromStatus,
    toStatus,
    requireConfirmation,
    alreadyInStateCode
}) {
    return observeMutation(operation, options, actor, async (frame) => {
        requirePocketManagementEnabled(options, actor);
        const actorId = requireWife(actor);
        const id = validateIdentifier(pocketId, 'pocketId');
        frame.actorId = actorId;
        frame.pocketId = id;

        if (requireConfirmation && command?.confirmed !== true) {
            throw new ConfirmationRequiredError({ pocketId: id });
        }
        const expectedVersion = normalizeExpectedVersion(command?.expectedVersion ?? command?.version);

        const Definition = definitionModel(options, actor);

        const updated = await runInTransaction(async (session) => {
            const existing = await findById(Definition, id, { session });
            if (!existing) throw new RecordNotFoundError('pocket');
            if (existing.status !== fromStatus) {
                throw new PocketLifecycleConflictError(alreadyInStateCode, { pocketId: id });
            }
            if (expectedVersion !== undefined && existing.version !== expectedVersion) {
                throw new VersionConflictError(existing.version, { pocketId: id });
            }

            const doc = await executeQuery(withSession(Definition.findOneAndUpdate(
                { _id: id, version: existing.version, status: fromStatus },
                { $set: { status: toStatus, updatedBy: actorId }, $inc: { version: 1 } },
                { new: true, runValidators: true }
            ), session));
            if (!doc) throw new VersionConflictError(existing.version, { pocketId: id });
            return doc;
        }, transactionContext(options, actor, { retryTracker: frame.retryTracker }));

        frame.changedRecordCount = 1;
        return definitionDto(updated);
    });
}

/**
 * Explicitly confirmed archive of an Active_Pocket. Changes only lifecycle and
 * update-audit fields and increments version by one; all references are
 * preserved. The confirmation flag is enforced in the service even for
 * non-browser callers.
 */
function archivePocketDefinition(pocketId, command, actor, options = {}) {
    return transitionLifecycle(pocketId, command, actor, options, {
        operation: 'pocket.archive',
        fromStatus: 'Active',
        toStatus: 'Archived',
        requireConfirmation: true,
        alreadyInStateCode: 'POCKET_ARCHIVED_CONFLICT'
    });
}

/**
 * Restore an Archived_Pocket to Active. Changes only lifecycle and
 * update-audit fields and increments version by one; the restored identifier
 * becomes available for new assignment selection again.
 */
function restorePocketDefinition(pocketId, command, actor, options = {}) {
    return transitionLifecycle(pocketId, command, actor, options, {
        operation: 'pocket.restore',
        fromStatus: 'Archived',
        toStatus: 'Active',
        requireConfirmation: false,
        alreadyInStateCode: 'POCKET_ACTIVE_CONFLICT'
    });
}

// ---------------------------------------------------------------------------
// Assignment setup (read)
// ---------------------------------------------------------------------------

/**
 * Return the Assignment_Setup projection for one Budget_Month: every
 * Active_Pocket exactly once with assigned/unassigned status and, when present,
 * its stored assignment snapshot; a separate `assignedArchived` collection for
 * archived pockets that still have a month assignment (visible for history and
 * removal but not selectable as new); the server-derived intersecting weeks;
 * the unassigned count; and month editability metadata.
 */
async function getAssignmentSetup(budgetMonth, actor, options = {}) {
    requirePocketManagementEnabled(options, actor);
    actorIdFor(actor);

    const month = normalizeMonth(budgetMonth);
    const timeZone = option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const weeks = deriveIntersectingWeeks(month.key, timeZone);

    const Definition = definitionModel(options, actor);
    const Assignment = assignmentModel(options, actor);
    const Guard = guardModel(options, actor);

    const [definitionDocs, assignmentDocs, guard] = await Promise.all([
        findMany(Definition, {}, { session: options.session }),
        findMany(Assignment, { budgetYear: month.year, budgetMonth: month.month }, { session: options.session }),
        findOne(Guard, { month: month.month, year: month.year }, { session: options.session, lean: true })
    ]);

    const assignmentByPocket = new Map(
        assignmentDocs.map((doc) => [String(doc.pocketId), assignmentDto(doc)])
    );

    const activeDefs = definitionDocs.filter((doc) => definitionDto(doc).status === 'Active');
    const pockets = activeDefs.map((doc) => {
        const dto = definitionDto(doc);
        const existing = assignmentByPocket.get(String(dto.id)) || null;
        return {
            ...dto,
            assignmentStatus: existing ? 'assigned' : 'unassigned',
            assignment: existing
        };
    }).sort(byDefinitionOrder);

    const unassignedCount = pockets.filter((p) => p.assignmentStatus === 'unassigned').length;

    const activeIds = new Set(activeDefs.map((doc) => String(definitionDto(doc).id)));
    const assignedArchived = assignmentDocs
        .map(assignmentDto)
        .filter((dto) => !activeIds.has(String(dto.pocketId)))
        .sort(byAssignmentOrder);

    const active = resolveActiveMonth(actor, options);
    const allowed = editableMonths(active);
    const isClosed = guard ? guard.isClosed !== false : false;
    const canEdit = actor?.role === 'Wife' && !isClosed && allowed.includes(month.key);

    return {
        budgetMonth: month.key,
        month: month.month,
        year: month.year,
        timeZone,
        weeks,
        pockets,
        assignedArchived,
        unassignedCount,
        activeBudgetMonth: active.key,
        editableMonths: allowed,
        isClosed,
        canEdit
    };
}

// ---------------------------------------------------------------------------
// Assignment confirmation
// ---------------------------------------------------------------------------

function collectReferencedIds(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const ids = [];
    for (const entry of list) {
        const raw = entry?.pocketId;
        if (raw === undefined || raw === null || raw === '') continue;
        const asString = String(raw);
        if (raw instanceof mongoose.Types.ObjectId || OBJECT_ID_PATTERN.test(asString)) {
            ids.push(asString);
        }
    }
    return [...new Set(ids)];
}

async function loadDefinitions(Definition, ids, session) {
    if (ids.length === 0) return [];
    return findMany(Definition, { _id: { $in: ids } }, { session });
}

function assignmentDocumentFor(plan, month, actorId) {
    return {
        pocketId: plan.pocketId,
        budgetMonth: month.month,
        budgetYear: month.year,
        pocketNameSnapshot: plan.pocketNameSnapshot,
        pocketNormalizedNameSnapshot: plan.pocketNormalizedNameSnapshot,
        pocketEmojiSnapshot: plan.pocketEmojiSnapshot,
        cadenceSnapshot: plan.cadenceSnapshot,
        amountMode: plan.amountMode,
        definitionVersion: plan.definitionVersion,
        allocations: plan.allocations.map((allocation) => ({
            kind: allocation.kind,
            key: allocation.key,
            isoWeekYear: allocation.isoWeekYear,
            isoWeekNumber: allocation.isoWeekNumber,
            amount: allocation.amount
        })),
        createdBy: actorId,
        updatedBy: actorId,
        version: 1
    };
}

function assignmentUpdateFields(plan, actorId) {
    return {
        pocketNameSnapshot: plan.pocketNameSnapshot,
        pocketNormalizedNameSnapshot: plan.pocketNormalizedNameSnapshot,
        pocketEmojiSnapshot: plan.pocketEmojiSnapshot,
        cadenceSnapshot: plan.cadenceSnapshot,
        amountMode: plan.amountMode,
        definitionVersion: plan.definitionVersion,
        allocations: plan.allocations.map((allocation) => ({
            kind: allocation.kind,
            key: allocation.key,
            isoWeekYear: allocation.isoWeekYear,
            isoWeekNumber: allocation.isoWeekNumber,
            amount: allocation.amount
        })),
        updatedBy: actorId
    };
}

/**
 * Atomically confirm an Assignment_Setup batch for one Budget_Month.
 *
 * The complete batch is planned and validated before any write: duplicate,
 * unknown, archived, selection, and amount errors are accumulated in
 * deterministic order and reject the whole confirmation. Inside a
 * period-fenced transaction the definitions are re-read (authoritative
 * snapshots), every entry is classified as insert/update/no-op/version-conflict
 * without writing, and only a fully clean batch is then reconciled. Assignments
 * omitted from the batch are preserved; the fresh, complete month result and
 * combined allocation total are returned only after commit.
 */
async function confirmAssignments(command, actor, options = {}) {
    return observeMutation('assignment.confirm', options, actor, async (frame) => {
        requirePocketManagementEnabled(options, actor);
        const actorId = requireWife(actor);
        frame.actorId = actorId;

        const month = normalizeMonth(command?.budgetMonth);
        frame.budgetMonth = month.key;
        const timeZone = option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
        const entries = command?.entries;

        // Editable-window policy is a deterministic business rule; reject early.
        assertEditableWindow(month, actor, options);

        const Definition = definitionModel(options, actor);
        const Assignment = assignmentModel(options, actor);

        const referencedIds = collectReferencedIds(entries);

        // Fast-fail validation without opening a transaction: plan against the
        // current definitions and reject every accumulated batch error.
        const preliminaryDefs = await loadDefinitions(Definition, referencedIds, options.session);
        const preliminary = planAssignments({
            budgetMonth: month.key,
            entries,
            definitions: preliminaryDefs,
            timeZone
        });
        if (preliminary.errors.length > 0) throw new PocketValidationError(preliminary.errors);

        const finalDocs = await runInTransaction(
            async (session) => withOpenBudgetPeriods(
                [{ month: month.month, year: month.year }],
                session,
                async (guard, activeSession) => {
                    // Re-check the editable window inside the fenced transaction
                    // so a period-close race cannot slip a stale write through.
                    assertEditableWindow(month, actor, options);

                    // Re-plan against session-read definitions so snapshots and
                    // lifecycle/version-sensitive inputs reflect committed state.
                    const sessionDefs = await loadDefinitions(Definition, referencedIds, activeSession);
                    const planned = planAssignments({
                        budgetMonth: month.key,
                        entries,
                        definitions: sessionDefs,
                        timeZone
                    });
                    if (planned.errors.length > 0) throw new PocketValidationError(planned.errors);

                    // Phase 1: classify every entry without writing so version
                    // and reconciliation conflicts are accumulated and reject
                    // the complete batch before any mutation.
                    const operations = [];
                    const conflicts = [];
                    for (const plan of planned.plans) {
                        const existing = await findOne(Assignment, {
                            pocketId: plan.pocketId,
                            budgetYear: month.year,
                            budgetMonth: month.month
                        }, { session: activeSession });
                        const entry = Array.isArray(entries) ? entries[plan.entryIndex] : undefined;
                        const expectedVersion = normalizeExpectedVersion(
                            entry?.expectedVersion ?? entry?.version
                        );

                        if (!existing) {
                            operations.push({ type: 'insert', plan });
                            continue;
                        }
                        if (pocketValidation.areAssignmentsEquivalent(plan, existing)) {
                            // Idempotent no-op: preserve version and timestamps.
                            operations.push({ type: 'noop' });
                            continue;
                        }
                        if (expectedVersion === undefined || expectedVersion !== existing.version) {
                            conflicts.push(tagEntryIndex(
                                new VersionConflictError(existing.version, {
                                    pocketId: plan.pocketId,
                                    budgetMonth: month.key
                                }),
                                plan.entryIndex
                            ));
                            continue;
                        }
                        operations.push({ type: 'update', plan, existing });
                    }

                    if (conflicts.length > 0) throw new PocketValidationError(conflicts);

                    // The number of records this confirmation actually changes
                    // (inserts + updates); equivalent no-ops are excluded so a
                    // fully idempotent re-confirmation reports zero changes.
                    frame.changedRecordCount = operations.filter(
                        (op) => op.type === 'insert' || op.type === 'update'
                    ).length;

                    // Phase 2: apply the reconciled inserts and updates.
                    for (const op of operations) {
                        if (op.type === 'insert') {
                            await Assignment.create(
                                [assignmentDocumentFor(op.plan, month, actorId)],
                                { session: activeSession }
                            );
                        } else if (op.type === 'update') {
                            const doc = await executeQuery(withSession(Assignment.findOneAndUpdate(
                                { _id: op.existing._id, version: op.existing.version },
                                { $set: assignmentUpdateFields(op.plan, actorId), $inc: { version: 1 } },
                                { new: true, runValidators: true }
                            ), activeSession));
                            if (!doc) {
                                throw new VersionConflictError(op.existing.version, {
                                    pocketId: op.plan.pocketId,
                                    budgetMonth: month.key
                                });
                            }
                        }
                    }

                    // Phase 3: return the fresh, complete month set (including
                    // preserved and archived-but-assigned assignments).
                    return findMany(Assignment, {
                        budgetYear: month.year,
                        budgetMonth: month.month
                    }, { session: activeSession });
                },
                { guardModel: guardModel(options, actor), actor: actorId }
            ),
            // A duplicate-create race aborts the transaction; retry the whole
            // confirmation so the now-visible assignment reconciles as an
            // update/no-op instead of a second insert.
            transactionContext(options, actor, {
                retryOn: (error) => isTransientTransactionError(error) || isDuplicateKeyError(error),
                retryTracker: frame.retryTracker
            })
        );

        const assignments = finalDocs.map(assignmentDto).sort(byAssignmentOrder);
        const combinedAllocationTotal = assignments.reduce(
            (total, assignment) => total + (Number.isFinite(assignment.allocationTotal) ? assignment.allocationTotal : 0),
            0
        );

        return {
            budgetMonth: month.key,
            month: month.month,
            year: month.year,
            assignments,
            combinedAllocationTotal,
            weeks: preliminary.weeks
        };
    });
}

// ---------------------------------------------------------------------------
// Assignment removal
// ---------------------------------------------------------------------------

async function countAttributedSpending(Transaction, pocketId, month, session) {
    const filter = {
        budgetMonth: month.month,
        budgetYear: month.year,
        $or: [
            { pocketId },
            { 'sourceBreakdowns.pocketId': pocketId }
        ]
    };
    const query = withSession(Transaction.countDocuments(filter), session);
    return executeQuery(query);
}

/**
 * Explicitly confirmed removal of one Pocket_Assignment. Requires the Wife
 * role, an open month inside the editable window, a matching version when
 * supplied, and zero attributed spending from single-pocket expenses or split
 * shares. On success exactly the identified assignment (and its embedded
 * allocations) is removed; every other assignment, allocation, expense, and
 * historical record is preserved.
 */
async function removeAssignment(pocketId, budgetMonth, command, actor, options = {}) {
    return observeMutation('assignment.remove', options, actor, async (frame) => {
        requirePocketManagementEnabled(options, actor);
        const actorId = requireWife(actor);
        const id = validateIdentifier(pocketId, 'pocketId');
        const month = normalizeMonth(budgetMonth);
        frame.actorId = actorId;
        frame.pocketId = id;
        frame.budgetMonth = month.key;

        if (command?.confirmed !== true) {
            throw new ConfirmationRequiredError({ pocketId: id, budgetMonth: month.key });
        }
        const expectedVersion = normalizeExpectedVersion(command?.expectedVersion ?? command?.version);

        assertEditableWindow(month, actor, options);

        const Assignment = assignmentModel(options, actor);
        const Transaction = transactionModel(options, actor);

        const result = await runInTransaction(
            async (session) => withOpenBudgetPeriods(
                [{ month: month.month, year: month.year }],
                session,
                async (guard, activeSession) => {
                    assertEditableWindow(month, actor, options);

                    const existing = await findOne(Assignment, {
                        pocketId: id,
                        budgetYear: month.year,
                        budgetMonth: month.month
                    }, { session: activeSession });
                    if (!existing) throw new RecordNotFoundError('pocket assignment');
                    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
                        throw new VersionConflictError(existing.version, { pocketId: id, budgetMonth: month.key });
                    }

                    const spending = await countAttributedSpending(Transaction, id, month, activeSession);
                    if (spending > 0) {
                        throw new PocketLifecycleConflictError('POCKET_ASSIGNMENT_SPENDING_CONFLICT', {
                            pocketId: id,
                            budgetMonth: month.key
                        });
                    }

                    const deletion = await executeQuery(withSession(Assignment.deleteOne({
                        _id: existing._id,
                        version: existing.version
                    }), activeSession));
                    if (deletion && deletion.deletedCount === 0) {
                        throw new VersionConflictError(existing.version, { pocketId: id, budgetMonth: month.key });
                    }

                    return {
                        success: true,
                        pocketId: id,
                        budgetMonth: month.key,
                        version: existing.version
                    };
                },
                { guardModel: guardModel(options, actor), actor: actorId }
            ),
            transactionContext(options, actor, { retryTracker: frame.retryTracker })
        );

        frame.changedRecordCount = 1;
        return result;
    });
}

// ---------------------------------------------------------------------------
// Expense pocket options (assignment-backed)
// ---------------------------------------------------------------------------

function resolveMonthFromExpenseInput(input, timeZone) {
    if (typeof input === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
            return normalizeMonth(resolveBudgetMonth({ expenseDate: input, timeZone }));
        }
        return normalizeMonth(input);
    }
    if (input && typeof input === 'object') {
        const expenseDate = input.expenseDate ?? input.date;
        if (expenseDate !== undefined && expenseDate !== null) {
            return normalizeMonth(resolveBudgetMonth({ expenseDate, timeZone }));
        }
        const monthValue = input.budgetMonth ?? input.month;
        if (monthValue !== undefined && monthValue !== null) {
            return normalizeMonth(monthValue);
        }
    }
    throw new DomainValidationError('date', 'A YYYY-MM-DD expense date or YYYY-MM Budget Month is required.');
}

/**
 * Return the pockets selectable for a new/updated expense in the derived
 * Budget_Month: exactly the pockets with an assignment that month, regardless
 * of current lifecycle status, each exactly once, using the assignment snapshot
 * label/emoji and ordered by normalized snapshot name then identifier.
 */
async function listExpensePocketOptions(input, actor, options = {}) {
    requirePocketManagementEnabled(options, actor);
    actorIdFor(actor);

    const timeZone = option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const month = resolveMonthFromExpenseInput(input, timeZone);

    const Assignment = assignmentModel(options, actor);
    const assignmentDocs = await findMany(Assignment, {
        budgetYear: month.year,
        budgetMonth: month.month
    }, { session: options.session });

    // Guarded dual-read: a month with no managed assignments has not been
    // migrated, so during the compatibility stage the selectable pockets fall
    // back to the fixed legacy catalogue (keyed by the deterministic managed
    // pocketId the migration would assign). Each fallback is tracked so a
    // zero-fallback observation window can be verified before legacy retirement.
    // Managed-only mode returns exactly the assignment-backed options.
    if (assignmentDocs.length === 0 && isDualReadActive(options, actor)) {
        const tracker = resolveTracker(options, actor);
        return Object.entries(POCKETS)
            .map(([name, emoji]) => {
                const normalizedName = pocketValidation.normalizePocketName(name).normalizedName;
                const pocketId = String(pocketDefinitionId(normalizedName));
                tracker.observeFallback({
                    source: 'legacy',
                    collection: 'pocketdefinitions',
                    budgetMonth: month.key,
                    pocketId
                });
                return {
                    pocketId,
                    name,
                    normalizedName,
                    emoji,
                    cadence: 'Monthly',
                    budgetMonth: month.key,
                    source: 'legacy'
                };
            })
            .sort((a, b) => (
                compareStrings(a.normalizedName || '', b.normalizedName || '')
                || compareStrings(a.pocketId, b.pocketId)
            ));
    }

    return assignmentDocs
        .map(assignmentDto)
        .sort(byAssignmentOrder)
        .map((dto) => ({
            pocketId: dto.pocketId,
            name: dto.pocketName,
            normalizedName: dto.pocketNormalizedName,
            emoji: dto.pocketEmoji,
            cadence: dto.cadence,
            budgetMonth: dto.budgetMonthKey
        }));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Dependency-injected facade used by controllers and integration tests. Every
 * command accepts (…command args, actor, options); the default options supplied
 * here are merged under any per-call options.
 */
function createPocketManagementService(defaultOptions = {}) {
    const merge = (options) => ({ ...defaultOptions, ...options });
    return {
        createPocketDefinition: (command, actor, options) =>
            createPocketDefinition(command, actor, merge(options)),
        listPocketDefinitions: (query, actor, options) =>
            listPocketDefinitions(query, actor, merge(options)),
        updatePocketDefinition: (pocketId, command, actor, options) =>
            updatePocketDefinition(pocketId, command, actor, merge(options)),
        archivePocketDefinition: (pocketId, command, actor, options) =>
            archivePocketDefinition(pocketId, command, actor, merge(options)),
        restorePocketDefinition: (pocketId, command, actor, options) =>
            restorePocketDefinition(pocketId, command, actor, merge(options)),
        getAssignmentSetup: (budgetMonth, actor, options) =>
            getAssignmentSetup(budgetMonth, actor, merge(options)),
        confirmAssignments: (command, actor, options) =>
            confirmAssignments(command, actor, merge(options)),
        removeAssignment: (pocketId, budgetMonth, command, actor, options) =>
            removeAssignment(pocketId, budgetMonth, command, actor, merge(options)),
        listExpensePocketOptions: (input, actor, options) =>
            listExpensePocketOptions(input, actor, merge(options))
    };
}

module.exports = {
    createPocketManagementService,
    createPocketDefinition,
    listPocketDefinitions,
    updatePocketDefinition,
    archivePocketDefinition,
    restorePocketDefinition,
    getAssignmentSetup,
    confirmAssignments,
    removeAssignment,
    listExpensePocketOptions
};
