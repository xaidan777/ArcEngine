// World3D.js — the kit's 3D engine: Babylon on a canvas, the scene view (View3D: camera,
// light, shadows, screen <-> world projections), render constants (cfg), toon shader
// (ArcToonPlugin), ink edges and silhouette outline, world object registration.
//
// Coordinates: map (x right, y down, px) -> Babylon (X = x, Z = y,
// Y = height). The scene is RIGHT-HANDED (useRightHandedSystem): viewed from above with
// north (−y) up, east (+x) is on the right; in a left-handed scene the same world came
// out mirrored. Heading (rad, atan2(vy, vx)) -> rotation.y = -heading.
// "Right on screen" at camera azimuth az is (−sin az, cos az).
//
// The frame is drawn by the loop owner: World3D.renderFrame() from its own
// requestAnimationFrame (the game's main.js, the editor's lab.js), after camera.update().
//
// One light for the whole world: the azimuth WORLD3D_SUN_AZIMUTH_DEG sets WHERE the
// shadow falls, the sun elevation is WORLD3D_SUN_ELEVATION_DEG. Shadows are real
// (ShadowGenerator, the sun's ortho frustum follows the camera).
//
// SHADOWS — ONE COLOR FOR EVERYTHING. Babylon only provides the sun visibility (generator
// darkness = 0); the shadow is colored by the ArcToonPlugin plugin (define ARCSHADOW):
// surface light in shadow = unshadowed light × mix(1, WORLD3D_SHADOW_COLOR,
// WORLD3D_SHADOW_STRENGTH). The unshadowed light is reconstructed from the sum (the sun
// is the LAST light of the scene: hemi is created first, the shader's `shadow` after
// the light loop is the sun's; the sun direction and color are plugin uniforms from
// scene.metadata.arcSun).
//
// RENDER CONSTANTS are read in one place — World3D.cfg() (in the game they are lexical
// const, hence the typeof checks). applyRenderConstants(view) applies them to the
// live scene without a rebuild: light, sky, fog and shadows (View3D.applyLighting),
// materials by group (metadata.toonGroup: 'ground' | 'prop' | 'actor'),
// toon (uniforms — immediately, on/off — a shader rebuild), ink edges and outline.
//
// WORLD OBJECTS are registered by addObject(view, mesh, kind): material group,
// shadow, ink edges and outline. kind: 'actor' — the main objects of the frame
// (characters, cars), 'prop' — environment (cubes, walls, trees). Hundreds of copies of one
// thing — addInstances(view, mesh, kind, items): one draw call (Instances3D.js).
//
// The toon shader is ArcToonPlugin (BABYLON.MaterialPluginBase, registered on
// ALL StandardMaterial at World3D.init): after the light of all sources is summed,
// the diffuseBase brightness is quantized into WORLD3D_TOON_BANDS bands between
// WORLD3D_TOON_LOW and 1, the specular highlight — by a threshold, along the silhouette
// edge — a rim light. The injection point is the line `aggShadow=aggShadow/numLights;`
// of the default.fragment shader (a regex in getCustomCode; if the line is missing, the
// code is not injected and the shader does not break, there are just no bands). Unlit
// materials (disableLighting) are left untouched by the plugin.

/** @satisfies {Record<string, any>} */
const World3D = {
    /** @type {BABYLON.Engine | null} */
    engine: null,
    /** @type {HTMLCanvasElement | null} */
    canvas: null,
    /** @type {View3D | null} */
    view: null,             // the active View3D (drawn by renderFrame)
    /** @type {BABYLON.Color4 | null} */
    _bg: null,
    /** @type {typeof ArcToon} */
    toon: null,             // toon plugin state — ArcToon below, after ArcToonPlugin

    // Render layers (Babylon renderingGroupId), the depth buffer is SHARED (see View3D):
    //   WORLD   — the ground and everything standing on it;
    //   OVERLAY — marks on top of the world (selection, paths): their materials get
    //             depthFunction = ALWAYS and disableDepthWrite — the terrain does not cut
    //             them, and the world depth stays intact;
    //   ACTOR   — objects that go last: OVERLAY paint does not land on top of
    //             them, but they hide behind walls honestly.
    LAYER: { WORLD: 0, OVERLAY: 1, ACTOR: 2 },

    available() {
        return typeof BABYLON !== 'undefined' && !!this.engine;
    },

    // Brings up the engine on the canvas (one per page). false — no Babylon or WebGL.
    init(canvas) {
        if (typeof BABYLON === 'undefined') {
            console.warn('World3D: libs/babylon.js не загружен — 3D-мир недоступен.');
            return false;
        }
        if (this.engine) return true;
        this.canvas = canvas;
        try {
            this.engine = new BABYLON.Engine(canvas, true, {
                preserveDrawingBuffer: false,
                stencil: true,     // needed by the silhouette outline HighlightLayer (needStencil)
                antialias: true,
                adaptToDeviceRatio: false,
                powerPreference: 'high-performance',
                doNotHandleContextLost: true
            }, false);
        } catch (e) {
            console.error('World3D: WebGL недоступен', e);
            this.engine = null;
            return false;
        }
        // Sharpness on HiDPI: render in physical pixels (on mobile —
        // no more than 1.5x, otherwise fill rate eats the frame).
        const dpr = window.devicePixelRatio || 1;
        const cap = IS_MOBILE ? 1.5 : 2;
        this.engine.setHardwareScalingLevel(1 / Math.min(dpr, cap));
        this._bg = new BABYLON.Color4(0.133, 0.133, 0.133, 1);
        // The toon plugin attaches to materials at their CREATION — register it
        // before the first scene.
        this.toon.register();
        this.resize();
        return true;
    },

    resize() {
        if (this.engine) this.engine.resize();
    },

    renderFrame() {
        const e = this.engine;
        if (!e) return;
        const v = this.view;
        if (v && v.active && v.scene && v.scene.activeCamera) {
            v.beforeRender();
            this.outlineFog(v);
            v.scene.render();
        } else {
            e.clear(this._bg, true, true, true);
        }
    },

    createView(opts) {
        if (!this.available()) return null;
        return new View3D(this, opts || {});
    },

    // --- Render constants -----------------------------------------------------

    // All render constants with defaults (Constants.js may be older than the code).
    // In the game the constants are lexical const: they cannot be read by name via
    // window, only by typeof on the identifier.
    cfg() {
        const U = 'undefined';
        return {
            sunAz: typeof WORLD3D_SUN_AZIMUTH_DEG !== U ? WORLD3D_SUN_AZIMUTH_DEG : 53,
            sunEl: typeof WORLD3D_SUN_ELEVATION_DEG !== U ? WORLD3D_SUN_ELEVATION_DEG : 48,
            sunIntensity: typeof WORLD3D_SUN_INTENSITY !== U ? WORLD3D_SUN_INTENSITY : 0.8,
            sunColor: typeof WORLD3D_SUN_COLOR !== U ? WORLD3D_SUN_COLOR : 0xfff7e6,
            skyIntensity: typeof WORLD3D_SKYLIGHT_INTENSITY !== U ? WORLD3D_SKYLIGHT_INTENSITY : 0.45,
            skyLight: typeof WORLD3D_SKYLIGHT_COLOR !== U ? WORLD3D_SKYLIGHT_COLOR : 0xf2f7ff,
            groundLight: typeof WORLD3D_GROUNDLIGHT_COLOR !== U ? WORLD3D_GROUNDLIGHT_COLOR : 0x4f6b52,
            sky: typeof WORLD3D_SKY_COLOR !== U ? WORLD3D_SKY_COLOR : 0x8fc3e0,
            fog: typeof WORLD3D_FOG_DENSITY !== U ? WORLD3D_FOG_DENSITY : 0.00032,
            shadowMap: typeof WORLD3D_SHADOW_MAP !== U ? WORLD3D_SHADOW_MAP : 2048,
            shadowColor: typeof WORLD3D_SHADOW_COLOR !== U ? WORLD3D_SHADOW_COLOR : 0x012d3c,
            shadowStrength: typeof WORLD3D_SHADOW_STRENGTH !== U ? WORLD3D_SHADOW_STRENGTH : 0.36,
            shadowSoft: typeof WORLD3D_SHADOW_SOFT !== U ? WORLD3D_SHADOW_SOFT : 2,
            shadowRadius: typeof WORLD3D_SHADOW_RADIUS !== U ? WORLD3D_SHADOW_RADIUS : 720,
            shadowBias: typeof WORLD3D_SHADOW_BIAS !== U ? WORLD3D_SHADOW_BIAS : 0.0005,
            shadowNormalBias: typeof WORLD3D_SHADOW_NORMAL_BIAS !== U ? WORLD3D_SHADOW_NORMAL_BIAS : 0.8,
            groundSpecular: typeof WORLD3D_GROUND_SPECULAR !== U ? WORLD3D_GROUND_SPECULAR : 0.04,
            groundSpecPower: typeof WORLD3D_GROUND_SPEC_POWER !== U ? WORLD3D_GROUND_SPEC_POWER : 24,
            outerTint: typeof WORLD3D_OUTER_TINT !== U ? WORLD3D_OUTER_TINT : 1,
            propSpecular: typeof WORLD3D_PROP_SPECULAR !== U ? WORLD3D_PROP_SPECULAR : 0.05,
            propSpecPower: typeof WORLD3D_PROP_SPEC_POWER !== U ? WORLD3D_PROP_SPEC_POWER : 32,
            actorSpecular: typeof WORLD3D_ACTOR_SPECULAR !== U ? WORLD3D_ACTOR_SPECULAR : 0.22,
            actorSpecPower: typeof WORLD3D_ACTOR_SPEC_POWER !== U ? WORLD3D_ACTOR_SPEC_POWER : 28,
            toon: typeof WORLD3D_TOON !== U ? WORLD3D_TOON : 1,
            toonBands: typeof WORLD3D_TOON_BANDS !== U ? WORLD3D_TOON_BANDS : 3,
            toonSoft: typeof WORLD3D_TOON_SOFT !== U ? WORLD3D_TOON_SOFT : 0.06,
            toonLow: typeof WORLD3D_TOON_LOW !== U ? WORLD3D_TOON_LOW : 0.35,
            toonGround: typeof WORLD3D_TOON_GROUND !== U ? WORLD3D_TOON_GROUND : 1,
            toonSpec: typeof WORLD3D_TOON_SPEC !== U ? WORLD3D_TOON_SPEC : 1,
            toonSpecSize: typeof WORLD3D_TOON_SPEC_SIZE !== U ? WORLD3D_TOON_SPEC_SIZE : 0.12,
            toonRim: typeof WORLD3D_TOON_RIM !== U ? WORLD3D_TOON_RIM : 0.25,
            toonRimWidth: typeof WORLD3D_TOON_RIM_WIDTH !== U ? WORLD3D_TOON_RIM_WIDTH : 0.35,
            outline: typeof WORLD3D_TOON_OUTLINE !== U ? WORLD3D_TOON_OUTLINE : 2,
            outlineActorWidth: typeof WORLD3D_TOON_OUTLINE_ACTOR_WIDTH !== U ? WORLD3D_TOON_OUTLINE_ACTOR_WIDTH : 2,
            outlinePropWidth: typeof WORLD3D_TOON_OUTLINE_PROP_WIDTH !== U ? WORLD3D_TOON_OUTLINE_PROP_WIDTH : 0.5,
            ink: typeof WORLD3D_TOON_INK !== U ? WORLD3D_TOON_INK : 2,
            inkWidth: typeof WORLD3D_TOON_INK_WIDTH !== U ? WORLD3D_TOON_INK_WIDTH : 100,
            inkColor: typeof WORLD3D_TOON_INK_COLOR !== U ? WORLD3D_TOON_INK_COLOR : 0x10141a,
            inkAngle: typeof WORLD3D_TOON_INK_ANGLE !== U ? WORLD3D_TOON_INK_ANGLE : 40
        };
    },

    // Live application of render constants to the view's scene (editor): light, shadows,
    // sky, materials by group, toon, ink edges and outlines. Rebuilds nothing.
    applyRenderConstants(view) {
        if (!view || !view.scene) return;
        const c = this.cfg();
        view.applyLighting(c);
        this.toon.apply(c);
        for (const m of view.scene.materials) this.applyMaterialConstants(m, c);
        this.applyInk(view.scene, c);
        this.applyOutlines(view, c);
        view.scene.resetCachedMaterial();
    },

    // Material specular highlight by group (metadata.toonGroup): ground, environment, main objects.
    // The ground ring beyond the edge (metadata.outer) — also the WORLD3D_OUTER_TINT brightness.
    applyMaterialConstants(m, c) {
        const g = m && m.metadata && m.metadata.toonGroup;
        if (!g || !(m instanceof BABYLON.StandardMaterial)) return;
        c = c || this.cfg();
        let spec = 0, power = m.specularPower;
        if (g === 'ground') { spec = c.groundSpecular; power = c.groundSpecPower; }
        else if (g === 'prop') { spec = c.propSpecular; power = c.propSpecPower; }
        else if (g === 'actor') { spec = c.actorSpecular; power = c.actorSpecPower; }
        m.specularColor = new BABYLON.Color3(spec, spec, spec);
        m.specularPower = Math.max(1, power);
        if (m.metadata.outer) {
            const t = Math.max(0, c.outerTint);
            m.diffuseColor = new BABYLON.Color3(t, t, t);
        }
    },

    // --- World objects -----------------------------------------------------------

    // Object registration: materials (of child meshes too) — into the kind group (specular
    // highlight from constants, toon), the root — into the shadow map, edges — into the ink
    // edges, the silhouette — into the outline. The root and the children get THEIR OWN
    // metadata: clone() copies it by reference, and the ink edges/outline of clones would
    // write into a shared object.
    // kind: 'actor' | 'prop'. opts: { castShadow, receiveShadows, ink, outline } — all true by default.
    addObject(view, mesh, kind, opts) {
        if (!view || !mesh) return mesh;
        const o = opts || {};
        const k = kind === 'prop' ? 'prop' : 'actor';
        const c = this.cfg();
        const parts = [mesh].concat(mesh.getChildMeshes ? mesh.getChildMeshes(false) : []);
        for (const m of parts) {
            m.metadata = Object.assign({}, m.metadata);
            m.receiveShadows = o.receiveShadows !== false;
            const mat = m.material;
            const mats = mat ? (mat.subMaterials || [mat]) : [];
            for (const sm of mats) {
                if (!sm) continue;
                sm.metadata = Object.assign({ toonGroup: k }, sm.metadata);
                this.applyMaterialConstants(sm, c);
            }
            const solid = m.getTotalVertices && m.getTotalVertices() > 0;
            // Every part gets ink edges, a skinned one too: its lines are built from the rest
            // pose and re-posed with the bones before each draw (InkSkin).
            if (solid && o.ink !== false) this.inkMesh(m, k, c);
            // All parts — into ONE outline layer: the line follows the overall silhouette, not a part.
            if (solid && o.outline !== false) this.outlineAdd(view, m, k, c);
        }
        if (o.castShadow !== false) view.addShadowCaster(mesh, true);
        return mesh;
    },

    // Many copies of ONE mesh or model (a forest, identical props, bullets): thin instances, one
    // draw call per part whatever the count — a separate addObject mesh costs the CPU 10–15 µs
    // per frame (main pass, shadow map, outline mask, ink edges): 2000 of them are a whole frame.
    // items: [{ x, y, h, heading?, scale? }]; returns Instances3D (set / setAll / flush / dispose),
    // .ok is false for a skinned model. Details — Instances3D.js.
    addInstances(view, source, kind, items, opts) {
        return new Instances3D(view, source, kind, items, opts);
    },

    // Remove an object: outline, shadows, the mesh with its children. Materials stay with the owner.
    removeObject(view, mesh) {
        if (!mesh) return;
        const parts = [mesh].concat(mesh.getChildMeshes ? mesh.getChildMeshes(false) : []);
        for (const m of parts) this.outlineRemove(view, m);
        if (view) view.removeShadowCaster(mesh);
        mesh.dispose(false, false);
    },

    // --- Ink edges (EdgesRenderer) ---------------------------------------------

    // Mesh edges creased sharper than WORLD3D_TOON_INK_ANGLE are drawn as lines in the ink
    // color. group: 'actor' (level 1) | 'prop' (level 2). Cost: ~5 ms per
    // mesh of 1300 triangles, once. Ink edges are part of the toon look, like the
    // silhouette outline: at WORLD3D_TOON = 0 they are off. EVERY object of the scene gets
    // them — a skinned one keeps its lines on the bones through InkSkin.
    inkMesh(mesh, group, c) {
        if (!mesh || !mesh.enableEdgesRendering) return;
        c = c || this.cfg();
        const md = mesh.metadata || (mesh.metadata = {});
        md.ink = group;
        const want = c.toon > 0 && c.ink >= (group === 'prop' ? 2 : 1) && c.inkWidth > 0;
        if (!want) {
            this.inkSkinRelease(mesh);
            if (mesh.edgesRenderer) mesh.disableEdgesRendering();
            md.inkEps = null;
            return;
        }
        const eps = Math.cos(Math.max(1, Math.min(89, c.inkAngle)) * Math.PI / 180);
        if (!mesh.edgesRenderer || md.inkEps !== eps) {
            // checkVerticesInsteadOfIndices: in flat-shaded lowpoly the
            // triangles are disconnected, adjacency is found by vertex coordinates.
            this.inkSkinRelease(mesh);   // the new renderer brings its own lines and buffers
            mesh.enableEdgesRendering(eps, true);
            md.inkEps = eps;
        }
        mesh.edgesWidth = c.inkWidth;
        const col = this.hexColor3(c.inkColor);
        mesh.edgesColor = new BABYLON.Color4(col.r, col.g, col.b, 1);
        if (group === 'prop') mesh.edgesShareWithInstances = true;
        if (mesh.skeleton) this.inkSkin(mesh);
    },

    // Lines of a SKINNED mesh follow its bones (InkSkin, below): one helper per mesh, built
    // on the current edges renderer. Returns null when the mesh carries no skinning data.
    inkSkin(mesh) {
        const md = mesh.metadata || (mesh.metadata = {});
        if (md.inkSkin) return md.inkSkin;
        const skin = new InkSkin(mesh);
        md.inkSkin = skin.ok ? skin : null;
        return md.inkSkin;
    },

    // Drop the follow — BEFORE the edges renderer that owns the line buffers goes away.
    inkSkinRelease(mesh) {
        const md = mesh && mesh.metadata;
        if (!md || !md.inkSkin) return;
        md.inkSkin.dispose();
        md.inkSkin = null;
    },

    applyInk(scene, c) {
        c = c || this.cfg();
        for (const m of scene.meshes) {
            if (m.metadata && m.metadata.ink && !m.isAnInstance) this.inkMesh(m, m.metadata.ink, c);
        }
    },

    // --- Silhouette outline: mask-based post effect ------------------------------
    //
    // "Stroke like in Photoshop": objects are drawn into a separate MASK (RTT), it is
    // dilated and laid over the frame in the ink color. The line follows the OUTER
    // boundary of the silhouette, ONE per whole object. The width is in screen pixels
    // and does not depend on the distance to the camera. No shader of its own: the stock
    // BABYLON.HighlightLayer with isStroke (#define STROKE in glowMapMerge gives a
    // hard edge instead of a glow). Levels — WORLD3D_TOON_OUTLINE. The outline is
    // part of the toon look: at WORLD3D_TOON = 0 (the editor's "toon shader" checkbox)
    // there is none. Ink edges (inkMesh) do not depend on WORLD3D_TOON.
    //
    // Each object kind ('actor' / 'prop') has its own width, while a layer has one for
    // everything — so different kinds need different layers.
    //
    // Scene fog does not touch the line (it is laid over the finished frame) — the fog
    // tone is given to each mesh by outlineFog once per frame.
    //
    // PITFALL: the layer needs a stencil buffer (needStencil() = true) — the engine
    // is brought up with stencil: true, otherwise the outline creeps onto the object itself.
    // PITFALL: the outline is drawn ON TOP of the frame and knows nothing about depth — an
    // object in front of an outlined one will not occlude it. Viewed from above it is unnoticeable.

    outlineKind(kind) { return kind === 'prop' ? 'prop' : 'actor'; },

    // Outline width of an object kind in screen px (frame pixels).
    outlineWidthOf(kind, c) {
        c = c || this.cfg();
        return this.outlineKind(kind) === 'prop' ? c.outlinePropWidth : c.outlineActorWidth;
    },

    // Layer resolution: the mask is a fraction of the frame, the blur is a fraction of the
    // mask. Do not drop the mask below the frame: a line thinner than a texel cannot be
    // drawn, and a 0.5 × 0.5 texel is 4 frame px. On mobile only the blur is cheaper.
    outlineRatios() {
        return { main: 1, blur: IS_MOBILE ? 0.5 : 1 };
    },

    // Width in frame px -> the layer's blur kernel.
    // PITFALL: HighlightLayer's blurHorizontalSize is in TEXELS of the blur
    // texture (frame × mainTextureRatio × blurTextureSizeRatio), not in frame
    // px. Without the conversion, on mobile (0.5 × 0.5) the same constant gave
    // a line four times thicker than on PC.
    outlineKernel(width) {
        const r = this.outlineRatios();
        return width * r.main * r.blur;
    },

    // Outline layer: a SEPARATE one for each "object kind × mesh rendering group" pair
    // (`view._outlines['actor@2']` etc.). The kind sets the width, the group — the moment
    // of compositing.
    //
    // PITFALL (outline on only some of the objects). A layer gives a line ONLY to the
    // meshes that are drawn in its rendering group. With the default
    // renderingGroupId = −1 the compositing landed between groups: objects of another
    // group were flooded by the mask entirely, and some objects had no line at all.
    // So a layer is created for EVERY group that has an outlined mesh.
    outlineLayer(view, kind, renderGroup, c) {
        if (!view || !view.scene || typeof BABYLON.HighlightLayer !== 'function') return null;
        c = c || this.cfg();
        const k = this.outlineKind(kind);
        const g = renderGroup || 0;
        const key = k + '@' + g;
        const store = view._outlines || (view._outlines = {});
        let rec = store[key];
        const width = this.outlineWidthOf(k, c);
        if (!(c.toon > 0) || !(c.outline >= (k === 'prop' ? 2 : 1)) || !(width > 0)) return rec ? rec.hl : null;
        const kernel = this.outlineKernel(width);
        if (!rec) {
            const r = this.outlineRatios();
            const hl = new BABYLON.HighlightLayer('arcOutline-' + key, view.scene, {
                isStroke: true,
                camera: view.camera,
                mainTextureRatio: r.main,
                blurTextureSizeRatio: r.blur,
                blurHorizontalSize: kernel,
                blurVerticalSize: kernel,
                renderingGroupId: g
            });
            hl.innerGlow = false;     // outward only — this is an outline, not a glow
            hl.outerGlow = true;
            // PITFALL (dark "ghost" of the outline in fog). In STROKE mode the merge
            // shader (glowMapMerge) already multiplies the color by alpha, and the layer's
            // default blending, ALPHA_COMBINE (SRC_ALPHA), multiplies a second time:
            // color·α² + frame·(1−α). On a black line this is invisible, but a fog-colored
            // line (outlineFog) got an edge a quarter darker than the background: the object
            // dissolved in the distance, the outline remained. ALPHA_PREMULTIPLIED
            // (ONE, ONE_MINUS_SRC_ALPHA) is needed — but ONLY for the duration of the compose.
            // The mode lives in the thin layer's private options, and the layer reads those
            // same options when it recreates textures on canvas resize: with PREMULTIPLIED it
            // built a different blur chain (2 passes instead of 3), the blur
            // texture stayed empty, and the outline vanished completely (the ArcTrack
            // editor after a view resize). A constructor option will not do for
            // the same reason. The field is private: check it when upgrading Babylon.
            const thin = /** @type {any} */ (hl)._thinEffectLayer;
            if (thin && thin._options) {
                const C = BABYLON.Constants;
                hl.onBeforeComposeObservable.add(() => { thin._options.alphaBlendingMode = C.ALPHA_PREMULTIPLIED; });
                hl.onAfterComposeObservable.add(() => { thin._options.alphaBlendingMode = C.ALPHA_COMBINE; });
            }
            // PITFALL (dark fringe on a light line). The layer clears the mask with
            // neutralColor — black (0,0,0,0) by default. The blur takes the color of
            // the brightest sample, and a sample at the mask edge is bilinearly mixed with
            // that black: with a fractional kernel (width 1.5 or 0.5 px) and on
            // mobile (blur at half the frame) a fog-colored line got
            // a dark fringe. The mask background is the darkest tone of the layer's meshes
            // with alpha 0 (outlineFog): mixing with it does not darken the color, and it
            // cannot be lighter — the blur would repaint a nearer object's line with it. The
            // object is its own: by default all layers share the static HighlightLayer.NeutralColor.
            hl.neutralColor = new BABYLON.Color4(0, 0, 0, 0);
            // meshes: mesh -> its line color (Color3, the fog tone is adjusted by outlineFog).
            rec = store[key] = { hl: hl, group: g, kind: k, meshes: new Map(), ink: null };
        }
        rec.hl.blurHorizontalSize = kernel;
        rec.hl.blurVerticalSize = kernel;
        rec.ink = this.hexColor3(c.inkColor);
        return rec.hl;
    },

    // Put a mesh into the outline. kind: 'actor' (level 1) | 'prop' (level 2).
    // The mesh remembers its kind — applyOutlines rebuilds the set when constants
    // are edited. Instances (thin and regular) are outlined together with the source mesh.
    outlineAdd(view, mesh, kind, c) {
        if (!view || !mesh) return;
        c = c || this.cfg();
        const k = this.outlineKind(kind);
        const md = mesh.metadata || (mesh.metadata = {});
        md.outline = k;
        this.outlineRemove(view, mesh);   // it may have been in another group's layer
        // Toon is off — no outline; applyOutlines brings the removed mesh back when toon is turned on.
        const want = c.toon > 0 && c.outline >= (k === 'prop' ? 2 : 1) && this.outlineWidthOf(k, c) > 0;
        if (!want) return;
        const g = mesh.renderingGroupId || 0;
        const hl = this.outlineLayer(view, k, g, c);
        if (!hl) return;
        const tone = this.hexColor3(c.inkColor);   // each mesh gets its own object: outlineFog edits it in place
        hl.addMesh(mesh, tone);
        const rec = view._outlines[k + '@' + g];
        if (rec) rec.meshes.set(mesh, tone);
    },

    // Remove a mesh from all outline layers; an emptied layer is disposed (an empty mask
    // still costs a render pass).
    outlineRemove(view, mesh) {
        const store = view && view._outlines;
        if (!store || !mesh) return;
        for (const key of Object.keys(store)) {
            const rec = store[key];
            if (!rec || !rec.hl || !rec.meshes.has(mesh)) continue;
            try { rec.hl.removeMesh(mesh); } catch (e) { /* ok */ }
            rec.meshes.delete(mesh);
            if (!rec.meshes.size) {
                try { rec.hl.dispose(); } catch (e) { /* ok */ }
                delete store[key];
            }
        }
    },

    // Constants edit: the width goes onto live layers, levels and color — a rebuild of the set.
    applyOutlines(view, c) {
        if (!view || !view.scene) return;
        c = c || this.cfg();
        for (const m of view.scene.meshes) {
            if (m.metadata && m.metadata.outline && !m.isAnInstance) this.outlineAdd(view, m, m.metadata.outline, c);
        }
    },

    // Outline fog tone — once per frame, before scene.render() (renderFrame).
    // The line is laid over the finished frame, and without the tone a distant object
    // dissolved in the fog while the black outline around it remained. The mesh's line color
    // is mixed with the fog by the SAME formula Babylon applies to the surface
    // (fogFragment: mix(fogColor, color, f)), at the distance from the camera to the mesh
    // center. No constants of its own: the fog is the scene's (WORLD3D_FOG_DENSITY,
    // WORLD3D_SKY_COLOR, the view's opts overrides). One tone per mesh. For a mesh with
    // instances (thin or regular — e.g. a forest as one mesh) the bounds
    // center is the middle of the whole scatter, and a tone based on it would be wrong for
    // copies near the camera: their tone is by the distance to the camera's look-at point.
    outlineFog(view) {
        const store = view && view._outlines;
        if (!store || !view.scene || !view.camera) return;
        const scene = view.scene, fog = scene.fogColor, cam = view.camera;
        cam.getViewMatrix();   // globalPosition is recomputed with the view matrix, and the frame render is still ahead
        const eye = cam.globalPosition;
        const focus = BABYLON.Vector3.Distance(eye, cam.getTarget());
        for (const key in store) {
            const rec = store[key], ink = rec.ink;
            if (!ink) continue;
            let darkest = Infinity;
            for (const [m, tone] of rec.meshes) {
                let d = focus;
                if (!m.hasThinInstances && !(m.instances && m.instances.length)) {
                    m.computeWorldMatrix();   // the object may have been moved since the last frame
                    d = BABYLON.Vector3.Distance(eye, m.getBoundingInfo().boundingSphere.centerWorld);
                }
                const f = m.applyFog === false ? 1 : this.fogFactor(scene, d);
                rec.hl.addMesh(m, tone.set(fog.r + (ink.r - fog.r) * f, fog.g + (ink.g - fog.g) * f, fog.b + (ink.b - fog.b) * f));
                // Luminance — same as the sample selection in the blur (glowBlurPostProcess).
                const lum = 0.2126 * tone.r + 0.7152 * tone.g + 0.0722 * tone.b;
                if (lum < darkest) { darkest = lum; rec.hl.neutralColor.set(tone.r, tone.g, tone.b, 0); }
            }
        }
    },

    // The fraction of the surface color that the scene fog leaves at distance d
    // (1 — no fog, 0 — fog only). Formulas — CalcFogFactor from
    // Babylon's fogFragmentDeclaration.
    fogFactor(scene, d) {
        if (!scene.fogEnabled) return 1;
        const S = BABYLON.Scene, rho = scene.fogDensity;
        let f = 1;
        if (scene.fogMode === S.FOGMODE_EXP) f = Math.exp(-d * rho);
        else if (scene.fogMode === S.FOGMODE_EXP2) f = Math.exp(-(d * rho) * (d * rho));
        else if (scene.fogMode === S.FOGMODE_LINEAR) f = (scene.fogEnd - d) / (scene.fogEnd - scene.fogStart);
        return Math.max(0, Math.min(1, f));
    },

    // --- Utilities -------------------------------------------------------------

    // The "where the sun shines" vector (unit, downward): azimuth on the map (0 — right,
    // 90 — down), elevation above the horizon.
    sunDirection(c) {
        c = c || this.cfg();
        const az = c.sunAz * Math.PI / 180;
        const el = c.sunEl * Math.PI / 180;
        const ce = Math.cos(el);
        return new BABYLON.Vector3(Math.cos(az) * ce, -Math.sin(el), Math.sin(az) * ce);
    },

    hexColor3(v) {
        if (typeof v === 'string') return BABYLON.Color3.FromHexString(v);
        const n = (v >>> 0) & 0xffffff;
        return new BABYLON.Color3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    }
};

// --- Ink edges of a skinned mesh ------------------------------------------------

// EdgesRenderer builds its lines ONCE, out of the rest pose, and Babylon's "line" shader
// knows nothing about bones: on a character the ink would hang in the rest pose while the
// bones move the mesh (that is why skinned meshes used to be left without ink at all).
// The SET of lines never changes — only where their ends are. So each line end is mapped
// ONCE to the mesh vertex it was copied from, and before every draw the posed ends are
// written into the line buffers. The mesh itself is still skinned on the GPU: the CPU here
// touches only the vertices the lines use (812 of them on the kit's character — ~0.05 ms).
//
// Created by World3D.inkMesh for a mesh with a skeleton, dropped by inkSkinRelease before
// the edges renderer that owns the buffers goes away (mesh.metadata.inkSkin).
class InkSkin {
    constructor(mesh) {
        this.mesh = mesh;
        this.ok = false;
        this._frame = -1;
        const VB = BABYLON.VertexBuffer;
        const er = /** @type {any} */ (mesh.edgesRenderer);
        const scene = mesh.getScene();
        if (!er || !mesh.skeleton || !er.linesPositions.length) return;
        const pos = mesh.getVerticesData(VB.PositionKind);
        const indices = mesh.getIndices();
        const bones = mesh.getVerticesData(VB.MatricesIndicesKind);
        const weights = mesh.getVerticesData(VB.MatricesWeightsKind);
        if (!pos || !indices || !bones || !weights) return;   // a skeleton without skinning data
        this._rest = pos;
        this._bones = bones;
        this._weights = weights;
        this._bonesExtra = mesh.numBoneInfluencers > 4 ? mesh.getVerticesData(VB.MatricesIndicesExtraKind) : null;
        this._weightsExtra = this._bonesExtra ? mesh.getVerticesData(VB.MatricesWeightsExtraKind) : null;
        if (!this._weightsExtra) this._bonesExtra = null;   // 5..8 influences, but no weights for them
        this._map(er, pos, indices);
        this._own(er, scene.getEngine());
        this._observer = mesh.onBeforeRenderObservable.add(() => this.update());
        this.ok = true;
        this.update();
    }

    // Line end -> mesh vertex. The renderer copies vertex coordinates verbatim
    // (createLine: p0, p0, p1, p1 for the positions and the opposite end in the normals), so
    // the position is an exact key. Lowpoly duplicates every vertex per face, so a key
    // usually has several candidates: the pair that shares a TRIANGLE wins — at a seam where
    // two bones meet, the other candidate would fly away with the wrong bone. The four
    // vertices of one line quad are resolved together, or the quad would be stretched
    // between two bones.
    _map(er, pos, indices) {
        const n = pos.length / 3;
        const byPos = new Map();
        for (let v = 0; v < n; v++) {
            const key = pos[3 * v] + '|' + pos[3 * v + 1] + '|' + pos[3 * v + 2];
            const list = byPos.get(key);
            if (list) list.push(v); else byPos.set(key, [v]);
        }
        const pair = new Set();
        for (let t = 0; t + 2 < indices.length; t += 3) {
            const a = indices[t], b = indices[t + 1], c = indices[t + 2];
            pair.add(a * n + b); pair.add(b * n + a);
            pair.add(b * n + c); pair.add(c * n + b);
            pair.add(c * n + a); pair.add(a * n + c);
        }
        const lp = er.linesPositions, ln = er.linesNormals;
        const count = lp.length / 3;
        const from = this._from = new Int32Array(count);     // vertex of the line end itself
        const to = this._to = new Int32Array(count);         // vertex of the other end (normal.xyz)
        const used = new Set();
        for (let i = 0; i < count; i += 4) {
            const A = byPos.get(lp[3 * i] + '|' + lp[3 * i + 1] + '|' + lp[3 * i + 2]) || [0];
            const B = byPos.get(ln[4 * i] + '|' + ln[4 * i + 1] + '|' + ln[4 * i + 2]) || [0];
            let a = A[0], b = B[0];
            if (A.length > 1 || B.length > 1) {
                search: for (const x of A) {
                    for (const y of B) if (pair.has(x * n + y)) { a = x; b = y; break search; }
                }
            }
            from[i] = from[i + 1] = a; from[i + 2] = from[i + 3] = b;
            to[i] = to[i + 1] = b; to[i + 2] = to[i + 3] = a;
            used.add(a); used.add(b);
        }
        this._used = Int32Array.from(used);
        this._posed = new Float32Array(n * 3);
    }

    // The renderer's own line buffers are static (updatable = false) and updateDirectly on
    // them does nothing at all, without a word — the pair is replaced with updatable ones.
    // They belong to the renderer from here on: it disposes and rebuilds them as its own.
    _own(er, engine) {
        const VB = BABYLON.VertexBuffer;
        const line = this._line = new Float32Array(er.linesPositions);
        const next = this._next = new Float32Array(er.linesNormals);
        const bufLine = new VB(engine, line, VB.PositionKind, true, false, 3);
        const bufNext = new VB(engine, next, VB.NormalKind, true, false, 4);
        er._buffers[VB.PositionKind].dispose();
        er._buffers[VB.NormalKind].dispose();
        er._buffers[VB.PositionKind] = bufLine;
        er._buffers[VB.NormalKind] = bufNext;
        er._buffersForInstances[VB.PositionKind] = bufLine;
        er._buffersForInstances[VB.NormalKind] = bufNext;
        this._bufLine = bufLine;
        this._bufNext = bufNext;
    }

    // Pose the lines. Called before the mesh is drawn, when the skeleton's matrices for the
    // frame are ready; the shadow map and the outline mask draw the same mesh again — hence
    // the render id guard.
    update() {
        if (!this._bufLine) return;
        const mesh = this.mesh, scene = mesh.getScene();
        const frame = scene.getRenderId();
        if (frame === this._frame) return;
        this._frame = frame;
        // The same sum the vertex shader does (bonesVertex): the skeleton's matrices are in
        // the mesh's space, the mesh's world matrix is applied by the line shader afterwards.
        const m = mesh.skeleton.getTransformMatrices(mesh);
        const rest = this._rest, out = this._posed;
        for (const v of this._used) {
            const x = rest[3 * v], y = rest[3 * v + 1], z = rest[3 * v + 2];
            let px = 0, py = 0, pz = 0;
            for (let k = 0; k < 8; k++) {
                const extra = k > 3;
                if (extra && !this._bonesExtra) break;
                const idx = extra ? this._bonesExtra : this._bones;
                const wts = extra ? this._weightsExtra : this._weights;
                const at = 4 * v + (k & 3);
                const w = wts[at];
                if (!w) continue;
                const o = (idx[at] | 0) * 16;
                px += w * (m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12]);
                py += w * (m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13]);
                pz += w * (m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14]);
            }
            out[3 * v] = px; out[3 * v + 1] = py; out[3 * v + 2] = pz;
        }
        const line = this._line, next = this._next, from = this._from, to = this._to;
        for (let i = 0; i < from.length; i++) {
            const a = 3 * from[i], b = 3 * to[i];
            line[3 * i] = out[a]; line[3 * i + 1] = out[a + 1]; line[3 * i + 2] = out[a + 2];
            next[4 * i] = out[b]; next[4 * i + 1] = out[b + 1]; next[4 * i + 2] = out[b + 2];
            // next[4 * i + 3] is the side of the line quad — it does not move.
        }
        this._bufLine.updateDirectly(line, 0);
        this._bufNext.updateDirectly(next, 0);
    }

    dispose() {
        if (this._observer) this.mesh.onBeforeRenderObservable.remove(this._observer);
        this._observer = null;
        this._bufLine = null;
        this._bufNext = null;
        this.ok = false;
    }
}

// --- Toon material plugin -------------------------------------------------------

// StandardMaterial plugin. Lives on every material (material.arcToon). Two
// independent defines:
//   ARCSHADOW — colored shadow (see the file header): on all lit materials
//               of a scene that has scene.metadata.arcSun (set by
//               View3D.applyLighting);
//   ARCTOON   — light bands (World3D.toon.s.on).
// Values go out as uniforms on every bind (no shader rebuild),
// defines — on markAllDefinesAsDirty. Materials of the 'ground' group get
// bands = 0 when WORLD3D_TOON_GROUND is off, and rim light 0 — branching in the
// shader, not in a define, so that the editor's toggles do not recompile
// shaders. metadata.toon = false turns the bands off on a material.
class ArcToonPlugin extends BABYLON.MaterialPluginBase {
    constructor(material) {
        super(material, 'ArcToon', 500, { ARCTOON: false, ARCSHADOW: false }, true, true);
    }

    getClassName() { return 'ArcToonPlugin'; }

    prepareDefines(defines, scene, mesh) {
        const s = World3D.toon.s;
        const m = /** @type {BABYLON.StandardMaterial} */ (this._material);
        const lit = !m.disableLighting;
        defines.ARCTOON = !!(s.on && lit && !(m.metadata && m.metadata.toon === false));
        defines.ARCSHADOW = !!(lit && scene.metadata && scene.metadata.arcSun);
    }

    getUniforms() {
        return {
            ubo: [
                { name: 'arcToonA', size: 4, type: 'vec4' },
                { name: 'arcToonB', size: 4, type: 'vec4' },
                { name: 'arcShadowColor', size: 4, type: 'vec4' },
                { name: 'arcSunDir', size: 4, type: 'vec4' },
                { name: 'arcSunColor', size: 4, type: 'vec4' }
            ],
            fragment: '#ifdef ARCTOON\nuniform vec4 arcToonA;\nuniform vec4 arcToonB;\n#endif\n' +
                '#ifdef ARCSHADOW\nuniform vec4 arcShadowColor;\nuniform vec4 arcSunDir;\nuniform vec4 arcSunColor;\n#endif'
        };
    }

    bindForSubMesh(ubo, scene, engine, subMesh) {
        const s = World3D.toon.s;
        const m = this._material;
        const md = scene.metadata;
        if (md && md.arcSun) {
            const sun = md.arcSun, sh = md.arcShadow || {};
            const col = sh.color || World3D.hexColor3(0x012d3c);
            ubo.updateFloat4('arcShadowColor', col.r, col.g, col.b, sh.strength != null ? sh.strength : 0.36);
            ubo.updateFloat4('arcSunDir', sun.dir.x, sun.dir.y, sun.dir.z, 0);
            ubo.updateFloat4('arcSunColor', sun.color.r, sun.color.g, sun.color.b, 0);
        }
        const ground = !!(m.metadata && m.metadata.toonGroup === 'ground');
        const bands = (ground && !s.ground) ? 0 : s.bands;
        ubo.updateFloat4('arcToonA', bands, s.soft, s.low, s.spec);
        ubo.updateFloat4('arcToonB', s.specSize, ground ? 0 : s.rim, s.rimWidth, 0);
    }

    getCustomCode(shaderType) {
        return shaderType === 'fragment' ? ArcToonPlugin.CODE : null;
    }
}

// arcToonA = (bands, softness, lowest band, specular highlight strength),
// arcToonB = (specular highlight threshold, rim light strength, rim light width, —),
// arcShadowColor = (shadow color, strength), arcSunDir = toward the sun, arcSunColor =
// sun diffuse × intensity (like Babylon's vLightDiffuse).
ArcToonPlugin.CODE = {
    CUSTOM_FRAGMENT_DEFINITIONS: `
#ifdef ARCTOON
float arcToonLevel(float v) {
    float bands = arcToonA.x;
    float lo = arcToonA.z;
    float t = clamp((v - lo) / max(1e-4, 1.0 - lo), 0.0, 1.0);
    float x = t * (bands - 1.0);
    float k = floor(x + 0.5);
    float d = x - k;
    float s = max(1e-3, arcToonA.y);
    float q = k + smoothstep(0.5 - s, 0.5 + s, d) - smoothstep(0.5 - s, 0.5 + s, -d);
    return lo + clamp(q / (bands - 1.0), 0.0, 1.0) * (1.0 - lo);
}
#endif
`,
    // Shadow fraction at the point — shared by the colored shadow and the toon rim light.
    CUSTOM_FRAGMENT_MAIN_BEGIN: `
float arcShadowA = 0.0;
`,
    // Right after the light of all sources is summed (default.fragment):
    // diffuseBase and specularBase are not yet multiplied by color/texture. First
    // the colored shadow: the sun visibility is the shadow variable of the LAST light
    // (the sun; generator darkness 0), the unshadowed light is reconstructed
    // by adding back the hidden fraction of the sun.
    '!!aggShadow=aggShadow/numLights;': `$0
#ifdef ARCSHADOW
{
    float arcV = clamp(shadow, 0.0, 1.0);
    vec3 arcSunD = arcSunColor.rgb * max(0.0, dot(normalW, arcSunDir.xyz));
    vec3 arcU = max(vec3(0.0), diffuseBase + arcSunD * (1.0 - arcV));
    arcShadowA = 1.0 - arcV;
    diffuseBase = arcU * mix(vec3(1.0), arcShadowColor.rgb, arcShadowA * arcShadowColor.a);
#ifdef SPECULARTERM
    specularBase *= 1.0 - arcShadowA;
#endif
}
#endif
#ifdef ARCTOON
if (arcToonA.x >= 1.5) {
    float arcV = max(diffuseBase.r, max(diffuseBase.g, diffuseBase.b));
    float arcQ = arcToonLevel(arcV);
    diffuseBase = arcV > 1e-4 ? diffuseBase * (arcQ / arcV) : vec3(arcQ);
#ifdef SPECULARTERM
    float arcS = max(specularBase.r, max(specularBase.g, specularBase.b));
    float arcW = max(0.005, arcToonA.y * 0.25);
    float arcH = smoothstep(arcToonB.x - arcW, arcToonB.x + arcW, arcS) * arcToonA.w;
    specularBase = (arcS > 1e-5 ? specularBase / arcS : vec3(0.0)) * arcH;
#endif
}
#endif
`,
    // Rim light along the silhouette edge — lighter than the base color, fades out in shadow.
    CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef ARCTOON
if (arcToonB.y > 0.0) {
    float arcF = 1.0 - max(0.0, dot(normalW, viewDirectionW));
    float arcE = 1.0 - arcToonB.z;
    float arcR = smoothstep(arcE - 0.05, arcE + 0.05, arcF) * arcToonB.y * (1.0 - arcShadowA);
    color.rgb += baseColor.rgb * arcR;
}
#endif
`
};

/** @satisfies {Record<string, any>} */
const ArcToon = {
    s: { on: true, bands: 3, soft: 0.06, low: 0.35, ground: true, spec: 1, specSize: 0.12, rim: 0.25, rimWidth: 0.35 },
    registered: false,

    // Once per page: the factory attaches the plugin to every new StandardMaterial
    // (material creation event). GLSL (WebGL) only — like the whole world.
    register() {
        if (this.registered || typeof BABYLON === 'undefined' || !BABYLON.MaterialPluginBase ||
            typeof BABYLON.RegisterMaterialPlugin !== 'function') return;
        this.registered = true;
        this.load(World3D.cfg());
        BABYLON.RegisterMaterialPlugin('ArcToon', (material) => {
            if (!(material instanceof BABYLON.StandardMaterial)) return null;
            if (material.shaderLanguage != null && material.shaderLanguage !== 0) return null;
            material.arcToon = new ArcToonPlugin(material);
            return material.arcToon;
        });
    },

    load(c) {
        this.s = {
            on: c.toon > 0,
            bands: Math.max(2, Math.min(8, Math.round(c.toonBands))),
            soft: Math.max(0, Math.min(0.5, c.toonSoft)),
            low: Math.max(0, Math.min(0.95, c.toonLow)),
            ground: c.toonGround > 0,
            spec: Math.max(0, c.toonSpec),
            specSize: Math.max(0.005, c.toonSpecSize),
            rim: Math.max(0, c.toonRim),
            rimWidth: Math.max(0.02, Math.min(0.95, c.toonRimWidth))
        };
    },

    // New constants: values — as uniforms on the next bind; on/off
    // — a shader rebuild of all materials with the plugin in all engines of the page.
    apply(c) {
        const wasOn = this.s.on;
        this.load(c || World3D.cfg());
        if (wasOn === this.s.on || !BABYLON.EngineStore) return;
        for (const eng of BABYLON.EngineStore.Instances) {
            for (const sc of eng.scenes) {
                for (const m of sc.materials) if (m.arcToon) m.arcToon.markAllDefinesAsDirty();
                sc.resetCachedMaterial();
            }
        }
    }
};
World3D.toon = ArcToon;

// One 3D view: its own Babylon scene, camera, light and shadows.
class View3D {
    // opts: { sky?, groundTint?, shadowColor?, fogDensity?, shadowRadius? } — constant overrides
    constructor(world, opts) {
        this.world = world;
        this.opts = opts;
        this.active = false;
        this.engine = world.engine;

        const scene = new BABYLON.Scene(this.engine);
        this.scene = scene;
        // Right-handed system: X = x, Z = y of the map (y down) viewed from above
        // puts east on the RIGHT; in a left-handed one the same world came out mirrored.
        scene.useRightHandedSystem = true;
        scene.detachControl();
        scene.skipPointerMovePicking = true;
        scene.skipFrustumClipping = false;
        scene.autoClear = true;
        scene.autoClearDepthAndStencil = true;
        // The OVERLAY and ACTOR layers do NOT clear depth (World3D.LAYER): marks on top of
        // the world are let through by their material's ALWAYS test, while ACTOR is still
        // tested against the world depth. Clearing depth instead of ALWAYS has already been
        // tried — ACTOR objects started showing through walls.
        scene.setRenderingAutoClearDepthStencil(World3D.LAYER.OVERLAY, false);
        scene.setRenderingAutoClearDepthStencil(World3D.LAYER.ACTOR, false);
        scene.ambientColor = new BABYLON.Color3(0.35, 0.35, 0.38);
        // Fog hides the ground edge at a low camera angle.
        scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;

        const c = World3D.cfg();

        // --- Camera: TargetCamera without built-in inputs, driven by CameraController ---
        this.camera = new BABYLON.TargetCamera('cam', new BABYLON.Vector3(0, 600, 0), scene);
        this.camera.fov = ((typeof CAMERA_FOV_DEG !== 'undefined') ? CAMERA_FOV_DEG : 52) * Math.PI / 180;
        this.camera.minZ = 6;
        this.camera.maxZ = 9000;
        this.camera.setTarget(new BABYLON.Vector3(1, 0, 1));
        scene.activeCamera = this.camera;

        // --- Light: sky (hemisphere) + sun; values — applyLighting ---
        this.hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
        this.hemi.specular = new BABYLON.Color3(0, 0, 0);

        this.sun = new BABYLON.DirectionalLight('sun', World3D.sunDirection(c), scene);
        this.sun.specular = new BABYLON.Color3(0.25, 0.25, 0.25);
        this.sun.autoUpdateExtends = false;
        // Shadow map depth — from the sun position (LIGHT_DIST from the target):
        // a narrow range = precision, a wide one (1..6000) lost shadows.
        this.sun.shadowMinZ = View3D.LIGHT_DIST - 1200;
        this.sun.shadowMaxZ = View3D.LIGHT_DIST + 1200;
        this._shadowRadius = opts.shadowRadius || (IS_MOBILE ? Math.min(520, c.shadowRadius) : c.shadowRadius);

        const mapSize = IS_MOBILE ? Math.max(512, c.shadowMap / 2) : c.shadowMap;
        this._mapSize = mapSize;
        this.shadow = new BABYLON.ShadowGenerator(mapSize, this.sun);
        this.shadow.transparencyShadow = false;
        this.applyLighting(c);
        this.updateLightFrustum(0, 0, 0);

        this._syncFns = [];   // functions called before every 3D frame
        this.active = true;
        world.view = this;
    }

    // Light, sky, fog and shadows from the render constants (the view's opts override them).
    // Also here — the colored shadow plugin data (scene.metadata.arcSun, arcShadow):
    // shadow density and color are computed by the shader, Babylon's darkness is 0.
    // The light is tuned so that flat ground comes out ≈1.0 (texture paint
    // unchanged), slopes and shadows darken; sums above ~1.2 clamp to white.
    applyLighting(c) {
        c = c || World3D.cfg();
        const o = this.opts || {};
        const scene = this.scene;
        const sky = World3D.hexColor3(o.sky != null ? o.sky : c.sky);
        scene.clearColor = new BABYLON.Color4(sky.r, sky.g, sky.b, 1);
        scene.fogColor = sky;
        scene.fogDensity = Math.max(0, o.fogDensity != null ? o.fogDensity : c.fog);

        this.hemi.intensity = Math.max(0, c.skyIntensity);
        this.hemi.diffuse = World3D.hexColor3(c.skyLight);
        this.hemi.groundColor = World3D.hexColor3(o.groundTint != null ? o.groundTint : c.groundLight);

        this.sun.direction = World3D.sunDirection(c);
        this.sun.intensity = Math.max(0, c.sunIntensity);
        this.sun.diffuse = World3D.hexColor3(c.sunColor);

        const md = scene.metadata || (scene.metadata = {});
        md.arcSun = {
            dir: this.sun.direction.negate().normalize(),
            color: this.sun.diffuse.scale(this.sun.intensity)
        };
        md.arcShadow = {
            color: World3D.hexColor3(o.shadowColor != null ? o.shadowColor : c.shadowColor),
            strength: Math.max(0, Math.min(1, c.shadowStrength))
        };

        const sg = this.shadow;
        sg.setDarkness(0);   // shadow color and strength come from the plugin (ARCSHADOW), Babylon — visibility only
        sg.bias = c.shadowBias;
        // Shadow edge: 0 — hard (one map sample), otherwise PCF (WebGL2) or
        // Poisson (WebGL1); on mobile — no higher than low quality.
        let soft = Math.max(0, Math.min(3, Math.round(c.shadowSoft)));
        if (IS_MOBILE && soft > 1) soft = 1;
        const webgl2 = this.engine.webGLVersion >= 2;
        if (webgl2) {
            sg.usePoissonSampling = false;
            sg.usePercentageCloserFiltering = soft > 0;
            if (soft > 0) {
                sg.filteringQuality = soft >= 3 ? BABYLON.ShadowGenerator.QUALITY_HIGH
                    : (soft === 2 ? BABYLON.ShadowGenerator.QUALITY_MEDIUM : BABYLON.ShadowGenerator.QUALITY_LOW);
            }
        } else {
            sg.usePercentageCloserFiltering = false;
            sg.usePoissonSampling = soft > 0;
        }
        // Normal bias is in map TEXELS: "shadow acne" (stripes and a "sawtooth" on faces
        // at an acute angle to the sun) grows with the texel, and the shadow frustum shrinks
        // and grows (fitShadowFrustum). The edge filter compares depth on neighboring
        // texels too — its radius is added to the constant (PCF 1/3/5 samples —
        // 0.5/1.5/2.5 texels, Poisson — 1), otherwise with a soft edge the "sawtooth"
        // comes back. updateLightFrustum converts it to world px.
        const filter = soft === 0 ? 0 : (webgl2 ? [0, 0.5, 1.5, 2.5][soft] : 1);
        this._normalBiasTexels = Math.max(0, c.shadowNormalBias) + filter;
        // The sun position depends on the direction — recompute the ortho frustum.
        if (this._lightAt) this.updateLightFrustum(this._lightAt.x, this._lightAt.y, this._lightAt.h, this._lightAt.r);
    }

    // The sun's ortho frustum follows the point of interest (usually the camera target):
    // shadows are crisp where the player is looking, not smeared over the whole world.
    // radius — override of the frustum half-size.
    updateLightFrustum(x, y2d, h, radius) {
        const R = radius || this._shadowRadius;
        const d = this.sun.direction;
        const L = View3D.LIGHT_DIST;
        this._lightAt = { x: x, y: y2d, h: h || 0, r: radius };
        this.sun.position = new BABYLON.Vector3(x - d.x * L, (h || 0) - d.y * L, y2d - d.z * L);
        this.sun.orthoLeft = -R;
        this.sun.orthoRight = R;
        this.sun.orthoTop = R;
        this.sun.orthoBottom = -R;
        // Map texel in world px: Babylon expands the frustum by shadowOrthoScale on each side.
        const texel = 2 * R * (1 + 2 * this.sun.shadowOrthoScale) / this._mapSize;
        this.shadow.normalBias = (this._normalBiasTexels || 0) * texel;
    }

    // The sun's ortho frustum fitted to the SHADOW CASTERS the camera has in front of it:
    // the smaller the frustum, the more map texels per world px and the crisper the shadow (a
    // 720 px frustum with a 1024 map gave 0.7 texels per px — the shadow blurred into a blob).
    //   • cam — { x, y, h, dx, dy }: the ground point under the EYE and the unit direction the
    //     camera looks on the map. The box sits three quarters of itself ahead of the camera, so
    //     it covers the ground from just behind the eye out into the frame. It follows the EYE and
    //     not the ground at the frame center, because it is capped by _shadowRadius and cannot
    //     cover the whole frame anyway — so it covers what is CLOSE, where a shadow is large on
    //     screen. Led by the frame center the frame lost its shadows entirely: fly up to a building
    //     and raise your head and that point is a thousand px past the building, toward the
    //     horizon; fly forward and down and it falls BEHIND the camera; from above it sits under
    //     the eye. Pitch is deliberately NOT in this: shortening the reach by cos(pitch) dropped
    //     the shadows of a zoomed-out frame, where the camera is high and everything is far;
    //   • center — the middle of the BOUNDS of the shadow casters (world bounding box) that
    //     fall within maxR (the rest are beyond the screen edge, their shadow is not visible).
    //     By positions the frustum cut off a big model's shadow: a building's position is one point;
    //   • added to the half-size — the height of the shadow casters above the point of
    //     interest as the sun sees it (× cos of the sun elevation: that is how far the top of
    //     an object shifts in the sun's frustum), but no less than PAD;
    //   • the radius is quantized in 32 px steps, the center — to the texel grid: otherwise
    //     the shadow edge "crawls" across texels on every camera shift;
    //   • a shadow caster with thin instances sits at the origin and its bounds would lie —
    //     with it the frustum is taken by maxR.
    fitShadowFrustum(cam, maxR) {
        const R0 = Math.min(maxR || this._shadowRadius, this._shadowRadius);
        const h = cam.h || 0;
        const list = this.shadow ? this.shadow.getShadowMap().renderList : null;
        // The SEED: the caster nearest the eye that is not behind the camera. The box is built
        // around it, so the shadow that is largest on screen is the one that never goes missing —
        // whatever the pitch, the flight height or the zoom. A fixed point ahead of the camera
        // cannot do that: it has to be near enough for a building you stand next to, and far
        // enough for a zoomed-out frame where everything is two thousand px away.
        let seedD = Infinity, sx = 0, sy = 0, wide = false;
        for (let i = 0; list && i < list.length; i++) {
            const m = list[i];
            if (m.hasThinInstances) { wide = true; break; }
            if (!m.isEnabled(false)) continue;
            m.computeWorldMatrix();
            const bb = m.getBoundingInfo().boundingBox, a = bb.minimumWorld, b = bb.maximumWorld;
            const mx = (a.x + b.x) / 2, my = (a.z + b.z) / 2;
            if ((mx - cam.x) * cam.dx + (my - cam.y) * cam.dy < -R0) continue;   // behind the camera
            const d = Math.hypot(mx - cam.x, my - cam.y);
            if (d < seedD) { seedD = d; sx = mx; sy = my; }
        }
        // Nothing to cast (or thin instances, whose bounds would lie): a box ahead of the camera.
        if (wide || seedD === Infinity) {
            const reach = R0 * View3D.SHADOW_AHEAD;
            this.updateLightFrustum(cam.x + cam.dx * reach, cam.y + cam.dy * reach, h, R0);
            return;
        }
        // Everything that fits in a box around the seed. World matrices are already up to date.
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, top = h, bottom = h;
        for (let i = 0; list && i < list.length; i++) {
            const m = list[i];
            if (!m.isEnabled(false)) continue;
            const bb = m.getBoundingInfo().boundingBox, a = bb.minimumWorld, b = bb.maximumWorld;
            if (Math.abs((a.x + b.x) / 2 - sx) > R0 || Math.abs((a.z + b.z) / 2 - sy) > R0) continue;
            if (a.x < x0) x0 = a.x;
            if (b.x > x1) x1 = b.x;
            if (a.z < y0) y0 = a.z;
            if (b.z > y1) y1 = b.z;
            if (b.y > top) top = b.y;
            if (a.y < bottom) bottom = a.y;
        }
        const PAD = 64;   // margin: the soft shadow edge and the corners of the bounds in the sun's frustum
        const dy = this.sun.direction.y;
        const rise = Math.max(top - h, h - bottom) * Math.sqrt(Math.max(0, 1 - dy * dy));
        let R = Math.max(View3D.SHADOW_MIN_RADIUS, Math.max(x1 - x0, y1 - y0) / 2 + Math.max(PAD, rise));
        R = Math.min(R0, Math.ceil(R / 32) * 32);
        // Hysteresis: while the previous radius still fits and is not wider than needed by more
        // than a step, keep it — otherwise at a step boundary R would flip between two
        // values every other frame, and the shadow edge would jitter by a texel.
        const prev = this._fitR;
        if (prev != null && prev <= R0 && prev >= R && prev - R <= 32) R = prev;
        this._fitR = R;
        // Casters spread wider than the box: the middle of their bounds can leave the seed out,
        // and the nearest object would be the one without a shadow. Pull the center back to it.
        let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const lim = Math.max(0, R - PAD), off = Math.hypot(cx - sx, cy - sy);
        if (off > lim) {
            const s = lim / off;
            cx = sx + (cx - sx) * s;
            cy = sy + (cy - sy) * s;
        }
        const q = 2 * R / Math.max(64, this._mapSize);
        this.updateLightFrustum(Math.round(cx / q) * q, Math.round(cy / q) * q, h, R);
    }

    addShadowCaster(mesh, includeDescendants) {
        if (this.shadow && mesh) this.shadow.addShadowCaster(mesh, includeDescendants !== false);
    }

    removeShadowCaster(mesh) {
        if (this.shadow && mesh) this.shadow.removeShadowCaster(mesh, true);
    }

    onBeforeFrame(fn) {
        this._syncFns.push(fn);
    }

    beforeRender() {
        for (const fn of this._syncFns) {
            try { fn(); } catch (e) { console.error('World3D sync:', e); }
        }
    }

    // --- Screen <-> world ---------------------------------------------------

    // The camera was moved, the frame has not been drawn yet — update the projection
    // matrices now (zoom to cursor, "follow the pointer" pan).
    refreshMatrices() {
        const cam = this.camera;
        this.scene.setTransformMatrix(cam.getViewMatrix(true), cam.getProjectionMatrix(true));
    }

    _renderScale() {
        const cw = this.world.canvas.clientWidth || 1;
        return this.engine.getRenderWidth() / cw;
    }

    // Screen point (canvas CSS px) -> map point ({x, y}) under the cursor.
    // With terrain — the ray intersection with the TERRAIN, without it — the plane Y = h.
    // null — the ray looks into the sky.
    pointerToGround(px, py, h, terrain) {
        // createPickingRay expects canvas CSS pixels: it accounts for the render scale
        // (hardwareScalingLevel) ITSELF. Multiplying by _renderScale() moved the point
        // away from the cursor the more, the farther it was from the top-left corner.
        const ray = this.scene.createPickingRay(px, py, BABYLON.Matrix.Identity(), this.camera, false);
        const o = ray.origin, d = ray.direction;
        if (Math.abs(d.y) < 1e-6) return null;
        const planeT = (yy) => (yy - o.y) / d.y;
        if (terrain && terrain.hgrid && Number.isFinite(terrain.hMin)) {
            // March along the ray from a level above the terrain maximum to a level below
            // the minimum; the first step under the surface is refined by bisection.
            let t0 = planeT(terrain.hMax + 1), t1 = planeT(terrain.hMin - 1);
            if (t1 > 0) {
                if (t0 < 0) t0 = 0;
                if (t1 > t0) {
                    const steps = Math.min(200, Math.max(48, Math.ceil((t1 - t0) / 4)));
                    const dt = (t1 - t0) / steps;
                    const under = (t) => (o.y + d.y * t) < terrain.heightAt(o.x + d.x * t, o.z + d.z * t);
                    let ta = t0;
                    for (let i = 1; i <= steps; i++) {
                        const t = t0 + dt * i;
                        if (under(t)) {
                            let a = ta, b = t;
                            for (let j = 0; j < 10; j++) {
                                const m = (a + b) / 2;
                                if (under(m)) b = m; else a = m;
                            }
                            const tm = (a + b) / 2;
                            return { x: o.x + d.x * tm, y: o.z + d.z * tm };
                        }
                        ta = t;
                    }
                }
            }
        }
        const t = planeT(h || 0);
        if (t <= 0) return null;
        return { x: o.x + d.x * t, y: o.z + d.z * t };
    }

    // Map point (x, y and height) -> screen CSS pixels of the canvas.
    // visible — the point is inside the viewport and in front of the camera. Vector3.Project
    // returns RENDER pixels — hence the division by _renderScale().
    projectToScreen(x, y2d, h) {
        const k = this._renderScale();
        const w = this.engine.getRenderWidth(), hh = this.engine.getRenderHeight();
        const p = BABYLON.Vector3.Project(
            new BABYLON.Vector3(x, h || 0, y2d),
            BABYLON.Matrix.Identity(),
            this.scene.getTransformMatrix(),
            this.camera.viewport.toGlobal(w, hh));
        const sx = p.x / k, sy = p.y / k;
        const behind = p.z > 1 || p.z < 0;
        return {
            x: sx, y: sy, behind: behind,
            visible: !behind && sx >= 0 && sy >= 0 && sx <= w / k && sy <= hh / k
        };
    }

    // Everything created in the scene (meshes, materials, outline layers) dies with it.
    dispose() {
        this.active = false;
        if (this.world.view === this) this.world.view = null;
        this._syncFns = [];
        try { this.scene.dispose(); } catch (e) { /* already disposed */ }
        this.scene = null;
    }
}

// Distance from the camera target to the "sun" (center of the shadow ortho frustum), px.
View3D.LIGHT_DIST = 2200;
// Minimum half-size of the shadow ortho frustum: one object with its shadow.
View3D.SHADOW_MIN_RADIUS = 140;
// How far ahead of the camera the shadow frustum sits, in its own half-sizes: the quarter left
// behind covers the ground under and just past the eye, the rest reaches into the frame.
View3D.SHADOW_AHEAD = 0.75;
