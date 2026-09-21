// tests/loot-interaction.test.mjs — container search reach, loot capacity and the in-raid
// inventory capacity rule. These are the rules behind the reported "backpack full" and
// "cannot search the crate" bugs, so they are pinned here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const scripts = loadScripts([
    'js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js', 'js/Game.js', 'js/RaidInventory.js'
], {
    document: {},
    UI: { get: () => null, add: () => null, remove: () => {} }
});
const rules = scripts.get('RaidRules');
const Game = scripts.get('Game');
const RaidInventory = scripts.get('RaidInventory');

// A crate as the game builds it: collision radius 34, search radius 48, in its own cover set.
function crate(overrides = {}) {
    return Object.assign({
        id: 0, x: 500, y: 500, radius: 48, height: 50,
        opened: false, item: { type: 'intel', value: 120, label: ['Разведданные', 'Intel'] }
    }, overrides);
}

function game() {
    const g = Object.create(Game.prototype);
    Object.assign(g, {
        phase: 'raid', paused: false, player: { x: 0, y: 0, radius: 24, hp: 100, maxHp: 100 },
        keys: new Set(), touchMove: {}, backpack: Array(18).fill(null), raidValue: 0, loot: 0,
        containers: [], coverBlockers: [], enemies: [], visuals: [], effects: [],
        updateHud() {}, playSound() {}, showLootFeed() {}
    });
    g.c = { searchSec: 1.2, radius: 24 };
    g.mechanics = Object.assign(g.readMechanics(), { slots: 18, interactRange: 70 });
    return g;
}

test('a crate is searchable from anywhere inside the interact range around it', () => {
    const box = crate();
    // The crate carries its own footprint, so the reach is range + crate radius measured
    // edge to edge: with range 70 and radius 48 a player standing 110 px away still reaches.
    const blockers = [{ x: box.x, y: box.y, radius: 34, height: 50 }];
    for (const dist of [0, 20, 40, 60, 70, 90, 110, 118]) {
        const player = { x: box.x + dist, y: box.y, radius: 24 };
        assert.equal(rules.canSearch(player, box, blockers, 70), true,
            `a crate must be searchable from ${dist} px away`);
    }
    assert.equal(rules.canSearch({ x: box.x + 130, y: box.y, radius: 24 }, box, blockers, 70), false,
        'beyond crate radius + interact range the crate is out of reach');
});

test('a searched crate stays unsearchable and a crate behind cover is blocked', () => {
    const box = crate();
    const player = { x: box.x, y: box.y + 60, radius: 24 };
    assert.equal(rules.canSearch(player, crate({ opened: true }), [], 70), false,
        'an opened container cannot be searched twice');
    const tank = { x: box.x, y: box.y + 40, radius: 60, height: 300 };
    assert.equal(rules.canSearch(player, box, [tank], 70), false,
        'a container behind a real obstacle cannot be searched through it');
});

test('the crate itself never blocks line of sight to the crate', () => {
    const box = crate();
    // The engine registers the crate footprint in the same cover set the search tests.
    const blockers = [{ x: box.x, y: box.y, radius: 34, height: 50 }];
    assert.equal(rules.canSearch({ x: box.x, y: box.y + 55, radius: 24 }, box, blockers, 70), true,
        'a container cannot occlude itself');
    // A different crate sharing the spawn is the same container record and must be ignored too.
    const twin = { x: box.x, y: box.y, radius: 34, height: 50 };
    assert.equal(rules.canSearch({ x: box.x, y: box.y + 55, radius: 24 }, box, [twin], 70), true,
        'a duplicate footprint at the same spot is the same container');
});

test('loot capacity is counted in looted items, not in padded grid cells', () => {
    const g = game();
    assert.equal(g.lootCapacity(), 18, 'GAME_BACKPACK_SLOTS is the loot capacity');
    assert.equal(g.lootedItems(), 0);
    assert.equal(g.backpackIsFull(), false, 'a padded 18-cell grid is not a full backpack');

    for (let i = 0; i < 18; i++) g.noteLootTaken();
    assert.equal(g.backpackIsFull(), true);
    assert.equal(g.lootedItems(), 18);
    // The grid is still all empty: the old rule read `backpack.length` and called this full
    // with nothing looted at all.
    assert.equal(g.backpack.filter(Boolean).length, 0);
});

test('the in-raid inventory enforces the same loot capacity as the HUD', () => {
    const g = game();
    const inv = new RaidInventory();
    inv.game = g;
    assert.equal(inv.backpackCapacity(), 18);
    assert.equal(inv.backpackCount(), 0);
    inv.targetContainer = crate();
    inv.container = { innerHTML: '', style: {} };
    inv.visible = false;

    // Six items may be taken; the seventh is refused and the crate stays searchable.
    for (let i = 0; i < 18; i++) {
        inv.targetContainer = crate({ id: i, item: { type: 'intel', value: 120 } });
        inv.takeAllFromContainer();
        assert.equal(inv.backpackCount(), i + 1);
    }
    assert.equal(inv.backpackCapacity(), inv.backpackCount(), 'the bag is now at capacity');
    const full = crate({ id: 99 });
    inv.targetContainer = full;
    inv.takeAllFromContainer();
    assert.equal(inv.backpackCount(), 18, 'no nineteenth item is taken');
    assert.equal(full.item !== null, true, 'the refused crate keeps its contents');
    assert.equal(full.opened, false, 'a refused crate stays searchable');
});

test('a full bag can still be reorganised', () => {
    const g = game();
    g.backpack[0] = { type: 'intel', value: 120 };
    g.lootedCount = 18;
    const inv = new RaidInventory();
    inv.game = g;
    assert.equal(inv.accepts({ area: 'backpack', index: 0 }, { type: 'intel' }), true,
        'swapping into an occupied cell does not raise the count');
    assert.equal(inv.accepts({ area: 'backpack', index: 5 }, { type: 'intel' }), false,
        'adding into an empty cell past the capacity is refused');
});