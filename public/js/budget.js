// Budget Page JavaScript

let currentMonth, currentYear;
let canEdit = false;
let selectedPocket = null;
let budgetPieChart = null;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize with current month
    const now = new Date();
    currentMonth = now.getMonth() + 1;
    currentYear = now.getFullYear();
    canEdit = document.getElementById('canEdit').value === 'true';

    updateMonthDisplay();
    loadBudgets();

    // Month navigation
    document.getElementById('prevMonth').addEventListener('click', () => navigateMonth(-1));
    document.getElementById('nextMonth').addEventListener('click', () => navigateMonth(1));
});

function updateMonthDisplay() {
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    document.getElementById('currentMonth').textContent = `${monthNames[currentMonth - 1]} ${currentYear}`;
}

function navigateMonth(direction) {
    currentMonth += direction;
    if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
    } else if (currentMonth < 1) {
        currentMonth = 12;
        currentYear--;
    }
    updateMonthDisplay();
    loadBudgets();
}

async function loadBudgets() {
    try {
        const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        const response = await fetch(`/api/budget?month=${monthStr}`);
        const result = await response.json();

        if (result.success) {
            renderBudgets(result.data);
        } else {
            showToast('Error loading budgets', 'error');
        }
    } catch (error) {
        console.error('Load budgets error:', error);
        showToast('Network error', 'error');
    }
}

function renderBudgets(data) {
    const list = document.getElementById('budgetList');
    const isEditable = data.canEdit;

    // Render Health Summary with Pie Chart
    renderHealthSummary(data);

    if (data.pockets.length === 0) {
        list.innerHTML = '<p class="text-center text-text-muted py-5">No pockets configured</p>';
        return;
    }

    const statusColor = (s) => s === 'danger' ? 'text-coral' : s === 'warning' ? 'text-amber' : 'text-lime';
    const barColor = (s) => s === 'danger' ? 'bg-coral' : s === 'warning' ? 'bg-amber' : 'bg-lime';

    list.innerHTML = data.pockets.map(pocket => `
        <div class="bg-bg-secondary p-4 rounded-2xl flex items-center justify-between shadow-card border border-border/50 ${pocket.closed ? 'opacity-50' : ''} ${isEditable && !pocket.closed ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-card-hover transition-all duration-200' : ''}" 
             onclick="${isEditable && !pocket.closed ? `openEditModal('${pocket.pocket}', '${pocket.icon}', ${pocket.budget})` : ''}">
            <div class="flex-1">
                <div class="flex items-center gap-2.5 mb-2">
                    <span class="text-2xl">${pocket.icon}</span>
                    <span class="text-sm font-semibold text-text-primary">${pocket.pocket}</span>
                    ${pocket.closed ? '<span class="text-xs bg-coral/20 text-coral px-2 py-0.5 rounded-full font-bold">🔒 Closed</span>' : ''}
                </div>
                <div class="progress-track">
                    <div class="progress-fill ${barColor(pocket.status)}" style="width: ${Math.min(pocket.percentage, 100)}%"></div>
                </div>
                <div class="flex justify-between text-[11px] mt-1.5">
                    <span class="text-text-muted">${pocket.formattedSpent} spent</span>
                    <span class="${pocket.isOver ? 'text-coral' : 'text-lime'}">${pocket.isOver ? '-' : ''}${pocket.formattedRemaining} left</span>
                </div>
            </div>
            <div class="text-right min-w-[80px] ml-3">
                <span class="text-base font-bold ${pocket.budget === 0 ? 'text-text-muted' : 'text-text-primary'} block">
                    ${pocket.budget === 0 ? 'Rp 0' : pocket.formattedBudget}
                </span>
                <span class="text-xs font-bold ${statusColor(pocket.status)} block mt-1">${pocket.percentage}%</span>
                ${isEditable && pocket._id ? `
                    <button class="text-[10px] font-bold mt-1.5 px-2 py-1 rounded-lg border transition-colors ${pocket.closed ? 'text-lime border-lime/30 hover:bg-lime/10' : 'text-coral border-coral/30 hover:bg-coral/10'}" 
                        onclick="event.stopPropagation(); toggleClose('${pocket._id}', ${pocket.closed})">
                        ${pocket.closed ? '🔓 Reopen' : '🔒 Close'}
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function renderHealthSummary(data) {
    // Distinct color palette — auto-assigned per pocket
    const chartColors = [
        '#FF4D6D', '#7C3AED', '#22C55E', '#F59E0B', '#06B6D4',
        '#F97316', '#3B82F6', '#EC4899', '#FBBF24', '#14B8A6'
    ];

    // Build chart data from pockets
    const pocketsWithBudget = data.pockets.filter(p => p.budget > 0);
    const labels = pocketsWithBudget.map(p => `${p.icon} ${p.pocket}`);
    const values = pocketsWithBudget.map(p => p.budget);
    const colors = pocketsWithBudget.map((_, i) => chartColors[i % chartColors.length]);

    // Create/update pie chart
    const ctx = document.getElementById('budgetPieChart');
    if (ctx) {
        if (budgetPieChart) {
            budgetPieChart.destroy();
        }

        if (pocketsWithBudget.length > 0) {
            budgetPieChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: colors,
                        borderWidth: 2,
                        borderColor: '#1E293B',
                        hoverBorderWidth: 3,
                        hoverOffset: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    cutout: '60%',
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
                            titleFont: { family: 'Plus Jakarta Sans', weight: '600', size: 13 },
                            bodyFont: { family: 'Plus Jakarta Sans', size: 12 },
                            cornerRadius: 10,
                            padding: 12,
                            callbacks: {
                                label: function (context) {
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const pct = Math.round((context.parsed / total) * 100);
                                    return ` Rp ${context.parsed.toLocaleString('id-ID')} (${pct}%)`;
                                }
                            }
                        }
                    },
                    animation: {
                        animateRotate: true,
                        duration: 800,
                        easing: 'easeOutQuart'
                    }
                }
            });
        }
    }

    // Update total budget display
    document.getElementById('totalBudgetDisplay').textContent = data.formattedTotal;
    document.getElementById('totalSpentDisplay').textContent = data.formattedSpent;
    document.getElementById('totalRemainingDisplay').textContent =
        (data.isOverBudget ? '-' : '') + data.formattedRemaining;

    // Update remaining color based on status
    const remainingEl = document.getElementById('totalRemainingDisplay');
    if (data.isOverBudget) {
        remainingEl.className = 'text-sm font-bold text-coral';
    } else {
        remainingEl.className = 'text-sm font-bold text-lime';
    }
}

function openEditModal(pocket, icon, budget) {
    if (!canEdit) return;

    selectedPocket = pocket;
    document.getElementById('modalPocket').textContent = `${icon} ${pocket}`;
    document.getElementById('budgetInput').value = budget || '';
    document.getElementById('editModal').classList.add('show');
    document.getElementById('budgetInput').focus();
}

function closeModal() {
    document.getElementById('editModal').classList.remove('show');
    selectedPocket = null;
}

async function saveBudget() {
    const budget = document.getElementById('budgetInput').value;

    if (!budget || budget < 0) {
        showToast('Please enter a valid budget', 'error');
        return;
    }

    try {
        const response = await fetch('/api/budget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pocket: selectedPocket,
                month: currentMonth,
                year: currentYear,
                budget: parseFloat(budget)
            })
        });

        const result = await response.json();

        if (result.success) {
            showToast('Budget saved!', 'success');
            closeModal();
            loadBudgets();
        } else {
            showToast(result.message || 'Error saving', 'error');
        }
    } catch (error) {
        console.error('Save budget error:', error);
        showToast('Network error', 'error');
    }
}

async function showHistory() {
    document.getElementById('historyModal').classList.add('show');
    document.getElementById('historyList').innerHTML = '<p class="text-center text-text-muted py-5">Loading...</p>';

    try {
        const response = await fetch('/api/budget/history');
        const result = await response.json();

        if (result.success && result.data.length > 0) {
            document.getElementById('historyList').innerHTML = result.data.map(item => `
                <div class="flex justify-between p-3.5 border-b border-border cursor-pointer hover:bg-bg-tertiary transition-colors" onclick="goToMonth(${item.month}, ${item.year})">
                    <span class="font-semibold text-text-primary">${item.monthLabel}</span>
                    <span class="font-bold text-text-primary">${item.formattedTotal}</span>
                </div>
            `).join('');
        } else {
            document.getElementById('historyList').innerHTML = '<p class="text-center text-text-muted py-5">No history yet</p>';
        }
    } catch (error) {
        document.getElementById('historyList').innerHTML = '<p class="text-center text-coral py-5">Error loading</p>';
    }
}

function closeHistoryModal() {
    document.getElementById('historyModal').classList.remove('show');
}

function goToMonth(month, year) {
    currentMonth = month;
    currentYear = year;
    updateMonthDisplay();
    loadBudgets();
    closeHistoryModal();
}

// Close modal on outside click
document.addEventListener('click', (e) => {
    const editModal = document.getElementById('editModal');
    const historyModal = document.getElementById('historyModal');

    if (e.target === editModal) closeModal();
    if (e.target === historyModal) closeHistoryModal();
});

// Toggle close/reopen a budget pocket
async function toggleClose(budgetId, currentlyClosed) {
    const action = currentlyClosed ? 'reopen' : 'close';
    if (!confirm(`Are you sure you want to ${action} this budget pocket?`)) return;

    try {
        const response = await fetch(`/api/budget/${budgetId}/toggle-close`, { method: 'PATCH' });
        const result = await response.json();

        if (result.success) {
            showToast(result.message, 'success');
            loadBudgets();
        } else {
            showToast(result.message || 'Error', 'error');
        }
    } catch (error) {
        console.error('Toggle close error:', error);
        showToast('Network error', 'error');
    }
}
