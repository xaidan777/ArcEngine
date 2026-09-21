import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const ShooterRules = loadScripts(['js/ShooterRules.js']).get('ShooterRules');
const plain = (value) => JSON.parse(JSON.stringify(value));
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('segment-circle hit returns the nearest entry point', () => {
  const hit = ShooterRules.segmentCircleHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 6, y: 0, radius: 2 });
  assert.ok(hit);
  close(hit.t, 0.4);
  close(hit.x, 4);
  close(hit.y, 0);
  assert.deepEqual(plain({ x: hit.normalX, y: hit.normalY }), { x: -1, y: 0 });
  assert.equal(ShooterRules.segmentCircleHit({ x: 0, y: 3 }, { x: 10, y: 3 }, { x: 6, y: 0, radius: 2 }), null);
});

test('segment-circle hit supports tangency, padding, and starts inside', () => {
  const tangent = ShooterRules.segmentCircleHit({ x: 0, y: 2 }, { x: 10, y: 2 }, { x: 5, y: 0, radius: 2 });
  assert.ok(tangent);
  close(tangent.t, 0.5);
  const padded = ShooterRules.segmentCircleHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0, radius: 1 }, 2);
  close(padded.t, 0.2);
  const inside = ShooterRules.segmentCircleHit({ x: 5, y: 0 }, { x: 9, y: 0 }, { x: 5, y: 0, radius: 2 });
  assert.equal(inside.t, 0);
});

test('nearest hit is deterministic and reports its blocker', () => {
  const circles = [{ x: 8, y: 0, radius: 1 }, { x: 4, y: 0, radius: 1 }, { x: 4, y: 0, radius: 1 }];
  const hit = ShooterRules.nearestSegmentCircleHit({ x: 0, y: 0 }, { x: 10, y: 0 }, circles);
  assert.equal(hit.index, 1);
  assert.equal(hit.circle, circles[1]);
  close(hit.t, 0.3);
});

test('typed ray hit picks nearest and blockers win ties', () => {
  const actors = [{ x: 5, y: 0, radius: 1 }, { x: 8, y: 0, radius: 1 }];
  const blockers = [{ x: 7, y: 0, radius: 1 }];
  const nearest = ShooterRules.nearestRayHit({ x: 0, y: 0 }, { x: 10, y: 0 }, actors, blockers);
  assert.equal(nearest.type, 'actor');
  assert.equal(nearest.index, 0);
  assert.equal(nearest.target, actors[0]);

  blockers[0].x = 5;
  const tied = ShooterRules.nearestRayHit({ x: 0, y: 0 }, { x: 10, y: 0 }, actors, blockers);
  assert.equal(tied.type, 'blocker');
  assert.equal(tied.index, 0);
  assert.equal(tied.target, blockers[0]);
  close(tied.x, 4);
  assert.equal(ShooterRules.nearestRayHit({ x: 0, y: 4 }, { x: 10, y: 4 }, actors, blockers), null);
});

test('line of sight accounts for tangency, padding, and endpoint blockers', () => {
  const blocker = { x: 5, y: 1, radius: 1 };
  assert.equal(ShooterRules.hasLineOfSight({ x: 0, y: 0 }, { x: 10, y: 0 }, [blocker]), false);
  assert.equal(ShooterRules.hasLineOfSight({ x: 0, y: -0.01 }, { x: 10, y: -0.01 }, [blocker]), true);
  assert.equal(ShooterRules.hasLineOfSight({ x: 0, y: -0.01 }, { x: 10, y: -0.01 }, [blocker], 0.02), false);
  assert.equal(ShooterRules.hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, [{ x: 5, y: 0, radius: 1 }]), false);
  assert.equal(ShooterRules.hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, []), true);
});

test('cover candidates emit eight stable points per blocker without mutation', () => {
  const blockers = [{ x: 10, y: 20, radius: 2 }, { x: -4, y: 3, radius: 0 }];
  const before = structuredClone(blockers);
  const points = plain(ShooterRules.coverCandidates(blockers, 3, 1));
  assert.equal(points.length, 16);
  assert.deepEqual(points[0], { x: 16, y: 20 });
  close(points[1].x, 10 + 6 * Math.SQRT1_2);
  close(points[1].y, 20 + 6 * Math.SQRT1_2);
  assert.deepEqual(points[2], { x: 10, y: 26 });
  assert.deepEqual(points[4], { x: 4, y: 20 });
  assert.deepEqual(points[8], { x: 0, y: 3 });
  assert.deepEqual(blockers, before);
});

test('cover choice requires occlusion, clearance, occupancy, and bounds', () => {
  const actor = { x: 0, y: 0, radius: 1 };
  const threat = { x: 0, y: 0 };
  const blockers = [{ x: 10, y: 0, radius: 2 }];
  const bounds = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
  const chosen = ShooterRules.chooseCover(actor, threat, blockers, [], bounds);
  close(chosen.x, 10 + 3 * Math.SQRT1_2);
  close(chosen.y, 3 * Math.SQRT1_2);
  assert.deepEqual(plain({ blockerIndex: chosen.blockerIndex, candidateIndex: chosen.candidateIndex }), {
    blockerIndex: 0,
    candidateIndex: 1,
  });
  const occupied = [{ x: chosen.x, y: chosen.y, radius: 1 }];
  assert.ok(ShooterRules.chooseCover(actor, threat, blockers, occupied, bounds).y < 0);
  assert.equal(ShooterRules.chooseCover(actor, threat, blockers, [], { minX: -5, minY: -5, maxX: 12, maxY: 5 }), null);
  assert.equal(ShooterRules.chooseCover(actor, threat, [], [], bounds), null);
});

test('cover choice resolves equal scores by stable generation order', () => {
  const actor = { x: 0, y: 0, radius: 0 };
  const threat = { x: 0, y: 0 };
  const blockers = [{ x: 5, y: 1, radius: 1 }, { x: 5, y: -1, radius: 1 }];
  const chosen = ShooterRules.chooseCover(actor, threat, blockers, [], { x: -20, y: -20, width: 40, height: 40 });
  assert.ok(chosen);
  assert.ok(chosen.y > 0, 'first blocker wins an equal score tie');
});

test('circle movement stops head-on and slides along blockers', () => {
  const blockers = [{ x: 5, y: 0, radius: 1 }];
  const stopped = ShooterRules.resolveCircleMovement({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, blockers);
  close(stopped.x, 3);
  close(stopped.y, 0);
  assert.deepEqual(plain({ blocked: stopped.blocked, hits: stopped.hits }), { blocked: true, hits: 1 });

  const slide = ShooterRules.resolveCircleMovement({ x: 0, y: 0 }, { x: 6, y: 2 }, 1, blockers);
  assert.equal(slide.blocked, true);
  assert.ok(slide.y > 2, 'tangent projection slides around the circle');
  const distance = Math.hypot(slide.x - blockers[0].x, slide.y - blockers[0].y);
  assert.ok(distance >= 2 - 1e-9, 'resolved actor does not overlap');
});

test('circle movement passes freely and resolves overlapping starts', () => {
  const free = ShooterRules.resolveCircleMovement({ x: 1, y: 2 }, { x: 3, y: -4 }, 1, []);
  assert.deepEqual(plain(free), { x: 4, y: -2, blocked: false, hits: 0 });

  const pushed = ShooterRules.resolveCircleMovement({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, [{ x: 0, y: 0, radius: 2 }]);
  assert.deepEqual(plain(pushed), { x: 3, y: 0, blocked: true, hits: 0 });
});

test('shot spread is stateless, bounded, and keyed by seed, entity, and serial', () => {
  const args = ['raid-17', 'guard-2', 9, 0.12];
  const spread = ShooterRules.shotSpread(...args);
  assert.equal(ShooterRules.shotSpread(...args), spread);
  assert.ok(spread >= -0.12 && spread < 0.12);
  assert.notEqual(ShooterRules.shotSpread('raid-18', 'guard-2', 9, 0.12), spread);
  assert.notEqual(ShooterRules.shotSpread('raid-17', 'guard-3', 9, 0.12), spread);
  assert.notEqual(ShooterRules.shotSpread('raid-17', 'guard-2', 10, 0.12), spread);
  assert.equal(ShooterRules.shotSpread('raid-17', 'guard-2', 9, 0), 0);
  assert.equal(ShooterRules.shotSpread('raid-17', 'guard-2', 9, -1), 0);
});

test('damage falloff is clamped and linear over its effective range', () => {
  assert.equal(ShooterRules.damageFalloff(100, 0, 20, 100, 25), 100);
  assert.equal(ShooterRules.damageFalloff(100, 20, 20, 100, 25), 100);
  close(ShooterRules.damageFalloff(100, 60, 20, 100, 25), 62.5);
  assert.equal(ShooterRules.damageFalloff(100, 100, 20, 100, 25), 25);
  assert.equal(ShooterRules.damageFalloff(100, 200, 20, 100, 25), 25);
  assert.equal(ShooterRules.damageFalloff(100, 21, 20, 20, 25), 25);
  assert.equal(ShooterRules.damageFalloff(-10, 0, 20, 100, 25), 0);
});

test('seeded random is reproducible, bounded, and seed-sensitive', () => {
  const a = ShooterRules.createRng('raid-17');
  const b = ShooterRules.createRng('raid-17');
  const c = ShooterRules.createRng('raid-18');
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  const seqC = Array.from({ length: 20 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  assert.ok(seqA.every((value) => value >= 0 && value < 1));

  const rangeRng = ShooterRules.createRng(123);
  for (let index = 0; index < 20; index++) {
    const value = ShooterRules.randomRange(rangeRng, -4, 7);
    assert.ok(value >= -4 && value < 7);
  }
});

test('loot rolls are stateless, keyed by seed and source, and use known types', () => {
  const types = ['ammo', 'scrap', 'medkit', 'electronics', 'intel'];
  const first = ShooterRules.rollLoot('raid-17', 'crate-4');
  assert.equal(ShooterRules.rollLoot('raid-17', 'crate-4'), first);
  assert.ok(types.includes(first));

  const rolls = Array.from({ length: 100 }, (_, source) => ShooterRules.rollLoot('raid-17', source));
  assert.deepEqual([...new Set(rolls)].sort(), [...types].sort());
  assert.notDeepEqual(
    rolls,
    Array.from({ length: 100 }, (_, source) => ShooterRules.rollLoot('raid-18', source))
  );
  assert.notEqual(ShooterRules.rollLoot(1, 'crate'), ShooterRules.rollLoot('1', 'crate'));
});

test('meta sanitizing returns a versioned finite clamped integer record', () => {
  const source = {
    version: 99,
    credits: 12.9,
    ammoLevel: -4,
    medkitLevel: Infinity,
    armorLevel: 2.9,
    kills: 17.8,
    bestValue: 340.9,
    streak: 2.2,
    raids: 4.8,
    extractions: 9e20,
    ignored: 42,
  };
  assert.deepEqual(plain(ShooterRules.sanitizeMeta(source)), {
    version: 1,
    credits: 12,
    ammoLevel: 0,
    medkitLevel: 0,
    armorLevel: 2,
    kills: 17,
    bestValue: 340,
    streak: 2,
    raids: 4,
    extractions: 2147483647,
  });
  assert.deepEqual(plain(ShooterRules.sanitizeMeta(null)), {
    version: 1,
    credits: 0,
    ammoLevel: 0,
    medkitLevel: 0,
    armorLevel: 0,
    kills: 0,
    bestValue: 0,
    streak: 0,
    raids: 0,
    extractions: 0,
  });
});

test('upgrade purchases succeed without mutation and preserve unrelated progress', () => {
  const meta = { version: 1, credits: 125, ammoLevel: 1, medkitLevel: 2, armorLevel: 1, kills: 7, bestValue: 200, streak: 2, raids: 8, extractions: 3 };
  const before = structuredClone(meta);
  const result = ShooterRules.purchaseUpgrade(meta, 'ammo', 25, 3);
  assert.deepEqual(meta, before);
  assert.deepEqual(plain(result), {
    ok: true,
    reason: 'purchased',
    meta: { version: 1, credits: 100, ammoLevel: 2, medkitLevel: 2, armorLevel: 1, kills: 7, bestValue: 200, streak: 2, raids: 8, extractions: 3 },
  });
  assert.notEqual(result.meta, meta);
});

test('upgrade purchase failures are explicit, sanitized, and non-mutating', () => {
  const meta = { credits: 10, ammoLevel: 2, medkitLevel: 0, raids: 1, extractions: 0 };
  const before = structuredClone(meta);
  assert.equal(ShooterRules.purchaseUpgrade(meta, 'ammo', 5, 2).reason, 'max-level');
  assert.equal(ShooterRules.purchaseUpgrade(meta, 'medkit', 11, 2).reason, 'insufficient-credits');
  assert.equal(ShooterRules.purchaseUpgrade(meta, 'armor', 1, 2).reason, 'invalid');
  assert.equal(ShooterRules.purchaseUpgrade(meta, 'ammo', NaN, 2).reason, 'invalid');
  assert.equal(ShooterRules.purchaseUpgrade(meta, 'ammo', 1, -1).reason, 'invalid');
  assert.deepEqual(meta, before);
  assert.deepEqual(plain(ShooterRules.purchaseUpgrade(meta, 'medkit', 11, 2).meta), {
    version: 1,
    credits: 10,
    ammoLevel: 2,
    medkitLevel: 0,
    armorLevel: 0,
    kills: 0,
    bestValue: 0,
    streak: 0,
    raids: 1,
    extractions: 0,
  });
});
