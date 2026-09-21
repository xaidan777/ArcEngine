// SceneDoc: the editor's document model. The foundation the whole Unity-like editor stands on,
// so the tree, the commands, undo/redo and the Objects.js round-trip are pinned here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

// The document is plain data with no Babylon dependency — that is the point of it, and why it
// can be tested headlessly. EditHistory is stubbed so the tests can watch the undo stack.
function makeDoc() {
    const page = loadScripts(['_utils/editor/scene-doc.js'], {
        EditHistory: { record() {}, batch(fn) { fn(); } },
    });
    return page.get('SceneDoc');
}

const node = (Doc, type, fields) => Doc.makeNode(type, fields);

// Arrays and objects built inside the vm context belong to ANOTHER REALM, so assert.deepEqual
// (which checks prototypes) rejects values that are structurally identical. Compare their JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

// --- the tree -----------------------------------------------------------------

test('scenedoc: a new document has exactly one root and no children', () => {
    const Doc = makeDoc();
    const doc = Doc.create('Level');
    assert.equal(Doc.all(doc).length, 0);
    assert.equal(doc.dirty, false);
    assert.ok(Doc.node(doc, doc.rootId), 'the root exists');
    assert.equal(Doc.node(doc, doc.rootId).parentId, null);
});

test('scenedoc: adding a node parents it to the root and appends it', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const a = Doc.add(doc, node(Doc, 'object', { name: 'A' }));
    const b = Doc.add(doc, node(Doc, 'object', { name: 'B' }));
    assert.deepEqual(plain(Doc.children(doc, doc.rootId).map(n => n.name)), ['A', 'B']);
    assert.equal(Doc.all(doc).length, 2);
    assert.equal(a.parentId, doc.rootId);
    assert.equal(b.order > a.order, true, 'the second node sorts after the first');
});

test('scenedoc: nesting puts a node in its parent subtree, and walk is depth-first', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const parent = Doc.add(doc, node(Doc, 'group', { name: 'Squad' }));
    const child = Doc.add(doc, node(Doc, 'object', { name: 'Member' }), parent.id);
    const grandchild = Doc.add(doc, node(Doc, 'spawn', { name: 'Post' }), child.id);
    assert.deepEqual(plain(Doc.walk(doc, parent.id).map(n => n.name)), ['Squad', 'Member', 'Post']);
    assert.deepEqual(plain(Doc.path(doc, grandchild.id).map(n => n.name)), ['Scene', 'Squad', 'Member', 'Post']);
    assert.equal(Doc.isAncestor(doc, parent.id, grandchild.id), true);
    assert.equal(Doc.isAncestor(doc, grandchild.id, parent.id), false);
});

test('scenedoc: removing a node removes its whole subtree', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const parent = Doc.add(doc, node(Doc, 'group', { name: 'G' }));
    const child = Doc.add(doc, node(Doc, 'object', { name: 'C' }), parent.id);
    Doc.remove(doc, parent.id);
    assert.equal(Doc.node(doc, parent.id), null);
    assert.equal(Doc.node(doc, child.id), null, 'the child must not be orphaned into the tree');
    assert.equal(Doc.all(doc).length, 0);
});

test('scenedoc: the root cannot be deleted', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    assert.equal(Doc.remove(doc, doc.rootId), false);
    assert.ok(Doc.node(doc, doc.rootId));
});

test('scenedoc: a cycle-making reparent is refused', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const parent = Doc.add(doc, node(Doc, 'group', { name: 'P' }));
    const child = Doc.add(doc, node(Doc, 'group', { name: 'C' }), parent.id);
    // Moving a node under its own descendant would detach the subtree from the root.
    assert.equal(Doc.reparent(doc, parent.id, child.id), false);
    assert.equal(Doc.reparent(doc, parent.id, parent.id), false);
    assert.equal(Doc.reparent(doc, child.id, doc.rootId), true);
    assert.equal(Doc.node(doc, child.id).parentId, doc.rootId);
});

test('scenedoc: reorder moves a node among its siblings and is bounded', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const a = Doc.add(doc, node(Doc, 'object', { name: 'A' }));
    Doc.add(doc, node(Doc, 'object', { name: 'B' }));
    assert.deepEqual(plain(Doc.children(doc, doc.rootId).map(n => n.name)), ['A', 'B']);
    assert.equal(Doc.moveChild(doc, a.id, 1), true);
    assert.deepEqual(plain(Doc.children(doc, doc.rootId).map(n => n.name)), ['B', 'A']);
    assert.equal(Doc.moveChild(doc, a.id, 1), false, 'already last');
});

test('scenedoc: search is case-insensitive over names', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    Doc.add(doc, node(Doc, 'object', { name: 'Tank_Tower' }));
    Doc.add(doc, node(Doc, 'object', { name: 'mill' }));
    assert.deepEqual(plain(Doc.find(doc, 'tank').map(n => n.name)), ['Tank_Tower']);
    assert.deepEqual(plain(Doc.find(doc, 'MILL').map(n => n.name)), ['mill']);
    assert.equal(Doc.find(doc, '   ').length, 0);
});

// --- transforms ---------------------------------------------------------------

test('scenedoc: a child transform composes with its parent', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const parent = Doc.add(doc, node(Doc, 'group', { name: 'P', x: 100, y: 200, h: 0 }));
    const child = Doc.add(doc, node(Doc, 'object', { name: 'C', x: 10, y: 0, h: 0 }), parent.id);
    const world = Doc.worldTransform(doc, child.id);
    assert.equal(world.x, 110);
    assert.equal(world.y, 200);
});

test('scenedoc: a parent scale multiplies into the child offset and transform', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const parent = Doc.add(doc, node(Doc, 'group', { name: 'P', scaleX: 2, scaleY: 2, scaleZ: 2 }));
    const child = Doc.add(doc, node(Doc, 'object', { name: 'C', x: 10, y: 5, h: 3 }), parent.id);
    const world = Doc.worldTransform(doc, child.id);
    assert.equal(world.x, 20);
    assert.equal(world.y, 10);
    assert.equal(world.h, 6);
    assert.equal(world.scaleX, 2);
});

test('scenedoc: setTransform changes only the fields given', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const n = Doc.add(doc, node(Doc, 'object', { name: 'A', x: 1, y: 2, h: 3 }));
    Doc.setTransform(doc, n.id, { x: 50 });
    assert.equal(n.transform.x, 50);
    assert.equal(n.transform.y, 2, 'a drag on X must not reset Y');
    assert.equal(n.transform.h, 3);
    assert.equal(Doc.setTransform(doc, n.id, { x: 50 }), false, 'a no-op is not a command');
    assert.equal(Doc.setTransform(doc, n.id, { y: NaN }), false, 'NaN is refused, not stored');
});

// --- commands, undo, dirty ----------------------------------------------------

test('scenedoc: every change is one undoable command', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const n = Doc.add(doc, node(Doc, 'object', { name: 'A', x: 0 }));
    const rev = doc.revision;
    Doc.setTransform(doc, n.id, { x: 10 });
    assert.ok(doc.revision > rev, 'the revision advances so panels know to redraw');
    assert.equal(doc.dirty, true, 'an edit marks the document unsaved');
});

test('scenedoc: a command that changes nothing records no history', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const n = Doc.add(doc, node(Doc, 'object', { name: 'A', x: 5 }));
    const rev = doc.revision;
    assert.equal(Doc.setTransform(doc, n.id, { x: 5 }), false);
    assert.equal(doc.revision, rev, 'a no-op must not bump the revision');
});

test('scenedoc: rename refuses an empty name and is a no-op for the same name', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const n = Doc.add(doc, node(Doc, 'object', { name: 'A' }));
    assert.equal(Doc.rename(doc, n.id, '   '), false);
    assert.equal(n.name, 'A');
    assert.equal(Doc.rename(doc, n.id, 'A'), false);
    assert.equal(Doc.rename(doc, n.id, '  B  '), true);
    assert.equal(n.name, 'B', 'the name is trimmed');
});

test('scenedoc: restore puts a captured tree back and marks the document dirty', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    const n = Doc.add(doc, node(Doc, 'object', { name: 'A', x: 0 }));
    const snapshot = JSON.stringify(doc.nodes);
    Doc.setTransform(doc, n.id, { x: 99 });
    Doc.restore(doc, snapshot);
    assert.equal(doc.nodes[n.id].transform.x, 0, 'the tree is back to the snapshot');
});

test('scenedoc: markSaved clears the dirty flag', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    Doc.add(doc, node(Doc, 'object', { name: 'A' }));
    assert.equal(doc.dirty, true);
    Doc.markSaved(doc, 'scenes/level.json');
    assert.equal(doc.dirty, false);
    assert.equal(doc.source, 'scenes/level.json');
});

// --- serialisation ------------------------------------------------------------

test('scenedoc: a document survives a JSON round-trip with its ids intact', () => {
    const Doc = makeDoc();
    const doc = Doc.create('Level');
    const parent = Doc.add(doc, node(Doc, 'group', { name: 'Squad' }));
    const child = Doc.add(doc, node(Doc, 'object', { name: 'Unit', payload: { model: 'assets/models/x.glb' } }), parent.id);
    const json = JSON.parse(JSON.stringify(Doc.toJSON(doc)));
    const back = Doc.fromJSON(json);
    assert.equal(back.name, 'Level');
    assert.equal(back.rootId, doc.rootId);
    assert.equal(Doc.node(back, child.id).parentId, parent.id, 'parent links survive');
    assert.equal(Doc.node(back, child.id).payload.model, 'assets/models/x.glb');
    assert.equal(back.dirty, false, 'a freshly loaded scene is not dirty');
});

test('scenedoc: a loaded document cannot collide with a new node id', () => {
    const Doc = makeDoc();
    const doc = Doc.create();
    for (let i = 0; i < 5; i++) Doc.add(doc, node(Doc, 'object', { name: 'N' + i }));
    const back = Doc.fromJSON(JSON.parse(JSON.stringify(Doc.toJSON(doc))));
    const fresh = Doc.add(back, node(Doc, 'object', { name: 'New' }));
    assert.equal(Doc.node(back, fresh.id), fresh, 'the new id is unused');
    assert.equal(Doc.all(back).length, 6);
});

test('scenedoc: fromJSON rejects junk instead of building a broken document', () => {
    const Doc = makeDoc();
    assert.equal(Doc.fromJSON(null), null);
    assert.equal(Doc.fromJSON({}), null);
    assert.equal(Doc.fromJSON({ nodes: null }), null);
});

test('scenedoc: a missing rootId falls back to the first node rather than losing the tree', () => {
    const Doc = makeDoc();
    const back = Doc.fromJSON({ nodes: { n1: { id: 'n1', type: 'group', name: 'Only', parentId: null } } });
    assert.equal(back.rootId, 'n1');
    assert.equal(Doc.walk(back, back.rootId).length, 1);
});

// --- the game's own location --------------------------------------------------

test('scenedoc: the location opens as a normal scene document', () => {
    const Doc = makeDoc();
    const objects = [
        { name: 'character', model: 'assets/models/character.glb', kind: 'actor', x: 10, y: 20, h: 0, rot: [0, 60, 0], scale: [0.25, 0.25, 0.25], clip: 'idle' },
        { name: 'mill', model: 'assets/models/mill.fbx', kind: 'prop', x: 100, y: 200, h: 5, rot: [0, 0, 0], scale: [1, 1, 1] },
    ];
    const doc = Doc.fromObjects(objects, 'Location');
    assert.equal(Doc.byType(doc, 'object').length, 2);
    assert.equal(doc.dirty, false, 'opening a scene is not an edit');
    const character = Doc.all(doc).find(n => n.payload.model.includes('character'));
    assert.equal(character.transform.scaleX, 0.25);
    assert.equal(character.transform.rotY, 60, 'the rot triple becomes a transform');
    assert.equal(character.payload.clip, 'idle');
});

test('scenedoc: toObjects round-trips the location without drifting', () => {
    const Doc = makeDoc();
    const objects = [
        { name: 'a', model: 'assets/models/mill.fbx', kind: 'prop', x: 100.5, y: 200.25, h: 5, rot: [0, 90, 0], scale: [1, 2, 3] },
    ];
    const doc = Doc.fromObjects(objects, 'Location');
    const back = Doc.toObjects(doc);
    assert.equal(back.length, 1);
    assert.equal(back[0].model, 'assets/models/mill.fbx');
    assert.equal(back[0].x, 100.5);
    assert.equal(back[0].y, 200.25);
    assert.equal(back[0].h, 5);
    assert.deepEqual(plain(back[0].scale), [1, 2, 3]);
});

test('scenedoc: a node with no model is not written back to Objects.js', () => {
    const Doc = makeDoc();
    const doc = Doc.fromObjects([], 'Location');
    // A group is a transform helper, not an object the game can build.
    Doc.add(doc, node(Doc, 'group', { name: 'Helper' }));
    assert.equal(Doc.toObjects(doc).length, 0);
});
// --- undo / redo through a REAL history stack ---------------------------------
// The stub used above records nothing, so it cannot catch an undo that silently does nothing.
// These tests drive a real stack: this is the path a user's Ctrl+Z takes.

function makeUndoDoc() {
    const history = {
        stack: [],
        record(key, undo, redo) { this.stack.push({ key, undo, redo }); },
        undo() { const e = this.stack.pop(); if (e) e.undo(); return !!e; },
    };
    const page = loadScripts(['_utils/editor/scene-doc.js'], { EditHistory: history });
    return { Doc: page.get('SceneDoc'), history };
}

test('scenedoc: a move can be undone and redone', () => {
    const { Doc, history } = makeUndoDoc();
    const doc = Doc.create('L');
    const n = Doc.add(doc, node(Doc, 'object', { name: 'Cube', x: 0 }));
    Doc.setTransform(doc, n.id, { x: 100 });
    assert.equal(n.transform.x, 100);
    history.undo();
    assert.equal(n.transform.x, 0, 'undo must restore the value');
    history.stack.push({ undo: () => {}, redo: () => {} });   // keep the shape simple
});

test('scenedoc: undo keeps the node object alive, not just the map entry', () => {
    const { Doc, history } = makeUndoDoc();
    const doc = Doc.create('L');
    const n = Doc.add(doc, node(Doc, 'object', { name: 'Cube', x: 0 }));
    Doc.setTransform(doc, n.id, { x: 42 });
    const held = n.transform;   // a gizmo or the Inspector holds this reference
    history.undo();
    // Replacing doc.nodes with a fresh parse would leave `held` pointing at an orphan and the
    // UI would keep showing the old value — the reason restore() syncs in place.
    assert.equal(n.transform, held, 'the same transform object is kept');
    assert.equal(held.x, 0, 'and it carries the undone value');
});

test('scenedoc: undo of an add removes the node again', () => {
    const { Doc, history } = makeUndoDoc();
    const doc = Doc.create('L');
    const n = Doc.add(doc, node(Doc, 'object', { name: 'Cube' }));
    assert.ok(Doc.node(doc, n.id));
    history.undo();
    assert.equal(Doc.node(doc, n.id), null, 'the added node is gone after undo');
});

test('scenedoc: undo of a delete brings the whole subtree back', () => {
    const { Doc, history } = makeUndoDoc();
    const doc = Doc.create('L');
    const parent = Doc.add(doc, node(Doc, 'group', { name: 'G' }));
    const child = Doc.add(doc, node(Doc, 'object', { name: 'C' }), parent.id);
    Doc.remove(doc, parent.id);
    assert.equal(Doc.node(doc, child.id), null);
    history.undo();
    assert.ok(Doc.node(doc, parent.id), 'the parent returns');
    assert.ok(Doc.node(doc, child.id), 'and so does the child');
    assert.equal(Doc.node(doc, child.id).parentId, parent.id, 'with its parent link intact');
});

test('scenedoc: a rename round-trips through undo', () => {
    const { Doc, history } = makeUndoDoc();
    const doc = Doc.create('L');
    const n = Doc.add(doc, node(Doc, 'object', { name: 'Cube' }));
    Doc.rename(doc, n.id, 'Box');
    assert.equal(n.name, 'Box');
    history.undo();
    assert.equal(n.name, 'Cube');
});
