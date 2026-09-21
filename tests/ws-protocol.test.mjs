// WebSocket protocol (server/ws.mjs). The transport is hand-written, so its wire format is
// the riskiest code in the project: these tests pin the handshake, masking, framing,
// fragmentation, keepalive and backpressure against the RFC.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import {
    attachWebSocket, decodeFrame, encodeFrame, encodeClientFrame, unmask, acceptKey, isUpgrade,
} from '../server/ws.mjs';

// --- pure codec --------------------------------------------------------------

test('ws: the handshake accept value matches RFC 6455', () => {
    // The worked example from the RFC.
    assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('ws: upgrade detection requires websocket + upgrade + a key', () => {
    assert.equal(isUpgrade({ headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'x' } }), true);
    assert.equal(isUpgrade({ headers: { upgrade: 'websocket', connection: 'Upgrade' } }), false, 'no key');
    assert.equal(isUpgrade({ headers: { upgrade: 'h2c', connection: 'Upgrade', 'sec-websocket-key': 'x' } }), false);
    assert.equal(isUpgrade({ headers: { upgrade: 'websocket', connection: 'keep-alive', 'sec-websocket-key': 'x' } }), false);
});

test('ws: frames round trip through the codec, masked and unmasked', () => {
    // Stay UNDER the 64 KiB cap: that is a documented protocol limit, and a payload above it
    // is refused by design (covered by its own test below).
    for (const text of ['', 'hi', 'x'.repeat(125), 'y'.repeat(126), 'z'.repeat(60000)]) {
        const payload = Buffer.from(text, 'utf8');
        // Server -> client: unmasked.
        const server = decodeFrame(encodeFrame(0x1, payload));
        assert.ok(server, 'a full frame must decode in one pass');
        assert.equal(server.opcode, 0x1);
        assert.equal(server.masked, false);
        assert.equal(server.payload.toString('utf8'), text);

        // Client -> server: masked, and decoding must undo the mask.
        const client = decodeFrame(encodeClientFrame(0x1, payload));
        assert.equal(client.masked, true);
        assert.equal(unmask(client.payload, client.maskKey).toString('utf8'), text);
    }
});

test('ws: a partial frame decodes to null until the rest arrives', () => {
    const full = encodeClientFrame(0x1, Buffer.from('hello world'));
    for (let cut = 0; cut < full.length; cut++) {
        assert.equal(decodeFrame(full.subarray(0, cut)), null, 'cut at ' + cut + ' must not decode');
    }
    assert.ok(decodeFrame(full), 'the complete frame decodes');
});

test('ws: an oversized frame is reported rather than buffered forever', () => {
    // 127-length form declaring more than the cap.
    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(5 * 1024 * 1024), 2);
    const frame = decodeFrame(header);
    assert.ok(frame && frame.oversized, 'an oversized frame must be flagged, not held');
});

// --- live server -------------------------------------------------------------

function withWsServer(handlers, fn) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
        const hub = attachWebSocket(server, { path: '/ws', ...handlers });
        server.listen(0, '127.0.0.1', async () => {
            const url = `ws://127.0.0.1:${server.address().port}/ws`;
            try { await fn(url, hub, server); resolve(); }
            catch (err) { reject(err); }
            finally { hub.closeAll(); await new Promise(r => { server.close(r); server.closeAllConnections(); }); }
        });
    });
}

// A tiny client built on the same codec, so the test does not depend on Node's WebSocket
// implementation and can drive malformed input on purpose. `ready` resolves on the handshake;
// messages are buffered from the first byte, so nothing is missed while awaiting it.
function rawClient(url) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const key = crypto.randomBytes(16).toString('base64');
        const req = http.request({
            hostname: u.hostname, port: u.port, path: u.pathname,
            headers: {
                Connection: 'Upgrade', Upgrade: 'websocket',
                'Sec-WebSocket-Version': 13, 'Sec-WebSocket-Key': key,
            },
        });
        req.on('upgrade', (res, socket, head) => {
            // The client object exists BEFORE any data handler runs, and its message list is
            // filled by the handler below: a greeting sent immediately on connect cannot race it.
            const client = {
                socket, buffer: Buffer.alloc(0), messages: [], closed: false,
                send(text) { socket.write(encodeClientFrame(0x1, Buffer.from(text, 'utf8'))); },
                sendRaw(buf) { socket.write(buf); },
                ping() { socket.write(encodeClientFrame(0x9, Buffer.alloc(0))); },
                close() { try { socket.write(encodeClientFrame(0x8, Buffer.alloc(0))); socket.end(); } catch { /* gone */ } },
            };
            const consume = (chunk) => {
                client.buffer = Buffer.concat([client.buffer, chunk]);
                for (;;) {
                    const frame = decodeFrame(client.buffer);
                    if (!frame) break;
                    client.buffer = client.buffer.subarray(frame.consumed);
                    if (frame.opcode === 0x1) client.messages.push(frame.payload.toString('utf8'));
                    if (frame.opcode === 0x8) client.closed = true;
                }
            };
            socket.on('data', consume);
            socket.on('close', () => { client.closed = true; });
            // `head` holds bytes the HTTP parser already read past the 101 response. A server
            // that greets the moment it connects puts that greeting HERE, so dropping it would
            // silently lose the first message.
            if (head && head.length) consume(head);
            resolve(client);
        });
        req.on('response', res => reject(new Error('expected an upgrade, got HTTP ' + res.statusCode)));
        req.on('error', reject);
        req.end();
    });
}

const waitFor = async (fn, timeoutMs = 2000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await new Promise(r => setTimeout(r, 10));
    }
    return fn();
};

test('ws: a real handshake connects and the server sees a session', async () => {
    await withWsServer({
        onConnect: (ws) => { ws.meta = { id: 'p1' }; ws.send(JSON.stringify({ hello: 'p1' })); },
        onMessage: (ws, text) => ws.send(JSON.stringify({ echo: text })),
    }, async (url) => {
        const client = await rawClient(url);
        assert.ok(await waitFor(() => client.messages.length >= 1), 'the greeting must arrive');
        assert.deepEqual(JSON.parse(client.messages[0]), { hello: 'p1' });
        client.send('ping-text');
        assert.ok(await waitFor(() => client.messages.length >= 2), 'the echo must arrive');
        assert.deepEqual(JSON.parse(client.messages[1]), { echo: 'ping-text' });
        client.close();
    });
});

test('ws: a wrong path is refused instead of upgraded', async () => {
    await withWsServer({}, async (url) => {
        const wrong = url.replace('/ws', '/nope');
        // The server answers a normal HTTP 400 rather than switching protocols. Requesting it
        // with an upgrade header surfaces that as a `response` event, not an `upgrade`.
        const status = await new Promise((resolve, reject) => {
            const u = new URL(wrong);
            const req = http.request({
                hostname: u.hostname, port: u.port, path: u.pathname,
                headers: {
                    Connection: 'Upgrade', Upgrade: 'websocket',
                    'Sec-WebSocket-Version': 13,
                    'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
                },
            });
            req.on('response', res => { res.resume(); resolve(res.statusCode); });
            req.on('upgrade', () => resolve('UPGRADED'));
            req.on('error', reject);
            req.end();
        });
        assert.equal(status, 400, 'a non-matching path must not be upgraded');
    });
});

test('ws: an unmasked client frame is a protocol error and closes the socket', async () => {
    await withWsServer({
        onMessage: (ws, text) => ws.send(text),
    }, async (url) => {
        const client = await rawClient(url);
        // A client MUST mask; send a valid unmasked text frame anyway.
        client.sendRaw(encodeFrame(0x1, Buffer.from('unmasked', 'utf8')));
        assert.ok(await waitFor(() => client.closed), 'the server must close an unmasked frame');
    });
});

test('ws: a fragmented message is reassembled from continuation frames', async () => {
    await withWsServer({
        onMessage: (ws, text) => ws.send(JSON.stringify({ got: text })),
    }, async (url) => {
        const client = await rawClient(url);
        const partOne = Buffer.from('frag', 'utf8');
        const partTwo = Buffer.from('mented', 'utf8');
        // First frame: FIN=0, opcode TEXT.
        const first = encodeClientFrame(0x1, partOne);
        first[0] &= 0x7f;   // clear FIN
        client.sendRaw(first);
        // Continuation: FIN=1, opcode CONT.
        client.sendRaw(encodeClientFrame(0x0, partTwo));
        assert.ok(await waitFor(() => client.messages.length >= 1), 'the message must be reassembled');
        assert.deepEqual(JSON.parse(client.messages[0]), { got: 'fragmented' });
    });
});

test('ws: a ping is answered with a pong', async () => {
    await withWsServer({}, async (url) => {
        const client = await rawClient(url);
        client.ping();
        // The pong is a control frame; observe it on the raw stream.
        const deadline = Date.now() + 2000;
        let sawPong = false;
        const onData = chunk => {
            const frame = decodeFrame(chunk);
            if (frame && frame.opcode === 0xA) sawPong = true;
        };
        client.socket.on('data', onData);
        while (Date.now() < deadline && !sawPong) await new Promise(r => setTimeout(r, 10));
        client.socket.off('data', onData);
        assert.equal(sawPong, true, 'a ping must be answered');
        client.close();
    });
});

test('ws: a slow consumer is dropped instead of growing server memory', async () => {
    // A tiny queue cap so the test does not have to flood a real socket.
    await withWsServer({
        onConnect: (ws) => {
            // Stuff the queue beyond the cap by pretending the socket never drains.
            ws.socket.write = () => false;
            for (let i = 0; i < 400; i++) ws.send('x'.repeat(4096));
        },
    }, async (url) => {
        const client = await rawClient(url);
        assert.ok(await waitFor(() => client.closed, 3000), 'the slow client must be closed');
    });
});

test('ws: many clients can be connected and receive a broadcast', async () => {
    await withWsServer({
        onConnect: () => {},
        onMessage: (ws, text) => { if (text === 'go') hubBroadcast(ws, 'to-all'); },
    }, async (url, hub) => {
        const clients = await Promise.all([rawClient(url), rawClient(url), rawClient(url)]);
        assert.equal(hub.sockets.size, 3);
        // Broadcast through the hub handle.
        hub.broadcast(JSON.stringify({ tick: 1 }));
        for (const c of clients) {
            assert.ok(await waitFor(() => c.messages.length >= 1), 'every client must receive the broadcast');
            assert.deepEqual(JSON.parse(c.messages[0]), { tick: 1 });
        }
        for (const c of clients) c.close();
        assert.ok(await waitFor(() => hub.sockets.size === 0), 'closed clients leave the hub');
    });
});

// Broadcast helper used by the test above; the hub handle is captured via closure.
let _hub = null;
function hubBroadcast(_ws, text) { if (_hub) _hub.broadcast(JSON.stringify({ got: text })); }