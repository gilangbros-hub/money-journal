'use strict';

// Check Pockets is server-driven when salary-cycle budgeting is enabled. The
// disabled path intentionally retains the legacy calendar-month UI/API.
let currentMonth;
let currentYear;
let currentBudgetMonth = null;
let currentSelectedWeek = null;
let canEdit = false;
let budgetFeatureEnabled = false;
let selectedPocket = null;
let selectedCadence = 'Monthly';
let selectedWeek = null;
let selectedAllocationType = 'monthly';
let budgetPieChart = null;
let currentBudgetData = null;
let pendingCadenceChange = null;
let budgetLoadSequence = 0;
// Managed Pocket Management state. `pocketManagementActive` flips on only when a
// server budget view reports `pocketManagementEnabled`, so every feature-off
// (fixed-pocket) interaction below stays byte-for-byte unchanged.
let pocketManagementActive = false;
let activeBudgetMonth = null;
let initialBudgetLoad = true;

const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function element(id) {
    return document.getElementById(id);
}

function message(text, type = 'error') {
    if (typeof showToast === 'function') showToast(text, type);
}

function errorMessage(result, fallback) {
    return result?.error?.message || result?.message || fallback;
}

function responseDataMonth(data) {
    if (typeof data?.budgetMonth === 'string') return data.budgetMonth;
    if (typeof data?.key === 'string' && parseMonthKey(data.key)) return data.key;
    if (Number.isInteger(data?.year) && Number.isInteger(data?.month)) {
        return `${String(data.year).padStart(4, '0')}-${String(data.month).padStart(2, '0')}`;
    }
    return null;
}

function parseMonthKey(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return { year, month };
}

function moveMonthKey(value, direction) {
    const parsed = parseMonthKey(value);
    if (!parsed) return value;
    let { year, month } = parsed;
    month += direction;
    if (month > 12) { month = 1; year += 1; }
    if (month < 1) { month = 12; year -= 1; }
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function monthLabel(value) {
    const parsed = parseMonthKey(value);
    return parsed ? `${MONTH_NAMES[parsed.month - 1]} ${parsed.year}` : value || 'Budget Month';
}

function updateMonthDisplay() {
    const display = element('currentMonth');
    if (!display) return;
    if (budgetFeatureEnabled && currentBudgetMonth) {
        display.textContent = monthLabel(currentBudgetMonth);
    } else if (currentMonth && currentYear) {
        display.textContent = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;
    }
}

function currency(value, formatted) {
    if (formatted !== undefined && formatted !== null && formatted !== '') return formatted;
    if (typeof formatRupiah === 'function') return formatRupiah(value || 0);
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

function metricValue(pocket, metric, formattedName) {
    const metrics = pocket?.metrics || {};
    return currency(metrics[metric] ?? pocket?.[metric === 'spending' ? 'spent' : metric], pocket?.[formattedName]);
}

function allocationText(allocation, missing) {
    const amount = currency(allocation?.budget ?? allocation?.amount ?? 0);
    return missing ? `Missing · ${amount}` : amount;
}

function setText(node, value) {
    if (node) node.textContent = value == null ? '' : String(value);
}

function setMutationControlsEnabled(enabled) {
    document.querySelectorAll('[data-mutation-control]').forEach(control => {
        control.disabled = !enabled;
        control.setAttribute('aria-disabled', String(!enabled));
    });
    document.querySelectorAll('[data-save-monthly-allocation], [data-save-weekly-allocation]').forEach(control => {
        control.disabled = !enabled;
    });
}

function renderServerState(data) {
    const state = element('budgetState');
    if (!state) return;
    const closed = element('closedBudgetState');
    const outside = element('outOfWindowState');
    const isClosed = data.isClosed === true;
    const editable = data.canEdit === true && !isClosed;
    state.classList.toggle('hidden', editable);
    state.classList.toggle('bg-coral\/10', isClosed);
    state.classList.toggle('bg-amber\/20', !isClosed);
    if (closed) closed.classList.toggle('hidden', !isClosed);
    if (outside) outside.classList.toggle('hidden', isClosed || editable);
    setMutationControlsEnabled(editable);
}

function renderHealthSummary(data) {
    const pockets = Array.isArray(data.pockets) ? data.pockets : [];
    const aggregate = data.aggregate || {};
    const chartPockets = pockets
        .map(pocket => ({
            ...pocket,
            chartAllocation: Number(pocket.periodMetrics?.allocation ?? pocket.metrics?.allocation ?? pocket.budget ?? 0)
        }))
        .filter(pocket => pocket.chartAllocation > 0);
    const labels = chartPockets.map(pocket => `${pocket.icon || ''} ${pocket.pocket}`.trim());
    const values = chartPockets.map(pocket => pocket.chartAllocation);
    const colors = chartPockets.map((_, index) => {
        const palette = typeof chartColors !== 'undefined' && chartColors.length ? chartColors : ['#FF4D6D', '#7C3AED', '#22C55E', '#F59E0B'];
        return palette[index % palette.length];
    });
    const canvas = element('budgetPieChart');
    if (canvas && typeof Chart === 'function') {
        if (budgetPieChart && typeof budgetPieChart.destroy === 'function') budgetPieChart.destroy();
        budgetPieChart = values.length ? new Chart(canvas, {
            type: 'doughnut',
            data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#1E293B' }] },
            options: { responsive: true, maintainAspectRatio: true, cutout: '60%', plugins: { legend: { display: false } } }
        }) : null;
    }

    setText(element('totalBudgetDisplay'), data.formattedTotal || currency(aggregate.allocation));
    setText(element('totalSpentDisplay'), data.formattedSpent || currency(aggregate.spending));
    const remaining = Number(aggregate.remaining ?? data.totalRemaining ?? 0);
    setText(element('totalRemainingDisplay'), data.formattedRemaining || `${remaining < 0 ? '-' : ''}${currency(Math.abs(remaining))}`);
    const remainingEl = element('totalRemainingDisplay');
    if (remainingEl) remainingEl.className = `text-sm font-bold ${remaining < 0 ? 'text-coral' : 'text-lime'}`;
}

function allocationLabel(allocation, fallback) {
    if (!allocation) return `${fallback || 'Missing'} (Rp 0)`;
    return `${allocation.isoWeekYear ? `${allocation.isoWeekYear}-W${String(allocation.isoWeekNumber).padStart(2, '0')} ` : ''}${currency(allocation.budget ?? allocation.amount)}`;
}

function inactiveAllocations(pocket, nextCadence) {
    if (nextCadence === pocket.cadence) return [];
    if (nextCadence === 'Weekly' && pocket.monthlyAllocation) {
        return [{ label: `Monthly allocation: ${currency(pocket.monthlyAllocation.budget ?? pocket.monthlyAllocation.amount)}` }];
    }
    if (nextCadence === 'Monthly' && Array.isArray(pocket.weeklyAllocations)) {
        return pocket.weeklyAllocations.map(allocation => ({
            label: `Weekly ${allocation.isoWeekYear}-W${String(allocation.isoWeekNumber).padStart(2, '0')}: ${currency(allocation.budget ?? allocation.amount)}`
        }));
    }
    return [];
}

function renderCadenceConfirmation(pocket, cadence, allocations) {
    const template = element('inactiveAllocationConfirmationTemplate');
    if (!template) return false;
    const content = template.content ? template.content.cloneNode(true) : null;
    if (!content) return false;
    const modal = content.firstElementChild;
    if (!modal) return false;
    const list = modal.querySelector('#inactiveAllocationList');
    if (list) {
        list.innerHTML = allocations.map(item => `<li>${item.label}</li>`).join('');
    }
    document.body.appendChild(modal);
    pendingCadenceChange = { pocket: pocket.pocket, cadence, modal };
    modal.querySelector('[data-cancel-cadence]')?.addEventListener('click', cancelCadenceChange);
    modal.querySelector('[data-confirm-cadence]')?.addEventListener('click', confirmCadenceChange);
    return true;
}

function cancelCadenceChange() {
    const pending = pendingCadenceChange;
    pendingCadenceChange = null;
    pending?.modal?.remove();
    const pocket = currentBudgetData?.pockets?.find(item => item.pocket === pending?.pocket);
    const card = pocket && document.querySelector(`[data-pocket-card][data-pocket="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(pocket.pocket) : pocket.pocket}"]`);
    const select = card?.querySelector('[data-cadence-select]');
    if (select && pocket) select.value = pocket.cadence;
}

async function confirmCadenceChange() {
    const pending = pendingCadenceChange;
    pendingCadenceChange = null;
    pending?.modal?.remove();
    if (pending) await submitCadenceChange(pending.pocket, pending.cadence, true);
}

async function submitCadenceChange(pocket, cadence, confirmed) {
    if (!budgetFeatureEnabled || !canEdit || !currentBudgetMonth) return;
    try {
        const response = await fetch('/api/budget/cadence', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pocket, budgetMonth: currentBudgetMonth, cadence, confirmInactive: confirmed === true })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(errorMessage(result, 'Unable to change cadence'));
        message('Cadence updated', 'success');
        await loadBudgets(currentBudgetMonth, currentSelectedWeek);
    } catch (error) {
        message(error.message || 'Unable to change cadence');
        await loadBudgets(currentBudgetMonth, currentSelectedWeek);
    }
}

async function changeCadence(pocketName, cadence) {
    if (!budgetFeatureEnabled || !canEdit || currentDataIsClosed()) return;
    const pocket = currentBudgetData?.pockets?.find(item => item.pocket === pocketName);
    const inactive = pocket ? inactiveAllocations(pocket, cadence) : [];
    if (inactive.length && renderCadenceConfirmation(pocket, cadence, inactive)) return;
    await submitCadenceChange(pocketName, cadence, inactive.length > 0);
}

function currentDataIsClosed() {
    return currentBudgetData?.isClosed === true;
}

function renderWeeklySelector(card, pocket) {
    const selector = card.querySelector('[data-week-selector]');
    if (!selector) return;
    const weeks = pocket.availableWeeks || currentBudgetData.availableWeeks || [];
    const selected = pocket.selectedWeek?.key || currentDataSelectedWeek() || weeks[0]?.key || '';
    selector.innerHTML = weeks.map(week => `<option value="${week.key}">${week.key} · ${week.startDate} – ${week.endDate}</option>`).join('');
    selector.value = selected;
    const descriptor = weeks.find(week => week.key === selected) || pocket.selectedWeek || weeks[0];
    setText(card.querySelector('[data-week-label]'), descriptor ? `${descriptor.key} · ${descriptor.startDate} – ${descriptor.endDate}` : 'No calendar weeks');
    setText(card.querySelector('[data-week-intersection-label]'), descriptor
        ? `Salary-cycle intersection: ${descriptor.intersectionStartDate} – ${descriptor.intersectionEndDate}`
        : 'Salary-cycle intersection: —');
    selector.addEventListener('change', () => loadBudgets(currentBudgetMonth, selector.value));
}

function currentDataSelectedWeek() {
    return currentBudgetData?.selectedWeek || currentSelectedWeek;
}

function renderEnabledBudgets(data) {
    currentBudgetData = data;
    currentBudgetMonth = responseDataMonth(data) || currentBudgetMonth;
    currentSelectedWeek = data.selectedWeek || null;
    canEdit = data.canEdit === true && data.isClosed !== true;
    updateMonthDisplay();
    const period = data.period || data.salaryCyclePeriod;
    setText(element('salaryCyclePeriod'), period ? `${period.startDate} – ${period.endDate}` : 'Salary-cycle period unavailable');
    renderServerState(data);
    renderHealthSummary(data);
    installCloseBanner(data);

    const list = element('budgetList');
    if (!list) return;
    const pockets = Array.isArray(data.pockets) ? data.pockets : [];
    if (!pockets.length) {
        // Managed mode treats zero assignments as an intentional empty state:
        // zero assigned pockets, a combined total of zero, no fixed-pocket
        // substitution, and a Start setup action on the active month
        // (Requirements 5.14, 5.15, 7.12). Feature-off keeps the legacy copy.
        if (data.pocketManagementEnabled === true) renderManagedEmptyState(list, data);
        else list.innerHTML = '<p class="text-center text-text-muted py-5">No pockets configured</p>';
        return;
    }
    const monthlyTemplate = element('monthlyPocketCardTemplate');
    const weeklyTemplate = element('weeklyPocketCardTemplate');
    list.innerHTML = '';
    pockets.forEach(pocket => {
        const template = pocket.cadence === 'Weekly' ? weeklyTemplate : monthlyTemplate;
        if (!template?.content?.firstElementChild) return;
        const card = template.content.firstElementChild.cloneNode(true);
        card.dataset.pocket = pocket.pocket;
        card.dataset.cadence = pocket.cadence || 'Monthly';
        card.dataset.missingAllocation = String(pocket.missingAllocation === true || !pocket.allocation);
        setText(card.querySelector('[data-pocket-icon]'), pocket.icon || '');
        setText(card.querySelector('[data-pocket-name]'), pocket.pocket);
        const readonlyCadence = card.querySelector('[data-cadence-readonly]');
        if (readonlyCadence) setText(readonlyCadence, pocket.cadence || 'Monthly');
        const cadenceSelect = card.querySelector('[data-cadence-select]');
        if (cadenceSelect) {
            cadenceSelect.value = pocket.cadence || 'Monthly';
            cadenceSelect.setAttribute('aria-label', `Budget cadence for ${pocket.pocket}`);
            cadenceSelect.addEventListener('change', event => changeCadence(pocket.pocket, event.target.value));
        }
        const metrics = pocket.metrics || {};
        const missingAllocation = pocket.missingAllocation === true || !pocket.allocation;
        const allocationNode = card.querySelector('[data-pocket-allocation]');
        setText(allocationNode, missingAllocation
            ? allocationText(pocket.allocation, true)
            : metricValue(pocket, 'allocation', 'formattedBudget'));
        allocationNode?.setAttribute('data-missing-allocation', String(missingAllocation));
        allocationNode?.setAttribute('aria-label', missingAllocation ? 'Missing allocation, Rp 0' : 'Active allocation');
        setText(card.querySelector('[data-pocket-spending]'), metricValue(pocket, 'spending', 'formattedSpent'));
        setText(card.querySelector('[data-pocket-remaining]'), metricValue(pocket, 'remaining', 'formattedRemaining'));
        setText(card.querySelector('[data-pocket-percentage]'), `${metrics.percentageUsed ?? pocket.percentageUsed ?? pocket.percentage ?? 0}%`);
        const progress = card.querySelector('[data-pocket-progress]');
        const progressFill = card.querySelector('[data-pocket-progress-fill]');
        const percentage = Number(metrics.percentageUsed ?? pocket.percentageUsed ?? pocket.percentage ?? 0);
        progress?.setAttribute('aria-valuenow', String(percentage));
        if (progressFill) progressFill.style.width = `${Math.min(Math.max(percentage, 0), 100)}%`;
        if (pocket.cadence === 'Weekly') renderWeeklySelector(card, pocket);

        const monthlySave = card.querySelector('[data-save-monthly-allocation]');
        const weeklySave = card.querySelector('[data-save-weekly-allocation]');
        const save = pocket.cadence === 'Weekly' ? weeklySave : monthlySave;
        save?.addEventListener('click', () => openAllocationModal(pocket, pocket.cadence === 'Weekly' ? 'weekly' : 'monthly', pocket.selectedWeek?.key || currentDataSelectedWeek()));
        card.classList.toggle('opacity-50', data.isClosed === true);
        card.setAttribute('aria-disabled', String(!canEdit));
        list.appendChild(card);
    });
    setMutationControlsEnabled(canEdit);
}

function renderLegacyBudgets(data) {
    currentBudgetData = data;
    const serverMonth = responseDataMonth(data);
    const parsedServerMonth = parseMonthKey(serverMonth);
    if (parsedServerMonth) {
        currentMonth = parsedServerMonth.month;
        currentYear = parsedServerMonth.year;
        updateMonthDisplay();
    } else if (data.month && data.year) {
        currentMonth = data.month;
        currentYear = data.year;
        updateMonthDisplay();
    }
    const list = element('budgetList');
    if (!list) return;
    renderHealthSummary(data);
    if (!data.pockets?.length) {
        list.innerHTML = '<p class="text-center text-text-muted py-5">No pockets configured</p>';
        return;
    }
    const editable = data.canEdit !== false && canEdit;
    const statusColor = status => status === 'danger' ? 'text-coral' : status === 'warning' ? 'text-amber' : 'text-lime';
    const barColor = status => status === 'danger' ? 'bg-coral' : status === 'warning' ? 'bg-amber' : 'bg-lime';
    list.innerHTML = data.pockets.map(pocket => `
        <div class="bg-bg-secondary p-4 rounded-2xl flex items-center justify-between shadow-card border border-border/50 ${editable ? 'cursor-pointer' : ''}"
             onclick="${editable ? `openEditModal('${pocket.pocket}', '${pocket.icon || ''}', ${pocket.budget || 0}, 'Monthly', '')` : ''}">
            <div class="flex-1">
                <div class="flex items-center gap-2.5 mb-2"><span class="text-2xl">${pocket.icon || ''}</span><span class="text-sm font-semibold text-text-primary">${pocket.pocket}</span></div>
                <div class="progress-track"><div class="progress-fill ${barColor(pocket.status)}" style="width: ${Math.min(pocket.percentage || 0, 100)}%"></div></div>
                <div class="flex justify-between text-[11px] mt-1.5"><span class="text-text-muted">${pocket.formattedSpent || currency(pocket.spent)}</span><span class="${pocket.isOver ? 'text-coral' : 'text-lime'}">${pocket.isOver ? '-' : ''}${pocket.formattedRemaining || currency(Math.abs(pocket.remaining || 0))} left</span></div>
            </div>
            <div class="text-right min-w-[80px] ml-3"><span class="text-base font-bold block">${pocket.budget === 0 ? 'Rp 0' : (pocket.formattedBudget || currency(pocket.budget))}</span><span class="text-xs font-bold ${statusColor(pocket.status)} block mt-1">${pocket.percentage || 0}%</span></div>
        </div>`).join('');
}

// Render the managed zero-assignment empty state. The health summary already
// shows the zero combined total from the server aggregate; here we add a text
// status and, for the active Budget_Month a Wife can edit, a Start setup action
// that links to the Pocket Management page (Requirements 5.14, 5.15).
function renderManagedEmptyState(list, data) {
    const monthKey = responseDataMonth(data) || currentBudgetMonth;
    const isActiveMonth = !!activeBudgetMonth && monthKey === activeBudgetMonth;
    const showStartSetup = data.canEdit === true && isActiveMonth;
    const parts = [
        '<div class="text-center py-6" data-managed-empty>',
        '<p class="text-sm font-semibold" style="color: var(--journal-ink);">No pockets assigned for this Budget Month yet.</p>',
        '<p class="text-xs mt-1" style="color: var(--journal-soft-ink);">The combined allocation total stays Rp 0 until assignments are set up.</p>'
    ];
    if (showStartSetup) {
        parts.push('<a href="/pocket-management" class="btn-modal-save inline-flex items-center justify-center gap-1 mt-4" data-start-setup aria-label="Start Budget Month pocket setup"><span class="material-symbols-outlined" aria-hidden="true">tune</span>Start setup</a>');
    }
    parts.push('</div>');
    list.innerHTML = parts.join('');
}

function renderBudgets(data) {
    const managed = !!data && data.pocketManagementEnabled === true;
    if (managed) pocketManagementActive = true;
    if (initialBudgetLoad) {
        // The first view is loaded without an explicit month, so it reflects the
        // active Budget_Month. Retaining it lets the managed empty state offer
        // Start setup only for the active month (Requirement 5.15).
        activeBudgetMonth = responseDataMonth(data);
        initialBudgetLoad = false;
    }
    // Managed budget views are already salary-cycle aware and carry the same
    // server-driven shape as the enabled path, so they use it regardless of the
    // legacy salary-cycle flag; feature-off (neither flag) stays legacy.
    if (budgetFeatureEnabled || managed) renderEnabledBudgets(data);
    else renderLegacyBudgets(data);
}

async function loadBudgets(monthKey, weekKey) {
    const requestSequence = ++budgetLoadSequence;
    try {
        let url = '/api/budget';
        if (!budgetFeatureEnabled && !pocketManagementActive) {
            const requested = monthKey || (
                Number.isInteger(currentYear) && Number.isInteger(currentMonth)
                    ? `${currentYear}-${String(currentMonth).padStart(2, '0')}`
                    : null
            );
            if (requested) url += `?month=${encodeURIComponent(requested)}`;
        } else {
            const params = new URLSearchParams();
            if (monthKey) params.set('month', monthKey);
            if (weekKey) params.set('week', weekKey);
            const query = params.toString();
            if (query) url += `?${query}`;
        }
        const response = await fetch(url);
        const result = await response.json();
        const data = result?.data ?? result;
        if (!response.ok || (result?.data === undefined && result?.success === false) || (result?.data !== undefined && result.success !== true)) {
            throw new Error(errorMessage(result, 'Error loading budgets'));
        }
        // Ignore a slower response from an older navigation request. Month and
        // week state must always reflect the most recently requested server view.
        if (requestSequence !== budgetLoadSequence) return null;
        renderBudgets(data);
        return data;
    } catch (error) {
        if (requestSequence !== budgetLoadSequence) return null;
        console.error('Load budgets error:', error);
        message(error.message || 'Network error');
        const list = element('budgetList');
        if (list) list.setAttribute('aria-busy', 'false');
        return null;
    } finally {
        if (requestSequence === budgetLoadSequence) element('budgetList')?.setAttribute('aria-busy', 'false');
    }
}

function navigateMonth(direction) {
    if (budgetFeatureEnabled || pocketManagementActive) {
        if (!currentBudgetMonth) return;
        currentSelectedWeek = null;
        loadBudgets(moveMonthKey(currentBudgetMonth, direction));
        return;
    }
    currentMonth += direction;
    if (currentMonth > 12) { currentMonth = 1; currentYear += 1; }
    if (currentMonth < 1) { currentMonth = 12; currentYear -= 1; }
    updateMonthDisplay();
    loadBudgets();
}

function openAllocationModal(pocket, allocationType, week) {
    if (!canEdit || currentDataIsClosed()) return;
    selectedPocket = pocket.pocket;
    selectedCadence = pocket.cadence || 'Monthly';
    selectedAllocationType = allocationType;
    selectedWeek = week || null;
    const allocation = allocationType === 'weekly'
        ? pocket.selectedWeek?.allocation
        : pocket.monthlyAllocation || pocket.allocation;
    setText(element('modalPocket'), `${pocket.icon || ''} ${pocket.pocket}`);
    const input = element('budgetInput');
    if (input) input.value = allocation ? (allocation.budget ?? allocation.amount ?? '') : '';
    element('editModal')?.classList.add('show');
    input?.focus();
}

function openEditModal(pocket, icon, budget, cadence = 'Monthly', week = '') {
    if (!canEdit) return;
    selectedPocket = pocket;
    selectedCadence = cadence;
    selectedAllocationType = budgetFeatureEnabled && cadence === 'Weekly' ? 'weekly' : 'monthly';
    selectedWeek = week || null;
    setText(element('modalPocket'), `${icon || ''} ${pocket}`);
    const input = element('budgetInput');
    if (input) input.value = budget || '';
    element('editModal')?.classList.add('show');
    input?.focus();
}

function closeModal() {
    element('editModal')?.classList.remove('show');
    selectedPocket = null;
    selectedWeek = null;
}

async function saveBudget() {
    const raw = element('budgetInput')?.value?.trim() || '';
    if (!/^\d+$/.test(raw)) {
        message('Please enter a valid budget');
        return;
    }
    const amount = Number(raw);
    if (!Number.isSafeInteger(amount) || amount < 0) {
        message('Please enter a valid budget');
        return;
    }
    try {
        let endpoint;
        let method;
        let payload;
        if (budgetFeatureEnabled) {
            const weekly = selectedAllocationType === 'weekly';
            if (!currentBudgetMonth || (weekly && !selectedWeek)) {
                message(weekly ? 'Select a calendar week first' : 'Budget Month is unavailable');
                return;
            }
            endpoint = weekly ? '/api/budget/allocation/weekly' : '/api/budget/allocation/monthly';
            method = 'PUT';
            payload = { pocket: selectedPocket, budgetMonth: currentBudgetMonth, amount };
            if (weekly) payload.isoWeek = selectedWeek;
        } else {
            endpoint = '/api/budget';
            method = 'POST';
            payload = { pocket: selectedPocket, month: currentMonth, year: currentYear, budget: amount };
        }
        const response = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(errorMessage(result, 'Error saving budget'));
        message('Budget saved!', 'success');
        closeModal();
        await loadBudgets(currentBudgetMonth, currentSelectedWeek);
    } catch (error) {
        console.error('Save budget error:', error);
        message(error.message || 'Network error');
    }
}

async function showHistory() {
    element('historyModal')?.classList.add('show');
    const history = element('historyList');
    if (history) history.innerHTML = '<p class="text-center text-text-muted py-5">Loading...</p>';
    try {
        const response = await fetch('/api/budget/history');
        const result = await response.json();
        if (result.success && result.data.length > 0) {
            history.innerHTML = result.data.map(item => `<div class="flex justify-between p-3.5 border-b border-border cursor-pointer" data-history-month="${item.budgetMonth || `${item.year}-${String(item.month).padStart(2, '0')}`}" onclick="goToMonth('${item.budgetMonth || `${item.year}-${String(item.month).padStart(2, '0')}`}')"><span class="font-semibold">${item.monthLabel}</span><span class="font-bold">${item.formattedTotal}</span></div>`).join('');
        } else if (history) history.innerHTML = '<p class="text-center text-text-muted py-5">No history yet</p>';
    } catch (error) {
        if (history) history.innerHTML = '<p class="text-center text-coral py-5">Error loading</p>';
    }
}

function closeHistoryModal() {
    element('historyModal')?.classList.remove('show');
}

function goToMonth(monthOrKey, year) {
    const key = typeof monthOrKey === 'string' ? monthOrKey : `${year}-${String(monthOrKey).padStart(2, '0')}`;
    if (budgetFeatureEnabled) {
        loadBudgets(key);
    } else {
        const parsed = parseMonthKey(key);
        if (parsed) { currentMonth = parsed.month; currentYear = parsed.year; }
        updateMonthDisplay();
        loadBudgets();
    }
    closeHistoryModal();
}

async function toggleMonthClose() {
    const action = document.querySelector('#closeBanner .text-coral') ? 'close' : 'reopen';
    if (!window.confirm(`Are you sure you want to ${action} this entire month?`)) return;
    try {
        const response = await fetch('/api/budget/toggle-month-close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ budgetMonth: currentBudgetMonth || `${currentYear}-${String(currentMonth).padStart(2, '0')}` })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(errorMessage(result, 'Error'));
        message(result.message, 'success');
        await loadBudgets(currentBudgetMonth, currentSelectedWeek);
    } catch (error) {
        message(error.message || 'Network error');
    }
}

function installCloseBanner(data) {
    const existing = element('closeBanner');
    existing?.remove();
    const role = element('userRole')?.value;
    if (role !== 'Wife' || !budgetFeatureEnabled) return;
    const sectionHeader = document.querySelector('.section-header');
    if (!sectionHeader) return;
    const banner = document.createElement('div');
    banner.id = 'closeBanner';
    if (data.isClosed) {
        banner.className = 'bg-coral/10 p-3 px-4 rounded-xl text-sm mb-4 flex items-center justify-between';
        banner.innerHTML = '<span class="text-coral font-bold">🔒 This month is closed</span><button type="button" class="text-xs font-bold text-lime" onclick="toggleMonthClose()">🔓 Reopen Month</button>';
    } else if (data.canEdit) {
        banner.className = 'flex justify-end mb-4';
        banner.innerHTML = '<button type="button" class="text-xs font-bold text-coral" onclick="toggleMonthClose()">🔒 Close This Month</button>';
    } else return;
    sectionHeader.insertAdjacentElement('afterend', banner);
}

// Classic browser scripts expose these handlers for the existing inline actions
// in the legacy template. Explicit assignment also keeps jsdom execution and
// module-like test harnesses equivalent to a browser-loaded script.
if (typeof window !== 'undefined') {
    Object.assign(window, {
        changeCadence,
        closeHistoryModal,
        closeModal,
        goToMonth,
        openEditModal,
        saveBudget,
        showHistory,
        toggleMonthClose
    });
}

document.addEventListener('DOMContentLoaded', () => {
    budgetFeatureEnabled = element('salaryCycleEnabled')?.value === 'true';
    canEdit = element('canEdit')?.value === 'true';
    if (!budgetFeatureEnabled) {
        // Legacy mode still gets its initial month from the server response.
        // It must not classify the budget using the device calendar.
        currentMonth = null;
        currentYear = null;
    }
    element('prevMonth')?.addEventListener('click', () => navigateMonth(-1));
    element('nextMonth')?.addEventListener('click', () => navigateMonth(1));
    loadBudgets();
});

document.addEventListener('click', event => {
    if (event.target === element('editModal')) closeModal();
    if (event.target === element('historyModal')) closeHistoryModal();
});

// Exports are intentionally globals because the existing Handlebars page uses
// inline handlers for the legacy feature-off view and month-close controls.
