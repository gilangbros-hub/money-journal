'use strict';

const express = require('express');
const telegramController = require('../controllers/telegramController');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuthenticated, requireTelegramWebhookSecret } = require('../middleware/auth');

/**
 * Two very different trust boundaries share this router:
 *  - /api/telegram/link-code and /unlink are the Profile page's own calls —
 *    an ordinary authenticated session, like every other /api route.
 *  - /api/telegram/webhook is Telegram's own server calling us, with no
 *    cookie at all; it is instead gated on the shared secret header set up
 *    via setWebhook (see scripts/telegram-set-webhook.js).
 */
function createTelegramRoutes({ controller = telegramController } = {}) {
    const router = express.Router();

    router.post('/api/telegram/link-code', requireAuthenticated, asyncHandler(controller.createLinkCode));
    router.post('/api/telegram/unlink', requireAuthenticated, asyncHandler(controller.unlink));

    router.post('/api/telegram/webhook', requireTelegramWebhookSecret, asyncHandler(controller.webhook));

    return router;
}

const router = createTelegramRoutes();
router.createTelegramRoutes = createTelegramRoutes;

module.exports = router;
