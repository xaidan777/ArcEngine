// Location tags and hidden objects: Location3D.findByTag/setHidden/applyHidden (pure logic,
// no WebGL) and the Objects.js round-trip of the two optional fields (tag, hidden) through
// _utils/editor/save.mjs formatObjects — the editor must not drop what a designer typed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { formatObjects } from '../_utils/editor/save.mjs';
import { ROOT, loadScripts } from './browser-scripts.mjs';

// Location3D's class body evaluates without Babylon: the constructor (the only part that needs
// a real view) is never called — the methods under test are borrowed onto a plain `this`.
function makeLocation(opts = {}) {
    const page = loadScripts(['js/Location3D.js']);
    const Location3D = page.get('Location3D');
    return { Location3D, loc: Object.assign(Object.create(Location3D.prototype), { opts, objects: [] }) };
}

// A minimal mesh: setEnabled + children, which is all applyHidden touches.
function fakeMesh() {
    const children = [{ visibility: 1 }, { visibility: 1 }];
    return {
        enabled: true, children,
        setEnabled(v) { this.enabled = v; },
        getChildMeshes() { return children; },
    };
}

// A record shaped like Location3D.addObject produces: { def, mesh, error, loaded }.
function rec(def, mesh = null) {
    return { def, mesh, error: null, loaded: Promise.resolve(null) };
}

// --- findByTag -------------------------------------------------------------------

test('findByTag: только объекты с этим тегом, в порядке списка', () => {
    const { loc } = makeLocation();
    const a = rec({ name: 'a', tag: 'loot' });
    const b = rec({ name: 'b', tag: 'boss' });
    const c = rec({ name: 'c', tag: 'loot' });
    const d = rec({ name: 'd' });   // без тега
    loc.objects = [a, b, c, d];

    assert.deepEqual(loc.findByTag('loot'), [a, c]);
    assert.deepEqual(loc.findByTag('boss'), [b]);
    assert.deepEqual(loc.findByTag('extraction'), []);
});

test('findByTag: неизвестный тег — пусто, первый элемент undefined (контракт findByTag(t)[0])', () => {
    const { loc } = makeLocation();
    loc.objects = [rec({ name: 'a', tag: 'loot' })];
    const none = loc.findByTag('nope');
    assert.equal(none.length, 0);
    assert.equal(none[0], undefined, 'findByTag("nope")[0] должен быть undefined, а не объект');
    // Тег не задан или не строка — тоже пусто, без исключения.
    // (Длина, а не deepEqual: пустой массив возвращается из другого realm — vm.)
    for (const empty of ['', null, undefined]) assert.equal(loc.findByTag(empty).length, 0);
});

test('findByTag: совпадение строгое, без подстрок и без учёта регистра-несовпадений', () => {
    const { loc } = makeLocation();
    loc.objects = [rec({ name: 'a', tag: 'loot' }), rec({ name: 'b', tag: 'loot_big' })];
    assert.deepEqual(loc.findByTag('loot').map(r => r.def.name), ['a']);
    assert.deepEqual(loc.findByTag('Loot'), []);
});

// --- setHidden / applyHidden -------------------------------------------------------

test('setHidden: объект выключается вместе с детьми и сообщает, что он скрыт', () => {
    const { Location3D, loc } = makeLocation();
    const mesh = fakeMesh();
    const r = rec({ name: 'boss' }, mesh);

    loc.setHidden(r, true);
    assert.equal(r.def.hidden, true, 'def.hidden выставлен');
    assert.equal(mesh.enabled, false, 'setEnabled(false) гасит и детей');
    assert.equal(r.def.hidden, true);
    assert.equal(Location3D.GHOST_ALPHA > 0 && Location3D.GHOST_ALPHA < 1, true);

    loc.setHidden(r, false);
    assert.equal('hidden' in r.def, false, 'показ удаляет поле, а не пишет false');
    assert.equal(mesh.enabled, true);
});

test('setHidden: до загрузки модели не падает, а applyHidden догоняет меш позже', () => {
    const { loc } = makeLocation();
    const r = rec({ name: 'bridge' }, null);
    loc.setHidden(r, true);                 // mesh ещё null
    assert.equal(r.def.hidden, true);
    r.mesh = fakeMesh();
    loc.applyHidden(r);                     // модель приехала — состояние применяется
    assert.equal(r.mesh.enabled, false);
});

test('setHidden по тегу: гасит/показывает ВСЕ объекты с этим тегом и только их', () => {
    const { loc } = makeLocation();
    const m1 = fakeMesh(), m2 = fakeMesh(), m3 = fakeMesh();
    const a = rec({ name: 'loot-1', tag: 'loot' }, m1);
    const b = rec({ name: 'loot-2', tag: 'loot' }, m2);
    const c = rec({ name: 'rock', tag: 'prop' }, m3);
    loc.objects = [a, b, c];

    loc.setHidden('loot', true);
    assert.deepEqual([m1.enabled, m2.enabled, m3.enabled], [false, false, true]);
    assert.deepEqual([a.def.hidden, b.def.hidden, 'hidden' in c.def], [true, true, false]);

    loc.setHidden('loot', false);
    assert.deepEqual([m1.enabled, m2.enabled], [true, true]);
    assert.deepEqual(['hidden' in a.def, 'hidden' in b.def], [false, false], 'показ удаляет поле');

    // Неизвестный тег — ничего не трогает и не бросает.
    loc.setHidden('nope', true);
    assert.deepEqual([m1.enabled, m2.enabled, m3.enabled], [true, true, true]);
});

test('applyHidden: в редакторе (opts.showHidden) скрытый объект остаётся призраком', () => {
    const { Location3D, loc } = makeLocation({ showHidden: true });
    const mesh = fakeMesh();
    const r = rec({ name: 'boss' }, mesh);

    loc.applyHidden(r);                     // не скрыт — виден как обычно
    assert.deepEqual([mesh.enabled, ...mesh.children.map(c => c.visibility)], [true, 1, 1]);

    loc.setHidden(r, true);
    assert.equal(mesh.enabled, true, 'призрак остаётся включённым, чтобы его можно было выбрать');
    assert.deepEqual(mesh.children.map(c => c.visibility), [Location3D.GHOST_ALPHA, Location3D.GHOST_ALPHA]);

    loc.setHidden(r, false);
    assert.deepEqual(mesh.children.map(c => c.visibility), [1, 1], 'видимость возвращается к 1');
});

test('applyHidden: без showHidden (игра) скрытый объект выключен и не призрак', () => {
    const { loc } = makeLocation();
    const mesh = fakeMesh();
    const r = rec({ name: 'boss' }, mesh);
    loc.setHidden(r, true);
    assert.equal(mesh.enabled, false);
    assert.deepEqual(mesh.children.map(c => c.visibility), [1, 1], 'в игре прозрачность не трогается');
});

// --- Objects.js round-trip (formatObjects) ------------------------------------------

const HERO = {
    name: 'hero', model: 'assets/models/character.glb', kind: 'actor',
    x: 1029.4, y: 1010, h: 0, rot: [0, 60, 0], scale: [0.25, 0.25, 0.25],
};

function evalObjects(src) {
    new vm.Script(src, { filename: 'Objects.js' });   // syntax — like node --check
    return JSON.parse(JSON.stringify(vm.runInContext(src + '\nLOCATION_OBJECTS', vm.createContext({}))));
}

test('formatObjects: tag и hidden переживают запись и читаются обратно', () => {
    const r = formatObjects([{ ...HERO, tag: 'extraction', hidden: true }, { ...HERO, name: 'npc', tag: 'boss' }]);
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    assert.deepEqual(evalObjects(r.src), [
        { ...HERO, tag: 'extraction', hidden: true },
        { ...HERO, name: 'npc', tag: 'boss' },
    ]);
    assert.match(r.src, /, tag: 'extraction', hidden: true \}/, 'тег и hidden стоят в конце записи');
});

test('formatObjects: запись БЕЗ tag/hidden не получает пустых полей', () => {
    const r = formatObjects([HERO]);
    assert.equal(r.ok, true);
    const [obj] = evalObjects(r.src);
    assert.deepEqual(obj, HERO);
    assert.equal('tag' in obj, false);
    assert.equal('hidden' in obj, false);
    // The record line only, not the header comment (which documents both fields).
    const line = r.src.split('\n').find(l => l.includes('LOCATION_OBJECTS') === false && l.trim().startsWith('{'));
    assert.doesNotMatch(line, /tag:|hidden:/, 'пустые tag/hidden в запись не пишутся');
});

test('formatObjects: пустой/ложный tag и hidden: false — это отсутствие поля', () => {
    const r = formatObjects([{ ...HERO, name: 'a', tag: '', hidden: false },
        { ...HERO, name: 'b', tag: '   ', hidden: false },
        { ...HERO, name: 'c', tag: null, hidden: 0 }]);
    assert.equal(r.ok, true);
    for (const obj of evalObjects(r.src)) {
        assert.equal('tag' in obj, false, 'пустой тег не пишется');
        assert.equal('hidden' in obj, false, 'hidden: false/0 не пишется');
    }
});

test('formatObjects: tag чистится как name/clip — кавычки и управляющие символы', () => {
    const r = formatObjects([{ ...HERO, tag: "loot'\"\n`x`" }]);
    const [obj] = evalObjects(r.src);
    assert.equal(obj.tag, 'lootx');
    assert.match(r.src, /, tag: 'lootx' \}/);
});

test('formatObjects: настоящий Objects.js переживает round-trip без потерь', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'Objects.js'), 'utf8').replace(/^\uFEFF/, '');
    const list = vm.runInContext(src + '\nLOCATION_OBJECTS', vm.createContext({}));
    const again = formatObjects(JSON.parse(JSON.stringify(list)));
    assert.equal(again.ok, true);
    assert.deepEqual(evalObjects(again.src), JSON.parse(JSON.stringify(list)));
});

// --- Objects panel schema ------------------------------------------------------------

test('схема вкладки Objects: tag и hidden объявлены с текстами на двух языках', () => {
    const page = loadScripts(['_utils/editor/schema.js']);
    const fields = page.get('OBJECT_OPTIONAL_FIELDS');
    for (const name of ['tag', 'hidden']) {
        const f = fields.find(x => x.name === name);
        assert.ok(f, 'нет поля ' + name);
        assert.ok(f.label && f.label.en && f.label.ru, name + ': нет label en/ru');
        assert.ok(f.hint && f.hint.en && f.hint.ru, name + ': нет hint en/ru');
    }
    assert.equal(fields.find(x => x.name === 'tag').kind, 'text');
    assert.equal(fields.find(x => x.name === 'hidden').kind, 'flag');
});