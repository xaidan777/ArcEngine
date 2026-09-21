import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

/**
 * Creates a comprehensive mock Web Audio API context for Node.js testing.
 */
function createMockAudioContext() {
    const createdNodes = [];

    class MockAudioParam {
        constructor(defaultValue = 1.0) {
            this.value = defaultValue;
            this.events = [];
        }
        setValueAtTime(val, time) {
            this.value = val;
            this.events.push({ type: 'setValueAtTime', val, time });
            return this;
        }
        linearRampToValueAtTime(val, time) {
            this.value = val;
            this.events.push({ type: 'linearRampToValueAtTime', val, time });
            return this;
        }
        exponentialRampToValueAtTime(val, time) {
            this.value = val;
            this.events.push({ type: 'exponentialRampToValueAtTime', val, time });
            return this;
        }
        cancelScheduledValues(time) {
            this.events.push({ type: 'cancelScheduledValues', time });
            return this;
        }
    }

    class MockAudioNode {
        constructor(type) {
            this.nodeType = type;
            this.connectedTo = [];
            this.disconnected = false;
            createdNodes.push(this);
        }
        connect(target) {
            this.connectedTo.push(target);
            return target;
        }
        disconnect() {
            this.disconnected = true;
        }
    }

    class MockGainNode extends MockAudioNode {
        constructor() {
            super('GainNode');
            this.gain = new MockAudioParam(1.0);
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
        start(time) {
            this.started = true;
            this.startTime = time;
        }
        stop(time) {
            this.stopped = true;
            this.stopTime = time;
        }
    }

    class MockBiquadFilterNode extends MockAudioNode {
        constructor() {
            super('BiquadFilterNode');
            this.type = 'lowpass';
            this.frequency = new MockAudioParam(350);
            this.Q = new MockAudioParam(1);
            this.gain = new MockAudioParam(0);
        }
    }

    class MockAudioBufferSourceNode extends MockAudioNode {
        constructor() {
            super('AudioBufferSourceNode');
            this.buffer = null;
            this.loop = false;
            this.started = false;
            this.stopped = false;
            this.startTime = null;
            this.stopTime = null;
        }
        start(time) {
            this.started = true;
            this.startTime = time;
        }
        stop(time) {
            this.stopped = true;
            this.stopTime = time;
        }
    }

    class MockWaveShaperNode extends MockAudioNode {
        constructor() {
            super('WaveShaperNode');
            this.curve = null;
            this.oversample = 'none';
        }
    }

    class MockDynamicsCompressorNode extends MockAudioNode {
        constructor() {
            super('DynamicsCompressorNode');
            this.threshold = new MockAudioParam(-24);
            this.knee = new MockAudioParam(30);
            this.ratio = new MockAudioParam(12);
            this.attack = new MockAudioParam(0.003);
            this.release = new MockAudioParam(0.25);
        }
    }

    class MockPannerNode extends MockAudioNode {
        constructor() {
            super('PannerNode');
            this.panningModel = 'HRTF';
            this.distanceModel = 'inverse';
            this.refDistance = 1;
            this.maxDistance = 10000;
            this.rolloffFactor = 1;
            this.coneInnerAngle = 360;
            this.positionX = new MockAudioParam(0);
            this.positionY = new MockAudioParam(0);
            this.positionZ = new MockAudioParam(0);
        }
        setPosition(x, y, z) {
            this.positionX.setValueAtTime(x, 0);
            this.positionY.setValueAtTime(y, 0);
            this.positionZ.setValueAtTime(z, 0);
        }
    }

    class MockAudioBuffer {
        constructor(channels, length, sampleRate) {
            this.numberOfChannels = channels;
            this.length = length;
            this.sampleRate = sampleRate;
            this.duration = length / sampleRate;
            this._data = new Float32Array(length);
        }
        getChannelData() {
            return this._data;
        }
    }

    const mockCtx = {
        currentTime: 10.0,
        sampleRate: 44100,
        state: 'running',
        destination: new MockAudioNode('AudioDestination'),
        listener: {
            positionX: new MockAudioParam(0),
            positionY: new MockAudioParam(0),
            positionZ: new MockAudioParam(0),
            forwardX: new MockAudioParam(0),
            forwardY: new MockAudioParam(0),
            forwardZ: new MockAudioParam(1),
            upX: new MockAudioParam(0),
            upY: new MockAudioParam(1),
            upZ: new MockAudioParam(0),
            setPosition(x, y, z) {
                this.positionX.setValueAtTime(x, 0);
                this.positionY.setValueAtTime(y, 0);
                this.positionZ.setValueAtTime(z, 0);
            },
            setOrientation(fx, fy, fz, ux, uy, uz) {
                this.forwardX.setValueAtTime(fx, 0);
                this.forwardY.setValueAtTime(fy, 0);
                this.forwardZ.setValueAtTime(fz, 0);
                this.upX.setValueAtTime(ux, 0);
                this.upY.setValueAtTime(uy, 0);
                this.upZ.setValueAtTime(uz, 0);
            }
        },
        createGain: () => new MockGainNode(),
        createOscillator: () => new MockOscillatorNode(),
        createBiquadFilter: () => new MockBiquadFilterNode(),
        createBufferSource: () => new MockAudioBufferSourceNode(),
        createWaveShaper: () => new MockWaveShaperNode(),
        createDynamicsCompressor: () => new MockDynamicsCompressorNode(),
        createPanner: () => new MockPannerNode(),
        createBuffer: (channels, length, sampleRate) => new MockAudioBuffer(channels, length, sampleRate),
        resume: async () => { mockCtx.state = 'running'; return Promise.resolve(); },
        close: async () => { mockCtx.state = 'closed'; return Promise.resolve(); },
        _createdNodes: createdNodes,
    };

    return mockCtx;
}

test('ProceduralArcSynth exposes on window and globalThis', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    assert.ok(ProceduralArcSynth, 'ProceduralArcSynth must be defined in script context');
    assert.equal(scripts.ctx.window.ProceduralArcSynth, ProceduralArcSynth, 'Must expose on window.ProceduralArcSynth');
});

test('ProceduralArcSynth operates safely in headless/Node.js environment without Web Audio', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');

    const synth = new ProceduralArcSynth();
    assert.equal(synth.ctx, null, 'Context should be null when Web Audio is absent');

    // Calling play methods must return dummy handles without throwing
    const h1 = synth.playCricketChitter();
    assert.equal(h1.started, false);
    assert.equal(typeof h1.stop, 'function');

    const h2 = synth.playCricketLeapCharge({ x: 10, y: 20 });
    assert.equal(h2.started, false);

    const h3 = synth.playCricketLanding([10, 20, 30]);
    assert.equal(h3.started, false);

    const h4 = synth.playScreamerStiltStep({ x: 50, y: 10, h: 5 });
    assert.equal(h4.started, false);

    const h5 = synth.playScreamerScream();
    assert.equal(h5.started, false);

    const h6 = synth.playSpotterHover();
    assert.equal(h6.started, false);

    const h7 = synth.playSpotterSiren();
    assert.equal(h7.started, false);

    const h8 = synth.playSentinelStep();
    assert.equal(h8.started, false);

    const h9 = synth.playSentinelHorn();
    assert.equal(h9.started, false);

    synth.setMasterVolume(0.5);
    assert.equal(synth.getMasterVolume(), 0);
    synth.updateListener({ x: 0, y: 0 });
    synth.dispose();
});

test('ARC Cricket (Jumper): playCricketChitter generates metallic clicks & FM chirps', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    const handle = synth.playCricketChitter({ x: 150, y: 200, h: 10 });
    assert.ok(handle.started, 'Handle must be marked started');
    assert.ok(handle.duration > 0, 'Duration must be positive');
    assert.ok(handle.pannerNode, 'Spatial panner must be created for position');
    assert.equal(handle.pannerNode.positionX.value, 150);
    assert.equal(handle.pannerNode.positionY.value, 10); // h -> y
    assert.equal(handle.pannerNode.positionZ.value, 200); // y -> z

    const oscs = mockCtx._createdNodes.filter(n => n.nodeType === 'OscillatorNode');
    assert.ok(oscs.length >= 4, 'Must generate multiple FM chirp oscillators');
    const buffers = mockCtx._createdNodes.filter(n => n.nodeType === 'AudioBufferSourceNode');
    assert.ok(buffers.length >= 4, 'Must generate multiple servo click noise sources');
});

test('ARC Cricket (Jumper): playCricketLeapCharge generates rising hydraulic whine & tension', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    const handle = synth.playCricketLeapCharge([200, 300, 400]);
    assert.ok(handle.started);
    assert.ok(handle.duration >= 0.7, 'Leap charge anticipation duration must be >= 0.7s');

    const oscs = mockCtx._createdNodes.filter(n => n.nodeType === 'OscillatorNode');
    // Check for rising coil oscillator and tension LFO
    const hasRisingCoil = oscs.some(o => o.frequency.events.some(e => e.type === 'exponentialRampToValueAtTime' && e.val > 1000));
    assert.ok(hasRisingCoil, 'Must feature rising exponential frequency ramp for hydraulic coil');
});

test('ARC Cricket (Jumper): playCricketLanding generates sub-bass shockwave thump & metal rattle', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    const handle = synth.playCricketLanding({ x: 50, y: 50 });
    assert.ok(handle.started);

    const oscs = mockCtx._createdNodes.filter(n => n.nodeType === 'OscillatorNode');
    const hasSubThump = oscs.some(o => o.type === 'sine' && o.frequency.events.some(e => e.val < 50));
    assert.ok(hasSubThump, 'Must generate sub-bass ground thump sine oscillator');

    const filters = mockCtx._createdNodes.filter(n => n.nodeType === 'BiquadFilterNode');
    const hasRattleFilters = filters.some(f => f.type === 'bandpass' && f.Q.value > 10);
    assert.ok(hasRattleFilters, 'Must feature high-Q resonant filters for metal rattle');
});

test('ARC Screamer (EW Unit): playScreamerStiltStep generates heavy hydraulic thud & stilt ring', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    const handle = synth.playScreamerStiltStep({ x: 300, y: 400 });
    assert.ok(handle.started);

    const filters = mockCtx._createdNodes.filter(n => n.nodeType === 'BiquadFilterNode');
    const hasStiltResonance = filters.some(f => f.type === 'bandpass' && f.Q.value >= 15);
    assert.ok(hasStiltResonance, 'Must feature high-Q resonant filters for metallic stilt leg ringing');
});

test('ARC Screamer (EW Unit): playScreamerScream generates frequency sweep 400Hz to 3200Hz with FM and ring distortion', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    const handle = synth.playScreamerScream();
    assert.ok(handle.started);

    const oscs = mockCtx._createdNodes.filter(n => n.nodeType === 'OscillatorNode');
    // Check for carrier starting at 400Hz and sweeping to 3200Hz
    const carrier = oscs.find(o => {
        const start = o.frequency.events.find(e => e.type === 'setValueAtTime' && e.val === 400);
        const end = o.frequency.events.find(e => e.type === 'exponentialRampToValueAtTime' && e.val === 3200);
        return !!(start && end);
    });
    assert.ok(carrier, 'Carrier oscillator must start at 400Hz and exponentially ramp to 3200Hz');

    // Check for WaveShaperNode for distortion
    const shapers = mockCtx._createdNodes.filter(n => n.nodeType === 'WaveShaperNode');
    assert.ok(shapers[0].curve && shapers[0].curve.length > 0, 'WaveShaper curve must be non-empty Float32Array');
    assert.equal(shapers[0].curve.constructor.name, 'Float32Array', 'WaveShaper curve constructor must be Float32Array');

    // Check for sub-carrier drone
    const hasSubDrone = oscs.some(o => o.frequency.events.some(e => e.val < 200));
    assert.ok(hasSubDrone, 'Must feature sub-drone oscillator for ominous low-end body');
});

test('ARC Spotter (Drone): playSpotterHover generates contra-rotating propeller buzz with FM', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    const handle = synth.playSpotterHover({ x: 100, y: 100 }, 3.0);
    assert.ok(handle.started);
    assert.equal(handle.duration, 3.0);

    const oscs = mockCtx._createdNodes.filter(n => n.nodeType === 'OscillatorNode');
    // Check for twin detuned rotors (e.g. 82Hz and 86Hz)
    const rotorA = oscs.find(o => o.frequency.events.some(e => e.val === 82));
    const rotorB = oscs.find(o => o.frequency.events.some(e => e.val === 86));
    assert.ok(rotorA && rotorB, 'Must generate twin contra-rotating rotor fundamentals (82Hz & 86Hz)');

    // Check for turbulence LFO
    const hasTurbLfo = oscs.some(o => o.type === 'sine' && o.frequency.value < 10);
    assert.ok(hasTurbLfo, 'Must feature aerodynamic turbulence FM LFO');
});

test('ARC Spotter (Drone): playSpotterSiren generates two-tone alarm and rocket flare whoosh', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    const handle = synth.playSpotterSiren();
    assert.ok(handle.started);

    const oscs = mockCtx._createdNodes.filter(n => n.nodeType === 'OscillatorNode');
    // Check for siren alarm oscillators with two-tone steps
    const hasTwoTone = oscs.some(o => o.frequency.events.length >= 2);
    assert.ok(hasTwoTone, 'Must feature two-tone alternating siren tones');

    // Check for sweeping rocket flare filter
    const filters = mockCtx._createdNodes.filter(n => n.nodeType === 'BiquadFilterNode');
    const hasFlareSweep = filters.some(f => f.frequency.events.some(e => e.type === 'exponentialRampToValueAtTime' && e.val > 3000));
    assert.ok(hasFlareSweep, 'Must feature rocket flare launch whoosh filter sweep');
});

test('ARC Sentinel (Walker): playSentinelStep generates massive hydraulic stomp & sub-bass', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    const handle = synth.playSentinelStep({ x: 500, y: 500 });
    assert.ok(handle.started);

    const oscs = mockCtx._createdNodes.filter(n => n.nodeType === 'OscillatorNode');
    // Check for sub-bass gliding down to ~28Hz
    const hasEarthShake = oscs.some(o => o.type === 'sine' && o.frequency.events.some(e => e.val <= 30));
    assert.ok(hasEarthShake, 'Must feature earth-shaking sub-bass gliding down to ~28Hz');

    const buffers = mockCtx._createdNodes.filter(n => n.nodeType === 'AudioBufferSourceNode');
    assert.ok(buffers.length >= 2, 'Must include hydraulic piston slam and exhaust hiss buffers');
});

test('ARC Sentinel (Walker): playSentinelHorn generates low-frequency warship-like horn blast', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    const handle = synth.playSentinelHorn();
    assert.ok(handle.started);
    assert.ok(handle.duration >= 2.5, 'Sentinel warhorn must have a long, colossal blast duration');

    const oscs = mockCtx._createdNodes.filter(n => n.nodeType === 'OscillatorNode');
    // Check for 62Hz fundamental
    const hasFundamental = oscs.some(o => o.frequency.events.some(e => Math.abs(e.val - 62) < 0.1));
    assert.ok(hasFundamental, 'Must feature 62Hz colossal warhorn fundamental');

    // Check for formant cavity filters
    const filters = mockCtx._createdNodes.filter(n => n.nodeType === 'BiquadFilterNode');
    const hasFormants = filters.some(f => f.type === 'bandpass' && f.frequency.events.some(e => e.val === 220 || e.val === 680));
    assert.ok(hasFormants, 'Must feature formant cavity filters for warhorn acoustic resonance');
});

test('Master volume, listener updates, and handle stop operate reliably', () => {
    const scripts = loadScripts(['js/audio/ArcMachineSynth.js']);
    const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralArcSynth(mockCtx);

    // Master volume
    synth.setMasterVolume(0.45);
    assert.equal(synth.getMasterVolume(), 0.45);

    // Listener position and orientation
    synth.updateListener({ x: 100, y: 200, z: 300 }, { x: 0, y: 0, z: -1 });
    assert.equal(mockCtx.listener.positionX.value, 100);
    assert.equal(mockCtx.listener.positionY.value, 200);
    assert.equal(mockCtx.listener.positionZ.value, 300);
    assert.equal(mockCtx.listener.forwardZ.value, -1);

    // Stop handle
    const handle = synth.playSpotterHover();
    assert.equal(typeof handle.stop, 'function');
    handle.stop(); // Must execute cleanly without error
});
