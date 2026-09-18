// ============================================================================
//  ArcEngine — code check: types (tsc) and tests (node --test)
// ----------------------------------------------------------------------------
//  node tools/check.mjs            types and tests
//  node tools/check.mjs --types    types only
//  node tools/check.mjs --tests    tests only
//
//  Types: TypeScript checks the JS via JSDoc — tsconfig.json (game) and
//  _utils/editor/tsconfig.json (editor). TypeScript is not a project dependency:
//  npx takes it from the npm cache (the first run downloads it). Babylon types —
//  libs/babylon.d.ts, own declarations — globals.d.ts. None of this goes into the archive.
//
//  Tests: tests/*.test.mjs — logic without 3D: Store, Terrain3D.heightAt, the asset
//  scanner, the editor's writing of Constants.js and Objects.js (_utils/editor/save.mjs),
//  the link between the claude/skills/ skills and CLAUDE.md.
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
