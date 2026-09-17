'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const Transaction = require('../../models/transaction');
const PocketBudget = require('../../models/pocketBudget');
const ClosedMonth = require('../../models/closedMonth');
const transactionRoutes = require('../../routes/transactions');
const budgetRoutes = require('../../routes/budget');
const { errorHandler, requestIdMiddleware } = require('../../middleware/errorHandler');
const { withIsolatedDatabase } = require('../helpers/isolatedDatabase');
const {
    approveMigrationPreview,
    approveMigrationRollback,
    checkTransactionsSupported,
    createAndPersistPreview,
    executeMigrationPreview,
    rollbackMigrationPreview,
    runTransaction,
    verifyMigrationPreview
} = require('../../services/migrationService');

function clone(value) {
    if (value instanceof Date) return new Date(value);
    if (value && value._bsontype === 'ObjectId') return new mongoose.Types.ObjectId(String(value));
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
    return value;
}

class Query {
    constructor(resolve) { this.resolve = resolve; }
    session() { return this; }
    lean() { return this; }
    sort() { return this; }
    exec() { return Promise.resolve(this.resolve()); }
    then(resolve, reject) { return this.exec().then(resolve, reject); }
}

function matches(record, filter) {
    return Object.entries(filter).every(([key, value]) => {
        if (value && typeof value === 'object' && '$exists' in value) return (record[key] !== undefined) === value.$exists;
        if (value && typeof value === 'object' && value._bsontype === 'ObjectId') return String(record[key]) === String(value);
        return String(record[key]) === String(value);
    });
}

function collection(data) {
    return {
        findOne(filter) { return data.find(record => matches(record, filter)) || null; },
        async insertOne(record) { data.push(clone(record)); return { acknowledged: true, insertedId: record._id }; },
        async updateOne(filter, update) {
            const record = data.find(entry => matches(entry, filter));
            if (!record) return { matchedCount: 0 };
            Object.assign(record, clone(update.$set || {}));
            for (const key of Object.keys(update.$unset || {})) delete record[key];
            return { matchedCount: 1 };
        },
        async deleteOne(filter) {
            const index = data.findIndex(entry => matches(entry, filter));
            if (index < 0) return { deletedCount: 0 };
            data.splice(index, 1);
            return { deletedCount: 1 };
        }
    };
}

function sourceModel(data) {
    return {
        find() { return new Query(() => data.map(clone)); },
        collection: collection(data)
    };
}

class PreviewDocument {
    constructor(value) { Object.assign(this, clone(value)); this._id = new mongoose.Types.ObjectId(); }
    async save() { PreviewModel.docs.push(this); return this; }
}

const PreviewModel = class extends PreviewDocument {
    static docs = [];
    static findById(id) { return new Query(() => this.docs.find(entry => String(entry._id) === String(id)) || null); }
    static findOne(filter) { return new Query(() => this.docs.find(entry => matches(entry, filter)) || null); }
    static findOneAndUpdate(filter, update) {
        return new Query(() => {
            const record = this.docs.find(entry => matches(entry, filter));
            if (!record) return null;
            Object.assign(record, clone(update.$set || {}));
            return record;
        });
    }
    static updateOne(filter, update) {
        return new Query(() => {
            const record = this.docs.find(entry => matches(entry, filter));
            if (!record) return { matchedCount: 0 };
            Object.assign(record, clone(update.$set || {}));
            return { matchedCount: 1 };
        });
    }
};

const ItemModel = {
    docs: [],
    async insertMany(items) { this.docs.push(...items.map(clone)); },
    find(filter) { return new Query(() => this.docs.filter(entry => matches(entry, filter)).sort((a, b) => a.sequence - b.sequence)); }
};

function fixture() {
    return {
        pocketbudgets: [{ _id: 'budget-1', pocket: 'Groceries', month: 4, year: 2026, budget: 500000, createdBy: '65f000000000000000000001', createdAt: new Date('2026-03-01'), updatedAt: new Date('2026-03-02') }],
        pocketbudgetcadences: [],
        weeklyallocations: [],
        transactions: [{ _id: 'transaction-1', date: new Date('2026-04-24T05:00:00.000Z'), type: 'Groceries', pocket: 'Groceries', ngapain: 'payday groceries', by: '65f000000000000000000001', paidBy: 'Wife', amount: 125000, budgetMonth: 4, budgetYear: 2026, sourceType: 'single', sourceBreakdowns: [], createdAt: new Date('2026-04-24'), updatedAt: new Date('2026-04-24') }],
        closedmonths: []
    };
}

function setup() {
    PreviewModel.docs = [];
    ItemModel.docs = [];
    const data = fixture();
    const models = Object.fromEntries(Object.entries(data).map(([name, records]) => [name, sourceModel(records)]));
    const connection = { startSession: async () => ({ withTransaction: async operation => operation({}), endSession: async () => {} }) };
    return { data, models, connection, actor: { userId: '65f000000000000000000001', role: 'Operator' } };
}

function createConvertedRecordsRouteApp() {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.locals.householdTimeZone = 'Asia/Jakarta';
    app.locals.configuration = { salaryCycleBudgetingEnabled: true };
    app.use((req, res, next) => {
        req.session = req.get('X-Test-User')
            ? {
                userId: '65f000000000000000000001',
                username: 'converted-user',
                role: req.get('X-Test-Role') || 'Husband'
            }
            : {};
        next();
    });
    app.use(transactionRoutes);
    app.use(budgetRoutes);
    app.use(errorHandler);
    return app;
}

const runMongoIntegration = process.env.RUN_MONGO_INTEGRATION === '1';
const migrationIntegrationTest = runMongoIntegration
    ? (name, fn) => test(name, { concurrency: false }, fn)
    : test.skip;

test('migration lifecycle persists a preview, gates approval, executes, verifies, and rolls back', async () => {
    const state = setup();
    const before = JSON.stringify(state.data);
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    assert.equal(JSON.stringify(state.data), before);
    assert.equal(generated.preview.status, 'Draft');
    assert.ok(generated.items.length > 0);

    await approveMigrationPreview({ previewId: generated.preview._id, actor: state.actor, historicalReassignmentApproved: true, models: state.models, previewModel: PreviewModel, itemModel: ItemModel });
    const executed = await executeMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel, connection: state.connection });
    assert.equal(executed.status, 'Applied');

    const verified = await verifyMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel });
    assert.equal(verified.ok, true);

    await approveMigrationRollback({ previewId: generated.preview._id, actor: state.actor, previewModel: PreviewModel, itemModel: ItemModel });
    const rolledBack = await rollbackMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel, connection: state.connection });
    assert.equal(rolledBack.status, 'RolledBack');
    const rollbackVerification = await verifyMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel });
    assert.equal(rollbackVerification.ok, true);
    assert.deepEqual(state.data.transactions[0].budgetMonth, 4);
    assert.equal(state.data.transactions[0].expenseDate, undefined);
});


test('verification reports preservation, schema, index, invariant, and route-readability checks', async () => {
    const state = setup();
    const models = {
        ...state.models,
        // The in-memory adapter supplies the source/collection behavior while
        // the production schema supplies the structural contract.
        transactions: { ...state.models.transactions, schema: Transaction.schema }
    };
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await approveMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        historicalReassignmentApproved: true,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await executeMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        models,
        previewModel: PreviewModel,
        itemModel: ItemModel,
        connection: state.connection
    });

    const result = await verifyMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        models,
        previewModel: PreviewModel,
        itemModel: ItemModel,
        routeChecks: [{
            name: 'authenticated-history',
            check: ({ expectedRecords }) => expectedRecords.some(entry => entry.collectionName === 'transactions')
        }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.checks.preservation.ok, true);
    assert.equal(result.checks.schema.ok, true);
    assert.equal(result.checks.indexes.ok, true);
    assert.equal(result.checks.invariants.ok, true);
    assert.equal(result.checks.routes.ok, true);
    assert.equal(result.checks.routes.checked, 1);
});

test('rollback preflights every affected record and performs zero writes on any conflict', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await approveMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        historicalReassignmentApproved: true,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await executeMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel,
        connection: state.connection
    });
    await approveMigrationRollback({
        previewId: generated.preview._id,
        actor: state.actor,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });

    // This record is reversed late in sequence. Without a complete preflight,
    // earlier reverse operations would already have mutated the source.
    state.data.pocketbudgets[0].budget += 1;
    const sourceBefore = clone(state.data);
    let writes = 0;
    for (const model of Object.values(state.models)) {
        const original = model.collection.updateOne;
        model.collection.updateOne = async (...args) => {
            writes += 1;
            return original(...args);
        };
    }

    await assert.rejects(
        rollbackMigrationPreview({
            previewId: generated.preview._id,
            actor: state.actor,
            models: state.models,
            previewModel: PreviewModel,
            itemModel: ItemModel,
            connection: state.connection
        }),
        error => error.code === 'MIGRATION_ROLLBACK_CONFLICT'
    );
    assert.equal(writes, 0);
    assert.deepEqual(state.data, sourceBefore);
    assert.equal(PreviewModel.docs[0].status, 'Applied');
});

test('blocked previews report invalid source identifiers and never mutate source records', async () => {
    const state = setup();
    state.data.transactions[0].date = 'not-a-date';
    const before = JSON.stringify(state.data);
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    assert.equal(generated.preview.status, 'Blocked');
    assert.ok(generated.items.some(item => item.recordId === 'transaction-1' && item.blockingReason === 'INVALID_EXPENSE_DATE'));
    assert.equal(JSON.stringify(state.data), before);
});

test('execution rejects a stale approved preview before applying any item', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await approveMigrationPreview({ previewId: generated.preview._id, actor: state.actor, historicalReassignmentApproved: true, previewModel: PreviewModel, itemModel: ItemModel });
    state.data.pocketbudgets[0].budget += 1;
    await assert.rejects(
        executeMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel, connection: state.connection }),
        error => error.code === 'MIGRATION_PREVIEW_STALE'
    );
    assert.equal(PreviewModel.docs[0].status, 'Approved');
    assert.equal(state.data.transactions[0].expenseDate, undefined);
});

test('rollback refuses changed applied records without mutating the record or status', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await approveMigrationPreview({ previewId: generated.preview._id, actor: state.actor, historicalReassignmentApproved: true, previewModel: PreviewModel, itemModel: ItemModel });
    await executeMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel, connection: state.connection });
    await approveMigrationRollback({ previewId: generated.preview._id, actor: state.actor, previewModel: PreviewModel, itemModel: ItemModel });
    state.data.transactions[0].amount += 1;
    assert.equal(state.models.transactions.collection.findOne({ _id: 'transaction-1' }).amount, 125001);
    assert.ok(ItemModel.docs.some(item => item.collectionName === 'transactions'));
    const changedVerification = await verifyMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel });
    assert.equal(changedVerification.ok, false);
    await assert.rejects(
        rollbackMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel, connection: state.connection }),
        error => error.code === 'MIGRATION_ROLLBACK_CONFLICT'
    );
    assert.equal(PreviewModel.docs[0].status, 'Applied');
    assert.equal(state.data.transactions[0].amount, 125001);
});


test('execution preflight rejects deployments without transaction support', async () => {
    await assert.rejects(
        checkTransactionsSupported({ db: { admin: () => ({ command: async () => ({ ok: 1 }) }) } }),
        error => error.code === 'CONFIG_TRANSACTIONS_REQUIRED'
    );
});


test('approval and execution require an authorized operator and cannot consume a preview twice', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });

    await assert.rejects(
        approveMigrationPreview({
            previewId: generated.preview._id,
            actor: { userId: state.actor.userId, role: 'Husband' },
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'WIFE_ROLE_REQUIRED' || error.code === 'OPERATOR_ROLE_REQUIRED'
    );
    await approveMigrationPreview({ previewId: generated.preview._id, actor: state.actor, historicalReassignmentApproved: true, previewModel: PreviewModel, itemModel: ItemModel });
    await executeMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel, connection: state.connection });
    await assert.rejects(
        executeMigrationPreview({ previewId: generated.preview._id, actor: state.actor, models: state.models, previewModel: PreviewModel, itemModel: ItemModel, connection: state.connection }),
        error => error.code === 'MIGRATION_APPROVAL_REQUIRED'
    );
});

test('transaction failure after multiple migration items leaves source and preview state unchanged', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await approveMigrationPreview({ previewId: generated.preview._id, actor: state.actor, historicalReassignmentApproved: true, previewModel: PreviewModel, itemModel: ItemModel });

    const sourceBefore = clone(state.data);
    const previewBefore = clone(PreviewModel.docs);
    let attempts = 0;
    const originalUpdate = state.models.transactions.collection.updateOne;
    state.models.transactions.collection.updateOne = async (...args) => {
        attempts += 1;
        if (attempts === 2) throw new Error('injected migration failure');
        return originalUpdate(...args);
    };
    const transactionalConnection = {
        startSession: async () => ({
            withTransaction: async operation => {
                try {
                    return await operation({});
                } catch (error) {
                    for (const [name, records] of Object.entries(sourceBefore)) {
                        state.data[name].splice(0, state.data[name].length, ...clone(records));
                    }
                    PreviewModel.docs.splice(0, PreviewModel.docs.length, ...clone(previewBefore));
                    throw error;
                }
            },
            endSession: async () => {}
        })
    };

    await assert.rejects(
        executeMigrationPreview({
            previewId: generated.preview._id,
            actor: state.actor,
            models: state.models,
            previewModel: PreviewModel,
            itemModel: ItemModel,
            connection: transactionalConnection
        }),
        /injected migration failure/
    );
    assert.equal(attempts, 2);
    assert.deepEqual(state.data, sourceBefore);
    assert.deepEqual(PreviewModel.docs, previewBefore);
});


test('approval rejects a source-changed preview before changing lifecycle status', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    state.data.pocketbudgets[0].budget += 1;
    await assert.rejects(
        approveMigrationPreview({
            previewId: generated.preview._id,
            actor: state.actor,
            models: state.models,
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'MIGRATION_PREVIEW_STALE'
    );
    assert.equal(PreviewModel.docs[0].status, 'Draft');
});


test('historical reassignment remains pending until separately approved', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    assert.equal(generated.preview.status, 'Draft');
    await assert.rejects(
        approveMigrationPreview({
            previewId: generated.preview._id,
            actor: state.actor,
            models: state.models,
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'MIGRATION_APPROVAL_REQUIRED'
    );
    await approveMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        historicalReassignmentApproved: true,
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    assert.equal(PreviewModel.docs[0].historicalReassignmentApproved, true);
});



test('approval rejects blocked previews with a stable blocked error and no source writes', async () => {
    const state = setup();
    state.data.transactions[0].date = 'not-a-date';
    const before = JSON.stringify(state.data);
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });

    await assert.rejects(
        approveMigrationPreview({
            previewId: generated.preview._id,
            actor: { userId: state.actor.userId, role: 'Wife' },
            models: state.models,
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'MIGRATION_PREVIEW_BLOCKED'
    );
    assert.equal(PreviewModel.docs[0].status, 'Blocked');
    assert.equal(JSON.stringify(state.data), before);
});

test('approval rejects a stale or consumed preview without changing source data', async () => {
    const staleState = setup();
    const stale = await createAndPersistPreview({
        actor: staleState.actor,
        timeZone: 'Asia/Jakarta',
        models: staleState.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    const staleSource = JSON.stringify(staleState.data);
    PreviewModel.docs[0].status = 'Stale';
    await assert.rejects(
        approveMigrationPreview({
            previewId: stale.preview._id,
            actor: { userId: staleState.actor.userId, role: 'Wife' },
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'MIGRATION_PREVIEW_STALE'
    );
    assert.equal(JSON.stringify(staleState.data), staleSource);

    const consumedState = setup();
    const consumed = await createAndPersistPreview({
        actor: consumedState.actor,
        timeZone: 'Asia/Jakarta',
        models: consumedState.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await approveMigrationPreview({
        previewId: consumed.preview._id,
        actor: consumedState.actor,
        historicalReassignmentApproved: true,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await executeMigrationPreview({
        previewId: consumed.preview._id,
        actor: consumedState.actor,
        models: consumedState.models,
        previewModel: PreviewModel,
        itemModel: ItemModel,
        connection: consumedState.connection
    });
    const consumedSource = JSON.stringify(consumedState.data);
    await assert.rejects(
        approveMigrationPreview({
            previewId: consumed.preview._id,
            actor: { userId: consumedState.actor.userId, role: 'Wife' },
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'MIGRATION_APPROVAL_REQUIRED'
    );
    assert.equal(PreviewModel.docs[0].status, 'Applied');
    assert.equal(JSON.stringify(consumedState.data), consumedSource);
});

test('approval requires a valid preview identity and accepts Wife authorization', async () => {
    const state = setup();
    await assert.rejects(
        approveMigrationPreview({
            previewId: 'not-an-object-id',
            actor: { userId: state.actor.userId, role: 'Wife' },
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'VALIDATION_ERROR' && error.field === 'previewId'
    );

    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    const sourceBefore = JSON.stringify(state.data);
    await assert.rejects(
        approveMigrationPreview({
            previewId: generated.preview._id,
            actor: { userId: state.actor.userId, role: 'Husband' },
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'WIFE_ROLE_REQUIRED' || error.code === 'OPERATOR_ROLE_REQUIRED'
    );
    assert.equal(JSON.stringify(state.data), sourceBefore);
});



test('preview creation never substitutes for separate historical reassignment approval', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        historicalReassignmentApproved: true,
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    assert.equal(generated.preview.historicalReassignmentApproved, false);
    assert.ok(generated.items.some(item =>
        item.changeType === 'transactionBudgetMonthChange' &&
        item.executable === false &&
        item.blockingReason === 'HISTORICAL_REASSIGNMENT_APPROVAL_REQUIRED'
    ));
    await assert.rejects(
        approveMigrationPreview({
            previewId: generated.preview._id,
            actor: state.actor,
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'MIGRATION_APPROVAL_REQUIRED'
    );
    assert.equal(PreviewModel.docs[0].status, 'Draft');
});


test('migration transactions always retain majority write concern and close sessions', async () => {
    let capturedOptions;
    let ended = false;
    const connection = {
        startSession: async () => ({
            withTransaction: async (operation, options) => {
                capturedOptions = options;
                return operation({});
            },
            endSession: async () => { ended = true; }
        })
    };

    const result = await runTransaction(connection, async () => 'committed', {
        transactionOptions: { maxCommitTimeMS: 500, writeConcern: { w: 1, j: true } }
    });

    assert.equal(result, 'committed');
    assert.deepEqual(capturedOptions, {
        maxCommitTimeMS: 500,
        writeConcern: { w: 'majority', j: true }
    });
    assert.equal(ended, true);
});

test('execution cannot bypass historical reassignment approval with an executable item flag', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await approveMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        historicalReassignmentApproved: true,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });

    // Simulate an invalid direct database edit of immutable lifecycle data.
    // Execution must still require the historical approval flag.
    PreviewModel.docs[0].historicalReassignmentApproved = false;
    const historicalItem = ItemModel.docs.find(item => item.changeType === 'transactionBudgetMonthChange');
    historicalItem.executable = true;
    const sourceBefore = clone(state.data);

    await assert.rejects(
        executeMigrationPreview({
            previewId: generated.preview._id,
            actor: state.actor,
            models: state.models,
            previewModel: PreviewModel,
            itemModel: ItemModel,
            connection: state.connection
        }),
        error => error.code === 'MIGRATION_APPROVAL_REQUIRED'
    );
    assert.deepEqual(state.data, sourceBefore);
    assert.equal(PreviewModel.docs[0].status, 'Approved');
});


test('execution rejects a lost conditional Executing transition before source writes', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await approveMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        historicalReassignmentApproved: true,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    const sourceBefore = clone(state.data);
    const originalUpdateOne = PreviewModel.updateOne;
    PreviewModel.updateOne = function (filter, update) {
        if (update?.$set?.status === 'Executing') return new Query(() => ({ matchedCount: 0 }));
        return originalUpdateOne.call(this, filter, update);
    };

    try {
        await assert.rejects(
            executeMigrationPreview({
                previewId: generated.preview._id,
                actor: state.actor,
                models: state.models,
                previewModel: PreviewModel,
                itemModel: ItemModel,
                connection: state.connection
            }),
            error => error.code === 'MIGRATION_APPROVAL_REQUIRED'
        );
    } finally {
        PreviewModel.updateOne = originalUpdateOne;
    }
    assert.deepEqual(state.data, sourceBefore);
    assert.equal(PreviewModel.docs[0].status, 'Approved');
});


test('preview persists exact counts/items and a rerun reports zero transformations', async () => {
    const state = setup();
    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });

    assert.deepEqual(generated.preview.counts, {
        scanned: 2,
        unchanged: 0,
        proposed: 6,
        invalid: 0,
        duplicateAllocationKeys: 0,
        unresolvableConflicts: 0,
        byChangeType: {
            cadenceAssignment: 1,
            monthlyAllocationConversion: 1,
            openBudgetGuard: 2,
            transactionBudgetMonthChange: 1,
            transactionCanonicalDate: 1
        }
    });
    assert.deepEqual(generated.items.map(item => ({
        collectionName: item.collectionName,
        recordId: item.recordId,
        changeType: item.changeType,
        executable: item.executable
    })), [
        { collectionName: 'pocketbudgets', recordId: 'budget-1', changeType: 'monthlyAllocationConversion', executable: true },
        { collectionName: 'pocketbudgetcadences', recordId: 'cadence:2026-04:Groceries', changeType: 'cadenceAssignment', executable: true },
        { collectionName: 'transactions', recordId: 'transaction-1', changeType: 'transactionBudgetMonthChange', executable: false },
        { collectionName: 'transactions', recordId: 'transaction-1', changeType: 'transactionCanonicalDate', executable: true },
        { collectionName: 'closedmonths', recordId: 'guard:2026-04', changeType: 'openBudgetGuard', executable: true },
        { collectionName: 'closedmonths', recordId: 'guard:2026-05', changeType: 'openBudgetGuard', executable: true }
    ]);

    await approveMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        historicalReassignmentApproved: true,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    await executeMigrationPreview({
        previewId: generated.preview._id,
        actor: state.actor,
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel,
        connection: state.connection
    });

    const rerun = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });
    assert.deepEqual(rerun.preview.counts, {
        scanned: 5,
        unchanged: 5,
        proposed: 0,
        invalid: 0,
        duplicateAllocationKeys: 0,
        unresolvableConflicts: 0,
        byChangeType: {}
    });
    assert.deepEqual(rerun.items, []);
    assert.equal(JSON.stringify(state.data).includes('transaction-1'), true);
});

test('blocked preview reports invalid dates and pockets plus duplicate keys and identities exactly', async () => {
    const state = setup();
    state.data.pocketbudgets.push({
        ...clone(state.data.pocketbudgets[0]),
        _id: 'budget-duplicate'
    });
    state.data.transactions.push({
        ...clone(state.data.transactions[0]),
        _id: 'transaction-invalid-pocket',
        pocket: 'Unknown'
    });
    state.data.transactions.push({
        ...clone(state.data.transactions[0]),
        _id: 'transaction-invalid-date',
        date: 'not-a-date'
    });
    state.data.transactions.push({
        ...clone(state.data.transactions[0])
    });
    const before = clone(state.data);

    const generated = await createAndPersistPreview({
        actor: state.actor,
        timeZone: 'Asia/Jakarta',
        models: state.models,
        previewModel: PreviewModel,
        itemModel: ItemModel
    });

    assert.equal(generated.preview.status, 'Blocked');
    assert.deepEqual(generated.preview.counts, {
        scanned: 6,
        unchanged: 0,
        proposed: 6,
        invalid: 4,
        duplicateAllocationKeys: 1,
        unresolvableConflicts: 3,
        byChangeType: {
            monthlyAllocationConversion: 2,
            sourceRecordIdentity: 2,
            transactionCanonicalDate: 1,
            transactionValidation: 1
        }
    });
    assert.deepEqual(generated.items.map(item => item.blockingReason).filter(Boolean).sort(), [
        'DUPLICATE_ALLOCATION_COMPOSITE_KEY',
        'DUPLICATE_SOURCE_IDENTIFIER',
        'DUPLICATE_SOURCE_IDENTIFIER',
        'INVALID_EXPENSE_DATE',
        'INVALID_POCKET',
        'DUPLICATE_ALLOCATION_COMPOSITE_KEY'
    ].sort());
    assert.deepEqual(state.data, before);
    assert.equal(PreviewModel.docs[0].status, 'Blocked');
});

migrationIntegrationTest('authenticated routes remain readable after converted records are executed', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const actorId = new mongoose.Types.ObjectId('65f000000000000000000001');
        await PocketBudget.collection.insertOne({
            _id: new mongoose.Types.ObjectId('65f000000000000000000010'),
            pocket: 'Groceries', month: 4, year: 2026, budget: 500000,
            createdBy: actorId,
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
            updatedAt: new Date('2026-03-02T00:00:00.000Z')
        });
        await Transaction.collection.insertOne({
            _id: new mongoose.Types.ObjectId('65f000000000000000000011'),
            date: new Date('2026-04-24T05:00:00.000Z'),
            type: 'Groceries', pocket: 'Groceries', ngapain: 'converted route expense',
            by: actorId, paidBy: 'Wife', amount: 125000, budgetMonth: 4, budgetYear: 2026,
            sourceType: 'single', sourceBreakdowns: [],
            createdAt: new Date('2026-04-24T06:00:00.000Z'),
            updatedAt: new Date('2026-04-24T06:00:00.000Z')
        });
        await ClosedMonth.collection.insertOne({
            _id: new mongoose.Types.ObjectId('65f000000000000000000012'),
            month: 4, year: 2026, closedBy: actorId,
            createdAt: new Date('2026-04-30T00:00:00.000Z'),
            updatedAt: new Date('2026-04-30T00:00:00.000Z')
        });

        const actor = { userId: actorId, role: 'Operator' };
        const generated = await createAndPersistPreview({
            actor,
            timeZone: 'Asia/Jakarta',
            connection,
            previewModel: undefined,
            itemModel: undefined
        });
        await approveMigrationPreview({
            previewId: generated.preview._id,
            actor,
            historicalReassignmentApproved: true
        });
        await executeMigrationPreview({
            previewId: generated.preview._id,
            actor,
            connection
        });

        const app = createConvertedRecordsRouteApp();
        const transactions = await request(app)
            .get('/api/transactions')
            .query({ month: '2026-05' })
            .set('X-Test-User', 'converted-reader');
        assert.equal(transactions.status, 200);
        assert.equal(transactions.body.length, 1);
        assert.equal(transactions.body[0].expenseDate, '2026-04-24');
        assert.equal(transactions.body[0].budgetMonth, 5);

        const history = await request(app)
            .get('/api/history')
            .query({ month: '2026-05' })
            .set('X-Test-User', 'converted-reader');
        assert.equal(history.status, 200);
        assert.equal(history.body.success, true);
        assert.equal(history.body.data.transactions[0].expenseDate, '2026-04-24');

        const budget = await request(app)
            .get('/api/budget')
            .query({ month: '2026-04' })
            .set('X-Test-User', 'converted-reader');
        assert.equal(budget.status, 200);
        assert.equal(budget.body.success, true);
        assert.equal(budget.body.data.budgetMonth, '2026-04');

        const closedMonths = await request(app)
            .get('/api/budget/closed-months')
            .set('X-Test-User', 'converted-reader');
        assert.equal(closedMonths.status, 200);
        assert.equal(closedMonths.body.data.some(entry => entry.key === '2026-04'), true);
    });
});
