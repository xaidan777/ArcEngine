// Debug3D without 3D: the winding rule of the scene lint, the normal map verdict and the held
// view pose. Babylon is a stub — only the pure parts are called.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

const page = loadScripts(['js/Debug3D.js'], { BABYLON: stub(), World3D: stub() });
const Debug3D = page.get('Debug3D');

// A unit quad in the XZ plane with normals up. Indices (0, 1, 2): cross(b - a, c - a) — down,
// AGAINST the normals (Babylon's clockwise convention); reversed — along them (glTF).
const P = [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1];
const N = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const CW = [0, 1, 2, 0, 2, 3];
const CCW = [0, 2, 1, 0, 3, 2];

test('обход граней: доля треугольников против нормалей вершин', () => {
  assert.equal(Debug3D.windingAgainstNormals(P, N, CW).against, 1);
  assert.equal(Debug3D.windingAgainstNormals(P, N, CCW).against, 0);
  assert.equal(Debug3D.windingAgainstNormals(P, N, [0, 1, 2, 0, 3, 2]).against, 0.5);
  // Вырожденный треугольник и нулевые нормали в счёт не идут.
  assert.equal(Debug3D.windingAgainstNormals(P, N, [0, 0, 1]).total, 0);
  assert.equal(Debug3D.windingAgainstNormals(P, new Array(12).fill(0), CW).total, 0);
  // Выборка: не больше maxTris треугольников, результат тот же.
  const many = [];
  for (let i = 0; i < 500; i++) many.push(...CW);
  const r = Debug3D.windingAgainstNormals(P, N, many, 100);
  assert.equal(r.against, 1);
  assert.ok(r.total <= 100, 'выборка ' + r.total);
});

test('вердикт стороны: CW ждёт обход против нормалей, CCW — по нормалям, зеркало меняет местами', () => {
  const v = (against, side, mirrored) => Debug3D.sideVerdict(against, side, mirrored).verdict;
  assert.equal(v(1, 0, false), 'ok');          // примитив Babylon, Terrain3D, Model3D
  assert.equal(v(0, 1, false), 'ok');          // glTF с CounterClockWiseSideOrientation
  assert.equal(v(0, 0, false), 'inverted');    // сетка с обходом glTF и стороной по умолчанию — изнанка
  assert.equal(v(1, 1, false), 'inverted');
  assert.equal(v(0, 0, true), 'ok');           // отрицательный масштаб переворачивает сторону
  assert.equal(v(1, 0, true), 'inverted');
  assert.equal(v(0.5, 0, false), 'mixed');     // двусторонние карточки
  assert.equal(v(0.95, 0, false), 'ok');       // единичные перевёрнутые треугольники — шум
  assert.equal(Debug3D.sideVerdict(0.2, 0, false).wrong, 0.8);
});

test('карта нормалей: в правосторонней сцене OpenGL-карте нужен invertNormalMapY, DirectX — нет', () => {
  const v = (url, invY, rh = true) => Debug3D.normalMapVerdict(url, invY, rh);
  assert.equal(v('assets/bark_nor_gl.jpg', true), 'ok');
  assert.equal(v('assets/bark_nor_gl.jpg', false), 'wrong');
  assert.equal(v('assets/bark_nor_dx.png', false), 'ok');
  assert.equal(v('assets/bark_nor_dx.png', true), 'wrong');
  assert.equal(v('assets/rock.glb#normal', false), 'wrong');
  assert.equal(v('assets/bark_normal.jpg', false), 'unknown');   // по имени конвенцию не узнать
  assert.equal(v('assets/bark_nor_gl.jpg', false, false), 'unknown');   // левосторонняя сцена — не судим
});

test('поза удержанного вида: глаз не ниже рельефа, цель — точкой или курсом и наклоном', () => {
  const terrain = { heightAt: () => 50 };
  const a = Debug3D.poseFrom({ eye: [100, 200, 10], target: [300, 400, 0] }, terrain);
  assert.equal(a.clamped, true);
  assert.equal(a.eye.h, 54);
  assert.deepEqual({ ...a.target }, { x: 300, y: 400, h: 0 });
  const b = Debug3D.poseFrom({ eye: [100, 200, 90], target: [0, 0, 0] }, terrain, 10);
  assert.equal(b.clamped, false);
  assert.equal(b.eye.h, 90);
  // Курс π/2 — вниз по карте (+y), наклон вверх поднимает цель.
  const c = Debug3D.poseFrom({ eye: [0, 0, 100], yaw: Math.PI / 2, pitch: 0.5 }, null);
  assert.ok(Math.abs(c.target.x) < 1e-6 && c.target.y > 80 && c.target.h > 140, JSON.stringify(c.target));
});
