'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramController } = require('../../controllers/telegramController');

function response() {
    return {
        statusCode: null,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }
    };
}

function request(overrides = {}) {
    return {
        body: {},
        session: { userId: 'user-1' },
        app: {
            locals: {
                configuration: {
                    householdTimeZone: 'Asia/Jakarta',
                    salaryCycleBudgetingEnabled: true,
                    pocketManagementEnabled: true,
                    expenseTypeManagementEnabled: true,
                    telegramBotEnabled: true,
                    telegramBotToken: 'test-token'
                }
            }
        },
        ...overrides
    };
}

test('createLinkCode delegates to the link service with the session actor', async () => {
    const calls = [];
    const linkService = { createLinkCode: async (actor) => { calls.push(actor); return { code: '123456', expiresAt: 'later' }; } };
    const handlers = createTelegramController({ linkService });
    const res = response();

    await handlers.createLinkCode(request(), res);

    assert.deepEqual(calls[0], { userId: 'user-1' });
    assert.deepEqual(res.body, { success: true, data: { code: '123456', expiresAt: 'later' } });
});

test('unlink delegates to the link service and returns a bare success', async () => {
    const calls = [];
    const linkService = { removeLink: async (actor) => { calls.push(actor); } };
    const handlers = createTelegramController({ linkService });
    const res = response();

    await handlers.unlink(request(), res);

    assert.deepEqual(calls[0], { userId: 'user-1' });
    assert.deepEqual(res.body, { success: true });
});

test('webhook responds 200 immediately and only then processes the update', async () => {
    const order = [];
    const botService = {
        handleUpdate: async () => { order.push('handled'); }
    };
    const handlers = createTelegramController({ botService });
    const res = response();
    const originalJson = res.json.bind(res);
    res.json = (value) => { order.push('responded'); return originalJson(value); };

    await handlers.webhook(request({ body: { message: { text: '/log' } } }), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(order, ['responded', 'handled']);
});

test('webhook does nothing when the bot is disabled or has no token, but still responds 200', async () => {
    const calls = [];
    const botService = { handleUpdate: async () => { calls.push('called'); } };
    const handlers = createTelegramController({ botService });

    const disabledRes = response();
    await handlers.webhook(request({
        app: { locals: { configuration: { telegramBotEnabled: false, telegramBotToken: 'x' } } }
    }), disabledRes);
    assert.equal(disabledRes.statusCode, 200);

    const noTokenRes = response();
    await handlers.webhook(request({
        app: { locals: { configuration: { telegramBotEnabled: true, telegramBotToken: '' } } }
    }), noTokenRes);
    assert.equal(noTokenRes.statusCode, 200);

    assert.equal(calls.length, 0);
});

test('webhook swallows a handler error instead of throwing (Telegram already got its 200)', async () => {
    const botService = { handleUpdate: async () => { throw new Error('boom'); } };
    const handlers = createTelegramController({ botService });
    const res = response();

    await assert.doesNotReject(() => handlers.webhook(request(), res));
    assert.equal(res.statusCode, 200);
});

test('the Telegram API client is built from the configured token, not hardcoded', async () => {
    const seenTokens = [];
    const botService = { handleUpdate: async () => {} };
    const apiClientFactory = ({ token }) => { seenTokens.push(token); return {}; };
    const handlers = createTelegramController({ botService, apiClientFactory });

    await handlers.webhook(request(), response());

    assert.deepEqual(seenTokens, ['test-token']);
});
