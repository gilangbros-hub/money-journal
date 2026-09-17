'use strict';

const DEFAULT_FEATURE_FLAGS = Object.freeze({
    salaryCycleBudgeting: false
});

function createFeatureFlags(overrides = {}) {
    const values = { ...DEFAULT_FEATURE_FLAGS, ...overrides };
    return Object.freeze({
        ...values,
        isEnabled(name) { return values[name] === true; },
        enabled(name) { return values[name] === true; }
    });
}

function createFeatureFlagController(initial = {}) {
    const values = { ...DEFAULT_FEATURE_FLAGS, ...initial };
    return {
        isEnabled(name) { return values[name] === true; },
        enabled(name) { return values[name] === true; },
        get(name) { return values[name] === true; },
        set(name, enabled) {
            values[name] = enabled === true;
            return values[name];
        },
        snapshot() { return Object.freeze({ ...values }); }
    };
}

module.exports = {
    DEFAULT_FEATURE_FLAGS,
    createFeatureFlags,
    createFeatureFlagController
};
