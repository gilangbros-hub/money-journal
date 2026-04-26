let dashboardData = null;
let monthTransactions = [];
let currentMonth = new Date().toISOString().slice(0, 7);

const typeEmojis = {
    Eat: '🍽️',
    Snack: '🍿',
    Groceries: '🛒',
    Laundry: '🧺',
    Bensin: '⛽',
    Flazz: '💳',
    'Home Appliance': '🏠',
    'Jumat Berkah': '🤲',
    'Uang Sampah': '🗑️',
    'Uang Keamanan': '👮',
    Medicine: '💊',
    Others: '📦'
};

async function determineDefaultMonth() {
    const now = new Date();
    let targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    try {
        const response = await fetch('/api/budget/closed-months');
        const result = await response.json();
        
        if (result.success && result.data) {
            const closedKeys = result.data.map(m => m.key);
            
            if (closedKeys.includes(targetMonth)) {
                let found = false;
                for (let i = 1; i <= 12; i++) {
                    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    if (!closedKeys.includes(key)) {
                        targetMonth = key;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    for (let i = 1; i <= 12; i++) {
                        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                        if (!closedKeys.includes(key)) {
                            targetMonth = key;
                            found = true;
                            break;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error fetching closed months:', e);
    }
    return targetMonth;
}

document.addEventListener('DOMContentLoaded', async () => {
    const monthFilter = document.getElementById('monthFilter');
    
    currentMonth = await determineDefaultMonth();
    monthFilter.value = currentMonth;

    monthFilter.addEventListener('change', (e) => {
        currentMonth = e.target.value;
        loadJournalData();
    });

    const jumpBtn = document.getElementById('jumpToTodayBtn');
    if (jumpBtn) {
        jumpBtn.addEventListener('click', async () => {
            currentMonth = await determineDefaultMonth();
            monthFilter.value = currentMonth;
            loadJournalData();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    loadJournalData();
});

async function loadJournalData() {
    try {
        const [summaryResponse, txResponse] = await Promise.all([
            fetch(`/api/dashboard/summary?month=${currentMonth}`),
            fetch(`/api/transactions?month=${currentMonth}`)
        ]);

        const summaryResult = await summaryResponse.json();
        const txResult = await txResponse.json();

        if (!summaryResult.success) {
            throw new Error('Failed to load summary');
        }

        dashboardData = summaryResult.data;
        monthTransactions = Array.isArray(txResult) ? txResult : [];
        monthTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        renderHero();
        renderStoryCards();
        renderTodayTimeline();
        renderPocketPulse();
        renderSpendingChart();
        renderMonthFeed();
    } catch (error) {
        console.error('Journal load error:', error);
        showToast('Failed to load journal data', 'error');
    }
}

function renderHero() {
    const totalEl = document.getElementById('totalAmount');
    const todayEl = document.getElementById('todayAmount');
    const entryEl = document.getElementById('entryCount');
    const nudgeEl = document.getElementById('monthNudge');

    totalEl.textContent = dashboardData.total.formatted;

    const todayKey = getLocalDateKey(new Date());
    const todayTx = monthTransactions.filter((item) => getLocalDateKey(new Date(item.date)) === todayKey);
    const todayTotal = todayTx.reduce((sum, item) => sum + (item.amount || 0), 0);

    todayEl.textContent = formatRupiah(todayTotal);
    entryEl.textContent = String(monthTransactions.length);
    nudgeEl.textContent = buildNudgeText(dashboardData.comparison);
}

function buildNudgeText(comparison) {
    if (!comparison || !comparison.hasLastMonth) return 'Fresh month';
    if (comparison.increased) return `${comparison.percentChange}% above last month`;
    return `${comparison.percentChange}% calmer than last month`;
}

function renderStoryCards() {
    const comparisonEl = document.getElementById('comparisonValue');
    const topCategoryEl = document.getElementById('topCategory');
    const topCategoryAmountEl = document.getElementById('topCategoryAmount');
    const topCategory = dashboardData.categories?.[0];

    if (!dashboardData.comparison || !dashboardData.comparison.hasLastMonth) {
        comparisonEl.textContent = 'No prior month baseline yet';
    } else if (dashboardData.comparison.increased) {
        comparisonEl.textContent = `▲ +${dashboardData.comparison.difference} (${dashboardData.comparison.percentChange}%)`;
    } else {
        comparisonEl.textContent = `▼ -${dashboardData.comparison.difference} (${dashboardData.comparison.percentChange}%)`;
    }

    if (topCategory) {
        topCategoryEl.textContent = `${topCategory.icon || typeEmojis[topCategory.category] || '📦'} ${topCategory.category}`;
        topCategoryAmountEl.textContent = `${topCategory.formattedTotal} (${topCategory.percentage}%)`;
    } else {
        topCategoryEl.textContent = 'No category yet';
        topCategoryAmountEl.textContent = 'Start logging to see pattern';
    }
}

function renderTodayTimeline() {
    const target = document.getElementById('todayTimeline');
    const todayKey = getLocalDateKey(new Date());
    const todayTx = monthTransactions.filter((item) => getLocalDateKey(new Date(item.date)) === todayKey);

    if (todayTx.length === 0) {
        target.innerHTML = '<p class="text-center text-text-muted py-5">No entries yet today. Add one while it is fresh.</p>';
        return;
    }

    target.innerHTML = todayTx
        .slice(0, 6)
        .map((item) => renderTimelineRow(item))
        .join('');
}

function renderMonthFeed() {
    const list = document.getElementById('historyList');
    if (monthTransactions.length === 0) {
        list.innerHTML = '<p class="text-center text-text-muted py-5">No transactions for this month.</p>';
        return;
    }

    const groups = groupByDate(monthTransactions);
    const sortedKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    list.innerHTML = sortedKeys
        .map((dateKey) => {
            const label = formatDateGroupLabel(dateKey);
            const rows = groups[dateKey].map((item) => renderFeedRow(item)).join('');
            return `
                <div class="journal-date-group">
                    <p class="date-group-header">${label}</p>
                    <div class="journal-group-rows">${rows}</div>
                </div>
            `;
        })
        .join('');
}

function renderTimelineRow(item) {
    return `
        <article class="journal-row compact">
            <div class="journal-row-icon">${typeEmojis[item.type] || '📦'}</div>
            <div class="journal-row-body">
                <p class="journal-row-title">${safeText(item.ngapain || 'No description')}</p>
                <p class="journal-row-meta">${safeText(item.pocket || 'Unknown')}</p>
            </div>
            <p class="journal-row-amount">- ${item.formattedAmount || formatRupiah(item.amount)}</p>
        </article>
    `;
}

function renderFeedRow(item) {
    const escapedNote = (item.ngapain || '').replace(/'/g, "\\'");
    const amount = Number(item.amount || 0);

    return `
        <article class="journal-row">
            <div class="journal-row-icon">${typeEmojis[item.type] || '📦'}</div>
            <div class="journal-row-body">
                <p class="journal-row-title">${safeText(item.ngapain || 'No description')}</p>
                <p class="journal-row-meta">${safeText(item.pocket || 'Unknown')}</p>
            </div>
            <div class="journal-row-right">
                <p class="journal-row-amount">- ${item.formattedAmount || formatRupiah(amount)}</p>
                <div class="journal-row-actions">
                    <a class="journal-action-link" href="/log-spending?edit=${item._id}">Edit</a>
                    <button class="journal-action-link danger" type="button" onclick="openOptions('${item._id}', '${escapedNote}', ${amount})">Delete</button>
                </div>
            </div>
        </article>
    `;
}

function renderPocketPulse() {
    const target = document.getElementById('pocketPulseList');
    const alerts = Array.isArray(dashboardData.budgetAlerts) ? dashboardData.budgetAlerts : [];

    if (alerts.length === 0) {
        target.innerHTML = '<p class="text-center text-text-muted py-5">Pockets look stable this month.</p>';
        return;
    }

    target.innerHTML = alerts
        .slice(0, 4)
        .map((alert) => `
            <article class="journal-pulse-item ${alert.status}">
                <p class="journal-pulse-title">${safeText(alert.pocket)}</p>
                <p class="journal-pulse-copy">${safeText(alert.message)}</p>
            </article>
        `)
        .join('');
}

let spendingChart = null;
function renderSpendingChart() {
    const canvas = document.getElementById('spendingChart');
    const legendContainer = document.getElementById('chartLegend');
    const { categories } = dashboardData;

    if (!categories || categories.length === 0) {
        canvas.parentElement.style.display = 'none';
        legendContainer.innerHTML = '<p class="text-center text-text-muted">No chart data yet</p>';
        return;
    }

    canvas.parentElement.style.display = 'block';
    const labels = categories.map((c) => c.category);
    const data = categories.map((c) => c.total);
    const percentages = categories.map((c) => c.percentage || 0);

    if (spendingChart) spendingChart.destroy();

    spendingChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: chartColors.slice(0, labels.length),
                    borderWidth: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1f232f',
                    titleColor: '#f8f7f5',
                    bodyColor: '#d9d7d4',
                    borderColor: '#2d3344',
                    borderWidth: 1,
                    callbacks: {
                        label: (context) => {
                            const value = context.raw;
                            const pct = percentages[context.dataIndex];
                            return ` ${formatRupiah(value)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '68%'
        }
    });

    legendContainer.innerHTML = categories
        .map((cat, index) => `
            <div class="legend-item">
                <span class="w-2.5 h-2.5 rounded flex-shrink-0" style="background: ${chartColors[index % chartColors.length]}"></span>
                <span class="flex-1 text-text-secondary font-medium whitespace-nowrap overflow-hidden text-ellipsis">${cat.icon || typeEmojis[cat.category] || '📦'} ${cat.category}</span>
                <span class="font-bold text-text-primary">${cat.percentage}%</span>
            </div>
        `)
        .join('');
}

function groupByDate(transactions) {
    return transactions.reduce((acc, item) => {
        const key = getLocalDateKey(new Date(item.date));
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});
}

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateGroupLabel(dateKey) {
    const today = getLocalDateKey(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getLocalDateKey(yesterdayDate);

    if (dateKey === today) return 'Today';
    if (dateKey === yesterday) return 'Yesterday';

    const date = new Date(`${dateKey}T00:00:00`);
    return date.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short'
    });
}

// Time formatting removed as requested

function safeText(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

let deleteId = null;
function openOptions(id, note, amount) {
    deleteId = id;
    const formatted = typeof amount === 'number' ? formatRupiah(amount) : amount;
    document.getElementById('deleteDetails').innerText = `${note} - ${formatted}`;
    document.getElementById('deleteModal').classList.add('show');
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
            loadJournalData();
            showToast('Transaction deleted', 'success');
        } else {
            showToast('Could not delete transaction', 'error');
        }
    } catch (error) {
        console.error(error);
        showToast('Network error', 'error');
    }
}
