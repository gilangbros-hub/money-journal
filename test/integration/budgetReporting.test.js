'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const express = require('express');
const Transaction = require('../../models/transaction');
require('../../models/user');
const PocketBudget = require('../../models/pocketBudget');
const WeeklyAllocation = require('../../models/weeklyAllocation');
const budgetService = require('../../services/budgetService');
const reportingService = require('../../services/reportingService');
const budgetRoutes = require('../../routes/budget');
const transactionRoutes = require('../../routes/transactions');
const { errorHandler, requestIdMiddleware } = require('../../middleware/errorHandler');
const { withIsolatedDatabase } = require('../helpers/isolatedDatabase');

const runIntegration = process.env.RUN_MONGO_INTEGRATION === '1';
const integrationTest = runIntegration
    ? (name, fn) => test(name, { concurrency: false }, fn)
    : test.skip;

const wife = {
    userId: new mongoose.Types.ObjectId(),
    role: 'Wife'
};
const readOptions = {
    nowInstant: '2027-02-01T04:00:00Z',
    timeZone: 'Asia/Jakarta'
};

integrationTest('budget reads expose salary-cycle metadata and active cadence allocation metrics', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const monthly = await budgetService.putMonthlyAllocation({
            pocket: 'Groceries', budgetMonth: '2027-02', amount: 300000
        }, wife, { connection, ...readOptions });
        assert.equal(monthly.budget, 300000);

        const initial = await budgetService.getBudgetMonthView({ budgetMonth: '2027-02' }, wife, {
            connection, ...readOptions
        });
        assert.deepEqual(initial.period, { startDate: '2027-01-25', endDate: '2027-02-24' });
        assert.equal(initial.timeZone, 'Asia/Jakarta');
        assert.ok(initial.availableWeeks.some(week => week.key === '2027-W05'));

        await budgetService.setCadence({
            pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly', confirmInactive: true
        }, wife, { connection, ...readOptions });
        const week = initial.availableWeeks[0];
        await budgetService.putWeeklyAllocation({
            pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: week.key, amount: 125000
        }, wife, { connection, ...readOptions });

        await Transaction.create({
            expenseDate: week.intersectionStartDate,
            date: new Date(`${week.intersectionStartDate}T05:00:00.000Z`),
            type: 'Groceries', pocket: 'Groceries', ngapain: 'weekly item', by: wife.userId,
            paidBy: 'Self', amount: 50000, budgetMonth: 2, budgetYear: 2027,
            assignmentVersion: 'salary-cycle-v1', schemaVersion: 2
        });

        const view = await budgetService.getBudgetMonthView({
            budgetMonth: '2027-02', week: week.key
        }, wife, { connection, ...readOptions });
        const groceries = view.pockets.find(pocket => pocket.pocket === 'Groceries');
        assert.equal(groceries.cadence, 'Weekly');
        assert.equal(groceries.selectedWeek.key, week.key);
        assert.equal(groceries.selectedWeek.metrics.spending, 50000);
        assert.equal(groceries.monthlyAllocation.budget, 300000);
        assert.equal(await PocketBudget.countDocuments({ pocket: 'Groceries', month: 2, year: 2027 }), 1);
        assert.equal(await WeeklyAllocation.countDocuments({ pocket: 'Groceries', month: 2, year: 2027 }), 1);
    });
});

integrationTest('reporting filters by stored Budget_Month and counts split transactions once', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const userId = new mongoose.Types.ObjectId();
        await Transaction.create([
            {
                expenseDate: '2027-02-01', date: new Date('2027-02-01T05:00:00Z'),
                type: 'Groceries', pocket: 'Groceries', ngapain: 'stored February', by: userId,
                paidBy: 'Self', amount: 100000, budgetMonth: 2, budgetYear: 2027,
                assignmentVersion: 'legacy-preserved', schemaVersion: 2
            },
            {
                expenseDate: '2027-02-25', date: new Date('2027-02-25T05:00:00Z'),
                type: 'Groceries', pocket: 'Groceries', ngapain: 'stored February despite date', by: userId,
                paidBy: 'Self', amount: 90000, budgetMonth: 2, budgetYear: 2027,
                sourceType: 'multi', sourceBreakdowns: [
                    { pocket: 'Groceries', amount: 50000 },
                    { pocket: 'Kwintals', amount: 40000 }
                ], assignmentVersion: 'legacy-preserved', schemaVersion: 2
            }
        ]);
        const data = await reportingService.getDashboardSummary({ month: '2027-02' }, { userId, role: 'Husband' }, {
            connection, ...readOptions
        });
        assert.equal(data.budgetMonth, '2027-02');
        assert.equal(data.total.raw, 190000);
        assert.equal(data.period.startDate, '2027-01-25');
        assert.equal(data.recent[0].expenseDate, '2027-02-25');
    });
});

integrationTest('budget routes preserve authentication and expose explicit cadence endpoints', async () => {
    await withIsolatedDatabase(async () => {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.session = req.get('X-Test-User') ? { userId: wife.userId, role: req.get('X-Test-Role') || 'Husband' } : {};
            next();
        });
        app.use(budgetRoutes);
        const unauthenticated = await request(app).get('/api/budget?month=2027-02');
        assert.equal(unauthenticated.status, 401);

        const forbidden = await request(app)
            .put('/api/budget/cadence')
            .set('X-Test-User', 'member')
            .send({ pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly' });
        assert.equal(forbidden.status, 403);
    });
});

test('reporting service module exposes dashboard and transaction adapters', () => {
    assert.equal(typeof reportingService.getDashboardSummary, 'function');
    assert.equal(typeof reportingService.getAllTransactions, 'function');
    assert.equal(typeof budgetService.getBudgetMonthView, 'function');
});


function createApiApp(connection, { enabled = true, role = 'Wife' } = {}) {
    const app = express();
    app.locals.connection = connection;
    app.locals.householdTimeZone = 'Asia/Jakarta';
    app.locals.nowInstant = readOptions.nowInstant;
    app.locals.configuration = { salaryCycleBudgetingEnabled: enabled };
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = req.get('X-Test-User')
            ? { userId: wife.userId, role: req.get('X-Test-Role') || role, username: 'integration-user' }
            : {};
        next();
    });
    app.use(budgetRoutes);
    app.use(transactionRoutes);
    app.use(errorHandler);
    return app;
}

function storedTransaction(overrides = {}) {
    return {
        expenseDate: '2027-02-01',
        date: new Date('2027-02-01T05:00:00.000Z'),
        type: 'Groceries',
        pocket: 'Groceries',
        ngapain: 'integration expense',
        by: wife.userId,
        paidBy: 'Self',
        amount: 100,
        budgetMonth: 2,
        budgetYear: 2027,
        assignmentVersion: 'legacy-preserved',
        schemaVersion: 2,
        ...overrides
    };
}

integrationTest('budget API exposes canonical monthly and selected-week response contracts', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const app = createApiApp(connection);
        await budgetService.putMonthlyAllocation({
            pocket: 'Groceries', budgetMonth: '2027-02', amount: 200
        }, wife, { connection, ...readOptions });
        await Transaction.create(storedTransaction({ amount: 50, ngapain: 'monthly metric' }));

        const monthly = await request(app)
            .get('/api/budget?month=2027-02')
            .set('X-Test-User', 'wife');
        assert.equal(monthly.status, 200);
        assert.equal(monthly.body.success, true);
        const monthlyData = monthly.body.data;
        assert.deepEqual(monthlyData.period, { startDate: '2027-01-25', endDate: '2027-02-24' });
        assert.equal(monthlyData.salaryCyclePeriod.startDate, '2027-01-25');
        assert.equal(monthlyData.featureEnabled, true);
        assert.equal(monthlyData.timeZone, 'Asia/Jakarta');
        assert.ok(Array.isArray(monthlyData.availableWeeks));
        const monthlyPocket = monthlyData.pockets.find(item => item.pocket === 'Groceries');
        assert.equal(monthlyPocket.cadence, 'Monthly');
        assert.equal(monthlyPocket.metrics.spending, 50);
        assert.equal(monthlyPocket.metrics.allocation, 200);
        assert.equal(monthlyPocket.monthlyAllocation.budget, 200);
        assert.equal(monthlyPocket.selectedWeek, null);

        await budgetService.setCadence({
            pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly', confirmInactive: true
        }, wife, { connection, ...readOptions });
        await budgetService.putWeeklyAllocation({
            pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W05', amount: 100
        }, wife, { connection, ...readOptions });
        const weekly = await request(app)
            .get('/api/budget?month=2027-02&week=2027-W05')
            .set('X-Test-User', 'husband')
            .set('X-Test-Role', 'Husband');
        assert.equal(weekly.status, 200);
        const weeklyPocket = weekly.body.data.pockets.find(item => item.pocket === 'Groceries');
        assert.equal(weeklyPocket.cadence, 'Weekly');
        assert.equal(weeklyPocket.selectedWeek.key, '2027-W05');
        assert.equal(weeklyPocket.selectedWeek.metrics.spending, 50);
        assert.equal(weeklyPocket.selectedWeek.metrics.allocation, 100);
        assert.equal(weeklyPocket.monthlyAllocation.budget, 200);
        assert.equal(weeklyPocket.periodMetrics.allocation, 100);
        assert.equal(weekly.body.data.selectedWeek, '2027-W05');
    });
});

integrationTest('crossing ISO weeks are listed in both periods and metrics use only each period intersection', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const injected = { connection, ...readOptions };
        await budgetService.setCadence({
            pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly'
        }, wife, injected);
        await budgetService.setCadence({
            pocket: 'Groceries', budgetMonth: '2027-03', cadence: 'Weekly'
        }, wife, injected);
        await budgetService.putWeeklyAllocation({
            pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W08', amount: 100
        }, wife, injected);
        await budgetService.putWeeklyAllocation({
            pocket: 'Groceries', budgetMonth: '2027-03', isoWeek: '2027-W08', amount: 200
        }, wife, injected);
        await Transaction.create([
            storedTransaction({
                expenseDate: '2027-02-24', date: new Date('2027-02-24T05:00:00.000Z'),
                amount: 40, ngapain: 'before payday', budgetMonth: 2
            }),
            storedTransaction({
                expenseDate: '2027-02-25', date: new Date('2027-02-25T05:00:00.000Z'),
                amount: 60, ngapain: 'after payday', budgetMonth: 3
            })
        ]);

        const february = await budgetService.getBudgetMonthView({
            budgetMonth: '2027-02', selectedWeek: '2027-W08'
        }, wife, injected);
        const march = await budgetService.getBudgetMonthView({
            budgetMonth: '2027-03', selectedWeek: '2027-W08'
        }, wife, injected);
        const febWeek = february.availableWeeks.find(week => week.key === '2027-W08');
        const marchWeek = march.availableWeeks.find(week => week.key === '2027-W08');
        assert.deepEqual({
            startDate: febWeek.intersectionStartDate,
            endDate: febWeek.intersectionEndDate
        }, { startDate: '2027-02-22', endDate: '2027-02-24' });
        assert.deepEqual({
            startDate: marchWeek.intersectionStartDate,
            endDate: marchWeek.intersectionEndDate
        }, { startDate: '2027-02-25', endDate: '2027-02-28' });
        assert.equal(february.pockets.find(item => item.pocket === 'Groceries').selectedWeek.metrics.spending, 40);
        assert.equal(march.pockets.find(item => item.pocket === 'Groceries').selectedWeek.metrics.spending, 60);
    });
});

integrationTest('selected weekly metrics apply alert and pocket status thresholds at 80 and 100 percent', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const injected = { connection, ...readOptions };
        await budgetService.setCadence({
            pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly'
        }, wife, injected);
        await budgetService.putWeeklyAllocation({
            pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W05', amount: 100
        }, wife, injected);
        await Transaction.create(storedTransaction({ amount: 80, ngapain: 'weekly warning' }));
        const warning = await budgetService.getBudgetMonthView({
            budgetMonth: '2027-02', selectedWeek: '2027-W05'
        }, wife, injected);
        let pocket = warning.pockets.find(item => item.pocket === 'Groceries');
        assert.deepEqual({
            percentage: pocket.percentageUsed,
            status: pocket.status,
            alert: pocket.alertStatus
        }, { percentage: 80, status: 'warning', alert: 'warning' });

        await Transaction.create(storedTransaction({ amount: 20, ngapain: 'weekly danger' }));
        const danger = await budgetService.getBudgetMonthView({
            budgetMonth: '2027-02', selectedWeek: '2027-W05'
        }, wife, injected);
        pocket = danger.pockets.find(item => item.pocket === 'Groceries');
        assert.deepEqual({
            percentage: pocket.percentageUsed,
            status: pocket.status,
            alert: pocket.alertStatus,
            remaining: pocket.remaining
        }, { percentage: 100, status: 'danger', alert: 'danger', remaining: 0 });
    });
});

integrationTest('reporting honors stored assignments, filters split pockets once, and compares the prior named month', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const userId = new mongoose.Types.ObjectId();
        await Transaction.create([
            storedTransaction({
                by: userId, amount: 500, ngapain: 'prior named month',
                expenseDate: '2027-01-30', date: new Date('2027-01-30T05:00:00.000Z'),
                budgetMonth: 1
            }),
            storedTransaction({
                by: userId, amount: 900, ngapain: 'stored February despite payday date',
                expenseDate: '2027-02-25', date: new Date('2027-02-25T05:00:00.000Z'),
                budgetMonth: 2, sourceType: 'multi',
                sourceBreakdowns: [
                    { pocket: 'Groceries', amount: 500 },
                    { pocket: 'Kwintals', amount: 400 }
                ]
            }),
            storedTransaction({
                by: userId, amount: 100, ngapain: 'derived March but stored February',
                expenseDate: '2027-03-01', date: new Date('2027-03-01T05:00:00.000Z'),
                budgetMonth: 2
            })
        ]);
        const actor = { userId, role: 'Husband' };
        const summary = await reportingService.getDashboardSummary({ month: '2027-02' }, actor, {
            connection, ...readOptions
        });
        assert.equal(summary.total.raw, 1000);
        assert.equal(summary.comparison.previousBudgetMonth, '2027-01');
        assert.equal(summary.comparison.lastMonth.replace(/\u00a0/g, ' '), 'Rp 500');
        assert.equal(summary.comparison.increased, true);
        assert.equal(summary.recent[0].expenseDate, '2027-03-01');

        const filtered = await reportingService.getAllTransactions({
            month: '2027-02', pocket: 'Kwintals'
        }, actor, { connection, ...readOptions });
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].ngapain, 'stored February despite payday date');
        assert.equal(filtered[0].amount, 900);
        assert.equal(filtered[0].expenseDate, '2027-02-25');
    });
});

integrationTest('legacy monthly budget payloads and existing routes remain usable with feature off and on', async () => {
    for (const enabled of [false, true]) {
        await withIsolatedDatabase(async ({ connection }) => {
            const app = createApiApp(connection, { enabled });
            const prefix = { 'X-Test-User': 'wife', 'X-Test-Role': 'Wife' };
            const saved = await request(app)
                .post('/api/budget')
                .set(prefix)
                .send({ pocket: 'Groceries', month: 2, year: 2027, budget: 321 });
            assert.equal(saved.status, 200);
            assert.equal(saved.body.data.budget, 321);
            assert.equal(saved.body.data.amount, 321);

            const explicitMonthly = await request(app)
                .put('/api/budget/allocation/monthly')
                .set(prefix)
                .send({ pocket: 'Groceries', budgetMonth: '2027-02', amount: 322 });
            assert.equal(explicitMonthly.status, 200);
            assert.equal(explicitMonthly.body.data.budget, 322);
            const closedResponse = await request(app)
                .post('/api/budget/toggle-month-close')
                .set(prefix)
                .send({ budgetMonth: '2027-02' });
            const reopenedResponse = await request(app)
                .post('/api/budget/toggle-month-close')
                .set(prefix)
                .send({ budgetMonth: '2027-02' });
            assert.deepEqual([closedResponse.status, reopenedResponse.status], [200, 200]);
            const deletedMonthly = await request(app)
                .delete(`/api/budget/${saved.body.data._id}`)
                .set(prefix);
            assert.equal(deletedMonthly.status, 200);

            const monthly = await request(app).get('/api/budget?month=2027-02').set(prefix);
            const history = await request(app).get('/api/budget/history').set(prefix);
            const closed = await request(app).get('/api/budget/closed-months').set(prefix);
            const dashboard = await request(app).get('/api/dashboard/summary?month=2027-02').set(prefix);
            const reviewHistory = await request(app).get('/api/history?month=2027-02').set(prefix);
            const transactions = await request(app).get('/api/transactions?month=2027-02').set(prefix);
            assert.deepEqual(
                [monthly.status, history.status, closed.status, dashboard.status, reviewHistory.status, transactions.status],
                [200, 200, 200, 200, 200, 200]
            );
            assert.equal(monthly.body.data.featureEnabled, enabled);

            const created = await request(app)
                .post('/api/transaction')
                .set(prefix)
                .send({
                    type: 'Groceries', pocket: 'Groceries', ngapain: `route smoke ${enabled}`,
                    amount: 10, paidBy: 'Self', expenseDate: '2027-02-24',
                    ...(enabled ? {} : { budgetMonth: 9, budgetYear: 2027 })
                });
            assert.equal(created.status, 200);
            const stored = await Transaction.findOne({ ngapain: `route smoke ${enabled}` }).lean();
            const fetched = await request(app).get(`/api/transaction/${stored._id}`).set(prefix);
            const updated = await request(app).put(`/api/transaction/${stored._id}`).set(prefix).send({
                type: 'Groceries', pocket: 'Groceries', ngapain: `route smoke updated ${enabled}`,
                amount: 11, paidBy: 'Self', expenseDate: '2027-02-23'
            });
            const submitters = await request(app).get('/api/submitters').set(prefix);
            const assignment = await request(app).get('/api/salary-cycle/assignment?date=2027-02-24').set(prefix);
            assert.deepEqual([fetched.status, updated.status, submitters.status, assignment.status], [200, 200, 200, 200]);
            assert.equal(fetched.body.expenseDate, '2027-02-24');
            assert.equal(assignment.body.data.budgetMonth, '2027-02');

            if (enabled) {
                const cadence = await request(app).put('/api/budget/cadence').set(prefix).send({
                    pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly', confirmInactive: true
                });
                assert.equal(cadence.status, 200);
                const weekly = await request(app).put('/api/budget/allocation/weekly').set(prefix).send({
                    pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W05', amount: 10
                });
                assert.equal(weekly.status, 200);
                const deletedWeekly = await request(app)
                    .delete(`/api/budget/allocation/weekly/${weekly.body.data._id}`)
                    .set(prefix);
                assert.equal(deletedWeekly.status, 200);
            } else {
                const weekly = await request(app).put('/api/budget/allocation/weekly').set(prefix).send({
                    pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W05', amount: 10
                });
                assert.equal(weekly.status, 404);
                assert.equal(weekly.body.error.code, 'SALARY_CYCLE_FEATURE_DISABLED');
            }

            const deleted = await request(app).delete(`/api/transaction/${stored._id}`).set(prefix);
            assert.equal(deleted.status, 200);
        });
    }
});

integrationTest('budget and reporting reads enforce authentication and Wife-only mutations', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const app = createApiApp(connection, { enabled: true });
        const unauthenticated = await request(app).get('/api/budget?month=2027-02');
        assert.equal(unauthenticated.status, 401);
        assert.equal(unauthenticated.body.error.code, 'AUTHENTICATION_REQUIRED');
        assert.equal(Object.hasOwn(unauthenticated.body, 'data'), false);

        const member = await request(app)
            .post('/api/budget')
            .set('X-Test-User', 'member')
            .set('X-Test-Role', 'Husband')
            .send({ pocket: 'Groceries', month: 2, year: 2027, budget: 100 });
        assert.equal(member.status, 403);
        assert.equal(member.body.error.code, 'WIFE_ROLE_REQUIRED');
        assert.equal(await PocketBudget.countDocuments(), 0);

        const read = await request(app)
            .get('/api/dashboard/summary?month=2027-02')
            .set('X-Test-User', 'member')
            .set('X-Test-Role', 'Husband');
        assert.equal(read.status, 200);
        assert.equal(read.body.data.budgetMonth, '2027-02');
    });
});
