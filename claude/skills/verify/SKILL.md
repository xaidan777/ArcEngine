---
name: verify
description: How to check a change with your own eyes and numbers — the Browser pane, Debug3D (held view, synchronous frames, benchmark, scene lint, debug render modes), measuring frame cost, reproducing the user's exact state, leaving no diagnostic state behind. Read before verifying any visual or performance change, before claiming something renders correctly or costs N ms, and when the user reports a defect you cannot see in your checks.
---

# Verifying what is on the screen

The game and the editor run in the Browser pane from `.claude/launch.json` (`game` — 9378,
`editor` — 9377; copy `claude/launch.json` if it is missing). Tests cover logic only — a
change to geometry, materials, light or shaders is verified in the pane. `Debug3D`
(`js/Debug3D.js`) is loaded in both pages; it does nothing until called.

## The user sees the same tab

The user watches the pane you drive and screenshots it. Anything left there — a light moved
"for a test", a disabled shadow, a camera parked under the ground — is, to them, the state
of the game.

- Every probe is save → test → restore inside ONE script call, or the tab is reloaded right
  after. Prefer numbers (pixel reads, buffer reads, `mesh.lightSources`) over visible edits.
- Do not drive the player's camera to look at something: `Debug3D.hold(pose)` overrides the
  view without touching the controller, `Debug3D.release()` hands it back untouched.
- Finish with `Debug3D.setMode('off')`, `Debug3D.release()` and no probe meshes in the scene.

## Looking at a place

```js
Debug3D.hold({ eye: [x, y, h], target: [x, y, h] });   // map px; or { eye, yaw, pitch }
Debug3D.frames(5);                                      // render now, do not wait for rAF
// screenshot
Debug3D.release();
```

- `hold` lifts the eye above the ground (`clamped: true` in the result). A camera below the
  terrain shows a washed-out frame that looks like a broken shader — check `clamped` before
  blaming the code.
- A hidden or background pane gets a few `requestAnimationFrame` ticks per second. Anything
  that settles over frames (shader compilation, eye adaptation, a render-once shadow map) has
  not settled when you screenshot after a 2 s timeout. Call `Debug3D.frames(n)`; shaders
  compile in parallel and still need real time — poll `material.isReady(mesh)`.
- After editing a `.js` reload the tab (servers send `no-store`). After editing
  `_utils/editor/server.mjs` or `save.mjs` the SERVER must be restarted — Node read them once;
  a user's long-running `editor.bat` keeps writing files in the old format.

## Reproduce the user's state, not yours

- Use the constants from the user's `Constants.js` and the quality or mode they run. A check
  passed with a value you forced in the console proves nothing about their screen.
- Rules that depend on tunable constants are tested on the real constants: the user moves
  sliders far beyond the defaults the rule was written for.
- When the user reports a visual defect and your check says "fine", the check is measuring
  the wrong thing. Validate it against a known-good reference in the same scene (a
  `MeshBuilder` primitive, a loaded model) before answering — and never answer a report with
  an alternative explanation backed only by your own test.

## Measuring cost

```js
Debug3D.bench();                 // { ms, fps, width, height } — GPU drained before and after
Debug3D.benchToggle(mesh);       // { on, off, delta } — A/B/A/B, best of each
Debug3D.benchToggle({ on() { /* feature on */ }, off() { /* feature off */ } });
```

- The pane's FPS counter is throttled and capped by vsync — it says nothing. `bench` renders
  back to back and calls `gl.finish()`.
- One 3D tab at a time: a second game or editor tab takes half of the GPU. Close yours.
- Same view, same render size for both sides. Report the size with the number.
- The first run after a toggle includes shader compilation: `benchToggle` alternates and
  takes the best runs for that reason. A change of defines (lights, shadows on or off) makes
  the next frames slow — do not read them as the cost of the feature.
- A cost of a full-screen effect scales with pixels; a cost of geometry with triangles and
  draw calls (`scene.getActiveMeshes()`, `engine._drawCalls`) — say which one you measured.

## Scene lint and debug views

`await Debug3D.lint()` (editor: "Lint scene") — inside-out meshes, normal map convention,
lights over the material limit and the sun not being last, shaders that failed or sit at the
WebGL2 limits, heavy meshes, a fully white or black frame. Zero findings on the kit's own
scene; every finding text says what to change. `Debug3D.setMode('backfaces' | 'normals' |
'wireframe' | 'off')` (editor: the "view:" select). Skill `render-conventions` explains each rule.

## Checklist

1. Console without errors in the game AND the editor (`read_console_messages`).
2. `Debug3D.lint()` — no errors; new geometry checked in "view: back faces".
3. Looked from the player's start camera with the user's constants; day and night if light changed.
4. Cost measured with `bench` / `benchToggle` when the change touches the frame; size reported.
5. Mode off, view released, probes removed — or the tab reloaded.
