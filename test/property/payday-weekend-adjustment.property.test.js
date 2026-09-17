'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { getActualPayday } = require('../../services/salaryCycleResolver');
const {
    monthArbitrary,
    yearArbitrary
} = require('../arbitraries');
const {
    assertProperty,
    propertyOptions
} = require('../helpers');

// Feature: salary-cycle-budgeting, Property 1: Payday weekend adjustment
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

test('Property 1: payday adjusts the nominal 25th backward only for weekends', () => {
    assertProperty(
        fc.property(yearArbitrary, monthArbitrary, (year, month) => {
            const expected = independentPaydayOracle(year, month);
            const actual = getActualPayday({
                year,
                month,
                timeZone: 'Asia/Jakarta'
            });

            assert.equal(actual, expected.date);
            assert.equal(actual.slice(0, 4), String(year).padStart(4, '0'));
            assert.equal(actual.slice(5, 7), String(month).padStart(2, '0'));
            assert.ok(
                expected.dayOfWeek >= 1 && expected.dayOfWeek <= 5
                    ? actual.endsWith('-25')
                    : expected.dayOfWeek === 6
                        ? actual.endsWith('-24')
                        : actual.endsWith('-23')
            );
        }),
        propertyOptions({
            numRuns: 100
        })
    );
});

/**
 * Independent Gregorian oracle: JavaScript's UTC calendar implementation
 * supplies the nominal weekday, while the expected date is formatted from
 * the explicit UTC components. This does not reuse Temporal or resolver code.
 */
function independentPaydayOracle(year, month) {
    const nominal = new globalThis.Date(Date.UTC(year, month - 1, 25));
    const dayOfWeek = nominal.getUTCDay(); // Sunday = 0, Monday = 1, ..., Saturday = 6.
    const daysToSubtract = dayOfWeek === 6 ? 1 : dayOfWeek === 0 ? 2 : 0;
    const actual = new globalThis.Date(
        Date.UTC(year, month - 1, 25 - daysToSubtract)
    );

    return {
        dayOfWeek,
        date: actual.toISOString().slice(0, 10)
    };
}
