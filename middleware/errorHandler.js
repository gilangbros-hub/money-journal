'use strict';

const crypto = require('node:crypto');
const {
    DomainError,
    DomainValidationError,
    ConcurrentWriteConflictError,
    StorageError
} = require('../utils/domainErrors');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SENSITIVE_KEY_PATTERN = /(password|secret|token|session|cookie|credential|authorization|stack|database|mongo|amount|financial|expense|note|payload|body)/i;
const SAFE_DETAIL_KEYS = new Set([
    'budgetMonth',
    'derivedBudgetMonth',
    'derivedMonth',
    'derivedYear',
    'sourceBudgetMonth',
    'destinationBudgetMonth',
    'requestedBudgetMonth',
    'activeBudgetMonth',
    'editableBudgetMonths',
    'resource',
    'field',
    'reason',
    // Pocket Management recovery metadata. These carry only non-sensitive
    // identifiers and revision numbers a client needs to recover from a
    // rejected mutation; record names, amounts, and payloads remain excluded
    // by the sensitive-key blocklist and the allowlist itself.
    'pocketId',
    'entryIndex',
    'currentVersion',
    'expectedVersion',
    'errors',
    'code'
]);

function createRequestId() {
    return crypto.randomUUID();
}

function requestIdMiddleware(req, res, next) {
    const supplied = req.get('X-Request-ID');
    // Accept only opaque correlation values. Invalid or oversized values are
    // replaced so clients cannot inject response/header control characters.
    const requestId = supplied && REQUEST_ID_PATTERN.test(supplied)
        ? supplied
        : createRequestId();

    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
}

function safeDetailValue(value, key) {
    if (SENSITIVE_KEY_PATTERN.test(key) || !SAFE_DETAIL_KEYS.has(key)) return undefined;
    if (typeof value === 'string') return value.length > 128 ? value.slice(0, 128) : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        const values = value.map(item => safeDetailValue(item, key)).filter(item => item !== undefined);
        return values.length ? values : undefined;
    }
    if (value && typeof value === 'object') {
        const nested = {};
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
            const safe = safeDetailValue(nestedValue, nestedKey);
            if (safe !== undefined) nested[nestedKey] = safe;
        }
        return Object.keys(nested).length ? nested : undefined;
    }
    return undefined;
}

function sanitizeDetails(details) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
    const safe = {};
    for (const [key, value] of Object.entries(details)) {
        const sanitized = safeDetailValue(value, key);
        if (sanitized !== undefined) safe[key] = sanitized;
    }
    return Object.keys(safe).length ? safe : undefined;
}

function isDuplicateKeyError(error) {
    return error && (error.code === 11000 || error.codeName === 'DuplicateKey');
}

function toDomainError(error) {
    if (error instanceof DomainError) return error;

    if (isDuplicateKeyError(error)) {
        return new ConcurrentWriteConflictError();
    }

    // Mongoose cast errors can safely be reported as input validation only
    // when the field is known; the original database message is never sent.
    if (error && error.name === 'CastError' && error.path) {
        return new DomainValidationError(error.path, 'The supplied identifier is invalid.');
    }

    // Mongoose validation errors here represent a failed persistence contract,
    // not a reason to disclose schema details or database text to the client.
    if (error && error.name === 'ValidationError') {
        return new StorageError('integrity', error);
    }

    if (error && (error.name === 'MongoError' || error.name === 'MongoServerError' || error.name === 'MongoNetworkError')) {
        return new StorageError('unavailable', error);
    }

    return new DomainError('An unexpected error occurred.', {
        code: 'INTERNAL_ERROR',
        status: 500,
        cause: error
    });
}

function logError(error, req, mapped) {
    // Do not include req.body/query, session contents, or financial values.
    const context = {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: mapped.status,
        code: mapped.code,
        actorId: req.session?.userId ? String(req.session.userId) : undefined
    };

    if (mapped.status >= 500) {
        console.error('Request failed', context, error);
    } else {
        console.warn('Request rejected', context);
    }
}

function sendError(res, req, error) {
    const mapped = toDomainError(error);
    const requestId = req.requestId || createRequestId();
    if (!res.headersSent) res.setHeader('X-Request-ID', requestId);

    const responseError = {
        code: mapped.code,
        message: mapped.message,
        requestId
    };
    if (mapped.field) responseError.field = mapped.field;
    const details = sanitizeDetails(mapped.details);
    if (details) responseError.details = details;

    if (!res.headersSent) {
        res.status(mapped.status).json({ error: responseError });
    }
    return mapped;
}

function errorHandler(error, req, res, next) {
    const mapped = toDomainError(error);
    logError(error, req, mapped);
    if (res.headersSent) return next(error);

    const requestId = req.requestId || createRequestId();
    res.setHeader('X-Request-ID', requestId);
    const responseError = {
        code: mapped.code,
        message: mapped.message,
        requestId
    };
    if (mapped.field) responseError.field = mapped.field;
    const details = sanitizeDetails(mapped.details);
    if (details) responseError.details = details;
    res.status(mapped.status).json({ error: responseError });
}

function asyncHandler(handler) {
    return function wrappedAsyncHandler(req, res, next) {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

module.exports = {
    asyncHandler,
    createRequestId,
    errorHandler,
    requestIdMiddleware,
    sanitizeDetails,
    sendError,
    toDomainError
};
