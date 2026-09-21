// Tests for DBNO (Down But Not Out) and Field Revive mechanics in BlackWater Protocol.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RaidRoom, PROTOCOL_VERSION, TICK_RATE } from '../server/simulation.mjs';

const cmd = (sequence = 0, extra = {}) => ({
    version: PROTOCOL_VERSION,
    sequence,
    forward: 0,
    right: 0,
    heading: 0,
    sprint: false,
    ...extra,
});

test('DBNO: lethal damage puts player into DBNO if alive teammates exist', () => {
    const room = new RaidRoom({ seed: 1001 });
    room.join('alpha');
    room.join('bravo');

    const pAlpha = room.players.get('alpha');
    pAlpha.x = 300; pAlpha.y = 1000;
    const pBravo = room.players.get('bravo');
    pBravo.x = 400; pBravo.y = 1000;

    // Direct lethal damage to alpha (deplete shield and health)
    pAlpha.shield = 0;
    pAlpha.hp = 10;

    // Spawn a hostile projectile hitting alpha
    pAlpha.hp = 0; // Trigger check
    // Alternatively test via projectile hit or check how DBNO is triggered in ballistics
    // Let's test shooting:
    pBravo.fireCooldown = 0;
    pBravo.heading = Math.PI; // aiming west towards alpha
    pBravo.x = 450; pBravo.y = 1000;
    pAlpha.x = 350; pAlpha.y = 1000;
    pAlpha.shield = 0;
    pAlpha.hp = 20;

    room.input('bravo', cmd(0, { fire: true, heading: Math.PI, pitch: 0 }));
    // Step simulation until bullet hits
    for (let i = 0; i < 10; i++) room.step();

    assert.equal(pAlpha.downed, true, 'alpha should enter DBNO state');
    assert.equal(pAlpha.hp, 0, 'alpha HP is 0 in DBNO');
    assert.equal(pAlpha.downedHp, 100, 'alpha starts with 100 downedHp');
    assert.ok(pAlpha.downedTimer > 55, 'alpha has ~60s bleedout timer');
    assert.equal(pAlpha.posture, 'crawling');
    assert.equal(room.state, 'active', 'raid continues while bravo is standing');
    assert.ok(room.events.some(e => e.type === 'playerDowned' && e.playerId === 'alpha'));
});

test('DBNO: bleedout kills the player when timer expires', () => {
    const room = new RaidRoom({ seed: 1002 });
    room.join('alpha');
    room.join('bravo');

    const pAlpha = room.players.get('alpha');
    pAlpha.downed = true;
    pAlpha.downedHp = 100;
    pAlpha.downedTimer = 0.05; // almost expired (3 ticks at 60Hz)
    pAlpha.hp = 0;

    for (let i = 0; i < 6; i++) room.step();

    assert.equal(pAlpha.downed, false);
    assert.equal(pAlpha.hp, 0);
    assert.ok(room.casualties.has('alpha'), 'alpha is now a casualty');
    assert.ok(room.events.some(e => e.type === 'bleedout' && e.playerId === 'alpha'));
});

test('DBNO: downed player can be executed by further damage', () => {
    const room = new RaidRoom({ seed: 1003 });
    room.join('alpha');
    room.join('bravo');

    const pAlpha = room.players.get('alpha');
    pAlpha.x = 350; pAlpha.y = 1000;
    pAlpha.downed = true;
    pAlpha.downedHp = 15; // low downed HP
    pAlpha.hp = 0;

    const pBravo = room.players.get('bravo');
    pBravo.x = 450; pBravo.y = 1000;
    pBravo.fireCooldown = 0;

    // Bravo shoots downed alpha
    room.input('bravo', cmd(0, { fire: true, heading: Math.PI, pitch: 0 }));
    for (let i = 0; i < 10; i++) room.step();

    assert.equal(pAlpha.downed, false, 'alpha is no longer downed');
    assert.equal(pAlpha.hp, 0, 'alpha is dead');
    assert.ok(room.casualties.has('alpha'), 'alpha is a casualty');
    assert.ok(room.events.some(e => e.type === 'kill' && e.victimId === 'alpha'));
});

test('DBNO: squad wipes if all living players are downed', () => {
    const room = new RaidRoom({ seed: 1004 });
    room.join('alpha');
    room.join('bravo');

    const pAlpha = room.players.get('alpha');
    pAlpha.downed = true;
    pAlpha.downedHp = 100;
    pAlpha.downedTimer = 60;
    pAlpha.hp = 0;

    const pBravo = room.players.get('bravo');
    pBravo.downed = true;
    pBravo.downedHp = 100;
    pBravo.downedTimer = 60;
    pBravo.hp = 0;

    room.step();

    assert.equal(room.state, 'ended', 'raid must end in wipe when all players are downed');
    assert.equal(room.outcome.won, false);
    assert.equal(room.outcome.reason, 'wipe');
});

test('Revive: teammate can revive a downed player by holding revive', () => {
    const room = new RaidRoom({ seed: 1005 });
    room.join('alpha');
    room.join('bravo');

    const pAlpha = room.players.get('alpha');
    pAlpha.x = 350; pAlpha.y = 1000;
    pAlpha.downed = true;
    pAlpha.downedHp = 100;
    pAlpha.downedTimer = 60;
    pAlpha.hp = 0;

    const pBravo = room.players.get('bravo');
    pBravo.x = 380; pBravo.y = 1000; // 30 px away, well within 75 px range

    // Bravo sends revive command targeting alpha
    for (let sec = 0; sec < 6; sec++) {
        for (let tick = 0; tick < TICK_RATE; tick++) {
            room.input('bravo', cmd(sec * TICK_RATE + tick, { reviveTarget: 'alpha' }));
            room.step();
        }
    }

    assert.equal(pAlpha.downed, false, 'alpha is revived');
    assert.equal(pAlpha.hp, 30, 'alpha revived with 30 HP');
    assert.equal(pAlpha.posture, 'crouch');
    assert.equal(pBravo.revivingTargetId, null);
    assert.ok(room.events.some(e => e.type === 'playerRevived' && e.targetId === 'alpha' && e.reviverId === 'bravo'));
});

test('Revive: distance or interruption aborts revive progress', () => {
    const room = new RaidRoom({ seed: 1006 });
    room.join('alpha');
    room.join('bravo');

    const pAlpha = room.players.get('alpha');
    pAlpha.x = 350; pAlpha.y = 1000;
    pAlpha.downed = true;
    pAlpha.downedHp = 100;
    pAlpha.downedTimer = 60;
    pAlpha.hp = 0;

    const pBravo = room.players.get('bravo');
    pBravo.x = 380; pBravo.y = 1000;

    // Revive for 2 seconds (not enough for 5s threshold)
    for (let i = 0; i < 2 * TICK_RATE; i++) {
        room.input('bravo', cmd(i, { reviveTarget: 'alpha' }));
        room.step();
    }
    assert.ok(pAlpha.reviveProgress > 1.8, 'revive progress accumulated');
    assert.equal(pAlpha.downed, true, 'still downed');

    // Bravo stops reviving and walks away
    pBravo.x = 600;
    for (let i = 0; i < 3 * TICK_RATE; i++) {
        room.input('bravo', cmd(1000 + i, { reviveTarget: null }));
        room.step();
    }

    assert.equal(pAlpha.downed, true, 'still downed');
    assert.equal(pAlpha.reviveProgress, 0, 'revive progress decayed back to 0');
});
