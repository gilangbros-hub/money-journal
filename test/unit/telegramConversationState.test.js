'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TelegramConversationState = require('../../models/telegramConversationState');

test('schema shape: unique chatId, step enum, and a 30-minute TTL on updatedAt', () => {
    const schema = TelegramConversationState.schema;
    assert.deepEqual(schema.path('step').enumValues, ['amount', 'type', 'pocket', 'note', 'confirm']);
    const chatIdIndex = schema.indexes().find(([fields]) => fields.chatId);
    assert.ok(chatIdIndex && chatIdIndex[1].unique);
    const ttlIndex = schema.indexes().find(([, options]) => Number.isInteger(options?.expireAfterSeconds));
    assert.equal(ttlIndex[1].expireAfterSeconds, 1800);
});

test('a well-formed document validates cleanly', () => {
    const doc = new TelegramConversationState({
        chatId: 'chat-1',
        step: 'amount',
        draft: { expenseDate: '2026-09-18' }
    });
    assert.equal(doc.validateSync(), undefined);
});

test('an unrecognized step is rejected', () => {
    const doc = new TelegramConversationState({ chatId: 'chat-1', step: 'bogus', draft: {} });
    assert.ok(doc.validateSync().errors.step);
});
