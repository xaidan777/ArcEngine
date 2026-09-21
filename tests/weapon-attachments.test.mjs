// tests/weapon-attachments.test.mjs — Unit tests for weapon attachments, effective stats, and modularity.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const scripts = loadScripts(['js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js'], { document: {} });
const rules = scripts.get('RaidRules');
const ARC_ITEMS = scripts.get('ARC_ITEMS');
const ARC_ATTACHMENTS = scripts.get('ARC_ATTACHMENTS');
const ARC_ATTACHMENT_SLOTS = scripts.get('ARC_ATTACHMENT_SLOTS');

test('ARC_ATTACHMENTS registry defines all tactical modules with required properties', () => {
    assert.ok(ARC_ATTACHMENTS, 'ARC_ATTACHMENTS must be defined');
    const expected = [
        'optic_kobra', 'optic_prism_4x',
        'muzzle_brake', 'muzzle_suppressor',
        'mag_extended', 'mag_quick',
        'stock_folding', 'stock_heavy'
    ];

    for (const id of expected) {
        const mod = ARC_ATTACHMENTS[id];
        assert.ok(mod, `Attachment ${id} must exist in registry`);
        assert.equal(mod.category, 'attachments');
        assert.ok(mod.slotType, `Attachment ${id} must have a slotType`);
        assert.ok(mod.name, `Attachment ${id} must have a name`);
        assert.ok(mod.nameRu, `Attachment ${id} must have a Russian name`);
        assert.ok(typeof mod.weight === 'number' && mod.weight >= 0, `Attachment ${id} must have numeric weight`);
    }

    assert.equal(ARC_ATTACHMENTS.optic_prism_4x.zoom, 4.0);
    assert.equal(ARC_ATTACHMENTS.muzzle_suppressor.muzzleFlash, false);
    assert.equal(ARC_ATTACHMENTS.muzzle_suppressor.noiseMult, 0.40);
    assert.equal(ARC_ATTACHMENTS.mag_extended.magCapacityMult, 1.5);
});

test('RaidRules.canAttach validates slot compatibility for weapons', () => {
    const weapon = {
        id: 'test_rifle',
        name: 'TEST RIFLE',
        compatibleSlots: ['optic', 'muzzle', 'mag', 'stock']
    };

    assert.equal(rules.canAttach(weapon, ARC_ATTACHMENTS.optic_kobra), true);
    assert.equal(rules.canAttach(weapon, ARC_ATTACHMENTS.muzzle_suppressor), true);
    assert.equal(rules.canAttach(weapon, ARC_ATTACHMENTS.mag_extended), true);
    assert.equal(rules.canAttach(weapon, ARC_ATTACHMENTS.stock_heavy), true);

    // Incompatible slot test
    const restrictedWeapon = {
        id: 'test_sidearm',
        name: 'TEST PISTOL',
        compatibleSlots: ['optic', 'muzzle'] // no mag or stock
    };
    assert.equal(rules.canAttach(restrictedWeapon, ARC_ATTACHMENTS.optic_kobra), true);
    assert.equal(rules.canAttach(restrictedWeapon, ARC_ATTACHMENTS.mag_extended), false);
    assert.equal(rules.canAttach(restrictedWeapon, ARC_ATTACHMENTS.stock_heavy), false);
});

test('RaidRules.getWeaponEffectiveStats accurately calculates stock weapon stats', () => {
    const baseRifle = {
        id: 'rubezh_t2',
        damage: 42,
        fireRate: 65,
        range: 80,
        magSize: 30,
        weight: 4.6
    };

    const stats = rules.getWeaponEffectiveStats(baseRifle);
    assert.equal(stats.damage, 42);
    assert.equal(stats.fireRate, 65);
    assert.equal(stats.range, 80);
    assert.equal(stats.magSize, 30);
    assert.equal(stats.weight, 4.6);
    assert.equal(stats.recoilMult, 1.0);
    assert.equal(stats.adsTimeMult, 1.0);
    assert.equal(stats.swayMult, 1.0);
    assert.equal(stats.noiseMult, 1.0);
    assert.equal(stats.zoom, 1.0);
    assert.equal(stats.muzzleFlash, true);
    assert.equal(stats.reloadTimeMult, 1.0);
});

test('RaidRules.getWeaponEffectiveStats applies tactical attachments correctly', () => {
    const baseRifle = {
        id: 'rubezh_t2',
        damage: 42,
        fireRate: 65,
        range: 80,
        magSize: 30,
        weight: 4.6
    };

    // Attach Suppressor + Extended Mag + 4X Prism + Heavy Stock
    const mods = {
        optic: ARC_ATTACHMENTS.optic_prism_4x,
        muzzle: ARC_ATTACHMENTS.muzzle_suppressor,
        mag: ARC_ATTACHMENTS.mag_extended,
        stock: ARC_ATTACHMENTS.stock_heavy
    };

    const stats = rules.getWeaponEffectiveStats(baseRifle, mods);

    // Zoom and Range from 4X Prism & Suppressor
    assert.equal(stats.zoom, 4.0);
    assert.ok(stats.range > 80, 'Range should be boosted by optic and suppressor');

    // Muzzle flash disabled and noise reduced by Suppressor
    assert.equal(stats.muzzleFlash, false);
    assert.equal(stats.noiseMult, 0.40);

    // Magazine capacity expanded by 50% (30 * 1.5 = 45)
    assert.equal(stats.magSize, 45);

    // Recoil reduced by Heavy Stock & Suppressor
    assert.ok(stats.recoilMult < 1.0, 'Recoil multiplier should be less than 1.0');

    // Weight increased by all 4 attachments
    const expectedWeight = 4.6 + ARC_ATTACHMENTS.optic_prism_4x.weight
        + ARC_ATTACHMENTS.muzzle_suppressor.weight
        + ARC_ATTACHMENTS.mag_extended.weight
        + ARC_ATTACHMENTS.stock_heavy.weight;
    assert.equal(stats.weight, Math.round(expectedWeight * 10) / 10);
});

test('RaidRules.attachModule and detachModule correctly modify weapon attachments in-place', () => {
    const rifle = {
        id: 'tempest_ii',
        name: 'TEMPEST II',
        damage: 34,
        magSize: 20,
        compatibleSlots: ['optic', 'muzzle', 'mag', 'stock']
    };

    // Attach Kobra optic
    const prev1 = rules.attachModule(rifle, 'optic', ARC_ATTACHMENTS.optic_kobra);
    assert.equal(prev1, null, 'Previous attachment should be null');
    assert.ok(rifle.attachments && rifle.attachments.optic);
    assert.equal(rifle.attachments.optic.id, 'optic_kobra');

    // Swap Kobra for 4X Prism
    const prev2 = rules.attachModule(rifle, 'optic', ARC_ATTACHMENTS.optic_prism_4x);
    assert.ok(prev2, 'Should return replaced attachment');
    assert.equal(prev2.id, 'optic_kobra');
    assert.equal(rifle.attachments.optic.id, 'optic_prism_4x');

    // Detach 4X Prism
    const detached = rules.detachModule(rifle, 'optic');
    assert.ok(detached);
    assert.equal(detached.id, 'optic_prism_4x');
    assert.equal(rifle.attachments.optic, null);
});
