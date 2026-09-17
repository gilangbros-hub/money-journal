'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const reportingService = require('../services/reportingService');
const { DomainValidationError } = require('../utils/domainErrors');

function modelFrom(records) {
    return {
        find(filter) {
            const matches = records.filter(record => Object.entries(filter).every(([key, value]) => {
                if (key === '$or') {
                    return value.some(candidate => Object.entries(candidate).every(([field, expected]) => {
                        if (field === 'sourceBreakdowns.pocket') {
                            return (record.sourceBreakdowns || []).some(share => share.pocket === expected);
                        }
                        return record[field] === expected;
                    }));
                }
                return record[key] === value;
            }));
            const query = {
                sort() { return query; },
                populate() { return query; },
                lean() { return query; },
                exec: async () => matches
            };
            return query;
        }
    };
}

const userId = new mongoose.Types.ObjectId();
const view = {
    budgetMonth: '2027-02',
    period: { startDate: '2027-01-25', endDate: '2027-02-24' },
    pockets: [{
        pocket: 'Groceries',
        cadence: 'Weekly',
        budget: 100000,
        spent: 85000,
        percentageUsed: 85,
        alertStatus: 'warning',
        selectedWeek: { key: '2027-W05' }
    }]
};

function reportingOptions(records, budgetView = view, calls = []) {
    return {
        timeZone: 'Asia/Jakarta',
        nowInstant: '2027-02-01T04:00:00Z',
        transactionModel: modelFrom(records),
        budgetService: {
            async getBudgetMonthView(...args) {
                calls.push(args);
                return budgetView;
            }
        }
    };
}

test('dashboard reporting uses stored assignment, named-month comparison, alerts, and canonical dates', async () => {
    const records = [
        {
            _id: 'current',
            expenseDate: '2027-02-25',
            date: new Date('2027-02-25T05:00:00Z'),
            type: 'Groceries',
            pocket: 'Groceries',
            amount: 90000,
            paidBy: 'Self',
            budgetMonth: 2,
            budgetYear: 2027,
            by: { username: 'alice' }
        },
        {
            _id: 'previous',
            expenseDate: '2027-01-20',
            date: new Date('2027-01-20T05:00:00Z'),
            type: 'Eat',
            pocket: 'Kwintals',
            amount: 50000,
            paidBy: 'Wife',
            budgetMonth: 1,
            budgetYear: 2027,
            by: userId
        }
    ];

    const result = await reportingService.getDashboardSummary(
        { month: '2027-02' },
        { userId, role: 'Husband' },
        reportingOptions(records)
    );

    assert.equal(result.budgetMonth, '2027-02');
    assert.deepEqual(result.period, view.period);
    assert.equal(result.total.raw, 90000);
    assert.equal(result.comparison.previousBudgetMonth, '2027-01');
    assert.equal(result.comparison.lastMonth, 'Rp 50.000');
    assert.equal(result.recent[0].expenseDate, '2027-02-25');
    assert.equal(result.recent[0].date, '2027-02-25');
    assert.equal(result.recent[0].by, 'alice');
    assert.deepEqual(result.budgetAlerts.map(alert => [alert.cadence, alert.selectedWeek, alert.status]), [['Weekly', '2027-W05', 'warning']]);
    assert.equal(result.budgetAlerts[0].scopeLabel, 'Weekly · 2027-W05');
    assert.match(result.budgetAlerts[0].message, /Weekly · 2027-W05/);
});

test('history reporting returns server period metadata and filters by stored month', async () => {
    const records = [{
        _id: 'stored-february',
        expenseDate: '2027-02-25',
        date: new Date('2027-02-25T05:00:00Z'),
        type: 'Groceries',
        pocket: 'Groceries',
        ngapain: 'stored history item',
        amount: 1000,
        paidBy: 'Self',
        budgetMonth: 2,
        budgetYear: 2027,
        by: userId
    }];
    const result = await reportingService.getHistory(
        { month: '2027-02' },
        { userId, role: 'Husband' },
        reportingOptions(records)
    );

    assert.equal(result.budgetMonth, '2027-02');
    assert.deepEqual(result.period, view.period);
    assert.deepEqual(Object.keys(result.byDate), ['2027-02-25']);
    assert.equal(result.transactions[0].date, '2027-02-25');
});

test('dashboard and history reject malformed month filters instead of using another month', async () => {
    const options = reportingOptions([]);
    await assert.rejects(
        reportingService.getDashboardSummary({ month: '2027-2' }, { userId, role: 'Husband' }, options),
        error => error instanceof DomainValidationError && error.field === 'budgetMonth'
    );
    await assert.rejects(
        reportingService.getHistory({ month: '' }, { userId, role: 'Husband' }, options),
        error => error instanceof DomainValidationError && error.field === 'budgetMonth'
    );
});


test('dashboard preserves legacy local dates and counts split spending once', async () => {
    const records = [
        {
            _id: 'legacy-split',
            date: new Date('2027-02-25T05:00:00Z'),
            type: 'Groceries',
            pocket: 'Groceries',
            sourceType: 'multi',
            sourceBreakdowns: [
                { pocket: 'Groceries', amount: 60000 },
                { pocket: 'Kwintals', amount: 40000 }
            ],
            amount: 100000,
            paidBy: 'Self',
            budgetMonth: 2,
            budgetYear: 2027,
            by: { username: 'legacy-user' }
        }
    ];

    const result = await reportingService.getDashboardSummary(
        { month: '2027-02' },
        { userId, role: 'Husband' },
        reportingOptions(records)
    );

    assert.equal(result.total.raw, 100000);
    assert.deepEqual(result.categories.map(item => item.total), [100000]);
    assert.deepEqual(result.roles.map(item => item.total), [100000]);
    assert.equal(result.recent[0].expenseDate, '2027-02-25');
    assert.equal(result.recent[0].date, '2027-02-25');
});

test('dashboard forwards selected week and reports monthly and weekly alert statuses', async () => {
    const calls = [];
    const cadenceView = {
        ...view,
        selectedWeek: '2027-W06',
        pockets: [
            {
                pocket: 'Groceries',
                cadence: 'Monthly',
                budget: 100000,
                spent: 80000,
                percentageUsed: 80,
                alertStatus: 'warning'
            },
            {
                pocket: 'Weekday Transport',
                cadence: 'Weekly',
                budget: 50000,
                spent: 50000,
                percentageUsed: 100,
                alertStatus: 'danger',
                selectedWeek: { key: '2027-W06' }
            }
        ]
    };
    const result = await reportingService.getDashboardSummary(
        { month: '2027-02', week: '2027-W06' },
        { userId, role: 'Husband' },
        reportingOptions([], cadenceView, calls)
    );

    assert.equal(calls[0][0].budgetMonth, '2027-02');
    assert.equal(calls[0][0].selectedWeek, '2027-W06');
    assert.deepEqual(
        result.budgetAlerts.map(alert => [alert.pocket, alert.cadence, alert.selectedWeek, alert.status]),
        [
            ['Weekday Transport', 'Weekly', '2027-W06', 'danger'],
            ['Groceries', 'Monthly', null, 'warning']
        ]
    );
});

test('history returns exact stored assignment metadata and legacy date values', async () => {
    const legacy = {
        _id: 'legacy-history',
        date: new Date('2027-02-25T05:00:00Z'),
        type: 'Eat',
        pocket: 'Kwintals',
        sourceType: 'single',
        sourceBreakdowns: [],
        ngapain: 'legacy record',
        amount: 1200,
        paidBy: 'Self',
        budgetMonth: 2,
        budgetYear: 2027,
        by: userId
    };
    const historyView = {
        ...view,
        month: 2,
        year: 2027,
        availableWeeks: [{ key: '2027-W05' }],
        selectedWeek: '2027-W05',
        isClosed: true
    };
    const result = await reportingService.getHistory(
        { budgetMonth: '2027-02' },
        { userId, role: 'Husband' },
        reportingOptions([legacy], historyView)
    );

    assert.equal(result.budgetMonth, '2027-02');
    assert.equal(result.month, 2);
    assert.equal(result.year, 2027);
    assert.deepEqual(result.period, historyView.period);
    assert.deepEqual(result.salaryCyclePeriod, historyView.period);
    assert.deepEqual(result.availableWeeks, historyView.availableWeeks);
    assert.equal(result.selectedWeek, '2027-W05');
    assert.equal(result.isClosed, true);
    assert.equal(result.transactions[0].expenseDate, '2027-02-25');
    assert.deepEqual(Object.keys(result.byDate), ['2027-02-25']);
});

test('history pocket filtering returns a split transaction once when a share matches', async () => {
    const split = {
        _id: 'split-history',
        expenseDate: '2027-02-25',
        date: new Date('2027-02-25T05:00:00Z'),
        type: 'Groceries',
        pocket: 'Groceries',
        sourceType: 'multi',
        sourceBreakdowns: [
            { pocket: 'Groceries', amount: 6000 },
            { pocket: 'Kwintals', amount: 4000 }
        ],
        ngapain: 'split history record',
        amount: 10000,
        paidBy: 'Self',
        budgetMonth: 2,
        budgetYear: 2027,
        by: userId
    };
    const result = await reportingService.getAllTransactions(
        { month: '2027-02', pocket: 'Kwintals' },
        { userId, role: 'Husband' },
        reportingOptions([split])
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]._id, 'split-history');
    assert.equal(result[0].amount, 10000);
});

test('reporting rejects conflicting month aliases and honors a defined month alias', async () => {
    await assert.rejects(
        reportingService.getHistory(
            { month: '2027-02', budgetMonth: '2027-03' },
            { userId, role: 'Husband' },
            reportingOptions([])
        ),
        error => error instanceof DomainValidationError && error.field === 'budgetMonth'
    );

    const calls = [];
    await reportingService.getDashboardSummary(
        { month: '2027-02', budgetMonth: undefined },
        { userId, role: 'Husband' },
        reportingOptions([], view, calls)
    );
    assert.equal(calls[0][0].budgetMonth, '2027-02');
});
