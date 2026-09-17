'use strict';

const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const ClosedMonth = require('../models/closedMonth');
const PocketAssignment = require('../models/pocketAssignment');
const { formatCurrency } = require('../utils/formatters');
const { TRANSACTION_TYPES } = require('../utils/constants');
const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    getSalaryCyclePeriod,
    parseBudgetMonth,
    resolveBudgetMonth
} = require('./salaryCycleResolver');
const {
    withOpenBudgetPeriods
} = require('./budgetPeriodGuard');
const {
    toCanonicalTransactionInput,
    toTransactionDto
} = require('../utils/transactionDto');
const {
    validateIdentifier,
    validateExpenseDate
} = require('../utils/transactionValidators');
const {
    AuthenticationError,
    AssignmentConflictError,
    DomainValidationError,
    PocketValidationError,
    RecordNotFoundError
} = require('../utils/domainErrors');
const { isSalaryCycleEnabled, isPocketManagementEnabled } = require('../utils/rollout');
const { isDualReadActive, resolveTracker } = require('./pocketCompatibility');

/**
 * Aggregates transactions by category for the dashboard.
 * @param {Array} transactions - List of transaction objects.
 * @returns {Array} Sorted array of category summaries.
 */
const getCategoryBreakdown = (transactions) => {
    if (!transactions || transactions.length === 0) return [];

    const totalStats = transactions.reduce((acc, t) => {
        const type = t.type || 'Others';
        const amount = t.amount || 0;

        acc.totalSpent += amount;

        if (!acc.byCategory[type]) acc.byCategory[type] = 0;
        acc.byCategory[type] += amount;

        return acc;
    }, { totalSpent: 0, byCategory: {} });

    return Object.entries(totalStats.byCategory)
        .map(([type, amount]) => ({
            category: type,
            icon: TRANSACTION_TYPES[type] || '📦',
            total: amount,
            formattedTotal: formatCurrency(amount),
            percentage: totalStats.totalSpent > 0
                ? Math.round((amount / totalStats.totalSpent) * 100)
                : 0
        }))
        .sort((a, b) => b.total - a.total);
};

/**
 * Aggregates transactions by paidBy role.
 * @param {Array} transactions
 * @returns {Array} [{ role: 'Husband', total: 1000, percentage: 50 }, ...]
 */
const getRoleBreakdown = (transactions) => {
    if (!transactions || transactions.length === 0) return [];

    const totalSpent = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const roleStats = transactions.reduce((acc, t) => {
        const role = t.paidBy || 'Self';
        acc[role] = (acc[role] || 0) + (t.amount || 0);
        return acc;
    }, {});

    return ['Husband', 'Wife', 'Self']
        .map(role => {
            const amount = roleStats[role] || 0;
            return {
                role,
                total: amount,
                formattedTotal: formatCurrency(amount),
                percentage: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0
            };
        })
        .filter(r => r.total > 0 || roleStats[r.role] !== undefined);
};

/**
 * calculateTotalExpenses
 * @param {Array} transactions
 * @returns {Object} { raw: number, formatted: string }
 */
const calculateTotalExpenses = (transactions) => {
    const total = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    return { raw: total, formatted: formatCurrency(total) };
};

function executeQuery(query) {
    return typeof query?.exec === 'function' ? query.exec() : query;
}

function withSession(query, session) {
    return typeof query?.session === 'function' ? query.session(session) : query;
}

function getOption(options, actor, name, fallback) {
    return options?.[name] ?? actor?.[name] ?? fallback;
}

function actorIdFor(actor) {
    const value = actor && typeof actor === 'object'
        ? (actor.userId ?? actor.id ?? actor._id)
        : actor;

    if (value === undefined || value === null) throw new AuthenticationError();
    return validateIdentifier(value, 'by');
}

function normalizeLegacyAssignment(value, field) {
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
            throw new DomainValidationError(field, `${field} must be an integer.`);
        }
        return value;
    }

    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) return parsed;
    }

    throw new DomainValidationError(field, `${field} must be an integer.`);
}

function assertMatchingAssignment(command, derived) {
    const hasMonth = Object.prototype.hasOwnProperty.call(command, 'budgetMonth') &&
        command.budgetMonth !== undefined;
    const hasYear = Object.prototype.hasOwnProperty.call(command, 'budgetYear') &&
        command.budgetYear !== undefined;
    if (!hasMonth && !hasYear) return;

    const month = hasMonth
        ? normalizeLegacyAssignment(command.budgetMonth, 'budgetMonth')
        : derived.month;
    const year = hasYear
        ? normalizeLegacyAssignment(command.budgetYear, 'budgetYear')
        : derived.year;

    if (month !== derived.month || year !== derived.year) {
        throw new AssignmentConflictError(derived.key, derived.month, derived.year);
    }
}

function assignmentPeriod(record, timeZone) {
    if (Number.isInteger(record?.budgetMonth) && Number.isInteger(record?.budgetYear)) {
        return { month: record.budgetMonth, year: record.budgetYear };
    }

    const date = record?.expenseDate;
    if (date) {
        const derived = resolveBudgetMonth({ expenseDate: date, timeZone });
        return { month: derived.month, year: derived.year };
    }

    throw new DomainValidationError('budgetMonth', 'Stored transaction has no Budget Month assignment.');
}

function commandInput(command, existing) {
    if (!existing) return { ...(command || {}) };

    // Updates are full transaction replacements from the existing form, but
    // accepting a partial command here makes the service safe for future API
    // clients without allowing the old assignment to override derivation.
    const record = typeof existing.toObject === 'function' ? existing.toObject() : { ...existing };
    const merged = { ...record, ...(command || {}) };
    delete merged.budgetMonth;
    delete merged.budgetYear;
    return merged;
}

function ensureCanonicalAssignment(command, mapped, timeZone, {
    enabled = true,
    fallbackAssignment
} = {}) {
    const derived = resolveBudgetMonth({ expenseDate: mapped.expenseDate, timeZone });

    if (enabled) {
        assertMatchingAssignment(command, derived);
    }

    const hasMonth = Object.prototype.hasOwnProperty.call(command || {}, 'budgetMonth') &&
        command.budgetMonth !== undefined;
    const hasYear = Object.prototype.hasOwnProperty.call(command || {}, 'budgetYear') &&
        command.budgetYear !== undefined;
    let assignment = derived;

    // During the compatibility window, old clients remain authoritative for
    // the legacy numeric assignment. A missing assignment still gets a safe
    // derived value because schema-v2 requires both fields to be stored.
    if (!enabled && (hasMonth || hasYear)) {
        assignment = {
            month: hasMonth ? normalizeLegacyAssignment(command.budgetMonth, 'budgetMonth') : (fallbackAssignment?.month ?? derived.month),
            year: hasYear ? normalizeLegacyAssignment(command.budgetYear, 'budgetYear') : (fallbackAssignment?.year ?? derived.year)
        };
        assignment.key = `${String(assignment.year).padStart(4, '0')}-${String(assignment.month).padStart(2, '0')}`;
    } else if (!enabled && fallbackAssignment && !hasMonth && !hasYear) {
        assignment = {
            ...fallbackAssignment,
            key: `${String(fallbackAssignment.year).padStart(4, '0')}-${String(fallbackAssignment.month).padStart(2, '0')}`
        };
    }

    return {
        ...mapped,
        budgetMonth: assignment.month,
        budgetYear: assignment.year,
        assignmentVersion: enabled ? 'salary-cycle-v1' : 'legacy-preserved',
        schemaVersion: 2
    };
}

/**
 * Return the server-authoritative assignment used by the Log Spending preview.
 * The actor check is intentional: even a read-only derived period must not be
 * available as an unauthenticated household-data oracle.
 */
function previewAssignment(expenseDate, actor, options = {}) {
    actorIdFor(actor);
    const timeZone = getOption(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const canonicalExpenseDate = validateExpenseDate(expenseDate, 'date');
    const assignment = resolveBudgetMonth({ expenseDate: canonicalExpenseDate, timeZone });
    const period = getSalaryCyclePeriod({ budgetMonth: assignment, timeZone });

    return {
        expenseDate: canonicalExpenseDate,
        date: canonicalExpenseDate,
        budgetMonth: assignment.key,
        month: assignment.month,
        year: assignment.year,
        period,
        salaryCyclePeriod: period,
        timeZone
    };
}

async function runInTransaction(operation, { connection = mongoose.connection, session } = {}) {
    if (session) return operation(session);
    if (!connection || typeof connection.startSession !== 'function') {
        throw new Error('A MongoDB connection with startSession is required.');
    }

    const ownedSession = await connection.startSession();
    try {
        let result;
        await ownedSession.withTransaction(async () => {
            result = await operation(ownedSession);
        });
        return result;
    } finally {
        await ownedSession.endSession();
    }
}

async function findById(model, id, session, { lean = false } = {}) {
    let query = model.findById(id);
    query = withSession(query, session);
    if (lean && typeof query?.lean === 'function') query = query.lean();
    return executeQuery(query);
}

// ---------------------------------------------------------------------------
// Managed pocket integration (gated by POCKET_MANAGEMENT_ENABLED)
//
// When the feature is off none of the helpers below run, so single/split
// expense handling and the DTO remain byte-for-byte the legacy behavior. When
// on, every referenced Pocket_Identifier is validated against the
// PocketAssignment for the transaction's server-derived Budget_Month, and
// existing labels are resolved from assignment snapshots.
// ---------------------------------------------------------------------------

function assignmentModelFor(options, actor) {
    return getOption(options, actor, 'assignmentModel', PocketAssignment);
}

/**
 * Collect every managed Pocket_Identifier referenced by a mapped command:
 * the single-pocket `pocketId` and each split share's `pocketId`. The field
 * path is retained so a validation failure names the exact offending field.
 */
function collectReferencedPocketIds(mapped) {
    const references = [];
    if (mapped.pocketId !== undefined && mapped.pocketId !== null) {
        references.push({ field: 'pocketId', pocketId: String(mapped.pocketId) });
    }
    if (Array.isArray(mapped.sourceBreakdowns)) {
        mapped.sourceBreakdowns.forEach((share, index) => {
            if (share && share.pocketId !== undefined && share.pocketId !== null) {
                references.push({
                    field: `sourceBreakdowns.${index}.pocketId`,
                    pocketId: String(share.pocketId)
                });
            }
        });
    }
    return references;
}

/**
 * Reject a new or updated expense that references a Pocket_Identifier without a
 * Pocket_Assignment in the expense Budget_Month. Every unassigned reference
 * (single and each split share) yields one field-specific error in the same
 * response; the throw happens before any write so expense state is preserved.
 */
async function assertReferencedPocketsAssigned(mapped, actor, options, session) {
    const references = collectReferencedPocketIds(mapped);
    if (references.length === 0) return;

    const Assignment = assignmentModelFor(options, actor);
    const uniqueIds = [...new Set(references.map((reference) => reference.pocketId))];
    const query = withSession(Assignment.find({
        pocketId: { $in: uniqueIds },
        budgetMonth: mapped.budgetMonth,
        budgetYear: mapped.budgetYear
    }), session);
    const assignments = await executeQuery(query);
    const assignedIds = new Set((assignments || []).map((doc) => String(doc.pocketId)));

    const budgetMonthKey = `${String(mapped.budgetYear).padStart(4, '0')}-${String(mapped.budgetMonth).padStart(2, '0')}`;
    const errors = references
        .filter((reference) => !assignedIds.has(reference.pocketId))
        .map((reference) => new DomainValidationError(
            reference.field,
            `${reference.field} must reference a pocket assigned to the expense Budget Month.`,
            { budgetMonth: budgetMonthKey }
        ));

    if (errors.length > 0) throw new PocketValidationError(errors);
}

/**
 * Build a resolver from stored transaction records to the Pocket_Assignment
 * snapshot for each record's Budget_Month, so read DTOs render labels from the
 * snapshot even when the current definition is archived or renamed. Returns
 * undefined when the feature is off or no managed identifiers are present, in
 * which case the DTO renders legacy fields unchanged.
 */
async function buildPocketSnapshotResolver(records, actor, options) {
    if (!isPocketManagementEnabled(options, actor)) return undefined;

    const list = Array.isArray(records) ? records : [records];
    const ids = new Set();
    for (const record of list) {
        if (record?.pocketId !== undefined && record?.pocketId !== null) {
            ids.add(String(record.pocketId));
        }
        if (Array.isArray(record?.sourceBreakdowns)) {
            for (const share of record.sourceBreakdowns) {
                if (share?.pocketId !== undefined && share?.pocketId !== null) {
                    ids.add(String(share.pocketId));
                }
            }
        }
    }
    if (ids.size === 0) return undefined;

    const Assignment = assignmentModelFor(options, actor);
    const assignments = await executeQuery(Assignment.find({ pocketId: { $in: [...ids] } }));

    const snapshots = new Map();
    for (const doc of assignments || []) {
        const dto = typeof doc?.toDTO === 'function' ? doc.toDTO() : doc;
        const key = `${dto.budgetYear}-${dto.budgetMonth}-${String(dto.pocketId)}`;
        snapshots.set(key, {
            pocketId: String(dto.pocketId),
            pocketName: dto.pocketName ?? dto.pocketNameSnapshot,
            pocketEmoji: dto.pocketEmoji ?? dto.pocketEmojiSnapshot,
            cadence: dto.cadence ?? dto.cadenceSnapshot,
            budgetMonth: dto.budgetMonth,
            budgetYear: dto.budgetYear
        });
    }

    // Guarded dual-read: when the compatibility flag is on, a referenced
    // Pocket_Identifier without a managed snapshot means the record has not been
    // migrated, so the DTO renders the legacy `pocket` label. Track that
    // fallback (and each managed hit) so zero-fallback can be verified before
    // legacy retirement. Managed-only mode returns the plain resolver unchanged.
    if (!isDualReadActive(options, actor)) {
        return (pocketId, { budgetMonth, budgetYear }) =>
            snapshots.get(`${budgetYear}-${budgetMonth}-${pocketId}`) || null;
    }

    const tracker = resolveTracker(options, actor);
    return (pocketId, { budgetMonth, budgetYear }) => {
        const snapshot = snapshots.get(`${budgetYear}-${budgetMonth}-${pocketId}`) || null;
        const budgetMonthKey = `${String(budgetYear).padStart(4, '0')}-${String(budgetMonth).padStart(2, '0')}`;
        if (snapshot) {
            tracker.observeManaged({ source: 'managed', collection: 'transactions', pocketId, budgetMonth: budgetMonthKey });
        } else {
            tracker.observeFallback({ source: 'legacy', collection: 'transactions', pocketId, budgetMonth: budgetMonthKey });
        }
        return snapshot;
    };
}

async function queueNotification(event, options, actor) {
    const queue = getOption(options, actor, 'notificationQueue', null);
    if (!queue) return;

    try {
        if (typeof queue === 'function') {
            await queue(event);
        } else if (typeof queue.enqueue === 'function') {
            await queue.enqueue(event);
        } else if (typeof queue.notify === 'function') {
            await queue.notify(event);
        } else if (typeof queue.send === 'function') {
            await queue.send(event);
        }
    } catch {
        // Notifications are deliberately best effort. The transaction has
        // already committed, so a mail/queue outage must not roll it back.
    }
}

async function protectPeriods(periods, session, actor, options, operation) {
    const guardModel = getOption(options, actor, 'guardModel', ClosedMonth);
    return withOpenBudgetPeriods(periods, session, operation, {
        guardModel,
        actor: actorIdFor(actor)
    });
}

async function createExpense(command, actor, options = {}) {
    const timeZone = getOption(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const transactionModel = getOption(options, actor, 'transactionModel', Transaction);
    const actorId = actorIdFor(actor);
    const enabled = isSalaryCycleEnabled(options, actor);
    const mapped = ensureCanonicalAssignment(
        command || {},
        toCanonicalTransactionInput({ ...(command || {}), by: actorId }, { timeZone }),
        timeZone,
        { enabled }
    );

    const pocketManagementEnabled = isPocketManagementEnabled(options, actor);

    const created = await runInTransaction(async session => {
        // Validate referenced Pocket_Identifiers against the Budget_Month
        // assignment inside the transaction so a rejection leaves nothing
        // written.
        if (pocketManagementEnabled) {
            await assertReferencedPocketsAssigned(mapped, actor, options, session);
        }
        return protectPeriods(
            [{ month: mapped.budgetMonth, year: mapped.budgetYear, label: 'destination' }],
            session,
            actor,
            options,
            async () => {
                const transaction = new transactionModel({ ...mapped, by: actorId });
                return transaction.save({ session });
            }
        );
    }, options);

    const resolvePocketSnapshot = await buildPocketSnapshotResolver(created, actor, options);
    const dto = toTransactionDto(created, { timeZone, resolvePocketSnapshot });
    await queueNotification({
        type: 'expense-created',
        transactionId: created._id,
        transaction: dto,
        actorId
    }, options, actor);
    return dto;
}

async function updateExpense(id, command, actor, options = {}) {
    const normalizedId = validateIdentifier(id, 'id');
    const timeZone = getOption(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const transactionModel = getOption(options, actor, 'transactionModel', Transaction);
    const actorId = actorIdFor(actor);
    const enabled = isSalaryCycleEnabled(options, actor);
    const pocketManagementEnabled = isPocketManagementEnabled(options, actor);

    let updated;
    await runInTransaction(async session => {
        const existing = await findById(transactionModel, normalizedId, session);
        if (!existing) throw new RecordNotFoundError('transaction');

        const input = commandInput(command, existing);
        // Updating an expense must not rewrite its original submitter. The
        // actor is used for guard auditing, while `by` remains transaction
        // ownership metadata established at creation time.
        if (existing.by !== undefined && existing.by !== null) input.by = existing.by;
        const mapped = ensureCanonicalAssignment(
            command || {},
            toCanonicalTransactionInput(input, { timeZone }),
            timeZone,
            { enabled, fallbackAssignment: assignmentPeriod(existing, timeZone) }
        );

        // An update that introduces a Pocket_Identifier without a Budget_Month
        // assignment is rejected before any write, preserving the complete
        // stored expense.
        if (pocketManagementEnabled) {
            await assertReferencedPocketsAssigned(mapped, actor, options, session);
        }

        const source = assignmentPeriod(existing, timeZone);
        const destination = { month: mapped.budgetMonth, year: mapped.budgetYear };

        updated = await protectPeriods(
            [
                { ...source, label: 'source' },
                { ...destination, label: 'destination' }
            ],
            session,
            actor,
            options,
            async () => {
                Object.assign(existing, mapped);
                return existing.save({ session });
            }
        );
    }, options);

    const resolvePocketSnapshot = await buildPocketSnapshotResolver(updated, actor, options);
    const dto = toTransactionDto(updated, { timeZone, resolvePocketSnapshot });
    await queueNotification({
        type: 'expense-updated',
        transactionId: updated._id,
        transaction: dto,
        actorId
    }, options, actor);
    return dto;
}

async function deleteExpense(id, actor, options = {}) {
    const normalizedId = validateIdentifier(id, 'id');
    const transactionModel = getOption(options, actor, 'transactionModel', Transaction);
    const actorId = actorIdFor(actor);
    let deleted;

    await runInTransaction(async session => {
        const existing = await findById(transactionModel, normalizedId, session);
        if (!existing) throw new RecordNotFoundError('transaction');

        const source = assignmentPeriod(existing, getOption(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE));
        deleted = await protectPeriods(
            [{ ...source, label: 'source' }],
            session,
            actor,
            options,
            async () => {
                if (typeof existing.deleteOne === 'function') {
                    await existing.deleteOne({ session });
                } else {
                    let query = transactionModel.deleteOne({ _id: normalizedId });
                    query = withSession(query, session);
                    await executeQuery(query);
                }
                return existing;
            }
        );
    }, options);

    await queueNotification({
        type: 'expense-deleted',
        transactionId: deleted._id,
        actorId
    }, options, actor);
    return { success: true, transactionId: deleted._id };
}

async function getExpense(id, actor, options = {}) {
    const normalizedId = validateIdentifier(id, 'id');
    const timeZone = getOption(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const transactionModel = getOption(options, actor, 'transactionModel', Transaction);
    const transaction = await findById(transactionModel, normalizedId, null, { lean: true });
    if (!transaction) throw new RecordNotFoundError('transaction');
    const resolvePocketSnapshot = await buildPocketSnapshotResolver(transaction, actor, options);
    return toTransactionDto(transaction, { timeZone, resolvePocketSnapshot });
}

function buildListFilter(filters = {}) {
    const filter = {};
    const month = filters.month ?? filters.budgetMonth;
    if (month !== undefined && month !== null) {
        let parsed;
        if (typeof month === 'string') {
            parsed = parseBudgetMonth(month);
        } else if (month && typeof month === 'object') {
            parsed = {
                month: normalizeLegacyAssignment(month.month, 'budgetMonth'),
                year: normalizeLegacyAssignment(month.year, 'budgetYear')
            };
        } else {
            parsed = {
                month: normalizeLegacyAssignment(month, 'budgetMonth'),
                year: normalizeLegacyAssignment(filters.budgetYear, 'budgetYear')
            };
        }
        filter.budgetMonth = parsed.month;
        filter.budgetYear = parsed.year;
    } else if (filters.budgetYear !== undefined) {
        filter.budgetYear = normalizeLegacyAssignment(filters.budgetYear, 'budgetYear');
    }

    if (filters.by && filters.by !== 'all') filter.by = validateIdentifier(filters.by, 'by');
    if (filters.type && filters.type !== 'all') filter.type = filters.type;

    // Managed filtering resolves by immutable Pocket_Identifier across the
    // single-pocket reference and every split share. It is additive and only
    // active when a caller supplies `pocketId`; legacy `pocket`-name filtering
    // is preserved unchanged for compatibility callers that omit it.
    if (filters.pocketId && filters.pocketId !== 'all') {
        const pocketId = validateIdentifier(filters.pocketId, 'pocketId');
        filter.$or = [
            { pocketId },
            { 'sourceBreakdowns.pocketId': pocketId }
        ];
    } else if (filters.pocket && filters.pocket !== 'all') {
        filter.$or = [
            { pocket: String(filters.pocket).trim() },
            { 'sourceBreakdowns.pocket': String(filters.pocket).trim() }
        ];
    }
    return filter;
}

async function listExpenses(filters = {}, actor, options = {}) {
    const timeZone = getOption(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const transactionModel = getOption(options, actor, 'transactionModel', Transaction);
    let query = transactionModel.find(buildListFilter(filters));
    if (typeof query.populate === 'function') query = query.populate('by', 'username');
    if (typeof query.sort === 'function') query = query.sort({ expenseDate: -1, date: -1, createdAt: -1 });
    if (typeof query.lean === 'function') query = query.lean();
    const transactions = await executeQuery(query);
    const resolvePocketSnapshot = await buildPocketSnapshotResolver(transactions, actor, options);
    return transactions.map(transaction => toTransactionDto(transaction, { timeZone, resolvePocketSnapshot }));
}

/**
 * Optional dependency-injected facade used by controllers and integration
 * tests. Direct command exports remain available for compatibility.
 */
function createTransactionService(defaultOptions = {}) {
    return {
        previewAssignment: (expenseDate, actor, options) => previewAssignment(expenseDate, actor, { ...defaultOptions, ...options }),
        getAssignmentPreview: (expenseDate, actor, options) => previewAssignment(expenseDate, actor, { ...defaultOptions, ...options }),
        createExpense: (command, actor, options) => createExpense(command, actor, { ...defaultOptions, ...options }),
        updateExpense: (id, command, actor, options) => updateExpense(id, command, actor, { ...defaultOptions, ...options }),
        deleteExpense: (id, actor, options) => deleteExpense(id, actor, { ...defaultOptions, ...options }),
        getExpense: (id, actor, options) => getExpense(id, actor, { ...defaultOptions, ...options }),
        listExpenses: (filters, actor, options) => listExpenses(filters, actor, { ...defaultOptions, ...options })
    };
}

module.exports = {
    getCategoryBreakdown,
    getRoleBreakdown,
    calculateTotalExpenses,
    previewAssignment,
    getAssignmentPreview: previewAssignment,
    createExpense,
    updateExpense,
    deleteExpense,
    getExpense,
    listExpenses,
    createTransactionService,
    // Named aliases make the command vocabulary explicit to adapters.
    createTransaction: createExpense,
    updateTransaction: updateExpense,
    deleteTransaction: deleteExpense,
    getTransaction: getExpense,
    listTransactions: listExpenses
};
