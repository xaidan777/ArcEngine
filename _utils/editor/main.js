// main.js — the editor entry point: UI language -> game constants -> inspector
// -> location view. The order is mandatory: before EditorLoader.load() the globals
// CAMERA_*/WORLD3D_*/TERRAIN_* do not exist.

window.addEventListener('DOMContentLoaded', async () => {
    I18N.init();
    try {
        await EditorLoader.load();
        EditHistory.init();
        PaneTabs.init();
        Inspector.init();
        // The inspector edits window globals directly; the scene needs an event to apply
        // the edit, the history — an entry (undo — with the previous value via the same path).
        const origApply = Inspector.apply.bind(Inspector);
        Inspector.apply = (f, value, opts) => {
            const before = Inspector.get(f.name);
            origApply(f, value, opts);
            window.dispatchEvent(new CustomEvent('constants-changed', { detail: { name: f.name } }));
            if (before !== value) EditHistory.record('const:' + f.name, () => Inspector.apply(f, before), () => Inspector.apply(f, value));
        };
        const origRevert = Inspector.revertAll.bind(Inspector);
        Inspector.revertAll = () => EditHistory.batch(origRevert);
        Lab.init();
        Onboarding.init();   // last: the tour greets a first run, and only over a working editor
    } catch (e) {
        const el = document.getElementById('boot-error');
        el.textContent = I18N.t('boot.failed') + '\n\n' + ((e && e.message) || e) + '\n\n' + I18N.t('boot.hint');
        el.classList.add('visible');
        console.error(e);
    }
});
