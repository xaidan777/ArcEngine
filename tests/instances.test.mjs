// Instances3D: the matrix of one copy (map x, y, height, heading, scale -> 16 floats of a Babylon
// thin instance) and the lint rule that advises instancing. Babylon is not loaded: the matrix
// is checked the way Babylon applies it — a row vector times the matrix.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

const page = loadScripts(['js/Constants.js', 'js/Instances3D.js', 'js/Debug3D.js'], { BABYLON: stub(), World3D: stub() });
const Instances3D = page.get('Instances3D');
const Debug3D = page.get('Debug3D');
const EPS = 1e-6;

// A model-space point -> the world: [x, y, z, 1] · M (Babylon matrices are for row vectors).
function apply(m, o, p) {
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = p[0] * m[o + c] + p[1] * m[o + 4 + c] + p[2] * m[o + 8 + c] + m[o + 12 + c];
  return out;
}
const close = (a, b, msg) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < EPS), msg + ': ' + a + ' != ' + b);

test('копия встаёт в точку карты: x -> X, высота -> Y, y карты -> Z', () => {
  const m = new Float32Array(16);
  Instances3D.fill(m, 0, { x: 300, y: 420, h: 55 });
  close(apply(m, 0, [0, 0, 0]), [300, 55, 420], 'начало модели');
  close(apply(m, 0, [10, 5, 0]), [310, 60, 420], 'без поворота и масштаба модель не меняется');
});

test('курс: нос модели (+X) смотрит по atan2(vy, vx) карты, как rotation.y = −heading', () => {
  const m = new Float32Array(16);
  for (const [heading, nose] of [[0, [1, 0, 0]], [Math.PI / 2, [0, 0, 1]], [Math.PI, [-1, 0, 0]], [-Math.PI / 2, [0, 0, -1]]]) {
    Instances3D.fill(m, 0, { x: 0, y: 0, h: 0, heading });
    close(apply(m, 0, [1, 0, 0]), nose, 'heading ' + heading);
    close(apply(m, 0, [0, 1, 0]), [0, 1, 0], 'вертикаль на месте');
  }
});

test('масштаб — число или тройка, применяется до поворота; запись i не трогает соседей', () => {
  const m = new Float32Array(48);
  m.fill(7);
  Instances3D.fill(m, 1, { x: 1, y: 2, h: 3, heading: Math.PI / 2, scale: [2, 3, 4] });
  // (1, 1, 1) -> scaled (2, 3, 4) -> heading π/2 turns +X to +Z and +Z to −X -> (−4, 3, 2) -> moved.
  close(apply(m, 16, [1, 1, 1]), [1 - 4, 3 + 3, 2 + 2], 'тройка');
  assert.ok([...m.slice(0, 16), ...m.slice(32)].every(v => v === 7));
  Instances3D.fill(m, 0, { x: 0, y: 0, h: 0, scale: 2 });
  close(apply(m, 0, [1, 1, 1]), [2, 2, 2], 'число');
  assert.equal(m[15], 1);
});

test('линтер: группы отдельных мешей-копий от порога, крупные первыми', () => {
  const list = [];
  for (let i = 0; i < 250; i++) list.push({ name: 'tree' + i, key: '38/96' });
  for (let i = 0; i < 300; i++) list.push({ name: 'rock' + i, key: '120/360' });
  for (let i = 0; i < 199; i++) list.push({ name: 'bush' + i, key: '64/180' });
  list.push({ name: 'mill', key: '5000/9000' });
  // Objects from the vm context are another realm: compare their JSON.
  const groups = JSON.parse(JSON.stringify(Debug3D.copyGroups(list, Debug3D.LIMITS.copies)));
  assert.deepEqual(groups.map(g => [g.name, g.count]), [['rock0', 300], ['tree0', 250]]);
  assert.equal(Debug3D.copyGroups(list, 1000).length, 0);
});
