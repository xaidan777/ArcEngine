// One level document owns props, gameplay, environment and terrain.
/** @satisfies {Record<string, any>} */
const MapEditor = {
    id: 'default_raid', saved: '', busy: false, selectedObjects: new Set(),
    async request(action, body, method = 'POST') {
        const response = await fetch('/api/maps' + action, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const text = await response.text();
        if (!response.headers.get('content-type')?.includes('application/json')) {
            throw new Error('Сервер на порту ' + location.port + ' не поддерживает карты. Остановите старый сервер (Ctrl+C в его терминале), запустите ./editor.sh (Linux/macOS) или editor.bat (Windows) и откройте адрес, который напечатает новый сервер. Обновление вкладки само по себе сервер не обновляет.');
        }
        const data = JSON.parse(text);
        if (!response.ok || !data.ok) throw new Error(data.error || 'Map request failed');
        return data;
    },
    async init() {
        const status = await fetch('/api/status', { cache: 'no-store' }).then(r => r.json());
        if (status.api < EDITOR_API_VERSION) throw new Error('Открыт устаревший сервер редактора (API ' + status.api + ', требуется ' + EDITOR_API_VERSION + '). Перезапустите ./editor.sh (Linux/macOS) или editor.bat (Windows) и откройте новый адрес из терминала. Старую вкладку на порту ' + location.port + ' следует закрыть.');
        ObjectsPanel.selectedObjects = this.selectedObjects;
        RaidLayer.selectedObjects = this.selectedObjects;
        const bind = (id, fn) => document.getElementById(id).addEventListener('click', () => this.run(fn));
        bind('btn-new-map', () => this.newMap());
        bind('btn-save-as-map', () => this.saveAs());
        bind('btn-clear-map', () => this.clearDialog());
        bind('btn-delete-map', () => this.deleteMap());
        bind('btn-add-marker', () => this.addMarker());
        const noEnemiesCb = /** @type {HTMLInputElement} */ (document.getElementById('cb-no-enemies'));
        if (noEnemiesCb) {
            noEnemiesCb.addEventListener('change', () => {
                if (RaidLayer.levelData) RaidLayer.levelData.noEnemies = noEnemiesCb.checked;
                Toast.show(noEnemiesCb.checked ? 'Режим «Без врагов» включен: спавн мобов в игре отключен' : 'Режим «Без врагов» выключен');
            });
        }
        /** @type {HTMLSelectElement} */ (document.getElementById('map-select')).addEventListener('change', e => this.run(() => this.load(/** @type {HTMLSelectElement} */ (e.target).value)));
        window.addEventListener('keydown', e => {
            if (/** @type {HTMLElement} */ (e.target)?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
            if (typeof WorkspaceManager !== 'undefined' && WorkspaceManager.current && WorkspaceManager.current !== 'level') return;
            if (PaneTabs.current === 'ui') return;
            const ctrl = e.ctrlKey || e.metaKey;
            if (ctrl && e.code === 'KeyA') { e.preventDefault(); e.stopImmediatePropagation(); this.selectAll(); }
            else if (ctrl && e.code === 'KeyS') { e.preventDefault(); e.stopImmediatePropagation(); this.run(() => this.save()); }
            else if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); this.removeSelection(); }
            else if (e.code === 'Escape') this.clearSelection();
        }, true);
        window.addEventListener('beforeunload', e => { if (this.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
        await this.refresh();
        const urlMap = new URLSearchParams(location.search).get('map');
        const lastMap = typeof localStorage !== 'undefined' ? localStorage.getItem('arc_editor_last_map') : null;
        const select = /** @type {HTMLSelectElement} */ (document.getElementById('map-select'));
        const mapIds = select ? Array.from(select.options).map(o => o.value) : [];
        let targetMap = urlMap || lastMap;
        if (!targetMap || !mapIds.includes(targetMap)) {
            targetMap = mapIds[0] || 'default_raid';
        }
        await this.load(targetMap, true);
        TerrainPanel.init();
    },
    async run(fn) {
        if (this.busy) return;
        this.busy = true;
        try { return await fn(); } catch (e) { Toast.show(e.message, true); console.error(e); }
        finally { this.busy = false; }
    },
    async refresh() {
        const { maps } = await this.request('', null, 'GET');
        const select = /** @type {HTMLSelectElement} */ (document.getElementById('map-select')); select.replaceChildren();
        for (const map of maps) { const opt = document.createElement('option'); opt.value = map.id; opt.textContent = map.name; select.append(opt); }
        select.value = this.id;
    },
    snapshot() {
        const t = Lab.location.terrain, level = JSON.parse(JSON.stringify(RaidLayer.levelData));
        const structures = (RaidLayer.env?.models || []).filter(m => !m.isDisposed() && m.metadata?.environmentLayer === 'structures');
        for (const rec of RaidLayer.entityMeshes.values()) {
            rec.entity.x = rec.mesh.position.x; rec.entity.y = rec.mesh.position.z;
        }
        Object.assign(level, JSON.parse(JSON.stringify(RaidLayer.levelData)));
        const noEnemiesCb = /** @type {HTMLInputElement} */ (document.getElementById('cb-no-enemies'));
        const noEnemies = noEnemiesCb ? noEnemiesCb.checked : !!level.noEnemies;
        const shouldSaveSamples = t.hasHeightmap && t.hgrid && t.hgrid.some(v => v !== 0);
        return { ...level, id: this.id, dimensions: { width: Lab.location.width, height: Lab.location.height },
            props: JSON.parse(JSON.stringify(ObjectsPanel.defs())),
            districtStructures: structures.map(m => ({ id: m.metadata.environmentId, position: m.position.asArray(), rotation: (m.rotationQuaternion ? m.rotationQuaternion.toEulerAngles() : m.rotation).asArray(), scale: m.scaling.asArray() })),
            terrain: { ...level.terrain, base: t.noiseBase, noiseAmp: t.noiseAmp, noiseScale: t.noiseScale, seed: t.noiseSeed, cell: t.cell,
                nx: t.nx, ny: t.ny, ...(shouldSaveSamples ? { samples: Array.from(t.hgrid) } : {}) },
            ground: typeof MaterialEditor !== 'undefined' ? MaterialEditor.currentGroundConfig : level.ground,
            lights: typeof LightManager !== 'undefined' ? LightManager.exportDefs() : (level.lights || []),
            lighting: typeof LightingPanel !== 'undefined' ? LightingPanel.exportSettings() : (level.lighting || {}),
            noEnemies: noEnemies };
    },
    isDirty() { return !!this.saved && JSON.stringify(this.snapshot()) !== this.saved; },
    async play() {
        const tab = window.open('about:blank', '_blank');
        try { await this.save(); if (tab) tab.location.href = '/index.html?directPlay=1&fps=1&map=' + encodeURIComponent(this.id); }
        catch (e) { tab?.close(); throw e; }
    },
    async save() {
        const level = this.snapshot();
        let savedJson = null;
        if (typeof ArcJobSystem !== 'undefined' && ArcJobSystem.stats?.backend === 'workers') {
            try {
                const res = await ArcJobSystem.dispatch('LEVEL_SERIALIZE', { levelData: level });
                if (res && res.json) savedJson = res.json;
            } catch (_) {}
        }
        await this.request('/save', { level });
        this.saved = savedJson || JSON.stringify(level); ObjectsPanel.saved = JSON.stringify(level.props); ObjectsPanel.renderHeader();
        Toast.show('Карта сохранена: ' + level.name); return level;
    },
    async load(id, initial = false) {
        if (!initial && this.isDirty() && !confirm('Переключить карту и отбросить несохранённые изменения?')) { /** @type {HTMLSelectElement} */ (document.getElementById('map-select')).value = this.id; return; }
        const { level } = await this.request('/load?id=' + encodeURIComponent(id));
        await this.apply(level);
        EditHistory.undoStack = []; EditHistory.redoStack = [];
        this.saved = JSON.stringify(this.snapshot());
        /** @type {HTMLSelectElement} */ (document.getElementById('map-select')).value = id;
        if (typeof localStorage !== 'undefined') localStorage.setItem('arc_editor_last_map', id);
    },
    async apply(level) {
        this.clearSelection();
        level = structuredClone(level);
        this.id = level.id;
        RaidLayer.env?.dispose();
        RaidLayer.districtMeshes = [];
        const loc = Lab.location;
        for (const rec of loc.objects.slice()) loc.removeObject(rec);
        loc.opts.level = level;
        const terrain = loc.buildTerrain(); await terrain.ready;
        Lab.camera.setTerrain(terrain, { w: loc.width, h: loc.height });
        if (level.spawn && Number.isFinite(level.spawn.x) && Number.isFinite(level.spawn.y)) {
            Lab.camera.lookAt(level.spawn.x, level.spawn.y);
        } else {
            Lab.camera.home();
        }
        RaidLayer.terrain = terrain; RaidLayer.levelData = level;
        RaidLayer.rubbleVisible = level.environment?.rubble !== false && level.rubble?.enabled !== false;
        RaidLayer.buildDistrictGeometry(); RaidLayer.build3DMarkers(); RaidLayer.setVisible(RaidLayer.visible);
        SceneView.buildGrid(); SceneView.setGridVisible(SceneView.gridVisible);
        if (typeof TerrainPanel !== 'undefined') TerrainPanel.updateDimensions?.();
        for (const def of level.props || []) ObjectsPanel.watch(loc.addObject(def));
        if (loc && typeof loc.applyLightingSettings === 'function') {
            const lState = loc.applyLightingSettings(level.lighting || {});
            if (RaidLayer.env && typeof RaidLayer.env.syncSky === 'function') {
                RaidLayer.env.syncSky(lState?.sunAz, lState?.nightFactor, lState?.sunEnabled !== false);
            }
        }
        if (typeof LightManager !== 'undefined') LightManager.importDefs(level.lights || []);
        if (typeof LightingPanel !== 'undefined') LightingPanel.importSettings(level.lighting || {});
        const noEnemiesCb = /** @type {HTMLInputElement} */ (document.getElementById('cb-no-enemies'));
        if (noEnemiesCb) noEnemiesCb.checked = !!(level.noEnemies || level.peaceful);
        MaterialEditor.init(loc.view.scene, terrain);
        if (level.ground) MaterialEditor.applyGroundConfig(level.ground);
        else MaterialEditor.applyPresetToTerrain(level.terrain?.preset === 'asphalt' ? 'asphalt' : 'mud');
        ObjectsPanel.saved = JSON.stringify(ObjectsPanel.defs()); ObjectsPanel.render();
        this.syncHierarchy();
    },
    syncHierarchy() {
        const doc = /** @type {any} */ (window).__arcSceneDoc;
        if (typeof SceneDoc !== 'undefined' && doc) {
            Object.assign(doc, SceneDoc.fromObjects(ObjectsPanel.defs(), RaidLayer.levelData.name));
            SceneView.setDocument(doc); HierarchyPanel.render(doc);
        }
    },
    addMarker() {
        const kind = /** @type {HTMLSelectElement} */ (document.getElementById('marker-kind')).value;
        const p = Lab.cameraTargetGround(), level = RaidLayer.levelData;
        if (kind === 'drive') level.drives.push({ id: 'drive_' + Date.now(), x: p.x, y: p.y, radius: 48 });
        else level[kind] = { x: p.x, y: p.y, ...(kind === 'spawn' ? { heading: 0 } : { radius: kind === 'extraction' ? 130 : 60 }) };
        this.clearSelection(); RaidLayer.build3DMarkers();
    },
    dialog(title, fields, accept = 'Применить') {
        return new Promise(resolve => {
            const dialog = document.createElement('dialog'); dialog.className = 'map-dialog';
            const form = document.createElement('form'); form.method = 'dialog';
            const heading = document.createElement('h2'); heading.textContent = title; form.append(heading);
            /** @type {Record<string, any>} */ const inputs = {};
            for (const f of fields) {
                const label = document.createElement('label'); label.textContent = f.label;
                const input = /** @type {any} */ (document.createElement(f.options ? 'select' : 'input'));  input.name = f.name;
                if (f.options) for (const [value, text] of f.options) { const opt = document.createElement('option'); opt.value = value; opt.textContent = text; input.append(opt); }
                else input.type = f.type || 'text';
                if (f.type === 'checkbox') input.checked = f.value !== false;
                else if (f.type === 'file') input.accept = '.png';
                else input.value = f.value ?? '';
                if (f.required) input.required = true;
                if (f.pattern) input.pattern = f.pattern;
                label.append(input); form.append(label); inputs[f.name] = input;
            }
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Отмена'; cancel.onclick = () => dialog.close();
            const ok = document.createElement('button'); ok.type = 'submit'; ok.textContent = accept;
            form.append(cancel, ok); dialog.append(form); document.body.append(dialog);
            let result = null;
            form.onsubmit = e => { e.preventDefault(); result = {}; for (const [name, input] of Object.entries(inputs)) result[name] = input.type === 'checkbox' ? input.checked : input.type === 'file' ? input.files[0] : input.value; dialog.close(); };
            dialog.onclose = () => { dialog.remove(); resolve(result); }; dialog.showModal();
        });
    },
    nameFields() { return [{ name: 'id', label: 'ID карты', required: true, pattern: '[a-zA-Z0-9][a-zA-Z0-9_\\-]{0,63}' }, { name: 'name', label: 'Название', required: true }]; },
    async newMap() {
        const fields = await this.dialog('Новая карта', [...this.nameFields(),
            { name: 'size', label: 'Размер', options: [['1024', '1024 × 1024'], ['2048', '2048 × 2048'], ['4096', '4096 × 4096'], ['8192', '8192 × 8192']] },
            { name: 'preset', label: 'Рельеф', options: [['flat', 'Плоскость'], ['hills', 'Холмы'], ['heightmap', 'Heightmap PNG']] },
            { name: 'image', label: 'Карта высот', type: 'file' },
            { name: 'skyline', label: 'Скайлайн', type: 'checkbox', value: false }, { name: 'roads', label: 'Дороги', type: 'checkbox', value: false },
            { name: 'noEnemies', label: 'Без врагов (Мирный режим)', type: 'checkbox', value: false }]);
        if (!fields) return;
        if (fields.preset === 'heightmap' && !fields.image) throw new Error('Выберите PNG карты высот');
        if (this.isDirty() && !confirm('Создать карту и отбросить несохранённые изменения?')) return;
        const size = Number(fields.size);
        const level = { id: fields.id, name: fields.name, dimensions: { width: size, height: size }, terrain: { preset: fields.preset, base: 0, noiseAmp: fields.preset === 'hills' ? 35 : 0, noiseScale: 900 },
            environment: { skyline: fields.skyline, roads: fields.roads, structures: false, rubble: false },
            spawn: { x: size / 2, y: size / 2, heading: 0 }, extraction: null, hatch: null, props: [], districtStructures: [], enemies: [], containers: [], drives: [],
            noEnemies: !!fields.noEnemies };
        if (fields.image) {
            // Prepare the field without replacing the current document until create succeeds.
            const t = new Terrain3D(Lab.location.view, { worldW: size, worldH: size, noise: { amp: 0 } });
            try { await t.setHeightmap(fields.image); Object.assign(level.terrain, { samples: Array.from(t.hgrid), nx: t.nx, ny: t.ny, cell: t.cell }); } finally { t.dispose(); }
        }
        await this.request('/create', { level }); await this.refresh(); await this.load(level.id, true);
    },
    async saveAs() {
        const values = await this.dialog('Сохранить карту как…', this.nameFields(), 'Сохранить'); if (!values) return;
        const level = { ...this.snapshot(), ...values };
        await this.request('/create', { level }); this.id = level.id; RaidLayer.levelData.name = level.name;
        this.saved = JSON.stringify(this.snapshot()); await this.refresh();
    },
    async deleteMap() {
        if (!confirm('Удалить карту «' + this.id + '» из пула? Резервная копия останется на диске.')) return;
        await this.request('/delete?id=' + encodeURIComponent(this.id), null, 'DELETE');
        await this.refresh(); await this.load('default_raid', true);
    },
    clearSelection() {
        for (const item of this.selectedObjects) { const m = item.mesh || item; if (m && !m.isDisposed?.()) m.showBoundingBox = false; }
        this.selectedObjects.clear(); ObjectsPanel.selected = null;
        RaidLayer.selectedEntityId = RaidLayer.selectedDistrictProp = RaidLayer.selectedRubbleMesh = null;
        if (typeof LightManager !== 'undefined') LightManager.select(null);
        ObjectsPanel.gizmo?.attachToMesh(null); SceneView.clearSelection?.();
    },
    select(item, additive = false) {
        if (!additive) this.clearSelection();
        if (item) {
            if (additive && this.selectedObjects.has(item)) this.selectedObjects.delete(item); else this.selectedObjects.add(item);
            const mesh = item.mesh || item; if (mesh) mesh.showBoundingBox = this.selectedObjects.has(item);
        }
        ObjectsPanel.renderList();
    },
    selectAll() {
        this.clearSelection();
        for (const item of [...Lab.location.objects, ...RaidLayer.entityMeshes.values(), ...(RaidLayer.env?.models || [])]) {
            if (item.isDisposed?.()) continue;
            this.selectedObjects.add(item); const mesh = item.mesh || item; if (mesh) mesh.showBoundingBox = true;
        }
        ObjectsPanel.renderList(); Toast.show('Выбрано: ' + this.selectedObjects.size);
    },
    removeSelection() {
        if (!this.selectedObjects.size && !(typeof LightManager !== 'undefined' && LightManager.selectedId)) return;
        const before = this.snapshot();
        if (typeof LightManager !== 'undefined' && LightManager.selectedId) {
            LightManager.removeLight(LightManager.selectedId);
        }
        for (const item of this.selectedObjects) {
            if (Lab.location.objects.includes(item)) Lab.location.removeObject(item);
            else if (item.entity) {
                for (const [id, rec] of RaidLayer.entityMeshes) if (rec === item) RaidLayer.deleteEntity(id);
            } else {
                const id = item.metadata?.environmentId;
                if (id) { RaidLayer.levelData.environmentDeleted ||= []; if (!RaidLayer.levelData.environmentDeleted.includes(id)) RaidLayer.levelData.environmentDeleted.push(id); }
                item.dispose();
            }
        }
        this.clearSelection(); ObjectsPanel.render(); this.syncHierarchy();
        const after = this.snapshot();
        EditHistory.record(null, () => this.run(() => this.apply(before)), () => this.run(() => this.apply(after)));
    },
    async clearDialog() {
        const choices = await this.dialog('Очистить карту', [
            { name: 'props', label: 'Удалить объекты и декорации', type: 'checkbox' },
            { name: 'markers', label: 'Удалить маркеры рейда', type: 'checkbox' },
            { name: 'lights', label: 'Удалить источники света', type: 'checkbox' },
            { name: 'structures', label: 'Удалить модульные строения', type: 'checkbox' },
            { name: 'environment', label: 'Отключить скайлайн, дороги и камни', type: 'checkbox' },
            { name: 'flat', label: 'Сбросить рельеф в плоскость', type: 'checkbox' }], 'Очистить');
        if (!choices) return;
        const before = this.snapshot(), level = structuredClone(before);
        if (choices.props) level.props = [];
        if (choices.markers) { level.enemies = []; level.containers = []; level.drives = []; level.spawn = level.extraction = level.hatch = null; }
        if (choices.lights) level.lights = [];
        if (choices.structures) { level.districtStructures = []; level.environment.structures = false; }
        if (choices.environment) { level.environment.skyline = level.environment.roads = level.environment.rubble = false; level.rubble = { enabled: false }; }
        if (choices.flat) level.terrain = { preset: 'flat', base: 0, noiseAmp: 0 };
        await this.apply(level);
        EditHistory.record(null, () => this.run(() => this.apply(before)), () => this.run(() => this.apply(level)));
    },
};
