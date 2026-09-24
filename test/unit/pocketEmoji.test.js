'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePocketEmoji } = require('../../services/pocketValidation');

test('keycap emoji are accepted as a single emoji', () => {
    for (const keycap of ['1️⃣', '#️⃣', '*️⃣', '0⃣']) {
        assert.equal(validatePocketEmoji(keycap), keycap);
    }
});

test('plain digits and symbols are still rejected', () => {
    for (const value of ['1', '#', '*', 'A']) {
        assert.throws(() => validatePocketEmoji(value), /single emoji character/);
    }
});

test('two keycaps count as two emoji', () => {
    assert.throws(() => validatePocketEmoji('1️⃣2️⃣'), /exactly one emoji/);
});
