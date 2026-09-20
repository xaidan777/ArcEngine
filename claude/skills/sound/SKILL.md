---
name: sound
description: The game's sound — js/Sound3D.js (effects, music, sounds that stand on the map, channels and volumes), the sound field of a location object in Objects.js, the AUDIO_* constants, tools/make-sounds.mjs (the sample .wav files). Read before adding or changing ANY sound — a click, a footstep, a shot, background music, a sound at an object — before editing Sound3D.js, and before adding a file to assets/sounds.
---

# Sound: Sound3D.js, assets/sounds, the object's sound field

Web Audio, no dependencies and no library. Files — `.wav`, `.mp3`, `.ogg` in `assets/sounds/`.
`<script src="js/Sound3D.js">` stands before `World3D.js` (it is in `CODE_FILES`, skill `build`).

## The rule

**A sound that belongs to an OBJECT of the location is a record field, not code** — the `sound`
field of `Objects.js`, set in the editor's Objects tab (skill `editor`): a mill creaking, a
campfire, a fountain. The location plays it itself, it stands where the object stands, and the
user can change the file and the volume without touching code.

**A sound that belongs to an EVENT is code** — `Sound3D.play(…)` at the moment it happens: a
shot, a coin, a click, a footstep. The game decides when.

```js
Sound3D.play('assets/sounds/click.wav');                       // as is: UI, a 2D effect
Sound3D.play('assets/sounds/coin.wav', { x, y });              // at a map point: fades with distance
Sound3D.play('assets/sounds/engine.wav', { at: car, loop: true });   // follows car.x, car.y
Sound3D.play('assets/sounds/hum.wav', { x, y, falloffMin: 40, falloffMax: 300 });  // its own radii
Sound3D.music('assets/sounds/theme.mp3');                      // the one looped background track
```

The path is always a quoted LITERAL `'assets/sounds/…'`: the builder's asset scanner archives
only files referenced that way, and it reads comments too (skill `build`). A path built from
pieces (`'assets/sounds/' + name`) is invisible to it — such files go into `EXTRA_REFS`.

## play and the handle

`play(src, opts)` returns a handle AT ONCE and loads the file in the background (once per path,
cached): nothing is awaited, and calling it in `update(dt)` is fine. A missing or broken file is
a console warning and a silent handle — the game goes on.

| opts | |
|---|---|
| `volume` | 0..1, 1 by default |
| `loop` | looped until `stop()` |
| `channel` | `'sfx'` (default) or `'music'` — their own volumes |
| `x`, `y` | map px: the sound stands at that point |
| `at` | an object with live `x`, `y` fields (a record `def`, a game entity) — the sound follows it every frame |
| `falloffMin` | px: full volume within this radius, then it fades; none — `AUDIO_FALLOFF_MIN` |
| `falloffMax` | px: silent from there on; none — `AUDIO_FALLOFF_MAX` |
| `node` | a Babylon mesh whose world position wins over `x`/`y` (a location object passes its model) |

```js
const engine = Sound3D.play('assets/sounds/engine.wav', { at: car, loop: true });
engine.setVolume(0.3);      // throttle
engine.stop();              // with a short fade: a wave cut mid-swing clicks
engine.playing;             // false after stop() or the end of a sound that is not looped
Sound3D.stopAll();
Sound3D.setMuted(true);     // the editor's "sound" checkbox (unchecked at startup)
```

A sound that is not looped forgets itself when it ends — its handle need not be kept.
A LOOPED one is the caller's: keep the handle and `stop()` it, or it plays forever.

## Sounds on the map

`Sound3D.update(camera)` runs every frame from `main.js` (and from `lab.js` in the editor), after
`camera.update(dt)`. The listener stands WHERE THE CAMERA IS (`camera.cam.position`), not at the
point it looks at: moving away makes a sound quieter, zooming in makes it louder, and merely
turning around does not silence it. Remember the camera hangs back from its look-at point —
about 800 px at zoom 1 — so the radii are measured from there, not from the middle of the frame.

- Volume: full within the MIN radius — `AUDIO_FALLOFF_MIN` px, or the sound's own `falloffMin` —
  then linearly down to silence at the MAX one (`AUDIO_FALLOFF_MAX` or its own `falloffMax`).
  A core AT LEAST as big as the audible radius leaves no room to fade, so it becomes 0 and the
  sound fades from the source outward: a quiet local sound (`falloffMax: 125`) behaves sanely
  in a world whose `AUDIO_FALLOFF_MIN` is 300, instead of playing flat out and cutting off.
- The distance is the straight 3D one, so the audible region is a SPHERE around the source —
  that is exactly what the editor draws around a selected object.
- Pan: by which side of the SCREEN the source is on — it follows the camera heading
  (`camera.azimuth`), and it does not flip when a source passes through the center.
- No obstacles, no echo, no Doppler. Sound is presentation, not logic (invariant 4).
- The math is pure and tested: `Sound3D.spatial(source, listener, min, max, pan)` -> `{ gain, pan }`
  (`tests/sound.test.mjs`).

## Constants (`Constants.js`, the editor's Sound tab)

`AUDIO_MASTER_VOLUME`, `AUDIO_MUSIC_VOLUME`, `AUDIO_SFX_VOLUME` — 0..1 per channel;
`AUDIO_FALLOFF_MIN`, `AUDIO_FALLOFF_MAX` — px, the radii EVERY sound of the world uses unless it
carries its own pair; `AUDIO_PAN` — stereo width (0 — mono).
They live on the editor's **Sound** tab — schema groups `audio-mixer` and `audio-space` carry
`tab: 'sound'`, so the Inspector builds them there instead of Global Settings; it is one set of
constants with one Save (skill `editor`). The tab also lists the files of `assets/sounds` and
plays one on click (`sound-panel.js`). Edits apply live (`Lab.onConstant` -> `Sound3D.applyConstants()`).
A sound's own numbers (the interval between footsteps and the like) are constants of the game,
not of the sound system: `GAME_STEP_SEC` — invariant 3.

## A sound at a location object (`def.sound`)

```js
{ name: 'mill', model: 'assets/models/mill.fbx', …, sound: { src: 'assets/sounds/mill.mp3', volume: 0.25 } }
```

`Location3D.updateSound` reads it every frame: looped unless `loop: false`, standing at the
model's own position. It restarts only when the FILE or the loop mode changes — volume and both
radii apply on the fly, so dragging a slider in the editor does not stutter. A `hidden` object is
silent; `removeObject` and `dispose` stop the sound.

The editor's Objects tab has both radii as **Falloff Min / Falloff Max**, and the view draws them
around the selected object as two faint yellow WIREFRAME SPHERES — three great circles each,
like a gizmo (`ObjectsPanel.spheres`, §Sound spheres in the editor skill). What is drawn is what
is heard: inside the outer sphere the sound plays, outside it is silent. 0 means the common
`AUDIO_FALLOFF_*` value — most objects keep both at 0 and only the odd one needs its own pair.
The spheres are drawn only while the view toolbar's "sound" checkbox is on, and that checkbox
starts unchecked — the editor is silent until you ask it to play.

## Files in `assets/sounds`

Ordinary assets — put `.wav`, `.mp3` or `.ogg` there and the editor's Sound tab lists them
(a click auditions one), while the Objects tab offers them for an object's `sound` field.

`step.wav` is SYNTHESIZED by `tools/make-sounds.mjs` — no recording, no licence questions;
replace it with a real one. The tool owns only the files it generates and never touches the rest.

```
node tools/make-sounds.mjs          # write the files
node tools/make-sounds.mjs --check  # exit 1 if a file on disk differs from the generator
```

An effect of your own is a few lines there: an oscillator or `noise()` through an envelope ->
`writeWav` (PCM 16 bit, mono, 22050 Hz). A looped sound must not click at the seam — the
exported `loopedNoise()` shows how: the noise and the envelope are periodic over the loop, and
the filter runs one loop ahead of the part that is kept.

## Pitfalls

- **The browser keeps sound locked until the first click or key.** Everything started before
  that begins at that moment — nothing is lost, but sound on the loading screen is not heard.
  Do not try to work around it: no autoplay hack works, and a game that shouts before the user
  has touched it is a bad game.
- A hidden tab is suspended (`visibilitychange`): the frame loop stops there anyway.
- `Sound3D.play` inside `update(dt)` with no timer is a new sound EVERY frame — 60 copies a
  second. A repeating effect needs an interval of its own (`Game._stepTimer`).
- Web Audio is missing (an old browser): `init()` warns once and every call is a no-op —
  do not guard calls with `if`.
- Sound files are assets: a `.mp3` of several MB is several MB of the archive. Effects —
  short `.wav`, music — `.mp3`/`.ogg`.
- A sound with `at` holds a reference to that object: an entity that dies must `stop()` its
  looped sounds, or it keeps sounding at its last coordinates.

## Checklist

1. A sound of an object — the `sound` field in `Objects.js` (the editor's Objects tab);
   a sound of an event — `Sound3D.play` in game code, with a LITERAL path.
2. A looped sound has an owner who calls `stop()`.
3. New numbers — in `Constants.js` + a row in `_utils/editor/schema.js` (skill `editor`).
4. `node tools/check.mjs` passes; new sound math — a test next to `tests/sound.test.mjs`.
5. Heard in the game (`run.bat`) after a click on the page: the effect where it should be,
   a sound on the map quieter as the camera moves away.
