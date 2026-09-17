'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canonicalStringify,
    createSourceFingerprint,
    toCanonical
} = require('../../services/migrationFingerprint');
const {
    applyMigrationItems,
    checkPreservation,
    createMigrationPreview
} = require('../../services/migrationTransformService');

const zone = 'Asia/Jakarta';
const actor = '65f000000000000000000001';

function fixture() {
    return {
        pocketBudgets: [{
            _id: '65f000000000000000000010',
            pocket: 'Groceries', month: 4, year: 2026, budget: 500000,
            createdBy: actor,
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
            updatedAt: new Date('2026-03-02T00:00:00.000Z')
        }],
        pocketBudgetCadences: [],
        weeklyAllocations: [],
        transactions: [{
            _id: '65f000000000000000000011',
            date: new Date('2026-04-23T05:00:00.000Z'),
            type: 'Groceries', pocket: 'Groceries', ngapain: 'vegetables', by: actor,
            paidBy: 'Wife', amount: 125000, budgetMonth: 4, budgetYear: 2026,
            sourceType: 'single', sourceBreakdowns: [],
            createdAt: new Date('2026-04-23T06:00:00.000Z'),
            updatedAt: new Date('2026-04-23T06:00:00.000Z')
        }, {
            _id: '65f000000000000000000012',
            date: new Date('2026-04-24T05:00:00.000Z'),
            type: 'Groceries', pocket: 'Groceries', ngapain: 'payday groceries', by: actor,
            paidBy: 'Husband', amount: 200000, budgetMonth: 4, budgetYear: 2026,
            sourceType: 'single', sourceBreakdowns: [],
            createdAt: new Date('2026-04-24T06:00:00.000Z'),
            updatedAt: new Date('2026-04-24T06:00:00.000Z')
        }],
        closedMonths: [{
            _id: '65f000000000000000000013', month: 4, year: 2026,
            closedBy: actor,
            createdAt: new Date('2026-04-30T00:00:00.000Z'),
            updatedAt: new Date('2026-04-30T00:00:00.000Z')
        }]
    };
}

test('canonical strings and source fingerprints are independent of object key order', () => {
    assert.equal(canonicalStringify({ b: 2, a: 1 }), canonicalStringify({ a: 1, b: 2 }));
    assert.deepEqual(toCanonical({ when: new Date('2026-04-24T05:00:00.000Z') }), {
        when: { $date: '2026-04-24T05:00:00.000Z' }
    });

    const recordsA = [{ collectionName: 'transactions', record: { _id: '2', updatedAt: 'v2' } },
        { collectionName: 'transactions', record: { _id: '1', updatedAt: 'v1' } }];
    const recordsB = recordsA.slice().reverse();
    assert.equal(
        createSourceFingerprint({ records: recordsA, timeZone: zone, migrationVersion: 'v1' }),
        createSourceFingerprint({ records: recordsB, timeZone: zone, migrationVersion: 'v1' })
    );
    assert.notEqual(
        createSourceFingerprint({ records: recordsA, timeZone: zone, migrationVersion: 'v1' }),
        createSourceFingerprint({ records: recordsA, timeZone: 'UTC', migrationVersion: 'v1' })
    );
    assert.notEqual(
        createSourceFingerprint({ records: recordsA, timeZone: zone, migrationVersion: 'v1' }),
        createSourceFingerprint({ records: recordsA, timeZone: zone, migrationVersion: 'v2' })
    );
});

test('preview proposes canonical budget/date changes, guards, and approval-blocked reassignment', () => {
    const preview = createMigrationPreview({ ...fixture(), timeZone: zone });

    assert.equal(preview.timeZone, zone);
    assert.equal(preview.items.every(entry => entry.before && entry.after), true);
    assert.ok(preview.items.some(entry => entry.changeType === 'monthlyAllocationConversion'));
    assert.ok(preview.items.some(entry => entry.changeType === 'cadenceAssignment'));
    assert.ok(preview.items.some(entry => entry.changeType === 'transactionCanonicalDate'));
    const reassignment = preview.items.find(entry => entry.changeType === 'transactionBudgetMonthChange' && entry.recordId.endsWith('012'));
    assert.ok(reassignment);
    assert.equal(reassignment.executable, false);
    assert.equal(reassignment.blockingReason, 'HISTORICAL_REASSIGNMENT_APPROVAL_REQUIRED');
    assert.deepEqual(reassignment.after.budgetMonth, 5);
    assert.deepEqual(reassignment.after.budgetYear, 2026);

    const closed = preview.items.find(entry => entry.changeType === 'closedMonthPreservation');
    assert.ok(closed);
    assert.equal(closed.after.isClosed, true);
    assert.ok(preview.items.some(entry => entry.changeType === 'openBudgetGuard' && entry.recordId === 'guard:2026-05'));
    assert.equal(preview.counts.invalid, 0);
    assert.equal(preview.counts.proposed, preview.items.length);
    assert.equal(preview.executableItems.some(entry => entry === reassignment), false);
    assert.deepEqual(preview.items.map(entry => entry.sequence), preview.items.map((_, index) => index + 1));
});

test('preview reports every invalid record and duplicate allocation key without source mutation', () => {
    const input = {
        pocketBudgets: [
            { _id: 'budget-1', pocket: 'Groceries', month: 4, year: 2026, budget: 100 },
            { _id: 'budget-2', pocket: 'Groceries', month: 4, year: 2026, budget: 200 },
            { _id: 'budget-3', pocket: 'Unknown', month: 4, year: 2026, budget: 200 }
        ],
        transactions: [{ _id: 'tx-invalid', date: 'not-a-date', pocket: 'Groceries' }],
        closedMonths: []
    };
    const before = JSON.stringify(input);
    const preview = createMigrationPreview({ ...input, timeZone: zone });

    assert.equal(JSON.stringify(input), before);
    assert.equal(preview.counts.duplicateAllocationKeys, 1);
    assert.equal(preview.counts.invalid, 2);
    assert.equal(preview.blockers.length, 4);
    assert.ok(preview.blockers.some(entry => entry.recordId === 'budget-1'));
    assert.ok(preview.blockers.some(entry => entry.recordId === 'budget-2'));
    assert.ok(preview.blockers.some(entry => entry.recordId === 'budget-3'));
    assert.ok(preview.blockers.some(entry => entry.recordId === 'tx-invalid'));
    assert.equal(preview.executableItems.length, 0);
});

test('preservation checks protect required identity, financial, ownership, date, and timestamp fields', () => {
    const before = {
        _id: 'budget-1', pocket: 'Groceries', month: 4, year: 2026,
        budget: 100, createdBy: actor, createdAt: 'created', updatedAt: 'updated'
    };
    assert.equal(checkPreservation(before, { ...before, schemaVersion: 2 }, 'monthlyAllocation').ok, true);
    assert.deepEqual(
        checkPreservation(before, { ...before, budget: 101 }, 'monthlyAllocation').violations,
        ['budget']
    );
});

test('approved executable items apply in memory and a second preview is idempotent', () => {
    const input = fixture();
    const first = createMigrationPreview({
        ...input,
        timeZone: zone,
        historicalReassignmentApproved: true
    });
    assert.equal(first.blockers.length, 0);

    const migrated = applyMigrationItems(input, first.executableItems);
    const second = createMigrationPreview({
        ...migrated,
        timeZone: zone,
        historicalReassignmentApproved: true
    });
    assert.equal(second.items.length, 0);
    assert.equal(second.executableItems.length, 0);
    assert.equal(second.blockers.length, 0);
    assert.equal(second.counts.proposed, 0);
    assert.equal(second.counts.unchanged, second.counts.scanned);
});


test('preview blocks duplicate source identities and invalid split records without proposing writes', () => {
    const input = {
        pocketBudgets: [
            { _id: 'budget-1', pocket: 'Groceries', month: 4, year: 2026, budget: 100 },
            { _id: 'budget-1', pocket: 'Kwintals', month: 4, year: 2026, budget: 200 }
        ],
        transactions: [{
            _id: 'tx-invalid-share', type: 'Groceries', pocket: 'Groceries', amount: 100,
            sourceType: 'multi', sourceBreakdowns: [{ pocket: 'Groceries', amount: 99 }],
            date: '2026-04-23'
        }]
    };
    const preview = createMigrationPreview({ ...input, timeZone: zone });

    assert.equal(preview.executableItems.length, 0);
    assert.equal(preview.counts.unresolvableConflicts, 2);
    assert.ok(preview.blockers.some(item => item.blockingReason === 'DUPLICATE_SOURCE_IDENTIFIER'));
    assert.ok(preview.blockers.some(item => item.blockingReason === 'POCKET_SHARES_SUM_MISMATCH'));
});

test('assignment metadata normalization does not require historical reassignment approval', () => {
    const input = fixture();
    input.transactions = [input.transactions[0]];
    const preview = createMigrationPreview({ ...input, timeZone: zone });
    const metadata = preview.items.find(item => item.changeType === 'transactionAssignmentMetadata');

    assert.ok(metadata);
    assert.equal(metadata.executable, true);
    assert.equal(preview.blockers.length, 0);
});
