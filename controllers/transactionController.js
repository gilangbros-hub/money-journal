const Transaction = require('../models/transaction');

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
        const { date, type, pocket, ngapain, amount } = req.body;
        const transaction = new Transaction({
            date: new Date(date),
            type,
            pocket,
            ngapain,
            by: req.session.userId,
            amount: parseFloat(amount)
        });
        
        await transaction.save();
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
