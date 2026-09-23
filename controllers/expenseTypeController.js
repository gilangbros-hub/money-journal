'use strict';

const expenseTypeManagementService = require('../services/expenseTypeManagementService');

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
        options.expenseTypeManagementEnabled = req.app.locals.configuration.expenseTypeManagementEnabled;
    }
    if (req.app?.locals?.connection) options.connection = req.app.locals.connection;
    return options;
}

function definitionQuery(req) {
    const query = req.query || {};
    return { includeArchived: query.includeArchived };
}

function createExpenseTypeController({ service = expenseTypeManagementService } = {}) {
    const actor = actorFromRequest;
    const options = serviceOptions;
    return {
        getExpenseTypeManagementPage(req, res) {
            res.render('expense-type-management', {
                username: req.session.username,
                avatar: req.session.avatar || '👤',
                role: req.session.role,
                canEdit: req.session.role === 'Wife',
                expenseTypeManagementEnabled: req.app?.locals?.configuration?.expenseTypeManagementEnabled === true,
                isExpenseTypeManagement: true
            });
        },

        async listTypes(req, res) {
            const data = await service.listExpenseTypeDefinitions(definitionQuery(req), actor(req), options(req));
            res.json({ success: true, data });
        },

        async createType(req, res) {
            const data = await service.createExpenseTypeDefinition(req.body || {}, actor(req), options(req));
            res.json({ success: true, data });
        },

        async updateType(req, res) {
            const data = await service.updateExpenseTypeDefinition(
                req.params.typeId,
                req.body || {},
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        },

        async archiveType(req, res) {
            const data = await service.archiveExpenseTypeDefinition(
                req.params.typeId,
                req.body || {},
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        },

        async restoreType(req, res) {
            const data = await service.restoreExpenseTypeDefinition(
                req.params.typeId,
                req.body || {},
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        },

        async deleteType(req, res) {
            const data = await service.deleteExpenseTypeDefinition(
                req.params.typeId,
                req.body || {},
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        }
    };
}

const handlers = createExpenseTypeController();

module.exports = {
    ...handlers,
    createExpenseTypeController
};
