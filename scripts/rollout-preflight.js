'use strict';

const mongoose = require('mongoose');
const { createConfiguration } = require('../config');
const { getActualPayday, getSalaryCyclePeriod, intersectPeriodAndWeek, listIntersectingIsoWeeks } = require('../services/salaryCycleResolver');
const { checkTransactionsSupported } = require('../services/migrationService');
const models = {
    transactions: require('../models/transaction'),
    pocketbudgets: require('../models/pocketBudget'),
    pocketbudgetcadences: require('../models/pocketBudgetCadence'),
    weeklyallocations: require('../models/weeklyAllocation'),
    closedmonths: require('../models/closedMonth')
};

const REQUIRED_UNIQUE_KEYS = {
    pocketbudgets: { pocket: 1, month: 1, year: 1 },
    pocketbudgetcadences: { pocket: 1, month: 1, year: 1 },
    weeklyallocations: { pocket: 1, month: 1, year: 1, isoWeekYear: 1, isoWeekNumber: 1 },
    closedmonths: { month: 1, year: 1 }
};

function sameKeys(left, right) {
    const l = JSON.stringify(left);
    const r = JSON.stringify(right);
    return l === r;
}

function assertRepresentativeCalendarCases() {
    if (getActualPayday({ year: 2027, month: 2 }) !== '2027-02-25') throw new Error('weekday payday gate failed');
    if (getActualPayday({ year: 2021, month: 4 }) !== '2021-04-23') throw new Error('Sunday payday gate failed');
    if (getActualPayday({ year: 2021, month: 9 }) !== '2021-09-24') throw new Error('Saturday payday gate failed');
    const period = getSalaryCyclePeriod({ budgetMonth: '2027-02' });
    const weeks = listIntersectingIsoWeeks({ period });
    if (!weeks.some(week => week.key === '2027-W04')) throw new Error('crossing-week gate failed');
    const intersection = intersectPeriodAndWeek({ period, week: '2027-W04' });
    if (intersection.startDate !== '2027-01-25') throw new Error('week intersection start gate failed');
}

async function assertIndexes(connection, modelMap = models) {
    const failures = [];
    for (const [name, model] of Object.entries(modelMap)) {
        const required = REQUIRED_UNIQUE_KEYS[name];
        if (!required) continue;
        const indexes = typeof model.collection?.listIndexes === 'function'
            ? await model.collection.listIndexes().toArray()
            : model.schema.indexes().map(([key, options]) => ({ key, unique: options.unique === true }));
        const declared = typeof model.schema?.indexes === 'function'
            ? model.schema.indexes()
            : [[required, { unique: true }]];
        for (const [declaredKey, declaredOptions] of declared) {
            const foundDeclared = indexes.some(index => sameKeys(index.key, declaredKey) &&
                (declaredOptions.unique !== true || index.unique === true));
            if (!foundDeclared) failures.push(`${name}: declared index is missing (${JSON.stringify(declaredKey)})`);
        }
        const found = indexes.some(index => index.unique === true && sameKeys(index.key, required));
        if (!found) failures.push(`${name}: required unique index is missing`);
    }
    if (failures.length) throw new Error(failures.join('; '));
}

async function assertDuplicatePreconditions(connection, modelMap = models) {
    if (!connection?.db) return;
    for (const [name, key] of Object.entries(REQUIRED_UNIQUE_KEYS)) {
        const collection = connection.db.collection(modelMap[name].collection.name);
        const duplicates = await collection.aggregate([
            { $group: { _id: key, count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
            { $limit: 1 }
        ]).toArray();
        if (duplicates.length) throw new Error(`${name}: duplicate composite key exists`);
    }
}

async function assertAuthenticatedRouteSmoke({ smokeUrl, cookie, fetchImpl = globalThis.fetch } = {}) {
    if (typeof smokeUrl !== 'string' || smokeUrl.trim() === '' || typeof fetchImpl !== 'function') {
        throw new Error('authenticated route smoke fixture is required');
    }
    const headers = cookie ? { cookie } : {};
    for (const path of ['/api/budget', '/api/budget/history', '/api/transactions']) {
        const response = await fetchImpl(new URL(path, smokeUrl), { headers });
        if (!response.ok) throw new Error(`authenticated route smoke failed: ${path} (${response.status})`);
    }
}

async function runPreflight({
    environment = process.env,
    connection = mongoose.connection,
    modelMap = models,
    smokeUrl = environment.ROLLOUT_AUTH_SMOKE_URL,
    cookie = environment.ROLLOUT_AUTH_SMOKE_COOKIE,
    fetchImpl
} = {}) {
    const configuration = createConfiguration(environment);
    assertRepresentativeCalendarCases();
    if (!connection?.db) throw new Error('MongoDB connection is required for rollout preflight');
    await checkTransactionsSupported(connection);
    await assertDuplicatePreconditions(connection, modelMap);
    await assertIndexes(connection, modelMap);
    await assertAuthenticatedRouteSmoke({ smokeUrl, cookie, fetchImpl });
    return {
        ok: true,
        householdTimeZone: configuration.householdTimeZone,
        salaryCycleBudgetingEnabled: configuration.salaryCycleBudgetingEnabled,
        checked: ['configuration', 'transactions', 'duplicates', 'indexes', 'calendar-cases', 'authenticated-routes']
    };
}

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI, { readPreference: 'primary' });
    try {
        const result = await runPreflight();
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    REQUIRED_UNIQUE_KEYS,
    assertAuthenticatedRouteSmoke,
    assertDuplicatePreconditions,
    assertIndexes,
    assertRepresentativeCalendarCases,
    runPreflight
};
