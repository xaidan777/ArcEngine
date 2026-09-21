// AudioCore.js — Procedural Audio Core for ArcEngine.
// Provides safe Web Audio context management, master bus with limiter/compressor,
// procedural algorithmic wasteland impulse responses (convolution reverb),
// pre-calculated noise buffers (white, pink, brown), and 3D spatial audio helpers.

/**
 * Configuration options for initializing ProceduralAudioCore.
 * @typedef {Object} ProceduralAudioCoreOptions
 * @property {AudioContextOptions} [contextOptions] - Options passed to the AudioContext constructor.
 * @property {number} [masterVolume=1.0] - Initial master volume (0.0 to 1.0).
 * @property {boolean} [autoUnlock=true] - Whether to automatically resume context on first user gesture.
 * @property {boolean} [autoInit=true] - Whether to instantiate AudioContext immediately if available.
 * @property {number} [reverbWet=0.18] - Default wet mix for the master wasteland reverb bus.
 * @property {number} [noiseDuration=3.0] - Duration in seconds of pre-calculated noise buffers.
 */

/**
 * Helper wrapper for an active procedural noise source.
 * @typedef {Object} ProceduralNoiseSource
 * @property {AudioBufferSourceNode} source - The active buffer source node.
 * @property {GainNode} gain - Dedicated gain node for the noise source.
 * @property {(target: AudioNode) => void} connect - Connects the noise source output to a target node.
 * @property {(when?: number) => void} play - Starts playback at the specified time.
 * @property {(when?: number) => void} stop - Stops playback at the specified time.
 */

/**
 * Extended PannerNode with convenience positioning helpers.
 * @typedef {PannerNode & {
 *   updatePosition: (x: number, y: number, z: number, rampTime?: number) => void,
 *   updateOrientation: (dx: number, dy: number, dz: number) => void,
 *   setDistanceParameters: (refDist: number, maxDist: number, rolloff?: number) => void
 * }} SpatialPannerNode
 */

class ProceduralAudioCore {
    /**
     * @param {ProceduralAudioCoreOptions} [options]
     */
    constructor(options = {}) {
        const opts = options || {};
        this.options = {
            masterVolume: typeof opts.masterVolume === 'number' ? opts.masterVolume : 1.0,
            autoUnlock: opts.autoUnlock !== false,
            autoInit: opts.autoInit !== false,
            reverbWet: typeof opts.reverbWet === 'number' ? opts.reverbWet : 0.18,
            noiseDuration: typeof opts.noiseDuration === 'number' ? opts.noiseDuration : 3.0,
            contextOptions: opts.contextOptions || { latencyHint: 'interactive' }
        };

        /** @type {AudioContext | null} */
        this.ctx = null;
        /** @type {GainNode | null} Mix bus where all sound sources feed */
        this.masterInput = null;
        /** @type {DynamicsCompressorNode | null} Master limiter and compressor */
        this.masterCompressor = null;
        /** @type {GainNode | null} Master volume fader */
        this.masterGain = null;

        /** @type {GainNode | null} Input for sounds sending to the wasteland reverb */
        this.reverbInput = null;
        /** @type {ConvolverNode | null} Algorithmic wasteland convolver */
        this.reverbConvolver = null;
        /** @type {GainNode | null} Reverb wet return gain */
        this.reverbWetGain = null;

        /** @type {{ white: AudioBuffer | null, pink: AudioBuffer | null, brown: AudioBuffer | null }} */
        this.noiseBuffers = {
            white: null,
            pink: null,
            brown: null
        };

        /** @type {number} */
        this._masterVolume = Math.max(0, Math.min(1, this.options.masterVolume));
        /** @type {boolean} */
        this._isMuted = false;
        /** @type {boolean} */
        this._gestureListenersAttached = false;
        /** @type {Set<(state: AudioContextState | string) => void>} */
        this._stateListeners = new Set();
        /** @type {EventListener | null} */
        this._boundGestureHandler = null;

        // Listener state for calculateSpatialParameters. WITHOUT this the spatial maths in
        // this class reads undefined and treats the listener as the world origin, so every
        // distant sound is either culled or panned wrongly. It must live on the CORE, because
        // that is the object whose calculateSpatialParameters decides audibility.
        /** @type {{ x: number, y: number, z: number, h?: number }} */
        this.listenerPos = { x: 0, y: 0, z: 0 };
        /** @type {{ x: number, y: number, z: number }} */
        this.listenerForward = { x: 1, y: 0, z: 0 };

        if (this.options.autoInit && ProceduralAudioCore.isSupported()) {
            this.init();
        }
    }

    /**
     * Alias getter for the active AudioContext.
     * @returns {AudioContext | null}
     */
    get audioCtx() {
        return this.ctx;
    }

    /**
     * Set the listener position (and optionally its facing) used by
     * calculateSpatialParameters. Coordinates are world (x, y) plus height (z/h), matching
     * the kit's map convention.
     * @param {number} x
     * @param {number} y
     * @param {number} [z]
     * @param {number} [forwardX]
     * @param {number} [forwardY]
     * @param {number} [forwardZ]
     */
    setListenerPosition(x, y, z = 0, forwardX, forwardY, forwardZ) {
        this.listenerPos.x = x ?? 0;
        this.listenerPos.y = y ?? 0;
        this.listenerPos.z = z ?? 0;
        if (typeof forwardX === 'number') this.listenerForward.x = forwardX;
        if (typeof forwardY === 'number') this.listenerForward.y = forwardY;
        if (typeof forwardZ === 'number') this.listenerForward.z = forwardZ;
    }

    /**
     * Checks if Web Audio API is supported in the current environment.
     * @returns {boolean}
     */
    static isSupported() {
        if (typeof window !== 'undefined') {
            return typeof window.AudioContext !== 'undefined' ||
                typeof (/** @type {any} */ (window)).webkitAudioContext !== 'undefined';
        }
        if (typeof globalThis !== 'undefined') {
            return typeof (/** @type {any} */ (globalThis)).AudioContext !== 'undefined';
        }
        return false;
    }

    /**
     * Returns the available AudioContext constructor or null.
     * @returns {typeof AudioContext | null}
     */
    static getAudioContextClass() {
        if (typeof window !== 'undefined') {
            return window.AudioContext || (/** @type {any} */ (window)).webkitAudioContext || null;
        }
        if (typeof globalThis !== 'undefined') {
            return (/** @type {any} */ (globalThis)).AudioContext || null;
        }
        return null;
    }

    /**
     * Initializes the AudioContext and master audio graph safely.
     * @param {ProceduralAudioCoreOptions} [options]
     * @returns {AudioContext | null}
     */
    init(options) {
        if (options) {
            Object.assign(this.options, options);
            if (typeof options.masterVolume === 'number') {
                this._masterVolume = Math.max(0, Math.min(1, options.masterVolume));
            }
        }

        if (this.ctx && this.ctx.state !== 'closed') {
            return this.ctx;
        }

        const AudioCtxClass = ProceduralAudioCore.getAudioContextClass();
        if (!AudioCtxClass) {
            return null;
        }

        try {
            this.ctx = new AudioCtxClass(this.options.contextOptions);
        } catch (err) {
            console.warn('ProceduralAudioCore: failed to construct AudioContext:', err);
            return null;
        }

        // Setup state change monitoring
        if (this.ctx && typeof this.ctx.addEventListener === 'function') {
            this.ctx.addEventListener('statechange', () => {
                const state = this.ctx ? this.ctx.state : 'closed';
                for (const listener of this._stateListeners) {
                    try { listener(state); } catch (e) { /* listener error */ }
                }
            });
        }

        // Build audio sub-graphs
        this._setupMasterBus();
        this._setupReverb(this.options.reverbWet);
        this._setupNoiseBuffers(this.options.noiseDuration);

        if (this.options.autoUnlock) {
            this._setupGestureUnlock();
        }

        return this.ctx;
    }

    /**
     * Sets up the master output bus:
     * masterInput -> masterCompressor (Limiter) -> masterGain -> destination.
     * @private
     */
    _setupMasterBus() {
        if (!this.ctx) return;

        // Master input bus
        this.masterInput = this.ctx.createGain();
        this.masterInput.gain.setValueAtTime(1.0, this.ctx.currentTime);

        // Master limiter / compressor to avoid digital clipping and protect dynamics
        this.masterCompressor = this.ctx.createDynamicsCompressor();
        const now = this.ctx.currentTime;
        this.masterCompressor.threshold.setValueAtTime(-1.5, now); // -1.5 dB threshold
        this.masterCompressor.knee.setValueAtTime(3.0, now);        // 3.0 dB soft knee
        this.masterCompressor.ratio.setValueAtTime(16.0, now);      // 16:1 brickwall ratio
        this.masterCompressor.attack.setValueAtTime(0.003, now);    // 3 ms fast transient attack
        this.masterCompressor.release.setValueAtTime(0.15, now);    // 150 ms smooth release

        // Master volume fader
        this.masterGain = this.ctx.createGain();
        const initialVol = this._isMuted ? 0 : this._masterVolume;
        this.masterGain.gain.setValueAtTime(initialVol, now);

        // Connect graph
        this.masterInput.connect(this.masterCompressor);
        this.masterCompressor.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
    }

    /**
     * Sets up the procedural wasteland impulse response and convolver node.
     * @param {number} wetMix
     * @private
     */
    _setupReverb(wetMix) {
        if (!this.ctx || !this.masterInput) return;

        try {
            this.reverbInput = this.ctx.createGain();
            this.reverbInput.gain.setValueAtTime(1.0, this.ctx.currentTime);

            this.reverbConvolver = this.ctx.createConvolver();
            this.reverbConvolver.buffer = ProceduralAudioCore.generateWastelandIR(this.ctx);

            this.reverbWetGain = this.ctx.createGain();
            this.reverbWetGain.gain.setValueAtTime(Math.max(0, Math.min(1, wetMix)), this.ctx.currentTime);

            this.reverbInput.connect(this.reverbConvolver);
            this.reverbConvolver.connect(this.reverbWetGain);
            this.reverbWetGain.connect(this.masterInput);
        } catch (err) {
            console.warn('ProceduralAudioCore: failed to setup algorithmic reverb:', err);
        }
    }

    /**
     * Pre-calculates reusable noise buffers for white, pink, and brown noise.
     * @param {number} duration
     * @private
     */
    _setupNoiseBuffers(duration) {
        if (!this.ctx) return;
        try {
            this.noiseBuffers.white = ProceduralAudioCore.generateNoiseBuffer(this.ctx, 'white', duration);
            this.noiseBuffers.pink = ProceduralAudioCore.generateNoiseBuffer(this.ctx, 'pink', duration);
            this.noiseBuffers.brown = ProceduralAudioCore.generateNoiseBuffer(this.ctx, 'brown', duration);
        } catch (err) {
            console.warn('ProceduralAudioCore: failed to generate noise buffers:', err);
        }
    }

    /**
     * Sets up user gesture event listeners to resume suspended audio contexts.
     * @private
     */
    _setupGestureUnlock() {
        if (this._gestureListenersAttached || !this.ctx) return;
        if (typeof window === 'undefined' && typeof document === 'undefined') return;

        const target = typeof document !== 'undefined' ? document : (typeof window !== 'undefined' ? window : null);
        if (!target || typeof target.addEventListener !== 'function') return;

        const unlockEvents = ['click', 'keydown', 'touchstart', 'touchend', 'pointerdown'];
        this._boundGestureHandler = () => {
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().then(() => {
                    if (this.ctx && this.ctx.state === 'running') {
                        this._removeGestureUnlock();
                    }
                }).catch(() => {});
            } else if (this.ctx && this.ctx.state === 'running') {
                this._removeGestureUnlock();
            }
        };

        for (const ev of unlockEvents) {
            target.addEventListener(ev, this._boundGestureHandler, { passive: true, capture: true });
        }
        this._gestureListenersAttached = true;
    }

    /**
     * Removes user gesture listeners once the audio context has successfully resumed.
     * @private
     */
    _removeGestureUnlock() {
        if (!this._gestureListenersAttached || !this._boundGestureHandler) return;
        const target = typeof document !== 'undefined' ? document : (typeof window !== 'undefined' ? window : null);
        if (target && typeof target.removeEventListener === 'function') {
            const unlockEvents = ['click', 'keydown', 'touchstart', 'touchend', 'pointerdown'];
            for (const ev of unlockEvents) {
                target.removeEventListener(ev, this._boundGestureHandler, { capture: true });
            }
        }
        this._gestureListenersAttached = false;
        this._boundGestureHandler = null;
    }

    /**
     * Resumes the AudioContext safely. Can be called directly from user event handlers.
     * @returns {Promise<boolean>} True if running.
     */
    async resume() {
        if (!this.ctx) {
            this.init();
        }
        if (!this.ctx) return false;

        if (this.ctx.state === 'suspended') {
            try {
                await this.ctx.resume();
            } catch (err) {
                return false;
            }
        }
        const isRunning = this.ctx.state === 'running';
        if (isRunning) {
            this._removeGestureUnlock();
        }
        return isRunning;
    }

    /**
     * Suspends the AudioContext safely.
     * @returns {Promise<boolean>}
     */
    async suspend() {
        if (!this.ctx || this.ctx.state !== 'running') return false;
        try {
            await this.ctx.suspend();
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Closes the AudioContext and releases audio graph resources.
     * @returns {Promise<void>}
     */
    async close() {
        this._removeGestureUnlock();
        if (this.ctx && this.ctx.state !== 'closed') {
            try {
                await this.ctx.close();
            } catch (e) { /* ignore */ }
        }
        this.ctx = null;
        this.masterInput = null;
        this.masterCompressor = null;
        this.masterGain = null;
        this.reverbInput = null;
        this.reverbConvolver = null;
        this.reverbWetGain = null;
    }

    /**
     * Returns the current lifecycle state of the AudioContext.
     * @returns {AudioContextState | 'uninitialized' | 'unsupported'}
     */
    getState() {
        if (!this.ctx) {
            return ProceduralAudioCore.isSupported() ? 'uninitialized' : 'unsupported';
        }
        return this.ctx.state;
    }

    /**
     * Subscribes to AudioContext state change events.
     * @param {(state: AudioContextState | string) => void} callback
     * @returns {() => void} Unsubscribe function.
     */
    onStateChange(callback) {
        this._stateListeners.add(callback);
        return () => this._stateListeners.delete(callback);
    }

    // =========================================================================
    //  Master Volume Controls
    // =========================================================================

    /**
     * Gets the master volume (between 0.0 and 1.0).
     * @returns {number}
     */
    getMasterVolume() {
        return this._masterVolume;
    }

    /**
     * Sets the master volume smoothly with ramping.
     * @param {number} volume - Volume between 0.0 and 1.0.
     * @param {number} [rampTime=0.05] - Transition duration in seconds.
     */
    setMasterVolume(volume, rampTime = 0.05) {
        const clamped = Math.max(0, Math.min(1, volume));
        this._masterVolume = clamped;

        if (this._isMuted || !this.ctx || !this.masterGain) return;

        const now = this.ctx.currentTime;
        const currentGain = this.masterGain.gain.value;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(currentGain, now);
        this.masterGain.gain.linearRampToValueAtTime(clamped, now + Math.max(0.001, rampTime));
    }

    /**
     * Smoothly mutes the master bus.
     * @param {number} [rampTime=0.05] - Transition duration in seconds.
     */
    mute(rampTime = 0.05) {
        if (this._isMuted) return;
        this._isMuted = true;
        if (!this.ctx || !this.masterGain) return;

        const now = this.ctx.currentTime;
        const currentGain = this.masterGain.gain.value;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(currentGain, now);
        this.masterGain.gain.linearRampToValueAtTime(0, now + Math.max(0.001, rampTime));
    }

    /**
     * Smoothly restores previous master volume after being muted.
     * @param {number} [rampTime=0.05] - Transition duration in seconds.
     */
    unmute(rampTime = 0.05) {
        if (!this._isMuted) return;
        this._isMuted = false;
        if (!this.ctx || !this.masterGain) return;

        const now = this.ctx.currentTime;
        const currentGain = this.masterGain.gain.value;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(currentGain, now);
        this.masterGain.gain.linearRampToValueAtTime(this._masterVolume, now + Math.max(0.001, rampTime));
    }

    /**
     * Toggles mute state.
     * @param {number} [rampTime=0.05]
     * @returns {boolean} New mute state.
     */
    toggleMute(rampTime = 0.05) {
        if (this._isMuted) {
            this.unmute(rampTime);
        } else {
            this.mute(rampTime);
        }
        return this._isMuted;
    }

    /**
     * Whether master output is currently muted.
     * @returns {boolean}
     */
    get isMuted() {
        return this._isMuted;
    }

    // =========================================================================
    //  Algorithmic Reverb: Procedural Wasteland Impulse Response
    // =========================================================================

    /**
     * Generates a procedural impulse response AudioBuffer simulating an outdoor wasteland:
     * open-space early reflections with wide stereo spread, low-density sparse reflections,
     * and a natural high-frequency air-damping tail.
     *
     * @param {AudioContext | BaseAudioContext} audioCtx
     * @param {Object} [options]
     * @param {number} [options.duration=2.2] - Reverb length in seconds.
     * @param {number} [options.decay=2.4] - Exponential tail decay rate.
     * @param {number} [options.preDelay=0.028] - Pre-delay before reflections arrive (seconds).
     * @param {number} [options.damping=0.6] - Air absorption factor (higher = faster high-frequency roll-off).
     * @param {number} [options.sampleRate] - Buffer sample rate (defaults to audioCtx.sampleRate).
     * @returns {AudioBuffer}
     */
    static generateWastelandIR(audioCtx, options = {}) {
        if (!audioCtx || typeof audioCtx.createBuffer !== 'function') {
            throw new Error('generateWastelandIR requires an AudioContext with createBuffer');
        }

        const duration = Math.max(0.2, options.duration || 2.2);
        const decay = Math.max(0.1, options.decay || 2.4);
        const preDelay = Math.max(0, options.preDelay !== undefined ? options.preDelay : 0.028);
        const damping = Math.max(0.1, Math.min(0.95, options.damping || 0.6));
        const sampleRate = options.sampleRate || audioCtx.sampleRate || 44100;
        const totalSamples = Math.floor(duration * sampleRate);
        const preDelaySamples = Math.floor(preDelay * sampleRate);

        // 2-channel stereo impulse response for realistic spatial width
        const buffer = audioCtx.createBuffer(2, totalSamples, sampleRate);
        const leftData = buffer.getChannelData(0);
        const rightData = buffer.getChannelData(1);

        // Wasteland open-space discrete early reflections (sparse distant terrain & ruins)
        const earlyTaps = [
            { time: 0.032, gainL: 0.38, gainR: 0.18 },
            { time: 0.054, gainL: 0.22, gainR: 0.35 },
            { time: 0.081, gainL: 0.28, gainR: 0.15 },
            { time: 0.115, gainL: 0.14, gainR: 0.25 },
            { time: 0.158, gainL: 0.18, gainR: 0.12 },
            { time: 0.210, gainL: 0.09, gainR: 0.16 },
            { time: 0.275, gainL: 0.11, gainR: 0.08 },
            { time: 0.340, gainL: 0.06, gainR: 0.09 }
        ];

        // 1-pole lowpass filter states for progressive air damping across time
        let lpLeft = 0;
        let lpRight = 0;

        for (let i = 0; i < totalSamples; i++) {
            if (i < preDelaySamples) {
                leftData[i] = 0;
                rightData[i] = 0;
                continue;
            }

            const t = (i - preDelaySamples) / sampleRate;
            // Exponential energy decay envelope
            const envelope = Math.exp(-decay * t);

            // Progressive air absorption: open-space air dampens high frequencies over distance.
            // Cutoff sweeps downwards from ~8500 Hz down to ~450 Hz.
            const currentCutoff = 450 + (8500 - 450) * Math.exp(-damping * 4.0 * (t / duration));
            const lpCoeff = Math.exp(-2 * Math.PI * currentCutoff / sampleRate);

            // Raw stereo white noise excitation for late diffuse reverberation
            const noiseL = (Math.random() * 2 - 1);
            const noiseR = (Math.random() * 2 - 1);

            lpLeft = lpLeft * lpCoeff + noiseL * (1 - lpCoeff);
            lpRight = lpRight * lpCoeff + noiseR * (1 - lpCoeff);

            leftData[i] = lpLeft * envelope * 0.45;
            rightData[i] = lpRight * envelope * 0.45;
        }

        // Overlay early reflection impulses
        for (const tap of earlyTaps) {
            const index = Math.floor(tap.time * sampleRate);
            if (index < totalSamples) {
                leftData[index] += tap.gainL;
                rightData[index] += tap.gainR;
            }
        }

        // Peak normalization with headroom to prevent convolution clipping
        let peak = 0;
        for (let i = 0; i < totalSamples; i++) {
            const absL = Math.abs(leftData[i]);
            const absR = Math.abs(rightData[i]);
            if (absL > peak) peak = absL;
            if (absR > peak) peak = absR;
        }

        if (peak > 0) {
            const targetPeak = 0.65;
            const normScale = targetPeak / peak;
            for (let i = 0; i < totalSamples; i++) {
                leftData[i] *= normScale;
                rightData[i] *= normScale;
            }
        }

        return buffer;
    }

    /**
     * Connects an audio node as a send to the wasteland algorithmic reverb.
     * @param {AudioNode} sourceNode - The source node sending signal to reverb.
     * @param {number} [sendAmount=0.2] - Send level (0.0 to 1.0).
     * @returns {GainNode | null} The created send gain node, or null if reverb unavailable.
     */
    sendToReverb(sourceNode, sendAmount = 0.2) {
        if (!this.ctx || !this.reverbInput || !sourceNode) return null;
        const sendGain = this.ctx.createGain();
        sendGain.gain.setValueAtTime(Math.max(0, Math.min(1, sendAmount)), this.ctx.currentTime);
        sourceNode.connect(sendGain);
        sendGain.connect(this.reverbInput);
        return sendGain;
    }

    // =========================================================================
    //  Procedural Noise Buffers (White, Pink, Brown)
    // =========================================================================

    /**
     * Generates a pre-calculated reusable AudioBuffer for White, Pink, or Brown noise.
     *
     * - White Noise: Uniform flat spectrum across all frequencies.
     * - Pink Noise: 1/f filter (-3 dB/octave falloff) using Paul Kellet's refined 6-pole filter.
     * - Brown/Brownian Noise: 1/f^2 integrated noise (-6 dB/octave falloff) via leaky integration.
     *
     * @param {AudioContext | BaseAudioContext} audioCtx
     * @param {'white' | 'pink' | 'brown'} type - Type of noise to generate.
     * @param {number} [duration=3.0] - Duration in seconds.
     * @param {number} [channels=2] - Number of audio channels (1 for mono, 2 for wide stereo).
     * @returns {AudioBuffer}
     */
    static generateNoiseBuffer(audioCtx, type, duration = 3.0, channels = 2) {
        if (!audioCtx || typeof audioCtx.createBuffer !== 'function') {
            throw new Error('generateNoiseBuffer requires an AudioContext with createBuffer');
        }

        const validChannels = Math.max(1, Math.min(2, channels || 2));
        const sampleRate = audioCtx.sampleRate || 44100;
        const totalSamples = Math.floor(Math.max(0.1, duration) * sampleRate);
        const buffer = audioCtx.createBuffer(validChannels, totalSamples, sampleRate);

        for (let ch = 0; ch < validChannels; ch++) {
            const data = buffer.getChannelData(ch);

            if (type === 'white') {
                for (let i = 0; i < totalSamples; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
            } else if (type === 'pink') {
                // Paul Kellet's 6-pole 1/f filter algorithm
                let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
                for (let i = 0; i < totalSamples; i++) {
                    const white = Math.random() * 2 - 1;
                    b0 = 0.99886 * b0 + white * 0.0555179;
                    b1 = 0.99332 * b1 + white * 0.0750759;
                    b2 = 0.96900 * b2 + white * 0.1538520;
                    b3 = 0.86650 * b3 + white * 0.3104856;
                    b4 = 0.55000 * b4 + white * 0.5329522;
                    b5 = -0.7616 * b5 - white * 0.0168980;
                    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
                    b6 = white * 0.115926;
                    data[i] = pink * 0.11; // Scale to approximately [-1.0, 1.0]
                }
            } else if (type === 'brown') {
                // Leaky integrator for Brown/Brownian 1/f^2 noise with DC-drift prevention
                let lastOut = 0.0;
                for (let i = 0; i < totalSamples; i++) {
                    const white = Math.random() * 2 - 1;
                    lastOut = (lastOut + (0.04 * white)) / 1.04;
                    data[i] = lastOut * 3.5; // Scale to approximately [-1.0, 1.0]
                }
            } else {
                throw new Error(`Unknown noise type: ${type}. Expected 'white', 'pink', or 'brown'.`);
            }
        }

        // Peak normalization to guarantee full dynamic range without clipping
        let peak = 0;
        for (let ch = 0; ch < validChannels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < totalSamples; i++) {
                const abs = Math.abs(data[i]);
                if (abs > peak) peak = abs;
            }
        }

        if (peak > 0) {
            const targetPeak = 0.95;
            const normScale = targetPeak / peak;
            for (let ch = 0; ch < validChannels; ch++) {
                const data = buffer.getChannelData(ch);
                for (let i = 0; i < totalSamples; i++) {
                    data[i] *= normScale;
                }
            }
        }

        return buffer;
    }

    /**
     * Gets a pre-calculated noise AudioBuffer.
     * @param {'white' | 'pink' | 'brown'} type
     * @returns {AudioBuffer | null}
     */
    getNoiseBuffer(type) {
        return this.noiseBuffers[type] || null;
    }

    /**
     * Creates and configures a reusable noise source for quick audio synthesis.
     * @param {'white' | 'pink' | 'brown'} type
     * @param {Object} [options]
     * @param {boolean} [options.loop=true] - Whether to loop the buffer.
     * @param {number} [options.gain=1.0] - Initial gain of the source.
     * @returns {ProceduralNoiseSource | null}
     */
    createNoiseSource(type, options = {}) {
        if (!this.ctx) return null;
        const buffer = this.getNoiseBuffer(type);
        if (!buffer) return null;

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = options.loop !== false;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(typeof options.gain === 'number' ? options.gain : 1.0, this.ctx.currentTime);
        source.connect(gain);

        return {
            source,
            gain,
            connect: (target) => { gain.connect(target); },
            play: (when = 0) => { source.start(when); },
            stop: (when = 0) => { source.stop(when); }
        };
    }

    // =========================================================================
    //  3D Spatial Audio Helper
    // =========================================================================

    /**
     * Creates a 3D spatial PannerNode with distance-based exponential falloff.
     *
     * @param {AudioContext} audioCtx - Active Web Audio context.
     * @param {number} [x=0] - Initial X coordinate in world units.
     * @param {number} [y=0] - Initial Y coordinate in world units.
     * @param {number} [z=0] - Initial Z coordinate in world units.
     * @param {AudioListener | Object | null} [listener=null] - Optional AudioListener or position descriptor.
     * @returns {SpatialPannerNode} Configured PannerNode augmented with helper methods.
     */
    static createPanner3D(audioCtx, x = 0, y = 0, z = 0, listener = null) {
        if (!audioCtx || typeof audioCtx.createPanner !== 'function') {
            throw new Error('createPanner3D requires a valid AudioContext');
        }

        const panner = /** @type {SpatialPannerNode} */ (audioCtx.createPanner());

        // Panning model: HRTF for realistic 3D localization
        try {
            panner.panningModel = 'HRTF';
        } catch (e) {
            panner.panningModel = 'equalpower';
        }

        // Distance model: exponential falloff as specified
        panner.distanceModel = 'exponential';
        // In ArcEngine, 100 world px = 1 meter.
        panner.refDistance = 100;
        panner.maxDistance = 4096; // Full location width
        panner.rolloffFactor = 1.2;
        panner.coneInnerAngle = 360;
        panner.coneOuterAngle = 360;

        // Set initial coordinates safely across modern and legacy Web Audio implementations
        const now = audioCtx.currentTime || 0;
        if (panner.positionX && typeof panner.positionX.setValueAtTime === 'function') {
            panner.positionX.setValueAtTime(x, now);
            panner.positionY.setValueAtTime(y, now);
            panner.positionZ.setValueAtTime(z, now);
        } else if (typeof (/** @type {any} */ (panner)).setPosition === 'function') {
            (/** @type {any} */ (panner)).setPosition(x, y, z);
        }

        // Configure listener if provided
        if (listener) {
            ProceduralAudioCore.updateListener(audioCtx, listener);
        }

        // Augment panner with convenience update methods
        panner.updatePosition = function(nx, ny, nz, rampTime = 0.0) {
            const t = audioCtx.currentTime || 0;
            if (panner.positionX && typeof panner.positionX.setValueAtTime === 'function') {
                if (rampTime > 0) {
                    panner.positionX.linearRampToValueAtTime(nx, t + rampTime);
                    panner.positionY.linearRampToValueAtTime(ny, t + rampTime);
                    panner.positionZ.linearRampToValueAtTime(nz, t + rampTime);
                } else {
                    panner.positionX.setValueAtTime(nx, t);
                    panner.positionY.setValueAtTime(ny, t);
                    panner.positionZ.setValueAtTime(nz, t);
                }
            } else if (typeof (/** @type {any} */ (panner)).setPosition === 'function') {
                (/** @type {any} */ (panner)).setPosition(nx, ny, nz);
            }
        };

        panner.updateOrientation = function(dx, dy, dz) {
            const t = audioCtx.currentTime || 0;
            if (panner.orientationX && typeof panner.orientationX.setValueAtTime === 'function') {
                panner.orientationX.setValueAtTime(dx, t);
                panner.orientationY.setValueAtTime(dy, t);
                panner.orientationZ.setValueAtTime(dz, t);
            } else if (typeof (/** @type {any} */ (panner)).setOrientation === 'function') {
                (/** @type {any} */ (panner)).setOrientation(dx, dy, dz);
            }
        };

        panner.setDistanceParameters = function(refDist, maxDist, rolloff = 1.2) {
            panner.refDistance = refDist;
            panner.maxDistance = maxDist;
            panner.rolloffFactor = rolloff;
        };

        return panner;
    }

    /**
     * Instance shortcut to create a 3D panner on this core's AudioContext.
     * @param {number} [x=0]
     * @param {number} [y=0]
     * @param {number} [z=0]
     * @param {AudioListener | Object | null} [listener=null]
     * @returns {SpatialPannerNode | null}
     */
    createPanner3D(x = 0, y = 0, z = 0, listener = null) {
        if (!this.ctx) return null;
        return ProceduralAudioCore.createPanner3D(this.ctx, x, y, z, listener);
    }

    /**
     * Safely updates the Web Audio listener position and orientation.
     *
     * @param {AudioContext} audioCtx
     * @param {Object} listenerData
     * @param {number} [listenerData.x]
     * @param {number} [listenerData.y]
     * @param {number} [listenerData.z]
     * @param {number} [listenerData.forwardX]
     * @param {number} [listenerData.forwardY]
     * @param {number} [listenerData.forwardZ]
     * @param {number} [listenerData.upX]
     * @param {number} [listenerData.upY]
     * @param {number} [listenerData.upZ]
     */
    static updateListener(audioCtx, listenerData) {
        if (!audioCtx || !audioCtx.listener || !listenerData) return;
        const listener = audioCtx.listener;
        const now = audioCtx.currentTime || 0;

        // Update listener position
        if (typeof listenerData.x === 'number') {
            const lx = listenerData.x;
            const ly = typeof listenerData.y === 'number' ? listenerData.y : 0;
            const lz = typeof listenerData.z === 'number' ? listenerData.z : 0;

            if (listener.positionX && typeof listener.positionX.setValueAtTime === 'function') {
                listener.positionX.setValueAtTime(lx, now);
                listener.positionY.setValueAtTime(ly, now);
                listener.positionZ.setValueAtTime(lz, now);
            } else if (typeof (/** @type {any} */ (listener)).setPosition === 'function') {
                (/** @type {any} */ (listener)).setPosition(lx, ly, lz);
            }
        }

        // Update listener orientation
        if (typeof listenerData.forwardX === 'number') {
            const fx = listenerData.forwardX;
            const fy = typeof listenerData.forwardY === 'number' ? listenerData.forwardY : 0;
            const fz = typeof listenerData.forwardZ === 'number' ? listenerData.forwardZ : -1;
            const ux = typeof listenerData.upX === 'number' ? listenerData.upX : 0;
            const uy = typeof listenerData.upY === 'number' ? listenerData.upY : 1;
            const uz = typeof listenerData.upZ === 'number' ? listenerData.upZ : 0;

            if (listener.forwardX && typeof listener.forwardX.setValueAtTime === 'function') {
                listener.forwardX.setValueAtTime(fx, now);
                listener.forwardY.setValueAtTime(fy, now);
                listener.forwardZ.setValueAtTime(fz, now);
                if (listener.upX) {
                    listener.upX.setValueAtTime(ux, now);
                    listener.upY.setValueAtTime(uy, now);
                    listener.upZ.setValueAtTime(uz, now);
                }
            } else if (typeof (/** @type {any} */ (listener)).setOrientation === 'function') {
                (/** @type {any} */ (listener)).setOrientation(fx, fy, fz, ux, uy, uz);
            }
        }
    }

    /**
     * Compute spatial audio routing (distance attenuation, air-absorption lowpass, stereo pan).
     * @param {any} [pos] - 3D/2D position
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

        const lx = this.listenerPos ? (this.listenerPos.x ?? 0) : 0;
        const ly = this.listenerPos ? (this.listenerPos.y ?? 0) : 0;
        const lz = this.listenerPos ? (this.listenerPos.z ?? this.listenerPos.h ?? 0) : 0;

        const dx = sx - lx;
        const dy = sy - ly;
        const dz = sz - lz;

        const distance = Math.hypot(dx, dy, dz);
        const maxRange = 3500;
        const refDist = 90;

        if (distance > maxRange) {
            return { gain: 0, filterFreq: 500, pan: 0, inAudibleRange: false };
        }

        const rolloff = 1.15;
        const gain = Math.max(0.01, Math.min(1.0, refDist / (refDist + rolloff * Math.max(0, distance - refDist))));
        const filterFreq = Math.max(900, Math.min(18000, 900 + 17100 * Math.exp(-distance / 750)));
        const panRange = 600;
        const rawPan = Math.max(-1, Math.min(1, dx / panRange));

        return {
            gain,
            filterFreq,
            pan: rawPan,
            inAudibleRange: true,
        };
    }
}

// Global browser and Node.js environment exports
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ProceduralAudioCore = ProceduralAudioCore;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).ProceduralAudioCore = ProceduralAudioCore;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProceduralAudioCore;
}
