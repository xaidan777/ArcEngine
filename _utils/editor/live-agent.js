// ============================================================================
//  ArcEngine Editor — Live AI Builder Stream Bridge (live-agent.js)
//  Connects to /api/live-stream via SSE and executes real-time building actions
//  directly in the editor's 3D viewport.
// ============================================================================

/** @satisfies {Record<string, any>} */
const LiveAgent = {
    source: null,
    badgeEl: null,
    countEl: null,
    propCount: 0,

    init() {
        this.createBadge();
        this.connect();
    },

    createBadge() {
        if (document.getElementById('arc-live-badge')) return;
        const badge = document.createElement('div');
        badge.id = 'arc-live-badge';
        badge.style.cssText = `
            position: fixed;
            top: 50px;
            right: 28px;
            z-index: 9999;
            background: rgba(18, 22, 28, 0.92);
            border: 1px solid rgba(0, 230, 153, 0.4);
            border-radius: 8px;
            padding: 8px 16px;
            color: #e5e9f0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(8px);
            pointer-events: auto;
            transition: all 0.3s ease;
        `;

        badge.innerHTML = `
            <span id="arc-live-indicator" style="width: 10px; height: 10px; border-radius: 50%; background: #00e699; box-shadow: 0 0 10px #00e699; display: inline-block;"></span>
            <div>
                <div style="font-weight: 600; color: #fff; font-size: 12px; letter-spacing: 0.5px;">AI LIVE BUILDER</div>
                <div id="arc-live-status" style="color: #94a3b8; font-size: 11px;">Подключение к трансляции...</div>
            </div>
            <div id="arc-live-counter" style="margin-left: 8px; font-weight: 700; color: #00e699; font-size: 13px;">0 об.</div>
        `;

        document.body.appendChild(badge);
        this.badgeEl = badge;
        this.countEl = document.getElementById('arc-live-counter');
    },

    setStatus(text, color = '#94a3b8') {
        const el = document.getElementById('arc-live-status');
        if (el) {
            el.textContent = text;
            el.style.color = color;
        }
    },

    updateCount(count) {
        if (count != null) this.propCount = count;
        else this.propCount = (Lab && Lab.location && Lab.location.objects) ? Lab.location.objects.length : (this.propCount + 1);
        if (this.countEl) {
            this.countEl.textContent = `${this.propCount} об.`;
        }
    },

    connect() {
        if (this.source) {
            try { this.source.close(); } catch (_) {}
        }

        this.source = new EventSource('/api/live-stream');

        this.source.onopen = () => {
            this.setStatus('Прямой эфир активен', '#00e699');
            const ind = document.getElementById('arc-live-indicator');
            if (ind) {
                ind.style.background = '#00e699';
                ind.style.boxShadow = '0 0 10px #00e699';
            }
        };

        this.source.onerror = () => {
            this.setStatus('Переподключение...', '#f59e0b');
            const ind = document.getElementById('arc-live-indicator');
            if (ind) {
                ind.style.background = '#f59e0b';
                ind.style.boxShadow = '0 0 6px #f59e0b';
            }
        };

        this.source.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                this.handleAction(data);
            } catch (err) {
                console.warn('[LiveAgent] Parse error:', err);
            }
        };
    },

    async handleAction(data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'STATUS': {
                this.setStatus(data.text, '#38bdf8');
                if (data.toast && typeof Toast !== 'undefined') {
                    Toast.show(data.text);
                }
                break;
            }

            case 'SWITCH_MAP': {
                if (typeof MapEditor !== 'undefined' && MapEditor.id !== data.mapId) {
                    this.setStatus(`Загрузка карты ${data.mapId}...`, '#38bdf8');
                    await MapEditor.load(data.mapId);
                }
                break;
            }

            case 'CLEAR_PROPS': {
                if (typeof Lab !== 'undefined' && Lab.location) {
                    const loc = Lab.location;
                    for (const rec of loc.objects.slice()) {
                        loc.removeObject(rec);
                    }
                    if (typeof RaidLayer !== 'undefined' && RaidLayer.levelData) {
                        RaidLayer.levelData.props = [];
                    }
                    if (typeof ObjectsPanel !== 'undefined') {
                        ObjectsPanel.render();
                    }
                    if (typeof MapEditor !== 'undefined') {
                        MapEditor.syncHierarchy?.();
                    }
                    this.updateCount(0);
                    this.setStatus('Карта очищена под новый лес', '#f59e0b');
                }
                break;
            }

            case 'SET_LIGHTING': {
                if (typeof Lab !== 'undefined' && Lab.location && typeof Lab.location.applyLightingSettings === 'function') {
                    const lState = Lab.location.applyLightingSettings(data.lighting);
                    if (typeof RaidLayer !== 'undefined' && RaidLayer.env && typeof RaidLayer.env.syncSky === 'function') {
                        RaidLayer.env.syncSky(lState?.sunAz, lState?.nightFactor, lState?.sunEnabled !== false);
                    }
                    if (typeof LightingPanel !== 'undefined') {
                        LightingPanel.importSettings(data.lighting);
                    }
                    if (typeof RaidLayer !== 'undefined' && RaidLayer.levelData) {
                        RaidLayer.levelData.lighting = data.lighting;
                    }
                }
                break;
            }

            case 'FOCUS_CAMERA': {
                if (typeof Lab !== 'undefined' && Lab.camera && data.x != null && data.y != null) {
                    Lab.camera.lookAt(data.x, data.y);
                }
                break;
            }

            case 'ADD_PROP': {
                if (typeof Lab !== 'undefined' && Lab.location) {
                    const rec = Lab.location.addObject(data.def);
                    if (typeof ObjectsPanel !== 'undefined') {
                        ObjectsPanel.watch(rec);
                    }
                    if (typeof RaidLayer !== 'undefined' && RaidLayer.levelData && RaidLayer.levelData.props) {
                        RaidLayer.levelData.props.push(data.def);
                    }
                    this.updateCount();
                }
                break;
            }

            case 'BATCH_ADD_PROPS': {
                if (typeof Lab !== 'undefined' && Lab.location && Array.isArray(data.defs)) {
                    for (const def of data.defs) {
                        const rec = Lab.location.addObject(def);
                        if (typeof ObjectsPanel !== 'undefined') {
                            ObjectsPanel.watch(rec);
                        }
                        if (typeof RaidLayer !== 'undefined' && RaidLayer.levelData && RaidLayer.levelData.props) {
                            RaidLayer.levelData.props.push(def);
                        }
                    }
                    this.updateCount();
                    if (typeof MapEditor !== 'undefined') {
                        MapEditor.syncHierarchy?.();
                    }
                }
                break;
            }

            case 'FINISH_BUILD': {
                this.setStatus('Сборка завершена!', '#00e699');
                const ind = document.getElementById('arc-live-indicator');
                if (ind) {
                    ind.style.background = '#00e699';
                    ind.style.boxShadow = '0 0 15px #00e699';
                }
                if (typeof Toast !== 'undefined') {
                    Toast.show('🌲 Левел-дизайн Forest Map успешно собран в прямом эфире!');
                }
                if (typeof MapEditor !== 'undefined') {
                    MapEditor.syncHierarchy?.();
                }
                break;
            }
        }
    }
};

// Auto-initialize when editor loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => LiveAgent.init());
} else {
    LiveAgent.init();
}
