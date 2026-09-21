import fs from 'node:fs';
import vm from 'node:vm';

// Execute the exact browser rules on Node; never load Babylon or browser adapters.
// libs/simplex-noise.js runs first: RaidWorld derives the terrain height from it, and that
// height must be the SAME curve the browser uses or client and server would disagree about
// where the ground is (invariant 4).
const context = vm.createContext({ navigator: { userAgent: '', maxTouchPoints: 0 }, innerWidth: 1920, console });
context.window = context;
for (const file of ['libs/simplex-noise', 'js/Constants', 'js/ShooterRules', 'js/RaidWorld', 'js/RaidRules']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}.js`, import.meta.url), 'utf8'), context);
}
// ARC_MACHINE_TYPES is a lexical `const` inside the vm context, so it is NOT a Node global:
// reading it with `typeof` from module scope always failed and every machine got 68 HP.
// Pull it out of the context once, together with the other shared tables.
const { rules, settings, shooterRules, world, machineTypes } = vm.runInContext(`({ rules: RaidRules, shooterRules: ShooterRules, world: RaidWorld, machineTypes: ARC_MACHINE_TYPES, settings: {
    speed: GAME_PLAYER_SPEED, radius: GAME_PLAYER_RADIUS,
    stamina: { max: GAME_STAMINA_MAX, drain: GAME_STAMINA_DRAIN, regen: GAME_STAMINA_REGEN,
        delay: GAME_STAMINA_DELAY, restart: GAME_STAMINA_RESTART },
    fireInterval: GAME_FIRE_INTERVAL, damage: GAME_FIRE_DAMAGE, hp: GAME_PLAYER_HP,
    raidDuration: GAME_RAID_DURATION_SEC, lootTarget: GAME_LOOT_TARGET,
    backpackSlots: GAME_BACKPACK_SLOTS, interactRange: GAME_INTERACT_RANGE,
} })`, context);

// The loot price table comes from the shared rules module, so the browser and the server can
// never disagree about what an item is worth — the payout depends on it.
const LOOT_VALUE = (shooterRules && shooterRules.LOOT_VALUES) || { ammo: 20, scrap: 35, medkit: 55, electronics: 75, intel: 120 };

export const PROTOCOL_VERSION = 2;
export const TICK_RATE = 60;

// Authoritative raid. The server owns the map, the clock, the actors and every outcome;
// clients send INTENT ONLY (movement axes, heading, trigger) and receive snapshots/events.
export class RaidRoom {
    // opts: { seed, world }. `world` is a RaidWorld.build() result; when omitted the room
    // builds the map itself from the seed, which is what makes the server self-sufficient.
    constructor({ seed = 7419, world: map = null, blockers = null } = {}) {
        this.seed = seed;
        this.map = map || world.build(seed);
        this.width = this.map.width;
        this.height = this.map.height;
        this.blockers = blockers ? structuredClone(blockers) : structuredClone(this.map.blockers);
        // Ground reference for every height calculation on this room.
        this.heightAt = (x, y) => world.heightAt(x, y);
        this.players = new Map();
        this.projectiles = new Map();
        this.events = [];
        this.tick = 0;
        this._projSeq = 0;
        // The PvE garrison. Built from the map so every client and the server agree on where
        // the machines stand, which archetype each one is and how much health it has.
        this.enemies = new Map();
        for (const def of this.map.enemies) this.enemies.set(def.id, this._makeEnemy(def));
        this._enemySeq = 0;

        // --- raid lifecycle -------------------------------------------------
        // The server owns the raid's state, not the client. `active` -> `ended` happens once,
        // and the outcome is recorded so every player receives the same result.
        this.state = 'active';
        this.outcome = null;            // { won, reason, atTick, survivors, settled }
        this.collectedDrives = 0;
        // Per-player combat tallies. The server already decided these outcomes, but it only
        // emitted EVENTS for them; a payout needs to read the numbers back later, so they are
        // accumulated here as the raid runs. `kills` counts MACHINE kills (what a raid pays
        // for); player kills are recorded separately so PvP can be scored without mixing the two.
        /** @type {Map<string, {kills: number, playerKills: number, deaths: number, drives: number}>} */
        this.tallies = new Map();
        // Loot crates, derived from the SAME map the client renders. The contents are a
        // deterministic function of the seed, so the server and the browser agree without the
        // server having to trust a client's claim about what it found.
        this.containers = (this.map.containers || []).map(c => ({ ...c, opened: false }));
        /** @type {Map<string, Set<number>>} playerId -> crate ids this player has searched */
        this.searched = new Map();
        /** @type {Map<string, number>} playerId -> non-instant items carried (backpack slots) */
        this.carried = new Map();
        this.lootValue = 0;   // total value of items taken, in credits
        this.extractionState = 'locked'; // locked -> available -> inbound -> boarding
        this.inboundTimer = 0;
        this.boardingProgress = 0;
        /** @type {Set<string>} players who extracted cleanly */
        this.extracted = new Set();
        /** @type {Set<string>} players who died or surrendered */
        this.casualties = new Set();
        /** @type {Set<string>} players eligible for reconnect within the grace window */
        this.disconnected = new Map();  // id -> { at, snapshot }
    }

    // A player who left mid-raid keeps their body in the world and their slot reserved for a
    // grace window, so a dropped connection is not an instant loss of gear.
    markDisconnected(id, graceMs, nowMs) {
        const p = this.players.get(id);
        if (!p) return false;
        p.disconnected = true;
        p.input = null;
        this.disconnected.set(id, { at: nowMs, graceMs });
        this.events.push({ type: 'disconnect', playerId: id, tick: this.tick });
        return true;
    }

    // Restore a reconnecting player. Returns the player or null when the grace expired.
    reconnect(id, nowMs) {
        const record = this.disconnected.get(id);
        const p = this.players.get(id);
        if (!record || !p) return null;
        if (nowMs - record.at > record.graceMs) return null;
        p.disconnected = false;
        this.disconnected.delete(id);
        this.events.push({ type: 'reconnect', playerId: id, tick: this.tick });
        return p;
    }

    // Drop grace records whose window has passed and evict those players for good.
    reapDisconnected(nowMs) {
        const evicted = [];
        for (const [id, record] of this.disconnected) {
            if (nowMs - record.at > record.graceMs) {
                this.players.delete(id);
                this.disconnected.delete(id);
                this.events.push({ type: 'abandon', playerId: id, tick: this.tick });
                evicted.push(id);
            }
        }
        return evicted;
    }

    // The running tally for one player, created on demand so a player who joins mid-raid or a
    // kill credited before the map entry exists cannot crash the room.
    tally(playerId) {
        let t = this.tallies.get(playerId);
        if (!t) {
            t = { kills: 0, playerKills: 0, deaths: 0, drives: 0 };
            this.tallies.set(playerId, t);
        }
        return t;
    }

    // One ARC machine. Stats come from ARC_MACHINE_TYPES when present, so the server and the
    // browser cannot drift apart on numbers the way two hand-written tables did before.
    _makeEnemy(def) {
        const type = (machineTypes && machineTypes[def.archetype.toUpperCase()]) || null;
        const ground = this.heightAt(def.x, def.y);
        const hp = (type && type.hp) || 68;
        return {
            id: def.id,
            archetype: def.archetype,
            x: def.x,
            y: def.y,
            h: ground,
            homeX: def.x,
            homeY: def.y,
            radius: (type && type.radius) || 38,
            height: (type && type.height) || 64,
            hp,
            maxHp: hp,
            state: def.dormant ? 'dormant' : 'patrol',
            alert: 0,
            cooldown: 0,
            patrolPhase: def.id * 1.37,
            patrolRadius: 140,
            speed: (type && type.speed) || 75,
            aggro: (type && type.visionRange) || 480,
            damage: (type && type.gunDamage) || 9,
        };
    }

    // Deterministic PvE. Patrol, notice a player, shoot. No pathfinding yet: machines steer
    // straight and slide along blockers, exactly like the offline game.
    stepEnemies(dt) {
        const targets = [...this.players.values()].filter(p => p.hp > 0);
        for (const e of this.enemies.values()) {
            if (e.hp <= 0) continue;
            e.h = this.heightAt(e.x, e.y);
            e.cooldown = Math.max(0, e.cooldown - dt);
            if (e.state === 'dormant') continue;

            // Nearest visible player within the aggro radius.
            let best = null, bestD = Infinity;
            for (const p of targets) {
                const d = Math.hypot(p.x - e.x, p.y - e.y);
                if (d < e.aggro && d < bestD && shooterRules.hasLineOfSight(e, p, this.blockers, e.radius * 0.2)) {
                    best = p; bestD = d;
                }
            }

            if (best) {
                e.state = 'engage';
                e.alert = 1;
                e.heading = Math.atan2(best.y - e.y, best.x - e.x);
                if (e.cooldown <= 0) {
                    e.cooldown = 0.8;
                    const speed = 3200;
                    const groundE = this.heightAt(e.x, e.y);
                    const groundP = this.heightAt(best.x, best.y);
                    const muzzle = { x: e.x, y: e.y, h: groundE + e.height * 0.62 };
                    const distH = Math.max(1, Math.hypot(best.x - muzzle.x, best.y - muzzle.y));
                    const pitch = Math.atan2(muzzle.h - (groundP + 38), distH);
                    const cp = Math.cos(pitch);
                    const proj = shooterRules.createProjectile({
                        id: 'e_' + e.id + '_' + (++this._enemySeq),
                        shooterId: -e.id,
                        x: muzzle.x, y: muzzle.y, h: muzzle.h,
                        vx: Math.cos(e.heading) * cp * speed,
                        vy: Math.sin(e.heading) * cp * speed,
                        vh: -Math.sin(pitch) * speed,
                        damage: e.damage,
                        gravity: 980, drag: 0.04, maxRange: 1200,
                    });
                    proj.hostile = true;   // fired BY a machine: hurts players only
                    this.projectiles.set(proj.id, proj);
                    this.events.push({ type: 'enemyFire', enemyId: e.id, projId: proj.id, tick: this.tick });
                }
            } else if (e.state === 'engage') {
                // Lost the target: fall back to the post and cool down.
                e.state = 'patrol';
                e.alert = 0;
            } else {
                // Patrol a small circle around the post so the world reads as alive.
                e.patrolPhase += dt * 0.35;
                const tx = e.homeX + Math.cos(e.patrolPhase) * e.patrolRadius;
                const ty = e.homeY + Math.sin(e.patrolPhase) * e.patrolRadius;
                const dir = shooterRules.normalize(tx - e.x, ty - e.y);
                const moved = shooterRules.resolveCircleMovement(
                    e, { x: dir.x * e.speed * dt, y: dir.y * e.speed * dt }, e.radius, this.blockers);
                e.x = moved.x; e.y = moved.y;
                e.heading = Math.atan2(dir.y, dir.x);
            }
        }
    }
    join(id) {
        if (this.players.has(id)) throw new Error('duplicate-player');
        if (this.players.size >= 8) throw new Error('room-full');
        // Spawn from the authoritative map, spread along the insert so a squad does not stack.
        const base = this.map.spawn;
        const slot = this.players.size;
        const sx = base.x + (slot % 4) * 46;
        const sy = base.y + Math.floor(slot / 4) * 46;
        const p = { id, x: sx, y: sy, h: this.heightAt(sx, sy), heading: -Math.PI / 2, pitch: 0,
            sequence: -1, inputTick: this.tick,
            hp: settings.hp || 100, maxHp: settings.hp || 100,
            shield: 100, maxShield: 100, shieldCooldown: 0,
            height: 64, radius: settings.radius || 24,
            ammo: 20, reserveAmmo: 60, fireCooldown: 0,
            // Weapon stats. The server owns the rhythm of fire, so these live here and
            // are reported to the client rather than being assumed by it.
            magSize: 20, fireInterval: settings.fireInterval || 0.16, reloadSec: 1.8, reloadTimer: 0,
            posture: 'stand', lean: 0, eyeHeight: 64,
            stamina: { value: settings.stamina.max, delay: 0, exhausted: false }, input: null, sprinting: false,
            downed: false, downedHp: 0, downedTimer: 0, reviveProgress: 0, revivingTargetId: null };
        this.players.set(id, p);
        return this.snapshot();
    }
    input(id, command) {
        const p = this.players.get(id);
        // A closed raid accepts no intent at all. step() was guarded but input() was not, so a
        // client could still spawn projectiles into a finished match.
        if (this.state !== 'active') return false;
        const validPostures = ['stand', 'crouch', 'prone', 'crawling'];
        if (!p || !command || (command.version !== 1 && command.version !== PROTOCOL_VERSION) ||
            !Number.isSafeInteger(command.sequence) || command.sequence <= p.sequence ||
            !Number.isFinite(command.forward) || Math.abs(command.forward) > 1 ||
            !Number.isFinite(command.right) || Math.abs(command.right) > 1 ||
            !Number.isFinite(command.heading) || Math.abs(command.heading) > Math.PI ||
            typeof command.sprint !== 'boolean' ||
            (command.fire !== undefined && typeof command.fire !== 'boolean') ||
            (command.pitch !== undefined && (!Number.isFinite(command.pitch) || Math.abs(command.pitch) > Math.PI / 2)) ||
            (command.posture !== undefined && !validPostures.includes(command.posture)) ||
            (command.lean !== undefined && (!Number.isFinite(command.lean) || Math.abs(command.lean) > 1))) return false;
        // Whitelist input. Client coordinates, dt, HP and inventory are never read.
        p.input = {
            forward: command.forward,
            right: command.right,
            heading: command.heading,
            pitch: command.pitch || 0,
            sprint: p.downed ? false : command.sprint,
            fire: p.downed ? false : !!command.fire,
            posture: p.downed ? 'crawling' : (command.posture || p.posture || 'stand'),
            lean: command.lean !== undefined ? command.lean : (p.lean || 0),
            reviveTarget: typeof command.reviveTarget === 'string' ? command.reviveTarget : null,
        };
        p.sequence = command.sequence;
        p.inputTick = this.tick;
        p.posture = p.input.posture;
        p.lean = p.input.lean;
        const postureMods = rules.getPostureModifiers ? rules.getPostureModifiers(p.posture) : { eyeHeight: 64, speedMult: 1.0 };
        p.height = p.downed ? 24 : (postureMods.eyeHeight || 64);
        p.eyeHeight = p.downed ? 24 : (postureMods.eyeHeight || 64);

        // The trigger is HELD STATE, not an event: firing is resolved on the simulation tick
        // in stepFiring(), so the weapon's rate of fire decides the rhythm. Firing here instead
        // tied the rate of fire to the network cadence, which is a bug and a cheat surface.
        return true;
    }
    // --- weapons -------------------------------------------------------------

    // The trigger is held state: the weapon fires at ITS OWN interval, independent of how often
    // input arrives. Resolving the trigger inside input() tied the rate of fire to the network
    // cadence (a 20 Hz client fired slower than a 60 Hz one) and let the client's send rate
    // decide damage output.
    stepFiring(dt) {
        for (const p of this.players.values()) {
            if (p.hp <= 0 || p.disconnected) continue;
            p.fireCooldown = Math.max(0, p.fireCooldown - dt);

            // Reloading is server-owned, like everything else about the weapon.
            if (p.reloadTimer > 0) {
                p.reloadTimer = Math.max(0, p.reloadTimer - dt);
                if (p.reloadTimer <= 0) {
                    const needed = p.magSize - p.ammo;
                    const moved = Math.min(needed, p.reserveAmmo);
                    p.ammo += moved;
                    p.reserveAmmo -= moved;
                    this.events.push({ type: 'reloaded', playerId: p.id, ammo: p.ammo, reserve: p.reserveAmmo, tick: this.tick });
                }
                continue;   // a weapon being reloaded cannot fire
            }

            const input = p.input;
            if (!input || !input.fire) continue;

            if (p.ammo <= 0) {
                // Empty magazine and a reserve to draw on: start a reload automatically.
                if (p.reserveAmmo > 0) this.startReload(p);
                continue;
            }
            if (p.fireCooldown > 0) continue;

            this.spawnPlayerShot(p);
            p.ammo--;
            p.fireCooldown = p.fireInterval || settings.fireInterval || 0.16;
            // A magazine that just ran dry begins reloading on its own, like the offline game.
            if (p.ammo <= 0 && p.reserveAmmo > 0) this.startReload(p);
        }
    }

    startReload(p) {
        if (!p || p.reloadTimer > 0) return false;
        if (p.ammo >= p.magSize || p.reserveAmmo <= 0) return false;
        p.reloadTimer = p.reloadSec || 1.8;
        p.input = p.input ? { ...p.input, fire: false } : null;   // a reload interrupts the burst
        this.events.push({ type: 'reload', playerId: p.id, seconds: p.reloadTimer, tick: this.tick });
        return true;
    }

    // One projectile from a player, aimed along the heading they reported.
    spawnPlayerShot(p) {
        const input = p.input;
        const pitch = input.pitch || 0;
        const cp = Math.cos(pitch);
        const speed = 4800;
        const baseEyeH = p.posture === 'crouch' ? 33 : p.posture === 'prone' ? 14 : 55;
        const muzzleH = (p.h || 0) + baseEyeH;
        const leanOffset = (input.lean || 0) * 18;
        const muzzleX = p.x - Math.sin(input.heading) * leanOffset;
        const muzzleY = p.y + Math.cos(input.heading) * leanOffset;
        const proj = shooterRules.createProjectile({
            id: 'p_' + p.id + '_' + (++this._projSeq),
            shooterId: p.id,
            x: muzzleX,
            y: muzzleY,
            h: muzzleH,
            vx: Math.cos(input.heading) * cp * speed,
            vy: Math.sin(input.heading) * cp * speed,
            vh: -Math.sin(pitch) * speed,
            damage: settings.damage || 34,
            gravity: 980,
            drag: 0.04,
            maxRange: 1400,
            headshotMultiplier: 1.8,
        });
        proj.hostile = false;   // fired BY a player: hurts machines and other players
        this.projectiles.set(proj.id, proj);
        this.events.push({ type: 'fire', shooterId: p.id, projId: proj.id, tick: this.tick });
        return proj;
    }

    // --- raid objectives & lifecycle ----------------------------------------

    // Drives, extraction and the raid clock. Everything here used to live in Game.js, which
    // meant the server could not tell a real extraction from a client's claim.
    stepObjectives(dt) {
        const secs = this.tick / TICK_RATE;
        const raidDuration = settings.raidDuration || 1200;
        const remaining = Math.max(0, raidDuration - secs);
        this.raidTimer = remaining;

        // The orbital barrage ends the raid for everyone still on the surface.
        if (remaining <= 0) {
            this.endRaid(false, 'barrage');
            return;
        }

        // A living player standing in a drive's radius picks it up once.
        const drives = this.map.drives || [];
        for (const p of this.players.values()) {
            if (p.hp <= 0 || p.disconnected) continue;
            for (const drive of drives) {
                const taken = this.takenDrives || (this.takenDrives = new Set());
                if (taken.has(drive.id)) continue;
                if (Math.hypot(p.x - drive.x, p.y - drive.y) <= (drive.radius || 48)) {
                    taken.add(drive.id);
                    this.collectedDrives++;
                    this.tally(p.id).drives++;
                    this.events.push({ type: 'drive', playerId: p.id, driveId: drive.id,
                        collected: this.collectedDrives, tick: this.tick });
                }
            }
        }

        const target = settings.lootTarget || 3;
        if (this.extractionState === 'locked' && this.collectedDrives >= target) {
            this.extractionState = 'available';
            this.events.push({ type: 'extractionAvailable', tick: this.tick });
        }

        // Extraction: available -> inbound -> boarding -> won. The timer is server-owned.
        const zone = this.map.extraction;
        if (this.extractionState === 'inbound') {
            this.inboundTimer = Math.max(0, this.inboundTimer - dt);
            if (this.inboundTimer <= 0) {
                this.extractionState = 'boarding';
                this.events.push({ type: 'extractionBoarding', tick: this.tick });
            }
        } else if (this.extractionState === 'boarding') {
            for (const p of this.players.values()) {
                if ((p.hp <= 0 && !p.downed) || p.disconnected) continue;
                const inZone = Math.hypot(p.x - zone.x, p.y - zone.y) <= (zone.radius || 130);
                // An extraction is contested while a machine stands in the zone.
                const contested = [...this.enemies.values()].some(e => e.hp > 0 && e.state !== 'dormant' &&
                    Math.hypot(e.x - zone.x, e.y - zone.y) <= (zone.radius + 20));
                if (inZone && !contested) {
                    this.boardingProgress += dt;
                    if (this.boardingProgress >= 6) {
                        this.extracted.add(p.id);
                        this.events.push({ type: 'extracted', playerId: p.id, tick: this.tick });
                    }
                }
            }
            // The raid is won when at least one player boarded and nobody is still waiting.
            const active = [...this.players.values()].filter(p => (p.hp > 0 || p.downed) && !p.disconnected);
            const waiting = active.filter(p => !this.extracted.has(p.id));
            if (this.extracted.size > 0 && waiting.length === 0) {
                this.endRaid(true, 'extraction');
                return;
            }
        }

        // Everyone dead or downed (no standing players) ends the raid as a loss.
        const standing = [...this.players.values()].filter(p => p.hp > 0 && !p.downed && !p.disconnected);
        if (this.players.size > 0 && standing.length === 0) {
            this.endRaid(false, 'wipe');
        }
    }

    // Close the raid once. Idempotent: a second call cannot overwrite the first outcome.
    endRaid(won, reason) {
        if (this.state !== 'active') return this.outcome;
        this.state = 'ended';
        this.outcome = {
            won: !!won,
            reason,
            atTick: this.tick,
            survivors: [...this.extracted],
            casualties: [...this.casualties],
            drives: this.collectedDrives,
            // Per-player combat results, frozen at the moment the raid ended. A payout reads
            // these instead of re-deriving them from the event log, which is pruned.
            tallies: Object.fromEntries([...this.tallies].map(([id, t]) => [id, { ...t }])),
            at: Date.now(),
        };
        this.events.push({ type: 'raidEnd', won: this.outcome.won, reason, tick: this.tick });
        return this.outcome;
    }

    // A player gives up: their raid is over regardless of where they are standing. The server
    // records the casualty so the settlement cannot be claimed as a clean extraction.
    surrender(playerId) {
        const p = this.players.get(playerId);
        if (!p) return { ok: false, error: 'no-player' };
        if (this.state !== 'active') return { ok: false, error: 'raid-over' };
        if (p.hp <= 0 && !p.downed) return { ok: false, error: 'already-dead' };
        p.downed = false;
        p.hp = 0;
        p.input = null;
        this.casualties.add(playerId);
        this.tally(playerId).deaths++;
        this.events.push({ type: 'surrender', playerId, tick: this.tick });
        this.events.push({ type: 'kill', killerId: null, victimId: playerId, reason: 'surrender', tick: this.tick });
        // A wipe or a solo surrender closes the raid immediately.
        const standing = [...this.players.values()].filter(x => x.hp > 0 && !x.downed && !x.disconnected);
        if (standing.length === 0) this.endRaid(false, 'surrender');
        return { ok: true, ended: this.state === 'ended', outcome: this.outcome };
    }

    // Search a loot crate. Range and line of sight are checked HERE, against the server's own
    // map — a client cannot reach a crate it is not standing next to, and a crate cannot be
    // looted twice. This is what makes the extracted value, and therefore the payout, real.
    search(playerId, containerId) {
        const p = this.players.get(playerId);
        if (!p) return { ok: false, error: 'no-player' };
        if (this.state !== 'active') return { ok: false, error: 'raid-over' };
        if (p.hp <= 0) return { ok: false, error: 'already-dead' };
        const crate = this.containers.find(c => c.id === containerId);
        if (!crate) return { ok: false, error: 'no-container' };
        if (crate.opened) return { ok: false, error: 'already-searched' };

        const range = settings.interactRange || 90;
        if (Math.hypot(p.x - crate.x, p.y - crate.y) > (crate.radius || 48) + range) {
            return { ok: false, error: 'out-of-range' };
        }
        // A crate cannot be looted through a tank or a wall. The client refuses that, so the
        // authoritative side has to refuse it too, or only a modified client could do it.
        if (shooterRules && typeof shooterRules.hasLineOfSight === 'function') {
            const cover = this.blockers.filter(b => !(Math.abs(b.x - crate.x) < 1e-6 && Math.abs(b.y - crate.y) < 1e-6));
            if (!shooterRules.hasLineOfSight(p, crate, cover)) return { ok: false, error: 'blocked' };
        }

        // The contents mirror the client's table: same seed, same rule, same values.
        const type = shooterRules && shooterRules.rollLoot ? shooterRules.rollLoot(this.seed, crate.id) : 'scrap';
        const value = LOOT_VALUE[type] || 35;
        crate.opened = true;

        let taken = true;
        if (type !== 'ammo' && type !== 'medkit') {
            // A full backpack leaves the crate untouched, exactly like the offline game.
            const capacity = settings.backpackSlots || 6;
            const carried = this.carried.get(playerId) || 0;
            if (carried >= capacity) taken = false;
            else this.carried.set(playerId, carried + 1);
        }
        if (taken) {
            this.lootValue += value;
            this.tally(playerId).loot = (this.tally(playerId).loot || 0) + value;
            this.events.push({ type: 'loot', playerId, containerId: crate.id, lootType: type, value, tick: this.tick });
        } else {
            crate.opened = false;   // nothing was taken, so the crate stays searchable
            this.events.push({ type: 'lootFull', playerId, containerId: crate.id, tick: this.tick });
        }
        return { ok: true, taken, type, value };
    }

    // Call the transport or open the hatch. Server-validated: range and keys are checked here,
    // never asserted by the client.
    requestExtraction(playerId) {
        const p = this.players.get(playerId);
        if (!p || p.hp <= 0) return { ok: false, error: 'no-player' };
        if (this.state !== 'active') return { ok: false, error: 'raid-over' };
        if (this.extractionState !== 'available') return { ok: false, error: 'not-available' };
        const zone = this.map.extraction;
        if (Math.hypot(p.x - zone.x, p.y - zone.y) > (zone.radius || 130)) {
            return { ok: false, error: 'out-of-range' };
        }
        this.extractionState = 'inbound';
        this.inboundTimer = 15;
        this.events.push({ type: 'extractionCalled', playerId, tick: this.tick });
        return { ok: true, state: this.extractionState, inbound: this.inboundTimer };
    }

    step() {
        const dt = 1 / TICK_RATE;
        this.tick++;
        // A finished raid is frozen: no movement, no bullets, no machines. Clients keep
        // polling and keep receiving the same outcome until the room is collected.
        if (this.state !== 'active') return;
        for (const p of this.players.values()) {
            // A dropped player keeps their body but not their input. A DEAD one keeps neither:
            // without the hp check a killed player carried on walking around the map (and could
            // still reach drives), so "dead" was only a HUD state, not a game state.
            if (p.disconnected) continue;
            if (p.hp <= 0 && !p.downed) {
                // Truly dead corpse
                if (p.shieldCooldown > 0) p.shieldCooldown = Math.max(0, p.shieldCooldown - dt);
                continue;
            }
            if (p.downed) {
                p.downedTimer = Math.max(0, p.downedTimer - dt);
                if (p.downedTimer <= 0 || p.downedHp <= 0) {
                    p.downed = false;
                    p.hp = 0;
                    this.casualties.add(p.id);
                    this.tally(p.id).deaths++;
                    this.events.push({ type: 'bleedout', playerId: p.id, tick: this.tick });
                    this.events.push({ type: 'kill', killerId: null, victimId: p.id, reason: 'bleedout', tick: this.tick });
                    continue;
                }
                // Downed player can crawl slowly
                if (this.tick - p.inputTick > TICK_RATE / 2) p.input = null;
                const input = p.input || { forward: 0, right: 0, heading: p.heading, pitch: 0, sprint: false, posture: 'crawling' };
                p.heading = input.heading;
                p.posture = 'crawling';
                p.height = 24;
                p.eyeHeight = 24;
                p.h = this.heightAt(p.x, p.y);
                const moving = Math.hypot(input.forward, input.right) > 0.05;
                if (moving) {
                    const crawlSpeedMult = 0.32; // ~35 px/s
                    const moveSettings = { ...settings, walkSpeed: (settings.walkSpeed || 110) * crawlSpeedMult, postureSpeedMult: 1.0 };
                    rules.movePlayer(p, input, false, dt, moveSettings, this.blockers, this);
                }
                continue;
            }

            // Normal living player:
            if (p.shieldCooldown > 0) p.shieldCooldown = Math.max(0, p.shieldCooldown - dt);
            else if (p.shield < p.maxShield) p.shield = Math.min(p.maxShield, p.shield + 20 * dt);

            if (this.tick - p.inputTick > TICK_RATE / 2) p.input = null;
            const input = p.input || { forward: 0, right: 0, heading: p.heading, pitch: p.pitch, sprint: false, posture: p.posture || 'stand', lean: p.lean || 0 };
            const moving = Math.hypot(input.forward, input.right) > 0.05;
            const wantSprint = moving && input.forward > 0 && input.sprint && p.posture !== 'prone';
            p.sprinting = rules.tickStamina(p.stamina, wantSprint, dt, settings.stamina);
            p.heading = input.heading;
            p.pitch = input.pitch || 0;
            const pMods = rules.getPostureModifiers ? rules.getPostureModifiers(p.posture) : { speedMult: 1.0, eyeHeight: 64 };
            p.height = pMods.eyeHeight || 64;
            p.eyeHeight = pMods.eyeHeight || 64;
            // The player walks ON the terrain: the server recomputes the ground height every
            // tick from the same analytic curve the client renders (invariant 4).
            p.h = this.heightAt(p.x, p.y);
            if (moving) {
                const moveSettings = { ...settings, postureSpeedMult: pMods.speedMult ?? 1.0 };
                rules.movePlayer(p, input, p.sprinting, dt, moveSettings, this.blockers, this);
            }

            // Field Revive handling
            if (input && input.reviveTarget) {
                const target = this.players.get(input.reviveTarget);
                if (target && target.downed && !target.disconnected) {
                    const dist = Math.hypot(p.x - target.x, p.y - target.y);
                    if (dist <= 75) {
                        p.revivingTargetId = target.id;
                        target.reviveProgress = (target.reviveProgress || 0) + dt;
                        if (target.reviveProgress >= 5.0) {
                            target.downed = false;
                            target.hp = 30;
                            target.shield = 0;
                            target.posture = 'crouch';
                            target.reviveProgress = 0;
                            p.revivingTargetId = null;
                            this.events.push({ type: 'playerRevived', targetId: target.id, reviverId: p.id, tick: this.tick });
                        }
                    } else {
                        p.revivingTargetId = null;
                    }
                } else {
                    p.revivingTargetId = null;
                }
            } else {
                p.revivingTargetId = null;
            }
        }

        // Decay reviveProgress for downed players who are not currently being revived
        for (const p of this.players.values()) {
            if (p.downed && p.reviveProgress > 0) {
                const beingRevived = [...this.players.values()].some(pl => pl.revivingTargetId === p.id);
                if (!beingRevived) {
                    p.reviveProgress = Math.max(0, p.reviveProgress - dt * 1.5);
                }
            }
        }

        this.stepEnemies(dt);
        this.stepFiring(dt);
        this.stepObjectives(dt);

        // Authoritative ballistics step
        if (this.projectiles.size > 0) {
            const livingPlayers = [...this.players.values()].filter(p => p.hp > 0 || p.downed);
            const livingEnemies = [...this.enemies.values()].filter(e => e.hp > 0);
            for (const [id, proj] of this.projectiles) {
                // Who may be hit, and which damage model applies. `hostile` is recorded on the
                // projectile when it is created — inferring it from the sign of shooterId
                // broke for players, whose ids are opaque strings, so a player shot against a
                // player was treated as a machine hit and skipped shields entirely.
                const hostile = !!proj.hostile;
                const targets = hostile
                    ? livingPlayers
                    : livingEnemies.concat(livingPlayers.filter(p => p.id !== proj.shooterId));
                // Terrain blocks bullets too; without heightAt a shot flies through every hill.
                const hit = shooterRules.stepProjectile(proj, dt, targets, this.blockers, this.heightAt);
                if (hit.hit) {
                    if (hit.type === 'actor') {
                        const target = hit.target;
                        // Who the bullet belongs to decides the damage model, NOT the victim's
                        // shape: a machine shot hits a PLAYER (shields first), a player shot
                        // hits a MACHINE (no shields). Testing for maxHp got this backwards
                        // because players also carry maxHp, which silently bypassed shields.
                        // Which damage model applies is decided by the VICTIM, not the
                        // shooter: a human takes shield-then-HP damage whoever fired, a
                        // machine takes plain HP damage. Keying off the projectile owner broke
                        // player-vs-player, and keying off maxHp broke shields.
                        const victimIsPlayer = this.players.has(target.id);
                        if (victimIsPlayer) {
                            if (target.downed) {
                                // Downed player: damage goes directly to downedHp
                                target.downedHp = Math.max(0, target.downedHp - hit.damage);
                                this.events.push({
                                    type: 'hit',
                                    shooterId: proj.shooterId,
                                    targetId: target.id,
                                    damage: hit.damage,
                                    shieldDamage: 0,
                                    hpDamage: hit.damage,
                                    headshot: !!hit.headshot,
                                    point: hit.point,
                                    tick: this.tick,
                                });
                                if (target.downedHp <= 0) {
                                    target.downed = false;
                                    target.hp = 0;
                                    this.casualties.add(target.id);
                                    this.tally(target.id).deaths++;
                                    if (typeof proj.shooterId === 'string' && proj.shooterId !== target.id) {
                                        this.tally(proj.shooterId).playerKills++;
                                    }
                                    this.events.push({
                                        type: 'kill',
                                        killerId: proj.shooterId,
                                        victimId: target.id,
                                        headshot: !!hit.headshot,
                                        tick: this.tick,
                                    });
                                }
                            } else {
                                // Standing player: shields absorb first, exactly like offline play.
                                const dmgResult = rules.applyDamage ? rules.applyDamage(target, hit.damage) : { dealtToShield: 0, dealtToHp: hit.damage };
                                if (!rules.applyDamage) target.hp = Math.max(0, target.hp - hit.damage);
                                target.shieldCooldown = 4.5;
                                this.events.push({
                                    type: 'hit',
                                    shooterId: proj.shooterId,
                                    targetId: target.id,
                                    damage: hit.damage,
                                    shieldDamage: dmgResult.dealtToShield,
                                    hpDamage: dmgResult.dealtToHp,
                                    headshot: !!hit.headshot,
                                    point: hit.point,
                                    tick: this.tick,
                                });
                                if (target.hp <= 0) {
                                    const otherStanding = [...this.players.values()].filter(p => p.id !== target.id && p.hp > 0 && !p.downed && !p.disconnected);
                                    if (otherStanding.length > 0) {
                                        // Enter DBNO!
                                        target.downed = true;
                                        target.downedHp = 100;
                                        target.downedTimer = 60.0;
                                        target.hp = 0;
                                        target.shield = 0;
                                        target.posture = 'crawling';
                                        this.events.push({
                                            type: 'playerDowned',
                                            playerId: target.id,
                                            killerId: proj.shooterId,
                                            tick: this.tick,
                                        });
                                    } else {
                                        // Instant death
                                        target.downed = false;
                                        target.hp = 0;
                                        this.casualties.add(target.id);
                                        this.tally(target.id).deaths++;
                                        if (typeof proj.shooterId === 'string' && proj.shooterId !== target.id) {
                                            this.tally(proj.shooterId).playerKills++;
                                        }
                                        this.events.push({
                                            type: 'kill',
                                            killerId: proj.shooterId,
                                            victimId: target.id,
                                            headshot: !!hit.headshot,
                                            tick: this.tick,
                                        });
                                    }
                                }
                            }
                        } else {
                            // Machine victim: no shields, but the server still owns the HP.
                            target.hp = Math.max(0, target.hp - hit.damage);
                            target.state = 'engage';
                            target.alert = 1;
                            this.events.push({
                                type: 'enemyHit',
                                shooterId: proj.shooterId,
                                enemyId: target.id,
                                damage: hit.damage,
                                hp: target.hp,
                                headshot: !!hit.headshot,
                                point: hit.point,
                                tick: this.tick,
                            });
                            if (target.hp <= 0) {
                                // Credit the shooter's tally. `shooterId` is a player id string for
                                // player fire and a number for machine fire, so only a real player
                                // scores — a machine must never be credited with a kill.
                                if (typeof proj.shooterId === 'string' && this.players.has(proj.shooterId)) {
                                    this.tally(proj.shooterId).kills++;
                                }
                                this.events.push({
                                    type: 'enemyKill',
                                    killerId: proj.shooterId,
                                    enemyId: target.id,
                                    archetype: target.archetype,
                                    headshot: !!hit.headshot,
                                    tick: this.tick,
                                });
                            }
                        }
                    } else {
                        this.events.push({
                            type: 'impact',
                            shooterId: proj.shooterId,
                            targetType: hit.type,
                            point: hit.point,
                            normal: hit.normal,
                            tick: this.tick,
                        });
                    }
                    this.projectiles.delete(id);
                } else if (hit.expired) {
                    this.projectiles.delete(id);
                }
            }
        }

        if (this.events.length > 60) {
            this.events.splice(0, this.events.length - 60);
        }
    }
    snapshot() {
        return {
            version: PROTOCOL_VERSION,
            tick: this.tick,
            players: [...this.players.values()].map(p => ({
                id: p.id,
                x: p.x,
                y: p.y,
                h: p.h,
                heading: p.heading,
                pitch: p.pitch,
                hp: p.hp,
                shield: p.shield,
                maxShield: p.maxShield,
                ammo: p.ammo,
                // The client renders the magazine and reserve from these; it must not
                // invent them, or a reload would spend rounds the server never had.
                reserveAmmo: p.reserveAmmo,
                magSize: p.magSize,
                reloadTimer: p.reloadTimer,
                fireInterval: p.fireInterval,
                posture: p.posture,
                lean: p.lean,
                height: p.height,
                sequence: p.sequence,
                stamina: { ...p.stamina },
                sprinting: p.sprinting,
                disconnected: !!p.disconnected,
                downed: !!p.downed,
                downedHp: p.downedHp || 0,
                downedTimer: p.downedTimer || 0,
                reviveProgress: p.reviveProgress || 0,
                revivingTargetId: p.revivingTargetId || null,
            })),
            projectiles: [...this.projectiles.values()].map(p => ({
                id: p.id,
                shooterId: p.shooterId,
                x: p.x,
                y: p.y,
                h: p.h,
                vx: p.vx,
                vy: p.vy,
                vh: p.vh,
            })),
            // The garrison. Clients render machines from this list; they never decide where
            // a machine is or whether it is alive.
            enemies: [...this.enemies.values()].map(e => ({
                id: e.id,
                archetype: e.archetype,
                x: e.x,
                y: e.y,
                h: e.h,
                heading: e.heading || 0,
                hp: e.hp,
                maxHp: e.maxHp,
                state: e.state,
                alert: e.alert,
            })),
            // Raid objectives are server state: a client must not invent a looted drive.
            objective: {
                drives: this.map.drives.length,
                collected: this.collectedDrives || 0,
                target: settings.lootTarget || 3,
                extraction: this.map.extraction,
                hatch: this.map.hatch,
                raidTimer: this.raidTimer != null
                    ? this.raidTimer
                    : Math.max(0, (settings.raidDuration || 1200) - this.tick / TICK_RATE),
                extractionState: this.extractionState,
                inboundTimer: this.inboundTimer,
                boardingProgress: this.boardingProgress,
                contested: this.extractionState === 'boarding' && [...this.enemies.values()]
                    .some(e => e.hp > 0 && e.state !== 'dormant'
                        && Math.hypot(e.x - this.map.extraction.x, e.y - this.map.extraction.y) <= (this.map.extraction.radius + 20)),
                remainingMachines: [...this.enemies.values()].filter(e => e.hp > 0).length,
            },
            // The raid's own state and, once it is over, the single outcome every client reads.
            state: this.state,
            outcome: this.outcome,
            disconnected: [...this.disconnected.keys()],
            events: this.events.slice(-15),
        };
    }
}
