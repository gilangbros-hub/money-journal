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

// Started once on load; loadJournalData waits for it before rendering.
let typeEmojisReady = Promise.resolve();

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
    typeEmojisReady = loadManagedTypeEmojis();
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

        let summaryResult = await summaryResponse.json();
        const txResult = await txResponse.json();
        await typeEmojisReady;
        if (!summaryResult.success) {
            throw new Error('Failed to load summary');
        }

        // Without a week the server reports weekly pockets for the cycle's
        // first week. Ask again for the week containing today when it matters.
        const currentWeek = currentWeekToRequest(summaryResult.data);
        if (currentWeek) {
            const weekResponse = await fetch(`/api/dashboard/summary?month=${currentMonth}&selectedWeek=${encodeURIComponent(currentWeek)}`);
            const weekResult = await weekResponse.json();
            if (weekResponse.ok && weekResult.success) summaryResult = weekResult;
        }

        dashboardData = summaryResult.data;
        monthTransactions = Array.isArray(txResult) ? txResult : [];
        monthTransactions.sort((a, b) => transactionDateKey(b).localeCompare(transactionDateKey(a)));

        renderPeriodMetadata();
        renderHero();
        renderStoryCards();
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

// ---------------------------------------------------------------------------
// Hero. With a budget for the month it leads with what is left for the salary
// cycle and a daily allowance until payday; without one it keeps the plain
// spending summary.
// ---------------------------------------------------------------------------

function dateKeyToUtcDay(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
}

// Days from today through the last day of the cycle, today included (so it is
// also the number of days until payday). 0 when today is outside the cycle.
function daysLeftInCycle(period, todayKey) {
    const pattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!period || !pattern.test(period.startDate || '') || !pattern.test(period.endDate || '') || !pattern.test(todayKey)) {
        return 0;
    }
    if (todayKey < period.startDate || todayKey > period.endDate) return 0;
    return dateKeyToUtcDay(period.endDate) - dateKeyToUtcDay(todayKey) + 1;
}

function hasBudget(data) {
    return Number(data?.budget?.totalBudget) > 0 && Array.isArray(data?.budget?.pockets);
}

function renderHeroMetrics(items) {
    document.getElementById('heroMetrics').innerHTML = items.map((item) => `
        <div>
            <p class="journal-metric-label">${safeText(item.label)}</p>
            <p class="journal-metric-value" id="${item.id}">${safeText(item.value)}</p>
        </div>
    `).join('');
}

function renderHero() {
    const labelEl = document.getElementById('heroLabel');
    const totalEl = document.getElementById('totalAmount');
    const allowanceEl = document.getElementById('heroAllowance');

    const todayKey = householdTodayKey(dashboardData.timeZone);
    const todayTx = monthTransactions.filter((item) => transactionDateKey(item) === todayKey);
    const todayTotal = todayTx.reduce((sum, item) => sum + (item.amount || 0), 0);

    totalEl.classList.remove('is-over');
    allowanceEl.hidden = true;
    allowanceEl.textContent = '';

    if (!hasBudget(dashboardData)) {
        labelEl.textContent = 'This Month';
        totalEl.textContent = dashboardData.total.formatted;
        renderHeroMetrics([
            { label: 'Today', id: 'todayAmount', value: formatRupiah(todayTotal) },
            { label: 'Entries', id: 'entryCount', value: String(monthTransactions.length) },
            { label: 'Nudge', id: 'monthNudge', value: buildNudgeText(dashboardData.comparison) }
        ]);
        return;
    }

    const remaining = Number(dashboardData.budget.totalRemaining) || 0;
    const daysLeft = daysLeftInCycle(dashboardData.period || dashboardData.salaryCyclePeriod, todayKey);

    if (remaining < 0) {
        labelEl.textContent = 'Over budget this cycle';
        totalEl.textContent = formatRupiah(Math.abs(remaining));
        totalEl.classList.add('is-over');
    } else {
        labelEl.textContent = 'Left this cycle';
        totalEl.textContent = formatRupiah(remaining);
        if (daysLeft > 0) {
            const perDay = Math.floor(remaining / daysLeft);
            allowanceEl.textContent = `${formatRupiah(perDay)}/day · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to payday`;
            allowanceEl.hidden = false;
        }
    }

    renderHeroMetrics([
        { label: 'Spent', id: 'heroSpent', value: dashboardData.total.formatted },
        { label: 'Today', id: 'todayAmount', value: formatRupiah(todayTotal) },
        { label: 'Days left', id: 'heroDaysLeft', value: daysLeft > 0 ? String(daysLeft) : '–' }
    ]);
}

// The week to re-request the summary for, or '' when the default (first
// week of the cycle) is already right or there is no weekly pocket.
function currentWeekToRequest(data) {
    const budget = data?.budget;
    const weeks = Array.isArray(budget?.availableWeeks) ? budget.availableWeeks : [];
    if (!weeks.length || !budget.pockets?.some((pocket) => pocket.cadence === 'Weekly')) return '';
    const todayKey = householdTodayKey(data.timeZone);
    const week = weeks.find((item) => item.intersectionStartDate <= todayKey && todayKey <= item.intersectionEndDate);
    const shownWeek = budget.selectedWeek || weeks[0]?.key;
    return week && week.key !== shownWeek ? week.key : '';
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

const PULSE_ORDER = { danger: 0, warning: 1 };

function pulseScopeLabel(pocket, currentWeekKey) {
    if (pocket.cadence !== 'Weekly') return 'This cycle';
    const key = pocket.selectedWeek?.key || '';
    return key && key === currentWeekKey ? 'This week' : `Week ${key.replace(/^\d{4}-W/, '') || '?'}`;
}

function renderPocketPulse() {
    const target = document.getElementById('pocketPulseList');
    const alerts = Array.isArray(dashboardData.budgetAlerts) ? dashboardData.budgetAlerts : [];
    const pockets = Array.isArray(dashboardData.budget?.pockets) ? dashboardData.budget.pockets : [];

    if (pockets.length === 0) {
        renderPocketAlerts(target, alerts);
        return;
    }

    const todayKey = householdTodayKey(dashboardData.timeZone);
    const currentWeekKey = (dashboardData.budget.availableWeeks || [])
        .find((week) => week.intersectionStartDate <= todayKey && todayKey <= week.intersectionEndDate)?.key || '';

    // A pocket with no budget and no spending has nothing to say.
    target.innerHTML = pockets
        .filter((pocket) => Number(pocket.budget) > 0 || Number(pocket.spent) > 0)
        .sort((a, b) => (PULSE_ORDER[a.alertStatus] ?? 2) - (PULSE_ORDER[b.alertStatus] ?? 2))
        .map((pocket) => {
            const status = pocket.alertStatus === 'danger' || pocket.alertStatus === 'warning' ? pocket.alertStatus : '';
            const budget = Number(pocket.budget) || 0;
            const spent = Number(pocket.spent) || 0;
            const alert = status ? alerts.find((item) => item.pocket === pocket.pocket) : null;
            const width = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
            const amounts = budget > 0
                ? `${formatRupiah(spent)} / ${formatRupiah(budget)}`
                : `${formatRupiah(spent)} · no budget set`;
            return `
            <article class="journal-pulse-item ${status}">
                <div class="journal-pulse-head">
                    <p class="journal-pulse-title">${safeText(`${pocket.icon || pocket.pocketEmoji || ''} ${pocket.pocket}`.trim())}</p>
                    <p class="journal-pulse-scope">${safeText(pulseScopeLabel(pocket, currentWeekKey))}</p>
                </div>
                <p class="journal-pulse-amounts">${safeText(amounts)}</p>
                <div class="journal-pulse-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}" aria-label="${safeText(pocket.pocket)} budget used">
                    <div class="journal-pulse-fill ${status}" style="width: ${width}%"></div>
                </div>
                ${alert ? `<p class="journal-pulse-copy">${safeText(alert.message)}</p>` : ''}
            </article>
        `;
        })
        .join('');
}

// No budget pockets in the summary (legacy data): keep the alerts-only list.
function renderPocketAlerts(target, alerts) {
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
