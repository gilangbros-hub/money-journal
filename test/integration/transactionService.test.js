'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const ClosedMonth = require('../../models/closedMonth');
const {
    createExpense,
    updateExpense,
    deleteExpense,
    getExpense
} = require('../../services/transactionService');
const { ClosedBudgetPeriodError } = require('../../utils/domainErrors');
const { withIsolatedDatabase } = require('../helpers/isolatedDatabase');

const runIntegration = process.env.RUN_MONGO_INTEGRATION === '1';
const integrationTest = runIntegration
    ? (name, fn) => test(name, { concurrency: false }, fn)
    : test.skip;

test('service commits canonical transaction and guard in one replica-set transaction', async t => {
    if (!runIntegration) {
        t.skip('set RUN_MONGO_INTEGRATION=1 to run MongoDB integration tests');
        return;
    }

    await withIsolatedDatabase(async ({ connection }) => {
        const userId = new mongoose.Types.ObjectId();
        const result = await createExpense({
            expenseDate: '2027-02-24',
            type: 'Groceries',
            pocket: 'Groceries',
            ngapain: 'market run',
            amount: 125000,
            paidBy: 'Self'
        }, { userId }, { connection });

        const stored = await Transaction.findById(result._id).lean();
        const guard = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        assert.equal(stored.expenseDate, '2027-02-24');
        assert.equal(stored.date.toISOString(), '2027-02-24T05:00:00.000Z');
        assert.equal(stored.budgetMonth, 2);
        assert.equal(guard.mutationSequence, 1);

        await ClosedMonth.closePeriod({ month: 3, year: 2027 }).exec();
        await assert.rejects(
            () => updateExpense(result._id, {
                expenseDate: '2027-03-24',
                type: 'Groceries',
                pocket: 'Groceries',
                ngapain: 'moved',
                amount: 125000,
                paidBy: 'Self'
            }, { userId }, { connection }),
            error => error instanceof ClosedBudgetPeriodError
        );

        const unchanged = await Transaction.findById(result._id).lean();
        const sourceGuard = await ClosedMonth.findOne({ month: 2, year: 2027 }).lean();
        assert.equal(unchanged.budgetMonth, 2);
        assert.equal(unchanged.expenseDate, '2027-02-24');
        assert.equal(sourceGuard.mutationSequence, 1);
    });
});


integrationTest('legacy assignment compatibility, mixed-schema reads, and rejected writes are atomic', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const userId = new mongoose.Types.ObjectId();
        const base = {
            type: 'Groceries',
            pocket: 'Groceries',
            ngapain: 'market run',
            amount: 125000,
            paidBy: 'Self'
        };

        const omitted = await createExpense({
            ...base,
            expenseDate: '2027-02-24'
        }, { userId }, { connection });
        assert.equal(omitted.budgetMonth, 2);
        assert.equal(omitted.budgetYear, 2027);

        const matching = await createExpense({
            ...base,
            expenseDate: '2027-02-25',
            budgetMonth: 3,
            budgetYear: 2027
        }, { userId }, { connection });
        assert.equal(matching.budgetMonth, 3);

        const countBeforeConflict = await Transaction.countDocuments();
        await assert.rejects(
            () => createExpense({
                ...base,
                expenseDate: '2027-02-24',
                budgetMonth: 3,
                budgetYear: 2027
            }, { userId }, { connection }),
            error => error.code === 'BUDGET_MONTH_ASSIGNMENT_CONFLICT'
                && error.details.derivedBudgetMonth === '2027-02'
        );
        assert.equal(await Transaction.countDocuments(), countBeforeConflict);

        await new Transaction({
            date: new Date('2027-02-24T05:00:00.000Z'),
            type: 'Groceries',
            pocket: 'Groceries',
            ngapain: 'legacy record',
            by: userId,
            paidBy: 'Self',
            amount: 50000,
            budgetMonth: 2,
            budgetYear: 2027
        }).save();
        const legacy = await getExpense(
            (await Transaction.findOne({ ngapain: 'legacy record' }))._id,
            { userId },
            { connection }
        );
        assert.equal(legacy.expenseDate, '2027-02-24');
        assert.equal(legacy.date, '2027-02-24');
        assert.equal(legacy.budgetMonth, 2);

        const beforeInvalid = await Transaction.findById(omitted._id).lean();
        await assert.rejects(
            () => updateExpense(omitted._id, {
                ...base,
                expenseDate: '2027-02-30'
            }, { userId }, { connection }),
            error => error.code === 'VALIDATION_ERROR' && error.field === 'expenseDate'
        );
        const afterInvalid = await Transaction.findById(omitted._id).lean();
        assert.deepEqual(afterInvalid, beforeInvalid);
    });
});

integrationTest('closed source and destination periods reject create, update, and delete without partial writes', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const userId = new mongoose.Types.ObjectId();
        const result = await createExpense({
            expenseDate: '2027-02-24',
            type: 'Groceries',
            pocket: 'Groceries',
            ngapain: 'protected expense',
            amount: 125000,
            paidBy: 'Self'
        }, { userId }, { connection });

        await ClosedMonth.closePeriod({ month: 3, year: 2027, actor: userId }).exec();
        const beforeDestinationCreate = await Transaction.countDocuments();
        await assert.rejects(
            () => createExpense({
                expenseDate: '2027-03-24',
                type: 'Groceries',
                pocket: 'Groceries',
                ngapain: 'closed destination',
                amount: 50000,
                paidBy: 'Self'
            }, { userId }, { connection }),
            error => error instanceof ClosedBudgetPeriodError
                && error.details.budgetMonth === '2027-03'
        );
        assert.equal(await Transaction.countDocuments(), beforeDestinationCreate);

        const beforeUpdate = await Transaction.findById(result._id).lean();
        await assert.rejects(
            () => updateExpense(result._id, {
                expenseDate: '2027-03-24',
                type: 'Groceries',
                pocket: 'Groceries',
                ngapain: 'would cross into closed period',
                amount: 125000,
                paidBy: 'Self'
            }, { userId }, { connection }),
            error => error instanceof ClosedBudgetPeriodError
                && error.details.budgetMonth === '2027-03'
        );
        assert.deepEqual(await Transaction.findById(result._id).lean(), beforeUpdate);

        await ClosedMonth.closePeriod({ month: 2, year: 2027, actor: userId }).exec();
        const beforeClosedSourceUpdate = await Transaction.findById(result._id).lean();
        await assert.rejects(
            () => updateExpense(result._id, {
                expenseDate: '2027-04-24',
                type: 'Groceries',
                pocket: 'Groceries',
                ngapain: 'would move from closed source',
                amount: 125000,
                paidBy: 'Self'
            }, { userId }, { connection }),
            error => error instanceof ClosedBudgetPeriodError
                && error.details.budgetMonth === '2027-02'
        );
        assert.deepEqual(await Transaction.findById(result._id).lean(), beforeClosedSourceUpdate);
        assert.equal((await ClosedMonth.findOne({ month: 2, year: 2027 }).lean()).mutationSequence, 2);

        const beforeDelete = await Transaction.findById(result._id).lean();
        await assert.rejects(
            () => deleteExpense(result._id, { userId }, { connection }),
            error => error instanceof ClosedBudgetPeriodError
                && error.details.budgetMonth === '2027-02'
        );
        assert.deepEqual(await Transaction.findById(result._id).lean(), beforeDelete);
    });
});

integrationTest('same-period and cross-period updates, delete, and guard ordering commit atomically', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const userId = new mongoose.Types.ObjectId();
        const guardCalls = [];
        const key = ({ month, year }) => `${year}-${String(month).padStart(2, '0')}`;
        const guardModel = {
            ensureOpen(period, options) {
                guardCalls.push(`ensure:${key(period)}`);
                return ClosedMonth.ensureOpen(period, options);
            },
            findOneAndUpdate(filter, update, options) {
                guardCalls.push(`fence:${key(filter)}`);
                return ClosedMonth.findOneAndUpdate(filter, update, options);
            },
            findOne(filter) {
                guardCalls.push(`read:${key(filter)}`);
                return ClosedMonth.findOne(filter);
            }
        };
        const options = { connection, guardModel };
        const base = {
            expenseDate: '2027-02-24',
            type: 'Groceries',
            pocket: 'Groceries',
            ngapain: 'initial expense',
            amount: 125000,
            paidBy: 'Self'
        };

        const created = await createExpense(base, { userId }, options);
        const samePeriod = await updateExpense(created._id, {
            ...base,
            expenseDate: '2027-02-23',
            ngapain: 'same-period update',
            amount: 130000
        }, { userId }, options);
        assert.equal(samePeriod.expenseDate, '2027-02-23');
        assert.equal(samePeriod.budgetMonth, 2);
        assert.equal(samePeriod.amount, 130000);

        guardCalls.length = 0;
        const crossPeriod = await updateExpense(created._id, {
            ...base,
            expenseDate: '2027-03-24',
            ngapain: 'cross-period update',
            amount: 135000
        }, { userId }, options);
        assert.equal(crossPeriod.expenseDate, '2027-03-24');
        assert.equal(crossPeriod.budgetMonth, 3);
        assert.equal(crossPeriod.amount, 135000);
        assert.deepEqual(guardCalls, [
            'ensure:2027-02',
            'fence:2027-02',
            'ensure:2027-03',
            'fence:2027-03'
        ]);

        const stored = await Transaction.findById(created._id).lean();
        assert.equal(stored.expenseDate, '2027-03-24');
        assert.equal(stored.budgetMonth, 3);
        assert.equal(stored.amount, 135000);

        const deleted = await deleteExpense(created._id, { userId }, options);
        assert.equal(deleted.success, true);
        assert.equal(await Transaction.countDocuments(), 0);
        assert.equal((await ClosedMonth.findOne({ month: 3, year: 2027 }).lean()).mutationSequence, 2);
    });
});


integrationTest('split validation rejects malformed multi-pocket writes and notification failures do not roll back commits', async () => {
    await withIsolatedDatabase(async ({ connection }) => {
        const userId = new mongoose.Types.ObjectId();
        const common = {
            expenseDate: '2027-02-24',
            type: 'Groceries',
            pocket: 'Groceries',
            ngapain: 'split expense',
            amount: 150000,
            paidBy: 'Self',
            sourceType: 'multi'
        };

        await assert.rejects(
            () => createExpense({
                ...common,
                sourceBreakdowns: [
                    { pocket: 'Groceries', amount: 100000 },
                    { pocket: 'Kwintals', amount: 40000 }
                ]
            }, { userId }, { connection }),
            error => error.code === 'VALIDATION_ERROR' && error.field === 'sourceBreakdowns'
        );
        assert.equal(await Transaction.countDocuments(), 0);

        const committed = await createExpense({
            ...common,
            sourceBreakdowns: [
                { pocket: 'Groceries', amount: 100000 },
                { pocket: 'Kwintals', amount: 50000 }
            ]
        }, { userId }, {
            connection,
            notificationQueue: async () => { throw new Error('notification unavailable'); }
        });
        assert.equal(committed.expenseDate, '2027-02-24');
        assert.equal(await Transaction.countDocuments(), 1);
    });
});
