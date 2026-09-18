// ============================================================================
//  ArcEngine — builder of the build
// ----------------------------------------------------------------------------
//  node tools/build.mjs [flags]
//
//    --version=0.2.0   build version (default — GAME_VERSION from js/Constants.js);
//                      written into the build's js/Constants.js and into ?v= of <script>
//    --out=dist        where to put the archive                (default dist)
//    --no-zip          only assemble the build/ folder, do not archive
//    --keep-unused     do not drop assets that have no references
//    --force           build despite check errors
//    --quiet           no detailed log
//
//  What it does:
//    1. checks the project (assets, JS syntax, external requests, entry point);
//    2. puts into build/ ONLY what the game needs at runtime;
//    3. stamps the version: ?v= in <script src> and @font-face, GAME_VERSION;
//    4. packs into dist/<ARCHIVE_NAME>-<version>.zip (index.html strictly at the archive root);
//    5. prints a report: sizes, top files, what was dropped, what was checked.
//
//  WHY ?v= is stamped here and not at runtime:
//    index.html used to have a line appending '?v='+GAME_VERSION to the src of
//    already executed <script>s. That is a no-op: changing src after execution is
//    too late, the browser keeps serving the cached script. Cache busting of scripts
//    can only be done at build time — here.
// ============================================================================
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { collectRefs, CODE_FILES, human } from './asset-scan.mjs';
import { makeZip } from './zip.mjs';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ARCHIVE_NAME = 'arcengine';   // dist/<ARCHIVE_NAME>-<version>.zip

// File names in the archive: ASCII only, no spaces — Cyrillic and spaces
// in paths break unpacking and URLs on the hosting.
const SAFE_NAME = /^[A-Za-z0-9._\-/]+$/;

// --- Flag parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt  = (n, d) => {
  const a = argv.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : d;
};
const OUT_DIR     = path.resolve(ROOT, opt('out', 'dist'));
const BUILD_DIR   = path.join(ROOT, 'build');
const NO_ZIP      = flag('no-zip');
const KEEP_UNUSED = flag('keep-unused');
const FORCE       = flag('force');
const QUIET       = flag('quiet');

const C = { r:'\x1b[0m', b:'\x1b[1m', dim:'\x1b[2m', red:'\x1b[31m', grn:'\x1b[32m', ylw:'\x1b[33m', cyn:'\x1b[36m' };
const say  = (...a) => { if (!QUIET) console.log(...a); };
const ok   = m => say('  ' + C.grn + 'ok' + C.r + '   ' + m);
const warn = m => console.log('  ' + C.ylw + 'warn' + C.r + ' ' + m);
const errL = m => console.log('  ' + C.red + 'FAIL' + C.r + ' ' + m);

const problems = [];
const fail = m => { problems.push(m); errL(m); };

// ---------------------------------------------------------------------------
async function main() {
  say('\n' + C.cyn + C.b + '  ArcEngine' + C.r + ' ' + C.dim + '— сборка' + C.r);
  say(C.dim + '  ' + '='.repeat(58) + C.r + '\n');

  // --- version -------------------------------------------------------------
  const constantsSrc = await fsp.readFile(path.join(ROOT, 'js', 'Constants.js'), 'utf8');
  const vMatch = /const\s+GAME_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(constantsSrc);
  if (!vMatch) fail('в Constants.js не найден GAME_VERSION');
  const currentVersion = vMatch ? vMatch[1] : '0.0.0';
  const VERSION = opt('version', currentVersion);
  say('  версия: ' + C.b + VERSION + C.r +
      (VERSION !== currentVersion ? C.dim + ' (в исходниках ' + currentVersion + ')' + C.r : '') + '\n');

  // === 1. CHECKS ===========================================================
  say(C.b + '  [1/4] проверка проекта' + C.r);
  const scan = await collectRefs(ROOT);

  // 1a. missing assets — 404 at runtime
  if (scan.missing.length) {
    fail('нет ' + scan.missing.length + ' ассет(ов): ' + scan.missing.join(', '));
  } else {
    ok('все ' + scan.refs.length + ' ассетов на месте');
  }

  // 1b. entry point
  try {
    await fsp.access(path.join(ROOT, 'index.html'));
    ok('index.html есть — попадёт в корень архива');
  } catch { fail('нет index.html — у архива не будет точки входа'); }

  // 1c. syntax of every game script (libs/ is not ours — not checked)
  const gameScripts = CODE_FILES.filter(f => f.endsWith('.js') && !f.startsWith('libs/'));
  let syntaxBad = 0;
  for (const f of gameScripts) {
    try {
      await execFileP(process.execPath, ['--check', path.join(ROOT, f)]);
    } catch (e) {
      syntaxBad++;
      const line = String(e.stderr || e.message).split('\n').find(l => l.includes('Error')) || '';
      fail('синтаксическая ошибка в ' + f + ': ' + line.trim());
    }
  }
  if (!syntaxBad) ok('синтаксис ' + gameScripts.length + ' скриптов в порядке');

  // 1d. whether all code files are in place
  for (const f of CODE_FILES) {
    try { await fsp.access(path.join(ROOT, f)); }
    catch { fail('нет файла кода: ' + f); }
  }

  // 1e. include order: js/Constants.js must come first —
  //     the other modules read its globals already at load time.
  const indexSrc = await fsp.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const srcOrder = [...indexSrc.matchAll(/<script\s+src=["']([^"']+)["']/g)].map(m => m[1]);
  const localOrder = srcOrder.filter(s => !/^https?:/.test(s) && !s.startsWith('libs/'));
  if (localOrder[0] !== 'js/Constants.js') {
    fail('первым локальным скриптом должен идти js/Constants.js, а идёт ' + localOrder[0]);
  } else {
    ok('порядок подключения скриптов корректный');
  }

  // 1f. external scripts: zero dependencies — everything is in the archive
  const externals = srcOrder.filter(s => /^https?:\/\//.test(s));
  if (externals.length) fail('внешние скрипты: ' + externals.join(', '));

  // 1g. file names: ASCII only, no spaces
  const badNames = [...CODE_FILES, ...scan.refs].filter(n => !SAFE_NAME.test(n));
  if (badNames.length) {
    fail('недопустимые имена (пробелы/кириллица/юникод): ' + badNames.join(', '));
  } else {
    ok('имена файлов безопасны для распаковки');
  }

  // 1h. CASE of paths. Development happens on Windows (case does not matter),
  //     while the unpacked build is served from Linux — 'Assets/Car.png' is a 404 there.
  //     fs.existsSync does not catch this, so we compare against a real readdir.
  const caseBad = [];
  for (const rel of scan.refs) {
    const parts = rel.split('/');
    let dir = ROOT;
    for (let i = 0; i < parts.length; i++) {
      let names;
      try { names = await fsp.readdir(dir); } catch { break; }
      if (!names.includes(parts[i])) {
        const ci = names.find(n => n.toLowerCase() === parts[i].toLowerCase());
        if (ci) caseBad.push(rel + ' -> на диске "' + ci + '"');
        break;
      }
      dir = path.join(dir, parts[i]);
    }
  }
  if (caseBad.length) {
    fail('регистр пути не совпадает с диском (на Linux будет 404): ' + caseBad.join('; '));
  } else {
    ok('регистр всех путей совпадает с диском');
  }

  // 1i. absolute paths and stray external URLs in ALL shipped code.
  //     The game may be served from a nested path — everything must be relative.
  const shipped = CODE_FILES.filter(f => /\.(js|html|css)$/.test(f) && !f.startsWith('libs/'));
  const absHits = [], extHits = [];
  for (const f of shipped) {
    const text = await fsp.readFile(path.join(ROOT, f), 'utf8');
    text.split('\n').forEach((ln, i) => {
      if (/(?:src|href)\s*=\s*["']\/|url\(\s*['"]?\//.test(ln)) {
        absHits.push(f + ':' + (i + 1));
      }
      for (const m of ln.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
        if (!/^https?:\/\/www\.w3\.org/.test(m[0])) {
          extHits.push(f + ':' + (i + 1) + ' -> ' + m[0]);
        }
      }
    });
  }
  if (absHits.length) fail('абсолютные пути от корня (сломаются во вложенном пути): ' + absHits.join(', '));
  else ok('абсолютных путей нет — всё относительное');
  if (extHits.length) fail('обращения к внешним хостам: ' + extHits.join(', '));
  else ok('внешних запросов нет');

  // 1j. dead weight
  if (scan.unused.length) {
    let dead = 0;
    for (const f of scan.unused) dead += (await fsp.stat(path.join(ROOT, f))).size;
    const line = scan.unused.length + ' неиспользуемых ассетов (' + human(dead) + '): ' +
                 (KEEP_UNUSED ? 'оставлены (--keep-unused)' : 'в архив не попадут');
    if (KEEP_UNUSED) warn(line); else ok(line);
    for (const f of scan.unused) say('         ' + C.dim + '- ' + f + C.r);
  }

  if (problems.length && !FORCE) {
    console.log('\n' + C.red + C.b + '  Сборка остановлена: ' + problems.length + ' проблем(ы).' + C.r);
    console.log(C.dim + '  Исправьте их или соберите с --force, если знаете, что делаете.' + C.r + '\n');
    process.exit(1);
  }
  if (problems.length) warn('--force: собираю несмотря на ' + problems.length + ' проблем(ы)');

  // === 2. ASSEMBLING build/ ================================================
  say('\n' + C.b + '  [2/4] копирование в build/' + C.r);
  await fsp.rm(BUILD_DIR, { recursive: true, force: true });
  await fsp.mkdir(BUILD_DIR, { recursive: true });

  const assetList = KEEP_UNUSED ? scan.onDisk : scan.refs.filter(r => !scan.missing.includes(r));
  const manifest = [];

  for (const rel of [...CODE_FILES, ...assetList]) {
    const src = path.join(ROOT, rel);
    let data;
    try { data = await fsp.readFile(src); } catch { continue; }

    // --- transformations --------------------------------------------------
    if (rel === 'index.html') {
      data = Buffer.from(stampIndexHtml(data.toString('utf8'), VERSION), 'utf8');
    }
    if (rel === 'js/Constants.js' && VERSION !== currentVersion) {
      data = Buffer.from(
        data.toString('utf8').replace(
          /const\s+GAME_VERSION\s*=\s*['"][^'"]+['"]/,
          "const GAME_VERSION = '" + VERSION + "'"
        ), 'utf8');
    }

    const dest = path.join(BUILD_DIR, rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, data);
    manifest.push({ name: rel, data });
  }
  ok(manifest.length + ' файлов -> build/');

  const rawBytes = manifest.reduce((s, e) => s + e.data.length, 0);
  say('  ' + C.dim + 'распакованный размер: ' + human(rawBytes) + C.r);

  // === 3. ZIP ==============================================================
  let zipPath = null;
  say('\n' + C.b + '  [3/4] упаковка' + C.r);
  if (NO_ZIP) {
    say('  ' + C.dim + 'пропущена (--no-zip)' + C.r);
  } else {
    // index.html first — makes it obvious that the entry point is at the archive root
    manifest.sort((a, b) =>
      a.name === 'index.html' ? -1 : b.name === 'index.html' ? 1 : a.name.localeCompare(b.name));
    const zip = await makeZip(manifest);
    await fsp.mkdir(OUT_DIR, { recursive: true });
    zipPath = path.join(OUT_DIR, ARCHIVE_NAME + '-' + VERSION + '.zip');
    await fsp.writeFile(zipPath, zip);
    const ratio = (100 - zip.length / rawBytes * 100).toFixed(0);
    ok(path.relative(ROOT, zipPath) + ' — ' + human(zip.length) + ' ' + C.dim + '(сжатие ' + ratio + '%)' + C.r);
    ok('index.html лежит в корне архива');
  }

  // === 4. REPORT ===========================================================
  say('\n' + C.b + '  [4/4] отчёт' + C.r);

  const byDir = new Map();
  for (const f of manifest) {
    const d = f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : '.';
    byDir.set(d, (byDir.get(d) || 0) + f.data.length);
  }
  say('  ' + C.dim + 'по папкам:' + C.r);
  for (const [d, b] of [...byDir].sort((a, b) => b[1] - a[1])) {
    say('         ' + human(b).padStart(9) + '  ' + d + '/');
  }

  const top = [...manifest].sort((a, b) => b.data.length - a.data.length).slice(0, 8);
  say('  ' + C.dim + 'самые тяжёлые файлы:' + C.r);
  for (const f of top) say('         ' + human(f.data.length).padStart(9) + '  ' + f.name);

  say('\n' + C.dim + '  ' + '='.repeat(58) + C.r);
  if (problems.length) {
    console.log('  ' + C.ylw + C.b + 'Собрано с ' + problems.length + ' замечанием(ями).' + C.r);
  } else {
    console.log('  ' + C.grn + C.b + 'Готово.' + C.r);
  }
  if (zipPath) console.log('  Архив: ' + C.b + path.relative(ROOT, zipPath) + C.r);
  console.log('');
  process.exit(problems.length ? 2 : 0);
}

// --- Stamping the version into index.html -----------------------------------
function stampIndexHtml(html, version) {
  // 1) ?v= for local scripts
  html = html.replace(/(<script\s+src=")([^"]+)(")/g, (m, a, src, b) => {
    if (/^https?:\/\//.test(src)) return m;
    return a + src.split('?')[0] + '?v=' + version + b;
  });
  // 2) ?v= for the font in @font-face
  html = html.replace(/url\('(assets\/[^']+)'\)/g,
    (m, p) => "url('" + p.split('?')[0] + '?v=' + version + "')");
  return html;
}

main().catch(e => {
  console.error('\n' + C.red + 'Сборка упала: ' + e.stack + C.r + '\n');
  process.exit(1);
});
