'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { Temporal } = require('@js-temporal/polyfill');
const {
    getActualPayday,
    getSalaryCyclePeriod,
    listIntersectingIsoWeeks
} = require('../../services/salaryCycleResolver');
const { calculatePocketWeek } = require('../../services/budgetCalculationService');
const {
    budgetMonthArbitrary,
    pocketArbitrary,
    positiveIntegerRupiahArbitrary
} = require('../arbitraries');
const { assertProperty, propertyOptions } = require('../helpers');

const HOUSEHOLD_TIME_ZONE = 'Asia/Jakarta';

/**
 * Generate a payday that falls after Monday so its ISO week contains dates on
 * both sides of the boundary. The payday and date offsets are generated from
 * an independent Temporal calculation rather than from the resolver under test.
 */
const crossingWeekCaseArbitrary = budgetMonthArbitrary
    .filter(({ year, month }) => independentActualPayday(year, month).dayOfWeek > 1)
    .chain(budgetMonth => {
        const payday = independentActualPayday(budgetMonth.year, budgetMonth.month);
        return fc.record({
            beforeOffset: fc.integer({ min: 1, max: payday.dayOfWeek - 1 }),
            afterOffset: fc.integer({ min: 0, max: 7 - payday.dayOfWeek }),
            pocket: pocketArbitrary,
            beforeAmount: positiveIntegerRupiahArbitrary,
            afterAmount: positiveIntegerRupiahArbitrary,
            wrongBeforeAmount: positiveIntegerRupiahArbitrary,
            wrongAfterAmount: positiveIntegerRupiahArbitrary
        }).map(values => ({
            ...values,
            budgetMonth,
            payday
        }));
    });

// Feature: salary-cycle-budgeting, Property 8: Crossing-week attribution uses the period intersection
// **Validates: Requirements 5.4, 6.2**
test('Property 8: crossing-week attribution uses the period intersection', () => {
    assertProperty(
        fc.property(crossingWeekCaseArbitrary, scenario => {
            const {
                budgetMonth,
                payday,
                beforeOffset,
                afterOffset,
                pocket,
                beforeAmount,
                afterAmount,
                wrongBeforeAmount,
                wrongAfterAmount
            } = scenario;
            const targetKey = budgetMonth.key;
            const nextBudgetMonth = nextMonth(budgetMonth);
            const actualPayday = getActualPayday({
                year: budgetMonth.year,
                month: budgetMonth.month,
                timeZone: HOUSEHOLD_TIME_ZONE
            });

            assert.equal(actualPayday, payday.toString());

            const currentPeriod = getSalaryCyclePeriod({
                budgetMonth: targetKey,
                timeZone: HOUSEHOLD_TIME_ZONE
            });
            const nextPeriod = getSalaryCyclePeriod({
                budgetMonth: nextBudgetMonth.key,
                timeZone: HOUSEHOLD_TIME_ZONE
            });
            const crossingWeek = independentIsoWeekForDate(payday);
            const currentWeeks = listIntersectingIsoWeeks({
                period: currentPeriod
            });
            const nextWeeks = listIntersectingIsoWeeks({
                period: nextPeriod
            });
            const currentWeek = currentWeeks.find(week => week.key === crossingWeek.key);
            const nextWeek = nextWeeks.find(week => week.key === crossingWeek.key);

            assert.ok(currentWeek, `current period must list ${crossingWeek.key}`);
            assert.ok(nextWeek, `next period must list ${crossingWeek.key}`);
            assert.deepEqual(weekShape(currentWeek), crossingWeek);
            assert.deepEqual(weekShape(nextWeek), crossingWeek);

            const currentIntersection = inclusiveIntersectionOracle(
                currentPeriod,
                crossingWeek
            );
            const nextIntersection = inclusiveIntersectionOracle(
                nextPeriod,
                crossingWeek
            );
            assert.ok(currentIntersection);
            assert.ok(nextIntersection);
            assert.deepEqual(intersectionShape(currentWeek), currentIntersection);
            assert.deepEqual(intersectionShape(nextWeek), nextIntersection);

            const beforeDate = payday.subtract({ days: beforeOffset }).toString();
            const afterDate = payday.add({ days: afterOffset }).toString();
            const items = [
                {
                    transactionId: 'before-payday',
                    pocket,
                    amount: beforeAmount,
                    expenseDate: beforeDate,
                    budgetMonth: budgetMonth.month,
                    budgetYear: budgetMonth.year
                },
                {
                    transactionId: 'after-payday',
                    pocket,
                    amount: afterAmount,
                    expenseDate: afterDate,
                    budgetMonth: nextBudgetMonth.month,
                    budgetYear: nextBudgetMonth.year
                },
                // These records deliberately carry the opposite stored assignment.
                // They share the same crossing week but must not be attributed to
                // either period merely because their dates are in the full week.
                {
                    transactionId: 'before-payday-wrong-month',
                    pocket,
                    amount: wrongBeforeAmount,
                    expenseDate: beforeDate,
                    budgetMonth: nextBudgetMonth.month,
                    budgetYear: nextBudgetMonth.year
                },
                {
                    transactionId: 'after-payday-wrong-month',
                    pocket,
                    amount: wrongAfterAmount,
                    expenseDate: afterDate,
                    budgetMonth: budgetMonth.month,
                    budgetYear: budgetMonth.year
                }
            ];

            assert.equal(
                expectedSpending(items, targetKey, pocket, currentIntersection),
                beforeAmount
            );
            assert.equal(
                expectedSpending(items, nextBudgetMonth.key, pocket, nextIntersection),
                afterAmount
            );

            const currentMetrics = calculatePocketWeek(
                items,
                0,
                currentWeek,
                { budgetMonth: targetKey, pocket }
            );
            const nextMetrics = calculatePocketWeek(
                items,
                0,
                nextWeek,
                { budgetMonth: nextBudgetMonth.key, pocket }
            );

            assert.equal(currentMetrics.spending, beforeAmount);
            assert.equal(nextMetrics.spending, afterAmount);
            assert.equal(
                currentMetrics.spending,
                expectedSpending(items, targetKey, pocket, currentIntersection)
            );
            assert.equal(
                nextMetrics.spending,
                expectedSpending(items, nextBudgetMonth.key, pocket, nextIntersection)
            );
        }),
        propertyOptions({ numRuns: 100 })
    );
});

/** Independent payday oracle used only to generate and check the boundary. */
function independentActualPayday(year, month) {
    const nominalPayday = Temporal.PlainDate.from({ year, month, day: 25 });
    const daysToSubtract = nominalPayday.dayOfWeek === 6
        ? 1
        : nominalPayday.dayOfWeek === 7
            ? 2
            : 0;
    return nominalPayday.subtract({ days: daysToSubtract });
}

/** Independent ISO week oracle for the week containing the supplied payday. */
function independentIsoWeekForDate(date) {
    const monday = date.subtract({ days: date.dayOfWeek - 1 });
    return {
        key: `${String(date.yearOfWeek).padStart(4, '0')}-W${String(date.weekOfYear).padStart(2, '0')}`,
        weekYear: date.yearOfWeek,
        weekNumber: date.weekOfYear,
        startDate: monday.toString(),
        endDate: monday.add({ days: 6 }).toString()
    };
}

/**
 * Independent inclusive range-intersection oracle. It intentionally performs
 * direct max(start)/min(end) comparisons instead of calling resolver helpers.
 */
function inclusiveIntersectionOracle(period, week) {
    const periodStart = Temporal.PlainDate.from(period.startDate);
    const periodEnd = Temporal.PlainDate.from(period.endDate);
    const weekStart = Temporal.PlainDate.from(week.startDate);
    const weekEnd = Temporal.PlainDate.from(week.endDate);
    const start = Temporal.PlainDate.compare(periodStart, weekStart) >= 0
        ? periodStart
        : weekStart;
    const end = Temporal.PlainDate.compare(periodEnd, weekEnd) <= 0
        ? periodEnd
        : weekEnd;

    return Temporal.PlainDate.compare(start, end) <= 0
        ? { startDate: start.toString(), endDate: end.toString() }
        : null;
}

function expectedSpending(items, budgetMonth, pocket, intersection) {
    return items.reduce((total, item) => {
        const inStoredPeriod = item.budgetMonth === Number(budgetMonth.slice(5)) &&
            item.budgetYear === Number(budgetMonth.slice(0, 4));
        const inPocket = item.pocket === pocket;
        const inIntersection = item.expenseDate >= intersection.startDate &&
            item.expenseDate <= intersection.endDate;
        return total + (inStoredPeriod && inPocket && inIntersection ? item.amount : 0);
    }, 0);
}

function nextMonth(budgetMonth) {
    const next = Temporal.PlainYearMonth.from(budgetMonth.key).add({ months: 1 });
    return {
        key: next.toString(),
        year: next.year,
        month: next.month
    };
}

function weekShape(week) {
    return {
        key: week.key,
        weekYear: week.weekYear,
        weekNumber: week.weekNumber,
        startDate: week.startDate,
        endDate: week.endDate
    };
}

function intersectionShape(week) {
    return {
        startDate: week.intersectionStartDate,
        endDate: week.intersectionEndDate
    };
}
