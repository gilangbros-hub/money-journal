const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    type: {
        type: String,
        required: true,
        enum: ['rumah', 'kerja', 'pacaran', 'personal']
    },
    ngapain: {              // Add this field
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
