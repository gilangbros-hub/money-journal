const TYPE_META = {
    Eat: { icon: '\u{1F37D}\uFE0F' },
    Snack: { icon: '\u{1F37F}' },
    Groceries: { icon: '\u{1F6D2}' },
    Laundry: { icon: '\u{1F9FA}' },
    Bensin: { icon: '\u26FD' },
    Flazz: { icon: '\u{1F4B3}' },
    'Home Appliance': { icon: '\u{1F3E0}' },
    'Jumat Berkah': { icon: '\u{1F932}' },
    'Uang Sampah': { icon: '\u{1F5D1}\uFE0F' },
    'Uang Keamanan': { icon: '\u{1F46E}' },
    Medicine: { icon: '\u{1F48A}' },
    Others: { icon: '\u{1F4E6}' }
};

const POCKET_META = {
    Kwintals: { icon: '\u{1F4B0}' },
    Groceries: { icon: '\u{1F966}' },
    'Weekday Transport': { icon: '\u{1F68C}' },
    'Weekend Transport': { icon: '\u{1F697}' },
    Investasi: { icon: '\u{1F4C8}' },
    Bandung: { icon: '\u26F0\uFE0F' },
    Sedeqah: { icon: '\u{1F932}' },
    IPL: { icon: '\u{1F3D8}\uFE0F' }
};

const POCKET_LIST = Object.keys(POCKET_META).map((key) => ({ key, emoji: POCKET_META[key].icon }));

const celebrationMessages = [
    { emoji: '\u{1F389}', text: 'Great job tracking!' },
    { emoji: '\u{1F4AA}', text: 'Discipline = freedom!' },
    { emoji: '\u2728', text: 'Every rupiah counts!' },
    { emoji: '\u{1F4CA}', text: 'Data is power!' }
];

let breakdownRowId = 0;
let closedMonthKeys = [];

const urlParams = new URLSearchParams(window.location.search);
const editId = urlParams.get('edit');

function getStreak() {
    const data = JSON.parse(localStorage.getItem('moneyJournalStreak') || '{"count":0,"lastDate":""}');
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (data.lastDate === today) return data;
    if (data.lastDate === yesterday) return { count: data.count, lastDate: data.lastDate };
    return { count: 0, lastDate: data.lastDate };
}

function bumpStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const current = getStreak();
    if (current.lastDate === today) return current.count;

    const newCount = current.count + 1;
    localStorage.setItem('moneyJournalStreak', JSON.stringify({ count: newCount, lastDate: today }));
    return newCount;
}

function displayStreak() {
    const streak = getStreak();
    const badge = document.getElementById('streakBadge');
    if (badge && streak.count > 0) {
        badge.textContent = `\u{1F525} ${streak.count}d`;
        badge.style.display = 'inline-flex';
    }
}

function formatDateTimeLabel(value) {
    const date = new Date(value);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' \u00B7 ' +
        date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getSelectedType() {
    return document.querySelector('input[name="type"]:checked')?.value || 'Eat';
}

function getSelectedPocket() {
    return document.querySelector('input[name="pocket"]:checked')?.value || 'Kwintals';
}

function setSelectedType(type) {
    const input = document.querySelector(`input[name="type"][value="${CSS.escape(type)}"]`);
    if (input) input.checked = true;
    updateTypeDisplay();
}

function setSelectedPocket(pocket) {
    const input = document.querySelector(`input[name="pocket"][value="${CSS.escape(pocket)}"]`);
    if (input) input.checked = true;
    updatePocketDisplay();
}

function updateTypeDisplay() {
    const type = getSelectedType();
    const display = document.getElementById('selectedTypeDisplay');
    display.textContent = `${TYPE_META[type]?.icon || ''} ${type}`;

    document.querySelectorAll('[data-type-option]').forEach((button) => {
        button.classList.toggle('is-selected', button.dataset.typeOption === type);
    });
}

function updatePocketDisplay() {
    const pocket = getSelectedPocket();
    const display = document.getElementById('selectedPocketDisplay');
    display.textContent = `${POCKET_META[pocket]?.icon || ''} ${pocket}`;

    document.querySelectorAll('[data-pocket-option]').forEach((button) => {
        button.classList.toggle('is-selected', button.dataset.pocketOption === pocket);
    });
}

function getSourceType() {
    return document.querySelector('input[name="sourceType"]:checked')?.value || 'single';
}

function handleSourceTypeChange() {
    const sourceType = getSourceType();
    const singleSection = document.getElementById('singlePocketSection');
    const multiSection = document.getElementById('multiPocketSection');
    const pocketTrigger = document.getElementById('pocketTrigger');

    if (sourceType === 'single') {
        singleSection.style.display = '';
        multiSection.style.display = 'none';
        pocketTrigger.style.display = 'flex';
        document.getElementById('breakdownRows').innerHTML = '';
        updateBreakdownTotal();
    } else {
        singleSection.style.display = 'none';
        multiSection.style.display = 'block';
        pocketTrigger.style.display = 'none';
        document.querySelectorAll('input[name="pocket"]').forEach((input) => { input.checked = false; });
        if (!document.getElementById('breakdownRows').children.length) addBreakdownRow();
    }
}

function getUsedPockets() {
    return Array.from(document.querySelectorAll('#breakdownRows select'))
        .map((select) => select.value)
        .filter(Boolean);
}

function getBreakdownRowCount() {
    return document.getElementById('breakdownRows').children.length;
}

function updateAddPocketBtnVisibility() {
    const btn = document.getElementById('addPocketBtn');
    if (btn) btn.style.display = getBreakdownRowCount() >= 3 ? 'none' : '';
}

function buildPocketOptions(selectedValue) {
    const used = getUsedPockets();
    const options = ['<option value="">Select pocket...</option>'];
    POCKET_LIST.forEach((pocket) => {
        const disabled = used.includes(pocket.key) && pocket.key !== selectedValue;
        options.push(`<option value="${pocket.key}" ${pocket.key === selectedValue ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${pocket.emoji} ${pocket.key}</option>`);
    });
    return options.join('');
}

function refreshAllDropdowns() {
    document.querySelectorAll('#breakdownRows select').forEach((select) => {
        const currentVal = select.value;
        select.innerHTML = buildPocketOptions(currentVal);
    });
    updateAddPocketBtnVisibility();
}

function addBreakdownRow(pocketVal = '', amountVal = '') {
    if (getBreakdownRowCount() >= 3) return;

    breakdownRowId += 1;
    const rowId = `breakdown-row-${breakdownRowId}`;
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.id = rowId;
    row.innerHTML = `
        <select onchange="onBreakdownPocketChange()">${buildPocketOptions(pocketVal)}</select>
        <input type="number" class="breakdown-amount" placeholder="0" value="${amountVal}" oninput="updateBreakdownTotal()" min="0">
        <button type="button" class="remove-pocket-btn" onclick="removeBreakdownRow('${rowId}')" title="Remove">x</button>
    `;

    document.getElementById('breakdownRows').appendChild(row);
    refreshAllDropdowns();
    updateBreakdownTotal();
}

function removeBreakdownRow(rowId) {
    document.getElementById(rowId)?.remove();
    refreshAllDropdowns();
    updateBreakdownTotal();
}

function onBreakdownPocketChange() {
    refreshAllDropdowns();
}

function getTransactionAmount() {
    return parseFloat(document.getElementById('amount').value) || 0;
}

function getBreakdownSum() {
    return Array.from(document.querySelectorAll('#breakdownRows .breakdown-amount'))
        .reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0);
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
        diffEl.textContent = 'Matched';
        diffEl.className = 'value matched';
        progressFill.style.width = '100%';
        progressFill.className = 'breakdown-progress-fill matched';
    } else if (diff > 0) {
        diffEl.textContent = `- ${formatRupiah(diff)} remaining`;
        diffEl.className = 'value unmatched';
        progressFill.style.width = `${Math.min((allocated / total) * 100, 100)}%`;
        progressFill.className = 'breakdown-progress-fill';
    } else {
        diffEl.textContent = `+ ${formatRupiah(Math.abs(diff))} over`;
        diffEl.className = 'value unmatched';
        progressFill.style.width = '100%';
        progressFill.className = 'breakdown-progress-fill over';
    }
}

function renderBudgetMonthOptions() {
    const select = document.getElementById('budgetMonth');
    const container = document.getElementById('budgetMonthOptions');
    const selectedValue = select.value;

    container.innerHTML = Array.from(select.options).map((option) => {
        const closed = option.disabled;
        const selected = option.value === selectedValue;
        return `
            <button
                type="button"
                class="transaction-budget-pill ${selected ? 'is-selected' : ''} ${closed ? 'is-locked' : ''}"
                data-budget-value="${option.value}"
                ${closed ? 'disabled' : ''}
            >
                ${closed ? '\u{1F512} ' : ''}${option.textContent.replace(' \u{1F512}', '')}
            </button>
        `;
    }).join('');
}

function populateBudgetMonthSelect(preselect) {
    const select = document.getElementById('budgetMonth');
    select.innerHTML = '';
    const now = new Date();

    for (let offset = -1; offset <= 1; offset += 1) {
        const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const value = `${year}-${String(month).padStart(2, '0')}`;
        const label = date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = preselect ? value === preselect : offset === 0;
        select.appendChild(option);
    }

    renderBudgetMonthOptions();
}

async function loadClosedMonths() {
    try {
        const response = await fetch('/api/budget/closed-months');
        const result = await response.json();

        if (result.success && result.data) {
            closedMonthKeys = result.data.map((month) => month.key);
            const budgetSelect = document.getElementById('budgetMonth');
            Array.from(budgetSelect.options).forEach((option) => {
                option.disabled = closedMonthKeys.includes(option.value);
            });

            if (budgetSelect.selectedOptions[0]?.disabled) {
                const firstOpen = Array.from(budgetSelect.options).find((option) => !option.disabled);
                if (firstOpen) budgetSelect.value = firstOpen.value;
            }

            renderBudgetMonthOptions();
        }
    } catch (error) {
        console.error('Error loading closed months:', error);
    }
}

function updateDateDisplay() {
    document.getElementById('dateDisplay').textContent = formatDateTimeLabel(document.getElementById('date').value);
}

function openSheet(id) {
    document.getElementById(id)?.classList.add('show');
}

function closeSheet(id) {
    document.getElementById(id)?.classList.remove('show');
}

function validateForm() {
    const amountValue = document.getElementById('amount').value;
    if (!amountValue || parseFloat(amountValue) <= 0) {
        showToast('Amount must be greater than 0', 'error');
        return false;
    }

    if (!getSelectedType()) {
        showToast('Please select an expense type', 'error');
        return false;
    }

    const sourceType = getSourceType();
    if (sourceType === 'single' && !getSelectedPocket()) {
        showToast('Please select a pocket source', 'error');
        return false;
    }

    if (sourceType === 'multi') {
        const rows = document.querySelectorAll('#breakdownRows .breakdown-row');
        if (!rows.length) {
            showToast('Please add at least one pocket', 'error');
            return false;
        }

        const selectedPockets = [];
        let breakdownSum = 0;
        for (const row of rows) {
            const pocket = row.querySelector('select').value;
            const amount = parseFloat(row.querySelector('.breakdown-amount').value) || 0;

            if (!pocket) {
                showToast('Please select a pocket for each row', 'error');
                return false;
            }
            if (amount <= 0) {
                showToast('Each pocket amount must be greater than 0', 'error');
                return false;
            }
            if (selectedPockets.includes(pocket)) {
                showToast(`Duplicate pocket: ${pocket}`, 'error');
                return false;
            }

            selectedPockets.push(pocket);
            breakdownSum += amount;
        }

        if (Math.round(breakdownSum) !== Math.round(parseFloat(amountValue))) {
            showToast('Pocket breakdown must match transaction amount', 'error');
            return false;
        }
    }

    return true;
}

async function loadTransactionForEdit(id) {
    try {
        const response = await fetch(`/api/transaction/${id}`);
        const transaction = await response.json();

        document.querySelector('.transaction-title').textContent = 'Edit Transaction';
        document.getElementById('submitBtn').textContent = 'Update Transaction';
        document.getElementById('transactionId').value = transaction._id;
        document.getElementById('ngapain').value = transaction.ngapain || '';
        document.getElementById('amount').value = transaction.amount || '';

        const date = new Date(transaction.date);
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        document.getElementById('date').value = date.toISOString().slice(0, 16);
        updateDateDisplay();

        setSelectedType(transaction.type || 'Eat');

        if (transaction.budgetMonth && transaction.budgetYear) {
            populateBudgetMonthSelect(`${transaction.budgetYear}-${String(transaction.budgetMonth).padStart(2, '0')}`);
        }

        if (transaction.sourceType === 'multi' && transaction.sourceBreakdowns?.length) {
            document.getElementById('sourceTypeMulti').checked = true;
            handleSourceTypeChange();
            document.getElementById('breakdownRows').innerHTML = '';
            transaction.sourceBreakdowns.forEach((item) => addBreakdownRow(item.pocket, item.amount));
            updateBreakdownTotal();
        } else {
            document.getElementById('sourceTypeSingle').checked = true;
            handleSourceTypeChange();
            setSelectedPocket(transaction.pocket || 'Kwintals');
        }
    } catch (error) {
        console.error('Error loading transaction:', error);
        showToast('Error loading transaction data', 'error');
    }
}

function addAnother() {
    document.getElementById('successModal').classList.remove('show');
    document.getElementById('transactionForm').reset();
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('date').value = now.toISOString().slice(0, 16);
    updateDateDisplay();
    populateBudgetMonthSelect();
    document.getElementById('sourceTypeSingle').checked = true;
    setSelectedType('Eat');
    setSelectedPocket('Kwintals');
    handleSourceTypeChange();
}

document.addEventListener('DOMContentLoaded', () => {
    displayStreak();

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('date').value = now.toISOString().slice(0, 16);
    updateDateDisplay();
    populateBudgetMonthSelect();
    setSelectedType('Eat');
    setSelectedPocket('Kwintals');
    handleSourceTypeChange();
    loadClosedMonths();

    if (editId) loadTransactionForEdit(editId);

    document.querySelectorAll('input[name="sourceType"]').forEach((radio) => {
        radio.addEventListener('change', handleSourceTypeChange);
    });

    document.getElementById('amount').addEventListener('input', () => {
        if (getSourceType() === 'multi') updateBreakdownTotal();
    });

    document.getElementById('date').addEventListener('change', updateDateDisplay);

    document.getElementById('categoryTrigger').addEventListener('click', () => openSheet('typeSheet'));
    document.getElementById('pocketTrigger').addEventListener('click', () => openSheet('pocketSheet'));

    document.querySelectorAll('[data-close-sheet]').forEach((button) => {
        button.addEventListener('click', () => closeSheet(button.dataset.closeSheet));
    });

    document.querySelectorAll('[data-type-option]').forEach((button) => {
        button.addEventListener('click', () => {
            setSelectedType(button.dataset.typeOption);
            closeSheet('typeSheet');
        });
    });

    document.querySelectorAll('[data-pocket-option]').forEach((button) => {
        button.addEventListener('click', () => {
            setSelectedPocket(button.dataset.pocketOption);
            closeSheet('pocketSheet');
        });
    });

    document.getElementById('budgetMonthOptions').addEventListener('click', (event) => {
        const button = event.target.closest('[data-budget-value]');
        if (!button || button.disabled) return;
        document.getElementById('budgetMonth').value = button.dataset.budgetValue;
        renderBudgetMonthOptions();
    });

    document.getElementById('transactionForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!validateForm()) return;

        const transactionId = document.getElementById('transactionId').value;
        const isEdit = !!transactionId;
        const sourceType = getSourceType();
        const [budgetYear, budgetMonth] = document.getElementById('budgetMonth').value.split('-');

        const formData = {
            date: document.getElementById('date').value,
            type: getSelectedType(),
            ngapain: document.getElementById('ngapain').value,
            amount: document.getElementById('amount').value,
            budgetMonth: parseInt(budgetMonth, 10),
            budgetYear: parseInt(budgetYear, 10),
            sourceType
        };

        if (sourceType === 'single') {
            formData.pocket = getSelectedPocket();
            formData.sourceBreakdowns = [];
        } else {
            const breakdowns = Array.from(document.querySelectorAll('#breakdownRows .breakdown-row')).map((row) => ({
                pocket: row.querySelector('select').value,
                amount: parseFloat(row.querySelector('.breakdown-amount').value) || 0
            })).filter((item) => item.pocket && item.amount > 0);

            formData.pocket = breakdowns[0]?.pocket || '';
            formData.sourceBreakdowns = breakdowns;
        }

        try {
            const response = await fetch(isEdit ? `/api/transaction/${transactionId}` : '/api/transaction', {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const result = await response.json();

            if (response.ok && result.success) {
                const streakCount = bumpStreak();
                const msg = celebrationMessages[Math.floor(Math.random() * celebrationMessages.length)];
                const streakSuffix = streakCount > 1 ? ` ${streakCount}d streak` : '';
                if (typeof launchConfetti === 'function') launchConfetti(2200);

                document.getElementById('successEmoji').textContent = msg.emoji;
                document.getElementById('successMessage').textContent = `${msg.text}${streakSuffix}`;
                document.getElementById('successModal').classList.add('show');
            } else {
                showToast(result.message || 'Error saving transaction', 'error');
            }
        } catch (error) {
            console.error('Error saving transaction:', error);
            showToast('Network error occurred', 'error');
        }
    });

    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('picker-sheet-overlay')) {
            event.target.classList.remove('show');
        }
        if (event.target === document.getElementById('successModal')) {
            document.getElementById('successModal').classList.remove('show');
        }
    });
});
