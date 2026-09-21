// scene-doc.js — the editor's DOCUMENT: a scene as a tree of nodes with transforms, plus the
// commands that change it. This is the piece the old editor lacked: it edited three flat files
// (constants, objects, UI) with no notion of "a scene" at all.
//
// Unity's model, which this follows:
//   * a scene is a TREE of nodes; each node has a name, a parent, a visibility flag, a
//     transform (position / rotation / scale) and a PAYLOAD that says what it is;
//   * every change goes through a COMMAND, so undo/redo and dirty-tracking are automatic
//     rather than something each panel remembers to do;
//   * the document is plain data (JSON-serialisable), so it can be saved, diffed and reloaded
//     without a running Babylon scene.
//
// A node's payload `type` decides how the Inspector edits it and how the loader builds it:
//   'object'  — a model from Objects.js (LOCATION_OBJECTS): model path, x/y, rot, scale, clip
//   'group'   — an empty transform node, the parent for others
//   'light'   — a scene light (direction, colour, intensity)
//   'spawn'   — a gameplay marker (player start, enemy spawn, loot spot)
//   'config'  — a reference to a Constants.js group, so global settings live in the same tree
//
// The document never touches Babylon. `apply()` produces the plain object the scene builder
// consumes, which is why the same file can be edited headlessly in tests.

/** @satisfies {Record<string, any>} */
const SceneDoc = {
    /** Node id counter. Ids stay unique across load() so references never collide. */
    _nextId: 1,

    /**
     * A new, empty document with one root. A scene always has exactly one root, which is what
     * makes "the parent of X" always well defined.
     * @returns {any}
     */
    create(name = 'Scene') {
        this._nextId = 1;
        const root = this.makeNode('group', { name });
        root.parentId = null;
        return {
            version: 1,
            name,
            rootId: root.id,
            nodes: { [root.id]: root },
            /** Incremented by every command; a panel compares it to know it must redraw. */
            revision: 0,
            /** True when there are commands that have not been saved. */
            dirty: false,
            /** The file this document came from, if any. */
            source: null,
        };
    },

    /**
     * One node. `payload` carries the type-specific fields; the transform is always present, as
     * in Unity, even for a node that ignores it.
     * @param {string} type
     * @param {any} [fields]
     * @returns {any}
     */
    makeNode(type, fields = {}) {
        return {
            id: 'n' + (this._nextId++),
            type,
            name: fields.name || type,
            parentId: fields.parentId != null ? fields.parentId : null,
            visible: fields.visible !== false,
            expanded: fields.expanded !== false,
            // Draw / list order among siblings. Explicit, so it survives save and reload instead
            // of depending on the key order of a plain object.
            order: fields.order != null ? Number(fields.order) : 0,
            transform: {
                x: Number(fields.x) || 0,
                y: Number(fields.y) || 0,
                h: Number(fields.h) || 0,
                rotX: Number(fields.rotX) || 0,
                rotY: Number(fields.rotY) || 0,
                rotZ: Number(fields.rotZ) || 0,
                scaleX: fields.scaleX != null ? Number(fields.scaleX) : 1,
                scaleY: fields.scaleY != null ? Number(fields.scaleY) : 1,
                scaleZ: fields.scaleZ != null ? Number(fields.scaleZ) : 1,
            },
            /** @type {Record<string, any>} type-specific data (model path, colour, clip…) */
            payload: Object.assign({}, fields.payload),
        };
    },

    // --- reading --------------------------------------------------------------

    /** A node by id, or null. */
    node(doc, id) {
        return (doc && doc.nodes && doc.nodes[id]) || null;
    },

    /** Direct children of a node, in their explicit `order` (ties fall back to id). */
    children(doc, id) {
        const out = [];
        for (const key of Object.keys(doc.nodes)) {
            if (doc.nodes[key].parentId === id) out.push(doc.nodes[key]);
        }
        // A stable sort: the comparator falls back to the id so an equal `order` never shuffles
        // between runs, which would make a redraw look like a change.
        return out.sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    /**
     * The whole subtree under a node, parents before children (depth-first). A panel draws the
     * Hierarchy by walking this from the root.
     * @returns {any[]}
     */
    walk(doc, id, out = []) {
        const node = this.node(doc, id);
        if (!node) return out;
        out.push(node);
        for (const child of this.children(doc, id)) this.walk(doc, child.id, out);
        return out;
    },

    /** Every node except the root. */
    all(doc) {
        return this.walk(doc, doc.rootId).filter(n => n.id !== doc.rootId);
    },

    /** The chain from the root down to a node, inclusive. */
    path(doc, id) {
        const chain = [];
        let node = this.node(doc, id);
        while (node) {
            chain.unshift(node);
            node = node.parentId ? this.node(doc, node.parentId) : null;
        }
        return chain;
    },

    /** True when `maybeAncestor` is at or above `id` — used to refuse a cycle-making reparent. */
    isAncestor(doc, maybeAncestor, id) {
        let node = this.node(doc, id);
        while (node) {
            if (node.id === maybeAncestor) return true;
            node = node.parentId ? this.node(doc, node.parentId) : null;
        }
        return false;
    },

    /** Nodes of one type. */
    byType(doc, type) {
        return this.all(doc).filter(n => n.type === type);
    },

    /** Case-insensitive substring search over node names — the Hierarchy search box. */
    find(doc, text) {
        const q = String(text || '').trim().toLowerCase();
        if (!q) return [];
        return this.all(doc).filter(n => n.name.toLowerCase().includes(q));
    },

    /**
     * The WORLD transform of a node: its own transform composed with every ancestor's.
     * Unity shows a child's position relative to its parent; this is what a scene builder needs.
     * Rotation is composed as a sum of Y rotations (the kit's convention: heading about Y, with
     * the nose along +X), and scale multiplies.
     * @returns {{x: number, y: number, h: number, rotX: number, rotY: number, rotZ: number, scaleX: number, scaleY: number, scaleZ: number}}
     */
    worldTransform(doc, id) {
        const chain = this.path(doc, id);
        let x = 0, y = 0, h = 0;
        let rotX = 0, rotY = 0, rotZ = 0;
        let scaleX = 1, scaleY = 1, scaleZ = 1;
        for (const node of chain) {
            const t = node.transform;
            // A parent's rotation turns the child's offset, exactly as a nested transform does.
            const a = -rotY;   // kit convention: rotation.y = -heading
            const c = Math.cos(a), s = Math.sin(a);
            const px = t.x * scaleX, py = t.y * scaleY, ph = t.h * scaleZ;
            x += px * c - ph * s;
            y += py;
            h += px * s + ph * c;
            rotX += t.rotX; rotY += t.rotY; rotZ += t.rotZ;
            scaleX *= t.scaleX; scaleY *= t.scaleY; scaleZ *= t.scaleZ;
        }
        return { x, y, h, rotX, rotY, rotZ, scaleX, scaleY, scaleZ };
    },

    // --- commands -------------------------------------------------------------

    /**
     * Run `mutate` as ONE undoable step. Everything that changes the document goes through here,
     * which is why no panel has to remember to record history: a command captures the whole
     * nodes map before and after and diffs nothing — the map is small and this is exact.
     *
     * `label` names the step in the undo stack ("Move Cube"), `key` merges rapid repeats of the
     * same edit (dragging a gizmo) into one step.
     * @param {any} doc
     * @param {string} label
     * @param {() => void} mutate
     * @param {string} [key]
     * @returns {boolean} true when the command changed something
     */
    command(doc, label, mutate, key) {
        if (!doc || typeof mutate !== 'function') return false;
        const before = JSON.stringify(doc.nodes);
        mutate();
        const after = JSON.stringify(doc.nodes);
        if (before === after) return false;
        doc.revision++;
        doc.dirty = true;
        if (typeof EditHistory !== 'undefined' && EditHistory.record) {
            EditHistory.record(key || label, () => this.restore(doc, before), () => this.restore(doc, after));
        }
        return true;
    },

    /**
     * Write a captured nodes snapshot back. Part of the undo path, not a user command: it must
     * not record history again.
     */
    restore(doc, snapshot) {
        /** @type {Record<string, any>} */
        let next;
        try {
            next = JSON.parse(snapshot);
        } catch (err) {
            return false;
        }
        // SYNC IN PLACE rather than replacing the map. A panel holds references to node objects
        // (the Inspector shows the selected one, the viewport keeps the picked one); swapping
        // `doc.nodes` for a fresh parse would leave every one of those pointing at an orphan,
        // and the UI would keep showing the pre-undo values. Mutating the existing objects keeps
        // every reference valid.
        for (const id of Object.keys(doc.nodes)) {
            if (!next[id]) delete doc.nodes[id];
        }
        for (const id of Object.keys(next)) {
            const incoming = next[id];
            const existing = doc.nodes[id];
            if (!existing) { doc.nodes[id] = incoming; continue; }
            existing.type = incoming.type;
            existing.name = incoming.name;
            existing.parentId = incoming.parentId;
            existing.visible = incoming.visible;
            existing.expanded = incoming.expanded;
            existing.order = incoming.order;
            // The transform object is synced field by field for the same reason: a gizmo holds
            // the transform it is dragging.
            const t = existing.transform || (existing.transform = {});
            for (const axis of Object.keys(incoming.transform || {})) t[axis] = incoming.transform[axis];
            existing.payload = incoming.payload || {};
            // A key removed by the edit (not merely changed) must disappear too.
            for (const key of Object.keys(existing)) {
                if (!(key in incoming) && key !== 'transform') delete existing[key];
            }
        }
        doc.revision++;
        doc.dirty = true;
        return true;
    },

    /** Add a node under `parentId`. Defaults to the root, like dropping into an empty area. */
    add(doc, node, parentId) {
        const parent = parentId != null ? parentId : doc.rootId;
        let added = false;
        this.command(doc, 'Add ' + node.name, () => {
            node.parentId = parent;
            // Append: the new node goes last among its siblings.
            const existing = this.children(doc, parent);
            node.order = existing.length ? Math.max(...existing.map(n => n.order)) + 1 : 0;
            doc.nodes[node.id] = node;
            added = true;
        });
        return added ? node : null;
    },

    /** Remove a node AND its subtree — leaving orphans behind would corrupt the tree. */
    remove(doc, id) {
        const node = this.node(doc, id);
        if (!node) return false;
        if (id === doc.rootId) return false;   // the root is not removable
        return this.command(doc, 'Delete ' + node.name, () => {
            for (const descendant of this.walk(doc, id)) delete doc.nodes[descendant.id];
        });
    },

    /**
     * Move a node under a new parent. Refuses to make a node its own descendant, which would
     * detach the subtree from the root and lose it.
     */
    reparent(doc, id, newParentId) {
        const node = this.node(doc, id);
        if (!node || !this.node(doc, newParentId)) return false;
        if (id === newParentId || this.isAncestor(doc, id, newParentId)) return false;
        return this.command(doc, 'Reparent ' + node.name, () => { node.parentId = newParentId; });
    },

    /** Rename. `key` merges keystrokes while typing into one undo step. */
    rename(doc, id, name) {
        const node = this.node(doc, id);
        if (!node) return false;
        const clean = String(name == null ? '' : name).trim();
        if (!clean || clean === node.name) return false;
        return this.command(doc, 'Rename', () => { node.name = clean; }, 'rename:' + id);
    },

    /** Show or hide a node. */
    setVisible(doc, id, visible) {
        const node = this.node(doc, id);
        if (!node || node.visible === !!visible) return false;
        return this.command(doc, (visible ? 'Show ' : 'Hide ') + node.name, () => { node.visible = !!visible; });
    },

    /**
     * Write transform fields. Only the keys present in `fields` change, so a gizmo dragging X
     * does not silently reset the rotation. `key` merges a drag into one undo step.
     */
    setTransform(doc, id, fields, key) {
        const node = this.node(doc, id);
        if (!node) return false;
        const t = node.transform;
        const updates = {};
        let changed = false;
        for (const axis of ['x', 'y', 'h', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ']) {
            if (fields[axis] == null) continue;
            const value = Number(fields[axis]);
            if (!Number.isFinite(value) || value === t[axis]) continue;
            updates[axis] = value;
            changed = true;
        }
        if (!changed) return false;
        return this.command(doc, 'Transform ' + node.name, () => {
            Object.assign(t, updates);
        }, key || 'transform:' + id);
    },

    /** Replace payload fields (model path, colour, clip…). Same partial-update rule. */
    setPayload(doc, id, fields, key) {
        const node = this.node(doc, id);
        if (!node) return false;
        const before = JSON.stringify(node.payload);
        const next = Object.assign({}, node.payload, fields);
        if (JSON.stringify(next) === before) return false;
        return this.command(doc, 'Edit ' + node.name, () => {
            Object.assign(node.payload, fields);
        }, key || 'payload:' + id);
    },

    /**
     * Reorder a node among its siblings. Each node carries an explicit `order`, so the tree's
     * draw order does not depend on JavaScript object key order — which would make a saved file
     * depend on how it was written and break a round-trip.
     */
    moveChild(doc, id, delta) {
        const node = this.node(doc, id);
        if (!node || !node.parentId) return false;
        const siblings = this.children(doc, node.parentId);
        const from = siblings.findIndex(n => n.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= siblings.length) return false;
        const reordered = siblings.slice();
        reordered.splice(from, 1);
        reordered.splice(to, 0, node);
        return this.command(doc, 'Reorder ' + node.name, () => {
            reordered.forEach((n, i) => { n.order = i; });
        });
    },

    // --- serialisation --------------------------------------------------------

    /** The document as the JSON that is written to a scene file. */
    toJSON(doc) {
        return {
            version: 1,
            name: doc.name,
            rootId: doc.rootId,
            nodes: doc.nodes,
        };
    },

    /**
     * Rebuild a document from a parsed scene file. Ids are KEPT (references between nodes point
     * at them) and the id counter is advanced past every id seen, so a node added later cannot
     * collide with a loaded one.
     */
    fromJSON(data) {
        if (!data || typeof data !== 'object' || !data.nodes) return null;
        const doc = this.create(data.name || 'Scene');
        doc.nodes = data.nodes;
        doc.rootId = data.rootId && data.nodes[data.rootId] ? data.rootId : Object.keys(data.nodes)[0];
        let maxId = 0;
        for (const key of Object.keys(doc.nodes)) {
            const n = Number(String(key).replace(/^n/, ''));
            if (Number.isFinite(n)) maxId = Math.max(maxId, n);
        }
        this._nextId = maxId + 1;
        doc.revision = 1;
        doc.dirty = false;
        return doc;
    },

    /** Mark the document saved (the panel calls this after a successful write). */
    markSaved(doc, source) {
        if (!doc) return;
        doc.dirty = false;
        if (source) doc.source = source;
    },

    /**
     * Build a scene from the kit's Objects.js list, so the editor opens the game's own location
     * as a regular scene document instead of a special case.
     * @param {any[]} objects LOCATION_OBJECTS
     * @param {string} [name]
     */
    fromObjects(objects, name = 'Location') {
        const doc = this.create(name);
        const list = Array.isArray(objects) ? objects : [];
        this.command(doc, 'Load location', () => {
            for (const def of list) {
                if (!def || !def.model) continue;
                const node = this.makeNode('object', {
                    name: String(def.model).split('/').pop() || def.name || 'object',
                    x: def.x, y: def.y, h: def.h,
                    scaleX: Array.isArray(def.scale) ? def.scale[0] : (def.scale != null ? def.scale : 1),
                    scaleY: Array.isArray(def.scale) ? def.scale[1] : (def.scale != null ? def.scale : 1),
                    scaleZ: Array.isArray(def.scale) ? def.scale[2] : (def.scale != null ? def.scale : 1),
                    payload: {
                        model: def.model,
                        kind: def.kind || 'prop',
                        rot: Array.isArray(def.rot) ? def.rot.slice() : [0, 0, 0],
                        clip: def.clip || '',
                        anim: def.anim || null,
                        sourceName: def.name || '',
                    },
                });
                if (Array.isArray(def.rot)) {
                    node.transform.rotX = Number(def.rot[0]) || 0;
                    node.transform.rotY = Number(def.rot[1]) || 0;
                    node.transform.rotZ = Number(def.rot[2]) || 0;
                }
                node.parentId = doc.rootId;
                doc.nodes[node.id] = node;
            }
        });
        // Loading is not an edit the user made: the document starts clean.
        doc.dirty = false;
        return doc;
    },

    /**
     * The Objects.js-shaped array this document describes, so "Save to Objects.js" is a
     * projection of the scene rather than a separate data path.
     * @returns {any[]}
     */
    toObjects(doc) {
        const out = [];
        for (const node of this.walk(doc, doc.rootId)) {
            if (node.type !== 'object') continue;
            const w = this.worldTransform(doc, node.id);
            out.push({
                name: node.payload.sourceName || node.name,
                model: node.payload.model,
                kind: node.payload.kind || 'prop',
                x: Math.round(w.x * 100) / 100,
                y: Math.round(w.y * 100) / 100,
                h: Math.round(w.h * 100) / 100,
                // Rotation is kept per node: a group's rotation is baked into the world position
                // above, but Objects.js has no hierarchy to express a parent's turn.
                rot: node.payload.rot && node.payload.rot.length === 3
                    ? node.payload.rot.slice()
                    : [node.transform.rotX, node.transform.rotY, node.transform.rotZ],
                scale: [w.scaleX, w.scaleY, w.scaleZ],
                clip: node.payload.clip || undefined,
                anim: node.payload.anim || undefined,
            });
        }
        return out;
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = SceneDoc;
if (typeof window !== 'undefined') /** @type {any} */ (window).SceneDoc = SceneDoc;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).SceneDoc = SceneDoc;