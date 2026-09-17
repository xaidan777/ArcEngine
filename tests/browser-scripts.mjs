// Классические скрипты игры в node:vm — один контекст на набор файлов, как <script> на
// странице: верхнеуровневые const/class видны следующим файлам и достаются через get().
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

// Настольный браузер без тача: этого хватает Constants.js (IS_MOBILE).
const DESKTOP = { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 };

// files — пути от корня проекта; globals — поля глобального объекта (navigator,
// localStorage, BABYLON…). window — сам глобальный объект.
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

// Пустышка Babylon/World3D: любое поле, вызов и new возвращают её же. Для логики,
// которой 3D не нужен, но конструктор по пути создаёт меши и материалы.
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
