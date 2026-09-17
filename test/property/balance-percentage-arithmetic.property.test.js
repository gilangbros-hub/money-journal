'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
    calculateBudgetAggregate,
    calculatePocketPeriod,
    calculatePocketWeek
} = require('../../services/budgetCalculationService');
const { safeIntegerRupiahArbitrary } = require('../arbitraries');
const { assertProperty, propertyOptions } = require('../helpers');

const WEEK_INTERSECTION = {
    startDate: '2027-02-22',
    endDate: '2027-02-24'
};

const missingAllocationArbitrary = fc.constantFrom(undefined, null, {});
const allocationInputArbitrary = fc.oneof(
    safeIntegerRupiahArbitrary,
    missingAllocationArbitrary
);
const balanceCaseArbitrary = fc.record({
    allocation: allocationInputArbitrary,
    spending: safeIntegerRupiahArbitrary
});

// Feature: salary-cycle-budgeting, Property 11: Remaining balance and percentage arithmetic are consistent
// **Validates: Requirements 6.7, 6.8, 6.9, 6.10, 7.13, 7.14, 7.15**

test('Property 11: balance and percentage arithmetic matches the direct oracle', () => {
    assertProperty(
        fc.property(balanceCaseArbitrary, scenario => {
            assertScenarioMatchesOracle(scenario);
        }),
        propertyOptions({ numRuns: 100 })
    );
});

test('Property 11: explicit zero, equality, one-unit, missing, and large cases match the oracle', () => {
    const large = Number.MAX_SAFE_INTEGER;
    const explicitCases = [
        { allocation: 0, spending: 0 },
        { allocation: 1, spending: 0 },
        { allocation: 1, spending: 1 },
        { allocation: 1, spending: 2 },
        { allocation: large, spending: large - 1 },
        { allocation: large, spending: large },
        { allocation: large, spending: 0 },
        { allocation: undefined, spending: 0 },
        { allocation: null, spending: 1 },
        { allocation: {}, spending: large }
    ];

    for (const scenario of explicitCases) {
        assertScenarioMatchesOracle(scenario);
    }
});

function assertScenarioMatchesOracle({ allocation, spending }) {
    const expected = arithmeticOracle(allocation, spending);
    const items = [{ amount: spending, expenseDate: '2027-02-23' }];

    const period = calculatePocketPeriod(items, allocation);
    const week = calculatePocketWeek(items, allocation, WEEK_INTERSECTION);
    const aggregate = calculateBudgetAggregate([period]);

    assertArithmeticMetrics(period, expected, 'pocket period');
    assertArithmeticMetrics(week, expected, 'pocket week');
    assertArithmeticMetrics(aggregate, expected, 'budget aggregate');
}

/**
 * Independent arithmetic oracle for Property 11. It intentionally does not
 * call any calculation-service helper so balance and percentage regressions
 * cannot be reproduced by sharing the implementation under test.
 */
function arithmeticOracle(allocation, spending) {
    const normalizedAllocation = typeof allocation === 'number' &&
        Number.isFinite(allocation) && allocation >= 0
        ? allocation
        : 0;

    return {
        allocation: normalizedAllocation,
        spending,
        remaining: normalizedAllocation - spending,
        percentageUsed: normalizedAllocation > 0
            ? Math.round((spending / normalizedAllocation) * 100)
            : 0,
        isOver: normalizedAllocation - spending < 0
    };
}

function assertArithmeticMetrics(actual, expected, label) {
    assert.equal(actual.allocation, expected.allocation, `${label} allocation`);
    assert.equal(actual.spending, expected.spending, `${label} spending`);
    assert.equal(actual.remaining, expected.remaining, `${label} remaining`);
    assert.equal(actual.percentageUsed, expected.percentageUsed, `${label} percentage`);
    assert.equal(actual.isOver, expected.isOver, `${label} over-state`);
}
