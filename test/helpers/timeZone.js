'use strict';

const { Temporal } = require('@js-temporal/polyfill');
const { DEFAULT_HOUSEHOLD_TIME_ZONE, validateHouseholdTimeZone } = require('../../config');

function createTimeZoneContext(timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE) {
    const householdTimeZone = validateHouseholdTimeZone(timeZone);
    return Object.freeze({
        timeZone: householdTimeZone,
        householdTimeZone,
        toZonedDateTime(instant) {
            const value = instant instanceof Temporal.Instant
                ? instant
                : Temporal.Instant.from(instant);
            return value.toZonedDateTimeISO(householdTimeZone);
        },
        toPlainDate(instant) {
            return this.toZonedDateTime(instant).toPlainDate();
        }
    });
}

const createTestTimeZone = createTimeZoneContext;

module.exports = { createTimeZoneContext, createTestTimeZone };
