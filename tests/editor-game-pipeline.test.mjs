import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

test('editor-game pipeline: saveLevel writes level JSON and js/RaidLevel.js with merging', async t => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'arc-pipeline-'));
    await fsp.mkdir(path.join(tempRoot, 'js'), { recursive: true });
    t.after(() => fsp.rm(tempRoot, { recursive: true, force: true }));
    const { saveLevel } = await import('../_utils/editor/save.mjs');
    const testLevel = {
        name: 'test_pipeline_raid',
        ground: {
            preset: 'asphalt',
            diff: '/assets/textures/pbr/asphalt_02_diff_1k.jpg',
            nor: '/assets/textures/pbr/asphalt_02_nor_gl_1k.jpg',
            rough: '/assets/textures/pbr/asphalt_02_rough_1k.jpg',
            color: '#a0a09a',
            uScale: 8,
            vScale: 8
        },
        rubble: { enabled: false }
    };

    const res = await saveLevel(tempRoot, testLevel);
    assert.ok(res.ok, 'saveLevel succeeds');

    const jsonPath = path.join(tempRoot, res.path);
    assert.ok(fs.existsSync(jsonPath), 'level json created');
    const loaded = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.equal(loaded.name, 'test_pipeline_raid');
    assert.equal(loaded.ground.preset, 'asphalt');
    assert.equal(loaded.rubble.enabled, false);

    // Clean up test file
    await fsp.unlink(jsonPath).catch(() => {});
});

test('editor-game pipeline: /api/upload-texture and /api/save-level HTTP endpoints', async t => {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'arc-http-pipeline-'));
    const proc = spawn(process.execPath, [path.join(ROOT, '_utils/editor/server.mjs'), '--no-open', '--port=0'], { env: { ...process.env, ARC_EDITOR_ROOT: tempRoot } });
    t.after(async () => { proc.kill(); await fsp.rm(tempRoot, { recursive: true, force: true }); });
    const base = await new Promise((resolve, reject) => {
        let text = '';
        proc.stdout.on('data', chunk => { text += chunk; const match = text.match(/http:\/\/localhost:(\d+)\/_utils/); if (match) resolve('http://127.0.0.1:' + match[1]); });
        proc.on('error', reject); proc.on('exit', code => reject(new Error('Server exit ' + code)));
    });
    // Test texture upload to local editor server on port 8090
    const testBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    const uploadRes = await fetch(base + '/api/upload-texture?name=pipeline_test.png', {
        method: 'POST',
        body: testBytes
    });
    assert.equal(uploadRes.status, 200, 'upload-texture responds with 200');
    const uploadData = await uploadRes.json();
    assert.ok(uploadData.ok);
    assert.equal(uploadData.name, 'pipeline_test.png');
    assert.equal(uploadData.path, '/assets/textures/custom/pipeline_test.png');

    const uploadedDiskPath = path.join(tempRoot, 'assets', 'textures', 'custom', 'pipeline_test.png');
    assert.ok(fs.existsSync(uploadedDiskPath), 'file written to disk');

    // Test static serving of the uploaded texture
    const staticRes = await fetch(base + '/assets/textures/custom/pipeline_test.png');
    assert.equal(staticRes.status, 200, 'static file server returns uploaded texture');

    // Map API uses isolated documents and never rewrites the legacy global scripts.
    const level = { id: 'http_map', name: 'HTTP map', dimensions: { width: 2048, height: 2048 }, environment: { skyline: false, roads: false, structures: false, rubble: false }, terrain: { noiseAmp: 0 }, props: [], districtStructures: [], enemies: [], containers: [], drives: [], spawn: null, extraction: null, hatch: null };
    const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('/api/maps/create', { level })).status, 200);
    assert.equal((await post('/api/maps/create', { level })).status, 409);
    const loadedMap = await (await post('/api/maps/load?id=http_map')).json();
    assert.deepEqual(loadedMap.level.enemies, []);
    assert.equal((await post('/api/maps/save', { level: { ...level, name: 'Saved' } })).status, 200);
    assert.equal((await post('/api/maps/duplicate', { sourceId: 'http_map', id: 'http_copy' })).status, 200);
    const registry = await (await fetch(base + '/api/maps')).json();
    assert.equal(registry.maps.length, 2);
    assert.equal((await fetch(base + '/api/maps/delete?id=http_copy', { method: 'DELETE' })).status, 200);
    assert.equal((await post('/api/maps/load?id=../secret')).status, 400);
    assert.equal((await fetch(base + '/api/maps/save')).status, 405);

    // Clean up
    await fsp.unlink(uploadedDiskPath).catch(() => {});
});

test('editor-game pipeline: RaidWorld.props respects LOCATION_OBJECTS deletion', async () => {
    // Save original global
    const origLoc = globalThis.LOCATION_OBJECTS;

    // With full LOCATION_OBJECTS
    globalThis.LOCATION_OBJECTS = [
        { name: 'generator-1', x: 720, y: 1530 },
        { name: 'barrier-1', x: 125, y: 1450 }
    ];

    const { default: RaidWorld } = await import('../js/RaidWorld.js');
    const world = RaidWorld.build(0);
    const hasGenBlocker = world.blockers.some(b => Math.hypot(b.x - 720, b.y - 1530) < 40);
    assert.ok(hasGenBlocker, 'blocker exists when generator is in LOCATION_OBJECTS');

    // Now simulate deleting generator from LOCATION_OBJECTS in the editor
    globalThis.LOCATION_OBJECTS = [
        { name: 'barrier-1', x: 125, y: 1450 }
    ];

    const worldAfterDelete = RaidWorld.build(0);
    const genBlockerAfterDelete = worldAfterDelete.blockers.some(b => Math.hypot(b.x - 720, b.y - 1530) < 40);
    assert.equal(genBlockerAfterDelete, false, 'blocker is removed when generator is deleted');

    // Restore original global
    globalThis.LOCATION_OBJECTS = origLoc;
});
