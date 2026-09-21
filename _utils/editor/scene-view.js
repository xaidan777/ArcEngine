// scene-view.js — the editor VIEWPORT: what a Unity-like editor puts in the centre.
//
// It owns nothing about the scene data. `SceneDoc` is the document; this file only turns it into
// Babylon nodes, draws editor-only helpers (grid, axis lines, selection outline, gizmo) and
// reports a user's drag back as a SceneDoc command. That split is what makes the document
// testable headlessly and this file replaceable.
//
// Three editor-only helpers are drawn here, all on the engine's UTILITY layer so they are never
// picked, never receive shadows and never appear in the game's own pass:
//   * the ground grid — the reference a designer needs to judge scale and distance;
//   * the selection box — what is selected, when the object itself is hard to see;
//   * the move / rotate / scale gizmo — the one thing that makes a 3D editor usable.
//
// Snap: a drag quantises through `snapValue()`, and the SNAP step is a constant of this panel
// (grid size), not a scene property — a designer changes it per editing session, not per scene.

/** @satisfies {Record<string, any>} */
const SceneView = {
    /** The container the panel draws into; the parent supplies the element. */
    ROOT_ID: 'view-wrap',
    /** Grid spacing in scene units (px). A panel constant, not a scene property. */
    GRID_SIZE: 100,

    /** @type {any} */
    doc: null,
    /** @type {any} */
    location: null,
    /** @type {any} */
    camera: null,
    /** @type {HTMLCanvasElement | null} */
    canvas: null,
    /** Selection: node ids, in click order. Multi-select is a list, as in Unity. */
    selection: [],
    /** @type {BABYLON.UtilityLayerRenderer | null} */
    utility: null,
    /** @type {any} */
    grid: null,
    /** @type {BABYLON.Mesh | null} */
    selectionBox: null,
    /** @type {any} */
    gizmo: null,
    gizmoMode: 'move',
    /** Snap step for a drag, in scene units (px). 0 disables snapping. */
    snapStep: 0,
    gridVisible: true,
    /** Called with (nodeIds) whenever the selection changes. */
    onSelect: null,
    /** Called after a gizmo drag commits one undoable step. */
    onTransform: null,

    init(location, camera, canvas) {
        this.location = location;
        this.camera = camera;
        this.canvas = canvas || /** @type {HTMLCanvasElement} */ (document.getElementById('view-canvas'));
        if (!this.location || !this.location.view) return false;
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const saved = localStorage.getItem('arc_editor_grid_visible');
                if (saved !== null) this.gridVisible = saved === 'true';
            }
        } catch (_) {}
        const scene = this.location.view.scene;
        // Utility layer: editor helpers draw here and are invisible to picking, to the shadow
        // map and to the game's own render pass. Without it a grid would cast shadows.
        this.utility = new BABYLON.UtilityLayerRenderer(scene);
        this.utility.utilityLayerScene.autoClearDepthAndStencil = false;
        this.utility.utilityLayerScene.skipFrustumClipping = true;
        this.buildGrid();
        this.buildSelectionBox();
        const btn = document.getElementById('btn-toggle-grid');
        if (btn) {
            btn.classList.toggle('active', this.gridVisible);
            btn.textContent = this.gridVisible ? '🌐 Сетка' : '🌐 Сетка (выкл)';
        }
        return true;
    },

    setDocument(doc) {
        this.doc = doc;
        this.refresh();
    },

    // --- helpers --------------------------------------------------------------

    /** Grid spacing, snapped to a sane positive number. Shared with the snap logic. */
    gridSize() {
        const size = Number(this.GRID_SIZE);
        return Number.isFinite(size) && size > 0 ? size : 100;
    },

    /**
     * Quantise a value to the snap step. With `snapStep` 0 the value passes through unchanged —
     * free dragging, which is what a designer wants for a final nudge.
     */
    snapValue(value) {
        const step = Number(this.snapStep) || 0;
        if (step <= 0) return value;
        return Math.round(value / step) * step;
    },

    /** Snap a whole transform payload, so every axis follows the same rule. */
    snapTransform(fields) {
        const out = {};
        for (const key of Object.keys(fields)) {
            // Scale is a multiplier, not a distance: snapping it to a world step would fight the
            // grid, so scale snaps to a tenth instead.
            out[key] = key.startsWith('scale') ? Math.round(fields[key] * 10) / 10 : this.snapValue(fields[key]);
        }
        return out;
    },

    // --- editor-only visuals --------------------------------------------------

    buildGrid() {
        if (!this.location || !this.utility) return;
        const scene = this.utility.utilityLayerScene;
        const size = this.gridSize();
        const extent = Math.max(1000, (this.location.width || 4096));
        const terrain = this.location.terrain;
        const hasTerrain = !!(terrain && typeof terrain.heightAt === 'function');
        const lines = [];

        const boundaryLines = [];
        if (hasTerrain) {
            const maxX = this.location.width || 4096;
            const maxZ = this.location.height || 4096;
            const step = Math.min(size, 200);
            for (let x = 0; x <= maxX; x += size) {
                const line = [];
                for (let z = 0; z <= maxZ; z += step) {
                    line.push(new BABYLON.Vector3(x, terrain.heightAt(x, z) + 1.2, z));
                }
                if (maxZ % step !== 0) {
                    line.push(new BABYLON.Vector3(x, terrain.heightAt(x, maxZ) + 1.2, maxZ));
                }
                lines.push(line);
            }
            for (let z = 0; z <= maxZ; z += size) {
                const line = [];
                for (let x = 0; x <= maxX; x += step) {
                    line.push(new BABYLON.Vector3(x, terrain.heightAt(x, z) + 1.2, z));
                }
                if (maxX % step !== 0) {
                    line.push(new BABYLON.Vector3(maxX, terrain.heightAt(maxX, z) + 1.2, z));
                }
                lines.push(line);
            }

            // Map boundary perimeter frame
            const bStep = 32;
            const b0 = [], b1 = [], b2 = [], b3 = [];
            for (let x = 0; x <= maxX; x += bStep) b0.push(new BABYLON.Vector3(x, terrain.heightAt(x, 0) + 2.5, 0));
            if (maxX % bStep !== 0) b0.push(new BABYLON.Vector3(maxX, terrain.heightAt(maxX, 0) + 2.5, 0));
            for (let z = 0; z <= maxZ; z += bStep) b1.push(new BABYLON.Vector3(maxX, terrain.heightAt(maxX, z) + 2.5, z));
            if (maxZ % bStep !== 0) b1.push(new BABYLON.Vector3(maxX, terrain.heightAt(maxX, maxZ) + 2.5, maxZ));
            for (let x = maxX; x >= 0; x -= bStep) b2.push(new BABYLON.Vector3(x, terrain.heightAt(x, maxZ) + 2.5, maxZ));
            if (maxX % bStep !== 0) b2.push(new BABYLON.Vector3(0, terrain.heightAt(0, maxZ) + 2.5, maxZ));
            for (let z = maxZ; z >= 0; z -= bStep) b3.push(new BABYLON.Vector3(0, terrain.heightAt(0, z) + 2.5, z));
            if (maxZ % bStep !== 0) b3.push(new BABYLON.Vector3(0, terrain.heightAt(0, 0) + 2.5, 0));
            boundaryLines.push(b0, b1, b2, b3);

            // Vertical corner posts marking level bounds
            for (const [cx, cz] of [[0, 0], [maxX, 0], [maxX, maxZ], [0, maxZ]]) {
                const baseH = terrain.heightAt(cx, cz);
                boundaryLines.push([
                    new BABYLON.Vector3(cx, baseH, cz),
                    new BABYLON.Vector3(cx, baseH + 120, cz)
                ]);
            }
        } else {
            for (let v = -extent; v <= extent; v += size) {
                lines.push([new BABYLON.Vector3(v, 0, -extent), new BABYLON.Vector3(v, 0, extent)]);
                lines.push([new BABYLON.Vector3(-extent, 0, v), new BABYLON.Vector3(extent, 0, v)]);
            }
            boundaryLines.push([
                new BABYLON.Vector3(-extent, 2, -extent),
                new BABYLON.Vector3(extent, 2, -extent),
                new BABYLON.Vector3(extent, 2, extent),
                new BABYLON.Vector3(-extent, 2, extent),
                new BABYLON.Vector3(-extent, 2, -extent)
            ]);
        }

        try {
            if (this.grid) {
                try { this.grid.dispose(); } catch (_) {}
            }
            if (this.boundary) {
                try { this.boundary.dispose(); } catch (_) {}
            }
            this.grid = BABYLON.MeshBuilder.CreateLineSystem('editor-grid', { lines, updatable: false }, scene);
            this.grid.isPickable = false;
            this.grid.color = new BABYLON.Color3(0.28, 0.35, 0.38);
            this.grid.alpha = 0.55;
            this.grid.setEnabled(this.gridVisible);
            this.grid.alwaysSelectAsActiveMesh = true;

            this.boundary = BABYLON.MeshBuilder.CreateLineSystem('editor-boundary', { lines: boundaryLines, updatable: false }, scene);
            this.boundary.isPickable = false;
            this.boundary.color = new BABYLON.Color3(0.2, 0.78, 1.0);
            this.boundary.alpha = 0.95;
            this.boundary.setEnabled(this.gridVisible);
            this.boundary.alwaysSelectAsActiveMesh = true;
        } catch (err) {
            this.grid = null;
            this.boundary = null;
        }
    },

    buildSelectionBox() {
        if (!this.utility) return;
        const scene = this.utility.utilityLayerScene;
        try {
            // A unit box scaled to the target's bounds: one mesh, reused for every selection.
            this.selectionBox = BABYLON.MeshBuilder.CreateBox('editor-selection',
                { size: 1 }, scene);
            this.selectionBox.isPickable = false;
            this.selectionBox.enableEdgesRendering();
            this.selectionBox.edgesWidth = 3;
            this.selectionBox.edgesColor = new BABYLON.Color4(1, 0.72, 0.2, 1);
            this.selectionBox.setEnabled(false);
        } catch (err) {
            this.selectionBox = null;
        }
    },

    setGridVisible(on) {
        this.gridVisible = !!on;
        if (this.grid) this.grid.setEnabled(this.gridVisible);
        if (this.boundary) this.boundary.setEnabled(this.gridVisible);
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.setItem('arc_editor_grid_visible', String(this.gridVisible));
            }
        } catch (_) {}
        const btn = document.getElementById('btn-toggle-grid');
        if (btn) {
            btn.classList.toggle('active', this.gridVisible);
            btn.textContent = this.gridVisible ? '🌐 Сетка' : '🌐 Сетка (выкл)';
        }
        if (typeof Toast !== 'undefined') {
            const isRu = typeof I18N !== 'undefined' && I18N.lang === 'ru';
            Toast.show(this.gridVisible ? (isRu ? 'Сетка включена' : 'Grid enabled') : (isRu ? 'Сетка выключена' : 'Grid disabled'));
        }
    },

    setGizmoMode(mode) {
        if (['move', 'rotate', 'scale'].indexOf(mode) < 0) return false;
        this.gizmoMode = mode;
        this.refreshGizmo();
        return true;
    },

    /** The Babylon mesh a node builds, if the scene has been built already. */
    meshOf(nodeId) {
        const node = this.doc ? SceneDoc.node(this.doc, nodeId) : null;
        if (!node) return null;
        const records = (this.location && this.location.objects) || [];
        // Objects are matched by their source name, which is what the scene builder records.
        const wanted = node.payload.sourceName || node.name;
        for (const rec of records) {
            if (rec && rec.def && (rec.def.name === wanted || rec.def.name === node.name)) return rec.mesh || null;
        }
        return null;
    },

    // --- selection ------------------------------------------------------------

    select(nodeIds, additive) {
        const list = Array.isArray(nodeIds) ? nodeIds.slice() : (nodeIds ? [nodeIds] : []);
        if (additive) {
            for (const id of list) {
                const at = this.selection.indexOf(id);
                if (at < 0) this.selection.push(id);
                else this.selection.splice(at, 1);
            }
        } else {
            this.selection = list;
        }
        this.refresh();
        if (this.onSelect) this.onSelect(this.selection.slice());
        return this.selection;
    },

    clearSelection() {
        return this.select([]);
    },

    selectedNodes() {
        if (!this.doc) return [];
        return this.selection.map(id => SceneDoc.node(this.doc, id)).filter(Boolean);
    },

    /** Put the editor camera on the selection, the way Unity's F key does. */
    focusSelected() {
        const nodes = this.selectedNodes();
        if (!nodes.length || !this.camera) return false;
        // The average of the selection: focusing one member must not swing the view to the last.
        let x = 0, y = 0, h = 0;
        for (const node of nodes) {
            const w = SceneDoc.worldTransform(this.doc, node.id);
            x += w.x; y += w.y; h += w.h;
        }
        const n = nodes.length;
        const target = { x: x / n, y: y / n, h: h / n };
        if (typeof this.camera.focus === 'function') {
            this.camera.focus(target);
            return true;
        }
        // Fall back to moving the camera's own target, which every CameraController has.
        if (this.camera.target) {
            this.camera.target.x = target.x;
            this.camera.target.y = target.y;
            return true;
        }
        return false;
    },

    // --- refresh --------------------------------------------------------------

    /** Redraw the helpers after the document or the selection changed. */
    refresh() {
        this.refreshSelectionBox();
        this.refreshGizmo();
    },

    refreshSelectionBox() {
        const box = this.selectionBox;
        if (!box) return;
        const mesh = this.selection.length === 1 ? this.meshOf(this.selection[0]) : null;
        if (!mesh) { box.setEnabled(false); return; }
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo ? mesh.getBoundingInfo().boundingBox : null;
        if (!bounds) { box.setEnabled(false); return; }
        const min = bounds.minimumWorld, max = bounds.maximumWorld;
        box.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
        box.scaling.set(
            Math.max(0.01, max.x - min.x),
            Math.max(0.01, max.y - min.y),
            Math.max(0.01, max.z - min.z));
        box.setEnabled(true);
    },

    /**
     * Attach a gizmo to the selected mesh. Babylon's gizmos handle their own pointer dragging,
     * so this method's job is to decide WHERE the gizmo sits and to commit the result as ONE
     * SceneDoc command when the drag ends — a gizmo that recorded every frame would fill the
     * undo stack with hundreds of steps.
     */
    refreshGizmo() {
        if (this.gizmo) {
            try { this.gizmo.dispose(); } catch (err) { /* already gone */ }
            this.gizmo = null;
        }
        if (!this.utility || !this.selection.length) return;
        // A multi-selection gets a gizmo at the first member: moving a group from a single handle
        // is the common case, and per-member handles would fight each other.
        const mesh = this.meshOf(this.selection[0]);
        if (!mesh) return;
        const scene = this.utility.utilityLayerScene;
        let gizmo = null;
        try {
            if (this.gizmoMode === 'rotate') {
                // PreserveScaling keeps a scaled object the size a designer expects while it is
                // being turned. Read defensively: an older Babylon without the enum still works.
                const preserveScaling = (BABYLON.Gizmo && typeof BABYLON.Gizmo.PreserveScaling === 'number')
                    ? BABYLON.Gizmo.PreserveScaling : 0;
                gizmo = new BABYLON.RotationGizmo(this.utility, preserveScaling);
            } else if (this.gizmoMode === 'scale') {
                // Scaling is driven through the document, not the mesh: a scale gizmo writes
                // scaleX/Y/Z and the scene rebuild applies it.
                gizmo = new BABYLON.ScaleGizmo(this.utility);
            } else {
                gizmo = new BABYLON.PositionGizmo(this.utility);
            }
        } catch (err) {
            gizmo = null;
        }
        if (!gizmo) return;
        gizmo.attachedMesh = mesh;
        // A drag is one undo step: the drag start snapshots, the drag end commits.
        const nodeId = this.selection[0];
        const startTransform = this.doc ? JSON.parse(JSON.stringify(SceneDoc.node(this.doc, nodeId).transform)) : null;
        if (gizmo.onDragStartObservable) {
            gizmo.onDragStartObservable.add(() => {
                this._dragStart = this.doc ? JSON.parse(JSON.stringify(SceneDoc.node(this.doc, nodeId).transform)) : null;
            });
        }
        if (gizmo.onDragEndObservable) {
            gizmo.onDragEndObservable.add(() => {
                const node = this.doc ? SceneDoc.node(this.doc, nodeId) : null;
                if (!node) return;
                // The mesh moved; read it back into the document, snapped.
                const p = mesh.position;
                const e = mesh.rotation;
                const s = mesh.scaling;
                const fields = this.snapTransform({
                    x: p.x, y: p.z, h: p.y,
                    rotX: e.x, rotY: e.y, rotZ: e.z,
                    scaleX: s.x, scaleY: s.y, scaleZ: s.z,
                });
                SceneDoc.setTransform(this.doc, nodeId, fields, 'gizmo:' + nodeId);
                this.refresh();
                if (this.onTransform) this.onTransform(nodeId);
            });
        }
        this.gizmo = gizmo;
        this._gizmoStart = startTransform;
    },

    dispose() {
        for (const item of [this.gizmo, this.grid, this.boundary, this.selectionBox]) {
            if (item && item.dispose) { try { item.dispose(); } catch (err) { /* gone */ } }
        }
        this.gizmo = null;
        this.grid = null;
        this.boundary = null;
        this.selectionBox = null;
        this.selection = [];
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = SceneView;
if (typeof window !== 'undefined') /** @type {any} */ (window).SceneView = SceneView;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).SceneView = SceneView;