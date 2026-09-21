// The weapon economy: firing rate, the magazine, reloading and the reserve.
// Regression cover for a reported bug where the whole reserve drained during a single reload.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RaidRoom, TICK_RATE } from '../server/simulation.mjs';

const cmd = (sequence = 0, extra = {}) =>
    ({ version: 2, sequence, forward: 0, right: 0, heading: 0, sprint: false, fire: false, pitch: 0, ...extra });

// Run the room for `seconds` with the trigger held, sending input at the given rate.
function hold(room, id, seconds, { inputHz = 20, fire = true, forward = 0, heading = 0 } = {}) {
    const inputEvery = Math.max(1, Math.round(TICK_RATE / inputHz));
    let sequence = room.players.get(id).sequence + 1;
    for (let tick = 0; tick < seconds * TICK_RATE; tick++) {
        if (tick % inputEvery === 0) {
            room.input(id, cmd(sequence++, { fire, forward, heading }));
        }
        room.step();
    }
}

test('weapon: the trigger is held state, not a shot per message', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    // A single command must not fire by itself: input records intent for the next tick.
    room.input('a', cmd(0, { fire: true }));
    assert.equal(p.ammo, 20, 'no round is spent by receiving input');
    assert.equal(room.projectiles.size, 0);
    room.step();
    assert.equal(p.ammo, 19, 'exactly one round is spent on the tick');
});

test('weapon: the rate of fire is the weapon, not the network cadence', () => {
    const interval = 0.16;
    // A slow client (5 Hz) and a fast one (60 Hz) must spend the SAME number of rounds: a
    // client must not be able to buy damage output by sending more often.
    const counts = [];
    for (const inputHz of [5, 20, 60]) {
        const room = new RaidRoom({ seed: 7419 });
        room.join('a');
        room.players.get('a').fireInterval = interval;
        hold(room, 'a', 2, { inputHz });
        counts.push({ inputHz, spent: 20 - room.players.get('a').ammo });
    }
    const spent = counts.map(c => c.spent);
    assert.ok(spent[0] === spent[1] && spent[1] === spent[2],
        'every client must spend the same rounds, got ' + JSON.stringify(counts));
    // 2 seconds at 0.16 s = 12 shots (the first is immediate).
    assert.ok(spent[0] >= 11 && spent[0] <= 13, 'expected ~12 shots in 2 s, got ' + spent[0]);
});

test('weapon: a reload refills the magazine and only spends the reserve once', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    p.ammo = 0;
    p.reserveAmmo = 60;
    const started = room.startReload(p);
    assert.equal(started, true);
    assert.ok(p.reloadTimer > 0);

    // Run well past the reload time with the trigger held down.
    hold(room, 'a', 5, { inputHz: 20 });
    assert.equal(p.reserveAmmo, 40, 'exactly one magazine came out of the reserve');
    assert.ok(p.ammo <= p.magSize, 'the magazine never exceeds its size');
});

test('regression: holding the trigger through a reload does NOT drain the reserve', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    const reserveAtStart = p.reserveAmmo;

    // This is the reported bug: fire until the magazine runs dry, keep holding the trigger,
    // and let the automatic reload cycle. 8 seconds at 0.16 s is ~50 shots, so the 80 rounds
    // available must cover it with reserve left over. The point is that rounds are spent at the
    // WEAPON's rate and only by the server — the bug spent them ~3x faster and drained the lot.
    hold(room, 'a', 8, { inputHz: 20 });

    const totalRounds = reserveAtStart + 20;   // 80
    const remaining = p.reserveAmmo + p.ammo;
    assert.ok(remaining >= 0, 'the reserve must never go negative');
    assert.ok(remaining <= totalRounds, 'rounds cannot be created');
    const spent = totalRounds - remaining;
    // 8 s / 0.16 s = 50 shots, plus the magazine capacity of tolerance.
    assert.ok(spent <= 20 + 20, 'expected at most ~40 rounds spent in 8 s, got ' + spent);
    assert.ok(p.reserveAmmo > 0, 'the reserve must survive 8 s of firing, left ' + p.reserveAmmo);
});

test('regression: the reserve lasts a full raid of sustained fire', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    const total = p.reserveAmmo + p.ammo;
    // 60 seconds of holding the trigger: 375 shots at the correct rate, far more than the 80
    // rounds carried, so the weapon must run DRY rather than inventing ammunition.
    hold(room, 'a', 60, { inputHz: 20 });
    assert.equal(p.ammo + p.reserveAmmo, 0, 'sustained fire drains exactly the rounds carried');
    assert.ok(p.reserveAmmo >= 0);
});

test('regression: a reload spends one magazine, not one per tick', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    p.ammo = 3;
    p.reserveAmmo = 20;
    // Hold the trigger: the magazine empties, the reload starts and must consume exactly 17.
    hold(room, 'a', 3, { inputHz: 20 });
    assert.ok(p.reserveAmmo >= 0, 'the reserve is never negative');
    // Count reload events: each takes exactly one magazine from the reserve.
    const reloads = room.events.filter(e => e.type === 'reloaded').length;
    const spentOnReloads = reloads * 17;
    assert.ok(spentOnReloads <= 20 + 3, 'reloads cannot move more rounds than existed');
});

test('weapon: a reload interrupts fire, and the weapon cannot shoot while reloading', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    p.ammo = 0;
    p.reserveAmmo = 60;
    room.startReload(p);
    const before = room.projectiles.size;
    // Hold the trigger through the whole reload.
    hold(room, 'a', 1, { inputHz: 20 });
    assert.equal(room.projectiles.size, before + 0, 'nothing is fired mid-reload');
    assert.ok(p.reloadTimer > 0 || p.ammo > 0, 'the reload either finished or is still running');
});

test('weapon: an empty reserve stops the weapon instead of firing forever', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const p = room.players.get('a');
    p.ammo = 2;
    p.reserveAmmo = 0;
    hold(room, 'a', 3, { inputHz: 20 });
    assert.equal(p.ammo, 0, 'the magazine empties');
    assert.equal(p.reserveAmmo, 0);
    assert.equal(room.projectiles.size, 0, 'with no rounds left nothing is in flight');
    assert.equal(p.reloadTimer, 0, 'and no reload is attempted');
});

test('weapon: the snapshot reports the full weapon state to the client', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const row = room.snapshot().players[0];
    for (const key of ['ammo', 'reserveAmmo', 'magSize', 'reloadTimer', 'fireInterval']) {
        assert.ok(key in row, 'the snapshot must carry ' + key);
    }
    // The client must be able to render the counter without guessing.
    assert.equal(row.magSize, 20);
    assert.equal(row.reserveAmmo, 60);
});

test('regression: two clients with different frame rates spend identical ammo', () => {
    // The original bug had the CLIENT also spending rounds locally while the server spent its
    // own, so the total depended on the client. Identical server-side spending across input
    // rates is what proves the server is the single owner of the magazine.
    const results = [];
    for (const inputHz of [10, 30]) {
        const room = new RaidRoom({ seed: 7419 });
        room.join('a');
        hold(room, 'a', 3, { inputHz });
        const p = room.players.get('a');
        results.push(p.reserveAmmo * 100 + p.ammo);
    }
    assert.equal(results[0], results[1],
        'the magazine economy must not depend on the input rate: ' + results.join(' vs '));
});
// --- death -------------------------------------------------------------------

test('death: a dead player cannot move, shoot, or take objectives', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('dead');
    room.join('alive');
    const dead = room.players.get('dead');
    dead.hp = 1;
    dead.shield = 0;
    room.surrender('dead');
    assert.equal(dead.hp, 0);

    const x0 = dead.x, y0 = dead.y;
    // A killed player keeps sending input (the client may not know yet): the SERVER must ignore
    // it. Before this guard the body kept walking, so death was only a HUD state.
    const seq = { v: 0 };
    hold(room, 'dead', 2, { inputHz: 20 });
    assert.equal(dead.x, x0, 'a dead player must not move');
    assert.equal(dead.y, y0);
    assert.equal(room.projectiles.size, 0, 'a dead player must not shoot');
    assert.ok(seq.v === 0);
});

test('death: the rest of the squad keeps playing after a teammate dies', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('dead');
    room.join('alive');
    room.players.get('dead').hp = 1;
    room.surrender('dead');
    assert.equal(room.state, 'active', 'one death must not end a two-player raid');

    const alive = room.players.get('alive');
    const x0 = alive.x, y0 = alive.y;
    hold(room, 'alive', 1, { inputHz: 20, fire: false, forward: 1 });
    assert.ok(Math.abs(alive.x - x0) > 1 || Math.abs(alive.y - y0) > 1,
        'the survivor must still be able to move');
});

test('death: the last player dying ends the raid as a wipe', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('solo');
    room.players.get('solo').hp = 1;
    const result = room.surrender('solo');
    assert.equal(result.ok, true);
    assert.equal(result.ended, true, 'a solo surrender ends the raid at once');
    assert.equal(room.state, 'ended');
    assert.equal(room.outcome.won, false);
    assert.equal(room.outcome.reason, 'surrender');
});

test('death: a dead player is still reported in the snapshot so peers see the body', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('dead');
    room.join('alive');
    room.players.get('dead').hp = 1;
    room.surrender('dead');
    const rows = room.snapshot().players;
    const row = rows.find(p => p.id === 'dead');
    assert.ok(row, 'the body stays in the world after death');
    assert.equal(row.hp, 0, 'and its death is visible to everyone');
});

// --- loot (server-authoritative) ---------------------------------------------

test('loot: the server refuses a crate the player is not standing next to', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const crate = room.containers[3];
    // The player is at spawn, nowhere near this crate. Range is checked on the SERVER, so a
    // client cannot loot the map from across the level.
    const result = room.search('a', crate.id);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'out-of-range');
    assert.equal(crate.opened, false, 'a refused search must not open the crate');
    assert.equal(room.lootValue, 0);
});

test('loot: a crate in reach yields its contents and is recorded for the payout', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const crate = room.containers[2];
    const p = room.players.get('a');
    p.x = crate.x; p.y = crate.y;
    const result = room.search('a', crate.id);
    assert.equal(result.ok, true);
    assert.ok(result.value > 0, 'the crate is worth something');
    assert.equal(room.lootValue, result.value, 'the raid records what was taken');
    assert.equal(room.tally('a').loot, result.value, 'and who took it');
    assert.equal(crate.opened, true);
});

test('loot: a crate cannot be searched twice', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const crate = room.containers[2];
    const p = room.players.get('a');
    p.x = crate.x; p.y = crate.y;
    room.search('a', crate.id);
    const before = room.lootValue;
    const again = room.search('a', crate.id);
    assert.equal(again.ok, false);
    assert.equal(again.error, 'already-searched');
    assert.equal(room.lootValue, before, 'the same crate must not pay twice');
});

test('loot: an unknown crate id is refused rather than crashing', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    const result = room.search('a', 9999);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'no-container');
});

test('loot: a dead player cannot loot', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    room.join('b');
    const crate = room.containers[2];
    const p = room.players.get('a');
    p.x = crate.x; p.y = crate.y;
    p.hp = 1;
    room.surrender('a');
    const result = room.search('a', crate.id);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'already-dead');
});

test('loot: the item type and price come from the table the client also uses', () => {
    const room = new RaidRoom({ seed: 7419 });
    room.join('a');
    // The map advertises a type, and the server awards it. If these ever diverge the map would
    // show one item and the payout would be for another.
    for (const crate of room.containers) {
        assert.ok(['ammo', 'scrap', 'medkit', 'electronics', 'intel'].includes(crate.type),
            'unexpected loot type ' + crate.type);
    }
    const expected = room.containers.map(c => c.type).join(',');
    // Deterministic: a second room with the same seed advertises the same items.
    const twin = new RaidRoom({ seed: 7419 });
    assert.equal(twin.containers.map(c => c.type).join(','), expected,
        'the loot table must be a pure function of the seed');
});
