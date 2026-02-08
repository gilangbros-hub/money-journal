const Transaction = require('../models/transaction');
const { Resend } = require('resend');
const { getCategoryBreakdown, calculateTotalExpenses, getRoleBreakdown } = require('../services/transactionService');
const { formatCurrency } = require('../utils/formatters');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

exports.getTransactionPage = (req, res) => {
    res.render('transaction', {
        username: req.session.username,
        avatar: req.session.avatar || '👤'
    });
};

exports.getTransactionsPage = (req, res) => {
    res.render('transactions', {
        username: req.session.username,
        avatar: req.session.avatar || '👤'
    });
};

exports.createTransaction = async (req, res) => {
    try {
        const { date, type, pocket, ngapain, amount, paidBy } = req.body;
        const transaction = new Transaction({
            date: new Date(date),
            type,
            pocket,
            ngapain,
            by: req.session.userId,
            paidBy: paidBy || req.session.role || 'Self', // Default to session role or 'Self'
            amount: parseFloat(amount)
        });

        await transaction.save();

        // Send Email Notification (Non-blocking)
        if (resend) {
            const formattedAmount = new Intl.NumberFormat('id-ID').format(amount);
            const recipients = process.env.NOTIFY_EMAIL ? process.env.NOTIFY_EMAIL.split(';').map(email => email.trim()) : ['your-email@example.com'];

            // Send individually to avoid one restricted email blocking the whole batch
            recipients.forEach(recipient => {
                resend.emails.send({
                    from: 'Money Journal <onboarding@resend.dev>',
                    to: recipient,
                    subject: `💸 New Transaction: Rp ${formattedAmount}`,
                    html: `
                        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                            <h2 style="color: #4F46E5;">New Spending Alert!</h2>
                            <p><strong>Who:</strong> ${req.session.username}</p>
                            <p><strong>Amount:</strong> Rp ${formattedAmount}</p>
                            <p><strong>Category:</strong> ${type} (${pocket})</p>
                            <p><strong>Notes:</strong> ${ngapain}</p>
                            <hr style="border: 0; border-top: 1px solid #eee;">
                            <p style="font-size: 12px; color: #666;">This is an automated notification from your Money Journal.</p>
                        </div>
                    `
                }).catch(err => console.error(`Email to ${recipient} failed:`, err.message));
            });
        }

        res.json({ success: true, message: "Transaction saved successfully!" });
    } catch (error) {
        console.error('Create transaction error:', error);
        res.status(500).json({ success: false, message: "Error saving transaction" });
    }
};

exports.getAllTransactions = async (req, res) => {
    try {
        const { month, by, type } = req.query;
        let filter = {};

        if (month) {
            const [year, monthNum] = month.split('-');
            const startDate = new Date(year, monthNum - 1, 1);
            const endDate = new Date(year, monthNum, 0, 23, 59, 59);
            filter.date = { $gte: startDate, $lte: endDate };
        }

        if (by && by !== 'all') filter.by = by;
        if (type && type !== 'all') filter.type = type;

        const transactions = await Transaction.find(filter)
            .populate('by', 'username')
            .sort({ date: -1 });

        // Map to maintain compatibility with existing frontend (expecting 'by' as string)
        const formattedTransactions = transactions.map(t => ({
            ...t._doc,
            by: t.by ? t.by.username : 'Unknown'
        }));

        res.json(formattedTransactions);
    } catch (error) {
        res.status(500).json({ error: "Error fetching transactions" });
    }
};

exports.getTransaction = async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id);
        if (!transaction) return res.status(404).json({ error: "Not found" });
        res.json(transaction);
    } catch (error) {
        res.status(500).json({ error: "Error fetching" });
    }
};

exports.updateTransaction = async (req, res) => {
    try {
        const { date, type, pocket, ngapain, amount } = req.body;
        await Transaction.findByIdAndUpdate(req.params.id, {
            date: new Date(date),
            type,
            pocket,
            ngapain,
            amount: parseFloat(amount)
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
};

exports.deleteTransaction = async (req, res) => {
    try {
        await Transaction.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
};

exports.getSubmitters = async (req, res) => {
    try {
        // Since we now store IDs, we need to get unique user IDs then find their names
        const submitterIds = await Transaction.distinct('by');
        const users = await require('../models/user').find({ _id: { $in: submitterIds } }, 'username');
        res.json(users.map(u => u.username));
    } catch (error) {
        res.status(500).json({ error: "Error" });
    }
};

exports.getDashboardSummary = async (req, res) => {
    try {
        const { month } = req.query; // Format: YYYY-MM
        const PocketBudget = require('../models/pocketBudget');

        let currentYear, currentMonth;
        if (month) {
            [currentYear, currentMonth] = month.split('-').map(Number);
        } else {
            const now = new Date();
            currentYear = now.getFullYear();
            currentMonth = now.getMonth() + 1;
        }

        // Current month date range
        const startDate = new Date(currentYear, currentMonth - 1, 1);
        const endDate = new Date(currentYear, currentMonth, 0, 23, 59, 59);

        // Last month date range
        let lastMonthYear = currentYear;
        let lastMonth = currentMonth - 1;
        if (lastMonth === 0) {
            lastMonth = 12;
            lastMonthYear--;
        }
        const lastMonthStart = new Date(lastMonthYear, lastMonth - 1, 1);
        const lastMonthEnd = new Date(lastMonthYear, lastMonth, 0, 23, 59, 59);

        const filter = { date: { $gte: startDate, $lte: endDate } };
        const lastMonthFilter = { date: { $gte: lastMonthStart, $lte: lastMonthEnd } };

        // Parallel Execution
        const [transactions, recentTransactions, lastMonthTransactions, budgets] = await Promise.all([
            Transaction.find(filter).sort({ date: -1 }),
            Transaction.find(filter).sort({ date: -1 }).limit(5).populate('by', 'username'),
            Transaction.find(lastMonthFilter),
            PocketBudget.find({ month: currentMonth, year: currentYear })
        ]);

        const totalExpenses = calculateTotalExpenses(transactions);
        const categoryBreakdown = getCategoryBreakdown(transactions);
        const roleBreakdown = getRoleBreakdown(transactions);

        // Calculate last month total
        const lastMonthTotal = lastMonthTransactions.reduce((sum, t) => sum + t.amount, 0);

        // Monthly comparison
        const difference = totalExpenses.raw - lastMonthTotal;
        const percentChange = lastMonthTotal > 0
            ? Math.round((difference / lastMonthTotal) * 100)
            : (totalExpenses.raw > 0 ? 100 : 0);

        const comparison = {
            lastMonth: formatCurrency(lastMonthTotal),
            difference: formatCurrency(Math.abs(difference)),
            percentChange: Math.abs(percentChange),
            increased: difference > 0,
            hasLastMonth: lastMonthTotal > 0
        };

        // Calculate spending per pocket for budget alerts
        const pocketSpending = {};
        transactions.forEach(t => {
            pocketSpending[t.pocket] = (pocketSpending[t.pocket] || 0) + t.amount;
        });

        // Generate budget alerts
        const budgetAlerts = [];
        budgets.forEach(b => {
            const spent = pocketSpending[b.pocket] || 0;
            if (b.budget > 0) {
                const percentage = Math.round((spent / b.budget) * 100);
                if (percentage >= 100) {
                    budgetAlerts.push({
                        pocket: b.pocket,
                        status: 'danger',
                        percentage,
                        spent: formatCurrency(spent),
                        budget: formatCurrency(b.budget),
                        message: `${b.pocket}: ${percentage}% over budget!`
                    });
                } else if (percentage >= 80) {
                    budgetAlerts.push({
                        pocket: b.pocket,
                        status: 'warning',
                        percentage,
                        spent: formatCurrency(spent),
                        budget: formatCurrency(b.budget),
                        message: `${b.pocket}: ${percentage}% used`
                    });
                }
            }
        });

        // Sort alerts: danger first, then warning
        budgetAlerts.sort((a, b) => (b.status === 'danger' ? 1 : 0) - (a.status === 'danger' ? 1 : 0));

        // Format Recent Transactions
        const formattedRecent = recentTransactions.map(t => ({
            _id: t._id,
            date: t.date,
            type: t.type,
            pocket: t.pocket,
            ngapain: t.ngapain,
            amount: t.amount,
            formattedAmount: formatCurrency(t.amount),
            paidBy: t.paidBy,
            by: t.by ? t.by.username : 'Unknown'
        }));

        res.json({
            success: true,
            data: {
                total: totalExpenses,
                categories: categoryBreakdown,
                roles: roleBreakdown,
                recent: formattedRecent,
                comparison,
                budgetAlerts
            }
        });

    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).json({ success: false, message: "Error fetching dashboard data" });
    }
};
