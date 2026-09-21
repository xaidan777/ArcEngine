// accounts.mjs — accounts, sessions and profiles for the online raid.
//
// Zero dependencies: `node:crypto` for password hashing and tokens, plain JSON on disk for
// persistence. Nothing here trusts the client: a login returns an opaque bearer token, and
// every later call resolves the account FROM that token, never from a body field.
//
// Storage is injectable. `new AccountStore()` is memory-only (tests, ephemeral servers);
// `new AccountStore({ dir })` persists atomically (write a temp file, then rename) so a
// crash mid-write cannot leave a half-serialised account file behind.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
    safeInt,
    safeCredits,
    calcLevel,
    xpForLevel,
    SKILL_TREE,
    VENDOR_TRUST_TIERS,
    getVendorTrustLevel,
    CONTRACT_DEFINITIONS,
    WORKSHOP_STATIONS_CATALOG,
    CRAFTING_RECIPES,
    SCAVENGER_KIT
} from './progression.mjs';
import { createStarterInventory, applyRaidInventory } from './inventory.mjs';

const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;

// How many settled raid ids an account remembers. Replay protection only needs to cover
// any raid the server could still be asked about, so a bounded ring is enough — and a
// bound is what keeps accounts.json from growing forever on a long-lived server.
const MAX_APPLIED_RAIDS = 200;

// A display name that is safe to echo into logs, HTML and JSON keys.
const NAME_RE = /^[A-Za-z0-9_\-]{3,20}$/;

export class AccountStore {
    // opts: { dir, sessionTtlMs, maxAccounts, now }
    // `now` is injectable so session expiry is testable without sleeping.
    constructor({ dir = null, sessionTtlMs = 24 * 60 * 60 * 1000, maxAccounts = 10000, now = () => Date.now() } = {}) {
        this.dir = dir;
        this.sessionTtlMs = sessionTtlMs;
        this.maxAccounts = maxAccounts;
        this.now = now;
        /** @type {Map<string, any>} accountId -> account */
        this.accounts = new Map();
        /** @type {Map<string, string>} lowercased name -> accountId */
        this.byName = new Map();
        /** @type {Map<string, {accountId: string, lastSeen: number}>} token -> session */
        this.sessions = new Map();
        if (this.dir) this._load();
    }

    // --- persistence ---------------------------------------------------------

    _file() { return path.join(this.dir, 'accounts.json'); }

    _load() {
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            const raw = fs.readFileSync(this._file(), 'utf8');
            const parsed = JSON.parse(raw);
            for (const account of parsed.accounts || []) {
                if (!account.loadout || !account.stash) {
                    const starter = createStarterInventory();
                    if (!account.loadout) account.loadout = starter.loadout;
                    if (!account.stash) account.stash = starter.stash;
                    if (account.arcCores === undefined) account.arcCores = starter.arcCores;
                    if (account.inventoryVersion === undefined) account.inventoryVersion = starter.inventoryVersion;
                }
                if (account.level === undefined) account.level = 1;
                if (account.xp === undefined) account.xp = 0;
                if (account.skillPoints === undefined) account.skillPoints = 0;
                if (!account.skills || typeof account.skills !== 'object') account.skills = { resilience: {}, agility: {}, scavenging: {} };
                if (!account.vendorTrust || typeof account.vendorTrust !== 'object') account.vendorTrust = { marco: 0, elena: 0, bruno: 0, sofia: 0 };
                if (!account.contracts || typeof account.contracts !== 'object') account.contracts = { active: [], completed: [] };
                if (!account.stationLevels || typeof account.stationLevels !== 'object') account.stationLevels = { armory: 1, medlab: 1, gear: 1, electronics: 1, recycler: 1 };
                if (!Array.isArray(account.unlockedBlueprints)) account.unlockedBlueprints = [];

                this.accounts.set(account.id, account);
                this.byName.set(account.name.toLowerCase(), account.id);
            }
        } catch (e) {
            // A missing file is the normal first run; a corrupt one must not stop the server.
            if (e && e.code !== 'ENOENT') console.warn('[accounts] ignoring unreadable store:', e.message);
        }
    }

    _save() {
        if (!this.dir) return;
        const tmp = this._file() + '.' + randomUUID() + '.tmp';
        const payload = JSON.stringify({ version: 1, accounts: [...this.accounts.values()] });
        fs.writeFileSync(tmp, payload);
        fs.renameSync(tmp, this._file());   // atomic on the same filesystem
    }

    // --- hashing -------------------------------------------------------------

    static hashPassword(password, salt = randomBytes(SALT_BYTES).toString('hex')) {
        const derived = scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
        return { salt, hash: derived };
    }

    static verifyPassword(password, salt, expected) {
        const derived = scryptSync(String(password), salt, SCRYPT_KEYLEN);
        const want = Buffer.from(expected, 'hex');
        if (want.length !== derived.length) return false;
        return timingSafeEqual(derived, want);   // constant time: no early-exit oracle
    }

    // --- accounts ------------------------------------------------------------

    // Returns { ok, account } or { ok: false, error }. Errors are stable codes so the
    // transport can map them to HTTP statuses without parsing prose.
    register(name, password) {
        if (typeof name !== 'string' || !NAME_RE.test(name)) return { ok: false, error: 'invalid-name' };
        if (typeof password !== 'string' || password.length < 6 || password.length > 200) {
            return { ok: false, error: 'invalid-password' };
        }
        if (this.byName.has(name.toLowerCase())) return { ok: false, error: 'name-taken' };
        if (this.accounts.size >= this.maxAccounts) return { ok: false, error: 'too-many-accounts' };

        const { salt, hash } = AccountStore.hashPassword(password);
        const starter = createStarterInventory();
        const account = {
            id: randomUUID(),
            name,
            salt,
            hash,
            createdAt: this.now(),
            lastSeen: this.now(),
            // Social state. Kept on the account so one file holds a player's whole identity.
            friends: [],
            incoming: [],
            outgoing: [],
            partyId: null,
            // Authoritative progression. The wallet and the career live on the SERVER:
            // a client can display them, but only applyRaidResult may change them.
            credits: starter.credits,
            arcCores: starter.arcCores,
            stats: { raids: 0, extractions: 0, kills: 0, deaths: 0 },
            level: 1,
            xp: 0,
            skillPoints: 0,
            skills: { resilience: {}, agility: {}, scavenging: {} },
            vendorTrust: { marco: 0, elena: 0, bruno: 0, sofia: 0 },
            contracts: { active: [], completed: [] },
            stationLevels: { armory: 1, medlab: 1, gear: 1, electronics: 1, recycler: 1 },
            unlockedBlueprints: [],
            // Bounded replay guard: raidIds already paid out. See applyRaidResult.
            appliedRaids: [],
            stash: starter.stash,
            loadout: starter.loadout,
            inventoryVersion: starter.inventoryVersion,
        };
        this.accounts.set(account.id, account);
        this.byName.set(name.toLowerCase(), account.id);
        this._save();
        return { ok: true, account };
    }

    login(name, password) {
        const id = this.byName.get(String(name || '').toLowerCase());
        const account = id ? this.accounts.get(id) : null;
        // Same error for "no such user" and "wrong password": do not confirm which names exist.
        if (!account) return { ok: false, error: 'bad-credentials' };
        if (!AccountStore.verifyPassword(password, account.salt, account.hash)) return { ok: false, error: 'bad-credentials' };
        account.lastSeen = this.now();
        const token = this.createSession(account.id);
        return { ok: true, account, token };
    }

    createSession(accountId) {
        const token = randomBytes(24).toString('base64url');
        this.sessions.set(token, { accountId, lastSeen: this.now() });
        return token;
    }

    logout(token) {
        return this.sessions.delete(token);
    }

    isOnline(accountId) {
        const now = this.now();
        return [...this.sessions.values()].some(session => session.accountId === accountId && now - session.lastSeen < Math.min(15000, this.sessionTtlMs));
    }

    // token -> account, or null. Also expires idle sessions.
    resolve(token) {
        if (!token) return null;
        const session = this.sessions.get(token);
        if (!session) return null;
        if (this.now() - session.lastSeen > this.sessionTtlMs) {
            this.sessions.delete(token);
            return null;
        }
        session.lastSeen = this.now();
        const account = this.accounts.get(session.accountId);
        if (account) account.lastSeen = this.now();
        return account || null;
    }

    // Drop idle sessions. Called from the server tick so memory cannot creep.
    reapSessions() {
        const now = this.now();
        for (const [token, session] of this.sessions) {
            if (now - session.lastSeen > this.sessionTtlMs) this.sessions.delete(token);
        }
    }

    get(id) { return this.accounts.get(id) || null; }

    byName_(name) {
        const id = this.byName.get(String(name || '').toLowerCase());
        return id ? this.accounts.get(id) : null;
    }

    save() { this._save(); }

    // Settle ONE raid for ONE account, exactly once.
    //
    // Idempotent by raidId: the transport may retry, a client may re-send the same result
    // after a reconnect, and neither may pay twice. A duplicate returns
    // `{ ok: true, duplicate: true, account }` and touches nothing — not even `lastSeen`.
    //
    // Never throws. A missing account or a malformed result is a stable error code, because
    // a settlement path that throws is a settlement path that can be used to wedge a raid.
    applyRaidResult(accountId, result) {
        const account = this.accounts.get(accountId);
        if (!account) return { ok: false, error: 'no-such-account' };
        if (!result || typeof result !== 'object' || Array.isArray(result)) return { ok: false, error: 'invalid-result' };
        const raidId = typeof result.raidId === 'string' ? result.raidId.trim() : '';
        if (!raidId) return { ok: false, error: 'invalid-raid-id' };

        // Tolerate accounts loaded from an older file that predates the ledger.
        if (!Array.isArray(account.appliedRaids)) account.appliedRaids = [];
        if (account.appliedRaids.includes(raidId)) return { ok: true, duplicate: true, account };

        if (!account.stats || typeof account.stats !== 'object') account.stats = {};
        // Outcome flags are coerced here too: a truthy string must not count as an extraction.
        const extracted = !!result.extracted;
        const kills = safeInt(result.kills);
        const deaths = safeInt(result.deaths);
        // Credits come from the CALLER's value (progression.mjs is the only place that
        // computes it), clamped so a corrupted field cannot mint negative or infinite money.
        const value = safeCredits(result.value);

        account.stats.raids = safeInt(account.stats.raids) + 1;
        account.stats.extractions = safeInt(account.stats.extractions) + (extracted ? 1 : 0);
        account.stats.kills = safeInt(account.stats.kills) + kills;
        account.stats.deaths = safeInt(account.stats.deaths) + deaths;
        account.credits = safeCredits(safeCredits(account.credits) + value);

        // Calculate and award progression XP
        const won = !!result.won && extracted;
        const drives = safeInt(result.drives);
        const raidXp = safeInt((extracted ? 350 : 0) + (drives * 150) + (kills * (won ? 100 : 40)) + Math.floor(value / 10));
        const prevLevel = calcLevel(account.xp || 0).level;
        account.xp = safeInt(account.xp || 0) + raidXp;
        const newLevel = calcLevel(account.xp).level;
        if (newLevel > prevLevel) {
            account.skillPoints = safeInt(account.skillPoints || 0) + (newLevel - prevLevel);
            account.level = newLevel;
        }

        // Advance active contracts
        if (account.contracts && Array.isArray(account.contracts.active)) {
            for (const ac of account.contracts.active) {
                const def = CONTRACT_DEFINITIONS[ac.id];
                if (!def) continue;
                if (def.type === 'kill_spotter') {
                    ac.progress = Math.min(def.targetCount, safeInt(ac.progress) + kills);
                } else if (def.type === 'kill_sentinel') {
                    if (result.sentinelKilled) ac.progress = Math.min(def.targetCount, safeInt(ac.progress) + 1);
                } else if (def.type === 'extract_drives' && extracted) {
                    ac.progress = Math.min(def.targetCount, safeInt(ac.progress) + drives);
                } else if (def.type === 'extract_weight' && extracted) {
                    if (Number(result.weight || 0) >= def.targetCount) ac.progress = def.targetCount;
                } else if (def.type === 'extract_healthy' && extracted) {
                    if (Number(result.hpPercent || 100) >= 80) ac.progress = 1;
                }
                if (ac.progress >= def.targetCount) ac.completed = true;
            }
        }

        account.appliedRaids.push(raidId);
        if (account.appliedRaids.length > MAX_APPLIED_RAIDS) {
            account.appliedRaids.splice(0, account.appliedRaids.length - MAX_APPLIED_RAIDS);
        }
        applyRaidInventory(account, result);
        this._save();
        return { ok: true, duplicate: false, account };
    }

    // Public view of an account: what another player may know about you.
    static publicView(account) {
        if (!account) return null;
        return {
            id: account.id,
            name: account.name,
            lastSeen: account.lastSeen,
            credits: safeCredits(account.credits),
            arcCores: safeInt(account.arcCores || 0),
            level: safeInt(account.level || 1),
            stats: {
                raids: safeInt(account.stats && account.stats.raids),
                extractions: safeInt(account.stats && account.stats.extractions),
                kills: safeInt(account.stats && account.stats.kills),
                deaths: safeInt(account.stats && account.stats.deaths),
            },
        };
    }

    // Private view of inventory for the authenticated owner of the account.
    static inventoryView(account) {
        if (!account) return null;
        return {
            stash: account.stash || [],
            loadout: account.loadout || {},
            credits: safeCredits(account.credits),
            arcCores: safeInt(account.arcCores || 0),
            version: account.inventoryVersion || 1,
        };
    }

    // Full progression view: levels, skill tree, contracts, workshop, vendor trust.
    static progressionView(account) {
        if (!account) return null;
        const levelInfo = calcLevel(account.xp || 0);
        return {
            level: levelInfo.level,
            xp: levelInfo.xp,
            levelInfo,
            skillPoints: safeInt(account.skillPoints || 0),
            skills: account.skills || { resilience: {}, agility: {}, scavenging: {} },
            vendorTrust: {
                marco: getVendorTrustLevel(account.vendorTrust?.marco || 0),
                elena: getVendorTrustLevel(account.vendorTrust?.elena || 0),
                bruno: getVendorTrustLevel(account.vendorTrust?.bruno || 0),
                sofia: getVendorTrustLevel(account.vendorTrust?.sofia || 0),
            },
            contracts: account.contracts || { active: [], completed: [] },
            availableContracts: Object.values(CONTRACT_DEFINITIONS),
            stationLevels: account.stationLevels || { armory: 1, medlab: 1, gear: 1, electronics: 1, recycler: 1 },
            unlockedBlueprints: Array.isArray(account.unlockedBlueprints) ? account.unlockedBlueprints : [],
            stationsCatalog: WORKSHOP_STATIONS_CATALOG,
            craftingRecipes: CRAFTING_RECIPES,
            skillTree: SKILL_TREE,
        };
    }

    // Allocate a skill point into a skill tree node.
    allocateSkill(accountId, branchId, skillId) {
        const account = this.accounts.get(accountId);
        if (!account) return { ok: false, error: 'no-such-account' };
        if (safeInt(account.skillPoints) <= 0) return { ok: false, error: 'no-skill-points' };

        const branch = SKILL_TREE[branchId];
        if (!branch) return { ok: false, error: 'invalid-branch' };
        const skill = branch.skills[skillId];
        if (!skill) return { ok: false, error: 'invalid-skill' };

        account.skills = account.skills || { resilience: {}, agility: {}, scavenging: {} };
        account.skills[branchId] = account.skills[branchId] || {};
        if (account.skills[branchId][skillId]) return { ok: false, error: 'already-learned' };

        if (skill.req && !account.skills[branchId][skill.req]) {
            return { ok: false, error: 'missing-prerequisite' };
        }

        account.skillPoints = Math.max(0, safeInt(account.skillPoints) - 1);
        account.skills[branchId][skillId] = true;
        this._save();
        return { ok: true, progression: AccountStore.progressionView(account) };
    }

    // Respec (reset) all allocated skill points for Credits.
    respecSkills(accountId) {
        const account = this.accounts.get(accountId);
        if (!account) return { ok: false, error: 'no-such-account' };

        let totalAllocated = 0;
        if (account.skills) {
            for (const b of Object.values(account.skills)) {
                if (b && typeof b === 'object') {
                    totalAllocated += Object.keys(b).length;
                }
            }
        }
        if (totalAllocated === 0) return { ok: false, error: 'no-skills-to-reset' };

        const cost = totalAllocated * 1500;
        if (safeCredits(account.credits) < cost) {
            return { ok: false, error: 'insufficient-credits', cost, credits: account.credits };
        }

        account.credits = safeCredits(account.credits - cost);
        account.skillPoints = safeInt(account.skillPoints) + totalAllocated;
        account.skills = { resilience: {}, agility: {}, scavenging: {} };
        this._save();
        return { ok: true, refunded: totalAllocated, cost, progression: AccountStore.progressionView(account) };
    }

    // Accept a field contract from a vendor board.
    acceptContract(accountId, contractId) {
        const account = this.accounts.get(accountId);
        if (!account) return { ok: false, error: 'no-such-account' };

        const def = CONTRACT_DEFINITIONS[contractId];
        if (!def) return { ok: false, error: 'invalid-contract' };

        account.contracts = account.contracts || { active: [], completed: [] };
        account.contracts.active = Array.isArray(account.contracts.active) ? account.contracts.active : [];
        if (account.contracts.active.some(c => c.id === contractId)) {
            return { ok: false, error: 'already-active' };
        }
        if (account.contracts.active.length >= 4) {
            return { ok: false, error: 'active-contracts-limit-reached' };
        }

        account.contracts.active.push({
            id: contractId,
            progress: 0,
            completed: false,
            acceptedAt: this.now()
        });
        this._save();
        return { ok: true, contracts: account.contracts };
    }

    // Claim completed contract rewards.
    claimContract(accountId, contractId) {
        const account = this.accounts.get(accountId);
        if (!account) return { ok: false, error: 'no-such-account' };

        account.contracts = account.contracts || { active: [], completed: [] };
        const idx = (account.contracts.active || []).findIndex(c => c.id === contractId);
        if (idx === -1) return { ok: false, error: 'contract-not-active' };

        const activeContract = account.contracts.active[idx];
        const def = CONTRACT_DEFINITIONS[contractId];
        if (!def) return { ok: false, error: 'invalid-contract-definition' };

        if (!activeContract.completed && safeInt(activeContract.progress) < def.targetCount) {
            return { ok: false, error: 'contract-not-completed' };
        }

        // Apply rewards
        const rewards = def.rewards;
        account.credits = safeCredits(account.credits + (rewards.credits || 0));
        account.xp = safeInt(account.xp || 0) + (rewards.xp || 0);
        const newLevel = calcLevel(account.xp).level;
        if (newLevel > safeInt(account.level || 1)) {
            account.skillPoints = safeInt(account.skillPoints || 0) + (newLevel - safeInt(account.level || 1));
            account.level = newLevel;
        }

        account.vendorTrust = account.vendorTrust || { marco: 0, elena: 0, bruno: 0, sofia: 0 };
        account.vendorTrust[def.vendor] = safeInt(account.vendorTrust[def.vendor] || 0) + (rewards.trust || 0);

        // Add reward items to stash
        if (Array.isArray(rewards.items)) {
            account.stash = Array.isArray(account.stash) ? account.stash : [];
            for (const rItem of rewards.items) {
                if (rItem.id === 'core_flux_1') {
                    account.arcCores = safeInt(account.arcCores || 0) + (rItem.count || 1);
                } else {
                    account.stash.push({
                        id: rItem.id,
                        instId: 'reward_' + randomUUID().slice(0, 8),
                        name: rItem.id.toUpperCase(),
                        category: 'consumables',
                        rarity: 'Rare',
                        count: rItem.count || 1,
                        weight: 1.0,
                        value: 500
                    });
                }
            }
        }

        // Move to completed
        account.contracts.active.splice(idx, 1);
        account.contracts.completed = Array.isArray(account.contracts.completed) ? account.contracts.completed : [];
        account.contracts.completed.push({ id: contractId, claimedAt: this.now() });

        this._save();
        return { ok: true, rewards, progression: AccountStore.progressionView(account) };
    }

    // Upgrade a workshop station level using credits and materials from stash.
    upgradeWorkshopStation(accountId, stationId) {
        const account = this.accounts.get(accountId);
        if (!account) return { ok: false, error: 'no-such-account' };

        const station = WORKSHOP_STATIONS_CATALOG[stationId];
        if (!station) return { ok: false, error: 'invalid-station' };

        account.stationLevels = account.stationLevels || { armory: 1, medlab: 1, gear: 1, electronics: 1, recycler: 1 };
        const currentLevel = safeInt(account.stationLevels[stationId] || 1);
        if (currentLevel >= 3) return { ok: false, error: 'max-level' };

        const nextLevel = currentLevel + 1;
        const cost = station.upgradeCosts[nextLevel];
        if (!cost) return { ok: false, error: 'no-upgrade-cost' };

        if (safeCredits(account.credits) < cost.credits) {
            return { ok: false, error: 'insufficient-credits', cost: cost.credits };
        }

        // Validate required materials in stash
        account.stash = Array.isArray(account.stash) ? account.stash : [];
        if (Array.isArray(cost.materials)) {
            for (const req of cost.materials) {
                let avail = 0;
                if (req.id === 'core_flux_1') {
                    avail = safeInt(account.arcCores || 0);
                } else {
                    for (const item of account.stash) {
                        if (item && item.id === req.id) avail += Number(item.count || 1);
                    }
                }
                if (avail < req.count) {
                    return { ok: false, error: 'missing-materials', material: req.id, needed: req.count, available: avail };
                }
            }

            // Deduct materials
            for (const req of cost.materials) {
                if (req.id === 'core_flux_1') {
                    account.arcCores = Math.max(0, safeInt(account.arcCores || 0) - req.count);
                } else {
                    let needed = req.count;
                    for (let i = account.stash.length - 1; i >= 0 && needed > 0; i--) {
                        const it = account.stash[i];
                        if (it && it.id === req.id) {
                            const c = Number(it.count || 1);
                            if (c <= needed) {
                                needed -= c;
                                account.stash.splice(i, 1);
                            } else {
                                it.count -= needed;
                                needed = 0;
                            }
                        }
                    }
                }
            }
        }

        account.credits = safeCredits(account.credits - cost.credits);
        account.stationLevels[stationId] = nextLevel;
        this._save();
        return { ok: true, newLevel: nextLevel, stationLevels: account.stationLevels, credits: account.credits };
    }

    // Craft an item at a workshop station.
    craftItem(accountId, recipeId) {
        const account = this.accounts.get(accountId);
        if (!account) return { ok: false, error: 'no-such-account' };

        const recipe = CRAFTING_RECIPES[recipeId];
        if (!recipe) return { ok: false, error: 'invalid-recipe' };

        account.stationLevels = account.stationLevels || { armory: 1, medlab: 1, gear: 1, electronics: 1, recycler: 1 };
        const stationLvl = safeInt(account.stationLevels[recipe.station] || 1);
        if (stationLvl < recipe.minStationLevel) {
            return { ok: false, error: 'station-level-too-low', required: recipe.minStationLevel, current: stationLvl };
        }

        if (safeCredits(account.credits) < recipe.costCredits) {
            return { ok: false, error: 'insufficient-credits', cost: recipe.costCredits };
        }

        // Validate and deduct materials
        account.stash = Array.isArray(account.stash) ? account.stash : [];
        for (const req of recipe.materials) {
            let avail = 0;
            if (req.id === 'core_flux_1') {
                avail = safeInt(account.arcCores || 0);
            } else {
                for (const item of account.stash) {
                    if (item && item.id === req.id) avail += Number(item.count || 1);
                }
            }
            if (avail < req.count) {
                return { ok: false, error: 'missing-materials', material: req.id, needed: req.count, available: avail };
            }
        }

        for (const req of recipe.materials) {
            if (req.id === 'core_flux_1') {
                account.arcCores = Math.max(0, safeInt(account.arcCores || 0) - req.count);
            } else {
                let needed = req.count;
                for (let i = account.stash.length - 1; i >= 0 && needed > 0; i--) {
                    const it = account.stash[i];
                    if (it && it.id === req.id) {
                        const c = Number(it.count || 1);
                        if (c <= needed) {
                            needed -= c;
                            account.stash.splice(i, 1);
                        } else {
                            it.count -= needed;
                            needed = 0;
                        }
                    }
                }
            }
        }

        account.credits = safeCredits(account.credits - recipe.costCredits);
        const craftedItem = Object.assign({}, recipe.outputItem, {
            instId: 'crafted_' + randomUUID().slice(0, 8),
            craftedAt: this.now()
        });
        account.stash.push(craftedItem);
        this._save();
        return { ok: true, item: craftedItem, stash: account.stash, credits: account.credits };
    }

    // Emergency free kit when a player has no weapons and < 500 CR.
    claimFreeKit(accountId) {
        const account = this.accounts.get(accountId);
        if (!account) return { ok: false, error: 'no-such-account' };

        const hasWeapon = (account.loadout?.primary || account.loadout?.secondary) ||
            (Array.isArray(account.stash) && account.stash.some(it => it && it.category === 'weapons'));
        if (hasWeapon && safeCredits(account.credits) >= 500) {
            return { ok: false, error: 'not-eligible-for-free-kit' };
        }

        account.loadout = account.loadout || {};
        account.loadout.secondary = Object.assign({}, SCAVENGER_KIT.loadout.secondary, { instId: 'free_' + randomUUID().slice(0, 8) });
        account.loadout.shieldCore = Object.assign({}, SCAVENGER_KIT.loadout.shieldCore, { instId: 'free_' + randomUUID().slice(0, 8) });

        account.stash = Array.isArray(account.stash) ? account.stash : [];
        for (const it of SCAVENGER_KIT.loadout.backpack) {
            account.stash.push(Object.assign({}, it, { instId: 'free_' + randomUUID().slice(0, 8) }));
        }

        this._save();
        return { ok: true, inventory: AccountStore.inventoryView(account) };
    }
}

export const ACCOUNT_RULES = { NAME_RE, MAX_APPLIED_RAIDS };
