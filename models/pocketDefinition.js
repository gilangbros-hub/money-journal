'use strict';

const mongoose = require('mongoose');

// This managed schema starts at version 1; unlike the legacy allocation
// collections there are no schema-v0 documents to remain compatible with.
const CURRENT_SCHEMA_VERSION = 1;

// Requirement range for every rupiah amount: a non-negative whole number from
// 0 through 999,999,999,999 inclusive.
const MAX_RUPIAH = 999999999999;

const CADENCES = ['Monthly', 'Weekly'];
const STATUSES = ['Active', 'Archived'];

const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 50;

// Count user-visible code points rather than UTF-16 units so multi-unit
// characters are not double-counted against the 1-50 length rule.
const codePointLength = (value) => Array.from(String(value)).length;

const isRupiahAmount = (value) => (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_RUPIAH
);

const rupiahField = (message) => ({
    type: Number,
    required: true,
    validate: {
        validator: isRupiahAmount,
        message
    }
});

const actorField = () => ({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
});

const pocketDefinitionSchema = new mongoose.Schema({
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
    // Exactly one user-perceived emoji. Grapheme-aware emoji validation lives in
    // the shared pocket validation service; the model only guarantees presence.
    emoji: {
        type: String,
        required: true,
        trim: true,
        minlength: 1
    },
    cadence: {
        type: String,
        required: true,
        enum: CADENCES
    },
    defaultAmount: rupiahField('defaultAmount must be a whole number from 0 through 999,999,999,999.'),
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
    collection: 'pocketdefinitions',
    timestamps: true
});

// Normalized-name uniqueness is enforced across BOTH active and archived
// records so an archived pocket name cannot be silently reused by a new pocket.
pocketDefinitionSchema.index({ normalizedName: 1 }, { unique: true });

// Ordered management/selection reads: within a lifecycle partition, order by
// normalized name and then identifier.
pocketDefinitionSchema.index({ status: 1, normalizedName: 1, _id: 1 });

/**
 * Produce a DTO-ready immutable snapshot of the persisted definition.
 *
 * ObjectIds become strings, audit identities and timestamps are included, and
 * the result is frozen so callers cannot mutate a shared reference. This is the
 * canonical response shape returned to authorized household reads.
 */
pocketDefinitionSchema.methods.toDTO = function toDTO() {
    return Object.freeze({
        id: this._id ? this._id.toString() : undefined,
        name: this.name,
        normalizedName: this.normalizedName,
        emoji: this.emoji,
        cadence: this.cadence,
        defaultAmount: this.defaultAmount,
        status: this.status,
        createdBy: this.createdBy ? this.createdBy.toString() : undefined,
        updatedBy: this.updatedBy ? this.updatedBy.toString() : undefined,
        version: this.version,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        schemaVersion: this.schemaVersion
    });
};

pocketDefinitionSchema.statics.CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
pocketDefinitionSchema.statics.MAX_RUPIAH = MAX_RUPIAH;
pocketDefinitionSchema.statics.CADENCES = CADENCES;
pocketDefinitionSchema.statics.STATUSES = STATUSES;
pocketDefinitionSchema.statics.NAME_MIN_LENGTH = NAME_MIN_LENGTH;
pocketDefinitionSchema.statics.NAME_MAX_LENGTH = NAME_MAX_LENGTH;

module.exports = mongoose.model('PocketDefinition', pocketDefinitionSchema);
