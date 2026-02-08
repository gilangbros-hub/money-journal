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

// Assuming requireAuth is the same as isAuthenticated for this context,
// or that it's a specific middleware that needs to be defined.
// For now, we'll use isAuthenticated as requireAuth is not defined in the original document.
// If requireAuth is a distinct middleware, it should be defined or imported.
const requireAuth = isAuthenticated; // Placeholder: replace with actual requireAuth if different

router.use(isAuthenticated);

router.get('/transaction', transactionController.getTransactionPage);
router.get('/transactions', transactionController.getTransactionsPage);

router.post('/api/transaction', transactionController.createTransaction);// API
router.get('/api/dashboard/summary', requireAuth, transactionController.getDashboardSummary);
router.get('/api/transactions', requireAuth, transactionController.getAllTransactions);
router.get('/api/transaction/:id', transactionController.getTransaction);
router.put('/api/transaction/:id', transactionController.updateTransaction);
router.delete('/api/transaction/:id', transactionController.deleteTransaction);
router.get('/api/submitters', transactionController.getSubmitters);

module.exports = router;
