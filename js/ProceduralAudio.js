// ============================================================================
//  ArcEngine — ProceduralAudio (Master Facade)
// ----------------------------------------------------------------------------
//  Master audio facade bundling all procedural Web Audio API submodules:
//    - ProceduralAudioCore    (AudioCore.js)
//    - ProceduralWeaponSynth  (WeaponSynth.js)
//    - ProceduralAmbienceSynth(AmbienceSynth.js)
//    - ProceduralFoleySynth   (FoleySynth.js)
//    - ProceduralCombatSynth  (CombatSynth.js)
//    - ProceduralArcSynth     (ArcMachineSynth.js)
//
//  100% procedural Web Audio API synthesis without external audio files.
//  Strictly valid vanilla ES/browser JavaScript with Node.js test compatibility.
// ============================================================================

/**
 * Master facade uniting all procedural audio synthesizers.
 */
class ProceduralAudioFacade {
    constructor() {
        /** @type {ProceduralAudioCore|null} */
        this._core = null;
        /** @type {ProceduralWeaponSynth|null} */
        this._weapon = null;
        /** @type {ProceduralAmbienceSynth|null} */
        this._ambience = null;
        /** @type {ProceduralFoleySynth|null} */
        this._foley = null;
        /** @type {ProceduralCombatSynth|null} */
        this._combat = null;
        /** @type {ProceduralArcSynth|null} */
        this._arc = null;

        this._initialized = false;
        this._masterVolume = 1.0;

        // Create bound proxies for submodules so they can be called directly
        // e.g. ProceduralAudio.weapon.play(...)
        this.weapon = this._createWeaponProxy();
        this.foley = this._createFoleyProxy();
        this.combat = this._createCombatProxy();
        this.arc = this._createArcProxy();
        this.ambience = this._createAmbienceProxy();
    }

    /**
     * Check if Web Audio API is supported.
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
     * Get or lazily create the shared ProceduralAudioCore instance.
     * @returns {any}
     */
    get core() {
        if (!this._core) {
            if (typeof ProceduralAudioCore !== 'undefined') {
                this._core = new ProceduralAudioCore({ autoUnlock: true, autoInit: true });
            } else if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ProceduralAudioCore) {
                const CoreClass = (/** @type {any} */ (window)).ProceduralAudioCore;
                this._core = new CoreClass({ autoUnlock: true, autoInit: true });
            }
        }
        return this._core;
    }

    /**
     * AudioContext instance accessor.
     * @returns {AudioContext|null}
     */
    get ctx() {
        return this.core ? (this.core.ctx || this.core.audioCtx) : null;
    }

    /**
     * Initialize master audio engine and all submodules.
     * Safe to call multiple times.
     * @param {AudioContext} [providedCtx]
     * @returns {boolean}
     */
    init(providedCtx) {
        if (this._initialized && this.ctx) return true;

        try {
            const core = this.core;
            if (core && typeof core.init === 'function') {
                core.init(providedCtx);
            }

            const activeCtx = this.ctx;

            // Initialize submodules with shared AudioContext / core
            this._getWeaponSynth(activeCtx);
            this._getAmbienceSynth(activeCtx);
            this._getFoleySynth(activeCtx);
            this._getCombatSynth(activeCtx);
            this._getArcSynth(activeCtx);

            this._initialized = true;
            return true;
        } catch (e) {
            console.warn('ProceduralAudio: initialization failed or restricted', e);
            return false;
        }
    }

    /**
     * Resume audio context on user gesture.
     * @returns {Promise<boolean>}
     */
    async resume() {
        if (this.core && typeof this.core.resume === 'function') {
            return await this.core.resume();
        }
        if (this.ctx && this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
            try {
                await this.ctx.resume();
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }

    /**
     * Set master audio volume (0.0 to 1.0).
     * @param {number} volume
     */
    setMasterVolume(volume) {
        this._masterVolume = Math.max(0, Math.min(1, volume));
        if (this.core && typeof this.core.setMasterVolume === 'function') {
            this.core.setMasterVolume(this._masterVolume);
        }
        if (this._combat && typeof this._combat.setMasterVolume === 'function') {
            this._combat.setMasterVolume(this._masterVolume);
        }
        if (this._foley && typeof this._foley.setMasterVolume === 'function') {
            this._foley.setMasterVolume(this._masterVolume);
        }
    }

    /**
     * Get current master volume.
     * @returns {number}
     */
    getMasterVolume() {
        return this._masterVolume;
    }

    /**
     * Continuous wind modulation from weather system.
     * @param {number} speed - 0..1
     * @param {number} gust - 0..1
     */
    setWind(speed, gust) {
        const amb = this._getAmbienceSynth();
        if (amb && typeof amb.setWind === 'function') {
            amb.setWind(speed, gust);
        }
    }

    /**
     * Modulate wind howling/gusts during storms.
     * @param {Object} params
     */
    modulateWind(params) {
        const amb = this._getAmbienceSynth();
        if (amb && typeof amb.modulateWind === 'function') {
            amb.modulateWind(params);
        }
    }

    /**
     * Update environmental weather parameters in ambience synth.
     * @param {Object} params
     */
    setWeather(params) {
        const amb = this._getAmbienceSynth();
        if (amb && typeof amb.setWeather === 'function') {
            amb.setWeather(params);
        }
    }

    /**
     * Update 3D listener position and orientation.
     * @param {Object} listenerData
     */
    updateListener(listenerData) {
        if (!listenerData) return;
        // 1. The Web Audio listener node (panning/HRTF for anything routed through it).
        if (this.core && typeof this.core.updateListener === 'function') {
            this.core.updateListener(listenerData);
        } else if (typeof ProceduralAudioCore !== 'undefined' && typeof ProceduralAudioCore.updateListener === 'function') {
            ProceduralAudioCore.updateListener(this.ctx, listenerData);
        }
        // 2. The spatial maths. `calculateSpatialParameters` reads `listenerPos` on the CORE to
        // decide gain/pan/audibility, and that core reads it in the kit's own map order:
        // `x = mapX`, `y = mapY`, `z = height`. Game.js supplies the listener in the same map
        // order for `y`/`z` but labels the third field `z` as the map coordinate, so the two
        // are untangled here, once, for every consumer.
        //
        // NOTE: the core's `listenerPos` is a plain {x, y, z} of NUMBERS. Handing it an object
        // (or handing the raw Web Audio order straight through) made the distance `NaN` and
        // silently silenced every positional sound, so the values are resolved explicitly.
        const listener = this.normalizeListener(listenerData);
        const core = this.core;
        if (core && typeof core.setListenerPosition === 'function') {
            core.setListenerPosition(listener.x, listener.y, listener.z,
                listenerData.forwardX, listenerData.forwardY, listenerData.forwardZ);
        }
        // 3. Per-synth listener mirrors. One signature everywhere — three NUMBERS in the kit's map
        // order (x = mapX, y = mapY, z = height) plus a heading. Sniffing the arity was not an
        // option: every one of these declares a defaulted `z`, so `fn.length` is 2 for all of
        // them and a length test would have passed an object as `x`, making the distance NaN.
        for (const synth of [this._weapon, this._arc, this._combat]) {
            if (!synth || typeof synth.setListenerPosition !== 'function') continue;
            synth.setListenerPosition(listener.x, listener.y, listener.z, listenerData.heading || 0);
        }
    }

    /**
     * Reduce the many shapes of a listener payload to the kit's map order.
     *
     * Accepted input (all three carry the same physical point):
     *   - Game.update():  { x: mapX, y: HEIGHT, z: mapY }
     *   - map order:      { x: mapX, y: mapY, z: height, h?: height }
     *   - a scene node:   { position: { x, y, z } }  (Babylon: y is height, z is mapY)
     *
     * @param {any} listenerData
     * @returns {{ x: number, y: number, z: number }}
     */
    normalizeListener(listenerData) {
        const data = (listenerData && listenerData.position) ? listenerData.position : (listenerData || {});
        const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
        // `h` is unambiguous: it is always the height, so it settles the y/z swap.
        if (typeof data.h === 'number' && Number.isFinite(data.h)) {
            return { x: num(data.x), y: num(data.y), z: num(data.h) };
        }
        // Game's own payload: the map coordinate arrives as `z` and the height as `y`.
        if (typeof data.z === 'number' && Number.isFinite(data.z)) {
            return { x: num(data.x), y: num(data.z), z: num(data.y) };
        }
        return { x: num(data.x), y: num(data.y), z: num(data.z) };
    }

    /**
     * Legacy sound playback helper for backward compatibility.
     * @param {any} [sound]
     * @param {number} [volume]
     * @param {number} [pitchVariance]
     */
    playSound(sound, volume = 0.2, pitchVariance = 0.08) {
        if (!sound) return;
        try {
            if (typeof sound.play === 'function') {
                sound.currentTime = 0;
                sound.volume = Math.max(0, Math.min(1, volume));
                const p = sound.play();
                if (p && p.catch) p.catch(() => {});
            }
        } catch { /* ignored */ }
    }

    // =========================================================================
    // Lazy Submodule Getters
    // =========================================================================

    _getWeaponSynth(ctx) {
        if (!this._weapon) {
            const activeCtx = ctx || this.ctx;
            const CoreOrCtx = this.core || activeCtx;
            if (typeof ProceduralWeaponSynth !== 'undefined') {
                this._weapon = new ProceduralWeaponSynth(CoreOrCtx);
            } else if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ProceduralWeaponSynth) {
                const WClass = (/** @type {any} */ (window)).ProceduralWeaponSynth;
                this._weapon = new WClass(CoreOrCtx);
            }
        }
        return this._weapon;
    }

    _getAmbienceSynth(ctx) {
        if (!this._ambience) {
            const activeCtx = ctx || this.ctx;
            const CoreOrCtx = this.core || activeCtx;
            if (typeof ProceduralAmbienceSynth !== 'undefined') {
                this._ambience = new ProceduralAmbienceSynth(CoreOrCtx);
            } else if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ProceduralAmbienceSynth) {
                const AClass = (/** @type {any} */ (window)).ProceduralAmbienceSynth;
                this._ambience = new AClass(CoreOrCtx);
            }
        }
        return this._ambience;
    }

    _getFoleySynth(ctx) {
        if (!this._foley) {
            const activeCtx = ctx || this.ctx;
            if (typeof ProceduralFoleySynth !== 'undefined') {
                this._foley = new ProceduralFoleySynth({ audioContext: activeCtx });
            } else if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ProceduralFoleySynth) {
                const FClass = (/** @type {any} */ (window)).ProceduralFoleySynth;
                this._foley = new FClass({ audioContext: activeCtx });
            }
        }
        return this._foley;
    }

    _getCombatSynth(ctx) {
        if (!this._combat) {
            const activeCtx = ctx || this.ctx;
            if (typeof ProceduralCombatSynth !== 'undefined') {
                this._combat = new ProceduralCombatSynth(activeCtx);
            } else if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ProceduralCombatSynth) {
                const CClass = (/** @type {any} */ (window)).ProceduralCombatSynth;
                this._combat = new CClass(activeCtx);
            }
        }
        return this._combat;
    }

    _getArcSynth(ctx) {
        if (!this._arc) {
            const activeCtx = ctx || this.ctx;
            if (typeof ProceduralArcSynth !== 'undefined') {
                this._arc = new ProceduralArcSynth(activeCtx);
            } else if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ProceduralArcSynth) {
                const ArcClass = (/** @type {any} */ (window)).ProceduralArcSynth;
                this._arc = new ArcClass(activeCtx);
            }
        }
        return this._arc;
    }

    // =========================================================================
    // Submodule Proxies with Convenient Unified APIs
    // =========================================================================

    _createWeaponProxy() {
        const self = this;
        return {
            get instance() { return self._getWeaponSynth(); },

            /**
             * Play gunshot audio based on caliber or weapon type.
             * @param {string} caliber - 'heavy_kinetic' | 'shotgun_shell' | 'light_kinetic' | 'energy_cell' | etc.
             * @param {Object} [pos] - 3D/2D position
             * @param {boolean} [isPlayer=true] - Local player vs enemy/distant
             * @param {number|string} [tier=2] - Weapon tier 1..4
             */
            play(caliber, pos = null, isPlayer = true, tier = 2) {
                const synth = self._getWeaponSynth();
                if (!synth) return null;
                const cal = (caliber || '').toLowerCase();

                if (cal.includes('shotgun') || cal === 'shotgun_shell') {
                    return synth.playShotgun ? synth.playShotgun(pos, isPlayer) : null;
                }
                if (cal.includes('revolver')) {
                    return synth.playRevolver ? synth.playRevolver(pos, isPlayer) : null;
                }
                if (cal.includes('smg') || cal === 'light_kinetic') {
                    return synth.playSMG ? synth.playSMG(pos, isPlayer) : null;
                }
                if (cal.includes('plasma') || cal.includes('energy') || cal === 'energy_cell') {
                    return synth.playPlasma ? synth.playPlasma(pos, isPlayer) : null;
                }
                // Default: Assault rifle (heavy_kinetic, high_caliber, etc.)
                return synth.playAssaultRifle ? synth.playAssaultRifle(pos, isPlayer, tier) : null;
            },

            playAssaultRifle(pos = null, isPlayer = true, tier = 2) {
                const synth = self._getWeaponSynth();
                return synth && synth.playAssaultRifle ? synth.playAssaultRifle(pos, isPlayer, tier) : null;
            },
            playShotgun(pos = null, isPlayer = true) {
                const synth = self._getWeaponSynth();
                return synth && synth.playShotgun ? synth.playShotgun(pos, isPlayer) : null;
            },
            playRevolver(pos = null, isPlayer = true) {
                const synth = self._getWeaponSynth();
                return synth && synth.playRevolver ? synth.playRevolver(pos, isPlayer) : null;
            },
            playSMG(pos = null, isPlayer = true) {
                const synth = self._getWeaponSynth();
                return synth && synth.playSMG ? synth.playSMG(pos, isPlayer) : null;
            },
            playPlasma(pos = null, isPlayer = true) {
                const synth = self._getWeaponSynth();
                return synth && synth.playPlasma ? synth.playPlasma(pos, isPlayer) : null;
            }
        };
    }

    _createFoleyProxy() {
        const self = this;
        return {
            get instance() { return self._getFoleySynth(); },

            /**
             * Play a footstep on a detected surface.
             * @param {string} [surface='concrete'] - 'dirt' | 'metal' | 'concrete' | 'gravel'
             * @param {Object} [options]
             */
            playFootstep(surface = 'concrete', options = {}) {
                const synth = self._getFoleySynth();
                return synth && synth.playFootstep ? synth.playFootstep(surface, options) : null;
            },
            playGearRustle(options = {}) {
                const synth = self._getFoleySynth();
                return synth && synth.playGearRustle ? synth.playGearRustle(options) : null;
            },
            playJumpLaunch(options = {}) {
                const synth = self._getFoleySynth();
                return synth && synth.playJumpLaunch ? synth.playJumpLaunch(options) : null;
            },
            playJumpLand(surface = 'concrete', options = {}) {
                const synth = self._getFoleySynth();
                return synth && synth.playJumpLand ? synth.playJumpLand(surface, options) : null;
            }
        };
    }

    _createCombatProxy() {
        const self = this;
        return {
            get instance() { return self._getCombatSynth(); },

            playMagOut() {
                const synth = self._getCombatSynth();
                return synth && synth.playMagOut ? synth.playMagOut() : null;
            },
            playMagIn() {
                const synth = self._getCombatSynth();
                return synth && synth.playMagIn ? synth.playMagIn() : null;
            },
            playBoltRack() {
                const synth = self._getCombatSynth();
                return synth && synth.playBoltRack ? synth.playBoltRack() : null;
            },
            playDryFire() {
                const synth = self._getCombatSynth();
                return synth && synth.playDryFire ? synth.playDryFire() : null;
            },
            playBulletWhiz(pos = null) {
                const synth = self._getCombatSynth();
                return synth && synth.playBulletWhiz ? synth.playBulletWhiz(pos) : null;
            },
            playRicochet(pos = null) {
                const synth = self._getCombatSynth();
                return synth && synth.playRicochet ? synth.playRicochet(pos) : null;
            },
            playImpact(surfaceType = 'concrete', pos = null) {
                const synth = self._getCombatSynth();
                return synth && synth.playImpact ? synth.playImpact(surfaceType, pos) : null;
            },
            playShieldHit() {
                const synth = self._getCombatSynth();
                return synth && synth.playShieldHit ? synth.playShieldHit() : null;
            },
            playShieldBreak() {
                const synth = self._getCombatSynth();
                return synth && synth.playShieldBreak ? synth.playShieldBreak() : null;
            },
            playShieldRecharge(active = true) {
                const synth = self._getCombatSynth();
                return synth && synth.playShieldRecharge ? synth.playShieldRecharge(active) : null;
            }
        };
    }

    _createArcProxy() {
        const self = this;
        return {
            get instance() { return self._getArcSynth(); },

            playCricketChitter(pos = null) {
                const synth = self._getArcSynth();
                return synth && synth.playCricketChitter ? synth.playCricketChitter(pos) : null;
            },
            playCricketLeapCharge(pos = null) {
                const synth = self._getArcSynth();
                return synth && synth.playCricketLeapCharge ? synth.playCricketLeapCharge(pos) : null;
            },
            playCricketLanding(pos = null) {
                const synth = self._getArcSynth();
                return synth && synth.playCricketLanding ? synth.playCricketLanding(pos) : null;
            },
            playScreamerStiltStep(pos = null) {
                const synth = self._getArcSynth();
                return synth && synth.playScreamerStiltStep ? synth.playScreamerStiltStep(pos) : null;
            },
            playScreamerScream(pos = null) {
                const synth = self._getArcSynth();
                return synth && synth.playScreamerScream ? synth.playScreamerScream(pos) : null;
            },
            playSpotterHover(pos = null) {
                const synth = self._getArcSynth();
                return synth && synth.playSpotterHover ? synth.playSpotterHover(pos) : null;
            },
            playSpotterSiren(pos = null) {
                const synth = self._getArcSynth();
                return synth && synth.playSpotterSiren ? synth.playSpotterSiren(pos) : null;
            },
            playSentinelStep(pos = null) {
                const synth = self._getArcSynth();
                return synth && synth.playSentinelStep ? synth.playSentinelStep(pos) : null;
            },
            playSentinelHorn(pos = null) {
                const synth = self._getArcSynth();
                return synth && synth.playSentinelHorn ? synth.playSentinelHorn(pos) : null;
            }
        };
    }

    _createAmbienceProxy() {
        const self = this;
        return {
            get instance() { return self._getAmbienceSynth(); },

            start() {
                const synth = self._getAmbienceSynth();
                return synth && synth.start ? synth.start() : null;
            },
            stop() {
                const synth = self._getAmbienceSynth();
                return synth && synth.stop ? synth.stop() : null;
            },
            setWind(speed, gust) {
                const synth = self._getAmbienceSynth();
                return synth && synth.setWind ? synth.setWind(speed, gust) : null;
            },
            modulateWind(params) {
                const synth = self._getAmbienceSynth();
                return synth && synth.modulateWind ? synth.modulateWind(params) : null;
            },
            setWeather(params) {
                const synth = self._getAmbienceSynth();
                return synth && synth.setWeather ? synth.setWeather(params) : null;
            },
            setVolume(vol) {
                const synth = self._getAmbienceSynth();
                return synth && synth.setVolume ? synth.setVolume(vol) : null;
            }
        };
    }

    /**
     * Clean up all audio resources.
     */
    dispose() {
        if (this._ambience && typeof this._ambience.dispose === 'function') {
            this._ambience.dispose();
        }
        if (this._arc && typeof this._arc.dispose === 'function') {
            this._arc.dispose();
        }
        if (this._core && typeof this._core.dispose === 'function') {
            this._core.dispose();
        }
        this._initialized = false;
    }
}

// Create master facade singleton
const ProceduralAudio = new ProceduralAudioFacade();

// Expose constructor on facade for flexibility
/** @type {any} */ (ProceduralAudio).ProceduralAudio = ProceduralAudioFacade;
/** @type {any} */ (ProceduralAudio).ProceduralAudioFacade = ProceduralAudioFacade;

// Global and module exports
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ProceduralAudio = ProceduralAudio;
    /** @type {any} */ (window).ProceduralAudioFacade = ProceduralAudioFacade;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).ProceduralAudio = ProceduralAudio;
    /** @type {any} */ (globalThis).ProceduralAudioFacade = ProceduralAudioFacade;
}
if (typeof module !== 'undefined' && module.exports) {
    /** @type {any} */ (module.exports).ProceduralAudio = ProceduralAudio;
    /** @type {any} */ (module.exports).ProceduralAudioFacade = ProceduralAudioFacade;
    /** @type {any} */ (module.exports).default = ProceduralAudio;
}
