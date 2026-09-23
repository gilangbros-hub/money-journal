'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const hbs = require('hbs');

const viewSource = fs.readFileSync(require.resolve('../../views/check-pockets.hbs'), 'utf8');
const browserSource = fs.readFileSync(require.resolve('../../public/js/check-pockets.js'), 'utf8');
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

function pocket(overrides = {}) {
    return {
        pocket: 'Groceries',
        icon: '🛒',
        cadence: 'Monthly',
        allocation: { budget: 300 },
        monthlyAllocation: { budget: 300 },
        missingAllocation: false,
        metrics: { allocation: 300, spending: 100, remaining: 200, percentageUsed: 33 },
        periodMetrics: { allocation: 300, spending: 100, remaining: 200, percentageUsed: 33 },
        ...overrides
    };
}

function budgetData(overrides = {}) {
    return {
        budgetMonth: '2027-02',
        period: { startDate: '2027-01-25', endDate: '2027-02-24' },
        canEdit: true,
        isClosed: false,
        aggregate: { allocation: 300, spending: 100, remaining: 200, percentageUsed: 33 },
        pockets: [pocket()],
        ...overrides
    };
}

async function setupPage(fetchImpl, { role = 'Wife', canEdit = true, calls = [] } = {}) {
    const dom = new JSDOM(renderView({
        username: 'tester',
        avatar: '👤',
        role,
        canEdit,
        salaryCycleBudgetingEnabled: true
    }), {
        url: 'https://money-journal.test/check-pockets',
        runScripts: 'outside-only'
    });
    dom.window.fetch = async (url, options) => {
        calls.push({ url, options });
        return fetchImpl(url, options);
    };
    dom.window.Chart = function Chart() { this.destroy = () => {}; };
    dom.window.chartColors = ['#000'];
    dom.window.formatRupiah = value => `Rp ${value}`;
    dom.window.showToast = () => {};
    dom.window.confirm = () => true;
    dom.window.CSS = dom.window.CSS || { escape: value => value };
    dom.window.eval(banksSource);
    dom.window.eval(browserSource);
    await new Promise(resolve => setImmediate(resolve));
    return dom;
}

test('Check Pockets initializes and navigates from server Budget_Month metadata', async () => {
    const calls = [];
    const dom = await setupPage(async url => {
        if (url === '/api/budget') return response({ success: true, data: budgetData() });
        assert.equal(url, '/api/budget?month=2027-03');
        return response({
            success: true,
            data: budgetData({
                budgetMonth: '2027-03',
                period: { startDate: '2027-02-25', endDate: '2027-03-24' },
                canEdit: false,
                isClosed: true
            })
        });
    }, { calls });

    assert.equal(calls[0].url, '/api/budget');
    assert.equal(dom.window.document.getElementById('currentMonth').textContent, 'Februari 2027');
    assert.equal(dom.window.document.getElementById('salaryCyclePeriod').textContent, '2027-01-25 – 2027-02-24');

    dom.window.document.getElementById('nextMonth').click();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(dom.window.document.getElementById('currentMonth').textContent, 'Maret 2027');
    assert.equal(dom.window.document.getElementById('salaryCyclePeriod').textContent, '2027-02-25 – 2027-03-24');
    assert.equal(dom.window.document.querySelector('[data-cadence-select]').disabled, true);
    assert.match(dom.window.document.getElementById('closedBudgetState').textContent, /closed/);
    dom.window.close();
});

test('weekly cards select one exact week, show intersection, and save the exact key', async () => {
    const calls = [];
    const weeks = [
        { key: '2027-W08', weekYear: 2027, weekNumber: 8, startDate: '2027-02-22', endDate: '2027-02-28', intersectionStartDate: '2027-02-22', intersectionEndDate: '2027-02-24' },
        { key: '2027-W09', weekYear: 2027, weekNumber: 9, startDate: '2027-03-01', endDate: '2027-03-07', intersectionStartDate: '2027-03-01', intersectionEndDate: '2027-03-07' }
    ];
    const weekly = (selectedKey, amount, spending) => {
        const selected = weeks.find(week => week.key === selectedKey);
        return budgetData({
            selectedWeek: selectedKey,
            availableWeeks: weeks,
            pockets: [pocket({
                cadence: 'Weekly',
                monthlyAllocation: { budget: 300 },
                allocation: amount === null ? null : { budget: amount },
                missingAllocation: amount === null,
                availableWeeks: weeks.map(week => ({ ...week, allocation: week.key === selectedKey && amount !== null ? { budget: amount } : null })),
                selectedWeek: { ...selected, allocation: amount === null ? null : { budget: amount }, metrics: { allocation: amount || 0, spending, remaining: (amount || 0) - spending, percentageUsed: amount ? Math.round(spending / amount * 100) : 0 } },
                metrics: { allocation: amount || 0, spending, remaining: (amount || 0) - spending, percentageUsed: amount ? Math.round(spending / amount * 100) : 0 },
                periodMetrics: { allocation: 0, spending, remaining: -spending, percentageUsed: 0 }
            })]
        });
    };
    const dom = await setupPage(async url => {
        if (url === '/api/budget') return response({ success: true, data: weekly('2027-W08', null, 25) });
        if (url === '/api/budget?month=2027-02&week=2027-W09') return response({ success: true, data: weekly('2027-W09', 125, 50) });
        if (url === '/api/budget/allocation/weekly') return response({ success: true, data: {} });
        throw new Error(`Unexpected URL ${url}`);
    }, { calls });

    const card = dom.window.document.querySelector('[data-pocket-card]');
    assert.equal(card.dataset.cadence, 'Weekly');
    assert.equal(card.dataset.missingAllocation, 'true');
    assert.match(card.querySelector('[data-pocket-allocation]').textContent, /Missing · Rp 0/);
    assert.match(card.querySelector('[data-week-label]').textContent, /2027-W08 · 2027-02-22 – 2027-02-28/);
    assert.match(card.querySelector('[data-week-intersection-label]').textContent, /2027-02-22 – 2027-02-24/);

    const selector = card.querySelector('[data-week-selector]');
    selector.value = '2027-W09';
    selector.dispatchEvent(new dom.window.Event('change'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1).url, '/api/budget?month=2027-02&week=2027-W09');
    const selectedCard = dom.window.document.querySelector('[data-pocket-card]');
    assert.equal(selectedCard.querySelector('[data-pocket-allocation]').textContent, 'Rp 125');
    assert.equal(selectedCard.querySelector('[data-pocket-spending]').textContent, 'Rp 50');

    selectedCard.querySelector('[data-save-weekly-allocation]').click();
    dom.window.document.getElementById('budgetInput').value = '140';
    await dom.window.saveBudget();
    const save = calls.find(call => call.options?.method === 'PUT' && call.url === '/api/budget/allocation/weekly');
    assert.ok(save);
    assert.deepEqual(JSON.parse(save.options.body), { pocket: 'Groceries', budgetMonth: '2027-02', amount: 140, isoWeek: '2027-W09' });
    dom.window.close();
});

test('cadence changes confirm inactive allocations and cancel without a request', async () => {
    const calls = [];
    const dom = await setupPage(async url => {
        if (url === '/api/budget') return response({ success: true, data: budgetData() });
        if (url === '/api/budget?month=2027-02') return response({ success: true, data: budgetData({ pockets: [pocket({ cadence: 'Weekly', weeklyAllocations: [{ isoWeekYear: 2027, isoWeekNumber: 8, budget: 50 }] })] }) });
        if (url === '/api/budget/cadence') return response({ success: true, data: {} });
        throw new Error(`Unexpected URL ${url}`);
    }, { calls });

    const select = dom.window.document.querySelector('[data-cadence-select]');
    select.value = 'Weekly';
    select.dispatchEvent(new dom.window.Event('change'));
    assert.ok(dom.window.document.querySelector('[data-cancel-cadence]'));
    dom.window.document.querySelector('[data-cancel-cadence]').click();
    assert.equal(dom.window.document.querySelector('[data-cadence-select]').value, 'Monthly');
    assert.equal(calls.filter(call => call.options?.method === 'PUT').length, 0);

    select.value = 'Weekly';
    select.dispatchEvent(new dom.window.Event('change'));
    dom.window.document.querySelector('[data-confirm-cadence]').click();
    await new Promise(resolve => setImmediate(resolve));
    const cadence = calls.find(call => call.options?.method === 'PUT' && call.url === '/api/budget/cadence');
    assert.ok(cadence);
    assert.deepEqual(JSON.parse(cadence.options.body), {
        pocket: 'Groceries', budgetMonth: '2027-02', cadence: 'Weekly', confirmInactive: true
    });
    dom.window.close();
});

test('feature-off legacy mode still initializes from the server and avoids device-calendar defaults', async () => {
    const source = browserSource;
    assert.doesNotMatch(source, /new Date\(/);
    const dom = new JSDOM(renderView({ username: 'tester', avatar: '👤', role: 'Wife', canEdit: true, salaryCycleBudgetingEnabled: false }), {
        url: 'https://money-journal.test/check-pockets', runScripts: 'outside-only'
    });
    const calls = [];
    dom.window.fetch = async (url, options) => {
        calls.push({ url, options });
        const month = url.includes('2027-03') ? 3 : 2;
        return response({ success: true, data: {
            budgetMonth: `2027-${String(month).padStart(2, '0')}`, month, year: 2027,
            canEdit: true, pockets: [], aggregate: { allocation: 0, spending: 0, remaining: 0 }
        } });
    };
    dom.window.Chart = function Chart() { this.destroy = () => {}; };
    dom.window.formatRupiah = value => `Rp ${value}`;
    dom.window.showToast = () => {};
    dom.window.eval(browserSource);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[0].url, '/api/budget');
    assert.equal(dom.window.document.getElementById('currentMonth').textContent, 'Februari 2027');
    dom.window.document.getElementById('nextMonth').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[1].url, '/api/budget?month=2027-03');
    dom.window.close();
});


test('monthly cards render full-period metrics and save the exact Budget_Month key', async () => {
    const calls = [];
    const dom = await setupPage(async url => {
        if (url === '/api/budget' || url === '/api/budget?month=2027-02') {
            return response({ success: true, data: budgetData({
                pockets: [pocket({
                    metrics: { allocation: 300, spending: 125, remaining: 175, percentageUsed: 42 },
                    periodMetrics: { allocation: 300, spending: 125, remaining: 175, percentageUsed: 42 }
                })]
            }) });
        }
        if (url === '/api/budget/allocation/monthly') return response({ success: true, data: {} });
        throw new Error(`Unexpected URL ${url}`);
    }, { calls });

    const card = dom.window.document.querySelector('[data-pocket-card]');
    assert.equal(card.dataset.cadence, 'Monthly');
    assert.equal(card.querySelector('[data-pocket-allocation]').textContent, 'Rp 300');
    assert.equal(card.querySelector('[data-pocket-spending]').textContent, 'Rp 125');
    assert.equal(card.querySelector('[data-pocket-remaining]').textContent, 'Rp 175');
    assert.equal(card.querySelector('[data-pocket-percentage]').textContent, '42%');

    card.querySelector('[data-save-monthly-allocation]').click();
    dom.window.document.getElementById('budgetInput').value = '350';
    await dom.window.saveBudget();

    const save = calls.find(call => call.options?.method === 'PUT' && call.url === '/api/budget/allocation/monthly');
    assert.ok(save);
    assert.deepEqual(JSON.parse(save.options.body), {
        pocket: 'Groceries', budgetMonth: '2027-02', amount: 350
    });
    dom.window.close();
});

test('inactive allocation confirmation identifies retained allocations before cadence changes', async () => {
    const calls = [];
    const dom = await setupPage(async url => {
        if (url === '/api/budget') return response({ success: true, data: budgetData() });
        if (url === '/api/budget/cadence') return response({ success: true, data: {} });
        throw new Error(`Unexpected URL ${url}`);
    }, { calls });

    const select = dom.window.document.querySelector('[data-cadence-select]');
    select.value = 'Weekly';
    select.dispatchEvent(new dom.window.Event('change'));

    const confirmation = dom.window.document.getElementById('inactiveAllocationConfirmation');
    assert.ok(confirmation);
    assert.match(confirmation.textContent, /saved allocations will become inactive/i);
    assert.match(confirmation.textContent, /retained and can be restored/i);
    assert.match(dom.window.document.getElementById('inactiveAllocationList').textContent, /Monthly allocation: Rp 300/);
    assert.equal(calls.filter(call => call.options?.method === 'PUT').length, 0);
    dom.window.document.querySelector('[data-cancel-cadence]').click();
    dom.window.close();
});

test('server out-of-window state disables every budget mutation control', async () => {
    const calls = [];
    const dom = await setupPage(async url => {
        if (url === '/api/budget') return response({ success: true, data: budgetData({
            canEdit: false,
            isClosed: false,
            pockets: [pocket()]
        }) });
        throw new Error(`Unexpected URL ${url}`);
    }, { role: 'Wife', canEdit: true, calls });

    const state = dom.window.document.getElementById('budgetState');
    assert.notEqual(state.classList.contains('hidden'), true);
    assert.equal(dom.window.document.getElementById('closedBudgetState').classList.contains('hidden'), true);
    assert.equal(dom.window.document.getElementById('outOfWindowState').classList.contains('hidden'), false);
    assert.ok([...dom.window.document.querySelectorAll('[data-mutation-control]')].length > 0);
    for (const control of dom.window.document.querySelectorAll('[data-mutation-control]')) {
        assert.equal(control.disabled, true);
        assert.equal(control.getAttribute('aria-disabled'), 'true');
    }
    dom.window.close();
});

test('managed mode renders an information-only pocket card that points at Pocket Management', async () => {
    const dom = await setupPage(async url => {
        if (url === '/api/budget') {
            return response({
                success: true,
                data: budgetData({ pocketManagementEnabled: true, formattedTotal: 'Rp 300' })
            });
        }
        throw new Error(`Unexpected URL ${url}`);
    });

    const card = dom.window.document.querySelector('[data-pocket-card]');
    assert.equal(card.querySelector('[data-pocket-icon]').textContent, '🛒');
    assert.equal(card.querySelector('[data-pocket-name]').textContent, 'Groceries');
    assert.equal(card.querySelector('[data-pocket-allocation]').textContent, 'Rp 300');

    const readonlyCadence = card.querySelector('[data-cadence-readonly]');
    assert.equal(readonlyCadence.textContent, 'Monthly');
    assert.equal(readonlyCadence.hasAttribute('hidden'), false);
    assert.equal(card.querySelector('[data-cadence-control]').hasAttribute('hidden'), true);
    assert.equal(card.querySelector('[data-save-monthly-allocation]').hasAttribute('hidden'), true);

    const manageLink = card.querySelector('[data-manage-allocation]');
    assert.equal(manageLink.hasAttribute('hidden'), false);
    assert.equal(manageLink.getAttribute('href'), '/pocket-management');
    dom.window.close();
});

test('managed cards stay information-only for a view-only household member', async () => {
    const dom = await setupPage(async url => {
        if (url === '/api/budget') {
            return response({
                success: true,
                data: budgetData({ pocketManagementEnabled: true, canEdit: false })
            });
        }
        throw new Error(`Unexpected URL ${url}`);
    }, { role: 'Husband', canEdit: false });

    const card = dom.window.document.querySelector('[data-pocket-card]');
    assert.equal(card.querySelector('[data-cadence-readonly]').hasAttribute('hidden'), false);
    assert.equal(card.querySelector('[data-cadence-select]'), null);
    assert.equal(card.querySelector('[data-manage-allocation]').hasAttribute('hidden'), true);
    dom.window.close();
});

test('managed view updates the Budget Month text even when the legacy salary-cycle flag is off', async () => {
    // Reproduces the client-side half of the production bug directly: a
    // salary-cycle-shaped render (the controller now always produces one for
    // managed mode) whose hidden legacy flag is nonetheless false. Before the
    // fix, updateMonthDisplay() gated on that flag instead of on
    // currentBudgetMonth, so the template's static placeholder text never
    // updated through any navigation click.
    const html = renderView({
        username: 'tester',
        avatar: '👤',
        role: 'Wife',
        canEdit: true,
        salaryCycleBudgetingEnabled: true
    }).replace('id="salaryCycleEnabled" value="true"', 'id="salaryCycleEnabled" value="false"');

    const calls = [];
    const dom = new JSDOM(html, { url: 'https://money-journal.test/check-pockets', runScripts: 'outside-only' });
    dom.window.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url === '/api/budget') {
            return response({ success: true, data: budgetData({ pocketManagementEnabled: true }) });
        }
        assert.equal(url, '/api/budget?month=2027-03');
        return response({
            success: true,
            data: budgetData({
                budgetMonth: '2027-03',
                period: { startDate: '2027-02-25', endDate: '2027-03-24' },
                pocketManagementEnabled: true
            })
        });
    };
    dom.window.Chart = function Chart() { this.destroy = () => {}; };
    dom.window.chartColors = ['#000'];
    dom.window.formatRupiah = value => `Rp ${value}`;
    dom.window.showToast = () => {};
    dom.window.CSS = dom.window.CSS || { escape: value => value };
    dom.window.eval(browserSource);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(dom.window.document.getElementById('currentMonth').textContent, 'Februari 2027');

    dom.window.document.getElementById('nextMonth').click();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(dom.window.document.getElementById('currentMonth').textContent, 'Maret 2027');
    dom.window.close();
});


// ---------------------------------------------------------------------------
// By bank strip (managed pockets only)
// ---------------------------------------------------------------------------
const JAGO = { key: 'jago', name: 'Bank Jago', color: '#FDAF27', logo: '/images/banks/jago.svg', initial: 'B' };
const BLU = { key: 'blu', name: 'blu', color: '#33CDCF', logo: '/images/banks/blu.svg', initial: 'B' };

function bankBudgetData(overrides = {}) {
    return budgetData({
        pocketManagementEnabled: true,
        pockets: [
            pocket({ pocket: 'Groceries', pocketId: 'p1', bank: JAGO }),
            pocket({ pocket: 'Snacks', pocketId: 'p2', bank: JAGO }),
            pocket({ pocket: 'Transport', pocketId: 'p3', bank: BLU }),
            pocket({ pocket: 'Old', pocketId: 'p4', bank: null })
        ],
        banks: [
            { ...JAGO, pocketCount: 2, allocation: 600, spending: 200, remaining: 400, formattedRemaining: 'Rp 400', isOver: false },
            { ...BLU, pocketCount: 1, allocation: 300, spending: 450, remaining: -150, formattedRemaining: 'Rp 150', isOver: true },
            { key: 'unassigned', name: 'No bank', color: null, logo: null, initial: '?', pocketCount: 1, allocation: 300, spending: 100, remaining: 200, formattedRemaining: 'Rp 200', isOver: false }
        ],
        ...overrides
    });
}

const visiblePockets = document => [...document.querySelectorAll('#budgetList [data-pocket-card]')]
    .filter(card => !card.hidden)
    .map(card => card.dataset.pocket);

test('the By bank strip shows one card per bank with its remaining', async () => {
    const dom = await setupPage(async () => response({ success: true, data: bankBudgetData() }));
    const { document } = dom.window;
    const section = document.getElementById('bankSummary');
    const cards = [...document.querySelectorAll('#bankStrip [data-bank-filter]')];

    assert.equal(section.hidden, false);
    assert.deepEqual(cards.map(card => card.dataset.bankFilter), ['jago', 'blu', 'unassigned']);
    assert.equal(cards[0].querySelector('[data-bank-remaining]').textContent, 'Rp 400');
    assert.match(cards[0].textContent, /2 pockets · left in budget/);
    assert.ok(cards[0].querySelector('[data-bank-logo="jago"] img'));
    // Overspent bank: sign shown and coral.
    const blu = cards[1].querySelector('[data-bank-remaining]');
    assert.equal(blu.textContent, '-Rp 150');
    assert.ok(blu.classList.contains('text-coral'));
    assert.match(cards[2].textContent, /No bank/);
    dom.window.close();
});

test('pocket cards carry their bank logo', async () => {
    const dom = await setupPage(async () => response({ success: true, data: bankBudgetData() }));
    const { document } = dom.window;
    const card = name => document.querySelector(`#budgetList [data-pocket-card][data-pocket="${name}"]`);

    assert.ok(card('Groceries').querySelector('[data-pocket-bank] [data-bank-logo="jago"]'));
    assert.equal(card('Groceries').querySelector('[data-pocket-bank]').hidden, false);
    assert.equal(card('Old').querySelector('[data-pocket-bank]').hidden, true);
    dom.window.close();
});

test('tapping a bank filters the pockets, tapping again shows them all', async () => {
    const dom = await setupPage(async () => response({ success: true, data: bankBudgetData() }));
    const { document } = dom.window;
    const jago = document.querySelector('[data-bank-filter="jago"]');

    jago.click();
    assert.deepEqual(visiblePockets(document), ['Groceries', 'Snacks']);
    assert.equal(jago.getAttribute('aria-pressed'), 'true');
    assert.equal(document.getElementById('bankFilterClear').hidden, false);

    document.querySelector('[data-bank-filter="unassigned"]').click();
    assert.deepEqual(visiblePockets(document), ['Old']);

    document.querySelector('[data-bank-filter="unassigned"]').click();
    assert.deepEqual(visiblePockets(document), ['Groceries', 'Snacks', 'Transport', 'Old']);

    jago.click();
    document.getElementById('bankFilterClear').click();
    assert.deepEqual(visiblePockets(document), ['Groceries', 'Snacks', 'Transport', 'Old']);
    assert.equal(document.getElementById('bankFilterClear').hidden, true);
    dom.window.close();
});

test('no banks in the summary means no By bank strip', async () => {
    const dom = await setupPage(async () => response({ success: true, data: budgetData() }));
    const { document } = dom.window;

    assert.equal(document.getElementById('bankSummary').hidden, true);
    assert.equal(document.querySelectorAll('#bankStrip [data-bank-filter]').length, 0);
    dom.window.close();
});
