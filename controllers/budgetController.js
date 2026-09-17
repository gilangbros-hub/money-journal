'use strict';

const budgetService = require('../services/budgetService');

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

function budgetQuery(req) {
    const query = req.query || {};
    const input = {};
    // Omitting month is meaningful: BudgetService then resolves the active
    // Budget_Month from the injected server clock and household time zone.
    if (query.month !== undefined && query.month !== '') input.budgetMonth = query.month;
    if (query.week !== undefined && query.week !== '') input.selectedWeek = query.week;
    return input;
}

function createBudgetController({ service = budgetService } = {}) {
    const actor = actorFromRequest;
    const options = serviceOptions;
    return {
        getBudgetPage(req, res) {
            res.render('check-pockets', {
                username: req.session.username,
                avatar: req.session.avatar || '👤',
                role: req.session.role,
                canEdit: req.session.role === 'Wife',
                salaryCycleBudgetingEnabled: req.app?.locals?.configuration?.salaryCycleBudgetingEnabled === true,
                isBudget: true
            });
        },

        async getBudgets(req, res) {
            const data = await service.getBudgetMonthView(
                budgetQuery(req),
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        },

        async getBudgetHistory(req, res) {
            const data = await service.getBudgetHistory(actor(req), options(req));
            res.json({ success: true, data });
        },

        async saveBudget(req, res) {
            const data = await service.putMonthlyAllocation({
                pocket: req.body?.pocket,
                month: req.body?.month,
                year: req.body?.year,
                amount: req.body?.amount ?? req.body?.budget,
                budget: req.body?.budget
            }, actor(req), options(req));
            res.json({ success: true, message: 'Budget saved successfully', data });
        },

        async setCadence(req, res) {
            const data = await service.setCadence(req.body || {}, actor(req), options(req));
            res.json({ success: true, data });
        },

        async putMonthlyAllocation(req, res) {
            const data = await service.putMonthlyAllocation(req.body || {}, actor(req), options(req));
            res.json({ success: true, data });
        },

        async putWeeklyAllocation(req, res) {
            const data = await service.putWeeklyAllocation(req.body || {}, actor(req), options(req));
            res.json({ success: true, data });
        },

        async deleteBudget(req, res) {
            const data = await service.deleteAllocation({
                allocationType: 'monthly',
                id: req.params.id
            }, actor(req), options(req));
            res.json({ success: true, message: 'Budget deleted', data });
        },

        async deleteAllocation(req, res) {
            const data = await service.deleteAllocation({
                allocationType: req.params.type,
                id: req.params.id
            }, actor(req), options(req));
            res.json({ success: true, data });
        },

        async toggleMonthClosed(req, res) {
            const data = await service.toggleBudgetMonthClosed(req.body || {}, actor(req), options(req));
            res.json({
                success: true,
                message: data.isClosed ? 'Month closed' : 'Month reopened',
                isClosed: data.isClosed,
                data
            });
        },

        async getClosedMonths(req, res) {
            const data = await service.getClosedBudgetMonths(actor(req), options(req));
            res.json({ success: true, data });
        }
    };
}

const handlers = createBudgetController();

module.exports = {
    ...handlers,
    createBudgetController
};
