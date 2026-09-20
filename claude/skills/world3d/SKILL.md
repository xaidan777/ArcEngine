---
name: world3d
description: The kit's 3D engine — World3D (engine, View3D, light, shadows, toon shader, ink edges and silhouette outline, addObject), Terrain3D (ground), Location3D (location), Model3D and Gltf3D (FBX and GLB models, skeleton, animation clips), Instances3D (many copies in one draw call), CameraControl (camera), Game.js (sample game). Read before editing World3D.js, Terrain3D.js, Location3D.js, Model3D.js, Gltf3D.js, Instances3D.js, CameraControl.js, Game.js, main.js and the CAMERA_*/WORLD3D_*/TERRAIN_*/LOCATION_* blocks of Constants.js, before adding objects, many copies of one object, or animated characters to the scene.
---

# 3D world: World3D, Terrain3D, Location3D, camera

Babylon.js 9.26 (`libs/babylon.js`, UMD, global `BABYLON`), no build step. The frame loop
belongs to the owner: `main.js` in the game, `_utils/editor/lab.js` in the editor.

```
main.js: World3D.init(canvas) -> new Location3D() -> new CameraController(view) -> UI.init(canvas) -> new Game(app)
         runRenderLoop: game.update(dt) -> location.update(dt) -> camera.update(dt) -> Sound3D.update(camera) -> World3D.renderFrame()
```

## Files (`js/`)

| File | What |
|---|---|
| `World3D.js` | `World3D`: `init(canvas)`, `renderFrame()`, `createView(opts)`, `cfg()` (all render constants), `applyRenderConstants(view)`, `addObject/removeObject`, ink edges (`inkMesh`, `InkSkin` — lines on the bones of a skinned mesh), outline (`outlineAdd/Remove`, fog tint `outlineFog`, `fogFactor`), `sunDirection()`, `hexColor3()`. `ArcToonPlugin` + `World3D.toon` (the `ArcToon` object). `View3D`: scene, camera, light, shadows, `pointerToGround`, `projectToScreen`, `dispose` |
| `Terrain3D.js` | height field from noise, grid `[0..W]×[0..H]`, ground ring beyond the edge, `heightAt`, `tiltAt`, `setGroundImage`, `applyTileSize` |
| `Location3D.js` | location = `View3D` + `Terrain3D` + ground texture (`GROUNDS`) + objects (`opts.objects` = `LOCATION_OBJECTS`); `ready` (promise: ground, models, shaders), `buildTerrain()` (objects settle on the new ground), `loadGround()`, `objects` (`{ def, mesh, error, loaded }`), `addObject(def)`, `placeObject(rec)`, `removeObject(rec)`, `update(dt)` (every frame: `spinPart` per `def.anim`, `playClip` per `def.clip`) |
| `Model3D.js` | binary FBX -> meshes: `load(url)` (parse with cache), `build(model, scene, { name })` (root without geometry, parts with `MultiMaterial`; a part mesh has `metadata = { part, pivot, axes }` — FBX object name, its origin and unit local axes in file coordinates), `dispose(view, root)` (with materials). 1 cm in the file = 1 px, the origin comes from the file. A `.glb` / `.gltf` url goes through the same `load(url, scene)` / `build` / `dispose` into `Gltf3D`; `clips(root)` — its `Clips3D` (null for FBX) |
| `Gltf3D.js` | glTF/GLB through Babylon's loader (`libs/babylonjs.loaders.min.js`): skeleton, textures, animation clips; PBR -> `StandardMaterial` for the toon shader. `Clips3D`: `names()`, `has(name)`, `play(name, { loop, speed, blend, then })`, `stop()`, `current` — §GLB models |
| `Objects.js` | `LOCATION_OBJECTS`: `{ name, model: 'assets/models/….fbx' \| '….glb', kind, x, y, h, rot: [x, y, z]°, scale: [x, y, z], anim?, clip?, tag?, hidden?, sound? }`; `rot[1]` is the heading (`rotation.y = −rot[1]`); `anim: { part, axis: 'x'\|'-x'\|'y'\|…, speed: rpm, dir: 'cw'\|'ccw' }` (FBX part spin); `clip: 'idle'` — looped clip of a GLB; `tag`, `hidden`, `sound` — §The scene as data. Written by the editor |
| `Game.js` | the sample game — where game logic starts: `constructor(app)`, `update(dt)` before the render; keeps its own state (`running`, `energy`) and shows it through `Model3D.clips` and `UI.get` (skill `ui`) |
| `Instances3D.js` | `World3D.addInstances(view, source, kind, items, opts)` — many copies of one mesh or model in one draw call per part (thin instances): `set(i, item)`, `setAll(items)`, `flush()`, `dispose()`, `ok`; pure `Instances3D.fill` — §Many copies |
| `Debug3D.js` | dev tools, inert until called: `lint(view?)` (inside-out meshes, normal map convention, light limit and sun order, WebGL2 shader limits, heavy meshes, blank frame — zero findings on the kit's scene), `hold(pose)`/`release()` (a view that bypasses the camera controller, eye kept above the ground), `frames(n)`, `bench()`/`benchToggle(target)`, `setMode('backfaces' \| 'normals' \| 'wireframe' \| 'off')`. Skills `render-conventions` and `verify` |
| `CameraControl.js` | `CameraController`: target, azimuth, pitch, zoom; DOM input; game and free modes; `ignorePointer(e)` — a press that is not for the camera |

## Coordinates

| Map (px) | Babylon | |
|---|---|---|
| `x` | `position.x` | right |
| `y` | `position.z` | down the map = +Z |
| height | `position.y` | up |
| `heading` (rad, `atan2(vy, vx)`) | `rotation.y = -heading` | model nose along +X |

The scene is **right-handed** (`useRightHandedSystem`): left-handed, the world came out
mirrored. "Right on screen" at azimuth `az` is `(−sin az, cos az)`; the only place with
that sign is `CameraController.screenDeltaToWorld/worldDeltaToScreen`.

Projections — only through `View3D`:
- `pointerToGround(px, py, h, terrain?)` — canvas CSS px -> map `{x, y}`: with `terrain` —
  intersection with the terrain (march + bisection), without — the plane `Y = h`;
  `null` — the ray goes into the sky. `createPickingRay` expects CSS px: it accounts for the
  render scale itself.
- `projectToScreen(x, y, h)` -> `{x, y, visible, behind}` in CSS px.
- Camera moved but no frame rendered yet — call `view.refreshMatrices()` first.

## World objects

```js
const mesh = BABYLON.MeshBuilder.CreateBox('crate', { size: 64 }, location.view.scene);
mesh.material = new BABYLON.StandardMaterial('crate-mat', location.view.scene);
World3D.addObject(location.view, mesh, 'prop');          // 'actor' | 'prop'
mesh.position.set(x, location.terrain.heightAt(x, y) + 32, y);
// ...
World3D.removeObject(location.view, mesh);               // materials are the owner's job
```

`addObject` assigns the materials a group (`metadata.toonGroup`: specular from constants,
toon), puts the root into the shadow map, the edges into the ink edges, and all parts into
ONE outline layer (the line follows the common silhouette). `actor` — main objects of the
frame (ink/outline level 1), `prop` — environment (level 2). The ground is group `ground`.

Everything created in the scene dies with `view.dispose()`. A separate `removeObject` is
needed only for what dies before the scene.

### The scene as data: tag, hidden, sound

The user places objects in the editor; game code takes them from there instead of creating them.
Three fields make that possible without naming every object in code:

```js
for (const coin of app.location.findByTag('coin')) { … }   // every object of the group, in list order
const hero = app.location.findByTag('player')[0] || null;  // one of a kind: [0], guard the null
app.location.setHidden(door, false);                       // a hidden object enters the scene
```

- **`tag`** — a group name (`'coin'`, `'spawn'`, `'enemy'`). It is the contract between the scene
  and the code: the user may rename or duplicate an object, and the code still finds it.
  Prefer it to `objects.find(o => o.def.name === …)` — a name is the user’s to change.
  The sample game takes its character by `Game.HERO_TAG`.
- **`hidden`** — placed but not in the scene: no mesh in the frame, no sound, until
  `setHidden(rec, false)`. This is how a level lays out what appears later — a boss, a bridge,
  a reward. In the EDITOR a hidden object stays visible as a ghost (`opts.showHidden`,
  `Location3D.GHOST_ALPHA`), otherwise there would be nothing to click and drag.
- **`sound`** — a sound standing at the object; the location plays it itself (skill `sound`).

A record field is live: assign it and call what reads it (`placeObject`, `applyHidden`);
`anim`, `clip` and `sound` are re-read every frame by `update(dt)`.

### Many copies of one thing

```js
const forest = World3D.addInstances(view, treeMesh, 'prop', items);   // items: [{ x, y, h, heading?, scale? }]
forest.set(7, { x, y, h, heading }); forest.flush();                  // move copies; every frame — opts.dynamic
forest.setAll(items);  forest.dispose();
```

More than a couple of hundred copies of one mesh or model (a forest, identical props, bullets,
fence posts) go through `addInstances`, not through a loop of `addObject`. A separate mesh is a
draw call of its own in the main pass, the shadow map, the outline mask and the ink edges:
10–15 µs of CPU per frame. Measured in the kit: 1000 two-part trees as 2000 separate meshes —
26 ms of CPU per frame (the whole frame budget is 16.6); as instances — 0.1 ms, with the same
toon, shadows, outline and ink edges. `Debug3D.lint()` warns from 200 look-alike meshes
(`many-copies`) and 1000 separate meshes (`many-meshes`).

- `item.h` is the height of the copy's origin — the helper does not ask the terrain:
  `h: terrain.heightAt(x, y)`. `heading` — rad, `scale` — a number or `[x, y, z]`.
- `source` — a mesh with geometry or a model root from `Model3D.build`; its own position is
  reset, parts with their own transforms are baked into vertices once. A SKINNED model is
  refused (`ok === false`, a console warning): one skeleton is one pose.
- The copies share the material, the kind and everything else of the mesh: no per-copy color,
  visibility or picking. `opts.dynamic` — copies that move every frame: the mesh is always drawn
  and its bounds are not refreshed on `flush()`.

## Light, shadows, toon, ink edges

All render numbers are read in ONE place — `World3D.cfg()` (typeof per name + default: in
the game the constants are lexical, in the editor they live on `window`).
`applyRenderConstants(view)` applies them to the live scene without a rebuild.

- **Light:** `HemisphericLight` (sky) is created FIRST, `DirectionalLight` (sun) — last.
  Flat ground ≈1.0 at `SUN 0.8 + SKYLIGHT 0.45`; sums > ~1.2 clamp to white.
- **Shadows:** `ShadowGenerator`, darkness always 0 — shadow color and strength are painted
  by the plugin (define `ARCSHADOW`): light in shadow = unshadowed light × `mix(1, SHADOW_COLOR, STRENGTH)`.
  The sun's ortho frustum is built around the SHADOW CASTER NEAREST THE CAMERA and shrinks to the
  caster BOUNDS (`fitShadowFrustum(cam, maxR)`, `cam` = the ground point under the eye + the
  heading: world bounding box + height × cos of sun elevation, 32 px quantum, center snapped to
  the texel grid, hysteresis, the nearest caster kept inside). Fitting by positions cut the shadow
  of a big model. The box is at most `WORLD3D_SHADOW_RADIUS` and cannot cover a whole frame, so it
  covers what is CLOSE, where a shadow is large on screen; `maxR` (the frame's footprint) is only a
  request. Do NOT lead it by `groundFocus()` — the ground at the frame center is not where the
  player is looking: fly up to a building and raise the head and it is a thousand px past the
  building, fly forward and down and it falls behind the camera, look from above and it sits under
  the eye. Each of those lost the frame's shadows entirely.
  `shadowMinZ/MaxZ = LIGHT_DIST ∓ 1200` — a narrow range, otherwise shadows vanish.
  Shadow acne (stripes and a sawtooth on faces at a sharp angle to the sun) is removed by the
  normal offset `WORLD3D_SHADOW_NORMAL_BIAS` — in shadow map TEXELS: the frustum "breathes"
  (140–720 px), `updateLightFrustum` converts it to px. PCF also compares depth at the
  neighbouring texels, so `applyLighting` itself adds the edge filter radius (`WORLD3D_SHADOW_SOFT`
  1/2/3 — 0.5/1.5/2.5 texels): without it the sawtooth came back on a soft edge.
- **Toon:** `ArcToonPlugin` (a `StandardMaterial` plugin), registered in `World3D.init`
  BEFORE the first scene — it attaches to materials on creation. Injection point — after the
  line `aggShadow=aggShadow/numLights;` in `default.fragment`: `diffuseBase` brightness is
  quantized into bands, specular by a threshold, rim light by fresnel. Values go in as
  uniforms; toggling `WORLD3D_TOON` — `markAllDefinesAsDirty`.
  `metadata.toon = false` removes bands from a material; unlit materials are left alone.
- **Ink edges:** `EdgesRenderer` (`inkMesh`), `checkVerticesInsteadOfIndices` — lowpoly
  triangles are disconnected. Width ≈ world px × 100. EVERY object of the scene gets them,
  including a skinned character: `EdgesRenderer` builds its lines once from the rest pose and
  its shader knows nothing about bones, so `InkSkin` maps each line end to the mesh vertex it
  came from and writes the posed ends into the line buffers before every draw (the mesh itself
  is still skinned on the GPU; ~0.05 ms per frame for the kit's character, 812 vertices). Like
  the outline, the ink is part of the toon look: at `WORLD3D_TOON = 0` there are no lines.
- **Silhouette outline:** `HighlightLayer` with `isStroke`, one layer per "view × rendering
  group" pair (`view._outlines['actor@0']`, `meshes`: mesh -> its line color). Width in screen
  px. Part of the toon look: at `WORLD3D_TOON = 0` (the editor's "toon shader" checkbox)
  `outlineAdd` does not add the mesh, `applyOutlines` removes and restores the outline live
  (ink edges go off and on with it). The line is drawn over the finished frame — scene
  fog does not touch it, so `outlineFog` (from `renderFrame`, before `scene.render()`) tints
  each mesh's line every frame with Babylon's fog formula: `mix(fogColor, WORLD3D_TOON_INK_COLOR, f)`,
  `f` — by the distance from the camera to the mesh center (`fogFactor`). No constants of its
  own. One tint per mesh: for a mesh with instances (thin or regular) the bounds center is the
  middle of the whole scatter, so the distance is taken to the camera look-at point
  (`camera.getTarget()`). The layer's mask background (`hl.neutralColor`) is the darkest tint
  among its meshes with alpha 0.

## Terrain3D and Location3D

- Height = `TERRAIN_BASE + noise` (two octaves). `heightAt` interpolates over THE SAME
  triangles as the mesh (diagonal `(i,j)-(i+1,j+1)`); beyond the grid — noise, like the ring.
- Triangle winding is picked by a normal check (+Y) and double-checked after
  `ComputeNormals`; the ring takes the same winding (`_swap`).
- Material — a tile (`DynamicTexture`, `invertY = false`), repeat `GROUND_TILE_SIZE`,
  UV `(x/W, y/H)` for both grid and ring — no seam at the edge. Ring brightness — `WORLD3D_OUTER_TINT`.
- Mobile: cell no finer than 12 px. Terrain is a picture: game logic does not ask 3D for
  height (the cell depends on the device).
- `Location3D` loads the texture by `LOCATION_GROUND` from `GROUNDS` — paths as LITERALS
  (the builder's asset scanner sees only those); file missing — flat-colored ground.
  In the editor `assetBase: '/'`, in the game paths are relative.
- Part spin (`def.anim`, `spinPart`): the part mesh with `metadata.part === anim.part` gets
  `setPivotPoint(pivot)` and a `rotationQuaternion` around `axes[axis]` (minus — the opposite
  end); the angle accumulates in `rec.spin`, `def` is untouched. A positive angle is
  counterclockwise as seen from the end of the axis (right-handed scene): `dir: 'ccw'` → +.
  `anim` removed or part changed — the previous part's quaternion and pivot are reset. Only a
  separate FBX object spins: in Blender the part is its own object with the origin on the axis.

## GLB models: skeleton and animation clips

```js
const model = await Model3D.load('assets/models/character.glb', view.scene);   // a LITERAL path
const hero = Model3D.build(model, view.scene, { name: 'hero' });
World3D.addObject(view, hero, 'actor');
hero.position.set(x, terrain.heightAt(x, y), y);
hero.rotation.y = -heading;                       // the model's nose looks along +X, like FBX
const clips = Model3D.clips(hero);                // Clips3D
clips.play(moving ? 'run' : 'idle');              // every frame is fine: the current clip is not restarted
clips.play('attack', { loop: false, then: 'idle' });
```

- A model placed in the editor: `rec = app.location.objects.find(o => o.def.name === 'character')`,
  `Model3D.clips(rec.mesh)` — `rec.mesh` is null until the file has loaded (`rec.loaded`).
  `def.clip` is the clip the location loops by itself; it acts only when the field CHANGES, so
  game code may drive the same model.
- `play` cross-fades from whatever is playing over `MODEL_CLIP_BLEND_SEC` (weights move
  before the scene's animations, their sum is kept at 1; switching back mid-fade continues from
  the current weights). `stop()` — the rest pose.
- Units and axes: glTF is meters with the front along +Z — `build` wraps the file's nodes in
  a node scaled by 100 (1 cm = 1 px) and turned by 90°. The root it returns is a plain
  `Mesh` without geometry: position, heading and scale go on it, like for an FBX model.
- Materials: glTF gives PBR, the toon plugin lives on `StandardMaterial` — every build gets
  its own `StandardMaterial` (base color linear -> gamma, base color texture, normal map with
  its invert flags, alpha, culling, `sideOrientation`). The file is loaded once per scene
  (`AssetContainer`), each `build` instantiates it: own meshes, skeleton and clips.
- Blender: one armature, actions named `idle`, `run`… pushed to NLA or exported as separate
  animations, format glTF Binary (`.glb`), +Y up. The kit's `character.glb` is generated by
  `node tools/make-character.mjs` (skill `build`) — a stand-in to replace.
- No loader script on the page — a `.glb` fails like a missing file (the object has `error`),
  the scene lives on.

## Camera

Zoom — screen px per world px at the look-at point; `dist = H / (2·tan(fov/2)·zoom)`.
Camera = target − (cos az, sin az)·cos(pitch)·dist, height + sin(pitch)·dist, no lower than
ground + 40 (`EYE_MIN`). The target normally sits on the ground; flight lifts it:
`target.h = ground + lift` (`lift` may be negative — the target goes under the ground while the
camera descends). Pitch is the angle below the horizon: negative — looking up.

| | game mode | free (`setFree(true)`, editor) |
|---|---|---|
| WASD, arrows | flight: W/S along the view (pitch included), A/D — strafe; speed `CAMERA_FLY_SPEED` screen px/s (÷ zoom over the world; the editor has a slider for it at the bottom right of the view) | same |
| Q / E | down / up along the world vertical | same |
| RMB | look around if `CAMERA_ORBIT = 1`: the camera stays, the target swings around it (`_look`); while `follow` is active — orbit around the object | look around |
| LMB | not taken (game input) | orbit around the target; Shift — pan |
| middle, finger | pan "follows the pointer" | same |
| wheel / pinch | zoom to cursor within `CAMERA_ZOOM_MIN..MAX` | wider limits |
| limits | none by default; `CAMERA_LIMITS = 1`: pitch `CAMERA_ORBIT_PITCH_*` and ground edge kept out of frame, target inside the location, `lift ≤ CAMERA_LIFT_MAX` | none: pitch −85°..88°, orbit not below 8° |

`home()` (key R) — orientation and zoom from constants, target — the `follow` object or the
center, on the ground (`lift = 0`; `lookAt(x, y)` drops `lift` too, `follow` decays it).
`applyConstants()` re-reads constants (FOV — immediately). Keys (`e.code`: WASD, arrows, Q, E,
R — `FLY_KEYS`) are not intercepted inside input fields. Flight (`_fly`) moves the target by a
world vector normalized to the step, keeps absolute height (`_setTarget3` turns it into
`lift`) and holds the camera above the ground (`_floorEye` raises `lift`, the view direction
stays). Pan keeps the ground point under the cursor by intersecting the plane at its height,
in two passes. `groundFocus()` — the ground point at the frame center (`{ x, y, h, k }`): in
flight it is ahead of the target (`k` — how many times farther than the target, capped at 4 and
below 1 when the target dips under the ground). The editor drops new objects there. NOT for the
shadow frustum — `_apply` hands `fitShadowFrustum` the ground under the eye and the heading.

## Pitfalls (each one already cost an iteration)

- `emissiveColor` of a material with `emissiveTexture` — BLACK, otherwise white is added to
  the texture and washes it out. `disableLighting` + `diffuseTexture` renders black.
- Vertex colors with `disableLighting`: the opposite, `emissiveColor` WHITE — otherwise all black.
- `clone()` copies `metadata` by reference: a clone's ink edges and outline would write into
  the shared object (`addObject` hands out its own copies).
- The outline needs a stencil: the engine is created with `stencil: true`.
- Outline width is in blur texels (`outlineKernel`), otherwise the line is four times thicker on mobile.
- An outline layer draws only meshes of its rendering group: a layer is created per group.
- `preserveDrawingBuffer: false`: a skipped frame shows garbage — render every tick.
- Instances cast no shadows if only the prototype is among the casters: use thin instances
  (`World3D.addInstances`) or `addShadowCaster` for each instance.
- A thin instance matrix is applied in the mesh's LOCAL space: the mesh has to stand at the
  origin with no rotation or scale (`Instances3D.prepare` resets the root and bakes the parts).
  A static thin instance buffer ignores `thinInstanceBufferUpdated` without a word — set the
  buffer again (`flush()` does) or create it dynamic.
- The outline compose runs in `ALPHA_PREMULTIPLIED`: the STROKE merge shader already
  multiplies color by alpha, and `ALPHA_COMBINE` multiplied a second time — a fog-colored
  line got a rim darker than the background, the far object dissolved while a "ghost" of the
  line remained. The mode lives in the private `hl._thinEffectLayer._options.alphaBlendingMode`,
  and `outlineLayer` sets it ONLY for the compose (`onBeforeComposeObservable` → 7,
  `onAfterComposeObservable` → 2). The layer reads the same options when recreating textures
  (canvas resize): with PREMULTIPLIED in the options the blur chain was built differently
  (2 passes instead of 3), the blur texture stayed empty and the outline vanished completely
  (this happened in the ArcTrack editor). A constructor option is ruled out for the same reason.
- The outline mask background matches the line tint (`outlineFog` sets `hl.neutralColor`).
  By default the mask is cleared to black, and the blur at the mask edge mixed it into the line
  color: at fractional widths (1.5, 0.5 px) and on mobile a fog-colored line got a dark fringe.
  It must not be lighter than the layer's darkest tint — the blur takes the brightest sample
  and would recolor the line of a near object. The layer has its own `neutralColor`
  (`outlineLayer`): by default all layers share the static `HighlightLayer.NeutralColor`.
- Babylon upgrade: if the injection line disappears, toon silently stops working (the shader
  stays intact); if the `_thinEffectLayer._options` field disappears, the outline "ghost" in
  fog comes back.
- `setTarget` degenerates at ±90° pitch — limits are 88–89° (−85° looking up).
- Camera math goes through `_eye()` (position from target/azimuth/pitch/zoom), not through
  `cam.position`: the Babylon camera also carries shake and the ground floor.
- `Model3D`: triangles are written in reverse FBX order (Babylon mesh convention, same as
  `Terrain3D`) — "fix" the winding and `backFaceCulling` turns the model inside out.
  `DiffuseColor` in the file is linear (Blender) — without `toGammaSpace()` colors are darker.
- A quoted `'assets/…'` path even in a COMMENT is treated by the builder's asset scanner as an
  asset reference — the build fails on a "missing" file. In comments — no quotes.
- A skinned mesh keeps its ink edges only through `InkSkin`: `EdgesRenderer` builds the lines
  once from the rest pose and Babylon's `line` shader has no bones, so without the per-frame
  re-pose the ink hangs in the rest pose. Its line buffers are created static
  (`updatable = false`) and `updateDirectly` on them does nothing WITHOUT A WORD — `InkSkin`
  replaces the pair with updatable buffers (private `er._buffers`, check it when upgrading
  Babylon). A line end is found by exact vertex coordinates; when several vertices share a
  position, the pair that shares a triangle wins, or a line at a seam would fly off with the
  wrong bone. The silhouette outline and shadows follow the skeleton by themselves.
- glTF front faces are counter-clockwise: the loader marks it with `sideOrientation` on the
  material — a material made by hand for a glTF mesh must copy it, or the model is inside out
  (skill `render-conventions`).
- `placeObject` resets `rotationQuaternion`: the editor gizmo may create one, and then
  `rotation` from `Objects.js` silently has no effect.

## Constants

Groups in `Constants.js`: `LOCATION_*`/`GROUND_TILE_SIZE`/`TERRAIN_*` (location),
`CAMERA_*` (camera), `WORLD3D_*` (render), `MODEL_*` (clips), `UI_*` (skill `ui`),
`AUDIO_*` (skill `sound`), `GAME_*` (the sample game). Values live in the file; the editor tunes them.

## Edit checklist

1. New constant: numeric literal in `Constants.js` + read via `typeof` with a default
   (`World3D.cfg()` / `CameraController.cfg()`) + a row in `_utils/editor/schema.js`
   (labels `{ en, ru }`, skill `editor`).
2. New script: file in `js/`, `<script src="js/…">` in `index.html` (after `Constants.js`,
   before `main.js`) and a line in `CODE_FILES` (`tools/asset-scan.mjs`); for the editor — the
   same script in its `index.html` (`/js/…`).
3. New world object — through `World3D.addObject`; screen↔world projections — through `View3D`.
4. Do not touch: `useRightHandedSystem`, CSS px in `createPickingRay`, light order,
   `shadowMinZ/MaxZ`, the terrain normal check.
5. `node tools/check.mjs` passes (types and tests, skill `build`); a new field on a Babylon
   object goes into `globals.d.ts`.
6. Check the game (`run.bat`) and the editor (`editor.bat`) in the browser: console without errors.
7. Own geometry, a material with a normal map, a new light or shader: `await Debug3D.lint()` — no
   errors (skill `render-conventions`); how to look and measure — skill `verify`.
