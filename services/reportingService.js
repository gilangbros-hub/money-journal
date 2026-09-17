'use strict';

const Transaction = require('../models/transaction');
const PocketAssignment = require('../models/pocketAssignment');
const { isPocketManagementEnabled } = require('../utils/rollout');
const { isDualReadActive, resolveTracker } = require('./pocketCompatibility');
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

// ---------------------------------------------------------------------------
// Managed pocket presentation (gated by POCKET_MANAGEMENT_ENABLED)
//
// Reporting never reads the current PocketDefinition. When the feature is off
// none of the helpers below run, so every report stays byte-for-byte the legacy
// behavior. When on, historical presentation (labels, emoji, cadence) is
// resolved from the immutable PocketAssignment snapshot for each record's
// stored Budget_Month, so a later rename/archive/cadence/amount change on a
// definition can never overwrite a saved report label. Pocket metrics and
// totals are delegated to BudgetService, whose managed view is already built
// from the same snapshots.
// ---------------------------------------------------------------------------

function assignmentModelFor(options, actor) {
    return options?.assignmentModel ?? actor?.assignmentModel ?? PocketAssignment;
}

/**
 * Build a resolver mapping a stored Pocket_Identifier to the PocketAssignment
 * snapshot for a record's Budget_Month. Returns undefined when the feature is
 * off or no managed identifiers are present, in which case reports render the
 * legacy `pocket` fields unchanged. Resolution is keyed by (year, month, id) so
 * each id renders the label saved for that specific month.
 */
async function buildPocketSnapshotResolver(records, actor, options = {}) {
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
    const query = withSession(Assignment.find({ pocketId: { $in: [...ids] } }), options.session);
    const assignments = await executeQuery(query);

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

    // Guarded dual-read: track each managed hit and each legacy fallback (a
    // referenced Pocket_Identifier with no managed snapshot, rendered from the
    // legacy `pocket` label) so a zero-fallback observation window can be
    // verified before legacy retirement. Managed-only mode is unchanged.
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

/**
 * Additively enrich a reported transaction with assignment-snapshot labels for
 * its managed Pocket_Identifiers. The legacy `pocket` compatibility projection
 * is left untouched; only snapshot-sourced fields are added, so an archived or
 * renamed definition never rewrites the saved presentation. A missing resolver
 * (feature off) returns the reported record unchanged.
 */
function applyReportedPocketSnapshot(reported, resolve) {
    if (typeof resolve !== 'function') return reported;

    const context = { budgetMonth: reported.budgetMonth, budgetYear: reported.budgetYear };
    const result = { ...reported };

    if (reported.pocketId !== undefined && reported.pocketId !== null) {
        const snapshot = resolve(String(reported.pocketId), context);
        if (snapshot) {
            result.pocketName = snapshot.pocketName;
            result.pocketEmoji = snapshot.pocketEmoji;
            result.pocketCadence = snapshot.cadence;
        }
    }

    if (Array.isArray(result.sourceBreakdowns) && result.sourceBreakdowns.length > 0) {
        result.sourceBreakdowns = result.sourceBreakdowns.map((share) => {
            if (share && share.pocketId !== undefined && share.pocketId !== null) {
                const snapshot = resolve(String(share.pocketId), context);
                if (snapshot) {
                    return {
                        ...share,
                        pocketName: snapshot.pocketName,
                        pocketEmoji: snapshot.pocketEmoji
                    };
                }
            }
            return share;
        });
    }

    return result;
}

function safeSubmitterName(value) {
    if (value && typeof value === 'object') return value.username || 'Unknown';
    // Populated model adapters expose an object. Treat raw ObjectId strings as
    // identifiers rather than usernames so reports never disclose submitter
    // identities through a fallback path.
    if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)) return 'Unknown';
    return value || 'Unknown';
}

function transactionPocketMatches(transaction, pocket, { pocketId } = {}) {
    // Managed identity filtering takes precedence when a Pocket_Identifier is
    // supplied: match the single-pocket reference or any split share by the
    // immutable id, never the legacy name string.
    if (pocketId && pocketId !== 'all') {
        const id = String(pocketId);
        return String(transaction.pocketId) === id ||
            (transaction.sourceBreakdowns || []).some(share => String(share.pocketId) === id);
    }
    // Legacy name alias preserved unchanged for compatibility callers that
    // still filter by pocket name.
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
    // Historical presentation for the recent list comes from assignment
    // snapshots when Pocket Management is enabled, matching the snapshot-backed
    // labels the transaction list already renders. Feature-off, the resolver is
    // undefined and recent items keep their exact legacy fields.
    const resolvePocketSnapshot = await buildPocketSnapshotResolver(transactions, actor, options);
    const recent = transactions.slice(0, 5).map(transaction => {
        const reported = applyReportedPocketSnapshot(
            reportedTransaction(transaction, timeZone),
            resolvePocketSnapshot
        );
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
