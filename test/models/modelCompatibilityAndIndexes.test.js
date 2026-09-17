'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
    createIsolatedDatabase
} = require('../helpers');
const Transaction = require('../../models/transaction');
const PocketBudget = require('../../models/pocketBudget');
const PocketBudgetCadence = require('../../models/pocketBudgetCadence');
const WeeklyAllocation = require('../../models/weeklyAllocation');
const ClosedMonth = require('../../models/closedMonth');
const { POCKETS } = require('../../utils/constants');

const actor = new mongoose.Types.ObjectId();
const otherActor = new mongoose.Types.ObjectId();
const firstPocket = Object.keys(POCKETS)[0];
const secondPocket = Object.keys(POCKETS)[1];
const database = createIsolatedDatabase({
    mongoOptions: { connection: { autoIndex: false } }
});

const monthlyKey = { pocket: 1, month: 1, year: 1 };
const cadenceKey = { pocket: 1, month: 1, year: 1 };
const weeklyKey = {
    pocket: 1,
    month: 1,
    year: 1,
    isoWeekYear: 1,
    isoWeekNumber: 1
};

function indexName(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function createUniqueIndex(model, keys, prefix) {
    return model.collection.createIndex(keys, {
        unique: true,
        name: indexName(prefix)
    });
}

function duplicateKeyError(error) {
    return Boolean(error && error.code === 11000);
}

function validMonthly(overrides = {}) {
    return {
        pocket: firstPocket,
        month: 2,
        year: 2027,
        budget: 500000,
        createdBy: actor,
        ...overrides
    };
}

function validCadence(overrides = {}) {
    return {
        pocket: firstPocket,
        month: 2,
        year: 2027,
        cadence: 'Monthly',
        createdBy: actor,
        updatedBy: actor,
        ...overrides
    };
}

function validWeekly(overrides = {}) {
    return {
        pocket: firstPocket,
        month: 2,
        year: 2027,
        isoWeekYear: 2027,
        isoWeekNumber: 5,
        budget: 125000,
        createdBy: actor,
        updatedBy: actor,
        ...overrides
    };
}

test.before(async () => {
    await database.start();
});

test.after(async () => {
    await database.stop();
});

test.beforeEach(async () => {
    await database.clear();
});

test('legacy transaction reads preserve identifiers, timestamps, fields, and compatibility defaults', () => {
    const id = new mongoose.Types.ObjectId();
    const createdAt = new Date('2026-04-01T12:00:00.000Z');
    const updatedAt = new Date('2026-04-02T12:00:00.000Z');
    const legacy = Transaction.hydrate({
        _id: id,
        date: new Date('2026-04-24T05:00:00.000Z'),
        type: 'Groceries',
        pocket: firstPocket,
        ngapain: 'legacy transaction',
        by: actor,
        paidBy: 'Self',
        amount: 125000,
        budgetMonth: 4,
        budgetYear: 2026,
        createdAt,
        updatedAt
    });

    assert.equal(legacy.validateSync(), undefined);
    assert.equal(legacy._id.toString(), id.toString());
    assert.equal(legacy.createdAt.getTime(), createdAt.getTime());
    assert.equal(legacy.updatedAt.getTime(), updatedAt.getTime());
    assert.equal(legacy.schemaVersion, 1);
    assert.equal(legacy.assignmentVersion, 'legacy-preserved');
    assert.equal(legacy.expenseDate, undefined);
    assert.equal(legacy.budgetMonth, 4);
    assert.equal(legacy.budgetYear, 2026);
});

test('schema-v2 transactions require strict date-only data and preserve the legacy date alias', () => {
    const valid = new Transaction({
        _id: new mongoose.Types.ObjectId(),
        expenseDate: '2026-04-24',
        date: new Date('2026-04-24T05:00:00.000Z'),
        schemaVersion: 2,
        assignmentVersion: 'salary-cycle-v1',
        type: 'Groceries',
        pocket: firstPocket,
        ngapain: 'canonical transaction',
        by: actor,
        paidBy: 'Wife',
        amount: 125000,
        budgetMonth: 4,
        budgetYear: 2026
    });

    assert.equal(valid.validateSync(), undefined);
    assert.equal(valid.schemaVersion, 2);
    assert.equal(valid.assignmentVersion, 'salary-cycle-v1');
    assert.equal(valid.expenseDate, '2026-04-24');
    assert.ok(valid.date instanceof Date);
    assert.equal(valid._id.toString().length, 24);

    for (const expenseDate of ['2026-4-24', '2026-04-31', '2026-02-29', new Date('2026-04-24')]) {
        const invalid = new Transaction({
            expenseDate,
            schemaVersion: 2,
            assignmentVersion: 'salary-cycle-v1',
            type: 'Groceries',
            pocket: firstPocket,
            ngapain: 'invalid canonical date',
            by: actor,
            paidBy: 'Self',
            amount: 1,
            budgetMonth: 4,
            budgetYear: 2026
        });
        const error = invalid.validateSync();
        assert.ok(error instanceof mongoose.Error.ValidationError, String(expenseDate));
        assert.ok(error.errors.expenseDate, String(expenseDate));
    }
});

test('monthly upsert preserves a legacy record identity and creation timestamp', async () => {
    const id = new mongoose.Types.ObjectId();
    const createdAt = new Date('2020-01-01T00:00:00.000Z');
    const updatedAt = new Date('2020-01-02T00:00:00.000Z');
    await PocketBudget.collection.insertOne({
        _id: id,
        ...validMonthly(),
        createdAt,
        updatedAt
    });

    const updated = await PocketBudget.upsertAccepted({
        pocket: firstPocket,
        month: 2,
        year: 2027,
        budget: 650000,
        updatedBy: otherActor,
        createdBy: actor
    });

    assert.equal(updated._id.toString(), id.toString());
    assert.equal(updated.createdAt.getTime(), createdAt.getTime());
    assert.ok(updated.updatedAt.getTime() >= updatedAt.getTime());
    assert.equal(updated.budget, 650000);
    assert.equal(updated.updatedBy.toString(), otherActor.toString());
    assert.equal(updated.version, 1);
    assert.equal(updated.schemaVersion, 2);
    assert.equal(updated.createdBy.toString(), actor.toString());
});

test('monthly, cadence, and weekly records enforce their exact composite keys', async () => {
    await createUniqueIndex(PocketBudget, monthlyKey, 'monthly');
    await createUniqueIndex(PocketBudgetCadence, cadenceKey, 'cadence');
    await createUniqueIndex(WeeklyAllocation, weeklyKey, 'weekly');

    await PocketBudget.create(validMonthly());
    await PocketBudget.create(validMonthly({ year: 2028 }));
    await assert.rejects(
        () => PocketBudget.create(validMonthly()),
        duplicateKeyError
    );

    await PocketBudgetCadence.create(validCadence());
    await PocketBudgetCadence.create(validCadence({ pocket: secondPocket }));
    await assert.rejects(
        () => PocketBudgetCadence.create(validCadence()),
        duplicateKeyError
    );

    await WeeklyAllocation.create(validWeekly());
    await WeeklyAllocation.create(validWeekly({ isoWeekNumber: 6 }));
    await assert.rejects(
        () => WeeklyAllocation.create(validWeekly()),
        duplicateKeyError
    );
});

test('duplicate records fail unique-index creation before deployment and clean data permits it', async () => {
    const cases = [
        {
            model: PocketBudget,
            keys: monthlyKey,
            prefix: 'monthly-preflight',
            duplicate: [validMonthly({ _id: new mongoose.Types.ObjectId() }), validMonthly({ _id: new mongoose.Types.ObjectId(), budget: 600000 })]
        },
        {
            model: PocketBudgetCadence,
            keys: cadenceKey,
            prefix: 'cadence-preflight',
            duplicate: [validCadence({ _id: new mongoose.Types.ObjectId() }), validCadence({ _id: new mongoose.Types.ObjectId(), cadence: 'Weekly' })]
        },
        {
            model: WeeklyAllocation,
            keys: weeklyKey,
            prefix: 'weekly-preflight',
            duplicate: [validWeekly({ _id: new mongoose.Types.ObjectId() }), validWeekly({ _id: new mongoose.Types.ObjectId(), budget: 130000 })]
        }
    ];

    for (const { model, keys, prefix, duplicate } of cases) {
        await model.collection.insertMany(duplicate);
        await assert.rejects(
            () => createUniqueIndex(model, keys, prefix),
            duplicateKeyError,
            `${model.modelName} duplicate data must block unique index creation`
        );

        await model.collection.deleteMany({});
        const createdName = await createUniqueIndex(model, keys, `${prefix}-clean`);
        const index = (await model.collection.indexes()).find(item => item.name === createdName);
        assert.ok(index, `${model.modelName} unique index should be created after preflight cleanup`);
        assert.equal(index.unique, true);
        assert.deepEqual(index.key, keys);
    }
});

test('reopening a closed period updates the persistent guard instead of replacing it', async () => {
    const closedAt = new Date('2027-02-10T12:00:00.000Z');
    const created = await ClosedMonth.ensureOpen({
        month: 2,
        year: 2027,
        actor: actor
    });
    const closed = await ClosedMonth.closePeriod({
        month: 2,
        year: 2027,
        actor: actor,
        closedAt
    });
    const reopened = await ClosedMonth.reopenPeriod({
        month: 2,
        year: 2027,
        actor: otherActor
    });
    const persisted = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();

    assert.equal(closed._id.toString(), created._id.toString());
    assert.equal(reopened._id.toString(), created._id.toString());
    assert.equal(reopened.isClosed, false);
    assert.equal(reopened.closedAt, null);
    assert.equal(reopened.closedBy.toString(), actor.toString());
    assert.equal(reopened.updatedBy.toString(), otherActor.toString());
    assert.equal(reopened.mutationSequence, 2);
    assert.equal(reopened.schemaVersion, 2);
    assert.equal(persisted._id.toString(), created._id.toString());
    assert.equal(persisted.createdAt.getTime(), created.createdAt.getTime());
    assert.equal(persisted.closedBy.toString(), actor.toString());
    assert.equal(persisted.isClosed, false);
    assert.equal(persisted.mutationSequence, 2);
});
