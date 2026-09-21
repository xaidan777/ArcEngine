// workspace-manager.js — multi-workspace tabs and mode switching for ArcEngine Studio.
// Separates the editor into 3 focused studios:
// 1. Level Editor (🗺️ Редактор карты и рейда)
// 2. Rig Studio (🦴 Редактор скелета и суставов)
// 3. Anim Studio (🎬 Студия анимации и таймлайн)

/** @satisfies {Record<string, any>} */
const WorkspaceManager = {
    current: 'level',

    init() {
        if (typeof document === 'undefined') return;
        this.bindTabs();
        this.setWorkspace('level');
    },

    bindTabs() {
        const tabs = document.querySelectorAll('.ws-tab[data-workspace]');
        for (const tab of tabs) {
            tab.addEventListener('click', () => {
                this.setWorkspace(/** @type {HTMLElement} */ (tab).dataset.workspace);
            });
        }
        const addBtn = document.getElementById('btn-add-tab');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showAssetBrowser());
        }
    },

    setWorkspace(mode) {
        if (!['level', 'rig', 'anim'].includes(mode)) return;
        this.current = mode;

        // Update top tab buttons
        const tabs = document.querySelectorAll('.ws-tab[data-workspace]');
        for (const tab of tabs) {
            tab.classList.toggle('active', /** @type {HTMLElement} */ (tab).dataset.workspace === mode);
        }

        // Apply workspace-specific layout and components
        if (mode === 'level') {
            this.setupLevelWorkspace();
        } else if (mode === 'rig') {
            this.setupRigWorkspace();
        } else if (mode === 'anim') {
            this.setupAnimWorkspace();
        }

        // Notify other systems
        window.dispatchEvent(new CustomEvent('workspace-changed', { detail: { mode } }));
        if (typeof World3D !== 'undefined' && World3D.resize) {
            requestAnimationFrame(() => World3D.resize());
        }
    },

    setupLevelWorkspace() {
        // Show raid layers in 3D
        if (typeof RaidLayer !== 'undefined') {
            RaidLayer.setVisible(true);
        }
        // Disable rig visualizer
        if (typeof RigVisualizer !== 'undefined') {
            RigVisualizer.setVisible(false);
        }
        // Switch inspector to objects or settings
        if (typeof Inspector !== 'undefined' && document.querySelector('#pane-tabs button[data-tab="objects"]')) {
            /** @type {HTMLElement} */ (document.querySelector('#pane-tabs button[data-tab="objects"]')).click();
        }
        // By default in level mode, collapse or minimize bottom dock so the map has maximum screen area
        if (typeof EditorPanels !== 'undefined') {
            EditorPanels.hide();
        }
        if (typeof DockManager !== 'undefined') {
            DockManager.state.bottomCollapsed = true;
            DockManager.applyState();
        }
    },

    setupRigWorkspace() {
        // Hide raid gameplay markers to avoid visual clutter
        if (typeof RaidLayer !== 'undefined') {
            RaidLayer.setVisible(false);
        }
        // Enable 3D skeleton visualizer
        if (typeof RigVisualizer !== 'undefined') {
            RigVisualizer.setVisible(true);
            RigVisualizer.syncWithActiveMesh();
        }
        // Open Rig panel in bottom dock
        if (typeof EditorPanels !== 'undefined') {
            EditorPanels.show('rig');
        }
        if (typeof DockManager !== 'undefined') {
            DockManager.state.bottomCollapsed = false;
            DockManager.applyState();
        }
        // Focus camera on inspected/selected model
        this.focusOnActiveModel();
    },

    setupAnimWorkspace() {
        // Hide raid gameplay markers
        if (typeof RaidLayer !== 'undefined') {
            RaidLayer.setVisible(false);
        }
        // Skeleton visualizer in faint pose mode
        if (typeof RigVisualizer !== 'undefined') {
            RigVisualizer.setVisible(true);
            RigVisualizer.setPoseMode(true);
        }
        // Open Animation timeline in bottom dock
        if (typeof EditorPanels !== 'undefined') {
            EditorPanels.show('anim');
        }
        if (typeof DockManager !== 'undefined') {
            DockManager.state.bottomCollapsed = false;
            DockManager.applyState();
        }
        // Focus camera on model
        this.focusOnActiveModel();
    },

    focusOnActiveModel() {
        if (typeof SceneView !== 'undefined' && SceneView.selection.length && typeof Lab !== 'undefined' && Lab.camera) {
            const mesh = SceneView.meshOf(SceneView.selection[0]);
            if (mesh) {
                SceneView.focusSelected();
            }
        }
    },

    showAssetBrowser() {
        if (typeof AssetBrowser !== 'undefined') {
            AssetBrowser.open();
        } else {
            alert('Asset Browser: models, rigs, clips');
        }
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = WorkspaceManager;
if (typeof window !== 'undefined') window.WorkspaceManager = WorkspaceManager;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).WorkspaceManager = WorkspaceManager;
