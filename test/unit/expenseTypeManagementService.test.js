'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
    createExpenseTypeDefinition,
    listExpenseTypeDefinitions,
    listActiveTypeNormalizedNames,
    updateExpenseTypeDefinition,
    archiveExpenseTypeDefinition,
    restoreExpenseTypeDefinition
} = require('../../services/expenseTypeManagementService');
const {
    AuthorizationError,
    FeatureDisabledError,
    PocketValidationError,
    PocketNameConflictError,
    PocketLifecycleConflictError,
    VersionConflictError,
    RecordNotFoundError
} = require('../../utils/domainErrors');

function makeDoc(data) {
    const doc = { ...data };
    doc.id = String(doc._id);
    doc.toDTO = function toDTO() {
        return {
            id: doc.id,
            name: doc.name,
            normalizedName: doc.normalizedName,
            emoji: doc.emoji,
            status: doc.status,
            version: doc.version
        };
    };
    return doc;
}

function createDefinitionModel(seed = []) {
    const records = new Map();
    seed.forEach((row) => {
        const doc = makeDoc({ _id: new mongoose.Types.ObjectId(), version: 1, status: 'Active', ...row });
        records.set(doc.id, doc);
    });
    return {
        records,
        async create(row) {
            const normalizedName = row.normalizedName;
            for (const existing of records.values()) {
                if (existing.normalizedName === normalizedName) {
                    const error = new Error('duplicate key');
                    error.code = 11000;
                    throw error;
                }
            }
            const doc = makeDoc({ _id: new mongoose.Types.ObjectId(), ...row });
            records.set(doc.id, doc);
            return doc;
        },
        async find(filter = {}) {
            let rows = [...records.values()];
            if (filter.status) rows = rows.filter((row) => row.status === filter.status);
            return rows;
        },
        async findById(id) {
            return records.get(String(id)) || null;
        },
        async findOneAndUpdate(filter, update) {
            const doc = records.get(String(filter._id));
            if (!doc || doc.version !== filter.version) return null;
            if (filter.status && doc.status !== filter.status) return null;
            if (update.$set.normalizedName) {
                for (const [id, existing] of records) {
                    if (id !== doc.id && existing.normalizedName === update.$set.normalizedName) {
                        const error = new Error('duplicate key');
                        error.code = 11000;
                        throw error;
                    }
                }
            }
            Object.assign(doc, update.$set, { version: doc.version + (update.$inc?.version || 0) });
            return doc;
        },
        async countDocuments() {
            return records.size;
        },
        async insertMany(docs) {
            docs.forEach((row) => {
                const doc = makeDoc({ _id: new mongoose.Types.ObjectId(), ...row });
                records.set(doc.id, doc);
            });
        }
    };
}

const wife = { userId: new mongoose.Types.ObjectId().toString(), role: 'Wife' };
const husband = { userId: new mongoose.Types.ObjectId().toString(), role: 'Husband' };

function options(model, overrides = {}) {
    return { expenseTypeManagementEnabled: true, expenseTypeDefinitionModel: model, ...overrides };
}

test('the feature fails closed when the rollout flag is off', async () => {
    const model = createDefinitionModel();
    await assert.rejects(
        () => listExpenseTypeDefinitions({}, wife, { expenseTypeDefinitionModel: model }),
        FeatureDisabledError
    );
    await assert.rejects(
        () => createExpenseTypeDefinition({ name: 'Pulsa', emoji: '📱' }, wife, { expenseTypeDefinitionModel: model }),
        FeatureDisabledError
    );
});

test('only Wife can create, edit, archive, or restore an expense type', async () => {
    const model = createDefinitionModel([{ name: 'Eat', normalizedName: 'eat', emoji: '🍽️' }]);
    const [eat] = [...model.records.values()];
    await assert.rejects(
        () => createExpenseTypeDefinition({ name: 'Pulsa', emoji: '📱' }, husband, options(model)),
        AuthorizationError
    );
    await assert.rejects(
        () => updateExpenseTypeDefinition(eat.id, { name: 'Eating' }, husband, options(model)),
        AuthorizationError
    );
    await assert.rejects(
        () => archiveExpenseTypeDefinition(eat.id, {}, husband, options(model)),
        AuthorizationError
    );
    await assert.rejects(
        () => restoreExpenseTypeDefinition(eat.id, {}, husband, options(model)),
        AuthorizationError
    );
});

test('create validates name and emoji shape and rejects a duplicate normalized name', async () => {
    const model = createDefinitionModel([{ name: 'Eat', normalizedName: 'eat', emoji: '🍽️' }]);
    await assert.rejects(
        () => createExpenseTypeDefinition({ name: '', emoji: '📱' }, wife, options(model)),
        PocketValidationError
    );
    await assert.rejects(
        () => createExpenseTypeDefinition({ name: 'Pulsa', emoji: 'ab' }, wife, options(model)),
        PocketValidationError
    );
    await assert.rejects(
        () => createExpenseTypeDefinition({ name: 'eat', emoji: '📱' }, wife, options(model)),
        PocketNameConflictError
    );

    const created = await createExpenseTypeDefinition({ name: 'Pulsa', emoji: '📱' }, wife, options(model));
    assert.equal(created.name, 'Pulsa');
    assert.equal(created.emoji, '📱');
    assert.equal(created.status, 'Active');
    assert.equal(created.version, 1);
});

test('list returns active-only by default and a disjoint archived set on request, both ordered', async () => {
    const model = createDefinitionModel([
        { name: 'Snack', normalizedName: 'snack', emoji: '🍿' },
        { name: 'Eat', normalizedName: 'eat', emoji: '🍽️' },
        { name: 'Old Thing', normalizedName: 'old thing', emoji: '📦', status: 'Archived' }
    ]);

    const activeOnly = await listExpenseTypeDefinitions({}, wife, options(model));
    assert.deepEqual(activeOnly.active.map((t) => t.name), ['Eat', 'Snack']);
    assert.equal(activeOnly.archived, undefined);

    const withArchived = await listExpenseTypeDefinitions({ includeArchived: true }, wife, options(model));
    assert.deepEqual(withArchived.archived.map((t) => t.name), ['Old Thing']);
});

test('the first read seeds the historical 12 fixed types exactly once', async () => {
    const model = createDefinitionModel();
    const first = await listExpenseTypeDefinitions({}, wife, options(model));
    assert.equal(first.active.length, 12);
    assert.ok(first.active.some((t) => t.name === 'Eat' && t.emoji === '🍽️'));

    // A second read must not duplicate the seed.
    const second = await listExpenseTypeDefinitions({}, wife, options(model));
    assert.equal(second.active.length, 12);
});

test('update is a no-op when every supplied value already matches storage, preserving version', async () => {
    const model = createDefinitionModel([{ name: 'Eat', normalizedName: 'eat', emoji: '🍽️' }]);
    const [eat] = [...model.records.values()];
    const result = await updateExpenseTypeDefinition(eat.id, { name: 'Eat', emoji: '🍽️' }, wife, options(model));
    assert.equal(result.version, 1);
});

test('update rejects a stale expectedVersion and an edit of an archived type', async () => {
    const model = createDefinitionModel([
        { name: 'Eat', normalizedName: 'eat', emoji: '🍽️' },
        { name: 'Old Thing', normalizedName: 'old thing', emoji: '📦', status: 'Archived' }
    ]);
    const [eat, archived] = [...model.records.values()];

    await assert.rejects(
        () => updateExpenseTypeDefinition(eat.id, { name: 'Eating', expectedVersion: 99 }, wife, options(model)),
        VersionConflictError
    );
    await assert.rejects(
        () => updateExpenseTypeDefinition(archived.id, { name: 'New Name' }, wife, options(model)),
        PocketLifecycleConflictError
    );
    await assert.rejects(
        () => updateExpenseTypeDefinition(new mongoose.Types.ObjectId().toString(), { name: 'X' }, wife, options(model)),
        RecordNotFoundError
    );
});

test('archive then restore round-trips status and increments version once per transition', async () => {
    const model = createDefinitionModel([{ name: 'Eat', normalizedName: 'eat', emoji: '🍽️' }]);
    const [eat] = [...model.records.values()];

    const archived = await archiveExpenseTypeDefinition(eat.id, {}, wife, options(model));
    assert.equal(archived.status, 'Archived');
    assert.equal(archived.version, 2);

    await assert.rejects(
        () => archiveExpenseTypeDefinition(eat.id, {}, wife, options(model)),
        PocketLifecycleConflictError
    );

    const restored = await restoreExpenseTypeDefinition(eat.id, {}, wife, options(model));
    assert.equal(restored.status, 'Active');
    assert.equal(restored.version, 3);
});

test('listActiveTypeNormalizedNames returns only Active names and seeds when empty', async () => {
    const model = createDefinitionModel([
        { name: 'Eat', normalizedName: 'eat', emoji: '🍽️' },
        { name: 'Old Thing', normalizedName: 'old thing', emoji: '📦', status: 'Archived' }
    ]);
    const names = await listActiveTypeNormalizedNames(wife, options(model));
    assert.deepEqual([...names].sort(), ['eat']);

    const emptyModel = createDefinitionModel();
    const seededNames = await listActiveTypeNormalizedNames(wife, options(emptyModel));
    assert.equal(seededNames.size, 12);
    assert.ok(seededNames.has('eat'));
});
