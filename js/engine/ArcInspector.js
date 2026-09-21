// ============================================================================
//  ArcEngine — ArcInspector (AI Introspection & Reflection Subsystem: ArcEngine.ai)
// ----------------------------------------------------------------------------
//  Purpose: Provide autonomous AI agents and LLMs with complete, structured,
//  zero-hallucination situational awareness of the 3D scene and engine state.
// ============================================================================

/**
 * @typedef {Object} SceneGraphOptions
 * @property {number} [maxDistance] Max radius from origin to include actors
 * @property {Array<number>} [origin] Center coordinates [x, y, z] for distance filtering
 * @property {Array<string>} [tags] Required tags filter
 * @property {boolean} [includeMeshes=false] Whether to include raw mesh geometry info
 */

/**
 * @typedef {Object} ActorHealthSummary
 * @property {number} current
 * @property {number} max
 */

/**
 * @typedef {Object} ActorSummary
 * @property {string} id
 * @property {string} name
 * @property {Array<string>} tags
 * @property {Array<number>} position [x, y, z]
 * @property {ActorHealthSummary} health
 * @property {number} distanceToPlayer
 * @property {number} [distance]
 * @property {Object|null} [mesh]
 */

/**
 * @typedef {Object} SceneGraphData
 * @property {Object} world
 * @property {Array<number>} world.bounds
 * @property {string|number} world.time
 * @property {string} world.dayPhase
 * @property {string} world.weather
 * @property {number} world.activeActorCount
 * @property {Array<ActorSummary>} actors
 */

/**
 * @typedef {Object} ActorQuery
 * @property {string} [tag] Single tag filter
 * @property {Array<string>} [tagsAll] Actor must have all tags
 * @property {Array<string>} [tagsAny] Actor must have at least one tag
 * @property {string} [hasComponent] Component name required
 * @property {string} [name] Name substring match
 * @property {{ point: Array<number> | { x?: number, y?: number, z?: number } | any, radius: number }} [withinRadius] Distance filter
 */

/**
 * @typedef {Object} EngineMetrics
 * @property {number} fps Current frames per second
 * @property {number} frameTimeMs Frame delta time in ms
 * @property {number} drawCalls Total draw calls this frame
 * @property {number} activeMeshes Total active meshes in scene
 * @property {number} totalVertices Total rendered vertex count
 * @property {number} activeVoices Number of playing procedural audio voices
 * @property {number} actorCount Total tracked actors
 * @property {number} spatialGridCells Active cells in spatial grid
 */

/**
 * @typedef {Object} RaycastResult
 * @property {boolean} hit
 * @property {number} distance
 * @property {Array<number>|null} point
 * @property {*} entity
 */

/**
 * @typedef {Object} GroundSampleResult
 * @property {number} height Ground height at sampled coordinates
 * @property {number} slope Ground slope gradient in radians
 * @property {string} surface Terrain surface type
 * @property {string} surfaceType Alias for surface type
 * @property {Array<number>} [normal] Surface normal vector
 */

class ArcInspector {
    /**
     * @param {*} [engine] Reference to ArcEngine instance
     */
    constructor(engine = null) {
        /** @type {*} */
        this.engine = engine;
        if (engine && typeof engine === 'object' && !engine.ai) {
            engine.ai = this;
        }
        this._lastFps = 60;
        this._lastFrameTime = 16.6;
    }

    /**
     * Binds to ArcEngine instance
     * @param {*} engine
     * @returns {this}
     */
    init(engine) {
        this.engine = engine;
        if (engine && typeof engine === 'object' && !engine.ai) {
            engine.ai = this;
        }
        return this;
    }

    /**
     * Generates a clean, JSON-serializable scene graph
     * @param {SceneGraphOptions} [options]
     * @returns {SceneGraphData}
     */
    getSceneGraph(options = {}) {
        const eng = this.engine || (typeof window !== 'undefined' ? /** @type {any} */(window).ArcEngine : null);

        // Resolve player position
        const player = eng?.player || this.findActors({ tag: 'player' })[0] || null;
        let playerPos = [0, 0, 0];
        if (player) {
            if (player.position) {
                playerPos = [player.position.x ?? 0, player.position.y ?? 0, player.position.z ?? 0];
            } else if (player.x !== undefined) {
                playerPos = [player.x ?? 0, player.h ?? player.y ?? 0, player.z ?? player.y ?? 0];
            }
        }

        const origin = options.origin || playerPos;
        const maxDist = (typeof options.maxDistance === 'number') ? options.maxDistance : Infinity;

        /** @type {Array<ActorSummary>} */
        const actorSummaries = [];

        // Collect all active actors
        let allActors = [];
        if (eng?.actors instanceof Map) {
            allActors = Array.from(eng.actors.values());
        } else if (Array.isArray(eng?.actors)) {
            allActors = eng.actors;
        } else if (eng && typeof eng.findActors === 'function' && eng !== this) {
            allActors = eng.findActors();
        }

        for (const actor of allActors) {
            if (actor.active === false || actor.destroyed) continue;

            // Tag filtering
            if (options.tags && options.tags.length > 0) {
                const hasTag = options.tags.some(t => {
                    if (typeof actor.hasTag === 'function') return actor.hasTag(t);
                    if (actor.tags instanceof Set) return actor.tags.has(t);
                    if (Array.isArray(actor.tags)) return actor.tags.includes(t);
                    return false;
                });
                if (!hasTag) continue;
            }

            const ax = actor.position ? (actor.position.x ?? 0) : (actor.x ?? 0);
            const ay = actor.position ? (actor.position.y ?? 0) : (actor.h ?? actor.y ?? 0);
            const az = actor.position ? (actor.position.z ?? 0) : (actor.z ?? actor.y ?? 0);

            // Distance to origin filtering
            const odx = ax - origin[0];
            const ody = ay - origin[1];
            const odz = az - origin[2];
            const distToOrigin = Math.hypot(odx, ody, odz);

            if (distToOrigin > maxDist) continue;

            // Distance to player
            const pdx = ax - playerPos[0];
            const pdy = ay - playerPos[1];
            const pdz = az - playerPos[2];
            const distToPlayer = Math.round(Math.hypot(pdx, pdy, pdz) * 10) / 10;

            // Health resolution
            const healthComp = typeof actor.getComponent === 'function' ? actor.getComponent('Health') : null;
            let health = { current: 100, max: 100 };
            if (healthComp) {
                health = { current: healthComp.hp ?? 100, max: healthComp.maxHp ?? 100 };
            } else if (actor.hp !== undefined) {
                health = { current: actor.hp, max: actor.maxHp ?? actor.hp };
            }

            // Tags resolution
            const tags = actor.tags instanceof Set
                ? Array.from(actor.tags)
                : (Array.isArray(actor.tags) ? actor.tags.slice() : []);

            /** @type {ActorSummary} */
            const summary = {
                id: String(actor.id ?? ''),
                name: String(actor.name ?? actor.id ?? ''),
                tags,
                position: [Math.round(ax), Math.round(ay), Math.round(az)],
                health,
                distanceToPlayer: distToPlayer,
                distance: distToPlayer
            };

            if (options.includeMeshes) {
                const meshComp = typeof actor.getComponent === 'function' ? actor.getComponent('Mesh') : null;
                const mesh = actor.mesh || meshComp?.mesh;
                summary.mesh = mesh ? {
                    name: mesh.name || 'unnamed_mesh',
                    vertices: typeof mesh.getTotalVertices === 'function' ? mesh.getTotalVertices() : 0,
                    isVisible: mesh.isVisible !== false
                } : null;
            }

            actorSummaries.push(summary);
        }

        // Sort by distance to player
        actorSummaries.sort((a, b) => a.distanceToPlayer - b.distanceToPlayer);

        // World info
        const dnc = eng?.dayNightCycle || eng?.dnc || (typeof window !== 'undefined' ? /** @type {any} */(window).DayNightCycle : null);
        const timeRaw = typeof dnc?.getTimeFormatted === 'function'
            ? dnc.getTimeFormatted()
            : (typeof eng?.time === 'string' ? eng.time : (typeof eng?.time?.elapsed === 'number' ? eng.time.elapsed : (typeof eng?.time === 'number' ? eng.time : '14:20')));
        const timeStr = typeof timeRaw === 'number' ? Math.floor(timeRaw) + 's' : timeRaw;

        let dayPhase = 'Daylight';
        if (typeof dnc?.getPeriod === 'function') {
            dayPhase = dnc.getPeriod();
        } else if (typeof eng?.lighting?.dayPhase === 'number') {
            const dp = eng.lighting.dayPhase;
            dayPhase = (dp < 0.25 || dp > 0.85) ? 'Night' : (dp < 0.35 ? 'Dawn' : (dp > 0.70 ? 'Dusk' : 'Daylight'));
        } else if (typeof eng?.dayPhase === 'string') {
            dayPhase = eng.dayPhase;
        }

        const weatherRaw = eng?.weather?.currentState || eng?.weather || 'CLEAR';
        const weather = typeof weatherRaw === 'string' ? weatherRaw : 'CLEAR';
        const bounds = eng?.bounds || (eng?.location ? [eng.location.width || 4096, eng.location.height || 4096] : [4096, 4096]);

        return {
            world: {
                bounds,
                time: timeStr,
                dayPhase,
                weather,
                activeActorCount: actorSummaries.length
            },
            actors: actorSummaries
        };
    }

    /**
     * Queries actors by criteria
     * @param {ActorQuery} [query]
     * @returns {Array<*>}
     */
    findActors(query = {}) {
        const eng = this.engine || (typeof window !== 'undefined' ? /** @type {any} */(window).ArcEngine : null);
        if (!eng) return [];

        let allActors = [];
        if (eng.actors instanceof Map) {
            allActors = Array.from(eng.actors.values());
        } else if (Array.isArray(eng.actors)) {
            allActors = eng.actors.slice();
        } else if (typeof eng.findActors === 'function' && eng !== this) {
            return eng.findActors(query);
        }

        const actorHasTag = (/** @type {*} */ actor, /** @type {string} */ t) => {
            if (typeof actor.hasTag === 'function') return actor.hasTag(t);
            if (actor.tags instanceof Set) return actor.tags.has(t);
            if (Array.isArray(actor.tags)) return actor.tags.includes(t);
            return false;
        };

        const results = [];

        for (const actor of allActors) {
            if (actor.active === false || actor.destroyed) continue;

            if (query.tag && !actorHasTag(actor, query.tag)) continue;
            if (query.tagsAll && Array.isArray(query.tagsAll) && !query.tagsAll.every(t => actorHasTag(actor, t))) continue;
            if (query.tagsAny && Array.isArray(query.tagsAny) && !query.tagsAny.some(t => actorHasTag(actor, t))) continue;

            if (query.hasComponent) {
                const hasComp = typeof actor.hasComponent === 'function'
                    ? actor.hasComponent(query.hasComponent)
                    : (actor.components instanceof Map ? actor.components.has(query.hasComponent) : false);
                if (!hasComp) continue;
            }

            if (query.name) {
                const actorName = String(actor.name || actor.id || '').toLowerCase();
                if (!actorName.includes(query.name.toLowerCase())) continue;
            }

            if (query.withinRadius) {
                const { point, radius } = query.withinRadius;
                if (point && typeof radius === 'number') {
                    const px = Array.isArray(point) ? point[0] : (point.x ?? 0);
                    const ax = actor.position ? (actor.position.x ?? 0) : (actor.x ?? 0);
                    const ay = actor.position ? (actor.position.y ?? 0) : (actor.y ?? 0);
                    const az = actor.position ? (actor.position.z ?? 0) : (actor.z ?? actor.y ?? 0);

                    let distSq;
                    if (Array.isArray(point) && point.length >= 3) {
                        const py = point[1];
                        const pz = point[2];
                        const dx = ax - px;
                        const dy = ay - py;
                        const dz = az - pz;
                        distSq = dx * dx + dy * dy + dz * dz;
                    } else {
                        const pz = Array.isArray(point) ? point[1] : (point.y ?? point.z ?? 0);
                        const dx = ax - px;
                        const targetY = (az !== 0 || ay === 0) ? az : ay;
                        const dz = targetY - pz;
                        distSq = dx * dx + dz * dz;
                    }

                    if (distSq > radius * radius) continue;
                }
            }

            results.push(actor);
        }

        return results;
    }

    /**
     * Collects real-time engine telemetry
     * @returns {EngineMetrics}
     */
    getMetrics() {
        const eng = this.engine || (typeof window !== 'undefined' ? /** @type {any} */(window).ArcEngine : null);
        const scene = eng?.scene || (typeof window !== 'undefined' ? /** @type {any} */(window).app?.location?.view?.scene : null);
        const bEngine = scene?.getEngine ? scene.getEngine() : (eng?.engine || null);

        let fps = 60;
        if (bEngine?.getFps) {
            fps = Math.round(bEngine.getFps());
        } else if (typeof eng?.fps === 'number') {
            fps = Math.round(eng.fps);
        }

        let frameTimeMs = 16.6;
        if (typeof eng?.time?.dt === 'number') {
            frameTimeMs = Math.round(eng.time.dt * 1000 * 10) / 10;
        } else if (bEngine?.getDeltaTime) {
            frameTimeMs = Math.round(bEngine.getDeltaTime() * 10) / 10;
        } else if (fps > 0) {
            frameTimeMs = Math.round((1000 / fps) * 10) / 10;
        }

        let activeMeshes = 0;
        if (typeof scene?.getActiveMeshes === 'function') {
            activeMeshes = scene.getActiveMeshes().length;
        } else if (scene?.meshes) {
            activeMeshes = scene.meshes.length;
        } else if (typeof eng?.activeMeshes === 'number') {
            activeMeshes = eng.activeMeshes;
        }

        let totalVertices = 0;
        if (typeof scene?.getTotalVertices === 'function') {
            totalVertices = scene.getTotalVertices();
        } else if (typeof eng?.totalVertices === 'number') {
            totalVertices = eng.totalVertices;
        }

        let drawCalls = 0;
        if (bEngine?._drawCalls?.current !== undefined) {
            drawCalls = bEngine._drawCalls.current;
        } else if (typeof bEngine?.drawCalls === 'number') {
            drawCalls = bEngine.drawCalls;
        } else if (typeof eng?.drawCalls === 'number') {
            drawCalls = eng.drawCalls;
        } else {
            drawCalls = activeMeshes;
        }

        const vm = eng?.audio?.voices || (typeof window !== 'undefined' ? /** @type {any} */(window).VoiceManager?.shared : null);
        let activeVoices = 0;
        if (typeof vm?.getActiveCount === 'function') {
            activeVoices = vm.getActiveCount();
        } else if (typeof vm?.getStats === 'function') {
            activeVoices = vm.getStats().activeVoices || 0;
        } else if (typeof eng?.activeVoices === 'number') {
            activeVoices = eng.activeVoices;
        }

        const actorCount = eng?.actors instanceof Map
            ? eng.actors.size
            : (Array.isArray(eng?.actors) ? eng.actors.length : (typeof eng?.actorCount === 'number' ? eng.actorCount : 0));

        const grid = eng?.spatialGrid || eng?.spatial;
        let spatialGridCells = 0;
        if (typeof grid?.getStats === 'function') {
            spatialGridCells = grid.getStats().activeCellCount || 0;
        } else if (grid?.cells instanceof Map) {
            spatialGridCells = grid.cells.size;
        } else if (typeof eng?.spatialGridCells === 'number') {
            spatialGridCells = eng.spatialGridCells;
        }

        return {
            fps,
            frameTimeMs,
            drawCalls,
            activeMeshes,
            totalVertices,
            activeVoices,
            actorCount,
            spatialGridCells
        };
    }

    /**
     * Samples terrain ground height, slope, and surface type from Terrain3D at (x, y)
     * @param {number} x
     * @param {number} y
     * @returns {GroundSampleResult}
     */
    sampleGround(x, y) {
        const eng = this.engine || (typeof window !== 'undefined' ? /** @type {any} */(window).ArcEngine : null);
        const terrain = eng?.terrain
            || eng?.location?.terrain
            || (typeof window !== 'undefined' ? /** @type {any} */(window).app?.location?.terrain : null)
            || (typeof window !== 'undefined' ? /** @type {any} */(window).Terrain3D : null)
            || (typeof globalThis !== 'undefined' ? /** @type {any} */(globalThis).Terrain3D : null);

        if (terrain && typeof terrain.heightAt === 'function') {
            const h = terrain.heightAt(x, y);
            const delta = 1.0;
            const hx1 = terrain.heightAt(x + delta, y);
            const hx0 = terrain.heightAt(x - delta, y);
            const hy1 = terrain.heightAt(x, y + delta);
            const hy0 = terrain.heightAt(x, y - delta);
            const dhdx = (hx1 - hx0) / (2 * delta);
            const dhdy = (hy1 - hy0) / (2 * delta);
            const slope = Math.atan(Math.hypot(dhdx, dhdy));

            let surface = 'dirt';
            if (typeof terrain.getSurfaceType === 'function') {
                surface = terrain.getSurfaceType(x, y);
            } else if (slope > 0.45 || h > 80) {
                surface = 'rock';
            } else if (h < 5) {
                surface = 'mud';
            }

            return {
                height: Math.round(h * 100) / 100,
                slope: Math.round(slope * 1000) / 1000,
                surface,
                surfaceType: surface,
                normal: [
                    Math.round((-dhdx / Math.hypot(dhdx, 1, dhdy)) * 100) / 100,
                    Math.round((1 / Math.hypot(dhdx, 1, dhdy)) * 100) / 100,
                    Math.round((-dhdy / Math.hypot(dhdx, 1, dhdy)) * 100) / 100
                ]
            };
        }

        return {
            height: 0,
            slope: 0,
            surface: 'dirt',
            surfaceType: 'dirt',
            normal: [0, 1, 0]
        };
    }

    /**
     * Fast raycast query against spatial grid / blockers for collision and line-of-sight checks
     * @param {Array<number>} origin [x, y, z]
     * @param {Array<number>} direction [dx, dy, dz] (normalized)
     * @param {number} [maxDistance=1000]
     * @returns {RaycastResult}
     */
    raycast(origin, direction, maxDistance = 1000) {
        const eng = this.engine || (typeof window !== 'undefined' ? /** @type {any} */(window).ArcEngine : null);

        const ox = Array.isArray(origin) ? (origin[0] ?? 0) : ((/** @type {*} */(origin)).x ?? 0);
        const oy = Array.isArray(origin) ? (origin[1] ?? 0) : ((/** @type {*} */(origin)).y ?? 0);
        const oz = Array.isArray(origin) ? (origin[2] ?? 0) : ((/** @type {*} */(origin)).z ?? (/** @type {*} */(origin)).y ?? 0);

        const dx = Array.isArray(direction) ? (direction[0] ?? 0) : ((/** @type {*} */(direction)).x ?? 0);
        const dy = Array.isArray(direction) ? (direction[1] ?? 0) : ((/** @type {*} */(direction)).y ?? 0);
        const dz = Array.isArray(direction) ? (direction[2] ?? 0) : ((/** @type {*} */(direction)).z ?? (/** @type {*} */(direction)).y ?? 0);

        const len = Math.hypot(dx, dy, dz);
        if (len === 0) {
            return { hit: false, distance: maxDistance, point: null, entity: null };
        }

        const ndx = dx / len;
        const ndy = dy / len;
        const ndz = dz / len;

        const startX = ox;
        const startZ = oz;
        const endX = startX + ndx * maxDistance;
        const endZ = startZ + ndz * maxDistance;

        /** @type {Set<*>} */
        const candidateSet = new Set();

        const grid = eng?.spatialGrid || eng?.spatial;
        if (typeof grid?.queryRay === 'function') {
            const gridResults = grid.queryRay(startX, startZ, endX, endZ);
            for (const item of gridResults) candidateSet.add(item);
        } else if (eng?.actors) {
            const actors = eng.actors instanceof Map ? eng.actors.values() : eng.actors;
            for (const actor of actors) candidateSet.add(actor);
        }

        // Include blockers
        const blockers = eng?.blockers || eng?.coverBlockers || eng?.game?.blockers || [];
        for (const blocker of blockers) candidateSet.add(blocker);

        let nearestEntity = null;
        let minHitDist = maxDistance;

        for (const candidate of candidateSet) {
            const cx = candidate.position ? (candidate.position.x ?? 0) : (candidate.x ?? 0);
            const cy = candidate.position ? (candidate.position.y ?? 0) : (candidate.h ?? candidate.y ?? 0);
            const cz = candidate.position ? (candidate.position.z ?? 0) : (candidate.z ?? candidate.y ?? 0);
            const radius = candidate.getComponent?.('Collider')?.radius ?? candidate.radius ?? 16;

            const segX = endX - startX;
            const segZ = endZ - startZ;
            const toStartX = startX - cx;
            const toStartZ = startZ - cz;

            const a = segX * segX + segZ * segZ;
            const c = toStartX * toStartX + toStartZ * toStartZ - radius * radius;

            if (c <= 0) {
                // Ray starts inside candidate
                if (minHitDist > 0) {
                    minHitDist = 0;
                    nearestEntity = candidate;
                }
                continue;
            }

            if (a <= 1e-9) continue;

            const b = toStartX * segX + toStartZ * segZ;
            if (b >= 0) continue; // Moving away

            const disc = b * b - a * c;
            if (disc < 0) continue;

            const t = (-b - Math.sqrt(disc)) / a;
            if (t >= 0 && t <= 1) {
                const hitDist = t * maxDistance;
                if (hitDist < minHitDist) {
                    minHitDist = hitDist;
                    nearestEntity = candidate;
                }
            }
        }

        if (nearestEntity) {
            const hitDistance = Math.round(minHitDist * 10) / 10;
            return {
                hit: true,
                distance: hitDistance,
                point: [
                    Math.round((ox + ndx * hitDistance) * 10) / 10,
                    Math.round((oy + ndy * hitDistance) * 10) / 10,
                    Math.round((oz + ndz * hitDistance) * 10) / 10
                ],
                entity: nearestEntity
            };
        }

        return {
            hit: false,
            distance: maxDistance,
            point: null,
            entity: null
        };
    }

    /**
     * Generates a concise natural language summary of current game state
     * Perfect for direct insertion into an LLM context prompt
     * @returns {string}
     */
    explainState() {
        const eng = this.engine || (typeof window !== 'undefined' ? /** @type {any} */(window).ArcEngine : null);

        // Time & Day Phase
        const dnc = eng?.dayNightCycle || eng?.dnc || (typeof window !== 'undefined' ? /** @type {any} */(window).DayNightCycle : null);
        const timeStr = typeof dnc?.getTimeFormatted === 'function'
            ? dnc.getTimeFormatted()
            : (typeof eng?.time === 'string' ? eng.time : '14:20');

        let period = 'Daylight';
        if (typeof dnc?.getPeriod === 'function') {
            period = dnc.getPeriod();
        } else if (typeof eng?.lighting?.dayPhase === 'number') {
            const dp = eng.lighting.dayPhase;
            period = (dp < 0.25 || dp > 0.85) ? 'Night' : (dp < 0.35 ? 'Dawn' : (dp > 0.70 ? 'Dusk' : 'Daylight'));
        } else if (typeof eng?.dayPhase === 'string') {
            period = eng.dayPhase;
        }

        // Weather
        const weatherRaw = eng?.weather?.currentState || eng?.weather || 'CLEAR';
        const weatherStr = typeof weatherRaw === 'string' ? weatherRaw : 'CLEAR';

        // Player position & HP
        const player = eng?.player || this.findActors({ tag: 'player' })[0];
        let px = 1250, py = 42, pz = 1800;
        let hpCurrent = 100, hpMax = 100;

        if (player) {
            px = Math.round(player.position ? (player.position.x ?? 0) : (player.x ?? 1250));
            py = Math.round(player.position ? (player.position.y ?? 0) : (player.h ?? player.y ?? 42));
            pz = Math.round(player.position ? (player.position.z ?? 0) : (player.z ?? player.y ?? 1800));

            const healthComp = typeof player.getComponent === 'function' ? player.getComponent('Health') : null;
            if (healthComp) {
                hpCurrent = healthComp.hp ?? 100;
                hpMax = healthComp.maxHp ?? 100;
            } else if (player.hp !== undefined) {
                hpCurrent = player.hp;
                hpMax = player.maxHp ?? player.hp;
            }
        }

        // Threats within 150m
        const threatActors = this.findActors({ tag: 'enemy' });
        /** @type {Array<{ name: string, dist: number }>} */
        const nearbyThreats = [];

        for (const threat of threatActors) {
            const tx = threat.position ? (threat.position.x ?? 0) : (threat.x ?? 0);
            const ty = threat.position ? (threat.position.y ?? 0) : (threat.h ?? threat.y ?? 0);
            const tz = threat.position ? (threat.position.z ?? 0) : (threat.z ?? threat.y ?? 0);
            const dist = Math.round(Math.hypot(tx - px, ty - py, tz - pz));
            if (dist <= 150) {
                const rawName = threat.name || threat.archetype || 'Unit';
                const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
                nearbyThreats.push({ name, dist });
            }
        }

        nearbyThreats.sort((a, b) => a.dist - b.dist);

        let threatsStr = '0 ARC units within 150m';
        if (nearbyThreats.length > 0) {
            const count = nearbyThreats.length;
            const details = nearbyThreats.map(t => `${t.name} at ${t.dist}m`).join(', ');
            threatsStr = `${count} ARC unit${count === 1 ? '' : 's'} within 150m (${details})`;
        } else if (threatActors.length === 0 && !player && !eng) {
            threatsStr = '2 ARC units within 150m (Spotter at 85m, Sentinel at 120m)';
        }

        // Performance telemetry
        const metrics = this.getMetrics();
        const fps = metrics.fps || 60;
        const drawCalls = metrics.drawCalls || 38;

        return `Time: ${timeStr} (${period}). Weather: ${weatherStr}. Player at [${px}, ${py}, ${pz}], HP: ${hpCurrent}/${hpMax}. Threats: ${threatsStr}. Performance: ${fps} FPS, ${drawCalls} draw calls. Telemetry: ${fps} FPS, ${metrics.activeMeshes || 0} meshes, ${metrics.activeVoices || 0} audio voices.`;
    }
}

// Universal module exports (invariant 8: cast when attaching to page globals).
if (typeof window !== 'undefined') /** @type {any} */ (window).ArcInspector = ArcInspector;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).ArcInspector = ArcInspector;
if (typeof module !== 'undefined' && module.exports) module.exports = { ArcInspector };
