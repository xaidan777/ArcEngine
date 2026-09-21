/**
 * @file DayNightCycle.js
 * @description Diurnal 24-hour cycle system for ArcEngine:
 * - Continuous 24-hour day/night loop (12-minute default real-time duration or customizable).
 * - Realistic solar position calculation (360° azimuth rotation, elevation curve: 0° dawn, 65° noon zenith, 0° dusk, -30° night).
 * - Sky and lighting color gradients for Dawn, Midday, Dusk, and Night.
 * - Night mode enhancements for machine searchlights and emissive materials.
 * - Integration with World3D.applyLighting.
 */

(function () {
    'use strict';

    /**
     * @typedef {Object} DayNightCycleOptions
     * @property {number} [dayDurationSec=720] - Real-time duration of a 24-hour cycle in seconds (default: 720s = 12 minutes).
     * @property {number} [initialTime=12.0] - Starting time in hours (0.0 to 24.0, default: 12.0 noon).
     * @property {number} [speedMultiplier=1.0] - Speed multiplier for time progression.
     * @property {number} [azimuthOffset=0.0] - Base azimuth offset in degrees.
     * @property {boolean} [paused=false] - Whether time progression is paused.
     * @property {number} [searchlightBoost=2.5] - Multiplier for searchlight emissive/alpha during night.
     * @property {number} [emissiveBoost=1.8] - Multiplier for general emissive materials during night.
     */

    /**
     * @typedef {Object} LightingKeyframe
     * @property {number} time - Hour (0 to 24).
     * @property {[number, number, number]} sky - Sky/fog RGB color [0..1].
     * @property {[number, number, number]} sunColor - Sun/moon diffuse RGB color [0..1].
     * @property {number} sunIntensity - Sun/moon light intensity.
     * @property {[number, number, number]} skyLight - Hemispheric sky light RGB [0..1].
     * @property {number} skyIntensity - Hemispheric sky light intensity.
     * @property {[number, number, number]} groundLight - Ground fill light RGB [0..1].
     * @property {[number, number, number]} shadowColor - Shadow tint RGB [0..1].
     * @property {number} shadowStrength - Shadow strength [0..1].
     * @property {number} shadowSoft - Shadow softness [0..3].
     * @property {number} fog - Fog density.
     */

    /**
     * Color gradient keyframes across the 24-hour cycle.
     * - Dawn (05:00 - 07:00): soft golden-rose sky, warm low-angle sunlight, long shadows, dense morning mist.
     * - Midday (07:00 - 17:00): harsh desaturated wasteland sun, sharp dark shadows, clear horizon.
     * - Dusk (17:00 - 20:00): crimson-copper apocalyptic sunset, deep violet shadows.
     * - Night (20:00 - 05:00): dark midnight blue/black sky, pale moonlight, deep shadows.
     * @type {LightingKeyframe[]}
     */
    const KEYFRAMES = [
        // 00:00 - Midnight: dark midnight blue/black sky, pale moonlight, deep shadows
        {
            time: 0.0,
            sky: [0.02, 0.03, 0.06],             // #050810 - dark midnight blue/black
            sunColor: [0.55, 0.68, 0.90],        // #8cb0e6 - pale silvery moonlight
            sunIntensity: 0.22,                  // pale moonlight intensity
            skyLight: [0.04, 0.07, 0.14],        // #0a1224 - ambient night sky
            skyIntensity: 0.18,
            groundLight: [0.03, 0.04, 0.07],     // #080a12 - deep navy ground fill
            shadowColor: [0.01, 0.01, 0.03],     // #030308 - deep pitch shadows
            shadowStrength: 0.85,
            shadowSoft: 2.0,
            fog: 0.00075
        },
        // 04:00 - Pre-dawn night: cooling darkness before dawn moisture condensates
        {
            time: 4.0,
            sky: [0.04, 0.04, 0.08],             // #0a0a14
            sunColor: [0.55, 0.68, 0.90],
            sunIntensity: 0.20,
            skyLight: [0.05, 0.08, 0.15],
            skyIntensity: 0.20,
            groundLight: [0.03, 0.04, 0.08],
            shadowColor: [0.02, 0.02, 0.04],
            shadowStrength: 0.82,
            shadowSoft: 2.0,
            fog: 0.00110
        },
        // 05:00 - Dawn begins: soft golden-rose sky, warm low-angle sunlight, long shadows, dense morning mist
        {
            time: 5.0,
            sky: [0.78, 0.48, 0.45],             // #c77a73 - soft golden-rose sky
            sunColor: [1.0, 0.68, 0.35],         // #ffad59 - warm golden sunrise
            sunIntensity: 0.75,                  // warm low-angle sunlight breaking through
            skyLight: [0.82, 0.62, 0.55],        // #d19e8c - soft morning ambient
            skyIntensity: 0.38,
            groundLight: [0.28, 0.20, 0.15],     // #473326 - warm earth
            shadowColor: [0.10, 0.12, 0.22],     // #1a1f38 - cool blue-violet long shadows
            shadowStrength: 0.65,
            shadowSoft: 1.5,
            fog: 0.00160                         // dense morning mist!
        },
        // 06:00 - Peak Dawn: glowing golden-rose horizon, long warm shadows
        {
            time: 6.0,
            sky: [0.88, 0.60, 0.48],             // #e0997a - glowing golden-rose
            sunColor: [1.0, 0.76, 0.46],         // #ffc275 - warm low-angle sunlight
            sunIntensity: 1.35,
            skyLight: [0.82, 0.72, 0.65],        // #d1b8a6
            skyIntensity: 0.42,
            groundLight: [0.34, 0.26, 0.20],     // #574233
            shadowColor: [0.09, 0.13, 0.24],     // #17213d - long cool shadows
            shadowStrength: 0.62,
            shadowSoft: 1.2,
            fog: 0.00140                         // dense morning mist
        },
        // 07:00 - Dawn ends / Midday begins: mist clearing to wasteland
        {
            time: 7.0,
            sky: [0.64, 0.75, 0.83],             // #a3bfd4 - transitioning to wasteland sky
            sunColor: [1.0, 0.94, 0.82],         // #fff0d1
            sunIntensity: 1.75,
            skyLight: [0.70, 0.80, 0.88],        // #b3cce0
            skyIntensity: 0.46,
            groundLight: [0.40, 0.38, 0.32],     // #666152
            shadowColor: [0.06, 0.17, 0.25],     // #0f2b40
            shadowStrength: 0.56,
            shadowSoft: 1.0,
            fog: 0.00060                         // mist dissipating
        },
        // 12:00 - Midday Zenith: harsh desaturated wasteland sun, sharp dark shadows, clear horizon
        {
            time: 12.0,
            sky: [0.56, 0.70, 0.78],             // #8eb2c7 - harsh desaturated wasteland sky
            sunColor: [1.0, 0.97, 0.91],         // #fff7e8 - harsh desaturated wasteland sun
            sunIntensity: 2.10,                  // harsh high-noon wasteland sun
            skyLight: [0.65, 0.77, 0.86],        // #a6c4dc - desaturated sky fill
            skyIntensity: 0.50,
            groundLight: [0.45, 0.42, 0.35],     // #736b59 - wasteland dust reflection
            shadowColor: [0.04, 0.14, 0.20],     // #0a2433 - sharp dark shadows
            shadowStrength: 0.55,
            shadowSoft: 0.8,                     // sharp shadow edge
            fog: 0.00030                         // clear horizon!
        },
        // 15:00 - Afternoon Wasteland: intense sun, clear horizon
        {
            time: 15.0,
            sky: [0.58, 0.71, 0.77],             // #94b5c4
            sunColor: [1.0, 0.95, 0.86],         // #fff2dc
            sunIntensity: 1.95,
            skyLight: [0.65, 0.76, 0.84],        // #a6c2d6
            skyIntensity: 0.48,
            groundLight: [0.44, 0.40, 0.33],     // #706654
            shadowColor: [0.05, 0.15, 0.22],     // #0d2638
            shadowStrength: 0.56,
            shadowSoft: 1.0,
            fog: 0.00035                         // clear horizon
        },
        // 17:00 - Midday ends / Dusk begins: warm shift on the horizon
        {
            time: 17.0,
            sky: [0.72, 0.58, 0.48],             // #b8947a - golden afternoon warmth
            sunColor: [1.0, 0.82, 0.55],         // #ffd18c - copper sun
            sunIntensity: 1.60,
            skyLight: [0.72, 0.62, 0.55],        // #b89e8c
            skyIntensity: 0.44,
            groundLight: [0.38, 0.30, 0.24],     // #614d3d
            shadowColor: [0.10, 0.10, 0.22],     // #1a1a38 - beginning violet cast
            shadowStrength: 0.60,
            shadowSoft: 1.2,
            fog: 0.00055
        },
        // 18.3: 18:18 - Peak Dusk: crimson-copper apocalyptic sunset, deep violet shadows
        {
            time: 18.3,
            sky: [0.80, 0.32, 0.20],             // #cc5233 - crimson-copper apocalyptic sunset
            sunColor: [1.0, 0.38, 0.14],         // #ff6124 - intense copper-crimson sun
            sunIntensity: 1.25,
            skyLight: [0.68, 0.34, 0.28],        // #ad5747 - fiery ambient
            skyIntensity: 0.38,
            groundLight: [0.30, 0.16, 0.12],     // #4d291f - dark burnt copper earth
            shadowColor: [0.17, 0.07, 0.24],     // #2b123d - deep violet shadows!
            shadowStrength: 0.70,
            shadowSoft: 1.5,
            fog: 0.00080
        },
        // 19:00 - Sunset at horizon: apocalyptic crimson-violet afterglow
        {
            time: 19.0,
            sky: [0.55, 0.16, 0.22],             // #8c2938 - deep crimson-violet
            sunColor: [0.88, 0.24, 0.10],        // #e03d1a - deep ember sun
            sunIntensity: 0.60,
            skyLight: [0.44, 0.16, 0.24],        // #70293d
            skyIntensity: 0.28,
            groundLight: [0.22, 0.10, 0.10],     // #381a1a
            shadowColor: [0.15, 0.05, 0.22],     // #260d38 - deep violet shadows
            shadowStrength: 0.74,
            shadowSoft: 1.8,
            fog: 0.00095
        },
        // 20:00 - Dusk ends / Night begins: dark midnight blue/black sky, pale moonlight, deep shadows
        {
            time: 20.0,
            sky: [0.08, 0.10, 0.18],             // #141a2e - twilight fading to midnight blue
            sunColor: [0.55, 0.68, 0.90],        // #8cb0e6 - pale moonlight taking over
            sunIntensity: 0.25,                  // pale moonlight
            skyLight: [0.08, 0.10, 0.20],        // #141a33
            skyIntensity: 0.22,
            groundLight: [0.06, 0.07, 0.13],     // #0f1221
            shadowColor: [0.04, 0.04, 0.08],     // #0a0a14 - deep night shadows
            shadowStrength: 0.80,
            shadowSoft: 2.0,
            fog: 0.00075
        },
        // 22:00 - Deep Night: dark midnight blue/black, pale moonlight, deep shadows
        {
            time: 22.0,
            sky: [0.03, 0.04, 0.09],             // #080a17 - dark midnight blue/black
            sunColor: [0.55, 0.68, 0.90],        // #8cb0e6 - pale moonlight
            sunIntensity: 0.24,
            skyLight: [0.05, 0.08, 0.15],        // #0d1426
            skyIntensity: 0.19,
            groundLight: [0.03, 0.04, 0.08],     // #080a14
            shadowColor: [0.01, 0.01, 0.03],     // #030308 - deep shadows
            shadowStrength: 0.84,
            shadowSoft: 2.0,
            fog: 0.00070
        },
        // 24:00 - Midnight wrap: identical to 00:00 for seamless interpolation
        {
            time: 24.0,
            sky: [0.02, 0.03, 0.06],
            sunColor: [0.55, 0.68, 0.90],
            sunIntensity: 0.22,
            skyLight: [0.04, 0.07, 0.14],
            skyIntensity: 0.18,
            groundLight: [0.03, 0.04, 0.07],
            shadowColor: [0.01, 0.01, 0.03],
            shadowStrength: 0.85,
            shadowSoft: 2.0,
            fog: 0.00075
        }
    ];

    /**
     * Clamps a number between min and max.
     * @param {number} v
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    /**
     * Linear interpolation between a and b.
     * @param {number} a
     * @param {number} b
     * @param {number} t
     * @returns {number}
     */
    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /**
     * Smooth Hermite interpolation (smoothstep) between 0 and 1.
     * @param {number} t
     * @returns {number}
     */
    function smoothstep(t) {
        const c = clamp(t, 0, 1);
        return c * c * (3 - 2 * c);
    }

    /**
     * Converts RGB float array [0..1, 0..1, 0..1] to integer hex color (0xRRGGBB).
     * @param {[number, number, number]} rgb
     * @returns {number}
     */
    function rgbToHexInt(rgb) {
        const r = clamp(Math.round(rgb[0] * 255), 0, 255);
        const g = clamp(Math.round(rgb[1] * 255), 0, 255);
        const b = clamp(Math.round(rgb[2] * 255), 0, 255);
        return ((r << 16) | (g << 8) | b) >>> 0;
    }

    /**
     * Converts RGB float array [0..1, 0..1, 0..1] to hex string '#rrggbb'.
     * @param {[number, number, number]} rgb
     * @returns {string}
     */
    function rgbToHexString(rgb) {
        const hex = rgbToHexInt(rgb).toString(16).padStart(6, '0');
        return '#' + hex;
    }

    /**
     * Interpolates between two RGB arrays.
     * @param {[number, number, number]} a
     * @param {[number, number, number]} b
     * @param {number} t
     * @returns {[number, number, number]}
     */
    function lerpRgb(a, b, t) {
        return [
            lerp(a[0], b[0], t),
            lerp(a[1], b[1], t),
            lerp(a[2], b[2], t)
        ];
    }

    /**
     * DayNightCycle: Manages 24-hour diurnal cycle, solar calculations,
     * sky/lighting color gradients, and night mode enhancements.
     */
    class DayNightCycle {
        /**
         * @param {DayNightCycleOptions} [options={}]
         */
        constructor(options = {}) {
            /** @type {number} Real-time duration of a 24h cycle in seconds (default: 720s = 12 min) */
            this.dayDurationSec = options.dayDurationSec != null ? Math.max(1, options.dayDurationSec) : 720;

            /** @type {number} Speed multiplier for time progression */
            this.speedMultiplier = options.speedMultiplier != null ? options.speedMultiplier : 1.0;

            /** @type {number} Azimuth offset in degrees */
            this.azimuthOffset = options.azimuthOffset != null ? options.azimuthOffset : 0.0;

            /** @type {boolean} Whether time progression is paused */
            this.paused = !!options.paused;

            /** @type {number} Multiplier for searchlight emissive & alpha at night */
            this.searchlightBoost = options.searchlightBoost != null ? options.searchlightBoost : 2.5;

            /** @type {number} Multiplier for general emissive materials at night */
            this.emissiveBoost = options.emissiveBoost != null ? options.emissiveBoost : 1.8;

            /** @type {number} Current time in hours (0.0 to 24.0) */
            this.time = 12.0;

            /** @type {number} Calculated solar azimuth in degrees */
            this.sunAz = 180.0;

            /** @type {number} Calculated solar elevation in degrees */
            this.sunEl = 65.0;

            /** @type {Record<string, any> | null} Cached lighting state */
            this._lightingState = null;

            // Initialize to specified starting time (default noon 12:00)
            const initTime = options.initialTime != null ? options.initialTime : 12.0;
            this.setTime(initTime);
        }

        /**
         * Advances the diurnal cycle by dt seconds.
         * @param {number} dt - Delta time in seconds.
         * @returns {this}
         */
        update(dt) {
            if (this.paused || !dt || dt <= 0) return this;
            const deltaHours = (dt / this.dayDurationSec) * 24.0 * this.speedMultiplier;
            return this.setTime(this.time + deltaHours);
        }

        /**
         * Sets the cycle time in hours (0.0 to 24.0).
         * Wraps around automatically if < 0 or >= 24.
         * @param {number} hours - Time in hours.
         * @returns {this}
         */
        setTime(hours) {
            if (typeof hours !== 'number' || isNaN(hours)) return this;
            this.time = ((hours % 24.0) + 24.0) % 24.0;
            this._calculateSolarPosition();
            this._updateLightingState();
            return this;
        }

        /**
         * Gets the current cycle time in hours (0.0 <= time < 24.0).
         * @returns {number}
         */
        getTime() {
            return this.time;
        }

        /**
         * Gets the current cycle time formatted as a 24-hour string "HH:MM".
         * @returns {string}
         */
        getTimeFormatted() {
            const h = Math.floor(this.time);
            const m = Math.floor((this.time % 1) * 60);
            return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        }

        /**
         * Checks if the current time is night (20:00 to 05:00).
         * @returns {boolean}
         */
        isNight() {
            return this.time >= 20.0 || this.time < 5.0;
        }

        /**
         * Returns the night factor from 0.0 (full day) to 1.0 (full night).
         * Ramps smoothly during dusk (17:00 - 20:00) and dawn (05:00 - 07:00).
         * @returns {number}
         */
        getNightFactor() {
            const t = this.time;
            if (t >= 20.0 || t < 5.0) {
                return 1.0;
            }
            if (t >= 17.0 && t < 20.0) {
                // Dusk: 17:00 (0.0) -> 20:00 (1.0)
                return smoothstep((t - 17.0) / 3.0);
            }
            if (t >= 5.0 && t < 7.0) {
                // Dawn: 05:00 (1.0) -> 07:00 (0.0)
                return 1.0 - smoothstep((t - 5.0) / 2.0);
            }
            return 0.0;
        }

        /**
         * Returns the current period name: 'dawn' | 'midday' | 'dusk' | 'night'.
         * @returns {'dawn' | 'midday' | 'dusk' | 'night'}
         */
        getPeriod() {
            const t = this.time;
            if (t >= 5.0 && t < 7.0) return 'dawn';
            if (t >= 7.0 && t < 17.0) return 'midday';
            if (t >= 17.0 && t < 20.0) return 'dusk';
            return 'night';
        }

        /**
         * Calculates solar azimuth and elevation.
         * - Azimuth rotates 360 degrees.
         * - Elevation:
         *   - rises at dawn (05:00, el: 0 deg)
         *   - reaches zenith at noon (12:00, el: 65 deg)
         *   - sets at dusk (19:00, el: 0 deg)
         *   - dips below horizon at night (-30 deg at midnight)
         * @private
         */
        _calculateSolarPosition() {
            const t = this.time;

            // 1. Azimuth: rotates 360 degrees continuously over 24 hours
            const az = ((t / 24.0) * 360.0 + this.azimuthOffset) % 360.0;
            this.sunAz = (az + 360.0) % 360.0;

            // 2. Elevation:
            if (t >= 5.0 && t <= 19.0) {
                // Daytime (05:00 to 19:00, 14 hours total):
                // 05:00 -> progress = 0.0, sin(0) = 0.0°
                // 12:00 -> progress = 0.5, sin(pi/2) = 65.0°
                // 19:00 -> progress = 1.0, sin(pi) = 0.0°
                const progress = (t - 5.0) / 14.0;
                this.sunEl = 65.0 * Math.sin(progress * Math.PI);
            } else {
                // Nighttime (19:00 to 05:00, 10 hours total):
                // 19:00 -> nightProgress = 0.0, -30 * sin(0) = 0.0°
                // 00:00 -> nightProgress = 0.5, -30 * sin(pi/2) = -30.0°
                // 05:00 -> nightProgress = 1.0, -30 * sin(pi) = 0.0°
                const nightProgress = t >= 19.0
                    ? (t - 19.0) / 10.0
                    : (t + 5.0) / 10.0;
                this.sunEl = -30.0 * Math.sin(nightProgress * Math.PI);
            }
        }

        /**
         * Recomputes lighting state by interpolating between color keyframes.
         * @private
         */
        _updateLightingState() {
            const t = this.time;

            // Find surrounding keyframes
            let k0 = KEYFRAMES[0];
            let k1 = KEYFRAMES[KEYFRAMES.length - 1];

            for (let i = 0; i < KEYFRAMES.length - 1; i++) {
                if (t >= KEYFRAMES[i].time && t <= KEYFRAMES[i + 1].time) {
                    k0 = KEYFRAMES[i];
                    k1 = KEYFRAMES[i + 1];
                    break;
                }
            }

            const span = k1.time - k0.time;
            const u = span > 0 ? (t - k0.time) / span : 0;
            const s = smoothstep(u);

            // Interpolate colors and scalar values
            const skyRgb = lerpRgb(k0.sky, k1.sky, s);
            const sunRgb = lerpRgb(k0.sunColor, k1.sunColor, s);
            const skyLightRgb = lerpRgb(k0.skyLight, k1.skyLight, s);
            const groundLightRgb = lerpRgb(k0.groundLight, k1.groundLight, s);
            const shadowRgb = lerpRgb(k0.shadowColor, k1.shadowColor, s);

            const sunIntensity = lerp(k0.sunIntensity, k1.sunIntensity, s);
            const skyIntensity = lerp(k0.skyIntensity, k1.skyIntensity, s);
            const shadowStrength = lerp(k0.shadowStrength, k1.shadowStrength, s);
            const shadowSoft = lerp(k0.shadowSoft, k1.shadowSoft, s);
            const fog = lerp(k0.fog, k1.fog, s);

            const isNight = this.isNight();
            const nightFactor = this.getNightFactor();
            const period = this.getPeriod();

            this._lightingState = {
                // Solar & celestial angles
                sunAz: this.sunAz,
                sunEl: this.sunEl,

                // Sun / celestial light
                sunIntensity: sunIntensity,
                sunColor: rgbToHexInt(sunRgb),
                sunColorHex: rgbToHexString(sunRgb),

                // Sky & ambient light
                skyIntensity: skyIntensity,
                skyLight: rgbToHexInt(skyLightRgb),
                skyLightHex: rgbToHexString(skyLightRgb),
                groundLight: rgbToHexInt(groundLightRgb),
                groundLightHex: rgbToHexString(groundLightRgb),
                sky: rgbToHexInt(skyRgb),
                skyHex: rgbToHexString(skyRgb),
                fog: fog,

                // Shadows (compatible with World3D.applyLighting & ArcToonPlugin)
                shadowColor: rgbToHexInt(shadowRgb),
                shadowColorHex: rgbToHexString(shadowRgb),
                shadowStrength: shadowStrength,
                shadowSoft: shadowSoft,
                shadowRadius: 840,
                shadowBias: 0.001,
                shadowNormalBias: 0.25,

                // Night mode state
                isNight: isNight,
                nightFactor: nightFactor,
                period: period,
                time: this.time,
                timeFormatted: this.getTimeFormatted()
            };
        }

        /**
         * Returns the current lighting state configuration object.
         * The returned object is directly compatible with World3D.applyLighting(c).
         * @returns {Record<string, any>}
         */
        getLightingState() {
            if (!this._lightingState) {
                this._updateLightingState();
            }
            return Object.assign({}, this._lightingState);
        }

        /**
         * Returns the downward vector where the sun shines:
         * (cos(az) * cos(el), -sin(el), sin(az) * cos(el)).
         * Compatible with World3D.sunDirection(c).
         * Returns a BABYLON.Vector3 if BABYLON is available, otherwise { x, y, z }.
         * @returns {any}
         */
        getSunDirection() {
            const azRad = this.sunAz * Math.PI / 180.0;
            const elRad = this.sunEl * Math.PI / 180.0;
            const ce = Math.cos(elRad);
            const x = Math.cos(azRad) * ce;
            const y = -Math.sin(elRad);
            const z = Math.sin(azRad) * ce;

            if (typeof BABYLON !== 'undefined' && BABYLON.Vector3) {
                return new BABYLON.Vector3(x, y, z);
            }
            return { x, y, z };
        }

        /**
         * Enhances searchlight beams and emissive materials during night.
         * - Machine searchlight cones/materials: boosts alpha (opacity) and emissive brightness so beams pierce darkness.
         * - General emissive materials: boosts emissive intensity against the dark apocalyptic night.
         * @param {any} scene - Babylon scene or container with materials / meshes.
         * @param {number} nightFactor - 0.0 (day) to 1.0 (night).
         */
        boostNightElements(scene, nightFactor) {
            if (!scene || !scene.materials) return;
            const sBoost = this.searchlightBoost;
            const eBoost = this.emissiveBoost;

            const materials = scene.materials;
            for (let i = 0; i < materials.length; i++) {
                const mat = materials[i];
                if (!mat) continue;

                const name = (mat.name || '').toLowerCase();
                const isSearchlight = /searchlight|spotter-light|light-cone|beam/i.test(name);

                // 1. Searchlight beam alpha boost (cone opacity)
                if (isSearchlight && typeof mat.alpha === 'number') {
                    if (mat._dncBaseAlpha === undefined) {
                        mat._dncBaseAlpha = mat.alpha;
                    }
                    if (mat._dncLastAppliedAlpha !== undefined && Math.abs(mat.alpha - mat._dncLastAppliedAlpha) > 0.001) {
                        mat._dncBaseAlpha = mat.alpha;
                    }
                    // Boost alpha from daytime translucency (e.g. 0.22) up to ~0.60+ in deep night
                    const targetAlpha = clamp(mat._dncBaseAlpha + nightFactor * 0.38, 0.0, 0.90);
                    mat.alpha = targetAlpha;
                    mat._dncLastAppliedAlpha = targetAlpha;
                }

                // 2. Emissive material boost
                if (mat.emissiveColor) {
                    if (!mat._dncBaseEmissive) {
                        mat._dncBaseEmissive = {
                            r: mat.emissiveColor.r,
                            g: mat.emissiveColor.g,
                            b: mat.emissiveColor.b
                        };
                    }
                    if (mat._dncLastAppliedEmissive) {
                        const changedExternally =
                            Math.abs(mat.emissiveColor.r - mat._dncLastAppliedEmissive.r) > 0.01 ||
                            Math.abs(mat.emissiveColor.g - mat._dncLastAppliedEmissive.g) > 0.01 ||
                            Math.abs(mat.emissiveColor.b - mat._dncLastAppliedEmissive.b) > 0.01;
                        if (changedExternally) {
                            mat._dncBaseEmissive = {
                                r: mat.emissiveColor.r,
                                g: mat.emissiveColor.g,
                                b: mat.emissiveColor.b
                            };
                        }
                    }

                    const base = mat._dncBaseEmissive;
                    if (base.r > 0.001 || base.g > 0.001 || base.b > 0.001) {
                        const mult = isSearchlight
                            ? 1.0 + nightFactor * (sBoost - 1.0)
                            : 1.0 + nightFactor * (eBoost - 1.0);

                        mat.emissiveColor.r = base.r * mult;
                        mat.emissiveColor.g = base.g * mult;
                        mat.emissiveColor.b = base.b * mult;

                        mat._dncLastAppliedEmissive = {
                            r: mat.emissiveColor.r,
                            g: mat.emissiveColor.g,
                            b: mat.emissiveColor.b
                        };
                    }
                }
            }
        }

        /**
         * Applies the diurnal lighting state to a View3D or Scene instance.
         * 1. Calls view3d.applyLighting(state) if available.
         * 2. Enhances machine searchlights and emissive materials during night.
         * @param {any} view3d - View3D instance (from World3D.createView), or BABYLON.Scene.
         * @returns {Record<string, any> | null} Applied lighting state.
         */
        applyToScene(view3d) {
            if (!view3d) return null;
            const state = this.getLightingState();

            // Apply lighting to View3D
            if (typeof view3d.applyLighting === 'function') {
                view3d.applyLighting(state);
            }

            // Locate scene for night element enhancements
            const scene = view3d.scene || (view3d.materials ? view3d : null);
            if (scene) {
                this.boostNightElements(scene, state.nightFactor);
            }

            return state;
        }

        /**
         * Pauses cycle time progression.
         * @returns {this}
         */
        pause() {
            this.paused = true;
            return this;
        }

        /**
         * Resumes cycle time progression.
         * @returns {this}
         */
        resume() {
            this.paused = false;
            return this;
        }

        /**
         * Sets time speed multiplier.
         * @param {number} speed
         * @returns {this}
         */
        setSpeedMultiplier(speed) {
            if (typeof speed === 'number' && !isNaN(speed)) {
                this.speedMultiplier = Math.max(0, speed);
            }
            return this;
        }

        /**
         * Sets full 24-hour cycle duration in real seconds.
         * @param {number} seconds
         * @returns {this}
         */
        setDayDuration(seconds) {
            if (typeof seconds === 'number' && !isNaN(seconds)) {
                this.dayDurationSec = Math.max(1, seconds);
            }
            return this;
        }
    }

    // Expose / export
    if (typeof window !== 'undefined') {
        window.DayNightCycle = DayNightCycle;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DayNightCycle;
    }
})();
