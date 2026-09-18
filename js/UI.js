// UI.js — the game's UI (HUD): DOM elements over the 3D canvas, laid out by UILayout.js.
//
// RULE: every UI element is a UI_LAYOUT record (js/UILayout.js), placed and styled in the
// editor's UI tab. Game code does not create, position or style HUD DOM itself — it takes an
// element by id and feeds it data:
//     UI.get('score').setText('10');  UI.get('hp').setValue(0.7);
//     UI.get('start').onClick(() => …);  UI.get('hint').show(false);
// Many elements of one kind (inventory slots): a template record in UILayout.js +
//     UI.add(Object.assign({}, UI.def('slot'), { id: 'slot2', x: 140 }));
//
// Record: { id, kind, anchor, x, y, w, h, … } (the full field list — UI.DEFAULTS).
//   kind   — 'text' | 'panel' | 'bar' | 'button'.
//   anchor — one of 9 screen points ('top-left' … 'bottom-right'): x and y go from it to THE
//            SAME point of the element — inward from a screen edge, signed from the center.
//            A 'bottom-right' element at x 20, y 20 keeps its bottom right corner 20 px from
//            the screen corner at any screen size.
//   w, h   — size in px; a text sizes itself by its content.
//   Colors — '#rrggbb' strings, '' — none. Records go in drawing order: later — on top.
// SCALE: layout numbers are px of a screen UI_REF_HEIGHT tall — the whole UI scales with the
//   real height (a 1440 px screen draws a 720 px layout twice as big). UI_REF_HEIGHT = 0 — CSS px.

/** @satisfies {Record<string, any>} */
const UI = {
    ANCHORS: ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right'],
    KINDS: ['text', 'panel', 'bar', 'button'],
    FONT: 'system-ui, "Segoe UI", Roboto, sans-serif',

    // Fields of a record by kind and their defaults — a new element in the editor starts from them.
    DEFAULTS: {
        text: { anchor: 'top-left', x: 20, y: 20, text: 'Text', fontSize: 24, color: '#ffffff', shadow: '#000000', alpha: 1, visible: 1 },
        panel: { anchor: 'top-left', x: 20, y: 20, w: 240, h: 80, fill: '#10202c', border: '', radius: 10, alpha: 0.7, visible: 1 },
        bar: { anchor: 'top-left', x: 20, y: 20, w: 240, h: 18, value: 0.6, color: '#5ad05a', fill: '#10202c', border: '#ffffff', radius: 9, alpha: 1, visible: 1 },
        button: { anchor: 'bottom-center', x: 0, y: 40, w: 180, h: 48, text: 'Button', fontSize: 20, color: '#ffffff', fill: '#2a6fb0', border: '', radius: 10, alpha: 1, visible: 1 },
    },

    /** @type {HTMLElement | null} */
    root: null,
    /** @type {HTMLCanvasElement | null} */
    canvas: null,
    /** @type {UIRecord[]} */
    layout: [],
    /** @type {Map<string, UIElement>} */
    elements: new Map(),
    editing: false,          // the editor's UI tab: every element catches the pointer, buttons do not fire
    /** @type {ResizeObserver | null} */
    _observer: null,

    // canvas — the 3D canvas the UI lies over; layout — records (UI_LAYOUT by default).
    init(canvas, layout) {
        this.dispose();
        this.canvas = canvas;
        const root = this.root = document.createElement('div');
        root.className = 'arc-ui';
        Object.assign(root.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none', transformOrigin: '0 0',
            fontFamily: this.FONT, userSelect: 'none', webkitUserSelect: 'none' });
        (canvas.parentElement || document.body).appendChild(root);
        if (typeof ResizeObserver !== 'undefined') {
            this._observer = new ResizeObserver(() => this.resize());
            this._observer.observe(canvas);
        }
        this.applyLayout(layout || (typeof UI_LAYOUT !== 'undefined' ? UI_LAYOUT : []));
        return this;
    },

    dispose() {
        if (this._observer) this._observer.disconnect();
        if (this.root) this.root.remove();
        this._observer = null;
        this.root = null;
        this.canvas = null;
        this.elements.clear();
    },

    get(id) {
        return this.elements.get(id) || null;
    },

    // The record of an element — a template for UI.add.
    def(id) {
        return this.layout.find(d => d.id === id) || null;
    },

    // Rebuild every element from the records (the editor — after an edit). What the game has
    // set — text, value, visibility, click handler — survives by id.
    applyLayout(layout) {
        if (layout) this.layout = layout;
        if (!this.root) return;
        const old = this.elements;
        this.elements = new Map();
        this.root.textContent = '';
        for (const def of this.layout) this._create(def, old.get(def.id));
        this.resize();
    },

    // A runtime element from a record that is not in UILayout.js (a copy of a template).
    add(def) {
        if (!this.root || !def || !def.id) return null;
        this.remove(def.id);
        return this._create(def, null);
    },

    remove(id) {
        const e = this.elements.get(id);
        if (!e) return;
        e.el.remove();
        this.elements.delete(id);
    },

    _create(def, prev) {
        const e = new UIElement(def, prev);
        this.elements.set(def.id, e);
        this.root.appendChild(e.el);
        e.apply();
        return e;
    },

    // UI px per CSS px: screen height / UI_REF_HEIGHT.
    scale() {
        const ref = typeof UI_REF_HEIGHT !== 'undefined' ? UI_REF_HEIGHT : 720;
        const h = this.canvas ? this.canvas.clientHeight : 0;
        return ref > 0 && h > 0 ? h / ref : 1;
    },

    // The root covers the canvas; its inner size is the screen in layout px.
    resize() {
        const c = this.canvas, r = this.root;
        if (!c || !r) return;
        const s = this.scale();
        r.style.left = c.offsetLeft + 'px';
        r.style.top = c.offsetTop + 'px';
        r.style.width = (c.clientWidth / s) + 'px';
        r.style.height = (c.clientHeight / s) + 'px';
        r.style.transform = 'scale(' + s + ')';
    },

    // Screen size in layout px.
    size() {
        const s = this.scale(), c = this.canvas;
        return { w: c ? c.clientWidth / s : 0, h: c ? c.clientHeight / s : 0 };
    },

    // --- Anchor math (no DOM — tests/ui.test.mjs) -------------------------------------

    // 'bottom-right' -> { v: 'bottom', h: 'right' }; garbage -> top-left.
    parseAnchor(anchor) {
        const a = this.ANCHORS.includes(anchor) ? anchor : 'top-left', p = a.split('-');
        return { v: p[0], h: p[1] };
    },

    // Record -> the top left corner of an element of size w × h on a screen W × H.
    resolve(def, w, h, W, H) {
        const a = this.parseAnchor(def.anchor), x = Number(def.x) || 0, y = Number(def.y) || 0;
        return {
            left: a.h === 'right' ? W - x - w : a.h === 'center' ? W / 2 + x - w / 2 : x,
            top: a.v === 'bottom' ? H - y - h : a.v === 'middle' ? H / 2 + y - h / 2 : y,
        };
    },

    // The inverse: where the element stands -> x, y of the record for the given anchor. The editor
    // changes the anchor through it, so the element stays where it was.
    toStored(anchor, left, top, w, h, W, H) {
        const a = this.parseAnchor(anchor);
        return {
            x: a.h === 'right' ? W - left - w : a.h === 'center' ? left + w / 2 - W / 2 : left,
            y: a.v === 'bottom' ? H - top - h : a.v === 'middle' ? top + h / 2 - H / 2 : top,
        };
    },
};

// One UI element: a record (def) + its DOM + what the game has set at run time.
class UIElement {
    /** @param {UIRecord} def @param {UIElement | null} prev — the same id before a rebuild */
    constructor(def, prev) {
        this.def = def;
        this.el = document.createElement('div');
        this.el.dataset.ui = def.id;
        /** @type {HTMLElement | null} */
        this.inner = null;       // bar: the filled part; text and button: the label
        this._text = prev ? prev._text : null;
        this._value = prev ? prev._value : null;
        this._shown = prev ? prev._shown : null;
        this._click = prev ? prev._click : null;
        this.el.addEventListener('click', (e) => {
            if (UI.editing || this.def.kind !== 'button' || !this._click) return;
            e.stopPropagation();
            this._click(this);
        });
    }

    setText(text) { this._text = String(text); this.apply(); return this; }

    // Bar fill 0..1.
    setValue(v) { this._value = Math.max(0, Math.min(1, Number(v) || 0)); this.apply(); return this; }

    show(on) { this._shown = on !== false; this.apply(); return this; }

    onClick(fn) { this._click = fn || null; return this; }

    get visible() {
        return this._shown != null ? this._shown : this.def.visible !== 0;
    }

    // Record + run-time state -> DOM. Cheap: called on every edit and every setText.
    apply() {
        const d = this.def, s = this.el.style, a = UI.parseAnchor(d.anchor);
        const x = Number(d.x) || 0, y = Number(d.y) || 0, px = (v) => (Number(v) || 0) + 'px';
        const sized = d.kind !== 'text';
        s.cssText = '';
        s.position = 'absolute';
        s.boxSizing = 'border-box';
        s.left = a.h === 'left' ? px(x) : a.h === 'center' ? 'calc(50% + ' + px(x) + ')' : '';
        s.right = a.h === 'right' ? px(x) : '';
        s.top = a.v === 'top' ? px(y) : a.v === 'middle' ? 'calc(50% + ' + px(y) + ')' : '';
        s.bottom = a.v === 'bottom' ? px(y) : '';
        s.transform = 'translate(' + (a.h === 'center' ? '-50%' : '0') + ', ' + (a.v === 'middle' ? '-50%' : '0') + ')';
        if (sized) { s.width = px(d.w); s.height = px(d.h); }
        s.opacity = String(d.alpha == null ? 1 : Math.max(0, Math.min(1, Number(d.alpha))));
        s.display = this.visible || UI.editing ? 'block' : 'none';
        if (UI.editing && !this.visible) s.opacity = String(Number(s.opacity) * 0.35);
        s.pointerEvents = UI.editing || d.kind === 'button' ? 'auto' : 'none';
        s.cursor = UI.editing ? 'move' : d.kind === 'button' ? 'pointer' : '';

        if (sized) {
            s.background = d.fill || 'transparent';
            s.border = d.border ? '2px solid ' + d.border : 'none';
            s.borderRadius = px(d.radius);
            s.overflow = 'hidden';
        }
        const label = d.kind === 'text' || d.kind === 'button';
        if (label || d.kind === 'bar') {
            if (!this.inner) {
                this.inner = document.createElement('div');
                this.el.appendChild(this.inner);
            }
        } else if (this.inner) {
            this.inner.remove();
            this.inner = null;
        }
        if (label) {
            const t = this.inner.style;
            t.cssText = '';
            this.inner.textContent = this._text != null ? this._text : String(d.text == null ? '' : d.text);
            t.whiteSpace = 'pre';
            t.fontSize = px(d.fontSize || 20);
            t.fontWeight = '600';
            t.lineHeight = '1.2';
            t.color = d.color || '#ffffff';
            t.textAlign = a.h === 'center' ? 'center' : a.h;
            if (d.shadow) t.textShadow = '0 1px 2px ' + d.shadow + ', 0 0 3px ' + d.shadow;
            if (d.kind === 'button') Object.assign(t, { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' });
        } else if (d.kind === 'bar') {
            const v = this._value != null ? this._value : Math.max(0, Math.min(1, Number(d.value) || 0));
            this.inner.textContent = '';
            this.inner.style.cssText = 'height: 100%; width: ' + (v * 100) + '%; background: ' + (d.color || '#5ad05a') + ';';
        }
    }
}
