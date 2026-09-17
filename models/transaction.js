const mongoose = require('mongoose');
const { Temporal } = require('@js-temporal/polyfill');

const { TRANSACTION_TYPES, POCKETS } = require('../utils/constants');

const EXPENSE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ASSIGNMENT_VERSIONS = ['salary-cycle-v1', 'legacy-preserved'];
const SCHEMA_VERSIONS = [1, 2];

/**
 * Expense_Date is a calendar date, not an instant. Keep validation here strict
 * so a canonical value cannot be silently changed by a JavaScript Date parse.
 */
const isCanonicalExpenseDate = (value) => {
    if (typeof value !== 'string' || !EXPENSE_DATE_PATTERN.test(value)) return false;

    try {
        return Temporal.PlainDate.from(value, { overflow: 'reject' }).toString() === value;
    } catch {
        return false;
    }
};

const integerField = (message) => ({
    validator: Number.isInteger,
    message
});

const transactionSchema = new mongoose.Schema({
    // Canonical date-only representation. Legacy documents may not have this
    // field until the additive migration has been approved and executed.
    expenseDate: {
        type: String,
        required: function requiredForCanonicalSchema() {
            return this.schemaVersion >= 2;
        },
        validate: {
            validator: isCanonicalExpenseDate,
            message: 'expenseDate must be a valid YYYY-MM-DD calendar date.'
        }
    },
    // The BSON Date remains a compatibility field for existing readers. It is
    // never the source of salary-cycle classification.
    date: {
        type: Date,
        required: false,
        default: Date.now
    },
    type: {
        type: String,
        required: true,
        enum: Object.keys(TRANSACTION_TYPES)
    },
    pocket: {
        type: String,
        required: true,
        enum: Object.keys(POCKETS)
    },
    // Managed immutable Pocket_Identifier reference. Optional during the
    // additive rollout so legacy documents remain valid; TransactionService
    // requires it for managed single-pocket records and resolves it against the
    // Pocket_Assignment for the stored Budget_Month. The legacy `pocket` string
    // is retained as a compatibility snapshot projection.
    pocketId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PocketDefinition',
        required: false
    },
    ngapain: {              // Notes
        type: String,
        required: true,
        trim: true
    },
    by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    paidBy: {
        type: String,
        enum: ['Husband', 'Wife', 'Self'],
        default: 'Self',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    // These numeric fields remain the stored, authoritative assignment for
    // compatibility readers and reporting queries.
    budgetMonth: {
        type: Number,
        required: true,
        min: 1,
        max: 12,
        validate: integerField('budgetMonth must be an integer.')
    },
    budgetYear: {
        type: Number,
        required: true,
        validate: integerField('budgetYear must be an integer.')
    },
    assignmentVersion: {
        type: String,
        enum: ASSIGNMENT_VERSIONS,
        default: function assignmentVersionDefault() {
            return this.expenseDate ? 'salary-cycle-v1' : 'legacy-preserved';
        }
    },
    schemaVersion: {
        type: Number,
        enum: SCHEMA_VERSIONS,
        default: function schemaVersionDefault() {
            return this.expenseDate ? 2 : 1;
        }
    },
    sourceType: {
        type: String,
        enum: ['single', 'multi'],
        default: 'single'
    },
    sourceBreakdowns: [{
        pocket: {
            type: String,
            enum: Object.keys(POCKETS)
        },
        // Managed immutable Pocket_Identifier reference for a split share.
        // Optional during rollout; required for each managed split share and
        // validated against the Budget_Month Pocket_Assignment. The legacy
        // `pocket` string is retained as a compatibility snapshot projection.
        pocketId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PocketDefinition',
            required: false
        },
        amount: {
            type: Number,
            min: 0
        }
    }]
}, {
    timestamps: true
});

// Reporting and pocket-attribution reads use the stored Budget_Month and the
// canonical date when available. Keep the split-pocket index additive.
transactionSchema.index({ budgetYear: 1, budgetMonth: 1, expenseDate: -1 });
transactionSchema.index({ budgetYear: 1, budgetMonth: 1, pocket: 1 });
transactionSchema.index({ budgetYear: 1, budgetMonth: 1, 'sourceBreakdowns.pocket': 1, expenseDate: 1 });

// Managed-mode reads resolve pocket attribution by the stored Budget_Month and
// canonical expense date using immutable Pocket_Identifiers. These indexes are
// additive and coexist with the legacy pocket-string indexes during rollout.
transactionSchema.index({ budgetYear: 1, budgetMonth: 1, pocketId: 1, expenseDate: 1 });
transactionSchema.index({ budgetYear: 1, budgetMonth: 1, 'sourceBreakdowns.pocketId': 1, expenseDate: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
