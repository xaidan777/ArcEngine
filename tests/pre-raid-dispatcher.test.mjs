// tests/pre-raid-dispatcher.test.mjs — Automated tests for Pre-Raid Dispatcher checklist & Paper Doll V2.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const scripts = loadScripts(['js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js'], { document: {} });
const rules = scripts.get('RaidRules');
const ARC_ITEMS = scripts.get('ARC_ITEMS');

test('validatePreRaidChecklist passes when loadout is complete and balanced', () => {
    const loadout = {
        primary: Object.assign({}, ARC_ITEMS.tempest_ii, { durability: 85 }),
        secondary: Object.assign({}, ARC_ITEMS.revolver_i, { durability: 90 }),
        shieldCore: ARC_ITEMS.shield_medium,
        quickSlots: [ARC_ITEMS.consumable_stim, ARC_ITEMS.consumable_small_battery],
        safePocket: [ARC_ITEMS.data_drive]
    };
    const backpack = [
        Object.assign({}, ARC_ITEMS.ammo_heavy, { count: 60 }),
        Object.assign({}, ARC_ITEMS.ammo_light, { count: 80 })
    ];

    const result = rules.validatePreRaidChecklist(loadout, backpack);

    assert.equal(result.canDeploy, true, 'Fully equipped raider can deploy');
    assert.equal(result.errors.length, 0);
    assert.equal(result.checks.weapon.pass, true);
    assert.equal(result.checks.ammo.pass, true);
    assert.equal(result.checks.weight.pass, true);
    assert.equal(result.checks.durability.pass, true);
    assert.ok(result.weight <= 40.0);
});

test('validatePreRaidChecklist blocks deployment when unarmed', () => {
    const loadout = {
        primary: null,
        secondary: null,
        shieldCore: ARC_ITEMS.shield_light
    };
    const backpack = [];

    const result = rules.validatePreRaidChecklist(loadout, backpack);

    assert.equal(result.canDeploy, false, 'Unarmed raider cannot deploy without a weapon');
    assert.ok(result.errors.includes('NO_WEAPON'));
    assert.equal(result.checks.weapon.pass, false);
});

test('validatePreRaidChecklist blocks deployment when over 40kg limit', () => {
    const loadout = {
        primary: ARC_ITEMS.tempest_ii,
        shieldCore: ARC_ITEMS.shield_heavy
    };
    // 5 heavy ARC batteries of 8.5kg each = 42.5kg in backpack + weapon + shield > 40kg
    const backpack = Array(5).fill(null).map((_, i) => ({
        id: 'batt_' + i,
        name: 'ARC POWER BATTERY',
        category: 'materials',
        weight: 8.5
    }));

    const result = rules.validatePreRaidChecklist(loadout, backpack);

    assert.equal(result.canDeploy, false, 'Overweight raider cannot deploy');
    assert.ok(result.errors.includes('OVERENCUMBERED'));
    assert.equal(result.checks.weight.pass, false);
    assert.ok(result.weight > 40.0);
});

test('validatePreRaidChecklist warns on missing ammunition and low durability', () => {
    const loadout = {
        primary: Object.assign({}, ARC_ITEMS.vulcano_i, { durability: 15 }), // Shotgun with 15% durability
        secondary: null,
        shieldCore: ARC_ITEMS.shield_light
    };
    // Backpack has rifle ammo, not shotgun shells!
    const backpack = [
        Object.assign({}, ARC_ITEMS.ammo_heavy, { count: 40 })
    ];

    const result = rules.validatePreRaidChecklist(loadout, backpack);

    // Warnings do not strictly block deployment (can still do rat/salvage run if under 40kg with weapon)
    assert.equal(result.canDeploy, true);
    assert.equal(result.checks.ammo.pass, false, 'Ammo check flagged missing shotgun shells');
    assert.equal(result.checks.ammo.warning, true);
    assert.equal(result.checks.durability.pass, false, 'Durability flagged critical wear');
    assert.equal(result.checks.durability.warning, true);
    assert.ok(result.warnings.includes('MISSING_AMMO'));
    assert.ok(result.warnings.includes('CRITICAL_WEAR'));
});
