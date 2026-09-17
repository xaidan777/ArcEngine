// lab.js — вид локации в редакторе: тот же мир, что при запуске игры
// (Location3D с объектами Objects.js + CameraController), вкладка Objects
// (ObjectsPanel: выбор, гизмо) и живое применение констант инспектора
// (событие constants-changed из main.js).
//
// Камеры: «свободная» — навигация редактора (ЛКМ/ПКМ — орбита, средняя и
// Shift+ЛКМ — панорама, колесо — зум к курсору, пределы игры сняты);
// «игровая» — ровно камера игры: те же пределы и управление, старт по R.
//
// Кадр рисуется КАЖДЫЙ тик: движок поднят с preserveDrawingBuffer: false, и
// пропущенный кадр Babylon показывает не прошлую картинку, а мусор из буфера.
// В фоновой вкладке браузер сам останавливает requestAnimationFrame.

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
        this.location = new Location3D({ assetBase: '/', objects: ObjectsPanel.initialObjects() });
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
        // Быстрый переключатель toon — та же константа WORLD3D_TOON, что в инспекторе.
        document.getElementById('opt-toon').addEventListener('change', (e) => {
            Inspector.apply(Inspector.fieldByName.WORLD3D_TOON, /** @type {HTMLInputElement} */ (e.target).checked ? 1 : 0);
        });
        this.syncToonToggle();
        // Клавиши камеры не работают, пока фокус в поле инспектора: клик по виду его снимает.
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
        if (this.mode === 'game') this.camera.home();   // ровно стартовый кадр игры
        this.renderHint();
    },

    renderHint() {
        document.getElementById('view-hints').textContent = I18N.t(this.mode === 'game' ? 'cam.hintGame' : 'cam.hintFree');
    },

    syncToonToggle() {
        /** @type {HTMLInputElement} */ (document.getElementById('opt-toon')).checked = Number(/** @type {any} */ (window).WORLD3D_TOON) > 0;
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
            // Ориентация и стартовый зум живут в home(): игровой вид показывает их сразу.
            if (this.mode === 'game' && /^CAMERA_(AZIMUTH_DEG|PITCH_DEG|ZOOM|ZOOM_MOBILE)$/.test(name)) this.camera.home();
            return;
        }
        if (name === 'LOCATION_GROUND') { this.location.loadGround(); return; }
        if (name === 'GROUND_TILE_SIZE') { if (this.location.terrain) this.location.terrain.applyTileSize(); return; }
        if (name.indexOf('TERRAIN_') === 0 || name.indexOf('LOCATION_') === 0) this.rebuildTerrainSoon();
    },

    // Слайдер шлёт правку на каждое движение — рельеф пересобирается не чаще кадра.
    rebuildTerrainSoon() {
        if (this._terrainQueued) return;
        this._terrainQueued = true;
        requestAnimationFrame(() => {
            this._terrainQueued = false;
            const terrain = this.location.buildTerrain();   // объекты локации встают на новую землю сами
            this.camera.setTerrain(terrain, { w: this.location.width, h: this.location.height });
        });
    },

    tick(now) {
        const dt = Math.min(0.1, (now - (this._lastT || now)) / 1000);
        this._lastT = now;
        this.location.update(dt);   // вращение частей моделей (def.anim) — как в игре
        this.camera.update(dt);
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
