// ============================================================================
//  ArcEngine — Procedural ARC Machine Synthesizer
// ----------------------------------------------------------------------------
//  Real-time procedural audio synthesis for ARC robotic machine units using
//  the Web Audio API. Zero external audio asset dependencies.
//
//  Supported ARC Unit Archetypes:
//    1. ARC Cricket (Jumper):
//       - playCricketChitter(pos): High-frequency metallic servo clicks & insectoid chirp bursts.
//       - playCricketLeapCharge(pos): Rising hydraulic coil whine & spring tension before leaping.
//       - playCricketLanding(pos): Heavy quadruped ground slam shockwave thump with metal rattle.
//    2. ARC Screamer (EW Unit):
//       - playScreamerStiltStep(pos): Heavy 3-legged hydraulic thud with metallic resonance.
//       - playScreamerScream(pos): Frequency-swept sonic scream (400Hz-3200Hz FM + ring distortion).
//    3. ARC Spotter (Drone):
//       - playSpotterHover(pos): Twin contra-rotating propeller buzz with frequency modulation.
//       - playSpotterSiren(pos): Emergency two-tone rising alarm siren & rocket flare launch whoosh.
//    4. ARC Sentinel (Walker):
//       - playSentinelStep(pos): Massive hydraulic stomp with earth-shaking sub-bass.
//       - playSentinelHorn(pos): Low-frequency warship-like apocalyptic horn blast.
// ============================================================================

/**
 * @typedef {Object} Pos3D
 * @property {number} [x] - X coordinate in 3D world space
 * @property {number} [y] - Y coordinate (or height in 2D space)
 * @property {number} [z] - Z coordinate in 3D world space
 * @property {number} [h] - Optional height offset (Babylon coordinate convention)
 */

/**
 * @typedef {Pos3D | [number, number, number?] | null | undefined} SoundPosition
 */

/**
 * @typedef {Object} SoundHandle
 * @property {() => void} stop - Stop the sound and release audio nodes
 * @property {number} startTime - AudioContext start time in seconds
 * @property {number} duration - Estimated sound duration in seconds
 * @property {boolean} started - Whether the audio graph successfully started
 * @property {GainNode|null} [gainNode] - Main sound gain node
 * @property {PannerNode|null} [pannerNode] - Spatial panner node if spatialized
 * @property {Array<AudioNode>} [nodes] - List of created audio nodes for cleanup
 */

/**
 * Procedural synthesizer for ARC machine sound effects using Web Audio API.
 */
class ProceduralArcSynth {
    /**
     * @param {AudioContext | null} [audioCtx] - Optional external Web Audio context
     */
    constructor(audioCtx = null) {
        /** @type {AudioContext | null} */
        this.ctx = null;
        /** @type {boolean} */
        this._ownsContext = false;
        /** @type {GainNode | null} */
        this.masterGain = null;
        /** @type {DynamicsCompressorNode | null} */
        this.compressor = null;
        /** @type {AudioBuffer | null} */
        this._noiseBufferWhite = null;
        /** @type {AudioBuffer | null} */
        this._noiseBufferPink = null;
        /** @type {Float32Array | null} */
        this._distortionCurve = null;

        if (audioCtx) {
            this.ctx = audioCtx;
            this._ownsContext = false;
            this._setupMasterChain();
        } else if (typeof window !== 'undefined') {
            const AudioCtxClass = window.AudioContext || /** @type {any} */ (window)['webkitAudioContext'];
            if (AudioCtxClass) {
                try {
                    this.ctx = new AudioCtxClass();
                    this._ownsContext = true;
                    this._setupMasterChain();
                } catch {
                    this.ctx = null;
                }
            }
        }
    }

    /**
     * Initialize or resume audio context upon user gesture.
     * @returns {Promise<boolean>}
     */
    async init() {
        if (!this.ctx && typeof window !== 'undefined') {
            const AudioCtxClass = window.AudioContext || /** @type {any} */ (window)['webkitAudioContext'];
            if (AudioCtxClass) {
                try {
                    this.ctx = new AudioCtxClass();
                    this._ownsContext = true;
                    this._setupMasterChain();
                } catch {
                    return false;
                }
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            try {
                await this.ctx.resume();
            } catch {
                return false;
            }
        }
        return !!this.ctx;
    }

    /**
     * Set master output volume (0.0 to 1.0).
     * @param {number} vol
     */
    setMasterVolume(vol) {
        if (this.masterGain && this.ctx) {
            const clamped = Math.max(0, Math.min(1, vol));
            this.masterGain.gain.setValueAtTime(clamped, this.ctx.currentTime);
        }
    }

    /**
     * Get current master output volume.
     * @returns {number}
     */
    getMasterVolume() {
        return this.masterGain ? this.masterGain.gain.value : 0;
    }

    /**
     * Update audio listener position and orientation for 3D spatialization.
     * @param {SoundPosition} pos - Listener position
     * @param {{ x?: number, y?: number, z?: number } | null} [forward] - Forward vector
     */
    updateListener(pos, forward = null) {
        if (!this.ctx || !this.ctx.listener) return;
        const listener = this.ctx.listener;
        const coords = this._parseCoords(pos);
        const t = this.ctx.currentTime;

        if (listener.positionX) {
            listener.positionX.setValueAtTime(coords.x, t);
            listener.positionY.setValueAtTime(coords.y, t);
            listener.positionZ.setValueAtTime(coords.z, t);
        } else if (typeof listener.setPosition === 'function') {
            listener.setPosition(coords.x, coords.y, coords.z);
        }

        if (forward) {
            const fx = forward.x || 0;
            const fy = forward.y || 0;
            const fz = forward.z !== undefined ? forward.z : 1;
            if (listener.forwardX) {
                listener.forwardX.setValueAtTime(fx, t);
                listener.forwardY.setValueAtTime(fy, t);
                listener.forwardZ.setValueAtTime(fz, t);
                if (listener.upX) {
                    listener.upX.setValueAtTime(0, t);
                    listener.upY.setValueAtTime(1, t);
                    listener.upZ.setValueAtTime(0, t);
                }
            } else if (typeof listener.setOrientation === 'function') {
                listener.setOrientation(fx, fy, fz, 0, 1, 0);
            }
        }
    }

    // ========================================================================
    //  1. ARC Cricket (Jumper)
    // ========================================================================

    /**
     * High-frequency metallic servo clicks and insectoid chirp bursts.
     * Emitted by ARC Cricket when idle, scanning, or preparing to pounce.
     * @param {SoundPosition} [pos] - 3D world position
     * @returns {SoundHandle}
     */
    playCricketChitter(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 0.38;

        /** @type {Array<AudioNode>} */
        const nodes = [];
        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.7, t0);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // Sequence of 4 fast micro-chirp and servo click bursts
        const burstTimes = [0.0, 0.06, 0.13, 0.22];

        for (let i = 0; i < burstTimes.length; i++) {
            const bt = t0 + burstTimes[i];
            const pitchShift = 1.0 + (Math.random() * 0.2 - 0.1);

            // 1. Insectoid FM chirp
            const carrier = ctx.createOscillator();
            carrier.type = 'triangle';
            carrier.frequency.setValueAtTime(3200 * pitchShift, bt);
            carrier.frequency.exponentialRampToValueAtTime(4600 * pitchShift, bt + 0.015);
            carrier.frequency.exponentialRampToValueAtTime(2200 * pitchShift, bt + 0.045);

            const fmMod = ctx.createOscillator();
            fmMod.type = 'sawtooth';
            fmMod.frequency.setValueAtTime(175 * pitchShift, bt);

            const fmGain = ctx.createGain();
            fmGain.gain.setValueAtTime(650, bt);
            fmGain.gain.exponentialRampToValueAtTime(10, bt + 0.045);

            fmMod.connect(fmGain);
            fmGain.connect(carrier.frequency);

            const chirpGain = ctx.createGain();
            chirpGain.gain.setValueAtTime(0.001, bt);
            chirpGain.gain.linearRampToValueAtTime(0.65, bt + 0.004);
            chirpGain.gain.exponentialRampToValueAtTime(0.001, bt + 0.045);

            carrier.connect(chirpGain);
            chirpGain.connect(soundGain);

            carrier.start(bt);
            carrier.stop(bt + 0.05);
            fmMod.start(bt);
            fmMod.stop(bt + 0.05);
            nodes.push(carrier, fmMod, fmGain, chirpGain);

            // 2. High-frequency metallic servo click (gear tooth snap)
            const clickSrc = ctx.createBufferSource();
            clickSrc.buffer = this._getWhiteNoise();

            const hpFilter = ctx.createBiquadFilter();
            hpFilter.type = 'highpass';
            hpFilter.frequency.setValueAtTime(4500, bt);

            const bpFilter = ctx.createBiquadFilter();
            bpFilter.type = 'bandpass';
            bpFilter.frequency.setValueAtTime(6200 * pitchShift, bt);
            bpFilter.Q.setValueAtTime(12, bt);

            const clickGain = ctx.createGain();
            clickGain.gain.setValueAtTime(0.001, bt);
            clickGain.gain.linearRampToValueAtTime(0.8, bt + 0.002);
            clickGain.gain.exponentialRampToValueAtTime(0.001, bt + 0.015);

            clickSrc.connect(hpFilter);
            hpFilter.connect(bpFilter);
            bpFilter.connect(clickGain);
            clickGain.connect(soundGain);

            clickSrc.start(bt);
            clickSrc.stop(bt + 0.02);
            nodes.push(clickSrc, hpFilter, bpFilter, clickGain);
        }

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    /**
     * Rising hydraulic coil whine and spring tension before leaping.
     * Plays when ARC Cricket prepares to launch into a high-speed leap.
     * @param {SoundPosition} [pos] - 3D world position
     * @returns {SoundHandle}
     */
    playCricketLeapCharge(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 0.85;

        /** @type {Array<AudioNode>} */
        const nodes = [];
        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.01, t0);
        soundGain.gain.exponentialRampToValueAtTime(0.85, t0 + 0.75);
        soundGain.gain.linearRampToValueAtTime(0.001, t0 + duration);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // 1. Hydraulic coil whine (rising pitch and fluid pressure)
        const coilOsc = ctx.createOscillator();
        coilOsc.type = 'sawtooth';
        coilOsc.frequency.setValueAtTime(140, t0);
        coilOsc.frequency.exponentialRampToValueAtTime(1650, t0 + 0.78);

        const coilFilter = ctx.createBiquadFilter();
        coilFilter.type = 'bandpass';
        coilFilter.frequency.setValueAtTime(320, t0);
        coilFilter.frequency.exponentialRampToValueAtTime(2800, t0 + 0.78);
        coilFilter.Q.setValueAtTime(9, t0);

        const coilGain = ctx.createGain();
        coilGain.gain.setValueAtTime(0.5, t0);

        coilOsc.connect(coilFilter);
        coilFilter.connect(coilGain);
        coilGain.connect(soundGain);

        coilOsc.start(t0);
        coilOsc.stop(t0 + duration);
        nodes.push(coilOsc, coilFilter, coilGain);

        // 2. Spring tension jitter (mechanical stress oscillation)
        const springOsc = ctx.createOscillator();
        springOsc.type = 'triangle';
        springOsc.frequency.setValueAtTime(380, t0);
        springOsc.frequency.exponentialRampToValueAtTime(1250, t0 + 0.78);

        // Accelerating tension flutter LFO
        const tensionLfo = ctx.createOscillator();
        tensionLfo.type = 'sine';
        tensionLfo.frequency.setValueAtTime(6, t0);
        tensionLfo.frequency.exponentialRampToValueAtTime(32, t0 + 0.78);

        const tensionDepth = ctx.createGain();
        tensionDepth.gain.setValueAtTime(15, t0);
        tensionDepth.gain.linearRampToValueAtTime(80, t0 + 0.78);

        tensionLfo.connect(tensionDepth);
        tensionDepth.connect(springOsc.frequency);

        const springRes = ctx.createBiquadFilter();
        springRes.type = 'peaking';
        springRes.frequency.setValueAtTime(2400, t0);
        springRes.Q.setValueAtTime(8, t0);
        springRes.gain.setValueAtTime(12, t0);

        const springGain = ctx.createGain();
        springGain.gain.setValueAtTime(0.001, t0);
        springGain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.7);

        springOsc.connect(springRes);
        springRes.connect(springGain);
        springGain.connect(soundGain);

        springOsc.start(t0);
        springOsc.stop(t0 + duration);
        tensionLfo.start(t0);
        tensionLfo.stop(t0 + duration);
        nodes.push(springOsc, tensionLfo, tensionDepth, springRes, springGain);

        // 3. Hydraulic hiss buildup
        const hissSrc = ctx.createBufferSource();
        hissSrc.buffer = this._getPinkNoise();

        const hissFilter = ctx.createBiquadFilter();
        hissFilter.type = 'bandpass';
        hissFilter.frequency.setValueAtTime(800, t0);
        hissFilter.frequency.exponentialRampToValueAtTime(3400, t0 + 0.78);
        hissFilter.Q.setValueAtTime(4, t0);

        const hissGain = ctx.createGain();
        hissGain.gain.setValueAtTime(0.001, t0);
        hissGain.gain.linearRampToValueAtTime(0.25, t0 + 0.75);
        hissGain.gain.linearRampToValueAtTime(0.001, t0 + duration);

        hissSrc.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(soundGain);

        hissSrc.start(t0);
        hissSrc.stop(t0 + duration);
        nodes.push(hissSrc, hissFilter, hissGain);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    /**
     * Heavy quadruped ground slam shockwave thump with metal rattle.
     * Plays when ARC Cricket impacts the ground following a leap.
     * @param {SoundPosition} [pos] - 3D world position
     * @returns {SoundHandle}
     */
    playCricketLanding(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 0.75;

        /** @type {Array<AudioNode>} */
        const nodes = [];
        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.9, t0);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // 1. Shockwave sub-bass thump (ground displacement)
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(160, t0);
        subOsc.frequency.exponentialRampToValueAtTime(38, t0 + 0.32);

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.001, t0);
        subGain.gain.linearRampToValueAtTime(1.0, t0 + 0.004);
        subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);

        subOsc.connect(subGain);
        subGain.connect(soundGain);

        subOsc.start(t0);
        subOsc.stop(t0 + 0.46);
        nodes.push(subOsc, subGain);

        // 2. Ground slam impact burst (gravel / dirt dispersion)
        const slamSrc = ctx.createBufferSource();
        slamSrc.buffer = this._getPinkNoise();

        const slamFilter = ctx.createBiquadFilter();
        slamFilter.type = 'lowpass';
        slamFilter.frequency.setValueAtTime(260, t0);

        const slamGain = ctx.createGain();
        slamGain.gain.setValueAtTime(0.85, t0);
        slamGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);

        slamSrc.connect(slamFilter);
        slamFilter.connect(slamGain);
        slamGain.connect(soundGain);

        slamSrc.start(t0);
        slamSrc.stop(t0 + 0.3);
        nodes.push(slamSrc, slamFilter, slamGain);

        // 3. Heavy quadruped metal rattle & chassis settling
        const rattleFrequencies = [740, 1380, 2450];
        for (const freq of rattleFrequencies) {
            const metalSrc = ctx.createBufferSource();
            metalSrc.buffer = this._getWhiteNoise();

            const metalBp = ctx.createBiquadFilter();
            metalBp.type = 'bandpass';
            metalBp.frequency.setValueAtTime(freq, t0);
            metalBp.Q.setValueAtTime(16, t0);

            const metalGain = ctx.createGain();
            metalGain.gain.setValueAtTime(0.001, t0);
            metalGain.gain.linearRampToValueAtTime(0.35, t0 + 0.006);
            metalGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);

            metalSrc.connect(metalBp);
            metalBp.connect(metalGain);
            metalGain.connect(soundGain);

            metalSrc.start(t0);
            metalSrc.stop(t0 + 0.45);
            nodes.push(metalSrc, metalBp, metalGain);
        }

        // 4. Staggered loose metal armor plate micro-clicks
        const clickDelays = [0.025, 0.065, 0.12, 0.19, 0.28];
        for (const delay of clickDelays) {
            const ct = t0 + delay;
            const clickSrc = ctx.createBufferSource();
            clickSrc.buffer = this._getWhiteNoise();

            const clickHp = ctx.createBiquadFilter();
            clickHp.type = 'highpass';
            clickHp.frequency.setValueAtTime(3600, ct);

            const clickGain = ctx.createGain();
            clickGain.gain.setValueAtTime(0.001, ct);
            clickGain.gain.linearRampToValueAtTime(0.28, ct + 0.002);
            clickGain.gain.exponentialRampToValueAtTime(0.001, ct + 0.018);

            clickSrc.connect(clickHp);
            clickHp.connect(clickGain);
            clickGain.connect(soundGain);

            clickSrc.start(ct);
            clickSrc.stop(ct + 0.025);
            nodes.push(clickSrc, clickHp, clickGain);
        }

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    // ========================================================================
    //  2. ARC Screamer (EW Unit)
    // ========================================================================

    /**
     * Heavy 3-legged hydraulic thud with metallic resonance.
     * Footstep sound for the tall Screamer electronic warfare walker.
     * @param {SoundPosition} [pos] - 3D world position
     * @returns {SoundHandle}
     */
    playScreamerStiltStep(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 0.65;

        /** @type {Array<AudioNode>} */
        const nodes = [];
        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.85, t0);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // 1. Hydraulic thud low punch
        const thudOsc = ctx.createOscillator();
        thudOsc.type = 'triangle';
        thudOsc.frequency.setValueAtTime(145, t0);
        thudOsc.frequency.exponentialRampToValueAtTime(42, t0 + 0.22);

        const thudGain = ctx.createGain();
        thudGain.gain.setValueAtTime(0.001, t0);
        thudGain.gain.linearRampToValueAtTime(0.95, t0 + 0.003);
        thudGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);

        thudOsc.connect(thudGain);
        thudGain.connect(soundGain);

        thudOsc.start(t0);
        thudOsc.stop(t0 + 0.36);
        nodes.push(thudOsc, thudGain);

        // 2. High-pressure hydraulic exhaust hiss
        const hissSrc = ctx.createBufferSource();
        hissSrc.buffer = this._getPinkNoise();

        const hissFilter = ctx.createBiquadFilter();
        hissFilter.type = 'bandpass';
        hissFilter.frequency.setValueAtTime(1400, t0);
        hissFilter.Q.setValueAtTime(2.2, t0);

        const hissGain = ctx.createGain();
        hissGain.gain.setValueAtTime(0.001, t0);
        hissGain.gain.linearRampToValueAtTime(0.4, t0 + 0.006);
        hissGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);

        hissSrc.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(soundGain);

        hissSrc.start(t0);
        hissSrc.stop(t0 + 0.26);
        nodes.push(hissSrc, hissFilter, hissGain);

        // 3. Hollow metallic stilt resonance (tubular titanium leg ringing)
        const stiltResonances = [380, 920, 1850];
        for (const freq of stiltResonances) {
            const resSrc = ctx.createBufferSource();
            resSrc.buffer = this._getWhiteNoise();

            const resFilter = ctx.createBiquadFilter();
            resFilter.type = 'bandpass';
            resFilter.frequency.setValueAtTime(freq, t0);
            resFilter.Q.setValueAtTime(20, t0);

            const resGain = ctx.createGain();
            resGain.gain.setValueAtTime(0.001, t0);
            resGain.gain.linearRampToValueAtTime(0.3, t0 + 0.004);
            resGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.48);

            resSrc.connect(resFilter);
            resFilter.connect(resGain);
            resGain.connect(soundGain);

            resSrc.start(t0);
            resSrc.stop(t0 + 0.5);
            nodes.push(resSrc, resFilter, resGain);
        }

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    /**
     * Powerful frequency-swept sonic scream (rising carrier from 400Hz to 3200Hz
     * with fast FM modulation and ring distortion) producing an ominous acoustic wave.
     * @param {SoundPosition} [pos] - 3D world position
     * @returns {SoundHandle}
     */
    playScreamerScream(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const sweepTime = 1.6;
        const duration = 2.4;

        /** @type {Array<AudioNode>} */
        const nodes = [];
        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.001, t0);
        soundGain.gain.linearRampToValueAtTime(0.85, t0 + 0.12);
        soundGain.gain.setValueAtTime(0.85, t0 + sweepTime);
        soundGain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // 1. Rising carrier oscillator (400Hz -> 3200Hz)
        const carrier = ctx.createOscillator();
        carrier.type = 'sawtooth';
        carrier.frequency.setValueAtTime(400, t0);
        carrier.frequency.exponentialRampToValueAtTime(3200, t0 + sweepTime);

        // 2. Fast FM modulation
        const fmOsc = ctx.createOscillator();
        fmOsc.type = 'sine';
        fmOsc.frequency.setValueAtTime(85, t0);
        fmOsc.frequency.exponentialRampToValueAtTime(140, t0 + sweepTime);

        const fmGain = ctx.createGain();
        fmGain.gain.setValueAtTime(750, t0);
        fmGain.gain.linearRampToValueAtTime(1100, t0 + sweepTime);

        fmOsc.connect(fmGain);
        fmGain.connect(carrier.frequency);

        // 3. Ring distortion via audio-rate ring modulation and WaveShaper
        const ringModOsc = ctx.createOscillator();
        ringModOsc.type = 'sawtooth';
        ringModOsc.frequency.setValueAtTime(180, t0);
        ringModOsc.frequency.exponentialRampToValueAtTime(260, t0 + sweepTime);

        const ringGainNode = ctx.createGain();
        ringGainNode.gain.setValueAtTime(0, t0);
        ringModOsc.connect(ringGainNode.gain);

        const shaper = ctx.createWaveShaper();
        shaper.curve = /** @type {any} */ (this._getDistortionCurve());
        shaper.oversample = '2x';

        // 4. Acoustic wave sweeping resonant filter
        const sweepFilter = ctx.createBiquadFilter();
        sweepFilter.type = 'bandpass';
        sweepFilter.frequency.setValueAtTime(550, t0);
        sweepFilter.frequency.exponentialRampToValueAtTime(3600, t0 + sweepTime);
        sweepFilter.Q.setValueAtTime(7.5, t0);

        carrier.connect(ringGainNode);
        ringGainNode.connect(shaper);
        shaper.connect(sweepFilter);
        sweepFilter.connect(soundGain);

        carrier.start(t0);
        carrier.stop(t0 + duration);
        fmOsc.start(t0);
        fmOsc.stop(t0 + duration);
        ringModOsc.start(t0);
        ringModOsc.stop(t0 + duration);
        nodes.push(carrier, fmOsc, fmGain, ringModOsc, ringGainNode, shaper, sweepFilter);

        // 5. Sub-carrier drone for ominous body
        const subDrone = ctx.createOscillator();
        subDrone.type = 'sawtooth';
        subDrone.frequency.setValueAtTime(95, t0);
        subDrone.frequency.exponentialRampToValueAtTime(190, t0 + sweepTime);

        const subLp = ctx.createBiquadFilter();
        subLp.type = 'lowpass';
        subLp.frequency.setValueAtTime(260, t0);

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.001, t0);
        subGain.gain.linearRampToValueAtTime(0.45, t0 + 0.15);
        subGain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

        subDrone.connect(subLp);
        subLp.connect(subGain);
        subGain.connect(soundGain);

        subDrone.start(t0);
        subDrone.stop(t0 + duration);
        nodes.push(subDrone, subLp, subGain);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    // ========================================================================
    //  3. ARC Spotter (Drone)
    // ========================================================================

    /**
     * Twin contra-rotating propeller buzz with frequency modulation.
     * Drone hover audio loop / burst.
     * @param {SoundPosition} [pos] - 3D world position
     * @param {number} [duration=2.5] - Sound duration in seconds
     * @returns {SoundHandle}
     */
    playSpotterHover(pos = null, duration = 2.5) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;

        /** @type {Array<AudioNode>} */
        const nodes = [];
        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.001, t0);
        soundGain.gain.linearRampToValueAtTime(0.65, t0 + 0.2);
        soundGain.gain.setValueAtTime(0.65, t0 + duration - 0.25);
        soundGain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // Turbulence FM modulator
        const turbLfo = ctx.createOscillator();
        turbLfo.type = 'sine';
        turbLfo.frequency.setValueAtTime(4.2, t0);

        const turbGain = ctx.createGain();
        turbGain.gain.setValueAtTime(4.5, t0);

        turbLfo.connect(turbGain);
        turbLfo.start(t0);
        turbLfo.stop(t0 + duration);
        nodes.push(turbLfo, turbGain);

        // Twin contra-rotating rotor oscillators (creating acoustic beating)
        const rotorFreqs = [82, 86, 164, 172]; // Fundamentals + 2nd harmonic
        for (let i = 0; i < rotorFreqs.length; i++) {
            const osc = ctx.createOscillator();
            osc.type = i < 2 ? 'sawtooth' : 'triangle';
            osc.frequency.setValueAtTime(rotorFreqs[i], t0);

            turbGain.connect(osc.frequency);

            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(rotorFreqs[i] * 1.5, t0);
            bp.Q.setValueAtTime(3.5, t0);

            const rGain = ctx.createGain();
            rGain.gain.setValueAtTime(i < 2 ? 0.35 : 0.18, t0);

            osc.connect(bp);
            bp.connect(rGain);
            rGain.connect(soundGain);

            osc.start(t0);
            osc.stop(t0 + duration);
            nodes.push(osc, bp, rGain);
        }

        // Rotor air slicing whir (noise modulated by rotor pass rate)
        const washSrc = ctx.createBufferSource();
        washSrc.buffer = this._getWhiteNoise();
        washSrc.loop = true;

        const washFilter = ctx.createBiquadFilter();
        washFilter.type = 'bandpass';
        washFilter.frequency.setValueAtTime(1750, t0);
        washFilter.Q.setValueAtTime(3.2, t0);

        const chopLfo = ctx.createOscillator();
        chopLfo.type = 'square';
        chopLfo.frequency.setValueAtTime(16, t0);

        const chopGain = ctx.createGain();
        chopGain.gain.setValueAtTime(0.5, t0);

        const washAmp = ctx.createGain();
        washAmp.gain.setValueAtTime(0.2, t0);

        chopLfo.connect(chopGain.gain);
        washSrc.connect(washFilter);
        washFilter.connect(chopGain);
        chopGain.connect(washAmp);
        washAmp.connect(soundGain);

        washSrc.start(t0);
        washSrc.stop(t0 + duration);
        chopLfo.start(t0);
        chopLfo.stop(t0 + duration);
        nodes.push(washSrc, washFilter, chopLfo, chopGain, washAmp);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    /**
     * Emergency two-tone rising alarm siren and rocket flare launch whoosh.
     * Emitted when Spotter detects an intruder and signals for reinforcements.
     * @param {SoundPosition} [pos] - 3D world position
     * @returns {SoundHandle}
     */
    playSpotterSiren(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 2.2;

        /** @type {Array<AudioNode>} */
        const nodes = [];
        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.85, t0);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // 1. Two-tone rising alarm siren (4 alternating staccato pairs)
        const tonePairs = [
            { a: 850, b: 1200, t: 0.00 },
            { a: 950, b: 1350, t: 0.22 },
            { a: 1100, b: 1550, t: 0.44 },
            { a: 1280, b: 1800, t: 0.66 },
        ];

        for (const tp of tonePairs) {
            const st = t0 + tp.t;
            const sirenOsc = ctx.createOscillator();
            sirenOsc.type = 'sawtooth';
            sirenOsc.frequency.setValueAtTime(tp.a, st);
            sirenOsc.frequency.setValueAtTime(tp.b, st + 0.10);

            const sirenFilter = ctx.createBiquadFilter();
            sirenFilter.type = 'lowpass';
            sirenFilter.frequency.setValueAtTime(3000, st);
            sirenFilter.Q.setValueAtTime(4.0, st);

            const sirenGain = ctx.createGain();
            sirenGain.gain.setValueAtTime(0.001, st);
            sirenGain.gain.linearRampToValueAtTime(0.65, st + 0.01);
            sirenGain.gain.setValueAtTime(0.65, st + 0.18);
            sirenGain.gain.exponentialRampToValueAtTime(0.001, st + 0.20);

            sirenOsc.connect(sirenFilter);
            sirenFilter.connect(sirenGain);
            sirenGain.connect(soundGain);

            sirenOsc.start(st);
            sirenOsc.stop(st + 0.21);
            nodes.push(sirenOsc, sirenFilter, sirenGain);
        }

        // 2. Rocket flare launch whoosh (launches at t0 + 0.5s)
        const ft = t0 + 0.50;

        // Flare launch ignition pop
        const popSrc = ctx.createBufferSource();
        popSrc.buffer = this._getPinkNoise();

        const popFilter = ctx.createBiquadFilter();
        popFilter.type = 'lowpass';
        popFilter.frequency.setValueAtTime(450, ft);

        const popGain = ctx.createGain();
        popGain.gain.setValueAtTime(0.001, ft);
        popGain.gain.linearRampToValueAtTime(0.8, ft + 0.004);
        popGain.gain.exponentialRampToValueAtTime(0.001, ft + 0.08);

        popSrc.connect(popFilter);
        popFilter.connect(popGain);
        popGain.connect(soundGain);

        popSrc.start(ft);
        popSrc.stop(ft + 0.10);
        nodes.push(popSrc, popFilter, popGain);

        // Rocket flare whoosh (sweeping bandpass noise + booster pitch dive)
        const whooshSrc = ctx.createBufferSource();
        whooshSrc.buffer = this._getWhiteNoise();

        const whooshFilter = ctx.createBiquadFilter();
        whooshFilter.type = 'bandpass';
        whooshFilter.frequency.setValueAtTime(320, ft);
        whooshFilter.frequency.exponentialRampToValueAtTime(3400, ft + 0.42);
        whooshFilter.frequency.exponentialRampToValueAtTime(600, ft + 1.2);
        whooshFilter.Q.setValueAtTime(3.5, ft);

        const whooshGain = ctx.createGain();
        whooshGain.gain.setValueAtTime(0.001, ft);
        whooshGain.gain.linearRampToValueAtTime(0.75, ft + 0.15);
        whooshGain.gain.exponentialRampToValueAtTime(0.001, ft + 1.4);

        whooshSrc.connect(whooshFilter);
        whooshFilter.connect(whooshGain);
        whooshGain.connect(soundGain);

        whooshSrc.start(ft);
        whooshSrc.stop(ft + 1.5);
        nodes.push(whooshSrc, whooshFilter, whooshGain);

        // Rocket booster thrust tone
        const rocketOsc = ctx.createOscillator();
        rocketOsc.type = 'sawtooth';
        rocketOsc.frequency.setValueAtTime(360, ft);
        rocketOsc.frequency.exponentialRampToValueAtTime(80, ft + 1.1);

        const rocketGain = ctx.createGain();
        rocketGain.gain.setValueAtTime(0.001, ft);
        rocketGain.gain.linearRampToValueAtTime(0.35, ft + 0.1);
        rocketGain.gain.exponentialRampToValueAtTime(0.001, ft + 1.1);

        rocketOsc.connect(rocketGain);
        rocketGain.connect(soundGain);

        rocketOsc.start(ft);
        rocketOsc.stop(ft + 1.2);
        nodes.push(rocketOsc, rocketGain);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    // ========================================================================
    //  4. ARC Sentinel (Walker)
    // ========================================================================

    /**
     * Massive hydraulic stomp with earth-shaking sub-bass.
     * Footstep stomp for the colossal Sentinel walker.
     * @param {SoundPosition} [pos] - 3D world position
     * @returns {SoundHandle}
     */
    playSentinelStep(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 1.25;

        /** @type {Array<AudioNode>} */
        const nodes = [];
        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(1.0, t0);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // 1. Earth-shaking sub-bass impact (deep pitch glide)
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(85, t0);
        subOsc.frequency.exponentialRampToValueAtTime(28, t0 + 0.85);

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.001, t0);
        subGain.gain.linearRampToValueAtTime(1.0, t0 + 0.008);
        subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.95);

        subOsc.connect(subGain);
        subGain.connect(soundGain);

        subOsc.start(t0);
        subOsc.stop(t0 + 1.0);
        nodes.push(subOsc, subGain);

        // 2. Colossal hydraulic piston pressure release (low & bandpass noise)
        const slamSrc = ctx.createBufferSource();
        slamSrc.buffer = this._getPinkNoise();

        const slamFilter = ctx.createBiquadFilter();
        slamFilter.type = 'lowpass';
        slamFilter.frequency.setValueAtTime(320, t0);

        const slamGain = ctx.createGain();
        slamGain.gain.setValueAtTime(0.95, t0);
        slamGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);

        slamSrc.connect(slamFilter);
        slamFilter.connect(slamGain);
        slamGain.connect(soundGain);

        slamSrc.start(t0);
        slamSrc.stop(t0 + 0.5);
        nodes.push(slamSrc, slamFilter, slamGain);

        // 3. High-pressure hydraulic exhaust hiss
        const hissSrc = ctx.createBufferSource();
        hissSrc.buffer = this._getWhiteNoise();

        const hissFilter = ctx.createBiquadFilter();
        hissFilter.type = 'highpass';
        hissFilter.frequency.setValueAtTime(2200, t0);

        const hissGain = ctx.createGain();
        hissGain.gain.setValueAtTime(0.001, t0);
        hissGain.gain.linearRampToValueAtTime(0.42, t0 + 0.012);
        hissGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);

        hissSrc.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(soundGain);

        hissSrc.start(t0);
        hissSrc.stop(t0 + 0.4);
        nodes.push(hissSrc, hissFilter, hissGain);

        // 4. Mechanical armor plate impact clunk
        const clunkOsc = ctx.createOscillator();
        clunkOsc.type = 'square';
        clunkOsc.frequency.setValueAtTime(110, t0);
        clunkOsc.frequency.exponentialRampToValueAtTime(45, t0 + 0.09);

        const clunkFilter = ctx.createBiquadFilter();
        clunkFilter.type = 'lowpass';
        clunkFilter.frequency.setValueAtTime(400, t0);

        const clunkGain = ctx.createGain();
        clunkGain.gain.setValueAtTime(0.001, t0);
        clunkGain.gain.linearRampToValueAtTime(0.65, t0 + 0.003);
        clunkGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);

        clunkOsc.connect(clunkFilter);
        clunkFilter.connect(clunkGain);
        clunkGain.connect(soundGain);

        clunkOsc.start(t0);
        clunkOsc.stop(t0 + 0.16);
        nodes.push(clunkOsc, clunkFilter, clunkGain);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    /**
     * Low-frequency warship-like horn blast.
     * Colossal industrial warhorn emitted by ARC Sentinel when entering combat mode.
     * @param {SoundPosition} [pos] - 3D world position
     * @returns {SoundHandle}
     */
    playSentinelHorn(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const blastDuration = 1.9;
        const totalDuration = 3.1;

        /** @type {Array<AudioNode>} */
        const nodes = [];
        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.001, t0);
        soundGain.gain.linearRampToValueAtTime(0.95, t0 + 0.25);
        soundGain.gain.setValueAtTime(0.95, t0 + blastDuration);
        soundGain.gain.exponentialRampToValueAtTime(0.001, t0 + totalDuration);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // Acoustic flutter / pressure fluctuation LFO
        const flutterLfo = ctx.createOscillator();
        flutterLfo.type = 'sine';
        flutterLfo.frequency.setValueAtTime(4.8, t0);

        const flutterGain = ctx.createGain();
        flutterGain.gain.setValueAtTime(1.8, t0);

        flutterLfo.connect(flutterGain);
        flutterLfo.start(t0);
        flutterLfo.stop(t0 + totalDuration);
        nodes.push(flutterLfo, flutterGain);

        // Multi-oscillator warship horn cluster (fundamental 62Hz, detuned chorus + harmonics)
        const hornHarmonics = [
            { freq: 62.0, type: 'sawtooth', gain: 0.50 }, // Fundamental
            { freq: 62.8, type: 'sawtooth', gain: 0.35 }, // Detune +
            { freq: 61.2, type: 'sawtooth', gain: 0.35 }, // Detune -
            { freq: 93.0, type: 'sawtooth', gain: 0.30 }, // Fifth
            { freq: 124.0, type: 'sawtooth', gain: 0.25 }, // Octave
            { freq: 147.0, type: 'triangle', gain: 0.20 }, // Minor third dissonant overtone
        ];

        for (const h of hornHarmonics) {
            const osc = ctx.createOscillator();
            osc.type = /** @type {OscillatorType} */ (h.type);
            osc.frequency.setValueAtTime(h.freq, t0);

            flutterGain.connect(osc.frequency);

            const hGain = ctx.createGain();
            hGain.gain.setValueAtTime(h.gain, t0);

            osc.connect(hGain);
            hGain.connect(soundGain);

            osc.start(t0);
            osc.stop(t0 + totalDuration);
            nodes.push(osc, hGain);
        }

        // Formant cavity filters (simulating cavernous metal horn resonance)
        const formant1 = ctx.createBiquadFilter();
        formant1.type = 'bandpass';
        formant1.frequency.setValueAtTime(220, t0);
        formant1.Q.setValueAtTime(4.5, t0);

        const formant2 = ctx.createBiquadFilter();
        formant2.type = 'bandpass';
        formant2.frequency.setValueAtTime(680, t0);
        formant2.Q.setValueAtTime(4.0, t0);

        const formantGain = ctx.createGain();
        formantGain.gain.setValueAtTime(0.4, t0);

        soundGain.connect(formant1);
        formant1.connect(formantGain);
        soundGain.connect(formant2);
        formant2.connect(formantGain);
        formantGain.connect(this.masterGain);
        nodes.push(formant1, formant2, formantGain);

        return this._createHandle(soundGain, panner, t0, totalDuration, nodes);
    }

    /**
     * Predatory guttural servo growl & mechanical purr for Stalker Hound.
     * @param {SoundPosition} [pos=null]
     * @returns {SoundHandle}
     */
    playStalkerGrowl(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 0.65;
        const nodes = [];

        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.001, t0);
        soundGain.gain.linearRampToValueAtTime(0.65, t0 + 0.12);
        soundGain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        nodes.push(soundGain);

        const panner = this._setupSpatial(soundGain, pos);

        // Guttural FM carrier + modulator
        const carrier = ctx.createOscillator();
        carrier.type = 'sawtooth';
        carrier.frequency.setValueAtTime(85, t0);
        carrier.frequency.linearRampToValueAtTime(115, t0 + 0.35);
        carrier.frequency.exponentialRampToValueAtTime(65, t0 + duration);

        const mod = ctx.createOscillator();
        mod.type = 'sine';
        mod.frequency.setValueAtTime(28, t0);
        mod.frequency.linearRampToValueAtTime(36, t0 + 0.3);

        const modGain = ctx.createGain();
        modGain.gain.setValueAtTime(120, t0);
        mod.connect(modGain);
        modGain.connect(carrier.frequency);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, t0);
        filter.frequency.linearRampToValueAtTime(850, t0 + 0.25);
        filter.frequency.exponentialRampToValueAtTime(180, t0 + duration);

        carrier.connect(filter);
        filter.connect(soundGain);

        carrier.start(t0);
        carrier.stop(t0 + duration);
        mod.start(t0);
        mod.stop(t0 + duration);
        nodes.push(carrier, mod, modGain, filter);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    /**
     * Pneumatic sprint hiss & hydraulic latch release for Stalker Hound flank/pounce.
     * @param {SoundPosition} [pos=null]
     * @returns {SoundHandle}
     */
    playStalkerPounce(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 0.42;
        const nodes = [];

        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.7, t0);
        nodes.push(soundGain);
        const panner = this._setupSpatial(soundGain, pos);

        // Pneumatic hiss burst
        const hissSrc = ctx.createBufferSource();
        hissSrc.buffer = this._getWhiteNoise();
        const hissFilter = ctx.createBiquadFilter();
        hissFilter.type = 'bandpass';
        hissFilter.frequency.setValueAtTime(2200, t0);
        hissFilter.Q.setValueAtTime(3.0, t0);

        const hissGain = ctx.createGain();
        hissGain.gain.setValueAtTime(0.001, t0);
        hissGain.gain.linearRampToValueAtTime(0.8, t0 + 0.03);
        hissGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);

        hissSrc.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(soundGain);
        hissSrc.start(t0);
        hissSrc.stop(t0 + 0.38);
        nodes.push(hissSrc, hissFilter, hissGain);

        // Metallic latch click
        const clickOsc = ctx.createOscillator();
        clickOsc.type = 'triangle';
        clickOsc.frequency.setValueAtTime(1800, t0);
        clickOsc.frequency.exponentialRampToValueAtTime(350, t0 + 0.05);

        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.9, t0);
        clickGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);

        clickOsc.connect(clickGain);
        clickGain.connect(soundGain);
        clickOsc.start(t0);
        clickOsc.stop(t0 + 0.07);
        nodes.push(clickOsc, clickGain);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    /**
     * Heavy hydraulic outrigger clamp / ground anchor for Bombard Mortar.
     * @param {SoundPosition} [pos=null]
     * @returns {SoundHandle}
     */
    playBombardDeploy(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 1.1;
        const nodes = [];

        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.85, t0);
        nodes.push(soundGain);
        const panner = this._setupSpatial(soundGain, pos);

        // 1. Hydraulic pressure hiss
        const hissSrc = ctx.createBufferSource();
        hissSrc.buffer = this._getWhiteNoise();
        const hissFilter = ctx.createBiquadFilter();
        hissFilter.type = 'bandpass';
        hissFilter.frequency.setValueAtTime(1400, t0);
        hissFilter.frequency.exponentialRampToValueAtTime(600, t0 + 0.8);
        const hissGain = ctx.createGain();
        hissGain.gain.setValueAtTime(0.001, t0);
        hissGain.gain.linearRampToValueAtTime(0.6, t0 + 0.15);
        hissGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);

        hissSrc.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(soundGain);
        hissSrc.start(t0);
        hissSrc.stop(t0 + 0.95);
        nodes.push(hissSrc, hissFilter, hissGain);

        // 2. Heavy mechanical thud when outriggers slam into the ground
        const slamTime = t0 + 0.55;
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(120, slamTime);
        subOsc.frequency.exponentialRampToValueAtTime(32, slamTime + 0.35);

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.95, slamTime);
        subGain.gain.exponentialRampToValueAtTime(0.001, slamTime + 0.5);

        subOsc.connect(subGain);
        subGain.connect(soundGain);
        subOsc.start(slamTime);
        subOsc.stop(slamTime + 0.55);
        nodes.push(subOsc, subGain);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    /**
     * Heavy artillery mortar launch thump & compressed air expulsion.
     * @param {SoundPosition} [pos=null]
     * @returns {SoundHandle}
     */
    playBombardLaunch(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 0.95;
        const nodes = [];

        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(0.9, t0);
        nodes.push(soundGain);
        const panner = this._setupSpatial(soundGain, pos);

        // Sub-bass mortar boom
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(95, t0);
        subOsc.frequency.exponentialRampToValueAtTime(36, t0 + 0.28);
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(1.0, t0);
        subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);

        subOsc.connect(subGain);
        subGain.connect(soundGain);
        subOsc.start(t0);
        subOsc.stop(t0 + 0.55);
        nodes.push(subOsc, subGain);

        // High-pressure muzzle gas ejection whoosh
        const gasSrc = ctx.createBufferSource();
        gasSrc.buffer = this._getWhiteNoise();
        const gasFilter = ctx.createBiquadFilter();
        gasFilter.type = 'lowpass';
        gasFilter.frequency.setValueAtTime(1800, t0);
        gasFilter.frequency.exponentialRampToValueAtTime(350, t0 + 0.6);
        const gasGain = ctx.createGain();
        gasGain.gain.setValueAtTime(0.85, t0);
        gasGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);

        gasSrc.connect(gasFilter);
        gasFilter.connect(gasGain);
        gasGain.connect(soundGain);
        gasSrc.start(t0);
        gasSrc.stop(t0 + 0.75);
        nodes.push(gasSrc, gasFilter, gasGain);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    /**
     * Massive distant artillery mortar shell detonation & shockwave.
     * @param {SoundPosition} [pos=null]
     * @returns {SoundHandle}
     */
    playBombardImpact(pos = null) {
        if (!this._ensureReady()) return this._dummyHandle();
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const t0 = ctx.currentTime;
        const duration = 2.0;
        const nodes = [];

        const soundGain = ctx.createGain();
        soundGain.gain.setValueAtTime(1.0, t0);
        nodes.push(soundGain);
        const panner = this._setupSpatial(soundGain, pos);

        // Ground-shaking sub-bass detonation
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(80, t0);
        subOsc.frequency.exponentialRampToValueAtTime(24, t0 + 0.6);
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(1.0, t0);
        subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.2);

        subOsc.connect(subGain);
        subGain.connect(soundGain);
        subOsc.start(t0);
        subOsc.stop(t0 + 1.3);
        nodes.push(subOsc, subGain);

        // Distorted explosive blast noise
        const noiseSrc = ctx.createBufferSource();
        noiseSrc.buffer = this._getWhiteNoise();
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(2400, t0);
        noiseFilter.frequency.exponentialRampToValueAtTime(180, t0 + 1.4);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.9, t0);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.8);

        noiseSrc.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(soundGain);
        noiseSrc.start(t0);
        noiseSrc.stop(t0 + 1.9);
        nodes.push(noiseSrc, noiseFilter, noiseGain);

        return this._createHandle(soundGain, panner, t0, duration, nodes);
    }

    // ========================================================================
    //  Internal Helpers
    // ========================================================================

    /**
     * @private
     * Setup master gain and dynamics compressor limiter.
     */
    _setupMasterChain() {
        if (!this.ctx) return;
        try {
            this.compressor = this.ctx.createDynamicsCompressor();
            this.compressor.threshold.setValueAtTime(-4, this.ctx.currentTime);
            this.compressor.knee.setValueAtTime(6, this.ctx.currentTime);
            this.compressor.ratio.setValueAtTime(10, this.ctx.currentTime);
            this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
            this.compressor.release.setValueAtTime(0.12, this.ctx.currentTime);

            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime);

            this.masterGain.connect(this.compressor);
            this.compressor.connect(this.ctx.destination);
        } catch {
            this.masterGain = null;
            this.compressor = null;
        }
    }

    /**
     * @private
     * @returns {boolean}
     */
    _ensureReady() {
        if (!this.ctx) return false;
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
        return true;
    }

    /**
     * @private
     * @param {AudioNode} sourceNode
     * @param {SoundPosition} pos
     * @returns {PannerNode | null}
     */
    _setupSpatial(sourceNode, pos) {
        if (!this.ctx || !this.masterGain) return null;
        if (!pos) {
            sourceNode.connect(this.masterGain);
            return null;
        }

        try {
            const panner = this.ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = 45;
            panner.maxDistance = 2500;
            panner.rolloffFactor = 1.15;
            panner.coneInnerAngle = 360;

            const c = this._parseCoords(pos);
            const t = this.ctx.currentTime;
            if (panner.positionX) {
                panner.positionX.setValueAtTime(c.x, t);
                panner.positionY.setValueAtTime(c.y, t);
                panner.positionZ.setValueAtTime(c.z, t);
            } else if (typeof panner.setPosition === 'function') {
                panner.setPosition(c.x, c.y, c.z);
            }

            sourceNode.connect(panner);
            panner.connect(this.masterGain);
            return panner;
        } catch {
            sourceNode.connect(this.masterGain);
            return null;
        }
    }

    /**
     * @private
     * @param {SoundPosition} pos
     * @returns {{ x: number, y: number, z: number }}
     */
    _parseCoords(pos) {
        if (Array.isArray(pos)) {
            return {
                x: Number(pos[0]) || 0,
                y: Number(pos[1]) || 0,
                z: Number(pos[2]) || 0,
            };
        }
        if (pos && typeof pos === 'object') {
            const x = Number(pos.x) || 0;
            if (pos.z !== undefined) {
                return { x, y: Number(pos.y) || 0, z: Number(pos.z) || 0 };
            }
            if (pos.h !== undefined) {
                // Babylon coordinate convention: Y is up, Z is 2D Y
                return { x, y: Number(pos.h) || 0, z: Number(pos.y) || 0 };
            }
            return { x, y: 0, z: Number(pos.y) || 0 };
        }
        return { x: 0, y: 0, z: 0 };
    }

    /**
     * @private
     * @returns {AudioBuffer}
     */
    _getWhiteNoise() {
        if (this._noiseBufferWhite) return this._noiseBufferWhite;
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const sampleRate = ctx.sampleRate || 44100;
        const length = Math.floor(sampleRate * 1.5);
        const buffer = ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this._noiseBufferWhite = buffer;
        return buffer;
    }

    /**
     * @private
     * @returns {AudioBuffer}
     */
    _getPinkNoise() {
        if (this._noiseBufferPink) return this._noiseBufferPink;
        const ctx = /** @type {AudioContext} */ (this.ctx);
        const sampleRate = ctx.sampleRate || 44100;
        const length = Math.floor(sampleRate * 1.5);
        const buffer = ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < length; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            data[i] = (b0 + b1 + b2) * 0.11;
        }
        this._noiseBufferPink = buffer;
        return buffer;
    }

    /**
     * @private
     * @returns {Float32Array}
     */
    _getDistortionCurve() {
        if (this._distortionCurve) return this._distortionCurve;
        const n_samples = 2048;
        const curve = new Float32Array(n_samples);
        const amount = 65;
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }
        this._distortionCurve = curve;
        return curve;
    }

    /**
     * @private
     * @param {GainNode} soundGain
     * @param {PannerNode | null} panner
     * @param {number} startTime
     * @param {number} duration
     * @param {Array<AudioNode>} nodes
     * @returns {SoundHandle}
     */
    _createHandle(soundGain, panner, startTime, duration, nodes) {
        let isStopped = false;
        const ctx = this.ctx;

        return {
            startTime,
            duration,
            started: true,
            gainNode: soundGain,
            pannerNode: panner,
            nodes,
            stop: () => {
                if (isStopped || !ctx) return;
                isStopped = true;
                const now = ctx.currentTime;
                try {
                    soundGain.gain.cancelScheduledValues(now);
                    soundGain.gain.setValueAtTime(soundGain.gain.value, now);
                    soundGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
                } catch {
                    // Ignore disconnect errors during teardown
                }
                const cleanup = () => {
                    for (const node of nodes) {
                        try {
                            if ('stop' in node && typeof /** @type {any} */ (node).stop === 'function') {
                                /** @type {any} */ (node).stop();
                            }
                            node.disconnect();
                        } catch {
                            // Node already stopped or disconnected
                        }
                    }
                    try {
                        soundGain.disconnect();
                        if (panner) panner.disconnect();
                    } catch {
                        // Already disconnected
                    }
                };
                if (typeof setTimeout !== 'undefined') {
                    setTimeout(cleanup, 50);
                } else {
                    cleanup();
                }
            },
        };
    }

    /**
     * @private
     * @returns {SoundHandle}
     */
    _dummyHandle() {
        return {
            stop: () => {},
            startTime: 0,
            duration: 0,
            started: false,
            gainNode: null,
            pannerNode: null,
            nodes: [],
        };
    }

    /**
     * Dispose synthesizer and close internal AudioContext if owned.
     */
    dispose() {
        if (this._ownsContext && this.ctx && typeof this.ctx.close === 'function') {
            this.ctx.close().catch(() => {});
        }
        this.ctx = null;
        this.masterGain = null;
        this.compressor = null;
        this._noiseBufferWhite = null;
        this._noiseBufferPink = null;
        this._distortionCurve = null;
    }
}

// Browser / global exposure
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ProceduralArcSynth = ProceduralArcSynth;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).ProceduralArcSynth = ProceduralArcSynth;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProceduralArcSynth };
}
