'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    aggregateStatus,
    allocationAlertStatus,
    calculateBudgetAggregate,
    calculatePocketPeriod,
    calculatePocketWeek,
    expandEligibleSpendingItems,
    filterEligibleSpendingItems,
    getWeeklySalaryCycleIntersection,
    percentageUsed,
    pocketStatus,
    remainingAmount
} = require('../../services/budgetCalculationService');
const {
    getSalaryCyclePeriod
} = require('../../services/salaryCycleResolver');

const transactions = [
    {
        _id: 'single-groceries',
        expenseDate: '2027-02-23',
        budgetMonth: 2,
        budgetYear: 2027,
        pocket: 'Groceries',
        amount: 100,
        sourceType: 'single'
    },
    {
        _id: 'split-expense',
        expenseDate: '2027-02-24',
        budgetMonth: 2,
        budgetYear: 2027,
        pocket: 'Groceries',
        amount: 300,
        sourceType: 'multi',
        sourceBreakdowns: [
            { pocket: 'Groceries', amount: 100 },
            { pocket: 'Weekday Transport', amount: 200 }
        ]
    },
    {
        _id: 'next-period',
        expenseDate: '2027-02-25',
        budgetMonth: 3,
        budgetYear: 2027,
        pocket: 'Groceries',
        amount: 50,
        sourceType: 'single'
    }
];

test('expands singles once and split expenses only into pocket shares', () => {
    const items = expandEligibleSpendingItems(transactions);

    assert.equal(items.length, 4);
    assert.deepEqual(
        items.map(item => [item.transactionId, item.pocket, item.amount]),
        [
            ['single-groceries', 'Groceries', 100],
            ['split-expense', 'Groceries', 100],
            ['split-expense', 'Weekday Transport', 200],
            ['next-period', 'Groceries', 50]
        ]
    );
    assert.equal(items.filter(item => item.transactionId === 'split-expense')
        .reduce((total, item) => total + item.amount, 0), 300);
});

test('eligibility uses the stored Budget_Month and pocket, not a derived date', () => {
    const items = expandEligibleSpendingItems(transactions);
    const groceriesFebruary = filterEligibleSpendingItems(items, {
        budgetMonth: '2027-02',
        pocket: 'Groceries'
    });

    assert.deepEqual(
        groceriesFebruary.map(item => item.transactionId),
        ['single-groceries', 'split-expense']
    );
    assert.deepEqual(
        expandEligibleSpendingItems(transactions, {
            budgetMonth: { year: 2027, month: 2 },
            pocket: 'Weekday Transport'
        }).map(item => item.amount),
        [200]
    );
});

test('weekly calculations use the inclusive salary-cycle/week intersection', () => {
    const februaryPeriod = getSalaryCyclePeriod({ budgetMonth: '2027-02' });
    const marchPeriod = getSalaryCyclePeriod({ budgetMonth: '2027-03' });
    const februaryIntersection = getWeeklySalaryCycleIntersection(
        februaryPeriod,
        '2027-W08'
    );
    const marchIntersection = getWeeklySalaryCycleIntersection(
        marchPeriod,
        '2027-W08'
    );
    const items = expandEligibleSpendingItems(transactions);

    assert.deepEqual(februaryIntersection, {
        startDate: '2027-02-22',
        endDate: '2027-02-24'
    });
    assert.deepEqual(marchIntersection, {
        startDate: '2027-02-25',
        endDate: '2027-02-28'
    });

    const february = calculatePocketWeek(
        items,
        200,
        februaryIntersection,
        { budgetMonth: '2027-02', pocket: 'Groceries' }
    );
    const march = calculatePocketWeek(
        items,
        100,
        marchIntersection,
        { budgetMonth: '2027-03', pocket: 'Groceries' }
    );

    assert.equal(february.spending, 200);
    assert.equal(march.spending, 50);
    assert.equal(february.remaining, 0);
    assert.equal(march.remaining, 50);
});

test('missing allocation is zero while spending and negative remaining remain visible', () => {
    const metrics = calculatePocketPeriod([
        { pocket: 'Groceries', amount: 250 }
    ], null);

    assert.deepEqual(metrics, {
        allocation: 0,
        spending: 250,
        remaining: -250,
        percentageUsed: 0,
        alertStatus: 'none',
        status: 'good',
        isOver: true
    });
    assert.equal(remainingAmount(250, undefined), -250);
    assert.equal(percentageUsed(250, undefined), 0);
});

test('monthly and weekly alert thresholds use 80 and 100 percent boundaries', () => {
    assert.equal(allocationAlertStatus(79, 100), 'none');
    assert.equal(allocationAlertStatus(80, 100), 'warning');
    assert.equal(allocationAlertStatus(99, 100), 'warning');
    assert.equal(allocationAlertStatus(100, 100), 'danger');
    assert.equal(allocationAlertStatus(200, 100), 'danger');

    const weekly = calculatePocketWeek([], 100, {
        startDate: '2027-02-22',
        endDate: '2027-02-24'
    });
    assert.equal(weekly.alertStatus, 'none');
});

test('Check Pockets and aggregate status thresholds are distinct and deterministic', () => {
    assert.equal(pocketStatus(69, 100), 'good');
    assert.equal(pocketStatus(70, 100), 'warning');
    assert.equal(pocketStatus(89, 100), 'warning');
    assert.equal(pocketStatus(90, 100), 'danger');

    assert.equal(aggregateStatus(69, 100), 'good');
    assert.equal(aggregateStatus(70, 100), 'warning');
    assert.equal(aggregateStatus(99, 100), 'warning');
    assert.equal(aggregateStatus(100, 100), 'danger');
    assert.equal(aggregateStatus(50, 0), 'good');
});

test('aggregate sums separated items once and never adds a split parent amount', () => {
    const items = expandEligibleSpendingItems(transactions);
    const groceries = calculatePocketPeriod(
        filterEligibleSpendingItems(items, { budgetMonth: '2027-02', pocket: 'Groceries' }),
        500
    );
    const transport = calculatePocketPeriod(
        filterEligibleSpendingItems(items, { budgetMonth: '2027-02', pocket: 'Weekday Transport' }),
        250
    );
    const aggregate = calculateBudgetAggregate([groceries, transport]);

    assert.equal(groceries.spending, 200);
    assert.equal(transport.spending, 200);
    assert.equal(aggregate.allocation, 750);
    assert.equal(aggregate.spending, 400);
    assert.equal(aggregate.remaining, 350);
    assert.equal(aggregate.percentageUsed, 53);
});
