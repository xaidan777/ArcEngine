// tests/online-anticheat.test.mjs
//
// THREAT MODEL: a modified client that speaks the real wire protocol. Every test below sits
// in the attacker's chair and sends the bytes a cheater would send — forged positions and HP,
// impossible movement axes, replayed sequence numbers, fire after death, an extraction claimed
// from across the map, a malformed command — then asserts the SERVER's outcome, never the
// client's claim.
//
// LAYERING CHOICE, stated per test:
//   * the REAL HTTP/WS server is used where the attack is about what a client can put on the
//     wire (forged fields, malformed JSON, protocol version, route probing): the transport is
//     exactly where a hostile client lives, so a route-level guarantee must be proven there;
//   * the raw `RaidRoom` is used for physics/ballistics, where a deterministic 60 Hz trace is
//     the only way to measure an invariant exactly (speed, wall clipping, sequence replay,
//     firing while dead) — the transport adds scheduling jitter without adding any trust.
// Both ingress paths share ONE guard: server/main.mjs:347 (HTTP) and server/main.mjs:532 (WS)
// both call `RaidRoom.input()`, so a contract proven at the room is inherited by both.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import { RaidRoom, TICK_RATE } from '../server/simulation.mjs';
import { createGameServer } from '../server/main.mjs';
import { decodeFrame, encodeClientFrame } from '../server/ws.mjs';
import { loadScripts } from './browser-scripts.mjs';

// The server executes THESE constants: server/simulation.mjs:10-22 runs js/Constants.js
// through node:vm and reads GAME_PLAYER_SPEED out of that context. So the movement ceiling
// below is not a number copied into a test — it is the number the room itself moves by
// (GAME_PLAYER_SPEED = 260 px/s, js/Constants.js:64).
const { get: browserConstant } = loadScripts(['js/Constants.js']);
const SPEED = browserConstant('GAME_PLAYER_SPEED');            // 260 px/s
const RADIUS = browserConstant('GAME_PLAYER_RADIUS');          // 24 px
const PLAYER_HP = browserConstant('GAME_PLAYER_HP');           // 100
// RaidRules.movePlayer (js/RaidRules.js:39-48): speed * scale(1 when forward > 0) *
// (sprinting ? 1.35 : 1) * postureMult. `posture` defaults to stand, whose speedMult is 1.0.
const SPRINT_MULT = 1.35;
const MAX_STEP = (SPEED * SPRINT_MULT) / TICK_RATE;            // 5.85 px per authoritative tick
const TOL = 0.5;                                               // float/rounding slack, in px

// A read-only reference room: the seed createGameServer uses by default, so the map rectangle
// and blockers asserted on below are the very ones the HTTP server serves.
const REFERENCE = new RaidRoom({ seed: 7419 });

const cmd = (sequence, extra = {}) =>
    ({ version: 2, sequence, forward: 0, right: 0, heading: 0, sprint: false, ...extra });

// Deterministic room: the PvE garrison would add a firefight to every physics trace, so the
// machines are stood down where the thing under test is a movement/ballistics rule.
function quietRoom(ids = ['a']) {
    const room = new RaidRoom({ seed: 7419 });
    for (const id of ids) room.join(id);
    for (const enemy of room.enemies.values()) enemy.hp = 0;
    return room;
}

const fireEventsFor = (room, id) => room.events.filter(e => e.type === 'fire' && e.shooterId === id);

const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await new Promise(r => setTimeout(r, 10));
    }
    return fn();
};

// A minimal RFC 6455 client, mirroring tests/ws-transport.test.mjs: the raw frames are the
// point — a hostile client is not obliged to use the project's own client class.
function connect(url) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request({
            hostname: u.hostname, port: u.port, path: u.pathname,
            headers: {
                Connection: 'Upgrade', Upgrade: 'websocket',
                'Sec-WebSocket-Version': 13,
                'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
            },
        });
        req.on('upgrade', (res, socket, head) => {
            const client = { socket, buffer: Buffer.alloc(0), messages: [], closed: false };
            const consume = (chunk) => {
                client.buffer = Buffer.concat([client.buffer, chunk]);
                for (;;) {
                    const frame = decodeFrame(client.buffer);
                    if (!frame) break;
                    client.buffer = client.buffer.subarray(frame.consumed);
                    if (frame.opcode === 0x1) {
                        try { client.messages.push(JSON.parse(frame.payload.toString('utf8'))); }
                        catch { client.messages.push({ type: 'unparsed' }); }
                    }
                    if (frame.opcode === 0x8) client.closed = true;
                }
            };
            client.send = (obj) => socket.write(encodeClientFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')));
            client.close = () => { try { socket.write(encodeClientFrame(0x8, Buffer.alloc(0))); socket.end(); } catch { /* gone */ } };
            socket.on('data', consume);
            socket.on('close', () => { client.closed = true; });
            if (head && head.length) consume(head);
            resolve(client);
        });
        req.on('response', res => reject(new Error('HTTP ' + res.statusCode)));
        req.on('error', reject);
        req.end();
    });
}

async function withServer(fn) {
    const server = createGameServer({ accountsDir: null });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const wsUrl = `ws://127.0.0.1:${server.address().port}/ws`;
    const api = async (path, { method = 'GET', token, body, raw } = {}) => {
        const res = await fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)),
        });
        let json = null;
        try { json = await res.json(); } catch { /* empty body */ }
        return { status: res.status, body: json };
    };
    const reg = async (name) =>
        (await api('/register', { method: 'POST', body: { name, password: 'secret123' } })).body.token;
    try {
        await fn({ api, base, wsUrl, server, reg });
    } finally {
        // Close every socket FIRST: server.close() waits for open WebSockets and would hang
        // the whole run.
        try { server.arc.wsHub.closeAll(); } catch { /* already gone */ }
        await new Promise(r => { server.close(r); server.closeAllConnections(); });
        await new Promise(r => setTimeout(r, 10));
    }
}

// ---------------------------------------------------------------------------
// 1. Position / stat forgery over the real transport
// ---------------------------------------------------------------------------

// THREAT: the client appends `x`, `y`, `hp`, `shield`, `ammo`, `kills`, `credits` to a legal
// intent frame and hopes the server merges the record. The room whitelists intent only
// (server/simulation.mjs:253-270). Proven on the real HTTP ingress — the bytes a cheater can
// actually send.
test('anticheat: forged position, HP, ammo and credits in an input frame are ignored', async () => {
    await withServer(async ({ api, reg }) => {
        const token = await reg('ForgedFields');
        const accountId = (await api('/account', { token })).body.account.id;

        const result = await api('/input', {
            method: 'POST', token,
            body: cmd(0, {
                // The frame is otherwise VALID intent: the server must accept it (a cheater
                // cannot be refused merely for sending extra JSON keys) yet apply none of them.
                x: 3900, y: 3900, h: 99999,
                hp: 99999, shield: 99999, ammo: 99999,
                kills: 999, credits: 999999, extracted: true,
                collectedDrives: 99, extractionState: 'boarding',
            }),
        });
        assert.equal(result.status, 200, 'a well-formed intent frame with extra keys is accepted');

        const me = result.body.players.find(p => p.id === accountId);
        assert.ok(me, 'the attacker is in the authoritative snapshot');
        assert.notEqual(me.x, 3900, 'the forged x must not be applied');
        assert.notEqual(me.y, 3900, 'the forged y must not be applied');
        assert.ok(me.x >= 50 && me.x <= REFERENCE.width - 50, 'position is a real map coordinate');
        assert.ok(me.y >= 50 && me.y <= REFERENCE.height - 50);
        // The snapshot is taken on the same server-side handling of the frame, before the
        // player could have been hurt, so these are exact — a forged value is the only way
        // either number could exceed the join defaults (server/simulation.mjs:206-216).
        assert.equal(me.hp, PLAYER_HP, 'HP is server-owned');
        assert.equal(me.shield, 100, 'shield is server-owned');
        assert.equal(me.ammo, 20, 'ammo is server-owned');
        // The server never even echoes an inventory/score field on the player record, so a
        // client cannot read a forged one back and mistake it for truth.
        assert.equal('credits' in me, false, 'no credits field is echoed to the room');
        assert.equal('kills' in me, false, 'no kill count is echoed to the room');
        assert.ok(me.h < 1000, 'the surface height is recomputed, not trusted');

        // Objective progress cannot be forged through intent either.
        assert.equal(result.body.objective.collected, 0, 'drives stay server-owned');
        assert.equal(result.body.objective.extractionState, 'locked', 'the beacon stays locked');

        // And the wallet really is untouched (not merely hidden in the snapshot).
        const account = (await api('/account', { token })).body.account;
        assert.equal(account.credits, 0, 'a client cannot mint credits through /input');
        assert.deepEqual(account.stats, { raids: 0, extractions: 0, kills: 0, deaths: 0 });
    });
});

// ---------------------------------------------------------------------------
// 2. Impossible speed / axes and out-of-bounds movement
// ---------------------------------------------------------------------------

// THREAT: `forward: 1000` is an attempt to buy speed by inflating the axis instead of
// teleporting. The room refuses the frame outright. Pinned at RaidRoom.input() — the shared
// guard both transports call — so a future transport cannot reintroduce the hole.
test('anticheat: inflated movement axes are refused and never become displacement', () => {
    const room = quietRoom(['a']);
    const p = room.players.get('a');
    const start = { x: p.x, y: p.y };

    // `forward: 1000` is the historical exploit shape: a legal key with an illegal magnitude.
    assert.equal(room.input('a', cmd(0, { forward: 1000, right: -999 })), false,
        'an out-of-range axis is refused');
    assert.equal(p.input, null, 'a refused frame does not even become held intent');
    assert.equal(room.input('a', cmd(1, { forward: 1.0001 })), false, 'just past +1 is refused');
    assert.equal(room.input('a', cmd(2, { forward: -1.5 })), false, 'just past -1 is refused');
    assert.equal(room.input('a', cmd(3, { right: Number.MAX_VALUE })), false, 'MAX_VALUE is refused');
    assert.equal(room.input('a', cmd(4, { forward: 1, right: 0, heading: Number.NaN })), false,
        'a NaN heading is refused');

    for (let i = 0; i < TICK_RATE; i++) room.step();
    assert.equal(p.x, start.x, 'the refused commands moved the player zero px');
    assert.equal(p.y, start.y);
});

// THREAT: even when the axes are legal, the client is not allowed to decide how fast they
// translate into position. The room moves at GAME_PLAYER_SPEED, sprint-capped, on its own
// clock — a client that spams input every tick gains nothing over one that sends once.
test('anticheat: legal input at maximum rate cannot exceed the room speed budget', () => {
    const room = quietRoom(['a']);
    const p = room.players.get('a');
    const start = { x: p.x, y: p.y };

    // 60 authoritative ticks = 1 s of sprinting forward, re-sent every single tick.
    for (let i = 0; i < TICK_RATE; i++) {
        assert.equal(room.input('a', cmd(i, { forward: 1, heading: 0, sprint: true })), true);
        room.step();
    }
    const budget = MAX_STEP * TICK_RATE;
    const travel = Math.hypot(p.x - start.x, p.y - start.y);
    assert.ok(travel <= budget + TOL,
        `one second of sprint displaced ${travel.toFixed(1)} px, budget ${budget.toFixed(1)} px`);
    assert.ok(travel > budget - TOL, 'the ceiling is tight, not vacuously large');

    // A diagonal (forward + strafe) is normalised by RaidRules.movePlayer: no Pythagorean bonus.
    const room2 = quietRoom(['a']);
    const p2 = room2.players.get('a');
    const start2 = { x: p2.x, y: p2.y };
    for (let i = 0; i < TICK_RATE; i++) {
        room2.input('a', cmd(i, { forward: 1, right: -1, heading: 0.7, sprint: true }));
        room2.step();
    }
    const diagonal = Math.hypot(p2.x - start2.x, p2.y - start2.y);
    assert.ok(diagonal <= budget + TOL,
        `a diagonal moved ${diagonal.toFixed(1)} px, budget ${budget.toFixed(1)} px`);
});

// THREAT: run off the map and shoot from outside it. The room clamps every move to the map
// rectangle (js/RaidRules.js:47-48), so a heading aimed at a corner cannot leave the playfield.
test('anticheat: a player driven at the map corner stays inside the bounds', () => {
    const room = quietRoom(['a']);
    const p = room.players.get('a');
    p.x = 300; p.y = 300;
    for (let i = 0; i < 200; i++) {
        room.input('a', cmd(i, { forward: 1, right: 1, heading: Math.PI * 0.75, sprint: true }));
        room.step();
        assert.ok(p.x >= 50 && p.x <= room.width - 50, `x left the map: ${p.x}`);
        assert.ok(p.y >= 50 && p.y <= room.height - 50, `y left the map: ${p.y}`);
    }
    assert.ok(Math.hypot(p.x - 300, p.y - 300) > 0, 'the attacker was actually moving');
});

// ---------------------------------------------------------------------------
// 3. Wall clipping
// ---------------------------------------------------------------------------

// THREAT: drive straight into a blocker and hope the server resolves the move along the
// blocked axis only, teleporting the player to the far side ("clipping" through cover).
// RaidRules resolves against the circle and slides, so the attacker must stay on the near
// side and outside the collider on EVERY tick — checked every tick, not just at the end,
// because a single clipped tick is already a kill through a wall.
test('anticheat: driving into a map blocker never clips through to the far side', () => {
    for (const index of [0, 5]) {
        const room = quietRoom(['a']);
        const p = room.players.get('a');
        const blocker = room.map.blockers[index];
        const combined = RADIUS + blocker.radius;

        // Deterministic placement: dead centre behind the blocker, 5 px clear of its surface.
        p.x = blocker.x - (combined + 5);
        p.y = blocker.y;
        assert.ok(p.x < blocker.x, 'the attacker starts on the near side');

        let minDistance = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < TICK_RATE; i++) {
            room.input('a', cmd(i, { forward: 1, heading: 0, sprint: true }));   // straight at it
            room.step();
            minDistance = Math.min(minDistance, Math.hypot(p.x - blocker.x, p.y - blocker.y));
            maxX = Math.max(maxX, p.x);
        }
        assert.ok(minDistance >= combined - 0.75,
            `blocker ${index}: the player entered the collider (${minDistance.toFixed(2)} < ${combined})`);
        assert.ok(maxX < blocker.x,
            `blocker ${index}: the player reached the far side (maxX=${maxX.toFixed(1)}, blocker.x=${blocker.x})`);
    }
});

// ---------------------------------------------------------------------------
// 4. Sequence replay
// ---------------------------------------------------------------------------

// THREAT: capture one valid frame and replay it — the classic way to re-apply a favourable
// command. The room keeps the last accepted sequence per player and refuses anything not
// strictly greater (server/simulation.mjs:244), so a replay is a no-op even when the payload
// differs.
test('anticheat: a replayed or older sequence number is refused and not applied', () => {
    const room = quietRoom(['a']);
    const p = room.players.get('a');

    // A moving frame is accepted and IS applied: this is the control, so "refused" below is
    // not just "input never works".
    assert.equal(room.input('a', cmd(5, { forward: 1, heading: 0 })), true);
    assert.equal(p.sequence, 5);
    for (let i = 0; i < 10; i++) room.step();
    assert.ok(p.x > 280, 'the accepted frame moved the player');

    // The replay: same sequence, a NEW payload (a zeroed movement frame). If the guard were
    // missing this would be indistinguishable from fresh input, so the changed payload is the
    // whole attack.
    assert.equal(room.input('a', cmd(5, { forward: 0, right: 0, heading: 0 })), false,
        'the same sequence twice is refused');
    assert.equal(p.input.forward, 1, 'the replayed frame did not overwrite held intent');
    assert.equal(p.sequence, 5, 'the sequence did not advance');

    // A lower sequence (an old captured frame) is refused too.
    assert.equal(room.input('a', cmd(0, { forward: 1, heading: 0 })), false);
    assert.equal(room.input('a', cmd(-1, { forward: 1, heading: 0 })), false);
    assert.equal(p.sequence, 5, 'a lower sequence never rewinds the cursor');

    // Non-integer / unsafe / missing sequences are not a way around the cursor.
    assert.equal(room.input('a', cmd(5.5, { forward: 1 })), false);
    assert.equal(room.input('a', cmd(2 ** 53, { forward: 1 })), false);
    assert.equal(room.input('a', { version: 2, forward: 1, right: 0, heading: 0, sprint: false }), false);

    // The rejected replay left the player under the ORIGINAL held intent only.
    const before = p.x;
    for (let i = 0; i < 5; i++) room.step();
    assert.ok(p.x > before, 'the player keeps moving on the accepted frame, not the replay');
});

// ---------------------------------------------------------------------------
// 5. Firing while dead / after the raid is over
// ---------------------------------------------------------------------------

// THREAT: keep the trigger held after dying (or after the raid is settled) and farm kills,
// noise or events from a corpse. The room skips dead bodies in step() AND stepFiring(), and
// input() itself is closed once the raid ends — so this is proven by looking for new
// projectiles/events, not by trusting a boolean.
test('anticheat: a dead player and a finished raid spawn no projectiles', () => {
    const room = quietRoom(['a', 'b']);
    const a = room.players.get('a');
    const b = room.players.get('b');
    a.x = 200; a.y = 200;                    // away from the spawn crowd, weapons still fire

    // Control: while alive, a held trigger produces shots.
    assert.equal(room.input('a', cmd(0, { forward: 0, heading: 0, fire: true })), true);
    for (let i = 0; i < 3; i++) room.step();
    assert.ok(fireEventsFor(room, 'a').length > 0, 'the harness can observe a live shot');

    // Death. `b` stays alive so the room itself remains active: this isolates "dead players
    // cannot shoot" from "the raid is over".
    assert.equal(room.surrender('a').ok, true);
    assert.equal(a.hp, 0);
    assert.equal(room.state, 'active');
    const afterDeath = fireEventsFor(room, 'a').length;

    room.input('a', cmd(1, { forward: 0, heading: 0, fire: true }));   // intent may be accepted...
    for (let i = 0; i < TICK_RATE; i++) room.step();
    assert.equal(fireEventsFor(room, 'a').length, afterDeath, 'a corpse fired no projectile');

    // A dead body must not loot either: standing on a drive changes nothing (stepObjectives
    // skips hp <= 0 at server/simulation.mjs:379-380).
    const drive = room.map.drives[0];
    const collected = room.collectedDrives;
    a.x = drive.x; a.y = drive.y;
    for (let i = 0; i < 10; i++) room.step();
    assert.equal(room.collectedDrives, collected, 'a corpse cannot collect drives');

    // Raid over: input() is shut and the simulation is frozen, so nothing at all is created.
    const outcome = room.endRaid(true, 'extraction');
    const beforeEnd = fireEventsFor(room, 'a').length + fireEventsFor(room, 'b').length;
    const projectilesAtEnd = room.projectiles.size;
    // b's cursor is untouched (-1), so sequence 0 would be legal if the raid were open: this
    // proves the refusal comes from the raid state, not from the cursor.
    assert.equal(room.input('a', cmd(2, { forward: 1, heading: 0, fire: true })), false,
        'a finished raid accepts no intent');
    assert.equal(room.input('b', cmd(0, { forward: 1, heading: 0, fire: true })), false);
    for (let i = 0; i < TICK_RATE; i++) room.step();
    assert.equal(fireEventsFor(room, 'a').length + fireEventsFor(room, 'b').length, beforeEnd,
        'no shots are spawned after the raid ends');
    assert.equal(room.projectiles.size, projectilesAtEnd, 'the projectile set is frozen');
    assert.equal(room.outcome, outcome, 'the first outcome is never overwritten');
});

// ---------------------------------------------------------------------------
// 6. Objective fabrication
// ---------------------------------------------------------------------------

// THREAT: call the transport from across the map, or surrender a body that does not exist,
// and hope the server trusts the request. Range, availability and player existence are all
// resolved from server state (server/simulation.mjs:439-470).
test('anticheat: extraction needs range and the unlock; unknown players cannot act', () => {
    const room = quietRoom(['a']);
    const p = room.players.get('a');

    assert.deepEqual(room.requestExtraction('a'), { ok: false, error: 'not-available' },
        'the beacon is locked before the drives are in');

    // Collect the real drives from the map so the beacon unlocks, then call from a drive on the
    // far side of the map while the zone sits at (3680,520): a different map corner.
    for (const drive of room.map.drives) { p.x = drive.x; p.y = drive.y; room.step(); }
    assert.equal(room.extractionState, 'available');
    assert.ok(Math.hypot(p.x - room.map.extraction.x, p.y - room.map.extraction.y) > room.map.extraction.radius,
        'the attacker is genuinely outside the zone');
    assert.deepEqual(room.requestExtraction('a'), { ok: false, error: 'out-of-range' },
        'a claimed extraction from across the map is refused');
    assert.equal(room.extractionState, 'available', 'a refused call does not advance the beacon');

    // A player who is not in the room cannot be surrendered or extracted into existence.
    assert.deepEqual(room.surrender('ghost'), { ok: false, error: 'no-player' });
    assert.deepEqual(room.requestExtraction('ghost'), { ok: false, error: 'no-player' });
    assert.equal(room.casualties.has('ghost'), false, 'no phantom casualty is recorded');

    // A finished raid refuses both actions as well.
    room.endRaid(false, 'barrage');
    assert.equal(room.surrender('a').error, 'raid-over');
    assert.equal(room.requestExtraction('a').error, 'raid-over');
});

// THREAT: the HTTP route is the surface a real client uses. The route must never invent a
// raid membership: an account that never matched is not in a raid and cannot act in one
// (server/main.mjs:299-320 resolves the raid from `inRaid`, never from the body).
test('anticheat: the HTTP raid routes refuse callers with no raid', async () => {
    await withServer(async ({ api, reg }) => {
        assert.equal((await api('/raid/surrender', { method: 'POST' })).status, 401, 'auth first');
        assert.equal((await api('/raid/extract', { method: 'POST' })).status, 401, 'auth first');

        const token = await reg('NoRaid');
        const extract = await api('/raid/extract', { method: 'POST', token });
        assert.equal(extract.status, 200);
        assert.deepEqual(extract.body, { ok: false, error: 'not-in-raid' },
            'an account outside a raid cannot claim an extraction');
        const surrender = await api('/raid/surrender', { method: 'POST', token });
        assert.equal(surrender.body.raid, null, 'and has no raid to surrender');
        assert.equal(surrender.body.ok, true, 'surrendering outside a raid is a loud no-op, not a crash');
    });
});

// ---------------------------------------------------------------------------
// 7. Payout forgery
// ---------------------------------------------------------------------------

// THREAT: POST a finished-raid result and mint credits. At the time of writing, server/main.mjs
// registers NO route that awards credits or stats, and the settlement primitive
// (AccountStore.applyRaidResult, server/accounts.mjs:189) is reachable only from server code —
// it is not on the HTTP router and not exported through server.arc. This test therefore proves
// the two things that ARE true today: no client-facing settlement route exists, and forged
// fields on /input move no money. It does NOT invent a result endpoint — see the report.
test('anticheat: no HTTP route settles a raid, and /input cannot move credits', async () => {
    await withServer(async ({ api, reg, server }) => {
        const token = await reg('PayoutProbe');

        // No route accepts a declared result, under the names a client would guess.
        for (const path of ['/raid/result', '/raid/finish', '/raid/settle', '/result', '/progression/result', '/raid/payout']) {
            const res = await api(path, {
                method: 'POST', token,
                body: { raidId: 'forged-raid', won: true, extracted: true, kills: 9999, credits: 999999, value: 999999 },
            });
            assert.equal(res.status, 404, `${path} must not exist as a settlement route`);
        }

        // Forged score fields on the genuine ingress do not reach the wallet either.
        await api('/input', {
            method: 'POST', token,
            body: cmd(0, { kills: 999, credits: 999999, value: 999999, stats: { kills: 999 } }),
        });
        const account = (await api('/account', { token })).body.account;
        assert.equal(account.credits, 0, 'credits are unmoved by a forged frame');
        assert.deepEqual(account.stats, { raids: 0, extractions: 0, kills: 0, deaths: 0 });

        // The settlement primitive is server-side only: no client-reachable handle exists.
        assert.equal(typeof server.arc.applyRaidResult, 'undefined',
            'the store is not exposed as a callable route for clients');
    });
});

// THREAT: if/when a settlement endpoint is wired to AccountStore.applyRaidResult
// (server/accounts.mjs:181-221, the "exactly once per raidId" ledger), the replay half of the
// threat must already hold. This pins the primitive's contract so the transport work cannot
// silently regress it. It is deliberately NOT a client test: the caller here is the server.
test('anticheat: the settlement primitive pays each raidId exactly once (replay guard)', async () => {
    await withServer(async ({ reg, server }) => {
        await reg('ReplayGuard');
        const account = server.arc.accounts.byName_('ReplayGuard');
        const settle = (result) => server.arc.accounts.applyRaidResult(account.id, result);

        const first = settle({ raidId: 'raid-once', extracted: true, kills: 2, deaths: 0, value: 400 });
        assert.equal(first.ok, true);
        assert.equal(first.duplicate, false);
        assert.equal(account.credits, 400);

        // The replay: same raidId, and a LARGER value than the original — the shape that would
        // be worth double-claiming.
        const replay = settle({ raidId: 'raid-once', extracted: true, kills: 2, deaths: 0, value: 999999 });
        assert.equal(replay.ok, true);
        assert.equal(replay.duplicate, true, 'a replayed raidId is recognised');
        assert.equal(account.credits, 400, 'a replay does not pay twice, even with a bigger value');
        assert.equal(account.stats.raids, 1, 'a replay does not inflate the career');

        // A genuinely new raid still settles.
        settle({ raidId: 'raid-two', extracted: true, kills: 3, deaths: 0, value: 300 });
        assert.equal(account.credits, 700);
        assert.equal(account.stats.raids, 2);

        // Absurd values are clamped, not banked (server/progression.mjs:35,57).
        settle({ raidId: 'raid-three', kills: 1e9, deaths: -5, value: 1e12 });
        assert.ok(Number.isFinite(account.credits), 'credits stay a finite number');
        assert.ok(account.credits <= 2 * 1000000 + 700, `credits stayed bounded, got ${account.credits}`);
        assert.ok(account.stats.kills >= 0 && Number.isFinite(account.stats.kills));
    });
});

// ---------------------------------------------------------------------------
// 8. Protocol version and malformed input
// ---------------------------------------------------------------------------

// THREAT: crash the room or poison its state with a frame the parser did not anticipate — a
// stale protocol version, a non-object command, a string axis, a null heading, a posture that
// does not exist. The response proves the server neither accepted nor broke.
test('anticheat: malformed HTTP input is rejected without corrupting the room', async () => {
    await withServer(async ({ api, reg }) => {
        const token = await reg('MalformedHttp');
        const accountId = (await api('/account', { token })).body.account.id;
        const start = (await api('/snapshot', { token })).body;
        const startMe = start.players.find(p => p.id === accountId);
        assert.ok(startMe, 'the attacker is in the lobby room');

        const attacks = [
            ['wrong version', cmd(0, { version: 99 })],
            ['missing version', { sequence: 1, forward: 0, right: 0, heading: 0, sprint: false }],
            ['string command', 'abc'],
            ['number command', 5],
            ['array command', [1, 2, 3]],
            ['string axis', cmd(2, { forward: 'abc' })],
            ['object axis', cmd(3, { right: {} })],
            ['infinite axis', cmd(4, { forward: Infinity })],
            ['null heading', cmd(5, { heading: null })],          // JSON has no NaN: null is the wire form
            ['out-of-range heading', cmd(6, { heading: 4 })],
            ['out-of-range pitch', cmd(7, { pitch: 2 })],
            ['unknown posture', cmd(8, { posture: 'flying' })],
            ['numeric sprint', cmd(9, { sprint: 1 })],
            ['numeric fire', cmd(10, { fire: 1 })],
            ['out-of-range lean', cmd(11, { lean: 5 })],
            ['fractional sequence', cmd(12.5)],
        ];
        for (const [label, body] of attacks) {
            const res = await api('/input', { method: 'POST', token, body });
            assert.equal(res.status, 400, `${label} must be refused`);
            assert.equal(res.body.error, 'invalid-input', `${label} gets the stable error code`);
        }
        // A null body and a syntactically broken body are refused before the rules see them.
        assert.equal((await api('/input', { method: 'POST', token, body: null })).status, 400);
        const broken = await api('/input', { method: 'POST', token, raw: '{not json' });
        assert.equal(broken.status, 400);
        assert.equal(broken.body.error, 'invalid-json');

        // The room survived: it still steps, the player is where the server put them, at full HP.
        const after = (await api('/snapshot', { token })).body;
        assert.ok(after.tick >= start.tick, 'the clock still advances');
        const me = after.players.find(p => p.id === accountId);
        assert.ok(me, 'the attacker is still in the world');
        assert.equal(me.hp, PLAYER_HP, 'HP is intact after the malformed burst');
        assert.equal(me.sequence, startMe.sequence, 'no malformed frame advanced the input cursor');
        assert.ok(me.x >= 50 && me.x <= REFERENCE.width - 50, 'position stayed sane');
        assert.ok(me.y >= 50 && me.y <= REFERENCE.height - 50, 'position stayed sane');

        // A valid frame still works afterwards: "rejected" did not degrade into "dead".
        assert.equal((await api('/input', { method: 'POST', token, body: cmd(100) })).status, 200);
        assert.equal((await api('/health')).status, 200);
    });
});

// THREAT: the same malformed frames over the WebSocket, the transport that skips the HTTP
// layer and the one a game client actually uses. The socket must report each rejection as
// `inputRejected` (server/main.mjs:535), stay open, and keep serving valid intent.
test('anticheat: malformed WebSocket commands are reported and the socket survives', async () => {
    await withServer(async ({ wsUrl, api, reg }) => {
        const token = await reg('MalformedWs');
        const id = (await api('/account', { token })).body.account.id;
        const client = await connect(wsUrl);
        client.send({ type: 'auth', token });
        assert.ok(await waitFor(() => client.messages.some(m => m.type === 'ready')),
            'the attacker authenticates with a real token');

        const attacks = [
            { type: 'input', command: cmd(0, { version: 99 }) },
            { type: 'input', command: 'abc' },
            { type: 'input', command: 5 },
            { type: 'input', command: null },
            { type: 'input', command: cmd(1, { forward: 'abc' }) },
            { type: 'input', command: cmd(2, { heading: null }) },
            { type: 'input', command: cmd(3, { posture: 'flying' }) },
            { type: 'input', command: { version: 2, sequence: 4 } },   // missing axes
        ];
        for (const attack of attacks) client.send(attack);

        assert.ok(await waitFor(() => client.messages.filter(m => m.type === 'inputRejected').length === attacks.length),
            'every malformed command is reported back as a rejection');
        assert.equal(client.closed, false, 'bad input does not close the socket');

        // A valid command after the burst is still accepted: the room was not wedged. (The
        // lobby pushes snapshots only to matched players, so ask for one explicitly; both
        // frames travel on the same socket, so the server sees the input first.)
        client.send({ type: 'input', command: cmd(500, { forward: 1, heading: 0 }) });
        client.send({ type: 'snapshot' });
        assert.ok(await waitFor(() => {
            const snaps = client.messages.filter(m => m.type === 'snapshot');
            const me = snaps.length ? snaps[snaps.length - 1].snapshot.players.find(p => p.id === id) : null;
            return !!me && me.sequence === 500;
        }), 'the valid frame after the malformed burst was accepted');
        assert.equal(client.messages.filter(m => m.type === 'inputRejected').length, attacks.length,
            'the valid frame was NOT rejected: rejections came only from the malformed burst');

        assert.equal((await api('/health')).status, 200, 'the server is still healthy');
        client.close();
    });
});
// --- regression: the anonymous-sandbox escape (found by an audit) -------------

test('anticheat: an anonymous /sessions guest can never enter a live ranked raid', async () => {
    // THREAT: `POST /sessions` needs no credentials, so if it joined the first ACTIVE RAID
    // rather than the lobby, one unauthenticated request would insert a body into a ranked
    // match — free recon, an extra gun, and the ability to stand on drives and steal the
    // squad's objective. It landed in a real raid before this guard existed.
    const server = createGameServer({ accountsDir: null });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const post = async (path, body, token) => {
            const res = await fetch(base + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            return { status: res.status, body: await res.json().catch(() => null) };
        };
        const reg = async (name) => (await post('/register', { name, password: 'secret123' })).body;
        const a = await reg('AnonGuardA');
        const b = await reg('AnonGuardB');
        await post('/match/queue', undefined, a.token);
        await post('/match/queue', undefined, b.token);
        await waitFor(() => server.arc.raids.size === 1, 3000);

        const room = [...server.arc.raids.values()][0].room;
        const before = room.players.size;
        assert.equal(before, 2, 'the ranked raid holds exactly the two matched players');

        const guest = await post('/sessions');
        assert.equal(guest.status, 201, 'the sandbox session itself still works');

        assert.equal(room.players.size, before, 'the guest must NOT be added to the ranked raid');
        const intruder = [...room.players.keys()].find(id => String(id).startsWith('guest_'));
        assert.equal(intruder, undefined, 'no guest body may exist inside a ranked raid');

        // The guest's own room is the lobby, so its sandbox still functions.
        const lobby = server.arc.lobbyRoom;
        assert.ok(lobby && lobby.players.has(guest.body.id), 'the guest belongs to the lobby');
    } finally {
        try { server.arc.wsHub.closeAll(); } catch { /* no sockets */ }
        await new Promise(r => { server.close(r); server.closeAllConnections(); });
    }
});
