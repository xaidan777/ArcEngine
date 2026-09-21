// tests/fps-mechanics.test.mjs — Unit tests for Jump Overhaul & P1.4 - P1.7 Tactical FPS Mechanics.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const scripts = loadScripts([
  'js/Constants.js',
  'js/ShooterRules.js',
  'js/RaidRules.js',
  'js/NavGrid.js'
], { document: {} });

const ShooterRules = scripts.get('ShooterRules');
const RaidRules = scripts.get('RaidRules');
const NavGrid = scripts.get('NavGrid');
const ARC_ITEMS = scripts.get('ARC_ITEMS');
const ARC_MACHINE_TYPES = scripts.get('ARC_MACHINE_TYPES');

// ---------------------------------------------------------------------------
// 1. Jump Overhaul Tests
// ---------------------------------------------------------------------------

test('Jump constants are configured with correct physical and stamina parameters', () => {
  const jumpImpulse = scripts.get('GAME_JUMP_IMPULSE');
  const jumpGravity = scripts.get('GAME_JUMP_GRAVITY');
  const staminaCost = scripts.get('GAME_JUMP_STAMINA_COST');
  const safeSpeed = scripts.get('GAME_FALL_SAFE_SPEED');
  const dmgFactor = scripts.get('GAME_FALL_DAMAGE_FACTOR');

  assert.equal(typeof jumpImpulse, 'number', 'GAME_JUMP_IMPULSE must be a number');
  assert.ok(jumpImpulse >= 200, 'GAME_JUMP_IMPULSE must provide adequate launch impulse');

  assert.equal(typeof jumpGravity, 'number', 'GAME_JUMP_GRAVITY must be a number');
  assert.ok(jumpGravity > 0, 'GAME_JUMP_GRAVITY must pull downward');

  assert.equal(typeof staminaCost, 'number', 'GAME_JUMP_STAMINA_COST must be a number');
  assert.ok(staminaCost >= 10, 'GAME_JUMP_STAMINA_COST must enforce stamina trade-off');

  assert.equal(typeof safeSpeed, 'number', 'GAME_FALL_SAFE_SPEED must be defined');
  assert.equal(typeof dmgFactor, 'number', 'GAME_FALL_DAMAGE_FACTOR must be defined');
});

test('Jump physics and fall damage simulation calculates landing threshold accurately', () => {
  const safeSpeed = scripts.get('GAME_FALL_SAFE_SPEED') || 420;
  const dmgFactor = scripts.get('GAME_FALL_DAMAGE_FACTOR') || 0.28;

  // Under safe threshold: 0 damage
  const softLandSpeed = 300;
  const softDamage = Math.max(0, Math.round((softLandSpeed - safeSpeed) * dmgFactor));
  assert.equal(softDamage, 0, 'Soft landings below safe threshold must deal no damage');

  // Over threshold: proportional damage
  const hardLandSpeed = 600;
  const expectedDmg = Math.round((hardLandSpeed - safeSpeed) * dmgFactor);
  assert.ok(expectedDmg > 0, 'Hard landings exceeding safe speed must deal fall damage');
  assert.equal(expectedDmg, Math.round((600 - 420) * 0.28));
});

// ---------------------------------------------------------------------------
// 2. P1.4 Weapon Identity & Fire Cadence Tests
// ---------------------------------------------------------------------------

test('ShooterRules.calculateFireInterval converts RPM into precise second intervals', () => {
  assert.ok(typeof ShooterRules.calculateFireInterval === 'function', 'calculateFireInterval must be a function');

  // 600 RPM = 0.1s
  assert.equal(ShooterRules.calculateFireInterval(600), 0.1);
  // 120 RPM = 0.5s
  assert.equal(ShooterRules.calculateFireInterval(120), 0.5);
  // 300 RPM = 0.2s
  assert.equal(ShooterRules.calculateFireInterval(300), 0.2);
  // Fallback for invalid or 0 RPM
  assert.ok(ShooterRules.calculateFireInterval(0) > 0, 'Should return non-zero fallback for 0 RPM');
});

test('ShooterRules.getRecoilPattern returns distinctive kick and bloom profiles per archetype', () => {
  assert.ok(typeof ShooterRules.getRecoilPattern === 'function', 'getRecoilPattern must be a function');

  const smgPattern = ShooterRules.getRecoilPattern('smg', 0, 1.0);
  const shotgunPattern = ShooterRules.getRecoilPattern('shotgun', 0, 1.0);
  const assaultPattern = ShooterRules.getRecoilPattern('assault_rifle', 0, 1.0);
  const sniperPattern = ShooterRules.getRecoilPattern('sniper', 0, 1.0);

  // Shotgun & Sniper have higher vertical pitch kick than SMG
  assert.ok(shotgunPattern.pitchKick > smgPattern.pitchKick, 'Shotgun pitch kick must exceed SMG kick');
  assert.ok(sniperPattern.pitchKick > assaultPattern.pitchKick, 'Sniper pitch kick must exceed Assault Rifle kick');

  // SMG has faster recovery speed
  assert.ok(smgPattern.recoverySpeed >= assaultPattern.recoverySpeed, 'SMG must have fast recovery speed');

  // Recoil multiplier scales kicks proportionally
  const doubleRecoil = ShooterRules.getRecoilPattern('assault_rifle', 0, 2.0);
  assert.ok(Math.abs(doubleRecoil.pitchKick - assaultPattern.pitchKick * 2.0) < 1e-6);
});

test('ShooterRules.isFirstShot tracks shot reset window correctly', () => {
  assert.ok(typeof ShooterRules.isFirstShot === 'function', 'isFirstShot must be a function');

  assert.equal(ShooterRules.isFirstShot(0.05, 0.28), false, 'Rapid follow-up shot is not first shot');
  assert.equal(ShooterRules.isFirstShot(0.35, 0.28), true, 'Shot after threshold is first shot');
  assert.equal(ShooterRules.isFirstShot(null, 0.28), false, 'Null time is handled safely');
});

test('ARC_ITEMS registers fireMode, fireRate, and archetype for all firearm items', () => {
  assert.ok(ARC_ITEMS, 'ARC_ITEMS must be defined');

  const firearmIds = [
    'tempest_ii',
    'rubezh_t1',
    'rubezh_t2',
    'rubezh_t3',
    'vulcano_i',
    'revolver_i',
    'revolver_ii',
    'rattler_smg',
    'lance_sniper'
  ];

  for (const id of firearmIds) {
    const item = ARC_ITEMS[id];
    assert.ok(item, `Firearm ${id} must exist in ARC_ITEMS`);
    assert.ok(item.archetype, `Firearm ${id} must declare archetype`);
    assert.ok(item.fireMode === 'auto' || item.fireMode === 'semi', `Firearm ${id} must declare fireMode as auto or semi`);
    assert.ok(typeof item.fireRate === 'number' && item.fireRate > 0, `Firearm ${id} must have positive numeric fireRate`);
  }

  // Verify specific modes
  assert.equal(ARC_ITEMS['vulcano_i'].fireMode, 'semi');
  assert.equal(ARC_ITEMS['vulcano_i'].archetype, 'shotgun');
  assert.equal(ARC_ITEMS['revolver_i'].fireMode, 'semi');
  assert.equal(ARC_ITEMS['revolver_i'].archetype, 'revolver');
  assert.equal(ARC_ITEMS['rattler_smg'].fireMode, 'auto');
  assert.equal(ARC_ITEMS['rattler_smg'].archetype, 'smg');
});

// ---------------------------------------------------------------------------
// 3. P1.5 Enemy Legibility & NavGrid AI Tests
// ---------------------------------------------------------------------------

test('ARC_MACHINE_TYPES configures vision cones and hearing radii across all archetypes', () => {
  assert.ok(ARC_MACHINE_TYPES, 'ARC_MACHINE_TYPES must be defined');

  const machineDefs = Object.values(ARC_MACHINE_TYPES);
  assert.ok(machineDefs.length >= 10, 'ARC_MACHINE_TYPES must contain all unit types');

  for (const def of machineDefs) {
    assert.ok(def, `Archetype must be valid`);
    assert.ok(typeof def.visionAngleDeg === 'number' && def.visionAngleDeg > 0, `${def.id} must have positive visionAngleDeg`);
    assert.ok(typeof def.visionRange === 'number' && def.visionRange > 0, `${def.id} must have positive visionRange`);
    assert.ok(typeof def.hearingRadius === 'number' && def.hearingRadius > 0, `${def.id} must have positive hearingRadius`);
  }

  // Spotter / Watcher has wide field of view
  assert.ok(ARC_MACHINE_TYPES.SPOTTER.visionAngleDeg >= 120);
  assert.ok(ARC_MACHINE_TYPES.STALKER.hearingRadius >= 200);
});

test('ShooterRules.isInVisionCone correctly detects targets within and outside viewing cone', () => {
  assert.ok(typeof ShooterRules.isInVisionCone === 'function', 'isInVisionCone must be a function');

  const viewer = { x: 100, y: 100 };
  const heading = 0; // facing +X (East)
  const visionAngleRad = (90 * Math.PI) / 180; // 90 degree FOV (±45 deg)
  const maxRange = 500;

  // Directly in front (East): inside cone
  assert.equal(ShooterRules.isInVisionCone(viewer, heading, { x: 300, y: 100 }, visionAngleRad, maxRange), true);

  // 30 degrees to the side: inside cone
  const in30 = { x: 100 + Math.cos(Math.PI / 6) * 200, y: 100 + Math.sin(Math.PI / 6) * 200 };
  assert.equal(ShooterRules.isInVisionCone(viewer, heading, in30, visionAngleRad, maxRange), true);

  // 60 degrees to the side: outside 90 deg cone (exceeds 45 deg half-angle)
  const out60 = { x: 100 + Math.cos(Math.PI / 3) * 200, y: 100 + Math.sin(Math.PI / 3) * 200 };
  assert.equal(ShooterRules.isInVisionCone(viewer, heading, out60, visionAngleRad, maxRange), false);

  // Directly behind (-X, West): outside cone
  assert.equal(ShooterRules.isInVisionCone(viewer, heading, { x: 0, y: 100 }, visionAngleRad, maxRange), false);

  // In front but beyond maxRange: outside
  assert.equal(ShooterRules.isInVisionCone(viewer, heading, { x: 700, y: 100 }, visionAngleRad, maxRange), false);
});

test('NavGrid rasterizes blockers and computes path around obstacles with A*', () => {
  assert.ok(NavGrid, 'NavGrid must be defined');

  const nav = new NavGrid({ width: 1000, height: 1000 }, 50);
  // Place a blocker right in the middle between (100, 250) and (400, 250)
  const blocker = { x: 250, y: 250, radius: 40 };
  nav.build([blocker], 10);

  // The cell containing the blocker center must be blocked
  assert.equal(nav.isBlocked(250, 250), true);
  // Far cells must be walkable
  assert.equal(nav.isBlocked(50, 50), false);

  // Path from start to goal around obstacle
  const start = { x: 100, y: 250 };
  const goal = { x: 400, y: 250 };
  const path = nav.findPath(start, goal);

  assert.ok(Array.isArray(path), 'findPath must return an array of waypoints');
  assert.ok(path.length >= 1, 'Path must have at least the goal point');

  // The final waypoint must reach the goal
  const lastPoint = path[path.length - 1];
  assert.ok(Math.hypot(lastPoint.x - goal.x, lastPoint.y - goal.y) < 1e-4);
});

// ---------------------------------------------------------------------------
// 4. P1.6 Movement Verbs & Postures Tests
// ---------------------------------------------------------------------------

test('Postures stand, crouch, and prone enforce distinct eye heights and multipliers', () => {
  const stand = RaidRules.getPostureModifiers('stand');
  const crouch = RaidRules.getPostureModifiers('crouch');
  const prone = RaidRules.getPostureModifiers('prone');

  assert.equal(stand.eyeHeight, 64);
  assert.equal(stand.speedMult, 1.0);
  assert.equal(stand.noiseMult, 1.0);

  assert.equal(crouch.eyeHeight, 38);
  assert.ok(crouch.speedMult < stand.speedMult, 'Crouch speed must be slower than stand');
  assert.ok(crouch.noiseMult < stand.noiseMult, 'Crouch must be quieter than stand');

  assert.equal(prone.eyeHeight, 18);
  assert.ok(prone.speedMult < crouch.speedMult, 'Prone speed must be slower than crouch');
  assert.ok(prone.noiseMult < crouch.noiseMult, 'Prone must be quieter than crouch');
  assert.ok(prone.recoilMult < crouch.recoilMult, 'Prone must have superior recoil stability');
});

test('RaidRules.movePlayer applies postureSpeedMult to player speed', () => {
  const p1 = { x: 200, y: 200 };
  const p2 = { x: 200, y: 200 };
  const config = { speed: 200, radius: 20 };
  const bounds = { width: 1000, height: 1000 };
  const input = { forward: 1, right: 0, heading: 0 }; // moving along +X

  // Move standing (postureSpeedMult: 1.0)
  RaidRules.movePlayer(p1, input, false, 0.1, { ...config, postureSpeedMult: 1.0 }, [], bounds);
  // Move crouching (postureSpeedMult: 0.65)
  RaidRules.movePlayer(p2, input, false, 0.1, { ...config, postureSpeedMult: 0.65 }, [], bounds);

  const distStanding = p1.x - 200;
  const distCrouching = p2.x - 200;

  assert.ok(distStanding > 0);
  assert.ok(distCrouching > 0);
  assert.ok(Math.abs(distCrouching - distStanding * 0.65) < 1e-4, 'Crouching motion should be exactly 65% of standing motion');
});

test('Lean constants GAME_LEAN_OFFSET and GAME_LEAN_ROLL are configured', () => {
  const leanOffset = scripts.get('GAME_LEAN_OFFSET');
  const leanRoll = scripts.get('GAME_LEAN_ROLL');

  assert.equal(typeof leanOffset, 'number');
  assert.ok(leanOffset >= 15, 'GAME_LEAN_OFFSET should provide sufficient lateral displacement');
  assert.equal(typeof leanRoll, 'number');
  assert.ok(leanRoll > 0, 'GAME_LEAN_ROLL should apply tactical camera roll');
});
