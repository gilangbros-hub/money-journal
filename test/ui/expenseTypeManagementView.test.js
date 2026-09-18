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
