// debug-tools.js — the view toolbar's debug corner: the render mode select (Debug3D.setMode)
// and the "Lint scene" button (Debug3D.lint) with a results panel over the view. Binds itself:
// lab.js and main.js know nothing about it. Finding texts come from Debug3D and stay English,
// like the console and the server log; only the chrome is translated.

/** @satisfies {Record<string, any>} */
const DebugTools = {
    busy: false,

    init() {
        const mode = /** @type {HTMLSelectElement | null} */ (document.getElementById('debug-mode'));
        const lint = document.getElementById('btn-lint');
        if (!mode || !lint) return;
        mode.addEventListener('change', () => {
            if (World3D.view) Debug3D.setMode(mode.value);
            mode.blur();                     // camera keys work again
        });
        lint.addEventListener('click', () => this.runLint());
        window.addEventListener('lang-changed', () => this.hide());
    },

    async runLint() {
        if (this.busy || !World3D.view) return;
        this.busy = true;
        try {
            // hold() keeps the eye above the editor's ground, not the game's.
            if (typeof Lab !== 'undefined' && Lab.location) Debug3D.terrain = Lab.location.terrain;
            const r = await Debug3D.lint();
            this.show(r.findings, r.stats);
        } catch (e) {
            Toast.show(I18N.t('lint.failed', { err: (e && e.message) || e }), true);
        } finally {
            this.busy = false;
        }
    },

    show(findings, stats) {
        const panel = document.getElementById('lint-panel');
        if (!panel) return;
        panel.textContent = '';
        const head = document.createElement('div');
        head.className = 'lint-head';
        const n = (level) => findings.filter(f => f.level === level).length;
        head.textContent = findings.length
            ? I18N.t('lint.summary', { errors: n('error'), warns: n('warn'), notes: n('info') })
            : I18N.t('lint.clean');
        const close = document.createElement('button');
        close.textContent = '×';
        close.title = I18N.t('lint.close');
        close.addEventListener('click', () => this.hide());
        head.appendChild(close);
        panel.appendChild(head);
        if (stats) {
            const s = document.createElement('div');
            s.className = 'lint-stats';
            s.textContent = I18N.t('lint.stats', { meshes: stats.meshes, tris: Math.round(stats.triangles / 1000), lights: stats.lights });
            panel.appendChild(s);
        }
        for (const f of findings) {
            const row = document.createElement('div');
            row.className = 'lint-row lint-' + f.level;
            const tag = document.createElement('b');
            tag.textContent = f.code + ' · ' + f.target;
            row.appendChild(tag);
            row.appendChild(document.createTextNode(' — ' + f.message));
            panel.appendChild(row);
        }
        panel.hidden = false;
    },

    hide() {
        const panel = document.getElementById('lint-panel');
        if (panel) panel.hidden = true;
    }
};

window.addEventListener('DOMContentLoaded', () => DebugTools.init());
