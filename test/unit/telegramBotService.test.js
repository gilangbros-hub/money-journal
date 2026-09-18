'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleUpdate } = require('../../services/telegramBotService');

function fakeTelegram() {
    const sent = [];
    const edited = [];
    const answered = [];
    return {
        sent, edited, answered,
        async sendMessage(chatId, text, opts) { sent.push({ chatId, text, opts }); return { message_id: sent.length }; },
        async editMessageText(chatId, messageId, text, opts) { edited.push({ chatId, messageId, text, opts }); },
        async answerCallbackQuery(id, opts) { answered.push({ id, opts }); }
    };
}

function fakeStateModel() {
    const records = new Map();
    return {
        records,
        async findOne({ chatId }) { return records.get(chatId) || null; },
        async findOneAndUpdate({ chatId }, doc) {
            records.set(chatId, { ...doc });
            return records.get(chatId);
        },
        async deleteOne({ chatId }) { records.delete(chatId); }
    };
}

const linkedActor = { userId: 'user-1', username: 'wife', role: 'Wife' };

const ACTIVE_TYPES = [
    { id: 'type-eat', name: 'Eat', emoji: '🍽️', status: 'Active' },
    { id: 'type-snack', name: 'Snack', emoji: '🍿', status: 'Active' }
];

const ACTIVE_POCKETS = [
    { pocketId: 'pocket-groceries', name: 'Groceries', emoji: '🛒', cadence: 'Monthly' }
];

function baseOptions(overrides = {}) {
    const createExpenseCalls = [];
    return {
        stateModel: fakeStateModel(),
        findLinkedUser: async () => linkedActor,
        listExpenseTypeDefinitions: async () => ({ active: ACTIVE_TYPES }),
        listExpensePocketOptions: async () => ACTIVE_POCKETS,
        createExpense: async (command) => { createExpenseCalls.push(command); return { _id: 'txn-1' }; },
        completeLink: async () => ({ username: 'wife', role: 'Wife' }),
        timeZone: 'Asia/Jakarta',
        pocketManagementEnabled: true,
        expenseTypeManagementEnabled: true,
        _createExpenseCalls: createExpenseCalls,
        ...overrides
    };
}

function textMessage(chatId, text) {
    return { message: { chat: { id: chatId }, text } };
}

function callback(chatId, messageId, data) {
    return { callback_query: { id: 'cbq-1', message: { chat: { id: chatId }, message_id: messageId }, data } };
}

test('an unlinked chat is told how to link when it tries to /log', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions({ findLinkedUser: async () => null });

    await handleUpdate(textMessage('c1', '/log'), telegram, options);

    assert.match(telegram.sent[0].text, /link/i);
    assert.equal(options.stateModel.records.size, 0);
});

test('/log starts the flow by asking for an amount', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();

    await handleUpdate(textMessage('c1', '/log'), telegram, options);

    assert.match(telegram.sent[0].text, /how much/i);
    assert.equal(options.stateModel.records.get('c1').step, 'amount');
});

test('a non-numeric amount is rejected and the step does not advance', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();
    await handleUpdate(textMessage('c1', '/log'), telegram, options);

    await handleUpdate(textMessage('c1', 'lots'), telegram, options);

    assert.match(telegram.sent[1].text, /doesn't look like an amount/i);
    assert.equal(options.stateModel.records.get('c1').step, 'amount');
});

test('a valid amount advances to the type step with a button per active type', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();
    await handleUpdate(textMessage('c1', '/log'), telegram, options);

    await handleUpdate(textMessage('c1', '25000'), telegram, options);

    const state = options.stateModel.records.get('c1');
    assert.equal(state.step, 'type');
    assert.equal(state.draft.amount, 25000);
    const buttons = telegram.sent[1].opts.replyMarkup.inline_keyboard.flat();
    assert.deepEqual(buttons.map((b) => b.callback_data), ['t:type-eat', 't:type-snack']);
});

test('amount accepts thousands separators like 25.000 or 25,000', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();
    await handleUpdate(textMessage('c1', '/log'), telegram, options);

    await handleUpdate(textMessage('c1', '25.000'), telegram, options);

    assert.equal(options.stateModel.records.get('c1').draft.amount, 25000);
});

test('the full flow: amount -> type button -> pocket button -> skip note -> confirm', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();
    await handleUpdate(textMessage('c1', '/log'), telegram, options);
    await handleUpdate(textMessage('c1', '25000'), telegram, options);

    await handleUpdate(callback('c1', 2, 't:type-eat'), telegram, options);
    let state = options.stateModel.records.get('c1');
    assert.equal(state.step, 'pocket');
    assert.equal(state.draft.typeName, 'Eat');
    assert.deepEqual(telegram.edited.at(-1).opts.replyMarkup.inline_keyboard[0].map((b) => b.callback_data), ['p:pocket-groceries']);

    await handleUpdate(callback('c1', 2, 'p:pocket-groceries'), telegram, options);
    state = options.stateModel.records.get('c1');
    assert.equal(state.step, 'note');
    assert.equal(state.draft.pocketName, 'Groceries');
    assert.deepEqual(telegram.edited.at(-1).opts.replyMarkup.inline_keyboard[0][0].callback_data, 'note:skip');

    await handleUpdate(callback('c1', 2, 'note:skip'), telegram, options);
    state = options.stateModel.records.get('c1');
    assert.equal(state.step, 'confirm');
    assert.equal(state.draft.note, 'Eat');
    assert.match(telegram.edited.at(-1).text, /Confirm this expense/);

    await handleUpdate(callback('c1', 2, 'confirm:yes'), telegram, options);
    assert.equal(options._createExpenseCalls.length, 1);
    assert.equal(options._createExpenseCalls[0].amount, 25000);
    assert.equal(options._createExpenseCalls[0].type, 'Eat');
    assert.equal(options._createExpenseCalls[0].pocketId, 'pocket-groceries');
    assert.match(telegram.edited.at(-1).text, /Saved/);
    assert.equal(options.stateModel.records.has('c1'), false);
});

test('typing a note instead of skipping carries it through to the summary and the save', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();
    await handleUpdate(textMessage('c1', '/log'), telegram, options);
    await handleUpdate(textMessage('c1', '25000'), telegram, options);
    await handleUpdate(callback('c1', 2, 't:type-eat'), telegram, options);
    await handleUpdate(callback('c1', 2, 'p:pocket-groceries'), telegram, options);

    await handleUpdate(textMessage('c1', 'weekend market run'), telegram, options);

    const state = options.stateModel.records.get('c1');
    assert.equal(state.step, 'confirm');
    assert.equal(state.draft.note, 'weekend market run');

    await handleUpdate(callback('c1', 2, 'confirm:yes'), telegram, options);
    assert.equal(options._createExpenseCalls[0].ngapain, 'weekend market run');
});

test('confirm:no cancels and clears state without saving anything', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();
    await handleUpdate(textMessage('c1', '/log'), telegram, options);
    await handleUpdate(textMessage('c1', '25000'), telegram, options);
    await handleUpdate(callback('c1', 2, 't:type-eat'), telegram, options);
    await handleUpdate(callback('c1', 2, 'p:pocket-groceries'), telegram, options);
    await handleUpdate(callback('c1', 2, 'note:skip'), telegram, options);

    await handleUpdate(callback('c1', 2, 'confirm:no'), telegram, options);

    assert.equal(options._createExpenseCalls.length, 0);
    assert.equal(options.stateModel.records.has('c1'), false);
    assert.match(telegram.edited.at(-1).text, /Cancelled/);
});

test('/cancel mid-flow clears state', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();
    await handleUpdate(textMessage('c1', '/log'), telegram, options);

    await handleUpdate(textMessage('c1', '/cancel'), telegram, options);

    assert.equal(options.stateModel.records.has('c1'), false);
    assert.match(telegram.sent.at(-1).text, /Cancelled/);
});

test('a stale button tap (wrong step) is answered without changing state', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();
    await handleUpdate(textMessage('c1', '/log'), telegram, options);

    // Still on the "amount" step; a leftover type button from a previous
    // flow should not be actionable.
    await handleUpdate(callback('c1', 2, 't:type-eat'), telegram, options);

    assert.equal(options.stateModel.records.get('c1').step, 'amount');
    assert.match(telegram.answered.at(-1).opts.text, /already passed/i);
});

test('a callback with no conversation state at all is told to start over', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions();

    await handleUpdate(callback('c1', 2, 'confirm:yes'), telegram, options);

    assert.equal(options._createExpenseCalls.length, 0);
    assert.match(telegram.answered[0].opts.text, /expired/i);
});

test('random text with no active conversation gets a hint appropriate to link status', async () => {
    const telegram = fakeTelegram();
    const linked = baseOptions();
    await handleUpdate(textMessage('c1', 'hello'), telegram, linked);
    assert.match(telegram.sent[0].text, /\/log/);

    const unlinkedTelegram = fakeTelegram();
    const unlinked = baseOptions({ findLinkedUser: async () => null });
    await handleUpdate(textMessage('c2', 'hello'), unlinkedTelegram, unlinked);
    assert.match(unlinkedTelegram.sent[0].text, /link/i);
});

test('a save failure reports the error and still clears the conversation', async () => {
    const telegram = fakeTelegram();
    const options = baseOptions({
        createExpense: async () => { throw new Error('Budget Month is closed.'); }
    });
    await handleUpdate(textMessage('c1', '/log'), telegram, options);
    await handleUpdate(textMessage('c1', '25000'), telegram, options);
    await handleUpdate(callback('c1', 2, 't:type-eat'), telegram, options);
    await handleUpdate(callback('c1', 2, 'p:pocket-groceries'), telegram, options);
    await handleUpdate(callback('c1', 2, 'note:skip'), telegram, options);

    await handleUpdate(callback('c1', 2, 'confirm:yes'), telegram, options);

    assert.match(telegram.edited.at(-1).text, /Couldn't save.*Budget Month is closed/);
    assert.equal(options.stateModel.records.has('c1'), false);
});

test('/link forwards the code to completeLink and reports success', async () => {
    const telegram = fakeTelegram();
    const calls = [];
    const options = baseOptions({
        completeLink: async (code, chatId) => { calls.push({ code, chatId }); return { username: 'wife', role: 'Wife' }; }
    });

    await handleUpdate(textMessage('c1', '/link 123456'), telegram, options);

    assert.deepEqual(calls[0], { code: '123456', chatId: 'c1' });
    assert.match(telegram.sent[0].text, /Linked/);
});
