// UILayout.js — the game's UI layout: every HUD element, placed and styled in the editor (UI tab).
// The editor rewrites the whole file (POST /api/save-ui) — keep the format. Drawn by js/UI.js;
// game code takes an element by id: UI.get('score').setText('10') — and never positions HUD itself.
//   kind — 'text' | 'panel' | 'bar' | 'button'; anchor — one of 9 screen points ('top-left' …
//   'bottom-right'): x, y go from it to the same point of the element (inward from an edge,
//   signed from the center); w, h — px; numbers are px of a screen UI_REF_HEIGHT tall;
//   colors — '#rrggbb', '' — none; visible: 0 — hidden until the game calls show().
//   Records go in drawing order: later — on top.
const UI_LAYOUT = [
    { id: 'title', kind: 'text', anchor: 'top-left', x: 6, y: 5, text: "ArcEngine", fontSize: 26, color: '#ffffff', shadow: '#0b1a24', alpha: 0.5, visible: 1 },
    { id: 'fps', kind: 'text', anchor: 'top-right', x: 20, y: 16, text: "60 fps", fontSize: 12, color: '#ffffff', shadow: '#0b1a24', alpha: 0.5, visible: 1 },
    { id: 'hintPanel', kind: 'panel', anchor: 'bottom-center', x: -10, y: 31, w: 420, h: 19, fill: '#10202c', border: '', radius: 18, alpha: 0.6, visible: 1 },
    { id: 'hint', kind: 'text', anchor: 'bottom-center', x: -14, y: 35, text: "WASD fly  ·  Q / E down / up  ·  RMB look  ·  wheel zoom  ·  R reset", fontSize: 10, color: '#ffffff', shadow: '', alpha: 0.5, visible: 1 },
];
