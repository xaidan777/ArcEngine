// globals.d.ts — типы для проверки tsc (check.bat). В рантайме и в архиве не участвует.
// Здесь то, что нельзя описать JSDoc в классическом скрипте: поля, которые код вешает на
// чужие объекты, и записи, общие для игры и редактора.

declare namespace BABYLON {
    interface Material {
        /** Toon-плагин (World3D.toon.register вешает на каждый StandardMaterial). */
        arcToon?: ArcToonPlugin;
    }
}

interface Window {
    /** main.js: локация и камера игры — для консоли и кода игры. */
    app?: { location: Location3D; camera: CameraController };
}

/** Запись LOCATION_OBJECTS (Objects.js, пишет редактор). */
interface LocationObjectDef {
    name: string;
    /** Путь от корня игры: assets/models/….fbx */
    model: string;
    /** 'actor' — главный объект кадра, 'prop' — окружение */
    kind: string;
    x: number;
    y: number;
    /** px над землёй */
    h: number;
    /** [x, y, z] градусы; y — курс */
    rot: number[];
    scale: number[];
    anim?: { part: string; axis: string; speed: number; dir: string };
}

/** Объект локации: Location3D.objects. */
interface LocationObject {
    def: LocationObjectDef;
    /** Корень модели; null, пока не догрузилась или не нашлась. */
    mesh: BABYLON.Mesh | null;
    error: string | null;
    loaded: Promise<LocationObject>;
    /** Состояние вращения части (Location3D.spinPart). */
    spin?: {
        name: string;
        root: BABYLON.Mesh;
        mesh: BABYLON.AbstractMesh | null;
        angle: number;
        axis: BABYLON.Vector3;
        q: BABYLON.Quaternion;
    } | null;
}
