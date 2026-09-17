# ArcEngine — набор для 3D-игр в браузере

Основа для 3D-игр в браузере, заточенная под работу с Claude Code: ванильный
JS + Babylon.js 9.26 (`libs/babylon.js`, локально), ноль npm-зависимостей, никакой
сборки — классические `<script>` и глобалы. Игра при запуске показывает локацию:
земля с холмами, небо, свет, тени, toon-шейдер, камера и объекты из `Objects.js`
(модели FBX из `assets/models/`). Рядом — веб-редактор (интерфейс EN/RU): тот же мир,
камеры «свободная/игровая», toon вкл/выкл, вкладка Global Settings (все глобальные
настройки, сохранение в `Constants.js`) и вкладка Objects (импорт FBX, гизмо, свойства
объектов, анимация — вращение части модели, сохранение в `Objects.js`).

## Скиллы — читать до правки кода

Скилл `имя` — файл `claude/skills/имя/SKILL.md`: до правки кода из таблицы прочитать его
целиком (Read). В инструменте Skill их нет — так задумано (инвариант 9).

| Задача | Скилл |
|---|---|
| `js/` (`World3D.js`, `Terrain3D.js`, `Location3D.js`, `CameraControl.js`, `Model3D.js`, `Objects.js`, `main.js`), объекты в сцене, свет/тени/toon/контур, константы `CAMERA_*`/`WORLD3D_*`/`TERRAIN_*`/`LOCATION_*` | `claude/skills/world3d/SKILL.md` |
| `_utils/`, редактор, инспектор, вкладка Objects, новая константа в редакторе, текст интерфейса | `claude/skills/editor/SKILL.md` |
| `tools/`, `tests/`, ассеты, новый скрипт, архив, проверка типов и ошибки tsc | `claude/skills/build/SKILL.md` |

## Запуск и сборка

```
run.bat                  # игра: dev-сервер + браузер, порт 8080 (или следующий свободный)
editor.bat               # редактор: http://localhost:8090/_utils/editor/
build.bat                # dist/arcengine-<GAME_VERSION>.zip
check.bat                # типы (tsc по JSDoc) + тесты; агенту — node tools/check.mjs [--types|--tests]
```

Git: что не едет в репозиторий — `.gitignore` (`.claude/`, бэкапы редактора, `build/`, `dist/`);
`.gitattributes` — файлы едут байт в байт.

После правки кода — `node tools/check.mjs`: должно пройти.

Нужен только Node. Серверы отдают всё с `no-store` — правку `.js` видно по F5.
`python -m http.server` не использовать: браузер закэширует старый скрипт.
Панель браузера Claude Desktop читает `.claude/launch.json` (`game` — 9378, `editor` — 9377);
если его нет — скопировать `claude/launch.json`.

## Инварианты

1. **Ноль зависимостей.** Ни npm, ни CDN, ни сборки, ни внешних ресурсов. TypeScript для
   проверки берёт `npx` (кэш npm), в проект он не ставится.
2. **Порядок скриптов значим.** `Constants.js` — первый, `main.js` — последний. Новый скрипт —
   файл в `js/`, `<script src="js/…">` в `index.html` и строка в `CODE_FILES`
   (`tools/asset-scan.mjs`), иначе не попадёт в архив.
3. **Все числа — в `Constants.js`, литералами.** Редактор патчит только
   `const ИМЯ = <число>;`. Код читает константу через `typeof ИМЯ !== 'undefined'` с
   дефолтом: в игре это лексический `const`, в редакторе — свойство `window`.
4. **3D — представление.** Логика игры хранит своё состояние сама и не спрашивает у
   Babylon высоты или пересечения для решений, которые должны совпадать на всех
   устройствах (клетка террейна на мобильных крупнее).
5. **Объекты мира — через `World3D.addObject(view, mesh, 'actor' | 'prop')`**: группа
   материала, тень, контур и обводка. Проекции экран↔мир — только через `View3D`.
6. **Отсутствующий ассет не роняет сцену** (`Location3D.loadGround`: `onerror` -> ровный цвет).
   Пути ассетов — литералами `'assets/…'`: иначе сканер сборщика их не увидит.
7. **Хранилище — только `Store`** (`Constants.js`): в sandbox-iframe прямой
   `localStorage` бросает `SecurityError`.
8. **Код проходит проверку типов.** JS проверяется по JSDoc (`strict` без `noImplicitAny`
   и `strictNullChecks`). Объект-неймспейс `const X = { … }` — со строкой
   `/** @satisfies {Record<string, any>} */` над ним: без неё tsc не видит опечаток в `X.метод`.
   Поле, заданное `null`, — `/** @type {Тип | null} */`; DOM — приведение
   `/** @type {HTMLInputElement} */ (el)`; поля на чужих объектах и общие записи — в `globals.d.ts`.
9. **Всё, что нужно пользователю набора, — в путях без точки.** Веб-загрузка на GitHub
   пропускает `.claude/`, `.github/`, `.gitignore` — любое имя с точкой в начале. Скиллы —
   `claude/skills/<имя>/SKILL.md` (новый — ещё строка в таблице скиллов), шаблон панели
   браузера — `claude/launch.json`. В `.claude/` — только локальное (`settings.local.json`,
   копия `launch.json`); папку `.claude/skills/` тесты не пропустят.

## Карта файлов

```
index.html        холст #world3d, экран загрузки, порядок скриптов (js/…)
js/               код игры — классические скрипты:
  Constants.js    Store, IS_MOBILE, LOCATION_*, TERRAIN_*, CAMERA_*, WORLD3D_* (грузится первым)
  Objects.js      LOCATION_OBJECTS — объекты локации (модель, вид, x/y/h, rot [x,y,z], scale [x,y,z],
                  anim — вращение части); пишет редактор
  World3D.js      движок: init/renderFrame, View3D (камера, свет, тени, проекции), cfg(),
                  toon-шейдер ArcToonPlugin, контур рёбер, обводка силуэта, addObject
  Terrain3D.js    земля: поле высот из шума, сетка + кольцо за краем, heightAt/tiltAt
  Model3D.js      модели: бинарный FBX -> меши Babylon (load с кэшем, build, dispose); 1 см = 1 px
  Location3D.js   локация: View3D + Terrain3D + текстура земли (LOCATION_GROUND) + объекты (addObject/placeObject,
                  update(dt) — вращение частей по anim)
  CameraControl.js CameraController: цель/азимут/наклон/зум, мышь, клавиши, тач; игровой и свободный режимы
  main.js         вход: World3D.init -> Location3D(LOCATION_OBJECTS) -> камера -> цикл кадров; window.app
libs/             babylon.js (9.26 UMD), simplex-noise.js; *.d.ts — их типы для tsc
assets/           ground_texture_{g,d,s}.jpg — трава, песок, снег; models/*.fbx — модели объектов
tools/            dev-server.mjs, build.mjs, asset-scan.mjs, zip.mjs, check.mjs (типы + тесты)
tsconfig.json     проверка типов игры; globals.d.ts — window.app, material.arcToon, записи объектов
tests/            *.test.mjs (node --test): Store, heightAt, сканер ассетов, запись редактора, связка
                  скиллов; browser-scripts.mjs — скрипты игры в node:vm + пустышка Babylon
_utils/editor/    редактор (в билд не едет): server.mjs (HTTP), save.mjs (запись Constants.js и
                  Objects.js), index.html, i18n.js (EN/RU), schema.js, inspector.js (Global Settings),
                  objects-panel.js (Objects: список, свойства, гизмо, импорт), history.js (EditHistory:
                  Ctrl+Z / Ctrl+Shift+Z), loader.js, lab.js (вид), main.js; tsconfig.json — его типы
claude/           для Claude Code, едет пользователям (в билд игры — нет): skills/<имя>/SKILL.md — скиллы,
                  launch.json — шаблон .claude/launch.json для панели браузера
```

## Как начать игру на наборе

1. Логику и объекты — в новом файле (например `js/Game.js`), `<script>` между `Location3D.js` и
   `main.js` + строка в `CODE_FILES`. В `main.js` после создания камеры — `new Game(window.app)`.
2. Статичные объекты локации — вкладка Objects редактора (`Objects.js`), в коде —
   `app.location.objects` (`{ def, mesh }`). Свои объекты: `BABYLON.MeshBuilder`/меши или
   `Model3D.load` + `Model3D.build` в `app.location.view.scene` -> `World3D.addObject` ->
   позиция на `app.location.terrain.heightAt(x, y)`.
3. Кадр логики — в цикле `main.js` до `World3D.renderFrame()`; камера за героем —
   `app.camera.follow(obj)` (объект с полями `x`, `y`).
4. HUD — DOM поверх `#world3d`. Новые числа — в `Constants.js` и `_utils/editor/schema.js`.

## Чего в наборе нет

Звука, UI-фреймворка, физики, текстур и анимации моделей, кроме вращения части (`anim` в
`Objects.js`; `Model3D` — геометрия и цвета материалов бинарного FBX, центр и оси частей;
glTF-лоадер Babylon не подключён), нескольких сцен/уровней
(одна локация), сохранений прогресса, тестов рендера и ввода (тесты — только логика без 3D).
