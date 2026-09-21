/**
 * @file ArcPostProcess.js
 * @description Cinematic Post-Processing Pipeline for ArcEngine.
 *
 * Provides:
 * - Bloom / GlowLayer with configurable intensity, blur kernel size, and selective emissive masking
 *   (spotlights, laser tracers, glowing robot eyes and power cores).
 * - ACES Filmic Tone Mapping via Babylon ImageProcessingConfiguration with exposure and contrast controls.
 * - Cinematic Vignette with adjustable weight, color, and stretch.
 * - Atmospheric Presets: 'wasteland_noon', 'wasteland_sunset', 'radioactive_night', 'dust_storm', 'acid_rain'.
 * - Smooth parameter transitions across presets.
 * - Dynamic synchronization with DayNightCycle and WeatherSystem.
 * - Serialization via getSettings() and applySettings(json) for agent and tooling integration.
 * - Headless and BABYLON.NullEngine resilience for Node.js / CLI testing.
 */

(function () {
    'use strict';

    /**
     * @typedef {Object} Color4Like
     * @property {number} r - Red channel [0..1].
     * @property {number} g - Green channel [0..1].
     * @property {number} b - Blue channel [0..1].
     * @property {number} [a] - Alpha channel [0..1].
     */

    /**
     * @typedef {Object} ArcPostProcessPreset
     * @property {string} name - Identifier of the preset.
     * @property {string} description - Visual description.
     * @property {number} exposure - Target scene exposure.
     * @property {number} contrast - Target scene contrast.
     * @property {number} glowIntensity - Target bloom / glow intensity.
     * @property {number} blurKernelSize - Target blur kernel size for glow.
     * @property {number} vignetteWeight - Target vignette darkening weight.
     * @property {Color4Like} vignetteColor - Target vignette color.
     * @property {number} vignetteStretch - Target vignette stretch ratio.
     */

    /**
     * @typedef {Object} ArcPostProcessOptions
     * @property {string} [preset='wasteland_noon'] - Initial atmospheric preset name.
     * @property {number} [intensity=0.38] - Initial glow intensity.
     * @property {number} [blurKernelSize=32] - Initial glow blur kernel size.
     * @property {boolean} [selectiveMasking=true] - Whether selective emissive masking is active.
     * @property {number} [exposure=1.0] - Initial ACES tone mapping exposure.
     * @property {number} [contrast=1.12] - Initial tone mapping contrast.
     * @property {boolean} [vignetteEnabled=true] - Whether cinematic vignette is enabled.
     * @property {number} [vignetteWeight=0.65] - Initial vignette weight.
     * @property {Color4Like} [vignetteColor] - Initial vignette border color.
     * @property {number} [vignetteStretch=0.25] - Initial vignette stretch.
     * @property {boolean} [autoUpdate=true] - Automatically update transitions on scene render.
     */

    /**
     * @typedef {Object} PostProcessSettings
     * @property {string} preset - Current preset name.
     * @property {number} exposure - Current exposure.
     * @property {number} contrast - Current contrast.
     * @property {{ enabled: boolean, intensity: number, blurKernelSize: number, selectiveMasking: boolean }} glow - Glow settings.
     * @property {{ mode: string, scale: number, sharpen: boolean }} [dlss] - DLSS / DLAA settings.
     * @property {{ mode: string, ssao: boolean, ssr: boolean }} [rtx] - Pseudo-RTX settings.
     * @property {{ enabled: boolean, type: string }} toneMapping - Tone mapping settings.
     * @property {{ enabled: boolean, weight: number, stretch: number, color: Color4Like }} vignette - Vignette settings.
     * @property {boolean} isHeadless - Whether running in headless / NullEngine mode.
     */

    /**
     * Built-in atmospheric and color grading presets.
     * @type {Record<string, ArcPostProcessPreset>}
     */
    const PRESETS = {
        wasteland_noon: {
            name: 'wasteland_noon',
            description: 'Harsh high-noon sunlight over arid wasteland with crisp shadows and controlled bloom',
            exposure: 1.05,
            contrast: 1.15,
            glowIntensity: 0.35,
            blurKernelSize: 32,
            vignetteWeight: 0.60,
            vignetteColor: { r: 0.018, g: 0.022, b: 0.028, a: 1.0 },
            vignetteStretch: 0.25
        },
        wasteland_sunset: {
            name: 'wasteland_sunset',
            description: 'Deep crimson-amber golden hour with dramatic horizon bloom and long shadows',
            exposure: 0.92,
            contrast: 1.30,
            glowIntensity: 0.65,
            blurKernelSize: 40,
            vignetteWeight: 0.75,
            vignetteColor: { r: 0.042, g: 0.016, b: 0.022, a: 1.0 },
            vignetteStretch: 0.25
        },
        radioactive_night: {
            name: 'radioactive_night',
            description: 'Cold irradiated night with intense luminescent bloom from robot optics, cores, and tracers',
            exposure: 0.70,
            contrast: 1.35,
            glowIntensity: 0.85,
            blurKernelSize: 48,
            vignetteWeight: 0.85,
            vignetteColor: { r: 0.006, g: 0.018, b: 0.028, a: 1.0 },
            vignetteStretch: 0.25
        },
        dust_storm: {
            name: 'dust_storm',
            description: 'Choked sepia particulate storm with diffuse ambient scatter and heavy claustrophobic vignette',
            exposure: 0.85,
            contrast: 1.00,
            glowIntensity: 0.28,
            blurKernelSize: 56,
            vignetteWeight: 0.90,
            vignetteColor: { r: 0.048, g: 0.032, b: 0.016, a: 1.0 },
            vignetteStretch: 0.25
        },
        acid_rain: {
            name: 'acid_rain',
            description: 'Toxic slate-green downpour with specular reflection bloom and dark moody borders',
            exposure: 0.78,
            contrast: 1.20,
            glowIntensity: 0.55,
            blurKernelSize: 36,
            vignetteWeight: 0.80,
            vignetteColor: { r: 0.012, g: 0.028, b: 0.018, a: 1.0 },
            vignetteStretch: 0.25
        }
    };

    /**
     * Default regular expression masks for identifying meshes eligible for selective emissive bloom.
     */
    const DEFAULT_EMISSIVE_PATTERNS = [
        // Spotlights & Searchlight Cones
        /(?:^|[-_])(spotlight|searchlight|light-?cone|spotter-?cone|headlight|light-?beam)(?:[-_]|$)/i,
        // Laser Tracers & Projectiles
        /(?:^|[-_])(tracer|laser|plasma|projectile|bullet|bolt)(?:[-_]|$)/i,
        // Glowing Robot Eyes, Domes, Weakspot Cores
        /(?:^|[-_])(eye|sensor|spotter-?sensor|power-?core|weak-?core|weakspot|glow-?dome)(?:[-_]|$)/i
    ];

    /**
     * Linear interpolation helper.
     * @param {number} a
     * @param {number} b
     * @param {number} t
     * @returns {number}
     */
    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /**
     * Clamps a number between min and max.
     * @param {number} val
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    /**
     * Cinematic Post-Processing Pipeline for ArcEngine.
     */
    class ArcPostProcess {
        /** @type {ArcPostProcess|null} */
        static _activeInstance = null;

        /**
         * Available atmospheric presets dictionary.
         * @type {Record<string, ArcPostProcessPreset>}
         */
        static get PRESETS() {
            return PRESETS;
        }

        /**
         * Safely inspects whether an engine or scene is running in a headless / NullEngine environment.
         * @param {any} [sceneOrEngine]
         * @returns {boolean}
         */
        static detectHeadless(sceneOrEngine) {
            if (typeof window === 'undefined') return true;

            const engine = sceneOrEngine && typeof sceneOrEngine.getEngine === 'function'
                ? sceneOrEngine.getEngine()
                : sceneOrEngine;

            if (!engine) return true;

            if (typeof BABYLON !== 'undefined') {
                if (BABYLON.NullEngine && engine instanceof BABYLON.NullEngine) {
                    return true;
                }
            }

            if (typeof engine.getClassName === 'function' && engine.getClassName() === 'NullEngine') {
                return true;
            }

            if (typeof engine.getRenderingCanvas === 'function' && !engine.getRenderingCanvas()) {
                return true;
            }

            return false;
        }

        /**
         * Instantiates the post-processing pipeline for the given Babylon scene.
         * @param {any} [scene] - Babylon.js Scene instance.
         * @param {any | ArcPostProcessOptions} [cameraOrOptions={}] - Optional Babylon Camera or options.
         * @param {ArcPostProcessOptions} [options={}] - Pipeline configuration options when camera is provided.
         */
        constructor(scene = null, cameraOrOptions = {}, options = {}) {
            /** @type {any} */
            let opts = {};
            /** @type {any} */
            let cam = null;

            if (cameraOrOptions && (
                cameraOrOptions.camera ||
                cameraOrOptions.mode !== undefined ||
                cameraOrOptions.fov !== undefined ||
                (typeof cameraOrOptions.getClassName === 'function' && cameraOrOptions.getClassName().includes('Camera'))
            )) {
                cam = cameraOrOptions;
                opts = options || {};
            } else if (cameraOrOptions) {
                opts = cameraOrOptions;
                cam = opts.camera || (scene && scene.activeCamera) || null;
            }

            /** @type {any} */
            this.scene = scene;

            /** @type {any} */
            this.camera = cam;

            /** @type {boolean} */
            this.initialized = true;

            /** @type {boolean} */
            this.isHeadless = ArcPostProcess.detectHeadless(scene);

            const initialPreset = (opts.preset && PRESETS[opts.preset])
                ? PRESETS[opts.preset]
                : PRESETS.wasteland_noon;

            /** @type {string} */
            this.currentPreset = initialPreset.name;

            // Internal parameters
            this._intensity = typeof opts.intensity === 'number' ? opts.intensity : initialPreset.glowIntensity;
            this._blurKernelSize = typeof opts.blurKernelSize === 'number' ? opts.blurKernelSize : initialPreset.blurKernelSize;
            this._exposure = typeof opts.exposure === 'number' ? opts.exposure : initialPreset.exposure;
            this._contrast = typeof opts.contrast === 'number' ? opts.contrast : initialPreset.contrast;
            this._toneMappingEnabled = typeof opts.toneMappingEnabled === 'boolean' ? opts.toneMappingEnabled : true;
            this._vignetteEnabled = typeof opts.vignetteEnabled === 'boolean' ? opts.vignetteEnabled : true;
            this._vignetteWeight = typeof opts.vignetteWeight === 'number' ? opts.vignetteWeight : initialPreset.vignetteWeight;
            this._vignetteStretch = typeof opts.vignetteStretch === 'number' ? opts.vignetteStretch : initialPreset.vignetteStretch;

            const baseColor = opts.vignetteColor || initialPreset.vignetteColor;
            /** @type {Color4Like} */
            this._vignetteColor = {
                r: baseColor.r !== undefined ? baseColor.r : 0.018,
                g: baseColor.g !== undefined ? baseColor.g : 0.022,
                b: baseColor.b !== undefined ? baseColor.b : 0.028,
                a: baseColor.a !== undefined ? baseColor.a : 1.0
            };

            // Selective Masking structures
            /** @type {boolean} */
            this._selectiveMasking = typeof opts.selectiveMasking === 'boolean' ? opts.selectiveMasking : true;
            /** @type {Set<any>} */
            this._includedMeshes = new Set();
            /** @type {Map<any, Color4Like>} */
            this._meshColors = new Map();
            /** @type {Array<RegExp | string>} */
            this._maskPatterns = [...DEFAULT_EMISSIVE_PATTERNS];
            /** @type {((mesh: any, material: any) => boolean) | null} */
            this._selectivePredicate = null;

            // Transition state
            /** @type {any | null} */
            this._transition = null;

            // Babylon GlowLayer reference
            /** @type {any | null} */
            this.glowLayer = null;

            // Pseudo-RTX (SSAO 2.0 & SSR) and DLSS/DLAA references
            /** @type {any | null} */
            this.ssao2 = null;
            /** @type {any | null} */
            this.ssr = null;
            /** @type {any | null} */
            this.sharpen = null;
            /** @type {any | null} */
            this.fxaa = null;
            this._ssaoRatios = "";
            /** @type {'off'|'dlaa'|'quality'|'balanced'|'performance'} */
            this._dlssMode = 'off';
            /** @type {number} */
            this._renderScale = 1.0;
            /** @type {'off'|'medium'|'ultra'} */
            this._rtxMode = 'off';

            // Scene observer reference
            /** @type {any | null} */
            this._sceneObserver = null;

            // Initialize hardware & scene configurations
            this._initToneMappingAndVignette();
            this._initGlowLayer();

            if (opts.dlss || opts.dlssMode) {
                this.setDlssMode(opts.dlss || opts.dlssMode);
            }
            if (opts.rtx || opts.rtxMode) {
                this.setRtxMode(opts.rtx || opts.rtxMode);
            }

            // Auto-update transition hook if attached to scene
            if (opts.autoUpdate !== false && this.scene && this.scene.onBeforeRenderObservable) {
                try {
                    this._sceneObserver = this.scene.onBeforeRenderObservable.add(() => {
                        const engine = this.scene.getEngine ? this.scene.getEngine() : null;
                        const dt = engine && typeof engine.getDeltaTime === 'function'
                            ? engine.getDeltaTime() / 1000.0
                            : 0.016;
                        this.update(dt);
                    });
                } catch (_) {
                    this._sceneObserver = null;
                }
            }

            ArcPostProcess._activeInstance = this;
        }

        // =====================================================================
        //  Initialization & Hardware Setup
        // =====================================================================

        /**
         * Initializes ACES Filmic tone mapping and cinematic vignette on the scene's ImageProcessingConfiguration.
         * @private
         */
        _initToneMappingAndVignette() {
            const ipc = this._getImageProcessingConfig();
            if (!ipc) return;

            try {
                // ACES Filmic Tone Mapping
                ipc.toneMappingEnabled = this._toneMappingEnabled;
                if (typeof BABYLON !== 'undefined' && BABYLON.ImageProcessingConfiguration) {
                    ipc.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
                } else {
                    ipc.toneMappingType = 1; // Standard ACES constant
                }

                ipc.exposure = this._exposure;
                ipc.contrast = this._contrast;

                // Cinematic Vignette
                ipc.vignetteEnabled = this._vignetteEnabled;
                ipc.vignetteWeight = this._vignetteWeight;
                if (typeof ipc.vignetteStretch === 'number') {
                    ipc.vignetteStretch = this._vignetteStretch;
                }
                ipc.vignetteColor = this._createBabylonColor4(this._vignetteColor);
            } catch (err) {
                // Safe headless fallback
            }
        }

        /**
         * Initializes the Babylon GlowLayer with selective emissive masking.
         * @private
         */
        _initGlowLayer() {
            if (typeof BABYLON === 'undefined' || typeof BABYLON.GlowLayer !== 'function') {
                this.glowLayer = null;
                return;
            }
            if (!this.scene) {
                this.glowLayer = null;
                return;
            }

            try {
                this.glowLayer = new BABYLON.GlowLayer('arc-glow', this.scene, {
                    blurKernelSize: this._blurKernelSize
                });
                this.glowLayer.intensity = this._intensity;
                this._setupSelectiveMasking();
            } catch (err) {
                // Safe headless fallback if WebGL texture creation fails
                this.glowLayer = null;
            }
        }

        /**
         * Configures selective emissive masking selector on the GlowLayer.
         * @private
         */
        _setupSelectiveMasking() {
            if (!this.glowLayer) return;

            this.glowLayer.customEmissiveColorSelector = (mesh, subMesh, material, result) => {
                if (!result) return;

                if (!this._selectiveMasking) {
                    // Standard emissive behavior: respect material's emissive color
                    if (material && material.emissiveColor) {
                        result.set(
                            material.emissiveColor.r,
                            material.emissiveColor.g,
                            material.emissiveColor.b,
                            1.0
                        );
                    } else {
                        result.set(0, 0, 0, 0);
                    }
                    return;
                }

                if (this._isMeshEmissive(mesh, material)) {
                    const color = this._getMeshEmissiveColor(mesh, material);
                    result.set(
                        color.r,
                        color.g,
                        color.b,
                        color.a !== undefined ? color.a : 1.0
                    );
                } else {
                    // Excluded from glow layer
                    result.set(0, 0, 0, 0);
                }
            };
        }

        /**
         * Safely retrieves ImageProcessingConfiguration from the scene.
         * @returns {any | null}
         * @private
         */
        _getImageProcessingConfig() {
            if (!this.scene) return null;
            return this.scene.imageProcessingConfiguration || null;
        }

        /**
         * Creates a BABYLON.Color4 or a fallback object.
         * @param {Color4Like} color
         * @returns {any}
         * @private
         */
        _createBabylonColor4(color) {
            const a = color.a !== undefined ? color.a : 1.0;
            if (typeof BABYLON !== 'undefined' && typeof BABYLON.Color4 === 'function') {
                return new BABYLON.Color4(color.r, color.g, color.b, a);
            }
            return { r: color.r, g: color.g, b: color.b, a };
        }

        /**
         * Applies internal post-process properties to scene and glowLayer.
         * @private
         */
        _applyToScene() {
            const ipc = this._getImageProcessingConfig();
            if (ipc) {
                try {
                    ipc.toneMappingEnabled = this._toneMappingEnabled;
                    ipc.exposure = this._exposure;
                    ipc.contrast = this._contrast;
                    ipc.vignetteEnabled = this._vignetteEnabled;
                    ipc.vignetteWeight = this._vignetteWeight;
                    if (typeof ipc.vignetteStretch === 'number') {
                        ipc.vignetteStretch = this._vignetteStretch;
                    }
                    if (ipc.vignetteColor && typeof ipc.vignetteColor.set === 'function') {
                        ipc.vignetteColor.set(
                            this._vignetteColor.r,
                            this._vignetteColor.g,
                            this._vignetteColor.b,
                            this._vignetteColor.a !== undefined ? this._vignetteColor.a : 1.0
                        );
                    } else {
                        ipc.vignetteColor = this._createBabylonColor4(this._vignetteColor);
                    }
                } catch (_) {}
            }

            if (this.glowLayer) {
                try {
                    this.glowLayer.intensity = this._intensity;
                    if (this.glowLayer.blurKernelSize !== this._blurKernelSize) {
                        this.glowLayer.blurKernelSize = this._blurKernelSize;
                    }
                } catch (_) {}
            }
        }

        // =====================================================================
        //  Selective Emissive Masking
        // =====================================================================

        /**
         * Checks whether a mesh is eligible for selective glow.
         * @param {any} mesh
         * @param {any} material
         * @returns {boolean}
         * @private
         */
        _isMeshEmissive(mesh, material) {
            if (!mesh) return false;

            // 1. Explicit mesh inclusion
            if (this._includedMeshes.has(mesh)) return true;

            // 2. Mesh metadata flags
            const meta = mesh.metadata;
            if (meta && (meta.glow || meta.selectiveGlow || meta.emissive)) return true;

            // 3. Custom predicate filter
            if (typeof this._selectivePredicate === 'function') {
                try {
                    if (this._selectivePredicate(mesh, material)) return true;
                } catch (_) {}
            }

            // 4. Pattern matching on mesh name
            const meshName = mesh.name || '';
            for (let i = 0; i < this._maskPatterns.length; i++) {
                const pat = this._maskPatterns[i];
                if (pat instanceof RegExp) {
                    if (pat.test(meshName)) return true;
                } else if (typeof pat === 'string') {
                    if (meshName.toLowerCase().includes(pat.toLowerCase())) return true;
                }
            }

            // 5. Pattern matching on material name
            if (material && material.name) {
                const matName = material.name;
                for (let i = 0; i < this._maskPatterns.length; i++) {
                    const pat = this._maskPatterns[i];
                    if (pat instanceof RegExp) {
                        if (pat.test(matName)) return true;
                    } else if (typeof pat === 'string') {
                        if (matName.toLowerCase().includes(pat.toLowerCase())) return true;
                    }
                }
            }

            return false;
        }

        /**
         * Resolves emissive color for an eligible mesh.
         * @param {any} mesh
         * @param {any} material
         * @returns {Color4Like}
         * @private
         */
        _getMeshEmissiveColor(mesh, material) {
            // 1. Explicit registered color
            if (this._meshColors.has(mesh)) {
                return this._meshColors.get(mesh);
            }

            // 2. Metadata color
            if (mesh && mesh.metadata && mesh.metadata.glowColor) {
                return mesh.metadata.glowColor;
            }

            // 3. Material emissiveColor
            if (material && material.emissiveColor) {
                const ec = material.emissiveColor;
                if (ec.r > 0 || ec.g > 0 || ec.b > 0) {
                    return { r: ec.r, g: ec.g, b: ec.b, a: 1.0 };
                }
            }

            // 4. Material diffuseColor / albedoColor fallback (for cones and tracers)
            if (material) {
                const dc = material.diffuseColor || material.albedoColor;
                if (dc && (dc.r > 0 || dc.g > 0 || dc.b > 0)) {
                    return { r: dc.r, g: dc.g, b: dc.b, a: 1.0 };
                }
            }

            // Default luminous white
            return { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
        }

        /**
         * Registers a mesh to receive selective emissive glow, with optional color override.
         * @param {any} mesh - Target Babylon mesh.
         * @param {Color4Like} [color] - Optional emissive color override.
         * @returns {this}
         */
        addEmissiveMesh(mesh, color = null) {
            if (!mesh) return this;
            this._includedMeshes.add(mesh);
            if (color) {
                this._meshColors.set(mesh, {
                    r: color.r !== undefined ? color.r : 1.0,
                    g: color.g !== undefined ? color.g : 1.0,
                    b: color.b !== undefined ? color.b : 1.0,
                    a: color.a !== undefined ? color.a : 1.0
                });
            }
            return this;
        }

        /**
         * Unregisters a mesh from the selective glow set.
         * @param {any} mesh
         * @returns {boolean} True if the mesh was removed.
         */
        removeEmissiveMesh(mesh) {
            if (!mesh) return false;
            this._meshColors.delete(mesh);
            return this._includedMeshes.delete(mesh);
        }

        /**
         * Checks whether a mesh is in the explicit emissive set.
         * @param {any} mesh
         * @returns {boolean}
         */
        hasEmissiveMesh(mesh) {
            return this._includedMeshes.has(mesh);
        }

        /**
         * Adds a regex or string pattern for matching selective emissive mesh or material names.
         * @param {RegExp | string} pattern
         * @returns {this}
         */
        addMaskPattern(pattern) {
            if (pattern && !this._maskPatterns.includes(pattern)) {
                this._maskPatterns.push(pattern);
            }
            return this;
        }

        /**
         * Removes a mask pattern from the selective filter list.
         * @param {RegExp | string} pattern
         * @returns {boolean}
         */
        removeMaskPattern(pattern) {
            const idx = this._maskPatterns.indexOf(pattern);
            if (idx >= 0) {
                this._maskPatterns.splice(idx, 1);
                return true;
            }
            return false;
        }

        /**
         * Sets a custom predicate callback for determining emissive meshes.
         * @param {((mesh: any, material: any) => boolean) | null} predicate
         * @returns {this}
         */
        setSelectivePredicate(predicate) {
            this._selectivePredicate = predicate;
            return this;
        }

        /**
         * Enables or disables selective emissive masking.
         * @param {boolean} enabled
         * @returns {this}
         */
        setSelectiveMasking(enabled) {
            this._selectiveMasking = !!enabled;
            return this;
        }

        /**
         * Checks if selective emissive masking is active.
         * @returns {boolean}
         */
        isSelectiveMaskingEnabled() {
            return this._selectiveMasking;
        }

        // =====================================================================
        //  Glow / Bloom Layer Controls
        // =====================================================================

        /**
         * Gets the current glow intensity.
         * @returns {number}
         */
        get intensity() {
            return this._intensity;
        }

        /**
         * Sets the glow intensity.
         * @param {number} value
         */
        set intensity(value) {
            this._intensity = Math.max(0, value);
            if (this.glowLayer) {
                try {
                    this.glowLayer.intensity = this._intensity;
                } catch (_) {}
            }
        }

        /**
         * Sets the glow intensity (fluent API).
         * @param {number} value
         * @returns {this}
         */
        setIntensity(value) {
            this.intensity = value;
            return this;
        }

        /**
         * Gets the glow blur kernel size.
         * @returns {number}
         */
        get blurKernelSize() {
            return this._blurKernelSize;
        }

        /**
         * Sets the glow blur kernel size.
         * @param {number} value
         */
        set blurKernelSize(value) {
            this._blurKernelSize = Math.max(1, Math.round(value));
            if (this.glowLayer) {
                try {
                    this.glowLayer.blurKernelSize = this._blurKernelSize;
                } catch (_) {}
            }
        }

        /**
         * Sets the blur kernel size (fluent API).
         * @param {number} value
         * @returns {this}
         */
        setBlurKernelSize(value) {
            this.blurKernelSize = value;
            return this;
        }

        // =====================================================================
        //  ACES Filmic Tone Mapping Controls
        // =====================================================================

        /**
         * Gets scene exposure.
         * @returns {number}
         */
        get exposure() {
            return this._exposure;
        }

        /**
         * Sets scene exposure.
         * @param {number} value
         */
        set exposure(value) {
            this._exposure = Math.max(0, value);
            const ipc = this._getImageProcessingConfig();
            if (ipc) {
                try {
                    ipc.exposure = this._exposure;
                } catch (_) {}
            }
        }

        /**
         * Sets scene exposure (fluent API).
         * @param {number} value
         * @returns {this}
         */
        setExposure(value) {
            this.exposure = value;
            return this;
        }

        /**
         * Gets scene contrast.
         * @returns {number}
         */
        get contrast() {
            return this._contrast;
        }

        /**
         * Sets scene contrast.
         * @param {number} value
         */
        set contrast(value) {
            this._contrast = Math.max(0, value);
            const ipc = this._getImageProcessingConfig();
            if (ipc) {
                try {
                    ipc.contrast = this._contrast;
                } catch (_) {}
            }
        }

        /**
         * Sets scene contrast (fluent API).
         * @param {number} value
         * @returns {this}
         */
        setContrast(value) {
            this.contrast = value;
            return this;
        }

        /**
         * Gets whether tone mapping is enabled.
         * @returns {boolean}
         */
        get toneMappingEnabled() {
            return this._toneMappingEnabled;
        }

        /**
         * Sets whether tone mapping is enabled.
         * @param {boolean} value
         */
        set toneMappingEnabled(value) {
            this._toneMappingEnabled = !!value;
            const ipc = this._getImageProcessingConfig();
            if (ipc) {
                try {
                    ipc.toneMappingEnabled = this._toneMappingEnabled;
                } catch (_) {}
            }
        }

        /**
         * Sets whether tone mapping is enabled (fluent API).
         * @param {boolean} value
         * @returns {this}
         */
        setToneMappingEnabled(value) {
            this.toneMappingEnabled = value;
            return this;
        }

        // =====================================================================
        //  Cinematic Vignette Controls
        // =====================================================================

        /**
         * Gets whether vignette is enabled.
         * @returns {boolean}
         */
        get vignetteEnabled() {
            return this._vignetteEnabled;
        }

        /**
         * Sets whether vignette is enabled.
         * @param {boolean} value
         */
        set vignetteEnabled(value) {
            this._vignetteEnabled = !!value;
            const ipc = this._getImageProcessingConfig();
            if (ipc) {
                try {
                    ipc.vignetteEnabled = this._vignetteEnabled;
                } catch (_) {}
            }
        }

        /**
         * Sets vignette enabled state (fluent API).
         * @param {boolean} value
         * @returns {this}
         */
        setVignetteEnabled(value) {
            this.vignetteEnabled = value;
            return this;
        }

        /**
         * Gets vignette weight.
         * @returns {number}
         */
        get vignetteWeight() {
            return this._vignetteWeight;
        }

        /**
         * Sets vignette weight.
         * @param {number} value
         */
        set vignetteWeight(value) {
            this._vignetteWeight = Math.max(0, value);
            const ipc = this._getImageProcessingConfig();
            if (ipc) {
                try {
                    ipc.vignetteWeight = this._vignetteWeight;
                } catch (_) {}
            }
        }

        /**
         * Sets vignette weight (fluent API).
         * @param {number} value
         * @returns {this}
         */
        setVignetteWeight(value) {
            this.vignetteWeight = value;
            return this;
        }

        /**
         * Gets vignette border color.
         * @returns {Color4Like}
         */
        get vignetteColor() {
            return { ...this._vignetteColor };
        }

        /**
         * Sets vignette border color.
         * @param {Color4Like} value
         */
        set vignetteColor(value) {
            if (!value) return;
            this._vignetteColor = {
                r: value.r !== undefined ? value.r : 0,
                g: value.g !== undefined ? value.g : 0,
                b: value.b !== undefined ? value.b : 0,
                a: value.a !== undefined ? value.a : 1
            };
            const ipc = this._getImageProcessingConfig();
            if (ipc) {
                try {
                    if (ipc.vignetteColor && typeof ipc.vignetteColor.set === 'function') {
                        ipc.vignetteColor.set(
                            this._vignetteColor.r,
                            this._vignetteColor.g,
                            this._vignetteColor.b,
                            this._vignetteColor.a !== undefined ? this._vignetteColor.a : 1.0
                        );
                    } else {
                        ipc.vignetteColor = this._createBabylonColor4(this._vignetteColor);
                    }
                } catch (_) {}
            }
        }

        /**
         * Sets vignette color (fluent API).
         * @param {Color4Like} value
         * @returns {this}
         */
        setVignetteColor(value) {
            this.vignetteColor = value;
            return this;
        }

        /**
         * Gets vignette stretch ratio.
         * @returns {number}
         */
        get vignetteStretch() {
            return this._vignetteStretch;
        }

        /**
         * Sets vignette stretch ratio.
         * @param {number} value
         */
        set vignetteStretch(value) {
            this._vignetteStretch = Math.max(0, value);
            const ipc = this._getImageProcessingConfig();
            if (ipc && typeof ipc.vignetteStretch === 'number') {
                try {
                    ipc.vignetteStretch = this._vignetteStretch;
                } catch (_) {}
            }
        }

        /**
         * Configures all vignette parameters in one call.
         * @param {boolean} [enabled=true]
         * @param {number} [weight]
         * @param {Color4Like} [color]
         * @param {number} [stretch]
         * @returns {this}
         */
        setVignette(enabled = true, weight, color, stretch) {
            this.vignetteEnabled = enabled;
            if (typeof weight === 'number') this.vignetteWeight = weight;
            if (color) this.vignetteColor = color;
            if (typeof stretch === 'number') this.vignetteStretch = stretch;
            return this;
        }

        // =====================================================================
        //  Atmospheric Presets & Smooth Blending
        // =====================================================================

        /**
         * Returns a list of all registered preset names.
         * @returns {string[]}
         */
        getAvailablePresets() {
            return Object.keys(PRESETS);
        }

        /**
         * Retrieves a copy of a preset definition by name.
         * @param {string} name
         * @returns {ArcPostProcessPreset | null}
         */
        getPreset(name) {
            const p = PRESETS[name];
            return p ? { ...p, vignetteColor: { ...p.vignetteColor } } : null;
        }

        /**
         * Smoothly transitions the post-processing configuration to the specified preset.
         * @param {string} name - Preset name: 'wasteland_noon' | 'wasteland_sunset' | 'radioactive_night' | 'dust_storm' | 'acid_rain'.
         * @param {number} [transitionDuration=1.0] - Transition duration in seconds (0 = instantaneous).
         * @returns {this}
         */
        setPreset(name, transitionDuration = 1.0) {
            const target = PRESETS[name];
            if (!target) {
                console.warn(`[ArcPostProcess] Unknown preset: "${name}". Available: ${Object.keys(PRESETS).join(', ')}`);
                return this;
            }

            this.currentPreset = name;

            if (transitionDuration <= 0) {
                // Instantaneous application
                this._transition = null;
                this._exposure = target.exposure;
                this._contrast = target.contrast;
                this._intensity = target.glowIntensity;
                this._blurKernelSize = target.blurKernelSize;
                this._vignetteWeight = target.vignetteWeight;
                this._vignetteStretch = target.vignetteStretch;
                this._vignetteColor = { ...target.vignetteColor };
                this._applyToScene();
                return this;
            }

            // Start smooth transition
            this._transition = {
                startExposure: this._exposure,
                targetExposure: target.exposure,
                startContrast: this._contrast,
                targetContrast: target.contrast,
                startGlow: this._intensity,
                targetGlow: target.glowIntensity,
                startBlurKernel: this._blurKernelSize,
                targetBlurKernel: target.blurKernelSize,
                startVignetteWeight: this._vignetteWeight,
                targetVignetteWeight: target.vignetteWeight,
                startVignetteStretch: this._vignetteStretch,
                targetVignetteStretch: target.vignetteStretch,
                startColor: { ...this._vignetteColor },
                targetColor: { ...target.vignetteColor },
                duration: Math.max(0.01, transitionDuration),
                elapsed: 0
            };

            return this;
        }

        /**
         * Steps the active preset transition by delta time in seconds.
         * @param {number} dt - Delta time in seconds.
         */
        update(dt) {
            if (!this._transition) return;

            const tState = this._transition;
            tState.elapsed += dt;
            const progress = clamp(tState.elapsed / tState.duration, 0.0, 1.0);

            // Smoothstep cubic easing: 3t^2 - 2t^3
            const ease = progress * progress * (3 - 2 * progress);

            this._exposure = lerp(tState.startExposure, tState.targetExposure, ease);
            this._contrast = lerp(tState.startContrast, tState.targetContrast, ease);
            this._intensity = lerp(tState.startGlow, tState.targetGlow, ease);
            this._blurKernelSize = Math.round(lerp(tState.startBlurKernel, tState.targetBlurKernel, ease));
            this._vignetteWeight = lerp(tState.startVignetteWeight, tState.targetVignetteWeight, ease);
            this._vignetteStretch = lerp(tState.startVignetteStretch, tState.targetVignetteStretch, ease);

            this._vignetteColor.r = lerp(tState.startColor.r, tState.targetColor.r, ease);
            this._vignetteColor.g = lerp(tState.startColor.g, tState.targetColor.g, ease);
            this._vignetteColor.b = lerp(tState.startColor.b, tState.targetColor.b, ease);
            this._vignetteColor.a = lerp(
                tState.startColor.a !== undefined ? tState.startColor.a : 1.0,
                tState.targetColor.a !== undefined ? tState.targetColor.a : 1.0,
                ease
            );

            this._applyToScene();

            if (progress >= 1.0) {
                this._transition = null;
            }
        }

        // =====================================================================
        //  Day/Night & Weather Synchronization
        // =====================================================================

        /**
         * Automatically tunes post-processing parameters based on day/night phase and weather state.
         *
         * @param {string | number | any} dayPhase - Day phase ('dawn' | 'midday' | 'noon' | 'dusk' | 'sunset' | 'night') or DayNightCycle instance or hour [0..24].
         * @param {string | any} [weatherState='CLEAR'] - Weather state ('CLEAR' | 'DUST_STORM' | 'ACID_RAIN' | 'DENSE_FOG') or WeatherSystem instance.
         * @param {number} [transitionDuration=1.5] - Blending duration in seconds.
         * @returns {this}
         */
        syncWithDayNight(dayPhase, weatherState = 'CLEAR', transitionDuration = 1.5) {
            // 1. Normalize day phase string
            let normalizedPhase = 'midday';
            if (typeof dayPhase === 'object' && dayPhase !== null) {
                if (typeof dayPhase.getPeriod === 'function') {
                    normalizedPhase = String(dayPhase.getPeriod()).toLowerCase();
                } else if (typeof dayPhase.period === 'string') {
                    normalizedPhase = dayPhase.period.toLowerCase();
                } else if (typeof dayPhase.time === 'number') {
                    dayPhase = dayPhase.time;
                }
            }
            if (typeof dayPhase === 'number') {
                if (dayPhase >= 5.0 && dayPhase < 7.0) normalizedPhase = 'dawn';
                else if (dayPhase >= 7.0 && dayPhase < 17.0) normalizedPhase = 'midday';
                else if (dayPhase >= 17.0 && dayPhase < 20.0) normalizedPhase = 'dusk';
                else normalizedPhase = 'night';
            } else if (typeof dayPhase === 'string') {
                const s = dayPhase.toLowerCase();
                if (s.includes('noon') || s.includes('midday') || s.includes('day')) normalizedPhase = 'midday';
                else if (s.includes('sunset') || s.includes('dusk')) normalizedPhase = 'dusk';
                else if (s.includes('dawn') || s.includes('sunrise') || s.includes('morning')) normalizedPhase = 'dawn';
                else if (s.includes('night') || s.includes('midnight')) normalizedPhase = 'night';
            }

            // 2. Normalize weather state string
            let normalizedWeather = 'CLEAR';
            if (typeof weatherState === 'object' && weatherState !== null) {
                if (typeof weatherState.currentState === 'string') {
                    normalizedWeather = weatherState.currentState.toUpperCase();
                } else if (typeof weatherState.state === 'string') {
                    normalizedWeather = weatherState.state.toUpperCase();
                }
            } else if (typeof weatherState === 'string') {
                normalizedWeather = weatherState.toUpperCase();
            }

            // 3. Evaluate target preset based on environmental conditions
            let targetPreset = 'wasteland_noon';

            // Severe weather overrides diurnal ambient
            if (normalizedWeather.includes('DUST') || normalizedWeather === 'DUST_STORM') {
                targetPreset = 'dust_storm';
            } else if (normalizedWeather.includes('ACID') || normalizedWeather === 'ACID_RAIN') {
                targetPreset = 'acid_rain';
            } else if (normalizedWeather.includes('FOG') || normalizedWeather === 'DENSE_FOG') {
                targetPreset = normalizedPhase === 'night' ? 'radioactive_night' : 'dust_storm';
            } else {
                // Diurnal cycle
                if (normalizedPhase === 'night') {
                    targetPreset = 'radioactive_night';
                } else if (normalizedPhase === 'dusk') {
                    targetPreset = 'wasteland_sunset';
                } else if (normalizedPhase === 'dawn') {
                    targetPreset = 'wasteland_sunset'; // Rich morning golden-rose
                } else {
                    targetPreset = 'wasteland_noon';
                }
            }

            return this.setPreset(targetPreset, transitionDuration);
        }

        // =====================================================================
        //  Pseudo-RTX (SSAO 2.0 & Screen-Space Reflections)
        // =====================================================================

        /**
         * Cleans up any null or disposed entries in camera's postProcesses array.
         * @private
         */
        _sanitizePostProcesses() {
            if (this.camera && Array.isArray(this.camera._postProcesses)) {
                this.camera._postProcesses = this.camera._postProcesses.filter(p => p != null && !p.isDisposed);
            }
        }

        /**
         * Enables or disables SSAO 2.0 (Screen Space Ambient Occlusion / Pseudo-RTAO).
         * @param {boolean} [enabled=true]
         * @param {Object} [options]
         * @returns {this}
         */
        enableSsao(enabled = true, options = {}) {
            if (!enabled) {
                if (this.ssao2) {
                    try { this.ssao2.dispose(); } catch (_) {}
                    this.ssao2 = null;
                }
                this._sanitizePostProcesses();
                return this;
            }

            if (this.isHeadless || !this.scene || typeof BABYLON === 'undefined' || !BABYLON.SSAO2RenderingPipeline) {
                return this;
            }

            try {
                const ratio = options.ssaoRatio || 0.5;
                const blur = options.blurRatio || 0.75;
                const ratios = `${ratio}:${blur}`;
                if (this.ssao2 && this._ssaoRatios !== ratios) this.enableSsao(false);
                if (!this.ssao2) {
                    this._ssaoRatios = ratios;
                    const cams = this.camera ? [this.camera] : (this.scene.cameras?.length ? this.scene.cameras : []);
                    // 5th argument: forceGeometryBuffer = true (prevents PrePassRenderer MRT conflicts with custom shaders)
                    this.ssao2 = new BABYLON.SSAO2RenderingPipeline('arc-ssao2', this.scene, { ssaoRatio: ratio, blurRatio: blur }, cams, true);
                }
                if (this.ssao2) {
                    this.ssao2.radius = options.radius !== undefined ? options.radius : 8.0;
                    this.ssao2.totalStrength = options.totalStrength !== undefined ? options.totalStrength : 0.6;
                    this.ssao2.maxZ = options.maxZ !== undefined ? options.maxZ : 2400;
                    this.ssao2.samples = options.samples || 16;
                    this.ssao2.expensiveBlur = true;
                }
            } catch (err) {
                if (err && !this.isHeadless) console.warn('[ArcPostProcess] SSAO2 error:', err);
                this.ssao2 = null;
            }
            this._sanitizePostProcesses();
            return this;
        }

        /**
         * Enables or disables Screen-Space Reflections (SSR - Pseudo-RTX Reflections).
         * @param {boolean} [enabled=true]
         * @param {Object} [options]
         * @returns {this}
         */
        enableSsr(enabled = true, options = {}) {
            if (!enabled) {
                if (this.ssr) {
                    try { this.ssr.dispose(); } catch (_) {}
                    this.ssr = null;
                }
                this._sanitizePostProcesses();
                return this;
            }

            if (this.isHeadless || !this.scene || !this.camera || typeof BABYLON === 'undefined' || !BABYLON.ScreenSpaceReflectionPostProcess) {
                return this;
            }

            try {
                const engine = this.scene.getEngine ? this.scene.getEngine() : null;
                if (!engine) return this;

                // WebGPU does not allow textureSample in non-uniform control flow (raymarching loops)
                if (engine.isWebGPU) {
                    console.warn('[ArcPostProcess] SSR is unsupported on WebGPU due to WGSL uniform control flow constraints.');
                    this.enableSsr(false);
                    return this;
                }

                if (!this.ssr) {
                    // forceGeometryBuffer = true to avoid PrePassRenderer MRT conflicts
                    this.ssr = new BABYLON.ScreenSpaceReflectionPostProcess(
                        'arc-ssr',
                        this.scene,
                        1.0,
                        this.camera,
                        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
                        engine,
                        false,
                        undefined,
                        false,
                        true
                    );
                }
                if (this.ssr) {
                    // Setting samples recompiles after Babylon initializes scene handedness.
                    this.ssr.reflectionSamples = options.samples || 32;
                    this.ssr.enableSmoothReflections = !!options.smooth;
                    this.ssr.step = options.step !== undefined ? options.step : 1.0;
                    this.ssr.strength = options.strength !== undefined ? options.strength : 0.85;
                    this.ssr.threshold = options.threshold !== undefined ? options.threshold : 1.1;
                    this.ssr.roughnessFactor = options.roughnessFactor !== undefined ? options.roughnessFactor : 0.25;
                }
            } catch (err) {
                // Headless fallback
                this.ssr = null;
            }
            this._sanitizePostProcesses();
            return this;
        }

        /**
         * Configures overall Pseudo-RTX preset.
         * @param {'off'|'medium'|'ultra'|string} mode
         * @returns {this}
         */
        setRtxMode(mode) {
            // Effects must precede the final anti-aliasing / sharpening passes.
            this.enableSharpen(false);
            if (this.fxaa) {
                try { this.fxaa.dispose(); } catch (_) {}
                this.fxaa = null;
            }
            this._sanitizePostProcesses();

            const m = String(mode || 'off').toLowerCase();
            this._rtxMode = m === 'ultra' ? 'ultra' : (m === 'medium' ? 'medium' : 'off');

            if (this._rtxMode === 'off') {
                this.enableSsao(false);
                this.enableSsr(false);
            } else if (this._rtxMode === 'medium') {
                this.enableSsao(true, { samples: 16, ssaoRatio: 0.5, blurRatio: 0.75, radius: 8, totalStrength: 0.5, maxZ: 2400 });
                this.enableSsr(false);
            } else if (this._rtxMode === 'ultra') {
                this.enableSsao(true, { samples: 32, ssaoRatio: 0.75, blurRatio: 1.0, radius: 10, totalStrength: 0.75, maxZ: 2800 });
                this.enableSsr(false);
            }
            this._sanitizePostProcesses();
            this.setDlssMode(this._dlssMode);
            this._sanitizePostProcesses();
            return this;
        }

        /**
         * @returns {'off'|'medium'|'ultra'}
         */
        getRtxMode() {
            return this._rtxMode;
        }

        /**
         * Returns telemetry of active RTX features.
         * @returns {{ rtxMode: string, ssao: boolean, ssr: boolean, dlssMode: string, scale: number }}
         */
        getRtxStatus() {
            return {
                rtxMode: this._rtxMode,
                ssao: !!this.ssao2,
                ssr: !!this.ssr,
                dlssMode: this._dlssMode,
                scale: this._renderScale
            };
        }

        // =====================================================================
        //  DLSS / DLAA Upscaling & Adaptive Sharpening (CAS)
        // =====================================================================

        /**
         * Enables or disables Contrast-Adaptive Sharpening (CAS).
         * @param {boolean} [enabled=true]
         * @param {Object} [options]
         * @returns {this}
         */
        enableSharpen(enabled = true, options = {}) {
            if (!enabled) {
                if (this.sharpen) {
                    try { this.sharpen.dispose(); } catch (_) {}
                    this.sharpen = null;
                }
                return this;
            }

            if (this.isHeadless || !this.scene || !this.camera || typeof BABYLON === 'undefined' || !BABYLON.SharpenPostProcess) {
                return this;
            }

            try {
                const engine = this.scene.getEngine ? this.scene.getEngine() : null;
                if (!engine) return this;

                if (!this.sharpen) {
                    this.sharpen = new BABYLON.SharpenPostProcess(
                        'arc-sharpen',
                        1.0,
                        this.camera,
                        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
                        engine
                    );
                }
                if (this.sharpen) {
                    this.sharpen.edgeAmount = options.edgeAmount !== undefined ? options.edgeAmount : 0.4;
                    this.sharpen.colorAmount = options.colorAmount !== undefined ? options.colorAmount : 1.0;
                }
            } catch (err) {
                this.sharpen = null;
            }
            return this;
        }

        /**
         * Sets DLSS / DLAA resolution scaling and adaptive sharpening mode.
         * - 'off': 1.0x native rendering without sharpening.
         * Legacy API names: spatial resolution scaling, FXAA and sharpening (not NVIDIA DLSS/DLAA).
         * - 'dlaa': 1.0x native rendering + FXAA + sharpening.
         * - 'quality': 0.75x resolution + FXAA + sharpening.
         * - 'balanced': 0.66x resolution + FXAA + sharpening.
         * - 'performance': 0.50x resolution + FXAA + sharpening. Performance is GPU-dependent.
         *
         * @param {'off'|'dlaa'|'quality'|'balanced'|'performance'|string} mode
         * @returns {this}
         */
        setDlssMode(mode) {
            const m = String(mode || 'off').toLowerCase();
            const validModes = ['off', 'dlaa', 'quality', 'balanced', 'performance'];
            this._dlssMode = validModes.includes(m) ? /** @type {any} */ (m) : 'off';

            let scale = 1.0;
            let edgeSharpen = 0.0;
            let sharpenEnabled = false;

            switch (this._dlssMode) {
                case 'dlaa':
                    scale = 1.0;
                    edgeSharpen = 0.35;
                    sharpenEnabled = true;
                    break;
                case 'quality':
                    scale = 0.75;
                    edgeSharpen = 0.45;
                    sharpenEnabled = true;
                    break;
                case 'balanced':
                    scale = 0.66;
                    edgeSharpen = 0.50;
                    sharpenEnabled = true;
                    break;
                case 'performance':
                    scale = 0.50;
                    edgeSharpen = 0.60;
                    sharpenEnabled = true;
                    break;
                case 'off':
                default:
                    scale = 1.0;
                    sharpenEnabled = false;
                    break;
            }

            this._renderScale = scale;

            // Apply hardware scaling to Babylon Engine with DPI awareness
            const engine = this.scene?.getEngine ? this.scene.getEngine() : null;
            if (engine && typeof engine.setHardwareScalingLevel === 'function') {
                const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
                const cap = (typeof IS_MOBILE !== 'undefined' && IS_MOBILE) ? 1.5 : 2;
                const baseScaling = 1 / Math.min(dpr, cap);
                engine.setHardwareScalingLevel(baseScaling / scale);
            }

            // Legacy mode names are spatial scaling + FXAA + sharpening, not neural DLSS.
            if (this.fxaa) {
                try { this.fxaa.dispose(); } catch (_) {}
                this.fxaa = null;
            }
            this.enableSharpen(false);
            this._sanitizePostProcesses();

            if (sharpenEnabled && !this.isHeadless && this.camera && typeof BABYLON !== 'undefined' && BABYLON.FxaaPostProcess) {
                try {
                    this.fxaa = new BABYLON.FxaaPostProcess('arc-fxaa', 1.0, this.camera);
                } catch (_) {
                    this.fxaa = null;
                }
            }
            this.enableSharpen(sharpenEnabled, { edgeAmount: edgeSharpen });
            this._sanitizePostProcesses();

            return this;
        }

        /**
         * @returns {'off'|'dlaa'|'quality'|'balanced'|'performance'}
         */
        getDlssMode() {
            return this._dlssMode;
        }

        /**
         * @returns {number}
         */
        getRenderScale() {
            return this._renderScale;
        }

        // =====================================================================
        //  Serialization & Agent Configuration API
        // =====================================================================

        /**
         * Exports complete post-processing configuration as a serializable JSON-compatible object.
         * @returns {PostProcessSettings}
         */
        getSettings() {
            return {
                preset: this.currentPreset,
                exposure: Number(this._exposure.toFixed(3)),
                contrast: Number(this._contrast.toFixed(3)),
                glow: {
                    enabled: !!(this.glowLayer && this._intensity > 0),
                    intensity: Number(this._intensity.toFixed(3)),
                    blurKernelSize: this._blurKernelSize,
                    selectiveMasking: this._selectiveMasking
                },
                dlss: {
                    mode: this._dlssMode,
                    scale: this._renderScale,
                    sharpen: !!this.sharpen
                },
                rtx: {
                    mode: this._rtxMode,
                    ssao: !!this.ssao2,
                    ssr: !!this.ssr
                },
                toneMapping: {
                    enabled: this._toneMappingEnabled,
                    type: 'ACES'
                },
                vignette: {
                    enabled: this._vignetteEnabled,
                    weight: Number(this._vignetteWeight.toFixed(3)),
                    stretch: Number(this._vignetteStretch.toFixed(3)),
                    color: {
                        r: Number(this._vignetteColor.r.toFixed(3)),
                        g: Number(this._vignetteColor.g.toFixed(3)),
                        b: Number(this._vignetteColor.b.toFixed(3)),
                        a: Number((this._vignetteColor.a !== undefined ? this._vignetteColor.a : 1.0).toFixed(3))
                    }
                },
                isHeadless: this.isHeadless
            };
        }

        /**
         * Applies post-processing settings from a JSON string or configuration object.
         * Enables external AI agents and tools to dynamically tune engine visuals.
         *
         * @param {string | Partial<PostProcessSettings> | any} jsonOrObj - JSON string or settings dictionary.
         * @returns {this}
         */
        applySettings(jsonOrObj) {
            if (!jsonOrObj) return this;

            /** @type {any} */
            let cfg;
            if (typeof jsonOrObj === 'string') {
                try {
                    cfg = JSON.parse(jsonOrObj);
                } catch (err) {
                    console.error('[ArcPostProcess] Failed to parse settings JSON:', err);
                    return this;
                }
            } else {
                cfg = jsonOrObj;
            }

            // Preset application
            if (typeof cfg.preset === 'string' && PRESETS[cfg.preset]) {
                const duration = typeof cfg.transitionDuration === 'number' ? cfg.transitionDuration : 0;
                this.setPreset(cfg.preset, duration);
            }

            // Exposure & Contrast
            if (typeof cfg.exposure === 'number') this.exposure = cfg.exposure;
            if (typeof cfg.contrast === 'number') this.contrast = cfg.contrast;

            // Tone Mapping
            if (cfg.toneMapping && typeof cfg.toneMapping === 'object') {
                if (typeof cfg.toneMapping.enabled === 'boolean') this.toneMappingEnabled = cfg.toneMapping.enabled;
            }
            if (typeof cfg.toneMappingEnabled === 'boolean') this.toneMappingEnabled = cfg.toneMappingEnabled;

            // Glow / Bloom
            if (cfg.glow && typeof cfg.glow === 'object') {
                if (typeof cfg.glow.intensity === 'number') this.intensity = cfg.glow.intensity;
                if (typeof cfg.glow.blurKernelSize === 'number') this.blurKernelSize = cfg.glow.blurKernelSize;
                if (typeof cfg.glow.selectiveMasking === 'boolean') this.setSelectiveMasking(cfg.glow.selectiveMasking);
            }
            if (typeof cfg.intensity === 'number') this.intensity = cfg.intensity;
            if (typeof cfg.blurKernelSize === 'number') this.blurKernelSize = cfg.blurKernelSize;
            if (typeof cfg.selectiveMasking === 'boolean') this.setSelectiveMasking(cfg.selectiveMasking);

            // DLSS / DLAA
            if (typeof cfg.dlss === 'string') this.setDlssMode(cfg.dlss);
            else if (cfg.dlss && typeof cfg.dlss.mode === 'string') this.setDlssMode(cfg.dlss.mode);
            else if (typeof cfg.dlssMode === 'string') this.setDlssMode(cfg.dlssMode);

            // Pseudo-RTX
            if (typeof cfg.rtx === 'string') this.setRtxMode(cfg.rtx);
            else if (cfg.rtx && typeof cfg.rtx.mode === 'string') this.setRtxMode(cfg.rtx.mode);
            else if (typeof cfg.rtxMode === 'string') this.setRtxMode(cfg.rtxMode);
            if (cfg.ssao !== undefined) this.enableSsao(!!cfg.ssao);
            if (cfg.ssr !== undefined) this.enableSsr(!!cfg.ssr);

            // Vignette
            if (cfg.vignette && typeof cfg.vignette === 'object') {
                if (typeof cfg.vignette.enabled === 'boolean') this.vignetteEnabled = cfg.vignette.enabled;
                if (typeof cfg.vignette.weight === 'number') this.vignetteWeight = cfg.vignette.weight;
                if (typeof cfg.vignette.stretch === 'number') this.vignetteStretch = cfg.vignette.stretch;
                if (cfg.vignette.color && typeof cfg.vignette.color === 'object') {
                    this.vignetteColor = cfg.vignette.color;
                }
            }
            if (typeof cfg.vignetteEnabled === 'boolean') this.vignetteEnabled = cfg.vignetteEnabled;
            if (typeof cfg.vignetteWeight === 'number') this.vignetteWeight = cfg.vignetteWeight;
            if (typeof cfg.vignetteStretch === 'number') this.vignetteStretch = cfg.vignetteStretch;
            if (cfg.vignetteColor && typeof cfg.vignetteColor === 'object') {
                this.vignetteColor = cfg.vignetteColor;
            }

            this._applyToScene();
            return this;
        }

        /**
         * Alias for applySettings.
         * @param {string | Partial<PostProcessSettings> | any} settings
         * @returns {this}
         */
        apply(settings) {
            return this.applySettings(settings);
        }

        /**
         * Alias for setPreset.
         * @param {string} presetName
         * @param {number} [transitionDuration=1.0]
         * @returns {this}
         */
        applyPreset(presetName, transitionDuration = 1.0) {
            return this.setPreset(presetName, transitionDuration);
        }

        /**
         * Alias for setIntensity.
         * @param {number} value
         * @returns {this}
         */
        setGlowIntensity(value) {
            return this.setIntensity(value);
        }

        /**
         * Returns current post-process settings snapshot.
         * @returns {PostProcessSettings}
         */
        get settings() {
            return this.getSettings();
        }

        /**
         * Reinitializes pipeline with a new scene and camera.
         * @param {any} scene
         * @param {any} [camera]
         * @returns {this}
         */
        init(scene, camera = null) {
            if (this.glowLayer) {
                try { this.glowLayer.dispose(); } catch (_) {}
                this.glowLayer = null;
            }
            if (this.ssao2) {
                try { this.ssao2.dispose(); } catch (_) {}
                this.ssao2 = null;
            }
            if (this.ssr) {
                try { this.ssr.dispose(); } catch (_) {}
                this.ssr = null;
            }
            if (this.fxaa) {
                try { this.fxaa.dispose(); } catch (_) {}
                this.fxaa = null;
            }
            if (this.sharpen) {
                try { this.sharpen.dispose(); } catch (_) {}
                this.sharpen = null;
            }
            if (this._sceneObserver && this.scene && this.scene.onBeforeRenderObservable) {
                try { this.scene.onBeforeRenderObservable.remove(this._sceneObserver); } catch (_) {}
                this._sceneObserver = null;
            }

            this.scene = scene;
            this.camera = camera || (scene && scene.activeCamera) || null;
            this.isHeadless = ArcPostProcess.detectHeadless(scene);

            this._initToneMappingAndVignette();
            this._initGlowLayer();
            if (this._dlssMode !== 'off') this.setDlssMode(this._dlssMode);
            if (this._rtxMode !== 'off') this.setRtxMode(this._rtxMode);
            this._applyToScene();
            return this;
        }

        /**
         * Static helper to apply settings to active instance.
         * @param {any} settings
         * @returns {ArcPostProcess | null}
         */
        static apply(settings) {
            if (ArcPostProcess._activeInstance) {
                return ArcPostProcess._activeInstance.applySettings(settings);
            }
            return null;
        }

        /**
         * Static helper to apply preset to active instance.
         * @param {string} presetName
         * @param {number} [transitionDuration=1.0]
         * @returns {ArcPostProcess | null}
         */
        static applyPreset(presetName, transitionDuration = 1.0) {
            if (ArcPostProcess._activeInstance) {
                return ArcPostProcess._activeInstance.setPreset(presetName, transitionDuration);
            }
            return null;
        }

        /**
         * Static helper to set DLSS mode on active instance.
         * @param {string} mode
         * @returns {ArcPostProcess | null}
         */
        static setDlssMode(mode) {
            if (ArcPostProcess._activeInstance) {
                return ArcPostProcess._activeInstance.setDlssMode(mode);
            }
            return null;
        }

        /**
         * Static helper to set RTX mode on active instance.
         * @param {string} mode
         * @returns {ArcPostProcess | null}
         */
        static setRtxMode(mode) {
            if (ArcPostProcess._activeInstance) {
                return ArcPostProcess._activeInstance.setRtxMode(mode);
            }
            return null;
        }

        // =====================================================================
        //  Disposal & Cleanup
        // =====================================================================

        /**
         * Cleans up GlowLayer, observers, and allocated sets.
         */
        dispose() {
            if (this._sceneObserver && this.scene && this.scene.onBeforeRenderObservable) {
                try {
                    this.scene.onBeforeRenderObservable.remove(this._sceneObserver);
                } catch (_) {}
                this._sceneObserver = null;
            }

            if (this.glowLayer) {
                try {
                    this.glowLayer.dispose();
                } catch (_) {}
                this.glowLayer = null;
            }

            if (this.ssao2) {
                try { this.ssao2.dispose(); } catch (_) {}
                this.ssao2 = null;
            }

            if (this.ssr) {
                try { this.ssr.dispose(); } catch (_) {}
                this.ssr = null;
            }

            if (this.fxaa) {
                try { this.fxaa.dispose(); } catch (_) {}
                this.fxaa = null;
            }
            if (this.sharpen) {
                try { this.sharpen.dispose(); } catch (_) {}
                this.sharpen = null;
            }

            // Restore native hardware scaling
            if (this.scene?.getEngine && typeof this.scene.getEngine().setHardwareScalingLevel === 'function') {
                try {
                    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
                    const cap = (typeof IS_MOBILE !== 'undefined' && IS_MOBILE) ? 1.5 : 2;
                    this.scene.getEngine().setHardwareScalingLevel(1 / Math.min(dpr, cap));
                } catch (_) {}
            }
            this._sanitizePostProcesses();

            this._includedMeshes.clear();
            this._meshColors.clear();
            this._maskPatterns.length = 0;
            this._selectivePredicate = null;
            this._transition = null;
            if (ArcPostProcess._activeInstance === this) {
                ArcPostProcess._activeInstance = null;
            }
        }
    }

    // Universal Export
    if (typeof window !== 'undefined') /** @type {any} */ (window).ArcPostProcess = ArcPostProcess;
    if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).ArcPostProcess = ArcPostProcess;
    if (typeof module !== 'undefined' && module.exports) module.exports = { ArcPostProcess };
})();
