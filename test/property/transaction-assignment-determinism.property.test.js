'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { toCanonicalTransactionInput } = require('../../utils/transactionDto');
const { previewAssignment } = require('../../services/transactionService');
const { resolveBudgetMonth } = require('../../services/salaryCycleResolver');
const {
    calendarDateArbitrary,
    positiveIntegerRupiahArbitrary,
    pocketArbitrary
} = require('../arbitraries');
const { assertProperty } = require('../helpers/property');

const HOUSEHOLD_TIME_ZONE = 'Asia/Jakarta';
const userA = '000000000000000000000041';
const userB = '000000000000000000000042';

const transactionMetadataArbitrary = fc.record({
    type: fc.constantFrom('Groceries', 'Laundry', 'Others'),
    pocket: pocketArbitrary,
    amount: positiveIntegerRupiahArbitrary,
    paidBy: fc.constantFrom('Husband', 'Wife', 'Self'),
    ngapain: fc.constantFrom('market run', 'commute', 'monthly bill')
});

// Feature: salary-cycle-budgeting, Property 5: Assignment is deterministic and metadata-independent
// **Validates: Requirements 1.5, 2.5, 3.10**
test('Property 5: assignment is deterministic and metadata-independent', () => {
    assertProperty(fc.property(
        calendarDateArbitrary,
        transactionMetadataArbitrary,
        transactionMetadataArbitrary,
        (expenseDate, first, second) => {
            const firstInput = toCanonicalTransactionInput({
                expenseDate,
                ...first,
                sourceType: 'single'
            }, { timeZone: HOUSEHOLD_TIME_ZONE });
            const secondInput = toCanonicalTransactionInput({
                expenseDate,
                ...second,
                sourceType: 'single'
            }, { timeZone: HOUSEHOLD_TIME_ZONE });

            const firstAssignment = resolveBudgetMonth({
                expenseDate: firstInput.expenseDate,
                timeZone: HOUSEHOLD_TIME_ZONE
            });
            const secondAssignment = resolveBudgetMonth({
                expenseDate: secondInput.expenseDate,
                timeZone: HOUSEHOLD_TIME_ZONE
            });
            assert.deepEqual(firstAssignment, secondAssignment);

            const firstPreview = previewAssignment(expenseDate, { userId: userA }, {
                timeZone: HOUSEHOLD_TIME_ZONE
            });
            const secondPreview = previewAssignment(expenseDate, { userId: userB }, {
                timeZone: HOUSEHOLD_TIME_ZONE
            });
            assert.deepEqual(firstPreview, secondPreview);
            assert.deepEqual(firstPreview, previewAssignment(expenseDate, { userId: userA }, {
                timeZone: HOUSEHOLD_TIME_ZONE
            }));
        }
    ), { numRuns: 100 });
});
