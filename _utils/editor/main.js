// main.js — the editor entry point: UI language -> game constants -> inspector
// -> location view. The order is mandatory: before EditorLoader.load() the globals
// CAMERA_*/WORLD3D_*/TERRAIN_* do not exist.

window.addEventListener('DOMContentLoaded', async () => {
    I18N.init();
    try {
        await EditorLoader.load();
        EditHistory.init();
        PaneTabs.init();
        Inspector.init();
        // The inspector edits window globals directly; the scene needs an event to apply
        // the edit, the history — an entry (undo — with the previous value via the same path).
        const origApply = Inspector.apply.bind(Inspector);
        Inspector.apply = (f, value, opts) => {
            const before = Inspector.get(f.name);
            origApply(f, value, opts);
            window.dispatchEvent(new CustomEvent('constants-changed', { detail: { name: f.name } }));
            if (before !== value) EditHistory.record('const:' + f.name, () => Inspector.apply(f, before), () => Inspector.apply(f, value));
        };
        const origRevert = Inspector.revertAll.bind(Inspector);
        Inspector.revertAll = () => EditHistory.batch(origRevert);
        Lab.init();

        // The specialist dock and the Console come up before the scene wiring, because the scene
        // wiring publishes findings INTO the Console and needs its element to exist.
        if (typeof ConsolePane !== 'undefined') ConsolePane.init();
        if (typeof EditorPanels !== 'undefined') EditorPanels.init();

        // The scene document is the editor's model; the panels are views onto it. Wired AFTER
        // Lab.init because SceneView needs the live location and camera that Lab created.
        WireScene();
        await MapEditor.init();
    } catch (e) {
        const el = document.getElementById('boot-error');
        el.textContent = I18N.t('boot.failed') + '\n\n' + ((e && e.message) || e) + '\n\n' + 'Linux/macOS: ./editor.sh · Windows: editor.bat. Откройте адрес, напечатанный сервером.';
        el.classList.add('visible');
        console.error(e);
    }
});

// --- the scene document and its panels ---------------------------------------
//
// One document, several views: the Hierarchy lists it, the viewport draws it, the Inspector edits
// a node. Wiring lives HERE rather than inside the panels, so a panel never has to reach into
// another one and each stays testable on its own.
function WireScene() {
    if (typeof SceneDoc === 'undefined') return;

    // Start with empty document: MapEditor.init() -> load() populates it from the actual map.
    const doc = SceneDoc.create('Location');
    SceneDoc.markSaved(doc);

    if (typeof MenuBar !== 'undefined') {
        MenuBar.init();
        MenuBar.onCommand = (id) => EditorCommand(id, doc);
    }
    if (typeof HierarchyPanel !== 'undefined') {
        HierarchyPanel.init();
        HierarchyPanel.render(doc);
        HierarchyPanel.onSelect = (id) => {
            // Selection is shared: the tree highlights it, the viewport draws the gizmo, and the
            // timeline keys the same node — one selection, three views.
            if (typeof SceneView !== 'undefined') SceneView.select(id ? [id] : []);
            if (typeof EditorPanels !== 'undefined') EditorPanels.node = id ? SceneDoc.node(doc, id) : null;
        };
    }
    if (typeof SceneView !== 'undefined' && typeof Lab !== 'undefined' && Lab.location) {
        SceneView.init(Lab.location, Lab.camera, Lab.canvas);
        SceneView.setDocument(doc);
        SceneView.onSelect = (ids) => {
            // The viewport picked something: mirror it into the tree so both agree.
            if (typeof HierarchyPanel !== 'undefined') {
                HierarchyPanel.selectedId = ids && ids.length ? ids[0] : null;
                HierarchyPanel.render(doc);
            }
        };
    }
    // A change made through any panel redraws the others; the panels never call each other.
    window.addEventListener('scene-changed', () => {
        if (typeof SceneView !== 'undefined') SceneView.refresh();
        if (typeof HierarchyPanel !== 'undefined') HierarchyPanel.render(doc);
    });
    // The timeline starts on an empty clip so the panel has something to draw and the first
    // ◆ Key has somewhere to go.
    if (typeof ClipDoc !== 'undefined' && typeof AnimEditor !== 'undefined' && !AnimEditor.clip) {
        AnimEditor.setClip(ClipDoc.create('Clip 1', 30, 1));
    }
    if (typeof EditorPanels !== 'undefined') {
        EditorPanels.node = (typeof HierarchyPanel !== 'undefined' && HierarchyPanel.selectedId)
            ? SceneDoc.node(doc, HierarchyPanel.selectedId) : null;
        EditorPanels.refresh();
    }
    // Debug handle: the browser console is where an editor bug gets diagnosed.
    /** @type {any} */ (window).__arcSceneDoc = doc;
}

// One place that turns a menu id into an action, so MenuBar stays free of editor state.
function EditorCommand(id, doc) {
    const withDoc = (fn) => { if (doc) fn(doc); window.dispatchEvent(new CustomEvent('scene-changed')); };
    switch (id) {
        // --- File Menu ---
        case 'file.new':
            MapEditor.run(() => MapEditor.newMap()); return;
        case 'file.open':
            if (typeof AssetBrowser !== 'undefined') AssetBrowser.open();
            return;
        case 'file.save':
            MapEditor.run(() => MapEditor.save()); return;
        case 'file.saveAs': MapEditor.run(() => MapEditor.saveAs()); return;
        case 'file.recent':
            if (typeof Toast !== 'undefined') Toast.show(typeof I18N !== 'undefined' && I18N.lang === 'ru' ? 'Недавние: default_raid, location' : 'Recent: default_raid, location');
            return;
        case 'file.exportObjects':
            withDoc(d => ExportObjects(SceneDoc.toObjects(d)));
            return;

        // --- Edit Menu ---
        case 'edit.undo':
            if (typeof EditHistory !== 'undefined') EditHistory.undo();
            withDoc(() => {});
            return;
        case 'edit.redo':
            if (typeof EditHistory !== 'undefined') EditHistory.redo();
            withDoc(() => {});
            return;
        case 'edit.delete':
            MapEditor.removeSelection();
            return;
        case 'edit.duplicate':
            if (typeof HierarchyPanel !== 'undefined') HierarchyPanel.duplicateSelected();
            return;
        case 'edit.selectAll': MapEditor.selectAll(); return;
        case 'scene.addEmpty':
            withDoc(d => HierarchyPanel && HierarchyPanel.createNode('group', d.rootId, 'Empty'));
            return;
        case 'scene.addFromLocation':
            withDoc(d => {
                if (typeof ObjectsPanel !== 'undefined') {
                    for (const obj of ObjectsPanel.initialObjects()) {
                        const n = SceneDoc.makeNode('object', { name: obj.name || 'LocationObject', transform: { position: [obj.x || 0, obj.y || 0, obj.z || 0], rotation: [0, (obj.rotation || 0) * Math.PI / 180, 0], scale: [obj.scale || 1, obj.scale || 1, obj.scale || 1] } });
                        SceneDoc.add(d, n, d.rootId);
                    }
                }
            });
            if (typeof Toast !== 'undefined') Toast.show(typeof I18N !== 'undefined' && I18N.lang === 'ru' ? 'Объекты локации импортированы' : 'Location objects imported');
            return;
        case 'scene.toggleGrid':
            if (typeof SceneView !== 'undefined') SceneView.setGridVisible(!SceneView.gridVisible);
            return;
        case 'scene.frameSelected':
            if (typeof SceneView !== 'undefined') SceneView.focusSelected();
            return;
        case 'scene.snap':
            if (typeof Toast !== 'undefined') Toast.show(typeof I18N !== 'undefined' && I18N.lang === 'ru' ? 'Привязка к сетке: 1м (активна)' : 'Grid snap: 1m (active)');
            return;
        case 'scene.playGame': MapEditor.run(() => MapEditor.play()); return;
        case 'gameobject.empty':
            withDoc(d => HierarchyPanel && HierarchyPanel.createNode('group', d.rootId, 'Empty'));
            return;
        case 'gameobject.object':
            withDoc(d => {
                if (HierarchyPanel) {
                    const id = HierarchyPanel.createNode('object', d.rootId, 'Object');
                    if (typeof Lab !== 'undefined' && Lab.location && Lab.location.view) {
                        const scene = Lab.location.view.scene;
                        const box = BABYLON.MeshBuilder.CreateBox('obj_' + id, { size: 40 }, scene);
                        const camTarget = (Lab.camera && Lab.camera.target) ? Lab.camera.target : { x: 500, y: 500 };
                        const h = (Lab.location.terrain && Lab.location.terrain.heightAt) ? Lab.location.terrain.heightAt(camTarget.x, camTarget.y) : 0;
                        box.position.set(camTarget.x, h + 20, camTarget.y);
                        const mat = new BABYLON.PBRMaterial('mat_obj_' + id, scene);
                        mat.albedoColor = new BABYLON.Color3(0.8, 0.6, 0.2);
                        mat.metallic = 0.2;
                        mat.roughness = 0.5;
                        box.material = mat;
                        box.metadata = { sceneDocId: id };
                        if (typeof SceneView !== 'undefined') SceneView.refresh();
                    }
                }
            });
            return;
        case 'gameobject.light':
            withDoc(d => {
                if (HierarchyPanel) {
                    const id = HierarchyPanel.createNode('light', d.rootId, 'Light');
                    if (typeof Lab !== 'undefined' && Lab.location && Lab.location.view) {
                        const scene = Lab.location.view.scene;
                        const camTarget = (Lab.camera && Lab.camera.target) ? Lab.camera.target : { x: 500, y: 500 };
                        const h = (Lab.location.terrain && Lab.location.terrain.heightAt) ? Lab.location.terrain.heightAt(camTarget.x, camTarget.y) : 0;
                        const light = new BABYLON.PointLight('light_' + id, new BABYLON.Vector3(camTarget.x, h + 80, camTarget.y), scene);
                        light.diffuse = new BABYLON.Color3(1, 0.9, 0.7);
                        light.intensity = 1.5;
                        const bulb = BABYLON.MeshBuilder.CreateSphere('bulb_' + id, { diameter: 12 }, scene);
                        bulb.position.copyFrom(light.position);
                        const mat = new BABYLON.StandardMaterial('mat_bulb_' + id, scene);
                        mat.emissiveColor = new BABYLON.Color3(1, 0.9, 0.5);
                        bulb.material = mat;
                        bulb.metadata = { sceneDocId: id, light };
                    }
                }
            });
            return;
        case 'gameobject.spawn':
            withDoc(d => {
                if (HierarchyPanel) HierarchyPanel.createNode('spawn', d.rootId, 'Spawn');
                if (typeof RaidLayer !== 'undefined') {
                    const camTarget = (typeof Lab !== 'undefined' && Lab.camera && Lab.camera.target) ? Lab.camera.target : { x: 500, y: 500 };
                    RaidLayer.addEnemySpawn(camTarget.x, camTarget.y);
                }
            });
            return;

        // --- Window Menu ---
        case 'window.hierarchy': {
            if (typeof DockManager !== 'undefined') DockManager.toggleLeft();
            else {
                const pane = document.getElementById('hierarchy-pane');
                if (pane) pane.hidden = !pane.hidden;
            }
            return;
        }
        case 'window.inspector': {
            if (typeof DockManager !== 'undefined') DockManager.toggleRight();
            else {
                const pane = document.getElementById('inspector-pane');
                if (pane) pane.hidden = !pane.hidden;
            }
            return;
        }
        case 'window.project':
            if (typeof AssetBrowser !== 'undefined') AssetBrowser.open();
            return;
        case 'window.console': {
            if (typeof DockManager !== 'undefined') DockManager.toggleConsole();
            else {
                const pane = document.getElementById('console-pane');
                if (pane) pane.hidden = !pane.hidden;
            }
            return;
        }
        case 'window.modelEditor':
            if (typeof EditorPanels !== 'undefined') EditorPanels.toggle('model');
            return;
        case 'window.rig':
            if (typeof WorkspaceManager !== 'undefined') WorkspaceManager.setWorkspace('rig');
            else if (typeof EditorPanels !== 'undefined') EditorPanels.toggle('rig');
            return;

        // --- Help Menu ---
        case 'help.shortcuts':
            if (typeof MenuBar !== 'undefined' && MenuBar.showShortcutsDialog) MenuBar.showShortcutsDialog();
            return;

        default:
            return;
    }
}

// Write the scene's objects to Objects.js. Reports through Toast when the tab's helpers are
// available, and stays silent-but-honest when they are not (the editor can run without the tab).
async function ExportObjects(objects) {
    const canSave = typeof Inspector !== 'undefined' && Inspector.saveAvailable;
    if (!canSave) {
        if (typeof Toast !== 'undefined') Toast.show(I18N.t('toast.noSave'), true);
        return;
    }
    try {
        const j = await ObjectsPanel.post('/api/save-objects', { objects });
        if (!j.ok) throw new Error(Inspector.errorText(j) + (j.index != null ? ' — #' + (j.index + 1) : ''));
        // Keep the tab's dirty baseline in step, or it would report a change it did not make.
        if (typeof ObjectsPanel !== 'undefined') ObjectsPanel.saved = JSON.stringify(ObjectsPanel.defs());
        if (typeof Toast !== 'undefined') Toast.show(I18N.t('toast.objSaved', { n: j.count, backup: j.backup || '—' }));
    } catch (e) {
        if (typeof Toast !== 'undefined') Toast.show(I18N.t('toast.objSaveError', { msg: e.message }), true);
    }
}
