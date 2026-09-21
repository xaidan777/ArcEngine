// model-editor.js — the MODEL inspector: what a GLB or FBX actually contains, and whether it is
// usable in the game. This is the panel a designer opens when a character looks wrong.
//
// The engine can already LOAD a model (Model3D / Gltf3D) and PLAY its clips (Clips3D), but there
// was nowhere to SEE what was loaded: which meshes, how many bones, which clips, whether the
// skeleton is actually bound to the mesh. Without that, a broken rig looks like "the animation is
// crooked" with no way to tell whether the fault is the file, the rig or the clip.
//
// What it reports, in the order a person debugging a character needs it:
//   1. meshes — name, vertices, triangles, material, and whether each is skinned;
//   2. skeleton — bone count, root bones, and the DEPTH of the hierarchy;
//   3. skinning — whether the mesh carries bone indices and weights at all. A mesh with a skeleton
//      but no skinning data renders in the rest pose no matter what clip you play, which is the
//      single most common "my animation does not work" cause;
//   4. clips — names and durations, and whether each is a pose change or real motion;
//   5. findings — the problems worth fixing, in the same shape ClipDoc.validate uses.
//
// Everything that can be computed from plain data is a PURE function here, so the checks are
// testable without a GPU; the Babylon-touching methods just gather that data.

/** @satisfies {Record<string, any>} */
const ModelEditor = {
    ROOT_ID: 'model-editor',
    /** A bone hierarchy deeper than this is almost always a rigging mistake, not intent. */
    MAX_BONE_DEPTH: 12,

    /** @type {any} the loaded model root, when one is open */
    root: null,
    /** @type {any} the Clips3D of the open model, when it has one */
    clips: null,
    /** Cached inspection result. */
    report: null,

    // --- pure analysis (tested headlessly) ------------------------------------

    /**
     * Summarise one mesh. `mesh` is anything with the fields Babylon exposes — the pure tests pass
     * plain objects, which is why nothing here calls a Babylon method.
     */
    meshInfo(mesh) {
        const vertices = Number(mesh && mesh.vertices) || 0;
        const indices = Number(mesh && mesh.indices) || 0;
        return {
            name: String((mesh && mesh.name) || 'mesh'),
            vertices,
            triangles: Math.floor(indices / 3),
            material: (mesh && mesh.material) || '',
            skinned: !!(mesh && mesh.skinned),
            hasSkeleton: !!(mesh && mesh.hasSkeleton),
            boneInfluencers: Number(mesh && mesh.boneInfluencers) || 0,
            // A mesh with a skeleton but no skin data cannot follow its bones.
            bound: !!(mesh && mesh.bound),
        };
    },

    /**
     * Analyse a skeleton given as a flat list of `{ name, parent }`. Returns the bone count, the
     * roots and the deepest chain. A skeleton with several roots is legal (a weapon bone parented
     * to nothing), but a chain deeper than MAX_BONE_DEPTH is worth reporting.
     */
    skeletonInfo(bones) {
        const list = Array.isArray(bones) ? bones.filter(b => b && b.name) : [];
        if (!list.length) return { bones: 0, roots: [], maxDepth: 0, deepest: '' };
        const byName = new Map(list.map(b => [b.name, b]));
        let maxDepth = 0, deepest = '';
        for (const bone of list) {
            let depth = 0;
            let cursor = bone;
            const seen = new Set();
            // Walk up to the root. The `seen` guard makes a cyclic parent chain (a corrupt rig)
            // terminate instead of hanging the editor.
            while (cursor && cursor.parent && byName.has(cursor.parent) && !seen.has(cursor.name)) {
                seen.add(cursor.name);
                cursor = byName.get(cursor.parent);
                depth++;
            }
            if (depth > maxDepth) { maxDepth = depth; deepest = bone.name; }
        }
        return {
            bones: list.length,
            roots: list.filter(b => !b.parent || !byName.has(b.parent)).map(b => b.name),
            maxDepth,
            deepest,
        };
    },

    /**
     * Summarise a clip for the model list. Duration comes from the animation group when the engine
     * exposes it; without it the panel shows the name only rather than inventing a length.
     */
    clipInfo(name, group) {
        // Read the raw values first: `Number(null)` is 0, so coercing a MISSING group would make
        // an unknown clip look like a known zero-length one and report a false fault.
        const rawFrom = group && group.from;
        const rawTo = group && group.to;
        const known = rawFrom != null && rawTo != null && Number.isFinite(Number(rawFrom)) && Number.isFinite(Number(rawTo));
        const from = known ? Number(rawFrom) : 0;
        const to = known ? Number(rawTo) : 0;
        // `to === from` is a REAL, known zero-length clip — not an unknown one. Collapsing it into
        // null made `animated` null too, so the static-clip check could never fire and a clip that
        // produces no motion was reported as fine.
        const duration = known ? Math.max(0, to - from) : null;
        return {
            name: String(name || 'clip'),
            duration,
            // A clip that never moves a bone is a pose, not an animation — worth saying plainly.
            animated: known ? duration > 0 : null,
        };
    },

    /**
     * The whole model as data. `parts` is a list of the objects `meshInfo` consumes, `bones` of the
     * objects `skeletonInfo` consumes, `clips` of `{ name, group }`.
     */
    analyse(parts, bones, clips) {
        const meshes = (Array.isArray(parts) ? parts : []).map(m => this.meshInfo(m));
        const skeleton = this.skeletonInfo(bones);
        const clipList = (Array.isArray(clips) ? clips : []).map(c => this.clipInfo(c && c.name, c && c.group));
        return {
            meshes,
            skeleton,
            // The list itself, so a panel can show the hierarchy rather than only its shape.
            bones: (Array.isArray(bones) ? bones : []).map(b => ({ name: b && b.name, parent: (b && b.parent) || '' })),
            clips: clipList,
            totals: {
                meshes: meshes.length,
                vertices: meshes.reduce((sum, m) => sum + m.vertices, 0),
                triangles: meshes.reduce((sum, m) => sum + m.triangles, 0),
                skinned: meshes.filter(m => m.skinned).length,
                clips: clipList.length,
            },
            findings: this.validate(meshes, skeleton, clipList),
        };
    },

    /**
     * The problems worth a designer's attention. Same shape as ClipDoc.validate, so one Console
     * panel can list findings from both without a second format.
     */
    validate(meshes, skeleton, clips) {
        const out = [];
        const add = (level, code, target, message) => out.push({ level, code, target, time: 0, message });

        if (!meshes.length) add('error', 'no-meshes', '', 'the model has no mesh with vertices — nothing will render');

        for (const mesh of meshes) {
            if (mesh.triangles === 0) {
                add('warn', 'empty-mesh', mesh.name, 'no triangles: a mesh with vertices but no faces draws nothing');
            }
            if (mesh.hasSkeleton && mesh.skinned && !mesh.bound) {
                add('error', 'unbound-skin', mesh.name,
                    'the mesh has a skeleton but carries no bone weights, so it will render in its rest pose whatever clip is played');
            }
            if (mesh.boneInfluencers > 4) {
                add('info', 'many-influencers', mesh.name,
                    mesh.boneInfluencers + ' bone influences per vertex: correct but the most expensive skinning path');
            }
            if (!mesh.material) {
                add('info', 'no-material', mesh.name, 'no material: it will fall back to the kit default look');
            }
        }

        if (skeleton.bones && !meshes.some(m => m.skinned)) {
            add('error', 'skeleton-unused', '',
                'the file has ' + skeleton.bones + ' bones but no skinned mesh: the skeleton drives nothing');
        }
        if (skeleton.maxDepth > this.MAX_BONE_DEPTH) {
            add('warn', 'deep-skeleton', skeleton.deepest,
                'the bone chain is ' + skeleton.maxDepth + ' deep (over ' + this.MAX_BONE_DEPTH + '): likely an extra parent per joint');
        }
        if (skeleton.roots.length > 1) {
            add('info', 'multiple-roots', skeleton.roots.join(', '),
                skeleton.roots.length + ' root bones: legitimate for props parented to nothing, a mistake if the rig should be one chain');
        }

        if (skeleton.bones && !clips.length) {
            add('warn', 'no-clips', '', 'the model is skinned but carries no animation clips: it can only hold its rest pose');
        }
        for (const clip of clips) {
            if (clip.animated === false) {
                add('warn', 'static-clip', clip.name, 'the clip has zero duration: playing it produces no motion');
            }
        }
        return out;
    },

    /** True when the report has no error-level finding — the "safe to ship" check. */
    isClean(report) {
        return !!(report && !report.findings.some(f => f.level === 'error'));
    },

    /** Findings grouped by severity, for a pane's badge. */
    summary(report) {
        const out = { error: 0, warn: 0, info: 0 };
        for (const f of ((report && report.findings) || [])) if (out[f.level] != null) out[f.level]++;
        return out;
    },

    // --- Babylon gathering ----------------------------------------------------

    /**
     * Inspect a loaded model root. Reads the live Babylon objects and hands plain data to the pure
     * analysis above. Returns the report, or null when there is no root.
     */
    inspect(root, clips) {
        if (!root) { this.root = null; this.clips = null; this.report = null; return null; }
        this.root = root;
        this.clips = clips || (typeof Model3D !== 'undefined' && Model3D.clips ? Model3D.clips(root) : null);

        const parts = [root].concat(root.getChildMeshes ? root.getChildMeshes(false) : []);
        const meshData = [];
        let skeleton = null;
        const VB = (typeof BABYLON !== 'undefined' && BABYLON.VertexBuffer) || null;
        for (const mesh of parts) {
            if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) continue;
            // Skinning is present only when the mesh carries BOTH bone indices and weights: a
            // skeleton reference alone means the mesh will not deform.
            const bones = VB ? mesh.getVerticesData(VB.MatricesIndicesKind) : null;
            const weights = VB ? mesh.getVerticesData(VB.MatricesWeightsKind) : null;
            meshData.push({
                name: mesh.name,
                vertices: mesh.getTotalVertices(),
                indices: mesh.getTotalIndices ? mesh.getTotalIndices() : 0,
                material: (mesh.material && mesh.material.name) || '',
                skinned: !!mesh.skeleton,
                hasSkeleton: !!mesh.skeleton,
                bound: !!(bones && weights),
                boneInfluencers: mesh.numBoneInfluencers || (bones ? 4 : 0),
            });
            if (!skeleton && mesh.skeleton) skeleton = mesh.skeleton;
        }

        const boneList = [];
        if (skeleton && skeleton.bones) {
            for (const bone of skeleton.bones) {
                boneList.push({ name: bone.name, parent: (bone.getParent && bone.getParent() && bone.getParent().name) || '' });
            }
        }
        const clipList = [];
        if (this.clips && this.clips.names) {
            for (const name of this.clips.names()) {
                const track = this.clips.tracks && this.clips.tracks.get ? this.clips.tracks.get(name) : null;
                clipList.push({ name, group: track && track.group });
            }
        }
        this.report = this.analyse(meshData, boneList, clipList);
        return this.report;
    },

    /** The report as text, for the Console pane. */
    toLines(report) {
        const r = report || this.report;
        if (!r) return [];
        const lines = [];
        lines.push({ level: 'info', text: r.totals.meshes + ' mesh(es), ' + r.totals.triangles + ' triangles, ' + r.totals.skinned + ' skinned' });
        if (r.skeleton.bones) {
            lines.push({ level: 'info', text: r.skeleton.bones + ' bones, ' + r.skeleton.roots.length + ' root(s), depth ' + r.skeleton.maxDepth });
        }
        for (const clip of r.clips) {
            lines.push({ level: 'info', text: 'clip "' + clip.name + '"' + (clip.duration != null ? ' — ' + clip.duration.toFixed(2) + 's' : '') });
        }
        for (const finding of r.findings) {
            lines.push({ level: finding.level, text: finding.target ? finding.target + ': ' + finding.message : finding.message });
        }
        return lines;
    },

    dispose() {
        this.root = null;
        this.clips = null;
        this.report = null;
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = ModelEditor;
if (typeof window !== 'undefined') /** @type {any} */ (window).ModelEditor = ModelEditor;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).ModelEditor = ModelEditor;