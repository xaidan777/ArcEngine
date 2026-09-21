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
    /** @type {any} */
    graphics: null,
    mode: 'free',
    _terrainQueued: false,
    _lastT: 0,
    _infoT: 0,
    _fps: 60,

    init() {
        if (typeof ArcJobSystem !== 'undefined') {
            ArcJobSystem.init({ workerUrl: '/js/engine/workers/ArcJobWorker.js' });
        }
        this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view-canvas'));
        if (!World3D.init(this.canvas)) {
            Toast.show(I18N.t('toast.no3d'), true);
            return;
        }
        this.location = new Location3D({ assetBase: '/', objects: [], isEditor: true });
        this.camera = new CameraController(this.location.view, {
            terrain: this.location.terrain,
            bounds: { w: this.location.width, h: this.location.height },
            free: true
        });
        this.camera.attach(this.canvas);
        this.graphics = new ArcPostProcess(this.location.view.scene, this.location.view.camera, {
            toneMappingEnabled: false,
            vignetteEnabled: false
        });
        new ResizeObserver(() => World3D.resize()).observe(this.canvas.parentElement);
        World3D.resize();

        this.bindUi();
        ObjectsPanel.init(this);
        UIPanel.init(this.canvas);
        if (typeof MaterialEditor !== 'undefined') MaterialEditor.init(this.location.view.scene, this.location.terrain);
        if (this.location && this.location.ready) {
            this.location.ready.then(() => {
                if (typeof MaterialEditor !== 'undefined' && !this.location.opts.level) MaterialEditor.init(this.location.view.scene, this.location.terrain);
            });
        }
        if (typeof RaidLayer !== 'undefined') RaidLayer.init(this.location.view.scene, this.location.terrain, this.location.view, this.location);
        if (typeof RigVisualizer !== 'undefined') RigVisualizer.init(this.location.view.scene);
        if (typeof DockManager !== 'undefined') DockManager.init();
        if (typeof WorkspaceManager !== 'undefined') WorkspaceManager.init();
        if (typeof AssetBrowser !== 'undefined') AssetBrowser.init();
        if (typeof LightManager !== 'undefined') LightManager.init(this.location.view.scene);
        if (typeof LightingPanel !== 'undefined') LightingPanel.init();
        this.setCameraMode('free');
        if (this.location && this.location.view) {
            this.location.view.camera.maxZ = 150000;
            this.location.view.scene.fogEnabled = false;
            this.location.view.scene.skipFrustumClipping = true;
        }
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

        // Level tools
        const addEnemyBtn = document.getElementById('btn-add-enemy');
        if (addEnemyBtn) {
            addEnemyBtn.addEventListener('click', () => {
                const p = this.cameraTargetGround();
                if (typeof RaidLayer !== 'undefined') RaidLayer.addEnemy(p.x, p.y);
            });
        }
        const addLootBtn = document.getElementById('btn-add-crate') || document.getElementById('btn-add-loot');
        if (addLootBtn) {
            addLootBtn.addEventListener('click', () => {
                const p = this.cameraTargetGround();
                if (typeof RaidLayer !== 'undefined') RaidLayer.addContainer(p.x, p.y);
            });
        }
        const addPtTop = document.getElementById('btn-add-point-light-top');
        if (addPtTop) {
            addPtTop.addEventListener('click', () => {
                const p = this.cameraTargetGround();
                const h = (this.location?.terrain?.heightAt) ? this.location.terrain.heightAt(p.x, p.y) : 0;
                if (typeof LightManager !== 'undefined') {
                    const def = LightManager.createLight('point', p.x, p.y, h + 80);
                    LightManager.select(def.id);
                    if (typeof PaneTabs !== 'undefined') PaneTabs.show('lighting');
                }
            });
        }
        const addSpotTop = document.getElementById('btn-add-spot-light-top');
        if (addSpotTop) {
            addSpotTop.addEventListener('click', () => {
                const p = this.cameraTargetGround();
                const h = (this.location?.terrain?.heightAt) ? this.location.terrain.heightAt(p.x, p.y) : 0;
                if (typeof LightManager !== 'undefined') {
                    const def = LightManager.createLight('spot', p.x, p.y, h + 120, {
                        direction: [0, -1, 0.2]
                    });
                    LightManager.select(def.id);
                    if (typeof PaneTabs !== 'undefined') PaneTabs.show('lighting');
                }
            });
        }
        const saveLevelBtn = document.getElementById('btn-save-level');
        if (saveLevelBtn) {
            saveLevelBtn.addEventListener('click', () => {
                if (typeof RaidLayer !== 'undefined') RaidLayer.saveLevel();
            });
        }
        const toggleMarkersBtn = document.getElementById('btn-toggle-markers');
        if (toggleMarkersBtn) {
            toggleMarkersBtn.addEventListener('click', () => {
                if (typeof RaidLayer !== 'undefined') {
                    RaidLayer.setVisible(!RaidLayer.visible);
                    toggleMarkersBtn.classList.toggle('active', RaidLayer.visible);
                    toggleMarkersBtn.textContent = RaidLayer.visible ? '👁️ Markers' : '🕶️ Markers (off)';
                }
            });
        }
        const toggleGridBtn = document.getElementById('btn-toggle-grid');
        if (toggleGridBtn) {
            toggleGridBtn.addEventListener('click', () => {
                if (typeof SceneView !== 'undefined') SceneView.setGridVisible(!SceneView.gridVisible);
            });
        }
        const playGameBtn = document.getElementById('btn-play-game');
        if (playGameBtn) {
            playGameBtn.addEventListener('click', async () => {
                await MapEditor.run(() => MapEditor.play());
            });
        }

        // Rig tools
        const extrudeBtn = document.getElementById('btn-extrude-joint');
        if (extrudeBtn) {
            extrudeBtn.addEventListener('click', () => {
                if (typeof RigVisualizer !== 'undefined') RigVisualizer.extrudeBone();
            });
        }
        const saveRigTopBtn = document.getElementById('btn-save-rig-top');
        if (saveRigTopBtn) {
            saveRigTopBtn.addEventListener('click', () => {
                if (typeof RigVisualizer !== 'undefined') RigVisualizer.saveRigToServer();
            });
        }

        // Hotkeys
        window.addEventListener('keydown', (e) => {
            if (e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {HTMLElement} */ (e.target).tagName) || /** @type {HTMLElement} */ (e.target).isContentEditable)) return;
            if (e.code === 'KeyG' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (typeof SceneView !== 'undefined') SceneView.setGridVisible(!SceneView.gridVisible);
            }
        });

        // Workspace mode UI sync
        window.addEventListener('workspace-changed', (e) => {
            const m = /** @type {CustomEvent} */ (e).detail?.mode;
            const levelTools = document.getElementById('level-tools');
            const rigTools = document.getElementById('rig-tools');
            if (levelTools) levelTools.hidden = (m !== 'level');
            if (rigTools) rigTools.hidden = (m !== 'rig');
        });

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
        if (this.location && this.location.view) {
            const d = this.camera ? this.camera.distance() : 1000;
            this.location.view.camera.maxZ = Math.max(300000, d * 5);
            this.location.view.scene.fogEnabled = (this.mode === 'game');
            if (this.mode === 'free') {
                this.location.view.scene.fogMode = BABYLON.Scene.FOGMODE_NONE;
            } else {
                this.location.view.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
            }
            this.location.view.scene.skipFrustumClipping = true;
        }
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
            // Orientation and the starting zoom live in home(): the game view shows them right away.
            if (this.mode === 'game' && /^CAMERA_(AZIMUTH_DEG|PITCH_DEG|ZOOM|ZOOM_MOBILE)$/.test(name)) this.camera.home();
            return;
        }
        if (name.indexOf('UI_') === 0) { UIPanel.refresh(); return; }
        if (name === 'LOCATION_GROUND') {
            if (typeof MaterialEditor !== 'undefined') {
                const map = ['mud', 'asphalt', 'concrete', 'metal'];
                const n = (typeof LOCATION_GROUND !== 'undefined') ? LOCATION_GROUND : 0;
                MaterialEditor.applyPresetToTerrain(map[n] || 'mud');
                MaterialEditor.refreshAllHosts();
            } else {
                this.location.loadGround();
            }
            return;
        }
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
            if (typeof MaterialEditor !== 'undefined') MaterialEditor.init(this.location.view.scene, terrain);
        });
    },

    tick(now) {
        const dt = Math.min(0.1, (now - (this._lastT || now)) / 1000);
        this._lastT = now;
        this.location.update(dt);   // model part spin (def.anim) — as in the game
        this.camera.update(dt);
        if (this.location && this.location.view && this.location.view.scene) {
            if (this.mode === 'free') {
                this.location.view.scene.fogEnabled = false;
                this.location.view.scene.fogMode = BABYLON.Scene.FOGMODE_NONE;
            } else if (this.mode === 'game') {
                this.location.view.scene.fogEnabled = true;
                this.location.view.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
                const zoomFactor = Math.min(1, Math.max(0, (this.camera.zoom - 0.08) / 0.25));
                const baseFog = (typeof WORLD3D_FOG_DENSITY !== 'undefined' ? WORLD3D_FOG_DENSITY : 0.00032);
                this.location.view.scene.fogDensity = baseFog * zoomFactor;
            }
            if (this.location.view.camera) {
                const d = this.camera ? this.camera.distance() : 1000;
                if (this.location.view.camera.maxZ < d * 5) {
                    this.location.view.camera.maxZ = Math.max(300000, d * 5);
                }
            }
        }
        if (typeof LightingPanel !== 'undefined') LightingPanel.tick(dt);
        World3D.renderFrame();
        if (dt > 0) this._fps += (1 / dt - this._fps) * 0.05;
        if (now - this._infoT > 500) { this._infoT = now; this.updateInfo(); }
        requestAnimationFrame(t => this.tick(t));
    },

    cameraTargetGround() {
        if (this.camera && this.camera.target) {
            const tx = this.camera.target.x || 0;
            const ty = this.camera.target.y || 0;
            let th = this.camera.target.h;
            if (th == null || isNaN(th)) {
                const terrain = this.location ? this.location.terrain : null;
                th = (terrain && typeof terrain.heightAt === 'function') ? (terrain.heightAt(tx, ty) || 0) : 0;
            }
            return { x: tx, y: ty, h: th };
        }
        return { x: 500, y: 500, h: 0 };
    },

    updateInfo() {
        if (!this.camera) return;
        const c = this.camera, t = this.location ? this.location.terrain : null, D = 180 / Math.PI;
        const targetX = (c.target && c.target.x != null) ? Math.round(c.target.x) : 0;
        const targetY = (c.target && c.target.y != null) ? Math.round(c.target.y) : 0;
        let cullingStr = '';
        if (this.location && this.location.view && this.location.view.scene) {
            const sc = this.location.view.scene;
            const meshes = sc.meshes;
            let total = 0, visible = 0;
            for (let i = 0; i < meshes.length; i++) {
                const m = meshes[i];
                if (m.isEnabled() && m.isVisible) {
                    total++;
                    if (sc.skipFrustumClipping || m.alwaysSelectAsActiveMesh || (sc._activeMeshes && sc._activeMeshes.indexOf(m) >= 0)) {
                        visible++;
                    }
                }
            }
            const culled = total - visible;
            cullingStr = ` · culling: ${sc.skipFrustumClipping ? 'off' : 'on'} (${visible}/${total} visible, ${culled} culled)`;
        }
        let workerStr = '';
        if (typeof ArcJobSystem !== 'undefined') {
            const tele = ArcJobSystem.getTelemetry();
            workerStr = ` · ${tele.summary}`;
        }
        const txt = I18N.t('info', {
            fps: Math.round(this._fps), zoom: c.zoom.toFixed(2),
            az: Math.round(c.azimuth * D), pitch: Math.round(c.pitch * D),
            x: targetX, y: targetY
        }) + (t ? I18N.t('info.terrain', { tris: Math.round(t.triangles / 1000), cell: t.cell }) : '') + cullingStr + workerStr;
        const el = document.getElementById('view-info');
        if (el && el.textContent !== txt) el.textContent = txt;
    },
};
