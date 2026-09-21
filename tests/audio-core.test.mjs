// audio-core.test.mjs — Comprehensive unit tests for ProceduralAudioCore.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

/**
 * Creates a minimal Web Audio API mock for testing in Node.js.
 */
function createMockAudioContext() {
    class MockAudioParam {
        constructor(defaultValue = 0) {
            this.value = defaultValue;
            this._events = [];
        }
        setValueAtTime(val, time) {
            this.value = val;
            this._events.push({ type: 'setValueAtTime', val, time });
        }
        linearRampToValueAtTime(val, time) {
            this.value = val;
            this._events.push({ type: 'linearRampToValueAtTime', val, time });
        }
        cancelScheduledValues(time) {
            this._events.push({ type: 'cancelScheduledValues', time });
        }
    }

    class MockAudioNode {
        constructor() {
            this.connectedTo = [];
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
            super();
            this.gain = new MockAudioParam(1.0);
        }
    }

    class MockDynamicsCompressorNode extends MockAudioNode {
        constructor() {
            super();
            this.threshold = new MockAudioParam(-24);
            this.knee = new MockAudioParam(30);
            this.ratio = new MockAudioParam(12);
            this.attack = new MockAudioParam(0.003);
            this.release = new MockAudioParam(0.25);
        }
    }

    class MockConvolverNode extends MockAudioNode {
        constructor() {
            super();
            this.buffer = null;
        }
    }

    class MockBufferSourceNode extends MockAudioNode {
        constructor() {
            super();
            this.buffer = null;
            this.loop = false;
            this.startedAt = null;
            this.stoppedAt = null;
        }
        start(when = 0) {
            this.startedAt = when;
        }
        stop(when = 0) {
            this.stoppedAt = when;
        }
    }

    class MockPannerNode extends MockAudioNode {
        constructor() {
            super();
            this.panningModel = 'equalpower';
            this.distanceModel = 'inverse';
            this.refDistance = 1;
            this.maxDistance = 10000;
            this.rolloffFactor = 1;
            this.coneInnerAngle = 360;
            this.coneOuterAngle = 360;
            this.positionX = new MockAudioParam(0);
            this.positionY = new MockAudioParam(0);
            this.positionZ = new MockAudioParam(0);
            this.orientationX = new MockAudioParam(1);
            this.orientationY = new MockAudioParam(0);
            this.orientationZ = new MockAudioParam(0);
        }
        setPosition(x, y, z) {
            this.positionX.value = x;
            this.positionY.value = y;
            this.positionZ.value = z;
        }
        setOrientation(x, y, z) {
            this.orientationX.value = x;
            this.orientationY.value = y;
            this.orientationZ.value = z;
        }
    }

    class MockAudioBuffer {
        constructor(channels, length, sampleRate) {
            this.numberOfChannels = channels;
            this.length = length;
            this.sampleRate = sampleRate;
            this.duration = length / sampleRate;
            this._data = [];
            for (let i = 0; i < channels; i++) {
                this._data.push(new Float32Array(length));
            }
        }
        getChannelData(channel) {
            return this._data[channel];
        }
    }

    class MockAudioListener {
        constructor() {
            this.positionX = new MockAudioParam(0);
            this.positionY = new MockAudioParam(0);
            this.positionZ = new MockAudioParam(0);
            this.forwardX = new MockAudioParam(0);
            this.forwardY = new MockAudioParam(0);
            this.forwardZ = new MockAudioParam(-1);
            this.upX = new MockAudioParam(0);
            this.upY = new MockAudioParam(1);
            this.upZ = new MockAudioParam(0);
        }
        setPosition(x, y, z) {
            this.positionX.value = x;
            this.positionY.value = y;
            this.positionZ.value = z;
        }
        setOrientation(fx, fy, fz, ux, uy, uz) {
            this.forwardX.value = fx;
            this.forwardY.value = fy;
            this.forwardZ.value = fz;
            this.upX.value = ux;
            this.upY.value = uy;
            this.upZ.value = uz;
        }
    }

    class MockAudioContext {
        constructor(options = {}) {
            this.options = options;
            this.sampleRate = options.sampleRate || 44100;
            this.currentTime = 0;
            this.state = 'suspended';
            this.destination = new MockAudioNode();
            this.listener = new MockAudioListener();
            this._listeners = {};
        }
        addEventListener(event, fn) {
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(fn);
        }
        removeEventListener(event, fn) {
            if (!this._listeners[event]) return;
            this._listeners[event] = this._listeners[event].filter(cb => cb !== fn);
        }
        createGain() { return new MockGainNode(); }
        createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
        createConvolver() { return new MockConvolverNode(); }
        createBufferSource() { return new MockBufferSourceNode(); }
        createPanner() { return new MockPannerNode(); }
        createBuffer(channels, length, sampleRate) {
            return new MockAudioBuffer(channels, length, sampleRate);
        }
        async resume() {
            this.state = 'running';
            this._trigger('statechange');
            return true;
        }
        async suspend() {
            this.state = 'suspended';
            this._trigger('statechange');
            return true;
        }
        async close() {
            this.state = 'closed';
            this._trigger('statechange');
            return true;
        }
        _trigger(event) {
            const handlers = this._listeners[event] || [];
            for (const h of handlers) h();
        }
    }

    return {
        MockAudioContext,
        MockAudioBuffer,
        MockPannerNode,
        MockGainNode,
        MockDynamicsCompressorNode
    };
}

test('ProceduralAudioCore: safe environment initialization without AudioContext', () => {
    // In an environment where AudioContext is undefined, instantiating must not throw.
    const { get } = loadScripts(['js/audio/AudioCore.js'], {});
    const ProceduralAudioCore = get('ProceduralAudioCore');

    assert.ok(ProceduralAudioCore, 'ProceduralAudioCore should be exposed');
    assert.equal(typeof ProceduralAudioCore, 'function');
    assert.equal(ProceduralAudioCore.isSupported(), false, 'Should report unsupported when AudioContext is absent');

    const core = new ProceduralAudioCore({ autoInit: false });
    assert.equal(core.ctx, null, 'Context should remain null');
    assert.equal(core.getState(), 'unsupported');
    assert.equal(core.getMasterVolume(), 1.0);
});

test('ProceduralAudioCore: context creation and lifecycle state management', async () => {
    const { MockAudioContext } = createMockAudioContext();
    const mockDocument = {
        addEventListener: (event, handler) => {},
        removeEventListener: (event, handler) => {}
    };

    const { get } = loadScripts(['js/audio/AudioCore.js'], {
        AudioContext: MockAudioContext,
        document: mockDocument
    });
    const ProceduralAudioCore = get('ProceduralAudioCore');

    assert.equal(ProceduralAudioCore.isSupported(), true);

    const core = new ProceduralAudioCore({
        masterVolume: 0.8,
        reverbWet: 0.25,
        noiseDuration: 1.0,
        autoUnlock: true
    });

    assert.ok(core.ctx, 'AudioContext should be instantiated');
    assert.equal(core.getState(), 'suspended', 'Context should start in suspended state');

    let stateReported = null;
    const unsubscribe = core.onStateChange((state) => {
        stateReported = state;
    });

    const resumed = await core.resume();
    assert.equal(resumed, true);
    assert.equal(core.getState(), 'running');
    assert.equal(stateReported, 'running');

    await core.suspend();
    assert.equal(core.getState(), 'suspended');
    assert.equal(stateReported, 'suspended');

    unsubscribe();
    await core.close();
    assert.equal(core.ctx, null, 'Context should be cleared after close');
});

test('ProceduralAudioCore: master output bus and limiter/compressor settings', () => {
    const { MockAudioContext } = createMockAudioContext();
    const { get } = loadScripts(['js/audio/AudioCore.js'], { AudioContext: MockAudioContext });
    const ProceduralAudioCore = get('ProceduralAudioCore');

    const core = new ProceduralAudioCore({ masterVolume: 0.75 });

    // Verify audio graph nodes
    assert.ok(core.masterInput, 'Master input gain must exist');
    assert.ok(core.masterCompressor, 'Master compressor must exist');
    assert.ok(core.masterGain, 'Master volume gain must exist');

    // Verify audio graph routing: masterInput -> masterCompressor -> masterGain -> destination
    assert.equal(core.masterInput.connectedTo[0], core.masterCompressor);
    assert.equal(core.masterCompressor.connectedTo[0], core.masterGain);
    assert.equal(core.masterGain.connectedTo[0], core.ctx.destination);

    // Verify high-quality master limiter settings to prevent clipping
    const comp = core.masterCompressor;
    assert.equal(comp.threshold.value, -1.5, 'Threshold should clamp peaks near 0 dBFS');
    assert.equal(comp.knee.value, 3.0, 'Soft knee prevents harsh saturation');
    assert.equal(comp.ratio.value, 16.0, 'Steep ratio acts as master brickwall limiter');
    assert.equal(comp.attack.value, 0.003, 'Fast attack catches aggressive transients');
    assert.equal(comp.release.value, 0.15, 'Smooth release eliminates audible pumping');

    // Verify master volume controls
    assert.equal(core.getMasterVolume(), 0.75);
    core.setMasterVolume(0.5);
    assert.equal(core.getMasterVolume(), 0.5);
    assert.equal(core.masterGain.gain.value, 0.5);

    // Verify mute / unmute behavior
    core.mute();
    assert.equal(core.isMuted, true);
    assert.equal(core.masterGain.gain.value, 0.0);
    assert.equal(core.getMasterVolume(), 0.5, 'Underlying volume preference should be preserved while muted');

    core.unmute();
    assert.equal(core.isMuted, false);
    assert.equal(core.masterGain.gain.value, 0.5, 'Unmuting should restore previous volume');

    core.toggleMute();
    assert.equal(core.isMuted, true);
    core.toggleMute();
    assert.equal(core.isMuted, false);
});

test('ProceduralAudioCore: algorithmic wasteland reverb IR and send', () => {
    const { MockAudioContext } = createMockAudioContext();
    const { get } = loadScripts(['js/audio/AudioCore.js'], { AudioContext: MockAudioContext });
    const ProceduralAudioCore = get('ProceduralAudioCore');

    const ctx = new MockAudioContext();
    const irBuffer = ProceduralAudioCore.generateWastelandIR(ctx, {
        duration: 1.5,
        decay: 2.0,
        preDelay: 0.03,
        damping: 0.6
    });

    assert.ok(irBuffer, 'IR buffer must be created');
    assert.equal(irBuffer.numberOfChannels, 2, 'Wasteland IR must be stereo for spatial realism');
    assert.equal(irBuffer.length, Math.floor(1.5 * ctx.sampleRate));

    const leftData = irBuffer.getChannelData(0);
    const rightData = irBuffer.getChannelData(1);

    // Pre-delay silence check
    const preDelaySamples = Math.floor(0.03 * ctx.sampleRate);
    for (let i = 0; i < preDelaySamples - 1; i++) {
        assert.equal(leftData[i], 0);
        assert.equal(rightData[i], 0);
    }

    // Peak normalization check: max sample should be clamped to ~0.65 to prevent clipping
    let peak = 0;
    for (let i = 0; i < irBuffer.length; i++) {
        peak = Math.max(peak, Math.abs(leftData[i]), Math.abs(rightData[i]));
    }
    assert.ok(peak > 0.4 && peak <= 0.7, `Peak amplitude should be normalized near 0.65, got ${peak}`);

    // Reverb send test on core instance
    const core = new ProceduralAudioCore({ reverbWet: 0.2 });
    assert.ok(core.reverbConvolver, 'Convolver node must be created');
    assert.ok(core.reverbInput, 'Reverb input must be created');
    assert.ok(core.reverbWetGain, 'Reverb wet gain must be created');
    assert.equal(core.reverbWetGain.gain.value, 0.2);

    const testSource = core.ctx.createGain();
    const sendGain = core.sendToReverb(testSource, 0.35);
    assert.ok(sendGain, 'sendGain node should be returned');
    assert.equal(sendGain.gain.value, 0.35);
    assert.equal(testSource.connectedTo[0], sendGain);
    assert.equal(sendGain.connectedTo[0], core.reverbInput);
});

test('ProceduralAudioCore: procedural noise buffers (white, pink, brown)', () => {
    const { MockAudioContext } = createMockAudioContext();
    const { get } = loadScripts(['js/audio/AudioCore.js'], { AudioContext: MockAudioContext });
    const ProceduralAudioCore = get('ProceduralAudioCore');

    const ctx = new MockAudioContext();

    // 1. White noise
    const whiteBuf = ProceduralAudioCore.generateNoiseBuffer(ctx, 'white', 1.0, 2);
    assert.equal(whiteBuf.numberOfChannels, 2);
    const wData = whiteBuf.getChannelData(0);
    assert.ok(wData.some(v => v !== 0), 'White noise must have non-zero samples');

    // 2. Pink noise (1/f filter)
    const pinkBuf = ProceduralAudioCore.generateNoiseBuffer(ctx, 'pink', 1.0, 2);
    assert.equal(pinkBuf.numberOfChannels, 2);
    const pData = pinkBuf.getChannelData(0);
    assert.ok(pData.some(v => v !== 0), 'Pink noise must have non-zero samples');

    // 3. Brown noise (integrated noise)
    const brownBuf = ProceduralAudioCore.generateNoiseBuffer(ctx, 'brown', 1.0, 2);
    assert.equal(brownBuf.numberOfChannels, 2);
    const bData = brownBuf.getChannelData(0);
    assert.ok(bData.some(v => v !== 0), 'Brown noise must have non-zero samples');

    // Check normalization on all noise buffers: no sample should exceed 1.0
    for (const buf of [whiteBuf, pinkBuf, brownBuf]) {
        for (let ch = 0; ch < 2; ch++) {
            const data = buf.getChannelData(ch);
            for (let i = 0; i < data.length; i++) {
                assert.ok(Math.abs(data[i]) <= 1.001, 'Noise samples must be within [-1, 1]');
            }
        }
    }

    // Test pre-calculated buffers on core instance
    const core = new ProceduralAudioCore({ noiseDuration: 1.5 });
    assert.ok(core.getNoiseBuffer('white'), 'White noise buffer should be pre-calculated');
    assert.ok(core.getNoiseBuffer('pink'), 'Pink noise buffer should be pre-calculated');
    assert.ok(core.getNoiseBuffer('brown'), 'Brown noise buffer should be pre-calculated');

    // Test createNoiseSource helper
    const noiseSource = core.createNoiseSource('pink', { loop: true, gain: 0.5 });
    assert.ok(noiseSource, 'Noise source wrapper must be created');
    assert.equal(noiseSource.source.loop, true);
    assert.equal(noiseSource.gain.gain.value, 0.5);

    noiseSource.play(0);
    assert.equal(noiseSource.source.startedAt, 0);
    noiseSource.stop(1);
    assert.equal(noiseSource.source.stoppedAt, 1);
});

test('ProceduralAudioCore: 3D spatial audio helper with exponential falloff', () => {
    const { MockAudioContext } = createMockAudioContext();
    const { get } = loadScripts(['js/audio/AudioCore.js'], { AudioContext: MockAudioContext });
    const ProceduralAudioCore = get('ProceduralAudioCore');

    const ctx = new MockAudioContext();

    const panner = ProceduralAudioCore.createPanner3D(ctx, 120, 45, -300);
    assert.ok(panner, 'createPanner3D must return a PannerNode');
    assert.equal(panner.distanceModel, 'exponential', 'Distance model must be exponential');
    assert.equal(panner.refDistance, 100, 'Default refDistance should be 100');
    assert.equal(panner.maxDistance, 4096, 'Default maxDistance should cover location width');
    assert.equal(panner.rolloffFactor, 1.2, 'Default rolloffFactor should be 1.2');

    // Initial position check
    assert.equal(panner.positionX.value, 120);
    assert.equal(panner.positionY.value, 45);
    assert.equal(panner.positionZ.value, -300);

    // Convenience helper methods
    panner.updatePosition(250, 60, -500);
    assert.equal(panner.positionX.value, 250);
    assert.equal(panner.positionY.value, 60);
    assert.equal(panner.positionZ.value, -500);

    panner.updateOrientation(0, 0, 1);
    assert.equal(panner.orientationX.value, 0);
    assert.equal(panner.orientationY.value, 0);
    assert.equal(panner.orientationZ.value, 1);

    panner.setDistanceParameters(50, 2000, 1.5);
    assert.equal(panner.refDistance, 50);
    assert.equal(panner.maxDistance, 2000);
    assert.equal(panner.rolloffFactor, 1.5);

    // Listener update test
    ProceduralAudioCore.updateListener(ctx, {
        x: 100,
        y: 20,
        z: -150,
        forwardX: 0,
        forwardY: 0,
        forwardZ: -1
    });
    assert.equal(ctx.listener.positionX.value, 100);
    assert.equal(ctx.listener.positionY.value, 20);
    assert.equal(ctx.listener.positionZ.value, -150);
});
