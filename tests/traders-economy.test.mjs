// tests/traders-economy.test.mjs — Automated tests for Traders, Wallet, and Economy rules.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const scripts = loadScripts(['js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js'], { document: {} });
const rules = scripts.get('RaidRules');
const ARC_TRADERS = scripts.get('ARC_TRADERS');
const ARC_ITEMS = scripts.get('ARC_ITEMS');

test('ARC_TRADERS registry defines four factional traders with valid inventories', () => {
    assert.ok(ARC_TRADERS, 'ARC_TRADERS registry must exist');
    const expected = ['marco', 'elena', 'bruno', 'sofia'];
    for (const id of expected) {
        const trader = ARC_TRADERS[id];
        assert.ok(trader, `Trader ${id} must exist`);
        assert.equal(trader.id, id);
        assert.ok(trader.nameRu && trader.nameEn, `Trader ${id} must have bilingual names`);
        assert.ok(trader.roleRu && trader.roleEn, `Trader ${id} must have bilingual roles`);
        assert.ok(Array.isArray(trader.inventory) && trader.inventory.length > 0, `Trader ${id} must have goods in stock`);

        for (const item of trader.inventory) {
            assert.ok(item.id, 'Trader item must have unique id');
            assert.ok(item.name, 'Trader item must have name');
            assert.ok(typeof item.price === 'number' && item.price >= 0, 'Trader item must have non-negative price');
            assert.ok(typeof item.arcCores === 'number' && item.arcCores >= 0, 'Trader item must have non-negative arcCores cost');
        }
    }
});

test('canAfford accurately checks Credits and ARC Cores requirements', () => {
    const wallet = { credits: 3500, arcCores: 2 };

    // Standard credit purchase
    assert.equal(rules.canAfford(wallet, 2000), true);
    assert.equal(rules.canAfford(wallet, 4000), false);

    // Multi-currency purchase
    assert.equal(rules.canAfford(wallet, { price: 3000, arcCores: 1 }), true);
    assert.equal(rules.canAfford(wallet, { price: 3000, arcCores: 2 }), true);
    assert.equal(rules.canAfford(wallet, { price: 3000, arcCores: 3 }), false, 'Lacks ARC Cores');
    assert.equal(rules.canAfford(wallet, { price: 4000, arcCores: 1 }), false, 'Lacks Credits');
});

test('executePurchase deducts currency and adds cloned item to stash', () => {
    const wallet = { credits: 5000, arcCores: 2 };
    const stash = [];
    const itemDef = ARC_ITEMS.tempest_ii;

    const res = rules.executePurchase(wallet, stash, itemDef, { price: 2500, arcCores: 1 });

    assert.equal(res.success, true);
    assert.equal(wallet.credits, 2500);
    assert.equal(wallet.arcCores, 1);
    assert.equal(stash.length, 1);
    assert.equal(stash[0].name, 'TEMPEST II');
    assert.notEqual(stash[0].id, itemDef.id, 'Purchased item gets a fresh unique runtime id');

    // Attempt second purchase with insufficient funds
    const failRes = rules.executePurchase(wallet, stash, itemDef, { price: 3000, arcCores: 0 });
    assert.equal(failRes.success, false);
    assert.equal(failRes.error, 'insufficient_funds');
    assert.equal(wallet.credits, 2500, 'Credits remain untouched on failure');
});

test('sellJunk converts scrap and common materials to credits while preserving rare cores and gear', () => {
    const stash = [
        { id: 's1', name: 'STEEL SCRAP', category: 'materials', type: 'scrap', count: 10, value: 350 }, // 350 CR total
        { id: 's2', name: 'DAMAGED SENSOR', category: 'materials', type: 'sensor', count: 2, value: 400 }, // 400 CR total
        { id: 's3', name: 'TEMPEST II', category: 'weapons', count: 1, value: 7500 }, // PRESERVED
        { id: 's4', name: 'ARC POWER CORE', category: 'materials', type: 'core', count: 1, value: 850 }, // PRESERVED (rare core)
        { id: 's5', name: 'ARC MEMORY CORE', category: 'materials', id: 'memory_core', count: 1, value: 6500 }, // PRESERVED (legendary quest item)
    ];

    const result = rules.sellJunk(stash);

    assert.equal(result.creditsEarned, 750); // 350 + 400 CR
    assert.equal(result.junkCount, 12);
    assert.equal(result.remainingStash.length, 3);
    assert.ok(result.remainingStash.some(it => it.name === 'TEMPEST II'));
    assert.ok(result.remainingStash.some(it => it.name === 'ARC POWER CORE'));
    assert.ok(result.remainingStash.some(it => it.id === 'memory_core'));
});
