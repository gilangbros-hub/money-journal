'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { verifyMigrationPreview, reconcileDualReadSources } = require('../services/migrationService');
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

function truthy(value) {
    if (value === true) return true;
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

// Compact, machine-readable summary of a verifyMigrationPreview result. It keeps
// only counts and boolean check outcomes (never record values, names, emoji, or
// amounts) so a rollout gate can be evaluated programmatically.
function summarizeVerification(result) {
    const checks = result.checks || {};
    return {
        ok: result.ok === true,
        previewId: String(result.previewId),
        status: result.status,
        checked: result.checked,
        appliedItemsChecked: result.appliedItemsChecked,
        mismatchCount: (result.mismatches || []).length,
        itemMismatchCount: (result.itemMismatches || []).length,
        checks: {
            preservation: checks.preservation ? checks.preservation.ok === true : true,
            schema: checks.schema ? checks.schema.ok === true : true,
            indexes: checks.indexes ? checks.indexes.ok === true : true,
            invariants: checks.invariants ? checks.invariants.ok === true : true,
            routes: checks.routes ? checks.routes.ok === true : true
        }
    };
}

/**
 * Verify a migration/rollout condition and return a fully machine-readable
 * result. The aggregate `ok` boolean (and, from `main`, a non-zero process exit)
 * is the single signal a release pipeline uses to decide whether
 * `POCKET_MANAGEMENT_ENABLED` may stay on or must be rolled back. Every gate
 * fails closed: any unmet condition yields `ok: false` rather than a silent
 * pass.
 *
 * Gates, in order:
 *   1. Salary-cycle migration verification (unchanged behavior; never weakened).
 *   2. Managed pocket-management preview verification (when a managed preview id
 *      is supplied) — proves the managed definition/assignment/association
 *      documents were applied and are structurally sound.
 *   3. Guarded dual-read reconciliation (when pocket-management verification is
 *      requested) — the same adapter the budget, transaction, and reporting
 *      services use at request time, so a green reconciliation is the pre-/post-
 *      migration budget/transaction/report equivalence check:
 *        - any ambiguous double source (a managed assignment and a conflicting
 *          legacy allocation for one pocket identity) fails the equivalence
 *          gate before final activation;
 *        - when zero-fallback is required (before legacy retirement), any
 *          nonzero legacy fallback fails the observation gate.
 *   4. Persistent unique-index assertion (unchanged).
 */
async function runVerification({
    previewId,
    managedPreviewId = process.env.POCKET_MANAGEMENT_PREVIEW_ID,
    actor,
    models,
    previewModel,
    itemModel,
    smokeUrl = process.env.ROLLOUT_AUTH_SMOKE_URL,
    cookie = process.env.ROLLOUT_AUTH_SMOKE_COOKIE,
    fetchImpl,
    connection = mongoose.connection,
    reconcile = reconcileDualReadSources,
    requireZeroFallback = truthy(process.env.ROLLOUT_REQUIRE_ZERO_FALLBACK),
    verifyPocketManagement
} = {}) {
    if (!previewId) throw new Error('previewId or --preview-id is required');

    const routeChecks = async () => {
        await assertAuthenticatedRouteSmoke({ smokeUrl, cookie, fetchImpl });
        return true;
    };

    // Gate 1: salary-cycle migration verification (preserved verbatim in intent).
    const salaryCycleResult = await verifyMigrationPreview({
        previewId,
        actor,
        models,
        previewModel,
        itemModel,
        routeChecks
    });
    const salaryCycle = summarizeVerification(salaryCycleResult);

    // Gates 2 and 3 only run for a pocket-management rollout. When neither a
    // managed preview nor a zero-fallback expectation is present (and the caller
    // does not explicitly ask), the managed path is skipped entirely so
    // feature-off verification stays byte-for-byte the legacy behavior.
    const shouldVerifyPocket = verifyPocketManagement === true ||
        (verifyPocketManagement === undefined &&
            (Boolean(managedPreviewId) || requireZeroFallback ||
                truthy(process.env.ROLLOUT_VERIFY_POCKET_MANAGEMENT)));

    let pocketManagement = null;
    if (shouldVerifyPocket) {
        let managedPreview = null;
        if (managedPreviewId) {
            const managedResult = await verifyMigrationPreview({
                previewId: managedPreviewId,
                actor,
                models,
                previewModel,
                itemModel,
                routeChecks
            });
            managedPreview = summarizeVerification(managedResult);
        }

        // Guarded dual-read reconciliation = pre/post budget/transaction/report
        // equivalence + zero-fallback observation, read-only.
        const reconciliation = await reconcile({ models });
        const ambiguousCount = reconciliation.ambiguousCount || 0;
        const fallbackCount = reconciliation.fallbackCount || 0;
        const managedCount = reconciliation.managedCount || 0;

        const equivalenceOk = ambiguousCount === 0;
        const zeroFallbackOk = requireZeroFallback ? fallbackCount === 0 : true;
        const managedPreviewOk = managedPreview ? managedPreview.ok : true;

        pocketManagement = {
            ok: equivalenceOk && zeroFallbackOk && managedPreviewOk,
            managedPreview,
            equivalence: { ok: equivalenceOk, ambiguousCount },
            zeroFallback: {
                ok: zeroFallbackOk,
                required: Boolean(requireZeroFallback),
                fallbackCount
            },
            managedCount,
            byScope: reconciliation.byScope || []
        };
    }

    // Gate 4: persistent unique index assertion. Captured (not thrown) so a
    // failure remains part of the machine-readable result and still fails closed.
    let indexes = { ok: true };
    try {
        await assertIndexes(connection || mongoose.connection, models);
    } catch (error) {
        indexes = { ok: false, error: error.message };
    }

    const ok = salaryCycle.ok && indexes.ok && (pocketManagement ? pocketManagement.ok : true);
    return {
        ok,
        previewId: salaryCycle.previewId,
        salaryCycle,
        pocketManagement,
        indexes,
        checks: [
            'salary-cycle-verification',
            ...(pocketManagement ? ['managed-migration-verification', 'dual-read-equivalence', 'zero-fallback-observation'] : []),
            'indexes'
        ]
    };
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI, { readPreference: 'primary' });
    try {
        const result = await runVerification({
            previewId: options.previewId,
            managedPreviewId: options.managedPreviewId,
            actor: actorFrom(options),
            requireZeroFallback: options.requireZeroFallback !== undefined
                ? truthy(options.requireZeroFallback)
                : undefined,
            verifyPocketManagement: options.verifyPocketManagement !== undefined
                ? truthy(options.verifyPocketManagement)
                : undefined
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        // Machine-detectable outcome: a failed verification/rollout condition
        // sets a non-zero exit code so an automated flag rollback can trigger.
        if (!result.ok) process.exitCode = 1;
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

module.exports = { actorFrom, parseArgs, runVerification, summarizeVerification };
