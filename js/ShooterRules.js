// Pure deterministic 2D rules shared by extraction-shooter game logic.

/** @satisfies {Record<string, any>} */
const ShooterRules = {
  EPSILON: 1e-9,

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  distanceSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  },

  length(x, y) {
    return Math.sqrt(x * x + y * y);
  },

  normalize(x, y, fallbackX = 1, fallbackY = 0) {
    const length = Math.sqrt(x * x + y * y);
    if (length <= ShooterRules.EPSILON) return { x: fallbackX, y: fallbackY };
    return { x: x / length, y: y / length };
  },

  /**
   * First intersection of a segment and a circle, including a start inside the circle.
   * `padding` expands the circle, which is useful when sweeping an actor circle.
   *
   * @param {{x: number, y: number}} start
   * @param {{x: number, y: number}} end
   * @param {{x: number, y: number, radius?: number}} circle
   * @param {number} [padding]
   * @returns {{t: number, x: number, y: number, normalX: number, normalY: number} | null}
   */
  segmentCircleHit(start, end, circle, padding = 0) {
    const radius = Math.max(0, (circle.radius || 0) + padding);
    // Fast AABB rejection test before quadratic computation
    const minX = (start.x < end.x ? start.x : end.x) - radius - ShooterRules.EPSILON;
    const maxX = (start.x > end.x ? start.x : end.x) + radius + ShooterRules.EPSILON;
    if (circle.x < minX || circle.x > maxX) return null;
    const minY = (start.y < end.y ? start.y : end.y) - radius - ShooterRules.EPSILON;
    const maxY = (start.y > end.y ? start.y : end.y) + radius + ShooterRules.EPSILON;
    if (circle.y < minY || circle.y > maxY) return null;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const ox = start.x - circle.x;
    const oy = start.y - circle.y;
    const a = dx * dx + dy * dy;
    const c = ox * ox + oy * oy - radius * radius;

    if (c <= -ShooterRules.EPSILON) {
      const normal = ShooterRules.normalize(ox, oy, -dx || 1, -dy);
      return { t: 0, x: start.x, y: start.y, normalX: normal.x, normalY: normal.y };
    }
    if (a <= ShooterRules.EPSILON) return null;

    const b = ox * dx + oy * dy;
    // A boundary point moving away or along the tangent is not a new collision.
    if (Math.abs(c) <= ShooterRules.EPSILON && b >= -ShooterRules.EPSILON) return null;
    const discriminant = b * b - a * c;
    if (discriminant < -ShooterRules.EPSILON) return null;
    const t = (-b - Math.sqrt(Math.max(0, discriminant))) / a;
    if (t < -ShooterRules.EPSILON || t > 1 + ShooterRules.EPSILON) return null;

    const hitT = ShooterRules.clamp(t, 0, 1);
    const x = start.x + dx * hitT;
    const y = start.y + dy * hitT;
    const normal = ShooterRules.normalize(x - circle.x, y - circle.y, -dx || 1, -dy);
    return { t: hitT, x, y, normalX: normal.x, normalY: normal.y };
  },

  /**
   * Nearest segment hit. Ties are resolved by blocker order for deterministic results.
   *
   * @param {{x: number, y: number}} start
   * @param {{x: number, y: number}} end
   * @param {Array<{x: number, y: number, radius?: number}>} circles
   * @param {number} [padding]
   * @returns {{t: number, x: number, y: number, normalX: number, normalY: number, index: number, circle: {x: number, y: number, radius?: number}} | null}
   */
  nearestSegmentCircleHit(start, end, circles, padding = 0) {
    let nearest = null;
    for (let index = 0; index < circles.length; index++) {
      const hit = ShooterRules.segmentCircleHit(start, end, circles[index], padding);
      if (hit && (!nearest || hit.t < nearest.t - ShooterRules.EPSILON)) {
        nearest = { ...hit, index, circle: circles[index] };
      }
    }
    return nearest;
  },

  /**
   * Nearest actor or blocker hit along a segment. A blocker wins a distance tie,
   * regardless of collection order.
   *
   * @param {{x: number, y: number}} start
   * @param {{x: number, y: number}} end
   * @param {Array<{x: number, y: number, radius?: number}>} actors
   * @param {Array<{x: number, y: number, radius?: number}>} blockers
   * @returns {{t: number, x: number, y: number, normalX: number, normalY: number, type: 'actor' | 'blocker', index: number, target: {x: number, y: number, radius?: number}} | null}
   */
  nearestRayHit(start, end, actors, blockers) {
    const actorHit = ShooterRules.nearestSegmentCircleHit(start, end, actors);
    const blockerHit = ShooterRules.nearestSegmentCircleHit(start, end, blockers);
    if (!actorHit && !blockerHit) return null;
    if (blockerHit && (!actorHit || blockerHit.t <= actorHit.t + ShooterRules.EPSILON)) {
      const { circle, ...hit } = blockerHit;
      return { ...hit, type: 'blocker', target: circle };
    }
    const { circle, ...hit } = actorHit;
    return { ...hit, type: 'actor', target: circle };
  },

  /**
   * Whether the closed segment is free of circular blockers.
   *
   * @param {{x: number, y: number}} start
   * @param {{x: number, y: number}} end
   * @param {Array<{x: number, y: number, radius?: number}>} blockers
   * @param {number} [padding]
   */
  hasLineOfSight(start, end, blockers, padding = 0) {
    if (!blockers || blockers.length === 0) return true;
    for (let i = 0; i < blockers.length; i++) {
      if (ShooterRules.segmentCircleHit(start, end, blockers[i], padding) !== null) {
        return false;
      }
    }
    return true;
  },

  /**
   * Batch Line-of-Sight verification for multiple rays against blockers.
   * Dispatches to ArcJobSystem if available, otherwise executes iteratively.
   *
   * @param {Array<{ id?: string|number, startX: number, startY: number, endX: number, endY: number, padding?: number }>} rays
   * @param {Array<{ x: number, y: number, radius?: number }>} blockers
   * @param {number} [padding]
   * @returns {Promise<Array<{ id: any, hasLoS: boolean, hit: any }>>}
   */
  async hasLineOfSightBatch(rays, blockers, padding = 0) {
    if (!Array.isArray(rays) || rays.length === 0) return [];
    if (typeof ArcJobSystem !== 'undefined') {
      try {
        return await ArcJobSystem.dispatch('BATCH_RAYCAST', { rays, blockers, padding });
      } catch (_) {}
    }
    return rays.map(ray => {
      const start = { x: ray.startX, y: ray.startY };
      const end = { x: ray.endX, y: ray.endY };
      const pad = ray.padding != null ? ray.padding : padding;
      const hit = ShooterRules.nearestSegmentCircleHit(start, end, blockers, pad);
      return { id: ray.id, hasLoS: hit === null, hit };
    });
  },

  /**
   * Generate eight stable actor-center positions around every circular blocker.
   * Points are emitted in blocker order, then clockwise from +X in 45 degree steps.
   * Inputs are never changed.
   *
   * @param {Array<{x: number, y: number, radius?: number}>} blockers
   * @param {number} actorRadius
   * @param {number} [margin]
   * @returns {Array<{x: number, y: number}>}
   */
  coverCandidates(blockers, actorRadius, margin = 0) {
    const safeActorRadius = Math.max(0, Number.isFinite(actorRadius) ? actorRadius : 0);
    const safeMargin = Math.max(0, Number.isFinite(margin) ? margin : 0);
    const diagonal = Math.SQRT1_2;
    const directions = [
      [1, 0], [diagonal, diagonal], [0, 1], [-diagonal, diagonal],
      [-1, 0], [-diagonal, -diagonal], [0, -1], [diagonal, -diagonal],
    ];
    const candidates = [];
    for (const blocker of blockers) {
      const blockerRadius = Math.max(0, Number.isFinite(blocker.radius) ? blocker.radius : 0);
      const distance = blockerRadius + safeActorRadius + safeMargin;
      for (const direction of directions) {
        candidates.push({
          x: blocker.x + direction[0] * distance,
          y: blocker.y + direction[1] * distance,
        });
      }
    }
    return candidates;
  },

  /**
   * Choose the nearest valid generated cover point. A point is valid when the
   * actor circle is inside bounds, overlaps neither blockers nor occupied actors,
   * and a blocker occludes the closed segment from the threat. Equal scores keep
   * candidate generation order, making blocker and direction order the tie-break.
   *
   * Bounds may be `{minX, minY, maxX, maxY}` or `{x, y, width, height}`.
   * The returned point is new and no input is mutated.
   *
   * @param {{x: number, y: number, radius?: number, coverMargin?: number}} actor
   * @param {{x: number, y: number}} threat
   * @param {Array<{x: number, y: number, radius?: number}>} blockers
   * @param {Array<{x: number, y: number, radius?: number}>} occupied
   * @param {{minX?: number, minY?: number, maxX?: number, maxY?: number, x?: number, y?: number, width?: number, height?: number} | null} bounds
   * @returns {{x: number, y: number, blockerIndex: number, candidateIndex: number} | null}
   */
  chooseCover(actor, threat, blockers, occupied, bounds) {
    const actorRadius = Math.max(0, Number.isFinite(actor.radius) ? actor.radius : 0);
    const margin = Math.max(0, Number.isFinite(actor.coverMargin) ? actor.coverMargin : 0);
    const candidates = ShooterRules.coverCandidates(blockers, actorRadius, margin);
    const minX = bounds && Number.isFinite(bounds.minX) ? bounds.minX
      : bounds && Number.isFinite(bounds.x) ? bounds.x : -Infinity;
    const minY = bounds && Number.isFinite(bounds.minY) ? bounds.minY
      : bounds && Number.isFinite(bounds.y) ? bounds.y : -Infinity;
    const maxX = bounds && Number.isFinite(bounds.maxX) ? bounds.maxX
      : bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.width) ? bounds.x + bounds.width : Infinity;
    const maxY = bounds && Number.isFinite(bounds.maxY) ? bounds.maxY
      : bounds && Number.isFinite(bounds.y) && Number.isFinite(bounds.height) ? bounds.y + bounds.height : Infinity;
    let best = null;
    let bestScore = Infinity;

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      const candidate = candidates[candidateIndex];
      if (candidate.x < minX + actorRadius - ShooterRules.EPSILON
          || candidate.x > maxX - actorRadius + ShooterRules.EPSILON
          || candidate.y < minY + actorRadius - ShooterRules.EPSILON
          || candidate.y > maxY - actorRadius + ShooterRules.EPSILON) continue;

      let overlaps = false;
      for (const blocker of blockers) {
        const radius = actorRadius + Math.max(0, Number.isFinite(blocker.radius) ? blocker.radius : 0);
        if (ShooterRules.distanceSq(candidate, blocker) < radius * radius - ShooterRules.EPSILON) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      for (const occupant of occupied) {
        if (occupant === actor) continue;
        const radius = actorRadius + Math.max(0, Number.isFinite(occupant.radius) ? occupant.radius : 0);
        if (ShooterRules.distanceSq(candidate, occupant) < radius * radius - ShooterRules.EPSILON) {
          overlaps = true;
          break;
        }
      }
      if (overlaps || ShooterRules.hasLineOfSight(threat, candidate, blockers)) continue;

      const score = ShooterRules.distanceSq(actor, candidate);
      if (score < bestScore - ShooterRules.EPSILON) {
        best = {
          x: candidate.x,
          y: candidate.y,
          blockerIndex: Math.floor(candidateIndex / 8),
          candidateIndex: candidateIndex % 8,
        };
        bestScore = score;
      }
    }
    return best;
  },

  /**
   * Move a circle through static circular blockers. Collisions slide along surfaces.
   * The returned value does not mutate any input object.
   *
   * @param {{x: number, y: number}} start
   * @param {{x: number, y: number}} delta
   * @param {number} radius
   * @param {Array<{x: number, y: number, radius?: number}>} blockers
   * @param {number} [maxIterations]
   * @returns {{x: number, y: number, blocked: boolean, hits: number}}
   */
  resolveCircleMovement(start, delta, radius, blockers, maxIterations = 4) {
    let x = start.x;
    let y = start.y;
    let blocked = false;
    let hits = 0;
    const actorRadius = Math.max(0, radius);
    const iterations = Math.max(0, Math.floor(maxIterations));

    // Resolve an initially overlapping spawn deterministically before sweeping.
    for (let pass = 0; pass < iterations; pass++) {
      let changed = false;
      for (let index = 0; index < blockers.length; index++) {
        const blocker = blockers[index];
        const combined = actorRadius + Math.max(0, blocker.radius || 0);
        const dx = x - blocker.x;
        const dy = y - blocker.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < combined - ShooterRules.EPSILON) {
          const normal = ShooterRules.normalize(dx, dy, 1, 0);
          x = blocker.x + normal.x * combined;
          y = blocker.y + normal.y * combined;
          changed = blocked = true;
        }
      }
      if (!changed) break;
    }

    let moveX = delta.x;
    let moveY = delta.y;
    for (let pass = 0; pass < iterations; pass++) {
      if (moveX * moveX + moveY * moveY <= ShooterRules.EPSILON * ShooterRules.EPSILON) break;
      const from = { x, y };
      const to = { x: x + moveX, y: y + moveY };
      const hit = ShooterRules.nearestSegmentCircleHit(from, to, blockers, actorRadius);
      if (!hit) {
        x = to.x;
        y = to.y;
        moveX = moveY = 0;
        break;
      }

      blocked = true;
      hits++;
      x = hit.x;
      y = hit.y;
      const remaining = 1 - hit.t;
      moveX *= remaining;
      moveY *= remaining;
      const inward = moveX * hit.normalX + moveY * hit.normalY;
      if (inward < 0) {
        moveX -= hit.normalX * inward;
        moveY -= hit.normalY * inward;
      }
    }

    return { x, y, blocked, hits };
  },

  /** Hash a number or string to an unsigned 32-bit seed. */
  hashSeed(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
    const text = String(seed);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  },

  /**
   * Stateless deterministic shot angle offset in `[-maxSpread, maxSpread)`.
   * The result depends only on the three identity values and does not consume RNG state.
   *
   * @param {number | string} seed
   * @param {number | string} entityId
   * @param {number} shotSerial
   * @param {number} maxSpread radians
   */
  shotSpread(seed, entityId, shotSerial, maxSpread) {
    let hash = 2166136261;
    for (const part of [seed, entityId, shotSerial]) {
      const text = typeof part + ':' + String(part);
      for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      hash ^= 255;
      hash = Math.imul(hash, 16777619);
    }
    hash += 0x6d2b79f5;
    hash = Math.imul(hash ^ (hash >>> 15), hash | 1);
    hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
    const unit = ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
    const spread = Math.max(0, Number.isFinite(maxSpread) ? maxSpread : 0);
    return spread === 0 ? 0 : (unit * 2 - 1) * spread;
  },

  /**
   * Linear distance falloff from `baseDamage` to `minimumDamage`.
   * Damage is full through `fullDamageDistance` and minimum at `maxDistance`.
   *
   * @param {number} baseDamage
   * @param {number} distance
   * @param {number} fullDamageDistance
   * @param {number} maxDistance
   * @param {number} [minimumDamage]
   */
  damageFalloff(baseDamage, distance, fullDamageDistance, maxDistance, minimumDamage = 0) {
    const high = Math.max(0, baseDamage);
    const low = ShooterRules.clamp(minimumDamage, 0, high);
    const near = Math.max(0, fullDamageDistance);
    const far = Math.max(near, maxDistance);
    const range = far - near;
    if (distance <= near || range <= ShooterRules.EPSILON) return distance <= near ? high : low;
    if (distance >= far) return low;
    const fraction = (distance - near) / range;
    return high + (low - high) * fraction;
  },

  /** Return a deterministic PRNG function producing values in [0, 1). */
  createRng(seed) {
    let state = ShooterRules.hashSeed(seed);
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  },

  randomRange(rng, min, max) {
    return min + (max - min) * rng();
  },

  /** The stable loot table order is part of saved/replayed raid behavior. */
  LOOT_TYPES: Object.freeze(['ammo', 'scrap', 'medkit', 'electronics', 'intel']),
  /**
   * What each loot type is worth, in credits. This table lives HERE, in the module both the
   * browser and the server load, because the payout is now server-authoritative: two copies of
   * these numbers would let the client and the server disagree about what a raid was worth.
   * The values match the labels used by the loot feed.
   */
  LOOT_VALUES: Object.freeze({ ammo: 20, scrap: 35, medkit: 55, electronics: 75, intel: 120 }),
  /**
   * Backpack capacity for non-instant loot. This is the count of PHYSICAL cells in the raid
   * grid; `GAME_BACKPACK_SLOTS` (Constants.js) is the tunable that the game and the server
   * both read. The value here is a fallback for a caller that loads ShooterRules on its own,
   * and the two must not drift.
   */
  BACKPACK_SLOTS: 18,
  META_VERSION: 1,
  META_INTEGER_MAX: 2147483647,

  /**
   * Pick one loot type without creating or consuming mutable RNG state.
   * Seed and source id are tagged, so values such as `1` and `'1'` stay distinct.
   *
   * @param {number | string} seed
   * @param {number | string} sourceId
   * @returns {'ammo' | 'scrap' | 'medkit' | 'electronics' | 'intel'}
   */
  rollLoot(seed, sourceId) {
    const rng = ShooterRules.createRng(
      typeof seed + ':' + String(seed) + '|source|' + typeof sourceId + ':' + String(sourceId)
    );
    return /** @type {'ammo' | 'scrap' | 'medkit' | 'electronics' | 'intel'} */ (
      ShooterRules.LOOT_TYPES[Math.floor(rng() * ShooterRules.LOOT_TYPES.length)]
    );
  },

  /** Convert an untrusted value to a non-negative, bounded integer. */
  metaInteger(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return ShooterRules.clamp(Math.floor(value), 0, ShooterRules.META_INTEGER_MAX);
  },

  /**
   * Return the canonical persisted meta-progression shape.
   * Unknown fields and values that are not finite numbers are discarded.
   *
   * @param {unknown} input
   * @returns {{version: number, credits: number, ammoLevel: number, medkitLevel: number, armorLevel: number, raids: number, extractions: number, kills: number, bestValue: number, streak: number}}
   */
  sanitizeMeta(input) {
    const source = input && typeof input === 'object' ? /** @type {Record<string, any>} */ (input) : {};
    return {
      version: ShooterRules.META_VERSION,
      credits: ShooterRules.metaInteger(source.credits),
      ammoLevel: ShooterRules.metaInteger(source.ammoLevel),
      medkitLevel: ShooterRules.metaInteger(source.medkitLevel),
      armorLevel: ShooterRules.metaInteger(source.armorLevel),
      raids: ShooterRules.metaInteger(source.raids),
      extractions: ShooterRules.metaInteger(source.extractions),
      kills: ShooterRules.metaInteger(source.kills),
      bestValue: ShooterRules.metaInteger(source.bestValue),
      streak: ShooterRules.metaInteger(source.streak),
    };
  },

  /**
   * Buy one ammo or medkit level with credits. Every result contains a fresh
   * sanitized meta object; the supplied object is never changed.
   *
   * @param {unknown} meta
   * @param {string} type `ammo` or `medkit`
   * @param {number} cost
   * @param {number} maxLevel
   * @returns {{ok: boolean, reason: 'purchased' | 'invalid' | 'max-level' | 'insufficient-credits', meta: ReturnType<typeof ShooterRules.sanitizeMeta>}}
   */
  purchaseUpgrade(meta, type, cost, maxLevel) {
    const clean = ShooterRules.sanitizeMeta(meta);
    const field = type === 'ammo' ? 'ammoLevel' : type === 'medkit' ? 'medkitLevel' : '';
    const safeCost = Number.isFinite(cost) ? Math.floor(cost) : -1;
    const safeMax = Number.isFinite(maxLevel) ? Math.floor(maxLevel) : -1;
    if (!field || safeCost < 0 || safeMax < 0 || safeCost > ShooterRules.META_INTEGER_MAX
        || safeMax > ShooterRules.META_INTEGER_MAX) {
      return { ok: false, reason: 'invalid', meta: clean };
    }
    if (clean[field] >= safeMax) return { ok: false, reason: 'max-level', meta: clean };
    if (clean.credits < safeCost) return { ok: false, reason: 'insufficient-credits', meta: clean };
    return {
      ok: true,
      reason: 'purchased',
      meta: { ...clean, credits: clean.credits - safeCost, [field]: clean[field] + 1 },
    };
  },

  /**
   * First intersection of a 3D line segment with a vertical cylinder.
   * Cylinder defined by base {x, y, h}, height, and radius.
   *
   * @param {{x: number, y: number, h: number}} start
   * @param {{x: number, y: number, h: number}} end
   * @param {{x: number, y: number, h?: number, height?: number, radius?: number}} cylinder
   * @returns {{t: number, x: number, y: number, h: number, normalX: number, normalY: number, normalH: number} | null}
   */
  rayCylinderHit(start, end, cylinder) {
    const radius = Math.max(ShooterRules.EPSILON, cylinder.radius || 0);
    const baseH = cylinder.h != null ? cylinder.h : 0;
    const topH = baseH + Math.max(ShooterRules.EPSILON, cylinder.height || 64);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dh = end.h - start.h;
    const ox = start.x - cylinder.x;
    const oy = start.y - cylinder.y;

    // Check if start is inside the cylinder
    if (ox * ox + oy * oy <= radius * radius + ShooterRules.EPSILON &&
        start.h >= baseH - ShooterRules.EPSILON && start.h <= topH + ShooterRules.EPSILON) {
      return { t: 0, x: start.x, y: start.y, h: start.h, normalX: 0, normalY: 0, normalH: dh < 0 ? 1 : -1 };
    }

    let nearestT = Infinity;
    let hitNormal = null;

    // 1. Curved lateral surface of the cylinder
    const a = dx * dx + dy * dy;
    const b = ox * dx + oy * dy;
    const c = ox * ox + oy * oy - radius * radius;

    if (a > ShooterRules.EPSILON) {
      const discr = b * b - a * c;
      if (discr >= 0) {
        const sqrtD = Math.sqrt(discr);
        const t1 = (-b - sqrtD) / a;
        const t2 = (-b + sqrtD) / a;
        for (const t of [t1, t2]) {
          if (t >= -ShooterRules.EPSILON && t <= 1 + ShooterRules.EPSILON) {
            const clampedT = ShooterRules.clamp(t, 0, 1);
            const hitH = start.h + clampedT * dh;
            if (hitH >= baseH - ShooterRules.EPSILON && hitH <= topH + ShooterRules.EPSILON) {
              if (clampedT < nearestT) {
                nearestT = clampedT;
                const hx = start.x + clampedT * dx;
                const hy = start.y + clampedT * dy;
                const norm = ShooterRules.normalize(hx - cylinder.x, hy - cylinder.y, 1, 0);
                hitNormal = { x: norm.x, y: norm.y, h: 0 };
              }
            }
          }
        }
      }
    }

    // 2. Bottom and Top end caps (flat horizontal circular disks)
    if (Math.abs(dh) > ShooterRules.EPSILON) {
      // Bottom cap
      const tBot = (baseH - start.h) / dh;
      if (tBot >= -ShooterRules.EPSILON && tBot <= 1 + ShooterRules.EPSILON && tBot < nearestT) {
        const clampedT = ShooterRules.clamp(tBot, 0, 1);
        const bx = start.x + clampedT * dx - cylinder.x;
        const by = start.y + clampedT * dy - cylinder.y;
        if (bx * bx + by * by <= radius * radius + ShooterRules.EPSILON) {
          nearestT = clampedT;
          hitNormal = { x: 0, y: 0, h: -1 };
        }
      }

      // Top cap
      const tTop = (topH - start.h) / dh;
      if (tTop >= -ShooterRules.EPSILON && tTop <= 1 + ShooterRules.EPSILON && tTop < nearestT) {
        const clampedT = ShooterRules.clamp(tTop, 0, 1);
        const tx = start.x + clampedT * dx - cylinder.x;
        const ty = start.y + clampedT * dy - cylinder.y;
        if (tx * tx + ty * ty <= radius * radius + ShooterRules.EPSILON) {
          nearestT = clampedT;
          hitNormal = { x: 0, y: 0, h: 1 };
        }
      }
    }

    if (nearestT <= 1 && hitNormal) {
      return {
        t: nearestT,
        x: start.x + nearestT * dx,
        y: start.y + nearestT * dy,
        h: start.h + nearestT * dh,
        normalX: hitNormal.x,
        normalY: hitNormal.y,
        normalH: hitNormal.h,
      };
    }
    return null;
  },

  /**
   * Determine if hit height is in the upper headzone of the actor cylinder.
   *
   * @param {number} hitH
   * @param {number} actorBaseH
   * @param {number} actorHeight
   * @param {number} [headFraction]
   * @returns {boolean}
   */
  checkHeadshot(hitH, actorBaseH, actorHeight, headFraction = 0.22) {
    const totalH = Math.max(1, actorHeight);
    const threshold = actorBaseH + totalH * (1 - headFraction);
    return hitH >= threshold - ShooterRules.EPSILON;
  },

  /**
   * Create a ballistic projectile instance.
   *
   * @param {{id?: number|string, shooterId?: number|string, x: number, y: number, h: number, vx: number, vy: number, vh: number, damage?: number, caliber?: string, speed?: number, gravity?: number, drag?: number, maxRange?: number, falloffNear?: number, falloffFar?: number, minDamage?: number, headshotMultiplier?: number}} opts
   */
  createProjectile(opts) {
    return {
      id: opts.id || ('proj_' + Math.random().toString(36).slice(2, 9)),
      shooterId: opts.shooterId ?? 0,
      x: opts.x,
      y: opts.y,
      h: opts.h,
      vx: opts.vx,
      vy: opts.vy,
      vh: opts.vh,
      caliber: opts.caliber || '5.56mm',
      damage: opts.damage ?? 34,
      gravity: opts.gravity ?? 980,
      drag: opts.drag ?? 0.04,
      maxRange: opts.maxRange ?? 1400,
      falloffNear: opts.falloffNear ?? 600,
      falloffFar: opts.falloffFar ?? 1200,
      minDamage: opts.minDamage ?? 20,
      headshotMultiplier: opts.headshotMultiplier ?? 1.8,
      distanceTraveled: 0,
      life: 0,
    };
  },

  /**
   * Step a projectile through 3D world space.
   * Checks collisions against terrain, blockers, and actors.
   *
   * @param {ReturnType<typeof ShooterRules.createProjectile>} proj
   * @param {number} dt
   * @param {Array<{id?: number|string, x: number, y: number, h?: number, height?: number, radius?: number, dead?: boolean, hp?: number}>} actors
   * @param {Array<{x: number, y: number, h?: number, height?: number, radius?: number}>} blockers
   * @param {((x: number, y: number) => number) | null} [heightAt]
   * @returns {{hit: boolean, expired?: boolean, type?: 'terrain'|'blocker'|'actor', point?: {x: number, y: number, h: number}, normal?: {x: number, y: number, h: number}, headshot?: boolean, damage?: number, target?: any}}
   */
  stepProjectile(proj, dt, actors = [], blockers = [], heightAt = null) {
    if (dt <= 0) return { hit: false };

    const start = { x: proj.x, y: proj.y, h: proj.h };

    // Apply drag and gravity
    proj.vx -= proj.vx * proj.drag * dt;
    proj.vy -= proj.vy * proj.drag * dt;
    proj.vh -= (proj.vh * proj.drag + proj.gravity) * dt;

    const end = {
      x: start.x + proj.vx * dt,
      y: start.y + proj.vy * dt,
      h: start.h + proj.vh * dt,
    };

    const stepDist = Math.hypot(end.x - start.x, end.y - start.y, end.h - start.h);
    proj.distanceTraveled += stepDist;
    proj.life += dt;

    let nearestT = Infinity;
    let hitResult = null;

    // 1. Check actors (skip dead and the shooter themselves)
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i];
      if (actor.dead || actor.id === proj.shooterId) continue;
      const baseH = actor.h != null ? actor.h : (heightAt ? heightAt(actor.x, actor.y) : 0);
      const height = actor.height || 64;
      const radius = actor.radius || 24;
      const hit = ShooterRules.rayCylinderHit(start, end, {
        x: actor.x,
        y: actor.y,
        h: baseH,
        height,
        radius,
      });

      if (hit && hit.t < nearestT) {
        nearestT = hit.t;
        const isHeadshot = ShooterRules.checkHeadshot(hit.h, baseH, height);
        const dist = proj.distanceTraveled - stepDist * (1 - hit.t);
        const baseDmg = ShooterRules.damageFalloff(proj.damage, dist, proj.falloffNear, proj.falloffFar, proj.minDamage);
        const finalDmg = isHeadshot ? Math.round(baseDmg * proj.headshotMultiplier) : Math.round(baseDmg);
        hitResult = {
          hit: true,
          type: 'actor',
          target: actor,
          point: { x: hit.x, y: hit.y, h: hit.h },
          normal: { x: hit.normalX, y: hit.normalY, h: hit.normalH },
          headshot: isHeadshot,
          damage: finalDmg,
        };
      }
    }

    // 2. Check blockers (cover objects)
    for (let i = 0; i < blockers.length; i++) {
      const blocker = blockers[i];
      const baseH = blocker.h != null ? blocker.h : (heightAt ? heightAt(blocker.x, blocker.y) : 0);
      const height = blocker.height || 80;
      const radius = blocker.radius || 24;
      const hit = ShooterRules.rayCylinderHit(start, end, {
        x: blocker.x,
        y: blocker.y,
        h: baseH,
        height,
        radius,
      });

      if (hit && hit.t < nearestT) {
        nearestT = hit.t;
        hitResult = {
          hit: true,
          type: 'blocker',
          target: blocker,
          point: { x: hit.x, y: hit.y, h: hit.h },
          normal: { x: hit.normalX, y: hit.normalY, h: hit.normalH },
        };
      }
    }

    // 3. Check terrain height intersection
    if (heightAt) {
      const terrainStartH = heightAt(start.x, start.y);
      const terrainEndH = heightAt(end.x, end.y);
      if (end.h <= terrainEndH) {
        // Interpolate collision parameter t
        const diffStart = start.h - terrainStartH;
        const diffEnd = end.h - terrainEndH;
        const denom = diffStart - diffEnd;
        const tTerr = denom > ShooterRules.EPSILON ? ShooterRules.clamp(diffStart / denom, 0, 1) : 0;
        if (tTerr < nearestT) {
          nearestT = tTerr;
          const tx = start.x + tTerr * (end.x - start.x);
          const ty = start.y + tTerr * (end.y - start.y);
          const th = heightAt(tx, ty);
          hitResult = {
            hit: true,
            type: 'terrain',
            point: { x: tx, y: ty, h: th },
            normal: { x: 0, y: 0, h: 1 },
          };
        }
      }
    }

    if (hitResult) {
      proj.x = hitResult.point.x;
      proj.y = hitResult.point.y;
      proj.h = hitResult.point.h;
      return hitResult;
    }

    // No hit: advance projectile
    proj.x = end.x;
    proj.y = end.y;
    proj.h = end.h;

    const expired = proj.distanceTraveled >= proj.maxRange || proj.life >= 3.5;
    return { hit: false, expired };
  },

  /**
   * Deterministic shotgun pellet spread generation.
   * Emits angles (azimuth offset, pitch offset) for each pellet in a shell.
   *
   * @param {number|string} seed
   * @param {number} shotSerial
   * @param {number} count
   * @param {number} spreadRad
   * @returns {Array<{azimuthOffset: number, pitchOffset: number}>}
   */
  shotgunPellets(seed, shotSerial, count, spreadRad) {
    const pellets = [];
    for (let i = 0; i < count; i++) {
      const az = ShooterRules.shotSpread(seed, 'pellet_az_' + i, shotSerial, spreadRad);
      const pi = ShooterRules.shotSpread(seed, 'pellet_pi_' + i, shotSerial, spreadRad * 0.8);
      pellets.push({ azimuthOffset: az, pitchOffset: pi });
    }
    return pellets;
  },

  /**
   * Damped spring physics step for smooth recoil recovery.
   *
   * @param {number} current
   * @param {number} target
   * @param {number} velocity
   * @param {number} dt
   * @param {number} [springK]
   * @param {number} [dampingK]
   * @returns {{value: number, velocity: number}}
   */
  recoilSpring(current, target, velocity, dt, springK = 120, dampingK = 16) {
    const force = -springK * (current - target) - dampingK * velocity;
    const nextVel = velocity + force * dt;
    const nextVal = current + nextVel * dt;
    return { value: nextVal, velocity: nextVel };
  },

  /**
   * Calculate shot interval in seconds from weapon fireRate (RPM).
   * @param {number} [fireRate=70]
   * @returns {number}
   */
  calculateFireInterval(fireRate = 70) {
    const rate = Math.max(1, Number(fireRate) || 70);
    const rpm = rate >= 120 ? rate : rate * 7.5;
    return ShooterRules.clamp(60 / rpm, 0.05, 1.5);
  },

  /**
   * Per-archetype recoil kick, bloom and recovery parameters.
   * @param {string} [archetype='assault_rifle']
   * @param {number} [burstIndex=0]
   * @param {number} [recoilMult=1.0]
   * @returns {{ pitchKick: number, yawKick: number, bloomIncrease: number, recoverySpeed: number, viewmodelKick: number }}
   */
  getRecoilPattern(archetype = 'assault_rifle', burstIndex = 0, recoilMult = 1.0) {
    const mult = Math.max(0.1, Number(recoilMult) || 1.0);
    const b = Math.max(0, burstIndex);
    switch (archetype) {
      case 'smg':
        return {
          pitchKick: (0.016 + Math.min(0.010, b * 0.0018)) * mult,
          yawKick: ((b % 2 === 0 ? 1 : -1) * 0.008) * mult,
          bloomIncrease: 0.012 * mult,
          recoverySpeed: 26,
          viewmodelKick: 0.70 * mult,
        };
      case 'shotgun':
        return {
          pitchKick: 0.054 * mult,
          yawKick: ((b % 2 === 0 ? 1 : -1) * 0.010) * mult,
          bloomIncrease: 0.032 * mult,
          recoverySpeed: 14,
          viewmodelKick: 1.80 * mult,
        };
      case 'revolver':
        return {
          pitchKick: 0.046 * mult,
          yawKick: 0.007 * mult,
          bloomIncrease: 0.022 * mult,
          recoverySpeed: 16,
          viewmodelKick: 1.40 * mult,
        };
      case 'sniper':
        return {
          pitchKick: 0.065 * mult,
          yawKick: 0.002 * mult,
          bloomIncrease: 0.038 * mult,
          recoverySpeed: 12,
          viewmodelKick: 2.20 * mult,
        };
      case 'assault_rifle':
      default:
        return {
          pitchKick: (0.024 + Math.min(0.015, b * 0.0025)) * mult,
          yawKick: (b <= 2 ? 0.003 : (b % 4 < 2 ? 0.006 : -0.006)) * mult,
          bloomIncrease: 0.015 * mult,
          recoverySpeed: 22,
          viewmodelKick: 0.90 * mult,
        };
    }
  },

  /**
   * First-shot accuracy reset helper: whether time since last shot exceeds reset delay.
   * @param {number} timeSinceLastShot
   * @param {number} [resetThreshold=0.28]
   * @returns {boolean}
   */
  isFirstShot(timeSinceLastShot, resetThreshold = 0.28) {
    return (timeSinceLastShot || 0) >= resetThreshold;
  },

  /**
   * Deterministic vision cone check for AI perception.
   * @param {{x: number, y: number}} viewerPos
   * @param {number} viewerHeading Radians (0 = +X, PI/2 = +Y)
   * @param {{x: number, y: number}} targetPos
   * @param {number} visionAngleRad Full horizontal field of view in radians
   * @param {number} maxRange Maximum visual perception distance
   * @returns {boolean}
   */
  isInVisionCone(viewerPos, viewerHeading, targetPos, visionAngleRad, maxRange) {
    const dx = targetPos.x - viewerPos.x;
    const dy = targetPos.y - viewerPos.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > maxRange * maxRange) return false;
    const angleToTarget = Math.atan2(dy, dx);
    const diff = Math.atan2(Math.sin(angleToTarget - viewerHeading), Math.cos(angleToTarget - viewerHeading));
    return Math.abs(diff) <= (visionAngleRad * 0.5);
  },

  /**
   * Calculate muzzle-to-reticle aim convergence.
   * Given camera/eye position, look direction (forward3D), weapon muzzle position, and focal range,
   * calculates the exact aimPoint on the crosshair and the angles required for a bullet leaving the
   * offset muzzle to hit that exact focal point.
   *
   * @param {{x: number, y: number, h: number}} muzzlePos
   * @param {{x: number, y: number, h: number}} eyePos
   * @param {{x: number, y: number, h: number}} forwardDir
   * @param {number} [range=900]
   * @returns {{ aimPoint: {x: number, y: number, h: number}, angle: number, pitch: number, dirX: number, dirY: number, dirH: number, distance: number }}
   */
  calculateAimConvergence(muzzlePos, eyePos, forwardDir, range = 1600, options = {}) {
    const aimDist = Math.max(80, range);
    const aimPoint = {
      x: eyePos.x + forwardDir.x * aimDist,
      y: eyePos.y + forwardDir.y * aimDist,
      h: eyePos.h + forwardDir.h * aimDist,
    };
    if (options.spreadX != null && options.spreadY != null && options.right && options.up) {
      aimPoint.x += (options.right.x * options.spreadX + options.up.x * options.spreadY) * aimDist;
      aimPoint.y += (options.right.y * options.spreadX + options.up.y * options.spreadY) * aimDist;
      aimPoint.h += (options.right.h * options.spreadX + options.up.h * options.spreadY) * aimDist;
    }
    const dx = aimPoint.x - muzzlePos.x;
    const dy = aimPoint.y - muzzlePos.y;
    const dh = aimPoint.h - muzzlePos.h;
    const distHoriz = Math.hypot(dx, dy);
    const totalDist = Math.hypot(distHoriz, dh);
    const angle = Math.atan2(dy, dx);
    const pitch = Math.atan2(dh, Math.max(ShooterRules.EPSILON, distHoriz));
    const invDist = totalDist > ShooterRules.EPSILON ? 1 / totalDist : 0;
    return {
      aimPoint,
      angle,
      pitch,
      dirX: dx * invDist,
      dirY: dy * invDist,
      dirH: dh * invDist,
      distance: totalDist,
    };
  },

  /**
   * Deterministic 3D hitscan raycast against cylinder actors, blockers, and terrain.
   * Simulates instantaneous beam/bullet travel along a ray.
   *
   * @param {{x: number, y: number, h: number}} start
   * @param {{x: number, y: number, h: number}} direction Unit or unnormalized ray direction
   * @param {number} maxRange Maximum raycast range
   * @param {Array<{id?: number|string, x: number, y: number, h?: number, height?: number, radius?: number, dead?: boolean, hp?: number}>} actors
   * @param {Array<{x: number, y: number, h?: number, height?: number, radius?: number}>} blockers
   * @param {((x: number, y: number) => number) | null} [heightAt]
   * @param {{damage?: number, falloffNear?: number, falloffFar?: number, minDamage?: number, headshotMultiplier?: number, shooterId?: number|string, minDistance?: number}} [options]
   * @returns {{hit: boolean, type?: 'actor'|'blocker'|'terrain', point?: {x: number, y: number, h: number}, normal?: {x: number, y: number, h: number}, distance?: number, headshot?: boolean, damage?: number, target?: any}}
   */
  raycastHitscan(start, direction, maxRange, actors = [], blockers = [], heightAt = null, options = {}) {
    const dirLen = Math.hypot(direction.x, direction.y, direction.h || 0);
    const normDir = dirLen > ShooterRules.EPSILON
      ? { x: direction.x / dirLen, y: direction.y / dirLen, h: (direction.h || 0) / dirLen }
      : { x: 1, y: 0, h: 0 };
    const end = {
      x: start.x + normDir.x * maxRange,
      y: start.y + normDir.y * maxRange,
      h: start.h + normDir.h * maxRange,
    };

    let nearestT = Infinity;
    let hitResult = null;
    const shooterId = options.shooterId;
    const minDistance = options.minDistance || 0;
    const minT = maxRange > 0 ? minDistance / maxRange : 0;

    // 1. Check actors (skip dead, shooter, and hits closer than minDistance)
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i];
      if (actor.dead || (shooterId != null && actor.id === shooterId)) continue;
      const baseH = actor.h != null ? actor.h : (heightAt ? heightAt(actor.x, actor.y) : 0);
      const height = actor.height || 64;
      const radius = actor.radius || 24;
      const hit = ShooterRules.rayCylinderHit(start, end, {
        x: actor.x,
        y: actor.y,
        h: baseH,
        height,
        radius,
      });

      if (hit && hit.t >= minT && hit.t < nearestT) {
        nearestT = hit.t;
        const hitDistance = maxRange * hit.t;
        const isHeadshot = ShooterRules.checkHeadshot(hit.h, baseH, height);
        const baseDmg = options.damage != null
          ? ShooterRules.damageFalloff(options.damage, hitDistance, options.falloffNear ?? 600, options.falloffFar ?? 1200, options.minDamage ?? 20)
          : 34;
        const headshotMult = options.headshotMultiplier ?? 1.8;
        const finalDmg = isHeadshot ? Math.round(baseDmg * headshotMult) : Math.round(baseDmg);
        hitResult = {
          hit: true,
          type: 'actor',
          target: actor,
          point: { x: hit.x, y: hit.y, h: hit.h },
          normal: { x: hit.normalX, y: hit.normalY, h: hit.normalH },
          distance: hitDistance,
          headshot: isHeadshot,
          damage: finalDmg,
        };
      }
    }

    // 2. Check blockers (skip hits closer than minDistance)
    for (let i = 0; i < blockers.length; i++) {
      const blocker = blockers[i];
      const baseH = blocker.h != null ? blocker.h : (heightAt ? heightAt(blocker.x, blocker.y) : 0);
      const height = blocker.height || 80;
      const radius = blocker.radius || 24;
      const hit = ShooterRules.rayCylinderHit(start, end, {
        x: blocker.x,
        y: blocker.y,
        h: baseH,
        height,
        radius,
      });

      if (hit && hit.t >= minT && hit.t < nearestT) {
        nearestT = hit.t;
        const hitDistance = maxRange * hit.t;
        hitResult = {
          hit: true,
          type: 'blocker',
          target: blocker,
          point: { x: hit.x, y: hit.y, h: hit.h },
          normal: { x: hit.normalX, y: hit.normalY, h: hit.normalH },
          distance: hitDistance,
        };
      }
    }

    // 3. Check terrain height
    if (heightAt) {
      const terrainStartH = heightAt(start.x, start.y);
      const terrainEndH = heightAt(end.x, end.y);
      if (end.h <= terrainEndH && start.h > terrainStartH) {
        const diffStart = start.h - terrainStartH;
        const diffEnd = end.h - terrainEndH;
        const denom = diffStart - diffEnd;
        const tTerr = denom > ShooterRules.EPSILON ? ShooterRules.clamp(diffStart / denom, 0, 1) : 0;
        if (tTerr >= minT && tTerr < nearestT) {
          nearestT = tTerr;
          const tx = start.x + tTerr * (end.x - start.x);
          const ty = start.y + tTerr * (end.y - start.y);
          const th = heightAt(tx, ty);
          hitResult = {
            hit: true,
            type: 'terrain',
            point: { x: tx, y: ty, h: th },
            normal: { x: 0, y: 0, h: 1 },
            distance: maxRange * tTerr,
          };
        }
      }
    }

    if (hitResult) return hitResult;
    return { hit: false, distance: maxRange, point: { x: end.x, y: end.y, h: end.h } };
  },
};

if (typeof module !== 'undefined') module.exports = ShooterRules;
if (typeof window !== 'undefined') window.ShooterRules = ShooterRules;
if (typeof globalThis !== 'undefined') globalThis.ShooterRules = ShooterRules;


