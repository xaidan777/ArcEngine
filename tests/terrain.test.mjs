// Terrain3D.heightAt: высота под точкой — ровно та, что рисует меш. Babylon — пустышка:
// проверяется поле высот и выбор треугольника, не картинка.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

const SCRIPTS = ['Constants.js', 'libs/simplex-noise.js', 'Terrain3D.js'];
const EPS = 1e-3;   // поле высот — Float32Array

function makeTerrain(noise = {}, cfg = {}, globals = {}) {
  const page = loadScripts(SCRIPTS, { BABYLON: stub(), World3D: stub(), ...globals });
  const Terrain3D = page.get('Terrain3D');
  return new Terrain3D({ scene: stub() }, {
    worldW: 512, worldH: 384, cell: 8,
    noise: { amp: 66, scale: 800, seed: 4, base: 0, ...noise },
    ...cfg,
  });
}

// Клетка (i, j) с заметно разными диагоналями: там билинейная интерполяция и
// «не та» диагональ дали бы другую высоту.
function bentCell(t) {
  const n = t.nx, g = t.hgrid;
  let best = null;
  for (let j = 0; j < t.ny - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const bend = Math.abs((g[j * n + i] + g[(j + 1) * n + i + 1]) - (g[j * n + i + 1] + g[(j + 1) * n + i]));
      if (!best || bend > best.bend) best = { i, j, bend };
    }
  }
  return best;
}

test('в узлах сетки — шум рельефа', () => {
  const t = makeTerrain();
  for (const [i, j] of [[0, 0], [3, 7], [t.nx - 1, t.ny - 1], [20, 11]]) {
    const x = i * t.cell, y = j * t.cell;
    assert.ok(Math.abs(t.heightAt(x, y) - t.terrainNoise(x, y)) < EPS, `узел ${i},${j}`);
  }
});

test('клетка режется диагональю (i,j)-(i+1,j+1), как индексы меша', () => {
  const t = makeTerrain();
  const { i, j, bend } = bentCell(t);
  assert.ok(bend > 0.01, 'в поле есть неплоская клетка');
  const n = t.nx, g = t.hgrid, cs = t.cell;
  const h00 = g[j * n + i], h11 = g[(j + 1) * n + i + 1];
  const h10 = g[j * n + i + 1], h01 = g[(j + 1) * n + i];
  // Центр клетки лежит на диагонали 00-11: средняя высота её концов.
  const center = t.heightAt((i + 0.5) * cs, (j + 0.5) * cs);
  assert.ok(Math.abs(center - (h00 + h11) / 2) < EPS);
  assert.ok(Math.abs(center - (h00 + h10 + h01 + h11) / 4) > EPS / 2, 'не билинейная');
  // Меш режет клетку той же диагональю: оба треугольника клетки сетки 3×3 содержат
  // её углы a = 0 и d = 4 (при любом обходе).
  const idx = Array.from(t.constructor.gridIndices(3, 3, t._swap)).slice(0, 6);
  for (const tri of [idx.slice(0, 3), idx.slice(3)]) assert.ok(tri.includes(0) && tri.includes(4), 'треугольник ' + tri);
});

test('поверхность непрерывна: на рёбрах треугольников высоты сходятся', () => {
  const t = makeTerrain();
  const cs = t.cell, d = 1e-4;
  for (let k = 0; k < 200; k++) {
    // Клетки не у края сетки: за краем heightAt уже читает шум.
    const i = (k * 7) % (t.nx - 2), j = (k * 13) % (t.ny - 2), s = ((k * 37) % 97) / 97;
    const x0 = i * cs, y0 = j * cs;
    // Диагональ клетки и её рёбра (правое, нижнее) — с двух сторон.
    const diag = [x0 + s * cs, y0 + s * cs];
    assert.ok(Math.abs(t.heightAt(diag[0] + d, diag[1] - d) - t.heightAt(diag[0] - d, diag[1] + d)) < EPS);
    assert.ok(Math.abs(t.heightAt(x0 + cs - d, y0 + s * cs) - t.heightAt(x0 + cs + d, y0 + s * cs)) < EPS);
    assert.ok(Math.abs(t.heightAt(x0 + s * cs, y0 + cs - d) - t.heightAt(x0 + s * cs, y0 + cs + d)) < EPS);
  }
});

test('за краем сетки — шум, как у кольца земли', () => {
  const t = makeTerrain();
  for (const [x, y] of [[-40, 10], [10, -5], [t.worldW + 100, 50], [30, t.worldH + 64]]) {
    assert.equal(t.heightAt(x, y), t.terrainNoise(x, y));
  }
});

test('амплитуда 0 — ровная земля на базовой высоте, наклона нет', () => {
  const t = makeTerrain({ amp: 0, base: 12 });
  for (const [x, y] of [[0, 0], [100.5, 77.25], [511, 383], [-50, 900]]) assert.equal(t.heightAt(x, y), 12);
  const tilt = t.tiltAt(200, 150, 0.7, 30, 12);
  assert.equal(tilt.pitch, 0);
  assert.equal(tilt.roll, 0);
});

test('один сид — одно поле, другой сид — другое', () => {
  const a = makeTerrain({ seed: 4 }), b = makeTerrain({ seed: 4 }), c = makeTerrain({ seed: 5 });
  assert.deepEqual(Array.from(a.hgrid), Array.from(b.hgrid));
  assert.notDeepEqual(Array.from(a.hgrid), Array.from(c.hgrid));
});

test('на телефоне клетка не мельче 12 px', () => {
  const phone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', platform: 'iPhone', maxTouchPoints: 5 };
  assert.equal(makeTerrain({}, { cell: 8 }, { navigator: phone }).cell, 12);
  assert.equal(makeTerrain({}, { cell: 8 }).cell, 8);
});
