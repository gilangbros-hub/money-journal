'use strict';

const Transaction = require('../models/transaction');
const { formatCurrency } = require('../utils/formatters');
const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    getActiveBudgetMonth,
    parseBudgetMonth,
    parseExpenseDate
} = require('./salaryCycleResolver');
const {
    expenseDateFromCompatibilityDate,
    validateExpenseDate
} = require('../utils/transactionValidators');
const { DomainValidationError } = require('../utils/domainErrors');
const {
    getCategoryBreakdown,
    getRoleBreakdown,
    calculateTotalExpenses,
    listExpenses
} = require('./transactionService');
const { createBudgetService } = require('./budgetService');

function executeQuery(query) {
    return typeof query?.exec === 'function' ? query.exec() : query;
}

function withSession(query, session) {
    return typeof query?.session === 'function' ? query.session(session) : query;
}

function option(options, actor, name, fallback) {
    return options?.[name] ?? actor?.[name] ?? fallback;
}

async function findTransactions(filter, options = {}) {
    const model = options.transactionModel || Transaction;
    let query = model.find(filter);
    // Dashboard recent items use the same safe username projection as the
    // transaction-list adapter. Never expose a stored user identifier when a
    // lightweight model adapter cannot populate it.
    if (!Array.isArray(query) && typeof query?.populate === 'function') {
        query = query.populate('by', 'username');
    }
    // A few service callers use already-resolved arrays as lightweight model
    // adapters. Array#sort expects a comparator, not Mongo's sort document.
    if (!Array.isArray(query) && typeof query?.sort === 'function') {
        query = query.sort({ expenseDate: -1, date: -1, createdAt: -1 });
    }
    query = withSession(query, options.session);
    if (typeof query?.lean === 'function') query = query.lean();
    const result = await executeQuery(query);
    if (!Array.isArray(result)) return result;

    // Lightweight model adapters used by unit/UI-facing callers may return an
    // array instead of a Mongo query. Keep recent/report ordering identical to
    // production by sorting on the canonical Expense_Date string, with the
    // compatibility date as a legacy fallback.
    const timeZone = options.timeZone || DEFAULT_HOUSEHOLD_TIME_ZONE;
    return result.slice().sort((left, right) => {
        const leftDate = safeCanonicalDate(left, timeZone);
        const rightDate = safeCanonicalDate(right, timeZone);
        return rightDate.localeCompare(leftDate);
    });
}

function safeCanonicalDate(transaction, timeZone) {
    try {
        return canonicalExpenseDate(transaction, timeZone);
    } catch {
        return '';
    }
}

function previousBudgetMonth(month) {
    return month.month === 1
        ? { year: month.year - 1, month: 12, key: `${String(month.year - 1).padStart(4, '0')}-12` }
        : { year: month.year, month: month.month - 1, key: `${String(month.year).padStart(4, '0')}-${String(month.month - 1).padStart(2, '0')}` };
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

/**
 * Parse a requested named Budget_Month before doing any database work. Empty
 * query values are not treated as "use the current month" because that would
 * make a malformed history/dashboard request silently return another period.
 */
function requestedBudgetMonth(input = {}) {
    const keys = ['budgetMonth', 'month'].filter(key =>
        hasOwn(input, key) && input[key] !== undefined
    );
    if (keys.length === 0) return null;

    const parsed = keys.map(key => {
        const value = input[key];
        if (typeof value !== 'string') {
            throw new DomainValidationError('budgetMonth', 'budgetMonth must use the YYYY-MM format.');
        }
        return parseBudgetMonth(value);
    });

    // Reject ambiguous requests instead of silently preferring one alias. This
    // keeps dashboard and history reads bound to exactly one stored assignment.
    if (parsed.length > 1 && parsed[0].key !== parsed[1].key) {
        throw new DomainValidationError('budgetMonth', 'month and budgetMonth must identify the same Budget Month.');
    }
    return parsed[0];
}

function canonicalExpenseDate(transaction, timeZone) {
    if (typeof transaction?.expenseDate === 'string') {
        return validateExpenseDate(transaction.expenseDate, 'expenseDate');
    }
    if (transaction?.date !== undefined && transaction?.date !== null) {
        return expenseDateFromCompatibilityDate(transaction.date, timeZone, 'date');
    }
    // Keep the failure field-specific if a malformed legacy record reaches a
    // report instead of exposing a database/model error to the client.
    return parseExpenseDate(transaction?.expenseDate);
}

function reportedTransaction(transaction, timeZone) {
    const value = transaction && typeof transaction.toObject === 'function'
        ? transaction.toObject()
        : { ...(transaction || {}) };
    const expenseDate = canonicalExpenseDate(value, timeZone);
    return {
        ...value,
        expenseDate,
        // `date` remains the response alias consumed by legacy pages. It is a
        // date-only string, never a serialized UTC-midnight BSON instant.
        date: expenseDate,
        formattedAmount: formatCurrency(value.amount || 0)
    };
}

function safeSubmitterName(value) {
    if (value && typeof value === 'object') return value.username || 'Unknown';
    // Populated model adapters expose an object. Treat raw ObjectId strings as
    // identifiers rather than usernames so reports never disclose submitter
    // identities through a fallback path.
    if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)) return 'Unknown';
    return value || 'Unknown';
}

function transactionPocketMatches(transaction, pocket) {
    if (!pocket || pocket === 'all') return true;
    return transaction.pocket === pocket || (transaction.sourceBreakdowns || []).some(share => share.pocket === pocket);
}

function buildAlerts(view) {
    return (view?.pockets || [])
        .filter(pocket => pocket.alertStatus === 'warning' || pocket.alertStatus === 'danger')
        .map(pocket => {
            const isWeekly = pocket.cadence === 'Weekly';
            const selectedWeek = pocket.selectedWeek?.key || null;
            const scopeLabel = isWeekly
                ? `Weekly · ${selectedWeek || 'selected week'}`
                : 'Monthly · salary cycle';
            const message = pocket.alertStatus === 'danger'
                ? `${pocket.pocket}: ${pocket.percentageUsed}% over budget (${scopeLabel})`
                : `${pocket.pocket}: ${pocket.percentageUsed}% used (${scopeLabel})`;
            return {
                pocket: pocket.pocket,
                cadence: pocket.cadence,
                selectedWeek,
                scopeLabel,
                status: pocket.alertStatus,
                percentage: pocket.percentageUsed,
                spent: formatCurrency(pocket.spent),
                budget: formatCurrency(pocket.budget),
                message
            };
        })
        .sort((left, right) => (right.status === 'danger' ? 1 : 0) - (left.status === 'danger' ? 1 : 0));
}

async function getDashboardSummary(input = {}, actor, options = {}) {
    const timeZone = option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const requested = requestedBudgetMonth(input);
    const budgetService = options.budgetService || createBudgetService({ ...options, timeZone });
    const view = await budgetService.getBudgetMonthView(
        {
            ...(requested ? { budgetMonth: requested.key } : {}),
            ...(input?.selectedWeek !== undefined
                ? { selectedWeek: input.selectedWeek }
                : input?.week !== undefined
                    ? { selectedWeek: input.week }
                    : {})
        },
        actor,
        options
    );
    const month = parseBudgetMonth(view.budgetMonth);
    const filter = { budgetMonth: month.month, budgetYear: month.year };
    const previous = previousBudgetMonth(month);
    const [transactions, previousTransactions] = await Promise.all([
        findTransactions(filter, options),
        findTransactions({ budgetMonth: previous.month, budgetYear: previous.year }, options)
    ]);
    const total = calculateTotalExpenses(transactions);
    const previousTotal = previousTransactions.reduce((sum, transaction) => sum + (transaction.amount || 0), 0);
    const difference = total.raw - previousTotal;
    const percentChange = previousTotal > 0
        ? Math.round((difference / previousTotal) * 100)
        : (total.raw > 0 ? 100 : 0);
    const comparison = {
        lastMonth: formatCurrency(previousTotal),
        difference: formatCurrency(Math.abs(difference)),
        percentChange: Math.abs(percentChange),
        increased: difference > 0,
        hasLastMonth: previousTotal > 0,
        previousBudgetMonth: previous.key
    };
    const recent = transactions.slice(0, 5).map(transaction => {
        const reported = reportedTransaction(transaction, timeZone);
        return {
            ...reported,
            by: safeSubmitterName(reported.by)
        };
    });
    return {
        budgetMonth: view.budgetMonth,
        timeZone,
        period: view.period,
        salaryCyclePeriod: view.period,
        total,
        categories: getCategoryBreakdown(transactions),
        roles: getRoleBreakdown(transactions),
        recent,
        comparison,
        budgetAlerts: buildAlerts(view),
        budget: view
    };
}

async function getAllTransactions(filters = {}, actor, options = {}) {
    const timeZone = option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const input = { ...filters };
    const requested = requestedBudgetMonth(input);
    if (requested) input.month = requested.key;
    if (!requested) {
        const active = getActiveBudgetMonth({
            nowInstant: option(options, actor, 'nowInstant', new Date().toISOString()),
            timeZone
        });
        input.month = active.key;
    }
    // listExpenses applies the stored numeric assignment filter and maps
    // canonical Expense_Date/date-only aliases. Keep the array response shape
    // compatible with the existing transaction pages.
    const transactions = await listExpenses(input, actor, { ...options, timeZone });
    return transactions.map(transaction => {
        const { formattedAmount, ...reported } = reportedTransaction(transaction, timeZone);
        return {
            ...reported,
            by: transaction.by
        };
    });
}

async function getHistory(filters = {}, actor, options = {}) {
    const timeZone = option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const requested = requestedBudgetMonth(filters);
    const transactions = await getAllTransactions(filters, actor, { ...options, timeZone });
    const budgetService = options.budgetService || createBudgetService({ ...options, timeZone });
    const view = await budgetService.getBudgetMonthView(
        {
            ...(requested ? { budgetMonth: requested.key } : {}),
            ...(filters?.selectedWeek !== undefined
                ? { selectedWeek: filters.selectedWeek }
                : filters?.week !== undefined
                    ? { selectedWeek: filters.week }
                    : {})
        },
        actor,
        { ...options, timeZone }
    );
    const byDate = transactions.reduce((groups, transaction) => {
        const date = transaction.expenseDate || transaction.date;
        (groups[date] ||= []).push(transaction);
        return groups;
    }, {});
    return {
        budgetMonth: view.budgetMonth,
        month: view.month,
        year: view.year,
        timeZone,
        period: view.period,
        salaryCyclePeriod: view.period,
        availableWeeks: view.availableWeeks || [],
        selectedWeek: view.selectedWeek || null,
        isClosed: view.isClosed ?? false,
        transactions,
        byDate
    };
}

function createReportingService(defaultOptions = {}) {
    const merge = options => ({ ...defaultOptions, ...options });
    return {
        getDashboardSummary: (input, actor, options) => getDashboardSummary(input, actor, merge(options)),
        getAllTransactions: (filters, actor, options) => getAllTransactions(filters, actor, merge(options)),
        listTransactions: (filters, actor, options) => getAllTransactions(filters, actor, merge(options)),
        getHistory: (filters, actor, options) => getHistory(filters, actor, merge(options))
    };
}

module.exports = {
    getDashboardSummary,
    getAllTransactions,
    listTransactions: getAllTransactions,
    getHistory,
    createReportingService,
    // Exported for focused service tests and adapters that need to normalize
    // legacy records without changing their stored assignment.
    reportedTransaction,
    requestedBudgetMonth,
    transactionPocketMatches
};
