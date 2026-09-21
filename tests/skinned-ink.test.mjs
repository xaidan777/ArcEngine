// Ink edges of a SKINNED mesh (World3D.inkSkin / inkSkinRelease / class InkSkin).
//
// STATE OF THE PORT — READ THIS FIRST.
// The InkSkin port is being landed in js/World3D.js by another writer, so this file is split
// in two halves:
//   • PURE half — always runs. It pins the line-end -> vertex mapping (the triangle-sharing
//     preference and the "the four ends of one quad share one pair" rule), the pose math and
//     the "the renderer's line buffers are not updatable" decision, as a standalone reference
//     implementation inside this file. It needs no Babylon and no World3D.
//   • CONTRACT half — runs only when World3D.inkSkin / World3D.inkSkinRelease exist. Until the
//     port lands those tests SKIP with a clear message instead of failing the suite; once the
//     port is in, they check the real InkSkin against the reference implementation with a fake
//     (non-WebGL) mesh, renderer and vertex buffers.
// So: a green run with skips means "the algorithm is pinned, the port is not in yet". A green
// run with no skips means the port matches. A failure is a real difference — do not silence it.
//
// Why the two details matter (from upstream's notes):
//   • lowpoly duplicates every vertex per face, so a line end's position key usually has several
//     candidates; at a bone seam the wrong candidate flies off with the wrong bone. The pair
//     that shares a TRIANGLE must win. The four ends of one line quad must be resolved with ONE
//     pair, or the quad is stretched between two bones.
//   • EdgesRenderer creates its line buffers with updatable = false, and updateDirectly on those
//     silently does nothing — the port has to swap in updatable ones.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

// --- Reference implementation (pure) ----------------------------------------
// A faithful restatement of upstream InkSkin._map: line end -> mesh vertex, keyed by the exact
// position the renderer copied the line end from (createLine pushes p0, p0, p1, p1 into
// linesPositions and the opposite end into linesNormals with a 4th "side" component).
// pos/indices/linesPositions/linesNormals are plain arrays; the result is plain typed arrays.
function mapLineEnds(pos, indices, linesPositions, linesNormals) {
  const n = pos.length / 3;
  const byPos = new Map();
  for (let v = 0; v < n; v++) {
    const key = pos[3 * v] + '|' + pos[3 * v + 1] + '|' + pos[3 * v + 2];
    const list = byPos.get(key);
    if (list) list.push(v); else byPos.set(key, [v]);
  }
  // Vertex pairs that share a TRIANGLE, keyed a * n + b.
  const pair = new Set();
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    pair.add(a * n + b); pair.add(b * n + a);
    pair.add(b * n + c); pair.add(c * n + b);
    pair.add(c * n + a); pair.add(a * n + c);
  }
  const count = linesPositions.length / 3;
  const from = new Int32Array(count);   // the vertex of the line end itself
  const to = new Int32Array(count);     // the vertex of the other end (from linesNormals)
  const used = new Set();
  for (let i = 0; i < count; i += 4) {
    const A = byPos.get(linesPositions[3 * i] + '|' + linesPositions[3 * i + 1] + '|' + linesPositions[3 * i + 2]) || [0];
    const B = byPos.get(linesNormals[4 * i] + '|' + linesNormals[4 * i + 1] + '|' + linesNormals[4 * i + 2]) || [0];
    let a = A[0], b = B[0];
    if (A.length > 1 || B.length > 1) {
      search: for (const x of A) {
        for (const y of B) if (pair.has(x * n + y)) { a = x; b = y; break search; }
      }
    }
    // ONE pair for the whole quad: the two duplicated ends on each side.
    from[i] = from[i + 1] = a; from[i + 2] = from[i + 3] = b;
    to[i] = to[i + 1] = b; to[i + 2] = to[i + 3] = a;
    used.add(a); used.add(b);
  }
  return { from, to, used };
}

// The port's pose math: the same sum the vertex shader does (bonesVertex) — the skeleton's
// matrices live in the mesh's space, the line shader applies the world matrix afterwards.
// Row-vector convention: posed = (x, y, z, 1) · M, translation in columns 12..14.
// The mesh may carry 4 influences (matricesIndices/matricesWeights) or 8 (the Extra pair);
// the port walks k = 0..7 and stops as soon as the extra pair is absent.
function poseUsed(rest, bones, weights, matrices, used, bonesExtra, weightsExtra) {
  const n = rest.length / 3;
  const out = new Float32Array(n * 3);
  for (const v of used) {
    const x = rest[3 * v], y = rest[3 * v + 1], z = rest[3 * v + 2];
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < 8; k++) {
      const extra = k > 3;
      if (extra && !bonesExtra) break;
      const idx = extra ? bonesExtra : bones;
      const wts = extra ? weightsExtra : weights;
      const at = 4 * v + (k & 3), w = wts[at];
      if (!w) continue;
      const o = (idx[at] | 0) * 16;
      px += w * (matrices[o] * x + matrices[o + 4] * y + matrices[o + 8] * z + matrices[o + 12]);
      py += w * (matrices[o + 1] * x + matrices[o + 5] * y + matrices[o + 9] * z + matrices[o + 13]);
      pz += w * (matrices[o + 2] * x + matrices[o + 6] * y + matrices[o + 10] * z + matrices[o + 14]);
    }
    out[3 * v] = px; out[3 * v + 1] = py; out[3 * v + 2] = pz;
  }
  return out;
}

// The line buffers the port must produce: every line end replaced by its posed vertex; the 4th
// component of the normal (the side of the quad) does not move.
function expectedBuffers(linesPositions, linesNormals, from, to, posed) {
  const line = Float32Array.from(linesPositions);
  const next = Float32Array.from(linesNormals);
  for (let i = 0; i < from.length; i++) {
    const a = 3 * from[i], b = 3 * to[i];
    line[3 * i] = posed[a]; line[3 * i + 1] = posed[a + 1]; line[3 * i + 2] = posed[a + 2];
    next[4 * i] = posed[b]; next[4 * i + 1] = posed[b + 1]; next[4 * i + 2] = posed[b + 2];
  }
  return { line, next };
}

// Babylon creates the renderer's line buffers as NOT updatable. A port that forgets to swap
// them calls updateDirectly on a static buffer that silently ignores the write. This is the
// decision, pure and testable: which kinds have to be replaced with updatable buffers.
function buffersToReplace(buffers) {
  const out = [];
  for (const kind of ['position', 'normal']) {
    const b = buffers[kind];
    if (!b || b.updatable !== true) out.push(kind);
  }
  return out;
}

// --- Geometry with a bone seam ----------------------------------------------
// Two lowpoly triangles that do NOT share vertices, although they share two positions — exactly
// what checkVerticesInsteadOfIndices exists for. Position (1,0,0) exists twice: vertex 1 (in the
// SECOND triangle, bone 2) and vertex 3 (in the first triangle, bone 1). A line along
// (0,0,0) -> (1,0,0) must map its end to vertex 3, not 1: only (0,3) is an edge of a triangle.
const SEAM = {
  pos: [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0],
  idx: [0, 3, 2, 1, 4, 5],
  // bone index per vertex (4 slots each, only the first used)
  bones: [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
  // Vertex 0 is HALF on bone 0 and, on a mesh that carries the Extra pair, another HALF on bone 2
  // — that is what makes a 4-influence and an 8-influence build genuinely differ, so the Extra
  // path can be checked by its OUTPUT rather than by poking at private fields.
  weights: [0.5, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  // The 5th..8th influence pair; absent (null) on a mesh with numBoneInfluencers = 4.
  bonesExtra: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  weightsExtra: [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};

// one line from (0,0,0) to (1,0,0), laid out exactly as EdgesRenderer.createLine does
SEAM.linesPositions = [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0];
SEAM.linesNormals = [1, 0, 0, -1, 1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, 1];

// Three bones, each a pure translation, so the mapped vertex is visible in the output.
function seamMatrices() {
  const m = new Float32Array(3 * 16);
  const set = (bone, x, y, z) => {
    const o = bone * 16;
    m[o] = 1; m[o + 5] = 1; m[o + 10] = 1;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z;
  };
  set(0, 100, 0, 0);   // vertices 0, 2, 5
  set(1, 0, 0, 100);   // vertex 3 — the triangle-sharing candidate
  set(2, 0, 100, 0);   // vertex 1 — the candidate a naive port would take
  return m;
}

const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-4, msg + ': ' + actual + ' != ' + expected);
const closeAll = (actual, expected, msg) => {
  assert.equal(actual.length, expected.length, msg + ': length');
  for (let i = 0; i < expected.length; i++) close(actual[i], expected[i], msg + '[' + i + ']');
};

// --- Pure half: the algorithm -----------------------------------------------

test('карта концов линии: из двух вершин с одной позицией берётся та, что делит с концом треугольник', () => {
  const { from, to, used } = mapLineEnds(SEAM.pos, SEAM.idx, SEAM.linesPositions, SEAM.linesNormals);
  // Кандидаты позиции (1,0,0) — вершины 1 и 3; вершина 1 первая по порядку, но она из СОСЕДНЕГО
  // треугольника. Наивный порт взял бы B[0] = 1 и конец линии уехал бы на чужую кость.
  assert.deepEqual([...from], [0, 0, 3, 3]);
  assert.deepEqual([...to], [3, 3, 0, 0]);
  assert.equal(used.has(1), false, 'кандидат из чужого треугольника не должен использоваться');
  assert.deepEqual([...used].sort((a, b) => a - b), [0, 3], 'позируются только вершины линий');
});

test('карта концов линии: все четыре конца одного квада берут ОДНУ пару вершин', () => {
  const { from, to } = mapLineEnds(SEAM.pos, SEAM.idx, SEAM.linesPositions, SEAM.linesNormals);
  // Квад не должен растянуться между двумя костями: сторона quad-a это (from) одна вершина,
  // сторона quad-b (to) — другая, для всех четырёх концов.
  assert.equal(from[0], from[1]);
  assert.equal(from[2], from[3]);
  assert.equal(to[0], to[1]);
  assert.equal(to[2], to[3]);
  assert.equal(from[0], to[2], 'сторона квада и противоположная сторона — это пара');
  assert.equal(to[0], from[2]);
  assert.equal(to[0], from[0] === 0 ? 3 : 0, 'пара — именно 0 и 3, а не 0 и 1');
});

test('карта концов линии: без дублей вершин отображение тождественное', () => {
  const pos = [0, 0, 0, 1, 0, 0, 0, 0, 1];
  const idx = [0, 1, 2];
  const lp = [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0];
  const ln = [1, 0, 0, -1, 1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, 1];
  const { from, to, used } = mapLineEnds(pos, idx, lp, ln);
  assert.deepEqual([...from], [0, 0, 1, 1]);
  assert.deepEqual([...to], [1, 1, 0, 0]);
  assert.deepEqual([...used].sort((a, b) => a - b), [0, 1]);
});

test('карта концов линии: конец без совпадения по позиции не роняет карту (запасная вершина 0)', () => {
  const pos = [0, 0, 0, 1, 0, 0, 0, 0, 1];
  const idx = [0, 1, 2];
  const lp = [5, 5, 5, 5, 5, 5, 1, 0, 0, 1, 0, 0];   // первый конец не совпадает ни с чем
  const ln = [1, 0, 0, -1, 1, 0, 0, 1, 5, 5, 5, -1, 5, 5, 5, 1];
  const { from, to } = mapLineEnds(pos, idx, lp, ln);
  assert.deepEqual([...from], [0, 0, 1, 1]);
  assert.deepEqual([...to], [1, 1, 0, 0]);
});

test('поза: концы линий встают на кости своих вершин, а не на кость дубля', () => {
  const m = seamMatrices();
  const { from, to, used } = mapLineEnds(SEAM.pos, SEAM.idx, SEAM.linesPositions, SEAM.linesNormals);
  // 4 влияния: у вершины 0 вес 0.5 на кости 0 (сдвиг +100 X) — половина сдвига.
  const posed = poseUsed(SEAM.pos, SEAM.bones, SEAM.weights, m, used);
  closeAll([...posed.slice(0, 3)], [50, 0, 0], 'вершина 0');
  closeAll([...posed.slice(9, 12)], [1, 0, 100], 'вершина 3 — кость 1, сдвиг +100 по Z');
  const { line, next } = expectedBuffers(SEAM.linesPositions, SEAM.linesNormals, from, to, posed);
  closeAll([...line], [50, 0, 0, 50, 0, 0, 1, 0, 100, 1, 0, 100], 'буфер линий');
  // 4-я компонента нормали — сторона квада, она не двигается.
  closeAll([...next], [1, 0, 100, -1, 1, 0, 100, 1, 50, 0, 0, -1, 50, 0, 0, 1], 'буфер противоположных концов');
});

test('буферы линий: статические (updatable = false) подлежат замене, обновляемые — нет', () => {
  // Так их создаёт EdgesRenderer: new VertexBuffer(engine, lines, kind, false[, false, stride]).
  const statics = { position: { updatable: false }, normal: { updatable: false } };
  assert.deepEqual(buffersToReplace(statics), ['position', 'normal'], 'оба статических буфера меняются');
  const updatables = { position: { updatable: true }, normal: { updatable: true } };
  assert.deepEqual(buffersToReplace(updatables), [], 'уже обновляемые трогать не нужно');
  assert.deepEqual(buffersToReplace({}), ['position', 'normal'], 'отсутствующий буфер — тоже замена');
});

test('поза: 5..8 влияний складываются из Extra-пары, а без неё — только первые четыре', () => {
  const m = seamMatrices();
  const used = new Set([0]);
  // 4 + 4: вершина 0 наполовину на кости 0 (+100 X), наполовину на кости 1 (+100 Z).
  const bones8 = [0, 0, 0, 0], w8 = [0.5, 0, 0, 0];
  const bonesX = [1, 0, 0, 0], wX = [0.5, 0, 0, 0];
  const eight = poseUsed([0, 0, 0], bones8, w8, m, used, bonesX, wX);
  closeAll([...eight.slice(0, 3)], [50, 0, 50], 'два влияния из разных пар');
  // Extra-пары нет (4 влияния на меше): цикл обязан остановиться, а не читать undefined.
  const four = poseUsed([0, 0, 0], bones8, w8, m, used, null, null);
  closeAll([...four.slice(0, 3)], [50, 0, 0], 'Extra-пары нет — вклад только первых четырёх');
  // Нулевой вес пропускается: сумма весов < 1 даёт просто неполный сдвиг, без NaN.
  const zero = poseUsed([0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], m, used, null, null);
  closeAll([...zero.slice(0, 3)], [0, 0, 0], 'все веса нулевые — вершина в начале координат');
});

// --- Contract half: the real port -------------------------------------------
// A fake Babylon for the ported InkSkin: a VertexBuffer that remembers `updatable`, and the
// line buffers created exactly as EdgesRenderer does (updatable = false).
class FakeVertexBuffer {
  constructor(engine, data, kind, updatable, postpone, stride) {
    this.data = data;
    this.kind = kind;
    this.updatable = !!updatable;
    this.stride = stride;
    this.disposed = false;
  }
  updateDirectly(data) { this.data = data; }
  dispose() { this.disposed = true; }
}

const KIND = {
  PositionKind: 'position',
  NormalKind: 'normal',
  MatricesIndicesKind: 'matricesIndices',
  MatricesWeightsKind: 'matricesWeights',
  MatricesIndicesExtraKind: 'matricesIndicesExtra',
  MatricesWeightsExtraKind: 'matricesWeightsExtra',
};

// A skinned mesh with a fake, non-WebGL edges renderer. linePositions / lineNormals are what a
// real EdgesRenderer would have produced from the rest pose.
// extra: hand out a MatricesIndicesExtra/WeightsExtra pair (a mesh with 5..8 influences); the
// port must pick it up when numBoneInfluencers > 4 and must not go looking for it otherwise.
function fakeSkinnedMesh(skin, extra) {
  const scene = { getEngine: () => ({}), getRenderId: () => mesh.frame };
  const observers = new Set();
  const mesh = {
    frame: 1,
    metadata: undefined,
    skeleton: { getTransformMatrices: () => seamMatrices() },
    numBoneInfluencers: extra ? 8 : 4,
    onBeforeRenderObservable: {
      add: (fn) => { observers.add(fn); return fn; },
      remove: (fn) => { observers.delete(fn); },
    },
    getScene: () => scene,
    getIndices: () => SEAM.idx,
    getVerticesData: (kind) => {
      if (kind === KIND.PositionKind) return Float32Array.from(SEAM.pos);
      if (kind === KIND.MatricesIndicesKind) return Float32Array.from(SEAM.bones);
      if (kind === KIND.MatricesWeightsKind) return Float32Array.from(SEAM.weights);
      if (kind === KIND.MatricesIndicesExtraKind) return extra ? Float32Array.from(SEAM.bonesExtra) : null;
      if (kind === KIND.MatricesWeightsExtraKind) return extra ? Float32Array.from(SEAM.weightsExtra) : null;
      return null;
    },
    // Mesh.enableEdgesRendering (Babylon): disable, then build a NEW renderer.
    enableEdgesRendering() {
      this.disableEdgesRendering();
      this.edgesRenderer = makeRenderer(SEAM.linesPositions, SEAM.linesNormals);
      return this;
    },
    disableEdgesRendering() { this.edgesRenderer = null; return this; },
    observers,
  };
  if (!skin) mesh.skeleton = null;
  // The renderer exists before InkSkin is asked for: inkMesh enables edges rendering first.
  mesh.enableEdgesRendering();
  return mesh;
}

// The renderer's own buffers: created static, exactly like Babylon does.
function makeRenderer(linesPositions, linesNormals) {
  const er = {
    linesPositions: linesPositions,
    linesNormals: linesNormals,
    _buffers: {
      [KIND.PositionKind]: new FakeVertexBuffer(null, linesPositions, KIND.PositionKind, false),
      [KIND.NormalKind]: new FakeVertexBuffer(null, linesNormals, KIND.NormalKind, false, false, 4),
    },
    _buffersForInstances: {},
  };
  er._buffersForInstances[KIND.PositionKind] = er._buffers[KIND.PositionKind];
  er._buffersForInstances[KIND.NormalKind] = er._buffers[KIND.NormalKind];
  return er;
}

const BABYLON_STUB = {
  MaterialPluginBase: class {},
  VertexBuffer: Object.assign(FakeVertexBuffer, KIND),
  Color3: class { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } },
  Color4: class { constructor(r, g, b, a) { this.r = r; this.g = g; this.b = b; this.a = a; } },
  Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
};

const page = loadScripts(['js/World3D.js'], { BABYLON: BABYLON_STUB });
const World3D = page.get('World3D');

const ported = typeof World3D.inkSkin === 'function' && typeof World3D.inkSkinRelease === 'function';
const SKIP = ported ? false
  : 'InkSkin not ported yet: World3D.inkSkin / World3D.inkSkinRelease are absent from js/World3D.js (see the file header)';

test('порт: inkSkin / inkSkinRelease — функции', { skip: SKIP }, () => {
  assert.equal(typeof World3D.inkSkin, 'function');
  assert.equal(typeof World3D.inkSkinRelease, 'function');
});

test('порт: скелетный меш принимается, меш без скелета — отвергнут', { skip: SKIP }, () => {
  const skinned = fakeSkinnedMesh(true);
  const skin = World3D.inkSkin(skinned);
  assert.ok(skin && skin.ok === true, 'скелетный меш должен получить InkSkin');
  assert.equal(skinned.metadata.inkSkin, skin, 'хелпер живёт в metadata.inkSkin');
  assert.equal(skinned.observers.size, 1, 'на onBeforeRenderObservable подписан один наблюдатель');

  const plain = fakeSkinnedMesh(false);
  assert.equal(World3D.inkSkin(plain), null, 'без скелета InkSkin не строится');
  assert.ok(!plain.metadata || !plain.metadata.inkSkin);
});

test('порт: inkSkinRelease снимает наблюдателя и не бросает на повторном вызове', { skip: SKIP }, () => {
  const mesh = fakeSkinnedMesh(true);
  const skin = World3D.inkSkin(mesh);
  assert.equal(mesh.observers.size, 1);
  World3D.inkSkinRelease(mesh);
  assert.equal(mesh.metadata.inkSkin, null, 'хелпер отпущен');
  assert.equal(mesh.observers.size, 0, 'наблюдатель снят — иначе он пишет в мёртвый буфер');
  assert.equal(skin.ok, false);
  World3D.inkSkinRelease(mesh);   // повторный вызов — no-op, не исключение
  World3D.inkSkinRelease(null);
});

test('порт: статические буферы рендерера заменены обновляемыми', { skip: SKIP }, () => {
  const mesh = fakeSkinnedMesh(true);
  World3D.inkMesh(mesh, 'actor');
  const er = mesh.edgesRenderer;
  const pos = er._buffers[KIND.PositionKind], nrm = er._buffers[KIND.NormalKind];
  assert.equal(pos.updatable, true, 'буфер позиций линий должен стать обновляемым');
  assert.equal(nrm.updatable, true, 'буфер нормалей линий должен стать обновляемым');
  // Инстансные буферы смотрят на те же объекты (рендерер рисует одни и те же линии).
  assert.equal(er._buffersForInstances[KIND.PositionKind], pos);
  assert.equal(er._buffersForInstances[KIND.NormalKind], nrm);
});

test('порт: меш с 5..8 влияниями берёт Extra-пару, меш с 4 — нет', { skip: SKIP }, () => {
  // The seam fixture gives vertex 0 half its weight to bone 0 (+100 X) and, through the Extra
  // pair, half to bone 2 (+100 Y). So the two builds MUST land in different places: this pins
  // the Extra path by its output, not by reading the port's private fields.
  const four = fakeSkinnedMesh(true, false);
  assert.ok(World3D.inkSkin(four), 'без Extra-пары хелпер строится');
  assert.equal(four.metadata.inkSkin.ok, true);
  const eight = fakeSkinnedMesh(true, true);
  assert.ok(World3D.inkSkin(eight), 'с Extra-парой хелпер строится');
  assert.equal(eight.metadata.inkSkin.ok, true);

  const at = (mesh) => [...mesh.edgesRenderer._buffers[KIND.PositionKind].data.slice(0, 3)];
  closeAll(at(four), [50, 0, 0], '4 влияния: половина сдвига кости 0 по X');
  closeAll(at(eight), [50, 50, 0], '8 влияний: плюс половина сдвига кости 2 по Y');
});

test('порт: буферы линий получают позу костей, а не rest-позу', { skip: SKIP }, () => {
  const mesh = fakeSkinnedMesh(true);
  World3D.inkMesh(mesh, 'actor');
  const er = mesh.edgesRenderer;
  const { from, to, used } = mapLineEnds(SEAM.pos, SEAM.idx, SEAM.linesPositions, SEAM.linesNormals);
  const posed = poseUsed(SEAM.pos, SEAM.bones, SEAM.weights, seamMatrices(), used);
  const want = expectedBuffers(SEAM.linesPositions, SEAM.linesNormals, from, to, posed);
  // updateDirectly линии пишет тот же массив, что отдаёт буфер.
  closeAll([...er._buffers[KIND.PositionKind].data], [...want.line], 'позиции концов');
  closeAll([...er._buffers[KIND.NormalKind].data], [...want.next], 'противоположные концы');
  // Rest-поза совпала бы с linesPositions — проверяем, что поза реально другая.
  assert.notDeepEqual([...er._buffers[KIND.PositionKind].data], SEAM.linesPositions, 'не rest-поза');
});

test('порт: inkMesh оставляет путь без скелета нетронутым', { skip: SKIP }, () => {
  const mesh = fakeSkinnedMesh(false);
  World3D.inkMesh(mesh, 'actor');
  const er = mesh.edgesRenderer;
  assert.equal(er._buffers[KIND.PositionKind].updatable, false, 'буферы не подменяются');
  World3D.inkMesh(mesh, 'actor');   // тот же eps — рендерер не пересобирается
  assert.equal(mesh.edgesRenderer, er, 'рендерер не пересоздаётся при том же eps');
  assert.equal(er._buffers[KIND.PositionKind].updatable, false, 'и не подменяется');
  assert.ok(!mesh.metadata.inkSkin, 'хелпера у меша без скелета нет');
  assert.equal(mesh.observers.size, 0, 'наблюдателя нет');
});