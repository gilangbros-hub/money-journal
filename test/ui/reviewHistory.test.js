'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const hbs = require('hbs');

const viewSource = fs.readFileSync(require.resolve('../../views/review-history.hbs'), 'utf8');
const browserSource = fs.readFileSync(require.resolve('../../public/js/review-history.js'), 'utf8');

hbs.handlebars.registerPartial('head', '<meta charset="utf-8">');
hbs.handlebars.registerPartial('actionHub', fs.readFileSync(require.resolve('../../views/partials/actionHub.hbs'), 'utf8'));
hbs.handlebars.registerPartial('navbar', fs.readFileSync(require.resolve('../../views/partials/navbar.hbs'), 'utf8'));
const renderView = hbs.handlebars.compile(viewSource);

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return body;
        }
    };
}

function choose(dom, id, value) {
    const select = dom.window.document.getElementById(id);
    select.value = value;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

async function setupPage({ transactions, expenseTypes, pockets, deleteResponse } = {}) {
    const calls = [];
    const toasts = [];
    const historyTransactions = transactions || [
        {
            _id: 'split',
            expenseDate: '2027-03-02',
            type: 'Groceries',
            pocket: 'Groceries',
            sourceType: 'multi',
            sourceBreakdowns: [
                { pocket: 'Groceries', amount: 600 },
                { pocket: 'Kwintals', amount: 400 }
            ],
            amount: 1000,
            ngapain: 'Split expense',
            paidBy: 'Self'
        },
        {
            _id: 'older',
            expenseDate: '2027-02-28',
            type: 'Eat',
            pocket: 'Kwintals',
            amount: 500,
            ngapain: 'Older expense',
            paidBy: 'Self'
        }
    ];
    const dom = new JSDOM(renderView({
        username: 'tester',
        avatar: '👤',
        expenseTypeManagementEnabled: Boolean(expenseTypes),
        pocketManagementEnabled: Boolean(pockets)
    }), {
        url: 'https://money-journal.test/review-history',
        runScripts: 'outside-only'
    });
    dom.window.fetch = async (url, options) => {
        calls.push({ url, options });
        if (options?.method === 'DELETE') {
            return deleteResponse || response({ success: true });
        }
        if (url === '/api/pockets') {
            return response({ success: true, data: { active: pockets || [] } });
        }
        if (url === '/api/expense-types') {
            return response({ success: true, data: { active: expenseTypes || [] } });
        }
        if (url === '/api/budget') {
            return response({
                success: true,
                data: { budgetMonth: '2027-03' }
            });
        }
        return response({
            success: true,
            data: {
                budgetMonth: '2027-03',
                period: { startDate: '2027-02-25', endDate: '2027-03-24' },
                transactions: historyTransactions
            }
        });
    };
    dom.window.formatRupiah = value => `Rp ${value}`;
    dom.window.showToast = (text, type) => { toasts.push({ text, type }); };
    dom.window.openOptions = () => {};
    dom.window.eval(browserSource);
    await new Promise(resolve => setImmediate(resolve));
    return { dom, calls, toasts };
}

test('Review History uses the server month and cycle range, then filters a split transaction once', async () => {
    const { dom, calls } = await setupPage();
    const { document } = dom.window;

    assert.equal(document.getElementById('monthFilter').value, '2027-03');
    assert.match(document.getElementById('salaryCyclePeriod').textContent, /Budget Month 2027-03/);
    assert.match(document.getElementById('salaryCyclePeriod').textContent, /2027-02-25 – 2027-03-24/);
    assert.ok(calls.some(call => call.url === '/api/history?month=2027-03'));

    choose(dom, 'pocketFilter', 'Kwintals');
    const rows = [...document.querySelectorAll('.trans-item')];
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(row => row.textContent.includes('Split expense')).length, 1);
    assert.match(rows.find(row => row.textContent.includes('Split expense')).textContent, /Groceries \+ Kwintals/);
    assert.match(document.getElementById('summaryInfo').textContent, /2 transactions/);
    assert.match(document.getElementById('summaryInfo').textContent, /Rp 1500/);
    dom.window.close();
});

test('Review History groups and sorts canonical date strings without UTC conversion', () => {
    assert.doesNotMatch(browserSource, /toISOString\(\)/);
    assert.doesNotMatch(browserSource, /new Date\(\s*[at]\.?date/);
    assert.doesNotMatch(browserSource, /new Date\(\s*dateKey/);
    assert.match(browserSource, /transactionDateKey\(a\)/);
    assert.match(browserSource, /sourceBreakdowns\.some/);
});


test('Review History groups exact canonical dates once and toggles deterministic string sorting', async () => {
    const { dom } = await setupPage({
        transactions: [
            { _id: 'newer', expenseDate: '2027-03-03', date: '1999-01-01', type: 'Eat', pocket: 'Groceries', amount: 100, ngapain: 'Canonical newer' },
            { _id: 'same-day', expenseDate: '2027-03-03', date: '2099-12-31', type: 'Eat', pocket: 'Groceries', amount: 200, ngapain: 'Same canonical day' },
            { _id: 'older', expenseDate: '2027-02-28', date: '2099-12-31', type: 'Eat', pocket: 'Groceries', amount: 300, ngapain: 'Canonical older' }
        ]
    });
    const { document } = dom.window;

    assert.equal(document.querySelectorAll('.date-group-header').length, 2);
    let listText = document.getElementById('transactionList').textContent;
    assert.match(listText, /Canonical newer/);
    assert.match(listText, /Same canonical day/);
    assert.match(listText, /Canonical older/);

    document.getElementById('sortBtn').click();
    const rows = [...document.querySelectorAll('.trans-item')];
    const sortedRowsText = rows.map(row => row.textContent).join(' ');
    assert.equal(rows.length, 3);
    assert.match(sortedRowsText, /Canonical older/);
    assert.match(sortedRowsText, /Canonical newer/);
    assert.equal(document.querySelectorAll('.date-group-header').length, 2);
    dom.window.close();
});

test('Review History never routes date-only values through UTC serialization or compatibility instants', () => {
    assert.doesNotMatch(browserSource, /toISOString\(\)/);
    assert.doesNotMatch(browserSource, /new Date\(\s*[at]\.?date/);
    assert.doesNotMatch(browserSource, /new Date\(\s*dateKey/);
    assert.match(browserSource, /transactionDateKey\(a\)/);
    assert.match(browserSource, /groups\[key\]/);
});

test('Review History lists managed custom types in the type dropdown with their emoji', async () => {
    const { dom, calls } = await setupPage({
        expenseTypes: [{ id: 't2', name: 'Parkir', emoji: '🅿️', status: 'Active' }],
        transactions: [
            { _id: 'parkir', expenseDate: '2027-03-01', type: 'Parkir', pocket: 'Kwintals', amount: 5000, ngapain: 'Mall parking', paidBy: 'Self' },
            { _id: 'eat', expenseDate: '2027-03-01', type: 'Eat', pocket: 'Kwintals', amount: 1000, ngapain: 'Lunch', paidBy: 'Self' }
        ]
    });
    await new Promise(resolve => setImmediate(resolve));
    const { document } = dom.window;

    assert.ok(calls.some(call => call.url === '/api/expense-types'));
    const option = document.querySelector('#typeFilter option[value="Parkir"]');
    assert.equal(option.textContent, '🅿️ Parkir');
    choose(dom, 'typeFilter', 'Parkir');
    const rows = [...document.querySelectorAll('.trans-item')];
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent, /Mall parking/);
    assert.match(rows[0].textContent, /🅿️/);
    dom.window.close();
});

test('with Pocket Management on, the pocket dropdown lists managed pockets, then pockets only this month uses', async () => {
    const { dom, calls } = await setupPage({
        pockets: [
            { id: 'p1', name: 'Bandung', emoji: '🏠', status: 'Active' },
            { id: 'p2', name: 'Kwintals W1', emoji: '1️⃣', status: 'Active' }
        ],
        transactions: [
            { _id: 'a', expenseDate: '2027-03-02', type: 'Eat', pocket: 'Kwintals W1', amount: 1000, ngapain: 'Lunch' },
            { _id: 'b', expenseDate: '2027-03-01', type: 'Eat', pocket: 'Old Pocket', amount: 2000, ngapain: 'Archived pocket spend' }
        ]
    });
    await new Promise(resolve => setImmediate(resolve));
    const { document } = dom.window;

    assert.ok(calls.some(call => call.url === '/api/pockets'));
    const labels = [...document.querySelectorAll('#pocketFilter option')].map(option => option.textContent);
    assert.deepEqual(labels, ['All pockets', '🏠 Bandung', '1️⃣ Kwintals W1', 'Old Pocket']);

    choose(dom, 'pocketFilter', 'Old Pocket');
    assert.deepEqual(rowNotes(dom), ['Archived pocket spend']);
    dom.window.close();
});

test('without the management flags, the dropdowns keep the built-in lists and skip the definition APIs', async () => {
    const { dom, calls } = await setupPage();
    const { document } = dom.window;

    assert.equal(calls.some(call => call.url === '/api/pockets' || call.url === '/api/expense-types'), false);
    assert.ok(document.querySelector('#pocketFilter option[value="Sedeqah"]'));
    assert.ok(document.querySelector('#typeFilter option[value="Medicine"]'));
    dom.window.close();
});

test('Review History is a navbar tab with History active and no back link', () => {
    const html = renderView({ username: 'tester', avatar: '👤', isHistory: true });
    const { document } = new JSDOM(html).window;

    assert.equal(document.querySelector('.bottom-navbar .nav-item.active').getAttribute('href'), '/review-history');
    assert.equal(document.querySelector('.bottom-navbar').querySelectorAll('.nav-item.active').length, 1);
    assert.doesNotMatch(document.querySelector('.app-header').textContent, /Back/);
});

test('Review History rows open the entry for editing and render notes as text', async () => {
    const { dom } = await setupPage({
        transactions: [{
            _id: 'x1', expenseDate: '2027-03-01', type: 'Eat', pocket: 'Kwintals',
            amount: 1000, ngapain: '<img src=x onerror="window.pwned=1">', paidBy: 'Self'
        }]
    });
    const row = dom.window.document.querySelector('.trans-item');

    assert.equal(row.tagName, 'A');
    assert.equal(row.getAttribute('href'), '/log-spending?edit=x1');
    assert.equal(row.querySelector('img'), null);
    assert.match(row.textContent, /<img src=x/);
    assert.equal(row.querySelector('[data-delete-id]'), null, 'the delete button is beside the link, not inside it');
    dom.window.close();
});

const searchTransactions = [
    { _id: 'g1', expenseDate: '2027-03-03', type: 'Groceries', pocket: 'Groceries', amount: 21000, ngapain: 'Galon Aqua', paidBy: 'Self' },
    { _id: 'e1', expenseDate: '2027-03-02', type: 'Eat', pocket: 'Kwintals', amount: 35000, ngapain: 'Nasi padang', paidBy: 'Self' },
    {
        _id: 's1', expenseDate: '2027-03-01', type: 'Home Appliance', pocket: 'Kwintals', sourceType: 'multi', amount: 450000,
        ngapain: 'Kipas angin', paidBy: 'Self',
        sourceBreakdowns: [{ pocket: 'Kwintals', amount: 300000 }, { pocket: 'Sedeqah', amount: 150000 }]
    },
    { _id: 'g2', expenseDate: '2027-02-28', type: 'Groceries', pocket: 'Groceries', amount: 22000, ngapain: 'galon isi ulang', paidBy: 'Self' }
];

async function search(dom, value, key) {
    const input = dom.window.document.getElementById('historySearch');
    input.value = value;
    if (key) input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
    else input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 200));
}

function rowNotes(dom) {
    // The note is the first text node; badges (split, payer) follow it.
    return [...dom.window.document.querySelectorAll('.trans-item')]
        .map(row => row.querySelector('.font-semibold').firstChild.textContent.trim());
}

test('search narrows the month to matching notes, case-insensitively, and updates the summary', async () => {
    const { dom } = await setupPage({ transactions: searchTransactions });
    const { document } = dom.window;
    assert.equal(document.getElementById('historySearch').getAttribute('placeholder'), 'Search this month');

    await search(dom, 'GALON');
    assert.deepEqual(rowNotes(dom), ['Galon Aqua', 'galon isi ulang']);
    assert.match(document.getElementById('summaryInfo').textContent, /2 transactions/);
    assert.match(document.getElementById('summaryInfo').textContent, /Rp 43000/);
    dom.window.close();
});

test('search matches type, pocket, split shares and amounts', async () => {
    const { dom } = await setupPage({ transactions: searchTransactions });

    await search(dom, 'sedeqah');
    assert.deepEqual(rowNotes(dom), ['Kipas angin']);
    await search(dom, 'home appl');
    assert.deepEqual(rowNotes(dom), ['Kipas angin']);
    await search(dom, '35.000');
    assert.deepEqual(rowNotes(dom), ['Nasi padang']);
    await search(dom, '35000');
    assert.deepEqual(rowNotes(dom), ['Nasi padang']);
    dom.window.close();
});

test('search combines with the type filter, and Escape clears it', async () => {
    const { dom } = await setupPage({ transactions: searchTransactions });
    const { document } = dom.window;

    choose(dom, 'typeFilter', 'Eat');
    await search(dom, 'galon');
    assert.deepEqual(rowNotes(dom), []);
    assert.match(document.getElementById('transactionList').textContent, /No matches for “galon” this month/);

    await search(dom, 'galon', 'Escape');
    assert.equal(document.getElementById('historySearch').value, '');
    assert.deepEqual(rowNotes(dom), ['Nasi padang']);
    dom.window.close();
});

test('the no-match message shows the query as text', async () => {
    const { dom } = await setupPage({ transactions: searchTransactions });
    await search(dom, '<b>zzz</b>');

    const list = dom.window.document.getElementById('transactionList');
    assert.equal(list.querySelector('b'), null);
    assert.match(list.textContent, /<b>zzz<\/b>/);
    dom.window.close();
});

const deleteTransactions = [
    { _id: 'd1', expenseDate: '2027-03-02', type: 'Medicine', pocket: 'Kwintals', amount: 4000, ngapain: 'Medicine', paidBy: 'Self' },
    { _id: 'd2', expenseDate: '2027-03-01', type: 'Bensin', pocket: 'Kwintals', amount: 20, ngapain: 'Bensin', paidBy: 'Self' }
];

test('the trash button asks first, then deletes the row and updates the total', async () => {
    const { dom, calls, toasts } = await setupPage({ transactions: deleteTransactions });
    const doc = dom.window.document;
    const modal = doc.getElementById('deleteModal');

    doc.querySelector('[data-delete-id="d1"]').click();
    assert.ok(modal.classList.contains('show'));
    assert.match(doc.getElementById('deleteDetails').textContent, /Medicine · Rp 4000/);
    assert.equal(calls.some(call => call.options?.method === 'DELETE'), false, 'nothing is deleted before confirming');

    doc.getElementById('deleteConfirmBtn').click();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls.filter(call => call.options?.method === 'DELETE').map(call => call.url), ['/api/transaction/d1']);
    assert.equal(modal.classList.contains('show'), false);
    assert.deepEqual([...doc.querySelectorAll('.trans-item')].map(row => row.getAttribute('href')), ['/log-spending?edit=d2']);
    assert.match(doc.getElementById('summaryInfo').textContent, /1 transaction\b/);
    assert.match(doc.getElementById('summaryInfo').textContent, /Rp 20/);
    assert.deepEqual(toasts, [{ text: 'Transaction deleted', type: 'success' }]);
    dom.window.close();
});

test('cancel and Escape close the dialog without deleting', async () => {
    const { dom, calls } = await setupPage({ transactions: deleteTransactions });
    const doc = dom.window.document;
    const modal = doc.getElementById('deleteModal');

    doc.querySelector('[data-delete-id="d1"]').click();
    doc.getElementById('deleteCancelBtn').click();
    assert.equal(modal.classList.contains('show'), false);

    doc.querySelector('[data-delete-id="d2"]').click();
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(modal.classList.contains('show'), false);

    assert.equal(calls.some(call => call.options?.method === 'DELETE'), false);
    assert.equal(doc.querySelectorAll('.trans-item').length, 2);
    dom.window.close();
});

test('a rejected delete keeps the row and shows the server reason', async () => {
    const { dom, toasts } = await setupPage({
        transactions: deleteTransactions,
        deleteResponse: response({ error: { code: 'PERIOD_CLOSED', message: 'Budget Month 2027-03 is closed.' } }, 409)
    });
    const doc = dom.window.document;

    doc.querySelector('[data-delete-id="d1"]').click();
    doc.getElementById('deleteConfirmBtn').click();
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(doc.getElementById('deleteModal').classList.contains('show'));
    assert.equal(doc.querySelectorAll('.trans-item').length, 2);
    assert.deepEqual(toasts, [{ text: 'Budget Month 2027-03 is closed.', type: 'error' }]);
    dom.window.close();
});
