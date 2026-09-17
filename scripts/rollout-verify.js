'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { verifyMigrationPreview } = require('../services/migrationService');
const { assertIndexes, assertAuthenticatedRouteSmoke } = require('./rollout-preflight');

function parseArgs(argv = process.argv.slice(2)) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        result[key] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    }
    return result;
}

function actorFrom(options) {
    const userId = options.actorId || process.env.MIGRATION_ACTOR_ID;
    if (!userId) throw new Error('MIGRATION_ACTOR_ID or --actor-id is required');
    return { userId, role: process.env.MIGRATION_ACTOR_ROLE || 'Operator' };
}

async function runVerification({
    previewId,
    actor,
    models,
    previewModel,
    itemModel,
    smokeUrl = process.env.ROLLOUT_AUTH_SMOKE_URL,
    cookie = process.env.ROLLOUT_AUTH_SMOKE_COOKIE,
    fetchImpl
} = {}) {
    if (!previewId) throw new Error('previewId or --preview-id is required');
    const result = await verifyMigrationPreview({
        previewId,
        actor,
        models,
        previewModel,
        itemModel,
        routeChecks: async () => {
            await assertAuthenticatedRouteSmoke({ smokeUrl, cookie, fetchImpl });
            return true;
        }
    });
    if (!result.ok) {
        throw new Error(
            `migration verification failed: ${result.mismatches.length + result.itemMismatches.length} record mismatch(es); inspect structural, invariant, and route checks`
        );
    }
    await assertIndexes(mongoose.connection, models);
    return {
        ok: true,
        previewId: String(result.previewId),
        checked: result.checked,
        appliedItemsChecked: result.appliedItemsChecked,
        checks: result.checks
    };
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI, { readPreference: 'primary' });
    try {
        const result = await runVerification({ previewId: options.previewId, actor: actorFrom(options) });
        process.stdout.write(`${JSON.stringify(result)}\n`);
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

module.exports = { actorFrom, parseArgs, runVerification };
