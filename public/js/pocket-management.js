'use strict';

// =============================================================================
// Pocket Management client module (Task 6.2)
//
// This is the browser state module for the Pocket Management interface delivered
// by views/pocket-management.hbs (Task 6.1). It is an ID-keyed, staged-state
// module: nothing about pocket selection, amount mode, or draft amounts is
// persisted until the Wife user explicitly confirms. Only the pending action is
// disabled while a request is in flight, canonical success responses replace
// local state, and failed requests retain the user's inputs so a Retry (or a
// version-conflict keep/load recovery) can proceed without data loss.
//
// Requirements covered here:
//  - 5.3-5.4   selection is staged (add/remove once) without touching the server
//  - 6.6-6.7   Use Default <-> Customize prefill/restore, never persisting
//  - 10.7-10.9 version-conflict keep-entered / load-current recovery
//  - 11.5-11.12 ordered workflow, summary, field-error association, pending/
//               success/failure status within 200ms, retry, unassigned count
//
// The server (routes/pockets.js -> pocketManagementService) is authoritative for
// weeks, cadence snapshots, defaults, versions, and validation. This module
// treats every success DTO as the new source of truth and never invents server
// state.
// =============================================================================

(function pocketManagementModule() {
    // -------------------------------------------------------------------------
    // Small DOM helpers
    // -------------------------------------------------------------------------
    const byId = (id) => document.getElementById(id);
    const q = (selector, root = document) => (root ? root.querySelector(selector) : null);
    const qa = (selector, root = document) => (root ? Array.from(root.querySelectorAll(selector)) : []);

    const MONTH_NAMES = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    const MONTHLY_KEY = 'monthly';
    const MAX_RUPIAH = 999999999999;
    const ALLOCATION_FIELD_PREFIX = 'allocations.';

    // -------------------------------------------------------------------------
    // Module state
    //
    // `definitionState` and `assignmentEntries` are both keyed by pocketId. Each
    // definition record retains the last-saved DTO plus the set of in-flight
    // request ids that target it. Each assignment entry retains the entered
    // (staged) values, the loaded assignment version, and any server field
    // errors so a rejected confirmation can be recovered without re-entry.
    // -------------------------------------------------------------------------
    const state = {
        bootstrap: { canEdit: false, role: 'Husband', pocketManagementEnabled: false, pocketManagementDualWriteEnabled: false },
        includeArchived: false,
        // pocketId -> { dto, pendingRequestIds:Set<string> }
        definitionState: new Map(),
        // canonical setup DTO for the currently-selected Budget Month
        setup: { dto: null, budgetMonth: null, weeks: [] },
        // pocketId -> staged assignment entry (see buildEntryFromDefinition)
        assignmentEntries: new Map(),
        // requestId -> config for every in-flight mutation (pending actions only)
        pendingRequests: new Map(),
        // active version-conflict recovery context, if any
        conflict: null,
        // stack of open dialogs so focus is trapped and restored per dialog
        dialogStack: [],
        requestCounter: 0
    };

    let els = {};

    // -------------------------------------------------------------------------
    // Formatting helpers
    // -------------------------------------------------------------------------
    function formatRupiah(amount) {
        if (typeof window !== 'undefined' && typeof window.formatRupiah === 'function') {
            return window.formatRupiah(amount);
        }
        const value = Number(amount);
        if (!Number.isFinite(value)) return 'Rp 0';
        return 'Rp ' + Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function parseMonthKey(value) {
        const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (month < 1 || month > 12) return null;
        return { year, month };
    }

    function monthLabel(key) {
        const parsed = parseMonthKey(key);
        return parsed ? `${MONTH_NAMES[parsed.month - 1]} ${parsed.year}` : String(key || '');
    }

    function currentCalendarMonthKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Convert a raw text input value into the amount payload the server expects.
    // A clean non-negative whole number becomes a Number; anything else is passed
    // through so the server returns the authoritative field-specific error rather
    // than the client silently masking an invalid value.
    function toAmountPayload(raw) {
        const text = String(raw == null ? '' : raw).trim();
        if (/^\d+$/.test(text)) {
            const value = Number(text);
            if (Number.isSafeInteger(value) && value >= 0 && value <= MAX_RUPIAH) return value;
        }
        return text === '' ? null : text;
    }

    function amountDisplay(raw) {
        const text = String(raw == null ? '' : raw).trim();
        if (/^\d+$/.test(text)) return formatRupiah(Number(text));
        return text === '' ? formatRupiah(0) : text;
    }

    // -------------------------------------------------------------------------
    // Status + error announcement (Req 11.7-11.10)
    // -------------------------------------------------------------------------
    function setStatusText(node, text) {
        if (node) node.textContent = text || '';
    }

    function announceGlobalStatus(text) {
        setStatusText(els.globalStatus, text || '');
    }

    function messageForError(error) {
        if (!error) return 'The request could not be completed. Please retry.';
        if (error.code === 'NETWORK_ERROR') return 'Network error. Please retry.';
        return error.message || 'The request could not be completed. Please retry.';
    }

    let globalRetryHandler = null;
    function showGlobalError(reason, retryHandler) {
        globalRetryHandler = typeof retryHandler === 'function' ? retryHandler : null;
        if (els.globalError) els.globalError.textContent = reason || '';
        if (els.globalErrorBanner) els.globalErrorBanner.classList.remove('hidden');
        if (els.globalErrorMessage) els.globalErrorMessage.textContent = reason || '';
        if (els.globalRetry) {
            if (globalRetryHandler) els.globalRetry.hidden = false;
            else els.globalRetry.hidden = true;
        }
    }

    function hideGlobalError() {
        globalRetryHandler = null;
        if (els.globalError) els.globalError.textContent = '';
        if (els.globalErrorBanner) els.globalErrorBanner.classList.add('hidden');
        if (els.globalErrorMessage) els.globalErrorMessage.textContent = '';
        if (els.globalRetry) els.globalRetry.hidden = true;
    }

    // -------------------------------------------------------------------------
    // Field-error helpers (Req 11.7 — adjacent + programmatic association)
    // -------------------------------------------------------------------------
    function ensureDescribedBy(input, errorId) {
        if (!input || !errorId) return;
        const existing = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        if (!existing.includes(errorId)) {
            existing.push(errorId);
            input.setAttribute('aria-describedby', existing.join(' '));
        }
    }

    function showFieldError(input, errorEl, message) {
        if (errorEl) {
            errorEl.textContent = message || 'This value is invalid.';
            errorEl.classList.remove('hidden');
            errorEl.hidden = false;
            if (input && errorEl.id) ensureDescribedBy(input, errorEl.id);
        }
        if (input) input.setAttribute('aria-invalid', 'true');
    }

    function clearFieldError(input, errorEl) {
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.add('hidden');
        }
        if (input) input.setAttribute('aria-invalid', 'false');
    }

    function clearFormFieldErrors(scope) {
        qa('.field-error', scope || document).forEach((node) => {
            node.textContent = '';
            node.classList.add('hidden');
        });
        qa('[aria-invalid="true"]', scope || document).forEach((node) => {
            node.setAttribute('aria-invalid', 'false');
        });
    }

    // -------------------------------------------------------------------------
    // Networking + pending-request tracking
    //
    // Each mutation gets a unique request id. Only the controls belonging to that
    // action are disabled while it is pending (Req 11.8). Canonical success
    // replaces state; failures keep inputs and expose Retry (Req 11.9-11.10).
    // -------------------------------------------------------------------------
    function nextRequestId() {
        state.requestCounter += 1;
        return `pm-${Date.now()}-${state.requestCounter}`;
    }

    async function apiRequest(url, { method = 'GET', body } = {}) {
        const options = { method, headers: {} };
        if (body !== undefined) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        const response = await fetch(url, options);
        let payload = null;
        try {
            payload = await response.json();
        } catch (parseError) {
            payload = null;
        }
        return { response, ok: response.ok, payload };
    }

    function setControlsDisabled(controls, disabled) {
        (controls || []).filter(Boolean).forEach((control) => {
            control.disabled = disabled;
            control.setAttribute('aria-disabled', String(disabled));
            control.setAttribute('aria-busy', String(disabled));
        });
    }

    // Run one mutation with full pending/success/failure lifecycle handling.
    //   controls      – buttons to disable ONLY while this action is pending
    //   statusEl      – per-action status paragraph (polite live region)
    //   pocketId      – optional; associates the request with a definition record
    //   pendingText/successText – status announcements
    //   clearErrors() – clears prior field errors for this form before retry
    //   perform()     – returns { ok, payload } from apiRequest
    //   onSuccess(data) – replace state from the canonical response
    //   onFieldErrors(list, error) – associate server field errors with inputs
    //   conflict      – recovery context (or a factory) for VERSION_CONFLICT
    async function runMutation(config) {
        const requestId = nextRequestId();
        state.pendingRequests.set(requestId, config);
        if (config.pocketId) {
            const record = ensureDefinitionRecord(config.pocketId);
            record.pendingRequestIds.add(requestId);
        }

        if (typeof config.clearErrors === 'function') config.clearErrors();
        hideGlobalError();
        setControlsDisabled(config.controls, true);
        setStatusText(config.statusEl, config.pendingText || 'Working…');
        announceGlobalStatus(config.pendingText || 'Working…');

        try {
            const { ok, payload } = await config.perform();
            if (ok && payload && payload.success === true) {
                setStatusText(config.statusEl, config.successText || 'Saved.');
                announceGlobalStatus(config.successText || 'Saved.');
                if (typeof config.onSuccess === 'function') await config.onSuccess(payload.data);
                return { ok: true, data: payload.data };
            }
            const error = (payload && payload.error) || { code: 'UNKNOWN', message: 'The request could not be completed.' };
            handleMutationFailure(config, error);
            return { ok: false, error };
        } catch (networkError) {
            handleMutationFailure(config, { code: 'NETWORK_ERROR', message: 'Network error. Please retry.' });
            return { ok: false };
        } finally {
            state.pendingRequests.delete(requestId);
            if (config.pocketId) {
                const record = state.definitionState.get(config.pocketId);
                if (record) record.pendingRequestIds.delete(requestId);
            }
            // Re-enable the pending action so Retry / a fresh attempt is possible.
            setControlsDisabled(config.controls, false);
        }
    }

    function handleMutationFailure(config, error) {
        // A version conflict opens the keep/load recovery dialog rather than a
        // plain error, retaining the entered draft (Req 10.7-10.9).
        if (error && error.code === 'VERSION_CONFLICT' && config.conflict) {
            const context = typeof config.conflict === 'function' ? config.conflict(error) : config.conflict;
            const currentVersion = error.details && Number.isInteger(error.details.currentVersion)
                ? error.details.currentVersion
                : undefined;
            openVersionConflict(Object.assign({ currentVersion, retryConfig: config }, context));
            setStatusText(config.statusEl, 'This record changed elsewhere. Choose keep or load.');
            return;
        }

        // Associate any accumulated field errors with their inputs.
        const list = extractFieldErrors(error);
        if (list.length && typeof config.onFieldErrors === 'function') {
            config.onFieldErrors(list, error);
        }

        const reason = messageForError(error);
        setStatusText(config.statusEl, reason);
        // The Retry action re-runs the same config; inputs are still intact.
        showGlobalError(reason, () => runMutation(config));
    }

    // Normalize an error envelope into a flat list of { field, reason, code, entryIndex }.
    function extractFieldErrors(error) {
        if (!error) return [];
        const details = error.details || {};
        if (Array.isArray(details.errors) && details.errors.length) {
            return details.errors.map((entry) => ({
                field: entry.field,
                reason: entry.reason || entry.message,
                code: entry.code,
                entryIndex: Number.isInteger(entry.entryIndex) ? entry.entryIndex : undefined
            }));
        }
        if (error.field) {
            return [{ field: error.field, reason: error.message, code: error.code }];
        }
        return [];
    }

    // -------------------------------------------------------------------------
    // Definition record helpers (ID-keyed)
    // -------------------------------------------------------------------------
    function ensureDefinitionRecord(pocketId) {
        let record = state.definitionState.get(pocketId);
        if (!record) {
            record = { dto: null, pendingRequestIds: new Set() };
            state.definitionState.set(pocketId, record);
        }
        return record;
    }

    function storeDefinitions(collections) {
        // Rebuild the id-keyed record set from the canonical listing while keeping
        // any pending request ids that are still in flight for a pocket.
        const next = new Map();
        const all = []
            .concat(Array.isArray(collections.active) ? collections.active : [])
            .concat(Array.isArray(collections.archived) ? collections.archived : []);
        all.forEach((dto) => {
            if (!dto || !dto.id) return;
            const previous = state.definitionState.get(dto.id);
            next.set(dto.id, {
                dto,
                pendingRequestIds: previous ? previous.pendingRequestIds : new Set()
            });
        });
        state.definitionState = next;
    }

    // =========================================================================
    // Definitions: load + render
    // =========================================================================
    async function loadDefinitions() {
        if (!state.bootstrap.pocketManagementEnabled) {
            renderFeatureDisabledLists();
            return;
        }
        const url = `/api/pockets${state.includeArchived ? '?includeArchived=true' : ''}`;
        if (els.activeList) els.activeList.setAttribute('aria-busy', 'true');
        try {
            const { ok, payload } = await apiRequest(url);
            if (!ok || !payload || payload.success !== true) {
                const reason = messageForError(payload && payload.error);
                renderDefinitionsError(reason);
                showGlobalError(reason, loadDefinitions);
                return;
            }
            storeDefinitions(payload.data || {});
            renderDefinitions(payload.data || {});
        } catch (networkError) {
            renderDefinitionsError('Network error while loading pockets.');
            showGlobalError('Network error while loading pockets.', loadDefinitions);
        } finally {
            if (els.activeList) els.activeList.setAttribute('aria-busy', 'false');
        }
    }

    function renderFeatureDisabledLists() {
        const message = 'Managed pockets are unavailable until Pocket Management is enabled.';
        if (els.activeList) {
            els.activeList.setAttribute('aria-busy', 'false');
            els.activeList.innerHTML = `<p class="text-center py-5" style="color: var(--journal-soft-ink);">${message}</p>`;
        }
    }

    function renderDefinitionsError(reason) {
        if (els.activeList) {
            els.activeList.innerHTML = `<p class="text-center py-5 text-journal-danger">${reason}</p>`;
        }
    }

    // Step 1's create form lives in a <details> so step 2's pocket list is the
    // first thing on screen once pockets exist. Anything that needs the form
    // (empty state, "create your first pocket") opens it first.
    function openCreateDisclosure() {
        if (els.createDisclosure) els.createDisclosure.open = true;
    }

    function renderDefinitions(collections) {
        const active = Array.isArray(collections.active) ? collections.active : [];
        const archived = Array.isArray(collections.archived) ? collections.archived : [];

        // Active list + empty state (Req 11.11)
        if (els.activeList) {
            els.activeList.innerHTML = '';
            if (active.length === 0) {
                if (els.activeEmptyState) toggleHidden(els.activeEmptyState, false);
                // With nothing defined yet, step 1 is the only useful action, so
                // the create form starts open instead of behind a disclosure.
                openCreateDisclosure();
            } else {
                if (els.activeEmptyState) toggleHidden(els.activeEmptyState, true);
                active.forEach((dto) => els.activeList.appendChild(renderDefinitionCard(dto)));
            }
        }

        // Archived region visibility follows the toggle; content follows the data.
        if (els.archivedRegion) {
            toggleHidden(els.archivedRegion, !state.includeArchived);
        }
        if (els.archivedList && state.includeArchived) {
            els.archivedList.innerHTML = '';
            if (archived.length === 0) {
                els.archivedList.innerHTML = '<p class="text-center py-5" style="color: var(--journal-soft-ink);">No archived pockets.</p>';
            } else {
                archived.forEach((dto) => els.archivedList.appendChild(renderDefinitionCard(dto)));
            }
        }
    }

    function renderDefinitionCard(dto) {
        const template = byId('pocketDefinitionCardTemplate');
        const card = template.content.firstElementChild.cloneNode(true);
        card.dataset.pocketId = dto.id;
        card.dataset.version = String(dto.version);
        setStatusText(q('[data-pocket-emoji]', card), dto.emoji);
        setStatusText(q('[data-pocket-name]', card), dto.name);
        setStatusText(q('[data-pocket-cadence]', card), dto.cadence);
        setStatusText(q('[data-pocket-default]', card), formatRupiah(dto.defaultAmount));
        renderPocketBank(q('[data-pocket-bank]', card), dto.bank);
        const statusEl = q('[data-pocket-status]', card);
        setStatusText(statusEl, dto.status);

        const actions = q('[data-pocket-actions]', card);
        const editBtn = q('[data-edit-pocket]', card);
        const archiveBtn = q('[data-archive-pocket]', card);
        const restoreBtn = q('[data-restore-pocket]', card);

        if (!state.bootstrap.canEdit) {
            // View-only members get no enabled mutation controls.
            if (actions) actions.remove();
        } else {
            const isActive = dto.status === 'Active';
            if (editBtn) {
                toggleHidden(editBtn, !isActive);
                editBtn.addEventListener('click', () => openEditDialog(dto.id));
            }
            if (archiveBtn) {
                toggleHidden(archiveBtn, !isActive);
                archiveBtn.addEventListener('click', () => openArchiveDialog(dto.id));
            }
            if (restoreBtn) {
                toggleHidden(restoreBtn, isActive);
                restoreBtn.addEventListener('click', () => restorePocket(dto.id, restoreBtn));
            }
        }
        return card;
    }

    function bankFor(key) {
        return (state.bootstrap.banks || []).find((bank) => bank.key === key) || null;
    }

    function renderPocketBank(node, key) {
        if (!node) return;
        const bank = bankFor(key);
        if (!bank) {
            node.innerHTML = '<span class="pocket-bank-missing">No bank</span>';
            return;
        }
        const logo = typeof window.bankLogoHtml === 'function' ? window.bankLogoHtml(bank, 'sm') : '';
        node.innerHTML = logo;
        const name = document.createElement('span');
        name.textContent = bank.name;
        node.appendChild(name);
    }

    function selectedBank(group) {
        const checked = group ? q('input[data-bank-option]:checked', group) : null;
        return checked ? checked.value : '';
    }

    function setSelectedBank(group, key) {
        if (!group) return;
        qa('input[data-bank-option]', group).forEach((input) => { input.checked = input.value === key; });
    }

    const BANK_REQUIRED_MESSAGE = 'Choose the bank this pocket lives in.';

    // Toggle both the Tailwind `hidden` class and the boolean `hidden` attribute
    // so elements that ship with either mechanism behave consistently.
    function toggleHidden(element, shouldHide) {
        if (!element) return;
        element.classList.toggle('hidden', shouldHide);
        element.hidden = shouldHide;
    }

    function getDefinitionDto(pocketId) {
        const record = state.definitionState.get(pocketId);
        return record ? record.dto : null;
    }

    // =========================================================================
    // Create pocket
    // =========================================================================
    function readCreateForm() {
        return {
            emoji: (els.createEmoji && els.createEmoji.value) || '',
            name: (els.createName && els.createName.value) || '',
            cadence: (els.createCadence && els.createCadence.value) || '',
            defaultAmount: toAmountPayload(els.createDefaultAmount && els.createDefaultAmount.value),
            bank: selectedBank(els.createBank)
        };
    }

    const CREATE_FIELD_MAP = () => ({
        emoji: { input: els.createEmoji, error: byId('createPocketEmojiError') },
        name: { input: els.createName, error: byId('createPocketNameError') },
        cadence: { input: els.createCadence, error: byId('createPocketCadenceError') },
        defaultAmount: { input: els.createDefaultAmount, error: byId('createPocketDefaultAmountError') },
        bank: { input: els.createBank, error: byId('createPocketBankError') }
    });

    function applyDefinitionFieldErrors(fieldMap, list) {
        list.forEach((entry) => {
            const target = fieldMap[entry.field];
            if (target) showFieldError(target.input, target.error, entry.reason);
        });
    }

    function submitCreate() {
        if (!els.createForm) return;
        const body = readCreateForm();
        const fieldMap = CREATE_FIELD_MAP();
        if (!body.bank) {
            clearFormFieldErrors(els.createForm);
            showFieldError(fieldMap.bank.input, fieldMap.bank.error, BANK_REQUIRED_MESSAGE);
            return;
        }
        runMutation({
            controls: [els.createSubmit],
            statusEl: els.createStatus,
            pendingText: 'Creating pocket…',
            successText: 'Pocket created.',
            clearErrors: () => clearFormFieldErrors(els.createForm),
            perform: () => apiRequest('/api/pockets', { method: 'POST', body }),
            onFieldErrors: (list) => applyDefinitionFieldErrors(fieldMap, list),
            onSuccess: async () => {
                els.createForm.reset();
                await loadDefinitions();
            }
        });
    }

    // =========================================================================
    // Edit pocket dialog (Req 11.4 prepopulation)
    // =========================================================================
    function openEditDialog(pocketId) {
        const dto = getDefinitionDto(pocketId);
        if (!dto || !els.editModal) return;
        populateEditForm(dto);
        clearFormFieldErrors(els.editModal);
        setStatusText(byId('pocketEditStatus'), '');
        openDialog(els.editModal);
    }

    function populateEditForm(dto) {
        const idField = q('[data-edit-pocket-id]', els.editModal);
        const versionField = q('[data-edit-pocket-version]', els.editModal);
        if (idField) idField.value = dto.id;
        if (versionField) versionField.value = String(dto.version);
        if (els.editEmoji) els.editEmoji.value = dto.emoji || '';
        if (els.editName) els.editName.value = dto.name || '';
        if (els.editCadence) els.editCadence.value = dto.cadence || 'Monthly';
        if (els.editDefaultAmount) els.editDefaultAmount.value = dto.defaultAmount != null ? String(dto.defaultAmount) : '';
        setSelectedBank(els.editBank, dto.bank || '');
        toggleHidden(q('[data-edit-bank-missing]', els.editModal), Boolean(bankFor(dto.bank)));
    }

    function readEditForm() {
        return {
            pocketId: q('[data-edit-pocket-id]', els.editModal).value,
            version: Number(q('[data-edit-pocket-version]', els.editModal).value),
            emoji: (els.editEmoji && els.editEmoji.value) || '',
            name: (els.editName && els.editName.value) || '',
            cadence: (els.editCadence && els.editCadence.value) || '',
            defaultAmount: toAmountPayload(els.editDefaultAmount && els.editDefaultAmount.value),
            bank: selectedBank(els.editBank)
        };
    }

    const EDIT_FIELD_MAP = () => ({
        emoji: { input: els.editEmoji, error: byId('editPocketEmojiError') },
        name: { input: els.editName, error: byId('editPocketNameError') },
        cadence: { input: els.editCadence, error: byId('editPocketCadenceError') },
        defaultAmount: { input: els.editDefaultAmount, error: byId('editPocketDefaultAmountError') },
        bank: { input: els.editBank, error: byId('editPocketBankError') }
    });

    function submitEdit() {
        if (!els.editModal) return;
        const form = readEditForm();
        const fieldMap = EDIT_FIELD_MAP();
        // Immutable snapshot of the entered values so a version conflict can
        // restore the exact draft the user typed (Req 10.7/10.9).
        const draft = { emoji: form.emoji, name: form.name, cadence: form.cadence, defaultAmount: form.defaultAmount, bank: form.bank };
        if (!form.bank) {
            clearFormFieldErrors(els.editModal);
            showFieldError(fieldMap.bank.input, fieldMap.bank.error, BANK_REQUIRED_MESSAGE);
            return;
        }
        const body = {
            emoji: form.emoji,
            name: form.name,
            cadence: form.cadence,
            defaultAmount: form.defaultAmount,
            bank: form.bank,
            expectedVersion: form.version
        };
        const saveControl = q('[data-edit-save]', els.editModal);
        runMutation({
            controls: [saveControl],
            statusEl: byId('pocketEditStatus'),
            pocketId: form.pocketId,
            pendingText: 'Saving changes…',
            successText: 'Pocket updated.',
            clearErrors: () => clearFormFieldErrors(els.editModal),
            perform: () => apiRequest(`/api/pockets/${encodeURIComponent(form.pocketId)}`, { method: 'PATCH', body }),
            onFieldErrors: (list) => applyDefinitionFieldErrors(fieldMap, list),
            onSuccess: async () => {
                closeDialog(els.editModal);
                await loadDefinitions();
            },
            conflict: {
                label: 'edit',
                restore: () => {
                    // Keep entered values: re-apply the immutable draft; send nothing.
                    if (els.editEmoji) els.editEmoji.value = draft.emoji;
                    if (els.editName) els.editName.value = draft.name;
                    if (els.editCadence) els.editCadence.value = draft.cadence;
                    if (els.editDefaultAmount) els.editDefaultAmount.value = draft.defaultAmount == null ? '' : String(draft.defaultAmount);
                    setSelectedBank(els.editBank, draft.bank);
                },
                loadCurrent: async () => {
                    // Load current stored values: refresh from canonical data and
                    // repopulate the form (fields + expected version).
                    await loadDefinitions();
                    const fresh = getDefinitionDto(form.pocketId);
                    if (fresh) populateEditForm(fresh);
                }
            }
        });
    }

    // =========================================================================
    // Archive dialog (Req 4.1-4.2) and restore
    // =========================================================================
    function openArchiveDialog(pocketId) {
        const dto = getDefinitionDto(pocketId);
        if (!dto || !els.archiveModal) return;
        setStatusText(q('[data-archive-emoji]', els.archiveModal), dto.emoji);
        setStatusText(q('[data-archive-name]', els.archiveModal), dto.name);
        const idField = q('[data-archive-pocket-id]', els.archiveModal);
        const versionField = q('[data-archive-pocket-version]', els.archiveModal);
        if (idField) idField.value = dto.id;
        if (versionField) versionField.value = String(dto.version);
        setStatusText(byId('pocketArchiveStatus'), '');
        openDialog(els.archiveModal);
    }

    function confirmArchive() {
        if (!els.archiveModal) return;
        const pocketId = q('[data-archive-pocket-id]', els.archiveModal).value;
        const version = Number(q('[data-archive-pocket-version]', els.archiveModal).value);
        const confirmControl = q('[data-archive-confirm]', els.archiveModal);
        runMutation({
            controls: [confirmControl],
            statusEl: byId('pocketArchiveStatus'),
            pocketId,
            pendingText: 'Archiving…',
            successText: 'Pocket archived.',
            perform: () => apiRequest(`/api/pockets/${encodeURIComponent(pocketId)}/archive`, {
                method: 'POST',
                body: { confirmed: true, expectedVersion: version }
            }),
            onSuccess: async () => {
                closeDialog(els.archiveModal);
                await loadDefinitions();
            },
            conflict: {
                label: 'archive',
                restore: () => { /* keep: nothing to restore, no resubmission */ },
                loadCurrent: async () => {
                    await loadDefinitions();
                    const fresh = getDefinitionDto(pocketId);
                    const versionField = q('[data-archive-pocket-version]', els.archiveModal);
                    if (fresh && versionField) versionField.value = String(fresh.version);
                }
            }
        });
    }

    function restorePocket(pocketId, control) {
        const dto = getDefinitionDto(pocketId);
        const version = dto ? dto.version : undefined;
        runMutation({
            controls: [control],
            statusEl: els.globalStatus,
            pocketId,
            pendingText: 'Restoring…',
            successText: 'Pocket restored.',
            perform: () => apiRequest(`/api/pockets/${encodeURIComponent(pocketId)}/restore`, {
                method: 'POST',
                body: { expectedVersion: version }
            }),
            onSuccess: async () => { await loadDefinitions(); },
            conflict: {
                label: 'restore',
                restore: () => { /* keep: nothing to restore */ },
                loadCurrent: async () => { await loadDefinitions(); }
            }
        });
    }

    // =========================================================================
    // Assignment setup — month selection + staging
    // =========================================================================
    async function fetchSetup(monthKey) {
        const { ok, payload } = await apiRequest(`/api/pocket-assignments/setup?month=${encodeURIComponent(monthKey)}`);
        if (!ok || !payload || payload.success !== true) {
            return { ok: false, error: payload && payload.error };
        }
        return { ok: true, data: payload.data };
    }

    async function initSetup() {
        if (!state.bootstrap.pocketManagementEnabled || !els.monthSelect) return;
        const probe = currentCalendarMonthKey();
        const result = await fetchSetup(probe);
        if (!result.ok) {
            const reason = messageForError(result.error);
            if (els.monthSelect) els.monthSelect.innerHTML = `<option value="">${reason}</option>`;
            showGlobalError(reason, initSetup);
            return;
        }
        const dto = result.data;
        populateMonthSelect(dto.editableMonths || [], dto.activeBudgetMonth);
        const chosen = els.monthSelect.value;
        if (chosen && chosen !== dto.budgetMonth) {
            await selectMonth(chosen);
        } else {
            applySetupDto(dto);
        }
    }

    function populateMonthSelect(editableMonths, activeBudgetMonth) {
        if (!els.monthSelect) return;
        const months = Array.isArray(editableMonths) ? editableMonths.slice() : [];
        if (months.length === 0) {
            els.monthSelect.innerHTML = '<option value="">No editable Budget Month available</option>';
            return;
        }
        els.monthSelect.innerHTML = months.map((key) => {
            const active = key === activeBudgetMonth ? ' (active)' : '';
            return `<option value="${key}">${monthLabel(key)}${active}</option>`;
        }).join('');
        const preferred = months.includes(activeBudgetMonth) ? activeBudgetMonth : months[0];
        els.monthSelect.value = preferred;
    }

    async function selectMonth(monthKey) {
        if (!monthKey) return;
        clearFieldError(els.monthSelect, byId('setupBudgetMonthError'));
        const result = await fetchSetup(monthKey);
        if (!result.ok) {
            const reason = messageForError(result.error);
            showFieldError(els.monthSelect, byId('setupBudgetMonthError'), reason);
            return;
        }
        applySetupDto(result.data);
    }

    // Replace staged setup state from a canonical setup DTO. Existing assignments
    // load their stored mode/values/version; unassigned pockets are unselected
    // and default-valued. Nothing here writes to the server.
    function applySetupDto(dto) {
        state.setup.dto = dto;
        state.setup.budgetMonth = dto.budgetMonth;
        state.setup.weeks = Array.isArray(dto.weeks) ? dto.weeks : [];

        const entries = new Map();
        (Array.isArray(dto.pockets) ? dto.pockets : []).forEach((pocket) => {
            entries.set(pocket.id, buildEntryFromDefinition(pocket));
        });
        state.assignmentEntries = entries;

        // Unassigned count is a persisted-state indicator (Req 5.16 / 11.12).
        setStatusText(els.unassignedCount, String(dto.unassignedCount != null ? dto.unassignedCount : 0));

        renderZeroAssignmentState(dto);
        renderSelection();
        renderAllocationEntry();
        renderSummary();
    }

    function buildEntryFromDefinition(pocket) {
        const assignment = pocket.assignment || null;
        const entry = {
            pocketId: pocket.id,
            name: pocket.name,
            emoji: pocket.emoji,
            cadence: pocket.cadence,
            defaultAmount: Number(pocket.defaultAmount) || 0,
            assigned: pocket.assignmentStatus === 'assigned',
            // Existing assignments start selected; unassigned pockets do not.
            selected: pocket.assignmentStatus === 'assigned',
            mode: assignment ? assignment.amountMode : 'Use_Default',
            version: assignment ? assignment.version : undefined,
            // Customize-mode entered values keyed by allocation key (strings).
            customValues: {},
            fieldErrors: {}
        };
        if (assignment && assignment.amountMode === 'Customize' && Array.isArray(assignment.allocations)) {
            assignment.allocations.forEach((allocation) => {
                entry.customValues[allocation.key] = String(allocation.amount);
            });
        }
        return entry;
    }

    function renderZeroAssignmentState(dto) {
        if (!els.zeroAssignmentState) return;
        const assignedActive = (Array.isArray(dto.pockets) ? dto.pockets : [])
            .filter((p) => p.assignmentStatus === 'assigned').length;
        const assignedArchived = Array.isArray(dto.assignedArchived) ? dto.assignedArchived.length : 0;
        const total = assignedActive + assignedArchived;
        const isEmpty = total === 0;
        toggleHidden(els.zeroAssignmentState, !isEmpty);
        if (isEmpty) {
            const assignedCountEl = q('[data-assigned-count]', els.zeroAssignmentState);
            const zeroTotalEl = q('[data-zero-total]', els.zeroAssignmentState);
            setStatusText(assignedCountEl, '0');
            setStatusText(zeroTotalEl, formatRupiah(0));
            // Start-setup action is meaningful only for the active month (Req 5.15).
            const startBtn = byId('startSetupBtn');
            if (startBtn) toggleHidden(startBtn, dto.budgetMonth !== dto.activeBudgetMonth);
        }
    }

    // --- Selection (Req 5.3-5.4) -------------------------------------------
    function renderSelection() {
        if (!els.pocketSelection) return;
        els.pocketSelection.innerHTML = '';
        const entries = Array.from(state.assignmentEntries.values());
        if (entries.length === 0) {
            els.pocketSelection.innerHTML = '<p class="text-center py-4 text-sm" style="color: var(--journal-soft-ink);">No active pockets to select for this month.</p>';
            return;
        }
        const template = byId('setupPocketSelectionRowTemplate');
        entries.forEach((entry) => {
            const row = template.content.firstElementChild.cloneNode(true);
            row.dataset.pocketId = entry.pocketId;
            const checkbox = q('[data-select-pocket]', row);
            if (checkbox) {
                checkbox.checked = entry.selected;
                checkbox.setAttribute('aria-label', `Select ${entry.name}`);
                checkbox.addEventListener('change', () => toggleSelection(entry.pocketId, checkbox.checked));
            }
            setStatusText(q('[data-pocket-emoji]', row), entry.emoji);
            setStatusText(q('[data-pocket-name]', row), entry.name);
            setStatusText(q('[data-pocket-cadence]', row), entry.cadence);
            els.pocketSelection.appendChild(row);
        });
    }

    // A keyed entry guarantees a pocket is added exactly once (Req 5.3). Removing
    // a pending selection only clears the flag (Req 5.4); persisted data is
    // untouched until Confirm.
    function toggleSelection(pocketId, selected) {
        const entry = state.assignmentEntries.get(pocketId);
        if (!entry) return;
        entry.selected = selected === true;
        renderAllocationEntry();
        renderSummary();
    }

    // --- Amount mode + allocation entry (Req 6.6-6.7) ----------------------
    function renderAllocationEntry() {
        if (!els.allocationEntry) return;
        els.allocationEntry.innerHTML = '';
        const selected = Array.from(state.assignmentEntries.values()).filter((entry) => entry.selected);
        if (selected.length === 0) {
            els.allocationEntry.innerHTML = '<p class="text-center py-4 text-sm" style="color: var(--journal-soft-ink);">Select one or more pockets to enter allocations.</p>';
            return;
        }
        selected.forEach((entry) => els.allocationEntry.appendChild(renderAllocationBlock(entry)));
    }

    function renderAllocationBlock(entry) {
        const template = byId('setupAllocationBlockTemplate');
        const block = template.content.firstElementChild.cloneNode(true);
        block.dataset.pocketId = entry.pocketId;
        setStatusText(q('[data-pocket-emoji]', block), entry.emoji);
        setStatusText(q('[data-pocket-name]', block), entry.name);
        setStatusText(q('[data-pocket-cadence]', block), entry.cadence);

        // Radios must be uniquely named per pocket so each block is independent.
        const defaultRadio = q('[data-mode-default]', block);
        const customizeRadio = q('[data-mode-customize]', block);
        const groupName = `amountMode-${entry.pocketId}`;
        if (defaultRadio) {
            defaultRadio.name = groupName;
            defaultRadio.checked = entry.mode === 'Use_Default';
            defaultRadio.addEventListener('change', () => { if (defaultRadio.checked) switchMode(entry.pocketId, 'Use_Default'); });
        }
        if (customizeRadio) {
            customizeRadio.name = groupName;
            customizeRadio.checked = entry.mode === 'Customize';
            customizeRadio.addEventListener('change', () => { if (customizeRadio.checked) switchMode(entry.pocketId, 'Customize'); });
        }

        const monthlyWrap = q('[data-monthly-allocation]', block);
        const weeklyWrap = q('[data-weekly-allocation]', block);

        if (entry.cadence === 'Weekly') {
            if (monthlyWrap) toggleHidden(monthlyWrap, true);
            if (weeklyWrap) {
                toggleHidden(weeklyWrap, false);
                renderWeeklyInputs(entry, weeklyWrap);
            }
        } else {
            if (weeklyWrap) toggleHidden(weeklyWrap, true);
            if (monthlyWrap) {
                toggleHidden(monthlyWrap, false);
                renderMonthlyInput(entry, monthlyWrap);
            }
        }
        return block;
    }

    function renderMonthlyInput(entry, wrap) {
        const input = q('[data-monthly-amount]', wrap);
        const errorEl = q('[data-monthly-error]', wrap);
        const useDefault = entry.mode === 'Use_Default';
        if (errorEl) errorEl.id = errorEl.id || `alloc-err-${entry.pocketId}-monthly`;
        if (input) {
            input.value = useDefault ? String(entry.defaultAmount) : (entry.customValues[MONTHLY_KEY] != null ? entry.customValues[MONTHLY_KEY] : String(entry.defaultAmount));
            input.disabled = useDefault;
            input.setAttribute('aria-label', `Monthly allocation for ${entry.name}`);
            if (errorEl) ensureDescribedBy(input, errorEl.id);
            input.addEventListener('input', () => {
                entry.customValues[MONTHLY_KEY] = input.value;
                renderSummary();
            });
        }
        applyEntryFieldError(entry, MONTHLY_KEY, input, errorEl);
    }

    function renderWeeklyInputs(entry, wrap) {
        const weeksHost = q('[data-weekly-weeks]', wrap);
        if (!weeksHost) return;
        weeksHost.innerHTML = '';
        const template = byId('setupWeeklyInputTemplate');
        const useDefault = entry.mode === 'Use_Default';
        state.setup.weeks.forEach((week) => {
            const weekNode = template.content.firstElementChild.cloneNode(true);
            const label = q('[data-week-label]', weekNode);
            const input = q('[data-week-amount]', weekNode);
            const errorEl = q('[data-week-error]', weekNode);
            const errorId = `alloc-err-${entry.pocketId}-${week.key}`;
            if (label) {
                label.textContent = `${week.key} (${week.startDate} – ${week.endDate})`;
                label.setAttribute('for', `alloc-in-${entry.pocketId}-${week.key}`);
            }
            if (errorEl) errorEl.id = errorId;
            if (input) {
                input.id = `alloc-in-${entry.pocketId}-${week.key}`;
                input.value = useDefault ? String(entry.defaultAmount) : (entry.customValues[week.key] != null ? entry.customValues[week.key] : String(entry.defaultAmount));
                input.disabled = useDefault;
                input.setAttribute('aria-label', `${week.key} allocation for ${entry.name}`);
                ensureDescribedBy(input, errorId);
                input.addEventListener('input', () => {
                    entry.customValues[week.key] = input.value;
                    renderSummary();
                });
            }
            applyEntryFieldError(entry, week.key, input, errorEl);
            weeksHost.appendChild(weekNode);
        });
    }

    function applyEntryFieldError(entry, key, input, errorEl) {
        const message = entry.fieldErrors && entry.fieldErrors[key];
        if (message) showFieldError(input, errorEl, message);
        else clearFieldError(input, errorEl);
    }

    // Switching mode is staged only (Req 6.6-6.7): it recalculates displayed
    // values but never calls a mutation endpoint.
    function switchMode(pocketId, mode) {
        const entry = state.assignmentEntries.get(pocketId);
        if (!entry || entry.mode === mode) return;
        entry.fieldErrors = {};
        if (mode === 'Customize') {
            // Prefill each custom field from the currently displayed default.
            const keys = allocationKeysFor(entry);
            entry.customValues = {};
            keys.forEach((key) => { entry.customValues[key] = String(entry.defaultAmount); });
        } else {
            // Back to Use Default: discard pending custom displays; show defaults.
            entry.customValues = {};
        }
        entry.mode = mode;
        renderAllocationEntry();
        renderSummary();
    }

    function allocationKeysFor(entry) {
        if (entry.cadence === 'Weekly') return state.setup.weeks.map((week) => week.key);
        return [MONTHLY_KEY];
    }

    // --- Summary (Req 11.6) -------------------------------------------------
    function summaryAllocationsFor(entry) {
        const useDefault = entry.mode === 'Use_Default';
        if (entry.cadence === 'Weekly') {
            return state.setup.weeks.map((week) => ({
                label: week.key,
                raw: useDefault ? String(entry.defaultAmount) : (entry.customValues[week.key] != null ? entry.customValues[week.key] : '')
            }));
        }
        return [{
            label: 'Monthly',
            raw: useDefault ? String(entry.defaultAmount) : (entry.customValues[MONTHLY_KEY] != null ? entry.customValues[MONTHLY_KEY] : '')
        }];
    }

    function renderSummary() {
        if (!els.summaryRows) return;
        const monthEl = q('[data-summary-month]', els.summary);
        setStatusText(monthEl, state.setup.budgetMonth ? monthLabel(state.setup.budgetMonth) : '—');

        els.summaryRows.innerHTML = '';
        const selected = Array.from(state.assignmentEntries.values()).filter((entry) => entry.selected);
        let combinedTotal = 0;
        const template = byId('assignmentSummaryRowTemplate');
        selected.forEach((entry) => {
            const row = template.content.firstElementChild.cloneNode(true);
            setStatusText(q('[data-pocket-emoji]', row), entry.emoji);
            setStatusText(q('[data-pocket-name]', row), entry.name);
            setStatusText(q('[data-pocket-cadence]', row), entry.cadence);
            setStatusText(q('[data-amount-mode]', row), entry.mode === 'Customize' ? 'Customize' : 'Use default');
            const list = q('[data-summary-allocations]', row);
            const allocations = summaryAllocationsFor(entry);
            allocations.forEach((allocation) => {
                const numeric = toAmountPayload(allocation.raw);
                if (typeof numeric === 'number') combinedTotal += numeric;
                if (list) {
                    const li = document.createElement('li');
                    li.textContent = `${allocation.label}: ${amountDisplay(allocation.raw)}`;
                    list.appendChild(li);
                }
            });
            els.summaryRows.appendChild(row);
        });

        setStatusText(els.summaryTotal, formatRupiah(combinedTotal));
    }

    // --- Confirm (Req 5 / 6, atomic) ---------------------------------------
    function buildConfirmEntries() {
        const selected = Array.from(state.assignmentEntries.values()).filter((entry) => entry.selected);
        return selected.map((entry) => {
            const command = { pocketId: entry.pocketId, amountMode: entry.mode };
            if (entry.mode === 'Customize') {
                const keys = allocationKeysFor(entry);
                command.allocations = keys.map((key) => ({ key, amount: toAmountPayload(entry.customValues[key]) }));
            } else {
                command.allocations = [];
            }
            // expectedVersion is sent only for a pocket that already has an
            // assignment; a brand-new selection omits it.
            if (entry.assigned && Number.isInteger(entry.version)) {
                command.expectedVersion = entry.version;
            }
            return { entry, command };
        });
    }

    function clearAllEntryFieldErrors() {
        state.assignmentEntries.forEach((entry) => { entry.fieldErrors = {}; });
    }

    function submitConfirm() {
        if (!els.assignmentForm || !state.setup.budgetMonth) return;
        const built = buildConfirmEntries();
        // submittedOrder maps a server entryIndex back to the staged entry.
        const submittedOrder = built.map((item) => item.entry);
        const body = { budgetMonth: state.setup.budgetMonth, entries: built.map((item) => item.command) };

        runMutation({
            controls: [els.confirmBtn],
            statusEl: els.assignmentStatus,
            pendingText: 'Confirming assignments…',
            successText: 'Assignments confirmed.',
            clearErrors: () => { clearAllEntryFieldErrors(); clearFormFieldErrors(els.assignmentForm); },
            perform: () => apiRequest('/api/pocket-assignments/confirm', { method: 'POST', body }),
            onFieldErrors: (list) => applyAssignmentFieldErrors(list, submittedOrder),
            onSuccess: async () => {
                // Replace staged state from the canonical, freshly-read month.
                await selectMonth(state.setup.budgetMonth);
            },
            conflict: {
                label: 'confirm',
                // Keep entered values: staged entries are already retained; a
                // subsequent action is explicit. Nothing is resubmitted.
                restore: () => { renderAllocationEntry(); renderSummary(); },
                loadCurrent: async () => { await selectMonth(state.setup.budgetMonth); }
            }
        });
    }

    // Associate accumulated assignment errors with the right pocket block/input.
    function applyAssignmentFieldErrors(list, submittedOrder) {
        list.forEach((entry) => {
            const target = Number.isInteger(entry.entryIndex) ? submittedOrder[entry.entryIndex] : undefined;
            const field = entry.field || '';
            if (target && field.indexOf(ALLOCATION_FIELD_PREFIX) === 0) {
                const key = field.slice(ALLOCATION_FIELD_PREFIX.length);
                target.fieldErrors[key] = entry.reason;
            } else if (target && field.indexOf('allocations[') === 0) {
                // Positional custom-allocation error; attach to the pocket generally.
                target.fieldErrors[MONTHLY_KEY] = entry.reason;
            } else if (!target || field === 'budgetMonth') {
                // Batch/month-level errors surface through the global banner.
                showGlobalError(entry.reason || 'Assignment could not be confirmed.', () => submitConfirm());
            } else {
                // pocketId/cadence/weeks-level errors: attach to the first key.
                const key = allocationKeysFor(target)[0] || MONTHLY_KEY;
                target.fieldErrors[key] = entry.reason;
            }
        });
        renderAllocationEntry();
    }

    // =========================================================================
    // Version-conflict recovery dialog (Req 10.7-10.9)
    // =========================================================================
    function openVersionConflict(context) {
        state.conflict = context;
        if (!els.conflictModal) {
            // No dialog present (view-only build): fall back to keeping the draft.
            if (context && typeof context.restore === 'function') context.restore();
            return;
        }
        openDialog(els.conflictModal);
    }

    function resolveConflictKeep() {
        const context = state.conflict;
        state.conflict = null;
        if (els.conflictModal) closeDialog(els.conflictModal);
        if (context && typeof context.restore === 'function') context.restore();
        // Keeping entered values submits nothing (Req 10.9).
        announceGlobalStatus('Kept your entered values.');
    }

    async function resolveConflictLoad() {
        const context = state.conflict;
        state.conflict = null;
        if (els.conflictModal) closeDialog(els.conflictModal);
        if (context && typeof context.loadCurrent === 'function') {
            await context.loadCurrent();
        }
        announceGlobalStatus('Loaded the current stored values.');
    }

    // =========================================================================
    // Dialog focus management (Req 11.16-11.19)
    // =========================================================================
    const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

    function focusableWithin(modal) {
        return qa(FOCUSABLE, modal).filter((node) => node.offsetParent !== null || node === document.activeElement);
    }

    function openDialog(modal) {
        if (!modal) return;
        const opener = document.activeElement;
        modal.hidden = false;
        modal.classList.add('show');

        const focusables = focusableWithin(modal);
        const heading = q('h3', modal);
        const target = focusables[0] || heading;
        if (target && typeof target.focus === 'function') {
            if (target === heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
            target.focus();
        }

        const keydownHandler = (event) => handleDialogKeydown(event, modal);
        modal.addEventListener('keydown', keydownHandler);
        state.dialogStack.push({ modal, opener, keydownHandler });
    }

    function closeDialog(modal) {
        if (!modal) return;
        const index = state.dialogStack.findIndex((entry) => entry.modal === modal);
        const record = index >= 0 ? state.dialogStack.splice(index, 1)[0] : null;
        modal.classList.remove('show');
        modal.hidden = true;
        if (record) {
            modal.removeEventListener('keydown', record.keydownHandler);
            if (record.opener && typeof record.opener.focus === 'function') record.opener.focus();
        }
    }

    function handleDialogKeydown(event, modal) {
        if (event.key === 'Escape') {
            event.preventDefault();
            // Version conflict has no Cancel; Escape means "keep entered" (safe).
            if (modal === els.conflictModal) resolveConflictKeep();
            else closeDialog(modal);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusables = focusableWithin(modal);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    // =========================================================================
    // Bootstrap + wiring
    // =========================================================================
    function parseBootstrap() {
        const script = byId('pocketManagementBootstrap');
        let parsed = null;
        if (script) {
            try { parsed = JSON.parse(script.textContent || '{}'); } catch (error) { parsed = null; }
        }
        const root = byId('pocketManagementRoot');
        const fromRoot = root ? {
            canEdit: root.dataset.canEdit === 'true',
            role: root.dataset.role,
            pocketManagementEnabled: root.dataset.featureEnabled === 'true',
            pocketManagementDualWriteEnabled: root.dataset.dualWriteEnabled === 'true'
        } : {};
        state.bootstrap = Object.assign({}, fromRoot, parsed || {});
        // Normalize to booleans.
        state.bootstrap.canEdit = state.bootstrap.canEdit === true;
        state.bootstrap.pocketManagementEnabled = state.bootstrap.pocketManagementEnabled === true;
        state.bootstrap.pocketManagementDualWriteEnabled = state.bootstrap.pocketManagementDualWriteEnabled === true;
        state.bootstrap.banks = Array.isArray(state.bootstrap.banks) ? state.bootstrap.banks : [];
    }

    function cacheElements() {
        els = {
            root: byId('pocketManagementRoot'),
            globalStatus: byId('pocketGlobalStatus'),
            globalError: byId('pocketGlobalError'),
            globalErrorBanner: byId('pocketGlobalErrorBanner'),
            globalErrorMessage: byId('pocketGlobalErrorMessage'),
            globalRetry: byId('pocketGlobalRetry'),

            createForm: byId('pocketCreateForm'),
            createEmoji: byId('createPocketEmoji'),
            createName: byId('createPocketName'),
            createCadence: byId('createPocketCadence'),
            createDefaultAmount: byId('createPocketDefaultAmount'),
            createBank: byId('createPocketBank'),
            createSubmit: byId('pocketCreateSubmit'),
            createStatus: byId('createPocketStatus'),
            createDisclosure: byId('createPocketDisclosure'),

            includeArchivedToggle: byId('includeArchivedToggle'),
            activeList: byId('activePocketList'),
            activeEmptyState: byId('activePocketEmptyState'),
            createFirstBtn: byId('createFirstPocketBtn'),
            archivedRegion: byId('archivedPocketsRegion'),
            archivedList: byId('archivedPocketList'),

            assignmentForm: byId('assignmentSetupForm'),
            monthSelect: byId('setupBudgetMonth'),
            unassignedCount: byId('unassignedCount'),
            zeroAssignmentState: byId('zeroAssignmentState'),
            startSetupBtn: byId('startSetupBtn'),
            pocketSelection: byId('setupPocketSelection'),
            allocationEntry: byId('setupAllocationEntry'),
            summary: byId('assignmentSummary'),
            summaryRows: byId('assignmentSummaryRows'),
            summaryTotal: byId('assignmentSummaryTotal'),
            confirmBtn: byId('assignmentConfirmBtn'),
            assignmentStatus: byId('assignmentSetupStatus'),

            editModal: byId('pocketEditModal'),
            editForm: byId('pocketEditForm'),
            editEmoji: byId('editPocketEmoji'),
            editName: byId('editPocketName'),
            editCadence: byId('editPocketCadence'),
            editDefaultAmount: byId('editPocketDefaultAmount'),
            editBank: byId('editPocketBank'),
            archiveModal: byId('pocketArchiveModal'),
            removalModal: byId('assignmentRemovalModal'),
            conflictModal: byId('versionConflictModal')
        };
    }

    function wireEvents() {
        if (els.createForm) {
            els.createForm.addEventListener('submit', (event) => { event.preventDefault(); submitCreate(); });
        }
        if (els.createFirstBtn) {
            els.createFirstBtn.addEventListener('click', () => {
                openCreateDisclosure();
                if (els.createEmoji) els.createEmoji.focus();
            });
        }
        if (els.includeArchivedToggle) {
            els.includeArchivedToggle.addEventListener('change', () => {
                state.includeArchived = els.includeArchivedToggle.checked === true;
                loadDefinitions();
            });
        }

        if (els.monthSelect) {
            els.monthSelect.addEventListener('change', () => selectMonth(els.monthSelect.value));
        }
        if (els.startSetupBtn) {
            els.startSetupBtn.addEventListener('click', () => {
                if (els.pocketSelection && typeof els.pocketSelection.scrollIntoView === 'function') {
                    els.pocketSelection.scrollIntoView({ block: 'start' });
                }
                const firstCheckbox = q('[data-select-pocket]', els.pocketSelection);
                if (firstCheckbox) firstCheckbox.focus();
            });
        }
        if (els.assignmentForm) {
            els.assignmentForm.addEventListener('submit', (event) => { event.preventDefault(); submitConfirm(); });
        }

        // Edit dialog
        if (els.editForm) {
            els.editForm.addEventListener('submit', (event) => { event.preventDefault(); submitEdit(); });
        }
        wireDialogButton(els.editModal, '[data-edit-cancel]', () => closeDialog(els.editModal));

        // Archive dialog
        wireDialogButton(els.archiveModal, '[data-archive-cancel]', () => closeDialog(els.archiveModal));
        wireDialogButton(els.archiveModal, '[data-archive-confirm]', () => confirmArchive());

        // Removal dialog (cancel/confirm wired defensively; opened when a removal
        // trigger is present in a later iteration of the setup UI).
        wireDialogButton(els.removalModal, '[data-removal-cancel]', () => closeDialog(els.removalModal));

        // Version-conflict dialog
        wireDialogButton(els.conflictModal, '[data-conflict-keep]', () => resolveConflictKeep());
        wireDialogButton(els.conflictModal, '[data-conflict-load]', () => resolveConflictLoad());

        // Overlay click closes the modal (cancel path) for non-conflict dialogs.
        [els.editModal, els.archiveModal, els.removalModal].forEach((modal) => {
            if (!modal) return;
            modal.addEventListener('click', (event) => { if (event.target === modal) closeDialog(modal); });
        });

        // Global retry action re-runs the last failed mutation.
        if (els.globalRetry) {
            els.globalRetry.addEventListener('click', () => {
                const handler = globalRetryHandler;
                hideGlobalError();
                if (typeof handler === 'function') handler();
            });
        }
    }

    function wireDialogButton(modal, selector, handler) {
        if (!modal) return;
        const button = q(selector, modal);
        if (button) button.addEventListener('click', handler);
    }

    function init() {
        if (!byId('pocketManagementRoot')) return;
        parseBootstrap();
        cacheElements();
        wireEvents();

        if (!state.bootstrap.pocketManagementEnabled) {
            renderFeatureDisabledLists();
            return;
        }
        loadDefinitions();
        initSetup();
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    // Export the internal surface for jsdom-based unit tests without changing the
    // browser behavior (the module still self-initializes on DOMContentLoaded).
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            __test__: {
                state,
                init,
                loadDefinitions,
                initSetup,
                selectMonth,
                applySetupDto,
                toggleSelection,
                switchMode,
                submitCreate,
                submitEdit,
                confirmArchive,
                restorePocket,
                submitConfirm,
                renderSummary,
                openVersionConflict,
                resolveConflictKeep,
                resolveConflictLoad,
                toAmountPayload,
                buildConfirmEntries
            }
        };
    }
})();
