// ============================================================================
//  ArcEngine — сервер РЕДАКТОРА (_utils/editor). Node, без зависимостей.
// ----------------------------------------------------------------------------
//  Зачем отдельный сервер, а не tools/dev-server.mjs:
//   1. редактору нужен POST /api/save-constants — точечный патч чисел в
//      Constants.js (иначе «Сохранить» некуда);
//   2. свой порт (8090+), чтобы жить рядом с игрой на 8080.
//  Статика раздаётся от КОРНЯ ПРОЕКТА (редактор грузит /Constants.js,
//  /World3D.js, /assets/* игры напрямую), с no-store — как в dev-server.
//
//  Патч Constants.js нарочно тупой и безопасный:
//   - меняются ТОЛЬКО строки вида `const ИМЯ = <число>;` (формулу сервер не
//     тронет — откажется); цвет 0xRRGGBB остаётся hex-литералом;
//   - перед каждой записью — бэкап в _utils/.backups/ (хранится 20 последних).
//
//  Объекты локации (вкладка Objects):
//   - POST /api/save-objects — Objects.js пишется ЦЕЛИКОМ из проверенного списка
//     (бэкап — туда же);
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

// Версия серверного контракта. Поднимать при КАЖДОМ изменении эндпоинтов или
// формата ответа — клиент сверяет её с EDITOR_API_VERSION в schema.js.
const EDITOR_API_VERSION = 18;

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const CONSTANTS_PATH = path.join(ROOT, 'Constants.js');
const OBJECTS_PATH = path.join(ROOT, 'Objects.js');
const MODELS_DIR = path.join(ROOT, 'assets', 'models');
const BACKUP_DIR = path.join(ROOT, '_utils', '.backups');
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

// --- Патч констант -----------------------------------------------------------

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const HEX = /^0[xX][0-9a-fA-F]+$/;

// Числа пишем без экспонент и мусорных хвостов float (0.65000000000004 -> 0.65).
function fmtNumber(v) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(6)));
}

// Отказы патча: code переводит клиент (err.<code> в i18n.js), error — для лога и
// клиентов без перевода.
const ERRORS = {
  not_found: 'constant not found in Constants.js',
  not_literal: 'the value in the file is not a number literal (a formula?) — unsafe to patch',
  bad_value: 'the new value is not a number',
  bad_name: 'invalid name',
  bad_objects: 'the object list is not an array',
  bad_model: 'model path must be assets/….fbx (ASCII, no spaces)',
  not_fbx: 'not an .fbx file',
  not_binary: 'ASCII FBX is not supported — export a binary FBX',
  too_large: 'the file is too large',
  dialog_failed: 'the file dialog failed to open',
  unsupported: 'no system file dialog on this OS',
};
const failure = (code, extra) => Object.assign({ ok: false, code, error: ERRORS[code] }, extra);
const rejected = (name, code) => ({ name, ok: false, code, error: ERRORS[code] });

// `const ИМЯ = <число>;` -> новое число. Формулы и не-числа не трогаем.
function patchScalar(src, name, value) {
  const re = new RegExp('^(const\\s+' + name + '\\s*=\\s*)([^;\\n]+?)(\\s*;)', 'm');
  const m = re.exec(src);
  if (!m) return { code: 'not_found' };
  const was = m[2].trim();
  if (!NUMBER.test(was) && !HEX.test(was)) return { code: 'not_literal' };
  // Формат литерала сохраняем: цвет ушёл 0x1e6c80 — вернётся 0x1e6c80.
  const num = HEX.test(was)
    ? ((Number(value) >= 0 && Number.isFinite(Number(value)))
        ? '0x' + (Number(value) >>> 0).toString(16).padStart(6, '0') : null)
    : fmtNumber(value);
  if (num === null) return { code: 'bad_value' };
  return { src: src.slice(0, m.index) + m[1] + num + m[3] + src.slice(m.index + m[0].length) };
}

// Копия файла в _utils/.backups/<prefix>-<время>.js; хранятся 20 последних на префикс.
async function backupFile(file, prefix) {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dest = path.join(BACKUP_DIR, prefix + '-' + stamp + '.js');
  await fsp.copyFile(file, dest);
  const files = (await fsp.readdir(BACKUP_DIR)).filter(f => f.startsWith(prefix + '-')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 20))) {
    await fsp.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
  }
  return path.relative(ROOT, dest).split(path.sep).join('/');
}

// changes: [{ name: 'CAMERA_FOV_DEG', value: 52 }]
async function saveConstants(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: 'empty change list' };
  }
  // BOM (если есть) снимаем на время патча и возвращаем при записи.
  const raw = await fsp.readFile(CONSTANTS_PATH, 'utf8');
  const hadBom = raw.charCodeAt(0) === 0xFEFF;
  let src = hadBom ? raw.slice(1) : raw;

  const results = [];
  let patched = 0;
  for (const ch of changes) {
    const name = String(ch && ch.name || '');
    if (!IDENT.test(name)) {
      results.push(rejected(name, 'bad_name'));
      continue;
    }
    const r = patchScalar(src, name, ch.value);
    if (r.code) {
      results.push(rejected(name, r.code));
    } else {
      src = r.src;
      patched++;
      results.push({ name, ok: true });
    }
  }

  let backup = null;
  if (patched > 0) {
    backup = await backupFile(CONSTANTS_PATH, 'Constants');
    await fsp.writeFile(CONSTANTS_PATH, hadBom ? '\uFEFF' + src : src, 'utf8');
  }
  return { ok: results.every(r => r.ok), patched, results, backup };
}

// --- \u041E\u0431\u044A\u0435\u043A\u0442\u044B \u043B\u043E\u043A\u0430\u0446\u0438\u0438: Objects.js ----------------------------------------------

// \u041F\u0443\u0442\u044C \u043C\u043E\u0434\u0435\u043B\u0438: .fbx \u0432\u043D\u0443\u0442\u0440\u0438 assets/, ASCII \u0431\u0435\u0437 \u043F\u0440\u043E\u0431\u0435\u043B\u043E\u0432 (\u0442\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u0435 \u0430\u0440\u0445\u0438\u0432\u0430 \u043F\u043B\u043E\u0449\u0430\u0434\u043A\u0438).
const MODEL_PATH = /^assets\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.fbx$/i;
const isModelPath = p => MODEL_PATH.test(p) && !p.split('/').some(s => s === '.' || s === '..');

const OBJECTS_HEADER = `// Objects.js — объекты локации: модели, расставленные в редакторе (вкладка Objects).
// Файл целиком перезаписывает редактор (POST /api/save-objects) — формат держать.
// Путь модели — строковый литерал от assets/: сборщик берёт в архив только ассеты с такими ссылками.
//   model — .fbx (Model3D.js); kind — 'prop' (окружение) | 'actor' (главный объект кадра);
//   x, y — px карты; h — px над землёй; rot — [x, y, z] градусы: y — курс (0 — вдоль +x,
//   90 — вниз по карте), x и z — наклон; scale — [x, y, z] к размеру модели (1 см в файле = 1 px);
//   anim — вращение части модели (необязательно): part — объект внутри FBX (крутится вокруг
//   своего origin из Blender), axis — его ось 'x' | 'y' | 'z' (с минусом — обратный конец),
//   speed — об/мин, dir — 'cw' | 'ccw': по/против часовой, если смотреть с конца оси.
`;

// \u0427\u0438\u0441\u043B\u043E \u0441 \u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0439 \u0442\u043E\u0447\u043D\u043E\u0441\u0442\u044C\u044E \u0431\u0435\u0437 \u0445\u0432\u043E\u0441\u0442\u043E\u0432 float; \u043D\u0435 \u0447\u0438\u0441\u043B\u043E \u2014 null.
function fmtFixed(v, digits) {
  const n = Number(v);
  return Number.isFinite(n) ? String(parseFloat(n.toFixed(digits))) : null;
}

// \u0422\u0440\u043E\u0439\u043A\u0430 [x, y, z] \u0441 \u0442\u043E\u0447\u043D\u043E\u0441\u0442\u044C\u044E digits; \u0447\u0438\u0441\u043B\u043E \u2014 \u0441\u0442\u0430\u0440\u0430\u044F \u0437\u0430\u043F\u0438\u0441\u044C (rot \u2014 \u043A\u0443\u0440\u0441, scale \u2014
// \u0440\u0430\u0432\u043D\u043E\u043C\u0435\u0440\u043D\u044B\u0439) \u0440\u0430\u0437\u0432\u043E\u0440\u0430\u0447\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u043F\u043E asNumber. \u041D\u0435 \u0447\u0438\u0441\u043B\u0430 \u0438\u043B\u0438 non-positive (positive) \u2014 null.
function fmtTriple(v, digits, asNumber, positive) {
  const t = Array.isArray(v) ? v : (v == null ? null : asNumber(v));
  if (!t || t.length !== 3) return null;
  const out = t.map(n => fmtFixed(n, digits));
  if (out.includes(null) || (positive && out.some(n => !(Number(n) > 0)))) return null;
  return '[' + out.join(', ') + ']';
}

// Имя объекта или части модели — в одинарных кавычках файла: без кавычек, обратной косой
// черты и управляющих символов, до 64 знаков.
const cleanName = v => String(v == null ? '' : v).replace(/[\x00-\x1f\\'"`]/g, '').trim().slice(0, 64);
const ANIM_AXES = ['x', '-x', 'y', '-y', 'z', '-z'];

// anim: { part, axis, speed, dir } -> хвост записи `, anim: { … }`; нет анимации — '', негодная — null.
function fmtAnim(a) {
  if (a == null) return '';
  const part = cleanName(a.part), speed = fmtFixed(a.speed, 1);
  if (!part || !ANIM_AXES.includes(a.axis) || speed === null || Number(speed) < 0) return null;
  return `, anim: { part: '${part}', axis: '${a.axis}', speed: ${speed}, dir: '${a.dir === 'ccw' ? 'ccw' : 'cw'}' }`;
}

// objects: [{ name, model, kind, x, y, h, rot: [x, y, z], scale: [x, y, z], anim? }] -> Objects.js целиком.
async function saveObjects(objects) {
  if (!Array.isArray(objects)) return failure('bad_objects');
  const lines = [];
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i] || {};
    const model = String(o.model || '');
    if (!isModelPath(model)) return failure('bad_model', { index: i });
    const n = {
      x: fmtFixed(o.x, 1), y: fmtFixed(o.y, 1), h: fmtFixed(o.h, 1),
      rot: fmtTriple(o.rot, 1, r => [0, r, 0], false),
      scale: fmtTriple(o.scale, 3, s => [s, s, s], true),
      anim: fmtAnim(o.anim),
    };
    if (Object.values(n).includes(null)) return failure('bad_value', { index: i });
    const kind = o.kind === 'actor' ? 'actor' : 'prop';
    lines.push(`    { name: '${cleanName(o.name)}', model: '${model}', kind: '${kind}', x: ${n.x}, y: ${n.y}, h: ${n.h}, rot: ${n.rot}, scale: ${n.scale}${n.anim} },\n`);
  }
  const src = OBJECTS_HEADER + 'const LOCATION_OBJECTS = [\n' + lines.join('') + '];\n';
  const backup = fs.existsSync(OBJECTS_PATH) ? await backupFile(OBJECTS_PATH, 'Objects') : null;
  await fsp.writeFile(OBJECTS_PATH, src, 'utf8');
  return { ok: true, count: lines.length, backup };
}

// --- \u0418\u043C\u043F\u043E\u0440\u0442 \u043C\u043E\u0434\u0435\u043B\u0435\u0439: assets/models/ -------------------------------------------

// \u0411\u0430\u0439\u0442\u044B \u043C\u043E\u0434\u0435\u043B\u0438 -> \u043F\u0443\u0442\u044C 'assets/\u2026'. \u0424\u0430\u0439\u043B \u0443\u0436\u0435 \u0432\u043D\u0443\u0442\u0440\u0438 assets/ \u0441 \u0433\u043E\u0434\u043D\u044B\u043C \u043F\u0443\u0442\u0451\u043C \u0431\u0435\u0440\u0451\u0442\u0441\u044F
// \u043A\u0430\u043A \u0435\u0441\u0442\u044C; \u0438\u043D\u0430\u0447\u0435 \u043A\u043E\u043F\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u0432 assets/models/ (\u0438\u043C\u044F \u2014 \u043B\u0430\u0442\u0438\u043D\u0438\u0446\u0430 \u0431\u0435\u0437 \u043F\u0440\u043E\u0431\u0435\u043B\u043E\u0432; \u0442\u043E\u0442 \u0436\u0435
// \u0444\u0430\u0439\u043B \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u043D\u0435 \u043A\u043E\u043F\u0438\u0440\u0443\u0435\u0442\u0441\u044F, \u0434\u0440\u0443\u0433\u043E\u0439 \u0441 \u0442\u0435\u043C \u0436\u0435 \u0438\u043C\u0435\u043D\u0435\u043C \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u0441\u0443\u0444\u0444\u0438\u043A\u0441 -2, -3\u2026).
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
    try { existing = await fsp.readFile(dest); } catch { /* \u0438\u043C\u044F \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E */ }
    if (existing && !existing.equals(data)) continue;
    if (!existing) await fsp.writeFile(dest, data);
    return { ok: true, path: 'assets/models/' + file, name: label, copied: !existing };
  }
}

// \u0421\u0438\u0441\u0442\u0435\u043C\u043D\u044B\u0439 \u0434\u0438\u0430\u043B\u043E\u0433 \u0432\u044B\u0431\u043E\u0440\u0430 .fbx, \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0439 \u0432 \u043F\u0430\u043F\u043A\u0435 dir. Windows \u2014 PowerShell +
// WinForms (-STA \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D); \u043F\u0443\u0442\u044C \u0438 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A \u0438\u0434\u0443\u0442 \u0447\u0435\u0440\u0435\u0437 env \u2014 \u0431\u0435\u0437 \u044D\u043A\u0440\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F.
// \u041D\u0435\u0432\u0438\u0434\u0438\u043C\u043E\u0435 \u043E\u043A\u043D\u043E-\u0432\u043B\u0430\u0434\u0435\u043B\u0435\u0446 TopMost: \u0438\u043D\u0430\u0447\u0435 \u0434\u0438\u0430\u043B\u043E\u0433 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0437\u0430 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u043E\u043C.
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
      const result = await saveConstants(body.changes);
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
      const result = await saveObjects(body.objects);
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
