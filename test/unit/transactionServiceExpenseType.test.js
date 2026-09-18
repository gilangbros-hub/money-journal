'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createExpense } = require('../../services/transactionService');
const { DomainValidationError } = require('../../utils/domainErrors');

const userId = new mongoose.Types.ObjectId().toString();

function query(value) {
    return {
        session() { return this; },
        async exec() { return typeof value === 'function' ? value() : value; }
    };
}

function createFakeModels() {
    const records = new Map();
    const guards = new Map();

    class FakeTransaction {
        constructor(data) {
            Object.assign(this, data);
            this._id = this._id || new mongoose.Types.ObjectId();
        }

        toObject() { return { ...this }; }

        async save() {
            records.set(this._id.toString(), this);
            return this;
        }
    }

    const guardModel = {
        ensureOpen({ month, year }) {
            const key = `${year}-${month}`;
            if (!guards.has(key)) guards.set(key, { month, year, isClosed: false, mutationSequence: 0 });
            return Promise.resolve(guards.get(key));
        },
        findOneAndUpdate({ month, year }) {
            const guard = guards.get(`${year}-${month}`);
            if (!guard || guard.isClosed) return Promise.resolve(null);
            guard.mutationSequence += 1;
            return Promise.resolve(guard);
        },
        findOne({ month, year }) {
            return Promise.resolve(guards.get(`${year}-${month}`) || null);
        }
    };

    const connection = {
        async startSession() {
            return {
                async withTransaction(operation) { return operation(this); },
                async endSession() {}
            };
        }
    };

    return { records, transactionModel: FakeTransaction, guardModel, connection };
}

function createTypeDefinitionModel(activeNames) {
    return {
        async find(filter) {
            if (filter.status === 'Active') {
                return [...activeNames].map((normalizedName) => ({ normalizedName }));
            }
            return [];
        },
        async countDocuments() {
            return activeNames.size;
        }
    };
}

function command(overrides = {}) {
    return {
        expenseDate: '2027-02-24',
        type: 'Groceries',
        pocket: 'Groceries',
        ngapain: 'market run',
        amount: 125000,
        paidBy: 'Self',
        sourceType: 'single',
        ...overrides
    };
}

test('createExpense accepts a known Active expense type when the feature is enabled', async () => {
    const models = createFakeModels();
    const expenseTypeDefinitionModel = createTypeDefinitionModel(new Set(['groceries']));

    const result = await createExpense(
        command(),
        { userId },
        { ...models, expenseTypeManagementEnabled: true, expenseTypeDefinitionModel }
    );

    assert.equal(result.type, 'Groceries');
});

test('createExpense rejects a type name that is not a defined, active expense type', async () => {
    const models = createFakeModels();
    const expenseTypeDefinitionModel = createTypeDefinitionModel(new Set(['groceries']));

    await assert.rejects(
        () => createExpense(
            command({ type: 'Made Up Category' }),
            { userId },
            { ...models, expenseTypeManagementEnabled: true, expenseTypeDefinitionModel }
        ),
        (error) => error instanceof DomainValidationError && error.field === 'type'
    );
    assert.equal(models.records.size, 0);
});

test('an archived type name is rejected the same as an unknown one', async () => {
    const models = createFakeModels();
    // "Old Thing" was archived: it is a defined type but not in the Active set.
    const expenseTypeDefinitionModel = createTypeDefinitionModel(new Set(['groceries']));

    await assert.rejects(
        () => createExpense(
            command({ type: 'Old Thing' }),
            { userId },
            { ...models, expenseTypeManagementEnabled: true, expenseTypeDefinitionModel }
        ),
        (error) => error instanceof DomainValidationError && error.field === 'type'
    );
});

test('the existence check is skipped entirely when the feature flag is off, even for a made-up type name', async () => {
    const models = createFakeModels();

    const result = await createExpense(command({ type: 'Anything Goes' }), { userId }, models);

    assert.equal(result.type, 'Anything Goes');
});
