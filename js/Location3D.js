// Location3D.js — the location: a 3D view (light, sky, fog, shadows), ground (Terrain3D)
// of size LOCATION_WIDTH × LOCATION_HEIGHT with the LOCATION_GROUND texture, and
// objects — models from Objects.js (LOCATION_OBJECTS), placed by the editor.
// Shared by the game (main.js) and the editor (_utils/editor/lab.js): both call
// update(dt) every frame — part spin of models (def.anim) and the looped clip (def.clip).
// Game code finds what the editor placed by tag (findByTag) and reveals objects the
// designer left out of the scene (setHidden). The game creates its own objects in
// location.view.scene and registers them with World3D.addObject(location.view,
// mesh, 'actor' | 'prop'); put them on the ground via location.terrain.heightAt(x, y).

class Location3D {
    // opts: { assetBase?: '' — game (paths from index.html) | '/' — editor (from the server root),
    //         objects?: LOCATION_OBJECTS records }
    constructor(opts) {
        this.opts = opts || {};
        this.view = World3D.createView({});
        /** @type {Terrain3D | null} */
        this.terrain = null;
        /** @type {LocationObject[]} */
        this.objects = [];   // { def, mesh, error, loaded } — see addObject
        this._groundImage = null;
        this._groundIndex = -1;
        this.buildTerrain();
        this.lights = [];
        if (!this.opts.isEditor && this.opts.level?.lights) {
            this.buildLights(this.opts.level.lights);
        }
        const models = (this.opts.objects || []).map(def => this.addObject(def).loaded);
        // Readiness belongs to this location's assets, not to the entire live scene.
        // Global executeWhenReady also waits for gameplay particles, glow/shadow targets
        // and post-process recompiles added later, which can keep the loader open forever.
        this.ready = Promise.all([this.loadGround(), Promise.resolve(this.terrain.ready).then(() => this.placeObjects())].concat(models));
    }

    buildLights(lightsList) {
        for (const l of this.lights) {
            try { l.dispose(); } catch (_) {}
        }
        this.lights = [];
        const scene = this.view.scene;
        if (!scene || !Array.isArray(lightsList)) return;
        for (const def of lightsList) {
            const pos = new BABYLON.Vector3(def.x || 0, def.h != null ? def.h : 60, def.y || 0);
            const color = def.color ? BABYLON.Color3.FromHexString(def.color) : new BABYLON.Color3(1, 0.95, 0.8);
            if (def.type === 'spot') {
                const dirArr = def.direction || [0, -1, 0.2];
                const dir = new BABYLON.Vector3(dirArr[0], dirArr[1], dirArr[2]).normalize();
                const angle = (def.angle || 60) * Math.PI / 180;
                const spot = new BABYLON.SpotLight('loc_spot_' + def.id, pos, dir, angle, def.exponent != null ? def.exponent : 1.5, scene);
                spot.diffuse = color;
                spot.intensity = def.intensity != null ? def.intensity : 2.0;
                spot.range = def.range || 450;
                spot.falloffType = BABYLON.Light.FALLOFF_STANDARD;
                spot.innerAngle = (angle * 0.6);
                this.lights.push(spot);
            } else {
                const pt = new BABYLON.PointLight('loc_point_' + def.id, pos, scene);
                pt.diffuse = color;
                pt.intensity = def.intensity != null ? def.intensity : 1.5;
                pt.range = def.range || 300;
                pt.falloffType = BABYLON.Light.FALLOFF_STANDARD;
                this.lights.push(pt);
            }
        }
    }

    // Convert the editor's persisted lighting schema at the shared location boundary.
    // Both preview and gameplay use View3D's same lighting implementation.
    applyLightingSettings(settings = {}) {
        const base = World3D.cfg();
        const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
            ? parseInt(value.slice(1), 16) : fallback;
        const sunEl = settings.sunElevation ?? settings.sunEl ?? base.sunEl;
        const nightFactor = settings.nightFactor != null
            ? Number(settings.nightFactor)
            : (settings.sunEnabled === false
                ? 1.0
                : (sunEl >= 0 ? 0.0 : Math.min(1.0, Math.max(0.0, -sunEl / 20.0))));
        const cfg = {
            ...base,
            sunEnabled: settings.sunEnabled !== false,
            sunAz: settings.sunAzimuth ?? settings.sunAz ?? base.sunAz,
            sunEl: sunEl,
            sunIntensity: settings.sunEnabled === false ? 0 : (settings.sunIntensity ?? settings.sunInt ?? base.sunIntensity),
            sunColor: color(settings.sunColor ?? settings.sunCol, base.sunColor),
            skyIntensity: Math.max(0.15, settings.ambientIntensity ?? settings.skyIntensity ?? settings.ambInt ?? base.skyIntensity),
            skyLight: color(settings.skyLight ?? settings.skyColor, base.skyLight),
            sky: color(settings.sky ?? settings.skyColor, base.sky),
            groundLight: color(settings.groundLight ?? settings.groundColor, base.groundLight),
            shadowColor: color(settings.shadowColor, base.shadowColor),
            shadowStrength: settings.shadowStrength ?? base.shadowStrength,
            nightFactor: nightFactor
        };
        this.view.applyLighting(cfg);
        return cfg;
    }

    get width() { return Math.max(64, this.opts.level?.dimensions?.width || ((typeof LOCATION_WIDTH !== 'undefined') ? LOCATION_WIDTH : 2048)); }
    get height() { return Math.max(64, this.opts.level?.dimensions?.height || ((typeof LOCATION_HEIGHT !== 'undefined') ? LOCATION_HEIGHT : 2048)); }

    // (Re)build the ground from the location size and TERRAIN_* (editor — live).
    // Location objects settle onto the new ground; the game's own objects are the owner's concern.
    buildTerrain() {
        if (this.terrain) this.terrain.dispose();
        const t = this.opts.level?.terrain || {};
        const hasHeightmap = !!(t.samples || t.heightmap);
        let outerRingCfg = t.outerRing;
        if (outerRingCfg === undefined) {
            outerRingCfg = (this.opts.isEditor || hasHeightmap) ? 0 : Terrain3D.OUTER_RING;
        }
        this.terrain = new Terrain3D(this.view, {
            cell: t.cell,
            noise: { base: t.base, amp: t.noiseAmp, scale: t.noiseScale, seed: t.seed },
            heightmap: t.samples || t.heightmap,
            heightmapOptions: { width: t.nx, height: t.ny, minHeight: t.minHeight, maxHeight: t.maxHeight, blendNoise: t.samples ? 0 : t.blendNoise },
            worldW: this.width,
            worldH: this.height,
            groundImage: this._groundImage,
            outerRing: outerRingCfg,
            outerRingMode: t.outerRingMode
        });
        this.placeObjects();
        const terrain = this.terrain;
        terrain.ready = Promise.resolve(terrain.ready).then(() => {
            if (this.terrain === terrain && this.view) this.placeObjects();
        });
        return terrain;
    }

    // --- Location objects -----------------------------------------------------------

    // LOCATION_OBJECTS record -> object: { def, mesh, error, loaded }. The record
    // is returned immediately; the mesh appears once the model finishes loading (loaded —
    // a promise). No file — an object without a mesh (error), the scene doesn't crash.
    // def: { name, model, kind, x, y, h, rot, scale, anim?, clip?, tag?, hidden? } — the fields are
    // live: edit + placeObject; anim and clip are read every frame (spinPart, playClip);
    // hidden — through setHidden.
    /** @param {LocationObjectDef} def @returns {LocationObject} */
    addObject(def) {
        /** @type {LocationObject} */
        const rec = { def, mesh: null, error: null, loaded: null };
        this.objects.push(rec);
        rec.loaded = Model3D.load((this.opts.assetBase || '') + def.model, this.view.scene).then((model) => {
            if (this.objects.indexOf(rec) < 0 || !this.view) return rec;   // removed while loading
            rec.mesh = Model3D.build(model, this.view.scene, { name: def.name || 'object' });
            rec.mesh.metadata = { locationObject: rec };
            World3D.addObject(this.view, rec.mesh, def.kind);
            this.placeObject(rec);
            this.applyHidden(rec);
            rec.mesh.alwaysSelectAsActiveMesh = true;
            for (const child of rec.mesh.getChildMeshes(false)) {
                child.alwaysSelectAsActiveMesh = true;
                child.computeWorldMatrix(true);
                if (child.refreshBoundingInfo) child.refreshBoundingInfo({});
            }
            return rec;
        }).catch((e) => {
            rec.error = (e && e.message) || String(e);
            console.warn('Location3D: не загрузилась модель ' + def.model + ' — ' + rec.error);
            return rec;
        });
        return rec;
    }

    // Mesh — from the def fields: position on the ground + h; rot — [x, y, z] degrees (y — heading
    // on the map, like heading: rotation.y = −y; x, z — tilt); scale — [x, y, z]. An old
    // record with numbers (rot — heading only, scale — uniform) is also read.
    /** @param {LocationObject} rec */
    placeObject(rec) {
        const m = rec.mesh, d = rec.def;
        if (!m) return;
        const x = Number(d.x) || 0, y = Number(d.y) || 0, D = Math.PI / 180;
        const r = Array.isArray(d.rot) ? d.rot : [0, d.rot, 0];
        const s = Array.isArray(d.scale) ? d.scale : [d.scale, d.scale, d.scale];
        const k = (v) => (Number(v) > 0 ? Number(v) : 1);
        m.position.set(x, (this.terrain ? this.terrain.heightAt(x, y) : 0) + (Number(d.h) || 0), y);
        m.rotationQuaternion = null;   // a quaternion (the gizmo may set one) would override rotation
        m.rotation.set((Number(r[0]) || 0) * D, -(Number(r[1]) || 0) * D, (Number(r[2]) || 0) * D);
        m.scaling.set(k(s[0]), k(s[1]), k(s[2]));
        m.computeWorldMatrix(true);
        for (const child of m.getChildMeshes(false)) {
            child.computeWorldMatrix(true);
            if (child.refreshBoundingInfo) child.refreshBoundingInfo({});
        }
    }

    placeObjects() {
        for (const rec of this.objects) this.placeObject(rec);
    }

    // --- Tags and hidden objects ----------------------------------------------------

    // Objects whose def.tag === tag, in list order: what the editor placed and game code picks
    // up as a group — findByTag('loot'), findByTag('extraction'). No tag or no match — an
    // empty array. Game code reads the record's def for its own state, never the mesh name.
    /** @param {string} tag @returns {LocationObject[]} */
    findByTag(tag) {
        return tag ? this.objects.filter(rec => rec.def.tag === tag) : [];
    }

    // def.hidden: the object exists in the scene data but is inert — disabled, children
    // included — until the game reveals it: setHidden(rec, false). Works before the model has
    // loaded too (applyHidden runs again when the mesh arrives). A tag is also accepted, so a
    // whole group is revealed at once: setHidden('loot', false).
    /** @param {LocationObject|string} objectOrTag @param {boolean} hidden */
    setHidden(objectOrTag, hidden) {
        const list = typeof objectOrTag === 'string' ? this.findByTag(objectOrTag)
            : (objectOrTag ? [objectOrTag] : []);
        for (const rec of list) {
            if (hidden) rec.def.hidden = true;
            else delete rec.def.hidden;
            this.applyHidden(rec);
        }
    }

    // Push def.hidden onto the mesh: setEnabled(false) also disables every child, and a
    // disabled mesh casts no shadow and is not drawn. opts.showHidden (the editor) keeps a
    // hidden object in the frame as a translucent ghost — otherwise there is nothing to click.
    // Hidden objects are SILENT: our engine has no object-owned loop or source to stop (audio
    // is ProceduralAudio.js + js/audio/*, driven by the game, not by a location record), so a
    // hidden object stays quiet only because nothing starts a sound from this record.
    /** @param {LocationObject} rec */
    applyHidden(rec) {
        if (!rec.mesh) return;
        const hidden = !!rec.def.hidden, ghost = hidden && !!this.opts.showHidden;
        rec.mesh.setEnabled(!hidden || ghost);
        for (const m of rec.mesh.getChildMeshes(false)) m.visibility = ghost ? Location3D.GHOST_ALPHA : 1;
    }

    // Object animation frame — before World3D.renderFrame().
    update(dt) {
        dt = Math.min(0.1, Math.max(0, dt || 0));
        for (const rec of this.objects) {
            this.spinPart(rec, dt);
            this.playClip(rec);
        }
    }

    // def.clip — the name of a looped animation clip of a glTF model ('idle'); none — the rest
    // pose. The location acts only when def.clip CHANGES (the editor), so game code is free to
    // drive the same model: Model3D.clips(rec.mesh).play('run').
    /** @param {LocationObject} rec */
    playClip(rec) {
        const want = rec.mesh ? String(rec.def.clip || '') : '';
        if (rec.clip === want && rec.clipRoot === rec.mesh) return;
        const clips = rec.mesh ? Model3D.clips(rec.mesh) : null;
        if (clips) {
            if (want && clips.has(want)) clips.play(want);
            else if (rec.clip) clips.stop();
        }
        rec.clip = want;
        rec.clipRoot = rec.mesh;
    }

    // def.anim = { part, axis, speed, dir }: a model part (an FBX object) spins around its
    // center (origin from Blender) about its own axis, axis — 'x' | 'y' | 'z', with a minus — the
    // opposite end; speed — rpm; dir — 'cw' | 'ccw', clockwise/counterclockwise when viewed from
    // the axis end. Animation removed or part changed — the previous part returns to its place.
    /** @param {LocationObject} rec @param {number} dt */
    spinPart(rec, dt) {
        const a = rec.def.anim;
        const name = a && rec.mesh ? String(a.part || '') : '';
        let s = rec.spin;
        if (s && (s.name !== name || s.root !== rec.mesh)) {
            if (s.mesh && !s.mesh.isDisposed()) {
                s.mesh.rotationQuaternion = null;
                s.mesh.setPivotPoint(BABYLON.Vector3.Zero());
            }
            s = rec.spin = null;
        }
        if (!name) return;
        if (!s) {
            const mesh = rec.mesh.getChildMeshes(true).find(m => m.metadata && m.metadata.part === name) || null;
            s = rec.spin = { name, root: rec.mesh, mesh, angle: 0, axis: new BABYLON.Vector3(), q: new BABYLON.Quaternion() };
            if (mesh) mesh.setPivotPoint(BABYLON.Vector3.FromArray(mesh.metadata.pivot));
        }
        if (!s.mesh) return;
        const axis = String(a.axis || 'y'), dirs = s.mesh.metadata.axes;
        const v = dirs[axis.slice(-1)] || dirs.y, sign = axis[0] === '-' ? -1 : 1;
        s.axis.set(v[0] * sign, v[1] * sign, v[2] * sign);
        // The scene is right-handed: a positive angle is counterclockwise from the axis end.
        const turn = Math.max(0, Number(a.speed) || 0) * Math.PI / 30 * (a.dir === 'ccw' ? 1 : -1);
        s.angle = (s.angle + turn * dt) % (2 * Math.PI);
        BABYLON.Quaternion.RotationAxisToRef(s.axis, s.angle, s.q);
        s.mesh.rotationQuaternion = s.q;
    }

    /** @param {LocationObject} rec */
    removeObject(rec) {
        const i = this.objects.indexOf(rec);
        if (i >= 0) this.objects.splice(i, 1);
        if (rec.mesh && this.view) Model3D.dispose(this.view, rec.mesh);
        rec.mesh = null;
    }

    // Ground texture by LOCATION_GROUND. Paths — as LITERALS in GROUNDS: the builder's
    // asset scanner (tools/asset-scan.mjs) finds assets only that way. No file —
    // the ground stays a flat color, the scene doesn't crash.
    loadGround() {
        const list = Location3D.GROUNDS;
        const n = (typeof LOCATION_GROUND !== 'undefined') ? LOCATION_GROUND : 0;
        const idx = Math.max(0, Math.min(list.length - 1, Math.round(n) || 0));
        if (idx === this._groundIndex && this._groundImage) return Promise.resolve(this._groundImage);
        this._groundIndex = idx;
        const url = (this.opts.assetBase || '') + list[idx];
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                if (this._groundIndex === idx) {
                    this._groundImage = img;
                    if (this.terrain) this.terrain.setGroundImage(img);
                }
                resolve(img);
            };
            img.onerror = () => {
                console.warn('Location3D: не загрузилась текстура земли ' + url);
                resolve(null);
            };
            img.src = url;
        });
    }

    applyRenderConstants() {
        World3D.applyRenderConstants(this.view);
    }

    dispose() {
        this.objects = [];   // meshes and materials die with the scene
        if (this.terrain) this.terrain.dispose();
        this.terrain = null;
        if (this.view) this.view.dispose();
        this.view = null;
    }
}

// A hidden object shown to the designer as a ghost — opts.showHidden (the editor).
Location3D.GHOST_ALPHA = 0.35;

// Ground textures by LOCATION_GROUND: 0 — grass, 1 — sand, 2 — snow.
Location3D.GROUNDS = [
    'assets/ground_texture_g.jpg',
    'assets/ground_texture_d.jpg',
    'assets/ground_texture_s.jpg'
];
