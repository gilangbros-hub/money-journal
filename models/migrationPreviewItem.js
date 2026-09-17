'use strict';

const mongoose = require('mongoose');

// Collections a preview item may target. The first five are the legacy source
// collections read by every migration transform. `pocketdefinitions` and
// `pocketassignments` are the managed target collections the pocket-management
// transform creates; a single immutable preview may therefore mix legacy
// source records and managed target documents.
const SOURCE_COLLECTIONS = [
    'pocketbudgets',
    'pocketbudgetcadences',
    'weeklyallocations',
    'transactions',
    'closedmonths',
    'pocketdefinitions',
    'pocketassignments'
];

const isExtendedJsonDocument = value => (
    value !== undefined &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
);

const migrationPreviewItemSchema = new mongoose.Schema({
    previewId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MigrationPreview',
        required: true,
        immutable: true
    },
    // Sequence is the canonical execution order. It is one-based so a missing
    // sequence is never confused with a valid first item.
    sequence: {
        type: Number,
        required: true,
        min: 1,
        immutable: true,
        validate: {
            validator: Number.isInteger,
            message: 'sequence must be an integer'
        }
    },
    collectionName: {
        type: String,
        required: true,
        enum: SOURCE_COLLECTIONS,
        immutable: true
    },
    recordId: {
        type: String,
        required: true,
        trim: true,
        immutable: true
    },
    changeType: {
        type: String,
        required: true,
        trim: true,
        immutable: true
    },
    // Mixed is intentional: BSON dates, ObjectIds, and numeric values are
    // represented by their caller-provided canonical Extended JSON and must
    // not be cast or reordered by Mongoose.
    before: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        immutable: true,
        validate: {
            validator: isExtendedJsonDocument,
            message: 'before must be an Extended JSON document'
        }
    },
    after: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        immutable: true,
        validate: {
            validator: isExtendedJsonDocument,
            message: 'after must be an Extended JSON document'
        }
    },
    executable: {
        type: Boolean,
        required: true,
        default: false,
        immutable: true
    },
    blockingReason: {
        type: String,
        trim: true,
        immutable: true
    },
    sourceRecordFingerprint: {
        type: String,
        required: true,
        trim: true,
        immutable: true
    },
    // Safe, sanitized source pocket value for a managed (pocket-management)
    // preview item. It lets an operator recognize which legacy pocket a blocked
    // or migrated record belongs to without exposing amounts, notes, or other
    // financial detail. Optional because legacy salary-cycle items never set it.
    sourcePocket: {
        type: String,
        trim: true,
        immutable: true
    }
}, {
    collection: 'migrationpreviewitems',
    timestamps: true
});

// Prevent the same source record/change from being represented twice in one
// immutable preview. Sequence remains the stable order used by execution,
// verification, and reverse-order rollback.
migrationPreviewItemSchema.index(
    { previewId: 1, collectionName: 1, recordId: 1, changeType: 1 },
    { unique: true }
);
migrationPreviewItemSchema.index({ previewId: 1, executable: 1, sequence: 1 });

migrationPreviewItemSchema.statics.SOURCE_COLLECTIONS = SOURCE_COLLECTIONS;

module.exports = mongoose.model('MigrationPreviewItem', migrationPreviewItemSchema);
