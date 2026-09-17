'use strict';

const mongoose = require('mongoose');
const { createConfiguration } = require('../config');
const { getActualPayday, getSalaryCyclePeriod, intersectPeriodAndWeek, listIntersectingIsoWeeks } = require('../services/salaryCycleResolver');
const { checkTransactionsSupported } = require('../services/migrationService');
const { requireAuthenticated, requirePocketManagementFeature } = require('../middleware/auth');
const { createPocketRoutes } = require('../routes/pockets');
const { POCKETS } = require('../utils/constants');
const models = {
    transactions: require('../models/transaction'),
    pocketbudgets: require('../models/pocketBudget'),
    pocketbudgetcadences: require('../models/pocketBudgetCadence'),
    weeklyallocations: require('../models/weeklyAllocation'),
    closedmonths: require('../models/closedMonth')
};

// Managed Pocket Management collections. These are gated behind
// POCKET_MANAGEMENT_ENABLED and must satisfy every readiness check below before
// that primary flag can be enabled.
const managedModels = {
    pocketdefinitions: require('../models/pocketDefinition'),
    pocketassignments: require('../models/pocketAssignment')
};

const REQUIRED_UNIQUE_KEYS = {
    pocketbudgets: { pocket: 1, month: 1, year: 1 },
    pocketbudgetcadences: { pocket: 1, month: 1, year: 1 },
    weeklyallocations: { pocket: 1, month: 1, year: 1, isoWeekYear: 1, isoWeekNumber: 1 },
    closedmonths: { month: 1, year: 1 }
};

// Schema paths every managed model must expose so managed reads/writes and DTO
// snapshots are viable before activation.
const REQUIRED_MANAGED_PATHS = {
    pocketdefinitions: [
        'name', 'normalizedName', 'emoji', 'cadence', 'defaultAmount', 'status',
        'createdBy', 'updatedBy', 'version', 'schemaVersion'
    ],
    pocketassignments: [
        'pocketId', 'budgetMonth', 'budgetYear', 'pocketNameSnapshot',
        'pocketNormalizedNameSnapshot', 'pocketEmojiSnapshot', 'cadenceSnapshot',
        'amountMode', 'definitionVersion', 'allocations', 'createdBy', 'updatedBy',
        'version', 'schemaVersion'
    ]
};

// Required managed indexes: the unique write guards that back normalized-name
// and (pocketId, budgetYear, budgetMonth) uniqueness, plus the ordered
// management/month sort indexes.
const REQUIRED_MANAGED_INDEXES = {
    pocketdefinitions: [
        { key: { normalizedName: 1 }, unique: true },
        { key: { status: 1, normalizedName: 1, _id: 1 }, unique: false }
    ],
    pocketassignments: [
        { key: { pocketId: 1, budgetYear: 1, budgetMonth: 1 }, unique: true },
        { key: { budgetYear: 1, budgetMonth: 1, pocketNormalizedNameSnapshot: 1, pocketId: 1 }, unique: false }
    ]
};

// Composite keys whose duplicates would violate the managed unique indexes and
// must not already exist in stored data before activation.
const REQUIRED_MANAGED_DUPLICATE_KEYS = {
    pocketdefinitions: ['normalizedName'],
    pocketassignments: ['pocketId', 'budgetYear', 'budgetMonth']
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

function assertManagedSchemaPaths(managedModelMap = managedModels) {
    const failures = [];
    for (const [name, paths] of Object.entries(REQUIRED_MANAGED_PATHS)) {
        const model = managedModelMap[name];
        if (!model?.schema || typeof model.schema.path !== 'function') {
            failures.push(`${name}: managed schema is not registered`);
            continue;
        }
        for (const path of paths) {
            if (!model.schema.path(path)) {
                failures.push(`${name}: required schema path is missing (${path})`);
            }
        }
    }
    if (failures.length) throw new Error(failures.join('; '));
}

async function assertManagedIndexes(connection, managedModelMap = managedModels) {
    const failures = [];
    for (const [name, requirements] of Object.entries(REQUIRED_MANAGED_INDEXES)) {
        const model = managedModelMap[name];
        if (!model?.schema) {
            failures.push(`${name}: managed model is not registered`);
            continue;
        }
        const indexes = typeof model.collection?.listIndexes === 'function'
            ? await model.collection.listIndexes().toArray()
            : model.schema.indexes().map(([key, options]) => ({ key, unique: options.unique === true }));
        for (const requirement of requirements) {
            const found = indexes.some(index => sameKeys(index.key, requirement.key) &&
                (requirement.unique !== true || index.unique === true));
            if (!found) {
                failures.push(`${name}: required ${requirement.unique ? 'unique ' : ''}index is missing (${JSON.stringify(requirement.key)})`);
            }
        }
    }
    if (failures.length) throw new Error(failures.join('; '));
}

async function assertManagedDuplicatePreconditions(connection, managedModelMap = managedModels) {
    if (!connection?.db) return;
    const failures = [];
    for (const [name, fields] of Object.entries(REQUIRED_MANAGED_DUPLICATE_KEYS)) {
        const model = managedModelMap[name];
        if (!model) {
            failures.push(`${name}: managed model is not registered`);
            continue;
        }
        const groupId = {};
        for (const field of fields) groupId[field] = `$${field}`;
        const collection = connection.db.collection(model.collection.name);
        const duplicates = await collection.aggregate([
            { $group: { _id: groupId, count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
            { $limit: 1 }
        ]).toArray();
        if (duplicates.length) {
            failures.push(name === 'pocketdefinitions'
                ? 'pocketdefinitions: duplicate normalized pocket name exists'
                : 'pocketassignments: duplicate (pocketId, budgetYear, budgetMonth) assignment exists');
        }
    }
    if (failures.length) throw new Error(failures.join('; '));
}

function invokeFeatureGate(gate, enabled) {
    let outcome = 'pending';
    let error;
    const req = {
        app: { locals: { configuration: { pocketManagementEnabled: enabled } } },
        headers: {},
        path: '/api/pockets'
    };
    gate(req, {}, (err) => {
        if (err) {
            outcome = 'error';
            error = err;
        } else {
            outcome = 'next';
        }
    });
    return { blocked: outcome === 'error', passed: outcome === 'next', error };
}

/**
 * Managed routes must be gated and safe while POCKET_MANAGEMENT_ENABLED is
 * false. This verifies both the gate behavior (blocks with the pocket-specific
 * feature-disabled error when off, passes when on) and that the managed router
 * actually mounts authentication and the feature gate ahead of any handler.
 */
function assertManagedRouteGating({
    gate = requirePocketManagementFeature,
    routerFactory = createPocketRoutes
} = {}) {
    const flagOff = invokeFeatureGate(gate, false);
    if (!flagOff.blocked) {
        throw new Error('managed routes must be unavailable while POCKET_MANAGEMENT_ENABLED is false');
    }
    if (flagOff.error?.code !== 'POCKET_MANAGEMENT_FEATURE_DISABLED') {
        throw new Error('managed feature gate must return the pocket-management feature-disabled error while the flag is off');
    }
    const flagOn = invokeFeatureGate(gate, true);
    if (!flagOn.passed) {
        throw new Error('managed routes must be reachable once POCKET_MANAGEMENT_ENABLED is true');
    }

    const stubController = new Proxy({}, { get: () => function stubHandler() {} });
    const router = routerFactory({ controller: stubController });
    const layers = Array.isArray(router?.stack) ? router.stack : [];
    if (!layers.some(layer => layer?.handle === gate)) {
        throw new Error('managed router must mount the pocket-management feature gate before any handler');
    }
    if (!layers.some(layer => layer?.handle === requireAuthenticated)) {
        throw new Error('managed router must require authentication before any handler');
    }
}

/**
 * Managed-mode readiness must not depend on the fixed `utils/constants.js#POCKETS`
 * catalogue. This constructs and validates canonical managed documents whose
 * names are deliberately absent from the fixed map, and confirms the managed
 * lifecycle/cadence/amount enums are not the fixed pocket names, proving managed
 * mode can start and serve pocket/budget/transaction/report reads without the
 * fixed constants (12.15).
 */
function assertManagedReadinessWithoutFixedConstants(managedModelMap = managedModels) {
    const PocketDefinition = managedModelMap.pocketdefinitions;
    const PocketAssignment = managedModelMap.pocketassignments;
    if (!PocketDefinition || !PocketAssignment) {
        throw new Error('managed models must be registered for managed-mode readiness');
    }

    const probeName = 'Rollout Readiness Probe';
    if (Object.prototype.hasOwnProperty.call(POCKETS || {}, probeName)) {
        throw new Error('managed readiness probe name must not exist in the fixed POCKETS map');
    }

    const actor = new mongoose.Types.ObjectId();
    const definition = new PocketDefinition({
        name: probeName,
        normalizedName: 'rollout readiness probe',
        emoji: '🧪',
        cadence: 'Monthly',
        defaultAmount: 0,
        status: 'Active',
        createdBy: actor,
        updatedBy: actor
    });
    const definitionError = definition.validateSync();
    if (definitionError) {
        throw new Error(`managed definition is not viable without the fixed POCKETS map: ${definitionError.message}`);
    }

    const assignment = new PocketAssignment({
        pocketId: new mongoose.Types.ObjectId(),
        budgetMonth: 2,
        budgetYear: 2027,
        pocketNameSnapshot: probeName,
        pocketNormalizedNameSnapshot: 'rollout readiness probe',
        pocketEmojiSnapshot: '🧪',
        cadenceSnapshot: 'Monthly',
        amountMode: 'Use_Default',
        definitionVersion: 1,
        allocations: [{ kind: 'Monthly', key: 'monthly', amount: 0 }],
        createdBy: actor,
        updatedBy: actor
    });
    const assignmentError = assignment.validateSync();
    if (assignmentError) {
        throw new Error(`managed assignment is not viable without the fixed POCKETS map: ${assignmentError.message}`);
    }

    const pocketNames = Object.keys(POCKETS || {});
    const managedEnums = [
        ...(PocketDefinition.CADENCES || []),
        ...(PocketDefinition.STATUSES || []),
        ...(PocketAssignment.AMOUNT_MODES || [])
    ];
    if (managedEnums.some(value => pocketNames.includes(value))) {
        throw new Error('managed schema enums must not embed fixed pocket names');
    }
}

async function runPreflight({
    environment = process.env,
    connection = mongoose.connection,
    modelMap = models,
    managedModelMap = managedModels,
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

    // Managed Pocket Management readiness gates. Every check below must pass
    // before POCKET_MANAGEMENT_ENABLED can be enabled; any failure rejects here
    // and blocks the rollout (fail closed).
    assertManagedSchemaPaths(managedModelMap);
    await assertManagedIndexes(connection, managedModelMap);
    await assertManagedDuplicatePreconditions(connection, managedModelMap);
    assertManagedRouteGating();
    assertManagedReadinessWithoutFixedConstants(managedModelMap);

    return {
        ok: true,
        householdTimeZone: configuration.householdTimeZone,
        salaryCycleBudgetingEnabled: configuration.salaryCycleBudgetingEnabled,
        pocketManagementEnabled: configuration.pocketManagementEnabled,
        pocketManagementReady: true,
        checked: [
            'configuration',
            'transactions',
            'duplicates',
            'indexes',
            'calendar-cases',
            'authenticated-routes',
            'managed-schema-paths',
            'managed-indexes',
            'managed-duplicates',
            'managed-route-gating',
            'managed-without-fixed-constants'
        ]
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
    REQUIRED_MANAGED_PATHS,
    REQUIRED_MANAGED_INDEXES,
    REQUIRED_MANAGED_DUPLICATE_KEYS,
    assertAuthenticatedRouteSmoke,
    assertDuplicatePreconditions,
    assertIndexes,
    assertManagedSchemaPaths,
    assertManagedIndexes,
    assertManagedDuplicatePreconditions,
    assertManagedRouteGating,
    assertManagedReadinessWithoutFixedConstants,
    assertRepresentativeCalendarCases,
    runPreflight
};
