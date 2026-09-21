// Gltf3D.js — glTF/GLB models: skeleton, animation clips, textures. Called through Model3D
// (load / build / dispose pick the loader by the file extension); the clips of a built model —
// Model3D.clips(root). Needs libs/babylonjs.loaders.min.js; without it the model fails to
// load like a missing file, the scene doesn't crash.
//
// UNITS: glTF is meters, the kit's world is px = centimeters — the model is scaled by 100.
// AXES: the glTF front is +Z, the kit's model nose is +X — the model is turned by 90° about Y.
// MATERIALS: retain native PBR for smooth rendering; lazily derive StandardMaterial for toon.
// Both variants preserve shared source textures and winding. The editor can switch live.
// CLIPS: glTF animations by name — Clips3D: play('run') cross-fades from the current clip.

/** @satisfies {Record<string, any>} */
const Gltf3D = {
    UNITS: 100,              // glTF meters -> world px (1 cm = 1 px, like FBX)
    _cache: new Map(),       // scene uid + url -> Promise<model>: the file is loaded once per scene
    _renders: new WeakMap(), // scene -> live material bindings
    _clips: new WeakMap(),   // model root -> Clips3D

    is(url) {
        return /\.(glb|gltf)(\?|$)/i.test(String(url));
    },

    // url -> Promise<{ gltf: true, container, clips: [names] }>. The container stays out of the
    // scene: build() instantiates it. It dies with the scene.
    load(url, scene) {
        const key = scene.uid + '|' + url;
        let p = this._cache.get(key);
        if (!p) {
            p = BABYLON.LoadAssetContainerAsync(url, scene, { pluginOptions: { gltf: { createInstances: false } } }).then((container) => {
                for (const g of container.animationGroups) g.stop();   // the loader starts the first one
                scene.onDisposeObservable.addOnce(() => {
                    this._cache.delete(key);
                    container.dispose();
                });
                return { gltf: true, container, clips: container.animationGroups.map(g => g.name) };
            });
            this._cache.set(key, p);
            p.catch(() => this._cache.delete(key));   // errors are not cached: the file may be added later
        }
        return p;
    },

    // Model -> root mesh without geometry; each call gets its own meshes, skeleton, clips and
    // materials. opts: { name }.
    build(model, scene, opts) {
        const name = (opts && opts.name) || 'model';
        const root = new BABYLON.Mesh(name, scene);
        const fit = new BABYLON.TransformNode(name + '/gltf', scene);
        fit.scaling.setAll(Gltf3D.UNITS);
        fit.rotation.y = Math.PI / 2;
        fit.parent = root;
        const inst = model.container.instantiateModelsToScene((n) => name + '/' + n, false, { doNotInstantiate: true });
        for (const node of inst.rootNodes) node.parent = fit;

        const mats = new Map();
        let bindings = this._renders.get(scene);
        if (!bindings) { bindings = new Set(); this._renders.set(scene, bindings); }
        for (const mesh of root.getChildMeshes(false)) {
            if (!mesh.material) continue;
            const source = mesh.material;
            if (!mats.has(source)) {
                const binding = { source, name, meshes: [], pbr: null, toon: null };
                mats.set(source, binding); bindings.add(binding);
            }
            mats.get(source).meshes.push(mesh);
        }
        this.applyMaterialMode(scene, World3D.cfg().toon);
        root.onDisposeObservable.addOnce(() => {
            for (const binding of mats.values()) {
                bindings.delete(binding);
                // Active materials belong to Model3D.dispose; release the cached alternative.
                const active = binding.meshes[0].material;
                for (const m of [binding.pbr, binding.toon]) if (m && m !== active) m.dispose(false, false);
            }
        });

        if (inst.skeletons) {
            for (const s of inst.skeletons) s.useTextureToStoreBoneMatrices = true;
        }

        const clips = new Clips3D(scene, inst.animationGroups, model.clips);
        this._clips.set(root, clips);
        root.onDisposeObservable.addOnce(() => {
            clips.dispose();
            for (const s of inst.skeletons) s.dispose();
        });
        return root;
    },

    applyMaterialMode(scene, toon) {
        const bindings = this._renders.get(scene);
        if (!bindings) return;
        for (const binding of bindings) {
            const key = toon ? 'toon' : 'pbr';
            let material = binding[key];
            if (!material) {
                material = binding[key] = toon ? this._standard(binding.source, binding.name, scene)
                    : binding.source.clone(binding.name + '/' + binding.source.name + '/pbr');
            }
            for (const mesh of binding.meshes) {
                const previous = mesh.material;
                if (previous && previous.metadata) material.metadata = Object.assign({}, previous.metadata);
                mesh.material = material;
            }
        }
    },

    clips(root) {
        return (root && this._clips.get(root)) || null;
    },

    // glTF material (PBR) -> StandardMaterial for the toon shader.
    _standard(src, name, scene) {
        const m = new BABYLON.StandardMaterial(name + '/' + src.name, scene);
        const pbr = /** @type {BABYLON.PBRMaterial} */ (src);
        if (pbr.albedoColor) m.diffuseColor = pbr.albedoColor.toGammaSpace();
        if (pbr.albedoTexture) {
            m.diffuseTexture = pbr.albedoTexture;
            m.useAlphaFromDiffuseTexture = pbr.useAlphaFromAlbedoTexture;
        }
        if (pbr.bumpTexture) {
            m.bumpTexture = pbr.bumpTexture;
            m.invertNormalMapX = pbr.invertNormalMapX;
            m.invertNormalMapY = pbr.invertNormalMapY;
        }
        m.alpha = src.alpha;
        m.transparencyMode = src.transparencyMode;
        m.alphaCutOff = pbr.alphaCutOff != null ? pbr.alphaCutOff : m.alphaCutOff;
        m.backFaceCulling = src.backFaceCulling;
        m.sideOrientation = src.sideOrientation;
        return m;
    }
};

// Animation clips of one built model. play(name) starts the clip and cross-fades to it from
// whatever is playing; the weights move by themselves every frame (before the scene's animations).
class Clips3D {
    // groups — this model's AnimationGroups, names — their clip names in the file.
    constructor(scene, groups, names) {
        this.scene = scene;
        this.current = '';
        this.paused = false;
        /** @type {Map<string, { group: BABYLON.AnimationGroup, weight: number }>} */
        this.tracks = new Map();
        groups.forEach((group, i) => this.tracks.set(names[i] || group.name, { group, weight: 0 }));
        this.blend = Clips3D.blendSec();
        this._then = '';
        this._observer = scene.onBeforeAnimationsObservable.add(() => this._tick(scene.getEngine().getDeltaTime() / 1000));
    }

    static blendSec() {
        return typeof MODEL_CLIP_BLEND_SEC !== 'undefined' ? MODEL_CLIP_BLEND_SEC : 0.2;
    }

    names() {
        return [...this.tracks.keys()];
    }

    has(name) {
        return this.tracks.has(name);
    }

    // opts: { loop = true, speed = 1, blend = MODEL_CLIP_BLEND_SEC, then — the clip to play after a
    // non-looped one ends }. false — the model has no such clip.
    play(name, opts) {
        const t = this.tracks.get(name), o = opts || {};
        if (!t) return false;
        const loop = o.loop !== false, speed = o.speed > 0 ? o.speed : 1;
        this.blend = o.blend >= 0 ? o.blend : Clips3D.blendSec();
        this._then = loop ? '' : String(o.then || '');
        if (this.current !== name || !t.group.isPlaying) {
            const first = ![...this.tracks.values()].some(x => x.weight > 0);
            t.group.start(loop, speed, t.group.from, t.group.to, false);
            t.weight = first ? 1 : t.weight;
            t.group.setWeightForAllAnimatables(t.weight);
            if (!loop) t.group.onAnimationGroupEndObservable.addOnce(() => { if (this.current === name && this._then) this.play(this._then); });
        } else {
            t.group.speedRatio = speed;
        }
        this.current = name;
        return true;
    }

    // Stop everything: the model returns to its rest pose.
    stop() {
        this.current = '';
        for (const t of this.tracks.values()) {
            t.weight = 0;
            t.group.stop();
            t.group.reset();
        }
    }

    // Weights: the current clip rises to 1, the rest fall to 0 over blend seconds; the sum is kept at 1.
    _tick(dt) {
        if (this.paused || !this.current) return;
        const step = this.blend > 0 ? Math.max(0, dt) / this.blend : 1;
        let sum = 0;
        for (const [name, t] of this.tracks) {
            t.weight = Math.max(0, Math.min(1, t.weight + (name === this.current ? step : -step)));
            sum += t.weight;
        }
        for (const [name, t] of this.tracks) {
            if (t.weight <= 0) {
                if (name !== this.current && t.group.isPlaying) t.group.stop();
                continue;
            }
            t.group.setWeightForAllAnimatables(t.weight / sum);
        }
    }

    dispose() {
        this.scene.onBeforeAnimationsObservable.remove(this._observer);
        for (const t of this.tracks.values()) t.group.dispose();
        this.tracks.clear();
        this.current = '';
    }
}
