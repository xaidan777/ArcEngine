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

Скиллы лежат в `.claude/skills/` и подгружаются по требованию (инструмент Skill).

| Задача | Скилл |
|---|---|
| `World3D.js`, `Terrain3D.js`, `Location3D.js`, `CameraControl.js`, `Model3D.js`, `Objects.js`, `main.js`, объекты в сцене, свет/тени/toon/контур, константы `CAMERA_*`/`WORLD3D_*`/`TERRAIN_*`/`LOCATION_*` | `world3d` |
| `_utils/editor`, инспектор, вкладка Objects, новая константа в редакторе | `editor` |
| `tools/`, ассеты, архив | `build` |

## Запуск и сборка

```
run.bat                  # игра: dev-сервер + браузер, порт 8080 (или следующий свободный)
_utils/editor.bat        # редактор: http://localhost:8090/_utils/editor/
build.bat                # dist/arcengine-<GAME_VERSION>.zip
```

Нужен только Node. Серверы отдают всё с `no-store` — правку `.js` видно по F5.
`python -m http.server` не использовать: браузер закэширует старый скрипт.
В `.claude/launch.json` — конфигурации `game` (9378) и `editor` (9377) для панели браузера.

## Инварианты

1. **Ноль зависимостей.** Ни npm, ни CDN, ни сборки, ни внешних ресурсов.
2. **Порядок скриптов значим.** `Constants.js` — первый, `main.js` — последний. Новый
   `<script>` = строка в `CODE_FILES` (`tools/asset-scan.mjs`), иначе не попадёт в архив.
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

## Карта файлов

```
index.html        холст #world3d, экран загрузки, порядок скриптов
Constants.js      Store, IS_MOBILE, LOCATION_*, TERRAIN_*, CAMERA_*, WORLD3D_* (грузится первым)
Objects.js        LOCATION_OBJECTS — объекты локации (модель, вид, x/y/h, rot [x,y,z], scale [x,y,z],
                  anim — вращение части); пишет редактор
World3D.js        движок: init/renderFrame, View3D (камера, свет, тени, проекции), cfg(),
                  toon-шейдер ArcToonPlugin, контур рёбер, обводка силуэта, addObject
Terrain3D.js      земля: поле высот из шума, сетка + кольцо за краем, heightAt/tiltAt
Model3D.js        модели: бинарный FBX -> меши Babylon (load с кэшем, build, dispose); 1 см = 1 px
Location3D.js     локация: View3D + Terrain3D + текстура земли (LOCATION_GROUND) + объекты (addObject/placeObject,
                  update(dt) — вращение частей по anim)
CameraControl.js  CameraController: цель/азимут/наклон/зум, мышь, клавиши, тач; игровой и свободный режимы
main.js           вход: World3D.init -> Location3D(LOCATION_OBJECTS) -> камера -> цикл кадров; window.app
libs/             babylon.js (9.26 UMD), simplex-noise.js
assets/           ground_texture_{g,d,s}.jpg — трава, песок, снег; models/*.fbx — модели объектов
tools/            dev-server.mjs, build.mjs, asset-scan.mjs, zip.mjs
_utils/editor/    редактор (в билд не едет): server.mjs, index.html, i18n.js (EN/RU), schema.js,
                  inspector.js (Global Settings), objects-panel.js (Objects: список, свойства, гизмо,
                  импорт), history.js (Ctrl+Z / Ctrl+Shift+Z), loader.js, lab.js (вид), main.js
```

## Как начать игру на наборе

1. Логику и объекты — в новом файле (например `Game.js`) между `Location3D.js` и
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
(одна локация), сохранений прогресса, тестов. Git-репозитория нет.
