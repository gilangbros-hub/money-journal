'use strict';

const Transaction = require('../models/transaction');
const User = require('../models/user');
const transactionService = require('../services/transactionService');
const reportingService = require('../services/reportingService');

function actorFromRequest(req) {
    return {
        userId: req.session?.userId,
        username: req.session?.username,
        role: req.session?.role,
        nowInstant: req.app?.locals?.nowInstant
    };
}

function serviceOptions(req) {
    const options = {};
    if (req.app?.locals?.householdTimeZone) options.timeZone = req.app.locals.householdTimeZone;
    if (req.app?.locals?.nowInstant) options.nowInstant = req.app.locals.nowInstant;
    if (req.app?.locals?.configuration) {
        options.salaryCycleBudgetingEnabled = req.app.locals.configuration.salaryCycleBudgetingEnabled;
    }
    if (req.app?.locals?.connection) options.connection = req.app.locals.connection;
    return options;
}

function compatibilityListResponse(transactions) {
    return transactions.map(transaction => ({
        ...transaction,
        // Existing browser clients consume `by` as a username string. The
        // service keeps the populated object available to newer callers.
        by: transaction.by && typeof transaction.by === 'object'
            ? transaction.by.username || 'Unknown'
            : (typeof transaction.by === 'string' && /^[a-fA-F0-9]{24}$/.test(transaction.by)
                ? 'Unknown'
                : transaction.by || 'Unknown')
    }));
}

function createTransactionController({ service = transactionService, reporting } = {}) {
    const reportingAdapter = reporting || (service === transactionService ? reportingService : null);
    return {
        async createTransaction(req, res) {
            await service.createExpense(req.body || {}, actorFromRequest(req), serviceOptions(req));
            res.json({ success: true, message: 'Transaction saved successfully!' });
        },

        async getAllTransactions(req, res) {
            const transactions = reportingAdapter
                ? await reportingAdapter.getAllTransactions(req.query || {}, actorFromRequest(req), serviceOptions(req))
                : await service.listExpenses(req.query || {}, actorFromRequest(req), serviceOptions(req));
            res.json(compatibilityListResponse(transactions));
        },

        async getTransaction(req, res) {
            const transaction = await service.getExpense(req.params.id, actorFromRequest(req), serviceOptions(req));
            res.json(transaction);
        },

        async updateTransaction(req, res) {
            await service.updateExpense(
                req.params.id,
                req.body || {},
                actorFromRequest(req),
                serviceOptions(req)
            );
            res.json({ success: true });
        },

        async deleteTransaction(req, res) {
            await service.deleteExpense(req.params.id, actorFromRequest(req), serviceOptions(req));
            res.json({ success: true });
        },

        async getAssignmentPreview(req, res) {
            const preview = await service.previewAssignment(
                req.query?.date,
                actorFromRequest(req),
                serviceOptions(req)
            );
            res.json({ success: true, data: preview });
        },

        async getDashboardSummary(req, res) {
            const data = reportingAdapter
                ? await reportingAdapter.getDashboardSummary(req.query || {}, actorFromRequest(req), serviceOptions(req))
                : await service.getDashboardSummary(req.query || {}, actorFromRequest(req), serviceOptions(req));
            res.json({ success: true, data });
        },

        async getHistory(req, res) {
            if (!reportingAdapter?.getHistory) {
                throw new Error('History reporting is not configured.');
            }
            const data = await reportingAdapter.getHistory(req.query || {}, actorFromRequest(req), serviceOptions(req));
            res.json({ success: true, data });
        }
    };
}

const transactionHandlers = createTransactionController();

exports.getTransactionPage = (req, res) => {
    res.render('log-spending', {
        username: req.session.username,
        avatar: req.session.avatar || '👤',
        salaryCycleBudgetingEnabled: req.app?.locals?.configuration?.salaryCycleBudgetingEnabled === true
    });
};

exports.getTransactionsPage = (req, res) => {
    res.render('monthly-story', {
        username: req.session.username,
        avatar: req.session.avatar || '👤',
        salaryCycleBudgetingEnabled: req.app?.locals?.configuration?.salaryCycleBudgetingEnabled === true
    });
};

exports.getAllTransactionsPage = (req, res) => {
    res.render('review-history', {
        username: req.session.username,
        avatar: req.session.avatar || '👤',
        salaryCycleBudgetingEnabled: req.app?.locals?.configuration?.salaryCycleBudgetingEnabled === true
    });
};

exports.createTransaction = transactionHandlers.createTransaction;
exports.getAllTransactions = transactionHandlers.getAllTransactions;
exports.getTransaction = transactionHandlers.getTransaction;
exports.updateTransaction = transactionHandlers.updateTransaction;
exports.deleteTransaction = transactionHandlers.deleteTransaction;
exports.getAssignmentPreview = transactionHandlers.getAssignmentPreview;
exports.getDashboardSummary = transactionHandlers.getDashboardSummary;
exports.getHistory = transactionHandlers.getHistory;

exports.getSubmitters = async (req, res) => {
    const submitterIds = await Transaction.distinct('by');
    const users = await User.find({ _id: { $in: submitterIds } }, 'username').lean();
    res.json(users.map(user => user.username));
};

exports.createTransactionController = createTransactionController;
