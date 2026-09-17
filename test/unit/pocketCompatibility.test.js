'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    FALLBACK_SOURCE,
    isDualReadActive,
    isManagedReadActive,
    safeReadMeta,
    createFallbackTracker,
    resolveTracker,
    reconcilePocketSources,
    resolvePreferredValue
} = require('../../services/pocketCompatibility');

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

test('dual-read is inactive unless the primary and dual-write flags are both on', () => {
    assert.equal(isDualReadActive(), false);
    assert.equal(isDualReadActive({ pocketManagementDualWriteEnabled: true }), false);
    assert.equal(
        isDualReadActive({ pocketManagementEnabled: true, pocketManagementDualWriteEnabled: false }),
        false
    );
    assert.equal(
        isDualReadActive({ pocketManagementEnabled: true, pocketManagementDualWriteEnabled: true }),
        true
    );
});

test('managed-read activation follows the primary flag only', () => {
    assert.equal(isManagedReadActive(), false);
    assert.equal(isManagedReadActive({ pocketManagementEnabled: true }), true);
});

// ---------------------------------------------------------------------------
// Safe metadata
// ---------------------------------------------------------------------------

test('safeReadMeta keeps only allowlisted recovery-safe fields', () => {
    const safe = safeReadMeta({
        source: 'legacy',
        collection: 'transactions',
        budgetMonth: '2024-03',
        pocketId: 42,
        pocketName: 'Groceries',
        amount: 1000,
        note: 'secret'
    });
    assert.deepEqual(safe, {
        source: 'legacy',
        collection: 'transactions',
        budgetMonth: '2024-03',
        pocketId: '42'
    });
    assert.equal(Object.prototype.hasOwnProperty.call(safe, 'pocketName'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(safe, 'amount'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(safe, 'note'), false);
});

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

test('the tracker counts managed hits, legacy fallbacks, and ambiguity', () => {
    const tracker = createFallbackTracker();
    tracker.observeManaged({ pocketId: 'a' });
    tracker.observeManaged({ pocketId: 'b' });
    tracker.observeFallback({ pocketId: 'c', budgetMonth: '2024-01' });
    tracker.observeAmbiguous({ pocketId: 'd', budgetMonth: '2024-01' });

    assert.deepEqual(tracker.summary(), {
        managedCount: 2,
        fallbackCount: 1,
        ambiguousCount: 1,
        hasFallback: true,
        hasAmbiguous: true
    });
    assert.equal(tracker.hasFallback(), true);
    assert.equal(tracker.hasAmbiguous(), true);
});

test('a fresh tracker reports zero fallback and zero ambiguity', () => {
    const tracker = createFallbackTracker();
    tracker.observeManaged({ pocketId: 'a' });
    assert.deepEqual(tracker.summary(), {
        managedCount: 1,
        fallbackCount: 0,
        ambiguousCount: 0,
        hasFallback: false,
        hasAmbiguous: false
    });
});

test('the tracker forwards recovery-safe events to an injected function observer', () => {
    const received = [];
    const tracker = createFallbackTracker({ observer: (event) => received.push(event) });
    tracker.observeFallback({ pocketId: 'x', budgetMonth: '2024-02', note: 'ignored' });

    assert.equal(received.length, 1);
    assert.equal(received[0].outcome, 'legacy-fallback');
    assert.equal(received[0].source, FALLBACK_SOURCE.LEGACY);
    assert.equal(received[0].pocketId, 'x');
    assert.equal(received[0].budgetMonth, '2024-02');
    assert.equal(Object.prototype.hasOwnProperty.call(received[0], 'note'), false);
});

test('a throwing observer never breaks the read', () => {
    const tracker = createFallbackTracker({
        observer() { throw new Error('sink down'); }
    });
    assert.doesNotThrow(() => tracker.observeFallback({ pocketId: 'x' }));
    assert.equal(tracker.counts.fallback, 1);
});

test('resolveTracker returns an injected tracker so callers can inspect counts', () => {
    const injected = createFallbackTracker();
    assert.equal(resolveTracker({ pocketFallbackTracker: injected }), injected);
    assert.equal(resolveTracker({}, { pocketFallbackTracker: injected }), injected);
    const created = resolveTracker({});
    assert.notEqual(created, injected);
    assert.equal(typeof created.observeFallback, 'function');
});

// ---------------------------------------------------------------------------
// Source reconciliation
// ---------------------------------------------------------------------------

test('reconcile prefers managed records and falls back to legacy only for unmigrated identities', () => {
    const tracker = createFallbackTracker();
    const { entries, fallback, ambiguous } = reconcilePocketSources({
        managed: [{ id: 'a' }, { id: 'b' }],
        legacy: [{ id: 'b' }, { id: 'c' }],
        keyOf: (record) => record.id,
        tracker
    });

    // Managed 'a' and 'b' preferred; legacy 'b' is an equivalent projection
    // (default equivalence) and dropped; legacy 'c' has no managed record and
    // becomes a tracked fallback.
    assert.deepEqual(entries.map((entry) => `${entry.source}:${entry.record.id}`), [
        'managed:a',
        'managed:b',
        'legacy:c'
    ]);
    assert.deepEqual(fallback.map((record) => record.id), ['c']);
    assert.deepEqual(ambiguous, []);
    assert.equal(tracker.counts.managed, 2);
    assert.equal(tracker.counts.fallback, 1);
    assert.equal(tracker.counts.ambiguous, 0);
});

test('reconcile flags an ambiguous double source when managed and legacy disagree', () => {
    const tracker = createFallbackTracker();
    const { entries, fallback, ambiguous } = reconcilePocketSources({
        managed: [{ id: 'b', total: 100 }],
        legacy: [{ id: 'b', total: 250 }, { id: 'c', total: 5 }],
        keyOf: (record) => record.id,
        isEquivalent: (managed, legacy) => managed.total === legacy.total,
        tracker
    });

    // 'b' exists in both with different totals -> ambiguous, managed preferred
    // and remains the only 'b' entry. 'c' -> unmigrated fallback.
    assert.deepEqual(entries.map((entry) => `${entry.source}:${entry.record.id}`), [
        'managed:b',
        'legacy:c'
    ]);
    assert.deepEqual(fallback.map((record) => record.id), ['c']);
    assert.equal(ambiguous.length, 1);
    assert.equal(ambiguous[0].key, 'b');
    assert.equal(tracker.counts.ambiguous, 1);
    assert.equal(tracker.counts.fallback, 1);
});

test('reconcile treats an equivalent legacy projection as consistent, not ambiguous', () => {
    const tracker = createFallbackTracker();
    const { ambiguous, fallback } = reconcilePocketSources({
        managed: [{ id: 'b', total: 100 }],
        legacy: [{ id: 'b', total: 100 }],
        keyOf: (record) => record.id,
        isEquivalent: (managed, legacy) => managed.total === legacy.total,
        tracker
    });
    assert.deepEqual(ambiguous, []);
    assert.deepEqual(fallback, []);
    assert.equal(tracker.counts.ambiguous, 0);
    assert.equal(tracker.counts.fallback, 0);
});

test('reconcile requires a keyOf function', () => {
    assert.throws(
        () => reconcilePocketSources({ managed: [], legacy: [] }),
        TypeError
    );
});

// ---------------------------------------------------------------------------
// Preferred value resolution
// ---------------------------------------------------------------------------

test('resolvePreferredValue prefers the managed value', () => {
    const tracker = createFallbackTracker();
    const resolved = resolvePreferredValue({ managed: 'M', legacy: 'L', tracker });
    assert.deepEqual(resolved, { value: 'M', source: FALLBACK_SOURCE.MANAGED });
    assert.equal(tracker.counts.managed, 1);
    assert.equal(tracker.counts.fallback, 0);
});

test('resolvePreferredValue falls back to legacy and tracks it when managed is absent', () => {
    const tracker = createFallbackTracker();
    const resolved = resolvePreferredValue({ managed: null, legacy: 'L', tracker });
    assert.deepEqual(resolved, { value: 'L', source: FALLBACK_SOURCE.LEGACY });
    assert.equal(tracker.counts.fallback, 1);
});

test('resolvePreferredValue returns null when neither source has a value', () => {
    const tracker = createFallbackTracker();
    assert.equal(resolvePreferredValue({ managed: null, legacy: undefined, tracker }), null);
    assert.equal(tracker.counts.managed, 0);
    assert.equal(tracker.counts.fallback, 0);
});
