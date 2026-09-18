'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ExpenseTypeDefinition = require('../../models/expenseTypeDefinition');

const actor = new mongoose.Types.ObjectId();

// `new Model(...)` (unlike `.hydrate()`) runs casting and schema setters
// (`trim: true`), which is what these tests need to exercise — `.hydrate()`
// is for round-tripping data already known-valid from storage.
function buildDoc(overrides = {}) {
    return new ExpenseTypeDefinition({
        _id: new mongoose.Types.ObjectId(),
        name: 'Pulsa',
        normalizedName: 'pulsa',
        emoji: '📱',
        status: 'Active',
        createdBy: actor,
        updatedBy: actor,
        version: 1,
        schemaVersion: 1,
        ...overrides
    });
}

test('schema shape: collection, indexes, and lifecycle enum', () => {
    const schema = ExpenseTypeDefinition.schema;
    assert.equal(schema.options.collection, 'expensetypedefinitions');
    assert.equal(schema.options.timestamps, true);
    assert.deepEqual(
        schema.indexes().find(([, options]) => options && options.unique)?.[0],
        { normalizedName: 1 }
    );
    assert.deepEqual(schema.path('status').enumValues, ['Active', 'Archived']);
    assert.equal(schema.path('version').defaultValue, 1);
    assert.equal(schema.path('schemaVersion').defaultValue, 1);
});

test('a well-formed document validates cleanly', () => {
    const doc = buildDoc();
    assert.equal(doc.validateSync(), undefined);
});

test('name length is measured in code points, not UTF-16 units', () => {
    // A skin-tone-modified emoji is a single grapheme but two UTF-16 code
    // units in the name; only the grapheme-length rule matters here, and this
    // just needs to fit within 50 code points either way.
    const doc = buildDoc({ name: 'x'.repeat(50) });
    assert.equal(doc.validateSync(), undefined);
    const tooLong = buildDoc({ name: 'x'.repeat(51) });
    assert.ok(tooLong.validateSync().errors.name);
});

test('an empty name after trimming is rejected', () => {
    const doc = buildDoc({ name: '   ' });
    assert.ok(doc.validateSync().errors.name);
});

test('toDTO freezes an immutable snapshot with string ids', () => {
    const doc = buildDoc();
    const dto = doc.toDTO();
    assert.equal(dto.id, doc._id.toString());
    assert.equal(dto.createdBy, actor.toString());
    assert.equal(dto.name, 'Pulsa');
    assert.throws(() => { dto.name = 'Changed'; }, TypeError);
});
