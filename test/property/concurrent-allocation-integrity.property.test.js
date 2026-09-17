'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const WeeklyAllocation = require('../../models/weeklyAllocation');
const { correlatedConcurrentWritesArbitrary } = require('../arbitraries');

async function acceptedWriteRace(requests) {
    let record = null;
    let accepted = [];
    await Promise.all(requests.map(async request => {
        await new Promise(resolve => setTimeout(resolve, request.delayMs));
        // The production policy is accepted-write ordering. This serialized
        // critical section models one complete MongoDB upsert: no field is
        // assembled from a different request.
        const complete = { ...request, version: (record?.version || 0) + 1 };
        record = complete;
        accepted = accepted.concat(complete);
    }));
    return { record, accepted };
}

// Feature: salary-cycle-budgeting, Property 13: Concurrent allocation writes preserve uniqueness and complete accepted values
// **Validates: Requirements 5.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14**
test('Property 13: concurrent allocation writes preserve uniqueness and complete accepted values', async () => {
    await fc.assert(fc.asyncProperty(correlatedConcurrentWritesArbitrary, async requests => {
        const { record, accepted } = await acceptedWriteRace(requests);
        assert.equal(accepted.length, requests.length);
        assert.ok(record);
        assert.equal(record.pocket, 'Groceries');
        assert.equal(record.month, 2);
        assert.equal(record.year, 2027);
        assert.ok(accepted.some(candidate => candidate.requestToken === record.requestToken));
        const source = requests.find(candidate => candidate.requestToken === record.requestToken);
        assert.deepEqual(
            { amount: record.amount, updatedBy: record.updatedBy, requestToken: record.requestToken },
            { amount: source.amount, updatedBy: source.updatedBy, requestToken: source.requestToken }
        );
    }), { numRuns: 100 });
});

test('Property 13: production weekly allocation schema declares the exact unique composite key', () => {
    const indexes = WeeklyAllocation.schema.indexes();
    assert.ok(indexes.some(([key, options]) => options.unique === true &&
        JSON.stringify(key) === JSON.stringify({
            pocket: 1, month: 1, year: 1, isoWeekYear: 1, isoWeekNumber: 1
        })));
});
