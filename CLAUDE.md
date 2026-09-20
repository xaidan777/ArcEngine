# ArcEngine — набор для 3D-игр в браузере

Основа для 3D-игр в браузере, заточенная под работу с Claude Code: ванильный
JS + Babylon.js 9.26 (`libs/babylon.js`, локально), ноль npm-зависимостей, никакой
сборки — классические `<script>` и глобалы. Игра при запуске показывает локацию:
земля с холмами, небо, свет, тени, toon-шейдер, камера, объекты из `Objects.js` (модели FBX и
GLB из `assets/models/`; GLB — со скелетом и клипами анимации), HUD из `UILayout.js` и пример
игры `Game.js`. Рядом — веб-редактор (интерфейс EN/RU): тот же мир, камеры
«свободная/игровая» с ползунком скорости полёта, toon вкл/выкл, вкладка Global Settings (все глобальные настройки,
сохранение в `Constants.js`), вкладка Sound (константы звука и файлы `assets/sounds`), вкладка
Objects (импорт FBX/GLB, гизмо, свойства объектов, анимация — вращение части или клип, тег,
скрытие, звук; сохранение в `Objects.js`) и вкладка UI (раскладка игрового интерфейса: драг и
ресайз поверх вида, вложенность и растяжение, сохранение в `UILayout.js`).

## Скиллы — читать до правки кода

Скилл `имя` — файл `claude/skills/имя/SKILL.md`: до правки кода из таблицы прочитать его
целиком (Read). В инструменте Skill их нет — так задумано (инвариант 9).

| Задача | Скилл |
|---|---|
| `js/` (`World3D.js`, `Terrain3D.js`, `Location3D.js`, `CameraControl.js`, `Model3D.js`, `Gltf3D.js`, `Instances3D.js`, `Objects.js`, `Game.js`, `main.js`), объекты в сцене, теги и скрытые объекты, много копий одной модели, модели GLB и клипы анимации, свет/тени/toon/контур, константы `CAMERA_*`/`WORLD3D_*`/`TERRAIN_*`/`LOCATION_*` | `claude/skills/world3d/SKILL.md` |
| ЛЮБОЙ элемент интерфейса игры (текст, счётчик, шкала, кнопка, панель, меню, диалог, экран паузы): `js/UI.js`, `js/UILayout.js`, вложенность и растяжение, вкладка UI редактора (`ui-panel.js`), новый вид элемента | `claude/skills/ui/SKILL.md` |
| ЛЮБОЙ звук: эффект, музыка, звук объекта локации, `js/Sound3D.js`, поле `sound` в `Objects.js`, константы `AUDIO_*`, файлы в `assets/sounds` | `claude/skills/sound/SKILL.md` |
| `_utils/`, редактор, инспектор, вкладки Objects и Sound, новая константа или вкладка в редакторе, текст интерфейса | `claude/skills/editor/SKILL.md` |
| `tools/`, `tests/`, ассеты, новый скрипт, архив, проверка типов и ошибки tsc | `claude/skills/build/SKILL.md` |
| своя геометрия (сетка из вершин, порт генератора, импорт glTF), материал с картой нормалей, новый источник света, свой шейдер, thin instances и процедурная расстановка; «сетка вывернута», «свет не с той стороны», пропал свет или меш | `claude/skills/render-conventions/SKILL.md` |
| проверка правки глазами и числами: панель браузера, `Debug3D` (удержание вида, кадры без rAF, замер, линтер сцены, отладочные режимы), замер цены кадра, воспроизведение состояния пользователя | `claude/skills/verify/SKILL.md` |

## Запуск и сборка

```
run.bat                  # игра: dev-сервер + браузер, порт 8080 (или следующий свободный)
editor.bat               # редактор: http://localhost:8090/_utils/editor/
build.bat                # dist/arcengine-<GAME_VERSION>.zip
check.bat                # типы (tsc по JSDoc) + тесты; агенту — node tools/check.mjs [--types|--tests]
```

Git: что не едет в репозиторий — `.gitignore` (`.claude/`, бэкапы редактора, `build/`, `dist/`);
`.gitattributes` — файлы едут байт в байт.

После правки кода — `node tools/check.mjs`: должно пройти. После правки геометрии, материалов,
света или шейдеров — ещё `await Debug3D.lint()` в игре (в редакторе — кнопка «Lint scene»): без ошибок.

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
   материала, тень, контур и обводка. Больше пары сотен копий одной модели (лес, одинаковые
   пропсы, пули) — `World3D.addInstances(view, mesh, kind, items)`: один draw call вместо
   10–15 мкс CPU на каждый отдельный меш. Проекции экран↔мир — только через `View3D`.
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
10. **Скиллы и комментарии в коде — на английском.** Кириллица в скилле — провал теста; в коде
   русский остаётся только в строках (словарь `ru` редактора, вывод инструментов, имена тестов).
11. **Любой элемент интерфейса — запись в `UILayout.js`, через вкладку UI редактора.** Код игры
   не создаёт, не позиционирует и не красит HUD сам: берёт элемент по id — `UI.get('score').setText(…)`,
   `setValue`, `show`, `onClick`. Элемент, созданный в коде, редактору не виден — его не подвинуть.

## Карта файлов

```
index.html        холст #world3d, экран загрузки, порядок скриптов (js/…)
js/               код игры — классические скрипты:
  Constants.js    Store, IS_MOBILE, LOCATION_*, TERRAIN_*, CAMERA_*, WORLD3D_* (грузится первым)
  Objects.js      LOCATION_OBJECTS — объекты локации (модель .fbx/.glb, вид, x/y/h, rot [x,y,z], scale [x,y,z],
                  anim — вращение части, clip — клип GLB, tag — имя группы, hidden — скрыт до показа,
                  sound — звук на месте объекта); пишет редактор
  UILayout.js     UI_LAYOUT — раскладка интерфейса игры (id, вид, якорь, x/y, размеры, цвета,
                  parent — внутри какого элемента, stretch — растянуть по оси); пишет редактор
  Sound3D.js      звук: эффекты, музыка, звук на карте (слышно оттуда, где камера; область слышимости —
                  шар falloffMin/falloffMax), каналы и громкости AUDIO_*
  World3D.js      движок: init/renderFrame, View3D (камера, свет, тени, проекции), cfg(),
                  toon-шейдер ArcToonPlugin, контур рёбер (у всех объектов, у скелетных — по костям,
                  InkSkin), обводка силуэта, addObject
  Terrain3D.js    земля: поле высот из шума, сетка + кольцо за краем, heightAt/tiltAt
  Model3D.js      модели: бинарный FBX -> меши Babylon (load с кэшем, build, dispose); 1 см = 1 px; .glb уходит в Gltf3D
  Gltf3D.js       модели glTF/GLB: скелет, текстуры, PBR -> StandardMaterial под toon; Clips3D — клипы анимации
                  (Model3D.clips(root).play('run') с плавным переходом)
  Instances3D.js  много копий одной модели одним draw call (thin instances): World3D.addInstances ->
                  set/setAll/flush/dispose; тени, toon, контур и обводка — как у addObject
  Location3D.js   локация: View3D + Terrain3D + текстура земли (LOCATION_GROUND) + объекты (addObject/placeObject,
                  findByTag/setHidden, update(dt) — вращение частей по anim, клип по clip, звук по sound)
  CameraControl.js CameraController: цель/азимут/наклон/зум, мышь, клавиши, тач; игровой и свободный режимы
  Debug3D.js      инструменты разработки (в кадре не работают, пока не позвали): lint() — сетки изнанкой, сотни одинаковых отдельных мешей,
                  конвенция карт нормалей, лимит света и солнце последним, лимиты шейдеров WebGL2, пустой кадр;
                  hold(pose)/release() — вид мимо контроллера камеры, frames(n), bench()/benchToggle(), setMode()
  UI.js           интерфейс игры: DOM поверх холста по UI_LAYOUT; UI.get(id).setText/setValue/show/onClick,
                  якоря 9 точек, масштаб по UI_REF_HEIGHT
  Game.js         пример игры: место игровой логики (кнопка Run — клипы idle/run персонажа, шкала
                  энергии, шаги; персонаж берётся по тегу, не по имени)
  main.js         вход: World3D.init -> Location3D(LOCATION_OBJECTS) -> камера -> UI -> Game -> цикл кадров; window.app
libs/             babylon.js (9.26 UMD), babylonjs.loaders.min.js (glTF-загрузчик той же версии), simplex-noise.js;
                  *.d.ts — их типы для tsc
assets/           ground_texture_{g,d,s}.jpg — трава, песок, снег; models/*.fbx, *.glb — модели объектов
                  (character.glb — персонаж с клипами idle/run, генерируется tools/make-character.mjs);
                  sounds/*.wav, *.mp3 — звуки (step.wav генерируется tools/make-sounds.mjs)
tools/            dev-server.mjs, build.mjs, asset-scan.mjs, zip.mjs, check.mjs (типы + тесты),
                  make-character.mjs, make-sounds.mjs
tsconfig.json     проверка типов игры; globals.d.ts — window.app, material.arcToon, записи объектов
tests/            *.test.mjs (node --test): Store, heightAt, сканер ассетов, запись редактора, звук,
                  связка скиллов; browser-scripts.mjs — скрипты игры в node:vm + пустышка Babylon
_utils/editor/    редактор (в билд не едет): server.mjs (HTTP), save.mjs (запись Constants.js,
                  Objects.js и UILayout.js), index.html, i18n.js (EN/RU), schema.js, inspector.js (Global Settings),
                  objects-panel.js (Objects: список, свойства, гизмо, импорт, тег, скрытие, звук),
                  sound-panel.js (Sound: константы звука и файлы assets/sounds),
                  ui-panel.js (UI: элементы интерфейса, драг и ресайз поверх вида, вложенность), history.js (EditHistory:
                  Ctrl+Z / Ctrl+Shift+Z), loader.js, lab.js (вид), debug-tools.js (режим вида и «Lint scene»
                  на панели вида — Debug3D), onboarding.js (тур из 6 слайдов по редактору: первый
                  запуск и кнопка «?»), main.js; tsconfig.json — его типы
claude/           для Claude Code, едет пользователям (в билд игры — нет): skills/<имя>/SKILL.md — скиллы,
                  launch.json — шаблон .claude/launch.json для панели браузера
```

## Как начать игру на наборе

1. Логика — в `js/Game.js` (пример в наборе: `constructor(app)` и `update(dt)`, зовётся из цикла
   `main.js` до рендера); большая игра — новые файлы: `<script>` до `main.js` + строка в `CODE_FILES`.
2. Статичные объекты локации — вкладка Objects редактора (`Objects.js`), в коде —
   `app.location.objects` (`{ def, mesh }`). Свои объекты: `BABYLON.MeshBuilder`/меши или
   `Model3D.load` + `Model3D.build` в `app.location.view.scene` -> `World3D.addObject` ->
   позиция на `app.location.terrain.heightAt(x, y)`.
3. Персонаж с анимацией — модель `.glb`: `Model3D.clips(mesh).play('run')`, переход между клипами —
   сам (скилл `world3d`). Камера за героем — `app.camera.follow(obj)` (объект с полями `x`, `y`).
4. Интерфейс — записи в `UILayout.js` (вкладка UI редактора) + `UI.get(id)` в коде (скилл `ui`,
   инвариант 11); меню и диалог — панель и элементы с `parent`, показываются одним `show()`.
   Новые числа — в `Constants.js` и `_utils/editor/schema.js`.
5. Что расставил пользователь, код берёт по тегу: `app.location.findByTag('coin')` (скилл
   `world3d`). Звук события — `Sound3D.play('assets/sounds/…')`, звук объекта — поле `sound`
   его записи (скилл `sound`).

## Чего в наборе нет

Физики и коллизий, готовых игрока и противника (`Game.js` — только образец места для
логики), текстур и скелета у FBX (`Model3D` — геометрия и цвета материалов бинарного FBX, центр
и оси частей; скелет, клипы и текстуры — только в GLB), картинок и привязки к точке мира в UI
(виды элементов — текст, панель, шкала, кнопка), нескольких сцен/уровней
(одна локация), сохранений прогресса, тестов рендера и ввода (тесты — только логика без 3D).
У звука (`Sound3D.js`) нет преград, эха и доплера: громкость — по расстоянию от камеры (область
слышимости — шар), панорама — по стороне экрана.
