// lab.js — the location view in the editor: the same world as at game startup
// (Location3D with the Objects.js objects + CameraController), the Objects tab
// (ObjectsPanel: selection, gizmo) and live application of the inspector constants
// (the constants-changed event from main.js).
//
// Cameras: "free" — editor navigation (LMB/RMB — orbit, middle button and
// Shift+LMB — pan, wheel — zoom to cursor, the game limits are lifted);
// "game" — exactly the game camera: the same limits and controls, start on R.
//
// The frame is drawn EVERY tick: the engine is created with preserveDrawingBuffer: false, and
// on a skipped frame Babylon shows not the previous picture but garbage from the buffer.
// In a background tab the browser stops requestAnimationFrame by itself.

/** @satisfies {Record<string, any>} */
const Lab = {
    /** @type {Location3D | null} */
    location: null,
    /** @type {CameraController | null} */
    camera: null,
    /** @type {HTMLCanvasElement | null} */
    canvas: null,
    mode: 'free',
    _terrainQueued: false,
    _lastT: 0,
    _infoT: 0,
    _fps: 60,

    init() {
        this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view-canvas'));
        if (!World3D.init(this.canvas)) {
            Toast.show(I18N.t('toast.no3d'), true);
            return;
        }
        this.location = new Location3D({ assetBase: '/', showHidden: true, objects: ObjectsPanel.initialObjects() });
        this.camera = new CameraController(this.location.view, {
            terrain: this.location.terrain,
            bounds: { w: this.location.width, h: this.location.height },
            free: true
        });
        this.camera.attach(this.canvas);
        new ResizeObserver(() => World3D.resize()).observe(this.canvas.parentElement);
        World3D.resize();

        this.bindUi();
        ObjectsPanel.init(this);
        UIPanel.init(this.canvas);
        SoundPanel.init();
        this.setCameraMode('free');
        this.camera.home();
        window.addEventListener('constants-changed', (e) => {
            const d = /** @type {CustomEvent} */ (e).detail;
            this.onConstant((d && d.name) || '');
        });
        window.addEventListener('lang-changed', () => { this.renderHint(); this.updateInfo(); });
        requestAnimationFrame(t => this.tick(t));
    },

    bindUi() {
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#camera-modes button'))) {
            btn.addEventListener('click', () => this.setCameraMode(btn.dataset.camera));
        }
        document.getElementById('btn-home').addEventListener('click', () => this.camera.home());
        // The quick toon toggle — the same WORLD3D_TOON constant as in the inspector.
        document.getElementById('opt-toon').addEventListener('change', (e) => {
            Inspector.apply(Inspector.fieldByName.WORLD3D_TOON, /** @type {HTMLInputElement} */ (e.target).checked ? 1 : 0);
        });
        this.syncToonToggle();
        // The camera speed slider over the bottom right of the view — the same
        // CAMERA_FLY_SPEED constant as in the inspector, where the flight is felt.
        const speed = /** @type {HTMLInputElement} */ (document.getElementById('cam-speed'));
        const field = Inspector.fieldByName.CAMERA_FLY_SPEED;
        if (field) {
            speed.min = String(field.min); speed.max = String(field.max); speed.step = String(field.step);
            speed.addEventListener('input', () => Inspector.apply(field, Number(speed.value)));
        }
        this.syncSpeedSlider();
        // Sound is OFF by default (the checkbox starts unchecked): the editor is a tool, and an
        // object droning on while you work in it is a nuisance. Turning it on also shows the
        // falloff spheres of the selected object (ObjectsPanel.syncSpheres).
        const sound = /** @type {HTMLInputElement} */ (document.getElementById('opt-sound'));
        sound.addEventListener('change', () => Sound3D.setMuted(!sound.checked));
        Sound3D.setMuted(!sound.checked);
        // Camera keys do not work while the focus is in an inspector field: a click on the view removes it.
        this.canvas.addEventListener('pointerdown', () => {
            const focused = /** @type {HTMLElement | null} */ (document.activeElement);
            if (focused && focused !== document.body) focused.blur();
        });
    },

    setCameraMode(mode) {
        this.mode = mode === 'game' ? 'game' : 'free';
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#camera-modes button'))) {
            btn.classList.toggle('active', btn.dataset.camera === this.mode);
        }
        this.camera.setFree(this.mode === 'free');
        if (this.mode === 'game') this.camera.home();   // exactly the game's starting frame
        this.renderHint();
    },

    renderHint() {
        document.getElementById('view-hints').textContent = I18N.t(this.mode === 'game' ? 'cam.hintGame' : 'cam.hintFree');
    },

    syncToonToggle() {
        /** @type {HTMLInputElement} */ (document.getElementById('opt-toon')).checked = Number(/** @type {any} */ (window).WORLD3D_TOON) > 0;
    },

    // The slider follows the constant: it is edited from the view, from the inspector field
    // and by undo (Ctrl+Z) — all of them arrive as constants-changed.
    syncSpeedSlider() {
        const v = Number(/** @type {any} */ (window).CAMERA_FLY_SPEED);
        if (!Number.isFinite(v)) return;
        /** @type {HTMLInputElement} */ (document.getElementById('cam-speed')).value = String(v);
        document.getElementById('cam-speed-value').textContent = String(Math.round(v));
    },

    onConstant(name) {
        if (!this.location) return;
        if (name.indexOf('WORLD3D_') === 0) {
            this.location.applyRenderConstants();
            if (name === 'WORLD3D_TOON') this.syncToonToggle();
            return;
        }
        if (name.indexOf('CAMERA_') === 0) {
            this.camera.applyConstants();
            if (name === 'CAMERA_FLY_SPEED') this.syncSpeedSlider();
            // Orientation and the starting zoom live in home(): the game view shows them right away.
            if (this.mode === 'game' && /^CAMERA_(AZIMUTH_DEG|PITCH_DEG|ZOOM|ZOOM_MOBILE)$/.test(name)) this.camera.home();
            return;
        }
        if (name.indexOf('UI_') === 0) { UIPanel.refresh(); return; }
        if (name.indexOf('AUDIO_') === 0) { Sound3D.applyConstants(); return; }
        if (name === 'LOCATION_GROUND') { this.location.loadGround(); return; }
        if (name === 'GROUND_TILE_SIZE') { if (this.location.terrain) this.location.terrain.applyTileSize(); return; }
        if (name.indexOf('TERRAIN_') === 0 || name.indexOf('LOCATION_') === 0) this.rebuildTerrainSoon();
    },

    // The slider sends an edit on every movement — the terrain is rebuilt at most once per frame.
    rebuildTerrainSoon() {
        if (this._terrainQueued) return;
        this._terrainQueued = true;
        requestAnimationFrame(() => {
            this._terrainQueued = false;
            const terrain = this.location.buildTerrain();   // location objects settle onto the new ground on their own
            this.camera.setTerrain(terrain, { w: this.location.width, h: this.location.height });
        });
    },

    tick(now) {
        const dt = Math.min(0.1, (now - (this._lastT || now)) / 1000);
        this._lastT = now;
        this.location.update(dt);   // model part spin (def.anim) — as in the game
        this.camera.update(dt);
        ObjectsPanel.syncSpheres();    // the sound spheres follow the selected object
        Sound3D.update(this.camera);   // object sounds (def.sound) — as in the game
        World3D.renderFrame();
        if (dt > 0) this._fps += (1 / dt - this._fps) * 0.05;
        if (now - this._infoT > 500) { this._infoT = now; this.updateInfo(); }
        requestAnimationFrame(t => this.tick(t));
    },

    updateInfo() {
        if (!this.camera) return;
        const c = this.camera, t = this.location.terrain, D = 180 / Math.PI;
        const txt = I18N.t('info', {
            fps: Math.round(this._fps), zoom: c.zoom.toFixed(2),
            az: Math.round(c.azimuth * D), pitch: Math.round(c.pitch * D),
            x: Math.round(c.target.x), y: Math.round(c.target.y)
        }) + (t ? I18N.t('info.terrain', { tris: Math.round(t.triangles / 1000), cell: t.cell }) : '');
        const el = document.getElementById('view-info');
        if (el.textContent !== txt) el.textContent = txt;
    },
};
