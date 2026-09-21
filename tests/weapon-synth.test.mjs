import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScripts } from './browser-scripts.mjs';
import { ProceduralAudioCore, ProceduralWeaponSynth } from '../js/audio/WeaponSynth.js';

/**
 * Creates a mock Web Audio API AudioContext for testing audio node graph construction.
 */
function createMockAudioContext() {
    const createdNodes = [];

    const createParam = (defaultValue = 0) => ({
        value: defaultValue,
        setValueAtTime: (v, t) => {},
        exponentialRampToValueAtTime: (v, t) => {},
        linearRampToValueAtTime: (v, t) => {},
    });

    const mockCtx = {
        state: 'running',
        currentTime: 0.1,
        sampleRate: 44100,
        destination: { id: 'destination' },
        resume: async () => { mockCtx.state = 'running'; },
        createGain: () => {
            const node = {
                nodeKind: 'gain',
                gain: createParam(1.0),
                connect: (target) => { node.connectedTo = target; },
                disconnect: () => {},
            };
            createdNodes.push(node);
            return node;
        },
        createOscillator: () => {
            const node = {
                nodeKind: 'oscillator',
                frequency: createParam(440),
                type: 'sine',
                connect: (target) => { node.connectedTo = target; },
                disconnect: () => {},
                start: (t) => { node.startedAt = t; },
                stop: (t) => { node.stoppedAt = t; },
            };
            createdNodes.push(node);
            return node;
        },
        createBiquadFilter: () => {
            const node = {
                nodeKind: 'biquadFilter',
                frequency: createParam(1000),
                Q: createParam(1),
                type: 'lowpass',
                connect: (target) => { node.connectedTo = target; },
                disconnect: () => {},
            };
            createdNodes.push(node);
            return node;
        },
        createWaveShaper: () => {
            const node = {
                nodeKind: 'waveShaper',
                curve: null,
                connect: (target) => { node.connectedTo = target; },
                disconnect: () => {},
            };
            createdNodes.push(node);
            return node;
        },
        createBuffer: (channels, length, sampleRate) => {
            const channelData = [new Float32Array(length)];
            return {
                numberOfChannels: channels,
                length,
                sampleRate,
                duration: length / sampleRate,
                getChannelData: (ch) => channelData[ch] || channelData[0],
            };
        },
        createBufferSource: () => {
            const node = {
                nodeKind: 'bufferSource',
                buffer: null,
                loop: false,
                connect: (target) => { node.connectedTo = target; },
                disconnect: () => {},
                start: (t) => { node.startedAt = t; },
                stop: (t) => { node.stoppedAt = t; },
            };
            createdNodes.push(node);
            return node;
        },
        createStereoPanner: () => {
            const node = {
                nodeKind: 'stereoPanner',
                pan: createParam(0),
                connect: (target) => { node.connectedTo = target; },
                disconnect: () => {},
            };
            createdNodes.push(node);
            return node;
        },
    };

    return { mockCtx, createdNodes };
}

test('ProceduralAudioCore: initialization, noise buffers, and distortion curves', () => {
    const { mockCtx, createdNodes } = createMockAudioContext();
    const core = new ProceduralAudioCore();

    assert.equal(core.ctx, null);
    assert.equal(ProceduralAudioCore.isSupported(), false); // In Node environment without window.AudioContext

    const initialized = core.init(mockCtx);
    assert.equal(initialized, true);
    assert.equal(core.ctx, mockCtx);
    assert.ok(core.masterGain, 'Master gain must be created');
    assert.ok(core.sfxGain, 'SFX gain must be created');
    assert.ok(core.weaponGain, 'Weapon gain must be created');

    assert.ok(core.whiteNoiseBuffer, 'White noise buffer must be generated');
    assert.ok(core.pinkNoiseBuffer, 'Pink noise buffer must be generated');
    assert.ok(core.brownNoiseBuffer, 'Brown noise buffer must be generated');
    assert.ok(core.softClipCurve, 'Soft clip distortion curve must be generated');
    assert.ok(core.hardClipCurve, 'Hard clip distortion curve must be generated');
    assert.equal(core.softClipCurve.length, 1024);
});

test('ProceduralAudioCore: spatial parameter calculation for 2D and 3D positions', () => {
    const core = new ProceduralAudioCore();
    core.setListenerPosition({ x: 100, y: 100, z: 0 }, 0);

    // Player sound: no attenuation, full frequency, center panned
    const playerParams = core.calculateSpatialParameters({ x: 500, y: 800 }, true);
    assert.equal(playerParams.gain, 1.0);
    assert.equal(playerParams.filterFreq, 20000);
    assert.equal(playerParams.pan, 0.0);
    assert.equal(playerParams.inAudibleRange, true);

    // Non-player sound nearby (100 units away along X)
    const nearParams = core.calculateSpatialParameters({ x: 200, y: 100, z: 0 }, false);
    assert.ok(nearParams.gain > 0.8, 'Near sound should retain high gain');
    assert.ok(nearParams.filterFreq > 14000, 'Near sound should have high cutoff');
    assert.ok(nearParams.pan > 0, 'Sound to the right should pan positive');

    // Non-player sound far away (1500 units)
    const farParams = core.calculateSpatialParameters({ x: 1600, y: 100, z: 20 }, false);
    assert.ok(farParams.gain < 0.2, 'Far sound should be strongly attenuated');
    assert.ok(farParams.filterFreq < 5000, 'Far sound should have significant air absorption filtering');

    // Sound beyond max range (4000 units away)
    const distantParams = core.calculateSpatialParameters({ x: 4500, y: 100, z: 0 }, false);
    assert.equal(distantParams.inAudibleRange, false);
    assert.equal(distantParams.gain, 0);

    // 3D position using 'h' height property
    const heightParams = core.calculateSpatialParameters({ x: 200, y: 100, h: 50 }, false);
    assert.ok(heightParams.inAudibleRange);
});

test('ProceduralWeaponSynth: playAssaultRifle with layers and tier scaling', () => {
    const { mockCtx, createdNodes } = createMockAudioContext();
    const core = new ProceduralAudioCore();
    core.init(mockCtx);
    const synth = new ProceduralWeaponSynth(core);

    // Test Tier 2 (Standard)
    const resultT2 = synth.playAssaultRifle({ x: 0, y: 0 }, true, 2);
    assert.equal(resultT2.played, true);
    assert.ok(resultT2.duration > 0.35);

    // Verify nodes created for layers:
    // Layer a: boltSource, boltFilter, boltGain, lockSource, lockFilter, lockGain
    // Layer b: punchOsc, punchDistortion, punchGain
    // Layer c: brownSource, brownFilter, brownGain, thumpOsc, thumpGain
    // Layer d: tailSource, tailFilter, tailGain
    const oscillators = createdNodes.filter(n => n.nodeKind === 'oscillator');
    const filters = createdNodes.filter(n => n.nodeKind === 'biquadFilter');
    const buffers = createdNodes.filter(n => n.nodeKind === 'bufferSource');
    const waveShapers = createdNodes.filter(n => n.nodeKind === 'waveShaper');

    assert.ok(oscillators.length >= 2, 'Assault rifle requires punch and sub-thump oscillators');
    assert.ok(filters.length >= 4, 'Assault rifle requires bolt, lock, sub-lowpass, and tail filters');
    assert.ok(buffers.length >= 3, 'Assault rifle requires metallic and noise buffers');
    assert.ok(waveShapers.length >= 1, 'Assault rifle requires soft-clip wave shaper');

    // Test Tier 4 (ARC Hybrid with accelerator sizzle)
    const nodeCountBeforeT4 = createdNodes.length;
    const resultT4 = synth.playAssaultRifle({ x: 0, y: 0 }, true, 'IV');
    assert.equal(resultT4.played, true);
    const nodeCountAfterT4 = createdNodes.length;
    assert.ok(nodeCountAfterT4 - nodeCountBeforeT4 > 10, 'Tier IV should generate additional energy sizzle nodes');
});

test('ProceduralWeaponSynth: playShotgun (Vulcano) with pump rack and granular crackle', () => {
    const { mockCtx, createdNodes } = createMockAudioContext();
    const core = new ProceduralAudioCore();
    core.init(mockCtx);
    const synth = new ProceduralWeaponSynth(core);

    const result = synth.playShotgun({ x: 50, y: 50 }, true);
    assert.equal(result.played, true);
    assert.ok(result.duration >= 0.5);

    const waveShapers = createdNodes.filter(n => n.nodeKind === 'waveShaper');
    assert.ok(waveShapers.length >= 1, 'Shotgun requires saturated punch distortion');

    const filters = createdNodes.filter(n => n.nodeKind === 'biquadFilter');
    assert.ok(filters.length >= 3, 'Shotgun requires spread crackle and 2-stage pump rack filters');
});

test('ProceduralWeaponSynth: playRevolver (Revolver I/II) with snap and brass ring', () => {
    const { mockCtx, createdNodes } = createMockAudioContext();
    const core = new ProceduralAudioCore();
    core.init(mockCtx);
    const synth = new ProceduralWeaponSynth(core);

    const result = synth.playRevolver({ x: 0, y: 0 }, true);
    assert.equal(result.played, true);
    assert.ok(result.duration >= 0.4);

    const oscillators = createdNodes.filter(n => n.nodeKind === 'oscillator');
    // Expect hammer drop osc, punch osc, and brass ring osc
    assert.ok(oscillators.length >= 3, 'Revolver requires hammer, punch, and brass ring oscillators');
});

test('ProceduralWeaponSynth: playSMG (Rattler) with rapid punch and cycle return', () => {
    const { mockCtx, createdNodes } = createMockAudioContext();
    const core = new ProceduralAudioCore();
    core.init(mockCtx);
    const synth = new ProceduralWeaponSynth(core);

    const result = synth.playSMG({ x: 0, y: 0 }, true);
    assert.equal(result.played, true);
    assert.ok(result.duration >= 0.2 && result.duration <= 0.3);

    const filters = createdNodes.filter(n => n.nodeKind === 'biquadFilter');
    assert.ok(filters.length >= 3, 'SMG requires snap, bolt click, and cycle return filters');
});

test('ProceduralWeaponSynth: playPlasma (ARC energy weapon) with FM synthesis and sub-drop', () => {
    const { mockCtx, createdNodes } = createMockAudioContext();
    const core = new ProceduralAudioCore();
    core.init(mockCtx);
    const synth = new ProceduralWeaponSynth(core);

    const result = synth.playPlasma({ x: 0, y: 0 }, true);
    assert.equal(result.played, true);
    assert.ok(result.duration >= 0.35);

    const oscillators = createdNodes.filter(n => n.nodeKind === 'oscillator');
    // Expect carrier, modulator, chirp, and sub-drop oscillators
    assert.ok(oscillators.length >= 4, 'Plasma requires carrier, modulator, chirp, and sub oscillators');
});

test('ProceduralWeaponSynth: Node.js environment safety without AudioContext', () => {
    // Instantiating synth with empty core in Node.js must not throw
    const synth = new ProceduralWeaponSynth();
    assert.doesNotThrow(() => {
        const r1 = synth.playAssaultRifle({ x: 10, y: 10 }, false);
        assert.equal(r1.played, false);
        const r2 = synth.playShotgun();
        assert.equal(r2.played, false);
        const r3 = synth.playRevolver();
        assert.equal(r3.played, false);
        const r4 = synth.playSMG();
        assert.equal(r4.played, false);
        const r5 = synth.playPlasma();
        assert.equal(r5.played, false);
    });
});

test('WeaponSynth browser integration: exposes ProceduralWeaponSynth on window', () => {
    const { get } = loadScripts([
        'js/Constants.js',
        'js/audio/WeaponSynth.js',
    ]);

    const CoreClass = get('window.ProceduralAudioCore');
    const SynthClass = get('window.ProceduralWeaponSynth');

    assert.ok(CoreClass, 'window.ProceduralAudioCore must be defined');
    assert.ok(SynthClass, 'window.ProceduralWeaponSynth must be defined');

    const synth = new SynthClass();
    assert.ok(synth, 'Must instantiate ProceduralWeaponSynth from window');
    assert.ok(typeof synth.playAssaultRifle === 'function');
    assert.ok(typeof synth.playShotgun === 'function');
    assert.ok(typeof synth.playRevolver === 'function');
    assert.ok(typeof synth.playSMG === 'function');
    assert.ok(typeof synth.playPlasma === 'function');
});
