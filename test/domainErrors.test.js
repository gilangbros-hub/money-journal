'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DomainValidationError,
    AuthenticationError,
    AuthorizationError,
    ClosedBudgetPeriodError,
    EditableWindowError,
    AssignmentConflictError,
    ConcurrentWriteConflictError,
    MigrationConflictError,
    RecordNotFoundError,
    StorageError,
    ConfigurationError
} = require('../utils/domainErrors');
const {
    createRequestId,
    requestIdMiddleware,
    sendError,
    toDomainError
} = require('../middleware/errorHandler');

function responseDouble() {
    return {
        headers: {},
        statusCode: null,
        body: null,
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('typed domain errors expose the stable status and code contract', () => {
    const cases = [
        [new DomainValidationError('expenseDate'), 400, 'VALIDATION_ERROR'],
        [new AuthenticationError(), 401, 'AUTHENTICATION_REQUIRED'],
        [new AuthorizationError('Wife'), 403, 'WIFE_ROLE_REQUIRED'],
        [new ClosedBudgetPeriodError('2027-02'), 409, 'BUDGET_MONTH_CLOSED'],
        [new EditableWindowError('2027-01', '2027-02', ['2027-02', '2027-03']), 409, 'BUDGET_MONTH_NOT_EDITABLE'],
        [new AssignmentConflictError('2027-03', 3, 2027), 409, 'BUDGET_MONTH_ASSIGNMENT_CONFLICT'],
        [new ConcurrentWriteConflictError(), 409, 'ALLOCATION_WRITE_CONFLICT'],
        [new MigrationConflictError('MIGRATION_PREVIEW_STALE'), 409, 'MIGRATION_PREVIEW_STALE'],
        [new RecordNotFoundError('transaction'), 404, 'TRANSACTION_NOT_FOUND'],
        [new StorageError(), 503, 'STORAGE_UNAVAILABLE'],
        [new ConfigurationError('CONFIG_INVALID_TIME_ZONE'), 500, 'CONFIG_INVALID_TIME_ZONE']
    ];

    for (const [error, status, code] of cases) {
        assert.equal(error.status, status);
        assert.equal(error.code, code);
        assert.equal(error.isDomainError, true);
    }
});

test('sendError returns a request-correlated safe envelope', () => {
    const response = responseDouble();
    const req = { requestId: 'request-123' };
    const error = new AssignmentConflictError('2027-03', 3, 2027);
    error.details.amount = 500000;
    error.details.database = 'mongodb://private';
    error.details.stack = 'private stack';

    sendError(response, req, error);

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, {
        error: {
            code: 'BUDGET_MONTH_ASSIGNMENT_CONFLICT',
            message: 'The supplied Budget Month does not match the server assignment.',
            field: 'budgetMonth',
            details: {
                derivedBudgetMonth: '2027-03',
                derivedMonth: 3,
                derivedYear: 2027
            },
            requestId: 'request-123'
        }
    });
    assert.equal(JSON.stringify(response.body).includes('mongodb'), false);
    assert.equal(JSON.stringify(response.body).includes('500000'), false);
    assert.equal(JSON.stringify(response.body).includes('stack'), false);
});

test('request ID middleware accepts safe correlation IDs and replaces unsafe input', () => {
    const response = responseDouble();
    const request = { get: () => 'client.correlation-1' };
    requestIdMiddleware(request, response, () => {});
    assert.equal(request.requestId, 'client.correlation-1');
    assert.equal(response.headers['X-Request-ID'], 'client.correlation-1');

    const unsafeResponse = responseDouble();
    const unsafeRequest = { get: () => 'bad\nheader' };
    requestIdMiddleware(unsafeRequest, unsafeResponse, () => {});
    assert.match(unsafeRequest.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(unsafeResponse.headers['X-Request-ID'], unsafeRequest.requestId);
    assert.match(createRequestId(), /^[0-9a-f-]{36}$/);
});

test('framework and duplicate-key failures never preserve raw storage messages', () => {
    const duplicate = toDomainError({ code: 11000, errmsg: 'private index and values' });
    assert.equal(duplicate.code, 'ALLOCATION_WRITE_CONFLICT');
    assert.equal(duplicate.status, 409);
    assert.equal(toDomainError({ name: 'MongoServerError', message: 'private host' }).code, 'STORAGE_UNAVAILABLE');
    assert.equal(toDomainError(new Error('private stack/database details')).code, 'INTERNAL_ERROR');
    assert.equal(toDomainError(new Error('private stack/database details')).message, 'An unexpected error occurred.');
});
