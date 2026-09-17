'use strict';

const { Temporal } = require('@js-temporal/polyfill');
const { validateHouseholdTimeZone } = require('../../config');

function toInstant(value) {
    if (value instanceof Temporal.Instant) return value;
    if (value instanceof Date) return Temporal.Instant.fromEpochMilliseconds(value.getTime());
    return Temporal.Instant.from(value);
}

/**
 * Create a deterministic clock for services that need an exact instant.
 * Date-only decisions should use localDate(), never Date getters.
 */
function createInjectedClock({ nowInstant = '2027-01-25T00:00:00Z', timeZone = 'Asia/Jakarta' } = {}) {
    const zone = validateHouseholdTimeZone(timeZone);
    let current = toInstant(nowInstant);

    return {
        get timeZone() { return zone; },
        nowInstant() { return current; },
        now() { return current; },
        nowDate() { return new Date(current.epochMilliseconds); },
        localDate(targetTimeZone = zone) {
            const targetZone = validateHouseholdTimeZone(targetTimeZone);
            return current.toZonedDateTimeISO(targetZone).toPlainDate();
        },
        setNow(nextInstant) {
            current = toInstant(nextInstant);
            return current;
        },
        advance(duration) {
            current = current.add(Temporal.Duration.from(duration));
            return current;
        }
    };
}

const createFixedClock = createInjectedClock;

module.exports = { createInjectedClock, createFixedClock, toInstant };
