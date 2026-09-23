'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../../models/user');
const authController = require('../../controllers/authController');

test('a successful login goes straight to Monthly Story, not the welcome splash', async (t) => {
    const user = {
        _id: 'user-1',
        username: 'alice',
        avatar: '🧑',
        role: 'Self',
        isActive: true,
        comparePassword: async () => true
    };
    t.mock.method(User, 'findOne', async () => user);

    const req = { body: { username: 'alice', password: 'secret-pass' }, session: {} };
    let redirectedTo = null;
    const res = { redirect(url) { redirectedTo = url; } };
    await authController.postLogin(req, res);

    assert.equal(redirectedTo, '/monthly-story');
    assert.equal(req.session.username, 'alice');
});
