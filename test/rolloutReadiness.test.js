'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { assertRepresentativeCalendarCases, assertIndexes } = require('../scripts/rollout-preflight');
const { parseArgs } = require('../scripts/rollout-verify');

function modelWithIndexes(indexes) {
    return { schema: { indexes: () => indexes }, collection: {} };
}

test('rollout preflight covers representative weekday, weekend, and crossing-week cases', () => {
    assert.doesNotThrow(assertRepresentativeCalendarCases);
});

test('rollout preflight detects missing unique composite indexes without writing', async () => {
    const models = {
        pocketbudgets: modelWithIndexes([[{ pocket: 1 }, { unique: true }]])
    };
    await assert.rejects(
        () => assertIndexes(null, models),
        /required unique index is missing/
    );
});

test('rollout verification argument parsing is deterministic', () => {
    assert.deepEqual(parseArgs(['--preview-id', 'abc', '--actor-id', 'def']), {
        previewId: 'abc',
        actorId: 'def'
    });
});

test('readiness preflight fails closed when no database is configured', () => {
    const result = spawnSync(process.execPath, ['scripts/rollout-preflight.js'], {
        cwd: require('node:path').resolve(__dirname, '..'),
        env: { ...process.env, MONGODB_URI: '' },
        encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MONGODB_URI is required/);
});
