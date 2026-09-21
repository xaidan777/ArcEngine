import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

test('one Tab opens loadout and a second Tab closes it without double handling', () => {
    const listeners = [];
    const page = loadScripts(['js/Constants.js', 'js/MenuSystem.js', 'js/LoadoutScreen.js'], {
        UI: { get() { return null; } },
        document: { createElement() { return { hidden: true, addEventListener() {}, remove() {} }; }, body: { appendChild() {} } },
        addEventListener(type, fn) { if (type === 'keydown') listeners.push(fn); },
        removeEventListener() {}
    });
    const menu = page.get('MenuSystem');
    menu.game = { phase: 'menu' };
    menu.bindEvents();
    const screen = new (page.get('LoadoutScreen'))(menu);
    menu.setScreen = value => { menu.currentScreen = value; screen.root.hidden = value !== 'INVENTORY'; };
    const press = key => {
        const event = { key, preventDefault() {}, target: { matches() { return false; } } };
        for (const handler of listeners) handler(event);
    };
    press('Tab');
    assert.equal(menu.currentScreen, 'INVENTORY');
    assert.equal(screen.root.hidden, false);
    press('Tab');
    assert.equal(menu.currentScreen, 'HUB');
    press('Tab');
    press('Escape');
    assert.equal(menu.currentScreen, 'HUB');
    menu.setScreen('RETURN');
    press('Tab');
    assert.equal(menu.currentScreen, 'RETURN', 'inventory cannot interrupt settlement presentation');
});
