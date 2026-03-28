const mongoose = require('mongoose');

const closedMonthSchema = new mongoose.Schema({
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
    closedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// Unique constraint: one entry per month/year
closedMonthSchema.index({ month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('ClosedMonth', closedMonthSchema);
