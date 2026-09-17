'use strict';

const {
    isPocketManagementEnabled,
    isPocketManagementDualWriteEnabled
} = require('../utils/rollout');

/**
 * Compatibility dual-read/dual-write projection adapters.
 *
 * These helpers implement the guarded dual-read stage described in the design
 * ("Source of truth and read precedence"). They are deliberately small, pure,
 * and additive so the three managed reader integrations (budget, transaction,
 * reporting), the managed service, and migration verification can share exactly
 * one interpretation of the compatibility contract:
 *
 *   1. `POCKET_MANAGEMENT_ENABLED` off  -> pure legacy reads (these helpers are
 *      never consulted, so feature-off behavior is byte-for-byte unchanged).
 *   2. primary on, dual-write off       -> managed-only reads (current behavior;
 *      `isDualReadActive` is false, so no fallback path runs).
 *   3. primary on, dual-write on        -> guarded dual-read: a verified managed
 *      record is preferred whenever present; the legacy source is used only for
 *      records that have not yet been migrated; every legacy fallback is tracked
 *      so a zero-fallback observation window can be proven before legacy
 *      retirement; and an ambiguous double source (a managed record AND a
 *      conflicting legacy record for the same identity) is flagged rather than
 *      silently resolved so activation can be prevented.
 *
 * Nothing here throws on a read: reads must stay available during rollout. The
 * tracker records fallback and ambiguity counts (plus recovery-safe event
 * metadata) so the rollout verification tooling can fail closed on nonzero
 * fallback or any ambiguity before final activation.
 */

const FALLBACK_SOURCE = Object.freeze({
    MANAGED: 'managed',
    LEGACY: 'legacy'
});

/**
 * The guarded dual-read stage only runs when Pocket Management is enabled and
 * the dual-write compatibility flag is on. This is the single gate every
 * reader consults; when it is false, callers keep their managed-only (or
 * feature-off) path untouched.
 */
function isDualReadActive(options = {}, actor = {}) {
    return isPocketManagementDualWriteEnabled(options, actor);
}

/**
 * True when managed reads are the source of truth (primary flag on), regardless
 * of the dual-write sub-stage. Re-exported so callers do not need to import the
 * rollout helper separately when they already depend on this module.
 */
function isManagedReadActive(options = {}, actor = {}) {
    return isPocketManagementEnabled(options, actor);
}

// ---------------------------------------------------------------------------
// Recovery-safe event metadata
// ---------------------------------------------------------------------------
//
// Fallback/ambiguity events are the read-time companion to the managed
// mutation events emitted by the service. They carry only the same allowlisted,
// non-sensitive fields (source collection, Budget Month key, pocket identifier)
// and never names, emoji, amounts, allocations, notes, or record bodies.

function safeReadMeta(meta = {}) {
    const safe = {};
    if (typeof meta.source === 'string' && meta.source) safe.source = meta.source;
    if (typeof meta.collection === 'string' && meta.collection) safe.collection = meta.collection;
    if (typeof meta.budgetMonth === 'string' && meta.budgetMonth) safe.budgetMonth = meta.budgetMonth;
    if (meta.pocketId !== undefined && meta.pocketId !== null && meta.pocketId !== '') {
        safe.pocketId = String(meta.pocketId);
    }
    return safe;
}

async function deliverReadEvent(observer, event) {
    if (!observer) return;
    try {
        if (typeof observer === 'function') {
            await observer(event);
        } else if (typeof observer.record === 'function') {
            await observer.record(event);
        } else if (typeof observer.enqueue === 'function') {
            await observer.enqueue(event);
        } else if (typeof observer.notify === 'function') {
            await observer.notify(event);
        } else if (typeof observer.send === 'function') {
            await observer.send(event);
        }
    } catch {
        // Observation is best effort: a read must never fail because a metrics
        // sink is unavailable. The counts on the tracker remain authoritative
        // in-process regardless of sink delivery.
    }
}

/**
 * Create a fallback/ambiguity tracker.
 *
 * The tracker keeps in-process counts (so a caller or test can assert
 * zero-fallback) and forwards a recovery-safe event to an optional injected
 * observer (a function or a `{ record | enqueue | notify | send }` sink) that
 * matches the "read fallback-to-legacy count during rollout" observability
 * counter. Delivery is best effort and never affects the read result.
 */
function createFallbackTracker({ observer = null } = {}) {
    const counts = { managed: 0, fallback: 0, ambiguous: 0 };
    const events = [];

    function emit(outcome, meta) {
        const event = { outcome, ...safeReadMeta(meta) };
        events.push(event);
        // Best-effort, fire-and-forget: a read is synchronous from the caller's
        // point of view, so we do not await the observer here.
        void deliverReadEvent(observer, event);
        return event;
    }

    return {
        counts,
        events,
        /** A managed record was used as the source of truth. */
        observeManaged(meta = {}) {
            counts.managed += 1;
            return emit('managed', { source: FALLBACK_SOURCE.MANAGED, ...meta });
        },
        /** No managed record existed; the legacy source was used (unmigrated). */
        observeFallback(meta = {}) {
            counts.fallback += 1;
            return emit('legacy-fallback', { source: FALLBACK_SOURCE.LEGACY, ...meta });
        },
        /** Both a managed and a conflicting legacy record exist for one identity. */
        observeAmbiguous(meta = {}) {
            counts.ambiguous += 1;
            return emit('ambiguous-source', meta);
        },
        hasFallback() {
            return counts.fallback > 0;
        },
        hasAmbiguous() {
            return counts.ambiguous > 0;
        },
        summary() {
            return {
                managedCount: counts.managed,
                fallbackCount: counts.fallback,
                ambiguousCount: counts.ambiguous,
                hasFallback: counts.fallback > 0,
                hasAmbiguous: counts.ambiguous > 0
            };
        }
    };
}

/**
 * Resolve a tracker from injected options/actor, or create a fresh one.
 *
 * A caller (rollout verification, tests) may inject `pocketFallbackTracker` to
 * inspect counts directly, or `pocketReadObserver` to receive the recovery-safe
 * events. In production neither is injected, so an internal throwaway tracker
 * is used and the read stays byte-for-byte identical apart from the compatibility
 * summary that only appears on dual-read results.
 */
function resolveTracker(options = {}, actor = {}) {
    const injected = options.pocketFallbackTracker ?? actor.pocketFallbackTracker;
    if (injected && typeof injected.observeFallback === 'function') return injected;
    const observer = options.pocketReadObserver
        ?? actor.pocketReadObserver
        ?? options.readObserver
        ?? actor.readObserver
        ?? null;
    return createFallbackTracker({ observer });
}

// ---------------------------------------------------------------------------
// Source reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile managed and legacy records for one read scope (typically one
 * Budget Month) into a single projection under the guarded dual-read contract.
 *
 * @param {object} params
 * @param {Array}  params.managed      Managed records (authoritative).
 * @param {Array}  params.legacy       Legacy records (compatibility source).
 * @param {(record:any)=>string} params.keyOf   Maps a record to its pocket
 *        identity key. The SAME function must key both managed and legacy
 *        records so a managed record and its legacy projection align. Callers
 *        that store different physical keys (e.g. a legacy pocket name vs a
 *        managed pocketId) must normalize both into one identity here.
 * @param {(managed:any, legacy:any)=>boolean} [params.isEquivalent]
 *        Optional equivalence check. When a managed record and a legacy record
 *        share an identity, an equivalent pair is the expected compatibility
 *        projection (not ambiguous); an inequivalent pair is an ambiguous double
 *        source and is flagged.
 * @param {object} params.tracker      A fallback tracker (see createFallbackTracker).
 * @param {(record:any)=>object} [params.metaOf] Maps a record to recovery-safe
 *        event metadata (budgetMonth, pocketId, collection).
 *
 * @returns {{ entries: Array<{source:string, record:any}>, fallback: Array, ambiguous: Array }}
 *        `entries` preserves every managed record (preferred) plus every legacy
 *        record whose identity has no managed record (unmigrated fallback). A
 *        legacy record whose identity IS managed is never added: equivalent
 *        pairs are dropped as redundant projections, conflicting pairs are
 *        flagged as ambiguous while the managed record remains the sole entry.
 */
function reconcilePocketSources({
    managed = [],
    legacy = [],
    keyOf,
    isEquivalent,
    tracker,
    metaOf = () => ({})
}) {
    if (typeof keyOf !== 'function') {
        throw new TypeError('reconcilePocketSources requires a keyOf(record) function.');
    }
    const activeTracker = tracker || createFallbackTracker();

    const managedByKey = new Map();
    const entries = [];
    for (const record of managed) {
        const key = keyOf(record);
        managedByKey.set(key, record);
        activeTracker.observeManaged(metaOf(record));
        entries.push({ source: FALLBACK_SOURCE.MANAGED, record });
    }

    const fallback = [];
    const ambiguous = [];
    for (const record of legacy) {
        const key = keyOf(record);
        if (managedByKey.has(key)) {
            const managedRecord = managedByKey.get(key);
            const equivalent = typeof isEquivalent === 'function'
                ? Boolean(isEquivalent(managedRecord, record))
                : true;
            if (!equivalent) {
                ambiguous.push({ key, managed: managedRecord, legacy: record });
                activeTracker.observeAmbiguous(metaOf(record));
            }
            // Equivalent legacy projections are redundant; the managed record
            // is already the single authoritative entry.
            continue;
        }
        // No managed record for this identity: the record has not been migrated
        // yet, so fall back to the legacy source and track the fallback.
        fallback.push(record);
        activeTracker.observeFallback(metaOf(record));
        entries.push({ source: FALLBACK_SOURCE.LEGACY, record });
    }

    return { entries, fallback, ambiguous };
}

/**
 * Resolve a single presentation label under the dual-read contract: prefer the
 * managed snapshot; fall back to the legacy value only when no managed snapshot
 * exists, tracking that fallback. Returns `{ value, source }` or `null` when
 * neither source can supply a value.
 */
function resolvePreferredValue({ managed, legacy, tracker, meta = {} }) {
    const activeTracker = tracker || createFallbackTracker();
    if (managed !== undefined && managed !== null) {
        activeTracker.observeManaged(meta);
        return { value: managed, source: FALLBACK_SOURCE.MANAGED };
    }
    if (legacy !== undefined && legacy !== null) {
        activeTracker.observeFallback(meta);
        return { value: legacy, source: FALLBACK_SOURCE.LEGACY };
    }
    return null;
}

module.exports = {
    FALLBACK_SOURCE,
    isDualReadActive,
    isManagedReadActive,
    safeReadMeta,
    createFallbackTracker,
    resolveTracker,
    reconcilePocketSources,
    resolvePreferredValue
};
