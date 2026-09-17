'use strict';

/**
 * In-memory notification sink. It records immutable event snapshots and can
 * optionally fail sends to verify that notification errors do not roll back a
 * committed financial operation.
 */
function createNotificationQueue({ failure = null } = {}) {
    const events = [];
    let failureValue = failure;

    function maybeFail(event) {
        if (typeof failureValue === 'function') throw failureValue(event);
        if (failureValue) throw (failureValue instanceof Error
            ? failureValue
            : new Error(String(failureValue)));
    }

    const queue = {
        async enqueue(event) {
            const snapshot = Object.freeze({ ...event });
            maybeFail(snapshot);
            events.push(snapshot);
            return snapshot;
        },
        async notify(event) { return this.enqueue(event); },
        async send(event) { return this.enqueue(event); },
        list() { return events.slice(); },
        get events() { return events.slice(); },
        clear() { events.length = 0; },
        setFailure(nextFailure) { failureValue = nextFailure; },
        resetFailure() { failureValue = null; }
    };
    return queue;
}

const createNotificationSpy = createNotificationQueue;

module.exports = { createNotificationQueue, createNotificationSpy };
