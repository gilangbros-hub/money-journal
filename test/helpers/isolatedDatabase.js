'use strict';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

/**
 * Lazily-managed replica-set fixture. Creating the helper does not download a
 * MongoDB binary or open a connection; tests opt in by calling start().
 */
function createIsolatedDatabase({
    mongooseInstance = mongoose,
    replSetOptions = {},
    mongoOptions = {}
} = {}) {
    let server = null;
    let started = false;

    const fixture = {
        get server() { return server; },
        get connection() { return mongooseInstance.connection; },
        get uri() { return server?.getUri(); },
        async start() {
            if (started) return fixture;
            const createOptions = {
                replSet: {
                    count: 1,
                    storageEngine: 'wiredTiger',
                    ...replSetOptions
                }
            };
            if (mongoOptions.binary) createOptions.binary = mongoOptions.binary;
            if (mongoOptions.instanceOpts) createOptions.instanceOpts = mongoOptions.instanceOpts;
            server = await MongoMemoryReplSet.create(createOptions);
            await mongooseInstance.connect(server.getUri(), {
                ...(mongoOptions.connection || {})
            });
            started = true;
            return fixture;
        },
        async clear() {
            if (!started || !mongooseInstance.connection.db) return;
            await mongooseInstance.connection.db.dropDatabase();
        },
        async stop() {
            if (mongooseInstance.connection.readyState !== 0) {
                await mongooseInstance.disconnect();
            }
            if (server) await server.stop();
            server = null;
            started = false;
        },
        async run(callback) {
            await fixture.start();
            try {
                return await callback(fixture);
            } finally {
                await fixture.stop();
            }
        }
    };

    return fixture;
}

async function withIsolatedDatabase(callback, options) {
    return createIsolatedDatabase(options).run(callback);
}

module.exports = { createIsolatedDatabase, withIsolatedDatabase };
