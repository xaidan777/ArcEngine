// ============================================================================
//  ArcEngine — Procedural Foley Synthesizer (Web Audio API)
// ----------------------------------------------------------------------------
//  Procedural real-time tactical movement foley and footstep synthesizer:
//  1. Ground surface footsteps: dirt/soil, gravel/rubble, metal/gantry, concrete.
//  2. Tactical movement foley: gear rustle, jump launch, jump land.
//  3. Dynamic velocity and volume scaling: walking, sprinting, landing impact.
//  Vanilla ES/browser JavaScript with full JSDoc and Node.js test compatibility.
// ============================================================================

/**
 * @typedef {'dirt' | 'soil' | 'gravel' | 'rubble' | 'metal' | 'gantry' | 'concrete'} SurfaceType
 * @typedef {'dirt' | 'gravel' | 'metal' | 'concrete'} CanonicalSurface
 */

/**
 * @typedef {Object} FootstepOptions
 * @property {number} [velocity=0.5] - Movement velocity (0.1 to 1.5). Walking is ~0.5, sprinting is ~1.0.
 * @property {boolean} [sprint=false] - Whether movement is a sprint (heightens transients and brightness).
 * @property {number} [volume=1.0] - Sound volume multiplier (0.0 to 2.0).
 * @property {number} [pan=0.0] - Stereo pan position (-1.0 left to 1.0 right).
 * @property {number} [time] - AudioContext scheduled start time (defaults to ctx.currentTime).
 */

/**
 * @typedef {Object} GearRustleOptions
 * @property {number} [intensity=0.6] - Rustle intensity (0.0 to 1.0).
 * @property {number} [duration] - Duration in seconds (defaults to dynamic scaling ~0.22 - 0.35s).
 * @property {number} [volume=1.0] - Sound volume multiplier.
 * @property {number} [pan=0.0] - Stereo pan position (-1.0 to 1.0).
 * @property {number} [time] - AudioContext scheduled start time.
 */

/**
 * @typedef {Object} JumpLaunchOptions
 * @property {number} [velocity=1.0] - Launch velocity/force (0.1 to 2.0).
 * @property {SurfaceType|string} [surface='concrete'] - Ground surface type for push-off traction.
 * @property {number} [volume=1.0] - Sound volume multiplier.
 * @property {number} [pan=0.0] - Stereo pan position (-1.0 to 1.0).
 * @property {number} [time] - AudioContext scheduled start time.
 */

/**
 * @typedef {Object} JumpLandOptions
 * @property {number} [impactVelocity=1.0] - Landing impact velocity (0.1 to 2.5).
 * @property {number} [volume=1.0] - Sound volume multiplier.
 * @property {number} [pan=0.0] - Stereo pan position (-1.0 to 1.0).
 * @property {number} [time] - AudioContext scheduled start time.
 */

/**
 * @typedef {Object} FoleySynthOptions
 * @property {AudioContext|BaseAudioContext|any} [audioContext] - Existing Web Audio context.
 * @property {AudioNode|any} [destination] - Destination audio node (defaults to ctx.destination).
 * @property {number} [masterVolume=1.0] - Master volume multiplier (0.0 to 2.0).
 * @property {number} [sampleRate=44100] - Sample rate for procedural noise generation.
 */

/**
 * @typedef {Object} FoleyPlaybackResult
 * @property {boolean} played - Whether audio nodes were successfully scheduled.
 * @property {number} duration - Estimated total sound duration in seconds.
 * @property {string} type - Foley sound category ('footstep', 'gear_rustle', 'jump_launch', 'jump_land').
 * @property {string} [surface] - Normalized surface type if applicable.
 * @property {number} [effectiveVelocity] - Computed velocity multiplier.
 * @property {number} [effectiveVolume] - Computed volume amplitude.
 * @property {string} [reason] - Failure explanation if played is false.
 */

class ProceduralFoleySynth {
    /**
     * Canonical surface names supported by the synthesizer.
     * @type {readonly CanonicalSurface[]}
     */
    static SURFACES = Object.freeze(['dirt', 'gravel', 'metal', 'concrete']);

    /**
     * Surface alias map resolving synonyms to canonical surfaces.
     * @type {Readonly<Record<string, CanonicalSurface>>}
     */
    static SURFACE_ALIASES = Object.freeze({
        dirt: 'dirt',
        soil: 'dirt',
        mud: 'dirt',
        grass: 'dirt',
        earth: 'dirt',
        ground: 'dirt',
        gravel: 'gravel',
        rubble: 'gravel',
        stone: 'gravel',
        pebbles: 'gravel',
        rock: 'gravel',
        scree: 'gravel',
        metal: 'metal',
        gantry: 'metal',
        grate: 'metal',
        steel: 'metal',
        iron: 'metal',
        plate: 'metal',
        concrete: 'concrete',
        stone_slab: 'concrete',
        asphalt: 'concrete',
        pavement: 'concrete',
        tile: 'concrete',
        hard: 'concrete'
    });

    /**
     * Normalize any surface identifier to one of the 4 canonical surface types.
     * @param {string} [surface] - Input surface name or alias.
     * @returns {CanonicalSurface}
     */
    static normalizeSurface(surface) {
        if (!surface || typeof surface !== 'string') return 'concrete';
        const key = surface.trim().toLowerCase();
        return ProceduralFoleySynth.SURFACE_ALIASES[key] || 'concrete';
    }

    /**
     * Create a lightweight Web Audio API mock context suitable for headless/Node.js testing.
     * @param {Object} [mockOptions]
     * @param {number} [mockOptions.sampleRate=44100]
     * @param {number} [mockOptions.currentTime=0]
     * @returns {any}
     */
    static createMockContext(mockOptions = {}) {
        const sampleRate = mockOptions.sampleRate || 44100;
        let currentTime = mockOptions.currentTime || 0;

        class MockParam {
            /** @param {number} val */
            constructor(val = 0) {
                this.value = val;
                /** @type {Array<{type: string, value: number, time: number, constant?: number}>} */
                this.events = [];
            }
            /** @param {number} v @param {number} t */
            setValueAtTime(v, t) {
                this.value = v;
                this.events.push({ type: 'setValueAtTime', value: v, time: t });
                return this;
            }
            /** @param {number} v @param {number} t */
            linearRampToValueAtTime(v, t) {
                this.value = v;
                this.events.push({ type: 'linearRampToValueAtTime', value: v, time: t });
                return this;
            }
            /** @param {number} v @param {number} t */
            exponentialRampToValueAtTime(v, t) {
                this.value = v;
                this.events.push({ type: 'exponentialRampToValueAtTime', value: v, time: t });
                return this;
            }
            /** @param {number} v @param {number} t @param {number} c */
            setTargetAtTime(v, t, c) {
                this.value = v;
                this.events.push({ type: 'setTargetAtTime', value: v, time: t, constant: c });
                return this;
            }
        }

        class MockNode {
            constructor() {
                /** @type {any[]} */
                this.connectedTo = [];
            }
            /** @param {any} dest */
            connect(dest) {
                this.connectedTo.push(dest);
                return dest;
            }
            /** @param {any} [dest] */
            disconnect(dest) {
                if (!dest) this.connectedTo.length = 0;
                else {
                    const idx = this.connectedTo.indexOf(dest);
                    if (idx >= 0) this.connectedTo.splice(idx, 1);
                }
            }
        }

        class MockGainNode extends MockNode {
            constructor() {
                super();
                this.gain = new MockParam(1.0);
            }
        }

        class MockBiquadFilterNode extends MockNode {
            constructor() {
                super();
                /** @type {BiquadFilterType} */
                this.type = 'lowpass';
                this.frequency = new MockParam(350);
                this.Q = new MockParam(1.0);
                this.gain = new MockParam(0);
            }
        }

        class MockOscillatorNode extends MockNode {
            constructor() {
                super();
                /** @type {OscillatorType} */
                this.type = 'sine';
                this.frequency = new MockParam(440);
                this.started = false;
                this.stopped = false;
                this.startTime = -1;
                this.stopTime = -1;
                /** @type {(() => void) | null} */
                this.onended = null;
            }
            /** @param {number} [t] */
            start(t = 0) {
                this.started = true;
                this.startTime = t;
            }
            /** @param {number} [t] */
            stop(t = 0) {
                this.stopped = true;
                this.stopTime = t;
            }
        }

        class MockBufferSourceNode extends MockNode {
            constructor() {
                super();
                /** @type {any} */
                this.buffer = null;
                this.loop = false;
                this.playbackRate = new MockParam(1.0);
                this.started = false;
                this.stopped = false;
                this.startTime = -1;
                this.stopTime = -1;
                /** @type {(() => void) | null} */
                this.onended = null;
            }
            /** @param {number} [t] */
            start(t = 0) {
                this.started = true;
                this.startTime = t;
            }
            /** @param {number} [t] */
            stop(t = 0) {
                this.stopped = true;
                this.stopTime = t;
            }
        }

        class MockStereoPannerNode extends MockNode {
            constructor() {
                super();
                this.pan = new MockParam(0);
            }
        }

        class MockBuffer {
            /**
             * @param {number} numChannels
             * @param {number} length
             * @param {number} sRate
             */
            constructor(numChannels, length, sRate) {
                this.numberOfChannels = numChannels;
                this.length = length;
                this.sampleRate = sRate;
                this.duration = length / sRate;
                this._channels = [];
                for (let i = 0; i < numChannels; i++) {
                    this._channels.push(new Float32Array(length));
                }
            }
            /** @param {number} ch */
            getChannelData(ch) {
                return this._channels[ch] || this._channels[0];
            }
        }

        const destination = new MockNode();

        return {
            sampleRate,
            get currentTime() { return currentTime; },
            set currentTime(t) { currentTime = t; },
            state: 'running',
            destination,
            createGain: () => new MockGainNode(),
            createBiquadFilter: () => new MockBiquadFilterNode(),
            createOscillator: () => new MockOscillatorNode(),
            createBufferSource: () => new MockBufferSourceNode(),
            createStereoPanner: () => new MockStereoPannerNode(),
            createBuffer: (channels, length, sRate) => new MockBuffer(channels, length, sRate),
            resume: async () => 'running',
            suspend: async () => 'suspended',
            close: async () => 'closed'
        };
    }

    /**
     * @param {FoleySynthOptions} [options={}]
     */
    constructor(options = {}) {
        /** @type {any} */
        this.ctx = null;
        /** @type {any} */
        this.destination = null;
        /** @type {any} */
        this.masterGain = null;
        /** @type {boolean} */
        this.isSupported = false;

        /** @type {any} */
        this._whiteNoiseBuffer = null;
        /** @type {any} */
        this._pinkNoiseBuffer = null;

        /** @type {number} */
        this._masterVolume = typeof options.masterVolume === 'number' ? Math.max(0, options.masterVolume) : 1.0;

        // Resolve AudioContext from options or browser global
        const suppliedContext = options.audioContext;
        let resolvedContext = suppliedContext;
        if (!resolvedContext && typeof window !== 'undefined') {
            const AudioCtx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
            if (AudioCtx) {
                try {
                    resolvedContext = new AudioCtx();
                } catch {
                    resolvedContext = null;
                }
            }
        }

        if (resolvedContext) {
            this.init(resolvedContext, options.destination);
        }
    }

    /**
     * Initialize or re-attach the synthesizer to an AudioContext.
     * @param {any} audioContext - AudioContext instance or mock.
     * @param {any} [destination] - Custom destination node.
     * @returns {boolean}
     */
    init(audioContext, destination) {
        if (!audioContext) return false;
        try {
            this.ctx = audioContext;
            this.destination = destination || audioContext.destination;
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this._masterVolume, this.ctx.currentTime || 0);
            this.masterGain.connect(this.destination);
            this.isSupported = true;
            this._whiteNoiseBuffer = null;
            this._pinkNoiseBuffer = null;
            return true;
        } catch {
            this.isSupported = false;
            return false;
        }
    }

    /**
     * Resume audio context if suspended (required by modern browser autoplay policies).
     * @returns {Promise<boolean>}
     */
    async resume() {
        if (this.ctx && typeof this.ctx.resume === 'function' && this.ctx.state === 'suspended') {
            try {
                await this.ctx.resume();
                return true;
            } catch {
                return false;
            }
        }
        return this.isSupported;
    }

    /**
     * Set the master output volume.
     * @param {number} volume - Volume multiplier (0.0 to 2.0).
     */
    setMasterVolume(volume) {
        this._masterVolume = Math.max(0, Math.min(2.0, volume));
        if (this.masterGain && this.ctx) {
            const now = this.ctx.currentTime || 0;
            this.masterGain.gain.setValueAtTime(this._masterVolume, now);
        }
    }

    /**
     * Get the current master volume.
     * @returns {number}
     */
    getMasterVolume() {
        return this._masterVolume;
    }

    /**
     * Clean up and disconnect all audio graph connections.
     */
    dispose() {
        if (this.masterGain) {
            try {
                this.masterGain.disconnect();
            } catch { /* ignore */ }
            this.masterGain = null;
        }
        this._whiteNoiseBuffer = null;
        this._pinkNoiseBuffer = null;
        this.isSupported = false;
        this.ctx = null;
    }

    // =========================================================================
    //  Procedural Audio Footsteps
    // =========================================================================

    /**
     * Play a procedural footstep sound based on ground surface type and movement velocity.
     *
     * Surfaces:
     * - `dirt`/`soil`: soft low-frequency crunch with damped noise puff.
     * - `gravel`/`rubble`: crunchy granular noise bursts with distinct tiny stone clatters.
     * - `metal`/`gantry`: resonant metallic ping with hollow clang and short decay.
     * - `concrete`: sharp solid slap transient with high-frequency reflection.
     *
     * Dynamic velocity scaling:
     * - Walking (velocity ~ 0.5): softer impact, lower filter cutoffs, gentle transients.
     * - Sprinting (velocity ~ 1.0 or sprint: true): sharper transient bite, heightened resonance, louder crunch.
     *
     * @param {SurfaceType|string} [surface='concrete'] - Ground surface type.
     * @param {FootstepOptions} [options={}] - Playback options.
     * @returns {FoleyPlaybackResult}
     */
    playFootstep(surface = 'concrete', options = {}) {
        const canonical = ProceduralFoleySynth.normalizeSurface(surface);
        const velocity = typeof options.velocity === 'number' ? Math.max(0.1, Math.min(1.8, options.velocity)) : 0.5;
        const isSprint = Boolean(options.sprint);
        const effectiveVelocity = isSprint ? Math.max(1.0, velocity * 1.3) : velocity;
        const baseVolume = typeof options.volume === 'number' ? Math.max(0, options.volume) : 1.0;
        // Velocity scales amplitude dynamically: walking ~0.55, sprinting ~1.1
        const amp = baseVolume * Math.min(1.6, 0.3 + effectiveVelocity * 0.7);

        if (!this._ensureReady()) {
            return {
                played: false,
                reason: 'audio-context-unavailable',
                type: 'footstep',
                surface: canonical,
                duration: 0.15,
                effectiveVelocity,
                effectiveVolume: amp
            };
        }

        const now = typeof options.time === 'number' ? options.time : (this.ctx.currentTime || 0);
        const out = this._createPanner(options.pan, now);
        let duration = 0.15;

        switch (canonical) {
            case 'dirt':
                duration = this._synthDirtFootstep(now, out, amp, effectiveVelocity, isSprint);
                break;
            case 'gravel':
                duration = this._synthGravelFootstep(now, out, amp, effectiveVelocity, isSprint);
                break;
            case 'metal':
                duration = this._synthMetalFootstep(now, out, amp, effectiveVelocity, isSprint);
                break;
            case 'concrete':
            default:
                duration = this._synthConcreteFootstep(now, out, amp, effectiveVelocity, isSprint);
                break;
        }

        return {
            played: true,
            type: 'footstep',
            surface: canonical,
            duration,
            effectiveVelocity,
            effectiveVolume: amp
        };
    }

    // =========================================================================
    //  Tactical Movement Foley
    // =========================================================================

    /**
     * Play tactical gear rustle:
     * Filtered high-frequency noise sweep simulating nylon fabric, straps, and pouches
     * shifting during sprint starts or sharp direction changes.
     *
     * @param {GearRustleOptions} [options={}]
     * @returns {FoleyPlaybackResult}
     */
    playGearRustle(options = {}) {
        const intensity = typeof options.intensity === 'number' ? Math.max(0.1, Math.min(1.0, options.intensity)) : 0.6;
        const duration = typeof options.duration === 'number' ? Math.max(0.08, options.duration) : (0.2 + intensity * 0.14);
        const baseVolume = typeof options.volume === 'number' ? Math.max(0, options.volume) : 1.0;
        const amp = baseVolume * (0.25 + intensity * 0.65);

        if (!this._ensureReady()) {
            return {
                played: false,
                reason: 'audio-context-unavailable',
                type: 'gear_rustle',
                duration,
                effectiveVelocity: intensity,
                effectiveVolume: amp
            };
        }

        const now = typeof options.time === 'number' ? options.time : (this.ctx.currentTime || 0);
        const out = this._createPanner(options.pan, now);

        // Layer 1: Filtered high-frequency dynamic noise sweep
        const pinkBuffer = this._getPinkNoiseBuffer();
        if (pinkBuffer) {
            const noise = this.ctx.createBufferSource();
            noise.buffer = pinkBuffer;
            noise.loop = true;

            const bandpass = this.ctx.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.Q.setValueAtTime(2.8, now);
            // Dynamic frequency sweep simulating cloth tension and shear
            const startFreq = 1400;
            const peakFreq = 3400 + intensity * 1800; // up to 5200 Hz
            bandpass.frequency.setValueAtTime(startFreq, now);
            bandpass.frequency.linearRampToValueAtTime(peakFreq, now + duration * 0.5);
            bandpass.frequency.linearRampToValueAtTime(startFreq * 1.2, now + duration);

            const env = this.ctx.createGain();
            env.gain.setValueAtTime(0.0001, now);
            env.gain.linearRampToValueAtTime(amp * 0.5, now + 0.025);
            env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            noise.connect(bandpass);
            bandpass.connect(env);
            env.connect(out);

            noise.start(now);
            noise.stop(now + duration + 0.01);
            this._cleanupNode(noise, env);
        }

        // Layer 2: High-frequency buckle/strap flutter
        const whiteBuffer = this._getWhiteNoiseBuffer();
        if (whiteBuffer) {
            const flutter = this.ctx.createBufferSource();
            flutter.buffer = whiteBuffer;
            flutter.loop = true;

            const highpass = this.ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.setValueAtTime(3600, now);

            const flutterEnv = this.ctx.createGain();
            flutterEnv.gain.setValueAtTime(0.0001, now);
            // Flutter envelope: two distinct rustle peaks
            flutterEnv.gain.linearRampToValueAtTime(amp * 0.35, now + 0.03);
            flutterEnv.gain.linearRampToValueAtTime(amp * 0.15, now + duration * 0.45);
            flutterEnv.gain.linearRampToValueAtTime(amp * 0.3, now + duration * 0.65);
            flutterEnv.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            flutter.connect(highpass);
            highpass.connect(flutterEnv);
            flutterEnv.connect(out);

            flutter.start(now);
            flutter.stop(now + duration + 0.01);
            this._cleanupNode(flutter, flutterEnv);
        }

        return {
            played: true,
            type: 'gear_rustle',
            duration,
            effectiveVelocity: intensity,
            effectiveVolume: amp
        };
    }

    /**
     * Play tactical jump launch:
     * Quick fabric tension sweep + boot push-off transient with surface traction.
     *
     * @param {JumpLaunchOptions} [options={}]
     * @returns {FoleyPlaybackResult}
     */
    playJumpLaunch(options = {}) {
        const velocity = typeof options.velocity === 'number' ? Math.max(0.1, Math.min(2.0, options.velocity)) : 1.0;
        const canonicalSurface = ProceduralFoleySynth.normalizeSurface(options.surface);
        const baseVolume = typeof options.volume === 'number' ? Math.max(0, options.volume) : 1.0;
        const amp = baseVolume * Math.min(1.6, 0.4 + velocity * 0.6);
        const duration = 0.16;

        if (!this._ensureReady()) {
            return {
                played: false,
                reason: 'audio-context-unavailable',
                type: 'jump_launch',
                surface: canonicalSurface,
                duration,
                effectiveVelocity: velocity,
                effectiveVolume: amp
            };
        }

        const now = typeof options.time === 'number' ? options.time : (this.ctx.currentTime || 0);
        const out = this._createPanner(options.pan, now);

        // 1. Quick fabric tension (tight bandpass noise sweep upwards)
        const whiteBuffer = this._getWhiteNoiseBuffer();
        if (whiteBuffer) {
            const fabric = this.ctx.createBufferSource();
            fabric.buffer = whiteBuffer;
            fabric.loop = true;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.Q.setValueAtTime(2.6, now);
            filter.frequency.setValueAtTime(750, now);
            filter.frequency.exponentialRampToValueAtTime(2400 + velocity * 500, now + 0.08);

            const fabricGain = this.ctx.createGain();
            fabricGain.gain.setValueAtTime(0.0001, now);
            fabricGain.gain.linearRampToValueAtTime(amp * 0.45, now + 0.015);
            fabricGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

            fabric.connect(filter);
            filter.connect(fabricGain);
            fabricGain.connect(out);

            fabric.start(now);
            fabric.stop(now + 0.12);
            this._cleanupNode(fabric, fabricGain);
        }

        // 2. Boot push (low-frequency kinetic thrust)
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(65, now);
        osc.frequency.linearRampToValueAtTime(130, now + 0.025);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.09);

        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(0.0001, now);
        oscGain.gain.linearRampToValueAtTime(amp * 0.6, now + 0.008);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);

        osc.connect(oscGain);
        oscGain.connect(out);

        osc.start(now);
        osc.stop(now + 0.10);
        this._cleanupNode(osc, oscGain);

        // 3. Surface traction scuff
        this._synthPushScuff(now, out, amp, canonicalSurface, velocity);

        return {
            played: true,
            type: 'jump_launch',
            surface: canonicalSurface,
            duration,
            effectiveVelocity: velocity,
            effectiveVolume: amp
        };
    }

    /**
     * Play tactical jump land:
     * Heavy impact thump + surface crunch + gear rattle.
     * Dynamic velocity scaling based on impact velocity (e.g. drop height).
     *
     * @param {SurfaceType|string} [surface='concrete']
     * @param {JumpLandOptions} [options={}]
     * @returns {FoleyPlaybackResult}
     */
    playJumpLand(surface = 'concrete', options = {}) {
        const canonical = ProceduralFoleySynth.normalizeSurface(surface);
        const impact = typeof options.impactVelocity === 'number' ? Math.max(0.2, Math.min(2.5, options.impactVelocity)) : 1.0;
        const baseVolume = typeof options.volume === 'number' ? Math.max(0, options.volume) : 1.0;
        const amp = baseVolume * Math.min(1.8, 0.45 + impact * 0.7);
        const duration = 0.28;

        if (!this._ensureReady()) {
            return {
                played: false,
                reason: 'audio-context-unavailable',
                type: 'jump_land',
                surface: canonical,
                duration,
                effectiveVelocity: impact,
                effectiveVolume: amp
            };
        }

        const now = typeof options.time === 'number' ? options.time : (this.ctx.currentTime || 0);
        const out = this._createPanner(options.pan, now);

        // 1. Heavy impact thump (sub-bass drop + body saturation)
        const subOsc = this.ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(175 + impact * 20, now);
        subOsc.frequency.exponentialRampToValueAtTime(32, now + 0.22);

        const subGain = this.ctx.createGain();
        subGain.gain.setValueAtTime(0.0001, now);
        subGain.gain.linearRampToValueAtTime(amp * 0.95, now + 0.004);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

        subOsc.connect(subGain);
        subGain.connect(out);

        subOsc.start(now);
        subOsc.stop(now + 0.25);
        this._cleanupNode(subOsc, subGain);

        // Mid thump punch
        const punchOsc = this.ctx.createOscillator();
        punchOsc.type = 'triangle';
        punchOsc.frequency.setValueAtTime(110, now);
        punchOsc.frequency.exponentialRampToValueAtTime(45, now + 0.08);

        const punchGain = this.ctx.createGain();
        punchGain.gain.setValueAtTime(0.0001, now);
        punchGain.gain.linearRampToValueAtTime(amp * 0.5, now + 0.003);
        punchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

        punchOsc.connect(punchGain);
        punchGain.connect(out);

        punchOsc.start(now);
        punchOsc.stop(now + 0.10);
        this._cleanupNode(punchOsc, punchGain);

        // 2. Surface crunch (heightened surface footstep with dual boot spread)
        this.playFootstep(canonical, {
            velocity: Math.min(1.6, impact * 1.2),
            sprint: true,
            volume: baseVolume * 0.9,
            time: now
        });

        // 3. Tactical gear rattle (staggered micro-bursts of metallic/buckle clatter)
        this._synthGearRattle(now, out, amp, impact);

        return {
            played: true,
            type: 'jump_land',
            surface: canonical,
            duration,
            effectiveVelocity: impact,
            effectiveVolume: amp
        };
    }

    // =========================================================================
    //  Internal Surface Synthesis Algorithms
    // =========================================================================

    /**
     * Synthesizes dirt/soil footstep:
     * Soft low-frequency crunch with damped noise puff.
     * @private
     */
    _synthDirtFootstep(t, out, amp, velocity, isSprint) {
        const duration = 0.14;

        // 1. Soft low-frequency crunch/thump
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        const startFreq = 85 + velocity * 25;
        osc.frequency.setValueAtTime(startFreq, t);
        osc.frequency.exponentialRampToValueAtTime(36, t + 0.07);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(160 + velocity * 50, t);

        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(0.0001, t);
        oscGain.gain.linearRampToValueAtTime(amp * 0.45, t + 0.003);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);

        osc.connect(filter);
        filter.connect(oscGain);
        oscGain.connect(out);

        osc.start(t);
        osc.stop(t + 0.08);
        this._cleanupNode(osc, oscGain);

        // 2. Damped noise puff (muffled pink noise displaced under sole)
        const pinkBuffer = this._getPinkNoiseBuffer();
        if (pinkBuffer) {
            const puff = this.ctx.createBufferSource();
            puff.buffer = pinkBuffer;
            puff.loop = true;

            const puffBp = this.ctx.createBiquadFilter();
            puffBp.type = 'bandpass';
            puffBp.frequency.setValueAtTime(460 + velocity * 110, t);
            puffBp.Q.setValueAtTime(1.2, t);

            const puffLp = this.ctx.createBiquadFilter();
            puffLp.type = 'lowpass';
            puffLp.frequency.setValueAtTime(1150, t);

            const puffGain = this.ctx.createGain();
            puffGain.gain.setValueAtTime(0.0001, t);
            puffGain.gain.linearRampToValueAtTime(amp * 0.38, t + 0.008);
            puffGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

            puff.connect(puffBp);
            puffBp.connect(puffLp);
            puffLp.connect(puffGain);
            puffGain.connect(out);

            puff.start(t);
            puff.stop(t + 0.14);
            this._cleanupNode(puff, puffGain);
        }

        // 3. Tactile soil grain crunch
        const whiteBuffer = this._getWhiteNoiseBuffer();
        if (whiteBuffer) {
            const crunch = this.ctx.createBufferSource();
            crunch.buffer = whiteBuffer;
            crunch.loop = true;

            const crunchBp = this.ctx.createBiquadFilter();
            crunchBp.type = 'bandpass';
            crunchBp.frequency.setValueAtTime(880 + (Math.random() * 140), t);
            crunchBp.Q.setValueAtTime(2.2, t);

            const crunchGain = this.ctx.createGain();
            crunchGain.gain.setValueAtTime(0.0001, t);
            crunchGain.gain.linearRampToValueAtTime(amp * (isSprint ? 0.28 : 0.18), t + 0.002);
            crunchGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

            crunch.connect(crunchBp);
            crunchBp.connect(crunchGain);
            crunchGain.connect(out);

            crunch.start(t);
            crunch.stop(t + 0.05);
            this._cleanupNode(crunch, crunchGain);
        }

        return duration;
    }

    /**
     * Synthesizes gravel/rubble footstep:
     * Crunchy granular noise bursts with distinct tiny stone clatters.
     * @private
     */
    _synthGravelFootstep(t, out, amp, velocity, isSprint) {
        const duration = 0.17;

        // 1. Heel/sole ground contact
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(115, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.05);

        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(0.0001, t);
        oscGain.gain.linearRampToValueAtTime(amp * 0.32, t + 0.002);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

        osc.connect(oscGain);
        oscGain.connect(out);

        osc.start(t);
        osc.stop(t + 0.06);
        this._cleanupNode(osc, oscGain);

        // 2. Crunchy granular noise bursts (2 micro-bursts of stone crushing)
        const whiteBuffer = this._getWhiteNoiseBuffer();
        if (whiteBuffer) {
            // Burst 1: Initial compression
            const b1 = this.ctx.createBufferSource();
            b1.buffer = whiteBuffer;
            b1.loop = true;

            const bp1 = this.ctx.createBiquadFilter();
            bp1.type = 'bandpass';
            bp1.frequency.setValueAtTime(1550, t);
            bp1.Q.setValueAtTime(2.1, t);

            const g1 = this.ctx.createGain();
            g1.gain.setValueAtTime(0.0001, t);
            g1.gain.linearRampToValueAtTime(amp * 0.36, t + 0.002);
            g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

            b1.connect(bp1);
            bp1.connect(g1);
            g1.connect(out);
            b1.start(t);
            b1.stop(t + 0.055);
            this._cleanupNode(b1, g1);

            // Burst 2: Staggered secondary stone shift (+22ms)
            const b2 = this.ctx.createBufferSource();
            b2.buffer = whiteBuffer;
            b2.loop = true;

            const bp2 = this.ctx.createBiquadFilter();
            bp2.type = 'bandpass';
            bp2.frequency.setValueAtTime(2200, t + 0.022);
            bp2.Q.setValueAtTime(2.4, t + 0.022);

            const g2 = this.ctx.createGain();
            g2.gain.setValueAtTime(0.0001, t);
            g2.gain.setValueAtTime(0.0001, t + 0.020);
            g2.gain.linearRampToValueAtTime(amp * 0.28, t + 0.024);
            g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);

            b2.connect(bp2);
            bp2.connect(g2);
            g2.connect(out);
            b2.start(t + 0.02);
            b2.stop(t + 0.08);
            this._cleanupNode(b2, g2);
        }

        // 3. Distinct tiny stone clatters (scattered micro-transients)
        const clatterCount = isSprint ? 6 : 4;
        const clatterBaseOffsets = [0.012, 0.028, 0.048, 0.072, 0.102, 0.135];

        for (let i = 0; i < clatterCount; i++) {
            const offset = clatterBaseOffsets[i] + (Math.random() * 0.008 - 0.004);
            const clatterTime = t + Math.max(0.005, offset);
            const clatterFreq = 2200 + Math.random() * 2400; // 2.2 kHz - 4.6 kHz

            const stoneOsc = this.ctx.createOscillator();
            stoneOsc.type = 'triangle';
            stoneOsc.frequency.setValueAtTime(clatterFreq, clatterTime);

            const stoneGain = this.ctx.createGain();
            stoneGain.gain.setValueAtTime(0.0001, t);
            stoneGain.gain.setValueAtTime(0.0001, clatterTime);
            stoneGain.gain.linearRampToValueAtTime(amp * (0.08 + Math.random() * 0.12), clatterTime + 0.001);
            stoneGain.gain.exponentialRampToValueAtTime(0.0001, clatterTime + 0.016 + Math.random() * 0.008);

            stoneOsc.connect(stoneGain);
            stoneGain.connect(out);

            stoneOsc.start(clatterTime);
            stoneOsc.stop(clatterTime + 0.028);
            this._cleanupNode(stoneOsc, stoneGain);
        }

        return duration;
    }

    /**
     * Synthesizes metal/gantry footstep:
     * Resonant metallic ping with hollow clang and short decay.
     * @private
     */
    _synthMetalFootstep(t, out, amp, velocity, isSprint) {
        const duration = 0.15;

        // 1. Sharp metallic strike transient
        const whiteBuffer = this._getWhiteNoiseBuffer();
        if (whiteBuffer) {
            const tap = this.ctx.createBufferSource();
            tap.buffer = whiteBuffer;
            tap.loop = true;

            const hp = this.ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.setValueAtTime(2800, t);

            const tapGain = this.ctx.createGain();
            tapGain.gain.setValueAtTime(0.0001, t);
            tapGain.gain.linearRampToValueAtTime(amp * 0.42, t + 0.001);
            tapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);

            tap.connect(hp);
            hp.connect(tapGain);
            tapGain.connect(out);

            tap.start(t);
            tap.stop(t + 0.015);
            this._cleanupNode(tap, tapGain);
        }

        // 2. Resonant metallic ping (high-frequency ringing)
        const pingOsc = this.ctx.createOscillator();
        pingOsc.type = 'sine';
        const pingFreq = 2450 + (Math.random() * 180 - 90);
        pingOsc.frequency.setValueAtTime(pingFreq, t);

        const pingGain = this.ctx.createGain();
        pingGain.gain.setValueAtTime(0.0001, t);
        pingGain.gain.linearRampToValueAtTime(amp * (isSprint ? 0.38 : 0.28), t + 0.001);
        pingGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

        pingOsc.connect(pingGain);
        pingGain.connect(out);

        pingOsc.start(t);
        pingOsc.stop(t + 0.12);
        this._cleanupNode(pingOsc, pingGain);

        // 3. Hollow clang (inharmonic modal synthesis with short decay)
        const baseFreq = 380 + (Math.random() * 24 - 12);
        const partials = [
            { mult: 1.0, gainMult: 0.32, decay: 0.12 },
            { mult: 1.414, gainMult: 0.24, decay: 0.09 }, // tritone gantry mode
            { mult: 2.18, gainMult: 0.16, decay: 0.07 },  // plate mode
            { mult: 3.25, gainMult: 0.10, decay: 0.05 }   // rim overtone
        ];

        const hollowFilter = this.ctx.createBiquadFilter();
        hollowFilter.type = 'bandpass';
        hollowFilter.frequency.setValueAtTime(900, t);
        hollowFilter.Q.setValueAtTime(2.0, t);
        hollowFilter.connect(out);

        for (const p of partials) {
            const pOsc = this.ctx.createOscillator();
            pOsc.type = 'triangle';
            pOsc.frequency.setValueAtTime(baseFreq * p.mult, t);

            const pGain = this.ctx.createGain();
            pGain.gain.setValueAtTime(0.0001, t);
            pGain.gain.linearRampToValueAtTime(amp * p.gainMult, t + 0.002);
            pGain.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);

            pOsc.connect(pGain);
            pGain.connect(hollowFilter);

            pOsc.start(t);
            pOsc.stop(t + p.decay + 0.01);
            this._cleanupNode(pOsc, pGain);
        }

        return duration;
    }

    /**
     * Synthesizes concrete footstep:
     * Sharp solid slap transient with high-frequency reflection.
     * @private
     */
    _synthConcreteFootstep(t, out, amp, velocity, isSprint) {
        const duration = 0.13;

        // 1. Sharp solid slap transient (highpass snap + sole slap pitch drop)
        const whiteBuffer = this._getWhiteNoiseBuffer();
        if (whiteBuffer) {
            const snap = this.ctx.createBufferSource();
            snap.buffer = whiteBuffer;
            snap.loop = true;

            const snapHp = this.ctx.createBiquadFilter();
            snapHp.type = 'highpass';
            snapHp.frequency.setValueAtTime(2400, t);

            const snapGain = this.ctx.createGain();
            snapGain.gain.setValueAtTime(0.0001, t);
            snapGain.gain.linearRampToValueAtTime(amp * (isSprint ? 0.52 : 0.42), t + 0.001);
            snapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);

            snap.connect(snapHp);
            snapHp.connect(snapGain);
            snapGain.connect(out);

            snap.start(t);
            snap.stop(t + 0.032);
            this._cleanupNode(snap, snapGain);
        }

        // Sole slap pitch drop (rubber-on-concrete snap)
        const slapOsc = this.ctx.createOscillator();
        slapOsc.type = 'sine';
        slapOsc.frequency.setValueAtTime(340, t);
        slapOsc.frequency.exponentialRampToValueAtTime(80, t + 0.022);

        const slapGain = this.ctx.createGain();
        slapGain.gain.setValueAtTime(0.0001, t);
        slapGain.gain.linearRampToValueAtTime(amp * 0.45, t + 0.001);
        slapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);

        slapOsc.connect(slapGain);
        slapGain.connect(out);

        slapOsc.start(t);
        slapOsc.stop(t + 0.04);
        this._cleanupNode(slapOsc, slapGain);

        // 2. Solid body thump (firm concrete floor weight)
        const thumpOsc = this.ctx.createOscillator();
        thumpOsc.type = 'sine';
        thumpOsc.frequency.setValueAtTime(115, t);
        thumpOsc.frequency.exponentialRampToValueAtTime(50, t + 0.045);

        const thumpGain = this.ctx.createGain();
        thumpGain.gain.setValueAtTime(0.0001, t);
        thumpGain.gain.linearRampToValueAtTime(amp * 0.35, t + 0.002);
        thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);

        thumpOsc.connect(thumpGain);
        thumpGain.connect(out);

        thumpOsc.start(t);
        thumpOsc.stop(t + 0.052);
        this._cleanupNode(thumpOsc, thumpGain);

        // 3. High-frequency reflection (early slapback bounce delayed by 14ms)
        if (whiteBuffer) {
            const refl = this.ctx.createBufferSource();
            refl.buffer = whiteBuffer;
            refl.loop = true;

            const reflBp = this.ctx.createBiquadFilter();
            reflBp.type = 'bandpass';
            reflBp.frequency.setValueAtTime(4800, t + 0.014);
            reflBp.Q.setValueAtTime(2.5, t + 0.014);

            const reflGain = this.ctx.createGain();
            reflGain.gain.setValueAtTime(0.0001, t);
            reflGain.gain.setValueAtTime(0.0001, t + 0.013);
            reflGain.gain.linearRampToValueAtTime(amp * 0.22, t + 0.015);
            reflGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);

            refl.connect(reflBp);
            reflBp.connect(reflGain);
            reflGain.connect(out);

            refl.start(t + 0.013);
            refl.stop(t + 0.052);
            this._cleanupNode(refl, reflGain);
        }

        return duration;
    }

    /**
     * Synthesize push scuff for jump launch.
     * @private
     */
    _synthPushScuff(t, out, amp, surface, velocity) {
        const whiteBuffer = this._getWhiteNoiseBuffer();
        if (!whiteBuffer) return;

        const scuff = this.ctx.createBufferSource();
        scuff.buffer = whiteBuffer;
        scuff.loop = true;

        const filter = this.ctx.createBiquadFilter();
        let freq = 1600;
        let q = 2.0;

        if (surface === 'dirt') {
            filter.type = 'lowpass';
            freq = 600;
        } else if (surface === 'gravel') {
            filter.type = 'bandpass';
            freq = 2100;
            q = 2.5;
        } else if (surface === 'metal') {
            filter.type = 'bandpass';
            freq = 2800;
            q = 3.5;
        } else {
            filter.type = 'bandpass';
            freq = 1500;
            q = 1.8;
        }

        filter.frequency.setValueAtTime(freq, t);
        filter.Q.setValueAtTime(q, t);

        const scuffGain = this.ctx.createGain();
        scuffGain.gain.setValueAtTime(0.0001, t);
        scuffGain.gain.linearRampToValueAtTime(amp * 0.35, t + 0.005);
        scuffGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

        scuff.connect(filter);
        filter.connect(scuffGain);
        scuffGain.connect(out);

        scuff.start(t);
        scuff.stop(t + 0.055);
        this._cleanupNode(scuff, scuffGain);
    }

    /**
     * Synthesize tactical gear rattle on jump landing.
     * @private
     */
    _synthGearRattle(t, out, amp, impact) {
        const count = Math.min(9, Math.floor(5 + impact * 2.5));
        const rattleTimes = [0.025, 0.045, 0.070, 0.095, 0.125, 0.155, 0.185, 0.210, 0.235];

        for (let i = 0; i < count; i++) {
            const rTime = t + rattleTimes[i] + (Math.random() * 0.01 - 0.005);
            const freq = 3000 + Math.random() * 2400; // 3.0 kHz - 5.4 kHz inharmonic metallic clicks

            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, rTime);

            const rGain = this.ctx.createGain();
            rGain.gain.setValueAtTime(0.0001, t);
            rGain.gain.setValueAtTime(0.0001, rTime);
            rGain.gain.linearRampToValueAtTime(amp * (0.09 + Math.random() * 0.14), rTime + 0.001);
            rGain.gain.exponentialRampToValueAtTime(0.0001, rTime + 0.022);

            osc.connect(rGain);
            rGain.connect(out);

            osc.start(rTime);
            osc.stop(rTime + 0.026);
            this._cleanupNode(osc, rGain);
        }
    }

    // =========================================================================
    //  Helper Methods
    // =========================================================================

    /**
     * Ensure AudioContext is ready for playback.
     * @private
     * @returns {boolean}
     */
    _ensureReady() {
        return Boolean(this.isSupported && this.ctx && this.masterGain);
    }

    /**
     * Route through an optional stereo panner.
     * @private
     * @param {number} [pan=0]
     * @param {number} [now=0]
     * @returns {any}
     */
    _createPanner(pan = 0, now = 0) {
        const clampedPan = Math.max(-1, Math.min(1, typeof pan === 'number' ? pan : 0));
        if (this.ctx && typeof this.ctx.createStereoPanner === 'function' && clampedPan !== 0) {
            try {
                const panner = this.ctx.createStereoPanner();
                panner.pan.setValueAtTime(clampedPan, now);
                panner.connect(this.masterGain);
                return panner;
            } catch {
                return this.masterGain;
            }
        }
        return this.masterGain;
    }

    /**
     * Retrieve or generate a 2-second white noise AudioBuffer.
     * @private
     * @returns {any}
     */
    _getWhiteNoiseBuffer() {
        if (this._whiteNoiseBuffer) return this._whiteNoiseBuffer;
        if (!this.ctx || typeof this.ctx.createBuffer !== 'function') return null;

        try {
            const sRate = this.ctx.sampleRate || 44100;
            const length = Math.max(1, Math.floor(sRate * 2.0));
            const buffer = this.ctx.createBuffer(1, length, sRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            this._whiteNoiseBuffer = buffer;
            return buffer;
        } catch {
            return null;
        }
    }

    /**
     * Retrieve or generate a 2-second pink noise AudioBuffer using Paul Kellet's filter.
     * @private
     * @returns {any}
     */
    _getPinkNoiseBuffer() {
        if (this._pinkNoiseBuffer) return this._pinkNoiseBuffer;
        if (!this.ctx || typeof this.ctx.createBuffer !== 'function') return null;

        try {
            const sRate = this.ctx.sampleRate || 44100;
            const length = Math.max(1, Math.floor(sRate * 2.0));
            const buffer = this.ctx.createBuffer(1, length, sRate);
            const data = buffer.getChannelData(0);
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < length; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                b6 = white * 0.115926;
            }
            this._pinkNoiseBuffer = buffer;
            return buffer;
        } catch {
            return null;
        }
    }

    /**
     * Safely disconnect completed audio nodes after playback to prevent memory leaks.
     * @private
     * @param {any} sourceNode
     * @param {any} [gainNode]
     */
    _cleanupNode(sourceNode, gainNode) {
        if (!sourceNode) return;
        sourceNode.onended = () => {
            try {
                sourceNode.disconnect();
                if (gainNode) gainNode.disconnect();
            } catch { /* ignore */ }
        };
    }
}

// Global browser window exposure
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ProceduralFoleySynth = ProceduralFoleySynth;
}

// Node.js test / CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProceduralFoleySynth };
}
