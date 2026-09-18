// glTF models: the sample character (tools/make-character.mjs -> assets/models/character.glb)
// and the clip cross-fade of js/Gltf3D.js. Babylon is not loaded — animation groups are fakes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { OUT, buildGlb } from '../tools/make-character.mjs';
import { loadScripts } from './browser-scripts.mjs';

function parseGlb(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'glTF');
  assert.equal(buf.readUInt32LE(8), buf.length, 'длина в заголовке');
  const jsonLength = buf.readUInt32LE(12);
  assert.equal(buf.toString('latin1', 16, 20), 'JSON');
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
  const bin = buf.subarray(20 + jsonLength + 8);
  return { gltf, bin };
}

test('character.glb на диске совпадает с генератором (node tools/make-character.mjs)', () => {
  assert.ok(fs.readFileSync(OUT).equals(buildGlb()));
});

test('character.glb: скелет, клипы idle и run, буферы сходятся', () => {
  const { gltf, bin } = parseGlb(buildGlb());
  assert.equal(gltf.buffers[0].byteLength, bin.length);
  assert.deepEqual(gltf.animations.map(a => a.name).sort(), ['idle', 'run']);
  const skin = gltf.skins[0];
  assert.ok(skin.joints.length > 0);
  assert.equal(gltf.accessors[skin.inverseBindMatrices].count, skin.joints.length);
  for (const v of gltf.bufferViews) assert.ok(v.byteOffset + v.byteLength <= bin.length);
  for (const p of gltf.meshes[0].primitives) {
    const n = gltf.accessors[p.attributes.POSITION].count;
    for (const key of ['NORMAL', 'JOINTS_0', 'WEIGHTS_0']) assert.equal(gltf.accessors[p.attributes[key]].count, n, key);
  }
  // A looped clip has no seam: the last key repeats the first.
  for (const anim of gltf.animations) {
    for (const s of anim.samplers) {
      const a = gltf.accessors[s.output], view = gltf.bufferViews[a.bufferView], width = a.type === 'VEC4' ? 4 : 3;
      const data = new Float32Array(bin.buffer, bin.byteOffset + view.byteOffset, a.count * width);
      for (let k = 0; k < width; k++) assert.ok(Math.abs(data[k] - data[(a.count - 1) * width + k]) < 1e-6, anim.name);
    }
  }
});

// A fake AnimationGroup: remembers what Clips3D does to it.
function fakeGroup(name) {
  return {
    name, isPlaying: false, weight: null, from: 0, to: 1, speedRatio: 1,
    onAnimationGroupEndObservable: { addOnce() {} },
    start(loop, speed) { this.isPlaying = true; this.loop = loop; this.speedRatio = speed; },
    stop() { this.isPlaying = false; },
    reset() {},
    setWeightForAllAnimatables(w) { this.weight = w; },
    dispose() {},
  };
}

function makeClips() {
  const page = loadScripts(['js/Constants.js', 'js/Gltf3D.js']);
  const Clips3D = page.get('Clips3D');
  const scene = { onBeforeAnimationsObservable: { add: () => ({}), remove() {} }, getEngine: () => ({ getDeltaTime: () => 16 }) };
  const idle = fakeGroup('hero/idle'), run = fakeGroup('hero/run');
  return { clips: new Clips3D(scene, [idle, run], ['idle', 'run']), idle, run, blend: page.get('MODEL_CLIP_BLEND_SEC') };
}

test('клипы: имена из файла, первый клип сразу с весом 1, неизвестного клипа нет', () => {
  const { clips, idle } = makeClips();
  assert.deepEqual([...clips.names()], ['idle', 'run']);
  assert.equal(clips.play('jump'), false);
  assert.equal(clips.play('idle'), true);
  assert.equal(idle.isPlaying, true);
  assert.equal(idle.weight, 1);
});

test('клипы: переход idle -> run за MODEL_CLIP_BLEND_SEC, сумма весов 1, старый клип останавливается', () => {
  const { clips, idle, run, blend } = makeClips();
  clips.play('idle');
  clips.play('run');
  assert.equal(run.weight, 0);
  clips._tick(blend / 4);
  assert.ok(Math.abs(run.weight - 0.25) < 1e-9 && Math.abs(idle.weight + run.weight - 1) < 1e-9);
  clips.play('run');                       // the same clip again — no restart, the fade goes on
  clips._tick(blend / 4);
  assert.ok(Math.abs(run.weight - 0.5) < 1e-9);
  clips.play('idle');                      // back in the middle of the fade — from the current weights
  clips._tick(blend / 4);
  assert.ok(Math.abs(idle.weight - 0.75) < 1e-9 && Math.abs(idle.weight + run.weight - 1) < 1e-9);
  clips._tick(blend);
  assert.equal(idle.weight, 1);
  assert.equal(run.isPlaying, false);
  assert.equal(clips.current, 'idle');
});

test('клипы: stop возвращает позу покоя', () => {
  const { clips, idle } = makeClips();
  clips.play('idle');
  clips.stop();
  assert.equal(idle.isPlaying, false);
  assert.equal(clips.current, '');
});
