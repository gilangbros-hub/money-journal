'use strict';

const mongoose = require('mongoose');
const { Temporal } = require('@js-temporal/polyfill');
const { POCKETS, TRANSACTION_TYPES } = require('./constants');
const { DomainValidationError } = require('./domainErrors');
const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    parseExpenseDate,
    validateTimeZone
} = require('../services/salaryCycleResolver');

const PAYERS = new Set(['Husband', 'Wife', 'Self']);
const SOURCE_TYPES = new Set(['single', 'multi']);
const MAX_SPLIT_COUNT = 3;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function invalid(field, message, details = {}) {
    return new DomainValidationError(field, message, details);
}

function validateIdentifier(value, field = 'id') {
    const validObjectId = value instanceof mongoose.Types.ObjectId ||
        (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value));

    if (!validObjectId) {
        throw invalid(field, `${field} must be a valid identifier.`);
    }

    return value instanceof mongoose.Types.ObjectId ? value.toString() : value;
}

function parseIntegerRupiah(value, field, { positive = false } = {}) {
    let normalized;

    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw invalid(field, `${field} must be a finite integer amount in rupiah.`);
        }
        normalized = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
        try {
            const bigint = BigInt(value);
            if (bigint > MAX_SAFE_INTEGER_BIGINT) {
                throw new RangeError('amount exceeds the safe integer range');
            }
            normalized = Number(bigint);
        } catch (cause) {
            throw invalid(field, `${field} must be a finite integer amount in rupiah.`, {
                cause: cause.message
            });
        }
    } else {
        throw invalid(field, `${field} must be a finite integer amount in rupiah.`);
    }

    if (positive ? normalized < 1 : normalized < 0) {
        throw invalid(field, positive
            ? `${field} must be greater than zero.`
            : `${field} must not be negative.`);
    }

    return normalized;
}

function validateAmount(value, field = 'amount') {
    return parseIntegerRupiah(value, field, { positive: true });
}

function validateShareAmount(value, field = 'amount') {
    return parseIntegerRupiah(value, field, { positive: true });
}

function validateCategory(value, field = 'type') {
    if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(TRANSACTION_TYPES, value)) {
        throw invalid(field, `${field} must be a supported transaction category.`);
    }
    return value;
}

function validatePocket(value, field = 'pocket') {
    if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(POCKETS, value)) {
        throw invalid(field, `${field} must be a supported pocket.`);
    }
    return value;
}

function validatePayer(value = 'Self', field = 'paidBy') {
    if (typeof value !== 'string' || !PAYERS.has(value)) {
        throw invalid(field, `${field} must be Husband, Wife, or Self.`);
    }
    return value;
}

function validateSourceType(value = 'single', field = 'sourceType') {
    if (typeof value !== 'string' || !SOURCE_TYPES.has(value)) {
        throw invalid(field, `${field} must be single or multi.`);
    }
    return value;
}

function validateNote(value, field = 'ngapain') {
    if (typeof value !== 'string' || value.trim() === '') {
        throw invalid(field, `${field} must be a non-empty string.`);
    }
    return value.trim();
}

function normalizeSourceBreakdowns(sourceBreakdowns, amount, field = 'sourceBreakdowns') {
    const normalizedAmount = validateAmount(amount);

    if (!Array.isArray(sourceBreakdowns) || sourceBreakdowns.length < 1 || sourceBreakdowns.length > MAX_SPLIT_COUNT) {
        throw invalid(field, `${field} must contain one to three pocket shares.`);
    }

    const pockets = new Set();
    const normalized = sourceBreakdowns.map((share, index) => {
        if (!share || typeof share !== 'object' || Array.isArray(share)) {
            throw invalid(`${field}.${index}`, 'Each pocket share must be an object.');
        }

        const pocket = validatePocket(share.pocket, `${field}.${index}.pocket`);
        if (pockets.has(pocket)) {
            throw invalid(`${field}.${index}.pocket`, 'Pocket shares must use unique pockets.');
        }
        pockets.add(pocket);

        return {
            pocket,
            amount: validateShareAmount(share.amount, `${field}.${index}.amount`)
        };
    });

    const total = normalized.reduce((sum, share) => sum + BigInt(share.amount), 0n);
    if (total !== BigInt(normalizedAmount)) {
        throw invalid(field, `${field} must sum exactly to amount.`, {
            expected: amount,
            actual: Number(total)
        });
    }

    return normalized;
}

/**
 * Normalize the source representation without falling back to single-pocket
 * mode when a caller supplied a malformed multi-pocket payload.
 */
function normalizeTransactionSource({ sourceType, pocket, sourceBreakdowns, amount }) {
    const hasBreakdowns = sourceBreakdowns !== undefined && sourceBreakdowns !== null;
    const effectiveSourceType = sourceType === undefined || sourceType === null
        ? (hasBreakdowns && Array.isArray(sourceBreakdowns) && sourceBreakdowns.length > 0 ? 'multi' : 'single')
        : validateSourceType(sourceType);

    if (effectiveSourceType === 'multi') {
        if (pocket !== undefined && pocket !== null) {
            validatePocket(pocket);
        }
        const breakdowns = normalizeSourceBreakdowns(sourceBreakdowns, amount);
        return {
            sourceType: 'multi',
            pocket: breakdowns[0].pocket,
            sourceBreakdowns: breakdowns
        };
    }

    if (hasBreakdowns && !Array.isArray(sourceBreakdowns)) {
        throw invalid('sourceBreakdowns', 'sourceBreakdowns must be an array.');
    }

    if (hasBreakdowns && Array.isArray(sourceBreakdowns) && sourceBreakdowns.length > 0) {
        throw invalid('sourceBreakdowns', 'sourceBreakdowns are only valid for multi-pocket transactions.');
    }

    return {
        sourceType: 'single',
        pocket: validatePocket(pocket),
        sourceBreakdowns: []
    };
}

function validateExpenseDate(value, field = 'expenseDate') {
    try {
        return parseExpenseDate(value).toString();
    } catch (error) {
        if (error instanceof DomainValidationError && error.field === 'expenseDate' && field === 'expenseDate') {
            throw error;
        }
        throw invalid(field, `${field} must be a valid YYYY-MM-DD calendar date.`);
    }
}

function compatibilityDateForExpenseDate(expenseDate, timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE) {
    const normalizedTimeZone = validateTimeZone(timeZone);
    const plainDate = parseExpenseDate(expenseDate);
    const zonedNoon = plainDate.toZonedDateTime({
        timeZone: normalizedTimeZone,
        plainTime: Temporal.PlainTime.from('12:00')
    });
    return new Date(zonedNoon.toInstant().epochMilliseconds);
}

function expenseDateFromCompatibilityDate(value, timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE, field = 'date') {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw invalid(field, `${field} must be a valid date value.`);
    }

    const normalizedTimeZone = validateTimeZone(timeZone);
    return Temporal.Instant.fromEpochMilliseconds(value.getTime())
        .toZonedDateTimeISO(normalizedTimeZone)
        .toPlainDate()
        .toString();
}

module.exports = {
    MAX_SPLIT_COUNT,
    PAYERS,
    SOURCE_TYPES,
    compatibilityDateForExpenseDate,
    expenseDateFromCompatibilityDate,
    normalizeSourceBreakdowns,
    normalizeTransactionSource,
    validateAmount,
    validateCategory,
    validateExpenseDate,
    validateIdentifier,
    validateNote,
    validatePayer,
    validatePocket,
    validateShareAmount,
    validateSourceType
};
