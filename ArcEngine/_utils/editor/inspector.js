// inspector.js — правая панель: поля из KIT_SCHEMA, правка window-глобалов live
// (сцена применяет их по событию constants-changed — см. main.js), подсветка
// «грязных» значений и сохранение их в Constants.js через API сервера.
//
// Группы при запуске свёрнуты. Раскрытые вручную запоминаются на сессию
// (open): смена языка перестраивает панель, не сворачивая их; поиск раскрывает
// найденное временно, пустой запрос возвращает ручное состояние.

const Inspector = {
    schema: [],
    originals: {},        // name -> значение на момент загрузки (или последнего сохранения)
    fieldByName: {},      // name -> описание поля
    fieldEls: {},         // name -> { row, slider|select|color, num|text, field }
    open: new Set(),      // id групп, раскрытых вручную
    query: '',            // текущий поисковый запрос
    saveAvailable: false, // /api/status ответил — сервер редактора, не чужой
    server: { state: 'checking', api: 0 },

    get(name) { return window[name]; },
    set(name, value) { window[name] = value; },

    // --- Инициализация --------------------------------------------------------

    init() {
        this.schema = KIT_SCHEMA;
        for (const g of this.schema) {
            for (const f of g.fields) {
                this.fieldByName[f.name] = f;
                this.originals[f.name] = this.get(f.name);
            }
        }
        this.build();
        this.refreshSaveButton();
        this.checkServer();

        document.getElementById('btn-save').addEventListener('click', () => this.save());
        document.getElementById('btn-revert').addEventListener('click', () => this.revertAll());
        document.getElementById('inspector-search').addEventListener('input', e => this.filter(e.target.value));
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
            // Клиентские файлы подхватываются по F5, серверные — только
            // перезапуском процесса: устаревший сервер молча пишет старым форматом.
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

    // --- Построение DOM -------------------------------------------------------

    build() {
        const host = document.getElementById('inspector-groups');
        host.innerHTML = '';
        this.fieldEls = {};
        for (const group of this.schema) {
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

    // Общая часть строки: подпись, имя константы, ↺ к загруженному значению.
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
            // В Constants.js цвет — число 0xRRGGBB, в UI — пипетка и hex-строка.
            const color = document.createElement('input');
            color.type = 'color';
            const text = document.createElement('input');
            text.type = 'text';
            text.className = 'hex';
            controls.append(color, text);
            color.addEventListener('input', () => this.apply(f, this.parseHex(color.value)));
            text.addEventListener('input', () => {
                const v = this.parseHex(text.value);
                // Поле, в котором печатают, не переписываем — иначе набор коверкается.
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
            // Значение вне списка (руками в Constants.js) не теряется молча:
            // для него появляется отдельный пункт.
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

    // --- Правка значения ------------------------------------------------------

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
        const n = this.dirtyList().length;
        const btn = document.getElementById('btn-save');
        btn.textContent = n ? I18N.t('insp.saveN', { n }) : I18N.t('insp.save');
        btn.disabled = n === 0;
        document.getElementById('btn-revert').disabled = n === 0;
    },

    revertAll() {
        for (const name of this.dirtyList()) this.apply(this.fieldByName[name], this.originals[name]);
        Toast.show(I18N.t('toast.reverted'));
    },

    // --- Сохранение -----------------------------------------------------------

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
                // Успешно записанные становятся новой базой для dirty-подсветки.
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

    // Отказ сервера: по коду — на языке интерфейса, без кода — как прислал сервер.
    errorText(res) {
        const key = 'err.' + res.code;
        const text = res.code ? I18N.t(key) : '';
        return text && text !== key ? text : (res.error || '?');
    },

    // --- Поиск ----------------------------------------------------------------

    // Ищет по имени константы и подписям на ОБОИХ языках.
    filter(query) {
        this.query = query;
        const q = query.trim().toLowerCase();
        const has = (text) => {
            if (!text) return false;
            if (typeof text === 'string') return text.toLowerCase().includes(q);
            return Object.values(text).some(s => String(s).toLowerCase().includes(q));
        };
        for (const group of this.schema) {
            const box = document.querySelector(`[data-group-id="${group.id}"]`);
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

// Мини-тосты (внизу справа).
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
