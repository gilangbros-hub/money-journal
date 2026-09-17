'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    isPocketManagementEnabled,
    requirePocketManagementEnabled,
    isPocketManagementDualWriteEnabled
} = require('../utils/rollout');
const { FeatureDisabledError } = require('../utils/domainErrors');

test('pocket management rollout fails closed when no flag is injected', () => {
    assert.equal(isPocketManagementEnabled(), false);
    assert.equal(isPocketManagementEnabled({}, {}), false);
    assert.equal(isPocketManagementDualWriteEnabled(), false);
});

test('pocket management enablement reads options first, then actor', () => {
    assert.equal(isPocketManagementEnabled({ pocketManagementEnabled: true }), true);
    assert.equal(isPocketManagementEnabled({}, { pocketManagementEnabled: true }), true);
    assert.equal(
        isPocketManagementEnabled({ pocketManagementEnabled: false }, { pocketManagementEnabled: true }),
        false
    );
});

test('requiring pocket management throws a feature-disabled error while off', () => {
    assert.throws(
        () => requirePocketManagementEnabled({}, {}),
        error => error instanceof FeatureDisabledError
    );
    assert.equal(requirePocketManagementEnabled({ pocketManagementEnabled: true }), true);
});

test('dual write stays off unless both the primary flag and dual-write flag are on', () => {
    assert.equal(
        isPocketManagementDualWriteEnabled({ pocketManagementDualWriteEnabled: true }),
        false
    );
    assert.equal(
        isPocketManagementDualWriteEnabled({
            pocketManagementEnabled: true,
            pocketManagementDualWriteEnabled: true
        }),
        true
    );
    assert.equal(
        isPocketManagementDualWriteEnabled({
            pocketManagementEnabled: true,
            pocketManagementDualWriteEnabled: false
        }),
        false
    );
    assert.equal(
        isPocketManagementDualWriteEnabled(
            { pocketManagementEnabled: true },
            { pocketManagementDualWriteEnabled: true }
        ),
        true
    );
});
