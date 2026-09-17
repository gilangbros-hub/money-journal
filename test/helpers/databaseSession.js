'use strict';

const mongoose = require('mongoose');

/** Run one callback in a real Mongoose transaction and always end its session. */
async function withDatabaseSession(operation, {
    connection = mongoose.connection,
    transactionOptions
} = {}) {
    if (!connection || typeof connection.startSession !== 'function') {
        throw new TypeError('A Mongoose connection with startSession is required');
    }

    const session = await connection.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await operation(session);
        }, transactionOptions);
        return result;
    } finally {
        await session.endSession();
    }
}

function createDatabaseSessionHelper({ connection = mongoose.connection, transactionOptions } = {}) {
    return {
        connection,
        async start() { return connection.startSession(); },
        async withTransaction(operation, options = {}) {
            return withDatabaseSession(operation, {
                connection,
                transactionOptions: options.transactionOptions || transactionOptions
            });
        },
        async run(operation, options = {}) {
            return this.withTransaction(operation, options);
        }
    };
}

const runInDatabaseSession = withDatabaseSession;

module.exports = {
    createDatabaseSessionHelper,
    runInDatabaseSession,
    withDatabaseSession
};
