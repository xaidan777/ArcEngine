// ProceduralCombatSynth - Procedural tactical combat audio synthesizer using Web Audio API.
// Generates weapon handling, projectile ballistics, surface impacts, and tactical shield audio.
// Zero external audio assets; pure procedural Web Audio API synthesis.

/**
 * @typedef {object} Position3D
 * @property {number} x
 * @property {number} y
 * @property {number} [z]
 */

/**
 * @typedef {object} CombatSynthOptions
 * @property {number} [masterVolume=1.0] Master volume (0.0 to 2.0).
 * @property {Position3D} [listenerPos] Listener position for spatial audio.
 */

/**
 * @typedef {object} SpatialNodeResult
 * @property {AudioNode} input Destination node to connect audio sources to.
 * @property {GainNode | null} gain Distance attenuation gain node.
 * @property {StereoPannerNode | null} panner Stereo panner node.
 */

/**
 * Procedural Web Audio API synthesizer for tactical combat sound effects.
 */
class ProceduralCombatSynth {
    /** @type {ProceduralCombatSynth | null} */
    static _shared = null;

    /**
     * Shared singleton instance for convenient global access.
     * @returns {ProceduralCombatSynth}
     */
    static get shared() {
        if (!ProceduralCombatSynth._shared) {
            ProceduralCombatSynth._shared = new ProceduralCombatSynth();
        }
        return ProceduralCombatSynth._shared;
    }

    /**
     * @param {AudioContext | null} [audioCtx=null] Web Audio context. If null, tries window.AudioContext.
     * @param {CombatSynthOptions} [options={}] Synthesizer configuration options.
     */
    constructor(audioCtx = null, options = {}) {
        /** @type {AudioContext | null} */
        this.ctx = audioCtx;
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

        /** @type {number} */
        this.masterVolume = typeof options.masterVolume === 'number' ? options.masterVolume : 1.0;

        /** @type {Position3D} */
        this.listenerPos = options.listenerPos || { x: 0, y: 0, z: 0 };

        /** @type {GainNode | null} */
        this.masterGain = null;
        if (this.ctx) {
            try {
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.value = this.masterVolume;
                this.masterGain.connect(this.ctx.destination);
            } catch (e) {
                this.masterGain = null;
            }
        }

        /** @type {AudioBuffer | null} */
        this._cachedNoiseBuffer = null;

        /** @type {{ oscs: (OscillatorNode | AudioNode)[], gains: GainNode[], filter: BiquadFilterNode, master: GainNode, stop: () => void } | null} */
        this._rechargeState = null;
    }

    /**
     * Set the master output volume.
     * @param {number} volume Volume factor (0.0 to 2.0).
     */
    setMasterVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(2.0, volume));
        if (this.masterGain && this.ctx) {
            try {
                this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
            } catch (e) {
                this.masterGain.gain.value = this.masterVolume;
            }
        }
    }

    /**
     * Update the listener position for 2D/3D spatial audio calculations.
     * @param {number} x map X
     * @param {number} y map Y
     * @param {number} [z=0] height
     */
    setListenerPosition(x, y, z = 0) {
        const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
        this.listenerPos = { x: num(x), y: num(y), z: num(z) };
    }

    /**
     * Returns the active listener position, falling back to window.app.game.player if present.
     * @returns {Position3D}
     */
    getListenerPos() {
        if (this.listenerPos && (this.listenerPos.x !== 0 || this.listenerPos.y !== 0 || (this.listenerPos.z && this.listenerPos.z !== 0))) {
            return this.listenerPos;
        }
        if (typeof window !== 'undefined') {
            const app = window['app'];
            if (app && app.game && app.game.player) {
                return { x: app.game.player.x || 0, y: app.game.player.y || 0, z: 0 };
            }
        }
        return this.listenerPos || { x: 0, y: 0, z: 0 };
    }

    /**
     * Resume audio context if suspended.
     * @private
     * @returns {boolean} True if context is valid and active.
     */
    _ensureContext() {
        if (!this.ctx) return false;
        try {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
        } catch (e) {}
        return true;
    }

    /**
     * Extract normalized coordinates from various position formats.
     * @private
     * @param {any} pos
     * @returns {Position3D | null}
     */
    /**
     * Normalise an emitter position to the kit's map order: { x = mapX, y = mapY, z = height }.
     *
     * The impact/ricochet/whiz points the game passes carry the height in `h`
     * (`{ x, y, h }` — see Game.impactTerrain), which this used to drop on the floor while
     * reading a `z` that was never there. `h` is therefore resolved as the height.
     * @private
     * @param {any} pos
     * @returns {{x: number, y: number, z: number}|null}
     */
    _parsePos(pos) {
        if (!pos) return null;
        if (Array.isArray(pos)) {
            return { x: Number(pos[0]) || 0, y: Number(pos[1]) || 0, z: Number(pos[2]) || 0 };
        }
        if (typeof pos === 'object') {
            const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
            const height = (typeof pos.h === 'number' && Number.isFinite(pos.h))
                ? pos.h
                : ((typeof pos.z === 'number' && Number.isFinite(pos.z)) ? pos.z : 0);
            return { x: num(pos.x), y: num(pos.y), z: height };
        }
        return null;
    }

    /**
     * Read an audible-range tuning value from Constants.js, with a fallback for the cases
     * where the synth is loaded without the game's constants (tests, standalone use).
     * @private
     * @param {string} name
     * @param {number} fallback
     * @returns {number}
     */
    _range(name, fallback) {
        const value = (typeof globalThis !== 'undefined') ? (/** @type {any} */ (globalThis))[name] : undefined;
        return (typeof value === 'number' && Number.isFinite(value) && value > 0) ? value : fallback;
    }

    /**
     * Create a spatial audio sub-graph providing distance attenuation and stereo panning.
     * @private
     * @param {any} pos Sound emitter position.
     * @param {number} [maxDist=1200] Maximum audible distance.
     * @returns {SpatialNodeResult | null}
     */
    _createSpatialNode(pos, maxDist = 1200) {
        if (!this.ctx) return null;
        const target = this._parsePos(pos);
        const destination = this.masterGain || this.ctx.destination;
        if (!target) {
            return { input: destination, gain: null, panner: null };
        }

        const listener = this.getListenerPos();
        const dx = target.x - listener.x;
        const dy = target.y - listener.y;
        const dist = Math.hypot(dx, dy);

        // Quadratic taper kept exactly as it was: near impacts (0-300 px) read loud and punchy, which
        // is the behaviour players already liked. The only defect was the RANGE — a hardcoded
        // 1000 px ceiling reached literal silence while weapons reach 1600 px — so the curve is
        // untouched and the ceiling now comes from Constants.js.
        const factor = Math.max(0, Math.min(1, 1 - dist / maxDist));
        const vol = factor * factor;

        let gainNode = null;
        try {
            gainNode = this.ctx.createGain();
            gainNode.gain.value = vol;
        } catch (e) {
            return { input: destination, gain: null, panner: null };
        }

        let pannerNode = null;
        if (typeof this.ctx.createStereoPanner === 'function') {
            try {
                pannerNode = this.ctx.createStereoPanner();
                const pan = Math.max(-1, Math.min(1, dx / Math.max(100, Math.min(600, dist))));
                pannerNode.pan.value = isNaN(pan) ? 0 : pan;
                gainNode.connect(pannerNode);
                pannerNode.connect(destination);
                return { input: gainNode, gain: gainNode, panner: pannerNode };
            } catch (e) {
                gainNode.connect(destination);
                return { input: gainNode, gain: gainNode, panner: null };
            }
        }

        gainNode.connect(destination);
        return { input: gainNode, gain: gainNode, panner: null };
    }

    /**
     * Lazily get or generate a 2-second white noise buffer.
     * @private
     * @returns {AudioBuffer | null}
     */
    _getNoiseBuffer() {
        if (!this.ctx) return null;
        if (this._cachedNoiseBuffer && this._cachedNoiseBuffer.sampleRate === this.ctx.sampleRate) {
            return this._cachedNoiseBuffer;
        }
        try {
            const sampleRate = this.ctx.sampleRate || 44100;
            const bufferSize = sampleRate * 2;
            const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            this._cachedNoiseBuffer = buffer;
            return buffer;
        } catch (e) {
            return null;
        }
    }

    /**
     * Create an AudioBufferSourceNode filled with white noise.
     * @private
     * @param {boolean} [loop=false]
     * @returns {AudioBufferSourceNode | null}
     */
    _createNoiseSource(loop = false) {
        if (!this.ctx) return null;
        const buffer = this._getNoiseBuffer();
        if (!buffer) return null;
        try {
            const src = this.ctx.createBufferSource();
            src.buffer = buffer;
            src.loop = loop;
            return src;
        } catch (e) {
            return null;
        }
    }

    // =========================================================================
    // 1. Weapon Handling Sounds
    // =========================================================================

    /**
     * Play tactile click and friction slide for magazine removal.
     * Part of the weapon reload sequence.
     */
    playMagOut() {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        const out = this.masterGain || ctx.destination;
        const t = ctx.currentTime;

        // Phase 1: Latch release click
        const clickNoise = this._createNoiseSource();
        if (clickNoise) {
            const hpFilter = ctx.createBiquadFilter();
            hpFilter.type = 'highpass';
            hpFilter.frequency.setValueAtTime(2200, t);

            const clickGain = ctx.createGain();
            clickGain.gain.setValueAtTime(0.55, t);
            clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

            clickNoise.connect(hpFilter);
            hpFilter.connect(clickGain);
            clickGain.connect(out);

            clickNoise.start(t);
            clickNoise.stop(t + 0.03);
        }

        const clickOsc = ctx.createOscillator();
        clickOsc.type = 'triangle';
        clickOsc.frequency.setValueAtTime(1850, t);
        clickOsc.frequency.exponentialRampToValueAtTime(360, t + 0.025);

        const clickOscGain = ctx.createGain();
        clickOscGain.gain.setValueAtTime(0.6, t);
        clickOscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

        clickOsc.connect(clickOscGain);
        clickOscGain.connect(out);
        clickOsc.start(t);
        clickOsc.stop(t + 0.03);

        // Phase 2: Friction slide (mag sliding out of the well)
        const slideNoise = this._createNoiseSource();
        if (slideNoise) {
            const bpFilter = ctx.createBiquadFilter();
            bpFilter.type = 'bandpass';
            bpFilter.Q.setValueAtTime(3.5, t);
            bpFilter.frequency.setValueAtTime(1350, t + 0.015);
            bpFilter.frequency.exponentialRampToValueAtTime(580, t + 0.17);

            const slideGain = ctx.createGain();
            slideGain.gain.setValueAtTime(0.001, t);
            slideGain.gain.linearRampToValueAtTime(0.38, t + 0.04);
            slideGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

            slideNoise.connect(bpFilter);
            bpFilter.connect(slideGain);
            slideGain.connect(out);

            slideNoise.start(t + 0.015);
            slideNoise.stop(t + 0.19);
        }

        // Tactile low thump for hand pull
        const thudOsc = ctx.createOscillator();
        thudOsc.type = 'sine';
        thudOsc.frequency.setValueAtTime(190, t);
        thudOsc.frequency.exponentialRampToValueAtTime(70, t + 0.04);

        const thudGain = ctx.createGain();
        thudGain.gain.setValueAtTime(0.28, t);
        thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

        thudOsc.connect(thudGain);
        thudGain.connect(out);
        thudOsc.start(t);
        thudOsc.stop(t + 0.05);

        return true;
    }

    /**
     * Play heavy metallic insertion snap with spring click for magazine insertion.
     * Part of the weapon reload sequence.
     */
    playMagIn() {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        const out = this.masterGain || ctx.destination;
        const t = ctx.currentTime;

        // Phase 1: Heavy metallic insertion snap
        const thumpOsc = ctx.createOscillator();
        thumpOsc.type = 'sine';
        thumpOsc.frequency.setValueAtTime(340, t);
        thumpOsc.frequency.exponentialRampToValueAtTime(65, t + 0.055);

        const thumpGain = ctx.createGain();
        thumpGain.gain.setValueAtTime(0.85, t);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

        thumpOsc.connect(thumpGain);
        thumpGain.connect(out);
        thumpOsc.start(t);
        thumpOsc.stop(t + 0.065);

        // Metallic contact clack
        const snapNoise = this._createNoiseSource();
        if (snapNoise) {
            const bpFilter = ctx.createBiquadFilter();
            bpFilter.type = 'bandpass';
            bpFilter.frequency.setValueAtTime(3100, t);
            bpFilter.Q.setValueAtTime(7.5, t);

            const snapGain = ctx.createGain();
            snapGain.gain.setValueAtTime(0.72, t);
            snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

            snapNoise.connect(bpFilter);
            bpFilter.connect(snapGain);
            snapGain.connect(out);

            snapNoise.start(t);
            snapNoise.stop(t + 0.05);
        }

        // Metal body chime
        const metalOsc = ctx.createOscillator();
        metalOsc.type = 'triangle';
        metalOsc.frequency.setValueAtTime(1280, t);
        metalOsc.frequency.exponentialRampToValueAtTime(920, t + 0.04);

        const metalGain = ctx.createGain();
        metalGain.gain.setValueAtTime(0.48, t);
        metalGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

        metalOsc.connect(metalGain);
        metalGain.connect(out);
        metalOsc.start(t);
        metalOsc.stop(t + 0.05);

        // Phase 2: Secondary spring catch snap (latching into place)
        const t2 = t + 0.045;
        const springOsc = ctx.createOscillator();
        springOsc.type = 'sine';
        springOsc.frequency.setValueAtTime(3800, t2);
        springOsc.frequency.exponentialRampToValueAtTime(3300, t2 + 0.03);

        const springGain = ctx.createGain();
        springGain.gain.setValueAtTime(0.5, t2);
        springGain.gain.exponentialRampToValueAtTime(0.001, t2 + 0.035);

        springOsc.connect(springGain);
        springGain.connect(out);
        springOsc.start(t2);
        springOsc.stop(t2 + 0.04);

        const springHarmonic = ctx.createOscillator();
        springHarmonic.type = 'triangle';
        springHarmonic.frequency.setValueAtTime(5600, t2);

        const harmonicGain = ctx.createGain();
        harmonicGain.gain.setValueAtTime(0.28, t2);
        harmonicGain.gain.exponentialRampToValueAtTime(0.001, t2 + 0.025);

        springHarmonic.connect(harmonicGain);
        harmonicGain.connect(out);
        springHarmonic.start(t2);
        springHarmonic.stop(t2 + 0.03);

        const springNoise = this._createNoiseSource();
        if (springNoise) {
            const springFilter = ctx.createBiquadFilter();
            springFilter.type = 'bandpass';
            springFilter.frequency.setValueAtTime(4500, t2);
            springFilter.Q.setValueAtTime(9, t2);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.4, t2);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, t2 + 0.02);

            springNoise.connect(springFilter);
            springFilter.connect(noiseGain);
            noiseGain.connect(out);

            springNoise.start(t2);
            springNoise.stop(t2 + 0.025);
        }

        return true;
    }

    /**
     * Play two-part sliding metal rack and chamber lock.
     * Completes the weapon reload sequence.
     */
    playBoltRack() {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        const out = this.masterGain || ctx.destination;
        const t = ctx.currentTime;

        // Part 1: Sliding metal rack backward (t = 0 to 0.12s)
        const slideNoise = this._createNoiseSource();
        if (slideNoise) {
            const bpFilter = ctx.createBiquadFilter();
            bpFilter.type = 'bandpass';
            bpFilter.Q.setValueAtTime(3.2, t);
            bpFilter.frequency.setValueAtTime(720, t);
            bpFilter.frequency.exponentialRampToValueAtTime(1750, t + 0.1);

            const slideGain = ctx.createGain();
            slideGain.gain.setValueAtTime(0.05, t);
            slideGain.gain.linearRampToValueAtTime(0.38, t + 0.045);
            slideGain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

            slideNoise.connect(bpFilter);
            bpFilter.connect(slideGain);
            slideGain.connect(out);

            slideNoise.start(t);
            slideNoise.stop(t + 0.12);
        }

        const rackResonance = ctx.createOscillator();
        rackResonance.type = 'triangle';
        rackResonance.frequency.setValueAtTime(1120, t);
        rackResonance.frequency.exponentialRampToValueAtTime(1680, t + 0.09);

        const rackGain = ctx.createGain();
        rackGain.gain.setValueAtTime(0.18, t);
        rackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.095);

        rackResonance.connect(rackGain);
        rackGain.connect(out);
        rackResonance.start(t);
        rackResonance.stop(t + 0.1);

        // Rear stop click at peak of bolt pull
        const tStop = t + 0.085;
        const stopThud = ctx.createOscillator();
        stopThud.type = 'sine';
        stopThud.frequency.setValueAtTime(420, tStop);
        stopThud.frequency.exponentialRampToValueAtTime(150, tStop + 0.02);

        const stopGain = ctx.createGain();
        stopGain.gain.setValueAtTime(0.52, tStop);
        stopGain.gain.exponentialRampToValueAtTime(0.001, tStop + 0.025);

        stopThud.connect(stopGain);
        stopGain.connect(out);
        stopThud.start(tStop);
        stopThud.stop(tStop + 0.03);

        // Part 2: Forward bolt slide and chamber lock (t + 0.16s to 0.28s)
        const tForward = t + 0.16;
        const forwardNoise = this._createNoiseSource();
        if (forwardNoise) {
            const fFilter = ctx.createBiquadFilter();
            fFilter.type = 'bandpass';
            fFilter.Q.setValueAtTime(3.8, tForward);
            fFilter.frequency.setValueAtTime(1950, tForward);
            fFilter.frequency.exponentialRampToValueAtTime(1020, tForward + 0.06);

            const fGain = ctx.createGain();
            fGain.gain.setValueAtTime(0.05, tForward);
            fGain.gain.linearRampToValueAtTime(0.28, tForward + 0.025);
            fGain.gain.exponentialRampToValueAtTime(0.001, tForward + 0.065);

            forwardNoise.connect(fFilter);
            fFilter.connect(fGain);
            fGain.connect(out);

            forwardNoise.start(tForward);
            forwardNoise.stop(tForward + 0.07);
        }

        // Chamber lock into battery
        const tLock = t + 0.21;
        const lockThud = ctx.createOscillator();
        lockThud.type = 'sine';
        lockThud.frequency.setValueAtTime(290, tLock);
        lockThud.frequency.exponentialRampToValueAtTime(55, tLock + 0.07);

        const lockGain = ctx.createGain();
        lockGain.gain.setValueAtTime(0.8, tLock);
        lockGain.gain.exponentialRampToValueAtTime(0.001, tLock + 0.075);

        lockThud.connect(lockGain);
        lockGain.connect(out);
        lockThud.start(tLock);
        lockThud.stop(tLock + 0.08);

        const lockSnap = this._createNoiseSource();
        if (lockSnap) {
            const snapFilter = ctx.createBiquadFilter();
            snapFilter.type = 'bandpass';
            snapFilter.frequency.setValueAtTime(2750, tLock);
            snapFilter.Q.setValueAtTime(8.5, tLock);

            const snapGain = ctx.createGain();
            snapGain.gain.setValueAtTime(0.7, tLock);
            snapGain.gain.exponentialRampToValueAtTime(0.001, tLock + 0.05);

            lockSnap.connect(snapFilter);
            snapFilter.connect(snapGain);
            snapGain.connect(out);

            lockSnap.start(tLock);
            lockSnap.stop(tLock + 0.055);
        }

        // Metallic locking ring overtone
        const lugOsc = ctx.createOscillator();
        lugOsc.type = 'triangle';
        lugOsc.frequency.setValueAtTime(1920, tLock);

        const lugGain = ctx.createGain();
        lugGain.gain.setValueAtTime(0.38, tLock);
        lugGain.gain.exponentialRampToValueAtTime(0.001, tLock + 0.045);

        lugOsc.connect(lugGain);
        lugGain.connect(out);
        lugOsc.start(tLock);
        lugOsc.stop(tLock + 0.05);

        return true;
    }

    /**
     * Play hollow metallic hammer click when magazine is empty.
     */
    playDryFire() {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        const out = this.masterGain || ctx.destination;
        const t = ctx.currentTime;

        // Hammer strike transient
        const transientNoise = this._createNoiseSource();
        if (transientNoise) {
            const hpFilter = ctx.createBiquadFilter();
            hpFilter.type = 'highpass';
            hpFilter.frequency.setValueAtTime(2800, t);

            const transientGain = ctx.createGain();
            transientGain.gain.setValueAtTime(0.58, t);
            transientGain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);

            transientNoise.connect(hpFilter);
            hpFilter.connect(transientGain);
            transientGain.connect(out);

            transientNoise.start(t);
            transientNoise.stop(t + 0.015);
        }

        // Sharp strike click
        const strikeOsc = ctx.createOscillator();
        strikeOsc.type = 'triangle';
        strikeOsc.frequency.setValueAtTime(3100, t);
        strikeOsc.frequency.exponentialRampToValueAtTime(880, t + 0.014);

        const strikeGain = ctx.createGain();
        strikeGain.gain.setValueAtTime(0.65, t);
        strikeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);

        strikeOsc.connect(strikeGain);
        strikeGain.connect(out);
        strikeOsc.start(t);
        strikeOsc.stop(t + 0.02);

        // Hollow acoustic chamber resonance (530Hz body)
        const hollowOsc = ctx.createOscillator();
        hollowOsc.type = 'sine';
        hollowOsc.frequency.setValueAtTime(530, t);

        const hollowGain = ctx.createGain();
        hollowGain.gain.setValueAtTime(0.48, t);
        hollowGain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);

        hollowOsc.connect(hollowGain);
        hollowGain.connect(out);
        hollowOsc.start(t);
        hollowOsc.stop(t + 0.08);

        // Secondary empty chamber mode (880Hz)
        const modeOsc = ctx.createOscillator();
        modeOsc.type = 'sine';
        modeOsc.frequency.setValueAtTime(880, t);

        const modeGain = ctx.createGain();
        modeGain.gain.setValueAtTime(0.26, t);
        modeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

        modeOsc.connect(modeGain);
        modeGain.connect(out);
        modeOsc.start(t);
        modeOsc.stop(t + 0.065);

        // High metallic tick
        const tickOsc = ctx.createOscillator();
        tickOsc.type = 'sine';
        tickOsc.frequency.setValueAtTime(3450, t);

        const tickGain = ctx.createGain();
        tickGain.gain.setValueAtTime(0.32, t);
        tickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

        tickOsc.connect(tickGain);
        tickGain.connect(out);
        tickOsc.start(t);
        tickOsc.stop(t + 0.04);

        return true;
    }

    // =========================================================================
    // 2. Projectile and Impact Sounds
    // =========================================================================

    /**
     * Play high-speed supersonic snap / Doppler whip for near misses.
     * @param {Position3D | number[] | null} [pos=null] Emitter position for spatial audio.
     */
    playBulletWhiz(pos = null) {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        // The whiz is only heard when a round passes close by, so its range stays short.
        const spatial = this._createSpatialNode(pos, this._range('GAME_WHIZ_AUDIO_RANGE', 900));
        if (!spatial) return null;
        const out = spatial.input;
        const t = ctx.currentTime;

        // 1. Supersonic N-wave shockwave snap
        const crackNoise = this._createNoiseSource();
        if (crackNoise) {
            const hpFilter = ctx.createBiquadFilter();
            hpFilter.type = 'highpass';
            hpFilter.frequency.setValueAtTime(4200, t);

            const crackGain = ctx.createGain();
            crackGain.gain.setValueAtTime(0.88, t);
            crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.009);

            crackNoise.connect(hpFilter);
            hpFilter.connect(crackGain);
            crackGain.connect(out);

            crackNoise.start(t);
            crackNoise.stop(t + 0.012);
        }

        const snapOsc = ctx.createOscillator();
        snapOsc.type = 'triangle';
        snapOsc.frequency.setValueAtTime(4800, t);
        snapOsc.frequency.exponentialRampToValueAtTime(1100, t + 0.01);

        const snapGain = ctx.createGain();
        snapGain.gain.setValueAtTime(0.75, t);
        snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);

        snapOsc.connect(snapGain);
        snapGain.connect(out);
        snapOsc.start(t);
        snapOsc.stop(t + 0.015);

        // 2. Doppler whip (steep frequency descent representing projectile speed)
        const whipNoise = this._createNoiseSource();
        if (whipNoise) {
            const bpFilter = ctx.createBiquadFilter();
            bpFilter.type = 'bandpass';
            bpFilter.Q.setValueAtTime(5.5, t);
            bpFilter.frequency.setValueAtTime(3400, t);
            bpFilter.frequency.exponentialRampToValueAtTime(420, t + 0.09);

            const whipGain = ctx.createGain();
            whipGain.gain.setValueAtTime(0.08, t);
            whipGain.gain.linearRampToValueAtTime(0.68, t + 0.016);
            whipGain.gain.exponentialRampToValueAtTime(0.001, t + 0.095);

            whipNoise.connect(bpFilter);
            bpFilter.connect(whipGain);
            whipGain.connect(out);

            whipNoise.start(t);
            whipNoise.stop(t + 0.1);
        }

        const whistleOsc = ctx.createOscillator();
        whistleOsc.type = 'sine';
        whistleOsc.frequency.setValueAtTime(2600, t);
        whistleOsc.frequency.exponentialRampToValueAtTime(380, t + 0.085);

        const whistleGain = ctx.createGain();
        whistleGain.gain.setValueAtTime(0.04, t);
        whistleGain.gain.linearRampToValueAtTime(0.36, t + 0.018);
        whistleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);

        whistleOsc.connect(whistleGain);
        whistleGain.connect(out);
        whistleOsc.start(t);
        whistleOsc.stop(t + 0.09);

        // 3. Air displacement whoosh
        const airNoise = this._createNoiseSource();
        if (airNoise) {
            const lpFilter = ctx.createBiquadFilter();
            lpFilter.type = 'lowpass';
            lpFilter.frequency.setValueAtTime(550, t);

            const airGain = ctx.createGain();
            airGain.gain.setValueAtTime(0.01, t);
            airGain.gain.linearRampToValueAtTime(0.26, t + 0.024);
            airGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

            airNoise.connect(lpFilter);
            lpFilter.connect(airGain);
            airGain.connect(out);

            airNoise.start(t);
            airNoise.stop(t + 0.13);
        }

        return true;
    }

    /**
     * Play high-pitched frequency-modulated metallic ricochet zing.
     * @param {Position3D | number[] | null} [pos=null] Emitter position for spatial audio.
     */
    playRicochet(pos = null) {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        const spatial = this._createSpatialNode(pos, this._range('GAME_RICOCHET_AUDIO_RANGE', 1400));
        if (!spatial) return null;
        const out = spatial.input;
        const t = ctx.currentTime;

        // 1. Initial impact spark ping
        const pingNoise = this._createNoiseSource();
        if (pingNoise) {
            const bpFilter = ctx.createBiquadFilter();
            bpFilter.type = 'bandpass';
            bpFilter.frequency.setValueAtTime(4800, t);
            bpFilter.Q.setValueAtTime(10, t);

            const pingGain = ctx.createGain();
            pingGain.gain.setValueAtTime(0.6, t);
            pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

            pingNoise.connect(bpFilter);
            bpFilter.connect(pingGain);
            pingGain.connect(out);

            pingNoise.start(t);
            pingNoise.stop(t + 0.03);
        }

        const chimeOsc = ctx.createOscillator();
        chimeOsc.type = 'sine';
        chimeOsc.frequency.setValueAtTime(5400, t);

        const chimeGain = ctx.createGain();
        chimeGain.gain.setValueAtTime(0.42, t);
        chimeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

        chimeOsc.connect(chimeGain);
        chimeGain.connect(out);
        chimeOsc.start(t);
        chimeOsc.stop(t + 0.035);

        // 2. Frequency-Modulated (FM) ricochet zing
        const baseCarrier = 3300 + Math.random() * 600;
        const modFreq = 95 + Math.random() * 30;

        const carrierOsc = ctx.createOscillator();
        carrierOsc.type = 'sine';
        carrierOsc.frequency.setValueAtTime(baseCarrier, t);
        carrierOsc.frequency.exponentialRampToValueAtTime(1150, t + 0.45);

        const modOsc = ctx.createOscillator();
        modOsc.type = 'sine';
        modFreq > 0 && modOsc.frequency.setValueAtTime(modFreq, t);

        const modGain = ctx.createGain();
        modGain.gain.setValueAtTime(2200, t);
        modGain.gain.exponentialRampToValueAtTime(40, t + 0.3);

        modOsc.connect(modGain);
        modGain.connect(carrierOsc.frequency);

        const hpFilter = ctx.createBiquadFilter();
        hpFilter.type = 'highpass';
        hpFilter.frequency.setValueAtTime(750, t);

        const carrierGain = ctx.createGain();
        carrierGain.gain.setValueAtTime(0.001, t);
        carrierGain.gain.linearRampToValueAtTime(0.62, t + 0.003);
        carrierGain.gain.exponentialRampToValueAtTime(0.001, t + 0.48);

        carrierOsc.connect(hpFilter);
        hpFilter.connect(carrierGain);
        carrierGain.connect(out);

        modOsc.start(t);
        carrierOsc.start(t);
        modOsc.stop(t + 0.5);
        carrierOsc.stop(t + 0.5);

        return true;
    }

    /**
     * Play surface-dependent bullet impacts (metal spark ping, dirt blast, concrete chip).
     * @param {string} [surfaceType='concrete'] Surface type ('metal', 'dirt', 'concrete', etc.).
     * @param {Position3D | number[] | null} [pos=null] Emitter position for spatial audio.
     */
    playImpact(surfaceType = 'concrete', pos = null) {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        // Covers the weapon's full reach (GAME_FIRE_RANGE 900 px, hitscan up to 1600 px).
        // The old hardcoded 1000 made every impact past 1000 px silent, which is most of a
        // firefight on a 4096 px map.
        const spatial = this._createSpatialNode(pos, this._range('GAME_IMPACT_AUDIO_RANGE', 1600));
        if (!spatial) return null;
        const out = spatial.input;
        const t = ctx.currentTime;
        const type = String(surfaceType || 'concrete').toLowerCase().trim();

        if (type === 'metal') {
            // Metal: sharp spark ping + dual resonant metallic rings
            const sparkNoise = this._createNoiseSource();
            if (sparkNoise) {
                const hpFilter = ctx.createBiquadFilter();
                hpFilter.type = 'highpass';
                hpFilter.frequency.setValueAtTime(3600, t);

                const sparkGain = ctx.createGain();
                sparkGain.gain.setValueAtTime(0.78, t);
                sparkGain.gain.exponentialRampToValueAtTime(0.001, t + 0.016);

                sparkNoise.connect(hpFilter);
                hpFilter.connect(sparkGain);
                sparkGain.connect(out);

                sparkNoise.start(t);
                sparkNoise.stop(t + 0.02);
            }

            const punchOsc = ctx.createOscillator();
            punchOsc.type = 'sine';
            punchOsc.frequency.setValueAtTime(420, t);
            punchOsc.frequency.exponentialRampToValueAtTime(90, t + 0.035);

            const punchGain = ctx.createGain();
            punchGain.gain.setValueAtTime(0.62, t);
            punchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

            punchOsc.connect(punchGain);
            punchGain.connect(out);
            punchOsc.start(t);
            punchOsc.stop(t + 0.045);

            // Resonant metallic ring 1
            const ring1 = ctx.createOscillator();
            ring1.type = 'sine';
            ring1.frequency.setValueAtTime(2250, t);

            const ring1Gain = ctx.createGain();
            ring1Gain.gain.setValueAtTime(0.52, t);
            ring1Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

            ring1.connect(ring1Gain);
            ring1Gain.connect(out);
            ring1.start(t);
            ring1.stop(t + 0.19);

            // Resonant metallic ring 2
            const ring2 = ctx.createOscillator();
            ring2.type = 'triangle';
            ring2.frequency.setValueAtTime(4450, t);

            const ring2Gain = ctx.createGain();
            ring2Gain.gain.setValueAtTime(0.36, t);
            ring2Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

            ring2.connect(ring2Gain);
            ring2Gain.connect(out);
            ring2.start(t);
            ring2.stop(t + 0.15);

            // Bandpass metallic resonance
            const resNoise = this._createNoiseSource();
            if (resNoise) {
                const bpFilter = ctx.createBiquadFilter();
                bpFilter.type = 'bandpass';
                bpFilter.frequency.setValueAtTime(3200, t);
                bpFilter.Q.setValueAtTime(14, t);

                const resGain = ctx.createGain();
                resGain.gain.setValueAtTime(0.45, t);
                resGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

                resNoise.connect(bpFilter);
                bpFilter.connect(resGain);
                resGain.connect(out);

                resNoise.start(t);
                resNoise.stop(t + 0.13);
            }
        } else if (type === 'dirt') {
            // Dirt: low-frequency dirt blast thump + lowpass earth noise + particulate scatter
            const thumpOsc = ctx.createOscillator();
            thumpOsc.type = 'sine';
            thumpOsc.frequency.setValueAtTime(165, t);
            thumpOsc.frequency.exponentialRampToValueAtTime(42, t + 0.12);

            const thumpGain = ctx.createGain();
            thumpGain.gain.setValueAtTime(0.88, t);
            thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

            thumpOsc.connect(thumpGain);
            thumpGain.connect(out);
            thumpOsc.start(t);
            thumpOsc.stop(t + 0.14);

            const blastNoise = this._createNoiseSource();
            if (blastNoise) {
                const lpFilter = ctx.createBiquadFilter();
                lpFilter.type = 'lowpass';
                lpFilter.Q.setValueAtTime(1.8, t);
                lpFilter.frequency.setValueAtTime(750, t);
                lpFilter.frequency.exponentialRampToValueAtTime(160, t + 0.19);

                const blastGain = ctx.createGain();
                blastGain.gain.setValueAtTime(0.82, t);
                blastGain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);

                blastNoise.connect(lpFilter);
                lpFilter.connect(blastGain);
                blastGain.connect(out);

                blastNoise.start(t);
                blastNoise.stop(t + 0.2);
            }

            const sprayNoise = this._createNoiseSource();
            if (sprayNoise) {
                const bpFilter = ctx.createBiquadFilter();
                bpFilter.type = 'bandpass';
                bpFilter.frequency.setValueAtTime(1500, t);
                bpFilter.Q.setValueAtTime(2.2, t);

                const sprayGain = ctx.createGain();
                sprayGain.gain.setValueAtTime(0.38, t);
                sprayGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

                sprayNoise.connect(bpFilter);
                bpFilter.connect(sprayGain);
                sprayGain.connect(out);

                sprayNoise.start(t);
                sprayNoise.stop(t + 0.23);
            }
        } else {
            // Concrete / default: hard brittle crack + chip / dust puff
            const crackOsc = ctx.createOscillator();
            crackOsc.type = 'sine';
            crackOsc.frequency.setValueAtTime(1350, t);
            crackOsc.frequency.exponentialRampToValueAtTime(180, t + 0.025);

            const crackGain = ctx.createGain();
            crackGain.gain.setValueAtTime(0.85, t);
            crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

            crackOsc.connect(crackGain);
            crackGain.connect(out);
            crackOsc.start(t);
            crackOsc.stop(t + 0.035);

            // Brittle chipping noise
            const chipNoise = this._createNoiseSource();
            if (chipNoise) {
                const bpFilter = ctx.createBiquadFilter();
                bpFilter.type = 'bandpass';
                bpFilter.frequency.setValueAtTime(3800, t);
                bpFilter.Q.setValueAtTime(6, t);

                const chipGain = ctx.createGain();
                chipGain.gain.setValueAtTime(0.65, t);
                chipGain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);

                chipNoise.connect(bpFilter);
                bpFilter.connect(chipGain);
                chipGain.connect(out);

                chipNoise.start(t);
                chipNoise.stop(t + 0.08);
            }

            // Concrete dust puff & crumble body
            const crumbleNoise = this._createNoiseSource();
            if (crumbleNoise) {
                const lpFilter = ctx.createBiquadFilter();
                lpFilter.type = 'bandpass';
                lpFilter.frequency.setValueAtTime(680, t);
                lpFilter.Q.setValueAtTime(3.2, t);

                const crumbleGain = ctx.createGain();
                crumbleGain.gain.setValueAtTime(0.52, t);
                crumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

                crumbleNoise.connect(lpFilter);
                lpFilter.connect(crumbleGain);
                crumbleGain.connect(out);

                crumbleNoise.start(t);
                crumbleNoise.stop(t + 0.15);
            }
        }

        return true;
    }

    // =========================================================================
    // 3. Tactical Shield Audio
    // =========================================================================

    /**
     * Play crystalline energy disruption crackle for shield hit.
     */
    playShieldHit() {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        const out = this.masterGain || ctx.destination;
        const t = ctx.currentTime;

        // 1. Crystalline energy resonance cluster (non-harmonic frequencies)
        const freqs = [1480, 2120, 3160, 4420];
        for (let i = 0; i < freqs.length; i++) {
            const osc = ctx.createOscillator();
            osc.type = i % 2 === 0 ? 'sine' : 'triangle';
            const f = freqs[i];
            osc.frequency.setValueAtTime(f, t);
            if (i === 0) {
                // Downward deflection sweep on carrier
                osc.frequency.exponentialRampToValueAtTime(920, t + 0.18);
            }

            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(0.35 / (i + 1), t);
            oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

            osc.connect(oscGain);
            oscGain.connect(out);
            osc.start(t);
            osc.stop(t + 0.21);
        }

        // 2. Disruption crackle (rapid micro-discharges)
        const dischargeDelays = [0.0, 0.022, 0.048, 0.079];
        for (let j = 0; j < dischargeDelays.length; j++) {
            const dt = t + dischargeDelays[j];
            const crackleNoise = this._createNoiseSource();
            if (crackleNoise) {
                const bpFilter = ctx.createBiquadFilter();
                bpFilter.type = 'bandpass';
                bpFilter.frequency.setValueAtTime(3200 + Math.random() * 800, dt);
                bpFilter.Q.setValueAtTime(8, dt);

                const crackleGain = ctx.createGain();
                crackleGain.gain.setValueAtTime(0.42 + Math.random() * 0.15, dt);
                crackleGain.gain.exponentialRampToValueAtTime(0.001, dt + 0.014);

                crackleNoise.connect(bpFilter);
                bpFilter.connect(crackleGain);
                crackleGain.connect(out);

                crackleNoise.start(dt);
                crackleNoise.stop(dt + 0.016);
            }
        }

        return true;
    }

    /**
     * Play explosive electromagnetic collapse with glass-like resonance and low-frequency failure tone.
     * Triggered when a tactical shield breaks.
     */
    playShieldBreak() {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        const out = this.masterGain || ctx.destination;
        const t = ctx.currentTime;

        // 1. Explosive electromagnetic collapse: sub-bass EMP blast
        const empOsc = ctx.createOscillator();
        empOsc.type = 'sine';
        empOsc.frequency.setValueAtTime(150, t);
        empOsc.frequency.exponentialRampToValueAtTime(32, t + 0.55);

        const empGain = ctx.createGain();
        empGain.gain.setValueAtTime(0.95, t);
        empGain.gain.exponentialRampToValueAtTime(0.001, t + 0.58);

        empOsc.connect(empGain);
        empGain.connect(out);
        empOsc.start(t);
        empOsc.stop(t + 0.6);

        // Wideband EM explosion whoosh
        const emNoise = this._createNoiseSource();
        if (emNoise) {
            const lpFilter = ctx.createBiquadFilter();
            lpFilter.type = 'lowpass';
            lpFilter.Q.setValueAtTime(3.5, t);
            lpFilter.frequency.setValueAtTime(3800, t);
            lpFilter.frequency.exponentialRampToValueAtTime(110, t + 0.65);

            const emGain = ctx.createGain();
            emGain.gain.setValueAtTime(0.85, t);
            emGain.gain.exponentialRampToValueAtTime(0.001, t + 0.66);

            emNoise.connect(lpFilter);
            lpFilter.connect(emGain);
            emGain.connect(out);

            emNoise.start(t);
            emNoise.stop(t + 0.68);
        }

        // 2. Glass-like crystalline resonance shattering
        const glassFreqs = [1820, 2580, 3840, 5300, 7100];
        for (let i = 0; i < glassFreqs.length; i++) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(glassFreqs[i], t);

            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(0.42 / (i + 1), t);
            oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

            osc.connect(oscGain);
            oscGain.connect(out);
            osc.start(t);
            osc.stop(t + 0.72);
        }

        // 3. Low-frequency failure tone (power-down collapse)
        const failOsc = ctx.createOscillator();
        failOsc.type = 'sawtooth';
        failOsc.frequency.setValueAtTime(230, t);
        failOsc.frequency.exponentialRampToValueAtTime(38, t + 0.85);

        const failFilter = ctx.createBiquadFilter();
        failFilter.type = 'lowpass';
        failFilter.frequency.setValueAtTime(1100, t);
        failFilter.frequency.exponentialRampToValueAtTime(50, t + 0.85);

        const failGain = ctx.createGain();
        failGain.gain.setValueAtTime(0.52, t);
        failGain.gain.exponentialRampToValueAtTime(0.001, t + 0.86);

        failOsc.connect(failFilter);
        failFilter.connect(failGain);
        failGain.connect(out);

        failOsc.start(t);
        failOsc.stop(t + 0.88);

        return true;
    }

    /**
     * Play or stop rising high-voltage harmonic hum while shield is replenishing.
     * @param {boolean} [active=true] If true, starts/continues recharge hum; if false, fades out and stops.
     * @returns {object | null} Active recharge state or null if stopped.
     */
    playShieldRecharge(active = true) {
        if (!this._ensureContext()) return null;
        const ctx = this.ctx;
        const t = ctx.currentTime;

        // If stopping, fade out existing recharge sound
        if (!active) {
            if (this._rechargeState) {
                const state = this._rechargeState;
                this._rechargeState = null;
                try {
                    state.master.gain.setValueAtTime(state.master.gain.value, t);
                    state.master.gain.linearRampToValueAtTime(0.001, t + 0.15);
                    setTimeout(() => {
                        for (const node of state.oscs) {
                            try {
                                if ('stop' in node && typeof node.stop === 'function') node.stop();
                                node.disconnect();
                            } catch (e) {}
                        }
                    }, 180);
                } catch (e) {}
            }
            return null;
        }

        // If active, stop previous recharge state if running
        if (this._rechargeState) {
            this.playShieldRecharge(false);
        }

        const out = this.masterGain || ctx.destination;
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.001, t);
        masterGain.gain.linearRampToValueAtTime(0.42, t + 0.25);
        masterGain.connect(out);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.setValueAtTime(2.5, t);
        filter.frequency.setValueAtTime(450, t);
        filter.frequency.exponentialRampToValueAtTime(3400, t + 3.0);
        filter.connect(masterGain);

        // High-voltage harmonic cluster
        const oscs = [];
        const harmonicMultipliers = [1.0, 2.0, 3.0, 8.0];
        const baseFreq = 95;
        const targetFreq = 280;

        for (let i = 0; i < harmonicMultipliers.length; i++) {
            const mult = harmonicMultipliers[i];
            const osc = ctx.createOscillator();
            osc.type = i === 2 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(baseFreq * mult, t);
            osc.frequency.exponentialRampToValueAtTime(targetFreq * mult, t + 3.0);

            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(0.3 / (i + 1), t);

            osc.connect(oscGain);
            oscGain.connect(filter);
            osc.start(t);
            oscs.push(osc);
        }

        // 14Hz LFO tremolo for AC power buzz
        let lfo = null;
        try {
            lfo = ctx.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.setValueAtTime(14, t);

            const lfoGain = ctx.createGain();
            lfoGain.gain.setValueAtTime(0.12, t);

            lfo.connect(lfoGain);
            lfoGain.connect(masterGain.gain);
            lfo.start(t);
            oscs.push(lfo);
        } catch (e) {}

        this._rechargeState = {
            oscs,
            gains: [masterGain],
            filter,
            master: masterGain,
            stop: () => this.playShieldRecharge(false)
        };

        return this._rechargeState;
    }

    // =========================================================================
    // Static delegates for convenience
    // =========================================================================

    static playMagOut() { return ProceduralCombatSynth.shared.playMagOut(); }
    static playMagIn() { return ProceduralCombatSynth.shared.playMagIn(); }
    static playBoltRack() { return ProceduralCombatSynth.shared.playBoltRack(); }
    static playDryFire() { return ProceduralCombatSynth.shared.playDryFire(); }
    static playBulletWhiz(pos = null) { return ProceduralCombatSynth.shared.playBulletWhiz(pos); }
    static playRicochet(pos = null) { return ProceduralCombatSynth.shared.playRicochet(pos); }
    static playImpact(surfaceType = 'concrete', pos = null) { return ProceduralCombatSynth.shared.playImpact(surfaceType, pos); }
    static playShieldHit() { return ProceduralCombatSynth.shared.playShieldHit(); }
    static playShieldBreak() { return ProceduralCombatSynth.shared.playShieldBreak(); }
    static playShieldRecharge(active = true) { return ProceduralCombatSynth.shared.playShieldRecharge(active); }
}

if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ProceduralCombatSynth = ProceduralCombatSynth;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).ProceduralCombatSynth = ProceduralCombatSynth;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProceduralCombatSynth };
}
