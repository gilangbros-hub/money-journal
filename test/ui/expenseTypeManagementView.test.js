'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const hbs = require('hbs');

const viewSource = fs.readFileSync(require.resolve('../../views/expense-type-management.hbs'), 'utf8');

hbs.handlebars.registerPartial('head', '<meta charset="utf-8">');
const renderView = hbs.handlebars.compile(viewSource);

function render(overrides = {}) {
    return renderView({
        username: 'tester',
        avatar: '👤',
        role: 'Wife',
        canEdit: true,
        expenseTypeManagementEnabled: true,
        ...overrides
    });
}

test('the page separates creating a type from managing existing ones, each with a numbered step', () => {
    const document = new JSDOM(render()).window.document;
    const steps = [...document.querySelectorAll('.pm-step')].map((step) => step.id);

    assert.deepEqual(steps, ['stepCreateType', 'stepActiveTypes']);
    assert.deepEqual(
        [...document.querySelectorAll('.pm-step-badge')].map((badge) => badge.textContent.trim()),
        ['1', '2']
    );
    assert.equal(document.querySelectorAll('.pm-divider').length, 1);
});

test('the create form sits behind a disclosure, closed by default', () => {
    const document = new JSDOM(render()).window.document;
    const disclosure = document.getElementById('createTypeDisclosure');

    assert.equal(disclosure.tagName, 'DETAILS');
    assert.equal(disclosure.open, false);
    assert.ok(disclosure.contains(document.getElementById('typeCreateForm')));
});

test('a view-only member sees no create form or mutation controls', () => {
    const document = new JSDOM(render({ canEdit: false, role: 'Husband' })).window.document;

    assert.equal(document.getElementById('typeCreateForm'), null);
    assert.equal(document.getElementById('typeEditModal'), null);
    assert.match(document.body.textContent.replace(/\s+/g, ' '), /Only a Wife-role user can create expense types/);
    assert.match(document.body.textContent, /View-only mode/);
});

test('the disabled-feature notice appears only when the flag is off', () => {
    const enabled = new JSDOM(render()).window.document;
    assert.equal(enabled.getElementById('featureDisabledNotice'), null);

    const disabled = new JSDOM(render({ expenseTypeManagementEnabled: false })).window.document;
    assert.ok(disabled.getElementById('featureDisabledNotice'));
});

test('the type definition card template has no cadence or default-amount fields', () => {
    const document = new JSDOM(render()).window.document;
    const template = document.getElementById('typeDefinitionCardTemplate');

    assert.ok(template.content.querySelector('[data-type-emoji]'));
    assert.ok(template.content.querySelector('[data-type-name]'));
    assert.ok(template.content.querySelector('[data-type-status]'));
    assert.equal(template.content.querySelector('[data-pocket-cadence]'), null);
    assert.equal(template.content.querySelector('[data-pocket-default]'), null);
});

// ---------------------------------------------------------------------------
// Delete. Runs the page script in JSDOM with a fake fetch.
// ---------------------------------------------------------------------------
const pageSource = fs.readFileSync(require.resolve('../../public/js/expense-type-management.js'), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function jsonResponse(payload, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

const TYPES = [
    { id: 't1', name: 'Parkir', normalizedName: 'parkir', emoji: '🅿️', status: 'Active', version: 2 },
    { id: 't2', name: 'Eat', normalizedName: 'eat', emoji: '🍽️', status: 'Active', version: 1 }
];

async function setupPage(onMutation) {
    const calls = [];
    const dom = new JSDOM(render(), { url: 'https://money-journal.test/expense-type-management', runScripts: 'outside-only' });
    dom.window.fetch = async (url, options = {}) => {
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(options.body) : undefined;
        calls.push({ url, method, body });
        if (method === 'GET') return jsonResponse({ success: true, data: { active: TYPES } });
        return onMutation({ url, method, body });
    };
    dom.window.showToast = () => {};
    dom.window.eval(pageSource);
    await settle();
    await settle();
    return { dom, calls };
}

const card = (document, id) => document.querySelector(`#activeTypeList [data-type-id="${id}"]`);

test('every type card has a Delete button that opens a confirm naming the type', async () => {
    const { dom } = await setupPage(() => jsonResponse({ success: true, data: {} }));
    const { document } = dom.window;

    assert.ok(card(document, 't1').querySelector('[data-delete-type]'));
    card(document, 't1').querySelector('[data-delete-type]').click();
    const modal = document.getElementById('typeDeleteModal');
    assert.equal(modal.hidden, false);
    assert.equal(modal.querySelector('[data-delete-type-label]').textContent, '🅿️ Parkir');
    dom.window.close();
});

test('confirming sends DELETE with the version and reloads the list', async () => {
    const { dom, calls } = await setupPage(() => jsonResponse({ success: true, data: { id: 't1', deleted: true } }));
    const { document } = dom.window;

    card(document, 't1').querySelector('[data-delete-type]').click();
    document.querySelector('[data-confirm-delete]').click();
    await settle();
    await settle();

    const del = calls.find(call => call.method === 'DELETE');
    assert.equal(del.url, '/api/expense-types/t1');
    assert.deepEqual(del.body, { expectedVersion: 2 });
    assert.equal(document.getElementById('typeDeleteModal').hidden, true);
    assert.ok(calls.filter(call => call.method === 'GET').length >= 2);
    dom.window.close();
});

test('a type in use is not deleted; the dialog explains and offers Archive instead', async () => {
    const { dom, calls } = await setupPage(({ method }) => (method === 'DELETE'
        ? jsonResponse({ error: { code: 'EXPENSE_TYPE_IN_USE', message: 'Parkir is used by 3 expenses. Archive it instead.' } }, 409)
        : jsonResponse({ success: true, data: {} })));
    const { document } = dom.window;

    card(document, 't1').querySelector('[data-delete-type]').click();
    document.querySelector('[data-confirm-delete]').click();
    await settle();
    await settle();

    const modal = document.getElementById('typeDeleteModal');
    assert.equal(modal.hidden, false);
    assert.match(document.getElementById('typeDeleteStatus').textContent, /used by 3 expenses/);
    assert.equal(modal.querySelector('[data-confirm-delete]').hidden, true);
    const archive = modal.querySelector('[data-archive-instead]');
    assert.equal(archive.hidden, false);

    archive.click();
    await settle();
    const post = calls.find(call => call.method === 'POST');
    assert.equal(post.url, '/api/expense-types/t1/archive');
    assert.deepEqual(post.body, { expectedVersion: 2 });
    dom.window.close();
});
