---
name: world3d
description: 3D-движок набора — World3D (движок, View3D, свет, тени, toon-шейдер, контур и обводка, addObject), Terrain3D (земля), Location3D (локация), CameraControl (камера). Читать перед правками World3D.js, Terrain3D.js, Location3D.js, CameraControl.js, main.js и блоков CAMERA_*/WORLD3D_*/TERRAIN_*/LOCATION_* в Constants.js, а также перед добавлением объектов в сцену.
---

# 3D-мир: World3D, Terrain3D, Location3D, камера

Babylon.js 9.26 (`libs/babylon.js`, UMD, глобал `BABYLON`), без сборки. Цикл кадра
держит владелец: `main.js` в игре, `_utils/editor/lab.js` в редакторе.

```
main.js: World3D.init(canvas) -> new Location3D() -> new CameraController(view)
         runRenderLoop: location.update(dt) -> camera.update(dt) -> World3D.renderFrame()
```

## Файлы

| Файл | Что |
|---|---|
| `World3D.js` | `World3D`: `init(canvas)`, `renderFrame()`, `createView(opts)`, `cfg()` (все константы рендера), `applyRenderConstants(view)`, `addObject/removeObject`, контур (`inkMesh`), обводка (`outlineAdd/Remove`, тон по туману `outlineFog`, `fogFactor`), `sunDirection()`, `hexColor3()`. `ArcToonPlugin` + `World3D.toon` (объект `ArcToon`). `View3D`: сцена, камера, свет, тени, `pointerToGround`, `projectToScreen`, `dispose` |
| `Terrain3D.js` | поле высот из шума, сетка `[0..W]×[0..H]`, кольцо земли за краем, `heightAt`, `tiltAt`, `setGroundImage`, `applyTileSize` |
| `Location3D.js` | локация = `View3D` + `Terrain3D` + текстура земли (`GROUNDS`) + объекты (`opts.objects` = `LOCATION_OBJECTS`); `ready` (промис: земля, модели, шейдеры), `buildTerrain()` (объекты встают на новую землю), `loadGround()`, `objects` (`{ def, mesh, error, loaded }`), `addObject(def)`, `placeObject(rec)`, `removeObject(rec)`, `update(dt)` (каждый кадр: `spinPart` по `def.anim`) |
| `Model3D.js` | бинарный FBX -> меши: `load(url)` (разбор с кэшем), `build(model, scene, { name })` (корень без геометрии, части с `MultiMaterial`; у меша части `metadata = { part, pivot, axes }` — имя объекта FBX, его origin и единичные локальные оси в координатах файла), `dispose(view, root)` (с материалами). 1 см файла = 1 px, начало координат — из файла |
| `Objects.js` | `LOCATION_OBJECTS`: `{ name, model: 'assets/models/….fbx', kind, x, y, h, rot: [x, y, z]°, scale: [x, y, z], anim? }`; `rot[1]` — курс (`rotation.y = −rot[1]`); `anim: { part, axis: 'x'\|'-x'\|'y'\|…, speed: об/мин, dir: 'cw'\|'ccw' }`. Пишет редактор |
| `CameraControl.js` | `CameraController`: цель, азимут, наклон, зум; DOM-ввод; игровой и свободный режимы; `ignorePointer(e)` — нажатие не для камеры |

## Координаты

| Карта (px) | Babylon | |
|---|---|---|
| `x` | `position.x` | вправо |
| `y` | `position.z` | вниз по карте = +Z |
| высота | `position.y` | вверх |
| курс `heading` (рад, `atan2(vy, vx)`) | `rotation.y = -heading` | нос модели вдоль +X |

Сцена **правосторонняя** (`useRightHandedSystem`): в левосторонней мир выходил
зеркальным. «Вправо на экране» при азимуте `az` — `(−sin az, cos az)`; единственное
место со знаком — `CameraController.screenDeltaToWorld/worldDeltaToScreen`.

Проекции — только через `View3D`:
- `pointerToGround(px, py, h, terrain?)` — CSS px канваса -> `{x, y}` карты: с
  `terrain` — пересечение с рельефом (марш + бисекция), без — плоскость `Y = h`;
  `null` — луч в небо. `createPickingRay` ждёт CSS px: масштаб рендера он учитывает сам.
- `projectToScreen(x, y, h)` -> `{x, y, visible, behind}` в CSS px.
- Камеру двигали, кадр не рисовался — сначала `view.refreshMatrices()`.

## Объекты мира

```js
const mesh = BABYLON.MeshBuilder.CreateBox('crate', { size: 64 }, location.view.scene);
mesh.material = new BABYLON.StandardMaterial('crate-mat', location.view.scene);
World3D.addObject(location.view, mesh, 'prop');          // 'actor' | 'prop'
mesh.position.set(x, location.terrain.heightAt(x, y) + 32, y);
// ...
World3D.removeObject(location.view, mesh);               // материалы — забота владельца
```

`addObject` раздаёт материалам группу (`metadata.toonGroup`: блик из констант,
toon), ставит корень в карту теней, рёбра — в контур, все части — в ОДИН слой
обводки (линия по общему силуэту). `actor` — главные объекты кадра (уровень 1
контура/обводки), `prop` — окружение (уровень 2). Земля — группа `ground`.

Всё, что создано в сцене, умирает с `view.dispose()`. Отдельный `removeObject`
нужен только тому, что умирает раньше сцены.

## Свет, тени, toon, контур

Все числа рендера читает ОДНО место — `World3D.cfg()` (typeof по каждому имени +
дефолт: в игре константы лексические, в редакторе — `window`).
`applyRenderConstants(view)` применяет их к живой сцене без пересборки.

- **Свет:** `HemisphericLight` (небо) создаётся ПЕРВЫМ, `DirectionalLight` (солнце)
  — последним. Ровная земля ≈1.0 при `SUN 0.8 + SKYLIGHT 0.45`; суммы > ~1.2 клампятся в белый.
- **Тени:** `ShadowGenerator`, darkness всегда 0 — цвет и силу тени красит плагин
  (define `ARCSHADOW`): свет в тени = свет без тени × `mix(1, SHADOW_COLOR, STRENGTH)`.
  Ортокадр солнца ездит за целью камеры и ужимается по ГАБАРИТАМ кастеров
  (`fitShadowFrustum`: bounding box в мире + высота × cos высоты солнца, квант 32 px,
  центр по сетке текселей, гистерезис). По позициям кадр резал тень большой модели.
  `shadowMinZ/MaxZ = LIGHT_DIST ∓ 1200` — узкий диапазон, иначе тени пропадают.
  «Акне» (полосы и «пила» на гранях под острым углом к солнцу) гасит смещение по
  нормали `WORLD3D_SHADOW_NORMAL_BIAS` — в ТЕКСЕЛЯХ карты: кадр «дышит» (140–720 px),
  в px его пересчитывает `updateLightFrustum`. PCF сравнивает глубину и на соседних
  текселях, поэтому `applyLighting` сам прибавляет радиус фильтра края (`WORLD3D_SHADOW_SOFT`
  1/2/3 — 0.5/1.5/2.5 текселя): без этого на мягком крае «пила» возвращалась.
- **Toon:** `ArcToonPlugin` (плагин `StandardMaterial`), регистрируется в
  `World3D.init` ДО первой сцены — вешается на материалы при создании. Врезка —
  после строки `aggShadow=aggShadow/numLights;` в `default.fragment`: яркость
  `diffuseBase` квантуется в ступени, блик — порогом, ободок — fresnel.
  Значения — uniform'ами, вкл/выкл `WORLD3D_TOON` — `markAllDefinesAsDirty`.
  `metadata.toon = false` снимает ступени с материала; unlit не трогается.
- **Контур рёбер:** `EdgesRenderer` (`inkMesh`), `checkVerticesInsteadOfIndices` —
  у lowpoly треугольники разъединены. Толщина ≈ мировые px × 100.
- **Обводка силуэта:** `HighlightLayer` с `isStroke`, слой на пару «вид × группа
  рендера» (`view._outlines['actor@0']`, `meshes`: меш -> его цвет линии). Толщина в
  экранных px. Часть toon-вида: при `WORLD3D_TOON = 0` (галочка «toon shader»
  редактора) `outlineAdd` меш не ставит, `applyOutlines` снимает и возвращает обводку
  живо; контур рёбер от `WORLD3D_TOON` не зависит. Линия ложится на готовый кадр — туман сцены её не касается, поэтому
  `outlineFog` (из `renderFrame`, до `scene.render()`) каждый кадр красит линию меша
  формулой тумана Babylon: `mix(fogColor, WORLD3D_TOON_INK_COLOR, f)`, `f` — по
  расстоянию от камеры до центра меша (`fogFactor`). Своих констант нет. Тон один на
  меш: у меша с инстансами (thin или обычными) центр габарита — середина всей
  россыпи, поэтому расстояние берётся до точки взгляда камеры (`camera.getTarget()`).
  Фон маски слоя (`hl.neutralColor`) — самый тёмный тон его мешей с альфой 0.

## Terrain3D и Location3D

- Высота = `TERRAIN_BASE + шум` (две октавы). `heightAt` интерполирует ПО ТЕМ ЖЕ
  треугольникам, что меш (диагональ `(i,j)-(i+1,j+1)`); за сеткой — шум, как у кольца.
- Обход треугольников выбирается проверкой нормали (+Y) и страхуется после
  `ComputeNormals`; кольцо берёт тот же обход (`_swap`).
- Материал — тайл (`DynamicTexture`, `invertY = false`), повтор `GROUND_TILE_SIZE`,
  UV `(x/W, y/H)` у сетки и кольца — шва на краю нет. Кольцо — яркость `WORLD3D_OUTER_TINT`.
- Мобильные: клетка не мельче 12 px. Террейн — картинка: логика игры высоту у 3D не
  спрашивает (клетка зависит от устройства).
- `Location3D` грузит текстуру по `LOCATION_GROUND` из `GROUNDS` — пути
  ЛИТЕРАЛАМИ (сканер сборщика видит только так); нет файла — земля ровного цвета.
  В редакторе `assetBase: '/'`, в игре пути относительные.
- Вращение части (`def.anim`, `spinPart`): меш части с `metadata.part === anim.part` —
  `setPivotPoint(pivot)` и `rotationQuaternion` вокруг `axes[axis]` (минус — обратный
  конец); угол копится в `rec.spin`, `def` не трогается. Положительный угол — против
  часовой, если смотреть с конца оси (сцена правосторонняя): `dir: 'ccw'` → +. Сняли
  `anim` или сменили часть — кватернион и пивот прежней сбрасываются. Вращается
  только отдельный объект FBX: в Blender часть — свой объект с origin на оси.

## Камера

Зум — экранных px на мировой px в точке взгляда; `dist = H / (2·tan(fov/2)·zoom)`.
Камера = цель − (cos az, sin az)·cos(pitch)·dist, высота + sin(pitch)·dist, не ниже земли + 40.

| | игровой режим | свободный (`setFree(true)`, редактор) |
|---|---|---|
| ЛКМ | не берёт (ввод игры) | орбита; Shift — панорама |
| ПКМ | орбита, если `CAMERA_ORBIT = 1` | орбита |
| средняя, палец | панорама «за указателем» | то же |
| колесо / щипок | зум к курсору в `CAMERA_ZOOM_MIN..MAX` | пределы шире |
| наклон | `CAMERA_ORBIT_PITCH_*` и край земли не в кадре | 8°..88° |
| цель | внутри локации | без пределов |

`home()` (клавиша R) — ориентация и зум из констант, цель — `follow`-объект или центр.
`applyConstants()` перечитывает константы (FOV — сразу). Клавиши (`e.code`: WASD,
стрелки, R) не перехватываются в полях ввода. Панорама держит точку земли под
курсором пересечением с плоскостью её высоты, в два прохода.

## Ловушки (каждая уже стоила итерации)

- `emissiveColor` у материала с `emissiveTexture` — ЧЁРНЫЙ, иначе белый прибавится к
  текстуре и выбелит её. `disableLighting` + `diffuseTexture` рисует чёрным.
- Вершинные цвета при `disableLighting`: наоборот, `emissiveColor` БЕЛЫЙ — иначе всё чёрное.
- `clone()` копирует `metadata` по ссылке: у клона контур и обводка писали бы в
  общий объект (`addObject` раздаёт свои копии).
- Обводке нужен трафарет: движок поднят с `stencil: true`.
- Толщина обводки — в текселях размытия (`outlineKernel`), иначе на мобильных линия вчетверо толще.
- Слой обводки рисует только меши своей группы рендера: слой заводится на каждую группу.
- `preserveDrawingBuffer: false`: пропущенный кадр показывает мусор — рисовать каждый тик.
- Инстансы не отбрасывают тени, если в кастерах только прототип: thin instances или
  каждый инстанс в `addShadowCaster`.
- Склейка обводки идёт в `ALPHA_PREMULTIPLIED`: шейдер слияния STROKE уже умножает
  цвет на альфу, а `ALPHA_COMBINE` умножал второй раз — у линии цвета тумана кромка
  темнее фона, объект вдали растворялся, а «призрак» контура оставался. Режим лежит в
  приватном `hl._thinEffectLayer._options.alphaBlendingMode`, и `outlineLayer` ставит
  его ТОЛЬКО на время склейки (`onBeforeComposeObservable` → 7, `onAfterComposeObservable`
  → 2). Те же опции слой читает при пересоздании текстур (смена размера канваса): с
  PREMULTIPLIED в опциях цепочка размытия собиралась другой (2 прохода вместо 3),
  текстура размытия оставалась пустой, и обводка пропадала совсем (так было в редакторе
  ArcTrack). Опцией конструктора нельзя по той же причине.
- Фон маски обводки — в тон линии (`outlineFog` ставит `hl.neutralColor`). По
  умолчанию маска чистится чёрным, и размытие у края маски смешивало с ним цвет
  линии: при дробной толщине (1.5, 0.5 px) и на мобильных линия цвета тумана
  получала тёмную кайму. Светлее самого тёмного тона слоя нельзя — размытие берёт
  самый яркий отсчёт и перекрасило бы линию ближнего объекта. `neutralColor` у слоя
  свой (`outlineLayer`): по умолчанию все слои делят статический
  `HighlightLayer.NeutralColor`.
- Апгрейд Babylon: пропала строка врезки — toon молча перестанет работать (шейдер цел);
  пропало поле `_thinEffectLayer._options` — вернётся «призрак» контура в тумане.
- У 90° наклона вырождается `setTarget` — пределы 88–89°.
- `Model3D`: треугольники пишутся в обратном к FBX порядке (соглашение мешей Babylon,
  как у `Terrain3D`) — «починишь» обход, и `backFaceCulling` вывернет модель наизнанку.
  `DiffuseColor` в файле линейный (Blender) — без `toGammaSpace()` краски темнее.
- Путь `'assets/…'` в кавычках даже в КОММЕНТАРИИ сканер сборщика считает ссылкой на
  ассет — сборка падает на «пропавшем» файле. В комментариях — без кавычек.
- `placeObject` сбрасывает `rotationQuaternion`: гизмо редактора может его завести, и
  тогда `rotation` из `Objects.js` молча не действует.

## Константы

Группы в `Constants.js`: `LOCATION_*`/`GROUND_TILE_SIZE`/`TERRAIN_*` (локация),
`CAMERA_*` (камера), `WORLD3D_*` (рендер). Значения — в файле, их крутит редактор.

## Чеклист правки

1. Новая константа: числовой литерал в `Constants.js` + чтение через `typeof` с
   дефолтом (`World3D.cfg()` / `CameraController.cfg()`) + строка в `_utils/editor/schema.js`
   (подписи `{ en, ru }`, скилл `editor`).
2. Новый `<script>`: место в `index.html` (после `Constants.js`, до `main.js`) и строка
   в `CODE_FILES` (`tools/asset-scan.mjs`); редактору — тот же скрипт в его `index.html`.
3. Новый объект мира — через `World3D.addObject`; проекции экран↔мир — через `View3D`.
4. Не трогать: `useRightHandedSystem`, CSS px в `createPickingRay`, порядок света,
   `shadowMinZ/MaxZ`, проверку нормалей террейна.
5. `node tools/check.mjs` проходит (типы и тесты, скилл `build`); новое поле на объекте
   Babylon — в `globals.d.ts`.
6. Проверить в браузере игру (`run.bat`) и редактор (`_utils/editor.bat`): консоль без ошибок.
