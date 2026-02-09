const PocketBudget = require('../models/pocketBudget');
const { POCKETS } = require('../utils/constants');
const { formatCurrency } = require('../utils/formatters');

// Helper: Check if month is editable (current or next month only)
const isEditableMonth = (month, year) => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Current month
    if (year === currentYear && month === currentMonth) return true;

    // Next month (handles year boundary)
    if (currentMonth === 12) {
        return year === currentYear + 1 && month === 1;
    }
    return year === currentYear && month === currentMonth + 1;
};

// GET /budget - Render budget page
exports.getBudgetPage = (req, res) => {
    res.render('budget', {
        username: req.session.username,
        avatar: req.session.avatar || '👤',
        role: req.session.role,
        canEdit: req.session.role === 'Wife',
        isBudget: true
    });
};

// GET /api/budget?month=YYYY-MM - Get budgets for a specific month with spending data
exports.getBudgets = async (req, res) => {
    try {
        const { month } = req.query;
        const Transaction = require('../models/transaction');

        let targetMonth, targetYear;

        if (month) {
            const [y, m] = month.split('-');
            targetYear = parseInt(y);
            targetMonth = parseInt(m);
        } else {
            const now = new Date();
            targetMonth = now.getMonth() + 1;
            targetYear = now.getFullYear();
        }

        // Date range for the month
        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

        // Fetch budgets and transactions in parallel
        const [budgets, transactions] = await Promise.all([
            PocketBudget.find({ month: targetMonth, year: targetYear }).sort({ pocket: 1 }),
            Transaction.find({ date: { $gte: startDate, $lte: endDate } })
        ]);

        // Calculate spending per pocket
        const pocketSpending = {};
        transactions.forEach(t => {
            pocketSpending[t.pocket] = (pocketSpending[t.pocket] || 0) + t.amount;
        });

        // Build budget map
        const budgetMap = {};
        budgets.forEach(b => { budgetMap[b.pocket] = b; });

        // Build response with all pockets
        const allPockets = Object.keys(POCKETS);
        const result = allPockets.map(pocket => {
            const budget = budgetMap[pocket]?.budget || 0;
            const spent = pocketSpending[pocket] || 0;
            const remaining = budget - spent;
            const percentage = budget > 0 ? Math.round((spent / budget) * 100) : 0;

            // Determine status color
            let status = 'good'; // green
            if (percentage >= 90) status = 'danger'; // red
            else if (percentage >= 70) status = 'warning'; // yellow

            return {
                pocket,
                icon: POCKETS[pocket],
                budget,
                formattedBudget: formatCurrency(budget),
                spent,
                formattedSpent: formatCurrency(spent),
                remaining,
                formattedRemaining: formatCurrency(Math.abs(remaining)),
                percentage,
                status,
                isOver: remaining < 0,
                _id: budgetMap[pocket]?._id || null
            };
        });

        // Calculate totals for health summary
        const totalBudget = result.reduce((sum, p) => sum + p.budget, 0);
        const totalSpent = result.reduce((sum, p) => sum + p.spent, 0);
        const totalRemaining = totalBudget - totalSpent;
        const overallPercentage = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

        // Overall health status
        let healthStatus = 'good';
        let healthEmoji = '🟢';
        let healthLabel = 'On Track';
        if (overallPercentage >= 100) {
            healthStatus = 'danger';
            healthEmoji = '🔴';
            healthLabel = 'Over Budget';
        } else if (overallPercentage >= 70) {
            healthStatus = 'warning';
            healthEmoji = '🟡';
            healthLabel = 'Caution';
        }

        res.json({
            success: true,
            data: {
                month: targetMonth,
                year: targetYear,
                canEdit: req.session.role === 'Wife' && isEditableMonth(targetMonth, targetYear),
                pockets: result,
                totalBudget,
                formattedTotal: formatCurrency(totalBudget),
                totalSpent,
                formattedSpent: formatCurrency(totalSpent),
                totalRemaining,
                formattedRemaining: formatCurrency(Math.abs(totalRemaining)),
                overallPercentage,
                isOverBudget: totalRemaining < 0,
                health: {
                    status: healthStatus,
                    emoji: healthEmoji,
                    label: healthLabel
                }
            }
        });
    } catch (error) {
        console.error('Get budgets error:', error);
        res.status(500).json({ success: false, message: 'Error fetching budgets' });
    }
};

// GET /api/budget/history - Get all historical budgets grouped by month
exports.getBudgetHistory = async (req, res) => {
    try {
        const budgets = await PocketBudget.aggregate([
            {
                $group: {
                    _id: { year: '$year', month: '$month' },
                    totalBudget: { $sum: '$budget' },
                    pocketCount: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } }
        ]);

        const result = budgets.map(b => ({
            year: b._id.year,
            month: b._id.month,
            monthLabel: new Date(b._id.year, b._id.month - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
            totalBudget: b.totalBudget,
            formattedTotal: formatCurrency(b.totalBudget),
            pocketCount: b.pocketCount
        }));

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Budget history error:', error);
        res.status(500).json({ success: false, message: 'Error fetching history' });
    }
};

// POST /api/budget - Create or update budget (Wife only)
exports.saveBudget = async (req, res) => {
    try {
        // Role check
        if (req.session.role !== 'Wife') {
            return res.status(403).json({ success: false, message: 'Only Wife can edit budgets' });
        }

        const { pocket, month, year, budget } = req.body;

        // Month validation
        if (!isEditableMonth(month, year)) {
            return res.status(400).json({
                success: false,
                message: 'Cannot edit past months. Only current or next month allowed.'
            });
        }

        // Validate pocket
        if (!POCKETS[pocket]) {
            return res.status(400).json({ success: false, message: 'Invalid pocket' });
        }

        // Upsert (create or update)
        const result = await PocketBudget.findOneAndUpdate(
            { pocket, month, year },
            {
                budget: parseFloat(budget),
                createdBy: req.session.userId
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: 'Budget saved successfully',
            data: result
        });
    } catch (error) {
        console.error('Save budget error:', error);
        res.status(500).json({ success: false, message: 'Error saving budget' });
    }
};

// DELETE /api/budget/:id - Delete budget (Wife only)
exports.deleteBudget = async (req, res) => {
    try {
        if (req.session.role !== 'Wife') {
            return res.status(403).json({ success: false, message: 'Only Wife can delete budgets' });
        }

        const budget = await PocketBudget.findById(req.params.id);
        if (!budget) {
            return res.status(404).json({ success: false, message: 'Budget not found' });
        }

        // Check if month is editable
        if (!isEditableMonth(budget.month, budget.year)) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete past month budgets'
            });
        }

        await PocketBudget.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Budget deleted' });
    } catch (error) {
        console.error('Delete budget error:', error);
        res.status(500).json({ success: false, message: 'Error deleting budget' });
    }
};
