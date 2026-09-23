'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const hbs = require('hbs');

const viewSource = fs.readFileSync(require.resolve('../../views/monthly-story.hbs'), 'utf8');
const browserSource = fs.readFileSync(require.resolve('../../public/js/monthly-story.js'), 'utf8');

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

async function setupPage({ summary, transactions, expenseTypes } = {}) {
    const calls = [];
    const charts = [];
    const summaryData = summary || {
        budgetMonth: '2027-03',
        timeZone: 'Asia/Jakarta',
        period: { startDate: '2027-02-25', endDate: '2027-03-24' },
        total: { formatted: 'Rp 3.000', raw: 3000 },
        categories: [],
        comparison: { hasLastMonth: false },
        budgetAlerts: [
            {
                pocket: 'Groceries',
                cadence: 'Weekly',
                selectedWeek: '2027-W09',
                status: 'warning',
                percentage: 85,
                message: 'Groceries: 85% used (Weekly · 2027-W09)'
            },
            {
                pocket: 'Kwintals',
                cadence: 'Monthly',
                selectedWeek: null,
                status: 'danger',
                percentage: 100,
                message: 'Kwintals: 100% over budget (Monthly · salary cycle)'
            }
        ]
    };
    const transactionData = transactions || [
        { _id: 'older', expenseDate: '2027-02-28', type: 'Eat', pocket: 'Kwintals', amount: 1000, ngapain: 'Older' },
        { _id: 'newer', expenseDate: '2027-03-01', type: 'Eat', pocket: 'Groceries', amount: 2000, ngapain: 'Newer' }
    ];
    const dom = new JSDOM(renderView({ username: 'tester', avatar: '👤', expenseTypeManagementEnabled: Boolean(expenseTypes) }), {
        url: 'https://money-journal.test/monthly-story',
        runScripts: 'outside-only'
    });
    dom.window.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url === '/api/budget') {
            return response({
                success: true,
                data: {
                    budgetMonth: summaryData.budgetMonth,
                    period: summaryData.period
                }
            });
        }
        if (url.startsWith('/api/dashboard/summary')) {
            return response({ success: true, data: summaryData });
        }
        if (url === '/api/expense-types') {
            return response({ success: true, data: { active: expenseTypes || [] } });
        }
        return response(transactionData);
    };
    dom.window.Chart = function Chart(canvas, config) {
        charts.push({ canvas, config });
        this.destroy = () => {};
    };
    dom.window.chartColors = ['#000', '#111'];
    dom.window.formatRupiah = value => `Rp ${value}`;
    dom.window.showToast = () => {};
    dom.window.openOptions = () => {};
    dom.window.eval(browserSource);
    await new Promise(resolve => setImmediate(resolve));
    return { dom, calls, charts };
}

test('Monthly Story uses server active month, renders cycle metadata, cadence alerts, and canonical date order', async () => {
    const { dom, calls } = await setupPage();
    const { document } = dom.window;

    assert.equal(document.getElementById('monthFilter').value, '2027-03');
    assert.match(document.getElementById('salaryCyclePeriod').textContent, /Budget Month 2027-03/);
    assert.match(document.getElementById('salaryCyclePeriod').textContent, /2027-02-25 – 2027-03-24/);
    assert.match(document.getElementById('pocketPulseList').textContent, /Weekly · 2027-W09/);
    assert.match(document.getElementById('pocketPulseList').textContent, /Monthly · salary cycle/);
    const feed = document.getElementById('historyList').textContent;
    assert.ok(feed.indexOf('Newer') < feed.indexOf('Older'));
    assert.ok(calls.some(call => call.url === '/api/budget'));
    assert.ok(calls.some(call => call.url === '/api/dashboard/summary?month=2027-03'));
    dom.window.close();
});

test('Monthly Story does not convert canonical date-only values through UTC serialization', () => {
    assert.doesNotMatch(browserSource, /toISOString\(\)/);
    assert.doesNotMatch(browserSource, /new Date\(\s*(?:item\.)?date/);
    assert.doesNotMatch(browserSource, /new Date\(\s*dateKey/);
    assert.match(browserSource, /transactionDateKey\(b\)\.localeCompare\(transactionDateKey\(a\)\)/);
});


test('Monthly Story renders stored-month totals, chart data, and recent feed items without recalculating assignment', async () => {
    const { dom, calls, charts } = await setupPage({
        summary: {
            budgetMonth: '2027-03',
            timeZone: 'Asia/Jakarta',
            period: { startDate: '2027-02-25', endDate: '2027-03-24' },
            total: { formatted: 'Rp 3.000', raw: 3000 },
            categories: [
                { category: 'Groceries', total: 2000, percentage: 67, formattedTotal: 'Rp 2.000' },
                { category: 'Eat', total: 1000, percentage: 33, formattedTotal: 'Rp 1.000' }
            ],
            comparison: { hasLastMonth: false },
            budgetAlerts: []
        },
        transactions: [
            { _id: 'same-day-a', expenseDate: '2027-03-01', type: 'Eat', pocket: 'Groceries', amount: 1000, ngapain: 'Stored recent A' },
            { _id: 'same-day-b', expenseDate: '2027-03-01', type: 'Eat', pocket: 'Groceries', amount: 1000, ngapain: 'Stored recent B' },
            { _id: 'cycle-start', expenseDate: '2027-02-25', type: 'Groceries', pocket: 'Groceries', amount: 1000, ngapain: 'Stored cycle start' }
        ]
    });
    const { document } = dom.window;

    assert.equal(document.getElementById('totalAmount').textContent, 'Rp 3.000');
    assert.equal(document.getElementById('entryCount').textContent, '3');
    assert.equal(charts.length, 1);
    assert.equal(charts[0].canvas.id, 'spendingChart');
    assert.deepEqual(charts[0].config.data.labels, ['Groceries', 'Eat']);
    assert.deepEqual(charts[0].config.data.datasets[0].data, [2000, 1000]);

    const groups = [...document.querySelectorAll('#historyList .journal-date-group')];
    assert.equal(groups.length, 2);
    assert.match(groups[0].textContent, /Stored recent A/);
    assert.match(groups[0].textContent, /Stored recent B/);
    assert.match(groups[1].textContent, /Stored cycle start/);
    assert.ok(calls.some(call => call.url === '/api/transactions?month=2027-03'));
    dom.window.close();
});

test('Monthly Story keeps canonical date grouping and sorting independent of compatibility dates', async () => {
    const { dom } = await setupPage({
        transactions: [
            { _id: 'canonical-new', expenseDate: '2027-03-02', date: '1999-01-01', type: 'Eat', pocket: 'Groceries', amount: 1000, ngapain: 'Canonical newer' },
            { _id: 'canonical-old', expenseDate: '2027-02-28', date: '2099-12-31', type: 'Eat', pocket: 'Groceries', amount: 1000, ngapain: 'Canonical older' }
        ]
    });
    const text = dom.window.document.getElementById('historyList').textContent;
    assert.ok(text.indexOf('Canonical newer') < text.indexOf('Canonical older'));
    assert.equal(dom.window.document.querySelectorAll('#historyList .journal-date-group').length, 2);
    dom.window.close();
});

test('Monthly Story shows managed expense type emoji for custom types', async () => {
    const { dom, calls } = await setupPage({
        expenseTypes: [{ id: 't2', name: 'Parkir', emoji: '🅿️', status: 'Active' }],
        transactions: [
            { _id: 'parkir', expenseDate: '2027-03-01', type: 'Parkir', pocket: 'Kwintals', amount: 5000, ngapain: 'Mall parking' }
        ]
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(calls.some(call => call.url === '/api/expense-types'));
    const row = [...dom.window.document.querySelectorAll('#historyList .journal-row')]
        .find(item => item.textContent.includes('Mall parking'));
    assert.equal(row.querySelector('.journal-row-icon').textContent, '🅿️');
    dom.window.close();
});

test('Monthly Story does not fetch expense types when the feature is off', async () => {
    const { dom, calls } = await setupPage();
    assert.equal(calls.some(call => call.url === '/api/expense-types'), false);
    dom.window.close();
});

test('Monthly Story uses the bottom navbar with Story active and a + that goes straight to Log Spending', () => {
    const html = renderView({ username: 'tester', avatar: '👤', isDashboard: true });
    const { document } = new JSDOM(html).window;

    const active = document.querySelector('.bottom-navbar .nav-item.active');
    assert.equal(active.getAttribute('href'), '/monthly-story');
    assert.equal(active.getAttribute('aria-current'), 'page');
    assert.deepEqual(
        [...document.querySelectorAll('.bottom-navbar .nav-item')].map(item => item.getAttribute('href')),
        ['/monthly-story', '/review-history', '/check-pockets']
    );
    assert.equal(document.getElementById('actionHubTrigger').getAttribute('href'), '/log-spending');
    assert.equal(document.getElementById('actionHubSheet'), null);
    assert.equal(document.querySelector('.journal-strip'), null);
});
