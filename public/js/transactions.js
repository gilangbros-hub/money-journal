let currentTransactionId = null;
let allTransactions = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Set current month as default
    const now = new Date();
    const monthString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('monthFilter').value = monthString;
    
    // Load submitters for filter
    loadSubmitters();
    
    // Load transactions
    loadTransactions();
    
    // Add event listeners for filters
    document.getElementById('monthFilter').addEventListener('change', loadTransactions);
    document.getElementById('byFilter').addEventListener('change', loadTransactions);
    document.getElementById('typeFilter').addEventListener('change', loadTransactions);
});

// Load unique submitters
async function loadSubmitters() {
    try {
        const response = await fetch('/api/submitters');
        const submitters = await response.json();
        
        const select = document.getElementById('byFilter');
        submitters.forEach(submitter => {
            const option = document.createElement('option');
            option.value = submitter;
            option.textContent = submitter;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading submitters:', error);
    }
}

// Load transactions
async function loadTransactions() {
    const month = document.getElementById('monthFilter').value;
    const by = document.getElementById('byFilter').value;
    const type = document.getElementById('typeFilter').value;
    
    if (!month) {
        return;
    }
    
    try {
        const params = new URLSearchParams({ month, by, type });
        const response = await fetch(`/api/transactions?${params}`);
        allTransactions = await response.json();
        
        displayTransactions(allTransactions);
        updateSummary(allTransactions);
        
    } catch (error) {
        console.error('Error loading transactions:', error);
        document.getElementById('tableBody').innerHTML = `
            <tr class="empty-row">
                <td colspan="7">Error loading transactions</td>
            </tr>
        `;
    }
}

// Display transactions in table
function displayTransactions(transactions) {
    const tbody = document.getElementById('tableBody');
    
    if (transactions.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="7">No transactions found</td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = transactions.map((transaction, index) => {
        const date = new Date(transaction.date);
        const formattedDate = date.toLocaleDateString('id-ID', { 
            day: '2-digit', 
            month: 'short', 
            year: 'numeric' 
        });
        const formattedTime = date.toLocaleTimeString('id-ID', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const amount = new Intl.NumberFormat('id-ID').format(transaction.amount);
        
        const categoryEmoji = {
            'rumah': '🏠',
            'kerja': '💼',
            'pacaran': '❤️',
            'personal': '👤'
        }[transaction.type];
        
        return `
            <tr>
                <td>${index + 1}</td>
                <td>
                    <div>${formattedDate}</div>
                    <div style="font-size: 12px; color: #999;">${formattedTime}</div>
                </td>
                <td>
                    <span class="category-badge category-${transaction.type}">
                        ${categoryEmoji} ${transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)}
                    </span>
                </td>
                <td>${transaction.by}</td>
                <td class="amount-cell">Rp ${amount}</td>
                <td>${transaction.ngapain}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-edit" onclick="editTransaction('${transaction._id}')">
                            ✏️ Edit
                        </button>
                        <button class="btn-delete-small" onclick="deleteTransaction('${transaction._id}', '${transaction.ngapain}', ${transaction.amount})">
                            🗑️ Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Update summary
function updateSummary(transactions) {
    const totalCount = transactions.length;
    const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);
    
    document.getElementById('totalCount').textContent = totalCount;
    document.getElementById('totalAmount').textContent = 
        'Rp ' + new Intl.NumberFormat('id-ID').format(totalAmount);
}

// Edit transaction
function editTransaction(id) {
    window.location.href = `/transaction?edit=${id}`;
}

// Delete transaction
function deleteTransaction(id, description, amount) {
    currentTransactionId = id;
    const formattedAmount = new Intl.NumberFormat('id-ID').format(amount);
    document.getElementById('deleteDetails').innerHTML = `
        <strong>${description}</strong><br>
        Amount: Rp ${formattedAmount}
    `;
    document.getElementById('deleteModal').classList.add('active');
}

// Close delete modal
function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    currentTransactionId = null;
}

// Confirm delete
async function confirmDelete() {
    if (!currentTransactionId) return;
    
    try {
        const response = await fetch(`/api/transaction/${currentTransactionId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeDeleteModal();
            loadTransactions(); // Reload table
        } else {
            alert('Error deleting transaction: ' + result.message);
        }
        
    } catch (error) {
        console.error('Error deleting transaction:', error);
        alert('Error deleting transaction');
    }
}
