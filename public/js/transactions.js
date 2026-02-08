let dashboardData = null;
let currentMonth = new Date().toISOString().slice(0, 7);

// Emoji Mappings (Keep existing ones)
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

    // 2. Render Categories
    renderCategoryList();

    // 3. Render Recent History (Default view)
    renderTransactionList(dashboardData.recent, false);

    // Reset Header
    document.querySelector('h2.text-lg').textContent = 'Recent Transactions';
    document.querySelector('h2.text-lg').nextElementSibling.style.display = 'block'; // Show Export button
}

function renderCategoryList() {
    const categoryList = document.getElementById('categoryList');
    const { categories, total } = dashboardData;

    if (categories.length === 0) {
        categoryList.innerHTML = '<p class="text-center" style="color:#9CA3AF; margin-top:20px;">No spending this month yet!</p>';
        return;
    }

    categoryList.innerHTML = categories.map(cat => {
        return `
            <div class="category-item" onclick="filterByCategory('${cat.category}')" style="cursor: pointer;">
                <div class="cat-icon">${cat.icon}</div>
                <div class="cat-details">
                    <div class="cat-header">
                        <span class="cat-name">${cat.category}</span>
                        <span class="cat-amount">${cat.formattedTotal}</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${cat.percentage < 5 ? 5 : cat.percentage}%; background: var(--primary-gradient);"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function filterByCategory(category) {
    // Update UI to show loading state if needed
    const list = document.getElementById('historyList');
    list.innerHTML = '<p class="text-center" style="padding: 20px; color: #6B7280;">Loading...</p>';

    try {
        // Fetch full list for this category
        console.log(`Fetching transactions for category: ${category}`);
        const response = await fetch(`/api/transactions?month=${currentMonth}&type=${category}`);

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const transactions = await response.json();
        console.log('Received transactions:', transactions);

        // Update Header
        document.querySelector('h2.text-lg').textContent = `${category} Transactions`;
        document.querySelector('h2.text-lg').nextElementSibling.style.display = 'none'; // Hide Export button for filtered view (optional)

        // Render sorted by date
        if (Array.isArray(transactions)) {
            renderTransactionList(transactions, true);
        } else {
            console.error('Expected array but got:', transactions);
            throw new Error('Invalid data format received from API');
        }

    } catch (error) {
        console.error('Error fetching category transactions:', error);
        list.innerHTML = `<p class="text-center" style="color: red;">Error loading data: ${error.message}</p>`;
    }
}

function renderTransactionList(transactions, isFullList) {
    const list = document.getElementById('historyList');

    if (transactions.length === 0) {
        list.innerHTML = '<p class="text-center" style="padding: 20px; color: #9CA3AF;">No transactions found.</p>';
        return;
    }

    list.innerHTML = transactions.map(t => {
        try {
            const date = new Date(t.date);
            const dateStr = isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

            // Handle formatCurrency difference
            const formattedAmount = t.formattedAmount || `Rp ${Number(t.amount).toLocaleString('id-ID')}`;
            const icon = typeEmojis[t.type] || '📦';
            const paidByLabel = t.paidBy && t.paidBy !== 'Self' ? `<span style="font-size: 10px; background: #EEF2FF; color: #4F46E5; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">${t.paidBy}</span>` : '';

            return `
                <div class="trans-item-mini" onclick="openOptions('${t._id}', '${t.ngapain ? t.ngapain.replace(/'/g, "\\'") : ""}', ${t.amount})">
                    <div class="trans-icon-mini">${icon}</div>
                    <div class="trans-info">
                        <div class="trans-title">
                            ${t.ngapain || 'No Description'}
                            ${paidByLabel}
                        </div>
                        <div class="trans-date">${dateStr} • ${t.pocket || 'Unknown'}</div>
                    </div>
                    <div class="trans-amount">- ${formattedAmount}</div>
                </div>
            `;
        } catch (err) {
            console.error('Error rendering item:', t, err);
            return '';
        }
    }).join('');
}

// Delete Logic (Keep existing)
let deleteId = null;
function openOptions(id, note, amount) {
    deleteId = id;
    const modal = document.getElementById('deleteModal');
    // Simple formatting for the modal
    const formatted = typeof amount === 'number' ? `Rp ${amount.toLocaleString('id-ID')}` : amount;
    document.getElementById('deleteDetails').innerText = `${note} - ${formatted}`;
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
            fetchDashboardData(); // Refresh everything
        }
    } catch (error) {
        console.error(error);
    }
}

// Export specific for the current view? Or just global? 
// The user didn't ask to change export, so I'll keep it simple or remove if it conflicts.
// I'll keep the function but it will need to fetch data since 'currentTransactions' is gone.
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
