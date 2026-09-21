import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

// Create a realistic Web Audio API mock for Node.js test environment
function createMockAudioContext() {
    let currentTime = 0.0;
    const createdNodes = [];

    class MockAudioParam {
        constructor(defaultValue = 0) {
            this.value = defaultValue;
            this.timeline = [];
        }
        setValueAtTime(val, time) {
            this.value = val;
            this.timeline.push({ type: 'set', value: val, time });
            return this;
        }
        linearRampToValueAtTime(val, time) {
            this.timeline.push({ type: 'linear', value: val, time });
            return this;
        }
        exponentialRampToValueAtTime(val, time) {
            this.timeline.push({ type: 'exponential', value: val, time });
            return this;
        }
    }

    class MockAudioNode {
        constructor(type) {
            this.nodeType = type;
            this.connectedTo = [];
            createdNodes.push(this);
        }
        connect(target) {
            this.connectedTo.push(target);
            return target;
        }
        disconnect() {
            this.connectedTo = [];
        }
    }

    class MockGainNode extends MockAudioNode {
        constructor() {
            super('GainNode');
            this.gain = new MockMockGainParam(1.0);
        }
    }

    class MockMockGainParam extends MockAudioParam {
        constructor(v) {
            super(v);
        }
    }

    class MockOscillatorNode extends MockAudioNode {
        constructor() {
            super('OscillatorNode');
            this.type = 'sine';
            this.frequency = new MockAudioParam(440);
            this.started = false;
            this.stopped = false;
            this.startTime = null;
            this.stopTime = null;
        }
        start(t = 0) {
            this.started = true;
            this.startTime = t;
        }
        stop(t = 0) {
            this.stopped = true;
            this.stopTime = t;
        }
    }

    class MockBiquadFilterNode extends MockAudioNode {
        constructor() {
            super('BiquadFilterNode');
            this.type = 'lowpass';
            this.frequency = new MockAudioParam(350);
            this.Q = new MockAudioParam(1);
        }
    }

    class MockBufferSourceNode extends MockAudioNode {
        constructor() {
            super('AudioBufferSourceNode');
            this.buffer = null;
            this.loop = false;
            this.started = false;
            this.stopped = false;
        }
        start(t = 0) {
            this.started = true;
        }
        stop(t = 0) {
            this.stopped = true;
        }
    }

    class MockStereoPannerNode extends MockAudioNode {
        constructor() {
            super('StereoPannerNode');
            this.pan = new MockAudioParam(0);
        }
    }

    class MockAudioBuffer {
        constructor(numberOfChannels, length, sampleRate) {
            this.numberOfChannels = numberOfChannels;
            this.length = length;
            this.sampleRate = sampleRate;
            this._data = new Float32Array(length);
        }
        getChannelData() {
            return this._data;
        }
    }

    return {
        sampleRate: 44100,
        get currentTime() { return currentTime; },
        set currentTime(v) { currentTime = v; },
        state: 'running',
        destination: new MockAudioNode('Destination'),
        resume: async () => {},
        createGain: () => new MockGainNode(),
        createOscillator: () => new MockOscillatorNode(),
        createBiquadFilter: () => new MockBiquadFilterNode(),
        createBufferSource: () => new MockBufferSourceNode(),
        createBuffer: (ch, len, rate) => new MockAudioBuffer(ch, len, rate),
        createStereoPanner: () => new MockStereoPannerNode(),
        getCreatedNodes: () => createdNodes,
        clearCreatedNodes: () => { createdNodes.length = 0; }
    };
}

const ProceduralCombatSynth = loadScripts(['js/audio/CombatSynth.js']).get('ProceduralCombatSynth');

test('ProceduralCombatSynth exports and attaches to window', () => {
    assert.ok(ProceduralCombatSynth);
    assert.equal(typeof ProceduralCombatSynth, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playMagOut, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playMagIn, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playBoltRack, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playDryFire, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playBulletWhiz, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playRicochet, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playImpact, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playShieldHit, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playShieldBreak, 'function');
    assert.equal(typeof ProceduralCombatSynth.prototype.playShieldRecharge, 'function');
});

test('ProceduralCombatSynth handles null audio context gracefully without throwing', () => {
    const synth = new ProceduralCombatSynth(null);
    assert.equal(synth.ctx, null);

    assert.doesNotThrow(() => {
        assert.equal(synth.playMagOut(), null);
        assert.equal(synth.playMagIn(), null);
        assert.equal(synth.playBoltRack(), null);
        assert.equal(synth.playDryFire(), null);
        assert.equal(synth.playBulletWhiz({ x: 100, y: 100 }), null);
        assert.equal(synth.playRicochet({ x: 50, y: 50 }), null);
        assert.equal(synth.playImpact('metal', { x: 0, y: 0 }), null);
        assert.equal(synth.playShieldHit(), null);
        assert.equal(synth.playShieldBreak(), null);
        assert.equal(synth.playShieldRecharge(true), null);
        assert.equal(synth.playShieldRecharge(false), null);
    });
});

test('Weapon handling: playMagOut synthesizes tactile click and friction slide', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);

    const res = synth.playMagOut();
    assert.equal(res, true);

    const nodes = mockCtx.getCreatedNodes();
    const oscs = nodes.filter(n => n.nodeType === 'OscillatorNode');
    const noiseSources = nodes.filter(n => n.nodeType === 'AudioBufferSourceNode');
    const filters = nodes.filter(n => n.nodeType === 'BiquadFilterNode');

    assert.ok(oscs.length >= 2, 'Should create mechanical click and tactile thump oscillators');
    assert.ok(noiseSources.length >= 1, 'Should create friction slide noise');
    assert.ok(filters.some(f => f.type === 'bandpass'), 'Should have bandpass filter for mag friction slide');
});

test('Weapon handling: playMagIn synthesizes heavy insertion snap and spring catch', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);

    const res = synth.playMagIn();
    assert.equal(res, true);

    const nodes = mockCtx.getCreatedNodes();
    const oscs = nodes.filter(n => n.nodeType === 'OscillatorNode');
    const filters = nodes.filter(n => n.nodeType === 'BiquadFilterNode');

    assert.ok(oscs.length >= 3, 'Should create heavy thump, metal chime, and spring catch oscillators');
    assert.ok(filters.length >= 1, 'Should create bandpass filters for metallic contact and spring snap');
});

test('Weapon handling: playBoltRack synthesizes two-part slide and chamber lock', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);

    const res = synth.playBoltRack();
    assert.equal(res, true);

    const nodes = mockCtx.getCreatedNodes();
    const oscs = nodes.filter(n => n.nodeType === 'OscillatorNode');
    const noiseSources = nodes.filter(n => n.nodeType === 'AudioBufferSourceNode');

    assert.ok(noiseSources.length >= 2, 'Should create backward rack and forward slide noise');
    assert.ok(oscs.some(o => o.startTime > mockCtx.currentTime + 0.1), 'Should have delayed chamber lock part');
});

test('Weapon handling: playDryFire synthesizes hollow metallic hammer click', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);

    const res = synth.playDryFire();
    assert.equal(res, true);

    const nodes = mockCtx.getCreatedNodes();
    const oscs = nodes.filter(n => n.nodeType === 'OscillatorNode');

    const hollowOsc = oscs.find(o => Math.abs(o.frequency.value - 530) < 50);
    assert.ok(hollowOsc, 'Should contain hollow chamber resonance frequency around 530Hz');
});

test('Projectile sounds: playBulletWhiz creates supersonic snap, Doppler whip, and spatial node', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);
    synth.setListenerPosition(0, 0, 0);

    const res = synth.playBulletWhiz({ x: 150, y: 0 });
    assert.equal(res, true);

    const nodes = mockCtx.getCreatedNodes();
    const panners = nodes.filter(n => n.nodeType === 'StereoPannerNode');
    const filters = nodes.filter(n => n.nodeType === 'BiquadFilterNode');

    assert.equal(panners.length, 1, 'Should create stereo panner for bullet near miss');
    assert.ok(panners[0].pan.value > 0, 'Sound on the right should have positive pan');
    assert.ok(filters.some(f => f.type === 'bandpass'), 'Should have bandpass filter for Doppler whip');
});

test('Projectile sounds: playRicochet synthesizes frequency-modulated zing', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);

    const res = synth.playRicochet({ x: -100, y: 50 });
    assert.equal(res, true);

    const nodes = mockCtx.getCreatedNodes();
    const oscs = nodes.filter(n => n.nodeType === 'OscillatorNode');
    const panners = nodes.filter(n => n.nodeType === 'StereoPannerNode');

    assert.ok(oscs.length >= 2, 'FM synthesis requires carrier and modulator oscillators');
    assert.equal(panners.length, 1);
    assert.ok(panners[0].pan.value < 0, 'Sound on the left should have negative pan');
});

test('Impact sounds: playImpact differentiates metal, dirt, and concrete surfaces', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);

    // Metal impact
    mockCtx.clearCreatedNodes();
    assert.equal(synth.playImpact('metal', { x: 0, y: 50 }), true);
    const metalNodes = [...mockCtx.getCreatedNodes()];
    const metalOscs = metalNodes.filter(n => n.nodeType === 'OscillatorNode');
    assert.ok(metalOscs.some(o => o.frequency.value > 2000), 'Metal impact should have high resonant rings');

    // Dirt impact
    mockCtx.clearCreatedNodes();
    assert.equal(synth.playImpact('dirt', { x: 0, y: 50 }), true);
    const dirtNodes = [...mockCtx.getCreatedNodes()];
    const dirtFilters = dirtNodes.filter(n => n.nodeType === 'BiquadFilterNode');
    assert.ok(dirtFilters.some(f => f.type === 'lowpass'), 'Dirt impact should have heavy lowpass earth filter');

    // Concrete impact
    mockCtx.clearCreatedNodes();
    assert.equal(synth.playImpact('concrete', { x: 0, y: 50 }), true);
    const concreteNodes = [...mockCtx.getCreatedNodes()];
    assert.ok(concreteNodes.some(n => n.nodeType === 'AudioBufferSourceNode'), 'Concrete impact should have brittle chip noise');
});

test('Tactical shield: playShieldHit synthesizes crystalline energy disruption crackle', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);

    const res = synth.playShieldHit();
    assert.equal(res, true);

    const nodes = mockCtx.getCreatedNodes();
    const oscs = nodes.filter(n => n.nodeType === 'OscillatorNode');
    const noiseSources = nodes.filter(n => n.nodeType === 'AudioBufferSourceNode');

    assert.ok(oscs.length >= 3, 'Should create crystalline harmonic cluster');
    assert.ok(noiseSources.length >= 3, 'Should create rapid disruption crackle micro-discharges');
});

test('Tactical shield: playShieldBreak synthesizes EMP blast, glass resonance, and failure tone', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);

    const res = synth.playShieldBreak();
    assert.equal(res, true);

    const nodes = mockCtx.getCreatedNodes();
    const oscs = nodes.filter(n => n.nodeType === 'OscillatorNode');

    const failTone = oscs.find(o => o.type === 'sawtooth');
    assert.ok(failTone, 'Should include sawtooth failure power-down tone');
    assert.ok(oscs.length >= 6, 'Should include sub-bass EMP, crystalline shattering cluster, and failure tone');
});

test('Tactical shield: playShieldRecharge manages rising harmonic hum activation and deactivation', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralCombatSynth(mockCtx);

    // Activate recharge
    const rechargeState = synth.playShieldRecharge(true);
    assert.ok(rechargeState, 'Should return active recharge state');
    assert.ok(rechargeState.oscs.length >= 4, 'Should contain harmonic cluster and LFO');

    // Deactivate recharge
    const stopResult = synth.playShieldRecharge(false);
    assert.equal(stopResult, null);
    assert.equal(synth._rechargeState, null, 'Recharge state should be cleared on stop');
});

test('Static delegates on ProceduralCombatSynth operate properly', () => {
    assert.equal(typeof ProceduralCombatSynth.playMagOut, 'function');
    assert.equal(typeof ProceduralCombatSynth.playMagIn, 'function');
    assert.equal(typeof ProceduralCombatSynth.playBoltRack, 'function');
    assert.equal(typeof ProceduralCombatSynth.playDryFire, 'function');
    assert.equal(typeof ProceduralCombatSynth.playBulletWhiz, 'function');
    assert.equal(typeof ProceduralCombatSynth.playRicochet, 'function');
    assert.equal(typeof ProceduralCombatSynth.playImpact, 'function');
    assert.equal(typeof ProceduralCombatSynth.playShieldHit, 'function');
    assert.equal(typeof ProceduralCombatSynth.playShieldBreak, 'function');
    assert.equal(typeof ProceduralCombatSynth.playShieldRecharge, 'function');
});
