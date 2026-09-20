// The game's UI: anchor math of js/UI.js and the editor writing js/UILayout.js (save.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { UI_FIELDS, formatUI } from '../_utils/editor/save.mjs';
import { ROOT, loadScripts } from './browser-scripts.mjs';

const page = loadScripts(['js/Constants.js', 'js/UI.js']);
const UI = page.get('UI');
const evalLayout = (src) => JSON.parse(JSON.stringify(vm.runInNewContext(src + '; UI_LAYOUT')));

const TEXT = { id: 'score', kind: 'text', anchor: 'top-right', x: 20, y: 16, text: "Don't \"stop\"", fontSize: 18, color: '#FFFFFF', shadow: '', alpha: 1, visible: 1 };
const BAR = { id: 'hp', kind: 'bar', anchor: 'bottom-center', x: 0, y: 40.26, w: 240, h: 18, value: 0.6, color: '#5ad05a', fill: '#10202c', border: '', radius: 9, alpha: 0.85, visible: 0 };

test('якорь: x и y идут от точки экрана к той же точке элемента', () => {
  const W = 1280, H = 720, w = 200, h = 50;
  assert.deepEqual({ ...UI.resolve({ anchor: 'top-left', x: 20, y: 10 }, w, h, W, H) }, { left: 20, top: 10 });
  assert.deepEqual({ ...UI.resolve({ anchor: 'bottom-right', x: 20, y: 10 }, w, h, W, H) }, { left: 1060, top: 660 });
  assert.deepEqual({ ...UI.resolve({ anchor: 'middle-center', x: 0, y: 0 }, w, h, W, H) }, { left: 540, top: 335 });
  assert.deepEqual({ ...UI.resolve({ anchor: 'top-center', x: -30, y: 5 }, w, h, W, H) }, { left: 510, top: 5 });
  assert.deepEqual({ ...UI.resolve({ anchor: 'мусор', x: 7, y: 8 }, w, h, W, H) }, { left: 7, top: 8 }, 'негодный якорь — top-left');
});

test('смена якоря не двигает элемент: toStored обратна resolve для всех 9 якорей', () => {
  const W = 1000, H = 600, w = 120, h = 40, left = 333, top = 222;
  for (const anchor of UI.ANCHORS) {
    const s = UI.toStored(anchor, left, top, w, h, W, H);
    assert.deepEqual({ ...UI.resolve({ anchor, x: s.x, y: s.y }, w, h, W, H) }, { left, top }, anchor);
  }
});

test('поля вида в редакторе и в рантайме совпадают: UI_FIELDS (save.mjs) = UI.DEFAULTS (UI.js)', () => {
  assert.deepEqual(Object.keys(UI_FIELDS).sort(), [...UI.KINDS].sort());
  for (const kind of UI.KINDS) {
    assert.deepEqual([...UI_FIELDS[kind]].sort(), Object.keys(UI.DEFAULTS[kind]).filter(k => k !== 'anchor').sort(), kind);
    assert.equal(formatUI([{ id: 'e', kind, ...UI.DEFAULTS[kind] }]).ok, true, 'значения по умолчанию сохраняются: ' + kind);
  }
});

test('UILayout.js: запись читается игрой, числа округлены, текст с кавычками цел', () => {
  const r = formatUI([TEXT, BAR]);
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.deepEqual(evalLayout(r.src), [
    { ...TEXT, color: '#ffffff' },
    { ...BAR, y: 40.3 },
  ]);
});

test('UILayout.js: негодные элементы отклоняются с номером', () => {
  const bad = (patch) => formatUI([TEXT, { ...BAR, ...patch }]);
  assert.equal(formatUI('нет').code, 'bad_ui');
  for (const patch of [{ id: 'score' }, { id: '1st' }, { id: "a'b" }, { kind: 'image' }, { anchor: 'center' }, { w: -1 }, { value: 2 },
    { color: 'red' }, { fill: '#12345' }, { x: 'abc' }]) {
    const r = bad(patch);
    assert.equal(r.code, 'bad_element', JSON.stringify(patch));
    assert.equal(r.index, 1);
  }
});

test('js/UILayout.js набора записан редактором: формат воспроизводится, id не повторяются', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/UILayout.js'), 'utf8').replace(/\r\n/g, '\n');
  const r = formatUI(evalLayout(src));
  assert.equal(r.ok, true);
  assert.equal(r.src, src);
});

test('вложенность: parent пишется, корневой — нет; сам в себе, чужой id и цикл отклоняются', () => {
  const panel = { id: 'p', kind: 'panel', ...UI.DEFAULTS.panel };
  const button = { id: 'b', kind: 'button', ...UI.DEFAULTS.button, parent: 'p' };
  const r = formatUI([button, panel]);   // a child may stand before its parent
  assert.equal(r.ok, true);
  const out = evalLayout(r.src);
  assert.equal(out[0].parent, 'p');
  assert.equal('parent' in out[1], false, 'на экране — поле не пишется');
  const bad = (list, note) => {
    const f = formatUI(list);
    assert.equal(f.code, 'bad_element', note);
    assert.equal(f.field, 'parent', note);
  };
  bad([{ ...panel, parent: 'p' }], 'сам в себе');
  bad([{ ...button, parent: 'ghost' }], 'родителя нет в списке');
  bad([{ ...button, parent: "p'" }, panel], 'кавычка в id родителя');
  bad([{ ...panel, id: 'a', parent: 'b' }, { ...panel, id: 'b', parent: 'a' }], 'цикл a -> b -> a');
});

test('растяжение: stretch пишется у видов с размером, негодная ось отклоняется, у текста поля нет', () => {
  const panel = { id: 'dim', kind: 'panel', ...UI.DEFAULTS.panel, stretch: 'both', x: 0, y: 0 };
  assert.equal(evalLayout(formatUI([panel]).src)[0].stretch, 'both');
  assert.equal('stretch' in evalLayout(formatUI([{ ...panel, stretch: '' }]).src)[0], false, 'свой размер — поле не пишется');
  const f = formatUI([{ ...panel, stretch: 'diag' }]);
  assert.equal(f.code, 'bad_element');
  assert.equal(f.field, 'stretch');
  const text = evalLayout(formatUI([{ id: 't', kind: 'text', ...UI.DEFAULTS.text, stretch: 'h' }]).src)[0];
  assert.equal('stretch' in text, false);
});

test('растянутая ось: x (y) — отступ от края контейнера при любом якоре; текст не растягивается', () => {
  const W = 800, H = 600, w = 100, h = 40;
  const at = (def) => ({ ...UI.resolve(def, w, h, W, H) });
  assert.deepEqual(at({ kind: 'panel', anchor: 'bottom-right', stretch: 'h', x: 30, y: 10 }), { left: 30, top: 550 });
  assert.deepEqual(at({ kind: 'panel', anchor: 'middle-center', stretch: 'both', x: 5, y: 7 }), { left: 5, top: 7 });
  assert.deepEqual(at({ kind: 'text', anchor: 'top-right', stretch: 'both', x: 30, y: 10 }), { left: 670, top: 10 });
  assert.deepEqual({ ...UI.stretchOf({ kind: 'bar', stretch: 'v' }) }, { h: false, v: true });
});

test('дерево элементов: parentOf и isInside; нет родителя или цикл — элемент на экране', () => {
  const tree = loadScripts(['js/Constants.js', 'js/UI.js']).get('UI');
  const defs = [{ id: 'menu' }, { id: 'row', parent: 'menu' }, { id: 'ok', parent: 'row' }, { id: 'lost', parent: 'ghost' },
    { id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }];
  for (const def of defs) tree.elements.set(def.id, { def });
  const def = (id) => tree.elements.get(id).def;
  assert.equal(tree.parentOf(def('ok')).def.id, 'row');
  assert.equal(tree.parentOf(def('menu')), null);
  assert.equal(tree.parentOf(def('lost')), null, 'родителя нет');
  assert.equal(tree.parentOf(def('a')), null, 'цикл');
  assert.equal(tree.isInside(def('ok'), 'menu'), true, 'через предка');
  assert.equal(tree.isInside(def('menu'), 'ok'), false);
  assert.equal(tree.isInside(def('row'), 'row'), false, 'сам в себе не лежит');
});
