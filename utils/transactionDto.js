'use strict';

const {
    DEFAULT_HOUSEHOLD_TIME_ZONE,
    validateTimeZone
} = require('../services/salaryCycleResolver');
const {
    compatibilityDateForExpenseDate,
    expenseDateFromCompatibilityDate,
    normalizeTransactionSource,
    validateAmount,
    validateCategory,
    validateExpenseDate,
    validateIdentifier,
    validateNote,
    validatePayer
} = require('./transactionValidators');

function getPlainRecord(transaction) {
    if (!transaction || typeof transaction !== 'object') {
        throw new TypeError('transaction must be an object');
    }

    return typeof transaction.toObject === 'function'
        ? transaction.toObject()
        : { ...transaction };
}

function canonicalExpenseDateFromInput(input, timeZone) {
    if (input.expenseDate !== undefined && input.expenseDate !== null) {
        return validateExpenseDate(input.expenseDate, 'expenseDate');
    }

    if (typeof input.date === 'string') {
        return validateExpenseDate(input.date, 'date');
    }

    return expenseDateFromCompatibilityDate(input.date, timeZone, 'date');
}

/**
 * Validate and map a transaction command to persistence-ready canonical data.
 * Assignment fields are deliberately passed through: deriving and checking
 * Budget_Month belongs to the later TransactionService task.
 */
function toCanonicalTransactionInput(input, { timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('transaction input must be an object');
    }

    const normalizedTimeZone = validateTimeZone(timeZone);
    const expenseDate = canonicalExpenseDateFromInput(input, normalizedTimeZone);
    const amount = validateAmount(input.amount);
    const source = normalizeTransactionSource({
        sourceType: input.sourceType,
        pocket: input.pocket,
        sourceBreakdowns: input.sourceBreakdowns,
        amount
    });

    const mapped = {
        expenseDate,
        date: compatibilityDateForExpenseDate(expenseDate, normalizedTimeZone),
        type: validateCategory(input.type ?? input.category),
        ngapain: validateNote(input.ngapain),
        amount,
        paidBy: validatePayer(input.paidBy),
        ...source
    };

    if (input.by !== undefined && input.by !== null) {
        mapped.by = validateIdentifier(input.by, 'by');
    }

    // Preserve legacy assignment data for the service to validate or replace;
    // this mapper never invents a Budget_Month.
    if (input.budgetMonth !== undefined) mapped.budgetMonth = input.budgetMonth;
    if (input.budgetYear !== undefined) mapped.budgetYear = input.budgetYear;

    return mapped;
}

/**
 * Map a stored transaction to the stable API/edit DTO. The canonical date is
 * returned unchanged and the legacy date field is a date-only compatibility
 * alias, never a serialized UTC-midnight instant.
 */
function toTransactionDto(transaction, { timeZone = DEFAULT_HOUSEHOLD_TIME_ZONE } = {}) {
    const normalizedTimeZone = validateTimeZone(timeZone);
    const record = getPlainRecord(transaction);
    const expenseDate = record.expenseDate !== undefined && record.expenseDate !== null
        ? validateExpenseDate(record.expenseDate, 'expenseDate')
        : expenseDateFromCompatibilityDate(record.date, normalizedTimeZone, 'date');
    const amount = validateAmount(record.amount);
    const type = validateCategory(record.type);
    const ngapain = validateNote(record.ngapain);
    const paidBy = validatePayer(record.paidBy);
    const source = normalizeTransactionSource({
        sourceType: record.sourceType,
        pocket: record.pocket,
        sourceBreakdowns: record.sourceBreakdowns,
        amount
    });

    return {
        ...record,
        type,
        ngapain,
        paidBy,
        ...source,
        expenseDate,
        date: expenseDate
    };
}

module.exports = {
    toCanonicalTransactionInput,
    toTransactionDto,
    // Explicit aliases make the mapper names easy to consume from controllers
    // without coupling callers to persistence-versus-response terminology.
    mapTransactionInput: toCanonicalTransactionInput,
    mapTransactionToDto: toTransactionDto
};
