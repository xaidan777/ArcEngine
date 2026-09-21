import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';
const Screen = loadScripts(['js/LoadoutScreen.js']).get('LoadoutScreen');
const setup = () => {
    const screen = Object.create(Screen.prototype);
    screen.menu = { stash: [], backpack: Array(3).fill(null), loadout: { primary: null, secondary: null, shieldCore: null, augment: null, quickSlots: Array(2).fill(null), safePocket: [null] }, saveState() {} };
    screen.render = () => {};
    screen.filter = 'all';
    return screen;
};
test('automatic destinations prefer compatible equipment, then free storage; never overwrite', () => {
    const s = setup();
    const weapon = { category: 'weapons' };
    assert.equal(s.autoTarget(weapon).area, 'primary');
    s.menu.loadout.primary = weapon;
    assert.equal(s.autoTarget(weapon).area, 'secondary');
    s.menu.loadout.secondary = weapon;
    assert.equal(s.autoTarget(weapon).area, 'backpack');
    assert.equal(s.autoTarget({ category: 'augment' }).area, 'augment');
    assert.equal(s.autoTarget({ category: 'shields' }).area, 'shieldCore');
    assert.equal(s.autoTarget({ category: 'consumables' }).area, 'quickSlots');
    s.menu.backpack.fill(weapon);
    assert.equal(s.autoTarget(weapon), null);
});
test('clicking augment filters compatible objects, excluding weapon mods; quick move targets that slot', () => {
    const s = setup();
    const augment = { id: 'a', slotType: 'augment', category: 'equipment' };
    const old = { id: 'old', category: 'augment' };
    s.menu.loadout.augment = old;
    s.menu.stash = [augment];
    s.selectTarget({ area: 'augment', index: 0 });
    assert.equal(s.filter, 'mods');
    assert.equal(s.matchesFilter(augment), true);
    assert.equal(s.matchesFilter({ category: 'attachments' }), false);
    assert.equal(s.quickMove({ area: 'stash', index: 0 }), true);
    assert.equal(s.menu.loadout.augment, augment);
    assert.equal(s.menu.stash[0], old);
});
test('drop on a broad region chooses a free slot and stale drags cannot transfer', () => {
    const s = setup();
    const ammo = { category: 'ammo' };
    s.menu.stash = [ammo];
    s.drag = { ref: { area: 'stash', index: 0 }, item: ammo };
    const region = { closest(selector) { return selector === '[data-drop-area]' ? { dataset: { dropArea: 'backpack' } } : null; } };
    assert.equal(s.dropTarget(region).index, 0);
    s.menu.backpack[0] = ammo;
    assert.equal(s.dropTarget(region).index, 1);
    s.menu.stash[0] = { category: 'materials' };
    assert.equal(s.dropTarget(region), null);
});
test('returning to stash keeps selection pointed at compacted destination', () => {
    const s = setup();
    const item = { category: 'weapons' };
    s.menu.loadout.primary = item;
    s.menu.stash = [null];
    s.move({ area: 'primary' }, { area: 'stash', index: 1 });
    assert.equal(s.item(s.selected.ref), item);
});
