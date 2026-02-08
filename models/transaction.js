const mongoose = require('mongoose');

const { TRANSACTION_TYPES, POCKETS } = require('../utils/constants');

const transactionSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    type: {
        type: String,
        required: true,
        enum: Object.keys(TRANSACTION_TYPES)
    },
    pocket: {
        type: String,
        required: true,
        enum: Object.keys(POCKETS)
    },
    ngapain: {              // Notes
        type: String,
        required: true,
        trim: true
    },
    by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Transaction', transactionSchema);
