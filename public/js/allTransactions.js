// All Transactions Page Logic

const typeEmojis = {
    'Eat': '🍽️', 'Snack': '🍿', 'Groceries': '🛒', 'Laundry': '🧺',
    'Bensin': '⛽', 'Flazz': '💳', 'Home Appliance': '🏠', 'Jumat Berkah': '🤲',
    'Uang Sampah': '🗑️', 'Uang Keamanan': '👮', 'Medicine': '💊', 'Others': '📦'
};

const allTypes = Object.keys(typeEmojis);

let allTransactions = [];
let filteredTransactions = [];
let currentMonth = '';
let currentType = 'all';
let sortDesc = true;

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    currentMonth = params.get('month') || new Date().toISOString().slice(0, 7);

    const monthFilter = document.getElementById('monthFilter');
    monthFilter.value = currentMonth;

    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.href = '/transactions';
    }

    buildFilterPills();
    fetchTransactions();

    monthFilter.addEventListener('change', (e) => {
        currentMonth = e.target.value;
        const url = new URL(window.location);
        url.searchParams.set('month', currentMonth);
        window.history.replaceState({}, '', url);
        fetchTransactions();
    });
});

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

function selectType(type) {
    currentType = type;
    document.querySelectorAll('.filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.type === type);
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
        const response = await fetch(`/api/transactions?month=${currentMonth}`);
        allTransactions = await response.json();
        applyFilterAndRender();
    } catch (error) {
        console.error('Error fetching transactions:', error);
        list.innerHTML = '<div class="empty-state"><div class="text-5xl mb-3">❌</div><div class="text-[15px] font-medium">Failed to load transactions</div></div>';
    }
}

function applyFilterAndRender() {
    if (currentType === 'all') {
        filteredTransactions = [...allTransactions];
    } else {
        filteredTransactions = allTransactions.filter(t => t.type === currentType);
    }

    filteredTransactions.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortDesc ? dateB - dateA : dateA - dateB;
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

function formatRupiah(num) {
    return 'Rp ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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
        const date = new Date(t.date);
        const key = date.toISOString().slice(0, 10);
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
    });

    let html = '';
    const sortedKeys = Object.keys(groups).sort((a, b) => sortDesc ? b.localeCompare(a) : a.localeCompare(b));

    sortedKeys.forEach(dateKey => {
        const date = new Date(dateKey + 'T00:00:00');
        const dateLabel = date.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
        html += `<div class="date-group-header">${dateLabel}</div>`;

        groups[dateKey].forEach(t => {
            const icon = typeEmojis[t.type] || '📦';
            const formattedAmount = t.formattedAmount || formatRupiah(t.amount);
            const paidByBadge = t.paidBy && t.paidBy !== 'Self'
                ? `<span class="text-[10px] bg-bg-tertiary text-text-secondary py-0.5 px-1.5 rounded">${t.paidBy}</span>`
                : '';
            const safeNote = (t.ngapain || '').replace(/'/g, "\\'");

            html += `
                <div class="trans-item" onclick="openOptions('${t._id}', '${safeNote}', ${t.amount})">
                    <div class="trans-icon">${icon}</div>
                    <div class="flex-1 min-w-0">
                        <div class="font-semibold text-sm text-text-primary mb-0.5 flex items-center gap-1.5 flex-wrap">
                            ${t.ngapain || 'No Description'}
                            ${paidByBadge}
                        </div>
                        <div class="text-xs text-text-muted">${t.type} • ${t.pocket || 'Unknown'}</div>
                    </div>
                    <div class="font-bold text-sm text-coral whitespace-nowrap ml-2">- ${formattedAmount}</div>
                </div>
            `;
        });
    });

    list.innerHTML = html;
}

// Delete Logic
let deleteId = null;

function openOptions(id, note, amount) {
    deleteId = id;
    const modal = document.getElementById('deleteModal');
    const formatted = typeof amount === 'number' ? formatRupiah(amount) : amount;
    document.getElementById('deleteDetails').innerText = `${note} - ${formatted}`;
    modal.classList.add('show');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('show');
}

async function confirmDelete() {
    if (!deleteId) return;
    try {
        const response = await fetch(`/api/transaction/${deleteId}`, { method: 'DELETE' });
        if (response.ok) {
            closeDeleteModal();
            fetchTransactions();
        }
    } catch (error) {
        console.error(error);
    }
}
