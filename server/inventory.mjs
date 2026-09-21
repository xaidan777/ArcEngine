// server/inventory.mjs — authoritative server inventory, loadout, stash, and trading.
//
// Zero external dependencies. Everything here is pure logic that manipulates
// in-memory account data and validates rules, slot types, capacities, and currency.

import { randomUUID } from 'node:crypto';
import { safeInt, safeCredits } from './progression.mjs';

// Base catalog of known item prototypes with their canonical base stats.
export const ITEM_PROTOTYPES = {
    tempest_ii: { id: 'tempest_ii', name: 'TEMPEST II', category: 'weapons', slotType: 'primary', tier: 'II', rarity: 'Rare', weight: 6.2, value: 7500, damage: 54, fireRate: 85, range: 75, durability: 93, desc: 'High fire-rate assault rifle.' },
    revolver_i: { id: 'revolver_i', name: 'REVOLVER I', category: 'weapons', slotType: 'sidearm', tier: 'I', rarity: 'Common', weight: 3.1, value: 2500, damage: 62, fireRate: 30, range: 50, durability: 88, desc: 'Reliable sidearm revolver.' },
    vulcano_i: { id: 'vulcano_i', name: 'VULCANO I', category: 'weapons', slotType: 'primary', tier: 'I', rarity: 'Epic', weight: 8.0, value: 9500, damage: 78, fireRate: 45, range: 45, durability: 90, desc: 'Semi-automatic shotgun with heavy spread.' },
    rubezh_t1: { id: 'rubezh_t1', name: 'RUBEZH-76 T1', category: 'weapons', slotType: 'primary', tier: 'I', rarity: 'Common', weight: 4.8, value: 3400, damage: 44, fireRate: 70, range: 75, durability: 85, desc: 'Crude stamped steel AK-pattern rifle.' },
    ammo_heavy: { id: 'ammo_heavy', name: 'HEAVY AMMO', category: 'ammo', tier: 'I', rarity: 'Common', count: 60, weight: 2.0, value: 300, desc: 'Heavy rifle caliber rounds.' },
    ammo_light: { id: 'ammo_light', name: 'LIGHT AMMO', category: 'ammo', tier: 'I', rarity: 'Common', count: 80, weight: 1.2, value: 200, desc: 'Compact kinetic rounds.' },
    ammo_shotgun: { id: 'ammo_shotgun', name: 'SHOTGUN SHELLS', category: 'ammo', tier: 'I', rarity: 'Common', count: 24, weight: 1.8, value: 250, desc: '12-gauge heavy buckshot shells.' },
    shield_light: { id: 'shield_light', name: 'LIGHT SHIELD CORE', category: 'armor', slotType: 'shieldCore', tier: 'I', rarity: 'Common', weight: 3.0, value: 1500, shieldHp: 75, desc: 'Lightweight tactical shield.' },
    shield_medium: { id: 'shield_medium', name: 'MEDIUM SHIELD CORE', category: 'armor', slotType: 'shieldCore', tier: 'II', rarity: 'Rare', weight: 5.5, value: 3200, shieldHp: 100, desc: 'Standard issue balanced tactical shield.' },
    shield_heavy: { id: 'shield_heavy', name: 'HEAVY BULWARK CORE', category: 'armor', slotType: 'shieldCore', tier: 'III', rarity: 'Epic', weight: 9.0, value: 6800, shieldHp: 150, desc: 'Reinforced heavy shield plate.' },
    consumable_stim: { id: 'consumable_stim', name: 'COMBAT STIM', category: 'consumables', slotType: 'quick', count: 2, weight: 0.4, value: 350, desc: 'Adrenaline injector.' },
    consumable_medkit: { id: 'consumable_medkit', name: 'FIELD MEDKIT', category: 'consumables', slotType: 'quick', count: 2, weight: 1.5, value: 500, desc: 'Trauma kit restoring health.' },
    consumable_small_battery: { id: 'consumable_small_battery', name: 'SHIELD BATTERY', category: 'consumables', slotType: 'quick', count: 2, weight: 0.8, value: 400, desc: 'Emergency shield battery.' },
    consumable_overcharger: { id: 'consumable_overcharger', name: 'HEAVY OVERCHARGER', category: 'consumables', slotType: 'quick', count: 1, weight: 1.8, value: 1200, desc: 'Overcharger battery.' },
    gadget_grapple: { id: 'gadget_grapple', name: 'GRAPPLING HOOK', category: 'gadgets', slotType: 'gadget', tier: 'II', rarity: 'Rare', weight: 2.5, value: 4500, desc: 'Pneumatic launcher for vertical repositioning.' },
    gadget_pulse_radar: { id: 'gadget_pulse_radar', name: 'PULSE RADAR', category: 'gadgets', slotType: 'gadget', tier: 'II', rarity: 'Rare', weight: 1.5, value: 3800, desc: 'Acoustic scanner.' },
    data_drive: { id: 'data_drive', name: 'DATA DRIVE', category: 'materials', tier: 'III', rarity: 'Epic', count: 1, weight: 0.5, value: 2500, desc: 'Classified ARC behavioral algorithms.' },
    steel_scrap: { id: 'steel_scrap', name: 'REFINED ALLOY SCRAP', category: 'materials', tier: 'I', rarity: 'Common', count: 20, weight: 2.0, value: 400, desc: 'Structural alloy.' },
    scrap: { id: 'scrap', name: 'ROBOT PARTS', category: 'materials', type: 'scrap', tier: 'I', rarity: 'Common', count: 1, weight: 1.5, value: 65, desc: 'Scrap metal.' },
};

// Canonical traders catalog on the server.
export const SERVER_TRADERS = {
    marco: {
        id: 'marco',
        inventory: [
            { id: 'buy_rubezh_t1', itemId: 'rubezh_t1', name: 'RUBEZH-76 T1', price: 3400, arcCores: 0, category: 'weapons' },
            { id: 'buy_tempest_ii', itemId: 'tempest_ii', name: 'TEMPEST II', price: 7500, arcCores: 0, category: 'weapons' },
            { id: 'buy_vulcano_i', itemId: 'vulcano_i', name: 'VULCANO I', price: 9500, arcCores: 0, category: 'weapons' },
            { id: 'buy_revolver_i', itemId: 'revolver_i', name: 'REVOLVER I', price: 2500, arcCores: 0, category: 'weapons' },
            { id: 'buy_ammo_heavy_60', itemId: 'ammo_heavy', name: 'HEAVY AMMO (x60)', count: 60, price: 300, arcCores: 0, category: 'ammo' },
            { id: 'buy_ammo_shotgun_24', itemId: 'ammo_shotgun', name: 'SHOTGUN SHELLS (x24)', count: 24, price: 250, arcCores: 0, category: 'ammo' },
            { id: 'buy_ammo_light_80', itemId: 'ammo_light', name: 'LIGHT AMMO (x80)', count: 80, price: 200, arcCores: 0, category: 'ammo' },
        ]
    },
    elena: {
        id: 'elena',
        inventory: [
            { id: 'buy_stim', itemId: 'consumable_stim', name: 'COMBAT STIM (x2)', count: 2, price: 350, arcCores: 0, category: 'consumables' },
            { id: 'buy_medkit', itemId: 'consumable_medkit', name: 'FIELD MEDKIT (x2)', count: 2, price: 500, arcCores: 0, category: 'consumables' },
            { id: 'buy_small_battery', itemId: 'consumable_small_battery', name: 'SHIELD BATTERY (x2)', count: 2, price: 400, arcCores: 0, category: 'consumables' },
            { id: 'buy_overcharger', itemId: 'consumable_overcharger', name: 'HEAVY OVERCHARGER', count: 1, price: 1200, arcCores: 0, category: 'consumables' },
        ]
    },
    bruno: {
        id: 'bruno',
        inventory: [
            { id: 'buy_shield_light', itemId: 'shield_light', name: 'LIGHT SHIELD CORE', price: 1500, arcCores: 0, category: 'armor' },
            { id: 'buy_shield_medium', itemId: 'shield_medium', name: 'MEDIUM SHIELD CORE', price: 3200, arcCores: 0, category: 'armor' },
            { id: 'buy_shield_heavy', itemId: 'shield_heavy', name: 'HEAVY BULWARK CORE', price: 6800, arcCores: 2, category: 'armor' },
        ]
    },
    sofia: {
        id: 'sofia',
        inventory: [
            { id: 'buy_gadget_grapple', itemId: 'gadget_grapple', name: 'GRAPPLING HOOK', price: 4500, arcCores: 1, category: 'gadgets' },
            { id: 'buy_gadget_pulse', itemId: 'gadget_pulse_radar', name: 'PULSE RADAR', price: 3800, arcCores: 0, category: 'gadgets' },
            { id: 'buy_safe_pocket_tier2', itemId: 'upgrade_pocket_2', name: 'SAFE POCKET (TIER 2)', price: 3000, arcCores: 1, category: 'upgrade' },
            { id: 'buy_safe_pocket_tier3', itemId: 'upgrade_pocket_3', name: 'SAFE POCKET (TIER 3)', price: 6500, arcCores: 3, category: 'upgrade' },
        ]
    }
};

/**
 * Creates an instantiated item with a unique `instId`.
 */
export function instantiateItem(protoOrId, overrides = {}) {
    const proto = typeof protoOrId === 'string' ? (ITEM_PROTOTYPES[protoOrId] || { id: protoOrId, name: protoOrId }) : protoOrId;
    return {
        instId: 'it_' + randomUUID().slice(0, 12),
        ...JSON.parse(JSON.stringify(proto)),
        ...overrides,
    };
}

/**
 * Creates the starter inventory for a newly registered account.
 */
export function createStarterInventory() {
    const loadout = {
        primary: instantiateItem('tempest_ii'),
        secondary: instantiateItem('revolver_i'),
        shieldCore: instantiateItem('shield_medium'),
        armor: null,
        augment: null,
        safePocket: [instantiateItem('data_drive'), null],
        quickSlots: [
            instantiateItem('consumable_stim'),
            instantiateItem('consumable_small_battery'),
            instantiateItem('consumable_medkit'),
            null
        ],
        backpack: Array(18).fill(null)
    };
    loadout.backpack[0] = instantiateItem('ammo_light', { count: 80 });
    loadout.backpack[1] = instantiateItem('ammo_light', { count: 80 });

    const stash = [
        instantiateItem('vulcano_i'),
        instantiateItem('tempest_ii'),
        instantiateItem('ammo_heavy', { count: 100 }),
        instantiateItem('ammo_light', { count: 80 }),
        instantiateItem('consumable_medkit', { count: 4 }),
        instantiateItem('shield_medium'),
        instantiateItem('data_drive', { count: 2 }),
        instantiateItem('steel_scrap', { count: 40 })
    ];

    return {
        loadout,
        stash,
        arcCores: 1,
        credits: 0,
        inventoryVersion: 1
    };
}

/**
 * Validates whether a target slot accepts a specific item.
 */
export function slotAccepts(area, item) {
    if (!item) return true;
    if (area === 'stash' || area === 'backpack') return true;
    if (area === 'quickSlots') return item.category === 'consumables' || item.category === 'ammo' || item.category === 'grenades';
    if (area === 'safePocket') return !['weapons', 'armor'].includes(item.category);
    if (area === 'primary' || area === 'secondary') return item.category === 'weapons';
    if (area === 'shieldCore') return item.category === 'armor' || item.slotType === 'shieldCore' || item.slotType === 'shield' || !!item.shieldHp;
    if (area === 'augment') return item.category === 'augment' || item.slotType === 'augment';
    return false;
}

/**
 * Reads an item at a slot ref { area, index }.
 */
export function getItemAt(loadout, stash, ref) {
    if (!ref || typeof ref !== 'object') return null;
    const { area, index } = ref;
    if (area === 'stash') return stash[index] || null;
    if (area === 'backpack') return loadout.backpack?.[index] || null;
    if (area === 'quickSlots' || area === 'safePocket') return loadout[area]?.[index] || null;
    return loadout[area] || null;
}

/**
 * Writes an item at a slot ref { area, index }.
 */
export function setItemAt(loadout, stash, ref, item) {
    if (!ref || typeof ref !== 'object') return;
    const { area, index } = ref;
    if (area === 'stash') {
        if (index !== undefined && index < stash.length) stash[index] = item;
        else if (item) stash.push(item);
    } else if (area === 'backpack') {
        if (!Array.isArray(loadout.backpack)) loadout.backpack = Array(18).fill(null);
        if (index >= 0 && index < 18) loadout.backpack[index] = item;
    } else if (area === 'quickSlots' || area === 'safePocket') {
        if (!Array.isArray(loadout[area])) loadout[area] = [];
        if (index !== undefined && index >= 0) loadout[area][index] = item;
    } else {
        loadout[area] = item;
    }
}

/**
 * Validates and executes moving/swapping an item between two slots.
 */
export function validateAndMove(account, from, to) {
    if (!from || !to) return { ok: false, error: 'invalid-slots' };
    if (from.area === to.area && from.index === to.index) return { ok: true, loadout: account.loadout, stash: account.stash, version: account.inventoryVersion };

    const loadout = account.loadout;
    const stash = account.stash;

    const sourceItem = getItemAt(loadout, stash, from);
    const targetItem = getItemAt(loadout, stash, to);

    if (!sourceItem) return { ok: false, error: 'source-empty' };

    // Check slot acceptance in both directions
    if (!slotAccepts(to.area, sourceItem)) return { ok: false, error: 'slot-incompatible' };
    if (targetItem && !slotAccepts(from.area, targetItem)) return { ok: false, error: 'slot-incompatible' };

    // Perform swap or move
    setItemAt(loadout, stash, to, sourceItem);
    setItemAt(loadout, stash, from, targetItem);

    // Clean up empty slots in stash
    account.stash = account.stash.filter(Boolean);
    account.inventoryVersion = (account.inventoryVersion || 0) + 1;

    return { ok: true, loadout: account.loadout, stash: account.stash, version: account.inventoryVersion };
}

/**
 * Purchases an item from a trader.
 */
export function executeTraderBuy(account, traderId, slotIndex) {
    const trader = SERVER_TRADERS[traderId];
    if (!trader) return { ok: false, error: 'unknown-trader' };

    const idx = safeInt(slotIndex);
    const shopItem = trader.inventory[idx];
    if (!shopItem) return { ok: false, error: 'item-not-found' };

    const price = safeCredits(shopItem.price);
    const cores = safeInt(shopItem.arcCores || 0);

    const credits = safeCredits(account.credits);
    const currentCores = safeInt(account.arcCores || 0);

    if (credits < price) return { ok: false, error: 'not-enough-credits' };
    if (currentCores < cores) return { ok: false, error: 'not-enough-cores' };

    // Upgrade safe pocket
    if (shopItem.category === 'upgrade') {
        account.credits = safeCredits(credits - price);
        account.arcCores = safeInt(currentCores - cores);
        if (!Array.isArray(account.loadout.safePocket)) account.loadout.safePocket = [];
        account.loadout.safePocket.push(null);
        account.inventoryVersion = (account.inventoryVersion || 0) + 1;
        return {
            ok: true,
            credits: account.credits,
            arcCores: account.arcCores,
            loadout: account.loadout,
            stash: account.stash,
            version: account.inventoryVersion
        };
    }

    // Regular item purchase
    const proto = ITEM_PROTOTYPES[shopItem.itemId] || {
        id: shopItem.itemId,
        name: shopItem.name,
        category: shopItem.category,
        count: shopItem.count || 1,
        value: shopItem.price,
        tier: 'I',
        rarity: 'Common',
        weight: 1.0
    };

    const newItem = instantiateItem(proto, {
        count: shopItem.count || proto.count || 1,
        value: shopItem.price
    });

    account.credits = safeCredits(credits - price);
    account.arcCores = safeInt(currentCores - cores);
    if (!Array.isArray(account.stash)) account.stash = [];
    account.stash.push(newItem);
    account.inventoryVersion = (account.inventoryVersion || 0) + 1;

    return {
        ok: true,
        item: newItem,
        credits: account.credits,
        arcCores: account.arcCores,
        stash: account.stash,
        loadout: account.loadout,
        version: account.inventoryVersion
    };
}

/**
 * Sells a specific item belonging to the player.
 */
export function executeSell(account, { area, index, instId }) {
    const loadout = account.loadout;
    const stash = account.stash;

    let targetItem = null;
    let removeRef = null;

    if (area && index !== undefined) {
        removeRef = { area, index };
        targetItem = getItemAt(loadout, stash, removeRef);
    } else if (instId) {
        // Find in stash
        const sIdx = stash.findIndex(it => it && (it.instId === instId || it.id === instId));
        if (sIdx !== -1) {
            removeRef = { area: 'stash', index: sIdx };
            targetItem = stash[sIdx];
        } else {
            // Find in backpack
            const bIdx = (loadout.backpack || []).findIndex(it => it && (it.instId === instId || it.id === instId));
            if (bIdx !== -1) {
                removeRef = { area: 'backpack', index: bIdx };
                targetItem = loadout.backpack[bIdx];
            }
        }
    }

    if (!targetItem || !removeRef) return { ok: false, error: 'item-not-found' };

    const value = safeCredits(targetItem.value || 100);
    setItemAt(loadout, stash, removeRef, null);
    account.stash = account.stash.filter(Boolean);
    account.credits = safeCredits(safeCredits(account.credits) + value);
    account.inventoryVersion = (account.inventoryVersion || 0) + 1;

    return {
        ok: true,
        value,
        credits: account.credits,
        stash: account.stash,
        loadout: account.loadout,
        version: account.inventoryVersion
    };
}

/**
 * Sells all junk and materials in the player's stash in a single transaction.
 */
export function executeSellJunk(account) {
    if (!Array.isArray(account.stash)) return { ok: true, soldCount: 0, totalValue: 0, credits: account.credits };

    const kept = [];
    let totalValue = 0;
    let soldCount = 0;

    for (const item of account.stash) {
        if (!item) continue;
        // Junk is materials or common items with value
        const isJunk = item.category === 'materials' && (item.tier === 'I' || !item.tier || item.rarity === 'Common');
        if (isJunk) {
            totalValue += safeCredits(item.value || 50);
            soldCount++;
        } else {
            kept.push(item);
        }
    }

    account.stash = kept;
    account.credits = safeCredits(safeCredits(account.credits) + totalValue);
    account.inventoryVersion = (account.inventoryVersion || 0) + 1;

    return {
        ok: true,
        soldCount,
        totalValue,
        credits: account.credits,
        stash: account.stash,
        version: account.inventoryVersion
    };
}

/**
 * Applies post-raid inventory settlement:
 * - On extraction: keeps extracted backpack and safe pocket items.
 * - On death: clears non-safe-pocket loadout and wipes backpack; keeps safe pocket.
 */
export function applyRaidInventory(account, { extracted = false, backpack = [], safePocket = [] }) {
    if (!account.loadout) return;

    if (extracted) {
        // Transfer extracted backpack items into account's loadout backpack (or stash if full)
        if (Array.isArray(backpack)) {
            account.loadout.backpack = Array(18).fill(null);
            for (let i = 0; i < backpack.length && i < 18; i++) {
                if (backpack[i]) account.loadout.backpack[i] = instantiateItem(backpack[i]);
            }
        }
        if (Array.isArray(safePocket)) {
            account.loadout.safePocket = [
                safePocket[0] ? instantiateItem(safePocket[0]) : null,
                safePocket[1] ? instantiateItem(safePocket[1]) : null
            ];
        }
    } else {
        // KIA: Wipe primary, secondary, shieldCore, armor, augment, backpack.
        account.loadout.primary = null;
        account.loadout.secondary = null;
        account.loadout.shieldCore = null;
        account.loadout.armor = null;
        account.loadout.augment = null;
        account.loadout.backpack = Array(18).fill(null);
        account.loadout.quickSlots = [null, null, null, null];
        // Safe pocket is preserved!
        if (Array.isArray(safePocket)) {
            account.loadout.safePocket = [
                safePocket[0] ? instantiateItem(safePocket[0]) : null,
                safePocket[1] ? instantiateItem(safePocket[1]) : null
            ];
        }
    }

    account.inventoryVersion = (account.inventoryVersion || 0) + 1;
}
