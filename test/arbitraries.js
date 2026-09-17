'use strict';

const fc = require('fast-check');
const { Temporal } = require('@js-temporal/polyfill');
const { POCKETS, TRANSACTION_TYPES } = require('../utils/constants');

const POCKET_NAMES = Object.keys(POCKETS);
const TRANSACTION_TYPES_LIST = Object.keys(TRANSACTION_TYPES);
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;
const MAX_RUPIAH = Number.MAX_SAFE_INTEGER;

const yearArbitrary = fc.integer({ min: MIN_YEAR, max: MAX_YEAR });
const monthArbitrary = fc.integer({ min: 1, max: 12 });
const calendarDateArbitrary = fc
    .tuple(yearArbitrary, monthArbitrary)
    .chain(([year, month]) => {
        const daysInMonth = Temporal.PlainDate.from({ year, month, day: 1 }).daysInMonth;
        return fc.integer({ min: 1, max: daysInMonth })
            .map(day => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    });

const strictCalendarDateArbitrary = calendarDateArbitrary;
const expenseDateArbitrary = calendarDateArbitrary;

const budgetMonthArbitrary = fc.record({ year: yearArbitrary, month: monthArbitrary })
    .map(({ year, month }) => ({
        year,
        month,
        key: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
    }));
const budgetMonthsArbitrary = budgetMonthArbitrary;

const isoWeekArbitrary = calendarDateArbitrary.map(value => {
    const date = Temporal.PlainDate.from(value);
    const weekYear = date.yearOfWeek;
    const weekNumber = date.weekOfYear;
    const monday = date.subtract({ days: date.dayOfWeek - 1 });
    return {
        key: `${String(weekYear).padStart(4, '0')}-W${String(weekNumber).padStart(2, '0')}`,
        weekYear,
        weekNumber,
        startDate: monday.toString(),
        endDate: monday.add({ days: 6 }).toString()
    };
});
const realIsoWeekArbitrary = isoWeekArbitrary;

const safeIntegerRupiahArbitrary = fc.integer({ min: 0, max: MAX_RUPIAH });
const positiveIntegerRupiahArbitrary = fc.integer({ min: 1, max: MAX_RUPIAH });
const rupiahArbitrary = safeIntegerRupiahArbitrary;

const pocketArbitrary = fc.constantFrom(...POCKET_NAMES);
const uniquePocketArbitrary = fc.uniqueArray(pocketArbitrary, {
    minLength: 1,
    maxLength: Math.min(3, POCKET_NAMES.length)
});

/** Generate one-to-three unique pocket shares whose integer amounts sum exactly. */
const uniquePocketSharesArbitrary = uniquePocketArbitrary.chain(pockets =>
    fc.array(fc.integer({ min: 1, max: Math.floor(MAX_RUPIAH / 3) }), {
        minLength: pockets.length,
        maxLength: pockets.length
    }).map(shares => ({
        amount: shares.reduce((total, value) => total + value, 0),
        pockets,
        shares,
        sourceBreakdowns: pockets.map((pocket, index) => ({
            pocket,
            amount: shares[index]
        }))
    }))
);
const pocketSharesArbitrary = uniquePocketSharesArbitrary;

const cadenceArbitrary = fc.constantFrom('Monthly', 'Weekly');
const mixedCadenceStateArbitrary = uniquePocketArbitrary.chain(pockets =>
    fc.array(budgetMonthArbitrary, { minLength: pockets.length, maxLength: pockets.length })
        .chain(months => fc.array(cadenceArbitrary, { minLength: pockets.length, maxLength: pockets.length })
            .chain(cadences => fc.array(safeIntegerRupiahArbitrary, { minLength: pockets.length, maxLength: pockets.length })
                .chain(monthlyAmounts => fc.array(safeIntegerRupiahArbitrary, { minLength: pockets.length, maxLength: pockets.length })
                    .map(weeklyAmounts => {
                        const effectiveCadences = pockets.map((_, index) =>
                            pockets.length > 1
                                ? (index === 0 ? 'Monthly' : 'Weekly')
                                : cadences[index]
                        );
                        return {
                            cadences: pockets.map((pocket, index) => ({
                                pocket,
                                month: months[index].month,
                                year: months[index].year,
                                budgetMonth: months[index].key,
                                cadence: effectiveCadences[index]
                            })),
                            monthlyAllocations: pockets.map((pocket, index) => ({
                                pocket,
                                month: months[index].month,
                                year: months[index].year,
                                budget: monthlyAmounts[index]
                            })),
                            weeklyAllocations: pockets.map((pocket, index) => ({
                                pocket,
                                month: months[index].month,
                                year: months[index].year,
                                isoWeekYear: 2027,
                                isoWeekNumber: 5,
                                budget: weeklyAmounts[index]
                            }))
                        };
                    })
                )
            )
        )
);
const cadenceStateArbitrary = mixedCadenceStateArbitrary;

const objectIdArbitrary = fc.integer({ min: 0, max: 0xffffff })
    .map(value => value.toString(16).padStart(24, '0'));
const legacyBudgetArbitrary = fc.record({
    _id: objectIdArbitrary,
    pocket: pocketArbitrary,
    month: monthArbitrary,
    year: yearArbitrary,
    budget: safeIntegerRupiahArbitrary,
    createdBy: objectIdArbitrary,
    createdAt: calendarDateArbitrary.map(date => `${date}T12:00:00.000Z`),
    updatedAt: calendarDateArbitrary.map(date => `${date}T12:00:00.000Z`)
}).map(record => record);

const legacyTransactionArbitrary = fc.record({
    _id: objectIdArbitrary,
    date: calendarDateArbitrary.map(date => `${date}T12:00:00.000Z`),
    type: fc.constantFrom(...TRANSACTION_TYPES_LIST),
    pocket: pocketArbitrary,
    ngapain: fc.string({ minLength: 1, maxLength: 40 }),
    by: objectIdArbitrary,
    paidBy: fc.constantFrom('Husband', 'Wife', 'Self'),
    amount: positiveIntegerRupiahArbitrary,
    budgetMonth: monthArbitrary,
    budgetYear: yearArbitrary,
    sourceType: fc.constant('single')
});

const legacyClosedMonthArbitrary = fc.record({
    _id: objectIdArbitrary,
    month: monthArbitrary,
    year: yearArbitrary,
    user: objectIdArbitrary,
    createdAt: calendarDateArbitrary.map(date => `${date}T12:00:00.000Z`)
});

const legacyRecordArbitrary = fc.oneof(
    legacyBudgetArbitrary.map(record => ({ collection: 'pocketbudgets', record })),
    legacyTransactionArbitrary.map(record => ({ collection: 'transactions', record })),
    legacyClosedMonthArbitrary.map(record => ({ collection: 'closedmonths', record }))
);

const concurrentRequestArbitrary = fc.record({
    amount: positiveIntegerRupiahArbitrary,
    delayMs: fc.integer({ min: 0, max: 25 })
}).map(({ amount, delayMs }, index = 0) => ({
    pocket: 'Groceries',
    month: 2,
    year: 2027,
    isoWeekYear: 2027,
    isoWeekNumber: 5,
    amount,
    updatedBy: String(index).padStart(24, '0'),
    requestToken: `request-${index}`,
    delayMs
}));

const correlatedConcurrentWritesArbitrary = fc.array(
    fc.record({
        amount: positiveIntegerRupiahArbitrary,
        delayMs: fc.integer({ min: 0, max: 25 })
    }),
    { minLength: 2, maxLength: 8 }
).map(requests => requests.map(({ amount, delayMs }, index) => ({
    pocket: 'Groceries',
    month: 2,
    year: 2027,
    isoWeekYear: 2027,
    isoWeekNumber: 5,
    amount,
    updatedBy: index.toString(16).padStart(24, '0'),
    requestToken: `request-${index}`,
    delayMs
})));

const concurrentWritesArbitrary = correlatedConcurrentWritesArbitrary;

module.exports = {
    MIN_YEAR,
    MAX_YEAR,
    MAX_RUPIAH,
    yearArbitrary,
    monthArbitrary,
    calendarDateArbitrary,
    strictCalendarDateArbitrary,
    expenseDateArbitrary,
    budgetMonthArbitrary,
    budgetMonthsArbitrary,
    isoWeekArbitrary,
    realIsoWeekArbitrary,
    safeIntegerRupiahArbitrary,
    positiveIntegerRupiahArbitrary,
    rupiahArbitrary,
    pocketArbitrary,
    uniquePocketArbitrary,
    uniquePocketSharesArbitrary,
    pocketSharesArbitrary,
    cadenceArbitrary,
    mixedCadenceStateArbitrary,
    cadenceStateArbitrary,
    legacyBudgetArbitrary,
    legacyTransactionArbitrary,
    legacyClosedMonthArbitrary,
    legacyRecordArbitrary,
    correlatedConcurrentWritesArbitrary,
    concurrentWritesArbitrary
};
