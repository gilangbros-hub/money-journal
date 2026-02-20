// showToast is now provided by common.js

// Streak management (localStorage)
function getStreak() {
    const data = JSON.parse(localStorage.getItem('moneyJournalStreak') || '{"count":0,"lastDate":""}');
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (data.lastDate === today) {
        return data; // Already logged today
    } else if (data.lastDate === yesterday) {
        return { count: data.count, lastDate: data.lastDate }; // Streak alive but not yet bumped today
    } else {
        return { count: 0, lastDate: data.lastDate }; // Streak broken
    }
}

function bumpStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const current = getStreak();

    if (current.lastDate === today) {
        return current.count; // Already bumped today
    }

    const newCount = current.count + 1;
    localStorage.setItem('moneyJournalStreak', JSON.stringify({ count: newCount, lastDate: today }));
    return newCount;
}

function displayStreak() {
    const streak = getStreak();
    const badge = document.getElementById('streakBadge');
    if (badge && streak.count > 0) {
        badge.textContent = `🔥 ${streak.count}d`;
        badge.style.display = 'inline-flex';
    }
}

// Motivational messages with personality
const celebrationMessages = [
    { emoji: '🎉', text: 'Great job tracking!' },
    { emoji: '💪', text: 'Discipline = Freedom!' },
    { emoji: '🔥', text: 'You\'re on fire!' },
    { emoji: '✨', text: 'Every Rupiah counts!' },
    { emoji: '🏆', text: 'Champion move!' },
    { emoji: '📊', text: 'Data is power!' },
    { emoji: '🚀', text: 'Finances on track!' },
    { emoji: '💎', text: 'Smart money move!' }
];

function getRandomMessage(streakCount) {
    const msg = celebrationMessages[Math.floor(Math.random() * celebrationMessages.length)];
    const streakText = streakCount > 1 ? ` | 🔥 ${streakCount}-day streak!` : '';
    return `${msg.emoji} ${msg.text}${streakText}`;
}

// Check if editing mode (URL has edit parameter)
const urlParams = new URLSearchParams(window.location.search);
const editId = urlParams.get('edit');

document.addEventListener('DOMContentLoaded', function () {
    // Display current streak
    displayStreak();

    // Set default date if not editing
    if (!editId) {
        const dateInput = document.getElementById('date');
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dateInput.value = now.toISOString().slice(0, 16);
    } else {
        loadTransactionForEdit(editId);
    }

    // Add press animation to submit button
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('mousedown', () => {
            submitBtn.style.transform = 'scale(0.96)';
        });
        submitBtn.addEventListener('mouseup', () => {
            submitBtn.style.transform = 'scale(1)';
        });
        submitBtn.addEventListener('mouseleave', () => {
            submitBtn.style.transform = 'scale(1)';
        });
        // Touch events for mobile
        submitBtn.addEventListener('touchstart', () => {
            submitBtn.style.transform = 'scale(0.96)';
        }, { passive: true });
        submitBtn.addEventListener('touchend', () => {
            submitBtn.style.transform = 'scale(1)';
        }, { passive: true });
    }
});

// Load transaction for editing
async function loadTransactionForEdit(id) {
    try {
        const response = await fetch(`/api/transaction/${id}`);
        const transaction = await response.json();

        // Update UI for Edit Mode
        document.querySelector('.page-title').textContent = '✏️ Edit Transaction';
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
            // 🎮 Gamification: Bump streak + confetti + celebration message
            const streakCount = bumpStreak();
            const message = getRandomMessage(streakCount);

            // Launch confetti
            if (typeof launchConfetti === 'function') {
                launchConfetti(2500);
            }

            showToast(message, 'success', 3000);

            // Redirect to transactions page after celebration
            setTimeout(() => {
                window.location.href = '/transactions';
            }, 1800);
        } else {
            showToast(result.message || 'Error saving transaction', 'error');
        }

    } catch (error) {
        console.error('Error:', error);
        showToast('Network error occurred', 'error');
    }
});