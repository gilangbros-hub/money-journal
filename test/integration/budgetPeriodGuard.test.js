'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ClosedMonth = require('../../models/closedMonth');
const {
    withOpenBudgetPeriod,
    withOpenBudgetPeriods
} = require('../../services/budgetPeriodGuard');
const { withDatabaseSession } = require('../helpers/databaseSession');
const { withIsolatedDatabase } = require('../helpers/isolatedDatabase');
const { ClosedBudgetPeriodError } = require('../../utils/domainErrors');

const runIntegration = process.env.RUN_MONGO_INTEGRATION === '1';
const integrationTest = runIntegration ? test : test.skip;

integrationTest('guard fence and protected write abort together on operation failure', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        await ClosedMonth.ensureOpen({ month: 2, year: 2027 }).exec();
        const writes = connection.collection('guardedperiodwrites');

        await assert.rejects(
            () => withDatabaseSession(session => withOpenBudgetPeriod(
                2,
                2027,
                session,
                async () => {
                    await writes.insertOne({ marker: 'must-abort' }, { session });
                    throw new Error('reject protected operation');
                }
            ), { connection }),
            /reject protected operation/
        );

        assert.equal(await writes.countDocuments({ marker: 'must-abort' }), 0);
        const guard = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        assert.equal(guard.isClosed, false);
        assert.equal(guard.mutationSequence, 0);
    });
});

integrationTest('cross-period edits fence source and destination in sorted order', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        await ClosedMonth.ensureOpen({ month: 2, year: 2027 }).exec();
        await ClosedMonth.ensureOpen({ month: 3, year: 2027 }).exec();
        const writes = connection.collection('guardedperiodwrites');

        await withDatabaseSession(session => withOpenBudgetPeriods([
            { month: 3, year: 2027 },
            { month: 2, year: 2027 }
        ], session, async (guards) => {
            assert.deepEqual(guards.map(guard => `${guard.year}-${String(guard.month).padStart(2, '0')}`), [
                '2027-02', '2027-03'
            ]);
            await writes.insertOne({ marker: 'committed' }, { session });
        }), { connection });

        assert.equal(await writes.countDocuments({ marker: 'committed' }), 1);
        const guards = await ClosedMonth.find({ year: 2027 }).sort({ month: 1 }).lean();
        assert.deepEqual(guards.map(guard => guard.mutationSequence), [1, 1]);
    });
});

integrationTest('a closed period rejects without mutating protected data', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        await ClosedMonth.closePeriod({ month: 2, year: 2027 }).exec();
        const writes = connection.collection('guardedperiodwrites');

        await assert.rejects(
            () => withDatabaseSession(session => withOpenBudgetPeriod(
                2,
                2027,
                session,
                async () => writes.insertOne({ marker: 'must-not-write' }, { session })
            ), { connection }),
            error => error instanceof ClosedBudgetPeriodError
                && error.code === 'BUDGET_MONTH_CLOSED'
                && error.details.budgetMonth === '2027-02'
        );

        assert.equal(await writes.countDocuments({ marker: 'must-not-write' }), 0);
        const guard = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        assert.equal(guard.isClosed, true);
        assert.equal(guard.mutationSequence, 1);
    });
});
