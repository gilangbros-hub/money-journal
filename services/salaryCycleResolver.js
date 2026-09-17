'use strict';

const { Temporal } = require('@js-temporal/polyfill');
const { DomainValidationError } = require('../utils/domainErrors');

const DEFAULT_HOUSEHOLD_TIME_ZONE = 'Asia/Jakarta';
const EXPENSE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BUDGET_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const FIXED_OFFSET_PATTERN = /^[+-]\d{2}(?::?\d{2})?$/;

function invalid(field, message, details) {
    return new DomainValidationError(field, message, details);
}

/**
 * Validate an IANA time-zone identifier without consulting process state.
 * Fixed offsets are intentionally not accepted: household rules are tied to
 * a named zone and its calendar transitions.
 */
function validateTimeZone(timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE) {
    if (typeof timeZone !== 'string' || timeZone.trim() === '') {
        throw invalid('timeZone', 'timeZone must be a recognized IANA time zone.');
    }

    const normalized = timeZone.trim();
    if (FIXED_OFFSET_PATTERN.test(normalized)) {
        throw invalid('timeZone', 'timeZone must be a named IANA time zone.');
    }

    try {
        const zonedDateTime = Temporal.Instant
            .from('2000-01-01T00:00:00Z')
            .toZonedDateTimeISO(normalized);
        return zonedDateTime.timeZoneId;
    } catch (cause) {
        throw invalid(
            'timeZone',
            `timeZone must be a recognized IANA time zone: ${normalized}.`,
            { cause: cause?.message }
        );
    }
}

function parseExpenseDate(value) {
    if (typeof value !== 'string' || !EXPENSE_DATE_PATTERN.test(value)) {
        throw invalid(
            'expenseDate',
            'expenseDate must use the YYYY-MM-DD format.'
        );
    }

    try {
        const date = Temporal.PlainDate.from(value, { overflow: 'reject' });
        if (date.toString() !== value) {
            throw new RangeError('date round-trip did not preserve its representation');
        }
        return date;
    } catch (cause) {
        throw invalid(
            'expenseDate',
            'expenseDate must be a valid calendar date.',
            { cause: cause?.message }
        );
    }
}

function parseBudgetMonth(value) {
    if (typeof value !== 'string' || !BUDGET_MONTH_PATTERN.test(value)) {
        throw invalid(
            'budgetMonth',
            'budgetMonth must use the YYYY-MM format.'
        );
    }

    try {
        const yearMonth = Temporal.PlainYearMonth.from(value, { overflow: 'reject' });
        if (yearMonth.toString() !== value) {
            throw new RangeError('month round-trip did not preserve its representation');
        }
        return {
            key: yearMonth.toString(),
            year: yearMonth.year,
            month: yearMonth.month
        };
    } catch (cause) {
        throw invalid(
            'budgetMonth',
            'budgetMonth must be a valid calendar month.',
            { cause: cause?.message }
        );
    }
}

function parseYearMonthFields(year, month) {
    if (!Number.isInteger(year)) {
        throw invalid('year', 'year must be an integer calendar year.');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw invalid('month', 'month must be an integer from 1 through 12.');
    }

    try {
        return Temporal.PlainYearMonth.from({ year, month }, { overflow: 'reject' });
    } catch (cause) {
        throw invalid(
            'year',
            'year must be a valid local calendar year.',
            { cause: cause?.message }
        );
    }
}

function actualPaydayForYearMonth(yearMonth) {
    const nominalPayday = yearMonth.toPlainDate({ day: 25 });
    const daysToSubtract = nominalPayday.dayOfWeek === 6
        ? 1
        : nominalPayday.dayOfWeek === 7
            ? 2
            : 0;

    return nominalPayday.subtract({ days: daysToSubtract }).toString();
}

function getActualPayday({ year, month, timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE }) {
    validateTimeZone(timeZone);
    const yearMonth = parseYearMonthFields(year, month);
    return actualPaydayForYearMonth(yearMonth);
}

function normalizeBudgetMonth(value) {
    if (typeof value === 'string') {
        return parseBudgetMonth(value);
    }

    if (!value || typeof value !== 'object') {
        throw invalid('budgetMonth', 'budgetMonth must be a valid YYYY-MM value.');
    }

    if (typeof value.key === 'string') {
        const parsed = parseBudgetMonth(value.key);
        if ((value.year !== undefined && value.year !== parsed.year) ||
            (value.month !== undefined && value.month !== parsed.month)) {
            throw invalid('budgetMonth', 'budgetMonth fields must identify one month.');
        }
        return parsed;
    }

    const yearMonth = parseYearMonthFields(value.year, value.month);
    return {
        key: yearMonth.toString(),
        year: yearMonth.year,
        month: yearMonth.month
    };
}

function resolveBudgetMonth({ expenseDate, timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE }) {
    validateTimeZone(timeZone);
    const date = expenseDate instanceof Temporal.PlainDate
        ? expenseDate
        : parseExpenseDate(expenseDate);

    const currentYearMonth = Temporal.PlainYearMonth.from({
        year: date.year,
        month: date.month
    });
    const actualPayday = actualPaydayForYearMonth(currentYearMonth);
    const assignedYearMonth = date.toString() < actualPayday
        ? currentYearMonth
        : currentYearMonth.add({ months: 1 });

    return {
        key: assignedYearMonth.toString(),
        year: assignedYearMonth.year,
        month: assignedYearMonth.month
    };
}

function getSalaryCyclePeriod({ budgetMonth, timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE }) {
    validateTimeZone(timeZone);
    const target = normalizeBudgetMonth(budgetMonth);
    const targetYearMonth = Temporal.PlainYearMonth.from({
        year: target.year,
        month: target.month
    });
    const precedingYearMonth = targetYearMonth.subtract({ months: 1 });
    const startDate = actualPaydayForYearMonth(precedingYearMonth);
    const targetPayday = Temporal.PlainDate.from(actualPaydayForYearMonth(targetYearMonth));
    const endDate = targetPayday.subtract({ days: 1 }).toString();

    return { startDate, endDate };
}

function parseInstant(value) {
    if (value instanceof Temporal.Instant) {
        return value;
    }
    if (typeof value !== 'string' || value.trim() === '') {
        throw invalid(
            'nowInstant',
            'nowInstant must be an exact Temporal instant or an ISO instant string.'
        );
    }

    try {
        return Temporal.Instant.from(value);
    } catch (cause) {
        throw invalid(
            'nowInstant',
            'nowInstant must be a valid ISO instant.',
            { cause: cause?.message }
        );
    }
}

function getActiveBudgetMonth({ nowInstant, timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE }) {
    const normalizedTimeZone = validateTimeZone(timeZone);
    const instant = parseInstant(nowInstant);
    const localDate = instant.toZonedDateTimeISO(normalizedTimeZone).toPlainDate();
    return resolveBudgetMonth({ expenseDate: localDate, timeZone: normalizedTimeZone });
}

const ISO_WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;

function weekKey(weekYear, weekNumber) {
    return `${String(weekYear).padStart(4, '0')}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Return the Monday for an ISO week-year/week-number pair.  Jan 4 is always
 * in ISO week 1, so this also gives us an independent way to validate week 53.
 */
function mondayForIsoWeek(weekYear, weekNumber) {
    const janFourth = Temporal.PlainDate.from({
        year: weekYear,
        month: 1,
        day: 4
    });
    const weekOneMonday = janFourth.subtract({ days: janFourth.dayOfWeek - 1 });
    return weekOneMonday.add({ days: (weekNumber - 1) * 7 });
}

function parseIsoWeek(value) {
    if (typeof value !== 'string' || !ISO_WEEK_PATTERN.test(value)) {
        throw invalid('isoWeek', 'isoWeek must use the YYYY-Www format.');
    }

    const match = ISO_WEEK_PATTERN.exec(value);
    const weekYear = Number(match[1]);
    const weekNumber = Number(match[2]);

    if (weekNumber < 1 || weekNumber > 53) {
        throw invalid('isoWeek', 'isoWeek must use a week number from 01 through 53.');
    }

    try {
        const monday = mondayForIsoWeek(weekYear, weekNumber);
        if (monday.yearOfWeek !== weekYear || monday.weekOfYear !== weekNumber) {
            throw new RangeError('week number does not exist in the supplied ISO week-year');
        }
    } catch (cause) {
        throw invalid(
            'isoWeek',
            'isoWeek must identify a real ISO calendar week.',
            { cause: cause?.message }
        );
    }

    return { key: value, weekYear, weekNumber };
}

function parsePeriodDate(value, field) {
    if (value instanceof Temporal.PlainDate) {
        return value;
    }

    try {
        return parseExpenseDate(value);
    } catch (cause) {
        throw invalid(field, `${field} must be a valid YYYY-MM-DD date.`, {
            cause: cause?.message
        });
    }
}

function normalizePeriod(period) {
    if (!period || typeof period !== 'object') {
        throw invalid('period', 'period must contain startDate and endDate.');
    }

    const startDate = parsePeriodDate(period.startDate, 'period.startDate');
    const endDate = parsePeriodDate(period.endDate, 'period.endDate');
    if (Temporal.PlainDate.compare(startDate, endDate) > 0) {
        throw invalid('period', 'period startDate must not be after endDate.');
    }

    return { startDate, endDate };
}

function normalizeIsoWeek(week) {
    if (typeof week === 'string') {
        return parseIsoWeek(week);
    }
    if (!week || typeof week !== 'object') {
        throw invalid('isoWeek', 'isoWeek must identify a real ISO calendar week.');
    }

    if (typeof week.key === 'string') {
        const parsed = parseIsoWeek(week.key);
        if ((week.weekYear !== undefined && week.weekYear !== parsed.weekYear) ||
            (week.weekNumber !== undefined && week.weekNumber !== parsed.weekNumber)) {
            throw invalid('isoWeek', 'isoWeek fields must identify one ISO week.');
        }
        return parsed;
    }

    if (!Number.isInteger(week.weekYear) || !Number.isInteger(week.weekNumber)) {
        throw invalid('isoWeek', 'isoWeek must include integer weekYear and weekNumber fields.');
    }

    return parseIsoWeek(weekKey(week.weekYear, week.weekNumber));
}

function describeIsoWeek(week) {
    const monday = mondayForIsoWeek(week.weekYear, week.weekNumber);
    return {
        key: week.key,
        weekYear: week.weekYear,
        weekNumber: week.weekNumber,
        startDate: monday.toString(),
        endDate: monday.add({ days: 6 }).toString()
    };
}

function intersectDates(period, week) {
    const weekStart = Temporal.PlainDate.from(week.startDate);
    const weekEnd = Temporal.PlainDate.from(week.endDate);
    const startDate = Temporal.PlainDate.compare(period.startDate, weekStart) >= 0
        ? period.startDate
        : weekStart;
    const endDate = Temporal.PlainDate.compare(period.endDate, weekEnd) <= 0
        ? period.endDate
        : weekEnd;

    if (Temporal.PlainDate.compare(startDate, endDate) > 0) {
        return null;
    }

    return {
        startDate: startDate.toString(),
        endDate: endDate.toString()
    };
}

function intersectPeriodAndWeek({ period, week }) {
    const normalizedPeriod = normalizePeriod(period);
    const normalizedWeek = describeIsoWeek(normalizeIsoWeek(week));
    const intersection = intersectDates(normalizedPeriod, normalizedWeek);

    if (!intersection) {
        throw invalid(
            'isoWeek',
            'isoWeek must contain at least one date in the supplied period.'
        );
    }

    return intersection;
}

function listIntersectingIsoWeeks({ period }) {
    const normalizedPeriod = normalizePeriod(period);
    const firstMonday = normalizedPeriod.startDate.subtract({
        days: normalizedPeriod.startDate.dayOfWeek - 1
    });
    const weeks = [];

    for (let monday = firstMonday; Temporal.PlainDate.compare(monday, normalizedPeriod.endDate) <= 0; monday = monday.add({ days: 7 })) {
        const descriptor = describeIsoWeek(parseIsoWeek(weekKey(monday.yearOfWeek, monday.weekOfYear)));
        const intersection = intersectDates(normalizedPeriod, descriptor);
        if (intersection) {
            weeks.push({
                ...descriptor,
                intersectionStartDate: intersection.startDate,
                intersectionEndDate: intersection.endDate
            });
        }
    }

    return weeks;
}

module.exports = {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    getActiveBudgetMonth,
    getActualPayday,
    getSalaryCyclePeriod,
    intersectPeriodAndWeek,
    listIntersectingIsoWeeks,
    parseBudgetMonth,
    parseExpenseDate,
    parseIsoWeek,
    resolveBudgetMonth,
    validateTimeZone
};
