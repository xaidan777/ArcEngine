import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore } from '../server/accounts.mjs';
import {
    calcLevel,
    xpForLevel,
    SKILL_TREE,
    VENDOR_TRUST_TIERS,
    getVendorTrustLevel,
    CONTRACT_DEFINITIONS,
    WORKSHOP_STATIONS_CATALOG,
    CRAFTING_RECIPES,
    SCAVENGER_KIT
} from '../server/progression.mjs';

test('Leveling: xpForLevel and calcLevel progression curve', () => {
    assert.equal(xpForLevel(1), 0);
    assert.ok(xpForLevel(2) > 0);
    assert.ok(xpForLevel(5) > xpForLevel(2));
    assert.ok(xpForLevel(30) > xpForLevel(20));

    const l1 = calcLevel(0);
    assert.equal(l1.level, 1);
    assert.equal(l1.xp, 0);
    assert.ok(l1.neededForNext > 0);

    const xpForL2 = xpForLevel(2);
    const l2 = calcLevel(xpForL2);
    assert.equal(l2.level, 2);

    const l5 = calcLevel(xpForLevel(5) + 50);
    assert.equal(l5.level, 5);
    assert.equal(l5.progressInLevel, 50);
});

test('Skill Tree: allocation, prerequisites, and respec', () => {
    const store = new AccountStore();
    const reg = store.register('Raider_SkillTest', 'pass12345');
    assert.ok(reg.ok);
    const acc = reg.account;

    // Initially 0 skill points
    let res = store.allocateSkill(acc.id, 'resilience', 'vitality_1');
    assert.equal(res.ok, false);
    assert.equal(res.error, 'no-skill-points');

    // Grant 2 skill points
    acc.skillPoints = 2;
    acc.credits = 5000;

    // Prerequisite check: vitality_2 requires vitality_1
    res = store.allocateSkill(acc.id, 'resilience', 'vitality_2');
    assert.equal(res.ok, false);
    assert.equal(res.error, 'missing-prerequisite');

    // Allocate vitality_1
    res = store.allocateSkill(acc.id, 'resilience', 'vitality_1');
    assert.ok(res.ok);
    assert.equal(acc.skillPoints, 1);
    assert.equal(acc.skills.resilience.vitality_1, true);

    // Duplicate allocation fails
    res = store.allocateSkill(acc.id, 'resilience', 'vitality_1');
    assert.equal(res.ok, false);
    assert.equal(res.error, 'already-learned');

    // Now allocate vitality_2
    res = store.allocateSkill(acc.id, 'resilience', 'vitality_2');
    assert.ok(res.ok);
    assert.equal(acc.skillPoints, 0);
    assert.equal(acc.skills.resilience.vitality_2, true);

    // Respec: costs 2 * 1500 = 3000 CR
    const respec = store.respecSkills(acc.id);
    assert.ok(respec.ok);
    assert.equal(respec.refunded, 2);
    assert.equal(respec.cost, 3000);
    assert.equal(acc.credits, 2000);
    assert.equal(acc.skillPoints, 2);
    assert.deepEqual(acc.skills.resilience, {});
});

test('Vendor Trust: tiers and level calculation', () => {
    const t0 = getVendorTrustLevel(0);
    assert.equal(t0.level, 1);
    assert.equal(t0.discount, 0);

    const t2 = getVendorTrustLevel(550);
    assert.equal(t2.level, 2);
    assert.equal(t2.discount, 0.05);

    const t3 = getVendorTrustLevel(1600);
    assert.equal(t3.level, 3);
    assert.equal(t3.discount, 0.10);

    const t4 = getVendorTrustLevel(3500);
    assert.equal(t4.level, 4);
    assert.equal(t4.discount, 0.15);
});

test('Contracts: accept, advance, and claim rewards', () => {
    const store = new AccountStore();
    const reg = store.register('Raider_ContractTest', 'pass12345');
    assert.ok(reg.ok);
    const acc = reg.account;

    // Accept contract
    let accRes = store.acceptContract(acc.id, 'contract_patrol_clear');
    assert.ok(accRes.ok);
    assert.equal(acc.contracts.active.length, 1);
    assert.equal(acc.contracts.active[0].id, 'contract_patrol_clear');

    // Duplicate accept fails
    accRes = store.acceptContract(acc.id, 'contract_patrol_clear');
    assert.equal(accRes.ok, false);
    assert.equal(accRes.error, 'already-active');

    // Claim before completion fails
    let claimRes = store.claimContract(acc.id, 'contract_patrol_clear');
    assert.equal(claimRes.ok, false);
    assert.equal(claimRes.error, 'contract-not-completed');

    // Simulate raid kill advancement
    acc.contracts.active[0].progress = 3;
    acc.contracts.active[0].completed = true;

    // Claim rewards: +400 XP, +800 CR, +150 Marco Trust
    const initialCredits = acc.credits;
    claimRes = store.claimContract(acc.id, 'contract_patrol_clear');
    assert.ok(claimRes.ok);
    assert.equal(acc.credits, initialCredits + 800);
    assert.equal(acc.vendorTrust.marco, 150);
    assert.equal(acc.contracts.active.length, 0);
    assert.equal(acc.contracts.completed.length, 1);
});

test('Workshop: station upgrades and item crafting', () => {
    const store = new AccountStore();
    const reg = store.register('Raider_WorkshopTest', 'pass12345');
    assert.ok(reg.ok);
    const acc = reg.account;

    // Setup materials & credits for Armory level 2 upgrade
    // Level 2 cost: 800 CR, 3x salvage_copper_1, 5x salvage_scrap_metal
    acc.credits = 3000;
    acc.stash = [
        { id: 'salvage_copper_1', count: 3 },
        { id: 'salvage_scrap_metal', count: 5 }
    ];

    let upRes = store.upgradeWorkshopStation(acc.id, 'armory');
    assert.ok(upRes.ok);
    assert.equal(upRes.newLevel, 2);
    assert.equal(acc.stationLevels.armory, 2);
    assert.equal(acc.credits, 2200);

    // Craft Rubezh-76 T1: cost 1200 CR, 6x salvage_scrap_metal, 3x salvage_copper_1
    acc.stash.push({ id: 'salvage_scrap_metal', count: 6 });
    acc.stash.push({ id: 'salvage_copper_1', count: 3 });

    let craftRes = store.craftItem(acc.id, 'craft_rubezh_t1');
    assert.ok(craftRes.ok);
    assert.equal(craftRes.item.id, 'rubezh_76_t1');
    assert.equal(acc.credits, 1000);
    assert.ok(acc.stash.some(it => it.id === 'rubezh_76_t1'));
});

test('Scavenger Kit: claim emergency kit when broke', () => {
    const store = new AccountStore();
    const reg = store.register('Raider_BrokeTest', 'pass12345');
    assert.ok(reg.ok);
    const acc = reg.account;

    // Strip weapons and credits
    acc.loadout.primary = null;
    acc.loadout.secondary = null;
    acc.stash = [];
    acc.credits = 100;

    let kitRes = store.claimFreeKit(acc.id);
    assert.ok(kitRes.ok);
    assert.ok(acc.loadout.secondary);
    assert.equal(acc.loadout.secondary.id, 'revolver_starter');
    assert.ok(acc.stash.length > 0);
});
