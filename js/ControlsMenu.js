// js/ControlsMenu.js — Tactical Controls and Keybinding Configuration Overlay.
// Provides a full-screen tactical UI to customize keyboard controls with collision resolution,
// live visual rebinding, and immediate sync with in-game prompts.

/** @satisfies {Record<string, any>} */
const ControlsMenu = {
    container: null,
    visible: false,
    activeRebindAction: null,
    game: null,
    lang: 'ru',

    init() {
        if (this.container) return;

        const overlay = document.createElement('div');
        overlay.id = 'arc-controls-overlay';
        overlay.className = 'arc-controls-overlay';
        overlay.style.display = 'none';

        document.body.appendChild(overlay);
        this.container = overlay;

        // Global key listener for rebinding & ESC close
        window.addEventListener('keydown', e => {
            if (!this.visible) return;

            if (this.activeRebindAction) {
                e.preventDefault();
                e.stopPropagation();

                // If user pressed Escape during rebind, cancel rebind without saving
                if (e.code === 'Escape') {
                    this.activeRebindAction = null;
                    this.render();
                    return;
                }

                // Prevent binding reserved browser combinations
                if (e.code === 'F5' || e.code === 'F12' || (e.ctrlKey && e.code === 'KeyR')) {
                    return;
                }

                // Apply new binding
                KeyBindings.set(this.activeRebindAction, e.code);
                this.activeRebindAction = null;
                this.playFeedback('bind');
                this.render();

                if (this.game && this.game.updateHud) {
                    this.game.updateHud(true);
                }
                return;
            }

            if (e.code === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            }
        }, true);
    },

    open(game = null) {
        this.init();
        this.game = game || (typeof window !== 'undefined' && window.app ? window.app.game : null);
        this.lang = (this.game && this.game.lang) ? this.game.lang : (typeof Store !== 'undefined' ? Store.get('arcengine.game.lang') || 'ru' : 'ru');
        this.activeRebindAction = null;
        this.visible = true;
        this.container.style.display = 'flex';

        if (document.exitPointerLock && document.pointerLockElement) {
            document.exitPointerLock();
        }

        this.render();
    },

    close() {
        if (!this.visible) return;
        this.visible = false;
        this.activeRebindAction = null;
        if (this.container) {
            this.container.style.display = 'none';
        }

        // Return pointer lock if back in live raid
        if (this.game && this.game.phase === 'raid' && !this.game.paused && this.game.canvas?.requestPointerLock) {
            try {
                const p = this.game.canvas.requestPointerLock();
                if (p && p.catch) p.catch(() => {});
            } catch (err) {}
        }
    },

    isOpen() {
        return this.visible;
    },

    playFeedback(type = 'click') {
        try {
            if (typeof ProceduralAudio !== 'undefined') {
                if (type === 'bind' && ProceduralAudio.combat?.playBoltRack) {
                    ProceduralAudio.combat.playBoltRack();
                } else if (ProceduralAudio.foley?.playFootstep) {
                    ProceduralAudio.foley.playFootstep('concrete', 0.25);
                }
            }
        } catch (e) {}
    },

    startRebind(action) {
        this.activeRebindAction = action;
        this.playFeedback('click');
        this.render();
    },

    resetDefaults() {
        KeyBindings.resetDefaults();
        this.activeRebindAction = null;
        this.playFeedback('bind');
        this.render();

        if (this.game && this.game.updateHud) {
            this.game.updateHud(true);
        }
    },

    render() {
        if (!this.container || !this.visible) return;
        const l = this.lang;
        const t = (ru, en) => l === 'en' ? en : ru;

        const categories = [
            { id: 'movement', title: t('ПЕРЕМЕЩЕНИЕ И НАКЛОНЫ', 'MOVEMENT & LEANING') },
            { id: 'combat', title: t('ДЕЙСТВИЯ, ЛУТ И БОЙ', 'ACTIONS, LOOT & COMBAT') },
            { id: 'interface', title: t('ИНТЕРФЕЙС И ГОРЯЧИЕ СЛОТЫ', 'INTERFACE & QUICK SLOTS') }
        ];

        let contentHtml = '';

        for (const cat of categories) {
            const actions = Object.entries(KeyBindings.META).filter(([_, m]) => m.category === cat.id);

            contentHtml += `
                <div class="arc-ctrl-category">
                    <h3 class="arc-ctrl-cat-title">${cat.title}</h3>
                    <div class="arc-ctrl-grid">
            `;

            for (const [action, meta] of actions) {
                const label = t(meta.ru, meta.en);
                const currentKey = KeyBindings.getKeyLabel(action, l);
                const isRebinding = this.activeRebindAction === action;

                contentHtml += `
                    <div class="arc-ctrl-row ${isRebinding ? 'active-rebind' : ''}">
                        <div class="arc-ctrl-label-wrap">
                            <span class="arc-ctrl-label">${label}</span>
                            ${action === 'interact' ? `<span class="arc-ctrl-badge">${t('ОБЫСК / ВХОД', 'LOOT / USE')}</span>` : ''}
                            ${action === 'leanLeft' || action === 'leanRight' ? `<span class="arc-ctrl-badge">${t('НАКЛОН', 'LEAN')}</span>` : ''}
                        </div>
                        <button class="arc-ctrl-key-btn ${isRebinding ? 'rebinding' : ''}" data-rebind="${action}">
                            ${isRebinding ? t('НАЖМИТЕ КЛАВИШУ...', 'PRESS ANY KEY...') : currentKey}
                        </button>
                    </div>
                `;
            }

            contentHtml += `
                    </div>
                </div>
            `;
        }

        this.container.innerHTML = `
            <div class="arc-controls-window">
                <div class="arc-ctrl-header">
                    <div class="arc-ctrl-title-block">
                        <span class="arc-ctrl-tag">SYSTEM CONFIGURATION // TACTICAL INPUT</span>
                        <h2 class="arc-ctrl-title">${t('НАСТРОЙКИ УПРАВЛЕНИЯ', 'CONTROLS & KEYBINDINGS')}</h2>
                        <span class="arc-ctrl-sub">${t('Кликните по клавише для переназначения. Конфликты автоматически разрешаются.', 'Click any key to rebind. Conflicts are automatically resolved.')}</span>
                    </div>
                    <div class="arc-ctrl-header-actions">
                        <button class="arc-ctrl-btn secondary" id="arc-ctrl-reset-btn">${t('СБРОС ПО УМОЛЧАНИЮ', 'RESET DEFAULTS')}</button>
                        <button class="arc-ctrl-btn primary" id="arc-ctrl-close-btn">${t('ЗАКРЫТЬ [ESC]', 'CLOSE [ESC]')}</button>
                    </div>
                </div>

                <div class="arc-ctrl-body">
                    ${contentHtml}
                </div>

                <div class="arc-ctrl-footer">
                    <span>${t('Кнопка «Обыск / Взаимодействие» (по умолчанию F) отвечает за лутание контейнеров, вызов эвакуации и подбор данных.', 'Interact button (default F) searches crates, calls extractions, and collects data drives.')}</span>
                    <span>Q / E: ${t('Наклоны влево и вправо', 'Lean Left and Right')}</span>
                </div>
            </div>
        `;

        // Attach listeners
        const closeBtn = this.container.querySelector('#arc-ctrl-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', () => this.close());

        const resetBtn = this.container.querySelector('#arc-ctrl-reset-btn');
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetDefaults());

        this.container.querySelectorAll('[data-rebind]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-rebind');
                if (action) this.startRebind(action);
            });
        });
    }
};

if (typeof window !== 'undefined') {
    window.ControlsMenu = ControlsMenu;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ControlsMenu;
}
