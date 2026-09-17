---
name: build
description: Dev-сервер, сборка и проверка кода — dev-сервер (tools/dev-server.mjs), сборщик архива (tools/build.mjs, asset-scan.mjs, zip.mjs), проверка типов tsc и тесты node --test (tools/check.mjs, tsconfig.json, globals.d.ts, tests/), ассеты. Читать перед правками tools/ и tests/, перед добавлением скрипта или ассета, при ошибке tsc и перед сборкой архива.
---

# Dev-сервер, сборка, проверка кода

```
node tools/check.mjs         # типы игры и редактора + тесты (check.bat — то же с паузой)
node tools/check.mjs --types
node tools/check.mjs --tests
run.bat                      # dev-сервер + браузер, порт 8080 (или следующий свободный)
run.bat 9000 --no-open
build.bat                    # dist/arcengine-<GAME_VERSION>.zip
build.bat --version=0.2.0    # проставить версию в билд
build.bat --no-zip           # только папка build/
build.bat --keep-unused      # не выбрасывать ассеты без ссылок
build.bat --force            # собрать несмотря на провалы проверок
upload.bat "что изменилось"  # на GitHub: git add -A, commit, push (только по просьбе пользователя)
```

Git — только для заливки: что не едет — `.gitignore`; `.gitattributes` (`* -text`) — байт в байт,
без замены концов строк.

## dev-сервер (`tools/dev-server.mjs`)

- `Cache-Control: no-store` на всё: сборки нет, иначе браузер крутит старый `.js`
  (`no-cache` не годится — допускает 304).
- На старте — проверка ассетов тем же сканером, что у сборщика; Range-запросы; MIME.

## Сборщик (`tools/build.mjs`)

`[1/4] проверки -> [2/4] build/ -> [3/4] dist/*.zip -> [4/4] отчёт`. Любой провал
останавливает сборку (`--force` — обойти).

| Проверка | Зачем |
|---|---|
| ссылки на ассеты резолвятся | 404 в рантайме |
| `node --check` каждого скрипта | синтаксическую ошибку больше ловить нечем |
| `index.html` есть, `Constants.js` — первый локальный скрипт | точка входа в корне; глобалы констант читаются при загрузке |
| внешних скриптов и URL нет | ноль зависимостей: всё лежит в архиве |
| имена файлов — ASCII без пробелов | распаковка и URL на хостинге |
| регистр путей совпадает с диском (через `readdir`) | разработка на Windows, раздача с Linux |
| нет абсолютных путей `src="/…"` | игру могут отдавать из вложенного пути |

В `build/` едет только белый список `CODE_FILES` (`tools/asset-scan.mjs`) плюс ассеты,
на которые есть ЛИТЕРАЛЬНЫЕ ссылки `'assets/…'` в коде. Путь из кусков
(`'assets/' + name`) сканер не видит — такие добавлять в `EXTRA_REFS`.
`?v=<версия>` дописывается `<script src>` при сборке; в рантайме кэш-бастинг скриптов
невозможен. `zip.mjs` пишет фиксированный mtime — одинаковое дерево даёт одинаковые байты.

## Проверка типов (`tsc`)

TypeScript 7 (`npx --yes -p typescript@7.0.2 tsc`, версия — в `tools/check.mjs`) проверяет JS
по JSDoc, ничего не компилирует. Две программы — у игры и редактора разные наборы глобалов:

| Конфиг | Файлы |
|---|---|
| `tsconfig.json` | `*.js` корня, `globals.d.ts`, `libs/*.d.ts` |
| `_utils/editor/tsconfig.json` | `_utils/editor/*.js` + модули набора без `main.js` (у редактора свой) |

Режим: `strict` без `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables` — ловит
опечатки в полях и методах и вызовы Babylon не по API, не требуя JSDoc у каждого параметра.
`libs/babylon.d.ts` — типы именно Babylon 9.26: апгрейд `babylon.js` = новый файл
(`cdn.jsdelivr.net/npm/babylonjs@<версия>/babylon.d.ts`). `.mjs` (tools, сервер редактора) tsc
не проверяет — у них тесты.

Ловушки:
- Объект-литерал в JS «открыт»: `const X = { … }` принимает любое `X.опечатка`. Над каждым
  неймспейсом — `/** @satisfies {Record<string, any>} */`. Он же закрывает дописывание полей
  снаружи (`X.новое = …` — ошибка): поле объявить в литерале (`World3D.toon: null` +
  `World3D.toon = ArcToon`). Внутри методов `this` остаётся нестрогим.
- Поле литерала `null` без JSDoc — `any`: всё, что через него, не проверяется. Нужен
  `/** @type {Location3D | null} */`.
- `querySelector`/`getElementById` дают `Element`/`HTMLElement`: `.value`, `.checked`,
  `.disabled`, `.dataset` — через приведение `/** @type {HTMLInputElement} */ (el)`.
- Глобал с именем встроенного класса браузера (`History`, `Image`, `Location`…) — ошибка
  «Cannot redeclare»: отсюда `EditHistory`.
- `window.ИМЯ` константы в редакторе — `/** @type {any} */ (window).ИМЯ`: в типах `Window`
  констант нет.

## Тесты (`tests/*.test.mjs`, `node --test`)

Логика без 3D: `store` (Store при открытом и закрытом хранилище), `terrain` (`heightAt` — узлы,
диагональ клетки как у меша, непрерывность, край, сид, мобильная клетка), `asset-scan`
(`collectRefs`, в проекте нет пропавших ассетов), `editor-save` (`_utils/editor/save.mjs`: патч
чисел, BOM, бэкапы, каждое число `Constants.js` перезаписывается без потерь, `Objects.js`
читается игрой и сканером, негодные записи отклоняются), `claude` (скиллы `claude/skills/` связаны
с таблицей CLAUDE.md, `claude/launch.json` запускает серверы, папки `.claude/skills/` нет — веб-загрузка
на GitHub пропускает имена с точкой, скиллы оттуда до пользователей не доедут).

`browser-scripts.mjs`: `loadScripts(files, globals)` исполняет классические скрипты в одном
`node:vm`-контексте (как `<script>`), `get('Имя')` достаёт верхнеуровневый `const`/`class`;
`stub()` — пустышка для `BABYLON`/`World3D`, когда конструктор по пути строит меши. Объекты
из контекста — другого realm: для `assert.deepEqual` копировать (`{ ...obj }`, `JSON`).
Файлы во временных папках, `after()` их удаляет.

## Чеклист

1. Новый скрипт — строка в `CODE_FILES`; новый ассет — литерал `'assets/…'` в коде.
2. `node tools/check.mjs` проходит; новая логика без 3D — тест рядом с похожими.
3. `build.bat` проходит без `--force`.
4. Игра стартует на dev-сервере — консоль без ошибок.
