// ============================================================================
//  ArcEngine — ArcPerformanceOverlay (Tactical FPS & Diagnostics HUD)
// ----------------------------------------------------------------------------
//  Real-time tactical performance and rendering diagnostics HUD for
//  Blackwater Protocol / ArcEngine.
//
//  Features:
//  - Live FPS with 30-frame rolling average and 1% low frame-time monitoring.
//  - GPU Hardware & Driver reporting: WebGPU (Vulkan / D3D12 / Metal) or WebGL2 (OpenGL).
//  - DLSS / DLAA upscaling profile and resolution scaling factor.
//  - Pseudo-RTX Pipeline status: RTAO (SSAO 2.0), SSR Reflections, Bloom.
//  - CPU Multi-threading telemetry: ArcJobSystem worker pool activity.
//  - Scene complexity telemetry: Draw calls, active meshes, rendered vertices.
//  - Hotkey toggle: F3 (universal gaming standard) and Backquote (tilde ~).
//  - Compact chip vs Full telemetry card toggle on click.
//  - Auto-activation when directPlay=1, fps=1, or debug=1 in query string.
// ============================================================================

(function () {
    'use strict';

    class ArcPerformanceOverlayCore {
        constructor() {
            /** @type {boolean} */
            this.initialized = false;
            /** @type {boolean} */
            this.visible = false;
            /** @type {boolean} */
            this.isExpanded = false;

            /** @type {HTMLElement|null} */
            this.container = null;
            /** @type {any} */
            this.bEngine = null;
            /** @type {any} */
            this.arcEngine = null;

            // Metrics state
            this.fps = 60;
            this.avgFps = 60;
            this.onePercentLow = 60;
            this.frameTimeMs = 16.6;
            this._recentFrameTimes = [];
            this._maxRecentFrames = 60;
            this._lastUpdate = 0;
            this._updateIntervalMs = 200; // UI refresh interval

            /** @type {((e: KeyboardEvent) => void)|null} */
            this._keyHandler = null;
        }

        /**
         * Initializes the tactical performance HUD.
         * @param {any} [bEngine] Babylon Engine
         * @param {any} [arcEngine] ArcEngine instance
         * @param {Object} [options]
         * @param {boolean} [options.autoShow=false] Force show immediately
         * @param {boolean} [options.expanded=false] Initial full mode
         * @returns {this}
         */
        init(bEngine = null, arcEngine = null, options = {}) {
            if (typeof window === 'undefined' || typeof document === 'undefined') {
                this.initialized = true;
                return this;
            }

            this.bEngine = bEngine || (typeof World3D !== 'undefined' ? World3D.engine : null);
            this.arcEngine = arcEngine || (typeof ArcEngine !== 'undefined' ? ArcEngine : null);

            // Determine if should auto-show from URL
            const search = window.location ? window.location.search : '';
            const shouldAutoShow = options.autoShow ||
                search.includes('fps=1') ||
                search.includes('debug=1') ||
                search.includes('directPlay=1') ||
                search.includes('perf=1');

            this.visible = shouldAutoShow;
            this.isExpanded = options.expanded || false;

            this._createDOM();
            this._bindKeyboard();

            this.initialized = true;
            return this;
        }

        /**
         * Builds the CSS and HTML nodes for the overlay.
         * @private
         */
        _createDOM() {
            if (document.getElementById('arc-perf-overlay')) {
                this.container = document.getElementById('arc-perf-overlay');
                this._applyVisibility();
                return;
            }

            // Inject styles
            if (!document.getElementById('arc-perf-overlay-styles')) {
                const style = document.createElement('style');
                style.id = 'arc-perf-overlay-styles';
                style.textContent = `
                    .arc-perf-hud {
                        position: fixed;
                        top: 14px;
                        right: 16px;
                        z-index: 9999;
                        font-family: 'JetBrains Mono', 'SF Mono', Consolas, Menlo, monospace;
                        font-size: 11px;
                        user-select: none;
                        -webkit-user-select: none;
                        cursor: pointer;
                        transition: all 0.18s ease-in-out;
                        pointer-events: auto;
                    }
                    .arc-perf-chip {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 6px 12px;
                        background: rgba(10, 15, 26, 0.85);
                        border: 1px solid rgba(56, 189, 248, 0.35);
                        border-radius: 6px;
                        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 10px rgba(56, 189, 248, 0.15);
                        backdrop-filter: blur(8px);
                        color: #e2e8f0;
                        letter-spacing: 0.04em;
                    }
                    .arc-perf-chip:hover {
                        border-color: rgba(56, 189, 248, 0.7);
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 14px rgba(56, 189, 248, 0.3);
                    }
                    .arc-perf-dot {
                        width: 7px;
                        height: 7px;
                        border-radius: 50%;
                        background: #22c55e;
                        box-shadow: 0 0 6px #22c55e;
                        flex-shrink: 0;
                    }
                    .arc-perf-fps {
                        font-weight: 700;
                        font-size: 13px;
                        color: #38bdf8;
                    }
                    .arc-perf-ms {
                        color: #94a3b8;
                        font-size: 11px;
                    }
                    .arc-perf-badge {
                        background: rgba(30, 41, 59, 0.8);
                        padding: 1px 6px;
                        border-radius: 3px;
                        border: 1px solid rgba(148, 163, 184, 0.2);
                        color: #38bdf8;
                        font-size: 10px;
                        text-transform: uppercase;
                    }
                    .arc-perf-card {
                        background: rgba(8, 12, 22, 0.92);
                        border: 1px solid rgba(56, 189, 248, 0.45);
                        border-radius: 8px;
                        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 18px rgba(56, 189, 248, 0.2);
                        backdrop-filter: blur(12px);
                        padding: 12px 14px;
                        width: 290px;
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        color: #cbd5e1;
                    }
                    .arc-perf-card-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 1px solid rgba(56, 189, 248, 0.25);
                        padding-bottom: 6px;
                    }
                    .arc-perf-card-title {
                        font-size: 11px;
                        font-weight: 700;
                        color: #38bdf8;
                        letter-spacing: 0.08em;
                    }
                    .arc-perf-btn-min {
                        background: transparent;
                        border: none;
                        color: #64748b;
                        font-size: 12px;
                        cursor: pointer;
                        padding: 0 4px;
                    }
                    .arc-perf-btn-min:hover {
                        color: #f8fafc;
                    }
                    .arc-perf-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-size: 11px;
                    }
                    .arc-perf-label {
                        color: #64748b;
                    }
                    .arc-perf-val {
                        font-weight: 600;
                        color: #e2e8f0;
                    }
                    .arc-perf-val.highlight {
                        color: #38bdf8;
                    }
                    .arc-perf-val.green {
                        color: #22c55e;
                    }
                    .arc-perf-val.amber {
                        color: #f59e0b;
                    }
                    .arc-perf-val.red {
                        color: #ef4444;
                    }
                    .arc-perf-section {
                        border-top: 1px solid rgba(148, 163, 184, 0.12);
                        padding-top: 6px;
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                    }
                    .arc-perf-section-title {
                        font-size: 9px;
                        font-weight: 700;
                        color: #94a3b8;
                        text-transform: uppercase;
                        letter-spacing: 0.06em;
                        margin-bottom: 2px;
                    }
                `;
                document.head.appendChild(style);
            }

            const wrap = document.createElement('div');
            wrap.id = 'arc-perf-overlay';
            wrap.className = 'arc-perf-hud';
            wrap.title = 'ArcEngine Diagnostics (Hotkey: F3 / ~). Click to expand/collapse.';
            wrap.onclick = (e) => {
                // Ignore if clicked on minimize button specifically
                if ((/** @type {HTMLElement} */ (e.target)).closest('.arc-perf-btn-min')) {
                    this.isExpanded = false;
                } else {
                    this.isExpanded = !this.isExpanded;
                }
                this._renderHTML();
            };

            this.container = wrap;
            document.body.appendChild(wrap);
            this._applyVisibility();
            this._renderHTML();
        }

        /**
         * Binds F3 and Backquote keys to toggle overlay visibility.
         * @private
         */
        _bindKeyboard() {
            if (this._keyHandler) return;
            this._keyHandler = (e) => {
                if (e.code === 'F3' || (e.code === 'Backquote' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
                    // Avoid triggering if inside a text input or textarea
                    const active = document.activeElement;
                    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                        return;
                    }
                    e.preventDefault();
                    this.toggle();
                }
            };
            window.addEventListener('keydown', this._keyHandler);
        }

        /**
         * Shows or hides DOM container based on current visibility state.
         * @private
         */
        _applyVisibility() {
            if (!this.container) return;
            this.container.style.display = this.visible ? 'block' : 'none';
        }

        /**
         * Toggles the HUD visibility.
         * @returns {boolean} New visibility state
         */
        toggle() {
            this.visible = !this.visible;
            this._applyVisibility();
            if (this.visible) {
                this.update(0.016, true);
            }
            return this.visible;
        }

        /**
         * Shows the HUD.
         */
        show() {
            this.visible = true;
            this._applyVisibility();
            this.update(0.016, true);
        }

        /**
         * Hides the HUD.
         */
        hide() {
            this.visible = false;
            this._applyVisibility();
        }

        /**
         * @returns {boolean}
         */
        isVisible() {
            return this.visible;
        }

        /**
         * Updates frame timing and refreshes telemetry display.
         * @param {number} dt Delta time in seconds
         * @param {boolean} [force=false] Force redraw
         */
        update(dt, force = false) {
            if (!this.initialized || typeof window === 'undefined') return;

            const now = performance.now();
            const frameMs = dt > 0 ? dt * 1000 : 16.6;
            this.frameTimeMs = Math.round(frameMs * 10) / 10;

            const instantFps = dt > 0 ? 1 / dt : 60;
            this._recentFrameTimes.push(instantFps);
            if (this._recentFrameTimes.length > this._maxRecentFrames) {
                this._recentFrameTimes.shift();
            }

            // Calculate rolling average and 1% low
            if (this._recentFrameTimes.length > 0) {
                const sum = this._recentFrameTimes.reduce((acc, v) => acc + v, 0);
                this.avgFps = Math.round(sum / this._recentFrameTimes.length);

                // 1% low (worst 1% of frames)
                const sorted = [...this._recentFrameTimes].sort((a, b) => a - b);
                const lowIndex = Math.max(0, Math.floor(sorted.length * 0.01));
                this.onePercentLow = Math.round(sorted[lowIndex] || instantFps);
            } else {
                this.avgFps = Math.round(instantFps);
                this.onePercentLow = this.avgFps;
            }
            this.fps = this.avgFps;

            if (!this.visible) return;

            if (!force && now - this._lastUpdate < this._updateIntervalMs) {
                return;
            }
            this._lastUpdate = now;
            this._renderHTML();
        }

        /**
         * Collects diagnostics data from engine and subsystems.
         * @returns {Object}
         */
        getTelemetry() {
            let gpuBackend = 'WebGL 2.0';
            let gpuDriver = 'OpenGL';
            let gpuVendor = 'Generic';

            if (typeof World3D !== 'undefined' && World3D.getGpuInfo) {
                const info = World3D.getGpuInfo();
                gpuBackend = info.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2.0';
                gpuDriver = (info.hardwareDriver || 'opengl').toUpperCase();
                gpuVendor = info.vendor || 'GPU';
            }

            let dlssMode = 'OFF';
            let renderScale = 1.0;
            let rtxStatus = 'OFF';
            let ssaoActive = false;
            let ssrActive = false;

            const pp = (typeof ArcPostProcess !== 'undefined' && ArcPostProcess._activeInstance)
                ? ArcPostProcess._activeInstance
                : (this.arcEngine && this.arcEngine.graphics ? this.arcEngine.graphics : null);

            if (pp) {
                if (typeof pp.getDlssMode === 'function') {
                    const m = pp.getDlssMode();
                    dlssMode = m.toUpperCase();
                    renderScale = pp.getRenderScale ? pp.getRenderScale() : 1.0;
                }
                if (typeof pp.getRtxStatus === 'function') {
                    const r = pp.getRtxStatus();
                    ssaoActive = !!r.ssao;
                    ssrActive = !!r.ssr;
                    rtxStatus = r.rtxMode ? r.rtxMode.toUpperCase() : (ssaoActive || ssrActive ? 'ON' : 'OFF');
                }
            }

            let threadsCount = 1;
            let jobSystemActive = false;
            if (typeof ArcJobSystem !== 'undefined') {
                const js = /** @type {any} */ (ArcJobSystem);
                threadsCount = js.concurrency || 1;
                jobSystemActive = !!js.initialized;
            }

            let drawCalls = 0;
            let activeMeshes = 0;
            let totalVertices = 0;

            const scene = (typeof World3D !== 'undefined' && World3D.view)
                ? World3D.view.scene
                : (this.arcEngine && this.arcEngine.scene ? this.arcEngine.scene : null);

            if (scene) {
                if (typeof scene.getActiveMeshes === 'function') {
                    activeMeshes = scene.getActiveMeshes().length;
                }
                if (typeof scene.getTotalVertices === 'function') {
                    totalVertices = scene.getTotalVertices();
                }
                const bEng = scene.getEngine ? scene.getEngine() : this.bEngine;
                if (bEng?._drawCalls?.current !== undefined) {
                    drawCalls = bEng._drawCalls.current;
                } else if (typeof bEng?.drawCalls === 'number') {
                    drawCalls = bEng.drawCalls;
                } else {
                    drawCalls = activeMeshes;
                }
            }

            return {
                fps: this.fps,
                frameTimeMs: this.frameTimeMs,
                onePercentLow: this.onePercentLow,
                gpuBackend,
                gpuDriver,
                gpuVendor,
                dlssMode,
                renderScale,
                rtxStatus,
                ssaoActive,
                ssrActive,
                threadsCount,
                jobSystemActive,
                drawCalls,
                activeMeshes,
                totalVertices
            };
        }

        /**
         * Renders the HTML markup into the container.
         * @private
         */
        _renderHTML() {
            if (!this.container) return;

            const d = this.getTelemetry();
            const fpsColor = d.fps >= 55 ? 'green' : (d.fps >= 30 ? 'amber' : 'red');
            const dotColor = d.fps >= 55 ? '#22c55e' : (d.fps >= 30 ? '#f59e0b' : '#ef4444');

            if (!this.isExpanded) {
                // Compact Chip View
                this.container.innerHTML = `
                    <div class="arc-perf-chip">
                        <span class="arc-perf-dot" style="background: ${dotColor}; box-shadow: 0 0 6px ${dotColor};"></span>
                        <span class="arc-perf-fps ${fpsColor}">${d.fps} <span style="font-size:10px;font-weight:normal;">FPS</span></span>
                        <span class="arc-perf-ms">${d.frameTimeMs}ms</span>
                        <span class="arc-perf-badge">${d.gpuBackend} · ${d.gpuDriver}</span>
                    </div>
                `;
            } else {
                // Full Expanded Telemetry Card View
                const vertStr = d.totalVertices > 1000
                    ? (d.totalVertices / 1000).toFixed(1) + 'k'
                    : String(d.totalVertices);

                this.container.innerHTML = `
                    <div class="arc-perf-card">
                        <div class="arc-perf-card-header">
                            <span class="arc-perf-card-title">ARC DIAGNOSTICS // FPS & GPU</span>
                            <button class="arc-perf-btn-min" title="Свернуть (Compact)">—</button>
                        </div>

                        <!-- 1. Frame Performance -->
                        <div class="arc-perf-section" style="border: none; padding-top: 0;">
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">Кадровая частота:</span>
                                <span class="arc-perf-val ${fpsColor}" style="font-size: 13px; font-weight: 700;">${d.fps} FPS</span>
                            </div>
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">Время кадра / 1% Low:</span>
                                <span class="arc-perf-val">${d.frameTimeMs} ms  ·  <span style="color:#94a3b8;">${d.onePercentLow} FPS</span></span>
                            </div>
                        </div>

                        <!-- 2. Hardware & API -->
                        <div class="arc-perf-section">
                            <div class="arc-perf-section-title">Графика и драйвер</div>
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">Бэкенд API:</span>
                                <span class="arc-perf-val highlight">${d.gpuBackend} (${d.gpuDriver})</span>
                            </div>
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">Вендор GPU:</span>
                                <span class="arc-perf-val">${d.gpuVendor}</span>
                            </div>
                        </div>

                        <!-- 3. DLSS / DLAA Upscaling -->
                        <div class="arc-perf-section">
                            <div class="arc-perf-section-title">Масштабирование & Сглаживание</div>
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">Режим DLSS / DLAA:</span>
                                <span class="arc-perf-val ${d.dlssMode !== 'OFF' ? 'green' : ''}">${d.dlssMode} (${Math.round(d.renderScale * 100)}% CAS)</span>
                            </div>
                        </div>

                        <!-- 4. Pseudo-RTX & Post-Process -->
                        <div class="arc-perf-section">
                            <div class="arc-perf-section-title">Псевдо-RTX Освещение</div>
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">SSAO 2.0 (RTAO):</span>
                                <span class="arc-perf-val ${d.ssaoActive ? 'green' : ''}">${d.ssaoActive ? 'ВКЛЮЧЕНО' : 'ВЫКЛ'}</span>
                            </div>
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">SSR (Отражения):</span>
                                <span class="arc-perf-val ${d.ssrActive ? 'green' : ''}">${d.ssrActive ? 'ВКЛЮЧЕНО' : 'ВЫКЛ'}</span>
                            </div>
                        </div>

                        <!-- 5. Multi-Threading & CPU Pipeline -->
                        <div class="arc-perf-section">
                            <div class="arc-perf-section-title">Процессор и Потоки</div>
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">ArcJobSystem:</span>
                                <span class="arc-perf-val ${d.jobSystemActive ? 'green' : ''}">${d.threadsCount} ядер CPU (воркеры)</span>
                            </div>
                        </div>

                        <!-- 6. Geometry & Draw Calls -->
                        <div class="arc-perf-section">
                            <div class="arc-perf-section-title">Сцена и Отрисовка</div>
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">Draw Calls / Меши:</span>
                                <span class="arc-perf-val">${d.drawCalls} / ${d.activeMeshes}</span>
                            </div>
                            <div class="arc-perf-row">
                                <span class="arc-perf-label">Вершины (Tris):</span>
                                <span class="arc-perf-val">${vertStr}</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        /**
         * Disposes overlay DOM and removes event listeners.
         */
        dispose() {
            if (this._keyHandler && typeof window !== 'undefined') {
                window.removeEventListener('keydown', this._keyHandler);
                this._keyHandler = null;
            }
            if (this.container && this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
            this.container = null;
            this.initialized = false;
        }
    }

    const ArcPerformanceOverlay = new ArcPerformanceOverlayCore();

    if (typeof window !== 'undefined') {
        /** @type {any} */ (window).ArcPerformanceOverlay = ArcPerformanceOverlay;
        /** @type {any} */ (window).ArcPerformanceOverlayCore = ArcPerformanceOverlayCore;
    }
    if (typeof globalThis !== 'undefined') {
        /** @type {any} */ (globalThis).ArcPerformanceOverlay = ArcPerformanceOverlay;
        /** @type {any} */ (globalThis).ArcPerformanceOverlayCore = ArcPerformanceOverlayCore;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ArcPerformanceOverlay, ArcPerformanceOverlayCore };
    }
})();
