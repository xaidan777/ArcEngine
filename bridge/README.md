# МГЛОТЕК — GitHub-мост для 15 инструментов

Основная игра остаётся на Python + pygame. Все 15 присланных репозиториев зарегистрированы в bridge/manifest.json (без дубля image-to-3dlab).

## Уровни готовности

1. **GitHub source bridge (настроен для 15):** проверка ветки и ревизии исходников; скачивание выбранного проекта в одноразовый облачный runner; handoff-задача с ожидаемыми форматами ассетов.
2. **Blender cloud CPU (уже запускался):** в отдельном workflow mglotek-blender.yml получены настоящие birch_mid.png, birch.blend и birch.glb для Берёзового двора.
3. **Нейросетевые GPU-инструменты (пока только source и handoff):** WanVideo, AssetFurnace, UniMate, оба UltraTex, PartLLM, EdenLive. Веса моделей, отдельный GPU и допустимые лицензии ещё не настроены. Отметка GitHub source OK не означает, что модель запускалась.
4. **Внешние сервисы/Windows (готовы к инспекции):** Charakuru может требовать провайдерский доступ; Easy-Install рассчитан на Windows, не запускается в Linux.
5. **Исследовательские:** rea — анализ, не движок; DirtyMoCap — материалы исследования без подтвержденного исполняемого runtime; ArcEngine — хост мостов, не замена pygame.

## Запуск полностью через GitHub

Открой ветку mglotek-cloud-render репозитория kivnufki121-dot/ArcEngine и измени файл bridge/request.json:

Пример запуска проверки всех источников:

    {"operation":"audit","tool_id":"all"}

Пример запроса загрузки только UltraTex (источников, НЕ весов):

    {"operation":"prepare","tool_id":"ultratex"}

Пример получения технического задания на создание 3D:

    {"operation":"handoff","tool_id":"asset_furnace"}

Коммит в этой ветке запускает workflow MGLOTEK - bridges for 15 GitHub tools. Результаты доступны в Actions → Artifacts, хранятся 14 дней. Таким образом пользователь не устанавливает ни Blender, ни ComfyUI, ни нейросетевые пакеты на ПК. GitHub Actions workflow_dispatch может быть невидимым, пока файл отсутствует на default branch; изменение bridge/request.json запускает push независимо от этого.

## Полная таблица

| ID | Репозиторий | Роль |
| --- | --- | --- |
| wan_video | kijai/ComfyUI-WanVideoWrapper | катсцены, GPU |
| comfy_manager | Comfy-Org/ComfyUI-Manager | управление окружением |
| rea | morluto/rea | исследование |
| asset_furnace | Bingeljell/image-to-3dlab | концепт → 3D |
| unimate | Friedrich-M/UniMate | анимация |
| ultratex | visualbruno/ComfyUI-UltraTex | текстуры |
| ultratex_modular | Mstafa-awad/UltraTex-ComfyUI-nodes | альтернативное текстурирование |
| comfy_easy_install | Tavris1/ComfyUI-Easy-Install | Windows-установщик окружения, не для Linux |
| motion2mixamo | MaxLiu22/Motion2MixamoRig | риг/мокап |
| charakuru | nanocle/Charakuru | VRM-персонажи |
| partllm | czvvd/PartLLM | сегментация 3D, НЕ написание диалогов |
| edenlive | VAST-AI-Research/EdenLive | катсцены |
| dirtymocap | WangLongZJU/DirtyMoCap | исследование |
| blender | blender/blender | настоящий Blender рендер облако |
| arcengine | kivnufki121-dot/ArcEngine | хостинг Actions |

## Для программиста

- python3 bridge/bridge.py validate
- python3 bridge/bridge.py list
- python3 bridge/bridge.py audit --id all --out bridge_output
- python3 bridge/bridge.py prepare --id ultratex --out bridge_output
- python3 bridge/handoff.py --id ultratex --out bridge_output/handoff.json
- python3 bridge/bridge.py check-birch --input cloud_output --out bridge_output

Внешний код не исполняется автоматически. Клонирование только с публичного github.com, без предоставления токена в скачанный код. При интеграции нужны отдельный аудит лицензии, проверка формата и согласование платных GPU-задач. Два варианта UltraTex нельзя считать совместимыми автоматически: для них предусмотрены отдельные идентификаторы.
