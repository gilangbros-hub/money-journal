'use strict';

const { FeatureDisabledError } = require('./domainErrors');

/**
 * Resolve the rollout flag from injected dependencies. Services default to
 * enabled for direct/library callers so existing consumers keep their current
 * behavior; HTTP adapters always inject the validated application setting.
 */
function isSalaryCycleEnabled(options = {}, actor = {}) {
    if (typeof options.salaryCycleBudgetingEnabled === 'boolean') {
        return options.salaryCycleBudgetingEnabled;
    }
    if (typeof options.featureEnabled === 'boolean') return options.featureEnabled;
    if (typeof actor.salaryCycleBudgetingEnabled === 'boolean') {
        return actor.salaryCycleBudgetingEnabled;
    }
    if (typeof actor.featureEnabled === 'boolean') return actor.featureEnabled;
    return true;
}

function requireSalaryCycleEnabled(options = {}, actor = {}) {
    if (!isSalaryCycleEnabled(options, actor)) {
        throw new FeatureDisabledError();
    }
    return true;
}

module.exports = { isSalaryCycleEnabled, requireSalaryCycleEnabled };
