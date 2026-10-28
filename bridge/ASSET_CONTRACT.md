# MGLOTEK asset handoff v1

Игра использует pygame; Blender/ComfyUI экспортируют данные в согласованную папку assets после валидации.

| Шаг | Требуемые результаты | Контроль качества |
| --- | --- | --- |
| Сцена Blender | birch_mid.png, birch.glb, birch.blend | 1900×470 PNG RGBA, GLB v2, проект Blender |
| Персонажи | models/character.glb или models/character.vrm | канонический силуэт, геометрия, проверка лицензии |
| Материалы | textures/object_albedo.png и дополнительные PBR-карты | UV, цветовое пространство, normal/roughness |
| Анимация | animation/character_rigged.fbx | rig, клипы, фиксированная боковая камера |
| Катсцена | cutscenes/scene.mp4 | кодек, размер, права на модель и звук |
| Исследование | research/references.md | не исполнять неизвестные бинарники |

Handoff.json помечается execution_status=NOT_EXECUTED до реального прохождения производственного шага. Не следует смешивать проверку доступности GitHub с успешной генерацией GPU-моделей.

Текущий проверенный Blender workflow создаёт прозрачный слой Берёзового двора. Он не заменяет collision map и навигацию. Любая замена assets/locations/birch/mid.png должна быть с резервным копированием.
