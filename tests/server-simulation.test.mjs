import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RaidRoom, PROTOCOL_VERSION } from '../server/simulation.mjs';
import { createGameServer } from '../server/main.mjs';
import { loadScripts } from './browser-scripts.mjs';

const command = (sequence = 0, extra = {}) => ({ version: PROTOCOL_VERSION, sequence, forward: 1, right: 0, heading: 0, sprint: false, ...extra });

test('server advances only on its fixed clock, ignores position and rejects replay', () => {
    const room = new RaidRoom(); room.join('a');
    assert.equal(room.input('a', command(0, { x: 1900, dt: 1000 })), true);
    assert.equal(room.snapshot().players[0].x, 280);
    room.step();
    assert.ok(Math.abs(room.snapshot().players[0].x - (280 + 260 / 60)) < 1e-9);
    assert.equal(room.input('a', command()), false);
    assert.equal(room.input('a', command(1, { forward: Infinity })), false);
    assert.equal(room.input('a', command(1, { right: 2 })), false);
    assert.equal(room.input('unknown', command()), false);
});

test('authoritative collisions block teleporting and stale input stops motion', () => {
    const room = new RaidRoom({ blockers: [{ x: 340, y: 1660, radius: 20 }] });
    room.join('a'); room.input('a', command());
    for (let i = 0; i < 60; i++) room.step();
    const x = room.snapshot().players[0].x;
    assert.ok(x <= 296.01);
    for (let i = 0; i < 60; i++) room.step();
    assert.equal(room.snapshot().players[0].x, x);
});

test('two players share snapshots with independent authoritative stamina', () => {
    const room = new RaidRoom(); room.join('a'); room.join('b');
    room.input('a', command(0, { sprint: true })); room.step();
    const state = room.snapshot();
    assert.equal(state.players.length, 2);
    assert.ok(state.players[0].stamina.value < state.players[1].stamina.value);
    state.players[0].stamina.value = 0;
    assert.ok(room.snapshot().players[0].stamina.value > 0);
});

test('browser transport joins, moves, observes peers and disconnects through HTTP', async t => {
    const server = createGameServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const url = `http://127.0.0.1:${server.address().port}`;
    const Client = loadScripts(['js/RaidClient.js'], { fetch, AbortSignal }).get('RaidClient');
    const a = new Client(url), b = new Client(url);
    await a.connect(); await b.connect();
    assert.equal((await a.poll()).players.length, 2);
    const initial = (await a.poll()).players.find(p => p.id === a.id).x;
    await a.sendInput({ forward: 1, right: 0, heading: 0 });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.ok((await b.poll()).players.find(p => p.id === a.id).x > initial);
    assert.equal((await fetch(url + '/snapshot')).status, 401);
    assert.equal((await fetch(url + '/sessions', { method: 'POST', headers: { Origin: 'https://invalid.example' } })).status, 403);
    await a.disconnect();
    assert.equal((await b.poll()).players.length, 1);
    await b.disconnect();
});

test('authoritative server shooting simulates projectiles and applies damage to target player', () => {
    const room = new RaidRoom();
    room.join('shooter');
    room.join('target');

    // Place target right in front of shooter (shooter is at x:280, y:1660)
    const targetPlayer = room.players.get('target');
    targetPlayer.x = 480;
    targetPlayer.y = 1660;
    targetPlayer.hp = 100;
    targetPlayer.shield = 100;

    // Shooter holds the trigger, heading 0 (along +X). The trigger is HELD STATE: the shot is
    // resolved on the simulation tick, not inside input(), so the weapon's own rate of fire
    // decides the rhythm instead of the client's send rate.
    const ok = room.input('shooter', command(0, { fire: true, heading: 0, pitch: 0 }));
    assert.equal(ok, true);
    assert.equal(room.snapshot().projectiles.length, 0, 'input() records intent, it does not fire');

    // One tick resolves the trigger.
    room.step();
    const shotState = room.snapshot();
    assert.equal(shotState.projectiles.length, 1);
    assert.equal(shotState.players.find(p => p.id === 'shooter').ammo, 19);

    // Step the simulation (projectile velocity 4800 px/s, distance 200 px -> hits in 3-4 ticks).
    // Only a few ticks: the trigger is HELD, so at 0.16 s between shots a longer run would fire
    // a second round and the count below would be 1 instead of 0 — which is correct behaviour,
    // not a leak.
    for (let i = 0; i < 6; i++) room.step();

    const afterState = room.snapshot();
    const damagedTarget = afterState.players.find(p => p.id === 'target');
    // Shield absorbs incoming damage first
    assert.ok(damagedTarget.shield < 100, `Target Shield should be reduced: ${damagedTarget.shield}`);
    assert.equal(afterState.projectiles.length, 0, 'the projectile is consumed on hit');
    assert.ok(afterState.events.some(e => e.type === 'hit' && e.targetId === 'target'));

    // Now deplete shield and shoot again to verify HP damage
    targetPlayer.shield = 0;
    // The fire cooldown has to elapse before the next shot, exactly as on the client.
    room.players.get('shooter').fireCooldown = 0;
    room.input('shooter', command(1, { fire: true, heading: 0, pitch: 0 }));
    for (let i = 0; i < 6; i++) room.step();

    const afterState2 = room.snapshot();
    const hpDamagedTarget = afterState2.players.find(p => p.id === 'target');
    assert.ok(hpDamagedTarget.hp < 100, `Target HP should be reduced once shield is depleted: ${hpDamagedTarget.hp}`);
});

