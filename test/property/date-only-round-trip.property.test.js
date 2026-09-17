'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
    compatibilityDateForExpenseDate,
    expenseDateFromCompatibilityDate
} = require('../../utils/transactionValidators');
const { toCanonicalTransactionInput, toTransactionDto } = require('../../utils/transactionDto');
const { resolveBudgetMonth } = require('../../services/salaryCycleResolver');
const { calendarDateArbitrary } = require('../arbitraries');
const { assertProperty } = require('../helpers/property');

const supportedTimeZones = fc.constantFrom(
    'Asia/Jakarta',
    'America/Los_Angeles',
    'Pacific/Kiritimati',
    'Europe/Berlin'
);
const userId = '000000000000000000000042';

// Feature: salary-cycle-budgeting, Property 6: Date-only assignment and round trips are time-zone independent
// **Validates: Requirements 11.1, 11.3, 11.4, 11.5, 11.6, 11.10**
test('Property 6: date-only assignment and DTO round trips are time-zone independent', () => {
    assertProperty(fc.property(
        calendarDateArbitrary,
        supportedTimeZones,
        (expenseDate, timeZone) => {
            const compatibilityInstant = compatibilityDateForExpenseDate(expenseDate, timeZone);
            assert.equal(
                expenseDateFromCompatibilityDate(compatibilityInstant, timeZone),
                expenseDate
            );

            const input = toCanonicalTransactionInput({
                expenseDate,
                type: 'Groceries',
                pocket: 'Groceries',
                ngapain: 'date-only round trip',
                amount: 1000,
                paidBy: 'Self',
                sourceType: 'single',
                by: userId
            }, { timeZone });
            const assignment = resolveBudgetMonth({ expenseDate, timeZone });
            const dto = toTransactionDto({
                ...input,
                budgetMonth: assignment.month,
                budgetYear: assignment.year,
                by: userId
            }, { timeZone });

            assert.equal(input.expenseDate, expenseDate);
            assert.equal(dto.expenseDate, expenseDate);
            assert.equal(dto.date, expenseDate);
            assert.equal(dto.budgetMonth, assignment.month);
            assert.equal(dto.budgetYear, assignment.year);
        }
    ), { numRuns: 100 });
});
