// make-character.mjs — the kit's sample animated character: assets/models/character.glb.
// A blocky peaceful farmer 1.75 m tall (1.87 with the straw hat): overalls over a red shirt,
// boots, a beard, a pitchfork in the right hand. Faces +Z (the glTF front), skinned rigidly to
// 12 joints (11 of the body + "fork"), with two looped clips: "idle" — the fork stands upright,
// butt on the ground; "run" — the fork is carried over the shoulder. Everything is generated —
// no source file, no licence questions; replace it with a GLB exported from Blender.
//
//   node tools/make-character.mjs          # writes the file
//   node tools/make-character.mjs --check  # exit 1 if the file on disk differs
//
// glTF: meters, Y up, right-handed, counter-clockwise front faces, quaternions [x, y, z, w].
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'models', 'character.glb');

// Joints: bind position in model space; parent — an index into this list.
const JOINTS = [
  { name: 'hips', at: [0, 0.90, 0], parent: -1 },
  { name: 'torso', at: [0, 0.96, 0], parent: 0 },
  { name: 'head', at: [0, 1.48, 0], parent: 1 },
  { name: 'armL', at: [0.27, 1.40, 0], parent: 1 },
  { name: 'foreL', at: [0.27, 1.12, 0], parent: 3 },
  { name: 'armR', at: [-0.27, 1.40, 0], parent: 1 },
  { name: 'foreR', at: [-0.27, 1.12, 0], parent: 5 },
  { name: 'legL', at: [0.10, 0.90, 0], parent: 0 },
  { name: 'shinL', at: [0.10, 0.47, 0], parent: 7 },
  { name: 'legR', at: [-0.10, 0.90, 0], parent: 0 },
  { name: 'shinR', at: [-0.10, 0.47, 0], parent: 9 },
  // The pitchfork: sits in the right fist, a child of the forearm. The clips turn and slide it
  // against the hand (holdFork), so it keeps its own heading whatever the arm does.
  { name: 'fork', at: [-0.27, 0.85, 0], parent: 6 },
];
const J = Object.fromEntries(JOINTS.map((j, i) => [j.name, i]));

// sRGB hex -> linear RGB (glTF baseColorFactor).
const linear = hex => [1, 3, 5].map((i) => {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return +(v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).toFixed(4);
});
const MATERIALS = [
  { name: 'skin', color: linear('#d9996b') },
  { name: 'shirt', color: linear('#b8442f') },
  { name: 'denim', color: linear('#3d639b') },
  { name: 'straw', color: linear('#e6c565') },
  { name: 'leather', color: linear('#5a381f') },   // boots, hat band, eyes
  { name: 'hair', color: linear('#d6d1c6') },      // grey: readable in the shadow of the brim
  { name: 'wood', color: linear('#a87a48') },
  { name: 'steel', color: linear('#8a9198') },
];
const M = Object.fromEntries(MATERIALS.map((m, i) => [m.name, i]));

// Parts, rigid on one joint. A box: center c, size s. A round part (s absent) — a frustum about
// the vertical axis: center c, height h, radii r [bottom, top], n sides, smooth side normals.
const SIDES = [1, -1];   // left (+X), right (−X)
const FORK_X = JOINTS[J.fork].at[0];
const FORK_BUTT = 0.05;  // bind pose: the height of the handle's lower end
const PARTS = [
  // Head: face, beard and hair.
  { c: [0, 1.62, 0], s: [0.24, 0.26, 0.24], joint: J.head, mat: M.skin },
  { c: [0, 1.60, 0.135], s: [0.045, 0.06, 0.04], joint: J.head, mat: M.skin },
  ...SIDES.map(k => ({ c: [0.055 * k, 1.655, 0.122], s: [0.035, 0.035, 0.012], joint: J.head, mat: M.leather })),
  { c: [0, 1.525, 0.03], s: [0.25, 0.09, 0.20], joint: J.head, mat: M.hair },
  { c: [0, 1.575, 0.125], s: [0.14, 0.03, 0.03], joint: J.head, mat: M.hair },
  { c: [0, 1.635, -0.115], s: [0.25, 0.17, 0.03], joint: J.head, mat: M.hair },
  ...SIDES.map(k => ({ c: [0.118 * k, 1.65, -0.03], s: [0.02, 0.14, 0.16], joint: J.head, mat: M.hair })),
  // Straw hat: brim, crown, band.
  { c: [0, 1.72, 0], h: 0.03, r: [0.31, 0.29], n: 20, joint: J.head, mat: M.straw },
  { c: [0, 1.80, 0], h: 0.13, r: [0.18, 0.15], n: 20, joint: J.head, mat: M.straw },
  { c: [0, 1.755, 0], h: 0.04, r: [0.187, 0.181], n: 20, joint: J.head, mat: M.leather },
  // Torso: shirt, neck, overalls (waist, bib, straps over the shoulders, brass buttons).
  { c: [0, 1.20, 0], s: [0.40, 0.50, 0.22], joint: J.torso, mat: M.shirt },
  { c: [0, 1.47, 0], s: [0.11, 0.06, 0.11], joint: J.torso, mat: M.skin },
  { c: [0, 1.02, 0], s: [0.41, 0.15, 0.23], joint: J.torso, mat: M.denim },
  { c: [0, 1.20, 0.113], s: [0.25, 0.22, 0.016], joint: J.torso, mat: M.denim },
  ...SIDES.flatMap(k => [
    { c: [0.095 * k, 1.385, 0.113], s: [0.045, 0.15, 0.016], joint: J.torso, mat: M.denim },
    { c: [0.095 * k, 1.456, 0], s: [0.045, 0.012, 0.242], joint: J.torso, mat: M.denim },
    { c: [0.095 * k, 1.28, -0.113], s: [0.045, 0.36, 0.016], joint: J.torso, mat: M.denim },
    { c: [0.095 * k, 1.295, 0.124], s: [0.028, 0.028, 0.008], joint: J.torso, mat: M.straw },
  ]),
  { c: [0, 0.89, 0], s: [0.37, 0.14, 0.21], joint: J.hips, mat: M.denim },
  // Arms: sleeve rolled up to the elbow, bare forearm, fist. Legs: denim, boots.
  ...SIDES.flatMap((k) => {
    const arm = k > 0 ? J.armL : J.armR, fore = k > 0 ? J.foreL : J.foreR;
    const leg = k > 0 ? J.legL : J.legR, shin = k > 0 ? J.shinL : J.shinR;
    return [
      { c: [0.27 * k, 1.26, 0], s: [0.11, 0.30, 0.11], joint: arm, mat: M.shirt },
      { c: [0.27 * k, 1.125, 0], s: [0.125, 0.05, 0.125], joint: arm, mat: M.shirt },
      { c: [0.27 * k, 1.00, 0], s: [0.095, 0.24, 0.095], joint: fore, mat: M.skin },
      { c: [0.27 * k, 0.85, 0], s: [0.11, 0.10, 0.12], joint: fore, mat: M.skin },
      { c: [0.10 * k, 0.685, 0], s: [0.15, 0.45, 0.15], joint: leg, mat: M.denim },
      { c: [0.10 * k, 0.34, 0], s: [0.13, 0.26, 0.13], joint: shin, mat: M.denim },
      { c: [0.10 * k, 0.16, 0], s: [0.15, 0.16, 0.15], joint: shin, mat: M.leather },
      { c: [0.10 * k, 0.045, 0.025], s: [0.15, 0.09, 0.21], joint: shin, mat: M.leather },
    ];
  }),
  // Pitchfork, upright through the right fist: handle, socket, crossbar, three tines.
  { c: [FORK_X, FORK_BUTT + 0.65, 0], h: 1.30, r: [0.017, 0.015], n: 8, joint: J.fork, mat: M.wood },
  { c: [FORK_X, 1.365, 0], h: 0.07, r: [0.022, 0.020], n: 8, joint: J.fork, mat: M.steel },
  { c: [FORK_X, 1.41, 0], s: [0.21, 0.024, 0.024], joint: J.fork, mat: M.steel },
  ...[-0.093, 0, 0.093].map(dx => ({ c: [FORK_X + dx, 1.56, 0], h: 0.28, r: [0.011, 0.003], n: 6, joint: J.fork, mat: M.steel })),
];

// Box faces: normal and four corners counter-clockwise as seen from outside.
const FACES = [
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

function addBox(out, b) {
  for (const f of FACES) {
    const base = out.positions.length / 3;
    for (const v of f.v) {
      out.positions.push(b.c[0] + v[0] * b.s[0] / 2, b.c[1] + v[1] * b.s[1] / 2, b.c[2] + v[2] * b.s[2] / 2);
      out.normals.push(...f.n);
      out.joints.push(b.joint, 0, 0, 0);
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// Frustum: a side ring pair with smooth normals, two flat caps (a fan around the center).
function addRound(out, p) {
  const y0 = p.c[1] - p.h / 2, y1 = p.c[1] + p.h / 2, n = p.n;
  const slope = (p.r[0] - p.r[1]) / p.h, len = Math.hypot(1, slope);
  const ring = (y, r, normal) => {
    const base = out.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n, cos = Math.cos(a), sin = Math.sin(a);
      out.positions.push(p.c[0] + r * cos, y, p.c[2] + r * sin);
      out.normals.push(...(normal || [cos / len, slope / len, sin / len]));
      out.joints.push(p.joint, 0, 0, 0);
    }
    return base;
  };
  const center = (y, normal) => {
    out.positions.push(p.c[0], y, p.c[2]);
    out.normals.push(...normal);
    out.joints.push(p.joint, 0, 0, 0);
    return out.positions.length / 3 - 1;
  };
  const b = ring(y0, p.r[0]), t = ring(y1, p.r[1]);
  const bc = center(y0, [0, -1, 0]), bcap = ring(y0, p.r[0], [0, -1, 0]);
  const tc = center(y1, [0, 1, 0]), tcap = ring(y1, p.r[1], [0, 1, 0]);
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    out.indices.push(b + i, t + i, t + k, b + i, t + k, b + k);
    out.indices.push(bc, bcap + i, bcap + k, tc, tcap + k, tcap + i);
  }
}

// Every triangle must run counter-clockwise from outside (cross product along the vertex
// normals): the loader sets the side orientation from that, a flipped part renders inside out.
function checkWinding(p, material) {
  const at = i => p.positions.slice(i * 3, i * 3 + 3);
  for (let i = 0; i < p.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => at(p.indices[i + k]));
    const u = b.map((v, k) => v - a[k]), w = c.map((v, k) => v - a[k]);
    const cross = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const normal = [0, 1, 2].map(k => p.normals[p.indices[i] * 3 + k] + p.normals[p.indices[i + 1] * 3 + k] + p.normals[p.indices[i + 2] * 3 + k]);
    if (cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] <= 0) throw new Error(`${material}: triangle ${i / 3} is wound against its normals`);
  }
}

// One primitive per material: { positions, normals, joints, indices }.
function buildPrimitives() {
  return MATERIALS.map((m, mat) => {
    const out = { positions: [], normals: [], joints: [], indices: [] };
    for (const p of PARTS.filter(x => x.mat === mat)) (p.s ? addBox : addRound)(out, p);
    checkWinding(out, m.name);
    return out;
  });
}

// --- Clips -----------------------------------------------------------------------

const DEG = Math.PI / 180;
const rotX = a => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const rotY = a => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const rotZ = a => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = q => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)).slice(0, 3);
const add = (a, b) => a.map((v, k) => v + b[k]);
const sub = (a, b) => a.map((v, k) => v - b[k]);

// World rotation q and position p of a joint under a pose; a track the pose lacks stays at bind.
function worldOf(pose, index) {
  const j = JOINTS[index];
  const parent = j.parent < 0 ? { q: [0, 0, 0, 1], p: [0, 0, 0] } : worldOf(pose, j.parent);
  const t = pose[j.name + '.translation'] || (j.parent < 0 ? j.at : sub(j.at, JOINTS[j.parent].at));
  const r = pose[j.name + '.rotation'] || [0, 0, 0, 1];
  return { q: qmul(parent.q, r), p: add(parent.p, qrot(parent.q, t)) };
}

// The pitchfork in the right fist. aim — its world rotation (identity: upright, tines up, their
// plane facing forward); grip — meters of the handle between the butt and the fist, 'ground' —
// as many as it takes to plant the butt on the ground. The fist stays on the handle's axis: the
// fork turns against the forearm and slides through the hand.
const FORK_SINK = 0.02;  // the planted butt goes this deep: the ground under it may slope away
function holdFork(pose, aim, grip) {
  const hand = worldOf(pose, J.foreR), inv = qconj(hand.q);
  const local = sub(JOINTS[J.fork].at, JOINTS[J.foreR].at);
  const fist = add(hand.p, qrot(hand.q, local)), up = qrot(aim, [0, 1, 0]);
  const length = grip === 'ground' ? (fist[1] + FORK_SINK) / up[1] : grip;
  const slide = length - (JOINTS[J.fork].at[1] - FORK_BUTT);
  const q = qmul(inv, aim);
  pose['fork.rotation'] = q[3] < 0 ? q.map(v => -v) : q;
  pose['fork.translation'] = sub(local, qrot(inv, up.map(v => v * slide)));
  return pose;
}

// The model faces +Z: a limb hanging down swings FORWARD on a NEGATIVE angle about X.
// frames + 1 keys, the last one repeats the first — the loop has no seam.
function clip(name, duration, frames, pose) {
  const times = [], tracks = new Map();
  for (let i = 0; i <= frames; i++) {
    times.push(duration * i / frames);
    const p = pose(2 * Math.PI * (i % frames) / frames);
    for (const [key, value] of Object.entries(p)) {
      if (!tracks.has(key)) tracks.set(key, []);
      tracks.get(key).push(value);
    }
  }
  return { name, times, tracks };
}

const CLIPS = [
  // Standing with the fork upright at the right side: elbow bent, the fist on the handle at
  // chest height, the butt on the ground, the top leaning slightly away from the hat.
  clip('idle', 2.4, 12, (t) => holdFork({
    'hips.translation': [0, 0.90 + 0.006 * Math.sin(t), 0],
    'torso.rotation': rotX(1.5 * DEG * Math.sin(t)),
    'head.rotation': rotY(6 * DEG * Math.sin(t)),
    'armL.rotation': rotX(-3 * DEG * Math.sin(t)),
    'foreL.rotation': rotX(-8 * DEG),
    'armR.rotation': qmul(rotZ(-7 * DEG), rotX((-14 + Math.sin(t)) * DEG)),
    'foreR.rotation': rotX(-70 * DEG),
  }, rotZ(3 * DEG), 'ground')),
  // The left arm swings, the right one carries the fork over the shoulder, tines up behind.
  clip('run', 0.64, 16, (t) => holdFork({
    'hips.translation': [0, 0.88 + 0.035 * Math.abs(Math.sin(t)), 0],
    'torso.rotation': rotX(9 * DEG),
    'head.rotation': rotX(-5 * DEG),
    'legL.rotation': rotX(-42 * DEG * Math.sin(t)),
    'legR.rotation': rotX(42 * DEG * Math.sin(t)),
    'shinL.rotation': rotX(70 * DEG * Math.max(0, Math.sin(t - 2.2))),
    'shinR.rotation': rotX(70 * DEG * Math.max(0, Math.sin(t - 2.2 + Math.PI))),
    'armL.rotation': rotX(38 * DEG * Math.sin(t)),
    'foreL.rotation': rotX(-75 * DEG),
    'armR.rotation': rotX((-25 + 3 * Math.sin(2 * t)) * DEG),
    'foreR.rotation': rotX(-115 * DEG),
  }, rotX((-65 + 2 * Math.sin(2 * t + 0.6)) * DEG), 0.22)),
];

// --- glTF ------------------------------------------------------------------------

const FLOAT = 5126, USHORT = 5123, UBYTE = 5121;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

function buildGlb() {
  const chunks = [], bufferViews = [], accessors = [];
  let offset = 0;
  const view = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - bytes.length % 4) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes, Buffer.alloc(pad));
    offset += bytes.length + pad;
    return bufferViews.length - 1;
  };
  const accessor = (typed, componentType, type, width, target, bounds) => {
    const a = { bufferView: view(typed, target), componentType, count: typed.length / width, type };
    if (bounds) {
      a.min = Array.from({ length: width }, (_, k) => Math.min(...typed.filter((__, i) => i % width === k)));
      a.max = Array.from({ length: width }, (_, k) => Math.max(...typed.filter((__, i) => i % width === k)));
    }
    accessors.push(a);
    return accessors.length - 1;
  };

  const primitives = buildPrimitives().map((p, mat) => ({
    attributes: {
      POSITION: accessor(new Float32Array(p.positions), FLOAT, 'VEC3', 3, ARRAY_BUFFER, true),
      NORMAL: accessor(new Float32Array(p.normals), FLOAT, 'VEC3', 3, ARRAY_BUFFER),
      JOINTS_0: accessor(new Uint8Array(p.joints), UBYTE, 'VEC4', 4, ARRAY_BUFFER),
      WEIGHTS_0: accessor(new Float32Array(p.joints.map((_, i) => (i % 4 === 0 ? 1 : 0))), FLOAT, 'VEC4', 4, ARRAY_BUFFER),
    },
    indices: accessor(new Uint16Array(p.indices), USHORT, 'SCALAR', 1, ELEMENT_ARRAY_BUFFER),
    material: mat,
  }));

  // The bind pose has no rotations: the inverse bind matrix is a translation by −position.
  const inverseBind = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach((j, i) => inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -j.at[0], -j.at[1], -j.at[2], 1], i * 16));
  const inverseBindMatrices = accessor(inverseBind, FLOAT, 'MAT4', 16);

  // Nodes: 0 — the skinned mesh, 1… — joints (node = joint index + 1).
  const nodes = [{ name: 'character', mesh: 0, skin: 0 }];
  JOINTS.forEach((j, i) => {
    const p = j.parent < 0 ? [0, 0, 0] : JOINTS[j.parent].at;
    const children = JOINTS.map((c, k) => (c.parent === i ? k + 1 : 0)).filter(Boolean);
    nodes.push({ name: j.name, translation: j.at.map((v, k) => +(v - p[k]).toFixed(6)), ...(children.length ? { children } : {}) });
  });

  const animations = CLIPS.map((c) => {
    const input = accessor(new Float32Array(c.times), FLOAT, 'SCALAR', 1, 0, true);
    const samplers = [], channels = [];
    for (const [key, values] of c.tracks) {
      const [joint, prop] = key.split('.');
      const width = prop === 'rotation' ? 4 : 3;
      samplers.push({ input, output: accessor(new Float32Array(values.flat()), FLOAT, width === 4 ? 'VEC4' : 'VEC3', width), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: J[joint] + 1, path: prop } });
    }
    return { name: c.name, samplers, channels };
  });

  const gltf = {
    asset: { version: '2.0', generator: 'ArcEngine tools/make-character.mjs' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes,
    meshes: [{ name: 'character', primitives }],
    skins: [{ joints: JOINTS.map((_, i) => i + 1), skeleton: 1, inverseBindMatrices }],
    materials: MATERIALS.map(m => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: 0, roughnessFactor: 1 } })),
    animations,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const pad4 = (buf, fill) => Buffer.concat([buf, Buffer.alloc((4 - buf.length % 4) % 4, fill)]);
  const json = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const bin = pad4(Buffer.concat(chunks), 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunkHeader = (length, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(length, 0);
    h.write(type, 4, 'latin1');
    return h;
  };
  return Buffer.concat([header, chunkHeader(json.length, 'JSON'), json, chunkHeader(bin.length, 'BIN\0'), bin]);
}

export { buildGlb, OUT, CLIPS, JOINTS };

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const glb = buildGlb();
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT).equals(glb);
    console.log(same ? 'character.glb is up to date' : 'character.glb differs from the generator');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(OUT, glb);
  console.log(`${path.relative(ROOT, OUT)}: ${glb.length} bytes, ${JOINTS.length} joints, clips: ${CLIPS.map(c => c.name).join(', ')}`);
}
