// history.js — отмена и повтор правок редактора: Ctrl+Z, Ctrl+Shift+Z и Ctrl+Y.
//
// Запись — пара функций undo/redo. Правки с одним ключом подряд быстрее MERGE_MS
// (слайдер, набор числа, ввод имени) склеиваются в одну: undo — от первой, redo —
// от последней. Пока выполняется undo/redo, новые записи не принимаются (busy):
// старое значение применяется теми же путями, что и правка.
// Кто пишет: main.js (Inspector.apply — константы Global Settings) и
// objects-panel.js (снимки раскладки Objects).

const History = {
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

    // Все записи внутри fn — один шаг истории (например, «Откатить» всех констант).
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
        entry.key = null;   // отменённое не склеивается с новой правкой
        to.push(entry);
        return true;
    },

    init() {
        window.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const t = e.target;
            // Текст и числа в полях отменяет сам браузер.
            if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|number|search)$/.test(t.type)))) return;
            // Клавиша — по e.code (в русской раскладке key у Z — «я»); без code — по key.
            const is = (letter) => e.code ? e.code === 'Key' + letter : String(e.key).toUpperCase() === letter;
            if (is('Z') && !e.shiftKey) { e.preventDefault(); this.undo(); }
            else if ((is('Z') && e.shiftKey) || is('Y')) { e.preventDefault(); this.redo(); }
        });
    },
};
