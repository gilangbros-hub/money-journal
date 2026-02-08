const express = require('express');
const router = express.Router();
const budgetController = require('../controllers/budgetController');

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) return next();
    if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Please login' });
    }
    res.redirect('/login');
};

router.use(isAuthenticated);

// Page routes
router.get('/budget', budgetController.getBudgetPage);

// API routes
router.get('/api/budget', budgetController.getBudgets);
router.get('/api/budget/history', budgetController.getBudgetHistory);
router.post('/api/budget', budgetController.saveBudget);
router.delete('/api/budget/:id', budgetController.deleteBudget);

module.exports = router;
