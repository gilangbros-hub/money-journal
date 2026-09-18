'use strict';

const telegramLinkService = require('../services/telegramLinkService');
const telegramBotService = require('../services/telegramBotService');
const { createTelegramApiClient } = require('../services/telegramApiClient');

function actorFromRequest(req) {
    return { userId: req.session?.userId };
}

function botOptions(req) {
    const configuration = req.app?.locals?.configuration || {};
    return {
        timeZone: configuration.householdTimeZone,
        salaryCycleBudgetingEnabled: configuration.salaryCycleBudgetingEnabled,
        pocketManagementEnabled: configuration.pocketManagementEnabled,
        expenseTypeManagementEnabled: configuration.expenseTypeManagementEnabled
    };
}

function createTelegramController({
    linkService = telegramLinkService,
    botService = telegramBotService,
    apiClientFactory = createTelegramApiClient
} = {}) {
    return {
        // Profile page: generate/refresh a pairing code for the logged-in user.
        async createLinkCode(req, res) {
            const result = await linkService.createLinkCode(actorFromRequest(req));
            res.json({ success: true, data: result });
        },

        // Profile page: remove this account's Telegram link.
        async unlink(req, res) {
            await linkService.removeLink(actorFromRequest(req));
            res.json({ success: true });
        },

        // Telegram calls this directly — no session, no CSRF token, just the
        // shared secret header Telegram itself attaches (checked by the
        // requireTelegramWebhookSecret middleware before this ever runs).
        async webhook(req, res) {
            const configuration = req.app?.locals?.configuration || {};
            // Always 200 immediately: Telegram retries (with backoff, then
            // gives up and may disable the webhook) on anything else, and a
            // slow/failed side effect here must never turn into a redelivery
            // storm for what was already a best-effort chat reply.
            res.status(200).json({ ok: true });
            if (!configuration.telegramBotEnabled || !configuration.telegramBotToken) return;

            try {
                const telegram = apiClientFactory({ token: configuration.telegramBotToken });
                await botService.handleUpdate(req.body || {}, telegram, botOptions(req));
            } catch (error) {
                console.error('Telegram webhook handling error:', error);
            }
        }
    };
}

const handlers = createTelegramController();

module.exports = {
    ...handlers,
    createTelegramController
};
