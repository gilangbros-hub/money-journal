'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const commonSource = fs.readFileSync(require.resolve('../../public/js/common.js'), 'utf8');

function setupPage() {
    const dom = new JSDOM('<div id="message" class="toast"></div>', {
        url: 'https://money-journal.test/log-spending',
        runScripts: 'outside-only'
    });
    dom.window.eval(commonSource);
    return dom;
}

test('showToast keeps the legacy (text, type, duration) behaviour', () => {
    const dom = setupPage();
    const toast = dom.window.document.getElementById('message');

    dom.window.showToast('Saved', 'success', 10);
    assert.equal(toast.textContent, 'Saved');
    assert.ok(toast.classList.contains('show'));
    assert.ok(toast.classList.contains('success'));
    assert.equal(toast.querySelector('button'), null);

    dom.window.showToast('Broken', 'error');
    assert.ok(toast.classList.contains('error'));
    assert.equal(toast.classList.contains('success'), false);
    dom.window.close();
});

test('showToast renders one action button that hides the toast and runs the action once', () => {
    const dom = setupPage();
    const toast = dom.window.document.getElementById('message');
    let runs = 0;

    dom.window.showToast('Saved · Rp 35.000', 'success', { actionLabel: 'Undo', onAction: () => { runs += 1; } });
    const action = toast.querySelector('button.toast-action');
    assert.equal(action.textContent, 'Undo');
    assert.match(toast.textContent, /^Saved · Rp 35\.000/);

    action.click();
    action.click();
    assert.equal(runs, 1);
    assert.equal(toast.classList.contains('show'), false);

    dom.window.showToast('Next', 'success');
    assert.equal(toast.querySelector('button'), null);
    dom.window.close();
});
