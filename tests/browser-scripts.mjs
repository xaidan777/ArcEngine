// The game's classic scripts in node:vm — one context per set of files, like <script> on a
// page: top-level const/class are visible to the following files and are fetched via get().
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

// Desktop browser without touch: that is enough for Constants.js (IS_MOBILE).
const DESKTOP = { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 };

// files — paths from the project root; globals — fields of the global object (navigator,
// localStorage, BABYLON…). window — the global object itself.
export function loadScripts(files, globals = {}) {
  const ctx = vm.createContext({ console, navigator: DESKTOP, innerWidth: 1920, innerHeight: 1080 });
  ctx.window = ctx;
  for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(globals))) {
    Object.defineProperty(ctx, key, desc);
  }
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return { ctx, get: (name) => vm.runInContext(name, ctx) };
}

// Babylon/World3D stub: any field, call and new return the stub itself. For logic that
// does not need 3D, but whose constructor creates meshes and materials along the way.
export function stub() {
  const target = function () {};
  const proxy = new Proxy(target, {
    get: (t, key) => (key === 'then' || typeof key === 'symbol' ? undefined : proxy),
    set: () => true,
    apply: () => proxy,
    construct: () => proxy,
  });
  return proxy;
}
