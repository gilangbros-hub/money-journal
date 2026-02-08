// showToast is now provided by common.js

// Check if editing mode (URL has edit parameter)
const urlParams = new URLSearchParams(window.location.search);
const editId = urlParams.get('edit');

document.addEventListener('DOMContentLoaded', function () {
    // Set default date if not editing
    if (!editId) {
        const dateInput = document.getElementById('date');
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dateInput.value = now.toISOString().slice(0, 16);
    } else {
        loadTransactionForEdit(editId);
    }
});

// Load transaction for editing
async function loadTransactionForEdit(id) {
    try {
        const response = await fetch(`/api/transaction/${id}`);
        const transaction = await response.json();

        // Update UI for Edit Mode
        document.querySelector('.app-bar-title').textContent = 'Edit Transaction';
        document.getElementById('submitBtn').innerHTML = 'Update Transaction';
        document.getElementById('transactionId').value = transaction._id;

        // Date
        const date = new Date(transaction.date);
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        document.getElementById('date').value = date.toISOString().slice(0, 16);

        // Radio Buttons (Type & Pocket)
        if (transaction.type) {
            const typeRadio = document.querySelector(`input[name="type"][value="${transaction.type}"]`);
            if (typeRadio) typeRadio.checked = true;
        }
        if (transaction.pocket) {
            const pocketRadio = document.querySelector(`input[name="pocket"][value="${transaction.pocket}"]`);
            if (pocketRadio) pocketRadio.checked = true;
        }

        // Text Fields
        document.getElementById('ngapain').value = transaction.ngapain;
        document.getElementById('amount').value = transaction.amount;

    } catch (error) {
        console.error('Error loading transaction:', error);
        showToast('Error loading transaction data', 'error');
    }
}

// Handle form submission
document.getElementById('transactionForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const amountValue = document.getElementById('amount').value;
    if (!amountValue || amountValue <= 0) {
        showToast('Amount must be greater than 0', 'error');
        return;
    }

    // Validate Radios
    const typeChecked = document.querySelector('input[name="type"]:checked');
    const pocketChecked = document.querySelector('input[name="pocket"]:checked');

    if (!typeChecked) {
        showToast('Please select an Expense Type', 'error');
        return;
    }
    if (!pocketChecked) {
        showToast('Please select a Pocket Source', 'error');
        return;
    }

    const transactionId = document.getElementById('transactionId').value;
    const isEdit = !!transactionId;

    const formData = {
        date: document.getElementById('date').value,
        type: typeChecked.value,
        pocket: pocketChecked.value,
        ngapain: document.getElementById('ngapain').value,
        amount: amountValue
    };

    try {
        const url = isEdit ? `/api/transaction/${transactionId}` : '/api/transaction';
        const method = isEdit ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            const username = document.getElementById('currentUsername').value;
            showToast(`Input berhasil! Makaci yaa ${username}!`, 'success');

            // Redirect to transactions page after a short delay
            setTimeout(() => {
                window.location.href = '/transactions';
            }, 1000);
        } else {
            showToast(result.message || 'Error saving transaction', 'error');
        }

    } catch (error) {
        console.error('Error:', error);
        showToast('Network error occurred', 'error');
    }
});