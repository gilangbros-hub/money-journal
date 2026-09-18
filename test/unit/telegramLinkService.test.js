'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
    createLinkCode,
    completeLink,
    findLinkedUser,
    removeLink
} = require('../../services/telegramLinkService');
const { AuthenticationError, DomainValidationError } = require('../../utils/domainErrors');

function makeUser(overrides = {}) {
    return {
        _id: new mongoose.Types.ObjectId(),
        username: 'wife',
        role: 'Wife',
        telegramChatId: undefined,
        telegramLinkCode: undefined,
        telegramLinkCodeExpiresAt: undefined,
        async save() { return this; },
        ...overrides
    };
}

function createFakeUserModel(seed = []) {
    const records = new Map(seed.map((u) => [u._id.toString(), u]));
    return {
        records,
        async findByIdAndUpdate(id, patch) {
            const user = records.get(String(id));
            if (!user) return null;
            if (patch.$unset) {
                Object.keys(patch.$unset).forEach((key) => { user[key] = undefined; });
            }
            const { $unset, ...rest } = patch;
            Object.assign(user, rest);
            return user;
        },
        async findOne(filter) {
            for (const user of records.values()) {
                if (filter.telegramLinkCode && user.telegramLinkCode === filter.telegramLinkCode) return user;
                if (filter.telegramChatId && user.telegramChatId === filter.telegramChatId) return user;
            }
            return null;
        }
    };
}

test('createLinkCode requires an authenticated actor', async () => {
    const userModel = createFakeUserModel();
    await assert.rejects(() => createLinkCode({}, { userModel }), AuthenticationError);
});

test('createLinkCode generates a 6-digit code with a ~10 minute expiry', async () => {
    const user = makeUser();
    const userModel = createFakeUserModel([user]);
    const before = Date.now();

    const result = await createLinkCode({ userId: user._id.toString() }, { userModel });

    assert.match(result.code, /^\d{6}$/);
    assert.equal(user.telegramLinkCode, result.code);
    const expiresIn = new Date(result.expiresAt).getTime() - before;
    assert.ok(expiresIn > 9 * 60 * 1000 && expiresIn <= 10 * 60 * 1000 + 1000);
});

test('completeLink rejects a malformed, unknown, or expired code', async () => {
    const expired = makeUser({ telegramLinkCode: '111111', telegramLinkCodeExpiresAt: new Date(Date.now() - 1000) });
    const userModel = createFakeUserModel([expired]);

    await assert.rejects(() => completeLink('abc', 'chat-1', { userModel }), DomainValidationError);
    await assert.rejects(() => completeLink('999999', 'chat-1', { userModel }), DomainValidationError);
    await assert.rejects(() => completeLink('111111', 'chat-1', { userModel }), DomainValidationError);
});

test('completeLink attaches the chat id and clears the code on success', async () => {
    const user = makeUser({ telegramLinkCode: '222222', telegramLinkCodeExpiresAt: new Date(Date.now() + 60000) });
    const userModel = createFakeUserModel([user]);

    const result = await completeLink('222222', 'chat-42', { userModel });

    assert.equal(result.username, 'wife');
    assert.equal(result.role, 'Wife');
    assert.equal(user.telegramChatId, 'chat-42');
    assert.equal(user.telegramLinkCode, undefined);
    assert.equal(user.telegramLinkCodeExpiresAt, undefined);
});

test('findLinkedUser resolves a linked chat and returns null for an unlinked one', async () => {
    const user = makeUser({ telegramChatId: 'chat-7' });
    const userModel = createFakeUserModel([user]);

    const found = await findLinkedUser('chat-7', { userModel });
    assert.equal(found.username, 'wife');

    const missing = await findLinkedUser('chat-unknown', { userModel });
    assert.equal(missing, null);
});

test('removeLink requires an authenticated actor and unsets the chat id', async () => {
    const userModel = createFakeUserModel();
    await assert.rejects(() => removeLink({}, { userModel }), AuthenticationError);

    const user = makeUser({ telegramChatId: 'chat-9' });
    const linkedModel = createFakeUserModel([user]);
    await removeLink({ userId: user._id.toString() }, { userModel: linkedModel });
    assert.equal(user.telegramChatId, undefined);
});
