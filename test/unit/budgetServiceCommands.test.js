'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const budgetService = require('../../services/budgetService');
const {
    AuthorizationError,
    ClosedBudgetPeriodError,
    DomainValidationError,
    EditableWindowError
} = require('../../utils/domainErrors');

const wife = { userId: new mongoose.Types.ObjectId(), role: 'Wife' };
const husband = { userId: new mongoose.Types.ObjectId(), role: 'Husband' };
const baseOptions = {
    nowInstant: '2027-02-01T04:00:00Z',
    timeZone: 'Asia/Jakarta',
    salaryCycleBudgetingEnabled: true
};

function matches(row, filter) {
    return Object.entries(filter).every(([key, value]) => row[key] === value);
}

function applyUpdate(row, update) {
    for (const [key, value] of Object.entries(update.$set || {})) row[key] = value;
    for (const [key, value] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + value;
}

function query(value) {
    return {
        session() { return this; },
        lean() { return this; },
        sort() { return this; },
        async exec() { return value; }
    };
}

function modelFor(store, { upsertAccepted = false } = {}) {
    const model = {
        find(filter) {
            return query(store.rows.filter(row => matches(row, filter)));
        },
        findOne(filter) {
            return query(store.rows.find(row => matches(row, filter)) || null);
        },
        findOneAndUpdate(filter, update, options = {}) {
            let row = store.rows.find(candidate => matches(candidate, filter));
            const inserted = !row && options.upsert;
            if (inserted) {
                row = { ...filter };
                store.rows.push(row);
            }
            if (row) {
                if (inserted) applyUpdate(row, { $set: update.$setOnInsert || {} });
                applyUpdate(row, update);
            }
            return query(row || null);
        },
        deleteOne(filter) {
            const index = store.rows.findIndex(row => matches(row, filter));
            if (index === -1) return query({ deletedCount: 0 });
            store.rows.splice(index, 1);
            return query({ deletedCount: 1 });
        }
    };
    if (upsertAccepted) {
        model.upsertAccepted = payload => model.findOneAndUpdate(
            { pocket: payload.pocket, month: payload.month, year: payload.year },
            {
                $set: {
                    budget: payload.budget,
                    updatedBy: payload.updatedBy,
                    schemaVersion: 2
                },
                $setOnInsert: { createdBy: payload.createdBy },
                $inc: { version: 1 }
            },
            { upsert: true, new: true }
        );
    }
    return model;
}

function createDatabase(models) {
    let transactionQueue = Promise.resolve();
    return {
        async startSession() {
            return {
                async withTransaction(operation) {
                    let release;
                    const previous = transactionQueue;
                    transactionQueue = new Promise(resolve => { release = resolve; });
                    await previous;
                    const snapshots = models.map(store => store.rows.map(row => ({ ...row })));
                    try {
                        await operation(this);
                    } catch (error) {
                        models.forEach((store, index) => {
                            store.rows.splice(0, store.rows.length, ...snapshots[index].map(row => ({ ...row })));
                        });
                        throw error;
                    } finally {
                        release();
                    }
                },
                async endSession() {}
            };
        }
    };
}

function fixture({ monthly = [], weekly = [], cadences = [], guards = [] } = {}) {
    const stores = [
        { rows: monthly },
        { rows: weekly },
        { rows: cadences },
        { rows: guards }
    ];
    const [monthlyStore, weeklyStore, cadenceStore, guardStore] = stores;
    const guardModel = modelFor(guardStore);
    guardModel.CURRENT_SCHEMA_VERSION = 2;
    guardModel.ensureOpen = ({ month, year, actor }) => guardModel.findOneAndUpdate(
        { month, year },
        {
            $setOnInsert: {
                isClosed: false,
                closedAt: null,
                updatedBy: actor,
                mutationSequence: 0,
                schemaVersion: 2
            }
        },
        { upsert: true, new: true }
    );
    return {
        stores,
        options: {
            ...baseOptions,
            connection: createDatabase(stores),
            monthlyModel: modelFor(monthlyStore, { upsertAccepted: true }),
            weeklyModel: modelFor(weeklyStore),
            cadenceModel: modelFor(cadenceStore),
            guardModel
        }
    };
}

test('requires Wife authorization before any budget command can write', async () => {
    const { options } = fixture();
    await assert.rejects(
        () => budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-02', amount: 100 }, husband, options),
        error => error instanceof AuthorizationError && error.code === 'WIFE_ROLE_REQUIRED'
    );
});

test('accepts only the active or immediately following open Budget Month', async () => {
    const { options, stores } = fixture();
    await budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-02', amount: 100 }, wife, options);
    await budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-03', amount: 200 }, wife, options);
    await assert.rejects(
        () => budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-01', amount: 300 }, wife, options),
        error => error instanceof EditableWindowError
    );
    assert.deepEqual(stores[0].rows.map(row => row.budget), [100, 200]);
});

test('requires inactive-allocation confirmation and preserves inactive records', async () => {
    const monthly = [{ _id: 'monthly-1', pocket: 'Groceries', month: 2, year: 2027, budget: 1000, version: 1 }];
    const { options, stores } = fixture({ monthly });
    await assert.rejects(
        () => budgetService.setCadence({ pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly' }, wife, options),
        error => error instanceof DomainValidationError && error.field === 'confirmInactive'
    );
    assert.equal(stores[2].rows.length, 0);
    assert.equal(stores[0].rows[0].budget, 1000);

    await budgetService.setCadence({
        pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly', confirmInactive: true
    }, wife, options);
    assert.equal(stores[2].rows[0].cadence, 'Weekly');
    assert.equal(stores[0].rows[0].budget, 1000);
});

test('validates weekly intersection and isolates exact week keys', async () => {
    const { options, stores } = fixture();
    await budgetService.putWeeklyAllocation({
        pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W05', amount: 500
    }, wife, options);
    await budgetService.putWeeklyAllocation({
        pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W06', amount: 600
    }, wife, options);
    await assert.rejects(
        () => budgetService.putWeeklyAllocation({
            pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W03', amount: 700
        }, wife, options),
        error => error instanceof DomainValidationError && error.field === 'isoWeek'
    );
    assert.deepEqual(stores[1].rows.map(row => row.budget), [500, 600]);
    assert.deepEqual(stores[1].rows.map(row => row.isoWeekNumber), [5, 6]);
});

test('closed guard rejects writes and transaction rollback removes the fence increment', async () => {
    const guard = { month: 2, year: 2027, isClosed: true, mutationSequence: 4 };
    const { options, stores } = fixture({ guards: [guard] });
    await assert.rejects(
        () => budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-02', amount: 100 }, wife, options),
        error => error instanceof ClosedBudgetPeriodError && error.details.budgetMonth === '2027-02'
    );
    assert.equal(stores[0].rows.length, 0);
    assert.equal(guard.mutationSequence, 4);
});

test('close and reopen serialize through the persistent guard without replacing it', async () => {
    const { options, stores } = fixture();
    const closed = await budgetService.toggleBudgetMonthClosed({ budgetMonth: '2027-02' }, wife, options);
    const guardId = stores[3].rows[0];
    assert.equal(closed.isClosed, true);
    assert.equal(stores[3].rows.length, 1);
    assert.equal(stores[3].rows[0].mutationSequence, 1);

    const reopened = await budgetService.toggleBudgetMonthClosed({ budgetMonth: '2027-02' }, wife, options);
    assert.equal(reopened.isClosed, false);
    assert.equal(stores[3].rows[0], guardId);
    assert.equal(stores[3].rows[0].mutationSequence, 2);
});

test('retries a duplicate-key transaction and returns a complete accepted upsert', async () => {
    const { options, stores } = fixture();
    let attempts = 0;
    const original = options.monthlyModel.upsertAccepted;
    options.monthlyModel.upsertAccepted = (...args) => {
        attempts += 1;
        if (attempts === 1) {
            const error = new Error('duplicate key');
            error.code = 11000;
            throw error;
        }
        return original(...args);
    };
    const result = await budgetService.putMonthlyAllocation({
        pocket: 'Groceries', budgetMonth: '2027-02', amount: 900
    }, wife, options);
    assert.equal(attempts, 2);
    assert.equal(result.amount, 900);
    assert.equal(result.budget, 900);
    assert.equal(result.version, 1);
    assert.equal(stores[0].rows.length, 1);
});
