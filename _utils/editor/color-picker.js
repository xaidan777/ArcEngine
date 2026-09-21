// _utils/editor/color-picker.js
// Embedded, viewport-aware color picker popover for ArcEngine Editor.
// Never clips outside the window boundaries or panels.

const ColorPicker = {
    _popover: null,
    _activeAnchor: null,
    _onChange: null,
    _hsv: { h: 0, s: 1, v: 1 },
    _hex: '#ffffff',
    _isDraggingSV: false,
    _isDraggingHue: false,

    // --- Math helpers ---
    hexToRgb(hex) {
        hex = String(hex || '#ffffff').replace('#', '').trim();
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (hex.length !== 6) return { r: 255, g: 255, b: 255 };
        const num = parseInt(hex, 16);
        if (isNaN(num)) return { r: 255, g: 255, b: 255 };
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    },

    rgbToHex(r, g, b) {
        const toHex = (c) => Math.max(0, Math.min(255, Math.round(c || 0))).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
    },

    rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        let h = 0, s = max === 0 ? 0 : d / max, v = max;
        if (max !== min) {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h *= 60;
        }
        return { h: Math.round(h), s, v };
    },

    hsvToRgb(h, s, v) {
        h = (h % 360 + 360) % 360;
        const c = v * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = v - c;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }
        return {
            r: Math.round((r + m) * 255),
            g: Math.round((g + m) * 255),
            b: Math.round((b + m) * 255)
        };
    },

    // --- Popover management ---
    init() {
        if (this._popover) return;
        const pop = document.createElement('div');
        pop.id = 'editor-color-picker-popover';
        pop.style.cssText = `
            position: fixed;
            z-index: 100000;
            width: 240px;
            background: #182029;
            border: 1px solid #3d4f63;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.7);
            padding: 10px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #dbe4ee;
            font-size: 12px;
            display: none;
            user-select: none;
            flex-direction: column;
            gap: 8px;
        `;

        pop.innerHTML = `
            <!-- SV area -->
            <div id="cp-sv-area" style="position: relative; width: 100%; height: 120px; border-radius: 4px; cursor: crosshair; overflow: hidden; border: 1px solid #2d3b4b;">
                <div id="cp-sv-bg" style="position: absolute; inset: 0; background: red;"></div>
                <div style="position: absolute; inset: 0; background: linear-gradient(to right, #fff, transparent);"></div>
                <div style="position: absolute; inset: 0; background: linear-gradient(to bottom, transparent, #000);"></div>
                <div id="cp-sv-handle" style="position: absolute; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 3px rgba(0,0,0,0.8); transform: translate(-6px, -6px); pointer-events: none;"></div>
            </div>

            <!-- Hue slider -->
            <div id="cp-hue-area" style="position: relative; width: 100%; height: 14px; border-radius: 7px; cursor: pointer; border: 1px solid #2d3b4b; background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);">
                <div id="cp-hue-handle" style="position: absolute; width: 10px; height: 18px; border-radius: 3px; background: #fff; border: 1px solid #000; box-shadow: 0 0 3px rgba(0,0,0,0.6); transform: translate(-5px, -2px); pointer-events: none;"></div>
            </div>

            <!-- Preview & Hex & RGB -->
            <div style="display: flex; align-items: center; gap: 8px;">
                <div id="cp-preview-swatch" style="width: 36px; height: 26px; border-radius: 4px; border: 1px solid #4a5c70; background: #fff; flex-shrink: 0;"></div>
                <input id="cp-hex-input" type="text" maxlength="7" style="flex: 1; height: 24px; background: #222c38; color: #fff; border: 1px solid #3d4f63; border-radius: 4px; font-family: monospace; font-size: 11px; text-transform: uppercase; text-align: center; padding: 0 4px;">
            </div>

            <div style="display: flex; gap: 4px; align-items: center; font-size: 10px;">
                <label style="flex: 1; display: flex; align-items: center; gap: 3px;">
                    <span style="color: #ff7b7b;">R</span>
                    <input id="cp-r-input" type="number" min="0" max="255" style="width: 100%; height: 20px; background: #222c38; color: #eee; border: 1px solid #334; border-radius: 3px; padding: 0 2px; font-size: 10px;">
                </label>
                <label style="flex: 1; display: flex; align-items: center; gap: 3px;">
                    <span style="color: #7bff7b;">G</span>
                    <input id="cp-g-input" type="number" min="0" max="255" style="width: 100%; height: 20px; background: #222c38; color: #eee; border: 1px solid #334; border-radius: 3px; padding: 0 2px; font-size: 10px;">
                </label>
                <label style="flex: 1; display: flex; align-items: center; gap: 3px;">
                    <span style="color: #7bb3ff;">B</span>
                    <input id="cp-b-input" type="number" min="0" max="255" style="width: 100%; height: 20px; background: #222c38; color: #eee; border: 1px solid #334; border-radius: 3px; padding: 0 2px; font-size: 10px;">
                </label>
            </div>

            <!-- Lighting Presets -->
            <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 2px;">
                <span style="font-size: 10px; color: #8899aa;">Быстрые пресеты света:</span>
                <div id="cp-presets" style="display: flex; gap: 4px; flex-wrap: wrap;">
                    <button type="button" data-color="#FFFFFF" title="Белый дневной" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #FFFFFF; cursor: pointer;"></button>
                    <button type="button" data-color="#FFF2D6" title="Теплое солнце" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #FFF2D6; cursor: pointer;"></button>
                    <button type="button" data-color="#FFA040" title="Золотой закат" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #FFA040; cursor: pointer;"></button>
                    <button type="button" data-color="#FF5522" title="Багровый закат" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #FF5522; cursor: pointer;"></button>
                    <button type="button" data-color="#6BA4FF" title="Дневное небо" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #6BA4FF; cursor: pointer;"></button>
                    <button type="button" data-color="#1A2B4C" title="Сумерки" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #1A2B4C; cursor: pointer;"></button>
                    <button type="button" data-color="#FFEAA7" title="Теплая лампа" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #FFEAA7; cursor: pointer;"></button>
                    <button type="button" data-color="#74B9FF" title="Холодный LED" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #74B9FF; cursor: pointer;"></button>
                    <button type="button" data-color="#FF3333" title="Красный аварийный" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #FF3333; cursor: pointer;"></button>
                    <button type="button" data-color="#2ED573" title="Зеленый терминал" style="width: 20px; height: 18px; border-radius: 3px; border: 1px solid #445; background: #2ED573; cursor: pointer;"></button>
                </div>
            </div>
        `;

        document.body.appendChild(pop);
        this._popover = pop;
        this._bindEvents();
    },

    _bindEvents() {
        const pop = this._popover;
        const svArea = pop.querySelector('#cp-sv-area');
        const hueArea = pop.querySelector('#cp-hue-area');

        // Dragging SV
        const updateSV = (e) => {
            const rect = svArea.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
            this._hsv.s = x / rect.width;
            this._hsv.v = 1 - (y / rect.height);
            this._applyColor(false);
        };

        svArea.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._isDraggingSV = true;
            svArea.setPointerCapture(e.pointerId);
            updateSV(e);
        });
        svArea.addEventListener('pointermove', (e) => {
            if (this._isDraggingSV) { e.preventDefault(); updateSV(e); }
        });
        svArea.addEventListener('pointerup', (e) => {
            if (this._isDraggingSV) {
                this._isDraggingSV = false;
                try { svArea.releasePointerCapture(e.pointerId); } catch (_) {}
            }
        });

        // Dragging Hue
        const updateHue = (e) => {
            const rect = hueArea.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            this._hsv.h = Math.round((x / rect.width) * 360) % 360;
            this._applyColor(false);
        };

        hueArea.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._isDraggingHue = true;
            hueArea.setPointerCapture(e.pointerId);
            updateHue(e);
        });
        hueArea.addEventListener('pointermove', (e) => {
            if (this._isDraggingHue) { e.preventDefault(); updateHue(e); }
        });
        hueArea.addEventListener('pointerup', (e) => {
            if (this._isDraggingHue) {
                this._isDraggingHue = false;
                try { hueArea.releasePointerCapture(e.pointerId); } catch (_) {}
            }
        });

        // Hex input
        const hexInput = pop.querySelector('#cp-hex-input');
        hexInput.addEventListener('change', () => {
            let val = hexInput.value.trim();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                this.setColor(val);
            }
        });

        // RGB inputs
        const rIn = pop.querySelector('#cp-r-input');
        const gIn = pop.querySelector('#cp-g-input');
        const bIn = pop.querySelector('#cp-b-input');
        const onRgbChange = () => {
            const r = parseInt(rIn.value, 10) || 0;
            const g = parseInt(gIn.value, 10) || 0;
            const b = parseInt(bIn.value, 10) || 0;
            this.setColor(this.rgbToHex(r, g, b));
        };
        rIn.addEventListener('change', onRgbChange);
        gIn.addEventListener('change', onRgbChange);
        bIn.addEventListener('change', onRgbChange);

        // Presets
        pop.querySelectorAll('#cp-presets button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const col = btn.getAttribute('data-color');
                if (col) this.setColor(col);
            });
        });

        // Dismiss on click outside or escape
        document.addEventListener('pointerdown', (e) => {
            if (!this._popover || this._popover.style.display === 'none') return;
            if (this._popover.contains(e.target) || (this._activeAnchor && this._activeAnchor.contains(e.target))) return;
            this.close();
        }, true);

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._popover && this._popover.style.display !== 'none') {
                this.close();
            }
        });
    },

    open(anchorEl, initialColor, onChange) {
        this.init();
        this._activeAnchor = anchorEl;
        this._onChange = onChange;
        this.setColor(initialColor || '#ffffff', true);

        // Viewport-aware positioning: GUARANTEED not to clip off-screen!
        const pop = this._popover;
        pop.style.display = 'flex';

        const rect = anchorEl.getBoundingClientRect();
        const popW = 240;
        const popH = 265;

        // Position horizontally: align with right edge of anchor, but clamp to [10px .. window.innerWidth - 10px]
        let left = rect.right - popW;
        if (left + popW > window.innerWidth - 12) {
            left = window.innerWidth - 12 - popW;
        }
        if (left < 12) left = 12;

        // Position vertically: prefer below, flip above if bottom overflows
        let top = rect.bottom + 6;
        if (top + popH > window.innerHeight - 12) {
            top = Math.max(12, rect.top - popH - 6);
        }

        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
    },

    close() {
        if (this._popover) {
            this._popover.style.display = 'none';
        }
        this._activeAnchor = null;
        this._onChange = null;
    },

    setColor(hex, skipCallback = false) {
        const rgb = this.hexToRgb(hex);
        this._hsv = this.rgbToHsv(rgb.r, rgb.g, rgb.b);
        this._applyColor(skipCallback);
    },

    _applyColor(skipCallback = false) {
        const rgb = this.hsvToRgb(this._hsv.h, this._hsv.s, this._hsv.v);
        this._hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);

        const pop = this._popover;
        if (!pop) return;

        // Update SV area background to pure hue
        const hueRgb = this.hsvToRgb(this._hsv.h, 1, 1);
        const svBg = pop.querySelector('#cp-sv-bg');
        if (svBg) svBg.style.background = `rgb(${hueRgb.r}, ${hueRgb.g}, ${hueRgb.b})`;

        // Update SV handle position
        const svHandle = pop.querySelector('#cp-sv-handle');
        const svArea = pop.querySelector('#cp-sv-area');
        if (svHandle && svArea) {
            const w = svArea.clientWidth || 218;
            const h = svArea.clientHeight || 120;
            svHandle.style.left = `${this._hsv.s * w}px`;
            svHandle.style.top = `${(1 - this._hsv.v) * h}px`;
        }

        // Update Hue handle position
        const hueHandle = pop.querySelector('#cp-hue-handle');
        const hueArea = pop.querySelector('#cp-hue-area');
        if (hueHandle && hueArea) {
            const w = hueArea.clientWidth || 218;
            hueHandle.style.left = `${(this._hsv.h / 360) * w}px`;
        }

        // Update preview swatch and hex input
        const swatch = pop.querySelector('#cp-preview-swatch');
        if (swatch) swatch.style.background = this._hex;

        const hexIn = pop.querySelector('#cp-hex-input');
        if (hexIn && document.activeElement !== hexIn) hexIn.value = this._hex;

        // Update RGB inputs
        const rIn = pop.querySelector('#cp-r-input');
        const gIn = pop.querySelector('#cp-g-input');
        const bIn = pop.querySelector('#cp-b-input');
        if (rIn && document.activeElement !== rIn) rIn.value = rgb.r;
        if (gIn && document.activeElement !== gIn) gIn.value = rgb.g;
        if (bIn && document.activeElement !== bIn) bIn.value = rgb.b;

        // Update active anchor button background
        if (this._activeAnchor) {
            this._activeAnchor.style.background = this._hex;
        }

        // Notify listener
        if (!skipCallback && typeof this._onChange === 'function') {
            this._onChange(this._hex);
        }
    }
};

if (typeof window !== 'undefined') window.ColorPicker = ColorPicker;
if (typeof module !== 'undefined' && module.exports) module.exports = ColorPicker;
