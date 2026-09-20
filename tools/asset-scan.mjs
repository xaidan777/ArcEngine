// ============================================================================
//  Asset reference scanner. Single source of truth for dev-server and build.
// ----------------------------------------------------------------------------
//  The project has no build step and no manifest: asset paths live as string
//  literals in .js and in the CSS inside index.html. The scanner collects them all,
//  checks them against the disk and also shows what lies on disk as dead weight.
//
//  IMPORTANT: a path assembled from pieces ('assets/' + key + '.png') will NOT be
//  seen by the scanner. Add such places to EXTRA_REFS below by hand.
//
//  A reference to a FOLDER does not count as an asset: the code assembles the files
//  inside it from pieces. Such references are returned separately (dirs) and produce
//  neither "missing asset" nor "used".
// ============================================================================
import fsp from 'node:fs/promises';
import path from 'node:path';

// Paths that cannot be picked up as a literal. Empty for now — all references are literal.
export const EXTRA_REFS = [];

// Files needed in the build that are not "assets". A new <script> in
// index.html = a new line here, otherwise the file will not get into the archive.
export const CODE_FILES = [
  'index.html',
  'js/Constants.js', 'js/Objects.js', 'js/UILayout.js', 'js/Sound3D.js', 'js/World3D.js', 'js/Terrain3D.js', 'js/CameraControl.js', 'js/Model3D.js', 'js/Gltf3D.js', 'js/Instances3D.js', 'js/Location3D.js', 'js/Debug3D.js', 'js/UI.js', 'js/Game.js', 'js/main.js',
  'libs/simplex-noise.js', 'libs/babylon.js', 'libs/babylonjs.loaders.min.js',
];

// What definitely does not go into the build.
export const BUILD_EXCLUDE = [
  'tools', 'build', 'dist', '.git', '.claude', 'claude', '_utils', 'tests',
  'CLAUDE.md', 'run.bat', 'build.bat', 'check.bat', 'upload.bat', 'editor.bat', 'README.md', 'tsconfig.json', 'globals.d.ts',
];

const SCAN_EXT = new Set(['.js', '.html', '.css']);

async function walk(dir, root, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (BUILD_EXCLUDE.includes(e.name) || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * @returns {{refs:string[], missing:string[], onDisk:string[], unused:string[]}}
 *   refs    — assets/... paths referenced by the code (normalized, without ?v=)
 *   missing — those of refs that are not on disk  (future 404s)
 *   onDisk  — everything physically present in assets/
 *   unused  — is on disk, but no reference leads to it  (dead weight of the archive)
 */
export async function collectRefs(root) {
  const all = await walk(root, root);

  // 1) extract the literals
  const refs = new Set(EXTRA_REFS);
  const rx = /['"`]\s*(assets\/[^'"`)\s]+?)\s*['"`)]/g;
  for (const rel of all) {
    if (!SCAN_EXT.has(path.extname(rel).toLowerCase())) continue;
    if (rel.startsWith('libs/')) continue;           // third-party libraries are left alone
    const text = await fsp.readFile(path.join(root, rel), 'utf8');
    for (const m of text.matchAll(rx)) {
      refs.add(m[1].split('?')[0].split('#')[0]);
    }
  }

  const onDisk  = all.filter(f => f.startsWith('assets/')).sort();
  const diskSet = new Set(onDisk);

  // Folders are not assets (see the header): taken out of refs so they do not count as missing.
  const dirs = [];
  const fileRefs = [];
  for (const r of [...refs].sort()) {
    const clean = r.replace(/\/+$/, '');
    let isDir = false;
    try { isDir = (await fsp.stat(path.join(root, clean))).isDirectory(); } catch { /* not on disk — the regular check below */ }
    if (isDir) { dirs.push(clean); refs.delete(r); } else fileRefs.push(r);
  }

  return {
    refs: fileRefs,
    missing: fileRefs.filter(r => !diskSet.has(r)),
    onDisk,
    unused: onDisk.filter(f => !refs.has(f)),
    dirs,
    allFiles: all,
  };
}

export async function sizeOf(root, rel) {
  try { return (await fsp.stat(path.join(root, rel))).size; } catch { return 0; }
}

export const human = b =>
  b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB'
  : b >= 1024   ? (b / 1024).toFixed(1) + ' KB'
  : b + ' B';
