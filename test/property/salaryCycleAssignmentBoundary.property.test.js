'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { Temporal } = require('@js-temporal/polyfill');
const {
    getActiveBudgetMonth,
    resolveBudgetMonth
} = require('../../services/salaryCycleResolver');
const {
    yearArbitrary,
    monthArbitrary
} = require('../arbitraries');
const { assertProperty } = require('../helpers/property');

const HOUSEHOLD_TIME_ZONE = 'Asia/Jakarta';

function independentActualPayday(year, month) {
    const nominalPayday = Temporal.PlainDate.from({ year, month, day: 25 });
    const daysToSubtract = nominalPayday.dayOfWeek === 6
        ? 1
        : nominalPayday.dayOfWeek === 7
            ? 2
            : 0;

    return nominalPayday.subtract({ days: daysToSubtract });
}

function expectedBudgetMonth(date, actualPayday) {
    const currentMonth = Temporal.PlainYearMonth.from({
        year: date.year,
        month: date.month
    });
    const assignedMonth = Temporal.PlainDate.compare(date, actualPayday) < 0
        ? currentMonth
        : currentMonth.add({ months: 1 });

    return {
        key: assignedMonth.toString(),
        year: assignedMonth.year,
        month: assignedMonth.month
    };
}

function instantAtLocalNoon(date) {
    return date.toZonedDateTime({
        timeZone: HOUSEHOLD_TIME_ZONE,
        plainTime: Temporal.PlainTime.from('12:00')
    }).toInstant().toString();
}

function validMonthAndDateArbitrary() {
    return fc.tuple(yearArbitrary, monthArbitrary).chain(([year, month]) => {
        const daysInMonth = Temporal.PlainDate.from({ year, month, day: 1 }).daysInMonth;
        return fc.integer({ min: 1, max: daysInMonth }).map(day => ({
            year,
            month,
            date: Temporal.PlainDate.from({ year, month, day })
        }));
    });
}

function assertAssignment(date, actualPayday, expected) {
    assert.deepEqual(resolveBudgetMonth({
        expenseDate: date.toString(),
        timeZone: HOUSEHOLD_TIME_ZONE
    }), expected);

    assert.deepEqual(getActiveBudgetMonth({
        nowInstant: instantAtLocalNoon(date),
        timeZone: HOUSEHOLD_TIME_ZONE
    }), expected);
}

// Feature: salary-cycle-budgeting, Property 3: Payday is the inclusive assignment boundary
// Validates: Requirements 2.1, 2.2, 9.1, 9.2
test('Property 3: payday is the inclusive assignment boundary', () => {
    assertProperty(fc.property(validMonthAndDateArbitrary(), ({ year, month, date }) => {
        const actualPayday = independentActualPayday(year, month);
        const expectedForGeneratedDate = expectedBudgetMonth(date, actualPayday);

        // Exercise every valid date in the generated month, including both sides
        // of the independently calculated payday when the generated date varies.
        assertAssignment(date, actualPayday, expectedForGeneratedDate);

        const beforePayday = actualPayday.subtract({ days: 1 });
        const onPayday = actualPayday;
        const afterPayday = actualPayday.add({ days: 1 });
        const currentMonth = {
            key: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
            year,
            month
        };
        const nextMonth = Temporal.PlainYearMonth.from({ year, month }).add({ months: 1 });
        const followingMonth = {
            key: nextMonth.toString(),
            year: nextMonth.year,
            month: nextMonth.month
        };

        assertAssignment(beforePayday, actualPayday, currentMonth);
        assertAssignment(onPayday, actualPayday, followingMonth);
        assertAssignment(afterPayday, actualPayday, followingMonth);
    }), { numRuns: 100 });
});
