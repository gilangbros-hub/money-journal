'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { DomainValidationError } = require('../utils/domainErrors');
const {
    compatibilityDateForExpenseDate,
    expenseDateFromCompatibilityDate,
    normalizeSourceBreakdowns,
    normalizeTransactionSource,
    validateAmount,
    validateCategory,
    validateExpenseDate,
    validateIdentifier,
    validatePayer,
    validatePocket,
    validateSourceType
} = require('../utils/transactionValidators');
const {
    toCanonicalTransactionInput,
    toTransactionDto
} = require('../utils/transactionDto');

function assertValidation(action, field) {
    assert.throws(action, error =>
        error instanceof DomainValidationError &&
        error.code === 'VALIDATION_ERROR' &&
        error.field === field
    );
}

test('transaction field validators accept canonical values and reject malformed values by field', () => {
    assert.equal(validateExpenseDate('2026-04-24'), '2026-04-24');
    assert.equal(validateIdentifier('0123456789abcdef01234567'), '0123456789abcdef01234567');
    const objectId = new mongoose.Types.ObjectId();
    assert.equal(validateIdentifier(objectId), objectId.toString());
    assert.equal(validateAmount(125000), 125000);
    assert.equal(validateAmount('125000'), 125000);
    assert.equal(validateCategory('Groceries'), 'Groceries');
    assert.equal(validatePocket('Kwintals'), 'Kwintals');
    assert.equal(validatePayer('Wife'), 'Wife');
    assert.equal(validateSourceType('multi'), 'multi');

    for (const value of ['', '2026-4-24', '2026-02-30', new Date('2026-04-24')]) {
        assertValidation(() => validateExpenseDate(value), 'expenseDate');
    }
    for (const value of ['123', 'not-an-id', {}, new mongoose.Types.ObjectId().toString().slice(0, 23)]) {
        assertValidation(() => validateIdentifier(value), 'id');
    }
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '12.5', ' 12']) {
        assertValidation(() => validateAmount(value), 'amount');
    }
    // 'type' is a shape check now (1-50 characters), not a fixed enum: Expense
    // Type is a managed collection, and "must actually be a defined, active
    // type" is TransactionService's runtime existence check, not this pure
    // validator's job. 'Unknown' is a well-formed category name.
    assert.equal(validateCategory('Unknown'), 'Unknown');
    for (const value of ['', '   ', 'x'.repeat(51), 42, null, undefined]) {
        assertValidation(() => validateCategory(value), 'type');
    }
    assertValidation(() => validatePocket('Unknown'), 'pocket');
    assertValidation(() => validatePayer('Partner'), 'paidBy');
    assertValidation(() => validateSourceType('daily'), 'sourceType');
});

test('split normalization requires one to three unique positive integer shares summing exactly', () => {
    assert.deepEqual(normalizeSourceBreakdowns([
        { pocket: 'Groceries', amount: 75000 },
        { pocket: 'Kwintals', amount: 50000 }
    ], 125000), [
        { pocket: 'Groceries', amount: 75000 },
        { pocket: 'Kwintals', amount: 50000 }
    ]);

    const invalidCases = [
        { shares: [], amount: 100, field: 'sourceBreakdowns' },
        { shares: [{ pocket: 'Groceries', amount: 100 }, { pocket: 'Groceries', amount: 1 }], amount: 101, field: 'sourceBreakdowns.1.pocket' },
        { shares: [{ pocket: 'Groceries', amount: 0 }], amount: 0, field: 'amount' },
        { shares: [{ pocket: 'Groceries', amount: 100 }, { pocket: 'Kwintals', amount: 50 }], amount: 149, field: 'sourceBreakdowns' },
        { shares: [{ pocket: 'Groceries', amount: 100 }, { pocket: 'Kwintals', amount: 50 }, { pocket: 'IPL', amount: 25 }, { pocket: 'Bandung', amount: 1 }], amount: 176, field: 'sourceBreakdowns' }
    ];

    for (const { shares, amount, field } of invalidCases) {
        assertValidation(() => normalizeSourceBreakdowns(shares, amount), field);
    }
});

test('invalid multi-pocket input is rejected instead of being downgraded to a single pocket', () => {
    assertValidation(() => normalizeTransactionSource({
        sourceType: 'multi',
        pocket: 'Kwintals',
        sourceBreakdowns: [{ pocket: 'Not a pocket', amount: 100 }],
        amount: 100
    }), 'sourceBreakdowns.0.pocket');

    assertValidation(() => normalizeTransactionSource({
        sourceType: 'multi',
        pocket: 'Not a pocket',
        sourceBreakdowns: [{ pocket: 'Groceries', amount: 100 }],
        amount: 100
    }), 'pocket');

    assertValidation(() => normalizeTransactionSource({
        sourceType: 'single',
        pocket: 'Kwintals',
        sourceBreakdowns: { pocket: 'Groceries', amount: 100 },
        amount: 100
    }), 'sourceBreakdowns');

    assertValidation(() => normalizeTransactionSource({
        sourceType: 'single',
        pocket: 'Kwintals',
        sourceBreakdowns: [{ pocket: 'Groceries', amount: 100 }],
        amount: 100
    }), 'sourceBreakdowns');

    assert.deepEqual(normalizeTransactionSource({
        sourceType: 'multi',
        pocket: 'Kwintals',
        sourceBreakdowns: [{ pocket: 'Groceries', amount: 100 }, { pocket: 'IPL', amount: 50 }],
        amount: 150
    }), {
        sourceType: 'multi',
        pocket: 'Groceries',
        sourceBreakdowns: [
            { pocket: 'Groceries', amount: 100 },
            { pocket: 'IPL', amount: 50 }
        ]
    });
});

test('canonical input mapper preserves date-only values and creates a local-noon compatibility instant', () => {
    const mapped = toCanonicalTransactionInput({
        date: '2026-04-24',
        type: 'Groceries',
        pocket: 'Kwintals',
        ngapain: 'market run',
        amount: '125000',
        paidBy: 'Self',
        sourceType: 'single',
        by: '0123456789abcdef01234567'
    });

    assert.equal(mapped.expenseDate, '2026-04-24');
    assert.equal(mapped.date.toISOString(), '2026-04-24T05:00:00.000Z');
    assert.equal(expenseDateFromCompatibilityDate(mapped.date), '2026-04-24');
    assert.equal(mapped.amount, 125000);
    assert.deepEqual(mapped.sourceBreakdowns, []);
});

test('response mapper returns the exact canonical date and date-only compatibility alias', () => {
    const result = toTransactionDto({
        _id: 'transaction-1',
        expenseDate: '2026-04-24',
        date: new Date('2026-04-24T05:00:00.000Z'),
        type: 'Groceries',
        pocket: 'Kwintals',
        ngapain: 'market run',
        amount: 125000,
        paidBy: 'Self',
        sourceType: 'single',
        sourceBreakdowns: []
    });

    assert.equal(result.expenseDate, '2026-04-24');
    assert.equal(result.date, '2026-04-24');
    assert.equal(result._id, 'transaction-1');
});

test('response mapper derives a canonical local date for a legacy compatibility record', () => {
    const result = toTransactionDto({
        date: new Date('2026-04-24T05:00:00.000Z'),
        type: 'Groceries',
        pocket: 'Kwintals',
        ngapain: 'market run',
        amount: 125000,
        paidBy: 'Self',
        sourceType: 'single',
        sourceBreakdowns: []
    });

    assert.equal(result.expenseDate, '2026-04-24');
    assert.equal(result.date, '2026-04-24');
});
