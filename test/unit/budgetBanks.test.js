'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const budgetService = require('../../services/budgetService');
const { getSalaryCyclePeriod, listIntersectingIsoWeeks, parseBudgetMonth } = require('../../services/salaryCycleResolver');

const wife = { userId: new mongoose.Types.ObjectId().toString(), role: 'Wife' };
const MONTH = '2027-02';
const WEEKS = listIntersectingIsoWeeks({
    period: getSalaryCyclePeriod({ budgetMonth: parseBudgetMonth(MONTH), timeZone: 'Asia/Jakarta' })
});

// Native-array doubles: budgetService treats an array returned by find() as a
// resolved query, so no Mongo is needed.
const arrayModel = (rows, onFind) => ({
    find(filter) { if (onFind) onFind(filter); return rows; },
    findOne() { return null; }
});

const ids = {
    groceries: new mongoose.Types.ObjectId().toString(),
    snacks: new mongoose.Types.ObjectId().toString(),
    transport: new mongoose.Types.ObjectId().toString(),
    old: new mongoose.Types.ObjectId().toString()
};

function monthly(pocketId, name, amount) {
    return {
        _id: new mongoose.Types.ObjectId().toString(), pocketId, budgetMonth: 2, budgetYear: 2027,
        pocketNameSnapshot: name, pocketNormalizedNameSnapshot: name.toLowerCase(), pocketEmojiSnapshot: '💰',
        cadenceSnapshot: 'Monthly', amountMode: 'Use_Default', version: 1,
        allocations: [{ kind: 'Monthly', key: 'monthly', amount }]
    };
}

function weekly(pocketId, name, perWeek) {
    return {
        ...monthly(pocketId, name, 0),
        cadenceSnapshot: 'Weekly',
        allocations: WEEKS.map(week => ({ kind: 'Weekly', key: week.key, isoWeekYear: week.weekYear, isoWeekNumber: week.weekNumber, amount: perWeek }))
    };
}

function spend(pocketId, amount, expenseDate = '2027-02-01') {
    return { _id: new mongoose.Types.ObjectId().toString(), pocketId, amount, expenseDate, budgetMonth: 2, budgetYear: 2027 };
}

function options({ assignments, transactions = [], definitions, onDefinitionFind, pocketManagementEnabled = true }) {
    return {
        nowInstant: '2027-02-01T04:00:00Z',
        timeZone: 'Asia/Jakarta',
        salaryCycleBudgetingEnabled: true,
        pocketManagementEnabled,
        assignmentModel: arrayModel(assignments),
        transactionModel: arrayModel(transactions),
        guardModel: arrayModel([]),
        definitionModel: arrayModel(definitions, onDefinitionFind)
    };
}

const fixture = () => options({
    assignments: [
        monthly(ids.groceries, 'Groceries', 1000000),
        monthly(ids.snacks, 'Snacks', 200000),
        weekly(ids.transport, 'Transport', 100000),
        monthly(ids.old, 'Old', 50000)
    ],
    transactions: [
        spend(ids.groceries, 300000),
        spend(ids.snacks, 250000),
        spend(ids.transport, 40000, WEEKS[WEEKS.length - 1].intersectionStartDate)
    ],
    definitions: [
        { _id: ids.groceries, bank: 'jago' },
        { _id: ids.snacks, bank: 'jago' },
        { _id: ids.transport, bank: 'blu' },
        { _id: ids.old }
    ]
});

test('each managed pocket row carries its current bank', async () => {
    const view = await budgetService.getBudgetMonthView({ budgetMonth: MONTH }, wife, fixture());
    const byName = Object.fromEntries(view.pockets.map(pocket => [pocket.pocket, pocket.bank]));

    assert.equal(byName.Groceries.key, 'jago');
    assert.equal(byName.Groceries.logo, '/images/banks/jago.svg');
    assert.equal(byName.Transport.key, 'blu');
    assert.equal(byName.Old, null);
});

test('bank totals sum whole-cycle remaining per bank, overspend included', async () => {
    const view = await budgetService.getBudgetMonthView({ budgetMonth: MONTH }, wife, fixture());
    const banks = Object.fromEntries(view.banks.map(bank => [bank.key, bank]));

    assert.deepEqual(view.banks.map(bank => bank.key), ['jago', 'blu', 'unassigned']);
    // Groceries 1,000,000 - 300,000 plus Snacks 200,000 - 250,000 (overspent).
    assert.equal(banks.jago.remaining, 650000);
    assert.equal(banks.jago.pocketCount, 2);
    assert.equal(banks.jago.isOver, false);
    // Weekly pocket counts every intersecting week, not just the selected one.
    assert.equal(banks.blu.allocation, 100000 * WEEKS.length);
    assert.equal(banks.blu.remaining, 100000 * WEEKS.length - 40000);
    assert.equal(banks.unassigned.name, 'No bank');
    assert.equal(banks.unassigned.remaining, 50000);
});

test('bank totals always add up to totalRemaining', async () => {
    const view = await budgetService.getBudgetMonthView({ budgetMonth: MONTH }, wife, fixture());
    assert.equal(view.banks.reduce((sum, bank) => sum + bank.remaining, 0), view.totalRemaining);
});

test('an overspent bank is flagged and formatted without the sign', () => {
    const [bank] = budgetService.summarizeBanks([
        { bank: { key: 'bca', name: 'BCA' }, periodMetrics: { allocation: 100000, spending: 175000 } }
    ]);
    assert.equal(bank.remaining, -75000);
    assert.equal(bank.isOver, true);
    assert.doesNotMatch(bank.formattedRemaining, /-/);
});

test('a month with no assignments has no banks and skips the definition lookup', async () => {
    let looked = false;
    const view = await budgetService.getBudgetMonthView({ budgetMonth: MONTH }, wife, options({
        assignments: [], definitions: [], onDefinitionFind: () => { looked = true; }
    }));
    assert.deepEqual(view.banks, []);
    assert.equal(looked, false);
});

test('with pocket management off the summary has no banks at all', async () => {
    const view = await budgetService.getBudgetMonthView({ budgetMonth: MONTH }, wife, {
        nowInstant: '2027-02-01T04:00:00Z',
        timeZone: 'Asia/Jakarta',
        salaryCycleBudgetingEnabled: true,
        pocketManagementEnabled: false,
        monthlyModel: arrayModel([]),
        weeklyModel: arrayModel([]),
        cadenceModel: arrayModel([]),
        transactionModel: arrayModel([]),
        guardModel: arrayModel([])
    });
    assert.equal('banks' in view, false);
    assert.ok(view.pockets.every(pocket => !('bank' in pocket)));
});
