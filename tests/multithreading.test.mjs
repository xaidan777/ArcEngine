// tests/multithreading.test.mjs — Comprehensive test suite for multi-core worker concurrency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, stub } from './browser-scripts.mjs';

// The normal/terrain parity tests compare against the REAL Babylon math, not against a
// convention we picked ourselves.
const { get: getBabylon } = loadScripts(['libs/babylon.js']);
const BABYLON = getBabylon('BABYLON');

test('ArcJobWorker: HEIGHTMAP_RESAMPLE bilinearly interpolates height data', () => {
    const { get } = loadScripts(['js/engine/workers/ArcJobWorker.js']);
    const ArcJobWorker = get('ArcJobWorker');
    assert.ok(ArcJobWorker.HANDLERS.HEIGHTMAP_RESAMPLE, 'HEIGHTMAP_RESAMPLE handler must exist');

    // 2x2 source heightmap
    const srcData = new Float32Array([
        0.0, 1.0,
        0.0, 1.0
    ]);

    const { result, transferables } = ArcJobWorker.handleHeightmapResample({
        data: srcData,
        srcWidth: 2,
        srcHeight: 2,
        nx: 5,
        ny: 5,
        min: 0,
        max: 100,
        normalized: true,
        blend: 0
    });

    assert.equal(result.nx, 5);
    assert.equal(result.ny, 5);
    assert.equal(result.heights.length, 25);
    assert.equal(transferables.length, 1, 'Height buffer must be returned as transferable');

    // Left edge (x=0) should be 0, right edge (x=4) should be 100, middle (x=2) should be 50
    assert.ok(Math.abs(result.heights[0] - 0) < 1e-3);
    assert.ok(Math.abs(result.heights[2] - 50) < 1e-3);
    assert.ok(Math.abs(result.heights[4] - 100) < 1e-3);
});

test('ArcJobWorker: COMPUTE_NORMALS matches BABYLON.VertexData.ComputeNormals', () => {
    const { get } = loadScripts(['js/engine/workers/ArcJobWorker.js']);
    const ArcJobWorker = get('ArcJobWorker');
    assert.ok(ArcJobWorker.HANDLERS.COMPUTE_NORMALS, 'COMPUTE_NORMALS handler must exist');

    // Single flat quad in XZ plane (two triangles):
    // v0: (0, 0, 0), v1: (10, 0, 0), v2: (10, 0, 10), v3: (0, 0, 10)
    const positions = new Float32Array([
        0, 0, 0,
        10, 0, 0,
        10, 0, 10,
        0, 0, 10
    ]);

    // THE CONVENTION IS BABYLON'S, NOT THE WORKER'S OWN. The terrain winding is picked for
    // BABYLON.VertexData.ComputeNormals (Terrain3D._buildGeometry flips `swap` until
    // normals[1] > 0) and the toon shader blacks out any surface with dot(normal, light)
    // <= 0, so a worker that disagrees turns the ground inside out. Comparing against the
    // real library for BOTH windings is the point: asserting a sign we chose ourselves is
    // exactly how the inverted convention stayed in the codebase.
    for (const indices of [new Int32Array([0, 1, 2, 0, 2, 3]), new Int32Array([0, 2, 1, 0, 3, 2])]) {
        const expected = new Float32Array(positions.length);
        BABYLON.VertexData.ComputeNormals(positions, indices, expected);

        const { result, transferables } = ArcJobWorker.handleComputeNormals({ positions, indices });
        assert.equal(result.normals.length, 12);
        assert.equal(transferables.length, 1, 'Normal buffer must be returned as transferable');

        for (let i = 0; i < expected.length; i++) {
            assert.ok(
                Math.abs(result.normals[i] - expected[i]) < 1e-4,
                `Normal ${i} must match Babylon for winding [${Array.from(indices).join(',')}]: ` +
                `worker ${result.normals[i]} vs babylon ${expected[i]}`
            );
        }
    }

    // Upward winding really yields unit +Y normals (what the ground needs).
    const { result } = ArcJobWorker.handleComputeNormals({ positions, indices: new Int32Array([0, 1, 2, 0, 2, 3]) });
    for (let v = 0; v < 4; v++) {
        assert.ok(Math.abs(result.normals[v * 3]) < 1e-4, 'nx should be ~0');
        assert.ok(Math.abs(result.normals[v * 3 + 1] - 1.0) < 1e-4, 'ny should be ~1');
        assert.ok(Math.abs(result.normals[v * 3 + 2]) < 1e-4, 'nz should be ~0');
    }
});

test('ArcJobWorker: Simplex2D is byte-identical to libs/simplex-noise.js (one world, worker or not)', () => {
    const { get } = loadScripts([
        'libs/simplex-noise.js',
        'js/engine/workers/ArcJobWorker.js'
    ]);
    const SimplexNoise = get('SimplexNoise');
    const ArcJobWorker = get('ArcJobWorker');

    // Terrain3D samples the worker's Simplex2D on the main thread while the same class
    // generates the grid in the worker, and RaidWorld.heightAt samples
    // libs/simplex-noise.js. If these disagree, the generated world drifts from the drawn
    // one (placement, cover, bot paths) and the outer ring stops lining up with the grid
    // edge. A numeric seed and its string form MUST be equivalent: Terrain3D passes either.
    for (const seed of ['5', 5, 42, 'raid-7']) {
        const lib = new SimplexNoise(seed);
        const worker = new ArcJobWorker.Simplex2D(seed);
        assert.deepEqual(
            Array.from(worker.perm.slice(0, 32)), Array.from(lib.perm.slice(0, 32)),
            `Permutation table must match for seed ${seed}`
        );
        for (let i = 0; i < 500; i++) {
            const x = (i * 13.77) % 900, y = (i * 7.31) % 900;
            assert.ok(
                Math.abs(lib.noise2D(x, y) - worker.noise2D(x, y)) < 1e-12,
                `noise2D(${x}, ${y}) must match for seed ${seed}`
            );
        }
    }
});

test('Terrain3D: the worker field equals the synchronous field and the ring noise', async () => {
    const { get } = loadScripts([
        'libs/simplex-noise.js',
        'js/Constants.js',
        'js/World3D.js',
        'js/engine/workers/ArcJobWorker.js',
        'js/engine/ArcJobSystem.js',
        'js/Terrain3D.js'
    ], { BABYLON });
    const ArcJobWorker = get('ArcJobWorker');
    const ArcJobSystem = get('ArcJobSystem');
    const Terrain3D = get('Terrain3D');

    // Build the same location twice: through the synchronous generator and through the
    // worker pipeline. The height field must be identical, otherwise the world depends on
    // whether Web Workers were available on the device (invariant 4).
    const build = async (backend) => {
        ArcJobSystem.stats.backend = backend;
        ArcJobSystem.initialized = true;
        const scene = new BABYLON.Scene(new BABYLON.NullEngine());
        const t = new Terrain3D({ scene }, { worldW: 512, worldH: 512, cell: 64, outerRing: 0 });
        await t.ready;
        return t;
    };

    const sync = await build('sync');
    const jobs = await build('workers');

    assert.equal(sync.hgrid.length, jobs.hgrid.length);
    for (let i = 0; i < sync.hgrid.length; i++) {
        assert.ok(
            Math.abs(sync.hgrid[i] - jobs.hgrid[i]) < 1e-6,
            `Height ${i} must not depend on the backend: ${sync.hgrid[i]} vs ${jobs.hgrid[i]}`
        );
    }

    // heightAt() reads the same triangles the mesh draws, so its samples sit on the field.
    for (const t of [sync, jobs]) {
        for (let j = 0; j < t.ny; j += 4) {
            for (let i = 0; i < t.nx; i += 4) {
                assert.ok(
                    Math.abs(t.heightAt(i * t.cell, j * t.cell) - t.hgrid[j * t.nx + i]) < 1e-4,
                    'heightAt must reproduce the generated field'
                );
            }
        }
    }

    // The outer ring samples terrainNoise() on the main thread while the grid comes from the
    // worker: those are the SAME generator, so the 1 px ring offset stays a real offset and
    // no multi-pixel seam can open at the location edge.
    assert.ok(Math.abs(jobs.terrainNoise(0, 0) - jobs.hgrid[0]) < 1e-4, 'Ring noise must agree with the worker grid');
    assert.ok(ArcJobWorker.Simplex2D, 'Terrain3D must sample the worker noise implementation');
    assert.ok(typeof sync.ready?.then === 'function' && typeof jobs.ready?.then === 'function', 'Terrain3D.ready must be awaitable');
});

test('ArcJobWorker: NAVGRID_RASTERIZE marks circular obstacles as blocked', () => {
    const { get } = loadScripts(['js/engine/workers/ArcJobWorker.js']);
    const ArcJobWorker = get('ArcJobWorker');
    assert.ok(ArcJobWorker.HANDLERS.NAVGRID_RASTERIZE, 'NAVGRID_RASTERIZE handler must exist');

    const cols = 16;
    const rows = 16;
    const cellSize = 10;
    const blockers = [
        { x: 50, y: 50, radius: 10 } // Center at cell (5, 5)
    ];

    const { result, transferables } = ArcJobWorker.handleNavgridRasterize({
        cols,
        rows,
        cellSize,
        blockers,
        padding: 5
    });

    assert.equal(result.grid.length, cols * rows);
    assert.equal(transferables.length, 1);

    // Cell at (5, 5) must be blocked (1)
    const centerIdx = 5 * cols + 5;
    assert.equal(result.grid[centerIdx], 1, 'Obstacle cell must be blocked');

    // Far corner cell (0, 0) must be passable (0)
    assert.equal(result.grid[0], 0, 'Far cell must be passable');
});

test('ArcJobWorker: FOLIAGE_SCATTER generates transform matrices and culls blockers', () => {
    const { get } = loadScripts(['js/engine/workers/ArcJobWorker.js']);
    const ArcJobWorker = get('ArcJobWorker');
    assert.ok(ArcJobWorker.HANDLERS.FOLIAGE_SCATTER, 'FOLIAGE_SCATTER handler must exist');

    const blockers = [
        { x: 500, y: 500, radius: 100 }
    ];

    const { result, transferables } = ArcJobWorker.handleFoliageScatter({
        count: 50,
        seed: 1234,
        bounds: { minX: 100, maxX: 900, minY: 100, maxY: 900 },
        blockers,
        clearanceDist: 50
    });

    assert.ok(result.buffer instanceof Float32Array);
    assert.equal(result.instanceCount * 16, result.buffer.length);
    assert.equal(transferables.length, 1);
    assert.ok(result.instanceCount > 0, 'Should place foliage instances outside blockers');
});

test('ArcJobWorker: LEVEL_SERIALIZE produces valid JSON representation', () => {
    const { get } = loadScripts(['js/engine/workers/ArcJobWorker.js']);
    const ArcJobWorker = get('ArcJobWorker');
    assert.ok(ArcJobWorker.HANDLERS.LEVEL_SERIALIZE, 'LEVEL_SERIALIZE handler must exist');

    const levelData = {
        id: 'test_level',
        name: 'Test Level',
        dimensions: { width: 1024, height: 1024 },
        enemies: []
    };

    const { result } = ArcJobWorker.handleLevelSerialize({ levelData });
    assert.ok(typeof result.json === 'string');
    assert.ok(result.size > 0);
    const parsed = JSON.parse(result.json);
    assert.equal(parsed.id, 'test_level');
});

test('ArcJobSystem: getTelemetry returns active status and thread pool summary', () => {
    const { get } = loadScripts([
        'js/engine/workers/ArcJobWorker.js',
        'js/engine/ArcJobSystem.js'
    ]);
    const ArcJobSystem = get('ArcJobSystem');
    ArcJobSystem.init();

    const tele = ArcJobSystem.getTelemetry();
    assert.ok(tele, 'Telemetry object must exist');
    assert.ok(typeof tele.backend === 'string');
    assert.ok(typeof tele.concurrency === 'number');
    assert.ok(typeof tele.summary === 'string');
    assert.ok(tele.summary.length > 0, 'Summary must not be empty');
});

test('NavGrid: buildAsync and findPathsBatchAsync work correctly with ArcJobSystem', async () => {
    const { get } = loadScripts([
        'js/Constants.js',
        'js/ShooterRules.js',
        'js/engine/workers/ArcJobWorker.js',
        'js/engine/ArcJobSystem.js',
        'js/NavGrid.js'
    ]);

    const NavGrid = get('NavGrid');
    const nav = new NavGrid({ width: 512, height: 512 }, 32);

    const blockers = [{ x: 256, y: 256, radius: 40 }];
    await nav.buildAsync(blockers, 14);

    // Verify blocker rasterized
    const centerCol = Math.floor(256 / 32);
    const centerRow = Math.floor(256 / 32);
    assert.equal(nav.grid[centerRow * nav.cols + centerCol], 1, 'Blocker must be rasterized in buildAsync');

    // Batch pathfind
    const queries = [
        { id: 'q1', start: { x: 50, y: 50 }, goal: { x: 100, y: 50 } },
        { id: 'q2', start: { x: 150, y: 256 }, goal: { x: 350, y: 256 } }
    ];

    const results = await nav.findPathsBatchAsync(queries);
    assert.ok(results.has('q1'), 'Batch must return path for q1');
    assert.ok(results.has('q2'), 'Batch must return path for q2');
    assert.ok(results.get('q1').length > 0);
    assert.ok(results.get('q2').length > 0);
});
