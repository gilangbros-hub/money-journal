'use strict';

const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const ClosedMonth = require('../models/closedMonth');
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
    RecordNotFoundError
} = require('../utils/domainErrors');
const { isSalaryCycleEnabled } = require('../utils/rollout');

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

    const created = await runInTransaction(async session => protectPeriods(
        [{ month: mapped.budgetMonth, year: mapped.budgetYear, label: 'destination' }],
        session,
        actor,
        options,
        async () => {
            const transaction = new transactionModel({ ...mapped, by: actorId });
            return transaction.save({ session });
        }
    ), options);

    const dto = toTransactionDto(created, { timeZone });
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

    const dto = toTransactionDto(updated, { timeZone });
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
    return toTransactionDto(transaction, { timeZone });
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
    if (filters.pocket && filters.pocket !== 'all') {
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
    return transactions.map(transaction => toTransactionDto(transaction, { timeZone }));
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
