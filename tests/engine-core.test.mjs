// ============================================================================
//  ArcEngine — Core Engine Subsystems Unit Tests
//  Tests: ArcSpatialGrid, VoiceManager, ArcActor & ECS, ArcInspector, ArcEngine
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { ArcSpatialGrid } = require('../js/engine/ArcSpatialGrid.js');
const { VoiceManager, VoicePriority } = require('../js/audio/VoiceManager.js');
const {
    ArcComponent,
    HealthComponent,
    ColliderComponent,
    MeshComponent,
    SoundEmitterComponent,
    ArcActor
} = require('../js/engine/ArcActor.js');
const { ArcInspector } = require('../js/engine/ArcInspector.js');
const { ArcEngine, ArcEngineCore } = require('../js/engine/ArcEngine.js');

// ============================================================================
//  1. ArcSpatialGrid Unit Tests
// ============================================================================

test('ArcSpatialGrid: insertion, bounds indexing, and removal', () => {
    const grid = new ArcSpatialGrid(64);
    assert.equal(grid.cellSize, 64);

    const entityA = { id: 'entityA' };
    const entityB = { id: 'entityB' };

    // Insert entityA at (100, 100) with radius 10
    grid.insert(entityA, 100, 100, 10);
    let stats = grid.getStats();
    assert.equal(stats.entityCount, 1);
    assert.ok(stats.activeCellCount >= 1, 'Should occupy at least 1 cell');

    // Insert entityB with large radius spanning multiple cells (e.g. radius 70 across 64px cells)
    grid.insert(entityB, 128, 128, 70);
    stats = grid.getStats();
    assert.equal(stats.entityCount, 2);
    assert.ok(stats.activeCellCount > 4, 'Large radius entity should span multiple grid cells');

    // Update entityA position to a new location
    grid.update(entityA, 500, 500, 10);
    const nearOld = grid.queryRadius(100, 100, 20);
    assert.equal(nearOld.includes(entityA), false, 'EntityA should no longer be at old position');
    const nearNew = grid.queryRadius(500, 500, 20);
    assert.equal(nearNew.includes(entityA), true, 'EntityA should be found at new position');

    // Removal of entity
    const removedA = grid.remove(entityA);
    assert.equal(removedA, true, 'Removal should return true for existing entity');
    assert.equal(grid.getStats().entityCount, 1);
    assert.equal(grid.queryRadius(500, 500, 50).length, 0, 'Removed entity should not appear in queries');

    // Removing non-existent entity
    assert.equal(grid.remove({ id: 'nonExistent' }), false);

    // Clear grid
    grid.clear();
    stats = grid.getStats();
    assert.equal(stats.entityCount, 0);
    assert.equal(stats.activeCellCount, 0);
});

test('ArcSpatialGrid: exact radius queries and filter function', () => {
    const grid = new ArcSpatialGrid(64);

    const center = { id: 'center', type: 'core' };
    const inside = { id: 'inside', type: 'ally' };
    const onBoundary = { id: 'boundary', type: 'enemy' };
    const outside = { id: 'outside', type: 'enemy' };
    const far = { id: 'far', type: 'enemy' };

    grid.insert(center, 100, 100, 0);
    grid.insert(inside, 130, 100, 0);       // distance = 30
    grid.insert(onBoundary, 150, 100, 0);   // distance = 50
    grid.insert(outside, 151, 100, 0);      // distance = 51
    grid.insert(far, 400, 400, 0);          // distance = ~424

    // Query radius = 50 from (100, 100)
    const results = grid.queryRadius(100, 100, 50);
    assert.equal(results.length, 3, 'Should find center, inside, and onBoundary');
    assert.ok(results.includes(center));
    assert.ok(results.includes(inside));
    assert.ok(results.includes(onBoundary));
    assert.ok(!results.includes(outside), 'Entity outside radius must not be returned');
    assert.ok(!results.includes(far), 'Far entity must not be returned');

    // Radius query taking entity's own radius into account
    const touching = { id: 'touching', type: 'ally' };
    // Center at (100, 100), querying with radius 40.
    // touching is at (150, 100) with radius 15. Distance is 50. effectiveRadius = 40 + 15 = 55.
    grid.insert(touching, 150, 100, 15);
    const resultsTouching = grid.queryRadius(100, 100, 40);
    assert.ok(resultsTouching.includes(touching), 'Entities whose radius overlaps query radius must be matched');

    // Filter function verification
    const alliesOnly = grid.queryRadius(100, 100, 60, (e) => e.type === 'ally');
    assert.ok(alliesOnly.every(e => e.type === 'ally'), 'Filter function should filter out non-matching types');
    assert.ok(alliesOnly.includes(inside));
    assert.ok(alliesOnly.includes(touching));
    assert.ok(!alliesOnly.includes(onBoundary));
});

test('ArcSpatialGrid: ray queries along grid lines and diagonals', () => {
    const grid = new ArcSpatialGrid(64);

    const onRayH1 = { id: 'H1' };
    const onRayH2 = { id: 'H2' };
    const offRayH = { id: 'offH' };

    grid.insert(onRayH1, 32, 50, 0);    // In cell (0, 0)
    grid.insert(onRayH2, 160, 50, 0);   // In cell (2, 0)
    grid.insert(offRayH, 160, 200, 0);  // In cell (2, 3)

    // Horizontal ray from (0, 50) to (200, 50)
    const rayHResults = grid.queryRay(0, 50, 200, 50);
    assert.ok(rayHResults.includes(onRayH1), 'Horizontal ray must hit cell containing H1');
    assert.ok(rayHResults.includes(onRayH2), 'Horizontal ray must hit cell containing H2');
    assert.ok(!rayHResults.includes(offRayH), 'Horizontal ray must NOT hit off-axis entity');

    // Diagonal ray from (0, 0) to (256, 256)
    const onDiag1 = { id: 'D1' };
    const onDiag2 = { id: 'D2' };
    const offDiag = { id: 'offD' };

    grid.insert(onDiag1, 32, 32, 0);     // Cell (0, 0)
    grid.insert(onDiag2, 160, 160, 0);   // Cell (2, 2)
    grid.insert(offDiag, 32, 160, 0);    // Cell (0, 2)

    const rayDiagResults = grid.queryRay(0, 0, 256, 256);
    assert.ok(rayDiagResults.includes(onDiag1), 'Diagonal ray must hit cell containing D1');
    assert.ok(rayDiagResults.includes(onDiag2), 'Diagonal ray must hit cell containing D2');
    assert.ok(!rayDiagResults.includes(offDiag), 'Diagonal ray must NOT hit cell (0, 2)');

    // Vertical ray from (100, 0) to (100, 300)
    const onVert = { id: 'V1' };
    grid.insert(onVert, 100, 150, 0);
    const rayVertResults = grid.queryRay(100, 0, 100, 300);
    assert.ok(rayVertResults.includes(onVert), 'Vertical ray must hit cell containing V1');
});

test('ArcSpatialGrid: findNearest accuracy', () => {
    const grid = new ArcSpatialGrid(64);

    const closeTarget = { id: 'close', team: 'enemy' };
    const midTarget = { id: 'mid', team: 'ally' };
    const farTarget = { id: 'far', team: 'enemy' };

    grid.insert(midTarget, 100, 150, 0);      // distance = 50
    grid.insert(closeTarget, 115, 100, 0);    // distance = 15
    grid.insert(farTarget, 100, 250, 0);      // distance = 150

    // Nearest from (100, 100) within maxRadius 200
    const nearest = grid.findNearest(100, 100, 200);
    assert.equal(nearest, closeTarget, 'Must accurately select closest entity');

    // Nearest with filter (only ally team)
    const nearestAlly = grid.findNearest(100, 100, 200, (e) => e.team === 'ally');
    assert.equal(nearestAlly, midTarget, 'Must respect filterFn and select nearest matching entity');

    // If maxRadius is smaller than distance to any entity
    const nearestTooFar = grid.findNearest(100, 100, 10);
    assert.equal(nearestTooFar, null, 'Must return null if no entities within maxRadius');

    // Removing closest returns the next closest
    grid.remove(closeTarget);
    const nextNearest = grid.findNearest(100, 100, 200);
    assert.equal(nextNearest, midTarget, 'Must find next closest after removal');
});

test('ArcSpatialGrid: high-density stress test (1000 entities over 4096x4096 map)', () => {
    const grid = new ArcSpatialGrid(128);
    const mapSize = 4096;
    const count = 1000;
    const entities = [];

    // Deterministic pseudo-random number generator (LCG)
    let seed = 42;
    function pseudoRandom() {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    }

    // Populate 1000 entities across 4096 x 4096 with varying radii
    for (let i = 0; i < count; i++) {
        const x = pseudoRandom() * mapSize;
        const y = pseudoRandom() * mapSize;
        const radius = 5 + pseudoRandom() * 20; // 5..25
        const entity = { id: `stress_${i}`, x, y, radius };
        entities.push(entity);
        grid.insert(entity, x, y, radius);
    }

    assert.equal(grid.getStats().entityCount, 1000);

    // Query from center (2048, 2048) with radius 350
    const qx = 2048;
    const qy = 2048;
    const queryR = 350;

    // Brute-force reference ground truth
    const groundTruth = [];
    for (const ent of entities) {
        const dx = ent.x - qx;
        const dy = ent.y - qy;
        const distSq = dx * dx + dy * dy;
        const effR = queryR + ent.radius;
        if (distSq <= effR * effR) {
            groundTruth.push(ent);
        }
    }

    // Benchmark spatial grid execution
    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const queryResults = grid.queryRadius(qx, qy, queryR);
    const endTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    assert.ok(endTime - startTime < 50, 'Spatial grid query should complete well under 50ms');

    // Verify exact match: length and contents
    assert.equal(
        queryResults.length,
        groundTruth.length,
        `Result count (${queryResults.length}) must match brute force count (${groundTruth.length})`
    );

    const resultMap = new Set(queryResults.map(e => e.id));
    for (const expected of groundTruth) {
        assert.ok(resultMap.has(expected.id), `Entity ${expected.id} missing from spatial query results`);
    }

    // Test box query bounds vs brute-force
    const boxMinX = 1800;
    const boxMinY = 1800;
    const boxMaxX = 2200;
    const boxMaxY = 2200;
    const boxResults = grid.queryBox(boxMinX, boxMinY, boxMaxX, boxMaxY);
    for (const ent of boxResults) {
        assert.ok(
            ent.x + ent.radius >= boxMinX &&
            ent.x - ent.radius <= boxMaxX &&
            ent.y + ent.radius >= boxMinY &&
            ent.y - ent.radius <= boxMaxY,
            `Box query entity ${ent.id} must intersect query box`
        );
    }
});

// ============================================================================
//  2. VoiceManager Unit Tests
// ============================================================================

test('VoiceManager: priority-based allocation up to maxVoices', () => {
    const vm = new VoiceManager(3);
    assert.equal(vm.maxVoices, 3);
    assert.equal(vm.getActiveCount(), 0);

    const token1 = vm.allocateVoice('footstep', VoicePriority.LOW);
    const token2 = vm.allocateVoice('ambient', VoicePriority.NORMAL);
    const token3 = vm.allocateVoice('gunshot', VoicePriority.HIGH);

    assert.ok(token1 && token1.token, 'Token 1 allocated');
    assert.ok(token2 && token2.token, 'Token 2 allocated');
    assert.ok(token3 && token3.token, 'Token 3 allocated');

    assert.equal(vm.getActiveCount(), 3);
    const stats = vm.getStats();
    assert.equal(stats.activeVoices, 3);
    assert.equal(stats.maxVoices, 3);
    assert.equal(stats.stolenCount, 0);
    assert.equal(stats.droppedCount, 0);
});

test('VoiceManager: steals lowest-priority voice when at capacity', () => {
    const vm = new VoiceManager(3);

    let stolenLow = false;
    let fadeOutReported = 0;

    const tokenLow = vm.allocateVoice('ambient_crickets', VoicePriority.LOW, (event) => {
        stolenLow = true;
        fadeOutReported = event.fadeOutTime;
    });
    const tokenNorm = vm.allocateVoice('footstep', VoicePriority.NORMAL);
    const tokenHigh = vm.allocateVoice('enemy_shot', VoicePriority.HIGH);

    assert.equal(vm.getActiveCount(), 3);

    // Now at capacity: allocate CRITICAL voice (e.g. player weapon fire)
    const tokenCrit = vm.allocateVoice('player_shot', VoicePriority.CRITICAL);

    assert.ok(tokenCrit, 'Critical voice must be allocated');
    assert.equal(stolenLow, true, 'Lowest priority voice (ambient_crickets) must be stolen');
    assert.equal(fadeOutReported, 0.015, 'Voice stealing should trigger 15ms soft fade out ramp');

    const stats = vm.getStats();
    assert.equal(stats.activeVoices, 3, 'Active voice count should remain capped at maxVoices');
    assert.equal(stats.stolenCount, 1, 'Stolen count should increment');

    // Verify tokenLow is no longer tracked
    assert.equal(vm.releaseVoice(tokenLow), false, 'Stolen voice should no longer be active in VoiceManager');
});

test('VoiceManager: rejects voice when requested priority is lower than all active voices', () => {
    const vm = new VoiceManager(2);

    vm.allocateVoice('gunshot_1', VoicePriority.HIGH);
    vm.allocateVoice('gunshot_2', VoicePriority.CRITICAL);

    assert.equal(vm.getActiveCount(), 2);

    // Try to allocate LOW priority voice when all active voices are HIGH/CRITICAL
    const rejectedLow = vm.allocateVoice('distant_wind', VoicePriority.LOW);
    assert.equal(rejectedLow, null, 'Voice with priority lower than all active voices must be rejected');

    const stats = vm.getStats();
    assert.equal(stats.droppedCount, 1, 'Dropped count must increment');
    assert.equal(stats.activeVoices, 2);
    assert.equal(stats.stolenCount, 0);
});

test('VoiceManager: releasing voices, clearing, and stat tracking', () => {
    const vm = new VoiceManager(4);

    const t1 = vm.allocateVoice('sound_1', VoicePriority.NORMAL);
    const t2 = vm.allocateVoice('sound_2', VoicePriority.NORMAL);
    const t3 = vm.allocateVoice('sound_3', VoicePriority.NORMAL);

    assert.equal(vm.getActiveCount(), 3);

    // Release via token object
    const released1 = vm.releaseVoice(t1);
    assert.equal(released1, true, 'Releasing valid token returns true');
    assert.equal(vm.getActiveCount(), 2);

    // Release via token string
    const released2 = vm.releaseVoice(t2.token);
    assert.equal(released2, true, 'Releasing via token string returns true');
    assert.equal(vm.getActiveCount(), 1);

    // Double release returns false
    assert.equal(vm.releaseVoice(t1), false);
    assert.equal(vm.releaseVoice(null), false);

    // Clear all
    const t4 = vm.allocateVoice('sound_4', VoicePriority.NORMAL);
    assert.equal(vm.getActiveCount(), 2);
    assert.equal(vm.hasVoice(t4), true);

    vm.clear();
    assert.equal(vm.getActiveCount(), 0, 'Clear must free all active voice slots');
    assert.equal(vm.hasVoice(t4), false);
    assert.equal(vm.hasVoice(t3), false);

    const stats = vm.getStats();
    assert.equal(stats.activeVoices, 0);
    assert.equal(stats.maxVoices, 4);
});

// ============================================================================
//  3. ArcActor & ECS Unit Tests
// ============================================================================

test('ArcActor: creation with standard components (Health, Collider, Mesh) and custom component', () => {
    const actor = new ArcActor({
        id: 'raider_01',
        name: 'Raider',
        position: [100, 20, 300],
        rotation: [0, 1.57, 0],
        scale: [1, 1, 1],
        tags: ['player', 'raider']
    });

    assert.equal(actor.id, 'raider_01');
    assert.equal(actor.name, 'Raider');
    assert.equal(actor.position.x, 100);
    assert.equal(actor.position.y, 20);
    assert.equal(actor.position.z, 300);

    // 1. HealthComponent
    let died = false;
    const health = new HealthComponent({
        maxHp: 150,
        hp: 150,
        onDeath: () => { died = true; }
    });
    actor.addComponent(health);
    assert.equal(actor.hasComponent('Health'), true);
    assert.equal(actor.getComponent('Health'), health);

    const dmgDealt = health.takeDamage(50);
    assert.equal(dmgDealt, 50);
    assert.equal(health.hp, 100);
    assert.equal(health.isDead(), false);

    const healed = health.heal(30);
    assert.equal(healed, 30);
    assert.equal(health.hp, 130);

    // Lethal damage
    health.takeDamage(200);
    assert.equal(health.hp, 0);
    assert.equal(health.isDead(), true);
    assert.equal(died, true, 'onDeath callback must be triggered');

    // 2. ColliderComponent
    const collider = new ColliderComponent({ radius: 24, height: 48, layer: 'actors', isTrigger: false });
    actor.addComponent(collider);
    assert.equal(actor.hasComponent('Collider'), true);
    assert.equal(collider.radius, 24);
    assert.equal(collider.isTrigger, false);

    // 3. MeshComponent
    const meshComp = new MeshComponent({ shape: 'box', size: [16, 32, 16], color: 0xff0000 });
    actor.addComponent(meshComp);
    assert.equal(actor.hasComponent('Mesh'), true);
    assert.equal(meshComp.shape, 'box');

    // 4. Custom Component
    class ShieldComponent extends ArcComponent {
        constructor(maxShield = 100) {
            super('Shield');
            this.maxShield = maxShield;
            this.shield = maxShield;
        }
        absorb(dmg) {
            const absorbed = Math.min(this.shield, dmg);
            this.shield -= absorbed;
            return dmg - absorbed;
        }
        toJSON() {
            return { type: 'Shield', shield: this.shield, maxShield: this.maxShield };
        }
    }

    const shieldComp = new ShieldComponent(50);
    actor.addComponent(shieldComp);
    assert.equal(actor.hasComponent('Shield'), true);
    const unabsorbed = shieldComp.absorb(30);
    assert.equal(unabsorbed, 0);
    assert.equal(shieldComp.shield, 20);
});

test('ArcActor: component lifecycle hooks (onAttach, onUpdate, onDetach, onDestroy)', () => {
    class LifecycleSpyComponent extends ArcComponent {
        constructor() {
            super('LifecycleSpy');
            this.attachCount = 0;
            this.updateDts = [];
            this.detachCount = 0;
            this.destroyCount = 0;
            this.attachedActor = null;
        }
        onAttach(actor) {
            super.onAttach(actor);
            this.attachCount++;
            this.attachedActor = actor;
        }
        onUpdate(dt) {
            this.updateDts.push(dt);
        }
        onDetach() {
            super.onDetach();
            this.detachCount++;
        }
        onDestroy() {
            super.onDestroy();
            this.destroyCount++;
        }
    }

    const actor = new ArcActor({ id: 'drone_01', name: 'Drone' });
    const spy = new LifecycleSpyComponent();

    // Attach hook
    actor.addComponent(spy);
    assert.equal(spy.attachCount, 1);
    assert.equal(spy.attachedActor, actor);
    assert.equal(spy.actor, actor);

    // Update hook
    actor.update(0.016);
    actor.update(0.033);
    assert.equal(spy.updateDts.length, 2);
    assert.equal(spy.updateDts[0], 0.016);
    assert.equal(spy.updateDts[1], 0.033);

    // Disabled component skips update
    spy.enabled = false;
    actor.update(0.016);
    assert.equal(spy.updateDts.length, 2, 'Disabled component should not receive onUpdate');

    // Detach via removeComponent (calls onDetach and onDestroy)
    const removed = actor.removeComponent('LifecycleSpy');
    assert.equal(removed, true);
    assert.equal(spy.detachCount, 1);
    assert.equal(spy.destroyCount, 1);
    assert.equal(spy.actor, null);
    assert.equal(actor.hasComponent('LifecycleSpy'), false);

    // Actor destruction cleans up all attached components (calls onDestroy and onDetach)
    const spy2 = new LifecycleSpyComponent();
    actor.addComponent(spy2);
    actor.destroy();
    assert.equal(spy2.destroyCount, 1, 'Actor destruction must invoke onDestroy on components');
    assert.equal(spy2.detachCount, 1, 'Actor destruction must invoke onDetach on components');
    assert.equal(actor.active, false);
    assert.equal(actor.isDestroyed, true);
});

test('ArcActor: tag filtering and position/rotation mutators', () => {
    const actor = new ArcActor({ id: 'sentinel', tags: ['enemy'] });

    assert.equal(actor.hasTag('enemy'), true);
    assert.equal(actor.hasTag('arc'), false);

    // Add tags
    actor.addTag('arc').addTag('heavy');
    assert.equal(actor.hasTag('arc'), true);
    assert.equal(actor.hasTag('heavy'), true);

    const tags = actor.getTags();
    assert.equal(tags.length, 3);
    assert.ok(tags.includes('enemy'));
    assert.ok(tags.includes('arc'));
    assert.ok(tags.includes('heavy'));

    // Remove tag
    const removed = actor.removeTag('heavy');
    assert.equal(removed, true);
    assert.equal(actor.hasTag('heavy'), false);
    assert.equal(actor.removeTag('non_existent'), false);

    // Mutators
    actor.setPosition(10, 20, 30);
    assert.deepEqual(actor.position, { x: 10, y: 20, z: 30 });

    actor.setRotation(0, Math.PI, 0);
    assert.equal(actor.rotation.y, Math.PI);

    actor.setScale(2, 2, 2);
    assert.deepEqual(actor.scale, { x: 2, y: 2, z: 2 });
});

test('ArcActor: toJSON serialization and declarative factory ArcActor.create()', () => {
    const actor = ArcActor.create({
        id: 'spotter_alpha',
        name: 'Spotter Alpha',
        tags: ['arc', 'aerial', 'scout'],
        position: [250, 45, 1200],
        rotation: [0, 0.785, 0],
        components: [
            { type: 'Health', maxHp: 120, hp: 100 },
            { type: 'Collider', radius: 18, height: 20 },
            { type: 'Mesh', shape: 'sphere', size: [18, 18, 18], color: 0x00ff88 }
        ]
    });

    assert.equal(actor.id, 'spotter_alpha');
    assert.equal(actor.name, 'Spotter Alpha');
    assert.ok(actor.hasTag('aerial'));
    assert.ok(actor.hasComponent('Health'));
    assert.ok(actor.hasComponent('Collider'));
    assert.ok(actor.hasComponent('Mesh'));

    const json = actor.toJSON();
    assert.equal(json.id, 'spotter_alpha');
    assert.equal(json.name, 'Spotter Alpha');
    assert.deepEqual(json.tags, ['arc', 'aerial', 'scout']);
    assert.deepEqual(json.position, [250, 45, 1200]);
    assert.ok(json.components.Health);
    assert.equal(json.components.Health.hp, 100);
    assert.equal(json.components.Health.maxHp, 120);
    assert.ok(json.components.Collider);
    assert.equal(json.components.Collider.radius, 18);

    // Verify valid JSON roundtrip without circular reference errors
    const serialized = JSON.stringify(json);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.id, 'spotter_alpha');
});

// ============================================================================
//  4. ArcInspector (ArcEngine.ai) Unit Tests
// ============================================================================

test('ArcInspector: scene graph generation with filters and distance limits', () => {
    const inspector = new ArcInspector();

    // Create a mock engine structure
    const mockEngine = {
        player: { position: { x: 0, y: 0, z: 0 } },
        time: { elapsed: 125.4, dt: 0.016 },
        lighting: { dayPhase: 0.45 },
        weather: { currentState: 'CLEAR' },
        actors: new Map()
    };

    inspector.init(mockEngine);

    // Populate actors
    const playerActor = ArcActor.create({
        id: 'player_01',
        name: 'Raider One',
        tags: ['player'],
        position: [0, 0, 0],
        components: [{ type: 'Health', maxHp: 100, hp: 100 }]
    });

    const closeEnemy = ArcActor.create({
        id: 'cricket_01',
        name: 'Cricket Jumper',
        tags: ['enemy', 'arc', 'jumper'],
        position: [60, 0, 80], // Distance = 100
        components: [{ type: 'Health', maxHp: 80, hp: 80 }]
    });

    const midEnemy = ArcActor.create({
        id: 'spotter_01',
        name: 'Spotter Drone',
        tags: ['enemy', 'arc', 'flying'],
        position: [120, 20, 160], // Distance = ~201
        components: [{ type: 'Health', maxHp: 50, hp: 50 }]
    });

    const farEnemy = ArcActor.create({
        id: 'bastion_01',
        name: 'Bastion Tank',
        tags: ['enemy', 'arc', 'boss'],
        position: [1000, 0, 1000], // Distance = ~1414
        components: [{ type: 'Health', maxHp: 500, hp: 500 }]
    });

    mockEngine.actors.set(playerActor.id, playerActor);
    mockEngine.actors.set(closeEnemy.id, closeEnemy);
    mockEngine.actors.set(midEnemy.id, midEnemy);
    mockEngine.actors.set(farEnemy.id, farEnemy);

    // 1. Scene graph with distance limit = 250m
    const sceneGraph = inspector.getSceneGraph({ origin: [0, 0, 0], maxDistance: 250 });

    assert.ok(sceneGraph.world, 'World summary must be present');
    assert.equal(sceneGraph.world.weather, 'CLEAR');
    assert.equal(sceneGraph.world.time, '125s');

    // Should include player (0m), closeEnemy (100m), midEnemy (~201m); excludes farEnemy
    const actorIds = sceneGraph.actors.map(a => a.id);
    assert.ok(actorIds.includes('player_01'));
    assert.ok(actorIds.includes('cricket_01'));
    assert.ok(actorIds.includes('spotter_01'));
    assert.equal(actorIds.includes('bastion_01'), false, 'Far enemy beyond 250m must be omitted');

    // Actors should be sorted by distance ascending
    for (let i = 0; i < sceneGraph.actors.length - 1; i++) {
        assert.ok(
            sceneGraph.actors[i].distance <= sceneGraph.actors[i + 1].distance,
            'Actors must be ordered by distance ascending'
        );
    }

    // 2. Scene graph with tag filtering
    const flyingOnlyGraph = inspector.getSceneGraph({ tags: ['flying'] });
    assert.equal(flyingOnlyGraph.actors.length, 1);
    assert.equal(flyingOnlyGraph.actors[0].id, 'spotter_01');
});

test('ArcInspector: findActors by tags, components, and radius', () => {
    const inspector = new ArcInspector();
    const mockEngine = { actors: new Map() };
    inspector.init(mockEngine);

    const a1 = ArcActor.create({
        id: 'scout_1',
        name: 'Scout Vanguard',
        tags: ['arc', 'light'],
        position: [50, 0, 50],
        components: [{ type: 'Health', maxHp: 100 }]
    });

    const a2 = ArcActor.create({
        id: 'screamer_1',
        name: 'Screamer EW',
        tags: ['arc', 'heavy', 'support'],
        position: [200, 0, 200],
        components: [{ type: 'Collider', radius: 30 }]
    });

    const a3 = ArcActor.create({
        id: 'turret_1',
        name: 'Defense Turret',
        tags: ['facility', 'stationary'],
        position: [400, 0, 400],
        components: [{ type: 'Health', maxHp: 300 }]
    });

    mockEngine.actors.set(a1.id, a1);
    mockEngine.actors.set(a2.id, a2);
    mockEngine.actors.set(a3.id, a3);

    // By single tag
    const arcUnits = inspector.findActors({ tag: 'arc' });
    assert.equal(arcUnits.length, 2);
    assert.ok(arcUnits.includes(a1));
    assert.ok(arcUnits.includes(a2));

    // By tagsAll
    const heavySupport = inspector.findActors({ tagsAll: ['arc', 'heavy'] });
    assert.equal(heavySupport.length, 1);
    assert.equal(heavySupport[0], a2);

    // By tagsAny
    const lightOrStationary = inspector.findActors({ tagsAny: ['light', 'stationary'] });
    assert.equal(lightOrStationary.length, 2);
    assert.ok(lightOrStationary.includes(a1));
    assert.ok(lightOrStationary.includes(a3));

    // By component
    const hasHealth = inspector.findActors({ hasComponent: 'Health' });
    assert.equal(hasHealth.length, 2);
    assert.ok(hasHealth.includes(a1));
    assert.ok(hasHealth.includes(a3));

    // By radius from (0, 0)
    const withinRadius = inspector.findActors({ withinRadius: { point: [0, 0], radius: 100 } });
    assert.equal(withinRadius.length, 1);
    assert.equal(withinRadius[0], a1);

    // By name
    const namedTurret = inspector.findActors({ name: 'turret' });
    assert.equal(namedTurret.length, 1);
    assert.equal(namedTurret[0], a3);
});

test('ArcInspector: explainState natural language generation and telemetry', () => {
    const inspector = new ArcInspector();

    const mockEngine = {
        player: ArcActor.create({
            id: 'player',
            name: 'Raider',
            tags: ['player'],
            position: [1250, 42, 1800],
            components: [{ type: 'Health', maxHp: 100, hp: 85 }]
        }),
        actors: new Map(),
        time: { elapsed: 310, dt: 0.0166 },
        lighting: { dayPhase: 0.50 },
        weather: { currentState: 'DUST_STORM' },
        audio: { voices: { getActiveCount: () => 6 } },
        spatial: { getStats: () => ({ activeCellCount: 14 }) }
    };

    const enemyNearby = ArcActor.create({
        id: 'spotter',
        name: 'Spotter Drone',
        tags: ['enemy', 'arc'],
        position: [1300, 42, 1850] // ~70m away
    });

    mockEngine.actors.set('player', mockEngine.player);
    mockEngine.actors.set('spotter', enemyNearby);

    inspector.init(mockEngine);

    const explanation = inspector.explainState();
    assert.equal(typeof explanation, 'string');
    assert.ok(explanation.length > 50, 'Explanation should be descriptive');

    // Verify key domain concepts are included in prompt
    assert.ok(explanation.includes('DUST_STORM'), 'Should mention current weather');
    assert.ok(explanation.includes('1250'), 'Should mention player coordinate');
    assert.ok(explanation.includes('85/100'), 'Should mention player health');
    assert.ok(explanation.includes('Spotter Drone'), 'Should mention nearby hostile');
    assert.ok(explanation.includes('Performance:'), 'Should include performance telemetry');

    // Performance telemetry
    const metrics = inspector.getMetrics();
    assert.equal(typeof metrics.fps, 'number');
    assert.equal(metrics.activeVoices, 6);
    assert.equal(metrics.actorCount, 2);
    assert.equal(metrics.spatialGridCells, 14);
});

// ============================================================================
//  5. ArcEngine Facade Unit Tests
// ============================================================================

test('ArcEngine: initialization and subsystem orchestration', () => {
    const engine = new ArcEngineCore();
    assert.equal(engine.initialized, false);

    engine.init({
        gridCellSize: 64,
        maxAudioVoices: 16
    });

    assert.equal(engine.initialized, true);
    assert.ok(engine.spatial instanceof ArcSpatialGrid);
    assert.equal(engine.spatial.cellSize, 64);
    assert.ok(engine.audio.voices instanceof VoiceManager);
    assert.equal(engine.audio.voices.maxVoices, 16);
    assert.ok(engine.ai instanceof ArcInspector);
    assert.equal(engine.ai.engine, engine);
});

test('ArcEngine: event bus (on, once, off, emit)', () => {
    const engine = new ArcEngineCore();
    let onCallCount = 0;
    let onceCallCount = 0;
    let lastPayload = null;

    const onHandler = (data) => {
        onCallCount++;
        lastPayload = data;
    };
    const onceHandler = () => {
        onceCallCount++;
    };

    engine.events.on('combat_alert', onHandler);
    engine.events.once('raid_start', onceHandler);

    // First emission
    engine.events.emit('combat_alert', { threat: 'Spotter', distance: 45 });
    engine.events.emit('raid_start');

    assert.equal(onCallCount, 1);
    assert.equal(lastPayload.threat, 'Spotter');
    assert.equal(onceCallCount, 1);

    // Second emission: 'once' handler should not fire again
    engine.events.emit('combat_alert', { threat: 'Bastion', distance: 120 });
    engine.events.emit('raid_start');

    assert.equal(onCallCount, 2);
    assert.equal(lastPayload.threat, 'Bastion');
    assert.equal(onceCallCount, 1, 'once handler must fire exactly once');

    // Unsubscribe via off
    engine.events.off('combat_alert', onHandler);
    engine.events.emit('combat_alert', { threat: 'None' });
    assert.equal(onCallCount, 2, 'Unsubscribed handler must not be invoked');
});

test('ArcEngine: time scaling, pausing, and delta time calculation', () => {
    const engine = new ArcEngineCore();
    engine.init();

    assert.equal(engine.time.timeScale, 1.0);
    assert.equal(engine.time.paused, false);
    assert.equal(engine.time.elapsed, 0);

    // Step 1: normal speed
    engine.update(0.016);
    assert.equal(Math.round(engine.time.dt * 1000), 16);
    assert.equal(Math.round(engine.time.elapsed * 1000), 16);

    // Step 2: time scaling (0.5x slow-motion)
    engine.time.setTimeScale(0.5);
    assert.equal(engine.time.timeScale, 0.5);
    engine.update(0.020);
    assert.equal(Math.round(engine.time.dt * 1000), 10); // 0.020 * 0.5 = 0.010
    assert.equal(Math.round(engine.time.elapsed * 1000), 26); // 16 + 10 = 26

    // Step 3: pause simulation
    let pauseEventFired = false;
    let resumeEventFired = false;
    engine.events.on('pause', () => { pauseEventFired = true; });
    engine.events.on('resume', () => { resumeEventFired = true; });

    engine.time.pause();
    assert.equal(engine.time.paused, true);
    assert.equal(pauseEventFired, true);

    const prevElapsed = engine.time.elapsed;
    engine.update(0.020);
    assert.equal(engine.time.elapsed, prevElapsed, 'Elapsed time must not advance while paused');

    // Step 4: resume simulation
    engine.time.resume();
    assert.equal(engine.time.paused, false);
    assert.equal(resumeEventFired, true);

    engine.update(0.020);
    assert.ok(engine.time.elapsed > prevElapsed, 'Elapsed time should resume advancing');
});

test('ArcEngine: actor spawning through ArcEngine.spawn(), spatial registration, and destruction', () => {
    const engine = new ArcEngineCore();
    engine.init({ gridCellSize: 64 });

    let spawnEventActor = null;
    let destroyEventId = null;
    engine.events.on('actorSpawned', (a) => { spawnEventActor = a; });
    engine.events.on('actorDestroyed', (id) => { destroyEventId = id; });

    // 1. Spawn actor through engine facade
    const spawnedActor = engine.spawn({
        id: 'patrol_drone_01',
        name: 'Patrol Drone',
        tags: ['arc', 'drone', 'patrol'],
        position: [150, 20, 250],
        components: [
            { type: 'Health', maxHp: 100 },
            { type: 'Collider', radius: 16 }
        ]
    });

    assert.ok(spawnedActor instanceof ArcActor);
    assert.equal(engine.actors.size, 1);
    assert.equal(engine.actors.get('patrol_drone_01'), spawnedActor);
    assert.equal(spawnEventActor, spawnedActor, 'actorSpawned event must be emitted');

    // 2. Verify spatial index registration
    assert.equal(engine.spatial.getStats().entityCount, 1);
    const nearby = engine.spatial.queryRadius(150, 250, 30);
    assert.equal(nearby.length, 1);
    assert.equal(nearby[0], spawnedActor);

    // 3. Movement and spatial index update on engine.update()
    spawnedActor.setPosition(400, 20, 600);
    engine.update(0.016);

    const oldLocationQuery = engine.spatial.queryRadius(150, 250, 30);
    assert.equal(oldLocationQuery.length, 0, 'Actor should no longer be registered at old position');

    const newLocationQuery = engine.spatial.queryRadius(400, 600, 30);
    assert.equal(newLocationQuery.length, 1);
    assert.equal(newLocationQuery[0], spawnedActor);

    // 4. Destroy actor through engine facade
    const destroyed = engine.destroy('patrol_drone_01');
    assert.equal(destroyed, true);
    assert.equal(engine.actors.size, 0);
    assert.equal(engine.spatial.getStats().entityCount, 0);
    assert.equal(spawnedActor.isDestroyed, true);
    assert.equal(destroyEventId, 'patrol_drone_01', 'actorDestroyed event must be emitted');

    // Destroying non-existent actor
    assert.equal(engine.destroy('non_existent'), false);
});

test('ArcEngine: player tagging and declarative scene creation', () => {
    const engine = new ArcEngineCore();
    engine.init();

    engine.createScene({
        actors: [
            {
                id: 'player_raider',
                name: 'Main Player',
                tags: ['player'],
                position: [500, 10, 500],
                components: [{ type: 'Health', maxHp: 100 }]
            },
            {
                id: 'screamer_boss',
                name: 'Screamer Boss',
                tags: ['enemy', 'boss'],
                position: [800, 10, 800],
                components: [{ type: 'Health', maxHp: 400 }]
            }
        ]
    });

    assert.equal(engine.actors.size, 2);
    assert.ok(engine.player, 'Player actor must be cached when actor has player tag');
    assert.equal(engine.player.id, 'player_raider');

    // AI inspection from created scene
    const sceneGraph = engine.ai.getSceneGraph({ origin: [500, 10, 500], maxDistance: 500 });
    assert.equal(sceneGraph.actors.length, 2);
    assert.equal(sceneGraph.actors[0].id, 'player_raider'); // distance 0
});
