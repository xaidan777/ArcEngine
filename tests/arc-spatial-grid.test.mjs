// ============================================================================
//  ArcEngine — ArcSpatialGrid Test Suite
// ----------------------------------------------------------------------------
//  Tests 2D spatial partitioning on vast maps (e.g. 4096x4096):
//  - Configurable cellSize (default 128 px)
//  - Multi-cell overlapping insert & removal
//  - Conditional re-indexing in update
//  - queryRadius (Euclidean, deduplicated, bounding cells only)
//  - queryBox (circle-AABB intersection)
//  - queryRay (DDA / Amanatides-Woo grid line traversal)
//  - findNearest (Euclidean closest within maxRadius)
//  - clear and getStats
//  - Universal export (window, globalThis, module.exports)
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { ArcSpatialGrid } from '../js/engine/ArcSpatialGrid.js';
import { loadScripts } from './browser-scripts.mjs';

test('ArcSpatialGrid: constructor configuration and default cellSize', () => {
    const defaultGrid = new ArcSpatialGrid();
    assert.equal(defaultGrid.cellSize, 128);
    assert.deepEqual(defaultGrid.getStats(), {
        entityCount: 0,
        activeCellCount: 0,
        cellSize: 128
    });

    const customGrid = new ArcSpatialGrid(64);
    assert.equal(customGrid.cellSize, 64);
    assert.equal(customGrid.getStats().cellSize, 64);

    const objConfigGrid = new ArcSpatialGrid({ cellSize: 256 });
    assert.equal(objConfigGrid.cellSize, 256);
});

test('ArcSpatialGrid: multi-cell overlapping insertion and bounds storage', () => {
    const grid = new ArcSpatialGrid(100);
    const largeEntity = { id: 'boss', name: 'Goliath' };

    // At (100, 100) with radius 120: spans x from -20 to 220, y from -20 to 220
    // Cells: cx in [-1, 0, 1, 2], cy in [-1, 0, 1, 2] -> 4x4 = 16 cells
    grid.insert(largeEntity, 100, 100, 120);

    const stats = grid.getStats();
    assert.equal(stats.entityCount, 1);
    assert.equal(stats.activeCellCount, 16);

    const entry = grid.entries.get(largeEntity);
    assert.ok(entry);
    assert.equal(entry.x, 100);
    assert.equal(entry.y, 100);
    assert.equal(entry.radius, 120);
    assert.equal(entry.minCx, -1);
    assert.equal(entry.maxCx, 2);
    assert.equal(entry.minCy, -1);
    assert.equal(entry.maxCy, 2);
});

test('ArcSpatialGrid: update only re-indexes when cell bounds change', () => {
    const grid = new ArcSpatialGrid(128);
    const player = { id: 'player' };

    grid.insert(player, 50, 50, 10);
    assert.equal(grid.getStats().activeCellCount, 1);

    // Minor movement within same cell [0..128]
    grid.update(player, 55, 52, 10);
    const entry = grid.entries.get(player);
    assert.equal(entry.x, 55);
    assert.equal(entry.y, 52);
    assert.equal(entry.minCx, 0);
    assert.equal(entry.maxCx, 0);
    assert.equal(grid.getStats().activeCellCount, 1);

    // Major movement crossing cell boundary into cell (2, 2)
    grid.update(player, 300, 300, 10);
    assert.equal(entry.x, 300);
    assert.equal(entry.y, 300);
    assert.equal(entry.minCx, 2);
    assert.equal(entry.maxCx, 2);
    assert.equal(grid.getStats().activeCellCount, 1);
    // Ensure old cell (0, 0) was pruned
    assert.equal(grid.cells.has('0:0'), false);
    assert.equal(grid.cells.has('2:2'), true);
});

test('ArcSpatialGrid: remove entity cleans up active cells', () => {
    const grid = new ArcSpatialGrid(100);
    const drone1 = { id: 'd1' };
    const drone2 = { id: 'd2' };

    grid.insert(drone1, 95, 95, 10); // Overlaps 4 cells (0,0), (1,0), (0,1), (1,1)
    grid.insert(drone2, 50, 50, 5);  // Located strictly in cell (0,0)

    assert.equal(grid.getStats().entityCount, 2);
    assert.equal(grid.getStats().activeCellCount, 4);

    const removed = grid.remove(drone1);
    assert.equal(removed, true);
    assert.equal(grid.getStats().entityCount, 1);
    // Since drone2 is only in (0,0), other 3 cells should have been removed
    assert.equal(grid.getStats().activeCellCount, 1);

    // Non-existent entity
    assert.equal(grid.remove({ id: 'ghost' }), false);
});

test('ArcSpatialGrid: queryRadius returns deduplicated entities and filters', () => {
    const grid = new ArcSpatialGrid(100);
    const a = { id: 'a', tag: 'enemy' };
    const b = { id: 'b', tag: 'friendly' };
    const c = { id: 'c', tag: 'enemy' };

    grid.insert(a, 100, 100, 20);
    grid.insert(b, 130, 100, 15);
    grid.insert(c, 500, 500, 10);

    // Radius 60 from (100, 100): covers A (dist 0 <= 80) and B (dist 30 <= 60+15=75)
    const allNear = grid.queryRadius(100, 100, 60);
    assert.equal(allNear.length, 2);
    assert.ok(allNear.includes(a));
    assert.ok(allNear.includes(b));

    // With filterFn
    const enemyNear = grid.queryRadius(100, 100, 60, e => e.tag === 'enemy');
    assert.equal(enemyNear.length, 1);
    assert.equal(enemyNear[0].id, 'a');

    // Negative radius returns empty array
    assert.deepEqual(grid.queryRadius(100, 100, -5), []);
});

test('ArcSpatialGrid: queryBox detects overlapping bounding box', () => {
    const grid = new ArcSpatialGrid(100);
    const turret = { id: 'turret', faction: 'syndicate' };
    const crate = { id: 'crate', faction: 'loot' };

    grid.insert(turret, 150, 150, 25);
    grid.insert(crate, 350, 350, 10);

    // Box covering [100, 100] to [200, 200]
    const boxEntities = grid.queryBox(100, 100, 200, 200);
    assert.equal(boxEntities.length, 1);
    assert.equal(boxEntities[0].id, 'turret');

    // Filtered box query
    const filtered = grid.queryBox(0, 0, 400, 400, e => e.faction === 'loot');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'crate');
});

test('ArcSpatialGrid: queryRay uses DDA to traverse cells along ray', () => {
    const grid = new ArcSpatialGrid(100);
    const target1 = { id: 't1' }; // Cell (0, 0)
    const target2 = { id: 't2' }; // Cell (1, 0)
    const target3 = { id: 't3' }; // Cell (2, 0)
    const offPath = { id: 'off' }; // Cell (1, 2)

    grid.insert(target1, 50, 50, 10);
    grid.insert(target2, 150, 50, 10);
    grid.insert(target3, 250, 50, 10);
    grid.insert(offPath, 150, 250, 10);

    // Horizontal ray from (10, 50) to (280, 50) traverses cells (0,0), (1,0), (2,0)
    const rayResults = grid.queryRay(10, 50, 280, 50);
    assert.equal(rayResults.length, 3);
    assert.ok(rayResults.includes(target1));
    assert.ok(rayResults.includes(target2));
    assert.ok(rayResults.includes(target3));
    assert.equal(rayResults.includes(offPath), false);

    // Diagonal ray
    const diagTarget = { id: 'diag' };
    grid.insert(diagTarget, 150, 150, 10); // Cell (1, 1)
    const diagResults = grid.queryRay(0, 0, 250, 250);
    assert.ok(diagResults.includes(diagTarget));
});

test('ArcSpatialGrid: findNearest retrieves closest entity within maxRadius', () => {
    const grid = new ArcSpatialGrid(100);
    const n1 = { id: 'n1', hp: 100 };
    const n2 = { id: 'n2', hp: 0 };

    grid.insert(n1, 100, 100, 10); // dist ~14.14 from (90, 90)
    grid.insert(n2, 92, 92, 10);   // dist ~2.83 from (90, 90)

    const nearestAny = grid.findNearest(90, 90, 100);
    assert.equal(nearestAny.id, 'n2');

    // Filter to only alive entities
    const nearestAlive = grid.findNearest(90, 90, 100, e => e.hp > 0);
    assert.equal(nearestAlive.id, 'n1');

    // Out of maxRadius returns null (query far from any entity)
    assert.equal(grid.findNearest(9999, 9999, 1), null);
});

test('ArcSpatialGrid: clear resets all internal state', () => {
    const grid = new ArcSpatialGrid(128);
    for (let i = 0; i < 20; i++) {
        grid.insert({ id: i }, i * 50, i * 50, 10);
    }
    assert.equal(grid.getStats().entityCount, 20);
    assert.ok(grid.getStats().activeCellCount > 0);

    grid.clear();
    assert.equal(grid.getStats().entityCount, 0);
    assert.equal(grid.getStats().activeCellCount, 0);
    assert.deepEqual(grid.queryRadius(0, 0, 1000), []);
});

test('ArcSpatialGrid: universal export (window, globalThis, module.exports)', () => {
    assert.ok(ArcSpatialGrid);
    assert.equal(typeof ArcSpatialGrid, 'function');

    // Test in simulated browser scripts environment
    const { ctx } = loadScripts(['js/Constants.js', 'js/engine/ArcSpatialGrid.js']);
    assert.ok(ctx.ArcSpatialGrid, 'ArcSpatialGrid attached to window in browser scripts');
    assert.equal(typeof ctx.ArcSpatialGrid, 'function');

    const browserGrid = new ctx.ArcSpatialGrid(128);
    assert.equal(browserGrid.cellSize, 128);
});
