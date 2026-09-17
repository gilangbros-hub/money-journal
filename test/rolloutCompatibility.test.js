'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createConfiguration } = require('../config');
const { createExpense } = require('../services/transactionService');
const { putWeeklyAllocation } = require('../services/budgetService');
const { requireSalaryCycleFeature } = require('../middleware/auth');
const { AssignmentConflictError, FeatureDisabledError } = require('../utils/domainErrors');

const userId = new mongoose.Types.ObjectId().toString();

function query(value) {
    return {
        session() { return this; },
        populate() { return this; },
        sort() { return this; },
        lean() { return this; },
        async exec() { return typeof value === 'function' ? value() : value; }
    };
}

function fakeModels() {
    const records = [];
    class FakeTransaction {
        constructor(data) { Object.assign(this, data); this._id = new mongoose.Types.ObjectId(); }
        toObject() { return { ...this }; }
        async save() { records.push(this); return this; }
    }
    FakeTransaction.findById = () => query(null);
    const guardModel = {
        ensureOpen({ month, year }) { return Promise.resolve({ month, year, isClosed: false, mutationSequence: 0 }); },
        findOneAndUpdate() { return Promise.resolve({ isClosed: false }); }
    };
    const connection = {
        async startSession() {
            return { async withTransaction(operation) { return operation(this); }, async endSession() {} };
        }
    };
    return { records, transactionModel: FakeTransaction, guardModel, connection };
}

function expense(overrides = {}) {
    return {
        expenseDate: '2027-02-24',
        type: 'Groceries',
        pocket: 'Groceries',
        ngapain: 'compatibility check',
        amount: 1000,
        paidBy: 'Self',
        sourceType: 'single',
        ...overrides
    };
}

test('feature-off accepts legacy assignment and still writes canonical/legacy date aliases', async () => {
    const models = fakeModels();
    const result = await createExpense(
        expense({ budgetMonth: 9, budgetYear: 2027 }),
        { userId },
        { ...models, salaryCycleBudgetingEnabled: false }
    );

    assert.equal(result.expenseDate, '2027-02-24');
    assert.equal(result.date, '2027-02-24');
    assert.equal(result.budgetMonth, 9);
    assert.equal(result.budgetYear, 2027);
    assert.equal(result.assignmentVersion, 'legacy-preserved');
    assert.equal(result.schemaVersion, 2);
});

test('feature-on rejects a conflicting legacy assignment with derived details', async () => {
    const models = fakeModels();
    await assert.rejects(
        () => createExpense(
            expense({ budgetMonth: 9, budgetYear: 2027 }),
            { userId },
            { ...models, salaryCycleBudgetingEnabled: true }
        ),
        error => error instanceof AssignmentConflictError &&
            error.details.derivedBudgetMonth === '2027-02'
    );
    assert.equal(models.records.length, 0);
});

test('weekly mutations are rejected while the feature is disabled', async () => {
    await assert.rejects(
        () => putWeeklyAllocation(
            { pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W08', amount: 1000 },
            { userId, role: 'Wife' },
            { salaryCycleBudgetingEnabled: false }
        ),
        error => error instanceof FeatureDisabledError && error.code === 'SALARY_CYCLE_FEATURE_DISABLED'
    );
});

test('the route gate leaves authenticated monthly routes alone and rejects rollout-only commands', () => {
    const nextCalls = [];
    const request = { app: { locals: { configuration: createConfiguration({ SALARY_CYCLE_BUDGETING_ENABLED: 'false' }) } } };
    requireSalaryCycleFeature(request, {}, error => nextCalls.push(error));
    assert.equal(nextCalls.length, 1);
    assert.equal(nextCalls[0].code, 'SALARY_CYCLE_FEATURE_DISABLED');

    const enabled = { app: { locals: { configuration: createConfiguration({ SALARY_CYCLE_BUDGETING_ENABLED: 'true' }) } } };
    requireSalaryCycleFeature(enabled, {}, error => nextCalls.push(error));
    assert.equal(nextCalls[1], undefined);
});
