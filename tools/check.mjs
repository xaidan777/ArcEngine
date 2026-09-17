// ============================================================================
//  ArcEngine — проверка кода: типы (tsc) и тесты (node --test)
// ----------------------------------------------------------------------------
//  node tools/check.mjs            типы и тесты
//  node tools/check.mjs --types    только типы
//  node tools/check.mjs --tests    только тесты
//
//  Типы: TypeScript проверяет JS по JSDoc — tsconfig.json (игра) и
//  _utils/editor/tsconfig.json (редактор). TypeScript — не зависимость проекта:
//  npx берёт его из кэша npm (первый запуск скачивает). Типы Babylon —
//  libs/babylon.d.ts, свои объявления — globals.d.ts. В архив ничего из этого не едет.
//
//  Тесты: tests/*.test.mjs — логика без 3D: Store, Terrain3D.heightAt, сканер
//  ассетов, запись редактором Constants.js и Objects.js (_utils/editor/save.mjs),
//  связка скиллов claude/skills/ с CLAUDE.md.
// ============================================================================
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const TSC = 'npx --yes -p typescript@7.0.2 tsc';

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', cyn: '\x1b[36m' };

const STEPS = [
  { flag: '--types', title: 'типы игры', run: () => spawnSync(TSC + ' -p tsconfig.json', { cwd: ROOT, shell: true, stdio: 'inherit' }) },
  { flag: '--types', title: 'типы редактора', run: () => spawnSync(TSC + ' -p _utils/editor/tsconfig.json', { cwd: ROOT, shell: true, stdio: 'inherit' }) },
  { flag: '--tests', title: 'тесты', run: () => spawnSync(process.execPath, ['--test', 'tests/*.test.mjs'], { cwd: ROOT, stdio: 'inherit' }) },
];

const only = ['--types', '--tests'].filter(f => process.argv.includes(f));
const failed = [];
console.log('\n' + C.cyn + C.b + '  ArcEngine' + C.r + ' ' + C.dim + '— проверка' + C.r);
for (const step of STEPS) {
  if (only.length && !only.includes(step.flag)) continue;
  console.log('\n' + C.b + '  ' + step.title + C.r);
  const r = step.run();
  if (r.status === 0) {
    console.log('  ' + C.grn + 'ok' + C.r);
  } else {
    failed.push(step.title);
    console.log('  ' + C.red + 'FAIL' + C.r + (r.error ? ' ' + r.error.message : ''));
  }
}
console.log('\n' + (failed.length
  ? C.red + C.b + '  Не прошло: ' + failed.join(', ') + C.r
  : C.grn + C.b + '  Всё прошло.' + C.r) + '\n');
process.exit(failed.length ? 1 : 0);
