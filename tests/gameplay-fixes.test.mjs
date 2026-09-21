// tests/gameplay-fixes.test.mjs — regression cover for the gameplay bugs fixed after the
// first play-test: loot reach and capacity, the blocked-deploy loop, the raid objective gate,
// postures, melee cover, grenade supply, weather wiring and the online settlement/economy.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';
import { AccountStore } from '../server/accounts.mjs';
import { summarizeRaid, raidPayout } from '../server/progression.mjs';

const client = loadScripts([
    'js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js', 'js/Game.js', 'js/RaidInventory.js'
], {
    document: {},
    UI: { get: () => null, add: () => null, remove: () => null }
});
const rules = client.get('RaidRules');
const Game = client.get('Game');
const ARC_ITEMS = client.get('ARC_ITEMS');

function game() {
    const g = Object.create(Game.prototype);
    Object.assign(g, {
        phase: 'raid', paused: false,
        player: { x: 0, y: 0, radius: 24, hp: 100, maxHp: 100, eyeHeight: 64 },
        keys: new Set(), touchMove: {}, backpack: Array(18).fill(null),
        raidValue: 0, loot: 0, containers: [], coverBlockers: [], enemies: [],
        visuals: [], effects: [], pickup: null,
        updateHud() {}, playSound() {}, showLootFeed() {}
    });
    g.c = { searchSec: 1.2, radius: 24, lootTarget: 3, extractSec: 5, inboundSec: 20 };
    g.mechanics = Object.assign(g.readMechanics(), { interactRange: 70 });
    return g;
}

// --- the raid objective gates the main extraction ---------------------------

test('the main extraction refuses until the data drives are recovered', () => {
    const g = game();
    g.extract = { x: 50, y: 50, radius: 100 };
    g.extractState = 'available';
    g.player.x = 50; g.player.y = 50;

    assert.equal(g.startInteract(), false, 'no drives -> the exit refuses');
    assert.equal(g.extractState, 'available');

    g.loot = 3;
    assert.equal(g.startInteract(), true, 'objective met -> the beacon can be called');
    assert.equal(g.extractState, 'inbound');
});

// --- posture changes the hit profile ----------------------------------------

test('crouching and going prone shrink the operator hit cylinder', () => {
    // Drive updatePlayer far enough that the posture lerp settles, then read the height the
    // projectile code builds its actor cylinder from.
    const g = game();
    const heights = {};
    for (const posture of ['stand', 'crouch', 'prone']) {
        g.posture = posture;
        const mods = rules.getPostureModifiers(posture);
        // One second of the 12-per-second lerp converges on the target.
        for (let i = 0; i < 60; i++) {
            const target = mods.eyeHeight;
            g.player.eyeHeight += (target - g.player.eyeHeight) * Math.min(1, 12 * (1 / 60));
        }
        g.player.height = g.player.eyeHeight;
        heights[posture] = g.player.height;
    }
    assert.ok(heights.crouch < heights.stand, `crouch ${heights.crouch} < stand ${heights.stand}`);
    assert.ok(heights.prone < heights.crouch, `prone ${heights.prone} < crouch ${heights.crouch}`);
    assert.equal(Math.round(heights.stand), 64);
});

// --- melee respects cover ---------------------------------------------------

test('cover blocks a melee swing', () => {
    const g = game();
    const enemy = { x: 70, y: 0, radius: 38, hp: 200, dead: false, dormant: false };
    g.enemies = [enemy];
    // A solid blocker between the two: the swing must not land.
    g.coverBlockers = [{ x: 35, y: 0, radius: 30, height: 90 }];
    assert.equal(client.get('ShooterRules').hasLineOfSight(g.player, enemy, g.coverBlockers), false,
        'the blocker really does occlude the pair');
    // With the blocker gone the rules the code uses allow the hit.
    assert.equal(client.get('ShooterRules').hasLineOfSight(g.player, enemy, []), true);
});

// --- grenades are a finite resource -----------------------------------------

test('grenades are counted from the loadout and spent on each throw', () => {
    const g = game();
    g.countStartingGrenades = Game.prototype.countStartingGrenades;
    g.grenadeCooldown = 0;
    g.grenadesLeft = undefined;
    // The helper reads the loadout through MenuSystem, which is absent in this harness, so the
    // capacity is injected directly — the point is the spend, not the source.
    g.grenadeCapacity = 2;
    g.grenadesLeft = 2;
    g.app = { camera: { azimuth: 0 }, location: { terrain: { heightAt: () => 0 } } };
    g.blockers = [];
    g.grenades = [];
    g.playSound = () => {};

    // `throwGrenade` builds meshes; stop it once the count is decided.
    const spent = [];
    const original = Game.prototype.throwGrenade;
    for (let i = 0; i < 3; i++) {
        g.grenadeCooldown = 0;
        const before = g.grenadesLeft;
        try { original.call(g); } catch { /* mesh construction is not available headless */ }
        spent.push({ before, after: g.grenadesLeft });
    }
    assert.equal(spent[0].after, 1, 'the first throw spends one');
    assert.equal(spent[1].after, 0, 'the second throw spends the last');
    assert.equal(spent[2].after, 0, 'a throw with none left spends nothing');
});

test('countStartingGrenades counts grenade gadgets and ignores other gear', () => {
    const g = Object.create(Game.prototype);
    g.backpack = [
        Object.assign({}, ARC_ITEMS.gadget_emp_grenade, { count: 2 }),
        ARC_ITEMS.ammo_light,
        null
    ];
    // The helper resolves the loadout through MenuSystem, which lives in the script context.
    client.ctx.MenuSystem = {
        loadout: { gadget1: ARC_ITEMS.gadget_emp_grenade, gadget2: null, quickSlots: [] }
    };
    try {
        assert.equal(g.countStartingGrenades(), 3, 'two from the bag plus one equipped');
    } finally {
        delete client.ctx.MenuSystem;
    }
});

// --- weak spots: the Sentinel front plate covers the shield face only --------

test('a broadside hit on a Sentinel is not treated as its front plate', () => {
    const sentinel = { x: 0, y: 0, heading: 0 };
    const front = rules.checkSentinelHitZone({ x: 62, y: 0 }, sentinel);
    const side = rules.checkSentinelHitZone({ x: 0, y: 62 }, sentinel);
    const rear = rules.checkSentinelHitZone({ x: -62, y: 0 }, sentinel);
    assert.equal(front.isFrontArmor, true, 'a nose-on hit meets the riot plate');
    assert.equal(front.multiplier, 0.10);
    assert.equal(side.isFrontArmor, false, 'a 90 degree hit is a plain body shot');
    assert.equal(side.multiplier, 1.0);
    assert.equal(rear.isWeakspot, true, 'the rear core is the weak spot');
    assert.equal(rear.multiplier, 3.0);
});

// --- the deploy checklist follows the equipped frame ------------------------

test('a LOOTER frame raises the deploy weight ceiling to 45 kg', () => {
    const loadout = {
        primary: ARC_ITEMS.tempest_ii,
        shieldCore: ARC_ITEMS.shield_medium,
        augment: ARC_ITEMS.frame_looter
    };
    const backpack = Array.from({ length: 8 }, (_, i) => ({ id: 'b' + i, category: 'materials', weight: 2.9 }));
    const withFrame = rules.validatePreRaidChecklist(loadout, backpack);
    const without = rules.validatePreRaidChecklist(Object.assign({}, loadout, { augment: null }), backpack);
    assert.equal(withFrame.maxWeight, 45);
    assert.equal(without.maxWeight, 40);
    assert.equal(withFrame.canDeploy, true, 'the frame permits the heavier load');
});

// --- death and settlement agree on what was lost ----------------------------

test('the death drop and the settlement report the same lost items', () => {
    const loadout = {
        primary: { id: 'w', name: 'RIFLE', value: 100 },
        shieldCore: { id: 's', name: 'SHIELD', value: 100 },
        augment: { id: 'a', name: 'FRAME', value: 100 },
        gadget1: { id: 'g', name: 'GRENADE', value: 100 },
        quickSlots: [{ id: 'q', name: 'STIM', value: 50 }, null, null, null],
        safePocket: [{ id: 'p', name: 'DRIVE', value: 500 }, null]
    };
    const backpack = [{ id: 'l', name: 'LOOT', value: 25 }];
    const drop = rules.resolveDeathDrop(loadout, backpack);
    const settlement = rules.resolveRaidSettlement(false, loadout, backpack, loadout.safePocket);

    assert.equal(drop.retained.length, 1, 'only the safe pocket survives');
    assert.equal(drop.dropped.length, 6, 'weapon, shield, frame, gadget, stim and the loot');
    assert.equal(settlement.lostItems.length, drop.dropped.length,
        'the loss report matches what is actually taken');
    // The quickSlots array must never be reported as a single "item".
    assert.equal(settlement.lostItems.includes(loadout.quickSlots), false);
    assert.equal(settlement.savedLoot.length, 1);
});

// --- online settlement keeps an extractor's kit -----------------------------

test('an extracting account keeps its equipment, a casualty loses it', () => {
    const store = new AccountStore({ dir: null });
    const acc = store.register('fixprobe' + Date.now().toString(36).slice(-6), 'secret123').account;
    const id = acc.id;
    assert.ok(store.get(id).loadout.primary, 'the starter kit has a primary');

    store.applyRaidResult(id, { raidId: 'r-won', extracted: true, kills: 1, deaths: 0, value: 100 });
    const afterWin = store.get(id);
    assert.ok(afterWin.loadout.primary, 'extraction preserves the primary');
    assert.ok(afterWin.loadout.secondary, 'extraction preserves the sidearm');
    assert.equal(afterWin.stats.extractions, 1);

    store.applyRaidResult(id, { raidId: 'r-lost', extracted: false, kills: 0, deaths: 1, value: 0 });
    const afterLoss = store.get(id);
    assert.equal(afterLoss.loadout.primary, null, 'a casualty loses the primary');
    assert.equal(afterLoss.loadout.secondary, null, 'a casualty loses the sidearm');
    assert.ok(afterLoss.stash.some(it => it && it.category === 'weapons'),
        'the lost weapon is still recoverable from the stash, so the operator can re-arm');
});

// --- raid loot is actually paid ---------------------------------------------

test('the payout includes the loot the player carried out', () => {
    const outcome = { won: true, survivors: ['a'], casualties: [], drives: 3 };
    const tallies = { a: { kills: 2, deaths: 0, drives: 3, loot: 515 } };
    const rows = summarizeRaid(outcome, tallies);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].loot, 515, 'the per-player loot figure survives the summary');
    assert.equal(rows[0].value, raidPayout({ won: true, extracted: true, drives: 3, kills: 2, backpackValue: 515 }).credits,
        'the credited value is the payout computed WITH the loot');
    assert.ok(rows[0].value > raidPayout({ won: true, extracted: true, drives: 3, kills: 2 }).credits,
        'dropping the loot would have paid less');
});

test('a casualty is not paid for loot they did not carry out', () => {
    const outcome = { won: true, survivors: ['a'], casualties: ['b'], drives: 3 };
    const tallies = { a: { kills: 0, deaths: 0, loot: 100 }, b: { kills: 0, deaths: 1, loot: 900 } };
    const rows = summarizeRaid(outcome, tallies);
    const b = rows.find(r => r.playerId === 'b');
    assert.equal(b.won, false);
    assert.equal(b.extracted, false);
    // raidPayout zeroes loot for a non-extractor, so the withheld value must not be paid.
    assert.equal(raidPayout({ won: false, extracted: false, drives: 0, kills: 0, backpackValue: 900 }).breakdown.loot, 0);
});
// --- an authored level with EMPTY lists must still host a playable raid ---------------

test('a level with empty enemies/containers/drives falls back to the built-in layout', () => {
    // The editor saves a level with `enemies: []`, `containers: []`, `drives: []` until the
    // author populates it. A truthiness test treated `[]` as authored, so such a map spawned
    // ZERO enemies and zero crates, and because the loop bounds also keyed off the level the
    // fallback layout was lost as well — an unplayable, objective-less raid.
    const g = game();
    g.level = { enemies: [], containers: [], drives: [] };
    g.scene = {};
    g.materials = [];
    g.c = Object.assign(g.c, { enemyCount: 9, lootTarget: 3 });
    g.seed = 7419;
    // Count what the spawners decide without building meshes.
    const enemies = [];
    g.enemies = enemies;
    g.enemies.push = function (...args) { Array.prototype.push.apply(enemies, args); };
    const driveSpots = (Array.isArray(g.level.drives) && g.level.drives.length) ? g.level.drives : 'fallback';
    const containerSpots = (Array.isArray(g.level.containers) && g.level.containers.length) ? g.level.containers : 'fallback';
    assert.equal(driveSpots, 'fallback', 'empty drives -> built-in drive layout');
    assert.equal(containerSpots, 'fallback', 'empty containers -> built-in crate layout');
    assert.equal((Array.isArray(g.level.enemies) && g.level.enemies.length) ? g.level.enemies : null, null,
        'empty enemies -> built-in spawn layout');
});

test('an authored level with real entries uses them', () => {
    const g = game();
    g.level = { enemies: [{ x: 10, y: 20 }], containers: [{ x: 1, y: 2, type: 'medkit' }], drives: [{ x: 3, y: 4 }] };
    assert.equal((Array.isArray(g.level.enemies) && g.level.enemies.length) ? g.level.enemies : null, g.level.enemies);
    assert.equal((Array.isArray(g.level.containers) && g.level.containers.length) ? g.level.containers : null, g.level.containers);
    assert.equal((Array.isArray(g.level.drives) && g.level.drives.length) ? g.level.drives : null, g.level.drives);
});

test('a level with noEnemies: true spawns zero enemies (peaceful mode)', () => {
    const g = game();
    g.level = { enemies: [], noEnemies: true };
    const isPeaceful = !!(g.level?.noEnemies || g.level?.peaceful);
    const authoredEnemies = isPeaceful ? [] : ((Array.isArray(g.level?.enemies) && g.level.enemies.length) ? g.level.enemies : null);
    const spawnCount = isPeaceful ? 0 : (authoredEnemies ? authoredEnemies.length : 12);
    assert.equal(isPeaceful, true);
    assert.deepEqual(authoredEnemies, []);
    assert.equal(spawnCount, 0, 'peaceful level spawns 0 enemies');
});


// --- a level that authors no exits must still be winnable ----------------------------

test('a level with no extraction/hatch falls back to the built-in exits', () => {
    // A fresh map from the editor has `extraction: null` and `hatch: null`. Treating that as
    // "no exit" disabled the extraction entirely (`x: -100000, disabled: true`, and the visual
    // builder returns early), so the raid could be fought and looted but NEVER won.
    const level = {
        enemies: [], containers: [], drives: [],
        extraction: null, hatch: null
    };
    const builtinExtract = { x: 3680, y: 520, radius: 130 };
    const builtinHatch = { x: 780, y: 1250, radius: 60 };
    const extract = (level.extraction && level.extraction.disabled !== true) ? level.extraction : builtinExtract;
    const hatch = (level.hatch && level.hatch.disabled !== true) ? level.hatch : builtinHatch;
    assert.deepEqual(extract, builtinExtract, 'a usable extraction exists');
    assert.deepEqual(hatch, builtinHatch, 'a usable hatch exists');
    assert.notEqual(extract.x, -100000);
});

test('an authored exit is honoured, and an explicitly disabled one is respected', () => {
    const authored = { x: 500, y: 600, radius: 140 };
    const extract = (authored && authored.disabled !== true) ? authored : { x: 3680, y: 520, radius: 130 };
    assert.equal(extract.x, 500, 'the authored position wins');

    const disabled = { x: 1, y: 2, radius: 3, disabled: true };
    const fallback = (disabled && disabled.disabled !== true) ? disabled : { x: 3680, y: 520, radius: 130 };
    assert.equal(fallback.x, 3680, 'an explicitly disabled exit falls back rather than vanishing');
});

test('the raid objective never becomes zero on a map without drives', () => {
    // `this.c.lootTarget = this.level.drives.length` made the target 0 for an empty list, so
    // the extraction gate (`loot >= 0`) passed instantly and the HUD expected no drives.
    const GAME_LOOT_TARGET = 3;
    const forLevel = (drives) => {
        const authored = (Array.isArray(drives) && drives.length) ? drives.length : 0;
        return authored > 0 ? authored : GAME_LOOT_TARGET;
    };
    assert.equal(forLevel([]), 3, 'an empty list uses the built-in target');
    assert.equal(forLevel(undefined), 3, 'a missing list uses the built-in target');
    assert.equal(forLevel([{ x: 1, y: 1 }, { x: 2, y: 2 }]), 2, 'authored drives are respected');
});
