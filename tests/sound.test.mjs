// Sound (js/Sound3D.js): the distance and pan math, and the object sound of Location3D —
// logic without Web Audio (the frame loop feeds it a camera, the location — def.sound).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

const page = loadScripts(['js/Constants.js', 'js/Sound3D.js']);
const Sound3D = page.get('Sound3D');
const FULL = 300, MAX = 1500, PAN = 1;
// spatial(source, listener, min, max, width): world points { x, y — map px, h — height }.
const heard = (sx, sy, sh, lx, ly, lh, az, min, max) =>
  ({ ...Sound3D.spatial({ x: sx, y: sy, h: sh }, { x: lx, y: ly, h: lh, azimuth: az }, min, max, PAN) });
const at = (sx, sy, lx = 0, ly = 0, az = 0) => heard(sx, sy, 0, lx, ly, 0, az, FULL, MAX);
const round = (v) => Math.round(v * 1000) / 1000;

test('громкость: полная ближе AUDIO_FALLOFF_MIN, линейно до нуля к пределу, дальше — тишина', () => {
  assert.equal(at(0, 0).gain, 1, 'в точке слушателя');
  assert.equal(at(FULL, 0).gain, 1, 'на границе полной громкости');
  assert.equal(at(MAX, 0).gain, 0, 'на пределе слышимости');
  assert.equal(at(MAX + 5000, 0).gain, 0, 'дальше предела — не отрицательная');
  assert.equal(round(at((FULL + MAX) / 2, 0).gain), 0.5, 'на середине — половина');
  assert.equal(round(at(0, 900).gain), round(at(900, 0).gain), 'громкость не зависит от стороны');
});

test('предел слышимости: свой falloffMax у звука, вырожденный — не делит на ноль', () => {
  assert.equal(round(heard(400, 0, 0, 0, 0, 0, 0, 300, 500).gain), 0.5, 'ядро 300, предел 500 — на 400 половина');
  assert.equal(heard(10, 0, 0, 0, 0, 0, 0, 100, 0).gain, 0, 'нулевой предел слышимости — тишина, без деления на ноль');
});

test('falloffMin: тихий звук в мире с широким AUDIO_FALLOFF_MIN затухает от объекта, а не обрывается', () => {
  // The mill: its own audible radius 125 while the world's full-volume radius is 300.
  // A core at least as big as the radius leaves no room to fade — it becomes 0.
  const mill = (d) => round(heard(d, 0, 0, 0, 0, 0, 0, 300, 125).gain);
  assert.equal(mill(0), 1);
  assert.equal(mill(62.5), 0.5, 'на половине радиуса — половина громкости');
  assert.equal(mill(125), 0, 'на радиусе слышимости — тишина');
  assert.equal(mill(200), 0);
  // Its own falloffMin brings the flat core back inside that radius.
  const withCore = (d) => round(heard(d, 0, 0, 0, 0, 0, 0, 25, 125).gain);
  assert.equal(withCore(25), 1, 'внутри ядра — полная громкость');
  assert.equal(withCore(75), 0.5);
  assert.equal(withCore(125), 0);
});

test('слышимость — шар: на радиусе тишина в любую сторону, высота камеры считается', () => {
  // The listener stands at the origin; the source is 0 / 200 / 400 px away in different directions.
  const r = (sx, sy, sh) => round(heard(sx, sy, sh, 0, 0, 0, 0, 0, 400).gain);
  assert.equal(r(400, 0, 0), 0, 'по карте');
  assert.equal(r(0, 0, 400), 0, 'строго над слушателем — тот же предел');
  assert.equal(r(240, 0, 320), 0, 'наклонно: 240-320-400');
  assert.equal(r(0, 0, 200), 0.5, 'половина радиуса по высоте — половина громкости');
  // The camera hangs ~800 px above its look-at point: a sound at that point is already distant.
  assert.equal(round(heard(0, 0, 0, 0, 0, 800, 0, 0, 2000).gain), 0.6, 'высота камеры уменьшает громкость');
});

test('поворот камеры не выключает звук: громкость по расстоянию, азимут меняет только панораму', () => {
  const sound = { x: 500, y: 0, h: 0 }, eye = { x: 0, y: 0, h: 0, azimuth: 0 };
  const gains = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(az =>
    round(Sound3D.spatial(sound, { ...eye, azimuth: az }, 0, 1000, PAN).gain));
  assert.deepEqual(gains, [0.5, 0.5, 0.5, 0.5], 'куда бы камера ни смотрела — звук тот же');
  // Pan is damped near the listener (d / falloffMax), so compare the side, not the magnitude.
  const side = (az) => Math.sign(round(Sound3D.spatial(sound, { ...eye, azimuth: az }, 0, 1000, PAN).pan)) + 0;
  assert.deepEqual([side(0), side(Math.PI / 2), side(-Math.PI / 2), side(Math.PI)], [0, -1, 1, 0], 'а сторона — меняется');
});

test('панорама: сторона экрана по азимуту камеры, в точке слушателя — центр', () => {
  // The camera looks along +x (azimuth 0): "right on the screen" is +y of the map.
  assert.equal(round(at(0, 1000).pan), 1, 'справа от взгляда');
  assert.equal(round(at(0, -1000).pan), -1, 'слева');
  assert.equal(round(at(1000, 0).pan), 0, 'прямо по курсу');
  assert.equal(at(0, 0).pan, 0, 'ровно в точке слушателя — без скачка');
  assert.equal(round(at(0, FULL / 2).pan), 0.5, 'вблизи панорама нарастает от центра');
  // Turn the camera a quarter turn: the same source is now straight ahead.
  assert.equal(round(at(0, 1000, 0, 0, Math.PI / 2).pan), 0);
  const mono = Sound3D.spatial({ x: 0, y: 1000, h: 0 }, { x: 0, y: 0, h: 0, azimuth: 0 }, FULL, MAX, 0);
  assert.equal(round(mono.pan), 0, 'AUDIO_PAN = 0 — моно');
});

test('звук объекта: перезапуск только при смене файла и режима, громкость и радиусы — на лету', () => {
  const started = [];
  const fake = {
    play(src, opts) {
      const handle = { src, opts, playing: true, falloffMax: opts.falloffMax || 0, falloffMin: opts.falloffMin || 0,
        setVolume(v) { this.volume = v; return this; }, stop() { this.playing = false; } };
      started.push(handle);
      return handle;
    },
  };
  const loc = loadScripts(['js/Constants.js', 'js/Location3D.js'], { Sound3D: fake }).get('Location3D');
  const rec = { def: { x: 10, y: 20, sound: { src: 'assets/sounds/mill.mp3' } }, mesh: null };
  const update = () => loc.prototype.updateSound.call({ opts: {} }, rec);

  update();
  assert.equal(started.length, 1);
  assert.equal(started[0].src, 'assets/sounds/mill.mp3');
  assert.equal(started[0].opts.loop, true, 'по умолчанию — по кругу');
  assert.equal(started[0].opts.at, rec.def, 'звук едет за координатами записи');

  update();
  assert.equal(started.length, 1, 'кадр за кадром — тот же звук, без наслоения копий');

  rec.def.sound.volume = 0.3;
  rec.def.sound.falloffMax = 800;
  rec.def.sound.falloffMin = 120;
  update();
  assert.equal(started.length, 1, 'громкость и радиусы не перезапускают звук');
  assert.equal(started[0].volume, 0.3);
  assert.equal(started[0].falloffMax, 800);
  assert.equal(started[0].falloffMin, 120);

  rec.def.sound.loop = false;
  update();
  assert.equal(started.length, 2, 'смена режима — заново');
  assert.equal(started[0].playing, false, 'прежний остановлен');

  rec.def.hidden = true;
  update();
  assert.equal(started[1].playing, false, 'скрытый объект молчит');
  delete rec.def.hidden;
  update();
  assert.equal(started.length, 3, 'показали — зазвучал снова');

  delete rec.def.sound;
  update();
  assert.equal(started[2].playing, false, 'звук убрали из записи — остановлен');
});

test('удаление объекта останавливает его звук', () => {
  const handle = { playing: true, stop() { this.playing = false; } };
  const loc = loadScripts(['js/Constants.js', 'js/Location3D.js'], { Sound3D: {} }).get('Location3D');
  const rec = { def: {}, mesh: null, sound: handle, soundKey: 'assets/sounds/mill.mp3|loop' };
  const self = { objects: [rec], view: null };
  loc.prototype.removeObject.call(self, rec);
  assert.equal(handle.playing, false);
  assert.equal(rec.soundKey, '');
  assert.deepEqual(self.objects, []);
});

test('поиск по тегу: все объекты группы в порядке списка, пустой тег — ничего', () => {
  const loc = loadScripts(['js/Constants.js', 'js/Location3D.js'], { Sound3D: {} }).get('Location3D');
  const objects = [{ def: { name: 'a', tag: 'coin' } }, { def: { name: 'b' } }, { def: { name: 'c', tag: 'coin' } }];
  // Array.from: the list comes from the vm context — another realm, deepEqual compares prototypes.
  const find = (tag) => Array.from(loc.prototype.findByTag.call({ objects }, tag), r => r.def.name);
  assert.deepEqual(find('coin'), ['a', 'c']);
  assert.deepEqual(find('enemy'), []);
  assert.deepEqual(find(''), [], 'пустой тег не собирает объекты без тега');
});
