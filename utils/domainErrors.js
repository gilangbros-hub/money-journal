'use strict';

/**
 * Domain errors are the only errors that may contribute a client-facing
 * message to an API response.  Database and framework errors are translated
 * by the HTTP adapter before they leave the process.
 */
class DomainError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = options.code || 'INTERNAL_ERROR';
        this.status = Number.isInteger(options.status) ? options.status : 500;
        this.field = options.field;
        this.details = options.details;
        this.cause = options.cause;
        this.isDomainError = true;
        Error.captureStackTrace?.(this, this.constructor);
    }
}

class DomainValidationError extends DomainError {
    constructor(field, reason = 'The supplied value is invalid.', details = {}) {
        super(reason, { code: 'VALIDATION_ERROR', status: 400, field, details });
    }
}

class AuthenticationError extends DomainError {
    constructor() {
        super('Authentication is required.', {
            code: 'AUTHENTICATION_REQUIRED',
            status: 401
        });
    }
}

class AuthorizationError extends DomainError {
    constructor(requiredRole = 'Wife') {
        const code = requiredRole === 'Operator' ? 'OPERATOR_ROLE_REQUIRED' : 'WIFE_ROLE_REQUIRED';
        super('You are not authorized to perform this action.', { code, status: 403 });
    }
}

class FeatureDisabledError extends DomainError {
    constructor(feature = 'salary-cycle budgeting') {
        super('This feature is not enabled.', {
            code: 'SALARY_CYCLE_FEATURE_DISABLED',
            status: 404,
            details: { feature }
        });
    }
}

class ClosedBudgetPeriodError extends DomainError {
    constructor(budgetMonth, details = {}) {
        super('The selected Budget Month is closed.', {
            code: 'BUDGET_MONTH_CLOSED',
            status: 409,
            field: 'budgetMonth',
            details: { budgetMonth, ...details }
        });
    }
}

class EditableWindowError extends DomainError {
    constructor(requestedBudgetMonth, activeBudgetMonth, editableBudgetMonths = []) {
        super('The selected Budget Month is outside the editable window.', {
            code: 'BUDGET_MONTH_NOT_EDITABLE',
            status: 409,
            field: 'budgetMonth',
            details: { requestedBudgetMonth, activeBudgetMonth, editableBudgetMonths }
        });
    }
}

class AssignmentConflictError extends DomainError {
    constructor(derivedBudgetMonth, derivedMonth, derivedYear) {
        super('The supplied Budget Month does not match the server assignment.', {
            code: 'BUDGET_MONTH_ASSIGNMENT_CONFLICT',
            status: 409,
            field: 'budgetMonth',
            details: { derivedBudgetMonth, derivedMonth, derivedYear }
        });
    }
}

class ConcurrentWriteConflictError extends DomainError {
    constructor(details = {}) {
        super('The allocation was changed by another request. Please retry.', {
            code: 'ALLOCATION_WRITE_CONFLICT',
            status: 409,
            details
        });
    }
}

const MIGRATION_CODES = new Set([
    'MIGRATION_PREVIEW_BLOCKED',
    'MIGRATION_PREVIEW_STALE',
    'MIGRATION_APPROVAL_REQUIRED',
    'MIGRATION_ROLLBACK_CONFLICT'
]);

class MigrationConflictError extends DomainError {
    constructor(code = 'MIGRATION_PREVIEW_BLOCKED', details = {}) {
        const safeCode = MIGRATION_CODES.has(code) ? code : 'MIGRATION_PREVIEW_BLOCKED';
        super('The migration operation cannot proceed.', {
            code: safeCode,
            status: 409,
            details
        });
    }
}

const RECORD_CODES = {
    transaction: 'TRANSACTION_NOT_FOUND',
    allocation: 'ALLOCATION_NOT_FOUND'
};

class RecordNotFoundError extends DomainError {
    constructor(resource = 'record') {
        const normalizedResource = String(resource).toLowerCase();
        const code = RECORD_CODES[normalizedResource] || 'RESOURCE_NOT_FOUND';
        super('The requested resource was not found.', {
            code,
            status: 404,
            details: RECORD_CODES[normalizedResource] ? { resource: normalizedResource } : undefined
        });
    }
}

class StorageError extends DomainError {
    constructor(kind = 'unavailable', cause) {
        const integrity = kind === 'integrity';
        super(integrity ? 'A data integrity error occurred.' : 'The data store is temporarily unavailable.', {
            code: integrity ? 'DATA_INTEGRITY_ERROR' : 'STORAGE_UNAVAILABLE',
            status: integrity ? 500 : 503,
            cause
        });
    }
}

class ConfigurationError extends DomainError {
    constructor(code = 'CONFIG_INVALID_TIME_ZONE', cause) {
        const allowedCodes = new Set([
            'CONFIG_INVALID_TIME_ZONE',
            'CONFIG_TRANSACTIONS_REQUIRED',
            'CONFIG_INDEX_PRECONDITION_FAILED'
        ]);
        const safeCode = allowedCodes.has(code) ? code : 'CONFIG_INVALID_TIME_ZONE';
        super('The application configuration is invalid.', {
            code: safeCode,
            status: 500,
            cause
        });
        this.isFatal = true;
    }
}

module.exports = {
    DomainError,
    DomainValidationError,
    AuthenticationError,
    AuthorizationError,
    FeatureDisabledError,
    ClosedBudgetPeriodError,
    EditableWindowError,
    AssignmentConflictError,
    ConcurrentWriteConflictError,
    MigrationConflictError,
    RecordNotFoundError,
    StorageError,
    ConfigurationError
};
