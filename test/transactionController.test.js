'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createTransactionController } = require('../controllers/transactionController');

const userId = new mongoose.Types.ObjectId().toString();

function response() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        }
    };
}

function request(overrides = {}) {
    return {
        body: {},
        query: {},
        params: {},
        session: { userId, username: 'test-user', role: 'Wife' },
        app: { locals: { householdTimeZone: 'Asia/Jakarta' } },
        ...overrides
    };
}

test('transaction controller delegates writes and keeps legacy response envelopes', async () => {
    const calls = [];
    const service = {
        async createExpense(...args) { calls.push(['createExpense', args]); return { _id: 'created' }; },
        async updateExpense(...args) { calls.push(['updateExpense', args]); return { _id: 'updated' }; },
        async deleteExpense(...args) { calls.push(['deleteExpense', args]); return { success: true }; }
    };
    const handlers = createTransactionController({ service });
    const createRes = response();
    await handlers.createTransaction(request({ body: { date: '2027-02-24', amount: 1000 } }), createRes);
    assert.deepEqual(createRes.body, {
        success: true,
        message: 'Transaction saved successfully!',
        id: 'created'
    });

    const updateRes = response();
    await handlers.updateTransaction(request({
        params: { id: '507f1f77bcf86cd799439011' },
        body: { date: '2027-02-25', amount: 1000 }
    }), updateRes);
    assert.deepEqual(updateRes.body, { success: true });

    const deleteRes = response();
    await handlers.deleteTransaction(request({ params: { id: '507f1f77bcf86cd799439011' } }), deleteRes);
    assert.deepEqual(deleteRes.body, { success: true });
    assert.equal(calls[0][0], 'createExpense');
    assert.equal(calls[0][1][1].userId, userId);
    assert.equal(calls[0][1][2].timeZone, 'Asia/Jakarta');
    assert.equal(calls[1][0], 'updateExpense');
    assert.equal(calls[2][0], 'deleteExpense');
});

test('transaction controller preserves list by username compatibility alias', async () => {
    const handlers = createTransactionController({
        service: {
            async listExpenses() {
                return [
                    { _id: 'one', by: { _id: 'u1', username: 'alice' }, expenseDate: '2027-02-24', date: '2027-02-24' },
                    { _id: 'two', by: null, expenseDate: '2027-02-25', date: '2027-02-25' }
                ];
            }
        }
    });
    const res = response();
    await handlers.getAllTransactions(request({ query: { month: '2027-02' } }), res);
    assert.deepEqual(res.body.map(transaction => transaction.by), ['alice', 'Unknown']);
});

test('assignment preview controller returns the service-derived period without querying transaction data', async () => {
    const calls = [];
    const handlers = createTransactionController({
        service: {
            async previewAssignment(...args) {
                calls.push(args);
                return {
                    expenseDate: '2027-02-24',
                    date: '2027-02-24',
                    budgetMonth: '2027-02',
                    month: 2,
                    year: 2027,
                    period: { startDate: '2027-01-25', endDate: '2027-02-24' }
                };
            }
        }
    });
    const res = response();
    await handlers.getAssignmentPreview(request({ query: { date: '2027-02-24' } }), res);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.budgetMonth, '2027-02');
    assert.deepEqual(res.body.data.period, { startDate: '2027-01-25', endDate: '2027-02-24' });
    assert.equal(calls[0][0], '2027-02-24');
    assert.equal(calls[0][1].userId, userId);
});

test('history controller delegates the authenticated history contract to ReportingService', async () => {
    const calls = [];
    const handlers = createTransactionController({
        service: {},
        reporting: {
            async getHistory(...args) {
                calls.push(args);
                return {
                    budgetMonth: '2027-02',
                    period: { startDate: '2027-01-25', endDate: '2027-02-24' },
                    transactions: []
                };
            }
        }
    });
    const res = response();
    await handlers.getHistory(request({ query: { month: '2027-02' } }), res);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.budgetMonth, '2027-02');
    assert.deepEqual(res.body.data.period, {
        startDate: '2027-01-25',
        endDate: '2027-02-24'
    });
    assert.equal(calls[0][0].month, '2027-02');
    assert.equal(calls[0][1].userId, userId);
});


test('page handlers retain the existing authenticated view names', () => {
    const controller = require('../controllers/transactionController');
    const rendered = [];
    const res = { render(view, data) { rendered.push([view, data]); } };
    const req = { session: { username: 'alice', avatar: '🧑' } };
    controller.getTransactionPage(req, res);
    controller.getTransactionsPage(req, res);
    controller.getAllTransactionsPage(req, res);
    assert.deepEqual(rendered.map(([view]) => view), [
        'log-spending',
        'monthly-story',
        'review-history'
    ]);
});

test('page handlers pass the Expense Type Management flag to the views', () => {
    const controller = require('../controllers/transactionController');
    const rendered = [];
    const res = { render(view, data) { rendered.push(data); } };
    const on = { session: { username: 'alice' }, app: { locals: { configuration: { expenseTypeManagementEnabled: true } } } };
    const off = { session: { username: 'alice' } };
    controller.getTransactionPage(on, res);
    controller.getTransactionsPage(on, res);
    controller.getAllTransactionsPage(on, res);
    controller.getTransactionPage(off, res);
    assert.deepEqual(rendered.map(data => data.expenseTypeManagementEnabled), [true, true, true, false]);
});

test('Story and History page handlers mark their navbar tab active', () => {
    const controller = require('../controllers/transactionController');
    const rendered = {};
    const res = { render(view, data) { rendered[view] = data; } };
    const req = { session: { username: 'alice' } };
    controller.getTransactionsPage(req, res);
    controller.getAllTransactionsPage(req, res);
    assert.equal(rendered['monthly-story'].isDashboard, true);
    assert.equal(rendered['review-history'].isHistory, true);
});
