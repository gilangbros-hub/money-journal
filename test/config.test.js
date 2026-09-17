'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    ConfigurationError,
    createConfiguration,
    validateHouseholdTimeZone
} = require('../config');

test('configuration defaults to a disabled salary-cycle rollout in Asia/Jakarta', () => {
    const configuration = createConfiguration({});

    assert.equal(configuration.householdTimeZone, DEFAULT_HOUSEHOLD_TIME_ZONE);
    assert.equal(configuration.salaryCycleBudgetingEnabled, false);
    assert.equal(configuration.featureFlags.salaryCycleBudgeting, false);
});

test('configuration canonicalizes valid zones and enables the flag only explicitly', () => {
    const configuration = createConfiguration({
        HOUSEHOLD_TIME_ZONE: ' UTC ',
        SALARY_CYCLE_BUDGETING_ENABLED: 'true'
    });

    assert.equal(configuration.householdTimeZone, 'UTC');
    assert.equal(configuration.salaryCycleBudgetingEnabled, true);
    assert.equal(createConfiguration({ SALARY_CYCLE_BUDGETING_ENABLED: 'unexpected' })
        .salaryCycleBudgetingEnabled, false);
    assert.equal(validateHouseholdTimeZone('Asia/Jakarta'), 'Asia/Jakarta');
});

test('pocket management flags default to disabled', () => {
    const configuration = createConfiguration({});

    assert.equal(configuration.pocketManagementEnabled, false);
    assert.equal(configuration.pocketManagementDualWriteEnabled, false);
    assert.equal(configuration.featureFlags.pocketManagement, false);
    assert.equal(configuration.featureFlags.pocketManagementDualWrite, false);
});

test('pocket management flags enable only on recognized truthy values', () => {
    const enabled = createConfiguration({
        POCKET_MANAGEMENT_ENABLED: 'on',
        POCKET_MANAGEMENT_DUAL_WRITE: '1'
    });

    assert.equal(enabled.pocketManagementEnabled, true);
    assert.equal(enabled.pocketManagementDualWriteEnabled, true);
    assert.equal(enabled.featureFlags.pocketManagement, true);
    assert.equal(enabled.featureFlags.pocketManagementDualWrite, true);

    const unexpected = createConfiguration({
        POCKET_MANAGEMENT_ENABLED: 'unexpected',
        POCKET_MANAGEMENT_DUAL_WRITE: 'maybe'
    });

    assert.equal(unexpected.pocketManagementEnabled, false);
    assert.equal(unexpected.pocketManagementDualWriteEnabled, false);
});

test('invalid or fixed-offset zones fail with a field-specific configuration error', () => {
    for (const value of ['Not/AZone', '+07:00', '', null]) {
        assert.throws(
            () => validateHouseholdTimeZone(value),
            error => error instanceof ConfigurationError &&
                error.code === 'CONFIG_INVALID_TIME_ZONE' &&
                error.field === 'HOUSEHOLD_TIME_ZONE'
        );
    }
});
