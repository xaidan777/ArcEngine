// onboarding.js — the welcome tour: six slides about what the kit is and how the editor is
// laid out. The first run opens it by itself (the localStorage flag below), the "?" button in
// the top bar reopens it at any time.
//
// A slide points at the editor itself: the part it talks about keeps its brightness inside the
// frame of #onb-spot, everything else is dimmed by that element's huge box-shadow, and the card
// flies into the roomiest free space beside it (the inspector is on the right — the card steps
// to its left). A slide with a `tab` field also switches the right pane to that tab; the tab the
// user had open comes back on close.
//
// Slide text lives in i18n.js under onb.<id>.*: title and p1…pN — one key per paragraph, so
// both dictionaries stay flat. The card carries its own EN/RU switch: the tour is the first
// thing a newcomer sees, and the one in the top bar is dimmed out at that moment.

/** @satisfies {Record<string, any>} */
const Onboarding = {
    KEY: 'arcengine.editor.onboarded',
    PAD: 4,       // px of air between the highlighted element and its frame
    GAP: 16,      // px between the frame and the card, and from the card to the window edge

    SLIDES: [
        { id: 'intro', paras: 3, hero: true },
        { id: 'view', paras: 2, target: '#view-pane' },
        { id: 'settings', paras: 2, target: '#inspector-pane', tab: 'settings' },
        { id: 'objects', paras: 2, target: '#inspector-pane', tab: 'objects' },
        { id: 'ui', paras: 2, target: '#inspector-pane', tab: 'ui' },
        { id: 'next', paras: 3, target: '#inspector-pane', tab: 'sound' },
    ],

    index: 0,
    backTab: '',

    init() {
        document.getElementById('btn-help').addEventListener('click', () => this.open());
        document.getElementById('onb-close').addEventListener('click', () => this.close());
        document.getElementById('onb-prev').addEventListener('click', () => this.go(this.index - 1));
        document.getElementById('onb-next').addEventListener('click', () => this.go(this.index + 1));
        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#onb-lang [data-lang]'))) {
            btn.addEventListener('click', () => I18N.set(btn.dataset.lang));
        }
        const hide = /** @type {HTMLInputElement} */ (document.getElementById('onb-hide-box'));
        hide.addEventListener('change', () => this.setSeen(hide.checked));

        const root = document.getElementById('onboarding');
        root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
        window.addEventListener('keydown', (e) => this.onKey(e), true);   // before the camera and the panels
        window.addEventListener('resize', () => { if (!root.hidden) this.place(true); });
        window.addEventListener('lang-changed', () => { if (!root.hidden) this.render(); });

        let seen = null;
        try { seen = localStorage.getItem(this.KEY); } catch (e) { /* storage is unavailable: it will greet again */ }
        if (!seen) this.open();
    },

    // Opening counts as seen: an Esc by accident must not turn the tour into a nag. The
    // "don't show again" box is the live view of that flag — unticking it brings the tour back.
    open() {
        this.backTab = PaneTabs.current;
        this.index = 0;
        this.setSeen(true);
        /** @type {HTMLInputElement} */ (document.getElementById('onb-hide-box')).checked = true;
        document.getElementById('onboarding').hidden = false;
        this.render(true);
    },

    close() {
        document.getElementById('onboarding').hidden = true;
        if (this.backTab && this.backTab !== PaneTabs.current) PaneTabs.show(this.backTab);
    },

    setSeen(on) {
        try {
            if (on) localStorage.setItem(this.KEY, '1');
            else localStorage.removeItem(this.KEY);
        } catch (e) { /* storage is unavailable: the choice lasts until F5 */ }
    },

    // Past the last slide the tour is over: "Got it" on it just closes.
    go(i) {
        if (i >= this.SLIDES.length) { this.close(); return; }
        this.index = Math.max(0, i);
        this.render();
    },

    // Keys of the tour; e.code is missing in some automation, hence e.key as a fallback.
    onKey(e) {
        if (document.getElementById('onboarding').hidden) return;
        const code = e.code || e.key;
        const step = { ArrowRight: 1, Enter: 1, Space: 1, ' ': 1, ArrowLeft: -1 }[code];
        if (code === 'Escape') this.close();
        else if (step) this.go(this.index + step);
        else return;                  // everything else stays the browser's (F5, Ctrl+…)
        e.preventDefault();
        e.stopPropagation();
    },

    render(instant) {
        const s = this.SLIDES[this.index], P = ObjectsPanel, last = this.index === this.SLIDES.length - 1;
        if (s.tab) PaneTabs.show(s.tab);

        const body = document.getElementById('onb-body');
        body.innerHTML = '';
        if (s.hero) body.appendChild(this.hero());
        body.appendChild(P.el('div', 'onb-step', I18N.t('onb.step', { n: this.index + 1, total: this.SLIDES.length })));
        body.appendChild(P.el('h2', 'onb-title', I18N.t('onb.' + s.id + '.title')));
        for (let i = 1; i <= s.paras; i++) body.appendChild(P.el('p', 'onb-p', I18N.t('onb.' + s.id + '.p' + i)));

        const dots = document.getElementById('onb-dots');
        dots.innerHTML = '';
        this.SLIDES.forEach((sl, i) => {
            const dot = /** @type {HTMLButtonElement} */ (P.el('button', 'onb-dot' + (i === this.index ? ' active' : '')));
            dot.title = I18N.t('onb.' + sl.id + '.title');
            dot.addEventListener('click', () => this.go(i));
            dots.appendChild(dot);
        });

        for (const btn of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#onb-lang [data-lang]'))) {
            btn.classList.toggle('active', btn.dataset.lang === I18N.lang);
        }
        /** @type {HTMLButtonElement} */ (document.getElementById('onb-prev')).disabled = this.index === 0;
        document.getElementById('onb-prev').textContent = I18N.t('onb.prev');
        document.getElementById('onb-next').textContent = I18N.t(last ? 'onb.done' : 'onb.next');
        this.place(instant);
    },

    // Slide 1: the wordmark — the whole window is the subject, there is nothing to point at yet.
    hero() {
        const P = ObjectsPanel, box = P.el('div', 'onb-hero');
        const mark = P.el('div', 'onb-hero-mark');
        mark.append(P.el('span', 'onb-hero-arc', 'ARC'), document.createTextNode('ENGINE'));
        box.append(mark, P.el('div', 'onb-hero-tag', I18N.t('onb.intro.tag')));
        return box;
    },

    // The frame around the slide's target (no target — a blank point: the shadow dims the whole
    // window) and the card beside it. instant — put both in place without the flight: the first
    // frame of the tour and a window resize.
    place(instant) {
        const card = /** @type {HTMLElement} */ (document.getElementById('onb-card'));
        const spot = /** @type {HTMLElement} */ (document.getElementById('onb-spot'));
        const s = this.SLIDES[this.index];
        const el = s.target ? document.querySelector(s.target) : null;
        const W = window.innerWidth, H = window.innerHeight, M = this.GAP, PAD = this.PAD;
        if (instant) { card.style.transition = 'none'; spot.style.transition = 'none'; }

        // The frame keeps PAD of air around the element, but stays inside the window: a pane
        // reaching the edge would otherwise have its frame drawn outside and cut off.
        const r = el ? el.getBoundingClientRect() : null;
        const box = r ? {
            left: Math.max(2, r.left - PAD), top: Math.max(2, r.top - PAD),
            right: Math.min(W - 2, r.right + PAD), bottom: Math.min(H - 2, r.bottom + PAD),
        } : null;
        spot.classList.toggle('blank', !box);
        spot.style.left = (box ? box.left : W / 2) + 'px';
        spot.style.top = (box ? box.top : H / 2) + 'px';
        spot.style.width = (box ? box.right - box.left : 0) + 'px';
        spot.style.height = (box ? box.bottom - box.top : 0) + 'px';

        const cw = card.offsetWidth, ch = card.offsetHeight;
        let left = (W - cw) / 2, top = (H - ch) / 2;
        if (r) {
            // Four free strips around the target: the card takes the widest one it fits into.
            // Fits nowhere (the view fills the window) — it sits in the middle of the target.
            const spots = [
                { gap: r.left, ok: r.left - M * 2 >= cw, left: r.left - M - cw, top: r.top + (r.height - ch) / 2 },
                { gap: W - r.right, ok: W - r.right - M * 2 >= cw, left: r.right + M, top: r.top + (r.height - ch) / 2 },
                { gap: H - r.bottom, ok: H - r.bottom - M * 2 >= ch, left: r.left + (r.width - cw) / 2, top: r.bottom + M },
                { gap: r.top, ok: r.top - M * 2 >= ch, left: r.left + (r.width - cw) / 2, top: r.top - M - ch },
            ];
            const best = spots.filter(p => p.ok).sort((a, b) => b.gap - a.gap)[0];
            left = best ? best.left : r.left + (r.width - cw) / 2;
            top = best ? best.top : r.top + (r.height - ch) / 2;
        }
        card.style.left = Math.round(Math.max(M, Math.min(W - cw - M, left))) + 'px';
        card.style.top = Math.round(Math.max(M, Math.min(H - ch - M, top))) + 'px';
        if (instant) { void card.offsetWidth; card.style.transition = ''; spot.style.transition = ''; }
    },
};
