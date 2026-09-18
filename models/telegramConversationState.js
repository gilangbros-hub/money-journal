'use strict';

const mongoose = require('mongoose');

// A Vercel serverless function keeps nothing in memory between requests, so
// the bot's multi-step "amount -> type -> pocket -> note -> confirm" flow has
// to persist where each chat is between messages. One document per chat,
// upserted/replaced as the conversation advances; a TTL index sweeps up
// anything abandoned mid-flow so a forgotten conversation doesn't linger.
const STEPS = ['amount', 'type', 'pocket', 'note', 'confirm'];

const telegramConversationStateSchema = new mongoose.Schema({
    chatId: {
        type: String,
        required: true,
        unique: true
    },
    step: {
        type: String,
        required: true,
        enum: STEPS
    },
    // The message id of the bot's own last prompt, so a button tap can edit
    // that message in place (moving the flow forward) instead of spamming a
    // new message per step.
    promptMessageId: {
        type: Number
    },
    draft: {
        amount: Number,
        typeId: String,
        typeName: String,
        pocketId: String,
        pocketName: String,
        note: String,
        expenseDate: String
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Abandoned conversations expire after 30 minutes of inactivity.
telegramConversationStateSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 1800 });

telegramConversationStateSchema.statics.STEPS = STEPS;

module.exports = mongoose.model('TelegramConversationState', telegramConversationStateSchema);
