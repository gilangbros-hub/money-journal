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

router.post('/api/transaction', transactionController.createTransaction);
router.get('/api/transactions', transactionController.getAllTransactions);
router.get('/api/transaction/:id', transactionController.getTransaction);
router.put('/api/transaction/:id', transactionController.updateTransaction);
router.delete('/api/transaction/:id', transactionController.deleteTransaction);
router.get('/api/submitters', transactionController.getSubmitters);

module.exports = router;
