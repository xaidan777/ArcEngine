// Isolated level storage. IDs are filenames, never client supplied paths.
import fs from 'node:fs/promises';
import path from 'node:path';
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id) && id !== 'maps';
function file(root, id) {
  if (!validId(id)) throw new Error('Invalid map ID');
  return path.join(root, 'assets/levels', id + '.json');
}
export function validateMap(level) {
  if (!level || !validId(level.id)) throw new Error('Invalid map ID');
  const d = level.dimensions;
  if (!d || ![d.width, d.height].every(n => Number.isFinite(n) && n >= 64 && n <= 8192)) throw new Error('Map dimensions must be 64–8192');
  for (const key of ['props', 'enemies', 'containers', 'drives', 'districtStructures']) {
    if (!Array.isArray(level[key]) || level[key].length > 20000) throw new Error('Invalid ' + key);
  }
  for (const p of [...level.props, ...level.enemies, ...level.containers, ...level.drives, ...[level.spawn, level.extraction, level.hatch].filter(Boolean)]) {
    if (![p.x, p.y].every(Number.isFinite)) throw new Error('Invalid coordinates');
  }
  if (level.lights != null) {
    if (!Array.isArray(level.lights) || level.lights.length > 20000) throw new Error('Invalid lights');
    for (const l of level.lights) {
      if (![l.x, l.y].every(Number.isFinite)) throw new Error('Invalid coordinates');
    }
  }
  for (const p of level.props) if (typeof p.model !== 'string' || !/^assets\/.*\.(glb|fbx)$/i.test(p.model) || p.model.includes('..')) throw new Error('Invalid model path');
  const t = level.terrain || {};
  if (t.samples) {
    if (!Number.isInteger(t.nx) || !Number.isInteger(t.ny) || t.nx < 2 || t.ny < 2 || t.nx * t.ny > 1100000 || t.samples.length !== t.nx * t.ny || !t.samples.every(Number.isFinite)) throw new Error('Invalid height field');
  }
  return level;
}
async function atomicWrite(dest, data) {
  const temp = dest + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(data, null, 2));
  await fs.rename(temp, dest);
}
export async function listMaps(root) {
  const dir = path.join(root, 'assets/levels');
  await fs.mkdir(dir, { recursive: true });
  const result = [];
  for (const name of (await fs.readdir(dir)).sort()) {
    const id = name.replace(/\.json$/, '');
    if (!name.endsWith('.json') || !validId(id)) continue;
    try {
      const level = JSON.parse(await fs.readFile(file(root, id), 'utf8'));
      result.push({ id, name: level.name || id, file: 'assets/levels/' + name, ...(level.thumbnail ? { thumbnail: level.thumbnail } : {}) });
    } catch { /* unrelated or incomplete JSON is not a map */ }
  }
  return result;
}
export async function loadMap(root, id) {
  const level = JSON.parse(await fs.readFile(file(root, id), 'utf8'));
  return { dimensions: { width: 4096, height: 4096 }, terrain: {}, environment: { skyline: true, roads: true, structures: true, rubble: true }, props: [], enemies: [], containers: [], drives: [], lights: [], lighting: {}, ...level, id };
}
export async function saveMap(root, level, create = false) {
  validateMap(level);
  const dest = file(root, level.id);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (create) await fs.writeFile(dest, JSON.stringify(level, null, 2), { flag: 'wx' });
  else {
    const old = await fs.readFile(dest); // save cannot silently create a mistyped ID
    const backupDir = path.join(root, '_utils/.backups');
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, `Map-${level.id}-${Date.now()}.json`), old);
    await atomicWrite(dest, level);
  }
  await atomicWrite(path.join(root, 'assets/levels/maps.json'), await listMaps(root));
  return { ok: true, id: level.id, path: 'assets/levels/' + level.id + '.json' };
}
export async function deleteMap(root, id) {
  if (id === 'default_raid') throw new Error('The default map cannot be deleted');
  const dest = file(root, id);
  const dir = path.join(root, '_utils/.backups');
  await fs.mkdir(dir, { recursive: true });
  await fs.rename(dest, path.join(dir, `Deleted-${id}-${Date.now()}.json`));
  await atomicWrite(path.join(root, 'assets/levels/maps.json'), await listMaps(root));
  return { ok: true };
}
