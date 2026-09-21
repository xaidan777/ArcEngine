// ============================================================================
//  ArcEngine — ArcActor & ArcComponent Unit Tests
//  Tests: ArcComponent, HealthComponent, ColliderComponent, MeshComponent,
//         SoundEmitterComponent, ArcActor, Declarative Factory, Browser globals
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, stub } from './browser-scripts.mjs';
import {
    ArcActor,
    ArcComponent,
    HealthComponent,
    ColliderComponent,
    MeshComponent,
    SoundEmitterComponent
} from '../js/engine/ArcActor.js';

// ============================================================================
//  1. ArcComponent Base Class & Custom Subclasses
// ============================================================================

test('ArcComponent: base lifecycle hooks and enabled state', () => {
    class MockComponent extends ArcComponent {
        constructor() {
            super('Mock');
            this.attachedActor = null;
            this.updatedDt = 0;
            this.detached = false;
            this.destroyed = false;
        }
        onAttach(actor) {
            super.onAttach(actor);
            this.attachedActor = actor;
        }
        onUpdate(dt) {
            this.updatedDt += dt;
        }
        onDetach() {
            super.onDetach();
            this.detached = true;
        }
        onDestroy() {
            super.onDestroy();
            this.destroyed = true;
        }
    }

    const actor = new ArcActor({ name: 'TestActor' });
    const comp = new MockComponent();

    assert.equal(comp.name, 'Mock');
    assert.equal(comp.actor, null);
    assert.equal(comp.enabled, true);

    // Attach
    actor.addComponent(comp);
    assert.equal(comp.actor, actor);
    assert.equal(comp.attachedActor, actor);

    // Update
    actor.update(0.016);
    assert.equal(comp.updatedDt, 0.016);

    // Disabled component skips update
    comp.enabled = false;
    actor.update(0.016);
    assert.equal(comp.updatedDt, 0.016);

    // Detach via removeComponent
    const removed = actor.removeComponent('Mock');
    assert.equal(removed, true);
    assert.equal(comp.detached, true);
    assert.equal(comp.actor, null);
    assert.equal(comp.destroyed, true); // removeComponent calls onDetach + onDestroy

    // toJSON
    const json = comp.toJSON();
    assert.equal(json.type, 'Mock');
    assert.equal(json.enabled, false);
});

// ============================================================================
//  2. HealthComponent
// ============================================================================

test('HealthComponent: hp, maxHp, takeDamage, heal, isDead, events', () => {
    let deathSource = null;
    let deathActor = null;
    let damageAmount = 0;
    let healAmount = 0;

    const health = new HealthComponent({
        maxHp: 200,
        hp: 150,
        onDeath: (src, act) => { deathSource = src; deathActor = act; },
        onDamage: (amt) => { damageAmount = amt; },
        onHeal: (amt) => { healAmount = amt; }
    });

    const actor = new ArcActor({ name: 'CombatActor' });
    actor.addComponent(health);

    let eventDamage = 0;
    let eventHeal = 0;
    let eventDied = false;

    actor.on('damage', (e) => { eventDamage = e.amount; });
    actor.on('heal', (e) => { eventHeal = e.amount; });
    actor.on('death', () => { eventDied = true; });

    assert.equal(health.hp, 150);
    assert.equal(health.maxHp, 200);
    assert.equal(health.isDead(), false);

    // Take damage
    const taken = health.takeDamage(50, 'bullet');
    assert.equal(taken, 50);
    assert.equal(health.hp, 100);
    assert.equal(damageAmount, 50);
    assert.equal(eventDamage, 50);
    assert.equal(health.isDead(), false);

    // Heal
    const healed = health.heal(40);
    assert.equal(healed, 40);
    assert.equal(health.hp, 140);
    assert.equal(healAmount, 40);
    assert.equal(eventHeal, 40);

    // Heal capped at maxHp
    const overHeal = health.heal(100);
    assert.equal(overHeal, 60);
    assert.equal(health.hp, 200);

    // Lethal damage
    const fatal = health.takeDamage(250, 'explosion');
    assert.equal(fatal, 200);
    assert.equal(health.hp, 0);
    assert.equal(health.isDead(), true);
    assert.equal(deathSource, 'explosion');
    assert.equal(deathActor, actor);
    assert.equal(eventDied, true);

    // Subsequent damage and heal on dead actor
    assert.equal(health.takeDamage(50), 0);
    assert.equal(health.heal(50), 0);

    // Invulnerability
    const invulnHealth = new HealthComponent({ maxHp: 100, invulnerable: true });
    assert.equal(invulnHealth.takeDamage(50), 0);
    assert.equal(invulnHealth.hp, 100);

    // Serialization
    const json = health.toJSON();
    assert.equal(json.type, 'Health');
    assert.equal(json.hp, 0);
    assert.equal(json.maxHp, 200);
    assert.equal(json.isDead, true);
});

// ============================================================================
//  3. ColliderComponent
// ============================================================================

test('ColliderComponent: dimensions, layers, triggers, and cylinder intersection', () => {
    const actorA = new ArcActor({ name: 'ActorA', position: [100, 0, 100] });
    const actorB = new ArcActor({ name: 'ActorB', position: [120, 0, 100] });
    const actorC = new ArcActor({ name: 'ActorC', position: [300, 0, 100] });

    const colA = new ColliderComponent({ radius: 15, height: 30, layer: 'enemy', isTrigger: false });
    const colB = new ColliderComponent({ radius: 15, height: 30, layer: 'player', isTrigger: true });
    const colC = new ColliderComponent({ radius: 10, height: 20, layer: 'prop' });

    actorA.addComponent(colA);
    actorB.addComponent(colB);
    actorC.addComponent(colC);

    assert.equal(colA.radius, 15);
    assert.equal(colA.height, 30);
    assert.equal(colA.layer, 'enemy');
    assert.equal(colA.isTrigger, false);
    assert.equal(colB.isTrigger, true);

    // Position check
    assert.deepEqual(colA.getWorldPosition(), { x: 100, y: 0, z: 100 });
    assert.deepEqual(colB.getWorldPosition(), { x: 120, y: 0, z: 100 });

    // ColA (radius 15 at 100) and ColB (radius 15 at 120) are 20 units apart <= 15+15=30 => intersect!
    assert.equal(colA.intersects(colB), true);
    assert.equal(colB.intersects(colA), true);

    // ColA and ColC are 200 units apart => no intersection
    assert.equal(colA.intersects(colC), false);

    // Vertical height clipping
    actorB.setPosition(120, 100, 100);
    assert.equal(colA.intersects(colB), false);

    // Offset test
    colA.offset = { x: 20, y: 0, z: 0 };
    assert.deepEqual(colA.getWorldPosition(), { x: 120, y: 0, z: 100 });

    // toJSON
    const json = colA.toJSON();
    assert.equal(json.type, 'Collider');
    assert.equal(json.radius, 15);
    assert.equal(json.layer, 'enemy');
    assert.equal(json.isTrigger, false);
});

// ============================================================================
//  4. MeshComponent
// ============================================================================

test('MeshComponent: shape creation, properties, material colors, and transform synchronization', () => {
    // Test with mock Babylon stub
    const mockScene = stub();
    const mockMesh = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scaling: { x: 1, y: 1, z: 1 },
        isVisible: true,
        visibility: 1.0,
        dispose: () => {},
        isDisposed: () => false
    };

    const meshComp = new MeshComponent({
        mesh: mockMesh,
        shape: 'box',
        size: [10, 20, 10],
        color: 0x00ffaa,
        alpha: 0.8
    });

    const actor = new ArcActor({
        name: 'MeshActor',
        position: [50, 10, 75],
        rotation: [0, 1.2, 0],
        scale: [2, 2, 2],
        scene: mockScene
    });

    actor.addComponent(meshComp);

    assert.equal(actor.mesh, mockMesh);
    assert.equal(meshComp.mesh, mockMesh);
    assert.equal(meshComp.shape, 'box');

    // Transforms synced upon attach
    assert.equal(mockMesh.position.x, 50);
    assert.equal(mockMesh.position.y, 10);
    assert.equal(mockMesh.position.z, 75);
    assert.equal(mockMesh.rotation.y, 1.2);
    assert.equal(mockMesh.scaling.x, 2);

    // Mutator sync
    actor.setPosition(100, 200, 300);
    assert.equal(mockMesh.position.x, 100);
    assert.equal(mockMesh.position.y, 200);
    assert.equal(mockMesh.position.z, 300);

    // Visibility controls
    meshComp.setVisibility(false);
    assert.equal(mockMesh.isVisible, false);
    assert.equal(mockMesh.visibility, 0);

    meshComp.setVisibility(true);
    assert.equal(mockMesh.isVisible, true);
    assert.equal(mockMesh.visibility, 0.8);

    meshComp.setAlpha(0.5);
    assert.equal(mockMesh.visibility, 0.5);

    // toJSON
    const json = meshComp.toJSON();
    assert.equal(json.type, 'Mesh');
    assert.equal(json.shape, 'box');
    assert.equal(json.hasMesh, true);
    assert.equal(json.visible, true);
    assert.equal(json.alpha, 0.5);
});

// ============================================================================
//  5. SoundEmitterComponent
// ============================================================================

test('SoundEmitterComponent: spatial sound helper integrating with ProceduralAudio', () => {
    let playedSound = null;
    let playedPos = null;

    // Install mock ProceduralAudio
    const mockProceduralAudio = {
        weapon: {
            play: (caliber, pos, isPlayer, tier) => {
                playedSound = { type: 'weapon', caliber, isPlayer, tier };
                playedPos = pos;
                return 'weapon_voice';
            }
        },
        combat: {
            playImpact: (surface, pos) => {
                playedSound = { type: 'impact', surface };
                playedPos = pos;
                return 'impact_voice';
            }
        },
        arc: {
            playCricketChitter: (pos) => {
                playedSound = { type: 'arc', sound: 'cricketChitter' };
                playedPos = pos;
                return 'arc_voice';
            }
        },
        foley: {
            playFootstep: (surface, options) => {
                playedSound = { type: 'foley', action: 'footstep', surface };
                playedPos = options ? options.position : null;
                return 'foley_voice';
            }
        }
    };

    globalThis.ProceduralAudio = mockProceduralAudio;

    const actor = new ArcActor({ name: 'AudioActor', position: [150, 25, 450] });
    const emitter = new SoundEmitterComponent({ refDistance: 120, maxDistance: 3000, volume: 0.9 });
    actor.addComponent(emitter);

    assert.equal(emitter.refDistance, 120);
    assert.equal(emitter.maxDistance, 3000);
    assert.equal(emitter.volume, 0.9);

    // Spatial position
    assert.deepEqual(emitter.getSpatialPosition(), { x: 150, y: 25, z: 450 });

    // 1. Play weapon
    const weaponVoice = emitter.playWeapon('heavy_kinetic', false, 3);
    assert.equal(weaponVoice, 'weapon_voice');
    assert.equal(playedSound.caliber, 'heavy_kinetic');
    assert.deepEqual(playedPos, { x: 150, y: 25, z: 450 });

    // 2. Play impact
    const impactVoice = emitter.playImpact('metal');
    assert.equal(impactVoice, 'impact_voice');
    assert.equal(playedSound.surface, 'metal');
    assert.deepEqual(playedPos, { x: 150, y: 25, z: 450 });

    // 3. Play ARC sound
    const arcVoice = emitter.playArcSound('cricketChitter');
    assert.equal(arcVoice, 'arc_voice');
    assert.equal(playedSound.sound, 'cricketChitter');
    assert.deepEqual(playedPos, { x: 150, y: 25, z: 450 });

    // 4. Play foley
    const foleyVoice = emitter.playFoley('footstep', 'concrete');
    assert.equal(foleyVoice, 'foley_voice');
    assert.equal(playedSound.surface, 'concrete');
    assert.deepEqual(playedPos, { x: 150, y: 25, z: 450 });

    // toJSON
    const json = emitter.toJSON();
    assert.equal(json.type, 'SoundEmitter');
    assert.equal(json.refDistance, 120);
    assert.equal(json.volume, 0.9);

    delete globalThis.ProceduralAudio;
});

// ============================================================================
//  6. ArcActor Core & Lifecycle
// ============================================================================

test('ArcActor: tags, components, queries, transformations, and events', () => {
    const actor = new ArcActor({
        id: 'drone_unit_01',
        name: 'Recon Drone',
        tags: ['arc', 'drone', 'flying'],
        position: { x: 10, y: 50, z: 30 },
        rotation: { x: 0, y: 1.5, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
    });

    // Tag management
    assert.equal(actor.hasTag('drone'), true);
    assert.equal(actor.hasTag('ground'), false);
    actor.addTag('scout');
    assert.equal(actor.hasTag('scout'), true);
    actor.removeTag('flying');
    assert.equal(actor.hasTag('flying'), false);
    assert.deepEqual(actor.getTags().sort(), ['arc', 'drone', 'scout'].sort());

    // Component registration & fuzzy querying
    const health = new HealthComponent(100);
    actor.addComponent(health);

    assert.equal(actor.hasComponent('Health'), true);
    assert.equal(actor.hasComponent('health'), true);
    assert.equal(actor.hasComponent('HealthComponent'), true);
    assert.equal(actor.hasComponent(HealthComponent), true);
    assert.equal(actor.getComponent('Health'), health);
    assert.equal(actor.getComponent('health'), health);
    assert.equal(actor.getComponent(HealthComponent), health);

    // Object overload setPosition
    actor.setPosition({ x: 200, y: 40, z: 600 });
    assert.deepEqual(actor.position, { x: 200, y: 40, z: 600 });

    // Array overload setPosition
    actor.setPosition([300, 50, 700]);
    assert.deepEqual(actor.position, { x: 300, y: 50, z: 700 });

    // Three args setPosition
    actor.setPosition(400, 60, 800);
    assert.deepEqual(actor.position, { x: 400, y: 60, z: 800 });

    // Overloads for setRotation and setScale
    actor.setRotation([0.1, 0.2, 0.3]);
    assert.deepEqual(actor.rotation, { x: 0.1, y: 0.2, z: 0.3 });

    actor.setScale(3); // Uniform
    assert.deepEqual(actor.scale, { x: 3, y: 3, z: 3 });

    // Event bus
    let destroyedFired = false;
    actor.on('destroy', () => { destroyedFired = true; });

    assert.equal(actor.active, true);
    assert.equal(actor.destroyed, false);

    // Destroy
    actor.destroy();
    assert.equal(destroyedFired, true);
    assert.equal(actor.active, false);
    assert.equal(actor.destroyed, true);
    assert.equal(actor.isDestroyed, true);
    assert.equal(actor.components.size, 0);
});

// ============================================================================
//  7. Declarative Factory ArcActor.create()
// ============================================================================

test('ArcActor.create: creates actor from declarative plain JS/JSON object', () => {
    const actor = ArcActor.create({
        name: 'Drone_01',
        tags: ['enemy', 'arc'],
        position: [100, 20, 300],
        components: [
            { type: 'Health', maxHp: 150 },
            { type: 'Collider', radius: 12 },
            { type: 'Mesh', shape: 'box', size: [10, 10, 10], color: 0xff0000 },
            { type: 'SoundEmitter', volume: 0.8 }
        ]
    });

    assert.equal(actor.name, 'Drone_01');
    assert.ok(actor.hasTag('enemy'));
    assert.ok(actor.hasTag('arc'));
    assert.deepEqual(actor.position, { x: 100, y: 20, z: 300 });

    // Components instantiated
    const health = actor.getComponent(HealthComponent);
    assert.ok(health);
    assert.equal(health.maxHp, 150);
    assert.equal(health.hp, 150);

    const collider = actor.getComponent(ColliderComponent);
    assert.ok(collider);
    assert.equal(collider.radius, 12);

    const mesh = actor.getComponent(MeshComponent);
    assert.ok(mesh);
    assert.equal(mesh.shape, 'box');
    assert.equal(mesh.color, 0xff0000);

    const sound = actor.getComponent(SoundEmitterComponent);
    assert.ok(sound);
    assert.equal(sound.volume, 0.8);

    // toJSON for AI introspection
    const json = actor.toJSON();
    assert.equal(json.name, 'Drone_01');
    assert.deepEqual(json.tags, ['enemy', 'arc']);
    assert.deepEqual(json.position, [100, 20, 300]);
    assert.ok(json.components.Health);
    assert.equal(json.components.Health.maxHp, 150);
    assert.ok(json.components.Collider);
    assert.equal(json.components.Collider.radius, 12);
    assert.ok(json.components.Mesh);
    assert.ok(json.components.SoundEmitter);

    // Serialization verification
    const str = JSON.stringify(json);
    const parsed = JSON.parse(str);
    assert.equal(parsed.name, 'Drone_01');
    assert.equal(parsed.components.Health.maxHp, 150);
});

// ============================================================================
//  8. Browser Script Environment (window exposure)
// ============================================================================

test('ArcActor: browser environment globals exposure', () => {
    const { ctx } = loadScripts([
        'js/Constants.js',
        'js/engine/ArcActor.js'
    ]);

    assert.ok(ctx.ArcActor, 'ArcActor attached to window');
    assert.ok(ctx.ArcComponent, 'ArcComponent attached to window');
    assert.ok(ctx.HealthComponent, 'HealthComponent attached to window');
    assert.ok(ctx.ColliderComponent, 'ColliderComponent attached to window');
    assert.ok(ctx.MeshComponent, 'MeshComponent attached to window');
    assert.ok(ctx.SoundEmitterComponent, 'SoundEmitterComponent attached to window');

    assert.equal(typeof ctx.ArcActor.create, 'function');
    assert.equal(typeof ctx.ArcActor.registerComponent, 'function');
});
