'use strict';

const mongoose = require('mongoose');

const CURRENT_SCHEMA_VERSION = 2;

const integerField = (message) => ({
    validator: Number.isInteger,
    message
});

const closedMonthSchema = new mongoose.Schema({
    month: {
        type: Number,
        required: true,
        min: 1,
        max: 12,
        validate: integerField('month must be an integer.')
    },
    year: {
        type: Number,
        required: true,
        validate: integerField('year must be an integer.')
    },
    // Retained for legacy close identity/audit compatibility. It is optional
    // for an open guard created before the first close.
    closedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // The old model represented only closed months, so the default remains
    // true for direct legacy creates. Open guards are created explicitly with
    // isClosed: false by the future budget service.
    isClosed: {
        type: Boolean,
        required: true,
        default: true
    },
    closedAt: {
        type: Date,
        default: null
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // This is the optimistic fence shared by protected period mutations.
    mutationSequence: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
        validate: integerField('mutationSequence must be an integer.')
    },
    schemaVersion: {
        type: Number,
        required: true,
        min: 1,
        default: CURRENT_SCHEMA_VERSION,
        validate: integerField('schemaVersion must be an integer.')
    }
}, {
    timestamps: true
});

// Unique constraint: one persistent guard per named Budget_Month.
closedMonthSchema.index({ month: 1, year: 1 }, { unique: true });

function guardKey({ month, year }) {
    return { month, year };
}

function stateUpdate({ actor, isClosed, closedAt }) {
    const set = {
        isClosed,
        closedAt,
        updatedBy: actor,
        schemaVersion: CURRENT_SCHEMA_VERSION
    };

    // Reopening intentionally does not touch closedBy: it is historical close
    // identity, not the actor who last changed the guard state.
    if (isClosed) set.closedBy = actor;

    return {
        $set: set,
        $inc: { mutationSequence: 1 }
    };
}

/**
 * Create an open BudgetPeriod guard if it does not exist yet.
 *
 * This is deliberately an upsert rather than a delete/recreate cycle, so a
 * previously closed guard keeps its identity and audit history. Existing
 * guards are not reopened by this helper; callers must use reopenPeriod.
 */
closedMonthSchema.statics.ensureOpen = function ensureOpen({ month, year, actor } = {}, options = {}) {
    return this.findOneAndUpdate(
        guardKey({ month, year }),
        {
            $setOnInsert: {
                isClosed: false,
                closedAt: null,
                updatedBy: actor,
                mutationSequence: 0,
                schemaVersion: CURRENT_SCHEMA_VERSION
            }
        },
        {
            ...options,
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true
        }
    );
};

/**
 * Close a period in place. Upsert is retained for compatibility with the old
 * marker-create flow, while all close state and audit fields are one update.
 */
closedMonthSchema.statics.closePeriod = function closePeriod({ month, year, actor, closedAt = new Date() } = {}, options = {}) {
    return this.findOneAndUpdate(
        guardKey({ month, year }),
        stateUpdate({ actor, isClosed: true, closedAt }),
        {
            ...options,
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true
        }
    );
};

/**
 * Reopen a period in place. In particular, this never calls deleteOne, so the
 * guard _id, closedBy, createdAt, and updatedAt history remain available.
 */
closedMonthSchema.statics.reopenPeriod = function reopenPeriod({ month, year, actor } = {}, options = {}) {
    return this.findOneAndUpdate(
        guardKey({ month, year }),
        stateUpdate({ actor, isClosed: false, closedAt: null }),
        {
            ...options,
            new: true,
            upsert: false,
            runValidators: true
        }
    );
};

closedMonthSchema.statics.transitionPeriod = function transitionPeriod({
    month,
    year,
    actor,
    isClosed,
    expectedClosed,
    closedAt = isClosed ? new Date() : null
} = {}, options = {}) {
    const filter = guardKey({ month, year });
    if (typeof expectedClosed === 'boolean') filter.isClosed = expectedClosed;
    const set = {
        isClosed: Boolean(isClosed),
        closedAt,
        updatedBy: actor,
        schemaVersion: CURRENT_SCHEMA_VERSION
    };
    if (isClosed) set.closedBy = actor;

    return this.findOneAndUpdate(
        filter,
        {
            $set: set,
            $inc: { mutationSequence: 1 }
        },
        {
            ...options,
            new: true,
            upsert: isClosed === true && expectedClosed === undefined,
            runValidators: true,
            setDefaultsOnInsert: true
        }
    );
};

closedMonthSchema.statics.CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

module.exports = mongoose.model('ClosedMonth', closedMonthSchema);
