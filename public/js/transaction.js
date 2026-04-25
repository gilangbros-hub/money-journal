// showToast is now provided by common.js

// =============================================
//  POCKET CONSTANTS (mirrors server POCKETS)
// =============================================
const POCKET_LIST = [
    { key: 'Kwintals', emoji: '💰' },
    { key: 'Groceries', emoji: '🥦' },
    { key: 'Weekday Transport', emoji: '🚌' },
    { key: 'Weekend Transport', emoji: '🚗' },
    { key: 'Investasi', emoji: '📈' },
    { key: 'Bandung', emoji: '⛰️' },
    { key: 'Sedeqah', emoji: '🤲' },
    { key: 'IPL', emoji: '🏘️' }
];

// =============================================
//  FORMAT HELPERS
// =============================================
// formatRupiah is now provided by common.js

// =============================================
//  STREAK MANAGEMENT (localStorage)
// =============================================
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
    return { emoji: msg.emoji, text: `${msg.text}${streakText}` };
}

// =============================================
//  BUDGET MONTH SELECT
// =============================================
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

// =============================================
//  SOURCE TYPE TOGGLE
// =============================================
function getSourceType() {
    const checked = document.querySelector('input[name="sourceType"]:checked');
    return checked ? checked.value : 'single';
}

function handleSourceTypeChange() {
    const sourceType = getSourceType();
    const singleSection = document.getElementById('singlePocketSection');
    const multiSection = document.getElementById('multiPocketSection');

    if (sourceType === 'single') {
        singleSection.style.display = '';
        multiSection.style.display = 'none';
        // Clear multi-pocket rows
        document.getElementById('breakdownRows').innerHTML = '';
        updateBreakdownTotal();
    } else {
        singleSection.style.display = 'none';
        multiSection.style.display = '';
        // Clear single-pocket radio
        const checked = document.querySelector('input[name="pocket"]:checked');
        if (checked) checked.checked = false;
        // Add first row automatically
        if (document.getElementById('breakdownRows').children.length === 0) {
            addBreakdownRow();
        }
    }
}

// =============================================
//  MULTI POCKET BREAKDOWN ROWS
// =============================================
let breakdownRowId = 0;

function getUsedPockets() {
    const selects = document.querySelectorAll('#breakdownRows select');
    const used = [];
    selects.forEach(s => {
        if (s.value) used.push(s.value);
    });
    return used;
}

function getBreakdownRowCount() {
    return document.getElementById('breakdownRows').children.length;
}

function updateAddPocketBtnVisibility() {
    const btn = document.getElementById('addPocketBtn');
    if (btn) {
        btn.style.display = getBreakdownRowCount() >= 3 ? 'none' : '';
    }
}

function buildPocketOptions(selectedValue) {
    const used = getUsedPockets();
    let html = '<option value="">Select pocket...</option>';
    POCKET_LIST.forEach(p => {
        const disabled = used.includes(p.key) && p.key !== selectedValue;
        html += `<option value="${p.key}" ${p.key === selectedValue ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${p.emoji} ${p.key}</option>`;
    });
    return html;
}

function refreshAllDropdowns() {
    const selects = document.querySelectorAll('#breakdownRows select');
    selects.forEach(select => {
        const currentVal = select.value;
        select.innerHTML = buildPocketOptions(currentVal);
    });
    updateAddPocketBtnVisibility();
}

function addBreakdownRow(pocketVal, amountVal) {
    if (getBreakdownRowCount() >= 3) return;

    breakdownRowId++;
    const rowId = `breakdown-row-${breakdownRowId}`;
    const container = document.getElementById('breakdownRows');

    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.id = rowId;
    row.innerHTML = `
        <select onchange="onBreakdownPocketChange()">${buildPocketOptions(pocketVal || '')}</select>
        <input type="number" class="breakdown-amount" placeholder="0" value="${amountVal || ''}" oninput="updateBreakdownTotal()" min="0">
        <button type="button" class="remove-pocket-btn" onclick="removeBreakdownRow('${rowId}')" title="Remove">✕</button>
    `;

    container.appendChild(row);
    refreshAllDropdowns();
    updateBreakdownTotal();
}

function removeBreakdownRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        row.style.animation = 'fadeIn 0.2s ease-out reverse';
        setTimeout(() => {
            row.remove();
            refreshAllDropdowns();
            updateBreakdownTotal();
        }, 150);
    }
}

function onBreakdownPocketChange() {
    refreshAllDropdowns();
}

// =============================================
//  BREAKDOWN TOTAL / PROGRESS
// =============================================
function getTransactionAmount() {
    return parseFloat(document.getElementById('amount').value) || 0;
}

function getBreakdownSum() {
    let sum = 0;
    document.querySelectorAll('#breakdownRows .breakdown-amount').forEach(input => {
        sum += parseFloat(input.value) || 0;
    });
    return sum;
}

function updateBreakdownTotal() {
    const total = getTransactionAmount();
    const allocated = getBreakdownSum();
    const diff = total - allocated;

    document.getElementById('allocatedTotal').textContent = formatRupiah(allocated);
    document.getElementById('transactionAmountDisplay').textContent = formatRupiah(total);

    const diffEl = document.getElementById('differenceDisplay');
    const progressFill = document.getElementById('breakdownProgressFill');

    if (total === 0) {
        diffEl.textContent = 'Rp 0';
        diffEl.className = 'value';
        progressFill.style.width = '0%';
        progressFill.className = 'breakdown-progress-fill';
    } else if (diff === 0 && allocated > 0) {
        diffEl.textContent = '✅ Matched!';
        diffEl.className = 'value matched';
        progressFill.style.width = '100%';
        progressFill.className = 'breakdown-progress-fill matched';
    } else if (diff > 0) {
        diffEl.textContent = `- ${formatRupiah(diff)} remaining`;
        diffEl.className = 'value unmatched';
        const pct = Math.min((allocated / total) * 100, 100);
        progressFill.style.width = `${pct}%`;
        progressFill.className = 'breakdown-progress-fill';
    } else {
        diffEl.textContent = `+ ${formatRupiah(Math.abs(diff))} over`;
        diffEl.className = 'value unmatched';
        progressFill.style.width = '100%';
        progressFill.className = 'breakdown-progress-fill over';
    }
}

// =============================================
//  EDIT MODE
// =============================================
const urlParams = new URLSearchParams(window.location.search);
const editId = urlParams.get('edit');

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

        // Radio Buttons (Type)
        if (transaction.type) {
            const typeRadio = document.querySelector(`input[name="type"][value="${transaction.type}"]`);
            if (typeRadio) typeRadio.checked = true;
        }

        // Text Fields
        document.getElementById('ngapain').value = transaction.ngapain;
        document.getElementById('amount').value = transaction.amount;

        // Budget Month
        if (transaction.budgetMonth && transaction.budgetYear) {
            const preselect = `${transaction.budgetYear}-${String(transaction.budgetMonth).padStart(2, '0')}`;
            populateBudgetMonthSelect(preselect);
        }

        // Source Type & Pocket
        const sourceType = transaction.sourceType || 'single';

        if (sourceType === 'multi' && transaction.sourceBreakdowns && transaction.sourceBreakdowns.length > 0) {
            // Set source type to multi
            document.getElementById('sourceTypeMulti').checked = true;
            handleSourceTypeChange();

            // Clear the auto-added first row
            document.getElementById('breakdownRows').innerHTML = '';

            // Add rows for each breakdown
            transaction.sourceBreakdowns.forEach(b => {
                addBreakdownRow(b.pocket, b.amount);
            });
            updateBreakdownTotal();
        } else {
            // Single pocket (default)
            document.getElementById('sourceTypeSingle').checked = true;
            handleSourceTypeChange();

            if (transaction.pocket) {
                const pocketRadio = document.querySelector(`input[name="pocket"][value="${transaction.pocket}"]`);
                if (pocketRadio) pocketRadio.checked = true;
            }
        }

    } catch (error) {
        console.error('Error loading transaction:', error);
        showToast('Error loading transaction data', 'error');
    }
}

// =============================================
//  VALIDATION
// =============================================
function validateForm() {
    const amountValue = document.getElementById('amount').value;
    if (!amountValue || amountValue <= 0) {
        showToast('Amount must be greater than 0', 'error');
        return false;
    }

    const typeChecked = document.querySelector('input[name="type"]:checked');
    if (!typeChecked) {
        showToast('Please select an Expense Type', 'error');
        return false;
    }

    const sourceType = getSourceType();

    if (sourceType === 'single') {
        const pocketChecked = document.querySelector('input[name="pocket"]:checked');
        if (!pocketChecked) {
            showToast('Please select a Pocket Source', 'error');
            return false;
        }
    } else {
        // Multi mode validation
        const rows = document.querySelectorAll('#breakdownRows .breakdown-row');
        if (rows.length === 0) {
            showToast('Please add at least one pocket', 'error');
            return false;
        }

        // Check each row has a pocket selected and amount > 0
        const selectedPockets = [];
        let breakdownSum = 0;
        for (const row of rows) {
            const select = row.querySelector('select');
            const amountInput = row.querySelector('.breakdown-amount');
            const pocket = select.value;
            const amt = parseFloat(amountInput.value) || 0;

            if (!pocket) {
                showToast('Please select a pocket for each row', 'error');
                return false;
            }

            if (amt <= 0) {
                showToast('Each pocket amount must be greater than 0', 'error');
                return false;
            }

            if (selectedPockets.includes(pocket)) {
                showToast(`Duplicate pocket: ${pocket}. Each pocket can only be used once.`, 'error');
                return false;
            }

            selectedPockets.push(pocket);
            breakdownSum += amt;
        }

        // Sum must match transaction amount
        const totalAmount = parseFloat(amountValue);
        if (Math.round(breakdownSum) !== Math.round(totalAmount)) {
            const diff = totalAmount - breakdownSum;
            showToast(`Breakdown total (${formatRupiah(breakdownSum)}) does not match transaction amount (${formatRupiah(totalAmount)}). Difference: ${formatRupiah(Math.abs(diff))}`, 'error');
            return false;
        }
    }

    return true;
}

// =============================================
//  FORM SUBMISSION
// =============================================
document.getElementById('transactionForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!validateForm()) return;

    const transactionId = document.getElementById('transactionId').value;
    const isEdit = !!transactionId;
    const sourceType = getSourceType();

    // Parse budget month
    const budgetMonthVal = document.getElementById('budgetMonth').value;
    const [bYear, bMonth] = budgetMonthVal.split('-');

    const formData = {
        date: document.getElementById('date').value,
        type: document.querySelector('input[name="type"]:checked').value,
        ngapain: document.getElementById('ngapain').value,
        amount: document.getElementById('amount').value,
        budgetMonth: parseInt(bMonth),
        budgetYear: parseInt(bYear),
        sourceType: sourceType
    };

    if (sourceType === 'single') {
        formData.pocket = document.querySelector('input[name="pocket"]:checked').value;
        formData.sourceBreakdowns = [];
    } else {
        // Multi pocket
        const breakdowns = [];
        document.querySelectorAll('#breakdownRows .breakdown-row').forEach(row => {
            const pocket = row.querySelector('select').value;
            const amount = parseFloat(row.querySelector('.breakdown-amount').value) || 0;
            if (pocket && amount > 0) {
                breakdowns.push({ pocket, amount });
            }
        });
        formData.pocket = breakdowns[0]?.pocket || '';
        formData.sourceBreakdowns = breakdowns;
    }

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
            const msg = getRandomMessage(streakCount);

            // Launch confetti
            if (typeof launchConfetti === 'function') {
                launchConfetti(2500);
            }

            showToast(`${msg.emoji} ${msg.text}`, 'success', 3000);

            // Show success modal
            document.getElementById('successEmoji').textContent = msg.emoji;
            document.getElementById('successMessage').textContent = msg.text;
            document.getElementById('successModal').classList.add('show');
        } else {
            showToast(result.message || 'Error saving transaction', 'error');
        }

    } catch (error) {
        console.error('Error:', error);
        showToast('Network error occurred', 'error');
    }
});

// =============================================
//  ADD ANOTHER / RESET
// =============================================
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

    // Reset source type to single
    document.getElementById('sourceTypeSingle').checked = true;
    handleSourceTypeChange();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =============================================
//  CLOSED MONTHS
// =============================================
async function loadClosedMonths() {
    try {
        const response = await fetch('/api/budget/closed-months');
        const result = await response.json();

        if (result.success && result.data) {
            const closedKeys = result.data.map(c => c.key);
            const budgetSelect = document.getElementById('budgetMonth');
            if (budgetSelect) {
                Array.from(budgetSelect.options).forEach(option => {
                    if (closedKeys.includes(option.value)) {
                        option.disabled = true;
                        option.textContent = option.textContent.replace(' 🔒', '') + ' 🔒';
                        // If this was the selected option, deselect it
                        if (option.selected) {
                            // Select the first non-disabled option
                            const firstOpen = Array.from(budgetSelect.options).find(o => !o.disabled);
                            if (firstOpen) firstOpen.selected = true;
                        }
                    }
                });
            }
        }
    } catch (err) {
        console.error('Error loading closed months:', err);
    }
}

// =============================================
//  INIT
// =============================================
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

    // Source Type toggle listeners
    document.querySelectorAll('input[name="sourceType"]').forEach(radio => {
        radio.addEventListener('change', handleSourceTypeChange);
    });

    // Amount change listener — update breakdown total when amount changes
    document.getElementById('amount').addEventListener('input', () => {
        if (getSourceType() === 'multi') {
            updateBreakdownTotal();
        }
    });

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

// Close success modal on outside click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('successModal');
    if (e.target === modal) {
        modal.classList.remove('show');
    }
});

// Load closed months after budget month is populated
setTimeout(() => loadClosedMonths(), 300);