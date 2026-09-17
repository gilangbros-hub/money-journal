'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const PocketBudget = require('../../models/pocketBudget');
const { POCKETS } = require('../../utils/constants');

const creator = new mongoose.Types.ObjectId();
const updater = new mongoose.Types.ObjectId();

function legacyBudget(overrides = {}) {
    return PocketBudget.hydrate({
        _id: new mongoose.Types.ObjectId(),
        pocket: 'Groceries',
        month: 2,
        year: 2027,
        budget: 500000,
        createdBy: creator,
        createdAt: new Date('2027-01-01T00:00:00.000Z'),
        updatedAt: new Date('2027-01-02T00:00:00.000Z'),
        ...overrides
    });
}

test('PocketBudget preserves the legacy monthly identity and adds v2 audit fields', () => {
    const schema = PocketBudget.schema;
    const indexes = schema.indexes();

    assert.equal(schema.get('collection'), undefined);
    assert.equal(schema.options.collection, undefined);
    assert.equal(schema.options.timestamps, true);
    assert.deepEqual(
        indexes.find(([fields, options]) => options && options.unique)?.[0],
        { pocket: 1, month: 1, year: 1 }
    );
    assert.deepEqual(Object.keys(POCKETS).sort(), schema.path('pocket').enumValues.sort());
    assert.equal(schema.path('updatedBy').instance, 'ObjectId');
    assert.equal(schema.path('version').defaultValue, 0);
    assert.equal(schema.path('schemaVersion').defaultValue, 2);
});

test('legacy PocketBudget records remain valid without new audit fields', () => {
    const budget = legacyBudget();

    assert.equal(budget.validateSync(), undefined);
    assert.equal(budget.pocket, 'Groceries');
    assert.equal(budget.budget, 500000);
    assert.equal(budget.createdBy.toString(), creator.toString());
    assert.equal(budget.updatedBy, undefined);
});

test('new PocketBudget documents default to schema version two and version zero', () => {
    const budget = new PocketBudget({
        pocket: 'Groceries',
        month: 2,
        year: 2027,
        budget: 500000,
        createdBy: creator
    });

    assert.equal(budget.validateSync(), undefined);
    assert.equal(budget.version, 0);
    assert.equal(budget.schemaVersion, 2);
});

test('upsertAccepted atomically correlates budget, updater, schema version, and version increment', () => {
    const query = PocketBudget.upsertAccepted({
        pocket: 'Groceries',
        month: 2,
        year: 2027,
        budget: 600000,
        createdBy: creator,
        updatedBy: updater
    });

    assert.deepEqual(query.getFilter(), {
        pocket: 'Groceries',
        month: 2,
        year: 2027
    });
    assert.deepEqual(query.getUpdate(), {
        $set: {
            budget: 600000,
            updatedBy: updater,
            schemaVersion: 2
        },
        $inc: { version: 1 },
        $setOnInsert: { createdBy: creator, __v: 0 }
    });
    assert.equal(query.getOptions().new, true);
    assert.equal(query.getOptions().upsert, true);
    assert.equal(query.getOptions().runValidators, true);
});

test('accepted updates do not include createdBy in the existing-record mutation', () => {
    const query = PocketBudget.upsertAccepted({
        pocket: 'Groceries',
        month: 2,
        year: 2027,
        budget: 650000,
        createdBy: creator,
        updatedBy: updater
    }, { upsert: false });

    const update = query.getUpdate();
    assert.equal(update.$set.createdBy, undefined);
    assert.equal(update.$setOnInsert, undefined);
    assert.equal(query.getOptions().upsert, false);
});
