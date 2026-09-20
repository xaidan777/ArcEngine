// Objects.js — location objects: models placed in the editor (Objects tab).
// The editor rewrites the whole file (POST /api/save-objects) — keep the format.
// Model path — a string literal starting from assets/: the builder archives only assets referenced this way.
//   model — .fbx (Model3D.js) or .glb (Gltf3D.js: skeleton, clips, textures);
//   kind — 'prop' (environment) | 'actor' (main object of the frame);
//   x, y — map px; h — px above the ground; rot — [x, y, z] degrees: y — heading (0 — along +x,
//   90 — down the map), x and z — tilt; scale — [x, y, z] relative to model size (1 cm in the file = 1 px);
//   anim — spin of a model part (optional): part — an object inside the FBX (spins around
//   its origin from Blender), axis — its axis 'x' | 'y' | 'z' (with a minus — the opposite end),
//   speed — rpm, dir — 'cw' | 'ccw': clockwise/counterclockwise as seen from the end of the axis;
//   clip — looped animation clip of a .glb model (optional): 'idle', 'run'…
//   tag — a group name for game code (optional): location.findByTag(tag);
//   hidden: true — placed but not in the scene until the game calls location.setHidden(rec, false);
//   sound — a sound standing at the object (optional, Sound3D.js): src — a file from assets/sounds,
//   volume 0..1, loop: false — once instead of looped, falloffMin — px of full volume around the
//   object, falloffMax — px, silent from there on (0 or absent — the common AUDIO_FALLOFF_*).
const LOCATION_OBJECTS = [
    { name: 'mill', model: 'assets/models/mill.fbx', kind: 'prop', x: 1150.2, y: 894.4, h: 8.8, rot: [0, 34.4, 0], scale: [1.36, 1.36, 1.36], anim: { part: 'w1..003', axis: '-y', speed: 10, dir: 'ccw' }, sound: { src: 'assets/sounds/mill.mp3', volume: 0.25 } },
    { name: 'character', model: 'assets/models/character.glb', kind: 'actor', x: 1029.4, y: 1010, h: 0, rot: [0, 60, 0], scale: [0.25, 0.25, 0.25], clip: 'idle', tag: 'player', sound: { src: 'assets/sounds/farmer.mp3', falloffMax: 512 } },
];
