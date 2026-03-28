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

// Budget Month select population (current ±1 months only)
function populateBudgetMonthSelect(preselect) {
    const select = document.getElementById('budgetMonth');
    select.innerHTML = '';
    const now = new Date();
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    // Generate 3 options: prev month, current month, next month
    for (let offset = -1; offset <= 1; offset++) {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const m = d.getMonth() + 1;
        const y = d.getFullYear();
        const val = `${y}-${String(m).padStart(2, '0')}`;
        const label = `${monthNames[m - 1]} ${y}`;
        const option = document.createElement('option');
        option.value = val;
        option.textContent = label;
        if (preselect) {
            option.selected = val === preselect;
        } else {
            option.selected = offset === 0; // default to current month
        }
        select.appendChild(option);
    }
}

// Check if editing mode (URL has edit parameter)
const urlParams = new URLSearchParams(window.location.search);
const editId = urlParams.get('edit');

document.addEventListener('DOMContentLoaded', function () {
    // Display current streak
    displayStreak();

    // Set default date and budget month if not editing
    if (!editId) {
        const dateInput = document.getElementById('date');
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dateInput.value = now.toISOString().slice(0, 16);
        populateBudgetMonthSelect();
    } else {
        populateBudgetMonthSelect(); // populate first, edit load will re-select
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

        // Budget Month
        if (transaction.budgetMonth && transaction.budgetYear) {
            const preselect = `${transaction.budgetYear}-${String(transaction.budgetMonth).padStart(2, '0')}`;
            populateBudgetMonthSelect(preselect);
        }

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

    // Parse budget month
    const budgetMonthVal = document.getElementById('budgetMonth').value;
    const [bYear, bMonth] = budgetMonthVal.split('-');

    const formData = {
        date: document.getElementById('date').value,
        type: typeChecked.value,
        pocket: pocketChecked.value,
        ngapain: document.getElementById('ngapain').value,
        amount: amountValue,
        budgetMonth: parseInt(bMonth),
        budgetYear: parseInt(bYear)
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

            // Show success modal instead of auto-redirect
            document.getElementById('successEmoji').textContent = msg.emoji;
            document.getElementById('successMessage').textContent = `${msg.text}${streakCount > 1 ? ` | 🔥 ${streakCount}-day streak!` : ''}`;
            document.getElementById('successModal').classList.add('show');
        } else {
            showToast(result.message || 'Error saving transaction', 'error');
        }

    } catch (error) {
        console.error('Error:', error);
        showToast('Network error occurred', 'error');
    }
});

// Add Another: reset form and close modal
function addAnother() {
    document.getElementById('successModal').classList.remove('show');
    document.getElementById('transactionForm').reset();

    // Re-set date to now
    const dateInput = document.getElementById('date');
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dateInput.value = now.toISOString().slice(0, 16);

    // Re-populate budget month
    populateBudgetMonthSelect();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Close success modal on outside click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('successModal');
    if (e.target === modal) {
        modal.classList.remove('show');
    }
});

// Fetch closed pockets and disable them in the UI
async function loadClosedPockets() {
    try {
        const budgetMonthVal = document.getElementById('budgetMonth').value;
        if (!budgetMonthVal) return;

        const response = await fetch(`/api/budget?month=${budgetMonthVal}`);
        const result = await response.json();

        if (result.success && result.data.pockets) {
            result.data.pockets.forEach(p => {
                if (p.closed) {
                    const radio = document.querySelector(`input[name="pocket"][value="${p.pocket}"]`);
                    if (radio) {
                        radio.disabled = true;
                        const iconBtn = radio.nextElementSibling;
                        if (iconBtn) {
                            iconBtn.style.opacity = '0.35';
                            iconBtn.style.pointerEvents = 'none';
                            iconBtn.title = 'This pocket is closed for this month';
                            // Add lock badge
                            const badge = document.createElement('span');
                            badge.className = 'absolute top-1 right-1 text-[10px]';
                            badge.textContent = '🔒';
                            iconBtn.style.position = 'relative';
                            iconBtn.appendChild(badge);
                        }
                    }
                }
            });
        }
    } catch (err) {
        console.error('Error loading closed pockets:', err);
    }
}

// Load closed pockets after budget month is populated
setTimeout(() => loadClosedPockets(), 300);

// Re-check when budget month changes
const budgetSelect = document.getElementById('budgetMonth');
if (budgetSelect) {
    budgetSelect.addEventListener('change', () => {
        // Reset all pocket states before re-checking
        document.querySelectorAll('input[name="pocket"]').forEach(r => {
            r.disabled = false;
            const btn = r.nextElementSibling;
            if (btn) {
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
                const lock = btn.querySelector('.absolute');
                if (lock) lock.remove();
            }
        });
        loadClosedPockets();
    });
}