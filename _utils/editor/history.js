// history.js — undo and redo of editor edits: Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y.
//
// An entry — a pair of undo/redo functions. Consecutive edits with the same key faster than
// MERGE_MS (a slider, typing a number, entering a name) are merged into one: undo — from the
// first, redo — from the last. While undo/redo is running, new entries are not accepted (busy):
// the old value is applied through the same paths as the edit.
// Who writes: main.js (Inspector.apply — the Global Settings constants) and
// objects-panel.js (Objects layout snapshots). The name is not History: that is the name of
// a built-in browser class (window.History).

/** @satisfies {Record<string, any>} */
const EditHistory = {
    MERGE_MS: 800,
    LIMIT: 200,
    undoStack: [],
    redoStack: [],
    busy: false,
    _batch: null,

    record(key, undo, redo) {
        if (this.busy) return;
        if (this._batch) { this._batch.push({ undo, redo }); return; }
        const now = performance.now();
        const top = this.undoStack[this.undoStack.length - 1];
        if (key && top && top.key === key && now - top.time < this.MERGE_MS) {
            top.redo = redo;
            top.time = now;
        } else {
            this.undoStack.push({ key, undo, redo, time: now });
            if (this.undoStack.length > this.LIMIT) this.undoStack.shift();
        }
        this.redoStack = [];
    },

    // All entries inside fn — one history step (for example, "Revert" of all constants).
    batch(fn) {
        if (this._batch || this.busy) { fn(); return; }
        const list = this._batch = [];
        try { fn(); } finally { this._batch = null; }
        if (!list.length) return;
        this.undoStack.push({
            key: null, time: performance.now(),
            undo: () => { for (let i = list.length - 1; i >= 0; i--) list[i].undo(); },
            redo: () => { for (const e of list) e.redo(); },
        });
        this.redoStack = [];
    },

    undo() { return this._step(this.undoStack, this.redoStack, 'undo'); },
    redo() { return this._step(this.redoStack, this.undoStack, 'redo'); },

    _step(from, to, dir) {
        const entry = from.pop();
        if (!entry) return false;
        this.busy = true;
        try { entry[dir](); } finally { this.busy = false; }
        entry.key = null;   // an undone entry is not merged with a new edit
        to.push(entry);
        return true;
    },

    init() {
        window.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const t = /** @type {HTMLInputElement | null} */ (e.target);
            // Text and numbers in fields are undone by the browser itself.
            if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|number|search)$/.test(t.type)))) return;
            // The key — by e.code (in the Russian keyboard layout the key of Z is "я"); without code — by key.
            const is = (letter) => e.code ? e.code === 'Key' + letter : String(e.key).toUpperCase() === letter;
            if (is('Z') && !e.shiftKey) { e.preventDefault(); this.undo(); }
            else if ((is('Z') && e.shiftKey) || is('Y')) { e.preventDefault(); this.redo(); }
        });
    },
};
