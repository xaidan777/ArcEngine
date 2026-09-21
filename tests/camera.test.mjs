// CameraController flight and look-around: WASD along the view, Q/E along the world vertical,
// RMB look keeps the camera in place. The view and the terrain are stubs — only the math is checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

const EPS = 1e-6;
const STEP = 90;   // CAMERA_FLY_SPEED 900 screen px/s at zoom 1 over the longest frame, 0.1 s

function makeCamera(opts = {}) {
  const page = loadScripts(['js/Constants.js', 'js/CameraControl.js'], { BABYLON: stub(), performance });
  const CameraController = page.get('CameraController');
  const view = {
    camera: { fov: 0, position: { set() {} }, setTarget() {} },
    world: { canvas: { clientWidth: 1600, clientHeight: 900 } },
    engine: { getAspectRatio: () => 16 / 9 },
    shadowCalls: [],
    fitShadowFrustum(cam, maxR) { this.shadowCalls.push({ cam, maxR }); },
    refreshMatrices() {}, pointerToGround: () => null,
  };
  const terrain = { heightAt: opts.heightAt || (() => 0), outerRing: 2400, hMin: 0 };
  const cam = new CameraController(view, { terrain, bounds: { w: 2048, h: 2048 }, free: !!opts.free });
  cam.c.limits = opts.limits ? 1 : 0;   // the test does not depend on the CAMERA_LIMITS value in Constants.js
  return { cam, view, liftMax: page.get('CAMERA_LIFT_MAX'), pitchMin: page.get('CAMERA_ORBIT_PITCH_MIN_DEG') };
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

test('направления first-person движения совпадают с направлением камеры при любом азимуте', () => {
  const { cam } = makeCamera();
  for (const angle of [-Math.PI * 3, -Math.PI, -0.2, 0, Math.PI / 2, Math.PI, Math.PI * 5]) {
    cam.azimuth = angle;
    const f = cam.forward2D(), r = cam.right2D();
    assert.ok(Math.abs(f.x - Math.cos(angle)) < EPS);
    assert.ok(Math.abs(f.y - Math.sin(angle)) < EPS);
    assert.ok(Math.abs(r.x + Math.sin(angle)) < EPS);
    assert.ok(Math.abs(r.y - Math.cos(angle)) < EPS);
    assert.ok(Math.abs(f.x * r.x + f.y * r.y) < EPS);
  }
});

test('игровая логика может отключить полёт камеры и забрать WASD', () => {
  const { cam } = makeCamera();
  const from = { ...cam._eye() };
  let prevented = false;
  cam.setMovementEnabled(false);
  cam._onKey({ code: 'KeyW', target: null, preventDefault() { prevented = true; } }, true);
  cam.update(0.1);
  const to = cam._eye();
  assert.ok(Math.hypot(to.x - from.x, to.y - from.y, to.h - from.h) < EPS);
  assert.equal(prevented, false);
  cam.setMovementEnabled(true);
  assert.ok(fly(cam, 'KeyW').y < 0);
});

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
  for (let i = 0; i < 100; i++) cam.update(0.1);
  assert.equal(cam.lift, liftMax);
  assert.equal(cam.target.x, 2048);
  cam._look(0, -3);
  assert.ok(cam.pitch >= pitchMin * Math.PI / 180 - EPS);
});

test('CAMERA_LIMITS = 0: игровая камера летает без потолка и границ и смотрит выше горизонта', () => {
  const { cam, liftMax } = makeCamera();
  key(cam, 'KeyE');
  key(cam, 'KeyD');
  for (let i = 0; i < 100; i++) cam.update(0.1);
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

test('коробка теней ведётся от ГЛАЗА камеры, а не от точки взгляда за горизонтом', () => {
  const { cam, view } = makeCamera({ free: true });
  cam.home();
  cam.lookAt(1000, 1000);
  cam.update(0.1);
  const last = view.shadowCalls[view.shadowCalls.length - 1];
  const eye = cam._eye();
  const f = cam.forward2D();
  assert.ok(Math.hypot(last.cam.x - eye.x, last.cam.y - eye.y) < 1e-6, 'центр — под глазом');
  assert.ok(Math.abs(last.cam.dx - f.x) < 1e-9 && Math.abs(last.cam.dy - f.y) < 1e-9, 'направление — взгляд камеры');
  // Взгляд вверх на 10°: groundFocus уходит за горизонт на ~2700 px, коробка остаётся на глазе.
  cam.pitch = -10 * Math.PI / 180;
  cam.update(0.1);
  const up = view.shadowCalls[view.shadowCalls.length - 1];
  const e2 = cam._eye(), g = cam.groundFocus();
  assert.ok(cam.pitch < 0.05);
  assert.ok(Math.hypot(up.cam.x - e2.x, up.cam.y - e2.y) < 1e-6, 'и при взгляде вверх тоже');
  assert.ok(Math.hypot(g.x - up.cam.x, g.y - up.cam.y) > 1000, 'groundFocus ушёл далеко вперёд');
});

test('первый человек: коробка теней на игроке, а не на орбитальном глазе позади него', () => {
  const { cam, view } = makeCamera();
  cam.setFree(true);
  cam.lookAt(700, 700);
  cam.setFirstPerson({ x: 700, y: 700, eyeHeight: 64 });
  cam.azimuth = 0;
  cam.update(0.1);
  const last = view.shadowCalls[view.shadowCalls.length - 1];
  assert.ok(Math.hypot(last.cam.x - 700, last.cam.y - 700) < 1e-6, 'центр — на игроке');
  const orbit = cam._eye();
  assert.ok(Math.hypot(orbit.x - last.cam.x, orbit.y - last.cam.y) > 300, 'орбитальный _eye() в стороне — его брать нельзя');
});

// --- distance() must survive a caller assigning to it --------------------------------

test('a shadowed distance does not break the frame', () => {
  const { cam } = makeCamera();
  // The framing API is zoom; `distance()` is derived. MenuSystem used to assign a number to it,
  // which replaced the method and threw "this.distance is not a function" INSIDE the render
  // loop — the game then rendered zero frames. Internal callers use _safeDistance().
  const expected = cam.distance();
  assert.ok(Number.isFinite(expected) && expected > 0, 'a real pullback distance');

  cam.distance = 180;
  assert.equal(typeof cam.distance, 'number', 'the assignment really does shadow the method');
  assert.equal(cam._safeDistance(), 180, 'the shadowed value is honoured rather than thrown on');
  assert.doesNotThrow(() => cam._syncCamera(), 'the frame must not throw');
  assert.doesNotThrow(() => cam.update(0.016), 'update() must keep running');

  delete cam.distance;
  assert.equal(typeof cam.distance, 'function', 'the prototype method is restored');
  assert.ok(Math.abs(cam.distance() - expected) < EPS, 'and behaves as before');
});

test('zoom drives the framing rather than a distance field', () => {
  const { cam } = makeCamera();
  const atDefaultZoom = cam.distance();
  cam.zoom = 2;
  cam.zoomTarget = 2;
  const zoomedIn = cam.distance();
  assert.ok(zoomedIn < atDefaultZoom, 'a higher zoom pulls the camera closer');
  assert.ok(Math.abs(zoomedIn * 2 - atDefaultZoom) < 1e-3, 'distance is inversely proportional to zoom');
});
