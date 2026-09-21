// tests/workshop-crafting.test.mjs — Automated tests for Speranza Workshop, Weapon Tier Upgrades, and Safe Pocket Settlement.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const scripts = loadScripts(['js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js'], { document: {} });
const rules = scripts.get('RaidRules');
const ARC_ITEMS = scripts.get('ARC_ITEMS');
const ARC_CRAFTING_RECIPES = scripts.get('ARC_CRAFTING_RECIPES');
const ARC_MACHINE_TYPES = scripts.get('ARC_MACHINE_TYPES');
const LOCATION_WIDTH = scripts.get('LOCATION_WIDTH');
const LOCATION_HEIGHT = scripts.get('LOCATION_HEIGHT');

test('Refiner converts five metal parts into a reusable mechanical component', () => {
    const stash = [{ type: 'metal_parts', count: 7 }];
    const result = rules.executeCraft(stash, { credits: 0 }, ARC_CRAFTING_RECIPES.refine_mechanical_component);
    assert.equal(result.success, true);
    assert.equal(stash[0].count, 2);
    assert.equal(result.item.type, 'mechanical_component');
    assert.equal(rules.canCraft(stash, { credits: 0 }, ARC_CRAFTING_RECIPES.refine_mechanical_component).canCraft, false);
});

test('Gunsmith level three applies a single 25 percent production discount', () => {
    const profile = { credits: 100, stations: { station_armory: 3 } };
    const recipe = { id: 'discount-test', category: 'weapons', resultId: 'test', credits: 100, materials: [{ type: 'scrap', count: 8 }] };
    const discounted = rules.workshopRecipe(profile, recipe);
    assert.equal(discounted.credits, 75);
    assert.equal(discounted.materials[0].count, 6);
    const stash = [{ type: 'scrap', count: 6 }];
    assert.equal(rules.executeCraft(stash, profile, discounted).success, true);
    assert.equal(profile.credits, 25);
    assert.equal(stash.length, 1);
});

test('Rubezh-76 assault rifle line is fully configured with progressive tiers and stats', () => {
    assert.ok(ARC_ITEMS.rubezh_t1, 'rubezh_t1 must exist');
    assert.ok(ARC_ITEMS.rubezh_t2, 'rubezh_t2 must exist');
    assert.ok(ARC_ITEMS.rubezh_t3, 'rubezh_t3 must exist');
    assert.ok(ARC_ITEMS.rubezh_t4, 'rubezh_t4 must exist');

    const tiers = [ARC_ITEMS.rubezh_t1, ARC_ITEMS.rubezh_t2, ARC_ITEMS.rubezh_t3, ARC_ITEMS.rubezh_t4];
    const expectedTiers = ['I', 'II', 'III', 'IV'];

    for (let i = 0; i < tiers.length; i++) {
        const rifle = tiers[i];
        assert.equal(rifle.category, 'weapons');
        assert.equal(rifle.slotType, 'primary');
        assert.equal(rifle.tier, expectedTiers[i]);
        assert.equal(rifle.caliber, 'heavy_kinetic');
        assert.ok(rifle.damage > 0, 'Damage must be positive');
        assert.ok(rifle.value > 0, 'Value must be positive');
        assert.ok(rifle.weight > 0, 'Weight must be positive');
    }

    // Progression verification: damage and value monotonically increase with tier
    assert.ok(ARC_ITEMS.rubezh_t1.damage < ARC_ITEMS.rubezh_t2.damage);
    assert.ok(ARC_ITEMS.rubezh_t2.damage < ARC_ITEMS.rubezh_t3.damage);
    assert.ok(ARC_ITEMS.rubezh_t3.damage < ARC_ITEMS.rubezh_t4.damage);

    assert.ok(ARC_ITEMS.rubezh_t1.value < ARC_ITEMS.rubezh_t2.value);
    assert.ok(ARC_ITEMS.rubezh_t2.value < ARC_ITEMS.rubezh_t3.value);
    assert.ok(ARC_ITEMS.rubezh_t3.value < ARC_ITEMS.rubezh_t4.value);
});

test('Rubezh-76 refinement recipes allow progressive workshop upgrades', () => {
    const r2 = ARC_CRAFTING_RECIPES.upgrade_rubezh_2;
    const r3 = ARC_CRAFTING_RECIPES.upgrade_rubezh_3;
    const r4 = ARC_CRAFTING_RECIPES.upgrade_rubezh_4;

    assert.ok(r2 && r3 && r4, 'All 3 Rubezh refinement recipes must be defined');
    assert.equal(r2.baseWeaponId, 'rubezh_t1');
    assert.equal(r2.resultId, 'rubezh_t2');
    assert.equal(r3.baseWeaponId, 'rubezh_t2');
    assert.equal(r3.resultId, 'rubezh_t3');
    assert.equal(r4.baseWeaponId, 'rubezh_t3');
    assert.equal(r4.resultId, 'rubezh_t4');

    // Test executing an upgrade in the workshop
    const wallet = { credits: 2000, arcCores: 1 };
    const stash = [
        { id: 'rubezh_t1', name: 'RUBEZH-76 T1', category: 'weapons', tier: 'I' },
        { id: 'scrap_1', type: 'scrap', count: 5, category: 'materials' }
    ];

    // Check pre-craft check
    const checkBefore = rules.canCraft(stash, wallet, r2);
    assert.equal(checkBefore.canCraft, true, 'Should be able to craft Rubezh T2 with base weapon and scrap');

    // Execute craft
    const result = rules.executeCraft(stash, wallet, r2);
    assert.equal(result.success, true);
    assert.equal(wallet.credits, 2000 - r2.credits);
    // Base weapon should be consumed
    assert.ok(!stash.some(it => it.id === 'rubezh_t1'));
    // Upgraded weapon should be present
    assert.ok(stash.some(it => it.id.startsWith('rubezh_t2')));
    // Scrap consumed: 5 - 2 = 3 left
    const remainingScrap = stash.find(it => it.type === 'scrap');
    assert.equal(remainingScrap.count, 3);
});

test('dismantleItem breaks gear down into crafting components', () => {
    const stash = [
        { id: 'weapon_junk_1', name: 'Broken Rifle', category: 'weapons', value: 200 }
    ];

    const res = rules.dismantleItem(stash, stash[0]);
    assert.equal(res.success, true);
    assert.equal(stash.some(it => it.id === 'weapon_junk_1'), false, 'Dismantled item must be removed from stash');
    assert.ok(stash.some(it => it.type === 'scrap'), 'Dismantling weapons must yield scrap');
    assert.ok(stash.some(it => it.type === 'electronics'), 'Dismantling weapons must yield electronics');
});

test('resolveRaidSettlement preserves Safe Pocket items on operator KIA while wiping backpack and loadout', () => {
    const loadout = {
        primary: { id: 'rubezh_t4', name: 'RUBEZH-76 T4', value: 16500 },
        // The canonical slot name: `shieldCore`, not `shield`. The settlement walks the real
        // slot table, so a misspelled key is not an equipped item and must not be counted.
        shieldCore: { id: 'shield_heavy', name: 'HEAVY SHIELD', value: 4500 }
    };
    const backpack = [
        { id: 'loot_core', name: 'ARC Core Alpha', value: 2500 },
        { id: 'loot_scrap', name: 'Salvaged Components', value: 300 }
    ];
    const safePocket = [
        { id: 'data_drive_encrypted', name: 'CLASSIFIED DATA DRIVE', value: 5000 }
    ];

    // Case 1: Defeat / KIA
    const defeatResult = rules.resolveRaidSettlement(false, loadout, backpack, safePocket);
    assert.equal(defeatResult.won, false);
    assert.equal(defeatResult.safePocketProtectedCount, 1);
    assert.equal(defeatResult.savedLoot.length, 1);
    assert.equal(defeatResult.savedLoot[0].id, 'data_drive_encrypted');
    // Lost items must include equipped loadout and backpack items
    assert.equal(defeatResult.lostItems.length, 4);
    assert.equal(defeatResult.extractedValue, 5000);

    // Case 2: Successful Extraction
    const victoryResult = rules.resolveRaidSettlement(true, loadout, backpack, safePocket);
    assert.equal(victoryResult.won, true);
    assert.equal(victoryResult.safePocketProtectedCount, 1);
    // Saved loot combines backpack + safe pocket
    assert.equal(victoryResult.savedLoot.length, 3);
    assert.equal(victoryResult.lostItems.length, 0);
    assert.equal(victoryResult.extractedValue, 2500 + 300 + 5000);
});

test('ARC machine archetypes include Cricket jumper and Screamer EW stilt unit', () => {
    assert.ok(ARC_MACHINE_TYPES.CRICKET, 'CRICKET machine type must be registered');
    assert.equal(ARC_MACHINE_TYPES.CRICKET.id, 'cricket');
    assert.ok(ARC_MACHINE_TYPES.CRICKET.leapCooldown > 0);
    assert.ok(ARC_MACHINE_TYPES.CRICKET.leapDist > 0);
    assert.ok(ARC_MACHINE_TYPES.CRICKET.pounceDamage > 0);

    assert.ok(ARC_MACHINE_TYPES.SCREAMER, 'SCREAMER machine type must be registered');
    assert.equal(ARC_MACHINE_TYPES.SCREAMER.id, 'screamer');
    assert.ok(ARC_MACHINE_TYPES.SCREAMER.screamCooldown > 0);
    assert.ok(ARC_MACHINE_TYPES.SCREAMER.sirenRadius > 0);
    assert.ok(ARC_MACHINE_TYPES.SCREAMER.screamDisrupt > 0);
});

test('Location boundaries reflect expanded 4096x4096 world scale', () => {
    assert.equal(LOCATION_WIDTH, 4096);
    assert.equal(LOCATION_HEIGHT, 4096);
});
