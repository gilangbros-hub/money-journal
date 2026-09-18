'use strict';

const mongoose = require('mongoose');

// This managed schema starts at version 1; there are no schema-v0 documents
// to remain compatible with (mirrors models/pocketDefinition.js).
const CURRENT_SCHEMA_VERSION = 1;

const STATUSES = ['Active', 'Archived'];

const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 50;

// Count user-visible code points rather than UTF-16 units so multi-unit
// characters are not double-counted against the 1-50 length rule.
const codePointLength = (value) => Array.from(String(value)).length;

const actorField = () => ({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
});

// An Expense_Type_Definition is a household-managed label: an emoji, a name,
// and a lifecycle status. Unlike a Pocket_Definition it carries no cadence or
// default amount, and it is never assigned to a Budget_Month; any Active type
// is selectable on any transaction, in any month.
const expenseTypeDefinitionSchema = new mongoose.Schema({
    // Trimmed display name. Internal user text is preserved; only surrounding
    // whitespace is removed here. Length is measured in code points.
    name: {
        type: String,
        required: true,
        trim: true,
        validate: {
            validator(value) {
                const length = codePointLength(value);
                return length >= NAME_MIN_LENGTH && length <= NAME_MAX_LENGTH;
            },
            message: `name must contain ${NAME_MIN_LENGTH} through ${NAME_MAX_LENGTH} characters after trimming.`
        }
    },
    // Comparison form used by the unique index. The service canonicalizes this
    // value (trim, collapse internal whitespace, lowercase) before persisting.
    normalizedName: {
        type: String,
        required: true,
        trim: true
    },
    // Exactly one user-perceived emoji. Grapheme-aware emoji validation lives
    // in the shared validation service; the model only guarantees presence.
    emoji: {
        type: String,
        required: true,
        trim: true,
        minlength: 1
    },
    status: {
        type: String,
        required: true,
        enum: STATUSES,
        default: 'Active'
    },
    createdBy: actorField(),
    updatedBy: actorField(),
    // A created definition starts at Record_Version 1 and increments exactly
    // once per accepted change.
    version: {
        type: Number,
        required: true,
        default: 1,
        min: 1,
        validate: {
            validator: Number.isInteger,
            message: 'version must be an integer.'
        }
    },
    schemaVersion: {
        type: Number,
        required: true,
        min: 1,
        default: CURRENT_SCHEMA_VERSION,
        validate: {
            validator: Number.isInteger,
            message: 'schemaVersion must be an integer.'
        }
    }
}, {
    collection: 'expensetypedefinitions',
    timestamps: true
});

// Normalized-name uniqueness is enforced across BOTH active and archived
// records so an archived type name cannot be silently reused by a new type.
expenseTypeDefinitionSchema.index({ normalizedName: 1 }, { unique: true });

// Ordered management/selection reads: within a lifecycle partition, order by
// normalized name and then identifier.
expenseTypeDefinitionSchema.index({ status: 1, normalizedName: 1, _id: 1 });

/**
 * Produce a DTO-ready immutable snapshot of the persisted definition.
 */
expenseTypeDefinitionSchema.methods.toDTO = function toDTO() {
    return Object.freeze({
        id: this._id ? this._id.toString() : undefined,
        name: this.name,
        normalizedName: this.normalizedName,
        emoji: this.emoji,
        status: this.status,
        createdBy: this.createdBy ? this.createdBy.toString() : undefined,
        updatedBy: this.updatedBy ? this.updatedBy.toString() : undefined,
        version: this.version,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        schemaVersion: this.schemaVersion
    });
};

expenseTypeDefinitionSchema.statics.CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
expenseTypeDefinitionSchema.statics.STATUSES = STATUSES;
expenseTypeDefinitionSchema.statics.NAME_MIN_LENGTH = NAME_MIN_LENGTH;
expenseTypeDefinitionSchema.statics.NAME_MAX_LENGTH = NAME_MAX_LENGTH;

module.exports = mongoose.model('ExpenseTypeDefinition', expenseTypeDefinitionSchema);
