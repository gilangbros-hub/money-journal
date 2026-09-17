'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
    createPocketDefinition,
    updatePocketDefinition
} = require('../../services/pocketManagementService');
const {
    AuthorizationError,
    FeatureDisabledError
} = require('../../utils/domainErrors');

// ---------------------------------------------------------------------------
// In-memory doubles (mirrors the transaction-service unit-test conventions):
// a Mongoose-shaped query, a Definition model backed by a Map, and a session
// whose withTransaction simply runs its callback. These let us assert the
// structured safe-operation events without a replica set.
// ---------------------------------------------------------------------------

function query(value) {
    return {
        session() { return this; },
        lean() { return this; },
        async exec() { return typeof value === 'function' ? value() : value; }
    };
}

function makeDoc(data) {
    const doc = { ...data };
    doc.id = String(doc._id);
    doc.toDTO = function toDTO() {
        return {
            id: doc.id,
            name: doc.name,
            normalizedName: doc.normalizedName,
            emoji: doc.emoji,
            cadence: doc.cadence,
            defaultAmount: doc.defaultAmount,
            status: doc.status,
            version: doc.version
        };
    };
    return doc;
}

function createDefinitionModel() {
    const records = new Map();
    return {
        records,
        async create(rows) {
            const doc = makeDoc({ _id: new mongoose.Types.ObjectId(), ...rows[0] });
            records.set(doc.id, doc);
            return [doc];
        },
        findById(id) {
            return query(() => records.get(String(id)) || null);
        },
        findOneAndUpdate(filter, update) {
            const doc = records.get(String(filter._id));
            if (!doc || doc.version !== filter.version) return query(null);
            Object.assign(doc, update.$set, { version: doc.version + 1 });
            return query(doc);
        }
    };
}

const connection = {
    async startSession() {
        return {
            async withTransaction(operation) { return operation(this); },
            async endSession() {}
        };
    }
};

const wife = { userId: new mongoose.Types.ObjectId().toString(), role: 'Wife' };

function options(model, sink) {
    return {
        pocketManagementEnabled: true,
        definitionModel: model,
        connection,
        operationEvents: sink
    };
}

const SENSITIVE_KEYS = ['name', 'normalizedName', 'emoji', 'defaultAmount', 'allocations', 'note'];

function assertNoSensitiveFields(event) {
    for (const key of SENSITIVE_KEYS) {
        assert.ok(!(key in event), `event must not disclose "${key}"`);
    }
}

test('successful create emits one safe success event only after commit', async () => {
    const model = createDefinitionModel();
    const events = [];
    const dto = await createPocketDefinition(
        { name: 'Groceries', emoji: '🛒', cadence: 'Monthly', defaultAmount: 250000 },
        wife,
        options(model, (event) => events.push(event))
    );

    assert.equal(model.records.size, 1);
    assert.equal(events.length, 1);

    const event = events[0];
    assert.equal(event.operation, 'pocket.create');
    assert.equal(event.outcome, 'success');
    assert.equal(event.actorId, String(wife.userId));
    assert.equal(event.pocketId, dto.id);
    assert.equal(event.changedRecordCount, 1);
    assert.equal(event.retryCount, 0);
    assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
    assertNoSensitiveFields(event);
});

test('unauthorized create emits an error event with a safe code and no actor id', async () => {
    const model = createDefinitionModel();
    const events = [];

    await assert.rejects(
        () => createPocketDefinition(
            { name: 'Groceries', emoji: '🛒', cadence: 'Monthly', defaultAmount: 0 },
            { userId: new mongoose.Types.ObjectId().toString(), role: 'Husband' },
            options(model, (event) => events.push(event))
        ),
        (error) => error instanceof AuthorizationError
    );

    assert.equal(model.records.size, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].operation, 'pocket.create');
    assert.equal(events[0].outcome, 'error');
    assert.equal(events[0].errorCode, 'WIFE_ROLE_REQUIRED');
    // The caller was never authorized, so no actor identity is emitted.
    assert.ok(!('actorId' in events[0]));
    assertNoSensitiveFields(events[0]);
});

test('feature-disabled create emits an error event and never persists', async () => {
    const model = createDefinitionModel();
    const events = [];

    await assert.rejects(
        () => createPocketDefinition(
            { name: 'Groceries', emoji: '🛒', cadence: 'Monthly', defaultAmount: 0 },
            wife,
            { definitionModel: model, connection, operationEvents: (event) => events.push(event) }
        ),
        (error) => error instanceof FeatureDisabledError
    );

    assert.equal(model.records.size, 0);
    assert.equal(events[0].outcome, 'error');
    assert.equal(events[0].errorCode, 'POCKET_MANAGEMENT_FEATURE_DISABLED');
});

test('event-sink failure is best effort and does not roll back the commit', async () => {
    const model = createDefinitionModel();

    const dto = await createPocketDefinition(
        { name: 'Transport', emoji: '🚌', cadence: 'Monthly', defaultAmount: 100000 },
        wife,
        options(model, () => { throw new Error('sink offline'); })
    );

    assert.ok(dto.id);
    assert.equal(model.records.size, 1);
});

test('no-op update emits a success event reporting zero changed records', async () => {
    const model = createDefinitionModel();
    const created = await createPocketDefinition(
        { name: 'Groceries', emoji: '🛒', cadence: 'Monthly', defaultAmount: 0 },
        wife,
        options(model, () => {})
    );

    const events = [];
    const updated = await updatePocketDefinition(
        created.id,
        { name: 'Groceries', emoji: '🛒', cadence: 'Monthly', defaultAmount: 0, expectedVersion: 1 },
        wife,
        options(model, (event) => events.push(event))
    );

    // The record is preserved unchanged (version, audit) and the event reports
    // no changed records for the idempotent no-op.
    assert.equal(updated.version, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].operation, 'pocket.update');
    assert.equal(events[0].outcome, 'success');
    assert.equal(events[0].pocketId, created.id);
    assert.equal(events[0].changedRecordCount, 0);
    assertNoSensitiveFields(events[0]);
});

test('changed update emits a success event reporting one changed record', async () => {
    const model = createDefinitionModel();
    const created = await createPocketDefinition(
        { name: 'Groceries', emoji: '🛒', cadence: 'Monthly', defaultAmount: 0 },
        wife,
        options(model, () => {})
    );

    const events = [];
    const updated = await updatePocketDefinition(
        created.id,
        { defaultAmount: 500000, expectedVersion: 1 },
        wife,
        options(model, (event) => events.push(event))
    );

    assert.equal(updated.version, 2);
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, 'success');
    assert.equal(events[0].changedRecordCount, 1);
    assertNoSensitiveFields(events[0]);
});
