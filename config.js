const { Temporal } = require('@js-temporal/polyfill');
const { ConfigurationError } = require('./utils/domainErrors');

const DEFAULT_HOUSEHOLD_TIME_ZONE = 'Asia/Jakarta';
const FEATURE_FLAG_ENV_NAME = 'SALARY_CYCLE_BUDGETING_ENABLED';
const POCKET_MANAGEMENT_FLAG_ENV_NAME = 'POCKET_MANAGEMENT_ENABLED';
const POCKET_MANAGEMENT_DUAL_WRITE_ENV_NAME = 'POCKET_MANAGEMENT_DUAL_WRITE';
const EXPENSE_TYPE_MANAGEMENT_FLAG_ENV_NAME = 'EXPENSE_TYPE_MANAGEMENT_ENABLED';
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
 * Salary-cycle writes stay disabled unless a recognized truthy flag is set.
 */
function parseSalaryCycleFeatureFlag(value) {
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

    const featureFlags = Object.freeze({
        salaryCycleBudgeting: salaryCycleBudgetingEnabled,
        pocketManagement: pocketManagementEnabled,
        pocketManagementDualWrite: pocketManagementDualWriteEnabled,
        expenseTypeManagement: expenseTypeManagementEnabled
    });

    return Object.freeze({
        householdTimeZone,
        salaryCycleBudgetingEnabled,
        pocketManagementEnabled,
        pocketManagementDualWriteEnabled,
        expenseTypeManagementEnabled,
        featureFlags
    });
}

module.exports = {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    FEATURE_FLAG_ENV_NAME,
    POCKET_MANAGEMENT_FLAG_ENV_NAME,
    POCKET_MANAGEMENT_DUAL_WRITE_ENV_NAME,
    EXPENSE_TYPE_MANAGEMENT_FLAG_ENV_NAME,
    ConfigurationError,
    createConfiguration,
    parseSalaryCycleFeatureFlag,
    parsePocketManagementFeatureFlag,
    parseExpenseTypeManagementFeatureFlag,
    validateHouseholdTimeZone
};
