'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const budgetService = require('../../services/budgetService');
const transactionService = require('../../services/transactionService');
const PocketBudget = require('../../models/pocketBudget');
const PocketBudgetCadence = require('../../models/pocketBudgetCadence');
const WeeklyAllocation = require('../../models/weeklyAllocation');
const ClosedMonth = require('../../models/closedMonth');
const Transaction = require('../../models/transaction');
const { withIsolatedDatabase } = require('../helpers/isolatedDatabase');
const {
    ClosedBudgetPeriodError,
    DomainValidationError,
    EditableWindowError,
    RecordNotFoundError
} = require('../../utils/domainErrors');

const integrationTest = process.env.RUN_MONGO_INTEGRATION === '1'
    ? (name, fn) => test(name, { concurrency: false }, fn)
    : test.skip;

const wife = { userId: new mongoose.Types.ObjectId(), role: 'Wife' };
const options = {
    nowInstant: '2027-02-01T04:00:00Z',
    timeZone: 'Asia/Jakarta',
    salaryCycleBudgetingEnabled: true
};

function dbOptions(connection) {
    return { ...options, connection };
}

function sameMonth(options = {}) {
    return { budgetMonth: '2027-02', ...options };
}

async function expense(connection, pocket, amount, ngapain = pocket) {
    return transactionService.createExpense({
        expenseDate: '2027-02-01',
        type: 'Groceries',
        pocket,
        ngapain,
        amount,
        paidBy: 'Self'
    }, wife, { ...dbOptions(connection) });
}

integrationTest('retrieves missing allocations and applies pocket, alert, and aggregate thresholds from Mongo data', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const injected = dbOptions(connection);
        for (const pocket of ['Groceries', 'Kwintals', 'Weekday Transport']) {
            await budgetService.putMonthlyAllocation({
                pocket, ...sameMonth(), amount: 100
            }, wife, injected);
        }

        await expense(connection, 'Groceries', 70, 'seventy percent');
        await expense(connection, 'Kwintals', 80, 'eighty percent');
        await expense(connection, 'Weekday Transport', 100, 'fully spent');
        await expense(connection, 'Sedeqah', 25, 'missing allocation');

        const initial = await budgetService.getBudgetMonthView(sameMonth(), wife, injected);
        const groceries = initial.pockets.find(item => item.pocket === 'Groceries');
        const kwintals = initial.pockets.find(item => item.pocket === 'Kwintals');
        const transport = initial.pockets.find(item => item.pocket === 'Weekday Transport');
        const missing = initial.pockets.find(item => item.pocket === 'Sedeqah');

        assert.deepEqual({
            budget: groceries.budget,
            spent: groceries.periodMetrics.spending,
            percentage: groceries.percentageUsed,
            status: groceries.status,
            alert: groceries.alertStatus
        }, { budget: 100, spent: 70, percentage: 70, status: 'warning', alert: 'none' });
        assert.deepEqual({
            percentage: kwintals.percentageUsed,
            status: kwintals.status,
            alert: kwintals.alertStatus
        }, { percentage: 80, status: 'warning', alert: 'warning' });
        assert.deepEqual({
            percentage: transport.percentageUsed,
            status: transport.status,
            alert: transport.alertStatus
        }, { percentage: 100, status: 'danger', alert: 'danger' });
        assert.deepEqual({
            missingAllocation: missing.missingAllocation,
            budget: missing.budget,
            spent: missing.periodMetrics.spending,
            remaining: missing.remaining,
            percentage: missing.percentageUsed
        }, {
            missingAllocation: true,
            budget: 0,
            spent: 25,
            remaining: -25,
            percentage: 0
        });

        assert.equal(initial.aggregate.allocation, 300);
        assert.equal(initial.aggregate.spending, 275);
        assert.equal(initial.aggregate.percentageUsed, 92);
        assert.equal(initial.aggregate.status, 'warning');

        await expense(connection, 'Sedeqah', 25, 'aggregate reaches limit');
        const atLimit = await budgetService.getBudgetMonthView(sameMonth(), wife, injected);
        assert.equal(atLimit.aggregate.allocation, 300);
        assert.equal(atLimit.aggregate.spending, 300);
        assert.equal(atLimit.aggregate.percentageUsed, 100);
        assert.equal(atLimit.aggregate.status, 'danger');
    });
});

integrationTest('weekly retrieval and exact-key writes reject invalid weeks without changing database state', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const injected = dbOptions(connection);
        await budgetService.setCadence({
            pocket: 'Groceries', ...sameMonth(), cadence: 'Weekly'
        }, wife, injected);
        const saved = await budgetService.putWeeklyAllocation({
            pocket: 'Groceries', ...sameMonth(), isoWeek: '2027-W05', amount: 250
        }, wife, injected);

        const before = {
            weekly: await WeeklyAllocation.find({}).sort({ pocket: 1, isoWeekNumber: 1 }).lean(),
            cadence: await PocketBudgetCadence.find({}).lean(),
            guards: await ClosedMonth.find({}).lean()
        };
        const view = await budgetService.getBudgetMonthView({
            ...sameMonth(), selectedWeek: '2027-W05'
        }, wife, injected);
        const pocket = view.pockets.find(item => item.pocket === 'Groceries');
        assert.equal(pocket.selectedWeek.key, '2027-W05');
        assert.equal(pocket.selectedWeek.allocation._id.toString(), saved._id.toString());
        assert.equal(pocket.selectedWeek.allocation.amount, 250);

        await assert.rejects(
            () => budgetService.putWeeklyAllocation({
                pocket: 'Groceries', ...sameMonth(), isoWeek: '2027-W03', amount: 999
            }, wife, injected),
            error => error instanceof DomainValidationError && error.field === 'isoWeek'
        );
        await assert.rejects(
            () => budgetService.putWeeklyAllocation({
                pocket: 'Groceries', ...sameMonth(), isoWeek: '2027-W54', amount: 999
            }, wife, injected),
            error => error instanceof DomainValidationError && error.field === 'isoWeek'
        );

        assert.deepEqual(await WeeklyAllocation.find({}).sort({ pocket: 1, isoWeekNumber: 1 }).lean(), before.weekly);
        assert.deepEqual(await PocketBudgetCadence.find({}).lean(), before.cadence);
        assert.deepEqual(await ClosedMonth.find({}).lean(), before.guards);
    });
});

integrationTest('editable boundaries, cadence cancellation, and protected allocation deletes are enforced atomically', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const injected = dbOptions(connection);
        const monthly = await budgetService.putMonthlyAllocation({
            pocket: 'Groceries', ...sameMonth(), amount: 1000
        }, wife, injected);
        const beforeCancel = {
            monthly: await PocketBudget.findOne({ pocket: 'Groceries', month: 2, year: 2027 }).lean(),
            cadenceCount: await PocketBudgetCadence.countDocuments()
        };

        // Omitting confirmation is the service-level equivalent of cancelling
        // the UI confirmation: no cadence record or inactive transition occurs.
        await assert.rejects(
            () => budgetService.setCadence({
                pocket: 'Groceries', ...sameMonth(), cadence: 'Weekly'
            }, wife, injected),
            error => error instanceof DomainValidationError && error.field === 'confirmInactive'
        );
        assert.deepEqual(await PocketBudget.findOne({ pocket: 'Groceries', month: 2, year: 2027 }).lean(), beforeCancel.monthly);
        assert.equal(await PocketBudgetCadence.countDocuments(), beforeCancel.cadenceCount);

        await budgetService.setCadence({
            pocket: 'Groceries', ...sameMonth(), cadence: 'Weekly', confirmInactive: true
        }, wife, injected);
        const weekly = await budgetService.putWeeklyAllocation({
            pocket: 'Groceries', ...sameMonth(), isoWeek: '2027-W05', amount: 250
        }, wife, injected);

        await assert.rejects(
            () => budgetService.putMonthlyAllocation({
                pocket: 'Groceries', budgetMonth: '2027-01', amount: 10
            }, wife, injected),
            error => error instanceof EditableWindowError
        );
        await assert.rejects(
            () => budgetService.putMonthlyAllocation({
                pocket: 'Groceries', budgetMonth: '2027-04', amount: 10
            }, wife, injected),
            error => error instanceof EditableWindowError
        );

        await budgetService.toggleBudgetMonthClosed(sameMonth(), wife, injected);
        const beforeDelete = {
            monthly: await PocketBudget.findOne({ _id: monthly._id }).lean(),
            weekly: await WeeklyAllocation.findOne({ _id: weekly._id }).lean(),
            cadence: await PocketBudgetCadence.findOne({ pocket: 'Groceries', month: 2, year: 2027 }).lean(),
            guard: await ClosedMonth.findOne({ month: 2, year: 2027 }).lean()
        };
        for (const allocationType of ['monthly', 'weekly']) {
            const id = allocationType === 'monthly' ? monthly._id : weekly._id;
            await assert.rejects(
                () => budgetService.deleteAllocation({ allocationType, id }, wife, injected),
                error => error instanceof ClosedBudgetPeriodError
            );
        }
        await assert.rejects(
            () => budgetService.setCadence({
                pocket: 'Groceries', ...sameMonth(), cadence: 'Monthly', confirmInactive: true
            }, wife, injected),
            error => error instanceof ClosedBudgetPeriodError
        );

        assert.deepEqual(await PocketBudget.findOne({ _id: monthly._id }).lean(), beforeDelete.monthly);
        assert.deepEqual(await WeeklyAllocation.findOne({ _id: weekly._id }).lean(), beforeDelete.weekly);
        assert.deepEqual(await PocketBudgetCadence.findOne({ pocket: 'Groceries', month: 2, year: 2027 }).lean(), beforeDelete.cadence);
        const afterRejections = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        assert.equal(afterRejections.mutationSequence, beforeDelete.guard.mutationSequence);

        await budgetService.toggleBudgetMonthClosed(sameMonth(), wife, injected);
        await budgetService.deleteAllocation({ allocationType: 'weekly', id: weekly._id }, wife, injected);
        assert.equal(await WeeklyAllocation.countDocuments({ _id: weekly._id }), 0);
        assert.equal(await PocketBudget.countDocuments({ _id: monthly._id }), 1);
    });
});

integrationTest('close, reopen, cadence, allocation, and expense races leave one complete serializable result', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const injected = dbOptions(connection);

        const closeVsCadence = await Promise.allSettled([
            budgetService.toggleBudgetMonthClosed(sameMonth(), wife, injected),
            budgetService.setCadence({
                pocket: 'Groceries', ...sameMonth(), cadence: 'Weekly'
            }, wife, injected)
        ]);
        let guard = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        let cadence = await PocketBudgetCadence.findOne({ pocket: 'Groceries', month: 2, year: 2027 }).lean();
        assert.equal(guard.isClosed, true);
        assert.ok(cadence === null || cadence.cadence === 'Weekly');
        if (closeVsCadence[1].status === 'rejected') {
            assert.equal(cadence, null);
        }

        const reopenVsAllocation = await Promise.allSettled([
            budgetService.toggleBudgetMonthClosed(sameMonth(), wife, injected),
            budgetService.putMonthlyAllocation({
                pocket: 'Kwintals', ...sameMonth(), amount: 400
            }, wife, injected)
        ]);
        guard = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        const allocation = await PocketBudget.findOne({ pocket: 'Kwintals', month: 2, year: 2027 }).lean();
        assert.equal(guard.isClosed, false);
        assert.ok(allocation === null || allocation.budget === 400);
        if (reopenVsAllocation[1].status === 'rejected') {
            assert.equal(allocation, null);
        }

        const closeVsExpense = await Promise.allSettled([
            budgetService.toggleBudgetMonthClosed(sameMonth(), wife, injected),
            expense(connection, 'Weekday Transport', 125, 'serialized race')
        ]);
        guard = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        const transactions = await Transaction.find({ pocket: 'Weekday Transport' }).lean();
        assert.equal(guard.isClosed, true);
        assert.ok(transactions.length === 0 || transactions.length === 1);
        if (closeVsExpense[1].status === 'rejected') assert.equal(transactions.length, 0);
        if (transactions.length === 1) {
            assert.equal(transactions[0].amount, 125);
            assert.equal(transactions[0].budgetMonth, 2);
            assert.equal(transactions[0].pocket, 'Weekday Transport');
        }

        // Every fulfilled mutation above must have a matching complete record;
        // no promise may report success while its protected record is absent.
        assert.equal(
            closeVsCadence[1].status === 'fulfilled',
            cadence !== null
        );
        assert.equal(
            reopenVsAllocation[1].status === 'fulfilled',
            allocation !== null
        );
        assert.equal(
            closeVsExpense[1].status === 'fulfilled',
            transactions.length === 1
        );
    });
});

integrationTest('unauthorized allocation deletion and close/rejection leave all records unchanged', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const injected = dbOptions(connection);
        const member = { userId: new mongoose.Types.ObjectId(), role: 'Husband' };
        const allocation = await budgetService.putMonthlyAllocation({
            pocket: 'Groceries', ...sameMonth(), amount: 200
        }, wife, injected);
        const before = await PocketBudget.find({}).lean();

        await assert.rejects(
            () => budgetService.deleteAllocation({ allocationType: 'monthly', id: allocation._id }, member, injected),
            error => error.code === 'WIFE_ROLE_REQUIRED'
        );
        assert.deepEqual(await PocketBudget.find({}).lean(), before);

        await budgetService.toggleBudgetMonthClosed(sameMonth(), wife, injected);
        await assert.rejects(
            () => budgetService.deleteAllocation({ allocationType: 'monthly', id: new mongoose.Types.ObjectId() }, wife, injected),
            error => error instanceof RecordNotFoundError
        );
        assert.equal(await PocketBudget.countDocuments(), 1);
    });
});
