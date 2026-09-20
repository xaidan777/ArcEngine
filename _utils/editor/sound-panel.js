// sound-panel.js — the Sound tab: the AUDIO_* constants (schema groups with tab: 'sound' —
// the Inspector builds them into #sound-groups) plus the list of files in assets/sounds.
//
// This panel owns the file list: it asks the server once at startup and again when the window
// regains focus (a file dropped into the folder shows up on return). The Objects tab reads the
// same list for the "Sound" section of an object, so nothing is fetched twice.
// A click on a file plays it as a plain effect — the mixer sliders are audible right away.

/** @satisfies {Record<string, any>} */
const SoundPanel = {
    /** @type {string[]} */
    files: [],           // assets/sounds/… paths
    /** @type {any} */
    preview: null,       // the handle of the file being auditioned: a second click stops it
    playing: '',

    init() {
        window.addEventListener('focus', () => this.load());
        window.addEventListener('lang-changed', () => this.render());
        this.render();
        this.load();
    },

    // GET /api/sounds; the list changed — both tabs that show it are redrawn.
    async load() {
        try {
            const j = await (await fetch('/api/sounds')).json();
            const files = j && Array.isArray(j.sounds) ? j.sounds : [];
            if (files.join('\n') === this.files.join('\n')) return;
            this.files = files;
            this.render();
            ObjectsPanel.onSoundsChanged();
        } catch (e) { /* no server (the page was opened as a file): the list stays empty */ }
    },

    // Audition a file: the same Sound3D the game uses, so the mixer and the mute checkbox apply.
    // A click on the file that is playing stops it; a sound that ends by itself clears the mark.
    play(src) {
        if (this.preview) this.preview.stop();
        const again = this.playing === src;
        this.preview = again ? null : Sound3D.play(src, { volume: 1 });
        this.playing = again ? '' : src;
        this.render();
        const watch = () => {
            if (this.playing !== src || !this.preview) return;      // stopped or another file started
            if (this.preview.playing) { setTimeout(watch, 250); return; }
            this.preview = null;
            this.playing = '';
            this.render();
        };
        if (this.preview) setTimeout(watch, 250);
    },

    render() {
        const P = ObjectsPanel, host = document.getElementById('sound-files');
        host.innerHTML = '';
        host.appendChild(P.el('div', 'props-section', I18N.t('snd.files')));
        if (!this.files.length) {
            host.appendChild(P.el('div', 'objects-empty', I18N.t('obj.soundEmpty')));
            return;
        }
        for (const src of this.files) {
            const row = P.el('div', 'object-row' + (this.playing === src ? ' selected' : ''));
            row.append(P.el('span', 'object-name', src.split('/').pop()),
                P.el('span', 'object-file', this.playing === src ? '◼' : '▶'));
            row.title = src + ' — ' + I18N.t('snd.playTitle');
            row.addEventListener('click', () => this.play(src));
            host.appendChild(row);
        }
    },
};
