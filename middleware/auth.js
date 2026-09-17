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

module.exports = {
    authLimiter,
    isApiRequest,
    requireAuthenticated,
    requireWife,
    requireSalaryCycleFeature
};
