// The editor's Hierarchy pane and menu bar: the PURE half of both modules.
//
// Neither panel can be driven through a DOM here (node:vm has none, and the kit has no jsdom):
// that is exactly why the logic lives in plain functions — flatten / dropTarget / applyDrop /
// buildModel / commandFor — and the DOM part is a thin layer over them. The tests below pin the
// tree drawing, the drag-and-drop rules (no cycles, the exact insertion index), the context-menu
// commands, and the menu structure + shortcuts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

// Arrays built inside the vm belong to ANOTHER REALM, so assert.deepEqual (which compares
// prototypes) rejects values that are structurally identical. Compare their JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

// EditHistory with the contract scene-doc.js relies on: record() per command, batch() collapses
// several commands into ONE undo step. The real history.js also merges by key and keeps a limit —
// those belong to tests/history, not here; what matters is the entries the panels produce.
function makeHistory() {
    const history = {
        undoStack: [],
        redoStack: [],
        _batch: null,
        record(key, undo, redo) {
            if (this._batch) { this._batch.push({ undo, redo }); return; }
            this.undoStack.push({ key, undo, redo, time: 0 });
            this.redoStack = [];
        },
        batch(fn) {
            // A batch inside a batch joins it — the same rule history.js follows, and what makes a
            // duplicate (add + rename + move) a single step.
            if (this._batch) { fn(); return; }
            const list = this._batch = [];
            try { fn(); } finally { this._batch = null; }
            if (!list.length) return;
            this.undoStack.push({
                key: null, time: 0,
                undo: () => { for (let i = list.length - 1; i >= 0; i--) list[i].undo(); },
                redo: () => { for (const e of list) e.redo(); },
            });
            this.redoStack = [];
        },
        undo() {
            const entry = this.undoStack.pop();
            if (!entry) return false;
            entry.undo();
            this.redoStack.push(entry);
            return true;
        },
        redo() {
            const entry = this.redoStack.pop();
            if (!entry) return false;
            entry.redo();
            this.undoStack.push(entry);
            return true;
        },
    };
    return history;
}

// The editor modules are classic scripts writing into the page; the two page pieces they use are
// CustomEvent and window.dispatchEvent (the panels announce changes instead of calling each other).
function makePage(extraGlobals = {}) {
    const history = makeHistory();
    const events = [];
    class FakeCustomEvent {
        constructor(type, opts) {
            this.type = type;
            this.detail = (opts || {}).detail;
        }
    }
    const win = {
        dispatchEvent: (e) => { events.push(e); return true; },
        addEventListener() {},
        innerWidth: 1920,
        innerHeight: 1080,
    };
    const page = loadScripts(
        ['_utils/editor/scene-doc.js', '_utils/editor/hierarchy-panel.js', '_utils/editor/menu-bar.js'],
        Object.assign({ EditHistory: history, CustomEvent: FakeCustomEvent, window: win }, extraGlobals),
    );
    return { history, events, Doc: page.get('SceneDoc'), Panel: page.get('HierarchyPanel'), Bar: page.get('MenuBar') };
}

// Level
// ├── Squad
// │   └── Unit
// │       └── Post
// └── Mill
function makeTree(Doc) {
    const doc = Doc.create('Level');
    const squad = Doc.add(doc, Doc.makeNode('group', { name: 'Squad' }));
    const unit = Doc.add(doc, Doc.makeNode('object', { name: 'Unit' }), squad.id);
    const post = Doc.add(doc, Doc.makeNode('spawn', { name: 'Post' }), unit.id);
    const mill = Doc.add(doc, Doc.makeNode('object', { name: 'Mill' }));
    return { doc, squad, unit, post, mill };
}

const names = (rows) => plain(rows.map(r => r.name));
const ids = (nodes) => plain(nodes.map(n => n.id));

// --- HierarchyPanel.flatten ----------------------------------------------------

test('editor-hierarchy: flatten draws the tree depth-first with depth, children and visibility', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad, unit, post, mill } = makeTree(Doc);
    const rows = Panel.flatten(doc);
    assert.deepEqual(names(rows), ['Level', 'Squad', 'Unit', 'Post', 'Mill']);
    assert.deepEqual(plain(rows.map(r => r.depth)), [0, 1, 2, 3, 1]);
    assert.deepEqual(ids(rows).slice(1), [squad.id, unit.id, post.id, mill.id]);
    assert.equal(rows[0].hasChildren, true);
    assert.equal(rows[1].hasChildren, true);
    assert.equal(rows[3].hasChildren, false, 'a leaf gets no twist triangle');
    assert.deepEqual(plain(rows.map(r => r.visible)), [true, true, true, true, true]);
    assert.deepEqual(plain(rows.map(r => r.expanded)), [true, true, true, true, true]);
    // The scene name is the root row's name — the panel shows it like any other node.
    assert.equal(rows[0].name, 'Level');
});

test('editor-hierarchy: flatten skips a subtree when an ancestor is collapsed', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad } = makeTree(Doc);
    assert.equal(Panel.toggleExpanded(doc, squad.id, false), true);
    assert.deepEqual(names(Panel.flatten(doc)), ['Level', 'Squad', 'Mill']);
    // The collapsed row itself stays on screen and says it is closed.
    const row = Panel.flatten(doc).find(r => r.id === squad.id);
    assert.equal(row.expanded, false);
    assert.equal(Panel.toggleExpanded(doc, squad.id, true), true);
    assert.deepEqual(names(Panel.flatten(doc)), ['Level', 'Squad', 'Unit', 'Post', 'Mill']);
    assert.equal(Panel.toggleExpanded(doc, squad.id, true), false, 'setting the same value changes nothing');
});

test('editor-hierarchy: a node missing the expanded field counts as open', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad } = makeTree(Doc);
    delete squad.expanded;   // an old scene file has no such field
    assert.equal(Panel.flatten(doc).find(r => r.id === squad.id).expanded, true);
    assert.deepEqual(names(Panel.flatten(doc)), ['Level', 'Squad', 'Unit', 'Post', 'Mill']);
});

test('editor-hierarchy: flatten returns nothing without a document', () => {
    const { Panel } = makePage();
    assert.deepEqual(plain(Panel.flatten(null)), []);
    assert.deepEqual(plain(Panel.flatten({})), []);
});

test('editor-hierarchy: search keeps the matches, their ancestors and the real depths', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad } = makeTree(Doc);
    const rows = Panel.flatten(doc, 'unit');
    assert.deepEqual(names(rows), ['Level', 'Squad', 'Unit']);
    assert.deepEqual(plain(rows.map(r => r.depth)), [0, 1, 2], 'a match is drawn where it really sits');
    // A search is an explicit "show me": a collapsed branch must not hide the hit.
    Panel.toggleExpanded(doc, squad.id, false);
    assert.deepEqual(names(Panel.flatten(doc, 'post')), ['Level', 'Squad', 'Unit', 'Post']);
    assert.deepEqual(plain(Panel.flatten(doc, 'nothing-here')), []);
});

test('editor-hierarchy: folding a branch is view state, not an undoable edit', () => {
    const { Doc, Panel, history } = makePage();
    const { doc, squad } = makeTree(Doc);
    const steps = history.undoStack.length;
    const revision = doc.revision;
    doc.dirty = false;
    Panel.toggleExpanded(doc, squad.id, false);
    assert.equal(history.undoStack.length, steps, 'collapsing must not push an undo step');
    assert.equal(doc.revision, revision, 'and must not bump the revision');
    assert.equal(doc.dirty, false, 'and must not mark the scene unsaved');
});

// --- HierarchyPanel.dropTarget -------------------------------------------------

test('editor-hierarchy: dropTarget resolves before/after/inside into a parent and an index', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad, unit, mill } = makeTree(Doc);
    // Inside an empty area / a group — last child.
    assert.deepEqual(plain(Panel.dropTarget(doc, mill.id, squad.id, 'inside')), { ok: true, parentId: squad.id, index: 1 });
    // Off the top edge of a row — a sibling before it, among the target's own siblings.
    assert.deepEqual(plain(Panel.dropTarget(doc, mill.id, squad.id, 'before')), { ok: true, parentId: doc.rootId, index: 0 });
    // The index is an INSERTION index with the dragged node already taken out: dragging Squad
    // after Mill must land at 1, not 2, or the node would drift past its drop mark.
    assert.deepEqual(plain(Panel.dropTarget(doc, squad.id, mill.id, 'after')), { ok: true, parentId: doc.rootId, index: 1 });
    assert.deepEqual(plain(Panel.dropTarget(doc, unit.id, unit.id === squad.id ? mill.id : squad.id, 'inside')).ok, true);
});

test('editor-hierarchy: dropping inside the root is legal, above the root is not', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad, mill } = makeTree(Doc);
    assert.deepEqual(plain(Panel.dropTarget(doc, mill.id, doc.rootId, 'inside')), { ok: true, parentId: doc.rootId, index: 1 });
    assert.equal(Panel.dropTarget(doc, mill.id, doc.rootId, 'before').ok, false);
    assert.equal(Panel.dropTarget(doc, mill.id, doc.rootId, 'after').ok, false);
    assert.equal(Panel.dropTarget(doc, mill.id, doc.rootId, 'before').reason, 'root');
});

test('editor-hierarchy: dropTarget refuses a cycle, the root, a self-drop and junk', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad, unit, post, mill } = makeTree(Doc);
    assert.equal(Panel.dropTarget(doc, squad.id, unit.id, 'inside').reason, 'descendant');
    assert.equal(Panel.dropTarget(doc, squad.id, post.id, 'before').reason, 'descendant');
    assert.equal(Panel.dropTarget(doc, doc.rootId, mill.id, 'inside').reason, 'root');
    assert.equal(Panel.dropTarget(doc, mill.id, mill.id, 'inside').reason, 'self');
    assert.equal(Panel.dropTarget(doc, mill.id, 'nope', 'inside').reason, 'missing');
    assert.equal(Panel.dropTarget(doc, 'nope', mill.id, 'inside').reason, 'missing');
    assert.equal(Panel.dropTarget(null, mill.id, squad.id, 'inside').reason, 'missing');
    assert.equal(Panel.dropTarget(doc, mill.id, squad.id, 'sideways').reason, 'where');
});

// --- HierarchyPanel.applyDrop --------------------------------------------------

test('editor-hierarchy: applyDrop reorders siblings so the visual position matches the drop', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad, mill } = makeTree(Doc);
    assert.equal(Panel.applyDrop(doc, squad.id, mill.id, 'after'), true);
    assert.deepEqual(names(Doc.children(doc, doc.rootId)), ['Mill', 'Squad']);
    assert.deepEqual(plain(Doc.children(doc, doc.rootId).map(n => n.order)), [0, 1], 'orders stay dense');
    // And back to the top.
    assert.equal(Panel.applyDrop(doc, squad.id, mill.id, 'before'), true);
    assert.deepEqual(names(Doc.children(doc, doc.rootId)), ['Squad', 'Mill']);
    assert.deepEqual(plain(Doc.children(doc, doc.rootId).map(n => n.order)), [0, 1]);
});

test('editor-hierarchy: applyDrop reparents into a group and appends it last', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad, unit, mill } = makeTree(Doc);
    assert.equal(Panel.applyDrop(doc, mill.id, squad.id, 'inside'), true);
    assert.equal(mill.parentId, squad.id);
    assert.deepEqual(names(Doc.children(doc, squad.id)), ['Unit', 'Mill']);
    assert.deepEqual(plain(Doc.children(doc, squad.id).map(n => n.order)), [0, 1]);
    // The node left the old parent's list, and its subtree travelled with it.
    assert.deepEqual(names(Doc.children(doc, doc.rootId)), ['Squad']);
    assert.equal(unit.parentId, squad.id);
});

test('editor-hierarchy: applyDrop refuses an illegal drop and changes nothing', () => {
    const { Doc, Panel, history } = makePage();
    const { doc, squad, post } = makeTree(Doc);
    const before = JSON.stringify(doc.nodes);
    const steps = history.undoStack.length;
    assert.equal(Panel.applyDrop(doc, squad.id, post.id, 'inside'), false, 'a node cannot go into its own child');
    assert.equal(JSON.stringify(doc.nodes), before, 'the tree is untouched');
    assert.equal(history.undoStack.length, steps, 'and nothing was recorded');
    assert.equal(Panel.applyDrop(null, squad.id, post.id, 'inside'), false);
});

test('editor-hierarchy: a cross-parent drop is one undo step and comes back whole', () => {
    const { Doc, Panel, history } = makePage();
    const { doc, squad, mill } = makeTree(Doc);
    const steps = history.undoStack.length;
    Panel.applyDrop(doc, mill.id, squad.id, 'inside');
    assert.equal(history.undoStack.length, steps + 1, 'reparent + reorder are one gesture, so one step');
    assert.equal(mill.parentId, squad.id);
    history.undo();
    assert.equal(mill.parentId, doc.rootId, 'undo restores the parent');
    assert.deepEqual(names(Doc.children(doc, doc.rootId)), ['Squad', 'Mill'], 'and the sibling order');
    history.redo();
    assert.equal(mill.parentId, squad.id, 'redo puts the drop back');
});

test('editor-hierarchy: whereFromPointer splits a row into before / inside / after', () => {
    const { Panel } = makePage();
    const row = { getBoundingClientRect: () => ({ top: 100, height: 20 }) };
    assert.equal(Panel.whereFromPointer(row, { clientY: 101 }), 'before');
    assert.equal(Panel.whereFromPointer(row, { clientY: 104.9 }), 'before');
    assert.equal(Panel.whereFromPointer(row, { clientY: 110 }), 'inside');
    assert.equal(Panel.whereFromPointer(row, { clientY: 119 }), 'after');
    // A row that has not been laid out yet must not produce NaN: the middle is the safe guess.
    assert.equal(Panel.whereFromPointer({ getBoundingClientRect: () => ({ top: 0, height: 0 }) }, { clientY: 5 }), 'inside');
});

test('editor-hierarchy: the redrawn tree matches what the drop asked for', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad, unit, mill } = makeTree(Doc);
    // Mill under Squad: it becomes Squad's last child, after Unit AND its child Post, because a
    // subtree is walked as a whole — "last child" is a position among siblings, not a line.
    Panel.applyDrop(doc, mill.id, squad.id, 'inside');
    assert.deepEqual(names(Panel.flatten(doc)), ['Level', 'Squad', 'Unit', 'Post', 'Mill']);
    // Unit after Mill — the insertion index must not be off by one in either direction.
    Panel.applyDrop(doc, unit.id, mill.id, 'after');
    assert.deepEqual(names(Panel.flatten(doc)), ['Level', 'Squad', 'Mill', 'Unit', 'Post']);
    Panel.applyDrop(doc, unit.id, mill.id, 'before');
    assert.deepEqual(names(Panel.flatten(doc)), ['Level', 'Squad', 'Unit', 'Post', 'Mill']);
});

test('editor-hierarchy: a leaf adopts a child dropped inside it', () => {
    const { Doc, Panel } = makePage();
    const { doc, unit, mill } = makeTree(Doc);
    assert.equal(Panel.dropTarget(doc, mill.id, unit.id, 'inside').ok, true, 'a childless node can still adopt');
    Panel.applyDrop(doc, mill.id, unit.id, 'inside');
    assert.equal(mill.parentId, unit.id);
    assert.deepEqual(names(Panel.flatten(doc)), ['Level', 'Squad', 'Unit', 'Post', 'Mill']);
    // Post is still under Unit and now comes before the newcomer: "inside" always appends.
    assert.deepEqual(plain(Doc.children(doc, unit.id).map(n => n.name)), ['Post', 'Mill']);
});

// --- HierarchyPanel: context-menu commands, names, guards ----------------------

test('editor-hierarchy: duplicateNode copies the subtree under unique names in one step', () => {
    const { Doc, Panel, history } = makePage();
    const { doc, squad } = makeTree(Doc);
    const steps = history.undoStack.length;
    Panel.doc = doc;
    const copyId = Panel.duplicateNode(doc, squad.id);
    assert.ok(copyId && copyId !== squad.id);
    assert.equal(history.undoStack.length, steps + 1, 'a subtree copy is one undo step');
    // Right after the original, as a sibling — Unity's placement. Only the copy's ROOT is renamed:
    // the subtree keeps its names, so the shape of the copy stays recognisable and a child is not
    // renamed twice when its own subtree is copied later.
    assert.deepEqual(names(Doc.children(doc, doc.rootId)), ['Squad', 'Squad Copy', 'Mill']);
    assert.deepEqual(names(Doc.children(doc, copyId)), ['Unit']);
    assert.deepEqual(names(Doc.children(doc, Doc.children(doc, copyId)[0].id)), ['Post']);
    assert.equal(Doc.node(doc, copyId).parentId, doc.rootId);
    // The copy is a real copy: its own transform and payload objects.
    assert.notEqual(Doc.node(doc, copyId).transform, squad.transform);
    assert.notEqual(Doc.node(doc, copyId).payload, squad.payload);
    history.undo();
    assert.equal(Doc.node(doc, copyId), null, 'undo removes the whole copy');
});

test('editor-hierarchy: a duplicate never collides with an existing name', () => {
    const { Doc, Panel } = makePage();
    const { doc } = makeTree(Doc);
    assert.equal(Panel.copyName(doc, 'Squad'), 'Squad Copy');
    Doc.add(doc, Doc.makeNode('group', { name: 'Squad Copy' }));
    assert.equal(Panel.copyName(doc, 'Squad'), 'Squad Copy 2');
    assert.equal(Panel.copyName(doc, 'Squad Copy'), 'Squad Copy 2', 'copying a copy does not stack suffixes');
    assert.equal(Panel.uniqueName(doc, 'Empty'), 'Empty');
    Doc.add(doc, Doc.makeNode('group', { name: 'Empty' }));
    assert.equal(Panel.uniqueName(doc, 'Empty'), 'Empty 2');
});

test('editor-hierarchy: the root cannot be duplicated or deleted', () => {
    const { Doc, Panel } = makePage();
    const { doc } = makeTree(Doc);
    Panel.doc = doc;
    assert.equal(Panel.duplicateNode(doc, doc.rootId), null);
    assert.equal(Panel.duplicateNode(doc, null), null);
    Panel.selectedId = doc.rootId;
    assert.equal(Panel.deleteSelected(), false);
    assert.ok(Doc.node(doc, doc.rootId));
});

test('editor-hierarchy: deleteSelected removes the subtree and clears the selection', () => {
    const { Doc, Panel, events } = makePage();
    const { doc, unit, post } = makeTree(Doc);
    Panel.doc = doc;
    const selected = [];
    Panel.onSelect = (id) => selected.push(id);
    Panel.select(unit.id);
    assert.equal(Panel.deleteSelected(), true);
    assert.equal(Doc.node(doc, unit.id), null);
    assert.equal(Doc.node(doc, post.id), null, 'the children go with it');
    assert.deepEqual(names(Doc.children(doc, doc.rootId)), ['Squad', 'Mill']);
    assert.equal(Panel.selectedId, null);
    assert.deepEqual(selected, [unit.id, null]);
    assert.deepEqual(plain(events.map(e => e.type)), ['scene-changed']);
});

test('editor-hierarchy: createNode adds a group under the given parent and selects it', () => {
    const { Doc, Panel } = makePage();
    const { doc, squad } = makeTree(Doc);
    Panel.doc = doc;
    const selected = [];
    Panel.onSelect = (id) => selected.push(id);
    const id = Panel.createNode('group', squad.id);
    assert.equal(Doc.node(doc, id).type, 'group');
    assert.equal(Doc.node(doc, id).parentId, squad.id);
    assert.equal(Doc.node(doc, id).name, 'Empty');
    assert.deepEqual(selected, [id]);
    const second = Panel.createNode('group', squad.id);
    assert.equal(Doc.node(doc, second).name, 'Empty 2');
    // No parent given (or an unknown one) — the root, never an orphan.
    assert.equal(Doc.node(doc, Panel.createNode('group', 'nope')).parentId, doc.rootId);
});

test('editor-hierarchy: selection ignores an id that is not in the document', () => {
    const { Doc, Panel } = makePage();
    const { doc } = makeTree(Doc);
    Panel.doc = doc;
    Panel.select('ghost');
    assert.equal(Panel.selectedId, null);
    Panel.select(null);
    assert.equal(Panel.selectedId, null);
});

test('editor-hierarchy: isTyping guards the hotkeys from fields', () => {
    const { Panel } = makePage();
    assert.equal(Panel.isTyping({ tagName: 'INPUT' }), true);
    assert.equal(Panel.isTyping({ tagName: 'textarea' }), true);
    assert.equal(Panel.isTyping({ tagName: 'SELECT' }), true);
    assert.equal(Panel.isTyping({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(Panel.isTyping({ tagName: 'DIV' }), false);
    assert.equal(Panel.isTyping({ tagName: 'CANVAS' }), false);
    assert.equal(Panel.isTyping(null), false);
});

// --- MenuBar.buildModel --------------------------------------------------------

test('editor-menu: buildModel describes the six menus with both languages', () => {
    const { Bar } = makePage();
    const model = Bar.buildModel();
    assert.deepEqual(plain(model.map(g => g.id)), ['file', 'edit', 'scene', 'gameobject', 'window', 'help']);
    assert.deepEqual(plain(model.map(g => g.label)),
        ['File', 'Edit', 'Scene', 'GameObject', 'Window', 'Help']);
    for (const group of model) {
        assert.ok(group.items.length > 0, group.id + ' has no items');
        assert.match(group.labelRu, /[\u0400-\u04FF]/, group.id + ' has no Russian label');
        for (const item of group.items) {
            assert.ok(item.id.startsWith(group.id + '.'), item.id + ' is not namespaced by its menu');
            assert.ok(item.label && item.labelRu, item.id + ' needs both labels');
            assert.match(item.labelRu, /[\u0400-\u04FF]/, item.id + ' is not translated');
        }
    }
});

test('editor-menu: every required command is present', () => {
    const { Bar } = makePage();
    const required = [
        'file.new', 'file.open', 'file.save', 'file.saveAs', 'file.exportObjects', 'file.recent',
        'edit.undo', 'edit.redo', 'edit.duplicate', 'edit.delete', 'edit.selectAll',
        'scene.addEmpty', 'scene.addFromLocation', 'scene.toggleGrid', 'scene.frameSelected', 'scene.snap',
        'gameobject.empty', 'gameobject.object', 'gameobject.light', 'gameobject.spawn',
        'window.hierarchy', 'window.inspector', 'window.project', 'window.console', 'window.modelEditor', 'window.rig',
        'help.shortcuts',
    ];
    for (const id of required) assert.ok(Bar.item(id), 'missing menu item ' + id);
    // The four GameObject items are exactly the SceneDoc node types (config is a Constants group,
    // not something a user drops into the scene).
    assert.deepEqual(
        plain(Bar.group('gameobject').items.map(i => i.id)),
        ['gameobject.empty', 'gameobject.object', 'gameobject.light', 'gameobject.spawn']);
});

test('editor-menu: item ids are unique, so the parent can route on them', () => {
    const { Bar } = makePage();
    const all = Bar.allItems().map(i => i.id);
    assert.equal(new Set(all).size, all.length, 'a duplicate id would make onCommand ambiguous');
    assert.ok(all.length > 20);
});

test('editor-menu: the shortcuts shown are the ones the bar actually handles', () => {
    const { Bar } = makePage();
    const list = Bar.shortcutList();
    assert.ok(list.length >= 8);
    for (const row of list) {
        assert.equal(row.length, 4, 'id, EN, RU, shortcut');
        assert.ok(Bar.item(row[0]), 'the dialog lists an item that does not exist: ' + row[0]);
        assert.match(row[2], /[\u0400-\u04FF]/);
    }
    // Every shortcut with a "Ctrl+" hint has a keyboard mapping behind it.
    for (const id of ['edit.undo', 'edit.redo', 'edit.duplicate', 'edit.selectAll']) {
        assert.ok(Bar.item(id).shortcut, id + ' must show its shortcut');
    }
    assert.equal(Bar.item('scene.frameSelected').shortcut, 'F');
    assert.equal(Bar.item('file.save').shortcut, 'Ctrl+S');
});

// --- MenuBar.commandFor / isEnabled / run --------------------------------------

// A KeyboardEvent stand-in: the mapping reads code/key plus the modifier flags and nothing else.
const key = (code, opts = {}) => Object.assign({ code, key: code.replace(/^(Key|Digit)/, '').toLowerCase() }, opts);

test('editor-menu: commandFor maps every shortcut and ignores everything else', () => {
    const { Bar } = makePage();
    assert.equal(Bar.commandFor(key('KeyZ', { ctrlKey: true })), 'edit.undo');
    assert.equal(Bar.commandFor(key('KeyZ', { ctrlKey: true, shiftKey: true })), 'edit.redo');
    assert.equal(Bar.commandFor(key('KeyD', { ctrlKey: true })), 'edit.duplicate');
    assert.equal(Bar.commandFor(key('KeyA', { ctrlKey: true })), 'edit.selectAll');
    assert.equal(Bar.commandFor(key('Delete')), 'edit.delete');
    assert.equal(Bar.commandFor(key('KeyF')), 'scene.frameSelected');
    // Ctrl+S belongs to the Inspector: two savers on one key would fight.
    assert.equal(Bar.commandFor(key('KeyS', { ctrlKey: true })), null);
    assert.equal(Bar.commandFor(key('KeyD')), null, 'D without Ctrl is a camera key');
    assert.equal(Bar.commandFor(key('KeyF', { ctrlKey: true })), null);
    assert.equal(Bar.commandFor(key('Escape')), null);
    assert.equal(Bar.commandFor(null), null);
});

test('editor-menu: Ctrl+Z inside a name field never reaches the scene', () => {
    // Two pages: one whose focus sits in a text field, one whose focus sits on the canvas.
    const typing = makePage({ document: { activeElement: { tagName: 'INPUT', type: 'text' } } });
    const view = makePage({ document: { activeElement: { tagName: 'CANVAS' } } });
    for (const [page, shouldRun] of [[typing, false], [view, true]]) {
        // An undoable step has to exist, otherwise Undo is disabled and the test would pass for
        // the wrong reason.
        page.history.undoStack.push({ key: null, undo() {}, redo() {} });
        const seen = [];
        page.Bar.onCommand = (id) => seen.push(id);
        let prevented = false;
        page.Bar.onKeyDown({ code: 'KeyZ', ctrlKey: true, key: 'z', preventDefault: () => { prevented = true; } });
        assert.deepEqual(seen, shouldRun ? ['edit.undo'] : [], 'typing in a field must not undo the scene');
        assert.equal(prevented, shouldRun);
    }
});

test('editor-menu: a shortcut another pane already took is left alone', () => {
    const { Bar, history } = makePage({ document: { activeElement: { tagName: 'CANVAS' } } });
    history.undoStack.push({ key: null, undo() {}, redo() {} });
    const seen = [];
    Bar.onCommand = (id) => seen.push(id);
    // The Hierarchy pane handles Del first, for instance: it marks the event as handled.
    Bar.onKeyDown({ code: 'Delete', defaultPrevented: true, preventDefault() {} });
    assert.deepEqual(seen, [], 'one keypress must run one handler');
    Bar.onKeyDown({ code: 'Delete', preventDefault() {} });
    assert.deepEqual(seen, ['edit.delete']);
});

test('editor-menu: Undo and Redo are disabled while EditHistory has nothing to give', () => {
    const { Bar, history } = makePage();
    assert.equal(Bar.isEnabled('edit.undo'), false);
    assert.equal(Bar.isEnabled('edit.redo'), false);
    history.undoStack.push({ key: null, undo() {}, redo() {} });
    assert.equal(Bar.isEnabled('edit.undo'), true);
    assert.equal(Bar.isEnabled('edit.redo'), false);
    history.redoStack.push({ key: null, undo() {}, redo() {} });
    assert.equal(Bar.isEnabled('edit.redo'), true);
    assert.deepEqual(plain(Bar.historyState()), { undo: 1, redo: 1 });
    // Everything else is available unless the parent says otherwise.
    assert.equal(Bar.isEnabled('file.save'), true);
    Bar.setEnabled('file.save', false);
    assert.equal(Bar.isEnabled('file.save'), false);
});

test('editor-menu: without history.js Undo and Redo stay disabled instead of throwing', () => {
    const history = makeHistory();
    const page = loadScripts(['_utils/editor/scene-doc.js', '_utils/editor/hierarchy-panel.js', '_utils/editor/menu-bar.js'], {
        CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = (opts || {}).detail; } },
        window: { dispatchEvent: () => true, addEventListener() {} },
    });
    const Bar = page.get('MenuBar');
    assert.equal(Bar.isEnabled('edit.undo'), false);
    assert.equal(Bar.isEnabled('edit.redo'), false);
    void history;
});

test('editor-menu: run dispatches through onCommand and refuses a disabled item', () => {
    const { Bar, history, events } = makePage();
    const seen = [];
    Bar.onCommand = (id) => seen.push(id);
    assert.equal(Bar.run('file.new'), true);
    assert.deepEqual(seen, ['file.new']);
    assert.deepEqual(plain(events.map(e => e.detail.id)), ['file.new']);
    assert.equal(events[0].type, 'menu-command', 'panes without a MenuBar handle can listen for it');
    // Undo with an empty stack is not a command at all.
    assert.equal(Bar.run('edit.undo'), false);
    assert.deepEqual(seen, ['file.new']);
    history.undoStack.push({ key: null, undo() {}, redo() {} });
    assert.equal(Bar.run('edit.undo'), true);
    assert.equal(Bar.run('nope.nothing'), false, 'an unknown id is not a command');
    assert.deepEqual(seen, ['file.new', 'edit.undo']);
});

test('editor-menu: run works with no onCommand when the parent is not wired yet', () => {
    const { Bar } = makePage();
    assert.equal(Bar.run('file.new'), true, 'the event still fires for whoever listens');
    assert.equal(Bar.run(''), false);
});