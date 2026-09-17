'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');

const userId = new mongoose.Types.ObjectId();

const baseTransaction = (overrides = {}) => new Transaction({
    type: 'Groceries',
    pocket: 'Groceries',
    ngapain: 'market run',
    by: userId,
    paidBy: 'Self',
    amount: 125000,
    budgetMonth: 4,
    budgetYear: 2026,
    ...overrides
});

test('legacy transactions remain readable with compatibility defaults', async () => {
    const transaction = baseTransaction({
        date: new Date('2026-04-23T05:00:00.000Z'),
        sourceType: 'multi',
        sourceBreakdowns: [
            { pocket: 'Groceries', amount: 75000 },
            { pocket: 'Kwintals', amount: 50000 }
        ]
    });

    await assert.doesNotReject(() => transaction.validate());
    assert.equal(transaction.schemaVersion, 1);
    assert.equal(transaction.assignmentVersion, 'legacy-preserved');
    assert.equal(transaction.expenseDate, undefined);
    assert.equal(transaction.budgetMonth, 4);
    assert.equal(transaction.budgetYear, 2026);
    assert.equal(transaction.sourceBreakdowns.length, 2);
    assert.ok(transaction.date instanceof Date);
});

test('canonical schema-v2 transactions validate the date-only field and preserve compatibility fields', async () => {
    const transaction = baseTransaction({
        expenseDate: '2026-04-24',
        schemaVersion: 2,
        assignmentVersion: 'salary-cycle-v1',
        date: new Date('2026-04-24T05:00:00.000Z'),
        sourceType: 'multi',
        sourceBreakdowns: [
            { pocket: 'Groceries', amount: 75000 },
            { pocket: 'Kwintals', amount: 50000 }
        ]
    });

    await assert.doesNotReject(() => transaction.validate());
    assert.equal(transaction.schemaVersion, 2);
    assert.equal(transaction.assignmentVersion, 'salary-cycle-v1');
    assert.equal(transaction.expenseDate, '2026-04-24');
    assert.equal(transaction.budgetMonth, 4);
    assert.equal(transaction.budgetYear, 2026);
    assert.equal(transaction.sourceBreakdowns[1].amount, 50000);
    assert.equal(Transaction.schema.path('createdAt').instance, 'Date');
    assert.equal(Transaction.schema.path('updatedAt').instance, 'Date');
});

test('schema-v2 requires a valid canonical date-only value', async () => {
    for (const expenseDate of ['2026-4-24', '2026-04-31', '2026-02-29', new Date('2026-04-24')]) {
        const transaction = baseTransaction({
            schemaVersion: 2,
            assignmentVersion: 'salary-cycle-v1',
            expenseDate
        });

        await assert.rejects(
            () => transaction.validate(),
            error => error instanceof mongoose.Error.ValidationError &&
                Boolean(error.errors.expenseDate)
        );
    }

    const missingDate = baseTransaction({
        schemaVersion: 2,
        assignmentVersion: 'legacy-preserved'
    });
    await assert.rejects(
        () => missingDate.validate(),
        error => error instanceof mongoose.Error.ValidationError &&
            Boolean(error.errors.expenseDate)
    );
});

test('budget assignment remains numeric and integer-valued', async () => {
    const transaction = baseTransaction({
        expenseDate: '2026-04-24',
        budgetMonth: '4',
        budgetYear: '2026'
    });

    await assert.doesNotReject(() => transaction.validate());
    assert.equal(transaction.budgetMonth, 4);
    assert.equal(transaction.budgetYear, 2026);

    const fractionalAssignment = baseTransaction({
        budgetMonth: 4.5,
        budgetYear: 2026
    });
    await assert.rejects(() => fractionalAssignment.validate(), mongoose.Error.ValidationError);
});

test('transaction schema exposes the salary-cycle reporting indexes', () => {
    const indexes = Transaction.schema.indexes().map(([fields]) => fields);

    assert.ok(indexes.some(fields =>
        fields.budgetYear === 1 && fields.budgetMonth === 1 && fields.expenseDate === -1
    ));
    assert.ok(indexes.some(fields =>
        fields.budgetYear === 1 && fields.budgetMonth === 1 && fields.pocket === 1
    ));
    assert.ok(indexes.some(fields =>
        fields.budgetYear === 1 && fields.budgetMonth === 1 &&
        fields['sourceBreakdowns.pocket'] === 1 && fields.expenseDate === 1
    ));
});
