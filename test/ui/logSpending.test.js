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

async function setupPage(fetchImpl, { edit = '', showToast = () => {} } = {}) {
    const dom = new JSDOM(renderView({
        username: 'tester',
        avatar: '👤',
        salaryCycleBudgetingEnabled: true
    }), {
        url: `https://money-journal.test/log-spending${edit ? `?edit=${edit}` : ''}`,
        runScripts: 'outside-only'
    });
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
        return response({ success: true });
    });

    const { document } = dom.window;
    assert.equal(document.getElementById('budgetMonth'), null);
    assert.equal(document.getElementById('derivedBudgetMonth').textContent, '2027-02');
    assert.equal(document.getElementById('derivedBudgetPeriod').textContent, '2027-01-25 – 2027-02-24');

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
        saveAttempts += 1;
        return response({ error: { message: 'Assignment changed; refresh required.' } }, 409);
    });

    const { document } = dom.window;
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
        return response({ error: { message: 'Transaction service unavailable.' } }, 503);
    }, { showToast: (message, type) => toastCalls.push({ message, type }) });

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
                pocket: 'Kwintals'
            });
        }
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
    assert.equal(payload.pocket, 'Kwintals');
    assert.equal(Object.hasOwn(payload, 'budgetMonth'), false);
    assert.equal(Object.hasOwn(payload, 'budgetYear'), false);
    dom.window.close();
});
