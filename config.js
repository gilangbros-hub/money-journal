const { Temporal } = require('@js-temporal/polyfill');
const { ConfigurationError } = require('./utils/domainErrors');

const DEFAULT_HOUSEHOLD_TIME_ZONE = 'Asia/Jakarta';
const FEATURE_FLAG_ENV_NAME = 'SALARY_CYCLE_BUDGETING_ENABLED';
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
 * malformed deployment variable cannot enable salary-cycle writes.
 */
function parseSalaryCycleFeatureFlag(value) {
    if (typeof value !== 'string') {
        return false;
    }
    return ENABLED_FLAG_VALUES.has(value.trim().toLowerCase());
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

    const featureFlags = Object.freeze({
        salaryCycleBudgeting: salaryCycleBudgetingEnabled
    });

    return Object.freeze({
        householdTimeZone,
        salaryCycleBudgetingEnabled,
        featureFlags
    });
}

module.exports = {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    FEATURE_FLAG_ENV_NAME,
    ConfigurationError,
    createConfiguration,
    parseSalaryCycleFeatureFlag,
    validateHouseholdTimeZone
};
