// AmbienceSynth.js — Procedural atmosphere and wasteland soundscape for ArcEngine.
// Implements ProceduralAmbienceSynth using Web Audio API:
// 1. Continuous procedural wind generator (pink/brownian noise, dynamic BiquadFilter, gust howl).
// 2. Cassette-futurism wasteland drone (dual detuned C1/C2 saw/triangle, slow LFO filter sweep, tape wow/flutter drift).
// 3. Distant industrial wasteland ambiance (metallic creaks, low-frequency rumble, resonant hollow echoes).
// 4. Real-time dynamic modulation driven by WeatherSystem (wind speed, gust, turbulence, weather state).

/**
 * @typedef {Object} WeatherParams
 * @property {number} [windSpeed=0.2] - Normalized wind speed 0..1 (or m/s scaled)
 * @property {number} [windGust=0.0] - Wind gust intensity 0..1
 * @property {number} [turbulence=0.0] - Atmospheric turbulence 0..1
 * @property {string} [weatherState='CLEAR'] - State ('CLEAR'|'DUST_STORM'|'ACID_RAIN'|'DENSE_FOG')
 * @property {{x: number, z: number}} [windVector] - 2D wind direction vector
 * @property {number} [speed] - Alias for windSpeed
 * @property {number} [wind] - Alias for windSpeed
 * @property {number} [gust] - Alias for windGust
 * @property {number} [gusts] - Alias for windGust
 * @property {string} [state] - Alias for weatherState
 */

/**
 * @typedef {Object} AmbienceSynthOptions
 * @property {number} [masterVolume=0.7] - Master ambience output volume (0..1)
 * @property {number} [windVolume=0.6] - Continuous wind generator volume (0..1)
 * @property {number} [droneVolume=0.35] - Cassette-futurism wasteland drone volume (0..1)
 * @property {number} [industrialVolume=0.5] - Distant industrial events volume (0..1)
 */

/**
 * ProceduralAmbienceSynth synthesizes continuous procedural environmental audio
 * and atmospheric wasteland events using 100% Web Audio API procedural synthesis.
 */
class ProceduralAmbienceSynth {
    /**
     * @param {Object|BaseAudioContext} [audioCoreOrCtx] - ProceduralAudioCore instance or AudioContext
     * @param {AmbienceSynthOptions} [options] - Initial configuration options
     */
    constructor(audioCoreOrCtx, options = {}) {
        /** @type {any} Reference to ProceduralAudioCore or null */
        this.audioCore = null;

        /** @type {AudioContext|null} */
        this.ctx = null;

        if (audioCoreOrCtx) {
            if (typeof audioCoreOrCtx.createGain === 'function' || audioCoreOrCtx.sampleRate) {
                // Directly passed an AudioContext
                this.ctx = /** @type {AudioContext} */ (audioCoreOrCtx);
            } else if (audioCoreOrCtx.ctx || audioCoreOrCtx.audioCtx) {
                // Passed ProceduralAudioCore instance
                this.audioCore = audioCoreOrCtx;
                this.ctx = audioCoreOrCtx.ctx || audioCoreOrCtx.audioCtx;
            }
        }

        if (!this.ctx && typeof window !== 'undefined') {
            const AudioCtxClass = window.AudioContext || window['webkitAudioContext'];
            if (AudioCtxClass) {
                try {
                    this.ctx = new AudioCtxClass();
                } catch (e) {
                    this.ctx = null;
                }
            }
        }

        // Volume parameters
        this.masterVolume = options.masterVolume ?? 0.7;
        this.windVolume = options.windVolume ?? 0.6;
        this.droneVolume = options.droneVolume ?? 0.35;
        this.industrialVolume = options.industrialVolume ?? 0.5;

        // Playback state
        this.isRunning = false;
        this.isStarted = false;

        // Master and sub-bus gain nodes
        /** @type {GainNode|null} */
        this.masterGain = null;
        /** @type {GainNode|null} */
        this.windBus = null;
        /** @type {GainNode|null} */
        this.droneBus = null;
        /** @type {GainNode|null} */
        this.industrialBus = null;

        // Wind generator nodes
        /** @type {AudioBufferSourceNode|null} */
        this.windSource = null;
        /** @type {AudioBuffer|null} */
        this.noiseBuffer = null;
        /** @type {BiquadFilterNode|null} */
        this.windLowpass = null;
        /** @type {BiquadFilterNode|null} */
        this.windBandpass = null;
        /** @type {GainNode|null} */
        this.windBaseGain = null;
        /** @type {BiquadFilterNode|null} */
        this.howlFilter = null;
        /** @type {GainNode|null} */
        this.howlGain = null;
        this.howlPhase = 0.0;

        // Cassette-futurism drone nodes
        /** @type {OscillatorNode|null} */
        this.droneOsc1 = null;
        /** @type {OscillatorNode|null} */
        this.droneOsc2 = null;
        /** @type {OscillatorNode|null} */
        this.droneSub = null;
        /** @type {BiquadFilterNode|null} */
        this.droneFilter = null;
        /** @type {OscillatorNode|null} */
        this.droneLfo = null;
        /** @type {GainNode|null} */
        this.droneLfoGain = null;
        /** @type {OscillatorNode|null} */
        this.wowLfo = null;
        /** @type {GainNode|null} */
        this.wowGain = null;
        /** @type {OscillatorNode|null} */
        this.flutterLfo = null;
        /** @type {GainNode|null} */
        this.flutterGain = null;
        /** @type {WaveShaperNode|null} */
        this.droneShaper = null;
        /** @type {GainNode|null} */
        this.droneGain = null;

        // Procedural interval timers (seconds)
        this.creakTimer = 12.0 + Math.random() * 10.0;
        this.rumbleTimer = 20.0 + Math.random() * 15.0;
        this.echoTimer = 16.0 + Math.random() * 12.0;

        // Weather state cache
        this.currentWindSpeed = 0.2;
        this.currentWindGust = 0.0;
        this.currentTurbulence = 0.0;
        this.currentWeatherState = 'CLEAR';
    }

    /**
     * Initializes audio nodes and connects audio graph.
     * @private
     */
    _initGraph() {
        if (!this.ctx) return;

        const ctx = this.ctx;

        // Master output gain
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = this.masterVolume;

        // Connect master to external destination
        if (this.audioCore) {
            const dest = this.audioCore.ambienceGain || this.audioCore.masterInput || this.audioCore.masterGain || (this.audioCore.ctx && this.audioCore.ctx.destination) || ctx.destination;
            this.masterGain.connect(dest);
        } else {
            this.masterGain.connect(ctx.destination);
        }

        // Sub buses
        this.windBus = ctx.createGain();
        this.windBus.gain.value = this.windVolume;
        this.windBus.connect(this.masterGain);

        this.droneBus = ctx.createGain();
        this.droneBus.gain.value = this.droneVolume;
        this.droneBus.connect(this.masterGain);

        this.industrialBus = ctx.createGain();
        this.industrialBus.gain.value = this.industrialVolume;
        this.industrialBus.connect(this.masterGain);

        // --------------------------------------------------------------------
        // 1. Procedural Wind Generator Setup
        // --------------------------------------------------------------------
        this.noiseBuffer = this._createPinkBrownianNoiseBuffer(4.0);

        this.windSource = ctx.createBufferSource();
        this.windSource.buffer = this.noiseBuffer;
        this.windSource.loop = true;

        // Primary wind lowpass: cuts high hiss, deepens with lower wind
        this.windLowpass = ctx.createBiquadFilter();
        this.windLowpass.type = 'lowpass';
        this.windLowpass.frequency.value = 220;
        this.windLowpass.Q.value = 1.2;

        // Wind body bandpass: creates resonant rushing air contour
        this.windBandpass = ctx.createBiquadFilter();
        this.windBandpass.type = 'bandpass';
        this.windBandpass.frequency.value = 360;
        this.windBandpass.Q.value = 2.0;

        this.windBaseGain = ctx.createGain();
        this.windBaseGain.gain.value = 0.06;

        // High gust wind howl: resonant whistling bandpass
        this.howlFilter = ctx.createBiquadFilter();
        this.howlFilter.type = 'bandpass';
        this.howlFilter.frequency.value = 650;
        this.howlFilter.Q.value = 14.0;

        this.howlGain = ctx.createGain();
        this.howlGain.gain.value = 0.0;

        // Wind connections:
        // windSource -> lowpass -> bandpass -> windBaseGain -> windBus
        // windSource -> howlFilter -> howlGain -> windBus
        this.windSource.connect(this.windLowpass);
        this.windLowpass.connect(this.windBandpass);
        this.windBandpass.connect(this.windBaseGain);
        this.windBaseGain.connect(this.windBus);

        this.windSource.connect(this.howlFilter);
        this.howlFilter.connect(this.howlGain);
        this.howlGain.connect(this.windBus);

        // --------------------------------------------------------------------
        // 2. Cassette-Futurism Wasteland Drone Setup
        // --------------------------------------------------------------------
        // Dual detuned oscillators at C2 (65.41 Hz) + C1 sub (32.70 Hz)
        this.droneOsc1 = ctx.createOscillator();
        this.droneOsc1.type = 'sawtooth';
        this.droneOsc1.frequency.value = 65.41; // C2

        this.droneOsc2 = ctx.createOscillator();
        this.droneOsc2.type = 'triangle';
        this.droneOsc2.frequency.value = 65.41; // C2
        this.droneOsc2.detune.value = 6.0; // +6 cents detune for rich analog chorus

        this.droneSub = ctx.createOscillator();
        this.droneSub.type = 'sine';
        this.droneSub.frequency.value = 32.70; // C1 deep sub-bass

        // Slow LFO modulating lowpass filter cutoff (0.1Hz - 0.2Hz sweep)
        this.droneLfo = ctx.createOscillator();
        this.droneLfo.type = 'sine';
        this.droneLfo.frequency.value = 0.14; // ~7.1 second slow breathing cycle

        this.droneLfoGain = ctx.createGain();
        this.droneLfoGain.gain.value = 140.0; // Cutoff sweep amplitude (+/- 140 Hz)

        this.droneFilter = ctx.createBiquadFilter();
        this.droneFilter.type = 'lowpass';
        this.droneFilter.frequency.value = 240.0; // Sweeps from ~100 Hz to ~380 Hz
        this.droneFilter.Q.value = 3.2;

        this.droneLfo.connect(this.droneLfoGain);
        this.droneLfoGain.connect(this.droneFilter.frequency);

        // Vintage Tape Drift (0.3% wow/flutter vibrato):
        // 0.3% frequency shift is ~5.2 cents.
        // Wow: 0.6 Hz slow motor drift (3.6 cents)
        this.wowLfo = ctx.createOscillator();
        this.wowLfo.type = 'sine';
        this.wowLfo.frequency.value = 0.6;

        this.wowGain = ctx.createGain();
        this.wowGain.gain.value = 3.6;

        // Flutter: 5.5 Hz rapid tape jitter (1.6 cents)
        this.flutterLfo = ctx.createOscillator();
        this.flutterLfo.type = 'sine';
        this.flutterLfo.frequency.value = 5.5;

        this.flutterGain = ctx.createGain();
        this.flutterGain.gain.value = 1.6;

        this.wowLfo.connect(this.wowGain);
        this.flutterLfo.connect(this.flutterGain);

        // Connect wow/flutter modulation to oscillator detune inputs
        this.wowGain.connect(this.droneOsc1.detune);
        this.wowGain.connect(this.droneOsc2.detune);
        this.flutterGain.connect(this.droneOsc1.detune);
        this.flutterGain.connect(this.droneOsc2.detune);

        // Soft-saturation waveshaper for vintage tape warmth
        this.droneShaper = ctx.createWaveShaper();
        this.droneShaper.curve = /** @type {any} */ (this._createTapeSaturationCurve(512));
        this.droneShaper.oversample = '2x';

        this.droneGain = ctx.createGain();
        this.droneGain.gain.value = 0.45;

        // Drone routing:
        // Osc1 + Osc2 + Sub -> Shaper -> Filter -> droneGain -> droneBus
        this.droneOsc1.connect(this.droneShaper);
        this.droneOsc2.connect(this.droneShaper);
        this.droneSub.connect(this.droneShaper);
        this.droneShaper.connect(this.droneFilter);
        this.droneFilter.connect(this.droneGain);
        this.droneGain.connect(this.droneBus);
    }

    /**
     * Generates a seamless looped audio buffer containing a blend of pink and brownian noise.
     * @private
     * @param {number} [duration=4.0] - Duration in seconds
     * @returns {AudioBuffer}
     */
    _createPinkBrownianNoiseBuffer(duration = 4.0) {
        const sampleRate = (this.ctx && this.ctx.sampleRate) ? this.ctx.sampleRate : 44100;
        const length = Math.max(1, Math.floor(sampleRate * duration));
        
        let buffer;
        if (this.ctx && typeof this.ctx.createBuffer === 'function') {
            buffer = this.ctx.createBuffer(2, length, sampleRate);
        } else {
            // Mock buffer for non-browser / Node testing
            buffer = {
                sampleRate,
                length,
                duration,
                numberOfChannels: 2,
                getChannelData: () => new Float32Array(length)
            };
            return /** @type {AudioBuffer} */ (buffer);
        }

        for (let channel = 0; channel < 2; channel++) {
            const output = buffer.getChannelData(channel);
            // Paul Kellet pink noise filter state
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            let brown = 0;

            // Warm-up filter to avoid initial DC offset transient
            for (let i = 0; i < 2000; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                b6 = white * 0.115926;
                brown = (brown * 0.97) + (white * 0.03);
            }

            for (let i = 0; i < length; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                b6 = white * 0.115926;

                brown = (brown * 0.985) + (white * 0.025);

                // Blend: 45% pink (air rush) + 55% brownian (deep wind body)
                output[i] = (pink * 0.45 + brown * 2.2 * 0.55);
            }

            // Cosine equal-power crossfade at the boundaries to make it seamlessly loopable
            const fadeLength = Math.min(length >> 1, Math.floor(sampleRate * 0.08)); // 80ms crossfade
            for (let i = 0; i < fadeLength; i++) {
                const t = i / fadeLength;
                const gainIn = Math.sin(t * Math.PI * 0.5);
                const gainOut = Math.cos(t * Math.PI * 0.5);
                const tailIdx = length - fadeLength + i;
                const blended = output[i] * gainIn + output[tailIdx] * gainOut;
                output[i] = blended;
                output[tailIdx] = blended;
            }
        }

        return buffer;
    }

    /**
     * Generates a soft analog tape saturation curve for WaveShaperNode.
     * @private
     * @param {number} [samples=512]
     * @returns {Float32Array}
     */
    _createTapeSaturationCurve(samples = 512) {
        const curve = new Float32Array(samples);
        const k = 1.35;
        const norm = Math.tanh(k);
        for (let i = 0; i < samples; ++i) {
            const x = (i * 2) / (samples - 1) - 1;
            curve[i] = Math.tanh(x * k) / norm;
        }
        return curve;
    }

    /**
     * Starts continuous procedural ambient synthesis.
     * Resumes AudioContext if suspended.
     */
    start() {
        if (this.isRunning) return;

        if (!this.ctx) {
            if (typeof window !== 'undefined') {
                const AudioCtxClass = window.AudioContext || window['webkitAudioContext'];
                if (AudioCtxClass) {
                    try {
                        this.ctx = new AudioCtxClass();
                    } catch (e) {
                        return;
                    }
                }
            }
            if (!this.ctx) return;
        }

        // Resume context if suspended (browser autoplay policy)
        if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
            this.ctx.resume().catch(() => {});
        }

        this._initGraph();

        const now = this.ctx.currentTime || 0;

        // Start continuous wind source
        if (this.windSource && typeof this.windSource.start === 'function') {
            try {
                this.windSource.start(now);
            } catch (e) { /* already started */ }
        }

        // Start drone oscillators and LFOs
        const droneNodes = [
            this.droneOsc1,
            this.droneOsc2,
            this.droneSub,
            this.droneLfo,
            this.wowLfo,
            this.flutterLfo
        ];

        for (const node of droneNodes) {
            if (node && typeof node.start === 'function') {
                try {
                    node.start(now);
                } catch (e) { /* already started */ }
            }
        }

        // Smoothly fade in master volume
        if (this.masterGain && this.masterGain.gain) {
            this.masterGain.gain.setValueAtTime(0.001, now);
            if (typeof this.masterGain.gain.exponentialRampToValueAtTime === 'function') {
                this.masterGain.gain.exponentialRampToValueAtTime(Math.max(0.001, this.masterVolume), now + 0.5);
            } else {
                this.masterGain.gain.value = this.masterVolume;
            }
        }

        this.isRunning = true;
        this.isStarted = true;
    }

    /**
     * Stops continuous procedural ambient synthesis with smooth fade-out.
     */
    stop() {
        if (!this.isRunning) return;

        const now = (this.ctx && this.ctx.currentTime) || 0;

        // Smooth fade out
        if (this.masterGain && this.masterGain.gain) {
            if (typeof this.masterGain.gain.setTargetAtTime === 'function') {
                this.masterGain.gain.setTargetAtTime(0.0, now, 0.08);
            } else {
                this.masterGain.gain.value = 0.0;
            }
        }

        // Stop nodes after fade-out
        const stopTime = now + 0.25;
        const nodesToStop = [
            this.windSource,
            this.droneOsc1,
            this.droneOsc2,
            this.droneSub,
            this.droneLfo,
            this.wowLfo,
            this.flutterLfo
        ];

        for (const node of nodesToStop) {
            if (node && typeof node.stop === 'function') {
                try {
                    node.stop(stopTime);
                } catch (e) { /* ignore */ }
            }
        }

        this.isRunning = false;
    }

    /**
     * Updates real-time procedural modulation based on dynamic weather parameters.
     * Call this in the main game loop: `synth.update(weatherParams, dt)`.
     *
     * @param {WeatherParams} [weatherParams] - Dynamic weather parameters
     * @param {number} [dt=0.016] - Delta time in seconds
     */
    update(weatherParams = {}, dt = 0.016) {
        if (!this.isRunning || !this.ctx) return;

        const now = this.ctx.currentTime || 0;

        // Extract and normalize weather parameters
        let rawSpeed = weatherParams.windSpeed ?? weatherParams.wind ?? weatherParams.speed ?? 0.2;
        // If speed is given in m/s (e.g. > 1.0), normalize to 0..1 range (assuming max gale ~25 m/s)
        if (rawSpeed > 1.0) rawSpeed = Math.min(1.0, rawSpeed / 25.0);
        const windSpeed = Math.max(0.0, Math.min(1.0, rawSpeed));

        const rawGust = weatherParams.windGust ?? weatherParams.gust ?? weatherParams.gusts ?? 0.0;
        const windGust = Math.max(0.0, Math.min(1.0, rawGust));

        const turbulence = Math.max(0.0, Math.min(1.0, weatherParams.turbulence ?? 0.0));
        const weatherState = weatherParams.weatherState || weatherParams.state || 'CLEAR';

        this.currentWindSpeed = windSpeed;
        this.currentWindGust = windGust;
        this.currentTurbulence = turbulence;
        this.currentWeatherState = weatherState;

        // --------------------------------------------------------------------
        // 1. Modulate Wind Lowpass, Bandpass, Gain, and Howl
        // --------------------------------------------------------------------
        // Wind lowpass frequency: opens up from 180 Hz (calm) to 1300 Hz (storm)
        let targetLowpassFreq = 180 + windSpeed * 950 + windGust * 550;
        let targetLowpassQ = 0.9 + windSpeed * 0.8 + windGust * 1.2;

        // Wind bandpass frequency: resonant body of the wind
        let targetBandpassFreq = 260 + windSpeed * 420 + windGust * 280;
        let targetBandpassQ = 1.6 + windSpeed * 1.5 + windGust * 2.0;

        // Wind base gain: scales with wind speed and storm intensity
        let targetWindGain = 0.03 + windSpeed * 0.32 + windGust * 0.25;

        // Weather state adjustments
        if (weatherState === 'DUST_STORM') {
            targetLowpassFreq += 300;
            targetWindGain *= 1.35;
        } else if (weatherState === 'DENSE_FOG') {
            // Muffled, heavy atmosphere
            targetLowpassFreq *= 0.75;
            targetWindGain *= 0.85;
        } else if (weatherState === 'ACID_RAIN') {
            targetBandpassFreq += 80;
            targetBandpassQ += 0.5;
        }

        // Apply audio param smoothing
        this._setAudioParam(this.windLowpass?.frequency, targetLowpassFreq, now, 0.08);
        this._setAudioParam(this.windLowpass?.Q, targetLowpassQ, now, 0.08);
        this._setAudioParam(this.windBandpass?.frequency, targetBandpassFreq, now, 0.08);
        this._setAudioParam(this.windBandpass?.Q, targetBandpassQ, now, 0.08);
        this._setAudioParam(this.windBaseGain?.gain, targetWindGain, now, 0.08);

        // Wind howl effect on high wind gusts:
        // Sweeps resonant bandpass (Q=12..18) through 450..950 Hz
        const effectiveGust = Math.max(windGust, (windSpeed - 0.45) * 1.2);
        if (effectiveGust > 0.12) {
            this.howlPhase += dt * (0.6 + effectiveGust * 1.4);
            const howlSweep = Math.sin(this.howlPhase) * 220 + Math.cos(this.howlPhase * 0.65) * 110;
            const howlFreq = Math.max(300, Math.min(1200, 580 + howlSweep + effectiveGust * 320));
            const howlQ = 11.0 + effectiveGust * 7.0; // 11 to 18
            const targetHowlGain = Math.pow(effectiveGust, 1.4) * 0.32 * (0.6 + windSpeed * 0.5);

            this._setAudioParam(this.howlFilter?.frequency, howlFreq, now, 0.05);
            this._setAudioParam(this.howlFilter?.Q, howlQ, now, 0.05);
            this._setAudioParam(this.howlGain?.gain, targetHowlGain, now, 0.08);
        } else {
            this._setAudioParam(this.howlGain?.gain, 0.0, now, 0.12);
        }

        // --------------------------------------------------------------------
        // 2. Modulate Wasteland Drone
        // --------------------------------------------------------------------
        // In dense fog or calm desolate night, drone is more prominent;
        // In dust storms, drone is ducked slightly behind roaring wind
        let droneTargetGain = this.droneVolume;
        if (weatherState === 'DENSE_FOG') {
            droneTargetGain *= 1.25;
        } else if (weatherState === 'DUST_STORM') {
            droneTargetGain *= 0.8;
        }
        this._setAudioParam(this.droneGain?.gain, droneTargetGain, now, 0.2);

        // --------------------------------------------------------------------
        // 3. Semi-Random Procedural Ambiance Triggers
        // --------------------------------------------------------------------
        // Stronger gusts and turbulence accelerate the creak and echo timers
        const timeMultiplier = 1.0 + windGust * 0.8 + turbulence * 0.5;

        // Metallic creak timer
        this.creakTimer -= dt * timeMultiplier;
        if (this.creakTimer <= 0) {
            this.triggerMetallicCreak();
            // Next interval: 9 to 24 seconds
            this.creakTimer = 9.0 + Math.random() * 15.0;
        }

        // Industrial rumble timer
        this.rumbleTimer -= dt * (1.0 + turbulence * 0.3);
        if (this.rumbleTimer <= 0) {
            this.triggerIndustrialRumble();
            // Next interval: 18 to 38 seconds
            this.rumbleTimer = 18.0 + Math.random() * 20.0;
        }

        // Resonant hollow wind echo timer
        this.echoTimer -= dt * (1.0 + windGust * 1.2 + turbulence * 0.4);
        if (this.echoTimer <= 0) {
            this.triggerHollowWindEcho();
            // Next interval: 13 to 28 seconds
            this.echoTimer = 13.0 + Math.random() * 15.0;
        }
    }

    /**
     * Helper to smoothly set or target an AudioParam value.
     * @private
     * @param {AudioParam|undefined|null} param
     * @param {number} value
     * @param {number} time
     * @param {number} [timeConstant=0.08]
     */
    _setAudioParam(param, value, time, timeConstant = 0.08) {
        if (!param) return;
        if (typeof param.setTargetAtTime === 'function') {
            param.setTargetAtTime(value, time, timeConstant);
        } else {
            param.value = value;
        }
    }

    /**
     * Synthesizes and triggers a distant procedural metallic creak.
     * Simulates rusted girders, crane cables, and metal sheets bending under wasteland wind.
     *
     * @param {Object} [options]
     * @param {number} [options.pan] - Stereo pan (-1.0 to +1.0)
     * @param {number} [options.volume] - Relative volume multiplier (0..1)
     * @param {number} [options.pitch] - Center pitch offset in Hz
     */
    triggerMetallicCreak(options = {}) {
        if (!this.ctx || !this.industrialBus) return;

        const ctx = this.ctx;
        const now = ctx.currentTime || 0;
        const duration = 1.6 + Math.random() * 1.4; // 1.6s to 3.0s

        const panVal = options.pan ?? ((Math.random() * 2 - 1) * 0.85);
        const volMultiplier = options.volume ?? (0.6 + Math.random() * 0.4);
        const pitchOffset = options.pitch ?? ((Math.random() * 2 - 1) * 120);

        // Friction noise excitation
        const noiseBuf = this._createPinkBrownianNoiseBuffer(duration);
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuf;

        // Swept FM oscillator for metal stress moan
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const startFreq = Math.max(300, 780 + pitchOffset);
        const endFreq = Math.max(200, startFreq * (0.82 + Math.random() * 0.1));
        osc.frequency.setValueAtTime(startFreq, now);
        if (typeof osc.frequency.exponentialRampToValueAtTime === 'function') {
            osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
        }

        // Dual high-Q resonant bandpass filters (modal metal resonance)
        const filter1 = ctx.createBiquadFilter();
        filter1.type = 'bandpass';
        filter1.frequency.value = Math.max(250, 840 + pitchOffset * 0.7);
        filter1.Q.value = 16.0 + Math.random() * 8.0;

        const filter2 = ctx.createBiquadFilter();
        filter2.type = 'bandpass';
        filter2.frequency.value = Math.max(400, 1420 + pitchOffset * 1.1);
        filter2.Q.value = 18.0 + Math.random() * 6.0;

        // Amplitude envelope
        const envGain = ctx.createGain();
        envGain.gain.setValueAtTime(0.0001, now);
        const peakGain = 0.18 * volMultiplier;
        const attackTime = 0.1 + Math.random() * 0.12;

        if (typeof envGain.gain.linearRampToValueAtTime === 'function') {
            envGain.gain.linearRampToValueAtTime(peakGain, now + attackTime);
            if (typeof envGain.gain.exponentialRampToValueAtTime === 'function') {
                envGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            }
        } else {
            envGain.gain.value = peakGain;
        }

        // Stereo panning
        let pannerNode = null;
        if (typeof ctx.createStereoPanner === 'function') {
            pannerNode = ctx.createStereoPanner();
            pannerNode.pan.value = Math.max(-1.0, Math.min(1.0, panVal));
        }

        // Connect graph
        noiseSource.connect(filter1);
        osc.connect(filter2);

        filter1.connect(envGain);
        filter2.connect(envGain);

        if (pannerNode) {
            envGain.connect(pannerNode);
            pannerNode.connect(this.industrialBus);
        } else {
            envGain.connect(this.industrialBus);
        }

        // Start and schedule stop
        try {
            noiseSource.start(now);
            osc.start(now);
            noiseSource.stop(now + duration);
            osc.stop(now + duration);
        } catch (e) { /* ignore */ }
    }

    /**
     * Synthesizes and triggers a low-frequency industrial rumble.
     * Simulates distant underground machines, heavy turbines, or structural subsidence.
     *
     * @param {Object} [options]
     * @param {number} [options.duration] - Duration in seconds
     * @param {number} [options.volume] - Relative volume multiplier (0..1)
     */
    triggerIndustrialRumble(options = {}) {
        if (!this.ctx || !this.industrialBus) return;

        const ctx = this.ctx;
        const now = ctx.currentTime || 0;
        const duration = options.duration ?? (4.5 + Math.random() * 2.5); // 4.5s to 7.0s
        const volMultiplier = options.volume ?? (0.7 + Math.random() * 0.3);

        // Sub oscillator (38 - 52 Hz) with slight pitch dive
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        const baseFreq = 44.0 + (Math.random() * 10.0 - 5.0);
        subOsc.frequency.setValueAtTime(baseFreq, now);
        if (typeof subOsc.frequency.exponentialRampToValueAtTime === 'function') {
            subOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.85, now + duration);
        }

        // Low-frequency brownian noise for seismic weight
        const noiseBuf = this._createPinkBrownianNoiseBuffer(duration);
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuf;

        // Steep lowpass filter (65 - 85 Hz)
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 72.0 + Math.random() * 15.0;
        lowpass.Q.value = 2.8;

        // Slow tremolo / pulsing (1.0 - 1.6 Hz)
        const tremoloOsc = ctx.createOscillator();
        tremoloOsc.type = 'sine';
        tremoloOsc.frequency.value = 1.2 + Math.random() * 0.4;

        const tremoloGain = ctx.createGain();
        tremoloGain.gain.value = 0.25;
        tremoloOsc.connect(tremoloGain);

        // Amplitude envelope (slow swell and long decay)
        const envGain = ctx.createGain();
        envGain.gain.setValueAtTime(0.0001, now);
        const peakGain = 0.32 * volMultiplier;
        const attackTime = 1.4 + Math.random() * 0.8;

        if (typeof envGain.gain.linearRampToValueAtTime === 'function') {
            envGain.gain.linearRampToValueAtTime(peakGain, now + attackTime);
            if (typeof envGain.gain.exponentialRampToValueAtTime === 'function') {
                envGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            }
        } else {
            envGain.gain.value = peakGain;
        }

        // Connect graph
        subOsc.connect(lowpass);
        noiseSource.connect(lowpass);
        lowpass.connect(envGain);
        envGain.connect(this.industrialBus);

        // Start and schedule stop
        try {
            subOsc.start(now);
            noiseSource.start(now);
            tremoloOsc.start(now);

            subOsc.stop(now + duration);
            noiseSource.stop(now + duration);
            tremoloOsc.stop(now + duration);
        } catch (e) { /* ignore */ }
    }

    /**
     * Synthesizes and triggers resonant hollow wind echoes.
     * Simulates wind howling through empty ventilation shafts, drainage conduits, and ruined bunkers.
     *
     * @param {Object} [options]
     * @param {number} [options.pan] - Stereo pan (-1.0 to +1.0)
     * @param {number} [options.volume] - Relative volume multiplier (0..1)
     * @param {number} [options.centerFreq] - Center frequency in Hz
     */
    triggerHollowWindEcho(options = {}) {
        if (!this.ctx || !this.industrialBus) return;

        const ctx = this.ctx;
        const now = ctx.currentTime || 0;
        const duration = 3.5 + Math.random() * 2.0; // 3.5s to 5.5s

        const panVal = options.pan ?? ((Math.random() * 2 - 1) * 0.8);
        const volMultiplier = options.volume ?? (0.65 + Math.random() * 0.35);
        const baseCenterFreq = options.centerFreq ?? (420 + Math.random() * 260);

        // Excitation noise burst
        const noiseBuf = this._createPinkBrownianNoiseBuffer(1.2);
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuf;

        // Resonant hollow bandpass filter (Q = 14..22)
        const resonantFilter = ctx.createBiquadFilter();
        resonantFilter.type = 'bandpass';
        resonantFilter.frequency.setValueAtTime(baseCenterFreq, now);
        if (typeof resonantFilter.frequency.exponentialRampToValueAtTime === 'function') {
            // Frequency sweeps down like wind whistling into a cavern
            resonantFilter.frequency.exponentialRampToValueAtTime(baseCenterFreq * 0.75, now + duration);
        }
        resonantFilter.Q.value = 16.0 + Math.random() * 6.0;

        // Feedback delay for hollow pipe echo
        let delayNode = null;
        let delayFeedback = null;
        if (typeof ctx.createDelay === 'function') {
            delayNode = ctx.createDelay();
            delayNode.delayTime.value = 0.24 + Math.random() * 0.12; // 240ms - 360ms

            delayFeedback = ctx.createGain();
            delayFeedback.gain.value = 0.62;

            delayNode.connect(delayFeedback);
            delayFeedback.connect(delayNode);
        }

        // Amplitude envelope
        const envGain = ctx.createGain();
        envGain.gain.setValueAtTime(0.0001, now);
        const peakGain = 0.22 * volMultiplier;
        const attackTime = 0.35 + Math.random() * 0.2;

        if (typeof envGain.gain.linearRampToValueAtTime === 'function') {
            envGain.gain.linearRampToValueAtTime(peakGain, now + attackTime);
            if (typeof envGain.gain.exponentialRampToValueAtTime === 'function') {
                envGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            }
        } else {
            envGain.gain.value = peakGain;
        }

        // Stereo panning
        let pannerNode = null;
        if (typeof ctx.createStereoPanner === 'function') {
            pannerNode = ctx.createStereoPanner();
            pannerNode.pan.value = Math.max(-1.0, Math.min(1.0, panVal));
        }

        // Connect graph
        noiseSource.connect(resonantFilter);
        resonantFilter.connect(envGain);

        if (delayNode && delayFeedback) {
            envGain.connect(delayNode);
            if (pannerNode) {
                delayNode.connect(pannerNode);
                envGain.connect(pannerNode);
                pannerNode.connect(this.industrialBus);
            } else {
                delayNode.connect(this.industrialBus);
                envGain.connect(this.industrialBus);
            }
        } else {
            if (pannerNode) {
                envGain.connect(pannerNode);
                pannerNode.connect(this.industrialBus);
            } else {
                envGain.connect(this.industrialBus);
            }
        }

        // Start and stop excitation
        try {
            noiseSource.start(now);
            noiseSource.stop(now + 1.2);
        } catch (e) { /* ignore */ }
    }

    /**
     * Sets master ambience volume.
     * @param {number} value - Volume between 0.0 and 1.0
     */
    setMasterVolume(value) {
        this.masterVolume = Math.max(0.0, Math.min(1.0, value));
        if (this.masterGain && this.masterGain.gain) {
            const now = (this.ctx && this.ctx.currentTime) || 0;
            this._setAudioParam(this.masterGain.gain, this.masterVolume, now, 0.05);
        }
    }

    /**
     * Sets wind generator volume.
     * @param {number} value - Volume between 0.0 and 1.0
     */
    setWindVolume(value) {
        this.windVolume = Math.max(0.0, Math.min(1.0, value));
        if (this.windBus && this.windBus.gain) {
            const now = (this.ctx && this.ctx.currentTime) || 0;
            this._setAudioParam(this.windBus.gain, this.windVolume, now, 0.05);
        }
    }

    /**
     * Sets cassette-futurism wasteland drone volume.
     * @param {number} value - Volume between 0.0 and 1.0
     */
    setDroneVolume(value) {
        this.droneVolume = Math.max(0.0, Math.min(1.0, value));
        if (this.droneBus && this.droneBus.gain) {
            const now = (this.ctx && this.ctx.currentTime) || 0;
            this._setAudioParam(this.droneBus.gain, this.droneVolume, now, 0.05);
        }
    }

    /**
     * Sets distant industrial wasteland events volume.
     * @param {number} value - Volume between 0.0 and 1.0
     */
    setIndustrialVolume(value) {
        this.industrialVolume = Math.max(0.0, Math.min(1.0, value));
        if (this.industrialBus && this.industrialBus.gain) {
            const now = (this.ctx && this.ctx.currentTime) || 0;
            this._setAudioParam(this.industrialBus.gain, this.industrialVolume, now, 0.05);
        }
    }

    /**
     * Returns current synthesizer state for inspection or testing.
     * @returns {Object}
     */
    getState() {
        return {
            isRunning: this.isRunning,
            isStarted: this.isStarted,
            masterVolume: this.masterVolume,
            windVolume: this.windVolume,
            droneVolume: this.droneVolume,
            industrialVolume: this.industrialVolume,
            windSpeed: this.currentWindSpeed,
            windGust: this.currentWindGust,
            turbulence: this.currentTurbulence,
            weatherState: this.currentWeatherState,
            creakTimer: this.creakTimer,
            rumbleTimer: this.rumbleTimer,
            echoTimer: this.echoTimer
        };
    }

    /**
     * Disposes and disconnects all audio nodes.
     */
    dispose() {
        this.stop();
        if (this.masterGain && typeof this.masterGain.disconnect === 'function') {
            try { this.masterGain.disconnect(); } catch (e) {}
        }
        if (this.windBus && typeof this.windBus.disconnect === 'function') {
            try { this.windBus.disconnect(); } catch (e) {}
        }
        if (this.droneBus && typeof this.droneBus.disconnect === 'function') {
            try { this.droneBus.disconnect(); } catch (e) {}
        }
        if (this.industrialBus && typeof this.industrialBus.disconnect === 'function') {
            try { this.industrialBus.disconnect(); } catch (e) {}
        }
    }
}

// Browser global exposure
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ProceduralAmbienceSynth = ProceduralAmbienceSynth;
}

// CommonJS / Node.js test environment export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProceduralAmbienceSynth };
}
