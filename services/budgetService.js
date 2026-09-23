'use strict';

const mongoose = require('mongoose');
const PocketBudget = require('../models/pocketBudget');
const PocketBudgetCadence = require('../models/pocketBudgetCadence');
const WeeklyAllocation = require('../models/weeklyAllocation');
const PocketAssignment = require('../models/pocketAssignment');
const PocketDefinition = require('../models/pocketDefinition');
const ClosedMonth = require('../models/closedMonth');
const Transaction = require('../models/transaction');
const { POCKETS } = require('../utils/constants');
const { BANK_KEYS, bankView } = require('../utils/banks');
const { formatCurrency } = require('../utils/formatters');
const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    getActiveBudgetMonth,
    getSalaryCyclePeriod,
    listIntersectingIsoWeeks,
    parseBudgetMonth,
    parseIsoWeek
} = require('./salaryCycleResolver');
const {
    calculateBudgetAggregate,
    calculatePocketPeriod,
    calculatePocketWeek,
    expandEligibleSpendingItems
} = require('./budgetCalculationService');
const { withOpenBudgetPeriods } = require('./budgetPeriodGuard');
const {
    AuthenticationError,
    AuthorizationError,
    ConcurrentWriteConflictError,
    DomainValidationError,
    EditableWindowError,
    RecordNotFoundError
} = require('../utils/domainErrors');
const {
    isSalaryCycleEnabled,
    requireSalaryCycleEnabled,
    isPocketManagementEnabled
} = require('../utils/rollout');
const {
    isDualReadActive,
    resolveTracker,
    reconcilePocketSources
} = require('./pocketCompatibility');
const { normalizePocketName } = require('./pocketValidation');
const { pocketDefinitionId } = require('./migrationTransformService');
const {
    expenseDateFromCompatibilityDate,
    validateIdentifier,
    validatePocket
} = require('../utils/transactionValidators');

const CADENCES = new Set(['Monthly', 'Weekly']);

function executeQuery(query) {
    return typeof query?.exec === 'function' ? query.exec() : query;
}

function withSession(query, session) {
    return typeof query?.session === 'function' ? query.session(session) : query;
}

function asPlain(value) {
    return value && typeof value.toObject === 'function' ? value.toObject() : value;
}

function actorIdFor(actor) {
    const value = actor && typeof actor === 'object'
        ? (actor.userId ?? actor.id ?? actor._id)
        : actor;
    if (value === undefined || value === null) throw new AuthenticationError();
    return validateIdentifier(value, 'by');
}

function requireWife(actor) {
    actorIdFor(actor);
    if (actor?.role !== 'Wife') throw new AuthorizationError('Wife');
}

function option(options, actor, name, fallback) {
    return options?.[name] ?? actor?.[name] ?? fallback;
}

function normalizeMonth(value, field = 'budgetMonth') {
    if (value && typeof value === 'object') {
        if (typeof value.key === 'string') return parseBudgetMonth(value.key);
        if (Number.isInteger(value.year) && Number.isInteger(value.month)) {
            return parseBudgetMonth(
                `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}`
            );
        }
    }
    if (typeof value === 'string') return parseBudgetMonth(value);
    throw new DomainValidationError(field, `${field} must use the YYYY-MM format.`);
}

function monthFromInput(input = {}) {
    const value = input.budgetMonth ?? input.month;
    if (value !== undefined) {
        if (typeof value === 'string') return normalizeMonth(value);
        if (Number.isInteger(value) && Number.isInteger(input.year)) {
            return normalizeMonth(`${String(input.year).padStart(4, '0')}-${String(value).padStart(2, '0')}`);
        }
    }
    throw new DomainValidationError('budgetMonth', 'budgetMonth must use the YYYY-MM format.');
}

function normalizeAmount(value) {
    let amount = value;
    if (typeof amount === 'string' && /^\d+$/.test(amount)) amount = Number(amount);
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
        throw new DomainValidationError('amount', 'amount must be a finite non-negative integer.');
    }
    return amount;
}

function normalizeCadence(value) {
    if (typeof value !== 'string' || !CADENCES.has(value)) {
        throw new DomainValidationError('cadence', 'cadence must be Monthly or Weekly.');
    }
    return value;
}

function normalizeWeek(value) {
    if (typeof value === 'string') return parseIsoWeek(value);
    if (value && typeof value.key === 'string') return parseIsoWeek(value.key);
    throw new DomainValidationError('isoWeek', 'isoWeek must use the YYYY-Www format.');
}

function periodParts(month) {
    return { month: month.month, year: month.year };
}

/**
 * Budget calculations use the canonical date-only value. Legacy schema-v1
 * transactions have only the compatibility BSON date, so normalize that
 * value at read time without writing it back or using the host time zone.
 */
function transactionForCalculation(transaction, timeZone) {
    const value = asPlain(transaction) || {};
    if (typeof value.expenseDate === 'string') return value;
    if (typeof value.date === 'string') return { ...value, expenseDate: value.date };
    if (value.date instanceof Date && !Number.isNaN(value.date.getTime())) {
        return {
            ...value,
            expenseDate: expenseDateFromCompatibilityDate(value.date, timeZone)
        };
    }
    return value;
}

function sortByPocket(a, b) {
    return String(a.pocket).localeCompare(String(b.pocket));
}

async function findMany(model, filter, options = {}) {
    let query = model.find(filter);
    // Native-array test doubles already represent a resolved query; invoking
    // Array#sort with a Mongo sort document would be incorrect.
    if (options.sort && !Array.isArray(query) && typeof query?.sort === 'function') {
        query = query.sort(options.sort);
    }
    query = withSession(query, options.session);
    if (typeof query?.lean === 'function') query = query.lean();
    return executeQuery(query);
}

async function findOne(model, filter, options = {}) {
    let query = model.findOne(filter);
    query = withSession(query, options.session);
    if (options.lean && typeof query?.lean === 'function') query = query.lean();
    return executeQuery(query);
}

function isDuplicateKeyError(error) {
    return error && (error.code === 11000 || error.codeName === 'DuplicateKey');
}

function isRetryableTransactionConflict(error) {
    return isDuplicateKeyError(error) || (
        error?.code === 'ALLOCATION_WRITE_CONFLICT' &&
        Boolean(error?.details?.budgetMonth)
    );
}

/**
 * MongoDB can reject two concurrent upserts with a duplicate-key error after
 * the unique index has selected the winner. A transaction containing that
 * error is aborted, so retry the complete operation with a fresh session;
 * retrying only the update in the aborted session would be invalid.
 */
async function runInTransaction(operation, { connection = mongoose.connection, session, duplicateKeyRetries = 2 } = {}) {
    if (session) return operation(session);
    if (!connection || typeof connection.startSession !== 'function') {
        throw new Error('A MongoDB connection with startSession is required.');
    }

    let attempt = 0;
    while (true) {
        const ownedSession = await connection.startSession();
        try {
            let result;
            await ownedSession.withTransaction(async () => {
                result = await operation(ownedSession);
            });
            return result;
        } catch (error) {
            if (!isRetryableTransactionConflict(error) || attempt >= duplicateKeyRetries) throw error;
            attempt += 1;
        } finally {
            await ownedSession.endSession();
        }
    }
}

function editableMonths(active) {
    const nextYear = active.month === 12 ? active.year + 1 : active.year;
    const nextMonth = active.month === 12 ? 1 : active.month + 1;
    return [active.key, `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`];
}

function assertEditable(month, actor, options) {
    const active = getActiveBudgetMonth({
        nowInstant: option(options, actor, 'nowInstant', new Date().toISOString()),
        timeZone: option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE)
    });
    const allowed = editableMonths(active);
    if (!allowed.includes(month.key)) {
        throw new EditableWindowError(month.key, active.key, allowed);
    }
    return active;
}

/**
 * Normalize one Pocket_Assignment record (a lean document, a hydrated Mongoose
 * document, or an already-serialized DTO from an injected test double) into the
 * snapshot fields the managed budget view needs. Only snapshot values are read
 * here; the current Pocket_Definition is never consulted, so later definition
 * edits cannot rewrite a saved month (Requirements 7.11, 7.12).
 */
function managedAssignmentView(record) {
    const value = asPlain(record) || {};
    return {
        value,
        id: value._id != null ? String(value._id) : (value.id != null ? String(value.id) : null),
        pocketId: value.pocketId != null ? String(value.pocketId) : '',
        name: value.pocketNameSnapshot ?? value.pocketName ?? '',
        normalizedName: value.pocketNormalizedNameSnapshot ?? value.pocketNormalizedName ?? '',
        emoji: value.pocketEmojiSnapshot ?? value.pocketEmoji ?? '',
        cadence: (value.cadenceSnapshot ?? value.cadence) === 'Weekly' ? 'Weekly' : 'Monthly',
        amountMode: value.amountMode,
        allocations: Array.isArray(value.allocations) ? value.allocations : [],
        version: value.version
    };
}

/**
 * Current bank key per pocket id. Bank is read live from Pocket_Definition, not
 * from the assignment snapshot: moving a pocket to another bank moves its
 * remaining with it straight away, because that's where the money is now.
 */
async function loadPocketBanks(definitionModel, pocketIds, session) {
    const ids = [...new Set(pocketIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const definitions = await findMany(definitionModel, { _id: { $in: ids } }, { session });
    return new Map(definitions.map((definition) => {
        const value = asPlain(definition) || {};
        return [String(value._id ?? value.id), value.bank];
    }));
}

/**
 * Sum each bank's pockets for the whole salary cycle (`periodMetrics`, so a
 * weekly pocket counts every week, same as `totalRemaining`). Pockets without
 * a bank land in a trailing `unassigned` entry. Banks follow catalogue order.
 */
function summarizeBanks(pockets) {
    const totals = new Map();
    for (const pocket of pockets) {
        const key = pocket.bank?.key || 'unassigned';
        const entry = totals.get(key) || { allocation: 0, spending: 0, pocketCount: 0 };
        entry.allocation += pocket.periodMetrics?.allocation ?? 0;
        entry.spending += pocket.periodMetrics?.spending ?? 0;
        entry.pocketCount += 1;
        totals.set(key, entry);
    }

    return [...BANK_KEYS, 'unassigned']
        .filter(key => totals.has(key))
        .map((key) => {
            const { allocation, spending, pocketCount } = totals.get(key);
            const remaining = allocation - spending;
            const bank = bankView(key) || { key: 'unassigned', name: 'No bank', color: null, logo: null, initial: '?' };
            return {
                ...bank,
                pocketCount,
                allocation,
                spending,
                remaining,
                formattedRemaining: formatCurrency(Math.abs(remaining)),
                isOver: remaining < 0
            };
        });
}

/**
 * Build the Budget_Month view from managed Pocket_Assignment snapshots.
 *
 * Only assignments for the selected Budget_Month are returned (Requirement
 * 8.1). Monthly cadence uses the sole `monthly` allocation and full
 * salary-cycle spending; Weekly cadence exposes each intersecting Calendar_Week
 * exactly once and attributes spending only within the week/cycle intersection
 * (Requirements 8.2, 8.3). Remaining and percentage retain the existing pure
 * formulas, split shares contribute only their own share, and every allocation
 * and eligible spending item is counted exactly once (Requirements 8.4-8.6,
 * 8.13-8.14). A month with no assignments yields an empty pocket list and zero
 * totals with no fixed-pocket substitution (Requirements 5.14, 7.12).
 */
async function buildManagedBudgetMonthView(context) {
    const { actor, options, month, period, timeZone, availableWeeks, selectedWeek, enabled } = context;
    const assignmentModelRef = option(options, actor, 'assignmentModel', PocketAssignment);
    const transactionModel = option(options, actor, 'transactionModel', Transaction);
    const guardModel = option(options, actor, 'guardModel', ClosedMonth);
    const definitionModel = option(options, actor, 'definitionModel', PocketDefinition);

    const [assignments, transactions, guard] = await Promise.all([
        findMany(assignmentModelRef, { budgetMonth: month.month, budgetYear: month.year }, {
            session: options.session,
            sort: { pocketNormalizedNameSnapshot: 1, pocketId: 1 }
        }),
        findMany(transactionModel, { budgetMonth: month.month, budgetYear: month.year }, { session: options.session }),
        findOne(guardModel, periodParts(month), { session: options.session, lean: true })
    ]);

    // Attribute spending by immutable managed identity (pocketId), never the
    // legacy pocket-name string. A single record counts once; a split record
    // contributes only its shares and never its parent amount.
    const expanded = expandEligibleSpendingItems(
        transactions.map(transaction => transactionForCalculation(transaction, timeZone)),
        { pocketField: 'pocketId' }
    );

    const bankByPocketId = await loadPocketBanks(
        definitionModel,
        assignments.map(record => managedAssignmentView(record).pocketId),
        options.session
    );

    const pockets = [];
    for (const record of assignments) {
        const assignment = managedAssignmentView(record);
        const cadence = assignment.cadence;
        const allocationByKey = new Map(assignment.allocations.map(allocation => [allocation.key, allocation]));
        const filterOptions = { budgetMonth: month.key, pocket: assignment.pocketId };

        const monthlyEntry = allocationByKey.get('monthly') || null;
        const monthlyAllocation = monthlyEntry
            ? { amount: monthlyEntry.amount, budget: monthlyEntry.amount }
            : null;
        const periodMetrics = calculatePocketPeriod(expanded, monthlyAllocation, filterOptions);

        const pocketWeeks = availableWeeks.map(week => {
            const entry = allocationByKey.get(week.key);
            return {
                ...week,
                allocation: entry ? { amount: entry.amount, budget: entry.amount } : null
            };
        });
        const chosenWeek = selectedWeek || (cadence === 'Weekly' ? availableWeeks[0] : null);
        const selectedEntry = chosenWeek ? allocationByKey.get(chosenWeek.key) : null;
        const selectedAllocation = selectedEntry
            ? { amount: selectedEntry.amount, budget: selectedEntry.amount }
            : null;
        const selectedMetrics = chosenWeek
            ? calculatePocketWeek(expanded, selectedAllocation, chosenWeek, filterOptions)
            : null;

        const activeAllocation = cadence === 'Weekly'
            ? pocketWeeks.reduce((sum, week) => sum + (week.allocation?.amount || 0), 0)
            : (monthlyAllocation?.amount || 0);
        const activeAggregateMetrics = calculatePocketPeriod(expanded, { amount: activeAllocation }, filterOptions);

        const allocation = cadence === 'Weekly' ? selectedAllocation : monthlyAllocation;
        const metrics = cadence === 'Weekly' ? selectedMetrics : periodMetrics;
        const plainAllocation = allocation
            ? { ...allocation, amount: allocation.amount, budget: allocation.amount }
            : null;

        pockets.push({
            // `pocket` remains the display alias (snapshot name) for existing
            // Check Pockets consumers; managed identity and snapshot fields are
            // included explicitly.
            pocket: assignment.name,
            pocketId: assignment.pocketId,
            pocketName: assignment.name,
            pocketNormalizedName: assignment.normalizedName,
            pocketEmoji: assignment.emoji,
            bank: bankView(bankByPocketId.get(assignment.pocketId)),
            assignmentId: assignment.id,
            assignmentVersion: assignment.version,
            amountMode: assignment.amountMode,
            icon: assignment.emoji,
            cadence,
            cadenceRecord: null,
            allocation: plainAllocation,
            allocationId: assignment.id,
            _id: assignment.id,
            missingAllocation: !allocation,
            budget: metrics.allocation,
            spent: metrics.spending,
            formattedBudget: formatCurrency(metrics.allocation),
            formattedSpent: formatCurrency(metrics.spending),
            remaining: metrics.remaining,
            formattedRemaining: formatCurrency(Math.abs(metrics.remaining)),
            percentage: metrics.percentageUsed,
            percentageUsed: metrics.percentageUsed,
            status: metrics.status,
            alertStatus: metrics.alertStatus,
            isOver: metrics.remaining < 0,
            metrics,
            periodMetrics: activeAggregateMetrics,
            availableWeeks: cadence === 'Weekly' ? pocketWeeks : [],
            selectedWeek: cadence === 'Weekly' && chosenWeek ? {
                ...chosenWeek,
                allocation: plainAllocation,
                metrics
            } : null,
            monthlyAllocation,
            weeklyAllocations: cadence === 'Weekly' ? pocketWeeks : []
        });
    }

    // Deterministic order by normalized snapshot name then pocket identifier,
    // matching the assignment month-view index and definition listing order.
    pockets.sort((a, b) => (
        String(a.pocketNormalizedName || '').localeCompare(String(b.pocketNormalizedName || ''))
        || String(a.pocketId).localeCompare(String(b.pocketId))
    ));

    const aggregate = calculateBudgetAggregate(pockets.map(pocket => ({
        allocation: pocket.periodMetrics.allocation,
        spending: pocket.periodMetrics.spending
    })));
    const active = getActiveBudgetMonth({
        nowInstant: option(options, actor, 'nowInstant', new Date().toISOString()),
        timeZone
    });
    const isClosed = guard ? guard.isClosed !== false : false;
    const canEdit = actor?.role === 'Wife' && !isClosed && editableMonths(active).includes(month.key);

    return {
        budgetMonth: month.key,
        month: month.month,
        year: month.year,
        featureEnabled: enabled,
        pocketManagementEnabled: true,
        // Zero assignments is an intentional empty state; consumers use these to
        // present a "Start setup" affordance without substituting active pockets.
        hasAssignments: pockets.length > 0,
        assignmentCount: pockets.length,
        timeZone,
        period,
        salaryCyclePeriod: period,
        availableWeeks,
        selectedWeek: selectedWeek?.key || null,
        isClosed,
        canEdit,
        pockets,
        banks: summarizeBanks(pockets),
        aggregate,
        totalBudget: aggregate.allocation,
        combinedAllocationTotal: aggregate.allocation,
        formattedTotal: formatCurrency(aggregate.allocation),
        totalSpent: aggregate.spending,
        formattedSpent: formatCurrency(aggregate.spending),
        totalRemaining: aggregate.remaining,
        formattedRemaining: formatCurrency(Math.abs(aggregate.remaining)),
        overallPercentage: aggregate.percentageUsed,
        isOverBudget: aggregate.remaining < 0,
        health: {
            status: aggregate.status,
            emoji: aggregate.status === 'danger' ? '🔴' : aggregate.status === 'warning' ? '🟡' : '🟢',
            label: aggregate.status === 'danger' ? 'Over Budget' : aggregate.status === 'warning' ? 'Caution' : 'On Track'
        }
    };
}

async function getBudgetMonthView(input = {}, actor, options = {}) {
    if (typeof input === 'string') input = { budgetMonth: input };
    const timeZone = option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    const hasRequestedMonth = (
        (Object.prototype.hasOwnProperty.call(input, 'budgetMonth') && input.budgetMonth != null) ||
        (Object.prototype.hasOwnProperty.call(input, 'month') && input.month != null)
    );
    const requested = Object.prototype.hasOwnProperty.call(input, 'budgetMonth')
        ? input.budgetMonth
        : input.month;
    const month = !hasRequestedMonth
        ? getActiveBudgetMonth({
            nowInstant: option(options, actor, 'nowInstant', new Date().toISOString()),
            timeZone
        })
        : typeof requested === 'string'
            ? normalizeMonth(requested)
            : requested && typeof requested === 'object'
                ? normalizeMonth(requested)
                : monthFromInput(input);
    const period = getSalaryCyclePeriod({ budgetMonth: month, timeZone });
    const enabled = isSalaryCycleEnabled(options, actor);
    const pocketManaged = isPocketManagementEnabled(options, actor);
    // Managed reads are salary-cycle aware regardless of the legacy salary-cycle
    // flag; when Pocket Management is off, `enabled || false` leaves the legacy
    // week derivation exactly as before.
    const availableWeeks = (enabled || pocketManaged) ? listIntersectingIsoWeeks({ period }) : [];
    const selectedRaw = input.selectedWeek ?? input.week;
    let selectedWeek = selectedRaw ? normalizeWeek(selectedRaw) : null;
    if (selectedWeek && !availableWeeks.some(week => week.key === selectedWeek.key)) {
        throw new DomainValidationError('isoWeek', 'isoWeek must intersect the selected Budget Month.');
    }
    // Resolve the validated identity to the server-generated descriptor so an
    // explicit selection retains its inclusive salary-cycle intersection.
    if (selectedWeek) {
        selectedWeek = availableWeeks.find(week => week.key === selectedWeek.key);
    }

    // Pocket Management source-of-truth switch: when enabled, the Budget_Month
    // view is built exclusively from immutable Pocket_Assignment snapshots for
    // the selected month, never from the fixed POCKETS catalogue or the legacy
    // allocation collections, and a month with zero assignments is an
    // intentional empty state rather than a fixed-pocket substitution.
    if (pocketManaged) {
        // Guarded dual-read stage: when the dual-write compatibility flag is on
        // (only meaningful while the primary flag is on), a verified managed
        // assignment is preferred, the legacy source is consulted only for
        // records not yet migrated, fallback use is tracked, and ambiguous
        // double sources are flagged. When the compatibility flag is off, the
        // read is managed-only exactly as before.
        if (isDualReadActive(options, actor)) {
            return buildDualReadBudgetMonthView({
                actor,
                options,
                month,
                period,
                timeZone,
                availableWeeks,
                selectedWeek,
                enabled
            });
        }
        return buildManagedBudgetMonthView({
            actor,
            options,
            month,
            period,
            timeZone,
            availableWeeks,
            selectedWeek,
            enabled
        });
    }

    return buildLegacyBudgetMonthView({
        actor,
        options,
        month,
        period,
        timeZone,
        availableWeeks,
        selectedWeek,
        enabled
    });
}

/**
 * Build the Budget_Month view from the fixed POCKETS catalogue and the legacy
 * allocation collections. This is the exact behavior used when Pocket
 * Management is off, and the source consulted for records not yet migrated
 * during the guarded dual-read stage. Its output is unchanged from the previous
 * inline implementation.
 */
async function buildLegacyBudgetMonthView(context) {
    const { actor, options, month, period, timeZone, availableWeeks, selectedWeek, enabled } = context;
    const cadenceModel = option(options, actor, 'cadenceModel', PocketBudgetCadence);
    const monthlyModel = option(options, actor, 'monthlyModel', PocketBudget);
    const weeklyModel = option(options, actor, 'weeklyModel', WeeklyAllocation);
    const transactionModel = option(options, actor, 'transactionModel', Transaction);
    const guardModel = option(options, actor, 'guardModel', ClosedMonth);
    const [cadences, monthly, weekly, transactions, guard] = await Promise.all([
        findMany(cadenceModel, periodParts(month), { session: options.session }),
        findMany(monthlyModel, periodParts(month), { session: options.session }),
        findMany(weeklyModel, periodParts(month), { session: options.session }),
        findMany(transactionModel, { budgetMonth: month.month, budgetYear: month.year }, { session: options.session }),
        findOne(guardModel, periodParts(month), { session: options.session, lean: true })
    ]);

    const cadenceByPocket = new Map(cadences.map(value => [value.pocket, value]));
    const monthlyByPocket = new Map(monthly.map(value => [value.pocket, value]));
    const weeklyByKey = new Map(weekly.map(value => [
        `${value.pocket}:${value.isoWeekYear}-W${String(value.isoWeekNumber).padStart(2, '0')}`,
        value
    ]));
    const expanded = expandEligibleSpendingItems(
        transactions.map(transaction => transactionForCalculation(transaction, timeZone))
    );
    const pockets = [];

    for (const pocket of Object.keys(POCKETS)) {
        const cadenceRecord = cadenceByPocket.get(pocket);
        const cadence = enabled ? (cadenceRecord?.cadence || 'Monthly') : 'Monthly';
        const monthlyRecord = monthlyByPocket.get(pocket);
        const monthlyAllocation = monthlyRecord
            ? { ...asPlain(monthlyRecord), amount: monthlyRecord.budget }
            : null;
        const periodMetrics = calculatePocketPeriod(expanded, monthlyAllocation, {
            budgetMonth: month.key,
            pocket
        });
        const pocketWeeks = availableWeeks.map(week => {
            const key = `${pocket}:${week.weekYear}-W${String(week.weekNumber).padStart(2, '0')}`;
            const record = weeklyByKey.get(key);
            return {
                ...week,
                allocation: record
                    ? { ...asPlain(record), amount: record.budget }
                    : null
            };
        });
        const chosenWeek = selectedWeek || (cadence === 'Weekly' ? availableWeeks[0] : null);
        const selectedAllocation = chosenWeek
            ? weeklyByKey.get(`${pocket}:${chosenWeek.weekYear}-W${String(chosenWeek.weekNumber).padStart(2, '0')}`)
            : null;
        const selectedMetrics = chosenWeek
            ? calculatePocketWeek(expanded, selectedAllocation && { ...asPlain(selectedAllocation), amount: selectedAllocation.budget }, chosenWeek, {
                budgetMonth: month.key,
                pocket
            })
            : null;
        const activeAllocation = cadence === 'Weekly'
            ? pocketWeeks.reduce((sum, week) => sum + (week.allocation?.amount || 0), 0)
            : (monthlyRecord?.budget || 0);
        const activeAggregateMetrics = calculatePocketPeriod(expanded, { amount: activeAllocation }, {
            budgetMonth: month.key,
            pocket
        });
        const allocation = cadence === 'Weekly' ? selectedAllocation : monthlyRecord;
        const metrics = cadence === 'Weekly' ? selectedMetrics : periodMetrics;
        const plainAllocation = allocation ? { ...asPlain(allocation), amount: allocation.budget, budget: allocation.budget } : null;
        pockets.push({
            pocket,
            icon: POCKETS[pocket],
            cadence,
            cadenceRecord: cadenceRecord ? asPlain(cadenceRecord) : null,
            allocation: plainAllocation,
            allocationId: allocation?._id || null,
            // `_id` was the legacy monthly response field. Keep it as an
            // alias while allocationId identifies either cadence explicitly.
            _id: allocation?._id || null,
            missingAllocation: !allocation,
            budget: metrics.allocation,
            spent: metrics.spending,
            formattedBudget: formatCurrency(metrics.allocation),
            formattedSpent: formatCurrency(metrics.spending),
            remaining: metrics.remaining,
            formattedRemaining: formatCurrency(Math.abs(metrics.remaining)),
            percentage: metrics.percentageUsed,
            percentageUsed: metrics.percentageUsed,
            status: metrics.status,
            alertStatus: metrics.alertStatus,
            isOver: metrics.remaining < 0,
            metrics,
            periodMetrics: activeAggregateMetrics,
            availableWeeks: cadence === 'Weekly' ? pocketWeeks : [],
            selectedWeek: cadence === 'Weekly' && chosenWeek ? {
                ...chosenWeek,
                allocation: plainAllocation,
                metrics
            } : null,
            monthlyAllocation: monthlyAllocation,
            weeklyAllocations: cadence === 'Weekly' ? pocketWeeks : []
        });
    }

    const aggregate = calculateBudgetAggregate(pockets.map(pocket => ({
        allocation: pocket.periodMetrics.allocation,
        spending: pocket.periodMetrics.spending
    })));
    const active = getActiveBudgetMonth({
        nowInstant: option(options, actor, 'nowInstant', new Date().toISOString()),
        timeZone
    });
    const isClosed = guard ? guard.isClosed !== false : false;
    const canEdit = actor?.role === 'Wife' && !isClosed && editableMonths(active).includes(month.key);

    return {
        budgetMonth: month.key,
        month: month.month,
        year: month.year,
        featureEnabled: enabled,
        timeZone,
        period,
        salaryCyclePeriod: period,
        availableWeeks,
        selectedWeek: selectedWeek?.key || null,
        isClosed,
        canEdit,
        pockets: pockets.sort(sortByPocket),
        aggregate,
        totalBudget: aggregate.allocation,
        formattedTotal: formatCurrency(aggregate.allocation),
        totalSpent: aggregate.spending,
        formattedSpent: formatCurrency(aggregate.spending),
        totalRemaining: aggregate.remaining,
        formattedRemaining: formatCurrency(Math.abs(aggregate.remaining)),
        overallPercentage: aggregate.percentageUsed,
        isOverBudget: aggregate.remaining < 0,
        health: {
            status: aggregate.status,
            emoji: aggregate.status === 'danger' ? '🔴' : aggregate.status === 'warning' ? '🟡' : '🟢',
            label: aggregate.status === 'danger' ? 'Over Budget' : aggregate.status === 'warning' ? 'Caution' : 'On Track'
        }
    };
}

/**
 * Sum the active legacy allocation for one pocket name in a month, using the
 * legacy cadence to decide whether the monthly amount or the sum of the
 * intersecting weekly amounts is the active allocation. Used only to compare a
 * managed assignment against its legacy projection during the dual-read stage.
 */
function legacyActiveAllocation(name, { monthlyByName, weeklyByName, cadenceByName, enabled }) {
    const cadence = enabled ? (cadenceByName.get(name)?.cadence || 'Monthly') : 'Monthly';
    if (cadence === 'Weekly') {
        return (weeklyByName.get(name) || []).reduce((sum, record) => sum + (record.budget || 0), 0);
    }
    return monthlyByName.get(name)?.budget || 0;
}

/**
 * Attach the dual-read compatibility summary to a Budget_Month view. Only the
 * additive `compatibility` block and the `pocketManagementEnabled` marker are
 * added; every existing field is preserved so downstream consumers keep
 * working. This block appears only on the guarded dual-read path, so the
 * managed-only and feature-off views stay byte-for-byte unchanged.
 */
function annotateDualReadView(view, tracker, source) {
    return {
        ...view,
        pocketManagementEnabled: true,
        compatibility: {
            dualRead: true,
            source,
            fallbackCount: tracker.counts.fallback,
            ambiguousCount: tracker.counts.ambiguous,
            hasFallback: tracker.counts.fallback > 0,
            hasAmbiguous: tracker.counts.ambiguous > 0
        }
    };
}

/**
 * Guarded dual-read Budget_Month view.
 *
 * Managed Pocket_Assignment snapshots are authoritative and preferred. The
 * legacy allocation collections are read only to (a) serve a month that has no
 * managed assignments yet because it has not been migrated, and (b) detect an
 * ambiguous double source where a managed assignment and a legacy allocation
 * for the same pocket identity disagree. Every legacy fallback and every
 * ambiguity is tracked so a zero-fallback / zero-ambiguity observation window
 * can be verified before legacy retirement and before final activation.
 */
async function buildDualReadBudgetMonthView(context) {
    const { actor, options, month, enabled } = context;
    const tracker = resolveTracker(options, actor);

    const managedView = await buildManagedBudgetMonthView(context);

    const monthlyModel = option(options, actor, 'monthlyModel', PocketBudget);
    const weeklyModel = option(options, actor, 'weeklyModel', WeeklyAllocation);
    const cadenceModel = option(options, actor, 'cadenceModel', PocketBudgetCadence);
    const [monthly, weekly, cadences] = await Promise.all([
        findMany(monthlyModel, periodParts(month), { session: options.session }),
        findMany(weeklyModel, periodParts(month), { session: options.session }),
        findMany(cadenceModel, periodParts(month), { session: options.session })
    ]);

    const legacyNames = new Set();
    const monthlyByName = new Map();
    const cadenceByName = new Map();
    const weeklyByName = new Map();
    for (const record of monthly) {
        legacyNames.add(record.pocket);
        monthlyByName.set(record.pocket, record);
    }
    for (const record of cadences) {
        legacyNames.add(record.pocket);
        cadenceByName.set(record.pocket, record);
    }
    for (const record of weekly) {
        legacyNames.add(record.pocket);
        if (!weeklyByName.has(record.pocket)) weeklyByName.set(record.pocket, []);
        weeklyByName.get(record.pocket).push(record);
    }

    // No legacy allocation data: the managed month is authoritative. Managed
    // pockets are observed for the managed-read counter so a healthy dual-read
    // window shows managed reads with zero fallback.
    if (legacyNames.size === 0) {
        for (const pocket of managedView.pockets) {
            tracker.observeManaged({ source: 'managed', budgetMonth: month.key, pocketId: pocket.pocketId });
        }
        return annotateDualReadView(managedView, tracker, 'managed');
    }

    // A month with no managed assignments but present legacy allocations has
    // not been migrated: fall back to the complete legacy view and track one
    // fallback per legacy pocket so the fallback is observable for retirement.
    if (managedView.assignmentCount === 0) {
        for (const name of legacyNames) {
            const normalizedName = normalizePocketName(typeof name === 'string' ? name : '').normalizedName;
            tracker.observeFallback({
                source: 'legacy',
                collection: 'pocketbudgets',
                budgetMonth: month.key,
                pocketId: String(pocketDefinitionId(normalizedName))
            });
        }
        const legacyView = await buildLegacyBudgetMonthView(context);
        return annotateDualReadView(legacyView, tracker, 'legacy');
    }

    // Managed assignments exist: prefer them. Map each legacy pocket name to the
    // deterministic managed pocketId the migration would assign, then reconcile.
    // A legacy pocket whose id is managed and whose active legacy allocation
    // differs from the managed allocation is an ambiguous double source; a
    // legacy pocket whose id is not managed is an unmigrated fallback.
    const managedActiveById = new Map(
        managedView.pockets.map(pocket => [String(pocket.pocketId), pocket.periodMetrics?.allocation ?? 0])
    );
    for (const pocket of managedView.pockets) {
        tracker.observeManaged({ source: 'managed', budgetMonth: month.key, pocketId: pocket.pocketId });
    }

    const legacyRecords = [];
    for (const name of legacyNames) {
        const normalizedName = normalizePocketName(typeof name === 'string' ? name : '').normalizedName;
        const id = String(pocketDefinitionId(normalizedName));
        legacyRecords.push({
            pocketId: id,
            pocket: name,
            activeAllocation: legacyActiveAllocation(name, { monthlyByName, weeklyByName, cadenceByName, enabled })
        });
    }

    const { ambiguous } = reconcilePocketSources({
        managed: managedView.pockets,
        legacy: legacyRecords,
        keyOf: (record) => String(record.pocketId),
        // A legacy projection equal to the managed active allocation is the
        // expected compatibility state (the migration keeps legacy fields), not
        // an ambiguity. Only a disagreeing legacy record is flagged.
        isEquivalent: (managedPocket, legacyRecord) =>
            (managedActiveById.get(String(managedPocket.pocketId)) ?? 0) === (legacyRecord.activeAllocation ?? 0),
        // Managed pockets are already observed above; reconcile only needs to
        // classify legacy records, so use a scoped tracker that forwards only
        // fallback and ambiguity to the shared tracker.
        tracker: {
            observeManaged() {},
            observeFallback: (meta) => tracker.observeFallback({ ...meta, budgetMonth: month.key }),
            observeAmbiguous: (meta) => tracker.observeAmbiguous({ ...meta, budgetMonth: month.key }),
            counts: tracker.counts
        },
        metaOf: (record) => ({
            source: 'legacy',
            collection: 'pocketbudgets',
            budgetMonth: month.key,
            pocketId: record.pocketId
        })
    });

    const annotated = annotateDualReadView(managedView, tracker, 'managed');
    if (ambiguous.length > 0) {
        annotated.compatibility.ambiguousPocketIds = ambiguous.map(entry => entry.key);
    }
    return annotated;
}

async function protectWrite(month, actor, options, operation) {
    return runInTransaction(async session => withOpenBudgetPeriods(
        [{ month: month.month, year: month.year }],
        session,
        operation,
        { guardModel: option(options, actor, 'guardModel', ClosedMonth), actor: actorIdFor(actor) }
    ), options);
}

async function setCadence(command, actor, options = {}) {
    requireWife(actor);
    requireSalaryCycleEnabled(options, actor);
    const month = monthFromInput(command);
    const pocket = validatePocket(command.pocket);
    const cadence = normalizeCadence(command.cadence);
    assertEditable(month, actor, options);
    const cadenceModel = option(options, actor, 'cadenceModel', PocketBudgetCadence);
    const monthlyModel = option(options, actor, 'monthlyModel', PocketBudget);
    const weeklyModel = option(options, actor, 'weeklyModel', WeeklyAllocation);
    const actorId = actorIdFor(actor);

    // Read the current cadence and the allocations it would deactivate only
    // after the period fence has been acquired. Otherwise an allocation that
    // commits between a preflight read and this write could become inactive
    // without the required explicit confirmation.
    return protectWrite(month, actor, options, async (guard, session) => {
        const current = await findOne(cadenceModel, { pocket, ...periodParts(month) }, { session });
        const previous = current?.cadence || 'Monthly';
        if (previous !== cadence) {
            const inactiveModel = previous === 'Weekly' ? weeklyModel : monthlyModel;
            const inactive = await findMany(inactiveModel, {
                pocket,
                ...periodParts(month)
            }, { session });
            if (inactive.length > 0 && command.confirmInactive !== true) {
                throw new DomainValidationError(
                    'confirmInactive',
                    'Explicit confirmation is required before saved allocations become inactive.'
                );
            }
        }

        if (current && previous === cadence) return asPlain(current);

        const query = cadenceModel.findOneAndUpdate(
            { pocket, ...periodParts(month) },
            {
                $set: { cadence, updatedBy: actorId },
                $setOnInsert: { createdBy: actorId },
                $inc: { version: 1 }
            },
            { new: true, upsert: true, runValidators: true, session }
        );
        return asPlain(await executeQuery(query));
    });
}

async function putMonthlyAllocation(command, actor, options = {}) {
    requireWife(actor);
    const month = monthFromInput(command);
    const pocket = validatePocket(command.pocket);
    const amount = normalizeAmount(command.amount ?? command.budget);
    assertEditable(month, actor, options);
    const model = option(options, actor, 'monthlyModel', PocketBudget);
    const actorId = actorIdFor(actor);
    return protectWrite(month, actor, options, async (guard, session) => {
        if (typeof model.upsertAccepted === 'function') {
            const result = await model.upsertAccepted({
                pocket,
                ...periodParts(month),
                budget: amount,
                updatedBy: actorId,
                createdBy: actorId
            }, { session });
            const plain = asPlain(await executeQuery(result));
            return plain ? { ...plain, amount: plain.budget } : plain;
        }
        const query = model.findOneAndUpdate(
            { pocket, ...periodParts(month) },
            {
                $set: { budget: amount, updatedBy: actorId, schemaVersion: 2 },
                $setOnInsert: { createdBy: actorId },
                $inc: { version: 1 }
            },
            { new: true, upsert: true, runValidators: true, session }
        );
        const plain = asPlain(await executeQuery(query));
        return plain ? { ...plain, amount: plain.budget } : plain;
    });
}

async function putWeeklyAllocation(command, actor, options = {}) {
    requireWife(actor);
    requireSalaryCycleEnabled(options, actor);
    const month = monthFromInput(command);
    const pocket = validatePocket(command.pocket);
    const week = normalizeWeek(command.isoWeek ?? command.week);
    const amount = normalizeAmount(command.amount ?? command.budget);
    const period = getSalaryCyclePeriod({ budgetMonth: month, timeZone: option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE) });
    const weeks = listIntersectingIsoWeeks({ period });
    if (!weeks.some(item => item.key === week.key)) {
        throw new DomainValidationError('isoWeek', 'isoWeek must intersect the selected Budget Month.');
    }
    assertEditable(month, actor, options);
    const model = option(options, actor, 'weeklyModel', WeeklyAllocation);
    const actorId = actorIdFor(actor);
    return protectWrite(month, actor, options, async (guard, session) => {
        const query = model.findOneAndUpdate(
            { pocket, ...periodParts(month), isoWeekYear: week.weekYear, isoWeekNumber: week.weekNumber },
            {
                $set: { budget: amount, updatedBy: actorId },
                $setOnInsert: { createdBy: actorId },
                $inc: { version: 1 }
            },
            { new: true, upsert: true, runValidators: true, session }
        );
        const plain = asPlain(await executeQuery(query));
        return plain ? { ...plain, amount: plain.budget } : plain;
    });
}

async function deleteAllocation(command, actor, options = {}) {
    requireWife(actor);
    const allocationType = command.allocationType || command.type;
    if (!['monthly', 'weekly', 'Monthly', 'Weekly'].includes(allocationType)) {
        throw new DomainValidationError('allocationType', 'allocationType must be monthly or weekly.');
    }
    if (String(allocationType).toLowerCase() === 'weekly') {
        requireSalaryCycleEnabled(options, actor);
    }
    const model = String(allocationType).toLowerCase() === 'weekly'
        ? option(options, actor, 'weeklyModel', WeeklyAllocation)
        : option(options, actor, 'monthlyModel', PocketBudget);
    const id = validateIdentifier(command.id, 'id');
    const existing = await findOne(model, { _id: id }, { session: options.session });
    if (!existing) throw new RecordNotFoundError('allocation');
    const month = normalizeMonth(`${String(existing.year).padStart(4, '0')}-${String(existing.month).padStart(2, '0')}`);
    assertEditable(month, actor, options);

    return protectWrite(month, actor, options, async (guard, session) => {
        // Re-read after fencing so a concurrent delete cannot be reported as a
        // successful accepted command and so all work remains in one atomic
        // serializable transaction.
        const current = await findOne(model, { _id: id }, { session });
        if (!current) throw new RecordNotFoundError('allocation');
        let query = model.deleteOne({ _id: id });
        query = withSession(query, session);
        const result = await executeQuery(query);
        if (result && result.deletedCount === 0) throw new RecordNotFoundError('allocation');
        return { success: true, allocationId: id };
    });
}

async function toggleBudgetMonthClosed(command, actor, options = {}) {
    requireWife(actor);
    const month = monthFromInput(command);
    const guardModel = option(options, actor, 'guardModel', ClosedMonth);
    const actorId = actorIdFor(actor);
    return runInTransaction(async session => {
        const existing = await findOne(guardModel, periodParts(month), { session });
        // Missing guards represent open legacy periods. Any present state other
        // than explicit `false` is treated as closed, preserving old close
        // markers while they are upgraded in place.
        const currentlyClosed = Boolean(existing) && existing.isClosed !== false;
        const shouldClose = !currentlyClosed;
        const expectedClosed = existing ? currentlyClosed : undefined;
        const closedAt = shouldClose ? new Date() : null;
        const transition = {
            $set: {
                isClosed: shouldClose,
                closedAt,
                updatedBy: actorId,
                schemaVersion: guardModel.CURRENT_SCHEMA_VERSION || 2,
                ...(shouldClose ? { closedBy: actorId } : {})
            },
            $inc: { mutationSequence: 1 }
        };

        let result;
        if (typeof guardModel.transitionPeriod === 'function') {
            result = await executeQuery(guardModel.transitionPeriod({
                ...periodParts(month),
                actor: actorId,
                isClosed: shouldClose,
                expectedClosed,
                closedAt
            }, { session }));
        } else if (typeof guardModel.findOneAndUpdate === 'function') {
            const filter = { ...periodParts(month) };
            if (expectedClosed !== undefined) filter.isClosed = expectedClosed;
            result = await executeQuery(guardModel.findOneAndUpdate(filter, transition, {
                new: true,
                upsert: shouldClose && expectedClosed === undefined,
                runValidators: true,
                setDefaultsOnInsert: true,
                session
            }));
        } else if (shouldClose) {
            result = await executeQuery(guardModel.closePeriod({
                ...periodParts(month), actor: actorId, closedAt
            }, { session }));
        } else {
            result = await executeQuery(guardModel.reopenPeriod({
                ...periodParts(month), actor: actorId
            }, { session }));
        }

        if (!result) {
            // A conditional transition returning no document means another
            // guard state won the race. Let the transaction retry only for a
            // database write conflict; never mutate data without a state fence.
            throw new ConcurrentWriteConflictError({ budgetMonth: month.key });
        }
        return { ...asPlain(result), isClosed: shouldClose };
    }, options);
}

async function getBudgetHistory(actor, options = {}) {
    const timeZone = option(options, actor, 'timeZone', DEFAULT_HOUSEHOLD_TIME_ZONE);
    let keys;
    if (isPocketManagementEnabled(options, actor)) {
        // Managed history is enumerated from Pocket_Assignment months only, so a
        // legacy allocation collection can never resurrect a month that has no
        // managed assignments.
        const assignments = await findMany(
            option(options, actor, 'assignmentModel', PocketAssignment),
            {},
            { session: options.session }
        );
        keys = new Set(assignments.map(record => {
            const value = asPlain(record) || {};
            return `${String(value.budgetYear).padStart(4, '0')}-${String(value.budgetMonth).padStart(2, '0')}`;
        }));
    } else {
        const [monthly, cadences, weekly] = await Promise.all([
            findMany(option(options, actor, 'monthlyModel', PocketBudget), {}, { session: options.session }),
            findMany(option(options, actor, 'cadenceModel', PocketBudgetCadence), {}, { session: options.session }),
            findMany(option(options, actor, 'weeklyModel', WeeklyAllocation), {}, { session: options.session })
        ]);
        keys = new Set([
            ...monthly.map(value => `${value.year}-${String(value.month).padStart(2, '0')}`),
            ...cadences.map(value => `${value.year}-${String(value.month).padStart(2, '0')}`),
            ...weekly.map(value => `${value.year}-${String(value.month).padStart(2, '0')}`)
        ]);
    }
    const result = [];
    for (const key of [...keys].sort().reverse()) {
        const view = await getBudgetMonthView({ budgetMonth: key }, actor, options);
        result.push({
            budgetMonth: key,
            month: view.month,
            year: view.year,
            monthLabel: new Date(Date.UTC(view.year, view.month - 1, 1)).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
            period: view.period,
            totalBudget: view.aggregate.allocation,
            formattedTotal: formatCurrency(view.aggregate.allocation),
            totalSpent: view.aggregate.spending,
            pocketCount: view.pockets.filter(pocket => pocket.periodMetrics.allocation > 0 || pocket.periodMetrics.spending > 0).length,
            isClosed: view.isClosed
        });
    }
    return result;
}

function createBudgetService(defaultOptions = {}) {
    const merge = options => ({ ...defaultOptions, ...options });
    return {
        getBudgetMonthView: (input, actor, options) => getBudgetMonthView(input, actor, merge(options)),
        getBudget: (input, actor, options) => getBudgetMonthView(input, actor, merge(options)),
        getBudgetHistory: (actor, options) => getBudgetHistory(actor, merge(options)),
        setCadence: (command, actor, options) => setCadence(command, actor, merge(options)),
        putMonthlyAllocation: (command, actor, options) => putMonthlyAllocation(command, actor, merge(options)),
        putWeeklyAllocation: (command, actor, options) => putWeeklyAllocation(command, actor, merge(options)),
        deleteAllocation: (command, actor, options) => deleteAllocation(command, actor, merge(options)),
        toggleBudgetMonthClosed: (command, actor, options) => toggleBudgetMonthClosed(command, actor, merge(options)),
        getClosedBudgetMonths: (actor, options) => getClosedBudgetMonths(actor, merge(options))
    };
}

async function getClosedBudgetMonths(actor, options = {}) {
    const rows = await findMany(option(options, actor, 'guardModel', ClosedMonth), {}, {
        session: options.session,
        sort: { year: -1, month: -1 }
    });
    return rows.filter(row => row.isClosed !== false).map(row => ({
        month: row.month,
        year: row.year,
        key: `${row.year}-${String(row.month).padStart(2, '0')}`
    }));
}

module.exports = {
    CADENCES,
    getBudgetMonthView,
    getBudget: getBudgetMonthView,
    getBudgetHistory,
    getClosedBudgetMonths,
    setCadence,
    putMonthlyAllocation,
    putWeeklyAllocation,
    deleteAllocation,
    toggleBudgetMonthClosed,
    summarizeBanks,
    createBudgetService
};
