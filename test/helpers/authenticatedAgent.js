'use strict';

const supertest = require('supertest');

const DEFAULT_SESSION = Object.freeze({
    userId: '000000000000000000000001',
    username: 'test-user',
    avatar: '👤',
    role: 'Self'
});

function createTestSession(overrides = {}) {
    return Object.freeze({ ...DEFAULT_SESSION, ...overrides });
}

/**
 * Build a cookie-preserving Supertest agent. By default it authenticates via
 * the application's real API login route; no auth headers or session internals
 * are fabricated. Tests may provide a custom loginPath for another app.
 */
function createAuthenticatedAgent(app, {
    credentials,
    loginPath = '/api/auth/login',
    session = {},
    userId,
    username,
    role,
    password
} = {}) {
    const agent = supertest.agent(app);
    const testSession = createTestSession({
        ...session,
        ...(userId ? { userId } : {}),
        ...(username ? { username } : {}),
        ...(role ? { role } : {})
    });
    const loginCredentials = credentials || {
        username: username || testSession.username,
        password: password || 'test-password'
    };

    agent.testSession = testSession;
    agent.login = async (overrides = {}) => {
        const response = await agent
            .post(loginPath)
            .send({ ...loginCredentials, ...overrides });
        if (response.status >= 400) {
            throw new Error(`Authentication failed with status ${response.status}`);
        }
        return response;
    };
    agent.authenticate = agent.login;
    return agent;
}

const authenticatedAgent = createAuthenticatedAgent;

module.exports = {
    DEFAULT_SESSION,
    authenticatedAgent,
    createAuthenticatedAgent,
    createTestSession
};
