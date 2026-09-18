'use strict';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * A thin wrapper over the Telegram Bot API's HTTP methods. No SDK dependency:
 * every method is one JSON POST. Kept separate from telegramBotService so
 * tests can inject a fake client and assert on the calls it *would* have
 * made without any network access.
 */
function createTelegramApiClient({ token, fetchImpl = fetch } = {}) {
    if (!token) {
        throw new Error('createTelegramApiClient requires a bot token.');
    }

    async function call(method, payload) {
        const response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body || body.ok !== true) {
            const description = body?.description || `Telegram API call to ${method} failed`;
            throw new Error(description);
        }
        return body.result;
    }

    return {
        sendMessage(chatId, text, { replyMarkup, parseMode } = {}) {
            return call('sendMessage', {
                chat_id: chatId,
                text,
                reply_markup: replyMarkup,
                parse_mode: parseMode
            });
        },
        editMessageText(chatId, messageId, text, { replyMarkup, parseMode } = {}) {
            return call('editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text,
                reply_markup: replyMarkup,
                parse_mode: parseMode
            });
        },
        answerCallbackQuery(callbackQueryId, { text, showAlert } = {}) {
            return call('answerCallbackQuery', {
                callback_query_id: callbackQueryId,
                text,
                show_alert: showAlert === true
            });
        },
        setWebhook(url, { secretToken } = {}) {
            return call('setWebhook', { url, secret_token: secretToken });
        },
        deleteWebhook() {
            return call('deleteWebhook', {});
        }
    };
}

module.exports = { createTelegramApiClient, TELEGRAM_API_BASE };
