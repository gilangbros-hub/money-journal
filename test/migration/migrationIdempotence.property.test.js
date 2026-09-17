'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { POCKETS } = require('../../utils/constants');
const {
    budgetMonthArbitrary,
    pocketArbitrary,
    positiveIntegerRupiahArbitrary,
    pocketSharesArbitrary,
    strictCalendarDateArbitrary
} = require('../arbitraries');
const { canonicalStringify } = require('../../services/migrationFingerprint');
const { applyMigrationItems, createMigrationPreview } = require('../../services/migrationTransformService');
const { assertProperty } = require('../helpers/property');

const TIME_ZONE = 'Asia/Jakarta';
const TRANSACTION_TYPES = ['Groceries', 'Eat', 'Others'];
const POCKET_NAMES = Object.keys(POCKETS);
const ACTOR = '65f000000000000000000001';

function instantForDate(date) {
    return new Date(`${date}T05:00:00.000Z`);
}

function dateFromInstantInZone(value, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(value).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Independent calendar oracle; this deliberately does not call the resolver. */
function expectedAssignment(expenseDate) {
    const [year, month, day] = expenseDate.split('-').map(Number);
    const nominalPayday = new Date(Date.UTC(year, month - 1, 25));
    const weekday = nominalPayday.getUTCDay();
    const actualPayday = 25 - (weekday === 6 ? 1 : weekday === 0 ? 2 : 0);
    if (day < actualPayday) return { month, year };
    return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
}

function getPath(value, path) {
    let current = value;
    for (const segment of path.split('.')) {
        if (current === undefined || current === null || !Object.prototype.hasOwnProperty.call(current, segment)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}

function assertPreservedFields(before, after, paths, label) {
    for (const path of paths) {
        const beforeValue = getPath(before, path);
        if (beforeValue === undefined) continue;
        assert.equal(
            canonicalStringify(getPath(after, path)),
            canonicalStringify(beforeValue),
            `${label}.${path} changed during migration`
        );
    }
}

const budgetSpecArbitrary = fc.uniqueArray(
    fc.record({
        month: fc.integer({ min: 1, max: 12 }),
        year: fc.integer({ min: 2000, max: 2099 }),
        pocket: pocketArbitrary,
        budget: fc.integer({ min: 0, max: 10_000_000 }),
        schemaVersion: fc.constantFrom(1, 2),
        createdAt: strictCalendarDateArbitrary,
        updatedAt: strictCalendarDateArbitrary
    }),
    { minLength: 2, maxLength: 5, selector: value => `${value.year}-${value.month}-${value.pocket}` }
);

const transactionSpecArbitrary = fc.oneof(
    fc.record({
        date: strictCalendarDateArbitrary,
        type: fc.constantFrom(...TRANSACTION_TYPES),
        pocket: pocketArbitrary,
        amount: positiveIntegerRupiahArbitrary,
        schemaVersion: fc.constantFrom(1, 2),
        paidBy: fc.constantFrom('Husband', 'Wife', 'Self'),
        note: fc.string({ minLength: 1, maxLength: 32 })
    }).map(spec => ({ ...spec, sourceType: 'single', sourceBreakdowns: [] })),
    fc.record({
        date: strictCalendarDateArbitrary,
        type: fc.constantFrom(...TRANSACTION_TYPES),
        paidBy: fc.constantFrom('Husband', 'Wife', 'Self'),
        schemaVersion: fc.constantFrom(1, 2),
        note: fc.string({ minLength: 1, maxLength: 32 }),
        shares: pocketSharesArbitrary
    }).map(spec => ({
        ...spec,
        pocket: spec.shares.pockets[0],
        amount: spec.shares.amount,
        sourceType: 'multi',
        sourceBreakdowns: spec.shares.sourceBreakdowns
    }))
);

const closedMonthSpecArbitrary = fc.uniqueArray(
    fc.record({
        month: fc.integer({ min: 1, max: 12 }),
        year: fc.integer({ min: 2000, max: 2099 }),
        schemaVersion: fc.constantFrom(1, 2),
        closedAtDate: strictCalendarDateArbitrary,
        createdAt: strictCalendarDateArbitrary,
        updatedAt: strictCalendarDateArbitrary
    }),
    { minLength: 1, maxLength: 4, selector: value => `${value.year}-${value.month}` }
);

const migrationDatasetArbitrary = fc.record({
    budgets: budgetSpecArbitrary,
    transactions: fc.array(transactionSpecArbitrary, { minLength: 2, maxLength: 5 }),
    closedMonths: closedMonthSpecArbitrary
}).map(({ budgets, transactions, closedMonths }) => ({
    pocketBudgets: budgets.map((spec, index) => ({
        _id: `budget-${index}`,
        pocket: spec.pocket,
        month: spec.month,
        year: spec.year,
        budget: spec.budget,
        createdBy: ACTOR,
        createdAt: instantForDate(spec.createdAt),
        updatedAt: instantForDate(spec.updatedAt),
        ...(spec.schemaVersion === 2 ? { schemaVersion: 2 } : {})
    })),
    pocketBudgetCadences: budgets.map((spec, index) => ({
        _id: `cadence-${index}`,
        pocket: spec.pocket,
        month: spec.month,
        year: spec.year,
        cadence: index % 2 === 0 ? 'Monthly' : 'Weekly',
        createdBy: ACTOR,
        updatedBy: ACTOR,
        version: spec.schemaVersion === 2 ? 1 : 0,
        ...(spec.schemaVersion === 2 ? { schemaVersion: 2 } : {})
    })),
    weeklyAllocations: budgets.map((spec, index) => ({
        _id: `weekly-${index}`,
        pocket: spec.pocket,
        month: spec.month,
        year: spec.year,
        isoWeekYear: 2026,
        isoWeekNumber: 1,
        budget: spec.budget,
        createdBy: ACTOR,
        updatedBy: ACTOR,
        version: spec.schemaVersion === 2 ? 1 : 0,
        ...(spec.schemaVersion === 2 ? { schemaVersion: 2 } : {})
    })),
    transactions: transactions.map((spec, index) => {
        const expenseDate = spec.date;
        const assignment = expectedAssignment(expenseDate);
        const isMixedVersion = spec.schemaVersion === 2;
        return {
            _id: `transaction-${index}`,
            date: instantForDate(expenseDate),
            type: spec.type,
            pocket: spec.pocket,
            ngapain: spec.note,
            by: ACTOR,
            paidBy: spec.paidBy,
            amount: spec.amount,
            budgetMonth: isMixedVersion ? assignment.month : 1,
            budgetYear: isMixedVersion ? assignment.year : 2000,
            sourceType: spec.sourceType,
            sourceBreakdowns: spec.sourceBreakdowns,
            createdAt: instantForDate('2024-01-01'),
            updatedAt: instantForDate('2024-01-02'),
            ...(isMixedVersion ? {
                expenseDate,
                assignmentVersion: 'salary-cycle-v1',
                schemaVersion: 2
            } : {})
        };
    }),
    closedMonths: closedMonths.map((spec, index) => ({
        _id: `closed-${index}`,
        month: spec.month,
        year: spec.year,
        closedBy: ACTOR,
        createdAt: instantForDate(spec.createdAt),
        updatedAt: instantForDate(spec.updatedAt),
        ...(spec.schemaVersion === 2 ? {
            isClosed: true,
            closedAt: instantForDate(spec.closedAtDate),
            mutationSequence: 0,
            schemaVersion: 2
        } : {})
    }))
}));

// Feature: salary-cycle-budgeting, Property 12: Migration transformation is preserving and idempotent
// **Validates: Requirements 10.1, 10.2, 10.8, 10.9, 10.14**
test('Feature: salary-cycle-budgeting, Property 12: Migration transformation is preserving and idempotent', () => {
    assertProperty(fc.property(migrationDatasetArbitrary, source => {
        const first = createMigrationPreview({
            ...source,
            timeZone: TIME_ZONE,
            historicalReassignmentApproved: true
        });
        assert.equal(first.blockers.length, 0);

        const once = applyMigrationItems(source, first.executableItems);
        const second = createMigrationPreview({
            ...once,
            timeZone: TIME_ZONE,
            historicalReassignmentApproved: true
        });
        const twice = applyMigrationItems(once, second.executableItems);

        assert.equal(second.items.length, 0);
        assert.equal(second.executableItems.length, 0);
        assert.equal(second.blockers.length, 0);
        assert.equal(second.counts.proposed, 0);
        assert.equal(second.counts.unchanged, second.counts.scanned);
        assert.equal(canonicalStringify(twice), canonicalStringify(once));

        const migratedBudgets = new Map(once.pocketBudgets.map(record => [String(record._id), record]));
        for (const budget of source.pocketBudgets) {
            const migrated = migratedBudgets.get(String(budget._id));
            assert.ok(migrated);
            assert.equal(migrated.schemaVersion, 2);
            assertPreservedFields(
                budget,
                migrated,
                ['_id', 'pocket', 'budget', 'month', 'year', 'createdBy', 'createdAt', 'updatedAt'],
                `budget ${budget._id}`
            );
        }

        const migratedTransactions = new Map(once.transactions.map(record => [String(record._id), record]));
        for (const transaction of source.transactions) {
            const migrated = migratedTransactions.get(String(transaction._id));
            const expectedDate = transaction.expenseDate || dateFromInstantInZone(transaction.date, TIME_ZONE);
            const expected = expectedAssignment(expectedDate);
            assert.ok(migrated);
            assert.equal(migrated.expenseDate, expectedDate);
            assert.equal(migrated.budgetMonth, expected.month);
            assert.equal(migrated.budgetYear, expected.year);
            assert.equal(migrated.assignmentVersion, 'salary-cycle-v1');
            assert.equal(migrated.schemaVersion, 2);
            assertPreservedFields(
                transaction,
                migrated,
                [
                    '_id', 'type', 'pocket', 'ngapain', 'by', 'paidBy', 'amount', 'date',
                    'sourceType', 'sourceBreakdowns', 'createdAt', 'updatedAt'
                ],
                `transaction ${transaction._id}`
            );
        }

        const migratedClosedMonths = new Map(once.closedMonths.map(record => [String(record._id), record]));
        for (const closedMonth of source.closedMonths) {
            const migrated = migratedClosedMonths.get(String(closedMonth._id));
            assert.ok(migrated);
            assert.equal(migrated.isClosed, true);
            assert.equal(migrated.mutationSequence, 0);
            assert.equal(migrated.schemaVersion, 2);
            assertPreservedFields(
                closedMonth,
                migrated,
                ['_id', 'month', 'year', 'closedBy', 'createdAt', 'updatedAt'],
                `closed month ${closedMonth._id}`
            );
        }

        assert.deepEqual(
            once.pocketBudgetCadences,
            source.pocketBudgetCadences,
            'cadence records changed during migration'
        );
        assert.deepEqual(
            once.weeklyAllocations,
            source.weeklyAllocations,
            'weekly allocation records changed during migration'
        );
    }));
});
