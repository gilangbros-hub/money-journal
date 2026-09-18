const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    avatar: {
        type: String,
        default: '👤'
    },
    role: {
        type: String,
        enum: ['Husband', 'Wife', 'Self'],
        default: 'Self'
    },
    isActive: {
        type: Boolean,
        default: false
    },
    // Telegram bot linking. `telegramChatId` is the durable link once
    // established (unique across accounts, sparse so unlinked users don't
    // collide on `null`); `telegramLinkCode`/`telegramLinkCodeExpiresAt` are
    // a short-lived, single-use pairing code generated from the Profile page
    // and consumed by the bot's `/link` command.
    telegramChatId: {
        type: String,
        unique: true,
        sparse: true
    },
    telegramLinkCode: {
        type: String
    },
    telegramLinkCodeExpiresAt: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Hash password before saving - NO next() needed in Mongoose 6+
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 10);
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
