'use strict';

const express = require('express');
const transactionController = require('../controllers/transactionController');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuthenticated } = require('../middleware/auth');

/**
 * Build the transaction router with an injectable controller. Production keeps
 * the established singleton router while route tests can exercise the real
 * authentication and HTTP adapter without replacing module globals.
 */
function createTransactionRoutes({ controller = transactionController } = {}) {
    const router = express.Router();

    router.use(requireAuthenticated);

    router.get('/log-spending', controller.getTransactionPage);
    router.get('/monthly-story', controller.getTransactionsPage);
    router.get('/review-history', controller.getAllTransactionsPage);

    router.get('/api/salary-cycle/assignment', asyncHandler(controller.getAssignmentPreview));

    router.post('/api/transaction', asyncHandler(controller.createTransaction));
    router.get('/api/dashboard/summary', asyncHandler(controller.getDashboardSummary));
    router.get('/api/history', asyncHandler(controller.getHistory || controller.getAllTransactions));
    router.get('/api/transactions', asyncHandler(controller.getAllTransactions));
    router.get('/api/transaction/:id', asyncHandler(controller.getTransaction));
    router.put('/api/transaction/:id', asyncHandler(controller.updateTransaction));
    router.delete('/api/transaction/:id', asyncHandler(controller.deleteTransaction));
    router.get('/api/submitters', asyncHandler(controller.getSubmitters));

    return router;
}

const router = createTransactionRoutes();
router.createTransactionRoutes = createTransactionRoutes;

module.exports = router;
