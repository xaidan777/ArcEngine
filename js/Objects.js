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
//   hidden: true — placed but out of the scene until the game calls location.setHidden(rec, false).
const LOCATION_OBJECTS = [
    { name: 'character', model: 'assets/models/character.glb', kind: 'actor', x: 1029.4, y: 1010, h: 0, rot: [0, 60, 0], scale: [0.25, 0.25, 0.25], clip: 'idle' },
    { name: 'barrier-1', model: 'assets/models/polyhaven/concrete_road_barrier.glb', kind: 'prop', x: 125, y: 1385.2, h: 0, rot: [0, 18.7, 0], scale: [0.52, 0.52, 0.52] },
    { name: 'barrier-2', model: 'assets/models/polyhaven/concrete_road_barrier.glb', kind: 'prop', x: 125, y: 1240, h: 0, rot: [0, -2.4, 0], scale: [0.52, 0.52, 0.52] },
    { name: 'barrier-3', model: 'assets/models/polyhaven/concrete_road_barrier.glb', kind: 'prop', x: 407.3, y: 1530, h: 0, rot: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
    { name: 'barrier-4', model: 'assets/models/polyhaven/concrete_road_barrier.glb', kind: 'prop', x: 450, y: 1230, h: 0, rot: [0, 12.9, 0], scale: [0.5, 0.5, 0.5] },
    { name: 'barrel-1', model: 'assets/models/polyhaven/barrel_03.glb', kind: 'prop', x: 450, y: 1550.4, h: 0, rot: [0, 0, 0], scale: [0.65, 0.65, 0.65] },
    { name: 'barrel-2', model: 'assets/models/polyhaven/barrel_03.glb', kind: 'prop', x: 440.4, y: 1506.4, h: 0, rot: [0, -45, 0], scale: [0.7, 0.7, 0.7] },
    { name: 'barrel-3', model: 'assets/models/polyhaven/barrel_03.glb', kind: 'prop', x: 480.3, y: 1513.4, h: 0, rot: [0, 20, 0], scale: [0.65, 0.65, 0.65] },
    { name: 'barrel-4', model: 'assets/models/polyhaven/barrel_03.glb', kind: 'prop', x: 1080, y: 1200, h: 0, rot: [0, 0, 0], scale: [0.7, 0.7, 0.7] },
    { name: 'barrel-5', model: 'assets/models/polyhaven/barrel_03.glb', kind: 'prop', x: 1118, y: 1210, h: -14.2, rot: [0, -40, 0], scale: [0.65, 0.65, 0.65] },
    { name: 'barrel-6', model: 'assets/models/polyhaven/barrel_03.glb', kind: 'prop', x: 1580, y: 730, h: 0, rot: [0, -15, 0], scale: [0.6, 0.6, 0.6] },
    { name: 'barrier', model: 'assets/models/polyhaven/concrete_road_barrier.glb', kind: 'prop', x: 135.3, y: 1527.8, h: 0, rot: [0, -17.5, 0], scale: [0.52, 0.52, 0.52] },
    { name: 'tripo_pbr_model_28de8de4-6660-4fca-a713-f6002ffaf55d_meshopt', model: 'assets/models/tripo_pbr_model_28de8de4-6660-4fca-a713-f6002ffaf55d_meshopt.glb', kind: 'prop', x: -277.6, y: 942.4, h: 392.2, rot: [0, -88, 0], scale: [7.804, 7.804, 7.804] },
];
