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

/**
 * Pocket Management is a new, migration-gated capability, so its rollout flag
 * fails closed: absent an explicit boolean it resolves to disabled. HTTP
 * adapters inject the validated application setting; managed routes and reads
 * must stay unavailable while this primary flag is false.
 */
function isPocketManagementEnabled(options = {}, actor = {}) {
    if (typeof options.pocketManagementEnabled === 'boolean') {
        return options.pocketManagementEnabled;
    }
    if (typeof actor.pocketManagementEnabled === 'boolean') {
        return actor.pocketManagementEnabled;
    }
    return false;
}

function requirePocketManagementEnabled(options = {}, actor = {}) {
    if (!isPocketManagementEnabled(options, actor)) {
        throw new FeatureDisabledError('pocket management');
    }
    return true;
}

/**
 * The dual-write compatibility stage only has meaning once the primary Pocket
 * Management flag is enabled, so it fails closed and stays off whenever the
 * primary flag is off.
 */
function isPocketManagementDualWriteEnabled(options = {}, actor = {}) {
    if (!isPocketManagementEnabled(options, actor)) {
        return false;
    }
    if (typeof options.pocketManagementDualWriteEnabled === 'boolean') {
        return options.pocketManagementDualWriteEnabled;
    }
    if (typeof actor.pocketManagementDualWriteEnabled === 'boolean') {
        return actor.pocketManagementDualWriteEnabled;
    }
    return false;
}

/**
 * Expense Type Management follows the same fail-closed rule as Pocket
 * Management: absent an explicit boolean it resolves to disabled. HTTP
 * adapters inject the validated application setting; managed routes and the
 * transaction-time type check must stay unavailable while this flag is false.
 */
function isExpenseTypeManagementEnabled(options = {}, actor = {}) {
    if (typeof options.expenseTypeManagementEnabled === 'boolean') {
        return options.expenseTypeManagementEnabled;
    }
    if (typeof actor.expenseTypeManagementEnabled === 'boolean') {
        return actor.expenseTypeManagementEnabled;
    }
    return false;
}

function requireExpenseTypeManagementEnabled(options = {}, actor = {}) {
    if (!isExpenseTypeManagementEnabled(options, actor)) {
        throw new FeatureDisabledError('expense type management');
    }
    return true;
}

module.exports = {
    isSalaryCycleEnabled,
    requireSalaryCycleEnabled,
    isPocketManagementEnabled,
    requirePocketManagementEnabled,
    isPocketManagementDualWriteEnabled,
    isExpenseTypeManagementEnabled,
    requireExpenseTypeManagementEnabled
};
