// rig-visualizer.js — 3D X-Ray Skeleton Visualizer and In-Viewport Joint Manipulator.
// Renders joints as spheres and bone links as lines/octahedrons directly in the 3D scene.
// Works seamlessly with RigEditor and Babylon.js.

/** @satisfies {Record<string, any>} */
const RigVisualizer = {
    visible: false,
    scene: null,
    poseMode: false,
    
    /** @type {Map<string, { sphere: any, link?: any }>} */
    boneMeshes: new Map(),
    rootMesh: null,
    activeSkeleton: null,

    init(scene) {
        this.scene = scene;
        window.addEventListener('keydown', (e) => {
            // 'E' hotkey in Rig Studio extrudes a new joint
            if (this.visible && !this.poseMode && (e.key === 'e' || e.key === 'E') && !/** @type {Element} */ (e.target).matches('input, textarea, select')) {
                e.preventDefault();
                this.extrudeBone();
            }
        });
    },

    setVisible(vis) {
        this.visible = !!vis;
        for (const [_, rec] of this.boneMeshes) {
            if (rec.sphere) rec.sphere.setEnabled(this.visible);
            if (rec.link) rec.link.setEnabled(this.visible);
        }
    },

    setPoseMode(pose) {
        this.poseMode = !!pose;
        this.updateMaterials();
    },

    syncWithActiveMesh() {
        if (!this.scene) return;
        let root = null;

        // Try getting active selection from SceneView or EditorPanels
        if (typeof EditorPanels !== 'undefined' && EditorPanels.modelRoot) {
            root = EditorPanels.modelRoot;
        } else if (typeof SceneView !== 'undefined' && SceneView.selection.length) {
            root = SceneView.meshOf(SceneView.selection[0]);
        }

        if (!root) {
            this.clear();
            return;
        }

        this.rootMesh = root;
        let skeleton = root.skeleton;
        if (!skeleton && root.getChildMeshes) {
            for (const m of root.getChildMeshes(false)) {
                if (m.skeleton) { skeleton = m.skeleton; break; }
            }
        }

        this.activeSkeleton = skeleton;
        this.rebuild();
    },

    clear() {
        for (const [_, rec] of this.boneMeshes) {
            if (rec.sphere) rec.sphere.dispose();
            if (rec.link) rec.link.dispose();
        }
        this.boneMeshes.clear();
    },

    rebuild() {
        this.clear();
        if (!this.scene || typeof BABYLON === 'undefined') return;

        // If RigEditor has a document, use it; otherwise read from active skeleton
        let doc = typeof RigEditor !== 'undefined' ? RigEditor.doc : null;
        if (!doc && this.activeSkeleton && typeof EditorPanels !== 'undefined') {
            EditorPanels.loadRigFromScene();
            doc = RigEditor.doc;
        }

        if (!doc || !doc.bones || !doc.bones.length) return;

        // Materials for X-Ray joint visualization
        const defaultMat = new BABYLON.StandardMaterial('mat_bone_default', this.scene);
        defaultMat.diffuseColor = new BABYLON.Color3(0.0, 0.8, 0.9);
        defaultMat.emissiveColor = new BABYLON.Color3(0.0, 0.6, 0.8);
        defaultMat.disableDepthWrite = true;

        const selectedMat = new BABYLON.StandardMaterial('mat_bone_selected', this.scene);
        selectedMat.diffuseColor = new BABYLON.Color3(1.0, 0.8, 0.2);
        selectedMat.emissiveColor = new BABYLON.Color3(0.9, 0.7, 0.1);
        selectedMat.disableDepthWrite = true;

        const linkMat = new BABYLON.StandardMaterial('mat_bone_link', this.scene);
        linkMat.emissiveColor = new BABYLON.Color3(0.1, 0.9, 1.0);
        linkMat.alpha = 0.6;
        linkMat.disableDepthWrite = true;

        for (const bone of doc.bones) {
            // Joint sphere
            const sphere = BABYLON.MeshBuilder.CreateSphere('joint_' + bone.name, { diameter: 4, segments: 8 }, this.scene);
            sphere.material = (typeof RigEditor !== 'undefined' && RigEditor.selected === bone.name) ? selectedMat : defaultMat;
            sphere.renderingGroupId = 2; // Render in front (X-Ray effect)
            sphere.isPickable = true;
            sphere.metadata = { boneName: bone.name };

            // Position joint in world/model space
            const worldPos = this.getBoneWorldPosition(bone, doc);
            sphere.position.copyFrom(worldPos);

            // Bone link to parent
            let link = null;
            if (bone.parent) {
                const parentBone = doc.bones.find(b => b.name === bone.parent);
                if (parentBone) {
                    const parentPos = this.getBoneWorldPosition(parentBone, doc);
                    link = BABYLON.MeshBuilder.CreateLines('link_' + bone.name, {
                        points: [parentPos, worldPos],
                        updatable: true
                    }, this.scene);
                    link.color = new BABYLON.Color3(0.2, 0.8, 1.0);
                    link.renderingGroupId = 2;
                }
            }

            this.boneMeshes.set(bone.name, { sphere, link });
        }

        this.bindPicking();
    },

    getBoneWorldPosition(bone, doc) {
        let x = 0, y = 0, z = 0;
        let curr = bone;
        const seen = new Set();
        while (curr && !seen.has(curr.name)) {
            seen.add(curr.name);
            if (curr.position) {
                x += Number(curr.position.x) || 0;
                y += Number(curr.position.y) || 0;
                z += Number(curr.position.z) || 0;
            }
            curr = curr.parent ? doc.bones.find(b => b.name === curr.parent) : null;
        }

        const base = (this.rootMesh && this.rootMesh.position) ? this.rootMesh.position : new BABYLON.Vector3(0, 0, 0);
        return new BABYLON.Vector3(base.x + x, base.y + y, base.z + z);
    },

    bindPicking() {
        if (!this.scene) return;
        this.scene.onPointerDown = (evt, pickInfo) => {
            if (!this.visible) return;
            if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.metadata && pickInfo.pickedMesh.metadata.boneName) {
                const boneName = pickInfo.pickedMesh.metadata.boneName;
                this.selectBone(boneName);
            }
        };
    },

    selectBone(name) {
        if (typeof RigEditor !== 'undefined') {
            RigEditor.selected = name;
            if (typeof EditorPanels !== 'undefined') EditorPanels.refreshRig();
        }
        this.updateMaterials();
        
        // Attach gizmo to selected joint sphere
        const rec = this.boneMeshes.get(name);
        if (rec && rec.sphere && typeof SceneView !== 'undefined' && SceneView.gizmoManager) {
            SceneView.gizmoManager.attachToMesh(rec.sphere);
        }
    },

    updateMaterials() {
        const sel = typeof RigEditor !== 'undefined' ? RigEditor.selected : '';
        for (const [name, rec] of this.boneMeshes) {
            if (!rec.sphere || !rec.sphere.material) continue;
            if (name === sel) {
                rec.sphere.material.emissiveColor = new BABYLON.Color3(1.0, 0.8, 0.1);
            } else {
                rec.sphere.material.emissiveColor = new BABYLON.Color3(0.0, 0.6, 0.8);
            }
        }
    },

    extrudeBone() {
        if (typeof RigEditor === 'undefined' || !RigEditor.doc) return;
        const parent = RigEditor.selected || (RigEditor.doc.bones[0] && RigEditor.doc.bones[0].name) || 'root';
        let name = 'bone';
        let n = 1;
        while (RigEditor.bone(name + n)) n++;
        const newName = name + n;

        // Place new joint slightly offset along Y or X from parent
        const parentBone = RigEditor.bone(parent);
        const offset = { x: 0, y: 15, z: 0 };
        if (parentBone && parentBone.position) {
            offset.x = parentBone.position.x;
            offset.y = parentBone.position.y + 15;
            offset.z = parentBone.position.z;
        }

        const created = RigEditor.addBone(newName, parent, offset);
        if (created) {
            RigEditor.selected = newName;
            this.rebuild();
            this.selectBone(newName);
            if (typeof EditorPanels !== 'undefined') EditorPanels.refreshRig();
            if (typeof Toast !== 'undefined') Toast.show(`Joint ${newName} created!`, false);
        }
    },

    async saveRigToServer() {
        if (typeof RigEditor === 'undefined' || !RigEditor.doc) return;
        const doc = RigEditor.doc;
        try {
            const res = await fetch('/api/save-rig', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: doc.name || 'character_rig', rig: doc })
            });
            const data = await res.json();
            if (data.ok) {
                if (typeof Toast !== 'undefined') Toast.show(`Rig saved to ${data.path}!`, false);
                else alert('Rig saved!');
            } else {
                if (typeof Toast !== 'undefined') Toast.show('Error saving rig: ' + data.error, true);
                else alert('Error: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('Save rig error: ' + err.message);
        }
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = RigVisualizer;
if (typeof window !== 'undefined') window.RigVisualizer = RigVisualizer;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).RigVisualizer = RigVisualizer;
