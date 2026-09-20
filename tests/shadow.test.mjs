// The sun's ortho frustum (View3D.fitShadowFrustum): the shadow map half-size is capped by
// WORLD3D_SHADOW_RADIUS, so the box cannot cover a whole frame and has to pick what it covers.
// It picks the caster NEAREST the camera. Babylon is not loaded: the method is called on a fake
// view, only the math is checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

const page = loadScripts(['js/Constants.js', 'js/World3D.js'], { BABYLON: stub() });
const View3D = page.get('View3D');
const R_MAX = 840;

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
  const list = casters.map((c) => mesh(c));
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
const cam = (x, y, azDeg) => ({ x, y, h: 0, dx: Math.cos(azDeg * Math.PI / 180), dy: Math.sin(azDeg * Math.PI / 180) });
const covers = (f, p) => Math.abs(f.x - p.x) < f.r && Math.abs(f.y - p.y) < f.r;

// The report this was written for: fly up to the mill, raise the head, shadows gone. The look-at
// point is then ~1100 px PAST the mill, toward the horizon, while the mill is 100 px from the eye.
const MILL = { x: 1150, y: 894 };
const HERO = { x: 1029, y: 1010, size: 40, height: 180 };

test('здание в сотне px от камеры: коробка на нём, а не на точке взгляда за горизонтом', () => {
  const view = makeView([MILL, HERO]);
  view.fitShadowFrustum(cam(1046, 901, -80), 713);
  assert.ok(covers(view.fit, MILL) && covers(view.fit, HERO), 'мельница и персонаж в коробке');
  assert.ok(view.fit.r < R_MAX, 'коробка обжата по объектам, тень резкая');
});

test('отъезд: объекты в 2000 px от камеры тоже получают коробку', () => {
  const view = makeView([MILL, HERO]);
  view.fitShadowFrustum(cam(1100, 2900, -90), R_MAX);
  assert.ok(covers(view.fit, MILL) && covers(view.fit, HERO));
});

test('объект за спиной не забирает коробку у того, что впереди', () => {
  const ahead = { x: 1000, y: 300 }, behind = { x: 1000, y: 2400 };
  const view = makeView([behind, ahead]);
  view.fitShadowFrustum(cam(1000, 1000, -90), R_MAX);
  assert.ok(covers(view.fit, ahead), 'коробка впереди камеры');
  assert.ok(!covers(view.fit, behind), 'дальний объект за спиной в неё не попал');
});

test('в кадре нечего отбрасывать: пустая коробка перед камерой, не под ней', () => {
  const view = makeView([]);
  view.fitShadowFrustum(cam(1000, 1000, -90), R_MAX);
  assert.equal(view.fit.r, R_MAX);
  assert.ok(Math.abs(view.fit.x - 1000) < 1e-6);
  assert.ok(view.fit.y < 1000, 'вынесена вперёд по взгляду');
});

test('maxR — только запрос: коробку режет и WORLD3D_SHADOW_RADIUS, и габариты объектов', () => {
  const far = makeView([MILL, HERO], 300);
  far.fitShadowFrustum(cam(1046, 901, -80), 5000);
  assert.ok(far.fit.r <= 300, 'радиус вида — потолок');
  const one = makeView([HERO]);
  one.fitShadowFrustum(cam(1046, 901, -80), R_MAX);
  assert.ok(one.fit.r < 400, 'один маленький объект — маленькая коробка');
});
