let dashboardData = null;
let monthTransactions = [];
// The server owns the active Budget_Month. Keep this empty until the budget
// endpoint supplies a strict YYYY-MM value instead of using the device clock.
let currentMonth = '';

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
    const requested = new URLSearchParams(window.location.search).get('month');
    if (requested !== null) return requested;

    const response = await fetch('/api/budget');
    const result = await response.json();
    if (!response.ok || !result.success || !result.data?.budgetMonth) {
        throw new Error('Failed to load active Budget Month');
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result.data.budgetMonth)) {
        throw new Error('Server returned an invalid Budget Month');
    }
    return result.data.budgetMonth;
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
        monthTransactions.sort((a, b) => transactionDateKey(b).localeCompare(transactionDateKey(a)));

        renderPeriodMetadata();
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

function renderPeriodMetadata() {
    const period = dashboardData.period || dashboardData.salaryCyclePeriod;
    const target = document.getElementById('salaryCyclePeriod');
    if (!target || !period) return;
    target.textContent = `Budget Month ${dashboardData.budgetMonth} · Salary cycle ${period.startDate} – ${period.endDate}`;
}

function renderHero() {
    const totalEl = document.getElementById('totalAmount');
    const todayEl = document.getElementById('todayAmount');
    const entryEl = document.getElementById('entryCount');
    const nudgeEl = document.getElementById('monthNudge');

    totalEl.textContent = dashboardData.total.formatted;

    const todayKey = householdTodayKey(dashboardData.timeZone);
    const todayTx = monthTransactions.filter((item) => transactionDateKey(item) === todayKey);
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
    const todayKey = householdTodayKey(dashboardData.timeZone);
    const todayTx = monthTransactions.filter((item) => transactionDateKey(item) === todayKey);

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
        .map((alert) => {
            const scope = alert.scopeLabel || (
                alert.cadence === 'Weekly'
                    ? `Weekly · ${alert.selectedWeek || 'selected week'}`
                    : 'Monthly · salary cycle'
            );
            const title = `${alert.pocket} · ${scope}`;
            return `
            <article class="journal-pulse-item ${safeText(alert.status || '')}">
                <p class="journal-pulse-title">${safeText(title)}</p>
                <p class="journal-pulse-copy">${safeText(alert.message || `${alert.percentage || 0}% used`)}</p>
            </article>
        `;
        })
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

function transactionDateKey(transaction) {
    const value = transaction?.expenseDate || transaction?.date || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function householdTodayKey(timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function groupByDate(transactions) {
    return transactions.reduce((acc, item) => {
        const key = transactionDateKey(item);
        if (!key) return acc;
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});
}

function formatDateGroupLabel(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    if (!year || !month || !day) return dateKey;
    // Construct from explicit local components for presentation only. The
    // canonical grouping/sorting key remains the server-provided date string;
    // this never parses a date-only value as a UTC instant.
    const date = new Date(year, month - 1, day);
    const today = householdTodayKey(dashboardData?.timeZone);
    const yesterday = previousDateKey(today);

    if (dateKey === today) return 'Today';
    if (dateKey === yesterday) return 'Yesterday';

    return date.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short'
    });
}

function previousDateKey(dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return '';
    let [year, month, day] = dateKey.split('-').map(Number);
    if (day > 1) day -= 1;
    else {
        month -= 1;
        if (month < 1) {
            month = 12;
            year -= 1;
        }
        day = daysInMonth(year, month);
    }
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
    if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
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
