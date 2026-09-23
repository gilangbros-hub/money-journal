'use strict';

const pocketManagementService = require('../services/pocketManagementService');
const { BANK_KEYS, bankView } = require('../utils/banks');

/**
 * Build the actor from the authenticated session. The server never trusts
 * client-supplied identity/role/timestamps; those are derived here and again
 * enforced inside the service (defense in depth).
 */
function actorFromRequest(req) {
    return {
        userId: req.session?.userId,
        username: req.session?.username,
        role: req.session?.role,
        nowInstant: req.app?.locals?.nowInstant
    };
}

/**
 * Assemble the injected service options from validated application state,
 * mirroring the budget/transaction controllers. The rollout flags are passed
 * through so the service's `requirePocketManagementEnabled` gate keeps managed
 * data unreachable while the primary flag is false, even if a route middleware
 * were ever bypassed.
 */
function serviceOptions(req) {
    const options = {};
    if (req.app?.locals?.householdTimeZone) options.timeZone = req.app.locals.householdTimeZone;
    if (req.app?.locals?.nowInstant) options.nowInstant = req.app.locals.nowInstant;
    if (req.app?.locals?.configuration) {
        const config = req.app.locals.configuration;
        options.salaryCycleBudgetingEnabled = config.salaryCycleBudgetingEnabled;
        options.pocketManagementEnabled = config.pocketManagementEnabled;
        options.pocketManagementDualWriteEnabled = config.pocketManagementDualWriteEnabled;
    }
    if (req.app?.locals?.connection) options.connection = req.app.locals.connection;
    return options;
}

/**
 * Read the definition-listing query. Only the archived-inclusion intent is
 * meaningful; the service owns ordering and lifecycle partitioning.
 */
function definitionQuery(req) {
    const query = req.query || {};
    return { includeArchived: query.includeArchived };
}

/**
 * Resolve the expense-pocket-options input from the request. A `date`
 * (YYYY-MM-DD) is preferred; a `month` (YYYY-MM) is accepted as a fallback.
 * The service derives the Budget_Month and rejects a missing/invalid value.
 */
function expensePocketInput(req) {
    const query = req.query || {};
    const input = {};
    if (query.date !== undefined && query.date !== '') input.expenseDate = query.date;
    if (query.month !== undefined && query.month !== '') input.budgetMonth = query.month;
    return input;
}

function createPocketController({ service = pocketManagementService } = {}) {
    const actor = actorFromRequest;
    const options = serviceOptions;
    return {
        // ------------------------------------------------------------------
        // Page shell (any authenticated household member). Server-rendered data
        // carries only actor capabilities and feature state; live pocket data
        // is loaded from the APIs below. The view itself is delivered by a
        // later task.
        // ------------------------------------------------------------------
        getPocketManagementPage(req, res) {
            const banks = BANK_KEYS.map(bankView);
            res.render('pocket-management', {
                banks,
                banksJson: JSON.stringify(banks),
                username: req.session.username,
                avatar: req.session.avatar || '👤',
                role: req.session.role,
                canEdit: req.session.role === 'Wife',
                pocketManagementEnabled: req.app?.locals?.configuration?.pocketManagementEnabled === true,
                pocketManagementDualWriteEnabled:
                    req.app?.locals?.configuration?.pocketManagementDualWriteEnabled === true,
                isPocketManagement: true,
                // Pocket Management sits under the Pockets tab.
                isBudget: true
            });
        },

        // ------------------------------------------------------------------
        // Definition reads/commands
        // ------------------------------------------------------------------
        async listPockets(req, res) {
            const data = await service.listPocketDefinitions(definitionQuery(req), actor(req), options(req));
            res.json({ success: true, data });
        },

        async createPocket(req, res) {
            const data = await service.createPocketDefinition(req.body || {}, actor(req), options(req));
            res.json({ success: true, data });
        },

        async updatePocket(req, res) {
            const data = await service.updatePocketDefinition(
                req.params.pocketId,
                req.body || {},
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        },

        async archivePocket(req, res) {
            const data = await service.archivePocketDefinition(
                req.params.pocketId,
                req.body || {},
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        },

        async restorePocket(req, res) {
            const data = await service.restorePocketDefinition(
                req.params.pocketId,
                req.body || {},
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        },

        // ------------------------------------------------------------------
        // Assignment reads/commands
        // ------------------------------------------------------------------
        async getAssignmentSetup(req, res) {
            const data = await service.getAssignmentSetup(req.query?.month, actor(req), options(req));
            res.json({ success: true, data });
        },

        async confirmAssignments(req, res) {
            const data = await service.confirmAssignments(req.body || {}, actor(req), options(req));
            res.json({ success: true, data });
        },

        async removeAssignment(req, res) {
            const data = await service.removeAssignment(
                req.params.pocketId,
                req.params.month,
                req.body || {},
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        },

        // ------------------------------------------------------------------
        // Expense selection options (assignment-backed)
        // ------------------------------------------------------------------
        async getExpensePocketOptions(req, res) {
            const data = await service.listExpensePocketOptions(
                expensePocketInput(req),
                actor(req),
                options(req)
            );
            res.json({ success: true, data });
        }
    };
}

const handlers = createPocketController();

module.exports = {
    ...handlers,
    createPocketController
};
