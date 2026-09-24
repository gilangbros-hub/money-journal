'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const PocketAssignment = require('../../models/pocketAssignment');

const actorId = new mongoose.Types.ObjectId();

const MONTHLY = [{ kind: 'Monthly', key: 'monthly', amount: 250000 }];
const WEEKLY = [
    { kind: 'Weekly', key: '2026-W39', isoWeekYear: 2026, isoWeekNumber: 39, amount: 50000 },
    { kind: 'Weekly', key: '2026-W40', isoWeekYear: 2026, isoWeekNumber: 40, amount: 50000 }
];

// Runs the same update validators findOneAndUpdate({ runValidators: true })
// runs, without needing a database connection.
async function validateUpdate(set) {
    const query = PocketAssignment.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(), version: 1 },
        { $set: { ...set, updatedBy: actorId }, $inc: { version: 1 } }
    );
    await query.validate(query._castUpdate(query.getUpdate()), {}, false);
}

test('re-confirming a monthly assignment with a new amount passes update validation', async () => {
    await assert.doesNotReject(validateUpdate({ cadenceSnapshot: 'Monthly', allocations: MONTHLY }));
});

test('re-confirming a weekly assignment with new amounts passes update validation', async () => {
    await assert.doesNotReject(validateUpdate({ cadenceSnapshot: 'Weekly', allocations: WEEKLY }));
});

test('update validation still rejects allocations that do not match the cadence', async () => {
    await assert.rejects(
        validateUpdate({ cadenceSnapshot: 'Weekly', allocations: MONTHLY }),
        error => error.name === 'ValidationError' && Boolean(error.errors.allocations)
    );
});

test('update validation still rejects duplicate weekly keys', async () => {
    await assert.rejects(
        validateUpdate({ cadenceSnapshot: 'Weekly', allocations: [WEEKLY[0], WEEKLY[0]] }),
        error => error.name === 'ValidationError' && Boolean(error.errors.allocations)
    );
});
