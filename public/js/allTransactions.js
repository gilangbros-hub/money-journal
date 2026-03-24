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
let sortDesc = true; // true = newest first

document.addEventListener('DOMContentLoaded', () => {
    // Read month from URL query param or default to current month
    const params = new URLSearchParams(window.location.search);
    currentMonth = params.get('month') || new Date().toISOString().slice(0, 7);

    const monthFilter = document.getElementById('monthFilter');
    monthFilter.value = currentMonth;

    // Update back button to pass month back to dashboard
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.href = '/transactions';
    }

    // Build filter pills
    buildFilterPills();

    // Fetch data
    fetchTransactions();

    // Listeners
    monthFilter.addEventListener('change', (e) => {
        currentMonth = e.target.value;
        // Update URL without reload
        const url = new URL(window.location);
        url.searchParams.set('month', currentMonth);
        window.history.replaceState({}, '', url);
        fetchTransactions();
    });
});

function buildFilterPills() {
    const container = document.getElementById('filterPills');
    // "All" pill is already in HTML, add type pills
    allTypes.forEach(type => {
        const btn = document.createElement('button');
        btn.className = 'filter-pill';
        btn.dataset.type = type;
        btn.textContent = `${typeEmojis[type]} ${type}`;
        btn.addEventListener('click', () => selectType(type));
        container.appendChild(btn);
    });

    // Attach click to the existing "All" pill
    container.querySelector('[data-type="all"]').addEventListener('click', () => selectType('all'));

    // Sort button
    document.getElementById('sortBtn').addEventListener('click', toggleSort);
}

function selectType(type) {
    currentType = type;

    // Update active pill
    document.querySelectorAll('.filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.type === type);
    });

    applyFilterAndRender();
}

function toggleSort() {
    sortDesc = !sortDesc;
    const btn = document.getElementById('sortBtn');
    btn.classList.toggle('asc', !sortDesc);
    btn.innerHTML = sortDesc
        ? '<span class="sort-icon">↓</span> Newest'
        : '<span class="sort-icon">↑</span> Oldest';

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
        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-text">Failed to load transactions</div></div>';
    }
}

function applyFilterAndRender() {
    // Filter by type
    if (currentType === 'all') {
        filteredTransactions = [...allTransactions];
    } else {
        filteredTransactions = allTransactions.filter(t => t.type === currentType);
    }

    // Sort
    filteredTransactions.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortDesc ? dateB - dateA : dateA - dateB;
    });

    // Update summary
    updateSummary();

    // Render
    renderTransactions();
}

function updateSummary() {
    const count = filteredTransactions.length;
    const total = filteredTransactions.reduce((sum, t) => sum + t.amount, 0);

    document.querySelector('.summary-count').textContent = `${count} transaction${count !== 1 ? 's' : ''}`;
    document.querySelector('.summary-total').textContent = formatRupiah(total);
}

function formatRupiah(num) {
    return 'Rp ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function renderTransactions() {
    const list = document.getElementById('transactionList');

    if (filteredTransactions.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No transactions found</div>
            </div>
        `;
        return;
    }

    // Group transactions by date
    const groups = {};
    filteredTransactions.forEach(t => {
        const date = new Date(t.date);
        const key = date.toISOString().slice(0, 10);
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
    });

    // Build HTML with date headers
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
                ? `<span class="paid-by-badge">${t.paidBy}</span>`
                : '';
            const safeNote = (t.ngapain || '').replace(/'/g, "\\'");

            html += `
                <div class="trans-card" onclick="openOptions('${t._id}', '${safeNote}', ${t.amount})">
                    <div class="trans-card-icon">${icon}</div>
                    <div class="trans-card-info">
                        <div class="trans-card-title">
                            ${t.ngapain || 'No Description'}
                            ${paidByBadge}
                        </div>
                        <div class="trans-card-meta">${t.type} • ${t.pocket || 'Unknown'}</div>
                    </div>
                    <div class="trans-card-amount">- ${formattedAmount}</div>
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
            fetchTransactions(); // Refresh
        }
    } catch (error) {
        console.error(error);
    }
}
