// js/KeyBindings.js — Central Keybindings and Controls Management for Blackwater Protocol / ArcEngine.
// Provides persistent key mappings, human-readable labels, action checking, and conflict resolution.

/** @satisfies {Record<string, any>} */
const KeyBindings = {
    STORAGE_KEY: 'arcengine.controls.v1',

    DEFAULTS: {
        // Movement
        moveForward: 'KeyW',
        moveBackward: 'KeyS',
        moveLeft: 'KeyA',
        moveRight: 'KeyD',
        sprint: 'ShiftLeft',
        jump: 'Space',
        crouch: 'KeyC',
        prone: 'KeyZ',
        leanLeft: 'KeyQ',
        leanRight: 'KeyE',

        // Actions & Combat
        interact: 'KeyF',     // Loot, search, pickup, call extraction, unlock bunker hatch, revive
        reload: 'KeyR',
        heal: 'KeyH',
        grenade: 'KeyG',
        melee: 'KeyV',

        // Interface & Navigation
        inventory: 'Tab',
        map: 'KeyM',

        // Quick Slots
        slot1: 'Digit1',
        slot2: 'Digit2',
        slot3: 'Digit3',
        slot4: 'Digit4'
    },

    META: {
        moveForward: { ru: 'Движение вперед', en: 'Move Forward', category: 'movement' },
        moveBackward: { ru: 'Движение назад', en: 'Move Backward', category: 'movement' },
        moveLeft: { ru: 'Движение влево', en: 'Move Left', category: 'movement' },
        moveRight: { ru: 'Движение вправо', en: 'Move Right', category: 'movement' },
        sprint: { ru: 'Спринт / Бег', en: 'Sprint', category: 'movement' },
        jump: { ru: 'Прыжок', en: 'Jump', category: 'movement' },
        crouch: { ru: 'Присесть', en: 'Crouch', category: 'movement' },
        prone: { ru: 'Лечь', en: 'Prone', category: 'movement' },
        leanLeft: { ru: 'Наклон влево', en: 'Lean Left', category: 'movement' },
        leanRight: { ru: 'Наклон вправо', en: 'Lean Right', category: 'movement' },

        interact: { ru: 'Обыск / Взаимодействие', en: 'Interact / Loot', category: 'combat' },
        reload: { ru: 'Перезарядка оружия', en: 'Reload Weapon', category: 'combat' },
        heal: { ru: 'Быстрое лечение (Аптечка)', en: 'Quick Heal (Medkit)', category: 'combat' },
        grenade: { ru: 'Бросок гранаты', en: 'Throw Grenade', category: 'combat' },
        melee: { ru: 'Удар в ближнем бою', en: 'Melee Strike', category: 'combat' },

        inventory: { ru: 'Рюкзак / Снаряжение', en: 'Backpack / Inventory', category: 'interface' },
        map: { ru: 'Тактическая карта', en: 'Tactical Map', category: 'interface' },
        slot1: { ru: 'Быстрый слот 1', en: 'Quick Slot 1', category: 'interface' },
        slot2: { ru: 'Быстрый слот 2', en: 'Quick Slot 2', category: 'interface' },
        slot3: { ru: 'Быстрый слот 3', en: 'Quick Slot 3', category: 'interface' },
        slot4: { ru: 'Быстрый слот 4', en: 'Quick Slot 4', category: 'interface' }
    },

    CATEGORIES: {
        movement: { ru: 'ПЕРЕМЕЩЕНИЕ', en: 'MOVEMENT' },
        combat: { ru: 'ДЕЙСТВИЯ И БОЙ', en: 'ACTIONS & COMBAT' },
        interface: { ru: 'ИНТЕРФЕЙС И СЛОТЫ', en: 'INTERFACE & SLOTS' }
    },

    /** @type {Record<string, string>} */
    current: {},
    /** @type {Array<Function>} */
    _listeners: [],

    init() {
        this.current = Object.assign({}, this.DEFAULTS);
        try {
            if (typeof Store !== 'undefined' && Store.getJSON) {
                const saved = Store.getJSON(this.STORAGE_KEY, null);
                if (saved && typeof saved === 'object') {
                    for (const action in this.DEFAULTS) {
                        if (typeof saved[action] === 'string' && saved[action].length > 0) {
                            this.current[action] = saved[action];
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[KeyBindings] Failed to load saved bindings:', e);
        }
    },

    save() {
        try {
            if (typeof Store !== 'undefined' && Store.set) {
                Store.set(this.STORAGE_KEY, JSON.stringify(this.current));
            }
        } catch (e) {
            console.warn('[KeyBindings] Failed to save bindings:', e);
        }
        this._emit();
    },

    /**
     * Get the key code assigned to an action.
     * @param {string} action
     * @returns {string}
     */
    get(action) {
        if (!this.current[action]) this.init();
        return this.current[action] || this.DEFAULTS[action] || '';
    },

    /**
     * Check if a pressed event code matches the specified action.
     * @param {string} code - e.code from KeyboardEvent
     * @param {string} action
     * @returns {boolean}
     */
    isAction(code, action) {
        if (!code || !action) return false;
        return this.get(action) === code;
    },

    /**
     * Find action currently bound to the given key code.
     * @param {string} code
     * @returns {string|null}
     */
    getActionForKey(code) {
        if (!code) return null;
        for (const action in this.current) {
            if (this.current[action] === code) return action;
        }
        return null;
    },

    /**
     * Bind an action to a key code.
     * Resolves collisions by swapping or unbinding previous actions.
     * @param {string} action
     * @param {string} code
     */
    set(action, code) {
        if (!this.DEFAULTS[action] || !code) return;
        // Check if another action is using this code
        const existingAction = this.getActionForKey(code);
        if (existingAction && existingAction !== action) {
            // Swap bindings
            const previousCode = this.current[action];
            this.current[existingAction] = previousCode;
        }
        this.current[action] = code;
        this.save();
    },

    /**
     * Reset all bindings to default.
     */
    resetDefaults() {
        this.current = Object.assign({}, this.DEFAULTS);
        this.save();
    },

    /**
     * Format a key code into a clean, human-readable display string.
     * @param {string} code
     * @param {string} [lang] - 'ru' or 'en'
     * @returns {string}
     */
    formatKey(code, lang = 'ru') {
        if (!code) return '—';
        if (code.startsWith('Key')) return code.slice(3).toUpperCase();
        if (code.startsWith('Digit')) return code.slice(5);
        if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);

        const mapRu = {
            'Space': 'ПРОБЕЛ',
            'ShiftLeft': 'L-SHIFT',
            'ShiftRight': 'R-SHIFT',
            'ControlLeft': 'L-CTRL',
            'ControlRight': 'R-CTRL',
            'AltLeft': 'L-ALT',
            'AltRight': 'R-ALT',
            'Tab': 'TAB',
            'Enter': 'ENTER',
            'Escape': 'ESC',
            'Backspace': 'BACKSPACE',
            'CapsLock': 'CAPS',
            'ArrowUp': '↑',
            'ArrowDown': '↓',
            'ArrowLeft': '←',
            'ArrowRight': '→'
        };

        const mapEn = {
            'Space': 'SPACE',
            'ShiftLeft': 'L-SHIFT',
            'ShiftRight': 'R-SHIFT',
            'ControlLeft': 'L-CTRL',
            'ControlRight': 'R-CTRL',
            'AltLeft': 'L-ALT',
            'AltRight': 'R-ALT',
            'Tab': 'TAB',
            'Enter': 'ENTER',
            'Escape': 'ESC',
            'Backspace': 'BACKSPACE',
            'CapsLock': 'CAPS',
            'ArrowUp': '↑',
            'ArrowDown': '↓',
            'ArrowLeft': '←',
            'ArrowRight': '→'
        };

        const dict = lang === 'en' ? mapEn : mapRu;
        return dict[code] || code.toUpperCase();
    },

    /**
     * Get human-readable key label for an action.
     * @param {string} action
     * @param {string} [lang]
     * @returns {string}
     */
    getKeyLabel(action, lang = 'ru') {
        return this.formatKey(this.get(action), lang);
    },

    /**
     * Register change listener.
     * @param {Function} cb
     */
    onChange(cb) {
        if (typeof cb === 'function') this._listeners.push(cb);
        return () => {
            const idx = this._listeners.indexOf(cb);
            if (idx !== -1) this._listeners.splice(idx, 1);
        };
    },

    _emit() {
        for (const cb of this._listeners) {
            try { cb(this.current); } catch (e) {}
        }
    }
};

KeyBindings.init();

if (typeof window !== 'undefined') {
    window.KeyBindings = KeyBindings;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KeyBindings;
}
