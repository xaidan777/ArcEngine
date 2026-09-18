// ============================================================================
//  Сканер ссылок на ассеты. Один источник правды для dev-server и build.
// ----------------------------------------------------------------------------
//  В проекте нет сборки и нет манифеста: пути к ассетам живут строковыми
//  литералами в .js и в CSS внутри index.html. Сканер собирает их все,
//  сверяет с диском и заодно показывает, что на диске лежит мёртвым грузом.
//
//  ВАЖНО: путь, собранный из кусков ('assets/' + key + '.png'), сканер НЕ
//  увидит. Такие места добавлять в EXTRA_REFS ниже руками.
//
//  Ссылка на ПАПКУ ассетом не считается: файлы внутри код собирает из кусков.
//  Такие ссылки возвращаются отдельно (dirs) и не дают ни «нет ассета», ни
//  «используется».
// ============================================================================
import fsp from 'node:fs/promises';
import path from 'node:path';

// Пути, которые нельзя выцепить литералом. Пока пусто — все ссылки литеральные.
export const EXTRA_REFS = [];

// Файлы, нужные в сборке, но не являющиеся «ассетами». Новый <script> в
// index.html = новая строка здесь, иначе файл не попадёт в архив.
export const CODE_FILES = [
  'index.html',
  'js/Constants.js', 'js/Objects.js', 'js/World3D.js', 'js/Terrain3D.js', 'js/CameraControl.js', 'js/Model3D.js', 'js/Location3D.js', 'js/main.js',
  'libs/simplex-noise.js', 'libs/babylon.js',
];

// Что заведомо не едет в сборку.
export const BUILD_EXCLUDE = [
  'tools', 'build', 'dist', '.git', '.claude', 'claude', '_utils', 'tests',
  'CLAUDE.md', 'run.bat', 'build.bat', 'check.bat', 'upload.bat', 'editor.bat', 'run.sh', 'build.sh', 'check.sh', 'editor.sh', 'README.md', 'tsconfig.json', 'globals.d.ts',
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
 *   refs    — пути assets/... , на которые ссылается код (нормализованные, без ?v=)
 *   missing — из refs, чего нет на диске  (будущие 404)
 *   onDisk  — всё, что физически лежит в assets/
 *   unused  — лежит на диске, но ни одна ссылка не ведёт  (мёртвый вес архива)
 */
export async function collectRefs(root) {
  const all = await walk(root, root);

  // 1) вытаскиваем литералы
  const refs = new Set(EXTRA_REFS);
  const rx = /['"`]\s*(assets\/[^'"`)\s]+?)\s*['"`)]/g;
  for (const rel of all) {
    if (!SCAN_EXT.has(path.extname(rel).toLowerCase())) continue;
    if (rel.startsWith('libs/')) continue;           // сторонние библиотеки не трогаем
    const text = await fsp.readFile(path.join(root, rel), 'utf8');
    for (const m of text.matchAll(rx)) {
      refs.add(m[1].split('?')[0].split('#')[0]);
    }
  }

  const onDisk  = all.filter(f => f.startsWith('assets/')).sort();
  const diskSet = new Set(onDisk);

  // Папки — не ассеты (см. шапку): выносим из refs, чтобы не считались пропавшими.
  const dirs = [];
  const fileRefs = [];
  for (const r of [...refs].sort()) {
    const clean = r.replace(/\/+$/, '');
    let isDir = false;
    try { isDir = (await fsp.stat(path.join(root, clean))).isDirectory(); } catch { /* нет на диске — обычная проверка ниже */ }
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
