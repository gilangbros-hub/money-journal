'use strict';

const mongoose = require('mongoose');

const PREVIEW_STATUSES = [
    'Draft',
    'Blocked',
    'Approved',
    'Executing',
    'Applied',
    'Stale',
    'RolledBack'
];

const nonNegativeInteger = (path) => ({
    type: Number,
    required: true,
    default: 0,
    min: 0,
    immutable: true,
    validate: {
        validator: Number.isInteger,
        message: `${path} must be a non-negative integer`
    }
});

const countSchema = new mongoose.Schema({
    scanned: nonNegativeInteger('counts.scanned'),
    unchanged: nonNegativeInteger('counts.unchanged'),
    proposed: nonNegativeInteger('counts.proposed'),
    invalid: nonNegativeInteger('counts.invalid'),
    duplicateAllocationKeys: nonNegativeInteger('counts.duplicateAllocationKeys'),
    unresolvableConflicts: nonNegativeInteger('counts.unresolvableConflicts'),
    // Change types are deliberately Mixed: adding a migration transform must
    // not require changing this header schema. The migration command owns the
    // canonical type names and writes a deterministic object here.
    byChangeType: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
        immutable: true,
        validate: {
            validator: value => value !== null && typeof value === 'object' && !Array.isArray(value),
            message: 'counts.byChangeType must be an object'
        }
    }
}, { _id: false, strict: true });

const actorField = (required = false) => ({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required,
    immutable: true
});

const migrationPreviewSchema = new mongoose.Schema({
    // These fields identify the transform and its exact source snapshot. They
    // cannot change after the preview is generated.
    migrationVersion: {
        type: String,
        required: true,
        trim: true,
        immutable: true
    },
    timeZone: {
        type: String,
        required: true,
        trim: true,
        immutable: true,
        validate: {
            validator(value) {
                try {
                    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
                    return true;
                } catch {
                    return false;
                }
            },
            message: 'timeZone must be a recognized IANA time zone'
        }
    },
    status: {
        type: String,
        required: true,
        enum: PREVIEW_STATUSES,
        default: 'Draft'
    },
    historicalReassignmentApproved: {
        type: Boolean,
        required: true,
        default: false
    },
    sourceFingerprint: {
        type: String,
        required: true,
        trim: true,
        immutable: true
    },
    counts: {
        type: countSchema,
        required: true,
        immutable: true
    },
    createdBy: actorField(true),
    approvedBy: actorField(),
    approvedAt: {
        type: Date,
        immutable: true
    },
    executedBy: actorField(),
    executionStartedAt: {
        type: Date,
        immutable: true
    },
    executedAt: {
        type: Date,
        immutable: true
    },
    appliedFingerprint: {
        type: String,
        trim: true,
        immutable: true
    },
    rolledBackBy: actorField(),
    rolledBackAt: {
        type: Date,
        immutable: true
    },
    // Rollback is a separately approved operation. These fields intentionally
    // remain on the immutable preview header so execution cannot be triggered
    // by merely observing an Applied status.
    rollbackApprovedBy: actorField(),
    rollbackApprovedAt: {
        type: Date,
        immutable: true
    },
    executionError: {
        type: String,
        trim: true,
        immutable: true
    },
    // Verification is a required lifecycle gate between an Applied/RolledBack
    // migration and enabling the feature flag. These fields record the most
    // recent verification outcome on the header so an operator (and the rollout
    // tooling) can gate activation without re-running verification. They are
    // intentionally mutable because verification may run repeatedly. The stored
    // result is a compact machine-readable summary only: it never contains
    // record values, names, emoji, amounts, or other financial detail.
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    verifiedAt: {
        type: Date
    },
    verification: {
        type: mongoose.Schema.Types.Mixed,
        validate: {
            validator: value => value === undefined || value === null ||
                (typeof value === 'object' && !Array.isArray(value)),
            message: 'verification must be an object summary'
        }
    }
}, {
    collection: 'migrationpreviews',
    timestamps: true
});

// A header lookup is used to find a preview that can be approved/executed;
// updatedAt makes the operator list deterministic without making fingerprints
// unique (the same source can intentionally be previewed again after rollback).
migrationPreviewSchema.index({ status: 1, sourceFingerprint: 1, updatedAt: -1 });
migrationPreviewSchema.index({ createdBy: 1, createdAt: -1 });

migrationPreviewSchema.statics.PREVIEW_STATUSES = PREVIEW_STATUSES;

module.exports = mongoose.model('MigrationPreview', migrationPreviewSchema);
