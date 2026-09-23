'use strict';

/**
 * Fixed catalogue of banks a pocket can live in. A pocket stores the `key`, so
 * a display name can change without touching data. Adding a bank is one entry
 * here plus a logo at public/images/banks/<key>.svg; until the file exists the
 * UI falls back to a letter badge in `color`.
 */
const BANKS = Object.freeze([
    Object.freeze({ key: 'jago', name: 'Jago', color: '#FDAF27' }),
    Object.freeze({ key: 'blu', name: 'blu', color: '#33CDCF' }),
    Object.freeze({ key: 'superbank', name: 'Superbank', color: '#012A31' }),
    Object.freeze({ key: 'bca', name: 'BCA', color: '#0060AF' })
].map(bank => Object.freeze({ ...bank, logo: `/images/banks/${bank.key}.svg` })));

const BANK_KEYS = Object.freeze(BANKS.map(bank => bank.key));

function findBank(key) {
    return BANKS.find(bank => bank.key === key) || null;
}

/**
 * Plain display object for a bank key (what views and API rows carry), or null
 * for a missing/unknown key. `initial` feeds the letter-badge fallback.
 */
function bankView(key) {
    const bank = findBank(key);
    if (!bank) return null;
    return {
        key: bank.key,
        name: bank.name,
        color: bank.color,
        logo: bank.logo,
        initial: bank.name.charAt(0).toUpperCase()
    };
}

module.exports = {
    BANKS,
    BANK_KEYS,
    findBank,
    bankView
};
