// RaidWorld.js — the authoritative raid map: bounds, static geometry, terrain height,
// spawn points, loot and objective layout. Owned by ONE place so the server and the browser
// generate byte-identical worlds from the same seed.
//
// Why this file exists: before it, the map lived in three incompatible copies —
// `Game.js` (blockers, loot spots, enemy spawns, extraction), `RaidEnvironment.js`
// (the visible district, with its own obstacle list) and `server/simulation.mjs`
// (a 2000x2000 box with no geometry at all). A server cannot arbitrate a raid whose
// geometry it does not have, and a client cannot trust a map it cannot reproduce.
//
// DETERMINISM (invariant 4). Everything here is pure arithmetic over a seeded PRNG and an
// analytic height field. No Babylon, no DOM, no `Terrain3D.heightAt` — that one reads the
// drawn triangle grid, whose cell size differs on mobile, so it must never decide gameplay.
// `heightAt` below reproduces the SAME noise formula as Terrain3D.terrainNoise on a FIXED
// cell, which is what makes client and server agree.
//
// Load order: after Constants.js and ShooterRules.js, before RaidRules/Game/server use it.

/** @satisfies {Record<string, any>} */
const RaidWorld = {
    // Fallbacks only for a Constants.js older than this file; the real numbers are constants.
    DEFAULTS: {
        width: 4096,
        height: 4096,
        terrainCell: 12,
        noiseAmp: 24,
        noiseScale: 1400,
        noiseSeed: 4,
        noiseBase: 0,
        enemyCount: 9,
        lootTarget: 3,
    },

    // Constants are read ONCE with `typeof` (invariant 3): in the game they are lexical
    // `const` and are NOT properties of globalThis, so a dynamic `globalThis[name]` lookup
    // silently returned undefined everywhere. Cached so the hot height path stays cheap.
    _cfg: null,
    activeLevel: null,
    config() {
        if (this._cfg) return this._cfg;
        const U = 'undefined';
        this._cfg = {
            width: typeof LOCATION_WIDTH !== U ? LOCATION_WIDTH : this.DEFAULTS.width,
            height: typeof LOCATION_HEIGHT !== U ? LOCATION_HEIGHT : this.DEFAULTS.height,
            cell: typeof TERRAIN_CELL !== U ? TERRAIN_CELL : this.DEFAULTS.terrainCell,
            noiseAmp: typeof TERRAIN_NOISE_AMP !== U ? TERRAIN_NOISE_AMP : this.DEFAULTS.noiseAmp,
            noiseScale: typeof TERRAIN_NOISE_SCALE !== U ? TERRAIN_NOISE_SCALE : this.DEFAULTS.noiseScale,
            noiseSeed: typeof TERRAIN_NOISE_SEED !== U ? TERRAIN_NOISE_SEED : this.DEFAULTS.noiseSeed,
            noiseBase: typeof TERRAIN_BASE !== U ? TERRAIN_BASE : this.DEFAULTS.noiseBase,
            enemyCount: typeof GAME_ENEMY_COUNT !== U ? GAME_ENEMY_COUNT : this.DEFAULTS.enemyCount,
            lootTarget: typeof GAME_LOOT_TARGET !== U ? GAME_LOOT_TARGET : this.DEFAULTS.lootTarget,
        };
        if (this.activeLevel) {
            const l = this.activeLevel, t = l.terrain || {};
            Object.assign(this._cfg, { width: l.dimensions?.width || this._cfg.width, height: l.dimensions?.height || this._cfg.height,
                noiseAmp: t.noiseAmp ?? this._cfg.noiseAmp, noiseBase: t.base ?? this._cfg.noiseBase, noiseScale: t.noiseScale ?? this._cfg.noiseScale, noiseSeed: t.seed ?? this._cfg.noiseSeed });
        }
        return this._cfg;
    },

    // Analytic terrain height, identical on every device and on Node. Two octaves, exactly
    // like Terrain3D.terrainNoise, but driven by a self-contained noise so this module does
    // not depend on which script happened to load SimplexNoise.
    heightAt(x, y) {
        const t = this.activeLevel?.terrain;
        if (t?.samples && t.nx > 1 && t.ny > 1) {
            const cell = t.cell || 8, fx = Math.max(0, Math.min(t.nx - 1, x / cell)), fy = Math.max(0, Math.min(t.ny - 1, y / cell));
            const i = Math.min(t.nx - 2, Math.floor(fx)), j = Math.min(t.ny - 2, Math.floor(fy)), u = fx - i, v = fy - j, k = j * t.nx + i;
            const a = t.samples[k], b = t.samples[k + 1], c = t.samples[k + t.nx], d = t.samples[k + t.nx + 1];
            return u >= v ? a + (b - a) * u + (d - b) * v : a + (c - a) * v + (d - c) * u;
        }
        const c = this.config();
        const noise = this._noise(c.noiseSeed, c.noiseScale);
        if (!noise) return c.noiseBase;
        return c.noiseBase + noise(x, y) * c.noiseAmp;
    },

    // SimplexNoise(seed) -> f(x, y), cached. Returns null when the library is absent so
    // heightAt degrades to a flat plane instead of throwing.
    _noise(seed, scale) {
        if (this._noiseSeed === seed && this._noiseFn) return this._noiseFn;
        if (typeof SimplexNoise === 'undefined') return null;
        const s = Math.max(40, scale);
        const n = new SimplexNoise(String(seed));
        this._noiseSeed = seed;
        this._noiseFn = (x, y) =>
            n.noise2D(x / s, y / s) * 0.72 +
            n.noise2D(x / s * 2.3 + 17.1, y / s * 2.3 - 9.7) * 0.28;
        return this._noiseFn;
    },

    bounds() {
        const c = this.config();
        return { width: c.width, height: c.height };
    },

    // Deterministic PRNG. Mulberry32 over a string hash: the SAME sequence in V8 (server)
    // and in the browser, which `Math.random` and Set/Map iteration order do not guarantee.
    rng(seed) {
        let h = 2166136261;
        const text = String(seed);
        for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
        let a = h >>> 0;
        return function next() {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },

    // Storage vessels: the collision footprint AND the vessel height. The height matters:
    // ShooterRules defaults a blocker without one to 80 px, so a 260 px tank used to be
    // shootable straight through while low crates blocked empty air.
    tanks() {
        return [
            { x: 610, y: 1440, radius: 120, height: 260 },
            { x: 980, y: 1070, radius: 150, height: 330 },
            { x: 1390, y: 1360, radius: 130, height: 220 },
            { x: 1500, y: 600, radius: 145, height: 340 },
            { x: 720, y: 570, radius: 110, height: 250 },
            { x: 2900, y: 1100, radius: 125, height: 280 },
            { x: 3400, y: 950, radius: 145, height: 320 },
            { x: 2850, y: 2600, radius: 120, height: 240 },
            { x: 3350, y: 3100, radius: 140, height: 300 },
            { x: 1100, y: 2800, radius: 125, height: 250 },
        ];
    },

    // Low cover the player can shoot over.
    cover() {
        return [
            { x: 520, y: 1310, radius: 52, height: 90 },
            { x: 1340, y: 1300, radius: 58, height: 90 },
            { x: 1450, y: 1270, radius: 58, height: 90 },
            { x: 1320, y: 910, radius: 42, height: 70 },
            { x: 1730, y: 270, radius: 54, height: 90 },
            { x: 280, y: 2500, radius: 45, height: 70 },
            { x: 1800, y: 1400, radius: 45, height: 70 },
            { x: 3200, y: 1400, radius: 45, height: 70 },
            { x: 3450, y: 700, radius: 40, height: 70 },
            { x: 3650, y: 1250, radius: 40, height: 70 },
        ];
    },

    // Authored district props (barriers, generators, barrels) placed by RaidEnvironment.
    // Kept here so the server blocks on the same silhouettes the player can see.
    props() {
        const authored = [
            { x: 125, y: 1450, radius: 30, height: 110 },
            { x: 125, y: 1240, radius: 30, height: 110 },
            { x: 450, y: 1530, radius: 28, height: 110 },
            { x: 450, y: 1230, radius: 28, height: 110 },
            { x: 720, y: 1530, radius: 35, height: 110 },
            { x: 1270, y: 875, radius: 38, height: 110 },
            { x: 473, y: 1510, radius: 18, height: 55 },
            { x: 496, y: 1490, radius: 18, height: 55 },
            { x: 475, y: 1470, radius: 18, height: 55 },
            { x: 1080, y: 1200, radius: 18, height: 55 },
            { x: 1118, y: 1210, radius: 18, height: 55 },
            { x: 1580, y: 730, radius: 18, height: 55 },
        ];
        if (typeof LOCATION_OBJECTS !== 'undefined') {
            return authored.filter(p => LOCATION_OBJECTS.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 40));
        }
        return authored;
    },

    // The complete static collision set for one raid. `seed` only selects between authored
    // layouts; geometry itself never depends on the client. Pure: same seed -> equal values.
    build(seed = 0) {
        const custom = this.activeLevel || ((typeof RAID_CUSTOM_LEVEL !== 'undefined' && RAID_CUSTOM_LEVEL) ? RAID_CUSTOM_LEVEL : null);
        const enabled = custom?.environment?.structures !== false;
        let tanks = enabled ? this.tanks() : [];
        if (Array.isArray(custom?.districtStructures)) tanks = tanks.flatMap((tank, i) => {
            const rec = custom.districtStructures.find(r => r.id === 'env_tank_' + (i + 1));
            if (!rec) return [];
            return [{ ...tank, x: rec.position?.[0] ?? tank.x, y: rec.position?.[2] ?? tank.y, radius: tank.radius * Math.max(rec.scale?.[0] || 1, rec.scale?.[2] || 1), height: tank.height * (rec.scale?.[1] || 1) }];
        });
        const props = custom?.props ? custom.props.filter(p => !p.hidden).map(p => ({ x: p.x, y: p.y, radius: p.radius || 24, height: p.height || 80 })) : (enabled ? this.props() : []);
        const containers = (custom && Array.isArray(custom.containers))
            ? custom.containers.map((c, i) => ({ id: i, type: c.type || 'scrap', x: c.x, y: c.y, radius: c.radius || 48, height: 60 }))
            : this.containerSpawns(seed);
        const supports = [];
        if (enabled && Array.isArray(custom?.districtStructures)) for (const rec of custom.districtStructures) {
            let local = [];
            if (rec.id.startsWith('env_arch_')) local = [-148, 148].map(x => ({ x, y: 0, radius: 23, height: 280 }));
            if (rec.id.startsWith('env_pipe_')) local = [480, 880, 1260, 1630, 2400, 2900].map(x => ({ x: x - 1400, y: 0, radius: 13, height: 250 }));
            if (rec.id.startsWith('env_radar_')) local = [{ x: 0, y: 0, radius: 35, height: 280 }];
            const p = rec.position || [0, 0, 0], s = rec.scale || [1, 1, 1], angle = rec.rotation?.[1] || 0;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            for (const b of local) supports.push({ x: p[0] + b.x * s[0] * cos + b.y * s[2] * sin,
                y: p[2] - b.x * s[0] * sin + b.y * s[2] * cos,
                radius: b.radius * Math.max(Math.abs(s[0]), Math.abs(s[2])), height: b.height * Math.abs(s[1]) });
        }
        const blockers = tanks.concat(props, supports);
        // Crates are real cover and belong in the collision set: without them bullets pass
        // through the box the player is hiding behind.
        const crateFootprints = containers.map(c => ({ x: c.x, y: c.y, radius: 34, height: c.height }));

        const spawn = (custom && custom.spawn) ? { x: custom.spawn.x, y: custom.spawn.y } : custom?.spawn === null ? { x: this.bounds().width / 2, y: this.bounds().height / 2 } : { x: 280, y: 1660 };
        const extraction = custom?.extraction === null ? null : (custom && custom.extraction) ? { x: custom.extraction.x, y: custom.extraction.y, radius: custom.extraction.radius || 130 } : { x: 3680, y: 520, radius: 130 };
        const hatch = custom?.hatch === null ? null : (custom && custom.hatch) ? { x: custom.hatch.x, y: custom.hatch.y, radius: custom.hatch.radius || 60 } : { x: 780, y: 1250, radius: 60 };
        const isPeaceful = !!(custom?.noEnemies || custom?.peaceful);
        const enemies = isPeaceful
            ? []
            : ((custom && Array.isArray(custom.enemies))
                ? custom.enemies.map((e, i) => ({ id: i + 1, archetype: e.archetype || 'stalker', x: e.x, y: e.y, dormant: !!e.dormant }))
                : this.enemySpawns(seed));
        const drives = (custom && Array.isArray(custom.drives))
            ? custom.drives.map((d, i) => ({ id: i, x: d.x, y: d.y, radius: d.radius || 48 }))
            : this.driveSpawns(seed);

        return {
            seed,
            width: this.bounds().width,
            height: this.bounds().height,
            blockers,
            cover: blockers.concat(enabled && !Array.isArray(custom?.districtStructures) ? this.cover() : [], crateFootprints),
            spawn,
            enemies,
            drives,
            containers,
            extraction,
            hatch,
        };
    },

    enemySpawns(seed) {
        const sets = [
            [[780, 2950], [920, 2450], [1040, 3100], [1450, 1850], [1850, 1550],
             [3200, 1100], [3450, 750], [1200, 1400], [2100, 2200], [2900, 2800],
             [3350, 3100], [3650, 1250], [980, 1070], [3150, 3450], [2250, 1350], [2650, 3350]],
            [[760, 2850], [950, 2350], [1120, 3050], [1520, 1750], [1950, 1450],
             [3100, 1050], [3350, 800], [1300, 1300], [2200, 2100], [2800, 2700],
             [3250, 3000], [3550, 1200], [1080, 1170], [3050, 3350], [2350, 1450], [2750, 3250]],
            [[820, 3050], [900, 2550], [1080, 3150], [1400, 1950], [1750, 1650],
             [3300, 1150], [3550, 700], [1100, 1500], [2000, 2300], [3000, 2900],
             [3450, 3200], [3750, 1300], [880, 970], [3250, 3550], [2150, 1250], [2550, 3450]],
        ];
        const points = sets[Math.abs(seed) % sets.length];
        const count = Math.min(Math.max(this.config().enemyCount, 12), points.length);
        // Archetype by index: identical on both sides, and it now covers every spawned slot
        // instead of falling through to unreachable scout/heavy branches.
        const byIndex = ['spotter', 'stalker', 'cricket', 'pop', 'sentinel', 'screamer',
                         'bombard', 'spotter', 'cricket', 'heavy', 'stalker', 'screamer',
                         'sentinel', 'scout', 'pop', 'guard'];
        return points.slice(0, count).map((p, i) => ({
            id: i + 1,
            archetype: byIndex[i % byIndex.length],
            x: p[0],
            y: p[1],
            dormant: i >= Math.min(this.config().enemyCount, 10),
        }));
    },

    driveSpawns(seed) {
        const sets = [
            [[1150, 2950], [2150, 1650], [3300, 2800]],
            [[980, 2450], [2150, 1650], [3450, 850]],
            [[750, 2200], [2100, 2200], [3650, 1200]],
        ];
        const spots = sets[Math.abs(seed) % sets.length];
        const target = this.config().lootTarget;
        return spots.slice(0, target).map((p, i) => ({ id: i, x: p[0], y: p[1], radius: 48 }));
    },

    containerSpawns(seed) {
        const spots = [
            [430, 2930], [1180, 2520], [930, 1470], [1890, 1820],
            [2850, 1120], [3450, 850], [3300, 2850], [2750, 3350],
        ];
        // The ITEM TYPE comes from the same rule the client and the server both pay for
        // (`ShooterRules.rollLoot(seed, id)`). This used to be a separate RNG here, which meant
        // the map advertised one item while the game awarded another — a discrepancy nobody
        // noticed offline but which would break an authoritative payout.
        return spots.map((p, i) => ({
            id: i,
            x: p[0],
            y: p[1],
            radius: 48,
            // Height of the crate body: 34 px box lifted 16 px, so a crate stops bullets at
            // its real silhouette rather than a default cylinder.
            height: 50,
            type: (typeof ShooterRules !== 'undefined' && ShooterRules.rollLoot)
                ? ShooterRules.rollLoot(seed, i)
                : 'scrap',
        }));
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = RaidWorld;
if (typeof window !== 'undefined') /** @type {any} */ (window).RaidWorld = RaidWorld;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).RaidWorld = RaidWorld;