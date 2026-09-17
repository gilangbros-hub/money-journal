'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const transactionRoutes = require('../../routes/transactions');
const Transaction = require('../../models/transaction');
const { withIsolatedDatabase } = require('../helpers/isolatedDatabase');
const { errorHandler, requestIdMiddleware } = require('../../middleware/errorHandler');

const authenticatedUserId = '507f1f77bcf86cd799439011';

function createTestApp({ router = transactionRoutes } = {}) {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = req.get('X-Test-User')
            ? {
                userId: authenticatedUserId,
                username: 'route-user',
                role: req.get('X-Test-Role') || 'Husband'
            }
            : {};
        next();
    });
    app.use(router);
    app.use(errorHandler);
    return app;
}

test('authenticated Wife and household-member assignment previews are canonical and role-independent', async () => {
    const app = createTestApp();
    const wifeResponse = await request(app)
        .get('/api/salary-cycle/assignment')
        .set('X-Test-User', 'wife')
        .set('X-Test-Role', 'Wife')
        .query({ date: '2027-02-24' });
    const memberResponse = await request(app)
        .get('/api/salary-cycle/assignment')
        .set('X-Test-User', 'husband')
        .set('X-Test-Role', 'Husband')
        .query({ date: '2027-02-24' });

    assert.equal(wifeResponse.status, 200);
    assert.equal(memberResponse.status, 200);
    assert.equal(wifeResponse.body.success, true);
    assert.deepEqual(memberResponse.body.data, wifeResponse.body.data);
    assert.equal(wifeResponse.body.data.expenseDate, '2027-02-24');
    assert.equal(wifeResponse.body.data.date, '2027-02-24');
    assert.equal(wifeResponse.body.data.budgetMonth, '2027-02');
    assert.deepEqual(wifeResponse.body.data.period, {
        startDate: '2027-01-25',
        endDate: '2027-02-24'
    });
});

test('unauthenticated assignment preview is rejected without assignment or period disclosure', async () => {
    const response = await request(createTestApp())
        .get('/api/salary-cycle/assignment')
        .query({ date: '2027-02-24' });

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(Object.hasOwn(response.body, 'data'), false);
    assert.equal(JSON.stringify(response.body).includes('2027-02'), false);
});

test('authenticated assignment preview returns a field error for an invalid date', async () => {
    const response = await request(createTestApp())
        .get('/api/salary-cycle/assignment')
        .set('X-Test-User', 'authenticated')
        .query({ date: '2027-02-30' });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.field, 'date');
    assert.equal(Object.hasOwn(response.body, 'data'), false);
});


const runIntegration = process.env.RUN_MONGO_INTEGRATION === '1';
const integrationTest = runIntegration
    ? (name, fn) => test(name, { concurrency: false }, fn)
    : test.skip;

integrationTest('authenticated Wife and household-member routes preserve canonical dates and assignment rules', async () => {
    await withIsolatedDatabase(async () => {
        const app = createTestApp();
        const wife = request(app).post('/api/transaction').set('X-Test-User', 'wife').set('X-Test-Role', 'Wife');
        const base = {
            type: 'Groceries',
            pocket: 'Groceries',
            ngapain: 'route expense',
            amount: 125000,
            paidBy: 'Wife',
            sourceType: 'single'
        };

        const created = await wife.send({ ...base, expenseDate: '2027-02-24' });
        assert.equal(created.status, 200);
        assert.equal(created.body.success, true);

        const matching = await request(app)
            .post('/api/transaction')
            .set('X-Test-User', 'husband')
            .set('X-Test-Role', 'Husband')
            .send({
                ...base,
                expenseDate: '2027-02-25',
                budgetMonth: 3,
                budgetYear: 2027
            });
        assert.equal(matching.status, 200);

        const conflict = await request(app)
            .post('/api/transaction')
            .set('X-Test-User', 'husband')
            .set('X-Test-Role', 'Husband')
            .send({
                ...base,
                expenseDate: '2027-02-24',
                budgetMonth: 3,
                budgetYear: 2027
            });
        assert.equal(conflict.status, 409);
        assert.equal(conflict.body.error.code, 'BUDGET_MONTH_ASSIGNMENT_CONFLICT');
        assert.equal(conflict.body.error.field, 'budgetMonth');
        assert.deepEqual(conflict.body.error.details, {
            derivedBudgetMonth: '2027-02',
            derivedMonth: 2,
            derivedYear: 2027
        });
        assert.equal(conflict.body.error.requestId, conflict.headers['x-request-id']);
        assert.equal(Object.hasOwn(conflict.body, 'data'), false);
        assert.equal(JSON.stringify(conflict.body).includes('route expense'), false);
        assert.equal(await Transaction.countDocuments(), 2);

        const listed = await request(app)
            .get('/api/transactions')
            .set('X-Test-User', 'husband')
            .set('X-Test-Role', 'Husband')
            .query({ month: '2027-02' });
        assert.equal(listed.status, 200);
        assert.equal(listed.body.length, 1);
        assert.equal(listed.body[0].expenseDate, '2027-02-24');
        assert.equal(listed.body[0].date, '2027-02-24');
        const history = await request(app)
            .get('/api/history')
            .set('X-Test-User', 'husband')
            .set('X-Test-Role', 'Husband')
            .query({ month: '2027-02' });
        assert.equal(history.status, 200);
        assert.equal(history.body.success, true);
        assert.equal(history.body.data.budgetMonth, '2027-02');
        assert.equal(history.body.data.transactions.length, 1);
        assert.equal(history.body.data.transactions[0].expenseDate, '2027-02-24');
        assert.deepEqual(Object.keys(history.body.data.byDate), ['2027-02-24']);
        const id = listed.body[0]._id;

        const fetched = await request(app)
            .get(`/api/transaction/${id}`)
            .set('X-Test-User', 'husband');
        assert.equal(fetched.status, 200);
        assert.equal(fetched.body.expenseDate, '2027-02-24');
        assert.equal(fetched.body.budgetMonth, 2);

        const updated = await request(app)
            .put(`/api/transaction/${id}`)
            .set('X-Test-User', 'husband')
            .send({ ...base, expenseDate: '2027-03-24', ngapain: 'moved route expense' });
        assert.equal(updated.status, 200);

        const afterUpdate = await request(app)
            .get(`/api/transaction/${id}`)
            .set('X-Test-User', 'wife');
        assert.equal(afterUpdate.status, 200);
        assert.equal(afterUpdate.body.expenseDate, '2027-03-24');
        assert.equal(afterUpdate.body.date, '2027-03-24');
        assert.equal(afterUpdate.body.budgetMonth, 3);

        const deleted = await request(app)
            .delete(`/api/transaction/${id}`)
            .set('X-Test-User', 'wife');
        assert.equal(deleted.status, 200);
        assert.equal(await Transaction.countDocuments(), 1);
    });
});

integrationTest('authenticated routes return stable errors while unauthenticated clients receive no transaction data', async () => {
    await withIsolatedDatabase(async () => {
        const app = createTestApp();
        const unauthenticatedRead = await request(app).get('/api/transactions');
        assert.equal(unauthenticatedRead.status, 401);
        assert.equal(unauthenticatedRead.body.error.code, 'AUTHENTICATION_REQUIRED');
        assert.equal(unauthenticatedRead.body.error.requestId, unauthenticatedRead.headers['x-request-id']);
        assert.equal(Object.hasOwn(unauthenticatedRead.body, 'data'), false);

        for (const path of ['/api/history?month=2027-02', '/api/dashboard/summary?month=2027-02']) {
            const compatibilityRead = await request(app).get(path);
            assert.equal(compatibilityRead.status, 401);
            assert.equal(compatibilityRead.body.error.code, 'AUTHENTICATION_REQUIRED');
            assert.equal(Object.hasOwn(compatibilityRead.body, 'data'), false);
            assert.equal(JSON.stringify(compatibilityRead.body).includes('2027-02'), false);
        }

        const unauthenticatedWrite = await request(app)
            .post('/api/transaction')
            .send({ expenseDate: '2027-02-24', amount: 1000 });
        assert.equal(unauthenticatedWrite.status, 401);
        assert.equal(unauthenticatedWrite.body.error.code, 'AUTHENTICATION_REQUIRED');
        assert.equal(unauthenticatedWrite.body.error.requestId, unauthenticatedWrite.headers['x-request-id']);
        assert.equal(JSON.stringify(unauthenticatedWrite.body).includes('2027-02-24'), false);

        const created = await request(app)
            .post('/api/transaction')
            .set('X-Test-User', 'wife')
            .set('X-Test-Role', 'Wife')
            .send({
                type: 'Groceries',
                pocket: 'Groceries',
                ngapain: 'private route expense',
                amount: 1000,
                paidBy: 'Wife',
                expenseDate: '2027-02-24'
            });
        assert.equal(created.status, 200);
        const stored = await Transaction.findOne({ ngapain: 'private route expense' }).lean();
        assert.ok(stored);

        for (const response of [
            await request(app).get(`/api/transaction/${stored._id}`),
            await request(app).put(`/api/transaction/${stored._id}`).send({
                type: 'Groceries', pocket: 'Groceries', ngapain: 'attacker update',
                amount: 999999, paidBy: 'Husband', expenseDate: '2027-02-24'
            }),
            await request(app).delete(`/api/transaction/${stored._id}`)
        ]) {
            assert.equal(response.status, 401);
            assert.equal(response.body.error.code, 'AUTHENTICATION_REQUIRED');
            assert.equal(Object.hasOwn(response.body, 'data'), false);
            assert.equal(JSON.stringify(response.body).includes('private route expense'), false);
            assert.equal(JSON.stringify(response.body).includes('999999'), false);
        }
        assert.equal(await Transaction.countDocuments(), 1);

        const invalidDate = await request(app)
            .post('/api/transaction')
            .set('X-Test-User', 'self')
            .set('X-Test-Role', 'Self')
            .send({
                type: 'Groceries',
                pocket: 'Groceries',
                ngapain: 'invalid route date',
                amount: 1000,
                paidBy: 'Self',
                expenseDate: '2027-02-30'
            });
        assert.equal(invalidDate.status, 400);
        assert.equal(invalidDate.body.error.code, 'VALIDATION_ERROR');
        assert.equal(invalidDate.body.error.field, 'expenseDate');
        assert.equal(await Transaction.countDocuments(), 1);
    });
});
