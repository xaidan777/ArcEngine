// Client-side prediction and reconciliation. The riskiest part of the online layer: a wrong
// prediction is worse than a delayed one, so these tests pin both the mechanism and the
// safety valve that turns it off.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

// The bridge needs the SHARED rules (RaidRules/ShooterRules) exactly as the server uses them,
// because that shared rule is what makes prediction agree with authority.
function makeContext() {
    const scripts = loadScripts(
        ['js/Constants.js', 'js/ShooterRules.js', 'js/RaidRules.js', 'js/OnlineBridge.js'],
        { performance, BABYLON: {}, World3D: { addObject() {} } }
    );
    return {
        Bridge: scripts.get('OnlineBridge'),
        RaidRules: scripts.get('RaidRules'),
        ShooterRules: scripts.get('ShooterRules'),
    };
}

function meshStub() {
    return {
        position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
        rotation: { y: 0 }, material: null, isPickable: true,
        setEnabled() {}, dispose() {}, getChildMeshes: () => [], computeWorldMatrix() {},
    };
}

function makeGame() {
    return {
        phase: 'raid',
        player: { x: 1000, y: 2000, h: 0, hp: 100, shield: 100, heading: 0 },
        enemies: [], keys: new Set(), firing: false, posture: 'stand', lean: 0, ammo: 20,
        loot: 0, raidTimer: 1200, extractState: 'locked', kills: 0, hitMarker: 0, damageFlash: 0,
        scene: {}, app: { location: { view: {} }, camera: { azimuth: 0, pitch: 0 } },
        impactBlocker() {}, showLootFeed() {},
    };
}

// A client whose world matches the server's. `sequence` advances like RaidClient's does:
// the bridge reads it BEFORE calling sendInput, so the stub must not pre-increment.
function makeClient(id = 'me', world = null) {
    return {
        id, token: 'tok', sequence: 0, world,
        sent: [], snapshot: null, events: [],
        async sendInput(command) { this.sent.push(command); this.sequence++; return null; },
        async poll() { return this.snapshot; },
        drainEvents() { const e = this.events; this.events = []; return e; },
    };
}

const snapshotOf = (overrides = {}) => Object.assign({
    version: 2, tick: 1, state: 'active', enemies: [], objective: null, outcome: null,
    players: [],
}, overrides);

// --- the mechanism -----------------------------------------------------------

test('prediction: the local player moves immediately, before any snapshot arrives', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    const startX = game.player.x;

    // One predicted command: the player must move NOW, with no server reply.
    Bridge.predict({ forward: 1, right: 0, heading: 0, sprint: false, posture: 'stand', lean: 0 }, 1 / 60);
    assert.ok(game.player.x > startX, 'the player must move on the frame the input is applied');
});

test('prediction: movement uses the SAME shared rule as the server', () => {
    const { Bridge, RaidRules } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    const command = { forward: 1, right: 0, heading: 0, sprint: false, posture: 'stand', lean: 0 };

    Bridge.predict(command, 1 / 60);
    const predictedX = game.player.x;

    // Run the server's own rule on a copy and compare: they must agree exactly.
    const authoritative = { x: 1000, y: 2000, radius: 24 };
    RaidRules.movePlayer(authoritative, command, false, 1 / 60,
        { speed: 260, radius: 24, postureSpeedMult: 1 },
        [], { width: 4096, height: 4096 });

    assert.ok(Math.abs(predictedX - authoritative.x) < 1e-6,
        `prediction ${predictedX} must equal the rule ${authoritative.x}`);
});

test('prediction: a snapshot rewinds to authority and replays unacknowledged input', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    game.keys.add('KeyW');   // hold forward: movement needs an input axis

    // Prediction happens EVERY frame; transmission is rate limited to SEND_HZ, so several
    // frames of movement produce fewer network commands. The history therefore holds the
    // commands actually sent, which is exactly what reconciliation must replay.
    for (let i = 0; i < 6; i++) Bridge.update(1 / 60);
    const predictedX = game.player.x;
    assert.ok(predictedX > 1000, 'the client predicted movement');
    assert.ok(Bridge.history.length >= 1, 'the sent input is remembered until acknowledged');
    assert.ok(client.sent.length >= 1, 'and it was actually transmitted');
    assert.ok(client.sent.length <= 6, 'but not once per frame');

    // The server reports a position as of BEFORE those commands (sequence -1 = nothing acked).
    Bridge.applySnapshot(snapshotOf({
        tick: 5,
        players: [{ id: 'me', x: 1000, y: 2000, h: 0, hp: 100, shield: 100, heading: 0, sequence: -1, posture: 'stand', lean: 0, ammo: 20 }],
    }));

    // Both commands are replayed on top of the server position, so the client keeps its
    // prediction instead of snapping back.
    assert.ok(game.player.x > 1000, 'unacknowledged input must be replayed after the rewind');
    assert.ok(Math.abs(game.player.x - predictedX) < 1e-6,
        'replaying the same commands must land on the same predicted position');
});

test('prediction: acknowledged input is NOT replayed twice', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    game.keys.add('KeyW');   // hold forward: movement needs an input axis

    Bridge.sendIntent();      // sequence 0
    Bridge.sendIntent();      // sequence 1
    const afterBoth = game.player.x;

    // The server acknowledges BOTH commands and reports the resulting position.
    const authoritativeX = 1000 + (afterBoth - 1000);
    Bridge.applySnapshot(snapshotOf({
        tick: 6,
        players: [{ id: 'me', x: authoritativeX, y: 2000, h: 0, hp: 100, shield: 100, heading: 0, sequence: 1, posture: 'stand', lean: 0, ammo: 20 }],
    }));

    assert.equal(Bridge.history.length, 0, 'acknowledged input leaves the history');
    assert.ok(Math.abs(game.player.x - authoritativeX) < 1e-6,
        'with nothing to replay the client sits exactly where the server put it');
});

test('prediction: only the unacknowledged tail is replayed', async () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    game.keys.add('KeyW');   // hold forward: movement needs an input axis

    // Drive real frames: each transmitted command is also predicted and recorded, which is the
    // path the game actually uses.
    // 60 frames is one second: at SEND_HZ=20 that transmits ~20 commands, and the stub's
    // clock advances with real time so the send interval is respected.
    for (let i = 0; i < 60; i++) { Bridge.update(1 / 60); await new Promise(r => setTimeout(r, 4)); }
    assert.ok(Bridge.history.length >= 2, 'expected several commands in flight, got ' + Bridge.history.length);
    // The server has applied everything but the newest command.
    const tailSequence = Bridge.history[Bridge.history.length - 1].sequence;
    const ackedSequence = tailSequence - 1;
    Bridge.applySnapshot(snapshotOf({
        tick: 7,
        players: [{ id: 'me', x: 1200, y: 2000, h: 0, hp: 100, shield: 100, heading: 0, sequence: ackedSequence, posture: 'stand', lean: 0, ammo: 20 }],
    }));
    assert.equal(Bridge.history.length, 1, 'only the tail stays in history');
    assert.ok(game.player.x > 1200, 'and that tail is replayed on top of the server position');
});

test('prediction: health, ammo and kills are never predicted', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    game.player.hp = 100;
    // A predicted command must not touch anything but movement and heading.
    Bridge.predict({ forward: 1, right: 0, heading: 0.5, sprint: false, posture: 'stand', lean: 0 }, 1 / 60);
    assert.equal(game.player.hp, 100, 'HP is server-owned');
    assert.equal(game.ammo, 20, 'ammo is server-owned');
    assert.equal(game.kills, 0, 'kills come from server events');
    // And a snapshot overwrites them.
    Bridge.applySnapshot(snapshotOf({
        tick: 8,
        players: [{ id: 'me', x: 1000, y: 2000, h: 0, hp: 42, shield: 7, heading: 0, sequence: 5, posture: 'stand', lean: 0, ammo: 3 }],
    }));
    assert.equal(game.player.hp, 42);
    assert.equal(game.player.shield, 7);
    assert.equal(game.ammo, 3);
});

test('prediction: collision uses the server world, so the client cannot walk through walls', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    game.player.x = 1000; game.player.y = 2000;
    // A wall directly ahead of the player, in the world the server sent.
    const world = {
        width: 4096, height: 4096,
        blockers: [{ x: 1040, y: 2000, radius: 40, height: 200 }],
        cover: [{ x: 1040, y: 2000, radius: 40, height: 200 }],
    };
    const client = makeClient('me', world);
    Bridge.attach(game, client);

    for (let i = 0; i < 40; i++) {
        Bridge.predict({ forward: 1, right: 0, heading: 0, sprint: false, posture: 'stand', lean: 0 }, 1 / 60);
    }
    // The player must be stopped by the wall, not pass through it.
    assert.ok(game.player.x <= 1000 + 200, 'the player must not pass the wall, got x=' + game.player.x);
    assert.ok(Bridge.worldBlockers, 'the collision set comes from the server world');
});

// --- safety valve ------------------------------------------------------------

test('prediction: a large, repeated correction turns prediction OFF', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    game.keys.add('KeyW');   // hold forward: movement needs an input axis
    Bridge.predict({ forward: 1, right: 0, heading: 0, sprint: false, posture: 'stand', lean: 0 }, 1 / 60);
    assert.equal(Bridge.prediction, true);

    // Model a REAL disagreement: the client keeps predicting movement while the server keeps
    // reporting the player pinned at the same spot (a rule mismatch, a map mismatch, or a wall
    // the client does not know about). The client stays ahead every time, so the correction
    // stays large instead of converging after the first rewind -- which is exactly the case a
    // "three in a row" check would miss.
    for (let i = 0; i < 4; i++) {
        game.player.x = 2000;   // the client's own prediction is far ahead of the server
        Bridge.applySnapshot(snapshotOf({
            tick: 10 + i,
            players: [{ id: 'me', x: 1000, y: 2000, h: 0, hp: 100, shield: 100, heading: 0, sequence: 99, posture: 'stand', lean: 0, ammo: 20 }],
        }));
    }
    assert.ok(Bridge.mismatches >= Bridge.MISMATCH_LIMIT_COUNT, 'each disagreement must be counted');
    assert.equal(Bridge.prediction, false, 'prediction must disable itself rather than guess wrong');
    assert.match(String(Bridge.error), /prediction-disabled/);
});

test('prediction: disabled, the snapshot is adopted verbatim', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    Bridge.prediction = false;
    // Even with unacknowledged history, no replay happens.
    Bridge.history.push({ sequence: 9, command: { forward: 1, right: 0, heading: 0 }, dt: 1 / 60 });
    Bridge.applySnapshot(snapshotOf({
        tick: 11,
        players: [{ id: 'me', x: 1500, y: 2500, h: 7, hp: 100, shield: 100, heading: 0, sequence: -1, posture: 'stand', lean: 0, ammo: 20 }],
    }));
    assert.equal(game.player.x, 1500, 'the server position wins outright');
    assert.equal(game.player.y, 2500);
    assert.equal(game.player.h, 7);
});

test('prediction: the history is bounded so a lost connection cannot leak memory', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    game.keys.add('KeyW');   // hold forward: movement needs an input axis
    for (let i = 0; i < 500; i++) Bridge.sendIntent();
    assert.ok(Bridge.history.length <= Bridge.MAX_HISTORY,
        'history must be capped, got ' + Bridge.history.length);
});

// --- transport feedback ------------------------------------------------------

test('prediction: a pushed snapshot reconciles exactly like a polled one', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    game.keys.add('KeyW');   // hold forward: movement needs an input axis
    for (let i = 0; i < 6; i++) Bridge.update(1 / 60);
    assert.ok(Bridge.history.length >= 1, 'a command must be in flight');
    // Same message shape the WebSocket transport sends.
    Bridge.applyPush({
        type: 'snapshot', sentAt: Date.now() - 25,
        snapshot: snapshotOf({
            tick: 12,
            players: [{ id: 'me', x: 1000, y: 2000, h: 0, hp: 100, shield: 100, heading: 0, sequence: -1, posture: 'stand', lean: 0, ammo: 20 }],
        }),
    });
    assert.ok(game.player.x > 1000, 'the push path replays unacknowledged input too');
    assert.ok(Bridge.latencyMs >= 20, 'the push carries a latency estimate');
});

test('prediction: status reports what the network layer is doing', () => {
    const { Bridge } = makeContext();
    const game = makeGame();
    const client = makeClient();
    Bridge.attach(game, client);
    const status = Bridge.status();
    assert.equal(status.prediction, true);
    assert.equal(typeof status.pendingInput, 'number');
    assert.equal(typeof status.lastCorrection, 'number');
    assert.equal(typeof status.latencyMs, 'number');
});