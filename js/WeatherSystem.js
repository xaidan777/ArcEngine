// WeatherSystem.js — Dynamic procedural weather simulation and visual atmospheric effects.
//
// Coordinates & World:
//   Wind is simulated in the 2D horizontal plane (windX, windZ) corresponding to Babylon
//   world coordinates (X = x, Z = y). Wind vector drifts continuously via 2D Simplex noise
//   with periodic gust surges.
//
// Weather States:
//   CLEAR       — Gentle breeze, standard visibility, open sky.
//   DUST_STORM  — High winds, dense rust/sepia fog, airborne dust particles, howling wind audio.
//   ACID_RAIN   — Overcast green-grey sky, rain streaks deflected by wind, puddle ripples, lightning flashes & thunder.
//   DENSE_FOG   — Calm wind, near-zero visibility (fog density >= 0.008), muffled acoustics.
//
// Visual Effects (Babylon.js):
//   - ParticleSystem for dust storm clouds / particles blown along the current wind vector.
//   - ParticleSystem for rain streaks falling & deflected by wind vector, plus ground ripples.
//   - Lightning flash generator: sudden spike in hemi.intensity and sky color with randomized interval,
//     followed by delayed procedural thunder trigger.
//
// Integrations:
//   - DayNightCycle : Modulates ambient & directional lighting, sky/fog tints across day-night phases.
//   - ProceduralAudio : Modulates wind howling, rain ambience, thunder triggers, and muffled acoustics filter.

/**
 * @typedef {'CLEAR' | 'DUST_STORM' | 'ACID_RAIN' | 'DENSE_FOG'} WeatherStateType
 */

/**
 * @typedef {Object} WindVector
 * @property {number} x - Wind velocity along Babylon X axis (map X).
 * @property {number} z - Wind velocity along Babylon Z axis (map Y).
 */

/**
 * @typedef {Object} WeatherConfig
 * @property {number} windBaseSpeed - Base wind speed (units/sec).
 * @property {number} windGustScale - Multiplier for gust amplitude.
 * @property {number} fogDensity - Target scene fog density.
 * @property {{r: number, g: number, b: number}} fogColor - Target fog Color3.
 * @property {{r: number, g: number, b: number}} skyColor - Target clearColor Color3.
 * @property {number} hemiIntensity - Target hemispheric sky light intensity.
 * @property {number} sunIntensity - Target directional sun intensity.
 * @property {boolean} muffledAcoustics - Whether acoustic muffling (low-pass) is active.
 * @property {boolean} rainActive - Whether rain streak particles are active.
 * @property {boolean} dustActive - Whether dust storm particles are active.
 * @property {boolean} lightningActive - Whether lightning flash generator is active.
 */

/**
 * Fallback 2D simplex/gradient noise implementation when external SimplexNoise is unavailable.
 */
class FallbackSimplex2D {
    /**
     * @param {string|number} [seed]
     */
    constructor(seed = 1337) {
        let s = typeof seed === 'string' ? Array.from(seed).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0) : (seed | 0);
        this.perm = new Uint8Array(512);
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 255; i > 0; i--) {
            s = (s * 1664525 + 1013904223) | 0;
            const r = Math.abs(s) % (i + 1);
            const tmp = p[i]; p[i] = p[r]; p[r] = tmp;
        }
        for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    }

    /**
     * @param {number} xin
     * @param {number} yin
     * @returns {number} Noise in [-1, 1]
     */
    noise2D(xin, yin) {
        const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
        const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = xin - X0;
        const y0 = yin - Y0;

        let i1 = 0, j1 = 1;
        if (x0 > y0) { i1 = 1; j1 = 0; }

        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2;
        const y2 = y0 - 1.0 + 2.0 * G2;

        const ii = i & 255;
        const jj = j & 255;

        const grad = (/** @type {number} */ hash, /** @type {number} */ x, /** @type {number} */ y) => {
            const h = hash & 7;
            const u = h < 4 ? x : y;
            const v = h < 4 ? y : x;
            return ((h & 1) !== 0 ? -u : u) + ((h & 2) !== 0 ? -2.0 * v : 2.0 * v);
        };

        let n0 = 0, n1 = 0, n2 = 0;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 > 0) {
            t0 *= t0;
            n0 = t0 * t0 * grad(this.perm[ii + this.perm[jj]], x0, y0);
        }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 > 0) {
            t1 *= t1;
            n1 = t1 * t1 * grad(this.perm[ii + i1 + this.perm[jj + j1]], x1, y1);
        }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 > 0) {
            t2 *= t2;
            n2 = t2 * t2 * grad(this.perm[ii + 1 + this.perm[jj + 1]], x2, y2);
        }
        return 70.0 * (n0 + n1 + n2);
    }
}

class WeatherSystem {
    /** @type {Record<WeatherStateType, WeatherStateType>} */
    static STATES = {
        CLEAR: 'CLEAR',
        DUST_STORM: 'DUST_STORM',
        ACID_RAIN: 'ACID_RAIN',
        DENSE_FOG: 'DENSE_FOG'
    };

    /** @type {Record<WeatherStateType, WeatherConfig>} */
    static CONFIGS = {
        CLEAR: {
            windBaseSpeed: 18,
            windGustScale: 0.35,
            fogDensity: 0.00032,
            fogColor: { r: 0.56, g: 0.76, b: 0.88 },
            skyColor: { r: 0.56, g: 0.76, b: 0.88 },
            hemiIntensity: 0.45,
            sunIntensity: 0.80,
            muffledAcoustics: false,
            rainActive: false,
            dustActive: false,
            lightningActive: false
        },
        DUST_STORM: {
            windBaseSpeed: 110,
            windGustScale: 0.95,
            fogDensity: 0.0048,
            fogColor: { r: 0.72, g: 0.41, b: 0.22 }, // Rust sepia
            skyColor: { r: 0.58, g: 0.32, b: 0.16 },
            hemiIntensity: 0.30,
            sunIntensity: 0.32,
            muffledAcoustics: false,
            rainActive: false,
            dustActive: true,
            lightningActive: false
        },
        ACID_RAIN: {
            windBaseSpeed: 48,
            windGustScale: 0.55,
            fogDensity: 0.0024,
            fogColor: { r: 0.27, g: 0.37, b: 0.29 }, // Overcast green-grey
            skyColor: { r: 0.22, g: 0.31, b: 0.24 },
            hemiIntensity: 0.26,
            sunIntensity: 0.22,
            muffledAcoustics: false,
            rainActive: true,
            dustActive: false,
            lightningActive: true
        },
        DENSE_FOG: {
            windBaseSpeed: 7,
            windGustScale: 0.15,
            fogDensity: 0.0092, // Near-zero visibility (0.008+)
            fogColor: { r: 0.62, g: 0.65, b: 0.67 },
            skyColor: { r: 0.54, g: 0.57, b: 0.59 },
            hemiIntensity: 0.20,
            sunIntensity: 0.10,
            muffledAcoustics: true,
            rainActive: false,
            dustActive: false,
            lightningActive: false
        }
    };

    /**
     * @param {any} [viewOrApp] - Optional View3D or engine app instance { location, camera, ... }
     * @param {Object} [options]
     * @param {WeatherStateType} [options.initialState='CLEAR']
     * @param {string|number} [options.seed=104729]
     * @param {any} [options.dayNightCycle]
     * @param {any} [options.proceduralAudio]
     * @param {boolean} [options.autoCycle=false]
     * @param {number} [options.cycleDuration=90]
     */
    constructor(viewOrApp = null, options = {}) {
        // Resolve view and scene. A bare Scene is accepted as well: `Game` passes `this.scene`,
        // and without this branch neither `view` nor `scene` was set, so every atmosphere write
        // (`_applyAtmosphereToScene`, `_initVisualEffects`) returned early and the entire
        // weather system was inert — no fog, rain, dust or lightning ever reached the scene.
        if (viewOrApp && typeof viewOrApp.getEngine === 'function') {
            // Already a Babylon Scene.
            this.scene = viewOrApp;
            this.view = { scene: viewOrApp };
        } else if (viewOrApp && viewOrApp.scene) {
            this.view = viewOrApp;
            this.scene = viewOrApp.scene;
        } else if (viewOrApp && viewOrApp.location && viewOrApp.location.view) {
            this.app = viewOrApp;
            this.view = viewOrApp.location.view;
            this.scene = this.view.scene;
        } else {
            this.view = null;
            this.scene = null;
        }

        // Noise initialization
        this.seed = options.seed != null ? options.seed : 104729;
        const GlobalSimplex = typeof globalThis !== 'undefined' ? (/** @type {any} */ (globalThis)).SimplexNoise : undefined;
        if (typeof GlobalSimplex !== 'undefined') {
            try {
                this.simplex = new GlobalSimplex(String(this.seed));
            } catch (e) {
                this.simplex = new FallbackSimplex2D(this.seed);
            }
        } else {
            this.simplex = new FallbackSimplex2D(this.seed);
        }

        // Weather state
        /** @type {WeatherStateType} */
        this.currentState = options.initialState || WeatherSystem.STATES.CLEAR;
        /** @type {WeatherStateType} */
        this.previousState = this.currentState;
        this.transitionProgress = 1.0;
        this.transitionDuration = 3.0; // seconds

        // Interpolated atmospheric parameters
        const initialCfg = WeatherSystem.CONFIGS[this.currentState] || WeatherSystem.CONFIGS.CLEAR;
        this._current = {
            windBaseSpeed: initialCfg.windBaseSpeed,
            windGustScale: initialCfg.windGustScale,
            fogDensity: initialCfg.fogDensity,
            fogColor: { ...initialCfg.fogColor },
            skyColor: { ...initialCfg.skyColor },
            hemiIntensity: initialCfg.hemiIntensity,
            sunIntensity: initialCfg.sunIntensity,
            muffledAcoustics: initialCfg.muffledAcoustics,
            rainActive: initialCfg.rainActive,
            dustActive: initialCfg.dustActive,
            lightningActive: initialCfg.lightningActive
        };

        // Wind simulation state
        this._time = 0;
        this.windX = 0;
        this.windZ = 0;
        this._windSpeed = 0;
        this._gustFactor = 0;
        this._windAngle = 0;

        // Visual effects
        this._particlesReady = false;
        /** @type {BABYLON.ParticleSystem | null} */
        this._rainParticles = null;
        /** @type {BABYLON.ParticleSystem | null} */
        this._rippleParticles = null;
        /** @type {BABYLON.ParticleSystem | null} */
        this._dustParticles = null;

        // Lightning & thunder state
        this._lightningTimer = this._getRandomLightningInterval();
        this._lightningFlashTime = 0;
        this._lightningIntensity = 0;
        /** @type {Array<{ triggerTime: number, volume: number, distance: number }>} */
        this._pendingThunders = [];

        // Integrations
        this.dayNightCycle = options.dayNightCycle || null;
        this.proceduralAudio = options.proceduralAudio || null;

        // Auto cycling
        this.autoCycle = !!options.autoCycle;
        this.cycleDuration = options.cycleDuration || 90;
        this._cycleTimer = 0;

        // Auto-detect integrations from globals / window if not explicitly provided
        this._detectIntegrations();

        // Initialize Babylon visual effects if scene is provided
        if (this.scene && typeof BABYLON !== 'undefined') {
            this._initVisualEffects();
        }

        // Apply initial state
        this._updateWind(0);
        this._applyAtmosphereToScene();
        this._syncAudio();
    }

    // =========================================================================
    //  Weather State Management
    // =========================================================================

    /**
     * Transitions smoothly to a new weather state.
     * @param {WeatherStateType} newState
     * @param {number} [duration=3.0] - Transition duration in seconds (0 for immediate)
     */
    setWeather(newState, duration = 3.0) {
        if (!WeatherSystem.CONFIGS[newState]) {
            console.warn(`WeatherSystem: Unknown weather state "${newState}".`);
            return;
        }
        if (newState === this.currentState && this.transitionProgress >= 1.0) {
            return;
        }

        this.previousState = this.currentState;
        this.currentState = newState;
        this.transitionDuration = Math.max(0, duration);
        this.transitionProgress = duration <= 0 ? 1.0 : 0.0;

        if (this.transitionProgress >= 1.0) {
            const target = WeatherSystem.CONFIGS[this.currentState];
            this._current.windBaseSpeed = target.windBaseSpeed;
            this._current.windGustScale = target.windGustScale;
            this._current.fogDensity = target.fogDensity;
            this._current.fogColor = { ...target.fogColor };
            this._current.skyColor = { ...target.skyColor };
            this._current.hemiIntensity = target.hemiIntensity;
            this._current.sunIntensity = target.sunIntensity;
            this._current.muffledAcoustics = target.muffledAcoustics;
            this._current.rainActive = target.rainActive;
            this._current.dustActive = target.dustActive;
            this._current.lightningActive = target.lightningActive;
        }

        // Reset lightning timer when switching into ACID_RAIN
        if (newState === WeatherSystem.STATES.ACID_RAIN) {
            this._lightningTimer = this._getRandomLightningInterval();
        }

        this._notifyDayNightCycle();
        this._syncAudio();
    }

    /**
     * @returns {WeatherStateType} Current weather state
     */
    getState() {
        return this.currentState;
    }

    /**
     * Check if a weather transition is currently in progress.
     * @returns {boolean}
     */
    isTransitioning() {
        return this.transitionProgress < 1.0;
    }

    /**
     * @returns {WeatherConfig} Current active/interpolated atmospheric settings
     */
    getCurrentAtmosphere() {
        return { ...this._current };
    }

    // =========================================================================
    //  2D Simplex Wind Simulation
    // =========================================================================

    /**
     * @param {number} dt - Delta time in seconds
     */
    _updateWind(dt) {
        this._time += dt;

        // Continuous directional drift via low-frequency 2D Simplex noise
        const dirNoise = this.simplex.noise2D(this._time * 0.015, 17.3);
        this._windAngle = dirNoise * Math.PI * 2;

        // Periodic gusts: sample noise at higher frequency with sharp non-linear thresholding
        const rawGust = (this.simplex.noise2D(this._time * 0.22, 108.7) + 1) * 0.5;
        this._gustFactor = Math.max(0, Math.min(1, Math.pow(rawGust, 2.2)));

        // Effective wind speed
        const gustMultiplier = 1.0 + this._gustFactor * this._current.windGustScale;
        this._windSpeed = this._current.windBaseSpeed * gustMultiplier;

        // Continuous wind vector (windX, windZ)
        this.windX = Math.cos(this._windAngle) * this._windSpeed;
        this.windZ = Math.sin(this._windAngle) * this._windSpeed;
    }

    /**
     * Gets the continuous wind vector in Babylon horizontal plane (X, Z).
     * @returns {WindVector}
     */
    getWindVector() {
        return { x: this.windX, z: this.windZ };
    }

    /**
     * Gets current effective wind speed/strength (magnitude of wind vector).
     * @returns {number}
     */
    getWindStrength() {
        return this._windSpeed;
    }

    /**
     * Gets instantaneous normalized gust factor in [0, 1].
     * @returns {number}
     */
    getGustFactor() {
        return this._gustFactor;
    }

    // =========================================================================
    //  Babylon.js Visual Weather Effects
    // =========================================================================

    _initVisualEffects() {
        if (!this.scene || typeof BABYLON === 'undefined') return;

        try {
            this._createProceduralTextures();
            this._setupParticleSystems();
            this._particlesReady = true;
        } catch (e) {
            console.warn('WeatherSystem: Visual particles setup encountered non-fatal error:', e);
            this._particlesReady = false;
        }
    }

    _createProceduralTextures() {
        const scene = this.scene;
        if (!scene || typeof BABYLON === 'undefined' || !BABYLON.RawTexture) return;

        // Rain streak texture (8x32 elongated white streak with soft alpha falloff)
        const rainW = 8, rainH = 32;
        const rainData = new Uint8Array(rainW * rainH * 4);
        for (let y = 0; y < rainH; y++) {
            const ny = y / (rainH - 1);
            const alphaY = Math.sin(ny * Math.PI);
            for (let x = 0; x < rainW; x++) {
                const nx = (x - rainW / 2 + 0.5) / (rainW / 2);
                const alphaX = Math.max(0, 1 - Math.abs(nx));
                const a = Math.round(255 * alphaX * alphaY);
                const idx = (y * rainW + x) * 4;
                rainData[idx] = 230;
                rainData[idx + 1] = 245;
                rainData[idx + 2] = 255;
                rainData[idx + 3] = a;
            }
        }
        this._rainTexture = BABYLON.RawTexture.CreateRGBATexture(
            rainData, rainW, rainH, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE
        );

        // Dust puff texture (32x32 soft radial particle)
        const dustSize = 32;
        const dustData = new Uint8Array(dustSize * dustSize * 4);
        const halfD = dustSize / 2;
        for (let y = 0; y < dustSize; y++) {
            for (let x = 0; x < dustSize; x++) {
                const dx = (x - halfD + 0.5) / halfD;
                const dy = (y - halfD + 0.5) / halfD;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const alpha = dist >= 1 ? 0 : Math.pow(Math.cos(dist * Math.PI * 0.5), 1.8);
                const idx = (y * dustSize + x) * 4;
                dustData[idx] = 210;
                dustData[idx + 1] = 160;
                dustData[idx + 2] = 110;
                dustData[idx + 3] = Math.round(255 * alpha);
            }
        }
        this._dustTexture = BABYLON.RawTexture.CreateRGBATexture(
            dustData, dustSize, dustSize, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE
        );

        // Ripple ring texture (32x32 concentric circular ring with soft borders)
        const ripSize = 32;
        const ripData = new Uint8Array(ripSize * ripSize * 4);
        const halfR = ripSize / 2;
        for (let y = 0; y < ripSize; y++) {
            for (let x = 0; x < ripSize; x++) {
                const dx = (x - halfR + 0.5) / halfR;
                const dy = (y - halfR + 0.5) / halfR;
                const dist = Math.sqrt(dx * dx + dy * dy);
                // Ring with peak at dist = 0.7
                const ringDist = Math.abs(dist - 0.7);
                const alpha = ringDist > 0.3 ? 0 : Math.cos((ringDist / 0.3) * Math.PI * 0.5);
                const idx = (y * ripSize + x) * 4;
                ripData[idx] = 180;
                ripData[idx + 1] = 220;
                ripData[idx + 2] = 210;
                ripData[idx + 3] = Math.round(255 * Math.max(0, alpha));
            }
        }
        this._rippleTexture = BABYLON.RawTexture.CreateRGBATexture(
            ripData, ripSize, ripSize, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE
        );
    }

    _setupParticleSystems() {
        const scene = this.scene;
        if (!scene || typeof BABYLON === 'undefined' || !BABYLON.ParticleSystem) return;

        // 1. Rain Streaks Particle System
        const rain = new BABYLON.ParticleSystem('weather_rain', 1800, scene);
        rain.particleTexture = this._rainTexture || null;
        rain.emitter = new BABYLON.Vector3(0, 400, 0);
        rain.minEmitBox = new BABYLON.Vector3(-600, 0, -600);
        rain.maxEmitBox = new BABYLON.Vector3(600, 0, 600);

        rain.color1 = new BABYLON.Color4(0.70, 0.85, 0.75, 0.60); // Acid green-tinted
        rain.color2 = new BABYLON.Color4(0.55, 0.72, 0.60, 0.45);
        rain.colorDead = new BABYLON.Color4(0.40, 0.55, 0.45, 0.0);

        rain.minSize = 4;
        rain.maxSize = 8;
        rain.minScaleY = 3.5;
        rain.maxScaleY = 7.0;

        rain.minLifeTime = 0.6;
        rain.maxLifeTime = 0.9;
        rain.emitRate = 0; // modulated by state

        rain.direction1 = new BABYLON.Vector3(-20, -750, -20);
        rain.direction2 = new BABYLON.Vector3(20, -850, 20);
        rain.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
        rain.start();
        this._rainParticles = rain;

        // 2. Puddle Ripple Particle System
        const ripples = new BABYLON.ParticleSystem('weather_ripples', 600, scene);
        ripples.particleTexture = this._rippleTexture || null;
        ripples.emitter = new BABYLON.Vector3(0, 2, 0);
        ripples.minEmitBox = new BABYLON.Vector3(-550, 0, -550);
        ripples.maxEmitBox = new BABYLON.Vector3(550, 0, 550);

        ripples.color1 = new BABYLON.Color4(0.65, 0.82, 0.70, 0.5);
        ripples.color2 = new BABYLON.Color4(0.45, 0.65, 0.52, 0.25);
        ripples.colorDead = new BABYLON.Color4(0.35, 0.50, 0.40, 0.0);

        ripples.minSize = 4;
        ripples.maxSize = 26;
        ripples.minLifeTime = 0.3;
        ripples.maxLifeTime = 0.6;
        ripples.emitRate = 0;

        ripples.direction1 = new BABYLON.Vector3(0, 0, 0);
        ripples.direction2 = new BABYLON.Vector3(0, 0, 0);
        ripples.gravity = new BABYLON.Vector3(0, 0, 0);
        ripples.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
        ripples.start();
        this._rippleParticles = ripples;

        // 3. Dust Storm Clouds Particle System
        const dust = new BABYLON.ParticleSystem('weather_dust', 1200, scene);
        dust.particleTexture = this._dustTexture || null;
        dust.emitter = new BABYLON.Vector3(0, 60, 0);
        dust.minEmitBox = new BABYLON.Vector3(-700, -20, -700);
        dust.maxEmitBox = new BABYLON.Vector3(700, 80, 700);

        dust.color1 = new BABYLON.Color4(0.75, 0.46, 0.22, 0.40); // Rust-sepia
        dust.color2 = new BABYLON.Color4(0.58, 0.34, 0.16, 0.25);
        dust.colorDead = new BABYLON.Color4(0.42, 0.24, 0.10, 0.0);

        dust.minSize = 25;
        dust.maxSize = 90;
        dust.minLifeTime = 1.2;
        dust.maxLifeTime = 2.4;
        dust.emitRate = 0;

        dust.direction1 = new BABYLON.Vector3(80, -5, 80);
        dust.direction2 = new BABYLON.Vector3(140, 20, 140);
        dust.minAngularSpeed = -0.6;
        dust.maxAngularSpeed = 0.6;
        dust.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
        dust.start();
        this._dustParticles = dust;
    }

    /**
     * Updates visual particle positions, emission rates, and wind deflection angles.
     */
    _updateParticles() {
        if (!this._particlesReady) return;

        // Camera center tracking
        let camPos = { x: 0, y: 0, z: 0 };
        if (this.scene && this.scene.activeCamera) {
            const c = this.scene.activeCamera;
            camPos.x = c.position ? c.position.x : 0;
            camPos.y = c.position ? c.position.y : 0;
            camPos.z = c.position ? c.position.z : 0;
        }

        // 1. Rain streaks: deflected by wind vector (windX, windZ)
        if (this._rainParticles) {
            const targetRate = this._current.rainActive ? 1400 : 0;
            this._rainParticles.emitRate = Math.round(
                this._rainParticles.emitRate * 0.9 + targetRate * 0.1
            );
            if (this._rainParticles.emitter && /** @type {any} */ (this._rainParticles.emitter).set) {
                /** @type {any} */ (this._rainParticles.emitter).set(camPos.x, camPos.y + 350, camPos.z);
            }
            // Deflection: vertical fall plus horizontal wind drift
            const deflX = this.windX * 1.6;
            const deflZ = this.windZ * 1.6;
            if (this._rainParticles.direction1 && this._rainParticles.direction1.set) {
                this._rainParticles.direction1.set(deflX - 25, -780, deflZ - 25);
                this._rainParticles.direction2.set(deflX + 25, -880, deflZ + 25);
            }
        }

        // 2. Puddle ripples on ground
        if (this._rippleParticles) {
            const targetRippleRate = this._current.rainActive ? 420 : 0;
            this._rippleParticles.emitRate = Math.round(
                this._rippleParticles.emitRate * 0.9 + targetRippleRate * 0.1
            );
            if (this._rippleParticles.emitter && /** @type {any} */ (this._rippleParticles.emitter).set) {
                /** @type {any} */ (this._rippleParticles.emitter).set(camPos.x, Math.max(1, camPos.y * 0.1), camPos.z);
            }
        }

        // 3. Dust storm: blowing along wind vector
        if (this._dustParticles) {
            const targetDustRate = this._current.dustActive ? 900 : 0;
            this._dustParticles.emitRate = Math.round(
                this._dustParticles.emitRate * 0.9 + targetDustRate * 0.1
            );
            // Position slightly upwind so dust particles blow across the player's view
            const upwindX = camPos.x - (this.windX / Math.max(1, this._windSpeed)) * 180;
            const upwindZ = camPos.z - (this.windZ / Math.max(1, this._windSpeed)) * 180;
            if (this._dustParticles.emitter && /** @type {any} */ (this._dustParticles.emitter).set) {
                /** @type {any} */ (this._dustParticles.emitter).set(upwindX, 40, upwindZ);
            }
            // Dust velocity matches wind vector
            const dustVx = this.windX * 1.8;
            const dustVz = this.windZ * 1.8;
            if (this._dustParticles.direction1 && this._dustParticles.direction1.set) {
                this._dustParticles.direction1.set(dustVx - 35, -5, dustVz - 35);
                this._dustParticles.direction2.set(dustVx + 35, 30, dustVz + 30);
            }
        }
    }

    // =========================================================================
    //  Lightning Flash Generator & Procedural Thunder Trigger
    // =========================================================================

    _getRandomLightningInterval() {
        // Randomized interval between 7 and 18 seconds
        return 7.0 + Math.random() * 11.0;
    }

    /**
     * @param {number} dt - Delta time in seconds
     */
    _updateLightning(dt) {
        // Only active during ACID_RAIN
        if (!this._current.lightningActive) {
            this._lightningIntensity = 0;
            this._lightningFlashTime = 0;
            return;
        }

        // Countdown interval
        this._lightningTimer -= dt;
        if (this._lightningTimer <= 0) {
            this._triggerLightningFlash();
            this._lightningTimer = this._getRandomLightningInterval();
        }

        // Decay active flash
        if (this._lightningFlashTime > 0) {
            this._lightningFlashTime -= dt;
            if (this._lightningFlashTime <= 0) {
                this._lightningIntensity = 0;
            } else {
                // Multi-pulse flash flicker
                const t = this._lightningFlashTime / 0.18;
                const flicker = Math.sin(t * Math.PI * 4) > 0.2 ? 1.0 : 0.4;
                this._lightningIntensity = 3.2 * t * flicker;
            }
        }

        // Process pending delayed thunder sound triggers
        for (let i = this._pendingThunders.length - 1; i >= 0; i--) {
            const thunder = this._pendingThunders[i];
            thunder.triggerTime -= dt;
            if (thunder.triggerTime <= 0) {
                this._triggerThunderSound(thunder.volume, thunder.distance);
                this._pendingThunders.splice(i, 1);
            }
        }
    }

    _triggerLightningFlash() {
        this._lightningFlashTime = 0.18; // seconds
        this._lightningIntensity = 3.2;

        // Sound travels at ~340m/s: calculate distance delay for procedural thunder
        const distance = 250 + Math.random() * 1200; // 250m .. 1450m (~0.7s .. 4.2s)
        const delay = distance / 340;
        const volume = Math.max(0.2, Math.min(1.0, 1.2 - distance / 1800));

        this._pendingThunders.push({
            triggerTime: delay,
            volume,
            distance
        });
    }

    /**
     * @param {number} volume
     * @param {number} distance
     */
    _triggerThunderSound(volume, distance) {
        const audio = this.proceduralAudio;
        if (!audio) return;

        if (typeof audio.triggerThunder === 'function') {
            audio.triggerThunder({ volume, distance });
        } else if (typeof audio.playThunder === 'function') {
            audio.playThunder({ volume, distance });
        } else if (typeof audio.play === 'function') {
            audio.play('thunder', { volume });
        }
    }

    // =========================================================================
    //  Scene Atmosphere & DayNightCycle Integration
    // =========================================================================

    /**
     * Updates smooth atmospheric interpolation between previous and current states.
     * @param {number} dt
     */
    _updateAtmosphereTransition(dt) {
        if (this.transitionProgress < 1.0) {
            this.transitionProgress = Math.min(
                1.0,
                this.transitionProgress + dt / Math.max(0.001, this.transitionDuration)
            );
            const t = this.transitionProgress;
            // Smoothstep
            const smoothT = t * t * (3 - 2 * t);

            const prev = WeatherSystem.CONFIGS[this.previousState] || WeatherSystem.CONFIGS.CLEAR;
            const next = WeatherSystem.CONFIGS[this.currentState] || WeatherSystem.CONFIGS.CLEAR;

            const lerp = (/** @type {number} */ a, /** @type {number} */ b) => a + (b - a) * smoothT;
            const lerpColor = (/** @type {{r: number, g: number, b: number}} */ ca, /** @type {{r: number, g: number, b: number}} */ cb) => ({
                r: ca.r + (cb.r - ca.r) * smoothT,
                g: ca.g + (cb.g - ca.g) * smoothT,
                b: ca.b + (cb.b - ca.b) * smoothT
            });

            this._current.windBaseSpeed = lerp(prev.windBaseSpeed, next.windBaseSpeed);
            this._current.windGustScale = lerp(prev.windGustScale, next.windGustScale);
            this._current.fogDensity = lerp(prev.fogDensity, next.fogDensity);
            this._current.fogColor = lerpColor(prev.fogColor, next.fogColor);
            this._current.skyColor = lerpColor(prev.skyColor, next.skyColor);
            this._current.hemiIntensity = lerp(prev.hemiIntensity, next.hemiIntensity);
            this._current.sunIntensity = lerp(prev.sunIntensity, next.sunIntensity);
            this._current.muffledAcoustics = next.muffledAcoustics;
            this._current.rainActive = next.rainActive;
            this._current.dustActive = next.dustActive;
            this._current.lightningActive = next.lightningActive;

            if (this.transitionProgress >= 1.0) {
                this._syncAudio();
            }
        }
    }

    /**
     * Applies fog, lighting, and clear colors to Babylon scene and view.
     */
    _applyAtmosphereToScene() {
        if (!this.view || !this.scene || typeof BABYLON === 'undefined') return;

        const scene = this.scene;
        const view = this.view;
        const atm = this._current;

        // Ensure lights reference is available
        if (!view.hemi && scene.lights) {
            view.hemi = scene.lights.find(l => l.name === 'hemi' || (l.getClassName && l.getClassName() === 'HemisphericLight'));
        }
        if (!view.sun && scene.lights) {
            view.sun = scene.lights.find(l => l.name === 'sun' || (l.getClassName && l.getClassName() === 'DirectionalLight'));
        }

        const self = /** @type {any} */ (this);
        const game = self.game || self.app?.game || (typeof window !== 'undefined' ? (/** @type {any} */ (window)).app?.game : null);
        const levelLighting = game?.level?.lighting;
        const cycleEnabled = levelLighting ? levelLighting.cycleEnabled !== false : (this.dayNightCycle ? !this.dayNightCycle.paused : true);

        // DayNightCycle ambient modulation (only when diurnal cycle is enabled)
        let dncMultiplier = 1.0;
        let dncSunMult = 1.0;
        let dncSkyTint = null;
        if (cycleEnabled && this.dayNightCycle) {
            if (typeof this.dayNightCycle.getAmbientMultiplier === 'function') {
                dncMultiplier = this.dayNightCycle.getAmbientMultiplier();
            }
            if (typeof this.dayNightCycle.getSunMultiplier === 'function') {
                dncSunMult = this.dayNightCycle.getSunMultiplier();
            }
            if (typeof this.dayNightCycle.getSkyTint === 'function') {
                dncSkyTint = this.dayNightCycle.getSkyTint();
            }
        }

        // Base lighting intensities from authored level settings or engine defaults
        const baseHemi = (levelLighting?.ambientIntensity != null)
            ? Number(levelLighting.ambientIntensity)
            : (typeof WORLD3D_SKYLIGHT_INTENSITY !== 'undefined' ? Number(WORLD3D_SKYLIGHT_INTENSITY) : 0.6);
        const baseSun = (levelLighting?.sunIntensity != null && levelLighting.sunEnabled !== false)
            ? Number(levelLighting.sunIntensity)
            : (levelLighting?.sunEnabled === false ? 0 : (typeof WORLD3D_SUN_INTENSITY !== 'undefined' ? Number(WORLD3D_SUN_INTENSITY) : 1.0));

        // Relative weather attenuation (1.0 for CLEAR)
        const weatherHemiFactor = atm.hemiIntensity / 0.45;
        const weatherSunFactor = atm.sunIntensity / 0.80;

        // Apply Fog density & color
        scene.fogDensity = atm.fogDensity;
        const fogR = dncSkyTint ? atm.fogColor.r * dncSkyTint.r : atm.fogColor.r;
        const fogG = dncSkyTint ? atm.fogColor.g * dncSkyTint.g : atm.fogColor.g;
        const fogB = dncSkyTint ? atm.fogColor.b * dncSkyTint.b : atm.fogColor.b;

        // Lightning flash spike
        const flash = this._lightningIntensity;
        const flashCol = Math.min(1.0, flash * 0.3);

        const finalFogR = Math.min(1.0, fogR * dncMultiplier + flashCol);
        const finalFogG = Math.min(1.0, fogG * dncMultiplier + flashCol * 1.05);
        const finalFogB = Math.min(1.0, fogB * dncMultiplier + flashCol * 1.15);

        if (scene.fogColor && scene.fogColor.set) {
            scene.fogColor.set(finalFogR, finalFogG, finalFogB);
        } else {
            scene.fogColor = new BABYLON.Color3(finalFogR, finalFogG, finalFogB);
        }

        // Apply Sky / clear color
        const skyR = Math.min(1.0, (dncSkyTint ? atm.skyColor.r * dncSkyTint.r : atm.skyColor.r) * dncMultiplier + flashCol);
        const skyG = Math.min(1.0, (dncSkyTint ? atm.skyColor.g * dncSkyTint.g : atm.skyColor.g) * dncMultiplier + flashCol * 1.05);
        const skyB = Math.min(1.0, (dncSkyTint ? atm.skyColor.b * dncSkyTint.b : atm.skyColor.b) * dncMultiplier + flashCol * 1.15);

        if (scene.clearColor && scene.clearColor.set) {
            scene.clearColor.set(skyR, skyG, skyB, 1.0);
        } else {
            scene.clearColor = new BABYLON.Color4(skyR, skyG, skyB, 1.0);
        }

        // Apply Hemispheric Light (sky light) with flash spike
        if (view.hemi) {
            view.hemi.intensity = Math.max(0, baseHemi * weatherHemiFactor * dncMultiplier + flash);
            if (flash > 0.1 && view.hemi.diffuse && view.hemi.diffuse.set) {
                view.hemi.diffuse.set(0.9, 0.95, 1.0);
            }
        }

        // Apply Directional Sun
        if (view.sun) {
            view.sun.intensity = Math.max(0, baseSun * weatherSunFactor * dncSunMult);
        }
    }

    // =========================================================================
    //  Integration Helpers
    // =========================================================================

    _detectIntegrations() {
        if (!this.app && typeof window !== 'undefined' && window.app) {
            this.app = window.app;
        }
        if (!this.view && this.app?.location?.view) {
            this.view = this.app.location.view;
            this.scene = this.view.scene;
        }
        // Detect DayNightCycle
        if (!this.dayNightCycle) {
            if (this.app && this.app.dayNightCycle) {
                this.dayNightCycle = this.app.dayNightCycle;
            } else if (typeof window !== 'undefined' && (/** @type {any} */ (window)).DayNightCycle) {
                this.dayNightCycle = (/** @type {any} */ (window)).DayNightCycle;
            }
        }

        // Detect ProceduralAudio
        if (!this.proceduralAudio) {
            if (this.app && (this.app.proceduralAudio || this.app.audio)) {
                this.proceduralAudio = this.app.proceduralAudio || this.app.audio;
            } else if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ProceduralAudio) {
                this.proceduralAudio = (/** @type {any} */ (window)).ProceduralAudio;
            }
        }
    }

    /**
     * Binds or updates the DayNightCycle integration.
     * @param {any} dnc
     */
    setDayNightCycle(dnc) {
        this.dayNightCycle = dnc;
        this._notifyDayNightCycle();
    }

    /**
     * Binds or updates the ProceduralAudio integration.
     * @param {any} audio
     */
    setProceduralAudio(audio) {
        this.proceduralAudio = audio;
        this._syncAudio();
    }

    _notifyDayNightCycle() {
        if (!this.dayNightCycle) return;
        const dnc = this.dayNightCycle;
        const modifiers = {
            state: this.currentState,
            sunMultiplier: this._current.sunIntensity,
            hemiMultiplier: this._current.hemiIntensity,
            fogDensity: this._current.fogDensity,
            fogColor: { ...this._current.fogColor },
            skyColor: { ...this._current.skyColor }
        };

        if (typeof dnc.setWeather === 'function') {
            dnc.setWeather(this.currentState, modifiers);
        } else if (typeof dnc.onWeatherChange === 'function') {
            dnc.onWeatherChange(this.currentState, modifiers);
        }
    }

    _syncAudio() {
        const audio = this.proceduralAudio;
        if (!audio) return;

        const state = this.currentState;
        const gust = this.getGustFactor();
        const strength = this.getWindStrength();

        // 1. High-level weather state hook
        if (typeof audio.setWeather === 'function') {
            audio.setWeather(state, {
                windStrength: strength,
                gustFactor: gust,
                muffled: this._current.muffledAcoustics,
                rainActive: this._current.rainActive,
                dustActive: this._current.dustActive
            });
        }

        // 2. Continuous wind modulation & howling
        if (typeof audio.setWind === 'function') {
            audio.setWind(strength / 140, gust);
        }
        if (state === WeatherSystem.STATES.DUST_STORM) {
            if (typeof audio.setWindHowl === 'function') {
                audio.setWindHowl(gust, strength);
            }
            if (typeof audio.modulateWind === 'function') {
                audio.modulateWind({ strength, gust, howling: true });
            }
        }

        // 3. Rain audio loop
        if (typeof audio.setRain === 'function') {
            audio.setRain(this._current.rainActive, { intensity: 1.0, acid: true });
        } else if (typeof audio.playRain === 'function' && this._current.rainActive) {
            audio.playRain();
        } else if (typeof audio.stopRain === 'function' && !this._current.rainActive) {
            audio.stopRain();
        }

        // 4. Muffled acoustics for DENSE_FOG
        const isMuffled = this._current.muffledAcoustics;
        if (typeof audio.setMuffled === 'function') {
            audio.setMuffled(isMuffled);
        }
        if (typeof audio.setAcoustics === 'function') {
            audio.setAcoustics({
                muffled: isMuffled,
                cutoff: isMuffled ? 650 : 20000
            });
        }
    }

    // =========================================================================
    //  Frame Update Loop
    // =========================================================================

    /**
     * Updates the weather simulation, wind vector, particle systems, lightning and audio.
     * @param {number} dt - Delta time in seconds (e.g. from requestAnimationFrame)
     */
    update(dt) {
        const clampedDt = Math.max(0, Math.min(1.0, dt));

        // Auto cycling if enabled
        if (this.autoCycle && this.cycleDuration > 0) {
            this._cycleTimer += clampedDt;
            if (this._cycleTimer >= this.cycleDuration) {
                this._cycleTimer = 0;
                const states = [
                    WeatherSystem.STATES.CLEAR,
                    WeatherSystem.STATES.DUST_STORM,
                    WeatherSystem.STATES.ACID_RAIN,
                    WeatherSystem.STATES.DENSE_FOG
                ];
                const currentIndex = states.indexOf(this.currentState);
                const nextState = states[(currentIndex + 1) % states.length];
                this.setWeather(nextState, 4.0);
            }
        }

        this._updateAtmosphereTransition(clampedDt);
        this._updateWind(clampedDt);
        this._updateLightning(clampedDt);
        this._updateParticles();
        this._applyAtmosphereToScene();

        // Audio continuous wind modulation
        if (this.proceduralAudio && typeof this.proceduralAudio.setWind === 'function') {
            this.proceduralAudio.setWind(this._windSpeed / 140, this._gustFactor);
        }
        if (this.currentState === WeatherSystem.STATES.DUST_STORM && this.proceduralAudio) {
            if (typeof this.proceduralAudio.modulateWind === 'function') {
                this.proceduralAudio.modulateWind({
                    strength: this._windSpeed,
                    gust: this._gustFactor,
                    howling: true
                });
            }
        }
    }

    /**
     * Disposes particle systems and textures.
     */
    dispose() {
        if (this._rainParticles) {
            this._rainParticles.dispose();
            this._rainParticles = null;
        }
        if (this._rippleParticles) {
            this._rippleParticles.dispose();
            this._rippleParticles = null;
        }
        if (this._dustParticles) {
            this._dustParticles.dispose();
            this._dustParticles = null;
        }
        if (this._rainTexture) {
            this._rainTexture.dispose();
            this._rainTexture = null;
        }
        if (this._dustTexture) {
            this._dustTexture.dispose();
            this._dustTexture = null;
        }
        if (this._rippleTexture) {
            this._rippleTexture.dispose();
            this._rippleTexture = null;
        }
        this._particlesReady = false;
    }
}

// Browser & Node.js test environment exposure
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).WeatherSystem = WeatherSystem;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).WeatherSystem = WeatherSystem;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WeatherSystem };
}
