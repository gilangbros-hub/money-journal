'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramApiClient } = require('../../services/telegramApiClient');

function fakeFetch(responses) {
    const calls = [];
    return {
        calls,
        async fetchImpl(url, init) {
            calls.push({ url, body: JSON.parse(init.body) });
            const response = responses.shift() || { ok: true, result: {} };
            return {
                ok: response.ok !== false,
                async json() { return { ok: response.ok !== false, result: response.result, description: response.description }; }
            };
        }
    };
}

test('createTelegramApiClient requires a token', () => {
    assert.throws(() => createTelegramApiClient({}), /token/);
});

test('sendMessage posts to the correct method with chat_id, text, and optional keyboard', async () => {
    const { calls, fetchImpl } = fakeFetch([{ ok: true, result: { message_id: 1 } }]);
    const client = createTelegramApiClient({ token: 'T', fetchImpl });

    const result = await client.sendMessage('chat-1', 'hello', { replyMarkup: { inline_keyboard: [[{ text: 'A', callback_data: 'a' }]] } });

    assert.equal(calls[0].url, 'https://api.telegram.org/botT/sendMessage');
    assert.equal(calls[0].body.chat_id, 'chat-1');
    assert.equal(calls[0].body.text, 'hello');
    assert.deepEqual(calls[0].body.reply_markup, { inline_keyboard: [[{ text: 'A', callback_data: 'a' }]] });
    assert.deepEqual(result, { message_id: 1 });
});

test('editMessageText and answerCallbackQuery hit their own methods', async () => {
    const { calls, fetchImpl } = fakeFetch([{ ok: true }, { ok: true }]);
    const client = createTelegramApiClient({ token: 'T', fetchImpl });

    await client.editMessageText('chat-1', 42, 'updated');
    await client.answerCallbackQuery('cbq-1', { text: 'done' });

    assert.equal(calls[0].url, 'https://api.telegram.org/botT/editMessageText');
    assert.equal(calls[0].body.message_id, 42);
    assert.equal(calls[1].url, 'https://api.telegram.org/botT/answerCallbackQuery');
    assert.equal(calls[1].body.callback_query_id, 'cbq-1');
});

test('a non-ok Telegram response throws with its description', async () => {
    const { fetchImpl } = fakeFetch([{ ok: false, description: 'chat not found' }]);
    const client = createTelegramApiClient({ token: 'T', fetchImpl });

    await assert.rejects(() => client.sendMessage('chat-1', 'hi'), /chat not found/);
});

test('setWebhook posts the url and secret token', async () => {
    const { calls, fetchImpl } = fakeFetch([{ ok: true, result: true }]);
    const client = createTelegramApiClient({ token: 'T', fetchImpl });

    await client.setWebhook('https://example.com/hook', { secretToken: 'shh' });

    assert.equal(calls[0].url, 'https://api.telegram.org/botT/setWebhook');
    assert.equal(calls[0].body.url, 'https://example.com/hook');
    assert.equal(calls[0].body.secret_token, 'shh');
});
