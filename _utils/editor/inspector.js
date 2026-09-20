// inspector.js — the right pane: fields from KIT_SCHEMA, live editing of window globals
// (the scene applies them on the constants-changed event — see main.js), highlighting
// of dirty values and saving them to Constants.js through the server API.
//
// Groups are collapsed at startup. Those expanded by hand are remembered for the session
// (open): a language change rebuilds the pane without collapsing them; search expands
// the matches temporarily, an empty query restores the manual state.
//
// A group with `tab: '<name>'` in the schema is built into THAT tab (<name>-groups) instead of
// Global Settings — the Sound tab is such a group. All of them are one set of constants: one
// dirty state, one save (every [data-role="save-constants"] button), one Ctrl+S.

/** @satisfies {Record<string, any>} */
const Inspector = {
    schema: [],
    /** @type {Record<string, number>} */
    originals: {},        // name -> the value as of load (or the last save)
    /** @type {Record<string, any>} */
    fieldByName: {},      // name -> field description
    /** @type {Record<string, any>} */
    fieldEls: {},         // name -> { row, slider|select|color, num|text, field }
    /** @type {Record<string, string>} */
    tabOf: {},            // name -> the tab its group lives on ('settings' by default)
    open: new Set(),      // ids of the groups expanded by hand
    query: '',            // the current search query
    saveAvailable: false, // /api/status answered — the editor server, not a foreign one
    server: { state: 'checking', api: 0 },

    get(name) { return /** @type {any} */ (window)[name]; },
    set(name, value) { /** @type {any} */ (window)[name] = value; },

    // --- Initialization -------------------------------------------------------

    init() {
        this.schema = KIT_SCHEMA;
        for (const g of this.schema) {
            // Global Settings is long — its groups start collapsed; a tab of its own holds a
            // couple of groups and would just look empty.
            if (g.tab) this.open.add(g.id);
            for (const f of g.fields) {
                this.fieldByName[f.name] = f;
                this.originals[f.name] = this.get(f.name);
                this.tabOf[f.name] = g.tab || 'settings';
            }
        }
        this.build();
        this.refreshSaveButton();
        this.checkServer();

        for (const btn of this.buttons('save')) btn.addEventListener('click', () => this.save());
        for (const btn of this.buttons('revert')) btn.addEventListener('click', () => this.revertAll());
        document.getElementById('inspector-search').addEventListener('input', e => this.filter(/** @type {HTMLInputElement} */ (e.target).value));
        window.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); this.save(); }
        });
        window.addEventListener('lang-changed', () => {
            this.build();
            this.filter(this.query);
            this.refreshSaveButton();
            this.renderServer();
        });
    },

    async checkServer() {
        try {
            const r = await fetch('/api/status', { cache: 'no-store' });
            const j = await r.json();
            if (!j || j.editor !== 'arcengine') throw new Error('foreign server');
            this.saveAvailable = true;
            // Client files are picked up on F5, server ones — only by
            // restarting the process: an outdated server silently writes in the old format.
            this.server.api = Number(j.api) || 0;
            this.server.state = this.server.api < EDITOR_API_VERSION ? 'old' : 'ok';
            if (this.server.state === 'old') Toast.show(I18N.t('server.oldToast'), true);
        } catch (e) {
            this.saveAvailable = false;
            this.server.state = 'none';
        }
        this.renderServer();
    },

    renderServer() {
        const dot = document.getElementById('server-dot');
        const label = document.getElementById('server-label');
        const s = this.server;
        dot.classList.toggle('ok', s.state === 'ok');
        dot.classList.toggle('bad', s.state === 'old' || s.state === 'none');
        label.textContent = s.state === 'ok' ? I18N.t('server.ok')
            : s.state === 'old' ? I18N.t('server.old', { api: s.api, need: EDITOR_API_VERSION })
            : s.state === 'none' ? I18N.t('server.none')
            : I18N.t('server.checking');
    },

    // --- Building the DOM -----------------------------------------------------

    // Save / revert buttons: one set of constants, but a button on every tab that shows them.
    buttons(role) {
        return /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll(`[data-role="${role}-constants"]`));
    },

    // The host of a group: its tab's <tab>-groups, Global Settings by default (and as a
    // fallback, so a group with a tab that has no panel is still shown somewhere).
    groupHost(group) {
        return (group.tab && document.getElementById(group.tab + '-groups')) || document.getElementById('inspector-groups');
    },

    build() {
        this.fieldEls = {};
        for (const host of new Set(this.schema.map(g => this.groupHost(g)))) host.innerHTML = '';
        for (const group of this.schema) {
            const host = this.groupHost(group);
            const box = document.createElement('section');
            box.className = 'group';
            box.classList.toggle('collapsed', !this.open.has(group.id));
            box.dataset.groupId = group.id;

            const title = document.createElement('h3');
            title.className = 'group-title';
            title.textContent = I18N.pick(group.label);
            title.addEventListener('click', () => {
                const opening = box.classList.contains('collapsed');
                box.classList.toggle('collapsed', !opening);
                if (opening) this.open.add(group.id); else this.open.delete(group.id);
            });
            box.appendChild(title);

            const body = document.createElement('div');
            body.className = 'group-body';
            for (const f of group.fields) body.appendChild(this.buildFieldRow(f));
            box.appendChild(body);
            host.appendChild(box);
        }
    },

    // The common part of a row: label, constant name, ↺ back to the loaded value.
    _row(f) {
        const row = document.createElement('div');
        row.className = 'field';
        row.dataset.name = f.name;
        const hint = I18N.pick(f.hint);
        if (hint) row.title = hint;
        const head = document.createElement('div');
        head.className = 'field-head';
        const label = document.createElement('label');
        label.textContent = I18N.pick(f.label);
        const nameTag = document.createElement('span');
        nameTag.className = 'field-name';
        nameTag.textContent = f.name;
        const resetBtn = document.createElement('button');
        resetBtn.className = 'field-reset';
        resetBtn.textContent = '↺';
        resetBtn.title = I18N.t('insp.reset');
        resetBtn.addEventListener('click', () => this.apply(f, this.originals[f.name]));
        head.append(label, nameTag, resetBtn);
        const controls = document.createElement('div');
        controls.className = 'field-controls';
        row.append(head, controls);
        return { row, controls };
    },

    buildFieldRow(f) {
        const { row, controls } = this._row(f);
        const els = { row, field: f };
        if (f.kind === 'color') {
            // In Constants.js a color is a 0xRRGGBB number, in the UI — a color picker and a hex string.
            const color = document.createElement('input');
            color.type = 'color';
            const text = document.createElement('input');
            text.type = 'text';
            text.className = 'hex';
            controls.append(color, text);
            color.addEventListener('input', () => this.apply(f, this.parseHex(color.value)));
            text.addEventListener('input', () => {
                const v = this.parseHex(text.value);
                // The field being typed in is not rewritten — otherwise the typing gets mangled.
                if (v !== null) this.apply(f, v, { skipText: true });
            });
            text.addEventListener('blur', () => { text.value = this.hex(this.get(f.name)); });
            Object.assign(els, { color, text });
        } else if (f.kind === 'select') {
            const select = document.createElement('select');
            for (const o of f.options) {
                const opt = document.createElement('option');
                opt.value = String(o.value);
                opt.textContent = I18N.pick(o.label);
                select.appendChild(opt);
            }
            controls.append(select);
            select.addEventListener('change', () => this.apply(f, Number(select.value)));
            els.select = select;
        } else {
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = f.min; slider.max = f.max; slider.step = f.step;
            const num = document.createElement('input');
            num.type = 'number';
            num.step = f.step;
            controls.append(slider, num);
            slider.addEventListener('input', () => this.apply(f, Number(slider.value)));
            num.addEventListener('input', () => {
                const v = Number(num.value);
                if (num.value !== '' && Number.isFinite(v)) this.apply(f, v, { skipText: true });
            });
            num.addEventListener('blur', () => { num.value = this.fmt(this.get(f.name)); });
            Object.assign(els, { slider, num });
        }
        this.fieldEls[f.name] = els;
        this.syncControls(f, this.get(f.name), {});
        this.refreshDirty(f.name);
        return row;
    },

    syncControls(f, value, opts) {
        const els = this.fieldEls[f.name];
        if (!els) return;
        if (els.color) {
            els.color.value = this.hex(value);
            if (!opts.skipText) els.text.value = els.color.value;
        } else if (els.select) {
            // A value outside the list (set by hand in Constants.js) is not lost silently:
            // a separate option appears for it.
            const sel = els.select;
            for (const opt of [...sel.options]) if (opt.dataset.extra) opt.remove();
            if (!f.options.some(o => Number(o.value) === Number(value))) {
                const opt = document.createElement('option');
                opt.value = String(value);
                opt.textContent = this.fmt(Number(value)) + ' ' + I18N.t('insp.offList');
                opt.dataset.extra = '1';
                sel.appendChild(opt);
            }
            sel.value = String(Number(value));
        } else {
            els.slider.value = value;
            if (!opts.skipText) els.num.value = this.fmt(value);
        }
    },

    // --- Editing a value ------------------------------------------------------

    apply(f, value, opts = {}) {
        this.set(f.name, value);
        this.syncControls(f, value, opts);
        this.refreshDirty(f.name);
        this.refreshSaveButton();
    },

    isDirty(name) {
        return Math.abs(this.get(name) - this.originals[name]) > 1e-9;
    },

    refreshDirty(name) {
        const els = this.fieldEls[name];
        if (els) els.row.classList.toggle('dirty', this.isDirty(name));
    },

    dirtyList() {
        return Object.keys(this.originals).filter(n => this.isDirty(n));
    },

    refreshSaveButton() {
        const dirty = this.dirtyList(), n = dirty.length;
        for (const btn of this.buttons('save')) {
            btn.textContent = n ? I18N.t('insp.saveN', { n }) : I18N.t('insp.save');
            btn.disabled = n === 0;
        }
        for (const btn of this.buttons('revert')) btn.disabled = n === 0;
        // A dirty mark on the tab that holds the changed constants, like the Objects and UI tabs.
        for (const tab of ['settings', 'sound']) {
            const el = document.querySelector('#pane-tabs [data-tab="' + tab + '"]');
            if (el) el.classList.toggle('dirty', dirty.some(name => this.tabOf[name] === tab));
        }
    },

    revertAll() {
        for (const name of this.dirtyList()) this.apply(this.fieldByName[name], this.originals[name]);
        Toast.show(I18N.t('toast.reverted'));
    },

    // --- Saving ---------------------------------------------------------------

    async save() {
        const dirty = this.dirtyList();
        if (!dirty.length) return;
        if (!this.saveAvailable) {
            Toast.show(I18N.t('toast.noSave'), true);
            return;
        }
        const changes = dirty.map(name => ({ name, value: this.get(name) }));
        try {
            const r = await fetch('/api/save-constants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ changes }),
            });
            const j = await r.json();
            const failed = (j.results || []).filter(x => !x.ok);
            if (j.patched > 0) {
                // Successfully written ones become the new base for the dirty highlighting.
                for (const res of j.results) {
                    if (res.ok && res.name in this.originals) {
                        this.originals[res.name] = this.get(res.name);
                        this.refreshDirty(res.name);
                    }
                }
                this.refreshSaveButton();
            }
            if (failed.length) {
                const list = failed.map(x => x.name + ' (' + this.errorText(x) + ')').join(', ');
                Toast.show(I18N.t('toast.partial', { n: j.patched || 0, m: failed.length, list }), true);
            } else {
                Toast.show(I18N.t('toast.saved', { n: j.patched, backup: j.backup }));
            }
        } catch (e) {
            Toast.show(I18N.t('toast.saveError', { msg: e.message }), true);
        }
    },

    // Server rejection: by code — in the UI language, without a code — as the server sent it.
    errorText(res) {
        const key = 'err.' + res.code;
        const text = res.code ? I18N.t(key) : '';
        return text && text !== key ? text : (res.error || '?');
    },

    // --- Search ---------------------------------------------------------------

    // Searches by constant name and by labels in BOTH languages.
    filter(query) {
        this.query = query;
        const q = query.trim().toLowerCase();
        const has = (text) => {
            if (!text) return false;
            if (typeof text === 'string') return text.toLowerCase().includes(q);
            return Object.values(text).some(s => String(s).toLowerCase().includes(q));
        };
        for (const group of this.schema) {
            const box = /** @type {HTMLElement | null} */ (document.querySelector(`[data-group-id="${group.id}"]`));
            if (!box) continue;
            let visible = 0;
            for (const f of group.fields) {
                const el = this.fieldEls[f.name] && this.fieldEls[f.name].row;
                if (!el) continue;
                const match = !q || f.name.toLowerCase().includes(q) || has(f.label) || has(group.label);
                el.style.display = match ? '' : 'none';
                if (match) visible++;
            }
            box.style.display = visible ? '' : 'none';
            box.classList.toggle('collapsed', q ? false : !this.open.has(group.id));
        }
    },

    fmt(v, digits = 6) {
        if (!Number.isFinite(v)) return '—';
        return String(parseFloat(Number(v).toFixed(digits)));
    },

    hex(v) {
        return '#' + (Number(v) >>> 0).toString(16).padStart(6, '0').slice(-6);
    },

    parseHex(str) {
        const m = /^#?([0-9a-fA-F]{6})$/.exec(String(str).trim());
        return m ? parseInt(m[1], 16) : null;
    },
};

// Mini toasts (bottom right).
/** @satisfies {Record<string, any>} */
const Toast = {
    show(text, isError = false) {
        const host = document.getElementById('toasts');
        const el = document.createElement('div');
        el.className = 'toast' + (isError ? ' error' : '');
        el.textContent = text;
        host.appendChild(el);
        setTimeout(() => el.classList.add('gone'), 3600);
        setTimeout(() => el.remove(), 4100);
    },
};
