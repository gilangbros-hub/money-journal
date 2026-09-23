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

// Confetti is saved for these streak days; an ordinary save just gets a toast.
const STREAK_MILESTONES = [7, 30, 100];
let breakdownRowId = 0;
let closedMonthKeys = [];
let assignmentPreview = null;
const salaryCycleEnabled = document.getElementById('salaryCycleEnabled')?.value === 'true';
const expenseTypeManagementEnabled = document.getElementById('expenseTypeManagementEnabled')?.value === 'true';

// The type saved on the transaction being edited. It stays selectable even if
// it is missing from the managed list (archived since), so saving an edit
// never silently swaps the type for another one.
let pendingEditType = '';

// Remembered defaults: the last type/pocket saved, plus the pocket last used
// for each type. A manual pick in this visit wins over either of them.
const LAST_PICK_KEY = 'moneyJournalLastPick';
const POCKET_BY_TYPE_KEY = 'moneyJournalPocketByType';
let typeChosenManually = false;
let pocketChosenManually = false;
let saving = false;
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
    if (!badge) return;
    if (streak.count > 0) {
        badge.textContent = `\u{1F525} ${streak.count}d`;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

// localStorage can be missing or throw (private mode, blocked site data); the
// form must work the same without it, just without remembered defaults.
function readStoredJson(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        return value && typeof value === 'object' ? value : fallback;
    } catch (error) {
        return fallback;
    }
}

function writeStoredJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        // Remembered defaults are a convenience; ignore.
    }
}

function rememberPick(type, pocketId) {
    writeStoredJson(LAST_PICK_KEY, { type, pocketId: pocketId || '' });
    if (pocketId) {
        writeStoredJson(POCKET_BY_TYPE_KEY, { ...readStoredJson(POCKET_BY_TYPE_KEY, {}), [type]: pocketId });
    }
}

function rememberedType() {
    const type = readStoredJson(LAST_PICK_KEY, {}).type;
    return typeof type === 'string' ? type : '';
}

// ---------------------------------------------------------------------------
// Amount input: digits only, shown with '.' thousands separators (35.000),
// submitted as a plain digit string.
// ---------------------------------------------------------------------------

function amountDigits(value) {
    return String(value == null ? '' : value).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

function formatAmountDigits(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseAmountInput() {
    return amountDigits(document.getElementById('amount').value);
}

function setAmountInput(value) {
    const input = document.getElementById('amount');
    input.value = formatAmountDigits(amountDigits(value));
    try {
        input.setSelectionRange(input.value.length, input.value.length);
    } catch (error) {
        // Not focused or not supported; the caret position does not matter then.
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
    // A remembered custom type may only exist in the managed list, so give it
    // another chance now unless the user already picked a type.
    const remembered = editId || typeChosenManually ? '' : rememberedType();
    const next = [pendingEditType, remembered, previous].find((name) => name && names.includes(name)) || names[0];
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
        cadence: option.cadence || 'Monthly',
        bank: option.bank && option.bank.key ? option.bank : null
    }));
    managedPocketById.clear();
    managedPocketOptions.forEach((option) => managedPocketById.set(option.pocketId, option));

    restorePendingEditPocketSelections();
    if (!editId && !selectedManagedPocketId) applyRememberedPocket();

    renderManagedPocketSheet();
    renderManagedSingleDisplay();
    refreshAllDropdowns();
    updateBreakdownTotal();
}

// Preselect the pocket last used for the current type, else the last pocket
// used at all. Only pockets assigned for this Budget Month qualify.
function applyRememberedPocket({ typeOnly = false } = {}) {
    const byType = readStoredJson(POCKET_BY_TYPE_KEY, {})[getSelectedType()];
    const candidate = typeOnly ? byType : (byType || readStoredJson(LAST_PICK_KEY, {}).pocketId);
    if (typeof candidate === 'string' && managedPocketById.has(candidate)) {
        selectedManagedPocketId = candidate;
        renderManagedSingleDisplay();
    }
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
        + (option.bank && typeof bankLogoHtml === 'function'
            ? `<span class="picker-grid-bank">${bankLogoHtml(option.bank, 'sm')}<span>${escapeHtml(option.bank.name)}</span></span>`
            : '')
        + '</button>'
    )).join('');
}

function renderManagedSingleDisplay() {
    const display = document.getElementById('selectedPocketDisplay');
    if (!display) return;
    const option = managedPocketById.get(selectedManagedPocketId);
    if (option) {
        // Naming the bank tells you which card to pay with.
        display.textContent = `${option.emoji} ${option.name}${option.bank ? ` · ${option.bank.name}` : ''}`.trim();
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
    const splitToggle = document.getElementById('splitToggle');
    if (splitToggle) {
        splitToggle.textContent = sourceType === 'multi' ? 'Use one pocket' : 'Split across pockets';
        splitToggle.setAttribute('aria-expanded', String(sourceType === 'multi'));
    }

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
        <button type="button" class="breakdown-rest-btn" title="Fill with what is left to allocate">Rest</button>
        <button type="button" class="remove-pocket-btn" onclick="removeBreakdownRow('${rowId}')" title="Remove">x</button>
    `;

    document.getElementById('breakdownRows').appendChild(row);
    refreshAllDropdowns();
    updateBreakdownTotal();
}

// Put whatever is still unallocated into this row, so a split only needs the
// other rows typed in.
function fillBreakdownRest(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const input = row.querySelector('.breakdown-amount');
    const others = Array.from(document.querySelectorAll('#breakdownRows .breakdown-amount'))
        .filter((item) => item !== input)
        .reduce((sum, item) => sum + (parseFloat(item.value) || 0), 0);
    input.value = String(Math.max(0, getTransactionAmount() - others));
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
    return parseFloat(parseAmountInput()) || 0;
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
    const amountValue = getTransactionAmount();
    if (amountValue <= 0) {
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

        if (Math.round(breakdownSum) !== Math.round(amountValue)) {
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
        document.getElementById('deleteBtn').hidden = false;
        document.getElementById('deleteDetails').textContent = `${transaction.ngapain || transaction.type || 'Transaction'} · ${formatRupiah(Number(transaction.amount) || 0)}`;
        document.getElementById('ngapain').value = transaction.ngapain || '';
        setAmountInput(transaction.amount || '');

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

function openDeleteModal() {
    document.getElementById('deleteModal').classList.add('show');
    document.getElementById('deleteCancelBtn').focus();
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('show');
}

async function confirmDeleteTransaction() {
    const transactionId = document.getElementById('transactionId').value;
    if (!transactionId || saving) return;
    saving = true;
    try {
        const response = await fetch(`/api/transaction/${encodeURIComponent(transactionId)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`Delete failed with ${response.status}`);
        closeDeleteModal();
        showToast('Transaction deleted', 'success');
        setTimeout(() => {
            window.location.href = editReturnUrl();
        }, 800);
    } catch (error) {
        console.error('Error deleting transaction:', error);
        showToast('Could not delete transaction', 'error');
        saving = false;
    }
}

// After a save, clear what changes per entry (amount, note, split rows) and
// keep what usually repeats: date, Budget Month, type and pocket.
function resetForNextEntry() {
    setAmountInput('');
    document.getElementById('ngapain').value = '';
    if (getSourceType() !== 'single') {
        document.getElementById('sourceTypeSingle').checked = true;
        handleSourceTypeChange();
    }
    // Back to the top so the amount sits below the top toast, not under it.
    window.scrollTo(0, 0);
    document.getElementById('amount').focus({ preventScroll: true });
}

function readRawStreak() {
    try {
        return localStorage.getItem('moneyJournalStreak');
    } catch (error) {
        return null;
    }
}

function restoreStreak(previousValue) {
    try {
        if (previousValue === null) localStorage.removeItem('moneyJournalStreak');
        else localStorage.setItem('moneyJournalStreak', previousValue);
    } catch (error) {
        // Nothing to roll back if storage is unavailable.
    }
    displayStreak();
}

// Undo deletes the entry just saved and puts its values back in the form so
// a wrong amount or pocket can be fixed and saved again.
async function undoCreate(transactionId, snapshot, previousStreak) {
    try {
        const response = await fetch(`/api/transaction/${encodeURIComponent(transactionId)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`Undo failed with ${response.status}`);
    } catch (error) {
        console.error('Error undoing transaction:', error);
        showToast('Could not undo, the entry is still saved', 'error');
        return;
    }

    restoreStreak(previousStreak);
    setAmountInput(snapshot.amount);
    document.getElementById('ngapain').value = snapshot.note;
    setSelectedType(snapshot.type);
    if (snapshot.sourceType === 'multi') {
        document.getElementById('sourceTypeMulti').checked = true;
        handleSourceTypeChange();
        document.getElementById('breakdownRows').innerHTML = '';
        snapshot.breakdowns.forEach((item) => addBreakdownRow(item.pocketId, item.amount));
        updateBreakdownTotal();
    } else if (managedPocketById.has(snapshot.pocketId)) {
        selectManagedPocket(snapshot.pocketId);
    }
    showToast('Entry removed', 'success');
}

// Back returns to wherever Log Spending was opened from; a direct visit (no
// same-origin referrer) keeps the link's /monthly-story fallback.
function handleBackLink(event) {
    let sameOrigin = false;
    try {
        sameOrigin = new URL(document.referrer).origin === window.location.origin;
    } catch (error) {
        sameOrigin = false;
    }
    if (sameOrigin && window.history.length > 1) {
        event.preventDefault();
        window.history.back();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    displayStreak();
    document.getElementById('backLink')?.addEventListener('click', handleBackLink);

    document.getElementById('date').value = dateOnlyToday();
    updateDateDisplay();
    if (salaryCycleEnabled) loadAssignmentPreview();
    else populateBudgetMonthSelect();
    const remembered = rememberedType();
    const rememberedAvailable = remembered
        && document.querySelector(`input[name="type"][value="${CSS.escape(remembered)}"]`);
    setSelectedType(!editId && rememberedAvailable ? remembered : 'Eat');
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

    document.getElementById('splitToggle').addEventListener('click', () => {
        const next = getSourceType() === 'multi' ? 'sourceTypeSingle' : 'sourceTypeMulti';
        document.getElementById(next).checked = true;
        handleSourceTypeChange();
    });

    document.getElementById('breakdownRows').addEventListener('click', (event) => {
        const restButton = event.target.closest('.breakdown-rest-btn');
        if (restButton) fillBreakdownRest(restButton.closest('.breakdown-row').id);
    });

    document.getElementById('deleteBtn').addEventListener('click', openDeleteModal);
    document.getElementById('deleteCancelBtn').addEventListener('click', closeDeleteModal);
    document.getElementById('deleteConfirmBtn').addEventListener('click', confirmDeleteTransaction);

    const amountInput = document.getElementById('amount');
    amountInput.addEventListener('input', () => {
        setAmountInput(amountInput.value);
        if (getSourceType() === 'multi') updateBreakdownTotal();
    });
    if (!editId) amountInput.focus();

    document.getElementById('amountThousandsBtn').addEventListener('click', () => {
        const digits = parseAmountInput();
        if (digits) setAmountInput(`${digits}000`);
        amountInput.focus();
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
        typeChosenManually = true;
        setSelectedType(typeButton.dataset.typeOption);
        if (!editId && !pocketChosenManually) applyRememberedPocket({ typeOnly: true });
        closeSheet('typeSheet');
    });

    // Delegated so it keeps working as the grid's contents are replaced by
    // loading/error/empty/populated renders.
    document.getElementById('pocketSheet')?.addEventListener('click', (event) => {
        const managedButton = event.target.closest('[data-managed-pocket-option]');
        if (managedButton) {
            pocketChosenManually = true;
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
        // The form no longer sits behind a modal after saving, so guard
        // against a double tap creating the same entry twice.
        if (saving || !validateForm()) return;
        const transactionId = document.getElementById('transactionId').value;
        const isEdit = !!transactionId;
        const sourceType = getSourceType();
        const note = document.getElementById('ngapain').value;
        const formData = {
            expenseDate: document.getElementById('date').value,
            date: document.getElementById('date').value,
            type: getSelectedType(),
            // The server requires a note; like the Telegram bot's Skip, an
            // empty note falls back to the type name.
            ngapain: note.trim() || getSelectedType(),
            amount: parseAmountInput(),
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

        saving = true;
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
                const snapshot = {
                    amount: formData.amount,
                    note,
                    type: formData.type,
                    sourceType,
                    pocketId: formData.pocketId || '',
                    breakdowns: formData.sourceBreakdowns
                };
                rememberPick(formData.type, formData.pocketId);

                const previousStreak = readRawStreak();
                const streakBefore = getStreak().count;
                const streakCount = bumpStreak();
                displayStreak();
                const milestone = streakCount !== streakBefore && STREAK_MILESTONES.includes(streakCount);
                if (milestone && typeof launchConfetti === 'function') launchConfetti(2200);

                resetForNextEntry();
                const savedText = `Saved \u00B7 ${formatRupiah(Number(formData.amount))}`
                    + (milestone ? ` \u00B7 \u{1F525} ${streakCount}-day streak` : '');
                if (result.id) {
                    showToast(savedText, 'success', {
                        actionLabel: 'Undo',
                        onAction: () => undoCreate(result.id, snapshot, previousStreak)
                    });
                } else {
                    showToast(savedText, 'success');
                }
            } else {
                if (salaryCycleEnabled && response.status === 409) {
                    await loadAssignmentPreview();
                }
                showToast(previewErrorMessage(result, 'Error saving transaction'), 'error');
            }
        } catch (error) {
            console.error('Error saving transaction:', error);
            showToast('Network error occurred', 'error');
        } finally {
            saving = false;
        }
    });

    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('picker-sheet-overlay')) {
            event.target.classList.remove('show');
        }
        if (event.target === document.getElementById('deleteModal')) closeDeleteModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeDeleteModal();
    });
});
