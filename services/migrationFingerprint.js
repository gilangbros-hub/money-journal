'use strict';

const crypto = require('node:crypto');
const { validateTimeZone } = require('./salaryCycleResolver');

/**
 * Convert values to a small, deterministic Extended-JSON-like representation.
 * Dates and ObjectIds are represented explicitly so a host's locale or object
 * key insertion order can never change a migration fingerprint or snapshot.
 */
function toCanonical(value, seen = new Set()) {
    if (value === null) return null;
    if (value === undefined) return { $undefined: true };
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return { $numberDouble: 'NaN' };
        if (value === Infinity) return { $numberDouble: 'Infinity' };
        if (value === -Infinity) return { $numberDouble: '-Infinity' };
        if (Object.is(value, -0)) return { $numberDouble: '-0.0' };
        return value;
    }
    if (typeof value === 'bigint') return { $numberLong: value.toString() };
    if (typeof value === 'function' || typeof value === 'symbol') {
        throw new TypeError('Unsupported value in canonical migration data.');
    }
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new TypeError('Invalid Date in migration data.');
        return { $date: value.toISOString() };
    }
    if (Buffer.isBuffer(value)) {
        return { $binary: { base64: value.toString('base64'), subType: '00' } };
    }
    if (typeof value.toHexString === 'function' && typeof value.toString === 'function') {
        return { $oid: value.toHexString() };
    }
    if (seen.has(value)) throw new TypeError('Circular migration data cannot be canonicalized.');
    seen.add(value);
    try {
        if (Array.isArray(value)) return value.map(item => toCanonical(item, seen));
        const output = {};
        for (const key of Object.keys(value).sort()) output[key] = toCanonical(value[key], seen);
        return output;
    } finally {
        seen.delete(value);
    }
}

function canonicalStringify(value) {
    return JSON.stringify(toCanonical(value));
}

function hashCanonical(value) {
    return `sha256:${crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

function recordId(record, fallback = 'unknown') {
    if (record && record._id !== undefined && record._id !== null) {
        if (typeof record._id.toHexString === 'function') return record._id.toHexString();
        return String(record._id);
    }
    return fallback;
}

function normalizeSourceRecords(input = {}) {
    if (Array.isArray(input)) {
        return input.map((entry, index) => ({
            collectionName: entry.collectionName || entry.collection || 'unknown',
            record: entry.record || entry,
            index
        }));
    }

    const aliases = {
        pocketbudgets: ['pocketbudgets', 'pocketBudgets', 'budgets'],
        pocketbudgetcadences: ['pocketbudgetcadences', 'pocketBudgetCadences', 'cadences'],
        weeklyallocations: ['weeklyallocations', 'weeklyAllocations'],
        transactions: ['transactions'],
        closedmonths: ['closedmonths', 'closedMonths', 'budgetPeriods']
    };
    const records = [];
    for (const collectionName of Object.keys(aliases)) {
        const key = aliases[collectionName].find(candidate => Array.isArray(input[candidate]));
        for (const [index, record] of (key ? input[key] : []).entries()) {
            records.push({ collectionName, record, index });
        }
    }
    return records;
}

function sourceRecordFingerprint(record, collectionName = 'unknown') {
    return hashCanonical({
        collectionName,
        recordId: recordId(record),
        snapshot: toCanonical(record)
    });
}

/**
 * Fingerprint source identity, version, and content. updatedAt is retained as
 * an optimistic-staleness signal, while the content hash closes the gap where
 * an out-of-band write changes data without advancing a timestamp. Zone and
 * migration version are part of the hash by design.
 */
function createSourceFingerprint({
    records,
    sources,
    timeZone = 'Asia/Jakarta',
    migrationVersion = 'salary-cycle-v1'
} = {}) {
    const normalizedTimeZone = validateTimeZone(timeZone);
    if (typeof migrationVersion !== 'string' || migrationVersion.trim() === '') {
        throw new TypeError('migrationVersion must be a non-empty string.');
    }
    const entries = normalizeSourceRecords(records || sources || []).map(({ collectionName, record, index }) => {
        const updatedAt = record && record.updatedAt !== undefined
            ? toCanonical(record.updatedAt)
            : undefined;
        return {
            collectionName,
            recordId: recordId(record, `index:${index}`),
            version: {
                updatedAt,
                contentHash: sourceRecordFingerprint(record, collectionName)
            }
        };
    }).sort((left, right) => {
        const leftKey = canonicalStringify(left);
        const rightKey = canonicalStringify(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

    return hashCanonical({
        migrationVersion: migrationVersion.trim(),
        timeZone: normalizedTimeZone,
        records: entries
    });
}

function canonicalEqual(left, right) {
    return canonicalStringify(left) === canonicalStringify(right);
}

module.exports = {
    canonicalEqual,
    canonicalStringify,
    canonicalize: toCanonical,
    createSourceFingerprint,
    fingerprintSource: createSourceFingerprint,
    hashCanonical,
    normalizeSourceRecords,
    recordId,
    sourceRecordFingerprint,
    toCanonical
};
