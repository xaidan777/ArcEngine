// loader.js — loading the REAL game constants with live editing possible.
//
// The problem: Constants.js declares top-level `const`s — these are lexical
// globals, they can be neither reassigned nor shadowed via window.X (a lexical
// binding is stronger than a window property). And the engine modules read constants as
// free variables (World3D.cfg(), CameraController.cfg()).
//
// The solution: fetch the Constants.js source over the network, replace `const ` with `var `
// (only at line starts — inner consts inside IIFEs are not touched) and execute it
// with an indirect eval in the global scope. A top-level var in sloppy mode
// creates WRITABLE window properties — the inspector edits them directly,
// and the modules see the new value on the next read.
//
// The file itself is not changed by this — edits go into it only on the
// "Save" button through POST /api/save-constants.

/** @satisfies {Record<string, any>} */
const EditorLoader = {
    async load() {
        const resp = await fetch('/js/Constants.js', { cache: 'no-store' });
        if (!resp.ok) throw new Error(I18N.t('boot.noConstants', { status: resp.status }));
        let src = await resp.text();
        src = src.replace(/^\uFEFF/, '');
        src = src.replace(/^const\s+/gm, 'var ');
        (0, eval)(src); // indirect eval = global scope
        if (typeof /** @type {any} */ (window).WORLD3D_TOON !== 'number') {
            throw new Error(I18N.t('boot.badConstants'));
        }
    },
};
