'use strict';

const express = require('express');
const expenseTypeController = require('../controllers/expenseTypeController');
const { asyncHandler } = require('../middleware/errorHandler');
const {
    requireAuthenticated,
    requireWife,
    requireExpenseTypeManagementFeature
} = require('../middleware/auth');

/**
 * Build the managed Expense Type router with an injectable controller,
 * mirroring routes/pockets.js.
 *
 * Access model:
 *  - `requireAuthenticated` rejects unauthenticated clients before any handler.
 *  - `requireExpenseTypeManagementFeature` makes the whole surface (page and
 *    APIs) unavailable while the disabled-by-default primary flag is false.
 *  - Reads are available to any authenticated household member.
 *  - Mutations additionally require the Wife role in route middleware; the
 *    service enforces the same authorization as defense in depth.
 */
function createExpenseTypeRoutes({ controller = expenseTypeController } = {}) {
    const router = express.Router();

    router.use(requireAuthenticated);
    router.use(requireExpenseTypeManagementFeature);

    router.get('/expense-type-management', controller.getExpenseTypeManagementPage);

    router.get('/api/expense-types', asyncHandler(controller.listTypes));

    router.post('/api/expense-types', requireWife, asyncHandler(controller.createType));
    router.patch('/api/expense-types/:typeId', requireWife, asyncHandler(controller.updateType));
    router.post('/api/expense-types/:typeId/archive', requireWife, asyncHandler(controller.archiveType));
    router.post('/api/expense-types/:typeId/restore', requireWife, asyncHandler(controller.restoreType));

    return router;
}

const router = createExpenseTypeRoutes();
router.createExpenseTypeRoutes = createExpenseTypeRoutes;

module.exports = router;
