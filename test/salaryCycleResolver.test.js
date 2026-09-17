'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Temporal } = require('@js-temporal/polyfill');
const { DomainValidationError } = require('../utils/domainErrors');
const {
    getActiveBudgetMonth,
    getActualPayday,
    getSalaryCyclePeriod,
    intersectPeriodAndWeek,
    listIntersectingIsoWeeks,
    parseBudgetMonth,
    parseExpenseDate,
    parseIsoWeek,
    resolveBudgetMonth
} = require('../services/salaryCycleResolver');

function assertValidation(action, field) {
    assert.throws(action, error =>
        error instanceof DomainValidationError &&
        error.code === 'VALIDATION_ERROR' &&
        error.field === field
    );
}

test('parses strict expense dates and rejects malformed or nonexistent dates', () => {
    assert.equal(parseExpenseDate('2024-02-29').toString(), '2024-02-29');
    assert.equal(parseExpenseDate('0000-01-01').toString(), '0000-01-01');

    for (const value of [
        '2024-02-30',
        '2024-2-09',
        '2024-02-9',
        '2024/02/09',
        '2024-02-09T00:00:00Z',
        '',
        null,
        20240209
    ]) {
        assertValidation(() => parseExpenseDate(value), 'expenseDate');
    }
});

test('parses strict Budget_Month values with canonical numeric fields', () => {
    assert.deepEqual(parseBudgetMonth('2027-02'), {
        key: '2027-02',
        year: 2027,
        month: 2
    });
    assert.deepEqual(parseBudgetMonth('0000-01'), {
        key: '0000-01',
        year: 0,
        month: 1
    });

    for (const value of ['2027-2', '2027-00', '2027-13', '2027-02-01', '2027/02', null]) {
        assertValidation(() => parseBudgetMonth(value), 'budgetMonth');
    }
});

test('reports field-specific validation errors for payday inputs and time zones', () => {
    assertValidation(
        () => getActualPayday({ year: 2027, month: 0, timeZone: 'Asia/Jakarta' }),
        'month'
    );
    assertValidation(
        () => getActualPayday({ year: 2027.5, month: 2, timeZone: 'Asia/Jakarta' }),
        'year'
    );
    assertValidation(
        () => getActualPayday({ year: 2027, month: 2, timeZone: 'Not/AZone' }),
        'timeZone'
    );
});

test('adjusts the 25th backward only when it falls on a weekend', () => {
    // 2027-02-25 is Thursday, 2027-09-25 is Saturday, and 2027-04-25 is Sunday.
    assert.equal(getActualPayday({ year: 2027, month: 2, timeZone: 'Asia/Jakarta' }), '2027-02-25');
    assert.equal(getActualPayday({ year: 2027, month: 9, timeZone: 'Asia/Jakarta' }), '2027-09-24');
    assert.equal(getActualPayday({ year: 2027, month: 4, timeZone: 'Asia/Jakarta' }), '2027-04-23');
});

test('assigns dates inclusively at payday and rolls December into the next year', () => {
    assert.deepEqual(resolveBudgetMonth({
        expenseDate: '2027-02-24',
        timeZone: 'Asia/Jakarta'
    }), { key: '2027-02', year: 2027, month: 2 });
    assert.deepEqual(resolveBudgetMonth({
        expenseDate: '2027-02-25',
        timeZone: 'Asia/Jakarta'
    }), { key: '2027-03', year: 2027, month: 3 });

    // In 2027 the Saturday 25th is adjusted to Friday the 24th.
    assert.deepEqual(resolveBudgetMonth({
        expenseDate: '2027-12-23',
        timeZone: 'Asia/Jakarta'
    }), { key: '2027-12', year: 2027, month: 12 });
    assert.deepEqual(resolveBudgetMonth({
        expenseDate: '2027-12-24',
        timeZone: 'Asia/Jakarta'
    }), { key: '2028-01', year: 2028, month: 1 });
});

test('returns contiguous inclusive salary-cycle bounds', () => {
    const january = getSalaryCyclePeriod({ budgetMonth: '2027-01', timeZone: 'Asia/Jakarta' });
    const february = getSalaryCyclePeriod({ budgetMonth: '2027-02', timeZone: 'Asia/Jakarta' });

    assert.deepEqual(january, {
        startDate: '2026-12-25',
        endDate: '2027-01-24'
    });
    assert.deepEqual(february, {
        startDate: '2027-01-25',
        endDate: '2027-02-24'
    });

    const dayAfterJanuaryEnd = Temporal.PlainDate.from(january.endDate).add({ days: 1 }).toString();
    assert.equal(dayAfterJanuaryEnd, february.startDate);
    assertValidation(
        () => getSalaryCyclePeriod({ budgetMonth: '2027-13', timeZone: 'Asia/Jakarta' }),
        'budgetMonth'
    );
});

test('derives the active Budget_Month from an injected instant in the household zone', () => {
    const justBeforePayday = getActiveBudgetMonth({
        nowInstant: '2027-02-24T16:59:59Z',
        timeZone: 'Asia/Jakarta'
    });
    const atPayday = getActiveBudgetMonth({
        nowInstant: '2027-02-24T17:00:00Z',
        timeZone: 'Asia/Jakarta'
    });

    assert.equal(justBeforePayday.key, '2027-02');
    assert.equal(atPayday.key, '2027-03');
    assert.deepEqual(getActiveBudgetMonth({
        nowInstant: Temporal.Instant.from('2027-02-24T17:00:00Z'),
        timeZone: 'Asia/Jakarta'
    }), atPayday);

    assertValidation(() => getActiveBudgetMonth({
        nowInstant: '2027-02-24',
        timeZone: 'Asia/Jakarta'
    }), 'nowInstant');
    assertValidation(() => getActiveBudgetMonth({
        nowInstant: new globalThis.Date('2027-02-24T17:00:00Z'),
        timeZone: 'Asia/Jakarta'
    }), 'nowInstant');
});


test('parses only real ISO week-year and week-number pairs', () => {
    assert.deepEqual(parseIsoWeek('2020-W53'), {
        key: '2020-W53',
        weekYear: 2020,
        weekNumber: 53
    });
    assert.deepEqual(parseIsoWeek('2021-W01'), {
        key: '2021-W01',
        weekYear: 2021,
        weekNumber: 1
    });

    for (const value of [
        '2021-W53',
        '2020-W00',
        '2020-W54',
        '2020-w01',
        '2020-W1',
        '2020-W01-extra',
        '20-W01',
        null
    ]) {
        assertValidation(() => parseIsoWeek(value), 'isoWeek');
    }
});

test('lists distinct ISO weeks in ascending Monday order with inclusive intersections', () => {
    const weeks = listIntersectingIsoWeeks({
        period: { startDate: '2021-01-01', endDate: '2021-01-17' }
    });

    assert.deepEqual(weeks, [
        {
            key: '2020-W53',
            weekYear: 2020,
            weekNumber: 53,
            startDate: '2020-12-28',
            endDate: '2021-01-03',
            intersectionStartDate: '2021-01-01',
            intersectionEndDate: '2021-01-03'
        },
        {
            key: '2021-W01',
            weekYear: 2021,
            weekNumber: 1,
            startDate: '2021-01-04',
            endDate: '2021-01-10',
            intersectionStartDate: '2021-01-04',
            intersectionEndDate: '2021-01-10'
        },
        {
            key: '2021-W02',
            weekYear: 2021,
            weekNumber: 2,
            startDate: '2021-01-11',
            endDate: '2021-01-17',
            intersectionStartDate: '2021-01-11',
            intersectionEndDate: '2021-01-17'
        }
    ]);

    assert.deepEqual(intersectPeriodAndWeek({
        period: { startDate: '2021-01-01', endDate: '2021-01-17' },
        week: '2020-W53'
    }), {
        startDate: '2021-01-01',
        endDate: '2021-01-03'
    });
    assert.deepEqual(intersectPeriodAndWeek({
        period: { startDate: '2021-01-01', endDate: '2021-01-17' },
        week: parseIsoWeek('2021-W01')
    }), {
        startDate: '2021-01-04',
        endDate: '2021-01-10'
    });
});

test('includes payday-crossing weeks in both adjacent salary-cycle lists', () => {
    const february = getSalaryCyclePeriod({ budgetMonth: '2027-02' });
    const march = getSalaryCyclePeriod({ budgetMonth: '2027-03' });
    const februaryWeeks = listIntersectingIsoWeeks({ period: february });
    const marchWeeks = listIntersectingIsoWeeks({ period: march });

    const februaryCrossingWeek = februaryWeeks.find(week => week.key === '2027-W08');
    const marchCrossingWeek = marchWeeks.find(week => week.key === '2027-W08');
    assert.ok(februaryCrossingWeek);
    assert.ok(marchCrossingWeek);
    assert.deepEqual(februaryCrossingWeek, {
        key: '2027-W08',
        weekYear: 2027,
        weekNumber: 8,
        startDate: '2027-02-22',
        endDate: '2027-02-28',
        intersectionStartDate: '2027-02-22',
        intersectionEndDate: '2027-02-24'
    });
    assert.deepEqual(marchCrossingWeek, {
        key: '2027-W08',
        weekYear: 2027,
        weekNumber: 8,
        startDate: '2027-02-22',
        endDate: '2027-02-28',
        intersectionStartDate: '2027-02-25',
        intersectionEndDate: '2027-02-28'
    });

    // The shared week is listed in both views, but each date is assigned once.
    assert.equal(resolveBudgetMonth({ expenseDate: '2027-02-24' }).key, '2027-02');
    assert.equal(resolveBudgetMonth({ expenseDate: '2027-02-25' }).key, '2027-03');
});

test('rejects invalid periods and non-intersecting weeks', () => {
    assertValidation(() => listIntersectingIsoWeeks({
        period: { startDate: '2021-01-18', endDate: '2021-01-17' }
    }), 'period');
    assertValidation(() => intersectPeriodAndWeek({
        period: { startDate: '2021-01-18', endDate: '2021-01-24' },
        week: '2021-W01'
    }), 'isoWeek');
    assertValidation(() => intersectPeriodAndWeek({
        period: { startDate: 'not-a-date', endDate: '2021-01-24' },
        week: '2021-W03'
    }), 'period.startDate');
});
