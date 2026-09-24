'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const PocketBudget = require('../../models/pocketBudget');
const { errorHandler } = require('../../middleware/errorHandler');

function fakeResponse() {
    return {
        headersSent: false,
        statusCode: undefined,
        body: undefined,
        setHeader() {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

function captureConsoleError(run) {
    const original = console.error;
    const calls = [];
    console.error = (...args) => calls.push(args);
    try {
        run();
    } finally {
        console.error = original;
    }
    return calls;
}

test('a Mongoose ValidationError is logged by model, path and kind without submitted values', () => {
    const error = new PocketBudget({ pocket: 'SecretPocketName', month: 13, year: 2026, budget: -987654 }).validateSync();
    const req = { requestId: 'req-1', method: 'POST', path: '/api/budget' };
    const res = fakeResponse();

    const calls = captureConsoleError(() => errorHandler(error, req, res, () => {}));

    assert.equal(calls.length, 1);
    const [label, context, summary] = calls[0];
    assert.equal(label, 'Request failed');
    assert.equal(context.code, 'DATA_INTEGRITY_ERROR');
    assert.equal(summary.model, 'PocketBudget validation failed');
    assert.deepEqual(
        summary.failures.map(failure => `${failure.path}:${failure.kind}`).sort(),
        ['budget:min', 'createdBy:required', 'month:max', 'pocket:enum']
    );

    const logged = util.inspect(calls[0], { depth: null });
    assert.doesNotMatch(logged, /SecretPocketName/);
    assert.doesNotMatch(logged, /987654/);
    assert.doesNotMatch(logged, /\b13\b/);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'DATA_INTEGRITY_ERROR');
});

test('other server errors are still logged with the original error', () => {
    const error = new Error('boom');
    const calls = captureConsoleError(() => errorHandler(error, { requestId: 'req-2' }, fakeResponse(), () => {}));

    assert.equal(calls.length, 1);
    assert.equal(calls[0][2], error);
});
