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

// GET /api/budget?month=YYYY-MM - Get budgets for a specific month
exports.getBudgets = async (req, res) => {
    try {
        const { month } = req.query;
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

        const budgets = await PocketBudget.find({
            month: targetMonth,
            year: targetYear
        }).sort({ pocket: 1 });

        // Build response with all pockets (including those without budgets)
        const allPockets = Object.keys(POCKETS);
        const budgetMap = {};
        budgets.forEach(b => { budgetMap[b.pocket] = b; });

        const result = allPockets.map(pocket => ({
            pocket,
            icon: POCKETS[pocket],
            budget: budgetMap[pocket]?.budget || 0,
            formattedBudget: formatCurrency(budgetMap[pocket]?.budget || 0),
            _id: budgetMap[pocket]?._id || null
        }));

        const totalBudget = result.reduce((sum, p) => sum + p.budget, 0);

        res.json({
            success: true,
            data: {
                month: targetMonth,
                year: targetYear,
                canEdit: req.session.role === 'Wife' && isEditableMonth(targetMonth, targetYear),
                pockets: result,
                totalBudget,
                formattedTotal: formatCurrency(totalBudget)
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
