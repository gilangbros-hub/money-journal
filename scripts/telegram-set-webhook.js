#!/usr/bin/env node
'use strict';

/**
 * One-time (or one-per-deploy-URL) setup: registers this app's webhook URL
 * with Telegram so it starts delivering updates. Run locally or from a
 * shell with network access — this is not something the app calls itself.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *     node scripts/telegram-set-webhook.js https://your-app.vercel.app
 *
 * The secret must match the TELEGRAM_WEBHOOK_SECRET the deployed app itself
 * reads (see middleware/auth.js requireTelegramWebhookSecret) — pick any
 * long random string and set it as an env var in both places.
 */

const { createTelegramApiClient } = require('../services/telegramApiClient');

async function main() {
    const baseUrl = process.argv[2];
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
        console.error('Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-set-webhook.js https://your-app.example.com');
        process.exit(1);
    }
    if (!token) {
        console.error('TELEGRAM_BOT_TOKEN is required.');
        process.exit(1);
    }
    if (!secret || secret.length < 16) {
        console.error('TELEGRAM_WEBHOOK_SECRET is required and should be a long random string (16+ characters).');
        process.exit(1);
    }

    const client = createTelegramApiClient({ token });
    const url = `${baseUrl.replace(/\/$/, '')}/api/telegram/webhook`;
    await client.setWebhook(url, { secretToken: secret });
    console.log(`Webhook registered: ${url}`);
    console.log('Make sure TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and TELEGRAM_BOT_ENABLED=true are all set on the deployed app itself.');
}

main().catch((error) => {
    console.error('Failed to set webhook:', error.message || error);
    process.exit(1);
});
