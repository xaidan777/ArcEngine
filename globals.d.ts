// globals.d.ts — types for the tsc check (check.bat). Not part of the runtime or the archive.
// Here is what cannot be described with JSDoc in a classic script: fields the code attaches to
// foreign objects, and records shared by the game and the editor.

declare namespace BABYLON {
    interface Material {
        /** Toon plugin (World3D.toon.register attaches it to every StandardMaterial). */
        arcToon?: ArcToonPlugin;
    }
    interface AbstractMesh {
        set?: (x: number, y: number, z: number) => any;
    }
}

interface Window {
    /** main.js: the game's location, camera and game logic — for the console and game code. */
    app?: { location: Location3D; camera: CameraController; game: Game | null };
    WeatherSystem?: any;
    DayNightCycle?: any;
    ProceduralAudio?: any;
    ProceduralAudioCore?: any;
    ProceduralCombatSynth?: any;
    ProceduralWeaponSynth?: any;
    ProceduralFoleySynth?: typeof ProceduralFoleySynth;
    ProceduralArcSynth?: any;
    VoicePriority?: typeof VoicePriority;
    VoiceManager?: typeof VoiceManager;
    ArcSpatialGrid?: typeof ArcSpatialGrid;
    ArcComponent?: typeof ArcComponent;
    HealthComponent?: typeof HealthComponent;
    ColliderComponent?: typeof ColliderComponent;
    MeshComponent?: typeof MeshComponent;
    SoundEmitterComponent?: typeof SoundEmitterComponent;
    ArcActor?: typeof ArcActor;
    ArcPostProcess?: typeof ArcPostProcess;
    ArcInspector?: typeof ArcInspector;
    ArcPerformanceOverlay?: ArcPerformanceOverlayCore;
    ArcPerformanceOverlayCore?: typeof ArcPerformanceOverlayCore;
    /** js/engine/ArcEventBus.js — the full bus; `ArcEventBus` is its singleton instance. */
    ArcEventBus?: ArcEventBusCore;
    ArcEventBusCore?: typeof ArcEventBusCore;
    /** js/engine/ArcStateMachine.js — the FSM / behaviour-tree module. */
    ArcStateMachine?: any;
    Blackboard?: any;
    BTStatus?: any;
    BTNode?: any;
    BTSequence?: any;
    BTSelector?: any;
    BTAction?: any;
    BTCondition?: any;
    BTInverter?: any;
    BTRepeater?: any;
    createAIPreset?: any;
    ArcEngine?: ArcEngineCore;
    ArcEngineCore?: typeof ArcEngineCore;
    ShooterRules?: any;
    RaidRules?: any;
    NavGrid?: any;
    TacticalMap?: any;
    RaidInventory?: any;
    TacticalRange?: any;
    OnlineLobby?: any;
    RaidClient?: any;
    KeyBindings?: any;
    ControlsMenu?: any;
}

declare var TacticalRange: any;
declare var OnlineLobby: any;
declare var RaidClient: any;
declare var KeyBindings: any;
declare var ControlsMenu: any;

declare var module: any;
declare var ShooterRules: any;
declare var NavGrid: any;
declare var TacticalMap: any;
declare var RaidInventory: any;

// Forward declarations. `js/ProceduralAudio.js` is loaded BEFORE the synth files, so it can
// only reference them as types. The rich declarations further down the file are merged with
// these; one declaration per name per kind is what tsc allows, so these are the only ones.
declare class ProceduralAudioCore { constructor(...args: any[]); static updateListener?: any; [key: string]: any; }
declare class ProceduralWeaponSynth { constructor(...args: any[]); [key: string]: any; }
declare class ProceduralAmbienceSynth { constructor(...args: any[]); [key: string]: any; }
declare class ProceduralArcSynth { constructor(...args: any[]); [key: string]: any; }

declare var VoicePriority: {
    readonly CRITICAL: 3;
    readonly HIGH: 2;
    readonly NORMAL: 1;
    readonly LOW: 0;
};

declare class VoiceManager {
    constructor(options?: number | { maxVoices?: number });
    maxVoices: number;
    static VoicePriority: typeof VoicePriority;
    allocateVoice(id: string | number, priority?: number, onStealCallback?: ((info: { fadeOutTime: number }) => void) | null): { id: string | number; priority: number; token: number; timestamp: number } | null;
    releaseVoice(token: any): boolean;
    getActiveCount(): number;
    getStats(): { activeVoices: number; maxVoices: number; stolenCount: number; droppedCount: number };
    clear(): void;
    hasVoice(token: any): boolean;
    resetStats(): void;
    [key: string]: any;
}

declare class ProceduralFoleySynth {
    constructor(options?: any);
    static SURFACES: readonly ['dirt', 'gravel', 'metal', 'concrete'];
    static SURFACE_ALIASES: Readonly<Record<string, 'dirt' | 'gravel' | 'metal' | 'concrete'>>;
    static normalizeSurface(surface?: string): 'dirt' | 'gravel' | 'metal' | 'concrete';
    static createMockContext(mockOptions?: any): any;
    isSupported: boolean;
    ctx: any;
    destination: any;
    masterGain: any;
    init(audioContext: any, destination?: any): boolean;
    resume(): Promise<boolean>;
    setMasterVolume(volume: number): void;
    getMasterVolume(): number;
    dispose(): void;
    playFootstep(surface?: string, options?: any): any;
    playGearRustle(options?: any): any;
    playJumpLaunch(options?: any): any;
    playJumpLand(surface?: string, options?: any): any;
}

/** UI_LAYOUT record (UILayout.js, written by the editor's UI tab); fields by kind — UI.DEFAULTS. */
interface UIRecord {
    id: string;
    /** 'text' | 'panel' | 'bar' | 'button' */
    kind: string;
    /** One of 9 screen points: 'top-left' … 'bottom-right' */
    anchor: string;
    x: number;
    y: number;
    w?: number;
    h?: number;
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
    /** A group name for game code: location.findByTag('loot'). */
    tag?: string;
    /** Placed but inert (disabled, children included) until location.setHidden(rec, false). */
    hidden?: boolean;
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
}

declare class ProceduralAudioCore {
    constructor(options?: any);
    ctx: any;
    audioCtx: any;
    /** Listener state for calculateSpatialParameters; pushed by ProceduralAudio.updateListener. */
    listenerPos: { x: number; y: number; z: number; h?: number };
    listenerForward: { x: number; y: number; z: number };
    setListenerPosition(x: number, y: number, z: number, forwardX?: number, forwardY?: number, forwardZ?: number): void;
    calculateSpatialParameters(pos: any): { gain: number; filterFreq: number; pan: number; inAudibleRange: boolean; distance: number; [key: string]: any };
    static isSupported(): boolean;
    static getAudioContextClass(): any;
    static generateWastelandIR(audioCtx: any, options?: any): any;
    static generateNoiseBuffer(audioCtx: any, type: string, duration?: number, channels?: number): any;
    static updateListener(ctx: any, data: any): void;
    init(options?: any): any;
    resume(): Promise<boolean>;
    suspend(): Promise<boolean>;
    close(): Promise<void>;
    setMasterVolume(vol: number): void;
    dispose(): void;
    [key: string]: any;
}

declare class ProceduralWeaponSynth {
    constructor(core?: any);
    core: any;
    ctx: any;
    listenerPos: { x: number; y: number; z: number; h?: number };
    playAssaultRifle(pos?: any, isPlayer?: boolean, tier?: any): any;
    playShotgun(pos?: any, isPlayer?: boolean): any;
    playRevolver(pos?: any, isPlayer?: boolean): any;
    playSMG(pos?: any, isPlayer?: boolean): any;
    playPlasma(pos?: any, isPlayer?: boolean): any;
    play(weaponIdOrCaliber?: any, pos?: any, isPlayer?: boolean, ...args: any[]): any;
    [key: string]: any;
}

declare class ProceduralAmbienceSynth {
    constructor(coreOrCtx?: any);
    start(): any;
    stop(): any;
    setWind(speed?: any, gust?: any): any;
    modulateWind(params?: any): any;
    setWeather(params?: any): any;
    setVolume(vol?: any): any;
    dispose(): void;
    [key: string]: any;
}

declare class ProceduralCombatSynth {
    constructor(audioCtx?: any, options?: any);
    ctx: any;
    static shared: ProceduralCombatSynth;
    static playMagOut(): any;
    static playMagIn(): any;
    static playBoltRack(): any;
    static playDryFire(): any;
    static playBulletWhiz(pos?: any): any;
    static playRicochet(pos?: any): any;
    static playImpact(surfaceType?: any, pos?: any): any;
    static playShieldHit(): any;
    static playShieldBreak(): any;
    static playShieldRecharge(active?: any): any;
    playMagOut(): any;
    playMagIn(): any;
    playBoltRack(): any;
    playDryFire(): any;
    playBulletWhiz(pos?: any): any;
    playRicochet(pos?: any): any;
    playImpact(surfaceType?: any, pos?: any): any;
    playShieldHit(): any;
    playShieldBreak(): any;
    playShieldRecharge(active?: any): any;
    setMasterVolume(vol: number): void;
    [key: string]: any;
}

declare class ProceduralArcSynth {
    constructor(audioCtx?: any);
    playCricketChitter(pos?: any): any;
    playCricketLeapCharge(pos?: any): any;
    playCricketLanding(pos?: any): any;
    playScreamerStiltStep(pos?: any): any;
    playScreamerScream(pos?: any): any;
    playSpotterHover(pos?: any, duration?: any): any;
    playSpotterSiren(pos?: any): any;
    playSentinelStep(pos?: any): any;
    playSentinelHorn(pos?: any): any;
    dispose(): void;
    [key: string]: any;
}

declare class DayNightCycle {
    constructor(options?: any);
    update(dt: number): this;
    setTime(hours: number): this;
    getTime(): number;
    getTimeFormatted(): string;
    isNight(): boolean;
    getNightFactor(): number;
    getPeriod(): string;
    getSunDirection(): any;
    applyToScene(view3d?: any): any;
    [key: string]: any;
}

declare class WeatherSystem {
    constructor(sceneOrOptions?: any, options?: any);
    update(dt: number): void;
    setWeatherState(state: string, duration?: number): void;
    getWindVector(): { x: number; z: number };
    getWindStrength(): number;
    getGustFactor(): number;
    [key: string]: any;
}

interface ProceduralAudioFacade {
    [key: string]: any;
}

// ----------------------------------------------------------------------------
// ArcEngine AI-Native Subsystems & Globals
// ----------------------------------------------------------------------------

declare const VoicePriority: {
    readonly CRITICAL: 3;
    readonly HIGH: 2;
    readonly NORMAL: 1;
    readonly LOW: 0;
    readonly [key: string]: number;
};

interface VoiceToken {
    id: string | number;
    priority: number;
    token: string;
    timestamp: number;
    onSteal?: ((info: { fadeOutTime: number }) => void) | null;
    [key: string]: any;
}

interface VoiceManagerStats {
    activeVoices: number;
    maxVoices: number;
    stolenCount: number;
    droppedCount: number;
    totalAllocated: number;
    [key: string]: any;
}

declare class VoiceManager {
    static VoicePriority: typeof VoicePriority;
    constructor(maxVoices?: number);
    maxVoices: number;
    activeVoices: Map<string, VoiceToken>;
    stolenCount: number;
    droppedCount: number;
    totalAllocated: number;
    allocateVoice(id: string | number, priority?: number, onStealCallback?: ((info: { fadeOutTime: number }) => void) | null): VoiceToken | null;
    releaseVoice(tokenOrString: VoiceToken | string): boolean;
    getActiveCount(): number;
    getStats(): VoiceManagerStats;
    clear(): void;
    [key: string]: any;
}

interface SpatialGridStats {
    entityCount: number;
    activeCellCount: number;
    cellSize: number;
    [key: string]: any;
}

declare var ArcSpatialGrid: {
    new (cellSize?: number | { cellSize?: number }): ArcSpatialGrid;
    prototype: ArcSpatialGrid;
};

interface ArcSpatialGrid<T = any> {
    cellSize: number;
    invCellSize: number;
    cells: Map<string, Set<T>>;
    entries: Map<T, any>;
    insert(entity: T, x: number, y: number, radius?: number): this;
    update(entity: T, newX: number, newY: number, radius?: number): this;
    remove(entity: T): boolean;
    queryRadius(x: number, y: number, radius: number, filterFn?: ((entity: T) => boolean) | null): T[];
    queryBox(minX: number, minY: number, maxX: number, maxY: number, filterFn?: ((entity: T) => boolean) | null): T[];
    queryRay(startX: number, startY: number, endX: number, endY: number, filterFn?: ((entity: T) => boolean) | null): T[];
    findNearest(x: number, y: number, maxRadius?: number, filterFn?: ((entity: T) => boolean) | null): T | null;
    clear(): void;
    getStats(): SpatialGridStats;
    [key: string]: any;
}

declare class ArcComponent {
    constructor(name: string);
    name: string;
    actor: ArcActor | null;
    enabled: boolean;
    onAttach(actor: ArcActor): void;
    onUpdate(dt: number): void;
    onDetach(): void;
    onDestroy(): void;
    toJSON(): any;
    [key: string]: any;
}

declare class HealthComponent extends ArcComponent {
    constructor(options?: { maxHp?: number; hp?: number; onDeath?: ((damage: number, source: any) => void) | null });
    maxHp: number;
    hp: number;
    onDeath: ((damage: number, source: any) => void) | null;
    takeDamage(amount: number, source?: any): number;
    heal(amount: number): number;
    isDead(): boolean;
    [key: string]: any;
}

declare class ColliderComponent extends ArcComponent {
    constructor(options?: { radius?: number; height?: number; layer?: string; isTrigger?: boolean });
    radius: number;
    height: number;
    layer: string;
    isTrigger: boolean;
    [key: string]: any;
}

declare class MeshComponent extends ArcComponent {
    constructor(options?: { mesh?: any; shape?: 'box' | 'sphere' | 'cylinder' | 'none'; size?: number[]; color?: number });
    mesh: any;
    shape: string;
    size: number[];
    color: number;
    [key: string]: any;
}

declare class SoundEmitterComponent extends ArcComponent {
    constructor(options?: { maxDistance?: number; refDistance?: number });
    maxDistance: number;
    refDistance: number;
    play(soundName: string, volume?: number): void;
    [key: string]: any;
}

declare class ArcActor {
    static _idCounter: number;
    static create(def?: any, scene?: any): ArcActor;

    constructor(options?: {
        id?: string;
        name?: string;
        tags?: string[];
        position?: { x?: number; y?: number; z?: number } | number[];
        rotation?: { x?: number; y?: number; z?: number } | number[];
        scale?: { x?: number; y?: number; z?: number } | number[];
        scene?: any;
        [key: string]: any;
    });

    id: string;
    name: string;
    tags: Set<string>;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    scene: any;
    mesh: any;
    components: Map<string, ArcComponent>;
    active: boolean;
    destroyed: boolean;
    metadata: any;

    addComponent(component: ArcComponent): this;
    getComponent<C extends ArcComponent = ArcComponent>(name: string): C | null;
    hasComponent(name: string): boolean;
    removeComponent(name: string): boolean;
    addTag(tag: string): this;
    hasTag(tag: string): boolean;
    removeTag(tag: string): boolean;
    getTags(): string[];
    setPosition(x: number, y: number, z: number): this;
    setRotation(x: number, y: number, z: number): this;
    setScale(x: number, y: number, z: number): this;
    update(dt: number): void;
    destroy(): void;
    toJSON(): any;
    [key: string]: any;
}

interface PostProcessSettings {
    glowEnabled?: boolean;
    glowIntensity?: number;
    glowBlurKernel?: number;
    toneMappingEnabled?: boolean;
    exposure?: number;
    contrast?: number;
    vignetteEnabled?: boolean;
    vignetteWeight?: number;
    vignetteStretch?: number;
    vignetteColor?: number[];
    preset?: string;
    [key: string]: any;
}

declare class ArcPostProcess {
    constructor(scene?: any, cameraOrOptions?: any, options?: any);
    static _activeInstance: any;
    static readonly PRESETS: Record<string, any>;
    static detectHeadless(sceneOrEngine?: any): boolean;
    static applySettings(settings: any): boolean;
    static setPreset(presetName: string, transitionDuration?: number): boolean;
    static setDlssMode(mode: string): any;
    static setRtxMode(mode: string): any;
    applySettings(settings: any): boolean;
    setPreset(presetName: string, transitionDuration?: number): boolean;
    enableSsao(enabled?: boolean, options?: any): this;
    enableSsr(enabled?: boolean, options?: any): this;
    enableSharpen(enabled?: boolean, options?: any): this;
    setDlssMode(mode: string): this;
    getDlssMode(): string;
    getRenderScale(): number;
    setRtxMode(mode: string): this;
    getRtxMode(): string;
    getRtxStatus(): { rtxMode: string; ssao: boolean; ssr: boolean; dlssMode: string; scale: number };
    update(dt: number): void;
    dispose(): void;
    [key: string]: any;
}

declare class ArcPerformanceOverlayCore {
    initialized: boolean;
    visible: boolean;
    isExpanded: boolean;
    fps: number;
    avgFps: number;
    frameTimeMs: number;
    onePercentLow: number;
    init(bEngine?: any, arcEngine?: any, options?: any): this;
    toggle(): boolean;
    show(): void;
    hide(): void;
    isVisible(): boolean;
    update(dt: number, force?: boolean): void;
    getTelemetry(): any;
    dispose(): void;
    [key: string]: any;
}

declare const ArcPerformanceOverlay: ArcPerformanceOverlayCore;

declare namespace globalThis {
    var ArcEventBus: any;
    var ArcStateMachine: any;
    var Blackboard: any;
    var BTStatus: any;
    var BTNode: any;
    var BTSequence: any;
    var BTSelector: any;
    var BTAction: any;
    var BTCondition: any;
    var BTInverter: any;
    var BTRepeater: any;
    var createAIPreset: any;
    var ArcEngine: any;
    var ArcEngineCore: any;
    var ArcPerformanceOverlay: any;
    var ArcPerformanceOverlayCore: any;
}

interface SceneGraphOptions {
    maxDistance?: number;
    origin?: number[];
    tags?: string[];
    includeMeshes?: boolean;
    [key: string]: any;
}

interface ActorQuery {
    tag?: string;
    tagsAll?: string[];
    tagsAny?: string[];
    hasComponent?: string;
    name?: string;
    /** `point` may be an array [x,y,z] or an object {x,y,z}; the query code handles both. */
    withinRadius?: { point: any; radius: number };
    [key: string]: any;
}

interface EngineMetrics {
    fps: number;
    frameTimeMs: number;
    drawCalls: number;
    activeMeshes: number;
    totalVertices: number;
    activeVoices: number;
    actorCount: number;
    spatialGridCells: number;
    [key: string]: any;
}

declare class ArcInspector {
    constructor(engine?: any);
    engine: any;
    init(engine: any): this;
    getSceneGraph(options?: SceneGraphOptions): any;
    findActors(query?: ActorQuery): ArcActor[];
    getMetrics(): EngineMetrics;
    sampleGround(x: number, y: number): { height: number; normal?: number[]; surface?: string; [key: string]: any };
    raycast(origin: number[], direction: number[], maxDistance?: number): { hit: boolean; distance: number; point: number[] | null; entity: any };
    explainState(): string;
    [key: string]: any;
}

declare class ArcEngineEventBus {
    on(event: string, handler: (...args: any[]) => void): this;
    once(event: string, handler: (...args: any[]) => void): this;
    off(event: string, handler: (...args: any[]) => void): this;
    emit(event: string, data?: any): void;
    clear(): void;
    [key: string]: any;
}

/** The full bus from js/engine/ArcEventBus.js (priority, wildcards, queue, history). */
declare class ArcEventBusCore {
    constructor(options?: any);
    on(event: string, fn: Function, options?: any): { unsubscribe: () => boolean };
    once(event: string, fn: Function, options?: any): { unsubscribe: () => boolean };
    off(event: string, fn?: Function): boolean;
    emit(event: string, data?: any): number;
    enqueue(event: string, data?: any): void;
    flush(): number;
    clear(): void;
    getHistory(count?: number): any[];
    getStats(): any;
    listenerCount(event?: string): number;
    channel(name: string): ArcEventBusCore;
    [key: string]: any;
}

declare class ArcEngineCore {
    bEngine: any;
    scene: any;
    camera: any;
    spatial: ArcSpatialGrid;
    actors: Map<string, ArcActor>;
    graphics: ArcPostProcess | null;
    ai: ArcInspector;
    events: ArcEngineEventBus | ArcEventBusCore;
    audio: {
        core: any;
        voices: VoiceManager | null;
        synth: any;
        [key: string]: any;
    };
    weather: any;
    lighting: any;
    jobs: ArcJobSystemCore | null;
    player: ArcActor | null;
    time: {
        dt: number;
        elapsed: number;
        timeScale: number;
        paused: boolean;
        pause(): void;
        resume(): void;
        setTimeScale(scale: number): void;
        [key: string]: any;
    };
    initialized: boolean;
    init(options?: any): this;
    createScene(config?: any): this;
    spawn(actorOrDef: any): ArcActor;
    destroy(actorOrId: string | ArcActor): boolean;
    update(rawDt: number): void;
    startLoop(): void;
    stopLoop(): void;
    getDiagnostics(): any;
    [key: string]: any;
}

declare class ArcJobSystemCore {
    workers: any[];
    workerCount: number;
    concurrency: number;
    initialized: boolean;
    stats: {
        dispatched: number;
        completed: number;
        failed: number;
        totalTimeMs: number;
        activeWorkers: number;
        concurrency: number;
        backend: 'workers' | 'sync';
    };
    init(options?: { threads?: number | 'auto', workerUrl?: string }): this;
    dispatch(type: string, payload: any, transferables?: any[]): Promise<any>;
    parallelFor<T, R>(items: T[], chunkSize: number, taskType: string, context?: any): Promise<R[]>;
    terminate(): void;
    getStats(): any;
    getTelemetry(): any;
}

declare const ArcJobSystem: ArcJobSystemCore;
type ArcJobSystem = ArcJobSystemCore;
declare const ArcJobWorker: any;

declare const ArcEngine: ArcEngineCore;
type ArcEngine = ArcEngineCore;

declare class NavGrid {
    width: number;
    height: number;
    cellSize: number;
    cols: number;
    rows: number;
    grid: Uint8Array;
    blockers: any[];
    constructor(bounds?: { width?: number, height?: number }, cellSize?: number);
    build(blockers?: Array<{ x: number, y: number, radius?: number }>, padding?: number): void;
    inBounds(col: number, row: number): boolean;
    isWalkable(x: number, y: number): boolean;
    gridToWorld(col: number, row: number): { x: number, y: number };
    findNearestWalkableCell(x: number, y: number, maxSearchRadius?: number): { col: number, row: number } | null;
    findPathAsync(start: { x: number, y: number }, goal: { x: number, y: number }, maxIterations?: number): Promise<Array<{ x: number, y: number }>>;
    findPath(start: { x: number, y: number }, goal: { x: number, y: number }, maxIterations?: number): Array<{ x: number, y: number }>;
    smoothPath(waypoints: Array<{ x: number, y: number }>): Array<{ x: number, y: number }>;
}


/**
 * OnlineBridge (js/OnlineBridge.js) — the only place where the authoritative server meets the
 * rendered game: it sends intent, applies snapshots and draws remote players. Game.js calls it
 * by name, so it needs a declaration here (invariant 8).
 */
declare var OnlineBridge: {
    SEND_HZ: number;
    POLL_HZ: number;
    INTERP: number;
    PEER_TIMEOUT_MS: number;
    enabled: boolean;
    error: string | null;
    lastTick: number;
    game: Game | null;
    client: RaidClient | null;
    peers: Map<string, any>;
    attach(game: any, client: any): any;
    detach(): void;
    active(): boolean;
    update(dt: number): void;
    sendIntent(): void;
    poll(): void;
    applySnapshot(snapshot: any): void;
    applyLocalPlayer(me: any): void;
    applyObjective(objective: any): void;
    applyEnemies(enemies: any[]): void;
    applyPeers(players: any[]): void;
    createPeer(player: any): any;
    interpolatePeers(dt: number): void;
    applyEvents(events: any[]): void;
    surrender(): Promise<any>;
    requestExtraction(): Promise<any>;
    /** Ask the server to search a loot crate; the result arrives asynchronously. */
    searchCrate(containerId: number): boolean;
    applySearchResult(message: any): void;
    applyPayout(payout: any): void;
    applyMatch(match: any): void;
    status(): { enabled: boolean; active: boolean; connected: boolean; lastTick: number; peers: number; error: string | null };
    [key: string]: any;
};

declare var RaidLayer: any;

/**
 * The Game class is a classic browser script; only the fields the bridge and the lobby touch
 * are declared here, so tsc can see them without a full model of the game.
 */
interface Game {
    phase: string;
    player: any;
    enemies: any[];
    keys: Set<string>;
    posture: string;
    lean: number;
    loot: number;
    raidTimer: number;
    extractState: string;
    /** Set by MenuSystem before deploy(); read by Game.reset() to attach OnlineBridge. */
    onlineClient: any;
    /** Last raid state and outcome received from the server. */
    onlineState?: string;
    onlineOutcome?: any;
    onlineSurrendered?: boolean;
    [key: string]: any;
}

/** RaidClient (js/RaidClient.js) — the browser transport for the online raid. */
interface RaidClient {
    id: string;
    token: string;
    account: any;
    world: any;
    seed: number | null;
    snapshot: any;
    /** Active WebSocket push transport, or null while polling over HTTP. */
    socket: any;
    /** 'ws' when snapshots are pushed, 'http' when they are polled. */
    transport: string;
    socketError: string | null;
    lastPushAt: number;
    /** Called for every pushed snapshot; the bridge reconciles from here. */
    onSnapshot: ((message: any) => void) | null;
    /** Called for pushed action replies (surrender, extract, errors). */
    onAction: ((message: any) => void) | null;
    isLive(): boolean;
    connectSocket(options?: any): Promise<boolean>;
    sendInputSocket(command: any): Promise<any>;
    sendActionSocket(type: string): Promise<any>;
    closeSocket(): void;
    [key: string]: any;
}

/**
 * RaidWorld (js/RaidWorld.js) — the authoritative map shared by the browser and the server:
 * bounds, blockers, terrain height, spawns and objectives. The bridge reads heightAt() to
 * predict the player's ground height locally, so it needs a declaration (invariant 8).
 */
declare var RaidWorld: {
    DEFAULTS: Record<string, number>;
    config(): any;
    heightAt(x: number, y: number): number;
    bounds(): { width: number; height: number };
    rng(seed: any): () => number;
    build(seed?: number): any;
    [key: string]: any;
};

/**
 * MenuSystem (js/MenuSystem.js) — the lobby, stash, traders, workshop and raid settlement.
 * Game.js and the online bridge call into it by name, so it is declared here rather than
 * modelled in full: only the surface the rest of the game touches.
 */
declare var MenuSystem: {
    currentScreen: string;
    loadout: any;
    backpack: any[];
    stash: any[];
    profile: any;
    selectedSector: any;
    onlineLobby: any;
    init(app: any, game: any): void;
    dispose(): void;
    setScreen(screen: string): void;
    startExpedition(): void;
    launchRaid(onlineRaid?: any): void;
    finishRaid(result: any): void;
    saveState(): void;
    refreshUI(): void;
    [key: string]: any;
};

/** LoadoutScreen (js/LoadoutScreen.js) — the pre-raid loadout and stash drag-and-drop screen.
 *  It is a CLASS: the menu constructs it, so it needs a construct signature. */
declare class LoadoutScreen {
    constructor(menu: any, game?: any);
    root: any;
    open(): void;
    close(): void;
    render(): void;
    [key: string]: any;
}

/**
 * Instances3D (js/Instances3D.js) — many copies of one mesh or model in one draw call per part
 * (Babylon thin instances). Created through World3D.addInstances; World3D.js names the class
 * directly, so it needs a declaration here (invariant 8).
 */
declare class Instances3D {
    constructor(view: any, source: any, kind: string, items: any[], opts?: any);
    view: any;
    root: any;
    dynamic: boolean;
    count: number;
    matrices: Float32Array;
    parts: any[];
    ok: boolean;
    static prepare(source: any): any[];
    static fill(out: Float32Array, i: number, item: any): void;
    setAll(items: any[]): void;
    set(i: number, item: any): void;
    flush(): void;
    dispose(): void;
}

/**
 * Editor documents. These are the editor's own models (they never ship in the game build), but
 * the editor is type checked by `_utils/editor/tsconfig.json`, which includes `*.js`, and its
 * panels refer to them by name — so they need declarations here (invariant 8).
 */

/** SceneDoc (_utils/editor/scene-doc.js) — a scene as a tree of nodes with undoable commands. */
declare var SceneDoc: {
    create(name?: string): any;
    makeNode(type: string, fields?: any): any;
    node(doc: any, id: string): any;
    children(doc: any, id: string): any[];
    walk(doc: any, id: string, out?: any[]): any[];
    all(doc: any): any[];
    path(doc: any, id: string): any[];
    isAncestor(doc: any, maybeAncestor: string, id: string): boolean;
    byType(doc: any, type: string): any[];
    find(doc: any, text: string): any[];
    worldTransform(doc: any, id: string): any;
    command(doc: any, label: string, mutate: () => void, key?: string): boolean;
    restore(doc: any, snapshot: string): boolean;
    add(doc: any, node: any, parentId?: string): any;
    remove(doc: any, id: string): boolean;
    reparent(doc: any, id: string, newParentId: string): boolean;
    rename(doc: any, id: string, name: string): boolean;
    setVisible(doc: any, id: string, visible: boolean): boolean;
    setTransform(doc: any, id: string, fields: any, key?: string): boolean;
    setPayload(doc: any, id: string, fields: any, key?: string): boolean;
    moveChild(doc: any, id: string, delta: number): boolean;
    toJSON(doc: any): any;
    fromJSON(data: any): any;
    markSaved(doc: any, source?: string): void;
    fromObjects(objects: any[], name?: string): any;
    toObjects(doc: any): any[];
    [key: string]: any;
};

/** ClipDoc (_utils/editor/clip-doc.js) — keyframed animation clips plus their quality checks. */
declare var ClipDoc: {
    EASES: string[];
    PATHS: string[];
    SPIKE_FACTOR: number;
    create(name?: string, fps?: number, duration?: number): any;
    trackId(target: string, path: string): string;
    track(clip: any, target: string, path: string): any;
    allTracks(clip: any): any[];
    command(clip: any, label: string, mutate: () => void, key?: string): boolean;
    restore(clip: any, snapshot: string): boolean;
    keyframe(clip: any, target: string, path: string, time: number, value: number, ease?: string): boolean;
    removeKey(clip: any, target: string, path: string, time: number): boolean;
    moveKey(clip: any, target: string, path: string, from: number, to: number): boolean;
    setEase(clip: any, target: string, path: string, time: number, ease: string, handles?: any): boolean;
    rename(clip: any, name: string): boolean;
    setDuration(clip: any, seconds: number): boolean;
    ease(ease: string, t: number, out?: number, into?: number): number;
    evaluate(clip: any, target: string, path: string, time: number): number | null;
    sample(clip: any, time: number): Record<string, number>;
    bake(clip: any, step?: number): Array<{ time: number, values: Record<string, number> }>;
    validate(clip: any): Array<{ level: string, code: string, track: string, time: number, message: string }>;
    isClean(clip: any): boolean;
    toJSON(clip: any): any;
    fromJSON(data: any): any;
    markSaved(clip: any): void;
    [key: string]: any;
};

/** ClipPlayer (_utils/editor/clip-doc.js) — pushes a clip onto a live node's transform. */
declare class ClipPlayer {
    constructor(clip: any, node: any, targets?: any);
    clip: any;
    node: any;
    targets: any;
    time: number;
    speed: number;
    playing: boolean;
    play(): this;
    pause(): this;
    stop(): this;
    update(dt: number): void;
    apply(): void;
    holderFor(target: string): any;
}

/** SceneView (_utils/editor/scene-view.js) — the editor viewport: grid, selection and gizmo. */
declare var SceneView: {
    ROOT_ID: string;
    GRID_SIZE: number;
    doc: any;
    location: any;
    camera: any;
    canvas: any;
    selection: string[];
    utility: any;
    grid: any;
    selectionBox: any;
    gizmo: any;
    gizmoMode: string;
    snapStep: number;
    gridVisible: boolean;
    onSelect: ((ids: string[]) => void) | null;
    onTransform: ((id: string) => void) | null;
    init(location: any, camera: any, canvas?: any): boolean;
    setDocument(doc: any): void;
    gridSize(): number;
    snapValue(value: number): number;
    snapTransform(fields: any): any;
    buildGrid(): void;
    buildSelectionBox(): void;
    setGridVisible(on: boolean): void;
    setGizmoMode(mode: string): boolean;
    meshOf(nodeId: string): any;
    select(nodeIds: any, additive?: boolean): string[];
    clearSelection(): string[];
    selectedNodes(): any[];
    focusSelected(): boolean;
    refresh(): void;
    refreshSelectionBox(): void;
    refreshGizmo(): void;
    dispose(): void;
    [key: string]: any;
};

/**
 * ProgressionSystem (js/ProgressionSystem.js) — learned skills, active bonuses and vendor
 * discounts, fed from the server. Loaded by index.html and used by OnlineLobby.
 */
declare var ProgressionSystem: {
    updateFromServer(prog: any): void;
    isSkillLearned(branchId: string, skillId: string): boolean;
    canLearnSkill(branchId: string, skillId: string): boolean;
    getActiveBonuses(): any;
    getVendorDiscount(vendorId: string): number;
    [key: string]: any;
};

/** HierarchyPanel (_utils/editor/hierarchy-panel.js) — the scene tree pane. */
declare var HierarchyPanel: {
    ROOT_ID: string;
    selectedId: string | null;
    hotkeys: boolean;
    onSelect: ((id: string | null) => void) | null;
    init(): boolean;
    render(doc: any): void;
    refresh(): void;
    select(id: string | null): void;
    flatten(doc: any, query?: string): any[];
    dropTarget(doc: any, dragId: string, targetId: string, where: string): any;
    applyDrop(doc: any, dragId: string, targetId: string, where: string): boolean;
    toggleExpanded(doc: any, id: string, expanded?: boolean): boolean;
    duplicateNode(doc: any, id: string): any;
    createNode(type: string, parentId?: string, name?: string): any;
    deleteSelected(): boolean;
    duplicateSelected(): boolean;
    renameSelected(): boolean;
    isTyping(el: any): boolean;
    [key: string]: any;
};

/** MenuBar (_utils/editor/menu-bar.js) — the File/Edit/Scene/GameObject/Window menu bar. */
declare var MenuBar: {
    ROOT_ID: string;
    COMMAND_EVENT: string;
    onCommand: ((id: string) => void) | null;
    init(): boolean;
    render(): void;
    buildModel(): any[];
    group(id: string): any;
    item(id: string): any;
    allItems(): any[];
    shortcutList(): any[];
    isEnabled(id: string): boolean;
    setEnabled(id: string, on: boolean): void;
    historyState(): any;
    commandFor(event: any): string | null;
    isTyping(el: any): boolean;
    run(id: string): boolean;
    open(id: string): void;
    close(): void;
    [key: string]: any;
};

/** AnimEditor (_utils/editor/anim-editor.js) — the animation timeline: curves, onion skin. */
declare var AnimEditor: {
    ROOT_ID: string;
    CURVE_HEIGHT: number;
    KEY_RADIUS: number;
    clip: any;
    selectedTrack: string;
    time: number;
    playing: boolean;
    onionSkin: boolean;
    onionFrames: number;
    zoom: number;
    findings: any[];
    onSeek: ((time: number) => void) | null;
    init(root?: any): boolean;
    setClip(clip: any): this;
    pixelsPerSecond(): number;
    frameToX(time: number): number;
    xToFrame(x: number): number;
    frameTime(frame: number): number;
    timeToFrame(time: number): number;
    snapTime(time: number): number;
    curvePoints(track: any, samples?: number): any[];
    keyPoint(track: any, key: any): any;
    trackIds(): string[];
    onionTimes(): any[];
    findingsFor(trackId: string): any[];
    revalidate(): any[];
    summary(): { error: number, warn: number, info: number };
    play(): this;
    pause(): this;
    update(dt: number): void;
    seek(time: number): number;
    stepFrame(delta: number): number;
    keyAll(node: any, paths?: string[]): number;
    keyAt(trackId: string, time: number): boolean;
    dispose(): void;
    [key: string]: any;
};

/** ConsolePane (_utils/editor/console-pane.js) — merges findings from every editor panel. */
declare var ConsolePane: {
    ROOT_ID: string;
    BADGE_ID: string;
    sources: Map<string, any[]>;
    logLines: any[];
    MAX_LINES: number;
    init(): boolean;
    setFindings(key: string, findings: any[]): void;
    log(level: string, text: string): void;
    clear(): void;
    all(): any[];
    summary(): { error: number, warn: number, info: number };
    render(): void;
    [key: string]: any;
};

/** EditorPanels (_utils/editor/editor-panels.js) — the DOM for the timeline, model and rig panels. */
declare var EditorPanels: {
    ROOT_ID: string;
    TABS_ID: string;
    active: string;
    host: any;
    node: any;
    modelRoot: any;
    init(): boolean;
    build(): void;
    show(name: string): boolean;
    hide(): void;
    toggle(name: string): boolean;
    refresh(): void;
    refreshAnim(): void;
    refreshModel(note?: string): void;
    refreshRig(): void;
    inspectSelected(): boolean;
    loadModel(path: string): boolean;
    loadRigFromScene(): boolean;
    applyRig(): number;
    [key: string]: any;
};

/** ModelEditor (_utils/editor/model-editor.js) — inspects a GLB/FBX: meshes, skeleton, clips. */
declare var ModelEditor: {
    ROOT_ID: string;
    MAX_BONE_DEPTH: number;
    root: any;
    clips: any;
    report: any;
    meshInfo(mesh: any): any;
    skeletonInfo(bones: any[]): any;
    clipInfo(name: string, group: any): any;
    analyse(parts: any[], bones: any[], clips: any[]): any;
    validate(meshes: any[], skeleton: any, clips: any[]): any[];
    isClean(report: any): boolean;
    summary(report: any): { error: number, warn: number, info: number };
    inspect(root: any, clips?: any): any;
    toLines(report?: any): any[];
    dispose(): void;
    [key: string]: any;
};

/** RigEditor (_utils/editor/rig-editor.js) — the bone hierarchy and the rig quality checks. */
declare var RigEditor: {
    ROOT_ID: string;
    MAX_DEPTH: number;
    doc: any;
    selected: string;
    onSelect: ((name: string) => void) | null;
    create(name?: string): any;
    setDocument(doc: any): this;
    bone(name: string): any;
    children(name: string): any[];
    flatten(): any[];
    path(name: string): string[];
    isAncestor(maybeAncestor: string, name: string): boolean;
    depthOf(name: string): number;
    command(label: string, mutate: () => void, key?: string): boolean;
    restore(snapshot: string): boolean;
    addBone(name: string, parent?: string, position?: any): any;
    removeBone(name: string): boolean;
    reparent(name: string, newParent: string): boolean;
    renameBone(name: string, nextName: string): boolean;
    setPosition(name: string, position: any): boolean;
    validate(): any[];
    isClean(): boolean;
    applyTo(skeleton: any): number;
    toJSON(): any;
    fromJSON(data: any): any;
    markSaved(): void;
    dispose(): void;
    [key: string]: any;
};
