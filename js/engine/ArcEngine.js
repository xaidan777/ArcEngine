// ============================================================================
//  ArcEngine — Unified AI-Native Game Engine Facade
// ----------------------------------------------------------------------------
//  The central orchestration layer uniting 3D rendering (Babylon.js), spatial
//  partitioning (ArcSpatialGrid), ECS (ArcActor), audio polyphony (VoiceManager),
//  procedural day/night lighting, weather, cinematic post-processing, and AI reflection.
// ============================================================================

/**
 * Event bus for decoupled game systems.
 *
 * The full implementation (priority, wildcards, queues, history, leak detection) lives in
 * js/engine/ArcEventBus.js as `ArcEventBusCore`; this is the minimal fallback used only when
 * that script is not on the page. It must NOT be named `ArcEventBus`: both files declare a
 * top-level lexical class, and loading both would throw
 * `SyntaxError: Identifier 'ArcEventBus' has already been declared`.
 */
class ArcEngineEventBus {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();
    }

    /**
     * @param {string} event
     * @param {Function} handler
     * @returns {this}
     */
    on(event, handler) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event)?.add(handler);
        return this;
    }

    /**
     * @param {string} event
     * @param {Function} handler
     * @returns {this}
     */
    once(event, handler) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            handler(...args);
        };
        return this.on(event, wrapper);
    }

    /**
     * @param {string} event
     * @param {Function} handler
     * @returns {this}
     */
    off(event, handler) {
        this._listeners.get(event)?.delete(handler);
        return this;
    }

    /**
     * @param {string} event
     * @param {*} [data]
     */
    emit(event, data) {
        const handlers = this._listeners.get(event);
        if (handlers) {
            for (const h of handlers) {
                try {
                    h(data);
                } catch (err) {
                    console.error(`[ArcEngine.events] Error in handler for '${event}':`, err);
                }
            }
        }
    }

    clear() {
        this._listeners.clear();
    }
}

/**
 * Unified ArcEngine Class
 */
class ArcEngineCore {
    constructor() {
        /** @type {*} Babylon Engine */
        this.bEngine = null;
        /** @type {*} Babylon Scene */
        this.scene = null;
        /** @type {*} Active Camera */
        this.camera = null;

        /** @type {ArcSpatialGrid} */
        this.spatial = (typeof ArcSpatialGrid !== 'undefined') ? new ArcSpatialGrid(128) : null;

        /** @type {ArcJobSystemCore|null} */
        this.jobs = (typeof ArcJobSystem !== 'undefined') ? ArcJobSystem : null;

        /** @type {Map<string, ArcActor>} */
        this.actors = new Map();

        /** @type {ArcPostProcess|null} */
        this.graphics = null;

        /** @type {ArcInspector} */
        this.ai = (typeof ArcInspector !== 'undefined') ? new ArcInspector(this) : null;

        /** @type {ArcEngineEventBus|ArcEventBusCore} */
        this.events = (typeof ArcEventBusCore !== 'undefined') ? new ArcEventBusCore() : new ArcEngineEventBus();

        /** @type {*} Audio Core & Voice Limiter */
        this.audio = {
            core: typeof window !== 'undefined' ? /** @type {any} */(window).ProceduralAudioCore : null,
            voices: (typeof VoiceManager !== 'undefined') ? new VoiceManager(24) : null,
            synth: typeof window !== 'undefined' ? /** @type {any} */(window).ProceduralAudio : null
        };

        /** @type {*} Reference to active weather system */
        this.weather = null;

        /** @type {*} Reference to active day/night lighting */
        this.lighting = null;

        /** @type {*} Reference to main player actor */
        this.player = null;

        // Simulation Timing
        this.time = {
            dt: 0.0166,
            elapsed: 0,
            timeScale: 1.0,
            paused: false,
            pause: () => { this.time.paused = true; this.events.emit('pause'); },
            resume: () => { this.time.paused = false; this.events.emit('resume'); },
            setTimeScale: (scale) => { this.time.timeScale = Math.max(0, scale); }
        };

        this.initialized = false;
        this._isRunning = false;
        this._lastTime = 0;
    }

    /**
     * Initializes ArcEngine
     * @param {Object} [options]
     * @param {*} [options.scene] Existing Babylon Scene
     * @param {*} [options.camera] Existing Camera
     * @param {HTMLCanvasElement} [options.canvas]
     * @param {number} [options.gridCellSize=128]
     * @param {number} [options.maxAudioVoices=24]
     * @param {number|'auto'} [options.threads]
     * @returns {this}
     */
    init(options = {}) {
        if (options.threads !== undefined && this.jobs) {
            this.jobs.init({ threads: options.threads });
        } else if (this.jobs && !this.jobs.initialized) {
            this.jobs.init();
        }

        if (options.gridCellSize && typeof ArcSpatialGrid !== 'undefined') {
            this.spatial = new ArcSpatialGrid(options.gridCellSize);
        } else if (!this.spatial && typeof ArcSpatialGrid !== 'undefined') {
            this.spatial = new ArcSpatialGrid(128);
        }

        if (options.maxAudioVoices && typeof VoiceManager !== 'undefined') {
            this.audio.voices = new VoiceManager(options.maxAudioVoices);
        }

        if (options.scene) {
            this.scene = options.scene;
            this.camera = options.camera || options.scene.activeCamera;
            this.bEngine = options.scene.getEngine ? options.scene.getEngine() : null;

            // Setup Graphics post-process
            if (typeof ArcPostProcess !== 'undefined') {
                if (this.graphics) this.graphics.dispose();
                this.graphics = new ArcPostProcess(this.scene, this.camera);
            }
        }

        if (!this.ai && typeof ArcInspector !== 'undefined') {
            this.ai = new ArcInspector(this);
        } else if (this.ai) {
            this.ai.init(this);
        }

        // Connect ambient globals if present
        if (typeof window !== 'undefined') {
            const w = /** @type {any} */(window);
            if (w.WeatherSystem) this.weather = w.WeatherSystem;
            if (w.DayNightCycle) this.lighting = w.DayNightCycle;
        }

        this.initialized = true;
        this.events.emit('init', this);
        return this;
    }

    /**
     * Declarative Scene Builder
     * Builds entire game environment from a single declarative config object
     * @param {Object} config
     * @returns {this}
     */
    createScene(config = {}) {
        if (!this.initialized) {
            this.init(config);
        }

        // 1. World & Lighting
        if (config.lighting && this.lighting) {
            if (config.lighting.dayPhase !== undefined) {
                this.lighting.dayPhase = config.lighting.dayPhase;
            }
        }

        // 2. Weather
        if (config.weather && this.weather) {
            if (config.weather.state && typeof this.weather.setWeather === 'function') {
                this.weather.setWeather(config.weather.state);
            }
        }

        // 3. Post-Processing Settings
        if (config.postProcess && this.graphics) {
            this.graphics.applySettings(config.postProcess);
        }

        // 4. Initial Actors
        if (Array.isArray(config.actors)) {
            for (const actorDef of config.actors) {
                this.spawn(actorDef);
            }
        }

        this.events.emit('sceneCreated', config);
        return this;
    }

    /**
     * Spawns an actor into the scene and registers it with spatial index
     * @param {Object|ArcActor} actorOrDef
     * @returns {ArcActor}
     */
    spawn(actorOrDef) {
        /** @type {ArcActor} */
        let actor;
        if (actorOrDef instanceof ArcActor) {
            actor = actorOrDef;
            if (!actor.scene && this.scene) actor.scene = this.scene;
        } else if (typeof ArcActor !== 'undefined') {
            actor = ArcActor.create(actorOrDef, this.scene);
        } else {
            throw new Error('[ArcEngine] ArcActor class not loaded');
        }

        this.actors.set(actor.id, actor);

        // Register in Spatial Hash Grid
        if (this.spatial) {
            const r = actor.getComponent('Collider')?.radius ?? 15;
            this.spatial.insert(actor, actor.position.x, actor.position.z ?? actor.position.y, r);
        }

        if (actor.hasTag('player')) {
            this.player = actor;
        }

        this.events.emit('actorSpawned', actor);
        return actor;
    }

    /**
     * Destroys an actor and unregisters it from all systems
     * @param {string|ArcActor} actorOrId
     * @returns {boolean}
     */
    destroy(actorOrId) {
        const id = typeof actorOrId === 'string' ? actorOrId : actorOrId?.id;
        if (!id) return false;

        const actor = this.actors.get(id);
        if (!actor) return false;

        if (this.spatial) {
            this.spatial.remove(actor);
        }

        actor.destroy();
        this.actors.delete(id);

        if (this.player === actor) {
            this.player = null;
        }

        this.events.emit('actorDestroyed', id);
        return true;
    }

    /**
     * Frame Step
     * @param {number} rawDt Delta time in seconds
     */
    update(rawDt) {
        if (!this.initialized || this.time.paused) return;

        const dt = Math.min(0.1, rawDt) * this.time.timeScale;
        this.time.dt = dt;
        this.time.elapsed += dt;

        // Update all active actors
        for (const actor of this.actors.values()) {
            if (actor.active) {
                actor.update(dt);
                // Sync position to spatial grid if position moved
                if (this.spatial) {
                    const r = actor.getComponent('Collider')?.radius ?? 15;
                    this.spatial.update(actor, actor.position.x, actor.position.z ?? actor.position.y, r);
                }
            }
        }

        // Synchronize Graphics with Lighting/Weather
        if (this.graphics && this.lighting) {
            const phase = this.lighting.dayPhase ?? 0.5;
            const weather = this.weather?.currentState ?? 'CLEAR';
            this.graphics.syncWithDayNight(phase, weather);
        }

        this.events.emit('update', dt);
    }

    /**
     * Starts the engine game loop
     */
    startLoop() {
        if (this._isRunning) return;
        this._isRunning = true;
        this._lastTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        const loop = () => {
            if (!this._isRunning) return;
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const rawDt = Math.max(0.001, (now - this._lastTime) / 1000);
            this._lastTime = now;

            this.update(rawDt);

            if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(loop);
            }
        };

        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(loop);
        }
    }

    /**
     * Stops the engine game loop
     */
    stopLoop() {
        this._isRunning = false;
    }

    /**
     * Comprehensive system diagnostics: GPU hardware, multi-core thread pool stats, and simulation timing.
     * @returns {Object}
     */
    getDiagnostics() {
        const gpu = (typeof World3D !== 'undefined' && typeof World3D.getGpuInfo === 'function')
            ? World3D.getGpuInfo()
            : { api: 'webgl2', nativeBackend: 'OpenGL', renderer: 'Generic', vendor: 'Generic', computeSupported: false };

        const jobs = this.jobs ? this.jobs.getStats() : { backend: 'sync', activeWorkers: 0, concurrency: 1 };

        return {
            gpu,
            jobs,
            actors: this.actors.size,
            spatial: this.spatial ? this.spatial.getStats() : null,
            time: { ...this.time }
        };
    }
}

// Global Singleton Instance
const ArcEngine = new ArcEngineCore();

// Universal module exports
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ArcEngine = ArcEngine;
    /** @type {any} */ (window).ArcEngineCore = ArcEngineCore;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).ArcEngine = ArcEngine;
    /** @type {any} */ (globalThis).ArcEngineCore = ArcEngineCore;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ArcEngine, ArcEngineCore };
}
