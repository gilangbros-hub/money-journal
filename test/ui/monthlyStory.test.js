'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const hbs = require('hbs');

const viewSource = fs.readFileSync(require.resolve('../../views/monthly-story.hbs'), 'utf8');
const browserSource = fs.readFileSync(require.resolve('../../public/js/monthly-story.js'), 'utf8');
const banksSource = fs.readFileSync(require.resolve('../../public/js/banks.js'), 'utf8');

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
    const summaryData = (typeof summary === 'function' ? summary('') : summary) || {
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
            return response({ success: true, data: typeof summary === 'function' ? summary(url) : summaryData });
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
    dom.window.eval(banksSource);
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

// Date keys relative to the real clock in UTC; the page computes "today" the
// same way from the summary's timeZone.
function utcDateKey(offsetDays = 0) {
    const date = new Date(Date.now() + offsetDays * 86400000);
    return date.toISOString().slice(0, 10);
}

function budgetSummary({ pockets, totalBudget, totalRemaining, period, availableWeeks = [], selectedWeek = null, budgetAlerts = [] }) {
    return {
        budgetMonth: '2027-03',
        timeZone: 'UTC',
        period,
        total: { formatted: 'Rp 900.000', raw: 900000 },
        categories: [],
        comparison: { hasLastMonth: false },
        budgetAlerts,
        budget: { totalBudget, totalRemaining, pockets, availableWeeks, selectedWeek }
    };
}

const monthlyPockets = [
    { pocket: 'Kwintals', icon: '💰', cadence: 'Monthly', budget: 1000000, spent: 400000, alertStatus: 'normal' },
    { pocket: 'Groceries', icon: '🥦', cadence: 'Monthly', budget: 500000, spent: 500000, alertStatus: 'danger' }
];

test('with a budget the hero leads with what is left and a daily allowance until payday', async () => {
    const { dom } = await setupPage({
        summary: budgetSummary({
            pockets: monthlyPockets,
            totalBudget: 1500000,
            totalRemaining: 600000,
            period: { startDate: utcDateKey(-5), endDate: utcDateKey(9) }
        }),
        transactions: []
    });
    const { document } = dom.window;

    assert.equal(document.getElementById('heroLabel').textContent, 'Left this cycle');
    assert.equal(document.getElementById('totalAmount').textContent, 'Rp 600000');
    const allowance = document.getElementById('heroAllowance');
    assert.equal(allowance.hidden, false);
    assert.equal(allowance.textContent, 'Rp 60000/day · 10 days to payday');
    assert.equal(document.getElementById('heroSpent').textContent, 'Rp 900.000');
    assert.equal(document.getElementById('heroDaysLeft').textContent, '10');
    assert.equal(document.getElementById('entryCount'), null);
    dom.window.close();
});

test('on the last day of the cycle the allowance is the whole remainder', async () => {
    const { dom } = await setupPage({
        summary: budgetSummary({
            pockets: monthlyPockets,
            totalBudget: 1500000,
            totalRemaining: 75000,
            period: { startDate: utcDateKey(-30), endDate: utcDateKey(0) }
        }),
        transactions: []
    });
    assert.equal(dom.window.document.getElementById('heroAllowance').textContent, 'Rp 75000/day · 1 day to payday');
    dom.window.close();
});

test('an overspent cycle says so instead of showing an allowance', async () => {
    const { dom } = await setupPage({
        summary: budgetSummary({
            pockets: monthlyPockets,
            totalBudget: 1500000,
            totalRemaining: -50000,
            period: { startDate: utcDateKey(-5), endDate: utcDateKey(9) }
        }),
        transactions: []
    });
    const { document } = dom.window;

    assert.equal(document.getElementById('heroLabel').textContent, 'Over budget this cycle');
    assert.equal(document.getElementById('totalAmount').textContent, 'Rp 50000');
    assert.ok(document.getElementById('totalAmount').classList.contains('is-over'));
    assert.equal(document.getElementById('heroAllowance').hidden, true);
    dom.window.close();
});

test('a past cycle shows what was left without a daily allowance', async () => {
    const { dom } = await setupPage({
        summary: budgetSummary({
            pockets: monthlyPockets,
            totalBudget: 1500000,
            totalRemaining: 120000,
            period: { startDate: utcDateKey(-60), endDate: utcDateKey(-31) }
        }),
        transactions: []
    });
    const { document } = dom.window;

    assert.equal(document.getElementById('totalAmount').textContent, 'Rp 120000');
    assert.equal(document.getElementById('heroAllowance').hidden, true);
    assert.equal(document.getElementById('heroDaysLeft').textContent, '–');
    dom.window.close();
});

test('Pocket Pulse lists every pocket with a progress bar, over-budget pockets first', async () => {
    const { dom } = await setupPage({
        summary: budgetSummary({
            pockets: [
                ...monthlyPockets,
                { pocket: 'Investasi', icon: '📈', cadence: 'Monthly', budget: 0, spent: 20000, alertStatus: 'normal' },
                { pocket: 'Bandung', icon: '⛰️', cadence: 'Monthly', budget: 0, spent: 0, alertStatus: 'normal' }
            ],
            totalBudget: 1500000,
            totalRemaining: 600000,
            period: { startDate: utcDateKey(-5), endDate: utcDateKey(9) },
            budgetAlerts: [{ pocket: 'Groceries', status: 'danger', message: 'Groceries: 100% over budget (Monthly · salary cycle)' }]
        }),
        transactions: []
    });
    const items = [...dom.window.document.querySelectorAll('#pocketPulseList .journal-pulse-item')];

    assert.deepEqual(items.map(item => item.querySelector('.journal-pulse-title').textContent), ['🥦 Groceries', '💰 Kwintals', '📈 Investasi']);
    assert.ok(items[0].classList.contains('danger'));
    assert.match(items[0].textContent, /100% over budget/);
    assert.equal(items[0].querySelector('.journal-pulse-fill').style.width, '100%');
    assert.equal(items[1].querySelector('.journal-pulse-fill').style.width, '40%');
    assert.equal(items[1].querySelector('.journal-pulse-amounts').textContent, 'Rp 400000 / Rp 1000000');
    assert.equal(items[1].querySelector('.journal-pulse-scope').textContent, 'This cycle');
    assert.equal(items[2].querySelector('.journal-pulse-amounts').textContent, 'Rp 20000 · no budget set');
    assert.equal(items[0].querySelector('.journal-pulse-left').textContent, 'Rp 0 left');
    assert.equal(items[1].querySelector('.journal-pulse-left').textContent, 'Rp 600000 left');
    assert.equal(items[2].querySelector('.journal-pulse-left'), null, 'no budget, nothing to be left of');
    dom.window.close();
});

test('Pocket Pulse shows what is left, or how far over, using the server remaining when given', async () => {
    const { dom } = await setupPage({
        summary: budgetSummary({
            pockets: [
                { pocket: 'Bensin', icon: '⛽', cadence: 'Monthly', budget: 500000, spent: 620000, alertStatus: 'danger' },
                { pocket: 'Weekly Eat', icon: '🍽️', cadence: 'Weekly', budget: 400000, spent: 100000, remaining: 250000, alertStatus: 'normal' }
            ],
            totalBudget: 900000,
            totalRemaining: 180000,
            period: { startDate: utcDateKey(-5), endDate: utcDateKey(9) }
        }),
        transactions: []
    });
    const left = [...dom.window.document.querySelectorAll('#pocketPulseList .journal-pulse-left')];

    assert.deepEqual(left.map(el => el.textContent), ['Rp 120000 over', 'Rp 250000 left']);
    assert.ok(left[0].classList.contains('over'));
    assert.equal(left[1].classList.contains('over'), false);
    dom.window.close();
});

test('weekly pockets are re-requested for the week containing today', async () => {
    const weeks = [
        { key: '2027-W01', intersectionStartDate: utcDateKey(-10), intersectionEndDate: utcDateKey(-4) },
        { key: '2027-W02', intersectionStartDate: utcDateKey(-3), intersectionEndDate: utcDateKey(3) }
    ];
    const summaryFor = (url) => {
        const week = new URL(`https://money-journal.test${url || '/'}`).searchParams.get('selectedWeek');
        return budgetSummary({
            pockets: [{
                pocket: 'Groceries', icon: '🥦', cadence: 'Weekly',
                budget: 300000, spent: week ? 120000 : 290000, alertStatus: week ? 'normal' : 'warning',
                selectedWeek: { key: week || '2027-W01' }
            }],
            totalBudget: 1200000,
            totalRemaining: 500000,
            period: { startDate: utcDateKey(-10), endDate: utcDateKey(20) },
            availableWeeks: weeks,
            selectedWeek: week
        });
    };
    const { dom, calls } = await setupPage({ summary: summaryFor, transactions: [] });
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(calls.some(call => call.url === '/api/dashboard/summary?month=2027-03&selectedWeek=2027-W02'));
    const item = dom.window.document.querySelector('#pocketPulseList .journal-pulse-item');
    assert.equal(item.querySelector('.journal-pulse-scope').textContent, 'This week');
    assert.equal(item.querySelector('.journal-pulse-amounts').textContent, 'Rp 120000 / Rp 300000');
    dom.window.close();
});

test('no second summary request when there is no weekly pocket', async () => {
    const { dom, calls } = await setupPage({
        summary: budgetSummary({
            pockets: monthlyPockets,
            totalBudget: 1500000,
            totalRemaining: 600000,
            period: { startDate: utcDateKey(-5), endDate: utcDateKey(9) },
            availableWeeks: [{ key: '2027-W02', intersectionStartDate: utcDateKey(-3), intersectionEndDate: utcDateKey(3) }]
        }),
        transactions: []
    });
    assert.equal(calls.filter(call => call.url.startsWith('/api/dashboard/summary')).length, 1);
    dom.window.close();
});

test('Monthly Story loads Chart.js once and no longer has a Today Feed', () => {
    const html = renderView({ username: 'tester', avatar: '👤' });
    assert.equal((html.match(/chart\.js/g) || []).length, 1);
    assert.doesNotMatch(html, /datalabels/);
    assert.doesNotMatch(html, /id="todayTimeline"/);
});

test('Month Feed rows open the entry for editing and have no inline Delete', async () => {
    const { dom } = await setupPage({
        transactions: [{ _id: 'tx 1', expenseDate: '2027-03-01', type: 'Eat', pocket: 'Kwintals', amount: 1000, ngapain: 'Lunch' }]
    });
    const row = dom.window.document.querySelector('#historyList .journal-row');

    assert.equal(row.tagName, 'A');
    assert.equal(row.getAttribute('href'), '/log-spending?edit=tx%201');
    assert.doesNotMatch(row.textContent, /Delete|Edit/);
    assert.equal(dom.window.document.getElementById('deleteModal'), null);
    dom.window.close();
});

async function setupWithBanks(banks) {
    const summary = {
        budgetMonth: '2027-03',
        timeZone: 'Asia/Jakarta',
        period: { startDate: '2027-02-25', endDate: '2027-03-24' },
        total: { formatted: 'Rp 3.000', raw: 3000 },
        categories: [],
        comparison: { hasLastMonth: false },
        budgetAlerts: [],
        budget: { totalBudget: 1000, totalRemaining: 500, pockets: [], ...(banks ? { banks } : {}) }
    };
    return setupPage({ summary, transactions: [] });
}

test('Money by bank shows one card per bank with what is left', async () => {
    const { dom } = await setupWithBanks([
        { key: 'jago', name: 'Jago', color: '#FDAF27', logo: '/images/banks/jago.svg', pocketCount: 2, allocation: 4000, spending: 1000, remaining: 3000 },
        { key: 'blu', name: 'blu', color: '#33CDCF', logo: '/images/banks/blu.svg', pocketCount: 1, allocation: 500, spending: 700, remaining: -200 },
        { key: 'unassigned', name: 'No bank', color: null, logo: null, pocketCount: 1, allocation: 100, spending: 0, remaining: 100 }
    ]);
    const { document } = dom.window;
    const section = document.getElementById('bankMoneySection');
    const cards = [...document.querySelectorAll('#bankMoneyList [data-bank]')];

    assert.equal(section.hidden, false);
    assert.deepEqual(cards.map(card => card.dataset.bank), ['jago', 'blu', 'unassigned']);
    assert.equal(cards[0].querySelector('[data-bank-remaining]').textContent, 'Rp 3000');
    assert.match(cards[0].textContent, /of Rp 4000 · 2 pockets/);
    assert.ok(cards[0].querySelector('[data-bank-logo="jago"] img'));
    assert.equal(cards[0].querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '25');

    const blu = cards[1].querySelector('[data-bank-remaining]');
    assert.equal(blu.textContent, '-Rp 200');
    assert.match(cards[1].textContent, /Over budget · of Rp 500 · 1 pocket/);
    assert.ok(blu.classList.contains('text-coral'));
    assert.ok(cards[1].querySelector('.journal-pulse-fill.danger'));
    assert.match(cards[2].textContent, /No bank/);
    dom.window.close();
});

test('Money by bank stays hidden without bank data', async () => {
    const { dom } = await setupWithBanks(null);
    const { document } = dom.window;

    assert.equal(document.getElementById('bankMoneySection').hidden, true);
    assert.equal(document.querySelectorAll('#bankMoneyList [data-bank]').length, 0);
    dom.window.close();
});

test('Pocket Pulse shows the bank logo before each pocket name', async () => {
    const { dom } = await setupPage({
        summary: budgetSummary({
            pockets: [
                { pocket: 'Groceries', icon: '🥦', cadence: 'Monthly', budget: 500000, spent: 100000, alertStatus: 'normal',
                    bank: { key: 'jago', name: 'Jago', color: '#FDAF27', logo: '/images/banks/jago.svg' } },
                { pocket: 'Old', icon: '📦', cadence: 'Monthly', budget: 100000, spent: 0, alertStatus: 'normal', bank: null }
            ],
            totalBudget: 600000,
            totalRemaining: 500000,
            period: { startDate: utcDateKey(-5), endDate: utcDateKey(9) }
        }),
        transactions: []
    });
    const titles = [...dom.window.document.querySelectorAll('#pocketPulseList .journal-pulse-title')];

    assert.ok(titles[0].querySelector('[data-bank-logo="jago"] img'));
    assert.equal(titles[0].lastElementChild.textContent, '🥦 Groceries');
    assert.equal(titles[1].querySelector('[data-bank-logo]'), null);
    dom.window.close();
});
