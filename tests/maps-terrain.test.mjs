import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { loadScripts } from './browser-scripts.mjs';
import { saveMap, loadMap, listMaps, deleteMap, validateMap } from '../_utils/editor/maps.mjs';

const blank = id => ({ id, name: id, dimensions: { width: 2048, height: 2048 }, environment: { skyline: false, roads: false, structures: false, rubble: false }, terrain: { base: 0, noiseAmp: 0 }, spawn: null, extraction: null, hatch: null, props: [], districtStructures: [], enemies: [], containers: [], drives: [] });
test('map storage: isolated creation, save, duplicate and recoverable deletion', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-maps-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'js')); await fs.writeFile(path.join(root, 'js/Objects.js'), 'unchanged');
    await saveMap(root, blank('default_raid'), true);
    await saveMap(root, blank('quarry'), true);
    const one = await loadMap(root, 'quarry'); one.name = 'Карьер'; one.terrain = { nx: 2, ny: 2, samples: [0, 1.25, -40, 256.5] };
    await saveMap(root, one);
    assert.deepEqual((await loadMap(root, 'quarry')).terrain.samples, one.terrain.samples);
    assert.equal((await loadMap(root, 'default_raid')).name, 'default_raid');
    await saveMap(root, { ...one, id: 'copy' }, true);
    assert.equal((await listMaps(root)).length, 3);
    await assert.rejects(saveMap(root, blank('quarry'), true), { code: 'EEXIST' });
    await assert.rejects(loadMap(root, '../Objects'));
    await assert.rejects(saveMap(root, blank('unknown')));
    await assert.rejects(deleteMap(root, 'default_raid'));
    await deleteMap(root, 'copy');
    assert.equal((await listMaps(root)).length, 2);
    assert.ok((await fs.readdir(path.join(root, '_utils/.backups'))).some(n => n.startsWith('Deleted-copy')));
    assert.equal(await fs.readFile(path.join(root, 'js/Objects.js'), 'utf8'), 'unchanged');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'assets/levels/maps.json'), 'utf8')), await listMaps(root));
});
test('map validation rejects malformed dimensions, model paths and height fields', () => {
    assert.throws(() => validateMap({ ...blank('../escape') }));
    assert.throws(() => validateMap({ ...blank('map'), dimensions: { width: 1e8, height: 2048 } }));
    assert.throws(() => validateMap({ ...blank('map'), props: [{ x: 0, y: 0, model: 'assets/../secret.glb' }] }));
    assert.throws(() => validateMap({ ...blank('map'), terrain: { nx: 2, ny: 2, samples: [0, 1, 2] } }));
});
function terrain() {
    let updated = 0;
    const context = loadScripts(['js/Terrain3D.js'], { Blob, Response, DecompressionStream, DataView,
        BABYLON: { VertexBuffer: { PositionKind: 'position', NormalKind: 'normal' }, VertexData: { ComputeNormals() {} } } });
    const T = context.get('Terrain3D'), t = Object.create(T.prototype);
    Object.assign(t, { nx: 3, ny: 3, cell: 10, hgrid: new Float32Array(9), noiseBase: 0, noiseAmp: 0, _noise: null,
        mesh: { isDisposed: () => false, getVerticesData: () => new Float32Array(27), getIndices: () => T.gridIndices(3, 3, false), updateVerticesData: () => updated++, refreshBoundingInfo() {} } });
    return { T, t, updates: () => updated };
}
test('heightmap: resampling, triangle interpolation, brush falloff and bounds stay in sync', async () => {
    const { t, updates } = terrain();
    await t.setHeightmap(new Float32Array([0, 20, 40, 100]), { width: 2, height: 2 });
    assert.equal(t.heightAt(10, 10), 40);
    assert.equal(t.heightAt(20, 20), 100);
    assert.equal(t.hMax, 100); assert.equal(t.hMin, 0); assert.ok(updates() >= 2);
    const before = t.hgrid.slice(); t.brush(10, 10, { radius: 10, strength: 5 });
    assert.equal(t.hgrid[4], before[4] + 5); assert.equal(t.hgrid[0], before[0]);
    t.brush(10, 10, { mode: 'lower', radius: 10, strength: 5 }); assert.equal(t.hgrid[4], before[4]);
    t.brush(10, 10, { mode: 'flatten', height: -8, radius: 10, strength: 10 }); assert.equal(t.hgrid[4], -8);
    t.brush(10, 10, { mode: 'smooth', radius: 10, strength: 10 }); assert.ok(t.hgrid[4] > -8);
    await assert.rejects(t.setHeightmap(new Float32Array([NaN]), { width: 1, height: 1 }));
});
test('16-bit grayscale PNG preserves samples below 8-bit precision for all PNG filters', async () => {
    const { T } = terrain();
    const width = 3, height = 5, stride = width * 2;
    const decoded = Buffer.alloc(stride * height);
    for (let i = 0; i < width * height; i++) decoded.writeUInt16BE(i * 4231 + 17, i * 2);
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = y;
        for (let x = 0; x < stride; x++) {
            const k = y * stride + x, a = x >= 2 ? decoded[k - 2] : 0, b = y ? decoded[k - stride] : 0, c = y && x >= 2 ? decoded[k - stride - 2] : 0;
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            const pred = y === 1 ? a : y === 2 ? b : y === 3 ? Math.floor((a + b) / 2) : y === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
            raw[y * (stride + 1) + x + 1] = (decoded[k] - pred + 256) % 256;
        }
    }
    const chunk = (type, bytes) => { const b = Buffer.alloc(bytes.length + 12); b.writeUInt32BE(bytes.length); b.write(type, 4); bytes.copy(b, 8); return b; };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 16;
    const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
    const result = await T.readGray16(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength));
    for (let i = 0; i < width * height; i++) assert.ok(Math.abs(result.data[i] * 65535 - decoded.readUInt16BE(i * 2)) < .003);
});
test('RaidWorld: empty arrays stay empty, custom bounds and authored height samples apply', () => {
    const page = loadScripts(['js/RaidWorld.js'], { RAID_CUSTOM_LEVEL: { enemies: [{ x: 100, y: 100 }] } });
    const world = page.get('RaidWorld'); world.activeLevel = { ...blank('empty'), terrain: { nx: 2, ny: 2, cell: 2048, samples: [0, 20, 40, 100] } };
    const data = world.build(42);
    assert.equal(data.enemies.length, 0); assert.equal(data.containers.length, 0); assert.equal(data.drives.length, 0); assert.equal(data.blockers.length, 0);
    assert.equal(data.width, 2048); assert.equal(world.heightAt(1024, 1024), 50);
});


test('Location3D dimensions belong to the selected map, with legacy constants as fallback', () => {
    const page = loadScripts(['js/Location3D.js'], { LOCATION_WIDTH: 4096, LOCATION_HEIGHT: 4096 });
    const Location = page.get('Location3D'), loc = Object.create(Location.prototype);
    loc.opts = { level: { dimensions: { width: 2048, height: 1024 } } };
    assert.equal(loc.width, 2048); assert.equal(loc.height, 1024);
    loc.opts = {}; assert.equal(loc.width, 4096);
});


test('RaidWorld: deleted structures lose collision and moved arches move their supports', () => {
    const world = loadScripts(['js/RaidWorld.js']).get('RaidWorld');
    world.activeLevel = { ...blank('arch'), environment: { structures: true }, districtStructures: [{ id: 'env_arch_1', position: [500, 0, 600], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] }] };
    let result = world.build(); assert.equal(result.blockers.length, 2);
    assert.ok(Math.abs(result.blockers[0].x - 500) < 1e-8); assert.equal(result.blockers[0].y, 748);
    world.activeLevel.districtStructures = []; result = world.build(); assert.equal(result.blockers.length, 0);
});
