'use strict';

// =============================================================================
// Expense Type Management client module.
//
// A deliberately smaller sibling of pocket-management.js: an expense type has
// no cadence, default amount, or per-Budget_Month assignment step, so there is
// nothing here analogous to that module's assignment-setup section (roughly
// half of pocket-management.js). Definition CRUD (list/create/edit/archive/
// restore), field-error handling, pending/success/failure status, and dialog
// focus management follow the same conventions as that module so the two
// management pages behave identically wherever their surfaces overlap.
// =============================================================================

(function expenseTypeManagementModule() {
    const byId = (id) => document.getElementById(id);
    const q = (selector, root = document) => (root ? root.querySelector(selector) : null);
    const qa = (selector, root = document) => (root ? Array.from(root.querySelectorAll(selector)) : []);

    const state = {
        bootstrap: { canEdit: false, role: 'Husband', expenseTypeManagementEnabled: false },
        includeArchived: false,
        // typeId -> { dto, pendingRequestIds:Set<string> }
        definitionState: new Map(),
        pendingRequests: new Map(),
        conflict: null,
        dialogStack: [],
        requestCounter: 0
    };

    let els = {};

    // -------------------------------------------------------------------------
    // Small helpers
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
        if (els.globalRetry) els.globalRetry.hidden = !globalRetryHandler;
    }

    function hideGlobalError() {
        globalRetryHandler = null;
        if (els.globalError) els.globalError.textContent = '';
        if (els.globalErrorBanner) els.globalErrorBanner.classList.add('hidden');
        if (els.globalErrorMessage) els.globalErrorMessage.textContent = '';
        if (els.globalRetry) els.globalRetry.hidden = true;
    }

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

    function clearFormFieldErrors(scope) {
        qa('.field-error', scope || document).forEach((node) => {
            node.textContent = '';
            node.classList.add('hidden');
        });
        qa('[aria-invalid="true"]', scope || document).forEach((node) => {
            node.setAttribute('aria-invalid', 'false');
        });
    }

    function toggleHidden(element, shouldHide) {
        if (!element) return;
        element.classList.toggle('hidden', shouldHide);
        element.hidden = shouldHide;
    }

    // -------------------------------------------------------------------------
    // Networking + pending-request tracking (same lifecycle contract as
    // pocket-management.js's runMutation: pending/success/failure, only the
    // action's own controls disabled, field errors associated, Retry on
    // failure, a version-conflict recovery dialog).
    // -------------------------------------------------------------------------
    function nextRequestId() {
        state.requestCounter += 1;
        return `etm-${Date.now()}-${state.requestCounter}`;
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

    async function runMutation(config) {
        const requestId = nextRequestId();
        state.pendingRequests.set(requestId, config);
        if (config.typeId) ensureDefinitionRecord(config.typeId).pendingRequestIds.add(requestId);

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
            if (config.typeId) {
                const record = state.definitionState.get(config.typeId);
                if (record) record.pendingRequestIds.delete(requestId);
            }
            setControlsDisabled(config.controls, false);
        }
    }

    function handleMutationFailure(config, error) {
        if (error && error.code === 'VERSION_CONFLICT' && config.conflict) {
            const context = typeof config.conflict === 'function' ? config.conflict(error) : config.conflict;
            openVersionConflict(context);
            setStatusText(config.statusEl, 'This record changed elsewhere. Reload to see the latest version.');
            return;
        }

        const list = extractFieldErrors(error);
        if (list.length && typeof config.onFieldErrors === 'function') config.onFieldErrors(list);

        const reason = messageForError(error);
        setStatusText(config.statusEl, reason);
        showGlobalError(reason, () => runMutation(config));
    }

    function extractFieldErrors(error) {
        if (!error) return [];
        const details = error.details || {};
        if (Array.isArray(details.errors) && details.errors.length) {
            return details.errors.map((entry) => ({ field: entry.field, reason: entry.reason || entry.message, code: entry.code }));
        }
        if (error.field) return [{ field: error.field, reason: error.message, code: error.code }];
        return [];
    }

    // -------------------------------------------------------------------------
    // Definition record helpers (ID-keyed)
    // -------------------------------------------------------------------------
    function ensureDefinitionRecord(typeId) {
        let record = state.definitionState.get(typeId);
        if (!record) {
            record = { dto: null, pendingRequestIds: new Set() };
            state.definitionState.set(typeId, record);
        }
        return record;
    }

    function storeDefinitions(collections) {
        const next = new Map();
        []
            .concat(Array.isArray(collections.active) ? collections.active : [])
            .concat(Array.isArray(collections.archived) ? collections.archived : [])
            .forEach((dto) => {
                if (!dto || !dto.id) return;
                const previous = state.definitionState.get(dto.id);
                next.set(dto.id, { dto, pendingRequestIds: previous ? previous.pendingRequestIds : new Set() });
            });
        state.definitionState = next;
    }

    function getDefinitionDto(typeId) {
        const record = state.definitionState.get(typeId);
        return record ? record.dto : null;
    }

    // =========================================================================
    // Load + render
    // =========================================================================
    async function loadDefinitions() {
        if (!state.bootstrap.expenseTypeManagementEnabled) {
            renderFeatureDisabledLists();
            return;
        }
        const url = `/api/expense-types${state.includeArchived ? '?includeArchived=true' : ''}`;
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
            renderDefinitionsError('Network error while loading expense types.');
            showGlobalError('Network error while loading expense types.', loadDefinitions);
        } finally {
            if (els.activeList) els.activeList.setAttribute('aria-busy', 'false');
        }
    }

    function renderFeatureDisabledLists() {
        const message = 'Managed expense types are unavailable until this feature is enabled.';
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

    function openCreateDisclosure() {
        if (els.createDisclosure) els.createDisclosure.open = true;
    }

    function renderDefinitions(collections) {
        const active = Array.isArray(collections.active) ? collections.active : [];
        const archived = Array.isArray(collections.archived) ? collections.archived : [];

        if (els.activeList) {
            els.activeList.innerHTML = '';
            if (active.length === 0) {
                if (els.activeEmptyState) toggleHidden(els.activeEmptyState, false);
                openCreateDisclosure();
            } else {
                if (els.activeEmptyState) toggleHidden(els.activeEmptyState, true);
                active.forEach((dto) => els.activeList.appendChild(renderDefinitionCard(dto)));
            }
        }

        if (els.archivedRegion) toggleHidden(els.archivedRegion, !state.includeArchived);
        if (els.archivedList && state.includeArchived) {
            els.archivedList.innerHTML = '';
            if (archived.length === 0) {
                els.archivedList.innerHTML = '<p class="text-center py-5" style="color: var(--journal-soft-ink);">No archived expense types.</p>';
            } else {
                archived.forEach((dto) => els.archivedList.appendChild(renderDefinitionCard(dto)));
            }
        }
    }

    function renderDefinitionCard(dto) {
        const template = byId('typeDefinitionCardTemplate');
        const card = template.content.firstElementChild.cloneNode(true);
        card.dataset.typeId = dto.id;
        card.dataset.version = String(dto.version);
        setStatusText(q('[data-type-emoji]', card), dto.emoji);
        setStatusText(q('[data-type-name]', card), dto.name);
        setStatusText(q('[data-type-status]', card), dto.status);

        const actions = q('[data-type-actions]', card);
        const editBtn = q('[data-edit-type]', card);
        const archiveBtn = q('[data-archive-type]', card);
        const restoreBtn = q('[data-restore-type]', card);
        const deleteBtn = q('[data-delete-type]', card);

        if (!state.bootstrap.canEdit) {
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
                restoreBtn.addEventListener('click', () => restoreType(dto.id, restoreBtn));
            }
            if (deleteBtn) deleteBtn.addEventListener('click', () => openDeleteDialog(dto.id));
        }
        return card;
    }

    // =========================================================================
    // Create expense type
    // =========================================================================
    const CREATE_FIELD_MAP = () => ({
        emoji: { input: els.createEmoji, error: byId('createTypeEmojiError') },
        name: { input: els.createName, error: byId('createTypeNameError') }
    });

    function applyDefinitionFieldErrors(fieldMap, list) {
        list.forEach((entry) => {
            const target = fieldMap[entry.field];
            if (target) showFieldError(target.input, target.error, entry.reason);
        });
    }

    function submitCreate() {
        if (!els.createForm) return;
        const body = {
            emoji: (els.createEmoji && els.createEmoji.value) || '',
            name: (els.createName && els.createName.value) || ''
        };
        const fieldMap = CREATE_FIELD_MAP();
        runMutation({
            controls: [els.createSubmit],
            statusEl: els.createStatus,
            pendingText: 'Creating expense type…',
            successText: 'Expense type created.',
            clearErrors: () => clearFormFieldErrors(els.createForm),
            perform: () => apiRequest('/api/expense-types', { method: 'POST', body }),
            onFieldErrors: (list) => applyDefinitionFieldErrors(fieldMap, list),
            onSuccess: async () => {
                els.createForm.reset();
                await loadDefinitions();
            }
        });
    }

    // =========================================================================
    // Edit dialog
    // =========================================================================
    function openEditDialog(typeId) {
        const dto = getDefinitionDto(typeId);
        if (!dto || !els.editModal) return;
        populateEditForm(dto);
        clearFormFieldErrors(els.editModal);
        setStatusText(byId('typeEditStatus'), '');
        openDialog(els.editModal);
    }

    function populateEditForm(dto) {
        if (els.editId) els.editId.value = dto.id;
        if (els.editVersion) els.editVersion.value = String(dto.version);
        if (els.editEmoji) els.editEmoji.value = dto.emoji || '';
        if (els.editName) els.editName.value = dto.name || '';
    }

    const EDIT_FIELD_MAP = () => ({
        emoji: { input: els.editEmoji, error: byId('editTypeEmojiError') },
        name: { input: els.editName, error: byId('editTypeNameError') }
    });

    function submitEdit() {
        if (!els.editModal) return;
        const typeId = els.editId.value;
        const version = Number(els.editVersion.value);
        const draft = {
            emoji: (els.editEmoji && els.editEmoji.value) || '',
            name: (els.editName && els.editName.value) || ''
        };
        const body = { ...draft, expectedVersion: version };
        const fieldMap = EDIT_FIELD_MAP();
        const saveControl = q('button[type="submit"]', els.editForm);
        runMutation({
            controls: [saveControl],
            statusEl: byId('typeEditStatus'),
            typeId,
            pendingText: 'Saving changes…',
            successText: 'Expense type updated.',
            clearErrors: () => clearFormFieldErrors(els.editModal),
            perform: () => apiRequest(`/api/expense-types/${encodeURIComponent(typeId)}`, { method: 'PATCH', body }),
            onFieldErrors: (list) => applyDefinitionFieldErrors(fieldMap, list),
            onSuccess: async () => {
                closeDialog(els.editModal);
                await loadDefinitions();
            },
            conflict: {
                restore: () => {
                    if (els.editEmoji) els.editEmoji.value = draft.emoji;
                    if (els.editName) els.editName.value = draft.name;
                },
                loadCurrent: async () => {
                    await loadDefinitions();
                    const fresh = getDefinitionDto(typeId);
                    if (fresh) populateEditForm(fresh);
                }
            }
        });
    }

    // =========================================================================
    // Archive dialog and restore
    // =========================================================================
    function openArchiveDialog(typeId) {
        const dto = getDefinitionDto(typeId);
        if (!dto || !els.archiveModal) return;
        els.archiveModal.dataset.typeId = typeId;
        els.archiveModal.dataset.version = String(dto.version);
        setStatusText(byId('typeArchiveStatus'), '');
        openDialog(els.archiveModal);
    }

    function confirmArchive() {
        if (!els.archiveModal) return;
        const typeId = els.archiveModal.dataset.typeId;
        const version = Number(els.archiveModal.dataset.version);
        const confirmControl = q('[data-confirm-archive]', els.archiveModal);
        runMutation({
            controls: [confirmControl],
            statusEl: byId('typeArchiveStatus'),
            typeId,
            pendingText: 'Archiving…',
            successText: 'Expense type archived.',
            perform: () => apiRequest(`/api/expense-types/${encodeURIComponent(typeId)}/archive`, {
                method: 'POST',
                body: { expectedVersion: version }
            }),
            onSuccess: async () => {
                closeDialog(els.archiveModal);
                await loadDefinitions();
            },
            conflict: {
                restore: () => { /* keep: nothing to restore, no resubmission */ },
                loadCurrent: async () => {
                    await loadDefinitions();
                    const fresh = getDefinitionDto(typeId);
                    if (fresh) els.archiveModal.dataset.version = String(fresh.version);
                }
            }
        });
    }

    // =========================================================================
    // Delete dialog. The server refuses a type any expense uses
    // (EXPENSE_TYPE_IN_USE); the dialog then offers Archive instead.
    // =========================================================================
    function openDeleteDialog(typeId) {
        const dto = getDefinitionDto(typeId);
        if (!dto || !els.deleteModal) return;
        els.deleteModal.dataset.typeId = typeId;
        els.deleteModal.dataset.version = String(dto.version);
        setStatusText(q('[data-delete-type-label]', els.deleteModal), `${dto.emoji || ''} ${dto.name}`.trim());
        setStatusText(byId('typeDeleteStatus'), '');
        toggleHidden(q('[data-confirm-delete]', els.deleteModal), false);
        toggleHidden(q('[data-archive-instead]', els.deleteModal), true);
        openDialog(els.deleteModal);
    }

    function showArchiveInstead(message) {
        const typeId = els.deleteModal.dataset.typeId;
        const dto = getDefinitionDto(typeId);
        setStatusText(byId('typeDeleteStatus'), message);
        hideGlobalError();
        toggleHidden(q('[data-confirm-delete]', els.deleteModal), true);
        toggleHidden(q('[data-archive-instead]', els.deleteModal), !(dto && dto.status === 'Active'));
    }

    async function confirmDelete() {
        if (!els.deleteModal) return;
        const typeId = els.deleteModal.dataset.typeId;
        const version = Number(els.deleteModal.dataset.version);
        const confirmControl = q('[data-confirm-delete]', els.deleteModal);
        const result = await runMutation({
            controls: [confirmControl],
            statusEl: byId('typeDeleteStatus'),
            typeId,
            pendingText: 'Deleting…',
            successText: 'Expense type deleted.',
            perform: () => apiRequest(`/api/expense-types/${encodeURIComponent(typeId)}`, {
                method: 'DELETE',
                body: { expectedVersion: version }
            }),
            onSuccess: async () => {
                closeDialog(els.deleteModal);
                await loadDefinitions();
            },
            conflict: {
                restore: () => { /* nothing to keep */ },
                loadCurrent: async () => { await loadDefinitions(); }
            }
        });
        const code = result && result.error && result.error.code;
        if (code === 'EXPENSE_TYPE_IN_USE' || code === 'LAST_EXPENSE_TYPE') {
            showArchiveInstead(messageForError(result.error));
        }
    }

    function archiveInstead() {
        const typeId = els.deleteModal.dataset.typeId;
        const dto = getDefinitionDto(typeId);
        if (!dto) return;
        const control = q('[data-archive-instead]', els.deleteModal);
        runMutation({
            controls: [control],
            statusEl: byId('typeDeleteStatus'),
            typeId,
            pendingText: 'Archiving…',
            successText: 'Expense type archived.',
            perform: () => apiRequest(`/api/expense-types/${encodeURIComponent(typeId)}/archive`, {
                method: 'POST',
                body: { expectedVersion: dto.version }
            }),
            onSuccess: async () => {
                closeDialog(els.deleteModal);
                await loadDefinitions();
            },
            conflict: {
                restore: () => { /* nothing to keep */ },
                loadCurrent: async () => { await loadDefinitions(); }
            }
        });
    }

    function restoreType(typeId, control) {
        const dto = getDefinitionDto(typeId);
        const version = dto ? dto.version : undefined;
        runMutation({
            controls: [control],
            statusEl: els.globalStatus,
            typeId,
            pendingText: 'Restoring…',
            successText: 'Expense type restored.',
            perform: () => apiRequest(`/api/expense-types/${encodeURIComponent(typeId)}/restore`, {
                method: 'POST',
                body: { expectedVersion: version }
            }),
            onSuccess: async () => { await loadDefinitions(); },
            conflict: {
                restore: () => { /* keep: nothing to restore */ },
                loadCurrent: async () => { await loadDefinitions(); }
            }
        });
    }

    // =========================================================================
    // Version-conflict recovery: reload is the only action (no staged draft to
    // keep, unlike pocket assignment amounts), so there is no keep/load choice.
    // =========================================================================
    function openVersionConflict(context) {
        state.conflict = context;
        if (!els.conflictModal) {
            if (context && typeof context.restore === 'function') context.restore();
            return;
        }
        openDialog(els.conflictModal);
    }

    async function resolveConflictReload() {
        const context = state.conflict;
        state.conflict = null;
        if (els.conflictModal) closeDialog(els.conflictModal);
        if (context && typeof context.loadCurrent === 'function') await context.loadCurrent();
        announceGlobalStatus('Loaded the current stored values.');
    }

    // =========================================================================
    // Dialog focus management (mirrors pocket-management.js)
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
            closeDialog(modal);
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
        const script = byId('expenseTypeManagementBootstrap');
        let parsed = null;
        if (script) {
            try { parsed = JSON.parse(script.textContent || '{}'); } catch (error) { parsed = null; }
        }
        const root = byId('expenseTypeManagementRoot');
        const fromRoot = root ? {
            canEdit: root.dataset.canEdit === 'true',
            role: root.dataset.role,
            expenseTypeManagementEnabled: root.dataset.featureEnabled === 'true'
        } : {};
        state.bootstrap = Object.assign({}, fromRoot, parsed || {});
        state.bootstrap.canEdit = state.bootstrap.canEdit === true;
        state.bootstrap.expenseTypeManagementEnabled = state.bootstrap.expenseTypeManagementEnabled === true;
    }

    function cacheElements() {
        els = {
            root: byId('expenseTypeManagementRoot'),
            globalStatus: byId('typeGlobalStatus'),
            globalError: byId('typeGlobalError'),
            globalErrorBanner: byId('typeGlobalErrorBanner'),
            globalErrorMessage: byId('typeGlobalErrorMessage'),
            globalRetry: byId('typeGlobalRetry'),

            createForm: byId('typeCreateForm'),
            createEmoji: byId('createTypeEmoji'),
            createName: byId('createTypeName'),
            createSubmit: byId('typeCreateSubmit'),
            createStatus: byId('createTypeStatus'),
            createDisclosure: byId('createTypeDisclosure'),

            includeArchivedToggle: byId('includeArchivedToggle'),
            activeList: byId('activeTypeList'),
            activeEmptyState: byId('activeTypeEmptyState'),
            createFirstBtn: byId('createFirstTypeBtn'),
            archivedRegion: byId('archivedTypesRegion'),
            archivedList: byId('archivedTypeList'),

            editModal: byId('typeEditModal'),
            editForm: byId('typeEditForm'),
            editId: byId('editTypeId'),
            editVersion: byId('editTypeVersion'),
            editEmoji: byId('editTypeEmoji'),
            editName: byId('editTypeName'),
            archiveModal: byId('typeArchiveModal'),
            deleteModal: byId('typeDeleteModal'),
            conflictModal: byId('typeVersionConflictModal')
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

        if (els.editForm) {
            els.editForm.addEventListener('submit', (event) => { event.preventDefault(); submitEdit(); });
        }
        wireDialogButton(els.editModal, '[data-cancel-edit]', () => closeDialog(els.editModal));

        wireDialogButton(els.archiveModal, '[data-cancel-archive]', () => closeDialog(els.archiveModal));
        wireDialogButton(els.archiveModal, '[data-confirm-archive]', () => confirmArchive());

        wireDialogButton(els.deleteModal, '[data-cancel-delete]', () => closeDialog(els.deleteModal));
        wireDialogButton(els.deleteModal, '[data-confirm-delete]', () => confirmDelete());
        wireDialogButton(els.deleteModal, '[data-archive-instead]', () => archiveInstead());

        wireDialogButton(els.conflictModal, '[data-reload-types]', () => resolveConflictReload());

        [els.editModal, els.archiveModal, els.deleteModal].forEach((modal) => {
            if (!modal) return;
            modal.addEventListener('click', (event) => { if (event.target === modal) closeDialog(modal); });
        });

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
        if (!byId('expenseTypeManagementRoot')) return;
        parseBootstrap();
        cacheElements();
        wireEvents();

        if (!state.bootstrap.expenseTypeManagementEnabled) {
            renderFeatureDisabledLists();
            return;
        }
        loadDefinitions();
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            __test__: {
                state,
                init,
                loadDefinitions,
                submitCreate,
                submitEdit,
                confirmArchive,
                restoreType,
                openVersionConflict,
                resolveConflictReload
            }
        };
    }
})();
