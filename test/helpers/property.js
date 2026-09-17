'use strict';

const fc = require('fast-check');

const PROPERTY_NUM_RUNS = 100;

/**
 * Shared fast-check options. fast-check includes the seed, shrink path, and
 * counterexample in failed assertions; keeping verbose reporting enabled
 * makes those replay values visible in Node's test output.
 */
function propertyOptions(overrides = {}) {
    return {
        numRuns: PROPERTY_NUM_RUNS,
        endOnFailure: true,
        verbose: true,
        ...overrides
    };
}

function assertProperty(property, overrides = {}) {
    return fc.assert(property, propertyOptions(overrides));
}

async function assertAsyncProperty(property, overrides = {}) {
    return fc.assert(property, propertyOptions(overrides));
}

module.exports = {
    PROPERTY_NUM_RUNS,
    propertyOptions,
    assertProperty,
    assertAsyncProperty
};
