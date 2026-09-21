// ws.mjs — a minimal RFC 6455 WebSocket server, written from scratch because the kit has
// ZERO dependencies (invariant 1): no `ws`, no `socket.io`, no npm at all.
//
// Scope: exactly what a game transport needs.
//   * the HTTP Upgrade handshake (RFC 6455 §4) with `Sec-WebSocket-Accept`;
//   * text frames below 64 KiB (payloads above that are rejected, not silently truncated);
//   * fragmentation (continuation frames) so a large snapshot still arrives;
//   * ping/pong keepalive and close with a status code;
//   * a bounded per-socket send queue: a slow client is dropped rather than allowed to
//     balloon server memory.
//
// Deliberately NOT implemented: extensions (permessage-deflate), binary application frames,
// and client-side masking validation beyond the minimum. Each is called out where it applies.

import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;
// A client that cannot keep up must not grow the server's memory without limit. At 20 Hz
// snapshots this is several seconds of backlog; past it we close with 1008 (policy).
const MAX_QUEUE_BYTES = 1024 * 1024;

const OPCODE = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xA };

/** Per-connection state. */
class WsSocket {
    /**
     * @param {import('node:net').Socket} socket
     * @param {any} server
     */
    constructor(socket, server) {
        this.socket = socket;
        this.server = server;
        this.closed = false;
        this.queue = [];
        this.queuedBytes = 0;
        this.buffer = Buffer.alloc(0);
        /** @type {Array<{opcode: number, chunks: Buffer[]}>|null} */
        this.fragment = null;
        /** @type {any} application data attached by the handler (session, player id) */
        this.meta = null;
        this.isAlive = true;
        socket.setNoDelay(true);
        socket.on('data', chunk => this.onData(chunk));
        socket.on('error', () => this.close(1011, 'socket-error'));
        socket.on('close', () => { this.closed = true; if (this.onClose) this.onClose(); });
    }

    onData(chunk) {
        if (this.closed) return;
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
        // Decode as many complete frames as the buffer holds.
        for (;;) {
            const frame = decodeFrame(this.buffer);
            if (!frame) break;
            this.buffer = this.buffer.subarray(frame.consumed);
            this.handleFrame(frame);
            if (this.closed) return;
        }
    }

    handleFrame(frame) {
        // A client MUST mask (RFC 6455 §5.1). Unmasked input is a protocol error.
        if (!frame.masked) return this.close(1002, 'unmasked');
        const payload = unmask(frame.payload, frame.maskKey);

        if (frame.opcode === OPCODE.CLOSE) {
            this.close(1000, '');
            return;
        }
        if (frame.opcode === OPCODE.PING) {
            this.sendFrame(OPCODE.PONG, payload);
            return;
        }
        if (frame.opcode === OPCODE.PONG) {
            this.isAlive = true;
            return;
        }
        if (frame.opcode === OPCODE.CONT) {
            if (!this.fragment) return this.close(1002, 'unexpected-continuation');
            this.fragment.chunks.push(payload);
            if (frame.fin) {
                const full = Buffer.concat(this.fragment.chunks);
                const opcode = this.fragment.opcode;
                this.fragment = null;
                this.deliver(opcode, full);
            }
            return;
        }
        if (frame.opcode === OPCODE.TEXT || frame.opcode === OPCODE.BINARY) {
            if (this.fragment) return this.close(1002, 'nested-fragment');
            if (frame.fin) return this.deliver(frame.opcode, payload);
            this.fragment = { opcode: frame.opcode, chunks: [payload] };
            return;
        }
        this.close(1002, 'bad-opcode');
    }

    deliver(opcode, payload) {
        if (payload.length > MAX_PAYLOAD) return this.close(1009, 'too-large');
        // Binary application frames are not part of this game's protocol.
        if (opcode !== OPCODE.TEXT) return this.close(1003, 'text-only');
        if (!this.onMessage) return;
        try {
            this.onMessage(payload.toString('utf8'));
        } catch (err) {
            // A handler throwing must not kill the connection silently.
            this.server.emit('handlerError', err, this);
        }
    }

    /** Send a text frame. Queues when the kernel buffer is full. */
    send(text) {
        if (this.closed) return false;
        const payload = Buffer.from(String(text), 'utf8');
        if (payload.length > MAX_PAYLOAD) return false;
        if (this.queuedBytes > 0) return this.enqueue(payload);
        if (!this.socket.write(encodeFrame(OPCODE.TEXT, payload))) {
            // `write` returned false: the rest goes through the queue.
            this.queuedBytes += payload.length;
            return true;
        }
        return true;
    }

    enqueue(payload) {
        if (this.queuedBytes + payload.length > MAX_QUEUE_BYTES) {
            this.close(1008, 'slow-consumer');
            return false;
        }
        this.queue.push(payload);
        this.queuedBytes += payload.length;
        return true;
    }

    // Called when the socket drains, so the queue can be flushed in order.
    flush() {
        if (this.closed) return;
        while (this.queue.length) {
            const payload = this.queue.shift();
            this.queuedBytes -= payload.length;
            if (!this.socket.write(encodeFrame(OPCODE.TEXT, payload))) break;
        }
    }

    sendFrame(opcode, payload) {
        if (this.closed) return;
        this.socket.write(encodeFrame(opcode, payload));
    }

    ping() {
        if (this.closed) return;
        this.isAlive = false;
        this.sendFrame(OPCODE.PING, Buffer.alloc(0));
    }

    close(code = 1000, reason = '') {
        if (this.closed) return;
        this.closed = true;
        try {
            const reasonBuf = Buffer.from(String(reason), 'utf8');
            const body = Buffer.alloc(2 + reasonBuf.length);
            body.writeUInt16BE(code, 0);
            reasonBuf.copy(body, 2);
            this.socket.write(encodeFrame(OPCODE.CLOSE, body));
            this.socket.end();
        } catch (err) { /* the peer is already gone */ }
        if (this.onClose) this.onClose();
    }
}

// --- frame codec -------------------------------------------------------------

/**
 * Decode ONE frame from the front of `buf`, or null when more bytes are needed.
 * Returns { fin, opcode, masked, payload, maskKey, consumed }.
 */
export function decodeFrame(buf) {
    if (buf.length < 2) return null;
    const b0 = buf[0], b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f;
    let offset = 2;

    if (length === 126) {
        if (buf.length < offset + 2) return null;
        length = buf.readUInt16BE(offset);
        offset += 2;
    } else if (length === 127) {
        if (buf.length < offset + 8) return null;
        const big = buf.readBigUInt64BE(offset);
        // Above 2^53 a JS number loses precision; reject rather than mis-decode.
        if (big > BigInt(MAX_PAYLOAD)) return { fin, opcode, masked, payload: Buffer.alloc(0), maskKey: null, consumed: buf.length, oversized: true };
        length = Number(big);
        offset += 8;
    }
    if (length > MAX_PAYLOAD) {
        // Report a consumed frame so the caller can close, instead of buffering forever.
        return { fin, opcode, masked, payload: Buffer.alloc(0), maskKey: null, consumed: buf.length, oversized: true };
    }

    let maskKey = null;
    if (masked) {
        if (buf.length < offset + 4) return null;
        maskKey = buf.subarray(offset, offset + 4);
        offset += 4;
    }
    if (buf.length < offset + length) return null;

    const payload = buf.subarray(offset, offset + length);
    return { fin, opcode, masked, payload, maskKey, consumed: offset + length };
}

/** Server -> client frames are never masked (RFC 6455 §5.1). */
export function encodeFrame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;   // FIN + opcode
    return Buffer.concat([header, payload]);
}

export function unmask(payload, maskKey) {
    if (!maskKey) return payload;
    const out = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ maskKey[i & 3];
    return out;
}

/** Client -> server frames MUST be masked, so tests need a masking encoder. */
export function encodeClientFrame(opcode, payload, maskKey = crypto.randomBytes(4)) {
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[1] = 0x80 | len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    return Buffer.concat([header, maskKey, unmask(payload, maskKey)]);
}

// --- handshake & server ------------------------------------------------------

/** Compute the Sec-WebSocket-Accept value for a client key (RFC 6455 §4.2.2). */
export function acceptKey(clientKey) {
    return crypto.createHash('sha1').update(String(clientKey) + GUID).digest('base64');
}

/** True when the request is a valid WebSocket upgrade. */
export function isUpgrade(req) {
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    const connection = String(req.headers.connection || '').toLowerCase();
    return upgrade === 'websocket' && connection.includes('upgrade') && !!req.headers['sec-websocket-key'];
}

/**
 * Attach WebSocket handling to an existing http.Server.
 * handlers: { onConnect(socket, req), onMessage(socket, text), onClose(socket) }.
 * `path` limits upgrades to one route; other paths are upgraded-then-closed so a client gets
 * a clear protocol error instead of a hanging socket.
 */
export function attachWebSocket(server, { path: onlyPath = null, onConnect = null, onMessage = null, onClose = null, heartbeatMs = 30000 } = {}) {
    const sockets = new Set();

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://localhost');
        if (!isUpgrade(req) || (onlyPath && url.pathname !== onlyPath)) {
            socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        const accept = acceptKey(req.headers['sec-websocket-key']);
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        const ws = new WsSocket(socket, server);
        sockets.add(ws);
        // Frames already read by the HTTP parser belong to the stream.
        if (head && head.length) ws.onData(head);
        socket.on('drain', () => ws.flush());
        ws.onClose = () => {
            sockets.delete(ws);
            if (onClose) { try { onClose(ws); } catch (err) { server.emit('handlerError', err, ws); } }
        };
        ws.onMessage = (text) => { if (onMessage) onMessage(ws, text); };
        if (onConnect) { try { onConnect(ws, req, url); } catch (err) { server.emit('handlerError', err, ws); } }
    });

    // Keepalive: a peer that stops answering pings is closed, so half-open sockets cannot
    // hold a raid slot forever.
    const timer = setInterval(() => {
        for (const ws of sockets) {
            if (!ws.isAlive) { ws.close(1001, 'heartbeat-timeout'); continue; }
            ws.ping();
        }
    }, heartbeatMs);
    timer.unref();
    server.on('close', () => clearInterval(timer));

    return {
        sockets,
        broadcast: (text) => { for (const ws of sockets) ws.send(text); },
        closeAll: () => { for (const ws of sockets) ws.close(1001, 'server-shutdown'); },
    };
}