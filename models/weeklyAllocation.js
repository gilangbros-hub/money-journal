const mongoose = require('mongoose');
const { POCKETS } = require('../utils/constants');

const INTEGER_YEAR = {
    type: Number,
    required: true,
    min: 1,
    max: 9999,
    validate: {
        validator: Number.isInteger,
        message: '{PATH} must be an integer'
    }
};

const INTEGER_WEEK_PART = {
    type: Number,
    required: true,
    validate: {
        validator: Number.isInteger,
        message: '{PATH} must be an integer'
    }
};

const weeklyAllocationSchema = new mongoose.Schema({
    pocket: {
        type: String,
        required: true,
        enum: Object.keys(POCKETS)
    },
    // month/year identify the named Budget_Month, not the ISO week.
    month: {
        type: Number,
        required: true,
        min: 1,
        max: 12,
        validate: {
            validator: Number.isInteger,
            message: '{PATH} must be an integer'
        }
    },
    year: INTEGER_YEAR,
    isoWeekYear: INTEGER_YEAR,
    isoWeekNumber: {
        ...INTEGER_WEEK_PART,
        min: 1,
        max: 53
    },
    budget: {
        type: Number,
        required: true,
        min: 0,
        validate: {
            validator: value => Number.isInteger(value) && Number.isFinite(value),
            message: '{PATH} must be a finite integer amount'
        }
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    version: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        validate: {
            validator: Number.isInteger,
            message: '{PATH} must be an integer'
        }
    }
}, {
    collection: 'weeklyallocations',
    timestamps: true
});

// Exactly one weekly allocation exists for each Pocket/Budget_Month/ISO-week key.
weeklyAllocationSchema.index(
    {
        pocket: 1,
        month: 1,
        year: 1,
        isoWeekYear: 1,
        isoWeekNumber: 1
    },
    { unique: true }
);

// Supports period views and pocket filtering; the unique index remains the write guard.
weeklyAllocationSchema.index({ year: 1, month: 1, pocket: 1 });

module.exports = mongoose.model('WeeklyAllocation', weeklyAllocationSchema);
