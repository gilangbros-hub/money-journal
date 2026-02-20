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
        list.innerHTML = '<p class="loading">No pockets configured</p>';
        return;
    }

    list.innerHTML = data.pockets.map(pocket => `
        <div class="budget-item ${isEditable ? '' : 'readonly'}" 
             onclick="${isEditable ? `openEditModal('${pocket.pocket}', '${pocket.icon}', ${pocket.budget})` : ''}">
            <div class="pocket-left">
                <div class="pocket-info">
                    <span class="pocket-icon">${pocket.icon}</span>
                    <span class="pocket-name">${pocket.pocket}</span>
                </div>
                <div class="pocket-progress">
                    <div class="pocket-bar ${pocket.status}" style="width: ${Math.min(pocket.percentage, 100)}%"></div>
                </div>
                <div class="pocket-stats">
                    <span class="pocket-spent">${pocket.formattedSpent} spent</span>
                    <span class="pocket-remaining ${pocket.isOver ? 'over' : ''}">${pocket.isOver ? '-' : ''}${pocket.formattedRemaining} left</span>
                </div>
            </div>
            <div class="pocket-right">
                <span class="budget-amount ${pocket.budget === 0 ? 'zero' : ''}">
                    ${pocket.budget === 0 ? 'Rp 0' : pocket.formattedBudget}
                </span>
                <span class="budget-percentage ${pocket.status}">${pocket.percentage}%</span>
            </div>
        </div>
    `).join('');
}

function renderHealthSummary(data) {
    // Distinct color palette — auto-assigned per pocket
    const chartColors = [
        '#FF6B6B', // coral red
        '#4ECDC4', // teal
        '#45B7D1', // sky blue
        '#96CEB4', // sage green
        '#FFEAA7', // soft yellow
        '#DDA0DD', // plum
        '#98D8C8', // mint
        '#F7DC6F', // golden
        '#BB8FCE', // lavender
        '#85C1E9', // light blue
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
                        borderColor: '#FFFFFF',
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
                            backgroundColor: '#1A1A1A',
                            titleFont: { family: 'Inter', weight: '600', size: 13 },
                            bodyFont: { family: 'Inter', size: 12 },
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
        remainingEl.style.color = '#EF4444';
    } else {
        remainingEl.style.color = '#10B981';
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
    document.getElementById('historyList').innerHTML = '<p class="loading">Loading...</p>';

    try {
        const response = await fetch('/api/budget/history');
        const result = await response.json();

        if (result.success && result.data.length > 0) {
            document.getElementById('historyList').innerHTML = result.data.map(item => `
                <div class="history-item" onclick="goToMonth(${item.month}, ${item.year})">
                    <span class="history-month">${item.monthLabel}</span>
                    <span class="history-total">${item.formattedTotal}</span>
                </div>
            `).join('');
        } else {
            document.getElementById('historyList').innerHTML = '<p class="loading">No history yet</p>';
        }
    } catch (error) {
        document.getElementById('historyList').innerHTML = '<p class="loading">Error loading</p>';
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
