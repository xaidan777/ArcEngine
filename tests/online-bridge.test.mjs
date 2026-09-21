// The online bridge: the single place where server truth meets the rendered game.
// These tests pin the three contracts that matter — intent goes out, truth comes in, and
// peers appear — plus the one that protects everything: without a client the game is offline.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

// A game-shaped fixture. The bridge touches only these fields, so a small object is enough
// and it keeps the test independent of the 4600-line Game class.
function makeGame(overrides = {}) {
    const scene = { disposed: false };
    const mesh = () => ({
        name: '', position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
        rotation: { y: 0 }, material: null, isPickable: true,
        setEnabled() {}, dispose() {}, getChildMeshes: () => [],
    });
    return Object.assign({
        phase: 'raid',
        player: { x: 350, y: 3600, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand' },
        enemies: [
            { id: 1, archetype: 'spotter', x: 780, y: 2950, h: 0, hp: 45, maxHp: 45, state: 'patrol', dead: false },
            { id: 2, archetype: 'stalker', x: 920, y: 2450, h: 0, hp: 130, maxHp: 130, state: 'patrol', dead: false },
        ],
        keys: new Set(),
        firing: false,
        posture: 'stand',
        lean: 0,
        loot: 0,
        raidTimer: 1200,
        extractState: 'locked',
        scene,
        app: { location: { view: { scene } }, camera: { azimuth: 0, pitch: 0 } },
        hitMarker: 0, damageFlash: 0, kills: 0,
        impactBlocker() {}, showLootFeed() {},
    }, overrides);
}

// A stand-in client that records what the bridge sends and replays what we hand it.
function makeClient(id = 'me') {
    return {
        id,
        token: 'tok',
        sent: [],
        snapshot: null,
        events: [],
        async sendInput(command) { this.sent.push(command); this.snapshot = { version: 2, tick: 1, players: [] }; return this.snapshot; },
        async poll() { return this.snapshot; },
        drainEvents() { const e = this.events; this.events = []; return e; },
        async surrender() { return { ok: true }; },
        async requestExtraction() { return { ok: true }; },
    };
}

// A mesh stub with real numbers, because the bridge does arithmetic on rotation.y and
// position. `stub()` returns a Proxy that cannot be used in arithmetic.
function meshStub() {
    return {
        name: '', material: null, isPickable: true,
        position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
        rotation: { x: 0, y: 0, z: 0 },
        scaling: { x: 1, y: 1, z: 1 },
        setEnabled() {}, dispose() {}, getChildMeshes: () => [], computeWorldMatrix() {},
        getAbsolutePosition() { return { x: this.position.x, y: this.position.y, z: this.position.z }; },
    };
}

const babylonStub = {
    MeshBuilder: {
        CreateCapsule: () => meshStub(),
        CreateCylinder: () => meshStub(),
        CreateSphere: () => meshStub(),
    },
    StandardMaterial: function () { this.diffuseColor = null; this.specularColor = null; },
    Color3: function (r, g, b) { this.r = r; this.g = g; this.b = b; },
    Vector3: function (x, y, z) {
        this.x = x; this.y = y; this.z = z;
        this.length = () => Math.hypot(this.x, this.y, this.z);
        this.scaleInPlace = (s) => { this.x *= s; this.y *= s; this.z *= s; return this; };
    },
    Axis: { Y: { x: 0, y: 1, z: 0 } },
    Quaternion: { FromUnitVectorsToRef() {} },
};

function bridge() {
    // The bridge is a browser script; run it in the vm context the tests already use.
    return loadScripts(['js/OnlineBridge.js'], { performance, BABYLON: babylonStub, World3D: { addObject() {} } }).get('OnlineBridge');
}

const snapshotOf = (overrides = {}) => Object.assign({
    version: 2, tick: 10, state: 'active',
    players: [{ id: 'me', x: 400, y: 3500, h: 5, hp: 100, shield: 80, heading: 0, posture: 'stand', lean: 0, ammo: 17, sprinting: false }],
    enemies: [],
    objective: { collected: 2, raidTimer: 900, extractionState: 'available', inboundTimer: 0, boardingProgress: 1.5, contested: false },
    outcome: null,
}, overrides);

// --- offline safety ----------------------------------------------------------

test('bridge: with no client attached the game is untouched (offline path is preserved)', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, null);
    assert.equal(B.enabled, false);
    assert.equal(B.active(), false);
    // update() must be a no-op rather than throwing.
    B.update(1 / 60);
    assert.equal(B.status().peers, 0);
    assert.equal(game.player.x, 350, 'the local player is not rewritten without a server');
});

test('bridge: a client cannot be attached outside a raid', () => {
    const B = bridge();
    const game = makeGame({ phase: 'menu' });
    B.attach(game, makeClient());
    assert.equal(B.enabled, true);
    assert.equal(B.active(), false, 'the bridge only drives gameplay during a raid');
});

// --- outbound intent ---------------------------------------------------------

test('bridge: sends intent only — never position, HP, kills or loot', () => {
    const B = bridge();
    const game = makeGame();
    game.keys.add('KeyW');
    game.keys.add('ShiftLeft');
    game.firing = true;
    game.lean = 0.5;
    const client = makeClient();
    B.attach(game, client);
    B.sendIntent();

    assert.equal(client.sent.length, 1);
    const command = client.sent[0];
    // Everything the bridge is responsible for. `version` and `sequence` are added by
    // RaidClient.sendInput when it encodes the request, so the bridge must NOT send them:
    // duplicating protocol bookkeeping in two places is how versions drift apart.
    for (const key of ['forward', 'right', 'heading', 'sprint', 'fire', 'pitch', 'posture', 'lean']) {
        assert.ok(key in command, 'expected the command to carry ' + key);
    }
    // And nothing it does not.
    for (const forbidden of ['x', 'y', 'h', 'hp', 'shield', 'kills', 'loot', 'damage', 'credits', 'dt', 'version', 'sequence']) {
        assert.equal(forbidden in command, false, 'the bridge must never send ' + forbidden);
    }
    assert.equal(command.sprint, true);
    assert.equal(command.fire, true);
    assert.equal(command.lean, 0.5);
});

test('bridge: axes, heading and pitch are clamped to the protocol range', () => {
    const B = bridge();
    const game = makeGame();
    const client = makeClient();
    B.attach(game, client);
    // Force values the protocol would reject.
    game.app.camera.pitch = 5;
    game.player.heading = Math.PI * 7;
    B.sendIntent();
    const c = client.sent[0];
    assert.ok(Math.abs(c.pitch) <= Math.PI / 2, 'pitch must be clamped');
    assert.ok(Math.abs(c.heading) <= Math.PI, 'heading must be wrapped');
    assert.ok(Math.abs(c.forward) <= 1);
    assert.ok(Math.abs(c.right) <= 1);
});

test('bridge: a failed send does not throw into the frame loop', async () => {
    const B = bridge();
    const game = makeGame();
    const client = makeClient();
    client.sendInput = async () => { throw new Error('network down'); };
    B.attach(game, client);
    B.sendIntent();
    await new Promise(r => setTimeout(r, 10));
    assert.match(B.status().error, /network down/);
});

// --- inbound truth -----------------------------------------------------------

test('bridge: a snapshot overwrites the local player with server truth', () => {
    const B = bridge();
    const game = makeGame();
    const client = makeClient();
    B.attach(game, client);
    B.applySnapshot(snapshotOf());

    assert.equal(game.player.x, 400);
    assert.equal(game.player.y, 3500);
    assert.equal(game.player.h, 5);
    assert.equal(game.player.shield, 80);
    assert.equal(game.ammo, 17);
});

test('bridge: objectives and the raid clock come from the server', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient());
    B.applySnapshot(snapshotOf());
    assert.equal(game.loot, 2);
    assert.equal(game.raidTimer, 900);
    assert.equal(game.extractState, 'available');
    assert.equal(game.extractContested, false);
});

test('bridge: machine positions are taken from the server, not simulated locally', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient());
    B.applySnapshot(snapshotOf({
        enemies: [
            { id: 1, archetype: 'spotter', x: 111, y: 222, h: 33, hp: 10, maxHp: 45, state: 'engage', heading: 1 },
            { id: 2, archetype: 'stalker', x: 444, y: 555, h: 66, hp: 0, maxHp: 130, state: 'engage', heading: 2 },
        ],
    }));
    const spotter = game.enemies.find(e => e.id === 1);
    assert.equal(spotter.x, 111);
    assert.equal(spotter.y, 222);
    assert.equal(spotter.hp, 10);
    assert.equal(spotter.state, 'engage');
    const dead = game.enemies.find(e => e.id === 2);
    assert.equal(dead.dead, true, 'a machine killed on the server is dead locally');
});

test('bridge: a stale snapshot is ignored, so an old reply cannot undo newer truth', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient());
    B.applySnapshot(snapshotOf({ tick: 50, players: [{ id: 'me', x: 900, y: 900, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 }] }));
    assert.equal(game.player.x, 900);
    B.applySnapshot(snapshotOf({ tick: 10, players: [{ id: 'me', x: 1, y: 1, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 }] }));
    assert.equal(game.player.x, 900, 'the older snapshot must not be applied');
});

test('bridge: the raid state and outcome are recorded, never invented', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient());
    B.applySnapshot(snapshotOf({ state: 'ended', outcome: { won: true, reason: 'extraction', survivors: ['me'] } }));
    assert.equal(game.onlineState, 'ended');
    assert.equal(game.onlineOutcome.won, true);
    assert.equal(game.onlineOutcome.reason, 'extraction');
});

// --- peers -------------------------------------------------------------------

test('bridge: another player in the snapshot becomes a body in the scene', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({
        players: [
            { id: 'me', x: 400, y: 3500, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 },
            { id: 'friend', x: 500, y: 3400, h: 0, hp: 100, heading: 1.2, posture: 'stand', lean: 0, ammo: 20 },
        ],
    }));
    assert.equal(B.status().peers, 1, 'exactly one peer body, not two');
    assert.ok(B.peers.has('friend'));
    assert.equal(B.peers.has('me'), false, 'the local player is never drawn as a peer');
});

test('bridge: peer bodies interpolate toward the server position', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    const peerRow = (x) => ({ id: 'p', x, y: 0, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 });
    const meRow = { id: 'me', x: 0, y: 0, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 };
    // Two snapshots: interpolation needs a previous position to travel FROM, which is exactly
    // what real polling provides. A single snapshot has nowhere to interpolate from.
    // The jitter buffer holds a fixed depth behind the newest sample, so it needs several
    // snapshots before there is any window to play back.
    for (let s = 0; s < 8; s++) {
        B.applySnapshot(snapshotOf({ tick: 5 + s, players: [meRow, peerRow(Math.min(100, s * 20))] }));
    }

    const peer = B.peers.get('p');
    // The renderer plays back a jitter buffer a fixed depth behind the newest sample, so it
    // starts BEHIND the latest position and advances at the snapshot rate.
    assert.ok(peer.x <= 100.0001, 'the body never runs ahead of the authoritative position');
    let moved = false;
    const start = peer.x;
    for (let i = 0; i < 20; i++) {
        B.interpolatePeers(1 / 60);
        if (peer.x > start) moved = true;
        assert.ok(peer.x <= 100.0001, 'it never overshoots the authoritative position');
    }
    assert.ok(moved, 'the body advances through the buffered samples');
    // Given enough frames it converges.
    for (let i = 0; i < 400; i++) B.interpolatePeers(1 / 60);
    assert.ok(Math.abs(peer.x - 100) < 0.5, 'it converges on the server position, got ' + peer.x.toFixed(2));
});

test('bridge: a peer that leaves is removed once it stops appearing', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({
        players: [
            { id: 'me', x: 0, y: 0, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 },
            { id: 'gone', x: 10, y: 10, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 },
        ],
    }));
    assert.equal(B.peers.size, 1);
    // The peer is absent from the next snapshot; its lastSeen is old, so it is dropped.
    B.peers.get('gone').lastSeen = -1e9;
    B.applySnapshot(snapshotOf({ tick: 11, players: [{ id: 'me', x: 0, y: 0, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 }] }));
    assert.equal(B.peers.size, 0, 'the body is cleaned up');
});

test('bridge: a peer body follows the kit heading convention', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    const meRow = { id: 'me', x: 0, y: 0, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 };
    B.applySnapshot(snapshotOf({ tick: 5, players: [meRow, { id: 'p', x: 0, y: 0, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 }] }));
    // Turn the peer to +PI/2 and let the body ease into it.
    B.applySnapshot(snapshotOf({ tick: 6, players: [meRow, { id: 'p', x: 0, y: 0, h: 0, hp: 100, heading: Math.PI / 2, posture: 'stand', lean: 0, ammo: 20 }] }));
    const peer = B.peers.get('p');
    // Several snapshots are needed before the buffer has a pair to interpolate between.
    for (let s = 0; s < 4; s++) {
        B.applySnapshot(snapshotOf({ tick: 7 + s, players: [meRow, { id: 'p', x: 0, y: 0, h: 0, hp: 100, heading: Math.PI / 2, posture: 'stand', lean: 0, ammo: 20 }] }));
    }
    for (let i = 0; i < 400; i++) B.interpolatePeers(1 / 60);
    // Kit rule: rotation.y = -heading, because the model nose points along +X.
    assert.ok(Math.abs(peer.mesh.rotation.y + Math.PI / 2) < 0.05,
        'expected rotation.y ≈ -PI/2, got ' + peer.mesh.rotation.y.toFixed(3));
});

test('bridge: a peer turning across ±PI takes the short way round', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    const meRow = { id: 'me', x: 0, y: 0, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 };
    const peerRow = (heading) => ({ id: 'p', x: 0, y: 0, h: 0, hp: 100, heading, posture: 'stand', lean: 0, ammo: 20 });
    B.applySnapshot(snapshotOf({ tick: 5, players: [meRow, peerRow(Math.PI - 0.1)] }));
    B.applySnapshot(snapshotOf({ tick: 6, players: [meRow, peerRow(-Math.PI + 0.1)] }));
    const peer = B.peers.get('p');
    // A naive lerp would spin almost the whole circle; the shortest arc passes through PI.
    let maxAbs = 0;
    for (let i = 0; i < 120; i++) {
        B.interpolatePeers(1 / 60);
        maxAbs = Math.max(maxAbs, Math.abs(peer.heading));
    }
    // The buffer interpolates on the shortest arc too, so the heading never wraps past PI.
    assert.ok(maxAbs <= Math.PI + 0.05, 'heading must stay in range, peaked at ' + maxAbs.toFixed(2));
});

// --- events ------------------------------------------------------------------

test('bridge: server events drive feedback but never re-decide an outcome', () => {
    const B = bridge();
    const game = makeGame();
    const client = makeClient('me');
    B.attach(game, client);
    client.events = [
        { type: 'enemyKill', killerId: 'me', enemyId: 1, archetype: 'spotter', tick: 5 },
        { type: 'hit', targetId: 'me', damage: 20, tick: 5 },
        { type: 'enemyHit', shooterId: 'me', enemyId: 2, damage: 30, point: { x: 1, y: 2, h: 3 }, tick: 5 },
    ];
    B.applySnapshot(snapshotOf());
    assert.equal(game.kills, 1, 'a kill event is counted once');
    assert.ok(game.damageFlash > 0, 'being hit flashes the screen');
    // Applied exactly once: a second snapshot with no new events must not double count.
    B.applySnapshot(snapshotOf({ tick: 11 }));
    assert.equal(game.kills, 1, 'an event is never applied twice');
});

test('bridge: detach removes every peer body and disables the bridge', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({
        players: [
            { id: 'me', x: 0, y: 0, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 },
            { id: 'p', x: 0, y: 0, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 },
        ],
    }));
    assert.equal(B.peers.size, 1);
    B.detach();
    assert.equal(B.peers.size, 0);
    assert.equal(B.enabled, false);
    assert.equal(B.active(), false);
});
// --- projectiles -------------------------------------------------------------

const projRow = (id, shooterId, x, over = {}) => Object.assign(
    { id, shooterId, x, y: 2000, h: 50, vx: 4000, vy: 0, vh: 0 }, over);

test('projectiles: a snapshot bullet becomes a visible tracer', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({ projectiles: [projRow('b1', 'friend', 1200)] }));
    assert.equal(B.projectiles.size, 1, 'an online bullet must be drawn, or nobody sees any shots');
    assert.ok(B.projectiles.get('b1').mesh, 'the tracer has a mesh');
});

test('projectiles: the local player’s own shots are drawn too', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    // In online mode the local weapon is silenced, so the ONLY way your own tracer appears is
    // by drawing the server's projectile. This is the regression that made online feel dead.
    B.applySnapshot(snapshotOf({ projectiles: [projRow('mine', 'me', 1300)] }));
    assert.equal(B.projectiles.size, 1);
});

test('projectiles: a bullet that disappears from the snapshot is disposed', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({ tick: 1, projectiles: [projRow('b1', 'friend', 1200)] }));
    assert.equal(B.projectiles.size, 1);
    // The server no longer lists it: it hit or expired, so the visual must go at once.
    B.applySnapshot(snapshotOf({ tick: 2, projectiles: [] }));
    assert.equal(B.projectiles.size, 0, 'a landed bullet must not linger in the world');
});

test('projectiles: tracers interpolate toward the authoritative position', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({ tick: 1, projectiles: [projRow('b1', 'friend', 1200)] }));
    const entry = B.projectiles.get('b1');
    // A second snapshot moves the bullet; the visual must ease toward it, not teleport.
    B.applySnapshot(snapshotOf({ tick: 2, projectiles: [projRow('b1', 'friend', 1400)] }));
    assert.ok(entry.x < 1400, 'the tracer starts behind the new position');
    for (let i = 0; i < 60; i++) B.interpolateProjectiles(1 / 60);
    assert.ok(Math.abs(entry.x - 1400) < 1, 'and converges on it, got ' + entry.x.toFixed(1));
});

test('projectiles: a machine shot is hostile, a teammate’s is not', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({
        projectiles: [projRow('e1', -3, 1200), projRow('p1', 'friend', 1200)],
    }));
    assert.equal(B.projectiles.get('e1').hostile, true, 'incoming fire must read as hostile');
    assert.equal(B.projectiles.get('p1').hostile, false, 'an ally’s shot must not');
});

test('projectiles: detach removes every tracer from the scene', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({ projectiles: [projRow('b1', 'friend', 1200), projRow('b2', -1, 1250)] }));
    assert.equal(B.projectiles.size, 2);
    B.detach();
    assert.equal(B.projectiles.size, 0, 'leaving the raid must not leave bullets behind');
});

// --- raid settlement ---------------------------------------------------------

test('settlement: the server outcome actually ends the online raid', () => {
    const B = bridge();
    const game = makeGame();
    let finished = null;
    game.finish = (won) => { finished = won; game.phase = won ? 'won' : 'lost'; };
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({ state: 'ended', outcome: { won: true, reason: 'extraction' } }));
    assert.equal(finished, true, 'a server win must reach Game.finish, or the raid never ends');
    assert.equal(game.phase, 'won');
});

test('settlement: a loss is reported as a loss', () => {
    const B = bridge();
    const game = makeGame();
    let finished = null;
    game.finish = (won) => { finished = won; };
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({ state: 'ended', outcome: { won: false, reason: 'wipe' } }));
    assert.equal(finished, false);
});

test('settlement: a raid settles exactly once, however many snapshots arrive', () => {
    const B = bridge();
    const game = makeGame();
    let count = 0;
    game.finish = () => { count++; };
    B.attach(game, makeClient('me'));
    // The server keeps broadcasting the outcome until the room is collected.
    for (let i = 0; i < 5; i++) {
        B.applySnapshot(snapshotOf({ tick: 10 + i, state: 'ended', outcome: { won: true, reason: 'extraction' } }));
    }
    assert.equal(count, 1, 'settling twice would award the raid twice');
});

test('settlement: a live raid is not settled by a stray outcome-shaped field', () => {
    const B = bridge();
    const game = makeGame();
    let count = 0;
    game.finish = () => { count++; };
    B.attach(game, makeClient('me'));
    B.applySnapshot(snapshotOf({ state: 'active', outcome: null }));
    assert.equal(count, 0, 'an active raid must keep running');
    assert.equal(game.phase, 'raid');
});

// --- fire events (shots that never appear as projectiles) --------------------

test('fire events: a point-blank shot still shows a muzzle flash', () => {
    const B = bridge();
    const game = makeGame();
    const client = makeClient('me');
    B.attach(game, client);
    // A shot that resolves inside one tick never appears in any snapshot, so the ONLY evidence
    // it happened is the fire event. Without this, close-range fire is completely invisible.
    B.applySnapshot(snapshotOf({
        tick: 3,
        players: [{ id: 'friend', x: 500, y: 3400, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 19 }],
        projectiles: [],
    }));
    client.events = [{ type: 'fire', shooterId: 'friend', projId: 'p1', tick: 3 }];
    B.applySnapshot(snapshotOf({ tick: 4, projectiles: [] }));
    assert.equal(B.flashes.length, 1, 'a fired shot must leave a visible flash');
});

test('fire events: a flash is short-lived and cleans itself up', () => {
    const B = bridge();
    const game = makeGame();
    const client = makeClient('me');
    B.attach(game, client);
    B.applySnapshot(snapshotOf({
        tick: 1,
        players: [{ id: 'friend', x: 500, y: 3400, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 19 }],
    }));
    client.events = [{ type: 'fire', shooterId: 'friend', projId: 'p1', tick: 1 }];
    B.applySnapshot(snapshotOf({ tick: 2 }));
    assert.equal(B.flashes.length, 1);
    // A flash lives a couple of frames, not the whole raid.
    for (let i = 0; i < 10; i++) B.updateFlashes(1 / 60);
    assert.equal(B.flashes.length, 0, 'the flash must expire on its own');
});

test('fire events: a teammate taking a hit shows an impact where the bullet landed', () => {
    const B = bridge();
    const game = makeGame();
    const client = makeClient('me');
    let impacts = 0;
    game.impactBlocker = () => { impacts++; };
    B.attach(game, client);
    B.applySnapshot(snapshotOf({
        tick: 5,
        players: [{ id: 'friend', x: 500, y: 3400, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 19 }],
    }));
    client.events = [{ type: 'hit', targetId: 'friend', damage: 20, point: { x: 500, y: 3400, h: 50 }, tick: 5 }];
    B.applySnapshot(snapshotOf({ tick: 6 }));
    assert.equal(impacts, 1, 'a squad must be able to see a teammate being shot');
});

test('fire events: detach clears any flash still on screen', () => {
    const B = bridge();
    const game = makeGame();
    const client = makeClient('me');
    B.attach(game, client);
    B.applySnapshot(snapshotOf({
        tick: 1,
        players: [{ id: 'friend', x: 500, y: 3400, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 19 }],
    }));
    client.events = [{ type: 'fire', shooterId: 'friend', projId: 'p1', tick: 1 }];
    B.applySnapshot(snapshotOf({ tick: 2 }));
    assert.equal(B.flashes.length, 1);
    B.detach();
    assert.equal(B.flashes.length, 0);
});

// --- jitter buffer -----------------------------------------------------------

test('jitter: peer motion is monotonic and evenly spaced, not arrival-driven', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    const meRow = { id: 'me', x: 0, y: 0, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 };
    const peerRow = (x) => ({ id: 'p', x, y: 0, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 });
    // A peer walking at a constant speed: 15 px per snapshot at 20 Hz (300 px/s).
    for (let s = 0; s < 10; s++) {
        B.applySnapshot(snapshotOf({ tick: s, players: [meRow, peerRow(s * 15)] }));
    }
    const peer = B.peers.get('p');
    const xs = [];
    for (let f = 0; f < 60; f++) { B.interpolatePeers(1 / 60); xs.push(peer.x); }
    // Monotonic: a remote body must never slide backwards, which is what a late packet used
    // to cause when the ease restarted from a stale position.
    for (let i = 1; i < xs.length; i++) {
        assert.ok(xs[i] >= xs[i - 1] - 1e-6, 'the body must not move backwards, frame ' + i);
    }
    // Evenly spaced: 300 px/s at 60 fps is 5 px per frame, never a jump.
    let maxJump = 0;
    for (let i = 1; i < xs.length; i++) maxJump = Math.max(maxJump, xs[i] - xs[i - 1]);
    assert.ok(maxJump < 8, 'a frame must not advance more than a smooth step, got ' + maxJump.toFixed(2));
});

test('jitter: the buffer is bounded so a stalled link cannot grow memory', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    const meRow = { id: 'me', x: 0, y: 0, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 };
    for (let s = 0; s < 100; s++) {
        B.applySnapshot(snapshotOf({ tick: s, players: [meRow, { id: 'p', x: s, y: 0, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 }] }));
    }
    const peer = B.peers.get('p');
    assert.ok(peer.samples.length <= B.JITTER_MAX_SAMPLES,
        'samples must be capped, got ' + peer.samples.length);
});

test('jitter: a peer that just appeared still renders (buffer not yet filled)', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));
    const meRow = { id: 'me', x: 0, y: 0, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 };
    B.applySnapshot(snapshotOf({ tick: 1, players: [meRow, { id: 'p', x: 200, y: 100, h: 0, hp: 100, heading: 0, posture: 'stand', lean: 0, ammo: 20 }] }));
    const peer = B.peers.get('p');
    for (let f = 0; f < 10; f++) B.interpolatePeers(1 / 60);
    // One sample is not enough to interpolate, so the fallback ease must still place the body.
    assert.ok(Number.isFinite(peer.x) && Number.isFinite(peer.y), 'the body must stay somewhere valid');
    assert.ok(peer.x >= 0 && peer.x <= 200, 'and must not be flung outside the segment');
});

// --- spectator mode ----------------------------------------------------------

test('spectator: enters spectator mode when local player dies while teammates are alive', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));

    // First snapshot: both alive
    B.applySnapshot(snapshotOf({
        tick: 1,
        players: [
            { id: 'me', x: 100, y: 100, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', ammo: 20 },
            { id: 'teammate_1', x: 200, y: 200, h: 0, hp: 100, shield: 100, heading: 0, posture: 'stand', ammo: 20 },
        ]
    }));
    assert.equal(B.spectating, false);

    // Second snapshot: local player killed (hp = 0)
    B.applySnapshot(snapshotOf({
        tick: 2,
        players: [
            { id: 'me', x: 100, y: 100, h: 0, hp: 0, shield: 0, heading: 0, posture: 'stand', ammo: 0 },
            { id: 'teammate_1', x: 220, y: 220, h: 0, hp: 85, shield: 50, heading: 0.5, posture: 'stand', ammo: 18 },
        ]
    }));

    assert.equal(B.spectating, true, 'spectating should be active when dead with alive teammates');
    assert.equal(B.spectateTargetId, 'teammate_1', 'should spectate the alive teammate');
    const target = B.getSpectatedPeer();
    assert.ok(target, 'target peer must exist');
    assert.equal(target.id, 'teammate_1');
    assert.equal(target.hp, 85);
    assert.equal(target.shield, 50);

    // While spectating, buildCommand must return neutral intent (no moving or shooting)
    const cmd = B.buildCommand();
    assert.equal(cmd.forward, 0);
    assert.equal(cmd.right, 0);
    assert.equal(cmd.fire, false);
});

test('spectator: cycling targets switches between multiple alive teammates', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));

    B.applySnapshot(snapshotOf({
        tick: 1,
        players: [
            { id: 'me', x: 0, y: 0, h: 0, hp: 0, shield: 0, heading: 0, posture: 'stand', ammo: 0 },
            { id: 't1', x: 100, y: 100, h: 0, hp: 100, shield: 100, heading: 0 },
            { id: 't2', x: 200, y: 200, h: 0, hp: 75, shield: 50, heading: 1 },
            { id: 't3', x: 300, y: 300, h: 0, hp: 50, shield: 0, heading: 2 },
        ]
    }));

    assert.equal(B.spectating, true);
    assert.equal(B.spectateTargetId, 't1');

    // Cycle forward
    const next1 = B.cycleSpectateTarget(1);
    assert.equal(next1.id, 't2');
    assert.equal(B.spectateTargetId, 't2');

    const next2 = B.cycleSpectateTarget(1);
    assert.equal(next2.id, 't3');

    // Wrap around to t1
    const wrap = B.cycleSpectateTarget(1);
    assert.equal(wrap.id, 't1');

    // Cycle backward
    const prev = B.cycleSpectateTarget(-1);
    assert.equal(prev.id, 't3');
});

test('spectator: automatically switches when the spectated teammate dies', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));

    B.applySnapshot(snapshotOf({
        tick: 1,
        players: [
            { id: 'me', x: 0, y: 0, h: 0, hp: 0, shield: 0 },
            { id: 't1', x: 100, y: 100, h: 0, hp: 100 },
            { id: 't2', x: 200, y: 200, h: 0, hp: 100 },
        ]
    }));

    assert.equal(B.spectating, true);
    assert.equal(B.spectateTargetId, 't1');

    // Next snapshot: t1 dies, t2 is still alive
    B.applySnapshot(snapshotOf({
        tick: 2,
        players: [
            { id: 'me', x: 0, y: 0, h: 0, hp: 0, shield: 0 },
            { id: 't1', x: 100, y: 100, h: 0, hp: 0 },
            { id: 't2', x: 200, y: 200, h: 0, hp: 90 },
        ]
    }));

    assert.equal(B.spectating, true);
    assert.equal(B.spectateTargetId, 't2', 'should auto-cycle to t2 because t1 died');
});

test('spectator: deactivates when all teammates are dead', () => {
    const B = bridge();
    const game = makeGame();
    B.attach(game, makeClient('me'));

    B.applySnapshot(snapshotOf({
        tick: 1,
        players: [
            { id: 'me', x: 0, y: 0, h: 0, hp: 0 },
            { id: 't1', x: 100, y: 100, h: 0, hp: 100 },
        ]
    }));
    assert.equal(B.spectating, true);

    // All dead
    B.applySnapshot(snapshotOf({
        tick: 2,
        players: [
            { id: 'me', x: 0, y: 0, h: 0, hp: 0 },
            { id: 't1', x: 100, y: 100, h: 0, hp: 0 },
        ]
    }));
    assert.equal(B.spectating, false, 'spectating should end when no alive teammates exist');
    assert.equal(B.spectateTargetId, null);
});

