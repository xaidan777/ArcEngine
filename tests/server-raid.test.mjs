// Authoritative PvE: the server must own the machines, the damage and the objectives.
// These tests pin the properties the online raid relies on — the server simulates a real
// map, machines exist and are deterministic, player shots kill them, machine shots hurt
// players through shields, and none of it depends on client declarations.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RaidRoom, PROTOCOL_VERSION, TICK_RATE } from '../server/simulation.mjs';

const command = (sequence = 0, extra = {}) =>
    ({ version: PROTOCOL_VERSION, sequence, forward: 1, right: 0, heading: 0, sprint: false, ...extra });

test('room builds a real raid map, not a bare 2000x2000 sandbox', () => {
    const room = new RaidRoom({ seed: 7419 });
    assert.equal(room.width, 4096);
    assert.equal(room.height, 4096);
    assert.ok(room.blockers.length > 20, 'the district geometry must be present');
    assert.ok(room.map.enemies.length >= 12, 'the garrison must exist');
    assert.equal(room.map.drives.length, 3);
    assert.equal(room.map.containers.length, 8);
    // Every blocker has collision height, so the server blocks on real silhouettes.
    for (const b of room.blockers) assert.equal(typeof b.height, 'number');
});

test('two rooms with the same seed are interchangeable (server restart must not warp the map)', () => {
    const a = new RaidRoom({ seed: 7419 });
    const b = new RaidRoom({ seed: 7419 });
    assert.equal(JSON.stringify(a.map), JSON.stringify(b.map));
    assert.deepEqual(
        [...a.enemies.values()].map(e => [e.id, e.archetype, e.x, e.y]),
        [...b.enemies.values()].map(e => [e.id, e.archetype, e.x, e.y]));
});

test('players spawn on the terrain, not floating at h=0', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    const ground = room.heightAt(p.x, p.y);
    assert.equal(p.h, ground);
    assert.ok(Number.isFinite(p.h));
});

test('the garrison is alive, patrolling and deterministic across ticks', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const start = [...room.enemies.values()].map(e => ({ id: e.id, x: e.x, y: e.y, hp: e.hp }));
    assert.ok(start.every(e => e.hp > 0));
    for (let i = 0; i < 120; i++) room.step();
    const moved = [...room.enemies.values()].filter(e => e.state === 'patrol' && (e.x !== e.homeX || e.y !== e.homeY));
    assert.ok(moved.length > 0, 'patrolling machines must actually move');
    // Same seed + same ticks must produce the same world: replay safety.
    const twin = new RaidRoom({ seed: 7419 });
    twin.join('a');
    for (let i = 0; i < 120; i++) twin.step();
    assert.equal(JSON.stringify([...room.enemies.values()].map(e => [e.id, Math.round(e.x), Math.round(e.y)])),
        JSON.stringify([...twin.enemies.values()].map(e => [e.id, Math.round(e.x), Math.round(e.y)])));
});

test('a player shot kills a machine and the server reports it', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('shooter');
    const p = room.players.get('shooter');
    const enemy = [...room.enemies.values()].find(e => e.hp > 0);
    // Put the machine right in front of the shooter, on the same ground line.
    enemy.x = p.x + 200; enemy.y = p.y; enemy.state = 'patrol';
    enemy.h = room.heightAt(enemy.x, enemy.y);
    p.h = room.heightAt(p.x, p.y);
    // Aim at the torso height of the machine.
    const dz = Math.max(1, Math.hypot(enemy.x - p.x, enemy.y - p.y));
    const pitch = Math.atan2((p.h + 55) - (enemy.h + enemy.height * 0.5), dz);
    assert.equal(room.input('shooter', command(0, { fire: true, heading: 0, pitch })), true);
    for (let i = 0; i < 30; i++) room.step();
    const events = room.snapshot().events;
    assert.ok(events.some(e => e.type === 'enemyHit' || e.type === 'enemyKill'),
        'expected a machine hit event, got ' + JSON.stringify(events.map(e => e.type)));
});

test('a machine shot hurts a player through the shield, and the server owns the numbers', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('victim');
    const p = room.players.get('victim');
    const enemy = [...room.enemies.values()].find(e => e.hp > 0);
    // Place the machine close and engaged so it fires this tick.
    enemy.x = p.x + 150; enemy.y = p.y;
    enemy.h = room.heightAt(enemy.x, enemy.y);
    enemy.state = 'engage'; enemy.cooldown = 0; enemy.aggro = 5000;
    const shieldBefore = p.shield;
    for (let i = 0; i < 90; i++) room.step();
    assert.ok(p.shield < shieldBefore || p.hp < 100,
        'the machine must be able to damage the player');
    // The player never sent a damage or position claim.
    const snap = room.snapshot();
    const me = snap.players.find(x => x.id === 'victim');
    assert.equal(me.shield, p.shield);
});

test('objectives are server state: the snapshot carries the timer, drives and extraction', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const obj = room.snapshot().objective;
    assert.equal(obj.target, 3);
    assert.equal(obj.collected, 0);
    assert.equal(obj.drives, 3);
    assert.ok(obj.extraction && obj.extraction.radius > 0);
    assert.ok(obj.hatch && obj.hatch.radius > 0);
    assert.ok(obj.raidTimer > 0 && obj.raidTimer <= 1200);
    // The raid clock is driven by server ticks, not by a client-supplied dt.
    const before = room.snapshot().objective.raidTimer;
    for (let i = 0; i < TICK_RATE; i++) room.step();
    assert.ok(room.snapshot().objective.raidTimer < before, 'the raid timer must advance');
});

test('a client cannot declare its own position, HP, kills or loot', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const before = room.snapshot().players[0];
    // An input full of forged state is accepted as INPUT, but every forged field is dropped.
    room.input('a', command(0, { x: 3999, y: 3999, h: 999, hp: 999, shield: 999, kills: 99, drives: 3, dt: 5 }));
    const after = room.snapshot().players[0];
    assert.equal(after.x, before.x);
    assert.equal(after.hp, before.hp);
    assert.equal(after.shield, before.shield);
    assert.equal(room.snapshot().objective.collected, 0);
});

test('the map sent to clients is the map the server plays on', () => {
    const room = new RaidRoom({ seed: 7419 });
    // /world serves room.map, so a client building from it must produce identical collision.
    const clientCopy = JSON.parse(JSON.stringify(room.map));
    assert.equal(clientCopy.blockers.length, room.blockers.length);
    for (let i = 0; i < clientCopy.blockers.length; i++) {
        assert.equal(clientCopy.blockers[i].x, room.blockers[i].x);
        assert.equal(clientCopy.blockers[i].height, room.blockers[i].height);
    }
});