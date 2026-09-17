'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { POCKETS } = require('../../utils/constants');
const PocketBudget = require('../../models/pocketBudget');
const PocketBudgetCadence = require('../../models/pocketBudgetCadence');
const WeeklyAllocation = require('../../models/weeklyAllocation');

const actorId = new mongoose.Types.ObjectId();
const firstPocket = Object.keys(POCKETS)[0];

function declaredIndexes(model) {
    return model.schema.indexes().map(([keys, options]) => ({
        keys,
        unique: options.unique === true
    }));
}

test('cadence and weekly models use additive, separate collections', () => {
    assert.equal(PocketBudget.collection.name, 'pocketbudgets');
    assert.equal(PocketBudgetCadence.collection.name, 'pocketbudgetcadences');
    assert.equal(WeeklyAllocation.collection.name, 'weeklyallocations');
    assert.notEqual(PocketBudgetCadence.collection.name, PocketBudget.collection.name);
    assert.notEqual(WeeklyAllocation.collection.name, PocketBudget.collection.name);
    assert.equal(PocketBudgetCadence.schema.options.timestamps, true);
    assert.equal(WeeklyAllocation.schema.options.timestamps, true);
});

test('cadence schema exposes the supported pockets, cadence enum, audit fields, and exact unique key', () => {
    const cadence = new PocketBudgetCadence({
        pocket: firstPocket,
        month: 2,
        year: 2027,
        cadence: 'Weekly',
        createdBy: actorId,
        updatedBy: actorId
    });

    assert.equal(cadence.version, 0);
    assert.equal(cadence.validateSync(), undefined);
    const invalidCadence = new PocketBudgetCadence({
        pocket: firstPocket,
        month: 2,
        year: 2027,
        cadence: 'Daily',
        createdBy: actorId,
        updatedBy: actorId
    }).validateSync();
    assert.notEqual(invalidCadence, undefined);
    assert.match(invalidCadence.errors.cadence.message, /enum/);

    assert.deepEqual(declaredIndexes(PocketBudgetCadence), [
        { keys: { pocket: 1, month: 1, year: 1 }, unique: true },
        { keys: { year: 1, month: 1, pocket: 1 }, unique: false }
    ]);
});

test('weekly allocation validates integer rupiah and ISO week ranges', () => {
    const allocation = new WeeklyAllocation({
        pocket: firstPocket,
        month: 2,
        year: 2027,
        isoWeekYear: 2027,
        isoWeekNumber: 8,
        budget: 125000,
        createdBy: actorId,
        updatedBy: actorId
    });

    assert.equal(allocation.version, 0);
    assert.equal(allocation.validateSync(), undefined);

    for (const values of [
        { budget: 12.5 },
        { budget: -1 },
        { isoWeekNumber: 0 },
        { isoWeekNumber: 54 },
        { pocket: 'Unknown pocket' }
    ]) {
        const invalid = new WeeklyAllocation({
            pocket: firstPocket,
            month: 2,
            year: 2027,
            isoWeekYear: 2027,
            isoWeekNumber: 8,
            budget: 125000,
            createdBy: actorId,
            updatedBy: actorId,
            ...values
        });
        assert.notEqual(invalid.validateSync(), undefined, JSON.stringify(values));
    }
});

test('weekly allocation has exact composite uniqueness and period/pocket read index', () => {
    assert.deepEqual(declaredIndexes(WeeklyAllocation), [
        {
            keys: {
                pocket: 1,
                month: 1,
                year: 1,
                isoWeekYear: 1,
                isoWeekNumber: 1
            },
            unique: true
        },
        { keys: { year: 1, month: 1, pocket: 1 }, unique: false }
    ]);
});
