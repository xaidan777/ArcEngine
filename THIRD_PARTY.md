# Third-party components

ArcEngine's own code is released under the MIT License (see `LICENSE`).
The kit also bundles the following third-party files, which keep their own licenses.

| Component | Files | Version | License | Source |
|---|---|---|---|---|
| Babylon.js | `libs/babylon.js`, `libs/babylon.d.ts` | 9.26.0 | Apache-2.0 — full text in `libs/babylon.LICENSE.txt` | https://github.com/BabylonJS/Babylon.js |
| simplex-noise | `libs/simplex-noise.js` | — | MIT, Copyright (c) 2018 Jonas Wagner (header in the file) | https://github.com/jwagner/simplex-noise.js |

`libs/babylon.LICENSE.txt` is listed in `CODE_FILES`, so every game build
(`build.bat` / `tools/build.mjs`) ships it next to `babylon.js`, as Apache-2.0 requires.

## Assets

| Files | Author / source | License |
|---|---|---|
| `assets/models/mill.fbx` | _to be filled in by the author_ | _to be filled in_ |
| `assets/models/Bush_3.fbx` | _to be filled in by the author_ | _to be filled in_ |
| `assets/ground_texture_{g,d,s}.jpg` | _to be filled in by the author_ | _to be filled in_ |

Assets made by the ArcEngine author fall under the MIT License above.
Assets taken from a store or pack stay under that pack's license, which may not allow
redistribution in a public repository.
