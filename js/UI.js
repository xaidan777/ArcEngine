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
//   parent — id of the element this one sits in ('' or none — the screen): anchor, x and y then
//            count from the PARENT's box, the parent clips it, and hiding the parent hides it too.
//   stretch — 'h' | 'v' | 'both' (sized kinds): the element fills its container on that axis,
//            x (y) is the inset from BOTH edges, w (h) is ignored. A full-screen dim:
//            { kind: 'panel', stretch: 'both', x: 0, y: 0 }.
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
        text: { parent: '', anchor: 'top-left', x: 20, y: 20, text: 'Text', fontSize: 24, color: '#ffffff', shadow: '#000000', alpha: 1, visible: 1 },
        panel: { parent: '', anchor: 'top-left', x: 20, y: 20, w: 240, h: 80, stretch: '', fill: '#10202c', border: '', radius: 10, alpha: 0.7, visible: 1 },
        bar: { parent: '', anchor: 'top-left', x: 20, y: 20, w: 240, h: 18, stretch: '', value: 0.6, color: '#5ad05a', fill: '#10202c', border: '#ffffff', radius: 9, alpha: 1, visible: 1 },
        button: { parent: '', anchor: 'bottom-center', x: 0, y: 40, w: 180, h: 48, stretch: '', text: 'Button', fontSize: 20, color: '#ffffff', fill: '#2a6fb0', border: '', radius: 10, alpha: 1, visible: 1 },
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
        // All elements first, then the nesting: a child may stand before its parent in the file.
        for (const def of this.layout) this.elements.set(def.id, new UIElement(def, old.get(def.id)));
        for (const def of this.layout) this._attach(this.elements.get(def.id));
        for (const def of this.layout) this.elements.get(def.id).apply();
        this.resize();
    },

    // A runtime element from a record that is not in UILayout.js (a copy of a template).
    add(def) {
        if (!this.root || !def || !def.id) return null;
        this.remove(def.id);
        const e = new UIElement(def, null);
        this.elements.set(def.id, e);
        this._attach(e);
        e.apply();
        return e;
    },

    // Removes the element together with everything nested in it.
    remove(id) {
        const e = this.elements.get(id);
        if (!e) return;
        const inside = [...this.elements.values()].filter(c => this.isInside(c.def, id));
        for (const c of inside) this.elements.delete(c.def.id);
        e.el.remove();
        this.elements.delete(id);
    },

    // The element def sits in (def.parent), null — the screen. A missing parent or a cycle in
    // the chain also gives null: a bad record lands on the screen instead of breaking the tree.
    parentOf(def) {
        const seen = new Set([def.id]);
        for (let id = def.parent; id; ) {
            const e = this.elements.get(id);
            if (!e || seen.has(id)) return null;
            seen.add(id);
            id = e.def.parent;
        }
        return def.parent ? this.elements.get(def.parent) : null;
    },

    // Is def nested in the element id — directly or through its ancestors?
    isInside(def, id) {
        for (let e = this.parentOf(def); e; e = this.parentOf(e.def)) if (e.def.id === id) return true;
        return false;
    },

    _attach(e) {
        const parent = this.parentOf(e.def);
        (parent ? parent.el : this.root).appendChild(e.el);
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

    // def.stretch -> the stretched axes; a text has no size of its own to stretch.
    stretchOf(def) {
        const s = def.kind === 'text' ? '' : def.stretch;
        return { h: s === 'h' || s === 'both', v: s === 'v' || s === 'both' };
    },

    // Record -> the top left corner of an element of size w × h in a container W × H (the screen
    // or the parent's inside). On a stretched axis x (y) is the inset, whatever the anchor.
    resolve(def, w, h, W, H) {
        const a = this.parseAnchor(def.anchor), st = this.stretchOf(def), x = Number(def.x) || 0, y = Number(def.y) || 0;
        return {
            left: st.h ? x : a.h === 'right' ? W - x - w : a.h === 'center' ? W / 2 + x - w / 2 : x,
            top: st.v ? y : a.v === 'bottom' ? H - y - h : a.v === 'middle' ? H / 2 + y - h / 2 : y,
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
        const sized = d.kind !== 'text', st = UI.stretchOf(d);
        s.cssText = '';
        s.position = 'absolute';
        s.boxSizing = 'border-box';
        // The container is the parent's box (an absolute element positions its children) or the
        // root. A stretched axis pins both edges with the same inset; w (h) is not used there.
        s.left = st.h || a.h === 'left' ? px(x) : a.h === 'center' ? 'calc(50% + ' + px(x) + ')' : '';
        s.right = st.h || a.h === 'right' ? px(x) : '';
        s.top = st.v || a.v === 'top' ? px(y) : a.v === 'middle' ? 'calc(50% + ' + px(y) + ')' : '';
        s.bottom = st.v || a.v === 'bottom' ? px(y) : '';
        s.transform = 'translate(' + (!st.h && a.h === 'center' ? '-50%' : '0') + ', ' + (!st.v && a.v === 'middle' ? '-50%' : '0') + ')';
        if (sized && !st.h) s.width = px(d.w);
        if (sized && !st.v) s.height = px(d.h);
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
