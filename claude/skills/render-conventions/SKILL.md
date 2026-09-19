---
name: render-conventions
description: Conventions and hard limits for anything you add to the scene yourself — custom geometry (winding, sideOrientation), normal maps (OpenGL vs DirectX), extra lights (light limit, sun last, shadows of point lights), WebGL2 shader limits, thin instances, procedural placement. Read before building a mesh from vertex data, porting a generator or importing glTF, before creating a material with a normal map, before adding a light, and whenever something looks inside out, lit from the wrong side, or a light or a mesh silently disappears.
---

# Render conventions: what the engine assumes about your meshes, materials and lights

Every rule here is a defect that once reached the screen and was found by eye, not by a test.
`Debug3D.lint()` (`js/Debug3D.js`, editor button "Lint scene") checks most of them — run it
after adding geometry, materials or lights. Skill `verify` tells how to look at the result.

## Winding and `sideOrientation`

The scene is right-handed, back-face culling is on by default. Babylon decides which side of
a triangle is the front from the index order AND `sideOrientation`; vertex normals do not take
part. A mesh with the opposite order is drawn INSIDE OUT: front faces are culled and you see
the far inner wall. The silhouette is unchanged, so it looks plausible — but the texture is
mirrored and the light comes from the wrong side.

The rule (measured on Babylon primitives and glTF imports; `Debug3D.windingAgainstNormals`).
Take the triangle normal as `cross(b - a, c - a)`:

| Index order | The cross product points | Needs |
|---|---|---|
| Babylon's own: `MeshBuilder`, `Terrain3D`, `Model3D` (FBX triangles are written reversed) | AGAINST the vertex normals | default `sideOrientation` (`ClockWiseSideOrientation`, 0) |
| glTF, three.js ports, most generators written "by the book" (counter-clockwise from outside) | ALONG the vertex normals | `mesh.sideOrientation = BABYLON.Material.CounterClockWiseSideOrientation` (the glTF loader sets it itself) |

- Fix the flag, not the indices: rewriting the order also flips what `ComputeNormals` returns.
- `material.sideOrientation`, when set, overrides the mesh; a negative scale (mirrored world
  matrix) flips the side once more — Babylon accounts for it, and so does the lint.
- A check that compares winding with normals INSIDE one mesh proves only that they agree
  with each other. Whether the mesh is inside out is decided against the convention — compare
  with a `MeshBuilder` primitive or a loaded glTF in the same scene.
- Fast look: editor toolbar "view: back faces" (`Debug3D.setMode('backfaces')`) — an inside-out
  mesh is red from the outside.
- Copies made for a render target (impostor snapshots and the like) need the same flag.
- An open hull (a trunk without a bottom cap, a wall without a back) shows its inside wherever
  the ground does not hide the rim: a trunk planted at the ground height of its CENTER hangs
  in the air on the downhill side of a slope. Extend the mesh below the ground by the radius
  times the steepest slope, or add a cap.

## Normal maps

A map's convention is not in its pixels, only in its origin: Poly Haven `*_nor_gl`, glTF and
Blender bakes are OpenGL (Y up); `*_nor_dx`, Unreal and most "game ready" packs are DirectX.
In this right-handed scene an OpenGL map needs `material.invertNormalMapY = true` (exactly
what the glTF loader sets on imported materials, with `invertNormalMapX = false`); a DirectX map
needs `false`. With the wrong flag grooves look like ridges lit from the opposite side —
easy to mistake for flipped mesh normals. Keep `_nor_gl` / `_nor_dx` in the file name: the
lint judges by it and only leaves a note when the name says nothing.

## Lights

- Order: `HemisphericLight` is created first, the sun (`view.sun`) is the LAST light of the
  scene — the toon plugin reads the shadow of the last light. After adding lights:
  `scene.removeLight(view.sun); scene.addLight(view.sun)`.
- A material takes `maxSimultaneousLights` lights (4 by default), in scene order. One more
  light does not fail — it silently drops lights from the END, that is the sun, on every mesh
  the extra light reaches. Raise the limit on those materials or narrow the light with
  `includedOnlyMeshes`; count with `mesh.lightSources.length`.
- WebGL2 allows 12 uniform blocks per shader stage: Scene, Material and ONE PER LIGHT. About
  ten lights on one mesh is the ceiling; the next one makes the shader fail to link and the
  mesh disappears. Texture units: 16 — every shadow map and texture takes one.
- Dozens of small lights (lamps, fireflies) go into one `BABYLON.ClusteredLightContainer`
  (WebGL2): a single light slot for all of them. Clustered lights cast NO shadows, and a light
  that already has a shadow generator is not accepted into a cluster.
- A point light's shadow is a cube map: six scene passes per frame. For static casters bake
  it: `generator.getShadowMap().refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE`,
  and `resetRefreshCounter()` when the light or a caster moves. Set `light.shadowMinZ/MaxZ`
  to the light's range — the camera's far plane leaves no depth precision.
- A feature toggled by a preset or a constant must be tested in the state the player runs,
  not with the value you set by hand in the console.

## Custom shaders (`ShaderMaterial`, material plugins)

- The HDR pipeline spreads a NaN through bloom: `normalize()` of a zero vector or `pow()` of a
  negative whites out the WHOLE frame, not one pixel. Clamp inputs.
- Noise evaluated per pixel every frame is the most expensive way to get detail. Bake a
  seamless texture once at load (a sum of sinusoids with INTEGER wave vectors is periodic by
  construction), sample it two or three times at non-commensurate scales and rotations —
  mipmaps then remove far-field sparkle for free and the tile does not read.
- Transparent surfaces over an already rendered scene: `ALPHA_PREMULTIPLIED`, no depth write.

## Thin instances and procedural placement

- Copies of one mesh or model — `World3D.addInstances(view, source, kind, items)` (skill
  `world3d`, §Many copies): it keeps the rules below. By hand: one mesh per kind AT THE ORIGIN +
  `thinInstanceSetBuffer`; after changing the buffer — `thinInstanceRefreshBoundingInfo()`, or
  frustum culling works on stale bounds.
  `scene.pick` does not see thin instances of a multi-material mesh — pick with your own ray
  against per-instance bounds.
- Placement rules are written in RELATIVE terms (fractions of the snow line, of the map size),
  never as absolute px offsets from a constant the user tunes in the editor: a slider move must
  not wipe out the forest.
- Whatever refers to a placed instance (saved edits, game state) needs a stable id — a tag or
  the position at placement — not its index: indices shift whenever a rule or a constant
  changes the scatter.

## Checklist

1. `await Debug3D.lint()` in the game and "Lint scene" in the editor: no errors.
2. "view: back faces": nothing red from the outside.
3. New light: the sun is still last, `mesh.lightSources.length` ≤ the material's limit on the
   ground and on the biggest props, shadows still fall at night and by day.
4. Looked at from the player's camera with the player's constants — skill `verify`.
