'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { POCKETS } = require('../../utils/constants');
const {
    calculateBudgetAggregate
} = require('../../services/budgetCalculationService');
const { assertProperty, propertyOptions } = require('../helpers');
const { safeIntegerRupiahArbitrary } = require('../arbitraries');
const {
    activeAllocation,
    applyCadenceChange,
    applyMonthlyAllocation,
    applyWeeklyAllocation
} = require('../../services/budgetAllocationState');

const pocketArbitrary = fc.constantFrom(...Object.keys(POCKETS));
const yearArbitrary = fc.integer({ min: 2020, max: 2035 });
const monthArbitrary = fc.integer({ min: 1, max: 12 });
const isoWeekYearArbitrary = fc.integer({ min: 2020, max: 2035 });
const isoWeekNumberArbitrary = fc.integer({ min: 1, max: 53 });
const cadenceArbitrary = fc.constantFrom('Monthly', 'Weekly');

const cadenceEntryArbitrary = fc.record({
    pocket: pocketArbitrary,
    month: monthArbitrary,
    year: yearArbitrary,
    cadence: cadenceArbitrary
});
const monthlyEntryArbitrary = fc.record({
    pocket: pocketArbitrary,
    month: monthArbitrary,
    year: yearArbitrary,
    budget: safeIntegerRupiahArbitrary
});
const weeklyEntryArbitrary = fc.record({
    pocket: pocketArbitrary,
    month: monthArbitrary,
    year: yearArbitrary,
    isoWeekYear: isoWeekYearArbitrary,
    isoWeekNumber: isoWeekNumberArbitrary,
    budget: safeIntegerRupiahArbitrary
});

/**
 * The property intentionally normalizes every generated collection before it
 * reaches the implementation. The reference model uses separate composite
 * key functions and map replacement, rather than cloning or calling the
 * allocation-state transitions under test.
 */
const normalizedStateArbitrary = fc.record({
    cadences: fc.uniqueArray(cadenceEntryArbitrary, {
        minLength: 2,
        maxLength: 6,
        selector: referenceMonthlyKey
    }),
    monthlyAllocations: fc.uniqueArray(monthlyEntryArbitrary, {
        minLength: 2,
        maxLength: 6,
        selector: referenceMonthlyKey
    }),
    weeklyAllocations: fc.uniqueArray(weeklyEntryArbitrary, {
        minLength: 2,
        maxLength: 6,
        selector: referenceWeeklyKey
    })
}).map(normalizeState);

const transitionCaseArbitrary = fc.record({
    state: normalizedStateArbitrary,
    cadenceBudget: cadenceArbitrary,
    monthlyBudget: safeIntegerRupiahArbitrary,
    weeklyBudget: safeIntegerRupiahArbitrary
});

// Feature: salary-cycle-budgeting, Property 10: Cadence and allocation updates are isolated by key
// **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.7, 4.12, 5.7**
test('Property 10: cadence and allocation updates are isolated by key', () => {
    assertProperty(
        fc.property(transitionCaseArbitrary, scenario => {
            const { state } = scenario;
            const cadenceTarget = state.cadences[0];
            const monthlyTarget = state.monthlyAllocations[0];
            const weeklyTarget = state.weeklyAllocations[0];

            assertActiveAggregatesMatchReference(state);

            const cadenceCommand = {
                ...cadenceTarget,
                cadence: scenario.cadenceBudget
            };
            const cadenceActual = applyCadenceChange(state, cadenceCommand);
            const cadenceExpected = referenceApplyCadenceChange(state, cadenceCommand);
            assertStateEqual(cadenceActual, cadenceExpected);
            assertCollectionUnchanged(state.monthlyAllocations, cadenceActual.monthlyAllocations);
            assertCollectionUnchanged(state.weeklyAllocations, cadenceActual.weeklyAllocations);
            assertActiveAggregatesMatchReference(cadenceActual);

            const monthlyCommand = {
                ...monthlyTarget,
                budget: scenario.monthlyBudget
            };
            const monthlyActual = applyMonthlyAllocation(state, monthlyCommand);
            const monthlyExpected = referenceApplyMonthlyAllocation(state, monthlyCommand);
            assertStateEqual(monthlyActual, monthlyExpected);
            assertCollectionUnchanged(state.cadences, monthlyActual.cadences);
            assertCollectionUnchanged(state.weeklyAllocations, monthlyActual.weeklyAllocations);
            assertOnlyTargetEntryChanged(
                state.monthlyAllocations,
                monthlyActual.monthlyAllocations,
                referenceMonthlyKey(monthlyTarget)
            );
            assertActiveAggregatesMatchReference(monthlyActual);

            const weeklyCommand = {
                ...weeklyTarget,
                budget: scenario.weeklyBudget
            };
            const weeklyActual = applyWeeklyAllocation(state, weeklyCommand);
            const weeklyExpected = referenceApplyWeeklyAllocation(state, weeklyCommand);
            assertStateEqual(weeklyActual, weeklyExpected);
            assertCollectionUnchanged(state.cadences, weeklyActual.cadences);
            assertCollectionUnchanged(state.monthlyAllocations, weeklyActual.monthlyAllocations);
            assertOnlyTargetEntryChanged(
                state.weeklyAllocations,
                weeklyActual.weeklyAllocations,
                referenceWeeklyKey(weeklyTarget)
            );
            assertActiveAggregatesMatchReference(weeklyActual);
        }),
        propertyOptions({ numRuns: 100 })
    );
});

/** Independent monthly composite key oracle. */
function referenceMonthlyKey(entry) {
    return `${entry.pocket}:${String(entry.year).padStart(4, '0')}-${String(entry.month).padStart(2, '0')}`;
}

/** Independent weekly composite key oracle, including the ISO week identity. */
function referenceWeeklyKey(entry) {
    return `${referenceMonthlyKey(entry)}:${entry.isoWeekYear}-W${String(entry.isoWeekNumber).padStart(2, '0')}`;
}

function normalizeCollection(entries, keyFn) {
    return [...new Map(entries.map(entry => [keyFn(entry), { ...entry }])).values()]
        .sort((left, right) => keyFn(left).localeCompare(keyFn(right)));
}

function normalizeState(state) {
    return {
        cadences: normalizeCollection(state.cadences, referenceMonthlyKey),
        monthlyAllocations: normalizeCollection(state.monthlyAllocations, referenceMonthlyKey),
        weeklyAllocations: normalizeCollection(state.weeklyAllocations, referenceWeeklyKey)
    };
}

function stateForComparison(state) {
    return normalizeState(state);
}

function assertStateEqual(actual, expected) {
    assert.deepEqual(stateForComparison(actual), stateForComparison(expected));
}

function assertCollectionUnchanged(before, after) {
    assert.deepEqual(
        normalizeCollection(after, before === undefined ? referenceMonthlyKey : inferKey(before)),
        normalizeCollection(before, before === undefined ? referenceMonthlyKey : inferKey(before))
    );
}

function inferKey(entries) {
    return entries.some(entry => Object.prototype.hasOwnProperty.call(entry, 'isoWeekNumber'))
        ? referenceWeeklyKey
        : referenceMonthlyKey;
}

function assertOnlyTargetEntryChanged(before, after, targetKey) {
    const keyFn = inferKey(before);
    const beforeByKey = new Map(before.map(entry => [keyFn(entry), entry]));
    const afterByKey = new Map(after.map(entry => [keyFn(entry), entry]));
    assert.deepEqual([...beforeByKey.keys()].sort(), [...afterByKey.keys()].sort());
    for (const [key, entry] of beforeByKey) {
        if (key !== targetKey) assert.deepEqual(afterByKey.get(key), entry);
    }
}

function referenceApplyCadenceChange(state, command) {
    return {
        ...state,
        cadences: replaceEntry(
            state.cadences,
            referenceMonthlyKey,
            command,
            entry => ({ ...entry, cadence: command.cadence })
        )
    };
}

function referenceApplyMonthlyAllocation(state, command) {
    return {
        ...state,
        monthlyAllocations: replaceEntry(
            state.monthlyAllocations,
            referenceMonthlyKey,
            command,
            entry => ({ ...entry, budget: command.budget })
        )
    };
}

function referenceApplyWeeklyAllocation(state, command) {
    return {
        ...state,
        weeklyAllocations: replaceEntry(
            state.weeklyAllocations,
            referenceWeeklyKey,
            command,
            entry => ({ ...entry, budget: command.budget })
        )
    };
}

function replaceEntry(entries, keyFn, command, update) {
    const targetKey = keyFn(command);
    return normalizeCollection(
        entries.map(entry => keyFn(entry) === targetKey ? update(entry) : entry),
        keyFn
    );
}

function referenceActiveAllocation(state, target) {
    const cadence = state.cadences.find(entry =>
        referenceMonthlyKey(entry) === referenceMonthlyKey(target)
    )?.cadence || 'Monthly';

    if (cadence === 'Weekly') {
        return state.weeklyAllocations
            .filter(entry => (
                entry.pocket === target.pocket &&
                entry.month === target.month &&
                entry.year === target.year
            ))
            .reduce((total, entry) => total + entry.budget, 0);
    }

    return state.monthlyAllocations.find(entry =>
        referenceMonthlyKey(entry) === referenceMonthlyKey(target)
    )?.budget || 0;
}

function aggregateOracle(metrics) {
    const allocation = metrics.reduce((total, metric) => total + metric.allocation, 0);
    const spending = metrics.reduce((total, metric) => total + metric.spending, 0);
    const remaining = allocation - spending;
    const percentageUsed = allocation > 0 ? Math.round((spending / allocation) * 100) : 0;
    return {
        allocation,
        spending,
        remaining,
        percentageUsed,
        status: percentageUsed >= 100 ? 'danger' : percentageUsed >= 70 ? 'warning' : 'good',
        isOver: remaining < 0
    };
}

function assertActiveAggregatesMatchReference(state) {
    const metrics = state.cadences.map((target, index) => ({
        allocation: activeAllocation(state, target.pocket, target),
        spending: index + 1
    }));
    const expectedMetrics = state.cadences.map((target, index) => ({
        allocation: referenceActiveAllocation(state, target),
        spending: index + 1
    }));

    assert.deepEqual(metrics, expectedMetrics);
    assert.deepEqual(calculateBudgetAggregate(metrics), aggregateOracle(expectedMetrics));
}
