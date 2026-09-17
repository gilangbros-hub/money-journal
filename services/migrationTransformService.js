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

const DEFAULT_MIGRATION_VERSION = 'salary-cycle-v1';
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

function sortItems(items) {
    const collectionRank = new Map(COLLECTION_ORDER.map((name, index) => [name, index]));
    return items.slice().sort((left, right) => {
        const rank = (collectionRank.get(left.collectionName) ?? 99) - (collectionRank.get(right.collectionName) ?? 99);
        if (rank) return rank;
        const id = left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0;
        if (id) return id;
        return left.changeType < right.changeType ? -1 : left.changeType > right.changeType ? 1 : 0;
    }).map((entry, index) => ({ ...entry, sequence: index + 1 }));
}

function createMigrationPreview(input = {}) {
    const timeZone = validateTimeZone(input.timeZone || DEFAULT_HOUSEHOLD_TIME_ZONE);
    const migrationVersion = input.migrationVersion || DEFAULT_MIGRATION_VERSION;
    if (typeof migrationVersion !== 'string' || migrationVersion.trim() === '') {
        throw new TypeError('migrationVersion must be a non-empty string.');
    }
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
    DEFAULT_MIGRATION_VERSION,
    PRESERVED_FIELDS,
    applyMigrationItems,
    checkPreservation,
    createMigrationPreview,
    buildMigrationPreview: createMigrationPreview,
    generateMigrationPreview: createMigrationPreview,
    decodeCanonical,
    snapshot,
    transformLegacyData: createMigrationPreview,
    validateTransactionRecord,
    validBudgetRecord,
    validCadenceRecord,
    validClosedRecord,
    validWeeklyRecord
};
