// loader.js — загрузка НАСТОЯЩИХ констант игры с возможностью live-правки.
//
// Проблема: Constants.js объявляет верхнеуровневые `const` — это лексические
// глобалы, их нельзя ни переприсвоить, ни перекрыть через window.X (лексическая
// привязка сильнее свойства window). А модули движка читают константы как
// свободные переменные (World3D.cfg(), CameraController.cfg()).
//
// Решение: тянем исходник Constants.js по сети, меняем `const ` на `var `
// (только в началах строк — внутренние const в IIFE не трогаются) и исполняем
// косвенным eval в глобальной области. Верхнеуровневый var в sloppy mode
// создаёт ПЕРЕЗАПИСЫВАЕМЫЕ свойства window — инспектор правит их напрямую,
// и модули видят новое значение при следующем чтении.
//
// Сам файл при этом не меняется — правки уезжают в него только по кнопке
// «Сохранить» через POST /api/save-constants.

/** @satisfies {Record<string, any>} */
const EditorLoader = {
    async load() {
        const resp = await fetch('/js/Constants.js', { cache: 'no-store' });
        if (!resp.ok) throw new Error(I18N.t('boot.noConstants', { status: resp.status }));
        let src = await resp.text();
        src = src.replace(/^\uFEFF/, '');
        src = src.replace(/^const\s+/gm, 'var ');
        (0, eval)(src); // косвенный eval = глобальная область видимости
        if (typeof /** @type {any} */ (window).WORLD3D_TOON !== 'number') {
            throw new Error(I18N.t('boot.badConstants'));
        }
    },
};
