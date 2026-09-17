// ============================================================================
//  ArcEngine — запись файлов игры редактором: патч Constants.js, Objects.js
//  целиком, бэкапы. Без HTTP: server.mjs зовёт эти функции, tests/ — тоже.
// ----------------------------------------------------------------------------
//  Патч Constants.js нарочно тупой и безопасный:
//   - меняются ТОЛЬКО строки вида `const ИМЯ = <число>;` (формулу не трогаем —
//     отказ); цвет 0xRRGGBB остаётся hex-литералом;
//   - перед каждой записью — бэкап в _utils/.backups/ (хранится 20 последних).
//  Objects.js пишется ЦЕЛИКОМ из проверенного списка (бэкап — туда же).
// ============================================================================
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const HEX = /^0[xX][0-9a-fA-F]+$/;
const BACKUP_KEEP = 20;

// Отказы: code переводит клиент (err.<code> в i18n.js), error — для лога и
// клиентов без перевода.
export const ERRORS = {
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
export const failure = (code, extra) => Object.assign({ ok: false, code, error: ERRORS[code] }, extra);
const rejected = (name, code) => ({ name, ok: false, code, error: ERRORS[code] });

// Путь модели: .fbx внутри assets/, ASCII без пробелов и без . / .. в сегментах.
const MODEL_PATH = /^assets\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.fbx$/i;
export const isModelPath = p => MODEL_PATH.test(p) && !p.split('/').some(s => s === '.' || s === '..');

// --- Бэкапы ------------------------------------------------------------------

// Копия файла в <root>/_utils/.backups/<prefix>-<время>.js; хранятся 20 последних на префикс.
async function backupFile(root, file, prefix) {
  const dir = path.join(root, '_utils', '.backups');
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dest = path.join(dir, prefix + '-' + stamp + '.js');
  await fsp.copyFile(file, dest);
  const files = (await fsp.readdir(dir)).filter(f => f.startsWith(prefix + '-')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
    await fsp.unlink(path.join(dir, f)).catch(() => {});
  }
  return path.relative(root, dest).split(path.sep).join('/');
}

// --- Constants.js --------------------------------------------------------------

// Числа пишем без экспонент и мусорных хвостов float (0.65000000000004 -> 0.65).
function fmtNumber(v) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(6)));
}

// `const ИМЯ = <число>;` -> новое число: { src } или { code }. Формулы и не-числа не трогаем.
export function patchScalar(src, name, value) {
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

// changes: [{ name: 'CAMERA_FOV_DEG', value: 52 }] -> патч <root>/js/Constants.js.
export async function saveConstants(root, changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: 'empty change list' };
  }
  const file = path.join(root, 'js', 'Constants.js');
  // BOM (если есть) снимаем на время патча и возвращаем при записи.
  const raw = await fsp.readFile(file, 'utf8');
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
    backup = await backupFile(root, file, 'Constants');
    await fsp.writeFile(file, hadBom ? '﻿' + src : src, 'utf8');
  }
  return { ok: results.every(r => r.ok), patched, results, backup };
}

// --- Objects.js ------------------------------------------------------------------

// Путь модели в шапке — без кавычек: сканер сборщика считает ссылкой любой литерал
// в кавычках, даже в комментарии.
export const OBJECTS_HEADER = `// Objects.js — объекты локации: модели, расставленные в редакторе (вкладка Objects).
// Файл целиком перезаписывает редактор (POST /api/save-objects) — формат держать.
// Путь модели — строковый литерал от assets/: сборщик берёт в архив только ассеты с такими ссылками.
//   model — .fbx (Model3D.js); kind — 'prop' (окружение) | 'actor' (главный объект кадра);
//   x, y — px карты; h — px над землёй; rot — [x, y, z] градусы: y — курс (0 — вдоль +x,
//   90 — вниз по карте), x и z — наклон; scale — [x, y, z] к размеру модели (1 см в файле = 1 px);
//   anim — вращение части модели (необязательно): part — объект внутри FBX (крутится вокруг
//   своего origin из Blender), axis — его ось 'x' | 'y' | 'z' (с минусом — обратный конец),
//   speed — об/мин, dir — 'cw' | 'ccw': по/против часовой, если смотреть с конца оси.
`;

// Число с фиксированной точностью без хвостов float; не число — null.
function fmtFixed(v, digits) {
  const n = Number(v);
  return Number.isFinite(n) ? String(parseFloat(n.toFixed(digits))) : null;
}

// Тройка [x, y, z] с точностью digits; число — старая запись (rot — курс, scale —
// равномерный) разворачивается по asNumber. Не числа или non-positive (positive) — null.
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

// objects: [{ name, model, kind, x, y, h, rot: [x, y, z], scale: [x, y, z], anim? }] ->
// { ok, src, count } или отказ (index — номер негодной записи).
export function formatObjects(objects) {
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
  return { ok: true, src: OBJECTS_HEADER + 'const LOCATION_OBJECTS = [\n' + lines.join('') + '];\n', count: lines.length };
}

// Список объектов -> <root>/js/Objects.js целиком (негодный список файл не трогает).
export async function saveObjects(root, objects) {
  const r = formatObjects(objects);
  if (!r.ok) return r;
  const file = path.join(root, 'js', 'Objects.js');
  const backup = fs.existsSync(file) ? await backupFile(root, file, 'Objects') : null;
  await fsp.writeFile(file, r.src, 'utf8');
  return { ok: true, count: r.count, backup };
}
