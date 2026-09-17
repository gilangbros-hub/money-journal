'use strict';

const ClosedMonth = require('../models/closedMonth');
const {
    DomainValidationError,
    ClosedBudgetPeriodError,
    ConcurrentWriteConflictError
} = require('../utils/domainErrors');

/**
 * Return the canonical key used to order Budget Period guards.  Ordering is
 * important when an operation touches two periods: every caller acquires the
 * same pair in the same order, avoiding application-level deadlocks.
 */
function budgetMonthKey({ month, year }) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function normalizePeriod(period, field = 'budgetMonth') {
    const value = period && typeof period === 'object' ? period : {};
    const month = value.month;
    const year = value.year;

    if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new DomainValidationError(`${field}.month`, 'month must be an integer from 1 through 12.');
    }
    if (!Number.isInteger(year) || year < 1) {
        throw new DomainValidationError(`${field}.year`, 'year must be a positive integer.');
    }

    const normalized = {
        month,
        year,
        key: budgetMonthKey({ month, year })
    };
    const label = value.label || value.role;
    if (label === 'source' || label === 'destination') normalized.label = label;
    return normalized;
}

function comparePeriods(left, right) {
    return left.year - right.year || left.month - right.month;
}

function normalizePeriods(periods) {
    if (!Array.isArray(periods) || periods.length === 0) {
        throw new DomainValidationError('budgetMonth', 'At least one Budget Month is required.');
    }

    const unique = new Map();
    periods.forEach((period, index) => {
        const normalized = normalizePeriod(period, `budgetMonth[${index}]`);
        unique.set(normalized.key, normalized);
    });

    return [...unique.values()].sort(comparePeriods);
}

function isDuplicateKeyError(error) {
    return error && (error.code === 11000 || error.codeName === 'DuplicateKey');
}

function isConcurrentConflict(error) {
    return isDuplicateKeyError(error)
        || error?.code === 112
        || error?.codeName === 'WriteConflict';
}

async function executeQuery(query) {
    return typeof query?.exec === 'function' ? query.exec() : query;
}

function withSession(query, session) {
    return typeof query?.session === 'function' ? query.session(session) : query;
}

function closedError(period, label) {
    const details = label ? { [`${label}BudgetMonth`]: period.key } : {};
    return new ClosedBudgetPeriodError(period.key, details);
}

/**
 * Atomically fence one open Budget Period guard.
 *
 * The ensure-upsert is intentionally in the caller's transaction. It makes
 * the additive rollout safe for a legacy period without a guard, but it never
 * changes an existing closed guard to open. The following conditional update
 * both requires an open guard and increments mutationSequence, so a close or
 * reopen that wins the same guard cannot be followed by a protected write in
 * this transaction.
 */
async function fencePeriod(period, session, {
    guardModel = ClosedMonth,
    actor,
    label
} = {}) {
    try {
        const ensureQuery = guardModel.ensureOpen({
            month: period.month,
            year: period.year,
            actor
        }, { session });
        await executeQuery(ensureQuery);
    } catch (error) {
        if (isConcurrentConflict(error)) {
            throw new ConcurrentWriteConflictError({ budgetMonth: period.key });
        }
        throw error;
    }

    let fenced;
    try {
        fenced = await executeQuery(guardModel.findOneAndUpdate(
            {
                month: period.month,
                year: period.year,
                isClosed: false
            },
            {
                $inc: { mutationSequence: 1 }
            },
            {
                new: true,
                session,
                runValidators: true
            }
        ));
    } catch (error) {
        if (isConcurrentConflict(error)) {
            throw new ConcurrentWriteConflictError({ budgetMonth: period.key });
        }
        throw error;
    }

    if (fenced) return fenced;

    // A null conditional update means a committed closed state (or an
    // unexpected concurrent guard change). Read through the same session only
    // to select the stable typed error; the caller's transaction still aborts.
    const stateQuery = withSession(guardModel.findOne({
        month: period.month,
        year: period.year
    }), session);
    const state = await executeQuery(stateQuery);
    if (state && state.isClosed !== false) throw closedError(period, label);

    // Missing/open-but-unfenced is a write conflict, never permission to run
    // the protected operation without a fence.
    throw new ConcurrentWriteConflictError({ budgetMonth: period.key });
}

/**
 * Acquire all requested open Budget Period fences in deterministic order and
 * invoke the protected operation only after every fence succeeds.
 *
 * This function does not start or commit a transaction. The supplied session
 * must be the session used by the surrounding `withTransaction` callback;
 * every guard query and the operation's writes therefore share one atomic
 * transaction. If the operation throws, the surrounding transaction helper
 * aborts both the business write and every guard increment/upsert.
 */
async function withOpenBudgetPeriods(periods, session, operation, options = {}) {
    if (!session || typeof session !== 'object') {
        throw new TypeError('A MongoDB session is required.');
    }
    if (typeof operation !== 'function') {
        throw new TypeError('A protected operation callback is required.');
    }

    const normalized = normalizePeriods(periods);
    const guards = [];
    for (const period of normalized) {
        guards.push(await fencePeriod(period, session, options));
    }

    // A single-period caller gets the document it expects; a cross-period
    // caller gets the sorted guard array. The session and normalized periods
    // are also supplied for service code that needs explicit context.
    const value = guards.length === 1 ? guards[0] : guards;
    return operation(value, session, normalized);
}

/**
 * Guard a single Budget Month, or pass an array of source/destination periods
 * to acquire them in sorted order. Object form is supported for service code:
 * `withOpenBudgetPeriod({ month, year }, session, operation)`.
 */
function withOpenBudgetPeriod(monthOrPeriods, yearOrSession, sessionOrOperation, operationOrOptions, maybeOptions) {
    if (Array.isArray(monthOrPeriods)) {
        return withOpenBudgetPeriods(
            monthOrPeriods,
            yearOrSession,
            sessionOrOperation,
            operationOrOptions || {}
        );
    }

    if (monthOrPeriods && typeof monthOrPeriods === 'object') {
        if (monthOrPeriods.source && monthOrPeriods.destination) {
            return withOpenBudgetPeriods(
                [
                    { ...monthOrPeriods.source, label: 'source' },
                    { ...monthOrPeriods.destination, label: 'destination' }
                ],
                yearOrSession,
                sessionOrOperation,
                operationOrOptions || {}
            );
        }

        const period = normalizePeriod(monthOrPeriods);
        return withOpenBudgetPeriods(
            [period],
            yearOrSession,
            sessionOrOperation,
            operationOrOptions || {}
        );
    }

    return withOpenBudgetPeriods(
        [{ month: monthOrPeriods, year: yearOrSession }],
        sessionOrOperation,
        operationOrOptions,
        maybeOptions || {}
    );
}

module.exports = {
    budgetMonthKey,
    comparePeriods,
    normalizePeriod,
    normalizePeriods,
    withOpenBudgetPeriod,
    withOpenBudgetPeriods
};
