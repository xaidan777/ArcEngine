// Asset scanner (tools/asset-scan.mjs): 'assets/…' references in code -> what goes into the
// archive, what is missing, what is extra.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { collectRefs } from '../tools/asset-scan.mjs';
import { ROOT } from './browser-scripts.mjs';

const temps = [];
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

// Mini project in a temp folder: { 'path': 'content' }.
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcengine-scan-'));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test('литералы в .js/.html/.css: найденные, пропавшие, лишние, папки', async () => {
  const root = project({
    'index.html': '<style>@font-face { src: url(\'assets/font.ttf?v=3\'); }</style>',
    'Game.js': "const MODEL = 'assets/models/mill.fbx';\nconst TEX = \"assets/tex.png?v=0.1.0\";\nconst DIR = `assets/sounds/`;",
    'style.css': 'body { background: url("assets/bg.png"); }',
    'assets/models/mill.fbx': 'fbx',
    'assets/tex.png': 'png',
    'assets/unused.png': 'png',
    'assets/sounds/hit.mp3': 'mp3',
  });
  const scan = await collectRefs(root);
  assert.deepEqual(scan.refs, ['assets/bg.png', 'assets/font.ttf', 'assets/models/mill.fbx', 'assets/tex.png']);
  assert.deepEqual(scan.missing, ['assets/bg.png', 'assets/font.ttf']);
  assert.deepEqual(scan.dirs, ['assets/sounds']);
  // Files inside a folder the code refers to are assembled from pieces — unknown to the scanner.
  assert.deepEqual(scan.unused, ['assets/sounds/hit.mp3', 'assets/unused.png']);
});

test('libs/, tools/, _utils/ и файлы вне .js/.html/.css ссылками не считаются', async () => {
  const root = project({
    'libs/lib.js': "load('assets/lib.png');",
    'tools/tool.js': "load('assets/tool.png');",
    '_utils/editor/panel.js': "load('assets/editor.png');",
    'notes.md': "'assets/doc.png'",
    'server.mjs': "'assets/server.png'",
    'assets/a.png': 'png',
  });
  const scan = await collectRefs(root);
  assert.deepEqual(scan.refs, []);
  assert.deepEqual(scan.unused, ['assets/a.png']);
});

test('в проекте нет ссылок на пропавшие ассеты', async () => {
  const scan = await collectRefs(ROOT);
  assert.deepEqual(scan.missing, []);
});
