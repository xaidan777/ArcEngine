/** @satisfies {Record<string, any>} */
const TerrainPanel = {
    active: false, stroke: null,
    init() {
        const host = document.getElementById('terrain-panel');
        host.innerHTML = `<div class="terrain-dimensions" id="terrain-dimensions-info" style="margin: 4px 0 8px 0; padding: 6px 8px; background: rgba(0,0,0,0.25); border-radius: 4px; font-size: 12px; color: #7ec7ff; display: flex; flex-direction: column; gap: 6px;">
            <div>Размер карты: <strong id="terrain-dim-text">—</strong></div>
            <label style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #e0e0e0; margin: 0;">
                <span>Размер:</span>
                <select id="terrain-size-select" style="background: #2a2a2a; color: #fff; border: 1px solid #444; border-radius: 3px; padding: 2px 6px; font-size: 12px;">
                    <option value="1024">1024 × 1024</option>
                    <option value="2048">2048 × 2048</option>
                    <option value="4096">4096 × 4096</option>
                    <option value="8192">8192 × 8192</option>
                </select>
            </label>
            <label style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #e0e0e0; margin: 0;">
                <span>Окружение:</span>
                <select id="terrain-outer-select" style="background: #2a2a2a; color: #fff; border: 1px solid #444; border-radius: 3px; padding: 2px 6px; font-size: 12px;">
                    <option value="none">Без кольца (по умолчанию)</option>
                    <option value="mountains">Окружающие горы</option>
                    <option value="flat">Базовое кольцо</option>
                </select>
            </label>
        </div>
        <label><input id="terrain-active" type="checkbox"> Кисть рельефа</label>
        <label>Режим <select id="terrain-mode"><option value="raise">Поднять (ПКМ — опустить)</option><option value="lower">Опустить</option><option value="smooth">Сгладить</option><option value="flatten">Выровнять</option><option value="noise">Шум</option></select></label>
        <label>Радиус <input id="terrain-radius" type="number" min="4" max="2000" value="120"></label>
        <label>Сила <input id="terrain-strength" type="number" min="0.1" max="100" value="8" step="0.1"></label>
        <label>Высота площадки <input id="terrain-height" type="number" value="0"></label>
        <label>Минимальная высота PNG <input id="terrain-min" type="number" value="-50"></label>
        <label>Максимальная высота PNG <input id="terrain-max" type="number" value="300"></label>
        <label>Доля шума <input id="terrain-blend" type="number" min="0" max="1" step="0.05" value="0"></label>
        <label>Импорт Heightmap (.png, 8/16 бит)<input id="terrain-import" type="file" accept=".png"></label>
        <button id="terrain-export">Экспорт Heightmap (.png, 8 бит)</button>
        <p>PNG использует заданный диапазон высот. Карта сохраняет точные высоты без потери разрядности.</p>`;
        this.updateDimensions();
        const sizeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('terrain-size-select'));
        if (sizeSelect) {
            sizeSelect.onchange = () => {
                const newSize = Number(sizeSelect.value);
                if (newSize > 0) this.resizeMap(newSize, newSize);
            };
        }
        const outerSelect = /** @type {HTMLSelectElement} */ (document.getElementById('terrain-outer-select'));
        if (outerSelect) {
            outerSelect.onchange = () => {
                if (!RaidLayer.levelData) return;
                const val = outerSelect.value;
                if (!RaidLayer.levelData.terrain) RaidLayer.levelData.terrain = {};
                if (val === 'none') {
                    RaidLayer.levelData.terrain.outerRing = false;
                    RaidLayer.levelData.terrain.outerRingMode = 'none';
                } else if (val === 'mountains') {
                    RaidLayer.levelData.terrain.outerRing = true;
                    RaidLayer.levelData.terrain.outerRingMode = 'mountains';
                } else if (val === 'flat') {
                    RaidLayer.levelData.terrain.outerRing = true;
                    RaidLayer.levelData.terrain.outerRingMode = 'flat';
                }
                Lab.location.opts.level = RaidLayer.levelData;
                const terrain = Lab.location.buildTerrain();
                terrain.ready.then(() => {
                    Lab.camera.setTerrain(terrain, { w: Lab.location.width, h: Lab.location.height });
                    RaidLayer.terrain = terrain;
                });
            };
        }
        document.getElementById('terrain-active').onchange = e => { this.active = /** @type {HTMLInputElement} */ (e.target).checked; if (this.active) MapEditor.clearSelection(); };
        document.getElementById('terrain-import').onchange = e => MapEditor.run(async () => {
            const file = /** @type {HTMLInputElement} */ (e.target).files[0]; if (!file) return;
            const t = Lab.location.terrain, before = t.hgrid.slice();
            await t.setHeightmap(file, { minHeight: this.value('min'), maxHeight: this.value('max'), blendNoise: this.value('blend') });
            this.commit(t, before); this.settle(); /** @type {HTMLInputElement} */ (e.target).value = '';
        });
        document.getElementById('terrain-export').onclick = () => {
            const a = document.createElement('a'); a.download = MapEditor.id + '_heightmap.png';
            a.href = Lab.location.terrain.exportHeightmap(this.value('min'), this.value('max')).toDataURL('image/png'); a.click();
        };
        const canvas = Lab.canvas;
        canvas.addEventListener('pointerdown', e => {
            if (!this.active || PaneTabs.current !== 'terrain' || ![0, 2].includes(e.button)) return;
            e.preventDefault(); e.stopImmediatePropagation(); canvas.setPointerCapture(e.pointerId);
            this.stroke = { before: Lab.location.terrain.hgrid.slice(), button: e.button, id: e.pointerId, time: 0 };
            this.paint(e);
        }, true);
        canvas.addEventListener('pointermove', e => {
            if (!this.stroke) return; e.preventDefault(); e.stopImmediatePropagation();
            if (e.timeStamp - this.stroke.time > 30) { this.paint(e); this.stroke.time = e.timeStamp; }
        }, true);
        const finish = e => {
            if (!this.stroke) return; e.preventDefault(); e.stopImmediatePropagation();
            const before = this.stroke.before; this.stroke = null;
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
            this.commit(Lab.location.terrain, before); this.settle();
        };
        canvas.addEventListener('pointerup', finish, true); canvas.addEventListener('pointercancel', finish, true);
        canvas.addEventListener('contextmenu', e => { if (this.active) e.preventDefault(); });
    },
    value(id) { return Number(/** @type {HTMLInputElement} */ (document.getElementById('terrain-' + id)).value); },
    paint(e) {
        const rect = Lab.canvas.getBoundingClientRect(), t = Lab.location.terrain;
        t.mesh.isPickable = true;
        const hit = Lab.location.view.scene.pick(e.clientX - rect.left, e.clientY - rect.top, m => m === t.mesh);
        t.mesh.isPickable = false;
        if (!hit?.hit) return;
        t.brush(hit.pickedPoint.x, hit.pickedPoint.z, { mode: this.stroke.button === 2 ? 'lower' : /** @type {HTMLSelectElement} */ (document.getElementById('terrain-mode')).value, radius: this.value('radius'), strength: this.value('strength'), height: this.value('height') });
    },
    async resizeMap(width, height) {
        if (!Lab.location || !RaidLayer.levelData) return;
        const curW = Lab.location.width, curH = Lab.location.height;
        if (curW === width && curH === height) return;
        const before = MapEditor.snapshot();
        RaidLayer.levelData.dimensions = { width, height };
        Lab.location.opts.level = RaidLayer.levelData;
        const terrain = Lab.location.buildTerrain();
        await terrain.ready;
        Lab.camera.setTerrain(terrain, { w: width, h: height });
        RaidLayer.terrain = terrain;
        RaidLayer.buildDistrictGeometry();
        RaidLayer.build3DMarkers();
        RaidLayer.setVisible(RaidLayer.visible);
        SceneView.buildGrid();
        SceneView.setGridVisible(SceneView.gridVisible);
        if (typeof MaterialEditor !== 'undefined' && MaterialEditor.currentGroundConfig) {
            MaterialEditor.init(Lab.location.view.scene, terrain);
            MaterialEditor.applyGroundConfig(MaterialEditor.currentGroundConfig);
        }
        this.updateDimensions();
        const after = MapEditor.snapshot();
        EditHistory.record(null, () => MapEditor.run(() => MapEditor.apply(before)), () => MapEditor.run(() => MapEditor.apply(after)));
        if (typeof Toast !== 'undefined') Toast.show(`Размер карты изменён: ${width} × ${height} px`);
    },
    updateDimensions() {
        const w = (typeof Lab !== 'undefined' && Lab.location?.width) || 4096;
        const h = (typeof Lab !== 'undefined' && Lab.location?.height) || 4096;
        const t = typeof Lab !== 'undefined' && Lab.location?.terrain;
        const el = document.getElementById('terrain-dim-text');
        if (el) el.textContent = `${w} × ${h} px (сетка: ${t?.nx || '?'} × ${t?.ny || '?'})`;
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('terrain-size-select'));
        if (sel) {
            if ([1024, 2048, 4096, 8192].includes(w) && w === h) {
                sel.value = String(w);
            } else {
                let opt = Array.from(sel.options).find(o => o.value === String(w));
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = String(w);
                    opt.textContent = `${w} × ${h}`;
                    sel.appendChild(opt);
                }
                sel.value = String(w);
            }
        }
        const outerSelect = /** @type {HTMLSelectElement} */ (document.getElementById('terrain-outer-select'));
        if (outerSelect && typeof RaidLayer !== 'undefined' && RaidLayer.levelData?.terrain) {
            const tr = RaidLayer.levelData.terrain;
            if (tr.outerRing === false || tr.outerRingMode === 'none') outerSelect.value = 'none';
            else if (tr.outerRingMode === 'mountains' || tr.outerRing === true) outerSelect.value = 'mountains';
            else if (tr.outerRingMode === 'flat') outerSelect.value = 'flat';
            else outerSelect.value = 'none';
        }
    },
    settle() {
        Lab.location.placeObjects();
        RaidLayer.terrain = Lab.location.terrain;
        RaidLayer.build3DMarkers();
        RaidLayer.setVisible(RaidLayer.visible);
        SceneView.buildGrid();
        SceneView.setGridVisible(SceneView.gridVisible);
        this.updateDimensions();
    },
    commit(t, before) {
        const after = t.hgrid.slice();
        const apply = values => { if (Lab.location.terrain !== t) return; t.hgrid.set(values); t.updateHeights(); this.settle(); };
        EditHistory.record(null, () => apply(before), () => apply(after));
    },
};
