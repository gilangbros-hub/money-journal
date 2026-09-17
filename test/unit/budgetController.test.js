'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createBudgetController } = require('../../controllers/budgetController');

const userId = new mongoose.Types.ObjectId().toString();

function response() {
    return {
        body: undefined,
        json(value) {
            this.body = value;
            return this;
        },
        render(view, data) {
            this.body = { view, data };
            return this;
        }
    };
}

function request(overrides = {}) {
    return {
        body: {},
        query: {},
        params: {},
        session: { userId, username: 'wife', role: 'Wife' },
        app: {
            locals: {
                householdTimeZone: 'Asia/Jakarta',
                nowInstant: '2027-02-01T04:00:00Z',
                configuration: { salaryCycleBudgetingEnabled: true }
            }
        },
        ...overrides
    };
}

test('budget controller uses server-derived month when GET has no month query', async () => {
    const calls = [];
    const handlers = createBudgetController({
        service: {
            async getBudgetMonthView(...args) {
                calls.push(args);
                return { budgetMonth: '2027-02', period: { startDate: '2027-01-25', endDate: '2027-02-24' } };
            }
        }
    });

    const res = response();
    await handlers.getBudgets(request(), res);

    assert.deepEqual(calls[0][0], {});
    assert.equal(calls[0][1].userId, userId);
    assert.equal(calls[0][2].timeZone, 'Asia/Jakarta');
    assert.equal(calls[0][2].salaryCycleBudgetingEnabled, true);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.budgetMonth, '2027-02');
});

test('budget controller preserves legacy save/delete envelopes and adapts payloads', async () => {
    const calls = [];
    const handlers = createBudgetController({
        service: {
            async putMonthlyAllocation(...args) {
                calls.push(['save', args]);
                return { _id: 'monthly-1', budget: 1200, amount: 1200 };
            },
            async deleteAllocation(...args) {
                calls.push(['delete', args]);
                return { success: true, allocationId: 'monthly-1' };
            }
        }
    });

    const saveRes = response();
    await handlers.saveBudget(request({ body: {
        pocket: 'Groceries', month: 2, year: 2027, budget: '1200'
    } }), saveRes);
    assert.deepEqual(saveRes.body, {
        success: true,
        message: 'Budget saved successfully',
        data: { _id: 'monthly-1', budget: 1200, amount: 1200 }
    });
    assert.deepEqual(calls[0][1][0], {
        pocket: 'Groceries', month: 2, year: 2027, amount: '1200', budget: '1200'
    });

    const deleteRes = response();
    await handlers.deleteBudget(request({ params: { id: 'monthly-1' } }), deleteRes);
    assert.deepEqual(deleteRes.body, {
        success: true,
        message: 'Budget deleted',
        data: { success: true, allocationId: 'monthly-1' }
    });
    assert.deepEqual(calls[1][1][0], { allocationType: 'monthly', id: 'monthly-1' });
});

test('budget controller delegates cadence, explicit allocations, close state, and history', async () => {
    const calls = [];
    const service = {};
    for (const method of [
        'setCadence',
        'putMonthlyAllocation',
        'putWeeklyAllocation',
        'deleteAllocation',
        'toggleBudgetMonthClosed',
        'getBudgetHistory',
        'getClosedBudgetMonths'
    ]) {
        service[method] = async (...args) => {
            calls.push([method, args]);
            return method === 'toggleBudgetMonthClosed' ? { isClosed: false } : [];
        };
    }
    const handlers = createBudgetController({ service });

    const body = { pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly' };
    await handlers.setCadence(request({ body }), response());
    await handlers.putMonthlyAllocation(request({ body: { ...body, amount: 100 } }), response());
    await handlers.putWeeklyAllocation(request({ body: { ...body, isoWeek: '2027-W05', amount: 25 } }), response());
    await handlers.deleteAllocation(request({ params: { type: 'weekly', id: 'weekly-1' } }), response());
    await handlers.toggleMonthClosed(request({ body: { budgetMonth: '2027-02' } }), response());
    await handlers.getBudgetHistory(request(), response());
    await handlers.getClosedMonths(request(), response());

    assert.deepEqual(calls.map(([method]) => method), [
        'setCadence',
        'putMonthlyAllocation',
        'putWeeklyAllocation',
        'deleteAllocation',
        'toggleBudgetMonthClosed',
        'getBudgetHistory',
        'getClosedBudgetMonths'
    ]);
    assert.deepEqual(calls[3][1][0], { allocationType: 'weekly', id: 'weekly-1' });
});
