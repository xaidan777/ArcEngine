// ============================================================================
//  ArcEngine — ProceduralWeaponSynth & ProceduralAudioCore
// ----------------------------------------------------------------------------
//  High-fidelity multi-layered procedural audio synthesis for kinetic and energy
//  weapons using Web Audio API. Zero dependencies, pure mathematical modeling:
//  - Frequency modulation (FM) for ARC plasma weapons
//  - Multi-layered transient, punch, mechanical clicks, and acoustic decay
//  - Precomputed noise buffers (White, Pink, Brown) and WaveShaper distortion
//  - 3D spatial audio attenuation, air absorption lowpass, and stereo panning
// ============================================================================

/**
 * 3D / 2D spatial coordinate.
 * @typedef {object} SoundPosition
 * @property {number} x - Horizontal X coordinate
 * @property {number} y - Horizontal Y coordinate
 * @property {number} [z] - Vertical Z coordinate
 * @property {number} [h] - Optional height alias
 */

/**
 * Weapon sound playback result descriptor.
 * @typedef {object} WeaponSoundResult
 * @property {string} id - Unique voice or weapon sound identifier
 * @property {boolean} played - True if audio nodes were successfully synthesized
 * @property {number} [duration] - Estimated sound duration in seconds
 * @property {string} [reason] - Reason if playback was skipped
 */

/**
 * Core procedural audio engine managing AudioContext lifecycle, master buses,
 * precomputed noise buffers, distortion wave shapers, and listener spatial state.
 */
const _WeaponAudioCore = typeof ProceduralAudioCore !== 'undefined' ? ProceduralAudioCore : class ProceduralAudioCore {
    /**
     * @param {object} [options]
     * @param {AudioContext|null} [options.audioCtx] - Existing AudioContext to adopt
     * @param {number} [options.masterVolume=0.8] - Master output gain (0..1)
     * @param {number} [options.sfxVolume=0.9] - SFX sub-bus gain (0..1)
     */
    constructor(options = {}) {
        /** @type {AudioContext|null} */
        this.ctx = null;
        /** @type {GainNode|null} */
        this.masterGain = null;
        /** @type {GainNode|null} */
        this.sfxGain = null;
        /** @type {GainNode|null} */
        this.weaponGain = null;

        /** @type {AudioBuffer|null} */
        this.whiteNoiseBuffer = null;
        /** @type {AudioBuffer|null} */
        this.pinkNoiseBuffer = null;
        /** @type {AudioBuffer|null} */
        this.brownNoiseBuffer = null;

        /** @type {Float32Array|null} */
        this.softClipCurve = null;
        /** @type {Float32Array|null} */
        this.hardClipCurve = null;

        /** @type {SoundPosition} */
        this.listenerPos = { x: 0, y: 0, z: 0 };
        /** @type {number} */
        this.listenerHeading = 0;

        this._initialized = false;
        this._masterVolume = options.masterVolume ?? 0.8;
        this._sfxVolume = options.sfxVolume ?? 0.9;

        if (options.audioCtx) {
            this.init(options.audioCtx);
        }
    }

    /**
     * Check if Web Audio API is available in the current environment.
     * @returns {boolean}
     */
    static isSupported() {
        if (typeof window === 'undefined') return false;
        return typeof window.AudioContext !== 'undefined' || typeof window['webkitAudioContext'] !== 'undefined';
    }

    /**
     * Initialize or attach the Web Audio context and build buses and buffers.
     * Safe to call multiple times or without user gesture.
     * @param {AudioContext} [providedCtx]
     * @returns {boolean} True if initialized successfully
     */
    init(providedCtx) {
        if (this._initialized && this.ctx) return true;

        const AudioCtxClass = providedCtx ? null : (typeof window !== 'undefined' ? (window.AudioContext || window['webkitAudioContext']) : null);
        if (!providedCtx && !AudioCtxClass) {
            return false;
        }

        try {
            this.ctx = providedCtx || new AudioCtxClass();
            if (!this.ctx) return false;

            // Master Bus -> SFX Bus -> Weapon Bus
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this._masterVolume;
            this.masterGain.connect(this.ctx.destination);

            this.sfxGain = this.ctx.createGain();
            this.sfxGain.gain.value = this._sfxVolume;
            this.sfxGain.connect(this.masterGain);

            this.weaponGain = this.ctx.createGain();
            this.weaponGain.gain.value = 1.0;
            this.weaponGain.connect(this.sfxGain);

            this._generateNoiseBuffers();
            this._generateDistortionCurves();

            this._initialized = true;
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * Attempt to resume suspended AudioContext (required by modern browser autoplay policies).
     * @returns {Promise<void>}
     */
    async resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            try {
                await this.ctx.resume();
            } catch (e) {
                // Ignore resume rejection if blocked by browser policy
            }
        }
    }

    /**
     * Update current listener 3D position and heading for spatial calculation.
     * @param {SoundPosition} pos
     * @param {number} [heading=0] - Radians or degrees
     */
    setListenerPosition(pos, heading = 0) {
        if (!pos) return;
        this.listenerPos.x = pos.x ?? 0;
        this.listenerPos.y = pos.y ?? 0;
        this.listenerPos.z = pos.z ?? pos.h ?? 0;
        this.listenerHeading = heading;
    }

    /**
     * Generate reusable precomputed noise buffers: White, Pink, and Brown noise.
     * @private
     */
    _generateNoiseBuffers() {
        if (!this.ctx) return;
        const sampleRate = this.ctx.sampleRate || 44100;
        const duration = 2.0; // 2 seconds loopable buffer
        const length = Math.floor(sampleRate * duration);

        // 1. White Noise
        this.whiteNoiseBuffer = this.ctx.createBuffer(1, length, sampleRate);
        const whiteData = this.whiteNoiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            whiteData[i] = Math.random() * 2 - 1;
        }

        // 2. Pink Noise (Paul Kellet's filtered white noise algorithm)
        this.pinkNoiseBuffer = this.ctx.createBuffer(1, length, sampleRate);
        const pinkData = this.pinkNoiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < length; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            pinkData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
            b6 = white * 0.115926;
        }

        // 3. Brown Noise (Leaky integration of white noise)
        this.brownNoiseBuffer = this.ctx.createBuffer(1, length, sampleRate);
        const brownData = this.brownNoiseBuffer.getChannelData(0);
        let lastBrown = 0;
        for (let i = 0; i < length; i++) {
            const white = Math.random() * 2 - 1;
            lastBrown = (lastBrown + 0.02 * white) / 1.02;
            brownData[i] = lastBrown * 3.5;
        }
    }

    /**
     * Generate WaveShaper distortion transfer curves.
     * @private
     */
    _generateDistortionCurves() {
        const samples = 1024;
        this.softClipCurve = new Float32Array(samples);
        this.hardClipCurve = new Float32Array(samples);

        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            // Soft clipping (tanh approximation)
            this.softClipCurve[i] = Math.tanh(x * 2.2);
            // Saturated hard clip with slight edge rounding
            this.hardClipCurve[i] = Math.max(-1, Math.min(1, x * 3.2));
        }
    }

    /**
     * Compute spatial audio routing (distance attenuation, air-absorption lowpass, stereo pan).
     * @param {SoundPosition|null} [pos] - 3D/2D position
     * @param {boolean} [isPlayer=false] - If true, full direct stereo punch with no attenuation
     * @returns {{gain: number, filterFreq: number, pan: number, inAudibleRange: boolean}}
     */
    calculateSpatialParameters(pos, isPlayer = false) {
        if (isPlayer || !pos) {
            return { gain: 1.0, filterFreq: 20000, pan: 0.0, inAudibleRange: true };
        }

        const sx = pos.x ?? 0;
        const sy = pos.y ?? 0;
        const sz = pos.z ?? pos.h ?? 0;

        const dx = sx - this.listenerPos.x;
        const dy = sy - this.listenerPos.y;
        const dz = sz - this.listenerPos.z;

        const distance = Math.hypot(dx, dy, dz);
        // Gunfire carries across the location. The value comes from Constants.js so a designer
        // can tune it in the editor; the fallback keeps the synth usable standalone.
        const configured = (typeof globalThis !== 'undefined') ? (/** @type {any} */ (globalThis)).GAME_SHOT_AUDIO_RANGE : undefined;
        const maxRange = (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) ? configured : 3500;
        const refDist = 90;

        if (distance > maxRange) {
            return { gain: 0, filterFreq: 500, pan: 0, inAudibleRange: false };
        }

        // Realistic inverse distance attenuation with rolloff
        const rolloff = 1.15;
        const gain = Math.max(0.01, Math.min(1.0, refDist / (refDist + rolloff * Math.max(0, distance - refDist))));

        // Air absorption: high frequencies attenuate faster over distance (18kHz down to 900Hz)
        const filterFreq = Math.max(900, Math.min(18000, 900 + 17100 * Math.exp(-distance / 750)));

        // Stereo panning: calculate horizontal angle relative to listener
        const panRange = 600;
        const rawPan = Math.max(-1, Math.min(1, dx / panRange));

        return {
            gain,
            filterFreq,
            pan: rawPan,
            inAudibleRange: true,
        };
    }
};

/**
 * Procedural synthesizer for ballistic and energy weapons in ArcEngine.
 * Integrates with ProceduralAudioCore for multi-layered sound generation.
 */
class ProceduralWeaponSynth {
    /**
     * @param {ProceduralAudioCore|object} [core] - Procedural audio core or options
     */
    constructor(core = null) {
        if (core && (core instanceof _WeaponAudioCore || (typeof ProceduralAudioCore !== 'undefined' && core instanceof ProceduralAudioCore))) {
            this.core = core;
        } else if (core && typeof core === 'object' && /** @type {any} */ (core).ctx) {
            this.core = /** @type {any} */ (core);
        } else if (typeof window !== 'undefined' && window.ProceduralAudioCore && (window.ProceduralAudioCore instanceof _WeaponAudioCore)) {
            this.core = window.ProceduralAudioCore;
        } else {
            this.core = new _WeaponAudioCore(core || {});
        }

        this._voiceCounter = 0;
    }

    /**
     * Forward the listener to the core that actually owns the spatial maths.
     *
     * This wrapper had no such method, so `ProceduralAudio.updateListener` — which calls it
     * behind a `typeof … === 'function'` guard — silently skipped the weapon synth. The core's
     * listener therefore stayed at the world origin, and every enemy shot was distance-culled.
     *
     * Signature matches every other listener setter in the stack: three numbers in the kit's
     * map order (x = mapX, y = mapY, z = height). A position OBJECT used to be accepted here,
     * which made `listenerPos.x` an object and every computed distance NaN.
     *
     * @param {number} x
     * @param {number} y
     * @param {number} [z=0]
     * @param {number} [heading=0]
     */
    setListenerPosition(x, y, z = 0, heading = 0) {
        if (!this.core || typeof this.core.setListenerPosition !== 'function') return;
        const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
        // Position only. The core expresses facing as a FORWARD VECTOR (its 4th argument is
        // forwardX), and ProceduralAudio already sets that from the caller's forwardX/Y/Z —
        // passing `heading` here would land a scalar in forwardX and skew the orientation.
        this.core.setListenerPosition(num(x), num(y), num(z));
    }

    /**
     * Ensure the underlying audio core is initialized.
     * @returns {boolean}
     */
    ensureInitialized() {
        if (!this.core.ctx) {
            return this.core.init();
        }
        return true;
    }

    /**
     * Create a spatialized voice bus connected to the core's weapon bus.
     * @param {SoundPosition|null} pos
     * @param {boolean} isPlayer
     * @returns {{voiceIn: GainNode, cleanup: () => void}|null}
     */
    createSpatialVoiceBus(pos, isPlayer) {
        if (!this.ensureInitialized() || !this.core.ctx || !this.core.weaponGain) {
            return null;
        }

        const ctx = this.core.ctx;
        const spatial = this.core.calculateSpatialParameters(pos, isPlayer);

        if (!spatial.inAudibleRange) {
            return null;
        }

        // Voice input gain
        const voiceIn = ctx.createGain();
        voiceIn.gain.value = 1.0;

        // Air absorption lowpass filter
        const airFilter = ctx.createBiquadFilter();
        airFilter.type = 'lowpass';
        airFilter.frequency.value = spatial.filterFreq;
        airFilter.Q.value = 0.707;

        // Distance attenuation gain
        const distanceGain = ctx.createGain();
        distanceGain.gain.value = spatial.gain;

        voiceIn.connect(airFilter);
        airFilter.connect(distanceGain);

        // Stereo panning (use StereoPannerNode when supported)
        let lastNode = distanceGain;
        if (typeof ctx.createStereoPanner === 'function') {
            try {
                const panner = ctx.createStereoPanner();
                panner.pan.value = spatial.pan;
                distanceGain.connect(panner);
                lastNode = panner;
            } catch (e) {
                // Fallback directly to distance gain if panner fails
            }
        }

        lastNode.connect(this.core.weaponGain);

        const cleanup = () => {
            try {
                voiceIn.disconnect();
                airFilter.disconnect();
                distanceGain.disconnect();
                if (lastNode !== distanceGain) lastNode.disconnect();
            } catch (e) {
                // Ignore disconnect errors on already disposed nodes
            }
        };

        return { voiceIn, cleanup };
    }

    /**
     * Play Assault Rifle gunfire (Рубеж-76 line, Tempest II/III).
     * Multi-layered synthesis:
     *   a) Mechanical bolt-action metallic click (resonant bandpass 1800-3200Hz)
     *   b) Explosive punch transient: pitch-swept oscillator (160Hz -> 38Hz over 0.08s) through soft-clipping distortion
     *   c) Sub/body punch: lowpass filtered brown noise + 50Hz thump
     *   d) Tail: open-air acoustic report decaying over 0.35-0.6s
     *
     * @param {SoundPosition} [pos] - 3D/2D position for spatial attenuation
     * @param {boolean} [isPlayer=true] - True for 1st-person/local player
     * @param {number|string} [tier=2] - Weapon tier (1..4 or 'I'..'IV')
     * @returns {WeaponSoundResult}
     */
    playAssaultRifle(pos = null, isPlayer = true, tier = 2) {
        const bus = this.createSpatialVoiceBus(pos, isPlayer);
        if (!bus || !this.core.ctx) {
            return { id: `ar_${++this._voiceCounter}`, played: false, reason: 'unavailable' };
        }

        const ctx = this.core.ctx;
        const t = ctx.currentTime;
        const numericTier = this._parseTier(tier);

        // Tier characteristics: higher tiers have tighter punch and wider acoustic reports
        const tierPunchMult = 1.0 + (numericTier - 1) * 0.12;
        const tailDecaySec = 0.38 + Math.min(0.22, (numericTier - 1) * 0.07); // 0.38s - 0.60s
        const totalDuration = tailDecaySec + 0.05;

        // ------------------------------------------------------------------------
        // Layer A: Mechanical Bolt-Action Metallic Click (1800 - 3200 Hz)
        // ------------------------------------------------------------------------
        if (this.core.whiteNoiseBuffer) {
            const boltSource = ctx.createBufferSource();
            boltSource.buffer = this.core.whiteNoiseBuffer;

            const boltFilter = ctx.createBiquadFilter();
            boltFilter.type = 'bandpass';
            // Resonant metallic click frequency tuned per tier
            boltFilter.frequency.setValueAtTime(1800 + numericTier * 320, t);
            boltFilter.Q.setValueAtTime(8.5, t);

            const boltGain = ctx.createGain();
            boltGain.gain.setValueAtTime(0.42 * tierPunchMult, t);
            boltGain.gain.exponentialRampToValueAtTime(0.001, t + 0.028);

            boltSource.connect(boltFilter);
            boltFilter.connect(boltGain);
            boltGain.connect(bus.voiceIn);

            boltSource.start(t);
            boltSource.stop(t + 0.035);

            // Secondary bolt chamber lock click at +15ms
            const lockSource = ctx.createBufferSource();
            lockSource.buffer = this.core.whiteNoiseBuffer;

            const lockFilter = ctx.createBiquadFilter();
            lockFilter.type = 'bandpass';
            lockFilter.frequency.setValueAtTime(2900, t + 0.015);
            lockFilter.Q.setValueAtTime(10.0, t + 0.015);

            const lockGain = ctx.createGain();
            lockGain.gain.setValueAtTime(0.0001, t);
            lockGain.gain.setValueAtTime(0.28, t + 0.015);
            lockGain.gain.exponentialRampToValueAtTime(0.001, t + 0.038);

            lockSource.connect(lockFilter);
            lockFilter.connect(lockGain);
            lockGain.connect(bus.voiceIn);

            lockSource.start(t + 0.015);
            lockSource.stop(t + 0.045);
        }

        // ------------------------------------------------------------------------
        // Layer B: Explosive Punch Transient (160Hz -> 38Hz over 0.08s) through soft-clipping
        // ------------------------------------------------------------------------
        const punchOsc = ctx.createOscillator();
        punchOsc.type = 'triangle';
        punchOsc.frequency.setValueAtTime(160, t);
        punchOsc.frequency.exponentialRampToValueAtTime(38, t + 0.08);

        const punchDistortion = ctx.createWaveShaper();
        if (this.core.softClipCurve) {
            punchDistortion.curve = this.core.softClipCurve;
        }

        const punchGain = ctx.createGain();
        punchGain.gain.setValueAtTime(0.75 * tierPunchMult, t);
        punchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);

        punchOsc.connect(punchDistortion);
        punchDistortion.connect(punchGain);
        punchGain.connect(bus.voiceIn);

        punchOsc.start(t);
        punchOsc.stop(t + 0.09);

        // ------------------------------------------------------------------------
        // Layer C: Sub/Body Punch (Lowpass filtered brown noise + 50Hz thump)
        // ------------------------------------------------------------------------
        if (this.core.brownNoiseBuffer) {
            const brownSource = ctx.createBufferSource();
            brownSource.buffer = this.core.brownNoiseBuffer;

            const brownFilter = ctx.createBiquadFilter();
            brownFilter.type = 'lowpass';
            brownFilter.frequency.setValueAtTime(155, t);
            brownFilter.Q.setValueAtTime(1.2, t);

            const brownGain = ctx.createGain();
            brownGain.gain.setValueAtTime(0.65 * tierPunchMult, t);
            brownGain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

            brownSource.connect(brownFilter);
            brownFilter.connect(brownGain);
            brownGain.connect(bus.voiceIn);

            brownSource.start(t);
            brownSource.stop(t + 0.12);
        }

        // 50Hz sub thump
        const thumpOsc = ctx.createOscillator();
        thumpOsc.type = 'sine';
        thumpOsc.frequency.setValueAtTime(58, t);
        thumpOsc.frequency.exponentialRampToValueAtTime(45, t + 0.09);

        const thumpGain = ctx.createGain();
        thumpGain.gain.setValueAtTime(0.8 * tierPunchMult, t);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.095);

        thumpOsc.connect(thumpGain);
        thumpGain.connect(bus.voiceIn);

        thumpOsc.start(t);
        thumpOsc.stop(t + 0.10);

        // ------------------------------------------------------------------------
        // Layer D: Tail (Open-air acoustic report decaying over 0.35-0.6s)
        // ------------------------------------------------------------------------
        if (this.core.pinkNoiseBuffer) {
            const tailSource = ctx.createBufferSource();
            tailSource.buffer = this.core.pinkNoiseBuffer;

            const tailFilter = ctx.createBiquadFilter();
            tailFilter.type = 'lowpass';
            tailFilter.frequency.setValueAtTime(1100, t);
            tailFilter.frequency.exponentialRampToValueAtTime(260, t + tailDecaySec);

            const tailGain = ctx.createGain();
            tailGain.gain.setValueAtTime(0.38, t);
            tailGain.gain.exponentialRampToValueAtTime(0.001, t + tailDecaySec);

            tailSource.connect(tailFilter);
            tailFilter.connect(tailGain);
            tailGain.connect(bus.voiceIn);

            tailSource.start(t);
            tailSource.stop(t + tailDecaySec + 0.02);
        }

        // Tier IV ARC Hybrid bonus: High-frequency accelerator coil sizzle
        if (numericTier >= 4) {
            this._synthesizeEnergySizzle(ctx, bus.voiceIn, t, 0.14, 1400, 190);
        }

        setTimeout(bus.cleanup, totalDuration * 1000 + 50);
        return { id: `ar_${++this._voiceCounter}`, played: true, duration: totalDuration };
    }

    /**
     * Play Vulcano shotgun fire.
     * Layers:
     *   - Heavy explosive punch
     *   - Multi-pellet spread crackle (granular noise burst)
     *   - Sub-bass thump
     *   - Mechanical pump rack sound
     *
     * @param {SoundPosition} [pos] - 3D/2D position
     * @param {boolean} [isPlayer=true] - True for player
     * @returns {WeaponSoundResult}
     */
    playShotgun(pos = null, isPlayer = true) {
        const bus = this.createSpatialVoiceBus(pos, isPlayer);
        if (!bus || !this.core.ctx) {
            return { id: `sg_${++this._voiceCounter}`, played: false, reason: 'unavailable' };
        }

        const ctx = this.core.ctx;
        const t = ctx.currentTime;
        const totalDuration = 0.55;

        // 1. Heavy Explosive Punch (220Hz -> 32Hz pitch drop + saturated distortion)
        const punchOsc = ctx.createOscillator();
        punchOsc.type = 'triangle';
        punchOsc.frequency.setValueAtTime(220, t);
        punchOsc.frequency.exponentialRampToValueAtTime(32, t + 0.11);

        const punchDist = ctx.createWaveShaper();
        if (this.core.hardClipCurve) punchDist.curve = this.core.hardClipCurve;

        const punchGain = ctx.createGain();
        punchGain.gain.setValueAtTime(0.95, t);
        punchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        punchOsc.connect(punchDist);
        punchDist.connect(punchGain);
        punchGain.connect(bus.voiceIn);

        punchOsc.start(t);
        punchOsc.stop(t + 0.13);

        // 2. Multi-Pellet Spread Crackle (Granular noise burst across 0.03-0.08s)
        if (this.core.whiteNoiseBuffer) {
            const crackleSource = ctx.createBufferSource();
            crackleSource.buffer = this.core.whiteNoiseBuffer;

            const crackleFilter = ctx.createBiquadFilter();
            crackleFilter.type = 'bandpass';
            crackleFilter.frequency.setValueAtTime(3600, t);
            crackleFilter.Q.setValueAtTime(3.8, t);

            // Modulate crackle gain rapidly with an LFO to simulate clustered pellet impacts/shear
            const crackleMod = ctx.createOscillator();
            crackleMod.type = 'square';
            crackleMod.frequency.setValueAtTime(75, t); // 75Hz granular pulsation

            const crackleModGain = ctx.createGain();
            crackleModGain.gain.setValueAtTime(0.35, t);

            const crackleGain = ctx.createGain();
            crackleGain.gain.setValueAtTime(0.55, t);
            crackleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.095);

            crackleSource.connect(crackleFilter);
            crackleFilter.connect(crackleGain);
            crackleGain.connect(bus.voiceIn);

            crackleSource.start(t);
            crackleSource.stop(t + 0.10);
            crackleMod.start(t);
            crackleMod.stop(t + 0.10);
        }

        // 3. Sub-Bass Thump (42Hz deep boom + lowpass brown noise)
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(54, t);
        subOsc.frequency.exponentialRampToValueAtTime(36, t + 0.16);

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.9, t);
        subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

        subOsc.connect(subGain);
        subGain.connect(bus.voiceIn);

        subOsc.start(t);
        subOsc.stop(t + 0.19);

        // 4. Mechanical Pump Rack Sound (Delayed at +0.20s: slide back then chamber forward)
        if (this.core.whiteNoiseBuffer) {
            // Stage 1: Slide back (+0.20s)
            const rackBackSource = ctx.createBufferSource();
            rackBackSource.buffer = this.core.whiteNoiseBuffer;

            const rackBackFilter = ctx.createBiquadFilter();
            rackBackFilter.type = 'bandpass';
            rackBackFilter.frequency.setValueAtTime(1600, t + 0.20);
            rackBackFilter.Q.setValueAtTime(6.0, t + 0.20);

            const rackBackGain = ctx.createGain();
            rackBackGain.gain.setValueAtTime(0.0001, t);
            rackBackGain.gain.setValueAtTime(0.28, t + 0.20);
            rackBackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);

            rackBackSource.connect(rackBackFilter);
            rackBackFilter.connect(rackBackGain);
            rackBackGain.connect(bus.voiceIn);

            rackBackSource.start(t + 0.20);
            rackBackSource.stop(t + 0.27);

            // Stage 2: Chamber forward (+0.28s)
            const rackFwdSource = ctx.createBufferSource();
            rackFwdSource.buffer = this.core.whiteNoiseBuffer;

            const rackFwdFilter = ctx.createBiquadFilter();
            rackFwdFilter.type = 'bandpass';
            rackFwdFilter.frequency.setValueAtTime(3100, t + 0.28);
            rackFwdFilter.Q.setValueAtTime(9.5, t + 0.28);

            const rackFwdGain = ctx.createGain();
            rackFwdGain.gain.setValueAtTime(0.0001, t);
            rackFwdGain.gain.setValueAtTime(0.32, t + 0.28);
            rackFwdGain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);

            rackFwdSource.connect(rackFwdFilter);
            rackFwdFilter.connect(rackFwdGain);
            rackFwdGain.connect(bus.voiceIn);

            rackFwdSource.start(t + 0.28);
            rackFwdSource.stop(t + 0.35);
        }

        setTimeout(bus.cleanup, totalDuration * 1000 + 50);
        return { id: `sg_${++this._voiceCounter}`, played: true, duration: totalDuration };
    }

    /**
     * Play Revolver I / II gunfire.
     * Layers:
     *   - Sharp high-pressure acoustic snap
     *   - Metallic hammer drop
     *   - Dry punch
     *   - Brass ring
     *
     * @param {SoundPosition} [pos] - 3D/2D position
     * @param {boolean} [isPlayer=true] - True for player
     * @returns {WeaponSoundResult}
     */
    playRevolver(pos = null, isPlayer = true) {
        const bus = this.createSpatialVoiceBus(pos, isPlayer);
        if (!bus || !this.core.ctx) {
            return { id: `rev_${++this._voiceCounter}`, played: false, reason: 'unavailable' };
        }

        const ctx = this.core.ctx;
        const t = ctx.currentTime;
        const totalDuration = 0.45;

        // 1. Sharp High-Pressure Acoustic Snap (Highpass filtered noise crack at 2400Hz)
        if (this.core.whiteNoiseBuffer) {
            const snapSource = ctx.createBufferSource();
            snapSource.buffer = this.core.whiteNoiseBuffer;

            const snapFilter = ctx.createBiquadFilter();
            snapFilter.type = 'highpass';
            snapFilter.frequency.setValueAtTime(2400, t);
            snapFilter.Q.setValueAtTime(3.0, t);

            const snapGain = ctx.createGain();
            snapGain.gain.setValueAtTime(0.85, t);
            snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.028);

            snapSource.connect(snapFilter);
            snapFilter.connect(snapGain);
            snapGain.connect(bus.voiceIn);

            snapSource.start(t);
            snapSource.stop(t + 0.035);
        }

        // 2. Metallic Hammer Drop (Sharp mechanical ping at 3600Hz)
        const hammerOsc = ctx.createOscillator();
        hammerOsc.type = 'sine';
        hammerOsc.frequency.setValueAtTime(3600, t);

        const hammerGain = ctx.createGain();
        hammerGain.gain.setValueAtTime(0.40, t);
        hammerGain.gain.exponentialRampToValueAtTime(0.001, t + 0.016);

        hammerOsc.connect(hammerGain);
        hammerGain.connect(bus.voiceIn);

        hammerOsc.start(t);
        hammerOsc.stop(t + 0.02);

        // 3. Dry Punch (Pitch sweep: 180Hz -> 48Hz over 0.045s, tightly damped)
        const dryOsc = ctx.createOscillator();
        dryOsc.type = 'triangle';
        dryOsc.frequency.setValueAtTime(180, t);
        dryOsc.frequency.exponentialRampToValueAtTime(48, t + 0.045);

        const dryDist = ctx.createWaveShaper();
        if (this.core.softClipCurve) dryDist.curve = this.core.softClipCurve;

        const dryGain = ctx.createGain();
        dryGain.gain.setValueAtTime(0.8, t);
        dryGain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);

        dryOsc.connect(dryDist);
        dryDist.connect(dryGain);
        dryGain.connect(bus.voiceIn);

        dryOsc.start(t);
        dryOsc.stop(t + 0.06);

        // 4. Brass Ring (Resonant metallic cylinder vibration at 1880Hz, Q=22, decaying over 0.38s)
        const ringOsc = ctx.createOscillator();
        ringOsc.type = 'sine';
        ringOsc.frequency.setValueAtTime(1880, t);

        const ringGain = ctx.createGain();
        ringGain.gain.setValueAtTime(0.24, t);
        ringGain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

        ringOsc.connect(ringGain);
        ringGain.connect(bus.voiceIn);

        ringOsc.start(t);
        ringOsc.stop(t + 0.40);

        setTimeout(bus.cleanup, totalDuration * 1000 + 50);
        return { id: `rev_${++this._voiceCounter}`, played: true, duration: totalDuration };
    }

    /**
     * Play Rattler SMG gunfire.
     * Layers:
     *   - High-rate kinetic snap
     *   - Short punch
     *   - Crisp mechanical cycle
     *
     * @param {SoundPosition} [pos] - 3D/2D position
     * @param {boolean} [isPlayer=true] - True for player
     * @returns {WeaponSoundResult}
     */
    playSMG(pos = null, isPlayer = true) {
        const bus = this.createSpatialVoiceBus(pos, isPlayer);
        if (!bus || !this.core.ctx) {
            return { id: `smg_${++this._voiceCounter}`, played: false, reason: 'unavailable' };
        }

        const ctx = this.core.ctx;
        const t = ctx.currentTime;
        const totalDuration = 0.22;

        // 1. High-Rate Kinetic Snap (Highpass filtered at 2900Hz, very fast decay)
        if (this.core.whiteNoiseBuffer) {
            const snapSource = ctx.createBufferSource();
            snapSource.buffer = this.core.whiteNoiseBuffer;

            const snapFilter = ctx.createBiquadFilter();
            snapFilter.type = 'highpass';
            snapFilter.frequency.setValueAtTime(2900, t);
            snapFilter.Q.setValueAtTime(2.5, t);

            const snapGain = ctx.createGain();
            snapGain.gain.setValueAtTime(0.65, t);
            snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.020);

            snapSource.connect(snapFilter);
            snapFilter.connect(snapGain);
            snapGain.connect(bus.voiceIn);

            snapSource.start(t);
            snapSource.stop(t + 0.025);
        }

        // 2. Short Punch (140Hz -> 45Hz over 0.035s, fast release to prevent muddy mix at 660+ RPM)
        const punchOsc = ctx.createOscillator();
        punchOsc.type = 'triangle';
        punchOsc.frequency.setValueAtTime(140, t);
        punchOsc.frequency.exponentialRampToValueAtTime(45, t + 0.035);

        const punchGain = ctx.createGain();
        punchGain.gain.setValueAtTime(0.60, t);
        punchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.042);

        punchOsc.connect(punchGain);
        punchGain.connect(bus.voiceIn);

        punchOsc.start(t);
        punchOsc.stop(t + 0.048);

        // 3. Crisp Mechanical Cycle (Bolt reciprocating cycle: primary click + return click at +22ms)
        if (this.core.whiteNoiseBuffer) {
            const bolt1 = ctx.createBufferSource();
            bolt1.buffer = this.core.whiteNoiseBuffer;

            const bolt1Filter = ctx.createBiquadFilter();
            bolt1Filter.type = 'bandpass';
            bolt1Filter.frequency.setValueAtTime(2300, t);
            bolt1Filter.Q.setValueAtTime(7.0, t);

            const bolt1Gain = ctx.createGain();
            bolt1Gain.gain.setValueAtTime(0.35, t);
            bolt1Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.018);

            bolt1.connect(bolt1Filter);
            bolt1Filter.connect(bolt1Gain);
            bolt1Gain.connect(bus.voiceIn);

            bolt1.start(t);
            bolt1.stop(t + 0.022);

            // Cycle return click (+22ms)
            const bolt2 = ctx.createBufferSource();
            bolt2.buffer = this.core.whiteNoiseBuffer;

            const bolt2Filter = ctx.createBiquadFilter();
            bolt2Filter.type = 'bandpass';
            bolt2Filter.frequency.setValueAtTime(2700, t + 0.022);
            bolt2Filter.Q.setValueAtTime(8.5, t + 0.022);

            const bolt2Gain = ctx.createGain();
            bolt2Gain.gain.setValueAtTime(0.0001, t);
            bolt2Gain.gain.setValueAtTime(0.25, t + 0.022);
            bolt2Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.040);

            bolt2.connect(bolt2Filter);
            bolt2Filter.connect(bolt2Gain);
            bolt2Gain.connect(bus.voiceIn);

            bolt2.start(t + 0.022);
            bolt2.stop(t + 0.045);
        }

        setTimeout(bus.cleanup, totalDuration * 1000 + 50);
        return { id: `smg_${++this._voiceCounter}`, played: true, duration: totalDuration };
    }

    /**
     * Play ARC plasma energy weapons.
     * Layers:
     *   - FM synthesis frequency-modulated sizzle
     *   - Electromagnetic discharge chirp
     *   - Sub-drop
     *
     * @param {SoundPosition} [pos] - 3D/2D position
     * @param {boolean} [isPlayer=true] - True for player
     * @returns {WeaponSoundResult}
     */
    playPlasma(pos = null, isPlayer = true) {
        const bus = this.createSpatialVoiceBus(pos, isPlayer);
        if (!bus || !this.core.ctx) {
            return { id: `pls_${++this._voiceCounter}`, played: false, reason: 'unavailable' };
        }

        const ctx = this.core.ctx;
        const t = ctx.currentTime;
        const totalDuration = 0.38;

        // 1. FM Synthesis Frequency-Modulated Sizzle (Carrier: 680Hz, Modulator: 220Hz, decaying index)
        const carrier = ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(680, t);

        const modulator = ctx.createOscillator();
        modulator.type = 'sawtooth';
        modulator.frequency.setValueAtTime(220, t);

        const modGain = ctx.createGain();
        modGain.gain.setValueAtTime(1100, t); // High modulation index at start
        modGain.gain.exponentialRampToValueAtTime(1.0, t + 0.22); // Sizzle decays

        modulator.connect(modGain);
        modGain.connect(carrier.frequency);

        const carrierGain = ctx.createGain();
        carrierGain.gain.setValueAtTime(0.55, t);
        carrierGain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

        carrier.connect(carrierGain);
        carrierGain.connect(bus.voiceIn);

        modulator.start(t);
        carrier.start(t);
        modulator.stop(t + 0.25);
        carrier.stop(t + 0.25);

        // 2. Electromagnetic Discharge Chirp (Pitch sweep 2800Hz -> 280Hz over 0.09s)
        const chirpOsc = ctx.createOscillator();
        chirpOsc.type = 'sawtooth';
        chirpOsc.frequency.setValueAtTime(2800, t);
        chirpOsc.frequency.exponentialRampToValueAtTime(280, t + 0.09);

        const chirpFilter = ctx.createBiquadFilter();
        chirpFilter.type = 'bandpass';
        chirpFilter.frequency.setValueAtTime(1600, t);
        chirpFilter.Q.setValueAtTime(2.2, t);

        const chirpGain = ctx.createGain();
        chirpGain.gain.setValueAtTime(0.48, t);
        chirpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.095);

        chirpOsc.connect(chirpFilter);
        chirpFilter.connect(chirpGain);
        chirpGain.connect(bus.voiceIn);

        chirpOsc.start(t);
        chirpOsc.stop(t + 0.10);

        // 3. Sub-Drop (Resonant bass drop 95Hz -> 24Hz over 0.28s)
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(95, t);
        subOsc.frequency.exponentialRampToValueAtTime(24, t + 0.28);

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.75, t);
        subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.30);

        subOsc.connect(subGain);
        subGain.connect(bus.voiceIn);

        subOsc.start(t);
        subOsc.stop(t + 0.31);

        setTimeout(bus.cleanup, totalDuration * 1000 + 50);
        return { id: `pls_${++this._voiceCounter}`, played: true, duration: totalDuration };
    }

    /**
     * Synthesize high-frequency energy sizzle for hybrid weapons.
     * @private
     */
    _synthesizeEnergySizzle(ctx, destination, t, duration, carrierFreq, modFreq) {
        const car = ctx.createOscillator();
        car.type = 'sine';
        car.frequency.setValueAtTime(carrierFreq, t);

        const mod = ctx.createOscillator();
        mod.type = 'triangle';
        mod.frequency.setValueAtTime(modFreq, t);

        const modIndex = ctx.createGain();
        modIndex.gain.setValueAtTime(800, t);
        modIndex.gain.exponentialRampToValueAtTime(1.0, t + duration);

        mod.connect(modIndex);
        modIndex.connect(car.frequency);

        const sizzleGain = ctx.createGain();
        sizzleGain.gain.setValueAtTime(0.35, t);
        sizzleGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        car.connect(sizzleGain);
        sizzleGain.connect(destination);

        mod.start(t);
        car.start(t);
        mod.stop(t + duration + 0.01);
        car.stop(t + duration + 0.01);
    }

    /**
     * Parse weapon tier input into numeric value 1..4.
     * @param {number|string} tier
     * @returns {number}
     * @private
     */
    _parseTier(tier) {
        if (typeof tier === 'number' && Number.isFinite(tier)) {
            return Math.max(1, Math.min(4, Math.floor(tier)));
        }
        if (typeof tier === 'string') {
            const s = tier.trim().toUpperCase();
            if (s === 'I' || s === 'T1') return 1;
            if (s === 'II' || s === 'T2') return 2;
            if (s === 'III' || s === 'T3') return 3;
            if (s === 'IV' || s === 'T4') return 4;
            const n = parseInt(s, 10);
            if (!isNaN(n)) return Math.max(1, Math.min(4, n));
        }
        return 2;
    }
}

// ----------------------------------------------------------------------------
// Environment exports: Browser window & Node.js test environment
// ----------------------------------------------------------------------------
if (typeof window !== 'undefined') {
    if (!window.ProceduralAudioCore) window.ProceduralAudioCore = _WeaponAudioCore;
    window.ProceduralWeaponSynth = ProceduralWeaponSynth;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ProceduralAudioCore: _WeaponAudioCore,
        ProceduralWeaponSynth,
    };
}
