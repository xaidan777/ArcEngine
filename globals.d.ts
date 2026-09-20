// globals.d.ts — types for the tsc check (check.bat). Not part of the runtime or the archive.
// Here is what cannot be described with JSDoc in a classic script: fields the code attaches to
// foreign objects, and records shared by the game and the editor.

declare namespace BABYLON {
    interface Material {
        /** Toon plugin (World3D.toon.register attaches it to every StandardMaterial). */
        arcToon?: ArcToonPlugin;
    }
}

interface Window {
    /** main.js: the game's location, camera and game logic — for the console and game code. */
    app?: { location: Location3D; camera: CameraController; game: Game | null };
}

/** UI_LAYOUT record (UILayout.js, written by the editor's UI tab); fields by kind — UI.DEFAULTS. */
interface UIRecord {
    id: string;
    /** 'text' | 'panel' | 'bar' | 'button' */
    kind: string;
    /** One of 9 points of the container (the screen or the parent): 'top-left' … 'bottom-right' */
    anchor: string;
    /** Id of the element this one sits in; none — the screen. */
    parent?: string;
    x: number;
    y: number;
    w?: number;
    h?: number;
    /** 'h' | 'v' | 'both' — fills the container on that axis: x (y) — the inset, w (h) ignored. */
    stretch?: string;
    text?: string;
    fontSize?: number;
    /** Text color; bar — the filled part. '#rrggbb' */
    color?: string;
    shadow?: string;
    fill?: string;
    border?: string;
    radius?: number;
    /** Bar fill 0..1 */
    value?: number;
    alpha?: number;
    /** 0 — hidden until the game calls show() */
    visible?: number;
}

/** LOCATION_OBJECTS record (Objects.js, written by the editor). */
interface LocationObjectDef {
    name: string;
    /** Path from the game root: assets/models/….fbx */
    model: string;
    /** 'actor' — a main object of the frame, 'prop' — scenery */
    kind: string;
    x: number;
    y: number;
    /** px above the ground */
    h: number;
    /** [x, y, z] degrees; y — heading */
    rot: number[];
    scale: number[];
    anim?: { part: string; axis: string; speed: number; dir: string };
    /** Looped animation clip of a glTF model ('idle'); none — the rest pose. */
    clip?: string;
    /** A group name for game code: location.findByTag('coin'). */
    tag?: string;
    /** Placed but not in the scene until location.setHidden(rec, false). */
    hidden?: boolean;
    /** A sound standing at the object (Sound3D): src — assets/sounds/…, looped unless loop is false. */
    sound?: { src: string; volume?: number; loop?: boolean; falloffMin?: number; falloffMax?: number };
}

/** Location object: Location3D.objects. */
interface LocationObject {
    def: LocationObjectDef;
    /** Model root; null until it has loaded or if it was not found. */
    mesh: BABYLON.Mesh | null;
    error: string | null;
    loaded: Promise<LocationObject>;
    /** Part spin state (Location3D.spinPart). */
    spin?: {
        name: string;
        root: BABYLON.Mesh;
        mesh: BABYLON.AbstractMesh | null;
        angle: number;
        axis: BABYLON.Vector3;
        q: BABYLON.Quaternion;
    } | null;
    /** The clip Location3D.playClip last asked for and the model root it asked. */
    clip?: string;
    clipRoot?: BABYLON.Mesh | null;
    /** The playing def.sound and what it was started from (Location3D.updateSound). */
    sound?: SoundHandle | null;
    soundKey?: string;
}
