'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { Temporal } = require('@js-temporal/polyfill');
const { getSalaryCyclePeriod } = require('../../services/salaryCycleResolver');
const { budgetMonthArbitrary } = require('../arbitraries');
const { assertProperty, propertyOptions } = require('../helpers');

const HOUSEHOLD_TIME_ZONE = 'Asia/Jakarta';

// Feature: salary-cycle-budgeting, Property 2: Salary-cycle periods form a contiguous partition
// **Validates: Requirements 2.4, 2.5, 2.6, 2.7**

test('Property 2: adjacent salary-cycle periods are a contiguous partition', () => {
    assertProperty(
        fc.property(
            budgetMonthArbitrary,
            fc.integer({ min: -3, max: 3 }),
            (budgetMonth, boundaryOffset) => {
                const nextBudgetMonth = adjacentBudgetMonth(budgetMonth);
                const actualEarlier = getSalaryCyclePeriod({
                    budgetMonth: budgetMonth.key,
                    timeZone: HOUSEHOLD_TIME_ZONE
                });
                const actualLater = getSalaryCyclePeriod({
                    budgetMonth: nextBudgetMonth.key,
                    timeZone: HOUSEHOLD_TIME_ZONE
                });

                const oracleEarlier = independentPeriodOracle(budgetMonth);
                const oracleLater = independentPeriodOracle(nextBudgetMonth);
                assert.deepEqual(actualEarlier, oracleEarlier);
                assert.deepEqual(actualLater, oracleLater);

                const earlierEnd = Temporal.PlainDate.from(actualEarlier.endDate);
                const laterStart = Temporal.PlainDate.from(actualLater.startDate);
                assert.equal(
                    laterStart.toString(),
                    earlierEnd.add({ days: 1 }).toString()
                );
                assert.ok(Temporal.PlainDate.compare(earlierEnd, laterStart) < 0);

                const boundaryDate = earlierEnd.add({ days: boundaryOffset });
                const actualMembership = [
                    isWithinInclusive(boundaryDate, actualEarlier),
                    isWithinInclusive(boundaryDate, actualLater)
                ];
                const oracleMembership = [
                    isWithinInclusive(boundaryDate, oracleEarlier),
                    isWithinInclusive(boundaryDate, oracleLater)
                ];

                assert.deepEqual(actualMembership, oracleMembership);
                assert.equal(
                    oracleMembership.filter(Boolean).length,
                    1,
                    `boundary date ${boundaryDate} must belong to exactly one period`
                );
            }
        ),
        propertyOptions({ numRuns: 100 })
    );
});

function adjacentBudgetMonth(budgetMonth) {
    const next = Temporal.PlainYearMonth.from({
        year: budgetMonth.year,
        month: budgetMonth.month
    }).add({ months: 1 });

    return {
        key: next.toString(),
        year: next.year,
        month: next.month
    };
}

/**
 * Independent Temporal oracle for a salary-cycle period. It calculates the
 * payday boundary directly instead of calling any resolver implementation.
 */
function independentPeriodOracle(budgetMonth) {
    const target = Temporal.PlainYearMonth.from({
        year: budgetMonth.year,
        month: budgetMonth.month
    });
    const preceding = target.subtract({ months: 1 });
    const startDate = independentActualPayday(preceding);
    const endDate = independentActualPayday(target).subtract({ days: 1 });

    return {
        startDate: startDate.toString(),
        endDate: endDate.toString()
    };
}

function independentActualPayday(yearMonth) {
    const nominalPayday = yearMonth.toPlainDate({ day: 25 });
    const daysToSubtract = nominalPayday.dayOfWeek === 6
        ? 1
        : nominalPayday.dayOfWeek === 7
            ? 2
            : 0;

    return nominalPayday.subtract({ days: daysToSubtract });
}

function isWithinInclusive(date, period) {
    const start = Temporal.PlainDate.from(period.startDate);
    const end = Temporal.PlainDate.from(period.endDate);
    return Temporal.PlainDate.compare(date, start) >= 0 &&
        Temporal.PlainDate.compare(date, end) <= 0;
}
