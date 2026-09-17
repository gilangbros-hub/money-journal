'use strict';

const mongoose = require('mongoose');
const { Temporal } = require('@js-temporal/polyfill');
const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    parseBudgetMonth,
    parseExpenseDate,
    parseIsoWeek,
    resolveBudgetMonth,
    validateTimeZone
} = require('./salaryCycleResolver');
const { POCKETS } = require('../utils/constants');
const {
    validateAmount,
    normalizeSourceBreakdowns,
    validatePocket,
    validateSourceType
} = require('../utils/transactionValidators');
const {
    canonicalEqual,
    createSourceFingerprint,
    hashCanonical,
    normalizeSourceRecords,
    recordId,
    sourceRecordFingerprint,
    toCanonical
} = require('./migrationFingerprint');
const {
    normalizePocketName,
    canonicalAssignmentSignature
} = require('./pocketValidation');

const DEFAULT_MIGRATION_VERSION = 'salary-cycle-v1';
const POCKET_MANAGEMENT_MIGRATION_VERSION = 'pocket-management-v1';
const COLLECTION_ORDER = [
    'pocketbudgets',
    'pocketbudgetcadences',
    'weeklyallocations',
    'transactions',
    'closedmonths'
];
const POCKET_NAMES = new Set(Object.keys(POCKETS));
const PRESERVED_FIELDS = {
    monthlyAllocation: ['_id', 'pocket', 'budget', 'month', 'year', 'createdBy', 'createdAt', 'updatedAt'],
    budgetCadence: ['pocket', 'month', 'year'],
    transaction: [
        '_id', 'type', 'pocket', 'ngapain', 'by', 'paidBy', 'amount', 'date',
        'sourceType', 'sourceBreakdowns', 'createdAt', 'updatedAt'
    ],
    closedMonth: ['_id', 'month', 'year', 'closedBy', 'createdAt', 'updatedAt']
};

function clone(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (value && typeof value.toHexString === 'function') return value;
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
        const result = {};
        for (const key of Object.keys(value)) result[key] = clone(value[key]);
        return result;
    }
    return value;
}

function snapshot(value) {
    return toCanonical(value);
}

function keyFor(month, year, pocket) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}${pocket ? `:${pocket}` : ''}`;
}

function monthKey(month, year) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function deterministicObjectId(collectionName, logicalKey) {
    const digest = hashCanonical({ collectionName, logicalKey }).slice('sha256:'.length, 'sha256:'.length + 24);
    return new mongoose.Types.ObjectId(digest);
}

function hasSourceIdentity(record) {
    return record && record._id !== undefined && record._id !== null && String(record._id) !== '';
}

function parseMonthFields(record, prefix = 'budget') {
    if (!Number.isInteger(record?.month) || record.month < 1 || record.month > 12 ||
        !Number.isInteger(record?.year)) {
        return { ok: false, reason: `${prefix.toUpperCase()}_MONTH_KEY_INVALID` };
    }
    return { ok: true, month: record.month, year: record.year };
}

function validBudgetRecord(record) {
    const month = parseMonthFields(record);
    if (!month.ok) return month;
    if (!POCKET_NAMES.has(record.pocket)) return { ok: false, reason: 'INVALID_POCKET' };
    if (typeof record.budget !== 'number' || !Number.isSafeInteger(record.budget) || record.budget < 0) {
        return { ok: false, reason: 'INVALID_ALLOCATION_AMOUNT' };
    }
    return { ok: true, ...month, key: keyFor(month.month, month.year, record.pocket) };
}

function validCadenceRecord(record) {
    const month = parseMonthFields(record, 'cadence');
    if (!month.ok) return month;
    if (!POCKET_NAMES.has(record.pocket)) return { ok: false, reason: 'INVALID_POCKET' };
    if (!['Monthly', 'Weekly'].includes(record.cadence)) return { ok: false, reason: 'INVALID_CADENCE' };
    return { ok: true, ...month, key: keyFor(month.month, month.year, record.pocket) };
}

function validClosedRecord(record) {
    const month = parseMonthFields(record, 'closed');
    return month.ok ? { ok: true, ...month, key: monthKey(month.month, month.year) } : month;
}

function canonicalDateFromLegacy(record, timeZone) {
    if (record.expenseDate !== undefined) return parseExpenseDate(record.expenseDate).toString();
    const legacyDate = record.date;
    if (legacyDate instanceof Date) {
        if (Number.isNaN(legacyDate.getTime())) throw new Error('INVALID_EXPENSE_DATE');
        return Temporal.Instant.from(legacyDate.toISOString())
            .toZonedDateTimeISO(timeZone)
            .toPlainDate()
            .toString();
    }
    if (typeof legacyDate === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(legacyDate)) return parseExpenseDate(legacyDate).toString();
        return Temporal.Instant.from(legacyDate)
            .toZonedDateTimeISO(timeZone)
            .toPlainDate()
            .toString();
    }
    throw new Error('INVALID_EXPENSE_DATE');
}

function validateTransactionRecord(record) {
    try {
        validatePocket(record?.pocket);
        validateAmount(record.amount);

        const sourceType = record.sourceType || (Array.isArray(record.sourceBreakdowns) && record.sourceBreakdowns.length ? 'multi' : 'single');
        validateSourceType(sourceType);
        const breakdowns = record.sourceBreakdowns;
        if (sourceType === 'single') {
            if (breakdowns !== undefined && (!Array.isArray(breakdowns) || breakdowns.length > 0)) {
                return 'INVALID_POCKET_SHARES';
            }
            return null;
        }

        normalizeSourceBreakdowns(breakdowns, record.amount);
        return null;
    } catch (error) {
        if (error?.message?.includes('unique pockets')) return 'DUPLICATE_POCKET_SHARE';
        if (error?.field?.includes('amount')) return error.field.includes('sourceBreakdowns')
            ? 'INVALID_POCKET_SHARE_AMOUNT'
            : 'INVALID_TRANSACTION_AMOUNT';
        if (error?.field?.includes('pocket')) return error.message?.includes('unique')
            ? 'DUPLICATE_POCKET_SHARE'
            : 'INVALID_POCKET';
        if (error?.field === 'sourceType') return 'INVALID_SOURCE_TYPE';
        if (error?.field === 'sourceBreakdowns') return 'POCKET_SHARES_SUM_MISMATCH';
        return 'INVALID_TRANSACTION_RECORD';
    }
}

function sameAssignment(record, assignment) {
    return Number.isInteger(record.budgetMonth) && Number.isInteger(record.budgetYear) &&
        record.budgetMonth === assignment.month && record.budgetYear === assignment.year;
}

function item({ collectionName, recordId: id, changeType, before, after, executable = true, blockingReason, source }) {
    const result = {
        collectionName,
        recordId: id,
        changeType,
        before: snapshot(before),
        after: snapshot(after),
        executable,
        sourceRecordFingerprint: sourceRecordFingerprint(source || before, collectionName)
    };
    if (blockingReason) result.blockingReason = blockingReason;
    return result;
}

function addItem(state, candidate) {
    state.items.push(candidate);
    state.counts.proposed += 1;
    state.counts.byChangeType[candidate.changeType] =
        (state.counts.byChangeType[candidate.changeType] || 0) + 1;
    if (!candidate.executable) state.blockers.push(candidate);
}

function addInvalid(state, collectionName, source, reason, changeType = 'invalidRecord', fallbackId) {
    state.counts.invalid += 1;
    addItem(state, item({
        collectionName,
        recordId: recordId(source, fallbackId),
        changeType,
        before: source,
        after: source,
        executable: false,
        blockingReason: reason,
        source
    }));
}

function markSourceIdentityIssues(state, source) {
    state.blockedSourceEntries = new Set();
    for (const [collectionName, records] of Object.entries(source)) {
        const byId = new Map();
        records.forEach((record, index) => {
            const entryKey = `${collectionName}:${index}`;
            if (!hasSourceIdentity(record)) {
                state.blockedSourceEntries.add(entryKey);
                addInvalid(state, collectionName, record, 'INVALID_RECORD_IDENTIFIER', 'sourceRecordIdentity', `source:${index}`);
                return;
            }
            const id = recordId(record);
            if (!byId.has(id)) byId.set(id, []);
            byId.get(id).push(index);
        });
        for (const indexes of byId.values()) {
            if (indexes.length < 2) continue;
            state.counts.unresolvableConflicts += indexes.length;
            for (const index of indexes) {
                state.blockedSourceEntries.add(`${collectionName}:${index}`);
                addInvalid(state, collectionName, records[index], 'DUPLICATE_SOURCE_IDENTIFIER', 'sourceRecordIdentity', `source:${index}`);
            }
        }
    }
}

function transformBudgets(state, source) {
    const budgets = source.pocketbudgets;
    const valid = budgets.map(record => validBudgetRecord(record));
    const duplicates = new Map();
    for (const result of valid) if (result.ok) duplicates.set(result.key, (duplicates.get(result.key) || 0) + 1);
    const duplicateKeys = new Set([...duplicates].filter(([, count]) => count > 1).map(([key]) => key));
    state.counts.duplicateAllocationKeys += duplicateKeys.size;
    state.counts.unresolvableConflicts += duplicateKeys.size;

    for (const [index, record] of budgets.entries()) {
        state.counts.scanned += 1;
        if (state.blockedSourceEntries.has(`pocketbudgets:${index}`)) continue;
        const validation = valid[index];
        if (!validation.ok) {
            addInvalid(state, 'pocketbudgets', record, validation.reason, 'monthlyAllocationConversion');
            continue;
        }
        if (duplicateKeys.has(validation.key)) {
            addItem(state, item({
                collectionName: 'pocketbudgets', recordId: recordId(record, `budget:${validation.key}:${index}`),
                changeType: 'monthlyAllocationConversion', before: record, after: record, executable: false,
                blockingReason: 'DUPLICATE_ALLOCATION_COMPOSITE_KEY', source: record
            }));
            continue;
        }
        const after = clone(record);
        let changed = false;
        if (after.schemaVersion !== 2) {
            after.schemaVersion = 2;
            changed = true;
        }
        if (changed) {
            const check = checkPreservation(record, after, 'monthlyAllocation');
            addItem(state, item({
                collectionName: 'pocketbudgets', recordId: recordId(record, `budget:${validation.key}`),
                changeType: 'monthlyAllocationConversion', before: record, after,
                executable: check.ok, blockingReason: check.ok ? undefined : 'PRESERVATION_CHECK_FAILED', source: record
            }));
        } else {
            state.counts.unchanged += 1;
        }
        state.requiredMonths.add(monthKey(validation.month, validation.year));
    }
}

function transformCadences(state, source) {
    const existing = new Map();
    for (const [index, record] of source.pocketbudgetcadences.entries()) {
        state.counts.scanned += 1;
        if (state.blockedSourceEntries.has(`pocketbudgetcadences:${index}`)) continue;
        const validation = validCadenceRecord(record);
        if (!validation.ok) {
            addInvalid(state, 'pocketbudgetcadences', record, validation.reason, 'cadenceAssignment');
            continue;
        }
        if (existing.has(validation.key)) {
            state.counts.duplicateAllocationKeys += 1;
            state.counts.unresolvableConflicts += 1;
            addInvalid(state, 'pocketbudgetcadences', record, 'DUPLICATE_ALLOCATION_COMPOSITE_KEY', 'cadenceAssignment');
            continue;
        }
        existing.set(validation.key, record);
        state.cadences.set(validation.key, record);
        state.requiredMonths.add(monthKey(validation.month, validation.year));
        state.counts.unchanged += 1;
    }
    return existing;
}

function validWeeklyRecord(record) {
    const month = parseMonthFields(record, 'weekly');
    if (!month.ok) return month;
    if (!POCKET_NAMES.has(record.pocket)) return { ok: false, reason: 'INVALID_POCKET' };
    if (!Number.isInteger(record.isoWeekYear) || !Number.isInteger(record.isoWeekNumber) ||
        record.isoWeekNumber < 1 || record.isoWeekNumber > 53) {
        return { ok: false, reason: 'INVALID_ISO_WEEK' };
    }
    try {
        parseIsoWeek(`${String(record.isoWeekYear).padStart(4, '0')}-W${String(record.isoWeekNumber).padStart(2, '0')}`);
    } catch {
        return { ok: false, reason: 'INVALID_ISO_WEEK' };
    }
    if (typeof record.budget !== 'number' || !Number.isSafeInteger(record.budget) || record.budget < 0) {
        return { ok: false, reason: 'INVALID_ALLOCATION_AMOUNT' };
    }
    return {
        ok: true,
        ...month,
        key: `${keyFor(month.month, month.year, record.pocket)}:${record.isoWeekYear}-W${String(record.isoWeekNumber).padStart(2, '0')}`
    };
}

function transformWeeklyAllocations(state, source) {
    const seen = new Map();
    const validations = source.weeklyallocations.map(validWeeklyRecord);
    for (const [index, record] of source.weeklyallocations.entries()) {
        state.counts.scanned += 1;
        if (state.blockedSourceEntries.has(`weeklyallocations:${index}`)) continue;
        const validation = validations[index];
        if (!validation.ok) {
            addInvalid(state, 'weeklyallocations', record, validation.reason, 'weeklyAllocationPreservation');
            continue;
        }
        if (seen.has(validation.key)) {
            state.counts.duplicateAllocationKeys += 1;
            state.counts.unresolvableConflicts += 1;
            addInvalid(state, 'weeklyallocations', record, 'DUPLICATE_ALLOCATION_COMPOSITE_KEY', 'weeklyAllocationPreservation');
            continue;
        }
        seen.set(validation.key, record);
        state.requiredMonths.add(monthKey(validation.month, validation.year));
        state.counts.unchanged += 1;
    }
}

function addMissingCadences(state, source) {
    for (const [index, budget] of source.pocketbudgets.entries()) {
        if (state.blockedSourceEntries.has(`pocketbudgets:${index}`)) continue;
        const validation = validBudgetRecord(budget);
        if (!validation.ok || state.duplicateBudgetKeys.has(validation.key) || state.cadences.has(validation.key)) continue;
        const after = {
            _id: deterministicObjectId('pocketbudgetcadences', validation.key),
            pocket: validation.key.slice(validation.key.indexOf(':') + 1),
            month: validation.month,
            year: validation.year,
            cadence: 'Monthly',
            createdBy: budget.createdBy,
            updatedBy: budget.createdBy,
            version: 0
        };
        const id = `cadence:${validation.key}`;
        addItem(state, item({
            collectionName: 'pocketbudgetcadences', recordId: id, changeType: 'cadenceAssignment',
            before: {}, after, executable: true, source: budget
        }));
        state.requiredMonths.add(monthKey(validation.month, validation.year));
    }
}

function transformTransactions(state, source, timeZone, historicalApproved) {
    for (const [index, record] of source.transactions.entries()) {
        state.counts.scanned += 1;
        if (state.blockedSourceEntries.has(`transactions:${index}`)) continue;
        const pocketReason = validateTransactionRecord(record);
        if (pocketReason) {
            addInvalid(state, 'transactions', record, pocketReason, 'transactionValidation');
            continue;
        }
        let expenseDate;
        try {
            expenseDate = canonicalDateFromLegacy(record, timeZone);
        } catch {
            addInvalid(state, 'transactions', record, 'INVALID_EXPENSE_DATE', 'transactionCanonicalDate');
            continue;
        }
        const assignment = resolveBudgetMonth({ expenseDate, timeZone });
        state.requiredMonths.add(monthKey(assignment.month, assignment.year));
        const sourceId = recordId(record);
        if (record.expenseDate === undefined || record.schemaVersion !== 2) {
            const after = clone(record);
            after.expenseDate = expenseDate;
            after.schemaVersion = 2;
            const check = checkPreservation(record, after, 'transaction');
            addItem(state, item({
                collectionName: 'transactions', recordId: sourceId, changeType: 'transactionCanonicalDate',
                before: record, after, executable: check.ok,
                blockingReason: check.ok ? undefined : 'PRESERVATION_CHECK_FAILED', source: record
            }));
        }

        const assignmentChanged = !sameAssignment(record, assignment);
        const assignmentMetadataChanged = record.assignmentVersion !== 'salary-cycle-v1';
        if (assignmentChanged) {
            const after = clone(record);
            after.budgetMonth = assignment.month;
            after.budgetYear = assignment.year;
            after.assignmentVersion = 'salary-cycle-v1';
            after.schemaVersion = 2;
            const check = checkPreservation(record, after, 'transaction');
            addItem(state, item({
                collectionName: 'transactions', recordId: sourceId, changeType: 'transactionBudgetMonthChange',
                before: record, after,
                executable: check.ok && historicalApproved,
                blockingReason: !check.ok
                    ? 'PRESERVATION_CHECK_FAILED'
                    : historicalApproved ? undefined : 'HISTORICAL_REASSIGNMENT_APPROVAL_REQUIRED', source: record
            }));
        } else if (assignmentMetadataChanged) {
            const after = clone(record);
            after.assignmentVersion = 'salary-cycle-v1';
            after.schemaVersion = 2;
            const check = checkPreservation(record, after, 'transaction');
            addItem(state, item({
                collectionName: 'transactions', recordId: sourceId, changeType: 'transactionAssignmentMetadata',
                before: record, after, executable: check.ok,
                blockingReason: check.ok ? undefined : 'PRESERVATION_CHECK_FAILED', source: record
            }));
        }
        if (record.expenseDate !== undefined && record.schemaVersion === 2 &&
            sameAssignment(record, assignment) && !assignmentMetadataChanged) {
            state.counts.unchanged += 1;
        }
    }
}

function transformClosedMonths(state, source) {
    const seen = new Map();
    for (const [index, record] of source.closedmonths.entries()) {
        state.counts.scanned += 1;
        if (state.blockedSourceEntries.has(`closedmonths:${index}`)) continue;
        const validation = validClosedRecord(record);
        if (!validation.ok) {
            addInvalid(state, 'closedmonths', record, validation.reason, 'closedMonthPreservation');
            continue;
        }
        if (seen.has(validation.key)) {
            state.counts.duplicateAllocationKeys += 1;
            state.counts.unresolvableConflicts += 1;
            addInvalid(state, 'closedmonths', record, 'DUPLICATE_BUDGET_PERIOD_KEY', 'closedMonthPreservation');
            continue;
        }
        seen.set(validation.key, record);
        state.requiredMonths.add(validation.key);
        const after = clone(record);
        let changed = false;
        if (after.isClosed === undefined) { after.isClosed = true; changed = true; }
        if (after.closedAt === undefined) { after.closedAt = null; changed = true; }
        if (!Number.isInteger(after.mutationSequence) || after.mutationSequence < 0) {
            after.mutationSequence = 0; changed = true;
        }
        if (after.schemaVersion !== 2) { after.schemaVersion = 2; changed = true; }
        if (changed) {
            const check = checkPreservation(record, after, 'closedMonth');
            addItem(state, item({
                collectionName: 'closedmonths', recordId: recordId(record, `closed:${validation.key}`),
                changeType: 'closedMonthPreservation', before: record, after,
                executable: check.ok, blockingReason: check.ok ? undefined : 'PRESERVATION_CHECK_FAILED', source: record
            }));
        } else {
            state.counts.unchanged += 1;
        }
    }
}

function transformRequiredOpenGuards(state, source, inputMonths) {
    const existing = new Set();
    for (const record of source.closedmonths) {
        const validation = validClosedRecord(record);
        if (validation.ok) existing.add(validation.key);
    }
    for (const raw of inputMonths || []) {
        try {
            const parsed = typeof raw === 'string' ? parseBudgetMonth(raw) : parseBudgetMonth(
                raw.key || monthKey(raw.month, raw.year)
            );
            state.requiredMonths.add(parsed.key);
        } catch {
            state.counts.invalid += 1;
            state.blockers.push({ recordId: String(raw?.key || raw), blockingReason: 'INVALID_REQUIRED_BUDGET_MONTH' });
        }
    }
    for (const key of [...state.requiredMonths].sort()) {
        if (existing.has(key)) continue;
        const parsed = parseBudgetMonth(key);
        const after = {
            _id: deterministicObjectId('closedmonths', key),
            month: parsed.month,
            year: parsed.year,
            isClosed: false,
            closedAt: null,
            mutationSequence: 0,
            schemaVersion: 2
        };
        addItem(state, item({
            collectionName: 'closedmonths', recordId: `guard:${key}`, changeType: 'openBudgetGuard',
            before: {}, after, executable: true, source: after
        }));
    }
}

function sortItems(items, order = COLLECTION_ORDER) {
    const collectionRank = new Map(order.map((name, index) => [name, index]));
    return items.slice().sort((left, right) => {
        const rank = (collectionRank.get(left.collectionName) ?? 99) - (collectionRank.get(right.collectionName) ?? 99);
        if (rank) return rank;
        const id = left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0;
        if (id) return id;
        return left.changeType < right.changeType ? -1 : left.changeType > right.changeType ? 1 : 0;
    }).map((entry, index) => ({ ...entry, sequence: index + 1 }));
}

// ---------------------------------------------------------------------------
// pocket-management-v1 transform
//
// Converts the fixed POCKETS catalogue and existing budget/allocation/expense
// data into managed Pocket_Definitions and immutable per-Budget_Month
// Pocket_Assignments. The transform is a pure, order-independent planner: it
// only proposes preview items and never mutates the legacy allocation
// collections (those stay as compatibility projections). Execution, verify,
// rollback (task 8.2) and dual-read/write adapters (task 8.3) are separate.
// ---------------------------------------------------------------------------

const POCKET_COLLECTION_ORDER = [
    'pocketdefinitions',
    'pocketassignments',
    'transactions',
    'pocketbudgets',
    'pocketbudgetcadences',
    'weeklyallocations',
    'closedmonths'
];

// Every existing transaction field is preserved when a managed pocketId is
// associated; only pocketId (and each split share's pocketId) is added.
const POCKET_TRANSACTION_PRESERVED_FIELDS = [
    '_id', 'type', 'pocket', 'ngapain', 'by', 'paidBy', 'amount', 'date',
    'expenseDate', 'budgetMonth', 'budgetYear', 'assignmentVersion',
    'sourceType', 'schemaVersion', 'createdAt', 'updatedAt'
];

// The fixed catalogue is the authoritative source of a legacy pocket's display
// name and emoji. Two catalogue entries that normalize to the same comparison
// name are ambiguous and cannot be mapped to exactly one definition.
const LEGACY_POCKET_REGISTRY = (() => {
    const byNormalized = new Map();
    for (const [name, emoji] of Object.entries(POCKETS)) {
        const { normalizedName } = normalizePocketName(name);
        if (!byNormalized.has(normalizedName)) byNormalized.set(normalizedName, []);
        byNormalized.get(normalizedName).push({ name, emoji });
    }
    const registry = new Map();
    for (const [normalizedName, entries] of byNormalized) {
        const distinct = new Set(entries.map(entry => `${entry.name}\u0000${entry.emoji}`));
        registry.set(normalizedName, {
            normalizedName,
            name: entries[0].name,
            emoji: entries[0].emoji,
            ambiguous: distinct.size > 1
        });
    }
    return registry;
})();

function normalizedNameFor(pocketValue) {
    return normalizePocketName(typeof pocketValue === 'string' ? pocketValue : '').normalizedName;
}

// A deterministic, ObjectId-compatible identifier from a namespaced hash of the
// stable logical key, so the same value is produced across source order and
// reruns (Requirement 12.2).
function hashedObjectId(namespacedKey) {
    const digest = hashCanonical(namespacedKey).slice('sha256:'.length, 'sha256:'.length + 24);
    return new mongoose.Types.ObjectId(digest);
}

function pocketDefinitionId(normalizedName) {
    return hashedObjectId(`${POCKET_MANAGEMENT_MIGRATION_VERSION}:${normalizedName}`);
}

function pocketAssignmentDeterministicId(normalizedName, monthKeyValue) {
    return hashedObjectId(`${POCKET_MANAGEMENT_MIGRATION_VERSION}:assignment:${normalizedName}:${monthKeyValue}`);
}

function weekKeyFrom(isoWeekYear, isoWeekNumber) {
    return `${String(isoWeekYear).padStart(4, '0')}-W${String(isoWeekNumber).padStart(2, '0')}`;
}

function sameObjectId(left, right) {
    if (left === undefined || left === null || right === undefined || right === null) return false;
    return String(left) === String(right);
}

function pocketItem({ collectionName, recordId: id, changeType, before, after, executable = true, blockingReason, source, sourcePocket }) {
    const result = {
        collectionName,
        recordId: id,
        changeType,
        before: snapshot(before),
        after: snapshot(after),
        executable,
        sourceRecordFingerprint: sourceRecordFingerprint(source || before || after, collectionName)
    };
    if (blockingReason) result.blockingReason = blockingReason;
    if (sourcePocket !== undefined) result.sourcePocket = sourcePocket;
    return result;
}

function checkTransactionAssociationPreservation(before, after) {
    const violations = [];
    for (const path of POCKET_TRANSACTION_PRESERVED_FIELDS) {
        const previous = getPath(before, path);
        if (!previous.present) continue;
        const next = getPath(after, path);
        if (!next.present || !canonicalEqual(previous.value, next.value)) violations.push(path);
    }
    const beforeShares = Array.isArray(before?.sourceBreakdowns) ? before.sourceBreakdowns : [];
    const afterShares = Array.isArray(after?.sourceBreakdowns) ? after.sourceBreakdowns : [];
    if (beforeShares.length !== afterShares.length) {
        violations.push('sourceBreakdowns.length');
    } else {
        beforeShares.forEach((share, index) => {
            const target = afterShares[index] || {};
            for (const key of Object.keys(share || {})) {
                if (!canonicalEqual(share[key], target[key])) {
                    violations.push(`sourceBreakdowns.${index}.${key}`);
                }
            }
        });
    }
    return { ok: violations.length === 0, violations };
}

function resolveMigrationActor(input) {
    const raw = input.migrationActor ?? input.actor ?? input.actorId;
    if (raw && typeof raw.toHexString === 'function') return raw;
    if (raw && mongoose.isValidObjectId(raw)) return new mongoose.Types.ObjectId(raw);
    // A deterministic sentinel keeps the plan complete and stable before an
    // operator identity is wired in during execution (task 8.2).
    return hashedObjectId(`${POCKET_MANAGEMENT_MIGRATION_VERSION}:migration-actor`);
}

function readManagedRecords(input, aliases) {
    for (const alias of aliases) {
        if (Array.isArray(input[alias])) return input[alias];
    }
    return [];
}

function indexManagedById(records) {
    const map = new Map();
    for (const record of records) {
        if (record && record._id !== undefined && record._id !== null) {
            map.set(recordId(record), record);
        }
    }
    return map;
}

function definitionEquivalent(existing, proposed) {
    return Boolean(existing)
        && canonicalEqual(existing.normalizedName, proposed.normalizedName)
        && canonicalEqual(existing.name, proposed.name)
        && canonicalEqual(existing.emoji, proposed.emoji)
        && canonicalEqual(existing.cadence, proposed.cadence)
        && canonicalEqual(existing.defaultAmount, proposed.defaultAmount)
        && canonicalEqual(existing.status, proposed.status);
}

function addPocketItem(state, candidate) {
    state.items.push(candidate);
    state.counts.proposed += 1;
    state.counts.byChangeType[candidate.changeType] =
        (state.counts.byChangeType[candidate.changeType] || 0) + 1;
    if (!candidate.executable) state.blockers.push(candidate);
}

function addPocketBlocker(state, { collectionName, record, changeType, blockingReason, sourcePocket, fallbackId }) {
    state.counts.invalid += 1;
    addPocketItem(state, pocketItem({
        collectionName,
        recordId: recordId(record, fallbackId),
        changeType,
        before: record,
        after: record,
        executable: false,
        blockingReason,
        source: record,
        sourcePocket
    }));
}

// Determine the reusable definition cadence from the chronologically latest
// Budget_Month that carries cadence evidence. Exactly one value is accepted;
// conflicting values in that latest month block the whole pocket and every
// conflicting source record is reported (Requirements 12.3-12.5).
function resolveDefinitionCadence(cadenceEntries) {
    if (!cadenceEntries || cadenceEntries.length === 0) {
        return { cadence: 'Monthly' };
    }
    let latestKey = null;
    for (const entry of cadenceEntries) {
        const key = monthKey(entry.month, entry.year);
        if (latestKey === null || key > latestKey) latestKey = key;
    }
    const inLatest = cadenceEntries.filter(entry => monthKey(entry.month, entry.year) === latestKey);
    const distinct = new Set(inLatest.map(entry => entry.cadence));
    if (distinct.size > 1) {
        return { conflict: true, conflictMonthKey: latestKey };
    }
    return { cadence: inLatest[0].cadence };
}

function bucketMonth(map, normalizedName, key) {
    if (!map.has(normalizedName)) map.set(normalizedName, new Map());
    const inner = map.get(normalizedName);
    if (!inner.has(key)) inner.set(key, []);
    return inner.get(key);
}

function markRepresented(state, normalizedName, key) {
    if (!state.representedMonths.has(normalizedName)) state.representedMonths.set(normalizedName, new Set());
    state.representedMonths.get(normalizedName).add(key);
}

// Validate, deduplicate, and bucket every legacy allocation record. Invalid and
// duplicate-composite-key records are reported as blockers here; valid records
// are grouped by normalized pocket and Budget_Month for later assignment
// planning. The bucketing is keyed, never index-based, so shuffled sources
// produce identical groups.
function bucketLegacyAllocations(state, source) {
    const budgetValidations = source.pocketbudgets.map(validBudgetRecord);
    const budgetKeyCounts = new Map();
    for (const validation of budgetValidations) {
        if (validation.ok) budgetKeyCounts.set(validation.key, (budgetKeyCounts.get(validation.key) || 0) + 1);
    }
    source.pocketbudgets.forEach((record, index) => {
        state.counts.scanned += 1;
        if (state.blockedSourceEntries.has(`pocketbudgets:${index}`)) return;
        const validation = budgetValidations[index];
        if (!validation.ok) {
            addPocketBlocker(state, {
                collectionName: 'pocketbudgets', record, changeType: 'pocketAssignmentCreation',
                blockingReason: validation.reason, sourcePocket: record.pocket
            });
            return;
        }
        if (budgetKeyCounts.get(validation.key) > 1) {
            state.counts.duplicateAllocationKeys += 1;
            state.counts.unresolvableConflicts += 1;
            addPocketBlocker(state, {
                collectionName: 'pocketbudgets', record, changeType: 'pocketAssignmentCreation',
                blockingReason: 'DUPLICATE_ALLOCATION_COMPOSITE_KEY', sourcePocket: record.pocket
            });
            return;
        }
        const normalizedName = normalizedNameFor(record.pocket);
        const key = monthKey(validation.month, validation.year);
        state.budgets.set(`${normalizedName}:${key}`, { record, amount: record.budget, month: validation.month, year: validation.year });
        markRepresented(state, normalizedName, key);
    });

    // Cadence records are deliberately NOT pre-blocked on duplicate composite
    // keys: multiple cadence rows for one pocket/month are exactly the
    // "conflicting cadence values" signal (Requirement 12.4). Every valid
    // cadence record flows into resolution; a genuine value disagreement is
    // detected and reported later as a cadence conflict.
    source.pocketbudgetcadences.forEach((record, index) => {
        state.counts.scanned += 1;
        if (state.blockedSourceEntries.has(`pocketbudgetcadences:${index}`)) return;
        const validation = validCadenceRecord(record);
        if (!validation.ok) {
            addPocketBlocker(state, {
                collectionName: 'pocketbudgetcadences', record, changeType: 'pocketAssignmentCreation',
                blockingReason: validation.reason, sourcePocket: record.pocket
            });
            return;
        }
        const normalizedName = normalizedNameFor(record.pocket);
        const key = monthKey(validation.month, validation.year);
        bucketMonth(state.cadences, normalizedName, key).push({ record, cadence: record.cadence });
        if (!state.cadenceEntriesByPocket.has(normalizedName)) state.cadenceEntriesByPocket.set(normalizedName, []);
        state.cadenceEntriesByPocket.get(normalizedName).push({ record, month: validation.month, year: validation.year, cadence: record.cadence });
        markRepresented(state, normalizedName, key);
    });

    const weeklyValidations = source.weeklyallocations.map(validWeeklyRecord);
    const weeklyKeyCounts = new Map();
    for (const validation of weeklyValidations) {
        if (validation.ok) weeklyKeyCounts.set(validation.key, (weeklyKeyCounts.get(validation.key) || 0) + 1);
    }
    source.weeklyallocations.forEach((record, index) => {
        state.counts.scanned += 1;
        if (state.blockedSourceEntries.has(`weeklyallocations:${index}`)) return;
        const validation = weeklyValidations[index];
        if (!validation.ok) {
            addPocketBlocker(state, {
                collectionName: 'weeklyallocations', record, changeType: 'pocketAssignmentCreation',
                blockingReason: validation.reason, sourcePocket: record.pocket
            });
            return;
        }
        if (weeklyKeyCounts.get(validation.key) > 1) {
            state.counts.duplicateAllocationKeys += 1;
            state.counts.unresolvableConflicts += 1;
            addPocketBlocker(state, {
                collectionName: 'weeklyallocations', record, changeType: 'pocketAssignmentCreation',
                blockingReason: 'DUPLICATE_ALLOCATION_COMPOSITE_KEY', sourcePocket: record.pocket
            });
            return;
        }
        const normalizedName = normalizedNameFor(record.pocket);
        const key = monthKey(validation.month, validation.year);
        bucketMonth(state.weeklies, normalizedName, key).push({
            record,
            weekKey: weekKeyFrom(record.isoWeekYear, record.isoWeekNumber),
            isoWeekYear: record.isoWeekYear,
            isoWeekNumber: record.isoWeekNumber,
            amount: record.budget
        });
        markRepresented(state, normalizedName, key);
    });
}

function emitPocketDefinitions(state, migrationActor, existingDefinitionById) {
    for (const [normalizedName, entry] of LEGACY_POCKET_REGISTRY) {
        if (entry.ambiguous) {
            state.blockedPockets.set(normalizedName, { reason: 'POCKET_DEFINITION_AMBIGUOUS' });
            continue;
        }
        const resolution = resolveDefinitionCadence(state.cadenceEntriesByPocket.get(normalizedName));
        if (resolution.conflict) {
            state.blockedPockets.set(normalizedName, {
                reason: 'CADENCE_CONFLICT',
                conflictMonthKey: resolution.conflictMonthKey
            });
            continue;
        }
        state.definitionCadence.set(normalizedName, resolution.cadence);

        const definition = {
            _id: pocketDefinitionId(normalizedName),
            name: entry.name,
            normalizedName,
            emoji: entry.emoji,
            cadence: resolution.cadence,
            defaultAmount: 0,
            status: 'Active',
            createdBy: migrationActor,
            updatedBy: migrationActor,
            version: 1,
            schemaVersion: 1
        };
        const existing = existingDefinitionById.get(recordId(definition));
        if (definitionEquivalent(existing, definition)) {
            state.counts.unchanged += 1;
            continue;
        }
        addPocketItem(state, pocketItem({
            collectionName: 'pocketdefinitions',
            recordId: recordId(definition),
            changeType: 'pocketDefinitionCreation',
            before: {},
            after: definition,
            executable: true,
            source: definition,
            sourcePocket: entry.name
        }));
    }
}

function assignmentAudit(sourceRecord, migrationActor) {
    const audit = {
        createdBy: (sourceRecord && sourceRecord.createdBy) || migrationActor,
        updatedBy: (sourceRecord && (sourceRecord.updatedBy || sourceRecord.createdBy)) || migrationActor
    };
    if (sourceRecord && sourceRecord.createdAt !== undefined) audit.createdAt = sourceRecord.createdAt;
    if (sourceRecord && sourceRecord.updatedAt !== undefined) audit.updatedAt = sourceRecord.updatedAt;
    return audit;
}

function emitPocketAssignments(state, migrationActor, existingAssignmentById) {
    for (const [normalizedName, cadence] of state.definitionCadence) {
        const entry = LEGACY_POCKET_REGISTRY.get(normalizedName);
        const months = state.representedMonths.get(normalizedName);
        if (!months) continue;

        for (const key of [...months].sort()) {
            const budget = state.budgets.get(`${normalizedName}:${key}`);
            const cadenceEntries = (state.cadences.get(normalizedName) || new Map()).get(key) || [];
            const weeklyEntries = (state.weeklies.get(normalizedName) || new Map()).get(key) || [];
            const cadenceValues = new Set(cadenceEntries.map(item => item.cadence));
            const hasMonthly = Boolean(budget);
            const hasWeekly = weeklyEntries.length > 0;
            const involved = [
                ...(budget ? [{ collectionName: 'pocketbudgets', record: budget.record }] : []),
                ...cadenceEntries.map(item => ({ collectionName: 'pocketbudgetcadences', record: item.record })),
                ...weeklyEntries.map(item => ({ collectionName: 'weeklyallocations', record: item.record }))
            ];

            const blockMonth = (blockingReason) => {
                for (const { collectionName, record } of involved) {
                    addPocketBlocker(state, {
                        collectionName, record, changeType: 'pocketAssignmentCreation',
                        blockingReason, sourcePocket: record.pocket
                    });
                }
            };

            let periodCadence;
            if (cadenceValues.size > 1) {
                blockMonth('PERIOD_CADENCE_CONFLICT');
                continue;
            } else if (cadenceValues.size === 1) {
                periodCadence = [...cadenceValues][0];
            } else if (hasMonthly && hasWeekly) {
                blockMonth('PERIOD_CADENCE_AMBIGUOUS');
                continue;
            } else if (hasWeekly) {
                periodCadence = 'Weekly';
            } else {
                periodCadence = 'Monthly';
            }

            let allocations;
            let auditSource;
            if (periodCadence === 'Monthly') {
                allocations = [{ kind: 'Monthly', key: 'monthly', amount: hasMonthly ? budget.amount : 0 }];
                auditSource = (budget && budget.record) || (cadenceEntries[0] && cadenceEntries[0].record);
            } else {
                if (!hasWeekly) {
                    // A Weekly period with no weekly allocation rows cannot form a
                    // complete canonical set; report the evidence and skip it.
                    blockMonth('WEEKLY_ALLOCATIONS_MISSING');
                    continue;
                }
                allocations = weeklyEntries
                    .map(item => ({
                        kind: 'Weekly',
                        key: item.weekKey,
                        isoWeekYear: item.isoWeekYear,
                        isoWeekNumber: item.isoWeekNumber,
                        amount: item.amount
                    }))
                    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
                auditSource = (cadenceEntries[0] && cadenceEntries[0].record)
                    || weeklyEntries[0].record
                    || (budget && budget.record);
            }

            const [year, month] = key.split('-').map(Number);
            const audit = assignmentAudit(auditSource, migrationActor);
            const assignment = {
                _id: pocketAssignmentDeterministicId(normalizedName, key),
                pocketId: pocketDefinitionId(normalizedName),
                budgetMonth: month,
                budgetYear: year,
                pocketNameSnapshot: entry.name,
                pocketNormalizedNameSnapshot: normalizedName,
                pocketEmojiSnapshot: entry.emoji,
                cadenceSnapshot: periodCadence,
                amountMode: 'Customize',
                definitionVersion: 1,
                allocations,
                createdBy: audit.createdBy,
                updatedBy: audit.updatedBy,
                version: 1,
                schemaVersion: 1
            };
            if (audit.createdAt !== undefined) assignment.createdAt = audit.createdAt;
            if (audit.updatedAt !== undefined) assignment.updatedAt = audit.updatedAt;

            // Every legacy allocation record for the month is preserved (never
            // mutated); it is counted as unchanged because the managed
            // association lives in the new assignment document.
            state.counts.unchanged += involved.length;

            const existing = existingAssignmentById.get(recordId(assignment));
            if (existing && canonicalAssignmentSignature(existing) === canonicalAssignmentSignature(assignment)) {
                continue;
            }
            addPocketItem(state, pocketItem({
                collectionName: 'pocketassignments',
                recordId: recordId(assignment),
                changeType: 'pocketAssignmentCreation',
                before: {},
                after: assignment,
                executable: true,
                source: assignment,
                sourcePocket: entry.name
            }));
        }
    }
}

// Every bucketed legacy record for a blocked pocket is retained and reported so
// nothing is silently dropped, while unambiguous pockets still migrate.
function emitBlockedPocketRecords(state) {
    for (const [normalizedName, blocked] of state.blockedPockets) {
        const months = state.representedMonths.get(normalizedName);
        if (!months) continue;
        for (const key of [...months].sort()) {
            const budget = state.budgets.get(`${normalizedName}:${key}`);
            if (budget) {
                addPocketBlocker(state, {
                    collectionName: 'pocketbudgets', record: budget.record,
                    changeType: 'pocketAssignmentCreation',
                    blockingReason: 'POCKET_DEFINITION_BLOCKED', sourcePocket: budget.record.pocket
                });
            }
            for (const item of (state.cadences.get(normalizedName) || new Map()).get(key) || []) {
                const reason = blocked.reason === 'CADENCE_CONFLICT' && key === blocked.conflictMonthKey
                    ? 'CADENCE_CONFLICT'
                    : blocked.reason === 'POCKET_DEFINITION_AMBIGUOUS'
                        ? 'POCKET_DEFINITION_AMBIGUOUS'
                        : 'POCKET_DEFINITION_BLOCKED';
                addPocketBlocker(state, {
                    collectionName: 'pocketbudgetcadences', record: item.record,
                    changeType: 'pocketAssignmentCreation', blockingReason: reason, sourcePocket: item.record.pocket
                });
            }
            for (const item of (state.weeklies.get(normalizedName) || new Map()).get(key) || []) {
                addPocketBlocker(state, {
                    collectionName: 'weeklyallocations', record: item.record,
                    changeType: 'pocketAssignmentCreation',
                    blockingReason: blocked.reason === 'POCKET_DEFINITION_AMBIGUOUS'
                        ? 'POCKET_DEFINITION_AMBIGUOUS'
                        : 'POCKET_DEFINITION_BLOCKED',
                    sourcePocket: item.record.pocket
                });
            }
        }
    }
}

function definitionIdForPocket(state, normalizedName) {
    if (!LEGACY_POCKET_REGISTRY.has(normalizedName)) return null;
    if (state.blockedPockets.has(normalizedName)) return null;
    return pocketDefinitionId(normalizedName);
}

// Associate each valid expense (and every split share) with its deterministic
// pocketId while preserving every existing financial, date, payer, note, and
// audit field. A reference to an unmappable or blocked pocket blocks only that
// expense (Requirements 12.9-12.10, 12.13-12.14).
function transformPocketTransactions(state, source) {
    for (const [index, record] of source.transactions.entries()) {
        state.counts.scanned += 1;
        if (state.blockedSourceEntries.has(`transactions:${index}`)) continue;
        const reason = validateTransactionRecord(record);
        if (reason) {
            addPocketBlocker(state, {
                collectionName: 'transactions', record, changeType: 'transactionPocketAssociation',
                blockingReason: reason, sourcePocket: record.pocket
            });
            continue;
        }

        const isMulti = record.sourceType === 'multi' ||
            (Array.isArray(record.sourceBreakdowns) && record.sourceBreakdowns.length > 0 && record.sourceType !== 'single');

        if (!isMulti) {
            const normalizedName = normalizedNameFor(record.pocket);
            const target = definitionIdForPocket(state, normalizedName);
            if (!target) {
                addPocketBlocker(state, {
                    collectionName: 'transactions', record, changeType: 'transactionPocketAssociation',
                    blockingReason: 'POCKET_NOT_MAPPED', sourcePocket: record.pocket
                });
                continue;
            }
            if (record.pocketId !== undefined && record.pocketId !== null) {
                if (sameObjectId(record.pocketId, target)) {
                    state.counts.unchanged += 1;
                } else {
                    addPocketBlocker(state, {
                        collectionName: 'transactions', record, changeType: 'transactionPocketAssociation',
                        blockingReason: 'POCKET_ASSOCIATION_CONFLICT', sourcePocket: record.pocket
                    });
                }
                continue;
            }
            const after = clone(record);
            after.pocketId = target;
            const check = checkTransactionAssociationPreservation(record, after);
            addPocketItem(state, pocketItem({
                collectionName: 'transactions', recordId: recordId(record),
                changeType: 'transactionPocketAssociation', before: record, after,
                executable: check.ok,
                blockingReason: check.ok ? undefined : 'PRESERVATION_CHECK_FAILED',
                source: record, sourcePocket: record.pocket
            }));
            continue;
        }

        const shares = Array.isArray(record.sourceBreakdowns) ? record.sourceBreakdowns : [];
        const targets = shares.map(share => definitionIdForPocket(state, normalizedNameFor(share.pocket)));
        if (targets.some(target => !target)) {
            addPocketBlocker(state, {
                collectionName: 'transactions', record, changeType: 'transactionPocketAssociation',
                blockingReason: 'POCKET_NOT_MAPPED', sourcePocket: record.pocket
            });
            continue;
        }

        let conflict = false;
        let changed = false;
        const after = clone(record);
        after.sourceBreakdowns = shares.map((share, position) => {
            const nextShare = clone(share);
            const target = targets[position];
            if (nextShare.pocketId !== undefined && nextShare.pocketId !== null) {
                if (!sameObjectId(nextShare.pocketId, target)) conflict = true;
            } else {
                nextShare.pocketId = target;
                changed = true;
            }
            return nextShare;
        });

        if (conflict) {
            addPocketBlocker(state, {
                collectionName: 'transactions', record, changeType: 'transactionPocketAssociation',
                blockingReason: 'POCKET_ASSOCIATION_CONFLICT', sourcePocket: record.pocket
            });
            continue;
        }
        if (!changed) {
            state.counts.unchanged += 1;
            continue;
        }
        const check = checkTransactionAssociationPreservation(record, after);
        addPocketItem(state, pocketItem({
            collectionName: 'transactions', recordId: recordId(record),
            changeType: 'transactionPocketAssociation', before: record, after,
            executable: check.ok,
            blockingReason: check.ok ? undefined : 'PRESERVATION_CHECK_FAILED',
            source: record, sourcePocket: record.pocket
        }));
    }
}

function createPocketManagementPreview(input = {}) {
    const timeZone = validateTimeZone(input.timeZone || DEFAULT_HOUSEHOLD_TIME_ZONE);
    const migrationVersion = POCKET_MANAGEMENT_MIGRATION_VERSION;
    const records = normalizeSourceRecords(input.sources || input);
    const source = {
        pocketbudgets: [], pocketbudgetcadences: [], weeklyallocations: [], transactions: [], closedmonths: []
    };
    for (const entry of records) {
        // Closed months are not part of the managed pocket association plan.
        if (entry.collectionName !== 'closedmonths' && source[entry.collectionName]) {
            source[entry.collectionName].push(entry.record);
        }
    }

    const migrationActor = resolveMigrationActor(input);
    const existingDefinitionById = indexManagedById(
        readManagedRecords(input, ['pocketDefinitions', 'pocketdefinitions'])
    );
    const existingAssignmentById = indexManagedById(
        readManagedRecords(input, ['pocketAssignments', 'pocketassignments'])
    );

    const state = {
        items: [],
        blockers: [],
        budgets: new Map(),
        cadences: new Map(),
        weeklies: new Map(),
        cadenceEntriesByPocket: new Map(),
        representedMonths: new Map(),
        blockedPockets: new Map(),
        definitionCadence: new Map(),
        counts: {
            scanned: 0, unchanged: 0, proposed: 0, invalid: 0,
            duplicateAllocationKeys: 0, unresolvableConflicts: 0, byChangeType: {}
        }
    };

    const sourceFingerprint = createSourceFingerprint({ records, timeZone, migrationVersion });

    markSourceIdentityIssues(state, source);
    bucketLegacyAllocations(state, source);
    emitPocketDefinitions(state, migrationActor, existingDefinitionById);
    emitPocketAssignments(state, migrationActor, existingAssignmentById);
    emitBlockedPocketRecords(state);
    transformPocketTransactions(state, source);

    const items = sortItems(state.items, POCKET_COLLECTION_ORDER);
    const executableItems = items.filter(entry => entry.executable);
    const blockers = items.filter(entry => !entry.executable);
    return {
        migrationVersion,
        timeZone,
        sourceFingerprint,
        items,
        executableItems,
        blockers,
        unchangedCount: state.counts.unchanged,
        counts: {
            ...state.counts,
            byChangeType: Object.fromEntries(Object.entries(state.counts.byChangeType).sort())
        }
    };
}

function createMigrationPreview(input = {}) {
    const requestedVersion = input.migrationVersion || DEFAULT_MIGRATION_VERSION;
    if (typeof requestedVersion !== 'string' || requestedVersion.trim() === '') {
        throw new TypeError('migrationVersion must be a non-empty string.');
    }
    // The controlled migration lifecycle selects a transform by its version.
    // pocket-management-v1 replaces the fixed POCKETS catalogue with managed
    // Pocket_Definitions and per-Budget_Month Pocket_Assignments; every other
    // version keeps the established salary-cycle canonicalization transform.
    if (requestedVersion.trim() === POCKET_MANAGEMENT_MIGRATION_VERSION) {
        return createPocketManagementPreview(input);
    }

    const timeZone = validateTimeZone(input.timeZone || DEFAULT_HOUSEHOLD_TIME_ZONE);
    const migrationVersion = requestedVersion;
    const records = normalizeSourceRecords(input.sources || input);
    const source = {
        pocketbudgets: [], pocketbudgetcadences: [], weeklyallocations: [], transactions: [], closedmonths: []
    };
    for (const entry of records) if (source[entry.collectionName]) source[entry.collectionName].push(entry.record);

    const state = {
        items: [], blockers: [], requiredMonths: new Set(), cadences: new Map(),
        duplicateBudgetKeys: new Set(),
        counts: {
            scanned: 0, unchanged: 0, proposed: 0, invalid: 0,
            duplicateAllocationKeys: 0, unresolvableConflicts: 0, byChangeType: {}
        }
    };
    const sourceFingerprint = createSourceFingerprint({
        records, timeZone, migrationVersion: migrationVersion.trim()
    });

    markSourceIdentityIssues(state, source);
    transformCadences(state, source);
    transformWeeklyAllocations(state, source);
    const budgetValidation = source.pocketbudgets.map(validBudgetRecord);
    const budgetCounts = new Map();
    for (const result of budgetValidation) if (result.ok) budgetCounts.set(result.key, (budgetCounts.get(result.key) || 0) + 1);
    state.duplicateBudgetKeys = new Set([...budgetCounts].filter(([, count]) => count > 1).map(([key]) => key));
    transformBudgets(state, source);
    addMissingCadences(state, source);
    transformTransactions(
        state,
        source,
        timeZone,
        input.historicalReassignmentApproved === true || input.approveHistoricalReassignment === true
    );
    transformClosedMonths(state, source);
    transformRequiredOpenGuards(state, source, input.requiredBudgetMonths);

    const items = sortItems(state.items);
    const executableItems = items.filter(entry => entry.executable);
    const blockers = items.filter(entry => !entry.executable);
    return {
        migrationVersion: migrationVersion.trim(),
        timeZone,
        sourceFingerprint,
        items,
        executableItems,
        blockers,
        unchangedCount: state.counts.unchanged,
        counts: {
            ...state.counts,
            byChangeType: Object.fromEntries(Object.entries(state.counts.byChangeType).sort())
        }
    };
}

function getPath(value, path) {
    let current = value;
    for (const segment of path.split('.')) {
        if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(current, segment)) {
            return { present: false };
        }
        current = current[segment];
    }
    return { present: true, value: current };
}

function checkPreservation(before, after, kind) {
    const violations = [];
    for (const path of PRESERVED_FIELDS[kind] || []) {
        const previous = getPath(before, path);
        if (!previous.present) continue;
        const next = getPath(after, path);
        if (!next.present || !canonicalEqual(previous.value, next.value)) violations.push(path);
    }
    return { ok: violations.length === 0, violations };
}

function decodeCanonical(value) {
    if (Array.isArray(value)) return value.map(decodeCanonical);
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1) {
        if (value.$undefined) return undefined;
        if (value.$date) return new Date(value.$date);
        if (value.$oid) return value.$oid;
        if (value.$numberLong) return BigInt(value.$numberLong);
        if (value.$numberDouble) {
            if (value.$numberDouble === 'NaN') return NaN;
            if (value.$numberDouble === 'Infinity') return Infinity;
            if (value.$numberDouble === '-Infinity') return -Infinity;
            if (value.$numberDouble === '-0.0') return -0;
        }
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) result[key] = decodeCanonical(entry);
    return result;
}

function changedTopLevelFields(beforeSnapshot, afterSnapshot) {
    const before = decodeCanonical(beforeSnapshot);
    const after = decodeCanonical(afterSnapshot);
    const patch = {};
    for (const [key, value] of Object.entries(after)) {
        if (!Object.prototype.hasOwnProperty.call(before, key) || !canonicalEqual(before[key], value)) {
            patch[key] = value;
        }
    }
    return patch;
}

/** Apply only executable preview items to an in-memory source snapshot. */
function applyMigrationItems(input, items = []) {
    const output = {};
    const aliases = {
        pocketbudgets: 'pocketBudgets',
        pocketbudgetcadences: 'pocketBudgetCadences',
        weeklyallocations: 'weeklyAllocations',
        transactions: 'transactions',
        closedmonths: 'closedMonths'
    };
    for (const [collectionName, property] of Object.entries(aliases)) {
        const value = input[property] || input[collectionName] || [];
        output[property] = value.map(clone);
    }
    for (const previewItem of items.filter(entry => entry.executable !== false)) {
        const property = aliases[previewItem.collectionName];
        if (!property) continue;
        const records = output[property];
        const index = records.findIndex(record => recordId(record) === previewItem.recordId);
        const patch = changedTopLevelFields(previewItem.before, previewItem.after);
        if (index >= 0) {
            // Multiple proposals may target one record. Apply only fields that
            // changed in this proposal, rather than replaying its stale full
            // before/after snapshot over a prior approved proposal.
            records[index] = { ...records[index], ...patch };
        } else records.push({ ...patch });
    }
    return output;
}

module.exports = {
    COLLECTION_ORDER,
    POCKET_COLLECTION_ORDER,
    DEFAULT_MIGRATION_VERSION,
    POCKET_MANAGEMENT_MIGRATION_VERSION,
    PRESERVED_FIELDS,
    POCKET_TRANSACTION_PRESERVED_FIELDS,
    applyMigrationItems,
    checkPreservation,
    checkTransactionAssociationPreservation,
    createMigrationPreview,
    createPocketManagementPreview,
    buildMigrationPreview: createMigrationPreview,
    generateMigrationPreview: createMigrationPreview,
    decodeCanonical,
    pocketDefinitionId,
    pocketAssignmentDeterministicId,
    snapshot,
    transformLegacyData: createMigrationPreview,
    validateTransactionRecord,
    validBudgetRecord,
    validCadenceRecord,
    validClosedRecord,
    validWeeklyRecord
};
