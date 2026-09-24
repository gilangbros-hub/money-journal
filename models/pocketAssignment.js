'use strict';

const mongoose = require('mongoose');

// New aggregate root; there is no legacy assignment document, so the schema
// begins at version 1.
const CURRENT_SCHEMA_VERSION = 1;

// Requirement range for every rupiah amount: a non-negative whole number from
// 0 through 999,999,999,999 inclusive.
const MAX_RUPIAH = 999999999999;

const CADENCES = ['Monthly', 'Weekly'];
const AMOUNT_MODES = ['Use_Default', 'Customize'];

const MONTHLY_KEY = 'monthly';
// Canonical ISO week key, e.g. 2027-W05.
const WEEKLY_KEY_PATTERN = /^\d{4}-W\d{2}$/;

const isRupiahAmount = (value) => (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_RUPIAH
);

const integerField = (message) => ({
    validator: Number.isInteger,
    message
});

const actorField = () => ({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
});

/**
 * One embedded allocation entry. Embedding keeps an assignment and its complete
 * allocation set in a single atomic document, so a partially replaced weekly
 * set can never be observed.
 */
const allocationSchema = new mongoose.Schema({
    kind: {
        type: String,
        required: true,
        enum: CADENCES
    },
    // Literal `monthly` for a Monthly allocation, or a canonical `YYYY-Www` ISO
    // week identifier for a Weekly allocation.
    key: {
        type: String,
        required: true,
        trim: true,
        validate: {
            validator(value) {
                return value === MONTHLY_KEY || WEEKLY_KEY_PATTERN.test(value);
            },
            message: 'allocation key must be "monthly" or a canonical YYYY-Www ISO week.'
        }
    },
    // Only present (and required) for a Weekly allocation; derived from the key.
    isoWeekYear: {
        type: Number,
        min: 1,
        max: 9999,
        validate: integerField('isoWeekYear must be an integer.')
    },
    isoWeekNumber: {
        type: Number,
        min: 1,
        max: 53,
        validate: integerField('isoWeekNumber must be an integer.')
    },
    amount: {
        type: Number,
        required: true,
        validate: {
            validator: isRupiahAmount,
            message: 'allocation amount must be a whole number from 0 through 999,999,999,999.'
        }
    }
}, { _id: false });

// Per-entry structural rule, enforced synchronously so it also holds under
// validateSync(): a Monthly allocation uses the `monthly` key and no ISO week
// parts; a Weekly allocation uses a `YYYY-Www` key with both ISO week parts.
const isMonthlyEntryValid = (allocation) => (
    allocation.kind === 'Monthly' &&
    allocation.key === MONTHLY_KEY &&
    allocation.isoWeekYear === undefined &&
    allocation.isoWeekNumber === undefined
);

const isWeeklyEntryValid = (allocation) => (
    allocation.kind === 'Weekly' &&
    WEEKLY_KEY_PATTERN.test(allocation.key || '') &&
    Number.isInteger(allocation.isoWeekYear) &&
    Number.isInteger(allocation.isoWeekNumber)
);

/**
 * Resolve the cadence the allocation set is checked against. On document
 * validation `context` is the document. Under update validators (the
 * findOneAndUpdate path used when an existing assignment is re-confirmed)
 * `context` is the Query, so the cadence comes from the same update. An
 * allocations-only update falls back to the first entry's kind, which still
 * forces the set to be internally consistent.
 */
const cadenceFor = (context, allocations) => {
    if (context instanceof mongoose.Query) {
        const update = context.getUpdate() || {};
        const set = update.$set || {};
        return set.cadenceSnapshot ?? update.cadenceSnapshot ?? allocations[0]?.kind;
    }
    return context.cadenceSnapshot;
};

/**
 * Validate the complete embedded allocation set against the assignment cadence.
 *
 * Monthly cadence requires exactly one well-formed `monthly` allocation. Weekly
 * cadence requires at least one well-formed Weekly allocation with unique keys.
 * This guarantees the persisted document is a complete, canonical plan rather
 * than a partial, mismatched, or duplicated set. The check is synchronous so it
 * runs under both validate() and validateSync().
 */
const validateAllocationSet = function validateAllocationSet(allocations) {
    if (!Array.isArray(allocations) || allocations.length === 0) {
        return false;
    }

    const cadence = cadenceFor(this, allocations);

    // Every allocation kind must match the assignment cadence snapshot.
    if (!allocations.every(allocation => allocation && allocation.kind === cadence)) {
        return false;
    }

    if (cadence === 'Monthly') {
        return allocations.length === 1 && isMonthlyEntryValid(allocations[0]);
    }

    if (cadence === 'Weekly') {
        if (!allocations.every(isWeeklyEntryValid)) {
            return false;
        }
        // Reject duplicate ISO week keys within one assignment.
        const keys = allocations.map(allocation => allocation.key);
        return new Set(keys).size === keys.length;
    }

    return false;
};

const pocketAssignmentSchema = new mongoose.Schema({
    // Immutable identity link to exactly one Pocket_Definition.
    pocketId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PocketDefinition',
        required: true
    },
    // month/year identify exactly one named Budget_Month.
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
        min: 1,
        max: 9999,
        validate: integerField('budgetYear must be an integer.')
    },
    // Snapshots of the definition at confirmation/migration time; later
    // definition edits never rewrite these values.
    pocketNameSnapshot: {
        type: String,
        required: true,
        trim: true
    },
    pocketNormalizedNameSnapshot: {
        type: String,
        required: true,
        trim: true
    },
    pocketEmojiSnapshot: {
        type: String,
        required: true,
        trim: true
    },
    cadenceSnapshot: {
        type: String,
        required: true,
        enum: CADENCES
    },
    amountMode: {
        type: String,
        required: true,
        enum: AMOUNT_MODES
    },
    // The definition version used to form the snapshot above.
    definitionVersion: {
        type: Number,
        required: true,
        min: 1,
        validate: integerField('definitionVersion must be an integer.')
    },
    allocations: {
        type: [allocationSchema],
        required: true,
        validate: {
            validator: validateAllocationSet,
            message: 'allocations must be a complete canonical set for the assignment cadence.'
        }
    },
    createdBy: actorField(),
    updatedBy: actorField(),
    // A created assignment starts at Record_Version 1 and increments exactly
    // once per changed mode/allocation state.
    version: {
        type: Number,
        required: true,
        default: 1,
        min: 1,
        validate: integerField('version must be an integer.')
    },
    schemaVersion: {
        type: Number,
        required: true,
        min: 1,
        default: CURRENT_SCHEMA_VERSION,
        validate: integerField('schemaVersion must be an integer.')
    }
}, {
    collection: 'pocketassignments',
    timestamps: true
});

// Exactly one assignment exists for each pocket and named Budget_Month. This is
// the database-level arbiter for concurrent assignment creation.
pocketAssignmentSchema.index(
    { pocketId: 1, budgetYear: 1, budgetMonth: 1 },
    { unique: true }
);

// Ordered month views: order by normalized snapshot name then pocket id within
// a Budget_Month.
pocketAssignmentSchema.index({ budgetYear: 1, budgetMonth: 1, pocketNormalizedNameSnapshot: 1, pocketId: 1 });

// Supports versioned diagnostics/read plans; the unique index remains the write
// guard.
pocketAssignmentSchema.index({ pocketId: 1, budgetYear: 1, budgetMonth: 1, version: 1 });

// Sort allocations by canonical key so equality comparison and persisted order
// are deterministic. `monthly` sorts before any weekly key by natural ordering.
const sortAllocationsByKey = (allocations) => (
    [...allocations].sort((left, right) => {
        if (left.key < right.key) return -1;
        if (left.key > right.key) return 1;
        return 0;
    })
);

/**
 * Sum of every embedded allocation amount for this assignment. Each allocation
 * is counted exactly once.
 */
pocketAssignmentSchema.methods.allocationTotal = function allocationTotal() {
    return (this.allocations || []).reduce((total, allocation) => total + allocation.amount, 0);
};

/**
 * Produce a DTO-ready immutable snapshot of the persisted assignment.
 *
 * ObjectIds become strings, the named Budget_Month is exposed both numerically
 * and as a `YYYY-MM` key, allocations are sorted by canonical key, and the
 * whole structure is frozen so a shared reference cannot be mutated.
 */
pocketAssignmentSchema.methods.toDTO = function toDTO() {
    const monthKey = `${String(this.budgetYear).padStart(4, '0')}-${String(this.budgetMonth).padStart(2, '0')}`;
    const allocations = sortAllocationsByKey(this.allocations || []).map(allocation => Object.freeze({
        kind: allocation.kind,
        key: allocation.key,
        isoWeekYear: allocation.isoWeekYear,
        isoWeekNumber: allocation.isoWeekNumber,
        amount: allocation.amount
    }));

    return Object.freeze({
        id: this._id ? this._id.toString() : undefined,
        pocketId: this.pocketId ? this.pocketId.toString() : undefined,
        budgetMonth: this.budgetMonth,
        budgetYear: this.budgetYear,
        budgetMonthKey: monthKey,
        pocketName: this.pocketNameSnapshot,
        pocketNormalizedName: this.pocketNormalizedNameSnapshot,
        pocketEmoji: this.pocketEmojiSnapshot,
        cadence: this.cadenceSnapshot,
        amountMode: this.amountMode,
        definitionVersion: this.definitionVersion,
        allocations: Object.freeze(allocations),
        allocationTotal: allocations.reduce((total, allocation) => total + allocation.amount, 0),
        createdBy: this.createdBy ? this.createdBy.toString() : undefined,
        updatedBy: this.updatedBy ? this.updatedBy.toString() : undefined,
        version: this.version,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        schemaVersion: this.schemaVersion
    });
};

pocketAssignmentSchema.statics.CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
pocketAssignmentSchema.statics.MAX_RUPIAH = MAX_RUPIAH;
pocketAssignmentSchema.statics.CADENCES = CADENCES;
pocketAssignmentSchema.statics.AMOUNT_MODES = AMOUNT_MODES;
pocketAssignmentSchema.statics.MONTHLY_KEY = MONTHLY_KEY;
pocketAssignmentSchema.statics.WEEKLY_KEY_PATTERN = WEEKLY_KEY_PATTERN;
pocketAssignmentSchema.statics.sortAllocationsByKey = sortAllocationsByKey;

module.exports = mongoose.model('PocketAssignment', pocketAssignmentSchema);
