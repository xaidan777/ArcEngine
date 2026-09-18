
declare namespace BABYLON {
    /** Pure barrel — re-exports only side-effect-free modules */




    /**
     * Registers the async plugin factories for all built-in loaders.
     * Loaders will be dynamically imported on demand, only when a SceneLoader load operation needs each respective loader.
     */
    export function registerBuiltInLoaders(): void;










    var GLTF2Legacy: typeof GLTF2;












    /** Pure barrel — re-exports only side-effect-free modules */




    /**
     * Configuration for glTF validation
     */
    export interface IGLTFValidationConfiguration {
        /**
         * The url of the glTF validator.
         */
        url: string;
    }
    /**
     * glTF validation
     */
    export class GLTFValidation {
        /**
         * The configuration. Defaults to `{ url: "https://cdn.babylonjs.com/gltf_validator.js" }`.
         */
        static Configuration: IGLTFValidationConfiguration;
        private static _LoadScriptPromise;
        /**
         * The most recent validation results.
         * @internal - Used for back-compat in Sandbox with Inspector V2.
         */
        static _LastResults: Nullable<GLTF2.IGLTFValidationResults>;
        /**
         * Validate a glTF asset using the glTF-Validator.
         * @param data The JSON of a glTF or the array buffer of a binary glTF
         * @param rootUrl The root url for the glTF
         * @param fileName The file name for the glTF
         * @param getExternalResource The callback to get external resources for the glTF validator
         * @returns A promise that resolves with the glTF validation results once complete
         */
        static ValidateAsync(data: string | Uint8Array, rootUrl: string, fileName: string, getExternalResource: (uri: string) => Promise<Uint8Array>): Promise<GLTF2.IGLTFValidationResults>;
    }


        interface SceneLoaderPluginOptions {
            /**
             * Defines options for the glTF loader.
             */
            [GLTFFileLoaderMetadata.name]: Partial<GLTFLoaderOptions>;
        }


    /**
     * Defines options for glTF loader extensions. This interface is extended by specific extensions.
     */
    export interface GLTFLoaderExtensionOptions extends Record<string, Record<string, unknown> | undefined> {
    }
    /**
     * Mode that determines the coordinate system to use.
     */
    export enum GLTFLoaderCoordinateSystemMode {
        /**
         * Automatically convert the glTF right-handed data to the appropriate system based on the current coordinate system mode of the scene.
         */
        AUTO = 0,
        /**
         * Sets the useRightHandedSystem flag on the scene.
         */
        FORCE_RIGHT_HANDED = 1
    }
    /**
     * Mode that determines what animations will start.
     */
    export enum GLTFLoaderAnimationStartMode {
        /**
         * No animation will start.
         */
        NONE = 0,
        /**
         * The first animation will start.
         */
        FIRST = 1,
        /**
         * All animations will start.
         */
        ALL = 2
    }
    /**
     * Interface that contains the data for the glTF asset.
     */
    export interface IGLTFLoaderData {
        /**
         * The object that represents the glTF JSON.
         */
        json: object;
        /**
         * The BIN chunk of a binary glTF.
         */
        bin: Nullable<IDataBuffer>;
    }
    /**
     * Interface for extending the loader.
     */
    export interface IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name: string;
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines the order of this extension.
         * The loader sorts the extensions using these values when loading.
         */
        order?: number;
    }
    /**
     * Loader state.
     */
    export enum GLTFLoaderState {
        /**
         * The asset is loading.
         */
        LOADING = 0,
        /**
         * The asset is ready for rendering.
         */
        READY = 1,
        /**
         * The asset is completely loaded.
         */
        COMPLETE = 2
    }
    /** @internal */
    export interface IGLTFLoader extends IDisposable {
        importMeshAsync: (meshesNames: string | readonly string[] | null | undefined, scene: Scene, container: Nullable<AssetContainer>, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string) => Promise<ISceneLoaderAsyncResult>;
        loadAsync: (scene: Scene, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string) => Promise<void>;
    }
    /**
     * Adds default/implicit options to extension specific options.
     */
    type DefaultExtensionOptions<BaseExtensionOptions> = {
        /**
         * Defines if the extension is enabled
         */
        enabled?: boolean;
    } & BaseExtensionOptions;
    /**
     * This class contains all the concrete (not abstract) glTF options, excluding callbacks.
     * The purpose of this class is to make it easy to provide a way to mutate the default
     * loader options (see the GLTFLoaderDefaultOptions instance below) without duplicating
     * all the options in yet another object. Since this class is instantiated for the default
     * options object, abstract properties and callbacks are not included, it's more just
     * flag-type options.
     */
    class GLTFLoaderBaseOptions {
        /**
         * Defines if the loader should always compute the bounding boxes of meshes and not use the min/max values from the position accessor. Defaults to false.
         */
        alwaysComputeBoundingBox: boolean;
        /**
         * Defines if the loader should always compute the nearest common ancestor of the skeleton joints instead of using `skin.skeleton`. Defaults to false.
         * Set this to true if loading assets with invalid `skin.skeleton` values.
         */
        alwaysComputeSkeletonRootNode: boolean;
        /**
         * The animation start mode. Defaults to FIRST.
         */
        animationStartMode: GLTFLoaderAnimationStartMode;
        /**
         * Defines if the loader should compile materials before raising the success callback. Defaults to false.
         */
        compileMaterials: boolean;
        /**
         * Defines if the loader should compile shadow generators before raising the success callback. Defaults to false.
         */
        compileShadowGenerators: boolean;
        /**
         * The coordinate system mode. Defaults to AUTO.
         */
        coordinateSystemMode: GLTFLoaderCoordinateSystemMode;
        /**
         * Defines if the loader should create instances when multiple glTF nodes point to the same glTF mesh. Defaults to true.
         */
        createInstances: boolean;
        /**
         * If true, load all materials defined in the file, even if not used by any mesh. Defaults to false.
         */
        loadAllMaterials: boolean;
        /**
         * Defines if the loader should load morph targets. Defaults to true.
         */
        loadMorphTargets: boolean;
        /**
         * When loading a mesh with morph targets, configure its MorphTargetManager so the morph shader is compiled
         * once for all targets (`numMaxInfluencers = numTargets`, `optimizeInfluencers = false`). This prevents the
         * shader from being recompiled (and the resulting one-frame visual glitch) when an animated morph target
         * influence passes through zero and the active influencer count changes.
         * Disable to restore the previous behavior, where only the currently active (non-zero) influencers drive the
         * shader. That is cheaper per frame for meshes with very large morph target counts, but recompiles the shader
         * during animation. Defaults to true.
         */
        useMaxMorphTargetInfluencers: boolean;
        /**
         * Defines if the loader should load node animations. Defaults to true.
         * NOTE: The animation of this node will still load if the node is also a joint of a skin and `loadSkins` is true.
         */
        loadNodeAnimations: boolean;
        /**
         * If true, load only the materials defined in the file. Defaults to false.
         */
        loadOnlyMaterials: boolean;
        /**
         * Defines if the loader should load skins. Defaults to true.
         */
        loadSkins: boolean;
        /**
         * If true, do not load any materials defined in the file. Defaults to false.
         */
        skipMaterials: boolean;
        /**
         * When loading glTF animations, which are defined in seconds, target them to this FPS. Defaults to 60.
         */
        targetFps: number;
        /**
         * Defines if the Alpha blended materials are only applied as coverage.
         * If false, (default) The luminance of each pixel will reduce its opacity to simulate the behaviour of most physical materials.
         * If true, no extra effects are applied to transparent pixels.
         */
        transparencyAsCoverage: boolean;
        /**
         * Defines if the loader should also compile materials with clip planes. Defaults to false.
         */
        useClipPlane: boolean;
        /**
         * If true, the loader will derive the name for Babylon textures from the glTF texture name, image name, or image url. Defaults to false.
         * Note that it is possible for multiple Babylon textures to share the same name when the Babylon textures load from the same glTF texture or image.
         */
        useGltfTextureNames: boolean;
        /**
         * Defines if the loader should use range requests when load binary glTF files from HTTP.
         * Enabling will disable offline support and glTF validator.
         * Defaults to false.
         */
        useRangeRequests: boolean;
        /**
         * If true, load the color (gamma encoded) textures into sRGB buffers (if supported by the GPU), which will yield more accurate results when sampling the texture. Defaults to true.
         */
        useSRGBBuffers: boolean;
        /**
         * Defines if the loader should validate the asset.
         */
        validate: boolean;
        /**
         * Load the glTF files using the OpenPBR material.
         * @experimental
         */
        useOpenPBR: boolean;
        /**
         * If true, the loader will not use the transmission helper when loading materials with transmission.
         */
        dontUseTransmissionHelper: boolean;
    }
    /**
     * The default GLTF loader options.
     * Override the properties of this object to globally change the default loader options.
     * To specify options for a specific load call, pass those options into the associated load function.
     */
    export var GLTFLoaderDefaultOptions: GLTFLoaderBaseOptions;
    /**
     * Base class for glTF loader options that supports copying values from a partial options object.
     */
    abstract class GLTFLoaderOptions extends GLTFLoaderBaseOptions {
        protected copyFrom(options?: Partial<Readonly<GLTFLoaderOptions>>): void;
        /**
         * Raised when the asset has been parsed
         */
        abstract onParsed?: ((loaderData: IGLTFLoaderData) => void) | undefined;
        /**
         * Defines if the loader should capture performance counters.
         */
        abstract capturePerformanceCounters: boolean;
        /**
         * Defines the node to use as the root of the hierarchy when loading the scene (default: undefined). If not defined, a root node will be automatically created.
         * You can also pass null if you don't want a root node to be created.
         */
        customRootNode?: Nullable<TransformNode>;
        /**
         * Defines options for glTF extensions.
         */
        extensionOptions: {
            [Extension in keyof GLTFLoaderExtensionOptions]?: {
                [Option in keyof DefaultExtensionOptions<GLTFLoaderExtensionOptions[Extension]>]: DefaultExtensionOptions<GLTFLoaderExtensionOptions[Extension]>[Option];
            };
        };
        /**
         * If true, enable logging for the loader. Defaults to false.
         */
        abstract loggingEnabled: boolean;
        /**
         * Callback raised when the loader creates a camera after parsing the glTF properties of the camera.
         */
        abstract onCameraLoaded?: (camera: Camera) => void;
        /**
         * Callback raised when the loader creates a material after parsing the glTF properties of the material.
         */
        abstract onMaterialLoaded?: (material: Material) => void;
        /**
         * Callback raised when the loader creates a mesh after parsing the glTF properties of the mesh.
         * Note that the callback is called as soon as the mesh object is created, meaning some data may not have been setup yet for this mesh (vertex data, morph targets, material, ...)
         */
        abstract onMeshLoaded?: (mesh: AbstractMesh) => void;
        /**
         * Callback raised when the loader creates a skin after parsing the glTF properties of the skin node.
         * @see https://doc.babylonjs.com/features/featuresDeepDive/importers/glTF/glTFSkinning#ignoring-the-transform-of-the-skinned-mesh
         */
        abstract onSkinLoaded?: (node: TransformNode, skinnedNode: TransformNode) => void;
        /**
         * Callback raised when the loader creates a texture after parsing the glTF properties of the texture.
         */
        abstract onTextureLoaded?: (texture: BaseTexture) => void;
        /**
         * Callback raised after the asset is validated.
         */
        abstract onValidated?: (results: GLTF2.IGLTFValidationResults) => void;
        /**
         * Function called before loading a URL referenced by the asset.
         * Setting this function allows parent-relative asset URIs and makes the callback responsible for URI safety.
         * @param url The URL referenced by the asset
         * @param rootUrl The root URL of the asset, if available
         * @returns A promise that resolves to the URL to load
         */
        preprocessUrlAsync: (url: string, rootUrl?: string) => Promise<string>;
    }
    /**
     * File loader for loading glTF files into a scene.
     */
    export class GLTFFileLoader extends GLTFLoaderOptions implements IDisposable, ISceneLoaderPluginAsync, ISceneLoaderPluginFactory {
        /** @internal */
        static _CreateGLTF1Loader: (parent: GLTFFileLoader) => IGLTFLoader;
        /** @internal */
        static _CreateGLTF2Loader: (parent: GLTFFileLoader) => IGLTFLoader;
        /**
         * Creates a new glTF file loader.
         * @param options The options for the loader
         */
        constructor(options?: Partial<Readonly<GLTFLoaderOptions>>);
        /** @internal */
        get _isPreprocessUrlAsyncSet(): boolean;
        /**
         * Raised when the asset has been parsed
         */
        onParsedObservable: Observable<IGLTFLoaderData>;
        private _onParsedObserver;
        /**
         * Raised when the asset has been parsed
         */
        set onParsed(callback: ((loaderData: IGLTFLoaderData) => void) | undefined);
        /**
         * Set this property to false to disable incremental loading which delays the loader from calling the success callback until after loading the meshes and shaders.
         * Textures always loads asynchronously. For example, the success callback can compute the bounding information of the loaded meshes when incremental loading is disabled.
         * Defaults to true.
         * @internal
         */
        static IncrementalLoading: boolean;
        /**
         * Set this property to true in order to work with homogeneous coordinates, available with some converters and exporters.
         * Defaults to false. See https://en.wikipedia.org/wiki/Homogeneous_coordinates.
         * @internal
         */
        static HomogeneousCoordinates: boolean;
        /**
         * Observable raised when the loader creates a mesh after parsing the glTF properties of the mesh.
         * Note that the observable is raised as soon as the mesh object is created, meaning some data may not have been setup yet for this mesh (vertex data, morph targets, material, ...)
         */
        readonly onMeshLoadedObservable: Observable<AbstractMesh>;
        private _onMeshLoadedObserver;
        /**
         * Callback raised when the loader creates a mesh after parsing the glTF properties of the mesh.
         * Note that the callback is called as soon as the mesh object is created, meaning some data may not have been setup yet for this mesh (vertex data, morph targets, material, ...)
         */
        set onMeshLoaded(callback: ((mesh: AbstractMesh) => void) | undefined);
        /**
         * Observable raised when the loader creates a skin after parsing the glTF properties of the skin node.
         * @see https://doc.babylonjs.com/features/featuresDeepDive/importers/glTF/glTFSkinning#ignoring-the-transform-of-the-skinned-mesh
         * @param node - the transform node that corresponds to the original glTF skin node used for animations
         * @param skinnedNode - the transform node that is the skinned mesh itself or the parent of the skinned meshes
         */
        readonly onSkinLoadedObservable: Observable<{
            node: TransformNode;
            skinnedNode: TransformNode;
        }>;
        private _onSkinLoadedObserver;
        /**
         * Callback raised when the loader creates a skin after parsing the glTF properties of the skin node.
         * @see https://doc.babylonjs.com/features/featuresDeepDive/importers/glTF/glTFSkinning#ignoring-the-transform-of-the-skinned-mesh
         */
        set onSkinLoaded(callback: ((node: TransformNode, skinnedNode: TransformNode) => void) | undefined);
        /**
         * Observable raised when the loader creates a texture after parsing the glTF properties of the texture.
         */
        readonly onTextureLoadedObservable: Observable<BaseTexture>;
        private _onTextureLoadedObserver;
        /**
         * Callback raised when the loader creates a texture after parsing the glTF properties of the texture.
         */
        set onTextureLoaded(callback: ((texture: BaseTexture) => void) | undefined);
        /**
         * Observable raised when the loader creates a material after parsing the glTF properties of the material.
         */
        readonly onMaterialLoadedObservable: Observable<Material>;
        private _onMaterialLoadedObserver;
        /**
         * Callback raised when the loader creates a material after parsing the glTF properties of the material.
         */
        set onMaterialLoaded(callback: ((material: Material) => void) | undefined);
        /**
         * Observable raised when the loader creates a camera after parsing the glTF properties of the camera.
         */
        readonly onCameraLoadedObservable: Observable<Camera>;
        private _onCameraLoadedObserver;
        /**
         * Callback raised when the loader creates a camera after parsing the glTF properties of the camera.
         */
        set onCameraLoaded(callback: ((camera: Camera) => void) | undefined);
        /**
         * Observable raised when the asset is completely loaded, immediately before the loader is disposed.
         * For assets with LODs, raised when all of the LODs are complete.
         * For assets without LODs, raised when the model is complete, immediately after the loader resolves the returned promise.
         */
        readonly onCompleteObservable: Observable<void>;
        private _onCompleteObserver;
        /**
         * Callback raised when the asset is completely loaded, immediately before the loader is disposed.
         * For assets with LODs, raised when all of the LODs are complete.
         * For assets without LODs, raised when the model is complete, immediately after the loader resolves the returned promise.
         */
        set onComplete(callback: () => void);
        /**
         * Observable raised when an error occurs.
         */
        readonly onErrorObservable: Observable<any>;
        private _onErrorObserver;
        /**
         * Callback raised when an error occurs.
         */
        set onError(callback: (reason: any) => void);
        /**
         * Observable raised after the loader is disposed.
         */
        readonly onDisposeObservable: Observable<void>;
        private _onDisposeObserver;
        /**
         * Callback raised after the loader is disposed.
         */
        set onDispose(callback: () => void);
        /**
         * Observable raised after a loader extension is created.
         * Set additional options for a loader extension in this event.
         */
        readonly onExtensionLoadedObservable: Observable<IGLTFLoaderExtension>;
        private _onExtensionLoadedObserver;
        /**
         * Callback raised after a loader extension is created.
         */
        set onExtensionLoaded(callback: (extension: IGLTFLoaderExtension) => void);
        /**
         * Defines if the loader logging is enabled.
         */
        get loggingEnabled(): boolean;
        set loggingEnabled(value: boolean);
        /**
         * Defines if the loader should capture performance counters.
         */
        get capturePerformanceCounters(): boolean;
        set capturePerformanceCounters(value: boolean);
        /**
         * Observable raised after validation when validate is set to true. The event data is the result of the validation.
         */
        readonly onValidatedObservable: Observable<GLTF2.IGLTFValidationResults>;
        private _onValidatedObserver;
        /**
         * Callback raised after the asset is validated.
         */
        set onValidated(callback: (results: GLTF2.IGLTFValidationResults) => void);
        private _loader;
        private _state;
        private _progressCallback?;
        private _requests;
        /**
         * Name of the loader ("gltf")
         */
        readonly name: "gltf";
        /** @internal */
        readonly extensions: {
            readonly ".gltf": {
                readonly isBinary: false;
                readonly mimeType: "model/gltf+json";
            };
            readonly ".glb": {
                readonly isBinary: true;
                readonly mimeType: "model/gltf-binary";
            };
        };
        /**
         * Disposes the loader, releases resources during load, and cancels any outstanding requests.
         */
        dispose(): void;
        /**
         * @internal
         */
        loadFile(scene: Scene, fileOrUrl: File | string | ArrayBufferView, rootUrl: string, onSuccess: (data: unknown, responseURL?: string) => void, onProgress?: (ev: ISceneLoaderProgressEvent) => void, useArrayBuffer?: boolean, onError?: (request?: WebRequest, exception?: LoadFileError) => void, name?: string): Nullable<IFileRequest>;
        private _loadBinary;
        /**
         * @internal
         */
        importMeshAsync(meshesNames: string | readonly string[] | null | undefined, scene: Scene, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string): Promise<ISceneLoaderAsyncResult>;
        /**
         * @internal
         */
        loadAsync(scene: Scene, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string): Promise<void>;
        /**
         * @internal
         */
        loadAssetContainerAsync(scene: Scene, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string): Promise<AssetContainer>;
        /**
         * @internal
         */
        canDirectLoad(data: string): boolean;
        /**
         * @internal
         */
        directLoad(scene: Scene, data: string): Promise<object>;
        /**
         * The callback that allows custom handling of the root url based on the response url.
         * @param rootUrl the original root url
         * @param responseURL the response url if available
         * @returns the new root url
         */
        rewriteRootURL?(rootUrl: string, responseURL?: string): string;
        /** @internal */
        createPlugin(options: SceneLoaderPluginOptions): ISceneLoaderPluginAsync;
        /**
         * The loader state or null if the loader is not active.
         */
        get loaderState(): Nullable<GLTFLoaderState>;
        /**
         * Observable raised when the loader state changes.
         */
        onLoaderStateChangedObservable: Observable<Nullable<GLTFLoaderState>>;
        /**
         * Returns a promise that resolves when the asset is completely loaded.
         * @returns a promise that resolves when the asset is completely loaded.
         */
        whenCompleteAsync(): Promise<void>;
        /**
         * @internal
         */
        _setState(state: GLTFLoaderState): void;
        /**
         * @internal
         */
        _loadFile(scene: Scene, fileOrUrl: File | string, onSuccess: (data: string | ArrayBuffer) => void, useArrayBuffer?: boolean, onError?: (request?: WebRequest) => void, onOpened?: (request: WebRequest) => void): IFileRequest;
        private _onProgress;
        private _validate;
        private _getLoader;
        private _parseJson;
        private _unpackBinaryAsync;
        private _unpackBinaryV1Async;
        private _unpackBinaryV2Async;
        private static _parseVersion;
        private static _compareVersion;
        private static readonly _logSpaces;
        private _logIndentLevel;
        private _loggingEnabled;
        /** @internal */
        _log: (message: string) => void;
        /**
         * @internal
         */
        _logOpen(message: string): void;
        /** @internal */
        _logClose(): void;
        private _logEnabled;
        private _logDisabled;
        private _capturePerformanceCounters;
        /** @internal */
        _startPerformanceCounter: (counterName: string) => void;
        /** @internal */
        _endPerformanceCounter: (counterName: string) => void;
        private _startPerformanceCounterEnabled;
        private _startPerformanceCounterDisabled;
        private _endPerformanceCounterEnabled;
        private _endPerformanceCounterDisabled;
    }
    /**
     * Registers the GLTFFileLoader scene loader plugin.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterGLTFFileLoader(): void;


    export const GLTFMagicBase64Encoded = "Z2xURg";
    export var GLTFFileLoaderMetadata: {
        readonly name: "gltf";
        readonly extensions: {
            readonly ".gltf": {
                readonly isBinary: false;
                readonly mimeType: "model/gltf+json";
            };
            readonly ".glb": {
                readonly isBinary: true;
                readonly mimeType: "model/gltf-binary";
            };
        };
        readonly canDirectLoad: (data: string) => boolean;
    };


    /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./glTFFileLoader.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON.GLTF2 {
        /** Pure barrel — re-exports only side-effect-free modules */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
        /**
     * Material Loading Adapter for PBR materials that provides a unified OpenPBR-like interface.
     */
    export class PBRMaterialLoadingAdapter implements BABYLON.GLTF2.IMaterialLoadingAdapter {
        private _material;
        private _specWorkflow;
        /**
         * Creates a new instance of the PBRMaterialLoadingAdapter.
         * @param material - The PBR material to adapt.
         */
        constructor(material: Material);
        /**
         * Gets the underlying material
         */
        get material(): PBRMaterial;
        /**
         * No-op: PBRMaterial has no deferred finalization.
         * @param _loader Unused.
         */
        finalizeAsync(_loader: BABYLON.GLTF2.GLTFLoader): Promise<void>;
        /**
         * Whether the material should be treated as unlit
         */
        get isUnlit(): boolean;
        /**
         * Sets whether the material should be treated as unlit
         */
        set isUnlit(value: boolean);
        /**
         * Sets whether back face culling is enabled.
         * @param value True to enable back face culling
         */
        set backFaceCulling(value: boolean);
        /**
         * Gets whether back face culling is enabled.
         * @returns True if back face culling is enabled
         */
        get backFaceCulling(): boolean;
        /**
         * Sets whether two-sided lighting is enabled.
         * @param value True to enable two-sided lighting
         */
        set twoSidedLighting(value: boolean);
        /**
         * Gets whether two-sided lighting is enabled.
         * @returns True if two-sided lighting is enabled
         */
        get twoSidedLighting(): boolean;
        /**
         * Sets the alpha cutoff value for alpha testing.
         * @param value The alpha cutoff threshold (0-1)
         */
        set alphaCutOff(value: number);
        /**
         * Gets the alpha cutoff value.
         * @returns The alpha cutoff threshold (0-1)
         */
        get alphaCutOff(): number;
        /**
         * Sets whether to use alpha from the albedo texture.
         * @param value True to use alpha from albedo texture
         */
        set useAlphaFromBaseColorTexture(value: boolean);
        /**
         * Gets whether alpha is used from the albedo texture.
         * @returns True if using alpha from albedo texture
         */
        get useAlphaFromBaseColorTexture(): boolean;
        /**
         * Gets whether the transparency is treated as alpha coverage.
         */
        get transparencyAsAlphaCoverage(): boolean;
        /**
         * Sets/Gets whether the transparency is treated as alpha coverage
         */
        set transparencyAsAlphaCoverage(value: boolean);
        /**
         * Sets the base color of the material (mapped to PBR albedoColor).
         * @param value The base color as a Color3
         */
        set baseColor(value: Color3);
        /**
         * Gets the base color of the material.
         * @returns The base color as a Color3
         */
        get baseColor(): Color3;
        /**
         * Sets the base color texture of the material (mapped to PBR albedoTexture).
         * @param value The base color texture or null
         */
        set baseColorTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the base color texture of the material.
         * @returns The base color texture or null
         */
        get baseColorTexture(): Nullable<BaseTexture>;
        /**
         * Sets the base diffuse roughness of the material.
         * @param value The diffuse roughness value (0-1)
         */
        set baseDiffuseRoughness(value: number);
        /**
         * Gets the base diffuse roughness of the material.
         * @returns The diffuse roughness value (0-1), defaults to 0 if not set
         */
        get baseDiffuseRoughness(): number;
        /**
         * Sets the base diffuse roughness texture of the material.
         * @param value The diffuse roughness texture or null
         */
        set baseDiffuseRoughnessTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the base diffuse roughness texture of the material.
         * @returns The diffuse roughness texture or null
         */
        get baseDiffuseRoughnessTexture(): Nullable<BaseTexture>;
        /**
         * Sets the base metalness value of the material (mapped to PBR metallic).
         * @param value The metalness value (0-1)
         */
        set baseMetalness(value: number);
        /**
         * Gets the base metalness value of the material.
         * @returns The metalness value (0-1), defaults to 1 if not set
         */
        get baseMetalness(): number;
        /**
         * Sets the base metalness texture of the material (mapped to PBR metallicTexture).
         * @param value The metalness texture or null
         */
        set baseMetalnessTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the base metalness texture of the material.
         * @returns The metalness texture or null
         */
        get baseMetalnessTexture(): Nullable<BaseTexture>;
        /**
         * Sets whether to use roughness from the metallic texture's green channel.
         * Also disables using roughness from the alpha channel when enabled.
         * @param value True to use green channel for roughness
         */
        set useRoughnessFromMetallicTextureGreen(value: boolean);
        /**
         * Sets whether to use metalness from the metallic texture's blue channel.
         * @param value True to use blue channel for metalness
         */
        set useMetallicFromMetallicTextureBlue(value: boolean);
        /**
         * Configures specular properties and optionally enables OpenPBR BRDF model for edge color support.
         * @param enableEdgeColor Whether to enable OpenPBR BRDF models for edge color support
         */
        enableSpecularEdgeColor(enableEdgeColor?: boolean): void;
        /**
         * Enable the specular/glossiness workflow and disable metallic/roughness.
         */
        configureSpecularGlossiness(): void;
        /**
         * Sets the specular weight (mapped to PBR metallicF0Factor).
         * @param value The specular weight value
         */
        set specularWeight(value: number);
        /**
         * Gets the specular weight.
         * @returns The specular weight value, defaults to 1 if not set
         */
        get specularWeight(): number;
        /**
         * Sets the specular weight texture (mapped to PBR metallicReflectanceTexture).
         * Configures the material to use only metalness from this texture when set.
         * @param value The specular weight texture or null
         */
        set specularWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the specular weight texture.
         * @returns The specular weight texture or null
         */
        get specularWeightTexture(): Nullable<BaseTexture>;
        /**
         * Sets the specular color (mapped to PBR metallicReflectanceColor).
         * @param value The specular color as a Color3
         */
        set specularColor(value: Color3);
        /**
         * Gets the specular color.
         * @returns The specular color as a Color3
         */
        get specularColor(): Color3;
        /**
         * Sets the specular color texture (mapped to PBR reflectanceTexture).
         * @param value The specular color texture or null
         */
        set specularColorTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the specular color texture.
         * @returns The specular color texture or null
         */
        get specularColorTexture(): Nullable<BaseTexture>;
        /**
         * Sets the specular roughness (mapped to PBR roughness).
         * @param value The roughness value (0-1)
         */
        set specularRoughness(value: number);
        /**
         * Gets the specular roughness.
         * @returns The roughness value (0-1), defaults to 1 if not set
         */
        get specularRoughness(): number;
        /**
         * Sets the specular roughness texture.
         * Note: PBR uses the same texture for both metallic and roughness,
         * so this only sets the texture if no base metalness texture exists.
         * @param value The roughness texture or null
         */
        set specularRoughnessTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the specular roughness texture.
         * @returns The roughness texture (same as metallic texture for PBR) or null
         */
        get specularRoughnessTexture(): Nullable<BaseTexture>;
        /**
         * Sets the specular index of refraction (mapped to PBR indexOfRefraction).
         * @param value The IOR value
         */
        set specularIor(value: number);
        /**
         * Gets the specular index of refraction.
         * @returns The IOR value
         */
        get specularIor(): number;
        /**
         * Sets/gets the glossiness (inverted roughness)
         * ONLY used for specular/glossiness workflow; has no effect when metallic/roughness workflow is active
         */
        get glossiness(): number;
        /**
         * Sets/gets the glossiness (inverted roughness)
         * ONLY used for specular/glossiness workflow; has no effect when metallic/roughness workflow is active
         */
        set glossiness(value: number);
        /**
         * Sets the emission color (mapped to PBR emissiveColor).
         * @param value The emission color as a Color3
         */
        set emissionColor(value: Color3);
        /**
         * Gets the emission color.
         * @returns The emission color as a Color3
         */
        get emissionColor(): Color3;
        /**
         * Sets the emission luminance/intensity (mapped to PBR emissiveIntensity).
         * @param value The emission intensity value
         */
        set emissionLuminance(value: number);
        /**
         * Gets the emission luminance/intensity.
         * @returns The emission intensity value
         */
        get emissionLuminance(): number;
        /**
         * Sets the emission color texture (mapped to PBR emissiveTexture).
         * @param value The emission texture or null
         */
        set emissionColorTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the emission color texture.
         * @returns The emission texture or null
         */
        get emissionColorTexture(): Nullable<BaseTexture>;
        /**
         * Sets the ambient occlusion texture (mapped to PBR ambientTexture).
         * Automatically enables grayscale mode when set.
         * @param value The ambient occlusion texture or null
         */
        set ambientOcclusionTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the ambient occlusion texture.
         * @returns The ambient occlusion texture or null
         */
        get ambientOcclusionTexture(): Nullable<BaseTexture>;
        /**
         * Sets the ambient occlusion texture strength.
         * @param value The strength value (typically 0-1)
         */
        set ambientOcclusionTextureStrength(value: number);
        /**
         * Gets the ambient occlusion texture strength.
         * @returns The strength value, defaults to 1.0 if not set
         */
        get ambientOcclusionTextureStrength(): number;
        /**
         * Configures clear coat for PBR material.
         * Enables clear coat and sets up proper configuration.
         */
        configureCoat(): void;
        /**
         * Sets the coat weight (mapped to PBR clearCoat.intensity).
         * Automatically enables clear coat.
         * @param value The coat weight value (0-1)
         */
        set coatWeight(value: number);
        /**
         * Gets the coat weight.
         * @returns The coat weight value
         */
        get coatWeight(): number;
        /**
         * Sets the coat weight texture (mapped to PBR clearCoat.texture).
         * Automatically enables clear coat.
         * @param value The coat weight texture or null
         */
        set coatWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the coat weight texture.
         * @returns The coat weight texture or null
         */
        get coatWeightTexture(): Nullable<BaseTexture>;
        /**
         * Sets the coat color (mapped to PBR clearCoat.tintColor).
         * @param value The coat tint color as a Color3
         */
        set coatColor(value: Color3);
        /**
         * Sets the coat color texture (mapped to PBR clearCoat.tintTexture).
         * @param value The coat color texture or null
         */
        set coatColorTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the coat roughness (mapped to PBR clearCoat.roughness).
         * Automatically enables clear coat.
         * @param value The coat roughness value (0-1)
         */
        set coatRoughness(value: number);
        /**
         * Gets the coat roughness.
         * @returns The coat roughness value, defaults to 0 if not set
         */
        get coatRoughness(): number;
        /**
         * Sets the coat roughness texture (mapped to PBR clearCoat.textureRoughness).
         * Automatically enables clear coat and disables using roughness from main texture.
         * @param value The coat roughness texture or null
         */
        set coatRoughnessTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the coat roughness texture.
         * @returns The coat roughness texture or null
         */
        get coatRoughnessTexture(): Nullable<BaseTexture>;
        /**
         * Sets the coat index of refraction (IOR).
         */
        set coatIor(value: number);
        /**
         * Sets the coat darkening value.
         * Note: PBR doesn't have a direct coat darkening property, so this is a no-op.
         * @param value The coat darkening value (ignored for PBR)
         */
        set coatDarkening(value: number);
        /**
         * Sets the coat darkening texture
         * @param value The coat darkening texture or null
         */
        set coatDarkeningTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the coat roughness anisotropy.
         * Note: PBR clearCoat doesn't support anisotropy yet, so this is a placeholder.
         * @param value The coat anisotropy intensity value (currently ignored)
         */
        set coatRoughnessAnisotropy(value: number);
        /**
         * Gets the coat roughness anisotropy.
         * Note: PBR clearCoat doesn't support anisotropy yet, so this returns 0.
         * @returns Currently returns 0 as clearCoat anisotropy is not yet available
         */
        get coatRoughnessAnisotropy(): number;
        /**
         * Sets the coat tangent angle for anisotropy.
         * Note: PBR clearCoat doesn't support anisotropy yet, so this is a placeholder.
         * @param value The coat anisotropy rotation angle in radians (currently ignored)
         */
        set geometryCoatTangentAngle(value: number);
        /**
         * Sets the coat tangent texture for anisotropy.
         * Note: PBR clearCoat doesn't support anisotropy textures yet, so this is a placeholder.
         * @param value The coat anisotropy texture (currently ignored)
         */
        set geometryCoatTangentTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the coat tangent texture for anisotropy.
         * Note: PBR clearCoat doesn't support anisotropy textures yet, so this returns null.
         * @returns Currently returns null as clearCoat anisotropy is not yet available
         */
        get geometryCoatTangentTexture(): Nullable<BaseTexture>;
        /**
         * Sets the transmission weight (mapped to PBR subSurface.refractionIntensity).
         * Enables refraction when value \> 0.
         * @param value The transmission weight value (0-1)
         */
        set transmissionWeight(value: number);
        /**
         * Gets the transmission weight.
         * @returns The transmission weight value
         */
        get transmissionWeight(): number;
        /**
         * Sets the transmission weight texture (mapped to PBR subSurface.refractionIntensityTexture).
         * Automatically enables refraction and glTF-style textures.
         * @param value The transmission weight texture or null
         */
        set transmissionWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the attenuation distance for volume.
         * @param value The attenuation distance value
         */
        set transmissionDepth(value: number);
        /**
         * Gets the attenuation distance for volume.
         * @returns The attenuation distance value
         */
        get transmissionDepth(): number;
        /**
         * Sets the attenuation color (mapped to PBR subSurface.tintColor).
         * @param value The attenuation color as a Color3
         */
        set transmissionColor(value: Color3);
        /**
         * Sets the attenuation color (mapped to PBR subSurface.tintColor).
         * @returns The attenuation color as a Color3
         */
        get transmissionColor(): Color3;
        /**
         * Sets the transmission scatter coefficient.
         * @param value The scatter coefficient as a Color3
         */
        set transmissionScatter(value: Color3);
        /**
         * Sets the transmission scatter coefficient.
         * @returns The scatter coefficient as a Color3
         */
        get transmissionScatter(): Color3;
        set transmissionScatterTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the transmission scattering anisotropy.
         * @param value The anisotropy intensity value (-1 to 1)
         */
        set transmissionScatterAnisotropy(value: number);
        /**
         * Sets the transmission dispersion Abbe number.
         * @param value The Abbe number value
         */
        set transmissionDispersionAbbeNumber(value: number);
        /**
         * Sets the transmission dispersion scale.
         * @param value The dispersion scale value
         */
        set transmissionDispersionScale(value: number);
        /**
         * Gets the refraction background texture
         * @returns The refraction background texture or null
         */
        get refractionBackgroundTexture(): Nullable<BaseTexture>;
        /**
         * Sets the refraction background texture
         * @param value The refraction background texture or null
         */
        set refractionBackgroundTexture(value: Nullable<BaseTexture>);
        /**
         * Configures transmission for thin-surface transmission (KHR_materials_transmission).
         * Sets up the material for proper thin-surface transmission behavior.
         */
        configureTransmission(): void;
        /**
         * Configures volume properties for PBR material. Nothing to do for PBRMaterial.
         */
        configureVolume(): void;
        /**
         * Sets whether the material is thin-walled (i.e. non-volumetric) or not.
         */
        set geometryThinWalled(value: boolean);
        /**
         * Gets whether the material is thin-walled (i.e. non-volumetric) or not.
         */
        get geometryThinWalled(): boolean;
        /**
         * Sets the thickness texture (mapped to PBR subSurface.thicknessTexture).
         * Automatically enables refraction.
         * @param value The thickness texture or null
         */
        set volumeThicknessTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the thickness factor (mapped to PBR subSurface.maximumThickness).
         * Automatically enables refraction.
         * @param value The thickness value
         */
        set volumeThickness(value: number);
        /**
         * Configures subsurface properties for PBR material
         */
        configureSubsurface(): void;
        /**
         * Sets the subsurface weight
         */
        set subsurfaceWeight(value: number);
        /**
         * Gets the subsurface weight
         * @returns The subsurface weight value
         */
        get subsurfaceWeight(): number;
        /**
         * Sets the subsurface weight texture
         */
        set subsurfaceWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the subsurface color.
         * @param value The subsurface tint color as a Color3
         */
        set subsurfaceColor(value: Color3);
        /**
         * Sets the subsurface color texture.
         * @param value The subsurface tint texture or null
         */
        set subsurfaceColorTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the surface tint of the material (when using subsurface scattering)
         */
        set diffuseTransmissionTint(value: Color3);
        /**
         * Gets the subsurface constant tint (when using subsurface scattering)
         * @returns The subsurface constant tint as a Color3
         */
        get diffuseTransmissionTint(): Color3;
        /**
         * Sets the subsurface constant tint texture (when using subsurface scattering)
         * @param value The subsurface constant tint texture or null
         */
        set diffuseTransmissionTintTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the subsurface radius (used for subsurface scattering)
         * subsurfaceRadiusScale * subsurfaceRadius gives the mean free path per color channel.
         * @returns The subsurface radius as a Color3
         */
        get subsurfaceRadius(): number;
        /**
         * Sets the subsurface radius (used for subsurface scattering)
         * subsurfaceRadiusScale * subsurfaceRadius gives the mean free path per color channel.
         * @param value The subsurface radius as a number
         */
        set subsurfaceRadius(value: number);
        /**
         * Gets the subsurface radius scale (used for subsurface scattering)
         * subsurfaceRadiusScale * subsurfaceRadius gives the mean free path per color channel.
         * @returns The subsurface radius scale as a Color3
         */
        get subsurfaceRadiusScale(): Color3;
        /**
         * Sets the subsurface radius scale (used for subsurface scattering)
         * subsurfaceRadiusScale * subsurfaceRadius gives the mean free path per color channel.
         * @param value The subsurface radius scale as a Color3
         */
        set subsurfaceRadiusScale(value: Color3);
        /**
         * Sets the subsurface scattering anisotropy.
         * Note: PBRMaterial does not have a direct equivalent, so this is a no-op.
         * @param value The anisotropy intensity value (ignored for PBR)
         */
        set subsurfaceScatterAnisotropy(value: number);
        /**
         * Does this material have a translucent surface (i.e. either transmission or subsurface)?
         * @returns True if the material is translucent, false otherwise
         */
        isTranslucent(): boolean;
        /**
         * Configures sheen for PBR material.
         * Enables sheen and sets up proper configuration.
         */
        configureFuzz(): void;
        /**
         * Sets the sheen weight (mapped to PBR sheen.intensity).
         * Automatically enables sheen.
         * @param value The sheen weight value
         */
        set fuzzWeight(value: number);
        /**
         * Sets the fuzz weight texture.
         * @param value The fuzz weight texture or null
         */
        set fuzzWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the sheen color (mapped to PBR sheen.color).
         * Automatically enables sheen.
         * @param value The sheen color as a Color3
         */
        set fuzzColor(value: Color3);
        /**
         * Sets the sheen color texture (mapped to PBR sheen.texture).
         * Automatically enables sheen.
         * @param value The sheen color texture or null
         */
        set fuzzColorTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the sheen roughness (mapped to PBR sheen.roughness).
         * Automatically enables sheen.
         * @param value The sheen roughness value (0-1)
         */
        set fuzzRoughness(value: number);
        /**
         * Sets the sheen roughness texture (mapped to PBR sheen.textureRoughness).
         * Automatically enables sheen.
         * @param value The sheen roughness texture or null
         */
        set fuzzRoughnessTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the specular roughness anisotropy (mapped to PBR anisotropy.intensity).
         * Automatically enables anisotropy.
         * @param value The anisotropy intensity value
         */
        set specularRoughnessAnisotropy(value: number);
        /**
         * Gets the specular roughness anisotropy.
         * @returns The anisotropy intensity value
         */
        get specularRoughnessAnisotropy(): number;
        /**
         * Sets the anisotropy rotation (mapped to PBR anisotropy.angle).
         * Automatically enables anisotropy.
         * @param value The anisotropy rotation angle in radians
         */
        set geometryTangentAngle(value: number);
        /**
         * Sets the geometry tangent texture (mapped to PBR anisotropy.texture).
         * Automatically enables anisotropy.
         * @param value The anisotropy texture or null
         */
        set geometryTangentTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the geometry tangent texture.
         * @returns The anisotropy texture or null
         */
        get geometryTangentTexture(): Nullable<BaseTexture>;
        /**
         * Configures glTF-style anisotropy for the material.
         * Note: PBR materials don't need this configuration, so this is a no-op.
         * @param useGltfStyle Whether to use glTF-style anisotropy (ignored for PBR)
         */
        configureGltfStyleAnisotropy(useGltfStyle?: boolean): void;
        /**
         * Sets the iridescence weight (mapped to PBR iridescence.intensity).
         * Automatically enables iridescence.
         * @param value The iridescence intensity value
         */
        set thinFilmWeight(value: number);
        /**
         * Sets the iridescence IOR (mapped to PBR iridescence.indexOfRefraction).
         * @param value The iridescence IOR value
         */
        set thinFilmIor(value: number);
        /**
         * Sets the iridescence thickness minimum (mapped to PBR iridescence.minimumThickness).
         * @param value The minimum thickness value in nanometers
         */
        set thinFilmThicknessMinimum(value: number);
        /**
         * Sets the iridescence thickness maximum (mapped to PBR iridescence.maximumThickness).
         * @param value The maximum thickness value in nanometers
         */
        set thinFilmThicknessMaximum(value: number);
        /**
         * Sets the thin film weight texture (mapped to PBR iridescence.texture).
         * @param value The thin film weight texture or null
         */
        set thinFilmWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the iridescence thickness texture (mapped to PBR iridescence.thicknessTexture).
         * @param value The iridescence thickness texture or null
         */
        set thinFilmThicknessTexture(value: Nullable<BaseTexture>);
        /**
         * Sets whether the material is unlit.
         * @param value True to make the material unlit
         */
        set unlit(value: boolean);
        /**
         * Sets the geometry opacity (mapped to PBR alpha).
         * @param value The opacity value (0-1)
         */
        set geometryOpacity(value: number);
        /**
         * Gets the geometry opacity.
         * @returns The opacity value (0-1)
         */
        get geometryOpacity(): number;
        /**
         * Sets the geometry normal texture (mapped to PBR bumpTexture).
         * Also forces irradiance computation in fragment shader for better lighting.
         * @param value The normal texture or null
         */
        set geometryNormalTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the geometry normal texture.
         * @returns The normal texture or null
         */
        get geometryNormalTexture(): Nullable<BaseTexture>;
        /**
         * Sets the normal map inversions for the material.
         * @param invertX Whether to invert the normal map on the X axis
         * @param invertY Whether to invert the normal map on the Y axis
         */
        setNormalMapInversions(invertX: boolean, invertY: boolean): void;
        /**
         * Sets the geometry coat normal texture (mapped to PBR clearCoat.bumpTexture).
         * Automatically enables clear coat.
         * @param value The coat normal texture or null
         */
        set geometryCoatNormalTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the geometry coat normal texture.
         * @returns The coat normal texture or null
         */
        get geometryCoatNormalTexture(): Nullable<BaseTexture>;
        /**
         * Sets the geometry coat normal texture scale.
         * @param value The scale value for the coat normal texture
         */
        set geometryCoatNormalTextureScale(value: number);
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
        /**
     * Material Loading Adapter for OpenPBR materials that provides a unified OpenPBR-like interface.
     */
    export class OpenPBRMaterialLoadingAdapter implements BABYLON.GLTF2.IMaterialLoadingAdapter {
        private _material;
        private _specWorkflow;
        /**
         * Creates a new instance of the OpenPBRMaterialLoadingAdapter.
         * @param material - The OpenPBR material to adapt.
         */
        constructor(material: Material);
        /**
         * Gets the underlying material
         */
        get material(): OpenPBRMaterial;
        /**
         * Whether the material should be treated as unlit
         */
        get isUnlit(): boolean;
        /**
         * Sets whether the material should be treated as unlit
         */
        set isUnlit(value: boolean);
        /**
         * Sets whether back face culling is enabled.
         * @param value True to enable back face culling
         */
        set backFaceCulling(value: boolean);
        /**
         * Gets whether back face culling is enabled.
         * @returns True if back face culling is enabled
         */
        get backFaceCulling(): boolean;
        /**
         * Sets whether two-sided lighting is enabled.
         * @param value True to enable two-sided lighting
         */
        set twoSidedLighting(value: boolean);
        /**
         * Gets whether two-sided lighting is enabled.
         * @returns True if two-sided lighting is enabled
         */
        get twoSidedLighting(): boolean;
        /**
         * Sets the alpha cutoff value for alpha testing.
         * Note: OpenPBR doesn't have a direct equivalent, so this is a no-op.
         * @param value The alpha cutoff threshold (ignored for OpenPBR)
         */
        set alphaCutOff(value: number);
        /**
         * Gets the alpha cutoff value.
         * @returns Default value of 0.5 (OpenPBR doesn't support this directly)
         */
        get alphaCutOff(): number;
        /**
         * Sets whether to use alpha from the base color texture.
         * Note: OpenPBR handles this differently through the baseColorTexture alpha channel.
         * @param value True to use alpha from base color texture (handled automatically in OpenPBR)
         */
        set useAlphaFromBaseColorTexture(value: boolean);
        /**
         * Gets whether alpha is used from the base color texture.
         * @returns True if alpha is used from the base color texture
         */
        get useAlphaFromBaseColorTexture(): boolean;
        /**
         * Gets whether the transparency is treated as alpha coverage.
         */
        get transparencyAsAlphaCoverage(): boolean;
        /**
         * Sets/Gets whether the transparency is treated as alpha coverage
         */
        set transparencyAsAlphaCoverage(value: boolean);
        /**
         * Sets the base color of the OpenPBR material.
         * @param value The base color as a Color3
         */
        set baseColor(value: Color3);
        /**
         * Gets the base color of the OpenPBR material.
         * @returns The base color as a Color3
         */
        get baseColor(): Color3;
        /**
         * Sets the base color texture of the OpenPBR material.
         * @param value The base color texture or null
         */
        set baseColorTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the base color texture of the OpenPBR material.
         * @returns The base color texture or null
         */
        get baseColorTexture(): Nullable<BaseTexture>;
        /**
         * Sets the base diffuse roughness of the OpenPBR material.
         * @param value The diffuse roughness value (0-1)
         */
        set baseDiffuseRoughness(value: number);
        /**
         * Gets the base diffuse roughness of the OpenPBR material.
         * @returns The diffuse roughness value (0-1)
         */
        get baseDiffuseRoughness(): number;
        /**
         * Sets the base diffuse roughness texture of the OpenPBR material.
         * @param value The diffuse roughness texture or null
         */
        set baseDiffuseRoughnessTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the base diffuse roughness texture of the OpenPBR material.
         * @returns The diffuse roughness texture or null
         */
        get baseDiffuseRoughnessTexture(): Nullable<BaseTexture>;
        /**
         * Sets the base metalness value of the OpenPBR material.
         * @param value The metalness value (0-1)
         */
        set baseMetalness(value: number);
        /**
         * Gets the base metalness value of the OpenPBR material.
         * @returns The metalness value (0-1)
         */
        get baseMetalness(): number;
        /**
         * Sets the base metalness texture of the OpenPBR material.
         * @param value The metalness texture or null
         */
        set baseMetalnessTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the base metalness texture of the OpenPBR material.
         * @returns The metalness texture or null
         */
        get baseMetalnessTexture(): Nullable<BaseTexture>;
        /**
         * Sets whether to use roughness from the metallic texture's green channel.
         * @param value True to use green channel for roughness
         */
        set useRoughnessFromMetallicTextureGreen(value: boolean);
        /**
         * Sets whether to use metalness from the metallic texture's blue channel.
         * @param value True to use blue channel for metalness
         */
        set useMetallicFromMetallicTextureBlue(value: boolean);
        /**
         * Configures specular properties for OpenPBR material.
         * @param _enableEdgeColor Whether to enable edge color support (ignored for OpenPBR)
         */
        enableSpecularEdgeColor(_enableEdgeColor?: boolean): void;
        configureSpecularGlossiness(): void;
        /**
         * Sets the specular weight of the OpenPBR material.
         * @param value The specular weight value (0-1)
         */
        set specularWeight(value: number);
        /**
         * Gets the specular weight of the OpenPBR material.
         * @returns The specular weight value (0-1)
         */
        get specularWeight(): number;
        /**
         * Sets the specular weight texture of the OpenPBR material.
         * If the same texture is used for specular color, optimizes by using alpha channel for weight.
         * @param value The specular weight texture or null
         */
        set specularWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the specular weight texture of the OpenPBR material.
         * @returns The specular weight texture or null
         */
        get specularWeightTexture(): Nullable<BaseTexture>;
        /**
         * Sets the specular color of the OpenPBR material.
         * @param value The specular color as a Color3
         */
        set specularColor(value: Color3);
        /**
         * Gets the specular color of the OpenPBR material.
         * @returns The specular color as a Color3
         */
        get specularColor(): Color3;
        /**
         * Sets the specular color texture of the OpenPBR material.
         * If the same texture is used for specular weight, optimizes by using alpha channel for weight.
         * @param value The specular color texture or null
         */
        set specularColorTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the specular color texture of the OpenPBR material.
         * @returns The specular color texture or null
         */
        get specularColorTexture(): Nullable<BaseTexture>;
        /**
         * Sets the specular roughness of the OpenPBR material.
         * @param value The roughness value (0-1)
         */
        set specularRoughness(value: number);
        /**
         * Gets the specular roughness of the OpenPBR material.
         * @returns The roughness value (0-1)
         */
        get specularRoughness(): number;
        /**
         * Sets the specular roughness texture of the OpenPBR material.
         * @param value The roughness texture or null
         */
        set specularRoughnessTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the specular roughness texture of the OpenPBR material.
         * @returns The roughness texture or null
         */
        get specularRoughnessTexture(): Nullable<BaseTexture>;
        /**
         * Sets the specular index of refraction (IOR) of the OpenPBR material.
         * @param value The IOR value
         */
        set specularIor(value: number);
        /**
         * Gets the specular index of refraction (IOR) of the OpenPBR material.
         * @returns The IOR value
         */
        get specularIor(): number;
        /**
         * Sets the glossiness (inverted roughness) of the OpenPBR material.
         */
        set glossiness(value: number);
        get glossiness(): number;
        /**
         * Sets the emission color of the OpenPBR material.
         * @param value The emission color as a Color3
         */
        set emissionColor(value: Color3);
        /**
         * Gets the emission color of the OpenPBR material.
         * @returns The emission color as a Color3
         */
        get emissionColor(): Color3;
        /**
         * Sets the emission luminance of the OpenPBR material.
         * @param value The emission luminance value
         */
        set emissionLuminance(value: number);
        /**
         * Gets the emission luminance of the OpenPBR material.
         * @returns The emission luminance value
         */
        get emissionLuminance(): number;
        /**
         * Sets the emission color texture of the OpenPBR material.
         * @param value The emission texture or null
         */
        set emissionColorTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the emission color texture of the OpenPBR material.
         * @returns The emission texture or null
         */
        get emissionColorTexture(): Nullable<BaseTexture>;
        /**
         * Sets the ambient occlusion texture of the OpenPBR material.
         * @param value The ambient occlusion texture or null
         */
        set ambientOcclusionTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the ambient occlusion texture of the OpenPBR material.
         * @returns The ambient occlusion texture or null
         */
        get ambientOcclusionTexture(): Nullable<BaseTexture>;
        /**
         * Sets the ambient occlusion texture strength by modifying the texture's level.
         * @param value The strength value (typically 0-1)
         */
        set ambientOcclusionTextureStrength(value: number);
        /**
         * Gets the ambient occlusion texture strength from the texture's level property.
         * @returns The strength value, defaults to 1.0 if no texture or level is set
         */
        get ambientOcclusionTextureStrength(): number;
        /**
         * Configures coat parameters for OpenPBR material.
         * OpenPBR coat is already built-in, so no configuration is needed.
         */
        configureCoat(): void;
        /**
         * Sets the coat weight of the OpenPBR material.
         * @param value The coat weight value (0-1)
         */
        set coatWeight(value: number);
        /**
         * Gets the coat weight of the OpenPBR material.
         * @returns The coat weight value (0-1)
         */
        get coatWeight(): number;
        /**
         * Sets the coat weight texture of the OpenPBR material.
         * @param value The coat weight texture or null
         */
        set coatWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the coat weight texture of the OpenPBR material.
         * @returns The coat weight texture or null
         */
        get coatWeightTexture(): Nullable<BaseTexture>;
        /**
         * Sets the coat color of the OpenPBR material.
         * @param value The coat color as a Color3
         */
        set coatColor(value: Color3);
        /**
         * Gets the coat color of the OpenPBR material.
         */
        get coatColor(): Color3;
        /**
         * Sets the coat color texture of the OpenPBR material.
         * @param value The coat color texture or null
         */
        set coatColorTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the coat roughness of the OpenPBR material.
         * @param value The coat roughness value (0-1)
         */
        set coatRoughness(value: number);
        /**
         * Gets the coat roughness of the OpenPBR material.
         * @returns The coat roughness value (0-1)
         */
        get coatRoughness(): number;
        /**
         * Sets the coat roughness texture of the OpenPBR material.
         * @param value The coat roughness texture or null
         */
        set coatRoughnessTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the coat roughness texture of the OpenPBR material.
         * @returns The coat roughness texture or null
         */
        get coatRoughnessTexture(): Nullable<BaseTexture>;
        /**
         * Sets the coat index of refraction (IOR) of the OpenPBR material.
         */
        set coatIor(value: number);
        get coatIor(): number;
        /**
         * Sets the coat darkening value of the OpenPBR material.
         * @param value The coat darkening value
         */
        set coatDarkening(value: number);
        get coatDarkening(): number;
        /**
         * Sets the coat darkening texture (OpenPBR: coatDarkeningTexture, no PBR equivalent)
         */
        set coatDarkeningTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the coat roughness anisotropy.
         * TODO: Implementation pending OpenPBR coat anisotropy feature availability.
         * @param value The coat anisotropy intensity value
         */
        set coatRoughnessAnisotropy(value: number);
        /**
         * Gets the coat roughness anisotropy.
         * TODO: Implementation pending OpenPBR coat anisotropy feature availability.
         * @returns Currently returns 0 as coat anisotropy is not yet available
         */
        get coatRoughnessAnisotropy(): number;
        /**
         * Sets the coat tangent angle for anisotropy.
         * TODO: Implementation pending OpenPBR coat anisotropy feature availability.
         * @param value The coat anisotropy rotation angle in radians
         */
        set geometryCoatTangentAngle(value: number);
        /**
         * Sets the coat tangent texture for anisotropy.
         * TODO: Implementation pending OpenPBR coat anisotropy feature availability.
         * @param value The coat anisotropy texture or null
         */
        set geometryCoatTangentTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the coat tangent texture for anisotropy.
         * TODO: Implementation pending OpenPBR coat anisotropy feature availability.
         * @returns Currently returns null as coat anisotropy is not yet available
         */
        get geometryCoatTangentTexture(): Nullable<BaseTexture>;
        /**
         * Configures transmission for OpenPBR material.
         */
        configureTransmission(): void;
        /**
         * Sets the transmission weight.
         * @param value The transmission weight value (0-1)
         */
        set transmissionWeight(value: number);
        /**
         * Sets the transmission weight texture.
         * @param value The transmission weight texture or null
         */
        set transmissionWeightTexture(value: Nullable<BaseTexture>);
        get transmissionWeightTexture(): Nullable<BaseTexture>;
        /**
         * Gets the transmission weight.
         * @returns Currently returns 0 as transmission is not yet available
         */
        get transmissionWeight(): number;
        /**
         * Sets the transmission scatter coefficient.
         * @param value The scatter coefficient as a Vector3
         */
        set transmissionScatter(value: Color3);
        /**
         * Gets the transmission scatter coefficient.
         * @returns The scatter coefficient as a Vector3
         */
        get transmissionScatter(): Color3;
        /**
         * Sets the transmission scatter texture.
         * @param value The transmission scatter texture or null
         */
        set transmissionScatterTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the transmission scatter texture.
         * @returns The transmission scatter texture or null
         */
        get transmissionScatterTexture(): Nullable<BaseTexture>;
        /**
         * Sets the transmission scattering anisotropy.
         * @param value The anisotropy intensity value (-1 to 1)
         */
        set transmissionScatterAnisotropy(value: number);
        /**
         * Sets the transmission dispersion Abbe number.
         * @param value The Abbe number value
         */
        set transmissionDispersionAbbeNumber(value: number);
        /**
         * Sets the transmission dispersion scale.
         * @param value The dispersion scale value
         */
        set transmissionDispersionScale(value: number);
        /**
         * Sets the attenuation distance.
         * @param value The attenuation distance value
         */
        set transmissionDepth(value: number);
        /**
         * Gets the attenuation distance.
         */
        get transmissionDepth(): number;
        /**
         * Sets the attenuation color.
         * @param value The attenuation color as a Color3
         */
        set transmissionColor(value: Color3);
        /**
         * Gets the attenuation color.
         */
        get transmissionColor(): Color3;
        /**
         * Gets the refraction background texture
         * @returns The refraction background texture or null
         */
        get refractionBackgroundTexture(): Nullable<BaseTexture>;
        /**
         * Sets the refraction background texture
         * @param value The refraction background texture or null
         */
        set refractionBackgroundTexture(value: Nullable<BaseTexture>);
        /**
         * Configures volume properties for OpenPBR material.
         */
        configureVolume(): void;
        /**
         * Sets whether the material is thin-walled (i.e. non-volumetric) or not.
         */
        set geometryThinWalled(value: boolean);
        /**
         * Gets whether the material is thin-walled (i.e. non-volumetric) or not.
         */
        get geometryThinWalled(): boolean;
        /**
         * Sets the thickness texture.
         * @param value The thickness texture or null
         */
        set volumeThicknessTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the thickness factor.
         * @param value The thickness value
         */
        set volumeThickness(value: number);
        /**
         * Configures subsurface properties for PBR material
         */
        configureSubsurface(): void;
        /**
         * Sets the subsurface weight
         */
        set subsurfaceWeight(value: number);
        get subsurfaceWeight(): number;
        /**
         * Sets the subsurface weight texture
         */
        set subsurfaceWeightTexture(value: Nullable<BaseTexture>);
        get subsurfaceWeightTexture(): Nullable<BaseTexture>;
        /**
         * Sets the subsurface color.
         * @param value The subsurface tint color as a Color3
         */
        set subsurfaceColor(value: Color3);
        /**
         * Sets the subsurface color texture.
         * @param value The subsurface tint texture or null
         */
        set subsurfaceColorTexture(value: Nullable<BaseTexture>);
        private _diffuseTransmissionTint;
        private _diffuseTransmissionTintTexture;
        /**
         * Sets the diffuse transmission tint of the material
         */
        set diffuseTransmissionTint(value: Color3);
        /**
         * Gets the diffuse transmission tint of the material
         */
        get diffuseTransmissionTint(): Color3;
        /**
         * Sets the diffuse transmission tint texture of the material
         */
        set diffuseTransmissionTintTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the subsurface radius for subsurface scattering.
         * subsurfaceRadiusScale * subsurfaceRadius gives the mean free path per color channel.
         */
        get subsurfaceRadius(): number;
        /**
         * Sets the subsurface radius for subsurface scattering.
         * subsurfaceRadiusScale * subsurfaceRadius gives the mean free path per color channel.
         * @param value The subsurface radius value
         */
        set subsurfaceRadius(value: number);
        /**
         * Gets the subsurface radius scale for subsurface scattering.
         * subsurfaceRadiusScale * subsurfaceRadius gives the mean free path per color channel.
         */
        get subsurfaceRadiusScale(): Color3;
        /**
         * Sets the subsurface radius scale for subsurface scattering.
         * subsurfaceRadiusScale * subsurfaceRadius gives the mean free path per color channel.
         * @param value The subsurface radius scale as a Color3
         */
        set subsurfaceRadiusScale(value: Color3);
        /**
         * Sets the subsurface scattering anisotropy.
         * @param value The anisotropy intensity value
         */
        set subsurfaceScatterAnisotropy(value: number);
        /**
         * Does this material have a translucent surface (i.e. either transmission or subsurface)?
         * @returns True if the material is translucent, false otherwise
         */
        isTranslucent(): boolean;
        /**
         * Configures fuzz for OpenPBR.
         * Enables fuzz and sets up proper configuration.
         */
        configureFuzz(): void;
        /**
         * Sets the fuzz weight.
         * @param value The fuzz weight value
         */
        set fuzzWeight(value: number);
        /**
         * Sets the fuzz weight texture.
         * @param value The fuzz weight texture or null
         */
        set fuzzWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the fuzz color.
         * @param value The fuzz color as a Color3
         */
        set fuzzColor(value: Color3);
        /**
         * Sets the fuzz color texture.
         * @param value The fuzz color texture or null
         */
        set fuzzColorTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the fuzz roughness.
         * @param value The fuzz roughness value (0-1)
         */
        set fuzzRoughness(value: number);
        /**
         * Sets the fuzz roughness texture.
         * @param value The fuzz roughness texture or null
         */
        set fuzzRoughnessTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the specular roughness anisotropy of the OpenPBR material.
         * @param value The anisotropy intensity value
         */
        set specularRoughnessAnisotropy(value: number);
        /**
         * Gets the specular roughness anisotropy of the OpenPBR material.
         * @returns The anisotropy intensity value
         */
        get specularRoughnessAnisotropy(): number;
        /**
         * Sets the anisotropy rotation angle.
         * @param value The anisotropy rotation angle in radians
         */
        set geometryTangentAngle(value: number);
        /**
         * Sets the geometry tangent texture for anisotropy.
         * Automatically enables using anisotropy from the tangent texture.
         * @param value The anisotropy texture or null
         */
        set geometryTangentTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the geometry tangent texture for anisotropy.
         * @returns The anisotropy texture or null
         */
        get geometryTangentTexture(): Nullable<BaseTexture>;
        /**
         * Configures glTF-style anisotropy for the OpenPBR material.
         * @param useGltfStyle Whether to use glTF-style anisotropy
         */
        configureGltfStyleAnisotropy(useGltfStyle?: boolean): void;
        /**
         * Sets the thin film weight.
         * @param value The thin film weight value
         */
        set thinFilmWeight(value: number);
        /**
         * Sets the thin film IOR.
         * @param value The thin film IOR value
         */
        set thinFilmIor(value: number);
        /**
         * Sets the thin film thickness minimum.
         * @param value The minimum thickness value in nanometers
         */
        set thinFilmThicknessMinimum(value: number);
        /**
         * Sets the thin film thickness maximum.
         * @param value The maximum thickness value in nanometers
         */
        set thinFilmThicknessMaximum(value: number);
        /**
         * Sets the thin film weight texture.
         * @param value The thin film weight texture or null
         */
        set thinFilmWeightTexture(value: Nullable<BaseTexture>);
        /**
         * Sets the thin film thickness texture.
         * @param value The thin film thickness texture or null
         */
        set thinFilmThicknessTexture(value: Nullable<BaseTexture>);
        /**
         * Sets whether the OpenPBR material is unlit.
         * @param value True to make the material unlit
         */
        set unlit(value: boolean);
        /**
         * Sets the geometry opacity of the OpenPBR material.
         * @param value The opacity value (0-1)
         */
        set geometryOpacity(value: number);
        /**
         * Gets the geometry opacity of the OpenPBR material.
         * @returns The opacity value (0-1)
         */
        get geometryOpacity(): number;
        /**
         * Sets the geometry normal texture of the OpenPBR material.
         * @param value The normal texture or null
         */
        set geometryNormalTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the geometry normal texture of the OpenPBR material.
         * @returns The normal texture or null
         */
        get geometryNormalTexture(): Nullable<BaseTexture>;
        /**
         * Sets the normal map inversions for the OpenPBR material.
         * Note: OpenPBR may handle normal map inversions differently or may not need them.
         * @param invertX Whether to invert the normal map on the X axis (may be ignored)
         * @param invertY Whether to invert the normal map on the Y axis (may be ignored)
         */
        setNormalMapInversions(invertX: boolean, invertY: boolean): void;
        /**
         * Sets the geometry coat normal texture of the OpenPBR material.
         * @param value The coat normal texture or null
         */
        set geometryCoatNormalTexture(value: Nullable<BaseTexture>);
        /**
         * Gets the geometry coat normal texture of the OpenPBR material.
         * @returns The coat normal texture or null
         */
        get geometryCoatNormalTexture(): Nullable<BaseTexture>;
        /**
         * Sets the geometry coat normal texture scale.
         * @param value The scale value for the coat normal texture
         */
        set geometryCoatNormalTextureScale(value: number);
        /**
         * Finalizes material properties after all loading is complete.
         * @param loader The glTF loader; `loader._disposed` is polled between texture passes to bail early on dispose.
         */
        finalizeAsync(loader: BABYLON.GLTF2.GLTFLoader): Promise<void>;
        private copySurfaceToCoatAsync;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
        /**
     * Interface for material loading adapters that provides a unified OpenPBR-like interface
     * for both OpenPBR and PBR materials, eliminating conditional branches in extensions.
     */
    export interface IMaterialLoadingAdapter {
        /**
         * Gets the underlying material
         */
        readonly material: Material;
        /**
         * Finalizes material properties after all loading is complete.
         * May do async work (e.g. GPU texture processing); the returned Promise is tracked
         * by the loader and awaited before the COMPLETE state is reached, so callers can rely
         * on onCompleteObservable for fully processed materials.
         *
         * Implementations should check `loader._disposed` between awaits to bail out early
         * when the loader is disposed mid-flight.
         * @param loader The glTF loader driving the finalize step.
         */
        finalizeAsync(loader: BABYLON.GLTF2.GLTFLoader): Promise<void>;
        /**
         * Whether the material should be treated as unlit
         */
        isUnlit: boolean;
        /**
         * Sets/gets the back face culling
         */
        backFaceCulling: boolean;
        /**
         * Sets/gets the two sided lighting
         */
        twoSidedLighting: boolean;
        /**
         * Sets/gets the alpha cutoff value (used for alpha test mode)
         */
        alphaCutOff: number;
        /**
         * Sets/gets whether to use alpha from albedo/base color texture
         */
        useAlphaFromBaseColorTexture: boolean;
        /**
         * Sets/Gets whether the transparency is treated as alpha coverage
         */
        transparencyAsAlphaCoverage: boolean;
        /**
         * Sets/gets the base color
         */
        baseColor: Color3;
        /**
         * Sets/gets the base color texture
         */
        baseColorTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the base diffuse roughness
         */
        baseDiffuseRoughness: number;
        /**
         * Sets/gets the base diffuse roughness texture
         */
        baseDiffuseRoughnessTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the base metalness
         */
        baseMetalness: number;
        /**
         * Sets/gets the base metalness texture
         */
        baseMetalnessTexture: Nullable<BaseTexture>;
        /**
         * Sets whether to use roughness from metallic texture green channel
         */
        useRoughnessFromMetallicTextureGreen: boolean;
        /**
         * Sets whether to use metallic from metallic texture blue channel
         */
        useMetallicFromMetallicTextureBlue: boolean;
        /**
         * Configures specular properties and enables OpenPBR BRDF model for edge color support
         * @param enableEdgeColor - Whether to enable edge color support
         */
        enableSpecularEdgeColor(enableEdgeColor?: boolean): void;
        /**
         * Enable the specular/glossiness workflow and disable metallic/roughness.
         */
        configureSpecularGlossiness(): void;
        /**
         * Sets/gets the specular weight
         */
        specularWeight: number;
        /**
         * Sets/gets the specular weight texture
         */
        specularWeightTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the specular color
         */
        specularColor: Color3;
        /**
         * Sets/gets the specular color texture
         */
        specularColorTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the specular roughness
         */
        specularRoughness: number;
        /**
         * Sets/gets the specular roughness texture
         */
        specularRoughnessTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the specular IOR
         */
        specularIor: number;
        /**
         * Sets/gets the glossiness (inverted roughness)
         * ONLY used for specular/glossiness workflow; has no effect when metallic/roughness workflow is active
         */
        glossiness: number;
        /**
         * Sets/gets the emissive color
         */
        emissionColor: Color3;
        /**
         * Sets/gets the emissive luminance
         */
        emissionLuminance: number;
        /**
         * Sets/gets the emissive texture
         */
        emissionColorTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the ambient occlusion texture
         */
        ambientOcclusionTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the ambient occlusion texture strength/level
         */
        ambientOcclusionTextureStrength: number;
        /**
         * Configures clear coat for PBR material
         */
        configureCoat(): void;
        /**
         * Sets/gets the coat weight
         */
        coatWeight: number;
        /**
         * Sets/gets the coat weight texture
         */
        coatWeightTexture: Nullable<BaseTexture>;
        /**
         * Sets the coat color
         */
        coatColor: Color3;
        /**
         * Sets the coat color texture
         */
        coatColorTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the coat roughness
         */
        coatRoughness: number;
        /**
         * Sets/gets the coat roughness texture
         */
        coatRoughnessTexture: Nullable<BaseTexture>;
        /**
         * Sets the coat index of refraction (IOR)
         */
        coatIor: number;
        /**
         * Sets the coat darkening
         */
        coatDarkening: number;
        /**
         * Sets the coat darkening texture
         */
        coatDarkeningTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the coat roughness anisotropy
         */
        coatRoughnessAnisotropy: number;
        /**
         * Sets the coat tangent angle for anisotropy
         */
        geometryCoatTangentAngle: number;
        /**
         * Sets the coat tangent texture for anisotropy
         */
        geometryCoatTangentTexture: Nullable<BaseTexture>;
        /**
         * Sets the transmission weight
         */
        transmissionWeight: number;
        /**
         * Sets the transmission weight texture
         */
        transmissionWeightTexture: Nullable<BaseTexture>;
        /**
         * Sets the attenuation distance
         */
        transmissionDepth: number;
        /**
         * Sets the attenuation color
         */
        transmissionColor: Color3;
        /**
         * Sets the scattering coefficient
         */
        transmissionScatter: Color3;
        /**
         * Sets the transmission scatter texture
         */
        transmissionScatterTexture: Nullable<BaseTexture>;
        /**
         * Sets the scattering anisotropy (-1 to 1)
         */
        transmissionScatterAnisotropy: number;
        /**
         * Sets the dispersion Abbe number
         */
        transmissionDispersionAbbeNumber: number;
        /**
         * Sets the dispersion scale
         */
        transmissionDispersionScale: number;
        /**
         * The refraction background texture
         */
        refractionBackgroundTexture: Nullable<BaseTexture>;
        /**
         * Configures transmission for thin-surface transmission (KHR_materials_transmission)
         */
        configureTransmission(): void;
        /**
         * Configures volume properties for volumetric transmission (KHR_materials_volume)
         */
        configureVolume(): void;
        /**
         * Sets whether the material is thin-walled (i.e. non-volumetric) or not.
         */
        geometryThinWalled: boolean;
        /**
         * Sets the thickness texture
         */
        volumeThicknessTexture: Nullable<BaseTexture>;
        /**
         * Sets the thickness factor
         */
        volumeThickness: number;
        /**
         * Configures subsurface properties
         */
        configureSubsurface(): void;
        /**
         * Sets/gets the subsurface weight
         */
        subsurfaceWeight: number;
        /**
         * Sets/gets the subsurface weight texture
         */
        subsurfaceWeightTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the subsurface color
         */
        subsurfaceColor: Color3;
        /**
         * Sets/gets the subsurface color texture
         */
        subsurfaceColorTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the diffuse transmission tint of the material
         */
        diffuseTransmissionTint: Color3;
        /**
         * Sets/gets the diffuse transmission tint texture of the material
         */
        diffuseTransmissionTintTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the subsurface radius (used for subsurface scattering)
         */
        subsurfaceRadius: number;
        /**
         * Sets/gets the subsurface radius scale (used for subsurface scattering)
         */
        subsurfaceRadiusScale: Color3;
        /**
         * Sets/gets the subsurface scattering anisotropy
         */
        subsurfaceScatterAnisotropy: number;
        /**
         * Does this material have a translucent surface (i.e. either transmission or subsurface)?
         */
        isTranslucent(): boolean;
        /**
         * Configures initial settings for fuzz for material.
         */
        configureFuzz(): void;
        /**
         * Sets the fuzz weight
         */
        fuzzWeight: number;
        /**
         * Sets the fuzz weight texture
         */
        fuzzWeightTexture: Nullable<BaseTexture>;
        /**
         * Sets the fuzz color
         */
        fuzzColor: Color3;
        /**
         * Sets the fuzz color texture
         */
        fuzzColorTexture: Nullable<BaseTexture>;
        /**
         * Sets the fuzz roughness
         */
        fuzzRoughness: number;
        /**
         * Sets the fuzz roughness texture
         */
        fuzzRoughnessTexture: Nullable<BaseTexture>;
        /**
         * Sets/gets the specular roughness anisotropy
         */
        specularRoughnessAnisotropy: number;
        /**
         * Sets the anisotropy rotation
         */
        geometryTangentAngle: number;
        /**
         * Sets/gets the anisotropy texture
         */
        geometryTangentTexture: Nullable<BaseTexture>;
        /**
         * Configures glTF-style anisotropy for OpenPBR materials
         * @param useGltfStyle - Whether to use glTF-style anisotropy (default: true)
         */
        configureGltfStyleAnisotropy(useGltfStyle?: boolean): void;
        /**
         * Sets the thin film weight
         */
        thinFilmWeight: number;
        /**
         * Sets the thin film IOR
         */
        thinFilmIor: number;
        /**
         * Sets the thin film thickness minimum
         */
        thinFilmThicknessMinimum: number;
        /**
         * Sets the thin film thickness maximum
         */
        thinFilmThicknessMaximum: number;
        /**
         * Sets the thin film iridescence texture
         */
        thinFilmWeightTexture: Nullable<BaseTexture>;
        /**
         * Sets the thin film thickness texture
         */
        thinFilmThicknessTexture: Nullable<BaseTexture>;
        /**
         * Sets the unlit flag
         */
        unlit: boolean;
        /**
         * Sets/gets the geometry opacity
         */
        geometryOpacity: number;
        /**
         * Sets/gets the geometry normal texture
         */
        geometryNormalTexture: Nullable<BaseTexture>;
        /**
         * Sets the normal map inversions for PBR material only
         * @param invertX - Whether to invert the normal map on the X axis
         * @param invertY - Whether to invert the normal map on the Y axis
         */
        setNormalMapInversions(invertX: boolean, invertY: boolean): void;
        /**
         * Sets/gets the coat normal texture
         */
        geometryCoatNormalTexture: Nullable<BaseTexture>;
        /**
         * Sets the coat normal texture scale
         */
        geometryCoatNormalTextureScale: number;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
    


}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader {
        /**
     * Loader interface with an index field.
     */
    export interface IArrayItem {
        /**
         * The index of this item in the array.
         */
        index: number;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IAccessor extends GLTF2.IAccessor, IArrayItem {
        /** @internal */
        _data?: Promise<ArrayBufferView>;
        /** @internal */
        _babylonVertexBuffer?: {
            [kind: string]: Promise<VertexBuffer>;
        };
    }
    /**
     * Loader interface with additional members.
     */
    export interface IAnimationChannel extends GLTF2.IAnimationChannel, IArrayItem {
    }
    /** @internal */
    export interface _IAnimationSamplerData {
        /** @internal */
        input: Float32Array;
        /** @internal */
        interpolation: GLTF2.AnimationSamplerInterpolation;
        /** @internal */
        output: Float32Array;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IAnimationSampler extends GLTF2.IAnimationSampler, IArrayItem {
        /** @internal */
        _data?: Promise<_IAnimationSamplerData>;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IAnimation extends GLTF2.IAnimation, IArrayItem {
        /** @internal */
        channels: IAnimationChannel[];
        /** @internal */
        samplers: IAnimationSampler[];
        /** @internal */
        _babylonAnimationGroup?: AnimationGroup;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IBuffer extends GLTF2.IBuffer, IArrayItem {
        /** @internal */
        _data?: Promise<ArrayBufferView>;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IBufferView extends GLTF2.IBufferView, IArrayItem {
        /** @internal */
        _data?: Promise<ArrayBufferView>;
        /** @internal */
        _babylonBuffer?: Promise<Buffer>;
    }
    /**
     * Loader interface with additional members.
     */
    export interface ICamera extends GLTF2.ICamera, IArrayItem {
        /** @internal */
        _babylonCamera?: Camera;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IImage extends GLTF2.IImage, IArrayItem {
        /** @internal */
        _data?: Promise<ArrayBufferView>;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IMaterialNormalTextureInfo extends GLTF2.IMaterialNormalTextureInfo, ITextureInfo {
    }
    /**
     * Loader interface with additional members.
     */
    export interface IMaterialOcclusionTextureInfo extends GLTF2.IMaterialOcclusionTextureInfo, ITextureInfo {
    }
    /**
     * Loader interface with additional members.
     */
    export interface IMaterialPbrMetallicRoughness extends GLTF2.IMaterialPbrMetallicRoughness {
        /** @internal */
        baseColorTexture?: ITextureInfo;
        /** @internal */
        metallicRoughnessTexture?: ITextureInfo;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IMaterial extends GLTF2.IMaterial, IArrayItem {
        /** @internal */
        pbrMetallicRoughness?: IMaterialPbrMetallicRoughness;
        /** @internal */
        normalTexture?: IMaterialNormalTextureInfo;
        /** @internal */
        occlusionTexture?: IMaterialOcclusionTextureInfo;
        /** @internal */
        emissiveTexture?: ITextureInfo;
        /** @internal */
        _data?: {
            [babylonDrawMode: number]: {
                babylonMaterial: Material;
                babylonMeshes: AbstractMesh[];
                promise: Promise<void>;
            };
        };
    }
    /**
     * Loader interface with additional members.
     */
    export interface IMesh extends GLTF2.IMesh, IArrayItem {
        /** @internal */
        primitives: IMeshPrimitive[];
    }
    /**
     * Loader interface with additional members.
     */
    export interface IMeshPrimitive extends GLTF2.IMeshPrimitive, IArrayItem {
        /** @internal */
        _instanceData?: {
            babylonSourceMesh: Mesh;
            promise: Promise<any>;
        };
    }
    /**
     * Loader interface with additional members.
     */
    export interface INode extends GLTF2.INode, IArrayItem {
        /** @internal */
        parent?: INode;
        /** @internal */
        _babylonTransformNode?: TransformNode;
        /** @internal */
        _babylonTransformNodeForSkin?: TransformNode;
        /** @internal */
        _primitiveBabylonMeshes?: AbstractMesh[];
        /** @internal */
        _numMorphTargets?: number;
        /** @internal */
        _isJoint?: boolean;
    }
    /** @internal */
    export interface _ISamplerData {
        /** @internal */
        noMipMaps: boolean;
        /** @internal */
        samplingMode: number;
        /** @internal */
        wrapU: number;
        /** @internal */
        wrapV: number;
    }
    /**
     * Loader interface with additional members.
     */
    export interface ISampler extends GLTF2.ISampler, IArrayItem {
        /** @internal */
        _data?: _ISamplerData;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IScene extends GLTF2.IScene, IArrayItem {
    }
    /**
     * Loader interface with additional members.
     */
    export interface ISkin extends GLTF2.ISkin, IArrayItem {
        /** @internal */
        _data?: {
            babylonSkeleton: Skeleton;
            promise: Promise<void>;
        };
    }
    /**
     * Loader interface with additional members.
     */
    export interface ITexture extends GLTF2.ITexture, IArrayItem {
        /** @internal */
        _textureInfo: ITextureInfo;
    }
    /**
     * Loader interface with additional members.
     */
    export interface ITextureInfo extends GLTF2.ITextureInfo {
        /** false or undefined if the texture holds color data (true if data are roughness, normal, ...) */
        nonColorData?: boolean;
    }
    /**
     * Loader interface with additional members.
     */
    export interface IGLTF extends GLTF2.IGLTF {
        /** @internal */
        accessors?: IAccessor[];
        /** @internal */
        animations?: IAnimation[];
        /** @internal */
        buffers?: IBuffer[];
        /** @internal */
        bufferViews?: IBufferView[];
        /** @internal */
        cameras?: ICamera[];
        /** @internal */
        images?: IImage[];
        /** @internal */
        materials?: IMaterial[];
        /** @internal */
        meshes?: IMesh[];
        /** @internal */
        nodes?: INode[];
        /** @internal */
        samplers?: ISampler[];
        /** @internal */
        scenes?: IScene[];
        /** @internal */
        skins?: ISkin[];
        /** @internal */
        textures?: ITexture[];
    }
    /**
     * Loader interface with additional members.
     */
    /** @internal */
    export interface IKHRLightsPunctual_Light extends GLTF2.IKHRLightsPunctual_Light, IArrayItem {
        /** @hidden */
        _babylonLight?: Light;
    }
    /** @internal */
    export interface IEXTLightsIES_Light extends GLTF2.IEXTLightsIES_Light, IArrayItem {
        /** @hidden */
        _babylonLight?: Light;
    }
    /** @internal */
    export interface IEXTLightsArea_Light extends GLTF2.IEXTLightsArea_Light, IArrayItem {
        /** @hidden */
        _babylonLight?: Light;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
        interface IRegisteredGLTFExtension {
        isGLTFExtension: boolean;
        factory: GLTFExtensionFactory;
    }
    export type GLTFExtensionFactory = (loader: BABYLON.GLTF2.GLTFLoader) => BABYLON.GLTF2.IGLTFLoaderExtension | Promise<BABYLON.GLTF2.IGLTFLoaderExtension>;
    /**
     * All currently registered glTF 2.0 loader extensions.
     */
    export var registeredGLTFExtensions: ReadonlyMap<string, Readonly<IRegisteredGLTFExtension>>;
    /**
     * Registers a loader extension.
     * @param name The name of the loader extension.
     * @param isGLTFExtension If the loader extension is a glTF extension, then it will only be used for glTF files that use the corresponding glTF extension. Otherwise, it will be used for all loaded glTF files.
     * @param factory The factory function that creates the loader extension.
     */
    export function registerGLTFExtension(name: string, isGLTFExtension: boolean, factory: GLTFExtensionFactory): void;
    /**
     * Unregisters a loader extension.
     * @param name The name of the loader extension.
     * @returns A boolean indicating whether the extension has been unregistered
     */
    export function unregisterGLTFExtension(name: string): boolean;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
        /**
     * Interface for a glTF loader extension.
     */
    export interface IGLTFLoaderExtension extends BABYLON.IGLTFLoaderExtension, IDisposable {
        /**
         * Called after the loader state changes to LOADING.
         */
        onLoading?(): void;
        /**
         * Called after the loader state changes to READY.
         */
        onReady?(): void;
        /**
         * Define this method to modify the default behavior when loading scenes.
         * @param context The context when loading the asset
         * @param scene The glTF scene property
         * @returns A promise that resolves when the load is complete or null if not handled
         */
        loadSceneAsync?(context: string, scene: BABYLON.GLTF2.Loader.IScene): Nullable<Promise<void>>;
        /**
         * Define this method to modify the default behavior when loading nodes.
         * @param context The context when loading the asset
         * @param node The glTF node property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded Babylon transform node when the load is complete or null if not handled
         */
        loadNodeAsync?(context: string, node: BABYLON.GLTF2.Loader.INode, assign: (babylonMesh: TransformNode) => void): Nullable<Promise<TransformNode>>;
        /**
         * Define this method to modify the default behavior when loading cameras.
         * @param context The context when loading the asset
         * @param camera The glTF camera property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded Babylon camera when the load is complete or null if not handled
         */
        loadCameraAsync?(context: string, camera: BABYLON.GLTF2.Loader.ICamera, assign: (babylonCamera: Camera) => void): Nullable<Promise<Camera>>;
        /**
         * @internal
         * Define this method to modify the default behavior when loading vertex data for mesh primitives.
         * @param context The context when loading the asset
         * @param primitive The glTF mesh primitive property
         * @returns A promise that resolves with the loaded geometry when the load is complete or null if not handled
         */
        _loadVertexDataAsync?(context: string, primitive: BABYLON.GLTF2.Loader.IMeshPrimitive, babylonMesh: Mesh): Nullable<Promise<Geometry>>;
        /**
         * @internal
         * Define this method to modify the default behavior when loading data for mesh primitives.
         * @param context The context when loading the asset
         * @param name The mesh name when loading the asset
         * @param node The glTF node when loading the asset
         * @param mesh The glTF mesh when loading the asset
         * @param primitive The glTF mesh primitive property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded mesh when the load is complete or null if not handled
         */
        _loadMeshPrimitiveAsync?(context: string, name: string, node: BABYLON.GLTF2.Loader.INode, mesh: BABYLON.GLTF2.Loader.IMesh, primitive: BABYLON.GLTF2.Loader.IMeshPrimitive, assign: (babylonMesh: AbstractMesh) => void): Nullable<Promise<AbstractMesh>>;
        /**
         * @internal
         * Define this method to modify the default behavior when loading materials. Load material creates the material and then loads material properties.
         * @param context The context when loading the asset
         * @param material The glTF material property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded Babylon material when the load is complete or null if not handled
         */
        _loadMaterialAsync?(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMesh: Nullable<Mesh>, babylonDrawMode: number, assign: (babylonMaterial: Material) => void): Nullable<Promise<Material>>;
        /**
         * Define this method to modify the default behavior when creating materials.
         * @param context The context when loading the asset
         * @param material The glTF material property
         * @param babylonDrawMode The draw mode for the Babylon material
         * @returns The Babylon material or null if not handled
         */
        createMaterial?(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonDrawMode: number): Nullable<Material>;
        /**
         * Define this method to modify the default behavior when loading material properties.
         * @param context The context when loading the asset
         * @param material The glTF material property
         * @param babylonMaterial The Babylon material
         * @returns A promise that resolves when the load is complete or null if not handled
         */
        loadMaterialPropertiesAsync?(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        /**
         * Define this method to modify the default behavior when loading texture infos.
         * @param context The context when loading the asset
         * @param textureInfo The glTF texture info property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded Babylon texture when the load is complete or null if not handled
         */
        loadTextureInfoAsync?(context: string, textureInfo: BABYLON.GLTF2.Loader.ITextureInfo, assign: (babylonTexture: BaseTexture) => void): Nullable<Promise<BaseTexture>>;
        /**
         * @internal
         * Define this method to modify the default behavior when loading textures.
         * @param context The context when loading the asset
         * @param texture The glTF texture property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded Babylon texture when the load is complete or null if not handled
         */
        _loadTextureAsync?(context: string, texture: BABYLON.GLTF2.Loader.ITexture, assign: (babylonTexture: BaseTexture) => void): Nullable<Promise<BaseTexture>>;
        /**
         * Define this method to modify the default behavior when loading animations.
         * @param context The context when loading the asset
         * @param animation The glTF animation property
         * @returns A promise that resolves with the loaded Babylon animation group when the load is complete or null if not handled
         */
        loadAnimationAsync?(context: string, animation: BABYLON.GLTF2.Loader.IAnimation): Nullable<Promise<AnimationGroup>>;
        /**
         * @internal
         * Define this method to modify the default behvaior when loading animation channels.
         * @param context The context when loading the asset
         * @param animationContext The context of the animation when loading the asset
         * @param animation The glTF animation property
         * @param channel The glTF animation channel property
         * @param onLoad Called for each animation loaded
         * @returns A void promise that resolves when the load is complete or null if not handled
         */
        _loadAnimationChannelAsync?(context: string, animationContext: string, animation: BABYLON.GLTF2.Loader.IAnimation, channel: BABYLON.GLTF2.Loader.IAnimationChannel, onLoad: (babylonAnimatable: IAnimatable, babylonAnimation: Animation) => void): Nullable<Promise<void>>;
        /**
         * @internal
         * Define this method to modify the default behavior when loading skins.
         * @param context The context when loading the asset
         * @param node The glTF node property
         * @param skin The glTF skin property
         * @returns A promise that resolves when the load is complete or null if not handled
         */
        _loadSkinAsync?(context: string, node: BABYLON.GLTF2.Loader.INode, skin: BABYLON.GLTF2.Loader.ISkin): Nullable<Promise<void>>;
        /**
         * @internal
         * Define this method to modify the default behavior when loading uris.
         * @param context The context when loading the asset
         * @param property The glTF property associated with the uri
         * @param uri The uri to load
         * @returns A promise that resolves with the loaded data when the load is complete or null if not handled
         */
        _loadUriAsync?(context: string, property: BABYLON.GLTF2.IProperty, uri: string): Nullable<Promise<ArrayBufferView>>;
        /**
         * Define this method to modify the default behavior when loading buffer views.
         * @param context The context when loading the asset
         * @param bufferView The glTF buffer view property
         * @returns A promise that resolves with the loaded data when the load is complete or null if not handled
         */
        loadBufferViewAsync?(context: string, bufferView: BABYLON.GLTF2.Loader.IBufferView): Nullable<Promise<ArrayBufferView>>;
        /**
         * Define this method to modify the default behavior when loading buffers.
         * @param context The context when loading the asset
         * @param buffer The glTF buffer property
         * @param byteOffset The byte offset to load
         * @param byteLength The byte length to load
         * @returns A promise that resolves with the loaded data when the load is complete or null if not handled
         */
        loadBufferAsync?(context: string, buffer: BABYLON.GLTF2.Loader.IBuffer, byteOffset: number, byteLength: number): Nullable<Promise<ArrayBufferView>>;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
        /** This file must only contain pure code and pure imports */
    /** @internal */
    export type GetValueFn = (target: any, source: Float32Array, offset: number, scale: number) => any;
    /** @internal */
    export function getVector3(_target: any, source: Float32Array, offset: number, scale: number): Vector3;
    /** @internal */
    export function getQuaternion(_target: any, source: Float32Array, offset: number, scale: number): Quaternion;
    /** @internal */
    export function getWeights(target: BABYLON.GLTF2.Loader.INode, source: Float32Array, offset: number, scale: number): Array<number>;
    /** @internal */
    export abstract class AnimationPropertyInfo {
        readonly type: number;
        readonly name: string;
        readonly getValue: GetValueFn;
        readonly getStride: (target: any) => number;
        /** @internal */
        constructor(type: number, name: string, getValue: GetValueFn, getStride: (target: any) => number);
        protected _buildAnimation(name: string, fps: number, keys: any[]): Animation;
        /** @internal */
        abstract buildAnimations(target: any, name: string, fps: number, keys: any[]): {
            babylonAnimatable: IAnimatable;
            babylonAnimation: Animation;
        }[];
    }
    /** @internal */
    export class TransformNodeAnimationPropertyInfo extends AnimationPropertyInfo {
        /** @internal */
        buildAnimations(target: BABYLON.GLTF2.Loader.INode, name: string, fps: number, keys: any[]): {
            babylonAnimatable: IAnimatable;
            babylonAnimation: Animation;
        }[];
    }
    /** @internal */
    export class WeightAnimationPropertyInfo extends AnimationPropertyInfo {
        buildAnimations(target: BABYLON.GLTF2.Loader.INode, name: string, fps: number, keys: any[]): {
            babylonAnimatable: IAnimatable;
            babylonAnimation: Animation;
        }[];
    }
    /**
     * Registers the core glTF animation interpolation mappings.
     */
    export function RegisterGLTFLoaderAnimation(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
    


}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
        interface IWithMetadata {
        metadata: any;
        _internalMetadata: any;
    }
    /**
     * Helper class for working with arrays when loading the glTF asset
     */
    export class ArrayItem {
        /**
         * Gets an item from the given array.
         * @param context The context when loading the asset
         * @param array The array to get the item from
         * @param index The index to the array
         * @returns The array item
         */
        static Get<T>(context: string, array: ArrayLike<T> | undefined, index: number | undefined): T;
        /**
         * Gets an item from the given array or returns null if not available.
         * @param array The array to get the item from
         * @param index The index to the array
         * @returns The array item or null
         */
        static TryGet<T>(array: ArrayLike<T> | undefined, index: number | undefined): Nullable<T>;
        /**
         * Assign an `index` field to each item of the given array.
         * @param array The array of items
         */
        static Assign(array?: BABYLON.GLTF2.Loader.IArrayItem[]): void;
    }
    /** @internal */
    export interface IAnimationTargetInfo {
        /** @internal */
        target: unknown;
        /** @internal */
        properties: Array<BABYLON.GLTF2.AnimationPropertyInfo>;
    }
    /** @internal */
    export function LoadBoundingInfoFromPositionAccessor(accessor: BABYLON.GLTF2.Loader.IAccessor): Nullable<BoundingInfo>;
    type PBRMaterialImplementation = {
        materialClass: typeof Material;
        adapterClass: new (material: Material) => BABYLON.GLTF2.IMaterialLoadingAdapter;
    };
    /**
     * The glTF 2.0 loader
     */
    export class GLTFLoader implements IGLTFLoader {
        /** @internal */
        readonly _completePromises: Promise<unknown>[];
        /** @internal */
        _assetContainer: Nullable<AssetContainer>;
        /** Storage */
        _babylonLights: Light[];
        /** @internal */
        _disableInstancedMesh: number;
        /** @internal */
        _allMaterialsDirtyRequired: boolean;
        /** @internal */
        _skipStartAnimationStep: boolean;
        private readonly _parent;
        private readonly _extensions;
        /** @internal */
        _disposed: boolean;
        private _rootUrl;
        private _fileName;
        private _uniqueRootUrl;
        private _gltf;
        private _bin;
        private _babylonScene;
        private _rootBabylonMesh;
        private _defaultBabylonMaterialData;
        private readonly _postSceneLoadActions;
        private readonly _materialAdapterCache;
        private readonly _materialAdapters;
        /**
         * Loaded PBR material implementations, keyed by their identifier (e.g. "pbr", "openpbr").
         * Only populated after the load has started and only for the types actually needed by the asset.
         * Empty when PBR materials are disabled (skipMaterials).
         * @internal
         */
        readonly _pbrMaterialImpls: Map<string, Readonly<PBRMaterialImplementation>>;
        /**
         * Test if the given material is an instance of any PBR material type known to this loader.
         * @param material The material to test
         * @returns true if the material matches one of the loaded PBR implementations
         */
        isMatchingMaterialType(material: Nullable<Material>): boolean;
        /**
         * The default glTF sampler.
         */
        static readonly DefaultSampler: BABYLON.GLTF2.Loader.ISampler;
        /**
         * Registers a loader extension.
         * @param name The name of the loader extension.
         * @param factory The factory function that creates the loader extension.
         * @deprecated Please use registerGLTFExtension instead.
         */
        static RegisterExtension(name: string, factory: BABYLON.GLTF2.GLTFExtensionFactory): void;
        /**
         * Unregisters a loader extension.
         * @param name The name of the loader extension.
         * @returns A boolean indicating whether the extension has been unregistered
         * @deprecated Please use unregisterGLTFExtension instead.
         */
        static UnregisterExtension(name: string): boolean;
        /**
         * The object that represents the glTF JSON.
         */
        get gltf(): BABYLON.GLTF2.Loader.IGLTF;
        /**
         * The BIN chunk of a binary glTF.
         */
        get bin(): Nullable<IDataBuffer>;
        /**
         * The parent file loader.
         */
        get parent(): GLTFFileLoader;
        /**
         * The Babylon scene when loading the asset.
         */
        get babylonScene(): Scene;
        /**
         * The root Babylon node when loading the asset.
         */
        get rootBabylonMesh(): Nullable<TransformNode>;
        /**
         * The root url when loading the asset.
         */
        get rootUrl(): Nullable<string>;
        /**
         * @internal
         */
        constructor(parent: GLTFFileLoader);
        /**
         * Creates or gets a cached material loading adapter with dynamic imports
         * @param material The material to adapt
         * @returns Promise that resolves to the appropriate adapter
         * @internal
         */
        _getOrCreateMaterialAdapter(material: Material): BABYLON.GLTF2.IMaterialLoadingAdapter;
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        importMeshAsync(meshesNames: string | readonly string[] | null | undefined, scene: Scene, container: Nullable<AssetContainer>, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string): Promise<ISceneLoaderAsyncResult>;
        /**
         * @internal
         */
        loadAsync(scene: Scene, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string): Promise<void>;
        private _loadAsync;
        private _loadData;
        private _setupData;
        private _loadExtensionsAsync;
        private _createRootNode;
        /**
         * Loads a glTF scene.
         * @param context The context when loading the asset
         * @param scene The glTF scene property
         * @returns A promise that resolves when the load is complete
         */
        loadSceneAsync(context: string, scene: BABYLON.GLTF2.Loader.IScene): Promise<void>;
        private _forEachPrimitive;
        private _getGeometries;
        private _getMeshes;
        private _getTransformNodes;
        private _getSkeletons;
        private _getAnimationGroups;
        private _startAnimations;
        /**
         * Loads a glTF node.
         * @param context The context when loading the asset
         * @param node The glTF node property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded Babylon mesh when the load is complete
         */
        loadNodeAsync(context: string, node: BABYLON.GLTF2.Loader.INode, assign?: (babylonTransformNode: TransformNode) => void): Promise<TransformNode>;
        private _loadMeshAsync;
        /**
         * @internal Define this method to modify the default behavior when loading data for mesh primitives.
         * @param context The context when loading the asset
         * @param name The mesh name when loading the asset
         * @param node The glTF node when loading the asset
         * @param mesh The glTF mesh when loading the asset
         * @param primitive The glTF mesh primitive property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded mesh when the load is complete or null if not handled
         */
        _loadMeshPrimitiveAsync(context: string, name: string, node: BABYLON.GLTF2.Loader.INode, mesh: BABYLON.GLTF2.Loader.IMesh, primitive: BABYLON.GLTF2.Loader.IMeshPrimitive, assign: (babylonMesh: AbstractMesh) => void): Promise<AbstractMesh>;
        private _loadVertexDataAsync;
        private _createMorphTargets;
        private _loadMorphTargetsAsync;
        private _loadMorphTargetVertexDataAsync;
        private static _LoadTransform;
        private _loadSkinAsync;
        private _loadBones;
        private _findSkeletonRootNode;
        private _loadBone;
        private _loadSkinInverseBindMatricesDataAsync;
        private _updateBoneMatrices;
        private _getNodeMatrix;
        /**
         * Loads a glTF camera.
         * @param context The context when loading the asset
         * @param camera The glTF camera property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded Babylon camera when the load is complete
         */
        loadCameraAsync(context: string, camera: BABYLON.GLTF2.Loader.ICamera, assign?: (babylonCamera: Camera) => void): Promise<Camera>;
        private _loadAnimationsAsync;
        /**
         * Loads a glTF animation.
         * @param context The context when loading the asset
         * @param animation The glTF animation property
         * @returns A promise that resolves with the loaded Babylon animation group when the load is complete
         */
        loadAnimationAsync(context: string, animation: BABYLON.GLTF2.Loader.IAnimation): Promise<AnimationGroup>;
        /**
         * @hidden
         * Loads a glTF animation channel.
         * @param context The context when loading the asset
         * @param animationContext The context of the animation when loading the asset
         * @param animation The glTF animation property
         * @param channel The glTF animation channel property
         * @param onLoad Called for each animation loaded
         * @returns A void promise that resolves when the load is complete
         */
        _loadAnimationChannelAsync(context: string, animationContext: string, animation: BABYLON.GLTF2.Loader.IAnimation, channel: BABYLON.GLTF2.Loader.IAnimationChannel, onLoad: (babylonAnimatable: IAnimatable, babylonAnimation: Animation) => void): Promise<void>;
        /**
         * @hidden
         * Loads a glTF animation channel.
         * @param context The context when loading the asset
         * @param animationContext The context of the animation when loading the asset
         * @param animation The glTF animation property
         * @param channel The glTF animation channel property
         * @param targetInfo The glTF target and properties
         * @param onLoad Called for each animation loaded
         * @returns A void promise that resolves when the load is complete
         */
        _loadAnimationChannelFromTargetInfoAsync(context: string, animationContext: string, animation: BABYLON.GLTF2.Loader.IAnimation, channel: BABYLON.GLTF2.Loader.IAnimationChannel, targetInfo: IObjectInfo<IInterpolationPropertyInfo[]>, onLoad: (babylonAnimatable: IAnimatable, babylonAnimation: Animation) => void): Promise<void>;
        private _loadAnimationSamplerAsync;
        /**
         * Loads a glTF buffer.
         * @param context The context when loading the asset
         * @param buffer The glTF buffer property
         * @param byteOffset The byte offset to use
         * @param byteLength The byte length to use
         * @returns A promise that resolves with the loaded data when the load is complete
         */
        loadBufferAsync(context: string, buffer: BABYLON.GLTF2.Loader.IBuffer, byteOffset: number, byteLength: number): Promise<ArrayBufferView>;
        /**
         * Loads a glTF buffer view.
         * @param context The context when loading the asset
         * @param bufferView The glTF buffer view property
         * @returns A promise that resolves with the loaded data when the load is complete
         */
        loadBufferViewAsync(context: string, bufferView: BABYLON.GLTF2.Loader.IBufferView): Promise<ArrayBufferView>;
        private _loadAccessorAsync;
        /**
         * @internal
         */
        _loadFloatAccessorAsync(context: string, accessor: BABYLON.GLTF2.Loader.IAccessor): Promise<Float32Array>;
        /**
         * @internal
         */
        _loadIndicesAccessorAsync(context: string, accessor: BABYLON.GLTF2.Loader.IAccessor): Promise<IndicesArray>;
        /**
         * @internal
         */
        _loadVertexBufferViewAsync(bufferView: BABYLON.GLTF2.Loader.IBufferView): Promise<Buffer>;
        /**
         * @internal
         */
        _loadVertexAccessorAsync(context: string, accessor: BABYLON.GLTF2.Loader.IAccessor, kind: string): Promise<VertexBuffer>;
        private _loadMaterialMetallicRoughnessPropertiesAsync;
        /**
         * @internal
         */
        _loadMaterialAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMesh: Nullable<Mesh>, babylonDrawMode: number, assign?: (babylonMaterial: Material) => void): Promise<Material>;
        /**
         * Selects the appropriate PBR material implementation for a given glTF material.
         * Uses OpenPBR when the material carries a "KHR_materials_openpbr" extension or when
         * the loader-level `useOpenPBR` flag is set; falls back to standard PBR otherwise.
         * @param material The glTF material
         * @returns The matching loaded implementation
         */
        private _selectImplForGltfMaterial;
        /**
         * Returns the default PBR material implementation used when there is no per-material
         * selection context (e.g. when creating the built-in default material for primitives
         * that have no glTF material assigned).  Prefers OpenPBR when `useOpenPBR` is set.
         * @returns The default loaded implementation
         */
        private _getDefaultImpl;
        private _createDefaultMaterial;
        /**
         * Creates a Babylon material from a glTF material.
         * @param context The context when loading the asset
         * @param material The glTF material property
         * @param babylonDrawMode The draw mode for the Babylon material
         * @returns The Babylon material
         */
        createMaterial(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonDrawMode: number): Material;
        /**
         * Loads properties from a glTF material into a Babylon material.
         * @param context The context when loading the asset
         * @param material The glTF material property
         * @param babylonMaterial The Babylon material
         * @returns A promise that resolves when the load is complete
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Promise<void>;
        /**
         * Loads the normal, occlusion, and emissive properties from a glTF material into a Babylon material.
         * @param context The context when loading the asset
         * @param material The glTF material property
         * @param babylonMaterial The Babylon material
         * @returns A promise that resolves when the load is complete
         */
        loadMaterialBasePropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Promise<void>;
        /**
         * Loads the alpha properties from a glTF material into a Babylon material.
         * Must be called after the setting the albedo texture of the Babylon material when the material has an albedo texture.
         * @param context The context when loading the asset
         * @param material The glTF material property
         * @param babylonMaterial The Babylon material
         */
        loadMaterialAlphaProperties(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): void;
        /**
         * Loads a glTF texture info.
         * @param context The context when loading the asset
         * @param textureInfo The glTF texture info property
         * @param assign A function called synchronously after parsing the glTF properties
         * @returns A promise that resolves with the loaded Babylon texture when the load is complete
         */
        loadTextureInfoAsync(context: string, textureInfo: BABYLON.GLTF2.Loader.ITextureInfo, assign?: (babylonTexture: BaseTexture) => void): Promise<BaseTexture>;
        /**
         * @internal
         */
        _loadTextureAsync(context: string, texture: BABYLON.GLTF2.Loader.ITexture, assign?: (babylonTexture: BaseTexture) => void): Promise<BaseTexture>;
        /**
         * @internal
         */
        _createTextureAsync(context: string, sampler: BABYLON.GLTF2.Loader.ISampler, image: BABYLON.GLTF2.Loader.IImage, assign?: (babylonTexture: BaseTexture) => void, textureLoaderOptions?: unknown, useSRGBBuffer?: boolean): Promise<BaseTexture>;
        private _loadSampler;
        /**
         * Loads a glTF image.
         * @param context The context when loading the asset
         * @param image The glTF image property
         * @returns A promise that resolves with the loaded data when the load is complete
         */
        loadImageAsync(context: string, image: BABYLON.GLTF2.Loader.IImage): Promise<ArrayBufferView>;
        /**
         * Loads a glTF uri.
         * @param context The context when loading the asset
         * @param property The glTF property associated with the uri
         * @param uri The base64 or relative uri
         * @returns A promise that resolves with the loaded data when the load is complete
         */
        loadUriAsync(context: string, property: BABYLON.GLTF2.IProperty, uri: string): Promise<ArrayBufferView>;
        /**
         * Adds a JSON pointer to the _internalMetadata of the Babylon object at `<object>._internalMetadata.gltf.pointers`.
         * @param babylonObject the Babylon object with _internalMetadata
         * @param pointer the JSON pointer
         */
        static AddPointerMetadata(babylonObject: IWithMetadata, pointer: string): void;
        private static _GetTextureWrapMode;
        private static _GetTextureSamplingMode;
        private static _GetTypedArrayConstructor;
        private static _GetTypedArray;
        private static _GetNumComponents;
        private static _ValidateUri;
        /**
         * @internal
         */
        static _GetDrawMode(context: string, mode: number | undefined): number;
        private _compileMaterialsAsync;
        private _compileShadowGeneratorsAsync;
        private _forEachExtensions;
        private _applyExtensions;
        private _extensionsOnLoading;
        private _extensionsOnReady;
        private _extensionsLoadSceneAsync;
        private _extensionsLoadNodeAsync;
        private _extensionsLoadCameraAsync;
        private _extensionsLoadVertexDataAsync;
        private _extensionsLoadMeshPrimitiveAsync;
        private _extensionsLoadMaterialAsync;
        private _extensionsCreateMaterial;
        private _extensionsLoadMaterialPropertiesAsync;
        private _extensionsLoadTextureInfoAsync;
        private _extensionsLoadTextureAsync;
        private _extensionsLoadAnimationAsync;
        private _extensionsLoadAnimationChannelAsync;
        private _extensionsLoadSkinAsync;
        private _extensionsLoadUriAsync;
        private _extensionsLoadBufferViewAsync;
        private _extensionsLoadBufferAsync;
        /**
         * Helper method called by a loader extension to load an glTF extension.
         * @param context The context when loading the asset
         * @param property The glTF property to load the extension from
         * @param extensionName The name of the extension to load
         * @param actionAsync The action to run
         * @returns The promise returned by actionAsync or null if the extension does not exist
         */
        static LoadExtensionAsync<TExtension = unknown, TResult = void>(context: string, property: BABYLON.GLTF2.IProperty, extensionName: string, actionAsync: (extensionContext: string, extension: TExtension) => Nullable<Promise<TResult>>): Nullable<Promise<TResult>>;
        /**
         * Helper method called by a loader extension to load a glTF extra.
         * @param context The context when loading the asset
         * @param property The glTF property to load the extra from
         * @param extensionName The name of the extension to load
         * @param actionAsync The action to run
         * @returns The promise returned by actionAsync or null if the extra does not exist
         */
        static LoadExtraAsync<TExtra = unknown, TResult = void>(context: string, property: BABYLON.GLTF2.IProperty, extensionName: string, actionAsync: (extraContext: string, extra: TExtra) => Nullable<Promise<TResult>>): Nullable<Promise<TResult>>;
        /**
         * Checks for presence of an extension.
         * @param name The name of the extension to check
         * @returns A boolean indicating the presence of the given extension name in `extensionsUsed`
         */
        isExtensionUsed(name: string): boolean;
        /**
         * Increments the indentation level and logs a message.
         * @param message The message to log
         */
        logOpen(message: string): void;
        /**
         * Decrements the indentation level.
         */
        logClose(): void;
        /**
         * Logs a message
         * @param message The message to log
         */
        log(message: string): void;
        /**
         * Starts a performance counter.
         * @param counterName The name of the performance counter
         */
        startPerformanceCounter(counterName: string): void;
        /**
         * Ends a performance counter.
         * @param counterName The name of the performance counter
         */
        endPerformanceCounter(counterName: string): void;
    }
    /**
     * Registers the GLTF 2.0 loader factory on the GLTFFileLoader. Idempotent.
     * @internal
     */
    export function RegisterGLTF2Loader(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2 {
    


}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Describes a material class and its corresponding loading adapter.
     * Passed to TransmissionHelper so it can classify and interact with materials
     * independently of any specific loader instance.
     */
    export interface ITransmissionHelperMaterialImpl {
        /** The material class constructor */
        materialClass: typeof Material;
        /** The adapter class constructor */
        adapterClass: new (material: Material) => BABYLON.GLTF2.IMaterialLoadingAdapter;
    }
    /**
     * @internal
     */
    export interface ITransmissionHelperHolder {
        /** The transmission helper instance, if created on the scene */
        _transmissionHelper: TransmissionHelper | undefined;
    }
    /**
     * Options for the TransmissionHelper.
     */
    export interface ITransmissionHelperOptions {
        /**
         * The size of the render buffers (default: 1024)
         */
        renderSize: number;
        /**
         * The number of samples to use when generating the render target texture for opaque meshes (default: 4)
         */
        samples: number;
        /**
         * Scale to apply when selecting the LOD level to sample the refraction texture (default: 1)
         */
        lodGenerationScale: number;
        /**
         * Offset to apply when selecting the LOD level to sample the refraction texture (default: -4)
         */
        lodGenerationOffset: number;
        /**
         * Type of the refraction render target texture (default: TEXTURETYPE_HALF_FLOAT)
         */
        renderTargetTextureType: number;
        /**
         * Defines if the mipmaps for the refraction render target texture must be generated (default: true)
         */
        generateMipmaps: boolean;
        /**
         * Clear color of the opaque texture. If not provided, use the scene clear color (which will be converted to linear space).
         * If provided, should be in linear space
         */
        clearColor?: Color4;
    }
    /**
     * A class to handle setting up the rendering of opaque objects to be shown through transmissive objects.
     * @internal
     */
    export class TransmissionHelper {
        /**
         * Creates the default options for the helper.
         * @returns the default options
         */
        private static _GetDefaultOptions;
        private readonly _scene;
        private _options;
        private _opaqueRenderTarget;
        private _opaqueMeshesCache;
        private _transparentMeshesCache;
        private _materialObservers;
        private _newMeshObserver;
        private _removedMeshObserver;
        private _disposed;
        private readonly _materialImpls;
        private readonly _adapterCache;
        /**
         * This observable will be notified with any error during the creation of the environment,
         * mainly texture creation errors.
         */
        onErrorObservable: Observable<{
            message?: string;
            exception?: any;
        }>;
        private _translucentMaterialIndices;
        private _opaqueOnlySubMeshes;
        private _savedSubMeshes;
        /**
         * constructor
         * @param options Defines the options we want to customize the helper
         * @param scene The scene to add the material to
         */
        constructor(options: Partial<ITransmissionHelperOptions>, scene: Scene);
        /**
         * Registers a material implementation with the helper so it can classify and create
         * adapters for materials of that type. Safe to call multiple times with the same
         * implementation — duplicates are ignored.
         * @param impl The material implementation to register
         */
        addMaterialImpl(impl: ITransmissionHelperMaterialImpl): void;
        /**
         * Updates the helper options.
         * @param options the options to update
         */
        updateOptions(options: Partial<ITransmissionHelperOptions>): void;
        /**
         * @returns the opaque render target texture or null if not available.
         */
        getOpaqueTarget(): Nullable<Texture>;
        private _getOrCreateAdapter;
        /**
         * Classify a mesh's materials as transparent, opaque, or mixed.
         * Sets the refraction background texture on any translucent materials found.
         * For mixed MultiMaterial meshes, populates _translucentMaterialIndices so
         * their translucent submeshes can be excluded from the opaque render target.
         * @param mesh - The mesh to classify
         * @returns 'transparent' if all materials are translucent, 'opaque' if none are, 'mixed' if both
         */
        private _classifyMeshMaterials;
        /**
         * Rebuild the cached opaque-only submesh array for a mixed mesh.
         * Called when classification changes so the per-frame swap is allocation-free.
         * @param mesh - The mesh to rebuild for
         * @param translucentIndices - Set of materialIndex values that are translucent
         */
        private _rebuildOpaqueOnlySubMeshes;
        private _addMesh;
        private _removeMesh;
        private _parseScene;
        private _onMeshMaterialChanged;
        /**
         * @internal
         * Check if the opaque render target has not been disposed and can still be used.
         * @returns
         */
        _isRenderTargetValid(): boolean;
        /**
         * @internal
         * Setup the render targets according to the specified options.
         */
        _setupRenderTargets(): void;
        /**
         * Dispose all the elements created by the Helper.
         */
        dispose(): void;
    }
    /**
     * Ensures a TransmissionHelper exists on the scene and has all of the loader's material
     * implementations registered with it. Creates the helper if one does not yet exist on the
     * scene, and recreates its render target if it has been disposed. Does nothing when the
     * loader's parent has `dontUseTransmissionHelper` set.
     * @param loader The glTF loader whose material implementations should be registered
     * @param babylonMaterial A material belonging to the scene where the helper should live
     */
    export function ensureTransmissionHelper(loader: BABYLON.GLTF2.GLTFLoader, babylonMaterial: Material): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /** Pure barrel — re-exports only side-effect-free modules */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Top-level shape of the glTF Object Model accessor tree. Each property
     * describes a navigable section of the JSON-Pointer namespace (e.g. `/nodes`,
     * `/materials`, `/scenes`) that KHR_interactivity, KHR_animation_pointer and
     * other extensions consume via {@link GetMappingForKey}.
     */
    export interface IGLTFObjectModelTree {
        /** Read-only accessor for the active scene index (`/scene`). */
        scene: {
            __target__: boolean;
        } & IObjectAccessor<number | undefined, any, number>;
        /** Accessor tree for `/cameras`. */
        cameras: IGLTFObjectModelTreeCamerasObject;
        /** Accessor tree for `/nodes`. */
        nodes: IGLTFObjectModelTreeNodesObject;
        /** Accessor tree for `/materials`. */
        materials: IGLTFObjectModelTreeMaterialsObject;
        /** Accessor tree for `/extensions` (root-level glTF extensions). */
        extensions: IGLTFObjectModelTreeExtensionsObject;
        /** Accessor tree for `/animations`. */
        animations: {
            length: IObjectAccessor<BABYLON.GLTF2.Loader.IAnimation[], AnimationGroup[], FlowGraphInteger>;
            __array__: {};
        };
        /** Accessor tree for `/meshes`. */
        meshes: IGLTFObjectModelTreeMeshesObject;
        /** Accessor tree for `/scenes`. */
        scenes: IGLTFObjectModelTreeScenesObject;
        /** Accessor tree for `/skins`. */
        skins: IGLTFObjectModelTreeSkinsObject;
    }
    /**
     * Accessor tree describing the `/nodes` section of the glTF Object Model.
     * Exposes per-node TRS, ref-typed parent/children/camera/mesh/skin links,
     * morph-target weights and node-extension properties.
     */
    export interface IGLTFObjectModelTreeNodesObject<GLTFTargetType = BABYLON.GLTF2.Loader.INode, BabylonTargetType = TransformNode> {
        /** Number of nodes in the array. */
        length: IObjectAccessor<GLTFTargetType[], BabylonTargetType[], FlowGraphInteger>;
        __array__: {
            __target__: boolean;
            translation: IObjectAccessor<GLTFTargetType, BabylonTargetType, Vector3>;
            rotation: IObjectAccessor<GLTFTargetType, BabylonTargetType, Quaternion>;
            scale: IObjectAccessor<GLTFTargetType, BabylonTargetType, Vector3>;
            matrix: IObjectAccessor<GLTFTargetType, BabylonTargetType, Matrix>;
            globalMatrix: IObjectAccessor<GLTFTargetType, BabylonTargetType, Matrix>;
            camera: IObjectAccessor<GLTFTargetType, any, string | undefined>;
            mesh: IObjectAccessor<GLTFTargetType, any, string | undefined>;
            skin: IObjectAccessor<GLTFTargetType, any, string | undefined>;
            parent: IObjectAccessor<GLTFTargetType, any, string | undefined>;
            children: {
                length: IObjectAccessor<number[], any, FlowGraphInteger>;
                __array__: {
                    __target__: boolean;
                } & IObjectAccessor<any, any, string>;
            };
            weights: {
                /** When true, the path converter skips objectTree traversal for this property, keeping the parent target. */
                __passThroughTarget__?: boolean;
                length: IObjectAccessor<GLTFTargetType, BabylonTargetType, FlowGraphInteger>;
                __array__: {
                    __target__: boolean;
                } & IObjectAccessor<GLTFTargetType, any, number>;
            } & IObjectAccessor<GLTFTargetType, BabylonTargetType, number[]>;
            extensions: {
                EXT_lights_ies?: {
                    multiplier: IObjectAccessor<BABYLON.GLTF2.Loader.INode, Light, number>;
                    color: IObjectAccessor<BABYLON.GLTF2.Loader.INode, Light, Color3>;
                };
                KHR_node_visibility?: {
                    visible: IObjectAccessor<BABYLON.GLTF2.Loader.INode, Mesh, boolean>;
                };
            };
        };
    }
    /**
     * Accessor tree describing the `/cameras` section of the glTF Object Model.
     * Exposes orthographic and perspective camera properties.
     */
    export interface IGLTFObjectModelTreeCamerasObject {
        /** Number of cameras in the array. */
        length: IObjectAccessor<BABYLON.GLTF2.Loader.ICamera[], any, FlowGraphInteger>;
        __array__: {
            __target__: boolean;
            orthographic: {
                xmag: IObjectAccessor<BABYLON.GLTF2.Loader.ICamera, BABYLON.GLTF2.Loader.ICamera, Vector2>;
                ymag: IObjectAccessor<BABYLON.GLTF2.Loader.ICamera, BABYLON.GLTF2.Loader.ICamera, Vector2>;
                zfar: IObjectAccessor<BABYLON.GLTF2.Loader.ICamera, BABYLON.GLTF2.Loader.ICamera, number>;
                znear: IObjectAccessor<BABYLON.GLTF2.Loader.ICamera, BABYLON.GLTF2.Loader.ICamera, number>;
            };
            perspective: {
                yfov: IObjectAccessor<BABYLON.GLTF2.Loader.ICamera, BABYLON.GLTF2.Loader.ICamera, number>;
                zfar: IObjectAccessor<BABYLON.GLTF2.Loader.ICamera, BABYLON.GLTF2.Loader.ICamera, number>;
                znear: IObjectAccessor<BABYLON.GLTF2.Loader.ICamera, BABYLON.GLTF2.Loader.ICamera, number>;
                aspectRatio: IObjectAccessor<BABYLON.GLTF2.Loader.ICamera, BABYLON.GLTF2.Loader.ICamera, Nullable<number>>;
            };
        };
    }
    /**
     * Accessor tree describing the `/materials` section of the glTF Object Model.
     * Covers core PBR properties as well as the family of KHR_materials_* extensions.
     */
    export interface IGLTFObjectModelTreeMaterialsObject {
        /** Number of materials in the array. */
        length: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial[], PBRMaterial[], FlowGraphInteger>;
        __array__: {
            __target__: boolean;
            doubleSided: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, boolean>;
            alphaCutoff: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
            pbrMetallicRoughness: {
                baseColorFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Color4>;
                metallicFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Nullable<number>>;
                roughnessFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Nullable<number>>;
                baseColorTexture: {
                    extensions: {
                        KHR_texture_transform: ITextureDefinition;
                    };
                };
                metallicRoughnessTexture: {
                    extensions: {
                        KHR_texture_transform: ITextureDefinition;
                    };
                };
            };
            emissiveFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Color3>;
            normalTexture: {
                scale: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                extensions: {
                    KHR_texture_transform: ITextureDefinition;
                };
            };
            occlusionTexture: {
                strength: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                extensions: {
                    KHR_texture_transform: ITextureDefinition;
                };
            };
            emissiveTexture: {
                extensions: {
                    KHR_texture_transform: ITextureDefinition;
                };
            };
            extensions: {
                KHR_materials_anisotropy: {
                    anisotropyStrength: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    anisotropyRotation: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    anisotropyTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                };
                KHR_materials_clearcoat: {
                    clearcoatFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    clearcoatRoughnessFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    clearcoatTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                    clearcoatNormalTexture: {
                        scale: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                    clearcoatRoughnessTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                };
                KHR_materials_dispersion: {
                    dispersion: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                };
                KHR_materials_emissive_strength: {
                    emissiveStrength: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                };
                KHR_materials_ior: {
                    ior: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                };
                KHR_materials_iridescence: {
                    iridescenceFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    iridescenceIor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    iridescenceThicknessMinimum: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    iridescenceThicknessMaximum: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    iridescenceTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                    iridescenceThicknessTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                };
                KHR_materials_sheen: {
                    sheenColorFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Color3>;
                    sheenRoughnessFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    sheenColorTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                    sheenRoughnessTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                };
                KHR_materials_specular: {
                    specularFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    specularColorFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Color3>;
                    specularTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                    specularColorTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                };
                KHR_materials_transmission: {
                    transmissionFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    transmissionTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                };
                KHR_materials_diffuse_transmission: {
                    diffuseTransmissionFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    diffuseTransmissionTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                    diffuseTransmissionColorFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Nullable<Color3>>;
                    diffuseTransmissionColorTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                };
                KHR_materials_volume: {
                    thicknessFactor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    attenuationColor: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Color3>;
                    attenuationDistance: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
                    thicknessTexture: {
                        extensions: {
                            KHR_texture_transform: ITextureDefinition;
                        };
                    };
                };
            };
        };
    }
    interface ITextureDefinition {
        offset: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Vector2>;
        rotation: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, number>;
        scale: IObjectAccessor<BABYLON.GLTF2.Loader.IMaterial, PBRMaterial, Vector2>;
    }
    /**
     * Accessor tree describing the `/meshes` section of the glTF Object Model.
     * Exposes per-mesh primitives (and their material refs) and the mesh-level
     * morph-target weights array.
     */
    export interface IGLTFObjectModelTreeMeshesObject {
        /** Number of meshes in the array. */
        length: IObjectAccessor<BABYLON.GLTF2.Loader.IMesh[], (Mesh | undefined)[], FlowGraphInteger>;
        __array__: {
            __target__: boolean;
            primitives: {
                length: IObjectAccessor<BABYLON.GLTF2.Loader.IMeshPrimitive[], any, FlowGraphInteger>;
                __array__: {
                    __target__: boolean;
                    material: IObjectAccessor<any, any, string | undefined>;
                };
            };
            weights: {
                length: IObjectAccessor<number[], any, FlowGraphInteger>;
                __array__: {
                    __target__: boolean;
                } & IObjectAccessor<any, any, number>;
            };
        };
    }
    /**
     * Accessor tree describing the `/scenes` section of the glTF Object Model.
     * Per-scene root-node refs are exposed under `nodes/{i}`.
     */
    export interface IGLTFObjectModelTreeScenesObject {
        /** Number of scenes in the array. */
        length: IObjectAccessor<BABYLON.GLTF2.Loader.IScene[], any, FlowGraphInteger>;
        __array__: {
            __target__: boolean;
            nodes: {
                length: IObjectAccessor<number[], any, FlowGraphInteger>;
                __array__: {
                    __target__: boolean;
                } & IObjectAccessor<any, any, string>;
            };
        };
    }
    /**
     * Accessor tree describing the `/skins` section of the glTF Object Model.
     * Joint and skeleton properties are exposed as JSON-Pointer refs.
     */
    export interface IGLTFObjectModelTreeSkinsObject {
        /** Number of skins in the array. */
        length: IObjectAccessor<BABYLON.GLTF2.Loader.ISkin[], any, FlowGraphInteger>;
        __array__: {
            __target__: boolean;
            joints: {
                length: IObjectAccessor<number[], any, FlowGraphInteger>;
                __array__: {
                    __target__: boolean;
                } & IObjectAccessor<any, any, string>;
            };
            skeleton: IObjectAccessor<BABYLON.GLTF2.Loader.ISkin, any, string | undefined>;
        };
    }
    /**
     * Accessor tree describing root-level glTF extensions exposed through the
     * Object Model. Currently covers the punctual / area / IES / image-based
     * light extension families.
     */
    export interface IGLTFObjectModelTreeExtensionsObject {
        /** Accessor tree for `/extensions/KHR_lights_punctual`. */
        KHR_lights_punctual: {
            lights: {
                length: IObjectAccessor<BABYLON.GLTF2.Loader.IKHRLightsPunctual_Light[], Light[], FlowGraphInteger>;
                __array__: {
                    __target__: boolean;
                    color: IObjectAccessor<BABYLON.GLTF2.Loader.IKHRLightsPunctual_Light, Light, Color3>;
                    intensity: IObjectAccessor<BABYLON.GLTF2.Loader.IKHRLightsPunctual_Light, Light, number>;
                    range: IObjectAccessor<BABYLON.GLTF2.Loader.IKHRLightsPunctual_Light, Light, number>;
                    spot: {
                        innerConeAngle: IObjectAccessor<BABYLON.GLTF2.Loader.IKHRLightsPunctual_Light, Light, number>;
                        outerConeAngle: IObjectAccessor<BABYLON.GLTF2.Loader.IKHRLightsPunctual_Light, Light, number>;
                    };
                };
            };
        };
        /** Accessor tree for `/extensions/EXT_lights_area`. */
        EXT_lights_area: {
            lights: {
                length: IObjectAccessor<BABYLON.GLTF2.Loader.IEXTLightsArea_Light[], Light[], FlowGraphInteger>;
                __array__: {
                    __target__: boolean;
                    color: IObjectAccessor<BABYLON.GLTF2.Loader.IEXTLightsArea_Light, Light, Color3>;
                    intensity: IObjectAccessor<BABYLON.GLTF2.Loader.IEXTLightsArea_Light, Light, number>;
                    size: IObjectAccessor<BABYLON.GLTF2.Loader.IEXTLightsArea_Light, Light, number>;
                    rect: {
                        aspect: IObjectAccessor<BABYLON.GLTF2.Loader.IEXTLightsArea_Light, Light, number>;
                    };
                };
            };
        };
        /** Accessor tree for `/extensions/EXT_lights_ies`. */
        EXT_lights_ies: {
            lights: {
                length: IObjectAccessor<BABYLON.GLTF2.Loader.IKHRLightsPunctual_Light[], Light[], FlowGraphInteger>;
            };
        };
        /** Accessor tree for `/extensions/EXT_lights_image_based`. */
        EXT_lights_image_based: {
            lights: {
                __array__: {
                    __target__: boolean;
                    intensity: IObjectAccessor<BABYLON.GLTF2.IEXTLightsImageBased_LightImageBased, BaseTexture, number>;
                    rotation: IObjectAccessor<BABYLON.GLTF2.IEXTLightsImageBased_LightImageBased, BaseTexture, Quaternion>;
                };
                length: IObjectAccessor<BABYLON.GLTF2.IEXTLightsImageBased_LightImageBased[], BaseTexture[], FlowGraphInteger>;
            };
        };
    }
    /**
     * get a path-to-object converter for the given glTF tree
     * @param gltf the glTF tree to use
     * @returns a path-to-object converter for the given glTF tree
     */
    export function GetPathToObjectConverter(gltf: BABYLON.GLTF2.Loader.IGLTF): BABYLON.GLTF2.Loader.Extensions.GLTFPathToObjectConverter<unknown, unknown, unknown>;
    /**
     * This function will return the object accessor for the given key in the object model
     * If the key is not found, it will return undefined
     * @param key the key to get the mapping for, for example /materials/\{\}/emissiveFactor
     * @returns an object accessor for the given key, or undefined if the key is not found
     */
    export function GetMappingForKey(key: string): IObjectAccessor | undefined;
    /**
     * Set interpolation for a specific key in the object model
     * @param key the key to set, for example /materials/\{\}/emissiveFactor
     * @param interpolation the interpolation elements array
     */
    export function SetInterpolationForKey(key: string, interpolation?: IInterpolationPropertyInfo[]): void;
    /**
     * This will ad a new object accessor in the object model at the given key.
     * Note that this will NOT change the typescript types. To do that you will need to change the interface itself (extending it in the module that uses it)
     * @param key the key to add the object accessor at. For example /cameras/\{\}/perspective/aspectRatio
     * @param accessor the object accessor to add
     */
    export function AddObjectAccessorToKey<GLTFTargetType = any, BabylonTargetType = any, BabylonValueType = any>(key: string, accessor: IObjectAccessor<GLTFTargetType, BabylonTargetType, BabylonValueType>): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Path-to-object converter that resolves the KHR_interactivity ref-validity
     * pointers `pointer/get` can query (KHR_interactivity spec §4.2.3 Event
     * References and §4.2.4 Delay References):
     *
     *  - `/extensions/KHR_interactivity/events/{}` — valid when the input reference
     *    was produced by an event operation (an event reference). Stateless: any
     *    event-reference path that reaches this converter is valid; a null ref is
     *    rejected earlier by the path-template substitution.
     *  - `/extensions/KHR_interactivity/delays/{}` — valid only while the referenced
     *    delay index is in the runtime active-delay set (i.e. the delay is scheduled
     *    and has not yet fired or been cancelled). This requires the runtime
     *    {@link FlowGraphContext}, which is supplied to the accessor `get` as its
     *    payload argument by `FlowGraphJsonPointerParserBlock`.
     *
     * On success `get` returns the input reference value (matching the spec, which
     * sets the `value` output to the input reference); on failure it returns
     * `undefined`, which the `pointer/get` block surfaces as `isValid = false`.
     */
    export class InteractivityRefPathToObjectConverter implements IPathToObjectConverter<IObjectAccessor> {
        /**
         * @param path the (template-substituted) JSON Pointer to resolve
         * @returns an object accessor whose `get` validates the reference
         */
        convert(path: string): IObjectInfo<IObjectAccessor>;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Path prefix of the KHR_interactivity asset-capability pointers (spec §4.1 Asset Capabilities).
     */
    export const InteractivityAssetCapabilitiesPrefix = "/extensions/KHR_interactivity/asset/";
    /**
     * Path prefix of the KHR_interactivity runtime-limit pointers (spec §4.2 Implementation-Specific Runtime Limits).
     */
    export const InteractivityLimitsPrefix = "/extensions/KHR_interactivity/limits/";
    /**
     * Path-to-object converter that resolves the virtual KHR_interactivity pointers describing the capabilities of the
     * asset and of the implementation running it:
     *
     *  - `/extensions/KHR_interactivity/asset/majorVersion` and `.../minorVersion` — the glTF version the asset is
     *    presented with.
     *  - `/extensions/KHR_interactivity/asset/extensions/<EXTENSION_NAME>/enabled` — whether the extension is both
     *    listed in `extensionsUsed` and supported by this loader. Reading an extension that is not used or not
     *    supported resolves successfully and yields `false`, so a behavior graph can branch on extension support.
     *  - `/extensions/KHR_interactivity/limits/<LIMIT_NAME>` — the implementation-specific runtime limits.
     *
     * All of these are read-only.
     */
    export class InteractivityAssetPathToObjectConverter implements IPathToObjectConverter<IObjectAccessor> {
        private _gltf;
        private _isExtensionEnabled;
        /**
         * @param _gltf the loaded glTF, used to read the asset version
         * @param _isExtensionEnabled predicate telling whether a glTF extension is both used by the asset and supported
         * by this loader
         */
        constructor(_gltf: BABYLON.GLTF2.Loader.IGLTF, _isExtensionEnabled: (name: string) => boolean);
        /**
         * @param path the JSON Pointer to resolve
         * @returns an object accessor for the addressed capability
         * @throws if the path does not address a known capability, which `pointer/get` surfaces as `isValid = false`
         */
        convert(path: string): IObjectInfo<IObjectAccessor>;
        private _createAccessor;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Adding an exception here will break traversing through the glTF object tree.
     * This is used for properties that might not be in the glTF object model, but are optional and have a default value.
     * For example, the path /nodes/\{\}/extensions/KHR_node_visibility/visible is optional - the object can be deferred without the object fully existing.
     */
    export var OptionalPathExceptionsList: {
        regex: RegExp;
    }[];
    /**
     * A converter that takes a glTF Object Model JSON Pointer
     * and transforms it into an ObjectAccessorContainer, allowing
     * objects referenced in the glTF to be associated with their
     * respective Babylon.js objects.
     */
    export class GLTFPathToObjectConverter<T, BabylonType, BabylonValue> implements IPathToObjectConverter<IObjectAccessor<T, BabylonType, BabylonValue>> {
        private _gltf;
        private _infoTree;
        constructor(_gltf: BABYLON.GLTF2.Loader.IGLTF, _infoTree: any);
        /**
         * The pointer string is represented by a [JSON pointer](https://datatracker.ietf.org/doc/html/rfc6901).
         * See also https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/ObjectModel.adoc#core-pointers
         * <animationPointer> := /<rootNode>/<assetIndex>/<propertyPath>
         * <rootNode> := "nodes" | "materials" | "meshes" | "cameras" | "extensions"
         * <assetIndex> := <digit> | <name>
         * <propertyPath> := <extensionPath> | <standardPath>
         * <extensionPath> := "extensions"/<name>/<standardPath>
         * <standardPath> := <name> | <name>/<standardPath>
         * <name> := W+
         * <digit> := D+
         *
         * Examples:
         *  - "/nodes/0/rotation"
         * - "/nodes.length"
         *  - "/materials/2/emissiveFactor"
         *  - "/materials/2/pbrMetallicRoughness/baseColorFactor"
         *  - "/materials/2/extensions/KHR_materials_emissive_strength/emissiveStrength"
         *
         * @param path The path to convert
         * @returns The object and info associated with the path
         */
        convert(path: string): IObjectInfo<IObjectAccessor<T, BabylonType, BabylonValue>>;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Registers the built-in glTF 2.0 extension async factories, which dynamically imports and loads each glTF extension on demand (e.g. only when a glTF model uses the extension).
     */
    export function registerBuiltInGLTFExtensions(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Entry in the composite converter's prefix table. The first entry whose
     * `prefix` matches the start of the path wins.
     */
    export interface IPathConverterPrefixEntry<T> {
        /** Path prefix to match, e.g. `"/extensions/BABYLON_scene_objects/"`. */
        prefix: string;
        /** Converter to delegate to when the path starts with `prefix`. */
        converter: IPathToObjectConverter<T>;
    }
    /**
     * Composite path-to-object converter that dispatches by path prefix.
     *
     * The KHR_interactivity object model lives at the top of the JSON tree
     * (`/nodes/...`, `/materials/...`, `/extensions/...`) and is resolved by
     * `GLTFPathToObjectConverter` (see `gltfPathToObjectConverter`).
     *
     * Babylon-specific extensions can register additional namespaces here
     * (for example `/extensions/BABYLON_scene_objects/...` for refs that point
     * at scene objects not described by the source glTF) without forcing every
     * caller to know about them — `FlowGraphJsonPointerParserBlock` and the
     * existing template substitution machinery treat any path uniformly.
     *
     * Prefix entries are tried in order; if none matches, the fallback converter
     * is used. The fallback is typically the glTF converter, since standard
     * KHR_interactivity pointer paths sit at the JSON root and have no shared
     * prefix that would distinguish them from a missing namespace.
     */
    export class CompositePathToObjectConverter<T> implements IPathToObjectConverter<T> {
        private _prefixes;
        private _fallback;
        /**
         * @param _prefixes prefix-keyed converter table, tried in order
         * @param _fallback converter used when no prefix entry matches
         */
        constructor(_prefixes: IPathConverterPrefixEntry<T>[], _fallback: IPathToObjectConverter<T>);
        /**
         * Adds a new prefix entry at the front of the lookup list so it is tried
         * before any entries registered earlier. Useful for late-registered
         * loader extensions that want to override or augment a previously
         * registered namespace.
         * @param entry the entry to add
         */
        addPrefix(entry: IPathConverterPrefixEntry<T>): void;
        /**
         * @param path the JSON Pointer path to resolve
         * @returns an object accessor for the resolved property
         */
        convert(path: string): IObjectInfo<T>;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Root of the JSON-Pointer namespace under which Babylon-scene objects are
     * addressed by KHR_interactivity refs that did not originate from the source
     * glTF asset (e.g. refs emitted by engine-specific event blocks).
     *
     * Trailing `/` is intentional: it lets path-prefix dispatchers like
     * {@link CompositePathToObjectConverter} match cleanly.
     */
    export const BABYLON_SCENE_OBJECT_MODEL_PREFIX = "/extensions/BABYLON_scene_objects/";
    /**
     * Shape of the Babylon-scene object model tree consumed by
     * {@link BabylonScenePathToObjectConverter}. Mirrors `IGLTFObjectModelTree`
     * but is rooted at scene-asset arrays (`transformNodes`, `meshes`, …) and
     * keyed by Babylon `uniqueId`. Initially we only expose the property leaves
     * needed to validate the seam end-to-end; future leaves can be added without
     * any path-converter changes.
     */
    export interface IBabylonSceneObjectModelTree {
        /**
         *
         */
        transformNodes: IBabylonObjectCollection<TransformNode>;
        /**
         *
         */
        meshes: IBabylonObjectCollection<AbstractMesh>;
        /**
         *
         */
        materials: IBabylonObjectCollection<Material>;
    }
    /**
     * Generic per-collection node in the tree. `length` exposes a `.length`
     * accessor (mirroring glTF). `__array__` is the per-instance leaf hit when a
     * uniqueId index appears in the path.
     */
    export interface IBabylonObjectCollection<TBabylon> {
        /**
         *
         */
        length: IObjectAccessor<TBabylon[], TBabylon[], number>;
        /**
         *
         */
        __array__: IBabylonObjectLeaves<TBabylon>;
    }
    /** Per-instance accessors. Add new properties here as they are needed. */
    export interface IBabylonObjectLeaves<TBabylon> {
        /** Marks this position as a `getTarget` boundary so the resolver can hand back the instance itself. */
        __target__?: boolean;
        /**
         *
         */
        name?: IObjectAccessor<TBabylon, TBabylon, string>;
        /**
         *
         */
        translation?: IObjectAccessor<TBabylon, TBabylon, Vector3>;
        /**
         *
         */
        rotation?: IObjectAccessor<TBabylon, TBabylon, Quaternion>;
        /**
         *
         */
        scale?: IObjectAccessor<TBabylon, TBabylon, Vector3>;
        /**
         *
         */
        matrix?: IObjectAccessor<TBabylon, TBabylon, Matrix>;
        /**
         *
         */
        globalMatrix?: IObjectAccessor<TBabylon, TBabylon, Matrix>;
        /**
         *
         */
        visible?: IObjectAccessor<TBabylon, TBabylon, boolean>;
    }
    /**
     * Resolves JSON Pointer paths in the `/extensions/BABYLON_scene_objects/...`
     * namespace to Babylon scene objects.
     *
     * The path layout is `/{root}/{collection}/{uniqueId}/{property}` where
     * `{root}` is the literal `extensions/BABYLON_scene_objects` prefix and
     * `{uniqueId}` is the Babylon `uniqueId` (stable per session) of the target
     * instance. For example:
     *
     * - `/extensions/BABYLON_scene_objects/transformNodes/42/translation`
     * - `/extensions/BABYLON_scene_objects/meshes/17/visible`
     *
     * Composite path dispatchers (see {@link CompositePathToObjectConverter})
     * route paths starting with the prefix here; everything else continues to be
     * resolved by the standard glTF converter.
     */
    export class BabylonScenePathToObjectConverter implements IPathToObjectConverter<IObjectAccessor> {
        private _scene;
        private _tree;
        constructor(_scene: Scene, _tree: IBabylonSceneObjectModelTree);
        /**
         * @param path the full JSON Pointer (must start with the Babylon prefix)
         * @returns an object-info container holding the resolved instance and accessor
         */
        convert(path: string): IObjectInfo<IObjectAccessor>;
        private _getCollectionArray;
        private _lookupInstanceByUniqueId;
        private _buildIdentityAccessor;
    }
    /**
     * Builds the default Babylon-scene object-model tree.
     *
     * We deliberately start with a minimal set of properties: the goal of this
     * tree is to prove the seam (refs in the BABYLON namespace resolving through
     * the same `FlowGraphJsonPointerParserBlock` that the glTF refs use) without
     * committing to a complete property surface in this PR. Add new leaves here
     * as concrete event-source operations need them.
     * @returns a fresh Babylon-scene object-model tree with the default property surface.
     */
    export function CreateDefaultBabylonSceneObjectModelTree(): IBabylonSceneObjectModelTree;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the MSFT_sRGBFactors extension.
         */
        ["MSFT_sRGBFactors"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /** @internal */
    export class MSFT_sRGBFactors implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /** @internal */
        readonly name = "MSFT_sRGBFactors";
        /** @internal */
        enabled: boolean;
        private _loader;
        /** @internal */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /** @internal*/
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
    }
    /**
     * Registers the MSFT_sRGBFactors glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterMSFT_sRGBFactors(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./MSFT_sRGBFactors.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the MSFT_minecraftMesh extension.
         */
        ["MSFT_minecraftMesh"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /** @internal */
    export class MSFT_minecraftMesh implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /** @internal */
        readonly name = "MSFT_minecraftMesh";
        /** @internal */
        enabled: boolean;
        private _loader;
        /** @internal */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /** @internal */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
    }
    /**
     * Registers the MSFT_minecraftMesh glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterMSFT_minecraftMesh(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./MSFT_minecraftMesh.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the MSFT_lod extension.
         */
        ["MSFT_lod"]: Partial<{
            /**
             * Maximum number of LODs to load, starting from the lowest LOD.
             */
            maxLODsToLoad: number;
        }>;
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/MSFT_lod/README.md)
     */
    export class MSFT_lod implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "MSFT_lod";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        /**
         * Maximum number of LODs to load, starting from the lowest LOD.
         */
        maxLODsToLoad: number;
        /**
         * Observable raised when all node LODs of one level are loaded.
         * The event data is the index of the loaded LOD starting from zero.
         * Dispose the loader to cancel the loading of the next level of LODs.
         */
        onNodeLODsLoadedObservable: Observable<number>;
        /**
         * Observable raised when all material LODs of one level are loaded.
         * The event data is the index of the loaded LOD starting from zero.
         * Dispose the loader to cancel the loading of the next level of LODs.
         */
        onMaterialLODsLoadedObservable: Observable<number>;
        private _loader;
        private _bufferLODs;
        private _nodeIndexLOD;
        private _nodeSignalLODs;
        private _nodePromiseLODs;
        private _nodeBufferLODs;
        private _materialIndexLOD;
        private _materialSignalLODs;
        private _materialPromiseLODs;
        private _materialBufferLODs;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /** @internal */
        onReady(): void;
        /**
         * @internal
         */
        loadSceneAsync(context: string, scene: BABYLON.GLTF2.Loader.IScene): Nullable<Promise<void>>;
        /**
         * @internal
         */
        loadNodeAsync(context: string, node: BABYLON.GLTF2.Loader.INode, assign: (babylonTransformNode: TransformNode) => void): Nullable<Promise<TransformNode>>;
        /**
         * @internal
         */
        _loadMaterialAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMesh: Nullable<Mesh>, babylonDrawMode: number, assign: (babylonMaterial: Material) => void): Nullable<Promise<Material>>;
        /**
         * @internal
         */
        _loadUriAsync(context: string, property: BABYLON.GLTF2.IProperty, uri: string): Nullable<Promise<ArrayBufferView>>;
        /**
         * @internal
         */
        loadBufferAsync(context: string, buffer: BABYLON.GLTF2.Loader.IBuffer, byteOffset: number, byteLength: number): Nullable<Promise<ArrayBufferView>>;
        private _loadBufferLOD;
        /**
         * @returns an array of LOD properties from lowest to highest.
         * @param context
         * @param property
         * @param array
         * @param ids
         */
        private _getLODs;
        private _disposeTransformNode;
        private _disposeMaterials;
    }
    /**
     * Registers the MSFT_lod glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterMSFT_lod(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./MSFT_lod.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the MSFT_audio_emitter extension.
         */
        ["MSFT_audio_emitter"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/najadojo/glTF/blob/MSFT_audio_emitter/extensions/2.0/Vendor/MSFT_audio_emitter/README.md)
     * !!! Experimental Extension Subject to Changes !!!
     */
    export class MSFT_audio_emitter implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "MSFT_audio_emitter";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        private _clips;
        private _emitters;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /** @internal */
        onLoading(): void;
        /**
         * @internal
         */
        loadSceneAsync(context: string, scene: BABYLON.GLTF2.Loader.IScene): Nullable<Promise<void>>;
        /**
         * @internal
         */
        loadNodeAsync(context: string, node: BABYLON.GLTF2.Loader.INode, assign: (babylonTransformNode: TransformNode) => void): Nullable<Promise<TransformNode>>;
        /**
         * @internal
         */
        loadAnimationAsync(context: string, animation: BABYLON.GLTF2.Loader.IAnimation): Nullable<Promise<AnimationGroup>>;
        private _loadClipAsync;
        private _loadEmitterAsync;
        private _getEventAction;
        private _loadAnimationEventAsync;
    }
    /**
     * Registers the MSFT_audio_emitter glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterMSFT_audio_emitter(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./MSFT_audio_emitter.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_xmp_json_ld extension.
         */
        ["KHR_xmp_json_ld"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_xmp_json_ld/README.md)
     * @since 5.0.0
     */
    export class KHR_xmp_json_ld implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_xmp_json_ld";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * Called after the loader state changes to LOADING.
         */
        onLoading(): void;
    }
    /**
     * Registers the KHR_xmp_json_ld glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_xmp_json_ld(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_xmp_json_ld.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_texture_transform extension.
         */
        ["KHR_texture_transform"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_transform/README.md)
     */
    export class KHR_texture_transform implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_texture_transform";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadTextureInfoAsync(context: string, textureInfo: BABYLON.GLTF2.Loader.ITextureInfo, assign: (babylonTexture: BaseTexture) => void): Nullable<Promise<BaseTexture>>;
    }
    /**
     * Registers the KHR_texture_transform glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_texture_transform(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_texture_transform.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_texture_basisu extension.
         */
        ["KHR_texture_basisu"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md)
     */
    export class KHR_texture_basisu implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /** The name of this extension. */
        readonly name = "KHR_texture_basisu";
        /** Defines whether this extension is enabled. */
        enabled: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        _loadTextureAsync(context: string, texture: BABYLON.GLTF2.Loader.ITexture, assign: (babylonTexture: BaseTexture) => void): Nullable<Promise<BaseTexture>>;
    }
    /**
     * Registers the KHR_texture_basisu glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_texture_basisu(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_texture_basisu.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_node_visibility extension.
         */
        ["KHR_node_visibility"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Loader extension for KHR_node_visibility
     */
    export class KHR_node_visibility implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_node_visibility";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader?;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        onReady(): void;
        dispose(): void;
    }
    /**
     * @internal
     * Registers KHR_node_visibility runtime dependencies without changing the extension registry.
     */
    export function _RegisterKHRNodeVisibilityRuntime(): void;
    /**
     * Registers the KHR_node_visibility glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_node_visibility(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_node_visibility.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_selectability extension.
         */
        ["KHR_node_selectability"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Loader extension for KHR_selectability
     */
    export class KHR_node_selectability implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_node_selectability";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        onReady(): Promise<void>;
        dispose(): void;
    }
    /**
     * @internal
     * Registers KHR_node_selectability runtime dependencies without changing the extension registry.
     */
    export function _RegisterKHRNodeSelectabilityRuntime(): void;
    /**
     * Registers the KHR_node_selectability glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_node_selectability(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_node_selectability.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_node_hoverability extension.
         */
        ["KHR_node_hoverability"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Loader extension for KHR_node_hoverability
     * @see https://github.com/KhronosGroup/glTF/pull/2426
     */
    export class KHR_node_hoverability implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_node_hoverability";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        onReady(): Promise<void>;
        dispose(): void;
    }
    /**
     * @internal
     * Registers KHR_node_hoverability runtime dependencies without changing the extension registry.
     */
    export function _RegisterKHRNodeHoverabilityRuntime(): void;
    /**
     * Registers the KHR_node_hoverability glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_node_hoverability(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_node_hoverability.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_mesh_quantization extension.
         */
        ["KHR_mesh_quantization"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_mesh_quantization/README.md)
     */
    export class KHR_mesh_quantization implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_mesh_quantization";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
    }
    /**
     * Registers the KHR_mesh_quantization glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_mesh_quantization(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_mesh_quantization.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_volume_scatter extension.
         */
        ["KHR_materials_volume_scatter"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * TODO: In-progress specification
     * [Specification](https://github.com/KhronosGroup/glTF/blob/7ea427ed55d44427e83c0a6d1c87068b1a4151c5/extensions/2.0/Khronos/KHR_materials_volume_scatter/README.md)
     * @experimental
     * @since 9.0.0
     */
    export class KHR_materials_volume_scatter implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_volume_scatter";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadVolumePropertiesAsync;
    }
    /**
     * Registers the KHR_materials_volume_scatter glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_volume_scatter(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_volume_scatter.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_volume extension.
         */
        ["KHR_materials_volume"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_volume/README.md)
     * @since 5.0.0
     */
    export class KHR_materials_volume implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_volume";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadVolumePropertiesAsync;
    }
    /**
     * Registers the KHR_materials_volume glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_volume(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_volume.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    type MaterialVariantsController = {
        /**
         * The list of available variant names for this asset.
         */
        readonly variants: readonly string[];
        /**
         * Gets or sets the selected variant.
         */
        selectedVariant: string;
    };
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_variants extension.
         */
        ["KHR_materials_variants"]: Partial<{
            /**
             * Specifies the name of the variant that should be selected by default.
             */
            defaultVariant: string;
            /**
             * Defines a callback that will be called if material variants are loaded.
             * @experimental
             */
            onLoaded: (controller: MaterialVariantsController) => void;
        }>;
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        export type MaterialVariantsController = {
        /**
         * The list of available variant names for this asset.
         */
        readonly variants: readonly string[];
        /**
         * Gets or sets the selected variant.
         */
        selectedVariant: string;
    };
    /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_variants/README.md)
     */
    export class KHR_materials_variants implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_variants";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        private _variants?;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * Gets the list of available variant names for this asset.
         * @param rootNode The glTF root node
         * @returns the list of all the variant names for this model
         */
        static GetAvailableVariants(rootNode: TransformNode): string[];
        /**
         * Gets the list of available variant names for this asset.
         * @param rootNode The glTF root node
         * @returns the list of all the variant names for this model
         */
        getAvailableVariants(rootNode: TransformNode): string[];
        /**
         * Select a variant given a variant name or a list of variant names.
         * @param rootNode The glTF root node
         * @param variantName The variant name(s) to select.
         */
        static SelectVariant(rootNode: TransformNode, variantName: string | string[]): void;
        /**
         * Select a variant given a variant name or a list of variant names.
         * @param rootNode The glTF root node
         * @param variantName The variant name(s) to select.
         */
        selectVariant(rootNode: TransformNode, variantName: string | string[]): void;
        /**
         * Reset back to the original before selecting a variant.
         * @param rootNode The glTF root node
         */
        static Reset(rootNode: TransformNode): void;
        /**
         * Reset back to the original before selecting a variant.
         * @param rootNode The glTF root node
         */
        reset(rootNode: TransformNode): void;
        /**
         * Gets the last selected variant name(s) or null if original.
         * @param rootNode The glTF root node
         * @returns The selected variant name(s).
         */
        static GetLastSelectedVariant(rootNode: TransformNode): Nullable<string | string[]>;
        /**
         * Gets the last selected variant name(s) or null if original.
         * @param rootNode The glTF root node
         * @returns The selected variant name(s).
         */
        getLastSelectedVariant(rootNode: TransformNode): Nullable<string | string[]>;
        private static _GetExtensionMetadata;
        /** @internal */
        onLoading(): void;
        /** @internal */
        onReady(): void;
        /**
         * @internal
         */
        _loadMeshPrimitiveAsync(context: string, name: string, node: BABYLON.GLTF2.Loader.INode, mesh: BABYLON.GLTF2.Loader.IMesh, primitive: BABYLON.GLTF2.Loader.IMeshPrimitive, assign: (babylonMesh: AbstractMesh) => void): Nullable<Promise<AbstractMesh>>;
    }
    /**
     * Registers the KHR_materials_variants glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_variants(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_variants.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_unlit extension.
         */
        ["KHR_materials_unlit"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_unlit/README.md)
     */
    export class KHR_materials_unlit implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_unlit";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadUnlitPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_unlit glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_unlit(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_unlit.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_transmission extension.
         */
        ["KHR_materials_transmission"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_transmission/README.md)
     */
    export class KHR_materials_transmission implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_transmission";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadTransparentPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_transmission glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_transmission(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_transmission.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_specular extension.
         */
        ["KHR_materials_specular"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_specular/README.md)
     */
    export class KHR_materials_specular implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_specular";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadSpecularPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_specular glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_specular(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_specular.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_sheen extension.
         */
        ["KHR_materials_sheen"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_sheen/README.md)
     * [Playground Sample](https://www.babylonjs-playground.com/frame.html#BNIZX6#4)
     */
    export class KHR_materials_sheen implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_sheen";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadSheenPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_sheen glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_sheen(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_sheen.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_pbrSpecularGlossiness extension.
         */
        ["KHR_materials_pbrSpecularGlossiness"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Archived/KHR_materials_pbrSpecularGlossiness/README.md)
     */
    export class KHR_materials_pbrSpecularGlossiness implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_pbrSpecularGlossiness";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadSpecularGlossinessPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_pbrSpecularGlossiness glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_pbrSpecularGlossiness(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_pbrSpecularGlossiness.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_iridescence extension.
         */
        ["KHR_materials_iridescence"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_iridescence/README.md)
     */
    export class KHR_materials_iridescence implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_iridescence";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadIridescencePropertiesAsync;
    }
    /**
     * Registers the KHR_materials_iridescence glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_iridescence(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_iridescence.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_ior extension.
         */
        ["KHR_materials_ior"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_ior/README.md)
     */
    export class KHR_materials_ior implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * Default ior Value from the spec.
         */
        private static readonly _DEFAULT_IOR;
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_ior";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadIorPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_ior glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_ior(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_ior.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_fuzz extension.
         */
        ["KHR_materials_fuzz"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/9734e44accd0dfb986ec5f376117aa00192745fe/extensions/2.0/Khronos/KHR_materials_fuzz/README.md)
     * @experimental
     */
    export class KHR_materials_fuzz implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_fuzz";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadFuzzPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_fuzz glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_fuzz(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_fuzz.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_emissive_strength extension.
         */
        ["KHR_materials_emissive_strength"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_emissive_strength/README.md)
     */
    export class KHR_materials_emissive_strength implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_emissive_strength";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadEmissiveProperties;
    }
    /**
     * Registers the KHR_materials_emissive_strength glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_emissive_strength(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_emissive_strength.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_dispersion extension.
         */
        ["KHR_materials_dispersion"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/87bd64a7f5e23c84b6aef2e6082069583ed0ddb4/extensions/2.0/Khronos/KHR_materials_dispersion/README.md)
     * @experimental
     */
    export class KHR_materials_dispersion implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_dispersion";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadDispersionPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_dispersion glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_dispersion(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_dispersion.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_diffuse_transmission extension.
         */
        ["KHR_materials_diffuse_transmission"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Proposed Specification](https://github.com/KhronosGroup/glTF/pull/1825)
     * !!! Experimental Extension Subject to Changes !!!
     */
    export class KHR_materials_diffuse_transmission implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_diffuse_transmission";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadTranslucentPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_diffuse_transmission glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_diffuse_transmission(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_diffuse_transmission.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_diffuse_roughness extension.
         */
        ["KHR_materials_diffuse_roughness"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/b102d2d2b40d44a8776800bb2bf85e218853c17d/extensions/2.0/Khronos/KHR_materials_diffuse_roughness/README.md)
     * @experimental
     */
    export class KHR_materials_diffuse_roughness implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_diffuse_roughness";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadDiffuseRoughnessPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_diffuse_roughness glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_diffuse_roughness(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_diffuse_roughness.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_coat extension.
         */
        ["KHR_materials_coat"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/6cb2cb84b504c245c49cf2e9a8ae16d26f72ac97/extensions/2.0/Khronos/KHR_materials_coat/README.md)
     * @experimental
     */
    export class KHR_materials_coat implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_coat";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * Defines whether the KHR_materials_openpbr extension is used, indicating that
         * the material should be interpreted as OpenPBR (for coat, this might be necessary
         * to interpret anisotropy correctly).
         */
        private useOpenPBR;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadCoatPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_coat glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_coat(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_coat.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_clearcoat extension.
         */
        ["KHR_materials_clearcoat"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_clearcoat/README.md)
     * [Playground Sample](https://www.babylonjs-playground.com/frame.html#7F7PN6#8)
     */
    export class KHR_materials_clearcoat implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_clearcoat";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadClearCoatPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_clearcoat glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_clearcoat(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_clearcoat.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_anisotropy extension.
         */
        ["KHR_materials_anisotropy"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_anisotropy)
     */
    export class KHR_materials_anisotropy implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_materials_anisotropy";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines a number that determines the order the extensions are applied.
         */
        order: number;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadMaterialPropertiesAsync(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
        private _loadAnisotropyPropertiesAsync;
    }
    /**
     * Registers the KHR_materials_anisotropy glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_materials_anisotropy(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_materials_anisotropy.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_lights_punctual extension.
         */
        ["KHR_lights_punctual"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md)
     */
    export class KHR_lights implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_lights_punctual";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /** hidden */
        private _loader;
        private _lights?;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /** @internal */
        onLoading(): void;
        /**
         * @internal
         */
        loadNodeAsync(context: string, node: BABYLON.GLTF2.Loader.INode, assign: (babylonTransformNode: TransformNode) => void): Nullable<Promise<TransformNode>>;
    }
    /**
     * Registers the KHR_lights glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_lights(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_lights_punctual.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_interactivity extension.
         */
        ["KHR_interactivity"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Loader extension for KHR_interactivity
     */
    export class KHR_interactivity implements BABYLON.GLTF2.IGLTFLoaderExtension {
        private _loader;
        /**
         * The name of this extension.
         */
        readonly name = "KHR_interactivity";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _gltfPathConverter?;
        private _pathConverter?;
        /**
         * @internal
         * @param _loader
         */
        constructor(_loader: BABYLON.GLTF2.GLTFLoader);
        dispose(): void;
        onReady(): Promise<void>;
    }
    /**
     * @internal
     * populates the object model with the interactivity extension
     */
    export function _AddInteractivityObjectModel(scene: Scene): void;
    /**
     * @internal
     * Registers KHR_interactivity runtime dependencies without changing the extension registry.
     */
    export function _RegisterKHRInteractivityRuntime(): void;
    /**
     * Registers the KHR_interactivity glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_interactivity(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_interactivity.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_gaussian_splatting extension.
         */
        ["KHR_gaussian_splatting"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_gaussian_splatting/README.md)
     * Loads a mesh primitive tagged with KHR_gaussian_splatting as a {@link GaussianSplattingMesh}.
     */
    export class KHR_gaussian_splatting implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_gaussian_splatting";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        _loadMeshPrimitiveAsync(context: string, name: string, node: BABYLON.GLTF2.Loader.INode, mesh: BABYLON.GLTF2.Loader.IMesh, primitive: BABYLON.GLTF2.Loader.IMeshPrimitive, assign: (babylonMesh: AbstractMesh) => void): Nullable<Promise<AbstractMesh>>;
    }
    /**
     * Registers the KHR_gaussian_splatting glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_gaussian_splatting(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_gaussian_splatting.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_draco_mesh_compression extension.
         */
        ["KHR_draco_mesh_compression"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_draco_mesh_compression/README.md)
     */
    export class KHR_draco_mesh_compression implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_draco_mesh_compression";
        /**
         * The draco decoder used to decode vertex data or DracoDecoder.Default if not defined
         */
        dracoDecoder?: DracoDecoder;
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /**
         * Defines whether to use the normalized flag from the glTF accessor instead of the Draco data. Defaults to true.
         */
        useNormalizedFlagFromAccessor: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        _loadVertexDataAsync(context: string, primitive: BABYLON.GLTF2.Loader.IMeshPrimitive, babylonMesh: Mesh): Nullable<Promise<Geometry>>;
    }
    /**
     * Registers the KHR_draco_mesh_compression glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_draco_mesh_compression(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_draco_mesh_compression.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_animation_pointer extension.
         */
        ["KHR_animation_pointer"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification PR](https://github.com/KhronosGroup/glTF/pull/2147)
     * !!! Experimental Extension Subject to Changes !!!
     */
    export class KHR_animation_pointer implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "KHR_animation_pointer";
        private _loader;
        private _pathToObjectConverter?;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /**
         * Defines whether this extension is enabled.
         */
        get enabled(): boolean;
        /** @internal */
        dispose(): void;
        /**
         * Loads a glTF animation channel.
         * @param context The context when loading the asset
         * @param animationContext The context of the animation when loading the asset
         * @param animation The glTF animation property
         * @param channel The glTF animation channel property
         * @param onLoad Called for each animation loaded
         * @returns A void promise that resolves when the load is complete or null if not handled
         */
        _loadAnimationChannelAsync(context: string, animationContext: string, animation: BABYLON.GLTF2.Loader.IAnimation, channel: BABYLON.GLTF2.Loader.IAnimationChannel, onLoad: (babylonAnimatable: IAnimatable, babylonAnimation: Animation) => void): Nullable<Promise<void>>;
    }
    /**
     * Registers the KHR_animation_pointer glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterKHR_animation_pointer(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Registers the KHR_animation_pointer interpolation mappings.
     * @internal
     */
    export function _RegisterKHRAnimationPointerData(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./KHR_animation_pointer.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the ExtrasAsMetadata extension.
         */
        ["ExtrasAsMetadata"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Store glTF extras (if present) in BJS objects' metadata
     */
    export class ExtrasAsMetadata implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "ExtrasAsMetadata";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        private _assignExtras;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadNodeAsync(context: string, node: BABYLON.GLTF2.Loader.INode, assign: (babylonTransformNode: TransformNode) => void): Nullable<Promise<TransformNode>>;
        /**
         * @internal
         */
        loadCameraAsync(context: string, camera: BABYLON.GLTF2.Loader.ICamera, assign: (babylonCamera: Camera) => void): Nullable<Promise<Camera>>;
        /**
         * @internal
         */
        createMaterial(context: string, material: BABYLON.GLTF2.Loader.IMaterial, babylonDrawMode: number): Nullable<Material>;
        /**
         * @internal
         */
        loadAnimationAsync(context: string, animation: BABYLON.GLTF2.Loader.IAnimation): Nullable<Promise<AnimationGroup>>;
    }
    /**
     * Registers the ExtrasAsMetadata glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterExtrasAsMetadata(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./ExtrasAsMetadata.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the EXT_texture_webp extension.
         */
        ["EXT_texture_webp"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_texture_webp/README.md)
     */
    export class EXT_texture_webp implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /** The name of this extension. */
        readonly name = "EXT_texture_webp";
        /** Defines whether this extension is enabled. */
        enabled: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        _loadTextureAsync(context: string, texture: BABYLON.GLTF2.Loader.ITexture, assign: (babylonTexture: BaseTexture) => void): Nullable<Promise<BaseTexture>>;
    }
    /**
     * Registers the EXT_texture_webp glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterEXT_texture_webp(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./EXT_texture_webp.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the EXT_texture_avif extension.
         */
        ["EXT_texture_avif"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [glTF PR](https://github.com/KhronosGroup/glTF/pull/2235)
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_texture_avif/README.md)
     */
    export class EXT_texture_avif implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /** The name of this extension. */
        readonly name = "EXT_texture_avif";
        /** Defines whether this extension is enabled. */
        enabled: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        _loadTextureAsync(context: string, texture: BABYLON.GLTF2.Loader.ITexture, assign: (babylonTexture: BaseTexture) => void): Nullable<Promise<BaseTexture>>;
    }
    /**
     * Registers the EXT_texture_avif glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterEXT_texture_avif(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./EXT_texture_avif.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the EXT_meshopt_compression extension.
         */
        ["EXT_meshopt_compression"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md)
     *
     * This extension uses a WebAssembly decoder module from https://github.com/zeux/meshoptimizer/tree/master/js
     * @since 5.0.0
     */
    export class EXT_meshopt_compression implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "EXT_meshopt_compression";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadBufferViewAsync(context: string, bufferView: BABYLON.GLTF2.Loader.IBufferView): Nullable<Promise<ArrayBufferView>>;
    }
    /**
     * Registers the EXT_meshopt_compression glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterEXT_meshopt_compression(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./EXT_meshopt_compression.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the EXT_mesh_gpu_instancing extension.
         */
        ["EXT_mesh_gpu_instancing"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/README.md)
     * [Playground Sample](https://playground.babylonjs.com/#QFIGLW#9)
     */
    export class EXT_mesh_gpu_instancing implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "EXT_mesh_gpu_instancing";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /**
         * @internal
         */
        loadNodeAsync(context: string, node: BABYLON.GLTF2.Loader.INode, assign: (babylonTransformNode: TransformNode) => void): Nullable<Promise<TransformNode>>;
    }
    /**
     * Registers the EXT_mesh_gpu_instancing glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterEXT_mesh_gpu_instancing(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./EXT_mesh_gpu_instancing.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
            /** @internal */
        interface IEXTLightsImageBased_LightImageBased {
            _babylonTexture?: BaseTexture;
            _loaded?: Promise<void>;
        }



}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the EXT_lights_image_based extension.
         */
        ["EXT_lights_image_based"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_lights_image_based/README.md)
     */
    export class EXT_lights_image_based implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "EXT_lights_image_based";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        private _loader;
        private _lights?;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /** @internal */
        onLoading(): void;
        /**
         * @internal
         */
        loadSceneAsync(context: string, scene: BABYLON.GLTF2.Loader.IScene): Nullable<Promise<void>>;
        private _loadLightAsync;
    }
    /**
     * Registers the EXT_lights_image_based glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterEXT_lights_image_based(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./EXT_lights_image_based.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the EXT_lights_ies extension.
         */
        ["EXT_lights_ies"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/EXT_lights_ies)
     */
    export class EXT_lights_ies implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "EXT_lights_ies";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /** hidden */
        private _loader;
        private _lights?;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /** @internal */
        onLoading(): void;
        /**
         * @internal
         */
        loadNodeAsync(context: string, node: BABYLON.GLTF2.Loader.INode, assign: (babylonTransformNode: TransformNode) => void): Nullable<Promise<TransformNode>>;
    }
    /**
     * Registers the EXT_lights_ies glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterEXT_lights_ies(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./EXT_lights_ies.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the EXT_lights_area extension.
         */
        ["EXT_lights_area"]: {};
    }

}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_lights_area/README.md)
     */
    export class EXT_lights_area implements BABYLON.GLTF2.IGLTFLoaderExtension {
        /**
         * The name of this extension.
         */
        readonly name = "EXT_lights_area";
        /**
         * Defines whether this extension is enabled.
         */
        enabled: boolean;
        /** hidden */
        private _loader;
        private _lights?;
        /**
         * @internal
         */
        constructor(loader: BABYLON.GLTF2.GLTFLoader);
        /** @internal */
        dispose(): void;
        /** @internal */
        onLoading(): void;
        /**
         * @internal
         */
        loadNodeAsync(context: string, node: BABYLON.GLTF2.Loader.INode, assign: (babylonTransformNode: TransformNode) => void): Nullable<Promise<TransformNode>>;
    }
    /**
     * Registers the EXT_lights_area glTF loader extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterEXT_lights_area(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./EXT_lights_area.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /** Pure barrel — re-exports only side-effect-free modules */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * KHR_interactivity opaque reference representation.
     *
     * The specification gives `event/onStart`, `event/onTick`, and `event/receive` a `ref event`
     * output value socket — a runtime reference to the event instance that is consumed by
     * `event/stopPropagation` and validated via `pointer/get` on
     * `/extensions/KHR_interactivity/events/{}`. `flow/setDelay` likewise produces a delay reference
     * validated via `/extensions/KHR_interactivity/delays/{}`.
     *
     * A `ref` value is represented as a JSON Pointer string (the empty string acting as the canonical
     * "null" reference), so both namespaces are expressed as object-model pointers. These formats are
     * specific to this extension and are therefore owned here rather than by the FlowGraph engine.
     */
    /**
     * The JSON Pointer prefix shared by all KHR_interactivity event references.
     */
    export const EventReferencePrefix = "/extensions/KHR_interactivity/events/";
    /**
     * The JSON Pointer prefix shared by all KHR_interactivity delay references.
     */
    export const DelayReferencePrefix = "/extensions/KHR_interactivity/delays/";
    /**
     * Builds the event reference for a FlowGraph event source key.
     *
     * Lifecycle events use a constant key so that all instances of the same operation return the same
     * reference; custom event receivers use their event id so that receivers of the same event compare
     * equal under `ref/eq`.
     * @param key the FlowGraph event source key
     * @returns the event reference string
     */
    export function GetEventReference(key: string): string;
    /**
     * Extracts the FlowGraph event source key from an event reference.
     * @param reference the value to decode
     * @returns the event source key, or `undefined` when the value is not an event reference
     */
    export function GetEventReferenceKey(reference: string): string | undefined;
    /**
     * Returns whether the provided value is a KHR_interactivity event reference, i.e. a non-empty
     * string addressing the events object-model namespace.
     * @param value the value to test
     * @returns true if the value was produced by an event operation as a reference
     */
    export function IsEventReference(value: unknown): value is string;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Supplies the KHR_interactivity representation of opaque `ref` values to the FlowGraph engine.
     *
     * The engine itself has no notion of the glTF object model: it asks this resolver how to represent
     * event sources and runtime objects as references, and how to read one back.
     */
    export class InteractivityHostResolver implements IFlowGraphHostResolver {
        /**
         * @param key the FlowGraph event source key
         * @returns the KHR_interactivity event reference
         */
        encodeEventReference(key: string): string;
        /**
         * @param reference the value to decode
         * @returns the FlowGraph event source key, or `undefined` when the value is not an event reference
         */
        decodeEventReference(reference: string): string | undefined;
        /**
         * @param reference the reference to decode
         * @returns the index the reference denotes, or `undefined` when it is not an indexed JSON Pointer
         */
        decodeIndexReference(reference: string): number | undefined;
        /**
         * Maps a Babylon object loaded from the glTF back to a JSON Pointer addressing it.
         *
         * The glTF loader stamps `_internalMetadata.gltf.pointers` with one entry per JSON Pointer the
         * object can be addressed by; a single-primitive mesh, for example, holds both `/nodes/<i>` and
         * `/meshes/<j>/primitives/<k>`. The hint is the path segment preceding the template parameter
         * being resolved, so a template like `/nodes/{nodeRef}/globalMatrix` picks the `/nodes/<i>`
         * pointer even when another pointer was added to the object first.
         * @param object the Babylon object to address
         * @param hint the expected root segment of the pointer, when known
         * @returns the JSON Pointer for the object, or `undefined` when it is not addressable
         */
        getObjectReference(object: object, hint?: string): string | undefined;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * Description of a KHR_interactivity custom event, as parsed from the
     * glTF `events` array. Used by the importer to register the event with the
     * FlowGraph send/receive event blocks.
     */
    export interface InteractivityEvent {
        /** Identifier of the event, used to match send and receive blocks. */
        eventId: string;
        /**
         * Optional payload schema for the event. Each entry describes one
         * value carried by the event: an `id` (the FlowGraph data socket name),
         * a `type` (glTF interactivity type name) and an optional default
         * `value`. `eventData` (the boolean) is currently unused.
         */
        eventData?: {
            eventData: boolean;
            id: string;
            type: string;
            value?: any;
        }[];
    }
    export var gltfTypeToBabylonType: {
        [key: string]: {
            length: number;
            flowGraphType: FlowGraphTypes;
            elementType: "number" | "boolean" | "string";
        };
    };
    /**
     * Parses a KHR_interactivity graph definition (the raw glTF JSON object) into
     * the serialized FlowGraph form consumed by {@link ParseFlowGraphAsync}.
     *
     * The class walks the interactivity types, declarations, variables, events
     * and nodes in order and emits an {@link ISerializedFlowGraph} via
     * {@link serializeToFlowGraph}.
     */
    export class InteractivityGraphToFlowGraphParser {
        private _interactivityGraph;
        private _gltf;
        _animationTargetFps: number;
        /**
         * Note - the graph should be rejected if the same type is defined twice.
         * We currently don't validate that.
         */
        private _types;
        private _mappings;
        private _staticVariables;
        private _events;
        private _internalEventsCounter;
        private _nodes;
        /**
         * Extra blocks the parser inserts between existing nodes (e.g. the seconds→frames multiply for
         * connected animation-time inputs). Kept separate from any node's `blocks` array so per-node
         * post-processing that indexes into that array (such as the animation extraProcessors targeting
         * the last block) is not disturbed, then concatenated into the serialized graph.
         */
        private _insertedBlocks;
        constructor(_interactivityGraph: BABYLON.GLTF2.IKHRInteractivity_Graph, _gltf: BABYLON.GLTF2.Loader.IGLTF, _animationTargetFps?: number);
        get arrays(): {
            types: {
                length: number;
                flowGraphType: FlowGraphTypes;
                elementType: "number" | "boolean" | "string";
            }[];
            mappings: {
                flowGraphMapping: BABYLON.GLTF2.Loader.Extensions.IGLTFToFlowGraphMapping;
                fullOperationName: string;
            }[];
            staticVariables: {
                type: FlowGraphTypes;
                value: any[];
            }[];
            events: InteractivityEvent[];
            nodes: {
                blocks: ISerializedFlowGraphBlock[];
                fullOperationName: string;
            }[];
        };
        private _parseTypes;
        private _parseDeclarations;
        private _parseVariables;
        private _parseVariable;
        private _parseEvents;
        private _parseNodes;
        private _getEmptyBlock;
        private _parseNodeConfiguration;
        private _parseNodeConnections;
        private _createNewSocketConnection;
        /**
         * Wires an upstream data output into a downstream data input through a runtime multiply block that
         * scales the value by the animation target fps. This converts a KHR animation time (seconds),
         * delivered by a connection (e.g. a `pointer/get` on the `maxTime` animation pointer), into the
         * Babylon animation frames expected by the play/stop-animation blocks. Literal times are already
         * converted at parse time by the input's `dataTransformer`, so this is only used for connections.
         * @param context the serialized flow graph context that stores literal socket values
         * @param upstreamOutput the data output socket providing the time value (in seconds)
         * @param downstreamInput the data input socket that expects the time in frames
         */
        private _connectWithSecondsToFramesConversion;
        private _connectFlowGraphNodes;
        /**
         * Returns the deterministic FlowGraph user-variable name used for the
         * static variable at the given declaration index.
         * @param index zero-based index into the interactivity graph's `variables` array.
         * @returns the FlowGraph variable name (e.g. `staticVariable_3`).
         */
        getVariableName(index: number): string;
        /**
         * Serializes the parsed interactivity graph into the {@link ISerializedFlowGraph}
         * payload consumed by `ParseFlowGraphAsync`. Performs node-connection wiring
         * and seeds the execution context with the graph's static variables.
         * @returns the serialized FlowGraph for the parsed KHR_interactivity graph.
         */
        serializeToFlowGraph(): ISerializedFlowGraph;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
    


}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        /**
     * a configuration interface for this block
     */
    export interface IFlowGraphGLTFDataProviderBlockConfiguration extends IFlowGraphBlockConfiguration {
        /**
         * the glTF object to provide data from
         */
        glTF: BABYLON.GLTF2.Loader.IGLTF;
    }
    /**
     * a glTF-based FlowGraph block that provides arrays with babylon object, based on the glTF tree
     * Can be used, for example, to get animation index from a glTF animation
     */
    export class FlowGraphGLTFDataProvider extends FlowGraphBlock {
        /**
         * Output: an array of animation groups
         * Corresponds directly to the glTF animations array
         */
        readonly animationGroups: FlowGraphDataConnection<AnimationGroup[]>;
        /**
         * Output an array of (Transform) nodes
         * Corresponds directly to the glTF nodes array
         */
        readonly nodes: FlowGraphDataConnection<TransformNode[]>;
        constructor(config: IFlowGraphGLTFDataProviderBlockConfiguration);
        getClassName(): string;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF2.Loader.Extensions {
        interface IGLTFToFlowGraphMappingObject {
        /**
         * The name of the property in the FlowGraph block.
         */
        name: string;
        /**
         * The type of the property in the glTF specs.
         * If not provided will be inferred.
         */
        gltfType?: string;
        /**
         * The type of the property in the FlowGraph block.
         * If not defined it equals the glTF type.
         */
        flowGraphType?: string;
        /**
         * A function that transforms the data from the glTF to the FlowGraph block.
         */
        dataTransformer?: (data: any, parser: BABYLON.GLTF2.Loader.Extensions.InteractivityGraphToFlowGraphParser) => any;
        /**
         * If the property can contain multiple values.
         */
        isArray?: boolean;
        /**
         * If the property is in the options passed to the constructor of the block.
         */
        inOptions?: boolean;
        /**
         * If the property is an index to a value.
         * if defined this will be the name of the array to find the object in.
         */
        isVariable?: boolean;
        /**
         * the name of the class type this value will be mapped to.
         * This is used if we generate more than one block for a single glTF node.
         * Defaults to the first block in the mapping.
         */
        toBlock?: FlowGraphBlockNames;
        /**
         * Used in configuration values. If defined, this will be the default value, if no value is provided.
         */
        defaultValue?: any;
        /**
         * When the input value comes from a connection (an upstream node output) rather than a literal,
         * the parse-time {@link dataTransformer} cannot run. If this is `true`, the importer inserts a
         * runtime multiply block that scales the connected value by the animation target fps, converting
         * a KHR animation time (seconds) into Babylon animation frames. Literal values keep using the
         * {@link dataTransformer}. Used by `animation/start` / `animation/stopAt` time inputs, which may
         * be fed by a `pointer/get` (e.g. the read-only `maxTime` animation pointer).
         */
        convertConnectedTimeToFrames?: boolean;
    }
    /**
     * Description of how a KHR_interactivity declaration (op such as
     * `pointer/get`, `event/onSelect`, `math/add`) maps to one or more
     * FlowGraph blocks. Used by {@link BABYLON.GLTF2.Loader.Extensions.InteractivityGraphToFlowGraphParser}
     * to translate the source glTF graph into the serialized FlowGraph form.
     */
    export interface IGLTFToFlowGraphMapping {
        /**
         * The type of the FlowGraph block(s).
         * Typically will be a single element in an array.
         * When adding blocks defined in this module use the KHR_interactivity prefix.
         */
        blocks: (FlowGraphBlockNames | string)[];
        /**
         * The inputs of the glTF node mapped to the FlowGraph block.
         */
        inputs?: {
            /**
             * The value inputs of the glTF node mapped to the FlowGraph block.
             */
            values?: {
                [originName: string]: IGLTFToFlowGraphMappingObject;
            };
            /**
             * The flow inputs of the glTF node mapped to the FlowGraph block.
             */
            flows?: {
                [originName: string]: IGLTFToFlowGraphMappingObject;
            };
        };
        /**
         * The outputs of the glTF node mapped to the FlowGraph block.
         */
        outputs?: {
            /**
             * The value outputs of the glTF node mapped to the FlowGraph block.
             */
            values?: {
                [originName: string]: IGLTFToFlowGraphMappingObject;
            };
            /**
             * The flow outputs of the glTF node mapped to the FlowGraph block.
             */
            flows?: {
                [originName: string]: IGLTFToFlowGraphMappingObject;
            };
        };
        /**
         * The configuration of the glTF node mapped to the FlowGraph block.
         * This information is usually passed to the constructor of the block.
         */
        configuration?: {
            [originName: string]: IGLTFToFlowGraphMappingObject;
        };
        /**
         * If we generate more than one block for a single glTF node, this mapping will be used to map
         * between the flowGraph classes.
         */
        typeToTypeMapping?: {
            [originName: string]: IGLTFToFlowGraphMappingObject;
        };
        /**
         * The connections between two or more blocks.
         * This is used to connect the blocks in the graph
         */
        interBlockConnectors?: {
            /**
             * The name of the input connection in the first block.
             */
            input: string;
            /**
             * The name of the output connection in the second block.
             */
            output: string;
            /**
             * The index of the block in the array of blocks that corresponds to the input.
             */
            inputBlockIndex: number;
            /**
             * The index of the block in the array of blocks that corresponds to the output.
             */
            outputBlockIndex: number;
            /**
             * If the connection is a variable connection or a flow connection.
             */
            isVariable?: boolean;
        }[];
        /**
         * This optional function will allow to validate the node, according to the glTF specs.
         * For example, if a node has a configuration object, it must be present and correct.
         * This is a basic node-based validation.
         * This function is expected to return false and log the error if the node is not valid.
         * Note that this function can also modify the node, if needed.
         *
         * @param gltfBlock the glTF node to validate
         * @param interactivityGraph the interactivity graph
         * @param glTFObject the glTF object
         * @returns true if validated, false if not.
         */
        validation?: (gltfBlock: BABYLON.GLTF2.IKHRInteractivity_Node, interactivityGraph: BABYLON.GLTF2.IKHRInteractivity_Graph, glTFObject?: BABYLON.GLTF2.Loader.IGLTF) => {
            valid: boolean;
            error?: string;
        };
        /**
         * This is used if we need extra information for the constructor/options that is not provided directly by the glTF node.
         * This function can return more than one node, if extra nodes are needed for this block to function correctly.
         * Returning more than one block will usually happen when a json pointer was provided.
         *
         * @param gltfBlock the glTF node
         * @param declaration the declaration object
         * @param mapping the mapping object
         * @param parser the interactivity graph parser
         * @param serializedObjects the serialized objects
         * @param context the serialized flow graph context
         * @param globalGLTF the global gltf object
         * @returns an array of serialized nodes that will be added to the graph.
         */
        extraProcessor?: (gltfBlock: BABYLON.GLTF2.IKHRInteractivity_Node, declaration: BABYLON.GLTF2.IKHRInteractivity_Declaration, mapping: IGLTFToFlowGraphMapping, parser: BABYLON.GLTF2.Loader.Extensions.InteractivityGraphToFlowGraphParser, serializedObjects: ISerializedFlowGraphBlock[], context: ISerializedFlowGraphContext, globalGLTF?: BABYLON.GLTF2.Loader.IGLTF) => ISerializedFlowGraphBlock[];
    }
    export function getMappingForFullOperationName(fullOperationName: string): IGLTFToFlowGraphMapping | undefined;
    export function getMappingForDeclaration(declaration: BABYLON.GLTF2.IKHRInteractivity_Declaration, returnNoOpIfNotAvailable?: boolean): IGLTFToFlowGraphMapping | undefined;
    /**
     * This function will add new mapping to glTF interactivity.
     * Other extensions can define new types of blocks, this is the way to let interactivity know how to parse them.
     * @param key the type of node, i.e. "variable/get"
     * @param extension the extension of the interactivity operation, i.e. "KHR_selectability"
     * @param mapping The mapping object. See documentation or examples below.
     */
    export function addNewInteractivityFlowGraphMapping(key: string, extension: string, mapping: IGLTFToFlowGraphMapping): void;
    export function getAllSupportedNativeNodeTypes(): string[];
    /**
     *
     * These are the nodes from the specs:
    ### Math Nodes
    1. **Constants**
       - E (`math/E`) FlowGraphBlockNames.E
       - Pi (`math/Pi`) FlowGraphBlockNames.PI
       - Infinity (`math/Inf`) FlowGraphBlockNames.Inf
       - Not a Number (`math/NaN`) FlowGraphBlockNames.NaN
    2. **Arithmetic Nodes**
       - Absolute Value (`math/abs`) FlowGraphBlockNames.Abs
       - Sign (`math/sign`) FlowGraphBlockNames.Sign
       - Truncate (`math/trunc`) FlowGraphBlockNames.Trunc
       - Floor (`math/floor`) FlowGraphBlockNames.Floor
       - Ceil (`math/ceil`) FlowGraphBlockNames.Ceil
       - Round (`math/round`)  FlowGraphBlockNames.Round
       - Fraction (`math/fract`) FlowGraphBlockNames.Fract
       - Negation (`math/neg`) FlowGraphBlockNames.Negation
       - Addition (`math/add`) FlowGraphBlockNames.Add
       - Subtraction (`math/sub`) FlowGraphBlockNames.Subtract
       - Multiplication (`math/mul`) FlowGraphBlockNames.Multiply
       - Division (`math/div`) FlowGraphBlockNames.Divide
       - Remainder (`math/rem`) FlowGraphBlockNames.Modulo
       - Minimum (`math/min`) FlowGraphBlockNames.Min
       - Maximum (`math/max`) FlowGraphBlockNames.Max
       - Clamp (`math/clamp`) FlowGraphBlockNames.Clamp
       - Saturate (`math/saturate`) FlowGraphBlockNames.Saturate
       - Interpolate (`math/mix`) FlowGraphBlockNames.MathInterpolation
    3. **Comparison Nodes**
       - Equality (`math/eq`) FlowGraphBlockNames.Equality
       - Less Than (`math/lt`) FlowGraphBlockNames.LessThan
       - Less Than Or Equal To (`math/le`) FlowGraphBlockNames.LessThanOrEqual
       - Greater Than (`math/gt`) FlowGraphBlockNames.GreaterThan
       - Greater Than Or Equal To (`math/ge`) FlowGraphBlockNames.GreaterThanOrEqual
    4. **Special Nodes**
       - Is Not a Number (`math/isNaN`) FlowGraphBlockNames.IsNaN
       - Is Infinity (`math/isInf`) FlowGraphBlockNames.IsInfinity
       - Select (`math/select`) FlowGraphBlockNames.Conditional
       - Switch (`math/switch`) FlowGraphBlockNames.DataSwitch
       - Random (`math/random`) FlowGraphBlockNames.Random
    5. **Angle and Trigonometry Nodes**
       - Degrees-To-Radians (`math/rad`) FlowGraphBlockNames.DegToRad
       - Radians-To-Degrees (`math/deg`) FlowGraphBlockNames.RadToDeg
       - Sine (`math/sin`)  FlowGraphBlockNames.Sin
       - Cosine (`math/cos`) FlowGraphBlockNames.Cos
       - Tangent (`math/tan`) FlowGraphBlockNames.Tan
       - Arcsine (`math/asin`) FlowGraphBlockNames.Asin
       - Arccosine (`math/acos`) FlowGraphBlockNames.Acos
       - Arctangent (`math/atan`) FlowGraphBlockNames.Atan
       - Arctangent 2 (`math/atan2`) FlowGraphBlockNames.Atan2
    6. **Hyperbolic Nodes**
       - Hyperbolic Sine (`math/sinh`) FlowGraphBlockNames.Sinh
       - Hyperbolic Cosine (`math/cosh`) FlowGraphBlockNames.Cosh
       - Hyperbolic Tangent (`math/tanh`) FlowGraphBlockNames.Tanh
       - Inverse Hyperbolic Sine (`math/asinh`) FlowGraphBlockNames.Asinh
       - Inverse Hyperbolic Cosine (`math/acosh`) FlowGraphBlockNames.Acosh
       - Inverse Hyperbolic Tangent (`math/atanh`) FlowGraphBlockNames.Atanh
    7. **Exponential Nodes**
       - Exponent (`math/exp`) FlowGraphBlockNames.Exponential
       - Natural Logarithm (`math/log`) FlowGraphBlockNames.Log
       - Base-2 Logarithm (`math/log2`) FlowGraphBlockNames.Log2
       - Base-10 Logarithm (`math/log10`) FlowGraphBlockNames.Log10
       - Square Root (`math/sqrt`) FlowGraphBlockNames.SquareRoot
       - Cube Root (`math/cbrt`) FlowGraphBlockNames.CubeRoot
       - Power (`math/pow`) FlowGraphBlockNames.Power
    8. **Vector Nodes**
       - Length (`math/length`) FlowGraphBlockNames.Length
       - Normalize (`math/normalize`) FlowGraphBlockNames.Normalize
       - Dot Product (`math/dot`) FlowGraphBlockNames.Dot
       - Cross Product (`math/cross`) FlowGraphBlockNames.Cross
       - Rotate 2D (`math/rotate2D`) FlowGraphBlockNames.Rotate2D
       - Rotate 3D (`math/rotate3D`) FlowGraphBlockNames.Rotate3D
       - Transform (`math/transform`) FlowGraphBlockNames.TransformVector
    9. **Matrix Nodes**
       - Transpose (`math/transpose`) FlowGraphBlockNames.Transpose
       - Determinant (`math/determinant`) FlowGraphBlockNames.Determinant
       - Inverse (`math/inverse`) FlowGraphBlockNames.InvertMatrix
       - Multiplication (`math/matMul`) FlowGraphBlockNames.MatrixMultiplication
       - Compose (`math/matCompose`) FlowGraphBlockNames.MatrixCompose
       - Decompose (`math/matDecompose`) FlowGraphBlockNames.MatrixDecompose
    10. **Quaternion Nodes**
        - Conjugate (`math/quatConjugate`) FlowGraphBlockNames.Conjugate
        - Multiplication (`math/quatMul`) FlowGraphBlockNames.Multiply
        - Angle Between Quaternions (`math/quatAngleBetween`) FlowGraphBlockNames.AngleBetween
        - Quaternion From Axis Angle (`math/quatFromAxisAngle`) FlowGraphBlockNames.QuaternionFromAxisAngle
        - Quaternion To Axis Angle (`math/quatToAxisAngle`) FlowGraphBlockNames.QuaternionToAxisAngle
        - Quaternion From Two Directional Vectors (`math/quatFromDirections`) FlowGraphBlockNames.QuaternionFromDirections
    11. **Swizzle Nodes**
        - Combine (`math/combine2`, `math/combine3`, `math/combine4`, `math/combine2x2`, `math/combine3x3`, `math/combine4x4`)
            FlowGraphBlockNames.CombineVector2, FlowGraphBlockNames.CombineVector3, FlowGraphBlockNames.CombineVector4
            FlowGraphBlockNames.CombineMatrix2D, FlowGraphBlockNames.CombineMatrix3D, FlowGraphBlockNames.CombineMatrix
        - Extract (`math/extract2`, `math/extract3`, `math/extract4`, `math/extract2x2`, `math/extract3x3`, `math/extract4x4`)
            FlowGraphBlockNames.ExtractVector2, FlowGraphBlockNames.ExtractVector3, FlowGraphBlockNames.ExtractVector4
            FlowGraphBlockNames.ExtractMatrix2D, FlowGraphBlockNames.ExtractMatrix3D, FlowGraphBlockNames.ExtractMatrix
    12. **Integer Arithmetic Nodes**
        - Absolute Value (`math/abs`) FlowGraphBlockNames.Abs
        - Sign (`math/sign`) FlowGraphBlockNames.Sign
        - Negation (`math/neg`) FlowGraphBlockNames.Negation
        - Addition (`math/add`) FlowGraphBlockNames.Add
        - Subtraction (`math/sub`) FlowGraphBlockNames.Subtract
        - Multiplication (`math/mul`) FlowGraphBlockNames.Multiply
        - Division (`math/div`) FlowGraphBlockNames.Divide
        - Remainder (`math/rem`) FlowGraphBlockNames.Modulo
        - Minimum (`math/min`) FlowGraphBlockNames.Min
        - Maximum (`math/max`) FlowGraphBlockNames.Max
        - Clamp (`math/clamp`) FlowGraphBlockNames.Clamp
    13. **Integer Comparison Nodes**
        - Equality (`math/eq`) FlowGraphBlockNames.Equality
        - Less Than (`math/lt`) FlowGraphBlockNames.LessThan
        - Less Than Or Equal To (`math/le`) FlowGraphBlockNames.LessThanOrEqual
        - Greater Than (`math/gt`) FlowGraphBlockNames.GreaterThan
        - Greater Than Or Equal To (`math/ge`) FlowGraphBlockNames.GreaterThanOrEqual
    14. **Integer Bitwise Nodes**
        - Bitwise NOT (`math/not`) FlowGraphBlockNames.BitwiseNot
        - Bitwise AND (`math/and`) FlowGraphBlockNames.BitwiseAnd
        - Bitwise OR (`math/or`) FlowGraphBlockNames.BitwiseOr
        - Bitwise XOR (`math/xor`) FlowGraphBlockNames.BitwiseXor
        - Right Shift (`math/asr`) FlowGraphBlockNames.BitwiseRightShift
        - Left Shift (`math/lsl`) FlowGraphBlockNames.BitwiseLeftShift
        - Count Leading Zeros (`math/clz`) FlowGraphBlockNames.LeadingZeros
        - Count Trailing Zeros (`math/ctz`) FlowGraphBlockNames.TrailingZeros
        - Count One Bits (`math/popcnt`) FlowGraphBlockNames.OneBitsCounter
    15. **Boolean Arithmetic Nodes**
        - Equality (`math/eq`) FlowGraphBlockNames.Equality
        - Boolean NOT (`math/not`) FlowGraphBlockNames.BitwiseNot
        - Boolean AND (`math/and`) FlowGraphBlockNames.BitwiseAnd
        - Boolean OR (`math/or`) FlowGraphBlockNames.BitwiseOr
        - Boolean XOR (`math/xor`) FlowGraphBlockNames.BitwiseXor
    ### Type Conversion Nodes
    1. **Boolean Conversion Nodes**
       - Boolean to Integer (`type/boolToInt`) FlowGraphBlockNames.BooleanToInt
       - Boolean to Float (`type/boolToFloat`) FlowGraphBlockNames.BooleanToFloat
    2. **Integer Conversion Nodes**
       - Integer to Boolean (`type/intToBool`) FlowGraphBlockNames.IntToBoolean
       - Integer to Float (`type/intToFloat`) FlowGraphBlockNames.IntToFloat
    3. **Float Conversion Nodes**
       - Float to Boolean (`type/floatToBool`) FlowGraphBlockNames.FloatToBoolean
       - Float to Integer (`type/floatToInt`) FlowGraphBlockNames.FloatToInt
    ### Control Flow Nodes
    1. **Sync Nodes**
       - Sequence (`flow/sequence`) FlowGraphBlockNames.Sequence
       - Branch (`flow/branch`) FlowGraphBlockNames.Branch
       - Switch (`flow/switch`) FlowGraphBlockNames.Switch
       - While Loop (`flow/while`) FlowGraphBlockNames.WhileLoop
       - For Loop (`flow/for`) FlowGraphBlockNames.ForLoop
       - Do N (`flow/doN`) FlowGraphBlockNames.DoN
       - Multi Gate (`flow/multiGate`) FlowGraphBlockNames.MultiGate
       - Wait All (`flow/waitAll`) FlowGraphBlockNames.WaitAll
       - Throttle (`flow/throttle`) FlowGraphBlockNames.Throttle
    2. **Delay Nodes**
       - Set Delay (`flow/setDelay`) FlowGraphBlockNames.SetDelay
       - Cancel Delay (`flow/cancelDelay`) FlowGraphBlockNames.CancelDelay
    ### State Manipulation Nodes
    1. **Custom Variable Access**
       - Variable Get (`variable/get`) FlowGraphBlockNames.GetVariable
       - Variable Set (`variable/set`) FlowGraphBlockNames.SetVariable
       - Variable Interpolate (`variable/interpolate`)
    2. **Object Model Access** // TODO fully test this!!!
       - JSON Pointer Template Parsing (`pointer/get`) [FlowGraphBlockNames.GetProperty, FlowGraphBlockNames.JsonPointerParser]
       - Effective JSON Pointer Generation (`pointer/set`) [FlowGraphBlockNames.SetProperty, FlowGraphBlockNames.JsonPointerParser]
       - Pointer Get (`pointer/get`) [FlowGraphBlockNames.GetProperty, FlowGraphBlockNames.JsonPointerParser]
       - Pointer Set (`pointer/set`) [FlowGraphBlockNames.SetProperty, FlowGraphBlockNames.JsonPointerParser]
       - Pointer Interpolate (`pointer/interpolate`) [FlowGraphBlockNames.ValueInterpolation, FlowGraphBlockNames.JsonPointerParser, FlowGraphBlockNames.PlayAnimation, FlowGraphBlockNames.BezierCurveEasing]
    ### Animation Control Nodes
    1. **Animation Play** (`animation/start`) FlowGraphBlockNames.PlayAnimation
    2. **Animation Stop** (`animation/stop`) FlowGraphBlockNames.StopAnimation
    3. **Animation Stop At** (`animation/stopAt`) FlowGraphBlockNames.StopAnimation
    ### Event Nodes
    1. **Lifecycle Event Nodes**
       - On Start (`event/onStart`) FlowGraphBlockNames.SceneReadyEvent
       - On Tick (`event/onTick`) FlowGraphBlockNames.SceneTickEvent
    2. **Custom Event Nodes**
       - Receive (`event/receive`) FlowGraphBlockNames.ReceiveCustomEvent
       - Send (`event/send`) FlowGraphBlockNames.SendCustomEvent
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
        /** Pure barrel — re-exports only side-effect-free modules */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
    


}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
        /**
     * @internal
     * @deprecated
     */
    export class GLTFMaterialsCommonExtension extends BABYLON.GLTF1.GLTFLoaderExtension {
        constructor();
        loadRuntimeExtensionsAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime): boolean;
        loadMaterialAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (material: Material) => void, onError: (message: string) => void): boolean;
        private _loadTexture;
    }
    /**
     * Registers the KHR_materials_common extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterGLTFMaterialsCommonExtension(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./glTFMaterialsCommonExtension.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
        /**
     * Utils functions for GLTF
     * @internal
     * @deprecated
     */
    export class GLTFUtils {
        /**
         * Sets the given "parameter" matrix
         * @param scene the Scene object
         * @param source the source node where to pick the matrix
         * @param parameter the GLTF technique parameter
         * @param uniformName the name of the shader's uniform
         * @param shaderMaterial the shader material
         */
        static SetMatrix(scene: Scene, source: Node, parameter: BABYLON.GLTF1.IGLTFTechniqueParameter, uniformName: string, shaderMaterial: ShaderMaterial | Effect): void;
        /**
         * Sets the given "parameter" matrix
         * @param shaderMaterial the shader material
         * @param uniform the name of the shader's uniform
         * @param value the value of the uniform
         * @param type the uniform's type (EParameterType FLOAT, VEC2, VEC3 or VEC4)
         * @returns true if set, else false
         */
        static SetUniform(shaderMaterial: ShaderMaterial | Effect, uniform: string, value: any, type: number): boolean;
        /**
         * Returns the wrap mode of the texture
         * @param mode the mode value
         * @returns the wrap mode (TEXTURE_WRAP_ADDRESSMODE, MIRROR_ADDRESSMODE or CLAMP_ADDRESSMODE)
         */
        static GetWrapMode(mode: number): number;
        /**
         * Returns the byte stride giving an accessor
         * @param accessor the GLTF accessor objet
         * @returns the byte stride
         */
        static GetByteStrideFromType(accessor: BABYLON.GLTF1.IGLTFAccessor): number;
        /**
         * Returns the texture filter mode giving a mode value
         * @param mode the filter mode value
         * @returns the filter mode (TODO - needs to be a type?)
         */
        static GetTextureFilterMode(mode: number): number;
        static GetBufferFromBufferView(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, bufferView: BABYLON.GLTF1.IGLTFBufferView, byteOffset: number, byteLength: number, componentType: BABYLON.GLTF1.EComponentType): ArrayBufferView;
        /**
         * Returns a buffer from its accessor
         * @param gltfRuntime the GLTF runtime
         * @param accessor the GLTF accessor
         * @returns an array buffer view
         */
        static GetBufferFromAccessor(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, accessor: BABYLON.GLTF1.IGLTFAccessor): any;
        /**
         * Decodes a buffer view into a string
         * @param view the buffer view
         * @returns a string
         */
        static DecodeBufferToText(view: ArrayBufferView): string;
        /**
         * Returns the default material of gltf. Related to
         * https://github.com/KhronosGroup/glTF/tree/master/specification/1.0#appendix-a-default-material
         * @param scene the Babylon.js scene
         * @returns the default Babylon material
         */
        static GetDefaultMaterial(scene: Scene): ShaderMaterial;
        private static _DefaultMaterial;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
        /**
     * Enums
     * @internal
     */
    export enum EComponentType {
        BYTE = 5120,
        UNSIGNED_BYTE = 5121,
        SHORT = 5122,
        UNSIGNED_SHORT = 5123,
        FLOAT = 5126
    }
    /** @internal */
    export enum EShaderType {
        FRAGMENT = 35632,
        VERTEX = 35633
    }
    /** @internal */
    export enum EParameterType {
        BYTE = 5120,
        UNSIGNED_BYTE = 5121,
        SHORT = 5122,
        UNSIGNED_SHORT = 5123,
        INT = 5124,
        UNSIGNED_INT = 5125,
        FLOAT = 5126,
        FLOAT_VEC2 = 35664,
        FLOAT_VEC3 = 35665,
        FLOAT_VEC4 = 35666,
        INT_VEC2 = 35667,
        INT_VEC3 = 35668,
        INT_VEC4 = 35669,
        BOOL = 35670,
        BOOL_VEC2 = 35671,
        BOOL_VEC3 = 35672,
        BOOL_VEC4 = 35673,
        FLOAT_MAT2 = 35674,
        FLOAT_MAT3 = 35675,
        FLOAT_MAT4 = 35676,
        SAMPLER_2D = 35678
    }
    /** @internal */
    export enum ETextureWrapMode {
        CLAMP_TO_EDGE = 33071,
        MIRRORED_REPEAT = 33648,
        REPEAT = 10497
    }
    /** @internal */
    export enum ETextureFilterType {
        NEAREST = 9728,
        LINEAR = 9728,
        NEAREST_MIPMAP_NEAREST = 9984,
        LINEAR_MIPMAP_NEAREST = 9985,
        NEAREST_MIPMAP_LINEAR = 9986,
        LINEAR_MIPMAP_LINEAR = 9987
    }
    /** @internal */
    export enum ETextureFormat {
        ALPHA = 6406,
        RGB = 6407,
        RGBA = 6408,
        LUMINANCE = 6409,
        LUMINANCE_ALPHA = 6410
    }
    /** @internal */
    export enum ECullingType {
        FRONT = 1028,
        BACK = 1029,
        FRONT_AND_BACK = 1032
    }
    /** @internal */
    export enum EBlendingFunction {
        ZERO = 0,
        ONE = 1,
        SRC_COLOR = 768,
        ONE_MINUS_SRC_COLOR = 769,
        DST_COLOR = 774,
        ONE_MINUS_DST_COLOR = 775,
        SRC_ALPHA = 770,
        ONE_MINUS_SRC_ALPHA = 771,
        DST_ALPHA = 772,
        ONE_MINUS_DST_ALPHA = 773,
        CONSTANT_COLOR = 32769,
        ONE_MINUS_CONSTANT_COLOR = 32770,
        CONSTANT_ALPHA = 32771,
        ONE_MINUS_CONSTANT_ALPHA = 32772,
        SRC_ALPHA_SATURATE = 776
    }
    /** @internal */
    export interface IGLTFProperty {
        extensions?: {
            [key: string]: any;
        };
        extras?: object;
    }
    /** @internal */
    export interface IGLTFChildRootProperty extends IGLTFProperty {
        name?: string;
    }
    /** @internal */
    export interface IGLTFAccessor extends IGLTFChildRootProperty {
        bufferView: string;
        byteOffset: number;
        byteStride: number;
        count: number;
        type: string;
        componentType: EComponentType;
        max?: number[];
        min?: number[];
        name?: string;
    }
    /** @internal */
    export interface IGLTFBufferView extends IGLTFChildRootProperty {
        buffer: string;
        byteOffset: number;
        byteLength: number;
        byteStride: number;
        target?: number;
    }
    /** @internal */
    export interface IGLTFBuffer extends IGLTFChildRootProperty {
        uri: string;
        byteLength?: number;
        type?: string;
    }
    /** @internal */
    export interface IGLTFShader extends IGLTFChildRootProperty {
        uri: string;
        type: EShaderType;
    }
    /** @internal */
    export interface IGLTFProgram extends IGLTFChildRootProperty {
        attributes: string[];
        fragmentShader: string;
        vertexShader: string;
    }
    /** @internal */
    export interface IGLTFTechniqueParameter {
        type: number;
        count?: number;
        semantic?: string;
        node?: string;
        value?: number | boolean | string | Array<any>;
        source?: string;
        babylonValue?: any;
    }
    /** @internal */
    export interface IGLTFTechniqueCommonProfile {
        lightingModel: string;
        texcoordBindings: object;
        parameters?: Array<any>;
    }
    /** @internal */
    export interface IGLTFTechniqueStatesFunctions {
        blendColor?: number[];
        blendEquationSeparate?: number[];
        blendFuncSeparate?: number[];
        colorMask: boolean[];
        cullFace: number[];
    }
    /** @internal */
    export interface IGLTFTechniqueStates {
        enable: number[];
        functions: IGLTFTechniqueStatesFunctions;
    }
    /** @internal */
    export interface IGLTFTechnique extends IGLTFChildRootProperty {
        parameters: {
            [key: string]: IGLTFTechniqueParameter;
        };
        program: string;
        attributes: {
            [key: string]: string;
        };
        uniforms: {
            [key: string]: string;
        };
        states: IGLTFTechniqueStates;
    }
    /** @internal */
    export interface IGLTFMaterial extends IGLTFChildRootProperty {
        technique?: string;
        values: string[];
    }
    /** @internal */
    export interface IGLTFMeshPrimitive extends IGLTFProperty {
        attributes: {
            [key: string]: string;
        };
        indices: string;
        material: string;
        mode?: number;
    }
    /** @internal */
    export interface IGLTFMesh extends IGLTFChildRootProperty {
        primitives: IGLTFMeshPrimitive[];
    }
    /** @internal */
    export interface IGLTFImage extends IGLTFChildRootProperty {
        uri: string;
    }
    /** @internal */
    export interface IGLTFSampler extends IGLTFChildRootProperty {
        magFilter?: number;
        minFilter?: number;
        wrapS?: number;
        wrapT?: number;
    }
    /** @internal */
    export interface IGLTFTexture extends IGLTFChildRootProperty {
        sampler: string;
        source: string;
        format?: ETextureFormat;
        internalFormat?: ETextureFormat;
        target?: number;
        type?: number;
        babylonTexture?: Texture;
    }
    /** @internal */
    export interface IGLTFAmbienLight {
        color?: number[];
    }
    /** @internal */
    export interface IGLTFDirectionalLight {
        color?: number[];
    }
    /** @internal */
    export interface IGLTFPointLight {
        color?: number[];
        constantAttenuation?: number;
        linearAttenuation?: number;
        quadraticAttenuation?: number;
    }
    /** @internal */
    export interface IGLTFSpotLight {
        color?: number[];
        constantAttenuation?: number;
        fallOfAngle?: number;
        fallOffExponent?: number;
        linearAttenuation?: number;
        quadraticAttenuation?: number;
    }
    /** @internal */
    export interface IGLTFLight extends IGLTFChildRootProperty {
        type: string;
    }
    /** @internal */
    export interface IGLTFCameraOrthographic {
        xmag: number;
        ymag: number;
        zfar: number;
        znear: number;
    }
    /** @internal */
    export interface IGLTFCameraPerspective {
        aspectRatio: number;
        yfov: number;
        zfar: number;
        znear: number;
    }
    /** @internal */
    export interface IGLTFCamera extends IGLTFChildRootProperty {
        type: string;
    }
    /** @internal */
    export interface IGLTFAnimationChannelTarget {
        id: string;
        path: string;
    }
    /** @internal */
    export interface IGLTFAnimationChannel {
        sampler: string;
        target: IGLTFAnimationChannelTarget;
    }
    /** @internal */
    export interface IGLTFAnimationSampler {
        input: string;
        output: string;
        interpolation?: string;
    }
    /** @internal */
    export interface IGLTFAnimation extends IGLTFChildRootProperty {
        channels?: IGLTFAnimationChannel[];
        parameters?: {
            [key: string]: string;
        };
        samplers?: {
            [key: string]: IGLTFAnimationSampler;
        };
    }
    /** @internal */
    export interface IGLTFNodeInstanceSkin {
        skeletons: string[];
        skin: string;
        meshes: string[];
    }
    /** @internal */
    export interface IGLTFSkins extends IGLTFChildRootProperty {
        bindShapeMatrix: number[];
        inverseBindMatrices: string;
        jointNames: string[];
        babylonSkeleton?: Skeleton;
    }
    /** @internal */
    export interface IGLTFNode extends IGLTFChildRootProperty {
        camera?: string;
        children: string[];
        skin?: string;
        jointName?: string;
        light?: string;
        matrix: number[];
        mesh?: string;
        meshes?: string[];
        rotation?: number[];
        scale?: number[];
        translation?: number[];
        babylonNode?: Node;
    }
    /** @internal */
    export interface IGLTFScene extends IGLTFChildRootProperty {
        nodes: string[];
    }
    /** @internal */
    export interface IGLTFRuntime {
        extensions: {
            [key: string]: any;
        };
        accessors: {
            [key: string]: IGLTFAccessor;
        };
        buffers: {
            [key: string]: IGLTFBuffer;
        };
        bufferViews: {
            [key: string]: IGLTFBufferView;
        };
        meshes: {
            [key: string]: IGLTFMesh;
        };
        lights: {
            [key: string]: IGLTFLight;
        };
        cameras: {
            [key: string]: IGLTFCamera;
        };
        nodes: {
            [key: string]: IGLTFNode;
        };
        images: {
            [key: string]: IGLTFImage;
        };
        textures: {
            [key: string]: IGLTFTexture;
        };
        shaders: {
            [key: string]: IGLTFShader;
        };
        programs: {
            [key: string]: IGLTFProgram;
        };
        samplers: {
            [key: string]: IGLTFSampler;
        };
        techniques: {
            [key: string]: IGLTFTechnique;
        };
        materials: {
            [key: string]: IGLTFMaterial;
        };
        animations: {
            [key: string]: IGLTFAnimation;
        };
        skins: {
            [key: string]: IGLTFSkins;
        };
        currentScene?: object;
        scenes: {
            [key: string]: IGLTFScene;
        };
        extensionsUsed: string[];
        extensionsRequired?: string[];
        buffersCount: number;
        shaderscount: number;
        scene: Scene;
        rootUrl: string;
        loadedBufferCount: number;
        loadedBufferViews: {
            [name: string]: ArrayBufferView;
        };
        loadedShaderCount: number;
        importOnlyMeshes: boolean;
        importMeshesNames?: string[];
        dummyNodes: Node[];
        assetContainer: Nullable<AssetContainer>;
    }
    /** @internal */
    export interface INodeToRoot {
        bone: Bone;
        node: IGLTFNode;
        id: string;
    }
    /** @internal */
    export interface IJointNode {
        node: IGLTFNode;
        id: string;
    }



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
        /**
     * Implementation of the base glTF spec
     * @internal
     */
    export class GLTFLoaderBase {
        static CreateRuntime(parsedData: any, scene: Scene, rootUrl: string): BABYLON.GLTF1.IGLTFRuntime;
        static LoadBufferAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (buffer: ArrayBufferView) => void, onError: (message: string) => void, onProgress?: () => void): void;
        static LoadTextureBufferAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (buffer: Nullable<ArrayBufferView>) => void, onError: (message: string) => void): void;
        static CreateTextureAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, buffer: Nullable<ArrayBufferView>, onSuccess: (texture: Texture) => void): void;
        static LoadShaderStringAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (shaderString: string | ArrayBuffer) => void, onError?: (message: string) => void): void;
        static LoadMaterialAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (material: Material) => void, onError: (message: string) => void): void;
    }
    /**
     * glTF V1 Loader
     * @internal
     * @deprecated
     */
    export class GLTFLoader implements IGLTFLoader {
        static Extensions: {
            [name: string]: GLTFLoaderExtension;
        };
        static RegisterExtension(extension: GLTFLoaderExtension): void;
        dispose(): void;
        private _importMeshAsync;
        /**
         * Imports one or more meshes from a loaded gltf file and adds them to the scene
         * @param meshesNames a string or array of strings of the mesh names that should be loaded from the file
         * @param scene the scene the meshes should be added to
         * @param assetContainer defines the asset container to use (can be null)
         * @param data gltf data containing information of the meshes in a loaded file
         * @param rootUrl root url to load from
         * @param onProgress event that fires when loading progress has occured
         * @returns a promise containg the loaded meshes, particles, skeletons and animations
         */
        importMeshAsync(meshesNames: any, scene: Scene, assetContainer: Nullable<AssetContainer>, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void): Promise<ISceneLoaderAsyncResult>;
        private _loadAsync;
        /**
         * Imports all objects from a loaded gltf file and adds them to the scene
         * @param scene the scene the objects should be added to
         * @param data gltf data containing information of the meshes in a loaded file
         * @param rootUrl root url to load from
         * @param onProgress event that fires when loading progress has occured
         * @returns a promise which completes when objects have been loaded to the scene
         */
        loadAsync(scene: Scene, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void): Promise<void>;
        private _loadShadersAsync;
        private _loadBuffersAsync;
        private _createNodes;
    }
    /** @internal */
    export abstract class GLTFLoaderExtension {
        private _name;
        constructor(name: string);
        get name(): string;
        /**
         * Defines an override for loading the runtime
         * Return true to stop further extensions from loading the runtime
         * @param scene
         * @param data
         * @param rootUrl
         * @param onSuccess
         * @param onError
         * @returns true to stop further extensions from loading the runtime
         */
        loadRuntimeAsync(scene: Scene, data: IGLTFLoaderData, rootUrl: string, onSuccess?: (gltfRuntime: BABYLON.GLTF1.IGLTFRuntime) => void, onError?: (message: string) => void): boolean;
        /**
         * Defines an onverride for creating gltf runtime
         * Return true to stop further extensions from creating the runtime
         * @param gltfRuntime
         * @param onSuccess
         * @param onError
         * @returns true to stop further extensions from creating the runtime
         */
        loadRuntimeExtensionsAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, onSuccess: () => void, onError?: (message: string) => void): boolean;
        /**
         * Defines an override for loading buffers
         * Return true to stop further extensions from loading this buffer
         * @param gltfRuntime
         * @param id
         * @param onSuccess
         * @param onError
         * @param onProgress
         * @returns true to stop further extensions from loading this buffer
         */
        loadBufferAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (buffer: ArrayBufferView) => void, onError: (message: string) => void, onProgress?: () => void): boolean;
        /**
         * Defines an override for loading texture buffers
         * Return true to stop further extensions from loading this texture data
         * @param gltfRuntime
         * @param id
         * @param onSuccess
         * @param onError
         * @returns true to stop further extensions from loading this texture data
         */
        loadTextureBufferAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (buffer: ArrayBufferView) => void, onError: (message: string) => void): boolean;
        /**
         * Defines an override for creating textures
         * Return true to stop further extensions from loading this texture
         * @param gltfRuntime
         * @param id
         * @param buffer
         * @param onSuccess
         * @param onError
         * @returns true to stop further extensions from loading this texture
         */
        createTextureAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, buffer: ArrayBufferView, onSuccess: (texture: Texture) => void, onError: (message: string) => void): boolean;
        /**
         * Defines an override for loading shader strings
         * Return true to stop further extensions from loading this shader data
         * @param gltfRuntime
         * @param id
         * @param onSuccess
         * @param onError
         * @returns true to stop further extensions from loading this shader data
         */
        loadShaderStringAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (shaderString: string) => void, onError: (message: string) => void): boolean;
        /**
         * Defines an override for loading materials
         * Return true to stop further extensions from loading this material
         * @param gltfRuntime
         * @param id
         * @param onSuccess
         * @param onError
         * @returns true to stop further extensions from loading this material
         */
        loadMaterialAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (material: Material) => void, onError: (message: string) => void): boolean;
        static LoadRuntimeAsync(scene: Scene, data: IGLTFLoaderData, rootUrl: string, onSuccess?: (gltfRuntime: BABYLON.GLTF1.IGLTFRuntime) => void, onError?: (message: string) => void): void;
        static LoadRuntimeExtensionsAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, onSuccess: () => void, onError?: (message: string) => void): void;
        static LoadBufferAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (bufferView: ArrayBufferView) => void, onError: (message: string) => void, onProgress?: () => void): void;
        static LoadTextureAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (texture: Texture) => void, onError: (message: string) => void): void;
        static LoadShaderStringAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (shaderData: string | ArrayBuffer) => void, onError: (message: string) => void): void;
        static LoadMaterialAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (material: Material) => void, onError: (message: string) => void): void;
        private static _LoadTextureBufferAsync;
        private static _CreateTextureAsync;
        private static _ApplyExtensions;
    }
    /**
     * Registers the glTF 1.0 loader factory.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterGLTF1Loader(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./glTFLoader.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
        /**
     * @internal
     * @deprecated
     */
    export class GLTFBinaryExtension extends BABYLON.GLTF1.GLTFLoaderExtension {
        private _bin;
        constructor();
        loadRuntimeAsync(scene: Scene, data: IGLTFLoaderData, rootUrl: string, onSuccess: (gltfRuntime: BABYLON.GLTF1.IGLTFRuntime) => void): boolean;
        loadBufferAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (buffer: ArrayBufferView) => void, onError: (message: string) => void): boolean;
        loadTextureBufferAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (buffer: ArrayBufferView) => void): boolean;
        loadShaderStringAsync(gltfRuntime: BABYLON.GLTF1.IGLTFRuntime, id: string, onSuccess: (shaderString: string) => void): boolean;
    }
    /**
     * Registers the KHR_binary_glTF extension.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterGLTFBinaryExtension(): void;



}
declare namespace BABYLON {


}
declare namespace BABYLON.GLTF1 {
        /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./glTFBinaryExtension.pure" for tree-shakeable, side-effect-free usage.
     */



}
declare namespace BABYLON {

    export interface WorkerAsset {
        bytes: Uint8Array;
        fileName: string;
        files?: Record<string, Uint8Array>;
        resolveByFileName: boolean;
        glueUrl?: string;
        wasmUrl?: string;
        dataUrl?: string;
    }
    export interface ExtractRequest {
        type: "extract";
        requestId: number;
        asset: WorkerAsset;
    }
    export interface WorkerTimings {
        totalMs: number;
        stageOpenMs: number;
        stageReadMs: number;
        preparationMs: number;
        packingMs: number;
        heapCopyMs: number;
    }
    export interface WorkerStatistics {
        nodes: number;
        meshes: number;
        analyticPrimitives: number;
        instances: number;
        materials: number;
        vertices: number;
        triangles: number;
        commandBytes: number;
        dataBytes: number;
    }
    export type WorkerResponse = {
        type: "progress";
        requestId: number;
        progress: USDLoadProgress;
    } | {
        type: "log";
        requestId: number;
        level: number;
        message: string;
    } | {
        type: "result";
        requestId: number;
        commands: ArrayBuffer;
        data: ArrayBuffer;
        timings: WorkerTimings;
        statistics: WorkerStatistics;
        missingAssets: string[];
    } | {
        type: "error";
        requestId: number;
        message: string;
        stack?: string;
    };


    export interface MaterializationResult {
        container: AbstractAssetContainer & {
            dispose(): void;
        };
        materializeMs: number;
    }
    export function materializeCommandBuffers(scene: Scene, commandBuffer: ArrayBuffer, dataBuffer: ArrayBuffer, addToScene: boolean, signal?: AbortSignal): Promise<MaterializationResult>;


    /**
     * Binary input accepted for supporting USD layers and assets.
     */
    export type USDBinaryInput = ArrayBuffer | ArrayBufferView;
    /**
     * Virtual files supplied alongside the root USD layer, keyed by their path relative to the
     * root layer.
     */
    export type USDVirtualFiles = Readonly<Record<string, USDBinaryInput>>;
    /**
     * Progress phases reported by the USD worker and Babylon materializer.
     */
    export interface USDLoadProgress {
        /**
         * Current importer phase.
         */
        phase: "initializing" | "staging" | "extracting" | "materializing";
        /**
         * Human-readable phase description.
         */
        message: string;
    }
    /**
     * Options for the OpenUSD scene loader.
     */
    export interface USDFileLoaderOptions {
        /**
         * Virtual path used to stage the root layer. Set this when supporting files need
         * to resolve relative to a directory hierarchy.
         */
        rootFileName?: string;
        /**
         * Supporting layers, payloads, and textures keyed by virtual path in the same
         * virtual file system as `rootFileName`.
         */
        files?: USDVirtualFiles;
        /**
         * Enables conservative file-name fallback for unresolved absolute references.
         * Defaults to true.
         */
        resolveByFileName?: boolean;
        /**
         * URL of the module worker. Defaults to the protocol-versioned worker hosted on the Babylon.js CDN.
         */
        workerUrl?: string | URL;
        /**
         * URL of the generated Emscripten JavaScript module.
         */
        glueUrl?: string;
        /**
         * URL of the OpenUSD WebAssembly binary.
         */
        wasmUrl?: string;
        /**
         * URL of the OpenUSD preloaded resource bundle.
         */
        dataUrl?: string;
        /**
         * Called when the importer moves to a new processing phase.
         */
        onProgress?: (progress: USDLoadProgress) => void;
        /**
         * Called for OpenUSD diagnostic messages.
         */
        onLog?: (level: "info" | "warning" | "error", message: string) => void;
        /**
         * Called after extraction and Babylon.js object creation complete.
         */
        onComplete?: (diagnostics: USDImportDiagnostics) => void;
    }
    /**
     * Timing data measured by the OpenUSD worker and Babylon materializer.
     */
    export interface USDImportTimings {
        /** Total extraction time, including the final Wasm heap copy. */
        totalMs: number;
        /** Time spent opening and composing the USD stage. */
        stageOpenMs: number;
        /** Time spent traversing the composed stage. */
        stageReadMs: number;
        /** Time spent preparing renderable vertex streams. */
        preparationMs: number;
        /** Time spent packing the command and raw-data buffers. */
        packingMs: number;
        /** Time spent copying command and data buffers from the Wasm heap. */
        heapCopyMs: number;
        /** Time spent creating Babylon.js objects. */
        materializeMs: number;
    }
    /**
     * Statistics reported for an imported USD stage.
     */
    export interface USDImportStatistics {
        /** Number of transform nodes extracted from the composed stage. */
        nodes: number;
        /** Number of polygonal `UsdGeomMesh` sources. */
        meshes: number;
        /** Number of analytic cube, sphere, cylinder, and cone sources. */
        analyticPrimitives: number;
        /** Number of native Babylon instances created from shared USD geometry. */
        instances: number;
        /** Number of authored USD materials translated. */
        materials: number;
        /** Number of unique vertices in polygonal source meshes. */
        vertices: number;
        /** Number of unique triangles in polygonal source meshes. */
        triangles: number;
        /** Size of the command buffer in bytes. */
        commandBytes: number;
        /** Size of the raw-data buffer in bytes. */
        dataBytes: number;
    }
    /**
     * Diagnostics reported after a USD import completes.
     */
    export interface USDImportDiagnostics {
        /** Timing data for extraction and Babylon.js object creation. */
        timings: USDImportTimings;
        /** Counts and buffer sizes reported by the OpenUSD extractor. */
        statistics: USDImportStatistics;
        /** Asset references OpenUSD could not resolve from the supplied virtual files. */
        missingAssets: readonly string[];
    }


        interface SceneLoaderPluginOptions {
            /**
             * Defines options for the USD loader.
             */
            [USDFileLoaderMetadata.name]: Partial<USDFileLoaderOptions>;
        }


    /** This file must only contain pure code and pure imports */
    /**
     * OpenUSD scene loader backed by a WebAssembly command-buffer extractor.
     */
    export class USDFileLoader implements ISceneLoaderPluginAsync, ISceneLoaderPluginFactory {
        /**
         * Default URLs for the prebuilt OpenUSD importer assets.
         */
        static DefaultConfiguration: {
            glueUrl: string;
            wasmUrl: string;
            dataUrl: string;
            workerUrl: string;
        };
        /**
         * Defines the name of the plugin.
         */
        readonly name: "usd";
        /**
         * Defines the extensions the plugin can load.
         */
        readonly extensions: {
            readonly ".usd": {
                readonly isBinary: true;
            };
            readonly ".usda": {
                readonly isBinary: true;
            };
            readonly ".usdc": {
                readonly isBinary: true;
            };
            readonly ".usdz": {
                readonly isBinary: true;
            };
        };
        private readonly _options;
        private _worker;
        private _workerUrl;
        private _workerBlobUrl;
        private _nextRequestId;
        private readonly _pending;
        private readonly _activeLoads;
        /**
         * Creates a USD loader.
         * @param options Options controlling worker assets, supporting files, and diagnostics.
         */
        constructor(options?: Partial<USDFileLoaderOptions>);
        /**
         * Creates a configured plugin instance for a SceneLoader operation.
         * @param options SceneLoader plugin options.
         * @returns The configured USD loader.
         */
        createPlugin(options: SceneLoaderPluginOptions): ISceneLoaderPluginAsync;
        /**
         * Imports all objects from a USD stage into a scene.
         * @param _meshesNames Mesh name filtering is not currently supported.
         * @param scene The scene receiving the imported objects.
         * @param data The USD, USDA, USDC, or USDZ bytes.
         * @param rootUrl The source root URL.
         * @param onProgress SceneLoader progress callback.
         * @param fileName Name of the root USD layer.
         * @returns The imported Babylon.js objects.
         */
        importMeshAsync(_meshesNames: string | readonly string[] | null | undefined, scene: Scene, data: unknown, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string): Promise<ISceneLoaderAsyncResult>;
        /**
         * Loads a USD stage into a scene.
         * @param scene The scene receiving the imported objects.
         * @param data The USD, USDA, USDC, or USDZ bytes.
         * @param rootUrl The source root URL.
         * @param onProgress SceneLoader progress callback.
         * @param fileName Name of the root USD layer.
         */
        loadAsync(scene: Scene, data: unknown, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string): Promise<void>;
        /**
         * Loads a USD stage into an asset container.
         * @param scene The scene used to create imported objects.
         * @param data The USD, USDA, USDC, or USDZ bytes.
         * @param rootUrl The source root URL.
         * @param onProgress SceneLoader progress callback.
         * @param fileName Name of the root USD layer.
         * @returns The populated asset container.
         */
        loadAssetContainerAsync(scene: Scene, data: unknown, rootUrl: string, onProgress?: (event: ISceneLoaderProgressEvent) => void, fileName?: string): Promise<AssetContainer>;
        /**
         * Releases the worker and rejects pending loads.
         */
        dispose(): void;
        private _loadAsync;
        private _getWorker;
        private _terminateWorker;
    }
    /** @internal */
    export function _RegisterUSDLoaderDependencies(): void;
    /**
     * Registers the USD scene loader plugin and its Babylon.js runtime dependencies.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterUSDFileLoader(): void;


    /**
     * Defines the USD loader plugin metadata.
     */
    export var USDFileLoaderMetadata: {
        readonly name: "usd";
        readonly extensions: {
            readonly ".usd": {
                readonly isBinary: true;
            };
            readonly ".usda": {
                readonly isBinary: true;
            };
            readonly ".usdc": {
                readonly isBinary: true;
            };
            readonly ".usdz": {
                readonly isBinary: true;
            };
        };
    };


    /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./usdFileLoader.pure" for tree-shakeable, side-effect-free usage.
     */


    export const COMMAND_MAGIC = 1111774037;
    export const PROTOCOL_VERSION = 4;
    export const MISSING_OFFSET = 4294967295;
    export enum Command {
        Scene = 1,
        Texture = 2,
        Material = 3,
        TransformNode = 4,
        Skeleton = 5,
        Geometry = 6,
        Mesh = 7,
        Instance = 8,
        Animation = 9,
        AnalyticPrimitive = 10
    }
    export enum AnalyticPrimitiveType {
        Cube = 0,
        Sphere = 1,
        Cylinder = 2,
        Cone = 3
    }
    export enum PrimitiveAxis {
        X = 0,
        Y = 1,
        Z = 2
    }
    export enum AnimationTarget {
        Node = 0,
        Bone = 1
    }
    export enum AnimationProperty {
        Position = 0,
        RotationQuaternion = 1,
        Scaling = 2,
        Matrix = 3
    }
    export enum MaterialFlags {
        DoubleSided = 1,
        Unlit = 2,
        AlphaBlend = 4
    }
    export enum MeshFlags {
        DoubleSided = 1,
        LeftHanded = 2
    }
    export enum GeometryFlags {
        Normals = 1,
        Tangents = 2,
        Uv0 = 4,
        Colors = 8,
        Skin0 = 16,
        Skin1 = 32
    }
    export interface CommandRecord {
        opcode: Command;
        flags: number;
        payloadOffset: number;
        payloadLength: number;
    }
    export function readCommands(buffer: ArrayBuffer): CommandRecord[];
    export class PayloadReader {
        #private;
        offset: number;
        constructor(buffer: ArrayBuffer, offset: number, length: number);
        u32(): number;
        f32(): number;
    }


    /** Pure barrel — re-exports only side-effect-free modules */




        interface SceneLoaderPluginOptions {
            /**
             * Defines options for the stl loader.
             */
            [STLFileLoaderMetadata.name]: {};
        }


    /**
     * STL file type loader.
     * This is a babylon scene loader plugin.
     */
    export class STLFileLoader implements ISceneLoaderPlugin {
        /** @internal */
        solidPattern: RegExp;
        /** @internal */
        facetsPattern: RegExp;
        /** @internal */
        normalPattern: RegExp;
        /** @internal */
        vertexPattern: RegExp;
        /**
         * Defines the name of the plugin.
         */
        readonly name: "stl";
        /**
         * Defines the extensions the stl loader is able to load.
         * force data to come in as an ArrayBuffer
         * we'll convert to string if it looks like it's an ASCII .stl
         */
        readonly extensions: {
            readonly ".stl": {
                readonly isBinary: true;
            };
        };
        /**
         * Defines if Y and Z axes are swapped or not when loading an STL file.
         * The default is false to maintain backward compatibility. When set to
         * true, coordinates from the STL file are used without change.
         */
        static DO_NOT_ALTER_FILE_COORDINATES: boolean;
        /**
         * Import meshes into a scene.
         * @param meshesNames An array of mesh names, a single mesh name, or empty string for all meshes that filter what meshes are imported
         * @param scene The scene to import into
         * @param data The data to import
         * @param rootUrl The root url for scene and resources
         * @param meshes The meshes array to import into
         * @returns True if successful or false otherwise
         */
        importMesh(meshesNames: any, scene: Scene, data: any, rootUrl: string, meshes: Nullable<AbstractMesh[]>): boolean;
        /**
         * Load into a scene.
         * @param scene The scene to load into
         * @param data The data to import
         * @param rootUrl The root url for scene and resources
         * @returns true if successful or false otherwise
         */
        load(scene: Scene, data: any, rootUrl: string): boolean;
        /**
         * Load into an asset container.
         * @param scene The scene to load into
         * @param data The data to import
         * @param rootUrl The root url for scene and resources
         * @returns The loaded asset container
         */
        loadAssetContainer(scene: Scene, data: string, rootUrl: string): AssetContainer;
        private _isBinary;
        private _parseBinary;
        private _parseASCII;
    }
    /**
     * Registers the STLFileLoader scene loader plugin.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterSTLFileLoader(): void;


    export var STLFileLoaderMetadata: {
        readonly name: "stl";
        readonly extensions: {
            readonly ".stl": {
                readonly isBinary: true;
            };
        };
    };


    /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./stlFileLoader.pure" for tree-shakeable, side-effect-free usage.
     */


    /** Pure barrel — re-exports only side-effect-free modules */




    /**
     * Parses SPZ data and returns a promise resolving to an IParsedSplat object.
     * @param data The ArrayBuffer containing SPZ data.
     * @param scene The Babylon.js scene.
     * @param _loadingOptions Options for loading Gaussian Splatting files.
     * @returns A promise resolving to the parsed SPZ data.
     */
    export function ParseSpz(data: ArrayBuffer, scene: Scene, _loadingOptions: SPLATLoadingOptions): Promise<IParsedSplat>;
    /**
     * Returns the initialized spz WASM module loaded from the given URL, loading it on first call.
     * @param url URL to the spz WASM ES module (its default export should be a factory function)
     * @returns A promise resolving to the initialized spz WASM module
     */
    export function GetSpzModule(url: string): Promise<any>;
    /**
     * Converts a any object (from the spz WASM module) into the packed 32-byte-per-splat
     * ArrayBuffer and SH texture arrays expected by GaussianSplattingMeshBase.updateData.
     *
     * Packed layout per splat (32 bytes):
     *   [0-11]  position xyz   (float32 x3)
     *   [12-23] scale xyz      (float32 x3)
     *   [24-27] color RGBA     (uint8 x4, colors in [0,255], alpha in [0,255])
     *   [28-31] quaternion wxyz (uint8 x4, encoded as q * 127.5 + 127.5)
     *
     * SH coefficients from the cloud (Float32, range ~[-1,1]) are encoded to bytes
     * using the SPZ convention (load-spz.cc unquantizeSH): byte = coeff * 128 + 128.
     *
     * @param cloud The any returned by spz.loadSpzFromBuffer
     * @param scene The Babylon.js scene (used to query maxTextureSize for SH textures)
     * @param useCoroutine If true, yields periodically to avoid blocking the main thread
     * @returns A coroutine returning an IParsedSplat ready to be passed to updateData
     */
    export function ConvertSpzToSplat(cloud: any, scene: Scene, useCoroutine?: boolean): Coroutine<IParsedSplat>;
    /**
     * Async version of ConvertSpzToSplat that yields periodically to avoid blocking the main thread.
     * @param cloud The any returned by spz.loadSpzFromBuffer
     * @param scene The Babylon.js scene
     * @returns A promise resolving to an IParsedSplat
     */
    export function ConvertSpzToSplatAsync(cloud: any, scene: Scene): Promise<IParsedSplat>;


    /**
     * Options for loading Gaussian Splatting and PLY files
     */
    export type SPLATLoadingOptions = {
        /**
         * Defines if buffers should be kept in memory for editing purposes
         */
        keepInRam?: boolean;
        /**
         * Spatial Y Flip for splat position and orientation
         */
        flipY?: boolean;
        /**
         * URL to load fflate from. If null or undefined, will load from unpkg.com
         * (https://unpkg.com/fflate/umd/index.js)
         */
        deflateURL?: string;
        /**
         * Instance of [fflate](https://github.com/101arrowz/fflate) to avoid
         * dynamically loading of the lib to global if needed, useful for bundler users.
         * @example import * as fflate from 'fflate';
         */
        fflate?: unknown;
        /**
         * Disable automatic camera limits from being applied if they exist in the splat file
         */
        disableAutoCameraLimits?: boolean;
        /**
         * Mesh that will be used to load data instead of creating a new one
         */
        gaussianSplattingMesh?: GaussianSplattingMesh;
        /**
         * Generate rotation and scale matrix textures required for voxel-based IBL shadows.
         * Required for IBL shadows to work if keepInRam is false.
         */
        needsRotationScaleTextures?: boolean;
        /**
         * Load SOG files as raw GPU textures and dequantize in the shader.
         * Skips the CPU decode pass and yields much faster load times.
         * Requires WebGL2 / WebGPU. Defaults to false (CPU decode).
         */
        useSogTextures?: boolean;
        /**
         * URL to load the spz WASM ES module from (e.g. the \@adobe/spz package).
         * When provided, the WASM-based SPZ loader is used, which supports extra features
         * such as antialiasing metadata, and vendor-specific extensions such as safe-orbit
         * camera limits.
         * Defaults to the \@adobe/spz unpkg URL when WebAssembly is supported, and undefined otherwise.
         * Set to undefined to force the built-in manual SPZ parser regardless of WebAssembly support.
         * @example Setting the URL directly on the loader options
         * spzLibraryUrl: "https://unpkg.com/\@adobe/spz\@0.2.0/dist/spz.js"
         */
        spzLibraryUrl?: string;
    };


        interface SceneLoaderPluginOptions {
            /**
             * Defines options for the splat loader.
             */
            [SPLATFileLoaderMetadata.name]: Partial<SPLATLoadingOptions>;
        }


    /**
     * @experimental
     * SPLAT file type loader.
     * This is a babylon scene loader plugin.
     */
    export class SPLATFileLoader implements ISceneLoaderPluginAsync, ISceneLoaderPluginFactory {
        /**
         * Defines the name of the plugin.
         */
        readonly name: "splat";
        private _assetContainer;
        private readonly _loadingOptions;
        /**
         * Defines the extensions the splat loader is able to load.
         * force data to come in as an ArrayBuffer
         */
        readonly extensions: {
            readonly ".splat": {
                readonly isBinary: true;
            };
            readonly ".ply": {
                readonly isBinary: true;
            };
            readonly ".spz": {
                readonly isBinary: true;
            };
            readonly ".json": {
                readonly isBinary: false;
            };
            readonly ".sog": {
                readonly isBinary: true;
            };
        };
        /**
         * Creates loader for gaussian splatting files
         * @param loadingOptions options for loading and parsing splat and PLY files.
         */
        constructor(loadingOptions?: Partial<Readonly<SPLATLoadingOptions>>);
        private static readonly _DefaultLoadingOptions;
        /** @internal */
        createPlugin(options: SceneLoaderPluginOptions): ISceneLoaderPluginAsync;
        /**
         * Imports  from the loaded gaussian splatting data and adds them to the scene
         * @param meshesNames a string or array of strings of the mesh names that should be loaded from the file
         * @param scene the scene the meshes should be added to
         * @param data the gaussian splatting data to load
         * @param rootUrl root url to load from
         * @param _onProgress callback called while file is loading
         * @param _fileName Defines the name of the file to load
         * @returns a promise containing the loaded meshes, particles, skeletons and animations
         */
        importMeshAsync(meshesNames: any, scene: Scene, data: any, rootUrl: string, _onProgress?: (event: ISceneLoaderProgressEvent) => void, _fileName?: string): Promise<ISceneLoaderAsyncResult>;
        /**
         * Detects a PlayCanvas-style `lod-meta.json` payload and, if found, creates a streaming mesh for it.
         * @param scene hosting scene
         * @param data loaded file data
         * @param rootUrl root url the metadata's relative paths resolve against
         * @returns the streaming mesh, or null when the data is not SOG LOD metadata
         */
        private _tryCreateLODStream;
        private static _BuildPointCloud;
        private static _BuildMesh;
        private _unzipWithFFlateAsync;
        private _parseAsync;
        /**
         * Extracts the safe-orbit camera limits from parsed splat metadata, or null when the file
         * carries none. Exposed on the loaded mesh (GaussianSplattingMeshBase.safeOrbitCameraLimits)
         * so consumers can apply/track them regardless of the active camera type.
         * @param meta parsed splat meta data
         * @returns the parsed safe-orbit limits, or null
         */
        private static _ExtractSafeOrbitLimits;
        /**
         * Applies safe-orbit camera limits parsed from the file metadata to the scene's active
         * ArcRotateCamera. No-op when no limits are present, `disableAutoCameraLimits` is set, or the
         * active camera is not an ArcRotateCamera — in which case consumers can still read the limits
         * from the loaded mesh's `safeOrbitCameraLimits` and apply them themselves.
         * @param limits parsed safe-orbit limits (see _ExtractSafeOrbitLimits)
         * @param scene
         */
        private applyAutoCameraLimits;
        /**
         * Load into an asset container.
         * @param scene The scene to load into
         * @param data The data to import
         * @param rootUrl The root url for scene and resources
         * @returns The loaded asset container
         */
        loadAssetContainerAsync(scene: Scene, data: string, rootUrl: string): Promise<AssetContainer>;
        /**
         * Imports all objects from the loaded OBJ data and adds them to the scene
         * @param scene the scene the objects should be added to
         * @param data the OBJ data to load
         * @param rootUrl root url to load from
         * @returns a promise which completes when objects have been loaded to the scene
         */
        loadAsync(scene: Scene, data: string, rootUrl: string): Promise<void>;
        /**
         * Code from https://github.com/dylanebert/gsplat.js/blob/main/src/loaders/PLYLoader.ts Under MIT license
         * Converts a .ply data array buffer to splat
         * if data array buffer is not ply, returns the original buffer
         * @param data the .ply data to load
         * @returns the loaded splat buffer
         */
        private static _ConvertPLYToSplat;
    }
    /**
     * Registers the SPLATFileLoader scene loader plugin.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterSPLATFileLoader(): void;


    export var SPLATFileLoaderMetadata: {
        readonly name: "splat";
        readonly extensions: {
            readonly ".splat": {
                readonly isBinary: true;
            };
            readonly ".ply": {
                readonly isBinary: true;
            };
            readonly ".spz": {
                readonly isBinary: true;
            };
            readonly ".json": {
                readonly isBinary: false;
            };
            readonly ".sog": {
                readonly isBinary: true;
            };
        };
    };


    /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./splatFileLoader.pure" for tree-shakeable, side-effect-free usage.
     */


    /**
     * Indicator of the parsed ply buffer. A standard ready to use splat or an array of positions for a point cloud
     */
    export enum Mode {
        Splat = 0,
        PointCloud = 1,
        Mesh = 2,
        Reject = 3
    }
    /**
     * SOG (Self-Organized Gaussians) raw texture set + decoding parameters.
     * Used when SOG webp textures are fed directly to the GPU and dequantized in the shader.
     */
    export interface ISogTexturePack {
        /** SOG file version (1 or 2). */
        version: 1 | 2;
        /** Number of splats. */
        splatCount: number;
        /** SH degree (0..3+). */
        shDegree: number;
        /** Raw webp textures, all RGBA8 with nearest sampling. */
        meansTextureL: BaseTexture;
        meansTextureU: BaseTexture;
        scalesTexture: BaseTexture;
        quatsTexture: BaseTexture;
        sh0Texture: BaseTexture;
        shCentroidsTexture?: BaseTexture;
        shLabelsTexture?: BaseTexture;
        /** Optional codebook (v2) packed into a 1D R32F texture. Encoding:
         *  - texels [0..255]   : scales codebook
         *  - texels [256..511] : sh0 codebook
         *  - texels [512..767] : shN codebook
         */
        codebookTexture?: BaseTexture;
        /** Mins/maxs (v1) used as uniforms. */
        meansMin: [number, number, number];
        meansMax: [number, number, number];
        scalesMin?: [number, number, number];
        scalesMax?: [number, number, number];
        sh0Min?: [number, number, number, number];
        sh0Max?: [number, number, number, number];
        shnMin?: number;
        shnMax?: number;
        /** SH layout info. */
        shCoeffCount: number;
        /** CPU-side decoded positions for the depth-sort worker. */
        positions: Float32Array;
    }
    /**
     * A parsed buffer and how to use it
     */
    export interface IParsedSplat {
        data: ArrayBuffer;
        mode: Mode;
        faces?: number[];
        hasVertexColors?: boolean;
        sh?: Uint8Array[];
        shDegree?: number;
        trainedWithAntialiasing?: boolean;
        compressed?: boolean;
        rawSplat?: boolean;
        safeOrbitCameraRadiusMin?: number;
        safeOrbitCameraElevationMinMax?: [number, number];
        upAxis?: "X" | "Y" | "Z";
        chirality?: "LeftHanded" | "RightHanded";
        /** When set, the splats are to be uploaded as raw SOG textures and dequantized in the shader. */
        sogTextures?: ISogTexturePack;
    }


    /**
     * Definition of a SOG data file
     */
    export interface SOGDataFile {
        /**
         * index 0 is number of splats index 1 is number of components per splat (3 for vec3, 4 for vec4, etc.)
         */
        shape: number[];
        /**
         * type of components
         */
        dtype: string;
        /**
         * min range of data
         */
        mins?: number | number[];
        /**
         * max range of data
         */
        maxs?: number | number[];
        /**
         * palette for indexed data (quantized)
         */
        codebook?: number[];
        /**
         * type of encoding
         */
        encoding?: string;
        /**
         * number of bits for quantization (if any)
         */
        quantization?: number;
        /**
         * webp file names
         */
        files: string[];
        /**
         * SH band count (if applicable)
         */
        bands?: number;
    }
    /**
     * Definition of the root SOG data file
     */
    export interface SOGRootData {
        /**
         * version of the SOG format
         */
        version?: number;
        /**
         * mean positions of the splats
         */
        means: SOGDataFile;
        /**
         * scales of the splats
         */
        scales: SOGDataFile;
        /**
         * quaternions of the splats
         */
        quats: SOGDataFile;
        /**
         * SH0 coefficients of the splats (base color)
         */
        sh0: SOGDataFile;
        /**
         *  Optional higher order SH coefficients of the splats (lighting information)
         */
        shN?: SOGDataFile;
        /**
         * number of splats (optional, can be inferred from means.shape[0])
         */
        count?: number;
    }
    /**
     * Parse SOG data from either a SOGRootData object (with webp files loaded from rootUrl) or from a Map of filenames to Uint8Array file data (including meta.json)
     * @param dataOrFiles Either the SOGRootData or a Map of filenames to Uint8Array file data (including meta.json)
     * @param rootUrl Base URL to load webp files from (if dataOrFiles is SOGRootData)
     * @param scene The Babylon.js scene
     * @returns Parsed data
     */
    export function ParseSogMeta(dataOrFiles: SOGRootData | Map<string, Uint8Array>, rootUrl: string, scene: Scene): Promise<IParsedSplat>;
    /**
     * Parse SOG data and produce a set of GPU textures + dequantization parameters.
     * The shader will sample these raw RGBA8 textures and reconstruct positions/scales/rotations/colors/SH on the GPU.
     * @param dataOrFiles Either the SOGRootData or a Map of filenames to Uint8Array file data (including meta.json)
     * @param rootUrl Base URL to load webp files from (if dataOrFiles is SOGRootData)
     * @param scene The Babylon.js scene
     * @param computeCpuPositions When true (default), means_l/means_u are read back on the CPU and `pack.positions`
     *   is decoded for the sort worker / bounding box. Pass false when the caller will instead read the decoded
     *   centers back from the GPU work buffer — then every attribute (including means) uses the fast direct
     *   ImageBitmap upload (no `getImageData` readback) and `pack.positions` is left empty.
     * @param downloadManager Optional download manager that throttles and retries the per-file image downloads
     *   (used by the LOD streamer). When omitted, files are fetched directly. Only applies when loading from a URL.
     * @param downloadGroupId Optional group tag passed to the download manager so this file's image downloads can
     *   be cancelled together if the streamer no longer needs them.
     * @returns Parsed splat info with `sogTextures` populated.
     */
    export function ParseSogMetaAsTextures(dataOrFiles: SOGRootData | Map<string, Uint8Array>, rootUrl: string, scene: Scene, computeCpuPositions?: boolean, downloadManager?: GaussianSplattingDownloadManager, downloadGroupId?: DownloadGroupId): Promise<IParsedSplat>;




    /** Pure barrel — re-exports only side-effect-free modules */




    /** This file must only contain pure code and pure imports */
    /**
     * Shared shader names for the SOG -> decoded work-buffer copy pass.
     */
    export const GaussianSplattingWorkBufferShaderName = "gsSogDecodeToWorkBuffer";
    /**
     * Pass-through vertex shader (GLSL): the geometry is a fullscreen triangle already in NDC.
     */
    export const GaussianSplattingWorkBufferVertexShaderGLSL = "precision highp float;\nattribute vec3 position;\nvoid main() {\n    gl_Position = vec4(position.xy, 0.0, 1.0);\n}\n";
    /**
     * Fragment shader (GLSL/WebGL2): decodes one SOG source file into the decoded GS work-buffer layout,
     * writing each splat into its allocated pixel. Mirrors the USE_SOG decode in ShadersInclude/gaussianSplatting.fx
     * but outputs the decoded MRT (center, covA, covB, color) consumed by the standard (non-SOG) draw path.
     *
     * MRT layout: 0 = center (x,y,z,1), 1 = covA (Sigma00,01,02,11), 2 = covB (Sigma12,22,0,0), 3 = color (rgba).
     */
    export const GaussianSplattingWorkBufferFragmentShaderGLSL = "precision highp float;\nprecision highp int;\n\nuniform sampler2D sogMeansLTex;\nuniform sampler2D sogMeansUTex;\nuniform sampler2D sogScalesTex;\nuniform sampler2D sogQuatsTex;\nuniform sampler2D sogSh0Tex;\nuniform sampler2D sogCodebookTex;\n\nuniform vec3 sogMeansMin;\nuniform vec3 sogMeansMax;\nuniform vec3 sogScalesMin;\nuniform vec3 sogScalesMax;\nuniform vec4 sogSh0Min;\nuniform vec4 sogSh0Max;\nuniform int uVersion;\nuniform int uOffset;\nuniform int uCount;\nuniform int uDestWidth;\nuniform int uSrcWidth;\n\nlayout(location = 0) out vec4 glFragData[4];\n\nmat3 transposeM(mat3 m) {\n    return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]);\n}\n\nvoid main() {\n    ivec2 p = ivec2(gl_FragCoord.xy);\n    int global = p.y * uDestWidth + p.x;\n    if (global < uOffset || global >= uOffset + uCount) {\n        discard;\n    }\n    int k = global - uOffset;\n    ivec2 src = ivec2(k - (k / uSrcWidth) * uSrcWidth, k / uSrcWidth);\n\n    vec3 mL = texelFetch(sogMeansLTex, src, 0).xyz;\n    vec3 mU = texelFetch(sogMeansUTex, src, 0).xyz;\n    vec3 sRaw = texelFetch(sogScalesTex, src, 0).xyz;\n    vec4 qRaw = texelFetch(sogQuatsTex, src, 0);\n    vec4 c0 = texelFetch(sogSh0Tex, src, 0);\n\n    // Position: q16 = (u<<8)|l normalized; n = lerp(min,max,q16); pos = sign(n)*(exp(|n|)-1)\n    vec3 q16 = (mU * 256.0 + mL) * (255.0 / 65535.0);\n    vec3 nPos = mix(sogMeansMin, sogMeansMax, q16);\n    vec3 center = sign(nPos) * (exp(abs(nPos)) - vec3(1.0));\n\n    // Scale (v1: lerp+exp ; v2: codebook lookup)\n    vec3 splatScale;\n    if (uVersion == 2) {\n        vec3 sIdx = floor(sRaw * 255.0 + 0.5);\n        splatScale.x = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.x), 0), 0).r);\n        splatScale.y = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.y), 0), 0).r);\n        splatScale.z = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.z), 0), 0).r);\n    } else {\n        splatScale = exp(mix(sogScalesMin, sogScalesMax, sRaw));\n    }\n\n    // Quaternion (largest-omitted, mode in alpha as 252 + omitted-index)\n    const float invSqrt2 = 0.70710678118;\n    vec3 qabc = (qRaw.xyz - vec3(0.5)) * 2.0 * invSqrt2;\n    int qMode = int(qRaw.w * 255.0 + 0.5) - 252;\n    float qd = sqrt(max(0.0, 1.0 - dot(qabc, qabc)));\n    vec4 quat;\n    if (qMode == 0) {\n        quat = vec4(qd, qabc.x, qabc.y, qabc.z);\n    } else if (qMode == 1) {\n        quat = vec4(qabc.x, qd, qabc.y, qabc.z);\n    } else if (qMode == 2) {\n        quat = vec4(qabc.x, qabc.y, qd, qabc.z);\n    } else {\n        quat = vec4(qabc.x, qabc.y, qabc.z, qd);\n    }\n\n    float qw = quat.x, qx = quat.y, qy = quat.z, qz = quat.w;\n    mat3 R = mat3(\n        1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy),\n        2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx),\n        2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy)\n    );\n    mat3 S2 = mat3(\n        4.0 * splatScale.x * splatScale.x, 0.0, 0.0,\n        0.0, 4.0 * splatScale.y * splatScale.y, 0.0,\n        0.0, 0.0, 4.0 * splatScale.z * splatScale.z\n    );\n    mat3 Sigma = R * S2 * transposeM(R);\n\n    // Color (sh0)\n    const float SH_C0 = 0.28209479177387814;\n    vec3 colRgb;\n    float colA;\n    if (uVersion == 2) {\n        vec3 c3;\n        c3.x = texelFetch(sogCodebookTex, ivec2(256 + int(c0.x * 255.0 + 0.5), 0), 0).r;\n        c3.y = texelFetch(sogCodebookTex, ivec2(256 + int(c0.y * 255.0 + 0.5), 0), 0).r;\n        c3.z = texelFetch(sogCodebookTex, ivec2(256 + int(c0.z * 255.0 + 0.5), 0), 0).r;\n        colRgb = vec3(0.5) + c3 * SH_C0;\n        colA = c0.w;\n    } else {\n        vec4 cLerp = mix(sogSh0Min, sogSh0Max, c0);\n        colRgb = vec3(0.5) + cLerp.xyz * SH_C0;\n        colA = 1.0 / (1.0 + exp(-cLerp.w));\n    }\n\n    glFragData[0] = vec4(center, 1.0);\n    glFragData[1] = vec4(Sigma[0][0], Sigma[0][1], Sigma[0][2], Sigma[1][1]);\n    glFragData[2] = vec4(Sigma[1][2], Sigma[2][2], 0.0, 0.0);\n    glFragData[3] = vec4(colRgb, colA);\n}\n";
    /**
     * Pass-through vertex shader (WGSL).
     */
    export const GaussianSplattingWorkBufferVertexShaderWGSL = "\nattribute position : vec3<f32>;\n@vertex\nfn main(input : VertexInputs) -> FragmentInputs {\n    vertexOutputs.position = vec4<f32>(input.position.xy, 0.0, 1.0);\n}\n";
    /**
     * Fragment shader (WGSL/WebGPU) — same decode as the GLSL variant, writing 4 MRT attachments.
     */
    export const GaussianSplattingWorkBufferFragmentShaderWGSL = "\nvar sogMeansLTexSampler : sampler;\nvar sogMeansLTex : texture_2d<f32>;\nvar sogMeansUTexSampler : sampler;\nvar sogMeansUTex : texture_2d<f32>;\nvar sogScalesTexSampler : sampler;\nvar sogScalesTex : texture_2d<f32>;\nvar sogQuatsTexSampler : sampler;\nvar sogQuatsTex : texture_2d<f32>;\nvar sogSh0TexSampler : sampler;\nvar sogSh0Tex : texture_2d<f32>;\nvar sogCodebookTexSampler : sampler;\nvar sogCodebookTex : texture_2d<f32>;\n\nuniform sogMeansMin : vec3<f32>;\nuniform sogMeansMax : vec3<f32>;\nuniform sogScalesMin : vec3<f32>;\nuniform sogScalesMax : vec3<f32>;\nuniform sogSh0Min : vec4<f32>;\nuniform sogSh0Max : vec4<f32>;\nuniform uVersion : i32;\nuniform uOffset : i32;\nuniform uCount : i32;\nuniform uDestWidth : i32;\nuniform uSrcWidth : i32;\n\n@fragment\nfn main(input : FragmentInputs) -> FragmentOutputs {\n    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));\n    let global : i32 = p.y * uniforms.uDestWidth + p.x;\n    if (global < uniforms.uOffset || global >= uniforms.uOffset + uniforms.uCount) {\n        discard;\n    }\n    let k : i32 = global - uniforms.uOffset;\n    let src : vec2<i32> = vec2<i32>(k - (k / uniforms.uSrcWidth) * uniforms.uSrcWidth, k / uniforms.uSrcWidth);\n\n    let mL : vec3<f32> = textureLoad(sogMeansLTex, src, 0).xyz;\n    let mU : vec3<f32> = textureLoad(sogMeansUTex, src, 0).xyz;\n    let sRaw : vec3<f32> = textureLoad(sogScalesTex, src, 0).xyz;\n    let qRaw : vec4<f32> = textureLoad(sogQuatsTex, src, 0);\n    let c0 : vec4<f32> = textureLoad(sogSh0Tex, src, 0);\n\n    let q16 : vec3<f32> = (mU * 256.0 + mL) * (255.0 / 65535.0);\n    let nPos : vec3<f32> = mix(uniforms.sogMeansMin, uniforms.sogMeansMax, q16);\n    let center : vec3<f32> = sign(nPos) * (exp(abs(nPos)) - vec3<f32>(1.0));\n\n    var splatScale : vec3<f32>;\n    if (uniforms.uVersion == 2) {\n        let sIdx : vec3<f32> = floor(sRaw * 255.0 + 0.5);\n        splatScale.x = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.x), 0), 0).r);\n        splatScale.y = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.y), 0), 0).r);\n        splatScale.z = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.z), 0), 0).r);\n    } else {\n        splatScale = exp(mix(uniforms.sogScalesMin, uniforms.sogScalesMax, sRaw));\n    }\n\n    let invSqrt2 : f32 = 0.70710678118;\n    let qabc : vec3<f32> = (qRaw.xyz - vec3<f32>(0.5)) * 2.0 * invSqrt2;\n    let qMode : i32 = i32(qRaw.w * 255.0 + 0.5) - 252;\n    let qd : f32 = sqrt(max(0.0, 1.0 - dot(qabc, qabc)));\n    var quat : vec4<f32>;\n    if (qMode == 0) {\n        quat = vec4<f32>(qd, qabc.x, qabc.y, qabc.z);\n    } else if (qMode == 1) {\n        quat = vec4<f32>(qabc.x, qd, qabc.y, qabc.z);\n    } else if (qMode == 2) {\n        quat = vec4<f32>(qabc.x, qabc.y, qd, qabc.z);\n    } else {\n        quat = vec4<f32>(qabc.x, qabc.y, qabc.z, qd);\n    }\n\n    let qw : f32 = quat.x;\n    let qx : f32 = quat.y;\n    let qy : f32 = quat.z;\n    let qz : f32 = quat.w;\n    let R : mat3x3<f32> = mat3x3<f32>(\n        1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy),\n        2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx),\n        2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy)\n    );\n    let S2 : mat3x3<f32> = mat3x3<f32>(\n        4.0 * splatScale.x * splatScale.x, 0.0, 0.0,\n        0.0, 4.0 * splatScale.y * splatScale.y, 0.0,\n        0.0, 0.0, 4.0 * splatScale.z * splatScale.z\n    );\n    let Sigma : mat3x3<f32> = R * S2 * transpose(R);\n\n    let SH_C0 : f32 = 0.28209479177387814;\n    var colRgb : vec3<f32>;\n    var colA : f32;\n    if (uniforms.uVersion == 2) {\n        var c3 : vec3<f32>;\n        c3.x = textureLoad(sogCodebookTex, vec2<i32>(256 + i32(c0.x * 255.0 + 0.5), 0), 0).r;\n        c3.y = textureLoad(sogCodebookTex, vec2<i32>(256 + i32(c0.y * 255.0 + 0.5), 0), 0).r;\n        c3.z = textureLoad(sogCodebookTex, vec2<i32>(256 + i32(c0.z * 255.0 + 0.5), 0), 0).r;\n        colRgb = vec3<f32>(0.5) + c3 * SH_C0;\n        colA = c0.w;\n    } else {\n        let cLerp : vec4<f32> = mix(uniforms.sogSh0Min, uniforms.sogSh0Max, c0);\n        colRgb = vec3<f32>(0.5) + cLerp.xyz * SH_C0;\n        colA = 1.0 / (1.0 + exp(-cLerp.w));\n    }\n\n    fragmentOutputs.fragData0 = vec4<f32>(center, 1.0);\n    fragmentOutputs.fragData1 = vec4<f32>(Sigma[0][0], Sigma[0][1], Sigma[0][2], Sigma[1][1]);\n    fragmentOutputs.fragData2 = vec4<f32>(Sigma[1][2], Sigma[2][2], 0.0, 0.0);\n    fragmentOutputs.fragData3 = vec4<f32>(colRgb, colA);\n}\n";
    /**
     * Shader name for the rotation/scale decode pass (the three half-float textures voxel-IBL shadowing consumes).
     */
    export const GaussianSplattingWorkBufferRotationDecodeShaderName = "gsSogRotDecodeToWorkBuffer";
    /**
     * Rotation/scale decode fragment shader (GLSL/WebGL2). Reconstructs each splat's rotation matrix R and scale and
     * writes the three half-float textures the voxel shader samples (rotationsATexture/B/Scale). The layout lets the
     * voxel shader reconstruct the same R and scale, so streamed splats get the same ellipsoid the draw path renders:
     *   rotA     = (R col0.xyz, R col1.x)
     *   rotB     = (R col1.yz, R col2.xy)
     *   rotScale = (R col2.z, 2*scale.x, 2*scale.y, 2*scale.z)
     */
    export const GaussianSplattingWorkBufferRotationDecodeFragmentShaderGLSL = "precision highp float;\nprecision highp int;\n\nuniform sampler2D sogScalesTex;\nuniform sampler2D sogQuatsTex;\nuniform sampler2D sogCodebookTex;\n\nuniform vec3 sogScalesMin;\nuniform vec3 sogScalesMax;\nuniform int uVersion;\nuniform int uOffset;\nuniform int uCount;\nuniform int uDestWidth;\nuniform int uSrcWidth;\n\nlayout(location = 0) out vec4 glFragData[3];\n\nvoid main() {\n    ivec2 p = ivec2(gl_FragCoord.xy);\n    int global = p.y * uDestWidth + p.x;\n    if (global < uOffset || global >= uOffset + uCount) {\n        discard;\n    }\n    int k = global - uOffset;\n    ivec2 src = ivec2(k - (k / uSrcWidth) * uSrcWidth, k / uSrcWidth);\n\n    vec3 sRaw = texelFetch(sogScalesTex, src, 0).xyz;\n    vec4 qRaw = texelFetch(sogQuatsTex, src, 0);\n\n    vec3 splatScale;\n    if (uVersion == 2) {\n        vec3 sIdx = floor(sRaw * 255.0 + 0.5);\n        splatScale.x = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.x), 0), 0).r);\n        splatScale.y = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.y), 0), 0).r);\n        splatScale.z = exp(texelFetch(sogCodebookTex, ivec2(int(sIdx.z), 0), 0).r);\n    } else {\n        splatScale = exp(mix(sogScalesMin, sogScalesMax, sRaw));\n    }\n\n    const float invSqrt2 = 0.70710678118;\n    vec3 qabc = (qRaw.xyz - vec3(0.5)) * 2.0 * invSqrt2;\n    int qMode = int(qRaw.w * 255.0 + 0.5) - 252;\n    float qd = sqrt(max(0.0, 1.0 - dot(qabc, qabc)));\n    vec4 quat;\n    if (qMode == 0) {\n        quat = vec4(qd, qabc.x, qabc.y, qabc.z);\n    } else if (qMode == 1) {\n        quat = vec4(qabc.x, qd, qabc.y, qabc.z);\n    } else if (qMode == 2) {\n        quat = vec4(qabc.x, qabc.y, qd, qabc.z);\n    } else {\n        quat = vec4(qabc.x, qabc.y, qabc.z, qd);\n    }\n\n    float qw = quat.x, qx = quat.y, qy = quat.z, qz = quat.w;\n    mat3 R = mat3(\n        1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy),\n        2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx),\n        2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy)\n    );\n\n    glFragData[0] = vec4(R[0], R[1].x);\n    glFragData[1] = vec4(R[1].y, R[1].z, R[2].x, R[2].y);\n    glFragData[2] = vec4(R[2].z, 2.0 * splatScale.x, 2.0 * splatScale.y, 2.0 * splatScale.z);\n}\n";
    /**
     * Rotation/scale decode fragment shader (WGSL/WebGPU) — same decode as the GLSL variant, writing 3 half-float MRT
     * attachments.
     */
    export const GaussianSplattingWorkBufferRotationDecodeFragmentShaderWGSL = "\nvar sogScalesTexSampler : sampler;\nvar sogScalesTex : texture_2d<f32>;\nvar sogQuatsTexSampler : sampler;\nvar sogQuatsTex : texture_2d<f32>;\nvar sogCodebookTexSampler : sampler;\nvar sogCodebookTex : texture_2d<f32>;\n\nuniform sogScalesMin : vec3<f32>;\nuniform sogScalesMax : vec3<f32>;\nuniform uVersion : i32;\nuniform uOffset : i32;\nuniform uCount : i32;\nuniform uDestWidth : i32;\nuniform uSrcWidth : i32;\n\n@fragment\nfn main(input : FragmentInputs) -> FragmentOutputs {\n    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));\n    let global : i32 = p.y * uniforms.uDestWidth + p.x;\n    if (global < uniforms.uOffset || global >= uniforms.uOffset + uniforms.uCount) {\n        discard;\n    }\n    let k : i32 = global - uniforms.uOffset;\n    let src : vec2<i32> = vec2<i32>(k - (k / uniforms.uSrcWidth) * uniforms.uSrcWidth, k / uniforms.uSrcWidth);\n\n    let sRaw : vec3<f32> = textureLoad(sogScalesTex, src, 0).xyz;\n    let qRaw : vec4<f32> = textureLoad(sogQuatsTex, src, 0);\n\n    var splatScale : vec3<f32>;\n    if (uniforms.uVersion == 2) {\n        let sIdx : vec3<f32> = floor(sRaw * 255.0 + 0.5);\n        splatScale.x = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.x), 0), 0).r);\n        splatScale.y = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.y), 0), 0).r);\n        splatScale.z = exp(textureLoad(sogCodebookTex, vec2<i32>(i32(sIdx.z), 0), 0).r);\n    } else {\n        splatScale = exp(mix(uniforms.sogScalesMin, uniforms.sogScalesMax, sRaw));\n    }\n\n    let invSqrt2 : f32 = 0.70710678118;\n    let qabc : vec3<f32> = (qRaw.xyz - vec3<f32>(0.5)) * 2.0 * invSqrt2;\n    let qMode : i32 = i32(qRaw.w * 255.0 + 0.5) - 252;\n    let qd : f32 = sqrt(max(0.0, 1.0 - dot(qabc, qabc)));\n    var quat : vec4<f32>;\n    if (qMode == 0) {\n        quat = vec4<f32>(qd, qabc.x, qabc.y, qabc.z);\n    } else if (qMode == 1) {\n        quat = vec4<f32>(qabc.x, qd, qabc.y, qabc.z);\n    } else if (qMode == 2) {\n        quat = vec4<f32>(qabc.x, qabc.y, qd, qabc.z);\n    } else {\n        quat = vec4<f32>(qabc.x, qabc.y, qabc.z, qd);\n    }\n\n    let qw : f32 = quat.x;\n    let qx : f32 = quat.y;\n    let qy : f32 = quat.z;\n    let qz : f32 = quat.w;\n    let R : mat3x3<f32> = mat3x3<f32>(\n        1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy),\n        2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx),\n        2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy)\n    );\n\n    fragmentOutputs.fragData0 = vec4<f32>(R[0], R[1].x);\n    fragmentOutputs.fragData1 = vec4<f32>(R[1].y, R[1].z, R[2].x, R[2].y);\n    fragmentOutputs.fragData2 = vec4<f32>(R[2].z, 2.0 * splatScale.x, 2.0 * splatScale.y, 2.0 * splatScale.z);\n}\n";
    /**
     * Shader name for the SOG higher-order SH decode pass (bakes one packed-u32 SH texture per pass).
     */
    export const GaussianSplattingWorkBufferShDecodeShaderName = "gsSogShDecodeToWorkBuffer";
    /**
     * SH decode fragment shader (GLSL/WebGL2). Decodes one SOG file's higher-order spherical-harmonics into one
     * packed-u32 SH texture at the region offset, in the layout the draw path's `computeSHWeighted`/`decompose`
     * expects (16 SH scalar-bytes per RGBA-u32 texel, little-endian; one texel per splat). Run once per SH texture
     * (`uShTextureIndex` selects the 16 scalars written this pass). Coefficients this file lacks are written neutral
     * (128 == 0 after `decompose`), so a lower-band file mixes correctly with higher-band ones.
     */
    export const GaussianSplattingWorkBufferShDecodeFragmentShaderGLSL = "precision highp float;\nprecision highp int;\n\nuniform sampler2D sogShLabelsTex;\nuniform sampler2D sogShCentroidsTex;\nuniform sampler2D sogCodebookTex;\nuniform float sogShnMin;\nuniform float sogShnMax;\nuniform int uVersion;\nuniform int uOffset;\nuniform int uCount;\nuniform int uDestWidth;\nuniform int uSrcWidth;\nuniform int uCoeffs;\nuniform int uShTextureIndex;\n\nlayout(location = 0) out uvec4 outSh;\n\nvoid main() {\n    ivec2 p = ivec2(gl_FragCoord.xy);\n    int global = p.y * uDestWidth + p.x;\n    if (global < uOffset || global >= uOffset + uCount) {\n        discard;\n    }\n    int kLocal = global - uOffset;\n\n    // 16-bit label for this source splat (LSB in r, MSB in g), indexed over the labels texture's own width.\n    ivec2 lsz = textureSize(sogShLabelsTex, 0);\n    ivec2 lsrc = ivec2(kLocal - (kLocal / lsz.x) * lsz.x, kLocal / lsz.x);\n    vec4 labelRaw = texelFetch(sogShLabelsTex, lsrc, 0);\n    int n = int(labelRaw.r * 255.0 + 0.5) + int(labelRaw.g * 255.0 + 0.5) * 256;\n    int u = (n - (n / 64) * 64) * uCoeffs;\n    int v = n / 64;\n\n    uint packed0 = 0u;\n    uint packed1 = 0u;\n    uint packed2 = 0u;\n    uint packed3 = 0u;\n\n    for (int b = 0; b < 16; b++) {\n        int s = uShTextureIndex * 16 + b; // flat SH scalar index\n        int kc = s / 3;                    // higher-order coefficient (0-based)\n        int j = s - kc * 3;                // channel (0=r,1=g,2=b)\n        float byteVal = 128.0;             // neutral (decompose(128) ~= 0)\n        if (kc < uCoeffs) {\n            vec4 centroidRaw = texelFetch(sogShCentroidsTex, ivec2(u + kc, v), 0);\n            float ch = (j == 0) ? centroidRaw.r : ((j == 1) ? centroidRaw.g : centroidRaw.b);\n            float coeff;\n            if (uVersion == 2) {\n                int cidx = int(ch * 255.0 + 0.5);\n                coeff = texelFetch(sogCodebookTex, ivec2(512 + cidx, 0), 0).r;\n            } else {\n                coeff = mix(sogShnMin, sogShnMax, ch);\n            }\n            byteVal = clamp(coeff * 127.5 + 127.5, 0.0, 255.0);\n        }\n        uint bv = uint(byteVal + 0.5);\n        int comp = b / 4;\n        uint contrib = bv << uint((b - comp * 4) * 8);\n        if (comp == 0) { packed0 |= contrib; }\n        else if (comp == 1) { packed1 |= contrib; }\n        else if (comp == 2) { packed2 |= contrib; }\n        else { packed3 |= contrib; }\n    }\n    outSh = uvec4(packed0, packed1, packed2, packed3);\n}\n";
    /**
     * SH decode fragment shader (WGSL/WebGPU) — same as the GLSL variant. The integer output (`vec4<u32>` fragData)
     * requires the WGSL processor's integer-fragData support.
     */
    export const GaussianSplattingWorkBufferShDecodeFragmentShaderWGSL = "\nvar sogShLabelsTexSampler : sampler;\nvar sogShLabelsTex : texture_2d<f32>;\nvar sogShCentroidsTexSampler : sampler;\nvar sogShCentroidsTex : texture_2d<f32>;\nvar sogCodebookTexSampler : sampler;\nvar sogCodebookTex : texture_2d<f32>;\n\nuniform sogShnMin : f32;\nuniform sogShnMax : f32;\nuniform uVersion : i32;\nuniform uOffset : i32;\nuniform uCount : i32;\nuniform uDestWidth : i32;\nuniform uSrcWidth : i32;\nuniform uCoeffs : i32;\nuniform uShTextureIndex : i32;\n\n@fragment\nfn main(input : FragmentInputs) -> FragmentOutputs {\n    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));\n    let global : i32 = p.y * uniforms.uDestWidth + p.x;\n    if (global < uniforms.uOffset || global >= uniforms.uOffset + uniforms.uCount) {\n        discard;\n    }\n    let kLocal : i32 = global - uniforms.uOffset;\n\n    let lsz : vec2<i32> = vec2<i32>(textureDimensions(sogShLabelsTex, 0));\n    let lsrc : vec2<i32> = vec2<i32>(kLocal - (kLocal / lsz.x) * lsz.x, kLocal / lsz.x);\n    let labelRaw : vec4<f32> = textureLoad(sogShLabelsTex, lsrc, 0);\n    let n : i32 = i32(labelRaw.r * 255.0 + 0.5) + i32(labelRaw.g * 255.0 + 0.5) * 256;\n    let u : i32 = (n - (n / 64) * 64) * uniforms.uCoeffs;\n    let v : i32 = n / 64;\n\n    var packed : array<u32, 4> = array<u32, 4>(0u, 0u, 0u, 0u);\n\n    for (var b : i32 = 0; b < 16; b = b + 1) {\n        let s : i32 = uniforms.uShTextureIndex * 16 + b;\n        let kc : i32 = s / 3;\n        let j : i32 = s - kc * 3;\n        var byteVal : f32 = 128.0;\n        if (kc < uniforms.uCoeffs) {\n            let centroidRaw : vec4<f32> = textureLoad(sogShCentroidsTex, vec2<i32>(u + kc, v), 0);\n            var ch : f32 = centroidRaw.b;\n            if (j == 0) { ch = centroidRaw.r; } else if (j == 1) { ch = centroidRaw.g; }\n            var coeff : f32;\n            if (uniforms.uVersion == 2) {\n                let cidx : i32 = i32(ch * 255.0 + 0.5);\n                coeff = textureLoad(sogCodebookTex, vec2<i32>(512 + cidx, 0), 0).r;\n            } else {\n                coeff = mix(uniforms.sogShnMin, uniforms.sogShnMax, ch);\n            }\n            byteVal = clamp(coeff * 127.5 + 127.5, 0.0, 255.0);\n        }\n        let bv : u32 = u32(byteVal + 0.5);\n        let comp : i32 = b / 4;\n        packed[comp] = packed[comp] | (bv << u32((b - comp * 4) * 8));\n    }\n    fragmentOutputs.fragData0 = vec4<u32>(packed[0], packed[1], packed[2], packed[3]);\n}\n";
    /**
     * Shader name for the work-buffer relayout (defrag/compaction) copy pass.
     */
    export const GaussianSplattingWorkBufferRelayoutShaderName = "gsWorkBufferRelayout";
    /**
     * Relayout copy fragment shader (GLSL/WebGL2). Copies the four decoded work-buffer textures from a source
     * layout to a destination layout, one output texel per draw. In map mode (`uUseMap == 1`) each destination
     * texel reads its source splat index from `uMapTex` (R32F; a negative value marks a gap and is discarded so
     * the cleared destination stays zero). In identity mode the source texel equals the destination texel.
     */
    export const GaussianSplattingWorkBufferRelayoutFragmentShaderGLSL = "precision highp float;\nprecision highp int;\n\nuniform sampler2D uMapTex;\nuniform sampler2D uSrc0;\nuniform sampler2D uSrc1;\nuniform sampler2D uSrc2;\nuniform sampler2D uSrc3;\nuniform int uDstWidth;\nuniform int uSrcWidth;\nuniform int uUseMap;\n// Region-scoped relayout (hosted compound atlas), both default 0 (standalone square path unchanged):\n//   uSrcBaseOffset \u2014 added to the map's (region-local) source index so pass 1 reads the correct GLOBAL atlas texel.\n//   uDstBaseRow    \u2014 subtracted from the atlas destination row so pass 2's identity copy reads the region-local temp.\nuniform int uSrcBaseOffset;\nuniform int uDstBaseRow;\n\nlayout(location = 0) out vec4 glFragData[4];\n\nvoid main() {\n    ivec2 p = ivec2(gl_FragCoord.xy);\n    int srcIdx;\n    if (uUseMap == 1) {\n        float m = texelFetch(uMapTex, p, 0).r;\n        if (m < 0.0) {\n            discard;\n        }\n        srcIdx = uSrcBaseOffset + int(m + 0.5);\n    } else {\n        srcIdx = (p.y - uDstBaseRow) * uDstWidth + p.x;\n    }\n    ivec2 s = ivec2(srcIdx - (srcIdx / uSrcWidth) * uSrcWidth, srcIdx / uSrcWidth);\n    glFragData[0] = texelFetch(uSrc0, s, 0);\n    glFragData[1] = texelFetch(uSrc1, s, 0);\n    glFragData[2] = texelFetch(uSrc2, s, 0);\n    glFragData[3] = texelFetch(uSrc3, s, 0);\n}\n";
    /**
     * Shader name for the INTEGER (packed-u32 SH) relayout/backup copy pass. Same index/map/base math as the float
     * relayout shader, but samples ONE integer SH source texture (`usampler2D`) and writes ONE integer attachment,
     * so it moves one baked SH texture per pass (parallel to the four-out float copy).
     */
    export const GaussianSplattingWorkBufferShCopyShaderName = "gsWorkBufferShCopy";
    /**
     * Integer SH relayout/backup copy fragment shader (GLSL/WebGL2). Copies one packed-u32 SH texture from a source
     * layout to a destination layout, one output texel per draw. Map mode (`uUseMap == 1`) reads each destination
     * texel's source splat index from `uMapTex` (R32F; negative = gap, discarded); identity mode copies texel-for-texel
     * (region backup/restore). `uSrcBaseOffset`/`uDstBaseRow` scope the copy to a hosted region's atlas rows (default 0).
     */
    export const GaussianSplattingWorkBufferShCopyFragmentShaderGLSL = "precision highp float;\nprecision highp int;\nprecision highp usampler2D;\n\nuniform sampler2D uMapTex;\nuniform usampler2D uSrcSh;\nuniform int uDstWidth;\nuniform int uSrcWidth;\nuniform int uUseMap;\nuniform int uSrcBaseOffset;\nuniform int uDstBaseRow;\n\nlayout(location = 0) out uvec4 outSh;\n\nvoid main() {\n    ivec2 p = ivec2(gl_FragCoord.xy);\n    int srcIdx;\n    if (uUseMap == 1) {\n        float m = texelFetch(uMapTex, p, 0).r;\n        if (m < 0.0) {\n            discard;\n        }\n        srcIdx = uSrcBaseOffset + int(m + 0.5);\n    } else {\n        srcIdx = (p.y - uDstBaseRow) * uDstWidth + p.x;\n    }\n    ivec2 s = ivec2(srcIdx - (srcIdx / uSrcWidth) * uSrcWidth, srcIdx / uSrcWidth);\n    outSh = texelFetch(uSrcSh, s, 0);\n}\n";
    /**
     * Integer SH relayout/backup copy fragment shader (WGSL/WebGPU) — same copy as the GLSL variant. The integer output
     * (`vec4<u32>` fragData) requires the WGSL processor's integer-fragData support.
     */
    export const GaussianSplattingWorkBufferShCopyFragmentShaderWGSL = "\nvar uMapTexSampler : sampler;\nvar uMapTex : texture_2d<f32>;\n// Integer source sampled via textureLoad only \u2014 NO paired sampler (a sampler on a Uint texture fails WebGPU\n// validation: \"None of the supported sample types (Uint)\"). Mirrors the draw shader's shTexture0 declaration.\nvar uSrcSh : texture_2d<u32>;\n\nuniform uDstWidth : i32;\nuniform uSrcWidth : i32;\nuniform uUseMap : i32;\nuniform uSrcBaseOffset : i32;\nuniform uDstBaseRow : i32;\n\n@fragment\nfn main(input : FragmentInputs) -> FragmentOutputs {\n    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));\n    var srcIdx : i32;\n    if (uniforms.uUseMap == 1) {\n        let m : f32 = textureLoad(uMapTex, p, 0).r;\n        if (m < 0.0) {\n            discard;\n        }\n        srcIdx = uniforms.uSrcBaseOffset + i32(m + 0.5);\n    } else {\n        srcIdx = (p.y - uniforms.uDstBaseRow) * uniforms.uDstWidth + p.x;\n    }\n    let s : vec2<i32> = vec2<i32>(srcIdx - (srcIdx / uniforms.uSrcWidth) * uniforms.uSrcWidth, srcIdx / uniforms.uSrcWidth);\n    // Wrap in an explicit vec4<u32> so the WGSL processor emits an integer fragData location (its detection keys\n    // off a literal vec4<u32>/vec4u in the assignment; a bare textureLoad(...) would default to vec4<f32>).\n    fragmentOutputs.fragData0 = vec4<u32>(textureLoad(uSrcSh, s, 0));\n}\n";
    /**
     * Shader name for the rotation/scale relayout/backup copy pass. Same index/map/base math as the four-out float
     * relayout shader, but moves the THREE half-float rotation/scale textures in one pass (their own separate atlas).
     */
    export const GaussianSplattingWorkBufferRotCopyShaderName = "gsWorkBufferRotCopy";
    /**
     * Rotation/scale relayout/backup copy fragment shader (GLSL/WebGL2). Copies the three half-float rotation/scale
     * textures from a source layout to a destination layout, one output texel per draw. Identical to the four-out
     * float relayout shader but with three attachments (the rotation atlas has no fourth texture).
     */
    export const GaussianSplattingWorkBufferRotCopyFragmentShaderGLSL = "precision highp float;\nprecision highp int;\n\nuniform sampler2D uMapTex;\nuniform sampler2D uSrc0;\nuniform sampler2D uSrc1;\nuniform sampler2D uSrc2;\nuniform int uDstWidth;\nuniform int uSrcWidth;\nuniform int uUseMap;\nuniform int uSrcBaseOffset;\nuniform int uDstBaseRow;\n\nlayout(location = 0) out vec4 glFragData[3];\n\nvoid main() {\n    ivec2 p = ivec2(gl_FragCoord.xy);\n    int srcIdx;\n    if (uUseMap == 1) {\n        float m = texelFetch(uMapTex, p, 0).r;\n        if (m < 0.0) {\n            discard;\n        }\n        srcIdx = uSrcBaseOffset + int(m + 0.5);\n    } else {\n        srcIdx = (p.y - uDstBaseRow) * uDstWidth + p.x;\n    }\n    ivec2 s = ivec2(srcIdx - (srcIdx / uSrcWidth) * uSrcWidth, srcIdx / uSrcWidth);\n    glFragData[0] = texelFetch(uSrc0, s, 0);\n    glFragData[1] = texelFetch(uSrc1, s, 0);\n    glFragData[2] = texelFetch(uSrc2, s, 0);\n}\n";
    /**
     * Rotation/scale relayout/backup copy fragment shader (WGSL/WebGPU) — same copy as the GLSL variant, 3 attachments.
     */
    export const GaussianSplattingWorkBufferRotCopyFragmentShaderWGSL = "\nvar uMapTexSampler : sampler;\nvar uMapTex : texture_2d<f32>;\nvar uSrc0Sampler : sampler;\nvar uSrc0 : texture_2d<f32>;\nvar uSrc1Sampler : sampler;\nvar uSrc1 : texture_2d<f32>;\nvar uSrc2Sampler : sampler;\nvar uSrc2 : texture_2d<f32>;\n\nuniform uDstWidth : i32;\nuniform uSrcWidth : i32;\nuniform uUseMap : i32;\nuniform uSrcBaseOffset : i32;\nuniform uDstBaseRow : i32;\n\n@fragment\nfn main(input : FragmentInputs) -> FragmentOutputs {\n    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));\n    var srcIdx : i32;\n    if (uniforms.uUseMap == 1) {\n        let m : f32 = textureLoad(uMapTex, p, 0).r;\n        if (m < 0.0) {\n            discard;\n        }\n        srcIdx = uniforms.uSrcBaseOffset + i32(m + 0.5);\n    } else {\n        srcIdx = (p.y - uniforms.uDstBaseRow) * uniforms.uDstWidth + p.x;\n    }\n    let s : vec2<i32> = vec2<i32>(srcIdx - (srcIdx / uniforms.uSrcWidth) * uniforms.uSrcWidth, srcIdx / uniforms.uSrcWidth);\n    fragmentOutputs.fragData0 = textureLoad(uSrc0, s, 0);\n    fragmentOutputs.fragData1 = textureLoad(uSrc1, s, 0);\n    fragmentOutputs.fragData2 = textureLoad(uSrc2, s, 0);\n}\n";
    /**
     * Relayout copy fragment shader (WGSL/WebGPU) — same copy as the GLSL variant.
     */
    export const GaussianSplattingWorkBufferRelayoutFragmentShaderWGSL = "\nvar uMapTexSampler : sampler;\nvar uMapTex : texture_2d<f32>;\nvar uSrc0Sampler : sampler;\nvar uSrc0 : texture_2d<f32>;\nvar uSrc1Sampler : sampler;\nvar uSrc1 : texture_2d<f32>;\nvar uSrc2Sampler : sampler;\nvar uSrc2 : texture_2d<f32>;\nvar uSrc3Sampler : sampler;\nvar uSrc3 : texture_2d<f32>;\n\nuniform uDstWidth : i32;\nuniform uSrcWidth : i32;\nuniform uUseMap : i32;\n// Region-scoped relayout (hosted compound atlas), both default 0 (standalone square path unchanged).\nuniform uSrcBaseOffset : i32;\nuniform uDstBaseRow : i32;\n\n@fragment\nfn main(input : FragmentInputs) -> FragmentOutputs {\n    let p : vec2<i32> = vec2<i32>(i32(fragmentInputs.position.x), i32(fragmentInputs.position.y));\n    var srcIdx : i32;\n    if (uniforms.uUseMap == 1) {\n        let m : f32 = textureLoad(uMapTex, p, 0).r;\n        if (m < 0.0) {\n            discard;\n        }\n        srcIdx = uniforms.uSrcBaseOffset + i32(m + 0.5);\n    } else {\n        srcIdx = (p.y - uniforms.uDstBaseRow) * uniforms.uDstWidth + p.x;\n    }\n    let s : vec2<i32> = vec2<i32>(srcIdx - (srcIdx / uniforms.uSrcWidth) * uniforms.uSrcWidth, srcIdx / uniforms.uSrcWidth);\n    fragmentOutputs.fragData0 = textureLoad(uSrc0, s, 0);\n    fragmentOutputs.fragData1 = textureLoad(uSrc1, s, 0);\n    fragmentOutputs.fragData2 = textureLoad(uSrc2, s, 0);\n    fragmentOutputs.fragData3 = textureLoad(uSrc3, s, 0);\n}\n";


    /**
     * A unified, GPU-decoded Gaussian Splatting work buffer.
     *
     * Holds a square MRT texture set (centers / covA / covB / colors) sized to a fixed splat capacity
     * (`ceil(sqrt(capacity))`). Each streamed SOG file is decoded directly on the GPU
     * (no CPU readback) into its allocated pixel range. The decoded textures are consumed unchanged by the
     * standard (non-SOG) Gaussian Splatting draw path.
     *
     * @experimental
     */
    export class GaussianSplattingWorkBuffer {
        private readonly _scene;
        private _mrt;
        private readonly _textureSize;
        private readonly _shaderLanguage;
        private readonly _material;
        private readonly _quad;
        private readonly _ownsMrt;
        private _baseOffset;
        private readonly _capacity;
        private _copyMaterial;
        private _relayoutMapData;
        private _relayoutMapTexture;
        private _backupMrt;
        private _disposed;
        private _readFbo;
        private _shMrts;
        private _ownsShMrts;
        private _shMaterial;
        private _shCopyMaterial;
        private _backupShMrts;
        private _rotMrt;
        private _ownsRotMrt;
        private _rotMaterial;
        private _rotCopyMaterial;
        private _backupRotMrt;
        /**
         * True when the engine supports the non-blocking GPU readback used by {@link readCentersRangeAsync}:
         * WebGL2 (PBO + fence) or WebGPU (copyTextureToBuffer + mapAsync). When false (e.g. WebGL1), callers must
         * decode positions on the CPU instead.
         */
        get supportsAsyncCentersReadback(): boolean;
        /**
         * Square edge length (in pixels) of the work-buffer textures.
         */
        get textureSize(): number;
        /**
         * The decoded work-buffer textures: [centers, covA, covB, colors].
         */
        get textures(): Texture[];
        /**
         * The baked higher-order SH textures (packed-u32, one per `ceil(coeffs*3/16)`), consumed by the draw path's
         * `computeSHWeighted`/`decompose` as `shTexture0..N`. Empty when SH decoding is not enabled.
         */
        get shTextures(): Texture[];
        /**
         * The decoded rotation/scale textures ([rotationsA, rotationsB, rotationScale], half-float), consumed by the
         * voxel-IBL path as `rotationsATexture`/`rotationsBTexture`/`rotationScaleTexture`. Empty when rotation decode
         * is not enabled.
         */
        get rotationTextures(): Texture[];
        /**
         * Creates a work buffer sized to hold `capacity` splats.
         *
         * Standalone (default): the work buffer creates and owns a square MRT sized `ceil(sqrt(capacity))`, with
         * decodes addressed from splat 0.
         *
         * Hosted (`externalAtlas` provided): the work buffer decodes/reads back into an externally-owned MRT (a
         * compound mesh's shared atlas) instead of creating its own. Decodes are placed at `externalAtlas.baseOffset`
         * (the reserved region's first splat) and addressed over `externalAtlas.width` (the wide atlas width), so the
         * streamed splats land in the compound's atlas and sort/draw together with the static parts.
         * @param scene hosting scene
         * @param capacity total number of splats the work buffer must address
         * @param externalAtlas optional external atlas to decode into instead of creating an owned square MRT
         * @param sh optional higher-order SH decode configuration. `textureCount = ceil(coeffs*3/16)` for the max SH
         *   degree across the streamed files. Standalone: the work buffer creates that many owned single-attachment
         *   integer render targets. Hosted: `externalMrts` are the compound's shared SH atlas targets (borrowed).
         * @param rotationScale optional rotation/scale decode configuration (for voxel-IBL shadows). When present the
         *   work buffer decodes each splat's rotation matrix + scale into a 3-attachment half-float target. Standalone:
         *   the work buffer creates and owns that target. Hosted: `externalMrt` is the compound's shared rotation atlas.
         */
        constructor(scene: Scene, capacity: number, externalAtlas?: {
            mrt: MultiRenderTarget;
            width: number;
            baseOffset: number;
        }, sh?: {
            textureCount: number;
            externalMrts?: MultiRenderTarget[];
        }, rotationScale?: {
            externalMrt?: MultiRenderTarget;
        });
        /**
         * Rebinds a hosted work buffer to a new atlas MRT (after the compound recreated it on a grow). No-op for a
         * standalone work buffer, which owns its MRT.
         * @param mrt the compound's new shared atlas
         */
        rebindAtlas(mrt: MultiRenderTarget): void;
        /**
         * Rebinds a hosted work buffer to the compound's NEW shared SH atlas (after the compound recreated it on a
         * grow/compaction). No-op when SH isn't in use or the work buffer owns its SH targets (standalone).
         * @param shMrts the compound's new shared SH render targets (one per packed-u32 SH texture)
         */
        rebindShAtlas(shMrts: Nullable<MultiRenderTarget[]>): void;
        /**
         * Rebinds a hosted work buffer to the compound's NEW shared rotation atlas (after the compound recreated it on a
         * grow/compaction). No-op when rotation isn't in use or the work buffer owns its rotation target (standalone).
         * @param rotMrt the compound's new shared rotation atlas
         */
        rebindRotAtlas(rotMrt: Nullable<MultiRenderTarget>): void;
        /**
         * Relocates this hosted region to a new base splat offset in the shared atlas (used when the compound
         * compacts its atlas and this region's rows move). Subsequent decode/render/readback and
         * {@link restoreRegion} all address from the new base. Call between {@link backupRegion} (which read from
         * the old base) and {@link restoreRegion} (which will write to the new base). No-op for a standalone
         * work buffer, which owns its square MRT at base 0.
         * @param baseOffset the region's new first splat index in the atlas
         */
        setBaseOffset(baseOffset: number): void;
        /**
         * True once the backup/restore/relayout copy shaders are compiled, so {@link backupRegion} can preserve the
         * region across an atlas rebuild. Callers that decode into a hosted region should await this before writing
         * data, so a later grow/compaction can never race shader compilation and drop the region.
         */
        get canBackup(): boolean;
        /**
         * Copies this hosted region's four decoded textures out of the shared atlas into an internal backup MRT so
         * they survive the compound recreating the atlas on a grow. Call immediately before the atlas is recreated,
         * then {@link rebindAtlas} + {@link restoreRegion} after.
         */
        backupRegion(): void;
        /**
         * Restores the backed-up region into the (new) atlas, confined by a scissor to the region's rows so no other
         * part is touched. Call {@link rebindAtlas} to the new atlas first. Frees the backup afterwards.
         */
        restoreRegion(): void;
        /**
         * Creates a 4-attachment MRT (centers F32 / covA / covB / colors U8) sized to the work buffer. covA/covB
         * use HALF_FLOAT when the engine can render to it, matching the precision the non-streamed
         * GaussianSplattingMesh path already uses for these same two textures (see
         * `gaussianSplattingMeshBase.pure.ts`'s `createTextureFromDataF16` covA/covB textures); centers stays F32
         * and colors stays U8 in both paths.
         * @param name MRT and attachment base name
         * @param disableClear when true, clearing is suppressed so renders accumulate (the decode buffer); when
         *   false the MRT clears to zero on each render (the temporary relayout buffer, so gaps stay zeroed)
         * @param width texture width (defaults to the work-buffer size; the region row width for a scoped relayout)
         * @param height texture height (defaults to the work-buffer size; the region row count for a scoped relayout)
         * @returns the created MRT
         */
        private _createMrt;
        /**
         * Creates a single-attachment integer render target (RGBA_INTEGER / UNSIGNED_INTEGER) that holds one packed-u32
         * baked-SH texture. One attachment per pass keeps within WebGPU's per-sample color-attachment byte budget and
         * matches the format/type of the draw path's `shTexture0..N` samplers (`_GaussianSplattingBytesPerShTexel`).
         * @param name attachment name
         * @param disableClear when true, clearing is suppressed so SH decodes accumulate across files
         * @param width texture width (defaults to the work-buffer size)
         * @param height texture height (defaults to the work-buffer size)
         * @returns the created single-attachment integer MRT
         */
        private _createShMrt;
        /**
         * Creates a 3-attachment half-float MRT ([rotA, rotB, rotScale]) holding the per-splat rotation matrix + scale
         * consumed by voxel-IBL shadowing. RGBA half-float when the engine can render to it (matching the covariance
         * precision), else full float. 3 attachments = 24 B/sample, within WebGPU's per-sample budget (its own pass).
         * @param name MRT and attachment base name
         * @param disableClear when true, clearing is suppressed so decodes accumulate (the decode buffer)
         * @param width texture width (defaults to the work-buffer size; the region row width for a scoped relayout)
         * @param height texture height (defaults to the work-buffer size; the region row count for a scoped relayout)
         * @returns the created MRT
         */
        private _createRotMrt;
        /**
         * Decodes one SOG file into the work buffer at the given splat offset (accumulating; previously
         * decoded files are preserved). Resolves once the GPU decode has been issued. The caller may
         * dispose the source pack textures after this resolves.
         * @param pack the SOG texture pack (GPU source textures + per-file decode parameters)
         * @param offset first splat index (pixel offset) for this file in the work buffer
         */
        decodeAsync(pack: ISogTexturePack, offset: number): Promise<void>;
        /**
         * Whether the relayout copy shader is compiled and ready. Lazily creates the copy material on first call.
         * Callers should poll this before {@link relayoutSync} (which must only run when ready).
         * @returns true when {@link relayoutSync} can run this frame
         */
        isRelayoutReady(): boolean;
        /**
         * Re-points the relayout/backup copy materials' samplers at the live atlas textures (valid, never freed), so a
         * later {@link isRelayoutReady} check isn't tripped by a stale binding to a disposed temp/backup MRT.
         */
        private _bindCopyMaterialsToAtlas;
        /**
         * Relayouts the decoded work-buffer textures to a new (defragmented) splat layout, keeping the same
         * texture instances so the consuming mesh does not need to re-bind. `srcIndexByDst[d]` is the source splat
         * index whose decoded data should end up at destination index `d`, or a negative value for a gap (left
         * zeroed). Uses a temporary MRT ping-pong (old -> temp via the map, then temp -> old identity) so
         * overlapping moves stay correct. Must be called at a frame-safe point (inside `onBeforeRender`) and only
         * when {@link isRelayoutReady} returns true.
         * @param srcIndexByDst per-destination source splat index (negative = gap)
         */
        relayoutSync(srcIndexByDst: Float32Array): void;
        /**
         * Renders one relayout copy pass into the target MRT, sampling the given source textures.
         * @param target destination MRT
         * @param sources the four source work-buffer textures
         * @param mapTexture the R32F destination-to-source index map (only sampled when `useMap` is 1; any bound texture otherwise)
         * @param useMap 1 to read source indices from the map (gaps discarded), 0 for an identity copy
         * @param dstWidth destination width used to linearize the destination texel (defaults to the work-buffer size)
         * @param srcWidth source width used to convert a linear source index to a texel (defaults to the work-buffer size)
         * @param srcBaseOffset added to each mapped source index so a region-local map reads the correct global atlas texel (hosted relayout)
         * @param dstBaseRow subtracted from the destination row so an identity copy reads the region-local temp (hosted relayout)
         */
        private _renderRelayoutPass;
        private _createCopyMaterial;
        /**
         * Renders one INTEGER SH copy pass (one packed-u32 SH texture) into the target, sampling one integer source.
         * Same index/map/base math as {@link _renderRelayoutPass} but for the integer SH format.
         * @param target destination single-attachment integer MRT
         * @param srcSh the integer SH source texture
         * @param mapTexture the R32F destination-to-source index map (sampled only when `useMap` is 1)
         * @param useMap 1 to read source indices from the map (gaps discarded), 0 for an identity copy
         * @param dstWidth destination width used to linearize the destination texel
         * @param srcWidth source width used to convert a linear source index to a texel
         * @param srcBaseOffset added to each mapped source index (region-local map -> global atlas texel)
         * @param dstBaseRow subtracted from the destination row for an identity copy of a region-local temp
         */
        private _renderShCopyPass;
        private _createShCopyMaterial;
        /**
         * Renders one rotation/scale copy pass (the three half-float rotation textures) into the target. Same
         * index/map/base math as {@link _renderRelayoutPass} but with three attachments.
         * @param target destination 3-attachment MRT
         * @param sources the three source rotation textures ([rotA, rotB, rotScale])
         * @param mapTexture the R32F destination-to-source index map (sampled only when `useMap` is 1)
         * @param useMap 1 to read source indices from the map (gaps discarded), 0 for an identity copy
         * @param dstWidth destination width used to linearize the destination texel
         * @param srcWidth source width used to convert a linear source index to a texel
         * @param srcBaseOffset added to each mapped source index (region-local map -> global atlas texel)
         * @param dstBaseRow subtracted from the destination row for an identity copy of a region-local temp
         */
        private _renderRotCopyPass;
        private _createRotCopyMaterial;
        /**
         * Asynchronously reads back the decoded splat centers (stride-4 xyzw, w=1) for a contiguous splat range
         * from the work buffer's centers texture, using a non-blocking GPU readback (WebGL2 PBO + fence, or WebGPU
         * copyTextureToBuffer + mapAsync) so it never stalls the frame the way a CPU image decode does. The centers
         * texture already holds the GPU-decoded positions (identical to the CPU decode), so this replaces decoding
         * positions on the CPU from the means images. Returns null when async readback is unsupported (caller should
         * fall back to CPU decoding).
         * @param splatOffset first splat index of the range
         * @param splatCount number of splats in the range
         * @returns a stride-4 Float32Array of length `splatCount * 4`, or null when unsupported/failed
         */
        readCentersRangeAsync(splatOffset: number, splatCount: number): Promise<Nullable<Float32Array>>;
        /**
         * Disposes the work buffer and its decode resources.
         */
        dispose(): void;
        private _createQuad;
        private _createMaterial;
        private _applyPack;
        private _createShMaterial;
        private _applyShPack;
        private _createRotMaterial;
        private _applyRotPack;
    }


    /**
     * A single LOD variant of a tree node: a contiguous splat range inside one streamed SOG file.
     */
    interface ISOGLODEntry {
        /** Index into {@link ISOGLODMetadata.filenames}. */
        file: number;
        /** First splat index inside that file. */
        offset: number;
        /** Number of splats. */
        count: number;
    }
    /**
     * A node of the PlayCanvas-style SOG LOD octree. Internal nodes have `children`; leaves have `lods`.
     */
    interface ISOGLODNode {
        bound: {
            min: number[];
            max: number[];
        };
        children?: ISOGLODNode[];
        lods?: {
            [level: string]: ISOGLODEntry;
        };
        /** LOD level currently streamed/rendered for this node, or undefined until its base LOD is ready. */
        activeLod?: number;
        /** Distance-based ideal LOD level for this node, recomputed per frame. */
        optimalLod?: number;
        /** Projected screen size (pixels) of the node's AABB — the max across active cameras. Larger nodes keep finer
         * detail under the splat budget. Only computed while the budget is enabled. */
        pixelSize?: number;
        /** Available LOD levels for this leaf, sorted ascending (0 = finest). Set during the tree walk. */
        availableLevels?: number[];
        /** Coarsest available level (= max key), always streamed as the permanent base layer. */
        baseLod?: number;
        /** Final LOD level the node should stream/render (distance optimal, capped by maxDetailLod). */
        targetLevel?: number;
        /** Frames remaining before this node may switch LOD again (oscillation damping). */
        lodCooldown?: number;
        /** True when the node's bounding box currently intersects the camera frustum. Drives the LOD bias that
         * pushes off-screen nodes to the coarsest level (they stay rendered, not hidden). */
        inFrustum?: boolean;
        /** Cached local-space bounding info used for the per-node frustum test (created once per leaf). */
        cullBounds?: BoundingInfo;
        /** File index this node currently has an in-flight/queued decode request for (its not-yet-decoded target),
         * or undefined when the node's target is already decoded. Drives pending-download reference counting. */
        pendingFile?: number;
        /** File index this node's current {@link activeLod} renders from, or undefined before any LOD is active.
         * Drives the resident reference count that keeps a file in the work buffer. */
        activeFile?: number;
    }
    /**
     * Parsed contents of a PlayCanvas-style `lod-meta.json` file.
     */
    export interface ISOGLODMetadata {
        /** Number of LOD levels (0 = highest detail). */
        lodLevels: number;
        /** SOG `meta.json` paths, relative to the metadata file, indexed by `ISOGLODEntry.file`. */
        filenames: string[];
        /** Optional always-on environment `.sog` bundle, relative to the metadata file. */
        environment?: string;
        /** Root of the LOD octree. */
        tree: ISOGLODNode;
    }
    /**
     * Selects which LOD value drives the {@link GaussianSplattingStream} debug wireframe colors.
     */
    export type GaussianSplattingStreamDebugLodSource = "optimal" | "current";
    /**
     * Immutable metadata-resolution state for a stream's total number of finest-LOD splats.
     * @experimental
     */
    export type GaussianSplattingStreamLod0SplatCount = Readonly<{
        status: "pending";
    }> | Readonly<{
        status: "available";
        count: number;
    }> | Readonly<{
        status: "unavailable";
    }>;
    /**
     * Options for {@link GaussianSplattingStream}.
     */
    export interface IGaussianSplattingStreamOptions {
        /** URL of the fflate UMD module used to unzip `.sog` environment bundles. */
        deflateURL?: string;
        /** Pre-loaded fflate module. */
        fflate?: any;
        /** When true, renders a wireframe box per LOD node, colored by the node's LOD level. */
        debugDisplay?: boolean;
        /** Which LOD value drives the debug wireframe colors. Defaults to `"optimal"`. */
        debugLodSource?: GaussianSplattingStreamDebugLodSource;
        /** Distance (in local units) of the first LOD transition. PlayCanvas default `5`. */
        lodBaseDistance?: number;
        /** Geometric ratio between successive LOD transition distances. PlayCanvas default `3`. */
        lodMultiplier?: number;
        /** Distance multiplier applied to nodes behind the camera (`1` = no penalty). PlayCanvas default `1`. */
        lodBehindPenalty?: number;
        /** Lowest LOD index the optimal-LOD heuristic may select. Defaults to `0`. */
        lodRangeMin?: number;
        /** Highest LOD index the optimal-LOD heuristic may select. Defaults to `lodLevels - 1`. */
        lodRangeMax?: number;
        /** Maximum number of LOD source files to GPU-decode per frame (spreads work to avoid hitches). Defaults to `1`. */
        maxDecodesPerFrame?: number;
        /** Frames a node must wait after switching LOD before it may switch again (oscillation damping). Defaults to `10`. */
        lodCooldownFrames?: number;
        /** Minimum number of frames between LOD re-evaluations (throttles per-frame work during motion). Defaults to `4`. */
        lodUpdateInterval?: number;
        /** Minimum camera movement (world units) required to re-evaluate LODs. Defaults to `0.5`. */
        lodUpdateDistance?: number;
        /**
         * Finest (most detailed) LOD level any node is allowed to render. `0` allows full detail (level 0);
         * `1` caps detail at the next-coarser level, and so on. Higher values force a coarser maximum detail.
         */
        maxDetailLod?: number;
        /**
         * When true (default), LOD nodes outside the camera frustum are biased to their coarsest LOD rather than
         * rendered at full detail. They stay in the sort/render set so they appear instantly (at low detail) when
         * the camera turns toward them, then refine. Set to `false` to render every node at its distance LOD.
         */
        frustumCulling?: boolean;
        /** Maximum number of LOD file downloads allowed to run concurrently. PlayCanvas default `2`. */
        maxConcurrentDownloads?: number;
        /** Number of times a failed file download is retried before giving up. PlayCanvas default `2`. */
        maxDownloadRetries?: number;
        /**
         * GPU memory budget (in megabytes) for resident splats. When set (and smaller than the full dataset),
         * LOD files are streamed through a fixed-size work buffer and unreferenced files are evicted to stay
         * within budget, allowing datasets larger than a single full-dataset buffer. Converted to a splat count
         * using the per-splat cost (core data plus any baked SH and rotation/scale textures). Combined with
         * {@link maxResidentSplats} by taking the smaller of the two.
         */
        memoryBudgetMb?: number;
        /**
         * Maximum number of splats kept resident in the work buffer. When set (and smaller than the full
         * dataset), enables eviction-based streaming (see {@link memoryBudgetMb}). Default unset = size the work
         * buffer for the whole dataset (no eviction).
         */
        maxResidentSplats?: number;
        /**
         * Frames an unreferenced (no longer rendered) LOD file stays resident before it is evicted, so a quick
         * return to it avoids a re-download. Only used when a budget enables eviction. PlayCanvas default `100`.
         */
        evictionCooldownFrames?: number;
        /**
         * Enables budget-driven LOD: caps the total rendered splats by converging a screen-space (size + distance)
         * pixel-size threshold to the budget. Selection is view-direction-independent, so it is consistent across any
         * number of active cameras (each node takes the finest level and largest projected size any camera demands).
         * A number is an explicit splat cap; `"auto"` picks a device-tiered default (desktop 2.5M / iOS 1.5M /
         * other mobile 1M; XR shares the mobile tier). **Undefined (default) disables the cap** — LOD is pure
         * distance, identical to prior behavior. Runtime-mutable via the {@link splatBudget} accessor. When this stream
         * is hosted in a compound, the compound's {@link GaussianSplattingMesh.splatBudget} (if set) overrides this and
         * apportions a shared budget across all its streams.
         */
        splatBudget?: number | "auto";
        /**
         * When set, the stream does not render itself; instead it reserves a region of this compound mesh and
         * decodes/sorts into it, so its splats are depth-sorted and drawn in ONE pass together with the compound's
         * other (static) parts. Used by {@link AddGaussianSplattingStreamPart}. The stream mesh becomes a hidden
         * controller; the SOG up-axis orientation is applied to the reserved part's proxy transform.
         * @internal
         */
        hostCompound?: GaussianSplattingMesh;
        /**
         * When true, higher-order spherical-harmonics carried by the SOG files (`shN`) are GPU-decoded into baked
         * packed-u32 SH textures so the streamed splats render with view-dependent lighting (matching the non-stream
         * `.spz`/`.sog` path) instead of flat DC-only color. The SH degree is the max `shN.bands` across the streamed
         * files (lower-band files neutral-fill). No effect when the files carry no `shN`. Defaults to `true`, matching
         * the non-stream path's always-decode-if-present behavior; set to `false` to force flat DC-only color even
         * when the data carries `shN` (e.g. to save the decode cost/texture memory).
         */
        decodeSh?: boolean;
        /**
         * When true, each splat's rotation matrix + scale are GPU-decoded into half-float rotation/scale textures so the
         * streamed splats participate in voxel-based IBL shadowing (matching the non-stream path). Standalone: the work
         * buffer owns the rotation textures. Hosted: the compound's rotation textures become a shared render-target atlas
         * the stream decodes into. Defaults to `false`.
         */
        needsRotationScale?: boolean;
    }
    /**
     * Streams a PlayCanvas-style SOG LOD scene (`lod-meta.json`) into a single Gaussian Splatting mesh.
     *
     * Each selected SOG file (plus the environment) is loaded directly as GPU textures and decoded on the
     * GPU into one unified, PlayCanvas-style square work buffer (no CPU splat decode or `updateData`). Only
     * the splats of each node's currently-selected LOD are rendered/sorted via the mesh's interval filter.
     *
     * The coarsest (least-detail) LOD of every node is streamed first as a permanent base layer so the whole
     * scene is visible quickly with no holes. A distance-based "optimal" LOD is then computed per node (see
     * {@link evaluateOptimalLods}); finer LOD source files are streamed on demand and a node only switches to
     * a finer LOD once that file is decoded, so transitions never flash or leave gaps.
     *
     * @experimental
     */
    export class GaussianSplattingStream extends GaussianSplattingMesh implements IGaussianSplattingLodBudgetParticipant {
        private readonly _metadata;
        private readonly _rootUrl;
        private readonly _streamOptions;
        private readonly _leafNodes;
        private _lod0SplatCount;
        private _lodBaseDistance;
        private _lodMultiplier;
        private _lodBehindPenalty;
        private _lodRangeMin;
        private _lodRangeMax;
        private _maxDecodesPerFrame;
        private _lodCooldownFrames;
        private _lodUpdateInterval;
        private _lodUpdateDistance;
        private _maxDetailLod;
        private _lodPixelThreshold;
        private _hostBudgetAllocation;
        private _frustumCulling;
        private readonly _frustumPlanes;
        private readonly _cullViewProj;
        private readonly _frustumScratch;
        private _workBuffer;
        private _decodeSh;
        private _streamShDegree;
        private _shTextureCount;
        private _needsRotationScale;
        private _useGpuPositionReadback;
        private _readbackCandidate;
        private _readbackProbed;
        private _residency;
        private readonly _fileCounts;
        private readonly _fileMeta;
        private readonly _decodedFiles;
        private readonly _loadingFiles;
        private readonly _decodeQueue;
        private readonly _fileRefs;
        private readonly _cancelledDecodes;
        private _evictionEnabled;
        private _residentBudget;
        private _maxResidentSplats;
        private _memoryBudgetMb;
        private _evictionCooldownFrames;
        private _decodeGate;
        private readonly _relayoutOldOffsets;
        private _relayoutSrcIndex;
        private readonly _downloadManager;
        private _environmentRange;
        private _environmentFiles;
        private _lodObserver;
        private _baseLayerReady;
        private _framesSinceLodUpdate;
        private readonly _lastLodCamPositions;
        private _lastLodSignature;
        private _forceLodUpdate;
        private readonly _boundsMin;
        private readonly _boundsMax;
        private _debugDisplay;
        private _debugLodSource;
        private _debugMesh;
        private _debugObserver;
        private _debugColorData;
        private _debugSignature;
        private _disposed;
        private readonly _hostCompound;
        private _host;
        private _positionBase;
        private _unsubBeforeRebuild;
        private _unsubAfterRebuild;
        private _hostUnsubRemove;
        private _hostUnsubDispose;
        private _partReleasedByHost;
        private _positionSnapshot;
        private _partReadyPromise;
        private _partReadyResolve;
        private _partReadyReject;
        private _partReadySettled;
        /**
         * Returns true when the parsed JSON looks like a PlayCanvas-style `lod-meta.json` payload.
         * @param data parsed JSON
         * @returns whether the data is SOG LOD metadata
         */
        static IsLODMetadata(data: unknown): data is ISOGLODMetadata;
        /**
         * Creates a new SOG LOD streaming mesh and immediately starts streaming (non-blocking).
         * @param name mesh name
         * @param metadata parsed `lod-meta.json`
         * @param rootUrl base URL the metadata's relative paths resolve against
         * @param scene hosting scene
         * @param options streaming options
         */
        constructor(name: string, metadata: ISOGLODMetadata, rootUrl: string, scene: Scene, options?: IGaussianSplattingStreamOptions);
        getClassName(): string;
        /**
         * When `_hostCompound` is set (i.e. this stream was created via {@link AddGaussianSplattingStreamPart}
         * to drive a reserved region of another compound mesh, rather than rendering itself), this instance is
         * disabled and never drawn — so it never runs its own depth-sort worker and the base class's readiness
         * check (which waits for one) would never pass. Report ready unconditionally in that case; the host
         * compound is the one actually rendering, and its own `isReady()` already covers real sort completion.
         * @param completeCheck defines if a complete check (including materials and lights) has to be done (false by default)
         * @returns true when ready
         */
        isReady(completeCheck?: boolean): boolean;
        /**
         * Hosted mode only: the compound part proxy this stream drives (world transform + visibility of the
         * reserved region), or null before the part has been reserved (or when running standalone).
         */
        get streamingPartProxy(): Nullable<GaussianSplattingPartProxyMesh>;
        /**
         * Hosted mode only: resolves once the reserved part exists and its base layer has decoded (so the proxy's
         * bounds are real and the part is ready to be placed/framed), or rejects if streaming fails/disposes first.
         * Resolves immediately for a standalone stream. Used by {@link AddGaussianSplattingStreamPartAsync}.
         * @returns a promise that settles when the hosted part is ready to use
         */
        whenPartReadyAsync(): Promise<void>;
        /** Resolves the part-ready deferred (hosted mode); no-op if already settled or standalone. */
        private _resolvePartReady;
        /**
         * Rejects the part-ready deferred (hosted mode); no-op if already settled or standalone.
         * @param message failure reason surfaced to the awaiter
         */
        private _rejectPartReady;
        /**
         * Resolves once the scene is fully streamed and displayed for the current camera: a LOD re-evaluation has
         * run for the current point of view, every reachable LOD file has finished downloading and decoding (no
         * downloads, decodes, or queued work remain), and the depth sort for the resulting splats has been applied
         * and rendered. Intended for deterministic automated testing and screenshot/image comparison.
         *
         * Streaming and settling require rendered frames. If an external render loop is already running, this waits
         * on it passively; otherwise (e.g. when awaited inside an async `createScene` before the host starts its
         * render loop) it drives `scene.render()` itself until settled, so it never deadlocks.
         *
         * Note: the promise only resolves while the camera is still — if the camera keeps moving, the target LODs
         * (and the depth sort) keep changing and the stream never settles. Position the camera, then await this.
         * @param stableFrames number of consecutive settled frames to require before resolving (defaults to 3), so
         *   the final sorted frame is actually on screen
         * @returns a promise that resolves when loading and rendering are complete for the current view
         */
        whenSettledAsync(stableFrames?: number): Promise<void>;
        /**
         * Whether the base layer is ready and there is no streaming work in flight (nothing queued for decode, no
         * decode running, and no downloads pending).
         * @returns true when no loading work remains
         */
        private _isLoadingIdle;
        /**
         * Finest (most detailed) LOD level any node is allowed to render. `0` allows full detail (level 0);
         * `1` caps detail at the next-coarser level, and so on. Nodes already coarser than this cap (by
         * distance) are unaffected. Changes take effect in real time.
         */
        get maxDetailLod(): number;
        set maxDetailLod(value: number);
        /**
         * This stream's own budget-driven LOD cap in splats (see {@link IGaussianSplattingStreamOptions.splatBudget}).
         * `0` disables the budget (pure distance LOD). Setting it caps the rendered splat count, taking effect on the
         * next frame. When this stream is hosted in a compound whose own budget is set, that shared budget overrides
         * this value — read the actual runtime cap from {@link effectiveSplatBudget}, not this getter (which always
         * reports the configured own cap).
         * @experimental
         */
        get splatBudget(): number;
        set splatBudget(value: number);
        /**
         * The splat cap actually in force this frame: a hosting compound's apportioned allocation when this stream is
         * coordinated, otherwise this stream's own {@link splatBudget}, clamped to what can be kept resident. `0` means
         * no cap (pure distance LOD). Unlike {@link splatBudget}, this reflects the compound override, so it is the value
         * to display or reason about at runtime.
         * @experimental
         */
        get effectiveSplatBudget(): number;
        /**
         * The resolved maximum number of splats kept resident in the work buffer. This combines
         * {@link IGaussianSplattingStreamOptions.maxResidentSplats} and {@link IGaussianSplattingStreamOptions.memoryBudgetMb},
         * taking the smaller limit when both are configured. `0` means the resident budget is disabled.
         * @experimental
         */
        get residentSplatBudget(): number;
        /**
         * The total number of splats represented by valid level-0 leaf entries. This remains pending while source
         * metadata is loading and is unavailable when no applicable level-0 entries exist or required metadata fails.
         * @experimental
         */
        get lod0SplatCount(): GaussianSplattingStreamLod0SplatCount;
        /**
         * Resolves the raw {@link splatBudget} option to a concrete cap: `undefined` ⇒ 0 (disabled), `"auto"` ⇒ a
         * device-tiered default, a positive number ⇒ itself (floored).
         * @param option the raw option value
         * @returns the resolved splat cap (0 = disabled)
         */
        private _resolveSplatBudget;
        /**
         * Device-tiered default splat budget for {@link splatBudget} `"auto"`: desktop 2.5M, iOS 1.5M, other mobile
         * (incl. Android/XR) 1M. XR is folded into the mobile tier (no reliable at-construction detection).
         * @returns the default splat cap for this device
         */
        private _computeDefaultSplatBudget;
        /**
         * The splat budget this stream converges against this frame: the compound's apportioned allocation when hosted
         * and coordinated, else this stream's own resolved budget. Clamped to the resident budget so the stream never
         * targets more splats than can be kept resident. `0` means the budget is disabled.
         * @returns the effective splat cap (0 = disabled)
         */
        private _effectiveSplatBudget;
        /**
         * Whether budget-driven LOD is active this frame.
         * @returns true when a positive effective budget is in force
         */
        private _splatBudgetEnabled;
        /**
         * {@link IGaussianSplattingLodBudgetParticipant}: the splats this stream would render at full (distance-optimal)
         * detail — its demand on a host compound's shared budget. Computed from the current per-node distance-optimal
         * levels (no pixel threshold), so it does not depend on the allocation it is helping to compute.
         * @returns the full-detail rendered splat count (0 before the base layer is ready)
         */
        getBudgetDemand(): number;
        /**
         * {@link IGaussianSplattingLodBudgetParticipant}: sets the compound's apportioned share of the shared budget.
         * `null` releases coordination (revert to this stream's own {@link splatBudget}); a number (incl. 0, meaning
         * "coordinated at the coarsest level") drives the pixel-threshold convergence. Any change to the (already integer)
         * allocation forces a next-frame re-eval: a decrease may put the current selection over the new cap, and even a
         * small increase can unlock a finer level that a stationary camera would otherwise never re-evaluate to. The
         * apportioned demand is allocation-independent, so this settles in one step and does not churn frame to frame.
         * @param splats the apportioned allocation, or null to release coordination
         */
        setBudgetAllocation(splats: Nullable<number>): void;
        /**
         * Coarsest LOD level index in the scene (number of LOD levels minus one). Useful as the upper bound
         * for {@link maxDetailLod}.
         */
        get maxLodLevel(): number;
        /**
         * When true (default), nodes whose bounding box is outside the camera frustum are biased to the coarsest
         * LOD instead of being hidden. They stay in the sort/render set (their off-screen splats are clipped), so
         * turning the camera toward them shows low detail immediately with no invisible frames, then refines.
         * Changes take effect in real time.
         */
        get frustumCulling(): boolean;
        set frustumCulling(value: boolean);
        /**
         * When true, renders a wireframe box per LOD node, colored by the LOD level selected by {@link debugLodSource}.
         */
        get debugDisplay(): boolean;
        set debugDisplay(value: boolean);
        /**
         * Selects which LOD value drives the debug wireframe colors: the distance-based `"optimal"` LOD
         * (default, recomputed as the camera moves) or the `"current"` streamed/rendered LOD.
         */
        get debugLodSource(): GaussianSplattingStreamDebugLodSource;
        set debugLodSource(value: GaussianSplattingStreamDebugLodSource);
        dispose(doNotRecurse?: boolean): void;
        /**
         * Disposes this stream (which tombstones its region) and then compacts the host once to actually reclaim the
         * reserved rows. Used on a definitive load failure / empty result — a discrete, one-off reclaim, versus a bare
         * {@link dispose} that only tombstones so tearing down several parts doesn't rebuild the atlas repeatedly.
         */
        private _disposeAndReclaim;
        /**
         * The world matrix that actually places this stream's splats, used to map the camera into the space the
         * node bounds live in (for LOD distance) and to build per-node world AABBs (for frustum culling). Standalone:
         * this controller mesh carries the transform. Hosted: this controller is a hidden, unplaced node — the splats
         * are placed by the reserved part's proxy (SOG up-axis basis composed with the host's placement), so LOD and
         * culling MUST use the proxy's world matrix or they compute distances/frustum tests in the wrong space
         * (producing wrong per-chunk LODs, i.e. holes, whenever the host applies a non-identity transform).
         * @param force when true, forces a full world-matrix recompute (else uses the renderId/sync fast-path)
         * @returns the effective world matrix for LOD/culling
         */
        private _getEffectiveWorldMatrix;
        /**
         * The cameras the LOD should serve: `scene.activeCameras` when set (split-view / multi-view), else the single
         * `scene.activeCamera`. Mirrors the sort path's multi-camera handling.
         * @returns the non-null active cameras (may be empty)
         */
        private _getActiveLodCameras;
        /**
         * Re-evaluates the optimal LOD for every node from the active cameras. Each node takes the finest level and the
         * largest projected pixel size any active camera demands (so every pane of a split view is served), and the
         * frustum bias uses the union of the frusta. Selection is view-direction-independent, so single- and multi-camera
         * rendering are consistent. The results are stored in each node's `optimalLod` / `pixelSize`.
         * @param camera when provided, evaluate against just this camera; otherwise use the active-camera set
         */
        evaluateOptimalLods(camera?: Nullable<Camera>): void;
        /**
         * The LOD level used to color a node's debug box, per {@link debugLodSource}.
         * @param node leaf node
         * @returns the displayed LOD level
         */
        private _displayedLodLevel;
        /**
         * Rebuilds the debug wireframe (evaluating the optimal LOD first when needed) and wires up the per-frame
         * recolor observer. The observer runs for both LOD sources: "optimal" colors track the camera, and
         * "current" colors track LOD levels as they stream in/out.
         */
        private _refreshDebugDisplay;
        /**
         * Per-frame debug update: recolors the existing wireframe in place whenever the displayed LOD levels
         * change. For the "optimal" source the optimal LOD is recomputed first (it tracks the camera); for the
         * "current" source the levels are driven by the streaming loop, so no recomputation is needed here. The
         * geometry is never rebuilt, which avoids the dispose/recreate flicker while the camera moves.
         */
        private _onDebugFrame;
        /**
         * Builds the LOD-node wireframe boxes once (one box per leaf node), colored by the displayed LOD level.
         * The color vertex buffer is created updatable so subsequent recolors can happen in place.
         */
        private _buildDebugMesh;
        /**
         * Recolors the existing wireframe in place from the current displayed LOD levels, without rebuilding geometry.
         */
        private _updateDebugColors;
        /**
         * Computes a cheap 32-bit rolling hash of every leaf's displayed LOD level, used to detect when the
         * debug wireframe needs recoloring. Avoids per-frame string allocation in the render loop.
         * @returns a numeric signature of the current displayed LOD levels
         */
        private _computeDebugSignature;
        /**
         * Disposes the LOD-node wireframe boxes and stops live debug updates.
         */
        private _clearDebugDisplay;
        /**
         * Walks the LOD tree and records every leaf that carries renderable LOD entries, capturing the set of
         * available levels and the coarsest (base) level for each.
         * @param node current tree node
         */
        private _collectLodEntries;
        /**
         * Streams the scene: learns every source file's splat count, allocates one unified GPU work buffer
         * sized for all LOD files, decodes the environment and the coarsest LOD of every node as a permanent
         * base layer, then installs the per-frame loop that streams finer LODs on demand.
         */
        private _streamAllAsync;
        /**
         * Waits (up to a frame cap) until the work buffer's backup/restore copy shaders are compiled, so a later
         * grow/compaction can preserve this hosted region (see {@link GaussianSplattingWorkBuffer.backupRegion}).
         * Polls per rendered frame: shader readiness here depends on the render loop (and the shared atlas can be
         * rebuilt concurrently), so this stays synchronized with the render-driven decode and always makes progress.
         * On timeout it proceeds best-effort — a subsequent grow/compaction then warns rather than blocking decode.
         * @param wb the hosted work buffer to wait on
         */
        private _waitForCanBackupAsync;
        /**
         * Resolves the resident-splat budget from the raw options, sizing a memory (MB) budget with the actual per-splat
         * GPU+CPU cost — core data plus the baked SH textures and rotation/scale textures when enabled — so SH/rotation
         * assets don't silently consume up to double the configured budget. Requires the SH degree (from the metadata
         * pre-pass) to be known. The smaller of the splat-count and memory budgets wins.
         */
        private _resolveResidentBudget;
        /**
         * Collects the unique set of source file indices referenced by any LOD of any leaf, sorted ascending.
         * @returns sorted unique file indices
         */
        private _collectAllFileIds;
        /**
         * Settles the level-0 diagnostic from normalized renderable leaf entries after their source metadata resolves.
         * A file may back several leaf ranges, so its source count is deliberately not used in the total.
         */
        private _resolveLod0SplatCount;
        /**
         * Fetches the environment bundle and every referenced file's metadata to learn splat counts, caching
         * each file's parsed metadata for the later on-demand decode. Metadata fetches run in parallel.
         * @param fileIds file indices to fetch metadata for
         * @returns the environment splat count (0 when there is no environment)
         */
        private _gatherCountsAsync;
        /**
         * Queues a file for on-demand decode if it isn't already decoded, in flight, or already queued.
         * @param fileId file index to decode
         */
        private _enqueueDecode;
        /**
         * Starts up to {@link _maxDecodesPerFrame} queued decodes for this frame. Decodes run asynchronously
         * and promote any waiting nodes once they complete.
         */
        private _pumpDecodeQueue;
        /**
         * Writes a decoded splat range's positions into the shared buffer, expands the bounds, and incrementally
         * patches the sort worker.
         * @param positions stride-4 positions for the range
         * @param base first splat index of the range in the work buffer
         * @param count number of splats in the range
         */
        private _applyPositions;
        /**
         * Sets the active source ranges (local to the stream's buffer) on the render sink.
         * @param localRanges active ranges in the stream's local index space
         */
        private _sinkSetActiveRanges;
        /**
         * Patches a decoded position range (local offset) into the render sink's sort worker.
         * @param base first splat index of the range, local to the stream's buffer
         * @param count number of splats in the range
         */
        private _sinkPostPositionsRange;
        /** Re-posts the full position/part set to the render sink's worker (after a relayout moved the region). */
        private _sinkNotifyDataChanged;
        /** Whether the render sink's depth sort is settled. */
        private get _sinkIsDepthSortSettled();
        /**
         * One-time validation of GPU position readback: reads a sample of the just-decoded range back from the work
         * buffer and compares it to the CPU-decoded positions. Enables {@link _useGpuPositionReadback} only on an
         * exact (within float tolerance) match, so an unsupported or incorrect readback (e.g. a backend without the
         * required texture usage, or an orientation mismatch) safely keeps the CPU decode path.
         * @param base first splat index of the validated range
         * @param count number of splats in the range
         * @param cpuPositions the CPU-decoded stride-4 positions for the range (ground truth)
         */
        private _probeReadbackAsync;
        /**
         * Resolves the decoded positions for a splat range and applies them. Once GPU readback has been validated,
         * positions are read back from the work buffer (non-blocking) and `pack.positions` is empty; otherwise the
         * CPU-decoded `pack.positions` are used, and — on the first such decode — the GPU readback is validated
         * against them so subsequent decodes can use the fast path.
         * @param pack the parsed SOG pack (its `positions` is populated only on the CPU path)
         * @param base first splat index of the range in the work buffer
         * @param count number of splats in the range
         * @returns whether positions were applied
         */
        private _applyDecodedPositionsAsync;
        /**
         * Decodes the always-on environment bundle into its work-buffer block and activates its range.
         */
        private _decodeEnvironmentAsync;
        /**
         * Loads one LOD source file as GPU textures, decodes it into its fixed work-buffer block, records its
         * CPU centers for sorting, frees the source textures, then promotes any nodes that were waiting for it.
         * Concurrent or repeat requests for the same file are ignored. If the file is cancelled mid-flight
         * (because every node that wanted it retargeted), the decode bails cooperatively at the next checkpoint.
         * @param fileId file index to decode
         */
        private _decodeFileAsync;
        /**
         * Acquires the decode gate (a simple async mutex). Resolves once any prior holder releases, returning a
         * release function the caller must invoke in a `finally`.
         * @returns the release function
         */
        private _acquireDecodeGateAsync;
        /**
         * Defragments the work buffer to make room for a file that did not fit, then allocates its slot. Runs the
         * compaction + GPU relayout atomically inside a single `onBeforeRender` so no inconsistent CPU/GPU layout
         * is ever rendered. Returns the new slot offset, or null if even compaction cannot free enough contiguous
         * space (the caller refuses the upgrade).
         * @param fileId file to allocate after compaction
         * @param count splats the file needs
         * @returns the allocated offset, or null
         */
        private _relayoutAndAllocateAsync;
        /**
         * Compacts the resident set and relocates the corresponding GPU textures and CPU positions to the new
         * layout. Must run at a frame-safe point with the work buffer's relayout shader ready.
         */
        private _performRelayout;
        /**
         * Drops a file evicted by the residency controller from the decoded set so it will be re-decoded on demand.
         * The file had no remaining references, so no node was rendering or downloading it.
         * @param fileId evicted file index
         */
        private _onFileEvicted;
        /**
         * Snaps a desired LOD level to the nearest level the node provides, while never selecting a level finer
         * than {@link maxDetailLod} (i.e. with an index below the cap). Ties prefer the finer allowed level. If
         * the node has no level at or coarser than the cap, its coarsest available level is used.
         * @param node leaf node
         * @param desired desired LOD level
         * @returns the chosen available level
         */
        private _cappedLevelForNode;
        /**
         * Computes each node's {@link ISOGLODNode.targetLevel}. With the splat budget disabled this is the
         * distance-optimal level snapped to an available level (capped by {@link maxDetailLod}) — unchanged prior
         * behavior. With the budget enabled it converges a global pixel-size threshold to the budget and coarsens each
         * node from its distance-optimal ceiling by how far its projected size falls below that threshold.
         */
        private _computeTargetLevels;
        /**
         * Splat count of the always-rendered environment layer (0 when none), coerced to a finite non-negative integer.
         * Counted as a fixed cost in both the budget demand and the leaf convergence so it is never over-drawn.
         * @returns the environment's rendered splat count
         */
        private _environmentSplatCount;
        /**
         * The level a node renders at for a given pixel-size threshold `t`: its distance-optimal ceiling, coarsened by
         * `round(log_mult(t / pixelSize))` geometric steps when its projected size is below `t`. Snapped to
         * an available level honoring {@link maxDetailLod}.
         * @param node leaf node
         * @param t pixel-size threshold (pixels)
         * @returns the chosen available LOD level
         */
        private _budgetedLevel;
        /**
         * Splat count of a node's file at a given (already snapped) available level.
         * @param node leaf node
         * @param level available LOD level
         * @returns the level's splat count (0 if absent)
         */
        private _countAtLevel;
        /**
         * Sum of every leaf's rendered splat count at pixel-size threshold `t`.
         * @param t pixel-size threshold (pixels)
         * @returns total rendered splats
         */
        private _totalSplatsAtThreshold;
        /**
         * Converges the global pixel-size threshold {@link _lodPixelThreshold} to the largest detail whose total rendered
         * splats is still within `budget` (the pixel-scale cut, floored at the true sub-pixel limit of 1 px). The
         * total is monotonically non-increasing in the threshold, so a bisection on `[floorT, ceilT]` — where `ceilT`
         * coarsens every node to its coarsest available level — gives a GUARANTEED result at or under the cap. When even
         * that coarsest state exceeds the budget (the budget is below the pinned minimum detail), the threshold is set to
         * `ceilT` so every node renders at minimum detail — the best achievable; the cap is then unavoidable. O(leaves)
         * per iteration; no decode.
         * @param budget target maximum rendered splat count
         */
        private _convergePixelThreshold;
        /**
         * The finest already-decoded level of a node that is at least as coarse as `level` (index >= level). Used to
         * enforce the budget cap immediately without waiting for a download. Returns `null` when no such level is resident
         * — including when eviction has freed the base layer — so the caller keeps the currently-visible (resident) file
         * rather than switching to a non-resident one, which would render a hole.
         * @param node leaf node
         * @param level the minimum coarseness (level index) required
         * @returns a resident level index >= level, or null when none is resident
         */
        private _residentLevelAtLeast;
        /**
         * Applies each node's {@link ISOGLODNode.targetLevel}: switches a node to its target level when that
         * level's file is already decoded, otherwise records a pending download request for the file and leaves
         * the node on its current LOD (so nothing ever disappears). Nodes within their post-switch cooldown are
         * left untouched to damp oscillation (and keep their existing pending request).
         *
         * Each node tracks the single file it currently needs but lacks ({@link ISOGLODNode.pendingFile}). When a
         * node's target changes before that file finished downloading, the old file's reference is released; if no
         * other node still needs it, its queued/in-flight download is cancelled (see {@link _releaseFileRef}).
         * @returns true when at least one node changed LOD (callers should refresh the active ranges)
         */
        private _applyDesiredLods;
        /**
         * Moves a node's resident reference from its previous active file to the one it now renders, so the file
         * count that keeps a block in the work buffer stays accurate (and cancels any pending eviction of the new
         * file). The new file is already decoded.
         * @param node leaf node switching its rendered file
         * @param file the file the node now renders from
         */
        private _switchActiveFile;
        /**
         * Adds a reference to a file (active render or pending download), cancelling any scheduled eviction.
         * @param fileId file index
         */
        private _acquireFileRef;
        /**
         * Records that a node needs a not-yet-decoded file, bumping its reference count and queueing the decode.
         * @param fileId file index the node now targets
         */
        private _acquirePendingFile;
        /**
         * Releases a node's reference to a file. When the last reference is dropped: a decoded file is scheduled
         * for eviction (when streaming under a budget), and a still-downloading file has its queued decode dropped
         * and any in-flight download cancelled.
         * @param fileId file index the node no longer references
         */
        private _releaseFileRef;
        /**
         * Per-frame LOD streaming loop. Ticks cooldowns and pumps the decode queue every frame, and runs the
         * cheap per-node frustum test every frame so the off-screen LOD bias tracks camera rotation. The LOD
         * re-evaluation is throttled to at most every {@link _lodUpdateInterval} frames once the camera has
         * translated far enough, but also runs immediately whenever a node enters/leaves the frustum (so its
         * detail upgrades/downgrades promptly), a node whose cooldown just expired still needs to switch LOD,
         * or a cap change forces it. Active ranges rebuild on any LOD change.
         *
         * The cooldown-expiry trigger lets a node reach its already-computed target level as soon as its
         * cooldown clears, rather than waiting for the camera to move. This matters right from load: a
         * node's base-layer decode is itself applied as a switch (from no active level to the base one), so
         * it starts the same cooldown a later switch would — this trigger is what lets the node progress past
         * that base level promptly once it expires, even at a fixed camera pose.
         */
        private _onLodFrame;
        /**
         * A cheap signature of the discrete inputs (besides camera translation, tracked separately) that affect projected
         * pixel size: each camera's identity, FOV, FOV mode and viewport, plus the engine render size and the effective
         * world matrix revision. A change invalidates the throttled budget LOD so a colocated camera swap / viewport
         * resize / FOV change — or the stream (or its hosted proxy) being moved or scaled while still in frustum, which
         * shifts every node's distance and projected size — can't leave it stale.
         * @param cameras the active cameras
         * @returns the signature string
         */
        private _computeLodSignature;
        /**
         * Updates each leaf node's {@link ISOGLODNode.inFrustum} flag: a node is in-frustum if it is inside ANY
         * active camera's frustum (the union). When {@link frustumCulling} is disabled (or there are no cameras)
         * every node is marked in-frustum. Bounds are static (from the LOD tree), so flags are valid for all nodes
         * regardless of decode state. Returns true when any node's in-frustum state changed (so the LOD bias must be re-applied).
         * @returns whether any node's in-frustum state changed
         */
        private _updateNodeFrustum;
        /**
         * Reads the splat count from SOG metadata, coerced to a finite non-negative integer (metadata is untrusted, so
         * `count` / `shape[0]` may be a string or malformed — a non-numeric value must not leak into count arithmetic).
         * @param data SOG metadata
         * @returns the splat count (0 when absent/invalid)
         */
        private static _GetSplatCount;
        /**
         * Reads a SOG file's higher-order SH degree and coefficient count from its metadata, mirroring
         * {@link ParseSogDatas}'s `coeffs`/`shDegree` derivation. Returns zeros when the file carries no `shN`.
         * @param data parsed SOG root metadata
         * @returns the SH degree and higher-order coefficient count (excludes the DC/SH0 term)
         */
        private static _GetShInfo;
        /**
         * Disposes all GPU source textures of a SOG pack (they are only needed for the one decode pass).
         * @param pack the SOG texture pack
         */
        private static _DisposePack;
        /**
         * Expands the running splat-center bounds with a newly decoded file's centers and updates the
         * mesh bounding info so the GS is correctly frustum-culled and pickable.
         * @param positions stride-4 splat centers for the new file
         * @param count number of splats
         */
        private _updateBounds;
        /**
         * Rebuilds the active interval set from the environment plus each node's currently-selected LOD entry,
         * coalesces adjacent ranges, and pushes the result to the sort worker.
         */
        private _refreshActiveRanges;
        /**
         * Sorts and merges adjacent/overlapping ranges to keep the interval list compact.
         * @param ranges raw ranges
         * @returns coalesced ranges
         */
        private static _CoalesceRanges;
        /**
         * Unzips a `.sog` bundle into a name -> bytes map, loading fflate on demand.
         * @param data zipped bytes
         * @returns map of entry name to bytes
         */
        private _unzipAsync;
    }
    /**
     * Adds a PlayCanvas-style SOG LOD stream as a part of a compound Gaussian Splatting mesh, so the streamed
     * splats are depth-sorted and rendered in ONE pass together with the compound's other (static) parts.
     *
     * The returned mesh is a hidden controller: it streams SOG LOD files, GPU-decodes them into a reserved region
     * of the compound's shared atlas, and drives which of its splats are active (LOD) — the compound owns the sort
     * and the single instanced draw. The SOG up-axis orientation is applied to the reserved part's proxy transform;
     * move/hide the part via the proxy (`streamController` exposes it once streaming has started).
     * @param compound the compound mesh to add the streamed part to
     * @param name name for the streaming controller / part
     * @param metadata parsed `lod-meta.json`
     * @param rootUrl base URL the metadata's relative paths resolve against
     * @param options streaming options
     * @returns the streaming controller mesh (hidden; drives the reserved compound part)
     * @experimental
     */
    export function AddGaussianSplattingStreamPart(compound: GaussianSplattingMesh, name: string, metadata: ISOGLODMetadata, rootUrl: string, options?: IGaussianSplattingStreamOptions): GaussianSplattingStream;
    /**
     * Adds a PlayCanvas-style SOG LOD stream as a part of a compound Gaussian Splatting mesh and resolves once the
     * part is ready to use, returning its {@link GaussianSplattingPartProxyMesh} — the same handle
     * `GaussianSplattingCompoundMesh.addPart` returns for a static part. This lets a host application treat a
     * streamed splat exactly like any other compound part (place/frame/gizmo via the proxy, remove via
     * `compound.removePart(proxy.partIndex)`); the streaming controller lives behind the proxy and is disposed
     * automatically when the part is removed.
     *
     * Resolves after the reserved region exists and its base layer has decoded (so the proxy's bounds are real),
     * and rejects if streaming fails before that (the partially-constructed stream is disposed on rejection).
     *
     * NOTE: the base-layer decode runs on the GPU inside the scene's render loop, so this promise only resolves once
     * the scene is rendering. Do not `await` it before the render loop has started (it would never resolve) — start
     * rendering (e.g. `engine.runRenderLoop`) first, or `await` it concurrently with the first frames.
     * @param compound the compound mesh to add the streamed part to
     * @param name name for the streaming controller / part
     * @param metadata parsed `lod-meta.json`
     * @param rootUrl base URL the metadata's relative paths resolve against
     * @param options streaming options
     * @returns the part proxy driving the streamed region, ready to place/frame
     * @experimental
     */
    export function AddGaussianSplattingStreamPartAsync(compound: GaussianSplattingMesh, name: string, metadata: ISOGLODMetadata, rootUrl: string, options?: IGaussianSplattingStreamOptions): Promise<GaussianSplattingPartProxyMesh>;


    /**
     * One resident block relocation produced by {@link GaussianSplattingResidencyController.compact}: the file's
     * splat data must be moved from `oldOffset` to `newOffset` (`count` splats) in the work buffer.
     */
    export interface IResidencyMove {
        /** File index whose splat data must move. */
        file: number;
        /** The file's previous splat offset in the work buffer. */
        oldOffset: number;
        /** The file's new splat offset after compaction. */
        newOffset: number;
        /** Number of splats in the file. */
        count: number;
    }
    /**
     * Tracks which streamed Gaussian Splatting files are resident in the GPU work buffer and where, evicting
     * unreferenced files after a cooldown to keep the resident set within a fixed budget.
     *
     * Built on {@link GaussianSplattingBlockAllocator}: each resident file owns a contiguous block of the work
     * buffer's splat-index address space. A file with no remaining references is scheduled for eviction; after
     * `cooldownFrames` ticks (or sooner, if the space is needed by a new allocation — "evict-to-fit") its block
     * is freed and reused. Pinned files (e.g. the always-rendered environment and the padding splat) are never
     * evicted. The {@link onEvict} callback fires for every file the controller evicts so the owner can drop its
     * own bookkeeping (e.g. mark it no longer decoded).
     *
     * This controller owns only memory/residency bookkeeping — it has no knowledge of the scene, GPU, downloads,
     * or reference counting (the caller decides when a file's reference count reaches zero and calls
     * {@link scheduleEviction}).
     * @experimental
     */
    export class GaussianSplattingResidencyController {
        private readonly _allocator;
        private readonly _blocks;
        private readonly _cooldown;
        private readonly _pinned;
        private readonly _cooldownFrames;
        private readonly _onEvict;
        /**
         * Creates a residency controller.
         * @param capacity total splat-index capacity of the work buffer
         * @param cooldownFrames number of ticks an unreferenced file stays resident before being evicted
         * @param onEvict called with the file index whenever the controller evicts a file (via tick or evict-to-fit)
         */
        constructor(capacity: number, cooldownFrames: number, onEvict: (file: number) => void);
        /**
         * Total splat-index capacity.
         */
        get capacity(): number;
        /**
         * Number of files currently resident.
         */
        get residentCount(): number;
        /**
         * Total free splat capacity (sum of all gaps, which may be fragmented). After {@link compact} an
         * allocation of up to this size is guaranteed to fit.
         */
        get freeSize(): number;
        /**
         * Whether the given file currently has a block in the work buffer.
         * @param file file index
         * @returns true if resident
         */
        has(file: number): boolean;
        /**
         * The work-buffer splat offset of a resident file, or undefined if not resident.
         * @param file file index
         * @returns the splat offset, or undefined
         */
        offset(file: number): number | undefined;
        /**
         * Allocates a contiguous block for a file about to be decoded. If there is no room, evicts files whose
         * eviction cooldown is pending (they are unreferenced) and retries once. Returns the splat offset, or null
         * if it still does not fit (the caller should refuse the decode and keep the node's current LOD).
         * @param file file index
         * @param count number of splats the file needs
         * @returns the allocated splat offset, or null if it cannot fit
         */
        allocate(file: number, count: number): Nullable<number>;
        /**
         * Allocates a block for a file that must never be evicted (e.g. the environment or padding splat).
         * @param file file index (use a sentinel that cannot collide with real file indices)
         * @param count number of splats
         * @returns the allocated splat offset, or null if it cannot fit
         */
        pin(file: number, count: number): Nullable<number>;
        /**
         * Frees a file's block immediately (e.g. when a decode was cancelled before completing). Does not fire
         * {@link onEvict}. No-op for pinned or non-resident files.
         * @param file file index
         */
        free(file: number): void;
        /**
         * Compacts the resident blocks to defragment free space (capacity is unchanged), returning every block
         * that moved so the caller can relocate the corresponding GPU/CPU splat data. Call when an allocation
         * fails despite sufficient total free space ({@link freeSize}); afterwards that allocation will fit.
         * @returns the relocations to apply (empty when nothing moved)
         */
        compact(): IResidencyMove[];
        /**
         * Returns the current resident blocks (file index, splat offset, splat count). Used to relocate GPU/CPU
         * data after {@link compact}.
         * @returns one entry per resident file
         */
        getResidentBlocks(): Array<{
            file: number;
            offset: number;
            count: number;
        }>;
        /**
         * Schedules an unreferenced resident file for eviction after the cooldown. No-op for pinned or
         * non-resident files.
         * @param file file index
         */
        scheduleEviction(file: number): void;
        /**
         * Cancels a pending eviction because the file was referenced again.
         * @param file file index
         */
        cancelEviction(file: number): void;
        /**
         * Advances all eviction cooldowns by one frame, evicting any that expire. Each evicted file fires
         * {@link onEvict}.
         * @returns the file indices evicted this tick
         */
        tick(): number[];
        /**
         * Releases all bookkeeping. The allocator and maps are cleared.
         */
        dispose(): void;
        private _evictAllCooled;
        private _evict;
    }


    /**
     * Options for {@link GaussianSplattingDownloadManager}.
     */
    export interface IGaussianSplattingDownloadManagerOptions {
        /** Maximum number of downloads allowed to run at the same time. PlayCanvas default `2`. */
        maxConcurrent?: number;
        /** Number of times a failed download is retried before rejecting. PlayCanvas default `2` (3 attempts total). */
        maxRetries?: number;
    }
    /** Identifies a group of related downloads so they can be cancelled together. */
    export type DownloadGroupId = string | number;
    /**
     * Throttles the file downloads issued while streaming a Gaussian Splatting LOD scene.
     *
     * Mirrors the PlayCanvas gsplat asset loader: at most {@link maxConcurrent} downloads run at once, the
     * rest wait in a FIFO queue, each failed download is retried up to {@link maxRetries} times, and requests
     * are idempotent — concurrent (queued or in-flight) requests for the same URL share a single download.
     *
     * Downloads can be tagged with a group id and cancelled together via {@link cancelGroup}: when a node's
     * target LOD changes before its file finishes loading, the streamer cancels that file's now-unneeded
     * downloads. Cancellation aborts the underlying HTTP request (a queued download is dropped before it
     * starts; an in-flight download is aborted and its concurrency slot freed), so no bandwidth is wasted on
     * data that is no longer needed.
     *
     * Without this throttling, every on-demand LOD decode fans out into many parallel image fetches, so the
     * browser opens dozens of simultaneous connections that compete for bandwidth and delay the splats the
     * camera actually needs.
     * @experimental
     */
    export class GaussianSplattingDownloadManager {
        /** Maximum number of downloads allowed to run at the same time. */
        readonly maxConcurrent: number;
        /** Number of times a failed download is retried before rejecting. */
        readonly maxRetries: number;
        private _activeCount;
        private readonly _queue;
        private readonly _pending;
        private readonly _groups;
        private _disposed;
        /**
         * Creates a download manager.
         * @param options concurrency and retry limits
         */
        constructor(options?: IGaussianSplattingDownloadManagerOptions);
        /**
         * Whether there are no downloads queued or in flight.
         */
        get isIdle(): boolean;
        /**
         * Downloads a file as an `ArrayBuffer`, queued behind the concurrency cap and retried on failure.
         * Concurrent requests for the same URL resolve from a single shared download.
         * @param url the file URL to download
         * @param groupId optional group tag so related downloads can be cancelled together via {@link cancelGroup}
         * @returns a promise resolving with the downloaded bytes
         */
        loadFileAsync(url: string, groupId?: DownloadGroupId): Promise<ArrayBuffer>;
        /**
         * Cancels a single pending download by URL. A queued download is dropped before it starts; an in-flight
         * download has its underlying HTTP request aborted and its concurrency slot freed. No-op if the URL is
         * not currently pending.
         * @param url the URL to cancel
         */
        cancel(url: string): void;
        /**
         * Cancels every pending download tagged with the given group id.
         * @param groupId the group whose downloads should be cancelled
         */
        cancelGroup(groupId: DownloadGroupId): void;
        /**
         * Cancels every queued download and aborts every in-flight download, preventing new downloads from
         * starting.
         */
        dispose(): void;
        /**
         * Aborts a task: drops it from the queue (if not started), aborts its in-flight HTTP request (if started),
         * unwinds its current attempt, settles its promise, and frees its concurrency slot.
         * @param task the task to abort
         * @param reason the rejection reason
         */
        private _abort;
        /**
         * Settles a task exactly once, removing it from the pending map and its group.
         * @param task the task to settle
         * @param settleFn resolves or rejects the task's promise
         */
        private _settle;
        /**
         * Releases a task's concurrency slot exactly once and pumps the queue.
         * @param task the task whose slot to release
         */
        private _releaseSlot;
        /**
         * Starts as many queued downloads as the concurrency cap allows.
         */
        private _pump;
        /**
         * Runs a single download with retries, settling the task's shared promise. The idempotency entry is
         * removed the moment the task settles so a later request for the same URL starts a fresh download.
         * @param task the queued download to run
         */
        private _runTaskAsync;
        /**
         * Performs one download attempt, exposing the request handle (for abort) and an attempt-rejecter on the
         * task so cancellation can both abort the HTTP request and unwind this awaited attempt.
         * @param task the download task
         * @returns a promise resolving with the downloaded bytes
         */
        private _downloadAttemptAsync;
    }


    /**
     * A node in the {@link GaussianSplattingBlockAllocator}'s linked list, representing either an allocated
     * block or a free region. Callers receive {@link GaussianSplattingMemBlock} instances as handles from
     * {@link GaussianSplattingBlockAllocator.allocate} and must treat their {@link offset}/{@link size} as
     * read-only.
     *
     * Ported from the PlayCanvas engine (`src/core/block-allocator.js`).
     * @experimental
     */
    export class GaussianSplattingMemBlock {
        /** @internal Position in the address space. */
        _offset: number;
        /** @internal Size of this block. */
        _size: number;
        /** @internal True if this is a free region, false if allocated. */
        _free: boolean;
        /** @internal Previous node in the main (all-nodes, offset-ordered) list. */
        _prev: Nullable<GaussianSplattingMemBlock>;
        /** @internal Next node in the main (all-nodes, offset-ordered) list. */
        _next: Nullable<GaussianSplattingMemBlock>;
        /** @internal Previous node in the bucket free-list. */
        _prevFree: Nullable<GaussianSplattingMemBlock>;
        /** @internal Next node in the bucket free-list. */
        _nextFree: Nullable<GaussianSplattingMemBlock>;
        /** @internal Index of the size bucket this free block belongs to, or -1 if not in any bucket. */
        _bucket: number;
        /**
         * The offset of this block in the address space.
         */
        get offset(): number;
        /**
         * The size of this block.
         */
        get size(): number;
    }
    /**
     * A general-purpose 1D block allocator backed by a doubly-linked list with segregated free-list buckets.
     * Manages a linear address space where contiguous blocks can be allocated and freed.
     *
     * Free blocks are organized into power-of-2 size buckets for best-fit allocation, which reduces
     * fragmentation compared to a single first-fit free list. Supports incremental defragmentation and
     * automatic growth. Used to place streamed Gaussian Splatting LOD files into the unified GPU work buffer.
     *
     * Ported from the PlayCanvas engine (`src/core/block-allocator.js`).
     * @experimental
     */
    export class GaussianSplattingBlockAllocator {
        private _headAll;
        private _tailAll;
        private readonly _freeBucketHeads;
        private readonly _pool;
        private _capacity;
        private _usedSize;
        private _freeSize;
        private _freeRegionCount;
        private readonly _growMultiplier;
        /**
         * Creates a new block allocator.
         * @param capacity initial address space capacity (defaults to 0)
         * @param growMultiplier multiplicative growth factor for auto-grow in {@link updateAllocation} (defaults to 1.1)
         */
        constructor(capacity?: number, growMultiplier?: number);
        /**
         * Total address space capacity.
         */
        get capacity(): number;
        /**
         * Total size of all allocated blocks.
         */
        get usedSize(): number;
        /**
         * Total size of all free regions.
         */
        get freeSize(): number;
        /**
         * Fragmentation ratio in the range [0, 1]. Returns 0 when all free space is one contiguous block
         * (ideal), and approaches 1 when free space is split into many pieces. Computed O(1).
         */
        get fragmentation(): number;
        /**
         * Allocates a contiguous block of the given size.
         * @param size the number of units to allocate (must be \> 0)
         * @returns a block handle, or null if no space is available
         */
        allocate(size: number): Nullable<GaussianSplattingMemBlock>;
        /**
         * Frees a previously allocated block. Adjacent free regions are merged automatically.
         * @param block the block to free (must have been returned by {@link allocate})
         */
        free(block: GaussianSplattingMemBlock): void;
        /**
         * Grows the address space. Only increases capacity, never decreases.
         * @param newCapacity the new capacity (must be \> current capacity)
         */
        grow(newCapacity: number): void;
        /**
         * Defragments the allocator by moving allocated blocks to reduce fragmentation.
         *
         * When maxMoves is 0, performs a full compaction in a single O(n) pass: all allocated blocks are packed
         * contiguously from offset 0 and a single free block is placed at the end. When maxMoves \> 0, performs
         * incremental defragmentation (relocate the last block into the first fitting gap, then slide blocks left).
         *
         * Moved blocks have their {@link GaussianSplattingMemBlock.offset} updated in place (handles stay valid),
         * so callers must relocate the corresponding GPU data for every block in the returned set.
         * @param maxMoves maximum number of block moves (0 = full compaction, the default)
         * @param result optional set to receive the moved blocks (defaults to a new set)
         * @returns the set of blocks that were moved
         */
        defrag(maxMoves?: number, result?: Set<GaussianSplattingMemBlock>): Set<GaussianSplattingMemBlock>;
        /**
         * Batch update: frees a set of blocks and allocates new ones. Handles growth and compaction internally
         * when allocations cannot be satisfied. The `toAllocate` array is modified in place: each numeric size
         * entry is replaced with the allocated block.
         * @param toFree blocks to release
         * @param toAllocate sizes to allocate; modified in place (numbers are replaced with block handles)
         * @returns true if a full defrag was performed (all existing blocks have new offsets and must be re-rendered)
         */
        updateAllocation(toFree: GaussianSplattingMemBlock[], toAllocate: Array<number | GaussianSplattingMemBlock>): boolean;
        /**
         * Computes the bucket index for a given block size (= floor(log2(size))).
         * @param size block size (must be \> 0)
         * @returns the bucket index
         */
        private _bucketFor;
        private _addToBucket;
        private _removeFromBucket;
        private _rebucket;
        private _obtain;
        private _release;
        private _insertAfterInMainList;
        private _removeFromMainList;
        private _findFreeBlock;
        private _defragFull;
        private _defragIncremental;
        private _moveBlock;
    }


    /**
     * Class used to load mesh data from OBJ content
     */
    export class SolidParser {
        /** Object descriptor */
        static ObjectDescriptor: RegExp;
        /** Group descriptor */
        static GroupDescriptor: RegExp;
        /** Material lib descriptor */
        static MtlLibGroupDescriptor: RegExp;
        /** Use a material descriptor */
        static UseMtlDescriptor: RegExp;
        /** Smooth descriptor */
        static SmoothDescriptor: RegExp;
        /** Pattern used to detect a vertex */
        static VertexPattern: RegExp;
        /** Pattern used to detect a normal */
        static NormalPattern: RegExp;
        /** Pattern used to detect a UV set */
        static UVPattern: RegExp;
        /** Pattern used to detect a first kind of face (f vertex vertex vertex) */
        static FacePattern1: RegExp;
        /** Pattern used to detect a second kind of face (f vertex/uvs vertex/uvs vertex/uvs) */
        static FacePattern2: RegExp;
        /** Pattern used to detect a third kind of face (f vertex/uvs/normal vertex/uvs/normal vertex/uvs/normal) */
        static FacePattern3: RegExp;
        /** Pattern used to detect a fourth kind of face (f vertex//normal vertex//normal vertex//normal)*/
        static FacePattern4: RegExp;
        /** Pattern used to detect a fifth kind of face (f -vertex/-uvs/-normal -vertex/-uvs/-normal -vertex/-uvs/-normal) */
        static FacePattern5: RegExp;
        /** Pattern used to detect a line(l vertex vertex) */
        static LinePattern1: RegExp;
        /** Pattern used to detect a second kind of line (l vertex/uvs vertex/uvs) */
        static LinePattern2: RegExp;
        /** Pattern used to detect a third kind of line (l vertex/uvs/normal vertex/uvs/normal) */
        static LinePattern3: RegExp;
        private _loadingOptions;
        private _positions;
        private _normals;
        private _uvs;
        private _colors;
        private _extColors;
        private _meshesFromObj;
        private _handledMesh;
        private _indicesForBabylon;
        private _wrappedPositionForBabylon;
        private _wrappedUvsForBabylon;
        private _wrappedColorsForBabylon;
        private _wrappedNormalsForBabylon;
        private _tuplePosNorm;
        private _curPositionInIndices;
        private _hasMeshes;
        private _unwrappedPositionsForBabylon;
        private _unwrappedColorsForBabylon;
        private _unwrappedNormalsForBabylon;
        private _unwrappedUVForBabylon;
        private _triangles;
        private _materialNameFromObj;
        private _objMeshName;
        private _increment;
        private _isFirstMaterial;
        private _grayColor;
        private _materialToUse;
        private _babylonMeshesArray;
        private _pushTriangle;
        private _handednessSign;
        private _hasLineData;
        /**
         * Creates a new SolidParser
         * @param materialToUse defines the array to fill with the list of materials to use (it will be filled by the parse function)
         * @param babylonMeshesArray defines the array to fill with the list of loaded meshes (it will be filled by the parse function)
         * @param loadingOptions defines the loading options to use
         */
        constructor(materialToUse: string[], babylonMeshesArray: Array<Mesh>, loadingOptions: OBJLoadingOptions);
        /**
         * Search for obj in the given array.
         * This function is called to check if a couple of data already exists in an array.
         *
         * If found, returns the index of the founded tuple index. Returns -1 if not found
         * @param arr Array<{ normals: Array<number>, idx: Array<number> }>
         * @param obj Array<number>
         * @returns {boolean}
         */
        private _isInArray;
        private _isInArrayUV;
        /**
         * This function set the data for each triangle.
         * Data are position, normals and uvs
         * If a tuple of (position, normal) is not set, add the data into the corresponding array
         * If the tuple already exist, add only their indice
         *
         * @param data The vertex's data
         * * indicesPositionFromObj: The index in positions array
         * * indicesUvsFromObj: The index in uvs array
         * * indicesNormalFromObj: The index in normals array
         * * positionVectorFromOBJ: The value of position at index objIndice
         * * textureVectorFromOBJ: The value of uvs
         * * normalsVectorFromOBJ: The value of normals at index objNormale
         * * positionColorsFromOBJ: The value of color at index objIndice
         */
        private _setData;
        /**
         * Transform Vector() and BABYLON.Color() objects into numbers in an array
         */
        private _unwrapData;
        /**
         * Create triangles from polygons
         * It is important to notice that a triangle is a polygon
         * We get 5 patterns of face defined in OBJ File :
         * facePattern1 = ["1","2","3","4","5","6"]
         * facePattern2 = ["1/1","2/2","3/3","4/4","5/5","6/6"]
         * facePattern3 = ["1/1/1","2/2/2","3/3/3","4/4/4","5/5/5","6/6/6"]
         * facePattern4 = ["1//1","2//2","3//3","4//4","5//5","6//6"]
         * facePattern5 = ["-1/-1/-1","-2/-2/-2","-3/-3/-3","-4/-4/-4","-5/-5/-5","-6/-6/-6"]
         * Each pattern is divided by the same method
         * @param faces Array[String] The indices of elements
         * @param v Integer The variable to increment
         */
        private _getTriangles;
        /**
         * To get color between color and extension color
         * @param index Integer The index of the element in the array
         * @returns value of target color
         */
        private _getColor;
        /**
         * Create triangles and push the data for each polygon for the pattern 1
         * In this pattern we get vertice positions
         * @param face
         * @param v
         */
        private _setDataForCurrentFaceWithPattern1;
        /**
         * Create triangles and push the data for each polygon for the pattern 2
         * In this pattern we get vertice positions and uvs
         * @param face
         * @param v
         */
        private _setDataForCurrentFaceWithPattern2;
        /**
         * Create triangles and push the data for each polygon for the pattern 3
         * In this pattern we get vertice positions, uvs and normals
         * @param face
         * @param v
         */
        private _setDataForCurrentFaceWithPattern3;
        /**
         * Create triangles and push the data for each polygon for the pattern 4
         * In this pattern we get vertice positions and normals
         * @param face
         * @param v
         */
        private _setDataForCurrentFaceWithPattern4;
        private _setDataForCurrentFaceWithPattern5;
        private _addPreviousObjMesh;
        private _optimizeNormals;
        private static _IsLineElement;
        private static _IsObjectElement;
        private static _IsGroupElement;
        private static _GetZbrushMRGB;
        /**
         * Function used to parse an OBJ string
         * @param meshesNames defines the list of meshes to load (all if not defined)
         * @param data defines the OBJ string
         * @param scene defines the hosting scene
         * @param assetContainer defines the asset container to load data in
         * @param onFileToLoadFound defines a callback that will be called if a MTL file is found
         */
        parse(meshesNames: any, data: string, scene: Scene, assetContainer: Nullable<AssetContainer>, onFileToLoadFound: (fileToLoad: string) => void): void;
    }


    /** Pure barrel — re-exports only side-effect-free modules */


    /**
     * Options for loading OBJ/MTL files
     */
    export type OBJLoadingOptions = {
        /**
         * Defines the character encoding used to decode OBJ and MTL files.
         * Use "auto" to detect UTF-8/UTF-16 and fall back to GB18030, or provide an encoding label supported by TextDecoder.
         * Defaults to "auto".
         */
        encoding?: string;
        /**
         * Defines if UVs are optimized by default during load.
         */
        optimizeWithUV: boolean;
        /**
         * Defines custom scaling of UV coordinates of loaded meshes.
         */
        UVScaling: Vector2;
        /**
         * Invert model on y-axis (does a model scaling inversion)
         */
        invertY: boolean;
        /**
         * Invert Y-Axis of referenced textures on load
         */
        invertTextureY: boolean;
        /**
         * Include in meshes the vertex colors available in some OBJ files.  This is not part of OBJ standard.
         */
        importVertexColors: boolean;
        /**
         * Compute the normals for the model, even if normals are present in the file.
         */
        computeNormals: boolean;
        /**
         * Optimize the normals for the model. Lighting can be uneven if you use OptimizeWithUV = true because new vertices can be created for the same location if they pertain to different faces.
         * Using OptimizehNormals = true will help smoothing the lighting by averaging the normals of those vertices.
         */
        optimizeNormals: boolean;
        /**
         * Skip loading the materials even if defined in the OBJ file (materials are ignored).
         */
        skipMaterials: boolean;
        /**
         * When a material fails to load OBJ loader will silently fail and onSuccess() callback will be triggered.
         */
        materialLoadingFailsSilently: boolean;
        /**
         * Loads assets without handedness conversions. This flag is for compatibility. Use it only if absolutely required. Defaults to false.
         */
        useLegacyBehavior: boolean;
    };


        interface SceneLoaderPluginOptions {
            /**
             * Defines options for the obj loader.
             */
            [OBJFileLoaderMetadata.name]: Partial<OBJLoadingOptions>;
        }


    /**
     * OBJ file type loader.
     * This is a babylon scene loader plugin.
     */
    export class OBJFileLoader implements ISceneLoaderPluginAsync, ISceneLoaderPluginFactory {
        /**
         * Defines the character encoding used to decode OBJ and MTL files.
         */
        static ENCODING: string;
        /**
         * Defines if UVs are optimized by default during load.
         */
        static OPTIMIZE_WITH_UV: boolean;
        /**
         * Invert model on y-axis (does a model scaling inversion)
         */
        static INVERT_Y: boolean;
        /**
         * Invert Y-Axis of referenced textures on load
         */
        static get INVERT_TEXTURE_Y(): boolean;
        static set INVERT_TEXTURE_Y(value: boolean);
        /**
         * Include in meshes the vertex colors available in some OBJ files.  This is not part of OBJ standard.
         */
        static IMPORT_VERTEX_COLORS: boolean;
        /**
         * Compute the normals for the model, even if normals are present in the file.
         */
        static COMPUTE_NORMALS: boolean;
        /**
         * Optimize the normals for the model. Lighting can be uneven if you use OptimizeWithUV = true because new vertices can be created for the same location if they pertain to different faces.
         * Using OptimizehNormals = true will help smoothing the lighting by averaging the normals of those vertices.
         */
        static OPTIMIZE_NORMALS: boolean;
        /**
         * Defines custom scaling of UV coordinates of loaded meshes.
         */
        static UV_SCALING: Vector2;
        /**
         * Skip loading the materials even if defined in the OBJ file (materials are ignored).
         */
        static SKIP_MATERIALS: boolean;
        /**
         * When a material fails to load OBJ loader will silently fail and onSuccess() callback will be triggered.
         *
         * Defaults to true for backwards compatibility.
         */
        static MATERIAL_LOADING_FAILS_SILENTLY: boolean;
        /**
         * Loads assets without handedness conversions. This flag is for compatibility. Use it only if absolutely required. Defaults to false.
         */
        static USE_LEGACY_BEHAVIOR: boolean;
        /**
         * Defines the name of the plugin.
         */
        readonly name: "obj";
        /**
         * Defines the extension the plugin is able to load.
         */
        readonly extensions: {
            readonly ".obj": {
                readonly isBinary: true;
            };
        };
        private _assetContainer;
        private _loadingOptions;
        /**
         * Creates loader for .OBJ files
         *
         * @param loadingOptions options for loading and parsing OBJ/MTL files.
         */
        constructor(loadingOptions?: Partial<Readonly<OBJLoadingOptions>>);
        private static get _DefaultLoadingOptions();
        /**
         * Calls synchronously the MTL file attached to this obj.
         * Load function or importMesh function don't enable to load 2 files in the same time asynchronously.
         * Without this function materials are not displayed in the first frame (but displayed after).
         * In consequence it is impossible to get material information in your HTML file
         *
         * @param url The URL of the MTL file
         * @param rootUrl defines where to load data from
         * @param onSuccess Callback function to be called when the MTL file is loaded
         * @param onFailure
         */
        private _loadMTL;
        private _decode;
        /** @internal */
        createPlugin(options: SceneLoaderPluginOptions): ISceneLoaderPluginAsync | ISceneLoaderPlugin;
        /**
         * If the data string can be loaded directly.
         * @returns if the data can be loaded directly
         */
        canDirectLoad(): boolean;
        /**
         * Imports one or more meshes from the loaded OBJ data and adds them to the scene
         * @param meshesNames a string or array of strings of the mesh names that should be loaded from the file
         * @param scene the scene the meshes should be added to
         * @param data the OBJ data to load
         * @param rootUrl root url to load from
         * @returns a promise containing the loaded meshes, particles, skeletons and animations
         */
        importMeshAsync(meshesNames: any, scene: Scene, data: any, rootUrl: string): Promise<ISceneLoaderAsyncResult>;
        /**
         * Imports all objects from the loaded OBJ data and adds them to the scene
         * @param scene the scene the objects should be added to
         * @param data the OBJ data to load
         * @param rootUrl root url to load from
         * @returns a promise which completes when objects have been loaded to the scene
         */
        loadAsync(scene: Scene, data: string | ArrayBuffer, rootUrl: string): Promise<void>;
        /**
         * Load into an asset container.
         * @param scene The scene to load into
         * @param data The data to import
         * @param rootUrl The root url for scene and resources
         * @returns The loaded asset container
         */
        loadAssetContainerAsync(scene: Scene, data: string | ArrayBuffer, rootUrl: string): Promise<AssetContainer>;
        /**
         * Read the OBJ file and create an Array of meshes.
         * Each mesh contains all information given by the OBJ and the MTL file.
         * i.e. vertices positions and indices, optional normals values, optional UV values, optional material
         * @param meshesNames defines a string or array of strings of the mesh names that should be loaded from the file
         * @param scene defines the scene where are displayed the data
         * @param data defines the content of the obj file
         * @param rootUrl defines the path to the folder
         * @returns the list of loaded meshes
         */
        private _parseSolidAsync;
    }
    /**
     * Registers the OBJFileLoader scene loader plugin.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterOBJFileLoader(): void;


    export var OBJFileLoaderMetadata: {
        readonly name: "obj";
        readonly extensions: {
            readonly ".obj": {
                readonly isBinary: true;
            };
        };
    };


    /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./objFileLoader.pure" for tree-shakeable, side-effect-free usage.
     */


    /**
     * Class reading and parsing the MTL file bundled with the obj file.
     */
    export class MTLFileLoader {
        /**
         * Invert Y-Axis of referenced textures on load
         */
        static INVERT_TEXTURE_Y: boolean;
        /**
         * All material loaded from the mtl will be set here
         */
        materials: StandardMaterial[];
        /**
         * This function will read the mtl file and create each material described inside
         * This function could be improve by adding :
         * -some component missing (Ni, Tf...)
         * -including the specific options available
         *
         * @param scene defines the scene the material will be created in
         * @param data defines the mtl data to parse
         * @param rootUrl defines the rooturl to use in order to load relative dependencies
         * @param assetContainer defines the asset container to store the material in (can be null)
         */
        parseMTL(scene: Scene, data: string | ArrayBuffer, rootUrl: string, assetContainer: Nullable<AssetContainer>): void;
        /**
         * Gets the texture for the material.
         *
         * If the material is imported from input file,
         * We sanitize the url to ensure it takes the texture from aside the material.
         *
         * @param rootUrl The root url to load from
         * @param value The value stored in the mtl
         * @param scene
         * @returns The Texture
         */
        private static _GetTexture;
    }




    /** Pure barrel — re-exports only side-effect-free modules */




        interface SceneLoaderPluginOptions {
            /**
             * Defines options for the FBX loader.
             */
            [FBXFileLoaderMetadata.name]: Partial<FBXFileLoaderOptions>;
        }


    /**
     * Source convention for tangent-space normal maps loaded from FBX normal-map slots.
     */
    export type FBXNormalMapCoordinateSystem = "y-up" | "y-down";
    /**
     * Defines options for the FBX loader.
     */
    export interface FBXFileLoaderOptions {
        /**
         * Source convention for tangent-space normal maps connected through FBX normal-map slots.
         * FBX does not standardize this convention, so the loader defaults to the glTF/USD-style Y-up convention.
         * Set to "y-down" for assets authored with inverted green/Y normal maps.
         */
        normalMapCoordinateSystem?: FBXNormalMapCoordinateSystem;
    }
    /**
     * FBX file loader plugin for Babylon.js.
     * Pure TypeScript implementation — no Autodesk FBX SDK dependency.
     */
    export class FBXFileLoader implements ISceneLoaderPluginAsync, ISceneLoaderPluginFactory {
        /**
         * Defines the name of the plugin.
         */
        readonly name: "fbx";
        /**
         * Defines the extension the plugin is able to load.
         */
        readonly extensions: {
            readonly ".fbx": {
                readonly isBinary: true;
            };
        };
        private readonly _options;
        private readonly _bindRestBones;
        private readonly _sourceBonesBySkeleton;
        private readonly _scaleCompensationHelpersBySkeleton;
        /**
         * Creates a new FBX loader.
         * @param options - Options controlling FBX loading behavior
         */
        constructor(options?: FBXFileLoaderOptions);
        /**
         * Creates an FBX loader plugin instance with options from SceneLoader.
         * @param options - Scene loader plugin options
         * @returns The configured FBX loader
         */
        createPlugin(options: SceneLoaderPluginOptions): ISceneLoaderPluginAsync;
        /**
         * Imports meshes from an FBX file and adds them to the scene.
         * @param meshesNames - A string or array of mesh names to import, or null/undefined to import all meshes
         * @param scene - The scene to add imported meshes to
         * @param data - The FBX data to load
         * @param rootUrl - Root URL used to resolve external resources
         * @param _onProgress - Callback called while the file is loading
         * @param _fileName - Name of the file being loaded
         * @returns A promise containing the loaded meshes, particle systems, skeletons, animation groups, transform nodes, geometries, and lights
         */
        importMeshAsync(meshesNames: string | readonly string[] | null | undefined, scene: Scene, data: unknown, rootUrl: string, _onProgress?: (event: ISceneLoaderProgressEvent) => void, _fileName?: string): Promise<ISceneLoaderAsyncResult>;
        /**
         * Loads all FBX content into the scene.
         * @param scene - The scene to load the FBX content into
         * @param data - The FBX data to load
         * @param rootUrl - Root URL used to resolve external resources
         * @param _onProgress - Callback called while the file is loading
         * @param _fileName - Name of the file being loaded
         * @returns A promise that resolves when loading is complete
         */
        loadAsync(scene: Scene, data: unknown, rootUrl: string, _onProgress?: (event: ISceneLoaderProgressEvent) => void, _fileName?: string): Promise<void>;
        /**
         * Loads all FBX content into an asset container.
         * @param scene - The scene used to create the asset container
         * @param data - The FBX data to load
         * @param rootUrl - Root URL used to resolve external resources
         * @param _onProgress - Callback called while the file is loading
         * @param _fileName - Name of the file being loaded
         * @returns A promise containing the loaded asset container
         */
        loadAssetContainerAsync(scene: Scene, data: unknown, rootUrl: string, _onProgress?: (event: ISceneLoaderProgressEvent) => void, _fileName?: string): Promise<AssetContainer>;
        private _parse;
        private _parseFromArrayBuffer;
        private _buildScene;
        private _addMaterialToContainer;
        private _addTextureToContainer;
        private _setAssetContainer;
        private static _computeFBXAxisConversionMatrix;
        private _buildModel;
        private _linkSkeletonsToTransformNodes;
        private static _modelSubtreeMatchesNameFilter;
        private static _applyModelMetadata;
        private _createMesh;
        /**
         * Apply multi-material to a mesh by creating sub-meshes grouped by material index.
         * Reorders the index buffer so that triangles sharing the same material are contiguous.
         */
        private _applyMultiMaterial;
        private static _collectCullingConflictMaterialIds;
        private static _getModelMaterial;
        private _applyMaterialUVSetCoordinates;
        private _applyStandardMaterialUVSetCoordinates;
        /**
         * Babylon multiplies vertex colors by material diffuse color. Use per-mesh
         * material clones so vertex-colored geometry can render unmodulated without
         * changing shared materials used by non-vertex-colored meshes.
         */
        private _useUnmodulatedVertexColorMaterials;
        /**
         * Build per-polygon-vertex bone indices and weights from the control-point-based skin data.
         * The geometry expands control points to per-polygon-vertex, so we need to look up
         * each polygon-vertex's control point index.
         */
        private _buildSkinningData;
        private _createMaterial;
        private _configureNormalTexture;
        private _getNormalMapTangentHandednessScale;
        private static _isSupportedMaterialTextureSlot;
        private static _isNormalMapTextureSlot;
        private static _createTexture;
        private static _createExternalTexture;
        private static _buildTextureFallbackUrls;
        private static _getTextureCreationOptions;
        private static _getExternalTextureUrls;
        private static _getTextureSourceName;
        private static _getTextureSourceNameFromPath;
        private static _isSafeRelativeTexturePath;
        private static _getForcedExtension;
        private static _getMimeType;
        /**
         * Apply blend shape (morph target) deformers to meshes.
         * FBX Shape vertices are stored as absolute positions for sparse control points.
         * We compute deltas relative to the base mesh positions.
         */
        private _applyBlendShapes;
        private _createCamera;
        private _createLight;
        private _createSkeleton;
        private _getSourceBone;
        private _getScaleCompensationHelper;
        private static _computeFBXAbsoluteMatrices;
        private static _computeFBXRuntimeLocalMatrix;
        private static _applyParentScaleCompensation;
        private static _splitParentScaleCompensatedLocalMatrix;
        private static _safeInverseScale;
        private static _getInverseScaleVector;
        private static _shouldUseBindMatricesAsRest;
        private static _getMaxScaleRatio;
        private static _getScaleRatio;
        private static _computeFBXGeometricMatrix;
        private static _computeFBXGeometricDeltaMatrix;
        private static _computeFBXGeometricNormalMatrix;
        /**
         * Compute the full FBX local transform matrix:
         * M = T * Roff * Rp * Rpre * R * Rpost^-1 * Rp^-1 * Soff * Sp * S * Sp^-1
         *
         * In row-vector convention: v' = v * M
         */
        private static _computeFBXLocalMatrix;
        /**
         * Apply the FBX transform chain to a Babylon TransformNode or Mesh.
         * Decomposes the full local matrix into position/rotation/scale.
         */
        private static _applyFBXTransform;
        private static _computeFBXModelLocalMatrix;
        private static _getBoneReferenceWorldMatrix;
        private static _applyMatrixToTransform;
        private _createAnimationGroup;
        private _buildInheritedRigBoneAnimations;
        private static _pushMatrixKeys;
        /**
         * Build animations for a non-bone node, correctly handling pivots.
         * Computes the full FBX transform matrix at each keyframe and decomposes into TRS.
         */
        private _buildNodeAnimations;
        private _isVector3KeysConstant;
        private _sampleModelLocalMatrix;
        private _sampleModelScale;
        /**
         * Build matrix-baked bone animation from full FBX local transforms.
         * The bind matrix carries the skinning offset, so animation curves drive
         * the same FBX local transform chain as the source skeleton.
         */
        private _buildBoneAnimations;
        private _buildNameFilter;
    }
    /**
     * Registers the FBXFileLoader scene loader plugin.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterFBXFileLoader(): void;


    /**
     * Defines the FBX loader plugin metadata.
     */
    export var FBXFileLoaderMetadata: {
        readonly name: "fbx";
        readonly extensions: {
            readonly ".fbx": {
                readonly isBinary: true;
            };
        };
    };


    /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./fbxFileLoader.pure" for tree-shakeable, side-effect-free usage.
     */


    /**
     * Intermediate representation for parsed FBX data.
     * Both binary and ASCII parsers produce this same structure.
     */
    /** Individual property value within an FBX node */
    export type FBXPropertyValue = boolean | number | string | Float32Array | Float64Array | Int32Array | Uint8Array;
    /** Parsed FBX property type identifier. */
    export type FBXPropertyType = "boolean" | "int16" | "int32" | "int64" | "float32" | "float64" | "string" | "raw" | "float32[]" | "float64[]" | "int32[]" | "int64[]" | "boolean[]";
    /** Individual property within an FBX node. */
    export interface FBXProperty {
        /** Parsed property type. */
        type: FBXPropertyType;
        /** Parsed property value. */
        value: FBXPropertyValue;
    }
    /** A node in the FBX document tree */
    export interface FBXNode {
        /** Node name. */
        name: string;
        /** Node properties. */
        properties: FBXProperty[];
        /** Child nodes. */
        children: FBXNode[];
    }
    /** Top-level parsed FBX document */
    export interface FBXDocument {
        /** FBX file version. */
        version: number;
        /** Top-level document nodes. */
        nodes: FBXNode[];
    }
    /** Helper to find a child node by name */
    export function findChildByName(node: FBXNode, name: string): FBXNode | undefined;
    /** Helper to find all children with a given name */
    export function findChildrenByName(node: FBXNode, name: string): FBXNode[];
    /** Helper to find a top-level node in a document */
    export function findDocumentNode(doc: FBXDocument, name: string): FBXNode | undefined;
    /** Extract a property value by index, with type narrowing */
    export function getPropertyValue<T extends FBXPropertyValue>(node: FBXNode, index: number): T | undefined;
    /**
     * Converts an FBX object ID value to a safe JavaScript number.
     * @param value - Parsed FBX object ID value
     * @returns The object ID, or undefined when the value is not numeric
     */
    export function getSafeFBXObjectId(value: unknown): number | undefined;
    /** Get the numeric ID from a node (first property is typically the int64 UID) */
    export function getNodeId(node: FBXNode): number | undefined;
    /**
     * Clean FBX object names.
     * FBX names may contain:
     *   - A "Class::" prefix (e.g. "Model::valkyrie_mesh") — strip it
     *   - A binary null/control-character class suffix — strip it
     */
    export function cleanFBXName(fbxName: string): string;


    /**
     * Inflate a zlib-wrapped deflate stream.
     *
     * This implementation is intentionally scoped to FBX binary array payloads: one-shot,
     * synchronous zlib streams with the exact uncompressed length known up front.
     */
    export function inflateZlib(input: Uint8Array, expectedLength: number): Uint8Array;


    /**
     * Parse a binary FBX file into an FBXDocument.
     * Supports FBX versions 7.0–7.7 (v7.5+ uses 64-bit node headers).
     */
    export function parseBinaryFBX(buffer: ArrayBuffer): FBXDocument;


    /**
     * Parse an ASCII FBX file into an FBXDocument.
     */
    export function parseAsciiFBX(text: string): FBXDocument;


    export type FBXVector3 = [number, number, number];
    export interface FBXTransformComponents {
        translation: FBXVector3;
        rotation: FBXVector3;
        scale: FBXVector3;
        preRotation: FBXVector3;
        postRotation: FBXVector3;
        rotationPivot: FBXVector3;
        scalingPivot: FBXVector3;
        rotationOffset: FBXVector3;
        scalingOffset: FBXVector3;
        rotationOrder: number;
        inheritType?: number;
    }
    export function eulerToMatrixXYZ(rx: number, ry: number, rz: number): Matrix;
    export function eulerToMatrix(rx: number, ry: number, rz: number, order: number): Matrix;
    export function computeFBXGeometricMatrix(translation: FBXVector3, rotation: FBXVector3, scale: FBXVector3): Matrix;
    export function computeFBXGeometricDeltaMatrix(rotation: FBXVector3, scale: FBXVector3): Matrix;
    export function computeFBXGeometricNormalMatrix(rotation: FBXVector3, scale: FBXVector3): Matrix;
    export function computeFBXLocalMatrix(components: FBXTransformComponents): Matrix;


    export type FBXClusterMode = "Normalize" | "Additive" | "TotalOne" | "Unknown";
    export interface FBXSkinDiagnostic {
        type: "cluster-mode-runtime-unsupported" | "missing-cluster-transform" | "missing-cluster-transform-link" | "missing-bind-pose-matrix" | "associate-model-present";
        message: string;
        boneModelId?: number;
        boneName?: string;
        clusterMode?: FBXClusterMode;
    }
    /** Represents a single bone (cluster) in the FBX skeleton */
    export interface FBXBoneData {
        /** The Model node ID for this bone */
        modelId: number;
        /** Bone name (from the Model node) */
        name: string;
        /** Index of this bone in the skeleton */
        index: number;
        /** Index of the parent bone (-1 for root) */
        parentIndex: number;
        /** Whether this bone corresponds to an FBX Cluster with vertex weights */
        isCluster: boolean;
        /** Local translation from parent (Lcl Translation) */
        translation: [number, number, number];
        /** Local rotation in degrees (Lcl Rotation) */
        rotation: [number, number, number];
        /** Pre-rotation in degrees (applied before Lcl Rotation) */
        preRotation: [number, number, number];
        /** Post-rotation in degrees (applied after Lcl Rotation, inverted) */
        postRotation: [number, number, number];
        /** Rotation pivot point */
        rotationPivot: [number, number, number];
        /** Scaling pivot point */
        scalingPivot: [number, number, number];
        /** Rotation offset */
        rotationOffset: [number, number, number];
        /** Scaling offset */
        scalingOffset: [number, number, number];
        /** Local scale (Lcl Scaling) */
        scale: [number, number, number];
        /** Rotation order: 0=XYZ, 1=XZY, 2=YZX, 3=YXZ, 4=ZXY, 5=ZYX */
        rotationOrder: number;
        /** FBX transform inheritance mode. 0=RrSs, 1=RSrs, 2=Rrs */
        inheritType: number;
        /** Cluster skinning mode */
        clusterMode: FBXClusterMode;
        /** Bind pose transform matrix (cluster Transform, 4x4) */
        bindPoseMatrix: Float64Array | null;
        /** Bone's world transform at bind time (cluster TransformLink, 4x4) */
        transformLinkMatrix: Float64Array | null;
        /** Associate model world transform at bind time (cluster TransformAssociateModel, 4x4) */
        transformAssociateModelMatrix: Float64Array | null;
        /** Model's absolute matrix from the FBX BindPose, when present */
        modelBindPoseMatrix: Float64Array | null;
        /** Recoverable bind/skinning diagnostics for this bone */
        diagnostics: FBXSkinDiagnostic[];
    }
    /** Represents a skin deformer with its clusters */
    export interface FBXSkinData {
        /** Skin deformer ID */
        id: number;
        /** Geometry ID this skin is attached to */
        geometryId: number;
        /** Mesh model world matrix from the FBX BindPose, when present */
        meshBindPoseMatrix: Float64Array | null;
        /** Bones in this skeleton */
        bones: FBXBoneData[];
        /** Per-vertex bone indices, sorted by descending weight and capped for Babylon skinning */
        boneIndices: number[][];
        /** Per-vertex bone weights, matching boneIndices */
        boneWeights: number[][];
        /** Recoverable skinning/bind diagnostics */
        diagnostics: FBXSkinDiagnostic[];
    }
    /**
     * Extract all skin deformers from the FBX scene.
     * Returns skin data including bone hierarchy and vertex weights.
     */
    export function extractSkins(objectMap: FBXObjectMap): FBXSkinData[];
    export function isSkeletonModel(modelNode: FBXNode): boolean;
    export function extractBoneTransform(modelNode: FBXNode): {
        translation: [number, number, number];
        rotation: [number, number, number];
        preRotation: [number, number, number];
        postRotation: [number, number, number];
        rotationPivot: [number, number, number];
        scalingPivot: [number, number, number];
        rotationOffset: [number, number, number];
        scalingOffset: [number, number, number];
        scale: [number, number, number];
        rotationOrder: number;
        inheritType: number;
    };


    export type FBXSceneDiagnosticType = "unsupported-constraint" | "unsupported-helper" | "unsupported-deformer" | "unsupported-node-attribute" | "unsupported-pose" | "unsupported-layered-texture" | "connection-graph";
    export interface FBXSceneDiagnostic {
        type: FBXSceneDiagnosticType;
        message: string;
        objectId?: number;
        objectName?: string;
        nodeName?: string;
        subType?: string;
        /** Number of accepted parent graph edges for objectId, when objectId is known. */
        parentCount?: number;
        childCount?: number;
    }
    export function extractSceneDiagnostics(objectMap: FBXObjectMap): FBXSceneDiagnostic[];


    export type FBXRigBoneData = FBXBoneData;
    export interface FBXSkinBindingData {
        skinId: number;
        geometryId: number;
        rigId: string;
        skinBoneIndexToRigBoneIndex: number[];
        clusterModelIds: Set<number>;
    }
    export interface FBXRigData {
        id: string;
        rootModelIds: number[];
        bones: FBXRigBoneData[];
        modelIdToBoneIndex: Map<number, number>;
        clusterModelIds: Set<number>;
        skinBindings: FBXSkinBindingData[];
        warnings: string[];
    }
    export function resolveRigs(objectMap: FBXObjectMap, skins: FBXSkinData[]): FBXRigData[];


    export interface FBXTemplateProperty {
        name: string;
        propertyType: string;
        label: string;
        flags: string;
        values: FBXPropertyValue[];
    }
    export interface FBXPropertyTemplate {
        objectType: string;
        templateName: string;
        properties: Map<string, FBXTemplateProperty>;
    }
    export type FBXPropertyTemplateMap = Map<string, Map<string, FBXPropertyTemplate>>;
    export function extractPropertyTemplates(doc: FBXDocument): FBXPropertyTemplateMap;
    export function getPropertyTemplate(templates: FBXPropertyTemplateMap, objectType: string, templateName?: string): FBXPropertyTemplate | undefined;
    export function getTemplatePropertyValue<T extends FBXPropertyValue>(template: FBXPropertyTemplate | undefined, propertyName: string, valueIndex?: number): T | undefined;
    export function resolvePropertyValue<T extends FBXPropertyValue>(node: FBXNode, template: FBXPropertyTemplate | undefined, propertyName: string, valueIndex?: number): T | undefined;
    export function resolveNumberProperty(node: FBXNode, template: FBXPropertyTemplate | undefined, propertyName: string, fallback: number): number;
    export function resolveVector2Property(node: FBXNode, template: FBXPropertyTemplate | undefined, propertyName: string, fallback: [number, number]): [number, number];
    export function resolveVector3Property(node: FBXNode, template: FBXPropertyTemplate | undefined, propertyName: string, fallback: [number, number, number]): [number, number, number];
    export function resolvePropertyValues(node: FBXNode, template: FBXPropertyTemplate | undefined, propertyName: string): FBXPropertyValue[] | undefined;


    /** Parsed material data */
    export interface FBXMaterialData {
        id: number;
        name: string;
        type: "Lambert" | "Phong";
        properties: FBXMaterialProperties;
        textures: FBXTextureRef[];
    }
    export interface FBXMaterialProperties {
        diffuseColor?: [number, number, number];
        diffuseFactor?: number;
        ambientColor?: [number, number, number];
        ambientFactor?: number;
        specularColor?: [number, number, number];
        specularFactor?: number;
        shininess?: number;
        emissiveColor?: [number, number, number];
        emissiveFactor?: number;
        opacity?: number;
        transparencyFactor?: number;
    }
    export interface FBXTextureRef {
        /** Which material property this texture is connected to */
        propertyName: string;
        /** Absolute file path from the FBX */
        fileName: string;
        /** Relative file path from the FBX */
        relativeFileName: string;
        /** Texture node ID */
        id: number;
        /** Embedded texture data (from Video node Content), if available */
        embeddedData: Uint8Array | null;
        /** UV translation [u, v] */
        uvTranslation?: [number, number];
        /** UV scaling [u, v] */
        uvScaling?: [number, number];
        /** UV rotation in degrees */
        uvRotation?: number;
        /** Which UV set index this texture uses */
        uvSetIndex?: number;
        /** Which named UV set this texture uses */
        uvSetName?: string;
    }
    /**
     * Extract material data from an FBX Material node.
     */
    export function extractMaterial(materialNode: FBXNode, materialId: number, objectMap: FBXObjectMap, templates?: FBXPropertyTemplateMap): FBXMaterialData;


    /** A named UV set */
    export interface FBXUVSet {
        /** UV set name (e.g. "UVMap", "lightmap") */
        name: string;
        /** Per-vertex UV data [u,v, ...] (expanded to match triangle vertices) */
        data: Float64Array;
    }
    /** Recoverable geometry import issue. */
    export interface FBXGeometryDiagnostic {
        /** Diagnostic category. */
        type: "degenerate-polygon" | "triangulation-fallback" | "layer-index-out-of-bounds" | "layer-data-too-short";
        /** Human-readable diagnostic message. */
        message: string;
        /** Polygon index associated with the diagnostic, if applicable. */
        polygonIndex?: number;
        /** Layer element name associated with the diagnostic, if applicable. */
        layerName?: string;
        /** Source data index associated with the diagnostic, if applicable. */
        index?: number;
    }
    /** Parsed geometry data ready for Babylon consumption */
    export interface FBXGeometryData {
        /** Node ID from the FBX document */
        id: number;
        /** Geometry name */
        name: string;
        /** Flat array of vertex positions [x,y,z, x,y,z, ...] */
        positions: Float64Array;
        /** Triangle indices (already triangulated from n-gons) */
        indices: Uint32Array;
        /** Per-vertex normals [x,y,z, ...] (expanded to match triangle vertices) */
        normals: Float64Array | null;
        /** Per-vertex UVs [u,v, ...] (expanded to match triangle vertices) — first UV set for convenience */
        uvs: Float64Array | null;
        /** All UV sets (including the first) */
        uvSets: FBXUVSet[];
        /** Per-vertex colors [r,g,b,a, ...] (expanded to match triangle vertices) */
        colors: Float32Array | null;
        /** Per-vertex tangents [x,y,z,w, ...] expanded to match triangle vertices */
        tangents: Float64Array | null;
        /** Per-vertex binormals [x,y,z, ...] expanded to match triangle vertices */
        binormals: Float64Array | null;
        /** Control point index for each polygon-vertex (for skinning lookup) */
        controlPointIndices: Uint32Array | null;
        /** Per-triangle material index (which material each triangle belongs to) */
        materialIndices: Int32Array | null;
        /** Recoverable geometry import issues */
        diagnostics: FBXGeometryDiagnostic[];
    }
    /**
     * Extract geometry data from an FBX Geometry node.
     * Handles polygon triangulation and layer element expansion.
     */
    export function extractGeometry(geometryNode: FBXNode, nodeId: number): FBXGeometryData;


    /** Represents a model (transform node) in the FBX scene */
    export interface FBXModelData {
        id: number;
        name: string;
        subType: string;
        /** Geometry attached to this model (if it's a Mesh type) */
        geometry?: FBXGeometryData;
        /** Materials assigned to this model */
        materials: FBXMaterialData[];
        /** Child models */
        children: FBXModelData[];
        /** Transform properties */
        translation: [number, number, number];
        rotation: [number, number, number];
        scale: [number, number, number];
        /** PreRotation (applied before Lcl Rotation, in degrees) */
        preRotation: [number, number, number];
        /** PostRotation (applied after Lcl Rotation, inverted, in degrees) */
        postRotation: [number, number, number];
        /** RotationPivot — point around which rotation occurs */
        rotationPivot: [number, number, number];
        /** ScalingPivot — point around which scaling occurs */
        scalingPivot: [number, number, number];
        /** RotationOffset — translation after rotation pivot */
        rotationOffset: [number, number, number];
        /** ScalingOffset — translation after scaling pivot */
        scalingOffset: [number, number, number];
        /** Geometric transforms — applied to geometry only, do not affect children */
        geometricTranslation: [number, number, number];
        geometricRotation: [number, number, number];
        geometricScaling: [number, number, number];
        /** Rotation order: 0=XYZ, 1=XZY, 2=YZX, 3=YXZ, 4=ZXY, 5=ZYX */
        rotationOrder: number;
        /** FBX transform inheritance mode. 0=RrSs, 1=RSrs, 2=Rrs */
        inheritType: number;
        /** Whether backface culling is disabled ("CullingOff") */
        cullingOff: boolean;
        /** User-defined custom properties from Properties70 */
        customProperties?: Record<string, string | number | boolean>;
        /** Recoverable model import diagnostics */
        diagnostics: string[];
    }
    /** Camera data extracted from FBX */
    export interface FBXCameraData {
        /** Model ID this camera is attached to */
        modelId: number;
        /** Camera name */
        name: string;
        /** Field of view in degrees */
        fieldOfView: number;
        /** Near clip plane */
        nearPlane: number;
        /** Far clip plane */
        farPlane: number;
        /** Aspect ratio (width/height), 0 = use viewport */
        aspectRatio: number;
        /** Projection type */
        projectionType: "perspective" | "orthographic";
        /** Focal length in millimeters when present */
        focalLength?: number;
        /** Filmback width in inches when present */
        filmWidth?: number;
        /** Filmback height in inches when present */
        filmHeight?: number;
        /** Orthographic zoom/height when present */
        orthoZoom?: number;
        /** Camera roll in degrees when present */
        roll?: number;
        /** Known unsupported or unrecognized camera properties */
        unknownProperties: string[];
        /** Recoverable camera import diagnostics */
        diagnostics: string[];
    }
    /** Light data extracted from FBX */
    export interface FBXLightData {
        /** Model ID this light is attached to */
        modelId: number;
        /** Light name */
        name: string;
        /** Light type: 0=Point, 1=Directional, 2=Spot */
        lightType: number;
        /** Color [r,g,b] 0-1 */
        color: [number, number, number];
        /** Intensity multiplier */
        intensity: number;
        /** Cone angle in degrees (for spot lights) */
        coneAngle: number;
        /** Decay type: 0=None, 1=Linear, 2=Quadratic */
        decayType: number;
        /** Inner cone angle in degrees for spot lights */
        innerAngle?: number;
        /** Outer cone angle in degrees for spot lights */
        outerAngle?: number;
        /** Distance at which FBX attenuation starts; preserved as metadata */
        decayStart?: number;
        /** Whether FBX near attenuation is enabled */
        enableNearAttenuation?: boolean;
        /** Whether FBX far attenuation is enabled */
        enableFarAttenuation?: boolean;
        /** Whether the source light requested shadow casting */
        castShadows?: boolean;
        /** Known unsupported or unrecognized light properties */
        unknownProperties: string[];
        /** Recoverable light import diagnostics */
        diagnostics: string[];
    }
    /** Result of interpreting an FBX document */
    export interface FBXSceneData {
        /** All root-level models */
        rootModels: FBXModelData[];
        /** All geometries in the scene */
        geometries: FBXGeometryData[];
        /** All materials in the scene */
        materials: FBXMaterialData[];
        /** Skin deformers (skeletons + vertex weights) */
        skins: FBXSkinData[];
        /** Resolved deformation rigs shared by one or more skins */
        rigs: FBXRigData[];
        /** Blend shape deformers (morph targets) */
        blendShapes: FBXBlendShapeData[];
        /** Animation stacks (clips) */
        animations: FBXAnimationStackData[];
        /** Cameras */
        cameras: FBXCameraData[];
        /** Lights */
        lights: FBXLightData[];
        /** Scene-level unsupported feature diagnostics */
        diagnostics: FBXSceneDiagnostic[];
        /** Global settings */
        upAxis: number;
        upAxisSign: number;
        frontAxis: number;
        frontAxisSign: number;
        coordAxis: number;
        coordAxisSign: number;
        unitScaleFactor: number;
    }
    /**
     * Interpret a parsed FBX document into scene data.
     */
    export function interpretFBX(doc: FBXDocument): FBXSceneData;


    /** Connection type: OO = object-to-object, OP = object-to-property */
    export type ConnectionType = "OO" | "OP";
    /** A resolved FBX object connection. */
    export interface FBXConnection {
        /** Connection type. */
        type: ConnectionType;
        /** Child object ID. */
        childId: number;
        /** Parent object ID. */
        parentId: number;
        /** For OP connections, the property name on the parent (e.g. "DiffuseColor") */
        propertyName?: string;
    }
    /** Object table entry used by the FBX connection graph. */
    export interface FBXObjectEntry {
        /** Object ID. */
        id: number;
        /** Object node. */
        node: FBXNode;
        /** Source of the object entry. */
        source: "Objects" | "legacySyntheticGeometry";
        /** Legacy string object name, when applicable. */
        legacyName?: string;
        /** True if the object was synthesized for legacy compatibility. */
        synthetic: boolean;
    }
    /** Raw connection-table entry and import status. */
    export interface FBXConnectionEntry {
        /** Source node name. */
        source: "C" | "Connect";
        /** Raw connection type. */
        rawType?: string;
        /** Child object ID, when resolved. */
        childId?: number;
        /** Parent object ID, when resolved. */
        parentId?: number;
        /** OP connection property name, when present. */
        propertyName?: string;
        /** True if the connection was accepted into the resolved graph. */
        accepted: boolean;
    }
    /** Reason a connection produced a diagnostic. */
    export type FBXConnectionDiagnosticReason = "unsupported-connection-type" | "missing-connection-endpoint" | "unresolved-legacy-endpoint" | "unresolved-object-reference" | "duplicate-parent" | "self-loop";
    /** Recoverable connection graph issue. */
    export interface FBXConnectionDiagnostic {
        /** Diagnostic reason. */
        reason: FBXConnectionDiagnosticReason;
        /** Human-readable diagnostic message. */
        message: string;
        /** Connection-table index associated with the diagnostic, if applicable. */
        connectionIndex?: number;
        /** Connection type associated with the diagnostic, if applicable. */
        type?: string;
        /** Child object ID associated with the diagnostic, if applicable. */
        childId?: number;
        /** Parent object ID associated with the diagnostic, if applicable. */
        parentId?: number;
        /** OP connection property name associated with the diagnostic, if applicable. */
        propertyName?: string;
    }
    /** Resolved FBX object and connection graph. */
    export interface FBXObjectMap {
        /** All objects by their unique ID */
        objects: Map<number, FBXNode>;
        /** Object table entries, including synthetic compatibility objects */
        objectEntries: FBXObjectEntry[];
        /** Children of each object ID */
        childrenOf: Map<number, {
            id: number;
            propertyName?: string;
        }[]>;
        /** Parent of each object ID */
        parentOf: Map<number, {
            id: number;
            propertyName?: string;
        }>;
        /** Raw connection list */
        connections: FBXConnection[];
        /** Raw connection-table entries and whether they were accepted into the graph */
        connectionEntries: FBXConnectionEntry[];
        /** Unsupported or suspicious connection shapes encountered while preserving graph behavior */
        diagnostics: FBXConnectionDiagnostic[];
    }
    /**
     * Build a connection graph from a parsed FBX document.
     * Maps object IDs to their FBXNode and resolves parent-child relationships.
     */
    export function resolveConnections(doc: FBXDocument): FBXObjectMap;
    /** Get all child objects of a given parent ID, optionally filtered by node name */
    export function getChildren(map: FBXObjectMap, parentId: number, nodeName?: string): {
        id: number;
        node: FBXNode;
        propertyName?: string;
    }[];


    /** A single morph target (shape) within a blend shape channel */
    export interface FBXShapeData {
        /** Sparse vertex indices affected by this shape */
        indices: Uint32Array;
        /** Absolute vertex positions for affected vertices [x,y,z,...] */
        vertices: Float64Array;
        /** Normals for affected vertices [x,y,z,...] (optional) */
        normals: Float64Array | null;
    }
    export interface FBXBlendShapeDiagnostic {
        type: "full-weights-mismatch" | "missing-full-weights";
        message: string;
        channelId: number;
        channelName: string;
    }
    /** A blend shape channel (one animatable morph target) */
    export interface FBXBlendShapeChannelData {
        /** Channel name */
        name: string;
        /** Channel node ID */
        id: number;
        /** Default weight (0-100 in FBX) */
        deformPercent: number;
        /** Shape geometry (typically one per channel, but FBX supports in-between shapes) */
        shapes: FBXShapeData[];
        /** In-between full weights in FBX DeformPercent units (0-100), one per shape when present */
        fullWeights: number[] | null;
        /** Recoverable blend-shape diagnostics */
        diagnostics: FBXBlendShapeDiagnostic[];
    }
    /** A blend shape deformer attached to a geometry */
    export interface FBXBlendShapeData {
        /** Deformer ID */
        id: number;
        /** Geometry ID this blend shape is attached to */
        geometryId: number;
        /** Channels (each is an animatable morph target) */
        channels: FBXBlendShapeChannelData[];
    }
    /**
     * Extract all blend shape deformers from the FBX scene.
     */
    export function extractBlendShapes(objectMap: FBXObjectMap): FBXBlendShapeData[];


    export type FBXInterpolationType = "constant" | "linear" | "cubic";
    /** A single keyframe */
    export interface FBXKeyframe {
        /** Time in seconds */
        time: number;
        /** Value at this keyframe */
        value: number;
        /** Interpolation used from this key to the next key */
        interpolation: FBXInterpolationType;
        /** Constant interpolation variant */
        constantMode?: "standard" | "next";
        /** Cubic outgoing slope in value units per second */
        rightSlope?: number;
        /** Cubic incoming slope for the next key, in value units per second */
        nextLeftSlope?: number;
    }
    /** An animation curve (one axis of one property) */
    export interface FBXCurveData {
        /** Channel: "d|X", "d|Y", "d|Z" */
        channel: string;
        /** Keyframes */
        keys: FBXKeyframe[];
        /** True for baked sample curves that should be connected as linear samples */
        isSampled?: boolean;
    }
    /** An animation curve node (T/R/S for one bone) */
    export interface FBXCurveNodeData {
        /** Property type: "T" (translation), "R" (rotation), "S" (scale) */
        type: string;
        /** Target model (bone) ID */
        targetModelId: number;
        /** Curves for each axis */
        curves: FBXCurveData[];
    }
    /** Unsupported animation curve node preserved for diagnostics and future support. */
    export interface FBXUnsupportedCurveNodeData {
        /** Raw AnimationCurveNode property type/name */
        type: string;
        /** CurveNode object ID */
        id: number;
        /** Target object ID if the curve node is connected to an object/property */
        targetId: number | null;
        /** OP connection property name on the target, e.g. Visibility */
        propertyName?: string;
        /** Number of connected animation curves that were ignored */
        curveCount: number;
        /** Connected curves preserved for diagnostics and future runtime support */
        curves: FBXCurveData[];
        /** Local default values stored on the unsupported curve node */
        defaultValues: Record<string, number>;
    }
    /** Recoverable animation import issue. */
    export interface FBXAnimationDiagnostic {
        /** Diagnostic category. */
        type: "multiple-animation-layers" | "unsupported-layer-blend-mode" | "partial-layer-weight" | "unsupported-curve-node";
        /** Human-readable diagnostic message. */
        message: string;
        /** Animation layer name associated with the diagnostic, if applicable. */
        layerName?: string;
        /** AnimationCurveNode object ID associated with the diagnostic, if applicable. */
        curveNodeId?: number;
        /** AnimationCurveNode type/name associated with the diagnostic, if applicable. */
        curveNodeType?: string;
        /** Target object ID associated with the diagnostic, if applicable. */
        targetId?: number | null;
        /** Target property name associated with the diagnostic, if applicable. */
        propertyName?: string;
    }
    /** Animation layer with blend mode info */
    export interface FBXAnimationLayerData {
        /** Layer name */
        name: string;
        /** Layer weight (0-100, default 100) */
        weight: number;
        /** Layer weight normalized to 0-1 */
        normalizedWeight: number;
        /** Blend mode: 0=Additive, 1=Override, 2=OverridePassthrough */
        blendMode: number;
        /** Curve nodes in this layer */
        curveNodes: FBXCurveNodeData[];
        /** Unsupported/non-TRS curve nodes preserved for diagnostics */
        unsupportedCurveNodes: FBXUnsupportedCurveNodeData[];
        /** Recoverable layer diagnostics */
        diagnostics: FBXAnimationDiagnostic[];
    }
    /** One animation clip (AnimationStack) */
    export interface FBXAnimationStackData {
        /** Animation name */
        name: string;
        /** Clip start in seconds after any keyframe rebasing */
        startTime: number;
        /** Clip stop in seconds after any keyframe rebasing */
        stopTime: number;
        /** Duration in seconds */
        duration: number;
        /** Per-bone curve nodes (flattened from all layers for backward compat) */
        curveNodes: FBXCurveNodeData[];
        /** Animation layers (preserves blend mode info) */
        layers: FBXAnimationLayerData[];
        /** Unsupported/non-TRS curve nodes preserved for diagnostics */
        unsupportedCurveNodes: FBXUnsupportedCurveNodeData[];
        /** Recoverable animation diagnostics */
        diagnostics: FBXAnimationDiagnostic[];
    }
    /**
     * Extract all animation stacks from the FBX scene.
     */
    export function extractAnimations(objectMap: FBXObjectMap): FBXAnimationStackData[];
    /**
     * Determines whether a key sequence appears to be a uniformly frame-baked sampled curve.
     * @param keys - Keyframes to inspect
     * @returns true if the keys look like sampled frame data rather than authored interpolation
     */
    export function isFrameBakedSampledCurve(keys: readonly FBXKeyframe[]): boolean;
    /**
     * Samples an FBX animation curve at a specific time.
     * @param curveData - Curve data to sample
     * @param time - Time in seconds
     * @returns The sampled value, or null when the curve has no keys
     */
    export function sampleFBXCurveAtTime(curveData: FBXCurveData | undefined, time: number): number | null;


    /** Pure barrel — re-exports only side-effect-free modules */




    /**
     * Options for loading BVH files
     */
    export type BVHLoadingOptions = {
        /**
         * Defines the loop mode of the animation to load.
         */
        loopMode: number;
    };


    /**
     * Reads a BVH file, returns a skeleton
     * @param text - The BVH file content
     * @param scene - The scene to add the skeleton to
     * @param assetContainer - The asset container to add the skeleton to
     * @param loadingOptions - The loading options
     * @returns The skeleton
     */
    export function ReadBvh(text: string, scene: Scene, assetContainer: Nullable<AssetContainer>, loadingOptions: BVHLoadingOptions): Skeleton;


        interface SceneLoaderPluginOptions {
            /**
             * Defines options for the bvh loader.
             */
            [BVHFileLoaderMetadata.name]: Partial<BVHLoadingOptions>;
        }


    /**
     * @experimental
     * BVH file type loader.
     * This is a babylon scene loader plugin.
     */
    export class BVHFileLoader implements ISceneLoaderPluginAsync, ISceneLoaderPluginFactory {
        /**
         * Name of the loader ("bvh")
         */
        readonly name: "bvh";
        /** @internal */
        readonly extensions: {
            readonly ".bvh": {
                readonly isBinary: false;
            };
        };
        private readonly _loadingOptions;
        /**
         * Creates loader for bvh motion files
         * @param loadingOptions - Options for the bvh loader
         */
        constructor(loadingOptions?: Partial<Readonly<BVHLoadingOptions>>);
        private static get _DefaultLoadingOptions();
        /** @internal */
        createPlugin(options: SceneLoaderPluginOptions): ISceneLoaderPluginAsync;
        /**
         * If the data string can be loaded directly.
         * @param data - direct load data
         * @returns if the data can be loaded directly
         */
        canDirectLoad(data: string): boolean;
        /**
         * Returns whether the provided text starts with a BVH HIERARCHY header.
         * @param text - the text to inspect
         * @returns true if the text is a BVH header
         */
        isBvhHeader(text: string): boolean;
        /**
         * Returns whether the provided text does not start with a BVH HIERARCHY header.
         * @param text - the text to inspect
         * @returns true if the text is not a BVH header
         */
        isNotBvhHeader(text: string): boolean;
        /**
         * Imports  from the loaded gaussian splatting data and adds them to the scene
         * @param _meshesNames a string or array of strings of the mesh names that should be loaded from the file
         * @param scene the scene the meshes should be added to
         * @param data the bvh data to load
         * @returns a promise containing the loaded skeletons and animations
         */
        importMeshAsync(_meshesNames: string | readonly string[] | null | undefined, scene: Scene, data: unknown): Promise<ISceneLoaderAsyncResult>;
        /**
         * Imports all objects from the loaded bvh data and adds them to the scene
         * @param scene the scene the objects should be added to
         * @param data the bvh data to load
         * @returns a promise which completes when objects have been loaded to the scene
         */
        loadAsync(scene: Scene, data: unknown): Promise<void>;
        /**
         * Load into an asset container.
         * @param scene The scene to load into
         * @param data The data to import
         * @returns The loaded asset container
         */
        loadAssetContainerAsync(scene: Scene, data: unknown): Promise<AssetContainer>;
    }
    /**
     * Registers the BVHFileLoader scene loader plugin.
     * Safe to call multiple times; only the first call has an effect.
     */
    export function RegisterBVHFileLoader(): void;


    export var BVHFileLoaderMetadata: {
        readonly name: "bvh";
        readonly extensions: {
            readonly ".bvh": {
                readonly isBinary: false;
            };
        };
    };


    /**
     * Re-exports the pure implementation and applies the runtime registration side effect.
     * Import "./bvhFileLoader.pure" for tree-shakeable, side-effect-free usage.
     */



}


                