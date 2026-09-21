// Online visibility: with the REAL server running, one player's actions must be visible to
// the other player. These tests deliberately go through the transports (HTTP polling and the
// /ws push) instead of calling RaidRoom directly, because "visible to another player" is a
// property of the wire contract, not of the room in isolation.
//
// They also stay honest about the simulation: a shot fired at point-blank range resolves in
// the same tick it was fired, so projectiles are asserted in a direction with open ground and
// over a window of snapshots rather than from a single poll.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import { createGameServer } from '../server/main.mjs';
import { decodeFrame, encodeClientFrame } from '../server/ws.mjs';

// --- shared helpers ----------------------------------------------------------

// A minimal raw WebSocket client: handshake plus framed JSON send/receive. Copied from
// tests/ws-transport.test.mjs so this file proves the wire format itself, not a wrapper.
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

// Poll instead of sleeping a fixed amount: a bare long sleep is both slow and flaky.
const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await new Promise(r => setTimeout(r, 10));
    }
    return fn();
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The async twin of waitFor, for predicates that must take a round trip (read a snapshot).
const waitForAsync = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    let last = false;
    do {
        last = await fn();
        if (last) return true;
        await sleep(10);
    } while (Date.now() < deadline);
    return last;
};
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// A well-formed intent. `sequence` is per player and must strictly increase, or the room
// rejects the command (which is what stops a replay from re-firing a weapon).
const cmd = (sequence, extra = {}) =>
    ({ version: 2, sequence, forward: 0, right: 0, heading: 0, sprint: false, fire: false, pitch: 0, ...extra });

async function withServer(fn) {
    const server = createGameServer({ accountsDir: null, seed: 7419 });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}/ws`;
    const api = async (path, { method = 'GET', token, body } = {}) => {
        const res = await fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        let json = null;
        try { json = await res.json(); } catch { /* empty */ }
        return { status: res.status, body: json };
    };
    const reg = async (name) => {
        const r = await api('/register', { method: 'POST', body: { name, password: 'secret123' } });
        assert.equal(r.status, 201, `register ${name}: ${JSON.stringify(r.body)}`);
        return { token: r.body.token, id: r.body.account.id };
    };
    try { await fn({ server, base, wsUrl, api, reg }); }
    finally {
        // Close every WebSocket FIRST: `server.close()` waits for open sockets, so a leaked
        // socket would hang the whole run instead of failing this one test.
        try { server.arc.wsHub.closeAll(); } catch { /* already gone */ }
        await new Promise(r => { server.close(r); server.closeAllConnections(); });
        // A stray keepalive timer would keep the event loop alive.
        await sleep(10);
    }
}

// Queue two authenticated players and wait for the tick loop to form their raid. Returns the
// room plus the raid id, which is how far a real client can reach into server state.
async function matchTwo({ server, api }, a, b) {
    assert.equal((await api('/match/queue', { method: 'POST', token: a.token })).status, 200);
    assert.equal((await api('/match/queue', { method: 'POST', token: b.token })).status, 200);
    const formed = await waitFor(() => server.arc.raids.size === 1, 5000);
    assert.ok(formed, 'two queued players must be matched into one raid');
    return { room: [...server.arc.raids.values()][0].room, raidId: [...server.arc.raids.keys()][0] };
}

const snapshotOf = async (api, token) => {
    const r = await api('/snapshot', { token });
    assert.equal(r.status, 200, 'a matched player must be able to read the raid: ' + JSON.stringify(r.body));
    return r.body;
};

const peerOf = (snapshot, id) => snapshot.players.find(p => p.id === id);

// The latest pushed snapshot on a raw socket, or null before the first push arrives.
function lastPushed(client) {
    for (let i = client.messages.length - 1; i >= 0; i--) {
        const m = client.messages[i];
        if (m.type === 'snapshot' && m.snapshot) return m.snapshot;
    }
    return null;
}

const sawShot = (client, shooterId) => client.messages
    .filter(m => m.type === 'snapshot' && m.snapshot)
    .some(m => m.snapshot.projectiles.some(p => p.shooterId === shooterId));

// ---------------------------------------------------------------------------
// 1. Players see each other, and one player's move is visible to the other.
// ---------------------------------------------------------------------------

test('visibility: two matched players see each other and B observes A moving', async () => {
    await withServer(async (ctx) => {
        const { api } = ctx;
        const a = await ctx.reg('Vis_Alpha'), b = await ctx.reg('Vis_Bravo');
        await matchTwo(ctx, a, b);

        // Both clients read the same room. Cross-checking A's view of B against B's view of
        // itself is what proves they share one world instead of two coincidentally similar ones.
        const snapA = await snapshotOf(api, a.token);
        const snapB = await snapshotOf(api, b.token);
        assert.equal(snapA.players.length, 2, 'A must see both players');
        assert.equal(snapB.players.length, 2, 'B must see both players');
        assert.notEqual(a.id, b.id, 'the two players must have distinct ids');

        const aFromA = peerOf(snapA, a.id), bFromA = peerOf(snapA, b.id);
        const bFromB = peerOf(snapB, b.id), aFromB = peerOf(snapB, a.id);
        assert.ok(aFromA && bFromA && bFromB && aFromB, 'each client must list both players by id');
        for (const p of [aFromA, bFromA, bFromB, aFromB]) {
            assert.ok(finite(p.x) && finite(p.y) && finite(p.heading),
                'every peer must arrive with a real position and heading, or it cannot be drawn');
        }
        assert.ok(Math.hypot(aFromA.x - bFromB.x, aFromA.y - bFromB.y) > 1, 'players spawn at distinct positions');
        // Cross-check BOTH players across the two independently fetched snapshots. If A's view
        // of B disagreed with B's own view (or vice versa), the two clients would be rendering
        // two different worlds while each believing it shares one.
        assert.ok(Math.abs(aFromA.x - aFromB.x) < 0.001 && Math.abs(aFromA.y - aFromB.y) < 0.001,
            "A must sit at the same place in A's own snapshot and in B's snapshot");
        assert.ok(Math.abs(bFromA.x - bFromB.x) < 0.001 && Math.abs(bFromA.y - bFromB.y) < 0.001,
            "B must sit at the same place in A's snapshot and in B's own snapshot");

        // A walks. The heading is visible state too: B has to be able to face the direction A
        // is actually looking, not a client-local guess.
        const startA = { x: aFromB.x, y: aFromB.y, heading: aFromB.heading };
        assert.ok(Math.abs(startA.heading - 1.0) > 0.1, 'A must start facing somewhere else for the change to be meaningful');
        for (let i = 0; i < 8; i++) {
            const r = await api('/input', { method: 'POST', token: a.token, body: cmd(i, { forward: 1, heading: 1.0 }) });
            assert.equal(r.status, 200, 'a well-formed intent must be accepted');
            await sleep(25);
        }

        const afterB = await snapshotOf(api, b.token);
        const seenA = peerOf(afterB, a.id);
        assert.ok(Math.hypot(seenA.x - startA.x, seenA.y - startA.y) > 5,
            'A must have actually moved, or B observing it would prove nothing');
        assert.ok(Math.abs(seenA.heading - 1.0) < 0.01, 'B must see the heading A is sending');
        // Only A sent input, so B holding still isolates the visible change to A.
        const stillB = peerOf(afterB, b.id);
        assert.ok(Math.abs(stillB.x - bFromB.x) < 0.001 && Math.abs(stillB.y - bFromB.y) < 0.001,
            'the peer that sent no input must not move');
        assert.ok(seenA.x > startA.x && seenA.y > startA.y,
            'heading 1.0 points along +x/+y, so the visible delta must be in that direction');
    });
});

// ---------------------------------------------------------------------------
// 2. Shots are broadcast to the other player, then leave the world.
// ---------------------------------------------------------------------------

test('visibility: A firing appears in B snapshot with a finite trajectory, then disappears', async () => {
    await withServer(async (ctx) => {
        const { api } = ctx;
        const a = await ctx.reg('Shot_Alpha'), b = await ctx.reg('Shot_Bravo');
        const { room } = await matchTwo(ctx, a, b);

        // South of the spawn is open ground; a shot fired across the spawn line reaches a
        // neighbour or a blocker in the very tick it is fired and would never be observable
        // in any snapshot at all, which is what a naive "fire and poll once" test measures.
        const DOWN = Math.PI / 2;
        const observed = new Map();   // projId -> what B saw, plus the tick it was first seen
        let sequence = 0;
        for (let i = 0; i < 24 && observed.size < 2; i++) {
            const r = await api('/input', { method: 'POST', token: a.token, body: cmd(sequence++, { heading: DOWN, fire: true }) });
            assert.equal(r.status, 200, 'a fire intent must be accepted');
            const snapB = await snapshotOf(api, b.token);
            for (const proj of snapB.projectiles) {
                if (proj.shooterId !== a.id) continue;
                const rec = observed.get(proj.id) ||
                    { shooterId: proj.shooterId, firstTick: snapB.tick, samples: 0, x: proj.x, y: proj.y, h: proj.h, vx: proj.vx, vy: proj.vy, vh: proj.vh };
                rec.samples++;
                observed.set(proj.id, rec);
            }
            await sleep(12);
        }

        assert.ok(observed.size > 0, "B must receive A's projectile, not only be told that a shot happened");
        for (const [id, rec] of observed) {
            assert.equal(rec.shooterId, a.id, 'the projectile must be attributed to the player who fired it');
            // A projectile without a finite position or velocity cannot be rendered, and would
            // be a NaN leak from the simulation straight into every client.
            for (const [key, value] of Object.entries({ x: rec.x, y: rec.y, h: rec.h, vx: rec.vx, vy: rec.vy, vh: rec.vh })) {
                assert.ok(finite(value), `${id}.${key} must be finite, got ${value}`);
            }
            assert.ok(Math.hypot(rec.vx, rec.vy, rec.vh) > 100,
                'a bullet must travel at a real speed, not drift');
        }
        // Shots fly south, so the velocity has to agree with the heading A reported.
        const [firstRec] = observed.values();
        assert.ok(firstRec.vy > 1000 && Math.abs(firstRec.vx) < 1,
            'heading pi/2 must produce a +y velocity: the visible path must match the intent');
        assert.ok(firstRec.x > 50 && firstRec.x < 400, 'the shot must start from A, not from the map origin');

        // And the shot leaves the world: it either hits something or expires on range/time.
        // A bullet that never vanished would be a permanent render artifact in B's world.
        const ids = [...observed.keys()];
        const cleared = await waitForAsync(() => {
            const snap = room.snapshot();
            return ids.every(id => !snap.projectiles.some(p => p.id === id));
        }, 5000);
        assert.ok(cleared, 'every observed shot must leave the projectile list again');
    });
});

// ---------------------------------------------------------------------------
// 3. Movement is authoritative: both clients agree on where A is.
// ---------------------------------------------------------------------------

test('visibility: forward input moves A along its heading and both clients agree on A', async () => {
    await withServer(async (ctx) => {
        const { api } = ctx;
        const a = await ctx.reg('Move_Alpha'), b = await ctx.reg('Move_Bravo');
        await matchTwo(ctx, a, b);

        const start = peerOf(await snapshotOf(api, b.token), a.id);
        assert.ok(start.x > 50 && start.x < 400, 'the raid spawn is the baseline for this measurement');

        // Forward input for long enough to cross map units, not a float epsilon.
        const HEADING = 1.0;
        for (let i = 0; i < 12; i++) {
            await api('/input', { method: 'POST', token: a.token, body: cmd(i, { forward: 1, heading: HEADING }) });
            await sleep(30);
        }

        // Read A's own view while it is still walking: the displacement to check is what the
        // server actually simulated.
        const aOwn = peerOf(await snapshotOf(api, a.token), a.id);
        const dx = aOwn.x - start.x, dy = aOwn.y - start.y;
        const distance = Math.hypot(dx, dy);
        assert.ok(distance > 5, 'forward input must move the authoritative body');

        // The server, not the client, decides the displacement: it must follow the reported
        // heading. A client-local guess would not land on the heading vector.
        const expected = { x: Math.cos(HEADING), y: Math.sin(HEADING) };
        const unit = { x: dx / distance, y: dy / distance };
        assert.ok(unit.x * expected.x + unit.y * expected.y > 0.999,
            'the visible displacement must follow the heading, not a client guess');
        assert.ok(Math.abs(dx) > 5 && Math.abs(dy) > 5, 'an angled heading must move both axes');

        // Both clients must agree on where A IS. B's snapshot and A's own snapshot are fetched
        // in two separate round trips, so while A is walking they legitimately differ by up to
        // one tick of travel. Stop A first (a zero-axis intent is applied on the next tick, so
        // there is no momentum to wait out), then compare: at rest the two views must coincide,
        // because a disagreement here is the classic "you were never there" desync.
        await api('/input', { method: 'POST', token: a.token, body: cmd(12, { forward: 0, heading: HEADING }) });
        const beforeStop = peerOf(await snapshotOf(api, a.token), a.id);
        const stopped = peerOf(await snapshotOf(api, a.token), a.id);
        assert.ok(Math.hypot(stopped.x - beforeStop.x, stopped.y - beforeStop.y) < 0.5,
            'a zero-axis intent must actually halt the authoritative body');

        const [fromA, fromB] = await Promise.all([
            snapshotOf(api, a.token),
            snapshotOf(api, b.token),
        ]);
        const finalA = peerOf(fromA, a.id), finalB = peerOf(fromB, a.id);
        const skew = Math.hypot(finalA.x - finalB.x, finalA.y - finalB.y);
        // At rest the only admissible difference is one tick of travel; the real skew is zero.
        const perTick = 260 / 60;   // GAME_PLAYER_SPEED at TICK_RATE
        assert.ok(skew < perTick, `A's two views must agree within one tick of travel, skew was ${skew}`);
        assert.ok(Math.abs(finalA.heading - finalB.heading) < 0.01, 'both clients must agree on the heading too');
        assert.ok(Math.hypot(finalB.x - start.x, finalB.y - start.y) > 5,
            'B must see the accumulated movement, not only A itself');
    });
});

// ---------------------------------------------------------------------------
// 4. The WebSocket push carries the same peer and projectile facts.
// ---------------------------------------------------------------------------

test('visibility: the /ws push delivers the peer and the shot to the other player', async () => {
    await withServer(async (ctx) => {
        const { api, wsUrl } = ctx;
        const a = await ctx.reg('Ws_Alpha'), b = await ctx.reg('Ws_Bravo');

        const ca = await connect(wsUrl), cb = await connect(wsUrl);
        try {
            ca.send({ type: 'auth', token: a.token });
            cb.send({ type: 'auth', token: b.token });
            assert.ok(await waitFor(() => ca.messages.some(m => m.type === 'ready')), 'A must authenticate over the socket');
            assert.ok(await waitFor(() => cb.messages.some(m => m.type === 'ready')), 'B must authenticate over the socket');

            // Queue over HTTP (the lobby path); the push then streams the raid to both.
            await matchTwo(ctx, a, b);
            assert.ok(await waitFor(() => lastPushed(cb) !== null, 5000), 'a matched socket must start receiving snapshots');

            // The pushed snapshot is produced on the simulation tick, so it must already carry
            // both peers: a client that only learns about peers by polling would be blind.
            assert.ok(await waitFor(() => {
                const snap = lastPushed(cb);
                return !!snap && snap.players.length === 2 && snap.players.some(p => p.id === a.id) && snap.players.some(p => p.id === b.id);
            }, 3000), 'the pushed snapshot must list both players');

            const paused = await snapshotOf(api, b.token);   // the HTTP view of the same raid
            const pushedPeer = peerOf(lastPushed(cb), a.id);
            assert.ok(pushedPeer, 'the pushed snapshot must carry the peer by id');
            assert.ok(finite(pushedPeer.x) && finite(pushedPeer.y) && finite(pushedPeer.heading),
                'a pushed peer must be renderable, not a placeholder');
            // The push and the poll go through the same room, so the two transports must agree
            // on where the peer is. If they disagreed, a client would teleport on every reply.
            assert.ok(Math.abs(pushedPeer.x - peerOf(paused, a.id).x) < 1,
                'the pushed and polled views of the same peer must agree');

            // A fires down open ground; every push from that moment is inspected, because a
            // shot exists for only a few ticks and one poll can miss it between reshapes.
            const DOWN = Math.PI / 2;
            let sequence = 0;
            const pushedShot = await waitFor(() => {
                if (sawShot(cb, a.id)) return true;
                ca.send({ type: 'input', command: cmd(sequence++, { heading: DOWN, fire: true }) });
                return false;
            }, 5000);
            assert.ok(pushedShot, "B's pushed stream must carry A's projectile");

            const shot = cb.messages
                .filter(m => m.type === 'snapshot' && m.snapshot)
                .flatMap(m => m.snapshot.projectiles)
                .find(p => p.shooterId === a.id);
            assert.ok(shot, 'the projectile must be attributable to A');
            for (const [key, value] of Object.entries({ x: shot.x, y: shot.y, h: shot.h, vx: shot.vx, vy: shot.vy, vh: shot.vh })) {
                assert.ok(finite(value), `pushed projectile ${key} must be finite, got ${value}`);
            }
            assert.ok(Math.hypot(shot.vx, shot.vy, shot.vh) > 100, 'the pushed bullet must have a real trajectory');
            assert.ok(shot.vy > 1000, 'the pushed trajectory must match the heading A sent');
            assert.ok(paused.players.length === 2, 'the HTTP view and the push describe the same raid');
        } finally {
            ca.close();
            cb.close();
        }
    });
});

// ---------------------------------------------------------------------------
// 5. A disconnected peer is flagged, then reaped — never silently dropped.
// ---------------------------------------------------------------------------

test('visibility: a disconnected peer is flagged in the other snapshot, then reaped', async () => {
    await withServer(async (ctx) => {
        const { api, server } = ctx;
        const a = await ctx.reg('Drop_Alpha'), b = await ctx.reg('Drop_Bravo');
        const { room } = await matchTwo(ctx, a, b);
        assert.equal(room.players.size, 2, 'both players start in the room');

        // The transport marks a dropped player instead of deleting them: a network blink must
        // not cost gear, and the remaining player must still see the body to shoot at.
        server.arc.leaveEverything(a.id, { nowMs: Date.now() });

        const snapB = await snapshotOf(api, b.token);
        const ghost = peerOf(snapB, a.id);
        assert.ok(ghost, 'the dropped body must still be in the snapshot during the grace window');
        assert.equal(ghost.disconnected, true, 'the remaining player must be told the peer is gone, not guess it');
        assert.ok(snapB.disconnected.includes(a.id), 'the snapshot must expose the grace list for the lobby UI');
        assert.equal(peerOf(snapB, b.id).disconnected, false, 'the connected player must not be flagged');
        assert.equal(room.players.has(a.id), true, 'flagged bodies stay in the room, they are not silently removed');

        // A dropped player is inert: their body must not keep walking on stale input.
        await api('/input', { method: 'POST', token: b.token, body: cmd(0, { forward: 1, heading: 0 }) });
        const frozen = { x: ghost.x, y: ghost.y };
        await sleep(80);
        const stillThere = peerOf(await snapshotOf(api, b.token), a.id);
        assert.ok(Math.abs(stillThere.x - frozen.x) < 0.001 && Math.abs(stillThere.y - frozen.y) < 0.001,
            'a disconnected body must not move');

        // Past the grace window the body is reaped for good, and B sees it disappear.
        const evicted = room.reapDisconnected(Date.now() + 10 * 60 * 1000);
        assert.deepEqual(evicted, [a.id], 'reaping past the grace window must return the evicted id');
        assert.equal(room.players.has(a.id), false, 'the body is gone from the authoritative room');
        const finalB = await snapshotOf(api, b.token);
        assert.equal(finalB.players.length, 1, 'B must stop seeing the reaped peer');
        assert.equal(peerOf(finalB, a.id), undefined, 'the reaped peer must be absent from the snapshot');
        assert.equal(peerOf(finalB, b.id).id, b.id, 'the surviving player keeps their own body');
    });
});