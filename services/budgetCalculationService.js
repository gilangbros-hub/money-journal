'use strict';

const {
    intersectPeriodAndWeek,
    parseBudgetMonth,
    parseExpenseDate
} = require('./salaryCycleResolver');

/**
 * Pure spending and budget calculations. This module deliberately has no
 * database, session, environment, or current-time dependencies. Callers pass
 * the stored assignment and, for weekly calculations, the server-derived
 * salary-cycle/week intersection.
 */

function valueOf(record) {
    if (record && typeof record.toObject === 'function') return record.toObject();
    return record || {};
}

function allocationAmount(allocation) {
    if (typeof allocation === 'number') {
        return Number.isFinite(allocation) && allocation >= 0 ? allocation : 0;
    }

    if (!allocation || typeof allocation !== 'object') return 0;
    const value = allocation.amount ?? allocation.budget ?? allocation.allocation;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : 0;
}

function budgetMonthParts(value, year) {
    if (typeof value === 'string') return parseBudgetMonth(value);

    if (value && typeof value === 'object') {
        if (typeof value.key === 'string') return parseBudgetMonth(value.key);
        if (Number.isInteger(value.year) && Number.isInteger(value.month)) {
            return parseBudgetMonth(
                `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}`
            );
        }
    }

    if (Number.isInteger(value) && Number.isInteger(year)) {
        return parseBudgetMonth(
            `${String(year).padStart(4, '0')}-${String(value).padStart(2, '0')}`
        );
    }

    return null;
}

function storedBudgetMonth(record) {
    const value = valueOf(record);
    if (typeof value.budgetMonth === 'string' && value.budgetMonth.includes('-')) {
        return budgetMonthParts(value.budgetMonth);
    }
    return budgetMonthParts(value.budgetMonth, value.budgetYear);
}

function transactionId(transaction) {
    const value = transaction?._id ?? transaction?.id ?? transaction?.transactionId;
    return value === undefined || value === null ? undefined : String(value);
}

function sourceTypeFor(transaction) {
    return transaction.sourceType === 'multi' ||
        (Array.isArray(transaction.sourceBreakdowns) && transaction.sourceBreakdowns.length > 0)
        ? 'multi'
        : 'single';
}

function createItem(transaction, pocket, amount, sourceIndex, sourceType) {
    const value = valueOf(transaction);
    const assignment = storedBudgetMonth(value);
    return {
        transactionId: transactionId(value),
        pocket,
        amount,
        expenseDate: value.expenseDate,
        budgetMonth: value.budgetMonth,
        budgetYear: value.budgetYear,
        budgetMonthKey: assignment?.key,
        sourceType,
        sourceIndex
    };
}

/**
 * Expand transactions into countable spending items. A single-pocket record
 * contributes its full amount once. A split record contributes only its
 * individual sourceBreakdowns; its parent amount is never emitted.
 *
 * `options` may contain `budgetMonth`, `pocket`, and/or `intersection` to
 * return only items eligible for that target. Without options all expanded
 * items are returned, allowing callers to reuse one expansion for several
 * pocket calculations.
 */
function expandEligibleSpendingItems(transactions = [], options = {}) {
    const expanded = [];
    for (const transaction of transactions || []) {
        const value = valueOf(transaction);
        const sourceType = sourceTypeFor(value);
        if (sourceType === 'multi') {
            for (const [sourceIndex, share] of (value.sourceBreakdowns || []).entries()) {
                if (!share || share.pocket === undefined) continue;
                expanded.push(createItem(value, share.pocket, share.amount, sourceIndex, sourceType));
            }
        } else if (value.pocket !== undefined) {
            expanded.push(createItem(value, value.pocket, value.amount, 0, sourceType));
        }
    }

    const hasEligibilityFilter = options && typeof options === 'object' && (
        Object.prototype.hasOwnProperty.call(options, 'budgetMonth') ||
        Object.prototype.hasOwnProperty.call(options, 'pocket') ||
        Object.prototype.hasOwnProperty.call(options, 'intersection')
    );
    return hasEligibilityFilter
        ? filterEligibleSpendingItems(expanded, options)
        : expanded;
}

function itemBudgetMonth(item) {
    const value = valueOf(item);
    if (value.budgetMonthKey) return budgetMonthParts(value.budgetMonthKey);
    return storedBudgetMonth(value);
}

function dateWithinInclusive(date, range) {
    if (!range || !range.startDate || !range.endDate || typeof date !== 'string') return false;
    try {
        const parsed = parseExpenseDate(date).toString();
        parseExpenseDate(range.startDate);
        parseExpenseDate(range.endDate);
        return parsed >= range.startDate && parsed <= range.endDate;
    } catch {
        return false;
    }
}

function normalizeIntersection(intersection) {
    if (!intersection) return null;
    // Week descriptors contain both the full Monday/Sunday range and the
    // salary-cycle intersection. Prefer the latter when present; callers may
    // also pass a plain { startDate, endDate } intersection.
    const startDate = intersection.intersectionStartDate ?? intersection.startDate;
    const endDate = intersection.intersectionEndDate ?? intersection.endDate;
    return startDate && endDate ? { startDate, endDate } : null;
}

function isEligibleSpendingItem(item, { budgetMonth, pocket, intersection } = {}) {
    const value = valueOf(item);
    if (pocket !== undefined && value.pocket !== pocket) return false;

    if (budgetMonth !== undefined) {
        const expected = budgetMonthParts(budgetMonth);
        const actual = itemBudgetMonth(value);
        if (!expected || !actual || expected.key !== actual.key) return false;
    }

    const normalizedIntersection = normalizeIntersection(intersection);
    return !normalizedIntersection || dateWithinInclusive(value.expenseDate, normalizedIntersection);
}

function filterEligibleSpendingItems(items = [], options = {}) {
    return (items || []).filter(item => isEligibleSpendingItem(item, options));
}

function spendingTotal(items = [], options) {
    const eligibleItems = options ? filterEligibleSpendingItems(items, options) : items || [];
    return eligibleItems.reduce((total, item) => {
        const amount = Number(item?.amount);
        return total + (Number.isFinite(amount) ? amount : 0);
    }, 0);
}

function percentageUsed(spending, allocation) {
    const amount = allocationAmount(allocation);
    return amount > 0 ? Math.round((spending / amount) * 100) : 0;
}

function remainingAmount(spending, allocation) {
    return allocationAmount(allocation) - spending;
}

function allocationAlertStatus(spending, allocation) {
    const percentage = percentageUsed(spending, allocation);
    if (percentage >= 100) return 'danger';
    if (percentage >= 80) return 'warning';
    return 'none';
}

function pocketStatus(spending, allocation) {
    const percentage = percentageUsed(spending, allocation);
    if (percentage >= 90) return 'danger';
    if (percentage >= 70) return 'warning';
    return 'good';
}

function aggregateStatus(spending, allocation) {
    const percentage = percentageUsed(spending, allocation);
    if (percentage >= 100) return 'danger';
    if (percentage >= 70) return 'warning';
    return 'good';
}

function buildMetrics(spending, allocation, alertStatus, status) {
    const normalizedAllocation = allocationAmount(allocation);
    const remaining = normalizedAllocation - spending;
    const percentage = percentageUsed(spending, normalizedAllocation);
    return {
        allocation: normalizedAllocation,
        spending,
        remaining,
        percentageUsed: percentage,
        alertStatus,
        status,
        isOver: remaining < 0
    };
}

/** Calculate full Salary_Cycle_Period spending for one pocket. */
function calculatePocketPeriod(items = [], allocation, options) {
    const spending = spendingTotal(items, options);
    return buildMetrics(
        spending,
        allocation,
        allocationAlertStatus(spending, allocation),
        pocketStatus(spending, allocation)
    );
}

/** Calculate spending inside an inclusive Salary_Cycle_Period/week intersection. */
function calculatePocketWeek(items = [], allocation, intersection, options = {}) {
    const normalizedOptions = {
        ...options,
        intersection: normalizeIntersection(intersection)
    };
    const spending = spendingTotal(items, normalizedOptions);
    return buildMetrics(
        spending,
        allocation,
        allocationAlertStatus(spending, allocation),
        pocketStatus(spending, allocation)
    );
}

/**
 * Return the inclusive intersection used by weekly attribution. This wrapper
 * keeps week calculation callers independent of the resolver's module path.
 */
function getWeeklySalaryCycleIntersection(period, week) {
    return intersectPeriodAndWeek({ period, week });
}

/**
 * Sum already-separated pocket metrics. Expanded split shares appear in one
 * metric only, so summing these metrics counts every eligible item exactly
 * once and never adds a split transaction's parent amount.
 */
function calculateBudgetAggregate(pocketMetrics = []) {
    const metrics = Array.isArray(pocketMetrics)
        ? pocketMetrics
        : pocketMetrics?.pockets || pocketMetrics?.pocketMetrics || [];
    const allocation = metrics.reduce((total, metric) => total + allocationAmount(metric), 0);
    const spending = metrics.reduce((total, metric) => {
        const value = Number(metric?.spending ?? metric?.spent);
        return total + (Number.isFinite(value) ? value : 0);
    }, 0);
    return {
        allocation,
        spending,
        remaining: allocation - spending,
        percentageUsed: percentageUsed(spending, allocation),
        status: aggregateStatus(spending, allocation),
        isOver: allocation - spending < 0
    };
}

module.exports = {
    aggregateStatus,
    allocationAlertStatus,
    calculateBudgetAggregate,
    calculatePocketPeriod,
    calculatePocketWeek,
    filterEligibleSpendingItems,
    getWeeklySalaryCycleIntersection,
    isEligibleSpendingItem,
    expandEligibleSpendingItems,
    percentageUsed,
    pocketStatus,
    remainingAmount,
    // Explicit aliases make the threshold policy convenient for callers that
    // distinguish Monthly Story alerts from generic allocation alerts.
    monthlyAlertStatus: allocationAlertStatus,
    weeklyAlertStatus: allocationAlertStatus
};
