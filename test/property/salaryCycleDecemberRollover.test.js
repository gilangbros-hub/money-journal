'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { Temporal } = require('@js-temporal/polyfill');
const {
    getSalaryCyclePeriod,
    resolveBudgetMonth
} = require('../../services/salaryCycleResolver');
const {
    assertProperty,
    propertyOptions
} = require('../helpers');
const { yearArbitrary } = require('../arbitraries');

const TIME_ZONE = 'Asia/Jakarta';

function independentDecemberPayday(year) {
    const nominalPayday = Temporal.PlainDate.from({ year, month: 12, day: 25 });
    const daysToSubtract = nominalPayday.dayOfWeek === 6
        ? 1
        : nominalPayday.dayOfWeek === 7
            ? 2
            : 0;

    return nominalPayday.subtract({ days: daysToSubtract });
}

const decemberDateFromActualPaydayArbitrary = yearArbitrary.chain(year => {
    const actualPayday = independentDecemberPayday(year);
    const daysAfterPayday = 31 - actualPayday.day;

    return fc.integer({ min: 0, max: daysAfterPayday }).map(offset => ({
        year,
        expenseDate: actualPayday.add({ days: offset }).toString(),
        actualPayday
    }));
});

// Feature: salary-cycle-budgeting, Property 4: December assignment rolls into the following year
// Validates: Requirements 2.3, 2.4, 9.3
test('Property 4: every December expense from the actual payday through month-end rolls into January', () => {
    assertProperty(
        fc.property(decemberDateFromActualPaydayArbitrary, ({ year, expenseDate, actualPayday }) => {
            const assignedBudgetMonth = resolveBudgetMonth({
                expenseDate,
                timeZone: TIME_ZONE
            });
            const januaryPeriod = getSalaryCyclePeriod({
                budgetMonth: { year: year + 1, month: 1 },
                timeZone: TIME_ZONE
            });

            assert.deepEqual(assignedBudgetMonth, {
                key: `${String(year + 1).padStart(4, '0')}-01`,
                year: year + 1,
                month: 1
            });
            assert.equal(januaryPeriod.startDate, actualPayday.toString());
        }),
        propertyOptions({ seed: 240126 })
    );
});
