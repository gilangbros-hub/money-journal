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
