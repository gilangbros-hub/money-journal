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
