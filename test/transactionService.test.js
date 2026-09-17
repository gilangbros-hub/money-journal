'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
    createExpense,
    updateExpense,
    deleteExpense,
    getExpense,
    listExpenses
} = require('../services/transactionService');
const {
    AssignmentConflictError,
    ClosedBudgetPeriodError
} = require('../utils/domainErrors');

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

function createFakeModels() {
    const records = new Map();
    const guards = new Map();

    class FakeTransaction {
        constructor(data) {
            Object.assign(this, data);
            this._id = this._id || new mongoose.Types.ObjectId();
        }

        toObject() { return { ...this }; }

        async save() {
            records.set(this._id.toString(), this);
            return this;
        }

        async deleteOne() {
            records.delete(this._id.toString());
        }
    }

    FakeTransaction.findById = id => query(records.get(id.toString()) || null);
    FakeTransaction.find = filter => query(() => [...records.values()].filter(record => {
        if (filter.budgetMonth !== undefined && record.budgetMonth !== filter.budgetMonth) return false;
        if (filter.budgetYear !== undefined && record.budgetYear !== filter.budgetYear) return false;
        if (filter.$or) {
            return filter.$or.some(condition =>
                condition.pocket === record.pocket ||
                condition['sourceBreakdowns.pocket'] &&
                record.sourceBreakdowns.some(share => share.pocket === condition['sourceBreakdowns.pocket'])
            );
        }
        return true;
    }));

    const guardModel = {
        ensureOpen({ month, year }) {
            const key = `${year}-${month}`;
            if (!guards.has(key)) guards.set(key, { month, year, isClosed: false, mutationSequence: 0 });
            return Promise.resolve(guards.get(key));
        },
        findOneAndUpdate({ month, year }) {
            const guard = guards.get(`${year}-${month}`);
            if (!guard || guard.isClosed) return Promise.resolve(null);
            guard.mutationSequence += 1;
            return Promise.resolve(guard);
        },
        findOne({ month, year }) {
            return Promise.resolve(guards.get(`${year}-${month}`) || null);
        }
    };

    const connection = {
        async startSession() {
            return {
                async withTransaction(operation) { return operation(this); },
                async endSession() {}
            };
        }
    };

    return {
        records,
        guards,
        transactionModel: FakeTransaction,
        guardModel,
        connection,
        close(month, year) {
            const key = `${year}-${month}`;
            guards.set(key, { month, year, isClosed: true, mutationSequence: 1 });
        }
    };
}

function command(overrides = {}) {
    return {
        expenseDate: '2027-02-24',
        type: 'Groceries',
        pocket: 'Groceries',
        ngapain: 'market run',
        amount: 125000,
        paidBy: 'Self',
        sourceType: 'single',
        ...overrides
    };
}

function options(models, notificationQueue) {
    return {
        ...models,
        notificationQueue
    };
}

test('create derives and stores the salary-cycle assignment and queues after commit', async () => {
    const models = createFakeModels();
    const events = [];
    const result = await createExpense(
        command(),
        { userId, username: 'wife-test', notificationQueue: event => events.push(event) },
        options(models)
    );

    // 2027-02-24 is before the February payday, so it belongs to 2027-02.
    assert.equal(result.expenseDate, '2027-02-24');
    assert.equal(result.date, '2027-02-24');
    assert.equal(result.budgetMonth, 2);
    assert.equal(result.budgetYear, 2027);
    assert.equal(result.schemaVersion, 2);
    assert.equal(models.records.size, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'expense-created');
    assert.equal(models.guards.get('2027-2').mutationSequence, 1);
});

test('matching legacy assignment is accepted and a conflict is rejected before any write', async () => {
    const models = createFakeModels();
    const matching = await createExpense(
        command({ budgetMonth: '2', budgetYear: '2027' }),
        { userId },
        options(models)
    );
    assert.equal(matching.budgetMonth, 2);

    await assert.rejects(
        () => createExpense(
            command({ budgetMonth: 3, budgetYear: 2027 }),
            { userId },
            options(models)
        ),
        error => error instanceof AssignmentConflictError &&
            error.details.derivedBudgetMonth === '2027-02'
    );
    assert.equal(models.records.size, 1);
});

test('update fences both periods in sorted order and delete fences the stored period', async () => {
    const models = createFakeModels();
    const created = await createExpense(
        command({ expenseDate: '2027-02-24' }),
        { userId },
        options(models)
    );

    const updated = await updateExpense(
        created._id,
        command({ expenseDate: '2027-03-24', amount: 150000 }),
        { userId: new mongoose.Types.ObjectId().toString() },
        options(models)
    );
    assert.equal(updated.expenseDate, '2027-03-24');
    assert.equal(updated.budgetMonth, 3);
    assert.equal(updated.by.toString(), userId);
    assert.equal(models.guards.get('2027-2').mutationSequence, 2);
    assert.equal(models.guards.get('2027-3').mutationSequence, 1);

    const deleted = await deleteExpense(created._id, { userId }, options(models));
    assert.equal(deleted.success, true);
    assert.equal(models.records.size, 0);
    assert.equal(models.guards.get('2027-3').mutationSequence, 2);
});

test('closed source or destination periods reject mutations without changing the transaction', async () => {
    const models = createFakeModels();
    const created = await createExpense(command(), { userId }, options(models));
    const before = { ...models.records.values().next().value };
    models.close(3, 2027);

    await assert.rejects(
        () => updateExpense(
            created._id,
            command({ expenseDate: '2027-03-24' }),
            { userId },
            options(models)
        ),
        error => error instanceof ClosedBudgetPeriodError && error.details.budgetMonth === '2027-03'
    );
    assert.deepEqual({ ...models.records.values().next().value }, before);
});

test('get and list use stored assignment and preserve canonical dates and split shares', async () => {
    const models = createFakeModels();
    const created = await createExpense(
        command({
            expenseDate: '2027-02-24',
            amount: 150000,
            sourceType: 'multi',
            pocket: 'Groceries',
            sourceBreakdowns: [
                { pocket: 'Groceries', amount: 100000 },
                { pocket: 'Kwintals', amount: 50000 }
            ]
        }),
        { userId },
        options(models)
    );

    const fetched = await getExpense(created._id, {}, options(models));
    assert.equal(fetched.expenseDate, '2027-02-24');
    assert.equal(fetched.budgetMonth, 2);
    assert.deepEqual(fetched.sourceBreakdowns, [
        { pocket: 'Groceries', amount: 100000 },
        { pocket: 'Kwintals', amount: 50000 }
    ]);

    const listed = await listExpenses({ month: '2027-02', pocket: 'Kwintals' }, {}, options(models));
    assert.equal(listed.length, 1);
    assert.equal(listed[0].date, '2027-02-24');
});

test('notification failures do not fail a committed expense', async () => {
    const models = createFakeModels();
    const result = await createExpense(
        command(),
        { userId },
        options(models, async () => { throw new Error('queue unavailable'); })
    );
    assert.equal(result.budgetMonth, 2);
    assert.equal(models.records.size, 1);
});
