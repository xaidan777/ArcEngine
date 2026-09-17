// main.js — точка входа редактора: язык интерфейса -> константы игры -> инспектор
// -> вид локации. Порядок обязателен: до EditorLoader.load() глобалов
// CAMERA_*/WORLD3D_*/TERRAIN_* не существует.

window.addEventListener('DOMContentLoaded', async () => {
    I18N.init();
    try {
        await EditorLoader.load();
        EditHistory.init();
        PaneTabs.init();
        Inspector.init();
        // Инспектор правит window-глобалы напрямую; сцене нужно событие, чтобы применить
        // правку, истории — запись (undo — прежним значением тем же путём).
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
    } catch (e) {
        const el = document.getElementById('boot-error');
        el.textContent = I18N.t('boot.failed') + '\n\n' + ((e && e.message) || e) + '\n\n' + I18N.t('boot.hint');
        el.classList.add('visible');
        console.error(e);
    }
});
