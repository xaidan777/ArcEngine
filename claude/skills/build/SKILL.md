---
name: build
description: Dev server, build and code checks — dev server (tools/dev-server.mjs), archive builder (tools/build.mjs, asset-scan.mjs, zip.mjs), tsc type check and node --test tests (tools/check.mjs, tsconfig.json, globals.d.ts, tests/), assets. Read before editing tools/ and tests/, before adding a script or an asset, on a tsc error and before building the archive.
---

# Dev server, build, code checks

```
node tools/check.mjs         # game and editor types + tests (check.bat — the same with a pause)
node tools/check.mjs --types
node tools/check.mjs --tests
run.bat                      # dev server + browser, port 8080 (or the next free one)
run.bat 9000 --no-open
build.bat                    # dist/arcengine-<GAME_VERSION>.zip
build.bat --version=0.2.0    # stamp the version into the build
build.bat --no-zip           # only the build/ folder
build.bat --keep-unused      # keep assets without references
build.bat --force            # build despite failed checks
node tools/make-character.mjs          # regenerate assets/models/character.glb (the sample character)
node tools/make-character.mjs --check  # exit 1 if the file differs from the generator
node tools/make-sounds.mjs             # regenerate assets/sounds/*.wav (the sample sounds, skill sound)
node tools/make-sounds.mjs --check     # exit 1 if a file differs from the generator
```

Git: what stays out of the repository — `.gitignore`; `.gitattributes` (`* -text`) — files go
byte for byte, no line-ending conversion.

## Dev server (`tools/dev-server.mjs`)

- `Cache-Control: no-store` on everything: there is no build step, otherwise the browser
  keeps running the old `.js` (`no-cache` will not do — it allows 304).
- On start — an asset check with the same scanner the builder uses; Range requests; MIME.

## Builder (`tools/build.mjs`)

`[1/4] checks -> [2/4] build/ -> [3/4] dist/*.zip -> [4/4] report`. Any failure stops the
build (`--force` — bypass).

| Check | Why |
|---|---|
| asset references resolve | 404 at runtime |
| `node --check` on every script | nothing else catches a syntax error |
| `index.html` exists, `js/Constants.js` is the first local script | entry point in the root; constant globals are read at load |
| no external scripts or URLs | zero dependencies: everything is in the archive |
| file names — ASCII without spaces | unpacking and URLs on the hosting |
| path case matches the disk (via `readdir`) | developed on Windows, served from Linux |
| no absolute paths `src="/…"` | the game may be served from a nested path |

Only the whitelist `CODE_FILES` (`tools/asset-scan.mjs`) goes into `build/`, plus the assets
that have LITERAL `'assets/…'` references in code. A path built from pieces
(`'assets/' + name`) is invisible to the scanner — add such files to `EXTRA_REFS`.
`?v=<version>` is appended to `<script src>` at build time; runtime cache busting of scripts
is impossible. `zip.mjs` writes a fixed mtime — the same tree gives the same bytes.

## Type check (`tsc`)

TypeScript 7 (`npx --yes -p typescript@7.0.2 tsc`, version — in `tools/check.mjs`) checks JS
via JSDoc and compiles nothing. Two programs — the game and the editor have different sets of globals:

| Config | Files |
|---|---|
| `tsconfig.json` | `js/*.js`, `globals.d.ts`, `libs/*.d.ts` |
| `_utils/editor/tsconfig.json` | `_utils/editor/*.js` + kit modules without `main.js` (the editor has its own) |

Mode: `strict` without `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables` — it
catches typos in fields and methods and Babylon calls that do not match the API, without
demanding JSDoc on every parameter. `libs/babylon.d.ts` — types for exactly Babylon 9.26:
upgrading `babylon.js` = a new file (`cdn.jsdelivr.net/npm/babylonjs@<version>/babylon.d.ts`).
`.mjs` (tools, editor server) is not checked by tsc — those have tests.

Pitfalls:
- An object literal in JS is "open": `const X = { … }` accepts any `X.typo`. Above every
  namespace — `/** @satisfies {Record<string, any>} */`. It also forbids adding fields from
  outside (`X.newField = …` is an error): declare the field in the literal
  (`World3D.toon: null` + `World3D.toon = ArcToon`). Inside methods `this` stays loose.
- A literal field set to `null` without JSDoc is `any`: nothing that goes through it is
  checked. Needs `/** @type {Location3D | null} */`.
- `querySelector`/`getElementById` return `Element`/`HTMLElement`: `.value`, `.checked`,
  `.disabled`, `.dataset` — through a cast `/** @type {HTMLInputElement} */ (el)`.
- A global named like a built-in browser class (`History`, `Image`, `Location`…) — error
  "Cannot redeclare": hence `EditHistory`.
- `window.NAME` of a constant in the editor — `/** @type {any} */ (window).NAME`: the `Window`
  type has no constants.

## Tests (`tests/*.test.mjs`, `node --test`)

Logic without 3D: `store` (Store with storage open and blocked), `terrain` (`heightAt` — nodes,
cell diagonal same as the mesh, continuity, edge, seed, mobile cell), `camera` (`CameraController`
on a stub view: flight along the view, Q/E, look-around keeps the camera in place, ground floor,
`CAMERA_LIMITS` on and off, what goes to the shadow frustum — the flight speed is read from
`Constants.js`, not written as a number: the user tunes it), `shadow`
(`View3D.fitShadowFrustum` on a fake view: the box takes the caster nearest the camera — next to a
building, zoomed out, nothing behind the camera, empty scene — and still hugs the bounds), `asset-scan`
(`collectRefs`, the project has no missing assets), `editor-save` (`_utils/editor/save.mjs`:
number patching, BOM, backups, every number of `Constants.js` is rewritten losslessly,
`Objects.js` is readable by the game and the scanner, `.glb` and `clip`, invalid records are rejected),
`ui` (anchor math of `js/UI.js` including a stretched axis, `UI_FIELDS` of `save.mjs` =
`UI.DEFAULTS`, `formatUI`, nesting — `parent` written, self-parent, a missing parent and a cycle
rejected, `UI.parentOf`/`isInside`, the kit's `UILayout.js` round-trips through the editor format),
`sound` (`Sound3D.spatial` — the audible sphere and the pan by the camera heading;
`Location3D.updateSound` — no copies piling up frame after frame, restart only on a file or mode
change, a hidden object silent; `removeObject` stops the sound; `findByTag`), `gltf` (`character.glb` on disk equals the
generator — after editing `tools/make-character.mjs` run it; the file's skeleton and seamless
clips; `Clips3D` cross-fade on fake animation groups), `instances` (`Instances3D.fill` — the
matrix of a copy as Babylon applies it: position, heading, scale; `Debug3D.copyGroups`), `debug3d`
(the pure parts of `js/Debug3D.js`: winding against normals, the side verdict with a mirrored
matrix, the normal map verdict by file name, the held view pose kept above the ground), `claude`
(skills in `claude/skills/` are linked to the CLAUDE.md table, `claude/launch.json` starts the
servers, there is no `.claude/skills/` folder — GitHub web upload skips dot-prefixed names, so
skills from there would never reach users).

`browser-scripts.mjs`: `loadScripts(files, globals)` runs classic scripts in one `node:vm`
context (like `<script>`), `get('Name')` fetches a top-level `const`/`class`; `stub()` — a
stub for `BABYLON`/`World3D` when a constructor builds meshes along the way. Objects from the
context belong to another realm: copy them for `assert.deepEqual` (`{ ...obj }`, `JSON`).
Files go into temp folders, `after()` removes them.

## Checklist

1. New script — file in `js/`, `<script>` in `index.html` (and in the editor's `index.html` if the
   editor needs it) and a line in `CODE_FILES`; new asset — a literal `'assets/…'` in code.
2. `node tools/check.mjs` passes; new non-3D logic — a test next to similar ones.
3. `build.bat` passes without `--force`.
4. The game starts on the dev server — console without errors.
