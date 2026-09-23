'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const hbs = require('hbs');

const viewSource = fs.readFileSync(require.resolve('../../views/profile.hbs'), 'utf8');

hbs.handlebars.registerPartial('head', '<meta charset="utf-8">');
hbs.handlebars.registerPartial('actionHub', fs.readFileSync(require.resolve('../../views/partials/actionHub.hbs'), 'utf8'));
hbs.handlebars.registerPartial('navbar', fs.readFileSync(require.resolve('../../views/partials/navbar.hbs'), 'utf8'));
hbs.handlebars.registerHelper('split', (value) => value.split(',').map((item) => item.trim()));
hbs.handlebars.registerHelper('eq', (a, b) => a === b);
const renderView = hbs.handlebars.compile(viewSource);

function render(overrides = {}) {
    return renderView({
        username: 'tester',
        currentAvatar: '👤',
        currentRole: 'Wife',
        telegramBotEnabled: true,
        telegramLinked: false,
        telegramBotUsername: '',
        ...overrides
    });
}

test('the Telegram section is absent entirely when the bot feature is off', () => {
    const document = new JSDOM(render({ telegramBotEnabled: false })).window.document;
    assert.equal(document.getElementById('telegramLinkCard'), null);
});

test('an unlinked account sees a Generate code button and no Unlink button', () => {
    const document = new JSDOM(render({ telegramLinked: false })).window.document;
    assert.ok(document.getElementById('telegramLinkBtn'));
    assert.equal(document.getElementById('telegramUnlinkBtn'), null);
});

test('a linked account sees an Unlink button and no Generate code button', () => {
    const document = new JSDOM(render({ telegramLinked: true })).window.document;
    assert.ok(document.getElementById('telegramUnlinkBtn'));
    assert.equal(document.getElementById('telegramLinkBtn'), null);
    assert.match(document.body.textContent, /Linked/);
});

test('the bot username, when configured, appears in the linking instructions', () => {
    const document = new JSDOM(render({ telegramLinked: false, telegramBotUsername: 'MoneyJournalBot' })).window.document;
    assert.match(document.body.textContent, /@MoneyJournalBot/);
});
