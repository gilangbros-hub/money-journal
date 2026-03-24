let dashboardData = null;
let currentMonth = new Date().toISOString().slice(0, 7);

// Emoji Mappings
const typeEmojis = {
    'Eat': '🍽️', 'Snack': '🍿', 'Groceries': '🛒', 'Laundry': '🧺',
    'Bensin': '⛽', 'Flazz': '💳', 'Home Appliance': '🏠', 'Jumat Berkah': '🤲',
    'Uang Sampah': '🗑️', 'Uang Keamanan': '👮', 'Medicine': '💊', 'Others': '📦'
};

document.addEventListener('DOMContentLoaded', () => {
    const monthFilter = document.getElementById('monthFilter');
    monthFilter.value = currentMonth;

    // Initial Load
    fetchDashboardData();

    // Listeners
    monthFilter.addEventListener('change', (e) => {
        currentMonth = e.target.value;
        fetchDashboardData();
    });
});

async function fetchDashboardData() {
    try {
        const response = await fetch(`/api/dashboard/summary?month=${currentMonth}`);
        const result = await response.json();

        if (result.success) {
            dashboardData = result.data;
            updateDashboardUI();
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

function updateDashboardUI() {
    // 1. Render Total
    document.getElementById('totalAmount').textContent = dashboardData.total.formatted;

    // 2. Render Monthly Comparison
    renderComparison(dashboardData.comparison);

    // 3. Render Spending Pie Chart
    renderSpendingChart();

    // 4. Render Categories
    renderCategoryList();

    // 5. Render Recent History (Default view)
    renderTransactionList(dashboardData.recent, false);

    // 6. Update View All link with current month
    const viewAllLink = document.getElementById('viewAllLink');
    if (viewAllLink) {
        viewAllLink.href = `/all-transactions?month=${currentMonth}`;
    }

    // Reset Header
    const header = document.getElementById('recentTransactionsHeader');
    if (header) {
        header.textContent = 'Recent Transactions';
        if (header.nextElementSibling) {
            header.nextElementSibling.style.display = 'flex';
        }
    }
}

function renderComparison(comparison) {
    const card = document.getElementById('comparisonCard');
    const icon = document.getElementById('comparisonIcon');
    const value = document.getElementById('comparisonValue');

    if (!comparison || !comparison.hasLastMonth) {
        card.style.display = 'none';
        return;
    }

    card.style.display = 'flex';

    if (comparison.increased) {
        icon.textContent = '📈';
        value.textContent = `▲ +${comparison.difference} (${comparison.percentChange}% more)`;
        value.className = 'text-base font-bold text-coral';
    } else {
        icon.textContent = '📉';
        value.textContent = `▼ -${comparison.difference} (${comparison.percentChange}% less)`;
        value.className = 'text-base font-bold text-lime';
    }
}

// Global chart instance
let spendingChart = null;

// Chart color palette — Neon
const chartColors = [
    '#FF4D6D', '#7C3AED', '#22C55E', '#F59E0B', '#06B6D4',
    '#F97316', '#3B82F6', '#EC4899', '#FBBF24', '#14B8A6'
];

function renderSpendingChart() {
    const canvas = document.getElementById('spendingChart');
    const legendContainer = document.getElementById('chartLegend');
    const { categories, total } = dashboardData;

    if (!categories || categories.length === 0) {
        canvas.parentElement.style.display = 'none';
        legendContainer.innerHTML = '<p class="text-center text-text-muted">No data yet</p>';
        return;
    }

    canvas.parentElement.style.display = 'block';

    const labels = categories.map(c => c.category);
    const data = categories.map(c => c.total);
    const percentages = categories.map(c => c.percentage || 0);

    if (spendingChart) {
        spendingChart.destroy();
    }

    spendingChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: chartColors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#1E293B'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#1E293B',
                    titleColor: '#F8FAFC',
                    bodyColor: '#94A3B8',
                    borderColor: '#334155',
                    borderWidth: 1,
                    callbacks: {
                        label: function (context) {
                            const value = context.raw;
                            const pct = percentages[context.dataIndex];
                            return ` ${formatRupiah(value)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '60%'
        }
    });

    legendContainer.innerHTML = categories.map((cat, i) => `
        <div class="legend-item">
            <span class="w-2.5 h-2.5 rounded flex-shrink-0" style="background: ${chartColors[i % chartColors.length]}"></span>
            <span class="flex-1 text-text-secondary font-medium whitespace-nowrap overflow-hidden text-ellipsis">${cat.icon || typeEmojis[cat.category] || '📦'} ${cat.category}</span>
            <span class="font-bold text-text-primary">${cat.percentage}%</span>
        </div>
    `).join('');
}


function formatRupiah(num) {
    return 'Rp ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}


function renderCategoryList() {
    const categoryList = document.getElementById('categoryList');
    const { categories, total } = dashboardData;

    if (categories.length === 0) {
        categoryList.innerHTML = '<p class="text-center text-text-muted mt-5">No spending this month yet!</p>';
        return;
    }

    const allCard = `
        <div class="category-item border border-border" onclick="resetFilter()" style="cursor: pointer;">
            <div class="cat-icon">♾️</div>
            <div class="flex-1">
                <div class="flex justify-between mb-1.5">
                    <span class="font-semibold text-[15px] text-text-primary">Show All</span>
                    <span class="font-bold text-[15px] text-text-primary">${total.formatted}</span>
                </div>
            </div>
        </div>
    `;

    categoryList.innerHTML = allCard + categories.map((cat, i) => {
        const barColor = chartColors[i % chartColors.length];
        return `
            <div class="category-item" onclick="filterByCategory('${cat.category}')" style="cursor: pointer;">
                <div class="cat-icon">${cat.icon}</div>
                <div class="flex-1">
                    <div class="flex justify-between mb-1.5">
                        <span class="font-semibold text-[15px] text-text-primary">${cat.category}</span>
                        <span class="font-bold text-[15px] text-text-primary">${cat.formattedTotal}</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${cat.percentage < 5 ? 5 : cat.percentage}%; background: ${barColor};"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function resetFilter() {
    const header = document.getElementById('recentTransactionsHeader');
    if (header) {
        header.textContent = 'Recent Transactions';
        if (header.nextElementSibling) {
            header.nextElementSibling.style.display = 'flex';
        }
    }
    fetchAllTransactionsForMonth();
}

async function fetchAllTransactionsForMonth() {
    const list = document.getElementById('historyList');
    list.innerHTML = '<p class="text-center py-5 text-text-muted">Loading all...</p>';

    try {
        const response = await fetch(`/api/transactions?month=${currentMonth}`);
        const transactions = await response.json();

        const header = document.getElementById('recentTransactionsHeader');
        if (header) header.textContent = 'All Transactions';

        renderTransactionList(transactions, true);
    } catch (e) {
        console.error(e);
        renderTransactionList(dashboardData.recent, false);
    }
}

async function filterByCategory(category) {
    const list = document.getElementById('historyList');
    list.innerHTML = '<p class="text-center py-5 text-text-muted">Loading...</p>';

    try {
        const response = await fetch(`/api/transactions?month=${currentMonth}&type=${category}`);

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const transactions = await response.json();

        const header = document.getElementById('recentTransactionsHeader');
        if (header) {
            header.textContent = `${category} Transactions`;
            if (header.nextElementSibling) {
                header.nextElementSibling.style.display = 'none';
            }
        }

        if (Array.isArray(transactions)) {
            renderTransactionList(transactions, true);
        } else {
            throw new Error('Invalid data format received from API');
        }

    } catch (error) {
        console.error('Error fetching category transactions:', error);
        list.innerHTML = `<p class="text-center text-coral">Error loading data: ${error.message}</p>`;
    }
}

function renderTransactionList(transactions, isFullList) {
    const list = document.getElementById('historyList');

    if (transactions.length === 0) {
        list.innerHTML = '<p class="text-center py-5 text-text-muted">No transactions found.</p>';
        return;
    }

    list.innerHTML = transactions.map(t => {
        try {
            const date = new Date(t.date);
            const dateStr = isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

            const formattedAmount = t.formattedAmount || `Rp ${Number(t.amount).toLocaleString('id-ID')}`;
            const icon = typeEmojis[t.type] || '📦';
            const paidByLabel = t.paidBy && t.paidBy !== 'Self' ? `<span class="text-[10px] bg-bg-tertiary text-text-secondary py-0.5 px-1.5 rounded ml-1.5">${t.paidBy}</span>` : '';

            return `
                <div class="trans-item" onclick="openOptions('${t._id}', '${t.ngapain ? t.ngapain.replace(/'/g, "\\'") : ""}', ${t.amount})">
                    <div class="trans-icon">${icon}</div>
                    <div class="flex-1 min-w-0">
                        <div class="font-semibold text-sm text-text-primary mb-0.5 flex items-center gap-1.5 flex-wrap">
                            ${t.ngapain || 'No Description'}
                            ${paidByLabel}
                        </div>
                        <div class="text-xs text-text-muted">${dateStr} • ${t.pocket || 'Unknown'}</div>
                    </div>
                    <div class="font-bold text-sm text-coral whitespace-nowrap ml-2">- ${formattedAmount}</div>
                </div>
            `;
        } catch (err) {
            console.error('Error rendering item:', t, err);
            return '';
        }
    }).join('');
}

// Delete Logic
let deleteId = null;
function openOptions(id, note, amount) {
    deleteId = id;
    const modal = document.getElementById('deleteModal');
    const formatted = typeof amount === 'number' ? `Rp ${amount.toLocaleString('id-ID')}` : amount;
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
            fetchDashboardData();
        }
    } catch (error) {
        console.error(error);
    }
}

async function exportToCSV() {
    try {
        const response = await fetch(`/api/transactions?month=${currentMonth}`);
        const transactions = await response.json();

        if (transactions.length === 0) {
            alert("No transactions to export!");
            return;
        }

        const csvRows = [];
        csvRows.push(['Date', 'Type', 'Pocket', 'Description', 'Amount', 'Paid By', 'Submitted By']);

        transactions.forEach(t => {
            const date = new Date(t.date);
            const dateStr = date.toLocaleDateString('en-GB');
            const safeDesc = `"${t.ngapain.replace(/"/g, '""')}"`;

            csvRows.push([
                dateStr,
                t.type,
                t.pocket,
                safeDesc,
                t.amount,
                t.paidBy || 'Self',
                t.by || 'Unknown'
            ]);
        });

        const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `MoneyJournal_${currentMonth}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (error) {
        console.error('Export failed:', error);
        alert('Failed to export data');
    }
}
