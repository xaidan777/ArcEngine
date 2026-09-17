---
name: editor
description: Веб-редактор набора (_utils/editor) — вид локации с камерами «свободная/игровая», переключатель toon, вкладка Global Settings (инспектор констант schema.js, сохранение в Constants.js), вкладка Objects (объекты локации Objects.js — импорт FBX в assets/models, свойства, гизмо), язык интерфейса EN/RU (i18n.js), live-правка через loader.js, API server.mjs. Читать перед правками файлов в _utils/, перед добавлением константы в инспектор и перед добавлением текста в интерфейс.
---

# Редактор (`_utils/editor`)

```
editor.bat                     # в корне набора: порт 8090 (или следующий свободный), откроет браузер
editor.bat 9100 --no-open
```

Адрес: `http://localhost:8090/_utils/editor/`. Нужен только Node. Редактор — не часть
игры: в билд не едет (`BUILD_EXCLUDE`), игра о нём не знает.

## Устройство

| Файл | Что |
|---|---|
| `server.mjs` | статика от КОРНЯ проекта (no-store) + `GET /api/status`, `POST /api/save-constants`, `/api/save-objects`, `/api/pick-model`, `/api/import-model`. `EDITOR_API_VERSION` |
| `save.mjs` | запись без HTTP: `patchScalar`, `saveConstants(root, changes)`, `formatObjects`, `saveObjects(root, objects)`, бэкапы, `ERRORS`/`failure`, `isModelPath`; покрыт `tests/editor-save.test.mjs` |
| `index.html` | шапка с переключателем языка `#lang-switch`, тулбар вида, канвас `#view-canvas`, правая панель с вкладками `#pane-tabs` (`.pane-panel[data-tab]`: settings, objects); порядок скриптов: `i18n.js`, `schema.js`, `loader.js`, модули набора (`/js/Objects.js`, `/js/World3D.js` … `/js/Model3D.js`, `/js/Location3D.js`), `inspector.js`, `objects-panel.js`, `lab.js`, `main.js` |
| `i18n.js` | `I18N`: язык (EN по умолчанию, выбор в `localStorage` `arcengine.editor.lang`), словари `STRINGS.en/ru`, `t(key, params)`, `pick({ en, ru })`, разметка по `data-i18n*`, событие `lang-changed` |
| `loader.js` | тянет `/js/Constants.js`, меняет `^const` на `var`, исполняет косвенным `eval` — константы становятся перезаписываемыми свойствами `window` |
| `schema.js` | `KIT_SCHEMA` — группы и поля инспектора, тексты `{ en, ru }`; `EDITOR_API_VERSION` клиента |
| `history.js` | `EditHistory`: отмена/повтор (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y) — записи `{ key, undo, redo }`, одинаковый `key` быстрее 800 мс склеивается, `batch(fn)` — один шаг; в текстовых и числовых полях Ctrl+Z — браузерный |
| `inspector.js` | вкладка Global Settings: поля из схемы, группы свёрнуты при запуске, dirty-подсветка, ↺, поиск на обоих языках, «Сохранить» (Ctrl+S); `Toast` |
| `objects-panel.js` | `ObjectsPanel` — вкладка Objects: список `location.objects`, свойства выбранного, гизмо перемещения, выбор кликом, импорт FBX, «Сохранить в Objects.js», откат; `PaneTabs` — вкладки (выбор в `localStorage` `arcengine.editor.tab`) |
| `lab.js` | вид локации: `Location3D` (объекты — копия `LOCATION_OBJECTS`) + `CameraController` игры, режимы камеры, toon-переключатель, реакция на правки; кадр `tick`: `location.update(dt)` -> `camera.update(dt)` -> `renderFrame()` |
| `main.js` | `I18N.init()` -> `EditorLoader.load()` -> `EditHistory.init()` -> `PaneTabs.init()` -> `Inspector.init()` -> обёртка `Inspector.apply` (событие `constants-changed` + запись в историю; `revertAll` — одним шагом) -> `Lab.init()` (внутри — `ObjectsPanel.init(lab)`) |

Правка поля: `Inspector.apply` пишет `window[NAME]` -> событие `constants-changed` ->
`Lab.onConstant(name)` по префиксу:

| Префикс / имя | Что происходит |
|---|---|
| `WORLD3D_*` | `World3D.applyRenderConstants(view)` — свет, тени, материалы, toon, контур живо |
| `CAMERA_*` | `camera.applyConstants()`; в игровом режиме ориентация/стартовый зум — сразу `home()` |
| `LOCATION_GROUND` | `location.loadGround()` |
| `GROUND_TILE_SIZE` | `terrain.applyTileSize()` |
| `TERRAIN_*`, `LOCATION_*` | пересборка рельефа не чаще кадра, объекты локации встают на новую землю (`buildTerrain`) |

`WORLD3D_SHADOW_MAP` и `WORLD3D_SHADOW_RADIUS` читаются при создании вида — действуют после F5.

## Сохранение

`POST /api/save-constants` с `{ changes: [{ name, value }] }`. Сервер патчит ТОЛЬКО
строки `const ИМЯ = <число>;` (формулу откажется трогать), hex-литерал остаётся hex,
перед записью — бэкап в `_utils/.backups/` (20 последних). Имя — `[A-Za-z_][A-Za-z0-9_]*`.
Отказ — `{ name, ok: false, code, error }`: `code` (`not_found`, `not_literal`,
`bad_value`, `bad_name`) клиент переводит ключом `err.<code>`, `error` — английский текст для лога.

`POST /api/save-objects` с `{ objects: [...] }` — `Objects.js` пишется ЦЕЛИКОМ (шапка
`OBJECTS_HEADER` + по строке на объект), бэкап `Objects-*.js` туда же. Запись:
`{ name, model, kind, x, y, h, rot: [x, y, z], scale: [x, y, z], anim? }` (старые числа `rot`/`scale`
разворачиваются в тройки; `anim: { part, axis, speed, dir }` пишется хвостом строки, если есть).
Проверки: `model` — `assets/….fbx` латиницей без пробелов и `..` (`bad_model`), числа
конечные, масштаб > 0, `anim.axis` из `x -x y -y z -z`, `anim.speed` ≥ 0 (`bad_value`); имя
объекта и `anim.part` без кавычек и управляющих символов (`cleanName`); точность: позиция,
углы и скорость 0.1, масштаб 0.001. Старый процесс сервера (API < 18) `anim` молча не пишет.

## Вкладка Objects

- Записи — `location.objects` (`{ def, mesh, error, loaded }`, `Location3D.addObject`):
  панель правит поля `def` и зовёт `location.placeObject(rec)`. Смена `kind` —
  пересборка объекта (группа материалов, контур и обводка раздаются при добавлении).
- Секция «Анимация» (`renderAnim`, `setAnim`): часть — `<select>` из `metadata.part` мешей
  модели (не догрузилась — в списке только сохранённая), «— нет —» удаляет `def.anim`. Выбор
  части ставит ось `guessAxis`: самая тонкая сторона части по её осям, конец — наружу от
  центра модели (у крыльев мельницы — `-y`, вид спереди); скорость по умолчанию 10 об/мин.
  `placeObject` не нужен — `Location3D.update` читает `def.anim` каждый кадр (`lab.js` зовёт
  его в `tick`, вращение видно в редакторе). Правки склеиваются по `field:<индекс>:anim`.
- «Грязная» раскладка — `JSON` записей ≠ `ObjectsPanel.saved`; «Откатить» пересобирает все объекты из `saved`.
- «Импорт FBX…» -> `POST /api/pick-model` `{ title }`: сервер открывает системный диалог в
  `assets/models/` (Windows: PowerShell `-STA` + WinForms `OpenFileDialog`, путь и заголовок
  через env, окно-владелец TopMost). Файл внутри `assets/` берётся на месте, снаружи —
  копируется в `assets/models/` (имя латиницей; тот же файл не дублируется, другой — суффикс
  `-2`). Проверка — расширение `.fbx` и заголовок бинарного FBX (`not_fbx`, `not_binary`).
  Отмена — `code: 'cancelled'`. Не Windows — `code: 'unsupported'`, клиент выбирает файл
  `<input type=file>` и шлёт байты `POST /api/import-model?name=<файл>`. Новый объект — в цели камеры.
- Гизмо — `BABYLON.GizmoManager` (слой утилит), режимы на тулбаре `#gizmo-modes` и
  клавишами 1/2/3: перемещение (оси + квадрат по земле), поворот (кольца X/Y/Z, мировые
  оси), масштаб (по осям, центр — равномерно). Материалы гизмо — unlit (`emissiveColor`):
  освещаемые квантует toon-плагин. Гизмо нужны события указателя СЦЕНЫ:
  `ObjectsPanel.init` делает `scene.attachControl()` (View3D их отключает). Нажатие на
  гизмо камера пропускает — `camera.ignorePointer = (e) => gizmoHit(e)`: `isHovered` плюс
  прямой пик слоя утилит (hover без движения мыши не обновляется). Сдвиг по X/Z держит `h`
  (объект идёт по рельефу), по Y — меняет `h`. Поворот гизмо пишет `rotation` меша
  (или `rotationQuaternion`, если он задан) — углы забираются в `rot`, `placeObject`
  после отпускания сбрасывает кватернион.
- История: шаг — снимки раскладки до/после (`snapshot`/`restore`); тот же набор моделей и
  видов правится на месте, иначе объекты пересобираются. Гизмо — шаг на перетаскивание,
  поле — склейка по `field:<индекс>:<поле>`.
- Клик ЛКМ без сдвига (≤ 4 px) по мешу объекта — выбор (`scene.pick` с фильтром по
  `metadata.locationObject` корня) и переход на вкладку Objects; по пустому месту — снять выбор.
- Клавиши (фокус не в поле): Del/Backspace — удалить, F — показать, Ctrl+D — дублировать,
  Esc — снять выбор, Ctrl+S — сохранить (и Constants.js, и Objects.js, что изменено).

## Язык интерфейса

- Статичный текст разметки — английский по умолчанию, с атрибутами `data-i18n`
  (текст), `data-i18n-title`, `data-i18n-placeholder`; ключи — в `I18N.STRINGS`.
- Текст из кода — `I18N.t('ключ', { имя: значение })`, подстановка `{имя}`.
- Новая строка = ключ в ОБОИХ словарях `en` и `ru`; нет перевода — показывается английский.
- Смена языка: `applyDom()`, затем событие `lang-changed` — инспектор перестраивается
  (раскрытые группы и поиск сохраняются), `lab.js` перерисовывает подсказку и чип.
- Код, комментарии, лог сервера и `Constants.js` не переводятся.

## Новая константа в инспекторе

1. Литерал в `Constants.js` (цвет — `0xRRGGBB`, режим — целое число).
2. Чтение в коде через `typeof ИМЯ !== 'undefined' ? ИМЯ : дефолт`.
3. Поле в `KIT_SCHEMA`: слайдер `{ name, label: { en, ru }, min, max, step, hint: { en, ru } }`,
   `kind: 'color'` или `kind: 'select'` с `options: [{ value, label: { en, ru } }]`.
   Режим — только select; уровни 0/1/2 и нет/да — готовые `SCHEMA_LEVELS`, `SCHEMA_NO_YES`.
4. Если префикс новый — ветка в `Lab.onConstant`.

## Ловушки

- Правил `server.mjs` или `save.mjs` — перезапусти `editor.bat`: Node читает их один раз. При смене
  эндпоинтов подними `EDITOR_API_VERSION` в `server.mjs` И `schema.js` — клиент
  предупредит о старом сервере.
- Пути ассетов в редакторе — от корня (`assetBase: '/'`): страница живёт в
  `/_utils/editor/`, относительный `assets/…` ушёл бы туда.
- Клавиши камеры не работают, пока фокус в поле инспектора — `lab.js` снимает фокус
  при нажатии на вид.
- Кадр Babylon рисуется каждый тик (`preserveDrawingBuffer: false`): гейт «рисовать по
  флагу» показывает мусор из буфера.
- Без `scene.attachControl()` гизмо рисуется, но не тянется; без `camera.ignorePointer`
  ЛКМ по стрелке одновременно крутит свободную камеру.
- Комментарий с `'assets/…'` в кавычках — ложная ссылка для сканера сборщика (он читает и
  комментарии): сборка упадёт на «пропавшем ассете». Шапка `Objects.js` пишет путь без кавычек.
- `Objects.js` в странице редактора — лексический `const`: панель работает с копией, после
  сохранения глобал устаревший, база — `ObjectsPanel.saved`.

## Чеклист

1. `node tools/check.mjs` проходит (типы редактора — `_utils/editor/tsconfig.json`, скилл `build`).
   Консоль редактора без ошибок, точка сервера зелёная.
2. Новая константа видна в инспекторе на обоих языках (EN/RU), правка применяется к
   сцене, «Сохранить» пишет ровно одну строку `Constants.js`.
3. Новый текст интерфейса переключается вместе с языком.
4. Objects: выбор кликом и в списке, гизмо тянется, «Сохранить в Objects.js» пишет файл,
   который проходит `node --check`, и сканер (`collectRefs`) не видит пропавших ассетов.
5. Игра (`run.bat`) стартует с сохранёнными значениями и объектами.
