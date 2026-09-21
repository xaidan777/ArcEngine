// lighting-panel.js — Complete Lighting & Day-Night Studio for ArcEngine Editor.
// Controls: Day-Night cycle, sun azimuth/elevation, ambient lighting,
// PointLights and SpotLights creation and configuration.

/** @satisfies {Record<string, any>} */
const LightingPanel = {
    /** @type {DayNightCycle | null} */
    dnc: null,
    isPlaying: false,
    speedMultiplier: 15.0,
    cycleEnabledInGame: false,

    // Manual overrides
    sunEnabled: true,
    manualControl: false, // true if user manually tweaked sun/ambient rather than following DNC
    sunAzimuth: 53,
    sunElevation: 48,
    sunIntensity: 1.0,
    sunColor: '#fff7e6',
    ambientIntensity: 0.6,
    skyColor: '#8bb5d9',
    groundColor: '#3d362d',

    init() {
        if (typeof DayNightCycle !== 'undefined') {
            this.dnc = new DayNightCycle({
                dayDurationSec: 720,
                initialTime: 12.0
            });
        }
        this.render();
    },

    render() {
        const host = document.getElementById('lighting-panel') || document.getElementById('pane-content-lighting') || document.querySelector('[data-tab="lighting"].pane-panel');
        if (!host) return;

        const timeStr = this.dnc ? this.dnc.getTimeFormatted() : '12:00';
        const curTime = this.dnc ? this.dnc.getTime() : 12.0;
        const period = this.dnc ? this.dnc.getPeriod() : 'midday';
        const periodNames = { dawn: 'Рассвет 🌅', midday: 'День ☀️', dusk: 'Закат 🌇', night: 'Ночь 🌙' };

        host.innerHTML = `
        <div style="padding: 10px; display: flex; flex-direction: column; gap: 14px; color: #e0e8f0; font-size: 13px;">
            <fieldset style="display: grid; gap: 8px; border: 1px solid #3a4756; border-radius: 6px;">
                <legend>Предпросмотр графики</legend>
                <label>SSAO / SSR <select id="lighting-rtx" style="background: #252e38; color: #e0e8f0; border: 1px solid #435161; border-radius: 4px; padding: 4px;">
                    <option value="off">Выкл</option><option value="medium">Среднее</option><option value="ultra">Ультра</option>
                </select></label>
                <label>Разрешение и сглаживание <select id="lighting-scale" style="background: #252e38; color: #e0e8f0; border: 1px solid #435161; border-radius: 4px; padding: 4px;">
                    <option value="off">Нативное</option><option value="dlaa">1.0× + FXAA</option>
                    <option value="quality">0.75×</option><option value="balanced">0.66×</option><option value="performance">0.50×</option>
                </select></label>
                <small>Настройки предпросмотра; не меняют данные карты.</small>
            </fieldset>
            <!-- 1. Day-Night Cycle -->
            <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; border: 1px solid #3a4756;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="color: #7ec7ff; font-size: 14px;">Суточный цикл (24ч)</strong>
                    <span id="dnc-time-badge" style="background: #1e2630; border: 1px solid #4a5c70; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-family: monospace;">
                        ${timeStr} (${periodNames[period] || period})
                    </span>
                </div>

                <div style="margin-bottom: 8px;">
                    <input id="dnc-time-slider" type="range" min="0" max="24" step="0.1" value="${curTime}" style="width: 100%; cursor: pointer;">
                </div>

                <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 8px;">
                    <button id="dnc-play-btn" style="flex: 1; padding: 5px 8px; background: ${this.isPlaying ? '#7a3e20' : '#2b4432'}; border: 1px solid #4d7a5b; border-radius: 4px; color: #fff; cursor: pointer;">
                        ${this.isPlaying ? '⏸ Пауза' : '▶ Воспроизведение'}
                    </button>
                    <select id="dnc-speed-select" style="padding: 4px 6px; background: #252e38; color: #eee; border: 1px solid #435161; border-radius: 4px;">
                        <option value="1" ${this.speedMultiplier === 1 ? 'selected' : ''}>1x (12 мин)</option>
                        <option value="5" ${this.speedMultiplier === 5 ? 'selected' : ''}>5x (2.4 мин)</option>
                        <option value="15" ${this.speedMultiplier === 15 ? 'selected' : ''}>15x (48 сек)</option>
                        <option value="60" ${this.speedMultiplier === 60 ? 'selected' : ''}>60x (12 сек)</option>
                    </select>
                </div>

                <!-- Presets -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px;">
                    <button class="dnc-preset-btn" data-time="6" style="padding: 4px; background: #252e38; border: 1px solid #435161; border-radius: 4px; color: #eee; cursor: pointer; font-size: 11px;">🌅 Рассвет (06:00)</button>
                    <button class="dnc-preset-btn" data-time="12" style="padding: 4px; background: #252e38; border: 1px solid #435161; border-radius: 4px; color: #eee; cursor: pointer; font-size: 11px;">☀️ Полдень (12:00)</button>
                    <button class="dnc-preset-btn" data-time="18.5" style="padding: 4px; background: #252e38; border: 1px solid #435161; border-radius: 4px; color: #eee; cursor: pointer; font-size: 11px;">🌇 Закат (18:30)</button>
                    <button class="dnc-preset-btn" data-time="0" style="padding: 4px; background: #252e38; border: 1px solid #435161; border-radius: 4px; color: #eee; cursor: pointer; font-size: 11px;">🌙 Полночь (00:00)</button>
                </div>
                <button id="dnc-dark-btn" style="width: 100%; padding: 4px; background: #181c22; border: 1px solid #333d49; border-radius: 4px; color: #aaa; cursor: pointer; font-size: 11px;">
                    🌑 Полная тьма (Без солнца и неба)
                </button>

                <label style="display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: #a0b3c6; cursor: pointer;">
                    <input type="checkbox" id="dnc-game-cycle" ${this.cycleEnabledInGame ? 'checked' : ''}>
                    Включить цикл день-ночь в игре
                </label>
            </div>

            <!-- 2. Sun & Sky Controls -->
            <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; border: 1px solid #3a4756;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="color: #ffd07e; font-size: 14px;">Солнце и Небо</strong>
                    <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
                        <input type="checkbox" id="sun-enabled-cb" ${this.sunEnabled ? 'checked' : ''}>
                        Солнце вкл
                    </label>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Азимут: <strong id="sun-az-val">${Math.round(this.sunAzimuth)}°</strong></span>
                        <input id="sun-az-slider" type="range" min="0" max="360" value="${this.sunAzimuth}" style="width: 140px;">
                    </label>

                    <label style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Высота: <strong id="sun-el-val">${Math.round(this.sunElevation)}°</strong></span>
                        <input id="sun-el-slider" type="range" min="-30" max="90" value="${this.sunElevation}" style="width: 140px;">
                    </label>

                    <label style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Сила солнца: <strong id="sun-int-val">${Number(this.sunIntensity).toFixed(2)}</strong></span>
                        <input id="sun-int-slider" type="range" min="0" max="3" step="0.05" value="${this.sunIntensity}" style="width: 140px;">
                    </label>

                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Цвет солнца:</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button id="sun-color-btn" type="button" style="width: 44px; height: 24px; border: 1px solid #4a5c70; border-radius: 4px; background: ${this.sunColor}; cursor: pointer; padding: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);"></button>
                            <input id="sun-color-hex" type="text" value="${this.sunColor}" style="width: 68px; font-size: 11px; font-family: monospace; background: #202730; color: #eee; border: 1px solid #334; border-radius: 3px; text-transform: uppercase; text-align: center;">
                        </div>
                    </div>

                    <label style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Эмбиент (Небо): <strong id="amb-int-val">${Number(this.ambientIntensity).toFixed(2)}</strong></span>
                        <input id="amb-int-slider" type="range" min="0" max="2" step="0.05" value="${this.ambientIntensity}" style="width: 140px;">
                    </label>

                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Цвет неба:</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button id="sky-color-btn" type="button" style="width: 44px; height: 24px; border: 1px solid #4a5c70; border-radius: 4px; background: ${this.skyColor}; cursor: pointer; padding: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);"></button>
                            <input id="sky-color-hex" type="text" value="${this.skyColor}" style="width: 68px; font-size: 11px; font-family: monospace; background: #202730; color: #eee; border: 1px solid #334; border-radius: 3px; text-transform: uppercase; text-align: center;">
                        </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Подсветка снизу (земля):</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button id="ground-color-btn" type="button" style="width: 44px; height: 24px; border: 1px solid #4a5c70; border-radius: 4px; background: ${this.groundColor}; cursor: pointer; padding: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);"></button>
                            <input id="ground-color-hex" type="text" value="${this.groundColor}" style="width: 68px; font-size: 11px; font-family: monospace; background: #202730; color: #eee; border: 1px solid #334; border-radius: 3px; text-transform: uppercase; text-align: center;">
                        </div>
                    </div>

                    <button id="btn-save-constants" type="button" style="width: 100%; margin-top: 6px; padding: 6px 8px; background: #253342; border: 1px solid #4a637d; border-radius: 4px; color: #7ec7ff; font-size: 11px; cursor: pointer;">
                        💾 Сохранить как дефолт движка (Constants.js)
                    </button>
                </div>
            </div>

            <!-- 3. Point & Spot Lights -->
            <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; border: 1px solid #3a4756;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="color: #7effa8; font-size: 14px;">Источники света</strong>
                    <span style="font-size: 11px; color: #888;">Всего: ${LightManager.lights.size}</span>
                </div>

                <div style="display: flex; gap: 6px; margin-bottom: 10px;">
                    <button id="btn-add-point-light" style="flex: 1; padding: 6px 4px; background: #252e38; border: 1px solid #435161; border-radius: 4px; color: #fff; cursor: pointer; font-size: 12px;">
                        + 💡 Точечный
                    </button>
                    <button id="btn-add-spot-light" style="flex: 1; padding: 6px 4px; background: #252e38; border: 1px solid #435161; border-radius: 4px; color: #fff; cursor: pointer; font-size: 12px;">
                        + 🔦 Прожектор
                    </button>
                </div>

                <!-- Lights List -->
                <div id="lights-list" style="max-height: 140px; overflow-y: auto; border: 1px solid #2a3440; border-radius: 4px; margin-bottom: 10px; background: #161b22;">
                    ${this._renderLightsListHtml()}
                </div>

                <!-- Selected Light Properties -->
                <div id="light-properties" style="display: flex; flex-direction: column; gap: 6px; border-top: 1px solid #334050; padding-top: 8px;">
                    ${this._renderSelectedLightPropsHtml()}
                </div>
            </div>
        </div>
        `;

        this.bindEvents();
    },

    _renderLightsListHtml() {
        if (!LightManager.lights.size) {
            return '<div style="padding: 8px; color: #6e7c8c; text-align: center; font-size: 11px;">Нет добавленных источников света</div>';
        }
        let html = '';
        for (const [id, rec] of LightManager.lights) {
            const isSel = LightManager.selectedId === id;
            const icon = rec.def.type === 'spot' ? '🔦' : '💡';
            html += `
            <div class="light-list-item" data-id="${id}" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; cursor: pointer; background: ${isSel ? '#283c50' : 'transparent'}; border-bottom: 1px solid #202731;">
                <span style="font-size: 12px; display: flex; align-items: center; gap: 6px;">
                    <span>${icon}</span>
                    <strong style="color: ${isSel ? '#7ec7ff' : '#ddd'};">${rec.def.name}</strong>
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${rec.def.color};"></span>
                </span>
                <button class="light-del-btn" data-id="${id}" title="Удалить" style="background: none; border: none; color: #ff6b6b; cursor: pointer; font-size: 13px;">✕</button>
            </div>`;
        }
        return html;
    },

    _renderSelectedLightPropsHtml() {
        const id = LightManager.selectedId;
        if (!id || !LightManager.lights.has(id)) {
            return '<div style="color: #6e7c8c; font-size: 11px; text-align: center;">Выберите источник света для настройки</div>';
        }
        const rec = LightManager.lights.get(id);
        const d = rec.def;
        const isSpot = d.type === 'spot';

        return `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <input id="light-prop-name" type="text" value="${d.name}" style="background: #202730; color: #fff; border: 1px solid #405060; border-radius: 3px; padding: 2px 6px; font-size: 12px; width: 140px;">
            <span style="font-size: 11px; color: #8cb8e0;">${isSpot ? 'Прожектор (Spot)' : 'Точечный (Point)'}</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-bottom: 6px;">
            <label style="font-size: 11px;">X: <input id="light-prop-x" type="number" value="${d.x}" style="width: 100%; background: #202730; color: #eee; border: 1px solid #334; border-radius: 3px;"></label>
            <label style="font-size: 11px;">Y (Высота): <input id="light-prop-h" type="number" value="${d.h}" style="width: 100%; background: #202730; color: #eee; border: 1px solid #334; border-radius: 3px;"></label>
            <label style="font-size: 11px;">Z: <input id="light-prop-y" type="number" value="${d.y}" style="width: 100%; background: #202730; color: #eee; border: 1px solid #334; border-radius: 3px;"></label>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px;">Цвет:</span>
            <div style="display: flex; align-items: center; gap: 6px;">
                <button id="light-prop-color-btn" type="button" style="width: 36px; height: 22px; border: 1px solid #4a5c70; border-radius: 4px; background: ${d.color}; cursor: pointer; padding: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);"></button>
                <input id="light-prop-color-hex" type="text" value="${d.color}" style="width: 65px; font-size: 11px; font-family: monospace; background: #202730; color: #eee; border: 1px solid #334; border-radius: 3px; text-transform: uppercase; text-align: center;">
            </div>
        </div>

        <label style="display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
            <span>Яркость: <strong id="light-int-val">${Number(d.intensity).toFixed(1)}</strong></span>
            <input id="light-prop-intensity" type="range" min="0.1" max="10" step="0.1" value="${d.intensity}" style="width: 120px;">
        </label>

        <label style="display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
            <span>Радиус (px): <strong id="light-range-val">${d.range}</strong></span>
            <input id="light-prop-range" type="range" min="50" max="2000" step="25" value="${d.range}" style="width: 120px;">
        </label>

        ${isSpot ? `
        <label style="display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
            <span>Угол конуса: <strong id="light-angle-val">${d.angle || 60}°</strong></span>
            <input id="light-prop-angle" type="range" min="15" max="150" step="5" value="${d.angle || 60}" style="width: 120px;">
        </label>

        <label style="display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
            <span>Спад (Exponent): <strong id="light-exp-val">${d.exponent || 2}</strong></span>
            <input id="light-prop-exp" type="range" min="1" max="10" step="0.5" value="${d.exponent || 2}" style="width: 120px;">
        </label>
        ` : ''}
        `;
    },

    bindEvents() {
        const graphics = Lab.graphics;
        const rtx = /** @type {HTMLSelectElement} */ (document.getElementById('lighting-rtx'));
        const scale = /** @type {HTMLSelectElement} */ (document.getElementById('lighting-scale'));
        if (graphics && rtx && scale) {
            rtx.value = graphics.getRtxMode();
            scale.value = graphics.getDlssMode();
            rtx.onchange = () => graphics.setRtxMode(rtx.value);
            scale.onchange = () => graphics.setDlssMode(scale.value);
        }
        // Time slider
        const slider = /** @type {HTMLInputElement} */ (document.getElementById('dnc-time-slider'));
        if (slider) {
            slider.oninput = () => {
                const t = Number(slider.value);
                this.manualControl = false;
                if (this.dnc) {
                    this.dnc.setTime(t);
                    this.syncFromDnc();
                }
            };
        }

        // Play/Pause
        const playBtn = document.getElementById('dnc-play-btn');
        if (playBtn) {
            playBtn.onclick = () => {
                this.isPlaying = !this.isPlaying;
                this.render();
            };
        }

        // Speed select
        const speedSel = /** @type {HTMLSelectElement} */ (document.getElementById('dnc-speed-select'));
        if (speedSel) {
            speedSel.onchange = () => {
                this.speedMultiplier = Number(speedSel.value);
            };
        }

        // Presets
        for (const btn of document.querySelectorAll('.dnc-preset-btn')) {
            btn.addEventListener('click', () => {
                const targetTime = Number(/** @type {HTMLElement} */ (btn).dataset.time);
                this.sunEnabled = true;
                this.manualControl = false;
                if (this.dnc) {
                    this.dnc.setTime(targetTime);
                    this.syncFromDnc();
                }
                this.render();
            });
        }

        // Full Dark Preset
        const darkBtn = document.getElementById('dnc-dark-btn');
        if (darkBtn) {
            darkBtn.onclick = () => {
                this.sunEnabled = false;
                this.sunIntensity = 0;
                this.ambientIntensity = 0;
                this.skyColor = '#01040A';
                this.groundColor = '#000000';
                this.sunColor = '#000000';
                this.manualControl = true;
                this.applySceneLighting();
                this.render();
            };
        }

        // Game cycle checkbox
        const gameCycleCb = /** @type {HTMLInputElement} */ (document.getElementById('dnc-game-cycle'));
        if (gameCycleCb) {
            gameCycleCb.onchange = () => {
                this.cycleEnabledInGame = gameCycleCb.checked;
            };
        }

        // Sun enabled toggle
        const sunCb = /** @type {HTMLInputElement} */ (document.getElementById('sun-enabled-cb'));
        if (sunCb) {
            sunCb.onchange = () => {
                this.sunEnabled = sunCb.checked;
                this.manualControl = true;
                this.applySceneLighting();
            };
        }

        // Sun Azimuth & Elevation
        const azSlider = /** @type {HTMLInputElement} */ (document.getElementById('sun-az-slider'));
        if (azSlider) {
            azSlider.oninput = () => {
                this.sunAzimuth = Number(azSlider.value);
                this.manualControl = true;
                document.getElementById('sun-az-val').textContent = Math.round(this.sunAzimuth) + '°';
                this.applySceneLighting();
            };
        }
        const elSlider = /** @type {HTMLInputElement} */ (document.getElementById('sun-el-slider'));
        if (elSlider) {
            elSlider.oninput = () => {
                this.sunElevation = Number(elSlider.value);
                this.manualControl = true;
                document.getElementById('sun-el-val').textContent = Math.round(this.sunElevation) + '°';
                this.applySceneLighting();
            };
        }
        const sunIntSlider = /** @type {HTMLInputElement} */ (document.getElementById('sun-int-slider'));
        if (sunIntSlider) {
            sunIntSlider.oninput = () => {
                this.sunIntensity = Number(sunIntSlider.value);
                this.manualControl = true;
                document.getElementById('sun-int-val').textContent = Number(this.sunIntensity).toFixed(2);
                this.applySceneLighting();
            };
        }
        const sunBtn = document.getElementById('sun-color-btn');
        const sunHex = /** @type {HTMLInputElement} */ (document.getElementById('sun-color-hex'));
        if (sunBtn) {
            sunBtn.onclick = () => {
                if (typeof ColorPicker !== 'undefined') {
                    ColorPicker.open(sunBtn, this.sunColor, (hex) => {
                        this.sunColor = hex;
                        if (sunHex) sunHex.value = hex;
                        this.manualControl = true;
                        this.applySceneLighting();
                    });
                }
            };
        }
        if (sunHex) {
            sunHex.onchange = () => {
                let val = sunHex.value.trim();
                if (!val.startsWith('#')) val = '#' + val;
                if (/^#[0-9a-f]{6}$/i.test(val)) {
                    this.sunColor = val.toUpperCase();
                    sunHex.value = this.sunColor;
                    if (sunBtn) sunBtn.style.background = this.sunColor;
                    this.manualControl = true;
                    this.applySceneLighting();
                }
            };
        }

        const ambIntSlider = /** @type {HTMLInputElement} */ (document.getElementById('amb-int-slider'));
        if (ambIntSlider) {
            ambIntSlider.oninput = () => {
                this.ambientIntensity = Number(ambIntSlider.value);
                this.manualControl = true;
                document.getElementById('amb-int-val').textContent = Number(this.ambientIntensity).toFixed(2);
                this.applySceneLighting();
            };
        }

        const skyBtn = document.getElementById('sky-color-btn');
        const skyHex = /** @type {HTMLInputElement} */ (document.getElementById('sky-color-hex'));
        if (skyBtn) {
            skyBtn.onclick = () => {
                if (typeof ColorPicker !== 'undefined') {
                    ColorPicker.open(skyBtn, this.skyColor, (hex) => {
                        this.skyColor = hex;
                        if (skyHex) skyHex.value = hex;
                        this.manualControl = true;
                        this.applySceneLighting();
                    });
                }
            };
        }
        if (skyHex) {
            skyHex.onchange = () => {
                let val = skyHex.value.trim();
                if (!val.startsWith('#')) val = '#' + val;
                if (/^#[0-9a-f]{6}$/i.test(val)) {
                    this.skyColor = val.toUpperCase();
                    skyHex.value = this.skyColor;
                    if (skyBtn) skyBtn.style.background = this.skyColor;
                    this.manualControl = true;
                    this.applySceneLighting();
                }
            };
        }

        const groundBtn = document.getElementById('ground-color-btn');
        const groundHex = /** @type {HTMLInputElement} */ (document.getElementById('ground-color-hex'));
        if (groundBtn) {
            groundBtn.onclick = () => {
                if (typeof ColorPicker !== 'undefined') {
                    ColorPicker.open(groundBtn, this.groundColor, (hex) => {
                        this.groundColor = hex;
                        if (groundHex) groundHex.value = hex;
                        this.manualControl = true;
                        this.applySceneLighting();
                    });
                }
            };
        }
        if (groundHex) {
            groundHex.onchange = () => {
                let val = groundHex.value.trim();
                if (!val.startsWith('#')) val = '#' + val;
                if (/^#[0-9a-f]{6}$/i.test(val)) {
                    this.groundColor = val.toUpperCase();
                    groundHex.value = this.groundColor;
                    if (groundBtn) groundBtn.style.background = this.groundColor;
                    this.manualControl = true;
                    this.applySceneLighting();
                }
            };
        }

        // Save to Constants.js as engine-wide defaults
        const saveConstBtn = document.getElementById('btn-save-constants');
        if (saveConstBtn) {
            saveConstBtn.onclick = async () => {
                const changes = [
                    { name: 'WORLD3D_SUN_AZIMUTH_DEG', value: Math.round(this.sunAzimuth) },
                    { name: 'WORLD3D_SUN_ELEVATION_DEG', value: Math.round(this.sunElevation) },
                    { name: 'WORLD3D_SUN_INTENSITY', value: Number(this.sunIntensity) },
                    { name: 'WORLD3D_SUN_COLOR', value: parseInt(this.sunColor.replace('#', ''), 16) },
                    { name: 'WORLD3D_SKYLIGHT_INTENSITY', value: Number(this.ambientIntensity) },
                    { name: 'WORLD3D_SKYLIGHT_COLOR', value: parseInt(this.skyColor.replace('#', ''), 16) },
                    { name: 'WORLD3D_GROUNDLIGHT_COLOR', value: parseInt(this.groundColor.replace('#', ''), 16) },
                    { name: 'WORLD3D_SKY_COLOR', value: parseInt(this.skyColor.replace('#', ''), 16) }
                ];
                try {
                    const r = await fetch('/api/save-constants', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ changes })
                    });
                    const j = await r.json();
                    if (j && j.patched > 0) {
                        if (typeof Toast !== 'undefined') {
                            Toast.show('Дефолты движка сохранены в Constants.js');
                        }
                    } else {
                        if (typeof Toast !== 'undefined') Toast.show('Не удалось сохранить Constants.js' + (j?.error ? ': ' + j.error : ''), true);
                    }
                } catch (e) {
                    if (typeof Toast !== 'undefined') Toast.show('Ошибка: ' + e.message, true);
                }
            };
        }

        // Add Point Light
        const addPtBtn = document.getElementById('btn-add-point-light');
        if (addPtBtn) {
            addPtBtn.onclick = () => {
                const target = (typeof Lab !== 'undefined' && Lab.cameraTargetGround) ? Lab.cameraTargetGround() : { x: 500, y: 500, h: 0 };
                const def = LightManager.createLight('point', target.x, target.y, target.h + 80);
                LightManager.select(def.id);
            };
        }

        // Add Spot Light
        const addSpotBtn = document.getElementById('btn-add-spot-light');
        if (addSpotBtn) {
            addSpotBtn.onclick = () => {
                const target = (typeof Lab !== 'undefined' && Lab.cameraTargetGround) ? Lab.cameraTargetGround() : { x: 500, y: 500, h: 0 };
                const def = LightManager.createLight('spot', target.x, target.y, target.h + 120, {
                    direction: [0, -1, 0.2]
                });
                LightManager.select(def.id);
            };
        }

        // Light List item selection & deletion
        const listEl = document.getElementById('lights-list');
        if (listEl) {
            listEl.onclick = e => {
                const target = /** @type {HTMLElement} */ (e.target);
                const delBtn = target.closest('.light-del-btn');
                if (delBtn) {
                    const id = delBtn.getAttribute('data-id');
                    if (id) LightManager.removeLight(id);
                    return;
                }
                const item = target.closest('.light-list-item');
                if (item) {
                    const id = item.getAttribute('data-id');
                    if (id) LightManager.select(id);
                }
            };
        }

        // Selected light properties binding
        this._bindLightPropertiesEvents();
    },

    _bindLightPropertiesEvents() {
        const id = LightManager.selectedId;
        if (!id) return;

        const nameInp = /** @type {HTMLInputElement} */ (document.getElementById('light-prop-name'));
        if (nameInp) nameInp.onchange = () => LightManager.updateLight(id, { name: nameInp.value });

        const xInp = /** @type {HTMLInputElement} */ (document.getElementById('light-prop-x'));
        const hInp = /** @type {HTMLInputElement} */ (document.getElementById('light-prop-h'));
        const yInp = /** @type {HTMLInputElement} */ (document.getElementById('light-prop-y'));
        const onPosChange = () => {
            LightManager.updateLight(id, {
                x: Number(xInp?.value || 0),
                h: Number(hInp?.value || 0),
                y: Number(yInp?.value || 0)
            });
        };
        if (xInp) xInp.onchange = onPosChange;
        if (hInp) hInp.onchange = onPosChange;
        if (yInp) yInp.onchange = onPosChange;

        const colorBtn = document.getElementById('light-prop-color-btn');
        const colorHex = /** @type {HTMLInputElement} */ (document.getElementById('light-prop-color-hex'));
        if (colorBtn) {
            colorBtn.onclick = () => {
                if (typeof ColorPicker !== 'undefined') {
                    ColorPicker.open(colorBtn, colorHex?.value || '#ffffff', (hex) => {
                        if (colorHex) colorHex.value = hex;
                        LightManager.updateLight(id, { color: hex });
                    });
                }
            };
        }
        if (colorHex) {
            colorHex.onchange = () => {
                let val = colorHex.value.trim();
                if (!val.startsWith('#')) val = '#' + val;
                if (/^#[0-9a-f]{6}$/i.test(val)) {
                    val = val.toUpperCase();
                    colorHex.value = val;
                    if (colorBtn) colorBtn.style.background = val;
                    LightManager.updateLight(id, { color: val });
                }
            };
        }

        const intSlider = /** @type {HTMLInputElement} */ (document.getElementById('light-prop-intensity'));
        if (intSlider) {
            intSlider.oninput = () => {
                const val = Number(intSlider.value);
                const el = document.getElementById('light-int-val');
                if (el) el.textContent = val.toFixed(1);
                LightManager.updateLight(id, { intensity: val });
            };
        }

        const rangeSlider = /** @type {HTMLInputElement} */ (document.getElementById('light-prop-range'));
        if (rangeSlider) {
            rangeSlider.oninput = () => {
                const val = Number(rangeSlider.value);
                const el = document.getElementById('light-range-val');
                if (el) el.textContent = String(val);
                LightManager.updateLight(id, { range: val });
            };
        }

        const angleSlider = /** @type {HTMLInputElement} */ (document.getElementById('light-prop-angle'));
        if (angleSlider) {
            angleSlider.oninput = () => {
                const val = Number(angleSlider.value);
                const el = document.getElementById('light-angle-val');
                if (el) el.textContent = val + '°';
                LightManager.updateLight(id, { angle: val });
            };
        }

        const expSlider = /** @type {HTMLInputElement} */ (document.getElementById('light-prop-exp'));
        if (expSlider) {
            expSlider.oninput = () => {
                const val = Number(expSlider.value);
                const el = document.getElementById('light-exp-val');
                if (el) el.textContent = String(val);
                LightManager.updateLight(id, { exponent: val });
            };
        }
    },

    updateProperties() {
        const propEl = document.getElementById('light-properties');
        if (propEl) {
            propEl.innerHTML = this._renderSelectedLightPropsHtml();
            this._bindLightPropertiesEvents();
        }
    },

    syncFromDnc() {
        if (!this.dnc) return;
        const st = this.dnc.getLightingState();
        this.sunAzimuth = st.sunAz;
        this.sunElevation = st.sunEl;
        this.sunIntensity = st.sunIntensity;
        this.sunColor = st.sunColorHex;
        this.ambientIntensity = st.skyIntensity;
        this.skyColor = st.skyHex;
        this.applySceneLighting();

        // Update UI displays
        const badge = document.getElementById('dnc-time-badge');
        if (badge) {
            const periodNames = { dawn: 'Рассвет 🌅', midday: 'День ☀️', dusk: 'Закат 🌇', night: 'Ночь 🌙' };
            badge.textContent = `${this.dnc.getTimeFormatted()} (${periodNames[st.period] || st.period})`;
        }
        const azVal = document.getElementById('sun-az-val');
        if (azVal) azVal.textContent = Math.round(this.sunAzimuth) + '°';
        const elVal = document.getElementById('sun-el-val');
        if (elVal) elVal.textContent = Math.round(this.sunElevation) + '°';
        const intVal = document.getElementById('sun-int-val');
        if (intVal) intVal.textContent = Number(this.sunIntensity).toFixed(2);
        const ambVal = document.getElementById('amb-int-val');
        if (ambVal) ambVal.textContent = Number(this.ambientIntensity).toFixed(2);
        const azInp = /** @type {HTMLInputElement} */ (document.getElementById('sun-az-slider'));
        if (azInp) azInp.value = String(this.sunAzimuth);
        const elInp = /** @type {HTMLInputElement} */ (document.getElementById('sun-el-slider'));
        if (elInp) elInp.value = String(this.sunElevation);
        const intInp = /** @type {HTMLInputElement} */ (document.getElementById('sun-int-slider'));
        if (intInp) intInp.value = String(this.sunIntensity);
        const ambInp = /** @type {HTMLInputElement} */ (document.getElementById('amb-int-slider'));
        if (ambInp) ambInp.value = String(this.ambientIntensity);
        const sunBtn = document.getElementById('sun-color-btn');
        if (sunBtn) sunBtn.style.background = this.sunColor;
        const sunHex = /** @type {HTMLInputElement} */ (document.getElementById('sun-color-hex'));
        if (sunHex) sunHex.value = this.sunColor;

        const skyBtn = document.getElementById('sky-color-btn');
        if (skyBtn) skyBtn.style.background = this.skyColor;
        const skyHex = /** @type {HTMLInputElement} */ (document.getElementById('sky-color-hex'));
        if (skyHex) skyHex.value = this.skyColor;
    },

    applySceneLighting() {
        if (typeof Lab === 'undefined' || !Lab.location?.view) return;
        const view = Lab.location.view;

        let nightFactor = 0;
        if (!this.sunEnabled) {
            nightFactor = 1.0;
        } else if (this.cycleEnabledInGame && !this.manualControl && this.dnc) {
            nightFactor = this.dnc.getNightFactor();
        } else {
            nightFactor = this.sunElevation >= 0 ? 0.0 : Math.min(1.0, Math.max(0.0, -this.sunElevation / 15.0));
        }

        const sunColNum = parseInt(this.sunColor.replace('#', ''), 16);
        const skyColNum = parseInt(this.skyColor.replace('#', ''), 16);
        const groundColNum = parseInt(this.groundColor.replace('#', ''), 16);

        const cfg = {
            sunEnabled: this.sunEnabled,
            sunAz: this.sunAzimuth,
            sunEl: this.sunElevation,
            sunIntensity: this.sunEnabled ? this.sunIntensity : 0,
            sunColor: sunColNum,
            skyIntensity: this.ambientIntensity,
            skyLight: skyColNum,
            sky: skyColNum,
            groundLight: groundColNum,
            nightFactor: nightFactor
        };

        view.applyLighting(cfg);

        // Keep engine constants in sync so there is only one source of truth
        if (typeof window !== 'undefined') {
            const win = /** @type {any} */ (window);
            win.WORLD3D_SUN_AZIMUTH_DEG = this.sunAzimuth;
            win.WORLD3D_SUN_ELEVATION_DEG = this.sunElevation;
            win.WORLD3D_SUN_INTENSITY = this.sunEnabled ? this.sunIntensity : 0;
            win.WORLD3D_SUN_COLOR = sunColNum;
            win.WORLD3D_SKYLIGHT_INTENSITY = this.ambientIntensity;
            win.WORLD3D_SKYLIGHT_COLOR = skyColNum;
            win.WORLD3D_GROUNDLIGHT_COLOR = groundColNum;
            win.WORLD3D_SKY_COLOR = skyColNum;
        }

        // Synchronize skybox in RaidEnvironment to avoid "two suns" and sunset at night
        if (typeof RaidLayer !== 'undefined' && RaidLayer.env?.syncSky) {
            RaidLayer.env.syncSky(this.sunAzimuth, nightFactor, this.sunEnabled);
        }
    },

    tick(dt) {
        if (this.isPlaying && this.dnc) {
            this.dnc.update(dt * this.speedMultiplier);
            this.syncFromDnc();
            const slider = /** @type {HTMLInputElement} */ (document.getElementById('dnc-time-slider'));
            if (slider) slider.value = String(this.dnc.getTime());
        }
    },

    exportSettings() {
        let tod = this.dnc ? this.dnc.getTime() : 12.0;
        // If static map with day elevation, prevent accidental midnight timeOfDay corruption
        if (!this.cycleEnabledInGame && this.sunElevation >= 0 && (tod < 5.0 || tod >= 20.0)) {
            tod = 12.0;
        }
        return {
            timeOfDay: tod,
            cycleEnabled: this.cycleEnabledInGame,
            cycleSpeed: this.speedMultiplier,
            sunEnabled: this.sunEnabled,
            sunAzimuth: this.sunAzimuth,
            sunElevation: this.sunElevation,
            sunIntensity: this.sunIntensity,
            sunColor: this.sunColor,
            ambientIntensity: this.ambientIntensity,
            skyColor: this.skyColor,
            groundColor: this.groundColor
        };
    },

    importSettings(cfg = {}) {
        const base = (typeof World3D !== 'undefined' && typeof World3D.cfg === 'function') ? World3D.cfg() : {};
        const hex = num => (num != null && !isNaN(num)) ? ('#' + (Number(num) >>> 0).toString(16).padStart(6, '0').slice(-6).toUpperCase()) : null;

        this.cycleEnabledInGame = cfg.cycleEnabled != null ? !!cfg.cycleEnabled : false;
        this.speedMultiplier = cfg.cycleSpeed != null ? Number(cfg.cycleSpeed) : 15.0;
        this.sunEnabled = cfg.sunEnabled != null ? !!cfg.sunEnabled : true;
        this.sunAzimuth = cfg.sunAzimuth != null ? Number(cfg.sunAzimuth) : (base.sunAz ?? 53);
        this.sunElevation = cfg.sunElevation != null ? Number(cfg.sunElevation) : (base.sunEl ?? 48);
        this.sunIntensity = cfg.sunIntensity != null ? Number(cfg.sunIntensity) : (base.sunIntensity ?? 1.0);
        this.sunColor = (typeof cfg.sunColor === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.sunColor)) ? cfg.sunColor.toUpperCase() : (hex(base.sunColor) || '#FFF7E6');
        this.ambientIntensity = cfg.ambientIntensity != null ? Number(cfg.ambientIntensity) : (base.skyIntensity ?? 0.6);
        this.skyColor = (typeof cfg.skyColor === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.skyColor)) ? cfg.skyColor.toUpperCase() : (hex(base.skyLight) || '#8BB5D9');
        this.groundColor = (typeof cfg.groundColor === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.groundColor)) ? cfg.groundColor.toUpperCase() : (hex(base.groundLight) || '#3D362D');

        if (this.dnc) {
            const tod = cfg.timeOfDay != null ? Number(cfg.timeOfDay) : (this.sunElevation >= 0 ? 12.0 : 0.0);
            this.dnc.setTime(tod);
        }
        this.manualControl = !this.cycleEnabledInGame;

        this.applySceneLighting();
        this.render();
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = LightingPanel;
if (typeof window !== 'undefined') /** @type {any} */ (window).LightingPanel = LightingPanel;
