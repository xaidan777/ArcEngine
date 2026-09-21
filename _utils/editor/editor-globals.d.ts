// These legacy panels export CommonJS for headless tests and run as browser globals.
declare const MaterialEditor: typeof import('./material-editor.js');
declare const WorkspaceManager: typeof import('./workspace-manager.js');
declare const DockManager: typeof import('./dock-manager.js');
declare const RigVisualizer: typeof import('./rig-visualizer.js');
declare const AssetBrowser: typeof import('./asset-browser.js');
declare const LightManager: typeof import('./light-manager.js');
declare const LightingPanel: typeof import('./lighting-panel.js');
declare const ColorPicker: typeof import('./color-picker.js');
interface Window {
    MaterialEditor: typeof MaterialEditor;
    WorkspaceManager: typeof WorkspaceManager;
    DockManager: typeof DockManager;
    RigVisualizer: typeof RigVisualizer;
    AssetBrowser: typeof AssetBrowser;
    LightManager: typeof LightManager;
    LightingPanel: typeof LightingPanel;
    ColorPicker: typeof ColorPicker;
    __arcSceneDoc: any;
}

