// js/RaidInventory.js — ARC Raiders-style In-Raid Tactical Inventory for Blackwater Protocol.
// Displays Equipment, 18-slot Backpack (6x3), Quick Use (4 slots), Safe Pocket (2 slots),
// Container Looting, and Item Inspection with actions (Equip, Use, Drop, Surrender).

class RaidInventory {
    constructor() {
        this.container = null;
        this.visible = false;
        this.game = null;
        this.targetContainer = null;
        this.selected = null;
        this.drag = null;
        this.message = '';
        this.initialized = false;
    }

    init() {
        if (this.container) return;

        const overlay = document.createElement('section');
        overlay.id = 'arc-raid-inventory-overlay';
        overlay.className = 'arc-raid-inventory-overlay';
        overlay.style.display = 'none';

        document.body.appendChild(overlay);
        this.container = overlay;
        this.initialized = true;

        // Drag and Drop listeners
        overlay.addEventListener('dragstart', e => {
            const cell = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-slot]'));
            if (!cell) return;
            const ref = JSON.parse(cell.dataset.slot);
            const item = this.item(ref);
            if (!item) { e.preventDefault(); return; }
            this.drag = { ref, item };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'arc-item');
            cell.classList.add('dragging');
        });

        overlay.addEventListener('dragover', e => {
            if (!this.drag) return;
            const cell = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-slot]'));
            if (!cell) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        overlay.addEventListener('drop', e => {
            e.preventDefault();
            const cell = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-slot]'));
            if (cell && this.drag && this.item(this.drag.ref) === this.drag.item) {
                const toRef = JSON.parse(cell.dataset.slot);
                this.move(this.drag.ref, toRef);
            }
            this.drag = null;
        });

        overlay.addEventListener('dragend', () => {
            this.drag = null;
            overlay.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        });

        // Click actions
        overlay.addEventListener('click', e => {
            // Action buttons
            const actionBtn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-action]'));
            if (actionBtn) {
                this.handleAction(actionBtn.dataset.action);
                return;
            }

            // Close button
            if (/** @type {HTMLElement} */ (e.target).closest('#arc-inv-close-btn')) {
                this.close(true);
                return;
            }

            // Surrender button
            if (/** @type {HTMLElement} */ (e.target).closest('#arc-inv-surrender-btn')) {
                this.handleSurrender();
                return;
            }

            // Slot click
            const cell = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-slot]'));
            if (!cell) return;
            const ref = JSON.parse(cell.dataset.slot);
            const item = this.item(ref);

            if (e.shiftKey && item) {
                this.quickMove(ref);
            } else {
                this.selected = item ? { item, ref } : null;
                this.render();
            }
        });

        // Keyboard handler
        this._keydown = e => {
            if (!this.visible) return;
            if (e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.close(true);
            } else if (e.code === 'Space' && this.targetContainer) {
                e.preventDefault();
                this.takeAllFromContainer();
            }
        };
        window.addEventListener('keydown', this._keydown);
    }

    open(game, targetContainer = null) {
        if (!this.container) this.init();
        this.game = game;
        this.targetContainer = targetContainer;
        this.visible = true;
        this.container.style.display = 'flex';

        if (document.exitPointerLock && document.pointerLockElement) {
            document.exitPointerLock();
        }

        // Hide in-raid HUD elements to prevent overlap with inventory
        const hudIds = ['arc-compass-wrap', 'arc-hud-mission-banner', 'arc-tactical-vitals', 'arc-tactical-weapon-card', 'arc-interact-prompt-box', 'arc-downed-banner', 'arc-spectator-banner'];
        hudIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        if (typeof UI !== 'undefined' && UI.get) {
            ['topShade', 'objective', 'loot', 'lootValue', 'inventory', 'crosshair', 'barrageWarning', 'damageDirection', 'damageFlash'].forEach(id => {
                const el = UI.get(id);
                if (el) el.show(false);
            });
        }

        // Ensure backpack has 18 slots
        if (this.game && (!this.game.backpack || this.game.backpack.length < 18)) {
            const oldBp = this.game.backpack || [];
            this.game.backpack = Array(18).fill(null);
            for (let i = 0; i < oldBp.length && i < 18; i++) {
                this.game.backpack[i] = oldBp[i];
            }
        }
        // NOTE: `lootedCount` is deliberately NOT reconciled to the number of filled cells here.
        // The pre-raid bag arrives already populated (ammo, materials, gear), so raising the
        // counter to match it counted that starting kit as raid loot and inflated every capacity
        // gate. The counter is advanced by the loot paths only (Game.noteLootTaken).

        // Default selection: container item if present, else first backpack item
        if (this.targetContainer && this.targetContainer.item) {
            this.selected = { item: this.targetContainer.item, ref: { area: 'container', index: 0 } };
        } else {
            const firstItem = this.game?.backpack?.find(Boolean);
            if (firstItem) {
                const idx = this.game.backpack.indexOf(firstItem);
                this.selected = { item: firstItem, ref: { area: 'backpack', index: idx } };
            } else {
                this.selected = null;
            }
        }

        this.render();
    }

    close(reLock = false) {
        if (!this.visible) return;
        this.visible = false;
        this.targetContainer = null;
        if (this.container) {
            this.container.style.display = 'none';
        }
        if (this.game && this.game.updateHud) {
            this.game.updateHud(true);
        }
        if (reLock && this.game && this.game.phase === 'raid' && this.game.canvas?.requestPointerLock) {
            try {
                const locking = this.game.canvas.requestPointerLock();
                if (locking && locking.catch) locking.catch(() => {});
            } catch (err) {}
        }
    }

    isOpen() {
        return this.visible;
    }

    item(ref) {
        if (!ref || !this.game) return null;
        if (ref.area === 'backpack') return this.game.backpack?.[ref.index] || null;
        if (ref.area === 'quickSlots') {
            return this.game.quickSlots?.[ref.index] ||
                (typeof MenuSystem !== 'undefined' ? MenuSystem.loadout?.quickSlots?.[ref.index] : null) || null;
        }
        if (ref.area === 'safePocket') {
            return typeof MenuSystem !== 'undefined' ? MenuSystem.loadout?.safePocket?.[ref.index] : null;
        }
        if (ref.area === 'container') {
            return this.targetContainer && this.targetContainer.item ? this.targetContainer.item : null;
        }
        if (ref.area === 'primary' || ref.area === 'secondary') {
            return typeof MenuSystem !== 'undefined' ? MenuSystem.loadout?.[ref.area] : (this.game.activeWeaponDef || null);
        }
        if (ref.area === 'shieldCore') {
            return typeof MenuSystem !== 'undefined' ? MenuSystem.loadout?.shieldCore : null;
        }
        if (ref.area === 'augment') {
            return typeof MenuSystem !== 'undefined' ? MenuSystem.loadout?.augment : null;
        }
        return null;
    }

    // Loot capacity and the count of loot carried this raid. Both come from Game when it is
    // present, so the HUD, this grid and the loot gates can never disagree; the fallback keeps
    // the grid usable in a headless harness that never built a Game.
    backpackCapacity() {
        if (this.game && typeof this.game.lootCapacity === 'function') return this.game.lootCapacity();
        const configured = (typeof GAME_BACKPACK_SLOTS !== 'undefined') ? Number(GAME_BACKPACK_SLOTS) : 18;
        return Number.isFinite(configured) && configured > 0 ? configured : 18;
    }

    backpackCount() {
        if (this.game && typeof this.game.lootedItems === 'function') return this.game.lootedItems();
        return Array.isArray(this.game?.backpack) ? this.game.backpack.filter(Boolean).length : 0;
    }

    accepts(ref, item) {
        if (!item) return true;
        if (ref.area === 'backpack') {
            // Swapping into an occupied cell never raises the carried count, so a full bag can
            // still reorganise itself instead of locking every move at exactly the limit.
            const occupant = this.item(ref);
            return !!occupant || this.backpackCount() < this.backpackCapacity();
        }
        if (ref.area === 'container') return false; // Container is loot-only
        if (ref.area === 'quickSlots') return item.category === 'consumables' || item.category === 'ammo' || item.type === 'medkit' || item.type === 'ammo';
        if (ref.area === 'safePocket') return !['weapons', 'armor'].includes(item.category);
        if (ref.area === 'primary' || ref.area === 'secondary') return item.category === 'weapons';
        if (ref.area === 'shieldCore') return item.category === 'armor' || item.slotType === 'shield' || item.slotType === 'shieldCore' || !!item.shieldHp;
        if (ref.area === 'augment') return item.category === 'augment' || item.slotType === 'augment';
        return false;
    }

    write(ref, item) {
        if (!this.game) return;
        if (ref.area === 'backpack') {
            // The grid is fixed at 18 cells. An index past the end is refused rather than
            // clamped onto the last cell, which silently destroyed whatever sat there.
            if (ref.index < 0 || ref.index >= this.game.backpack.length) return;
            this.game.backpack[ref.index] = item;
        } else if (ref.area === 'quickSlots') {
            if (!this.game.quickSlots) this.game.quickSlots = [];
            this.game.quickSlots[ref.index] = item;
            if (typeof MenuSystem !== 'undefined' && MenuSystem.loadout) {
                if (!MenuSystem.loadout.quickSlots) MenuSystem.loadout.quickSlots = [];
                MenuSystem.loadout.quickSlots[ref.index] = item;
            }
        } else if (ref.area === 'safePocket') {
            if (typeof MenuSystem !== 'undefined' && MenuSystem.loadout) {
                if (!MenuSystem.loadout.safePocket) MenuSystem.loadout.safePocket = [];
                MenuSystem.loadout.safePocket[ref.index] = item;
            }
        } else if (ref.area === 'container') {
            if (this.targetContainer) {
                this.targetContainer.item = item;
                if (!item) this.targetContainer.opened = true;
            }
        } else if (ref.area === 'primary' || ref.area === 'secondary') {
            if (typeof MenuSystem !== 'undefined' && MenuSystem.loadout) {
                MenuSystem.loadout[ref.area] = item;
            }
            // Clearing the slot must clear the weapon in hand too. Guarding on `item` left the
            // dropped/unequipped weapon firing for the rest of the raid.
            if (ref.area === 'primary') this.game.activeWeaponDef = item || null;
        } else if (ref.area === 'shieldCore') {
            if (typeof MenuSystem !== 'undefined' && MenuSystem.loadout) MenuSystem.loadout.shieldCore = item;
            if (item && item.shieldHp) {
                this.game.player.maxShield = item.shieldHp;
                this.game.player.shield = Math.min(this.game.player.shield, item.shieldHp);
            }
        } else if (ref.area === 'augment') {
            if (typeof MenuSystem !== 'undefined' && MenuSystem.loadout) MenuSystem.loadout.augment = item;
        }

        // Recalculate weight & HUD
        if (typeof RaidRules !== 'undefined' && RaidRules.calculateLoadoutWeight) {
            const loadout = typeof MenuSystem !== 'undefined' ? MenuSystem.loadout : {};
            this.game.totalWeight = RaidRules.calculateLoadoutWeight(loadout, this.game.backpack.filter(Boolean));
        }
        if (this.game.updateHud) this.game.updateHud(true);
    }

    move(from, to) {
        if (from.area === to.area && from.index === to.index) return false;
        const item = this.item(from);
        const other = this.item(to);

        if (!item || !this.accepts(to, item) || !this.accepts(from, other)) {
            this.message = 'Предмет не подходит для этого слота.';
            this.render();
            return false;
        }

        this.write(to, item);
        this.write(from, other);
        this.selected = { item, ref: to };
        this.message = '';
        this.render();
        return true;
    }

    quickMove(from) {
        const item = this.item(from);
        if (!item) return false;

        if (from.area === 'container') {
            // Looting is refused when the capacity rule says the bag is full, not merely when
            // every one of the 18 physical cells happens to be occupied.
            if (this.backpackCount() >= this.backpackCapacity()) {
                this.message = 'Рюкзак заполнен.';
                this.render();
                return false;
            }
            // Container to first empty backpack slot
            const bpIdx = this.game.backpack.findIndex(s => !s);
            if (bpIdx !== -1) {
                this.move(from, { area: 'backpack', index: bpIdx });
                // Loot value is recorded where the loot is taken, not on every later move:
                // `move` was leaving the crate's item in place, so the same value could be
                // credited again by another drag.
                this.targetContainer.item = null;
                this.targetContainer.opened = true;
                if (this.targetContainer.visual && this.targetContainer.visual.scaling) this.targetContainer.visual.scaling.y = 0.35;
                if (typeof this.game.noteLootTaken === 'function') this.game.noteLootTaken();
                this.game.raidValue = (this.game.raidValue || 0) + (item.value || 50);
                if (this.game.updateHud) this.game.updateHud(true);
                this.game.showLootFeed(item, true);
                return true;
            }
            this.message = 'Рюкзак заполнен.';
        } else if (from.area === 'backpack') {
            // Priority 1: Equip if matching weapon/armor
            if (item.category === 'weapons') {
                const pItem = this.item({ area: 'primary' });
                const sItem = this.item({ area: 'secondary' });
                if (!pItem) return this.move(from, { area: 'primary' });
                if (!sItem) return this.move(from, { area: 'secondary' });
            }
            // Priority 2: Quick slots if consumable/medkit/ammo
            if (item.category === 'consumables' || item.type === 'medkit' || item.category === 'ammo' || item.type === 'ammo') {
                const qSlots = this.game.quickSlots || [];
                const qIdx = [0, 1, 2, 3].find(i => !qSlots[i]);
                if (qIdx !== undefined) return this.move(from, { area: 'quickSlots', index: qIdx });
            }
            // Priority 3: Safe pocket
            const spSlots = (typeof MenuSystem !== 'undefined' && MenuSystem.loadout?.safePocket) || [];
            const spIdx = [0, 1].find(i => !spSlots[i]);
            if (spIdx !== undefined && this.accepts({ area: 'safePocket', index: spIdx }, item)) {
                return this.move(from, { area: 'safePocket', index: spIdx });
            }
        } else {
            // Move back to backpack
            const bpIdx = this.game.backpack.findIndex(s => !s);
            if (bpIdx !== -1) return this.move(from, { area: 'backpack', index: bpIdx });
            this.message = 'Рюкзак заполнен.';
        }

        this.render();
        return false;
    }

    takeAllFromContainer() {
        if (!this.targetContainer || !this.targetContainer.item) return;
        const item = this.targetContainer.item;
        // The capacity rule decides, not an empty cell: the grid has more cells than the
        // operator may fill with valuables, and the server enforces the same limit.
        if (this.backpackCount() >= this.backpackCapacity()) {
            this.message = 'Рюкзак заполнен!';
            this.game.showLootFeed(item, false);
            this.render();
            return;
        }
        const bpIdx = this.game.backpack.findIndex(s => !s);

        if (bpIdx !== -1) {
            this.game.backpack[bpIdx] = item;
            this.targetContainer.item = null;
            this.targetContainer.opened = true;
            if (this.targetContainer.visual && this.targetContainer.visual.scaling) this.targetContainer.visual.scaling.y = 0.35;
            if (typeof this.game.noteLootTaken === 'function') this.game.noteLootTaken();
            this.game.raidValue = (this.game.raidValue || 0) + (item.value || 50);
            if (this.game.playSound) this.game.playSound('loot', 0.6, 0.05);
            this.game.showLootFeed(item, true);
            this.selected = { item, ref: { area: 'backpack', index: bpIdx } };
            this.message = 'Добыча перенесена в рюкзак';
            if (this.game.updateHud) this.game.updateHud(true);
            this.render();
        } else {
            this.message = 'Рюкзак заполнен!';
            this.game.showLootFeed(item, false);
            this.render();
        }
    }

    handleAction(action) {
        if (!this.selected || !this.selected.item) return;
        const { item, ref } = this.selected;

        if (action === 'take-container') {
            this.takeAllFromContainer();
        } else if (action === 'use') {
            // Use consumable/medkit. The item is only consumed when the heal is actually
            // accepted: `startHeal` returns false at full health, with no medkits left, while
            // another action runs or when the raid is not live, and the old code removed the
            // item regardless — silently destroying it and never spending a medkit.
            if (item.type === 'medkit' || item.category === 'consumables') {
                const started = this.game.startHeal ? this.game.startHeal() : false;
                if (!started) {
                    this.message = 'Сейчас нельзя использовать';
                    this.render();
                    return;
                }
                this.game.medkits = Math.max(0, (this.game.medkits || 0) - 1);
                this.write(ref, null);
                this.selected = null;
                this.message = 'Предмет использован';
                this.render();
            }
        } else if (action === 'equip') {
            this.quickMove(ref);
        } else if (action === 'drop') {
            // Drop item
            this.write(ref, null);
            this.selected = null;
            this.message = 'Предмет выброшен';
            this.game.showLootFeed({ name: item.nameRu || item.name || item.type, count: 1 }, false);
            this.render();
        }
    }

    async handleSurrender() {
        this.close(true);
        if (this.game) {
            if (this.game.onlineBridge && typeof this.game.onlineBridge.surrender === 'function') {
                await this.game.onlineBridge.surrender();
            }
            if (this.game.phase === 'raid') {
                this.game.finish(false);
            }
        }
    }

    // SVG icon helper
    getSvg(name) {
        const icons = {
            all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
            weapons: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l4-4 2 2-4 4H4v-2zM15 4l5 5-8 8-3-1-1-3 7-9z"/><path d="M18 7l-2-2"/></svg>',
            armor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
            ammo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h4v14H6zM14 3h4v14h-4z"/><path d="M6 3l2-2 2 2M14 3l2-2 2 2"/><rect x="5" y="17" width="6" height="4" rx="1"/><rect x="13" y="17" width="6" height="4" rx="1"/></svg>',
            consumables: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v8M8 12h8"/></svg>',
            intel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>',
            mods: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
            materials: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
            weight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18h12M12 2a4 4 0 0 0-4 4c0 1.5.8 2.8 2 3.4V18h4V9.4c1.2-.6 2-1.9 2-3.4a4 4 0 0 0-4-4z"/><circle cx="12" cy="6" r="1.5"/></svg>',
            currency: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/></svg>',
            lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
            rifle: '<svg viewBox="0 0 64 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 14h10l3-4h22l4 3h15l2 3-5 1H44l-4 5h-7l2-5H18l-4 3H4l-2-6z"/><line x1="28" y1="10" x2="28" y2="7"/><line x1="24" y1="7" x2="32" y2="7"/></svg>',
            shotgun: '<svg viewBox="0 0 64 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 15h14l4-3h34l6 2v4H50l-4 3H20l-4-3H4l-2-3z"/></svg>',
            pistol: '<svg viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h22l2 4v4h-6l-3 6H12l2-6H6l-2-8z"/></svg>'
        };
        return icons[name] || icons.all;
    }

    getItemIcon(item) {
        if (!item) return '';
        const cat = item.category || item.type;
        const name = (item.name || item.type || '').toLowerCase();
        if (cat === 'weapons') {
            if (name.includes('shotgun') || name.includes('vulcano')) return this.getSvg('shotgun');
            if (name.includes('revolver') || name.includes('pistol')) return this.getSvg('pistol');
            return this.getSvg('rifle');
        }
        if (cat === 'ammo' || item.type === 'ammo') return this.getSvg('ammo');
        if (cat === 'consumables' || item.type === 'medkit') return this.getSvg('consumables');
        if (cat === 'armor' || item.slotType === 'shieldCore') return this.getSvg('armor');
        if (cat === 'augment' || item.slotType === 'augment') return this.getSvg('mods');
        if (cat === 'materials' || name.includes('scrap') || name.includes('steel')) return this.getSvg('materials');
        if (cat === 'intel' || name.includes('data') || name.includes('drive')) return this.getSvg('intel');
        return this.getSvg('all');
    }

    getItemIconSvg(type) {
        return this.getItemIcon({ type, category: type });
    }

    render() {
        if (!this.visible || !this.game || !this.container) return;
        const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
        const g = this.game;
        const loadout = (typeof MenuSystem !== 'undefined' && MenuSystem.loadout) ? MenuSystem.loadout : {};
        const selectedObj = this.selected;
        const selectedItem = selectedObj ? selectedObj.item : null;

        // Slot renderer helper
        const renderSlot = (area, index, label = '', watermark = '') => {
            const ref = { area, index };
            const item = this.item(ref);
            const isSelected = selectedItem && this.selected?.ref?.area === area && this.selected?.ref?.index === index;
            const filled = !!item;
            const rarity = item?.rarity || 'Common';
            const count = item ? Number(item.count) || (item.value ? `+${item.value}` : 1) : 0;
            const tier = item?.tier || '';

            return `
                <div class="bw-item-slot ${filled ? 'filled' : 'empty'} ${isSelected ? 'selected' : ''}"
                     data-slot='${JSON.stringify(ref)}'
                     draggable="${filled}"
                     title="${esc(item ? (item.nameRu || item.name || item.type) : label || 'Пустой слот')}">
                    ${filled ? `
                        <div class="bw-slot-rarity-pip ${rarity}"></div>
                        <div class="bw-slot-icon">${this.getItemIcon(item)}</div>
                        ${count && count !== 1 ? `<div class="bw-slot-count">${count}</div>` : ''}
                        ${tier ? `<div class="bw-slot-tier">${tier}</div>` : ''}
                    ` : (watermark ? `<div class="bw-watermark-icon">${watermark}</div>` : '')}
                </div>
            `;
        };

        // Small equip slot (Shield / Augment)
        const renderSmallEquip = (area, title, defaultIcon, defaultName) => {
            const ref = { area, index: 0 };
            const item = this.item(ref);
            const isSelected = selectedItem && this.selected?.ref?.area === area;
            const name = item ? (item.nameRu || item.name) : defaultName;
            const hp = area === 'shieldCore'
                ? Math.ceil(g.player?.shield ?? (item?.shieldHp || 100))
                : 100;
            const maxHp = area === 'shieldCore'
                ? (g.player?.maxShield ?? (item?.shieldHp || 100))
                : 100;

            return `
                <div class="bw-equip-small-slot ${isSelected ? 'selected' : ''}" data-slot='${JSON.stringify(ref)}' draggable="${!!item}">
                    <div class="bw-equip-header">
                        ${defaultIcon}
                        <span>${esc(name)}</span>
                    </div>
                    <div>
                        <div class="bw-equip-value">${hp}/${maxHp}</div>
                        <div class="bw-equip-bar-wrap">
                            <div class="bw-equip-bar" style="width: ${Math.min(100, Math.round((hp / maxHp) * 100))}%"></div>
                        </div>
                    </div>
                </div>
            `;
        };

        // Weapon Slot Card
        const renderWeaponSlot = (area, label) => {
            const ref = { area, index: 0 };
            const item = this.item(ref);
            const isSelected = selectedItem && this.selected?.ref?.area === area;
            const filled = !!item;
            const name = item ? (item.nameRu || item.name) : (area === 'primary' ? 'TEMPEST II' : 'REVOLVER I');
            const ammoText = filled ? `${g.ammo || 30}/${g.reserveAmmo || 30}` : '—';
            const durability = filled ? (item.durability || 93) : 90;
            const tier = item?.tier || (area === 'primary' ? 'II' : 'I');

            return `
                <div class="bw-weapon-slot ${filled ? 'filled' : 'empty'} ${isSelected ? 'selected' : ''}"
                     data-slot='${JSON.stringify(ref)}'
                     draggable="${filled}">
                    <div class="bw-sub-title">
                        <span>${label}</span>
                        <span>${esc(name)}</span>
                    </div>
                    <div class="bw-weapon-preview">
                        ${filled ? this.getItemIcon(item) : `<div class="bw-watermark-icon">${this.getSvg(area === 'primary' ? 'rifle' : 'pistol')}</div>`}
                    </div>
                    <div class="bw-weapon-mods">
                        <div class="bw-mod-socket" title="Ствол / Надульник">—</div>
                        <div class="bw-mod-socket" title="Цевье / Рукоять">T</div>
                        <div class="bw-mod-socket" title="Прицел / Модуль">⊿</div>
                    </div>
                    <div class="bw-weapon-meta">
                        <span>БОЕЗАПАС: ${ammoText}</span>
                        <span class="durability">ПРОЧНОСТЬ: ${durability}/100</span>
                        <span class="tier">${tier}</span>
                    </div>
                </div>
            `;
        };

        const totalWeight = g.totalWeight ? Number(g.totalWeight).toFixed(1) : '16.5';
        const totalCredits = (g.profile?.credits || 5000) + (g.raidValue || 0);
        const backpackItems = (g.backpack || []).filter(Boolean);
        const backpackCount = backpackItems.length;
        const backpackCapacity = this.backpackCapacity();
        const quickSlots = (g.quickSlots || loadout.quickSlots || []);
        const quickUseCount = quickSlots.filter(Boolean).length;
        const safePocket = (loadout.safePocket || []);
        const safePocketCount = safePocket.filter(Boolean).length;

        this.container.innerHTML = `
            <div class="bw-loadout-panel" style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: space-between;">
                <!-- TOP HEADER -->
                <header class="bw-panel-header">
                    <div class="bw-panel-title-group">
                        <h2 class="bw-panel-title">${this.targetContainer ? 'ОБЫСК КОНТЕЙНЕРА' : 'СНАРЯЖЕНИЕ ОПЕРАТИВНИКА'}</h2>
                    </div>
                    <div class="bw-loadout-stats">
                        <div class="bw-stat-pill weight" title="Масса снаряжения">
                            ${this.getSvg('weight')}
                            <span>${totalWeight} / 50.0 KG</span>
                        </div>
                        <div class="bw-stat-pill currency" title="Добыча и баланс">
                            ${this.getSvg('currency')}
                            <span>${totalCredits.toLocaleString()} CR</span>
                        </div>
                        <button class="arc-inv-surrender-btn" id="arc-inv-surrender-btn" title="Сдаться и покинуть рейд">СДАТЬСЯ</button>
                        <button class="bw-btn secondary" id="arc-inv-close-btn" title="Закрыть инвентарь">ESC [TAB]</button>
                    </div>
                </header>

                <!-- CONTAINER LOOT BANNER (IF ACTIVE) -->
                ${this.targetContainer && this.targetContainer.item ? `
                    <div class="bw-container-banner" style="background: linear-gradient(90deg, rgba(235, 170, 50, 0.18), rgba(20, 30, 35, 0.95)); border: 1px solid rgba(235, 170, 50, 0.5); padding: 12px 18px; margin-bottom: 12px; border-radius: 4px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 4px 16px rgba(0,0,0,0.5);">
                        <div class="bw-container-info" style="display: flex; align-items: center; gap: 14px;">
                            <span style="font-size: 26px; line-height: 1;">📦</span>
                            <div>
                                <div class="bw-container-tag" style="color: var(--bw-gold); font-weight: bold; font-size: 11px; letter-spacing: 1px;">КОНТЕЙНЕР ПРИПАСОВ #${this.targetContainer.id + 1}</div>
                                <strong style="font-size: 16px; color: #fff; text-transform: uppercase;">${esc(this.targetContainer.item.nameRu || this.targetContainer.item.name || this.targetContainer.item.type)}</strong>
                                <span style="font-size: 12px; color: var(--bw-gold); margin-left: 10px; font-weight: bold;">+${this.targetContainer.item.value || 50} CR</span>
                            </div>
                        </div>
                        <div class="bw-container-actions">
                            <button class="bw-btn primary" data-action="take-container" style="background: #e5a93c; color: #000; font-weight: bold; padding: 8px 18px; font-size: 13px; cursor: pointer; border: none; border-radius: 3px;">ВЗЯТЬ В РЮКЗАК [ПРОБЕЛ]</button>
                        </div>
                    </div>
                ` : ''}

                <!-- MAIN 3-COLUMN LAYOUT -->
                <div class="bw-loadout-content">
                    <!-- COLUMN 1: EQUIPMENT -->
                    <div class="bw-sub-section">
                        <div class="bw-sub-title">ЭКИПИРОВКА</div>
                        <div class="bw-equip-small-row">
                            ${renderSmallEquip('shieldCore', 'ЩИТ', this.getSvg('armor'), 'СРЕДНИЙ СИЛОВОЙ ЩИТ')}
                            ${renderSmallEquip('augment', 'МОДУЛЬ', this.getSvg('mods'), 'АУГМЕНТАЦИЯ')}
                        </div>
                        ${renderWeaponSlot('primary', 'ОСНОВНОЕ ОРУЖИЕ')}
                        ${renderWeaponSlot('secondary', 'ДОП. ОРУЖИЕ')}
                    </div>

                    <!-- COLUMN 2: BACKPACK — 18 physical cells, of which backpackCapacity may hold valuables -->
                    <div class="bw-sub-section">
                        <div class="bw-sub-title">
                            <span>${this.targetContainer ? 'ВАШ РЮКЗАК (ИНВЕНТАРЬ)' : 'ТАКТИЧЕСКИЙ РЮКЗАК'}</span>
                            <span>${backpackCount} / ${backpackCapacity}</span>
                        </div>
                        <div class="bw-backpack-grid" style="grid-template-columns: repeat(6, 1fr); grid-template-rows: repeat(3, 1fr);">
                            ${Array.from({ length: 18 }, (_, i) => renderSlot('backpack', i)).join('')}
                        </div>
                    </div>

                    <!-- COLUMN 3: QUICK USE & SAFE POCKET -->
                    <div class="bw-sub-section">
                        <div class="bw-sub-title">
                            <span>БЫСТРЫЙ ДОСТУП</span>
                            <span>${quickUseCount} / 4</span>
                        </div>
                        <div class="bw-quick-grid">
                            ${Array.from({ length: 4 }, (_, i) => `
                                <div style="position: relative;">
                                    <span class="bw-slot-key">[${i + 1}]</span>
                                    ${renderSlot('quickSlots', i, `Быстрый слот ${i + 1}`, this.getSvg('consumables'))}
                                </div>
                            `).join('')}
                        </div>

                        <div class="bw-sub-title" style="margin-top: 14px;">
                            <span>ЗАЩИЩЁННЫЙ КАРМАН</span>
                            <span>${safePocketCount} / 2</span>
                        </div>
                        <div class="bw-safe-grid">
                            ${Array.from({ length: 2 }, (_, i) => renderSlot('safePocket', i, 'Защищённый карман', this.getSvg('lock'))).join('')}
                        </div>
                    </div>
                </div>

                <!-- INSPECT STRIP / CARD -->
                <div class="bw-inspect-strip">
                    <div class="bw-inspect-info">
                        ${selectedItem ? `
                            <div class="bw-inspect-title">
                                <span>${esc(selectedItem.nameRu || selectedItem.name || selectedItem.type)}</span>
                                <span class="bw-slot-tier">${selectedItem.tier || 'I'}</span>
                                <span style="font-size: 10px; color: var(--bw-gold);">${selectedItem.rarity || 'Common'}</span>
                            </div>
                            <p class="bw-inspect-desc">${esc(selectedItem.desc || 'Тактический предмет, найденный в секторе рейда.')}</p>
                            <div class="bw-inspect-stats">
                                <span>ВЕС: <strong>${Number(selectedItem.weight || 1).toFixed(1)} КГ</strong></span>
                                <span>ЦЕНА: <strong>${Number(selectedItem.value || 50).toLocaleString()} CR</strong></span>
                                ${selectedItem.damage ? `<span>УРОН: <strong>${selectedItem.damage}</strong></span>` : ''}
                                ${selectedItem.fireRate ? `<span>ТЕМП: <strong>${selectedItem.fireRate}</strong></span>` : ''}
                            </div>
                        ` : `
                            <div class="bw-inspect-title" style="color: #7d8c83;">ПРЕДМЕТ НЕ ВЫБРАН</div>
                            <p class="bw-inspect-desc">Нажмите на любой предмет для просмотра характеристик или перетащите его мышью.</p>
                        `}
                    </div>
                    <div class="bw-inspect-actions">
                        ${selectedItem ? `
                            ${selectedItem.type === 'medkit' || selectedItem.category === 'consumables' ? `
                                <button class="bw-btn primary" data-action="use">ИСПОЛЬЗОВАТЬ</button>
                            ` : selectedItem.category === 'weapons' || selectedItem.slotType === 'shieldCore' ? `
                                <button class="bw-btn primary" data-action="equip">ЭКИПИРОВАТЬ</button>
                            ` : ''}
                            <button class="bw-btn secondary" data-action="drop">ВЫБРОСИТЬ</button>
                        ` : ''}
                    </div>
                </div>

                <!-- FOOTER HINTS -->
                <footer class="bw-loadout-footer">
                    <div class="hints">
                        <span>ПЕРЕТАСКИВАНИЕ — ПЕРЕНОС / ОБМЕН</span>
                        <span>SHIFT + ЛКМ — БЫСТРЫЙ ПЕРЕНОС</span>
                        <span>ПРОБЕЛ — ВЗЯТЬ ВСЁ ИЗ КОНТЕЙНЕРА</span>
                        <span>ESC / TAB — ЗАКРЫТЬ</span>
                    </div>
                    <div class="status">${esc(this.message)}</div>
                </footer>
            </div>
        `;
    }
}

if (typeof window !== 'undefined') {
    window.RaidInventory = RaidInventory;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RaidInventory;
}
