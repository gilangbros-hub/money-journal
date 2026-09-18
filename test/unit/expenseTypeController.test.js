'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createExpenseTypeController } = require('../../controllers/expenseTypeController');

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
                configuration: { expenseTypeManagementEnabled: true }
            }
        },
        ...overrides
    };
}

test('getExpenseTypeManagementPage renders with capability flags from the session and configuration', async () => {
    const handlers = createExpenseTypeController({ service: {} });
    const res = response();

    await handlers.getExpenseTypeManagementPage(request(), res);

    assert.equal(res.body.view, 'expense-type-management');
    assert.equal(res.body.data.canEdit, true);
    assert.equal(res.body.data.role, 'Wife');
    assert.equal(res.body.data.expenseTypeManagementEnabled, true);
});

test('getExpenseTypeManagementPage reflects a disabled flag and a non-Wife session', async () => {
    const handlers = createExpenseTypeController({ service: {} });
    const res = response();

    await handlers.getExpenseTypeManagementPage(request({
        session: { userId, username: 'husband', role: 'Husband' },
        app: { locals: { configuration: { expenseTypeManagementEnabled: false } } }
    }), res);

    assert.equal(res.body.data.canEdit, false);
    assert.equal(res.body.data.expenseTypeManagementEnabled, false);
});

test('read and write handlers delegate to the service with the request-derived actor/options and echo its result', async () => {
    const calls = [];
    const service = {};
    for (const method of ['listExpenseTypeDefinitions', 'createExpenseTypeDefinition', 'updateExpenseTypeDefinition', 'archiveExpenseTypeDefinition', 'restoreExpenseTypeDefinition']) {
        service[method] = async (...args) => {
            calls.push([method, args]);
            return { ok: true };
        };
    }
    const handlers = createExpenseTypeController({ service });

    await handlers.listTypes(request({ query: { includeArchived: 'true' } }), response());
    await handlers.createType(request({ body: { name: 'Pulsa', emoji: '📱' } }), response());
    await handlers.updateType(request({ params: { typeId: 'type-1' }, body: { name: 'New' } }), response());
    await handlers.archiveType(request({ params: { typeId: 'type-1' } }), response());
    await handlers.restoreType(request({ params: { typeId: 'type-1' } }), response());

    assert.deepEqual(calls.map(([method]) => method), [
        'listExpenseTypeDefinitions',
        'createExpenseTypeDefinition',
        'updateExpenseTypeDefinition',
        'archiveExpenseTypeDefinition',
        'restoreExpenseTypeDefinition'
    ]);
    assert.deepEqual(calls[0][1][0], { includeArchived: 'true' });
    assert.deepEqual(calls[1][1][0], { name: 'Pulsa', emoji: '📱' });
    assert.equal(calls[2][1][0], 'type-1');
    assert.deepEqual(calls[2][1][1], { name: 'New' });
    assert.equal(calls[2][1][2].userId, userId);
    assert.equal(calls[2][1][3].expenseTypeManagementEnabled, true);
});

test('a JSON response mirrors the service result for every handler', async () => {
    const service = {
        listExpenseTypeDefinitions: async () => ({ active: [] }),
        createExpenseTypeDefinition: async () => ({ id: 'type-1' })
    };
    const handlers = createExpenseTypeController({ service });

    const listRes = response();
    await handlers.listTypes(request(), listRes);
    assert.deepEqual(listRes.body, { success: true, data: { active: [] } });

    const createRes = response();
    await handlers.createType(request({ body: { name: 'Pulsa', emoji: '📱' } }), createRes);
    assert.deepEqual(createRes.body, { success: true, data: { id: 'type-1' } });
});
