// MenuSystem.js — Engine Menu System & Out-of-Raid Hub Manager.
// Inspired by ARC Raiders: handles out-of-raid progression, Stash/Inventory management,
// Weapon Workshop upgrades, Raider character customization, Traders/Decks, and Tactical Map Selection.
//
// RULE: Every UI element is defined in UILayout.js and styled via UI.js per ArcEngine conventions.
// Dynamic grid elements (stash slots, loadout slots, outfit cards, map nodes) duplicate template records.

/**
 * @typedef {Object} ItemDef
 * @property {string} id
 * @property {string} name
 * @property {string} category — 'weapons' | 'ammo' | 'armor' | 'materials' | 'consumables' | 'keys'
 * @property {string} tier — 'I' | 'II' | 'III' | 'IV' | 'V'
 * @property {string} rarity — 'Common' | 'Rare' | 'Epic' | 'Legendary'
 * @property {number} count
 * @property {number} weight — kg
 * @property {number} value — credits
 * @property {number} [damage]
 * @property {number} [fireRate]
 * @property {number} [range]
 * @property {number} [durability]
 * @property {number} [shieldHp]
 * @property {number} [maxHp]
 * @property {number} [rechargeDelay]
 * @property {number} [rechargeRate]
 * @property {string} [slotType]
 * @property {number} [castSec]
 * @property {string} [desc]
 */

/** @satisfies {Record<string, any>} */
const MenuSystem = {
    // Active Screen States: 'HUB' | 'WORKSHOP' | 'RAIDER' | 'INVENTORY' | 'TRADERS' | 'DECKS' | 'STORE' | 'MAP_SELECT' | 'IN_RAID'
    currentScreen: 'HUB',
    activeTab: 'PLAY',             // Top nav bar tab
    raiderSubTab: 'STYLE',        // Raider customization sub-tab
    selectedCategory: 'all',      // Stash category filter
    activeTraderId: 'marco',      // Active Speranza Trader
    activeWorkshopStation: null, // Overview, then a selected workbench.
    workshopRecipePage: 0,
    workshopFeedback: '',         // Status notification message

    // Profile & Stash state
    profile: {
        name: 'Raider',
        level: 1,
        credits: 5000,
        arcCores: 1,
        tokens: 30,
        coins: 350,
        location: 'Speranza Base'
    },

    /** @type {ItemDef[]} */
    stash: [],
    /** @type {Record<string, any>} */
    loadout: {
        primary: null,
        secondary: null,
        shieldCore: null,
        armor: null,
        augment: null,
        safePocket: [null, null],
        quickSlots: [null, null, null, null],
    },
    /** @type {(ItemDef | null)[]} */
    backpack: [],
    /** @type {(ItemDef | null)[]} */
    quickUse: [],

    // Raider Customization State
    customization: {
        outfit: 'Valente',
        colorIndex: 0,
        goggles: true,
        hat: true,
        headgear: false,
        hipBag: true,
        sonarEmitter: false
    },

    // Selected Map Sector
    selectedSector: 'Spaceport',

    // References
    app: null,
    game: null,
    /** @type {ItemDef | null} */
    selectedItem: null,
    _key: null,
    onlineLobby: null,

    dispose() {
        // Guarded: dispose() also runs in the headless test harness, where `document` is a stub
        // with no getElementById. The menu must tear down without a real DOM.
        if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
            document.getElementById('arc-return-screen')?.remove();
        }
        if (this._key) window.removeEventListener('keydown', this._key);
        this._key = null;
        if (this.onlineLobby) this.onlineLobby.dispose();
        this.onlineLobby = null;
        if (this.loadoutScreen) this.loadoutScreen.dispose();
        this.loadoutScreen = null;
    },

    // Outfits catalog
    OUTFITS: [
        { id: 'Valente', name: 'VALENTE', style: 'Rugged Nomad', colors: ['#cba477', '#f1e2b8', '#8cb8d0'] },
        { id: 'Enforcer', name: 'ENFORCER', style: 'Heavy Armor', colors: ['#47545b', '#a65846', '#e0b85c'] },
        { id: 'Scavenger', name: 'SCAVENGER', style: 'Light Recon', colors: ['#59664f', '#ab9a67', '#3d4a52'] },
        { id: 'Cosmonaut', name: 'COSMONAUT', style: 'Sealed Suit', colors: ['#d6dbdf', '#d97736', '#2c3e50'] }
    ],

    // Map Sectors catalog
    SECTORS: [
        { id: 'Spaceport', name: 'SPACEPORT', loot: 'HIGH', desc: 'A vast orbital drop zone filled with high-tier tech and industrial crates.', extractCount: 3 },
        { id: 'RocketAssembly', name: 'ROCKET ASSEMBLY', loot: 'MEDIUM', desc: 'A graveyard of rocket parts that never made it to space.', extractCount: 2 },
        { id: 'LaunchTowers', name: 'LAUNCH TOWERS', loot: 'HIGH', desc: 'Heavy ARC presence guarding core data relays and rare modules.', extractCount: 2 },
        { id: 'DepartureBuilding', name: 'DEPARTURE BUILDING', loot: 'MEDIUM', desc: 'Terminal complex with dense close-quarters loot caches.', extractCount: 2 },
        { id: 'ShippingWarehouse', name: 'SHIPPING WAREHOUSE', loot: 'LOW', desc: 'Safer perimeter facility ideal for quick scrap scavenging.', extractCount: 4 }
    ],

    /** @param {{ location: any, camera: any }} app @param {any} game */
    init(app, game) {
        this.dispose();
        this.app = app;
        this.game = game;

        this.loadState();
        this.setupDefaultCatalog();
        this.bindEvents();
        const isDirectPlay = Boolean(
            typeof window !== 'undefined' && window.location && typeof window.location.search === 'string' && (
                window.location.search.includes('directPlay') ||
                window.location.search.includes('raid=1') ||
                window.location.search.includes('testLevel')
            )
        );
        this.isDirectPlay = isDirectPlay;

        if (isDirectPlay) {
            // Bypass online lobby and auth completely for direct level testing from editor
            this.onlineLobby = null;
            if (!this.loadout.primary) {
                this.loadout.primary = { id: 'valente_rifle', name: 'ASSAULT RIFLE', nameRu: 'Штурмовая винтовка', type: 'primary', damage: 34, mag: 20, maxMag: 20, fireInterval: 0.16 };
            }
            if (!this.loadout.secondary) {
                this.loadout.secondary = { id: 'pistol', name: 'TACTICAL PISTOL', nameRu: 'Тактический пистолет', type: 'secondary', damage: 24, mag: 12, maxMag: 12 };
            }
            if (!this.loadout.shieldCore) {
                this.loadout.shieldCore = { id: 'shield_standard', name: 'SHIELD CORE', nameRu: 'Щитовой генератор', capacity: 100, maxHp: 100 };
            }
            if (!this.loadout.quickSlots || !this.loadout.quickSlots[0]) {
                this.loadout.quickSlots = [
                    { id: 'medkit', name: 'MEDKIT', nameRu: 'Аптечка', type: 'medkit', count: 3 },
                    { id: 'ammo', name: 'AMMO BOX', nameRu: 'Боеприпасы', type: 'ammo', count: 60 },
                    null, null
                ];
            }
            this.currentScreen = 'IN_RAID';
            this.setScreen('IN_RAID');
            setTimeout(() => {
                if (this.game) {
                    this.game.reset();
                    this.game.deploy();
                }
            }, 100);
            return this;
        }

        if (typeof OnlineLobby !== 'undefined') this.onlineLobby = new OnlineLobby().init(this, game);
        if (typeof LoadoutScreen !== 'undefined') this.loadoutScreen = new LoadoutScreen(this);

        // Start in HUB screen out-of-raid
        this.setScreen('HUB');
        if (typeof MapPool !== 'undefined') MapPool.mountSelector(this).catch(console.error);
        return this;
    },

    // Public engine API to override or extend menu configuration
    configure(config) {
        if (!config) return;
        if (config.profile) Object.assign(this.profile, config.profile);
        if (config.outfits) this.OUTFITS = config.outfits;
        if (config.sectors) this.SECTORS = config.sectors;
        if (config.stash) this.stash = config.stash;
        this.saveState();
        this.refreshUI();
    },

    loadState() {
        const p = Store.getJSON('arcengine.raider.profile', null);
        if (p) Object.assign(this.profile, p);
        this.profile.stations = this.profile.stations || {};
        this.profile.unlockedBlueprints = Array.isArray(this.profile.unlockedBlueprints) ? this.profile.unlockedBlueprints : [];

        const cust = Store.getJSON('arcengine.raider.customization', null);
        if (cust) Object.assign(this.customization, cust);

        const st = Store.getJSON('arcengine.raider.stash', null);
        if (Array.isArray(st)) this.stash = st;

        const lo = Store.getJSON('arcengine.raider.loadout', null);
        if (lo && typeof lo === 'object') {
            this.loadout.primary = lo.primary !== undefined ? lo.primary : null;
            this.loadout.secondary = lo.secondary !== undefined ? lo.secondary : null;
            this.loadout.shieldCore = lo.shieldCore !== undefined ? lo.shieldCore : null;
            this.loadout.armor = lo.armor !== undefined ? lo.armor : null;
            this.loadout.augment = lo.augment !== undefined ? lo.augment : null;
            if (Array.isArray(lo.safePocket)) this.loadout.safePocket = lo.safePocket;
            if (Array.isArray(lo.quickSlots)) this.loadout.quickSlots = lo.quickSlots;
            if (Array.isArray(lo.backpack)) this.backpack = lo.backpack;
            if (Array.isArray(lo.quickUse)) this.quickUse = lo.quickUse;
        }
    },

    saveState() {
        // Campaign currency and upgrades belong to Game, not the menu's demo catalog.
        Store.set('arcengine.raider.menuProfile', JSON.stringify({ name: this.profile.name, level: this.profile.level }));
        Store.set('arcengine.raider.customization', JSON.stringify(this.customization));
        Store.set('arcengine.raider.stash', JSON.stringify(this.stash));
        Store.set('arcengine.raider.loadout', JSON.stringify({
            primary: this.loadout.primary ?? null,
            secondary: this.loadout.secondary ?? null,
            shieldCore: this.loadout.shieldCore ?? null,
            armor: this.loadout.armor ?? null,
            augment: this.loadout.augment ?? null,
            safePocket: this.loadout.safePocket || [null, null],
            quickSlots: this.loadout.quickSlots || [null, null, null, null],
            backpack: this.backpack,
            quickUse: this.quickUse
        }));
        if (this.game && this.game.profile) {
            this.game.profile.stations = this.profile.stations;
            this.game.profile.unlockedBlueprints = this.profile.unlockedBlueprints;
            Store.set('arcengine.raider.profile', JSON.stringify(this.game.profile));
        }
    },

    setupDefaultCatalog() {
        const initialized = Store.get('arcengine.raider.initialized');
        if (initialized) {
            // Already initialized: do not overwrite player choices or re-equip unequipped items!
            return;
        }

        if (this.stash.length === 0) {
            this.stash = [
                { id: 's1', name: 'VULCANO I', category: 'weapons', tier: 'I', rarity: 'Epic', count: 1, weight: 8, value: 10000, damage: 78, fireRate: 45, range: 60, durability: 52, desc: 'Semi-automatic shotgun with good bullet spread.' },
                { id: 's2', name: 'TEMPEST II', category: 'weapons', tier: 'II', rarity: 'Rare', count: 1, weight: 6, value: 7500, damage: 54, fireRate: 85, range: 75, durability: 93, desc: 'High fire-rate assault rifle for medium engagements.' },
                { id: 's3', name: 'HEAVY AMMO', category: 'ammo', tier: 'I', rarity: 'Common', count: 100, weight: 2, value: 300, desc: 'Standard caliber rounds for heavy rifles.' },
                { id: 's4', name: 'LIGHT AMMO', category: 'ammo', tier: 'I', rarity: 'Common', count: 80, weight: 1, value: 200, desc: 'Compact rounds for sidearms and submachines.' },
                { id: 's5', name: 'MEDKIT', category: 'consumables', tier: 'I', rarity: 'Common', count: 4, weight: 1.5, value: 500, desc: 'Restores 35 HP on field injection.' },
                { id: 's6', name: 'SHIELD MODULE', category: 'armor', tier: 'II', rarity: 'Rare', count: 1, weight: 4, value: 2400, desc: 'Medium tactical shield plate.' },
                { id: 's7', name: 'DATA DRIVE', category: 'materials', tier: 'III', rarity: 'Epic', count: 2, weight: 0.5, value: 3500, desc: 'Encrypted ARC intelligence drive.' },
                { id: 's8', name: 'STEEL SCRAP', category: 'materials', tier: 'I', rarity: 'Common', count: 40, weight: 4, value: 400, desc: 'Raw metals used for workbench upgrades.' }
            ];
        }

        if (!this.loadout.primary) {
            this.loadout.primary = { id: 'l1', name: 'TEMPEST II', category: 'weapons', tier: 'II', rarity: 'Rare', count: 1, weight: 6, value: 7500, damage: 54, fireRate: 85, range: 75, durability: 93, desc: 'High fire-rate assault rifle.' };
        }
        if (!this.loadout.secondary) {
            this.loadout.secondary = { id: 'l2', name: 'REVOLVER I', category: 'weapons', tier: 'I', rarity: 'Common', count: 1, weight: 3, value: 2500, damage: 62, fireRate: 30, range: 50, durability: 88, desc: 'Reliable sidearm revolver.' };
        }
        if (!this.loadout.shieldCore) {
            this.loadout.shieldCore = typeof ARC_ITEMS !== 'undefined' ? ARC_ITEMS.shield_medium : { id: 'shield_medium', name: 'MEDIUM SHIELD CORE', category: 'armor', slotType: 'shieldCore', tier: 'II', rarity: 'Rare', weight: 5.5, value: 3200, shieldHp: 100 };
        }
        if (!Array.isArray(this.loadout.safePocket)) {
            this.loadout.safePocket = [
                typeof ARC_ITEMS !== 'undefined' ? ARC_ITEMS.data_drive : { id: 'data_drive', name: 'DATA DRIVE', category: 'materials', weight: 0.5, value: 2500 },
                null
            ];
        }
        if (!Array.isArray(this.loadout.quickSlots) || this.loadout.quickSlots.length === 0) {
            this.loadout.quickSlots = [
                typeof ARC_ITEMS !== 'undefined' ? ARC_ITEMS.consumable_stim : { id: 'consumable_stim', name: 'COMBAT STIM', category: 'consumables', weight: 0.4 },
                typeof ARC_ITEMS !== 'undefined' ? ARC_ITEMS.consumable_small_battery : { id: 'consumable_small_battery', name: 'SHIELD BATTERY', category: 'consumables', weight: 0.8 },
                typeof ARC_ITEMS !== 'undefined' ? ARC_ITEMS.consumable_medkit : { id: 'consumable_medkit', name: 'FIELD MEDKIT', category: 'consumables', weight: 1.5 },
                null
            ];
        }
        if (!this.selectedItem) {
            this.selectedItem = this.stash[0] || null;
        }

        if (this.backpack.length === 0) {
            this.backpack = Array(18).fill(null);
            this.backpack[0] = { id: 'b1', name: 'LIGHT AMMO', category: 'ammo', tier: 'I', rarity: 'Common', count: 80, weight: 1, value: 200, desc: 'Compact rounds.' };
            this.backpack[1] = { id: 'b2', name: 'LIGHT AMMO', category: 'ammo', tier: 'I', rarity: 'Common', count: 80, weight: 1, value: 200, desc: 'Compact rounds.' };
        }

        if (this.quickUse.length === 0) {
            this.quickUse = Array(4).fill(null);
            this.quickUse[0] = { id: 'q1', name: 'MEDKIT', category: 'consumables', tier: 'I', rarity: 'Common', count: 3, weight: 1, value: 375, desc: 'Field medical bandage.' };
        }
        Store.set('arcengine.raider.initialized', 'true');
        this.saveState();
    },

    bindEvents() {
        // Navigation Bar Buttons
        const bindTab = (id, tabName) => {
            const btn = UI.get(id);
            if (btn) btn.onClick(() => this.selectTab(tabName));
        };

        bindTab('navPlay', 'PLAY');
        bindTab('navWorkshop', 'WORKSHOP');
        bindTab('navRaider', 'RAIDER');
        bindTab('navTraders', 'TRADERS');
        bindTab('navDecks', 'DECKS');
        bindTab('navStore', 'STORE');

        // Action Buttons
        const mainPlay = UI.get('mainPlayBtn');
        if (mainPlay) mainPlay.onClick(() => {
            const online = this.onlineLobby;
            if (online?.authenticated) {
                const party = online.partyState?.party;
                const isParty = party && party.members.length > 1;
                const isLeader = !isParty || party.leaderId === online.client.account.id;

                if (online.matched) {
                    this.launchRaid(online.matched);
                    return;
                }
                if (online.queued) {
                    if (isLeader) online.cancelQueue();
                    return;
                }
                if (isParty && !isLeader) {
                    const myMember = party.members.find(m => m.name === online.client.account.name);
                    const currentReady = !!myMember?.ready;
                    online.action(() => online.client.setPartyReady(!currentReady), !currentReady ? 'Вы готовы к рейду' : 'Готовность снята');
                    return;
                }
            }
            this.setScreen('MAP_SELECT');
        });
        UI.get('hubLoadoutBtn')?.onClick(() => this.setScreen('INVENTORY'));
        UI.get('socialBtn')?.onClick(() => this.setScreen('SOCIAL'));
        UI.get('squadInviteBtn')?.onClick(() => this.setScreen('SOCIAL'));

        const deployBtn = UI.get('deployLaunchBtn');
        if (deployBtn) deployBtn.onClick(() => this.startExpedition());

        // Recovery from a blocked deployment, reachable from the reason shown on the screen.
        // Losing a raid strips the equipped weapons; without this the operator is stranded on
        // the map screen with a disabled button and no way back into a raid.
        const freeKitBtn = UI.get('dispatcherFreeKitBtn');
        if (freeKitBtn) freeKitBtn.onClick(async () => {
            freeKitBtn.setDisabled(true);
            try {
                const result = await this.claimFreeKit();
                if (result && result.ok === false) { freeKitBtn.setText('НЕДОСТУПНО').show(true); return; }
                this.refreshUI();
            } catch (err) {
                freeKitBtn.setText('НЕДОСТУПНО').show(true);
            }
        });

        const backBtn = UI.get('menuBackBtn');
        if (backBtn) backBtn.onClick(() => this.handleBack());

        const invTabBtn = UI.get('inventoryHotkeyBtn');
        if (invTabBtn) invTabBtn.onClick(() => this.toggleInventory());

        // Raider Customization Buttons
        const toggleOpt = (id, key) => {
            const btn = UI.get(id);
            if (btn) btn.onClick(() => {
                this.customization[key] = !this.customization[key];
                this.saveState();
                this.refreshUI();
            });
        };

        toggleOpt('optGoggles', 'goggles');
        toggleOpt('optHat', 'hat');
        toggleOpt('optHeadgear', 'headgear');
        toggleOpt('optHipBag', 'hipBag');
        toggleOpt('optSonar', 'sonarEmitter');

        // Item Inspector Actions
        const itemEquip = UI.get('itemEquipBtn');
        if (itemEquip) itemEquip.onClick(() => this.equipSelectedItem());

        const itemSell = UI.get('itemSellBtn');
        if (itemSell) itemSell.onClick(() => this.sellSelectedItem());

        const sellAll = UI.get('stashSellAllBtn');
        if (sellAll) sellAll.onClick(() => this.sellAllStash());

        const sellJunk = UI.get('stashSellJunkBtn');
        if (sellJunk) sellJunk.onClick(() => this.sellJunkStash());

        const bind = (id, fn) => { const el = UI.get(id); if (el) el.onClick(fn); };
        for (const [btnId, tId] of [
            ['traderNavMarco', 'marco'],
            ['traderNavElena', 'elena'],
            ['traderNavBruno', 'bruno'],
            ['traderNavSofia', 'sofia'],
        ]) {
            bind(btnId, () => {
                this.activeTraderId = tId;
                this.refreshUI();
            });
        }

        for (let i = 0; i < 6; i++) {
            bind('traderItem' + i, () => this.buyTraderItem(i));
        }

        for (const [id, type] of [['upgradeAmmo','ammo'], ['upgradeMedkit','medkit'], ['upgradeArmor','armor']]) {
            bind(id, () => { if (type === 'armor') this.game.buyArmor(); else this.game.buyUpgrade(type); this.refreshUI(); });
        }
        bind('systemQuality', () => { this.game.settings.quality = (this.game.settings.quality + 1) % 3; this.game.saveSettings(); this.refreshUI(); });
        bind('systemSensitivity', () => { this.game.settings.sensitivity = this.game.settings.sensitivity >= 2 ? 0.5 : this.game.settings.sensitivity + 0.25; this.game.saveSettings(); this.refreshUI(); });
        bind('systemLanguage', () => { this.game.lang = this.game.lang === 'ru' ? 'en' : 'ru'; Store.set('arcengine.raider.lang',this.game.lang); this.refreshUI(); });
        bind('systemControls', () => { if (typeof ControlsMenu !== 'undefined') ControlsMenu.open(this.game); });

        // Global key listeners for menu navigation
        if (typeof window !== 'undefined' && window.addEventListener) {
            this._key = (e) => {
                if (this.currentScreen === 'IN_RAID' || this.currentScreen === 'RETURN' || this.game?.phase === 'raid') return;
                if (this.onlineLobby && (this.onlineLobby.checking || !this.onlineLobby.authenticated)) return;
                if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
                if (this.currentScreen === 'SOCIAL' && e.key === 'Tab') return;
                if (e.target?.matches?.('input, textarea, select, [contenteditable="true"]') && e.key !== 'Escape') return;
                if (e.key === 'Tab') {
                    e.preventDefault();
                    this.toggleInventory();
                } else if (e.key === 'Escape') {
                    this.handleBack();
                }
            };
            window.addEventListener('keydown', this._key);
        }
    },

    selectTab(tabName) {
        this.activeTab = tabName;
        switch (tabName) {
            case 'PLAY':
                this.setScreen('HUB');
                break;
            case 'WORKSHOP':
                this.setScreen('WORKSHOP');
                break;
            case 'RAIDER':
                this.setScreen('RAIDER');
                break;
            case 'TRADERS':
                this.setScreen('TRADERS');
                break;
            case 'DECKS':
                this.setScreen('DECKS');
                break;
            case 'STORE':
                this.setScreen('STORE');
                break;
        }
    },

    setScreen(screenName) {
        // The gate exists to keep a not-yet-authenticated player on the login gate, but the
        // game is playable offline: with the lobby server down nothing ever authenticates, and
        // blocking EVERY screen left the operator stuck on the HUB with no way to reach the
        // loadout, the stash or the pre-raid map — including after a lost raid stripped their
        // kit. Screens the lobby itself owns stay gated; the rest fall through to offline play.
        const ONLINE_ONLY_SCREENS = new Set(['SOCIAL']);
        if (!this.isDirectPlay && this.onlineLobby && !this.onlineLobby.authenticated &&
            screenName !== 'HUB' && ONLINE_ONLY_SCREENS.has(screenName)) return;
        if ((this.currentScreen === 'IN_RAID' || this.game?.phase === 'raid') && this.game?.phase === 'raid' && screenName !== 'IN_RAID') return;
        this.currentScreen = screenName;
        if (typeof MapPool !== 'undefined') MapPool.syncSelector(screenName);
        if (UI.root) { UI.root.dataset.mode = screenName === 'IN_RAID' ? 'raid' : 'menu'; UI.root.dataset.screen = screenName; }
        this.onlineLobby?.setScreen(screenName);
        this.loadoutScreen?.show(screenName === 'INVENTORY');

        // Manage camera pose and weapon model visibility in 3D scene based on screen
        if (this.app && this.app.camera) {
            if (screenName === 'IN_RAID') {
                this.app.camera.setMovementEnabled(false);
            } else {
                if (this.game) { this.game.phase = 'menu'; this.game.paused = false; this.game.keys.clear(); this.game.firing = this.game.aiming = false; }
                if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
                this.app.camera.setMovementEnabled(false);
                // `distance()` is a METHOD on CameraController (it derives the camera pullback
                // from canvas height, FOV and zoom). Assigning a number to it replaced the
                // method with a scalar, and the very next `_syncCamera` threw
                // "this.distance is not a function" inside the render loop — which stopped the
                // game from drawing at all (0 frames/s) as soon as a menu screen was opened.
                // Framing is expressed through zoom, which `distance()` reads.
                if (screenName === 'RAIDER') {
                    // Portrait hero camera view
                    this.app.camera.azimuth = Math.PI * 0.95;
                    this.app.camera.pitch = 0.1;
                    this.app.camera.zoomTarget = 4.1;
                    this.app.camera.zoom = 4.1;
                } else if (screenName === 'WORKSHOP') {
                    // Workbench view angle
                    this.app.camera.azimuth = Math.PI * 1.25;
                    this.app.camera.pitch = 0.25;
                    this.app.camera.zoomTarget = 3.35;
                    this.app.camera.zoom = 3.35;
                } else {
                    // Hub standard hero view
                    this.app.camera.azimuth = Math.PI;
                    this.app.camera.pitch = 0.15;
                    this.app.camera.zoomTarget = 2.85;
                    this.app.camera.zoom = 2.85;
                }
            }
        }

        // Hide 1st person weapon viewmodel in menu mode
        if (this.game && this.game.weapon && this.game.weapon.root) {
            this.game.weapon.root.setEnabled(screenName === 'IN_RAID');
        }

        this.refreshUI();
    },

    toggleInventory() {
        if (this.currentScreen === 'INVENTORY') {
            this.setScreen('HUB');
        } else if (this.currentScreen !== 'IN_RAID') {
            this.setScreen('INVENTORY');
        }
    },

    handleBack() {
        if (this.currentScreen === 'WORKSHOP' && this.activeWorkshopStation) { this.activeWorkshopStation = null; this.refreshUI(); return; }
        if (this.currentScreen === 'SOCIAL') { this.setScreen('HUB'); return; }
        if (this.currentScreen === 'MAP_SELECT' || this.currentScreen === 'INVENTORY' ||
            this.currentScreen === 'WORKSHOP' || this.currentScreen === 'RAIDER' ||
            this.currentScreen === 'TRADERS' || this.currentScreen === 'DECKS' || this.currentScreen === 'STORE') {
            this.setScreen('HUB');
        }
    },

    async startExpedition() {
        if (this.currentScreen !== 'MAP_SELECT') return;
        if (typeof RaidRules !== 'undefined' && RaidRules.validatePreRaidChecklist) {
            const chk = RaidRules.validatePreRaidChecklist(this.loadout, this.backpack);
            if (!chk.canDeploy) return;
        }
        if (this.selectedMapId && this.selectedMapId !== 'default_raid') return this.launchRaid(null);
        if (this.onlineLobby?.authenticated) {
            const online = this.onlineLobby;
            const party = online.partyState?.party;
            const isParty = party && party.members.length > 1;
            const isLeader = !isParty || party.leaderId === online.client.account.id;

            if (online.matched) return this.launchRaid(online.matched);

            if (online.queued) {
                if (isLeader) {
                    await online.cancelQueue();
                    this.refreshUI();
                }
                return;
            }

            // Member can only toggle ready:
            if (isParty && !isLeader) {
                const myMember = party.members.find(m => m.name === online.client.account.name);
                const currentReady = !!myMember?.ready;
                await online.action(() => online.client.setPartyReady(!currentReady), !currentReady ? 'Вы готовы к рейду' : 'Готовность снята');
                this.refreshUI();
                return;
            }

            // Leader starting matchmaking: check allReady
            if (isParty && isLeader && !party.allReady) {
                online.error = 'Не все бойцы отряда готовы к высадке';
                online.render();
                this.refreshUI();
                return;
            }

            const launch = UI.get('deployLaunchBtn');
            launch?.setText('ПОИСК РЕЙДА…').setDisabled(true);
            await online.queueForRaid(raid => this.launchRaid(raid));
            this.refreshUI();
            return;
        }
        this.launchRaid(null);
    },

    async launchRaid(onlineRaid = null) {
        if (!this.isDirectPlay && this.currentScreen !== 'MAP_SELECT' && !onlineRaid) return;
        this.onlineRaid = onlineRaid;
        if (this.game) {
            this.game.onlineClient = onlineRaid && this.onlineLobby?.authenticated ? this.onlineLobby.client : null;
            try {
                await this.game.startRaid(onlineRaid ? 'default_raid' : (this.selectedMapId || 'default_raid'));
            } catch (e) { console.error(e); alert(e.message); return; }
        }
        this.setScreen('IN_RAID');
    },

    finishRaid(result) {
        if (!this.game || !['won', 'lost'].includes(this.game.phase)) return;
        // Settle each raid once. The RESTART button on the extraction screen calls this again
        // while the phase is still 'won', which pushed the whole bag into the stash a second
        // time on every press.
        const raidKey = this.game.seed + ':' + (this.game.phase || '') + ':' + (this.game.time != null ? Math.floor(this.game.time) : '');
        if (this._settledRaidKey === raidKey) return;
        this._settledRaidKey = raidKey;
        const won = this.game.phase === 'won';
        // Game.finish has already settled and saved this raid exactly once.
        this.profile.credits = this.game.profile.credits;
        const incomingLoot = (result && Array.isArray(result.savedLoot)) ? result.savedLoot : (result && Array.isArray(result.loot) ? result.loot : []);
        if (incomingLoot.length > 0) {
            for (const item of incomingLoot) {
                if (!item) continue;
                if (item.category && item.name) {
                    this.stash.push(Object.assign({}, item));
                } else {
                    const val = Number(item.value || 50);
                    this.stash.push({
                        id: 'loot_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
                        name: (item.label ? item.label[1] : item.name || 'SCRAP').toUpperCase(),
                        nameRu: (item.label ? item.label[0] : item.name || 'ЛОМ').toUpperCase(),
                        category: item.type === 'medkit' ? 'consumables' : item.type === 'ammo' ? 'ammo' : 'materials',
                        tier: val > 100 ? 'III' : val > 50 ? 'II' : 'I',
                        rarity: val > 100 ? 'Epic' : val > 50 ? 'Rare' : 'Common',
                        count: 1,
                        weight: val > 100 ? 1 : 2,
                        value: val,
                        type: item.type,
                        desc: (item.label ? (this.game.lang === 'ru' ? item.label[0] : item.label[1]) : 'Добыча из рейда') + ' — ' + val + ' CR'
                    });
                }
            }
            this.saveState();
        }
        this.setScreen(won ? 'RETURN' : 'HUB');
        if (won) this.showRaidReturn(incomingLoot);
    },

    showRaidReturn(savedLoot) {
        // The settlement logic runs headless in tests; only the summary PANEL needs a DOM.
        // Bail out before building it rather than throwing after the raid was settled.
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
        document.getElementById('arc-return-screen')?.remove();
        const root = document.createElement('section');
        root.id = 'arc-return-screen';
        root.setAttribute('aria-label', 'Успешное возвращение из рейда');
        const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
        const slot = item => item ? `<div class="arc-return-slot" title="${esc(item.nameRu || item.name || item.label?.[0] || item.type)}"><div class="arc-return-icon">${this.game.raidInventory?.getItemIconSvg(item.type || item.id) || '◇'}</div><strong>${esc(item.nameRu || item.name || item.label?.[0] || item.type)}</strong><small>×${Number(item.count) || 1}</small></div>` : '<div class="arc-return-slot empty"></div>';
        const pocket = (this.loadout.safePocket || []).filter(Boolean);
        const backpack = (this.game.backpack || []).filter(Boolean);
        root.innerHTML = `<div class="arc-return-portrait"><span>ОПЕРАТОР ВЕРНУЛСЯ</span><strong>${esc(this.onlineLobby?.client?.account?.name || this.profile.name)}</strong></div>
            <main class="arc-return-content"><header><span>ЭВАКУАЦИЯ УСПЕШНА</span><h1>ВОЗВРАЩЕНИЕ В ЦИТАДЕЛЬ</h1><p>Добыча сохранена · ${savedLoot.length} предметов · ${Number(this.game.raidValue) || 0} CR</p></header>
            <div class="arc-return-columns"><section><h2>СНАРЯЖЕНИЕ</h2><div class="arc-return-equipment">${slot(this.loadout.shieldCore || this.loadout.armor)}${slot(this.loadout.primary)}${slot(this.loadout.secondary)}</div></section>
            <section><h2>РЮКЗАК <span>${backpack.length}</span></h2><div class="arc-return-grid" data-return-backpack>${backpack.map(slot).join('')}${Array.from({length:Math.max(0,18-backpack.length)},()=>slot(null)).join('')}</div></section>
            <section><h2>БЫСТРЫЙ ДОСТУП</h2><div class="arc-return-utility">${(this.loadout.quickSlots || []).map(slot).join('')}</div><h2>АУГМЕНТАЦИЯ</h2><div class="arc-return-utility">${slot(this.loadout.augment)}</div><h2>ЗАЩИЩЁННЫЙ КАРМАН</h2><div class="arc-return-utility">${pocket.length ? pocket.map(slot).join('') : slot(null)}</div></section></div>
            <footer><p data-return-status role="status">Все извлечённые предметы сохранены в хранилище.</p><button data-return-unload>РАЗГРУЗИТЬ РЮКЗАК</button><button data-return-continue>ПРОДОЛЖИТЬ →</button></footer></main>`;
        const unload = () => {
            // Settlement already persisted the loot. Never award it a second time.
            this.game.backpack = [];
            const grid = root.querySelector('[data-return-backpack]');
            if (grid) grid.innerHTML = Array.from({length:18},()=>slot(null)).join('');
            const button = /** @type {HTMLButtonElement} */ (root.querySelector('[data-return-unload]'));
            button.disabled = true;
            button.textContent = 'РЮКЗАК РАЗГРУЖЕН';
            root.querySelector('[data-return-status]').textContent = 'Добыча в хранилище. Оператор готов к следующему рейду.';
        };
        root.querySelector('[data-return-unload]').addEventListener('click', unload);
        root.querySelector('[data-return-continue]').addEventListener('click', () => { unload(); root.remove(); this.setScreen('HUB'); });
        document.body.appendChild(root);
    },

    // The loadout slot an item belongs in, in the server's own vocabulary. Mirrors
    // `slotAccepts` in server/inventory.mjs, so the client asks for a legal move instead of
    // guessing and being refused.
    equipTargetFor(item) {
        if (!item) return null;
        if (item.category === 'weapons') {
            if (item.slotType === 'sidearm') return { area: 'secondary' };
            if (item.slotType === 'primary') return { area: this.loadout.primary ? 'secondary' : 'primary' };
            return { area: this.loadout.primary ? 'secondary' : 'primary' };
        }
        if (item.category === 'armor' || item.slotType === 'shieldCore' || item.slotType === 'shield' || item.shieldHp) {
            return { area: 'shieldCore' };
        }
        if (item.category === 'augment' || item.slotType === 'augment') return { area: 'augment' };
        if (item.category === 'consumables' || item.category === 'ammo' || item.category === 'grenades') {
            const slots = Array.isArray(this.loadout.quickSlots) ? this.loadout.quickSlots : [];
            const free = [0, 1, 2, 3].find(i => !slots[i]);
            if (free !== undefined) return { area: 'quickSlots', index: free };
            return { area: 'backpack' };
        }
        if (item.category === 'ammo' || item.category === 'materials') return { area: 'backpack' };
        return null;
    },

    equipSelectedItem() {
        if (!this.selectedItem) return;
        const item = this.selectedItem;

        // ONLINE THE SERVER OWNS THE LOADOUT. Mutating this.loadout locally would look right
        // until the next refresh, when the server's (still empty) loadout replaced it — which
        // is exactly why a player who lost a raid could never re-arm and stayed on the map
        // screen with "ВЫХОД ЗАБЛОКИРОВАН". The move goes to the server and its answer is adopted.
        if (this.onlineLobby?.authenticated) {
            if (this.onlineLobby.client) {
                const sIdx = this.stash.indexOf(item);
                const from = sIdx !== -1 ? { area: 'stash', index: sIdx } : null;
                const to = this.equipTargetFor(item);
                if (from && to) {
                    this.onlineLobby.client.moveInventoryItem(from, to).then(res => {
                        if (res && res.ok) {
                            if (res.stash) this.stash = res.stash;
                            if (res.loadout) this.loadout = res.loadout;
                            this.selectedItem = this.stash[0] || null;
                            this.refreshUI();
                            if (this.currentScreen === 'MAP_SELECT') this.refreshUI();
                        }
                    }).catch(() => {});
                }
            }
            return;
        }

        if (item.category === 'weapons') {
            const isSidearm = item.slotType === 'sidearm';
            const targetSlot = isSidearm ? 'secondary' : (!this.loadout.primary ? 'primary' : 'primary');
            const old = this.loadout[targetSlot];
            this.loadout[targetSlot] = item;
            const idx = this.stash.findIndex(s => s.id === item.id);
            if (idx >= 0) {
                if (old) this.stash[idx] = old;
                else this.stash.splice(idx, 1);
            }
            if (targetSlot === 'primary' && this.game && this.game.c) {
                if (item.damage) this.game.c.damage = item.damage;
            }
        } else if (item.category === 'armor' || item.category === 'shields' || item.shieldHp) {
            const old = this.loadout.shieldCore;
            this.loadout.shieldCore = item;
            const idx = this.stash.findIndex(s => s.id === item.id);
            if (idx >= 0) {
                if (old) this.stash[idx] = old;
                else this.stash.splice(idx, 1);
            }
        } else if (item.category === 'gadgets' || item.slotType === 'gadget') {
            const targetSlot = !this.loadout.gadget1 ? 'gadget1' : 'gadget2';
            const old = this.loadout[targetSlot];
            this.loadout[targetSlot] = item;
            const idx = this.stash.findIndex(s => s.id === item.id);
            if (idx >= 0) {
                if (old) this.stash[idx] = old;
                else this.stash.splice(idx, 1);
            }
        } else if (item.category === 'consumables') {
            if (!Array.isArray(this.loadout.quickSlots)) this.loadout.quickSlots = [null, null, null, null];
            let slot = this.loadout.quickSlots.findIndex(q => q === null);
            if (slot === -1) slot = 0;
            const old = this.loadout.quickSlots[slot];
            this.loadout.quickSlots[slot] = item;
            const idx = this.stash.findIndex(s => s.id === item.id);
            if (idx >= 0) {
                if (old) this.stash[idx] = old;
                else this.stash.splice(idx, 1);
            }
        } else if (item.category === 'augment' || item.slotType === 'augment') {
            const old = this.loadout.augment;
            this.loadout.augment = item;
            const idx = this.stash.findIndex(s => s.id === item.id);
            if (idx >= 0) {
                if (old) this.stash[idx] = old;
                else this.stash.splice(idx, 1);
            }
        } else if (item.category === 'blueprints' || item.slotType === 'blueprint') {
            if (typeof RaidRules !== 'undefined' && RaidRules.learnBlueprint) {
                RaidRules.learnBlueprint(this.profile, item.id);
            }
            const idx = this.stash.findIndex(s => s.id === item.id);
            if (idx >= 0) this.stash.splice(idx, 1);
            this.selectedItem = null;
        } else if (item.category === 'attachments' || ['optic', 'muzzle', 'mag', 'stock'].includes(item.slotType)) {
            if (this.loadout.primary && typeof RaidRules !== 'undefined' && RaidRules.canAttach(this.loadout.primary, item)) {
                const prev = RaidRules.attachModule(this.loadout.primary, item.slotType, item);
                const idx = this.stash.findIndex(s => s.id === item.id);
                if (idx >= 0) {
                    if (prev) this.stash[idx] = prev;
                    else this.stash.splice(idx, 1);
                }
            }
        } else if (item.category === 'ammo' || item.category === 'materials') {
            const emptyIdx = this.backpack.findIndex(b => b === null);
            if (emptyIdx >= 0) {
                this.backpack[emptyIdx] = item;
                const idx = this.stash.findIndex(s => s.id === item.id);
                if (idx >= 0) this.stash.splice(idx, 1);
            }
        }

        this.saveState();
        this.refreshUI();
    },

    detachAttachment(slot) {
        if (!this.loadout.primary || typeof RaidRules === 'undefined') return;
        const prev = RaidRules.detachModule(this.loadout.primary, slot);
        if (prev) {
            this.stash.push(prev);
            this.saveState();
            this.refreshUI();
        }
    },

    sellSelectedItem() {
        if (this.onlineLobby?.authenticated) {
            if (this.onlineLobby.client && this.selectedItem) {
                const sIdx = this.stash.indexOf(this.selectedItem);
                const ref = sIdx !== -1 ? { area: 'stash', index: sIdx } : null;
                this.onlineLobby.client.sellInventoryItem(ref, this.selectedItem.instId || this.selectedItem.id).then(res => {
                    if (res && res.ok) {
                        if (res.stash) this.stash = res.stash;
                        if (res.loadout) this.loadout = res.loadout;
                        if (res.credits !== undefined) this.profile.credits = res.credits;
                        this.selectedItem = this.stash[0] || null;
                        this.refreshUI();
                    }
                }).catch(() => {});
            }
            return;
        }
        if (!this.selectedItem) return;
        const item = this.selectedItem;
        const idx = this.stash.findIndex(s => s.id === item.id);
        if (idx >= 0) {
            this.stash.splice(idx, 1);
            const val = Number(item.value || 100);
            this.profile.credits = (this.profile.credits || 0) + val;
            if (this.game && this.game.profile) {
                this.game.profile.credits = this.profile.credits;
                Store.set('arcengine.raider.profile', JSON.stringify(this.game.profile));
            }
            this.selectedItem = this.stash[0] || null;
            this.saveState();
            this.refreshUI();
        }
    },

    sellAllStash() {
        if (this.onlineLobby?.authenticated) {
            if (this.onlineLobby.client) {
                this.onlineLobby.client.sellJunk().then(res => {
                    if (res && res.ok) {
                        if (res.stash) this.stash = res.stash;
                        if (res.credits !== undefined) this.profile.credits = res.credits;
                        this.selectedItem = null;
                        this.refreshUI();
                    }
                }).catch(() => {});
            }
            return;
        }
        if (!this.stash || this.stash.length === 0) return;
        let total = 0;
        for (const item of this.stash) total += Number(item.value || 100);
        this.stash = [];
        this.profile.credits = (this.profile.credits || 0) + total;
        if (this.game && this.game.profile) {
            this.game.profile.credits = this.profile.credits;
            Store.set('arcengine.raider.profile', JSON.stringify(this.game.profile));
        }
        this.selectedItem = null;
        this.saveState();
        this.refreshUI();
    },

    sellJunkStash() {
        if (this.onlineLobby?.authenticated) {
            if (this.onlineLobby.client) {
                this.onlineLobby.client.sellJunk().then(res => {
                    if (res && res.ok) {
                        if (res.stash) this.stash = res.stash;
                        if (res.credits !== undefined) this.profile.credits = res.credits;
                        if (this.selectedItem && !this.stash.includes(this.selectedItem)) {
                            this.selectedItem = this.stash[0] || null;
                        }
                        this.refreshUI();
                    }
                }).catch(() => {});
            }
            return;
        }
        if (!this.stash || this.stash.length === 0) return;
        const res = typeof RaidRules !== 'undefined' && RaidRules.sellJunk ? RaidRules.sellJunk(this.stash) : { creditsEarned: 0, junkCount: 0, remainingStash: this.stash };
        if (res.junkCount > 0) {
            this.stash = res.remainingStash;
            this.profile.credits = (this.profile.credits || 0) + res.creditsEarned;
            if (this.game && this.game.profile) {
                this.game.profile.credits = this.profile.credits;
                Store.set('arcengine.raider.profile', JSON.stringify(this.game.profile));
            }
            if (this.selectedItem && !this.stash.includes(this.selectedItem)) {
                this.selectedItem = this.stash[0] || null;
            }
            this.saveState();
            this.refreshUI();
        }
    },

    buyTraderItem(slotIndex) {
        if (this.onlineLobby?.authenticated) {
            if (this.onlineLobby.client) {
                this.onlineLobby.client.buyTraderItem(this.activeTraderId || 'marco', slotIndex).then(res => {
                    if (res && res.ok) {
                        if (res.stash) this.stash = res.stash;
                        if (res.loadout) this.loadout = res.loadout;
                        if (res.credits !== undefined) this.profile.credits = res.credits;
                        if (res.arcCores !== undefined) this.profile.arcCores = res.arcCores;
                        this.refreshUI();
                    }
                }).catch(() => {});
            }
            return;
        }
        if (typeof ARC_TRADERS === 'undefined') return;
        const trader = ARC_TRADERS[this.activeTraderId || 'marco'];
        if (!trader || !trader.inventory || slotIndex < 0 || slotIndex >= trader.inventory.length) return;
        const baseItem = trader.inventory[slotIndex];
        if (!baseItem) return;

        const discount = (typeof ProgressionSystem !== 'undefined') ? ProgressionSystem.getVendorDiscount(this.activeTraderId || 'marco') : 0;
        const shopItem = Object.assign({}, baseItem, {
            price: Math.round((baseItem.price || 0) * (1 - discount))
        });

        // Safe Pocket upgrade
        if (shopItem.category === 'upgrade') {
            if (typeof RaidRules !== 'undefined' && !RaidRules.canAfford(this.profile, shopItem)) return;
            this.profile.credits -= shopItem.price;
            if (shopItem.arcCores) this.profile.arcCores = Math.max(0, (this.profile.arcCores || 0) - shopItem.arcCores);
            if (!Array.isArray(this.loadout.safePocket)) this.loadout.safePocket = [];
            this.loadout.safePocket.push(null);
            if (this.game && this.game.profile) {
                this.game.profile.credits = this.profile.credits;
                Store.set('arcengine.raider.profile', JSON.stringify(this.game.profile));
            }
            this.saveState();
            this.refreshUI();
            return;
        }

        const fullDef = (typeof ARC_ITEMS !== 'undefined' && ARC_ITEMS[shopItem.itemId]) ? ARC_ITEMS[shopItem.itemId] : {
            id: shopItem.itemId,
            name: shopItem.name,
            category: shopItem.category,
            tier: 'I',
            rarity: 'Common',
            count: shopItem.count || 1,
            weight: 1.0,
            value: shopItem.price
        };

        if (typeof RaidRules !== 'undefined') {
            const res = RaidRules.executePurchase(this.profile, this.stash, fullDef, shopItem);
            if (res.success) {
                if (this.game && this.game.profile) {
                    this.game.profile.credits = this.profile.credits;
                    Store.set('arcengine.raider.profile', JSON.stringify(this.game.profile));
                }
                this.saveState();
                this.refreshUI();
            }
        }
    },

    refreshUI() {
        const inMenu = this.currentScreen !== 'IN_RAID';

        // 1. Hide ALL raid HUD elements when in Menu mode!
        const raidHudElements = [
            'useItemBar', 'spotterAlert',
            'damageFlash', 'topShade', 'objective', 'loot', 'lootValue', 'inventory',
            'lootFeed', 'mobileFire', 'mobileUse', 'mobileHeal', 'mobileReload',
            'mobileAim', 'mobilePause', 'reload', 'heal', 'search',
            'extractInbound', 'extract', 'damageDirection', 'crosshair', 'hitMarker',
            'briefingPanel',
            'briefingTitle', 'briefingText', 'raidSeed', 'deploy', 'settingsPanel',
            'settingsTitle', 'quality', 'sensitivity', 'resume', 'resultPanel',
            'result', 'metaCredits', 'career', 'buyAmmo', 'buyMedkit', 'buyArmor', 'restart'
        ];
        if (inMenu) {
            for (const id of raidHudElements) {
                const el = UI.get(id);
                if (el) el.show(false);
            }
        } else {
            const defaultRaidHud = [
                'topShade', 'objective', 'loot', 'lootValue', 'inventory',
                'crosshair'
            ];
            for (const id of defaultRaidHud) {
                const el = UI.get(id);
                if (el) el.show(true);
            }
        }

        // 2. Hide 1st person weapon viewmodel in menu mode
        if (this.game && this.game.weapon && this.game.weapon.root) {
            this.game.weapon.root.setEnabled(!inMenu);
        }

        // 3. Header and Profile UI
        const headerPanel = UI.get('topNavPanel');
        if (headerPanel) headerPanel.show(inMenu);

        const profileText = UI.get('profileTag');
        if (profileText) profileText.setText(this.profile.name + ' · LVL ' + this.profile.level).show(inMenu);

        const currencyText = UI.get('currencyTag');
        if (currencyText) {
            const cr = (this.profile.credits ?? this.game?.profile?.credits ?? 0).toLocaleString();
            const cores = this.profile.arcCores ?? 0;
            currencyText.setText(`${cr} CR · ${cores} CORES`).show(inMenu);
        }

        // Tab highlight states
        const tabs = ['navPlay', 'navWorkshop', 'navRaider', 'navTraders', 'navDecks', 'navStore'];
        for (const t of tabs) {
            const el = UI.get(t);
            if (el) el.show(inMenu).setSelected(t === 'nav' + ({ HUB: 'Play', MAP_SELECT: 'Play', INVENTORY: '', WORKSHOP: 'Workshop', RAIDER: 'Raider', TRADERS: 'Traders', DECKS: 'Decks', STORE: 'Store' }[this.currentScreen] || ''));
        }

        // Bottom Bar
        const bottomBar = UI.get('menuBottomBar');
        if (bottomBar) bottomBar.show(inMenu);

        const backBtn = UI.get('menuBackBtn');
        if (backBtn) backBtn.show(inMenu && this.currentScreen !== 'HUB');

        const invHotkey = UI.get('inventoryHotkeyBtn');
        if (invHotkey) invHotkey.show(inMenu);

        // HUB Screen elements
        const isHub = this.currentScreen === 'HUB';
        const liveEvent = UI.get('liveEventCard'); if (liveEvent) liveEvent.show(isHub);
        const featsCard = UI.get('featsCard'); if (featsCard) featsCard.show(isHub);
        const squadBox = UI.get('squadPanel'); if (squadBox) squadBox.show(isHub);
        const mainPlayBtn = UI.get('mainPlayBtn'); if (mainPlayBtn) mainPlayBtn.show(isHub);

        // MAP SELECTION elements
        const isMap = this.currentScreen === 'MAP_SELECT';
        const mapBg = UI.get('mapPanel'); if (mapBg) mapBg.show(isMap);
        const mapTitle = UI.get('mapTitle'); if (mapTitle) mapTitle.setText(this.selectedSector).show(isMap);

        const sector = this.SECTORS.find(s => s.name === this.selectedSector || s.id === this.selectedSector) || this.SECTORS[0];
        const mapInfo = UI.get('mapSectorInfo');
        if (mapInfo) {
            mapInfo.setText('LOOT VALUE: ' + sector.loot + '\n' + sector.desc + '\n\nEXTRACTION POINTS: ' + sector.extractCount).show(isMap);
        }
        const deployBtn = UI.get('deployLaunchBtn'); if (deployBtn) deployBtn.show(isMap);

        // INVENTORY & STASH elements
        const isInv = this.currentScreen === 'INVENTORY' && !this.loadoutScreen;
        const stashPanel = UI.get('stashPanel'); if (stashPanel) stashPanel.show(isInv);
        const stashTitle = UI.get('stashTitle'); if (stashTitle) stashTitle.setText('STASH  ' + this.stash.length + ' / 64').show(isInv);
        const loadoutPanel = UI.get('loadoutPanel'); if (loadoutPanel) loadoutPanel.show(isInv);
        const itemCard = UI.get('itemInspectCard'); if (itemCard) itemCard.show(isInv && !!this.selectedItem);

        if (isInv && this.selectedItem) {
            const item = this.selectedItem;
            const title = UI.get('itemInspectTitle'); if (title) title.setText(item.name).show(isInv);
            const desc = UI.get('itemInspectDesc');
            if (desc) {
                desc.setText(item.desc + '\n\n' +
                    (item.damage ? 'DAMAGE: ' + item.damage + '\n' : '') +
                    (item.fireRate ? 'FIRE RATE: ' + item.fireRate + '\n' : '') +
                    (item.range ? 'RANGE: ' + item.range + '\n' : '') +
                    'WEIGHT: ' + item.weight + ' KG\nVALUE: ' + item.value + ' 🪙').show(isInv);
            }
            const equipBtn = UI.get('itemEquipBtn'); if (equipBtn) equipBtn.show(isInv);
            const sellBtn = UI.get('itemSellBtn'); if (sellBtn) sellBtn.setText('SELL (' + item.value + ' 🪙)').show(isInv);
        } else {
            const title = UI.get('itemInspectTitle'); if (title) title.show(false);
            const desc = UI.get('itemInspectDesc'); if (desc) desc.show(false);
            const equipBtn = UI.get('itemEquipBtn'); if (equipBtn) equipBtn.show(false);
            const sellBtn = UI.get('itemSellBtn'); if (sellBtn) sellBtn.show(false);
        }

        // WORKSHOP elements
        const isShop = this.currentScreen === 'WORKSHOP';
        const benchPanel = UI.get('workshopPanel'); if (benchPanel) benchPanel.show(isShop);
        const benchTitle = UI.get('workshopTitle'); if (benchTitle) benchTitle.setText('WEAPON WORKBENCH').show(isShop);

        // RAIDER CUSTOMIZATION elements
        const isRaider = this.currentScreen === 'RAIDER';
        const raiderPanel = UI.get('raiderPanel'); if (raiderPanel) raiderPanel.show(isRaider);
        const raiderTitle = UI.get('raiderTitle'); if (raiderTitle) raiderTitle.setText('RAIDER STYLE: ' + this.customization.outfit).show(isRaider);

        const gogg = UI.get('optGoggles'); if (gogg) gogg.setText('GOGGLES: ' + (this.customization.goggles ? 'ON' : 'OFF')).show(isRaider);
        const hat = UI.get('optHat'); if (hat) hat.setText('HAT: ' + (this.customization.hat ? 'ON' : 'OFF')).show(isRaider);
        const head = UI.get('optHeadgear'); if (head) head.setText('HEADGEAR: ' + (this.customization.headgear ? 'ON' : 'OFF')).show(isRaider);
        const hip = UI.get('optHipBag'); if (hip) hip.setText('HIP BAG: ' + (this.customization.hipBag ? 'ON' : 'OFF')).show(isRaider);
        const sonar = UI.get('optSonar'); if (sonar) sonar.setText('SONAR EMITTER: ' + (this.customization.sonarEmitter ? 'ON' : 'OFF')).show(isRaider);

        // Render dynamic grid slots for Stash
        this.renderStashSlots(isInv);
        this.renderWorkshop(isShop);
        this.renderRaider(isRaider);
        this.renderTraders(this.currentScreen === 'TRADERS');
        this.renderHub(isHub);
        this.refreshPresentation();
    },

    renderStashSlots(visible) {
        const template = UI.def('stashSlotTemplate');
        if (!template) return;

        // Clear previous runtime stash slot copies
        const scrollTop = UI.get('stashPanel')?.el.scrollTop || 0;
        for (const id of [...UI.elements.keys()]) {
            if (id.startsWith('stash_slot_')) UI.remove(id);
        }

        if (!visible) return;

        const cols = 4;
        const size = template.w || 52;
        const gap = 6;

        for (let i = 0; i < this.stash.length; i++) {
            const item = this.stash[i];
            const col = i % cols;
            const row = Math.floor(i / cols);

            const slotDef = Object.assign({}, template, {
                id: 'stash_slot_' + i,
                x: template.x + col * (size + gap),
                y: template.y + row * (size + gap),
                text: item.name + (item.count > 1 ? ' ×' + item.count : '') + '\n' + item.rarity + ' · ' + item.tier,
                visible: 1
            });

            const slot = UI.add(slotDef);
            if (slot) {
                slot.el.dataset.item = item.category;
                slot.el.dataset.rarity = item.rarity;
                slot.el.dataset.weapon = /vulcano|shotgun/i.test(item.name) ? 'shotgun' : /revolver|pistol/i.test(item.name) ? 'pistol' : 'rifle';
                slot.el.title = item.name;
                if (typeof UI.placeInPanel === 'function') UI.placeInPanel(slotDef.id, 'stashPanel');
                slot.setSelected(this.selectedItem?.id === item.id);
                slot.onClick(() => {
                    this.selectedItem = item;
                    this.refreshUI();
                });
            }
        }
        if (UI.get('stashPanel')) UI.get('stashPanel').el.scrollTop = scrollTop;
    },

    renderWorkshop(visible) {
        if (typeof UI === 'undefined' || !UI.elements) return;

        // Clear previous runtime workshop elements
        for (const id of [...UI.elements.keys()]) {
            if (id.startsWith('ws_')) UI.remove(id);
        }

        if (!visible) return;

        const p = this.profile;
        p.stations = p.stations || {};
        p.unlockedBlueprints = Array.isArray(p.unlockedBlueprints) ? p.unlockedBlueprints : [];
        const t = (ru, en) => this.game.lang === 'ru' ? ru : en;

        if (UI.root) UI.root.dataset.workshop = this.activeWorkshopStation ? 'station' : 'overview';
        if (!this.activeWorkshopStation) {
            const stations = [...Object.values(ARC_WORKSHOP_STATIONS), { id: 'tab_blueprints', nameRu: 'ЧЕРТЕЖИ', nameEn: 'BLUEPRINTS', descRu: 'Изученные схемы и требования производства.', descEn: 'Learned schematics and production requirements.' }];
            stations.forEach((station, i) => {
                const level = RaidRules.getStationLevel(p, station.id);
                const card = UI.add({ id: 'ws_select_' + station.id, kind: 'button', anchor: 'top-left', x: 46 + i * 108, y: 503, w: 102, h: 141, text: t(station.nameRu, station.nameEn) + (station.id === 'tab_blueprints' ? '' : `\n${t('УРОВЕНЬ', 'LEVEL')} ${level} / 3`), fontSize: 12, color: '#eee9dc', fill: '#23332c', border: '#738b7844', radius: 4, alpha: 1, visible: 1 });
                // Lightweight, distinct station schematics; no live 3D renderers
                // or remote assets for an eleven-card selection screen.
                if (card?.el && typeof document.createElement === 'function') {
                    const symbols = {
                        station_armory: '<path d="M28 36h30l8-9h25l8 9h29l5 8H98l-9 15H75l4-15H28z"/>',
                        station_gear: '<path d="M80 16l28 12v23c0 18-28 33-28 33S52 69 52 51V28z"/>',
                        station_medlab: '<path d="M70 22h20v18h18v20H90v18H70V60H52V40h18z"/>',
                        station_munitions: '<path d="M47 72V34l8-14 8 14v38zm26 0V34l8-14 8 14v38zm26 0V34l8-14 8 14v38z"/>',
                        station_scrappy: '<path d="M59 37h42v30H59zM35 25h30m30 0h30M50 25l15 12m45-12L95 37M69 67l-9 14m31-14 9 14"/><circle cx="80" cy="50" r="7"/>',
                        station_electronics: '<rect x="57" y="26" width="46" height="46" rx="4"/><path d="M68 17v9m12-9v9m12-9v9M68 72v9m12-9v9m12-9v9M48 37h9m-9 12h9m-9 12h9m46-24h9m-9 12h9m-9 12h9"/>',
                        station_explosives: '<circle cx="80" cy="56" r="23"/><path d="M74 33V23h12v10m-6-10q0-13 17-13m-17 35v16m0 7v2"/>',
                        station_utility: '<path d="M57 26h46v52H57zM64 39h32m-25 14h18m-9-9v18M69 26V15h22v11"/>',
                        station_refiner: '<path d="M52 20h56L94 45v26l-28 9V45zM43 20h74"/>',
                        station_recycler: '<path d="M65 26l15-10 15 10m-15-10v27m30-2 12 22-25 2m25-2-24-14M66 77H41l12-22M41 77l24-14"/>',
                        tab_blueprints: '<path d="M48 20h64v61H48zM58 31h44M58 43h18v18H58zm27 0h17m-17 10h17m-44 18h44"/>'
                    };
                    const art = document.createElement('img');
                    art.className = 'bw-station-art';
                    art.alt = '';
                    art.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><g fill="none" stroke="#a6bcb0" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${symbols[station.id] || ''}<path opacity=".3" d="M24 90h112"/></g></svg>`);
                    card.el.appendChild(art);
                    card.el.setAttribute('title', t(station.descRu || '', station.descEn || ''));
                }
                card?.onClick(() => { this.activeWorkshopStation = station.id; this.workshopRecipePage = 0; this.workshopFeedback = ''; this.refreshUI(); });
            });
            return;
        }
        UI.add({ id: 'ws_back', kind: 'button', anchor: 'top-left', x: 62, y: 200, w: 210, h: 34, text: t('← ВСЕ ВЕРСТАКИ', '← ALL WORKBENCHES'), fontSize: 11, color: '#eee9dc', fill: '#23332c', border: '#738b7844', radius: 4, alpha: 1, visible: 1 })?.onClick(() => { this.activeWorkshopStation = null; this.refreshUI(); });


        // Active Station metadata
        const activeId = this.activeWorkshopStation || 'station_armory';
        const stDef = (typeof ARC_WORKSHOP_STATIONS !== 'undefined') ?
            Object.values(ARC_WORKSHOP_STATIONS).find(s => s.id === activeId) : null;
        const currentLevel = (typeof RaidRules !== 'undefined' && RaidRules.getStationLevel) ?
            RaidRules.getStationLevel(p, activeId) : (p.stations[activeId] || 1);
        if (stDef) {
            UI.add({ id: 'ws_description', kind: 'text', anchor: 'top-left', x: 804, y: 205, text: t(stDef.nameRu, stDef.nameEn) + '\n\n' + t(stDef.descRu, stDef.descEn), fontSize: 14, color: '#dddccd', shadow: '', alpha: 1, visible: 1 });
            const check = RaidRules.canUpgradeStation(p, this.stash, activeId);
            const required = check.cost?.materials?.map(m => `${m.type} × ${m.count}`).join('\n') || '';
            UI.add({ id: 'ws_requirements', kind: 'text', anchor: 'top-left', x: 804, y: 355, text: check.isMaxLevel ? t('СТАНЦИЯ ПОЛНОСТЬЮ УЛУЧШЕНА', 'STATION FULLY UPGRADED') : t('СЛЕДУЮЩИЙ УРОВЕНЬ\n\n', 'NEXT LEVEL\n\n') + `${check.cost?.credits || 0} CR\n${required}`, fontSize: 12, color: '#a8c2b1', shadow: '', alpha: 1, visible: 1 });
        }

        // Feedback message banner if any
        if (this.workshopFeedback) {
            UI.add({
                id: 'ws_feedback', kind: 'text', anchor: 'top-left',
                x: 62, y: 260, text: this.workshopFeedback,
                fontSize: 11, color: '#68e2cd', shadow: '#000000', alpha: 1, visible: 1
            });
        }

        // Render station content based on active tab
        if (activeId === 'station_scrappy') {
            this.renderScrappyStation(p, currentLevel, t);
        } else if (activeId === 'station_recycler') {
            this.renderRecyclerStation(p, currentLevel, t);
        } else if (activeId === 'tab_blueprints') {
            this.renderBlueprintsStation(p, t);
        } else if (stDef) {
            this.renderCraftingStation(activeId, stDef, p, currentLevel, t);
        }
        if (this.onlineLobby?.authenticated) {
            UI.get('workshopInfo')?.setText(t('Авторизованный производственный комплекс Цитадели Blackwater.', 'Authorized Blackwater Citadel production complex.'));
        }
    },

    renderCraftingStation(activeId, stDef, p, currentLevel, t) {
        const levelDots = '●'.repeat(currentLevel) + '○'.repeat(Math.max(0, 3 - currentLevel));
        const stationTitle = `${t(stDef.nameRu, stDef.nameEn)}   [${t('УРОВЕНЬ', 'LVL')} ${currentLevel}/3]  ${levelDots}`;

        UI.add({
            id: 'ws_st_title', kind: 'text', anchor: 'top-left',
            x: 62, y: 266, text: stationTitle,
            fontSize: 12, color: '#f0e8d7', shadow: '#000000', alpha: 1, visible: 1
        });

        // Upgrade Station Button
        const upCheck = typeof RaidRules !== 'undefined' && RaidRules.canUpgradeStation ?
            RaidRules.canUpgradeStation(p, this.stash, activeId) : { canUpgrade: false, isMaxLevel: true, cost: null };
        let upText = '';
        if (upCheck.isMaxLevel) {
            upText = t('СТАНЦИЯ МАКС. УРОВНЯ', 'MAX STATION LEVEL');
        } else {
            const cost = upCheck.cost;
            upText = t(`УЛУЧШИТЬ ДО УРОВНЯ ${currentLevel + 1}`, `UPGRADE TO LEVEL ${currentLevel + 1}`);
        }

        const upBtn = UI.add({
            id: 'ws_st_upgrade_btn', kind: 'button', anchor: 'top-left',
            x: 440, y: 262, w: 298, h: 30, text: upText,
            fontSize: 10, color: upCheck.canUpgrade ? '#141c19' : '#909d97',
            fill: upCheck.canUpgrade ? '#6be3a4' : '#232c29',
            border: '#3d4b47', radius: 3, alpha: 1, visible: 1
        });
        if (upBtn) {
            upBtn.setDisabled(!upCheck.canUpgrade);
            upBtn.onClick(() => {
                if (this.onlineLobby?.authenticated) {
                    const stId = activeId.replace('station_', '');
                    this.onlineLobby.upgradeWorkshopStation(stId).then(res => {
                        if (res && res.ok) {
                            this.workshopFeedback = t(`Станция успешно модернизирована до уровня ${res.newLevel}!`, `Station upgraded to Level ${res.newLevel}!`);
                            this.refreshUI();
                        } else {
                            this.workshopFeedback = t('Ошибка модернизации станции', 'Failed to upgrade station');
                            this.refreshUI();
                        }
                    });
                    return;
                }
                if (typeof RaidRules !== 'undefined' && RaidRules.upgradeStation) {
                    const res = RaidRules.upgradeStation(p, this.stash, activeId);
                    if (res.success) {
                        this.workshopFeedback = t(`Станция успешно модернизирована до уровня ${res.newLevel}!`, `Station upgraded to Level ${res.newLevel}!`);
                        this.saveState();
                        this.refreshUI();
                    }
                }
            });
        }

        // Recipes Grid
        const allRecipes = (stDef.recipes || []).map(rId => (typeof ARC_CRAFTING_RECIPES !== 'undefined' ? ARC_CRAFTING_RECIPES[rId] : null)).filter(Boolean);
        const pages = Math.max(1, Math.ceil(allRecipes.length / 6));
        this.workshopRecipePage = Math.min(this.workshopRecipePage, pages - 1);
        const recipes = allRecipes.slice(this.workshopRecipePage * 6, this.workshopRecipePage * 6 + 6);
        if (pages > 1) UI.add({ id: 'ws_page', kind: 'button', anchor: 'top-left', x: 500, y: 200, w: 238, h: 34, text: `${t('РЕЦЕПТЫ', 'RECIPES')} ${this.workshopRecipePage + 1}/${pages} →`, fontSize: 11, color: '#eee9dc', fill: '#23332c', border: '#738b7844', radius: 4, alpha: 1, visible: 1 })?.onClick(() => { this.workshopRecipePage = (this.workshopRecipePage + 1) % pages; this.refreshUI(); });
        if (recipes.length === 0) {
            UI.add({
                id: 'ws_rec_empty', kind: 'text', anchor: 'top-left',
                x: 62, y: 320, text: t('Нет доступных чертежей для данной станции.', 'No recipes available for this station.'),
                fontSize: 12, color: '#909d97', shadow: '#000000', alpha: 1, visible: 1
            });
            return;
        }

        for (let i = 0; i < recipes.length && i < 6; i++) {
            const rec = RaidRules.workshopRecipe(p, recipes[i]);
            const col = i % 2;
            const row = Math.floor(i / 2);
            const cardX = 62 + col * 342;
            const cardY = 300 + row * 92;
            const cardW = 332;
            const cardH = 86;

            UI.add({
                id: 'ws_rec_card_' + i, kind: 'panel', anchor: 'top-left',
                x: cardX, y: cardY, w: cardW, h: cardH,
                fill: '#151c1c', border: '#334440', radius: 4, alpha: 0.95, visible: 1
            });

            const recName = t(rec.nameRu || rec.nameEn, rec.nameEn || rec.nameRu);
            const countStr = (rec.count && rec.count > 1) ? ` (x${rec.count})` : '';
            UI.add({
                id: 'ws_rec_name_' + i, kind: 'text', anchor: 'top-left',
                x: cardX + 10, y: cardY + 8, text: recName + countStr,
                fontSize: 11, color: '#f0e8d7', shadow: '#000000', alpha: 1, visible: 1
            });

            const isUnlocked = typeof RaidRules !== 'undefined' && RaidRules.isRecipeUnlocked ?
                RaidRules.isRecipeUnlocked(p, rec.id) : true;
            const craftCheck = typeof RaidRules !== 'undefined' && RaidRules.canCraft ?
                RaidRules.canCraft(this.stash, p, rec) : { canCraft: false, missingMaterials: [] };

            let reqLine = `${rec.credits} CR`;
            if (rec.baseWeaponId) {
                const hasBase = this.stash.some(it => it.id === rec.baseWeaponId || (it.name && it.name.toUpperCase().includes(rec.baseWeaponId.toUpperCase())));
                reqLine += `  ·  ${t('База', 'Base')}: ${hasBase ? '✓' : '✗'}`;
            }
            if (Array.isArray(rec.materials)) {
                for (const m of rec.materials) {
                    let avail = 0;
                    for (const s of this.stash) {
                        const sType = (s.type || '').toLowerCase();
                        const sId = (s.id || '').toLowerCase();
                        const sName = (s.name || '').toLowerCase();
                        if (sType === m.type.toLowerCase() || sId === m.type.toLowerCase() || sName.includes(m.type.toLowerCase())) {
                            avail += Number(s.count || 1);
                        }
                    }
                    reqLine += `  ·  ${m.type}: ${avail}/${m.count}`;
                }
            }

            const statusText = !isUnlocked ? t('[ТРЕБУЕТСЯ ЧЕРТЕЖ]', '[BLUEPRINT REQUIRED]') : reqLine;
            UI.add({
                id: 'ws_rec_req_' + i, kind: 'text', anchor: 'top-left',
                x: cardX + 10, y: cardY + 30, text: statusText,
                fontSize: 10, color: !isUnlocked ? '#ff5e4d' : '#9caaa3', shadow: '#000000', alpha: 1, visible: 1
            });

            const canPerform = isUnlocked && craftCheck.canCraft;
            const isRefine = rec.id.startsWith('upgrade_');
            const btnText = !isUnlocked ? t('ЗАКРЫТО', 'LOCKED') : (isRefine ? t('МОДИФИКАЦИЯ', 'REFINE') : t('СОЗДАТЬ', 'CRAFT'));

            const craftBtn = UI.add({
                id: 'ws_rec_btn_' + i, kind: 'button', anchor: 'top-left',
                x: cardX + 210, y: cardY + 48, w: 112, h: 28, text: btnText,
                fontSize: 10, color: canPerform ? '#141c19' : '#88948e',
                fill: canPerform ? '#e8cc72' : '#232b28',
                border: canPerform ? '#fff0a6' : '#33403d', radius: 3, alpha: 1, visible: 1
            });
            if (craftBtn) {
                craftBtn.setDisabled(!canPerform);
                craftBtn.onClick(() => {
                    if (this.onlineLobby?.authenticated) {
                        this.onlineLobby.craftItem(rec.id).then(res => {
                            if (res && res.ok) {
                                this.workshopFeedback = t(`Успешно создано: ${res.item?.name || recName}! Предмет добавлен на склад.`, `Crafted: ${res.item?.name || recName}! Added to stash.`);
                                this.refreshUI();
                            } else {
                                this.workshopFeedback = t('Ошибка производства предмета', 'Failed to craft item');
                                this.refreshUI();
                            }
                        });
                        return;
                    }
                    if (typeof RaidRules !== 'undefined' && RaidRules.executeCraft) {
                        const res = RaidRules.executeCraft(this.stash, p, rec);
                        if (res.success) {
                            this.workshopFeedback = t(`Успешно создано: ${res.item?.name || recName}! Предмет добавлен на склад.`, `Crafted: ${res.item?.name || recName}! Added to stash.`);
                            this.saveState();
                            this.refreshUI();
                        }
                    }
                });
            }
        }
    },

    renderRecyclerStation(p, currentLevel, t) {
        const yieldMult = currentLevel === 3 ? 1.50 : (currentLevel === 2 ? 1.25 : 1.0);
        const levelDots = '●'.repeat(currentLevel) + '○'.repeat(Math.max(0, 3 - currentLevel));

        UI.add({
            id: 'ws_recy_title', kind: 'text', anchor: 'top-left',
            x: 62, y: 266, text: `${t('УТИЛИЗАТОР СПЕРАНЦЫ', 'SPERANZA RECYCLER')}  [${t('УРОВЕНЬ', 'LVL')} ${currentLevel}/3]  ${levelDots}  ·  ${t('Множитель выхода', 'Yield multiplier')}: x${yieldMult.toFixed(2)}`,
            fontSize: 12, color: '#f0e8d7', shadow: '#000000', alpha: 1, visible: 1
        });

        const upCheck = typeof RaidRules !== 'undefined' && RaidRules.canUpgradeStation ?
            RaidRules.canUpgradeStation(p, this.stash, 'station_recycler') : { canUpgrade: false, isMaxLevel: true, cost: null };
        const upBtn = UI.add({
            id: 'ws_recy_upgrade_btn', kind: 'button', anchor: 'top-left',
            x: 520, y: 262, w: 218, h: 30,
            text: upCheck.isMaxLevel ? t('МАКС. УРОВЕНЬ', 'MAX LEVEL') : t(`УЛУЧШИТЬ (${upCheck.cost?.credits || 600} CR)`, `UPGRADE (${upCheck.cost?.credits || 600} CR)`),
            fontSize: 10, color: upCheck.canUpgrade ? '#141c19' : '#909d97',
            fill: upCheck.canUpgrade ? '#6be3a4' : '#232c29',
            border: '#3d4b47', radius: 3, alpha: 1, visible: 1
        });
        if (upBtn) {
            upBtn.setDisabled(!upCheck.canUpgrade);
            upBtn.onClick(() => {
                if (typeof RaidRules !== 'undefined' && RaidRules.upgradeStation) {
                    const res = RaidRules.upgradeStation(p, this.stash, 'station_recycler');
                    if (res.success) {
                        this.workshopFeedback = t(`Утилизатор модернизирован до уровня ${res.newLevel}! Бонус выхода увеличен.`, `Recycler upgraded to Level ${res.newLevel}! Yield bonus increased.`);
                        this.saveState();
                        this.refreshUI();
                    }
                }
            });
        }

        const items = this.stash.filter(it => it && (it.category === 'weapons' || it.category === 'armor' || it.category === 'gear'));
        if (items.length === 0) {
            UI.add({
                id: 'ws_recy_empty', kind: 'text', anchor: 'top-left',
                x: 62, y: 340,
                text: t('На складе нет подходящего снаряжения для разбора.\nПринесите оружие или защитные модули из рейда, чтобы разобрать их на запчасти.', 'No equipment in stash eligible for salvage.\nExtract weapons or defense modules from a raid to dismantle them into raw materials.'),
                fontSize: 12, color: '#909d97', shadow: '#000000', alpha: 1, visible: 1
            });
            return;
        }

        for (let i = 0; i < items.length && i < 6; i++) {
            const item = items[i];
            const col = i % 2;
            const row = Math.floor(i / 2);
            const cardX = 62 + col * 342;
            const cardY = 300 + row * 92;

            UI.add({
                id: 'ws_recy_card_' + i, kind: 'panel', anchor: 'top-left',
                x: cardX, y: cardY, w: 332, h: 86,
                fill: '#151c1c', border: '#334440', radius: 4, alpha: 0.95, visible: 1
            });

            UI.add({
                id: 'ws_recy_name_' + i, kind: 'text', anchor: 'top-left',
                x: cardX + 10, y: cardY + 8, text: item.name + (item.count > 1 ? ' ×' + item.count : ''),
                fontSize: 11, color: '#f0e8d7', shadow: '#000000', alpha: 1, visible: 1
            });

            const yieldDesc = item.category === 'weapons' ?
                t(`Выход: ${Math.round(2 * yieldMult)} детали робота, ${Math.round(1 * yieldMult)} электроника`, `Yield: ${Math.round(2 * yieldMult)} scrap, ${Math.round(1 * yieldMult)} electronics`) :
                t(`Выход: ${Math.round(2 * yieldMult)} детали робота, ${Math.round(1 * yieldMult)} ткань`, `Yield: ${Math.round(2 * yieldMult)} scrap, ${Math.round(1 * yieldMult)} fabric`);

            UI.add({
                id: 'ws_recy_desc_' + i, kind: 'text', anchor: 'top-left',
                x: cardX + 10, y: cardY + 30, text: yieldDesc,
                fontSize: 10, color: '#82d9b2', shadow: '#000000', alpha: 1, visible: 1
            });

            const disBtn = UI.add({
                id: 'ws_recy_btn_' + i, kind: 'button', anchor: 'top-left',
                x: cardX + 210, y: cardY + 48, w: 112, h: 28, text: t('РАЗОБРАТЬ', 'DISMANTLE'),
                fontSize: 10, color: '#141c19', fill: '#e8914b', border: '#ffa663', radius: 3, alpha: 1, visible: 1
            });
            if (disBtn) {
                disBtn.onClick(() => {
                    if (typeof RaidRules !== 'undefined' && RaidRules.dismantleItem) {
                        const res = RaidRules.dismantleItem(this.stash, item);
                        if (res.success) {
                            this.workshopFeedback = t(`Предмет «${item.name}» успешно разобран на запчасти!`, `Dismantled «${item.name}» into salvage materials!`);
                            this.saveState();
                            this.refreshUI();
                        }
                    }
                });
            }
        }
    },

    renderScrappyStation(p, currentLevel, t) {
        const yieldData = typeof RaidRules !== 'undefined' && RaidRules.claimScrappyYield ?
            RaidRules.claimScrappyYield(p) : { scrap: 15, credits: 100 };
        const levelDots = '●'.repeat(currentLevel) + '○'.repeat(Math.max(0, 3 - currentLevel));

        // Retro CRT Readout Panel
        UI.add({
            id: 'ws_scrappy_panel', kind: 'panel', anchor: 'top-left',
            x: 62, y: 265, w: 676, h: 320,
            fill: '#0f1716', border: '#3b554c', radius: 6, alpha: 0.98, visible: 1
        });

        UI.add({
            id: 'ws_scrappy_hdr', kind: 'text', anchor: 'top-left',
            x: 82, y: 285, text: `${t('ДРОН-СБОРЩИК «СКРАППИ» (СЕРИЯ SC-7)', 'SCRAPPY RECON DRONE (MODEL SC-7)')}   [${t('УРОВЕНЬ', 'LVL')} ${currentLevel}/3]  ${levelDots}`,
            fontSize: 14, color: '#f0e8d7', shadow: '#000000', alpha: 1, visible: 1
        });

        const statusLine = t(
            '● СТАТУС: АКТИВНОЕ ПАТРУЛИРОВАНИЕ ПЕРИМЕТРА СЕКТОРА 01\n' +
            'Автономный дрон рыщет по развалинам Сперанцы, собирая остатки машин ARC.\n' +
            `Текущая емкость контейнера: +${yieldData.scrap} МЕТАЛЛОЛОМА  ·  +${yieldData.credits} КРЕДИТОВ\n` +
            'Контейнер полон и готов к разгрузке в склад оператора.',
            '● STATUS: ACTIVE PATROL OVER SECTOR 01 PERIMETER\n' +
            'Autonomous drone salvages scrap from destroyed ARC machines across Speranza.\n' +
            `Current cargo capacity: +${yieldData.scrap} ROBOT PARTS  ·  +${yieldData.credits} CREDITS\n` +
            'Cargo container is full and ready for deposit into operator stash.'
        );

        UI.add({
            id: 'ws_scrappy_text', kind: 'text', anchor: 'top-left',
            x: 82, y: 325, text: statusLine,
            fontSize: 11, color: '#a0b5ab', shadow: '#000000', alpha: 1, visible: 1
        });

        // Claim Yield Button
        const claimBtn = UI.add({
            id: 'ws_scrappy_claim_btn', kind: 'button', anchor: 'top-left',
            x: 82, y: 440, w: 320, h: 48,
            text: t(`ЗАБРАТЬ ДОБЫЧУ  (+${yieldData.scrap} ДЕТАЛЕЙ, +${yieldData.credits} CR)  ►`, `CLAIM YIELD  (+${yieldData.scrap} SCRAP, +${yieldData.credits} CR)  ►`),
            fontSize: 11, color: '#131b18', fill: '#55e0c5', border: '#b8fff3', radius: 4, alpha: 1, visible: 1
        });
        if (claimBtn) {
            claimBtn.onClick(() => {
                const scrapItem = (typeof ARC_ITEMS !== 'undefined' && ARC_ITEMS.steel_scrap) ?
                    JSON.parse(JSON.stringify(ARC_ITEMS.steel_scrap)) : { id: 'steel_scrap', name: 'STEEL SCRAP', nameRu: 'ДЕТАЛИ РОБОТА', category: 'materials', count: 1, weight: 1.0, value: 50 };
                scrapItem.id = 'scrap_' + Date.now();
                scrapItem.count = yieldData.scrap;
                this.stash.push(scrapItem);
                p.credits = (p.credits || 0) + yieldData.credits;
                this.workshopFeedback = t(`Скраппи доставил: +${yieldData.scrap} деталей, +${yieldData.credits} кредитов!`, `Scrappy delivered: +${yieldData.scrap} scrap, +${yieldData.credits} credits!`);
                this.saveState();
                this.refreshUI();
            });
        }

        const upCheck = typeof RaidRules !== 'undefined' && RaidRules.canUpgradeStation ?
            RaidRules.canUpgradeStation(p, this.stash, 'station_scrappy') : { canUpgrade: false, isMaxLevel: true, cost: null };
        let upText = '';
        if (upCheck.isMaxLevel) {
            upText = t('ДРОН МАКСИМАЛЬНО МОДЕРНИЗИРОВАН', 'MAX DRONE UPGRADE');
        } else {
            const cost = upCheck.cost;
            upText = t(`МОДЕРНИЗИРОВАТЬ ДРОНА (${cost?.credits || 600} CR + ${cost?.materials?.[0]?.count || 4} ДЕТАЛЕЙ)`, `UPGRADE DRONE (${cost?.credits || 600} CR + ${cost?.materials?.[0]?.count || 4} SCRAP)`);
        }

        const upDroneBtn = UI.add({
            id: 'ws_scrappy_up_btn', kind: 'button', anchor: 'top-left',
            x: 420, y: 440, w: 298, h: 48, text: upText,
            fontSize: 10, color: upCheck.canUpgrade ? '#141c19' : '#8fa099',
            fill: upCheck.canUpgrade ? '#e8cc72' : '#232c29',
            border: '#3d4b47', radius: 4, alpha: 1, visible: 1
        });
        if (upDroneBtn) {
            upDroneBtn.setDisabled(!upCheck.canUpgrade);
            upDroneBtn.onClick(() => {
                if (typeof RaidRules !== 'undefined' && RaidRules.upgradeStation) {
                    const res = RaidRules.upgradeStation(p, this.stash, 'station_scrappy');
                    if (res.success) {
                        this.workshopFeedback = t(`Скраппи модернизирован до уровня ${res.newLevel}! Скорость сбора увеличена.`, `Scrappy upgraded to Level ${res.newLevel}! Cargo yield increased.`);
                        this.saveState();
                        this.refreshUI();
                    }
                }
            });
        }
    },

    renderBlueprintsStation(p, t) {
        UI.add({
            id: 'ws_bp_title', kind: 'text', anchor: 'top-left',
            x: 62, y: 266,
            text: t('АРХИВ И ИЗУЧЕНИЕ ЧЕРТЕЖЕЙ ARC  ·  ТЕХНОЛОГИЧЕСКИЙ ДОСТУП', 'ARC BLUEPRINT ARCHIVE  ·  RESEARCH LAB'),
            fontSize: 12, color: '#f0e8d7', shadow: '#000000', alpha: 1, visible: 1
        });

        const blueprints = (typeof ARC_BLUEPRINTS !== 'undefined') ? Object.values(ARC_BLUEPRINTS) : [];
        for (let i = 0; i < blueprints.length && i < 5; i++) {
            const bp = blueprints[i];
            const cardY = 300 + i * 54;
            const isLearned = p.unlockedBlueprints && p.unlockedBlueprints.includes(bp.id);
            const inStash = this.stash.find(it => it && (it.id === bp.id || it.targetRecipe === bp.targetRecipe));

            UI.add({
                id: 'ws_bp_card_' + i, kind: 'panel', anchor: 'top-left',
                x: 62, y: cardY, w: 676, h: 48,
                fill: '#151c1c', border: isLearned ? '#356658' : inStash ? '#6e5f32' : '#2d3b37',
                radius: 4, alpha: 0.95, visible: 1
            });

            const def = (typeof ARC_ITEMS !== 'undefined' && ARC_ITEMS[bp.id]) ? ARC_ITEMS[bp.id] : null;
            const bpName = t(def?.nameRu || bp.id, def?.name || bp.id);
            const stName = (typeof ARC_WORKSHOP_STATIONS !== 'undefined' && ARC_WORKSHOP_STATIONS[bp.station?.replace('station_','')?.toUpperCase()]) ?
                t(ARC_WORKSHOP_STATIONS[bp.station.replace('station_','').toUpperCase()].nameRu, ARC_WORKSHOP_STATIONS[bp.station.replace('station_','').toUpperCase()].nameEn) : bp.station;

            UI.add({
                id: 'ws_bp_name_' + i, kind: 'text', anchor: 'top-left',
                x: 76, y: cardY + 16,
                text: `${bpName}   [${stName}]`,
                fontSize: 11, color: isLearned ? '#6de8c8' : (inStash ? '#ffea88' : '#cbd8d1'),
                shadow: '#000000', alpha: 1, visible: 1
            });

            if (isLearned) {
                UI.add({
                    id: 'ws_bp_status_' + i, kind: 'text', anchor: 'top-left',
                    x: 520, y: cardY + 16, text: t('ИЗУЧЕН ✓  РЕЦЕПТ ДОСТУПЕН', 'LEARNED ✓  CRAFT UNLOCKED'),
                    fontSize: 10, color: '#55e0c5', shadow: '#000000', alpha: 1, visible: 1
                });
            } else if (inStash) {
                const studyBtn = UI.add({
                    id: 'ws_bp_btn_' + i, kind: 'button', anchor: 'top-left',
                    x: 520, y: cardY + 9, w: 204, h: 30,
                    text: t('ИЗУЧИТЬ ЧЕРТЕЖ ИЗ СКЛАДА ✦', 'STUDY FROM STASH ✦'),
                    fontSize: 10, color: '#141c19', fill: '#f5c842', border: '#fff5b8', radius: 3, alpha: 1, visible: 1
                });
                if (studyBtn) {
                    studyBtn.onClick(() => {
                        if (typeof RaidRules !== 'undefined' && RaidRules.learnBlueprint) {
                            RaidRules.learnBlueprint(p, bp.id);
                            const idx = this.stash.indexOf(inStash);
                            if (idx !== -1) this.stash.splice(idx, 1);
                            this.workshopFeedback = t(`Чертеж «${bpName}» успешно изучен! Рецепт навсегда разблокирован.`, `Blueprint «${bpName}» studied! Recipe unlocked.`);
                            this.saveState();
                            this.refreshUI();
                        }
                    });
                }
            } else {
                UI.add({
                    id: 'ws_bp_status_' + i, kind: 'text', anchor: 'top-left',
                    x: 480, y: cardY + 16,
                    text: t('НЕ НАЙДЕН  (Ищите на объектах ARC)', 'NOT DISCOVERED  (Loot in ARC raids)'),
                    fontSize: 10, color: '#7a8983', shadow: '#000000', alpha: 1, visible: 1
                });
            }
        }
    },

    renderRaider(visible) {
        if (typeof UI === 'undefined' || !UI.elements) return;
        for (const id of [...UI.elements.keys()]) {
            if (id.startsWith('rd_')) UI.remove(id);
        }
        if (!visible) return;

        const t = (ru, en) => this.game.lang === 'ru' ? ru : en;
        const online = this.onlineLobby;
        const account = online?.authenticated ? online.client?.account : null;
        const p = this.profile;

        const progState = (typeof ProgressionSystem !== 'undefined') ? ProgressionSystem.state : {};
        const levelInfo = progState.levelInfo || { level: 1, xp: 0, neededForNext: 500, progressInLevel: 0, percent: 0 };
        const sp = progState.skillPoints !== undefined ? progState.skillPoints : (p.skillPoints || 0);

        this.raiderTab = this.raiderTab || 'skills';
        const isSkills = this.raiderTab === 'skills';

        // Toggle subtabs: [ НАВЫКИ ] vs [ ДОСЬЕ ]
        UI.add({
            id: 'rd_tab_skills', kind: 'button', anchor: 'top-left',
            x: 62, y: 132, w: 120, h: 28,
            text: t('★ НАВЫКИ', '★ SKILL TREE'),
            fontSize: 10, color: isSkills ? '#111816' : '#a8b8b0',
            fill: isSkills ? '#55e0c5' : '#1c2825',
            border: isSkills ? '#55e0c5' : '#334440',
            radius: 3, alpha: 1, visible: 1
        })?.onClick(() => { this.raiderTab = 'skills'; this.refreshUI(); });

        UI.add({
            id: 'rd_tab_record', kind: 'button', anchor: 'top-left',
            x: 188, y: 132, w: 120, h: 28,
            text: t('СВОДКА СЛУЖБЫ', 'SERVICE RECORD'),
            fontSize: 10, color: !isSkills ? '#111816' : '#a8b8b0',
            fill: !isSkills ? '#55e0c5' : '#1c2825',
            border: !isSkills ? '#55e0c5' : '#334440',
            radius: 3, alpha: 1, visible: 1
        })?.onClick(() => { this.raiderTab = 'record'; this.refreshUI(); });

        // Level & SP status
        UI.add({
            id: 'rd_header_info', kind: 'text', anchor: 'top-left',
            x: 320, y: 138,
            text: `${t('УРОВЕНЬ', 'LVL')} ${levelInfo.level}  ·  ${levelInfo.progressInLevel}/${levelInfo.neededForNext} XP  ·  ${sp} SP`,
            fontSize: 11, color: '#f5c842', shadow: '#000000', alpha: 1, visible: 1
        });

        // Calculate allocated skills for Respec button
        let allocatedCount = 0;
        const learnedSkills = progState.skills || p.skills || {};
        for (const b of Object.values(learnedSkills)) {
            if (b && typeof b === 'object') allocatedCount += Object.keys(b).length;
        }

        if (allocatedCount > 0 && isSkills) {
            const respecCost = allocatedCount * 1500;
            const canAfford = (online?.authenticated ? (account?.credits || 0) : (p.credits || 0)) >= respecCost;
            UI.add({
                id: 'rd_respec_btn', kind: 'button', anchor: 'top-left',
                x: 580, y: 132, w: 158, h: 28,
                text: `${t('СБРОС', 'RESPEC')} (${respecCost} CR)`,
                fontSize: 10, color: canAfford ? '#ff5252' : '#888888',
                fill: '#2a191a', border: canAfford ? '#ff525266' : '#443333',
                radius: 3, alpha: 1, visible: 1
            })?.onClick(() => {
                if (confirm(t(`Сбросить все вложенные навыки (${allocatedCount} шт.) за ${respecCost} CR?`, `Reset all allocated skills (${allocatedCount}) for ${respecCost} CR?`))) {
                    this.respecSkills();
                }
            });
        }

        // Hide or show career cards based on tab
        for (const id of ['operatorCardLeft', 'operatorCardRight', 'careerDetails', 'operatorLoadoutDetails', 'operatorStatus']) {
            UI.get(id)?.show(!isSkills);
        }

        if (!isSkills) return;

        // Render the 3 branches: Resilience, Agility, Scavenging
        const tree = progState.skillTree || (typeof ProgressionSystem !== 'undefined' ? ProgressionSystem.state.skillTree : null);
        if (!tree) return;

        const branchDefs = [
            { id: 'resilience', titleRu: 'СТОЙКОСТЬ', titleEn: 'RESILIENCE', subRu: 'Здоровье и защита', subEn: 'Health & Armor', x: 55 },
            { id: 'agility', titleRu: 'МОБИЛЬНОСТЬ', titleEn: 'AGILITY', subRu: 'Скорость и выносливость', subEn: 'Speed & Stamina', x: 285 },
            { id: 'scavenging', titleRu: 'ВЫЖИВАНИЕ', titleEn: 'SCAVENGING', subRu: 'Лут и сонар', subEn: 'Loot & Sonar', x: 515 }
        ];

        branchDefs.forEach(bDef => {
            const branchData = tree[bDef.id];
            if (!branchData || !branchData.skills) return;

            // Branch Column Header
            UI.add({
                id: `rd_br_title_${bDef.id}`, kind: 'text', anchor: 'top-left',
                x: bDef.x, y: 172,
                text: `${t(bDef.titleRu, bDef.titleEn)}\n${t(bDef.subRu, bDef.subEn)}`,
                fontSize: 10, color: '#55e0c5', shadow: '#000000', alpha: 1, visible: 1
            });

            // Skills in this branch
            const skillsList = Object.values(branchData.skills);
            skillsList.forEach((sk, idx) => {
                const cardY = 210 + idx * 62;
                const cardW = 218;
                const cardH = 56;

                const isLearned = !!(learnedSkills[bDef.id]?.[sk.id]);
                const canLearn = !isLearned && sp > 0 && (!sk.req || !!(learnedSkills[bDef.id]?.[sk.req]));
                const isLocked = !isLearned && !canLearn;

                let cardBg = '#141e1b';
                let cardBorder = '#2e423b';
                let titleColor = '#e2ede7';
                let statusText = '';

                if (isLearned) {
                    cardBg = '#173328';
                    cardBorder = '#52e392';
                    titleColor = '#73fab0';
                    statusText = t('✔ ИЗУЧЕНО', '✔ LEARNED');
                } else if (canLearn) {
                    cardBg = '#22362f';
                    cardBorder = '#e8cc72';
                    titleColor = '#ffea88';
                    statusText = t('[+] ИЗУЧИТЬ (1 SP)', '[+] LEARN (1 SP)');
                } else {
                    cardBg = '#131818';
                    cardBorder = '#242e2b';
                    titleColor = '#7a8c85';
                    const reqSk = sk.req ? branchData.skills[sk.req] : null;
                    const reqName = reqSk ? t(reqSk.nameRu, reqSk.nameEn) : '1 SP';
                    statusText = sp <= 0 && (!sk.req || learnedSkills[bDef.id]?.[sk.req]) ? t('🔒 НУЖЕН 1 SP', '🔒 REQUIRES 1 SP') : `🔒 ${reqName}`;
                }

                const card = UI.add({
                    id: `rd_sk_${bDef.id}_${sk.id}`, kind: 'button', anchor: 'top-left',
                    x: bDef.x, y: cardY, w: cardW, h: cardH,
                    text: `${t(sk.nameRu, sk.nameEn)} [T${sk.tier}]\n${t(sk.descRu, sk.descEn)}\n${statusText}`,
                    fontSize: 9, color: titleColor, fill: cardBg, border: cardBorder,
                    radius: 4, alpha: 1, visible: 1
                });

                if (card) {
                    card.setDisabled(!canLearn);
                    if (canLearn) {
                        card.onClick(() => {
                            this.allocateSkill(bDef.id, sk.id);
                        });
                    }
                }
            });
        });
    },

    renderTraders(visible) {
        if (typeof UI === 'undefined' || !UI.elements) return;
        for (const id of [...UI.elements.keys()]) {
            if (id.startsWith('tr_dyn_')) UI.remove(id);
        }
        if (!visible) return;

        const t = (ru, en) => this.game.lang === 'ru' ? ru : en;
        const activeId = this.activeTraderId || 'marco';
        const progState = (typeof ProgressionSystem !== 'undefined') ? ProgressionSystem.state : {};
        const trust = progState.vendorTrust?.[activeId] || { level: 1, trust: 0, discount: 0, titleRu: 'Незнакомец', titleEn: 'Stranger', percent: 0, nextTierTrust: 500 };

        this.traderTab = this.traderTab || 'goods';
        const isGoods = this.traderTab === 'goods';

        // Trust Tier Banner
        const discountPct = Math.round((trust.discount || 0) * 100);
        UI.add({
            id: 'tr_dyn_trust_banner', kind: 'text', anchor: 'top-left',
            x: 62, y: 170,
            text: `${t('ДОВЕРИЕ', 'TRUST')}: ${trust.level} (${t(trust.titleRu, trust.titleEn)})  ·  ${t('СКИДКА', 'DISCOUNT')}: ${discountPct}%  ·  ${trust.trust || 0} / ${trust.nextTierTrust || 500} XP (${trust.percent || 0}%)`,
            fontSize: 11, color: '#e8cc72', shadow: '#000000', alpha: 1, visible: 1
        });

        // Subtabs: [ АССОРТИМЕНТ ] vs [ КОНТРАКТЫ ]
        UI.add({
            id: 'tr_dyn_tab_goods', kind: 'button', anchor: 'top-left',
            x: 62, y: 232, w: 154, h: 28,
            text: t('АССОРТИМЕНТ', 'GOODS & GEAR'),
            fontSize: 10, color: isGoods ? '#111816' : '#a8b8b0',
            fill: isGoods ? '#55e0c5' : '#1c2825',
            border: isGoods ? '#55e0c5' : '#334440',
            radius: 3, alpha: 1, visible: 1
        })?.onClick(() => { this.traderTab = 'goods'; this.refreshUI(); });

        const activeContracts = (progState.contracts?.active || []).filter(c => {
            const def = (progState.availableContracts || []).find(ac => ac.id === c.id);
            return def && def.vendor === activeId;
        });

        UI.add({
            id: 'tr_dyn_tab_contracts', kind: 'button', anchor: 'top-left',
            x: 226, y: 232, w: 154, h: 28,
            text: `${t('КОНТРАКТЫ', 'CONTRACTS')} (${activeContracts.length})`,
            fontSize: 10, color: !isGoods ? '#111816' : '#a8b8b0',
            fill: !isGoods ? '#55e0c5' : '#1c2825',
            border: !isGoods ? '#55e0c5' : '#334440',
            radius: 3, alpha: 1, visible: 1
        })?.onClick(() => { this.traderTab = 'contracts'; this.refreshUI(); });

        // Show/hide goods buttons
        for (let i = 0; i < 6; i++) {
            UI.get('traderItem' + i)?.show(isGoods);
        }
        UI.get('traderBuyFeedback')?.show(isGoods);

        if (isGoods) return;

        // Render Contracts for this vendor
        const allAvailable = (progState.availableContracts || []).filter(ac => ac.vendor === activeId);
        const myActive = progState.contracts?.active || [];
        const myCompleted = progState.contracts?.completed || [];

        let currentY = 270;

        // 1. Active Contracts from this vendor
        if (activeContracts.length > 0) {
            UI.add({
                id: 'tr_dyn_act_header', kind: 'text', anchor: 'top-left',
                x: 62, y: currentY,
                text: t('ТЕКУЩИЕ ОПЕРАТИВНЫЕ ЗАДАНИЯ', 'ACTIVE DIRECTIVES'),
                fontSize: 11, color: '#73fab0', shadow: '#000000', alpha: 1, visible: 1
            });
            currentY += 22;

            activeContracts.forEach((act, idx) => {
                const def = (progState.availableContracts || []).find(ac => ac.id === act.id);
                if (!def) return;

                const cardH = 54;
                UI.add({
                    id: `tr_dyn_act_card_${idx}`, kind: 'panel', anchor: 'top-left',
                    x: 62, y: currentY, w: 646, h: cardH,
                    fill: '#15241e', border: act.completed ? '#52e392' : '#39574a',
                    radius: 4, alpha: 0.95, visible: 1
                });

                const statusLine = act.completed
                    ? t('ГОТОВО К СДАЧЕ ✓', 'READY TO CLAIM ✓')
                    : `${t('ПРОГРЕСС', 'PROGRESS')}: ${act.progress || 0} / ${def.targetCount}`;

                UI.add({
                    id: `tr_dyn_act_title_${idx}`, kind: 'text', anchor: 'top-left',
                    x: 74, y: currentY + 8,
                    text: `${t(def.titleRu, def.titleEn)}  ·  ${statusLine}\n${t(def.descRu, def.descEn)}`,
                    fontSize: 10, color: '#e8edea', shadow: '#000000', alpha: 1, visible: 1
                });

                if (act.completed) {
                    const claimBtn = UI.add({
                        id: `tr_dyn_act_btn_${idx}`, kind: 'button', anchor: 'top-left',
                        x: 510, y: currentY + 12, w: 186, h: 30,
                        text: `${t('ЗАБРАТЬ', 'CLAIM')} (+${def.rewards?.credits || 0} CR) ★`,
                        fontSize: 10, color: '#0c1a14', fill: '#52e392', border: '#8cffc1',
                        radius: 3, alpha: 1, visible: 1
                    });
                    if (claimBtn) {
                        claimBtn.onClick(() => {
                            this.claimContract(def.id);
                        });
                    }
                }
                currentY += cardH + 10;
            });
        }

        // 2. Available Contracts from this vendor
        const unaccepted = allAvailable.filter(ac => !myActive.some(a => a.id === ac.id) && !myCompleted.includes(ac.id));

        UI.add({
            id: 'tr_dyn_avail_header', kind: 'text', anchor: 'top-left',
            x: 62, y: currentY,
            text: t('ДОСТУПНЫЕ КОНТРАКТЫ', 'AVAILABLE CONTRACTS'),
            fontSize: 11, color: '#e8cc72', shadow: '#000000', alpha: 1, visible: 1
        });
        currentY += 22;

        if (unaccepted.length === 0) {
            UI.add({
                id: 'tr_dyn_no_avail', kind: 'text', anchor: 'top-left',
                x: 62, y: currentY,
                text: t('Все доступные контракты данного торговца уже приняты или выполнены.', 'All directives for this vendor have been accepted or completed.'),
                fontSize: 10, color: '#889e94', shadow: '#000000', alpha: 1, visible: 1
            });
            return;
        }

        unaccepted.slice(0, 3).forEach((def, idx) => {
            const cardH = 58;
            UI.add({
                id: `tr_dyn_avail_card_${idx}`, kind: 'panel', anchor: 'top-left',
                x: 62, y: currentY, w: 646, h: cardH,
                fill: '#151c1a', border: '#2d3e38', radius: 4, alpha: 0.95, visible: 1
            });

            const rew = def.rewards || {};
            const rewText = `+${rew.credits || 0} CR  ·  +${rew.xp || 0} XP  ·  +${rew.trust || 0} ${t('ДОВЕРИЯ', 'TRUST')}`;

            UI.add({
                id: `tr_dyn_avail_title_${idx}`, kind: 'text', anchor: 'top-left',
                x: 74, y: currentY + 8,
                text: `${t(def.titleRu, def.titleEn)}   [${rewText}]\n${t(def.descRu, def.descEn)}`,
                fontSize: 10, color: '#e8edea', shadow: '#000000', alpha: 1, visible: 1
            });

            const canAccept = myActive.length < 4;
            const acceptBtn = UI.add({
                id: `tr_dyn_avail_btn_${idx}`, kind: 'button', anchor: 'top-left',
                x: 530, y: currentY + 14, w: 166, h: 30,
                text: canAccept ? t('ПРИНЯТЬ КОНТРАКТ', 'ACCEPT DIRECTIVE') : t('ЛИМИТ 4/4', 'LIMIT 4/4'),
                fontSize: 9, color: canAccept ? '#131b18' : '#6f7e77',
                fill: canAccept ? '#e8cc72' : '#222c28',
                border: canAccept ? '#fff0a6' : '#33423c',
                radius: 3, alpha: 1, visible: 1
            });
            if (acceptBtn) {
                acceptBtn.setDisabled(!canAccept);
                if (canAccept) {
                    acceptBtn.onClick(() => {
                        this.acceptContract(def.id);
                    });
                }
            }
            currentY += cardH + 8;
        });
    },

    renderHub(visible) {
        if (typeof UI === 'undefined' || !UI.elements) return;
        for (const id of [...UI.elements.keys()]) {
            if (id.startsWith('hub_dyn_')) UI.remove(id);
        }
        if (!visible) return;

        const t = (ru, en) => this.game.lang === 'ru' ? ru : en;

        // Emergency Scavenger Kit when player is broke
        if (this.isBroke()) {
            const kitBtn = UI.add({
                id: 'hub_dyn_free_kit', kind: 'button', anchor: 'bottom-left',
                x: 34, y: 135, w: 430, h: 44,
                text: t('⚠ БЕСПЛАТНЫЙ НАБОР СНАБЖЕНИЯ (РЕКРУТ) ►', '⚠ CLAIM EMERGENCY SCAVENGER KIT ►'),
                fontSize: 11, color: '#131b18', fill: '#ff6e40', border: '#ffab91',
                radius: 4, alpha: 1, visible: 1
            });
            if (kitBtn) {
                kitBtn.onClick(() => {
                    this.claimFreeKit();
                });
            }
        }
    },

    allocateSkill(branch, skillId) {
        if (this.onlineLobby?.authenticated) {
            return this.onlineLobby.allocateSkill(branch, skillId);
        }
        const p = this.profile;
        p.skillPoints = p.skillPoints || 0;
        if (p.skillPoints <= 0) return;
        p.skills = p.skills || { resilience: {}, agility: {}, scavenging: {} };
        p.skills[branch] = p.skills[branch] || {};
        p.skills[branch][skillId] = true;
        p.skillPoints--;
        if (typeof ProgressionSystem !== 'undefined') {
            ProgressionSystem.state.skillPoints = p.skillPoints;
            ProgressionSystem.state.skills = p.skills;
        }
        this.saveState();
        this.refreshUI();
    },

    respecSkills() {
        if (this.onlineLobby?.authenticated) {
            return this.onlineLobby.respecSkills();
        }
        const p = this.profile;
        p.skills = p.skills || { resilience: {}, agility: {}, scavenging: {} };
        let allocated = 0;
        for (const b of Object.values(p.skills)) allocated += Object.keys(b || {}).length;
        if (allocated === 0) return;
        const cost = allocated * 1500;
        if ((p.credits || 0) < cost) return;
        p.credits -= cost;
        p.skillPoints = (p.skillPoints || 0) + allocated;
        p.skills = { resilience: {}, agility: {}, scavenging: {} };
        if (typeof ProgressionSystem !== 'undefined') {
            ProgressionSystem.state.skillPoints = p.skillPoints;
            ProgressionSystem.state.skills = p.skills;
        }
        this.saveState();
        this.refreshUI();
    },

    acceptContract(contractId) {
        if (this.onlineLobby?.authenticated) {
            return this.onlineLobby.acceptContract(contractId);
        }
        const p = this.profile;
        p.contracts = p.contracts || { active: [], completed: [] };
        p.contracts.active = p.contracts.active || [];
        if (p.contracts.active.some(c => c.id === contractId)) return;
        if (p.contracts.active.length >= 4) return;
        p.contracts.active.push({ id: contractId, progress: 0, completed: false });
        if (typeof ProgressionSystem !== 'undefined') {
            ProgressionSystem.state.contracts = p.contracts;
        }
        this.saveState();
        this.refreshUI();
    },

    claimContract(contractId) {
        if (this.onlineLobby?.authenticated) {
            return this.onlineLobby.claimContract(contractId);
        }
        const p = this.profile;
        p.contracts = p.contracts || { active: [], completed: [] };
        const idx = (p.contracts.active || []).findIndex(c => c.id === contractId);
        if (idx === -1) return;
        const c = p.contracts.active[idx];
        if (!c.completed) return;
        p.contracts.active.splice(idx, 1);
        p.contracts.completed = p.contracts.completed || [];
        p.contracts.completed.push(contractId);
        const def = (typeof ProgressionSystem !== 'undefined' && ProgressionSystem.state.availableContracts)
            ? ProgressionSystem.state.availableContracts.find(ac => ac.id === contractId) : null;
        if (def && def.rewards) {
            p.credits = (p.credits || 0) + (def.rewards.credits || 0);
            p.xp = (p.xp || 0) + (def.rewards.xp || 0);
            if (def.vendor && p.vendorTrust) {
                p.vendorTrust[def.vendor] = (p.vendorTrust[def.vendor] || 0) + (def.rewards.trust || 0);
            }
        }
        this.saveState();
        this.refreshUI();
    },

    claimFreeKit() {
        if (this.onlineLobby?.authenticated) {
            return this.onlineLobby.claimFreeKit();
        }
        const p = this.profile;
        p.credits = (p.credits || 0) + 200;
        // `revolver_starter` is not in the registry: the starter sidearm is the tier-I revolver.
        // Read through a widened view so the lookup is a runtime check (as intended by the
        // ternary) instead of a compile-time error — the table's keys are content, not an API.
        const items = /** @type {Record<string, any>} */ (typeof ARC_ITEMS !== 'undefined' ? ARC_ITEMS : {});
        const starterId = items.revolver_starter ? 'revolver_starter' : (items.revolver_i ? 'revolver_i' : '');
        const revolver = (starterId && items[starterId])
            ? JSON.parse(JSON.stringify(items[starterId]))
            : { id: 'revolver_starter', name: 'REVOLVER I', nameRu: 'РЕВОЛЬВЕР I', category: 'weapons', slotType: 'secondary', tier: 'I', rarity: 'Common', weight: 1.6, value: 150 };
        this.loadout.secondary = revolver;
        const ammo = { id: 'ammo_light_' + Date.now(), name: 'LIGHT AMMO ×60', nameRu: 'ЛЕГКИЕ ПАТРОНЫ ×60', category: 'ammo', count: 60, weight: 1.0, value: 60 };
        this.stash.push(ammo);
        this.saveState();
        this.refreshUI();
    },

    isBroke() {
        const creds = this.onlineLobby?.authenticated ? (this.onlineLobby.client?.account?.credits ?? this.profile.credits ?? 0) : (this.profile.credits || 0);
        if (creds >= 500) return false;
        if (this.loadout.primary || this.loadout.secondary) return false;
        const hasWeaponInStash = (this.stash || []).some(it => it && (it.category === 'weapons' || it.slotType === 'primary' || it.slotType === 'secondary'));
        return !hasWeaponInStash;
    },

    refreshPresentation() {
        const screen = this.currentScreen, menu = screen !== 'IN_RAID', p = this.game.profile;
        const t = (ru, en) => this.game.lang === 'ru' ? ru : en;
        const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
        const groups = {
            common: ['navPlay','navWorkshop','navRaider','navTraders','navDecks','navStore','menuBrand','socialBtn'],
            HUB: [
                'liveEventCard','hubEventTitle','hubEventBody',
                'featsCard','hubCareerTitle','hubCareerBody',
                'partyPanel','readyToggle','startRaidBtn','partyLeaderCrown','partyMemberSlot0','partyMemberSlot1','partyMemberSlot2',
                'hubMap','hubSubtitle','hubMapCaption','hubLoadoutBtn','hubTitle','hubSector','hubSolo'
            ],
            INVENTORY: ['catalogNote','loadoutTitle','loadoutWeapon','loadoutAmmo','loadoutSupplies','loadoutNote','stashSellAllBtn','stashSellJunkBtn'],
            MAP_SELECT: ['mapLegend','dispatcherCard','dispatcherTitle','dispatcherChecks','dispatcherStatus','dispatcherBlockedHint','dispatcherFreeKitBtn'],
            WORKSHOP: ['upgradeAmmo','upgradeMedkit','upgradeArmor','workshopInfo','workshopNote'],
            STORE: ['systemQuality','systemSensitivity','systemLanguage','systemControls'],
            RAIDER: ['raiderPanel', ...(this.raiderTab === 'skills' ? [] : ['operatorCardLeft','operatorCardRight','careerDetails','operatorLoadoutDetails','operatorStatus'])],
            DECKS: ['raiderPanel','raiderTitle','operatorCardLeft','operatorCardRight','careerDetails','operatorLoadoutDetails','operatorStatus'],
            TRADERS: ['tradersPanel','traderTitle','traderSubtitle','traderNavMarco','traderNavElena','traderNavBruno','traderNavSofia', ...(this.traderTab === 'contracts' ? [] : ['traderItem0','traderItem1','traderItem2','traderItem3','traderItem4','traderItem5','traderBuyFeedback'])]
        };
        const allKnownScreenIds = [
            'navPlay','navWorkshop','navRaider','navTraders','navDecks','navStore','menuBrand','socialBtn','menuHint',
            'liveEventCard','hubEventTitle','hubEventBody','featsCard','hubCareerTitle','hubCareerBody',
            'hubMap','hubSubtitle','hubMapCaption','hubLoadoutBtn','hubTitle','hubSector','hubSolo',
            'partyPanel','readyToggle','startRaidBtn','partyLeaderCrown','partyMemberSlot0','partyMemberSlot1','partyMemberSlot2',
            'mapLegend','dispatcherCard','dispatcherTitle','dispatcherChecks','dispatcherStatus','dispatcherBlockedHint','dispatcherFreeKitBtn',
            'upgradeAmmo','upgradeMedkit','upgradeArmor','workshopInfo','workshopNote',
            'systemQuality','systemSensitivity','systemLanguage','systemControls',
            'raiderPanel','raiderTitle','operatorCardLeft','operatorCardRight','careerDetails','operatorLoadoutDetails','operatorStatus',
            'tradersPanel','traderTitle','traderSubtitle','traderNavMarco','traderNavElena','traderNavBruno','traderNavSofia',
            'traderItem0','traderItem1','traderItem2','traderItem3','traderItem4','traderItem5','traderBuyFeedback'
        ];
        // Shared records (operator/logbook) must be resolved once, not hidden by
        // whichever group happens to be visited last.
        const visibleRecords = new Set([...groups.common, ...(groups[screen] || [])]);
        for (const id of allKnownScreenIds) UI.get(id)?.show(menu && visibleRecords.has(id));
        UI.get('navPlay')?.setSelected(screen === 'HUB' || screen === 'MAP_SELECT');
        UI.get('navWorkshop')?.setSelected(screen === 'WORKSHOP');
        UI.get('navRaider')?.setSelected(screen === 'RAIDER');
        UI.get('navTraders')?.setSelected(screen === 'TRADERS');
        UI.get('navDecks')?.setSelected(screen === 'DECKS');
        UI.get('navStore')?.setSelected(screen === 'STORE');
        const label = (id, ru, en) => UI.get(id)?.setText(t(ru,en));
        for (const [id, ru, en] of [
            ['navPlay','[01] РЕЙД','[01] PLAY'],
            ['navWorkshop','[02] МАСТЕРСКАЯ','[02] WORKSHOP'],
            ['navRaider','[03] ОПЕРАТОР','[03] OPERATOR'],
            ['navTraders','[04] ТОРГОВЦЫ','[04] TRADERS'],
            ['navDecks','[05] СВОДКА','[05] LOGBOOK'],
            ['navStore','[06] НАСТРОЙКИ','[06] SETTINGS']
        ]) label(id,ru,en);
        label('menuBrand', 'B / W', 'B / W');
        const online = this.onlineLobby;
        const notifications = (online?.partyState?.invites?.length || 0) + (online?.friendsState?.requests?.incoming?.length || 0);
        UI.get('socialBtn')?.setText('ДРУЗЬЯ И ОТРЯД' + (notifications ? `  · ${notifications} НОВЫХ` : ''));
        UI.get('menuHint')?.show(false);
        const account = online?.client?.account;
        const serverStats = account?.stats || null;
        if (online?.authenticated) {
            UI.get('currencyTag')?.setText(account ? `${Number(account.credits).toLocaleString()} CR` : '— CR');
            for (const id of ['itemSellBtn','stashSellAllBtn','stashSellJunkBtn']) UI.get(id)?.setDisabled(false);
        }
        const prog = (typeof ProgressionSystem !== 'undefined') ? ProgressionSystem.state : {};
        const pLvl = prog.level || p.level || 1;
        label('profileTag', account ? `${account.name} · УР.${pLvl} // ONLINE` : `ОПЕРАТОР · УР.${pLvl} // CITADEL`, account ? `${account.name} · LVL ${pLvl} // ONLINE` : `OPERATOR · LVL ${pLvl} // CITADEL`);
        label('hubTitle','BLACKWATER','BLACKWATER');
        label('hubSubtitle','Войти. Найти данные. Вернуться живым.','Get in. Recover the data. Get out alive.');
        label('hubMapCaption','РАЗВЕДДАННЫЕ / СЕКТОР 01','RECON / SECTOR 01');
        label('hubLoadoutBtn','ПРОВЕРИТЬ СНАРЯЖЕНИЕ  ↗','REVIEW LOADOUT  ↗');

        // Active contract or mission objective
        const activeContracts = prog.contracts?.active || [];
        if (activeContracts.length > 0) {
            const firstContract = activeContracts[0];
            const def = (prog.availableContracts || []).find(ac => ac.id === firstContract.id);
            const title = def ? (this.game.lang === 'ru' ? def.titleRu : def.titleEn) : 'КОНТРАКТ';
            const target = def?.target?.count || 1;
            const progCount = firstContract.progress || 0;
            label('hubEventTitle', '01  /  АКТИВНЫЙ КОНТРАКТ', '01  /  ACTIVE DIRECTIVE');
            label('hubEventBody', `${title}\nПрогресс: ${progCount} / ${target}${firstContract.completed ? ' (ГОТОВ)' : ''}`, `${title}\nProgress: ${progCount} / ${target}${firstContract.completed ? ' (READY)' : ''}`);
        } else {
            label('hubEventTitle', '01  /  ЦЕЛЬ ОПЕРАЦИИ', '01  /  MISSION OBJECTIVE');
            label('hubEventBody', `Восстановить данные\nНайти накопители: 0 / ${this.game.c.lootTarget || 3}`, `Recover data drives\nDrives needed: 0 / ${this.game.c.lootTarget || 3}`);
        }

        label('hubCareerTitle', '02  /  ПОСЛУЖНОЙ СПИСОК', '02  /  SERVICE RECORD');
        const xpLineRu = `УР.${pLvl} (${prog.levelInfo?.progressInLevel || 0}/${prog.levelInfo?.neededForNext || 500} XP)`;
        const xpLineEn = `LVL ${pLvl} (${prog.levelInfo?.progressInLevel || 0}/${prog.levelInfo?.neededForNext || 500} XP)`;
        const raidsCount = serverStats?.raids ?? p.raids ?? 0;
        const extractsCount = serverStats?.extractions ?? p.extractions ?? 0;
        const credsCount = account ? Number(account.credits).toLocaleString() : (p.credits || 0).toLocaleString();
        label('hubCareerBody',
            `${xpLineRu}  ·  ${prog.skillPoints || 0} SP\nРейды: ${raidsCount}  ·  Эвакуации: ${extractsCount}  ·  ${credsCount} CR`,
            `${xpLineEn}  ·  ${prog.skillPoints || 0} SP\nRaids: ${raidsCount}  ·  Extracts: ${extractsCount}  ·  ${credsCount} CR`);
        label('hubSector','ОПЕРАЦИЯ 01 / ПРОМЫШЛЕННЫЙ ПЕРИМЕТР','OPERATION 01 / INDUSTRIAL PERIMETER');
        const party = online?.partyState?.party;
        const partySize = party?.members?.length || 1;
        const isParty = party && party.members.length > 1;
        const isLeader = !isParty || party.leaderId === account?.id;
        const leaderMember = party?.members?.find(m => m.leader);
        const myMember = party?.members?.find(m => m.name === account?.name);
        const myReady = isLeader ? true : !!myMember?.ready;

        UI.get('squadInviteBtn')?.show(screen === 'HUB').setText(Array.from({ length: 4 }, (_, i) => i < partySize ? '◉' : '+').join('     '));

        let squadTextRu = account ? `●  СЕТЕВОЙ ОТРЯД ${partySize}/4` : '●  ЛОКАЛЬНЫЙ РЕЙД';
        let squadTextEn = account ? `●  ONLINE SQUAD ${partySize}/4` : '●  LOCAL RAID';
        if (account && isParty) {
            if (isLeader) {
                squadTextRu = `👑 ВЫ КОМАНДИР · ОТРЯД ${partySize}/4\n${party.allReady ? '✔ Все бойцы готовы к рейду' : '⏳ Ожидание готовности бойцов…'}`;
                squadTextEn = `👑 YOU ARE LEADER · SQUAD ${partySize}/4\n${party.allReady ? '✔ All members ready' : '⏳ Waiting for squad…'}`;
            } else {
                squadTextRu = `👑 ${leaderMember?.name || 'КОМАНДИР'} · ОТРЯД ${partySize}/4\n${myReady ? '✔ ВЫ ГОТОВЫ К ВЫСАДКЕ' : '⏳ ВЫ НЕ ГОТОВЫ (НАЖМИТЕ КНОПКУ)'}`;
                squadTextEn = `👑 ${leaderMember?.name || 'LEADER'} · SQUAD ${partySize}/4\n${myReady ? '✔ YOU ARE READY' : '⏳ YOU ARE NOT READY'}`;
            }
        }
        label('hubSolo', squadTextRu, squadTextEn);

        let playLabelRu = '▶  ИГРАТЬ';
        let playLabelEn = '▶  PLAY';
        if (online?.authenticated) {
            if (online.matched) {
                playLabelRu = 'ВОЙТИ В РЕЙД';
                playLabelEn = 'ENTER RAID';
            } else if (online.queued) {
                if (isLeader) {
                    playLabelRu = 'ОТМЕНИТЬ ПОИСК РЕЙДА';
                    playLabelEn = 'CANCEL MATCHMAKING';
                } else {
                    playLabelRu = 'ПОИСК РЕЙДА… (КОМАНДИР ИЩЕТ)';
                    playLabelEn = 'SEARCHING… (LEADER QUEUED)';
                }
            } else if (isParty && !isLeader) {
                if (myReady) {
                    playLabelRu = '✔  ГОТОВ (ОТМЕНИТЬ)';
                    playLabelEn = '✔  READY (CANCEL)';
                } else {
                    playLabelRu = '⏳  ПОДТВЕРДИТЬ ГОТОВНОСТЬ';
                    playLabelEn = '⏳  READY UP';
                }
            } else if (isParty && isLeader && !party.allReady) {
                playLabelRu = '⏳  ОЖИДАНИЕ ОТРЯДА';
                playLabelEn = '⏳  WAITING FOR SQUAD';
            } else {
                playLabelRu = 'ВЫБРАТЬ РЕЙД';
                playLabelEn = 'SELECT RAID';
            }
        }
        label('mainPlayBtn', playLabelRu, playLabelEn);
        label('menuBackBtn','ESC  НАЗАД','ESC  BACK');
        label('inventoryHotkeyBtn','TAB  СНАРЯЖЕНИЕ','TAB  LOADOUT');
        label('menuHint', account ? 'АВТОРИЗОВАННЫЙ СЕРВЕР / v0.6 ONLINE' : 'ЛОКАЛЬНЫЙ ПРОФИЛЬ / v0.6', account ? 'AUTHORITATIVE SERVER / v0.6 ONLINE' : 'LOCAL PROFILE / v0.6');
        label('mapTitle','ПРОМЫШЛЕННЫЙ ПЕРИМЕТР','INDUSTRIAL PERIMETER');
        label('mapLegend','ПЛАН ОПЕРАЦИИ','OPERATION BRIEF');
        label('mapSectorInfo',`01  Найти ${this.game.c.lootTarget} накопителя\n\n02  Вызвать транспорт\n      Ожидание ${this.game.c.inboundSec} секунд\n\n03  Удержать зону посадки\n      ${this.game.c.extractSec} секунд без противников\n\nПри гибели добыча теряется.`,`01  Recover ${this.game.c.lootTarget} data drives\n\n02  Call transport\n      ETA ${this.game.c.inboundSec} seconds\n\n03  Hold the extraction zone\n      ${this.game.c.extractSec} seconds uncontested\n\nDeath loses carried loot.`);
        label('deployLaunchBtn','НАЧАТЬ РЕЙД  →','DEPLOY INTO RAID  →');
        label('stashTitle','Снаряжение','Loadout');
        label('catalogNote','ХРАНИЛИЩЕ / '+this.stash.length+' ПРЕДМЕТОВ','STASH / '+this.stash.length+' ITEMS');
        const totalStashVal = this.stash.reduce((acc, it) => acc + (Number(it.value) || 0), 0);
        label('stashSellAllBtn', 'ПРОДАТЬ ВСЁ  (' + totalStashVal + ' CR)', 'SELL ALL  (' + totalStashVal + ' CR)');
        UI.get('stashSellAllBtn')?.show(screen === 'INVENTORY' && this.stash.length > 0);

        const junkCalc = typeof RaidRules !== 'undefined' && RaidRules.sellJunk ? RaidRules.sellJunk(this.stash) : { creditsEarned: 0, junkCount: 0 };
        label('stashSellJunkBtn', 'СДАТЬ ХЛАМ  (' + junkCalc.creditsEarned + ' CR)', 'SELL JUNK  (' + junkCalc.creditsEarned + ' CR)');
        UI.get('stashSellJunkBtn')?.show(screen === 'INVENTORY').setDisabled(junkCalc.junkCount === 0);

        label('loadoutTitle','НА СЛЕДУЮЩИЙ РЕЙД','NEXT RAID LOADOUT');
        const effStats = (this.loadout.primary && typeof RaidRules !== 'undefined' && RaidRules.getWeaponEffectiveStats) ? RaidRules.getWeaponEffectiveStats(this.loadout.primary) : null;
        const mods = this.loadout.primary?.attachments || {};
        const activeMods = Object.values(mods).filter(Boolean);
        const modSummary = activeMods.length > 0 ? ` [${activeMods.length} MOD]` : '';
        const weaponTitle = this.loadout.primary ? (this.loadout.primary.name.toUpperCase() + modSummary) : 'ШТУРМОВАЯ ВИНТОВКА';
        label('loadoutWeapon', weaponTitle, this.loadout.primary ? (this.loadout.primary.name.toUpperCase() + modSummary) : 'ASSAULT RIFLE');
        const activeMag = effStats ? effStats.magSize : this.game.c.mag;
        label('loadoutAmmo',`${activeMag} / ${this.game.c.reserveAmmo+p.ammoLevel*20} ПАТРОНОВ`,`${activeMag} / ${this.game.c.reserveAmmo+p.ammoLevel*20} ROUNDS`);
        const totalWeight = typeof RaidRules !== 'undefined' && RaidRules.calculateLoadoutWeight ? RaidRules.calculateLoadoutWeight(this.loadout, this.backpack) : 18.5;
        const encTier = typeof RaidRules !== 'undefined' && RaidRules.getEncumbrance ? RaidRules.getEncumbrance(totalWeight) : { nameRu: 'СРЕДНИЙ', nameEn: 'MEDIUM' };
        const shieldHp = this.loadout.shieldCore?.shieldHp || this.loadout.shieldCore?.maxHp || 100;
        const secWeapon = this.loadout.secondary ? (this.loadout.secondary.nameRu || this.loadout.secondary.name) : t('НЕТ', 'NONE');
        const safeSlots = Array.isArray(this.loadout.safePocket) ? this.loadout.safePocket.length : 2;
        const quickSlotsCount = Array.isArray(this.loadout.quickSlots) ? this.loadout.quickSlots.filter(Boolean).length : 0;
        const modsLine = activeMods.length > 0 ? ('\n\nМОДУЛИ  ' + activeMods.map(m => m.nameRu || m.name).join(' · ')) : '';
        const modsLineEn = activeMods.length > 0 ? ('\n\nMODS  ' + activeMods.map(m => m.name || m.nameRu).join(' · ')) : '';
        label('loadoutSupplies',
            `Вторичное оружие\n${secWeapon}\n\nЩит  ${shieldHp} HP    ·    Масса  ${totalWeight} / 40 кг\n\nБезопасный карман  ${safeSlots} яч.\nБыстрые слоты  ${quickSlotsCount} / 4\n\nЗдоровье  ${this.game.c.hp+Math.min(3,p.armorLevel)*5}    ·    Рюкзак  ${this.game.mechanics.slots} мест`,
            `Secondary weapon\n${secWeapon}\n\nShield  ${shieldHp} HP    ·    Load  ${totalWeight} / 40 kg\n\nSafe pocket  ${safeSlots} slots\nQuick slots  ${quickSlotsCount} / 4\n\nHealth  ${this.game.c.hp+Math.min(3,p.armorLevel)*5}    ·    Backpack  ${this.game.mechanics.slots} slots`);
        label('loadoutNote','Улучшения стартового комплекта\nдоступны в мастерской.','Upgrade your starting equipment\nin the workshop.');
        UI.get('inspectTag')?.show(screen === 'INVENTORY' && !!this.selectedItem);
        label('inspectTag','ВЫБРАННЫЙ ПРЕДМЕТ','SELECTED ITEM');
        if (screen === 'INVENTORY' && this.selectedItem) {
            const item=this.selectedItem;
            let detailText = `${item.category.toUpperCase()} / ${item.rarity || 'Common'}\n\n`;
            if (item.category === 'attachments' || ['optic', 'muzzle', 'mag', 'stock'].includes(item.slotType)) {
                detailText += `${t('СЛОТ','SLOT')}                 ${(item.slotType || '').toUpperCase()}\n\n`;
                if (item.zoom) detailText += `${t('КРАТНОСТЬ','ZOOM')}            ${item.zoom}X\n\n`;
                if (item.recoilMult) detailText += `${t('ОТДАЧА','RECOIL')}              ${Math.round(item.recoilMult * 100)}%\n\n`;
                if (item.magCapacityMult) detailText += `${t('ЕМКОСТЬ','MAG CAPACITY')}         +${Math.round((item.magCapacityMult - 1) * 100)}%\n\n`;
                if (item.noiseMult) detailText += `${t('ШУМ ВЫСТРЕЛА','NOISE')}          ${Math.round(item.noiseMult * 100)}%\n\n`;
                if (item.reloadTimeMult) detailText += `${t('СКОРОСТЬ ЗАРЯДКИ','RELOAD SPEED')}   ${Math.round(item.reloadTimeMult * 100)}%\n\n`;
                detailText += `${t('МАССА','WEIGHT')}                  ${item.weight || 0} KG\n\n${item.desc || item.descRu || t('Оружейный модуль.','Weapon attachment.')}`;
            } else {
                detailText += `${t('УРОН','DAMAGE')}                 ${item.damage || '—'}\n\n${t('ТЕМП ОГНЯ','FIRE RATE')}            ${item.fireRate || '—'}\n\n${t('ДАЛЬНОСТЬ','RANGE')}              ${item.range || '—'}\n\n${t('МАССА','WEIGHT')}                  ${item.weight} KG\n\n${item.desc || t('Добыча из рейда.','Raid loot.')}`;
            }
            UI.get('itemInspectDesc')?.setText(detailText);
            let equipRu = 'ВЗЯТЬ';
            let equipEn = 'EQUIP';
            if (item.category === 'weapons') { equipRu = 'ВЗЯТЬ ОРУЖИЕ'; equipEn = 'EQUIP WEAPON'; }
            else if (item.category === 'attachments' || ['optic', 'muzzle', 'mag', 'stock'].includes(item.slotType)) { equipRu = 'УСТАНОВИТЬ МОДУЛЬ'; equipEn = 'ATTACH MODULE'; }
            else if (item.category === 'armor' || item.category === 'shields' || item.shieldHp) { equipRu = 'УСТАНОВИТЬ ЩИТ'; equipEn = 'EQUIP SHIELD'; }
            else if (item.category === 'augment' || item.slotType === 'augment') { equipRu = 'УСТАНОВИТЬ ФРЕЙМ'; equipEn = 'EQUIP FRAME'; }
            else if (item.category === 'blueprints' || item.slotType === 'blueprint') { equipRu = 'ИЗУЧИТЬ ЧЕРТЕЖ'; equipEn = 'LEARN BLUEPRINT'; }
            else if (item.category === 'consumables') { equipRu = 'В БЫСТРЫЙ СЛОТ'; equipEn = 'TO QUICK SLOT'; }
            else if (item.category === 'ammo' || item.category === 'materials') { equipRu = 'В РЮКЗАК'; equipEn = 'TO BACKPACK'; }
            label('itemEquipBtn', equipRu, equipEn);
            UI.get('itemEquipBtn')?.setDisabled(false);
            const itemVal = Number(item.value || 50);
            label('itemSellBtn', 'ПРОДАТЬ  (' + itemVal + ' CR)', 'SELL  (' + itemVal + ' CR)');
            UI.get('itemSellBtn')?.show(true);
        }
        for (const id of ['optGoggles','optHat','optHeadgear','optHipBag','optSonar']) UI.get(id)?.show(false);
        if (screen==='RAIDER'||screen==='DECKS') {
            UI.get('raiderPanel')?.show(true);
            UI.get('raiderTitle')?.show(screen === 'DECKS');
            if (screen === 'DECKS') {
                label('raiderTitle', 'СВОДКА ОПЕРАЦИЙ', 'OPERATIONS LOGBOOK');
            }
            const raids = serverStats?.raids ?? p.raids;
            const extractions = serverStats?.extractions ?? p.extractions;
            const kills = serverStats?.kills ?? p.kills;
            const deaths = serverStats?.deaths ?? Math.max(0, raids - extractions);
            const primary = this.loadout.primary?.nameRu || this.loadout.primary?.name || t('НЕ НАЗНАЧЕНО','UNASSIGNED');
            const shield = this.loadout.shieldCore?.nameRu || this.loadout.shieldCore?.name || t('НЕТ МОДУЛЯ','NO MODULE');
            label('operatorStatus',
                account ? 'ОПЕРАТОР НА БАЗЕ · ГОТОВ К ПОДГОТОВКЕ' : 'ЛОКАЛЬНЫЙ ПРОФИЛЬ',
                account ? 'OPERATOR AT BASE · READY TO PREPARE' : 'LOCAL PROFILE');
            if (screen === 'RAIDER') {
                label('careerDetails',
                    `ПОЗЫВНОЙ\n${account?.name || 'VALENTE-07'}\n\nОПЕРАТОР НА БАЗЕ\n\nОСНОВНОЕ ОРУЖИЕ\n${primary}\n\nЗАЩИТА\n${shield}`,
                    `CALLSIGN\n${account?.name || 'VALENTE-07'}\n\nOPERATOR AT BASE\n\nPRIMARY WEAPON\n${primary}\n\nPROTECTION\n${shield}`);
                const secondary = this.loadout.secondary?.nameRu || this.loadout.secondary?.name || t('НЕ НАЗНАЧЕНО','UNASSIGNED');
                const augment = this.loadout.augment?.nameRu || this.loadout.augment?.name || t('НЕ УСТАНОВЛЕНА','NOT EQUIPPED');
                label('operatorLoadoutDetails',
                    `ДОПОЛНИТЕЛЬНОЕ ОРУЖИЕ\n${secondary}\n\nАУГМЕНТАЦИЯ\n${augment}\n\nПОДГОТОВКА К ВЫХОДУ\nTAB — открыть снаряжение\n\nИСТОРИЯ БОЁВ\nВ разделе «Сводка»`,
                    `SECONDARY WEAPON\n${secondary}\n\nAUGMENT\n${augment}\n\nPREPARE TO DEPLOY\nTAB — open loadout\n\nCOMBAT RECORD\nSee the Logbook tab`);
            } else {
                label('careerDetails',
                    `ПОСЛУЖНОЙ СПИСОК\n${account?.name || 'VALENTE-07'}\n\nРЕЙДЫ\n${raids}\n\nУСПЕШНЫЕ ЭВАКУАЦИИ\n${extractions}`,
                    `SERVICE RECORD\n${account?.name || 'VALENTE-07'}\n\nRAIDS\n${raids}\n\nSUCCESSFUL EXTRACTIONS\n${extractions}`);
                label('operatorLoadoutDetails',
                    `БОЕВЫЕ РЕЗУЛЬТАТЫ\n\nУНИЧТОЖЕНО\n${kills}\n\nПОТЕРИ\n${deaths}\n\nИСТОРИЯ ОТДЕЛЬНЫХ РЕЙДОВ\nПока недоступна`,
                    `COMBAT RESULTS\n\nELIMINATIONS\n${kills}\n\nLOSSES\n${deaths}\n\nINDIVIDUAL RAID HISTORY\nNot yet available`);
                label('operatorStatus', 'РЕЗУЛЬТАТЫ ЗАВЕРШЁННЫХ РЕЙДОВ', 'COMPLETED RAID RESULTS');
            }
        }
        if (screen==='WORKSHOP') {
            label('workshopTitle','МАСТЕРСКАЯ ЦИТАДЕЛИ','CITADEL WORKSHOP');
            label('workshopInfo', online?.authenticated ? 'Авторизованный производственный комплекс Цитадели Blackwater.' : 'Производственные станции, переработка и дрон «Скраппи».', online?.authenticated ? 'Authorized Blackwater Citadel production complex.' : 'Production stations, salvage recycling, and Scrappy drone.');
            for (const id of ['upgradeAmmo','upgradeMedkit','upgradeArmor','workshopNote']) {
                UI.get(id)?.show(false);
            }
        }
        if (screen==='TRADERS') {
            const trader = (typeof ARC_TRADERS !== 'undefined') ? ARC_TRADERS[this.activeTraderId || 'marco'] : null;
            if (trader) {
                label('traderTitle', trader.nameRu, trader.nameEn);
                label('traderSubtitle', trader.roleRu + ' · ' + trader.descRu, trader.roleEn + ' · ' + trader.descEn);

                label('traderNavMarco', 'МАРКО (ОРУЖИЕ)', 'MARCO (WEAPONS)');
                label('traderNavElena', 'ЕЛЕНА (МЕДИЦИНА)', 'ELENA (MED-CORPS)');
                label('traderNavBruno', 'БРУНО (СНАБЖЕНИЕ)', 'BRUNO (SUPPLIES)');
                label('traderNavSofia', 'СОФИЯ (ИНЖЕНЕР)', 'SOFIA (OMEGA LAB)');

                UI.get('traderNavMarco')?.setSelected(this.activeTraderId === 'marco');
                UI.get('traderNavElena')?.setSelected(this.activeTraderId === 'elena');
                UI.get('traderNavBruno')?.setSelected(this.activeTraderId === 'bruno');
                UI.get('traderNavSofia')?.setSelected(this.activeTraderId === 'sofia');

                const isGoods = this.traderTab !== 'contracts';
                const discount = (typeof ProgressionSystem !== 'undefined') ? ProgressionSystem.getVendorDiscount(this.activeTraderId || 'marco') : 0;
                const inv = trader.inventory || [];
                for (let i = 0; i < 6; i++) {
                    const btn = UI.get('traderItem' + i);
                    if (!btn) continue;
                    if (isGoods && i < inv.length) {
                        const item = inv[i];
                        const discountedPrice = Math.round((item.price || 0) * (1 - discount));
                        const currentCredits = online?.authenticated ? (account?.credits || 0) : (this.profile.credits || 0);
                        const currentCores = online?.authenticated ? (account?.arcCores || 0) : (this.profile.arcCores || 0);
                        const affordable = currentCredits >= discountedPrice && (!item.arcCores || currentCores >= item.arcCores);
                        const discountTag = discount > 0 ? ` (-${Math.round(discount * 100)}%)` : '';
                        const priceText = item.arcCores ? `${discountedPrice} CR + ${item.arcCores} CORE` : `${discountedPrice} CR${discountTag}`;
                        const def = (typeof ARC_ITEMS !== 'undefined') ? ARC_ITEMS[item.itemId] : null;
                        const itemName = (this.game.lang === 'ru' && def?.nameRu) ? def.nameRu : (item.nameRu || item.name);
                        const icon = this.loadoutScreen?.getItemIcon(def || item) || '';
                        btn.setText(`<span class="bw-trade-icon" aria-hidden="true">${icon}</span><span class="bw-trade-copy"><strong>${escapeText(itemName)}</strong><small>${escapeText(priceText)}</small></span>`).show(true).setDisabled(!affordable);
                    } else {
                        btn.show(false);
                    }
                }
                const feedback = UI.get('traderBuyFeedback');
                if (feedback) {
                    if (isGoods) {
                        feedback.setText(online?.authenticated
                            ? t(`БАЛАНС: ${Number(account?.credits ?? 0).toLocaleString()} CR  ·  ${account?.arcCores ?? 0} ЯДЕР ARC  ·  Торговец готов к сделке`, `BALANCE: ${Number(account?.credits ?? 0).toLocaleString()} CR  ·  ${account?.arcCores ?? 0} ARC CORES  ·  Trader ready to trade`)
                            : t(`БАЛАНС: ${(this.profile.credits || 0).toLocaleString()} CR  ·  ${this.profile.arcCores || 0} ЯДЕР ARC`, `BALANCE: ${(this.profile.credits || 0).toLocaleString()} CR  ·  ${this.profile.arcCores || 0} ARC CORES`)).show(true);
                    } else {
                        feedback.show(false);
                    }
                }
            }
        }
        if (screen === 'MAP_SELECT') {
            label('dispatcherTitle', 'ПРЕДРЕЙДОВЫЙ ДИСПЕТЧЕР', 'PRE-RAID DISPATCHER');
            label('dispatcherSubtitle', 'ДИАГНОСТИКА СНАРЯЖЕНИЯ И ОГРАНИЧЕНИЙ МАССЫ', 'EQUIPMENT READINESS & WEIGHT LIMIT DIAGNOSTICS');

            const chk = (typeof RaidRules !== 'undefined' && RaidRules.validatePreRaidChecklist)
                ? RaidRules.validatePreRaidChecklist(this.loadout, this.backpack)
                : null;

            if (chk) {
                const c = chk.checks;
                const statusTag = (pass, warn) => warn ? '[!]' : (pass ? '[OK]' : '[X]');

                const checksText = [
                    `${statusTag(c.weapon.pass, false)} ${t(c.weapon.labelRu, c.weapon.labelEn)}`,
                    `    ${t(c.weapon.detailRu, c.weapon.detailEn)}`,
                    '',
                    `${statusTag(c.ammo.pass, c.ammo.warning)} ${t(c.ammo.labelRu, c.ammo.labelEn)}`,
                    `    ${t(c.ammo.detailRu, c.ammo.detailEn)}`,
                    '',
                    `${statusTag(c.weight.pass, false)} ${t(c.weight.labelRu, c.weight.labelEn)}`,
                    `    ${t(c.weight.detailRu, c.weight.detailEn)}`,
                    '',
                    `${statusTag(c.durability.pass, c.durability.warning)} ${t(c.durability.labelRu, c.durability.labelEn)}`,
                    `    ${t(c.durability.detailRu, c.durability.detailEn)}`
                ].join('\n');

                UI.get('dispatcherChecks')?.setText(checksText);

                const secName = this.loadout.secondary ? (this.loadout.secondary.nameRu || this.loadout.secondary.name) : t('НЕТ', 'NONE');
                const shieldName = this.loadout.shieldCore ? (this.loadout.shieldCore.nameRu || this.loadout.shieldCore.name) : t('НЕТ ЩИТА', 'NO SHIELD');
                const quickCount = Array.isArray(this.loadout.quickSlots) ? this.loadout.quickSlots.filter(Boolean).length : 0;
                const safeCount = Array.isArray(this.loadout.safePocket) ? this.loadout.safePocket.filter(Boolean).length : 0;
                const safeMax = Array.isArray(this.loadout.safePocket) ? this.loadout.safePocket.length : 2;

                const summaryText = [
                    t('СВОДКА СБОРКИ:', 'LOADOUT SUMMARY:'),
                    `• ${t('ВТОРИЧНОЕ','SECONDARY')}: ${secName}`,
                    `• ${t('СИЛОВОЙ ЩИТ','SHIELD')}: ${shieldName}`,
                    `• ${t('БЫСТРЫЕ СЛОТЫ','QUICK SLOTS')}: ${quickCount} / 4`,
                    `• ${t('БЕЗОПАСНЫЙ КАРМАН','SAFE POCKET')}: ${safeCount} / ${safeMax}`,
                    `• ${t('ШТРАФ МАССЫ','WEIGHT PENALTY')}: ${t('СКОРОСТЬ','SPEED')} x${chk.encumbrance.speedMult} · ${t('ВЫНОСЛИВОСТЬ','STAMINA')} x${chk.encumbrance.staminaDrainMult}`
                ].join('\n\n');

                UI.get('dispatcherLoadoutSummary')?.setText(summaryText);

                const statusEl = UI.get('dispatcherStatus');
                if (statusEl) {
                    if (!chk.canDeploy) {
                        statusEl.setText(t('СТАТУС: ДЕСАНТИРОВАНИЕ ЗАБЛОКИРОВАНО (ИСПРАВЬТЕ ОШИБКИ)', 'STATUS: DEPLOYMENT BLOCKED (RESOLVE ERRORS)'));
                        statusEl.setColor('#ff4d4d');
                    } else if (chk.warnings.length > 0) {
                        statusEl.setText(t('СТАТУС: ГОТОВ К ВЫСАДКЕ С ПРЕДУПРЕЖДЕНИЕМ', 'STATUS: READY TO DEPLOY WITH WARNINGS'));
                        statusEl.setColor('#e8cc72');
                    } else {
                        statusEl.setText(t('СТАТУС: ПОЛНАЯ БОЕВАЯ ГОТОВНОСТЬ [ СИСТЕМЫ В НОРМЕ ]', 'STATUS: FULL COMBAT READINESS [ ALL SYSTEMS NOMINAL ]'));
                        statusEl.setColor('#61e6d1');
                    }
                }

                const launchBtn = UI.get('deployLaunchBtn');
                if (launchBtn) {
                    if (!chk.canDeploy) {
                        // Explain WHY the exit is blocked instead of only that it is. Losing a
                        // raid clears the equipped weapons, and a blank loadout is by far the
                        // most common reason a player sees this screen.
                        const unarmed = chk.errors.includes('NO_WEAPON');
                        launchBtn.setText(t('ВЫХОД ЗАБЛОКИРОВАН', 'DEPLOYMENT BLOCKED')).setDisabled(true);
                        const freeKit = UI.get('dispatcherFreeKitBtn');
                        if (freeKit) freeKit.show(!!unarmed).setDisabled(false);
                        const hint = UI.get('dispatcherBlockedHint');
                        if (hint) {
                            hint.setText(unarmed
                                ? t('НЕТ ОРУЖИЯ: возьмите набор «Рекрут» или экипируйте ствол в снаряжении',
                                    'NO WEAPON: claim a Scavenger Kit or equip a gun in your loadout')
                                : t('ПЕРЕГРУЗ: выбросьте часть добычи из рюкзака',
                                    'OVERLOADED: drop part of the backpack load')).show(true);
                        }
                    } else {
                        const freeKit = UI.get('dispatcherFreeKitBtn'); if (freeKit) freeKit.show(false);
                        const hint = UI.get('dispatcherBlockedHint'); if (hint) hint.show(false);
                    }
                    if (chk.canDeploy) {
                        if (chk.warnings.length > 0) {
                            launchBtn.setText(t('НАЧАТЬ РЕЙД (С ПРЕДУПР.) →', 'DEPLOY (WITH WARNINGS) →')).setDisabled(false);
                        } else {
                            launchBtn.setText(t('НАЧАТЬ РЕЙД  →', 'DEPLOY INTO RAID  →')).setDisabled(false);
                        }
                    }
                    if (account && chk.canDeploy) {
                        const party = online.partyState?.party;
                        const isParty = party && party.members.length > 1;
                        const isLeader = !isParty || party.leaderId === account.id;
                        const myMember = party?.members?.find(m => m.name === account.name);
                        const myReady = isLeader ? true : !!myMember?.ready;

                        if (online.matched) {
                            launchBtn.setText(t('МАТЧ НАЙДЕН · ВОЙТИ →', 'MATCH FOUND · ENTER →')).setDisabled(false);
                        } else if (online.queued) {
                            if (isLeader) {
                                launchBtn.setText(t(`ПОИСК · ПОЗИЦИЯ ${online.matchState?.position?.position || 1} · ОТМЕНИТЬ`, `SEARCHING · POSITION ${online.matchState?.position?.position || 1} · CANCEL`)).setDisabled(false);
                            } else {
                                launchBtn.setText(t('ПОИСК РЕЙДА… (КОМАНДИР ИЩЕТ)', 'SEARCHING… (LEADER QUEUED)')).setDisabled(true);
                            }
                        } else if (isParty && !isLeader) {
                            if (myReady) {
                                launchBtn.setText(t('✔ ГОТОВ (НАЖМИТЕ ДЛЯ ОТМЕНЫ)', '✔ READY (CLICK TO CANCEL)')).setDisabled(false);
                            } else {
                                launchBtn.setText(t('⏳ ПОДТВЕРДИТЬ ГОТОВНОСТЬ', '⏳ READY UP')).setDisabled(false);
                            }
                        } else if (isParty && isLeader && !party.allReady) {
                            launchBtn.setText(t('⏳ ОЖИДАНИЕ ГОТОВНОСТИ ОТРЯДА', '⏳ WAITING FOR SQUAD')).setDisabled(true);
                        } else {
                            launchBtn.setText(t('НАЙТИ СЕТЕВОЙ РЕЙД →', 'FIND ONLINE RAID →')).setDisabled(false);
                        }
                    }
                }
            }
        }
        if (screen==='STORE') {
            UI.get('workshopPanel')?.show(true); UI.get('workshopTitle')?.show(true);
            label('workshopTitle','НАСТРОЙКИ','SETTINGS');
            const setting = (id, title, value, description) => UI.get(id)?.setText(`<span class="bw-setting-copy"><strong>${escapeText(title)}</strong><small>${escapeText(description)}</small></span><span class="bw-setting-value">${escapeText(value)} <span aria-hidden="true">›</span></span>`);
            setting('systemQuality', t('ГРАФИКА','GRAPHICS'), t(['НИЗКОЕ','СРЕДНЕЕ','ВЫСОКОЕ'][this.game.settings.quality],['LOW','MEDIUM','HIGH'][this.game.settings.quality]), t('Качество изображения и производительность','Image quality and performance'));
            setting('systemSensitivity', t('ЧУВСТВИТЕЛЬНОСТЬ','SENSITIVITY'), this.game.settings.sensitivity.toFixed(2), t('Скорость поворота камеры мышью','Mouse camera turning speed'));
            setting('systemLanguage', t('ЯЗЫК','LANGUAGE'), t('РУССКИЙ','ENGLISH'), t('Язык интерфейса','Interface language'));
            setting('systemControls', t('УПРАВЛЕНИЕ','CONTROLS'), t('НАСТРОЙКА КЛАВИШ','CUSTOMIZE KEYS'), t('Переназначение клавиш передвижения, лута, наклонов и инвентаря','Keybindings for movement, looting, leaning and inventory'));
        }
    },
};

if (typeof window !== 'undefined') window.MenuSystem = MenuSystem;
if (typeof module !== 'undefined') module.exports = MenuSystem;
