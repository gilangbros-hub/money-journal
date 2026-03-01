const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) return next();
    if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(401).json({ error: "Please login" });
    }
    res.redirect('/login');
};

router.use(isAuthenticated);

router.get('/transaction', transactionController.getTransactionPage);
router.get('/transactions', transactionController.getTransactionsPage);

router.post('/api/transaction', transactionController.createTransaction);// API
router.get('/api/dashboard/summary', transactionController.getDashboardSummary);
router.get('/api/transactions', transactionController.getAllTransactions);
router.get('/api/transaction/:id', transactionController.getTransaction);
router.put('/api/transaction/:id', transactionController.updateTransaction);
router.delete('/api/transaction/:id', transactionController.deleteTransaction);
router.get('/api/submitters', transactionController.getSubmitters);

// TEMPORARY: One-time migration endpoint - remove after running
router.post('/api/migrate-budget-month', async (req, res) => {
    try {
        const Transaction = require('../models/transaction');
        const result = await Transaction.updateMany(
            { $or: [{ budgetMonth: { $exists: false } }, { budgetYear: { $exists: false } }] },
            { $set: { budgetMonth: 3, budgetYear: 2026 } }
        );
        res.json({ success: true, modified: result.modifiedCount, message: `${result.modifiedCount} transactions migrated to March 2026` });
    } catch (error) {
        console.error('Migration error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
