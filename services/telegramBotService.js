'use strict';

const { Temporal } = require('@js-temporal/polyfill');

const TelegramConversationState = require('../models/telegramConversationState');
const transactionService = require('./transactionService');
const expenseTypeManagementService = require('./expenseTypeManagementService');
const pocketManagementService = require('./pocketManagementService');
const telegramLinkService = require('./telegramLinkService');
const { formatCurrency } = require('../utils/formatters');
const { DEFAULT_HOUSEHOLD_TIME_ZONE } = require('./salaryCycleResolver');

/**
 * Telegram bot conversation engine.
 *
 * The bot mirrors Log Spending's own input model: anything that comes from a
 * fixed list (Type, Pocket) is a button, never typed; anything that can't be
 * (Amount, an optional Note) is a plain text reply. Each step's state lives
 * in TelegramConversationState — a Vercel function has no memory between
 * requests, so "what step is this chat on" has to be read back from Mongo on
 * every single update, not held in a variable.
 *
 * State updates always read the current document, mutate a plain JS copy of
 * it, then write the whole `{ step, draft, promptMessageId }` shape back
 * (rather than Mongo dot-path `$set`s) — a fake model in a test only needs
 * to support `findOne`/`findOneAndUpdate` with a full replacement, not
 * dot-path semantics.
 *
 * Every service call is injected through `options` the same way the rest of
 * this codebase does it, so a test can supply fakes without touching the
 * real database or the network.
 */

const NOT_LINKED_MESSAGE = "You're not linked yet. Open the app, go to your Profile page, and tap \"Link Telegram\" to get a pairing code, then send it here as /link 123456.";
const MAX_NOTE_LENGTH = 200;

function option(options, name, fallback) {
    return options?.[name] ?? fallback;
}

function services(options) {
    return {
        listExpenseTypeDefinitions: option(options, 'listExpenseTypeDefinitions', expenseTypeManagementService.listExpenseTypeDefinitions),
        listExpensePocketOptions: option(options, 'listExpensePocketOptions', pocketManagementService.listExpensePocketOptions),
        createExpense: option(options, 'createExpense', transactionService.createExpense),
        findLinkedUser: option(options, 'findLinkedUser', telegramLinkService.findLinkedUser),
        completeLink: option(options, 'completeLink', telegramLinkService.completeLink)
    };
}

function stateModel(options) {
    return option(options, 'stateModel', TelegramConversationState);
}

async function getState(chatId, options) {
    return stateModel(options).findOne({ chatId });
}

async function putState(chatId, { step, draft, promptMessageId }, options) {
    return stateModel(options).findOneAndUpdate(
        { chatId },
        { chatId, step, draft, promptMessageId, updatedAt: new Date() },
        { upsert: true }
    );
}

async function clearState(chatId, options) {
    return stateModel(options).deleteOne({ chatId });
}

function actorOptions(options) {
    // The household-wide config every service call needs (timeZone, and the
    // rollout flags that decide managed vs legacy behavior). One place to
    // build it so every call site here stays consistent.
    return {
        timeZone: option(options, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE),
        salaryCycleBudgetingEnabled: option(options, 'salaryCycleBudgetingEnabled', false),
        pocketManagementEnabled: option(options, 'pocketManagementEnabled', false),
        expenseTypeManagementEnabled: option(options, 'expenseTypeManagementEnabled', false),
        connection: options?.connection,
        transactionModel: options?.transactionModel,
        guardModel: options?.guardModel,
        assignmentModel: options?.assignmentModel,
        definitionModel: options?.definitionModel,
        expenseTypeDefinitionModel: options?.expenseTypeDefinitionModel,
        userModel: options?.userModel
    };
}

function todayInTimeZone(timeZone) {
    return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate().toString();
}

function formatDateLabel(value) {
    const [year, month, day] = value.split('-').map(Number);
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(day).padStart(2, '0')} ${names[month - 1]} ${year}`;
}

// -----------------------------------------------------------------------
// Keyboards
// -----------------------------------------------------------------------

function chunkPairs(items) {
    const rows = [];
    for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
    return rows;
}

function typeKeyboard(types) {
    return { inline_keyboard: chunkPairs(types.map((t) => ({ text: `${t.emoji} ${t.name}`, callback_data: `t:${t.id}` }))) };
}

function pocketKeyboard(pockets) {
    return { inline_keyboard: chunkPairs(pockets.map((p) => ({ text: `${p.emoji} ${p.name}`, callback_data: `p:${p.pocketId}` }))) };
}

function noteKeyboard() {
    return { inline_keyboard: [[{ text: 'Skip', callback_data: 'note:skip' }]] };
}

function confirmKeyboard() {
    return { inline_keyboard: [[{ text: '✅ Confirm', callback_data: 'confirm:yes' }, { text: '❌ Cancel', callback_data: 'confirm:no' }]] };
}

function summaryText(draft) {
    return [
        '📋 Confirm this expense:',
        `💰 Amount: ${formatCurrency(draft.amount)}`,
        `🏷️ Type: ${draft.typeName}`,
        `👛 Pocket: ${draft.pocketName}`,
        `📝 Note: ${draft.note}`,
        `📅 Date: ${formatDateLabel(draft.expenseDate)} (today)`
    ].join('\n');
}

// -----------------------------------------------------------------------
// Flow steps
// -----------------------------------------------------------------------

async function startLogFlow(chatId, telegram, options) {
    const svc = services(options);
    const actor = await svc.findLinkedUser(chatId, actorOptions(options));
    if (!actor) {
        await telegram.sendMessage(chatId, NOT_LINKED_MESSAGE);
        return;
    }

    const expenseDate = todayInTimeZone(option(options, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE));
    await putState(chatId, { step: 'amount', draft: { expenseDate } }, options);
    await telegram.sendMessage(chatId, 'How much did you spend? Just the number, e.g. 25000.');
}

async function advanceFromAmount(chatId, text, telegram, options) {
    const raw = text.replace(/[.,\s]/g, '');
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
        await telegram.sendMessage(chatId, "That doesn't look like an amount. Send just the number, e.g. 25000.");
        return;
    }
    const amount = Number(raw);
    const svc = services(options);
    const actor = await svc.findLinkedUser(chatId, actorOptions(options));
    const { active } = await svc.listExpenseTypeDefinitions({}, actor, actorOptions(options));
    if (!active.length) {
        await telegram.sendMessage(chatId, 'No expense types are set up yet. Add one on the Expense Type Management page first.');
        await clearState(chatId, options);
        return;
    }

    const state = await getState(chatId, options);
    await putState(chatId, { step: 'type', draft: { ...state.draft, amount } }, options);
    await telegram.sendMessage(chatId, `Rp ${amount.toLocaleString('id-ID')} — what type of expense?`, {
        replyMarkup: typeKeyboard(active)
    });
}

async function advanceFromType(chatId, messageId, typeId, telegram, options) {
    const svc = services(options);
    const actor = await svc.findLinkedUser(chatId, actorOptions(options));
    const { active } = await svc.listExpenseTypeDefinitions({}, actor, actorOptions(options));
    const type = active.find((t) => t.id === typeId);
    if (!type) {
        await telegram.editMessageText(chatId, messageId, 'That type is no longer available. Send /log to start again.');
        await clearState(chatId, options);
        return;
    }

    const state = await getState(chatId, options);
    const pockets = await svc.listExpensePocketOptions({ expenseDate: state.draft.expenseDate }, actor, actorOptions(options));
    if (!pockets.length) {
        await telegram.editMessageText(chatId, messageId, 'No pockets are assigned for this Budget Month yet. Set one up on the Pocket Management page first.');
        await clearState(chatId, options);
        return;
    }

    await putState(chatId, {
        step: 'pocket',
        draft: { ...state.draft, typeId: type.id, typeName: type.name },
        promptMessageId: messageId
    }, options);
    await telegram.editMessageText(chatId, messageId, `${type.emoji} ${type.name} — which pocket?`, {
        replyMarkup: pocketKeyboard(pockets)
    });
}

async function advanceFromPocket(chatId, messageId, pocketId, telegram, options) {
    const svc = services(options);
    const actor = await svc.findLinkedUser(chatId, actorOptions(options));
    const state = await getState(chatId, options);
    const pockets = await svc.listExpensePocketOptions({ expenseDate: state.draft.expenseDate }, actor, actorOptions(options));
    const pocket = pockets.find((p) => p.pocketId === pocketId);
    if (!pocket) {
        await telegram.editMessageText(chatId, messageId, 'That pocket is no longer available. Send /log to start again.');
        await clearState(chatId, options);
        return;
    }

    await putState(chatId, {
        step: 'note',
        draft: { ...state.draft, pocketId: pocket.pocketId, pocketName: pocket.name },
        promptMessageId: messageId
    }, options);
    await telegram.editMessageText(chatId, messageId, `${pocket.emoji} ${pocket.name} — add a note, or skip.`, {
        replyMarkup: noteKeyboard()
    });
}

async function moveToConfirm(chatId, note, telegram, options, { editMessageId } = {}) {
    const state = await getState(chatId, options);
    const draft = { ...state.draft, note };
    await putState(chatId, { step: 'confirm', draft }, options);
    const text = summaryText(draft);
    if (editMessageId) {
        await telegram.editMessageText(chatId, editMessageId, text, { replyMarkup: confirmKeyboard() });
    } else {
        await telegram.sendMessage(chatId, text, { replyMarkup: confirmKeyboard() });
    }
}

async function advanceFromNoteText(chatId, text, telegram, options) {
    const note = text.trim().slice(0, MAX_NOTE_LENGTH);
    await moveToConfirm(chatId, note || '(no note)', telegram, options);
}

async function skipNote(chatId, messageId, telegram, options) {
    const state = await getState(chatId, options);
    await moveToConfirm(chatId, state.draft.typeName, telegram, options, { editMessageId: messageId });
}

async function confirmExpense(chatId, messageId, telegram, options) {
    const svc = services(options);
    const actor = await svc.findLinkedUser(chatId, actorOptions(options));
    const state = await getState(chatId, options);
    const { draft } = state;

    try {
        await svc.createExpense({
            expenseDate: draft.expenseDate,
            date: draft.expenseDate,
            type: draft.typeName,
            ngapain: draft.note,
            amount: draft.amount,
            paidBy: 'Self',
            sourceType: 'single',
            pocket: draft.pocketName,
            pocketId: draft.pocketId,
            sourceBreakdowns: []
        }, actor, actorOptions(options));

        await telegram.editMessageText(chatId, messageId, `Saved ✅ ${formatCurrency(draft.amount)} for ${draft.typeName} (${draft.pocketName}).`);
    } catch (error) {
        await telegram.editMessageText(chatId, messageId, `Couldn't save that: ${error.message || 'unknown error'}. Send /log to try again.`);
    } finally {
        await clearState(chatId, options);
    }
}

async function cancelFromConfirm(chatId, messageId, telegram, options) {
    await clearState(chatId, options);
    await telegram.editMessageText(chatId, messageId, 'Cancelled.');
}

// -----------------------------------------------------------------------
// Update routing
// -----------------------------------------------------------------------

async function handleLinkCommand(chatId, text, telegram, options) {
    const code = text.replace(/^\/link/i, '').trim();
    try {
        const linked = await services(options).completeLink(code, chatId, actorOptions(options));
        await telegram.sendMessage(chatId, `Linked ✅ You're set up as ${linked.username} (${linked.role}). Send /log any time to log an expense.`);
    } catch (error) {
        await telegram.sendMessage(chatId, error.message || "That code didn't work. Generate a new one from your profile page.");
    }
}

async function handleMessage(message, telegram, options) {
    const chatId = String(message.chat.id);
    const text = (message.text || '').trim();

    if (/^\/start\b/i.test(text)) {
        await telegram.sendMessage(chatId, 'Welcome! Link your account from the app\'s Profile page, then send /log to log an expense.');
        return;
    }
    if (/^\/link\b/i.test(text)) {
        await handleLinkCommand(chatId, text, telegram, options);
        return;
    }
    if (/^\/cancel\b/i.test(text)) {
        await clearState(chatId, options);
        await telegram.sendMessage(chatId, 'Cancelled.');
        return;
    }
    if (/^\/log\b/i.test(text)) {
        await startLogFlow(chatId, telegram, options);
        return;
    }

    const state = await getState(chatId, options);
    if (!state) {
        const actor = await services(options).findLinkedUser(chatId, actorOptions(options));
        await telegram.sendMessage(chatId, actor ? 'Send /log to log an expense.' : NOT_LINKED_MESSAGE);
        return;
    }

    if (state.step === 'amount') {
        await advanceFromAmount(chatId, text, telegram, options);
        return;
    }
    if (state.step === 'note') {
        await advanceFromNoteText(chatId, text, telegram, options);
        return;
    }
    await telegram.sendMessage(chatId, 'Please use the buttons above, or send /cancel to start over.');
}

async function handleCallbackQuery(callbackQuery, telegram, options) {
    const chatId = String(callbackQuery.message.chat.id);
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data || '';
    const state = await getState(chatId, options);

    async function stale(text) {
        await telegram.answerCallbackQuery(callbackQuery.id, { text: text || 'This step has already passed.' });
    }

    try {
        if (!state) return await stale('This has expired. Send /log to start again.');

        if (data.startsWith('t:') && state.step === 'type') {
            await advanceFromType(chatId, messageId, data.slice(2), telegram, options);
        } else if (data.startsWith('p:') && state.step === 'pocket') {
            await advanceFromPocket(chatId, messageId, data.slice(2), telegram, options);
        } else if (data === 'note:skip' && state.step === 'note') {
            await skipNote(chatId, messageId, telegram, options);
        } else if (data === 'confirm:yes' && state.step === 'confirm') {
            await confirmExpense(chatId, messageId, telegram, options);
        } else if (data === 'confirm:no' && state.step === 'confirm') {
            await cancelFromConfirm(chatId, messageId, telegram, options);
        } else {
            return await stale();
        }
        await telegram.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        await stale(error.message || 'Something went wrong.');
    }
}

async function handleUpdate(update, telegram, options = {}) {
    if (update.callback_query) return handleCallbackQuery(update.callback_query, telegram, options);
    if (update.message) return handleMessage(update.message, telegram, options);
}

module.exports = {
    handleUpdate,
    NOT_LINKED_MESSAGE,
    __test__: {
        todayInTimeZone,
        formatDateLabel,
        summaryText,
        typeKeyboard,
        pocketKeyboard
    }
};
