'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const PocketDefinition = require('../../models/pocketDefinition');
const {
    createPocketDefinition,
    updatePocketDefinition
} = require('../../services/pocketManagementService');
const { validateDefinitionFields, validatePocketBank } = require('../../services/pocketValidation');
const { BANKS, BANK_KEYS, findBank } = require('../../utils/banks');
const { DomainValidationError } = require('../../utils/domainErrors');

// Same in-memory doubles as pocketManagementObservability.test.js: a
// Definition model backed by a Map and a session that just runs its callback.
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
    doc.toDTO = () => ({ id: doc.id, name: doc.name, bank: doc.bank, version: doc.version });
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
const options = (model) => ({ pocketManagementEnabled: true, definitionModel: model, connection });
const base = { name: 'Groceries', emoji: '🛒', cadence: 'Monthly', defaultAmount: 0 };

test('catalogue has the four banks with a logo path each', () => {
    assert.deepEqual(BANK_KEYS, ['jago', 'blu', 'superbank', 'bca']);
    for (const bank of BANKS) assert.equal(bank.logo, `/images/banks/${bank.key}.svg`);
    assert.equal(findBank('blu').name, 'blu');
    assert.equal(findBank('seabank'), null);
});

test('validatePocketBank canonicalizes case and whitespace and rejects unknown banks', () => {
    assert.equal(validatePocketBank(' Jago '), 'jago');
    assert.throws(() => validatePocketBank('seabank'), DomainValidationError);
    assert.throws(() => validatePocketBank(''), DomainValidationError);
});

test('create requires a bank, update keeps it optional but not clearable', () => {
    const create = validateDefinitionFields(base, 'create');
    assert.equal(create.errors.length, 1);
    assert.equal(create.errors[0].field, 'bank');

    assert.equal(validateDefinitionFields({ emoji: '🛒' }, 'update').errors.length, 0);
    const cleared = validateDefinitionFields({ bank: null }, 'update');
    assert.equal(cleared.errors.length, 1);
});

test('create without a bank is rejected and nothing is persisted', async () => {
    const model = createDefinitionModel();
    await assert.rejects(() => createPocketDefinition(base, wife, options(model)), (error) => {
        assert.equal(error.code, 'VALIDATION_ERROR');
        assert.equal(error.field, 'bank');
        return true;
    });
    assert.equal(model.records.size, 0);
});

test('create stores the canonical bank key', async () => {
    const model = createDefinitionModel();
    const dto = await createPocketDefinition({ ...base, bank: 'Jago ' }, wife, options(model));
    assert.equal(dto.bank, 'jago');
});

test('changing only the bank bumps the version; clearing it is rejected', async () => {
    const model = createDefinitionModel();
    const created = await createPocketDefinition({ ...base, bank: 'jago' }, wife, options(model));

    const moved = await updatePocketDefinition(created.id, { bank: 'blu', expectedVersion: 1 }, wife, options(model));
    assert.equal(moved.bank, 'blu');
    assert.equal(moved.version, 2);

    await assert.rejects(() => updatePocketDefinition(created.id, { bank: '' }, wife, options(model)));
    await assert.rejects(() => updatePocketDefinition(created.id, { bank: null }, wife, options(model)));
    assert.equal(model.records.get(created.id).bank, 'blu');
});

test('a definition saved before banks existed still validates and has no bank in its DTO', () => {
    const doc = new PocketDefinition({
        name: 'Old', normalizedName: 'old', emoji: '📦', cadence: 'Monthly', defaultAmount: 0,
        createdBy: new mongoose.Types.ObjectId(), updatedBy: new mongoose.Types.ObjectId()
    });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.toDTO().bank, undefined);
    doc.bank = 'seabank';
    assert.ok(doc.validateSync()?.errors?.bank);
});
