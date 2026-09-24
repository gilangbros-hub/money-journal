const { Temporal } = require('@js-temporal/polyfill');
const { ConfigurationError } = require('./utils/domainErrors');

const DEFAULT_HOUSEHOLD_TIME_ZONE = 'Asia/Jakarta';
const FEATURE_FLAG_ENV_NAME = 'SALARY_CYCLE_BUDGETING_ENABLED';
const POCKET_MANAGEMENT_FLAG_ENV_NAME = 'POCKET_MANAGEMENT_ENABLED';
const POCKET_MANAGEMENT_DUAL_WRITE_ENV_NAME = 'POCKET_MANAGEMENT_DUAL_WRITE';
const EXPENSE_TYPE_MANAGEMENT_FLAG_ENV_NAME = 'EXPENSE_TYPE_MANAGEMENT_ENABLED';
const TELEGRAM_BOT_FLAG_ENV_NAME = 'TELEGRAM_BOT_ENABLED';
const ENABLED_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on']);

function invalidTimeZoneError(message, cause) {
    const error = new ConfigurationError('CONFIG_INVALID_TIME_ZONE', cause);
    error.field = 'HOUSEHOLD_TIME_ZONE';
    error.message = message;
    return error;
}

/**
 * Validate and canonicalize a configured IANA time-zone identifier.
 * Temporal also accepts fixed-offset zones, but this application requires a
 * named IANA zone so date classification remains tied to household rules.
 */
function validateHouseholdTimeZone(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw invalidTimeZoneError(
            'HOUSEHOLD_TIME_ZONE must be a recognized IANA time zone'
        );
    }

    const timeZone = value.trim();

    try {
        // `Temporal.Instant#toZonedDateTimeISO` validates named zones in both
        // current and older polyfill releases (where TimeZone.from differs).
        const temporalTimeZone = Temporal.Instant
            .from('2000-01-01T00:00:00Z')
            .toZonedDateTimeISO(timeZone);
        if (/^[+-]\d{2}(?::?\d{2})?$/.test(timeZone)) {
            throw new RangeError('Fixed-offset time zones are not supported');
        }
        return temporalTimeZone.timeZoneId;
    } catch (error) {
        if (error instanceof ConfigurationError) {
            throw error;
        }
        throw invalidTimeZoneError(
            `HOUSEHOLD_TIME_ZONE must be a recognized IANA time zone: ${timeZone}`,
            error
        );
    }
}

/**
 * Feature flags are opt-in. Unknown or empty values remain disabled so a
 * malformed deployment variable cannot enable a gated behavior.
 */
function parseFeatureFlag(value) {
    if (typeof value !== 'string') {
        return false;
    }
    return ENABLED_FLAG_VALUES.has(value.trim().toLowerCase());
}

/**
 * Salary-cycle budgeting is on by default: the Budget Month is derived from
 * the expense date, so Log Spending has no manual month picker. Setting the
 * variable to a recognized off value ('0', 'false', 'no', 'off') brings the
 * legacy picker back; any other set value still goes through the opt-in
 * parser, so a malformed value leaves it off.
 */
function parseSalaryCycleFeatureFlag(value) {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        return true;
    }
    return parseFeatureFlag(value);
}

/**
 * Pocket Management (and its dual-write compatibility stage) is disabled by
 * default. The primary flag gates the managed routes and reads; the dual-write
 * flag only has meaning once the primary flag is enabled.
 */
function parsePocketManagementFeatureFlag(value) {
    return parseFeatureFlag(value);
}

/**
 * Expense Type Management is disabled by default, same fail-closed rule as
 * Pocket Management: an absent or malformed flag keeps the managed routes and
 * the transaction-time type check off, never on by accident.
 */
function parseExpenseTypeManagementFeatureFlag(value) {
    return parseFeatureFlag(value);
}

/**
 * The Telegram bot webhook is disabled by default: without an explicit flag,
 * a live TELEGRAM_BOT_TOKEN sitting in the environment (e.g. mid-setup)
 * never turns the public webhook route on by accident.
 */
function parseTelegramBotFeatureFlag(value) {
    return parseFeatureFlag(value);
}

function createConfiguration(environment = process.env) {
    const configuredTimeZone = environment.HOUSEHOLD_TIME_ZONE;
    const householdTimeZone = validateHouseholdTimeZone(
        configuredTimeZone == null || configuredTimeZone.trim?.() === ''
            ? DEFAULT_HOUSEHOLD_TIME_ZONE
            : configuredTimeZone
    );
    const salaryCycleBudgetingEnabled = parseSalaryCycleFeatureFlag(
        environment[FEATURE_FLAG_ENV_NAME]
    );
    const pocketManagementEnabled = parsePocketManagementFeatureFlag(
        environment[POCKET_MANAGEMENT_FLAG_ENV_NAME]
    );
    const pocketManagementDualWriteEnabled = parsePocketManagementFeatureFlag(
        environment[POCKET_MANAGEMENT_DUAL_WRITE_ENV_NAME]
    );
    const expenseTypeManagementEnabled = parseExpenseTypeManagementFeatureFlag(
        environment[EXPENSE_TYPE_MANAGEMENT_FLAG_ENV_NAME]
    );
    const telegramBotEnabled = parseTelegramBotFeatureFlag(
        environment[TELEGRAM_BOT_FLAG_ENV_NAME]
    );
    const telegramBotToken = typeof environment.TELEGRAM_BOT_TOKEN === 'string'
        ? environment.TELEGRAM_BOT_TOKEN.trim()
        : '';
    const telegramWebhookSecret = typeof environment.TELEGRAM_WEBHOOK_SECRET === 'string'
        ? environment.TELEGRAM_WEBHOOK_SECRET.trim()
        : '';
    // Display-only (e.g. "message @MoneyJournalBot"), never used for auth.
    const telegramBotUsername = typeof environment.TELEGRAM_BOT_USERNAME === 'string'
        ? environment.TELEGRAM_BOT_USERNAME.trim().replace(/^@/, '')
        : '';

    const featureFlags = Object.freeze({
        salaryCycleBudgeting: salaryCycleBudgetingEnabled,
        pocketManagement: pocketManagementEnabled,
        pocketManagementDualWrite: pocketManagementDualWriteEnabled,
        expenseTypeManagement: expenseTypeManagementEnabled,
        telegramBot: telegramBotEnabled
    });

    return Object.freeze({
        householdTimeZone,
        salaryCycleBudgetingEnabled,
        pocketManagementEnabled,
        pocketManagementDualWriteEnabled,
        expenseTypeManagementEnabled,
        // The bot is only truly usable once the flag is on AND a token is
        // configured; callers that need "should the webhook actually do
        // anything" should check both (see routes/telegram.js).
        telegramBotEnabled,
        telegramBotToken,
        telegramWebhookSecret,
        telegramBotUsername,
        featureFlags
    });
}

module.exports = {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    FEATURE_FLAG_ENV_NAME,
    POCKET_MANAGEMENT_FLAG_ENV_NAME,
    POCKET_MANAGEMENT_DUAL_WRITE_ENV_NAME,
    EXPENSE_TYPE_MANAGEMENT_FLAG_ENV_NAME,
    TELEGRAM_BOT_FLAG_ENV_NAME,
    ConfigurationError,
    createConfiguration,
    parseSalaryCycleFeatureFlag,
    parsePocketManagementFeatureFlag,
    parseExpenseTypeManagementFeatureFlag,
    parseTelegramBotFeatureFlag,
    validateHouseholdTimeZone
};
