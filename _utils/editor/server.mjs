// ============================================================================
//  ArcEngine — сервер РЕДАКТОРА (_utils/editor). Node, без зависимостей.
// ----------------------------------------------------------------------------
//  Зачем отдельный сервер, а не tools/dev-server.mjs:
//   1. редактору нужен POST /api/save-constants — точечный патч чисел в
//      Constants.js (иначе «Сохранить» некуда);
//   2. свой порт (8090+), чтобы жить рядом с игрой на 8080.
//  Статика раздаётся от КОРНЯ ПРОЕКТА (редактор грузит /js/Constants.js,
//  /js/World3D.js, /assets/* игры напрямую), с no-store — как в dev-server.
//
//  Запись файлов игры — save.mjs (патч Constants.js, Objects.js целиком, бэкапы).
//
//  Объекты локации (вкладка Objects):
//   - POST /api/save-objects — Objects.js из проверенного списка;
//   - POST /api/pick-model — системный диалог выбора .fbx, открытый в
//     assets/models (Windows: PowerShell + WinForms); файл не из assets/
//     копируется в assets/models. Другие ОС — code 'unsupported', клиент шлёт
//     файл сам: POST /api/import-model?name=<имя> с байтами файла.
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { execFile } from 'node:child_process';
import { failure, isModelPath, saveConstants, saveObjects } from './save.mjs';

// Версия серверного контракта. Поднимать при КАЖДОМ изменении эндпоинтов или
// формата ответа — клиент сверяет её с EDITOR_API_VERSION в schema.js.
const EDITOR_API_VERSION = 18;

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
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

// --- Импорт моделей: assets/models/ -------------------------------------------

// Байты модели -> путь 'assets/…'. Файл уже внутри assets/ с годным путём берётся
// как есть; иначе копируется в assets/models/ (имя — латиница без пробелов; тот же
// файл повторно не копируется, другой с тем же именем получает суффикс -2, -3…).
async function storeModel(data, fileName, srcPath) {
  if (path.extname(fileName).toLowerCase() !== '.fbx') return failure('not_fbx');
  if (data.subarray(0, 18).toString('latin1') !== 'Kaydara FBX Binary') return failure('not_binary');
  const label = path.basename(fileName, path.extname(fileName));
  if (srcPath) {
    const rel = path.relative(ROOT, srcPath).split(path.sep).join('/');
    if (isModelPath(rel)) return { ok: true, path: rel, name: label, copied: false };
  }
  await fsp.mkdir(MODELS_DIR, { recursive: true });
  const base = label.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
  for (let i = 1; ; i++) {
    const file = base + (i > 1 ? '-' + i : '') + '.fbx';
    const dest = path.join(MODELS_DIR, file);
    let existing = null;
    try { existing = await fsp.readFile(dest); } catch { /* имя свободно */ }
    if (existing && !existing.equals(data)) continue;
    if (!existing) await fsp.writeFile(dest, data);
    return { ok: true, path: 'assets/models/' + file, name: label, copied: !existing };
  }
}

// Системный диалог выбора .fbx, открытый в папке dir. Windows — PowerShell +
// WinForms (-STA обязателен); путь и заголовок идут через env — без экранирования.
// Невидимое окно-владелец TopMost: иначе диалог открывается за браузером.
function openFileDialog(dir, title) {
  if (process.platform !== 'win32') return Promise.resolve({ unsupported: true });
  const script = [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    "$d.Filter = 'FBX (*.fbx)|*.fbx'",
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
  const r = await openFileDialog(MODELS_DIR, String(title || 'Import FBX').slice(0, 120));
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
  return (await readRaw(req, 1024 * 1024)).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad URL');
  }

  // --- API редактора ---
  if (pathname === '/api/status') {
    return sendJson(res, 200, { ok: true, editor: 'arcengine', api: EDITOR_API_VERSION, root: ROOT });
  }
  if (pathname === '/api/save-constants') {
    if (req.method !== 'POST') return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await saveConstants(ROOT, body.changes);
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

  // --- Статика от корня проекта ---
  if (pathname === '/') {
    return send(res, 302, { Location: EDITOR_URL_PATH });
  }
  if (pathname === EDITOR_URL_PATH || pathname === EDITOR_URL_PATH.slice(0, -1)) {
    pathname = EDITOR_URL_PATH + 'index.html';
  }

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden');
  }

  let st;
  try {
    st = await fsp.stat(filePath);
  } catch {
    // Иконку браузер просит сам; у редактора её нет.
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
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
});

// Порт занят -> пробуем следующий, до +20 (как в tools/dev-server.mjs).
function listen(port, attempt = 0) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && attempt < 20) {
      console.log(`${C.dim}  port ${port} is busy, trying ${port + 1}${C.r}`);
      return listen(port + 1, attempt + 1);
    }
    console.error(`${C.red}Could not start the server: ${err.message}${C.r}`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const addr = `http://localhost:${port}${EDITOR_URL_PATH}`;
    console.log(`\n${C.cyn}${C.b}  ArcEngine${C.r} ${C.dim}— editor: location, camera, render${C.r}`);
    console.log(`${C.dim}  ${'-'.repeat(46)}${C.r}`);
    console.log(`  ${C.grn}${C.b}${addr}${C.r}`);
    console.log(`${C.dim}  root: ${ROOT}${C.r}`);
    console.log(`${C.dim}  saving: patches Constants.js, writes Objects.js, backups in _utils/.backups/${C.r}`);
    console.log(`${C.dim}  models: assets/models/ (Import FBX)${C.r}`);
    console.log(`${C.dim}  Ctrl+C to stop${C.r}\n`);
    if (!NO_OPEN) {
      const cmd = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
      const args = process.platform === 'win32' ? ['/c', 'start', '', addr] : [addr];
      execFile(cmd, args, () => {});
    }
  });
}

listen(PORT_BASE);
