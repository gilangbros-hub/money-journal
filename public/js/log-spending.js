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

const celebrationMessages = [
    { emoji: '\u{1F389}', text: 'Great job tracking!' },
    { emoji: '\u{1F4AA}', text: 'Discipline = freedom!' },
    { emoji: '\u2728', text: 'Every rupiah counts!' },
    { emoji: '\u{1F4CA}', text: 'Data is power!' }
];

let breakdownRowId = 0;
let closedMonthKeys = [];
let assignmentPreview = null;
const salaryCycleEnabled = document.getElementById('salaryCycleEnabled')?.value === 'true';
const expenseTypeManagementEnabled = document.getElementById('expenseTypeManagementEnabled')?.value === 'true';

// The type saved on the transaction being edited. It stays selectable even if
// it is missing from the managed list (archived since), so saving an edit
// never silently swaps the type for another one.
let pendingEditType = '';

// Pocket source is always assignment-backed: fetched from
// /api/expense-pocket-options as soon as the Budget Month is known (page
// load, then again on every date/edit change), never from a hardcoded list.
// `pocketOptionsLoaded`/`pocketOptionsError` drive the sheet's loading, error,
// and empty states — there is no fixed-pocket fallback to flash in behind.
let pocketOptionsLoaded = false;
let pocketOptionsError = false;
let managedPocketOptions = [];
const managedPocketById = new Map();
let selectedManagedPocketId = '';
let pendingEditSinglePocketId = '';
let pendingEditBreakdowns = null;

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function localDateKey(offsetDays = 0) {
    const date = new Date();
    if (offsetDays) date.setDate(date.getDate() + offsetDays);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateOnlyToday() {
    return localDateKey();
}

function formatDateOnlyLabel(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'Select date';
    const [year, month, day] = value.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return 'Select date';
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(day).padStart(2, '0')} ${monthNames[month - 1]} ${year}`;
}

const urlParams = new URLSearchParams(window.location.search);
const editId = urlParams.get('edit');

function getStreak() {
    const data = JSON.parse(localStorage.getItem('moneyJournalStreak') || '{"count":0,"lastDate":""}');
    const today = dateOnlyToday();
    const yesterday = localDateKey(-1);

    if (data.lastDate === today) return data;
    if (data.lastDate === yesterday) return { count: data.count, lastDate: data.lastDate };
    return { count: 0, lastDate: data.lastDate };
}

function bumpStreak() {
    const today = dateOnlyToday();
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

function canonicalExpenseDate(transaction) {
    const value = transaction?.expenseDate ?? transaction?.date;
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function formatDateTimeLabel(value) {
    return formatDateOnlyLabel(value);
}

function getSelectedType() {
    return document.querySelector('input[name="type"]:checked')?.value || 'Eat';
}

function setSelectedType(type) {
    const input = document.querySelector(`input[name="type"][value="${CSS.escape(type)}"]`);
    if (input) input.checked = true;
    updateTypeDisplay();
}

// ---------------------------------------------------------------------------
// Expense type options. The server-rendered list is the fallback; with Expense
// Type Management on, the managed Active types replace it so types created on
// /expense-type-management show up here as they already do in the Telegram bot.
// ---------------------------------------------------------------------------

function renderTypeOptions(types) {
    const hidden = document.querySelector('.transaction-hidden-types');
    const grid = document.querySelector('#typeSheet .picker-grid');
    if (!hidden || !grid) return;

    hidden.innerHTML = types.map((type) => (
        `<input type="radio" name="type" value="${escapeHtml(type.name)}" class="option-input type-hidden-input" data-type-label="${escapeHtml(type.name)}" required>`
    )).join('');
    grid.innerHTML = types.map((type) => (
        `<button type="button" class="picker-grid-item" data-type-option="${escapeHtml(type.name)}">`
        + `<span class="picker-grid-icon">${escapeHtml(type.emoji)}</span>`
        + `<span>${escapeHtml(type.name)}</span>`
        + '</button>'
    )).join('');
}

function currentTypeOptions() {
    return Array.from(document.querySelectorAll('input[name="type"]')).map((input) => ({
        name: input.value,
        emoji: TYPE_META[input.value]?.icon || ''
    }));
}

function ensureTypeOption(type) {
    if (!type || document.querySelector(`input[name="type"][value="${CSS.escape(type)}"]`)) return;
    renderTypeOptions([...currentTypeOptions(), { name: type, emoji: TYPE_META[type]?.icon || '\u{1F4E6}' }]);
}

function applyManagedExpenseTypes(activeTypes) {
    const previous = document.querySelector('input[name="type"]:checked')?.value || '';
    const types = activeTypes
        .filter((type) => type && typeof type.name === 'string' && type.name)
        .map((type) => ({ name: type.name, emoji: type.emoji || '' }));
    if (!types.length) return;

    if (pendingEditType && !types.some((type) => type.name === pendingEditType)) {
        types.push({ name: pendingEditType, emoji: TYPE_META[pendingEditType]?.icon || '\u{1F4E6}' });
    }
    types.forEach((type) => {
        TYPE_META[type.name] = { icon: type.emoji || TYPE_META[type.name]?.icon || '' };
    });
    renderTypeOptions(types);

    const names = types.map((type) => type.name);
    const next = [pendingEditType, previous].find((name) => name && names.includes(name)) || names[0];
    setSelectedType(next);
}

async function loadManagedExpenseTypes() {
    if (!expenseTypeManagementEnabled) return false;
    let result;
    try {
        const response = await fetch('/api/expense-types');
        if (!response.ok) return false;
        result = await response.json();
    } catch (error) {
        // Keep the server-rendered list; a picker that still works beats an error toast.
        return false;
    }
    if (!result || result.success !== true || !Array.isArray(result.data?.active)) return false;
    applyManagedExpenseTypes(result.data.active);
    return true;
}

function updateTypeDisplay() {
    const type = getSelectedType();
    const display = document.getElementById('selectedTypeDisplay');
    display.textContent = `${TYPE_META[type]?.icon || ''} ${type}`;

    document.querySelectorAll('[data-type-option]').forEach((button) => {
        button.classList.toggle('is-selected', button.dataset.typeOption === type);
    });
}

// ---------------------------------------------------------------------------
// Pocket source options (assignment-backed).
// ---------------------------------------------------------------------------

function expensePocketOptionsQuery() {
    // The server derives the Budget_Month from a salary-cycle expense date or,
    // in legacy budgeting, from the selected Budget_Month.
    if (salaryCycleEnabled) {
        const date = document.getElementById('date')?.value || '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
        return `date=${encodeURIComponent(date)}`;
    }
    const month = document.getElementById('budgetMonth')?.value || '';
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    return `month=${encodeURIComponent(month)}`;
}

async function loadManagedPocketOptions() {
    const query = expensePocketOptionsQuery();
    if (!query) return false;
    let result;
    try {
        const response = await fetch(`/api/expense-pocket-options?${query}`);
        if (!response.ok) {
            pocketOptionsError = true;
            renderManagedPocketSheet();
            renderManagedSingleDisplay();
            return false;
        }
        result = await response.json();
    } catch (error) {
        pocketOptionsError = true;
        renderManagedPocketSheet();
        renderManagedSingleDisplay();
        return false;
    }
    if (!result || result.success !== true || !Array.isArray(result.data)) {
        pocketOptionsError = true;
        renderManagedPocketSheet();
        renderManagedSingleDisplay();
        return false;
    }
    applyManagedPocketOptions(result.data);
    return true;
}

function restorePendingEditPocketSelections() {
    // Preserve a still-valid selection; otherwise fall back to a pending edit
    // reference so re-opening the picker restores the saved pocket.
    if (selectedManagedPocketId && !managedPocketById.has(selectedManagedPocketId)) {
        selectedManagedPocketId = '';
    }
    if (!selectedManagedPocketId && pendingEditSinglePocketId && managedPocketById.has(pendingEditSinglePocketId)) {
        selectedManagedPocketId = pendingEditSinglePocketId;
    }

    // Rebuild split rows keyed by pocketId when editing an existing managed
    // split expense so each row restores its saved assignment.
    if (pendingEditBreakdowns && getSourceType() === 'multi') {
        const rows = document.getElementById('breakdownRows');
        if (rows) {
            rows.innerHTML = '';
            pendingEditBreakdowns.forEach((item) => addBreakdownRow(item.pocketId || '', item.amount));
        }
        pendingEditBreakdowns = null;
    }
}

function applyManagedPocketOptions(options) {
    pocketOptionsLoaded = true;
    pocketOptionsError = false;
    managedPocketOptions = options.map((option) => ({
        pocketId: String(option.pocketId),
        name: option.name || '',
        emoji: option.emoji || '',
        cadence: option.cadence || 'Monthly'
    }));
    managedPocketById.clear();
    managedPocketOptions.forEach((option) => managedPocketById.set(option.pocketId, option));

    restorePendingEditPocketSelections();

    renderManagedPocketSheet();
    renderManagedSingleDisplay();
    refreshAllDropdowns();
    updateBreakdownTotal();
}

function pocketSheetGrid() {
    return document.querySelector('#pocketSheet .picker-grid');
}

function renderManagedPocketSheet() {
    const grid = pocketSheetGrid();
    if (!grid) return;
    if (pocketOptionsError) {
        grid.innerHTML = '<div class="col-span-full text-center py-4" data-pocket-error>'
            + '<p class="text-sm font-semibold">Could not load pockets.</p>'
            + '<button type="button" class="btn-ghost inline-flex items-center justify-center gap-1 mt-3" data-retry-pockets>Retry</button>'
            + '</div>';
        return;
    }
    if (!pocketOptionsLoaded) {
        grid.innerHTML = '<div class="col-span-full text-center py-4" data-pocket-loading>'
            + '<p class="text-sm" style="color: var(--journal-soft-ink, inherit);">Loading pockets…</p>'
            + '</div>';
        return;
    }
    if (!managedPocketOptions.length) {
        // Zero assignments for the derived Budget_Month: show a Start setup
        // action instead of substituting fixed pockets (Requirements 5.14-5.15).
        grid.innerHTML = '<div class="col-span-full text-center py-4" data-managed-empty>'
            + '<p class="text-sm font-semibold">No pockets assigned for this Budget Month yet.</p>'
            + '<a href="/pocket-management" class="btn-neon inline-flex items-center justify-center gap-1 mt-3" data-start-setup aria-label="Start Budget Month pocket setup">Start setup</a>'
            + '</div>';
        return;
    }
    grid.innerHTML = managedPocketOptions.map((option) => (
        `<button type="button" class="picker-grid-item" data-managed-pocket-option="${escapeHtml(option.pocketId)}">`
        + `<span class="picker-grid-icon">${escapeHtml(option.emoji)}</span>`
        + `<span>${escapeHtml(option.name)}</span>`
        + '</button>'
    )).join('');
}

function renderManagedSingleDisplay() {
    const display = document.getElementById('selectedPocketDisplay');
    if (!display) return;
    const option = managedPocketById.get(selectedManagedPocketId);
    if (option) {
        display.textContent = `${option.emoji} ${option.name}`.trim();
    } else if (pocketOptionsError) {
        display.textContent = 'Could not load pockets';
    } else if (!pocketOptionsLoaded) {
        display.textContent = 'Loading…';
    } else {
        display.textContent = managedPocketOptions.length ? 'Select pocket…' : 'No pockets assigned';
    }

    document.querySelectorAll('#pocketSheet [data-managed-pocket-option]').forEach((button) => {
        button.classList.toggle('is-selected', button.dataset.managedPocketOption === selectedManagedPocketId);
    });
}

function selectManagedPocket(pocketId) {
    selectedManagedPocketId = pocketId;
    renderManagedSingleDisplay();
}

function managedPocketName(pocketId) {
    return managedPocketById.get(pocketId)?.name || '';
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
        if (!pocketOptionsLoaded) loadManagedPocketOptions();
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
    // Selects are keyed by immutable pocketId and labelled from the assignment
    // snapshot (archived-but-assigned pockets are included by the server
    // exactly once).
    managedPocketOptions.forEach((pocket) => {
        const disabled = used.includes(pocket.pocketId) && pocket.pocketId !== selectedValue;
        options.push(`<option value="${escapeHtml(pocket.pocketId)}" ${pocket.pocketId === selectedValue ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${escapeHtml(`${pocket.emoji} ${pocket.name}`.trim())}</option>`);
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
    if (!select || !container) return;
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
    if (!select) return;
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
    if (salaryCycleEnabled) return;
    try {
        const response = await fetch('/api/budget/closed-months');
        const result = await response.json();

        if (result.success && result.data) {
            closedMonthKeys = result.data.map((month) => month.key);
            const budgetSelect = document.getElementById('budgetMonth');
            if (!budgetSelect) return;
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

let assignmentRequestSequence = 0;

function setDateError(message = '') {
    const error = document.getElementById('dateError');
    const input = document.getElementById('date');
    if (error) error.textContent = message;
    if (input) {
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
    }
}

function previewErrorMessage(result, fallback = 'Unable to resolve Budget Month') {
    return result?.error?.message || result?.message || fallback;
}

async function loadAssignmentPreview() {
    if (!salaryCycleEnabled) return true;

    const date = document.getElementById('date').value;
    const submit = document.getElementById('submitBtn');
    const derived = document.getElementById('derivedBudgetMonth');
    const period = document.getElementById('derivedBudgetPeriod');
    const requestSequence = ++assignmentRequestSequence;

    assignmentPreview = null;
    submit.disabled = true;
    setDateError('');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        if (requestSequence !== assignmentRequestSequence) return false;
        derived.textContent = 'Enter a valid date';
        period.textContent = '';
        setDateError('Date must be a valid YYYY-MM-DD calendar date.');
        return false;
    }

    derived.textContent = 'Checking…';
    period.textContent = '';

    try {
        const response = await fetch(`/api/salary-cycle/assignment?date=${encodeURIComponent(date)}`);
        const result = await response.json();
        if (requestSequence !== assignmentRequestSequence) return false;
        if (!response.ok || !result.success) {
            setDateError(previewErrorMessage(result, 'Date must be a valid calendar date.'));
            derived.textContent = 'Unable to resolve';
            return false;
        }

        assignmentPreview = result.data;
        derived.textContent = result.data.budgetMonth;
        const previewPeriod = result.data.period || result.data.salaryCyclePeriod;
        period.textContent = previewPeriod
            ? `${previewPeriod.startDate} – ${previewPeriod.endDate}`
            : '';
        submit.disabled = false;
        return true;
    } catch (error) {
        if (requestSequence !== assignmentRequestSequence) return false;
        assignmentPreview = null;
        derived.textContent = 'Unable to resolve';
        period.textContent = '';
        setDateError(error.message || 'Unable to resolve Budget Month');
        return false;
    }
}

function openSheet(id) {
    document.getElementById(id)?.classList.add('show');
}

function closeSheet(id) {
    document.getElementById(id)?.classList.remove('show');
}

function validateForm() {
    if (salaryCycleEnabled && !assignmentPreview) {
        showToast('Choose a valid expense date first', 'error');
        return false;
    }
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
    if (sourceType === 'single' && !selectedManagedPocketId) {
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
                const duplicateLabel = managedPocketName(pocket) || 'pocket';
                showToast(`Duplicate pocket: ${duplicateLabel}`, 'error');
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

        const canonicalDate = canonicalExpenseDate(transaction);
        document.getElementById('date').value = canonicalDate;
        updateDateDisplay();
        if (salaryCycleEnabled) await loadAssignmentPreview();

        pendingEditType = transaction.type || '';
        ensureTypeOption(pendingEditType);
        setSelectedType(transaction.type || 'Eat');

        if (!salaryCycleEnabled && transaction.budgetMonth && transaction.budgetYear) {
            populateBudgetMonthSelect(`${transaction.budgetYear}-${String(transaction.budgetMonth).padStart(2, '0')}`);
        }

        // Retain any managed identifiers so the assignment-backed picker can
        // restore the saved pocket once options load (managed mode only).
        pendingEditSinglePocketId = transaction.pocketId ? String(transaction.pocketId) : '';
        pendingEditBreakdowns = Array.isArray(transaction.sourceBreakdowns)
            ? transaction.sourceBreakdowns.map((item) => ({
                pocketId: item.pocketId ? String(item.pocketId) : '',
                pocket: item.pocket,
                amount: item.amount
            }))
            : null;

        if (transaction.sourceType === 'multi' && transaction.sourceBreakdowns?.length) {
            document.getElementById('sourceTypeMulti').checked = true;
            handleSourceTypeChange();
            document.getElementById('breakdownRows').innerHTML = '';
            transaction.sourceBreakdowns.forEach((item) => addBreakdownRow(item.pocket, item.amount));
            updateBreakdownTotal();
        } else {
            document.getElementById('sourceTypeSingle').checked = true;
            handleSourceTypeChange();
        }
        // The eager fetch kicked off at page load may already have resolved by
        // the time this transaction fetch completes; if so, restore the saved
        // pocket now instead of waiting on a load that already happened.
        if (pocketOptionsLoaded) {
            restorePendingEditPocketSelections();
            renderManagedPocketSheet();
            renderManagedSingleDisplay();
            refreshAllDropdowns();
        }
    } catch (error) {
        console.error('Error loading transaction:', error);
        showToast('Error loading transaction data', 'error');
    }
}

// After saving an edit, go back to the page the edit was opened from (Monthly
// Story or Review History), falling back to Review History.
function editReturnUrl() {
    try {
        const referrer = new URL(document.referrer);
        if (referrer.origin === window.location.origin && referrer.pathname !== window.location.pathname) {
            return `${referrer.pathname}${referrer.search}`;
        }
    } catch (error) {
        // No or unparseable referrer.
    }
    return '/review-history';
}

function addAnother() {
    document.getElementById('successModal').classList.remove('show');
    document.getElementById('transactionForm').reset();
    document.getElementById('date').value = dateOnlyToday();
    updateDateDisplay();
    if (salaryCycleEnabled) loadAssignmentPreview();
    else populateBudgetMonthSelect();
    document.getElementById('sourceTypeSingle').checked = true;
    setSelectedType('Eat');
    handleSourceTypeChange();
    selectedManagedPocketId = '';
    renderManagedSingleDisplay();
}

document.addEventListener('DOMContentLoaded', () => {
    displayStreak();

    document.getElementById('date').value = dateOnlyToday();
    updateDateDisplay();
    if (salaryCycleEnabled) loadAssignmentPreview();
    else populateBudgetMonthSelect();
    setSelectedType('Eat');
    loadManagedExpenseTypes();
    handleSourceTypeChange();
    loadClosedMonths();
    // Fetch pocket options immediately so the sheet has real data by the time
    // anyone could plausibly open it, instead of waiting for that interaction.
    renderManagedPocketSheet();
    renderManagedSingleDisplay();
    loadManagedPocketOptions();

    if (editId) loadTransactionForEdit(editId);

    document.querySelectorAll('input[name="sourceType"]').forEach((radio) => {
        radio.addEventListener('change', handleSourceTypeChange);
    });

    document.getElementById('amount').addEventListener('input', () => {
        if (getSourceType() === 'multi') updateBreakdownTotal();
    });

    document.getElementById('date').addEventListener('change', () => {
        updateDateDisplay();
        if (salaryCycleEnabled) loadAssignmentPreview();
        // The Budget_Month may have changed; refresh pocket options for it.
        loadManagedPocketOptions();
    });

    document.getElementById('categoryTrigger').addEventListener('click', () => openSheet('typeSheet'));
    document.getElementById('pocketTrigger').addEventListener('click', () => openSheet('pocketSheet'));
    
    document.getElementById('dateTrigger').addEventListener('click', (e) => {
        const dateInput = document.getElementById('date');
        if (typeof dateInput.showPicker === 'function') {
            try {
                dateInput.showPicker();
            } catch (err) {
                // Ignore, native picker is likely already opening or unsupported
            }
        } else {
            dateInput.focus();
        }
    });

    document.querySelectorAll('[data-close-sheet]').forEach((button) => {
        button.addEventListener('click', () => closeSheet(button.dataset.closeSheet));
    });

    // Delegated so it keeps working after managed types replace the grid.
    document.getElementById('typeSheet')?.addEventListener('click', (event) => {
        const typeButton = event.target.closest('[data-type-option]');
        if (!typeButton) return;
        setSelectedType(typeButton.dataset.typeOption);
        closeSheet('typeSheet');
    });

    // Delegated so it keeps working as the grid's contents are replaced by
    // loading/error/empty/populated renders.
    document.getElementById('pocketSheet')?.addEventListener('click', (event) => {
        const managedButton = event.target.closest('[data-managed-pocket-option]');
        if (managedButton) {
            selectManagedPocket(managedButton.dataset.managedPocketOption);
            closeSheet('pocketSheet');
            return;
        }
        if (event.target.closest('[data-retry-pockets]')) {
            pocketOptionsError = false;
            renderManagedPocketSheet();
            loadManagedPocketOptions();
        }
    });

    const budgetMonthOptions = document.getElementById('budgetMonthOptions');
    if (budgetMonthOptions) {
        budgetMonthOptions.addEventListener('click', (event) => {
            const button = event.target.closest('[data-budget-value]');
            if (!button || button.disabled) return;
            document.getElementById('budgetMonth').value = button.dataset.budgetValue;
            renderBudgetMonthOptions();
        });
    }

    document.getElementById('transactionForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!validateForm()) return;

        const transactionId = document.getElementById('transactionId').value;
        const isEdit = !!transactionId;
        const sourceType = getSourceType();
        const formData = {
            expenseDate: document.getElementById('date').value,
            date: document.getElementById('date').value,
            type: getSelectedType(),
            ngapain: document.getElementById('ngapain').value,
            amount: document.getElementById('amount').value,
            sourceType
        };

        if (!salaryCycleEnabled) {
            const [budgetYear, budgetMonth] = document.getElementById('budgetMonth').value.split('-');
            formData.budgetMonth = parseInt(budgetMonth, 10);
            formData.budgetYear = parseInt(budgetYear, 10);
        }

        if (sourceType === 'single') {
            // Submit the immutable assignment identifier; keep the snapshot
            // name as the legacy compatibility projection the server retains.
            formData.pocketId = selectedManagedPocketId;
            formData.pocket = managedPocketName(selectedManagedPocketId);
            formData.sourceBreakdowns = [];
        } else {
            const breakdowns = Array.from(document.querySelectorAll('#breakdownRows .breakdown-row')).map((row) => {
                const pocketId = row.querySelector('select').value;
                return {
                    pocketId,
                    pocket: managedPocketName(pocketId),
                    amount: parseFloat(row.querySelector('.breakdown-amount').value) || 0
                };
            }).filter((item) => item.pocketId && item.amount > 0);

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

            if (response.ok && result.success && isEdit) {
                // An edit is not a new day of tracking: no streak bump, no confetti.
                showToast('Transaction updated', 'success');
                setTimeout(() => {
                    window.location.href = editReturnUrl();
                }, 800);
            } else if (response.ok && result.success) {
                const streakCount = bumpStreak();
                const msg = celebrationMessages[Math.floor(Math.random() * celebrationMessages.length)];
                const streakSuffix = streakCount > 1 ? ` ${streakCount}d streak` : '';
                if (typeof launchConfetti === 'function') launchConfetti(2200);

                document.getElementById('successEmoji').textContent = msg.emoji;
                document.getElementById('successMessage').textContent = `${msg.text}${streakSuffix}`;
                document.getElementById('successModal').classList.add('show');
            } else {
                if (salaryCycleEnabled && response.status === 409) {
                    await loadAssignmentPreview();
                }
                showToast(previewErrorMessage(result, 'Error saving transaction'), 'error');
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
