// ClipDoc: the animation document. Curve evaluation, keyframing, undo and — the reason this is
// our own model rather than a Babylon AnimationGroup — the quality checks that catch a "crooked"
// animation before a designer sees it on screen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

// Objects built inside the vm context belong to another realm, so compare their JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

function makeClip() {
    const history = {
        stack: [],
        record(key, undo, redo) { this.stack.push({ key, undo, redo }); },
        undo() { const e = this.stack.pop(); if (e) e.undo(); return !!e; },
    };
    const page = loadScripts(['_utils/editor/clip-doc.js'], { EditHistory: history });
    return { Clip: page.get('ClipDoc'), Player: page.get('ClipPlayer'), history };
}

// --- the document -------------------------------------------------------------

test('clipdoc: a new clip has a name, an fps and a duration', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('Walk', 30, 2);
    assert.equal(clip.name, 'Walk');
    assert.equal(clip.fps, 30);
    assert.equal(clip.duration, 2);
    assert.equal(clip.loop, true);
    assert.equal(Object.keys(clip.tracks).length, 0);
    assert.equal(clip.dirty, false);
});

test('clipdoc: a bad fps or duration falls back to a usable value', () => {
    const { Clip } = makeClip();
    assert.equal(Clip.create('x', 0, 0).fps, 30);
    assert.equal(Clip.create('x', -5, -1).duration, 1);
    assert.equal(Clip.create('x', NaN, NaN).fps, 30);
});

test('clipdoc: a track id is target plus path, so channels never collide', () => {
    const { Clip } = makeClip();
    assert.equal(Clip.trackId('root', 'x'), 'root|x');
    assert.notEqual(Clip.trackId('root', 'x'), Clip.trackId('root', 'y'));
    assert.notEqual(Clip.trackId('root', 'x'), Clip.trackId('hand', 'x'));
});

// --- keyframing ---------------------------------------------------------------

test('clipdoc: a keyframe creates its track and keeps keys sorted', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C');
    // Deliberately out of order: a timeline lets a designer key anywhere.
    Clip.keyframe(clip, 'root', 'x', 1, 100);
    Clip.keyframe(clip, 'root', 'x', 0, 0);
    Clip.keyframe(clip, 'root', 'x', 0.5, 50);
    const track = clip.tracks[Clip.trackId('root', 'x')];
    assert.deepEqual(plain(track.keys.map(k => k.time)), [0, 0.5, 1]);
});

test('clipdoc: keying the same time twice REPLACES the key, it does not stack', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C');
    Clip.keyframe(clip, 'root', 'x', 0.5, 10);
    Clip.keyframe(clip, 'root', 'x', 0.5, 99);
    const track = clip.tracks[Clip.trackId('root', 'x')];
    assert.equal(track.keys.length, 1, 'one frame, one key');
    assert.equal(track.keys[0].value, 99);
});

test('clipdoc: a non-finite key is refused rather than stored', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C');
    assert.equal(Clip.keyframe(clip, 'root', 'x', NaN, 1), false);
    assert.equal(Clip.keyframe(clip, 'root', 'x', 0, NaN), false);
    assert.equal(Object.keys(clip.tracks).length, 0);
});

test('clipdoc: removing the last key removes the empty track', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C');
    Clip.keyframe(clip, 'root', 'x', 0, 5);
    Clip.removeKey(clip, 'root', 'x', 0);
    assert.equal(clip.tracks[Clip.trackId('root', 'x')], undefined,
        'a track with no keys is noise in the timeline and in a saved file');
});

test('clipdoc: a key can be moved in time and the track stays sorted', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C');
    Clip.keyframe(clip, 'root', 'x', 0, 0);
    Clip.keyframe(clip, 'root', 'x', 1, 10);
    Clip.keyframe(clip, 'root', 'x', 2, 20);
    assert.equal(Clip.moveKey(clip, 'root', 'x', 0.5, 0), false, 'there is no key at 0.5');
    assert.equal(Clip.moveKey(clip, 'root', 'x', 0, 3), true);
    const times = clip.tracks[Clip.trackId('root', 'x')].keys.map(k => k.time);
    assert.deepEqual(plain(times), [1, 2, 3]);
});

// --- evaluation ---------------------------------------------------------------

test('clipdoc: outside the keyed range the curve HOLDS, it does not extrapolate', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C', 30, 5);
    Clip.keyframe(clip, 'root', 'x', 1, 10);
    Clip.keyframe(clip, 'root', 'x', 2, 20);
    // Inventing motion beyond the authored keys is exactly how an animation looks wrong.
    assert.equal(Clip.evaluate(clip, 'root', 'x', 0), 10);
    assert.equal(Clip.evaluate(clip, 'root', 'x', 4), 20);
});

test('clipdoc: linear interpolation hits the exact midpoint', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C');
    Clip.keyframe(clip, 'root', 'x', 0, 0, 'linear');
    Clip.keyframe(clip, 'root', 'x', 1, 100, 'linear');
    assert.equal(Clip.evaluate(clip, 'root', 'x', 0.5), 50);
    assert.equal(Clip.evaluate(clip, 'root', 'x', 0.25), 25);
});

test('clipdoc: a step key holds its value then jumps', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C');
    Clip.keyframe(clip, 'root', 'x', 0, 0, 'step');
    Clip.keyframe(clip, 'root', 'x', 0.5, 100, 'linear');
    assert.equal(Clip.evaluate(clip, 'root', 'x', 0.25), 0, 'no motion during the step');
    assert.equal(Clip.evaluate(clip, 'root', 'x', 0.5), 100);
});

test('clipdoc: every ease is monotone and stays within the two key values', () => {
    const { Clip } = makeClip();
    // An ease that overshoots or reverses is a class of "crooked animation" that is invisible in
    // a screenshot and obvious in motion, so it is pinned here for every mode.
    for (const mode of Clip.EASES) {
        let previous = -Infinity;
        for (let i = 0; i <= 40; i++) {
            const v = Clip.ease(mode, i / 40, 0, 0);
            assert.ok(v >= previous - 1e-9, mode + ' must not reverse at t=' + (i / 40));
            assert.ok(v >= -1e-9 && v <= 1 + 1e-9, mode + ' must stay in 0..1, got ' + v);
            previous = v;
        }
        assert.ok(Math.abs(Clip.ease(mode, 0, 0, 0)) < 1e-9, mode + ' must start at 0');
    }
});

test('clipdoc: a bezier ease still reaches both ends exactly', () => {
    const { Clip } = makeClip();
    // Tangents shape the middle; the endpoints must stay pinned or the pose would drift.
    for (const out of [-2, 0, 1, 3]) {
        for (const into of [-2, 0, 1, 3]) {
            assert.ok(Math.abs(Clip.ease('bezier', 0, out, into)) < 1e-9, 'start pinned');
            assert.ok(Math.abs(Clip.ease('bezier', 1, out, into) - 1) < 1e-9, 'end pinned');
        }
    }
});

test('clipdoc: an unkeyed channel evaluates to null, not to a made-up zero', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C');
    assert.equal(Clip.evaluate(clip, 'root', 'y', 0), null);
    Clip.keyframe(clip, 'root', 'y', 0, 7);
    assert.equal(Clip.evaluate(clip, 'root', 'y', 0), 7);
});

test('clipdoc: sample returns one value per channel at a time', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C');
    Clip.keyframe(clip, 'root', 'x', 0, 0);
    Clip.keyframe(clip, 'root', 'x', 1, 10);
    Clip.keyframe(clip, 'hand', 'rotY', 0, 0);
    Clip.keyframe(clip, 'hand', 'rotY', 1, 90);
    const values = Clip.sample(clip, 0.5);
    assert.equal(values['root|x'], 5);
    assert.equal(values['hand|rotY'], 45);
});

test('clipdoc: bake covers the whole clip including the final frame', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C', 10, 1);
    Clip.keyframe(clip, 'root', 'x', 0, 0);
    Clip.keyframe(clip, 'root', 'x', 1, 10);
    const frames = Clip.bake(clip);
    assert.equal(frames.length, 11, 'inclusive of the end — a loop stopping a frame short hitches');
    assert.equal(frames[0].time, 0);
    assert.equal(frames[frames.length - 1].time, 1);
    assert.equal(frames[5].values['root|x'], 5);
});

// --- undo ---------------------------------------------------------------------

test('clipdoc: a keyframe can be undone', () => {
    const { Clip, history } = makeClip();
    const clip = Clip.create('C');
    Clip.keyframe(clip, 'root', 'x', 0, 42);
    assert.equal(clip.tracks[Clip.trackId('root', 'x')].keys.length, 1);
    history.undo();
    assert.equal(clip.tracks[Clip.trackId('root', 'x')], undefined, 'undo removes the new track');
});

test('clipdoc: undo keeps the track object a panel is holding', () => {
    const { Clip, history } = makeClip();
    const clip = Clip.create('C');
    Clip.keyframe(clip, 'root', 'x', 0, 0);
    const track = Clip.track(clip, 'root', 'x');
    Clip.keyframe(clip, 'root', 'x', 1, 100);
    history.undo();
    assert.equal(Clip.track(clip, 'root', 'x'), track, 'the same track object is kept');
    assert.equal(track.keys.length, 1, 'and it carries the undone state');
});

// --- quality checks -----------------------------------------------------------

test('clipdoc: an empty clip is reported, not silently accepted', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('Empty');
    const findings = Clip.validate(clip);
    assert.ok(findings.some(f => f.code === 'empty'), 'a clip with no tracks must be flagged');
});

test('clipdoc: a key past the clip end is an error', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C', 30, 1);
    Clip.keyframe(clip, 'root', 'x', 2, 10);
    const findings = Clip.validate(clip);
    assert.ok(findings.some(f => f.code === 'out-of-range' && f.level === 'error'),
        'a key beyond the duration never plays — the designer must be told');
    assert.equal(Clip.isClean(clip), false);
});

test('clipdoc: a loop whose ends differ is reported as a seam', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('Walk', 30, 1);
    clip.loop = true;
    Clip.keyframe(clip, 'root', 'rotY', 0, 0);
    Clip.keyframe(clip, 'root', 'rotY', 1, 90);
    const findings = Clip.validate(clip);
    assert.ok(findings.some(f => f.code === 'loop-seam'),
        'a looping clip that ends somewhere else snaps every cycle');
});

test('clipdoc: a matching loop has no seam', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('Walk', 30, 1);
    Clip.keyframe(clip, 'root', 'rotY', 0, 0);
    Clip.keyframe(clip, 'root', 'rotY', 0.5, 90);
    Clip.keyframe(clip, 'root', 'rotY', 1, 0);
    const findings = Clip.validate(clip);
    assert.equal(findings.some(f => f.code === 'loop-seam'), false);
});

test('clipdoc: one mistyped key is caught as a speed spike', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C', 30, 1);
    // A smooth ramp — every segment the same speed.
    for (let i = 0; i <= 8; i++) Clip.keyframe(clip, 'root', 'x', i * 0.125, i * 10, 'linear');
    assert.equal(Clip.validate(clip).some(f => f.code === 'spike'), false, 'a smooth ramp is clean');
    // Now mistype one key, the classic way a twitch gets in.
    Clip.keyframe(clip, 'root', 'x', 0.5, 900);
    const findings = Clip.validate(clip);
    assert.ok(findings.some(f => f.code === 'spike'),
        'a segment far faster than its neighbours is the "crooked animation" this check exists for');
});

test('clipdoc: validate reports the track and time of every finding', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('C', 30, 1);
    Clip.keyframe(clip, 'root', 'x', 3, 5);
    const finding = Clip.validate(clip).find(f => f.code === 'out-of-range');
    assert.ok(finding);
    assert.equal(finding.track, 'root.x', 'a panel must be able to point at the offending channel');
    assert.equal(finding.time, 3);
});

// --- serialisation ------------------------------------------------------------

test('clipdoc: a clip survives a JSON round-trip', () => {
    const { Clip } = makeClip();
    const clip = Clip.create('Walk', 24, 1.5);
    Clip.keyframe(clip, 'root', 'x', 0, 0, 'easeInOut');
    Clip.keyframe(clip, 'hand', 'rotY', 1, 90, 'bezier');
    const back = Clip.fromJSON(JSON.parse(JSON.stringify(Clip.toJSON(clip))));
    assert.equal(back.name, 'Walk');
    assert.equal(back.fps, 24);
    assert.equal(back.duration, 1.5);
    assert.equal(Clip.evaluate(back, 'root', 'x', 0), 0);
    assert.equal(back.tracks[Clip.trackId('hand', 'rotY')].keys[0].ease, 'bezier');
    assert.equal(back.dirty, false);
});

test('clipdoc: a hand-edited file with unsorted keys is sorted, not trusted', () => {
    const { Clip } = makeClip();
    const back = Clip.fromJSON({
        name: 'H', fps: 30, duration: 1,
        tracks: { 'root|x': { target: 'root', path: 'x', keys: [{ time: 1, value: 10 }, { time: 0, value: 0 }] } },
    });
    const times = back.tracks['root|x'].keys.map(k => k.time);
    assert.deepEqual(plain(times), [0, 1], 'an unsorted track would make the evaluator sample wrongly');
});

test('clipdoc: a file with junk keys drops them instead of failing', () => {
    const { Clip } = makeClip();
    const back = Clip.fromJSON({
        name: 'H',
        tracks: { 'root|x': { target: 'root', path: 'x', keys: [{ time: 0, value: 1 }, { time: 'nope', value: 2 }, null] } },
    });
    assert.equal(back.tracks['root|x'].keys.length, 1);
});

test('clipdoc: fromJSON rejects junk', () => {
    const { Clip } = makeClip();
    assert.equal(Clip.fromJSON(null), null);
    assert.equal(Clip.fromJSON({}), null);
    assert.equal(Clip.fromJSON({ tracks: 'nope' }), null);
});

// --- the player ---------------------------------------------------------------

test('clipdoc: the player writes sampled values into a node transform', () => {
    const { Clip, Player } = makeClip();
    const clip = Clip.create('C', 30, 1);
    Clip.keyframe(clip, 'root', 'x', 0, 0, 'linear');
    Clip.keyframe(clip, 'root', 'x', 1, 100, 'linear');
    const node = { transform: { x: 0, y: 0, h: 0 } };
    const player = new Player(clip, node);
    player.play();
    player.update(0.5);
    assert.equal(node.transform.x, 50);
});

test('clipdoc: a looping player wraps and a non-looping one holds the end', () => {
    const { Clip, Player } = makeClip();
    const clip = Clip.create('C', 30, 1);
    Clip.keyframe(clip, 'root', 'x', 0, 0, 'linear');
    Clip.keyframe(clip, 'root', 'x', 1, 100, 'linear');

    const loopNode = { transform: { x: 0 } };
    const looping = new Player(clip, loopNode).play();
    looping.update(1.5);
    assert.equal(loopNode.transform.x, 50, 'a loop wraps to the same phase');

    const once = Clip.create('C', 30, 1);
    Clip.keyframe(once, 'root', 'x', 0, 0, 'linear');
    Clip.keyframe(once, 'root', 'x', 1, 100, 'linear');
    once.loop = false;
    const onceNode = { transform: { x: 0 } };
    const player = new Player(once, onceNode).play();
    player.update(5);
    assert.equal(onceNode.transform.x, 100, 'a non-looping clip stops on its last pose');
    assert.equal(player.playing, false);
});

test('clipdoc: the player can drive a separate target per track', () => {
    const { Clip, Player } = makeClip();
    const clip = Clip.create('C', 30, 1);
    Clip.keyframe(clip, 'root', 'x', 0, 0, 'linear');
    Clip.keyframe(clip, 'root', 'x', 1, 100, 'linear');
    Clip.keyframe(clip, 'hand', 'x', 0, 0, 'linear');
    Clip.keyframe(clip, 'hand', 'x', 1, -100, 'linear');
    const root = { transform: { x: 0 } };
    const hand = { transform: { x: 0 } };
    const player = new Player(clip, root, { hand }).play();
    player.update(1);
    assert.equal(root.transform.x, 100);
    assert.equal(hand.transform.x, -100, 'each track drives its own holder');
});
// --- the timeline panel's pure geometry ---------------------------------------
// The panel is draw + pointer handling, but its geometry is pure, so the parts that decide where
// a click lands and how a curve is shaped are pinned here — a timeline that maps time to pixels
// wrongly is a timeline where every key lands in the wrong place.

function makeTimeline() {
    const page = loadScripts(['_utils/editor/clip-doc.js', '_utils/editor/anim-editor.js'], {});
    return { Clip: page.get('ClipDoc'), Anim: page.get('AnimEditor') };
}

test('timeline: time and pixels convert both ways', () => {
    const { Clip, Anim } = makeTimeline();
    Anim.zoom = 200;
    Anim.setClip(Clip.create('C', 30, 2));
    // xToFrame must invert frameToX or a click lands somewhere the user did not aim.
    for (const time of [0, 0.5, 1, 1.75]) {
        assert.ok(Math.abs(Anim.xToFrame(Anim.frameToX(time)) - time) < 1e-9, 'round trip at ' + time);
    }
    assert.equal(Anim.frameToX(1), 200);
});

test('timeline: a bad zoom cannot divide by zero', () => {
    const { Clip, Anim } = makeTimeline();
    Anim.setClip(Clip.create('C'));
    for (const zoom of [0, -10, NaN, Infinity]) {
        Anim.zoom = zoom;
        assert.ok(Number.isFinite(Anim.pixelsPerSecond()) && Anim.pixelsPerSecond() > 0,
            'zoom ' + zoom + ' must fall back, not produce Infinity');
    }
});

test('timeline: snapping lands on the frame grid', () => {
    const { Clip, Anim } = makeTimeline();
    Anim.setClip(Clip.create('C', 30, 1));
    // 0.0333 and 0.0334 would read as duplicates on the next load and produce a twitch.
    assert.equal(Anim.snapTime(0.0334).toFixed(6), (1 / 30).toFixed(6));
    assert.equal(Anim.snapTime(0.1).toFixed(6), (3 / 30).toFixed(6));
    assert.equal(Anim.snapTime(1.0), 1);
});

test('timeline: frame stepping moves exactly N frames and does not drift', () => {
    const { Clip, Anim } = makeTimeline();
    Anim.setClip(Clip.create('C', 30, 1));
    Anim.stepFrame(1);
    assert.ok(Math.abs(Anim.time - 1 / 30) < 1e-9);
    Anim.stepFrame(2);          // two MORE frames, so frame 3
    assert.ok(Math.abs(Anim.time - 3 / 30) < 1e-9);
    Anim.stepFrame(-1);
    assert.ok(Math.abs(Anim.time - 2 / 30) < 1e-9);
    // Stepping all the way must land EXACTLY on the end: repeated float addition would drift and
    // a keyed frame would land on a neighbouring one.
    Anim.seek(0);
    for (let i = 0; i < 30; i++) Anim.stepFrame(1);
    assert.equal(Anim.time, 1, 'no accumulated rounding error');
});

test('timeline: seeking is clamped to the clip', () => {
    const { Clip, Anim } = makeTimeline();
    Anim.setClip(Clip.create('C', 30, 2));
    assert.equal(Anim.seek(-5), 0);
    assert.equal(Anim.seek(99), 2);
});

test('timeline: a curve is sampled across the whole clip and stays inside the panel', () => {
    const { Clip, Anim } = makeTimeline();
    const clip = Clip.create('C', 30, 1);
    Clip.keyframe(clip, 'root', 'x', 0, 0, 'linear');
    Clip.keyframe(clip, 'root', 'x', 1, 100, 'linear');
    Anim.setClip(clip);
    const points = Anim.curvePoints(clip.tracks[Clip.trackId('root', 'x')], 10);
    assert.equal(points.length, 11, 'inclusive of both ends');
    assert.equal(points[0].time, 0);
    assert.equal(points[points.length - 1].time, 1);
    for (const p of points) {
        assert.ok(p.y >= -1e-9 && p.y <= Anim.CURVE_HEIGHT + 1e-9, 'the curve must stay in the panel');
    }
    // A rising channel: y decreases as the value increases (screen y grows downward).
    assert.ok(points[0].y > points[points.length - 1].y);
});

test('timeline: a constant channel draws through the middle, not off the panel', () => {
    const { Clip, Anim } = makeTimeline();
    const clip = Clip.create('C', 30, 1);
    Clip.keyframe(clip, 'root', 'x', 0, 5);
    Clip.keyframe(clip, 'root', 'x', 1, 5);
    Anim.setClip(clip);
    const points = Anim.curvePoints(clip.tracks[Clip.trackId('root', 'x')], 4);
    // Zero range would divide by zero; every sample must still be a finite y inside the panel.
    for (const p of points) {
        assert.ok(Number.isFinite(p.y), 'a constant channel must not produce NaN');
        assert.equal(p.y, Anim.CURVE_HEIGHT / 2);
    }
});

test('timeline: onion skin returns the neighbouring frames and respects the clip ends', () => {
    const { Clip, Anim } = makeTimeline();
    const clip = Clip.create('C', 30, 1);
    Anim.setClip(clip);
    Anim.onionSkin = true;
    Anim.onionFrames = 1;
    Anim.seek(0.5);
    const times = Anim.onionTimes();
    assert.equal(times.length, 2, 'one before and one after');
    assert.equal(times[0].kind, 'prev');
    assert.equal(times[1].kind, 'next');
    assert.ok(Math.abs(times[0].time - (0.5 - 1 / 30)) < 1e-9);
    // At the very start there is no previous frame: clamping beats drawing a frame that is not there.
    Anim.seek(0);
    assert.deepEqual(plain(Anim.onionTimes().map(o => o.kind)), ['next']);
    Anim.onionSkin = false;
    assert.equal(Anim.onionTimes().length, 0);
});

test('timeline: findings are filtered to the selected track', () => {
    const { Clip, Anim } = makeTimeline();
    const clip = Clip.create('C', 30, 1);
    Clip.keyframe(clip, 'root', 'x', 3, 5);      // out of range
    Clip.keyframe(clip, 'hand', 'rotY', 0, 0);   // fine
    Anim.setClip(clip);
    const all = Anim.summary();
    assert.ok(all.error >= 1, 'the out-of-range key is an error');
    const filtered = Anim.findingsFor(Clip.trackId('root', 'x'));
    assert.ok(filtered.every(f => f.track === 'root.x'));
    assert.equal(Anim.findingsFor(Clip.trackId('hand', 'rotY')).length, 0);
});

test('timeline: keying a node at the playhead keyframes every channel it has', () => {
    const { Clip, Anim } = makeTimeline();
    const clip = Clip.create('C', 30, 1);
    Anim.setClip(clip);
    Anim.seek(0.5);
    const node = { id: 'n1', name: 'Cube', transform: { x: 10, y: 20, h: 0 } };
    const count = Anim.keyAll(node, ['x', 'y', 'h']);
    assert.equal(count, 3);
    assert.equal(Clip.evaluate(clip, 'Cube', 'x', 0.5), 10);
    assert.equal(Clip.evaluate(clip, 'Cube', 'y', 0.5), 20);
});

test('timeline: keying at a snapped playhead keeps the clip clean of duplicates', () => {
    const { Clip, Anim } = makeTimeline();
    const clip = Clip.create('C', 30, 1);
    Anim.setClip(clip);
    const node = { name: 'Cube', transform: { x: 1 } };
    // Two clicks a hair apart must land on the SAME frame, or the clip gains a duplicate key —
    // which is exactly the twitch the validator reports.
    Anim.seek(0.5);
    Anim.keyAll(node, ['x']);
    Anim.seek(0.5 + 0.004);
    Anim.keyAll(node, ['x']);
    assert.equal(clip.tracks[Clip.trackId('Cube', 'x')].keys.length, 1);
    assert.equal(Clip.validate(clip).some(f => f.code === 'duplicate'), false);
});

test('timeline: splitting a channel adds a key at the sampled value', () => {
    const { Clip, Anim } = makeTimeline();
    const clip = Clip.create('C', 30, 1);
    Clip.keyframe(clip, 'root', 'x', 0, 0, 'linear');
    Clip.keyframe(clip, 'root', 'x', 1, 100, 'linear');
    Anim.setClip(clip);
    assert.equal(Anim.keyAt(Clip.trackId('root', 'x'), 0.5), true);
    assert.equal(Clip.evaluate(clip, 'root', 'x', 0.5), 50, 'the split keeps the curve shape');
    assert.equal(Anim.keyAt('nope|y', 0.5), false);
});
