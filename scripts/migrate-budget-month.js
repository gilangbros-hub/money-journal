/**
 * Migration: Set budgetMonth/budgetYear for all existing transactions
 * Sets all existing transactions to March 2026 as confirmed by the user.
 * 
 * Run: node scripts/migrate-budget-month.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function migrate() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI not set in .env');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('transactions');

    // Update all transactions that don't have budgetMonth/budgetYear
    const result = await collection.updateMany(
        {
            $or: [
                { budgetMonth: { $exists: false } },
                { budgetYear: { $exists: false } }
            ]
        },
        {
            $set: {
                budgetMonth: 3,   // March
                budgetYear: 2026
            }
        }
    );

    console.log(`Migration complete: ${result.modifiedCount} transactions updated to budgetMonth=3, budgetYear=2026`);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
