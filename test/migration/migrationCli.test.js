'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
    createAndPersistPreview
} = require('../../services/migrationService');
const { parseArgs, usage } = require('../../scripts/migrate-budget-month');

const actor = { userId: '65f000000000000000000001', role: 'Operator' };

function emptyModel() {
    return {
        find() {
            return {
                lean() { return this; },
                exec: async () => []
            };
        }
    };
}

class PreviewModel {
    static docs = [];

    constructor(value) {
        Object.assign(this, value);
        this._id = new mongoose.Types.ObjectId();
    }

    async save() {
        PreviewModel.docs.push(this);
        return this;
    }
}

const ItemModel = {
    async insertMany() {
        throw new Error('item persistence should not be reached for an oversized preview');
    }
};

test('migration CLI defaults to preview and preserves repeatable guard options', () => {
    const options = parseArgs([
        '--actor-id', actor.userId,
        '--required-budget-month', '2026-04',
        '--required-budget-month', '2026-05,2026-06',
        '--max-preview-items', '12',
        '--max-preview-bytes', '2048'
    ]);

    assert.equal(options.command, 'preview');
    assert.deepEqual(options.requiredBudgetMonth, ['2026-04', '2026-05,2026-06']);
    assert.equal(options.maxPreviewItems, '12');
    assert.equal(options.maxPreviewBytes, '2048');
    assert.match(usage(), /max-preview-items/);
    assert.match(usage(), /max-preview-bytes/);
});

test('preview rejects unsupported transaction deployments before persistence', async () => {
    await assert.rejects(
        createAndPersistPreview({
            actor,
            connection: {
                db: { admin: () => ({ command: async () => ({ ok: 1 }) }) }
            },
            models: {
                pocketbudgets: emptyModel(),
                pocketbudgetcadences: emptyModel(),
                weeklyallocations: emptyModel(),
                transactions: emptyModel(),
                closedmonths: emptyModel()
            },
            previewModel: PreviewModel,
            itemModel: ItemModel
        }),
        error => error.code === 'CONFIG_TRANSACTIONS_REQUIRED'
    );
    assert.equal(PreviewModel.docs.length, 0);
});

test('preview rejects oversized all-or-nothing input before writing preview documents', async () => {
    PreviewModel.docs = [];
    const models = {
        pocketbudgets: {
            find() {
                return {
                    lean() { return this; },
                    exec: async () => [{
                        _id: 'budget-1', pocket: 'Groceries', month: 4, year: 2026,
                        budget: 100, createdBy: actor.userId
                    }]
                };
            }
        },
        pocketbudgetcadences: emptyModel(),
        weeklyallocations: emptyModel(),
        transactions: emptyModel(),
        closedmonths: emptyModel()
    };

    await assert.rejects(
        createAndPersistPreview({
            actor,
            connection: {},
            models,
            previewModel: PreviewModel,
            itemModel: ItemModel,
            maxPreviewItems: 0
        }),
        error => error.code === 'MIGRATION_PREVIEW_BLOCKED' &&
            error.details?.reason === 'MIGRATION_PREVIEW_TOO_LARGE'
    );
    assert.equal(PreviewModel.docs.length, 0);
});
