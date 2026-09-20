// CameraController flight and look-around: WASD along the view, Q/E along the world vertical,
// RMB look keeps the camera in place. The view and the terrain are stubs — only the math is checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

const EPS = 1e-6;
// Flight over the longest frame (0.1 s) at zoom 1. The speed is read from Constants.js, not
// written here as a number: the user tunes CAMERA_FLY_SPEED with the editor's slider.
const STEP = loadScripts(['js/Constants.js']).get('CAMERA_FLY_SPEED') * 0.1;
// Frames of diagonal flight (up + sideways, the step is split between them) to cover 4000 px.
const FAR = Math.ceil(4000 * Math.SQRT2 / STEP);

function makeCamera(opts = {}) {
  const page = loadScripts(['js/Constants.js', 'js/CameraControl.js'], { BABYLON: stub(), performance });
  const CameraController = page.get('CameraController');
  const view = {
    camera: { fov: 0, position: { set() {} }, setTarget() {} },
    world: { canvas: { clientWidth: 1600, clientHeight: 900 } },
    engine: { getAspectRatio: () => 16 / 9 },
    fitShadowFrustum() {}, refreshMatrices() {}, pointerToGround: () => null,
  };
  const terrain = { heightAt: opts.heightAt || (() => 0), outerRing: 2400, hMin: 0 };
  const cam = new CameraController(view, { terrain, bounds: { w: 2048, h: 2048 }, free: !!opts.free });
  cam.c.limits = opts.limits ? 1 : 0;   // the test does not depend on the CAMERA_LIMITS value in Constants.js
  return { cam, liftMax: page.get('CAMERA_LIFT_MAX'), pitchMin: page.get('CAMERA_ORBIT_PITCH_MIN_DEG') };
}

const key = (cam, code, down = true) => cam._onKey({ code, target: null, preventDefault() {} }, down);

// One longest frame with the given keys held.
function fly(cam, ...codes) {
  for (const code of codes) key(cam, code);
  const from = { ...cam._eye() };
  cam.update(0.1);
  for (const code of codes) key(cam, code, false);
  const to = cam._eye();
  return { x: to.x - from.x, y: to.y - from.y, h: to.h - from.h };
}

function forward(cam) {
  const cp = Math.cos(cam.pitch);
  return { x: Math.cos(cam.azimuth) * cp, y: Math.sin(cam.azimuth) * cp, h: -Math.sin(cam.pitch) };
}

test('W и S — полёт вдоль взгляда: камера снижается, направление взгляда не меняется', () => {
  for (const free of [true, false]) {
    const { cam } = makeCamera({ free });
    const f = forward(cam), az = cam.azimuth, pitch = cam.pitch;
    const d = fly(cam, 'KeyW');
    assert.ok(Math.hypot(d.x - f.x * STEP, d.y - f.y * STEP, d.h - f.h * STEP) < EPS, 'W, free=' + free);
    assert.ok(d.h < 0, 'взгляд вниз — W снижает');
    const back = fly(cam, 'KeyS');
    assert.ok(Math.hypot(back.x + d.x, back.y + d.y, back.h + d.h) < EPS, 'S — обратно');
    assert.equal(cam.azimuth, az);
    assert.equal(cam.pitch, pitch);
  }
});

test('A и D — вбок без смены высоты, D — вправо на экране; стрелки дублируют WASD', () => {
  const { cam } = makeCamera({ free: true });
  const d = fly(cam, 'KeyD');
  const screen = cam.worldDeltaToScreen(d.x, d.y);
  assert.ok(Math.abs(screen.x - STEP) < EPS && Math.abs(screen.y) < EPS && Math.abs(d.h) < EPS);
  const a = fly(cam, 'ArrowLeft');
  assert.ok(Math.hypot(a.x + d.x, a.y + d.y, a.h) < EPS);
});

test('Q и E — вниз и вверх по мировой вертикали', () => {
  const { cam } = makeCamera({ free: true });
  const up = fly(cam, 'KeyE');
  assert.ok(Math.abs(up.x) < EPS && Math.abs(up.y) < EPS && Math.abs(up.h - STEP) < EPS);
  assert.ok(Math.abs(cam.lift - STEP) < EPS);
  const down = fly(cam, 'KeyQ');
  assert.ok(Math.abs(down.h + STEP) < EPS);
});

test('скорость по диагонали та же, противоположные клавиши гасят друг друга', () => {
  const { cam } = makeCamera({ free: true });
  const d = fly(cam, 'KeyW', 'KeyD', 'KeyE');
  assert.ok(Math.abs(Math.hypot(d.x, d.y, d.h) - STEP) < EPS);
  const none = fly(cam, 'KeyW', 'KeyS');
  assert.ok(Math.hypot(none.x, none.y, none.h) < EPS);
});

test('камера не опускается ниже земли + EYE_MIN, взгляд при этом не меняется', () => {
  const { cam } = makeCamera({ free: true, heightAt: (x, y) => 50 + 0.1 * x });
  const pitch = cam.pitch;
  key(cam, 'KeyQ');
  for (let i = 0; i < 200; i++) cam.update(0.1);
  const e = cam._eye();
  assert.ok(Math.abs(e.h - (50 + 0.1 * e.x + 40)) < 1e-3);
  assert.equal(cam.pitch, pitch);
});

test('CAMERA_LIMITS = 1: потолок полёта, цель внутри локации, наклон не ниже предела', () => {
  const { cam, liftMax, pitchMin } = makeCamera({ limits: true });
  key(cam, 'KeyE');
  key(cam, 'KeyD');
  for (let i = 0; i < FAR; i++) cam.update(0.1);
  assert.equal(cam.lift, liftMax);
  assert.equal(cam.target.x, 2048);
  cam._look(0, -3);
  assert.ok(cam.pitch >= pitchMin * Math.PI / 180 - EPS);
});

test('CAMERA_LIMITS = 0: игровая камера летает без потолка и границ и смотрит выше горизонта', () => {
  const { cam, liftMax } = makeCamera();
  key(cam, 'KeyE');
  key(cam, 'KeyD');
  for (let i = 0; i < FAR; i++) cam.update(0.1);
  assert.ok(cam.lift > liftMax * 5);
  assert.ok(cam.target.x > 2048 * 2);
  cam._look(0, -3);
  assert.ok(cam.pitch < 0);
});

test('осмотр (ПКМ): камера на месте, цель поворачивается вокруг неё; свободная смотрит и вверх', () => {
  const { cam } = makeCamera({ free: true });
  const eye = { ...cam._eye() }, az = cam.azimuth;
  cam._look(0.3, -0.2);
  const e = cam._eye();
  assert.ok(Math.hypot(e.x - eye.x, e.y - eye.y, e.h - eye.h) < EPS);
  assert.ok(Math.abs(cam.azimuth - az - 0.3) < EPS);
  cam._look(0, -3);
  assert.ok(cam.pitch < 0, 'взгляд выше горизонта');
  const up = cam._eye();
  assert.ok(Math.hypot(up.x - eye.x, up.y - eye.y, up.h - eye.h) < EPS);
});

// The shadow box is capped by WORLD3D_SHADOW_RADIUS and cannot cover a whole frame, so it is led
// by where the camera STANDS, not by the ground at the frame center: raise the head next to a
// building and that point is a thousand px past it (tests/shadow.test.mjs picks up from here).
test('теневому фрустуму уходит место камеры и её курс, а не точка взгляда', () => {
  const { cam } = makeCamera({ free: true });
  let got = null;
  cam.view.fitShadowFrustum = (c, maxR) => { got = { c, maxR }; };
  cam.pitch = -2 * Math.PI / 180;   // чуть выше горизонта — как на скриншоте пользователя
  cam._apply();
  const e = cam._eye();
  assert.ok(Math.hypot(cam.target.x - e.x, cam.target.y - e.y) > 500, 'точка взгляда далеко от камеры');
  assert.ok(Math.abs(got.c.x - e.x) < EPS && Math.abs(got.c.y - e.y) < EPS, 'точка — под камерой');
  assert.equal(got.c.h, 0, 'высота — земля под камерой');
  assert.ok(Math.hypot(got.c.dx - Math.cos(cam.azimuth), got.c.dy - Math.sin(cam.azimuth)) < EPS, 'курс — единичный');
});

// Flying forward and down takes the target under the ground (lift < 0) and toward the horizon the
// frame center runs off: both used to go into the size of the box through groundFocus().k, and the
// box either shrank to a fraction of the frame or chased a point a thousand px away.
test('запрошенный размер коробки теней — след кадра, от подъёма и наклона не зависит', () => {
  const { cam } = makeCamera({ free: true });
  let maxR = null;
  cam.view.fitShadowFrustum = (c, r) => { maxR = r; };
  cam._apply();
  const base = maxR;
  assert.ok(base > 900, 'след кадра при zoom 1');
  for (const lift of [-250, 900]) {
    cam.lift = lift;
    cam.target.h = lift;
    cam._apply();
    assert.equal(maxR, base, 'подъём ' + lift);
  }
  cam.pitch = -2 * Math.PI / 180;
  cam._apply();
  assert.equal(maxR, base, 'взгляд к горизонту');
});

test('home и lookAt возвращают цель на землю, слежение гасит высоту полёта', () => {
  const { cam } = makeCamera({ free: true });
  fly(cam, 'KeyE');
  cam.lookAt(100, 200);
  assert.equal(cam.lift, 0);
  fly(cam, 'KeyE');
  cam.home();
  assert.equal(cam.lift, 0);
  fly(cam, 'KeyE');
  cam.follow({ x: 1000, y: 1000 });
  for (let i = 0; i < 300; i++) cam.update(0.1);
  assert.ok(Math.abs(cam.lift) < 1e-3 && Math.abs(cam.target.x - 1000) < 1e-3);
});
