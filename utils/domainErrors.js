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

// Each rollout-gated capability owns a distinct feature-disabled code so
// clients and route tests can tell one disabled feature from another. The
// salary-cycle default is retained for existing callers; new capabilities add
// their own mapping. An unrecognized feature falls back to the salary-cycle
// code to preserve the historical default behavior.
const FEATURE_DISABLED_CODES = {
    'salary-cycle budgeting': 'SALARY_CYCLE_FEATURE_DISABLED',
    'pocket management': 'POCKET_MANAGEMENT_FEATURE_DISABLED',
    'expense type management': 'EXPENSE_TYPE_MANAGEMENT_FEATURE_DISABLED'
};

class FeatureDisabledError extends DomainError {
    constructor(feature = 'salary-cycle budgeting') {
        const code = FEATURE_DISABLED_CODES[feature] || 'SALARY_CYCLE_FEATURE_DISABLED';
        super('This feature is not enabled.', {
            code,
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
    allocation: 'ALLOCATION_NOT_FOUND',
    pocket: 'POCKET_NOT_FOUND',
    'pocket assignment': 'POCKET_ASSIGNMENT_NOT_FOUND',
    'expense type': 'EXPENSE_TYPE_NOT_FOUND'
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

/**
 * Normalize an accumulated field failure into a safe, self-describing entry.
 * Only recovery-oriented metadata is retained: the field path, an optional
 * machine code, a human-readable reason, and, for batch (assignment) commands,
 * the ordinal position of the offending entry. Submitted values, record names,
 * and any other payload data are never carried onto the entry.
 */
function toFieldError(entry) {
    if (entry instanceof DomainError) {
        const fieldError = { reason: entry.message };
        if (entry.field !== undefined) fieldError.field = entry.field;
        if (entry.code) fieldError.code = entry.code;
        const index = entry.details && entry.details.entryIndex;
        if (Number.isInteger(index)) fieldError.entryIndex = index;
        return fieldError;
    }
    const source = entry && typeof entry === 'object' ? entry : {};
    const fieldError = { reason: source.reason || source.message || 'The supplied value is invalid.' };
    if (source.field !== undefined) fieldError.field = source.field;
    if (source.code !== undefined) fieldError.code = source.code;
    if (Number.isInteger(source.entryIndex)) fieldError.entryIndex = source.entryIndex;
    return fieldError;
}

/**
 * Aggregate multi-field validation error. Carries an ordered array of
 * field-specific errors so a single response can report every invalid field
 * (definition attributes) or every independently evaluable invalid entry
 * (assignment confirmation) without disclosing submitted values.
 */
class PocketValidationError extends DomainError {
    constructor(errors = [], reason = 'One or more supplied fields are invalid.') {
        const list = (Array.isArray(errors) ? errors : [errors])
            .filter(entry => entry !== undefined && entry !== null)
            .map(toFieldError);
        const singleField = list.length === 1 ? list[0].field : undefined;
        super(reason, {
            code: 'VALIDATION_ERROR',
            status: 400,
            field: singleField,
            details: { errors: list }
        });
        this.errors = list;
    }
}

const POCKET_LIFECYCLE_CODES = new Set([
    'POCKET_ARCHIVED_CONFLICT',
    'POCKET_ACTIVE_CONFLICT',
    'POCKET_ASSIGNMENT_SPENDING_CONFLICT'
]);

/**
 * Lifecycle conflict for operations rejected by the current state of a pocket
 * or its assignments: editing/assigning an archived pocket, restoring an
 * already-active pocket, or removing an assignment that has attributed
 * spending. Safe details carry only the authorized pocket id and Budget Month;
 * pocket names and spending values are never included.
 */
class PocketLifecycleConflictError extends DomainError {
    constructor(code = 'POCKET_ARCHIVED_CONFLICT', details = {}) {
        const safeCode = POCKET_LIFECYCLE_CODES.has(code) ? code : 'POCKET_ARCHIVED_CONFLICT';
        super('The pocket lifecycle state does not permit this operation.', {
            code: safeCode,
            status: 409,
            details
        });
    }
}

/**
 * Explicit-confirmation-required error for destructive lifecycle commands
 * (archive, assignment removal) submitted without the confirmation flag for the
 * identified target.
 */
class ConfirmationRequiredError extends DomainError {
    constructor(details = {}) {
        super('Explicit confirmation is required to complete this action.', {
            code: 'POCKET_CONFIRMATION_REQUIRED',
            status: 400,
            field: 'confirmed',
            details
        });
    }
}

/**
 * Optimistic-concurrency conflict. The submitted Record_Version no longer
 * matches the stored version, so the write is rejected. The current stored
 * version is surfaced as safe recovery metadata so the interface can offer a
 * keep/load recovery; no record values are disclosed.
 */
class VersionConflictError extends DomainError {
    constructor(currentVersion, details = {}) {
        const safeDetails = { ...details };
        if (Number.isInteger(currentVersion)) safeDetails.currentVersion = currentVersion;
        super('The record was changed by another accepted update. Please reload and retry.', {
            code: 'VERSION_CONFLICT',
            status: 409,
            details: safeDetails
        });
    }
}

/**
 * Normalized-name uniqueness conflict for a pocket definition. The colliding
 * name value is never echoed back; only the offending field path is reported.
 */
class PocketNameConflictError extends DomainError {
    constructor(details = {}) {
        super('A pocket with the same name already exists.', {
            code: 'POCKET_NAME_CONFLICT',
            status: 409,
            field: 'name',
            details
        });
    }
}

const POCKET_ASSIGNMENT_CONFLICT_CODES = new Set([
    'POCKET_ASSIGNMENT_DUPLICATE',
    'POCKET_ASSIGNMENT_CONFLICT'
]);

/**
 * Assignment-specific conflict, e.g. a confirmation batch that references the
 * same pocket id more than once. Safe details identify the offending pocket id
 * and, for batch commands, the entry index; no allocation or spending values
 * are disclosed.
 */
class PocketAssignmentConflictError extends DomainError {
    constructor(code = 'POCKET_ASSIGNMENT_DUPLICATE', details = {}) {
        const safeCode = POCKET_ASSIGNMENT_CONFLICT_CODES.has(code)
            ? code
            : 'POCKET_ASSIGNMENT_DUPLICATE';
        super('The pocket assignment request contains a conflict.', {
            code: safeCode,
            status: 409,
            details
        });
    }
}

module.exports = {
    DomainError,
    DomainValidationError,
    PocketValidationError,
    AuthenticationError,
    AuthorizationError,
    FeatureDisabledError,
    ClosedBudgetPeriodError,
    EditableWindowError,
    AssignmentConflictError,
    PocketAssignmentConflictError,
    PocketLifecycleConflictError,
    ConfirmationRequiredError,
    VersionConflictError,
    PocketNameConflictError,
    ConcurrentWriteConflictError,
    MigrationConflictError,
    RecordNotFoundError,
    StorageError,
    ConfigurationError,
    toFieldError
};
