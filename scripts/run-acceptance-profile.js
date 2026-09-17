'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const testDir = path.join(root, 'test');

function filesIn(directory, pattern = /\.test\.js$/) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
        .filter(name => pattern.test(name))
        .sort()
        .map(name => path.join(directory, name));
}

function filesInDirectory(relative) {
    return filesIn(path.join(testDir, relative));
}

// Rollout/compatibility suites run in their own named phase (below) so they are
// never silently dropped and never double-executed by the unit phase.
const rolloutFileNames = ['rolloutCompatibility.test.js', 'rolloutReadiness.test.js', 'rollout.test.js'];
const rootFiles = filesIn(testDir).filter(file => !file.endsWith('transactionService.test.js') &&
    !file.endsWith('reportingService.test.js') && !file.endsWith('salaryCycleIsoWeek.property.test.js') &&
    !rolloutFileNames.some(name => file.endsWith(name)));
const rolloutFiles = rolloutFileNames.map(name => path.join(testDir, name));
const phases = [
    ['unit', rootFiles.concat(filesInDirectory('unit'))],
    ['property', [path.join(testDir, 'salaryCycleIsoWeek.property.test.js')].concat(filesInDirectory('property'))],
    ['service-and-database', [path.join(testDir, 'transactionService.test.js'), path.join(testDir, 'reportingService.test.js')].concat(filesInDirectory('integration'))],
    ['models-and-indexes', filesInDirectory('models')],
    ['migration', filesInDirectory('migration')],
    ['concurrency', filesInDirectory('concurrency')],
    ['ui', filesInDirectory('ui')],
    ['rollout', rolloutFiles],
    ['smoke', filesInDirectory('smoke')]
];

function runPhase(name, files) {
    const existing = files.filter(file => fs.existsSync(file));
    if (!existing.length) return;
    process.stdout.write(`\n[acceptance] ${name}\n`);
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...existing], {
        cwd: root,
        env: { ...process.env, TEST_PROFILE: 'acceptance' },
        stdio: 'inherit'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

for (const [name, files] of phases) runPhase(name, files);
process.stdout.write('\n[acceptance] complete\n');
