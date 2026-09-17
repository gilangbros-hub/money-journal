'use strict';

const { DomainValidationError } = require('../utils/domainErrors');

/**
 * Pure pocket canonicalization and validation.
 *
 * This module is the single source of truth for the universal rules that both
 * runtime commands (PocketManagementService) and the controlled migration share:
 * name normalization, grapheme-aware emoji validation, cadence/rupiah checks,
 * deterministic multi-field error accumulation, assignment plan canonicalization,
 * canonical equality (for no-op detection), and DTO serialization helpers.
 *
 * It has NO database, session, environment, or current-time dependency. Weekly
 * assignment planning receives the already-derived intersecting ISO weeks from
 * the caller (the salary-cycle-aware planner) so this layer stays pure and
 * independently testable. A partially valid command is never returned: callers
 * check the accumulated `errors` array before persisting anything.
 */

// Requirement range for every rupiah amount: a non-negative whole number from
// 0 through 999,999,999,999 inclusive.
const MAX_RUPIAH = 999999999999;

const CADENCES = ['Monthly', 'Weekly'];
const AMOUNT_MODES = ['Use_Default', 'Customize'];

const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 50;

const MONTHLY_KEY = 'monthly';
// Canonical ISO week key, e.g. 2027-W05.
const WEEKLY_KEY_PATTERN = /^(\d{4})-W(\d{2})$/;

// Deterministic field order for accumulated definition errors. Matches the
// order pockets are described in the requirements (name, emoji, cadence,
// default amount) so multi-field responses are stable regardless of input key
// order.
const DEFINITION_FIELD_ORDER = ['name', 'emoji', 'cadence', 'defaultAmount'];

const FIELD_LABELS = {
    name: 'name',
    emoji: 'emoji',
    cadence: 'cadence',
    defaultAmount: 'defaultAmount'
};

// A single lazily-constructed grapheme segmenter. `Intl.Segmenter` groups a
// user-perceived emoji (skin-tone modifiers, ZWJ sequences, keycaps, flag pairs)
// into one grapheme cluster, which is exactly the "one user-perceived emoji"
// rule; UTF-16 length would incorrectly reject those.
let graphemeSegmenter = null;
const getGraphemeSegmenter = () => {
    if (!graphemeSegmenter) {
        graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    }
    return graphemeSegmenter;
};

// A grapheme cluster is treated as an emoji when it carries at least one
// pictographic / emoji-presentation / regional-indicator code point. Variation
// selectors, ZWJ, keycap combiners, and skin-tone modifiers are only meaningful
// inside such a cluster, so the whole cluster remains one emoji.
const EMOJI_CODEPOINT_PATTERN = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}/u;

// Count user-visible code points rather than UTF-16 units so multi-unit
// characters are not double-counted against the 1-50 length rule.
const codePointLength = (value) => Array.from(String(value)).length;

const isRupiahAmount = (value) => (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_RUPIAH
);

const validationError = (field, reason, details) =>
    new DomainValidationError(field, reason, details || {});

const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);

/**
 * Normalize a pocket name.
 *
 * `name` is the trimmed display value; internal user text is preserved.
 * `normalizedName` is the comparison form used for uniqueness: trimmed, each
 * internal whitespace run collapsed to a single ASCII space, and lowercased
 * with the locale-independent Unicode default case mapping.
 *
 * @returns {{ name: string, normalizedName: string }}
 */
function normalizePocketName(value) {
    const raw = typeof value === 'string' ? value : '';
    const name = raw.trim();
    const normalizedName = name.replace(/\s+/g, ' ').toLowerCase();
    return { name, normalizedName };
}

/**
 * Validate and normalize a pocket name. Throws a field-specific
 * DomainValidationError on a non-string or an out-of-range length (measured in
 * Unicode code points after trimming).
 *
 * @returns {{ name: string, normalizedName: string }}
 */
function validatePocketName(value) {
    if (typeof value !== 'string') {
        throw validationError('name', 'name must be provided as text.');
    }

    const { name, normalizedName } = normalizePocketName(value);
    const length = codePointLength(name);
    if (length < NAME_MIN_LENGTH || length > NAME_MAX_LENGTH) {
        throw validationError(
            'name',
            `name must contain ${NAME_MIN_LENGTH} through ${NAME_MAX_LENGTH} characters after trimming.`,
            { min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }
        );
    }

    return { name, normalizedName };
}

/**
 * Validate that a value is exactly one user-perceived emoji and return the
 * canonical emoji string (the single grapheme cluster).
 */
function validatePocketEmoji(value) {
    if (typeof value !== 'string') {
        throw validationError('emoji', 'emoji must be provided as text.');
    }

    const clusters = Array.from(getGraphemeSegmenter().segment(value))
        .map((part) => part.segment)
        .filter((segment) => segment.trim().length > 0);

    if (clusters.length !== 1) {
        throw validationError('emoji', 'emoji must contain exactly one emoji.');
    }

    const [cluster] = clusters;
    if (!EMOJI_CODEPOINT_PATTERN.test(cluster)) {
        throw validationError('emoji', 'emoji must be a single emoji character.');
    }

    return cluster;
}

/**
 * Validate a cadence value. Returns the canonical `Monthly` | `Weekly` string.
 */
function validateCadence(value) {
    if (value === undefined || value === null || value === '') {
        throw validationError('cadence', 'cadence is required.');
    }
    if (!CADENCES.includes(value)) {
        throw validationError(
            'cadence',
            `cadence must be one of: ${CADENCES.join(', ')}.`,
            { allowed: CADENCES }
        );
    }
    return value;
}

/**
 * Validate an amount mode value. Returns the canonical
 * `Use_Default` | `Customize` string.
 */
function validateAmountMode(value) {
    if (value === undefined || value === null || value === '') {
        throw validationError('amountMode', 'amountMode is required.');
    }
    if (!AMOUNT_MODES.includes(value)) {
        throw validationError(
            'amountMode',
            `amountMode must be one of: ${AMOUNT_MODES.join(', ')}.`,
            { allowed: AMOUNT_MODES }
        );
    }
    return value;
}

/**
 * Validate a rupiah amount for the supplied field path. Returns the integer.
 */
function validateRupiah(value, field = 'amount') {
    if (!isRupiahAmount(value)) {
        throw validationError(
            field,
            `${field} must be a whole number from 0 through ${MAX_RUPIAH}.`,
            { min: 0, max: MAX_RUPIAH }
        );
    }
    return value;
}

const requiredDetails = (key) => {
    if (key === 'name') return { min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH };
    if (key === 'defaultAmount') return { min: 0, max: MAX_RUPIAH };
    return {};
};

/**
 * Validate the mutable definition fields, accumulating every field error in a
 * deterministic order rather than throwing on the first failure.
 *
 * - `create` mode: every field is required; a missing or null field produces a
 *   required-field error.
 * - `update` mode: only supplied fields are validated; an omitted field is
 *   preserved (no error, no value). An explicitly null field is rejected
 *   because a required field cannot be cleared.
 *
 * @returns {{ value: object, errors: DomainValidationError[] }}
 */
function validateDefinitionFields(input, mode = 'create') {
    const source = input && typeof input === 'object' ? input : {};
    const isCreate = mode !== 'update';
    const value = {};
    const errors = [];

    const validators = {
        name: (raw) => {
            const { name, normalizedName } = validatePocketName(raw);
            value.name = name;
            value.normalizedName = normalizedName;
        },
        emoji: (raw) => {
            value.emoji = validatePocketEmoji(raw);
        },
        cadence: (raw) => {
            value.cadence = validateCadence(raw);
        },
        defaultAmount: (raw) => {
            value.defaultAmount = validateRupiah(raw, 'defaultAmount');
        }
    };

    for (const key of DEFINITION_FIELD_ORDER) {
        const present = hasOwn(source, key);
        const nullish = !present || source[key] === undefined || source[key] === null;

        if (!nullish) {
            try {
                validators[key](source[key]);
            } catch (error) {
                errors.push(error);
            }
            continue;
        }

        // Missing on create, or explicitly present-but-null on either mode, is a
        // required-field error. An omitted field on update is simply preserved.
        if (isCreate || present) {
            errors.push(validationError(
                key,
                `${FIELD_LABELS[key]} is required.`,
                requiredDetails(key)
            ));
        }
    }

    return { value, errors };
}

/**
 * Normalize the caller-supplied intersecting ISO weeks into a stable
 * `{ key, weekYear, weekNumber }` shape. Weeks that cannot be parsed are
 * dropped; the planner is responsible for supplying real intersecting weeks.
 */
function normalizeWeeks(weeks) {
    if (!Array.isArray(weeks)) return [];

    return weeks
        .map((week) => {
            if (typeof week === 'string') {
                const match = WEEKLY_KEY_PATTERN.exec(week);
                if (!match) return null;
                return { key: week, weekYear: Number(match[1]), weekNumber: Number(match[2]) };
            }
            if (week && typeof week === 'object' && typeof week.key === 'string') {
                const match = WEEKLY_KEY_PATTERN.exec(week.key);
                if (!match) return null;
                const weekYear = Number.isInteger(week.weekYear) ? week.weekYear : Number(match[1]);
                const weekNumber = Number.isInteger(week.weekNumber) ? week.weekNumber : Number(match[2]);
                return { key: week.key, weekYear, weekNumber };
            }
            return null;
        })
        .filter(Boolean);
}

/**
 * Sort allocations by canonical key so equality comparison and persisted order
 * are deterministic.
 */
function sortAllocationsByKey(allocations) {
    return [...(Array.isArray(allocations) ? allocations : [])].sort((left, right) => {
        if (left.key < right.key) return -1;
        if (left.key > right.key) return 1;
        return 0;
    });
}

/**
 * Sum of every allocation amount, counting each allocation exactly once.
 */
function sumAllocations(allocations) {
    return (Array.isArray(allocations) ? allocations : []).reduce(
        (total, allocation) => total + (allocation && Number.isFinite(allocation.amount) ? allocation.amount : 0),
        0
    );
}

/**
 * Build the immutable definition snapshot fields stored on an assignment.
 */
function toDefinitionSnapshot(definition) {
    const source = definition && typeof definition === 'object' ? definition : {};
    const normalizedName = source.normalizedName
        || normalizePocketName(source.name || '').normalizedName;
    return {
        pocketNameSnapshot: source.name,
        pocketNormalizedNameSnapshot: normalizedName,
        pocketEmojiSnapshot: source.emoji,
        cadenceSnapshot: source.cadence,
        definitionVersion: source.version
    };
}

const definitionPocketId = (definition, fallback) => {
    if (definition && definition.id) return String(definition.id);
    if (definition && definition._id) return String(definition._id);
    if (fallback !== undefined && fallback !== null) return String(fallback);
    return undefined;
};

function buildDefaultAllocations(cadence, defaultAmount, weeks, errors) {
    let amount;
    try {
        amount = validateRupiah(defaultAmount, 'defaultAmount');
    } catch (error) {
        errors.push(error);
        return [];
    }

    if (cadence === 'Monthly') {
        return [{ kind: 'Monthly', key: MONTHLY_KEY, amount }];
    }

    const normalizedWeeks = normalizeWeeks(weeks);
    if (normalizedWeeks.length === 0) {
        errors.push(validationError('weeks', 'The selected Budget Month has no intersecting ISO weeks.'));
        return [];
    }

    return normalizedWeeks.map((week) => ({
        kind: 'Weekly',
        key: week.key,
        isoWeekYear: week.weekYear,
        isoWeekNumber: week.weekNumber,
        amount
    }));
}

function buildCustomMonthlyAllocations(supplied, errors) {
    const seen = new Set();
    let monthlyEntry = null;

    supplied.forEach((entry, position) => {
        const key = entry && typeof entry === 'object' ? entry.key : undefined;
        if (typeof key !== 'string') {
            errors.push(validationError(`allocations[${position}]`, 'Each custom allocation requires a valid key.'));
            return;
        }
        if (seen.has(key)) {
            errors.push(validationError(`allocations.${key}`, `Duplicate custom amount for ${key}.`, { rule: 'duplicate' }));
            return;
        }
        seen.add(key);
        if (key !== MONTHLY_KEY) {
            errors.push(validationError(`allocations.${key}`, `Unexpected allocation key ${key} for a Monthly pocket.`, { rule: 'unknown' }));
            return;
        }
        monthlyEntry = entry;
    });

    if (!monthlyEntry) {
        errors.push(validationError('allocations.monthly', 'A custom monthly amount is required.', { rule: 'required' }));
        return [];
    }

    try {
        const amount = validateRupiah(monthlyEntry.amount, 'allocations.monthly');
        return [{ kind: 'Monthly', key: MONTHLY_KEY, amount }];
    } catch (error) {
        errors.push(error);
        return [];
    }
}

function buildCustomWeeklyAllocations(weeks, supplied, errors) {
    const normalizedWeeks = normalizeWeeks(weeks);
    if (normalizedWeeks.length === 0) {
        errors.push(validationError('weeks', 'The selected Budget Month has no intersecting ISO weeks.'));
        return [];
    }

    const weekByKey = new Map(normalizedWeeks.map((week) => [week.key, week]));
    const suppliedByKey = new Map();
    const seen = new Set();

    // First pass over supplied entries (in supplied order) captures malformed,
    // duplicate, and non-intersecting keys deterministically.
    supplied.forEach((entry, position) => {
        const key = entry && typeof entry === 'object' ? entry.key : undefined;
        if (typeof key !== 'string') {
            errors.push(validationError(`allocations[${position}]`, 'Each custom allocation requires a valid ISO week key.'));
            return;
        }
        if (seen.has(key)) {
            errors.push(validationError(`allocations.${key}`, `Duplicate custom amount for ISO week ${key}.`, { rule: 'duplicate' }));
            return;
        }
        seen.add(key);
        if (!weekByKey.has(key)) {
            errors.push(validationError(`allocations.${key}`, `ISO week ${key} does not intersect the selected Budget Month.`, { rule: 'unknown' }));
            return;
        }
        suppliedByKey.set(key, entry);
    });

    // Second pass over required weeks (in canonical week order) captures missing
    // and out-of-range amounts, and builds the canonical allocation set.
    const allocations = [];
    normalizedWeeks.forEach((week) => {
        const field = `allocations.${week.key}`;
        if (!suppliedByKey.has(week.key)) {
            errors.push(validationError(field, `A custom amount is required for ISO week ${week.key}.`, { rule: 'required' }));
            return;
        }
        try {
            const amount = validateRupiah(suppliedByKey.get(week.key).amount, field);
            allocations.push({
                kind: 'Weekly',
                key: week.key,
                isoWeekYear: week.weekYear,
                isoWeekNumber: week.weekNumber,
                amount
            });
        } catch (error) {
            errors.push(error);
        }
    });

    return allocations;
}

/**
 * Canonicalize one assignment entry into a complete, validated plan.
 *
 * The cadence and definition snapshot are derived server-side from the supplied
 * `definition`; a client-supplied cadence or default amount is never treated as
 * authoritative. Weekly plans use the caller-derived intersecting `weeks`.
 *
 * All independently evaluable errors are accumulated in deterministic order and
 * returned in `errors`; `plan` is null whenever any error is present, so a
 * partially valid plan is never produced.
 *
 * @returns {{ plan: object|null, errors: DomainValidationError[] }}
 */
function canonicalizeAssignment(input, definition, budgetMonth, weeks) {
    const errors = [];
    const source = input && typeof input === 'object' ? input : {};

    if (!definition || typeof definition !== 'object') {
        errors.push(validationError('pocketId', 'A pocket definition is required to plan an assignment.'));
        return { plan: null, errors };
    }

    const cadence = definition.cadence;
    if (!CADENCES.includes(cadence)) {
        errors.push(validationError('cadence', 'The pocket definition has an invalid cadence.', { allowed: CADENCES }));
    }

    let amountMode;
    try {
        amountMode = validateAmountMode(source.amountMode);
    } catch (error) {
        errors.push(error);
    }

    const suppliedAllocations = Array.isArray(source.allocations) ? source.allocations : [];

    let allocations = [];
    if (amountMode && CADENCES.includes(cadence)) {
        if (amountMode === 'Use_Default') {
            allocations = buildDefaultAllocations(cadence, definition.defaultAmount, weeks, errors);
        } else if (cadence === 'Monthly') {
            allocations = buildCustomMonthlyAllocations(suppliedAllocations, errors);
        } else {
            allocations = buildCustomWeeklyAllocations(weeks, suppliedAllocations, errors);
        }
    }

    if (errors.length > 0) {
        return { plan: null, errors };
    }

    const plan = {
        pocketId: definitionPocketId(definition, source.pocketId),
        budgetMonth: typeof budgetMonth === 'string' ? budgetMonth : undefined,
        amountMode,
        ...toDefinitionSnapshot(definition),
        allocations: sortAllocationsByKey(allocations),
        allocationTotal: sumAllocations(allocations)
    };

    return { plan, errors: [] };
}

/**
 * A stable canonical signature of the meaningful assignment content: amount
 * mode, cadence snapshot, the definition snapshot values, and the allocation
 * key/amount set in sorted key order. Audit identities, timestamps, versions,
 * and ids are intentionally excluded so equivalent plans/documents match.
 */
function canonicalAssignmentSignature(assignmentLike) {
    const source = assignmentLike && typeof assignmentLike === 'object' ? assignmentLike : {};
    const allocations = sortAllocationsByKey(source.allocations || []).map((allocation) => ({
        kind: allocation.kind,
        key: allocation.key,
        amount: allocation.amount
    }));

    return JSON.stringify({
        amountMode: source.amountMode ?? null,
        cadence: source.cadenceSnapshot ?? source.cadence ?? null,
        name: source.pocketNameSnapshot ?? source.pocketName ?? null,
        normalizedName: source.pocketNormalizedNameSnapshot ?? source.pocketNormalizedName ?? null,
        emoji: source.pocketEmojiSnapshot ?? source.pocketEmoji ?? null,
        allocations
    });
}

/**
 * Canonical equality for two assignment plans/documents. Used to detect no-op
 * confirmations so version and timestamps can be preserved.
 */
function areAssignmentsEquivalent(left, right) {
    return canonicalAssignmentSignature(left) === canonicalAssignmentSignature(right);
}

module.exports = {
    // Constants
    MAX_RUPIAH,
    CADENCES,
    AMOUNT_MODES,
    NAME_MIN_LENGTH,
    NAME_MAX_LENGTH,
    MONTHLY_KEY,
    WEEKLY_KEY_PATTERN,
    // Field validators / normalizers
    normalizePocketName,
    validatePocketName,
    validatePocketEmoji,
    validateCadence,
    validateAmountMode,
    validateRupiah,
    validateDefinitionFields,
    // Assignment planning + equality
    canonicalizeAssignment,
    canonicalAssignmentSignature,
    areAssignmentsEquivalent,
    // DTO / serialization helpers
    normalizeWeeks,
    sortAllocationsByKey,
    sumAllocations,
    toDefinitionSnapshot
};
