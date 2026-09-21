// tests/ambience-synth.test.mjs — Unit tests for ProceduralAmbienceSynth
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';
import { ProceduralAmbienceSynth } from '../js/audio/AmbienceSynth.js';

/**
 * Creates a mock Web Audio API AudioContext for testing.
 */
function createMockAudioContext() {
    const createdNodes = [];

    function createMockParam(defaultValue = 0) {
        return {
            value: defaultValue,
            setValueAtTime: (val, time) => {},
            linearRampToValueAtTime: (val, time) => {},
            exponentialRampToValueAtTime: (val, time) => {},
            setTargetAtTime: (val, time, constant) => {}
        };
    }

    const mockCtx = {
        currentTime: 10.0,
        sampleRate: 44100,
        state: 'running',
        destination: {
            connect: () => {},
            disconnect: () => {}
        },
        resume: async () => {
            mockCtx.state = 'running';
        },
        createGain: () => {
            const node = {
                type: 'GainNode',
                gain: createMockParam(1.0),
                connect: (dest) => node.destinations.push(dest),
                disconnect: () => { node.destinations = []; },
                destinations: []
            };
            createdNodes.push(node);
            return node;
        },
        createBiquadFilter: () => {
            const node = {
                type: 'BiquadFilterNode',
                filterType: 'lowpass',
                set type(val) { node.filterType = val; },
                get type() { return node.filterType; },
                frequency: createMockParam(350),
                Q: createMockParam(1.0),
                connect: (dest) => node.destinations.push(dest),
                disconnect: () => { node.destinations = []; },
                destinations: []
            };
            createdNodes.push(node);
            return node;
        },
        createOscillator: () => {
            const node = {
                type: 'OscillatorNode',
                oscType: 'sine',
                set type(val) { node.oscType = val; },
                get type() { return node.oscType; },
                frequency: createMockParam(440),
                detune: createMockParam(0),
                started: false,
                stopped: false,
                start: (time) => { node.started = true; },
                stop: (time) => { node.stopped = true; },
                connect: (dest) => node.destinations.push(dest),
                disconnect: () => { node.destinations = []; },
                destinations: []
            };
            createdNodes.push(node);
            return node;
        },
        createBufferSource: () => {
            const node = {
                type: 'AudioBufferSourceNode',
                buffer: null,
                loop: false,
                started: false,
                stopped: false,
                start: (time) => { node.started = true; },
                stop: (time) => { node.stopped = true; },
                connect: (dest) => node.destinations.push(dest),
                disconnect: () => { node.destinations = []; },
                destinations: []
            };
            createdNodes.push(node);
            return node;
        },
        createBuffer: (channels, length, sampleRate) => {
            const channelData = Array.from({ length: channels }, () => new Float32Array(length));
            return {
                numberOfChannels: channels,
                length,
                sampleRate,
                duration: length / sampleRate,
                getChannelData: (ch) => channelData[ch]
            };
        },
        createWaveShaper: () => {
            const node = {
                type: 'WaveShaperNode',
                curve: null,
                oversample: 'none',
                connect: (dest) => node.destinations.push(dest),
                disconnect: () => { node.destinations = []; },
                destinations: []
            };
            createdNodes.push(node);
            return node;
        },
        createStereoPanner: () => {
            const node = {
                type: 'StereoPannerNode',
                pan: createMockParam(0),
                connect: (dest) => node.destinations.push(dest),
                disconnect: () => { node.destinations = []; },
                destinations: []
            };
            createdNodes.push(node);
            return node;
        },
        createDelay: () => {
            const node = {
                type: 'DelayNode',
                delayTime: createMockParam(0.2),
                connect: (dest) => node.destinations.push(dest),
                disconnect: () => { node.destinations = []; },
                destinations: []
            };
            createdNodes.push(node);
            return node;
        },
        _createdNodes: createdNodes
    };

    return mockCtx;
}

test('ProceduralAmbienceSynth: safe instantiation in Node.js environment without crash', () => {
    const synth = new ProceduralAmbienceSynth();
    assert.ok(synth, 'Instance created');
    assert.equal(synth.isRunning, false);
    assert.equal(synth.isStarted, false);

    const state = synth.getState();
    assert.equal(state.isRunning, false);
    assert.equal(state.masterVolume, 0.7);
    assert.equal(state.windVolume, 0.6);
    assert.equal(state.droneVolume, 0.35);
    assert.equal(state.industrialVolume, 0.5);
    assert.equal(state.weatherState, 'CLEAR');
});

test('ProceduralAmbienceSynth: start() initializes audio graph with wind, drone, and tape drift', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralAmbienceSynth(mockCtx, {
        masterVolume: 0.8,
        windVolume: 0.5,
        droneVolume: 0.3,
        industrialVolume: 0.4
    });

    synth.start();

    assert.equal(synth.isRunning, true);
    assert.equal(synth.isStarted, true);
    assert.ok(synth.masterGain, 'Master gain created');
    assert.ok(synth.windBus, 'Wind bus created');
    assert.ok(synth.droneBus, 'Drone bus created');
    assert.ok(synth.industrialBus, 'Industrial bus created');

    // 1. Wind generator verification
    assert.ok(synth.windSource, 'Wind source created');
    assert.equal(synth.windSource.loop, true, 'Wind source loops continuously');
    assert.equal(synth.windSource.started, true, 'Wind source started');
    assert.ok(synth.windLowpass, 'Wind lowpass filter created');
    assert.equal(synth.windLowpass.type, 'lowpass');
    assert.ok(synth.windBandpass, 'Wind bandpass filter created');
    assert.equal(synth.windBandpass.type, 'bandpass');
    assert.ok(synth.howlFilter, 'Gust howl filter created');
    assert.equal(synth.howlFilter.type, 'bandpass');
    assert.ok(synth.howlFilter.Q.value >= 12, 'Howl filter has high resonance Q >= 12');

    // 2. Cassette-futurism wasteland drone verification
    assert.ok(synth.droneOsc1, 'Drone Osc1 created');
    assert.equal(synth.droneOsc1.type, 'sawtooth');
    assert.equal(synth.droneOsc1.frequency.value, 65.41, 'Osc1 is C2 (~65.41 Hz)');
    assert.equal(synth.droneOsc1.started, true);

    assert.ok(synth.droneOsc2, 'Drone Osc2 created');
    assert.equal(synth.droneOsc2.type, 'triangle');
    assert.equal(synth.droneOsc2.detune.value, 6.0, 'Osc2 detuned by +6 cents');
    assert.equal(synth.droneOsc2.started, true);

    assert.ok(synth.droneSub, 'Drone Sub-oscillator created');
    assert.equal(synth.droneSub.type, 'sine');
    assert.equal(synth.droneSub.frequency.value, 32.70, 'Sub is C1 (~32.70 Hz)');

    assert.ok(synth.droneLfo, 'Drone slow LFO created');
    assert.ok(synth.droneLfo.frequency.value >= 0.1 && synth.droneLfo.frequency.value <= 0.2, 'LFO frequency in 0.1Hz - 0.2Hz range');
    assert.ok(synth.droneFilter, 'Drone lowpass filter created');
    assert.equal(synth.droneFilter.type, 'lowpass');

    // Tape wow/flutter drift verification
    assert.ok(synth.wowLfo, 'Tape wow LFO created');
    assert.ok(synth.flutterLfo, 'Tape flutter LFO created');
    assert.ok(synth.droneShaper, 'Tape saturation WaveShaper created');
    assert.ok(synth.droneShaper.curve, 'Tape saturation curve populated');

    synth.stop();
    assert.equal(synth.isRunning, false);
});

test('ProceduralAmbienceSynth: update() modulates wind and triggers howl on wind gusts', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralAmbienceSynth(mockCtx);
    synth.start();

    // Calm breeze
    synth.update({ windSpeed: 0.15, windGust: 0.05, weatherState: 'CLEAR' }, 0.016);
    let state = synth.getState();
    assert.equal(state.windSpeed, 0.15);
    assert.equal(state.windGust, 0.05);
    assert.equal(state.weatherState, 'CLEAR');

    // Severe gust / dust storm
    synth.update({ windSpeed: 0.85, windGust: 0.9, weatherState: 'DUST_STORM' }, 0.016);
    state = synth.getState();
    assert.equal(state.windSpeed, 0.85);
    assert.equal(state.windGust, 0.9);
    assert.equal(state.weatherState, 'DUST_STORM');
    assert.ok(synth.howlFilter.Q.value >= 14, 'Howl filter Q increased during severe gust');

    synth.stop();
});

test('ProceduralAmbienceSynth: procedural industrial ambiance triggers', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralAmbienceSynth(mockCtx);
    synth.start();

    // Trigger explicit events
    assert.doesNotThrow(() => {
        synth.triggerMetallicCreak({ pan: -0.4, volume: 0.75 });
    }, 'triggerMetallicCreak executes without error');

    assert.doesNotThrow(() => {
        synth.triggerIndustrialRumble({ duration: 5.0, volume: 0.8 });
    }, 'triggerIndustrialRumble executes without error');

    assert.doesNotThrow(() => {
        synth.triggerHollowWindEcho({ pan: 0.6, volume: 0.7 });
    }, 'triggerHollowWindEcho executes without error');

    // Trigger events via procedural timer countdown in update()
    synth.creakTimer = 0.05;
    synth.rumbleTimer = 0.05;
    synth.echoTimer = 0.05;

    synth.update({ windSpeed: 0.5, windGust: 0.3 }, 0.1);

    // Timers should have reset to positive values
    const state = synth.getState();
    assert.ok(state.creakTimer > 1.0, 'Creak timer reset after procedural trigger');
    assert.ok(state.rumbleTimer > 1.0, 'Rumble timer reset after procedural trigger');
    assert.ok(state.echoTimer > 1.0, 'Echo timer reset after procedural trigger');

    synth.stop();
});

test('ProceduralAmbienceSynth: volume adjustments and dispose', () => {
    const mockCtx = createMockAudioContext();
    const synth = new ProceduralAmbienceSynth(mockCtx);
    synth.start();

    synth.setMasterVolume(0.45);
    synth.setWindVolume(0.55);
    synth.setDroneVolume(0.25);
    synth.setIndustrialVolume(0.65);

    const state = synth.getState();
    assert.equal(state.masterVolume, 0.45);
    assert.equal(state.windVolume, 0.55);
    assert.equal(state.droneVolume, 0.25);
    assert.equal(state.industrialVolume, 0.65);

    assert.doesNotThrow(() => {
        synth.dispose();
    }, 'dispose() cleans up without error');
    assert.equal(synth.isRunning, false);
});

test('ProceduralAmbienceSynth: integrates with ProceduralAudioCore instance', () => {
    const mockCtx = createMockAudioContext();
    const mockCore = {
        ctx: mockCtx,
        masterInput: mockCtx.createGain(),
        masterGain: mockCtx.createGain(),
        reverbInput: mockCtx.createGain()
    };

    const synth = new ProceduralAmbienceSynth(mockCore);
    synth.start();

    assert.equal(synth.ctx, mockCtx);
    assert.equal(synth.audioCore, mockCore);
    assert.ok(synth.masterGain.destinations.includes(mockCore.masterInput), 'Master gain connected to ProceduralAudioCore masterInput');

    synth.stop();
});

test('ProceduralAmbienceSynth: browser script loading exposes window.ProceduralAmbienceSynth', () => {
    const loaded = loadScripts(['js/audio/AmbienceSynth.js']);
    const SynthClass = loaded.get('window.ProceduralAmbienceSynth');
    assert.ok(SynthClass, 'window.ProceduralAmbienceSynth is defined');
    assert.equal(typeof SynthClass, 'function');
});
