'use strict';

/**
 * Controlled salary-cycle migration operator CLI.
 *
 * The default command is `preview`; this command only writes migration preview
 * headers/items. Source financial collections are changed only by the explicit
 * approve -> execute lifecycle (and rollback requires its own approval).
 *
 * Examples:
 *   node scripts/migrate-budget-month.js preview --actor-id <id>
 *   node scripts/migrate-budget-month.js approve --preview-id <id> --actor-id <id> --historical-reassignment-approved
 *   node scripts/migrate-budget-month.js execute --preview-id <id> --actor-id <id>
 *   node scripts/migrate-budget-month.js verify --preview-id <id> --actor-id <id>
 *   node scripts/migrate-budget-month.js approve-rollback --preview-id <id> --actor-id <id>
 *   node scripts/migrate-budget-month.js rollback --preview-id <id> --actor-id <id>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const {
    DEFAULT_MAX_PREVIEW_BYTES,
    DEFAULT_MAX_PREVIEW_ITEMS,
    approveMigrationPreview,
    approveMigrationRollback,
    createAndPersistPreview,
    executeMigrationPreview,
    rollbackMigrationPreview,
    verifyMigrationPreview
} = require('../services/migrationService');

function parseArgs(argv) {
    const args = [...argv];
    const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'preview';
    const options = { command };
    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (key === 'historicalReassignmentApproved' || key === 'help' || key === 'json') {
            options[key] = true;
        } else {
            const value = args[++index];
            if (key === 'requiredBudgetMonth') {
                options[key] = options[key] || [];
                options[key].push(value);
            } else {
                options[key] = value;
            }
        }
    }
    return options;
}

function usage() {
    return [
        'Usage: node scripts/migrate-budget-month.js [preview|approve|execute|verify|approve-rollback|rollback] [options]',
        '',
        'Options:',
        '  --actor-id <ObjectId>                         authorized operator/Wife id',
        '  --preview-id <ObjectId>                       preview to approve/execute/verify/rollback',
        '  --historical-reassignment-approved           explicitly permit derived historical assignments',
        '  --time-zone <IANA zone>                       preview zone (default Asia/Jakarta)',
        '  --migration-version <version>                transform version',
        '  --required-budget-month <YYYY-MM>             add an open guard requirement (repeatable via comma list)',
        `  --max-preview-items <count>                   hard limit (default ${DEFAULT_MAX_PREVIEW_ITEMS})`,
        `  --max-preview-bytes <bytes>                   hard limit (default ${DEFAULT_MAX_PREVIEW_BYTES})`,
        '  --json                                        print machine-readable output',
        '  --help                                        show this help'
    ].join('\n');
}

function actorFrom(options) {
    const userId = options.actorId || process.env.MIGRATION_ACTOR_ID;
    if (!userId) throw new Error('MIGRATION_ACTOR_ID or --actor-id is required.');
    return { userId, role: process.env.MIGRATION_ACTOR_ROLE || 'Operator' };
}

function requiredMonths(options) {
    const values = Array.isArray(options.requiredBudgetMonth)
        ? options.requiredBudgetMonth
        : options.requiredBudgetMonth === undefined ? [] : [options.requiredBudgetMonth];
    const months = values.flatMap(value => String(value).split(',')).map(entry => entry.trim()).filter(Boolean);
    return months.length ? months : undefined;
}

function integerOption(value, field) {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(String(value))) throw new Error(`${field} must be a non-negative integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${field} exceeds the safe integer range.`);
    return parsed;
}

function stableOutput(value) {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
    if (value && typeof value.toObject === 'function') return stableOutput(value.toObject({ depopulate: true }));
    if (Array.isArray(value)) return value.map(stableOutput);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableOutput(value[key])]));
    }
    return value;
}

function print(value, json) {
    const output = stableOutput(value);
    process.stdout.write(`${typeof output === 'string' && !json ? output : JSON.stringify(output, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        print(usage(), false);
        return;
    }
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');

    await mongoose.connect(process.env.MONGODB_URI);
    try {
        const actor = actorFrom(options);
        let result;
        switch (options.command) {
            case 'preview':
                result = await createAndPersistPreview({
                    actor,
                    timeZone: options.timeZone,
                    migrationVersion: options.migrationVersion,
                    requiredBudgetMonths: requiredMonths(options),
                    maxPreviewItems: integerOption(options.maxPreviewItems, 'maxPreviewItems'),
                    maxPreviewBytes: integerOption(options.maxPreviewBytes, 'maxPreviewBytes')
                });
                break;
            case 'approve':
                result = await approveMigrationPreview({
                    actor,
                    previewId: options.previewId,
                    historicalReassignmentApproved: options.historicalReassignmentApproved === true
                });
                break;
            case 'execute':
                result = await executeMigrationPreview({ actor, previewId: options.previewId });
                break;
            case 'verify':
                result = await verifyMigrationPreview({ actor, previewId: options.previewId });
                break;
            case 'approve-rollback':
                result = await approveMigrationRollback({ actor, previewId: options.previewId });
                break;
            case 'rollback':
                result = await rollbackMigrationPreview({ actor, previewId: options.previewId });
                break;
            default:
                throw new Error(`Unknown migration command: ${options.command}`);
        }
        print(result, options.json === true);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = { main, parseArgs, usage };
