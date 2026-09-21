import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const scripts = loadScripts(['js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js', 'js/Game.js'], {
    document: {},
    UI: { get: () => null, add: () => null, remove: () => {} }
});
const rules = scripts.get('RaidRules');
const Game = scripts.get('Game');
function game() {
    const g = Object.create(Game.prototype);
    Object.assign(g, {
        phase: 'raid', paused: false, player: { x: 0, y: 0, hp: 50, maxHp: 100 },
        c: {
            mag: 20, reload: 1.8, healSec: 2.6, searchSec: 1.2, medkitHeal: 35,
            raidDuration: 1200, barrageDps: 1000, hatchHoldSec: 3.0, hatchNoiseRadius: 25,
            beaconSirenRadius: 380, inboundSec: 20, extractHoldSec: 6
        },
        reloadTimer: 0, healTimer: 0, searchTimer: 0, fireCooldown: 0,
        ammo: 10, reserveAmmo: 118, medkits: 2, containers: [], coverBlockers: [],
        keys: new Set(), touchMove: {}, backpack: [], raidValue: 0, time: 0,
        weapon: {}, profile: { credits: 20 }, enemies: [],
        raidTimer: 1200, barrageActive: false, hatchProgress: 0,
        updateHud() {}, refreshInventorySlots() {}, showLootFeed() {},
        updatePlayer() {}, updateEnemies() {}, updateObjectives() {},
    });
    g.mechanics = g.readMechanics();
    g.stamina = { value: 100, delay: 0, exhausted: false };
    return g;
}
function box(type = 'ammo') {
    return { x: 30, y: 0, opened: false, item: { type, label: ['A', 'B'], value: 20 }, visual: { scaling: { y: 1 } } };
}

test('stamina drains, delays recovery and prevents exhausted sprint flicker', () => {
    const g = game(), s = g.stamina, c = g.mechanics.stamina;
    for (let i = 0; i < 300; i++) rules.tickStamina(s, true, 1 / 60, c);
    assert.equal(s.exhausted, true);
    assert.equal(s.value, 0);
    for (let i = 0; i < 30; i++) assert.equal(rules.tickStamina(s, true, 1 / 60, c), false);
    for (let i = 0; i < 180; i++) rules.tickStamina(s, false, 1 / 60, c);
    assert.equal(s.exhausted, false);
    assert.ok(s.value >= c.restart);
    assert.equal(rules.tickStamina(s, true, 1 / 60, c), true);
});

test('all action entry points reject pause, briefing and results', () => {
    for (const phase of ['briefing', 'won', 'lost', 'raid']) {
        const g = game(); g.phase = phase; g.paused = phase === 'raid';
        g.containers = [box()];
        for (const command of ['reload', 'heal', 'interact']) assert.equal(g.command(command), false);
        g.fire(); // Must reject before touching renderer or audio.
        g.simulate(1);
        assert.equal(g.ammo, 10); assert.equal(g.time, 0);
    }
});

test('timed actions are exclusive and cancellation does not consume supplies', () => {
    const g = game(); g.containers = [box()];
    assert.equal(g.command('reload'), true);
    assert.equal(g.command('heal'), false);
    assert.equal(g.command('interact'), false);
    assert.equal(g.command('cancel-action'), true);
    assert.equal(g.ammo, 10); assert.equal(g.reserveAmmo, 118);
    assert.equal(g.command('heal'), true);
    assert.equal(g.command('reload'), false);
    g.command('cancel-action');
    assert.equal(g.medkits, 2); assert.equal(g.player.hp, 50);
    assert.equal(g.command('interact'), true);
    assert.equal(g.command('heal'), false);
});

test('search rejects occlusion and cancels for touch movement or new obstruction', () => {
    const g = game(); g.containers = [box()];
    g.coverBlockers = [{ x: 15, y: 0, radius: 5 }];
    assert.equal(g.startInteract(), false);
    g.coverBlockers = [];
    assert.equal(g.startInteract(), true);
    g.touchMove = { id: 0, x: 25, y: 0, startX: 0, startY: 0 };
    g.simulate(0.1);
    assert.equal(g.searchTarget, null); assert.equal(g.containers[0].opened, false);
    g.touchMove = {};
    g.startInteract(); g.coverBlockers = [{ x: 15, y: 0, radius: 5 }];
    g.simulate(0.1); assert.equal(g.searchTarget, null);
});

test('partial pickups conserve ammunition and full containers remain available', () => {
    const g = game(), b = box(); g.containers = [b];
    g.startInteract(); g.completeSearch();
    assert.equal(g.reserveAmmo, 120); assert.equal(b.remaining, 18); assert.equal(b.opened, false);
    g.startInteract(); g.completeSearch();
    assert.equal(b.remaining, 18); assert.equal(b.opened, false);
    g.reserveAmmo = 100; g.startInteract(); g.completeSearch();
    assert.equal(g.reserveAmmo, 118); assert.equal(b.opened, true);
    g.searchTarget = b; g.completeSearch(); assert.equal(g.reserveAmmo, 118);
});

test('completed heal consumes exactly one kit and pause freezes countdown', () => {
    const g = game(); g.startHeal(); g.paused = true; g.simulate(10);
    assert.equal(g.healTimer, 2.6); assert.equal(g.medkits, 2);
    g.paused = false;
    for (let i = 0; i < 40; i++) g.simulate(0.1);
    assert.equal(g.medkits, 1); assert.equal(g.player.hp, 85);
});

test('death in enemy step cannot also trigger successful extraction that tick', () => {
    const g = game(); let objectives = 0;
    g.updateEnemies = () => { g.phase = 'lost'; };
    g.updateObjectives = () => { objectives++; };
    g.simulate(0.1);
    assert.equal(objectives, 0);
});

test('noise investigation remembers origin without waking dormant reinforcements', () => {
    const g = game();
    const guard = { x: 200, y: 0, state: 'patrol', alert: 0 };
    const reserve = { ...guard, dormant: true };
    g.enemies = [guard, reserve];
    g.emitNoise(100); assert.equal(guard.state, 'patrol');
    g.emitNoise(320); assert.equal(guard.state, 'investigate');
    assert.equal(guard.lastX, 0); assert.equal(reserve.state, 'patrol');
    g.player.x = 1000; assert.equal(guard.lastX, 0);
});

test('UI snapshot is detached from live player, inventory, stamina and profile', () => {
    const g = game(); g.backpack = [box('scrap').item]; g.startReload();
    const snapshot = g.getSnapshot();
    assert.equal(snapshot.action.type, 'reload'); assert.equal(snapshot.action.progress, 0);
    snapshot.player.hp = 0; snapshot.stamina.value = 0; snapshot.profile.credits = 999;
    snapshot.inventory[0].label[0] = 'changed';
    assert.equal(g.player.hp, 50); assert.equal(g.stamina.value, 100);
    assert.equal(g.profile.credits, 20); assert.equal(g.backpack[0].label[0], 'A');
});

test('raid timer decrements and triggers lethal barrage at 00:00', () => {
    const g = game();
    g.raidTimer = 2.0;
    g.c.barrageDps = 1000;
    g.player.hp = 100;
    g.pickups = [];
    g.extract = { x: 9999, y: 9999, radius: 10 };
    g.applyPlayerDamage = (dmg) => { g.player.hp -= dmg; };

    Game.prototype.updateObjectives.call(g, 1.0);
    assert.equal(g.raidTimer, 1.0);
    assert.equal(g.barrageActive, false);
    assert.equal(g.player.hp, 100);

    // Reaching 00:00 activates barrage and inflicts lethal damage
    Game.prototype.updateObjectives.call(g, 1.0);
    assert.equal(g.raidTimer, 0);
    assert.equal(g.barrageActive, true);
    assert.ok(g.player.hp < 100);
});

test('silent bunker hatch extraction requires raider_hatch_key and consumes key on success', () => {
    const g = game();
    g.hatchExtract = { x: 100, y: 100, radius: 50 };
    g.hatchProgress = 0;
    g.player.x = 100; g.player.y = 100;
    g.c.hatchHoldSec = 3.0;
    g.c.hatchNoiseRadius = 25;
    g.keys.add('KeyE');
    g.pickups = [];
    g.extract = { x: 9999, y: 9999, radius: 10 };
    g.emitNoise = () => {};

    // Without key: cannot extract
    g.backpack = [];
    Game.prototype.updateObjectives.call(g, 1.0);
    assert.equal(g.hatchProgress, 0);

    // With key: holding E advances progress
    const key = { id: 'raider_hatch_key', count: 1 };
    g.backpack = [key];
    Game.prototype.updateObjectives.call(g, 1.0);
    assert.ok(g.hatchProgress > 0);
    assert.equal(g.backpack.length, 1);

    let finished = false;
    g.finish = (won) => { finished = won; };
    Game.prototype.updateObjectives.call(g, 2.5);
    assert.equal(finished, true);
    assert.equal(g.backpack.length, 0); // Key consumed
});

test('blueprints gate workshop recipes until learned and stored in profile', () => {
    const profile = { unlockedBlueprints: [] };
    const recipeId = 'craft_lance_sniper';

    // Recipe is locked initially
    assert.equal(rules.isRecipeUnlocked(profile, recipeId), false);

    // Learning blueprint permanently unlocks the recipe
    rules.learnBlueprint(profile, 'bp_lance_sniper');
    assert.ok(profile.unlockedBlueprints.includes('bp_lance_sniper'));
    assert.equal(rules.isRecipeUnlocked(profile, recipeId), true);
});

test('augments adjust loadout weight limits, encumbrance, and safe pocket capacity', () => {
    const scoutFrame = { id: 'frame_scout', weight: 2.0, maxWeight: 25.0, safePocketSlots: 1, noiseMultiplier: 0.7, sprintSpeedMultiplier: 1.1 };
    const looterFrame = { id: 'frame_looter', weight: 4.5, maxWeight: 45.0, safePocketSlots: 3, noiseMultiplier: 1.0, sprintSpeedMultiplier: 1.0 };

    // Weight calculation includes augment
    const weight = rules.calculateLoadoutWeight({ augment: scoutFrame, primary: { weight: 5.0 } });
    assert.equal(weight, 7.0);

    // Encumbrance scales to augment maxWeight
    const encScout = rules.getEncumbrance(20.0, scoutFrame);
    assert.equal(encScout.id, 'heavy');
    assert.equal(encScout.noiseMult, 1.4 * 0.7);

    const encLooter = rules.getEncumbrance(20.0, looterFrame);
    assert.equal(encLooter.id, 'medium');

    // Safe pocket capacity derived from augment
    assert.equal(rules.getSafePocketCapacity({ augment: scoutFrame }), 1);
    assert.equal(rules.getSafePocketCapacity({ augment: looterFrame }), 3);
});

test('Scrappy drone claims passive scrap and credit yield', () => {
    const yield1 = rules.claimScrappyYield({ stations: { station_scrappy: 1 } });
    assert.ok(yield1.scrap >= 15);
    assert.ok(yield1.credits >= 100);

    const yield2 = rules.claimScrappyYield({ stations: { station_scrappy: 2 } });
    assert.ok(yield2.scrap > yield1.scrap);
    assert.ok(yield2.credits > yield1.credits);
});

test('the primary extraction requires the raid objective, then completes', () => {
    const g = game();
    g.extract = { x: 50, y: 50, radius: 100 };
    g.extractState = 'available';
    g.player.x = 50;
    g.player.y = 50;
    g.c.lootTarget = 3;
    g.loot = 0; // no data drives yet

    // The main exit is the objective's payoff: with the drives missing it refuses, and says so.
    assert.equal(g.startInteract(), false);
    assert.equal(g.extractState, 'available');
    assert.match(g.lootFeedText, /3/);

    // With the objective met the beacon can be called, exactly as the server allows it.
    g.loot = 3;
    const triggered = g.startInteract();
    assert.equal(triggered, true);
    assert.equal(g.extractState, 'inbound');
    assert.equal(g.inboundTimer, g.c.inboundSec);

    // Simulate inbound time passing
    g.emitNoise = () => {};
    g.c.extractSec = 5.0;
    Game.prototype.updateObjectives.call(g, g.c.inboundSec);
    assert.equal(g.extractState, 'boarding');

    // Boarding completes extraction
    let extracted = false;
    g.finish = (won) => { extracted = won; };
    Game.prototype.updateObjectives.call(g, 5.0);
    assert.equal(extracted, true);
});

test('metro extraction can be triggered and completes independently', () => {
    const g = game();
    g.extract = { x: 3000, y: 3000, radius: 100 };
    g.metroExtract = { x: 650, y: 1150, radius: 130, state: 'available', inboundTimer: 0, extractProgress: 0, contested: false };
    g.player.x = 650;
    g.player.y = 1150;

    const triggered = g.startInteract();
    assert.equal(triggered, true);
    assert.equal(g.metroExtract.state, 'inbound');
    assert.equal(g.metroExtract.inboundTimer, g.c.inboundSec);

    // Simulate inbound time passing
    g.emitNoise = () => {};
    g.c.extractSec = 5.0;
    Game.prototype.updateObjectives.call(g, g.c.inboundSec);
    assert.equal(g.metroExtract.state, 'boarding');

    // Complete boarding
    let extracted = false;
    g.finish = (won) => { extracted = won; };
    Game.prototype.updateObjectives.call(g, 5.0);
    assert.equal(extracted, true);
});

test('data drive collection gives credit bonus and backpack item', () => {
    const g = game();
    g.player.x = 100;
    g.player.y = 100;
    g.player.radius = 20;
    g.pickups = [
        { x: 100, y: 100, radius: 48, taken: false, phase: 0 }
    ];
    g.playSound = () => {};

    Game.prototype.updateObjectives.call(g, 0.1);
    assert.equal(g.pickups[0].taken, true);
    assert.equal(g.loot, 1);
    assert.equal(g.raidValue, 300);
    // The backpack is the fixed 18-cell grid; the drive occupies its first free cell.
    assert.equal(g.backpack.filter(Boolean).length, 1);
    assert.equal(g.backpack[0].type, 'intel');
    assert.equal(g.lootedItems(), 1, 'a drive counts against the loot capacity');
});


