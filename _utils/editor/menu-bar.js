// menu-bar.js — the editor's menu bar (File / Edit / Scene / GameObject / Window / Help), the
// Unity-like top of the layout.
//
// WHY it is written this way:
//   * the menu TREE is data (`buildModel()`), not markup: the test asserts the structure, every
//     item id is unique across the whole bar, and the labels exist in both languages;
//   * the bar owns no editor state. Every item dispatches through `MenuBar.onCommand(id)` — the
//     parent does the work and decides which pane acts. That keeps File/Scene/Window wiring
//     replaceable (the parent may route "Delete" to a pane or fall back to its own default);
//   * the keyboard shortcuts are doubled by a document-level listener so they work with the menu
//     closed, but they refuse to fire while the user is typing in a field — otherwise Ctrl+Z in a
//     name field would undo the scene instead of the text. A shortcut another handler already took
//     (`e.defaultPrevented`) is left alone too, so the menu bar and the panes never both act;
//   * Undo/Redo are disabled straight from `EditHistory.undoStack` / `redoStack` — the menu bar
//     reads the history, it does not keep a copy of it.
//
// `ROOT_ID` is the container the parent provides; the bar builds the top-level buttons, the popup
// and the one delegated listener set into it.

/** @typedef {{ id: string, label: string, labelRu: string, shortcut?: string, enabled?: boolean }} MenuItem */
/** @typedef {{ id: string, label: string, labelRu: string, items: MenuItem[] }} MenuGroup */

// Labels are English + Russian right in the model: the bar is self-contained, so it does not add
// keys to i18n.js. The Russian ones follow the editor dictionary's wording (Objects tab, tabs).
const SHORTCUTS = {
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Shift+Z',
    duplicate: 'Ctrl+D',
    delete: 'Del',
    selectAll: 'Ctrl+A',
    save: 'Ctrl+S',
    saveAs: 'Ctrl+Shift+S',
    frame: 'F',
    open: 'Ctrl+O',
    new: 'Ctrl+N',
};
/** The list the Help > Shortcuts dialog shows, in order. */
const SHORTCUT_LIST = [
    ['file.new', 'New Scene', 'Новая сцена', SHORTCUTS.new],
    ['file.open', 'Open Scene…', 'Открыть сцену…', SHORTCUTS.open],
    ['file.save', 'Save Scene', 'Сохранить сцену', SHORTCUTS.save],
    ['file.saveAs', 'Save As…', 'Сохранить как…', SHORTCUTS.saveAs],
    ['edit.undo', 'Undo', 'Отменить', SHORTCUTS.undo],
    ['edit.redo', 'Redo', 'Повторить', SHORTCUTS.redo],
    ['edit.duplicate', 'Duplicate', 'Дублировать', SHORTCUTS.duplicate],
    ['edit.delete', 'Delete', 'Удалить', SHORTCUTS.delete],
    ['edit.selectAll', 'Select All', 'Выделить всё', SHORTCUTS.selectAll],
    ['scene.frameSelected', 'Frame Selected', 'Показать выбранное', SHORTCUTS.frame],
];

/** @satisfies {Record<string, any>} */
const MenuBar = {
    /** The element the parent provides; `init()` builds the bar into it. */
    ROOT_ID: 'menu-bar',
    /** The popup with the items of the open menu. */
    POPUP_ID: 'menu-bar-popup',
    /** The id of the window event a menu item fires. `detail.id` is the command id. */
    COMMAND_EVENT: 'menu-command',

    /** The parent sets this to receive every command: (id) => void. */
    /** @type {((id: string) => void) | null} */
    onCommand: null,

    /** @type {HTMLElement | null} */
    _host: null,
    /** @type {HTMLElement | null} */
    _popup: null,
    /** id of the open top-level menu, or null. */
    /** @type {string | null} */
    _open: null,
    /** index of the highlighted item of the open menu, -1 — none. */
    _cursor: -1,

    // ---------------------------------------------------------------------------
    // Model — pure data, the thing the headless test asserts.
    // ---------------------------------------------------------------------------

    /**
     * The whole menu tree. Item ids are the command ids `onCommand` receives and are unique across
     * the bar (a test pins that): the parent routes on them, so a duplicate would be ambiguous.
     * @returns {MenuGroup[]}
     */
    buildModel() {
        return [
            {
                id: 'file', label: 'File', labelRu: 'Файл',
                items: [
                    { id: 'file.new', label: 'New Scene', labelRu: 'Новая сцена', shortcut: SHORTCUTS.new },
                    { id: 'file.open', label: 'Open Scene…', labelRu: 'Открыть сцену…', shortcut: SHORTCUTS.open },
                    { id: 'file.save', label: 'Save Scene', labelRu: 'Сохранить сцену', shortcut: SHORTCUTS.save },
                    { id: 'file.saveAs', label: 'Save As…', labelRu: 'Сохранить как…', shortcut: SHORTCUTS.saveAs },
                    { id: 'file.exportObjects', label: 'Export to Objects.js', labelRu: 'Экспорт в Objects.js' },
                    { id: 'file.recent', label: 'Recent', labelRu: 'Недавние' },
                ],
            },
            {
                id: 'edit', label: 'Edit', labelRu: 'Правка',
                items: [
                    { id: 'edit.undo', label: 'Undo', labelRu: 'Отменить', shortcut: SHORTCUTS.undo },
                    { id: 'edit.redo', label: 'Redo', labelRu: 'Повторить', shortcut: SHORTCUTS.redo },
                    { id: 'edit.duplicate', label: 'Duplicate', labelRu: 'Дублировать', shortcut: SHORTCUTS.duplicate },
                    { id: 'edit.delete', label: 'Delete', labelRu: 'Удалить', shortcut: SHORTCUTS.delete },
                    { id: 'edit.selectAll', label: 'Select All', labelRu: 'Выделить всё', shortcut: SHORTCUTS.selectAll },
                ],
            },
            {
                id: 'scene', label: 'Scene', labelRu: 'Сцена',
                items: [
                    { id: 'scene.addEmpty', label: 'Add Empty', labelRu: 'Добавить пустой' },
                    { id: 'scene.addFromLocation', label: 'Add From Location', labelRu: 'Добавить из локации' },
                    { id: 'scene.toggleGrid', label: 'Toggle Grid', labelRu: 'Показать/скрыть сетку' },
                    { id: 'scene.frameSelected', label: 'Frame Selected', labelRu: 'Показать выбранное', shortcut: SHORTCUTS.frame },
                    { id: 'scene.snap', label: 'Snap settings', labelRu: 'Настройки привязки' },
                    { id: 'scene.playGame', label: 'Play Raid', labelRu: 'Запустить рейд', shortcut: 'F5' },
                ],
            },
            {
                id: 'gameobject', label: 'GameObject', labelRu: 'Игровой объект',
                items: [
                    { id: 'gameobject.empty', label: 'Empty', labelRu: 'Пустой' },
                    { id: 'gameobject.object', label: 'Object', labelRu: 'Объект' },
                    { id: 'gameobject.light', label: 'Light', labelRu: 'Источник света' },
                    { id: 'gameobject.spawn', label: 'Spawn Point', labelRu: 'Точка появления' },
                ],
            },
            {
                id: 'window', label: 'Window', labelRu: 'Окно',
                items: [
                    { id: 'window.hierarchy', label: 'Hierarchy', labelRu: 'Иерархия' },
                    { id: 'window.inspector', label: 'Inspector', labelRu: 'Инспектор' },
                    { id: 'window.project', label: 'Project', labelRu: 'Проект' },
                    { id: 'window.console', label: 'Console', labelRu: 'Консоль' },
                    { id: 'window.modelEditor', label: 'Model Editor', labelRu: 'Редактор моделей' },
                    { id: 'window.rig', label: 'Rig', labelRu: 'Риг' },
                ],
            },
            {
                id: 'help', label: 'Help', labelRu: 'Справка',
                items: [
                    { id: 'help.shortcuts', label: 'Shortcuts', labelRu: 'Горячие клавиши' },
                ],
            },
        ];
    },

    /** A group by id, or null. */
    group(id) {
        return this.buildModel().find(g => g.id === id) || null;
    },

    /** An item by id, or null. */
    item(id) {
        for (const group of this.buildModel()) {
            const found = group.items.find(i => i.id === id);
            if (found) return found;
        }
        return null;
    },

    /** The list the Shortcuts dialog shows: [id, label, labelRu, shortcut]. */
    shortcutList() {
        return SHORTCUT_LIST;
    },

    /**
     * Labels of every item in one array — the shortcut handler looks a key combination up without
     * walking the tree per keypress.
     * @returns {MenuItem[]}
     */
    allItems() {
        /** @type {MenuItem[]} */
        const out = [];
        for (const group of this.buildModel()) out.push(...group.items);
        return out;
    },

    /**
     * Is this command available right now? Undo/Redo read the real stacks; a command the parent
     * marked unavailable through `setEnabled` is disabled too.
     * @param {string} id
     * @returns {boolean}
     */
    isEnabled(id) {
        if (Object.prototype.hasOwnProperty.call(this._enabled, id)) return !!this._enabled[id];
        if (id === 'edit.undo') return this._stackLength('undoStack') > 0;
        if (id === 'edit.redo') return this._stackLength('redoStack') > 0;
        return true;
    },

    /** Override an item's availability (the parent knows about things the bar cannot see). */
    setEnabled(id, enabled) {
        this._enabled[id] = !!enabled;
        this.render();
    },

    /** @type {Record<string, boolean>} */
    _enabled: {},

    /** Length of an EditHistory stack, 0 when history.js is not on the page. */
    _stackLength(name) {
        if (typeof EditHistory === 'undefined' || !EditHistory) return 0;
        const stack = EditHistory[name];
        return Array.isArray(stack) ? stack.length : 0;
    },

    /** Undo/Redo availability, for the parent (a toolbar or a status line may show it too). */
    historyState() {
        return { undo: this._stackLength('undoStack'), redo: this._stackLength('redoStack') };
    },

    /**
     * Dispatch one command to the parent. Also fires a `menu-command` window event, so a piece that
     * has no handle on MenuBar (or a future pane) can react without the bar knowing about it.
     * @param {string} id
     */
    run(id) {
        const item = this.item(id);
        if (!item || !this.isEnabled(id)) return false;
        if (typeof this.onCommand === 'function') this.onCommand(id);
        window.dispatchEvent(new CustomEvent(this.COMMAND_EVENT, { detail: { id } }));
        return true;
    },

    // ---------------------------------------------------------------------------
    // Shortcuts
    // ---------------------------------------------------------------------------

    /**
     * The command a keyboard event stands for, or null. Ctrl+S is deliberately absent: the
     * Inspector already saves on Ctrl+S, and two savers would fight over one keypress.
     * @param {any} e a KeyboardEvent-like object
     * @returns {string | null}
     */
    commandFor(e) {
        if (!e) return null;
        const code = e.code || '';
        const key = String(e.key == null ? '' : e.key).toUpperCase();
        const ctrl = !!(e.ctrlKey || e.metaKey);
        const is = (letter) => (code ? code === 'Key' + letter : key === letter);
        if (ctrl && e.shiftKey && is('Z')) return 'edit.redo';
        if (ctrl && !e.shiftKey && is('Z')) return 'edit.undo';
        if (ctrl && !e.shiftKey && is('D')) return 'edit.duplicate';
        if (ctrl && !e.shiftKey && is('A')) return 'edit.selectAll';
        if (!ctrl && (e.code === 'Delete' || key === 'DELETE')) return 'edit.delete';
        if (!ctrl && !e.altKey && is('F')) return 'scene.frameSelected';
        return null;
    },

    /** A keypress belongs to a field while the user is typing in one — hotkeys must not fire. */
    isTyping(el) {
        if (!el) return false;
        const tag = String(el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        return !!(/** @type {HTMLElement} */ (el).isContentEditable);
    },

    onKeyDown(e) {
        const id = this.commandFor(e);
        if (!id) return;
        if (e.defaultPrevented) return;                        // another pane already handled it
        const active = document.activeElement;
        if (this.isTyping(active) || this.isTyping(e.target)) return;
        if (active && active !== document.body && this._popup && this._popup.contains(/** @type {Node} */ (active))) return;
        if (!this.isEnabled(id)) return;
        e.preventDefault();
        this.run(id);
    },

    // ---------------------------------------------------------------------------
    // DOM
    // ---------------------------------------------------------------------------

    /** Build the bar into `#menu-bar`. Returns false when the parent has not provided it. */
    init() {
        const host = document.getElementById(this.ROOT_ID);
        if (!host) return false;
        this._host = host;
        host.classList.add('menu-bar');
        host.setAttribute('role', 'menubar');

        const bar = document.createElement('div');
        bar.className = 'menu-bar-buttons';
        for (const group of this.buildModel()) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu-bar-title';
            btn.dataset.menu = group.id;
            btn.textContent = this.label(group);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._open === group.id) this.close();
                else this.open(group.id);
            });
            // Hovering a sibling while a menu is open switches to it, as every menu bar does.
            btn.addEventListener('pointerenter', () => { if (this._open && this._open !== group.id) this.open(group.id); });
            bar.appendChild(btn);
        }
        host.appendChild(bar);

        const popup = document.createElement('div');
        popup.id = this.POPUP_ID;
        popup.className = 'menu-popup';
        popup.hidden = true;
        popup.setAttribute('role', 'menu');
        popup.addEventListener('click', (e) => e.stopPropagation());
        document.body.appendChild(popup);
        this._popup = popup;

        document.addEventListener('click', () => this.close());
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keydown', (e) => this.onPopupKey(e));
        window.addEventListener('lang-changed', () => this.render());
        this.render();
        return true;
    },

    /** The label of a group/item in the current editor language. */
    label(entry) {
        if (typeof I18N !== 'undefined' && I18N && I18N.lang === 'ru') return entry.labelRu || entry.label;
        return entry.label;
    },

    open(id) {
        const group = this.group(id);
        const popup = this._popup;
        if (!group || !popup) return;
        this._open = id;
        this._cursor = -1;
        popup.replaceChildren();
        for (const item of group.items) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu-item';
            btn.dataset.command = item.id;
            btn.disabled = !this.isEnabled(item.id);
            const label = document.createElement('span');
            label.className = 'menu-item-label';
            label.textContent = this.label(item);
            btn.appendChild(label);
            if (item.shortcut) {
                const hint = document.createElement('span');
                hint.className = 'menu-item-shortcut';
                hint.textContent = item.shortcut;
                btn.appendChild(hint);
            }
            btn.addEventListener('click', () => this.choose(item.id));
            // The cursor is 1-based (0 means "nothing highlighted"), indexOf is 0-based.
            btn.addEventListener('pointerenter', () => this.highlight(group.items.indexOf(item) + 1));
            popup.appendChild(btn);
        }
        popup.hidden = false;
        // Place it under its title, nudged back on screen when the title is near the right edge.
        const title = /** @type {HTMLElement | null} */ (this._host && this._host.querySelector('[data-menu="' + id + '"]'));
        const box = title ? title.getBoundingClientRect() : { left: 8, bottom: 32 };
        const x = Math.max(4, Math.min(box.left, window.innerWidth - popup.offsetWidth - 8));
        popup.style.left = x + 'px';
        popup.style.top = box.bottom + 'px';
        this._highlightTitles();
    },

    close() {
        this._open = null;
        this._cursor = -1;
        if (this._popup) this._popup.hidden = true;
        this._highlightTitles();
    },

    choose(id) {
        this.close();
        this.run(id);
    },

    _highlightTitles() {
        if (!this._host) return;
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (this._host.querySelectorAll('[data-menu]'))) {
            btn.classList.toggle('open', btn.dataset.menu === this._open);
        }
    },

    /** Escape closes, Down/Up walk the items, Enter runs the highlighted one. */
    onPopupKey(e) {
        if (!this._open || !this._popup || this._popup.hidden) return;
        /** @type {HTMLButtonElement[]} */
        const items = [...this._popup.querySelectorAll('.menu-item')];
        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
            return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            // Wrap around and skip disabled items; bail out when every item is disabled.
            let i = this._cursor;
            for (let guard = 0; guard <= items.length; guard++) {
                i = (i + step + items.length + 1) % (items.length + 1);
                const candidate = i > 0 ? items[i - 1] : null;
                if ((!candidate || !candidate.disabled) && i !== this._cursor) break;
            }
            const picked = (i > 0 && i <= items.length && items[i - 1] && !items[i - 1].disabled) ? i : -1;
            this.highlight(picked);
            return;
        }
        if (e.key === 'Enter' && this._cursor > 0 && items[this._cursor - 1] && !items[this._cursor - 1].disabled) {
            e.preventDefault();
            this.choose(String(items[this._cursor - 1].dataset.command));
        }
    },

    /** The cursor is 1-based over the popup's items, -1 — nothing highlighted. */
    highlight(index) {
        this._cursor = index;
        if (!this._popup) return;
        const items = /** @type {NodeListOf<HTMLButtonElement>} */ (this._popup.querySelectorAll('.menu-item'));
        items.forEach((el, i) => el.classList.toggle('active', i + 1 === index));
    },

    /** Redraw: labels follow the language, Undo/Redo follow the history stacks. */
    render() {
        if (!this._host) return;
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (this._host.querySelectorAll('[data-menu]'))) {
            const group = this.group(btn.dataset.menu);
            if (group) btn.textContent = this.label(group);
        }
        if (this._open) this.open(this._open);
    },

    /** Show a modal dialog listing all keyboard shortcuts. */
    showShortcutsDialog() {
        let modal = document.getElementById('shortcuts-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'shortcuts-modal';
            modal.className = 'shortcuts-modal';
            modal.innerHTML = `
                <div class="shortcuts-modal-content">
                    <div class="shortcuts-modal-header">
                        <span class="shortcuts-modal-title">⌨️ ${this.label({ label: 'Keyboard Shortcuts', labelRu: 'Горячие клавиши' })}</span>
                        <button class="shortcuts-modal-close" id="btn-shortcuts-close">✕</button>
                    </div>
                    <div class="shortcuts-modal-body">
                        <table class="shortcuts-table">
                            <thead>
                                <tr>
                                    <th>${this.label({ label: 'Action', labelRu: 'Действие' })}</th>
                                    <th>${this.label({ label: 'Shortcut', labelRu: 'Сочетание клавиш' })}</th>
                                </tr>
                            </thead>
                            <tbody id="shortcuts-table-body"></tbody>
                        </table>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.querySelector('#btn-shortcuts-close').addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        }
        const tbody = modal.querySelector('#shortcuts-table-body');
        if (tbody) {
            tbody.replaceChildren();
            const isRu = typeof I18N !== 'undefined' && I18N && I18N.lang === 'ru';
            for (const [id, en, ru, key] of this.shortcutList()) {
                const tr = document.createElement('tr');
                const tdAction = document.createElement('td');
                tdAction.textContent = isRu ? ru : en;
                const tdKey = document.createElement('td');
                const badge = document.createElement('kbd');
                badge.className = 'shortcut-badge';
                badge.textContent = key;
                tdKey.appendChild(badge);
                tr.appendChild(tdAction);
                tr.appendChild(tdKey);
                tbody.appendChild(tr);
            }
        }
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = MenuBar;
if (typeof window !== 'undefined') /** @type {any} */ (window).MenuBar = MenuBar;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).MenuBar = MenuBar;