import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const ShooterRules = loadScripts(['js/ShooterRules.js']).get('ShooterRules');
const close = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be close to ${expected} (diff: ${Math.abs(actual - expected)})`);

test('rayCylinderHit detects lateral entry on cylinder body', () => {
  const cylinder = { x: 100, y: 0, h: 0, height: 60, radius: 20 };
  const start = { x: 0, y: 0, h: 30 };
  const end = { x: 200, y: 0, h: 30 };
  const hit = ShooterRules.rayCylinderHit(start, end, cylinder);
  assert.ok(hit, 'should hit lateral surface');
  close(hit.t, 0.4); // starts at 0, touches cylinder at x = 80 -> t = 80/200 = 0.4
  close(hit.x, 80);
  close(hit.y, 0);
  close(hit.h, 30);
  close(hit.normalX, -1);
  close(hit.normalY, 0);
  close(hit.normalH, 0);
});

test('rayCylinderHit detects top and bottom cap entries', () => {
  const cylinder = { x: 0, y: 0, h: 0, height: 50, radius: 20 };
  // Ray coming down from above the top cap
  const topStart = { x: 0, y: 0, h: 100 };
  const topEnd = { x: 0, y: 0, h: -50 };
  const topHit = ShooterRules.rayCylinderHit(topStart, topEnd, cylinder);
  assert.ok(topHit, 'should hit top cap');
  close(topHit.h, 50);
  close(topHit.normalH, 1);

  // Ray coming up from below bottom cap
  const botStart = { x: 0, y: 0, h: -50 };
  const botEnd = { x: 0, y: 0, h: 100 };
  const botHit = ShooterRules.rayCylinderHit(botStart, botEnd, cylinder);
  assert.ok(botHit, 'should hit bottom cap');
  close(botHit.h, 0);
  close(botHit.normalH, -1);
});

test('rayCylinderHit misses rays that pass above, below, or to the side', () => {
  const cylinder = { x: 100, y: 0, h: 0, height: 50, radius: 20 };
  // Above top
  assert.equal(ShooterRules.rayCylinderHit({ x: 0, y: 0, h: 60 }, { x: 200, y: 0, h: 60 }, cylinder), null);
  // Below bottom
  assert.equal(ShooterRules.rayCylinderHit({ x: 0, y: 0, h: -10 }, { x: 200, y: 0, h: -10 }, cylinder), null);
  // To the side
  assert.equal(ShooterRules.rayCylinderHit({ x: 0, y: 30, h: 25 }, { x: 200, y: 30, h: 25 }, cylinder), null);
});

test('checkHeadshot accurately identifies hits in the upper fraction', () => {
  const baseH = 10;
  const height = 60; // top is 70, headzone is top 22% -> >= 10 + 60 * 0.78 = 56.8
  assert.equal(ShooterRules.checkHeadshot(58, baseH, height), true);
  assert.equal(ShooterRules.checkHeadshot(68, baseH, height), true);
  assert.equal(ShooterRules.checkHeadshot(40, baseH, height), false);
  assert.equal(ShooterRules.checkHeadshot(20, baseH, height), false);
});

test('stepProjectile applies gravity drop and computes headshot vs body damage', () => {
  const targetActor = { id: 'drone-1', x: 200, y: 0, h: 0, height: 60, radius: 20, dead: false, hp: 100 };
  const actors = [targetActor];

  // Headshot aim: high h
  const projHead = ShooterRules.createProjectile({
    id: 'p1',
    shooterId: 'player',
    x: 0, y: 0, h: 58,
    vx: 2000, vy: 0, vh: 0,
    damage: 40,
    gravity: 0, // isolate geometry
    drag: 0,
  });

  const resHead = ShooterRules.stepProjectile(projHead, 0.1, actors);
  assert.ok(resHead.hit);
  assert.equal(resHead.type, 'actor');
  assert.equal(resHead.headshot, true);
  assert.equal(resHead.damage, Math.round(40 * 1.8)); // headshot multiplier 1.8x

  // Body aim: mid h
  const projBody = ShooterRules.createProjectile({
    id: 'p2',
    shooterId: 'player',
    x: 0, y: 0, h: 30,
    vx: 2000, vy: 0, vh: 0,
    damage: 40,
    gravity: 0,
    drag: 0,
  });

  const resBody = ShooterRules.stepProjectile(projBody, 0.1, actors);
  assert.ok(resBody.hit);
  assert.equal(resBody.type, 'actor');
  assert.equal(resBody.headshot, false);
  assert.equal(resBody.damage, 40);
});

test('stepProjectile collides with terrain ground when bullet drops', () => {
  const terrainHeightAt = (x, y) => 10;
  const proj = ShooterRules.createProjectile({
    id: 'p_drop',
    shooterId: 'player',
    x: 0, y: 0, h: 15,
    vx: 100, vy: 0, vh: -100, // moving down
    gravity: 980,
    drag: 0,
  });

  const res = ShooterRules.stepProjectile(proj, 0.1, [], [], terrainHeightAt);
  assert.ok(res.hit);
  assert.equal(res.type, 'terrain');
  close(res.point.h, 10);
});

test('shotgunPellets produces deterministic radial dispersion', () => {
  const pellets1 = ShooterRules.shotgunPellets('seed123', 5, 8, 0.08);
  const pellets2 = ShooterRules.shotgunPellets('seed123', 5, 8, 0.08);
  assert.equal(pellets1.length, 8);
  assert.deepEqual(pellets1, pellets2);

  // Check bounds
  for (const p of pellets1) {
    assert.ok(Math.abs(p.azimuthOffset) <= 0.08);
    assert.ok(Math.abs(p.pitchOffset) <= 0.08 * 0.8);
  }
});

test('recoilSpring damps towards target', () => {
  let recoil = 0.05;
  let vel = 0;
  for (let i = 0; i < 30; i++) {
    const step = ShooterRules.recoilSpring(recoil, 0, vel, 1 / 60, 120, 16);
    recoil = step.value;
    vel = step.velocity;
  }
  assert.ok(recoil < 0.005, `Recoil should recover close to 0: ${recoil}`);
});
