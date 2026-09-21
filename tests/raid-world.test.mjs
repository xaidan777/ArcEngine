// RaidWorld — the authoritative map. These tests pin the two properties the online game
// depends on: the world is DETERMINISTIC (same seed -> same layout, byte for byte) and it
// carries real collision data (every blocker has a height, coarse geometry is registered).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

// SimplexNoise is a browser global; RaidWorld reads it by `typeof` (invariant 3).
const simplex = loadScripts(['libs/simplex-noise.js']).get('SimplexNoise');

function world() {
    return loadScripts(['js/Constants.js', 'js/ShooterRules.js', 'js/RaidWorld.js'], { SimplexNoise: simplex }).get('RaidWorld');
}

test('RaidWorld: bounds come from Constants.js, not from hardcoded duplicates', () => {
    const w = world();
    const b = w.bounds();
    assert.equal(b.width, 4096);
    assert.equal(b.height, 4096);
});

test('RaidWorld: the same seed produces an identical world (server and client must agree)', () => {
    // Two INDEPENDENT module contexts, because that is the real situation: Node runs one
    // copy of the rules for the server and the browser runs another. `deepEqual` cannot be
    // used directly — functions created in separate vm contexts are never reference-equal —
    // so compare the serialised world, which is exactly what crosses the wire.
    const a = world().build(7419);
    const b = world().build(7419);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    // Crossing a process boundary: the world must survive a JSON round trip unchanged.
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(a))), JSON.stringify(a));
    // A different seed may select a different authored layout, but must stay valid.
    const c = world().build(7420);
    assert.equal(c.blockers.length, a.blockers.length);
    assert.equal(c.enemies.length, a.enemies.length);
});

test('RaidWorld: every blocker carries a real height (no 80 px default, no solid air)', () => {
    const built = world().build(1);
    assert.ok(built.blockers.length > 20, 'expected the district geometry');
    for (const b of built.blockers) {
        assert.equal(typeof b.height, 'number', `blocker at ${b.x},${b.y} has no height`);
        assert.ok(b.height > 0 && b.height < 1000, `implausible height ${b.height}`);
        assert.ok(b.radius > 0);
    }
    // Low cover must stay low: a crate is not a wall.
    const low = built.blockers.filter(b => b.height <= 60);
    assert.ok(low.length > 0, 'expected some low props');
});

test('RaidWorld: tanks are tall enough to stop a shot, crates are not walls', () => {
    const built = world().build(1);
    const tank = built.blockers.find(b => b.radius > 100);
    assert.ok(tank && tank.height >= 200, 'a storage vessel must be tall');
    const crate = built.containers[0];
    assert.equal(crate.height, 50);
});

test('RaidWorld: terrain height is analytic and device independent', () => {
    const w = world();
    const h1 = w.heightAt(1024, 2048);
    const h2 = w.heightAt(1024, 2048);
    assert.equal(h1, h2, 'heightAt must be pure');
    assert.equal(typeof h1, 'number');
    assert.ok(Number.isFinite(h1));
    // Two different points should not both be the flat base by accident.
    const samples = [w.heightAt(0, 0), w.heightAt(500, 900), w.heightAt(2000, 3000), w.heightAt(4000, 4000)];
    assert.ok(samples.every(Number.isFinite));
    assert.ok(new Set(samples).size > 1, 'noise must vary across the map');
});

test('RaidWorld: the enemy roster covers the full archetype set, with reinforcements dormant', () => {
    const built = world().build(1);
    assert.ok(built.enemies.length >= 12, 'the layout authors 16 points');
    const kinds = new Set(built.enemies.map(e => e.archetype));
    assert.ok(kinds.size >= 6, 'expected varied archetypes, got ' + [...kinds].join(','));
    assert.ok(built.enemies.some(e => e.dormant), 'a reinforcement wave must be dormant');
    assert.ok(built.enemies.some(e => !e.dormant), 'and the garrison must be active');
    // IDs are stable and unique: the network addresses actors by id.
    assert.equal(new Set(built.enemies.map(e => e.id)).size, built.enemies.length);
});

test('RaidWorld: objectives are laid out and reachable inside the bounds', () => {
    const built = world().build(1);
    assert.equal(built.drives.length, 3);
    assert.equal(built.containers.length, 8);
    assert.ok(built.extraction.x > 0 && built.extraction.x < built.width);
    assert.ok(built.hatch.radius > 0);
    for (const d of built.drives) {
        assert.ok(d.x > 0 && d.x < built.width && d.y > 0 && d.y < built.height);
    }
    for (const c of built.containers) {
        assert.ok(c.x > 0 && c.x < built.width && c.y > 0 && c.y < built.height);
        assert.equal(typeof c.type, 'string');
    }
});

test('RaidWorld: server-side collision actually stops a projectile on a crate and a tank', () => {
    const scripts = loadScripts(['js/Constants.js', 'js/ShooterRules.js', 'js/RaidWorld.js'], { SimplexNoise: simplex });
    const w = scripts.get('RaidWorld');
    const S = scripts.get('ShooterRules');
    const built = w.build(1);
    const fly = (from) => {
        const proj = S.createProjectile({
            id: 't', shooterId: 0, x: from.x - 300, y: from.y, h: from.h,
            vx: 900, vy: 0, vh: 0, damage: 34, speed: 900, gravity: 0, drag: 0, maxRange: 1600,
        });
        let r = null;
        for (let i = 0; i < 200; i++) {
            r = S.stepProjectile(proj, 1 / 60, [], built.cover, (x, y) => w.heightAt(x, y));
            if (r.hit || r.expired) break;
        }
        return r;
    };
    const tank = built.blockers.find(b => b.radius > 100);
    const groundTank = w.heightAt(tank.x, tank.y);
    const tankHit = fly({ x: tank.x, y: tank.y, h: groundTank + 60 });
    assert.ok(tankHit.hit && tankHit.type === 'blocker', 'a shot at chest height must stop on the tank');

    const crate = built.containers[0];
    const groundCrate = w.heightAt(crate.x, crate.y);
    const crateHit = fly({ x: crate.x, y: crate.y, h: groundCrate + 25 });
    assert.ok(crateHit.hit && crateHit.type === 'blocker', 'a crate must stop a shot');
    const overHit = fly({ x: crate.x, y: crate.y, h: groundCrate + crate.height + 40 });
    assert.ok(!overHit.hit || overHit.type !== 'blocker', 'a shot above the crate must not hit it');
});