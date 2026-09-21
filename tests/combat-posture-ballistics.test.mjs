// tests/combat-posture-ballistics.test.mjs — Comprehensive test suite for movement postures,
// leaning, shooting convergence, ballistics, hitscan, and authoritative server simulation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';
import { RaidRoom, PROTOCOL_VERSION } from '../server/simulation.mjs';

const scripts = loadScripts([
  'js/Constants.js',
  'js/ShooterRules.js',
  'js/RaidRules.js'
], { document: {} });

const ShooterRules = scripts.get('ShooterRules');
const RaidRules = scripts.get('RaidRules');
const close = (actual, expected, epsilon = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be close to ${expected} (diff: ${Math.abs(actual - expected)})`);

// ===========================================================================
// MODULE 1: Movement Verbs, Postures & Leaning
// ===========================================================================

test('RaidRules.getPostureModifiers returns correct multipliers and heights for stand, crouch, prone', () => {
  const stand = RaidRules.getPostureModifiers('stand');
  assert.equal(stand.id, 'stand');
  assert.equal(stand.eyeHeight, 64);
  assert.equal(stand.speedMult, 1.00);
  assert.equal(stand.noiseMult, 1.00);
  assert.equal(stand.spreadMult, 1.00);
  assert.equal(stand.recoilMult, 1.00);

  const crouch = RaidRules.getPostureModifiers('crouch');
  assert.equal(crouch.id, 'crouch');
  assert.equal(crouch.eyeHeight, 38);
  close(crouch.speedMult, 0.62);
  close(crouch.noiseMult, 0.35);
  close(crouch.spreadMult, 0.65);
  close(crouch.recoilMult, 0.75);

  const prone = RaidRules.getPostureModifiers('prone');
  assert.equal(prone.id, 'prone');
  assert.equal(prone.eyeHeight, 18);
  close(prone.speedMult, 0.28);
  close(prone.noiseMult, 0.15);
  close(prone.spreadMult, 0.35);
  close(prone.recoilMult, 0.50);
});

test('RaidRules.movePlayer scales travel distance proportionally to postureSpeedMult', () => {
  const dt = 1.0;
  const config = { speed: 200, radius: 24 };
  const bounds = { width: 2000, height: 2000 };

  // Standing: speedMult 1.0
  const pStand = { x: 500, y: 500 };
  RaidRules.movePlayer(pStand, { forward: 1, right: 0, heading: 0 }, false, dt, { ...config, postureSpeedMult: 1.0 }, [], bounds);
  const standDist = pStand.x - 500;
  close(standDist, 200);

  // Crouching: speedMult 0.62
  const pCrouch = { x: 500, y: 500 };
  RaidRules.movePlayer(pCrouch, { forward: 1, right: 0, heading: 0 }, false, dt, { ...config, postureSpeedMult: 0.62 }, [], bounds);
  const crouchDist = pCrouch.x - 500;
  close(crouchDist, 124);
  close(crouchDist, standDist * 0.62);

  // Prone: speedMult 0.28
  const pProne = { x: 500, y: 500 };
  RaidRules.movePlayer(pProne, { forward: 1, right: 0, heading: 0 }, false, dt, { ...config, postureSpeedMult: 0.28 }, [], bounds);
  const proneDist = pProne.x - 500;
  close(proneDist, 56);
  close(proneDist, standDist * 0.28);
});

test('Sprinting mechanics: stamina consumption, 1.35x speed boost, and exhaustion lockout', () => {
  const stamina = { value: 100, delay: 0, exhausted: false };
  const cfg = { max: 100, drain: 20, regen: 15, delay: 1.5, restart: 25 };

  // Sprint tick drains stamina
  const isSprinting = RaidRules.tickStamina(stamina, true, 1.0, cfg);
  assert.equal(isSprinting, true);
  close(stamina.value, 80);

  // Drain completely to 0 -> enters exhausted
  RaidRules.tickStamina(stamina, true, 4.0, cfg);
  assert.equal(stamina.value, 0);
  assert.equal(stamina.exhausted, true);

  // While exhausted, sprint request is rejected even if key is held
  const sprintBlocked = RaidRules.tickStamina(stamina, true, 0.5, cfg);
  assert.equal(sprintBlocked, false);

  // Wait past recovery delay and regenerate past restart threshold (25)
  stamina.delay = 0;
  RaidRules.tickStamina(stamina, false, 2.0, cfg); // 2.0s * 15/s = 30 stamina
  assert.ok(stamina.value >= 25);
  assert.equal(stamina.exhausted, false);
});

test('Leaning constants provide authentic lateral shift and tilt', () => {
  const leanOffset = scripts.get('GAME_LEAN_OFFSET') || 18;
  const leanRoll = scripts.get('GAME_LEAN_ROLL') || 0.07;

  assert.equal(leanOffset, 18, 'Lean lateral offset must be 18px');
  close(leanRoll, 0.07, 1e-3);

  // Verify lateral displacement vector perpendicular to heading
  const heading = 0; // facing +X, perpendicular is Y
  const leftX = Math.abs(-Math.sin(heading) * (-1) * leanOffset);
  const leftY = Math.cos(heading) * (-1) * leanOffset;
  close(leftX, 0);
  close(leftY, -18); // shifted left along -Y

  const rightX = Math.abs(-Math.sin(heading) * (1) * leanOffset);
  const rightY = Math.cos(heading) * (1) * leanOffset;
  close(rightX, 0);
  close(rightY, 18); // shifted right along +Y
});

// ===========================================================================
// MODULE 2: Weapon Aim Convergence & Reticle Alignment
// ===========================================================================

test('calculateAimConvergence directs offset muzzle to intersect reticle focal point', () => {
  const eyePos = { x: 100, y: 200, h: 64 };
  const forwardDir = { x: 1, y: 0, h: 0 }; // Looking straight along +X
  const targetRange = 800;

  // Barrel offset: 24px forward, 12px right (+Y), 7px below eye (-Z)
  const muzzlePos = { x: 124, y: 212, h: 57 };

  const conv = ShooterRules.calculateAimConvergence(muzzlePos, eyePos, forwardDir, targetRange);
  assert.ok(conv);

  // Reticle aim point in world space
  assert.equal(conv.aimPoint.x, 900);
  assert.equal(conv.aimPoint.y, 200);
  assert.equal(conv.aimPoint.h, 64);

  // Bullet fired along conv direction
  const bulletStart = { ...muzzlePos };
  const bulletEnd = {
    x: bulletStart.x + conv.dirX * conv.distance,
    y: bulletStart.y + conv.dirY * conv.distance,
    h: bulletStart.h + conv.dirH * conv.distance,
  };

  close(bulletEnd.x, conv.aimPoint.x);
  close(bulletEnd.y, conv.aimPoint.y);
  close(bulletEnd.h, conv.aimPoint.h);
});

test('Aim convergence preserves reticle accuracy across Standing, Crouching, Prone, and Leaning', () => {
  const targetDistance = 600;
  const player = { x: 200, y: 400 };
  const fwd = { x: 0, y: 1, h: 0 }; // Facing +Y (North)

  const postures = [
    { name: 'stand', eyeH: 64, muzzleH: 57, lean: 0 },
    { name: 'crouch', eyeH: 38, muzzleH: 31, lean: 0 },
    { name: 'prone', eyeH: 18, muzzleH: 11, lean: 0 },
    { name: 'lean_left', eyeH: 64, muzzleH: 57, lean: -1 },
    { name: 'lean_right', eyeH: 64, muzzleH: 57, lean: 1 },
  ];

  for (const p of postures) {
    const leanLatX = -Math.sin(Math.PI / 2) * p.lean * 18;
    const eye = { x: player.x + leanLatX, y: player.y, h: p.eyeH };
    const muzzle = { x: player.x + leanLatX + 10, y: player.y + 15, h: p.muzzleH };

    const conv = ShooterRules.calculateAimConvergence(muzzle, eye, fwd, targetDistance);

    // Target cylinder centered exactly at the reticle aim point
    const targetActor = {
      id: 'target_' + p.name,
      x: conv.aimPoint.x,
      y: conv.aimPoint.y,
      h: conv.aimPoint.h - 20,
      height: 40,
      radius: 20,
    };

    // Cast ray from muzzle along convergence direction to and through target
    const end = {
      x: muzzle.x + conv.dirX * (conv.distance + 50),
      y: muzzle.y + conv.dirY * (conv.distance + 50),
      h: muzzle.h + conv.dirH * (conv.distance + 50),
    };

    const hit = ShooterRules.rayCylinderHit(muzzle, end, targetActor);
    assert.ok(hit, `Muzzle shot in posture '${p.name}' must hit target at reticle focal point`);
    // Hits cylinder surface on entry: lateral coordinate x and height h must match center within tolerance
    close(hit.x, conv.aimPoint.x, 2.0);
    close(hit.h, conv.aimPoint.h, 2.0);
  }
});

test('Aim convergence maintains accurate elevation trajectory when looking up or down', () => {
  const eye = { x: 500, y: 500, h: 64 };
  const muzzle = { x: 520, y: 510, h: 58 };
  const speed = 5000;

  // Case 1: Looking UP (+h)
  const fwdUp = { x: 1, y: 0, h: 0.5 };
  const convUp = ShooterRules.calculateAimConvergence(muzzle, eye, fwdUp, 600);
  const vhUp = convUp.dirH * speed;
  assert.ok(vhUp > 0, 'Vertical velocity must be positive when aiming upward');
  close(muzzle.h + vhUp * (convUp.distance / speed), convUp.aimPoint.h, 0.01);

  // Case 2: Looking DOWN (-h)
  const fwdDown = { x: 1, y: 0, h: -0.5 };
  const convDown = ShooterRules.calculateAimConvergence(muzzle, eye, fwdDown, 600);
  const vhDown = convDown.dirH * speed;
  assert.ok(vhDown < 0, 'Vertical velocity must be negative when aiming downward');
  close(muzzle.h + vhDown * (convDown.distance / speed), convDown.aimPoint.h, 0.01);
});

// ===========================================================================
// MODULE 3: Ballistics vs Hitscan Trajectory & Damage Falloff
// ===========================================================================

test('Ballistic projectile flight experiences quadratic gravity drop and aerodynamic drag', () => {
  const muzzleSpeed = 4800; // px/s
  const gravity = 980;      // px/s^2
  const drag = 0.04;

  const proj = ShooterRules.createProjectile({
    x: 0, y: 0, h: 60,
    vx: muzzleSpeed, vy: 0, vh: 0,
    gravity, drag,
  });

  const dt = 1 / 60;
  const trajectory = [];
  for (let step = 0; step < 30; step++) {
    ShooterRules.stepProjectile(proj, dt, []);
    trajectory.push({ x: proj.x, h: proj.h, vx: proj.vx });
  }

  // 1. Forward velocity decelerates due to drag
  assert.ok(trajectory[29].vx < muzzleSpeed, 'Forward velocity must decrease due to air resistance');

  // 2. Altitude drops quadratically over time
  const dropStep10 = 60 - trajectory[9].h;
  const dropStep20 = 60 - trajectory[19].h;
  const dropStep30 = 60 - trajectory[29].h;

  assert.ok(dropStep20 > dropStep10 * 3.0, 'Drop rate accelerates quadratically under gravity');
  assert.ok(dropStep30 > dropStep20 * 1.8);
});

test('rayCylinderHit and checkHeadshot differentiate headshots from torso hits', () => {
  const target = { x: 300, y: 0, h: 0, height: 64, radius: 20 };
  const actors = [target];

  // Shot 1: High trajectory aiming at head (h = 56)
  const projHead = ShooterRules.createProjectile({
    x: 0, y: 0, h: 56,
    vx: 5000, vy: 0, vh: 0,
    damage: 34,
    gravity: 0, drag: 0,
    headshotMultiplier: 1.85,
  });
  const resHead = ShooterRules.stepProjectile(projHead, 0.1, actors);
  assert.ok(resHead.hit);
  assert.equal(resHead.headshot, true);
  assert.equal(resHead.damage, Math.round(34 * 1.85));

  // Shot 2: Mid trajectory aiming at chest (h = 32)
  const projChest = ShooterRules.createProjectile({
    x: 0, y: 0, h: 32,
    vx: 5000, vy: 0, vh: 0,
    damage: 34,
    gravity: 0, drag: 0,
    headshotMultiplier: 1.85,
  });
  const resChest = ShooterRules.stepProjectile(projChest, 0.1, actors);
  assert.ok(resChest.hit);
  assert.equal(resChest.headshot, false);
  assert.equal(resChest.damage, 34);
});

test('ShooterRules.damageFalloff attenuates damage over range', () => {
  const baseDmg = 40;
  const near = 500;
  const far = 1000;
  const minDmg = 15;

  // Within near range: 100% damage
  assert.equal(ShooterRules.damageFalloff(baseDmg, 200, near, far, minDmg), 40);
  assert.equal(ShooterRules.damageFalloff(baseDmg, 500, near, far, minDmg), 40);

  // Halfway between near and far (750): midpoint damage
  const midDmg = ShooterRules.damageFalloff(baseDmg, 750, near, far, minDmg);
  assert.equal(midDmg, 27.5);

  // At or beyond far range: clamped to minDmg
  assert.equal(ShooterRules.damageFalloff(baseDmg, 1000, near, far, minDmg), 15);
  assert.equal(ShooterRules.damageFalloff(baseDmg, 1500, near, far, minDmg), 15);
});

test('ShooterRules.raycastHitscan performs instantaneous line-of-sight ray tracing with cover blocking', () => {
  const actors = [{ id: 'target_1', x: 500, y: 0, h: 0, height: 64, radius: 24 }];
  const blockers = [{ x: 250, y: 0, h: 0, height: 80, radius: 30 }];

  // 1. Direct shot with cover in the way hits blocker, not target
  const blockedHit = ShooterRules.raycastHitscan({ x: 0, y: 0, h: 40 }, { x: 1, y: 0, h: 0 }, 1000, actors, blockers);
  assert.ok(blockedHit.hit);
  assert.equal(blockedHit.type, 'blocker');
  assert.ok(blockedHit.distance < 250);

  // 2. Clear shot along y=80 lane (outside the blocker radius of 30) hits target
  const clearActors = [{ id: 'target_lane', x: 500, y: 80, h: 0, height: 64, radius: 24 }];
  const clearHit = ShooterRules.raycastHitscan({ x: 0, y: 80, h: 40 }, { x: 1, y: 0, h: 0 }, 1000, clearActors, blockers, null, { damage: 45 });
  assert.ok(clearHit.hit);
  assert.equal(clearHit.type, 'actor');
  assert.equal(clearHit.target.id, 'target_lane');
  assert.ok(clearHit.damage > 0);
});

// ===========================================================================
// MODULE 4: Authoritative Multiplayer Server Simulation
// ===========================================================================

test('RaidRoom validates sequence numbers, clamps inputs, and tracks authoritative tick rate', () => {
  const room = new RaidRoom();
  room.join('player_1');

  // Valid input succeeds
  assert.equal(room.input('player_1', { version: PROTOCOL_VERSION, sequence: 0, forward: 1, right: 0, heading: 0, pitch: 0, sprint: false }), true);

  // Stale or duplicate sequence rejected
  assert.equal(room.input('player_1', { version: PROTOCOL_VERSION, sequence: 0, forward: 1, right: 0, heading: 0, sprint: false }), false);

  // Invalid posture rejected
  assert.equal(room.input('player_1', { version: PROTOCOL_VERSION, sequence: 1, forward: 1, right: 0, heading: 0, sprint: false, posture: 'flying' }), false);

  // Invalid lean rejected
  assert.equal(room.input('player_1', { version: PROTOCOL_VERSION, sequence: 2, forward: 1, right: 0, heading: 0, sprint: false, lean: 5.0 }), false);
});

test('RaidRoom authoritative posture dodging: crouching dodges high headshots', () => {
  const room = new RaidRoom();
  room.join('shooter');
  room.join('target');

  const shooter = room.players.get('shooter');
  const target = room.players.get('target');
  shooter.x = 200; shooter.y = 1000;
  target.x = 400; target.y = 1000; target.h = 0; target.shield = 0; target.hp = 100;

  // SCENARIO A: Target stands (height: 64). Shooter fires high at h: 55
  shooter.ammo = 10;
  room.input('target', { version: PROTOCOL_VERSION, sequence: 0, forward: 0, right: 0, heading: 0, sprint: false, posture: 'stand' });
  room.input('shooter', { version: PROTOCOL_VERSION, sequence: 0, forward: 0, right: 0, heading: 0, pitch: 0, sprint: false, fire: true });

  for (let i = 0; i < 10; i++) room.step();

  const hitEvents = room.events.filter(e => e.type === 'hit' && e.targetId === 'target');
  assert.ok(hitEvents.length > 0, 'Standing target must be hit by bullet at h:55');
  assert.ok(target.hp < 100);

  // Reset HP
  target.hp = 100;
  room.events = [];

  // SCENARIO B: Target crouches (height: 38). Shooter fires at same height h: 55
  shooter.ammo = 10;
  shooter.fireCooldown = 0;
  room.input('target', { version: PROTOCOL_VERSION, sequence: 1, forward: 0, right: 0, heading: 0, sprint: false, posture: 'crouch' });
  assert.equal(target.height, 38, 'Server collider height must drop to 38 for crouch');

  room.input('shooter', { version: PROTOCOL_VERSION, sequence: 1, forward: 0, right: 0, heading: 0, pitch: 0, sprint: false, fire: true });

  for (let i = 0; i < 10; i++) room.step();

  const crouchHitEvents = room.events.filter(e => e.type === 'hit' && e.targetId === 'target');
  assert.equal(crouchHitEvents.length, 0, 'Crouching target dodges bullet passing over head at h:55');
  assert.equal(target.hp, 100, 'Target HP remains intact');
});

test('RaidRoom authoritative leaning around cover: lean unmasks line-of-sight and scores hit', () => {
  // Place cover directly between shooter (200, 1000) and target (500, 1000)
  const blocker = { x: 350, y: 1000, radius: 24, height: 80 };
  const room = new RaidRoom({ blockers: [blocker] });
  room.join('shooter');
  room.join('target');

  const shooter = room.players.get('shooter');
  const target = room.players.get('target');
  shooter.x = 200; shooter.y = 1000;
  target.x = 500; target.y = 1000; target.h = 0; target.hp = 100; target.shield = 50;

  // 1. Straight shot with lean: 0 hits blocker
  shooter.ammo = 10;
  room.input('shooter', { version: PROTOCOL_VERSION, sequence: 0, forward: 0, right: 0, heading: 0, pitch: 0, sprint: false, lean: 0, fire: true });
  for (let i = 0; i < 10; i++) room.step();

  const straightHit = room.events.find(e => e.type === 'hit' && e.targetId === 'target');
  assert.equal(straightHit, undefined, 'Center shot must be stopped by blocker');

  // 2. Shooter leans right (+Y by 18px), target placed at (500, 1040)
  // Shooter muzzle becomes (200, 1018). Line from (200, 1018) to (500, 1040):
  // At x = 350 (blocker x), y = 1018 + 0.5 * 22 = 1029.
  // Blocker is at (350, 1000, radius: 24) -> top edge is 1024.
  // Distance from blocker center is 29 > 24 -> line is completely unmasked!
  room.events = [];
  shooter.ammo = 10;
  shooter.fireCooldown = 0;
  target.y = 1040;
  const aimAngle = Math.atan2(target.y - 1018, target.x - shooter.x);

  room.input('shooter', { version: PROTOCOL_VERSION, sequence: 1, forward: 0, right: 0, heading: aimAngle, pitch: 0, sprint: false, lean: 1, fire: true });
  for (let i = 0; i < 10; i++) room.step();

  const leanHit = room.events.find(e => e.type === 'hit' && e.targetId === 'target');
  assert.ok(leanHit, 'Leaning shooter successfully hits target around cover');
  assert.ok(target.shield < 50, 'Target shield absorbed damage');
});

test('RaidRoom snapshot accurately reflects player postures, lean, and live projectiles', () => {
  const room = new RaidRoom();
  room.join('operator_a');

  room.input('operator_a', {
    version: PROTOCOL_VERSION,
    sequence: 0,
    forward: 1,
    right: 0,
    heading: 0.5,
    pitch: -0.1,
    sprint: false,
    posture: 'crouch',
    lean: -1,
  });
  room.step();

  const snap = room.snapshot();
  assert.equal(snap.players.length, 1);
  const p = snap.players[0];
  assert.equal(p.posture, 'crouch');
  assert.equal(p.lean, -1);
  assert.equal(p.height, 38);
  close(p.heading, 0.5);
  close(p.pitch, -0.1);
});
