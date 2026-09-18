const mongoose = require('mongoose');

/**
 * Connect to MongoDB. This deliberately does NOT catch its own errors or
 * call process.exit(): on a traditional long-running server a crash-and-
 * restart on a bad connection is a reasonable failure mode, but on a
 * serverless platform (Vercel) this same module runs once per cold start,
 * inside the same process that serves every other route. A transient Atlas
 * hiccup — a brief network blip, an IP allow-list edit still propagating, a
 * free-tier cluster waking up from auto-pause — must not take down requests
 * that have nothing to do with the database. The caller decides what a
 * failure means; see app.js, which logs it and lets the process keep
 * serving everything else (Mongoose queues operations and keeps retrying
 * the connection in the background by default).
 */
const connectDB = async () => {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
        throw new Error('MONGODB_URI is not defined in environment variables');
    }
    await mongoose.connect(mongoURI);
    console.log('MongoDB connected successfully');
};

module.exports = connectDB;
