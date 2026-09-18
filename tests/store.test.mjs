// Store (Constants.js): a localStorage wrapper that does not crash when the storage is closed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

const quietConsole = { ...console, warn() {} };

test('get/set/remove через localStorage', () => {
  const storage = memoryStorage();
  const Store = loadScripts(['js/Constants.js'], { localStorage: storage }).get('Store');
  assert.equal(Store.get('k'), null);
  assert.equal(Store.set('k', 5), true);
  assert.equal(Store.get('k'), '5');
  Store.remove('k');
  assert.equal(Store.get('k'), null);
});

test('getJSON: объект, отсутствие, битое и не-объектное значение', () => {
  const storage = memoryStorage();
  const Store = loadScripts(['js/Constants.js'], { localStorage: storage, console: quietConsole }).get('Store');
  const fallback = { level: 1 };
  assert.equal(Store.getJSON('save', fallback), fallback);

  storage.setItem('save', '{"level":3}');
  assert.deepEqual({ ...Store.getJSON('save', fallback) }, { level: 3 });

  storage.setItem('save', '{"level":');
  assert.equal(Store.getJSON('save', fallback), fallback);
  assert.equal(storage.data.has('save'), false, 'битое значение удаляется');

  storage.setItem('num', '42');
  assert.equal(Store.getJSON('num', fallback), fallback);
});

test('закрытое хранилище (SecurityError в sandbox-iframe) не роняет игру', () => {
  const globals = {};
  Object.defineProperty(globals, 'localStorage', {
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
    enumerable: true,
  });
  const Store = loadScripts(['js/Constants.js'], globals).get('Store');
  assert.equal(Store.get('k'), null);
  assert.equal(Store.set('k', 1), false);
  assert.doesNotThrow(() => Store.remove('k'));
  assert.deepEqual(Store.getJSON('k', { a: 1 }), { a: 1 });
});
