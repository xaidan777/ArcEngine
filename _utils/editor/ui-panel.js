// ui-panel.js — the UI tab: the game's UI layout (js/UILayout.js), edited over the view.
//
// The HUD is drawn over the editor's view by the game's own UI.js from a COPY of UI_LAYOUT.
// With the UI tab open (UI.editing) every element catches the pointer: drag moves it, the
// handles of the selection box resize it (a text sizes itself), arrows nudge by 1 px (Shift —
// 10). The fields of the selected element are UI.DEFAULTS[kind] — a new field in UI.js shows up
// here after a row in UIPanel.FIELDS. Changing the anchor keeps the element where it stands
// (UI.toStored). "Save to UILayout.js" — POST /api/save-ui, the file is written whole.
// A step of history — layout snapshots before/after, like the Objects tab.

/** @satisfies {Record<string, any>} */
const UIPanel = {
    /** @type {UIRecord[]} */
    layout: [],
    saved: '[]',             // layout JSON as of load or save
    /** @type {UIRecord | null} */
    selected: null,
    /** @type {HTMLElement | null} */
    box: null,               // the selection box with the resize handles, lives inside UI.root
    /** @type {any} */
    drag: null,
    /** @type {Record<string, HTMLInputElement> | null} */
    propEls: null,

    // Editors of the record fields, in panel order. type: num | text | color | flag.
    FIELDS: [
        ['x', 'num'], ['y', 'num'], ['w', 'num'], ['h', 'num'], ['text', 'text'], ['fontSize', 'num'], ['value', 'unit'],
        ['color', 'color'], ['shadow', 'color'], ['fill', 'color'], ['border', 'color'], ['radius', 'num'], ['alpha', 'unit'], ['visible', 'flag'],
    ],
    HANDLES: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
    MIN_SIZE: 8,

    init(canvas) {
        this.layout = JSON.parse(JSON.stringify(typeof UI_LAYOUT !== 'undefined' ? UI_LAYOUT : []));
        this.saved = JSON.stringify(this.layout);
        UI.init(canvas, this.layout);

        const box = this.box = document.createElement('div');
        box.className = 'ui-select-box';
        for (const h of this.HANDLES) {
            const dot = document.createElement('div');
            dot.className = 'ui-handle';
            dot.dataset.handle = h;
            box.appendChild(dot);
        }

        const header = document.getElementById('ui-add');
        for (const kind of UI.KINDS) {
            const btn = document.createElement('button');
            btn.dataset.kind = kind;
            btn.addEventListener('click', () => this.addElement(kind));
            header.appendChild(btn);
        }
        document.getElementById('btn-ui-save').addEventListener('click', () => this.save());
        document.getElementById('btn-ui-revert').addEventListener('click', () => this.revert());
        const show = /** @type {HTMLInputElement} */ (document.getElementById('opt-ui'));
        show.addEventListener('change', () => this.refresh());

        window.addEventListener('pointermove', (e) => this.onDragMove(e));
        window.addEventListener('pointerup', () => this.onDragEnd());
        window.addEventListener('keydown', (e) => this.onKey(e), true);   // before the camera: arrows nudge, not fly
        window.addEventListener('pane-tab', () => this.refresh());
        window.addEventListener('lang-changed', () => this.render());
        this.refresh();
        this.render();
    },

    active() {
        return PaneTabs.current === 'ui';
    },

    // Records -> DOM of the HUD, edit mode by the open tab, the selection box back on top.
    refresh() {
        UI.editing = this.active();
        const show = /** @type {HTMLInputElement} */ (document.getElementById('opt-ui'));
        UI.applyLayout();
        UI.root.style.display = show.checked || UI.editing ? '' : 'none';
        UI.root.onpointerdown = (e) => this.onPointerDown(e);
        UI.root.appendChild(this.box);
        this.updateBox();
    },

    // --- Geometry ------------------------------------------------------------------

    // The element's rectangle in layout px: { left, top, w, h }.
    rect(def) {
        const e = UI.get(def.id), s = UI.size();
        const w = e ? e.el.offsetWidth : Number(def.w) || 0, h = e ? e.el.offsetHeight : Number(def.h) || 0;
        const p = UI.resolve(def, w, h, s.w, s.h);
        return { left: p.left, top: p.top, w, h };
    },

    // A rectangle -> the record's x, y (and w, h for a sized kind), whole px.
    place(def, r) {
        const s = UI.size(), p = UI.toStored(def.anchor, r.left, r.top, r.w, r.h, s.w, s.h);
        def.x = Math.round(p.x);
        def.y = Math.round(p.y);
        if (def.kind !== 'text') {
            def.w = Math.round(r.w);
            def.h = Math.round(r.h);
        }
    },

    updateBox() {
        const d = this.selected, b = this.box;
        const on = !!d && this.active() && !!UI.get(d.id);
        b.style.display = on ? 'block' : 'none';
        if (!on) return;
        const r = this.rect(d);
        Object.assign(b.style, { left: r.left + 'px', top: r.top + 'px', width: r.w + 'px', height: r.h + 'px' });
        b.classList.toggle('no-resize', d.kind === 'text');
        // Handles keep their screen size whatever the UI scale is.
        b.style.setProperty('--ui-inv', String(1 / UI.scale()));
    },

    // --- Pointer: select, move, resize -----------------------------------------------

    onPointerDown(e) {
        if (!this.active() || e.button !== 0) return;
        const t = /** @type {HTMLElement} */ (e.target);
        const handle = t.dataset && t.dataset.handle;
        const host = /** @type {HTMLElement | null} */ (t.closest('[data-ui]'));
        const def = handle ? this.selected : host ? this.layout.find(d => d.id === host.dataset.ui) : null;
        if (!def) return;
        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        this.select(def);
        this.drag = { def, handle: handle || '', x: e.clientX, y: e.clientY, rect: this.rect(def), before: this.snapshot() };
    },

    onDragMove(e) {
        const g = this.drag;
        if (!g) return;
        const k = 1 / UI.scale(), dx = (e.clientX - g.x) * k, dy = (e.clientY - g.y) * k;
        const r = Object.assign({}, g.rect), h = g.handle, min = this.MIN_SIZE;
        if (!h) {
            r.left += dx;
            r.top += dy;
        } else {
            if (h.includes('e')) r.w = Math.max(min, g.rect.w + dx);
            if (h.includes('s')) r.h = Math.max(min, g.rect.h + dy);
            if (h.includes('w')) { r.w = Math.max(min, g.rect.w - dx); r.left = g.rect.left + g.rect.w - r.w; }
            if (h.includes('n')) { r.h = Math.max(min, g.rect.h - dy); r.top = g.rect.top + g.rect.h - r.h; }
        }
        this.place(g.def, r);
        UI.get(g.def.id).apply();
        this.updateBox();
        this.syncProps();
    },

    onDragEnd() {
        const g = this.drag;
        if (!g) return;
        this.drag = null;
        this.commit(null, g.before);
    },

    onKey(e) {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { this.save(); return; }   // the default is suppressed by the inspector
        if (!this.active()) return;
        const t = /** @type {HTMLElement} */ (e.target);
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        const d = this.selected;
        if (!d) return;
        const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
        let handled = true;
        if (step) {
            const before = this.snapshot(), r = this.rect(d), k = e.shiftKey ? 10 : 1;
            r.left += step[0] * k;
            r.top += step[1] * k;
            this.place(d, r);
            this.afterEdit('nudge:' + d.id, before);
        } else if (e.code === 'Delete' || e.code === 'Backspace') this.removeSelected();
        else if (e.code === 'Escape') this.select(null);
        else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') this.duplicateSelected();
        else handled = false;
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    },

    // --- Edits -----------------------------------------------------------------------

    select(def) {
        if (this.selected === def) return;
        this.selected = def || null;
        this.renderList();
        this.renderProps();
        this.updateBox();
    },

    uniqueId(base) {
        const ids = new Set(this.layout.map(d => d.id)), stem = String(base).replace(/\d+$/, '') || 'element';
        if (!ids.has(stem)) return stem;
        for (let i = 2; ; i++) if (!ids.has(stem + i)) return stem + i;
    },

    addElement(kind) {
        const before = this.snapshot();
        /** @type {UIRecord} */
        const def = Object.assign({ id: this.uniqueId(kind), kind }, UI.DEFAULTS[kind]);
        // A new element lands in the middle of the view, then it is dragged into place.
        Object.assign(def, { anchor: 'middle-center', x: 0, y: 0 });
        this.layout.push(def);
        this.selected = def;
        this.afterEdit(null, before);
    },

    duplicateSelected() {
        const d = this.selected;
        if (!d) return;
        const before = this.snapshot(), copy = Object.assign({}, d, { id: this.uniqueId(d.id) });
        this.layout.splice(this.layout.indexOf(d) + 1, 0, copy);
        this.selected = copy;
        const r = this.rect(d);
        this.place(copy, Object.assign(r, { left: r.left + 16, top: r.top + 16 }));
        this.afterEdit(null, before);
    },

    removeSelected() {
        const i = this.layout.indexOf(this.selected);
        if (i < 0) return;
        const before = this.snapshot();
        this.layout.splice(i, 1);
        this.selected = null;
        this.afterEdit(null, before);
    },

    // Drawing order: by +1 — closer to the viewer.
    moveSelected(by) {
        const i = this.layout.indexOf(this.selected), j = i + by;
        if (i < 0 || j < 0 || j >= this.layout.length) return;
        const before = this.snapshot();
        this.layout.splice(j, 0, this.layout.splice(i, 1)[0]);
        this.afterEdit(null, before);
    },

    // A field of the selected one; consecutive edits of one field merge into a single history step.
    setField(key, value) {
        const d = this.selected;
        if (!d) return;
        const before = this.snapshot();
        d[key] = value;
        this.commit('ui:' + d.id + ':' + key, before);
        const e = UI.get(d.id);
        if (e) e.apply();
        this.updateBox();
    },

    setId(id) {
        const d = this.selected;
        if (!d || !/^[A-Za-z_][A-Za-z0-9_-]{0,47}$/.test(id) || this.layout.some(o => o !== d && o.id === id)) return false;
        const before = this.snapshot();
        d.id = id;
        this.commit('ui:id', before);
        this.refresh();
        this.renderList();
        return true;
    },

    // The element stays where it stands: x and y are recomputed for the new anchor.
    setAnchor(anchor) {
        const d = this.selected;
        if (!d || d.anchor === anchor) return;
        const before = this.snapshot(), r = this.rect(d);
        d.anchor = anchor;
        this.place(d, r);
        this.afterEdit(null, before);
    },

    afterEdit(key, before) {
        this.commit(key, before);
        this.refresh();
        this.render();
    },

    // --- History ---------------------------------------------------------------------

    snapshot() {
        return { defs: JSON.stringify(this.layout), selected: this.selected ? this.layout.indexOf(this.selected) : -1 };
    },

    commit(key, before) {
        const after = this.snapshot();
        if (after.defs !== before.defs) EditHistory.record(key, () => this.restore(before), () => this.restore(after));
        this.renderHeader();
    },

    restore(snap) {
        const defs = JSON.parse(snap.defs);
        this.layout.length = 0;
        this.layout.push(...defs);
        this.selected = this.layout[snap.selected] || null;
        this.refresh();
        this.render();
    },

    // --- File ------------------------------------------------------------------------

    isDirty() {
        return JSON.stringify(this.layout) !== this.saved;
    },

    async save() {
        if (!this.isDirty()) return;
        if (!Inspector.saveAvailable) { Toast.show(I18N.t('toast.noSave'), true); return; }
        try {
            const j = await ObjectsPanel.post('/api/save-ui', { elements: this.layout });
            if (!j.ok) throw new Error(Inspector.errorText(j) + (j.index != null ? ' — #' + (j.index + 1) : '') + (j.field ? ' (' + j.field + ')' : ''));
            this.saved = JSON.stringify(this.layout);
            this.renderHeader();
            Toast.show(I18N.t('toast.uiSaved', { n: j.count, backup: j.backup || '—' }));
        } catch (e) {
            Toast.show(I18N.t('toast.uiSaveError', { msg: e.message }), true);
        }
    },

    revert() {
        const before = this.snapshot();
        this.restore({ defs: this.saved, selected: -1 });
        this.commit(null, before);
        Toast.show(I18N.t('toast.uiReverted'));
    },

    // --- DOM -------------------------------------------------------------------------

    render() {
        this.renderHeader();
        this.renderList();
        this.renderProps();
    },

    renderHeader() {
        const dirty = this.isDirty();
        /** @type {HTMLButtonElement} */ (document.getElementById('btn-ui-save')).disabled = !dirty;
        /** @type {HTMLButtonElement} */ (document.getElementById('btn-ui-revert')).disabled = !dirty;
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#ui-add button'))) {
            btn.textContent = '+ ' + I18N.t('ui.kind.' + btn.dataset.kind);
        }
        const tab = document.querySelector('#pane-tabs [data-tab="ui"]');
        if (tab) tab.classList.toggle('dirty', dirty);
    },

    renderList() {
        const P = ObjectsPanel, host = document.getElementById('ui-list');
        host.innerHTML = '';
        if (!this.layout.length) {
            host.appendChild(P.el('div', 'objects-empty', I18N.t('ui.empty')));
            return;
        }
        for (const def of this.layout) {
            const row = P.el('div', 'object-row' + (def === this.selected ? ' selected' : ''));
            row.append(P.el('span', 'object-name', def.id), P.el('span', 'object-file', I18N.t('ui.kind.' + def.kind)));
            row.addEventListener('click', () => this.select(def));
            host.appendChild(row);
        }
    },

    renderProps() {
        const P = ObjectsPanel, host = document.getElementById('ui-props');
        host.innerHTML = '';
        this.propEls = null;
        const d = this.selected;
        if (!d) {
            if (this.layout.length) host.appendChild(P.el('div', 'objects-empty', I18N.t('ui.noSelection')));
            return;
        }
        const els = this.propEls = {};

        const id = P.input('text', d.id);
        id.maxLength = 48;
        id.addEventListener('input', () => id.classList.toggle('invalid', !this.setId(id.value) && id.value !== d.id));
        id.addEventListener('blur', () => { id.value = d.id; id.classList.remove('invalid'); });
        host.appendChild(P.row('ui.id', 'ui.idHint', id));

        const grid = P.el('div', 'anchor-grid');
        for (const a of UI.ANCHORS) {
            const cell = P.el('button', a === d.anchor ? 'active' : '');
            cell.title = a;
            cell.addEventListener('click', () => this.setAnchor(a));
            grid.appendChild(cell);
        }
        host.appendChild(P.row('ui.anchor', 'ui.anchorHint', grid));

        for (const [key, type] of this.FIELDS) {
            if (!(key in UI.DEFAULTS[d.kind])) continue;
            host.appendChild(P.row('ui.f.' + key, null, ...this.editor(d, key, type, els)));
        }

        const actions = P.el('div', 'object-actions');
        for (const [key, fn, cls] of [['ui.forward', () => this.moveSelected(1)], ['ui.backward', () => this.moveSelected(-1)],
            ['obj.duplicate', () => this.duplicateSelected()], ['obj.delete', () => this.removeSelected(), 'danger']]) {
            const btn = P.el('button', cls || '', I18N.t(key));
            btn.addEventListener('click', fn);
            actions.appendChild(btn);
        }
        host.appendChild(actions);
    },

    // Controls of one field. Numbers are remembered in els — syncProps refreshes them while dragging.
    editor(d, key, type, els) {
        const P = ObjectsPanel;
        if (type === 'text') {
            const text = P.input('text', d[key]);
            text.maxLength = 200;
            text.addEventListener('input', () => this.setField(key, text.value));
            return [text];
        }
        if (type === 'flag') {
            const flag = P.choice([['1', I18N.t('ui.yes')], ['0', I18N.t('ui.no')]], d[key] === 0 ? '0' : '1');
            flag.addEventListener('change', () => { this.setField(key, Number(flag.value)); });
            return [flag];
        }
        if (type === 'color') {
            const on = P.input('checkbox', '');
            on.checked = !!d[key];
            const pick = P.input('color', d[key] || '#ffffff');
            pick.disabled = !d[key];
            on.addEventListener('change', () => { pick.disabled = !on.checked; this.setField(key, on.checked ? pick.value : ''); });
            pick.addEventListener('input', () => this.setField(key, pick.value));
            return [on, pick];
        }
        const unit = type === 'unit';
        const num = P.input('number', P.fmt(d[key]));
        num.step = unit ? '0.05' : '1';
        if (unit) { num.min = '0'; num.max = '1'; }
        num.addEventListener('input', () => {
            const v = Number(num.value);
            if (num.value === '' || !Number.isFinite(v)) return;
            this.setField(key, unit ? Math.max(0, Math.min(1, P.round(v, 2))) : P.round(v, 1));
        });
        num.addEventListener('blur', () => { num.value = P.fmt(d[key]); });
        els[key] = num;
        return [num];
    },

    // Number fields catch up with the record (drag, nudge); the focused field is left alone.
    syncProps() {
        const els = this.propEls, d = this.selected;
        if (!els || !d) return;
        for (const key of Object.keys(els)) {
            if (document.activeElement !== els[key]) els[key].value = ObjectsPanel.fmt(d[key]);
        }
    },
};
