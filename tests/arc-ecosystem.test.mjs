import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const scripts = loadScripts(['js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js'], { document: {} });
const rules = scripts.get('RaidRules');
const ARC_ITEMS = scripts.get('ARC_ITEMS');
const ARC_SHIELD_CORES = scripts.get('ARC_SHIELD_CORES');
const ARC_ENCUMBRANCE_TIERS = scripts.get('ARC_ENCUMBRANCE_TIERS');
const ARC_MACHINE_TYPES = scripts.get('ARC_MACHINE_TYPES');

test('ARC_ITEMS registry contains valid items with required schema', () => {
    assert.ok(ARC_ITEMS, 'ARC_ITEMS must exist');
    assert.ok(ARC_ITEMS.tempest_ii, 'TEMPEST II must exist');
    assert.ok(ARC_ITEMS.shield_medium, 'Medium shield core must exist');
    assert.ok(ARC_ITEMS.consumable_stim, 'Stim must exist');

    for (const [id, item] of Object.entries(ARC_ITEMS)) {
        assert.equal(item.id, id, `Item id must match key ${id}`);
        assert.ok(item.name, `Item ${id} must have a name`);
        assert.ok(item.category, `Item ${id} must have a category`);
        assert.ok(typeof item.weight === 'number' && item.weight >= 0, `Item ${id} must have non-negative weight`);
        assert.ok(typeof item.value === 'number' && item.value >= 0, `Item ${id} must have non-negative value`);
    }
});

test('calculateLoadoutWeight accurately sums equipped gear and backpack', () => {
    const loadout = {
        primary: ARC_ITEMS.tempest_ii, // 6.2 kg
        secondary: ARC_ITEMS.revolver_i, // 3.1 kg
        shieldCore: ARC_ITEMS.shield_medium, // 5.5 kg
        safePocket: [ARC_ITEMS.data_drive], // 0.5 kg
        quickSlots: [ARC_ITEMS.consumable_stim, ARC_ITEMS.consumable_small_battery], // 0.4 + 0.8 = 1.2 kg
    };
    const backpack = [
        ARC_ITEMS.steel_scrap, // 2.0 kg
        ARC_ITEMS.ammo_heavy, // 2.0 kg
    ];

    const totalWeight = rules.calculateLoadoutWeight(loadout, backpack);
    // 6.2 + 3.1 + 5.5 + 0.5 + 1.2 + 2.0 + 2.0 = 20.5 kg
    assert.equal(totalWeight, 20.5);

    const enc = rules.getEncumbrance(totalWeight);
    assert.equal(enc.id, 'medium');
    assert.equal(enc.speedMult, 1.0);
    assert.equal(enc.jumpBlocked, false);
});

test('encumbrance tiers apply correct modifiers and thresholds', () => {
    assert.equal(rules.getEncumbrance(10).id, 'light');
    assert.equal(rules.getEncumbrance(10).sprintMult, 1.05);

    assert.equal(rules.getEncumbrance(22).id, 'medium');
    assert.equal(rules.getEncumbrance(22).speedMult, 1.0);

    assert.equal(rules.getEncumbrance(35).id, 'heavy');
    assert.equal(rules.getEncumbrance(35).speedMult, 0.88);
    assert.equal(rules.getEncumbrance(35).noiseMult, 1.4);

    assert.equal(rules.getEncumbrance(45).id, 'overencumbered');
    assert.equal(rules.getEncumbrance(45).sprintBlocked, true);
    assert.equal(rules.getEncumbrance(45).jumpBlocked, true);
});

test('safe pocket validation strictly enforces item blacklist', () => {
    assert.equal(rules.canPlaceInSafePocket(ARC_ITEMS.tempest_ii), false, 'Weapons cannot be placed in safe pocket');
    assert.equal(rules.canPlaceInSafePocket(ARC_ITEMS.revolver_i), false, 'Sidearms cannot be placed in safe pocket');
    assert.equal(rules.canPlaceInSafePocket(ARC_ITEMS.shield_heavy), false, 'Shield cores cannot be placed in safe pocket');
    assert.equal(rules.canPlaceInSafePocket(ARC_ITEMS.arc_battery), false, 'Volatile ARC batteries cannot be placed in safe pocket');

    assert.equal(rules.canPlaceInSafePocket(ARC_ITEMS.data_drive), true, 'Data drives can be placed in safe pocket');
    assert.equal(rules.canPlaceInSafePocket(ARC_ITEMS.consumable_stim), true, 'Stims can be placed in safe pocket');
    assert.equal(rules.canPlaceInSafePocket(ARC_ITEMS.memory_core), true, 'Memory core can be placed in safe pocket');
});

test('pre-raid validation enforces weapon requirement and 40kg weight limit', () => {
    const noWeapon = rules.validatePreRaid({}, []);
    assert.equal(noWeapon.valid, false);
    assert.ok(noWeapon.errors.some(e => e.includes('weapon')));

    const validLoadout = {
        primary: ARC_ITEMS.tempest_ii,
        shieldCore: ARC_ITEMS.shield_light,
    };
    const validCheck = rules.validatePreRaid(validLoadout, []);
    assert.equal(validCheck.valid, true);

    const overweightBackpack = Array(6).fill(ARC_ITEMS.arc_battery); // 6 * 8.5 = 51 kg
    const heavyCheck = rules.validatePreRaid(validLoadout, overweightBackpack);
    assert.equal(heavyCheck.valid, false);
    assert.ok(heavyCheck.errors.some(e => e.includes('Overencumbered')));
});

test('layered damage absorbs through shield before depleting health', () => {
    const player = { hp: 100, maxHp: 100, shield: 100, maxShield: 100 };

    // Hit for 40 damage: absorbed entirely by shield
    const hit1 = rules.applyDamage(player, 40);
    assert.equal(hit1.dealtToShield, 40);
    assert.equal(hit1.dealtToHp, 0);
    assert.equal(hit1.shieldBroken, false);
    assert.equal(player.shield, 60);
    assert.equal(player.hp, 100);

    // Hit for 80 damage: 60 absorbed by shield, shield breaks, 20 bleed-through to HP
    const hit2 = rules.applyDamage(player, 80);
    assert.equal(hit2.dealtToShield, 60);
    assert.equal(hit2.dealtToHp, 20);
    assert.equal(hit2.shieldBroken, true);
    assert.equal(player.shield, 0);
    assert.equal(player.hp, 80);

    // Hit with 0 shield: direct to HP
    const hit3 = rules.applyDamage(player, 80);
    assert.equal(hit3.dealtToShield, 0);
    assert.equal(hit3.dealtToHp, 80);
    assert.equal(hit3.isDead, true);
    assert.equal(player.hp, 0);
});

test('death drop resolution retains safe pocket items and drops equipped gear', () => {
    const loadout = {
        primary: ARC_ITEMS.tempest_ii,
        shieldCore: ARC_ITEMS.shield_medium,
        safePocket: [ARC_ITEMS.memory_core, ARC_ITEMS.data_drive],
        quickSlots: [ARC_ITEMS.consumable_stim],
    };
    const backpack = [ARC_ITEMS.steel_scrap];

    const result = rules.resolveDeathDrop(loadout, backpack);
    assert.equal(result.retained.length, 2);
    assert.equal(result.retained[0].id, 'memory_core');
    assert.equal(result.retained[1].id, 'data_drive');

    assert.ok(result.dropped.some(it => it.id === 'tempest_ii'));
    assert.ok(result.dropped.some(it => it.id === 'shield_medium'));
    assert.ok(result.dropped.some(it => it.id === 'steel_scrap'));
});

test('sentinel weakspot detection calculates rear core and front armor correctly', () => {
    const sentinel = { x: 500, y: 500, heading: 0 }; // Facing East (+X)

    // Hit directly from behind (West, -X): rear power core!
    const rearHit = rules.checkSentinelHitZone({ x: 400, y: 500 }, sentinel);
    assert.equal(rearHit.isWeakspot, true);
    assert.equal(rearHit.multiplier, 3.0);

    // Hit directly from front (East, +X): riot armor!
    const frontHit = rules.checkSentinelHitZone({ x: 600, y: 500 }, sentinel);
    assert.equal(frontHit.isFrontArmor, true);
    assert.equal(frontHit.multiplier, 0.10);
});

test('ARC_MACHINE_TYPES registry defines Stalker and Bombard archetypes', () => {
    assert.ok(ARC_MACHINE_TYPES.STALKER, 'STALKER archetype must be defined');
    assert.equal(ARC_MACHINE_TYPES.STALKER.hp, 130);
    assert.equal(ARC_MACHINE_TYPES.STALKER.speed, 135);
    assert.equal(ARC_MACHINE_TYPES.STALKER.dropLoot, 'arc_sensor');

    assert.ok(ARC_MACHINE_TYPES.BOMBARD, 'BOMBARD archetype must be defined');
    assert.equal(ARC_MACHINE_TYPES.BOMBARD.hp, 310);
    assert.equal(ARC_MACHINE_TYPES.BOMBARD.speed, 40);
    assert.equal(ARC_MACHINE_TYPES.BOMBARD.dropLoot, 'arc_power_core');
});

test('Stalker weakspot detection checks rear cooling spine', () => {
    const stalker = { x: 300, y: 300, heading: 0 }; // Facing +X (East)

    // Hit from behind (West, -X): rear cooling spine
    const rearHit = rules.checkStalkerHitZone({ x: 200, y: 300 }, stalker);
    assert.equal(rearHit.isWeakspot, true);
    assert.equal(rearHit.multiplier, 1.75);

    // Hit from front (East, +X): standard hit
    const frontHit = rules.checkStalkerHitZone({ x: 400, y: 300 }, stalker);
    assert.equal(frontHit.isWeakspot, false);
    assert.equal(frontHit.multiplier, 1.0);
});

test('Bombard weakspot and armor detection checks ammo vent and front plates', () => {
    const bombard = { x: 400, y: 400, heading: 0, isDeployed: true }; // Facing East

    // Hit from rear (West, -X): rear ammo loading vent (2.0x)
    const rearHit = rules.checkBombardHitZone({ x: 300, y: 400 }, bombard);
    assert.equal(rearHit.isWeakspot, true);
    assert.equal(rearHit.multiplier, 2.0);

    // Hit from front (East, +X) while deployed: heavy front armor (0.60x)
    const frontHitDeployed = rules.checkBombardHitZone({ x: 500, y: 400 }, bombard);
    assert.equal(frontHitDeployed.isFrontArmor, true);
    assert.equal(frontHitDeployed.multiplier, 0.60);

    // Hit from front when NOT deployed: normal multiplier (1.0x)
    bombard.isDeployed = false;
    const frontHitUndeployed = rules.checkBombardHitZone({ x: 500, y: 400 }, bombard);
    assert.equal(frontHitUndeployed.isFrontArmor, false);
    assert.equal(frontHitUndeployed.multiplier, 1.0);
});

test('calculateFlankPosition produces correct tactical offset around target', () => {
    const unit = { x: 100, y: 100 };
    const target = { x: 500, y: 100 }; // Target is 400 units East of unit
    const angleRad = Math.PI / 4; // 45 degrees
    const dist = 200;

    const flankPos = rules.calculateFlankPosition(unit, target, angleRad, dist);
    // Target is (500, 100). Base angle from target to unit is Math.PI (180 deg).
    // Flank angle is PI + PI/4 = 5*PI/4.
    // Flank X = 500 + 200 * cos(5*PI/4) = 500 - 141.42 = ~358.58
    // Flank Y = 100 + 200 * sin(5*PI/4) = 100 - 141.42 = ~-41.42
    assert.ok(Math.abs(flankPos.x - (500 + Math.cos(Math.PI + angleRad) * dist)) < 0.001);
    assert.ok(Math.abs(flankPos.y - (100 + Math.sin(Math.PI + angleRad) * dist)) < 0.001);
});

