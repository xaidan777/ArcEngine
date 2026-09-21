// asset-browser.js — the unified Asset Browser modal for ArcEngine Studio.
// Lists models, rigs, animation clips, and levels.
// Allows placing assets into the level or opening them in Rig/Anim Studio.

/** @satisfies {Record<string, any>} */
const AssetBrowser = {
    modalEl: null,
    assets: { models: [], rigs: [], clips: [], levels: [] },

    init() {
        if (typeof document === 'undefined') return;
        this.createModalDOM();
    },

    createModalDOM() {
        if (document.getElementById('asset-browser-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'asset-browser-modal';
        modal.className = 'asset-modal';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="asset-modal-content">
                <div class="asset-modal-header">
                    <span class="asset-modal-title">📦 Asset Browser / Библиотека ассетов</span>
                    <button class="asset-modal-close" id="asset-modal-close">✕</button>
                </div>
                <div class="asset-modal-tabs">
                    <button class="asset-tab active" data-type="models">3D Models</button>
                    <button class="asset-tab" data-type="rigs">Skeletons / Rigs</button>
                    <button class="asset-tab" data-type="clips">Animation Clips</button>
                </div>
                <div class="asset-modal-list" id="asset-modal-list">
                    <div class="asset-loading">Loading assets…</div>
                </div>
                <div class="asset-modal-footer">
                    <button class="panel-button" id="btn-asset-import-file">Upload Model…</button>
                    <div class="toolbar-spacer"></div>
                    <button class="panel-button" id="btn-asset-cancel">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.modalEl = modal;

        modal.querySelector('#asset-modal-close').addEventListener('click', () => this.close());
        modal.querySelector('#btn-asset-cancel').addEventListener('click', () => this.close());

        const tabs = modal.querySelectorAll('.asset-tab');
        for (const t of tabs) {
            t.addEventListener('click', () => {
                for (const other of tabs) other.classList.toggle('active', other === t);
                this.renderList(/** @type {HTMLElement} */ (t).dataset.type);
            });
        }

        const importBtn = modal.querySelector('#btn-asset-import-file');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const btn = document.getElementById('btn-import');
                if (btn) btn.click();
                this.close();
            });
        }
    },

    async open() {
        if (!this.modalEl) this.createModalDOM();
        this.modalEl.hidden = false;
        await this.fetchAssets();
        this.renderList('models');
    },

    close() {
        if (this.modalEl) this.modalEl.hidden = true;
    },

    async fetchAssets() {
        try {
            const res = await fetch('/api/list-assets');
            const data = await res.json();
            if (data.ok) {
                this.assets = data;
            }
        } catch (e) {
            console.error('Failed to fetch assets:', e);
        }
    },

    renderList(type) {
        const list = document.getElementById('asset-modal-list');
        if (!list) return;
        list.innerHTML = '';

        const items = this.assets[type] || [];
        if (!items.length) {
            list.innerHTML = `<div class="asset-empty">No ${type} found in assets/${type}/</div>`;
            return;
        }

        for (const item of items) {
            const card = document.createElement('div');
            card.className = 'asset-card';
            card.innerHTML = `
                <div class="asset-icon">${type === 'models' ? '🧊' : (type === 'rigs' ? '🦴' : '🎬')}</div>
                <div class="asset-info">
                    <div class="asset-name">${item.name}</div>
                    <div class="asset-path">${item.path}</div>
                </div>
                <div class="asset-actions">
                    <button class="panel-button" data-action="use">${type === 'models' ? 'Add to Level' : 'Open'}</button>
                </div>
            `;
            card.querySelector('[data-action="use"]').addEventListener('click', () => {
                this.handleAssetAction(type, item);
                this.close();
            });
            list.appendChild(card);
        }
    },

    handleAssetAction(type, item) {
        if (type === 'models') {
            // Place into level
            if (typeof ObjectsPanel !== 'undefined' && typeof Lab !== 'undefined') {
                const cam = Lab.camera;
                const pos = cam ? cam.target : { x: 1000, y: 1000 };
                const obj = {
                    name: item.name,
                    model: item.path,
                    kind: 'actor',
                    x: pos.x || 1000,
                    y: pos.y || 1000,
                    h: 0,
                    rot: [0, 0, 0],
                    scale: [0.25, 0.25, 0.25],
                    clip: 'idle'
                };
                if (Lab.location) {
                    ObjectsPanel.addObject(obj);
                    if (typeof Toast !== 'undefined') Toast.show(`Model ${item.name} added to Level!`, false);
                }
            }
        } else if (type === 'rigs') {
            // Open in Rig Studio
            if (typeof WorkspaceManager !== 'undefined') {
                WorkspaceManager.setWorkspace('rig');
            }
        } else if (type === 'clips') {
            // Open in Anim Studio
            if (typeof WorkspaceManager !== 'undefined') {
                WorkspaceManager.setWorkspace('anim');
            }
        }
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = AssetBrowser;
if (typeof window !== 'undefined') window.AssetBrowser = AssetBrowser;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).AssetBrowser = AssetBrowser;
