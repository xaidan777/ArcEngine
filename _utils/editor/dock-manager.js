// dock-manager.js — resizable splitters, collapsible panels, and workspace layouts for ArcEngine Studio.
// Allows resizing Hierarchy (left), Inspector (right), and Editor Panels (bottom) via draggable dividers.

/** @satisfies {Record<string, any>} */
const DockManager = {
    STORAGE_KEY: 'arc_editor_dock_layout',
    
    // Panel state
    state: {
        leftWidth: 268,
        rightWidth: 400,
        bottomHeight: 280,
        leftCollapsed: false,
        rightCollapsed: false,
        bottomCollapsed: false,
        consoleCollapsed: false,
        fullscreenViewport: false,
    },

    init() {
        if (typeof document === 'undefined') return;
        this.loadState();
        this.bindSplitters();
        this.bindHotkeys();
        const closeConsole = document.getElementById('btn-console-close');
        if (closeConsole) {
            closeConsole.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleConsole(true);
            });
        }
        this.applyState();
    },

    loadState() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.state = Object.assign(this.state, parsed);
            }
        } catch { /* ignore */ }
    },

    saveState() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
        } catch { /* ignore */ }
    },

    bindSplitters() {
        // Left splitter (between hierarchy and viewport)
        const splitLeft = document.getElementById('splitter-left');
        const hierarchyPane = document.getElementById('hierarchy-pane');
        if (splitLeft && hierarchyPane) {
            this.makeVerticalSplitter(splitLeft, (deltaX) => {
                let w = this.state.leftWidth + deltaX;
                w = Math.max(160, Math.min(600, w));
                this.state.leftWidth = w;
                this.state.leftCollapsed = false;
                this.applyState();
            }, () => this.toggleLeft());
        }

        // Right splitter (between viewport and inspector)
        const splitRight = document.getElementById('splitter-right');
        const inspectorPane = document.getElementById('inspector-pane');
        if (splitRight && inspectorPane) {
            this.makeVerticalSplitter(splitRight, (deltaX) => {
                let w = this.state.rightWidth - deltaX;
                w = Math.max(260, Math.min(700, w));
                this.state.rightWidth = w;
                this.state.rightCollapsed = false;
                this.applyState();
            }, () => this.toggleRight());
        }

        // Bottom splitter (between main and editor-panels/console)
        const splitBottom = document.getElementById('splitter-bottom');
        if (splitBottom) {
            this.makeHorizontalSplitter(splitBottom, (deltaY) => {
                let h = this.state.bottomHeight - deltaY;
                h = Math.max(120, Math.min(650, h));
                this.state.bottomHeight = h;
                this.state.bottomCollapsed = false;
                this.applyState();
            }, () => this.toggleBottom());
        }
    },

    makeVerticalSplitter(splitter, onDrag, onToggle) {
        let startX = 0;
        let dragging = false;

        const onPointerMove = (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            startX = e.clientX;
            onDrag(dx);
        };

        const onPointerUp = () => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove('resizing-col');
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            this.saveState();
            if (typeof World3D !== 'undefined' && World3D.resize) World3D.resize();
        };

        splitter.addEventListener('pointerdown', (e) => {
            // If clicked on collapse button, toggle
            if (e.target.closest('.splitter-collapse-btn')) {
                onToggle();
                return;
            }
            startX = e.clientX;
            dragging = true;
            document.body.classList.add('resizing-col');
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            e.preventDefault();
        });

        splitter.addEventListener('dblclick', () => onToggle());
    },

    makeHorizontalSplitter(splitter, onDrag, onToggle) {
        let startY = 0;
        let dragging = false;

        const onPointerMove = (e) => {
            if (!dragging) return;
            const dy = e.clientY - startY;
            startY = e.clientY;
            onDrag(dy);
        };

        const onPointerUp = () => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove('resizing-row');
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            this.saveState();
            if (typeof World3D !== 'undefined' && World3D.resize) World3D.resize();
        };

        splitter.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.splitter-collapse-btn')) {
                onToggle();
                return;
            }
            startY = e.clientY;
            dragging = true;
            document.body.classList.add('resizing-row');
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            e.preventDefault();
        });

        splitter.addEventListener('dblclick', () => onToggle());
    },

    toggleLeft() {
        this.state.leftCollapsed = !this.state.leftCollapsed;
        this.applyState();
        this.saveState();
    },

    toggleRight() {
        this.state.rightCollapsed = !this.state.rightCollapsed;
        this.applyState();
        this.saveState();
    },

    toggleBottom() {
        const next = !(this.state.bottomCollapsed && this.state.consoleCollapsed);
        this.state.bottomCollapsed = next;
        this.state.consoleCollapsed = next;
        this.applyState();
        this.saveState();
    },

    toggleConsole(force) {
        this.state.consoleCollapsed = force !== undefined ? !!force : !this.state.consoleCollapsed;
        this.applyState();
        this.saveState();
    },

    toggleFullscreenViewport() {
        this.state.fullscreenViewport = !this.state.fullscreenViewport;
        this.applyState();
    },

    applyState() {
        const hierarchyPane = document.getElementById('hierarchy-pane');
        const inspectorPane = document.getElementById('inspector-pane');
        const editorPanels = document.getElementById('editor-panels');
        const consolePane = document.getElementById('console-pane');
        const splitLeft = document.getElementById('splitter-left');
        const splitRight = document.getElementById('splitter-right');
        const splitBottom = document.getElementById('splitter-bottom');

        const isFull = this.state.fullscreenViewport;
        const winW = (typeof window !== 'undefined' && window.innerWidth) || 1200;
        const autoCollapseLeft = winW < 800 && !isFull && !this.state.rightCollapsed;

        // Left hierarchy
        if (hierarchyPane) {
            const collapsed = isFull || this.state.leftCollapsed || autoCollapseLeft;
            const w = Math.min(this.state.leftWidth, Math.max(160, Math.floor(winW * 0.25)));
            hierarchyPane.classList.toggle('dock-collapsed', collapsed);
            hierarchyPane.style.width = collapsed ? '0px' : `${w}px`;
            hierarchyPane.style.flex = collapsed ? '0 0 0px' : `0 0 ${w}px`;
        }
        if (splitLeft) {
            const btn = splitLeft.querySelector('.splitter-collapse-btn');
            if (btn) btn.textContent = (this.state.leftCollapsed || autoCollapseLeft) ? '▶' : '◀';
        }

        // Right inspector
        if (inspectorPane) {
            const collapsed = isFull || this.state.rightCollapsed;
            const w = Math.min(this.state.rightWidth, Math.max(240, Math.floor(winW * 0.4)));
            inspectorPane.classList.toggle('dock-collapsed', collapsed);
            inspectorPane.style.width = collapsed ? '0px' : `${w}px`;
            inspectorPane.style.flex = collapsed ? '0 0 0px' : `0 0 ${w}px`;
        }
        if (splitRight) {
            const btn = splitRight.querySelector('.splitter-collapse-btn');
            if (btn) btn.textContent = this.state.rightCollapsed ? '◀' : '▶';
        }

        // Bottom panels
        const bottomCollapsed = isFull || this.state.bottomCollapsed;
        if (editorPanels) {
            editorPanels.classList.toggle('dock-collapsed', bottomCollapsed);
            if (!bottomCollapsed) {
                editorPanels.style.height = `${this.state.bottomHeight}px`;
                editorPanels.style.flex = `0 0 ${this.state.bottomHeight}px`;
            } else {
                editorPanels.style.height = '0px';
                editorPanels.style.flex = '0 0 0px';
            }
        }
        const consoleCollapsed = isFull || this.state.consoleCollapsed;
        if (consolePane) {
            consolePane.classList.toggle('dock-collapsed', consoleCollapsed);
        }
        if (splitBottom) {
            const btn = splitBottom.querySelector('.splitter-collapse-btn');
            if (btn) btn.textContent = (this.state.bottomCollapsed && this.state.consoleCollapsed) ? '▲' : '▼';
            splitBottom.style.display = (bottomCollapsed && consoleCollapsed) ? 'none' : '';
        }

        if (typeof World3D !== 'undefined' && World3D.resize) {
            requestAnimationFrame(() => World3D.resize());
        }
    },

    bindHotkeys() {
        window.addEventListener('keydown', (e) => {
            // Shift + Space: toggle fullscreen viewport
            if (e.shiftKey && e.code === 'Space' && !/** @type {Element} */ (e.target).matches('input, textarea, select')) {
                e.preventDefault();
                this.toggleFullscreenViewport();
            }
            // Ctrl + B: toggle left hierarchy
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !/** @type {Element} */ (e.target).matches('input, textarea, select')) {
                e.preventDefault();
                this.toggleLeft();
            }
        });
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = DockManager;
if (typeof window !== 'undefined') window.DockManager = DockManager;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).DockManager = DockManager;
