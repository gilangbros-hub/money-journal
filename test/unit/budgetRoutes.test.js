'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const budgetRoutes = require('../../routes/budget');
const { errorHandler, requestIdMiddleware } = require('../../middleware/errorHandler');

function controllerFor(calls) {
    const result = (name) => (req, res) => {
        calls.push(name);
        res.json({ success: true, route: name });
    };
    return {
        getBudgetPage: result('page'),
        getBudgets: result('read'),
        getBudgetHistory: result('history'),
        getClosedMonths: result('closed-months'),
        saveBudget: result('legacy-save'),
        setCadence: result('cadence'),
        putMonthlyAllocation: result('monthly'),
        putWeeklyAllocation: result('weekly'),
        toggleMonthClosed: result('close'),
        deleteAllocation: result('typed-delete'),
        deleteBudget: result('legacy-delete')
    };
}

function appFor({ featureEnabled = true, session = {} } = {}) {
    const calls = [];
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.locals.configuration = { salaryCycleBudgetingEnabled: featureEnabled };
    app.use((req, res, next) => {
        req.session = session;
        next();
    });
    app.use(budgetRoutes.createBudgetRoutes({ controller: controllerFor(calls) }));
    app.use(errorHandler);
    app.calls = calls;
    return app;
}

test('budget routes require authentication and Wife authorization for mutations', async () => {
    const unauthenticated = await request(appFor()).get('/api/budget');
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.error.code, 'AUTHENTICATION_REQUIRED');

    const householdMember = await request(appFor({
        session: { userId: 'member-1', role: 'Husband' }
    })).post('/api/budget').send({ pocket: 'Groceries', month: 2, year: 2027, budget: 100 });
    assert.equal(householdMember.status, 403);
    assert.equal(householdMember.body.error.code, 'WIFE_ROLE_REQUIRED');
});

test('budget routes preserve reads and legacy commands while exposing explicit routes', async () => {
    const app = appFor({ session: { userId: 'wife-1', role: 'Wife' } });

    for (const [method, path, body, expected] of [
        ['get', '/api/budget', undefined, 'read'],
        ['get', '/api/budget/history', undefined, 'history'],
        ['get', '/api/budget/closed-months', undefined, 'closed-months'],
        ['post', '/api/budget', { pocket: 'Groceries' }, 'legacy-save'],
        ['put', '/api/budget/cadence', { cadence: 'Weekly' }, 'cadence'],
        ['put', '/api/budget/allocation/monthly', { amount: 100 }, 'monthly'],
        ['put', '/api/budget/allocation/weekly', { amount: 25 }, 'weekly'],
        ['post', '/api/budget/toggle-month-close', { budgetMonth: '2027-02' }, 'close'],
        ['delete', '/api/budget/allocation/monthly/monthly-1', undefined, 'typed-delete'],
        ['delete', '/api/budget/allocation/weekly/weekly-1', undefined, 'typed-delete'],
        ['delete', '/api/budget/monthly-1', undefined, 'legacy-delete']
    ]) {
        const response = request(app)[method](path);
        if (body) response.send(body);
        const result = await response;
        assert.equal(result.status, 200, `${method.toUpperCase()} ${path}`);
        assert.equal(result.body.route, expected);
    }

    assert.deepEqual(app.calls, [
        'read', 'history', 'closed-months', 'legacy-save', 'cadence',
        'monthly', 'weekly', 'close', 'typed-delete', 'typed-delete', 'legacy-delete'
    ]);
});

test('weekly cadence writes and typed deletes are rejected while rollout is disabled', async () => {
    const app = appFor({
        featureEnabled: false,
        session: { userId: 'wife-1', role: 'Wife' }
    });

    const weeklyWrite = await request(app)
        .put('/api/budget/allocation/weekly')
        .send({ pocket: 'Groceries', budgetMonth: '2027-02', isoWeek: '2027-W05', amount: 25 });
    assert.equal(weeklyWrite.status, 404);
    assert.equal(weeklyWrite.body.error.code, 'SALARY_CYCLE_FEATURE_DISABLED');

    const weeklyDelete = await request(app)
        .delete('/api/budget/allocation/weekly/weekly-1');
    assert.equal(weeklyDelete.status, 404);
    assert.equal(weeklyDelete.body.error.code, 'SALARY_CYCLE_FEATURE_DISABLED');
    assert.deepEqual(app.calls, []);
});
