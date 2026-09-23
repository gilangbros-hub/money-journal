'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const hbs = require('hbs');

const viewSource = fs.readFileSync(require.resolve('../../views/log-spending.hbs'), 'utf8');
const browserSource = fs.readFileSync(require.resolve('../../public/js/log-spending.js'), 'utf8');

hbs.handlebars.registerPartial('head', '<meta charset="utf-8">');
hbs.handlebars.registerHelper('split', value => value.split(',').map(item => item.trim()));
hbs.handlebars.registerHelper('getEmoji', () => '');
hbs.handlebars.registerHelper('getPocketEmoji', () => '');
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

function pocketOptionsResponse(options = [{ pocketId: 'pocket-1', name: 'Kwintals', emoji: '💰', cadence: 'Monthly' }]) {
    return response({ success: true, data: options });
}

async function setupPage(fetchImpl, { edit = '', showToast = () => {}, expenseTypeManagementEnabled = false, storage = {} } = {}) {
    const dom = new JSDOM(renderView({
        username: 'tester',
        avatar: '👤',
        salaryCycleBudgetingEnabled: true,
        expenseTypeManagementEnabled
    }), {
        url: `https://money-journal.test/log-spending${edit ? `?edit=${edit}` : ''}`,
        runScripts: 'outside-only'
    });
    // Each JSDOM gets a fresh origin storage; seed it before the page script runs.
    dom.window.localStorage.clear();
    Object.entries(storage).forEach(([key, value]) => dom.window.localStorage.setItem(key, value));
    dom.window.fetch = fetchImpl;
    dom.window.showToast = showToast;
    dom.window.formatRupiah = value => `Rp ${value}`;
    dom.window.launchConfetti = () => {};
    dom.window.CSS = dom.window.CSS || { escape: value => value };
    dom.window.eval(browserSource);
    await new Promise(resolve => setImmediate(resolve));
    return dom;
}

test('enabled Log Spending renders a read-only server assignment and uses raw date payloads', async () => {
    const calls = [];
    const dom = await setupPage(async (url, options) => {
        calls.push({ url, options });
        if (url.startsWith('/api/salary-cycle/assignment')) {
            const date = new URL(`https://money-journal.test${url}`).searchParams.get('date');
            return response({
                success: true,
                data: {
                    expenseDate: date,
                    budgetMonth: date === '2027-02-25' ? '2027-03' : '2027-02',
                    period: date === '2027-02-25'
                        ? { startDate: '2027-02-25', endDate: '2027-03-24' }
                        : { startDate: '2027-01-25', endDate: '2027-02-24' }
                }
            });
        }
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse();
        return response({ success: true });
    });

    const { document } = dom.window;
    assert.equal(document.getElementById('budgetMonth'), null);
    assert.equal(document.getElementById('derivedBudgetMonth').textContent, '2027-02');
    assert.equal(document.getElementById('derivedBudgetPeriod').textContent, '2027-01-25 – 2027-02-24');

    dom.window.selectManagedPocket('pocket-1');

    const date = document.getElementById('date');
    date.value = '2027-02-25';
    date.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.getElementById('derivedBudgetMonth').textContent, '2027-03');
    assert.equal(document.getElementById('derivedBudgetPeriod').textContent, '2027-02-25 – 2027-03-24');

    document.getElementById('amount').value = '1250';
    document.getElementById('ngapain').value = 'Coffee';
    document.getElementById('transactionForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));

    const submit = calls.find(call => call.options?.method === 'POST');
    assert.ok(submit);
    const payload = JSON.parse(submit.options.body);
    assert.equal(payload.expenseDate, '2027-02-25');
    assert.equal(payload.date, '2027-02-25');
    assert.equal(payload.pocketId, 'pocket-1');
    assert.equal(payload.pocket, 'Kwintals');
    assert.equal(Object.hasOwn(payload, 'budgetMonth'), false);
    assert.equal(Object.hasOwn(payload, 'budgetYear'), false);
    dom.window.close();
});

test('invalid date disables submit and a 409 save refreshes the assignment preview', async () => {
    let saveAttempts = 0;
    let previewCalls = 0;
    const dom = await setupPage(async (url, options) => {
        if (url.startsWith('/api/salary-cycle/assignment')) {
            previewCalls += 1;
            const refreshed = previewCalls >= 3;
            return response({
                success: true,
                data: {
                    budgetMonth: refreshed ? '2027-03' : '2027-02',
                    period: refreshed
                        ? { startDate: '2027-02-25', endDate: '2027-03-24' }
                        : { startDate: '2027-01-25', endDate: '2027-02-24' }
                }
            });
        }
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse();
        saveAttempts += 1;
        return response({ error: { message: 'Assignment changed; refresh required.' } }, 409);
    });

    const { document } = dom.window;
    dom.window.selectManagedPocket('pocket-1');
    const date = document.getElementById('date');
    date.value = '';
    date.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.getElementById('submitBtn').disabled, true);
    assert.equal(document.getElementById('dateError').textContent, 'Date must be a valid YYYY-MM-DD calendar date.');

    document.getElementById('amount').value = '1000';
    document.getElementById('ngapain').value = 'Lunch';
    document.getElementById('transactionForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saveAttempts, 0);

    date.value = '2027-02-24';
    date.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setImmediate(resolve));
    document.getElementById('transactionForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(saveAttempts, 1);
    assert.equal(previewCalls, 3);
    assert.equal(document.getElementById('derivedBudgetMonth').textContent, '2027-03');
    assert.equal(document.getElementById('derivedBudgetPeriod').textContent, '2027-02-25 – 2027-03-24');
    dom.window.close();
});

test('edit uses canonical expenseDate without date-only Date or UTC conversion', () => {
    assert.match(browserSource, /const canonicalDate = canonicalExpenseDate\(transaction\);/);
    assert.doesNotMatch(browserSource, /new Date\(transaction\.date\)/);
    assert.doesNotMatch(browserSource, /toISOString\(\)/);
});

test('server preview errors show the field message and server save errors show a toast', async () => {
    const previewDom = await setupPage(async url => {
        if (url.startsWith('/api/salary-cycle/assignment')) {
            return response({ error: { message: 'Expense date is outside the supported calendar.' } }, 422);
        }
        return response({ success: true });
    });

    assert.equal(previewDom.window.document.getElementById('submitBtn').disabled, true);
    assert.equal(previewDom.window.document.getElementById('derivedBudgetMonth').textContent, 'Unable to resolve');
    assert.equal(previewDom.window.document.getElementById('dateError').textContent, 'Expense date is outside the supported calendar.');
    previewDom.window.close();

    const toastCalls = [];
    const saveDom = await setupPage(async (url, options) => {
        if (url.startsWith('/api/salary-cycle/assignment')) {
            return response({
                success: true,
                data: {
                    budgetMonth: '2027-02',
                    period: { startDate: '2027-01-25', endDate: '2027-02-24' }
                }
            });
        }
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse();
        return response({ error: { message: 'Transaction service unavailable.' } }, 503);
    }, { showToast: (message, type) => toastCalls.push({ message, type }) });

    saveDom.window.selectManagedPocket('pocket-1');
    saveDom.window.document.getElementById('amount').value = '1000';
    saveDom.window.document.getElementById('ngapain').value = 'Lunch';
    saveDom.window.document.getElementById('transactionForm').dispatchEvent(new saveDom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(toastCalls, [{ message: 'Transaction service unavailable.', type: 'error' }]);
    saveDom.window.close();
});
test('disabled mode keeps the legacy Budget Month compatibility selector', () => {
    const html = renderView({ username: 'tester', avatar: '👤', salaryCycleBudgetingEnabled: false });
    assert.match(html, /id="budgetMonth"/);
    assert.doesNotMatch(html, /id="derivedBudgetPeriod"/);
});

test('edit round trip uses the API expenseDate string directly', async () => {
    const calls = [];
    const dom = await setupPage(async (url, options) => {
        calls.push({ url, options });
        if (url === '/api/transaction/transaction-id') {
            return response({
                _id: 'transaction-id',
                expenseDate: '2027-02-24',
                date: '2027-02-23T17:00:00.000Z',
                type: 'Eat',
                amount: 1000,
                ngapain: 'Existing expense',
                sourceType: 'single',
                pocket: 'Kwintals',
                pocketId: 'pocket-1'
            });
        }
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse();
        if (options?.method === 'PUT') return response({ success: true });
        return response({
            success: true,
            data: {
                budgetMonth: '2027-02',
                period: { startDate: '2027-01-25', endDate: '2027-02-24' }
            }
        });
    }, { edit: 'transaction-id' });

    assert.equal(dom.window.document.getElementById('date').value, '2027-02-24');
    assert.equal(dom.window.document.getElementById('derivedBudgetMonth').textContent, '2027-02');

    dom.window.document.getElementById('transactionForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));

    const update = calls.find(call => call.options?.method === 'PUT');
    assert.ok(update);
    assert.equal(update.url, '/api/transaction/transaction-id');
    const payload = JSON.parse(update.options.body);
    assert.equal(payload.expenseDate, '2027-02-24');
    assert.equal(payload.date, '2027-02-24');
    assert.equal(payload.type, 'Eat');
    assert.equal(payload.ngapain, 'Existing expense');
    assert.equal(payload.amount, '1000');
    assert.equal(payload.sourceType, 'single');
    assert.equal(payload.pocketId, 'pocket-1');
    assert.equal(payload.pocket, 'Kwintals');
    assert.equal(Object.hasOwn(payload, 'budgetMonth'), false);
    assert.equal(Object.hasOwn(payload, 'budgetYear'), false);
    dom.window.close();
});

test('the pocket sheet never renders a fixed-pocket list, only loading then the real managed options', async () => {
    // Reproduces the reported bug: the pocket sheet used to render a
    // hardcoded eight-pocket grid immediately (server-rendered), then swap it
    // for the real assignment-backed list once the fetch resolved. There is
    // now no server-rendered grid to flash — only a loading state that the
    // real data replaces.
    let resolveFetch;
    const pending = new Promise((resolve) => { resolveFetch = resolve; });
    const dom = await setupPage(async (url) => {
        if (url.startsWith('/api/salary-cycle/assignment')) {
            return response({
                success: true,
                data: { budgetMonth: '2027-02', period: { startDate: '2027-01-25', endDate: '2027-02-24' } }
            });
        }
        if (url.startsWith('/api/expense-pocket-options')) {
            await pending;
            return pocketOptionsResponse([
                { pocketId: 'pocket-1', name: 'Free Monkey', emoji: '💰', cadence: 'Monthly' }
            ]);
        }
        return response({ success: true });
    });

    const { document } = dom.window;
    const grid = document.querySelector('#pocketSheet [data-pocket-grid]');
    assert.doesNotMatch(grid.innerHTML, /Kwintals|Groceries|Weekday Transport/);
    assert.ok(grid.querySelector('[data-pocket-loading]'));
    assert.equal(document.getElementById('selectedPocketDisplay').textContent, 'Loading…');

    resolveFetch();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.doesNotMatch(grid.innerHTML, /Kwintals|Groceries|Weekday Transport/);
    assert.match(grid.innerHTML, /Free Monkey/);
    dom.window.close();
});

function assignmentResponse() {
    return response({
        success: true,
        data: { budgetMonth: '2027-02', period: { startDate: '2027-01-25', endDate: '2027-02-24' } }
    });
}

function managedTypesResponse(active) {
    return response({ success: true, data: { active } });
}

async function settle() {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}

test('managed expense types replace the hardcoded picker and a custom type can be saved', async () => {
    const calls = [];
    const dom = await setupPage(async (url, options) => {
        calls.push({ url, options });
        if (url.startsWith('/api/salary-cycle/assignment')) return assignmentResponse();
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse();
        if (url === '/api/expense-types') {
            return managedTypesResponse([
                { id: 't1', name: 'Eat', emoji: '🍽️', status: 'Active' },
                { id: 't2', name: 'Parkir', emoji: '🅿️', status: 'Active' }
            ]);
        }
        return response({ success: true });
    }, { expenseTypeManagementEnabled: true });
    await settle();

    const { document } = dom.window;
    const buttons = [...document.querySelectorAll('#typeSheet [data-type-option]')].map(button => button.dataset.typeOption);
    assert.deepEqual(buttons, ['Eat', 'Parkir']);
    assert.equal(document.getElementById('selectedTypeDisplay').textContent, '🍽️ Eat');

    document.querySelector('#typeSheet [data-type-option="Parkir"]').click();
    assert.equal(document.getElementById('selectedTypeDisplay').textContent, '🅿️ Parkir');

    dom.window.selectManagedPocket('pocket-1');
    document.getElementById('amount').value = '5000';
    document.getElementById('ngapain').value = 'Mall';
    document.getElementById('transactionForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const submit = calls.find(call => call.options?.method === 'POST');
    assert.equal(JSON.parse(submit.options.body).type, 'Parkir');
    dom.window.close();
});

test('a managed list without the default type falls back to its first type', async () => {
    const dom = await setupPage(async (url) => {
        if (url.startsWith('/api/salary-cycle/assignment')) return assignmentResponse();
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse();
        if (url === '/api/expense-types') return managedTypesResponse([{ id: 't2', name: 'Parkir', emoji: '🅿️' }]);
        return response({ success: true });
    }, { expenseTypeManagementEnabled: true });
    await settle();

    assert.equal(dom.window.getSelectedType(), 'Parkir');
    dom.window.close();
});

test('with Expense Type Management off the picker keeps the hardcoded list and never fetches types', async () => {
    const calls = [];
    const dom = await setupPage(async (url) => {
        calls.push(url);
        if (url.startsWith('/api/salary-cycle/assignment')) return assignmentResponse();
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse();
        return response({ success: true });
    });
    await settle();

    assert.equal(calls.includes('/api/expense-types'), false);
    assert.equal(dom.window.document.querySelectorAll('#typeSheet [data-type-option]').length, 12);
    assert.ok(dom.window.document.querySelector('#typeSheet [data-type-option="Uang Keamanan"]'));
    dom.window.close();
});

test('a failed managed type fetch keeps the hardcoded list', async () => {
    const dom = await setupPage(async (url) => {
        if (url.startsWith('/api/salary-cycle/assignment')) return assignmentResponse();
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse();
        if (url === '/api/expense-types') return response({ success: false }, 503);
        return response({ success: true });
    }, { expenseTypeManagementEnabled: true });
    await settle();

    assert.equal(dom.window.document.querySelectorAll('#typeSheet [data-type-option]').length, 12);
    assert.equal(dom.window.getSelectedType(), 'Eat');
    dom.window.close();
});

test('editing keeps a type that is no longer in the managed list, and does not bump the streak', async () => {
    const calls = [];
    const toasts = [];
    const dom = await setupPage(async (url, options) => {
        calls.push({ url, options });
        if (options?.method === 'PUT') return response({ success: true });
        if (url === '/api/transaction/transaction-id') {
            return response({
                _id: 'transaction-id',
                expenseDate: '2027-02-24',
                type: 'Kopi',
                amount: 18000,
                ngapain: 'Flat white',
                sourceType: 'single',
                pocket: 'Kwintals',
                pocketId: 'pocket-1'
            });
        }
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse();
        if (url === '/api/expense-types') return managedTypesResponse([{ id: 't1', name: 'Eat', emoji: '🍽️' }]);
        return assignmentResponse();
    }, {
        edit: 'transaction-id',
        expenseTypeManagementEnabled: true,
        showToast: (message, type) => toasts.push({ message, type })
    });
    await settle();

    const { document, localStorage } = dom.window;
    assert.equal(dom.window.getSelectedType(), 'Kopi');
    assert.ok(document.querySelector('#typeSheet [data-type-option="Kopi"]'));

    const streak = JSON.stringify({ count: 4, lastDate: '2000-01-01' });
    localStorage.setItem('moneyJournalStreak', streak);
    document.getElementById('transactionForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const update = calls.find(call => call.options?.method === 'PUT');
    assert.equal(JSON.parse(update.options.body).type, 'Kopi');
    assert.equal(localStorage.getItem('moneyJournalStreak'), streak);
    assert.deepEqual(toasts, [{ message: 'Transaction updated', type: 'success' }]);
    dom.window.close();
});

function savingPage({ pocketOptions, createBody = { success: true, id: 'new-id' }, deleteStatus = 200, calls = [], toasts = [], storage = {} } = {}) {
    return setupPage(async (url, options) => {
        calls.push({ url, options });
        if (url.startsWith('/api/salary-cycle/assignment')) return assignmentResponse();
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse(pocketOptions);
        if (options?.method === 'POST') return response(createBody);
        if (options?.method === 'DELETE') return response({ success: deleteStatus === 200 }, deleteStatus);
        return response({ success: true });
    }, { showToast: (message, type, extra) => toasts.push({ message, type, extra }), storage });
}

function submitForm(dom) {
    dom.window.document.getElementById('transactionForm')
        .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}

function typeAmount(dom, value) {
    const input = dom.window.document.getElementById('amount');
    input.value = value;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

const twoPockets = [
    { pocketId: 'pocket-1', name: 'Kwintals', emoji: '💰', cadence: 'Monthly' },
    { pocketId: 'pocket-2', name: 'Transport', emoji: '🚌', cadence: 'Monthly' }
];

test('creating a transaction bumps the streak, resets the form in place, and offers Undo', async () => {
    const calls = [];
    const toasts = [];
    const dom = await savingPage({ calls, toasts });
    await settle();

    const { document, localStorage } = dom.window;
    localStorage.removeItem('moneyJournalStreak');
    dom.window.selectManagedPocket('pocket-1');
    typeAmount(dom, '35000');
    document.getElementById('ngapain').value = 'Lunch';
    submitForm(dom);
    await settle();

    assert.equal(JSON.parse(localStorage.getItem('moneyJournalStreak')).count, 1);
    assert.equal(document.getElementById('amount').value, '');
    assert.equal(document.getElementById('ngapain').value, '');
    assert.equal(document.getElementById('selectedPocketDisplay').textContent, '💰 Kwintals');
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].message, 'Saved · Rp 35000');
    assert.equal(toasts[0].extra.actionLabel, 'Undo');
    dom.window.close();
});

test('Undo deletes the new entry, rolls back the streak, and puts the values back', async () => {
    const calls = [];
    const toasts = [];
    const dom = await savingPage({ calls, toasts });
    await settle();

    const { document, localStorage } = dom.window;
    const previous = JSON.stringify({ count: 3, lastDate: '2000-01-01' });
    localStorage.setItem('moneyJournalStreak', previous);
    dom.window.selectManagedPocket('pocket-1');
    typeAmount(dom, '12500');
    document.getElementById('ngapain').value = 'Parkir';
    submitForm(dom);
    await settle();
    assert.notEqual(localStorage.getItem('moneyJournalStreak'), previous);

    toasts[0].extra.onAction();
    await settle();

    const removal = calls.find(call => call.options?.method === 'DELETE');
    assert.equal(removal.url, '/api/transaction/new-id');
    assert.equal(localStorage.getItem('moneyJournalStreak'), previous);
    assert.equal(document.getElementById('amount').value, '12.500');
    assert.equal(document.getElementById('ngapain').value, 'Parkir');
    assert.equal(dom.window.getSelectedType(), 'Eat');
    assert.equal(toasts.at(-1).message, 'Entry removed');
    dom.window.close();
});

test('a failed Undo says the entry is still saved and keeps the streak', async () => {
    const toasts = [];
    const dom = await savingPage({ toasts, deleteStatus: 500 });
    await settle();

    const { document, localStorage } = dom.window;
    localStorage.removeItem('moneyJournalStreak');
    dom.window.selectManagedPocket('pocket-1');
    typeAmount(dom, '1000');
    submitForm(dom);
    await settle();
    const streak = localStorage.getItem('moneyJournalStreak');

    toasts[0].extra.onAction();
    await settle();

    assert.deepEqual(toasts.at(-1), { message: 'Could not undo, the entry is still saved', type: 'error', extra: undefined });
    assert.equal(localStorage.getItem('moneyJournalStreak'), streak);
    assert.equal(document.getElementById('amount').value, '');
    dom.window.close();
});

test('a create response without an id saves without offering Undo', async () => {
    const toasts = [];
    const dom = await savingPage({ toasts, createBody: { success: true } });
    await settle();

    dom.window.selectManagedPocket('pocket-1');
    typeAmount(dom, '1000');
    submitForm(dom);
    await settle();

    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].extra, undefined);
    dom.window.close();
});

test('a double tap on Save only creates one entry', async () => {
    const calls = [];
    const dom = await savingPage({ calls });
    await settle();

    dom.window.selectManagedPocket('pocket-1');
    typeAmount(dom, '1000');
    submitForm(dom);
    submitForm(dom);
    await settle();

    assert.equal(calls.filter(call => call.options?.method === 'POST').length, 1);
    dom.window.close();
});

test('the amount shows thousands separators, the 000 button appends zeros, and the payload is plain digits', async () => {
    const calls = [];
    const dom = await savingPage({ calls });
    await settle();

    const { document } = dom.window;
    const amount = document.getElementById('amount');
    assert.equal(amount.getAttribute('inputmode'), 'numeric');

    typeAmount(dom, '35000');
    assert.equal(amount.value, '35.000');
    typeAmount(dom, 'Rp 1.2a50');
    assert.equal(amount.value, '1.250');
    typeAmount(dom, '007');
    assert.equal(amount.value, '7');

    typeAmount(dom, '35');
    document.getElementById('amountThousandsBtn').click();
    assert.equal(amount.value, '35.000');
    typeAmount(dom, '');
    document.getElementById('amountThousandsBtn').click();
    assert.equal(amount.value, '');

    typeAmount(dom, '1500000');
    dom.window.selectManagedPocket('pocket-1');
    document.getElementById('ngapain').value = 'Rent';
    submitForm(dom);
    await settle();

    const payload = JSON.parse(calls.find(call => call.options?.method === 'POST').options.body);
    assert.equal(payload.amount, '1500000');
    dom.window.close();
});

test('an empty note is sent as the type name, like the Telegram Skip', async () => {
    const calls = [];
    const dom = await savingPage({ calls });
    await settle();

    const { document } = dom.window;
    assert.equal(document.getElementById('ngapain').required, false);
    document.querySelector('#typeSheet [data-type-option="Bensin"]').click();
    dom.window.selectManagedPocket('pocket-1');
    typeAmount(dom, '50000');
    document.getElementById('ngapain').value = '   ';
    submitForm(dom);
    await settle();

    const payload = JSON.parse(calls.find(call => call.options?.method === 'POST').options.body);
    assert.equal(payload.ngapain, 'Bensin');
    dom.window.close();
});

test('the last type and the pocket used for it are preselected on the next visit', async () => {
    const first = await savingPage({ pocketOptions: twoPockets });
    await settle();
    first.window.document.querySelector('#typeSheet [data-type-option="Bensin"]').click();
    first.window.selectManagedPocket('pocket-2');
    typeAmount(first, '50000');
    submitForm(first);
    await settle();
    const stored = {
        moneyJournalLastPick: first.window.localStorage.getItem('moneyJournalLastPick'),
        moneyJournalPocketByType: first.window.localStorage.getItem('moneyJournalPocketByType')
    };
    first.window.close();

    assert.deepEqual(JSON.parse(stored.moneyJournalLastPick), { type: 'Bensin', pocketId: 'pocket-2' });
    assert.deepEqual(JSON.parse(stored.moneyJournalPocketByType), { Bensin: 'pocket-2' });

    const second = await savingPage({ pocketOptions: twoPockets, storage: stored });
    await settle();
    assert.equal(second.window.getSelectedType(), 'Bensin');
    assert.equal(second.window.document.getElementById('selectedPocketDisplay').textContent, '🚌 Transport');
    second.window.close();
});

test('picking a type switches to the pocket last used for it, unless a pocket was picked by hand', async () => {
    const storage = {
        moneyJournalLastPick: JSON.stringify({ type: 'Eat', pocketId: 'pocket-1' }),
        moneyJournalPocketByType: JSON.stringify({ Eat: 'pocket-1', Bensin: 'pocket-2' })
    };
    const dom = await savingPage({ pocketOptions: twoPockets, storage });
    await settle();

    const { document } = dom.window;
    assert.equal(document.getElementById('selectedPocketDisplay').textContent, '💰 Kwintals');
    document.querySelector('#typeSheet [data-type-option="Bensin"]').click();
    assert.equal(document.getElementById('selectedPocketDisplay').textContent, '🚌 Transport');

    document.querySelector('#pocketSheet [data-managed-pocket-option="pocket-1"]').click();
    document.querySelector('#typeSheet [data-type-option="Bensin"]').click();
    assert.equal(document.getElementById('selectedPocketDisplay').textContent, '💰 Kwintals');
    dom.window.close();
});

test('a remembered pocket that is not assigned this Budget Month is ignored', async () => {
    const storage = { moneyJournalLastPick: JSON.stringify({ type: 'Eat', pocketId: 'archived-pocket' }) };
    const dom = await savingPage({ storage });
    await settle();

    assert.equal(dom.window.document.getElementById('selectedPocketDisplay').textContent, 'Select pocket…');
    dom.window.close();
});

test('broken remembered data falls back to the plain defaults', async () => {
    const storage = { moneyJournalLastPick: '{not json', moneyJournalPocketByType: '[]' };
    const dom = await savingPage({ storage });
    await settle();

    assert.equal(dom.window.getSelectedType(), 'Eat');
    assert.equal(dom.window.document.getElementById('selectedPocketDisplay').textContent, 'Select pocket…');
    dom.window.close();
});

test('editing does not apply remembered defaults over the saved values', async () => {
    const storage = {
        moneyJournalLastPick: JSON.stringify({ type: 'Bensin', pocketId: 'pocket-2' }),
        moneyJournalPocketByType: JSON.stringify({ Bensin: 'pocket-2', Eat: 'pocket-2' })
    };
    const dom = await setupPage(async (url, options) => {
        if (url === '/api/transaction/transaction-id') {
            return response({
                _id: 'transaction-id', expenseDate: '2027-02-24', type: 'Eat', amount: 1250000,
                ngapain: 'Groceries run', sourceType: 'single', pocket: 'Kwintals', pocketId: 'pocket-1'
            });
        }
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse(twoPockets);
        return assignmentResponse();
    }, { edit: 'transaction-id', storage });
    await settle();

    const { document } = dom.window;
    assert.equal(dom.window.getSelectedType(), 'Eat');
    assert.equal(document.getElementById('selectedPocketDisplay').textContent, '💰 Kwintals');
    assert.equal(document.getElementById('amount').value, '1.250.000');
    dom.window.close();
});

test('confetti and the streak note only appear when a save reaches a streak milestone', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    async function saveWithStreak(count) {
        const toasts = [];
        const dom = await savingPage({ toasts, storage: { moneyJournalStreak: JSON.stringify({ count, lastDate: yesterdayKey }) } });
        let confetti = 0;
        dom.window.launchConfetti = () => { confetti += 1; };
        await settle();
        dom.window.selectManagedPocket('pocket-1');
        typeAmount(dom, '1000');
        submitForm(dom);
        await settle();
        dom.window.close();
        return { confetti, message: toasts[0].message };
    }

    assert.deepEqual(await saveWithStreak(6), { confetti: 1, message: 'Saved · Rp 1000 · 🔥 7-day streak' });
    assert.deepEqual(await saveWithStreak(2), { confetti: 0, message: 'Saved · Rp 1000' });
});

test('Back returns to the previous page when Log Spending was opened from inside the app', async () => {
    async function clickBack(referrer) {
        const dom = new JSDOM(renderView({ username: 'tester', avatar: '👤', salaryCycleBudgetingEnabled: true }), {
            url: 'https://money-journal.test/log-spending',
            referrer,
            runScripts: 'outside-only'
        });
        dom.window.fetch = async (url) => (url.startsWith('/api/expense-pocket-options')
            ? pocketOptionsResponse()
            : assignmentResponse());
        dom.window.showToast = () => {};
        dom.window.formatRupiah = value => `Rp ${value}`;
        dom.window.eval(browserSource);
        await settle();
        let wentBack = false;
        dom.window.history.back = () => { wentBack = true; };
        Object.defineProperty(dom.window.history, 'length', { value: 2 });
        const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
        dom.window.document.getElementById('backLink').dispatchEvent(event);
        dom.window.close();
        return { wentBack, prevented: event.defaultPrevented };
    }

    assert.deepEqual(await clickBack('https://money-journal.test/review-history?month=2027-02'), { wentBack: true, prevented: true });
    assert.deepEqual(await clickBack('https://elsewhere.test/'), { wentBack: false, prevented: false });
    assert.deepEqual(await clickBack(undefined), { wentBack: false, prevented: false });
});

test('the Log Spending title no longer navigates away mid-entry', () => {
    const html = renderView({ username: 'tester', avatar: '👤', salaryCycleBudgetingEnabled: true });
    const { document } = new JSDOM(html).window;
    assert.equal(document.querySelector('.app-header [onclick*="monthly-story"]'), null);
    assert.equal(document.getElementById('backLink').getAttribute('href'), '/monthly-story');
});

test('split is behind a link that switches between one pocket and a split', async () => {
    const dom = await savingPage({ pocketOptions: twoPockets });
    await settle();
    const { document } = dom.window;
    const toggle = document.getElementById('splitToggle');

    assert.equal(document.querySelector('.transaction-mode-toggle').hidden, true);
    assert.equal(toggle.textContent, 'Split across pockets');
    assert.equal(document.getElementById('multiPocketSection').style.display, 'none');

    toggle.click();
    assert.equal(dom.window.getSourceType(), 'multi');
    assert.equal(toggle.textContent, 'Use one pocket');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(document.getElementById('multiPocketSection').style.display, 'block');
    assert.equal(document.getElementById('pocketTrigger').style.display, 'none');

    toggle.click();
    assert.equal(dom.window.getSourceType(), 'single');
    assert.equal(toggle.textContent, 'Split across pockets');
    dom.window.close();
});

test('Rest fills a split row with what is still unallocated, never below zero', async () => {
    const dom = await savingPage({ pocketOptions: twoPockets });
    await settle();
    const { document } = dom.window;

    typeAmount(dom, '100000');
    document.getElementById('splitToggle').click();
    dom.window.addBreakdownRow();
    const rows = [...document.querySelectorAll('#breakdownRows .breakdown-row')];
    rows[0].querySelector('.breakdown-amount').value = '30000';
    rows[1].querySelector('.breakdown-rest-btn').click();
    assert.equal(rows[1].querySelector('.breakdown-amount').value, '70000');
    assert.equal(document.getElementById('differenceDisplay').textContent, 'Matched');

    rows[0].querySelector('.breakdown-amount').value = '150000';
    rows[1].querySelector('.breakdown-rest-btn').click();
    assert.equal(rows[1].querySelector('.breakdown-amount').value, '0');
    dom.window.close();
});

function editPage({ transaction, deleteStatus = 200, calls = [], toasts = [] }) {
    return setupPage(async (url, options) => {
        calls.push({ url, options });
        if (options?.method === 'DELETE') return response({ success: deleteStatus === 200 }, deleteStatus);
        if (url === '/api/transaction/transaction-id') return response(transaction);
        if (url.startsWith('/api/expense-pocket-options')) return pocketOptionsResponse(twoPockets);
        return assignmentResponse();
    }, { edit: 'transaction-id', showToast: (message, type) => toasts.push({ message, type }) });
}

const singleTransaction = {
    _id: 'transaction-id', expenseDate: '2027-02-24', type: 'Eat', amount: 45000,
    ngapain: 'Nasi padang', sourceType: 'single', pocket: 'Kwintals', pocketId: 'pocket-1'
};

test('editing a split opens in split mode', async () => {
    const dom = await editPage({
        transaction: {
            ...singleTransaction,
            sourceType: 'multi',
            sourceBreakdowns: [
                { pocketId: 'pocket-1', pocket: 'Kwintals', amount: 30000 },
                { pocketId: 'pocket-2', pocket: 'Transport', amount: 15000 }
            ]
        }
    });
    await settle();
    const { document } = dom.window;

    assert.equal(dom.window.getSourceType(), 'multi');
    assert.equal(document.getElementById('splitToggle').textContent, 'Use one pocket');
    assert.equal(document.querySelectorAll('#breakdownRows .breakdown-row').length, 2);
    dom.window.close();
});

test('Delete only appears when editing, and asks before deleting', async () => {
    const createDom = await savingPage();
    await settle();
    assert.equal(createDom.window.document.getElementById('deleteBtn').hidden, true);
    createDom.window.close();

    const calls = [];
    const toasts = [];
    const dom = await editPage({ transaction: singleTransaction, calls, toasts });
    await settle();
    const { document } = dom.window;

    const deleteBtn = document.getElementById('deleteBtn');
    assert.equal(deleteBtn.hidden, false);
    deleteBtn.click();
    assert.ok(document.getElementById('deleteModal').classList.contains('show'));
    assert.equal(document.getElementById('deleteDetails').textContent, 'Nasi padang · Rp 45000');

    document.getElementById('deleteCancelBtn').click();
    assert.equal(document.getElementById('deleteModal').classList.contains('show'), false);
    assert.equal(calls.some(call => call.options?.method === 'DELETE'), false);

    deleteBtn.click();
    document.getElementById('deleteConfirmBtn').click();
    await settle();

    const removal = calls.find(call => call.options?.method === 'DELETE');
    assert.equal(removal.url, '/api/transaction/transaction-id');
    assert.deepEqual(toasts.at(-1), { message: 'Transaction deleted', type: 'success' });
    assert.equal(document.getElementById('deleteModal').classList.contains('show'), false);
    dom.window.close();
});

test('a failed delete keeps the dialog open and says so', async () => {
    const toasts = [];
    const dom = await editPage({ transaction: singleTransaction, deleteStatus: 500, toasts });
    await settle();
    const { document } = dom.window;

    document.getElementById('deleteBtn').click();
    document.getElementById('deleteConfirmBtn').click();
    await settle();

    assert.deepEqual(toasts.at(-1), { message: 'Could not delete transaction', type: 'error' });
    assert.ok(document.getElementById('deleteModal').classList.contains('show'));
    dom.window.close();
});
