let currentTransactions = [];
let expenseChart = null;
let currentChartGroupBy = 'pocket'; // default

// Emoji Mappings
const typeEmojis = {
    'Eat': '🍽️', 'Snack': '🍿', 'Groceries': '🛒', 'Laundry': '🧺',
    'Bensin': '⛽', 'Flazz': '💳', 'Home Appliance': '🏠', 'Jumat Berkah': '🤲',
    'Uang Sampah': '🗑️', 'Uang Keamanan': '👮', 'Medicine': '💊', 'Others': '📦'
};

const pocketEmojis = {
    'Kwintals': '💰', 'Groceries': '🥦', 'Weekday Transport': '🚌',
    'Weekend Transport': '🚗', 'Investasi': '📈', 'Dana Darurat': '🆘', 'IPL': '🏘️'
};

document.addEventListener('DOMContentLoaded', () => {
    // Set default month to current
    const monthFilter = document.getElementById('monthFilter');
    const now = new Date();
    monthFilter.value = now.toISOString().slice(0, 7);

    fetchTransactions();

    // Listeners
    monthFilter.addEventListener('change', fetchTransactions);
    document.getElementById('typeFilter').addEventListener('change', fetchTransactions);
});

async function fetchTransactions() {
    const month = document.getElementById('monthFilter').value;
    const type = document.getElementById('typeFilter').value;

    try {
        const response = await fetch(`/api/transactions?month=${month}&type=${type}`);
        currentTransactions = await response.json();
        renderHistory();
        renderChart();
    } catch (error) {
        console.error('Error:', error);
    }
}

function renderHistory() {
    const list = document.getElementById('historyList');
    if (currentTransactions.length === 0) {
        list.innerHTML = '<p class="text-center md-subhead" style="margin-top:20px;">No transactions found 💨</p>';
        document.getElementById('totalAmount').textContent = 'Rp 0';
        return;
    }

    let total = 0;
    list.innerHTML = currentTransactions.map(t => {
        total += t.amount;
        const date = new Date(t.date);
        const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        
        return `
            <div class="transaction-item" onclick="openOptions('${t._id}', '${t.ngapain}', ${t.amount})">
                <div class="type-icon">${typeEmojis[t.type] || '📝'}</div>
                <div class="item-details">
                    <div class="item-title">${t.ngapain}</div>
                    <div class="item-meta">
                        <span>${dateStr} • ${timeStr}</span>
                        <span class="pocket-badge">${pocketEmojis[t.pocket] || '👛'} ${t.pocket}</span>
                    </div>
                </div>
                <div class="item-amount">Rp ${t.amount.toLocaleString('id-ID')}</div>
            </div>
        `;
    }).join('');

    document.getElementById('totalAmount').textContent = `Rp ${total.toLocaleString('id-ID')}`;
}

// Chart Logic
function updateChartType(type) {
    currentChartGroupBy = type;
    // Update UI Buttons
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.toLowerCase() === type);
    });
    renderChart();
}

function renderChart() {
    const ctx = document.getElementById('expenseChart').getContext('2d');
    
    // Aggregate Data
    const dataMap = {};
    let totalSum = 0;
    currentTransactions.forEach(t => {
        const key = currentChartGroupBy === 'pocket' ? t.pocket : t.type;
        dataMap[key] = (dataMap[key] || 0) + t.amount;
        totalSum += t.amount;
    });

    const labels = Object.keys(dataMap);
    const values = Object.values(dataMap);

    if (expenseChart) expenseChart.destroy();

    if (labels.length === 0) return;

    expenseChart = new Chart(ctx, {
        type: 'doughnut',
        plugins: [ChartDataLabels],
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: [
                    '#4F46E5', '#10B981', '#F59E0B', '#EF4444', 
                    '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1'
                ],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: { size: 11, weight: '600' }
                    }
                },
                datalabels: {
                    color: '#fff',
                    font: {
                        weight: 'bold',
                        size: 11
                    },
                    formatter: (value) => {
                        const percentage = ((value / totalSum) * 100).toFixed(0);
                        return percentage > 5 ? `${percentage}%` : ''; // Only show if > 5% to avoid clutter
                    }
                }
            },
            cutout: '70%'
        }
    });
}

// Delete Logic
let deleteId = null;
function openOptions(id, note, amount) {
    deleteId = id;
    const modal = document.getElementById('deleteModal');
    document.getElementById('deleteDetails').innerText = `${note} - Rp ${amount.toLocaleString('id-ID')}`;
    modal.style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
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