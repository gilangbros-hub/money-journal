'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    withOpenBudgetPeriod,
    withOpenBudgetPeriods
} = require('../../services/budgetPeriodGuard');
const {
    ClosedBudgetPeriodError,
    ConcurrentWriteConflictError
} = require('../../utils/domainErrors');

function fakeGuardModel(initial = []) {
    const states = new Map(initial.map(state => [`${state.year}-${state.month}`, { ...state }]));
    const calls = [];

    return {
        calls,
        states,
        ensureOpen({ month, year }) {
            const key = `${year}-${month}`;
            if (!states.has(key)) states.set(key, { month, year, isClosed: false, mutationSequence: 0 });
            return Promise.resolve(states.get(key));
        },
        findOneAndUpdate(filter, update, options) {
            calls.push({ type: 'fence', filter, update, options });
            const key = `${filter.year}-${filter.month}`;
            const state = states.get(key);
            if (!state || state.isClosed !== filter.isClosed) return Promise.resolve(null);
            state.mutationSequence += update.$inc.mutationSequence;
            return Promise.resolve({ ...state });
        },
        findOne(filter) {
            const query = {
                session(value) {
                    calls.push({ type: 'read-session', session: value });
                    return query;
                },
                exec: async () => states.get(`${filter.year}-${filter.month}`) || null
            };
            return query;
        }
    };
}

test('withOpenBudgetPeriod fences an open guard and passes the same session to the callback', async () => {
    const model = fakeGuardModel();
    const session = { id: 'session-1' };
    const received = await withOpenBudgetPeriod(2, 2027, session, async (guard, receivedSession, periods) => ({
        guard,
        receivedSession,
        periods
    }), { guardModel: model });

    assert.equal(received.guard.isClosed, false);
    assert.equal(received.guard.mutationSequence, 1);
    assert.equal(received.receivedSession, session);
    assert.deepEqual(received.periods.map(period => period.key), ['2027-02']);
    assert.deepEqual(model.calls[0], {
        type: 'fence',
        filter: { month: 2, year: 2027, isClosed: false },
        update: { $inc: { mutationSequence: 1 } },
        options: { new: true, session, runValidators: true }
    });
});

test('cross-period guards are deduplicated and acquired in YYYY-MM order', async () => {
    const model = fakeGuardModel();
    const session = { id: 'session-2' };
    let callbackGuards;

    await withOpenBudgetPeriods([
        { month: 3, year: 2027 },
        { month: 1, year: 2027 },
        { month: 3, year: 2027 },
        { month: 2, year: 2027 }
    ], session, async (guards, receivedSession, periods) => {
        callbackGuards = guards;
        assert.equal(receivedSession, session);
        assert.deepEqual(periods.map(period => period.key), ['2027-01', '2027-02', '2027-03']);
    }, { guardModel: model });

    assert.deepEqual(callbackGuards.map(guard => `${guard.year}-${String(guard.month).padStart(2, '0')}`), [
        '2027-01', '2027-02', '2027-03'
    ]);
    assert.deepEqual(model.calls.filter(call => call.type === 'fence').map(call => `${call.filter.year}-${String(call.filter.month).padStart(2, '0')}`), [
        '2027-01', '2027-02', '2027-03'
    ]);
});

test('a closed guard rejects before the protected callback and returns a typed error', async () => {
    const model = fakeGuardModel([{ month: 2, year: 2027, isClosed: true, mutationSequence: 4 }]);
    let callbackCalled = false;

    await assert.rejects(
        () => withOpenBudgetPeriod({ month: 2, year: 2027 }, { id: 'session-3' }, async () => {
            callbackCalled = true;
        }, { guardModel: model }),
        error => error instanceof ClosedBudgetPeriodError
            && error.code === 'BUDGET_MONTH_CLOSED'
            && error.details.budgetMonth === '2027-02'
    );
    assert.equal(callbackCalled, false);
    assert.equal(model.states.get('2027-2').mutationSequence, 4);
});

test('an unfenced guard race returns a typed conflict and does not invoke the operation', async () => {
    const model = fakeGuardModel();
    const originalFence = model.findOneAndUpdate;
    model.findOneAndUpdate = (filter, update, options) => {
        model.calls.push({ type: 'fence', filter, update, options });
        return Promise.resolve(null);
    };
    let callbackCalled = false;

    await assert.rejects(
        () => withOpenBudgetPeriod(2, 2027, { id: 'session-4' }, async () => {
            callbackCalled = true;
        }, { guardModel: model }),
        error => error instanceof ConcurrentWriteConflictError
            && error.code === 'ALLOCATION_WRITE_CONFLICT'
    );
    assert.equal(callbackCalled, false);
    model.findOneAndUpdate = originalFence;
});
