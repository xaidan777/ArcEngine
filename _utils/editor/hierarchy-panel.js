// hierarchy-panel.js — the Hierarchy pane of the editor's Unity-like layout: the scene tree.
//
// WHY it is written this way:
//   * a row is a DOCUMENT node (SceneDoc), never a Babylon mesh — the tree is the same whether or
//     not 3D has started, which is why the whole panel can be tested headlessly;
//   * every structural change goes through a SceneDoc command, so undo/redo, the dirty flag and
//     the revision counter are automatic. This file records NO history of its own;
//   * collapse/expand is VIEW state, not an edit: the document has no command for it, and folding
//     a branch must not mark the scene dirty or push an undo step (Unity behaves the same);
//   * drag-and-drop is split into a PURE decision (`dropTarget`), an application that only calls
//     the document commands (`applyDrop`) and the DOM glue. The rules that are easy to get wrong —
//     no cycles, the exact insertion index — live in the pure half and are pinned by a test.
//
// The container and the inner ids are public so the parent's markup and CSS can target them:
// `#hierarchy-tree` (given by the parent) > `#hierarchy-search` + `#hierarchy-rows`.

/** @typedef {{ id: string, depth: number, name: string, hasChildren: boolean, expanded: boolean, visible: boolean }} HierarchyRow */
/** @typedef {{ ok: boolean, parentId?: string, index?: number, reason?: string }} DropTarget */

// Every label of this panel, EN + RU, in the { en, ru } shape the inspector schema uses. They live
// here rather than in i18n.js because this file is self-contained: `text()` resolves them through
// I18N.pick, so the panel follows the editor language like everything else.
/** @type {Record<string, { en: string, ru: string }>} */
const HIERARCHY_TEXT = {
    search: { en: 'Search nodes…', ru: 'Поиск узлов…' },
    empty: { en: 'No nodes. Add one with the GameObject menu.', ru: 'Узлов нет. Добавьте через меню «Игровой объект».' },
    noMatch: { en: 'Nothing matches “{q}”.', ru: 'Ничего не найдено по «{q}».' },
    rename: { en: 'Rename', ru: 'Переименовать' },
    duplicate: { en: 'Duplicate', ru: 'Дублировать' },
    delete: { en: 'Delete', ru: 'Удалить' },
    create: { en: 'Create Empty', ru: 'Создать пустой' },
    show: { en: 'Show / hide (click to toggle)', ru: 'Показать / скрыть (переключить)' },
    expand: { en: 'Expand / collapse', ru: 'Развернуть / свернуть' },
};

/** @satisfies {Record<string, any>} */
const HierarchyPanel = {
    /** The element the parent provides; `init()` builds the search box and the rows into it. */
    ROOT_ID: 'hierarchy-tree',
    /** The search field. Reused when the parent's markup already has it. */
    SEARCH_ID: 'hierarchy-search',
    /** The scrolling list of rows. */
    ROWS_ID: 'hierarchy-rows',
    /** Indentation of one depth step, px. */
    INDENT: 16,

    /** The document currently drawn. */
    /** @type {any} */
    doc: null,
    /** The selected node id, or null. */
    /** @type {string | null} */
    selectedId: null,
    /** The search query (`SceneDoc.find`). */
    query: '',
    /** The parent sets this to learn about selection: (id | null) => void. */
    /** @type {((id: string | null) => void) | null} */
    onSelect: null,
    /** The parent may switch the panel's own Del / F2 / Ctrl+D handling off when another pane owns it. */
    hotkeys: true,

    /** @type {HTMLElement | null} */
    _host: null,
    /** @type {HTMLElement | null} */
    _rows: null,
    /** @type {HTMLInputElement | null} */
    _search: null,
    /** @type {HTMLElement | null} */
    _menuEl: null,
    /** id -> row element: a lookup instead of a selector, so a hostile node id cannot break it. */
    /** @type {Record<string, HTMLElement>} */
    _rowEls: {},
    /** @type {string | null} */
    _dragId: null,

    /**
     * The document model, read off the global object on every call.
     *
     * WHY not `SceneDoc.walk(…)` directly: scene-doc.js carries a CommonJS export guard, and
     * TypeScript then classifies that file as a MODULE — a top-level `const` of a module is not
     * visible to other files, so a bare reference is TS2304 (the sibling scene-view.js hits the
     * same wall) until globals.d.ts declares the name. The global object carries it both in the
     * page and in the test's vm context, so this panel stays self-contained and type-clean.
     * @returns {any}
     */
    docApi() {
        return /** @type {any} */ (globalThis).SceneDoc;
    },

    // ---------------------------------------------------------------------------
    // Pure logic — no DOM, no Babylon. This is what the headless test drives.
    // ---------------------------------------------------------------------------

    /**
     * The rows to draw, in order: the document walked from its root, each row indented by its
     * depth. A node is skipped when any ancestor is collapsed. With a `query` the matches (and the
     * chain leading to them) are shown regardless of collapse — the user asked to see them — and
     * everything else is hidden.
     * @param {any} doc
     * @param {string} [query]
     * @returns {HierarchyRow[]}
     */
    flatten(doc, query) {
        const Doc = this.docApi();
        /** @type {HierarchyRow[]} */
        const rows = [];
        if (!doc || !doc.rootId || !Doc) return rows;
        const q = String(query == null ? '' : query).trim();
        /** @type {Set<string> | null} */
        let keep = null;
        if (q) {
            keep = new Set();
            for (const node of Doc.find(doc, q)) {
                // Ancestors too, otherwise a match deep in the tree would be drawn at the wrong depth.
                for (const step of Doc.path(doc, node.id)) keep.add(step.id);
            }
        }
        for (const node of Doc.walk(doc, doc.rootId)) {
            const chain = Doc.path(doc, node.id);
            if (keep && !keep.has(node.id)) continue;
            // The root has no ancestors, so it is never hidden by a collapse.
            if (!keep && chain.slice(0, -1).some(n => n.expanded === false)) continue;
            rows.push({
                id: node.id,
                depth: chain.length - 1,
                name: node.name,
                hasChildren: Doc.children(doc, node.id).length > 0,
                // A node that predates the field (an old scene file) counts as expanded.
                expanded: node.expanded !== false,
                visible: node.visible !== false,
            });
        }
        return rows;
    },

    /**
     * What a drag means, without performing it. `where` is 'before' | 'after' | 'inside'.
     *
     * `index` is an INSERTION INDEX into the destination's child list with the dragged node taken
     * out (splice semantics) — exactly what `applyDrop` needs, and the reason a same-parent
     * "move down" does not end up one slot short.
     *
     * Refused: an unknown id, the root as the dragged node, a node dropped onto itself, a node
     * dropped into its own descendant (that would detach the subtree from the tree) and anything
     * placed above the root (the root has no parent and no siblings).
     * @param {any} doc
     * @param {string} dragId
     * @param {string} targetId
     * @param {string} where 'before' | 'after' | 'inside'
     * @returns {DropTarget}
     */
    dropTarget(doc, dragId, targetId, where) {
        const Doc = this.docApi();
        if (!doc || !Doc) return { ok: false, reason: 'missing' };
        const drag = Doc.node(doc, dragId);
        const target = Doc.node(doc, targetId);
        if (!drag || !target) return { ok: false, reason: 'missing' };
        if (dragId === doc.rootId) return { ok: false, reason: 'root' };
        if (dragId === targetId) return { ok: false, reason: 'self' };
        if (Doc.isAncestor(doc, dragId, targetId)) return { ok: false, reason: 'descendant' };
        if (where === 'inside') {
            // "Inside" always means last: the drop lands at the end of the target's children.
            const siblings = Doc.children(doc, targetId).filter(n => n.id !== dragId);
            return { ok: true, parentId: targetId, index: siblings.length };
        }
        if (where === 'before' || where === 'after') {
            if (targetId === doc.rootId) return { ok: false, reason: 'root' };
            const parentId = target.parentId;
            if (!parentId) return { ok: false, reason: 'root' };
            const siblings = Doc.children(doc, parentId).filter(n => n.id !== dragId);
            const at = siblings.findIndex(n => n.id === targetId);
            if (at < 0) return { ok: false, reason: 'missing' };
            return { ok: true, parentId, index: where === 'before' ? at : at + 1 };
        }
        return { ok: false, reason: 'where' };
    },

    /**
     * Perform a drop: reparent when the destination parent changed, then move the node among its
     * new siblings so the visual position matches the drop. Only SceneDoc commands are called, so
     * the change is undoable; the two commands of a cross-parent drop are wrapped in one history
     * step, because the user made one gesture.
     * @param {any} doc
     * @param {string} dragId
     * @param {string} targetId
     * @param {string} where 'before' | 'after' | 'inside'
     * @returns {boolean} true when the tree actually changed
     */
    applyDrop(doc, dragId, targetId, where) {
        const Doc = this.docApi();
        if (!doc || !Doc) return false;
        const at = this.dropTarget(doc, dragId, targetId, where);
        if (!at.ok) return false;
        const drag = Doc.node(doc, dragId);
        if (!drag) return false;
        let changed = false;
        const run = () => {
            if (drag.parentId !== at.parentId) changed = Doc.reparent(doc, dragId, at.parentId) || changed;
            const siblings = Doc.children(doc, at.parentId);
            const from = siblings.findIndex(n => n.id === dragId);
            if (from < 0) return;
            // moveChild splices the node out and back in at `from + delta`, which is why the
            // destination index can be used as-is: it already ignores the dragged node.
            changed = Doc.moveChild(doc, dragId, at.index - from) || changed;
        };
        // One gesture — one undo step. EditHistory.batch is the documented way to say that; it does
        // not record a step of its own, so the panel still records no history.
        if (typeof EditHistory !== 'undefined' && EditHistory && EditHistory.batch) EditHistory.batch(run);
        else run();
        return changed;
    },

    /**
     * Fold or unfold a row. VIEW state: kept on the node so it survives a save round-trip, but
     * changed WITHOUT a command — collapsing a branch must not mark the scene dirty or become an
     * undo step. Pass `expanded` to set it explicitly, omit it to toggle.
     * @param {any} doc
     * @param {string} id
     * @param {boolean} [expanded]
     * @returns {boolean} true when the flag changed
     */
    toggleExpanded(doc, id, expanded) {
        const Doc = this.docApi();
        const node = Doc && Doc.node(doc, id);
        if (!node) return false;
        const current = node.expanded !== false;   // a missing field means "open"
        const next = expanded == null ? !current : !!expanded;
        if (current === next) return false;
        node.expanded = next;
        return true;
    },

    /**
     * A name for a copy: "Cube" -> "Cube Copy", then "Cube Copy 2". Unique inside the document,
     * because two nodes with one name are impossible to tell apart in the tree.
     * @param {any} doc
     * @param {string} base
     * @returns {string}
     */
    copyName(doc, base) {
        const Doc = this.docApi();
        const used = new Set(Doc.all(doc).map(n => n.name));
        const stem = String(base || 'Node').replace(/ Copy( \d+)?$/, '');
        let candidate = stem + ' Copy';
        for (let i = 2; used.has(candidate); i++) candidate = stem + ' Copy ' + i;
        return candidate;
    },

    /** A fresh name for a new node: "Empty", "Empty 2", … */
    uniqueName(doc, base) {
        const Doc = this.docApi();
        const used = new Set(Doc.all(doc).map(n => n.name));
        const stem = String(base || 'Node');
        if (!used.has(stem)) return stem;
        for (let i = 2; ; i++) if (!used.has(stem + ' ' + i)) return stem + ' ' + i;
    },

    /**
     * Copy a node AND its subtree, as a sibling right after the original (the Unity behaviour).
     * Only the copy's root is renamed: the children keep their names, so the shape of the copy
     * stays recognisable instead of every level gaining a "Copy" suffix.
     * All the commands of the copy are batched into one undo step. The copy ends up as the LAST
     * sibling and is then moved into place, because the document has no "insert at index" command
     * and one drop already does exactly that.
     * @param {any} doc
     * @param {string} id
     * @returns {string | null} the new root id, or null when there is nothing to copy
     */
    duplicateNode(doc, id) {
        const Doc = this.docApi();
        const source = Doc && Doc.node(doc, id);
        if (!doc || !source || id === doc.rootId) return null;
        /** @type {string | null} */
        let created = null;
        const run = () => {
            /** @returns {any} */
            const clone = (from, parentId) => {
                const copy = Doc.makeNode(from.type, Object.assign({}, from.transform, {
                    name: from.name,
                    parentId,
                    visible: from.visible,
                    expanded: from.expanded,
                    order: from.order,
                    // A deep copy: payload.rot is an array, and two nodes must not share it.
                    payload: JSON.parse(JSON.stringify(from.payload || {})),
                }));
                Doc.add(doc, copy, parentId);
                for (const child of Doc.children(doc, from.id)) clone(child, copy.id);
                return copy;
            };
            created = clone(source, source.parentId).id;
            Doc.rename(doc, created, this.copyName(doc, source.name));
            this.applyDrop(doc, created, id, 'after');
        };
        if (typeof EditHistory !== 'undefined' && EditHistory && EditHistory.batch) EditHistory.batch(run);
        else run();
        return created;
    },

    /** Add a node — the "Create Empty" of the context menu and the GameObject menu. */
    createNode(type, parentId, name) {
        const Doc = this.docApi();
        const doc = this.doc;
        if (!doc || !Doc) return null;
        const parent = parentId && Doc.node(doc, parentId) ? parentId : doc.rootId;
        const node = Doc.makeNode(type || 'group', { name: name || this.uniqueName(doc, type === 'object' ? 'Object' : 'Empty') });
        if (!Doc.add(doc, node, parent)) return null;
        this.select(node.id);
        this.emit();
        return node.id;
    },

    /**
     * True while the user is typing in a field. Hotkeys must never fire there — inside a name field
     * Delete and Ctrl+D belong to the text, not to the scene.
     * @param {any} el an element-like object ({ tagName, isContentEditable })
     * @returns {boolean}
     */
    isTyping(el) {
        if (!el) return false;
        const tag = String(el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        return !!(/** @type {HTMLElement} */ (el).isContentEditable);
    },

    // ---------------------------------------------------------------------------
    // DOM
    // ---------------------------------------------------------------------------

    /**
     * Build the pane into `#hierarchy-tree` (the element the parent provides).
     * @returns {boolean} false when the container is missing — the parent has not wired it yet
     */
    init() {
        const host = document.getElementById(this.ROOT_ID);
        if (!host) return false;
        this._host = host;
        host.classList.add('hierarchy');

        // The parent may put the search field in its own markup; build one only when it did not.
        let search = /** @type {HTMLInputElement | null} */ (document.getElementById(this.SEARCH_ID));
        if (!search) {
            search = document.createElement('input');
            search.type = 'search';
            search.id = this.SEARCH_ID;
            host.appendChild(search);
        }
        search.className = 'hierarchy-search';
        search.placeholder = this.text(HIERARCHY_TEXT.search);
        search.value = this.query;
        this._search = search;
        search.addEventListener('input', () => {
            this.query = search.value;
            this.render();
        });
        search.addEventListener('keydown', (e) => {
            // Escape clears the filter; the panel's hotkeys never see keys typed in a field.
            if (e.key === 'Escape') {
                e.stopPropagation();
                search.value = '';
                this.query = '';
                this.render();
            }
        });

        let rows = document.getElementById(this.ROWS_ID);
        if (!rows) {
            rows = document.createElement('div');
            rows.id = this.ROWS_ID;
            host.appendChild(rows);
        }
        rows.className = 'hierarchy-rows';
        rows.setAttribute('role', 'tree');
        this._rows = rows;

        // One delegated listener set instead of a closure per row: rows are rebuilt on every render.
        rows.addEventListener('click', (e) => this.onClick(e));
        rows.addEventListener('dblclick', (e) => this.onDblClick(e));
        rows.addEventListener('contextmenu', (e) => this.onContextMenu(e));
        rows.addEventListener('dragstart', (e) => this.onDragStart(e));
        rows.addEventListener('dragend', () => { this.clearDragState(); this.render(); });
        rows.addEventListener('dragover', (e) => this.onDragOver(e));
        rows.addEventListener('dragleave', (e) => this.onDragLeave(e));
        rows.addEventListener('drop', (e) => this.onDrop(e));

        document.addEventListener('pointerdown', (e) => this.onOutsidePointerDown(e), true);
        document.addEventListener('keydown', (e) => this.onKey(e));
        window.addEventListener('lang-changed', () => {
            if (this._search) this._search.placeholder = this.text(HIERARCHY_TEXT.search);
            this.render();
        });
        this.render();
        return true;
    },

    /** Draw the tree. `doc` is kept, so a later `render()` (a search keystroke) redraws the same one. */
    render(doc) {
        if (doc) this.doc = doc;
        const rows = this._rows;
        if (!rows) return;
        this._rowEls = {};
        rows.replaceChildren();
        rows.removeAttribute('data-drop');
        const current = this.doc;
        if (!current) return;
        const list = this.flatten(current, this.query);
        if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'hierarchy-empty';
            empty.textContent = this.query
                ? this.text(HIERARCHY_TEXT.noMatch).replace('{q}', this.query)
                : this.text(HIERARCHY_TEXT.empty);
            rows.appendChild(empty);
            return;
        }
        const frag = document.createDocumentFragment();
        for (const model of list) frag.appendChild(this.rowElement(current, model));
        rows.appendChild(frag);
    },

    /** One row: twist triangle, name, visibility toggle. */
    rowElement(doc, model) {
        const Doc = this.docApi();
        const node = Doc.node(doc, model.id);
        const el = document.createElement('div');
        el.className = 'hierarchy-row' + (model.id === this.selectedId ? ' selected' : '')
            + (model.visible ? '' : ' node-hidden');
        el.dataset.id = model.id;
        el.dataset.type = node ? node.type : '';
        el.dataset.depth = String(model.depth);
        // Inline, so the tree is readable even before the parent's CSS lands.
        el.style.paddingLeft = (8 + model.depth * this.INDENT) + 'px';
        el.tabIndex = 0;
        el.draggable = true;
        el.setAttribute('role', 'treeitem');
        el.setAttribute('aria-level', String(model.depth + 1));
        el.setAttribute('aria-expanded', model.hasChildren ? String(model.expanded) : '');

        if (model.hasChildren) {
            const twist = document.createElement('button');
            twist.type = 'button';
            twist.className = 'hierarchy-twist' + (model.expanded ? ' open' : '');
            twist.textContent = model.expanded ? '▾' : '▸';
            twist.title = this.text(HIERARCHY_TEXT.expand);
            twist.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleExpanded(this.doc, model.id);
                this.render();
            });
            el.appendChild(twist);
        } else {
            const pad = document.createElement('span');
            pad.className = 'hierarchy-twist empty';
            el.appendChild(pad);
        }

        const name = document.createElement('span');
        name.className = 'hierarchy-name';
        // textContent, never innerHTML: a scene file is untrusted and a node name must not be
        // able to inject markup into the editor page.
        name.textContent = model.name;
        el.appendChild(name);

        const eye = document.createElement('button');
        eye.type = 'button';
        eye.className = 'hierarchy-eye' + (model.visible ? '' : ' off');
        eye.textContent = model.visible ? '◉' : '◌';
        eye.title = this.text(HIERARCHY_TEXT.show);
        eye.setAttribute('aria-pressed', String(model.visible));
        eye.addEventListener('click', (e) => {
            e.stopPropagation();
            if (Doc.setVisible(this.doc, model.id, !model.visible)) this.emit();
            this.render();
        });
        el.appendChild(eye);

        this._rowEls[model.id] = el;
        return el;
    },

    /** Redraw the current document (used after every local edit). */
    refresh() {
        this.render();
    },

    /**
     * Select a node and tell the parent. The panel never drives another panel itself: the parent
     * decides what a selection means for the Inspector or the scene view.
     * @param {string | null} id
     */
    select(id) {
        const Doc = this.docApi();
        this.selectedId = id && Doc.node(this.doc, id) ? id : null;
        this.render();
        if (typeof this.onSelect === 'function') this.onSelect(this.selectedId);
    },

    /** The scene changed through this panel — the parent redraws the viewport and the Inspector. */
    emit() {
        window.dispatchEvent(new CustomEvent('scene-changed', { detail: { doc: this.doc } }));
    },

    // --- actions (also used by the menu bar through the parent) -------------------

    /** Delete the selection and its subtree. Returns true when something was removed. */
    deleteSelected() {
        const Doc = this.docApi();
        const doc = this.doc, id = this.selectedId;
        if (!doc || !id || id === doc.rootId) return false;
        if (!Doc.remove(doc, id)) return false;
        this.selectedId = null;
        if (typeof this.onSelect === 'function') this.onSelect(null);
        this.emit();
        this.render();
        return true;
    },

    /** Copy the selection (with its subtree) right after itself and select the copy. */
    duplicateSelected() {
        const id = this.duplicateNode(this.doc, this.selectedId);
        if (!id) return false;
        this.select(id);
        this.emit();
        return true;
    },

    /** Start the inline rename of the selection. */
    renameSelected() {
        return this.beginRename(this.selectedId);
    },

    /** Rename in place: the name becomes a field. Enter/blur commits, Escape cancels. */
    beginRename(id) {
        const Doc = this.docApi();
        const doc = this.doc;
        const node = Doc.node(doc, id);
        // The root's name is the scene name, which is not this panel's to change.
        if (!doc || !node || !id || id === doc.rootId) return false;
        const row = this._rowEls[id];
        const nameEl = row && row.querySelector('.hierarchy-name');
        if (!row || !nameEl) return false;
        row.draggable = false;   // a draggable ancestor swallows the mouse inside a text field

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'hierarchy-rename';
        input.value = node.name;
        input.maxLength = 64;
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        let done = false;
        const commit = (save) => {
            if (done) return;
            done = true;
            if (save && Doc.rename(doc, id, input.value)) this.emit();
            this.render();
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();   // Enter/Escape/Delete belong to the field while it is open
            if (e.key === 'Enter') {
                e.preventDefault();
                commit(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                commit(false);
            }
        });
        input.addEventListener('blur', () => commit(true));
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        return true;
    },

    // --- context menu ------------------------------------------------------------

    /** Right-click: on a row — the row's menu, on empty space — "Create Empty". */
    onContextMenu(e) {
        const row = this.rowFrom(e.target);
        e.preventDefault();
        this.openMenu(e, row ? /** @type {string} */ (row.dataset.id) : null);
    },

    openMenu(e, id) {
        if (!this.doc) return;
        if (id) this.select(id);
        const has = !!this.selectedId && this.selectedId !== this.doc.rootId;
        const entries = [
            { key: 'rename', text: HIERARCHY_TEXT.rename, enabled: has, run: () => this.beginRename(this.selectedId) },
            { key: 'duplicate', text: HIERARCHY_TEXT.duplicate, enabled: has, run: () => this.duplicateSelected() },
            { key: 'delete', text: HIERARCHY_TEXT.delete, enabled: has, run: () => this.deleteSelected() },
            { key: 'create', text: HIERARCHY_TEXT.create, enabled: true, run: () => this.createNode('group', id) },
        ];
        const menu = this.menuElement();
        menu.replaceChildren();
        for (const item of entries) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hierarchy-menu-item';
            btn.dataset.action = item.key;
            // Enabled entries get the same command id the menu bar uses, so the parent can also
            // reach them through onCommand if it wants one place for "Duplicate"/"Delete".
            btn.dataset.command = item.key === 'create' ? 'gameobject.empty' : 'edit.' + item.key;
            btn.textContent = this.text(item.text);
            btn.disabled = !item.enabled;
            if (item.enabled) btn.addEventListener('click', () => { this.closeMenu(); item.run(); });
            menu.appendChild(btn);
        }
        menu.hidden = false;
        // Keep the popup on screen; offsetWidth/Height are known once it is visible.
        const x = Math.max(4, Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8));
        const y = Math.max(4, Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8));
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    },

    menuElement() {
        if (this._menuEl && this._menuEl.isConnected) return this._menuEl;
        const menu = document.createElement('div');
        menu.id = 'hierarchy-menu';
        menu.className = 'hierarchy-menu menu-popup';
        menu.hidden = true;
        document.body.appendChild(menu);
        this._menuEl = menu;
        return menu;
    },

    closeMenu() {
        if (this._menuEl) this._menuEl.hidden = true;
    },

    /** A press anywhere else closes the context menu (capture phase: before the row handlers). */
    onOutsidePointerDown(e) {
        if (this._menuEl && !this._menuEl.hidden && e.target !== this._menuEl && !this._menuEl.contains(/** @type {Node} */ (e.target))) this.closeMenu();
    },

    // --- drag and drop -----------------------------------------------------------

    onDragStart(e) {
        const row = this.rowFrom(e.target);
        if (!row || !this.doc) return;
        const id = /** @type {string} */ (row.dataset.id);
        this._dragId = id;
        row.classList.add('dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);   // Firefox refuses to start a drag without data
        }
    },

    /** 'before' / 'after' at the edges of a row, 'inside' in its middle — the Unity gesture. */
    whereFromPointer(row, e) {
        const box = row.getBoundingClientRect();
        const t = box.height ? (e.clientY - box.top) / box.height : 0.5;
        if (t < 0.25) return 'before';
        if (t > 0.75) return 'after';
        return 'inside';
    },

    onDragOver(e) {
        const row = this.rowFrom(e.target);
        if (!row || !this._dragId) {
            this.onDragOverContainer(e);
            return;
        }
        e.preventDefault();
        const id = /** @type {string} */ (row.dataset.id);
        const where = this.whereFromPointer(row, e);
        this.clearDropMarks();
        // Only legal drops get a mark, so the gesture cannot end in a silent refusal.
        if (this.dropTarget(this.doc, this._dragId, id, where).ok) {
            row.dataset.drop = where;
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        } else if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'none';
        }
    },

    /** The empty area under the tree drops INTO the root — how a node is un-nested. */
    onDragOverContainer(e) {
        if (!this._dragId || !this._rows || e.target !== this._rows) return;
        e.preventDefault();
        this.clearDropMarks();
        if (this.dropTarget(this.doc, this._dragId, this.doc.rootId, 'inside').ok) {
            this._rows.dataset.drop = 'inside';
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        }
    },

    onDragLeave(e) {
        const row = this.rowFrom(e.target);
        if (row) row.removeAttribute('data-drop');
    },

    onDrop(e) {
        const row = this.rowFrom(e.target);
        const dragId = this._dragId;
        if (!dragId || !this.doc) return;
        e.preventDefault();
        const targetId = row ? /** @type {string} */ (row.dataset.id) : this.doc.rootId;
        const where = row && row.dataset.drop ? /** @type {string} */ (row.dataset.drop) : 'inside';
        this.clearDragState();
        const changed = this.applyDrop(this.doc, dragId, targetId, where);
        if (changed) {
            this.emit();
            this.select(dragId);
        } else {
            this.render();
        }
    },

    clearDropMarks() {
        if (!this._rows) return;
        for (const el of this._rows.children) el.removeAttribute('data-drop');
        this._rows.removeAttribute('data-drop');
    },

    clearDragState() {
        this.clearDropMarks();
        const el = this._dragId ? this._rowEls[this._dragId] : null;
        if (el) el.classList.remove('dragging');
        this._dragId = null;
    },

    // --- clicks and keys ---------------------------------------------------------

    onClick(e) {
        const row = this.rowFrom(e.target);
        if (!row) {
            this.select(null);   // a click on empty space deselects, as in Unity
            return;
        }
        this.select(/** @type {string} */ (row.dataset.id));
    },

    onDblClick(e) {
        const row = this.rowFrom(e.target);
        const t = /** @type {HTMLElement | null} */ (e.target);
        if (!row || (t && t.closest && t.closest('button'))) return;
        this.beginRename(/** @type {string} */ (row.dataset.id));
    },

    /** The row an event target belongs to, by walking up — ids are never used as selectors. */
    rowFrom(target) {
        let el = /** @type {HTMLElement | null} */ (target);
        while (el && el !== this._rows) {
            if (el.classList && el.classList.contains('hierarchy-row')) return el;
            el = el.parentElement;
        }
        return null;
    },

    /**
     * Delete removes the selection, F2 renames, Ctrl+D duplicates — but never while the user is
     * typing in a field, and never for a keypress another handler already took (the menu bar's
     * Ctrl+D / Del route through the parent, so only one of the two acts).
     */
    onKey(e) {
        if (!this.hotkeys || e.defaultPrevented) return;
        const active = document.activeElement;
        if (this.isTyping(active) || this.isTyping(e.target)) return;
        if (e.key === 'Escape') {
            this.closeMenu();
            return;
        }
        if (!this._ownsKeyboard() || !this.doc) return;
        const code = e.code ? e.code : '';
        const key = String(e.key == null ? '' : e.key);
        const ctrl = e.ctrlKey || e.metaKey;
        if (code === 'Delete' || key === 'Delete' || code === 'Backspace' || key === 'Backspace') {
            // Backspace is the Mac's Delete key, and the rest of the editor accepts both.
            if (this.deleteSelected()) e.preventDefault();
        } else if (code === 'F2' || key === 'F2') {
            if (this.renameSelected()) e.preventDefault();
        } else if (ctrl && !e.shiftKey && !e.altKey && (code === 'KeyD' || key.toUpperCase() === 'D')) {
            if (this.duplicateSelected()) e.preventDefault();
        }
    },

    /**
     * Act only when the user is working in this pane (focus inside it, or nowhere at all): the
     * Del / Ctrl+D keys also exist as menu commands, and one keypress must not run both paths.
     */
    _ownsKeyboard() {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return true;
        return !!(this._host && this._host.contains(/** @type {Node} */ (el)));
    },

    /** A label in the editor language: { en, ru } through I18N.pick, English without i18n.js. */
    text(pair) {
        if (typeof I18N !== 'undefined' && I18N && I18N.pick) return I18N.pick(pair);
        if (typeof pair === 'string') return pair;
        return (pair && (pair.en || pair.ru)) || '';
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = HierarchyPanel;
if (typeof window !== 'undefined') /** @type {any} */ (window).HierarchyPanel = HierarchyPanel;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).HierarchyPanel = HierarchyPanel;