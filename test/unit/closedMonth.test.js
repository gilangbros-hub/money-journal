'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ClosedMonth = require('../../models/closedMonth');

const closedBy = new mongoose.Types.ObjectId();
const reopenedBy = new mongoose.Types.ObjectId();

function declaredIndexes(model) {
    return model.schema.indexes().map(([keys, options]) => ({
        keys,
        unique: options.unique === true
    }));
}

function updateWithoutVersionKey(query) {
    const update = query.getUpdate();
    if (update.$setOnInsert) {
        delete update.$setOnInsert.__v;
        if (Object.keys(update.$setOnInsert).length === 0) delete update.$setOnInsert;
    }
    return update;
}

test('BudgetPeriod keeps the legacy collection, identity fields, and unique month/year key', () => {
    assert.equal(ClosedMonth.collection.name, 'closedmonths');
    assert.deepEqual(declaredIndexes(ClosedMonth), [
        { keys: { month: 1, year: 1 }, unique: true }
    ]);

    const guard = new ClosedMonth({
        month: 2,
        year: 2027,
        closedBy,
        isClosed: true,
        closedAt: new Date('2027-02-01T00:00:00.000Z'),
        updatedBy: closedBy
    });

    assert.equal(guard.validateSync(), undefined);
    assert.equal(guard.month, 2);
    assert.equal(guard.year, 2027);
    assert.equal(guard.closedBy.toString(), closedBy.toString());
    assert.equal(guard.schema.path('closedAt').instance, 'Date');
    assert.equal(guard.schema.path('updatedBy').instance, 'ObjectId');
});

test('legacy closed-month records remain readable and receive safe guard defaults', () => {
    const createdAt = new Date('2027-01-01T00:00:00.000Z');
    const updatedAt = new Date('2027-01-02T00:00:00.000Z');
    const legacy = ClosedMonth.hydrate({
        _id: new mongoose.Types.ObjectId(),
        month: 2,
        year: 2027,
        closedBy,
        createdAt,
        updatedAt
    });

    assert.equal(legacy.validateSync(), undefined);
    assert.equal(legacy.closedBy.toString(), closedBy.toString());
    assert.equal(legacy.createdAt.getTime(), createdAt.getTime());
    assert.equal(legacy.updatedAt.getTime(), updatedAt.getTime());
    assert.equal(legacy.isClosed, true);
    assert.equal(legacy.closedAt, null);
    assert.equal(legacy.mutationSequence, 0);
    assert.equal(legacy.schemaVersion, ClosedMonth.CURRENT_SCHEMA_VERSION);
});

test('new guards default to the legacy-safe closed state and v2 fence values', () => {
    const guard = new ClosedMonth({ month: 2, year: 2027, closedBy });

    assert.equal(guard.validateSync(), undefined);
    assert.equal(guard.isClosed, true);
    assert.equal(guard.closedAt, null);
    assert.equal(guard.mutationSequence, 0);
    assert.equal(guard.schemaVersion, 2);
});

test('ensureOpen creates an explicit open guard without replacing an existing record', () => {
    const query = ClosedMonth.ensureOpen({ month: 2, year: 2027, actor: reopenedBy });

    assert.deepEqual(query.getFilter(), { month: 2, year: 2027 });
    assert.deepEqual(updateWithoutVersionKey(query), {
        $setOnInsert: {
            isClosed: false,
            closedAt: null,
            updatedBy: reopenedBy,
            mutationSequence: 0,
            schemaVersion: 2
        }
    });
    assert.equal(query.getOptions().new, true);
    assert.equal(query.getOptions().upsert, true);
    assert.equal(query.getOptions().runValidators, true);
});

test('closePeriod atomically persists closed state and increments the mutation fence', () => {
    const closedAt = new Date('2027-02-10T12:00:00.000Z');
    const query = ClosedMonth.closePeriod({
        month: 2,
        year: 2027,
        actor: closedBy,
        closedAt
    });

    assert.deepEqual(query.getFilter(), { month: 2, year: 2027 });
    assert.deepEqual(updateWithoutVersionKey(query), {
        $set: {
            isClosed: true,
            closedAt,
            updatedBy: closedBy,
            schemaVersion: 2,
            closedBy
        },
        $inc: { mutationSequence: 1 }
    });
    assert.equal(query.getOptions().new, true);
    assert.equal(query.getOptions().upsert, true);
});

test('reopenPeriod updates the persistent guard and preserves close identity fields', () => {
    const query = ClosedMonth.reopenPeriod({ month: 2, year: 2027, actor: reopenedBy });

    assert.deepEqual(query.getFilter(), { month: 2, year: 2027 });
    assert.deepEqual(query.getUpdate(), {
        $set: {
            isClosed: false,
            closedAt: null,
            updatedBy: reopenedBy,
            schemaVersion: 2
        },
        $inc: { mutationSequence: 1 }
    });
    assert.equal(query.getOptions().new, true);
    assert.equal(query.getOptions().upsert, false);
    assert.equal(query.getOptions().runValidators, true);
    assert.equal(query.getUpdate().$set.closedBy, undefined);
});
