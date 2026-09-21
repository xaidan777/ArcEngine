// tests/menu-system.test.mjs — Automated tests for MenuSystem engine module.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

const page = loadScripts([
    'js/Constants.js',
    'js/ShooterRules.js',
    'js/RaidRules.js',
    'js/UI.js',
    'js/UILayout.js',
    'js/MenuSystem.js'
], { BABYLON: stub(), document: {}, addEventListener() {}, removeEventListener() {} });

const MenuSystem = page.get('MenuSystem');
const UI = page.get('UI');

test('operator and logbook stay visible and show distinct content from server stats', () => {
    const originalGet = UI.get;
    const originalGame = MenuSystem.game;
    const originalOnline = MenuSystem.onlineLobby;
    const records = new Map();
    UI.get = id => {
        if (!records.has(id)) records.set(id, {
            shown: false, text: '',
            show(value) { this.shown = value; return this; },
            setText(value) { this.text = value; return this; },
            setDisabled() { return this; }, setSelected() { return this; }
        });
        return records.get(id);
    };
    try {
        MenuSystem.game = { lang: 'ru', c: { lootTarget: 3 }, mechanics: { slots: 6 }, profile: { raids: 999, extractions: 999 } };
        MenuSystem.onlineLobby = { authenticated: true, client: { account: { name: 'ServerRaider', credits: 0, stats: { raids: 8, extractions: 3, kills: 4, deaths: 5 } } } };
        MenuSystem.currentScreen = 'RAIDER';
        MenuSystem.refreshPresentation();
        assert.equal(records.get('careerDetails').shown, true);
        assert.match(records.get('careerDetails').text, /ОСНОВНОЕ ОРУЖИЕ/);
        assert.equal(records.get('currencyTag').text, '0 CR');
        const operatorText = records.get('careerDetails').text;
        MenuSystem.currentScreen = 'DECKS';
        MenuSystem.refreshPresentation();
        assert.equal(records.get('careerDetails').shown, true);
        assert.notEqual(records.get('careerDetails').text, operatorText);
        assert.match(records.get('careerDetails').text, /РЕЙДЫ\n8/);
        assert.doesNotMatch(records.get('careerDetails').text, /999/);
    } finally {
        UI.get = originalGet;
        MenuSystem.game = originalGame;
        MenuSystem.onlineLobby = originalOnline;
        MenuSystem.currentScreen = 'HUB';
    }
});

test('online economy never applies local purchases or sales', () => {
    const previous = MenuSystem.onlineLobby;
    MenuSystem.onlineLobby = { authenticated: true };
    const before = JSON.stringify([MenuSystem.profile, MenuSystem.stash]);
    MenuSystem.buyTraderItem(0);
    MenuSystem.sellSelectedItem();
    MenuSystem.sellAllStash();
    MenuSystem.sellJunkStash();
    assert.equal(JSON.stringify([MenuSystem.profile, MenuSystem.stash]), before);
    MenuSystem.onlineLobby = previous;
});

test('MenuSystem initialization and default screens', () => {
    const mockApp = { location: { view: { scene: stub(), world: { canvas: {} } } }, camera: { setMovementEnabled: () => {}, azimuth: 0, pitch: 0, distance: 0 } };
    const mockGame = { reset: () => {}, deploy: () => {}, keys: new Set(), lang: 'en',
        profile: page.get('ShooterRules').sanitizeMeta({ credits: 250 }),
        c: { mag: 20, reserveAmmo: 60, hp: 100, lootTarget: 3, inboundSec: 15, extractSec: 6 },
        mechanics: { slots: 6 }, settings: { quality: 2, sensitivity: 1 } };

    MenuSystem.init(mockApp, mockGame);

    assert.equal(MenuSystem.currentScreen, 'HUB');
    assert.equal(MenuSystem.profile.name, 'Raider');
    assert.ok(Array.isArray(MenuSystem.stash));
    assert.ok(MenuSystem.stash.length > 0);
});

test('MenuSystem screen state transitions', () => {
    MenuSystem.setScreen('WORKSHOP');
    assert.equal(MenuSystem.currentScreen, 'WORKSHOP');

    MenuSystem.setScreen('RAIDER');
    assert.equal(MenuSystem.currentScreen, 'RAIDER');

    MenuSystem.setScreen('INVENTORY');
    assert.equal(MenuSystem.currentScreen, 'INVENTORY');

    MenuSystem.setScreen('MAP_SELECT');
    assert.equal(MenuSystem.currentScreen, 'MAP_SELECT');

    MenuSystem.handleBack();
    assert.equal(MenuSystem.currentScreen, 'HUB');
});

test('MenuSystem stash item selling and loadout equipping', () => {
    const initialCredits = MenuSystem.profile.credits;
    const initialStashCount = MenuSystem.stash.length;
    const targetItem = MenuSystem.stash[0];

    MenuSystem.selectedItem = targetItem;
    MenuSystem.sellSelectedItem();

    assert.equal(MenuSystem.stash.length, initialStashCount - 1);
    assert.equal(MenuSystem.profile.credits, initialCredits + targetItem.value);
});

test('MenuSystem equips weapon, shield, and consumables from stash', () => {
    MenuSystem.setupDefaultCatalog();
    const weaponInStash = MenuSystem.stash.find(s => s.category === 'weapons');
    assert.ok(weaponInStash, 'Should have weapon in stash');
    const oldPrimary = MenuSystem.loadout.primary;

    MenuSystem.selectedItem = weaponInStash;
    MenuSystem.equipSelectedItem();

    assert.equal(MenuSystem.loadout.primary.id, weaponInStash.id);
    assert.ok(MenuSystem.stash.some(s => s.id === oldPrimary.id));

    const shieldInStash = MenuSystem.stash.find(s => s.category === 'armor' || s.shieldHp);
    if (shieldInStash) {
        MenuSystem.selectedItem = shieldInStash;
        MenuSystem.equipSelectedItem();
        assert.equal(MenuSystem.loadout.shieldCore.id, shieldInStash.id);
    }
});

test('MenuSystem raider customization toggles', () => {
    const initialGoggles = MenuSystem.customization.goggles;
    MenuSystem.customization.goggles = !initialGoggles;
    MenuSystem.saveState();

    assert.equal(MenuSystem.customization.goggles, !initialGoggles);
});

test('MenuSystem raid completion never duplicates settled credits or demo backpack loot', () => {
    MenuSystem.backpack = [
        { id: 'ext1', name: 'RARE DATA DRIVE', category: 'materials', count: 1, value: 5000 }
    ];

    const countBefore = MenuSystem.stash.length;
    MenuSystem.game.phase = 'won';
    MenuSystem.game.profile.credits = 2750;
    MenuSystem.finishRaid({ extracted: true, credits: 2500 });

    assert.equal(MenuSystem.stash.length, countBefore);
    assert.equal(MenuSystem.game.profile.credits, 2750);
    // A successful raid lands on the settlement screen (RETURN), a failed one on the hub.
    // The assertion here is about the SCREEN being a terminal, settled screen -- the point of
    // this test is that the credits below are not awarded twice.
    assert.ok(['HUB', 'RETURN'].includes(MenuSystem.currentScreen),
        'expected a post-raid screen, got ' + MenuSystem.currentScreen);
    MenuSystem.finishRaid({ extracted: true, credits: 2500 });
    assert.equal(MenuSystem.game.profile.credits, 2750);
});

test('MenuSystem cannot leave an active raid through menu navigation', () => {
    MenuSystem.currentScreen = 'IN_RAID'; MenuSystem.game.phase = 'raid';
    MenuSystem.setScreen('WORKSHOP');
    assert.equal(MenuSystem.currentScreen, 'IN_RAID');
    assert.equal(MenuSystem.game.phase, 'raid');
    MenuSystem.game.phase = 'lost'; MenuSystem.finishRaid({ dead: true });
    assert.equal(MenuSystem.currentScreen, 'HUB');
    assert.equal(MenuSystem.game.phase, 'menu');
});

test('MenuSystem switches traders and purchases items from active trader stock', () => {
    MenuSystem.setScreen('TRADERS');
    assert.equal(MenuSystem.currentScreen, 'TRADERS');

    // Switch to Dr. Elena
    MenuSystem.activeTraderId = 'elena';
    MenuSystem.profile.credits = 1000;
    MenuSystem.profile.arcCores = 0;
    MenuSystem.game.profile.credits = 1000;
    const stashCountBefore = MenuSystem.stash.length;

    // Elena item 0 is COMBAT STIM (price 350)
    MenuSystem.buyTraderItem(0);

    assert.equal(MenuSystem.profile.credits, 650);
    assert.equal(MenuSystem.game.profile.credits, 650);
    assert.equal(MenuSystem.stash.length, stashCountBefore + 1);
    assert.equal(MenuSystem.stash[MenuSystem.stash.length - 1].category, 'consumables');
});

test('MenuSystem sellJunkStash sells scrap and keeps rare cores intact', () => {
    MenuSystem.profile.credits = 1000;
    MenuSystem.stash = [
        { id: 'w1', name: 'TEMPEST II', category: 'weapons', value: 5000 },
        { id: 'j1', name: 'SCRAP METAL', category: 'materials', value: 300 },
        { id: 'j2', name: 'BROKEN WIRES', category: 'materials', value: 150 },
        { id: 'c1', name: 'ARC MEMORY CORE', category: 'materials', type: 'core', rarity: 'Legendary', value: 6500 }
    ];

    MenuSystem.sellJunkStash();

    // 300 + 150 = 450 credits earned
    assert.equal(MenuSystem.profile.credits, 1450);
    assert.equal(MenuSystem.stash.length, 2);
    assert.ok(MenuSystem.stash.some(s => s.id === 'w1'), 'Weapon preserved');
    assert.ok(MenuSystem.stash.some(s => s.id === 'c1'), 'Legendary core preserved');
});
