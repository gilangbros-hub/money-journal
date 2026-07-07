const Transaction = require('../models/transaction');
const ClosedMonth = require('../models/closedMonth');
const { Resend } = require('resend');
const { getCategoryBreakdown, calculateTotalExpenses, getRoleBreakdown } = require('../services/transactionService');
const { formatCurrency } = require('../utils/formatters');
const { POCKETS } = require('../utils/constants');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Validates multi-pocket breakdown data
 * @param {Array} sourceBreakdowns - Array of pocket breakdowns
 * @param {number} totalAmount - Total transaction amount
 * @returns {Object} Validation result with isValid flag and error message
 */
const validateMultiPocketBreakdown = (sourceBreakdowns, totalAmount) => {
    if (!sourceBreakdowns || sourceBreakdowns.length === 0) {
        return { isValid: false, error: 'No breakdowns provided' };
    }

    if (sourceBreakdowns.length > 3) {
        return { isValid: false, error: 'Maximum 3 pockets allowed in multi-pocket mode.' };
    }

    const pocketSet = new Set();
    let breakdownSum = 0;

    for (const b of sourceBreakdowns) {
        if (!b.pocket || !POCKETS[b.pocket]) {
            return { isValid: false, error: `Invalid pocket: ${b.pocket}` };
        }
        if (pocketSet.has(b.pocket)) {
            return { isValid: false, error: `Duplicate pocket: ${b.pocket}` };
        }
        if (!b.amount || b.amount <= 0) {
            return { isValid: false, error: 'Each pocket amount must be greater than 0.' };
        }
        pocketSet.add(b.pocket);
        breakdownSum += parseFloat(b.amount);
    }

    if (Math.round(breakdownSum) !== Math.round(totalAmount)) {
        return { 
            isValid: false, 
            error: `Breakdown total (${breakdownSum}) does not match transaction amount (${totalAmount}).` 
        };
    }

    return { 
        isValid: true, 
        breakdowns: sourceBreakdowns.map(b => ({ pocket: b.pocket, amount: parseFloat(b.amount) }))
    };
};

/**
 * Processes source type and breakdowns for a transaction
 * @param {string} sourceType - Type of source ('single' or 'multi')
 * @param {Array} sourceBreakdowns - Array of pocket breakdowns
 * @param {number} amount - Total transaction amount
 * @param {string} pocket - Default pocket for single mode
 * @returns {Object} Processed sourceType, pocket, and breakdowns
 */
const processTransactionSource = (sourceType, sourceBreakdowns, amount, pocket) => {
    const validation = validateMultiPocketBreakdown(sourceBreakdowns, amount);
    
    if (validation.isValid && sourceType === 'multi') {
        return {
            sourceType: 'multi',
            pocket: validation.breakdowns[0].pocket,
            sourceBreakdowns: validation.breakdowns
        };
    }

    return {
        sourceType: 'single',
        pocket: pocket ? pocket.trim() : pocket,
        sourceBreakdowns: []
    };
};

/**
 * Checks if a budget month is closed
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {Promise<Object>} Closed month document or null
 */
const checkMonthClosed = async (month, year) => {
    return await ClosedMonth.findOne({ month, year });
};

/**
 * Sends email notification for new transaction (non-blocking)
 * @param {Object} transactionData - Transaction details
 * @param {string} username - Username who created the transaction
 */
const sendTransactionNotification = (transactionData, username) => {
    if (!resend) return;

    const { amount, type, pocket, ngapain, sourceType, sourceBreakdowns } = transactionData;
    const formattedAmount = new Intl.NumberFormat('id-ID').format(amount);
    
    const pocketLabel = sourceType === 'multi' && sourceBreakdowns?.length > 0
        ? `${pocket} (+ ${sourceBreakdowns.length - 1} more)`
        : pocket;

    const recipients = process.env.NOTIFY_EMAIL 
        ? process.env.NOTIFY_EMAIL.split(';').map(email => email.trim()) 
        : ['your-email@example.com'];

    // Send individually to avoid one restricted email blocking the whole batch
    recipients.forEach(recipient => {
        resend.emails.send({
            from: 'Money Journal <onboarding@resend.dev>',
            to: recipient,
            subject: `💸 New Transaction: Rp ${formattedAmount}`,
            html: `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #4F46E5;">New Spending Alert!</h2>
                    <p><strong>Who:</strong> ${username}</p>
                    <p><strong>Amount:</strong> Rp ${formattedAmount}</p>
                    <p><strong>Category:</strong> ${type} (${pocketLabel})</p>
                    <p><strong>Notes:</strong> ${ngapain}</p>
                    <hr style="border: 0; border-top: 1px solid #eee;">
                    <p style="font-size: 12px; color: #666;">This is an automated notification from your Money Journal.</p>
                </div>
            `
        }).catch(err => console.error(`Email to ${recipient} failed:`, err.message));
    });
};

exports.getTransactionPage = (req, res) => {
    res.render('log-spending', {
        username: req.session.username,
        avatar: req.session.avatar || '👤'
    });
};

exports.getTransactionsPage = (req, res) => {
    res.render('monthly-story', {
        username: req.session.username,
        avatar: req.session.avatar || '👤'
    });
};

exports.getAllTransactionsPage = (req, res) => {
    res.render('review-history', {
        username: req.session.username,
        avatar: req.session.avatar || '👤'
    });
};

exports.createTransaction = async (req, res) => {
    try {
        const { date, type, pocket, ngapain, amount, paidBy, budgetMonth, budgetYear, sourceType, sourceBreakdowns } = req.body;
        const txDate = new Date(date);
        const parsedAmount = parseFloat(amount);

        // Determine target month/year for closed month check
        const targetMonth = budgetMonth ? parseInt(budgetMonth) : txDate.getMonth() + 1;
        const targetYear = budgetYear ? parseInt(budgetYear) : txDate.getFullYear();

        // Check if the target month is closed
        const closedDoc = await checkMonthClosed(targetMonth, targetYear);
        if (closedDoc) {
            return res.status(400).json({ 
                success: false, 
                message: 'Budget for this month is closed. You cannot add transactions to a closed month.' 
            });
        }

        // Process source type and breakdowns
        const { sourceType: finalSourceType, pocket: finalPocket, sourceBreakdowns: finalBreakdowns } = 
            processTransactionSource(sourceType, sourceBreakdowns, parsedAmount, pocket);

        const transaction = new Transaction({
            date: txDate,
            type: type ? type.trim() : type,
            pocket: finalPocket,
            ngapain,
            by: req.session.userId,
            paidBy: paidBy || req.session.role || 'Self',
            amount: parsedAmount,
            budgetMonth: targetMonth,
            budgetYear: targetYear,
            sourceType: finalSourceType,
            sourceBreakdowns: finalBreakdowns
        });

        await transaction.save();

        // Send Email Notification (Non-blocking)
        sendTransactionNotification({
            amount: parsedAmount,
            type,
            pocket: finalPocket,
            ngapain,
            sourceType: finalSourceType,
            sourceBreakdowns: finalBreakdowns
        }, req.session.username);

        res.json({ success: true, message: "Transaction saved successfully!" });
    } catch (error) {
        console.error('Create transaction error:', error);
        res.status(500).json({ success: false, message: "Error saving transaction" });
    }
};

exports.getAllTransactions = async (req, res) => {
    try {
        const { month, by, type, pocket } = req.query;
        const filter = {};

        if (month) {
            const [year, monthNum] = month.split('-');
            filter.budgetMonth = parseInt(monthNum);
            filter.budgetYear = parseInt(year);
        }

        if (by && by !== 'all') filter.by = by;
        if (type && type !== 'all') filter.type = type;
        if (pocket && pocket !== 'all') filter.pocket = pocket.trim();

        const transactions = await Transaction.find(filter)
            .populate('by', 'username')
            .sort({ date: -1 })
            .lean(); // Use lean() for better performance when no Mongoose features needed

        // Map to maintain compatibility with existing frontend (expecting 'by' as string)
        const formattedTransactions = transactions.map(t => ({
            ...t,
            by: t.by ? t.by.username : 'Unknown'
        }));

        res.json(formattedTransactions);
    } catch (error) {
        console.error('Get all transactions error:', error);
        res.status(500).json({ error: "Error fetching transactions" });
    }
};

exports.getTransaction = async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id).lean();
        if (!transaction) return res.status(404).json({ error: "Not found" });
        res.json(transaction);
    } catch (error) {
        console.error('Get transaction error:', error);
        res.status(500).json({ error: "Error fetching transaction" });
    }
};

exports.updateTransaction = async (req, res) => {
    try {
        const { date, type, pocket, ngapain, amount, budgetMonth, budgetYear, sourceType, sourceBreakdowns } = req.body;
        const txDate = new Date(date);
        const parsedAmount = parseFloat(amount);

        // Process source type and breakdowns
        const { sourceType: finalSourceType, pocket: finalPocket, sourceBreakdowns: finalBreakdowns } = 
            processTransactionSource(sourceType, sourceBreakdowns, parsedAmount, pocket);

        const targetMonth = budgetMonth ? parseInt(budgetMonth) : txDate.getMonth() + 1;
        const targetYear = budgetYear ? parseInt(budgetYear) : txDate.getFullYear();

        await Transaction.findByIdAndUpdate(req.params.id, {
            date: txDate,
            type,
            pocket: finalPocket,
            ngapain,
            amount: parsedAmount,
            budgetMonth: targetMonth,
            budgetYear: targetYear,
            sourceType: finalSourceType,
            sourceBreakdowns: finalBreakdowns
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Update transaction error:', error);
        res.status(500).json({ success: false });
    }
};

exports.deleteTransaction = async (req, res) => {
    try {
        await Transaction.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete transaction error:', error);
        res.status(500).json({ success: false });
    }
};

exports.getSubmitters = async (req, res) => {
    try {
        const submitterIds = await Transaction.distinct('by');
        const users = await require('../models/user').find({ _id: { $in: submitterIds } }, 'username').lean();
        res.json(users.map(u => u.username));
    } catch (error) {
        console.error('Get submitters error:', error);
        res.status(500).json({ error: "Error fetching submitters" });
    }
};

exports.getDashboardSummary = async (req, res) => {
    try {
        const { month } = req.query;
        const PocketBudget = require('../models/pocketBudget');

        let currentYear, currentMonth;
        if (month) {
            [currentYear, currentMonth] = month.split('-').map(Number);
        } else {
            const now = new Date();
            currentYear = now.getFullYear();
            currentMonth = now.getMonth() + 1;
        }

        // Budget month filter
        const filter = { budgetMonth: currentMonth, budgetYear: currentYear };

        // Last month budget filter
        let lastMonthYear = currentYear;
        let lastMonth = currentMonth - 1;
        if (lastMonth === 0) {
            lastMonth = 12;
            lastMonthYear--;
        }
        const lastMonthFilter = { budgetMonth: lastMonth, budgetYear: lastMonthYear };

        // Parallel Execution with lean() for performance
        const [transactions, recentTransactions, lastMonthTransactions, budgets] = await Promise.all([
            Transaction.find(filter).sort({ date: -1 }).lean(),
            Transaction.find(filter).sort({ date: -1 }).limit(5).populate('by', 'username').lean(),
            Transaction.find(lastMonthFilter).lean(),
            PocketBudget.find({ month: currentMonth, year: currentYear }).lean()
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
            if (t.sourceType === 'multi' && t.sourceBreakdowns && t.sourceBreakdowns.length > 0) {
                t.sourceBreakdowns.forEach(b => {
                    pocketSpending[b.pocket] = (pocketSpending[b.pocket] || 0) + b.amount;
                });
            } else {
                pocketSpending[t.pocket] = (pocketSpending[t.pocket] || 0) + t.amount;
            }
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
