'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { Temporal } = require('@js-temporal/polyfill');
const {
    getSalaryCyclePeriod,
    listIntersectingIsoWeeks
} = require('../services/salaryCycleResolver');

const HOUSEHOLD_TIME_ZONE = 'Asia/Jakarta';
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

function budgetMonth(year, month) {
    return {
        year,
        month,
        key: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
    };
}

const yearArbitrary = fc.integer({ min: MIN_YEAR, max: MAX_YEAR });
const leapYearArbitrary = yearArbitrary.filter(year =>
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
);
const monthArbitrary = fc.integer({ min: 1, max: 12 });

// Include ordinary months, leap Februaries, calendar-month edges, and known ISO-year edges.
const budgetMonthAcrossBoundariesArbitrary = fc.oneof(
    fc.record({ year: yearArbitrary, month: monthArbitrary }),
    fc.record({ year: leapYearArbitrary, month: fc.constant(2) }),
    fc.record({ year: yearArbitrary, month: fc.constantFrom(1, 12) }),
    fc.constantFrom(
        budgetMonth(2015, 12), // ISO 2015-W53 / 2016-W01 boundary
        budgetMonth(2020, 12), // ISO 2020-W53 / 2021-W01 boundary
        budgetMonth(2021, 1),
        budgetMonth(2026, 12), // ISO 2026-W53 / 2027-W01 boundary
        budgetMonth(2027, 1)
    )
).map(value => budgetMonth(value.year, value.month));

function enumeratePeriodDates(period) {
    const dates = [];
    const endDate = Temporal.PlainDate.from(period.endDate);

    for (
        let date = Temporal.PlainDate.from(period.startDate);
        Temporal.PlainDate.compare(date, endDate) <= 0;
        date = date.add({ days: 1 })
    ) {
        dates.push(date);
    }

    return dates;
}

/**
 * Independent oracle: derive each date's ISO week directly from Temporal's
 * calendar fields, then derive the full Monday-through-Sunday boundaries.
 */
function expectedIsoWeeks(periodDates) {
    const weeksByKey = new Map();

    for (const date of periodDates) {
        const monday = date.subtract({ days: date.dayOfWeek - 1 });
        const key = `${String(date.yearOfWeek).padStart(4, '0')}-W${String(date.weekOfYear).padStart(2, '0')}`;
        const existing = weeksByKey.get(key);

        if (existing) {
            existing.intersectionEndDate = date.toString();
            continue;
        }

        weeksByKey.set(key, {
            key,
            weekYear: date.yearOfWeek,
            weekNumber: date.weekOfYear,
            startDate: monday.toString(),
            endDate: monday.add({ days: 6 }).toString(),
            intersectionStartDate: date.toString(),
            intersectionEndDate: date.toString()
        });
    }

    return [...weeksByKey.values()];
}

function isWithinInclusive(date, startDate, endDate) {
    return Temporal.PlainDate.compare(date, Temporal.PlainDate.from(startDate)) >= 0 &&
        Temporal.PlainDate.compare(date, Temporal.PlainDate.from(endDate)) <= 0;
}

// Feature: salary-cycle-budgeting, Property 7: ISO weeks partition each salary-cycle period
// **Validates: Requirements 5.2**
test('Property 7: ISO weeks partition each salary-cycle period (Requirements 5.2)', () => {
    fc.assert(
        fc.property(budgetMonthAcrossBoundariesArbitrary, targetBudgetMonth => {
            const period = getSalaryCyclePeriod({
                budgetMonth: targetBudgetMonth,
                timeZone: HOUSEHOLD_TIME_ZONE
            });
            const periodDates = enumeratePeriodDates(period);
            const expectedWeeks = expectedIsoWeeks(periodDates);
            const actualWeeks = listIntersectingIsoWeeks({ period });

            assert.deepEqual(
                actualWeeks.map(week => week.key),
                expectedWeeks.map(week => week.key)
            );
            assert.deepEqual(
                actualWeeks.map(({ key, startDate, endDate }) => ({ key, startDate, endDate })),
                expectedWeeks.map(({ key, startDate, endDate }) => ({ key, startDate, endDate }))
            );
            assert.deepEqual(
                actualWeeks.map(({ key, intersectionStartDate, intersectionEndDate }) => ({
                    key,
                    intersectionStartDate,
                    intersectionEndDate
                })),
                expectedWeeks.map(({ key, intersectionStartDate, intersectionEndDate }) => ({
                    key,
                    intersectionStartDate,
                    intersectionEndDate
                }))
            );

            for (const week of actualWeeks) {
                const monday = Temporal.PlainDate.from(week.startDate);
                const sunday = Temporal.PlainDate.from(week.endDate);
                assert.equal(monday.dayOfWeek, 1);
                assert.equal(sunday.dayOfWeek, 7);
                assert.equal(sunday.toString(), monday.add({ days: 6 }).toString());
            }

            for (const date of periodDates) {
                const containingWeeks = actualWeeks.filter(week =>
                    isWithinInclusive(date, week.startDate, week.endDate)
                );
                assert.equal(
                    containingWeeks.length,
                    1,
                    `${date.toString()} must belong to exactly one returned ISO week`
                );
            }
        }),
        { numRuns: 150 }
    );
});
