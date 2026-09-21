// ============================================================================
//  ArcEngine — the EDITOR server (_utils/editor). Node, no dependencies.
// ----------------------------------------------------------------------------
//  Why a separate server instead of tools/dev-server.mjs:
//   1. the editor needs POST /api/save-constants — a pinpoint patch of numbers in
//      Constants.js (otherwise "Save" has nowhere to go);
//   2. its own port (8090+), to live next to the game on 8080.
//  Static files are served from the PROJECT ROOT (the editor loads the game's
//  /js/Constants.js, /js/World3D.js, /assets/* directly), with no-store — as in dev-server.
//
//  Writing game files — save.mjs (Constants.js patch, the whole Objects.js and UILayout.js,
//  backups). POST /api/save-ui — UILayout.js from a validated element list (UI tab).
//
//  Location objects (Objects tab):
//   - POST /api/save-objects — Objects.js from a validated list;
//   - POST /api/pick-model — a system model (.fbx, .glb) picker dialog opened in
//     assets/models (Windows: PowerShell + WinForms); a file from outside assets/
//     is copied to assets/models. Other OSes — code 'unsupported', the client sends
//     the file itself: POST /api/import-model?name=<name> with the file bytes.
// ============================================================================
import { listMaps, loadMap, saveMap, deleteMap } from './maps.mjs';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { execFile } from 'node:child_process';
import { failure, isModelPath, saveConstants, saveObjects, saveUI, saveRig, saveClip, saveLevel, listAssets } from './save.mjs';

// Server contract version. Bump on EVERY change of the endpoints or the
// response format — the client checks it against EDITOR_API_VERSION in schema.js.
const EDITOR_API_VERSION = 21;

const ROOT = process.env.ARC_EDITOR_ROOT ? path.resolve(process.env.ARC_EDITOR_ROOT) : path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const MODELS_DIR = path.join(ROOT, 'assets', 'models');
const EDITOR_URL_PATH = '/_utils/editor/';

const argPort = process.argv.find(a => /^--port=\d+$/.test(a));
const PORT_BASE = argPort ? Number(argPort.split('=')[1]) : 8090;
const NO_OPEN = process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.ttf':  'font/ttf',
  '.glb':  'model/gltf-binary',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
};

const C = {
  r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m',
};

// --- Live Builder SSE Broadcast -----------------------------------------------
const liveClients = new Set();
export function broadcastLiveAction(data) {
  const payload = 'data: ' + JSON.stringify(data) + '\n\n';
  for (const client of liveClients) {
    try {
      client.write(payload);
    } catch (_) {
      liveClients.delete(client);
    }
  }
}

// --- Model import: assets/models/ ---------------------------------------------

// Model bytes -> an assets/… path. A file already inside assets/ with a valid path is taken
// as is; otherwise it is copied to assets/models/ (name — Latin letters, no spaces; the same
// file is not copied again, a different one with the same name gets a suffix -2, -3…).
async function storeModel(data, fileName, srcPath) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== '.fbx' && ext !== '.glb') return failure('not_model');
  if (ext === '.fbx' && data.subarray(0, 18).toString('latin1') !== 'Kaydara FBX Binary') return failure('not_binary');
  if (ext === '.glb' && data.subarray(0, 4).toString('latin1') !== 'glTF') return failure('not_glb');
  const label = path.basename(fileName, path.extname(fileName));
  if (srcPath) {
    const rel = path.relative(ROOT, srcPath).split(path.sep).join('/');
    if (isModelPath(rel)) return { ok: true, path: rel, name: label, copied: false };
  }
  await fsp.mkdir(MODELS_DIR, { recursive: true });
  const base = label.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
  for (let i = 1; ; i++) {
    const file = base + (i > 1 ? '-' + i : '') + ext;
    const dest = path.join(MODELS_DIR, file);
    let existing = null;
    try { existing = await fsp.readFile(dest); } catch { /* the name is free */ }
    if (existing && !existing.equals(data)) continue;
    if (!existing) await fsp.writeFile(dest, data);
    return { ok: true, path: 'assets/models/' + file, name: label, copied: !existing };
  }
}

// A system model (.fbx, .glb) picker dialog opened in the dir folder. Windows — PowerShell +
// WinForms (-STA is required); the path and the title go through env — no escaping.
// An invisible TopMost owner window: otherwise the dialog opens behind the browser.
function openFileDialog(dir, title) {
  if (process.platform !== 'win32') return Promise.resolve({ unsupported: true });
  const script = [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    "$d.Filter = 'Models (*.fbx;*.glb)|*.fbx;*.glb'",
    '$d.InitialDirectory = $env:ARC_DIALOG_DIR',
    '$d.Title = $env:ARC_DIALOG_TITLE',
    '$w = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
    "if ($d.ShowDialog($w) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }",
  ].join('; ');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
      env: Object.assign({}, process.env, { ARC_DIALOG_DIR: dir, ARC_DIALOG_TITLE: title }),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (err, stdout) => resolve(err ? { error: err.message } : { file: String(stdout).replace(/^\uFEFF/, '').trim() }));
  });
}

async function pickModel(title) {
  await fsp.mkdir(MODELS_DIR, { recursive: true });
  const r = await openFileDialog(MODELS_DIR, String(title || 'Import model').slice(0, 120));
  if (r.unsupported) return failure('unsupported');
  if (r.error) return failure('dialog_failed', { detail: r.error });
  if (!r.file) return { ok: false, code: 'cancelled' };
  return storeModel(await fsp.readFile(r.file), path.basename(r.file), r.file);
}

// --- HTTP --------------------------------------------------------------------

function send(res, code, headers, body) {
  res.writeHead(code, headers);
  if (body === undefined) res.end(); else res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, JSON.stringify(obj));
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('request body too large'), { code: 'too_large' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readBody(req) {
  return (await readRaw(req, 40 * 1024 * 1024)).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad URL');
  }

  // --- Editor API ---
  if (pathname === '/api/maps' || pathname.startsWith('/api/maps/')) {
    try {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      if (pathname === '/api/maps' && req.method === 'GET') return sendJson(res, 200, { ok: true, maps: await listMaps(ROOT) });
      if (pathname === '/api/maps/load' && req.method === 'POST') return sendJson(res, 200, { ok: true, level: await loadMap(ROOT, id) });
      if (pathname === '/api/maps/delete' && req.method === 'DELETE') return sendJson(res, 200, await deleteMap(ROOT, id));
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      const body = JSON.parse(await readBody(req));
      if (pathname === '/api/maps/save' || pathname === '/api/maps/create') return sendJson(res, 200, await saveMap(ROOT, body.level, pathname.endsWith('/create')));
      if (pathname === '/api/maps/duplicate') {
        const level = await loadMap(ROOT, body.sourceId);
        level.id = body.id;
        level.name = body.name || body.id;
        return sendJson(res, 200, await saveMap(ROOT, level, true));
      }
      return sendJson(res, 404, { ok: false, error: 'Unknown map action' });
    } catch (e) { return sendJson(res, e.code === 'ENOENT' ? 404 : e.code === 'EEXIST' ? 409 : 400, { ok: false, error: e.message }); }
  }
  // --- Live Agent Stream API ---
  if (pathname === '/api/live-stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': heartbeat\n\n');
    res.write('data: ' + JSON.stringify({ type: 'CONNECTED', message: 'ArcEngine Live Stream connected' }) + '\n\n');
    liveClients.add(res);
    req.on('close', () => liveClients.delete(res));
    return;
  }
  if (pathname === '/api/live-action') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      broadcastLiveAction(body);
      return sendJson(res, 200, { ok: true, recipients: liveClients.size });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/status') {
    return sendJson(res, 200, { ok: true, editor: 'arcengine', api: EDITOR_API_VERSION, root: ROOT });
  }
  if (pathname === '/api/save-constants') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      let changes = body.changes;
      if (changes && !Array.isArray(changes) && typeof changes === 'object') {
        changes = Object.entries(changes).map(([name, value]) => ({ name, value }));
      }
      const result = await saveConstants(ROOT, changes);
      const failed = result.results ? result.results.filter(r => !r.ok) : [];
      if (result.patched > 0) {
        console.log(`  ${C.grn}save${C.r} ${result.patched} value(s) -> Constants.js ${C.dim}(backup: ${result.backup})${C.r}`);
      }
      for (const f of failed) console.log(`  ${C.ylw}skip${C.r} ${f.name}: ${f.error}`);
      return sendJson(res, 200, result);
    } catch (e) {
      console.log(`  ${C.red}save FAILED${C.r} ${e.message}`);
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/save-objects') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await saveObjects(ROOT, body.objects);
      if (result.ok) console.log(`  ${C.grn}save${C.r} ${result.count} object(s) -> Objects.js ${C.dim}(backup: ${result.backup})${C.r}`);
      else console.log(`  ${C.ylw}skip${C.r} Objects.js: ${result.error} (#${result.index})`);
      return sendJson(res, 200, result);
    } catch (e) {
      console.log(`  ${C.red}save FAILED${C.r} ${e.message}`);
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/save-ui') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await saveUI(ROOT, body.elements);
      if (result.ok) console.log(`  ${C.grn}save${C.r} ${result.count} UI element(s) -> UILayout.js ${C.dim}(backup: ${result.backup})${C.r}`);
      else console.log(`  ${C.ylw}skip${C.r} UILayout.js: ${result.error} (#${result.index})`);
      return sendJson(res, 200, result);
    } catch (e) {
      console.log(`  ${C.red}save FAILED${C.r} ${e.message}`);
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/list-assets') {
    return sendJson(res, 200, await listAssets(ROOT));
  }
  if (pathname === '/api/save-rig') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await saveRig(ROOT, body.name, body.rig);
      if (result.ok) console.log(`  ${C.grn}save${C.r} rig -> ${result.path}`);
      return sendJson(res, 200, result);
    } catch (e) {
      console.log(`  ${C.red}save-rig FAILED${C.r} ${e.message}`);
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/save-clip') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await saveClip(ROOT, body.name, body.clip);
      if (result.ok) console.log(`  ${C.grn}save${C.r} clip -> ${result.path}`);
      return sendJson(res, 200, result);
    } catch (e) {
      console.log(`  ${C.red}save-clip FAILED${C.r} ${e.message}`);
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/save-level') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await saveLevel(ROOT, body.level);
      if (result.ok) console.log(`  ${C.grn}save${C.r} level -> ${result.path}`);
      return sendJson(res, 200, result);
    } catch (e) {
      console.log(`  ${C.red}save-level FAILED${C.r} ${e.message}`);
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/pick-model' || pathname === '/api/import-model') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      let result;
      if (pathname === '/api/pick-model') {
        result = await pickModel(JSON.parse(await readBody(req) || '{}').title);
      } else {
        const name = path.basename(String(new URL(req.url, 'http://x').searchParams.get('name') || 'model.fbx'));
        result = await storeModel(await readRaw(req, 200 * 1024 * 1024), name, null);
      }
      if (result.ok) console.log(`  ${C.grn}model${C.r} ${result.path}${result.copied ? C.dim + ' (copied)' + C.r : ''}`);
      else if (result.code !== 'cancelled') console.log(`  ${C.ylw}model${C.r} ${result.error}${result.detail ? ' — ' + result.detail : ''}`);
      return sendJson(res, 200, result);
    } catch (e) {
      console.log(`  ${C.red}model FAILED${C.r} ${e.message}`);
      return sendJson(res, e.code === 'too_large' ? 413 : 500, e.code === 'too_large' ? failure('too_large') : { ok: false, error: e.message });
    }
  }
  if (pathname === '/api/upload-texture') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      const parsedUrl = new URL(req.url, 'http://x');
      const rawName = path.basename(String(parsedUrl.searchParams.get('name') || 'custom_texture.png'));
      const ext = (path.extname(rawName) || '.png').toLowerCase();
      const base = path.basename(rawName, ext).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'custom_texture';
      const cleanName = base + ext;
      const targetDir = path.join(ROOT, 'assets', 'textures', 'custom');
      await fsp.mkdir(targetDir, { recursive: true });
      const targetFile = path.join(targetDir, cleanName);
      const data = await readRaw(req, 50 * 1024 * 1024);
      await fsp.writeFile(targetFile, data);
      const relPath = '/assets/textures/custom/' + cleanName;
      console.log(`  ${C.grn}texture${C.r} uploaded -> ${relPath} (${(data.length / 1024).toFixed(1)} KB)`);
      return sendJson(res, 200, { ok: true, path: relPath, name: cleanName });
    } catch (e) {
      console.log(`  ${C.red}texture upload FAILED${C.r} ${e.message}`);
      return sendJson(res, e.code === 'too_large' ? 413 : 500, { ok: false, error: e.message });
    }
  }

  // --- Static files from the project root ---
  if (pathname === '/') {
    return send(res, 302, { Location: EDITOR_URL_PATH });
  }
  if (pathname === EDITOR_URL_PATH || pathname === EDITOR_URL_PATH.slice(0, -1)) {
    pathname = EDITOR_URL_PATH + 'index.html';
  }
  // Any relative asset, lib or js reference made from /_utils/editor/ resolves against ROOT
  if (pathname.startsWith('/_utils/editor/assets/')) {
    pathname = pathname.slice('/_utils/editor'.length);
  } else if (pathname.startsWith('/_utils/editor/libs/')) {
    pathname = pathname.slice('/_utils/editor'.length);
  } else if (pathname.startsWith('/_utils/editor/js/')) {
    pathname = pathname.slice('/_utils/editor'.length);
  }

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden');
  }

  let st;
  try {
    st = await fsp.stat(filePath);
  } catch {
    // The browser requests the icon on its own; the editor has none.
    if (pathname === '/favicon.ico') return send(res, 204, { 'Cache-Control': 'no-store' });
    console.log(`  ${C.red}404${C.r} ${pathname}`);
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found: ' + pathname);
  }
  if (st.isDirectory()) return send(res, 403, { 'Content-Type': 'text/plain' }, 'Directory listing off');

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Content-Length': st.size,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
});

// Port busy -> try the next one, up to +20 (as in tools/dev-server.mjs).
function listen(port, attempt = 0) {
  const onListening = () => {
    server.removeListener('error', onError);
    const addr = `http://localhost:${server.address().port}${EDITOR_URL_PATH}`;
    console.log(`\n${C.cyn}${C.b}  ArcEngine${C.r} ${C.dim}— editor: location, camera, render${C.r}`);
    console.log(`${C.dim}  ${'-'.repeat(46)}${C.r}`);
    console.log(`  ${C.grn}${C.b}${addr}${C.r}`);
    console.log(`${C.dim}  root: ${ROOT}${C.r}`);
    console.log(`${C.dim}  saving: patches Constants.js, writes Objects.js, backups in _utils/.backups/${C.r}`);
    console.log(`${C.dim}  models: assets/models/ (Import model)${C.r}`);
    console.log(`${C.dim}  Ctrl+C to stop${C.r}\n`);
    if (!NO_OPEN) {
      const cmd = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
      const args = process.platform === 'win32' ? ['/c', 'start', '', addr] : [addr];
      execFile(cmd, args, () => {});
    }
  };

  const onError = err => {
    server.removeListener('listening', onListening);
    if (err.code === 'EADDRINUSE' && attempt < 20) {
      console.log(`${C.dim}  port ${port} is busy, trying ${port + 1}${C.r}`);
      return listen(port + 1, attempt + 1);
    }
    console.error(`${C.red}Could not start the server: ${err.message}${C.r}`);
    process.exit(1);
  };

  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '127.0.0.1');
}

listen(PORT_BASE);
