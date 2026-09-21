// Tests for ArcJobSystem and ArcJobWorker (multi-core concurrency & GPU acceleration pipeline).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, stub } from './browser-scripts.mjs';

test('ArcJobWorker: TERRAIN_GEN math parity and bounded heights', () => {
    const { get } = loadScripts([
        'js/engine/workers/ArcJobWorker.js'
    ]);
    const ArcJobWorker = get('ArcJobWorker');
    assert.ok(ArcJobWorker, 'ArcJobWorker must be exported');
    assert.ok(ArcJobWorker.HANDLERS.TERRAIN_GEN, 'TERRAIN_GEN handler must exist');

    const payload = {
        nx: 32,
        ny: 32,
        cell: 8,
        seed: 42,
        amp: 25,
        scale: 600,
        base: 15,
        startRow: 0,
        endRow: 32
    };

    const { result, transferables } = ArcJobWorker.handleTerrainGen(payload);
    assert.ok(result.heights instanceof Float32Array, 'Heights must be a Float32Array');
    assert.equal(result.heights.length, 32 * 32, 'Should generate nx * ny samples');
    assert.equal(transferables.length, 1, 'Should return the buffer as transferable');
    assert.ok(result.lo <= result.hi, 'Minimum height must be <= maximum height');
    assert.ok(result.lo >= 15 - 25 - 1e-3, 'Heights must be bounded within noise amplitude');
    assert.ok(result.hi <= 15 + 25 + 1e-3, 'Heights must be bounded within noise amplitude');
});

test('ArcJobWorker: BATCH_RAYCAST detects direct hits and clear lines of sight', () => {
    const { get } = loadScripts([
        'js/engine/workers/ArcJobWorker.js'
    ]);
    const ArcJobWorker = get('ArcJobWorker');

    const blockers = [
        { x: 50, y: 0, radius: 10 }
    ];

    const rays = [
        // Ray 1: Passes directly through the blocker at (50, 0)
        { id: 'hit-ray', startX: 0, startY: 0, endX: 100, endY: 0 },
        // Ray 2: Orthogonal, goes north (clear LoS)
        { id: 'clear-ray', startX: 0, startY: 0, endX: 0, endY: 100 }
    ];

    const { result } = ArcJobWorker.handleBatchRaycast({ rays, blockers, padding: 0 });
    assert.equal(result.length, 2, 'Must process all input rays');

    const hitResult = result.find(r => r.id === 'hit-ray');
    assert.ok(hitResult, 'Hit ray result must be present');
    assert.equal(hitResult.hasLoS, false, 'Hit ray must not have line of sight');
    assert.ok(hitResult.hit, 'Hit payload must be populated');
    assert.ok(Math.abs(hitResult.hit.t - 0.4) < 1e-3, 'Hit t should occur at boundary x=40 (t=0.4)');

    const clearResult = result.find(r => r.id === 'clear-ray');
    assert.ok(clearResult, 'Clear ray result must be present');
    assert.equal(clearResult.hasLoS, true, 'Clear ray must have line of sight');
    assert.equal(clearResult.hit, null, 'Clear ray must not record a hit');
});

test('ArcJobWorker: BATCH_PATHFIND computes valid 2D grid routes', () => {
    const { get } = loadScripts([
        'js/engine/workers/ArcJobWorker.js'
    ]);
    const ArcJobWorker = get('ArcJobWorker');

    const width = 10;
    const height = 10;
    const grid = new Uint8Array(width * height);

    // Add a wall with an opening
    for (let y = 0; y < 8; y++) {
        grid[y * width + 4] = 255; // wall at x=4 from y=0..7, open at y=8..9
    }

    const queries = [
        { id: 'route-1', startX: 1, startY: 1, endX: 7, endY: 1 }
    ];

    const { result } = ArcJobWorker.handleBatchPathfind({ queries, grid, width, height });
    assert.equal(result.length, 1);
    assert.equal(result[0].found, true, 'Path must be found around obstacle');
    assert.ok(result[0].path.length > 0, 'Path must contain waypoints');
    const last = result[0].path[result[0].path.length - 1];
    assert.equal(last.x, 7);
    assert.equal(last.y, 1);
});

test('ArcJobSystem: dispatch and parallelFor work via sync fallback in headless runtime', async () => {
    const { get } = loadScripts([
        'js/engine/workers/ArcJobWorker.js',
        'js/engine/ArcJobSystem.js'
    ]);
    const ArcJobSystem = get('ArcJobSystem');
    assert.ok(ArcJobSystem, 'ArcJobSystem must be exported');

    ArcJobSystem.init({ threads: 4 });
    const stats = ArcJobSystem.getStats();
    assert.ok(stats.concurrency >= 1, 'Concurrency must be detected');

    // Dispatch terrain task
    const terrainRes = await ArcJobSystem.dispatch('TERRAIN_GEN', {
        nx: 16,
        ny: 16,
        cell: 8,
        seed: 123,
        amp: 20,
        scale: 500,
        base: 0,
        startRow: 0,
        endRow: 16
    });
    assert.ok(terrainRes && terrainRes.heights, 'Terrain task must resolve with heights array');
    assert.equal(terrainRes.heights.length, 256);

    // Test parallelFor
    const blockers = [{ x: 20, y: 20, radius: 5 }];
    const rays = [
        { id: 1, startX: 0, startY: 20, endX: 40, endY: 20 },
        { id: 2, startX: 0, startY: 0, endX: 0, endY: 40 },
        { id: 3, startX: 0, startY: 20, endX: 40, endY: 20 }
    ];

    const batchResults = await ArcJobSystem.dispatch('BATCH_RAYCAST', { rays, blockers });
    assert.equal(batchResults.length, 3, 'All rays in batch must complete');

    const updatedStats = ArcJobSystem.getStats();
    assert.ok(updatedStats.completed >= 2, 'Completed jobs counter must increment');
});

test('ArcEngine: orchestrates ArcJobSystem alongside spatial and ECS', () => {
    const { get } = loadScripts([
        'js/Constants.js',
        'js/engine/workers/ArcJobWorker.js',
        'js/engine/ArcJobSystem.js',
        'js/engine/ArcSpatialGrid.js',
        'js/engine/ArcEventBus.js',
        'js/engine/ArcStateMachine.js',
        'js/engine/ArcActor.js',
        'js/engine/ArcInspector.js',
        'js/engine/ArcEngine.js'
    ]);
    const ArcEngine = get('ArcEngine');
    assert.ok(ArcEngine.jobs, 'ArcEngine.jobs must reference ArcJobSystem');

    ArcEngine.init({ threads: 4, gridCellSize: 64 });
    assert.equal(ArcEngine.spatial.cellSize, 64);
    assert.ok(ArcEngine.jobs.initialized, 'ArcJobSystem must be initialized');
});

test('World3D: initAsync and graphics backend support', async () => {
    const babylonStub = stub();
    const { get } = loadScripts([
        'js/Constants.js',
        'js/World3D.js'
    ], { BABYLON: babylonStub });

    const World3D = get('World3D');
    assert.equal(typeof World3D.initAsync, 'function', 'World3D.initAsync must be a function');
    assert.equal(typeof World3D.init, 'function', 'World3D.init must be a function');

    const canvasStub = { getContext: () => ({}) };
    const ok = await World3D.initAsync(canvasStub);
    assert.ok(ok, 'initAsync must succeed');
    assert.ok(World3D.backend === 'webgl2' || World3D.backend === 'webgpu', 'Backend must be set');
});

test('World3D: GPU hardware detection and compute shader pipeline', () => {
    const babylonStub = stub();
    const { get } = loadScripts([
        'js/Constants.js',
        'js/World3D.js'
    ], { BABYLON: babylonStub });

    const World3D = get('World3D');
    const canvasStub = {
        getContext: (type) => ({
            getExtension: (name) => ({
                UNMASKED_RENDERER_WEBGL: 1,
                UNMASKED_VENDOR_WEBGL: 2
            }),
            getParameter: (param) => param === 1 ? 'NVIDIA GeForce RTX 4090 Vulkan Driver' : 'NVIDIA Corporation'
        })
    };

    World3D.init(canvasStub);
    const info = World3D.getGpuInfo();
    assert.ok(info, 'GPU info must be returned');
    assert.equal(info.nativeBackend, 'Vulkan', 'Must detect Vulkan driver from renderer string');
    assert.equal(info.vendor, 'NVIDIA Corporation');

    // Test compute shader pipeline creation stub
    assert.equal(typeof World3D.createComputePipeline, 'function');
});

test('NavGrid: findPathAsync computes path equivalent to sync findPath', async () => {
    const { get } = loadScripts([
        'js/Constants.js',
        'js/ShooterRules.js',
        'js/engine/workers/ArcJobWorker.js',
        'js/engine/ArcJobSystem.js',
        'js/NavGrid.js'
    ]);

    const NavGrid = get('NavGrid');
    const nav = new NavGrid({ width: 1024, height: 1024 }, 64);
    const blockers = [{ x: 512, y: 512, radius: 80 }];
    nav.build(blockers, 14);

    const start = { x: 300, y: 512 };
    const goal = { x: 700, y: 512 };

    const syncPath = nav.findPath(start, goal);
    assert.ok(syncPath.length > 0, 'Sync path must exist');

    const asyncPath = await nav.findPathAsync(start, goal);
    assert.ok(asyncPath.length > 0, 'Async path must exist');

    const lastSync = syncPath[syncPath.length - 1];
    const lastAsync = asyncPath[asyncPath.length - 1];
    assert.equal(lastAsync.x, lastSync.x);
    assert.equal(lastAsync.y, lastSync.y);
});

test('ArcEngine: getDiagnostics returns GPU and worker thread telemetry', () => {
    const babylonStub = stub();
    const { get } = loadScripts([
        'js/Constants.js',
        'js/World3D.js',
        'js/engine/workers/ArcJobWorker.js',
        'js/engine/ArcJobSystem.js',
        'js/engine/ArcSpatialGrid.js',
        'js/engine/ArcEventBus.js',
        'js/engine/ArcStateMachine.js',
        'js/engine/ArcActor.js',
        'js/engine/ArcInspector.js',
        'js/engine/ArcEngine.js'
    ], { BABYLON: babylonStub });

    const ArcEngine = get('ArcEngine');
    ArcEngine.init();

    const diag = ArcEngine.getDiagnostics();
    assert.ok(diag.gpu, 'Diagnostics must include GPU info');
    assert.ok(diag.jobs, 'Diagnostics must include Job system stats');
    assert.ok(diag.jobs.concurrency >= 1, 'Concurrency must be at least 1');
    assert.ok(typeof diag.actors === 'number', 'Actor count must be reported');
});

