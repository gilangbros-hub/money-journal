'use strict';

const express = require('express');
const pocketController = require('../controllers/pocketController');
const { asyncHandler } = require('../middleware/errorHandler');
const {
    requireAuthenticated,
    requireWife,
    requirePocketManagementFeature
} = require('../middleware/auth');

/**
 * Build the managed Pocket router with an injectable controller, mirroring the
 * budget/transaction routers so tests can exercise the real authentication,
 * feature-gate, and HTTP adapter without replacing module globals.
 *
 * Access model:
 *  - `requireAuthenticated` rejects unauthenticated clients before any handler.
 *  - `requirePocketManagementFeature` makes the whole managed surface (page and
 *    APIs) unavailable while the disabled-by-default primary flag is false.
 *  - Reads are available to any authenticated household member.
 *  - Mutations additionally require the Wife role in route middleware; the
 *    service enforces the same authorization as defense in depth.
 */
function createPocketRoutes({ controller = pocketController } = {}) {
    const router = express.Router();

    router.use(requireAuthenticated);
    router.use(requirePocketManagementFeature);

    // Page route (view-only for non-Wife members; the client requests data).
    router.get('/pocket-management', controller.getPocketManagementPage);

    // Read APIs — any authenticated household member.
    router.get('/api/pockets', asyncHandler(controller.listPockets));
    router.get('/api/pocket-assignments/setup', asyncHandler(controller.getAssignmentSetup));
    router.get('/api/expense-pocket-options', asyncHandler(controller.getExpensePocketOptions));

    // Mutation APIs — Wife role in middleware plus service defense in depth.
    router.post('/api/pockets', requireWife, asyncHandler(controller.createPocket));
    router.patch('/api/pockets/:pocketId', requireWife, asyncHandler(controller.updatePocket));
    router.post('/api/pockets/:pocketId/archive', requireWife, asyncHandler(controller.archivePocket));
    router.post('/api/pockets/:pocketId/restore', requireWife, asyncHandler(controller.restorePocket));
    router.post('/api/pocket-assignments/confirm', requireWife, asyncHandler(controller.confirmAssignments));
    router.delete('/api/pocket-assignments/:month/:pocketId', requireWife, asyncHandler(controller.removeAssignment));

    return router;
}

const router = createPocketRoutes();
router.createPocketRoutes = createPocketRoutes;

module.exports = router;
