'use strict';

const rateLimit = require('express-rate-limit');
const { AuthenticationError, AuthorizationError, FeatureDisabledError } = require('../utils/domainErrors');

/**
 * Rate limiter for authentication endpoints
 * Limits each IP to 20 requests per 15-minute window
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many login/register attempts from this IP, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
});

function isApiRequest(req) {
    return req.xhr || req.path.startsWith('/api/');
}

/**
 * Preserve the existing page redirect while routing API failures through the
 * common safe error adapter.
 */
function requireAuthenticated(req, res, next) {
    if (req.session?.userId) return next();
    if (isApiRequest(req)) return next(new AuthenticationError());
    return res.redirect('/login');
}

function requireWife(req, res, next) {
    if (!req.session?.userId) return next(new AuthenticationError());
    if (req.session.role !== 'Wife') return next(new AuthorizationError('Wife'));
    return next();
}

function requireSalaryCycleFeature(req, res, next) {
    if (req.app?.locals?.configuration?.salaryCycleBudgetingEnabled === true) return next();
    return next(new FeatureDisabledError());
}

/**
 * Gate the managed Pocket Management surface (page and APIs) on the primary,
 * disabled-by-default `POCKET_MANAGEMENT_ENABLED` flag. Managed routes must be
 * unavailable while the flag is false; the service enforces the same rule as
 * defense in depth. The distinct feature name yields the pocket-management
 * feature-disabled code so clients can tell it apart from salary-cycle.
 */
function requirePocketManagementFeature(req, res, next) {
    if (req.app?.locals?.configuration?.pocketManagementEnabled === true) return next();
    return next(new FeatureDisabledError('pocket management'));
}

/**
 * Same gate as Pocket Management, for the Expense Type Management surface.
 */
function requireExpenseTypeManagementFeature(req, res, next) {
    if (req.app?.locals?.configuration?.expenseTypeManagementEnabled === true) return next();
    return next(new FeatureDisabledError('expense type management'));
}

module.exports = {
    authLimiter,
    isApiRequest,
    requireAuthenticated,
    requireWife,
    requireSalaryCycleFeature,
    requirePocketManagementFeature,
    requireExpenseTypeManagementFeature
};
