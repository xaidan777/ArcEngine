// Location3D.js — the location: a 3D view (light, sky, fog, shadows), ground (Terrain3D)
// of size LOCATION_WIDTH × LOCATION_HEIGHT with the LOCATION_GROUND texture, and
// objects — models from Objects.js (LOCATION_OBJECTS), placed by the editor.
// Shared by the game (main.js) and the editor (_utils/editor/lab.js): both call
// update(dt) every frame — part spin (def.anim), the looped clip (def.clip) and the sound
// (def.sound) of the models. Game code finds what the editor placed by name or by tag
// (findByTag) and shows hidden objects with setHidden. The game creates its own
// objects in location.view.scene and registers them with World3D.addObject(location.view,
// mesh, 'actor' | 'prop'); put them on the ground via location.terrain.heightAt(x, y).

class Location3D {
    // opts: { assetBase?: '' — game (paths from index.html) | '/' — editor (from the server root),
    //         objects?: LOCATION_OBJECTS records }
    constructor(opts) {
        this.opts = opts || {};
        this.view = World3D.createView({});
        this.terrain = null;
        /** @type {LocationObject[]} */
        this.objects = [];   // { def, mesh, error, loaded } — see addObject
        this._groundImage = null;
        this._groundIndex = -1;
        this.buildTerrain();
        const models = (this.opts.objects || []).map(def => this.addObject(def).loaded);
        // Ready — the ground texture and object models have arrived (or were not found) and the scene shaders are built.
        this.ready = Promise.all([this.loadGround()].concat(models))
            .then(() => new Promise(resolve => this.view.scene.executeWhenReady(() => resolve(undefined))));
    }

    get width() { return Math.max(64, (typeof LOCATION_WIDTH !== 'undefined') ? LOCATION_WIDTH : 2048); }
    get height() { return Math.max(64, (typeof LOCATION_HEIGHT !== 'undefined') ? LOCATION_HEIGHT : 2048); }

    // (Re)build the ground from the location size and TERRAIN_* (editor — live).
    // Location objects settle onto the new ground; the game's own objects are the owner's concern.
    buildTerrain() {
        if (this.terrain) this.terrain.dispose();
        this.terrain = new Terrain3D(this.view, {
            worldW: this.width,
            worldH: this.height,
            groundImage: this._groundImage
        });
        this.placeObjects();
        return this.terrain;
    }

    // --- Location objects -----------------------------------------------------------

    // LOCATION_OBJECTS record -> object: { def, mesh, error, loaded }. The record
    // is returned immediately; the mesh appears once the model finishes loading (loaded —
    // a promise). No file — an object without a mesh (error), the scene doesn't crash.
    // def: { name, model, kind, x, y, h, rot, scale, anim?, clip?, tag?, hidden?, sound? } — the
    // fields are live: edit + placeObject; anim, clip and sound are read every frame (spinPart,
    // playClip, updateSound); hidden — through setHidden.
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
    }

    placeObjects() {
        for (const rec of this.objects) this.placeObject(rec);
    }

    // Objects with def.tag === tag, in list order: what the editor placed and game code picks
    // up as a group — findByTag('coin'). None — an empty array.
    /** @param {string} tag @returns {LocationObject[]} */
    findByTag(tag) {
        return tag ? this.objects.filter(rec => rec.def.tag === tag) : [];
    }

    // def.hidden: the object is placed but not in the scene — no mesh in the frame, no sound —
    // until the game shows it: setHidden(rec, false). Works before the model has loaded too.
    /** @param {LocationObject} rec @param {boolean} hidden */
    setHidden(rec, hidden) {
        if (hidden) rec.def.hidden = true;
        else delete rec.def.hidden;
        this.applyHidden(rec);
    }

    // opts.showHidden (the editor): a hidden object stays in the frame as a ghost — otherwise
    // there is nothing to click and drag.
    /** @param {LocationObject} rec */
    applyHidden(rec) {
        if (!rec.mesh) return;
        const hidden = !!rec.def.hidden, ghost = hidden && !!this.opts.showHidden;
        rec.mesh.setEnabled(!hidden || ghost);
        for (const m of rec.mesh.getChildMeshes()) m.visibility = ghost ? Location3D.GHOST_ALPHA : 1;
    }

    // Object animation frame — before World3D.renderFrame().
    update(dt) {
        dt = Math.min(0.1, Math.max(0, dt || 0));
        for (const rec of this.objects) {
            this.spinPart(rec, dt);
            this.playClip(rec);
            this.updateSound(rec);
        }
    }

    // def.sound = { src, volume?, loop?, falloffMin?, falloffMax? }: a sound standing at the object
    // (Sound3D, follows def.x, def.y), looped unless loop is false. Restarted when the file or
    // loop changes, volume and distances apply on the fly (the editor); a hidden object is silent.
    /** @param {LocationObject} rec */
    updateSound(rec) {
        const s = rec.def.sound, on = !!(s && s.src) && !rec.def.hidden;
        const key = on ? s.src + (s.loop === false ? '|once' : '|loop') : '';
        if (key !== (rec.soundKey || '')) {
            if (rec.sound) rec.sound.stop();
            rec.sound = on ? Sound3D.play((this.opts.assetBase || '') + s.src, { at: rec.def, node: rec.mesh,
                loop: s.loop !== false, volume: s.volume, falloffMin: s.falloffMin, falloffMax: s.falloffMax }) : null;
            rec.soundKey = key;
        } else if (rec.sound && rec.sound.playing) {
            rec.sound.setVolume(s.volume == null ? 1 : s.volume);
            rec.sound.falloffMin = Number(s.falloffMin) > 0 ? Number(s.falloffMin) : 0;
            rec.sound.falloffMax = Number(s.falloffMax) > 0 ? Number(s.falloffMax) : 0;
            rec.sound.node = rec.mesh;   // the model may have arrived after the sound started
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
        if (rec.sound) rec.sound.stop();
        rec.sound = null;
        rec.soundKey = '';
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
        for (const rec of this.objects) if (rec.sound) rec.sound.stop();
        this.objects = [];   // meshes and materials die with the scene
        if (this.terrain) this.terrain.dispose();
        this.terrain = null;
        if (this.view) this.view.dispose();
        this.view = null;
    }
}

Location3D.GHOST_ALPHA = 0.35;   // a hidden object in the editor (opts.showHidden)

// Ground textures by LOCATION_GROUND: 0 — grass, 1 — sand, 2 — snow.
Location3D.GROUNDS = [
    'assets/ground_texture_g.jpg',
    'assets/ground_texture_d.jpg',
    'assets/ground_texture_s.jpg'
];
