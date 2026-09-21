// rig-editor.js — the RIG panel: the bone hierarchy, and the operations a person actually needs
// when a character's animation looks wrong because the SKELETON is wrong, not the clip.
//
// Why this exists next to ModelEditor: ModelEditor says WHAT is in the file ("12 bones, no skin
// weights"), but fixing a rig means working on the hierarchy itself — seeing which bone is the
// parent of which, renaming a joint, reparenting a limb, and checking that a bind pose is sane.
// A wrong bone parent is the classic cause of a limb that "swims" during an animation while every
// clip curve is perfectly smooth.
//
// This panel edits a BONE TREE held as plain data (`{ name, parent, position }`). That is
// deliberate: the engine's Gltf3D parses a skeleton but does not write one, so the editable rig is
// a document of its own which can be applied to a live skeleton and, later, exported. Building the
// editor on the live Babylon skeleton would make every operation depend on a loaded GLB and be
// untestable.
//
// The checks in `validate()` are the ones that catch a rig that will animate badly:
//   * a bone whose parent does not exist (the chain silently detaches from the root);
//   * a cycle in the parent links (the chain never terminates);
//   * more than one root when the rig should be a single chain;
//   * duplicate bone names (a glTF lookup by name then resolves to the wrong bone);
//   * a bone whose bind position is identical to its parent's, which produces zero-length motion.

/** @satisfies {Record<string, any>} */
const RigEditor = {
    ROOT_ID: 'rig-editor',
    /** A chain deeper than this is usually an extra parent per joint. */
    MAX_DEPTH: 12,

    /** @type {any} the rig document: { name, bones: [{ name, parent, position }] } */
    doc: null,
    /** Selected bone name. */
    selected: '',
    /** Called with the bone name when the selection changes. */
    onSelect: null,

    /** A new, empty rig with a single root bone. */
    create(name = 'Rig') {
        return {
            version: 1,
            name,
            bones: [{ name: 'root', parent: '', position: { x: 0, y: 0, z: 0 } }],
            revision: 0,
            dirty: false,
        };
    },

    setDocument(doc) {
        this.doc = doc;
        this.selected = doc && doc.bones.length ? doc.bones[0].name : '';
        return this;
    },

    // --- reading --------------------------------------------------------------

    bone(name) {
        if (!this.doc) return null;
        return this.doc.bones.find(b => b.name === name) || null;
    },

    children(name) {
        if (!this.doc) return [];
        return this.doc.bones.filter(b => b.parent === name);
    },

    /** The bone tree, depth-first, parents before children, each row carrying its depth. */
    flatten() {
        if (!this.doc) return [];
        const byParent = new Map();
        for (const bone of this.doc.bones) {
            const key = bone.parent || '';
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(bone);
        }
        const out = [];
        const visit = (parent, depth) => {
            for (const bone of (byParent.get(parent) || [])) {
                out.push({ name: bone.name, depth, hasChildren: (byParent.get(bone.name) || []).length > 0 });
                // A cyclic rig would loop forever here; `validate` reports it and the depth cap
                // keeps the panel responsive while the designer fixes it.
                if (depth < 64) visit(bone.name, depth + 1);
            }
        };
        // Start the walk from every bone that has no parent IN THIS RIG — a true root, and also a
        // bone whose parent is missing (shown at the top so a broken link is visible).
        //
        // The descent must happen for BOTH cases. Gating it on `if (bone.parent)` meant a real
        // root never descended, so its descendants were never visited and fell through to the
        // "missed" loop below at depth 0 — the tree rendered flat.
        for (const bone of this.doc.bones) {
            if (!bone.parent || !this.bone(bone.parent)) {
                out.push({ name: bone.name, depth: 0, hasChildren: (byParent.get(bone.name) || []).length > 0, orphan: !!(bone.parent && !this.bone(bone.parent)) });
                visit(bone.name, 1);
            }
        }
        // Anything the walks above missed (a cycle) still has to appear, or a broken rig would
        // show an empty list and look like an empty file.
        const shown = new Set(out.map(r => r.name));
        for (const bone of this.doc.bones) {
            if (!shown.has(bone.name)) out.push({ name: bone.name, depth: 0, hasChildren: false, orphan: true });
        }
        return out;
    },

    /** The chain from the root down to a bone. Stops on a cycle rather than hanging. */
    path(name) {
        const chain = [];
        const seen = new Set();
        let cursor = this.bone(name);
        while (cursor && !seen.has(cursor.name)) {
            seen.add(cursor.name);
            chain.unshift(cursor.name);
            cursor = cursor.parent ? this.bone(cursor.parent) : null;
        }
        return chain;
    },

    /** True when `maybeAncestor` is at or above `name` — the cycle guard for a reparent. */
    isAncestor(maybeAncestor, name) {
        return this.path(name).indexOf(maybeAncestor) >= 0;
    },

    /** Depth of a bone's chain. */
    depthOf(name) {
        return Math.max(0, this.path(name).length - 1);
    },

    // --- commands -------------------------------------------------------------

    /** One undoable step, like SceneDoc.command: capture, mutate, diff, record. */
    command(label, mutate, key) {
        const doc = this.doc;
        if (!doc || typeof mutate !== 'function') return false;
        const before = JSON.stringify(doc.bones);
        mutate();
        const after = JSON.stringify(doc.bones);
        if (before === after) return false;
        doc.revision++;
        doc.dirty = true;
        if (typeof EditHistory !== 'undefined' && EditHistory.record) {
            EditHistory.record(key || ('rig:' + label), () => this.restore(before), () => this.restore(after));
        }
        return true;
    },

    /** Write a captured bone list back, syncing in place so a panel's references stay valid. */
    restore(snapshot) {
        const doc = this.doc;
        if (!doc) return false;
        let next;
        try { next = JSON.parse(snapshot); } catch (err) { return false; }
        // SYNC IN PLACE. A panel and the timeline hold references to bone objects (the selection,
        // the row being dragged); replacing the array with a fresh parse would leave every one of
        // them pointing at an orphan, and the panel would keep showing the pre-undo values.
        const byName = new Map(doc.bones.map(b => [b.name, b]));
        const kept = [];
        for (const incoming of next) {
            const existing = byName.get(incoming.name);
            if (existing) {
                existing.parent = incoming.parent;
                existing.position = incoming.position;
                kept.push(existing);
                byName.delete(incoming.name);
            } else {
                kept.push(incoming);
            }
        }
        doc.bones.length = 0;
        for (const bone of kept) doc.bones.push(bone);
        doc.revision++;
        doc.dirty = true;
        return true;
    },

    /** Add a bone under `parent`. Names must be unique — a duplicate breaks a lookup by name. */
    addBone(name, parent, position) {
        const doc = this.doc;
        if (!doc) return false;
        const clean = String(name || '').trim();
        if (!clean || this.bone(clean)) return false;
        if (parent && !this.bone(parent)) return false;
        const bone = { name: clean, parent: parent || '', position: position ? { ...position } : { x: 0, y: 0, z: 0 } };
        return this.command('Add ' + clean, () => { doc.bones.push(bone); }) ? bone : false;
    },

    /** Remove a bone. Its children are re-parented to its parent, so the chain never breaks. */
    removeBone(name) {
        const doc = this.doc;
        const bone = this.bone(name);
        if (!doc || !bone) return false;
        // The root is the anchor of the whole rig; deleting it would orphan everything.
        if (!bone.parent) return false;
        return this.command('Delete ' + name, () => {
            const parent = bone.parent;
            for (const child of this.children(name)) child.parent = parent;
            doc.bones = doc.bones.filter(b => b.name !== name);
        });
    },

    /**
     * Move a bone under a new parent. Refuses to make a bone its own descendant: the chain would
     * become a cycle and the rig would never resolve a world transform.
     */
    reparent(name, newParent) {
        const bone = this.bone(name);
        if (!bone || !this.bone(newParent)) return false;
        if (name === newParent || this.isAncestor(name, newParent)) return false;
        return this.command('Reparent ' + name, () => { bone.parent = newParent; });
    },

    /** Rename a bone, keeping children attached. `key` merges keystrokes into one undo step. */
    renameBone(name, nextName) {
        const bone = this.bone(name);
        const clean = String(nextName == null ? '' : nextName).trim();
        if (!bone || !clean || clean === name) return false;
        if (this.bone(clean)) return false;
        return this.command('Rename bone', () => {
            for (const child of this.children(name)) child.parent = clean;
            bone.name = clean;
        }, 'rigrename:' + name);
    },

    /** Set a bone's bind position. */
    setPosition(name, position) {
        const bone = this.bone(name);
        if (!bone || !position) return false;
        const x = Number(position.x), y = Number(position.y), z = Number(position.z);
        if (![x, y, z].every(Number.isFinite)) return false;
        if (bone.position && bone.position.x === x && bone.position.y === y && bone.position.z === z) return false;
        return this.command('Move ' + name, () => { bone.position = { x, y, z }; }, 'rigmove:' + name);
    },

    // --- quality checks -------------------------------------------------------

    /**
     * The rig problems that make a good clip animate badly. Same finding shape as the other
     * editors, so one Console lists them all.
     */
    validate() {
        const out = [];
        const doc = this.doc;
        if (!doc || !doc.bones.length) {
            out.push({ level: 'error', code: 'no-bones', target: '', time: 0, message: 'the rig has no bones' });
            return out;
        }
        const add = (level, code, target, message) => out.push({ level, code, target, time: 0, message });
        const names = new Set();
        const counts = new Map();
        for (const bone of doc.bones) counts.set(bone.name, (counts.get(bone.name) || 0) + 1);

        for (const bone of doc.bones) {
            if (counts.get(bone.name) > 1) {
                add('error', 'duplicate-name', bone.name,
                    'this bone name appears ' + counts.get(bone.name) + ' times: a lookup by name resolves to the wrong bone');
            }
            names.add(bone.name);
        }
        for (const bone of doc.bones) {
            if (bone.parent && !names.has(bone.parent)) {
                add('error', 'missing-parent', bone.name,
                    'the parent "' + bone.parent + '" does not exist: this bone is detached from the chain');
            }
        }
        // A cycle: walking up from a bone revisits itself.
        for (const bone of doc.bones) {
            const seen = new Set();
            let cursor = bone;
            while (cursor && cursor.parent && names.has(cursor.parent) && !seen.has(cursor.name)) {
                seen.add(cursor.name);
                cursor = doc.bones.find(b => b.name === cursor.parent);
                if (cursor && seen.has(cursor.name)) {
                    add('error', 'cycle', bone.name, 'the parent links form a loop, so this chain never reaches a root');
                    break;
                }
            }
        }
        const roots = doc.bones.filter(b => !b.parent);
        if (!roots.length) add('error', 'no-root', '', 'no bone is a root: the rig has no anchor');
        if (roots.length > 1) {
            add('warn', 'multiple-roots', roots.map(b => b.name).join(', '),
                roots.length + ' root bones: fine for separate chains, a mistake if the rig is one skeleton');
        }
        for (const bone of doc.bones) {
            const depth = this.depthOf(bone.name);
            if (depth > this.MAX_DEPTH) {
                add('warn', 'deep-chain', bone.name, 'the chain is ' + depth + ' deep (over ' + this.MAX_DEPTH + '): likely an extra parent per joint');
            }
            // A child at exactly its parent's bind position produces zero-length motion.
            const parent = bone.parent ? this.bone(bone.parent) : null;
            if (parent && parent.position && bone.position) {
                const same = parent.position.x === bone.position.x
                    && parent.position.y === bone.position.y
                    && parent.position.z === bone.position.z;
                if (same) {
                    add('info', 'coincident-bind', bone.name,
                        'the bind position equals its parent\'s: the joint can rotate but its offset is zero');
                }
            }
        }
        return out;
    },

    isClean() {
        return !this.validate().some(f => f.level === 'error');
    },

    // --- applying to a live skeleton -----------------------------------------

    /**
     * Copy this rig's bone POSITIONS onto a live Babylon skeleton, matched by name. This is how the
     * panel's edits reach the viewport without the engine needing a skeleton writer: the hierarchy
     * is already correct in the file, the bind offsets are what a designer adjusts.
     * Returns the number of bones updated.
     */
    applyTo(skeleton) {
        if (!skeleton || !skeleton.bones || !this.doc) return 0;
        const byName = new Map(this.doc.bones.map(b => [b.name, b]));
        let applied = 0;
        for (const bone of skeleton.bones) {
            const source = byName.get(bone.name);
            if (!source || !source.position) continue;
            // Babylon's bone position is in its parent's space; setting it moves the joint.
            bone.position.x = source.position.x;
            bone.position.y = source.position.y;
            bone.position.z = source.position.z;
            applied++;
        }
        return applied;
    },

    /** The rig as data for a file. */
    toJSON() {
        return this.doc ? { version: 1, name: this.doc.name, bones: this.doc.bones } : null;
    },

    /** Rebuild a rig, rejecting a document with no usable bones. */
    fromJSON(data) {
        if (!data || typeof data !== 'object' || !Array.isArray(data.bones)) return null;
        const bones = data.bones
            .filter(b => b && typeof b.name === 'string' && b.name)
            .map(b => ({
                name: b.name,
                parent: typeof b.parent === 'string' ? b.parent : '',
                position: {
                    x: Number(b.position && b.position.x) || 0,
                    y: Number(b.position && b.position.y) || 0,
                    z: Number(b.position && b.position.z) || 0,
                },
            }));
        if (!bones.length) return null;
        const doc = this.create(data.name || 'Rig');
        doc.bones = bones;
        doc.revision = 1;
        doc.dirty = false;
        return doc;
    },

    markSaved() {
        if (this.doc) this.doc.dirty = false;
    },

    dispose() {
        this.doc = null;
        this.selected = '';
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = RigEditor;
if (typeof window !== 'undefined') /** @type {any} */ (window).RigEditor = RigEditor;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).RigEditor = RigEditor;