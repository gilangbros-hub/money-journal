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

const pocketBudgetCadenceSchema = new mongoose.Schema({
    pocket: {
        type: String,
        required: true,
        enum: Object.keys(POCKETS)
    },
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
    cadence: {
        type: String,
        required: true,
        enum: ['Monthly', 'Weekly']
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
    collection: 'pocketbudgetcadences',
    timestamps: true
});

// Exactly one cadence is stored for each Pocket and named Budget_Month.
pocketBudgetCadenceSchema.index(
    { pocket: 1, month: 1, year: 1 },
    { unique: true }
);

// Supports period views without changing the legacy monthly budget collection.
pocketBudgetCadenceSchema.index({ year: 1, month: 1, pocket: 1 });

module.exports = mongoose.model('PocketBudgetCadence', pocketBudgetCadenceSchema);
