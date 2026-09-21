// raid-layer.js — the Level & Gameplay layer for ArcEngine Level Editor.
// Visualizes and allows interactive 3D placement/editing of:
// - Player Spawn
// - Enemy Spawns (with archetypes: Spotter, Stalker, Heavy, Screamer, etc.)
// - Loot Containers & Crates (with loot types: Scrap, Medkit, Ammo, Valuables)
// - Objective Drives & Bunker Hatch
// - Extraction Zone (volumetric cylinder & beacon)
//
// Direct bridge to RaidWorld.js and POST /api/save-level.

/** @satisfies {Record<string, any>} */
const RaidLayer = {
    visible: true,
    initialized: false,
    scene: null,
    terrain: null,
    
    // The working raid level data
    levelData: {
        name: 'default_raid',
        spawn: { x: 280, y: 1660, heading: 0 },
        extraction: { x: 3680, y: 520, radius: 130 },
        hatch: { x: 780, y: 1250, radius: 60 },
        enemies: [],
        containers: [],
        drives: [],
    },

    /** @type {Map<string, { entity: any, type: string, mesh: any, labelMesh?: any }>} */
    entityMeshes: new Map(),
    selectedEntityId: null,
    selectedRubbleMesh: null,
    /** @type {any[]} */
    districtMeshes: [],
    districtVisible: true,
    rubbleVisible: true,

    init(scene, terrain, view, location) {
        if (!scene) return;
        this.scene = scene;
        this.terrain = terrain;
        this.view = view;
        this.location = location;
        this.loadRaidData();
        this.buildDistrictGeometry();
        this.build3DMarkers();
        this.bindEvents();
        this.initialized = true;
    },

    loadRaidData() {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const stored = localStorage.getItem('arc_rubble_enabled');
                if (stored !== null) this.rubbleVisible = stored === 'true';
            }
        } catch (_) {}

        // Baseline defaults from RaidWorld if available, or fallback coordinates
        let world = null;
        if (typeof RaidWorld !== 'undefined' && typeof RaidWorld.build === 'function') {
            try {
                world = RaidWorld.build(0);
            } catch (err) {
                console.warn('RaidWorld.build failed:', err);
            }
        }

        const fallbackSpawn = { x: 280, y: 1660, heading: 0 };
        const fallbackExt = { x: 3680, y: 520, radius: 130 };
        const fallbackHatch = { x: 780, y: 1250, radius: 60 };

        const baseSpawn = (world && world.spawn) ? { x: world.spawn.x, y: world.spawn.y, heading: 0 } : fallbackSpawn;
        const baseExt = (world && world.extraction) ? { x: world.extraction.x, y: world.extraction.y, radius: world.extraction.radius || 130 } : fallbackExt;
        const baseHatch = (world && world.hatch) ? { x: world.hatch.x, y: world.hatch.y, radius: world.hatch.radius || 60 } : fallbackHatch;
        const baseEnemies = (world && Array.isArray(world.enemies))
            ? world.enemies.map(e => ({ id: 'enemy_' + e.id, archetype: e.archetype || 'stalker', x: e.x, y: e.y, dormant: !!e.dormant }))
            : [];
        const baseContainers = (world && Array.isArray(world.containers))
            ? world.containers.map(c => ({ id: 'crate_' + c.id, type: c.type || 'scrap', x: c.x, y: c.y, radius: c.radius || 48 }))
            : [];
        const baseDrives = (world && Array.isArray(world.drives))
            ? world.drives.map(d => ({ id: 'drive_' + d.id, x: d.x, y: d.y, radius: d.radius || 48 }))
            : [];

        // Check if custom level data exists on globalThis
        let custom = null;
        if (typeof RAID_CUSTOM_LEVEL !== 'undefined' && RAID_CUSTOM_LEVEL && typeof RAID_CUSTOM_LEVEL === 'object') {
            try {
                custom = JSON.parse(JSON.stringify(RAID_CUSTOM_LEVEL));
            } catch (_) {}
        }

        if (custom) {
            if (custom.rubble && custom.rubble.enabled !== undefined) {
                this.rubbleVisible = !!custom.rubble.enabled;
            }
            this.levelData = {
                ...custom,
                name: custom.name || 'default_raid',
                ground: custom.ground || null,
                rubble: custom.rubble || { enabled: this.rubbleVisible },
                spawn: (custom.spawn && custom.spawn.x !== undefined) ? { x: custom.spawn.x, y: custom.spawn.y, heading: custom.spawn.heading || 0 } : baseSpawn,
                extraction: (custom.extraction && custom.extraction.x !== undefined) ? { x: custom.extraction.x, y: custom.extraction.y, radius: custom.extraction.radius || baseExt.radius } : baseExt,
                hatch: (custom.hatch && custom.hatch.x !== undefined) ? { x: custom.hatch.x, y: custom.hatch.y, radius: custom.hatch.radius || baseHatch.radius } : baseHatch,
                enemies: (Array.isArray(custom.enemies)) ? custom.enemies : baseEnemies,
                containers: (Array.isArray(custom.containers)) ? custom.containers : baseContainers,
                drives: (Array.isArray(custom.drives)) ? custom.drives : baseDrives,
            };
        } else {
            this.levelData = {
                name: 'default_raid',
                spawn: baseSpawn,
                extraction: baseExt,
                hatch: baseHatch,
                enemies: baseEnemies,
                containers: baseContainers,
                drives: baseDrives,
                rubble: { enabled: this.rubbleVisible }
            };
        }
    },

    setRubbleVisible(vis) {
        this.rubbleVisible = !!vis;
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.setItem('arc_rubble_enabled', String(this.rubbleVisible));
            }
            if (this.levelData) {
                this.levelData.rubble = { enabled: this.rubbleVisible };
                this.levelData.environment ||= {}; this.levelData.environment.rubble = this.rubbleVisible;
            }
        } catch (_) {}
        if (this.env) {
            if (!this.rubbleVisible) {
                this.env.clearRubble();
            } else if (!this.env.rubbleMeshes || this.env.rubbleMeshes.length === 0) {
                this.env.skipRubble = false;
                this.env.flags.rubble = true;
                this.env.level.rubble = { enabled: true };
                const concrete = this.env.surface('district-concrete', 0xbcb9a8, 0, 0.92, RaidEnvironment.CONCRETE, 2);
                const rust = this.env.surface('district-oxidized-steel', 0x985e44, 0.32, 0.8, RaidEnvironment.RUST, 2);
                this.env.scatter(concrete, rust);
            }
        }
        const btn = document.getElementById('btn-toggle-rubble');
        if (btn) btn.classList.toggle('active', this.rubbleVisible);
        if (typeof Toast !== 'undefined') {
            Toast.show(this.rubbleVisible ? 'Камни включены / Rubble enabled' : 'Камни скрыты / Rubble disabled');
        }
    },

    setVisible(vis) {
        this.visible = !!vis;
        for (const [_, rec] of this.entityMeshes) {
            if (rec.mesh) rec.mesh.setEnabled(this.visible);
            if (rec.labelMesh) rec.labelMesh.setEnabled(this.visible);
        }
    },

    setDistrictVisible(vis) {
        this.districtVisible = !!vis;
        for (const m of this.districtMeshes) {
            if (m) m.setEnabled(this.districtVisible);
        }
        if (this.env && this.env.models) {
            for (const m of this.env.models) {
                if (m) m.setEnabled(this.districtVisible);
            }
        }
    },

    buildDistrictGeometry() {
        if (!this.scene || typeof BABYLON === 'undefined') return;
        if (this.env) this.env.dispose();
        for (const m of this.districtMeshes) {
            try { m.dispose(); } catch (_) {}
        }
        this.districtMeshes = [];

        // Build the complete authentic game environment
        if (typeof RaidEnvironment !== 'undefined') {
            const locView = this.view || (this.location && this.location.view) || { scene: this.scene, removeShadowCaster: () => {} };
            const mockGame = {
                scene: this.scene,
                app: { location: this.location || { view: locView, terrain: this.terrain } },
                blockers: [],
                coverBlockers: [],
                place: (mesh, x, y, lift) => {
                    mesh.position.set(x, this.terrain.heightAt(x, y) + (lift || 0), y);
                }
            };
            try {
                this.env = new RaidEnvironment(mockGame, { level: this.levelData, isEditor: true, skipProps: true, skipRubble: !this.rubbleVisible });
                this.env.build();
                this.env.loadAssets().then(() => {
                    if (this.env.models) {
                        for (const m of this.env.models) {
                            if (!this.districtMeshes.includes(m)) this.districtMeshes.push(m);
                        }
                    }
                    this._markDistrictMeshesActive();
                }).catch(err => console.warn('District assets loading deferred:', err));

                if (this.env.models) {
                    this.districtMeshes.push(...this.env.models);
                }
                const btnRubble = document.getElementById('btn-toggle-rubble');
                if (btnRubble) btnRubble.classList.toggle('active', this.rubbleVisible);
                this._markDistrictMeshesActive();
                return;
            } catch (err) {
                console.warn('RaidEnvironment build fallback:', err);
            }
        }

        // Shared district materials
        const concreteMat = new BABYLON.StandardMaterial('mat_district_concrete', this.scene);
        concreteMat.diffuseColor = new BABYLON.Color3(0.65, 0.63, 0.58);
        concreteMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

        const tankMat = new BABYLON.StandardMaterial('mat_district_tank', this.scene);
        tankMat.diffuseColor = new BABYLON.Color3(0.85, 0.84, 0.80);
        tankMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

        const steelMat = new BABYLON.StandardMaterial('mat_district_steel', this.scene);
        steelMat.diffuseColor = new BABYLON.Color3(0.3, 0.35, 0.38);

        const rustMat = new BABYLON.StandardMaterial('mat_district_rust', this.scene);
        rustMat.diffuseColor = new BABYLON.Color3(0.55, 0.32, 0.22);

        const paintMat = new BABYLON.StandardMaterial('mat_district_paint', this.scene);
        paintMat.diffuseColor = new BABYLON.Color3(0.7, 0.55, 0.25);

        // 1. Storage Tanks & Silos from RaidWorld.tanks()
        if (typeof RaidWorld !== 'undefined' && RaidWorld.tanks) {
            for (const t of RaidWorld.tanks()) {
                const base = this.heightAt(t.x, t.y);
                const r = t.radius;
                const h = t.height;

                // Foundation
                const fnd = BABYLON.MeshBuilder.CreateCylinder('tank_fnd_' + t.x, { diameter: r * 2.2, height: 26, tessellation: 28 }, this.scene);
                fnd.position.set(t.x, base + 13, t.y);
                fnd.material = concreteMat;
                fnd.isPickable = false;
                this.districtMeshes.push(fnd);

                // Main Tank Vessel
                const vessel = BABYLON.MeshBuilder.CreateCylinder('tank_vessel_' + t.x, { diameter: r * 2, height: h, tessellation: 28 }, this.scene);
                vessel.position.set(t.x, base + h / 2, t.y);
                vessel.material = tankMat;
                this.districtMeshes.push(vessel);

                // Dome
                const dome = BABYLON.MeshBuilder.CreateSphere('tank_dome_' + t.x, { diameter: r * 2, segments: 16 }, this.scene);
                dome.scaling.set(1, 0.25, 1);
                dome.position.set(t.x, base + h, t.y);
                dome.material = tankMat;
                this.districtMeshes.push(dome);

                // Paint ring / band
                const band = BABYLON.MeshBuilder.CreateCylinder('tank_band_' + t.x, { diameter: r * 2 + 4, height: 8, tessellation: 28 }, this.scene);
                band.position.set(t.x, base + h * 0.5, t.y);
                band.material = paintMat;
                this.districtMeshes.push(band);
            }
        }

        // 2. Low Cover Blocks from RaidWorld.cover()
        if (typeof RaidWorld !== 'undefined' && RaidWorld.cover) {
            for (const c of RaidWorld.cover()) {
                const base = this.heightAt(c.x, c.y);
                const coverMesh = BABYLON.MeshBuilder.CreateBox('cover_' + c.x, { width: c.radius * 2, height: c.height, depth: c.radius * 1.5 }, this.scene);
                coverMesh.position.set(c.x, base + c.height / 2, c.y);
                coverMesh.material = concreteMat;
                this.districtMeshes.push(coverMesh);
            }
        }

        // 3. District Props from RaidWorld.props() (Barriers, generators, barrels)
        if (typeof RaidWorld !== 'undefined' && RaidWorld.props) {
            for (const p of RaidWorld.props()) {
                const base = this.heightAt(p.x, p.y);
                if (p.radius <= 20) {
                    const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel_' + p.x, { diameter: p.radius * 2, height: p.height, tessellation: 16 }, this.scene);
                    barrel.position.set(p.x, base + p.height / 2, p.y);
                    barrel.material = rustMat;
                    this.districtMeshes.push(barrel);
                } else if (p.radius <= 32) {
                    const barrier = BABYLON.MeshBuilder.CreateBox('barrier_' + p.x, { width: p.radius * 2.2, height: p.height, depth: p.radius * 1.2 }, this.scene);
                    barrier.position.set(p.x, base + p.height / 2, p.y);
                    barrier.material = concreteMat;
                    this.districtMeshes.push(barrier);
                } else {
                    const gen = BABYLON.MeshBuilder.CreateBox('gen_' + p.x, { width: p.radius * 2, height: p.height, depth: p.radius * 1.8 }, this.scene);
                    gen.position.set(p.x, base + p.height / 2, p.y);
                    gen.material = steelMat;
                    this.districtMeshes.push(gen);
                }
            }
        }

        // 4. West Factory Structure
        const fy = this.heightAt(0, 1030);
        const westFactory = BABYLON.MeshBuilder.CreateBox('west_factory', { width: 250, height: 340, depth: 1220 }, this.scene);
        westFactory.position.set(-100, fy + 170, 1030);
        westFactory.material = concreteMat;
        this.districtMeshes.push(westFactory);

        const factoryPlinth = BABYLON.MeshBuilder.CreateBox('factory_plinth', { width: 18, height: 54, depth: 1220 }, this.scene);
        factoryPlinth.position.set(32, fy + 27, 1030);
        factoryPlinth.material = steelMat;
        this.districtMeshes.push(factoryPlinth);

        // 5. Modular Factory Facade model
        if (typeof Model3D !== 'undefined' && Model3D.load) {
            Model3D.load('assets/models/polyhaven/modular_factory_facade.glb', this.scene).then(model => {
                const root = Model3D.build(model, this.scene, { name: 'factory_facade_root' });
                if (root) {
                    root.scaling.setAll(0.5);
                    root.position.set(40, this.heightAt(40, 400), 400);
                    this.districtMeshes.push(root);
                    this._markDistrictMeshesActive();
                }
            }).catch(err => {
                console.warn('District factory facade GLB load deferred:', err);
            });
        }
        this._markDistrictMeshesActive();
    },

    _markDistrictMeshesActive() {
        for (const m of this.districtMeshes) {
            if (!m || m.isDisposed?.()) continue;
            m.alwaysSelectAsActiveMesh = true;
            for (const child of m.getChildMeshes?.(false) || []) {
                child.alwaysSelectAsActiveMesh = true;
            }
        }
    },

    heightAt(x, y) {
        if (this.terrain && this.terrain.heightAt) {
            return this.terrain.heightAt(x, y);
        }
        if (typeof RaidWorld !== 'undefined' && RaidWorld.heightAt) {
            return RaidWorld.heightAt(x, y);
        }
        return 0;
    },

    build3DMarkers() {
        if (!this.scene || typeof BABYLON === 'undefined') return;

        // Clear existing
        for (const [_, rec] of this.entityMeshes) {
            if (rec.mesh) rec.mesh.dispose();
        }
        this.entityMeshes.clear();

        if (!this.levelData) this.loadRaidData();
        if (!this.levelData) return;

        // 1. Player Spawn Marker
        if (this.levelData.spawn && this.levelData.spawn.x !== undefined) {
            this.createPlayerSpawnMarker();
        }

        // 2. Extraction Zone Marker
        if (this.levelData.extraction && this.levelData.extraction.x !== undefined) {
            this.createExtractionMarker();
        }

        // 3. Bunker Hatch Marker
        if (this.levelData.hatch && this.levelData.hatch.x !== undefined) {
            this.createHatchMarker();
        }

        // 4. Enemy Spawns
        for (const enemy of (this.levelData.enemies || [])) {
            if (enemy && enemy.x !== undefined) this.createEnemyMarker(enemy);
        }

        // 5. Loot Containers
        for (const crate of (this.levelData.containers || [])) {
            if (crate && crate.x !== undefined) this.createContainerMarker(crate);
        }

        // 6. Data Drives
        for (const drive of (this.levelData.drives || [])) {
            if (drive && drive.x !== undefined) this.createDriveMarker(drive);
        }

        for (const [_, rec] of this.entityMeshes) {
            if (rec.mesh) {
                rec.mesh.alwaysSelectAsActiveMesh = true;
                for (const child of rec.mesh.getChildMeshes?.(false) || []) {
                    child.alwaysSelectAsActiveMesh = true;
                }
            }
        }
    },

    createPlayerSpawnMarker() {
        const p = this.levelData && this.levelData.spawn;
        if (!p || p.x === undefined || p.y === undefined) return;
        const h = this.heightAt(p.x, p.y);

        const mesh = BABYLON.MeshBuilder.CreateCylinder('raid_player_spawn', { diameter: 36, height: 8, tessellation: 24 }, this.scene);
        mesh.position.set(p.x, h + 4, p.y);

        const arrow = BABYLON.MeshBuilder.CreateCylinder('raid_player_arrow', { diameterTop: 0, diameterBottom: 16, height: 28, tessellation: 3 }, this.scene);
        arrow.rotation.x = Math.PI / 2;
        arrow.position.set(0, 8, 14);
        arrow.parent = mesh;

        const mat = new BABYLON.StandardMaterial('mat_player_spawn', this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.1, 0.5, 1.0);
        mat.emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.8);
        mesh.material = mat;
        arrow.material = mat;

        mesh.metadata = { raidEntity: { id: 'player_spawn', type: 'spawn', entity: p } };
        this.entityMeshes.set('player_spawn', { entity: p, type: 'spawn', mesh });
    },

    createExtractionMarker() {
        const ext = this.levelData && this.levelData.extraction;
        if (!ext || ext.x === undefined || ext.y === undefined) return;
        const h = this.heightAt(ext.x, ext.y);
        const radius = ext.radius || 130;

        const mesh = BABYLON.MeshBuilder.CreateCylinder('raid_extraction', { diameter: radius * 2, height: 60, tessellation: 32 }, this.scene);
        mesh.position.set(ext.x, h + 30, ext.y);

        const mat = new BABYLON.StandardMaterial('mat_extraction', this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.2, 0.9, 0.4);
        mat.emissiveColor = new BABYLON.Color3(0.1, 0.6, 0.3);
        mat.alpha = 0.35;
        mesh.material = mat;

        // Beacon beam
        const beam = BABYLON.MeshBuilder.CreateCylinder('raid_ext_beam', { diameter: 12, height: 600, tessellation: 16 }, this.scene);
        beam.position.set(0, 300, 0);
        beam.parent = mesh;
        const beamMat = new BABYLON.StandardMaterial('mat_ext_beam', this.scene);
        beamMat.emissiveColor = new BABYLON.Color3(0.3, 1.0, 0.5);
        beamMat.alpha = 0.5;
        beam.material = beamMat;

        mesh.metadata = { raidEntity: { id: 'extraction', type: 'extraction', entity: ext } };
        this.entityMeshes.set('extraction', { entity: ext, type: 'extraction', mesh });
    },

    createHatchMarker() {
        const hatch = this.levelData && this.levelData.hatch;
        if (!hatch || hatch.x === undefined || hatch.y === undefined) return;
        const h = this.heightAt(hatch.x, hatch.y);
        const radius = hatch.radius || 60;

        const mesh = BABYLON.MeshBuilder.CreateTorus('raid_hatch', { diameter: radius * 2, thickness: 12, tessellation: 24 }, this.scene);
        mesh.position.set(hatch.x, h + 6, hatch.y);

        const mat = new BABYLON.StandardMaterial('mat_hatch', this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.8, 0.7, 0.2);
        mat.emissiveColor = new BABYLON.Color3(0.5, 0.4, 0.1);
        mesh.material = mat;

        mesh.metadata = { raidEntity: { id: 'hatch', type: 'hatch', entity: hatch } };
        this.entityMeshes.set('hatch', { entity: hatch, type: 'hatch', mesh });
    },

    createEnemyMarker(enemy) {
        if (!enemy || enemy.x === undefined || enemy.y === undefined) return;
        const h = this.heightAt(enemy.x, enemy.y);
        const mesh = BABYLON.MeshBuilder.CreatePolyhedron(enemy.id, { type: 1, size: 24 }, this.scene); // Octahedron
        mesh.position.set(enemy.x, h + 35, enemy.y);

        const mat = new BABYLON.StandardMaterial('mat_' + enemy.id, this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.9, 0.2, 0.2);
        mat.emissiveColor = new BABYLON.Color3(0.6, 0.1, 0.1);
        mesh.material = mat;

        // Ground anchor line
        const line = BABYLON.MeshBuilder.CreateLines('line_' + enemy.id, {
            points: [new BABYLON.Vector3(0, 0, 0), new BABYLON.Vector3(0, -35, 0)]
        }, this.scene);
        line.color = new BABYLON.Color3(0.9, 0.2, 0.2);
        line.parent = mesh;

        mesh.metadata = { raidEntity: { id: enemy.id, type: 'enemy', entity: enemy } };
        this.entityMeshes.set(enemy.id, { entity: enemy, type: 'enemy', mesh });
    },

    createContainerMarker(crate) {
        if (!crate || crate.x === undefined || crate.y === undefined) return;
        const h = this.heightAt(crate.x, crate.y);
        const mesh = BABYLON.MeshBuilder.CreateBox(crate.id, { width: 44, height: 36, depth: 32 }, this.scene);
        mesh.position.set(crate.x, h + 18, crate.y);

        const mat = new BABYLON.StandardMaterial('mat_' + crate.id, this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.9, 0.7, 0.1);
        mat.emissiveColor = new BABYLON.Color3(0.4, 0.3, 0.05);
        mesh.material = mat;

        mesh.metadata = { raidEntity: { id: crate.id, type: 'container', entity: crate } };
        this.entityMeshes.set(crate.id, { entity: crate, type: 'container', mesh });
    },

    createDriveMarker(drive) {
        if (!drive || drive.x === undefined || drive.y === undefined) return;
        const h = this.heightAt(drive.x, drive.y);
        const mesh = BABYLON.MeshBuilder.CreateCylinder(drive.id, { diameter: 22, height: 16, tessellation: 16 }, this.scene);
        mesh.position.set(drive.x, h + 10, drive.y);

        const mat = new BABYLON.StandardMaterial('mat_' + drive.id, this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.7, 0.2, 0.9);
        mat.emissiveColor = new BABYLON.Color3(0.4, 0.1, 0.6);
        mesh.material = mat;

        mesh.metadata = { raidEntity: { id: drive.id, type: 'drive', entity: drive } };
        this.entityMeshes.set(drive.id, { entity: drive, type: 'drive', mesh });
    },

    selectEntity(id, additive = false) {
        if (typeof MapEditor !== 'undefined') MapEditor.select(this.entityMeshes.get(id), additive);
        this.selectedEntityId = id;
        const rec = this.entityMeshes.get(id);
        if (!rec) return;

        // Ensure inspector pane is visible and on Objects tab
        const pane = document.getElementById('inspector-pane');
        if (pane) pane.hidden = false;
        if (typeof PaneTabs !== 'undefined') PaneTabs.show('objects');

        // Attach gizmo if available
        if (typeof SceneView !== 'undefined' && SceneView.gizmoManager) {
            SceneView.gizmoManager.attachToMesh(rec.mesh);
        } else if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.gizmo) {
            ObjectsPanel.gizmo.attachToMesh(rec.mesh);
        }

        // Render entity inspector
        this.renderEntityInspector(rec);
    },

    renderEntityInspector(rec) {
        const container = document.getElementById('object-props');
        if (!container) return;

        container.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'props-section';
        title.textContent = 'Raid Entity: ' + rec.type.toUpperCase();
        container.appendChild(title);

        const row = (label, el) => {
            const w = document.createElement('div');
            w.className = 'field';
            const h = document.createElement('div');
            h.className = 'field-head';
            h.innerHTML = `<label>${label}</label>`;
            w.appendChild(h);
            w.appendChild(el);
            return w;
        };

        const e = rec.entity;

        // Position coordinates
        const posControls = document.createElement('div');
        posControls.className = 'field-controls';
        posControls.innerHTML = `
            <span class="axis-label">X</span><input type="number" id="re-pos-x" value="${Math.round(e.x)}">
            <span class="axis-label">Y</span><input type="number" id="re-pos-y" value="${Math.round(e.y)}">
        `;
        const onPosChange = () => {
            e.x = Number(/** @type {HTMLInputElement} */ (posControls.querySelector('#re-pos-x')).value) || 0;
            e.y = Number(/** @type {HTMLInputElement} */ (posControls.querySelector('#re-pos-y')).value) || 0;
            const h = this.heightAt(e.x, e.y);
            rec.mesh.position.x = e.x;
            rec.mesh.position.z = e.y;
            rec.mesh.position.y = h + (rec.type === 'enemy' ? 35 : (rec.type === 'container' ? 18 : 6));
        };
        posControls.querySelector('#re-pos-x').addEventListener('change', onPosChange);
        posControls.querySelector('#re-pos-y').addEventListener('change', onPosChange);
        container.appendChild(row('Position (Map PX)', posControls));

        // Type specific controls
        if (rec.type === 'enemy') {
            const archSelect = document.createElement('select');
            const archetypes = ['spotter', 'stalker', 'cricket', 'pop', 'sentinel', 'screamer', 'bombard', 'heavy', 'guard', 'scout'];
            for (const a of archetypes) {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = a.toUpperCase();
                if (e.archetype === a) opt.selected = true;
                archSelect.appendChild(opt);
            }
            archSelect.addEventListener('change', () => { e.archetype = archSelect.value; });
            container.appendChild(row('Enemy Archetype', archSelect));

            const dormantCheck = document.createElement('label');
            dormantCheck.className = 'panel-check';
            dormantCheck.innerHTML = `<input type="checkbox" ${e.dormant ? 'checked' : ''}> Spawn Dormant (Wave only)`;
            dormantCheck.querySelector('input').addEventListener('change', (ev) => { e.dormant = /** @type {HTMLInputElement} */ (ev.target).checked; });
            container.appendChild(dormantCheck);
        } else if (rec.type === 'container') {
            const typeSelect = document.createElement('select');
            const lootTypes = ['scrap', 'medkit', 'ammo', 'valuables', 'drive'];
            for (const lt of lootTypes) {
                const opt = document.createElement('option');
                opt.value = lt;
                opt.textContent = lt.toUpperCase();
                if (e.type === lt) opt.selected = true;
                typeSelect.appendChild(opt);
            }
            typeSelect.addEventListener('change', () => { e.type = typeSelect.value; });
            container.appendChild(row('Loot Type', typeSelect));
        }

        // Delete button
        if (rec.type === 'enemy' || rec.type === 'container') {
            const delBtn = document.createElement('button');
            delBtn.className = 'panel-button danger';
            delBtn.textContent = 'Delete Entity';
            delBtn.style.marginTop = '14px';
            delBtn.addEventListener('click', () => MapEditor.removeSelection());
            container.appendChild(delBtn);
        }
    },

    deleteEntity(id) {
        const rec = this.entityMeshes.get(id);
        if (!rec) return;
        if (rec.mesh) rec.mesh.dispose();
        this.entityMeshes.delete(id);

        if (rec.type === 'enemy') {
            this.levelData.enemies = this.levelData.enemies.filter(e => e.id !== id);
        } else if (rec.type === 'container') {
            this.levelData.containers = this.levelData.containers.filter(c => c.id !== id);
        }
        if (rec.type === 'drive') this.levelData.drives = this.levelData.drives.filter(d => d.id !== id);
        if (['spawn', 'extraction', 'hatch'].includes(rec.type)) this.levelData[rec.type] = null;
        ObjectsPanel.gizmo?.attachToMesh(null);
        const props = document.getElementById('object-props');
        if (props) props.innerHTML = '<div class="objects-empty">Entity deleted</div>';
    },

    addEnemy(x, y, archetype = 'stalker') {
        return this.addEnemySpawn(x, y, archetype);
    },

    addEnemySpawn(x, y, archetype = 'stalker') {
        if (!this.levelData) this.loadRaidData();
        if (!this.levelData) this.levelData = {};
        if (!Array.isArray(this.levelData.enemies)) this.levelData.enemies = [];
        this.levelData.noEnemies = false;
        const noEnemiesCb = /** @type {HTMLInputElement} */ (document.getElementById('cb-no-enemies'));
        if (noEnemiesCb) noEnemiesCb.checked = false;
        const id = 'enemy_' + (this.levelData.enemies.length + 1) + '_' + Math.floor(Math.random() * 1000);
        const enemy = { id, archetype, x: x != null ? x : 1000, y: y != null ? y : 1000, dormant: false };
        this.levelData.enemies.push(enemy);
        this.createEnemyMarker(enemy);
        this.selectEntity(id);
        return enemy;
    },

    addContainer(x, y, type = 'scrap') {
        if (!this.levelData) this.loadRaidData();
        if (!this.levelData) this.levelData = {};
        if (!Array.isArray(this.levelData.containers)) this.levelData.containers = [];
        const id = 'crate_' + (this.levelData.containers.length + 1) + '_' + Math.floor(Math.random() * 1000);
        const crate = { id, type, x: x != null ? x : 1000, y: y != null ? y : 1000, radius: 48 };
        this.levelData.containers.push(crate);
        this.createContainerMarker(crate);
        this.selectEntity(id);
        return crate;
    },

    selectRubble(mesh, additive = false) {
        if (typeof MapEditor !== 'undefined') MapEditor.select(mesh, additive);
        this.selectedRubbleMesh = mesh;
        if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.gizmo) {
            ObjectsPanel.gizmo.attachToMesh(mesh);
        }
        const pane = document.getElementById('inspector-pane');
        if (pane) pane.hidden = false;
        if (typeof PaneTabs !== 'undefined') PaneTabs.show('objects');

        const container = document.getElementById('object-props');
        if (!container) return;
        const isRu = typeof I18N !== 'undefined' && I18N.lang === 'ru';
        container.innerHTML = `
            <div class="props-section">🪨 ${isRu ? 'Камень (Обломок породы)' : 'Rubble Stone'}</div>
            <div class="field" style="margin-top: 10px;">
                <label>${isRu ? 'Координаты на карте' : 'Map Coordinates'}: X=${Math.round(mesh.position.x)}, Z=${Math.round(mesh.position.z)}</label>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 16px;">
                <button type="button" id="btn-del-rubble" class="panel-button danger">${isRu ? 'Удалить этот камень (Delete)' : 'Delete This Stone (Delete)'}</button>
                <button type="button" id="btn-clear-all-rubble" class="panel-button">${isRu ? 'Убрать все камни с карты' : 'Remove All Rubble Stones'}</button>
            </div>
        `;
        const delBtn = container.querySelector('#btn-del-rubble');
        if (delBtn) delBtn.addEventListener('click', () => {
            if (this.selectedRubbleMesh) {
                if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.gizmo) ObjectsPanel.gizmo.attachToMesh(null);
                this.selectedRubbleMesh.dispose();
                this.selectedRubbleMesh = null;
                container.innerHTML = `<div class="objects-empty">${isRu ? 'Камень удалён' : 'Stone deleted'}</div>`;
                if (typeof Toast !== 'undefined') Toast.show(isRu ? 'Камень удалён' : 'Stone deleted');
            }
        });
        const clearAllBtn = container.querySelector('#btn-clear-all-rubble');
        if (clearAllBtn) clearAllBtn.addEventListener('click', () => {
            this.setRubbleVisible(false);
            if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.gizmo) ObjectsPanel.gizmo.attachToMesh(null);
            container.innerHTML = `<div class="objects-empty">${isRu ? 'Все камни убраны с карты' : 'All rubble removed from map'}</div>`;
        });
    },

    async saveLevel() {
        if (typeof MapEditor !== 'undefined') return MapEditor.save();
        try {
            if (!this.levelData) this.loadRaidData();
            if (typeof MaterialEditor !== 'undefined' && MaterialEditor.currentGroundConfig) {
                this.levelData.ground = JSON.parse(JSON.stringify(MaterialEditor.currentGroundConfig));
            }
            if (this.levelData.rubble === undefined) {
                this.levelData.rubble = { enabled: this.rubbleVisible };
                this.levelData.environment ||= {}; this.levelData.environment.rubble = this.rubbleVisible;
            }
            const res = await fetch('/api/save-level', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level: this.levelData })
            });
            const data = await res.json();
            if (data.ok) {
                if (typeof Toast !== 'undefined') Toast.show(typeof I18N !== 'undefined' && I18N.lang === 'ru' ? 'Карта и пол локации сохранены!' : 'Raid level saved successfully!', false);
                else alert('Raid level saved!');
            } else {
                if (typeof Toast !== 'undefined') Toast.show('Failed to save level: ' + data.error, true);
                else alert('Save failed: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('Error saving level: ' + err.message);
        }
    },

    selectDistrictProp(rootMesh, additive = false) {
        if (typeof MapEditor !== 'undefined') MapEditor.select(rootMesh, additive);
        if (!rootMesh) return;
        this.selectedDistrictProp = rootMesh;
        this.selectedEntityId = null;
        this.selectedRubbleMesh = null;
        if (typeof ObjectsPanel !== 'undefined') {
            ObjectsPanel.selected = null;
            if (ObjectsPanel.gizmo) ObjectsPanel.gizmo.attachToMesh(rootMesh);
        } else if (typeof SceneView !== 'undefined' && SceneView.gizmoManager) {
            SceneView.gizmoManager.attachToMesh(rootMesh);
        }
        const pane = document.getElementById('inspector-pane');
        if (pane) pane.hidden = false;
        if (typeof PaneTabs !== 'undefined') PaneTabs.show('objects');

        this.renderDistrictPropInspector(rootMesh);
    },

    renderDistrictPropInspector(rootMesh) {
        const container = document.getElementById('object-props');
        if (!container) return;
        const isRu = typeof I18N !== 'undefined' && I18N.lang === 'ru';
        const md = rootMesh.metadata || {};
        const title = md.name || rootMesh.name || (isRu ? 'Объект окружения' : 'District Structure');

        container.innerHTML = '';
        const titleEl = document.createElement('div');
        titleEl.className = 'props-section';
        titleEl.textContent = '🏗️ ' + title;
        container.appendChild(titleEl);

        const row = (label, el) => {
            const w = document.createElement('div');
            w.className = 'field';
            const h = document.createElement('div');
            h.className = 'field-head';
            h.innerHTML = `<label>${label}</label>`;
            w.appendChild(h);
            w.appendChild(el);
            return w;
        };

        // Position coordinates
        const posControls = document.createElement('div');
        posControls.className = 'field-controls';
        posControls.innerHTML = `
            <span class="axis-label">X</span><input type="number" id="prop-pos-x" value="${Math.round(rootMesh.position.x)}">
            <span class="axis-label">Z</span><input type="number" id="prop-pos-z" value="${Math.round(rootMesh.position.z)}">
            <span class="axis-label">Y</span><input type="number" id="prop-pos-y" value="${Math.round(rootMesh.position.y)}">
        `;
        const onPosChange = () => {
            rootMesh.position.x = Number(/** @type {HTMLInputElement} */ (posControls.querySelector('#prop-pos-x')).value) || 0;
            rootMesh.position.z = Number(/** @type {HTMLInputElement} */ (posControls.querySelector('#prop-pos-z')).value) || 0;
            rootMesh.position.y = Number(/** @type {HTMLInputElement} */ (posControls.querySelector('#prop-pos-y')).value) || 0;
        };
        posControls.querySelector('#prop-pos-x').addEventListener('input', onPosChange);
        posControls.querySelector('#prop-pos-z').addEventListener('input', onPosChange);
        posControls.querySelector('#prop-pos-y').addEventListener('input', onPosChange);
        container.appendChild(row(isRu ? 'Позиция (Map PX)' : 'Position (Map PX)', posControls));

        // Rotation
        const rotControls = document.createElement('div');
        rotControls.className = 'field-controls';
        const degY = Math.round((rootMesh.rotation.y || 0) * 180 / Math.PI);
        rotControls.innerHTML = `
            <span class="axis-label">Rot Y°</span><input type="number" id="prop-rot-y" value="${degY}">
        `;
        rotControls.querySelector('#prop-rot-y').addEventListener('input', (e) => {
            const val = Number(/** @type {HTMLInputElement} */ (e.target).value) || 0;
            rootMesh.rotation.y = val * Math.PI / 180;
        });
        container.appendChild(row(isRu ? 'Поворот' : 'Rotation', rotControls));

        // Delete button
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.flexDirection = 'column';
        btnGroup.style.gap = '8px';
        btnGroup.style.marginTop = '16px';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'panel-button danger';
        delBtn.textContent = isRu ? 'Удалить объект (Delete)' : 'Delete Structure (Delete)';
        delBtn.addEventListener('click', () => {
            MapEditor.removeSelection(); return;
            if (this.selectedDistrictProp) {
                if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.gizmo) ObjectsPanel.gizmo.attachToMesh(null);
                this.selectedDistrictProp.dispose();
                this.selectedDistrictProp = null;
                container.innerHTML = `<div class="objects-empty">${isRu ? 'Объект удалён' : 'Structure deleted'}</div>`;
                if (typeof Toast !== 'undefined') Toast.show(isRu ? 'Объект удалён' : 'Structure deleted');
            }
        });
        btnGroup.appendChild(delBtn);
        container.appendChild(btnGroup);
    },

    bindEvents() {
        const btnRubble = document.getElementById('btn-toggle-rubble');
        if (btnRubble) {
            btnRubble.addEventListener('click', () => {
                this.setRubbleVisible(!this.rubbleVisible);
            });
        }

        // Sync gizmo moves back to entity or pick rubble/district prop
        if (this.scene) {
            this.scene.onPointerDown = (evt, pickInfo) => {
                if (typeof MapEditor !== 'undefined') return; // ObjectsPanel owns click selection.
                if (pickInfo.hit && pickInfo.pickedMesh) {
                    for (let n = pickInfo.pickedMesh; n; n = n.parent) {
                        const md = n.metadata;
                        if (md && md.raidEntity) {
                            this.selectEntity(md.raidEntity.id);
                            return;
                        } else if (md && (md.districtPropRoot || md.isDistrictStructure)) {
                            this.selectDistrictProp(md.districtPropRoot || n);
                            return;
                        } else if (md && md.isRubble) {
                            this.selectRubble(n);
                            return;
                        }
                    }
                }
            };
        }

        window.addEventListener('keydown', (e) => {
            if (typeof MapEditor !== 'undefined') return;
            if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {HTMLElement} */ (e.target).tagName)) return;
            if ((e.code === 'Delete' || e.code === 'Backspace')) {
                if (this.selectedDistrictProp) {
                    e.preventDefault();
                    if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.gizmo) ObjectsPanel.gizmo.attachToMesh(null);
                    this.selectedDistrictProp.dispose();
                    this.selectedDistrictProp = null;
                    const container = document.getElementById('object-props');
                    const isRu = typeof I18N !== 'undefined' && I18N.lang === 'ru';
                    if (container) container.innerHTML = `<div class="objects-empty">${isRu ? 'Объект удалён' : 'Structure deleted'}</div>`;
                    if (typeof Toast !== 'undefined') Toast.show(isRu ? 'Объект удалён' : 'Structure deleted');
                    return;
                }
                if (this.selectedRubbleMesh) {
                    e.preventDefault();
                    if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.gizmo) ObjectsPanel.gizmo.attachToMesh(null);
                    this.selectedRubbleMesh.dispose();
                    this.selectedRubbleMesh = null;
                    const container = document.getElementById('object-props');
                    const isRu = typeof I18N !== 'undefined' && I18N.lang === 'ru';
                    if (container) container.innerHTML = `<div class="objects-empty">${isRu ? 'Камень удалён' : 'Stone deleted'}</div>`;
                    if (typeof Toast !== 'undefined') Toast.show(isRu ? 'Камень удалён' : 'Stone deleted');
                }
            }
        });
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = RaidLayer;
if (typeof window !== 'undefined') window.RaidLayer = RaidLayer;
if (typeof globalThis !== 'undefined') globalThis.RaidLayer = RaidLayer;
