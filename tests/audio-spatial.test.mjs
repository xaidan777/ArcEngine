// tests/audio-spatial.test.mjs — regression cover for the positional-audio defects.
//
// Reported symptom: "звук пропадает если стрелять вдаль, а если стрелять себе под ноги — идеально
// слышно". Root causes, all measured: the listener mirrored into the synths was in a swapped
// order (so every enemy shot measured thousands of px away and was culled), an impact range of
// 1000 px was shorter than the weapon's own reach, and impact points carried their height in `h`
// while the parser read `z`, dropping it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const scripts = loadScripts([
    'js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js',
    'js/audio/AudioCore.js', 'js/audio/WeaponSynth.js', 'js/audio/CombatSynth.js'
], { document: {} });

const Core = scripts.get('ProceduralAudioCore');
const WeaponSynth = scripts.get('ProceduralWeaponSynth');
const CombatSynth = scripts.get('ProceduralCombatSynth');

function core() {
    return new Core({ autoInit: false, autoUnlock: false });
}

// --- the listener is expressed in one convention ----------------------------

test('the core stores a numeric listener in the kit map order', () => {
    const c = core();
    // Game.update() supplies { x: mapX, y: HEIGHT, z: mapY }; ProceduralAudio normalises it.
    c.setListenerPosition(350, 3600, 60);
    assert.equal(typeof c.listenerPos.x, 'number');
    assert.equal(typeof c.listenerPos.y, 'number');
    assert.equal(typeof c.listenerPos.z, 'number');
    assert.deepEqual({ ...c.listenerPos }, { x: 350, y: 3600, z: 60 },
        'x = mapX, y = mapY, z = height — never a position object');
});

test('a nearby enemy shot is audible and a far one eventually is not', () => {
    const c = core();
    c.setListenerPosition(350, 3600, 60);

    // 400 px away: the case that used to measure 5337 px and be culled to silence.
    const near = c.calculateSpatialParameters({ x: 350, y: 4000 }, false);
    assert.equal(near.inAudibleRange, true, 'a bot 400 px away must be audible');
    assert.ok(near.gain > 0.1, `audible gain, got ${near.gain}`);

    // Beyond the configured gunfire range the sound is dropped, which is intended.
    const far = c.calculateSpatialParameters({ x: 350, y: 3600 + 5000 }, false);
    assert.equal(far.inAudibleRange, false);
    assert.equal(far.gain, 0);
});

test('an enemy at the same spot as the player is at full gain', () => {
    const c = core();
    c.setListenerPosition(1000, 1000, 40);
    const at = c.calculateSpatialParameters({ x: 1000, y: 1000, h: 40 }, false);
    assert.equal(at.inAudibleRange, true);
    assert.ok(at.gain >= 0.99, `point-blank gain, got ${at.gain}`);
});

// --- the weapon synth forwards the listener ---------------------------------

test('the weapon synth forwards the listener to its core as numbers', () => {
    const c = core();
    const synth = new WeaponSynth(c);
    // ProceduralAudio calls every synth with three numbers.
    synth.setListenerPosition(350, 3600, 60);
    assert.deepEqual({ ...c.listenerPos }, { x: 350, y: 3600, z: 60 });
    assert.equal(typeof c.listenerPos.x, 'number', 'never an object');
});

test('the weapon synth exposes setListenerPosition at all', () => {
    // The method was missing on this wrapper, so updateListener's typeof guard skipped it.
    const synth = new WeaponSynth(core());
    assert.equal(typeof synth.setListenerPosition, 'function');
    // Its arity must not be used to pick a call shape: defaulted params make fn.length 2.
    assert.equal(synth.setListenerPosition.length, 2);
});

// --- impact points keep their height ----------------------------------------

test('an impact point keeps the height it was given as `h`', () => {
    const combat = new CombatSynth(null);
    const parsed = combat._parsePos({ x: 350, y: 3700, h: 64 });
    assert.deepEqual({ ...parsed }, { x: 350, y: 3700, z: 64 },
        'h is the height; reading only `z` silently dropped it');
});

test('the impact parser still accepts array and plain-xyz positions', () => {
    const combat = new CombatSynth(null);
    assert.deepEqual({ ...combat._parsePos([1, 2, 3]) }, { x: 1, y: 2, z: 3 });
    assert.deepEqual({ ...combat._parsePos({ x: 4, y: 5, z: 6 }) }, { x: 4, y: 5, z: 6 });
    assert.equal(combat._parsePos(null), null);
});

// --- audible ranges cover the weapon's reach --------------------------------

test('the impact range covers the whole reach of a bullet', () => {
    const impactRange = scripts.get('GAME_IMPACT_AUDIO_RANGE');
    const hitscan = 1600;   // Game.fire's maxRange
    assert.ok(impactRange > hitscan,
        `an impact range of ${impactRange} px must exceed the ${hitscan} px the bullet can fly, ` +
        'because the attenuation curve reaches zero exactly at its range');
});

test('near impacts are not quieter than the previously shipped tuning', () => {
    const impactRange = scripts.get('GAME_IMPACT_AUDIO_RANGE');
    const volumeAt = (d, max) => Math.pow(Math.max(0, 1 - d / max), 2);
    // The old curve was (1 - d/1000)^2; the new one must be at least as loud close in.
    assert.ok(volumeAt(150, impactRange) >= volumeAt(150, 1000), '150 px');
    assert.ok(volumeAt(300, impactRange) >= volumeAt(300, 1000), '300 px');
    // And audible where the old curve had already hit zero.
    assert.ok(volumeAt(1000, impactRange) > 0.1, 'an impact at 1000 px must be heard');
});

test('the gunfire range is far wider than a single engagement', () => {
    const shotRange = scripts.get('GAME_SHOT_AUDIO_RANGE');
    assert.ok(shotRange >= 3000, `gunfire must carry across the map, got ${shotRange} px`);
});

test('every configured audio range is a positive finite number', () => {
    for (const name of ['GAME_IMPACT_AUDIO_RANGE', 'GAME_WHIZ_AUDIO_RANGE', 'GAME_RICOCHET_AUDIO_RANGE', 'GAME_SHOT_AUDIO_RANGE']) {
        const value = scripts.get(name);
        assert.equal(typeof value, 'number', `${name} must be declared`);
        assert.ok(Number.isFinite(value) && value > 0, `${name} must be positive, got ${value}`);
    }
});