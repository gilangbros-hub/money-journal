'use strict';

const mongoose = require('mongoose');
const MigrationPreview = require('../models/migrationPreview');
const MigrationPreviewItem = require('../models/migrationPreviewItem');
const PocketBudget = require('../models/pocketBudget');
const PocketBudgetCadence = require('../models/pocketBudgetCadence');
const WeeklyAllocation = require('../models/weeklyAllocation');
const Transaction = require('../models/transaction');
const ClosedMonth = require('../models/closedMonth');
const PocketDefinition = require('../models/pocketDefinition');
const PocketAssignment = require('../models/pocketAssignment');
const {
    AuthorizationError,
    DomainValidationError,
    MigrationConflictError,
    StorageError,
    ConfigurationError
} = require('../utils/domainErrors');
const {
    canonicalEqual,
    createSourceFingerprint,
    sourceRecordFingerprint,
    toCanonical
} = require('./migrationFingerprint');
const {
    checkPreservation,
    checkTransactionAssociationPreservation,
    createMigrationPreview,
    pocketDefinitionId,
    POCKET_MANAGEMENT_MIGRATION_VERSION
} = require('./migrationTransformService');
const { normalizePocketName } = require('./pocketValidation');
const { createFallbackTracker, reconcilePocketSources } = require('./pocketCompatibility');
const {
    parseExpenseDate,
    parseIsoWeek,
    resolveBudgetMonth
} = require('./salaryCycleResolver');
const { normalizeSourceBreakdowns } = require('../utils/transactionValidators');

const SOURCE_COLLECTIONS = [
    'pocketbudgets',
    'pocketbudgetcadences',
    'weeklyallocations',
    'transactions',
    'closedmonths'
];

const DEFAULT_MIGRATION_VERSION = 'salary-cycle-v1';
// Preview items are persisted separately, but the migration remains an
// all-or-nothing operation. Keep bounded defaults so an operator cannot
// accidentally create a preview that the later transactional execution
// cannot safely consume. Explicit options may tighten either bound.
const DEFAULT_MAX_PREVIEW_ITEMS = 10_000;
const DEFAULT_MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MODEL_BY_COLLECTION = {
    pocketbudgets: PocketBudget,
    pocketbudgetcadences: PocketBudgetCadence,
    weeklyallocations: WeeklyAllocation,
    transactions: Transaction,
    closedmonths: ClosedMonth,
    // Managed target collections written by the pocket-management transform.
    // They are read/inserted/updated through the same execute/verify/rollback
    // primitives as the legacy source collections; they are never part of the
    // legacy source-fingerprint set (SOURCE_COLLECTIONS).
    pocketdefinitions: PocketDefinition,
    pocketassignments: PocketAssignment
};

// These are the persistent uniqueness guards that make a verified migration
// readable by both the new services and the legacy monthly readers.
const REQUIRED_UNIQUE_INDEXES = {
    pocketbudgets: { pocket: 1, month: 1, year: 1 },
    pocketbudgetcadences: { pocket: 1, month: 1, year: 1 },
    weeklyallocations: {
        pocket: 1, month: 1, year: 1, isoWeekYear: 1, isoWeekNumber: 1
    },
    closedmonths: { month: 1, year: 1 }
};

const REQUIRED_SCHEMA_PATHS = {
    pocketbudgets: ['schemaVersion'],
    transactions: ['expenseDate', 'assignmentVersion', 'schemaVersion'],
    closedmonths: ['isClosed', 'closedAt', 'mutationSequence', 'schemaVersion']
};

const PRESERVATION_KIND = {
    monthlyAllocationConversion: 'monthlyAllocation',
    cadenceAssignment: 'budgetCadence',
    transactionCanonicalDate: 'transaction',
    transactionBudgetMonthChange: 'transaction',
    transactionAssignmentMetadata: 'transaction',
    closedMonthPreservation: 'closedMonth'
};

// The pocket-management transform creates managed definition/assignment
// documents and associates transactions with a deterministic pocketId. The
// managed uniqueness guards mirror the model-declared indexes so verification
// proves normalized-name and (pocketId, budgetMonth) uniqueness. Only the
// transaction-association change adds fields to an existing record, so it is
// the only managed change with a preservation kind.
const POCKET_REQUIRED_UNIQUE_INDEXES = {
    pocketdefinitions: { normalizedName: 1 },
    pocketassignments: { pocketId: 1, budgetYear: 1, budgetMonth: 1 }
};

const POCKET_REQUIRED_SCHEMA_PATHS = {
    pocketdefinitions: ['normalizedName', 'version', 'schemaVersion'],
    pocketassignments: ['pocketId', 'budgetMonth', 'budgetYear', 'allocations', 'version', 'schemaVersion'],
    transactions: ['pocketId']
};

const POCKET_PRESERVATION_KIND = {
    transactionPocketAssociation: 'transactionAssociation'
};

function isPocketManagementVersion(migrationVersion) {
    return migrationVersion === POCKET_MANAGEMENT_MIGRATION_VERSION;
}

// Unlike the all-or-nothing salary-cycle transform, the pocket-management
// transform isolates unmappable groups: unambiguous groups still migrate while
// every blocked group is retained untouched. Approval/execution therefore skip
// blocked items instead of rejecting the whole preview.
function allowsPartialExecution(migrationVersion) {
    return isPocketManagementVersion(migrationVersion);
}

function requiredUniqueIndexesFor(migrationVersion) {
    return isPocketManagementVersion(migrationVersion)
        ? POCKET_REQUIRED_UNIQUE_INDEXES
        : REQUIRED_UNIQUE_INDEXES;
}

function requiredSchemaPathsFor(migrationVersion) {
    return isPocketManagementVersion(migrationVersion)
        ? POCKET_REQUIRED_SCHEMA_PATHS
        : REQUIRED_SCHEMA_PATHS;
}

function preservationKindFor(migrationVersion) {
    return isPocketManagementVersion(migrationVersion)
        ? POCKET_PRESERVATION_KIND
        : PRESERVATION_KIND;
}

function sameIndexKeys(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function plainRecord(value) {
    if (value && typeof value.toObject === 'function') {
        return value.toObject({ depopulate: true });
    }
    return value;
}

function changedFieldsMatch(currentValue, beforeSnapshot, afterSnapshot) {
    const current = plainRecord(currentValue);
    if (!current || typeof current !== 'object') return false;
    const { set, unset } = changedFields(beforeSnapshot, afterSnapshot);
    return Object.entries(set).every(([key, value]) =>
        Object.prototype.hasOwnProperty.call(current, key) && canonicalEqual(current[key], value)
    ) && Object.keys(unset).every(key => !Object.prototype.hasOwnProperty.call(current, key));
}

function expectedRecordKey(item) {
    return `${item.collectionName}:${item.recordId}`;
}

function expectedRecordMatches(current, expected) {
    return expected === null
        ? current === null
        : current !== null && current !== undefined && canonicalEqual(plainRecord(current), expected);
}

function preservationChecks(items, preview) {
    const failures = [];
    const kindMap = preservationKindFor(preview.migrationVersion);
    for (const item of approvedItems(items, preview)) {
        const kind = kindMap[item.changeType];
        if (!kind) continue;
        const result = kind === 'transactionAssociation'
            ? checkTransactionAssociationPreservation(item.before, item.after)
            : checkPreservation(item.before, item.after, kind);
        if (!result.ok) {
            failures.push({
                collectionName: item.collectionName,
                recordId: item.recordId,
                changeType: item.changeType,
                violations: result.violations
            });
        }
    }
    return failures;
}

function sourceInvariantFailures(records, timeZone) {
    const failures = [];
    const uniqueKeys = new Map();
    const addUnique = (collectionName, key, recordId) => {
        const identity = `${collectionName}:${key}`;
        if (uniqueKeys.has(identity)) {
            failures.push({ collectionName, recordId, invariant: 'duplicate-composite-key', key });
        } else uniqueKeys.set(identity, recordId);
    };

    for (const { collectionName, value } of records) {
        const record = plainRecord(value);
        if (!record) continue;
        if (collectionName === 'pocketbudgets' || collectionName === 'pocketbudgetcadences') {
            addUnique(collectionName, `${record.pocket}:${record.month}:${record.year}`, String(record._id));
        } else if (collectionName === 'weeklyallocations') {
            addUnique(collectionName, `${record.pocket}:${record.month}:${record.year}:${record.isoWeekYear}:${record.isoWeekNumber}`, String(record._id));
        } else if (collectionName === 'closedmonths') {
            addUnique(collectionName, `${record.month}:${record.year}`, String(record._id));
        }

        try {
            if (collectionName === 'transactions' && record.schemaVersion >= 2) {
                const expenseDate = parseExpenseDate(record.expenseDate).toString();
                const assignment = resolveBudgetMonth({ expenseDate, timeZone });
                if (record.budgetMonth !== assignment.month || record.budgetYear !== assignment.year) {
                    failures.push({ collectionName, recordId: String(record._id), invariant: 'transaction-assignment' });
                }
                if (record.sourceType === 'multi') normalizeSourceBreakdowns(record.sourceBreakdowns, record.amount);
            }
            if (collectionName === 'weeklyallocations') {
                parseIsoWeek(`${String(record.isoWeekYear).padStart(4, '0')}-W${String(record.isoWeekNumber).padStart(2, '0')}`);
            }
        } catch (error) {
            failures.push({
                collectionName,
                recordId: String(record._id),
                invariant: error?.field || 'record-schema'
            });
        }
    }
    return failures;
}

async function structuralChecks(models, records, migrationVersion) {
    const schemaFailures = [];
    const indexFailures = [];
    const checkedSchemas = [];
    const checkedIndexes = [];
    const requiredSchemaPaths = requiredSchemaPathsFor(migrationVersion);
    const requiredUniqueIndexes = requiredUniqueIndexesFor(migrationVersion);

    for (const [collectionName, model] of Object.entries(models || {})) {
        const schema = model?.schema;
        if (!schema) continue;
        // Only collections that carry a structural contract for this migration
        // version are inspected, so managed and legacy runs never cross-check
        // each other's schema paths or indexes.
        if (!requiredSchemaPaths[collectionName] && !requiredUniqueIndexes[collectionName]) continue;
        checkedSchemas.push(collectionName);
        for (const path of requiredSchemaPaths[collectionName] || []) {
            if (!schema.path(path)) schemaFailures.push({ collectionName, path, reason: 'missing-schema-path' });
        }

        const requiredIndex = requiredUniqueIndexes[collectionName];
        if (!requiredIndex) continue;
        const declared = typeof schema.indexes === 'function' ? schema.indexes() : [];
        const declaredMatch = declared.some(([keys, options]) =>
            sameIndexKeys(keys, requiredIndex) && options?.unique === true
        );
        if (!declaredMatch) {
            indexFailures.push({ collectionName, index: requiredIndex, reason: 'missing-declared-unique-index' });
            continue;
        }
        checkedIndexes.push(collectionName);

        // When connected, inspect the actual collection as well. Lightweight
        // test adapters expose only the schema and are intentionally skipped.
        if (typeof model.collection?.listIndexes === 'function') {
            try {
                const cursor = model.collection.listIndexes();
                const actual = typeof cursor?.toArray === 'function' ? await cursor.toArray() : [];
                if (actual.length && !actual.some(index => index.unique === true && sameIndexKeys(index.key, requiredIndex))) {
                    indexFailures.push({ collectionName, index: requiredIndex, reason: 'missing-persistent-unique-index' });
                }
            } catch {
                indexFailures.push({ collectionName, index: requiredIndex, reason: 'index-inspection-failed' });
            }
        }
    }

    const schemaRecords = [];
    for (const { collectionName, value } of records) {
        const model = models?.[collectionName];
        if (model?.schema) schemaRecords.push({ collectionName, recordId: String(plainRecord(value)?._id) });
    }
    return { schemaFailures, indexFailures, checkedSchemas, checkedIndexes, schemaRecords };
}

async function runRouteReadableChecks(routeChecks, context) {
    if (routeChecks === undefined || routeChecks === null) {
        return { ok: true, checked: 0, failures: [], skipped: true };
    }
    const checks = Array.isArray(routeChecks) ? routeChecks : [routeChecks];
    const failures = [];
    let checked = 0;
    for (const entry of checks) {
        const check = typeof entry === 'function' ? entry : entry?.check;
        if (typeof check !== 'function') {
            failures.push({ name: entry?.name || 'route', reason: 'invalid-route-check' });
            continue;
        }
        checked += 1;
        try {
            const result = await check(context);
            if (result === false || result?.ok === false) failures.push({ name: entry?.name || 'route', result });
        } catch (error) {
            failures.push({ name: entry?.name || 'route', reason: error.message || 'route-check-failed' });
        }
    }
    return { ok: failures.length === 0, checked, failures, skipped: false };
}

function actorId(actor) {
    const value = actor?.userId ?? actor?._id ?? actor?.id ?? actor;
    if (!value) throw new AuthorizationError('Operator');
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (mongoose.isValidObjectId(value)) return new mongoose.Types.ObjectId(value);
    return value;
}

function requireOperator(actor) {
    if (!actor || !['Operator', 'Wife'].includes(actor.role)) {
        throw new AuthorizationError('Operator');
    }
    return actorId(actor);
}

function normalizePreviewId(value) {
    if (!value || !mongoose.isValidObjectId(value)) {
        throw new DomainValidationError('previewId', 'previewId must be a valid identifier.');
    }
    return new mongoose.Types.ObjectId(value);
}

function executeQuery(query) {
    if (query && typeof query.exec === 'function') return query.exec();
    return Promise.resolve(query);
}

function withSession(query, session) {
    return session && query && typeof query.session === 'function' ? query.session(session) : query;
}

function modelFor(collectionName, models = MODEL_BY_COLLECTION) {
    const model = models[collectionName];
    if (!model) throw new StorageError('integrity');
    return model;
}

async function readCollection(collectionName, { models = MODEL_BY_COLLECTION, session } = {}) {
    const model = modelFor(collectionName, models);
    if (typeof model.find === 'function') {
        let query = model.find({});
        query = withSession(query, session);
        if (query && typeof query.lean === 'function') query = query.lean();
        return executeQuery(query);
    }
    const cursor = model.find ? model.find({}) : null;
    return cursor && typeof cursor.toArray === 'function' ? cursor.toArray() : [];
}

async function readSources(options = {}) {
    const source = {};
    for (const collectionName of SOURCE_COLLECTIONS) {
        source[collectionName] = await readCollection(collectionName, options);
    }
    return source;
}

// Read a collection only when a model for it is available. Used to feed already
// migrated managed documents back into the pocket-management transform so a
// rerun over unchanged data proposes no duplicate definitions/assignments
// (Requirement 12.12) without requiring the model in lightweight test adapters.
async function readOptionalCollection(collectionName, { models = MODEL_BY_COLLECTION, session } = {}) {
    if (!models || !models[collectionName]) return [];
    return readCollection(collectionName, { models, session });
}

function sourceInput(source) {
    return {
        pocketBudgets: source.pocketbudgets,
        pocketBudgetCadences: source.pocketbudgetcadences,
        weeklyAllocations: source.weeklyallocations,
        transactions: source.transactions,
        closedMonths: source.closedmonths
    };
}

function hasHistoricalChanges(items) {
    return items.some(item => item.changeType === 'transactionBudgetMonthChange');
}

function lifecycleApprovalError(preview) {
    if (preview.status === 'Blocked') {
        return new MigrationConflictError('MIGRATION_PREVIEW_BLOCKED', {
            previewId: String(preview._id),
            status: preview.status
        });
    }
    if (preview.status === 'Stale') {
        return new MigrationConflictError('MIGRATION_PREVIEW_STALE', {
            previewId: String(preview._id),
            status: preview.status
        });
    }
    return new MigrationConflictError('MIGRATION_APPROVAL_REQUIRED', {
        previewId: String(preview._id),
        status: preview.status
    });
}

function comparePreviewItems(left, right) {
    const sequenceDifference = (left.sequence ?? Number.MAX_SAFE_INTEGER) -
        (right.sequence ?? Number.MAX_SAFE_INTEGER);
    if (sequenceDifference) return sequenceDifference;
    for (const field of ['collectionName', 'recordId', 'changeType', 'sourceRecordFingerprint']) {
        const leftValue = String(left[field] ?? '');
        const rightValue = String(right[field] ?? '');
        if (leftValue < rightValue) return -1;
        if (leftValue > rightValue) return 1;
    }
    return 0;
}

function orderedPreviewItems(items = []) {
    return items.slice().sort(comparePreviewItems);
}

function isApprovedItem(item, preview) {
    // Historical assignment changes always require the separate approval flag;
    // an executable bit on a tampered item must never bypass that gate.
    if (item.changeType === 'transactionBudgetMonthChange') {
        return preview?.historicalReassignmentApproved === true &&
            (item.executable === true || item.blockingReason === 'HISTORICAL_REASSIGNMENT_APPROVAL_REQUIRED');
    }
    return item.executable === true;
}

function approvedItems(items, preview) {
    return orderedPreviewItems(items).filter(item => isApprovedItem(item, preview));
}

function countSummary(preview) {
    return {
        scanned: preview.counts.scanned,
        unchanged: preview.counts.unchanged,
        proposed: preview.counts.proposed,
        invalid: preview.counts.invalid,
        duplicateAllocationKeys: preview.counts.duplicateAllocationKeys,
        unresolvableConflicts: preview.counts.unresolvableConflicts,
        byChangeType: preview.counts.byChangeType
    };
}

function canonicalStored(value) {
    return toCanonical(value);
}

function decodeMongoValue(value) {
    if (Array.isArray(value)) return value.map(decodeMongoValue);
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1) {
        if (value.$undefined) return undefined;
        if (value.$date) return new Date(value.$date);
        if (value.$oid) return new mongoose.Types.ObjectId(value.$oid);
        if (value.$numberLong) return BigInt(value.$numberLong);
        if (value.$numberDouble) {
            if (value.$numberDouble === 'NaN') return NaN;
            if (value.$numberDouble === 'Infinity') return Infinity;
            if (value.$numberDouble === '-Infinity') return -Infinity;
            if (value.$numberDouble === '-0.0') return -0;
        }
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) result[key] = decodeMongoValue(entry);
    return result;
}

function itemFilter(item, snapshot) {
    const id = snapshot?._id;
    if (id !== undefined) return { _id: decodeMongoValue(id) };
    const month = snapshot?.month;
    const year = snapshot?.year;
    if (Number.isInteger(month) && Number.isInteger(year)) return { month, year };
    return null;
}

function originalExpectedRecords(items, preview) {
    const groups = new Map();
    for (const item of approvedItems(items, preview).sort((a, b) => a.sequence - b.sequence)) {
        const key = `${item.collectionName}:${item.recordId}`;
        if (!groups.has(key)) {
            groups.set(key, {
                item,
                value: Object.keys(item.before || {}).length === 0 ? null : decodeMongoValue(item.before)
            });
        }
    }
    return [...groups.values()];
}

function finalExpectedRecords(items, preview) {
    const groups = new Map();
    for (const item of approvedItems(items, preview).sort((a, b) => a.sequence - b.sequence)) {
        const key = `${item.collectionName}:${item.recordId}`;
        if (!groups.has(key)) groups.set(key, { item, value: null });
        const group = groups.get(key);
        const isFirst = group.value === null;
        if (isFirst) {
            group.value = decodeMongoValue(item.before || {});
            if (Object.keys(group.value).length === 0) {
                group.value = decodeMongoValue(item.after);
                continue;
            }
        }
        const { set, unset } = changedFields(item.before, item.after);
        Object.assign(group.value, set);
        for (const keyToDelete of Object.keys(unset)) delete group.value[keyToDelete];
    }
    return [...groups.values()];
}

async function collectionFor(collectionName, models = MODEL_BY_COLLECTION) {
    const model = modelFor(collectionName, models);
    if (model.collection) return model.collection;
    return model;
}

async function findCurrent(item, { models = MODEL_BY_COLLECTION, session } = {}) {
    const collection = await collectionFor(item.collectionName, models);
    const snapshot = item.after || item.before;
    const filter = itemFilter(item, snapshot);
    if (!filter || typeof collection.findOne !== 'function') return null;
    return collection.findOne(filter, session ? { session } : undefined);
}

function changedFields(beforeSnapshot, afterSnapshot) {
    const before = decodeMongoValue(beforeSnapshot || {});
    const after = decodeMongoValue(afterSnapshot || {});
    const set = {};
    const unset = {};
    for (const [key, value] of Object.entries(after)) {
        if (!Object.prototype.hasOwnProperty.call(before, key) || !canonicalEqual(before[key], value)) {
            set[key] = value;
        }
    }
    for (const key of Object.keys(before)) {
        if (!Object.prototype.hasOwnProperty.call(after, key)) unset[key] = '';
    }
    return { set, unset };
}

async function assertItemBefore(item, options = {}, expectedSnapshot = item.before) {
    const current = await findCurrent(item, options);
    const before = decodeMongoValue(expectedSnapshot || {});
    if (Object.keys(before || {}).length === 0) {
        if (current) throw new MigrationConflictError('MIGRATION_PREVIEW_STALE', { recordId: item.recordId });
        return null;
    }
    if (!current || !canonicalEqual(current, before)) {
        throw new MigrationConflictError('MIGRATION_PREVIEW_STALE', { recordId: item.recordId });
    }
    return current;
}

async function applyItem(item, options = {}) {
    const { models = MODEL_BY_COLLECTION, session, expectedBefore = item.before } = options;
    const collection = await collectionFor(item.collectionName, models);
    const current = await assertItemBefore(item, options, expectedBefore);
    const filter = itemFilter(item, item.after) || itemFilter(item, item.before);
    if (!filter) throw new MigrationConflictError('MIGRATION_PREVIEW_STALE', { recordId: item.recordId });
    const before = decodeMongoValue(expectedBefore || {});
    const after = decodeMongoValue(item.after);

    if (!current) {
        await collection.insertOne(after, { session });
    } else {
        const { set, unset } = changedFields(item.before, item.after);
        const update = {};
        if (Object.keys(set).length) update.$set = set;
        if (Object.keys(unset).length) update.$unset = unset;
        const result = await collection.updateOne(filter, update, { session });
        if (!result || result.matchedCount !== 1) {
            throw new MigrationConflictError('MIGRATION_PREVIEW_STALE', { recordId: item.recordId });
        }
    }
    return { before, after };
}

async function reverseItem(item, options = {}) {
    const { models = MODEL_BY_COLLECTION, session, expectedAfter = item.after } = options;
    const collection = await collectionFor(item.collectionName, models);
    const after = decodeMongoValue(expectedAfter || {});
    const current = await findCurrent(item, { ...options, session });
    const afterFilter = itemFilter(item, item.after) || itemFilter(item, item.before);
    if (!current || !canonicalEqual(current, after)) {
        throw new MigrationConflictError('MIGRATION_ROLLBACK_CONFLICT', { recordId: item.recordId });
    }
    const before = decodeMongoValue(item.before || {});
    if (Object.keys(before || {}).length === 0) {
        const deleted = await collection.deleteOne(afterFilter, { session });
        if (!deleted || deleted.deletedCount !== 1) {
            throw new MigrationConflictError('MIGRATION_ROLLBACK_CONFLICT', { recordId: item.recordId });
        }
    } else {
        const { set, unset } = changedFields(item.after, item.before);
        const update = {};
        if (Object.keys(set).length) update.$set = set;
        if (Object.keys(unset).length) update.$unset = unset;
        const replaced = await collection.updateOne(afterFilter, update, { session });
        if (!replaced || replaced.matchedCount !== 1) {
            throw new MigrationConflictError('MIGRATION_ROLLBACK_CONFLICT', { recordId: item.recordId });
        }
    }
}

async function checkTransactionsSupported(connection) {
    if (!connection?.db?.admin) return true;
    try {
        const hello = await connection.db.admin().command({ hello: 1 });
        if (hello && hello.ok !== 0 && (hello.setName || hello.msg === 'isdbgrid')) return true;
    } catch (error) {
        throw new ConfigurationError('CONFIG_TRANSACTIONS_REQUIRED', error);
    }
    throw new ConfigurationError('CONFIG_TRANSACTIONS_REQUIRED');
}

async function runTransaction(connection, operation, options = {}) {
    await checkTransactionsSupported(connection);
    if (!connection || typeof connection.startSession !== 'function') {
        throw new ConfigurationError('CONFIG_TRANSACTIONS_REQUIRED');
    }
    const session = await connection.startSession();
    if (!session || typeof session.withTransaction !== 'function' || typeof session.endSession !== 'function') {
        await session?.endSession?.();
        throw new ConfigurationError('CONFIG_TRANSACTIONS_REQUIRED');
    }
    const requestedTransactionOptions = options.transactionOptions || {};
    const transactionOptions = {
        ...requestedTransactionOptions,
        // Migration execution must not be acknowledged below the durability
        // guarantee required by the lifecycle, even when a caller supplies
        // custom transaction options.
        writeConcern: {
            ...(requestedTransactionOptions.writeConcern || {}),
            w: 'majority'
        }
    };
    try {
        let value;
        await session.withTransaction(async () => {
            value = await operation(session);
        }, transactionOptions);
        return value;
    } finally {
        await session.endSession();
    }
}

async function loadPreview(previewId, { previewModel = MigrationPreview, itemModel = MigrationPreviewItem } = {}) {
    const id = normalizePreviewId(previewId);
    let previewQuery = previewModel.findById(id);
    const preview = await executeQuery(previewQuery);
    if (!preview) throw new MigrationConflictError('MIGRATION_PREVIEW_BLOCKED', { previewId: String(previewId) });
    let itemsQuery = itemModel.find({ previewId: id });
    if (itemsQuery && typeof itemsQuery.sort === 'function') itemsQuery = itemsQuery.sort({ sequence: 1 });
    const items = await executeQuery(itemsQuery);
    return { preview, items: orderedPreviewItems(items) };
}

function previewLimit(value, fallback, field) {
    const limit = value === undefined ? fallback : value;
    if (limit === null) return undefined;
    if (!Number.isSafeInteger(limit) || limit < 0) {
        throw new DomainValidationError(field, `${field} must be a non-negative safe integer.`);
    }
    return limit;
}

function previewTooLarge({ itemCount, previewBytes, maxPreviewItems, maxPreviewBytes }) {
    return (maxPreviewItems !== undefined && itemCount > maxPreviewItems) ||
        (maxPreviewBytes !== undefined && previewBytes > maxPreviewBytes);
}

/** Read all source collections, create an immutable transform, and persist only its preview documents. */
async function createAndPersistPreview({
    actor,
    timeZone,
    migrationVersion = DEFAULT_MIGRATION_VERSION,
    // Historical reassignment is intentionally approved only by the explicit
    // approve operation. Keep this option in the API for compatibility with
    // callers that used it during preview generation, but never persist it as
    // approval or make historical items executable during a dry run.
    historicalReassignmentApproved: _historicalReassignmentApproved,
    requiredBudgetMonths,
    models = MODEL_BY_COLLECTION,
    previewModel = MigrationPreview,
    itemModel = MigrationPreviewItem,
    connection = mongoose.connection,
    maxPreviewItems,
    maxPreviewBytes
} = {}) {
    const operator = requireOperator(actor);
    // Preview is dry-run for financial records, but the resulting lifecycle
    // still promises a transactional execution. Reject standalone MongoDB
    // deployments before persisting even preview metadata/items.
    await checkTransactionsSupported(connection);
    const partial = allowsPartialExecution(migrationVersion);
    const source = await readSources({ models });
    // The managed transform is idempotent: existing definitions/assignments are
    // fed back so a rerun over unchanged data proposes no duplicates. Legacy
    // salary-cycle previews never read managed collections.
    const managedSources = partial
        ? {
            pocketDefinitions: await readOptionalCollection('pocketdefinitions', { models }),
            pocketAssignments: await readOptionalCollection('pocketassignments', { models })
        }
        : {};
    const preview = createMigrationPreview({
        ...sourceInput(source),
        ...managedSources,
        timeZone,
        migrationVersion,
        historicalReassignmentApproved: false,
        requiredBudgetMonths
    });
    const serializedPreviewSize = Buffer.byteLength(JSON.stringify(preview.items));
    const itemLimit = previewLimit(maxPreviewItems, DEFAULT_MAX_PREVIEW_ITEMS, 'maxPreviewItems');
    const byteLimit = previewLimit(maxPreviewBytes, DEFAULT_MAX_PREVIEW_BYTES, 'maxPreviewBytes');
    if (previewTooLarge({
        itemCount: preview.items.length,
        previewBytes: serializedPreviewSize,
        maxPreviewItems: itemLimit,
        maxPreviewBytes: byteLimit
    })) {
        throw new MigrationConflictError('MIGRATION_PREVIEW_BLOCKED', {
            reason: 'MIGRATION_PREVIEW_TOO_LARGE',
            itemCount: preview.items.length,
            previewBytes: serializedPreviewSize,
            maxPreviewItems: itemLimit,
            maxPreviewBytes: byteLimit
        });
    }
    const historicalOnlyBlockers = preview.blockers.length > 0 && preview.blockers.every(item =>
        item.blockingReason === 'HISTORICAL_REASSIGNMENT_APPROVAL_REQUIRED'
    );
    // Managed previews isolate blockers per group: they stay approvable as long
    // as at least one executable item remains, and are only Blocked when there
    // is nothing to migrate but blockers to report. Legacy previews keep their
    // all-or-nothing rule (any non-historical blocker blocks the whole preview).
    const hasExecutableItem = preview.items.some(item => item.executable === true);
    const status = partial
        ? (!hasExecutableItem && preview.blockers.length ? 'Blocked' : 'Draft')
        : (preview.blockers.length && !historicalOnlyBlockers ? 'Blocked' : 'Draft');
    const header = {
        migrationVersion: preview.migrationVersion,
        timeZone: preview.timeZone,
        status,
        historicalReassignmentApproved: false,
        sourceFingerprint: preview.sourceFingerprint,
        counts: countSummary(preview),
        createdBy: operator
    };
    const document = new previewModel(header);
    await document.save();
    if (preview.items.length) {
        await itemModel.insertMany(preview.items.map(item => ({ ...item, previewId: document._id })));
    }
    return { preview: document, items: preview.items.map(item => ({ ...item, previewId: document._id })) };
}

async function approveMigrationPreview({
    previewId,
    actor,
    historicalReassignmentApproved = false,
    models,
    previewModel = MigrationPreview,
    itemModel = MigrationPreviewItem
} = {}) {
    const operator = requireOperator(actor);
    const { preview, items } = await loadPreview(previewId, { previewModel, itemModel });
    if (preview.status !== 'Draft') throw lifecycleApprovalError(preview);
    const partial = allowsPartialExecution(preview.migrationVersion);

    // Blockers are evaluated before any source-version check so a blocked
    // preview can never be promoted merely because its source changed in a
    // way that would otherwise produce a stale error. Managed previews isolate
    // blocked groups instead of rejecting the whole preview, so their per-item
    // blockers are retained (untouched) rather than gating approval; a fully
    // blocked managed preview is already Blocked and rejected above.
    if (!partial &&
        items.some(item => !item.executable && item.blockingReason !== 'HISTORICAL_REASSIGNMENT_APPROVAL_REQUIRED')) {
        throw new MigrationConflictError('MIGRATION_PREVIEW_BLOCKED', { previewId: String(preview._id) });
    }

    // A production approval is also a source-snapshot gate. Custom models are
    // intentionally supported for deterministic unit tests, where execution
    // performs the authoritative stale check inside its transaction.
    if (models || (previewModel === MigrationPreview && itemModel === MigrationPreviewItem)) {
        const currentFingerprint = await currentSourceFingerprint({
            timeZone: preview.timeZone,
            migrationVersion: preview.migrationVersion,
            models: models || MODEL_BY_COLLECTION
        });
        if (currentFingerprint !== preview.sourceFingerprint) {
            throw new MigrationConflictError('MIGRATION_PREVIEW_STALE', {
                previewId: String(preview._id),
                expected: preview.sourceFingerprint,
                actual: currentFingerprint
            });
        }
    }

    const requiresHistory = hasHistoricalChanges(items);
    // This flag belongs to this approval operation, not preview creation.
    // A historical proposal therefore remains non-executable until the
    // operator explicitly confirms it here.
    const historyApproved = historicalReassignmentApproved === true;
    if (requiresHistory && !historyApproved) {
        throw new MigrationConflictError('MIGRATION_APPROVAL_REQUIRED', {
            previewId: String(preview._id),
            historicalReassignmentApprovalRequired: true
        });
    }
    const updated = await executeQuery(previewModel.findOneAndUpdate(
        { _id: preview._id, status: 'Draft' },
        {
            $set: {
                status: 'Approved',
                historicalReassignmentApproved: requiresHistory && historyApproved,
                approvedBy: operator,
                approvedAt: new Date()
            }
        },
        { new: true, runValidators: true }
    ));
    if (!updated) throw new MigrationConflictError('MIGRATION_APPROVAL_REQUIRED', { previewId: String(preview._id) });
    return updated;
}

async function currentSourceFingerprint({ timeZone, migrationVersion, models, session }) {
    const source = await readSources({ models, session });
    const records = [];
    for (const collectionName of SOURCE_COLLECTIONS) {
        for (const record of source[collectionName]) records.push({ collectionName, record });
    }
    return createSourceFingerprint({ records, timeZone, migrationVersion });
}

async function executeMigrationPreview({
    previewId,
    actor,
    models = MODEL_BY_COLLECTION,
    previewModel = MigrationPreview,
    itemModel = MigrationPreviewItem,
    connection = mongoose.connection,
    transactionOptions
} = {}) {
    const operator = requireOperator(actor);
    const { preview, items } = await loadPreview(previewId, { previewModel, itemModel });
    if (preview.status !== 'Approved') {
        throw new MigrationConflictError(
            preview.status === 'Stale' ? 'MIGRATION_PREVIEW_STALE' : 'MIGRATION_APPROVAL_REQUIRED',
            { previewId: String(preview._id), status: preview.status }
        );
    }
    if (hasHistoricalChanges(items) && preview.historicalReassignmentApproved !== true) {
        throw new MigrationConflictError('MIGRATION_APPROVAL_REQUIRED', { historicalReassignmentApprovalRequired: true });
    }
    // Legacy previews are all-or-nothing: any non-executable item blocks
    // execution. Managed previews commit only their executable (approved) items
    // and leave every blocked group untouched, so a mix of executable and
    // blocked items is expected and must not reject the whole execution.
    if (!allowsPartialExecution(preview.migrationVersion) &&
        items.some(item => !isApprovedItem(item, preview))) {
        throw new MigrationConflictError('MIGRATION_PREVIEW_BLOCKED', { previewId: String(preview._id) });
    }

    return runTransaction(connection, async session => {
        const fresh = await executeQuery(withSession(previewModel.findOne({ _id: preview._id, status: 'Approved' }), session));
        if (!fresh) throw new MigrationConflictError('MIGRATION_APPROVAL_REQUIRED', { previewId: String(preview._id) });
        const fingerprint = await currentSourceFingerprint({
            timeZone: fresh.timeZone,
            migrationVersion: fresh.migrationVersion,
            models,
            session
        });
        if (fingerprint !== fresh.sourceFingerprint) {
            throw new MigrationConflictError('MIGRATION_PREVIEW_STALE', {
                previewId: String(fresh._id),
                expected: fresh.sourceFingerprint,
                actual: fingerprint
            });
        }
        const executing = await executeQuery(previewModel.updateOne(
            { _id: fresh._id, status: 'Approved' },
            { $set: { status: 'Executing', executedBy: operator, executionStartedAt: new Date() } },
            { session }
        ));
        if (!executing || (executing.matchedCount !== undefined && executing.matchedCount !== 1)) {
            throw new MigrationConflictError('MIGRATION_APPROVAL_REQUIRED', { previewId: String(fresh._id) });
        }
        const expectedByRecord = new Map();
        for (const item of approvedItems(items, fresh)) {
            const key = `${item.collectionName}:${item.recordId}`;
            await applyItem(item, {
                models,
                session,
                expectedBefore: expectedByRecord.has(key) ? expectedByRecord.get(key) : item.before
            });
            expectedByRecord.set(key, item.after);
        }
        const appliedFingerprint = await currentSourceFingerprint({
            timeZone: fresh.timeZone,
            migrationVersion: fresh.migrationVersion,
            models,
            session
        });
        const applied = await executeQuery(previewModel.updateOne(
            { _id: fresh._id, status: 'Executing' },
            { $set: { status: 'Applied', executedAt: new Date(), appliedFingerprint } },
            { session }
        ));
        if (!applied || (applied.matchedCount !== undefined && applied.matchedCount !== 1)) {
            throw new MigrationConflictError('MIGRATION_PREVIEW_STALE', { previewId: String(fresh._id) });
        }
        return { previewId: fresh._id, status: 'Applied', appliedFingerprint };
    }, { transactionOptions });
}

async function verifyMigrationPreview({
    previewId,
    actor,
    models = MODEL_BY_COLLECTION,
    previewModel = MigrationPreview,
    itemModel = MigrationPreviewItem,
    routeChecks,
    routeReadableChecks
} = {}) {
    const verifierId = requireOperator(actor);
    const { preview, items } = await loadPreview(previewId, { previewModel, itemModel });
    if (!['Applied', 'RolledBack'].includes(preview.status)) {
        throw new MigrationConflictError('MIGRATION_APPROVAL_REQUIRED', { previewId: String(preview._id), status: preview.status });
    }

    const expectedItems = preview.status === 'Applied'
        ? finalExpectedRecords(items, preview)
        : originalExpectedRecords(items, preview);
    const mismatches = [];
    for (const { item, value: expected } of expectedItems) {
        const current = await findCurrent(item, { models });
        if (!expectedRecordMatches(current, expected)) {
            mismatches.push({ collectionName: item.collectionName, recordId: item.recordId, expected });
        }
    }

    // A record may have several ordered patches (for example canonical date,
    // assignment, and metadata). Check each preview after-value's fields as
    // well as the reconstructed final document, so verification proves every
    // approved transformation was applied rather than only the final merge.
    const appliedItems = preview.status === 'Applied' ? approvedItems(items, preview) : [];
    const itemMismatches = [];
    for (const item of appliedItems) {
        const current = await findCurrent(item, { models });
        if (!current || !changedFieldsMatch(current, item.before, item.after)) {
            itemMismatches.push({ collectionName: item.collectionName, recordId: item.recordId, sequence: item.sequence });
        }
    }

    const expectedRecords = expectedItems.map(entry => ({
        collectionName: entry.item.collectionName,
        value: entry.value
    }));
    const structural = await structuralChecks(models, expectedRecords, preview.migrationVersion);
    const preservation = preservationChecks(items, preview);
    const source = await readSources({ models });
    const invariantRecords = SOURCE_COLLECTIONS.flatMap(collectionName =>
        (source[collectionName] || []).map(value => ({ collectionName, value }))
    );
    const invariants = sourceInvariantFailures(invariantRecords, preview.timeZone);
    const routes = await runRouteReadableChecks(routeChecks || routeReadableChecks, {
        preview,
        items,
        models,
        expectedRecords
    });
    const actualFingerprint = await currentSourceFingerprint({
        timeZone: preview.timeZone,
        migrationVersion: preview.migrationVersion,
        models
    });
    const fingerprintMismatch = preview.status === 'Applied' && preview.appliedFingerprint &&
        actualFingerprint !== preview.appliedFingerprint;
    if (fingerprintMismatch) {
        mismatches.push({
            type: 'sourceFingerprint',
            expected: preview.appliedFingerprint,
            actual: actualFingerprint
        });
    }

    const structuralFailures = [
        ...structural.schemaFailures,
        ...structural.indexFailures
    ];
    const ok = mismatches.length === 0 && itemMismatches.length === 0 &&
        structuralFailures.length === 0 && preservation.length === 0 &&
        invariants.length === 0 && routes.ok;

    // Record a compact, machine-readable verification summary on the immutable
    // preview header so activation tooling can gate on the latest outcome. The
    // summary intentionally stores only counts and boolean outcomes; it never
    // stores record values, names, emoji, amounts, or notes. Persistence is
    // best-effort and never changes the verification result the caller sees.
    try {
        await executeQuery(previewModel.updateOne(
            { _id: preview._id },
            {
                $set: {
                    verifiedBy: verifierId,
                    verifiedAt: new Date(),
                    verification: {
                        ok,
                        status: preview.status,
                        checked: expectedItems.length,
                        appliedItemsChecked: appliedItems.length,
                        mismatchCount: mismatches.length,
                        itemMismatchCount: itemMismatches.length,
                        preservationOk: preservation.length === 0,
                        schemaOk: structural.schemaFailures.length === 0,
                        indexesOk: structural.indexFailures.length === 0,
                        invariantsOk: invariants.length === 0,
                        routesOk: routes.ok
                    }
                }
            }
        ));
    } catch {
        // A verification-summary write failure must not mask the verification
        // result itself; the returned outcome remains authoritative.
    }
    return {
        previewId: preview._id,
        status: preview.status,
        ok,
        checked: expectedItems.length,
        appliedItemsChecked: appliedItems.length,
        mismatches,
        itemMismatches,
        checks: {
            preservation: { ok: preservation.length === 0, failures: preservation },
            schema: { ok: structural.schemaFailures.length === 0, checked: structural.checkedSchemas.length, failures: structural.schemaFailures },
            indexes: { ok: structural.indexFailures.length === 0, checked: structural.checkedIndexes.length, failures: structural.indexFailures },
            invariants: { ok: invariants.length === 0, failures: invariants },
            routes
        },
        sourceFingerprint: actualFingerprint,
        appliedFingerprint: preview.appliedFingerprint
    };
}

async function approveMigrationRollback({
    previewId,
    actor,
    previewModel = MigrationPreview,
    itemModel = MigrationPreviewItem
} = {}) {
    const operator = requireOperator(actor);
    const { preview } = await loadPreview(previewId, { previewModel, itemModel });
    if (preview.status !== 'Applied') {
        throw new MigrationConflictError('MIGRATION_ROLLBACK_CONFLICT', { previewId: String(preview._id), status: preview.status });
    }
    const updated = await executeQuery(previewModel.findOneAndUpdate(
        { _id: preview._id, status: 'Applied', rollbackApprovedBy: { $exists: false } },
        { $set: { rollbackApprovedBy: operator, rollbackApprovedAt: new Date() } },
        { new: true, runValidators: true }
    ));
    if (!updated) throw new MigrationConflictError('MIGRATION_ROLLBACK_CONFLICT', { previewId: String(preview._id) });
    return updated;
}

async function rollbackMigrationPreview({
    previewId,
    actor,
    models = MODEL_BY_COLLECTION,
    previewModel = MigrationPreview,
    itemModel = MigrationPreviewItem,
    connection = mongoose.connection,
    transactionOptions
} = {}) {
    const operator = requireOperator(actor);
    const { preview, items } = await loadPreview(previewId, { previewModel, itemModel });
    if (preview.status !== 'Applied' || !preview.rollbackApprovedBy) {
        throw new MigrationConflictError('MIGRATION_ROLLBACK_CONFLICT', { previewId: String(preview._id), approvalRequired: true });
    }
    return runTransaction(connection, async session => {
        const fresh = await executeQuery(withSession(previewModel.findOne({ _id: preview._id, status: 'Applied' }), session));
        if (!fresh || !fresh.rollbackApprovedBy) {
            throw new MigrationConflictError('MIGRATION_ROLLBACK_CONFLICT', { previewId: String(preview._id) });
        }
        const expectedAfterRecords = finalExpectedRecords(items, fresh);
        const expectedByRecord = new Map(expectedAfterRecords.map(({ item, value }) => [
            expectedRecordKey(item), canonicalStored(value)
        ]));

        // Validate every affected record before the first reverse write. This
        // is required even when the backing connection is a lightweight test
        // adapter: a conflict must have observable zero-write semantics, not
        // merely rely on MongoDB transaction abort behavior.
        const rollbackConflicts = [];
        for (const { item, value: expected } of expectedAfterRecords) {
            const current = await findCurrent(item, { models, session });
            if (!expectedRecordMatches(current, expected)) {
                rollbackConflicts.push({
                    collectionName: item.collectionName,
                    recordId: item.recordId,
                    expectedFingerprint: sourceRecordFingerprint(expected, item.collectionName),
                    actualFingerprint: current ? sourceRecordFingerprint(plainRecord(current), item.collectionName) : null
                });
            }
        }
        if (rollbackConflicts.length) {
            throw new MigrationConflictError('MIGRATION_ROLLBACK_CONFLICT', {
                previewId: String(fresh._id),
                conflicts: rollbackConflicts
            });
        }

        for (const item of approvedItems(items, fresh).reverse()) {
            const key = expectedRecordKey(item);
            const expectedAfter = expectedByRecord.has(key)
                ? expectedByRecord.get(key)
                : item.after;
            await reverseItem(item, { models, session, expectedAfter });
            const current = await findCurrent(item, { models, session });
            if (current) expectedByRecord.set(key, canonicalStored(current));
            else expectedByRecord.delete(key);
        }
        const rolledBack = await executeQuery(previewModel.updateOne(
            { _id: fresh._id, status: 'Applied' },
            { $set: { status: 'RolledBack', rolledBackBy: operator, rolledBackAt: new Date() } },
            { session }
        ));
        if (!rolledBack || (rolledBack.matchedCount !== undefined && rolledBack.matchedCount !== 1)) {
            throw new MigrationConflictError('MIGRATION_ROLLBACK_CONFLICT', { previewId: String(fresh._id) });
        }
        return { previewId: fresh._id, status: 'RolledBack' };
    }, { transactionOptions });
}

/**
 * Compare the managed and legacy read paths across every Budget_Month and
 * report the guarded dual-read outcome: how many pocket identities are served
 * by a managed assignment, how many still fall back to a legacy allocation
 * because they have not been migrated, and any ambiguous double source where a
 * managed assignment and its legacy allocation disagree.
 *
 * This is a read-only verification helper. It never mutates source or managed
 * data. The rollout verification tooling uses its counts to fail closed on a
 * nonzero legacy fallback (before legacy retirement) or any ambiguity (before
 * final activation), exactly matching the reader adapters used at request time
 * by the budget, transaction, and reporting services.
 */
async function reconcileDualReadSources(options = {}) {
    const { models = MODEL_BY_COLLECTION, session, observer = null } = options;
    const tracker = createFallbackTracker({ observer });

    const [assignments, monthly, weekly, cadences] = await Promise.all([
        readOptionalCollection('pocketassignments', { models, session }),
        readOptionalCollection('pocketbudgets', { models, session }),
        readOptionalCollection('weeklyallocations', { models, session }),
        readOptionalCollection('pocketbudgetcadences', { models, session })
    ]);

    const scopeKey = (year, month) => `${year}-${month}`;

    // Managed assignments per Budget_Month scope.
    const managedByScope = new Map();
    for (const doc of assignments) {
        const dto = typeof doc?.toDTO === 'function' ? doc.toDTO() : plainRecord(doc);
        const key = scopeKey(dto.budgetYear, dto.budgetMonth);
        if (!managedByScope.has(key)) managedByScope.set(key, []);
        managedByScope.get(key).push({
            pocketId: String(dto.pocketId),
            budgetYear: dto.budgetYear,
            budgetMonth: dto.budgetMonth,
            allocationTotal: Number.isFinite(dto.allocationTotal) ? dto.allocationTotal : 0
        });
    }

    // Legacy allocations per Budget_Month scope, aggregated per pocket name so a
    // cadence choice selects either the monthly amount or the weekly sum.
    const legacyByScope = new Map();
    const legacyBucket = (year, month) => {
        const key = scopeKey(year, month);
        if (!legacyByScope.has(key)) legacyByScope.set(key, new Map());
        return legacyByScope.get(key);
    };
    const legacyEntry = (bucket, name) => {
        if (!bucket.has(name)) {
            bucket.set(name, { name, cadence: 'Monthly', monthly: 0, weekly: 0 });
        }
        return bucket.get(name);
    };
    for (const record of cadences) {
        const entry = legacyEntry(legacyBucket(record.year, record.month), record.pocket);
        entry.cadence = record.cadence === 'Weekly' ? 'Weekly' : 'Monthly';
    }
    for (const record of monthly) {
        legacyEntry(legacyBucket(record.year, record.month), record.pocket).monthly += record.budget || 0;
    }
    for (const record of weekly) {
        legacyEntry(legacyBucket(record.year, record.month), record.pocket).weekly += record.budget || 0;
    }

    const byScope = [];
    const scopes = new Set([...managedByScope.keys(), ...legacyByScope.keys()]);
    for (const scope of scopes) {
        const managed = managedByScope.get(scope) || [];
        const legacyBucketMap = legacyByScope.get(scope) || new Map();
        const budgetMonthKey = (() => {
            const source = managed[0] || null;
            if (source) {
                return `${String(source.budgetYear).padStart(4, '0')}-${String(source.budgetMonth).padStart(2, '0')}`;
            }
            const [year, month] = scope.split('-');
            return `${String(year).padStart(4, '0')}-${String(Number(month)).padStart(2, '0')}`;
        })();

        const legacy = [...legacyBucketMap.values()].map(entry => ({
            pocketId: String(pocketDefinitionId(normalizePocketName(typeof entry.name === 'string' ? entry.name : '').normalizedName)),
            pocket: entry.name,
            activeAllocation: entry.cadence === 'Weekly' ? entry.weekly : entry.monthly
        }));

        const managedTotalById = new Map(managed.map(item => [item.pocketId, item.allocationTotal]));
        const before = { fallback: tracker.counts.fallback, ambiguous: tracker.counts.ambiguous };
        reconcilePocketSources({
            managed,
            legacy,
            keyOf: (record) => String(record.pocketId),
            isEquivalent: (managedRecord, legacyRecord) =>
                (managedTotalById.get(String(managedRecord.pocketId)) ?? 0) === (legacyRecord.activeAllocation ?? 0),
            tracker,
            metaOf: (record) => ({
                source: 'legacy',
                collection: 'pocketbudgets',
                budgetMonth: budgetMonthKey,
                pocketId: record.pocketId
            })
        });
        byScope.push({
            budgetMonth: budgetMonthKey,
            managedCount: managed.length,
            legacyCount: legacy.length,
            fallbackCount: tracker.counts.fallback - before.fallback,
            ambiguousCount: tracker.counts.ambiguous - before.ambiguous
        });
    }

    return {
        ...tracker.summary(),
        events: tracker.events,
        byScope
    };
}

module.exports = {
    reconcileDualReadSources,
    DEFAULT_MIGRATION_VERSION,
    DEFAULT_MAX_PREVIEW_ITEMS,
    DEFAULT_MAX_PREVIEW_BYTES,
    POCKET_MANAGEMENT_MIGRATION_VERSION,
    POCKET_REQUIRED_SCHEMA_PATHS,
    POCKET_REQUIRED_UNIQUE_INDEXES,
    REQUIRED_SCHEMA_PATHS,
    REQUIRED_UNIQUE_INDEXES,
    SOURCE_COLLECTIONS,
    approveMigrationPreview,
    approveMigrationRollback,
    approvePreview: approveMigrationPreview,
    approveRollback: approveMigrationRollback,
    checkTransactionsSupported,
    createAndPersistPreview,
    createMigrationPreview: createAndPersistPreview,
    executeMigrationPreview,
    executePreview: executeMigrationPreview,
    executeQuery,
    loadPreview,
    previewMigration: createAndPersistPreview,
    readSources,
    rollbackMigrationPreview,
    rollbackPreview: rollbackMigrationPreview,
    runTransaction,
    verifyMigrationPreview,
    verifyPreview: verifyMigrationPreview
};
