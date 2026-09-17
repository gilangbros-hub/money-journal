'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const budgetService = require('../../services/budgetService');
const PocketBudget = require('../../models/pocketBudget');
const PocketBudgetCadence = require('../../models/pocketBudgetCadence');
const WeeklyAllocation = require('../../models/weeklyAllocation');
const ClosedMonth = require('../../models/closedMonth');
const { withIsolatedDatabase } = require('../helpers/isolatedDatabase');
const {
    AuthorizationError,
    ClosedBudgetPeriodError,
    DomainValidationError,
    EditableWindowError
} = require('../../utils/domainErrors');

const integrationTest = process.env.RUN_MONGO_INTEGRATION === '1'
    ? (name, fn) => test(name, { concurrency: false }, fn)
    : test.skip;

const wife = { userId: new mongoose.Types.ObjectId(), role: 'Wife' };
const husband = { userId: new mongoose.Types.ObjectId(), role: 'Husband' };
const options = {
    nowInstant: '2027-02-01T04:00:00Z',
    timeZone: 'Asia/Jakarta',
    salaryCycleBudgetingEnabled: true
};

function dbOptions(connection) {
    return { ...options, connection };
}

integrationTest('commands enforce authorization, editable window, inactive retention, and close/reopen persistence', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const injected = dbOptions(connection);
        await assert.rejects(
            () => budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-02', amount: 100 }, husband, injected),
            error => error instanceof AuthorizationError
        );
        await assert.rejects(
            () => budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-01', amount: 100 }, wife, injected),
            error => error instanceof EditableWindowError
        );

        await budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-02', amount: 1000 }, wife, injected);
        await assert.rejects(
            () => budgetService.setCadence({ pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly' }, wife, injected),
            error => error instanceof DomainValidationError && error.field === 'confirmInactive'
        );
        await budgetService.setCadence({
            pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly', confirmInactive: true
        }, wife, injected);
        await budgetService.putWeeklyAllocation({
            pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W05', amount: 250
        }, wife, injected);

        const monthly = await PocketBudget.findOne({ pocket: 'Groceries', month: 2, year: 2027 }).lean();
        const cadence = await PocketBudgetCadence.findOne({ pocket: 'Groceries', month: 2, year: 2027 }).lean();
        assert.equal(monthly.budget, 1000);
        assert.equal(cadence.cadence, 'Weekly');
        assert.equal(await WeeklyAllocation.countDocuments({ pocket: 'Groceries', month: 2, year: 2027 }), 1);

        const closed = await budgetService.toggleBudgetMonthClosed({ budgetMonth: '2027-02' }, wife, injected);
        assert.equal(closed.isClosed, true);
        const guardBeforeReopen = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        await assert.rejects(
            () => budgetService.putWeeklyAllocation({
                pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W05', amount: 300
            }, wife, injected),
            error => error instanceof ClosedBudgetPeriodError
        );

        const reopened = await budgetService.toggleBudgetMonthClosed({ budgetMonth: '2027-02' }, wife, injected);
        const guardAfterReopen = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        assert.equal(reopened.isClosed, false);
        assert.equal(guardAfterReopen._id.toString(), guardBeforeReopen._id.toString());
        assert.equal(guardAfterReopen.mutationSequence, guardBeforeReopen.mutationSequence + 1);
        assert.equal((await WeeklyAllocation.findOne({ pocket: 'Groceries', month: 2, year: 2027 }).lean()).budget, 250);
    });
});

integrationTest('close and allocation races produce one serialized, complete outcome', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const injected = dbOptions(connection);
        await budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-02', amount: 100 }, wife, injected);

        const outcomes = await Promise.allSettled([
            budgetService.toggleBudgetMonthClosed({ budgetMonth: '2027-02' }, wife, injected),
            budgetService.putMonthlyAllocation({ pocket: 'Groceries', budgetMonth: '2027-02', amount: 200 }, wife, injected)
        ]);
        const guard = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        const allocation = await PocketBudget.findOne({ pocket: 'Groceries', month: 2, year: 2027 }).lean();
        assert.equal(guard.isClosed, true);
        assert.equal(allocation.version, 1 + (outcomes[1].status === 'fulfilled' ? 1 : 0));
        if (outcomes[1].status === 'rejected') {
            assert.equal(outcomes[1].reason.code, 'BUDGET_MONTH_CLOSED');
            assert.equal(allocation.budget, 100);
        } else {
            assert.equal(allocation.budget, 200);
        }
    });
});
