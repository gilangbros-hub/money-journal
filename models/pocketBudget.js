const mongoose = require('mongoose');
const { POCKETS } = require('../utils/constants');

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
    }
}, {
    timestamps: true
});

// Unique constraint: one budget per pocket per month/year
pocketBudgetSchema.index({ pocket: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('PocketBudget', pocketBudgetSchema);
