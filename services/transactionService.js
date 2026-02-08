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
 * Aggregates transactions by paidBy role.
 * @param {Array} transactions 
 * @returns {Array} [{ role: 'Husband', total: 1000, percentage: 50 }, ...]
 */
const getRoleBreakdown = (transactions) => {
    if (!transactions || transactions.length === 0) return [];

    const totalSpent = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const roleStats = transactions.reduce((acc, t) => {
        const role = t.paidBy || 'Self';
        acc[role] = (acc[role] || 0) + (t.amount || 0);
        return acc;
    }, {});

    // Ensure all roles exist for chart consistency (optional, but good for pie chart)
    const roles = ['Husband', 'Wife', 'Self'];

    return roles.map(role => {
        const amount = roleStats[role] || 0;
        return {
            role,
            total: amount,
            formattedTotal: formatCurrency(amount),
            percentage: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0
        };
    }).filter(r => r.total > 0 || roleStats[r.role] !== undefined); // Show only if data exists or standard roles
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
    getRoleBreakdown,
    calculateTotalExpenses
};
