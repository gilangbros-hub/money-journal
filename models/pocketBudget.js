'use strict';

const mongoose = require('mongoose');
const { POCKETS } = require('../utils/constants');

const CURRENT_SCHEMA_VERSION = 2;

const pocketBudgetSchema = new mongoose.Schema({
    pocket: {
        type: String,
        required: true,
        enum: Object.keys(POCKETS)
    },
    month: {
        type: Number,
        required: true,
        min: 1,
        max: 12
    },
    year: {
        type: Number,
        required: true
    },
    budget: {
        type: Number,
        required: true,
        min: 0
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // Optional so schema-v1 records remain readable during the additive rollout.
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // Legacy documents are treated as version zero until their first accepted write.
    version: {
        type: Number,
        min: 0,
        default: 0
    },
    schemaVersion: {
        type: Number,
        min: 1,
        default: CURRENT_SCHEMA_VERSION
    }
}, {
    timestamps: true
});

// Unique constraint: one budget per pocket per month/year
pocketBudgetSchema.index({ pocket: 1, month: 1, year: 1 }, { unique: true });

/**
 * Build the complete atomic update used by an accepted monthly-allocation write.
 *
 * Keeping the amount, updater, schema version, and version increment in one
 * update prevents a caller from persisting an amount without its corresponding
 * audit metadata. The helper deliberately uses findOneAndUpdate so existing
 * _id, createdBy, and timestamps remain intact; `$setOnInsert` only supplies
 * creation data for a new composite key.
 */
pocketBudgetSchema.statics.upsertAccepted = function upsertAccepted({
    pocket,
    month,
    year,
    budget,
    updatedBy,
    createdBy
}, options = {}) {
    const filter = { pocket, month, year };
    const update = {
        $set: {
            budget,
            updatedBy,
            schemaVersion: CURRENT_SCHEMA_VERSION
        },
        $inc: {
            version: 1
        }
    };

    if (options.upsert !== false) {
        update.$setOnInsert = {
            createdBy: createdBy || updatedBy
        };
    }

    return this.findOneAndUpdate(filter, update, {
        ...options,
        new: true,
        upsert: options.upsert !== false,
        runValidators: true,
        setDefaultsOnInsert: true
    });
};

pocketBudgetSchema.statics.CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

module.exports = mongoose.model('PocketBudget', pocketBudgetSchema);
