let currentTransactions = [];

// Emoji Mappings
const typeEmojis = {
    'Eat': '🍽️', 'Snack': '🍿', 'Groceries': '🛒', 'Laundry': '🧺',
    'Bensin': '⛽', 'Flazz': '💳', 'Home Appliance': '🏠', 'Jumat Berkah': '🤲',
    'Uang Sampah': '🗑️', 'Uang Keamanan': '👮', 'Medicine': '💊', 'Others': '📦'
};

document.addEventListener('DOMContentLoaded', () => {
    // Set default month to current
    const monthFilter = document.getElementById('monthFilter');
    const now = new Date();
    monthFilter.value = now.toISOString().slice(0, 7);

    fetchTransactions();

    // Listeners
    monthFilter.addEventListener('change', fetchTransactions);
});

async function fetchTransactions() {
    const month = document.getElementById('monthFilter').value;

    try {
        const response = await fetch(`/api/transactions?month=${month}`); // Type filter removed from UI
        currentTransactions = await response.json();
        updateDashboard();
    } catch (error) {
        console.error('Error:', error);
    }
}

function updateDashboard() {
    // 1. Calculate Total
    const total = currentTransactions.reduce((sum, t) => sum + t.amount, 0);
    document.getElementById('totalAmount').textContent = `Rp ${total.toLocaleString('id-ID')}`;

    // 2. Render Categories
    renderCategoryList(total);

    // 3. Render Recent History
    renderHistory();
}

function renderCategoryList(totalSpent) {
    const categoryList = document.getElementById('categoryList');

    // Group by Type
    const categories = {};
    currentTransactions.forEach(t => {
        categories[t.type] = (categories[t.type] || 0) + t.amount;
    });

    // Sort by descending amount
    const sortedCategories = Object.entries(categories)
        .sort(([, a], [, b]) => b - a);

    if (sortedCategories.length === 0) {
        categoryList.innerHTML = '<p class="text-center" style="color:#9CA3AF; margin-top:20px;">No spending this month yet!</p>';
        return;
    }

    categoryList.innerHTML = sortedCategories.map(([type, amount]) => {
        const percentage = totalSpent > 0 ? (amount / totalSpent) * 100 : 0;
        const width = percentage < 5 ? 5 : percentage; // Min width for visibility

        return `
            <div class="category-item">
                <div class="cat-icon">${typeEmojis[type] || '📝'}</div>
                <div class="cat-details">
                    <div class="cat-header">
                        <span class="cat-name">${type}</span>
                        <span class="cat-amount">Rp ${amount.toLocaleString('id-ID')}</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${width}%; background: var(--primary-gradient);"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderHistory() {
    const list = document.getElementById('historyList');
    if (currentTransactions.length === 0) {
        list.innerHTML = ''; // Message already shown in category list
        return;
    }

    // Show only recent 10 or all? Dashboard usually shows simplified list.
    // Let's show all for now but styled simply.
    list.innerHTML = currentTransactions.map(t => {
        const date = new Date(t.date);
        const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

        return `
            <div class="trans-item-mini" onclick="openOptions('${t._id}', '${t.ngapain}', ${t.amount})">
                <div class="trans-icon-mini">${typeEmojis[t.type] || '📝'}</div>
                <div class="trans-info">
                    <div class="trans-title">${t.ngapain}</div>
                    <div class="trans-date">${dateStr} • ${t.pocket}</div>
                </div>
                <div class="trans-amount">- Rp ${t.amount.toLocaleString('id-ID')}</div>
            </div>
        `;
    }).join('');
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

function exportToCSV() {
    if (currentTransactions.length === 0) {
        alert("No transactions to export!");
        return;
    }

    const month = document.getElementById('monthFilter').value;
    const csvRows = [];

    // Headers
    csvRows.push(['Date', 'Time', 'Type', 'Pocket', 'Description', 'Amount', 'Submitted By']);

    // Data
    currentTransactions.forEach(t => {
        const date = new Date(t.date);
        const dateStr = date.toLocaleDateString('en-GB');
        const timeStr = date.toLocaleTimeString('en-GB');

        // Escape quotes in description
        const safeDesc = `"${t.ngapain.replace(/"/g, '""')}"`;

        csvRows.push([
            dateStr,
            timeStr,
            t.type,
            t.pocket,
            safeDesc,
            t.amount,
            t.by || 'Unknown'
        ]);
    });

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `MoneyJournal_${month}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
