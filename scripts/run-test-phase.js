'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const phase = process.argv[2] || 'unit';
const filesByPhase = {
    // The unit phase discovers the test/unit directory plus root-level unit
    // suites that exercise shared primitives (e.g. sanitized domain errors used
    // by pocket management). List the root file explicitly so this phase mirrors
    // the acceptance profile's unit phase without pulling in service/database or
    // rollout root suites that own their own isolated phases.
    unit: ['test/unit', 'test/domainErrors.test.js'],
    property: ['test/property', 'test/salaryCycleIsoWeek.property.test.js'],
    integration: ['test/integration'],
    ui: ['test/ui'],
    migration: ['test/migration'],
    concurrency: ['test/concurrency'],
    // Rollout/compatibility suites live at the test root (they exercise the
    // release scripts and flag-off/flag-on behavior). List them explicitly so
    // they are discoverable as their own named phase rather than being missed.
    rollout: [
        'test/rolloutCompatibility.test.js',
        'test/rolloutReadiness.test.js',
        'test/rollout.test.js'
    ]
};

function collect(entry) {
    const absolute = path.join(root, entry);
    if (!fs.existsSync(absolute)) return [];
    if (fs.statSync(absolute).isFile()) return [absolute];
    return fs.readdirSync(absolute).filter(name => name.endsWith('.test.js')).sort()
        .map(name => path.join(absolute, name));
}

const entries = filesByPhase[phase];
if (!entries) {
    process.stderr.write(`Unknown test phase: ${phase}\n`);
    process.exit(2);
}
const files = entries.flatMap(collect);
if (!files.length) {
    process.stdout.write(`[test:${phase}] no tests found\n`);
    process.exit(0);
}
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: root, env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status || 0);
