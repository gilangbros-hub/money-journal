'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Temporal } = require('@js-temporal/polyfill');
const {
    createInjectedClock,
    createTimeZoneContext,
    createFeatureFlags,
    createFeatureFlagController,
    createNotificationQueue,
    withDatabaseSession,
    createIsolatedDatabase,
    createAuthenticatedAgent,
    createTestSession,
    PROPERTY_NUM_RUNS,
    propertyOptions
} = require('./helpers');
const {
    calendarDateArbitrary,
    budgetMonthArbitrary,
    realIsoWeekArbitrary,
    safeIntegerRupiahArbitrary,
    uniquePocketSharesArbitrary,
    mixedCadenceStateArbitrary,
    legacyRecordArbitrary,
    correlatedConcurrentWritesArbitrary
} = require('./arbitraries');
const fc = require('fast-check');

test('injected clock and time-zone context remain deterministic', () => {
    const clock = createInjectedClock({
        nowInstant: '2027-01-24T17:00:00Z',
        timeZone: 'Asia/Jakarta'
    });

    assert.equal(clock.nowInstant().toString(), '2027-01-24T17:00:00Z');
    assert.equal(clock.localDate().toString(), '2027-01-25');
    assert.equal(clock.localDate('UTC').toString(), '2027-01-24');
    assert.equal(createTimeZoneContext().toPlainDate(clock.nowInstant()).toString(), '2027-01-25');
    clock.advance({ hours: 1 });
    assert.equal(clock.localDate().toString(), '2027-01-25');
});

test('feature flags and notification queue are isolated mutable test dependencies', async () => {
    const flags = createFeatureFlags({ salaryCycleBudgeting: true });
    assert.equal(flags.isEnabled('salaryCycleBudgeting'), true);
    assert.equal(createFeatureFlags().isEnabled('salaryCycleBudgeting'), false);

    const controller = createFeatureFlagController();
    controller.set('salaryCycleBudgeting', true);
    assert.equal(controller.get('salaryCycleBudgeting'), true);
    assert.equal(controller.snapshot().salaryCycleBudgeting, true);

    const notifications = createNotificationQueue();
    await notifications.enqueue({ type: 'expense-created', id: 'tx-1' });
    assert.deepEqual(notifications.events, [{ type: 'expense-created', id: 'tx-1' }]);
    notifications.clear();
    assert.equal(notifications.events.length, 0);
});

test('database session helper commits and closes a session', async () => {
    let committed = false;
    let ended = false;
    const fakeConnection = {
        async startSession() {
            return {
                async withTransaction(operation) {
                    await operation(this);
                    committed = true;
                },
                async endSession() { ended = true; }
            };
        }
    };

    const result = await withDatabaseSession(session => {
        assert.equal(typeof session.withTransaction, 'function');
        return 'ok';
    }, { connection: fakeConnection });

    assert.equal(result, 'ok');
    assert.equal(committed, true);
    assert.equal(ended, true);
});

test('isolated database fixture is lazy until explicitly started', () => {
    const fixture = createIsolatedDatabase();
    assert.equal(fixture.server, null);
    assert.equal(fixture.uri, undefined);
});

test('authenticated agent preserves a real login path and test session metadata', () => {
    const app = express();
    const agent = createAuthenticatedAgent(app, {
        userId: '000000000000000000000042',
        username: 'wife-test',
        role: 'Wife',
        password: 'password'
    });

    assert.equal(typeof agent.login, 'function');
    assert.equal(agent.testSession.role, 'Wife');
    assert.equal(agent.testSession.userId, '000000000000000000000042');
    assert.deepEqual(createTestSession({ role: 'Husband' }).role, 'Husband');
});

test('property options require reproducible 100-run failure reporting', () => {
    assert.equal(PROPERTY_NUM_RUNS, 100);
    assert.deepEqual(propertyOptions({ seed: 1234 }), {
        numRuns: 100,
        endOnFailure: true,
        verbose: true,
        seed: 1234
    });
});

test('shared arbitraries generate strict dates, real weeks, and budget months', () => {
    const dates = fc.sample(calendarDateArbitrary, { numRuns: 50 });
    for (const value of dates) {
        assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(Temporal.PlainDate.from(value).toString(), value);
    }

    for (const value of fc.sample(budgetMonthArbitrary, { numRuns: 25 })) {
        assert.equal(value.key, `${value.year.toString().padStart(4, '0')}-${value.month.toString().padStart(2, '0')}`);
    }

    for (const week of fc.sample(realIsoWeekArbitrary, { numRuns: 25 })) {
        const start = Temporal.PlainDate.from(week.startDate);
        const end = Temporal.PlainDate.from(week.endDate);
        assert.equal(start.dayOfWeek, 1);
        assert.equal(end.dayOfWeek, 7);
        assert.equal(end.since(start).days, 6);
        assert.equal(week.key, `${week.weekYear}-W${String(week.weekNumber).padStart(2, '0')}`);
    }
});

test('share, cadence, legacy, and concurrency arbitraries preserve their invariants', () => {
    for (const value of fc.sample(uniquePocketSharesArbitrary, { numRuns: 50 })) {
        assert.ok(value.pockets.length >= 1 && value.pockets.length <= 3);
        assert.equal(new Set(value.pockets).size, value.pockets.length);
        assert.equal(value.amount, value.shares.reduce((sum, amount) => sum + amount, 0));
        assert.equal(value.amount <= Number.MAX_SAFE_INTEGER, true);
    }

    for (const value of fc.sample(mixedCadenceStateArbitrary, { numRuns: 10 })) {
        assert.equal(value.cadences.length, value.monthlyAllocations.length);
        assert.equal(value.weeklyAllocations.length, value.cadences.length);
        if (value.cadences.length > 1) {
            assert.ok(value.cadences.some(item => item.cadence === 'Monthly'));
            assert.ok(value.cadences.some(item => item.cadence === 'Weekly'));
        }
        assert.ok(value.cadences.every(item => ['Monthly', 'Weekly'].includes(item.cadence)));
    }

    for (const value of fc.sample(legacyRecordArbitrary, { numRuns: 15 })) {
        assert.ok(['pocketbudgets', 'transactions', 'closedmonths'].includes(value.collection));
        assert.ok(value.record._id);
    }

    for (const requests of fc.sample(correlatedConcurrentWritesArbitrary, { numRuns: 15 })) {
        assert.ok(requests.length >= 2);
        assert.equal(new Set(requests.map(request => request.requestToken)).size, requests.length);
        assert.ok(requests.every(request => request.pocket === 'Groceries'));
    }
});

// Keep the helper's async assertion import surface exercised without executing
// a property in this infrastructure-focused test suite.
assert.equal(typeof fc.assert, 'function');
