'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requireTelegramWebhookSecret } = require('../../middleware/auth');
const { AuthenticationError } = require('../../utils/domainErrors');

function request({ configured, provided } = {}) {
    return {
        app: { locals: { configuration: { telegramWebhookSecret: configured } } },
        get(header) {
            return header === 'X-Telegram-Bot-Api-Secret-Token' ? provided : undefined;
        }
    };
}

function capturedNext() {
    const calls = [];
    return { calls, next: (arg) => calls.push(arg) };
}

test('a matching secret header passes through', () => {
    const { calls, next } = capturedNext();
    requireTelegramWebhookSecret(request({ configured: 'shh', provided: 'shh' }), {}, next);
    assert.deepEqual(calls, [undefined]);
});

test('a missing header is rejected', () => {
    const { calls, next } = capturedNext();
    requireTelegramWebhookSecret(request({ configured: 'shh', provided: undefined }), {}, next);
    assert.ok(calls[0] instanceof AuthenticationError);
});

test('a mismatched header is rejected', () => {
    const { calls, next } = capturedNext();
    requireTelegramWebhookSecret(request({ configured: 'shh', provided: 'nope' }), {}, next);
    assert.ok(calls[0] instanceof AuthenticationError);
});

test('a header of a different length than the configured secret is rejected without throwing', () => {
    const { calls, next } = capturedNext();
    requireTelegramWebhookSecret(request({ configured: 'shh', provided: 'much-longer-value' }), {}, next);
    assert.ok(calls[0] instanceof AuthenticationError);
});

test('an unconfigured secret rejects every request rather than passing everything through', () => {
    const { calls, next } = capturedNext();
    requireTelegramWebhookSecret(request({ configured: undefined, provided: 'anything' }), {}, next);
    assert.ok(calls[0] instanceof AuthenticationError);
});
