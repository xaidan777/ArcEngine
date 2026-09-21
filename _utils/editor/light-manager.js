// light-manager.js — Light sources manager for ArcEngine Level Editor.
// Manages PointLights and SpotLights: 3D visual helpers, gizmo interaction,
// live scene illumination and map persistence.

/** @typedef {{ id: string, name: string, type: 'point' | 'spot', x: number, y: number, h: number, color: string, intensity: number, range: number, direction?: [number, number, number], angle?: number, exponent?: number }} LightDef */

/** @satisfies {Record<string, any>} */
const LightManager = {
    /** @type {Map<string, { id: string, def: LightDef, light: BABYLON.PointLight | BABYLON.SpotLight, helper: BABYLON.Mesh, cone?: BABYLON.Mesh }>} */
    lights: new Map(),
    selectedId: null,
    scene: null,

    init(scene) {
        this.scene = scene || (typeof Lab !== 'undefined' && Lab.location?.view?.scene);
        this.clear();
    },

    clear() {
        for (const [_, rec] of this.lights) {
            try { if (rec.cone) rec.cone.dispose(false, true); } catch (_) {}
            try { if (rec.helper) rec.helper.dispose(false, true); } catch (_) {}
            try { if (rec.light) rec.light.dispose(); } catch (_) {}
        }
        this.lights.clear();
        this.selectedId = null;
    },

    /**
     * Creates and registers a new light source in the scene.
     * @param {'point' | 'spot'} type
     * @param {number} x
     * @param {number} y - map Z coordinate
     * @param {number} [h=60] - height above ground or world Y
     * @param {Partial<LightDef>} [opts={}]
     * @returns {LightDef}
     */
    createLight(type, x, y, h, opts = {}) {
        const scene = this.scene || Lab.location?.view?.scene;
        if (!scene) throw new Error('Scene not available for LightManager');

        const id = opts.id || ('light_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        const name = opts.name || (type === 'spot' ? 'Прожектор ' + (this.lights.size + 1) : 'Свет ' + (this.lights.size + 1));
        const color = opts.color || (type === 'spot' ? '#ffffff' : '#fffaed');
        const intensity = opts.intensity != null ? opts.intensity : (type === 'spot' ? 2.0 : 1.5);
        const range = opts.range != null ? opts.range : (type === 'spot' ? 450 : 300);
        const angle = opts.angle != null ? opts.angle : 60; // Spot cone angle in degrees
        const exponent = opts.exponent != null ? opts.exponent : 1.5; // Falloff exponent
        const direction = opts.direction || [0, -1, 0.2]; // Default downward slightly forward

        let groundH = 0;
        const terrain = (typeof Lab !== 'undefined' && Lab.location?.terrain) || scene._terrain;
        if (terrain && typeof terrain.heightAt === 'function') {
            groundH = terrain.heightAt(x, y) || 0;
        }
        if (h == null || isNaN(h)) {
            h = groundH + (type === 'spot' ? 120 : 60);
        }

        /** @type {LightDef} */
        const def = {
            id, name, type,
            x: Math.round(x),
            y: Math.round(y),
            h: Math.round(h),
            color, intensity, range,
            ...(type === 'spot' ? { direction, angle, exponent } : {})
        };

        const pos = new BABYLON.Vector3(def.x, def.h, def.y);
        let light = null;
        let cone = null;

        if (type === 'spot') {
            const dir = new BABYLON.Vector3(direction[0], direction[1], direction[2]).normalize();
            const spot = new BABYLON.SpotLight(id, pos, dir, angle * Math.PI / 180, exponent, scene);
            spot.diffuse = BABYLON.Color3.FromHexString(color);
            spot.intensity = intensity;
            spot.range = range;
            spot.falloffType = BABYLON.Light.FALLOFF_STANDARD;
            spot.innerAngle = (angle * 0.6) * Math.PI / 180;
            light = spot;
        } else {
            const pt = new BABYLON.PointLight(id, pos, scene);
            pt.diffuse = BABYLON.Color3.FromHexString(color);
            pt.intensity = intensity;
            pt.range = range;
            pt.falloffType = BABYLON.Light.FALLOFF_STANDARD;
            light = pt;
        }

        // 3D Helper bulb mesh for selection and visual positioning
        const helper = BABYLON.MeshBuilder.CreateSphere('helper_' + id, { diameter: 14, segments: 12 }, scene);
        helper.position.copyFrom(pos);
        helper.isPickable = true;
        helper.receiveShadows = false;
        helper.alwaysSelectAsActiveMesh = true;

        const mat = new BABYLON.StandardMaterial('mat_helper_' + id, scene);
        mat.emissiveColor = BABYLON.Color3.FromHexString(color);
        mat.diffuseColor = BABYLON.Color3.FromHexString(color);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        helper.material = mat;

        // Visual ring around bulb
        const ring = BABYLON.MeshBuilder.CreateTorus('ring_' + id, { diameter: 18, thickness: 2, tessellation: 24 }, scene);
        ring.parent = helper;
        ring.material = mat;
        ring.isPickable = false;
        ring.alwaysSelectAsActiveMesh = true;

        if (type === 'spot') {
            // Visual cone wireframe indicator for spot light direction
            cone = this._createSpotVisualizer(helper, def, scene);
        }

        const rec = { id, def, light, helper, cone };
        helper.metadata = { isEditorLight: true, lightRecord: rec };
        this.lights.set(id, rec);

        if (typeof LightingPanel !== 'undefined') LightingPanel.render();
        return def;
    },

    _createSpotVisualizer(parent, def, scene) {
        const rad = ((def.angle || 60) / 2) * Math.PI / 180;
        const length = Math.min(100, (def.range || 300) * 0.4);
        const radius = Math.tan(rad) * length;

        const cone = BABYLON.MeshBuilder.CreateCylinder('spot_cone_' + def.id, {
            height: length,
            diameterTop: 2,
            diameterBottom: radius * 2,
            tessellation: 16
        }, scene);

        cone.metadata = { editorConeLength: length };
        cone.parent = parent;
        cone.position.set(0, -length / 2, 0);
        cone.isPickable = false;
        cone.enableEdgesRendering();
        cone.edgesWidth = 2.0;
        cone.edgesColor = new BABYLON.Color4(1, 0.9, 0.4, 0.85);

        const mat = new BABYLON.StandardMaterial('mat_spot_cone_' + def.id, scene);
        mat.alpha = 0.08;
        mat.disableLighting = true;
        mat.disableDepthWrite = true;
        mat.diffuseColor = BABYLON.Color3.FromHexString(def.color || '#ffffff');
        mat.emissiveColor = mat.diffuseColor;
        mat.backFaceCulling = false;
        cone.material = mat;
        cone.alwaysSelectAsActiveMesh = true;

        // Orient cone according to direction
        this._orientSpotVisualizer(cone, def.direction || [0, -1, 0]);
        return cone;
    },

    _orientSpotVisualizer(coneMesh, dirArr) {
        if (!coneMesh) return;
        const dir = new BABYLON.Vector3(dirArr[0], dirArr[1], dirArr[2]).normalize();
        const halfLength = (coneMesh.metadata?.editorConeLength || 100) / 2;
        coneMesh.position.set(dir.x * halfLength, dir.y * halfLength, dir.z * halfLength);
        const down = new BABYLON.Vector3(0, -1, 0);
        const axis = BABYLON.Vector3.Cross(down, dir);
        const dot = BABYLON.Vector3.Dot(down, dir);
        if (axis.lengthSquared() > 0.0001) {
            const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
            coneMesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
        } else if (dot < 0) {
            coneMesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI);
        } else {
            coneMesh.rotationQuaternion = BABYLON.Quaternion.Identity();
        }
    },

    /**
     * Updates an existing light's properties.
     * @param {string} id
     * @param {Partial<LightDef>} changes
     */
    updateLight(id, changes) {
        const rec = this.lights.get(id);
        if (!rec) return;
        const d = rec.def;
        Object.assign(d, changes);

        const pos = new BABYLON.Vector3(d.x, d.h, d.y);
        rec.light.position.copyFrom(pos);
        rec.helper.position.copyFrom(pos);

        if (d.color) {
            const c3 = BABYLON.Color3.FromHexString(d.color);
            rec.light.diffuse = c3;
            if (rec.helper.material) {
                rec.helper.material.emissiveColor = c3;
                rec.helper.material.diffuseColor = c3;
            }
        }
        if (d.intensity != null) rec.light.intensity = d.intensity;
        if (d.range != null) rec.light.range = d.range;

        if (d.type === 'spot' && rec.light instanceof BABYLON.SpotLight) {
            if (d.angle != null) {
                rec.light.angle = d.angle * Math.PI / 180;
                rec.light.innerAngle = (d.angle * 0.6) * Math.PI / 180;
            }
            if (d.exponent != null) rec.light.exponent = d.exponent;
            if (rec.cone) rec.cone.dispose(false, true);
            rec.cone = this._createSpotVisualizer(rec.helper, d, this.scene);
            if (d.direction) {
                const dir = new BABYLON.Vector3(d.direction[0], d.direction[1], d.direction[2]).normalize();
                rec.light.direction.copyFrom(dir);

            }
        }
    },

    /**
     * Selects a light by ID and attaches 3D gizmo.
     * @param {string | null} id
     */
    select(id) {
        if (this.selectedId === id) return;
        // Unhighlight previous
        if (this.selectedId) {
            const prev = this.lights.get(this.selectedId);
            if (prev?.helper) prev.helper.showBoundingBox = false;
        }
        this.selectedId = id;
        if (id) {
            const rec = this.lights.get(id);
            if (rec?.helper) {
                rec.helper.showBoundingBox = true;
                if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.gizmo) {
                    ObjectsPanel.gizmo.attachToMesh(rec.helper);
                }
            }
        } else {
            if (typeof ObjectsPanel !== 'undefined' && ObjectsPanel.gizmo) {
                ObjectsPanel.gizmo.attachToMesh(null);
            }
        }
        if (typeof LightingPanel !== 'undefined') LightingPanel.render();
    },

    /**
     * Called when the gizmo finishes moving or rotating the light helper.
     * @param {string} id
     */
    onTransform(id) {
        const rec = this.lights.get(id);
        if (!rec || !rec.helper) return;
        const pos = rec.helper.position;
        rec.def.x = Math.round(pos.x);
        rec.def.h = Math.round(pos.y);
        rec.def.y = Math.round(pos.z);
        rec.light.position.copyFrom(pos);

        if (rec.def.type === 'spot' && rec.light instanceof BABYLON.SpotLight) {
            // Apply the gizmo delta once, then keep the helper in world axes.
            const direction = rec.def.direction || [0, -1, 0];
            const fwd = rec.helper.getDirection(new BABYLON.Vector3(...direction)).normalize();
            rec.helper.rotation.set(0, 0, 0);
            rec.helper.rotationQuaternion = BABYLON.Quaternion.Identity();
            rec.def.direction = [fwd.x, fwd.y, fwd.z];
            rec.light.direction.copyFrom(fwd);
            if (rec.cone) this._orientSpotVisualizer(rec.cone, rec.def.direction);
        }
        if (typeof LightingPanel !== 'undefined') LightingPanel.updateProperties();
    },

    removeLight(id) {
        const rec = this.lights.get(id);
        if (!rec) return;
        if (this.selectedId === id) this.select(null);
        try { if (rec.cone) rec.cone.dispose(false, true); } catch (_) {}
        try { if (rec.helper) rec.helper.dispose(false, true); } catch (_) {}
        try { if (rec.light) rec.light.dispose(); } catch (_) {}
        this.lights.delete(id);
        if (typeof LightingPanel !== 'undefined') LightingPanel.render();
    },

    exportDefs() {
        return Array.from(this.lights.values()).map(r => structuredClone(r.def));
    },

    importDefs(list) {
        this.clear();
        if (!Array.isArray(list)) return;
        for (const def of list) {
            this.createLight(def.type || 'point', def.x || 0, def.y || 0, def.h != null ? def.h : 60, def);
        }
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = LightManager;
if (typeof window !== 'undefined') /** @type {any} */ (window).LightManager = LightManager;
