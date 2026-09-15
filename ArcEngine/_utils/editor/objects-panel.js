// objects-panel.js — вкладка Objects: объекты локации (Objects.js) — список,
// свойства выбранного (и секция «Анимация» — вращение части модели), гизмо
// перемещения в виде, импорт FBX и сохранение.
//
// Записи живут в Location3D (location.objects: { def, mesh }): панель правит поля
// def и зовёт location.placeObject(rec); def.anim Location3D читает сам каждый кадр.
// Смена вида (kind) — пересборка объекта: группу материалов, контур и обводку
// World3D.addObject раздаёт при добавлении.
//
// Гизмо — BABYLON.GizmoManager (слой утилит поверх сцены). Он слушает указатель
// СЦЕНЫ, а View3D его отключает (detachControl) — редактор включает обратно.
// Нажатие на гизмо камера пропускает (camera.ignorePointer); клик без сдвига по
// объекту выбирает его. Сдвиг по X/Z держит высоту над землёй (объект идёт по
// рельефу), сдвиг по Y меняет h.
//
// Раскладка «грязная», когда JSON записей отличается от сохранённого (saved).
// Точность полей — как пишет сервер: позиция и курс до 0.1, масштаб до 0.001.

const ObjectsPanel = {
    lab: null,
    selected: null,     // запись location.objects
    saved: '[]',        // JSON раскладки на момент загрузки или сохранения
    gizmo: null,
    propEls: null,      // поля свойств выбранного: { pos: { x, y, h }, rot, scale }
    _down: null,        // точка нажатия ЛКМ: клик без сдвига выбирает объект
    _importing: false,

    // Копия LOCATION_OBJECTS — стартовые записи Location3D редактора и база «грязной»
    // раскладки. Старые записи (rot — число-курс, scale — число) приводятся к тройкам.
    initialObjects() {
        const list = (typeof LOCATION_OBJECTS !== 'undefined' && Array.isArray(LOCATION_OBJECTS)) ? LOCATION_OBJECTS : [];
        const defs = JSON.parse(JSON.stringify(list)).map((d) => Object.assign(d, {
            rot: Array.isArray(d.rot) ? d.rot : [0, Number(d.rot) || 0, 0],
            scale: Array.isArray(d.scale) ? d.scale : [1, 1, 1].map(() => (Number(d.scale) > 0 ? Number(d.scale) : 1)),
        }));
        this.saved = JSON.stringify(defs);
        return defs;
    },

    init(lab) {
        this.lab = lab;
        const scene = lab.location.view.scene;
        scene.attachControl(true, true, true);
        this.gizmo = new BABYLON.GizmoManager(scene);
        this.gizmo.usePointerToAttachGizmos = false;
        this.setupGizmos();
        this.setGizmoMode('move');
        this.gizmo.attachToMesh(null);
        lab.camera.ignorePointer = (e) => this.gizmoHit(e);
        for (const btn of document.querySelectorAll('#gizmo-modes [data-gizmo]')) {
            btn.addEventListener('click', () => this.setGizmoMode(btn.dataset.gizmo));
        }

        lab.canvas.addEventListener('pointerdown', (e) => {
            this._down = (e.button === 0 && !this.gizmoHit(e)) ? { x: e.clientX, y: e.clientY } : null;
        });
        lab.canvas.addEventListener('pointerup', (e) => this.onClick(e));

        document.getElementById('btn-import').addEventListener('click', () => this.importModel());
        document.getElementById('btn-objects-save').addEventListener('click', () => this.save());
        document.getElementById('btn-objects-revert').addEventListener('click', () => this.revert());
        window.addEventListener('keydown', (e) => this.onKey(e));
        window.addEventListener('lang-changed', () => this.render());

        for (const rec of lab.location.objects) this.watch(rec);
        this.render();
    },

    // --- Выбор ------------------------------------------------------------------

    select(rec, fromView) {
        this.selected = rec && this.lab.location.objects.includes(rec) ? rec : null;
        this.gizmo.attachToMesh(this.selected && this.selected.mesh ? this.selected.mesh : null);
        if (fromView && this.selected) PaneTabs.show('objects');
        this.render();
    },

    // Клик без сдвига: объект под курсором или пусто (снять выбор).
    onClick(e) {
        const d = this._down;
        this._down = null;
        if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
        const r = this.lab.canvas.getBoundingClientRect();
        const hit = this.lab.location.view.scene.pick(e.clientX - r.left, e.clientY - r.top, (m) => !!this.recOf(m));
        this.select(hit && hit.hit ? this.recOf(hit.pickedMesh) : null, true);
    },

    recOf(mesh) {
        for (let n = mesh; n; n = n.parent) {
            if (n.metadata && n.metadata.locationObject) return n.metadata.locationObject;
        }
        return null;
    },

    // Модель догрузилась (или нет): гизмо на выбранный, отметка ошибки в списке.
    watch(rec) {
        rec.loaded.then(() => {
            if (rec === this.selected) {
                this.gizmo.attachToMesh(rec.mesh);
                this.renderProps();   // части модели для секции «Анимация»
            }
            if (rec.error) Toast.show(I18N.t('toast.modelFailed', { url: rec.def.model, msg: rec.error }), true);
            this.renderList();
        });
    },

    // --- Гизмо ------------------------------------------------------------------
    //
    // Линии стандартной толщины, цвета плоские, без света: иначе материалы гизмо
    // квантует toon-плагин набора (он вешается на каждый StandardMaterial).
    // Перемещение — оси и квадрат по земле, поворот — кольца X/Y/Z, масштаб — по
    // осям, центр — равномерно. Оси мира: X — вправо по карте, Z — вниз, Y — вверх.
    setupGizmos() {
        const gm = this.gizmo, C = (hex) => BABYLON.Color3.FromHexString(hex);
        const colors = { x: C('#f0525f'), y: C('#62d26f'), z: C('#4a90f0') }, hover = C('#ffd24a');
        const paint = (g, color) => {
            for (const [mat, c] of [[g.coloredMaterial, color], [g.hoverMaterial, hover]]) {
                if (!mat) continue;
                mat.disableLighting = true;
                mat.emissiveColor = c;
                mat.diffuseColor = BABYLON.Color3.Black();
                mat.specularColor = BABYLON.Color3.Black();
            }
        };
        gm.positionGizmoEnabled = true;
        gm.rotationGizmoEnabled = true;
        gm.scaleGizmoEnabled = true;
        const pg = gm.gizmos.positionGizmo, rg = gm.gizmos.rotationGizmo, sg = gm.gizmos.scaleGizmo;
        pg.planarGizmoEnabled = true;
        pg.xPlaneGizmo.isEnabled = false;
        pg.zPlaneGizmo.isEnabled = false;
        for (const g of [pg, rg, sg]) g.updateGizmoRotationToMatchAttachedMesh = false;
        for (const axis of ['x', 'y', 'z']) {
            paint(pg[axis + 'Gizmo'], colors[axis]);
            paint(rg[axis + 'Gizmo'], colors[axis]);
            paint(sg[axis + 'Gizmo'], colors[axis]);
        }
        paint(pg.yPlaneGizmo, colors.y);
        paint(sg.uniformScaleGizmo, C('#e8ecf1'));

        const track = (g, onDrag) => {
            g.dragBehavior.onDragStartObservable.add(() => { this._dragBefore = this.snapshot(); });
            g.dragBehavior.onDragObservable.add(onDrag);
            g.dragBehavior.onDragEndObservable.add(() => this.onGizmoDragEnd());
        };
        for (const g of [pg.xGizmo, pg.zGizmo, pg.yPlaneGizmo]) track(g, () => this.onMoveDrag(false));
        track(pg.yGizmo, () => this.onMoveDrag(true));
        for (const g of [rg.xGizmo, rg.yGizmo, rg.zGizmo]) track(g, () => this.onRotateDrag());
        for (const g of [sg.xGizmo, sg.yGizmo, sg.zGizmo, sg.uniformScaleGizmo]) track(g, () => this.onScaleDrag());
    },

    // Под указателем ручка гизмо? isHovered обновляется только движением мыши —
    // касание и быстрый клик приходят без него, поэтому ещё и прямой пик слоя утилит.
    gizmoHit(e) {
        if (this.gizmo.isHovered) return true;
        const layer = this.gizmo.utilityLayer;
        if (!layer || !this.gizmo.attachedMesh) return false;
        const r = this.lab.canvas.getBoundingClientRect();
        const hit = layer.utilityLayerScene.pick(e.clientX - r.left, e.clientY - r.top,
            (m) => m.isPickable && m.isEnabled(), false, this.lab.location.view.camera);
        return !!(hit && hit.hit);
    },

    setGizmoMode(mode) {
        this.gizmoMode = ['move', 'rotate', 'scale'].includes(mode) ? mode : 'move';
        this.gizmo.positionGizmoEnabled = this.gizmoMode === 'move';
        this.gizmo.rotationGizmoEnabled = this.gizmoMode === 'rotate';
        this.gizmo.scaleGizmoEnabled = this.gizmoMode === 'scale';
        for (const btn of document.querySelectorAll('#gizmo-modes [data-gizmo]')) {
            btn.classList.toggle('active', btn.dataset.gizmo === this.gizmoMode);
        }
    },

    // Сдвиг: по X/Z и по земле высота над землёй прежняя (объект идёт по рельефу); по Y — меняется h.
    onMoveDrag(vertical) {
        const rec = this.selected;
        if (!rec || !rec.mesh) return;
        const p = rec.mesh.position, d = rec.def, t = this.lab.location.terrain;
        const ground = t ? t.heightAt(p.x, p.z) : 0;
        d.x = this.round(p.x, 1);
        d.y = this.round(p.z, 1);
        if (vertical) d.h = this.round(p.y - ground, 1);
        else p.y = ground + (Number(d.h) || 0);
        this.syncProps();
        this.renderHeader();
    },

    // Кольца поворачивают меш (rotation, а если задан — rotationQuaternion); углы —
    // в rot [x, y, z] градусами, y со знаком курса (rotation.y = −y).
    onRotateDrag() {
        const rec = this.selected, m = rec && rec.mesh;
        if (!m) return;
        const e = m.rotationQuaternion ? m.rotationQuaternion.toEulerAngles() : m.rotation;
        const deg = (v) => this.round(((v * 180 / Math.PI + 180) % 360 + 360) % 360 - 180, 1);
        rec.def.rot = [deg(e.x), deg(-e.y), deg(e.z)];
        this.syncProps();
        this.renderHeader();
    },

    onScaleDrag() {
        const rec = this.selected, m = rec && rec.mesh;
        if (!m) return;
        rec.def.scale = [m.scaling.x, m.scaling.y, m.scaling.z].map(v => Math.max(0.001, this.round(v, 3)));
        this.syncProps();
        this.renderHeader();
    },

    // Отпустили: меш — строго по def (округлённые числа, Euler вместо кватерниона гизмо), шаг — в историю.
    onGizmoDragEnd() {
        if (this.selected) this.lab.location.placeObject(this.selected);
        this.syncProps();
        if (this._dragBefore) this.commit(null, this._dragBefore);
        this._dragBefore = null;
    },

    // --- История (history.js) ------------------------------------------------------
    //
    // Шаг — пара снимков раскладки до и после: { defs: JSON записей, selected: индекс }.
    // Тот же набор моделей и видов — поля записей правятся на месте (без пересборки
    // мешей), иначе объекты пересобираются.

    snapshot() {
        return { defs: JSON.stringify(this.defs()), selected: this.lab.location.objects.indexOf(this.selected) };
    },

    commit(key, before) {
        const after = this.snapshot();
        if (after.defs !== before.defs) History.record(key, () => this.restore(before), () => this.restore(after));
        this.renderHeader();
    },

    restore(snap) {
        const loc = this.lab.location, defs = JSON.parse(snap.defs);
        const same = defs.length === loc.objects.length &&
            defs.every((d, i) => d.model === loc.objects[i].def.model && d.kind === loc.objects[i].def.kind);
        if (same) {
            defs.forEach((d, i) => {
                const rec = loc.objects[i];
                for (const k of Object.keys(rec.def)) delete rec.def[k];
                Object.assign(rec.def, d);
                loc.placeObject(rec);
            });
        } else {
            this.gizmo.attachToMesh(null);
            for (const rec of loc.objects.slice()) loc.removeObject(rec);
            for (const d of defs) this.watch(loc.addObject(d));
        }
        this.select(loc.objects[snap.selected] || null);
    },

    // --- Правка -----------------------------------------------------------------

    addObject(def) {
        const before = this.snapshot();
        const rec = this.lab.location.addObject(def);
        this.watch(rec);
        this.select(rec);
        this.commit(null, before);
        return rec;
    },

    removeSelected() {
        const rec = this.selected;
        if (!rec) return;
        const before = this.snapshot();
        this.gizmo.attachToMesh(null);
        this.lab.location.removeObject(rec);
        this.select(null);
        this.commit(null, before);
    },

    duplicateSelected() {
        const d = this.selected && this.selected.def;
        if (!d) return;
        const copy = JSON.parse(JSON.stringify(d));   // rot и scale — массивы: копия, не ссылка
        this.addObject(Object.assign(copy, { name: this.uniqueName(d.name), x: this.round(d.x + 40, 1), y: this.round(d.y + 40, 1) }));
    },

    focusSelected() {
        const d = this.selected && this.selected.def;
        if (!d) return;
        this.lab.camera.followObj = null;
        this.lab.camera.lookAt(Number(d.x) || 0, Number(d.y) || 0);
    },

    // Вид объекта раздаётся при добавлении в сцену — объект пересобирается на своём месте в списке.
    setKind(kind) {
        const rec = this.selected;
        if (!rec || rec.def.kind === kind) return;
        const loc = this.lab.location, at = loc.objects.indexOf(rec), before = this.snapshot();
        this.gizmo.attachToMesh(null);
        loc.removeObject(rec);
        const fresh = loc.addObject(Object.assign(JSON.parse(JSON.stringify(rec.def)), { kind }));
        loc.objects.splice(loc.objects.indexOf(fresh), 1);
        loc.objects.splice(at, 0, fresh);
        this.watch(fresh);
        this.select(fresh);
        this.commit(null, before);
    },

    // Поле выбранного; правки одного поля подряд склеиваются в один шаг истории.
    setField(key, value) {
        const rec = this.selected;
        if (!rec) return;
        const before = this.snapshot();
        rec.def[key] = value;
        this.lab.location.placeObject(rec);
        this.commit('field:' + before.selected + ':' + key, before);
    },

    // Анимация выбранного целиком ({ part, axis, speed, dir }); null — снять.
    setAnim(anim) {
        const rec = this.selected;
        if (!rec) return;
        const before = this.snapshot();
        if (anim) rec.def.anim = anim;
        else delete rec.def.anim;
        this.commit('field:' + before.selected + ':anim', before);
    },

    // Ось по умолчанию: самая тонкая сторона части (крылья, колесо, винт), конец оси —
    // наружу от центра модели, чтобы «по часовой» было таким, как видно снаружи.
    // Координаты — файла модели: в них лежат вершины частей, pivot и axes (Model3D).
    guessAxis(rec, name) {
        const parts = rec.mesh ? rec.mesh.getChildMeshes(true) : [];
        const mesh = parts.find(m => m.metadata && m.metadata.part === name);
        const md = mesh && mesh.metadata, pos = mesh && mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        if (!md || !md.axes || !pos) return 'y';
        const p = md.pivot, along = (v, x, y, z) => (x - p[0]) * v[0] + (y - p[1]) * v[1] + (z - p[2]) * v[2];
        let best = 'y', span = Infinity;
        for (const k of ['x', 'y', 'z']) {
            let lo = Infinity, hi = -Infinity;
            for (let i = 0; i < pos.length; i += 3) {
                const t = along(md.axes[k], pos[i], pos[i + 1], pos[i + 2]);
                if (t < lo) lo = t;
                if (t > hi) hi = t;
            }
            if (hi - lo < span) { span = hi - lo; best = k; }
        }
        const lo = new BABYLON.Vector3(Infinity, Infinity, Infinity), hi = lo.negate();
        for (const m of parts) {
            const b = m.getBoundingInfo().boundingBox;
            lo.minimizeInPlace(b.minimum);
            hi.maximizeInPlace(b.maximum);
        }
        const c = lo.add(hi).scale(0.5);
        return (along(md.axes[best], c.x, c.y, c.z) > 0 ? '-' : '') + best;
    },

    uniqueName(base) {
        const names = new Set(this.lab.location.objects.map(r => r.def.name));
        const stem = String(base || 'model').replace(/-\d+$/, '');
        if (!names.has(stem)) return stem;
        for (let i = 2; ; i++) if (!names.has(stem + '-' + i)) return stem + '-' + i;
    },

    onKey(e) {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { this.save(); return; }   // default гасит инспектор
        const t = e.target;
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        const mode = { Digit1: 'move', Digit2: 'rotate', Digit3: 'scale' }[e.code];
        if (mode && !e.ctrlKey && !e.metaKey && !e.altKey) { this.setGizmoMode(mode); return; }
        if (!this.selected) return;
        if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.removeSelected(); }
        else if (e.code === 'Escape') this.select(null);
        else if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) this.focusSelected();
        else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); }
    },

    // --- Файл: импорт, сохранение, откат -------------------------------------------

    defs() {
        return this.lab.location.objects.map(r => r.def);
    },

    isDirty() {
        return JSON.stringify(this.defs()) !== this.saved;
    },

    async post(url, body) {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return r.json();
    },

    // Системный диалог сервера открывается в assets/models; где его нет — выбор файла браузером.
    async importModel() {
        if (this._importing) return;
        if (!Inspector.saveAvailable) { Toast.show(I18N.t('toast.noSave'), true); return; }
        this._importing = true;
        this.renderHeader();
        try {
            let res = await this.post('/api/pick-model', { title: I18N.t('obj.dialogTitle') });
            if (res.code === 'unsupported') res = await this.uploadModel();
            if (!res || res.code === 'cancelled') return;
            if (!res.ok) throw new Error(Inspector.errorText(res));
            const t = this.lab.camera.target;
            this.addObject({ name: this.uniqueName(res.name), model: res.path, kind: 'prop',
                x: this.round(t.x, 1), y: this.round(t.y, 1), h: 0, rot: [0, 0, 0], scale: [1, 1, 1] });
            PaneTabs.show('objects');
            Toast.show(I18N.t(res.copied ? 'toast.importCopied' : 'toast.imported', { path: res.path }));
        } catch (e) {
            Toast.show(I18N.t('toast.importError', { msg: e.message }), true);
        } finally {
            this._importing = false;
            this.renderHeader();
        }
    },

    uploadModel() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.fbx';
            input.addEventListener('cancel', () => resolve({ ok: false, code: 'cancelled' }));
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (!file) { resolve({ ok: false, code: 'cancelled' }); return; }
                fetch('/api/import-model?name=' + encodeURIComponent(file.name), { method: 'POST', body: file })
                    .then(r => r.json()).then(resolve, reject);
            });
            input.click();
        });
    },

    async save() {
        if (!this.isDirty()) return;
        if (!Inspector.saveAvailable) { Toast.show(I18N.t('toast.noSave'), true); return; }
        const objects = this.defs();
        try {
            const j = await this.post('/api/save-objects', { objects });
            if (!j.ok) throw new Error(Inspector.errorText(j) + (j.index != null ? ' — #' + (j.index + 1) : ''));
            this.saved = JSON.stringify(objects);
            this.renderHeader();
            Toast.show(I18N.t('toast.objSaved', { n: j.count, backup: j.backup || '—' }));
        } catch (e) {
            Toast.show(I18N.t('toast.objSaveError', { msg: e.message }), true);
        }
    },

    revert() {
        const before = this.snapshot();
        this.restore({ defs: this.saved, selected: -1 });
        this.commit(null, before);
        Toast.show(I18N.t('toast.objReverted'));
    },

    // --- DOM ----------------------------------------------------------------------

    render() {
        this.renderHeader();
        this.renderList();
        this.renderProps();
    },

    renderHeader() {
        const dirty = this.isDirty();
        document.getElementById('btn-objects-save').disabled = !dirty;
        document.getElementById('btn-objects-revert').disabled = !dirty;
        const imp = document.getElementById('btn-import');
        imp.disabled = this._importing;
        imp.textContent = I18N.t(this._importing ? 'obj.importing' : 'obj.import');
        const tab = document.querySelector('#pane-tabs [data-tab="objects"]');
        if (tab) tab.classList.toggle('dirty', dirty);
    },

    renderList() {
        const host = document.getElementById('objects-list');
        host.innerHTML = '';
        const list = this.lab.location.objects;
        if (!list.length) {
            host.appendChild(this.el('div', 'objects-empty', I18N.t('obj.empty')));
            return;
        }
        for (const rec of list) {
            const row = this.el('div', 'object-row' + (rec === this.selected ? ' selected' : '') + (rec.error ? ' broken' : ''));
            row.append(
                this.el('span', 'object-name', rec.def.name || '—'),
                this.el('span', 'object-file', rec.error ? '⚠ ' + I18N.t('obj.missing') : rec.def.model.split('/').pop()));
            row.title = rec.error ? rec.def.model + ' — ' + rec.error : rec.def.model;
            row.addEventListener('click', () => this.select(rec));
            row.addEventListener('dblclick', () => this.focusSelected());
            host.appendChild(row);
        }
    },

    renderProps() {
        const host = document.getElementById('object-props');
        host.innerHTML = '';
        this.propEls = null;
        const rec = this.selected;
        if (!rec) {
            if (this.lab.location.objects.length) host.appendChild(this.el('div', 'objects-empty', I18N.t('obj.noSelection')));
            return;
        }
        const d = rec.def, els = this.propEls = {};

        const name = this.input('text', d.name);
        name.maxLength = 64;
        name.addEventListener('input', () => { this.setField('name', name.value); this.renderList(); });
        host.appendChild(this.row('obj.name', null, name));

        host.appendChild(this.row('obj.model', null, this.el('code', 'object-model', d.model)));

        const kind = this.choice([['prop', I18N.t('obj.kindProp')], ['actor', I18N.t('obj.kindActor')]], d.kind === 'actor' ? 'actor' : 'prop');
        kind.addEventListener('change', () => this.setKind(kind.value));
        host.appendChild(this.row('obj.kind', 'obj.kindHint', kind));

        const posKeys = ['x', 'y', 'h'];
        els.pos = this.vector(['X', 'Y', 'H'], 10, (i) => d[posKeys[i]], (i, v) => this.setField(posKeys[i], this.round(v, 1)));
        host.appendChild(this.row('obj.position', 'obj.positionHint', ...els.pos.parts));

        const setTriple = (key, i, v) => { const t = d[key].slice(); t[i] = v; this.setField(key, t); };
        els.rot = this.vector(['X', 'Y', 'Z'], 5, (i) => d.rot[i], (i, v) => setTriple('rot', i, this.round(v, 1)));
        host.appendChild(this.row('obj.rot', 'obj.rotHint', ...els.rot.parts));

        els.scale = this.vector(['X', 'Y', 'Z'], 0.1, (i) => d.scale[i], (i, v) => { if (v > 0) setTriple('scale', i, this.round(v, 3)); });
        host.appendChild(this.row('obj.scale', 'obj.scaleHint', ...els.scale.parts));

        this.renderAnim(host, rec);

        const actions = this.el('div', 'object-actions');
        for (const [key, fn, cls] of [['obj.focus', () => this.focusSelected()], ['obj.duplicate', () => this.duplicateSelected()],
            ['obj.delete', () => this.removeSelected(), 'danger']]) {
            const btn = this.el('button', cls || '', I18N.t(key));
            btn.addEventListener('click', fn);
            actions.appendChild(btn);
        }
        host.appendChild(actions);
    },

    // Секция «Анимация»: часть модели (объект FBX) и её вращение — ось, об/мин, направление.
    // Модель не догрузилась — частей в списке нет, но сохранённая часть остаётся выбранной.
    renderAnim(host, rec) {
        const a = rec.def.anim;
        host.appendChild(this.el('div', 'props-section', I18N.t('obj.anim')));
        const names = rec.mesh ? rec.mesh.getChildMeshes(true).map(m => m.metadata && m.metadata.part).filter(Boolean) : [];
        if (a && !names.includes(a.part)) names.push(a.part);
        const part = this.choice([['', I18N.t('obj.animNone')]].concat(names.map(n => [n, n])), a ? a.part : '');
        part.addEventListener('change', () => {
            const cur = rec.def.anim;
            this.setAnim(part.value ? { part: part.value, axis: this.guessAxis(rec, part.value),
                speed: cur ? cur.speed : 10, dir: cur ? cur.dir : 'cw' } : null);
            this.renderProps();
        });
        host.appendChild(this.row('obj.animPart', 'obj.animPartHint', part));
        if (!a) return;

        const edit = (key, value) => this.setAnim(Object.assign({}, rec.def.anim, { [key]: value }));
        const axis = this.choice(['x', '-x', 'y', '-y', 'z', '-z'].map(k => [k, (k[0] === '-' ? '−' : '+') + k.slice(-1).toUpperCase()]), a.axis);
        axis.addEventListener('change', () => edit('axis', axis.value));
        host.appendChild(this.row('obj.animAxis', 'obj.animAxisHint', axis));

        const speed = this.input('number', this.fmt(a.speed));
        speed.min = 0;
        speed.step = 1;
        speed.addEventListener('input', () => {
            const v = Number(speed.value);
            if (speed.value !== '' && Number.isFinite(v) && v >= 0) edit('speed', this.round(v, 1));
        });
        speed.addEventListener('blur', () => { if (rec.def.anim) speed.value = this.fmt(rec.def.anim.speed); });
        host.appendChild(this.row('obj.animSpeed', 'obj.animSpeedHint', speed));

        const dir = this.choice([['cw', I18N.t('obj.animCw')], ['ccw', I18N.t('obj.animCcw')]], a.dir === 'ccw' ? 'ccw' : 'cw');
        dir.addEventListener('change', () => edit('dir', dir.value));
        host.appendChild(this.row('obj.animDir', 'obj.animDirHint', dir));
    },

    // Поля выбранного догоняют def (гизмо двигает объект); поле с фокусом не трогаем.
    syncProps() {
        const els = this.propEls, rec = this.selected;
        if (!els || !rec) return;
        const d = rec.def, values = { pos: [d.x, d.y, d.h], rot: d.rot, scale: d.scale };
        for (const key of ['pos', 'rot', 'scale']) {
            els[key].inputs.forEach((num, i) => { if (document.activeElement !== num) num.value = this.fmt(values[key][i]); });
        }
    },

    // Три числовых поля с подписями осей: get(i) — значение, set(i, v) — правка.
    vector(labels, step, get, set) {
        const inputs = [], parts = [];
        labels.forEach((label, i) => {
            const num = this.input('number', this.fmt(get(i)));
            num.step = step;
            num.addEventListener('input', () => {
                const v = Number(num.value);
                if (num.value !== '' && Number.isFinite(v)) set(i, v);
            });
            num.addEventListener('blur', () => { num.value = this.fmt(get(i)); });
            inputs.push(num);
            parts.push(this.el('span', 'axis-label', label), num);
        });
        return { inputs, parts };
    },

    // Строка свойства в стиле инспектора: подпись (+ подсказка) и контролы.
    row(labelKey, hintKey, ...controls) {
        const row = this.el('div', 'field');
        if (hintKey) row.title = I18N.t(hintKey);
        const head = this.el('div', 'field-head');
        head.appendChild(this.el('label', '', I18N.t(labelKey)));
        const box = this.el('div', 'field-controls');
        box.append(...controls);
        row.append(head, box);
        return row;
    },

    input(type, value) {
        const el = document.createElement('input');
        el.type = type;
        el.value = value == null ? '' : value;
        return el;
    },

    // <select> из пар [значение, подпись].
    choice(options, value) {
        const sel = document.createElement('select');
        for (const [v, label] of options) {
            const opt = this.el('option', '', label);
            opt.value = v;
            sel.appendChild(opt);
        }
        sel.value = value;
        return sel;
    },

    el(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text != null) el.textContent = text;
        return el;
    },

    round(v, digits) {
        const k = Math.pow(10, digits);
        return Math.round(Number(v) * k) / k;
    },

    fmt(v) {
        return Number.isFinite(Number(v)) ? String(Number(v)) : '';
    },
};

// Вкладки правой панели: Global Settings (Constants.js) и Objects (Objects.js).
// Открытая вкладка запоминается в localStorage.
const PaneTabs = {
    KEY: 'arcengine.editor.tab',

    init() {
        for (const btn of document.querySelectorAll('#pane-tabs [data-tab]')) {
            btn.addEventListener('click', () => this.show(btn.dataset.tab));
        }
        let saved = null;
        try { saved = localStorage.getItem(this.KEY); } catch (e) { /* хранилище закрыто */ }
        this.show(saved === 'objects' ? 'objects' : 'settings');
    },

    show(tab) {
        for (const btn of document.querySelectorAll('#pane-tabs [data-tab]')) btn.classList.toggle('active', btn.dataset.tab === tab);
        for (const panel of document.querySelectorAll('.pane-panel')) panel.hidden = panel.dataset.tab !== tab;
        try { localStorage.setItem(this.KEY, tab); } catch (e) { /* выбор проживёт до F5 */ }
    },
};
