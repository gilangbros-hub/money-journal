'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const hbs = require('hbs');

const viewSource = fs.readFileSync(require.resolve('../../views/check-pockets.hbs'), 'utf8');

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
        salaryCycleBudgetingEnabled: true,
        ...overrides
    });
}

test('enabled Check Pockets view exposes salary-cycle and cadence templates', () => {
    const html = render();

    assert.match(html, /id="salaryCycleControls"/);
    assert.match(html, /data-salary-cycle-enabled="true"/);
    assert.match(html, /id="budgetMonthHeading">Budget Month/);
    assert.match(html, /data-budget-month/);
    assert.match(html, /id="salaryCyclePeriod"/);
    assert.match(html, /id="monthlyPocketCardTemplate"/);
    assert.match(html, /id="weeklyPocketCardTemplate"/);
    assert.equal((html.match(/data-week-selector/g) || []).length, 1);
    assert.match(html, /data-week-label/);
    assert.match(html, /data-week-intersection-label/);
    assert.match(html, /data-pocket-allocation/);
    assert.match(html, /data-pocket-spending/);
    assert.match(html, /data-pocket-remaining/);
    assert.match(html, /data-pocket-percentage/);
    assert.match(html, /id="inactiveAllocationConfirmationTemplate"/);
    assert.match(html, /data-cancel-cadence/);
    assert.match(html, /data-confirm-cadence/);
});

test('Wife-only mutation controls are absent for authenticated readers', () => {
    const wifeHtml = render({ canEdit: true, role: 'Wife' });
    const readerHtml = render({ canEdit: false, role: 'Husband' });

    assert.match(wifeHtml, /data-cadence-select/);
    assert.match(wifeHtml, /data-save-monthly-allocation/);
    assert.match(wifeHtml, /data-save-weekly-allocation/);
    assert.match(wifeHtml, /data-confirm-cadence/);

    assert.doesNotMatch(readerHtml, /data-cadence-select/);
    assert.doesNotMatch(readerHtml, /data-save-monthly-allocation/);
    assert.doesNotMatch(readerHtml, /data-save-weekly-allocation/);
    assert.doesNotMatch(readerHtml, /data-confirm-cadence/);
    assert.match(readerHtml, /data-cadence-readonly/);
    assert.match(readerHtml, /View-only mode/);
});

test('closed and out-of-window state hooks remain available to the server-driven client', () => {
    const html = render();

    assert.match(html, /id="budgetState"/);
    assert.match(html, /id="closedBudgetState"/);
    assert.match(html, /id="outOfWindowState"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /disabled/);
});

test('feature-disabled rendering preserves the legacy month and edit view', () => {
    const html = render({ salaryCycleBudgetingEnabled: false });

    assert.doesNotMatch(html, /id="salaryCycleControls"/);
    assert.doesNotMatch(html, /id="monthlyPocketCardTemplate"/);
    assert.doesNotMatch(html, /id="weeklyPocketCardTemplate"/);
    assert.doesNotMatch(html, /id="inactiveAllocationConfirmationTemplate"/);
    assert.match(html, /id="currentMonth">Februari 2026/);
    assert.match(html, /id="editModal"/);
    assert.match(html, /id="budgetInput"/);
});

test('Check Pockets is a navbar tab with Pockets active and no back link', () => {
    const { document } = new JSDOM(render({ isBudget: true })).window;

    assert.equal(document.querySelector('.bottom-navbar .nav-item.active').getAttribute('href'), '/check-pockets');
    assert.doesNotMatch(document.querySelector('.app-header').textContent, /Back/);
    assert.equal(document.getElementById('actionHubTrigger').getAttribute('href'), '/log-spending');
});
