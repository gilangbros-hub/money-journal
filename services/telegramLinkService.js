'use strict';

const crypto = require('node:crypto');
const User = require('../models/user');
const { AuthenticationError, DomainValidationError, RecordNotFoundError } = require('../utils/domainErrors');

const LINK_CODE_TTL_MS = 10 * 60 * 1000;

function option(options, name, fallback) {
    return options?.[name] ?? fallback;
}

function generateLinkCode() {
    // 6 digits, zero-padded — easy to type into a phone keyboard, short-lived
    // enough that a 1-in-a-million guess window doesn't matter.
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * Generate (or replace) a short-lived pairing code for the authenticated
 * user, to be sent to the bot as `/link <code>`. Called from the Profile
 * page; requires an existing web session, not a Telegram identity.
 */
async function createLinkCode(actor, options = {}) {
    if (!actor?.userId) throw new AuthenticationError();
    const UserModel = option(options, 'userModel', User);

    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    const user = await UserModel.findByIdAndUpdate(
        actor.userId,
        { telegramLinkCode: code, telegramLinkCodeExpiresAt: expiresAt },
        { new: true }
    );
    if (!user) throw new RecordNotFoundError('user');

    return { code, expiresAt: expiresAt.toISOString() };
}

/**
 * Complete a pairing: a Telegram chat sent `/link <code>`. Matches the code
 * (must be unexpired), attaches this chat id to that user, and clears the
 * code so it cannot be reused. Returns the linked user's household identity.
 */
async function completeLink(code, chatId, options = {}) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        throw new DomainValidationError('code', 'code must be a 6-digit pairing code.');
    }
    const UserModel = option(options, 'userModel', User);

    const user = await UserModel.findOne({ telegramLinkCode: code });
    if (!user || !user.telegramLinkCodeExpiresAt || user.telegramLinkCodeExpiresAt.getTime() < Date.now()) {
        throw new DomainValidationError('code', 'That code is invalid or has expired. Generate a new one from your profile page.');
    }

    user.telegramChatId = String(chatId);
    user.telegramLinkCode = undefined;
    user.telegramLinkCodeExpiresAt = undefined;
    await user.save();

    return { userId: user._id.toString(), username: user.username, role: user.role || 'Self' };
}

/**
 * Resolve the household identity for an inbound Telegram chat. Returns null
 * (never throws) when the chat has not been linked — the bot's own reply is
 * "you're not linked yet", not a hard error.
 */
async function findLinkedUser(chatId, options = {}) {
    const UserModel = option(options, 'userModel', User);
    const user = await UserModel.findOne({ telegramChatId: String(chatId) });
    if (!user) return null;
    return { userId: user._id.toString(), username: user.username, role: user.role || 'Self' };
}

/**
 * Remove the link for the authenticated user (Profile page "Unlink" action).
 */
async function removeLink(actor, options = {}) {
    if (!actor?.userId) throw new AuthenticationError();
    const UserModel = option(options, 'userModel', User);
    await UserModel.findByIdAndUpdate(actor.userId, { $unset: { telegramChatId: '' } });
}

module.exports = {
    createLinkCode,
    completeLink,
    findLinkedUser,
    removeLink,
    LINK_CODE_TTL_MS
};
