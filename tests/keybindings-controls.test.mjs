// tests/keybindings-controls.test.mjs — Unit tests for KeyBindings, ControlsMenu, and Looting integration.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

// Mock localStorage for Store
const storage = new Map();
const mockLocalStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
};

const page = loadScripts([
    'js/Constants.js',
    'js/ShooterRules.js',
    'js/RaidRules.js',
    'js/KeyBindings.js',
    'js/ControlsMenu.js',
    'js/RaidInventory.js',
    'js/UI.js',
    'js/UILayout.js'
], {
    BABYLON: stub(),
    localStorage: mockLocalStorage,
    window: {
        localStorage: mockLocalStorage,
        addEventListener: () => {},
        removeEventListener: () => {}
    },
    document: {
        body: {
            appendChild: () => {},
            removeChild: () => {}
        },
        getElementById: () => null,
        createElement: (tag) => {
            const el = {
                tagName: tag.toUpperCase(),
                id: '',
                className: '',
                style: {},
                children: [],
                innerHTML: '',
                textContent: '',
                appendChild: (child) => { el.children.push(child); return child; },
                removeChild: (child) => {
                    const idx = el.children.indexOf(child);
                    if (idx !== -1) el.children.splice(idx, 1);
                    return child;
                },
                querySelectorAll: () => [],
                querySelector: () => null,
                addEventListener: () => {},
                removeEventListener: () => {}
            };
            return el;
        },
        exitPointerLock: () => {}
    },
    addEventListener: () => {},
    removeEventListener: () => {}
});

const KeyBindings = page.get('KeyBindings');
const ControlsMenu = page.get('ControlsMenu');
const RaidRules = page.get('RaidRules');
const RaidInventory = page.get('RaidInventory');

test('KeyBindings default configuration decouples lean from interact', () => {
    KeyBindings.resetDefaults();
    assert.equal(KeyBindings.get('leanLeft'), 'KeyQ');
    assert.equal(KeyBindings.get('leanRight'), 'KeyE');
    assert.equal(KeyBindings.get('interact'), 'KeyF');
    assert.equal(KeyBindings.get('inventory'), 'Tab');
    assert.equal(KeyBindings.get('map'), 'KeyM');
    assert.equal(KeyBindings.isAction('KeyQ', 'leanLeft'), true);
    assert.equal(KeyBindings.isAction('KeyE', 'leanRight'), true);
    assert.equal(KeyBindings.isAction('KeyF', 'interact'), true);
    // E is no longer interact by default!
    assert.equal(KeyBindings.isAction('KeyE', 'interact'), false);
});

test('KeyBindings rebinding, conflict swapping, and persistence', () => {
    KeyBindings.resetDefaults();
    let changeNotified = false;
    const unsub = KeyBindings.onChange(() => { changeNotified = true; });

    // Rebind interact to KeyE (swapping leanRight to KeyF)
    KeyBindings.set('interact', 'KeyE');
    assert.equal(changeNotified, true);
    assert.equal(KeyBindings.get('interact'), 'KeyE');
    assert.equal(KeyBindings.get('leanRight'), 'KeyF');

    // Reload from persistent storage
    KeyBindings.init();
    assert.equal(KeyBindings.get('interact'), 'KeyE');
    assert.equal(KeyBindings.get('leanRight'), 'KeyF');

    // Reset defaults restores F for interact and E for leanRight
    KeyBindings.resetDefaults();
    assert.equal(KeyBindings.get('interact'), 'KeyF');
    assert.equal(KeyBindings.get('leanRight'), 'KeyE');
    unsub();
});

test('KeyBindings human-readable labels in RU and EN', () => {
    KeyBindings.resetDefaults();
    assert.equal(KeyBindings.getKeyLabel('interact', 'ru'), 'F');
    assert.equal(KeyBindings.getKeyLabel('interact', 'en'), 'F');
    assert.equal(KeyBindings.formatKey('Space', 'ru'), 'ПРОБЕЛ');
    assert.equal(KeyBindings.formatKey('Space', 'en'), 'SPACE');
    assert.equal(KeyBindings.formatKey('ShiftLeft', 'ru'), 'L-SHIFT');
});

test('ControlsMenu open, isOpen state, and close', () => {
    const mockGame = {
        lang: 'ru',
        playSound: () => {},
        updateHud: () => {},
        updateTacticalHud: () => {}
    };

    assert.equal(ControlsMenu.isOpen(), false);
    ControlsMenu.open(mockGame);
    assert.equal(ControlsMenu.isOpen(), true);
    ControlsMenu.close();
    assert.equal(ControlsMenu.isOpen(), false);
});

test('Raid inventory container looting logic', () => {
    const inv = new RaidInventory();
    const container = {
        id: 101,
        opened: false,
        item: {
            id: 'arc_core_green',
            name: 'ARC Memory Module',
            nameRu: 'Модуль памяти ARC',
            type: 'material',
            category: 'loot',
            value: 450,
            weight: 0.8
        }
    };

    const mockGame = {
        lang: 'ru',
        backpack: Array(18).fill(null),
        raidValue: 0,
        totalWeight: 10,
        encumbrance: { id: 'light' },
        playSound: () => {},
        showLootFeed: () => {},
        updateHud: () => {}
    };

    inv.game = mockGame;
    inv.targetContainer = container;
    inv.render = () => {};
    inv.takeAllFromContainer();

    assert.equal(container.opened, true);
    assert.equal(container.item, null);
    assert.equal(mockGame.backpack[0].id, 'arc_core_green');
    assert.equal(mockGame.raidValue, 450);
});
