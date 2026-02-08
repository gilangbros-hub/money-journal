/**
 * Formats a number as a currency string.
 * @param {number} amount - The amount to format.
 * @param {string} currencyCode - The ISO 4217 currency code (default: 'IDR').
 * @param {string} locale - The locale code (default: 'id-ID').
 * @returns {string} The formatted currency string.
 */
const formatCurrency = (amount, currencyCode = 'IDR', locale = 'id-ID') => {
    if (amount === undefined || amount === null) return 'Rp 0';

    // Ensure amount is a number, handling string inputs
    const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

    if (isNaN(numericAmount)) return 'Rp 0';

    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0 // IDs usually don't use decimals for Rp
    }).format(numericAmount);
};

module.exports = {
    formatCurrency
};
