// Check if editing mode (URL has transactionId parameter)
const urlParams = new URLSearchParams(window.location.search);
const editId = urlParams.get('edit');

// Set today's date as default
document.addEventListener('DOMContentLoaded', function() {
    const dateInput = document.getElementById('date');
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dateInput.value = now.toISOString().slice(0, 16);
    
    // If edit mode, load transaction data
    if (editId) {
        loadTransactionForEdit(editId);
    }
});

// Load transaction for editing
async function loadTransactionForEdit(id) {
    try {
        const response = await fetch(`/api/transaction/${id}`);
        const transaction = await response.json();
        
        // Update page title
        document.getElementById('pageTitle').textContent = '✏️ Edit Transaction';
        document.getElementById('btnText').textContent = 'Update Transaction';
        
        // Fill form
        document.getElementById('transactionId').value = transaction._id;
        
        const date = new Date(transaction.date);
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        document.getElementById('date').value = date.toISOString().slice(0, 16);
        
        document.querySelector(`input[name="type"][value="${transaction.type}"]`).checked = true;
        document.getElementById('ngapain').value = transaction.ngapain;
        document.getElementById('amount').value = transaction.amount;
        
        // Trigger amount formatting
        const formatted = new Intl.NumberFormat('id-ID').format(transaction.amount);
        document.getElementById('formatted').textContent = `Rp ${formatted}`;
        
    } catch (error) {
        console.error('Error loading transaction:', error);
        alert('Error loading transaction data');
    }
}

// Format amount with thousand separators
const amountInput = document.getElementById('amount');
const formattedDiv = document.getElementById('formatted');

amountInput.addEventListener('input', function(e) {
    let value = e.target.value.replace(/[^0-9]/g, '');
    e.target.value = value;
    
    if (value && value !== '0') {
        const formatted = new Intl.NumberFormat('id-ID').format(value);
        formattedDiv.textContent = `Rp ${formatted}`;
    } else {
        formattedDiv.textContent = '';
    }
});

// Handle form submission
document.getElementById('transactionForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const amountValue = document.getElementById('amount').value;
    if (!amountValue || amountValue === '0') {
        const messageDiv = document.getElementById('message');
        messageDiv.className = 'message error';
        messageDiv.textContent = '✗ Amount must be greater than 0';
        return;
    }
    
    const transactionId = document.getElementById('transactionId').value;
    const isEdit = !!transactionId;
    
    const formData = {
        date: document.getElementById('date').value,
        type: document.querySelector('input[name="type"]:checked').value,
        ngapain: document.getElementById('ngapain').value,
        amount: amountValue
    };
    
    try {
        const url = isEdit ? `/api/transaction/${transactionId}` : '/api/transaction';
        const method = isEdit ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        const messageDiv = document.getElementById('message');
        let toastTimer;

function showToast(text, type = 'success', duration = 2500) {
  const messageDiv = document.getElementById('message');

  if (!messageDiv) return;

  // reset
  clearTimeout(toastTimer);
  messageDiv.className = 'message'; // keep base class if you want
  messageDiv.classList.add(type);
  messageDiv.textContent = text;

  // show
  messageDiv.classList.add('toast-show');

  // auto hide
  toastTimer = setTimeout(() => {
    messageDiv.classList.remove('toast-show');
  }, duration);
}

if (response.ok && result.success) {
    showToast('✓ ' + result.message, 'success', 2500);
    
    // Get form values
    const by = document.getElementById('by').value;
    const ngapain = document.getElementById('ngapain').value || document.querySelector('textarea[name="ngapain"]').value;
    const amount = document.getElementById('amount').value;
    
    // Format amount with thousand separator
    const formattedAmount = parseInt(amount).toLocaleString('id-ID');
    
    // WhatsApp message
    const waMessage = `Ada transaksi baru nih! ${by} abis ${ngapain} sebanyak Rp${formattedAmount}!`;
    
    // Your WhatsApp number (WITHOUT + sign)
    const waPhone = '6281220001281'; // ← CHANGE THIS TO YOUR NUMBER
    
    // Open WhatsApp in new tab
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(waMessage)}`, '_blank');
    
    // Redirect to transactions page after 2.5 seconds
    setTimeout(() => {
        window.location.href = '/transactions';
    }, 2500);
}

  setTimeout(() => {
    window.location.href = '/transactions';
  }, 2500);
} else {
  showToast('✗ ' + (result.message || 'Error saving transaction'), 'error', 3500);
}

            
            // Redirect to transactions page after short delay
            setTimeout(() => {
                window.location.href = '/transactions';
            }, 1500);
            
        } else {
            if (response.ok && result.success) {
  showToast('✓ ' + result.message, 'success', 2500);

  setTimeout(() => {
    window.location.href = '/transactions';
  }, 2500);
} else {
  showToast('✗ ' + (result.message || 'Error saving transaction'), 'error', 3500);
}

        }
    } catch (error) {
        console.error('Error:', error);
        const messageDiv = document.getElementById('message');
        if (response.ok && result.success) {
  showToast('✓ ' + result.message, 'success', 2500);

  setTimeout(() => {
    window.location.href = '/transactions';
  }, 2500);
} else {
  showToast('✗ ' + (result.message || 'Error saving transaction'), 'error', 3500);
}
    }
});
