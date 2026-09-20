// Editor writes (_utils/editor/save.mjs): number patching of Constants.js and the whole Objects.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { formatObjects, patchScalar, saveConstants, saveObjects } from '../_utils/editor/save.mjs';
import { collectRefs } from '../tools/asset-scan.mjs';
import { ROOT } from './browser-scripts.mjs';

const temps = [];
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

function tempRoot(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcengine-editor-'));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const backups = (root, prefix) => {
  const dir = path.join(root, '_utils', '.backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(prefix + '-')).sort() : [];
};

// Values of the source's top-level consts (as the game will see them).
function evalConsts(src, names) {
  const ctx = vm.createContext({ navigator: {}, window: {}, innerWidth: 1, innerHeight: 1 });
  vm.runInContext(src, ctx);
  return Object.fromEntries(names.map(n => [n, vm.runInContext(n, ctx)]));
}

// --- Constants.js ---------------------------------------------------------------

test('patchScalar: число, hex остаётся hex, хвост строки и соседние имена не трогаются', () => {
  const src = [
    'const CAMERA_ZOOM = 1;              // стартовый зум',
    'const CAMERA_ZOOM_MIN = 0.5;',
    'const WORLD3D_SKY_COLOR = 0x8fc3e0; // цвет неба',
    '// const CAMERA_FOV_DEG = 10;',
    'const CAMERA_FOV_DEG = 52;',
  ].join('\n');
  let r = patchScalar(src, 'CAMERA_ZOOM', 1.25);
  assert.match(r.src, /^const CAMERA_ZOOM = 1\.25;              \/\/ стартовый зум$/m);
  assert.match(r.src, /^const CAMERA_ZOOM_MIN = 0\.5;$/m);
  r = patchScalar(r.src, 'WORLD3D_SKY_COLOR', 0x0000ff);
  assert.match(r.src, /^const WORLD3D_SKY_COLOR = 0x0000ff; \/\/ цвет неба$/m);
  r = patchScalar(r.src, 'CAMERA_FOV_DEG', 60);
  assert.match(r.src, /^\/\/ const CAMERA_FOV_DEG = 10;$/m, 'закомментированная строка не меняется');
  assert.match(r.src, /^const CAMERA_FOV_DEG = 60;$/m);
  assert.equal(patchScalar(src, 'CAMERA_ZOOM', 0.1 + 0.2).src.split('\n')[0].slice(0, 25), 'const CAMERA_ZOOM = 0.3; ');
});

test('patchScalar: отказы — формула, нет имени, не число, отрицательный цвет', () => {
  const src = 'const A = 2 * 3;\nconst B = 4;\nconst C = 0xffffff;\n';
  assert.equal(patchScalar(src, 'A', 1).code, 'not_literal');
  assert.equal(patchScalar(src, 'Z', 1).code, 'not_found');
  assert.equal(patchScalar(src, 'B', 'abc').code, 'bad_value');
  assert.equal(patchScalar(src, 'B', Infinity).code, 'bad_value');
  assert.equal(patchScalar(src, 'C', -1).code, 'bad_value');
});

test('saveConstants: BOM, бэкап, частичный отказ, неверное имя', async () => {
  const original = '\uFEFFconst A = 1;\nconst B = 0x102030;\nconst F = A * 2;\n';
  const root = tempRoot({ 'js/Constants.js': original });
  const r = await saveConstants(root, [
    { name: 'A', value: 3 }, { name: 'B', value: 0xabcdef }, { name: 'F', value: 1 }, { name: 'A.B', value: 1 },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.patched, 2);
  assert.deepEqual(r.results.map(x => x.code || 'ok'), ['ok', 'ok', 'not_literal', 'bad_name']);
  assert.equal(read(root, 'js/Constants.js'), '\uFEFFconst A = 3;\nconst B = 0xabcdef;\nconst F = A * 2;\n');
  assert.equal(r.backup, '_utils/.backups/' + backups(root, 'Constants')[0]);
  assert.equal(read(root, r.backup), original);
});

test('saveConstants: ничего не подошло — файл и бэкапы не трогаются', async () => {
  const root = tempRoot({ 'js/Constants.js': 'const A = 1;\n' });
  const r = await saveConstants(root, [{ name: 'NOPE', value: 1 }]);
  assert.equal(r.patched, 0);
  assert.equal(read(root, 'js/Constants.js'), 'const A = 1;\n');
  assert.deepEqual(backups(root, 'Constants'), []);
  assert.equal((await saveConstants(root, [])).ok, false);
});

test('бэкапов хранится 20 последних', async () => {
  const old = {};
  for (let i = 10; i < 35; i++) old[`_utils/.backups/Constants-2000-01-01-00-00-${i}.js`] = 'old';
  const root = tempRoot({ 'js/Constants.js': 'const A = 1;\n', ...old });
  const r = await saveConstants(root, [{ name: 'A', value: 2 }]);
  const left = backups(root, 'Constants');
  assert.equal(left.length, 20);
  assert.ok(left.includes(path.basename(r.backup)), 'свежий бэкап на месте');
  assert.ok(!left.includes('Constants-2000-01-01-00-00-10.js'), 'старейшие удалены');
});

test('каждое число настоящего Constants.js редактор может перезаписать без потерь', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'Constants.js'), 'utf8').replace(/^\uFEFF/, '');
  const names = [...src.matchAll(/^const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?|0[xX][0-9a-fA-F]+)\s*;/gm)].map(m => m[1]);
  assert.ok(names.length > 50, 'констант найдено: ' + names.length);
  const before = evalConsts(src, names);
  let patched = src;
  for (const name of names) {
    const r = patchScalar(patched, name, before[name]);
    assert.equal(r.code, undefined, name);
    patched = r.src;
  }
  assert.deepEqual(evalConsts(patched, names), before);
});

// --- Objects.js ------------------------------------------------------------------

const MILL = {
  name: 'mill', model: 'assets/models/mill.fbx', kind: 'prop', x: 1149.63, y: 857.14, h: 8.8,
  rot: [0, 34.44, 0], scale: [1.3604, 1.36, 1.36], anim: { part: 'w1..003', axis: '-y', speed: 10, dir: 'ccw' },
};

function evalObjects(src) {
  new vm.Script(src, { filename: 'Objects.js' });   // syntax — like node --check
  return JSON.parse(JSON.stringify(vm.runInContext(src + '\nLOCATION_OBJECTS', vm.createContext({}))));
}

test('Objects.js: запись читается игрой, числа округлены, старый формат развёрнут', () => {
  const r = formatObjects([
    MILL,
    { name: 'bush', model: 'assets/models/Bush_3.fbx', kind: 'actor', x: 1, y: 2, h: 0, rot: 90, scale: 2 },
    { name: 'rock', model: 'assets/rock.FBX', kind: 'boulder', x: '3', y: 4, h: -1, rot: [1, 2, 3], scale: [1, 1, 1], anim: { part: 'p', axis: 'z', speed: 0, dir: 'up' } },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
  assert.deepEqual(evalObjects(r.src), [
    { name: 'mill', model: 'assets/models/mill.fbx', kind: 'prop', x: 1149.6, y: 857.1, h: 8.8, rot: [0, 34.4, 0], scale: [1.36, 1.36, 1.36], anim: { part: 'w1..003', axis: '-y', speed: 10, dir: 'ccw' } },
    { name: 'bush', model: 'assets/models/Bush_3.fbx', kind: 'actor', x: 1, y: 2, h: 0, rot: [0, 90, 0], scale: [2, 2, 2] },
    { name: 'rock', model: 'assets/rock.FBX', kind: 'prop', x: 3, y: 4, h: -1, rot: [1, 2, 3], scale: [1, 1, 1], anim: { part: 'p', axis: 'z', speed: 0, dir: 'cw' } },
  ]);
});

test('Objects.js: модель .glb и её клип пишутся, пустой клип — нет', () => {
  const hero = { name: 'hero', model: 'assets/models/character.glb', kind: 'actor', x: 1, y: 2, h: 0, rot: [0, 0, 0], scale: [1, 1, 1] };
  const r = formatObjects([{ ...hero, clip: "id'le" }, { ...hero, name: 'npc', clip: '' }]);
  assert.equal(r.ok, true);
  assert.deepEqual(evalObjects(r.src), [{ ...hero, clip: 'idle' }, { ...hero, name: 'npc' }]);
  assert.equal(formatObjects([{ ...hero, model: 'assets/models/character.gltf' }]).code, 'bad_model');
});

test('Objects.js: кавычки и управляющие символы в имени не ломают файл', () => {
  const r = formatObjects([{ ...MILL, name: "it's \"big\"\\\n`mill`", anim: { ...MILL.anim, part: "w'1" } }]);
  const [obj] = evalObjects(r.src);
  assert.equal(obj.name, 'its bigmill');
  assert.equal(obj.anim.part, 'w1');
});

test('Objects.js: негодные записи отклоняются с номером', () => {
  const bad = (patch) => formatObjects([MILL, { ...MILL, ...patch }]);
  for (const model of ['assets/models/../mill.fbx', 'assets/My Model.fbx', 'models/mill.fbx', 'assets/models/mill.obj', 'assets/./mill.fbx', 'assets/модель.fbx']) {
    assert.deepEqual([bad({ model }).code, bad({ model }).index], ['bad_model', 1], model);
  }
  for (const patch of [{ x: 'abc' }, { h: undefined }, { scale: [1, 0, 1] }, { scale: -2 }, { rot: [1, 2] },
    { anim: { part: 'p', axis: 'w', speed: 1 } }, { anim: { part: 'p', axis: 'x', speed: -1 } }, { anim: { part: "''", axis: 'x', speed: 1 } }]) {
    assert.equal(bad(patch).code, 'bad_value', JSON.stringify(patch));
  }
  assert.equal(formatObjects({}).code, 'bad_objects');
});

test('saveObjects: файл с бэкапом, негодный список файл не трогает, сканер видит модели', async () => {
  const root = tempRoot({ 'js/Objects.js': 'const LOCATION_OBJECTS = [];\n', 'assets/models/mill.fbx': 'fbx' });
  const r = await saveObjects(root, [MILL]);
  assert.equal(r.ok, true);
  assert.equal(read(root, r.backup), 'const LOCATION_OBJECTS = [];\n');
  const written = read(root, 'js/Objects.js');
  assert.equal(evalObjects(written).length, 1);

  assert.equal((await saveObjects(root, [{ ...MILL, model: 'C:/mill.fbx' }])).code, 'bad_model');
  assert.equal(read(root, 'js/Objects.js'), written);

  const scan = await collectRefs(root);
  assert.deepEqual(scan.refs, ['assets/models/mill.fbx'], 'шапка файла не даёт ложных ссылок');
  assert.deepEqual(scan.missing, []);
});

test('Objects.js: тег и скрытый объект пишутся, пустые — нет', () => {
  const r = formatObjects([{ ...MILL, tag: "co'in", hidden: true }, { ...MILL, name: 'x', tag: '', hidden: false }]);
  assert.equal(r.ok, true);
  const [tagged, plain] = evalObjects(r.src);
  assert.equal(tagged.tag, 'coin');
  assert.equal(tagged.hidden, true);
  assert.equal('tag' in plain, false);
  assert.equal('hidden' in plain, false);
});

test('Objects.js: звук объекта пишется, значения по умолчанию опускаются, негодный отклоняется', () => {
  const sound = { src: 'assets/sounds/mill.mp3', volume: 0.55, loop: false, falloffMin: 40, falloffMax: 900 };
  const [full, lean] = evalObjects(formatObjects([{ ...MILL, sound },
    { ...MILL, name: 'x', sound: { src: 'assets/sounds/mill.mp3', volume: 1, loop: true, falloffMin: 0, falloffMax: 0 } }]).src);
  assert.deepEqual(full.sound, sound);
  assert.deepEqual(lean.sound, { src: 'assets/sounds/mill.mp3' }, 'громкость 1, по кругу, общие радиусы — не пишутся');
  const bad = (s) => formatObjects([MILL, { ...MILL, sound: s }]);
  for (const s of [{ src: 'assets/sounds/hit.exe' }, { src: 'sounds/hit.wav' }, { src: 'assets/../hit.wav' }, { src: 'assets/Мой звук.wav' },
    { src: 'assets/sounds/hit.wav', volume: 2 }, { src: 'assets/sounds/hit.wav', volume: 'loud' },
    { src: 'assets/sounds/hit.wav', falloffMax: -5 }, { src: 'assets/sounds/hit.wav', falloffMin: -1 }, {}]) {
    assert.deepEqual([bad(s).code, bad(s).index], ['bad_value', 1], JSON.stringify(s));
  }
});

test('js/Objects.js набора записан редактором: формат воспроизводится', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/Objects.js'), 'utf8').replace(/\r\n/g, '\n');
  const r = formatObjects(evalObjects(src));
  assert.equal(r.ok, true);
  assert.equal(r.src, src);
});
