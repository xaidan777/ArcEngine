// Browser map registry; level JSON is shared by the editor and the offline raid.
const MapPool = {
    active: null,
    async list() {
        const r = await fetch('/assets/levels/maps.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('Не удалось загрузить список карт');
        return r.json();
    },
    async load(id) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || id === 'maps') throw new Error('Invalid map ID');
        const r = await fetch('/assets/levels/' + encodeURIComponent(id) + '.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('Не удалось загрузить карту: ' + id);
        const level = await r.json(); level.id = id; return level;
    },
    activate(level) { this.active = level; RaidWorld.activeLevel = level; RaidWorld._cfg = null; RaidWorld._noiseFn = null; RaidWorld._noiseSeed = null; },
    async mountSelector(menu) {
        const label = document.createElement('label'); label.id = 'raid-map-picker'; label.textContent = 'Локация '; label.style.cssText = 'position:fixed;top:90px;right:32px;z-index:100;background:#182027;padding:12px;color:#eee;border:1px solid #657383;border-radius:6px';
        const select = document.createElement('select'); select.setAttribute('aria-label', 'Локация'); label.append(select);
        for (const map of await this.list()) { const opt = document.createElement('option'); opt.value = map.id; opt.textContent = map.name; select.append(opt); }
        select.value = this.active?.id || 'default_raid'; menu.selectedMapId = select.value;
        select.onchange = () => { menu.selectedMapId = select.value; };
        document.body.append(label); this.syncSelector(menu.currentScreen);
    },
    syncSelector(screen) { const el = document.getElementById('raid-map-picker'); if (el) el.hidden = !['HUB', 'MAP_SELECT'].includes(screen); },
};
