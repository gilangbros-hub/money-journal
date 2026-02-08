const Transaction = require('../models/transaction');
const { formatCurrency } = require('../utils/formatters');
const { TRANSACTION_TYPES } = require('../utils/constants');

/**
 * Aggregates transactions by category for the dashboard.
 * @param {Array} transactions - List of transaction objects.
 * @returns {Array} Sorted array of category summaries.
 */
const getCategoryBreakdown = (transactions) => {
    if (!transactions || transactions.length === 0) return [];

    const totalStats = transactions.reduce((acc, t) => {
        const type = t.type || 'Others';
        const amount = t.amount || 0;

        acc.totalSpent += amount;

        if (!acc.byCategory[type]) {
            acc.byCategory[type] = 0;
        }
        acc.byCategory[type] += amount;

        return acc;
    }, { totalSpent: 0, byCategory: {} });

    // Transform to array and calculate percentage
    const breakdown = Object.entries(totalStats.byCategory).map(([type, amount]) => {
        const percentage = totalStats.totalSpent > 0
            ? Math.round((amount / totalStats.totalSpent) * 100)
            : 0;

        return {
            category: type,
            icon: TRANSACTION_TYPES[type] || '📦',
            total: amount,
            formattedTotal: formatCurrency(amount),
            percentage: percentage
        };
    });

    // Sort by total amount descending
    return breakdown.sort((a, b) => b.total - a.total);
};

/**
 * calculateTotalExpenses
 * @param {Array} transactions 
 * @returns {Object} { raw: number, formatted: string }
 */
const calculateTotalExpenses = (transactions) => {
    const total = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    return {
        raw: total,
        formatted: formatCurrency(total)
    };
};

module.exports = {
    getCategoryBreakdown,
    calculateTotalExpenses
};
