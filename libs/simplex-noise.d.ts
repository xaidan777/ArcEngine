// Типы libs/simplex-noise.js (глобал SimplexNoise). Для проверки типов, в архив не едет.
declare class SimplexNoise {
    constructor(randomOrSeed?: string | number | (() => number));
    noise2D(x: number, y: number): number;
    noise3D(x: number, y: number, z: number): number;
    noise4D(x: number, y: number, z: number, w: number): number;
}
