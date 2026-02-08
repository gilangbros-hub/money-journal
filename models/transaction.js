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
        enum: [
            'Eat', 'Snack', 'Groceries', 'Laundry', 'Bensin', 'Flazz', 
            'Home Appliance', 'Jumat Berkah', 'Uang Sampah', 'Uang Keamanan', 
            'Medicine', 'Others'
        ]
    },
    pocket: {
        type: String,
        required: true,
        enum: [
            'Kwintals', 'Groceries', 'Weekday Transport', 'Weekend Transport', 
            'Investasi', 'Dana Darurat', 'IPL'
        ]
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
