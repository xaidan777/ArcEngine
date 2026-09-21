// js/LoadoutScreen.js — ARC Raiders-style Loadout & Stash management for Blackwater Protocol.
class LoadoutScreen {
    constructor(menu) {
        this.menu = menu;
        this.drag = null;
        this.selected = null;
        this.filter = 'all';
        this.targetSlot = null;
        this.message = '';
        this.root = document.createElement('section');
        this.root.id = 'arc-loadout-screen';
        this.root.hidden = true;
        document.body.appendChild(this.root);

        // Drag and Drop listeners
        this.root.addEventListener('dragstart', e => {
            const cell = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-slot]'));
            if (!cell) return;
            const ref = JSON.parse(cell.dataset.slot);
            const item = this.item(ref);
            if (!item) { e.preventDefault(); return; }
            this.drag = { ref, item };
            this.dropKey = '';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'blackwater-item');
            cell.classList.add('dragging');
        });

        this.root.addEventListener('dragover', e => {
            if (!this.drag) return;
            const target = this.dropTarget(/** @type {HTMLElement} */ (e.target));
            const key = target ? `${target.area}:${target.index ?? 0}` : '';
            if (!target) {
                e.dataTransfer.dropEffect = 'none';
                if (this.dropKey) this.root.querySelectorAll('.drop-ready').forEach(el => el.classList.remove('drop-ready'));
                this.dropKey = '';
                return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (this.dropKey === key) return;
            this.dropKey = key;
            this.root.querySelectorAll('.drop-ready').forEach(el => el.classList.remove('drop-ready'));
            this.root.querySelectorAll('[data-slot]').forEach(el => {
                const ref = JSON.parse(/** @type {HTMLElement} */ (el).dataset.slot);
                if (ref.area === target.area && (ref.index ?? 0) === (target.index ?? 0)) el.classList.add('drop-ready');
            });
        });

        this.root.addEventListener('drop', e => {
            e.preventDefault();
            const target = this.dropTarget(/** @type {HTMLElement} */ (e.target));
            if (target && this.drag && this.item(this.drag.ref) === this.drag.item) {
                this.move(this.drag.ref, target);
            }
            this.drag = null;
            this.root.querySelectorAll('.drop-ready,.dragging').forEach(el => el.classList.remove('drop-ready','dragging'));
        });

        this.root.addEventListener('dragend', () => {
            this.drag = null;
            this.root.querySelectorAll('.dragging,.drop-ready').forEach(el => el.classList.remove('dragging','drop-ready'));
        });

        // Click actions
        this.root.addEventListener('click', e => {
            // Category filter
            const filterBtn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-filter]'));
            if (filterBtn) {
                this.filter = filterBtn.dataset.filter;
                this.targetSlot = null;
                this.render();
                return;
            }

            // Inspect action buttons
            const actionBtn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-action]'));
            if (actionBtn) {
                this.handleAction(actionBtn.dataset.action);
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
                if (ref.area !== 'stash') this.selectTarget(ref);
                this.selected = item ? { item, ref } : null;
                this.render();
            }
        });

        // MenuSystem owns Tab/Escape. A second window listener would close the
        // screen on the very same Tab event that opened it.
    }

    item(ref) {
        if (!ref) return null;
        if (ref.area === 'stash') return this.menu.stash[ref.index] || null;
        if (ref.area === 'backpack') return this.menu.backpack[ref.index] || null;
        if (ref.area === 'quickSlots' || ref.area === 'safePocket') return this.menu.loadout[ref.area]?.[ref.index] || null;
        return this.menu.loadout[ref.area] || null;
    }

    selectTarget(ref) {
        this.targetSlot = ref;
        this.filter = ({ primary: 'weapons', secondary: 'weapons', shieldCore: 'armor', augment: 'mods', quickSlots: 'consumables' })[ref.area] || 'all';
    }

    matchesFilter(item) {
        if (this.targetSlot) return this.accepts(this.targetSlot, item);
        if (this.filter === 'all') return true;
        if (this.filter === 'mods') return ['mods','attachments','augment'].includes(item.category) || item.slotType === 'augment';
        if (this.filter === 'armor') return this.accepts({ area: 'shieldCore' }, item);
        return item.category === this.filter;
    }

    autoTarget(item, area = 'loadout') {
        if (area === 'stash') return { area, index: this.menu.stash.length };
        const empty = name => {
            const index = (name === 'backpack' ? this.menu.backpack : this.menu.loadout[name] || []).findIndex(value => !value);
            const ref = { area: name, index };
            return index >= 0 && this.accepts(ref, item) ? ref : null;
        };
        if (['backpack','quickSlots','safePocket'].includes(area)) return empty(area);
        const equipment = ['primary','secondary','shieldCore','augment'].map(name => ({ area: name, index: 0 }));
        const slot = equipment.find(ref => !this.item(ref) && this.accepts(ref, item));
        if (slot) return slot;
        return empty('quickSlots') || empty('backpack');
    }

    dropTarget(element) {
        if (!this.drag || this.item(this.drag.ref) !== this.drag.item) return null;
        const cell = element.closest('[data-slot]');
        if (cell) {
            const ref = JSON.parse(/** @type {HTMLElement} */ (cell).dataset.slot);
            if (ref.area === this.drag.ref.area && (ref.index ?? 0) === (this.drag.ref.index ?? 0)) return null;
            if (this.accepts(ref, this.drag.item) && this.accepts(this.drag.ref, this.item(ref))) return ref;
        }
        const zone = element.closest('[data-drop-area]');
        return zone ? this.autoTarget(this.drag.item, /** @type {HTMLElement} */ (zone).dataset.dropArea) : null;
    }

    accepts(ref, item) {
        if (!item) return true;
        if (ref.area === 'stash' || ref.area === 'backpack') return true;
        if (ref.area === 'quickSlots') return item.category === 'consumables' || item.category === 'ammo' || item.category === 'grenades';
        if (ref.area === 'safePocket') return !['weapons', 'armor', 'shields', 'augment'].includes(item.category) && item.slotType !== 'augment';
        if (ref.area === 'primary' || ref.area === 'secondary') return item.category === 'weapons';
        if (ref.area === 'shieldCore') return ['armor','shields'].includes(item.category) || item.slotType === 'shield' || item.slotType === 'shieldCore' || !!item.shieldHp;
        if (ref.area === 'augment') return item.category === 'augment' || item.slotType === 'augment';
        return false;
    }

    write(ref, item) {
        if (ref.area === 'stash') {
            if (ref.index >= this.menu.stash.length) this.menu.stash.push(item);
            else this.menu.stash[ref.index] = item;
        } else if (ref.area === 'backpack') {
            this.menu.backpack[ref.index] = item;
        } else if (ref.area === 'quickSlots' || ref.area === 'safePocket') {
            if (!this.menu.loadout[ref.area]) this.menu.loadout[ref.area] = [];
            this.menu.loadout[ref.area][ref.index] = item;
        } else {
            this.menu.loadout[ref.area] = item;
        }
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
        this.menu.stash = this.menu.stash.filter(Boolean);
        this.selected = { item, ref: to.area === 'stash' ? { area: 'stash', index: this.menu.stash.indexOf(item) } : to };
        this.message = 'Снаряжение сохранено';
        this.menu.saveState();

        if (this.menu.onlineLobby?.authenticated && this.menu.onlineLobby.client) {
            this.menu.onlineLobby.client.moveInventoryItem(from, to).then(res => {
                if (res && res.ok) {
                    if (res.stash) this.menu.stash = res.stash;
                    if (res.loadout) this.menu.loadout = res.loadout;
                    this.render();
                }
            }).catch(err => {
                console.warn('Online inventory move error:', err);
            });
        }

        this.render();
        return true;
    }

    quickMove(from) {
        const item = this.item(from);
        if (!item) return false;

        if (from.area === 'stash') {
            if (this.targetSlot && this.accepts(this.targetSlot, item) && this.accepts(from, this.item(this.targetSlot))) return this.move(from, this.targetSlot);
            // Priority 1: Equip slots if matching
            const equipSlots = ['primary', 'secondary', 'shieldCore', 'augment'].map(area => ({ area }));
            const equipTarget = equipSlots.find(ref => !this.item(ref) && this.accepts(ref, item));
            if (equipTarget) return this.move(from, equipTarget);

            // Priority 2: Quick slots if consumable
            if (item.category === 'consumables' || item.category === 'ammo') {
                const qIdx = this.menu.loadout.quickSlots.findIndex((_, i) => !this.item({ area: 'quickSlots', index: i }));
                if (qIdx !== -1) return this.move(from, { area: 'quickSlots', index: qIdx });
            }

            // Priority 3: Backpack
            const bpIdx = this.menu.backpack.findIndex(s => !s);
            if (bpIdx !== -1) return this.move(from, { area: 'backpack', index: bpIdx });

            this.message = 'Рюкзак и слоты заполнены.';
        } else {
            // Move back to stash
            const target = { area: 'stash', index: this.menu.stash.length };
            return this.move(from, target);
        }

        this.render();
        return false;
    }

    handleAction(action) {
        if (!this.selected || !this.selected.item) return;
        const { item, ref } = this.selected;

        if (action === 'equip') {
            this.quickMove(ref);
        } else if (action === 'stash') {
            this.move(ref, { area: 'stash', index: this.menu.stash.length });
        } else if (action === 'sell') {
            if (this.menu.onlineLobby?.authenticated) {
                if (this.menu.onlineLobby.client) {
                    const instId = item.instId || item.id;
                    this.menu.onlineLobby.client.sellInventoryItem(ref, instId).then(res => {
                        if (res && res.ok) {
                            if (res.stash) this.menu.stash = res.stash;
                            if (res.loadout) this.menu.loadout = res.loadout;
                            if (res.credits !== undefined) {
                                if (this.menu.onlineLobby.client.account) this.menu.onlineLobby.client.account.credits = res.credits;
                                this.menu.profile.credits = res.credits;
                            }
                            this.selected = null;
                            this.message = `Продано за ${(res.value || 100).toLocaleString()} CR`;
                            this.render();
                        } else {
                            this.message = 'Ошибка продажи предмета.';
                            this.render();
                        }
                    }).catch(() => {
                        this.message = 'Ошибка сети при продаже.';
                        this.render();
                    });
                }
                return;
            }
            const val = Number(item.value) || 100;
            this.menu.profile.credits = (this.menu.profile.credits || 0) + val;
            this.write(ref, null);
            this.menu.stash = this.menu.stash.filter(Boolean);
            this.selected = null;
            this.message = `Продано за ${val.toLocaleString()} CR`;
            this.menu.saveState();
            this.render();
        }
    }

    show(visible) {
        this.root.hidden = !visible;
        if (visible) {
            // Ensure backpack array is 18 items
            if (!this.menu.backpack || this.menu.backpack.length < 18) {
                const oldBp = this.menu.backpack || [];
                this.menu.backpack = Array(18).fill(null);
                for (let i = 0; i < oldBp.length && i < 18; i++) this.menu.backpack[i] = oldBp[i];
            }
            // Ensure safePocket array is 2 items
            if (!Array.isArray(this.menu.loadout.safePocket) || this.menu.loadout.safePocket.length < 2) {
                const oldSp = this.menu.loadout.safePocket || [];
                this.menu.loadout.safePocket = [oldSp[0] || null, oldSp[1] || null];
            }
            // Ensure quickSlots array is 4 items
            if (!Array.isArray(this.menu.loadout.quickSlots) || this.menu.loadout.quickSlots.length < 4) {
                const oldQs = this.menu.loadout.quickSlots || [];
                this.menu.loadout.quickSlots = [oldQs[0] || null, oldQs[1] || null, oldQs[2] || null, oldQs[3] || null];
            }
            if (!this.selected && this.menu.stash.length > 0) {
                this.selected = { item: this.menu.stash[0], ref: { area: 'stash', index: 0 } };
            }
            this.render();
        }
    }

    dispose() {
        this.root.remove();
    }

    // SVG Icons library
    getSvg(name, color = 'currentColor') {
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
        const cat = item.category;
        const name = (item.name || '').toLowerCase();
        if (cat === 'weapons') {
            if (name.includes('shotgun') || name.includes('vulcano')) return this.getSvg('shotgun');
            if (name.includes('revolver') || name.includes('pistol')) return this.getSvg('pistol');
            return this.getSvg('rifle');
        }
        if (cat === 'ammo') return this.getSvg('ammo');
        if (cat === 'consumables') return this.getSvg('consumables');
        if (cat === 'armor' || item.slotType === 'shieldCore') return this.getSvg('armor');
        if (cat === 'augment' || item.slotType === 'augment') return this.getSvg('mods');
        if (cat === 'materials' || name.includes('scrap') || name.includes('steel')) return this.getSvg('materials');
        if (cat === 'intel' || name.includes('data') || name.includes('drive')) return this.getSvg('intel');
        return this.getSvg('all');
    }

    render() {
        const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
        const m = this.menu;
        const selectedObj = this.selected;
        const selectedItem = selectedObj ? selectedObj.item : null;

        // Categories list
        const categories = [
            { id: 'all', name: 'ВСЁ', icon: 'all' },
            { id: 'weapons', name: 'ОРУЖИЕ', icon: 'weapons' },
            { id: 'armor', name: 'БРОНЯ', icon: 'armor' },
            { id: 'ammo', name: 'БОЕПРИПАСЫ', icon: 'ammo' },
            { id: 'consumables', name: 'МЕДИЦИНА', icon: 'consumables' },
            { id: 'intel', name: 'ДАННЫЕ', icon: 'intel' },
            { id: 'mods', name: 'МОДУЛИ', icon: 'mods' },
            { id: 'materials', name: 'МАТЕРИАЛЫ', icon: 'materials' }
        ];

        // Slot renderer helper
        const renderSlot = (area, index, label = '', watermark = '') => {
            const ref = { area, index };
            const item = this.item(ref);
            const isSelected = selectedItem && this.selected?.ref?.area === area && this.selected?.ref?.index === index;
            const filled = !!item;
            const rarity = item?.rarity || 'Common';
            const count = item ? Number(item.count) || 1 : 0;
            const tier = item?.tier || '';

            return `
                <div class="bw-item-slot ${filled ? 'filled' : 'empty'} ${isSelected ? 'selected' : ''}"
                     data-slot='${JSON.stringify(ref)}'
                     draggable="${filled}"
                     title="${esc(item ? (item.nameRu || item.name) : label || 'Пустой слот')}">
                    ${filled ? `
                        <div class="bw-slot-rarity-pip ${rarity}"></div>
                        <div class="bw-slot-icon">${this.getItemIcon(item)}</div>
                        ${count > 1 ? `<div class="bw-slot-count">×${count}</div>` : ''}
                        ${tier ? `<div class="bw-slot-tier">${tier}</div>` : ''}
                    ` : (watermark ? `<div class="bw-watermark-icon">${watermark}</div>` : '')}
                </div>
            `;
        };

        // Equipment small slot (Shield Core / Augment)
        const renderSmallEquip = (area, title, defaultIcon, defaultName) => {
            const ref = { area, index: 0 };
            const item = this.item(ref);
            const isSelected = selectedItem && this.selected?.ref?.area === area;
            const name = item ? (item.nameRu || item.name) : defaultName;
            const hp = item ? (item.durability ?? item.shieldHp ?? 100) : 0;

            return `
                <div class="bw-equip-small-slot ${isSelected ? 'selected' : ''}" data-targeted="${this.targetSlot?.area === area}" data-slot='${JSON.stringify(ref)}' draggable="${!!item}">
                    <div class="bw-equip-header">
                        ${defaultIcon}
                        <span>${esc(name)}</span>
                    </div>
                    <div>
                        <div class="bw-equip-value">${item ? hp + '/100' : 'НЕ УСТАНОВЛЕНО'}</div>
                        <div class="bw-equip-bar-wrap">
                            <div class="bw-equip-bar" style="width: ${Math.min(100, hp)}%"></div>
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

            return `
                <div class="bw-weapon-slot ${filled ? 'filled' : 'empty'} ${isSelected ? 'selected' : ''}"
                     data-slot='${JSON.stringify(ref)}'
                     draggable="${filled}">
                    <div class="bw-sub-title">
                        <span>${label}</span>
                        <span>${esc(item ? (item.nameRu || item.name) : 'НЕТ ОРУЖИЯ')}</span>
                    </div>
                    <div class="bw-weapon-preview">
                        ${filled ? this.getItemIcon(item) : `<div class="bw-watermark-icon">${this.getSvg('rifle')}</div>`}
                    </div>
                    <div class="bw-weapon-mods">
                        <div class="bw-mod-socket" title="Ствол / Надульник">—</div>
                        <div class="bw-mod-socket" title="Цевье / Рукоять">T</div>
                        <div class="bw-mod-socket" title="Прицел / Модуль">⊿</div>
                    </div>
                    <div class="bw-weapon-meta">
                        <span>МАГАЗИН: ${filled ? (item.magSize ?? '—') : '—'}</span>
                        <span class="durability">ПРОЧНОСТЬ: ${filled ? (item.durability ?? 100) + '/' + (item.maxDurability ?? 100) : '—'}</span>
                        <span class="tier">${item?.tier || '—'}</span>
                    </div>
                </div>
            `;
        };

        // Calculate loadout weight & values
        const totalWeight = typeof RaidRules !== 'undefined'
            ? RaidRules.calculateLoadoutWeight(m.loadout, m.backpack)
            : 16.0;
        const totalCredits = m.onlineLobby?.authenticated ? (m.onlineLobby.client.account?.credits ?? 0) : (m.profile?.credits ?? 0);
        const backpackCount = m.backpack.filter(Boolean).length;
        const quickUseCount = m.loadout.quickSlots.filter(Boolean).length;
        const safePocketCount = (m.loadout.safePocket || []).filter(Boolean).length;

        // Filter stash items
        const filteredStash = m.stash.map((item, idx) => ({ item, idx }))
            .filter(({ item }) => this.matchesFilter(item));
        const targetName = this.targetSlot ? ({ augment: 'АУГМЕНТАЦИИ', shieldCore: 'ЩИТЫ', primary: 'ОСНОВНОЕ ОРУЖИЕ', secondary: 'ДОП. ОРУЖИЕ', quickSlots: 'БЫСТРЫЙ ДОСТУП', safePocket: 'ЗАЩИЩЁННЫЙ КАРМАН', backpack: 'РЮКЗАК' })[this.targetSlot.area] : '';

        // Stash slots grid (render items + empty padding slots up to at least 32 slots for 4x8)
        const minStashSlots = Math.max(32, Math.ceil((filteredStash.length + 1) / 4) * 4);
        const stashSlotsHtml = [];
        for (let i = 0; i < minStashSlots; i++) {
            if (i < filteredStash.length) {
                stashSlotsHtml.push(renderSlot('stash', filteredStash[i].idx));
            } else if (i === filteredStash.length) {
                stashSlotsHtml.push(renderSlot('stash', m.stash.length, 'Положить в хранилище'));
            } else {
                stashSlotsHtml.push('<div class="bw-item-slot empty"></div>');
            }
        }

        // Preserve scroll position
        const stashScroll = this.root.querySelector('.bw-stash-grid')?.scrollTop || 0;
        const contentScroll = this.root.querySelector('.bw-loadout-content')?.scrollTop || 0;

        this.root.innerHTML = `
            <div class="bw-loadout-layout">
                <!-- LEFT: STASH PANEL -->
                <section class="bw-panel bw-stash-panel" data-drop-area="stash">
                    <header class="bw-panel-header">
                        <div class="bw-panel-title-group">
                            <h2 class="bw-panel-title">ХРАНИЛИЩЕ</h2>
                            <span class="bw-panel-count">${m.stash.length} / 64</span>
                        </div>
                    </header>

                    <div class="bw-stash-body">
                        <!-- Category Sidebar -->
                        <aside class="bw-category-sidebar">
                            ${categories.map(c => `
                                <button class="bw-cat-btn" data-filter="${c.id}" aria-pressed="${this.filter === c.id}" title="${c.name}">
                                    ${this.getSvg(c.icon)}
                                </button>
                            `).join('')}
                        </aside>

                        <!-- Stash Content -->
                        <div class="bw-stash-content">
                            <div class="bw-stash-filter-bar">
                                <div class="bw-category-select">
                                    <span>≡</span>
                                    <span>${targetName || categories.find(c => c.id === this.filter)?.name || 'ВСЁ'}</span>
                                </div>
                                <span class="bw-panel-count">${filteredStash.length} ПРЕДМ.</span>
                            </div>

                            ${this.targetSlot ? `<div class="bw-filter-context">Подходит для выбранного слота <button data-filter="all">СБРОСИТЬ ×</button></div>` : ''}
                            ${!filteredStash.length ? '<div class="bw-filter-empty">Подходящих предметов в хранилище нет.</div>' : ''}

                            <div class="bw-stash-grid">
                                ${stashSlotsHtml.join('')}
                            </div>
                        </div>
                    </div>
                </section>

                <!-- RIGHT: LOADOUT PANEL -->
                <section class="bw-panel bw-loadout-panel" data-drop-area="loadout">
                    <header class="bw-panel-header">
                        <div class="bw-panel-title-group">
                            <h2 class="bw-panel-title">СНАРЯЖЕНИЕ</h2>
                        </div>
                        <div class="bw-loadout-stats">
                            <div class="bw-stat-pill weight" title="Вес экипировки">
                                ${this.getSvg('weight')}
                                <span>${Number(totalWeight).toFixed(1)} / 50.0 KG</span>
                            </div>
                            <div class="bw-stat-pill currency" title="Баланс кредитов">
                                ${this.getSvg('currency')}
                                <span>${totalCredits.toLocaleString()} CR</span>
                            </div>
                        </div>
                    </header>

                    <div class="bw-loadout-content">
                        <!-- COLUMN 1: EQUIPMENT -->
                        <div class="bw-sub-section" data-drop-area="equipment">
                            <div class="bw-sub-title">ЭКИПИРОВКА</div>
                            <div class="bw-equip-small-row">
                                ${renderSmallEquip('shieldCore', 'ЩИТ', this.getSvg('armor'), 'ЯДРО ЩИТА')}
                                ${renderSmallEquip('augment', 'МОДУЛЬ', this.getSvg('mods'), 'АУГМЕНТАЦИЯ')}
                            </div>
                            ${renderWeaponSlot('primary', 'ОСНОВНОЕ ОРУЖИЕ')}
                            ${renderWeaponSlot('secondary', 'ДОП. ОРУЖИЕ')}
                        </div>

                        <!-- COLUMN 2: BACKPACK (18 SLOTS) -->
                        <div class="bw-sub-section" data-drop-area="backpack">
                            <div class="bw-sub-title">
                                <span>РЮКЗАК</span>
                                <span>${backpackCount} / 18</span>
                            </div>
                            <div class="bw-backpack-grid">
                                ${m.backpack.slice(0, 18).map((_, i) => renderSlot('backpack', i)).join('')}
                            </div>
                        </div>

                        <!-- COLUMN 3: QUICK USE & SAFE POCKET -->
                        <div class="bw-sub-section">
                            <div class="bw-sub-title">
                                <span>БЫСТРЫЙ ДОСТУП</span>
                                <span>${quickUseCount} / 4</span>
                            </div>
                            <div class="bw-quick-grid" data-drop-area="quickSlots">
                                ${m.loadout.quickSlots.map((_, i) => `
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
                            <div class="bw-safe-grid" data-drop-area="safePocket">
                                ${(m.loadout.safePocket || []).map((_, i) => renderSlot('safePocket', i, 'Защищённый карман', this.getSvg('lock'))).join('')}
                            </div>
                        </div>
                    </div>

                    <!-- INSPECT STRIP -->
                    <div class="bw-inspect-strip">
                        <div class="bw-inspect-info">
                            ${selectedItem ? `
                                <div class="bw-inspect-title">
                                    <span>${esc(selectedItem.nameRu || selectedItem.name)}</span>
                                    <span class="bw-slot-tier">${selectedItem.tier || 'I'}</span>
                                    <span style="font-size: 10px; color: var(--bw-gold);">${selectedItem.rarity || 'Common'}</span>
                                </div>
                                <p class="bw-inspect-desc">${esc(selectedItem.desc || 'Тактический предмет.')}</p>
                                <div class="bw-inspect-stats">
                                    <span>ВЕС: <strong>${Number(selectedItem.weight || 1).toFixed(1)} КГ</strong></span>
                                    <span>ЦЕНА: <strong>${Number(selectedItem.value || 0).toLocaleString()} CR</strong></span>
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
                                ${selectedObj?.ref?.area === 'stash' ? `
                                    <button class="bw-btn primary" data-action="equip">ЭКИПИРОВАТЬ</button>
                                ` : `
                                    <button class="bw-btn secondary" data-action="stash">В СКЛАД</button>
                                `}
                                <button class="bw-btn sell" data-action="sell" ${m.onlineLobby?.authenticated ? 'disabled title="Продажа пока недоступна в сетевом режиме"' : ''}>ПРОДАТЬ (${Number(selectedItem.value || 0).toLocaleString()} CR)</button>
                            ` : ''}
                        </div>
                    </div>
                </section>
            </div>

            <!-- FOOTER -->
            <footer class="bw-loadout-footer">
                <div class="hints">
                    <span>ПЕРЕТАСКИВАНИЕ — ПЕРЕНОС / ОБМЕН</span>
                    <span>SHIFT + ЛКМ — БЫСТРЫЙ ПЕРЕНОС</span>
                    <span>ESC / TAB — НАЗАД В ХАБ</span>
                </div>
                <div class="status">${esc(this.message)}</div>
            </footer>
        `;

        const newGrid = this.root.querySelector('.bw-stash-grid');
        if (newGrid && stashScroll) newGrid.scrollTop = stashScroll;
        const newContent = this.root.querySelector('.bw-loadout-content');
        if (newContent) newContent.scrollTop = contentScroll;
    }
}

if (typeof module !== 'undefined') module.exports = LoadoutScreen;
// Classic script attaching to the page global (invariant 8): cast, or tsc rejects the write.
if (typeof window !== 'undefined') /** @type {any} */ (window).LoadoutScreen = LoadoutScreen;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).LoadoutScreen = LoadoutScreen;
