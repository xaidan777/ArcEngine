// The sun's ortho frustum (View3D.fitShadowFrustum): the shadow box is capped by
// WORLD3D_SHADOW_RADIUS, so it cannot cover a whole frame and has to choose what it covers.
// It chooses the caster NEAREST the eye. The regression: led by the ground at the frame center
// (CameraController.groundFocus) a caster 100 px from the camera fell out of the box as soon as
// the pitch went shallow — the user saw "shadows disappear when I look up". Babylon is not
// loaded: the method runs on a fake view, only the geometry is checked. The thin-instance
// fallback is checked through the loader directly, without a real WebGL context.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

const page = loadScripts(['js/Constants.js', 'js/World3D.js'], { BABYLON: stub() });
const View3D = page.get('View3D');
const R_MAX = 840;   // WORLD3D_SHADOW_RADIUS of js/Constants.js (the test's own value — see the check below)

// A shadow caster the size of a building, standing at (x, y) on the ground.
function mesh({ x, y, h = 0, size = 120, height = 400 }) {
  return {
    hasThinInstances: false,
    isEnabled: () => true,
    computeWorldMatrix() {},
    getBoundingInfo: () => ({
      boundingBox: {
        minimumWorld: { x: x - size, y: h, z: y - size },
        maximumWorld: { x: x + size, y: h + height, z: y + size },
      },
    }),
  };
}

// A fake view: no Babylon, updateLightFrustum only records where the frustum landed.
function makeView(casters, shadowRadius = R_MAX) {
  const list = casters.map((c) => c);
  return {
    _shadowRadius: shadowRadius,
    _mapSize: 1024,
    _fitR: null,
    sun: { direction: { y: -0.77 }, shadowOrthoScale: 0.1 },
    shadow: { getShadowMap: () => ({ renderList: list }) },
    /** @type {{ x: number, y: number, h: number, r: number } | null} */
    fit: null,
    updateLightFrustum(x, y2d, h, r) { this.fit = { x, y: y2d, h, r }; },
    fitShadowFrustum: View3D.prototype.fitShadowFrustum,
  };
}

// The camera: where it stands on the map and which way it looks (degrees, as CAMERA_AZIMUTH_DEG).
const cam = (x, y, azDeg, h = 0) => ({ x, y, h, dx: Math.cos(azDeg * Math.PI / 180), dy: Math.sin(azDeg * Math.PI / 180) });
const covers = (f, p) => Math.abs(f.x - p.x) < f.r && Math.abs(f.y - p.y) < f.r;

// The report this was written for: fly up to the mill, raise the head, shadows gone. The look-at
// point is then ~1100 px PAST the mill, toward the horizon, while the mill is 100 px from the eye.
const MILL = { x: 1150, y: 894 };
const HERO = { x: 1029, y: 1010, size: 40, height: 180 };

test('константа радиуса совпадает с тем, что читает тест', () => {
  assert.equal(R_MAX, page.get('WORLD3D_SHADOW_RADIUS'));
  assert.equal(View3D.SHADOW_AHEAD, 0.75);
});

test('блок в сотне px от камеры: коробка на нём, а не на точке взгляда за горизонтом', () => {
  const view = makeView([mesh(MILL), mesh(HERO)]);
  view.fitShadowFrustum(cam(1046, 901, -80), 713);
  assert.ok(covers(view.fit, MILL) && covers(view.fit, HERO), 'мельница и персонаж в коробке');
  assert.ok(view.fit.r < R_MAX, 'коробка обжата по объектам, тень резкая');
});

test('точка взгляда за горизонтом: ближний объект остаётся в коробке', () => {
  // The eye at (1046, 901), azimuth -80°. The old caller led the box by groundFocus(): at a
  // shallow pitch its k caps at 4 and the centre landed ~2770 px ahead of the ground under the
  // target, i.e. ~3590 px from a caster 100 px in front of the eye — outside R_MAX = 840.
  const near = { ...MILL, size: 30, height: 160 };
  const view = makeView([mesh(near)]);
  view.fitShadowFrustum(cam(1046, 901, -80), R_MAX);
  assert.ok(covers(view.fit, MILL), 'объект в 100 px от глаза внутри коробки');
  assert.ok(view.fit.r < 400, 'один маленький объект — маленькая коробка');
});

test('отъезд: объекты в 2000 px от камеры тоже получают коробку', () => {
  const view = makeView([mesh(MILL), mesh(HERO)]);
  view.fitShadowFrustum(cam(1100, 2900, -90), R_MAX);
  assert.ok(covers(view.fit, MILL) && covers(view.fit, HERO));
});

test('объект за спиной не забирает коробку у того, что впереди', () => {
  const ahead = { x: 1000, y: 300 }, behind = { x: 1000, y: 2400 };
  const view = makeView([mesh(behind), mesh(ahead)]);
  view.fitShadowFrustum(cam(1000, 1000, -90), R_MAX);
  assert.ok(covers(view.fit, ahead), 'коробка впереди камеры');
  assert.ok(!covers(view.fit, behind), 'дальний объект за спиной в неё не попал');
});

test('в кадре нечего отбрасывать: пустая коробка перед камерой, числа конечные', () => {
  const view = makeView([]);
  view.fitShadowFrustum(cam(1000, 1000, -90), R_MAX);
  assert.equal(view.fit.r, R_MAX);
  // upstream's own test caught a NaN here and an object-valued fit.x: assert numbers, not just order
  for (const [k, v] of Object.entries(view.fit)) assert.ok(typeof v === 'number' && Number.isFinite(v), k + ' = ' + v);
  assert.ok(Math.abs(view.fit.x - 1000) < 1e-6);
  assert.ok(view.fit.y < 1000, 'вынесена вперёд по взгляду');
  assert.ok(Math.abs(view.fit.y - (1000 - R_MAX * View3D.SHADOW_AHEAD)) < 1e-6, 'на SHADOW_AHEAD вперёд');
});

test('один крошечный объект: конечные числа и ненулевой радиус', () => {
  const tiny = { x: 500, y: 500, size: 4, height: 8 };
  const view = makeView([mesh(tiny)]);
  view.fitShadowFrustum(cam(500, 560, -90), R_MAX);
  for (const [k, v] of Object.entries(view.fit)) assert.ok(typeof v === 'number' && Number.isFinite(v), k + ' = ' + v);
  assert.ok(view.fit.r >= View3D.SHADOW_MIN_RADIUS, 'не меньше SHADOW_MIN_RADIUS');
  assert.ok(covers(view.fit, tiny));
});

test('maxR — только запрос: коробку режет и WORLD3D_SHADOW_RADIUS, и габариты объектов', () => {
  const far = makeView([mesh(MILL), mesh(HERO)], 300);
  far.fitShadowFrustum(cam(1046, 901, -80), 5000);
  assert.ok(far.fit.r <= 300, 'радиус вида — потолок');
  const one = makeView([mesh(HERO)]);
  one.fitShadowFrustum(cam(1046, 901, -80), R_MAX);
  assert.ok(one.fit.r < 400, 'один маленький объект — маленькая коробка');
});

test('тонкие инстансы: габариты врут — безопасный запас вперёд по взгляду', () => {
  const inst = { x: 1000, y: 1000 };
  const thin = {
    hasThinInstances: true, thinInstanceCount: 40, isEnabled: () => true, computeWorldMatrix() {},
    getBoundingInfo: () => ({ boundingBox: { minimumWorld: { x: 0, y: 0, z: 0 }, maximumWorld: { x: 1, y: 1, z: 1 } } }),
  };
  const view = makeView([thin]);
  view.fitShadowFrustum(cam(inst.x, inst.y, -90), 713);
  assert.equal(view.fit.r, 713, 'фолбэк берёт запрошенный maxR');
  for (const [k, v] of Object.entries(view.fit)) assert.ok(typeof v === 'number' && Number.isFinite(v), k + ' = ' + v);
  assert.ok(Math.abs(view.fit.x - inst.x) < 1e-6);
  assert.ok(Math.abs(view.fit.y - (inst.y - 713 * View3D.SHADOW_AHEAD)) < 1e-6, 'вперёд на SHADOW_AHEAD, не в начало координат');
});