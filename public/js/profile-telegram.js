'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const linkBtn = document.getElementById('telegramLinkBtn');
    const codeEl = document.getElementById('telegramLinkCode');
    const statusEl = document.getElementById('telegramLinkStatus');
    const unlinkBtn = document.getElementById('telegramUnlinkBtn');

    if (linkBtn) {
        linkBtn.addEventListener('click', async () => {
            linkBtn.disabled = true;
            try {
                const response = await fetch('/api/telegram/link-code', { method: 'POST' });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result?.error?.message || 'Could not generate a code.');
                if (codeEl) {
                    codeEl.textContent = result.data.code;
                    codeEl.classList.remove('hidden');
                }
                if (statusEl) {
                    statusEl.textContent = 'Send this to the bot as /link ' + result.data.code + ' within 10 minutes.';
                    statusEl.classList.remove('hidden');
                }
            } catch (error) {
                if (typeof showToast === 'function') showToast(error.message || 'Network error', 'error');
            } finally {
                linkBtn.disabled = false;
            }
        });
    }

    if (unlinkBtn) {
        unlinkBtn.addEventListener('click', async () => {
            if (!window.confirm('Unlink Telegram from this account?')) return;
            unlinkBtn.disabled = true;
            try {
                const response = await fetch('/api/telegram/unlink', { method: 'POST' });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result?.error?.message || 'Could not unlink.');
                window.location.reload();
            } catch (error) {
                if (typeof showToast === 'function') showToast(error.message || 'Network error', 'error');
                unlinkBtn.disabled = false;
            }
        });
    }
});
