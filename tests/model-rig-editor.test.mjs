// ModelEditor and RigEditor: inspecting a model and editing a skeleton. These are the panels a
// designer opens when a character animates badly, so the checks that identify WHY are pinned here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));

function makeEditors() {
    const history = {
        stack: [],
        record(key, undo, redo) { this.stack.push({ key, undo, redo }); },
        undo() { const e = this.stack.pop(); if (e) e.undo(); return !!e; },
    };
    const page = loadScripts(['_utils/editor/model-editor.js', '_utils/editor/rig-editor.js'], { EditHistory: history });
    return { Model: page.get('ModelEditor'), Rig: page.get('RigEditor'), history };
}

// A well-formed skinned model: one bound mesh, a three-bone chain, one clip.
const GOOD_MESH = { name: 'body', vertices: 812, indices: 2400, skinned: true, hasSkeleton: true, bound: true, material: 'skin', boneInfluencers: 4 };
const GOOD_BONES = [{ name: 'root', parent: '' }, { name: 'spine', parent: 'root' }, { name: 'head', parent: 'spine' }];
const GOOD_CLIPS = [{ name: 'idle', group: { from: 0, to: 2 } }];

// --- ModelEditor ---------------------------------------------------------------

test('model: a mesh is summarised with its triangle count and skin state', () => {
    const { Model } = makeEditors();
    const info = Model.meshInfo(GOOD_MESH);
    assert.equal(info.name, 'body');
    assert.equal(info.vertices, 812);
    assert.equal(info.triangles, 800, 'indices / 3');
    assert.equal(info.skinned, true);
    assert.equal(info.bound, true);
});

test('model: a skeleton reports its bones, roots and deepest chain', () => {
    const { Model } = makeEditors();
    const info = Model.skeletonInfo(GOOD_BONES);
    assert.equal(info.bones, 3);
    assert.deepEqual(plain(info.roots), ['root']);
    assert.equal(info.maxDepth, 2);
    assert.equal(info.deepest, 'head');
});

test('model: a cyclic bone chain terminates instead of hanging the editor', () => {
    const { Model } = makeEditors();
    // A corrupt rig must not lock up the editor: the walk has to be guarded.
    const info = Model.skeletonInfo([
        { name: 'a', parent: 'b' },
        { name: 'b', parent: 'a' },
    ]);
    assert.equal(info.bones, 2);
    assert.ok(Number.isFinite(info.maxDepth));
});

test('model: a clean skinned model has no error findings', () => {
    const { Model } = makeEditors();
    const report = Model.analyse([GOOD_MESH], GOOD_BONES, GOOD_CLIPS);
    assert.equal(Model.isClean(report), true);
    assert.equal(report.totals.skinned, 1);
    assert.equal(report.totals.triangles, 800);
    assert.equal(report.totals.clips, 1);
});

test('model: a skeleton with no skin weights is an ERROR — the mesh would freeze in rest pose', () => {
    const { Model } = makeEditors();
    // This is the single most common "my animation does not work" cause, so it must be an error
    // rather than a note.
    const unbound = Object.assign({}, GOOD_MESH, { bound: false });
    const report = Model.analyse([unbound], GOOD_BONES, GOOD_CLIPS);
    assert.ok(report.findings.some(f => f.code === 'unbound-skin' && f.level === 'error'));
    assert.equal(Model.isClean(report), false);
});

test('model: a skeleton that drives no mesh is an error', () => {
    const { Model } = makeEditors();
    const notSkinned = Object.assign({}, GOOD_MESH, { skinned: false, hasSkeleton: false, bound: false });
    const report = Model.analyse([notSkinned], GOOD_BONES, GOOD_CLIPS);
    assert.ok(report.findings.some(f => f.code === 'skeleton-unused'));
});

test('model: a file with no meshes is an error', () => {
    const { Model } = makeEditors();
    const report = Model.analyse([], GOOD_BONES, GOOD_CLIPS);
    assert.ok(report.findings.some(f => f.code === 'no-meshes' && f.level === 'error'));
});

test('model: a skinned model with no clips is reported', () => {
    const { Model } = makeEditors();
    const report = Model.analyse([GOOD_MESH], GOOD_BONES, []);
    assert.ok(report.findings.some(f => f.code === 'no-clips'));
});

test('model: a zero-length clip is reported as having no motion', () => {
    const { Model } = makeEditors();
    const report = Model.analyse([GOOD_MESH], GOOD_BONES, [{ name: 'pose', group: { from: 1, to: 1 } }]);
    assert.ok(report.findings.some(f => f.code === 'static-clip'));
});

test('model: an over-deep bone chain is reported', () => {
    const { Model } = makeEditors();
    const bones = [{ name: 'b0', parent: '' }];
    for (let i = 1; i < 20; i++) bones.push({ name: 'b' + i, parent: 'b' + (i - 1) });
    const report = Model.analyse([GOOD_MESH], bones, GOOD_CLIPS);
    assert.ok(report.findings.some(f => f.code === 'deep-skeleton'));
});

test('model: more than four bone influences is an informational note, not a fault', () => {
    const { Model } = makeEditors();
    const heavy = Object.assign({}, GOOD_MESH, { boneInfluencers: 8 });
    const report = Model.analyse([heavy], GOOD_BONES, GOOD_CLIPS);
    const finding = report.findings.find(f => f.code === 'many-influencers');
    assert.equal(finding.level, 'info', 'correct but expensive — not an error');
    assert.equal(Model.isClean(report), true);
});

test('model: a clip duration comes from the animation group, never invented', () => {
    const { Model } = makeEditors();
    assert.equal(Model.clipInfo('idle', { from: 0, to: 2.5 }).duration, 2.5);
    // No usable group: report null rather than a made-up length.
    assert.equal(Model.clipInfo('idle', null).duration, null);
    // `from === to` is a REAL zero-length clip: a known zero, not an unknown length. Reporting it
    // as null would set `animated` to null too, so the static-clip check could never fire.
    assert.equal(Model.clipInfo('idle', { from: 1, to: 1 }).duration, 0);
    assert.equal(Model.clipInfo('idle', { from: 1, to: 1 }).animated, false);
    // A MISSING group is genuinely unknown, and must not be mistaken for the zero above.
    assert.equal(Model.clipInfo('idle', {}).duration, null);
    assert.equal(Model.clipInfo('idle', null).animated, null);
});

test('model: findings are summarised by severity for a pane badge', () => {
    const { Model } = makeEditors();
    const report = Model.analyse([Object.assign({}, GOOD_MESH, { bound: false })], GOOD_BONES, []);
    const summary = Model.summary(report);
    assert.ok(summary.error >= 1);
    assert.ok(summary.warn >= 1, 'the missing clips are a warning');
});

test('model: the report renders to console lines', () => {
    const { Model } = makeEditors();
    const report = Model.analyse([GOOD_MESH], GOOD_BONES, GOOD_CLIPS);
    const lines = Model.toLines(report);
    assert.ok(lines.length >= 2);
    assert.ok(lines.some(l => l.text.includes('800 triangles')), 'the totals line is shown');
    assert.ok(lines.some(l => l.text.includes('idle')), 'and the clips');
});

test('model: inspect(null) clears the report instead of throwing', () => {
    const { Model } = makeEditors();
    assert.equal(Model.inspect(null), null);
    assert.equal(Model.report, null);
});

// --- RigEditor -----------------------------------------------------------------

test('rig: a new rig has one root bone', () => {
    const { Rig } = makeEditors();
    const doc = Rig.create('Rig');
    assert.equal(doc.bones.length, 1);
    assert.equal(doc.bones[0].name, 'root');
    assert.equal(doc.bones[0].parent, '');
});

test('rig: the bone tree is built with the right depths', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root');
    Rig.addBone('head', 'spine');
    Rig.addBone('armL', 'spine');
    // A flat list here would make a rig impossible to read — this is the panel's whole point.
    assert.deepEqual(plain(Rig.flatten().map(r => r.name)), ['root', 'spine', 'head', 'armL']);
    assert.deepEqual(plain(Rig.flatten().map(r => r.depth)), [0, 1, 2, 2]);
    assert.deepEqual(plain(Rig.path('head')), ['root', 'spine', 'head']);
    assert.equal(Rig.depthOf('head'), 2);
});

test('rig: a bone whose parent is missing is shown, not hidden', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root');
    Rig.bone('spine').parent = 'ghost';
    const rows = Rig.flatten();
    assert.ok(rows.some(r => r.name === 'spine'), 'a broken bone must still be listed');
    assert.ok(rows.some(r => r.orphan), 'and flagged as an orphan');
});

test('rig: a cyclic rig still renders every bone instead of looping', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('a', 'root');
    Rig.addBone('b', 'a');
    // Force a cycle behind the command guard, the way a hand-edited file could.
    Rig.bone('a').parent = 'b';
    const rows = Rig.flatten();
    assert.ok(rows.length >= 3, 'every bone appears even in a corrupt rig');
    assert.ok(Rig.validate().some(f => f.code === 'cycle'), 'and the cycle is reported');
});

test('rig: a duplicate bone name is refused and reported', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    assert.ok(Rig.addBone('spine', 'root'));
    assert.equal(Rig.addBone('spine', 'root'), false, 'a duplicate would break a lookup by name');
    assert.equal(Rig.doc.bones.filter(b => b.name === 'spine').length, 1);
});

test('rig: a bone cannot be reparented under its own descendant', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root');
    Rig.addBone('head', 'spine');
    assert.equal(Rig.reparent('root', 'head'), false, 'that would make a cycle');
    assert.equal(Rig.reparent('head', 'root'), true);
    assert.equal(Rig.bone('head').parent, 'root');
});

test('rig: removing a bone re-parents its children instead of orphaning them', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root');
    Rig.addBone('head', 'spine');
    Rig.removeBone('spine');
    assert.equal(Rig.bone('head').parent, 'root', 'the chain must stay connected');
    assert.equal(Rig.bone('spine'), null);
});

test('rig: the root bone cannot be deleted', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    assert.equal(Rig.removeBone('root'), false);
    assert.ok(Rig.bone('root'));
});

test('rig: renaming a bone keeps its children attached', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root');
    Rig.addBone('head', 'spine');
    assert.equal(Rig.renameBone('spine', 'torso'), true);
    assert.equal(Rig.bone('torso').name, 'torso');
    assert.equal(Rig.bone('head').parent, 'torso', 'children follow the rename');
});

test('rig: a rename onto an existing name is refused', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root');
    assert.equal(Rig.renameBone('spine', 'root'), false);
    assert.equal(Rig.bone('spine').name, 'spine');
});

test('rig: a clean rig passes and a broken one does not', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root');
    assert.equal(Rig.isClean(), true);
    Rig.bone('spine').parent = 'ghost';
    assert.equal(Rig.isClean(), false, 'a detached bone is an error');
});

test('rig: several roots are a warning, not an error', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('weapon', '');
    const findings = Rig.validate();
    assert.ok(findings.some(f => f.code === 'multiple-roots' && f.level === 'warn'));
    assert.equal(Rig.isClean(), true, 'separate chains are legitimate');
});

test('rig: a coincident bind position is noted, since the joint would have no offset', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root', { x: 0, y: 0, z: 0 });
    assert.ok(Rig.validate().some(f => f.code === 'coincident-bind'));
});

test('rig: moving a bone is one undoable step', () => {
    const { Rig, history } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root');
    Rig.setPosition('spine', { x: 10, y: 20, z: 30 });
    assert.equal(Rig.bone('spine').position.x, 10);
    history.undo();
    assert.equal(Rig.bone('spine').position.x, 0, 'undo restores the bind position');
});

test('rig: undo keeps the bone objects a panel is holding', () => {
    const { Rig, history } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root');
    const bone = Rig.bone('spine');
    Rig.setPosition('spine', { x: 5, y: 0, z: 0 });
    history.undo();
    assert.equal(Rig.bone('spine'), bone, 'the same bone object survives the undo');
    assert.equal(bone.position.x, 0);
});

test('rig: a rig survives a JSON round-trip', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('Hero'));
    Rig.addBone('spine', 'root', { x: 1, y: 2, z: 3 });
    const back = Rig.fromJSON(plain(Rig.toJSON()));
    assert.equal(back.name, 'Hero');
    assert.equal(back.bones.length, 2);
    assert.equal(back.bones[1].position.y, 2);
    assert.equal(back.dirty, false);
});

test('rig: fromJSON rejects junk rather than building an empty rig', () => {
    const { Rig } = makeEditors();
    assert.equal(Rig.fromJSON(null), null);
    assert.equal(Rig.fromJSON({}), null);
    assert.equal(Rig.fromJSON({ bones: [] }), null);
});

test('rig: applyTo writes the rig onto a live skeleton by name', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    Rig.addBone('spine', 'root', { x: 7, y: 8, z: 9 });
    // A stand-in for a Babylon skeleton: only the fields applyTo uses.
    const skeleton = { bones: [{ name: 'root', position: { x: 0, y: 0, z: 0 } }, { name: 'spine', position: { x: 0, y: 0, z: 0 } }] };
    const applied = Rig.applyTo(skeleton);
    assert.equal(applied, 2);
    assert.equal(skeleton.bones[1].position.x, 7);
});

test('rig: applyTo ignores a skeleton with no matching bones', () => {
    const { Rig } = makeEditors();
    Rig.setDocument(Rig.create('R'));
    assert.equal(Rig.applyTo({ bones: [{ name: 'unknown', position: { x: 0, y: 0, z: 0 } }] }), 0);
    assert.equal(Rig.applyTo(null), 0);
});