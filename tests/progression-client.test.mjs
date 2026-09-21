import test from 'node:test';
import assert from 'node:assert/strict';
import ProgressionSystem from '../js/ProgressionSystem.js';
import { SKILL_TREE, CONTRACT_DEFINITIONS, getVendorTrustLevel } from '../server/progression.mjs';

test('Client ProgressionSystem: state initialization and updates', () => {
    assert.ok(ProgressionSystem);
    assert.equal(typeof ProgressionSystem.updateFromServer, 'function');

    ProgressionSystem.updateFromServer({
        level: 4,
        xp: 1800,
        skillPoints: 3,
        skills: {
            resilience: { vitality_1: true },
            agility: {},
            scavenging: {}
        },
        skillTree: SKILL_TREE,
        vendorTrust: {
            marco: getVendorTrustLevel(600),
            elena: getVendorTrustLevel(0),
            bruno: getVendorTrustLevel(1600),
            sofia: getVendorTrustLevel(3200)
        }
    });

    assert.equal(ProgressionSystem.state.level, 4);
    assert.equal(ProgressionSystem.state.xp, 1800);
    assert.equal(ProgressionSystem.state.skillPoints, 3);
    assert.equal(ProgressionSystem.isSkillLearned('resilience', 'vitality_1'), true);
    assert.equal(ProgressionSystem.isSkillLearned('resilience', 'vitality_2'), false);

    // Can learn vitality_2 because vitality_1 is learned and SP > 0
    assert.equal(ProgressionSystem.canLearnSkill('resilience', 'vitality_2'), true);

    // Cannot learn armor_plating because vitality_2 is not learned yet
    assert.equal(ProgressionSystem.canLearnSkill('resilience', 'armor_plating'), false);

    // Can learn sprinter in agility branch (tier 1, no requirement)
    assert.equal(ProgressionSystem.canLearnSkill('agility', 'sprinter'), true);
});

test('Client ProgressionSystem: getActiveBonuses aggregation', () => {
    ProgressionSystem.updateFromServer({
        skills: {
            resilience: { vitality_1: true, vitality_2: true, armor_plating: true },
            agility: { endurance_1: true, sprinter: true, pack_mule_1: true },
            scavenging: { salvage_eye_1: true, safe_pocket_plus: true }
        },
        skillTree: SKILL_TREE
    });

    const bonuses = ProgressionSystem.getActiveBonuses();
    // vitality_1 (+10) + vitality_2 (+15) = 25 HP
    assert.equal(bonuses.maxHp, 25);
    // armor_plating: 0.15 damage reduction
    assert.equal(bonuses.damageReduction, 0.15);
    // endurance_1: +20 stamina
    assert.equal(bonuses.maxStamina, 20);
    // sprinter: +0.08 sprint speed
    assert.equal(bonuses.sprintSpeedMult, 0.08);
    // pack_mule_1: +5 kg carry weight
    assert.equal(bonuses.carryWeightBonus, 5);
    // salvage_eye_1: +0.10 loot value
    assert.equal(bonuses.lootValueBonus, 0.10);
    // safe_pocket_plus: +1 safe pocket slot
    assert.equal(bonuses.extraSafePocketSlots, 1);
});

test('Client ProgressionSystem: vendor trust discount calculation', () => {
    ProgressionSystem.updateFromServer({
        vendorTrust: {
            marco: { level: 2, trust: 600, discount: 0.05 },
            elena: { level: 1, trust: 100, discount: 0 },
            bruno: { level: 3, trust: 1700, discount: 0.10 },
            sofia: { level: 4, trust: 3500, discount: 0.15 }
        }
    });

    assert.equal(ProgressionSystem.getVendorDiscount('marco'), 0.05);
    assert.equal(ProgressionSystem.getVendorDiscount('elena'), 0);
    assert.equal(ProgressionSystem.getVendorDiscount('bruno'), 0.10);
    assert.equal(ProgressionSystem.getVendorDiscount('sofia'), 0.15);
});
