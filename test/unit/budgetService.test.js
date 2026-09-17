'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getBudgetMonthView } = require('../../services/budgetService');

const pockets = ['Kwintals', 'Groceries', 'Weekday Transport', 'Weekend Transport', 'Investasi', 'Bandung', 'Sedeqah', 'IPL'];

function matches(record, filter) {
    return Object.entries(filter).every(([key, value]) => record[key] === value);
}

function modelFrom(records, calls, { single = false } = {}) {
    return {
        find(filter) {
            calls.push({ operation: 'find', filter });
            const result = records.filter(record => matches(record, filter));
            if (single) return result;
            const query = {
                sort() { return query; },
                session() { return query; },
                lean() { return query; },
                exec: async () => result
            };
            return query;
        },
        findOne(filter) {
            calls.push({ operation: 'findOne', filter });
            const result = records.find(record => matches(record, filter)) || null;
            const query = {
                session() { return query; },
                lean() { return query; },
                exec: async () => result
            };
            return query;
        }
    };
}

function readOptions({ cadences = [], monthly = [], weekly = [], transactions = [], guards = [] } = {}) {
    const calls = [];
    return {
        calls,
        options: {
            timeZone: 'Asia/Jakarta',
            nowInstant: '2027-02-01T04:00:00Z',
            cadenceModel: modelFrom(cadences, calls),
            monthlyModel: modelFrom(monthly, calls),
            weeklyModel: modelFrom(weekly, calls),
            transactionModel: modelFrom(transactions, calls),
            guardModel: modelFrom(guards, calls)
        }
    };
}

test('returns salary-cycle metadata, defaults legacy cadence, and preserves missing active allocations', async () => {
    const { calls, options } = readOptions({
        monthly: [{ _id: 'monthly-groceries', pocket: 'Groceries', month: 2, year: 2027, budget: 1000 }]
    });

    const view = await getBudgetMonthView({ budgetMonth: { year: 2027, month: 2 } }, { role: 'Husband' }, options);

    assert.equal(view.budgetMonth, '2027-02');
    assert.equal(view.timeZone, 'Asia/Jakarta');
    assert.deepEqual(view.period, { startDate: '2027-01-25', endDate: '2027-02-24' });
    assert.equal(view.salaryCyclePeriod, view.period);
    assert.deepEqual(view.availableWeeks[0], {
        key: '2027-W04',
        weekYear: 2027,
        weekNumber: 4,
        startDate: '2027-01-25',
        endDate: '2027-01-31',
        intersectionStartDate: '2027-01-25',
        intersectionEndDate: '2027-01-31'
    });

    const groceries = view.pockets.find(pocket => pocket.pocket === 'Groceries');
    const transport = view.pockets.find(pocket => pocket.pocket === 'Weekday Transport');
    assert.equal(groceries.cadence, 'Monthly');
    assert.equal(groceries.allocationId, 'monthly-groceries');
    assert.equal(groceries.missingAllocation, false);
    assert.equal(groceries.budget, 1000);
    assert.equal(transport.cadence, 'Monthly');
    assert.equal(transport.allocation, null);
    assert.equal(transport.missingAllocation, true);
    assert.equal(transport.budget, 0);

    // A read must only issue reads; absent legacy cadence is an in-memory default.
    assert.ok(calls.every(call => call.operation === 'find' || call.operation === 'findOne'));
});

test('uses exact weekly allocations and salary-cycle intersections while aggregating each share once', async () => {
    const { options } = readOptions({
        cadences: [{ pocket: 'Weekday Transport', month: 2, year: 2027, cadence: 'Weekly' }],
        monthly: [
            { _id: 'monthly-groceries', pocket: 'Groceries', month: 2, year: 2027, budget: 1000 },
            { _id: 'inactive-monthly', pocket: 'Weekday Transport', month: 2, year: 2027, budget: 9999 }
        ],
        weekly: [{
            _id: 'weekly-w08', pocket: 'Weekday Transport', month: 2, year: 2027,
            isoWeekYear: 2027, isoWeekNumber: 8, budget: 200
        }],
        transactions: [
            {
                _id: 'single', expenseDate: '2027-02-24', budgetMonth: 2, budgetYear: 2027,
                pocket: 'Groceries', amount: 100, sourceType: 'single'
            },
            {
                _id: 'split-in-period', expenseDate: '2027-02-24', budgetMonth: 2, budgetYear: 2027,
                pocket: 'Groceries', amount: 300, sourceType: 'multi', sourceBreakdowns: [
                    { pocket: 'Groceries', amount: 100 },
                    { pocket: 'Weekday Transport', amount: 200 }
                ]
            },
            // Stored in February deliberately, but outside the February cycle's
            // W08 intersection (which ends on February 24).
            {
                _id: 'stored-boundary', expenseDate: '2027-02-25', budgetMonth: 2, budgetYear: 2027,
                pocket: 'Groceries', amount: 50, sourceType: 'multi', sourceBreakdowns: [
                    { pocket: 'Weekday Transport', amount: 50 }
                ]
            },
            // A legacy schema-v1 record has no expenseDate. Its compatibility
            // date is converted in the household zone for weekly attribution.
            {
                _id: 'legacy', date: new Date('2027-02-24T05:00:00.000Z'), budgetMonth: 2, budgetYear: 2027,
                pocket: 'Weekday Transport', amount: 25, sourceType: 'single'
            }
        ]
    });

    const view = await getBudgetMonthView({ budgetMonth: '2027-02', selectedWeek: '2027-W08' }, { role: 'Husband' }, options);
    const groceries = view.pockets.find(pocket => pocket.pocket === 'Groceries');
    const transport = view.pockets.find(pocket => pocket.pocket === 'Weekday Transport');

    assert.equal(transport.cadence, 'Weekly');
    assert.equal(transport.selectedWeek.key, '2027-W08');
    assert.deepEqual(transport.selectedWeek.allocation, {
        _id: 'weekly-w08', pocket: 'Weekday Transport', month: 2, year: 2027,
        isoWeekYear: 2027, isoWeekNumber: 8, budget: 200, amount: 200
    });
    assert.equal(transport.selectedWeek.metrics.spending, 225);
    assert.equal(transport.selectedWeek.metrics.remaining, -25);
    assert.equal(transport.periodMetrics.spending, 275);
    assert.equal(transport.periodMetrics.allocation, 200);
    assert.equal(groceries.periodMetrics.spending, 200);

    // The split parent amount (300) is never added; its two shares contribute
    // 100 + 200, and the independently stored boundary share contributes 50.
    assert.equal(view.aggregate.spending, 475);
    assert.equal(view.aggregate.allocation, 1200);
    assert.equal(view.aggregate.remaining, 725);
});

test('derives canEdit from the server active month, role, and close state', async () => {
    const closedRead = readOptions({ guards: [{ month: 2, year: 2027, isClosed: true }] });
    const closed = await getBudgetMonthView({ budgetMonth: '2027-02' }, { role: 'Wife' }, closedRead.options);
    assert.equal(closed.isClosed, true);
    assert.equal(closed.canEdit, false);

    const openRead = readOptions({ guards: [{ month: 2, year: 2027, isClosed: false }] });
    const open = await getBudgetMonthView({ budgetMonth: '2027-02' }, { role: 'Wife' }, openRead.options);
    assert.equal(open.isClosed, false);
    assert.equal(open.canEdit, true);

    const member = await getBudgetMonthView({ budgetMonth: '2027-02' }, { role: 'Husband' }, openRead.options);
    assert.equal(member.canEdit, false);
});

// Guard against silently dropping a configured pocket when the constant list
// changes: the read contract returns one view entry per configured pocket.
test('returns one read entry for every configured pocket', async () => {
    const { options } = readOptions();
    const view = await getBudgetMonthView({ budgetMonth: '2027-02' }, { role: 'Husband' }, options);
    assert.deepEqual(new Set(view.pockets.map(pocket => pocket.pocket)), new Set(pockets));
});
