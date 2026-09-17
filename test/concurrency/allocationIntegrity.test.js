'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const mongoose = require('mongoose');
const budgetService = require('../../services/budgetService');
const PocketBudget = require('../../models/pocketBudget');
const WeeklyAllocation = require('../../models/weeklyAllocation');
const ClosedMonth = require('../../models/closedMonth');
const { withIsolatedDatabase } = require('../helpers/isolatedDatabase');
const { assertAsyncProperty } = require('../helpers/property');
const { correlatedConcurrentWritesArbitrary } = require('../arbitraries');

const integrationTest = process.env.RUN_MONGO_INTEGRATION === '1' ? test : test.skip;
const MONTHLY_KEY = { pocket: 1, month: 1, year: 1 };
const WEEKLY_KEY = {
    pocket: 1,
    month: 1,
    year: 1,
    isoWeekYear: 1,
    isoWeekNumber: 1
};
const BUDGET_MONTH = '2027-02';
const ISO_WEEK = '2027-W05';
const WRITE_OPTIONS = {
    nowInstant: '2027-02-01T04:00:00Z',
    timeZone: 'Asia/Jakarta',
    salaryCycleBudgetingEnabled: true
};

/**
 * Feature: salary-cycle-budgeting
 * Property 13: Concurrent allocation writes preserve uniqueness and complete accepted values
 * **Validates: Requirements 5.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14**
 */
integrationTest('Property 13: concurrent allocation writes preserve uniqueness and complete accepted values', {
    concurrency: false,
    timeout: 300_000
}, async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        await Promise.all([PocketBudget.init(), WeeklyAllocation.init()]);
        await assertProductionUniqueIndex(PocketBudget, MONTHLY_KEY);
        await assertProductionUniqueIndex(WeeklyAllocation, WEEKLY_KEY);

        await assertAsyncProperty(
            fc.asyncProperty(correlatedConcurrentWritesArbitrary, async requests => {
                await resetAllocationCollections();
                await runAllocationRace({
                    allocationType: 'Monthly',
                    requests,
                    connection
                });

                await resetAllocationCollections();
                await runAllocationRace({
                    allocationType: 'Weekly',
                    requests,
                    connection
                });
            })
        );
    });
});

integrationTest('concurrent weekly upserts leave one complete composite-key record', async () => {
    await withIsolatedDatabase(async () => {
        await WeeklyAllocation.init();
        const key = {
            pocket: 'Groceries',
            month: 2,
            year: 2027,
            isoWeekYear: 2027,
            isoWeekNumber: 5
        };
        const requests = Array.from({ length: 100 }, (_, index) => ({
            budget: index + 1,
            updatedBy: new mongoose.Types.ObjectId()
        }));
        const outcomes = await Promise.allSettled(requests.map(async request => {
            await new Promise(resolve => setTimeout(resolve, indexDelay(request.budget)));
            return WeeklyAllocation.findOneAndUpdate(
                key,
                {
                    $set: { budget: request.budget, updatedBy: request.updatedBy },
                    $setOnInsert: { createdBy: request.updatedBy },
                    $inc: { version: 1 }
                },
                { upsert: true, new: true, runValidators: true }
            ).lean().exec();
        }));
        const accepted = outcomes.filter(outcome => outcome.status === 'fulfilled').map(outcome => outcome.value);
        const records = await WeeklyAllocation.find(key).lean();
        assert.equal(records.length, 1);
        assert.ok(accepted.length > 0);
        const final = records[0];
        assert.ok(requests.some(request => request.budget === final.budget && String(request.updatedBy) === String(final.updatedBy)));
    });
});

async function runAllocationRace({ allocationType, requests, connection }) {
    const outcomes = await Promise.allSettled(requests.map(async request => {
        await new Promise(resolve => setTimeout(resolve, request.delayMs));
        const actor = {
            userId: new mongoose.Types.ObjectId(request.updatedBy),
            role: 'Wife'
        };
        const command = allocationType === 'Monthly'
            ? { pocket: request.pocket, budgetMonth: BUDGET_MONTH, amount: request.amount }
            : {
                pocket: request.pocket,
                budgetMonth: BUDGET_MONTH,
                isoWeek: ISO_WEEK,
                amount: request.amount
            };
        const result = allocationType === 'Monthly'
            ? await budgetService.putMonthlyAllocation(command, actor, { ...WRITE_OPTIONS, connection })
            : await budgetService.putWeeklyAllocation(command, actor, { ...WRITE_OPTIONS, connection });
        return { request, result };
    }));

    const accepted = outcomes
        .filter(outcome => outcome.status === 'fulfilled')
        .map(outcome => outcome.value);
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');

    assert.ok(accepted.length > 0, `${allocationType} race must accept at least one request`);
    for (const outcome of rejected) {
        assert.ok(isExpectedConflict(outcome.reason),
            `${allocationType} race returned an unexpected rejection: ${outcome.reason?.code || outcome.reason}`);
    }

    const model = allocationType === 'Monthly' ? PocketBudget : WeeklyAllocation;
    const key = allocationType === 'Monthly'
        ? { pocket: 'Groceries', month: 2, year: 2027 }
        : {
            pocket: 'Groceries',
            month: 2,
            year: 2027,
            isoWeekYear: 2027,
            isoWeekNumber: 5
        };
    const records = await model.find(key).lean();
    assert.equal(records.length, 1, `${allocationType} composite key must remain unique`);

    const final = records[0];
    const acceptedByVersion = [...accepted].sort((left, right) => allocationVersion(left.result) - allocationVersion(right.result));
    const highestAccepted = acceptedByVersion.at(-1);
    assert.equal(final.version, accepted.length, `${allocationType} version must count committed accepted writes`);
    assert.equal(final.version, allocationVersion(highestAccepted.result),
        `${allocationType} final record must reflect the highest committed version`);
    assert.equal(final.budget, highestAccepted.request.amount,
        `${allocationType} final amount must come from one complete accepted request`);
    assert.equal(String(final.updatedBy), highestAccepted.request.updatedBy,
        `${allocationType} final updater must match the final accepted request`);

    // The mutable amount and audit actor must never be assembled from different requests.
    const finalRequest = requestsContainCompletePair(accepted.map(item => item.request), final);
    assert.ok(finalRequest,
        `${allocationType} final mutable fields must form a correlated request tuple`);
    assert.equal(finalRequest.requestToken, highestAccepted.request.requestToken,
        `${allocationType} final fields must retain the winning request token correlation`);

    const firstAccepted = acceptedByVersion[0];
    assert.equal(String(final.createdBy), firstAccepted.request.updatedBy,
        `${allocationType} creation audit must match the first accepted request`);
}

async function resetAllocationCollections() {
    await Promise.all([
        PocketBudget.deleteMany({}),
        WeeklyAllocation.deleteMany({}),
        ClosedMonth.deleteMany({})
    ]);
}

async function assertProductionUniqueIndex(model, expectedKey) {
    const indexes = await model.collection.indexes();
    assert.ok(indexes.some(index => index.unique === true && deepEqual(index.key, expectedKey)),
        `${model.modelName} must have its production unique composite index`);
}

function requestsContainCompletePair(requests, record) {
    return requests.find(request =>
        request.amount === record.budget && request.updatedBy === String(record.updatedBy));
}

function allocationVersion(result) {
    return Number(result.version);
}

function isExpectedConflict(error) {
    return error?.code === 'ALLOCATION_WRITE_CONFLICT'
        || error?.code === 11000
        || error?.codeName === 'DuplicateKey'
        || error?.codeName === 'WriteConflict'
        || error?.code === 112;
}

function deepEqual(left, right) {
    const leftEntries = Object.entries(left || {});
    const rightEntries = Object.entries(right || {});
    return leftEntries.length === rightEntries.length && leftEntries.every(([key, value]) => right[key] === value);
}

function indexDelay(value) {
    return value % 7;
}
