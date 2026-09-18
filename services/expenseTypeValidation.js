'use strict';

const {
    NAME_MIN_LENGTH,
    NAME_MAX_LENGTH,
    normalizePocketName,
    validatePocketName,
    validatePocketEmoji
} = require('./pocketValidation');
const { DomainValidationError } = require('../utils/domainErrors');

/**
 * Expense-type canonicalization and validation.
 *
 * A pocket and an expense type are both "an emoji plus a household-chosen
 * name, with an active/archived lifecycle" — the same universal rules apply:
 * trim + collapse + lowercase for name comparison, and exactly one
 * user-perceived emoji. Rather than re-deriving that Unicode-grapheme logic,
 * this module reuses pocketValidation's pure name/emoji helpers under names
 * that read correctly at expense-type call sites.
 */

const NAME_FIELD_ORDER = ['name', 'emoji'];
const FIELD_LABELS = { name: 'name', emoji: 'emoji' };

const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);

/**
 * Validate the mutable definition fields (name, emoji), accumulating every
 * field error in a deterministic order rather than throwing on the first
 * failure.
 *
 * - `create` mode: every field is required.
 * - `update` mode: only supplied fields are validated; an omitted field is
 *   preserved. An explicitly null field is rejected because a required field
 *   cannot be cleared.
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
        }
    };

    for (const key of NAME_FIELD_ORDER) {
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

        if (isCreate || present) {
            errors.push(new DomainValidationError(
                key,
                `${FIELD_LABELS[key]} is required.`,
                key === 'name' ? { min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH } : {}
            ));
        }
    }

    return { value, errors };
}

module.exports = {
    NAME_MIN_LENGTH,
    NAME_MAX_LENGTH,
    normalizeTypeName: normalizePocketName,
    validateTypeName: validatePocketName,
    validateTypeEmoji: validatePocketEmoji,
    validateDefinitionFields
};
