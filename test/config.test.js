'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    ConfigurationError,
    createConfiguration,
    validateHouseholdTimeZone
} = require('../config');

test('configuration defaults to salary-cycle budgeting in Asia/Jakarta', () => {
    const configuration = createConfiguration({});

    assert.equal(configuration.householdTimeZone, DEFAULT_HOUSEHOLD_TIME_ZONE);
    assert.equal(configuration.salaryCycleBudgetingEnabled, true);
    assert.equal(configuration.featureFlags.salaryCycleBudgeting, true);
    assert.equal(createConfiguration({ SALARY_CYCLE_BUDGETING_ENABLED: '  ' }).salaryCycleBudgetingEnabled, true);
});

test('salary-cycle budgeting turns off only through an explicit off value', () => {
    for (const value of ['false', '0', 'no', 'off', 'unexpected']) {
        assert.equal(createConfiguration({ SALARY_CYCLE_BUDGETING_ENABLED: value }).salaryCycleBudgetingEnabled, false, value);
    }
});

test('configuration canonicalizes valid zones and accepts an explicit on value', () => {
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

test('expense type management flag defaults to disabled and enables only on a recognized truthy value', () => {
    const disabled = createConfiguration({});
    assert.equal(disabled.expenseTypeManagementEnabled, false);
    assert.equal(disabled.featureFlags.expenseTypeManagement, false);

    const enabled = createConfiguration({ EXPENSE_TYPE_MANAGEMENT_ENABLED: 'true' });
    assert.equal(enabled.expenseTypeManagementEnabled, true);
    assert.equal(enabled.featureFlags.expenseTypeManagement, true);

    const unexpected = createConfiguration({ EXPENSE_TYPE_MANAGEMENT_ENABLED: 'unexpected' });
    assert.equal(unexpected.expenseTypeManagementEnabled, false);
});

test('telegram bot flag defaults to disabled and enables only on a recognized truthy value; token/secret/username pass through as-is', () => {
    const disabled = createConfiguration({});
    assert.equal(disabled.telegramBotEnabled, false);
    assert.equal(disabled.featureFlags.telegramBot, false);
    assert.equal(disabled.telegramBotToken, '');
    assert.equal(disabled.telegramWebhookSecret, '');
    assert.equal(disabled.telegramBotUsername, '');

    const enabled = createConfiguration({
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: ' 123:ABC ',
        TELEGRAM_WEBHOOK_SECRET: ' shh ',
        TELEGRAM_BOT_USERNAME: '@MoneyJournalBot'
    });
    assert.equal(enabled.telegramBotEnabled, true);
    assert.equal(enabled.featureFlags.telegramBot, true);
    assert.equal(enabled.telegramBotToken, '123:ABC');
    assert.equal(enabled.telegramWebhookSecret, 'shh');
    assert.equal(enabled.telegramBotUsername, 'MoneyJournalBot');

    const unexpected = createConfiguration({ TELEGRAM_BOT_ENABLED: 'unexpected' });
    assert.equal(unexpected.telegramBotEnabled, false);
});
