// Bank logo markup shared by Pocket Management, Check Pockets and Log Spending.
// `bank` is { key, name, color, logo } as the server sends it. The logo sits on
// a white tile; if the file fails to load, a letter badge in the bank colour
// takes its place.
(function banksModule(global) {
    function escapeAttr(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function bankLogoHtml(bank, size) {
        if (!bank || !bank.key) return '';
        const name = bank.name || bank.key;
        const initial = String(name).trim().charAt(0).toUpperCase();
        const color = /^#[0-9a-f]{3,8}$/i.test(bank.color || '') ? bank.color : '#6B7B96';
        const logo = bank.logo || `/images/banks/${bank.key}.svg`;
        return `<span class="bank-logo bank-logo-${size || 'md'}" data-bank-logo="${escapeAttr(bank.key)}" title="${escapeAttr(name)}">`
            + `<img src="${escapeAttr(logo)}" alt="${escapeAttr(name)}" loading="lazy" data-bank-logo-img onerror="bankLogoFallback(this)">`
            + `<span class="bank-logo-fallback" style="background:${color}" aria-hidden="true" hidden>${escapeAttr(initial)}</span>`
            + '</span>';
    }

    function bankLogoFallback(img) {
        if (!img || img.hidden) return;
        img.hidden = true;
        const badge = img.nextElementSibling;
        if (badge) badge.hidden = false;
    }

    // Inline onerror covers server-rendered logos; this covers markup inserted
    // later and environments where inline handlers don't run.
    global.document.addEventListener('error', (event) => {
        const target = event.target;
        if (target && target.matches && target.matches('img[data-bank-logo-img]')) bankLogoFallback(target);
    }, true);

    global.bankLogoHtml = bankLogoHtml;
    global.bankLogoFallback = bankLogoFallback;
})(window);
