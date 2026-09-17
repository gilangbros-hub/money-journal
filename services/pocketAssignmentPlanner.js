'use strict';

const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    getSalaryCyclePeriod,
    listIntersectingIsoWeeks,
    parseBudgetMonth
} = require('./salaryCycleResolver');
const pocketValidation = require('./pocketValidation');
const {
    DomainValidationError,
    RecordNotFoundError,
    PocketAssignmentConflictError,
    PocketLifecycleConflictError
} = require('../utils/domainErrors');

/**
 * Salary-cycle-aware assignment planning.
 *
 * This module is the single place where the intersecting ISO weeks for a
 * Budget_Month are derived server-side and fed into the pure
 * `pocketValidation.canonicalizeAssignment` planner. Keeping the salary-cycle
 * period math here (delegated to the existing `salaryCycleResolver`) preserves
 * `pocketValidation` as a period-agnostic, independently testable layer, and
 * means neither the runtime service nor the migration re-derives period rules.
 *
 * The cadence, definition snapshot, default amount, and the required set of
 * allocation keys are all derived from the persisted `PocketDefinition` and the
 * server-derived weeks; a client-supplied cadence, default, or week list is
 * never treated as authoritative.
 *
 * Planning supports a batch of assignment entries (one Assignment_Setup
 * confirmation) and accumulates every independently evaluable error in a
 * deterministic order: entries are evaluated in submitted order, and within an
 * entry the field errors follow `canonicalizeAssignment`'s deterministic order.
 * Each accumulated error carries the offending entry's index. Because any error
 * rejects the complete confirmation (Requirements 5.13, 9.10), `plans` is empty
 * whenever `errors` is non-empty, so a partially valid batch is never returned.
 */

/**
 * Resolve the canonical `YYYY-MM` key for a Budget_Month supplied as a string,
 * a `{ key }` descriptor, or a `{ year, month }` pair. Throws a field-specific
 * DomainValidationError for anything else so the caller can surface a single
 * budget-month error rather than crashing.
 */
function budgetMonthKeyOf(budgetMonth) {
    if (typeof budgetMonth === 'string') {
        return parseBudgetMonth(budgetMonth).key;
    }
    if (budgetMonth && typeof budgetMonth === 'object') {
        if (typeof budgetMonth.key === 'string') {
            return parseBudgetMonth(budgetMonth.key).key;
        }
        if (Number.isInteger(budgetMonth.year) && Number.isInteger(budgetMonth.month)) {
            const key = `${String(budgetMonth.year).padStart(4, '0')}-${String(budgetMonth.month).padStart(2, '0')}`;
            return parseBudgetMonth(key).key;
        }
    }
    throw new DomainValidationError('budgetMonth', 'budgetMonth must use the YYYY-MM format.');
}

/**
 * Derive every Calendar_Week that intersects a Budget_Month's salary-cycle
 * period, in canonical week order. Each descriptor carries the canonical
 * `YYYY-Www` key, the ISO week-year/number used for storage, the week's own
 * Monday..Sunday bounds, and the inclusive intersection with the salary cycle.
 *
 * The `key`/`weekYear`/`weekNumber` fields are exactly what
 * `pocketValidation.normalizeWeeks` consumes; the extra date fields are ignored
 * by the planner but are useful to the setup DTO and summary rendering.
 *
 * @param {string|object} budgetMonth
 * @param {string} [timeZone]
 * @returns {Array<{ key: string, weekYear: number, weekNumber: number, startDate: string, endDate: string, intersectionStartDate: string, intersectionEndDate: string }>}
 */
function deriveIntersectingWeeks(budgetMonth, timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE) {
    const key = budgetMonthKeyOf(budgetMonth);
    const period = getSalaryCyclePeriod({ budgetMonth: key, timeZone });
    return listIntersectingIsoWeeks({ period }).map((week) => ({
        key: week.key,
        weekYear: week.weekYear,
        weekNumber: week.weekNumber,
        startDate: week.startDate,
        endDate: week.endDate,
        intersectionStartDate: week.intersectionStartDate,
        intersectionEndDate: week.intersectionEndDate
    }));
}

/**
 * Attach the batch entry index to an accumulated error's safe details so the
 * interface can associate a field error with the correct entry. The error
 * objects are freshly constructed per entry, so mutating their details is safe.
 */
function tagEntryIndex(error, index) {
    if (error && typeof error === 'object' && Number.isInteger(index)) {
        error.details = { ...(error.details || {}), entryIndex: index };
    }
    return error;
}

const identifierOf = (definition) => {
    if (!definition || typeof definition !== 'object') return undefined;
    if (definition.id !== undefined && definition.id !== null) return String(definition.id);
    if (definition._id !== undefined && definition._id !== null) return String(definition._id);
    return undefined;
};

/**
 * Build a `pocketId -> definition` lookup from a Map, an array of definition
 * documents/DTOs, or a plain object keyed by id.
 */
function buildDefinitionLookup(definitions) {
    const map = new Map();
    if (!definitions) return map;

    if (definitions instanceof Map) {
        for (const [id, definition] of definitions) {
            if (id !== undefined && id !== null) map.set(String(id), definition);
        }
        return map;
    }

    if (Array.isArray(definitions)) {
        for (const definition of definitions) {
            const id = identifierOf(definition);
            if (id !== undefined) map.set(id, definition);
        }
        return map;
    }

    if (typeof definitions === 'object') {
        for (const id of Object.keys(definitions)) {
            map.set(String(id), definitions[id]);
        }
    }

    return map;
}

/**
 * Plan a single assignment entry against an already-resolved definition, month
 * key, and derived weeks. This is a thin, salary-cycle-aware wrapper over
 * `pocketValidation.canonicalizeAssignment` used by both the single and batch
 * planners.
 *
 * @returns {{ plan: object|null, errors: DomainError[] }}
 */
function planAssignmentEntry(entry, definition, budgetMonthKey, weeks) {
    return pocketValidation.canonicalizeAssignment(entry, definition, budgetMonthKey, weeks);
}

/**
 * Plan a complete Assignment_Setup confirmation batch.
 *
 * @param {object} params
 * @param {string|object} params.budgetMonth  Selected Budget_Month.
 * @param {Array<object>} params.entries       Submitted assignment entries.
 * @param {Map|Array|object} params.definitions Referenced PocketDefinitions keyed by/derivable to pocketId.
 * @param {string} [params.timeZone]           Household IANA time zone.
 * @param {Array} [params.weeks]               Pre-derived intersecting weeks (else derived from budgetMonth/timeZone).
 * @returns {{ plans: object[], errors: DomainError[], combinedAllocationTotal: number, weeks: object[], budgetMonth: string|undefined }}
 */
function planAssignments({
    budgetMonth,
    entries,
    definitions,
    timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE,
    weeks
} = {}) {
    const errors = [];

    // Resolve the month key and intersecting weeks first. An invalid month is a
    // single batch-level error; there is nothing per-entry to evaluate without
    // the salary-cycle weeks.
    let budgetMonthKey;
    let derivedWeeks = Array.isArray(weeks) ? weeks : null;
    try {
        budgetMonthKey = budgetMonthKeyOf(budgetMonth);
        if (!derivedWeeks) {
            derivedWeeks = deriveIntersectingWeeks(budgetMonthKey, timeZone);
        }
    } catch (error) {
        errors.push(error);
        return {
            plans: [],
            errors,
            combinedAllocationTotal: 0,
            weeks: derivedWeeks || [],
            budgetMonth: budgetMonthKey
        };
    }

    if (!Array.isArray(entries)) {
        errors.push(new DomainValidationError('entries', 'entries must be provided as an array of assignment entries.'));
        return {
            plans: [],
            errors,
            combinedAllocationTotal: 0,
            weeks: derivedWeeks,
            budgetMonth: budgetMonthKey
        };
    }

    const lookup = buildDefinitionLookup(definitions);
    const plans = [];
    const seenPocketIds = new Set();

    entries.forEach((entry, index) => {
        const source = entry && typeof entry === 'object' ? entry : {};
        const rawPocketId = source.pocketId;
        const pocketId = rawPocketId === undefined || rawPocketId === null || rawPocketId === ''
            ? undefined
            : String(rawPocketId);

        if (!pocketId) {
            errors.push(tagEntryIndex(
                new DomainValidationError('pocketId', 'A pocketId is required for each assignment entry.'),
                index
            ));
            return;
        }

        // Requirement 5.11: a duplicate Pocket_Identifier in one confirmation is
        // a conflict. The first occurrence is evaluated normally; later ones are
        // reported and not re-planned.
        if (seenPocketIds.has(pocketId)) {
            errors.push(tagEntryIndex(
                new PocketAssignmentConflictError('POCKET_ASSIGNMENT_DUPLICATE', { pocketId }),
                index
            ));
            return;
        }
        seenPocketIds.add(pocketId);

        // Requirement 5.12: an unknown or archived pocket reference yields one
        // error per invalid Pocket_Identifier, accumulated with the others.
        const definition = lookup.get(pocketId);
        if (!definition) {
            errors.push(tagEntryIndex(new RecordNotFoundError('pocket'), index));
            return;
        }
        if (definition.status === 'Archived') {
            errors.push(tagEntryIndex(
                new PocketLifecycleConflictError('POCKET_ARCHIVED_CONFLICT', { pocketId }),
                index
            ));
            return;
        }

        const { plan, errors: entryErrors } = planAssignmentEntry(
            source,
            definition,
            budgetMonthKey,
            derivedWeeks
        );

        if (entryErrors && entryErrors.length > 0) {
            entryErrors.forEach((error) => errors.push(tagEntryIndex(error, index)));
            return;
        }

        plans.push({ ...plan, entryIndex: index });
    });

    // Requirements 5.13 / 9.10: any evaluable error rejects the complete batch.
    if (errors.length > 0) {
        return {
            plans: [],
            errors,
            combinedAllocationTotal: 0,
            weeks: derivedWeeks,
            budgetMonth: budgetMonthKey
        };
    }

    // Requirement 5.10: the combined allocation total counts every Monthly and
    // Weekly allocation returned for the month exactly once.
    const combinedAllocationTotal = plans.reduce(
        (total, plan) => total + (Number.isFinite(plan.allocationTotal) ? plan.allocationTotal : 0),
        0
    );

    return {
        plans,
        errors: [],
        combinedAllocationTotal,
        weeks: derivedWeeks,
        budgetMonth: budgetMonthKey
    };
}

module.exports = {
    budgetMonthKeyOf,
    deriveIntersectingWeeks,
    planAssignmentEntry,
    planAssignments
};
