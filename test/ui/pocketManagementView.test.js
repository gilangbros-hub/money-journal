'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const hbs = require('hbs');

const viewSource = fs.readFileSync(require.resolve('../../views/pocket-management.hbs'), 'utf8');

hbs.handlebars.registerPartial('head', '<meta charset="utf-8">');
hbs.handlebars.registerPartial('actionHub', fs.readFileSync(require.resolve('../../views/partials/actionHub.hbs'), 'utf8'));
hbs.handlebars.registerPartial('navbar', fs.readFileSync(require.resolve('../../views/partials/navbar.hbs'), 'utf8'));
const renderView = hbs.handlebars.compile(viewSource);

function render(overrides = {}) {
    return renderView({
        username: 'tester',
        avatar: '👤',
        role: 'Wife',
        canEdit: true,
        pocketManagementEnabled: true,
        pocketManagementDualWriteEnabled: false,
        ...overrides
    });
}

test('the page separates pocket types, active pockets, and Budget Month assignment', () => {
    const document = new JSDOM(render()).window.document;
    const steps = [...document.querySelectorAll('.pm-step')].map(step => step.id);

    assert.deepEqual(steps, ['stepPocketTypes', 'stepActivePockets', 'stepAssignMonth']);
    assert.deepEqual(
        [...document.querySelectorAll('.pm-step-badge')].map(badge => badge.textContent.trim()),
        ['1', '2', '3']
    );
    assert.equal(document.querySelectorAll('.pm-divider').length, 2);
    for (const step of document.querySelectorAll('.pm-step')) {
        assert.ok(step.getAttribute('aria-labelledby'));
        assert.ok(step.querySelector('.pm-step-hint').textContent.trim().length > 0);
    }
});

test('step navigation targets the three step sections in workflow order', () => {
    const document = new JSDOM(render()).window.document;
    const targets = [...document.querySelectorAll('.pm-stepnav a')].map(link => link.getAttribute('href'));

    assert.deepEqual(targets, ['#stepPocketTypes', '#stepActivePockets', '#stepAssignMonth']);
    for (const href of targets) assert.ok(document.querySelector(href), `${href} has no target`);
});

test('the create form sits behind a disclosure inside step one', () => {
    const document = new JSDOM(render()).window.document;
    const disclosure = document.getElementById('createPocketDisclosure');

    assert.equal(disclosure.tagName, 'DETAILS');
    assert.equal(disclosure.open, false);
    assert.ok(disclosure.querySelector('summary'));
    assert.ok(disclosure.contains(document.getElementById('pocketCreateForm')));
    assert.equal(document.getElementById('stepPocketTypes').contains(disclosure), true);
});

test('archived toggle and active pocket list belong to step two', () => {
    const document = new JSDOM(render()).window.document;
    const step = document.getElementById('stepActivePockets');

    assert.ok(step.contains(document.getElementById('includeArchivedToggle')));
    assert.ok(step.contains(document.getElementById('activePocketList')));
    assert.ok(step.contains(document.getElementById('archivedPocketsRegion')));
});

test('assignment controls belong to step three and drop the clashing sub-numbering', () => {
    const document = new JSDOM(render()).window.document;
    const step = document.getElementById('stepAssignMonth');

    assert.ok(step.contains(document.getElementById('setupBudgetMonth')));
    assert.ok(step.contains(document.getElementById('setupPocketSelection')));
    assert.ok(step.contains(document.getElementById('assignmentSummary')));
    assert.equal(document.getElementById('assignmentConfirmBtn').textContent.trim(), 'Confirm assignments');
    assert.doesNotMatch(step.textContent, /\b[1-6]\.\s(Select|Amount|Review|Confirm)/);
});

test('a view-only member still sees the three steps without the create form', () => {
    const document = new JSDOM(render({ canEdit: false, role: 'Husband' })).window.document;

    assert.equal(document.querySelectorAll('.pm-step').length, 3);
    assert.equal(document.getElementById('createPocketDisclosure'), null);
    assert.equal(document.getElementById('pocketCreateForm'), null);
    assert.match(document.getElementById('stepPocketTypes').textContent, /Only a Wife-role user can create pockets/);
});

// ---------------------------------------------------------------------------
// Bank picker. These run the page script (plus banks.js) in JSDOM with a fake
// fetch, the same way the Check Pockets interaction tests do.
// ---------------------------------------------------------------------------
const { BANK_KEYS, bankView } = require('../../utils/banks');

const pageSource = fs.readFileSync(require.resolve('../../public/js/pocket-management.js'), 'utf8');
const banksSource = fs.readFileSync(require.resolve('../../public/js/banks.js'), 'utf8');
const BANK_VIEWS = BANK_KEYS.map(bankView);

function jsonResponse(payload, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function setupPage({ definitions = [], calls = [] } = {}) {
    const dom = new JSDOM(render({ banks: BANK_VIEWS, banksJson: JSON.stringify(BANK_VIEWS) }), {
        url: 'https://money-journal.test/pocket-management',
        runScripts: 'outside-only'
    });
    dom.window.fetch = async (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
        if (url.startsWith('/api/pockets') && (options.method || 'GET') === 'GET') {
            return jsonResponse({ success: true, data: { active: definitions } });
        }
        if (url.startsWith('/api/pocket-assignments/setup')) {
            return jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: 'none' } }, 404);
        }
        return jsonResponse({ success: true, data: {} });
    };
    dom.window.formatRupiah = value => `Rp ${value}`;
    dom.window.showToast = () => {};
    dom.window.eval(banksSource);
    dom.window.eval(pageSource);
    await settle();
    await settle();
    return dom;
}

const definition = (overrides = {}) => ({
    id: 'p1', name: 'Groceries', normalizedName: 'groceries', emoji: '🛒',
    cadence: 'Monthly', defaultAmount: 100000, status: 'Active', version: 3, ...overrides
});

function fillCreateForm(document) {
    document.getElementById('createPocketEmoji').value = '🛒';
    document.getElementById('createPocketName').value = 'Groceries';
    document.getElementById('createPocketDefaultAmount').value = '250000';
}

test('the create form offers one logo tile per bank', () => {
    const document = new JSDOM(render({ banks: BANK_VIEWS })).window.document;
    const options = [...document.querySelectorAll('#createPocketBank input[data-bank-option]')];

    assert.deepEqual(options.map(input => input.value), ['jago', 'blu', 'superbank', 'bca']);
    assert.equal(options.some(input => input.checked), false);
    const jago = document.querySelector('#createPocketBank [data-bank-logo="jago"] img');
    assert.equal(jago.getAttribute('src'), '/images/banks/jago.svg');
});

test('creating a pocket without a bank shows the error and never POSTs', async () => {
    const calls = [];
    const dom = await setupPage({ calls });
    const { document } = dom.window;
    fillCreateForm(document);

    document.getElementById('pocketCreateForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();

    const error = document.getElementById('createPocketBankError');
    assert.equal(error.classList.contains('hidden'), false);
    assert.match(error.textContent, /bank/i);
    assert.equal(calls.some(call => call.method === 'POST'), false);
    dom.window.close();
});

test('picking blu sends bank: blu with the create request', async () => {
    const calls = [];
    const dom = await setupPage({ calls });
    const { document } = dom.window;
    fillCreateForm(document);
    document.querySelector('#createPocketBank input[value="blu"]').checked = true;

    document.getElementById('pocketCreateForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();

    const post = calls.find(call => call.method === 'POST' && call.url === '/api/pockets');
    assert.ok(post, 'expected a create request');
    assert.equal(post.body.bank, 'blu');
    dom.window.close();
});

test('pocket cards show the bank logo, or a No bank chip for older pockets', async () => {
    const dom = await setupPage({
        definitions: [definition({ id: 'p1', bank: 'jago' }), definition({ id: 'p2', name: 'Old', normalizedName: 'old' })]
    });
    const { document } = dom.window;
    const cards = [...document.querySelectorAll('#activePocketList [data-pocket-card]')];

    const jagoRow = cards.find(card => card.dataset.pocketId === 'p1').querySelector('[data-pocket-bank]');
    assert.ok(jagoRow.querySelector('[data-bank-logo="jago"] img'));
    assert.match(jagoRow.textContent, /Jago/);
    const oldRow = cards.find(card => card.dataset.pocketId === 'p2').querySelector('[data-pocket-bank]');
    assert.match(oldRow.textContent, /No bank/);
    dom.window.close();
});

test('editing a pocket preselects its bank and saving without one is blocked', async () => {
    const calls = [];
    const dom = await setupPage({
        calls,
        definitions: [definition({ id: 'p1', bank: 'superbank' }), definition({ id: 'p2', name: 'Old', normalizedName: 'old' })]
    });
    const { document } = dom.window;
    const cardFor = id => document.querySelector(`#activePocketList [data-pocket-id="${id}"]`);

    cardFor('p1').querySelector('[data-edit-pocket]').click();
    assert.equal(document.querySelector('#editPocketBank input:checked').value, 'superbank');
    assert.equal(document.querySelector('[data-edit-bank-missing]').hidden, true);

    cardFor('p2').querySelector('[data-edit-pocket]').click();
    assert.equal(document.querySelector('#editPocketBank input:checked'), null);
    assert.equal(document.querySelector('[data-edit-bank-missing]').hidden, false);
    document.getElementById('pocketEditForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(document.getElementById('editPocketBankError').classList.contains('hidden'), false);
    assert.equal(calls.some(call => call.method === 'PATCH'), false);

    document.querySelector('#editPocketBank input[value="bca"]').checked = true;
    document.getElementById('pocketEditForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
    const patch = calls.find(call => call.method === 'PATCH');
    assert.equal(patch.url, '/api/pockets/p2');
    assert.equal(patch.body.bank, 'bca');
    dom.window.close();
});

test('a logo that fails to load swaps to the letter badge', async () => {
    const dom = await setupPage({ definitions: [definition({ bank: 'blu' })] });
    const { document } = dom.window;
    const img = document.querySelector('#activePocketList [data-bank-logo="blu"] img');

    img.dispatchEvent(new dom.window.Event('error'));

    assert.equal(img.hidden, true);
    const badge = img.nextElementSibling;
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, 'B');
    dom.window.close();
});
