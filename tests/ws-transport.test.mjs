// The WebSocket transport end to end: authenticate, stream snapshots, send intent, act.
// Uses the raw client from ws-protocol.test.mjs style so the wire format is exercised too.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import { createGameServer } from '../server/main.mjs';
import { decodeFrame, encodeClientFrame } from '../server/ws.mjs';

// A minimal WebSocket client for tests: handshake, framed JSON send/receive.
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

const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await new Promise(r => setTimeout(r, 10));
    }
    return fn();
};

async function withServer(fn) {
    const server = createGameServer({ accountsDir: null });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const wsUrl = `ws://127.0.0.1:${server.address().port}/ws`;
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
    const reg = async (name) => (await api('/register', { method: 'POST', body: { name, password: 'secret123' } })).body.token;
    try { await fn({ wsUrl, api, reg, server, base }); }
    finally {
        // Close every WebSocket FIRST: `server.close()` waits for open sockets, so a test that
        // throws before its own cleanup would otherwise hang the whole run forever.
        try { server.arc.wsHub.closeAll(); } catch { /* already gone */ }
        await new Promise(r => { server.close(r); server.closeAllConnections(); });
        // A stray keepalive timer would keep the event loop alive.
        await new Promise(r => setTimeout(r, 10));
    }
}

test('ws transport: auth is required before anything else', async () => {
    await withServer(async ({ wsUrl }) => {
        const c = await connect(wsUrl);
        // Sending intent before authenticating must be refused, not silently ignored.
        c.send({ type: 'input', command: { version: 2, sequence: 0, forward: 1, right: 0, heading: 0, sprint: false } });
        assert.ok(await waitFor(() => c.messages.some(m => m.error === 'not-authenticated')));
        // A bad token is refused too.
        c.send({ type: 'auth', token: 'nonsense' });
        assert.ok(await waitFor(() => c.messages.some(m => m.error === 'session')));
        c.close();
    });
});

test('ws transport: a good token readies the client with the world', async () => {
    await withServer(async ({ wsUrl, reg }) => {
        const token = await reg('WsReady');
        const c = await connect(wsUrl);
        c.send({ type: 'auth', token });
        assert.ok(await waitFor(() => c.messages.some(m => m.type === 'ready')), 'expected a ready message');
        const ready = c.messages.find(m => m.type === 'ready');
        assert.ok(ready.id);
        assert.equal(ready.protocol, 2);
        assert.ok(ready.world && ready.world.blockers.length > 20, 'the world comes with the handshake');
        c.close();
    });
});

test('ws transport: a queued player is matched and then receives snapshots', async () => {
    await withServer(async ({ wsUrl, api, reg }) => {
        const a = await reg('WsAlpha'), b = await reg('WsBravo');
        const ca = await connect(wsUrl), cb = await connect(wsUrl);
        ca.send({ type: 'auth', token: a });
        cb.send({ type: 'auth', token: b });
        assert.ok(await waitFor(() => ca.messages.some(m => m.type === 'ready')));
        assert.ok(await waitFor(() => cb.messages.some(m => m.type === 'ready')));

        // Queue over HTTP (the lobby path) and let the matchmaker form the raid.
        await api('/match/queue', { method: 'POST', token: a });
        await api('/match/queue', { method: 'POST', token: b });

        assert.ok(await waitFor(() => ca.messages.some(m => m.type === 'snapshot'), 5000),
            'a matched player must start receiving snapshots');
        const snap = ca.messages.filter(m => m.type === 'snapshot').pop().snapshot;
        assert.equal(snap.players.length, 2, 'the socket stream carries the whole raid');
        assert.ok(snap.enemies.length > 0);
        assert.ok(snap.objective);
        ca.close(); cb.close();
    });
});

test('ws transport: intent sent over the socket moves the player authoritatively', async () => {
    await withServer(async ({ wsUrl, api, reg, server }) => {
        const a = await reg('WsMove_A'), b = await reg('WsMove_B');
        const ca = await connect(wsUrl), cb = await connect(wsUrl);
        ca.send({ type: 'auth', token: a });
        cb.send({ type: 'auth', token: b });
        await waitFor(() => ca.messages.some(m => m.type === 'ready'));
        await waitFor(() => cb.messages.some(m => m.type === 'ready'));
        await api('/match/queue', { method: 'POST', token: a });
        await api('/match/queue', { method: 'POST', token: b });
        assert.ok(await waitFor(() => ca.messages.some(m => m.type === 'snapshot'), 5000));

        const idA = server.arc.accounts.byName_('WsMove_A').id;
        const before = server.arc.raids.size ? [...server.arc.raids.values()][0].room.players.get(idA).y : null;
        assert.ok(before != null, 'the player is in a raid');

        // Push intent straight down the socket at the protocol cadence.
        for (let i = 0; i < 8; i++) {
            ca.send({ type: 'input', command: { version: 2, sequence: i, forward: 1, right: 0, heading: -Math.PI / 2, sprint: false, fire: false, pitch: 0 } });
            await new Promise(r => setTimeout(r, 30));
        }
        assert.ok(await waitFor(() => {
            const room = [...server.arc.raids.values()][0].room;
            const p = room.players.get(idA);
            return p && Math.abs(p.y - before) > 1;
        }, 2000), 'the authoritative position must change from socket input');
        ca.close(); cb.close();
    });
});

test('ws transport: a rejected input is reported back', async () => {
    await withServer(async ({ wsUrl, api, reg }) => {
        const a = await reg('WsReject_A'), b = await reg('WsReject_B');
        const ca = await connect(wsUrl), cb = await connect(wsUrl);
        ca.send({ type: 'auth', token: a });
        cb.send({ type: 'auth', token: b });
        await waitFor(() => ca.messages.some(m => m.type === 'ready'));
        await waitFor(() => cb.messages.some(m => m.type === 'ready'));
        await api('/match/queue', { method: 'POST', token: a });
        await api('/match/queue', { method: 'POST', token: b });
        assert.ok(await waitFor(() => ca.messages.some(m => m.type === 'snapshot'), 5000));

        // A replayed sequence number must be refused and reported.
        ca.send({ type: 'input', command: { version: 2, sequence: 5, forward: 1, right: 0, heading: 0, sprint: false } });
        await new Promise(r => setTimeout(r, 50));
        ca.send({ type: 'input', command: { version: 2, sequence: 5, forward: 1, right: 0, heading: 0, sprint: false } });
        assert.ok(await waitFor(() => ca.messages.some(m => m.type === 'inputRejected')), 'a replay must be reported');
        ca.close(); cb.close();
    });
});

test('ws transport: surrender over the socket closes the raid for both players', async () => {
    await withServer(async ({ wsUrl, api, reg }) => {
        const a = await reg('WsSur_A'), b = await reg('WsSur_B');
        const ca = await connect(wsUrl), cb = await connect(wsUrl);
        ca.send({ type: 'auth', token: a });
        cb.send({ type: 'auth', token: b });
        await waitFor(() => ca.messages.some(m => m.type === 'ready'));
        await waitFor(() => cb.messages.some(m => m.type === 'ready'));
        await api('/match/queue', { method: 'POST', token: a });
        await api('/match/queue', { method: 'POST', token: b });
        assert.ok(await waitFor(() => ca.messages.some(m => m.type === 'snapshot'), 5000));

        ca.send({ type: 'surrender' });
        assert.ok(await waitFor(() => ca.messages.some(m => m.type === 'action' && m.action === 'surrender' && m.ok)));
        // ONE surrender does not end the raid: the other player is still alive in it.
        assert.ok(await waitFor(() => {
            const snaps = cb.messages.filter(m => m.type === 'snapshot');
            return snaps.some(m => m.snapshot.players.some(p => p.hp === 0));
        }, 3000), 'the surrenderer must be dead in the shared world');

        // The SECOND surrender closes the raid, and both clients read the same outcome.
        cb.send({ type: 'surrender' });
        assert.ok(await waitFor(() => {
            const snaps = cb.messages.filter(m => m.type === 'snapshot');
            return snaps.some(m => m.snapshot.state === 'ended');
        }, 4000), 'the raid must end once nobody is left');
        const finalB = cb.messages.filter(m => m.type === 'snapshot').pop().snapshot;
        assert.equal(finalB.outcome.won, false);
        assert.equal(finalB.outcome.reason, 'surrender');
        const finalA = ca.messages.filter(m => m.type === 'snapshot').pop().snapshot;
        assert.equal(finalA.state, 'ended', 'the first player also sees the raid end');
        ca.close(); cb.close();
    });
});

test('ws transport: a second connection for the same player supersedes the first', async () => {
    await withServer(async ({ wsUrl, reg }) => {
        const token = await reg('WsDup');
        const first = await connect(wsUrl);
        first.send({ type: 'auth', token });
        await waitFor(() => first.messages.some(m => m.type === 'ready'));
        const second = await connect(wsUrl);
        second.send({ type: 'auth', token });
        await waitFor(() => second.messages.some(m => m.type === 'ready'));
        // One live socket per player: no double simulation of the same body.
        assert.ok(await waitFor(() => first.closed), 'the older socket must be closed');
        second.close();
    });
});

test('ws transport: a disconnecting socket frees the player but keeps the body for grace', async () => {
    await withServer(async ({ wsUrl, api, reg, server }) => {
        const a = await reg('WsDrop_A'), b = await reg('WsDrop_B');
        const ca = await connect(wsUrl), cb = await connect(wsUrl);
        ca.send({ type: 'auth', token: a });
        cb.send({ type: 'auth', token: b });
        await waitFor(() => ca.messages.some(m => m.type === 'ready'));
        await waitFor(() => cb.messages.some(m => m.type === 'ready'));
        await api('/match/queue', { method: 'POST', token: a });
        await api('/match/queue', { method: 'POST', token: b });
        assert.ok(await waitFor(() => ca.messages.some(m => m.type === 'snapshot'), 5000));

        const room = [...server.arc.raids.values()][0].room;
        const idA = server.arc.accounts.byName_('WsDrop_A').id;
        ca.close();
        // After the socket closes the player is marked dropped, not deleted.
        assert.ok(await waitFor(() => {
            const p = room.players.get(idA);
            return p && p.disconnected === true;
        }, 3000), 'a dropped socket must keep the body for the grace window');
        assert.equal(room.players.has(idA), true);
        cb.close();
    });
});

test('ws transport: HTTP still works alongside WebSocket on the same server', async () => {
    await withServer(async ({ wsUrl, api, reg }) => {
        const token = await reg('WsBoth');
        // HTTP path unaffected.
        assert.equal((await api('/health')).status, 200);
        assert.equal((await api('/party', { token })).status, 200);
        // And the socket path works on the same process.
        const c = await connect(wsUrl);
        c.send({ type: 'auth', token });
        assert.ok(await waitFor(() => c.messages.some(m => m.type === 'ready')));
        c.close();
    });
});