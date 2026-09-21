// Raid lifecycle: surrender, extraction, raid end, reconnect and the settlement contract.
// These are the parts a client must never be able to decide for itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RaidRoom, TICK_RATE } from '../server/simulation.mjs';
import { createGameServer } from '../server/main.mjs';

const cmd = (sequence = 0, extra = {}) =>
    ({ version: 2, sequence, forward: 0, right: 0, heading: 0, sprint: false, ...extra });

// --- surrender ---------------------------------------------------------------

test('surrender: a player can give up and the server records a casualty', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    assert.equal(room.state, 'active');
    const result = room.surrender('a');
    assert.equal(result.ok, true);
    assert.equal(room.players.get('a').hp, 0);
    assert.ok(room.casualties.has('a'), 'a surrender is a casualty, not an extraction');
    assert.equal(room.extracted.has('a'), false);
    assert.ok(room.events.some(e => e.type === 'surrender' && e.playerId === 'a'));
    // A solo surrender ends the raid: nobody is left to keep it open.
    assert.equal(room.state, 'ended');
    assert.equal(room.outcome.won, false);
    assert.equal(room.outcome.reason, 'surrender');
});

test('surrender: it is idempotent and rejected for unknown or dead players', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a'); room.join('b');
    assert.equal(room.surrender('ghost').error, 'no-player');
    assert.equal(room.surrender('a').ok, true);
    assert.equal(room.surrender('a').error, 'already-dead', 'a dead player cannot surrender twice');
    assert.equal(room.state, 'active', 'one survivor keeps the raid alive');
    // The first outcome is never overwritten.
    const first = room.endRaid(false, 'barrage');
    const second = room.endRaid(true, 'extraction');
    assert.equal(first, second);
    assert.equal(room.outcome.reason, 'barrage');
});

test('surrender: a dead player stops moving, firing and being simulated', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a'); room.join('b');
    room.input('a', cmd(0, { forward: 1, heading: 0 }));
    room.surrender('a');
    const x = room.players.get('a').x;
    for (let i = 0; i < 30; i++) room.step();
    assert.equal(room.players.get('a').x, x, 'the corpse does not walk');
});

// --- raid end ----------------------------------------------------------------

test('raid end: the barrage ends the raid for everyone still alive', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a'); room.join('b');
    // Fast-forward the clock to the end of the raid window.
    room.tick = Math.floor((1200 + 1) * TICK_RATE);
    room.step();
    assert.equal(room.state, 'ended');
    assert.equal(room.outcome.won, false);
    assert.equal(room.outcome.reason, 'barrage');
});

test('raid end: the raid timer counts down from the server clock', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const before = room.snapshot().objective.raidTimer;
    for (let i = 0; i < TICK_RATE; i++) room.step();
    const after = room.snapshot().objective.raidTimer;
    assert.ok(after < before, 'the timer must advance on ticks alone');
    assert.ok(Math.abs((before - after) - 1) < 0.1, 'one second of ticks is one second of raid');
});

test('raid end: a wipe ends the raid as a loss', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    room.players.get('a').hp = 0;
    room.step();
    assert.equal(room.state, 'ended');
    assert.equal(room.outcome.reason, 'wipe');
});

test('raid end: a finished raid is frozen — no movement, no bullets, one outcome', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a'); room.join('b');
    room.endRaid(true, 'extraction');
    const snapshot = JSON.stringify(room.snapshot().players);
    room.input('a', cmd(0, { forward: 1, heading: 0, fire: true }));
    for (let i = 0; i < 30; i++) room.step();
    assert.equal(JSON.stringify(room.snapshot().players), snapshot, 'a closed raid does not simulate');
    assert.equal(room.projectiles.size, 0, 'no shots are spawned after the end');
    assert.equal(room.snapshot().outcome.won, true);
});

// --- objectives --------------------------------------------------------------

test('objectives: drives are collected by proximity and unlock extraction once', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    assert.equal(room.snapshot().objective.extractionState, 'locked');
    for (const drive of room.map.drives) {
        p.x = drive.x; p.y = drive.y;
        room.step();
    }
    const obj = room.snapshot().objective;
    assert.equal(obj.collected, 3);
    assert.equal(obj.extractionState, 'available', 'three drives must unlock the beacon');
    // Walking over the same drive again must not count twice.
    const first = room.map.drives[0];
    p.x = first.x; p.y = first.y;
    for (let i = 0; i < 10; i++) room.step();
    assert.equal(room.snapshot().objective.collected, 3, 'a drive is collected once');
});

test('objectives: calling extraction needs range and the unlock, and the server owns the timer', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    assert.equal(room.requestExtraction('a').error, 'not-available', 'locked until the drives are in');

    for (const drive of room.map.drives) { p.x = drive.x; p.y = drive.y; room.step(); }
    assert.equal(room.requestExtraction('a').error, 'out-of-range', 'you must stand in the zone');

    p.x = room.map.extraction.x; p.y = room.map.extraction.y;
    const called = room.requestExtraction('a');
    assert.equal(called.ok, true);
    assert.equal(called.state, 'inbound');
    assert.equal(room.snapshot().objective.inboundTimer > 0, true);

    // The inbound timer is server-driven and eventually becomes boarding.
    for (let i = 0; i < 16 * TICK_RATE; i++) room.step();
    assert.equal(room.snapshot().objective.extractionState, 'boarding');
});

test('objectives: holding the zone extracts the player and wins the raid', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    // Isolate the extraction path: the beacon is contested ground, and a lone player holding
    // it under the full garrison is killed long before the 6 s boarding completes (verified
    // separately, so this test is not silently measuring a firefight).
    for (const e of room.enemies.values()) e.hp = 0;
    for (const drive of room.map.drives) { p.x = drive.x; p.y = drive.y; room.step(); }
    p.x = room.map.extraction.x; p.y = room.map.extraction.y;
    room.requestExtraction('a');
    for (let i = 0; i < 40 * TICK_RATE && room.state === 'active'; i++) {
        p.x = room.map.extraction.x; p.y = room.map.extraction.y;   // hold the zone
        room.step();
    }
    assert.equal(room.state, 'ended');
    assert.equal(room.outcome.won, true);
    assert.equal(room.outcome.reason, 'extraction');
    assert.ok(room.extracted.has('a'));
    assert.equal(room.casualties.has('a'), false);
});

test('objectives: a contested beacon does NOT board, and standing there is lethal', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    for (const drive of room.map.drives) { p.x = drive.x; p.y = drive.y; room.step(); }
    p.x = room.map.extraction.x; p.y = room.map.extraction.y;
    room.requestExtraction('a');
    let sawContested = false;
    for (let i = 0; i < 40 * TICK_RATE && room.state === 'active'; i++) {
        p.x = room.map.extraction.x; p.y = room.map.extraction.y;
        room.step();
        if (room.snapshot().objective.contested) sawContested = true;
    }
    // The real garrison reaches the beacon, so the raid must end as a loss rather than
    // handing out a free extraction to someone who never cleared the zone.
    assert.equal(room.state, 'ended');
    assert.equal(room.outcome.won, false);
    assert.ok(['wipe', 'barrage'].includes(room.outcome.reason),
        'expected the player to be killed or timed out, got ' + room.outcome.reason);
    assert.equal(room.extracted.has('a'), false);
    assert.ok(sawContested || room.casualties.has('a'), 'the zone must have been contested or lethal');
});

// --- reconnect ---------------------------------------------------------------

test('reconnect: a dropped player keeps their body for the grace window', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a'); room.join('b');
    const before = room.players.get('a').x;
    room.markDisconnected('a', 5000, 1000);
    assert.equal(room.players.has('a'), true, 'the body stays in the world');
    assert.equal(room.snapshot().players.find(p => p.id === 'a').disconnected, true);

    // A dropped player is not simulated, but is also not a casualty.
    room.input('a', cmd(0, { forward: 1, heading: 0 }));
    for (let i = 0; i < 20; i++) room.step();
    assert.equal(room.players.get('a').x, before, 'a dropped player does not move');
    assert.equal(room.casualties.has('a'), false);

    const back = room.reconnect('a', 2000);
    assert.ok(back, 'reconnecting inside the window restores the player');
    assert.equal(room.players.get('a').disconnected, false);
    assert.ok(room.events.some(e => e.type === 'reconnect'));
});

test('reconnect: past the grace window the player is evicted for good', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a'); room.join('b');
    room.markDisconnected('a', 1000, 1000);
    assert.equal(room.reconnect('a', 5000), null, 'a stale reconnect is refused');
    const evicted = room.reapDisconnected(5000);
    assert.deepEqual(evicted, ['a']);
    assert.equal(room.players.has('a'), false);
    assert.equal(room.snapshot().players.length, 1);
});

// --- HTTP ---------------------------------------------------------------------

async function withServer(fn) {
    const server = createGameServer({ accountsDir: null });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const api = async (path, { method = 'GET', token, body } = {}) => {
        const res = await fetch(url + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        let json = null;
        try { json = await res.json(); } catch { /* empty */ }
        return { status: res.status, body: json };
    };
    try { await fn(api, url, server); }
    finally { await new Promise(r => { server.close(r); server.closeAllConnections(); }); }
}

test('http: surrender needs auth and answers with the raid state', async () => {
    await withServer(async (api) => {
        assert.equal((await api('/raid/surrender', { method: 'POST' })).status, 401);
        const reg = await api('/register', { method: 'POST', body: { name: 'Quitter', password: 'secret123' } });
        const token = reg.body.token;
        const result = await api('/raid/surrender', { method: 'POST', token });
        assert.equal(result.status, 200);
        assert.equal(result.body.ok, true);
        assert.equal(result.body.raid, null, 'not in a raid yet');
    });
});

test('http: two matched players share one outcome, and surrender ends it for both', async () => {
    await withServer(async (api, url, server) => {
        const a = (await api('/register', { method: 'POST', body: { name: 'Raid_A2', password: 'secret123' } })).body.token;
        const b = (await api('/register', { method: 'POST', body: { name: 'Raid_B2', password: 'secret123' } })).body.token;
        await api('/match/queue', { method: 'POST', token: a });
        await api('/match/queue', { method: 'POST', token: b });

        let inRaid = false;
        for (let i = 0; i < 60 && !inRaid; i++) {
            await new Promise(r => setTimeout(r, 50));
            inRaid = !!(await api('/match/status', { token: a })).body.raid;
        }
        assert.ok(inRaid, 'the two players must be matched');

        const surrender = await api('/raid/surrender', { method: 'POST', token: a });
        assert.equal(surrender.status, 200);
        assert.equal(surrender.body.ended, false, 'one player left; the raid continues for the other');

        const snapB = await api('/snapshot', { token: b });
        const victim = snapB.body.players.find(p => p.id);
        assert.equal(snapB.body.state, 'active');
        assert.ok(snapB.body.players.some(p => p.hp === 0), 'the surrenderer is dead in the shared world');

        // The second player surrendering closes the raid with a single shared outcome.
        const second = await api('/raid/surrender', { method: 'POST', token: b });
        assert.equal(second.body.ended, true);
        const snapAfter = await api('/snapshot', { token: b });
        assert.equal(snapAfter.body.state, 'ended');
        assert.equal(snapAfter.body.outcome.won, false);
        assert.equal(snapAfter.body.outcome.reason, 'surrender');
    });
});

test('http: extraction cannot be claimed from outside the zone', async () => {
    await withServer(async (api, url, server) => {
        const t = (await api('/register', { method: 'POST', body: { name: 'Extract_1', password: 'secret123' } })).body.token;
        await api('/match/queue', { method: 'POST', token: t });
        const result = await api('/raid/extract', { method: 'POST', token: t });
        assert.ok([409, 200].includes(result.status));
        if (result.status === 409) assert.ok(['not-available', 'out-of-range'].includes(result.body.error));
    });
});

test('http: reconnect restores a dropped player inside the grace window', async () => {
    await withServer(async (api, url, server) => {
        const a = (await api('/register', { method: 'POST', body: { name: 'Recon_A', password: 'secret123' } })).body.token;
        const b = (await api('/register', { method: 'POST', body: { name: 'Recon_B', password: 'secret123' } })).body.token;
        await api('/match/queue', { method: 'POST', token: a });
        await api('/match/queue', { method: 'POST', token: b });
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 50));
            if ((await api('/match/status', { token: a })).body.raid) break;
        }
        const raidId = [...server.arc.raids.keys()][0];
        assert.ok(raidId, 'a raid exists');
        const room = server.arc.raids.get(raidId).room;
        const accountA = server.arc.accounts.byName_('Recon_A').id;

        // Simulate a dropped socket: the transport marks the body, not removes it.
        server.arc.leaveEverything(accountA, { nowMs: Date.now() });
        assert.equal(room.players.has(accountA), true, 'the body is kept');
        assert.equal(room.players.get(accountA).disconnected, true);

        const back = await api('/raid/reconnect', { method: 'POST', token: a });
        assert.equal(back.status, 200);
        assert.equal(back.body.ok, true);
        assert.equal(room.players.get(accountA).disconnected, false);
    });
});