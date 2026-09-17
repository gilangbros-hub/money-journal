'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
    calculateBudgetAggregate,
    calculatePocketPeriod,
    calculatePocketWeek,
    expandEligibleSpendingItems
} = require('../../services/budgetCalculationService');
const { pocketArbitrary } = require('../arbitraries');

// Keep the generated collection within the exactly representable integer range
// because the production calculation API intentionally returns JavaScript numbers.
const MAX_GENERATED_AMOUNT = 1_000_000_000_000;
const BUDGET_MONTH = '2027-02';
const EXPENSE_DATE = '2027-02-10';
const WEEK_INTERSECTION = {
    startDate: '2027-02-01',
    endDate: '2027-02-28'
};

function singleExpenseArbitrary() {
    return fc.record({
        pocket: pocketArbitrary,
        amount: fc.integer({ min: 1, max: MAX_GENERATED_AMOUNT })
    }).map(({ pocket, amount }) => ({
        expenseDate: EXPENSE_DATE,
        budgetMonth: 2,
        budgetYear: 2027,
        pocket,
        amount,
        sourceType: 'single'
    }));
}

function splitExpenseArbitrary({ minPockets = 1, maxPockets = 3 } = {}) {
    return fc.uniqueArray(pocketArbitrary, {
        minLength: minPockets,
        maxLength: maxPockets
    }).chain(pockets =>
        fc.array(fc.integer({ min: 1, max: MAX_GENERATED_AMOUNT }), {
            minLength: pockets.length,
            maxLength: pockets.length
        }).map(amounts => ({
            expenseDate: EXPENSE_DATE,
            budgetMonth: 2,
            budgetYear: 2027,
            amount: amounts.reduce((total, amount) => total + amount, 0),
            sourceType: 'multi',
            sourceBreakdowns: pockets.map((pocket, index) => ({
                pocket,
                amount: amounts[index]
            }))
        }))
    );
}

function expenseCollectionArbitrary() {
    // Include a single-pocket expense, a one-to-three-pocket split, and a
    // guaranteed two-to-three-pocket split so every case exercises mixed
    // Monthly/Weekly cadence attribution.
    return fc.tuple(
        singleExpenseArbitrary(),
        splitExpenseArbitrary(),
        splitExpenseArbitrary({ minPockets: 2, maxPockets: 3 })
    ).map(([single, split, mixedSplit]) => [single, split, mixedSplit].map((expense, index) => ({
        ...expense,
        _id: `expense-${index}`
    })));
}

function expectedShareItems(expenses) {
    // Independent oracle: it reads the transaction shape directly and does
    // not call or mirror expandEligibleSpendingItems.
    return expenses.flatMap(expense => {
        if (expense.sourceType === 'multi') {
            return expense.sourceBreakdowns.map((share, sourceIndex) => ({
                transactionId: expense._id,
                pocket: share.pocket,
                amount: share.amount,
                sourceType: 'multi',
                sourceIndex
            }));
        }

        return [{
            transactionId: expense._id,
            pocket: expense.pocket,
            amount: expense.amount,
            sourceType: 'single',
            sourceIndex: 0
        }];
    });
}

function canonicalMultiset(items) {
    return items
        .map(({ transactionId, pocket, amount, sourceType, sourceIndex }) => ({
            transactionId,
            pocket,
            amount,
            sourceType,
            sourceIndex
        }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function expectedPocketTotals(items) {
    return items.reduce((totals, item) => {
        totals.set(item.pocket, (totals.get(item.pocket) || 0) + item.amount);
        return totals;
    }, new Map());
}

function cadenceByPocket(expenses) {
    const pockets = [...new Set(expenses.flatMap(expense =>
        expense.sourceType === 'multi'
            ? expense.sourceBreakdowns.map(share => share.pocket)
            : [expense.pocket]
    ))];

    // The guaranteed mixed split gives this map both cadence values in every
    // generated case; additional pockets remain independently attributable.
    return new Map(pockets.map((pocket, index) => [
        pocket,
        index === 0 ? 'Monthly' : 'Weekly'
    ]));
}

// Feature: salary-cycle-budgeting, Property 9: Pocket-share expansion conserves spending exactly once
// **Validates: Requirements 6.1, 6.3, 6.4, 6.5, 6.6, 6.11, 6.12, 7.8**
test('Property 9: Pocket-share expansion conserves spending exactly once (Requirements 6.1, 6.3, 6.4, 6.5, 6.6, 6.11, 6.12, 7.8)', () => {
    fc.assert(
        fc.property(expenseCollectionArbitrary(), expenses => {
            const actualItems = expandEligibleSpendingItems(expenses);
            const expectedItems = expectedShareItems(expenses);
            const actualTotal = actualItems.reduce((total, item) => total + item.amount, 0);
            const expectedTotal = expectedItems.reduce((total, item) => total + item.amount, 0);
            const parentTotal = expenses.reduce((total, expense) => total + expense.amount, 0);

            assert.deepEqual(canonicalMultiset(actualItems), canonicalMultiset(expectedItems));
            assert.equal(actualItems.length, expectedItems.length);
            assert.equal(actualTotal, expectedTotal);
            assert.equal(actualTotal, parentTotal);

            for (const expense of expenses) {
                const expectedExpenseItems = expectedItems.filter(item =>
                    item.transactionId === expense._id
                );
                const actualExpenseItems = actualItems.filter(item =>
                    item.transactionId === expense._id
                );

                assert.equal(actualExpenseItems.length, expectedExpenseItems.length);
                assert.equal(
                    actualExpenseItems.reduce((total, item) => total + item.amount, 0),
                    expense.amount
                );

                if (expense.sourceType === 'multi') {
                    assert.equal(
                        expense.sourceBreakdowns.reduce((total, share) => total + share.amount, 0),
                        expense.amount
                    );
                    assert.ok(actualExpenseItems.every(item => item.sourceType === 'multi'));
                } else {
                    assert.deepEqual(actualExpenseItems.map(item => item.sourceType), ['single']);
                }
            }

            const totalsByPocket = expectedPocketTotals(expectedItems);
            const cadences = cadenceByPocket(expenses);
            const pocketMetrics = [];

            for (const [pocket, expectedSpending] of totalsByPocket) {
                const options = { budgetMonth: BUDGET_MONTH, pocket };
                const metrics = cadences.get(pocket) === 'Weekly'
                    ? calculatePocketWeek(actualItems, 0, WEEK_INTERSECTION, options)
                    : calculatePocketPeriod(actualItems, 0, options);

                assert.equal(metrics.spending, expectedSpending);
                pocketMetrics.push(metrics);
            }

            assert.deepEqual(calculateBudgetAggregate(pocketMetrics), {
                allocation: 0,
                spending: expectedTotal,
                remaining: -expectedTotal,
                percentageUsed: 0,
                status: 'good',
                isOver: expectedTotal > 0
            });
        }),
        { numRuns: 150 }
    );
});
