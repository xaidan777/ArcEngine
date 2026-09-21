import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

// Test 1: Loading via browser-scripts.mjs (classic script in VM)
const loaded = loadScripts(['js/audio/FoleySynth.js']);
const ProceduralFoleySynth = loaded.get('ProceduralFoleySynth');

test('ProceduralFoleySynth is exposed on window and global context', () => {
    assert.ok(ProceduralFoleySynth, 'ProceduralFoleySynth should be defined in script scope');
    assert.equal(typeof ProceduralFoleySynth, 'function', 'ProceduralFoleySynth should be a class constructor');
    assert.equal(loaded.ctx.window.ProceduralFoleySynth, ProceduralFoleySynth, 'Exposed on window.ProceduralFoleySynth');
});

test('ProceduralFoleySynth handles headless Node environment gracefully without AudioContext', () => {
    const synth = new ProceduralFoleySynth();
    assert.equal(synth.isSupported, false, 'isSupported is false when no AudioContext is present');
    assert.equal(synth.ctx, null);

    // Calling play methods should not throw and return safe fallback results
    const stepResult = synth.playFootstep('dirt', { velocity: 0.6 });
    assert.equal(stepResult.played, false);
    assert.equal(stepResult.surface, 'dirt');
    assert.equal(stepResult.type, 'footstep');

    const rustleResult = synth.playGearRustle({ intensity: 0.8 });
    assert.equal(rustleResult.played, false);
    assert.equal(rustleResult.type, 'gear_rustle');

    const launchResult = synth.playJumpLaunch({ velocity: 1.2 });
    assert.equal(launchResult.played, false);
    assert.equal(launchResult.type, 'jump_launch');

    const landResult = synth.playJumpLand('metal', { impactVelocity: 1.5 });
    assert.equal(landResult.played, false);
    assert.equal(landResult.type, 'jump_land');
    assert.equal(landResult.surface, 'metal');
});

test('Surface normalization and aliases', () => {
    assert.equal(ProceduralFoleySynth.normalizeSurface('dirt'), 'dirt');
    assert.equal(ProceduralFoleySynth.normalizeSurface('soil'), 'dirt');
    assert.equal(ProceduralFoleySynth.normalizeSurface('mud'), 'dirt');
    assert.equal(ProceduralFoleySynth.normalizeSurface('grass'), 'dirt');

    assert.equal(ProceduralFoleySynth.normalizeSurface('gravel'), 'gravel');
    assert.equal(ProceduralFoleySynth.normalizeSurface('rubble'), 'gravel');
    assert.equal(ProceduralFoleySynth.normalizeSurface('stone'), 'gravel');
    assert.equal(ProceduralFoleySynth.normalizeSurface('pebbles'), 'gravel');

    assert.equal(ProceduralFoleySynth.normalizeSurface('metal'), 'metal');
    assert.equal(ProceduralFoleySynth.normalizeSurface('gantry'), 'metal');
    assert.equal(ProceduralFoleySynth.normalizeSurface('grate'), 'metal');
    assert.equal(ProceduralFoleySynth.normalizeSurface('steel'), 'metal');

    assert.equal(ProceduralFoleySynth.normalizeSurface('concrete'), 'concrete');
    assert.equal(ProceduralFoleySynth.normalizeSurface('asphalt'), 'concrete');
    assert.equal(ProceduralFoleySynth.normalizeSurface('stone_slab'), 'concrete');
    assert.equal(ProceduralFoleySynth.normalizeSurface('unknown_surface'), 'concrete');
    assert.equal(ProceduralFoleySynth.normalizeSurface(null), 'concrete');
});

test('Procedural footsteps: dirt / soil synthesis with mock AudioContext', () => {
    const mockCtx = ProceduralFoleySynth.createMockContext();
    const synth = new ProceduralFoleySynth({ audioContext: mockCtx });
    assert.equal(synth.isSupported, true);

    const result = synth.playFootstep('soil', { velocity: 0.5, volume: 1.0 });
    assert.equal(result.played, true);
    assert.equal(result.surface, 'dirt');
    assert.equal(result.type, 'footstep');
    assert.ok(result.duration > 0);
    assert.ok(result.effectiveVelocity > 0);
    assert.ok(result.effectiveVolume > 0);
});

test('Procedural footsteps: gravel / rubble synthesis with distinct stone clatters', () => {
    const mockCtx = ProceduralFoleySynth.createMockContext();
    const synth = new ProceduralFoleySynth({ audioContext: mockCtx });

    // Walk (4 clatters)
    const walkResult = synth.playFootstep('gravel', { velocity: 0.5, sprint: false });
    assert.equal(walkResult.played, true);
    assert.equal(walkResult.surface, 'gravel');

    // Sprint (6 clatters and higher velocity)
    const sprintResult = synth.playFootstep('rubble', { velocity: 1.0, sprint: true });
    assert.equal(sprintResult.played, true);
    assert.equal(sprintResult.surface, 'gravel');
    assert.ok(sprintResult.effectiveVelocity > walkResult.effectiveVelocity);
    assert.ok(sprintResult.effectiveVolume > walkResult.effectiveVolume);
});

test('Procedural footsteps: metal / gantry synthesis with resonant ping and hollow clang', () => {
    const mockCtx = ProceduralFoleySynth.createMockContext();
    const synth = new ProceduralFoleySynth({ audioContext: mockCtx });

    const result = synth.playFootstep('gantry', { velocity: 0.7 });
    assert.equal(result.played, true);
    assert.equal(result.surface, 'metal');
    assert.equal(result.type, 'footstep');
    assert.ok(result.duration > 0.1);
});

test('Procedural footsteps: concrete synthesis with solid slap and reflection', () => {
    const mockCtx = ProceduralFoleySynth.createMockContext();
    const synth = new ProceduralFoleySynth({ audioContext: mockCtx });

    const result = synth.playFootstep('concrete', { velocity: 0.6, pan: 0.5 });
    assert.equal(result.played, true);
    assert.equal(result.surface, 'concrete');
    assert.equal(result.type, 'footstep');
    assert.ok(result.duration > 0.1);
});

test('Tactical movement foley: gear rustle on sprint and direction change', () => {
    const mockCtx = ProceduralFoleySynth.createMockContext();
    const synth = new ProceduralFoleySynth({ audioContext: mockCtx });

    const lowRustle = synth.playGearRustle({ intensity: 0.3 });
    const highRustle = synth.playGearRustle({ intensity: 0.9 });

    assert.equal(lowRustle.played, true);
    assert.equal(lowRustle.type, 'gear_rustle');
    assert.equal(highRustle.played, true);
    assert.equal(highRustle.type, 'gear_rustle');

    assert.ok(highRustle.effectiveVelocity > lowRustle.effectiveVelocity);
    assert.ok(highRustle.effectiveVolume > lowRustle.effectiveVolume);
    assert.ok(highRustle.duration >= lowRustle.duration);
});

test('Tactical movement foley: jump launch fabric tension and boot push', () => {
    const mockCtx = ProceduralFoleySynth.createMockContext();
    const synth = new ProceduralFoleySynth({ audioContext: mockCtx });

    const launch = synth.playJumpLaunch({ velocity: 1.2, surface: 'metal', pan: -0.3 });
    assert.equal(launch.played, true);
    assert.equal(launch.type, 'jump_launch');
    assert.equal(launch.surface, 'metal');
    assert.ok(launch.duration > 0.1);
});

test('Tactical movement foley: jump land heavy impact, surface crunch and gear rattle', () => {
    const mockCtx = ProceduralFoleySynth.createMockContext();
    const synth = new ProceduralFoleySynth({ audioContext: mockCtx });

    const lightLand = synth.playJumpLand('dirt', { impactVelocity: 0.5 });
    const heavyLand = synth.playJumpLand('concrete', { impactVelocity: 2.0 });

    assert.equal(lightLand.played, true);
    assert.equal(lightLand.type, 'jump_land');
    assert.equal(lightLand.surface, 'dirt');

    assert.equal(heavyLand.played, true);
    assert.equal(heavyLand.type, 'jump_land');
    assert.equal(heavyLand.surface, 'concrete');

    assert.ok(heavyLand.effectiveVelocity > lightLand.effectiveVelocity);
    assert.ok(heavyLand.effectiveVolume > lightLand.effectiveVolume);
});

test('Dynamic volume and velocity scaling across movements', () => {
    const mockCtx = ProceduralFoleySynth.createMockContext();
    const synth = new ProceduralFoleySynth({ audioContext: mockCtx });

    const walk = synth.playFootstep('concrete', { velocity: 0.4 });
    const sprint = synth.playFootstep('concrete', { velocity: 1.0, sprint: true });
    const land = synth.playJumpLand('concrete', { impactVelocity: 2.2 });

    assert.ok(sprint.effectiveVolume > walk.effectiveVolume, 'Sprint is louder than walk');
    assert.ok(land.effectiveVolume > sprint.effectiveVolume, 'Heavy landing impact is louder than sprint');
});

test('Master volume and disposal', () => {
    const mockCtx = ProceduralFoleySynth.createMockContext();
    const synth = new ProceduralFoleySynth({ audioContext: mockCtx, masterVolume: 0.8 });

    assert.equal(synth.getMasterVolume(), 0.8);
    synth.setMasterVolume(1.5);
    assert.equal(synth.getMasterVolume(), 1.5);

    synth.dispose();
    assert.equal(synth.isSupported, false);
    assert.equal(synth.ctx, null);
});
