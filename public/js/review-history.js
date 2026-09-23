// All Transactions Page Logic

const typeEmojis = {
    'Eat': '🍽️', 'Snack': '🍿', 'Groceries': '🛒', 'Laundry': '🧺',
    'Bensin': '⛽', 'Flazz': '💳', 'Home Appliance': '🏠', 'Jumat Berkah': '🤲',
    'Uang Sampah': '🗑️', 'Uang Keamanan': '👮', 'Medicine': '💊', 'Others': '📦'
};

let allTypes = Object.keys(typeEmojis);

// With Expense Type Management on, merge the managed types' emoji into
// typeEmojis so custom types don't all render as the fallback box.
const expenseTypeManagementEnabled = document.getElementById('expenseTypeManagementEnabled')?.value === 'true';

async function loadManagedTypeEmojis() {
    if (!expenseTypeManagementEnabled) return;
    try {
        const response = await fetch('/api/expense-types');
        const result = await response.json();
        if (!response.ok || result?.success !== true || !Array.isArray(result.data?.active)) return;
        result.data.active.forEach((type) => {
            if (type && typeof type.name === 'string' && type.name && type.emoji) {
                typeEmojis[type.name] = type.emoji;
            }
        });
    } catch (error) {
        // Keep the static map.
    }
}

const pocketIcons = {
    'Kwintals': '💰', 'Groceries': '🥦', 'Weekday Transport': '🚌',
    'Weekend Transport': '🚗', 'Investasi': '📈', 'Bandung': '⛰️',
    'Sedeqah': '🤲', 'IPL': '🏘️'
};

const allPockets = Object.keys(pocketIcons);

let allTransactions = [];
let filteredTransactions = [];
let currentMonth = '';
let currentType = 'all';
let currentPocket = 'all';
let sortDesc = true;

document.addEventListener('DOMContentLoaded', async () => {
    // Runs alongside the Budget Month lookup instead of after it.
    const typeEmojisReady = loadManagedTypeEmojis();
    const params = new URLSearchParams(window.location.search);
    currentMonth = params.has('month') ? params.get('month') : await determineDefaultMonth();

    const monthFilter = document.getElementById('monthFilter');
    monthFilter.value = currentMonth;

    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.href = '/monthly-story';
    }

    await typeEmojisReady;
    if (expenseTypeManagementEnabled) allTypes = Object.keys(typeEmojis);
    buildFilterPills();
    buildPocketFilterPills();
    fetchTransactions();

    monthFilter.addEventListener('change', (e) => {
        currentMonth = e.target.value;
        const url = new URL(window.location);
        url.searchParams.set('month', currentMonth);
        window.history.replaceState({}, '', url);
        fetchTransactions();
    });
});

async function determineDefaultMonth() {
    const response = await fetch('/api/budget');
    const result = await response.json();
    if (!response.ok || !result.success || !/^\d{4}-(0[1-9]|1[0-2])$/.test(result.data?.budgetMonth || '')) {
        throw new Error('Failed to load active Budget Month');
    }
    return result.data.budgetMonth;
}

function renderPeriodMetadata(history) {
    const target = document.getElementById('salaryCyclePeriod');
    const period = history?.period || history?.salaryCyclePeriod;
    if (!target || !period) return;
    target.textContent = `Budget Month ${history.budgetMonth} · Salary cycle ${period.startDate} – ${period.endDate}`;
}

function buildFilterPills() {
    const container = document.getElementById('filterPills');
    allTypes.forEach(type => {
        const btn = document.createElement('button');
        btn.className = 'filter-pill';
        btn.dataset.type = type;
        btn.textContent = `${typeEmojis[type]} ${type}`;
        btn.addEventListener('click', () => selectType(type));
        container.appendChild(btn);
    });

    container.querySelector('[data-type="all"]').addEventListener('click', () => selectType('all'));
    document.getElementById('sortBtn').addEventListener('click', toggleSort);
}

function buildPocketFilterPills() {
    const container = document.getElementById('pocketFilterPills');
    if (!container) return;

    allPockets.forEach(pocket => {
        const btn = document.createElement('button');
        btn.className = 'filter-pill';
        btn.dataset.pocket = pocket;
        btn.textContent = `${pocketIcons[pocket]} ${pocket}`;
        btn.addEventListener('click', () => selectPocket(pocket));
        container.appendChild(btn);
    });

    container.querySelector('[data-pocket="all"]').addEventListener('click', () => selectPocket('all'));
}

function selectType(type) {
    currentType = type;
    document.querySelectorAll('#filterPills .filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.type === type);
    });
    applyFilterAndRender();
}

function selectPocket(pocket) {
    currentPocket = pocket;
    document.querySelectorAll('#pocketFilterPills .filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.pocket === pocket);
    });
    applyFilterAndRender();
}

function toggleSort() {
    sortDesc = !sortDesc;
    const btn = document.getElementById('sortBtn');
    btn.innerHTML = sortDesc
        ? '<span class="text-sm transition-transform duration-300">↓</span> Newest'
        : '<span class="text-sm transition-transform duration-300 rotate-180">↑</span> Oldest';
    applyFilterAndRender();
}

async function fetchTransactions() {
    const list = document.getElementById('transactionList');
    list.innerHTML = Array(5).fill('<div class="loading-placeholder"></div>').join('');

    try {
        const response = await fetch(`/api/history?month=${encodeURIComponent(currentMonth)}`);
        const result = await response.json();
        if (!response.ok || !result.success || !result.data) throw new Error('Failed to load history');
        allTransactions = Array.isArray(result.data.transactions) ? result.data.transactions : [];
        renderPeriodMetadata(result.data);
        applyFilterAndRender();
    } catch (error) {
        console.error('Error fetching transactions:', error);
        list.innerHTML = '<div class="empty-state"><div class="text-5xl mb-3">❌</div><div class="text-[15px] font-medium">Failed to load transactions</div></div>';
    }
}

function isSplitTransaction(transaction) {
    return transaction?.sourceType === 'multi' ||
        (Array.isArray(transaction?.sourceBreakdowns) && transaction.sourceBreakdowns.length > 1);
}

function transactionHasPocket(transaction, pocket) {
    if (pocket === 'all') return true;
    return transaction?.pocket === pocket ||
        (Array.isArray(transaction?.sourceBreakdowns) && transaction.sourceBreakdowns.some(share => share?.pocket === pocket));
}

function applyFilterAndRender() {
    filteredTransactions = allTransactions.filter(t => {
        const typeMatch = currentType === 'all' || t.type === currentType;
        const pocketMatch = transactionHasPocket(t, currentPocket);
        return typeMatch && pocketMatch;
    });

    filteredTransactions.sort((a, b) => {
        const dateA = transactionDateKey(a);
        const dateB = transactionDateKey(b);
        return sortDesc ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
    });

    updateSummary();
    renderTransactions();
}

function updateSummary() {
    const count = filteredTransactions.length;
    const total = filteredTransactions.reduce((sum, t) => sum + t.amount, 0);

    const summaryInfo = document.getElementById('summaryInfo');
    summaryInfo.innerHTML = `
        <span class="text-[13px] font-semibold text-text-secondary">${count} transaction${count !== 1 ? 's' : ''}</span>
        <span class="text-base font-extrabold text-text-primary">${formatRupiah(total)}</span>
    `;
}

// formatRupiah is now in common.js

function transactionDateKey(transaction) {
    const value = transaction?.expenseDate || transaction?.date || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function formatDateGroupLabel(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    if (!year || !month || !day) return dateKey;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function renderTransactions() {
    const list = document.getElementById('transactionList');

    if (filteredTransactions.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="text-5xl mb-3">📭</div>
                <div class="text-[15px] font-medium">No transactions found</div>
            </div>
        `;
        return;
    }

    const groups = {};
    filteredTransactions.forEach(t => {
        const key = transactionDateKey(t);
        if (!key) return;
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
    });

    let html = '';
    const sortedKeys = Object.keys(groups).sort((a, b) => sortDesc ? b.localeCompare(a) : a.localeCompare(b));

    sortedKeys.forEach(dateKey => {
        const dateLabel = formatDateGroupLabel(dateKey);
        html += `<div class="date-group-header">${dateLabel}</div>`;

        groups[dateKey].forEach(t => {
            const icon = typeEmojis[t.type] || '📦';
            const formattedAmount = t.formattedAmount || formatRupiah(t.amount);
            const paidByBadge = t.paidBy && t.paidBy !== 'Self'
                ? `<span class="text-[10px] bg-bg-tertiary text-text-secondary py-0.5 px-1.5 rounded">${escapeHtml(t.paidBy)}</span>`
                : '';

            // Render one row for the transaction. A split is filtered by its
            // shares, but its parent amount is still displayed exactly once.
            let pocketDisplay = t.pocket || 'Unknown';
            let multiBadge = '';
            if (isSplitTransaction(t)) {
                const shares = Array.isArray(t.sourceBreakdowns) ? t.sourceBreakdowns : [];
                pocketDisplay = shares.map(b => b.pocket).filter(Boolean).join(' + ') || pocketDisplay;
                if (shares.length > 1) {
                    multiBadge = `<span class="text-[10px] bg-primary/15 text-primary py-0.5 px-1.5 rounded font-semibold ml-1">🔀 Multi (${shares.length})</span>`;
                }
            }

            html += `
                <a class="trans-item" href="/log-spending?edit=${encodeURIComponent(t._id)}">
                    <div class="trans-icon">${escapeHtml(icon)}</div>
                    <div class="flex-1 min-w-0">
                        <div class="font-semibold text-sm text-text-primary mb-0.5 flex items-center gap-1.5 flex-wrap">
                            ${escapeHtml(t.ngapain || 'No Description')}
                            ${paidByBadge}
                            ${multiBadge}
                        </div>
                        <div class="text-xs text-text-muted">${escapeHtml(t.type)} • ${escapeHtml(pocketDisplay)}</div>
                    </div>
                    <div class="font-bold text-sm text-coral whitespace-nowrap ml-2">- ${formattedAmount}</div>
                </a>
            `;
        });
    });

    list.innerHTML = html;
}

// Notes, types and pocket names are household-entered text.
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
