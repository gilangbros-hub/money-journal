'use strict';

/**
 * Fixed catalogue of banks a pocket can live in. A pocket stores the `key`, so
 * a display name can change without touching data. Adding a bank is one entry
 * here plus a logo at public/images/banks/<key>.svg; until the file exists the
 * UI falls back to a letter badge in `color`.
 */
const BANKS = Object.freeze([
    Object.freeze({ key: 'jago', name: 'Bank Jago', color: '#F5A623' }),
    Object.freeze({ key: 'blu', name: 'blu', color: '#00A3E0' }),
    Object.freeze({ key: 'superbank', name: 'Superbank', color: '#6C2BD9' }),
    Object.freeze({ key: 'bca', name: 'BCA', color: '#0060AF' })
].map(bank => Object.freeze({ ...bank, logo: `/images/banks/${bank.key}.svg` })));

const BANK_KEYS = Object.freeze(BANKS.map(bank => bank.key));

function findBank(key) {
    return BANKS.find(bank => bank.key === key) || null;
}

module.exports = {
    BANKS,
    BANK_KEYS,
    findBank
};
