# Mechanical bot rigs

The original Tripo meshes in `assets/models/{cricket,screamer,spotter}.glb` are untouched.
The game loads the new files from `assets/models/rigged/`.

## Editable sources

- `cricket_rig.blend`: four articulated legs; idle, walk, jump, land.
- `screamer_rig.blend`: four articulated supports, radar and siren; idle, walk, scream.
- `spotter_rig.blend`: sensor gimbal and tilting duct assemblies; idle, fly, alert.

Each Blender file contains an armature, a textured mesh and named Actions. Select the
armature and choose an Action in the Action Editor to preview or edit a clip. The muted
NLA tracks retain the actions; GLB export uses Actions mode, not a mixed NLA playback.
Textures are retained from the source models. Metal segments use one bone per vertex;
split joint boundaries have dark interior caps.
The missing far front support on the generated Screamer is reconstructed by mirroring
its intact counterpart, with rigid support links replacing ambiguous generated connections. Loose trailing wire fragments below its chassis were removed.

## Rebuild

From the project root with Blender on PATH:

```sh
blender --background --factory-startup --python tools/rig-bots.py
# Or rebuild a single bot:
blender --background --factory-startup --python tools/rig-bots.py -- cricket
node tools/check.mjs
```

The generator overwrites the three rigged GLBs and Blender sources, never the original
GLBs. Back up hand edits before regenerating. The script's landmarks and segmentation
rules apply specifically to these Tripo meshes; they are not a general automatic rigger.
The rig was built with Blender 5.2.2.

## Game integration

`js/BotRig3D.js` attaches independent clips to each bot, aligns ground models in the
actor's local coordinates, derives locomotion from travelled distance, samples the
jump by gameplay progress and handles landing/scream recovery. Dead and paused bots
stop advancing their animation. An asynchronously loaded dead bot is frozen on the
next visual update. The Game loader registers the imported meshes for actor shadows.

`MODEL_BOT_STRIDE` (at model scale 1) and `MODEL_BOT_MOVE_THRESHOLD` are available in editor settings. Stride automatically follows model scale.
The old whole-body walking wobble is disabled for rigged ground bots. All three source
models face local +X; the model wrapper rotation now preserves that heading.

This is a mechanical animation pass over generated geometry, not a complete manual
retopology. Feet use baked local trajectories; there is no per-foot terrain IK. Steep
slopes can still cause uneven contact, and close-up joint seams may warrant manual
mesh cleanup. Spotter's ducts tilt as assemblies; its fused fan/grille geometry has
not been rebuilt into independently spinning blades.

Validation includes GLB buffer/skin/clip checks, controller transition tests, rendered
Blender poses, Babylon playback and `Debug3D.lint`. `preview.png` shows the three rigs
in Babylon; it is a review scene, not a gameplay screenshot.
