'use strict';

const express = require('express');
const budgetController = require('../controllers/budgetController');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuthenticated, requireWife, requireSalaryCycleFeature } = require('../middleware/auth');

/**
 * Build the budget router with an injectable controller. The production
 * singleton preserves the existing route surface, while tests and callers
 * can exercise the HTTP contract without replacing module globals.
 */
function createBudgetRoutes({ controller = budgetController } = {}) {
    const router = express.Router();

    router.use(requireAuthenticated);

    // Page routes
    router.get('/check-pockets', controller.getBudgetPage);

    // Read APIs are available to every authenticated household member.
    router.get('/api/budget', asyncHandler(controller.getBudgets));
    router.get('/api/budget/history', asyncHandler(controller.getBudgetHistory));
    router.get('/api/budget/closed-months', asyncHandler(controller.getClosedMonths));

    // Keep the legacy monthly command and typed compatibility delete while
    // exposing explicit cadence-aware commands for the new client.
    router.post('/api/budget', requireWife, asyncHandler(controller.saveBudget));
    router.put('/api/budget/cadence', requireWife, requireSalaryCycleFeature, asyncHandler(controller.setCadence));
    router.put('/api/budget/allocation/monthly', requireWife, asyncHandler(controller.putMonthlyAllocation));
    router.put('/api/budget/allocation/weekly', requireWife, requireSalaryCycleFeature, asyncHandler(controller.putWeeklyAllocation));
    router.post('/api/budget/toggle-month-close', requireWife, asyncHandler(controller.toggleMonthClosed));
    router.delete('/api/budget/allocation/:type/:id', requireWife, (req, res, next) => {
        if (String(req.params.type).toLowerCase() === 'weekly') {
            return requireSalaryCycleFeature(req, res, next);
        }
        return next();
    }, asyncHandler(controller.deleteAllocation));
    router.delete('/api/budget/:id', requireWife, asyncHandler(controller.deleteBudget));

    return router;
}

const router = createBudgetRoutes();
router.createBudgetRoutes = createBudgetRoutes;

module.exports = router;
