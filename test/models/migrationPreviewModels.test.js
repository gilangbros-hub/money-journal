'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const MigrationPreview = require('../../models/migrationPreview');
const MigrationPreviewItem = require('../../models/migrationPreviewItem');

const actorId = new mongoose.Types.ObjectId();
const previewId = new mongoose.Types.ObjectId();

const validPreview = (overrides = {}) => new MigrationPreview({
    migrationVersion: 'salary-cycle-v1',
    timeZone: 'Asia/Jakarta',
    sourceFingerprint: 'sha256:source-1',
    createdBy: actorId,
    counts: {
        scanned: 12,
        unchanged: 4,
        proposed: 8,
        invalid: 1,
        duplicateAllocationKeys: 2,
        unresolvableConflicts: 3,
        byChangeType: {
            budgetConversion: 2,
            transactionAssignment: 5,
            closedMonthPreservation: 1
        }
    },
    ...overrides
});

const validItem = (overrides = {}) => new MigrationPreviewItem({
    previewId,
    sequence: 1,
    collectionName: 'transactions',
    recordId: '65f000000000000000000001',
    changeType: 'transactionBudgetMonthChange',
    before: {
        _id: { $oid: '65f000000000000000000001' },
        budgetMonth: 4,
        budgetYear: 2026,
        date: { $date: '2026-04-24T05:00:00.000Z' }
    },
    after: {
        _id: { $oid: '65f000000000000000000001' },
        budgetMonth: 5,
        budgetYear: 2026,
        date: { $date: '2026-04-24T05:00:00.000Z' }
    },
    executable: true,
    sourceRecordFingerprint: 'sha256:record-1',
    ...overrides
});

function declaredIndexes(model) {
    return model.schema.indexes().map(([keys, options]) => ({
        keys,
        unique: options.unique === true
    }));
}

test('migration preview stores lifecycle, approval, fingerprint, count, actor, and execution metadata', () => {
    const preview = validPreview({
        status: 'Approved',
        historicalReassignmentApproved: true,
        approvedBy: actorId,
        approvedAt: new Date('2027-01-01T00:00:00.000Z'),
        executedBy: actorId,
        executionStartedAt: new Date('2027-01-01T00:01:00.000Z'),
        executedAt: new Date('2027-01-01T00:02:00.000Z'),
        appliedFingerprint: 'sha256:applied-1'
    });

    assert.equal(preview.validateSync(), undefined);
    assert.equal(preview.status, 'Approved');
    assert.equal(preview.historicalReassignmentApproved, true);
    assert.equal(preview.counts.scanned, 12);
    assert.equal(preview.counts.byChangeType.transactionAssignment, 5);
    assert.equal(preview.collection.name, 'migrationpreviews');
    assert.equal(MigrationPreview.schema.options.timestamps, true);
});

test('preview rejects invalid status, time zone, and negative/non-integer counts', () => {
    for (const overrides of [
        { status: 'Running' },
        { timeZone: 'Not/AZone' },
        { counts: { scanned: -1 } },
        { counts: { scanned: 1.5 } }
    ]) {
        const error = validPreview(overrides).validateSync();
        assert.ok(error instanceof mongoose.Error.ValidationError, JSON.stringify(overrides));
    }
});

test('preview snapshot and execution metadata paths are immutable', () => {
    for (const path of [
        'migrationVersion',
        'timeZone',
        'sourceFingerprint',
        'counts',
        'approvedBy',
        'approvedAt',
        'executedBy',
        'executionStartedAt',
        'executedAt',
        'appliedFingerprint',
        'rolledBackBy',
        'rolledBackAt'
    ]) {
        assert.equal(MigrationPreview.schema.path(path).options.immutable, true, path);
    }
    // Status and the historical approval gate are deliberately mutable only
    // for the conditional lifecycle transition performed by the future service.
    assert.notEqual(MigrationPreview.schema.path('status').options.immutable, true);
    assert.notEqual(
        MigrationPreview.schema.path('historicalReassignmentApproved').options.immutable,
        true
    );
});

test('preview item preserves ordered Extended JSON before/after documents and blockers', () => {
    const before = { _id: { $oid: '65f000000000000000000002' }, date: { $date: '2026-04-23' } };
    const after = { _id: { $oid: '65f000000000000000000002' }, expenseDate: '2026-04-23' };
    const item = validItem({
        sequence: 7,
        before,
        after,
        executable: false,
        blockingReason: 'Historical reassignment approval is required.'
    });

    assert.equal(item.validateSync(), undefined);
    assert.deepEqual(item.before, before);
    assert.deepEqual(item.after, after);
    assert.equal(item.sequence, 7);
    assert.equal(item.executable, false);
    assert.match(item.blockingReason, /approval/);
    assert.equal(item.collection.name, 'migrationpreviewitems');
});

test('preview items reject invalid sequence, source collection, and non-document snapshots', () => {
    for (const overrides of [
        { sequence: 0 },
        { sequence: 1.25 },
        { collectionName: 'unknown' },
        { before: [] },
        { after: 'not Extended JSON' }
    ]) {
        const error = validItem(overrides).validateSync();
        assert.ok(error instanceof mongoose.Error.ValidationError, JSON.stringify(overrides));
    }
});

test('preview and preview-item indexes support deterministic lifecycle and execution', () => {
    assert.deepEqual(declaredIndexes(MigrationPreview), [
        {
            keys: { status: 1, sourceFingerprint: 1, updatedAt: -1 },
            unique: false
        },
        { keys: { createdBy: 1, createdAt: -1 }, unique: false }
    ]);
    assert.deepEqual(declaredIndexes(MigrationPreviewItem), [
        {
            keys: { previewId: 1, collectionName: 1, recordId: 1, changeType: 1 },
            unique: true
        },
        { keys: { previewId: 1, executable: 1, sequence: 1 }, unique: false }
    ]);
});

test('preview item snapshot and ordering fields are immutable', () => {
    for (const path of [
        'previewId',
        'sequence',
        'collectionName',
        'recordId',
        'changeType',
        'before',
        'after',
        'executable',
        'blockingReason',
        'sourceRecordFingerprint'
    ]) {
        assert.equal(MigrationPreviewItem.schema.path(path).options.immutable, true, path);
    }
});
