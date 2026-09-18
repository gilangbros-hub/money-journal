'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const connectDB = require('../../database');

test('connectDB throws (never exits the process) when MONGODB_URI is missing', async () => {
    const original = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    const originalExit = process.exit;
    let exitCalled = false;
    process.exit = () => { exitCalled = true; };

    try {
        await assert.rejects(() => connectDB(), /MONGODB_URI is not defined/);
        assert.equal(exitCalled, false);
    } finally {
        process.exit = originalExit;
        if (original !== undefined) process.env.MONGODB_URI = original;
    }
});

test('connectDB rejects (never exits the process) when the connection itself fails', async () => {
    const original = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/does-not-matter';
    const originalConnect = mongoose.connect;
    mongoose.connect = async () => { throw new Error('MongoServerSelectionError: simulated'); };
    const originalExit = process.exit;
    let exitCalled = false;
    process.exit = () => { exitCalled = true; };

    try {
        await assert.rejects(() => connectDB(), /simulated/);
        assert.equal(exitCalled, false);
    } finally {
        mongoose.connect = originalConnect;
        process.exit = originalExit;
        if (original !== undefined) process.env.MONGODB_URI = original;
        else delete process.env.MONGODB_URI;
    }
});
