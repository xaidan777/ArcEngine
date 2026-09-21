// tests/inventory-server.test.mjs — Authoritative server inventory & economy tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createStarterInventory,
    slotAccepts,
    validateAndMove,
    executeTraderBuy,
    executeSell,
    executeSellJunk,
    applyRaidInventory,
    instantiateItem
} from '../server/inventory.mjs';
import { AccountStore } from '../server/accounts.mjs';
import { createGameServer } from '../server/main.mjs';
import { loadScripts } from './browser-scripts.mjs';

test('inventory: starter kit creates valid loadout, stash and currencies', () => {
    const starter = createStarterInventory();
    assert.equal(starter.credits, 0);
    assert.equal(starter.arcCores, 1);
    assert.equal(starter.inventoryVersion, 1);

    assert.ok(starter.loadout.primary);
    assert.equal(starter.loadout.primary.name, 'TEMPEST II');
    assert.ok(starter.loadout.primary.instId.startsWith('it_'));

    assert.ok(starter.loadout.secondary);
    assert.equal(starter.loadout.secondary.name, 'REVOLVER I');

    assert.ok(starter.loadout.shieldCore);
    assert.equal(starter.loadout.shieldCore.name, 'MEDIUM SHIELD CORE');

    assert.equal(starter.loadout.backpack.length, 18);
    assert.ok(starter.loadout.backpack[0]);
    assert.equal(starter.loadout.backpack[2], null);

    assert.equal(starter.loadout.safePocket.length, 2);
    assert.ok(starter.loadout.safePocket[0]);
    assert.equal(starter.loadout.safePocket[1], null);

    assert.ok(starter.stash.length >= 8);
});

test('inventory: slot acceptance rules enforce weapon, armor and safe pocket restrictions', () => {
    const weapon = instantiateItem('tempest_ii');
    const shield = instantiateItem('shield_medium');
    const drive = instantiateItem('data_drive');
    const stim = instantiateItem('consumable_stim');

    assert.equal(slotAccepts('primary', weapon), true);
    assert.equal(slotAccepts('primary', shield), false);
    assert.equal(slotAccepts('primary', stim), false);

    assert.equal(slotAccepts('shieldCore', shield), true);
    assert.equal(slotAccepts('shieldCore', weapon), false);

    assert.equal(slotAccepts('quickSlots', stim), true);
    assert.equal(slotAccepts('quickSlots', weapon), false);

    assert.equal(slotAccepts('safePocket', drive), true);
    assert.equal(slotAccepts('safePocket', stim), true);
    assert.equal(slotAccepts('safePocket', weapon), false, 'weapons forbidden in safe pocket');
    assert.equal(slotAccepts('safePocket', shield), false, 'armor forbidden in safe pocket');

    assert.equal(slotAccepts('stash', weapon), true);
    assert.equal(slotAccepts('backpack', weapon), true);
});

test('inventory: moving weapon from primary to stash leaves primary slot empty without re-equip', () => {
    const starter = createStarterInventory();
    const account = {
        credits: starter.credits,
        arcCores: starter.arcCores,
        loadout: starter.loadout,
        stash: starter.stash,
        inventoryVersion: 1
    };

    const weapon = account.loadout.primary;
    assert.ok(weapon);

    // Move primary weapon to stash
    const moveRes = validateAndMove(account, { area: 'primary' }, { area: 'stash', index: account.stash.length });
    assert.equal(moveRes.ok, true);
    assert.equal(account.loadout.primary, null, 'primary slot must be empty after moving to stash');
    assert.ok(account.stash.some(it => it.instId === weapon.instId), 'weapon must be in stash');
    assert.equal(account.inventoryVersion, 2);

    // Incompatible move attempt
    const badMove = validateAndMove(account, { area: 'stash', index: 0 }, { area: 'primary' });
    // If stash[0] was shotgun, it fits primary, but if we try moving a shield to primary:
    const shieldIdx = account.stash.findIndex(it => it.category === 'armor');
    const failMove = validateAndMove(account, { area: 'stash', index: shieldIdx }, { area: 'primary' });
    assert.equal(failMove.ok, false);
    assert.equal(failMove.error, 'slot-incompatible');
});

test('inventory: trader purchase validates funds, deducts currency and adds item with unique instId', () => {
    const starter = createStarterInventory();
    const account = {
        credits: 10000,
        arcCores: 2,
        loadout: starter.loadout,
        stash: starter.stash,
        inventoryVersion: 1
    };

    // Buy Tempest II from Marco (slotIndex 1, price 7500)
    const buyRes = executeTraderBuy(account, 'marco', 1);
    assert.equal(buyRes.ok, true);
    assert.equal(account.credits, 2500);
    assert.ok(buyRes.item);
    assert.equal(buyRes.item.name, 'TEMPEST II');
    assert.ok(account.stash.some(it => it.instId === buyRes.item.instId));

    // Not enough credits for another purchase
    const failBuy = executeTraderBuy(account, 'marco', 1);
    assert.equal(failBuy.ok, false);
    assert.equal(failBuy.error, 'not-enough-credits');
});

test('inventory: sell single item and sell junk in batch', () => {
    const starter = createStarterInventory();
    const account = {
        credits: 1000,
        arcCores: 1,
        loadout: starter.loadout,
        stash: starter.stash,
        inventoryVersion: 1
    };

    const initialCount = account.stash.length;
    const targetItem = account.stash[0];

    // Sell single item
    const sellRes = executeSell(account, { area: 'stash', index: 0 });
    assert.equal(sellRes.ok, true);
    assert.equal(account.credits, 1000 + targetItem.value);
    assert.equal(account.stash.length, initialCount - 1);
    assert.equal(account.stash.some(it => it.instId === targetItem.instId), false);

    // Sell junk batch
    const junkRes = executeSellJunk(account);
    assert.equal(junkRes.ok, true);
    assert.ok(junkRes.soldCount > 0);
    assert.ok(account.credits > 1000 + targetItem.value);
});

test('inventory: post-raid settlement preserves safe pocket and wipes lost gear on KIA', () => {
    const starter = createStarterInventory();
    const account = {
        credits: 1000,
        loadout: starter.loadout,
        stash: starter.stash,
        inventoryVersion: 1
    };

    const savedDrive = account.loadout.safePocket[0];
    assert.ok(savedDrive);

    // KIA raid result
    applyRaidInventory(account, { extracted: false, safePocket: account.loadout.safePocket, backpack: [] });

    assert.equal(account.loadout.primary, null, 'primary weapon wiped on KIA');
    assert.equal(account.loadout.secondary, null, 'secondary weapon wiped on KIA');
    assert.equal(account.loadout.shieldCore, null, 'shield wiped on KIA');
    assert.equal(account.loadout.safePocket[0].name, savedDrive.name, 'safe pocket preserved on KIA');
});

test('inventory HTTP API: full flow through server and RaidClient', async () => {
    const server = createGameServer({ accountsDir: null });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const Client = loadScripts(['js/RaidClient.js'], { fetch, AbortSignal }).get('RaidClient');

    try {
        const client = new Client(url);
        await client.register('InvTester', 'secret123');

        // 1. Get initial inventory
        const inv = await client.inventory();
        assert.equal(inv.credits, 0);
        assert.ok(inv.loadout.primary);
        assert.equal(inv.loadout.primary.name, 'TEMPEST II');

        // 2. Move primary weapon to stash
        const move = await client.moveInventoryItem({ area: 'primary' }, { area: 'stash', index: inv.stash.length });
        assert.equal(move.ok, true);
        assert.equal(move.loadout.primary, null);

        // 3. Confirm GET /inventory reflects empty primary
        const inv2 = await client.inventory();
        assert.equal(inv2.loadout.primary, null, 'server must persist unequipped primary weapon as null');

        // 4. Sell junk batch to obtain credits
        const junk = await client.sellJunk();
        assert.equal(junk.ok, true);
        assert.ok(junk.soldCount > 0);
        assert.ok(junk.credits >= 400);
        const initialCreds = junk.credits;

        // 5. Buy from trader
        const buy = await client.buyTraderItem('elena', 0); // combat stim x2, 350 CR
        assert.equal(buy.ok, true);
        assert.equal(buy.credits, initialCreds - 350);

        // 6. Sell item
        const boughtItem = buy.item;
        const sell = await client.sellInventoryItem(null, boughtItem.instId);
        assert.equal(sell.ok, true);
        assert.equal(sell.credits, initialCreds);
    } finally {
        await new Promise(r => { server.close(r); server.closeAllConnections(); });
    }
});
