// OnlineBridge.js — the one place where the authoritative server meets the rendered game.
//
// WHY THIS FILE EXISTS. The server has broadcast players, machines, objectives and the raid
// outcome for a while, but `Game.js` never read `onlineClient`: an online raid looked exactly
// like a solo raid with a shared clock. Rather than threading network code through a 4600-line
// game file (which another session is actively editing), the whole integration lives here and
// `Game.js` calls exactly three methods.
//
// THREE RESPONSIBILITIES, and nothing else:
//   1. SEND INTENT. Each frame the local input becomes one `/input` command. The client never
//      sends a position, an HP value or a kill: the server owns all of that.
//   2. APPLY TRUTH. A snapshot overwrites the local player, the garrison, the objectives and
//      the raid state. Local prediction is deliberately absent for now, so there is nothing
//      to reconcile — the server simply wins.
//   3. RENDER PEERS. Every other player in the snapshot gets a body in the scene, interpolated
//      between the last two snapshots so remote movement is smooth at 60 fps even though
//      snapshots arrive far less often.
//
// Everything degrades safely: with no client, no server or a failed request the game keeps
// running exactly as it does offline (invariant 6 applied to the network).

/** @satisfies {Record<string, any>} */
const OnlineBridge = {
    // Snapshot cadence and interpolation window. Tuned for a 20 Hz poll at 60 fps render.
    SEND_HZ: 20,
    POLL_HZ: 20,
    // Remote bodies ease toward their target; 0 disables interpolation (snap).
    INTERP: 0.35,
    // How long a peer is kept after its last snapshot before the body is removed.
    PEER_TIMEOUT_MS: 3000,
    // Jitter buffer depth, in snapshots. Rendering one sample BEHIND the newest one absorbs a
    // late or reordered packet: a link with variable latency otherwise makes remote bodies
    // stutter, because the ease restarts from a stale position every time a snapshot lands.
    // 2 is the smallest depth that hides one missing packet at the 20 Hz snapshot rate.
    JITTER_SAMPLES: 2,
    // Cap on buffered samples per peer: a stalled link must not grow without limit.
    JITTER_MAX_SAMPLES: 8,
    // How many world updates the server sends per second. The jitter buffer advances one
    // sample per 1/SNAPSHOT_HZ of real time, so this MUST match the server's push rate
    // (`PUSH_EVERY_TICKS` in server/main.mjs) or remote bodies walk at the wrong speed.
    SNAPSHOT_HZ: 20,
    // Client-side prediction: apply input immediately, then reconcile against the server.
    // ON by default; a mismatch rate above MISMATCH_LIMIT disables it automatically, because
    // a wrong prediction is worse than a delayed one.
    PREDICT: true,
    MAX_HISTORY: 120,
    MISMATCH_LIMIT: 400,
    MISMATCH_LIMIT_COUNT: 3,

    /**
     * @param {any} game the Game instance
     * @param {any} client a connected RaidClient, or null to detach
     */
    attach(game, client) {
        this.detach();
        if (!game || !client) return null;
        this.game = game;
        this.client = client;
        this.enabled = true;
        this.lastSend = 0;
        this.lastPoll = 0;
        this.error = null;
        this.pending = false;
        /** @type {Map<string, any>} playerId -> { mesh, x, y, h, heading, targetX, targetY, targetH, targetHeading, lastSeen, label } */
        this.peers = new Map();
        this.lastTick = -1;
        // A short history per peer lets us interpolate without guessing.
        /** @type {Map<string, any>} playerId -> last applied snapshot sample */
        this.applied = new Map();
        // --- prediction state ---
        this.prediction = this.PREDICT;
        /** @type {Array<{sequence: number, command: any, dt: number}>} unacknowledged input */
        this.history = [];
        this.lastCorrection = 0;
        this.maxCorrection = 0;
        this.mismatches = 0;
        this.latencyMs = 0;
        /** @type {any[]|null} cached collision set from the server's world */
        this.worldBlockers = null;
        /** @type {Map<string, any>} projectileId -> tracer visual (server-owned bullets) */
        this.projectiles = new Map();
        /** @type {Array<{mesh: any, life: number}>} short-lived muzzle flashes */
        this.flashes = [];
        // A raid settles at most once; a new attach means a new raid.
        this.settled = false;
        this.spectating = false;
        this.spectateTargetId = null;
        this.downed = false;
        this.downedHp = 0;
        this.downedTimer = 0;
        this.reviveProgress = 0;
        this.characterModel = null;
        this.characterPending = null;
        // A push transport removes the polling latency entirely: the server sends the world as
        // it changes instead of waiting to be asked. Falls back to polling when unavailable.
        this.transport = 'http';
        if (client && typeof client.connectSocket === 'function') {
            client.onSnapshot = (message) => this.applyPush(message);
            client.onAction = (message) => {
                if (message && message.error) { this.error = message.error; return; }
                // A search reply carries what the crate actually held, decided by the server.
                if (message && message.action === 'search') this.applySearchResult(message);
            };
            // The server pushes its own payout. Recording it here means the client displays the
            // authoritative figure; `Game.finish` reads `onlinePayout` and does NOT add its own.
            client.onPayout = (payout) => this.applyPayout(payout);
            client.onMatched = (match) => this.applyMatch(match);
            client.connectSocket().then(ok => {
                if (ok) this.transport = 'ws';
            }).catch(() => { this.transport = 'http'; });
        }
        return this;
    },

    detach() {
        for (const peer of (this.peers ? this.peers.values() : [])) {
            if (peer.mesh && peer.mesh.dispose) peer.mesh.dispose();
        }
        if (this.peers) this.peers.clear();
        if (this.applied) this.applied.clear();
        this.game = null;
        this.client = null;
        this.enabled = false;
        this.pending = false;
        this.history = [];
        this.worldBlockers = null;
        this.spectating = false;
        this.spectateTargetId = null;
        this.downed = false;
        this.downedHp = 0;
        this.downedTimer = 0;
        this.reviveProgress = 0;
        for (const entry of (this.projectiles ? this.projectiles.values() : [])) this.disposeProjectile(entry);
        if (this.projectiles) this.projectiles.clear();
        for (const flash of (this.flashes || [])) { if (flash.mesh && flash.mesh.dispose) flash.mesh.dispose(); }
        if (this.flashes) this.flashes.length = 0;
        if (this.client && typeof this.client.closeSocket === 'function') this.client.closeSocket();
    },

    /** True when the bridge is live and the server is reachable. */
    active() {
        return !!(this.enabled && this.client && this.game && this.game.phase === 'raid');
    },

    // --- frame integration ---------------------------------------------------

    /**
     * Called from Game.update BEFORE the local simulation. Sends intent and applies the
     * newest snapshot. Safe to call every frame; the network work is rate limited internally.
     * @param {number} dt seconds
     */
    update(dt) {
        if (!this.enabled || !this.client || !this.game) return;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (this.game.phase === 'raid') {
            if (this.spectating) {
                // When spectating, do not predict or send active movement/fire intent.
                // Transmit neutral keepalive on cadence so server keeps the connection alive.
                if (this.lastSend === 0 || now - this.lastSend >= 1000 / this.SEND_HZ) {
                    this.lastSend = now || 1;
                    this.sendIntent({
                        forward: 0, right: 0, heading: 0, sprint: false, fire: false, pitch: 0, posture: 'stand', lean: 0
                    });
                }
                const live = typeof this.client.isLive === 'function' && this.client.isLive();
                if (!live && now - this.lastPoll >= 1000 / this.POLL_HZ && !this.pending) {
                    this.lastPoll = now;
                    this.poll();
                }
                this.interpolatePeers(dt);
                this.interpolateProjectiles(dt);
                this.updateFlashes(dt);
                return;
            }

            // PREDICT EVERY FRAME, SEND AT THE PROTOCOL RATE. Prediction used to happen only
            // inside sendIntent, so the local player advanced in 50 ms steps while the world
            // rendered at 60 fps — the "choppy, snapping" movement that was reported. The
            // command is built once here, applied locally now, and transmitted on the cadence.
            // PREDICTION MUST MATCH WHAT THE SERVER SIMULATES. The server advances a body by
            // ONE send interval per command, so predicting a frame's worth of dt per frame
            // made the client walk faster than the server and then get yanked back — the
            // choppy feeling. Input is therefore accumulated here and applied in exact
            // SEND_HZ-sized steps, which is the same amount of time the command carries.
            const command = this.buildCommand();
            if (command) this.currentCommand = command;

            // TRANSMIT FIRST, THEN PREDICT. The send creates the history entry that this frame's
            // time is accumulated onto. Doing it the other way round lost the very first frame:
            // the entry did not exist yet, so replay used 0.083 s for 6 frames of movement and
            // the client landed 4 px away from where it had predicted — a permanent, invisible
            // disagreement between the client and the server.
            // The first command goes out immediately: `lastSend` starts at 0, and against a
            // small clock (`performance.now()` shortly after page load, or a vm test) the
            // interval check would otherwise swallow the first ~50 ms of input.
            if (this.lastSend === 0 || now - this.lastSend >= 1000 / this.SEND_HZ) {
                this.lastSend = now || 1;
                this.sendIntent(command);
            }

            // PREDICT AT THE SIMULATION RATE, NOT THE SEND RATE. The server applies the last
            // received command on EVERY 60 Hz tick until a newer one arrives (it is persistent
            // input, not a one-shot event), so predicting per frame is what matches authority.
            if (command && this.prediction) {
                this.predict(command, dt);
                // The newest command stays ACTIVE until a newer one replaces it, and the server
                // applies it on every tick in between. Its accumulated age is exactly what
                // reconciliation replays, so the totals match by construction.
                const active = this.history[this.history.length - 1];
                if (active) active.dt += dt;
            }
            // Polling is the fallback only: with a live socket the server pushes instead, so
            // asking for state as well would double the traffic and the reconciliation work.
            const live = typeof this.client.isLive === 'function' && this.client.isLive();
            if (!live && now - this.lastPoll >= 1000 / this.POLL_HZ && !this.pending) {
                this.lastPoll = now;
                this.poll();
            }
        }
        this.interpolatePeers(dt);
        this.interpolateProjectiles(dt);
        this.updateFlashes(dt);
    },

    // --- outbound -------------------------------------------------------------

    // Build ONE command from the local frame state. Only intent: axes, heading, trigger,
    // posture, lean. Nothing here reads or writes server-owned state.
    buildCommand() {
        const g = this.game;
        if (!g) return null;
        if (this.spectating) {
            return {
                forward: 0,
                right: 0,
                heading: 0,
                sprint: false,
                fire: false,
                pitch: 0,
                posture: 'stand',
                lean: 0,
                reviveTarget: null,
            };
        }
        const cam = g.app?.camera;
        if (this.downed) {
            const movement = (typeof RaidRules !== 'undefined' && RaidRules.movement)
                ? RaidRules.movement(g.keys || new Set(), g.touchMove || {})
                : { forward: 0, right: 0 };
            const heading = cam && typeof cam.azimuth === 'number' ? cam.azimuth : 0;
            return {
                forward: clampAxis(movement.forward),
                right: clampAxis(movement.right),
                heading: clampHeading(heading),
                sprint: false,
                fire: false,
                pitch: 0,
                posture: 'crawling',
                lean: 0,
                reviveTarget: null,
            };
        }
        try {
            const movement = (typeof RaidRules !== 'undefined' && RaidRules.movement)
                ? RaidRules.movement(g.keys || new Set(), g.touchMove || {})
                : { forward: 0, right: 0 };
            // The movement direction comes from the CAMERA, not from a stored heading: in an
            // online raid the local updatePlayer is skipped (the server owns the body), and that
            // is where `player.heading = camera.azimuth` used to happen. The heading therefore
            // froze at deploy time and W walked along a stale axis wherever the player looked.
            const heading = cam && typeof cam.azimuth === 'number' ? cam.azimuth : 0;
            const nearbyDowned = this.findNearbyDownedPeer();
            const wantRevive = !!(nearbyDowned && (g.keys?.has?.('KeyE') || g.keys?.has?.('KeyF')));
            return {
                forward: clampAxis(movement.forward),
                right: clampAxis(movement.right),
                heading: clampHeading(heading),
                sprint: !!g.keys?.has?.('ShiftLeft') || !!g.keys?.has?.('ShiftRight'),
                fire: !!g.firing,
                pitch: clampPitch(cam ? cam.pitch : 0),
                posture: g.posture || 'stand',
                lean: clampAxis(g.lean || 0),
                reviveTarget: wantRevive ? nearbyDowned.id : null,
            };
        } catch (err) {
            this.error = String(err && err.message || err);
            return null;
        }
    },

    findNearbyDownedPeer(maxDistance = 75) {
        if (!this.peers || !this.game?.player) return null;
        const myX = this.game.player.x;
        const myY = this.game.player.y;
        let closest = null;
        let closestDist = maxDistance;
        for (const peer of this.peers.values()) {
            if (peer.downed && !peer.disconnected) {
                const d = Math.hypot((peer.x || 0) - myX, (peer.y || 0) - myY);
                if (d <= closestDist) {
                    closest = peer;
                    closestDist = d;
                }
            }
        }
        return closest;
    },

    // Transmit the command built for this frame. `command` is passed in so the SENT command is
    // byte-identical to the one that was predicted locally: rebuilding it here would send a
    // slightly different heading if the camera moved between the two calls, and the server
    // would then correct a step the player never took.
    sendIntent(command) {
        const client = this.client;
        const cmd = command || this.buildCommand();
        if (!client || !cmd) return;
        try {
            // The batch being transmitted is exactly what reconciliation replays until the
            // server acknowledges it. `dt` is the send interval, not the frame time, because
            // that is the amount of time this command represents on the server.
            const sequence = client.sequence;
            if (this.prediction) {
                // Zero age at first: the command has not been "active" for any time yet. The
                // update loop grows it while it stays the newest command.
                this.history.push({ sequence, command: cmd, dt: 0 });
                if (this.history.length > this.MAX_HISTORY) this.history.shift();
            }
            // Prefer the push transport; it also removes a request per tick from the server.
            if (typeof client.sendInputSocket === 'function') {
                const sent = client.sendInputSocket(cmd);
                if (sent && sent.catch) sent.catch(err => { this.error = String(err && err.message || err); });
            } else {
                client.sendInput(cmd).catch(err => { this.error = String(err && err.message || err); });
            }
        } catch (err) {
            this.error = String(err && err.message || err);
        }
    },

    // --- prediction -----------------------------------------------------------

    // Apply a command to the LOCAL player immediately, using the SAME shared rule the server
    // runs. This is what removes the round-trip delay: the player moves on the frame the key
    // is pressed, and the server's later snapshot corrects the result rather than replacing it.
    //
    // Only movement and posture are predicted. Health, ammo, kills and loot are never guessed:
    // predicting those would show a hit the server may not agree with.
    predict(command, dt) {
        const g = this.game;
        if (!g || !g.player) return;
        if (typeof RaidRules === 'undefined' || !RaidRules.movePlayer) return;
        const p = g.player;
        const moving = Math.hypot(command.forward, command.right) > 0.05;
        // Stamina is server-owned; predict only whether sprinting is currently possible so the
        // speed matches without inventing a stamina value.
        const wantSprint = moving && command.forward > 0 && command.sprint && command.posture !== 'prone';
        const postureMods = RaidRules.getPostureModifiers
            ? RaidRules.getPostureModifiers(command.posture)
            : { speedMult: 1, eyeHeight: 64 };
        const before = { x: p.x, y: p.y };
        if (moving) {
            const settings = this.moveSettings(postureMods.speedMult, wantSprint);
            RaidRules.movePlayer(p, command, wantSprint, dt, settings, this.blockers(), this.bounds());
        }
        // Terrain height is analytic and identical on both sides, so it can be predicted.
        if (typeof RaidWorld !== 'undefined' && RaidWorld.heightAt) {
            p.h = RaidWorld.heightAt(p.x, p.y);
        }
        if (typeof command.heading === 'number') p.heading = command.heading;
        // Remember the delta for diagnostics: a large, repeated mismatch means the prediction
        // disagrees with the server rules and the bridge would be better with prediction off.
        this.lastPredictedDelta = Math.hypot(p.x - before.x, p.y - before.y);
    },

    // The movement constants the server uses, taken from the SAME numbers when available.
    moveSettings(postureSpeedMult, sprinting) {
        const U = 'undefined';
        const speed = typeof GAME_PLAYER_SPEED !== U ? GAME_PLAYER_SPEED : 260;
        const radius = typeof GAME_PLAYER_RADIUS !== U ? GAME_PLAYER_RADIUS : 24;
        return { speed, radius, sprintMult: sprinting ? 1.35 : 1, postureSpeedMult };
    },

    // The collision set the server arbitrates on: the world the client fetched from /world,
    // falling back to the local map when the fetch failed.
    blockers() {
        if (this.worldBlockers) return this.worldBlockers;
        const world = this.client && this.client.world;
        if (world && Array.isArray(world.cover)) this.worldBlockers = world.cover;
        else if (world && Array.isArray(world.blockers)) this.worldBlockers = world.blockers;
        else this.worldBlockers = [];
        return this.worldBlockers;
    },

    bounds() {
        const world = this.client && this.client.world;
        if (world && world.width) return { width: world.width, height: world.height };
        const U = 'undefined';
        return {
            width: typeof LOCATION_WIDTH !== U ? LOCATION_WIDTH : 4096,
            height: typeof LOCATION_HEIGHT !== U ? LOCATION_HEIGHT : 4096,
        };
    },

    // --- inbound --------------------------------------------------------------

    poll() {
        const client = this.client;
        if (!client) return;
        this.pending = true;
        client.poll()
            .then(snapshot => {
                this.pending = false;
                if (snapshot) this.applySnapshot(snapshot);
            })
            .catch(err => {
                this.pending = false;
                this.error = String(err && err.message || err);
            });
    },

    // Handle an authoritative snapshot pushed over the WebSocket transport. Same reconciliation
    // as the polling path: one code path, whichever transport delivered it.
    applyPush(message) {
        if (!message || !message.snapshot) return;
        this.latencyMs = typeof message.sentAt === 'number'
            ? Math.max(0, Date.now() - message.sentAt)
            : this.latencyMs;
        this.applySnapshot(message.snapshot);
    },

    /**
     * Overwrite local state with the server's. Nothing here is a suggestion: the server is
     * the only authority for position, health, machines and the raid state.
     * @param {any} snapshot
     */
    applySnapshot(snapshot) {
        const g = this.game;
        if (!g || !snapshot) return;
        if (typeof snapshot.tick === 'number' && snapshot.tick < this.lastTick) return;  // stale
        this.lastTick = snapshot.tick;

        // 1. The local player: position, health, shield, ammo, posture come from the server.
        const me = (snapshot.players || []).find(p => p.id === this.client.id);
        if (me) this.applyLocalPlayer(me);

        // 2. Objectives and the raid clock.
        if (snapshot.objective) this.applyObjective(snapshot.objective);

        // 3. The raid's own state. The outcome is the SERVER's decision, and the client must
        // ACT on it: before this, `onlineOutcome` was recorded and never read, so an online
        // raid could never end — no settlement screen, no return to the hub, ever.
        if (snapshot.state) g.onlineState = snapshot.state;
        if (snapshot.outcome) {
            g.onlineOutcome = snapshot.outcome;
            this.settleOnlineRaid(snapshot.outcome);
        }

        // 4. Machines. Positions are authoritative; the local AI must not fight them.
        if (Array.isArray(snapshot.enemies)) this.applyEnemies(snapshot.enemies);

        // 5. Peers.
        if (Array.isArray(snapshot.players)) this.applyPeers(snapshot.players);

        // 6. Bullets. Without this an online raid shows NO tracers at all: the local weapon is
        // silenced while the bridge is active (the server owns firing), so if the snapshot's
        // projectiles are not drawn, nobody's shots are visible — not even your own.
        if (Array.isArray(snapshot.projectiles)) this.applyProjectiles(snapshot.projectiles);

        // 7. Events are applied once each, then discarded.
        const events = this.client.drainEvents();
        if (events.length) this.applyEvents(events);
    },

    // Reconciliation, not teleportation. The snapshot is the truth AT THE MOMENT the server
// built it, which is one round trip in the past; the local player has already predicted
// several commands since. So: take the server position, then REPLAY every command the server
// has not acknowledged, using the same movement rule. The result is a local position that is
// authoritative in its base and smooth in its correction.
    applyLocalPlayer(me) {
        const p = this.game.player;
        if (!p) return;

        // Fields the server owns outright: never predicted, always overwritten.
        if (typeof me.hp === 'number') {
            p.hp = me.hp;
            this.downed = !!me.downed;
            this.downedHp = me.downedHp || 0;
            this.downedTimer = me.downedTimer || 0;
            this.reviveProgress = me.reviveProgress || 0;

            if (this.downed) {
                this.spectating = false;
                this.spectateTargetId = null;
            } else if (me.hp <= 0 && this.game && this.game.phase === 'raid' && !this.settled) {
                const alive = this.getAlivePeers();
                if (alive.length > 0) {
                    this.spectating = true;
                    if (!this.spectateTargetId || !alive.some(peer => peer.id === this.spectateTargetId)) {
                        this.spectateTargetId = alive[0].id;
                    }
                } else {
                    this.spectating = false;
                    this.spectateTargetId = null;
                }
            } else if (me.hp > 0) {
                this.spectating = false;
                this.spectateTargetId = null;
            }
        }
        if (typeof me.shield === 'number') p.shield = me.shield;
        if (typeof me.ammo === 'number') this.game.ammo = me.ammo;
        // The reserve, the magazine size and the reload timer are server-owned too: the client
        // must never move rounds between them itself, or a reload would spend ammunition the
        // server still has (the bug that emptied a whole reserve).
        if (typeof me.reserveAmmo === 'number') this.game.reserveAmmo = me.reserveAmmo;
        if (typeof me.magSize === 'number' && this.game.c) this.game.c.mag = me.magSize;
        if (typeof me.reloadTimer === 'number') this.game.reloadTimer = me.reloadTimer;
        if (typeof me.sprinting === 'boolean') this.game._onlineSprinting = me.sprinting;

        if (this.spectating) {
            p.x = me.x;
            p.y = me.y;
            p.h = me.h;
            this.history = [];
            return;
        }

        if (this.downed) {
            p.x = me.x;
            p.y = me.y;
            p.h = me.h;
            p.posture = 'crawling';
            this.game.posture = 'crawling';
            this.history = [];
            return;
        }

        const canPredict = this.prediction && typeof RaidRules !== 'undefined' && RaidRules.movePlayer;
        const acked = typeof me.sequence === 'number' ? me.sequence : -1;

        if (!canPredict) {
            // Prediction off: the server position is adopted verbatim (the pre-prediction path).
            p.x = me.x;
            p.y = me.y;
            p.h = me.h;
            if (typeof me.heading === 'number') p.heading = me.heading;
            if (typeof me.posture === 'string') this.game.posture = me.posture;
            if (typeof me.lean === 'number') this.game.lean = me.lean;
            return;
        }

        // Predicted fields: rewind to the server state, then replay unacknowledged input.
        // The correction is measured BEFORE the replay, while the client position is still the
        // pure prediction: after the replay the two have already converged, so measuring later
        // would hide exactly the mismatch this check exists to catch.
        const correction = Math.hypot(p.x - me.x, p.y - me.y);
        this.maxCorrection = Math.max(this.maxCorrection || 0, correction);
        this.lastCorrection = correction;
        // A correction far larger than a step means the prediction and the server disagree —
        // usually a rule mismatch, a map mismatch or a cheat. Guessing wrong is worse than
        // lagging, so prediction turns itself off and the client falls back to pure truth.
        // The count ACCUMULATES rather than requiring a streak: after one large rewind the
        // client is already back near the server position, so a second identical spike may
        // never arrive even though the underlying disagreement persists.
        if (correction > this.MISMATCH_LIMIT) {
            this.mismatches++;
            if (this.mismatches >= this.MISMATCH_LIMIT_COUNT) {
                this.prediction = false;
                this.error = 'prediction-disabled: correction ' + Math.round(correction);
            }
        }
        // NOTE: the count is NOT decremented on a small correction. After the first large
        // rewind the client already sits on the server position, so every following snapshot
        // looks fine (a few px) even though the disagreement persists — decrementing here reset
        // the counter each time and the valve never fired.

        p.x = me.x;
        p.y = me.y;
        p.h = me.h;
        if (typeof me.posture === 'string') this.game.posture = me.posture;
        if (typeof me.lean === 'number') this.game.lean = me.lean;

        // Drop everything the server has already applied.
        this.history = this.history.filter(entry => entry.sequence > acked);
        for (const entry of this.history) this.predict(entry.command, entry.dt);

        // Heading is presentation: follow the local camera immediately, since a stale heading
        // would make the weapon point the wrong way for the whole round trip.
        if (typeof me.heading === 'number' && !this.history.length) p.heading = me.heading;
    },

    applyObjective(objective) {
        const g = this.game;
        if (typeof objective.collected === 'number') g.loot = objective.collected;
        if (typeof objective.raidTimer === 'number') g.raidTimer = objective.raidTimer;
        if (typeof objective.extractionState === 'string') g.extractState = objective.extractionState;
        if (typeof objective.inboundTimer === 'number') g.inboundTimer = objective.inboundTimer;
        if (typeof objective.boardingProgress === 'number') g.extractProgress = objective.boardingProgress;
        if (typeof objective.contested === 'boolean') g.extractContested = objective.contested;
    },

    // The server tells us where every machine is. We do not run the local AI for them while
    // online, because two authority sources would fight and the machines would jitter.
    applyEnemies(enemies) {
        const g = this.game;
        if (!Array.isArray(g.enemies)) return;
        const byId = new Map(enemies.map(e => [e.id, e]));
        for (const enemy of g.enemies) {
            const remote = byId.get(enemy.id);
            if (!remote) continue;
            enemy.x = remote.x;
            enemy.y = remote.y;
            enemy.h = remote.h;
            enemy.hp = remote.hp;
            enemy.maxHp = remote.maxHp != null ? remote.maxHp : enemy.maxHp;
            enemy.state = remote.state || enemy.state;
            enemy.heading = remote.heading != null ? remote.heading : enemy.heading;
            if (remote.hp <= 0 && !enemy.dead) enemy.dead = true;
        }
    },

    // Hand the server's verdict to the game. Guarded so a repeated snapshot cannot settle the
    // same raid twice (the outcome is broadcast on every push until the room is collected).
    settleOnlineRaid(outcome) {
        const g = this.game;
        if (!outcome || this.settled) return;
        if (!g || g.phase !== 'raid') return;
        this.settled = true;
        // `finish` owns the whole local ending: phase, HUD, drop, settlement and menu handoff.
        if (typeof g.finish === 'function') {
            try { g.finish(!!outcome.won); return; }
            catch (err) { this.error = String(err && err.message || err); }
        }
        // Fallback: at least stop the raid so the player is not stuck in a closed world.
        g.phase = outcome.won ? 'won' : 'lost';
    },

    // The server's authoritative payout for the raid that just ended. The client shows these
    // numbers; it never computes a reward of its own while online.
    applyPayout(payout) {
        const g = this.game;
        if (!g || !payout) return;
        g.onlinePayout = payout;
        if (typeof payout.credits === 'number') g.onlineCredits = payout.credits;
        if (payout.stats) g.onlineStats = payout.stats;
        // A profile is present offline only; applying it here keeps the HUD in step with the
        // server without pretending the client decided anything.
        if (g.profile && typeof payout.credits === 'number') g.profile.credits = payout.credits;
        if (g.profile && payout.stats) {
            g.profile.extractions = payout.stats.extractions;
            g.profile.raids = payout.stats.raids;
        }
    },

    // The matchmaker formed a raid. Recorded so the client can act on it (deploy, reset the
    // world) instead of inferring it from a tick change.
    applyMatch(match) {
        const g = this.game;
        if (!g || !match) return;
        g.onlineMatch = match;
        if (typeof match.seed === 'number' && g.setRaidSeed) {
            try { g.setRaidSeed(match.seed); } catch (err) { /* the seed is cosmetic here */ }
        }
    },

    // The server's answer to a loot search. The ITEM and its VALUE come from here, never from
    // the local loot table: offline the client rolls its own, online the server has already
    // decided, and the payout is computed from the server's number.
    applySearchResult(message) {
        const g = this.game;
        if (!g || !message) return;
        if (!Array.isArray(g.containers)) return;
        const crate = g.containers.find(c => c.id === message.containerId);
        if (!crate) return;
        if (message.taken === false) {
            // A full backpack: the crate stays closed and searchable, exactly like offline.
            crate.opened = false;
            if (typeof g.showLootFeed === 'function') g.showLootFeed(crate.item, false);
            return;
        }
        crate.opened = true;
        // The visual collapses so a searched crate reads as looted.
        if (crate.visual && crate.visual.scaling) crate.visual.scaling.y = 0.35;
        // Record what the server said it was worth, not what the local table guessed.
        if (typeof message.value === 'number') {
            const item = crate.item || {};
            // The server sends the item kind as `lootType` (its own `type` field is the envelope).
            if (message.lootType) item.type = message.lootType;
            crate.item = Object.assign({}, item, { value: message.value });
            if (Array.isArray(g.backpack)) {
                const instant = message.lootType === 'ammo' || message.lootType === 'medkit';
                if (!instant) {
                    g.backpack.push(crate.item);
                    // The server has already counted this against the operator's loot capacity,
                    // so the client's counter advances with it — otherwise the HUD and the local
                    // capacity gate drift from the authoritative one for the whole raid.
                    if (typeof g.noteLootTaken === 'function') g.noteLootTaken();
                    // Weight and backpack value are game state; updated from server truth.
                    if (typeof g.raidValue === 'number') g.raidValue += message.value;
                }
            }
        }
        if (typeof g.showLootFeed === 'function') g.showLootFeed(crate.item, true);
        if (typeof g.updateHud === 'function') g.updateHud(true);
    },

    // Ask the server to search a crate. Returns true when the request was sent; the RESULT
    // arrives asynchronously through applySearchResult.
    searchCrate(containerId) {
        const client = this.client;
        if (!client || typeof client.searchCrate !== 'function') return false;
        try {
            const sent = client.searchCrate(containerId);
            if (sent && sent.catch) sent.catch(err => { this.error = String(err && err.message || err); });
            return true;
        } catch (err) {
            this.error = String(err && err.message || err);
            return false;
        }
    },

    // --- projectiles ----------------------------------------------------------

    // Bullets in flight, as reported by the server. One visual per projectile id, moved to the
    // authoritative position on every snapshot and interpolated between snapshots so tracers
    // do not stutter at the snapshot rate while the world renders at 60 fps.
    //
    // The SERVER owns the trajectory: this only draws it. Nothing here decides a hit, and a
    // projectile that vanishes from the snapshot is disposed immediately — that is the server
    // telling us it hit or expired.
    applyProjectiles(projectiles) {
        const g = this.game;
        if (!g || !g.scene) return;
        const seen = new Set();
        for (const proj of projectiles) {
            if (!proj || proj.id == null) continue;
            seen.add(proj.id);
            let entry = this.projectiles.get(proj.id);
            if (!entry) {
                entry = this.createProjectileVisual(proj);
                if (!entry) continue;
            }
            // The previous sample becomes the interpolation origin; the new one the target.
            entry.fromX = entry.x;
            entry.fromY = entry.y;
            entry.fromH = entry.h;
            entry.targetX = proj.x;
            entry.targetY = proj.y;
            entry.targetH = proj.h;
            entry.vx = proj.vx;
            entry.vy = proj.vy;
            entry.vh = proj.vh;
            entry.fresh = true;
        }
        // A projectile the server no longer lists has landed or expired.
        for (const [id, entry] of this.projectiles) {
            if (seen.has(id)) continue;
            this.disposeProjectile(entry);
            this.projectiles.delete(id);
        }
    },

    // A tracer for one projectile: the same visual language the offline game uses, so a
    // teammate's shot reads exactly like a machine's. `hostile` distinguishes incoming fire.
    createProjectileVisual(proj) {
        const g = this.game;
        const scene = g.scene;
        const hostile = this.isHostileShot(proj);
        let mesh = null;
        try {
            mesh = BABYLON.MeshBuilder.CreateCylinder('net-tracer-' + proj.id, {
                height: hostile ? 20 : 28,
                diameter: hostile ? 2.0 : 1.6,
                tessellation: 6,
            }, scene);
            mesh.material = this.tracerMaterial(hostile);
            mesh.isPickable = false;
            mesh.position.set(proj.x, proj.h, proj.y);
        } catch (err) {
            return null;
        }
        // Orient along the velocity so the streak points where the bullet is going.
        orientTracer(mesh, proj.vx, proj.vh, proj.vy);
        const entry = {
            id: proj.id, mesh, hostile,
            x: proj.x, y: proj.y, h: proj.h,
            fromX: proj.x, fromY: proj.y, fromH: proj.h,
            targetX: proj.x, targetY: proj.y, targetH: proj.h,
            vx: proj.vx, vy: proj.vy, vh: proj.vh, fresh: true,
        };
        this.projectiles.set(proj.id, entry);
        return entry;
    },

    // A shot is "hostile" when it was not fired by the local player. Machine shots arrive with
    // a negative shooterId; another player's shots are friendly-coloured like your own.
    isHostileShot(proj) {
        if (typeof proj.shooterId === 'number' && proj.shooterId < 0) return true;
        if (this.client && proj.shooterId === this.client.id) return false;
        const mine = !!(this.client && String(proj.shooterId || '').indexOf('enemy') === 0);
        return !mine && typeof proj.shooterId !== 'string';
    },

    // Tracer materials are shared: one per colour, created on first use and kept for the raid.
    tracerMaterial(hostile) {
        const g = this.game;
        if (hostile && g.tracerMatHostile) return g.tracerMatHostile;
        if (!hostile && g.tracerMatFriendly) return g.tracerMatFriendly;
        if (typeof g.material === 'function') {
            try {
                const mat = hostile ? g.material('tracer-mat-h', 0xff4422) : g.material('tracer-mat-f', 0xffcc33);
                mat.disableLighting = true;
                mat.emissiveColor = hostile
                    ? new BABYLON.Color3(1, 0.25, 0.1)
                    : new BABYLON.Color3(1, 0.85, 0.25);
                if (hostile) g.tracerMatHostile = mat; else g.tracerMatFriendly = mat;
                return mat;
            } catch (err) { /* fall through to a plain material */ }
        }
        return null;
    },

    disposeProjectile(entry) {
        if (!entry) return;
        // The material is shared, so only the mesh is disposed.
        if (entry.mesh && entry.mesh.dispose) entry.mesh.dispose();
    },

    // Smooth the in-flight bullet between snapshots. Interpolation is presentation only: the
    // SERVER decides where it hit, so a small visual lag never changes an outcome.
    interpolateProjectiles(dt) {
        if (!this.projectiles || this.projectiles.size === 0) return;
        const k = Math.min(1, Math.max(0, this.INTERP) * (dt > 0 ? dt * 60 : 1));
        for (const entry of this.projectiles.values()) {
            if (!entry.mesh) continue;
            if (entry.fresh) {
                // First sighting: adopt the position outright instead of sliding from the
                // muzzle of a previous, unrelated shot.
                entry.x = entry.targetX; entry.y = entry.targetY; entry.h = entry.targetH;
                entry.fresh = false;
            } else {
                entry.x += (entry.targetX - entry.x) * k;
                entry.y += (entry.targetY - entry.y) * k;
                entry.h += (entry.targetH - entry.h) * k;
            }
            entry.mesh.position.set(entry.x, entry.h, entry.y);
        }
    },

    // A short muzzle flash at the shooter's position. Purely cosmetic: it exists so a shot is
    // visible even when its projectile resolves before the next snapshot.
    showMuzzleFlash(event) {
        const g = this.game;
        if (!g || !g.scene) return;
        // Find who fired: their own body for a peer, the camera for the local player.
        let x = null, y = null, h = null;
        if (this.client && event.shooterId === this.client.id) {
            x = g.player ? g.player.x : null;
            y = g.player ? g.player.y : null;
            h = g.player ? (g.player.h || 0) + 55 : null;
        } else {
            const peer = this.peers.get(event.shooterId);
            if (peer) { x = peer.x; y = peer.y; h = (peer.h || 0) + 55; }
        }
        if (x == null || y == null || h == null) return;
        try {
            const mesh = BABYLON.MeshBuilder.CreateSphere('net-flash-' + (event.projId || event.tick || 0),
                { diameter: 12, segments: 4 }, g.scene);
            mesh.isPickable = false;
            mesh.position.set(x, h, y);
            const material = this.tracerMaterial(event.shooterId !== (this.client && this.client.id));
            if (material) mesh.material = material;
            // Self-expiring: the flash lives a couple of frames and needs no server update.
            this.flashes.push({ mesh, life: 0.06 });
        } catch (err) { /* a flash must never break the frame */ }
    },

    // Retire the transient visuals. Called every frame, cheap when there are none.
    updateFlashes(dt) {
        if (!this.flashes || this.flashes.length === 0) return;
        for (let i = this.flashes.length - 1; i >= 0; i--) {
            const flash = this.flashes[i];
            flash.life -= dt;
            if (flash.life <= 0) {
                if (flash.mesh && flash.mesh.dispose) flash.mesh.dispose();
                this.flashes.splice(i, 1);
            }
        }
    },

    // --- peers ----------------------------------------------------------------

    applyPeers(players) {
        const g = this.game;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const seen = new Set();
        for (const player of players) {
            if (player.id === this.client.id) continue;   // that is us
            seen.add(player.id);
            let peer = this.peers.get(player.id);
            if (!peer) peer = this.createPeer(player);
            if (!peer) continue;
            // Push the sample into the peer's buffer instead of aiming straight at it. The
            // renderer plays back an OLDER pair of samples, which is what removes the stutter:
            // arrival time no longer decides when a body jumps.
            if (!peer.samples) peer.samples = [];
            peer.samples.push({
                tick: typeof player.tick === 'number' ? player.tick : (peer.samples.length ? peer.samples[peer.samples.length - 1].tick + 1 : 0),
                x: player.x, y: player.y, h: player.h,
                heading: player.heading != null ? player.heading : peer.heading,
            });
            // Keep the buffer bounded: drop the OLDEST, since the newest is the truth we need.
            // The playhead is an INDEX, so removing a sample in front of it must move it back by
            // one — otherwise every drop would silently advance the renderer by a whole sample
            // interval and the body would jump.
            while (peer.samples.length > this.JITTER_MAX_SAMPLES) {
                peer.samples.shift();
                peer.playhead = Math.max(0, (peer.playhead || 0) - 1);
            }
            peer.lastSeen = now;
            // Posture, lean, damage and death are server facts and snap, unlike position.
            this.applyPeerState(peer, player);
        }
        // Bodies for players who left this snapshot.
        for (const [id, peer] of this.peers) {
            if (seen.has(id)) continue;
            if (now - peer.lastSeen > this.PEER_TIMEOUT_MS) {
                if (peer.mesh && peer.mesh.dispose) peer.mesh.dispose();
                this.peers.delete(id);
            }
        }
        if (this.game && this.game.player && this.game.player.hp <= 0 && !this.downed && this.game.phase === 'raid' && !this.settled) {
            const alive = this.getAlivePeers();
            if (alive.length > 0) {
                this.spectating = true;
                if (!this.spectateTargetId || !alive.some(p => p.id === this.spectateTargetId)) {
                    this.spectateTargetId = alive[0].id;
                }
            } else {
                this.spectating = false;
                this.spectateTargetId = null;
            }
        } else if (this.game && this.game.player && (this.game.player.hp > 0 || this.downed)) {
            this.spectating = false;
            this.spectateTargetId = null;
        }
    },

    // The character GLB container, loaded once and reused to build every peer body. The peers
    // need their OWN instance (own skeleton, own clips), so the container is the right thing to
    // cache — not a built mesh, which shares animation state between everyone who clones it.
    ensureCharacterModel() {
        if (this.characterModel || this.characterPending) return this.characterModel;
        if (typeof Model3D === 'undefined' || !Model3D.load || !this.game || !this.game.scene) return null;
        this.characterPending = Model3D.load('assets/models/character.glb', this.game.scene)
            .then(model => { this.characterModel = model; return model; })
            .catch(() => null);
        return null;
    },

    // A peer body. The shared character model is cloned when it is available, so teammates
    // look like operators rather than capsules; the capsule remains the fallback so a peer is
    // ALWAYS visible even before the GLB finishes loading (invariant 6 applied to the network).
    createPeer(player) {
        const g = this.game;
        const scene = g.scene;
        if (!scene) return null;
        const shortId = String(player.id).slice(0, 8);
        let mesh = null;
        let model = null;
        let peerClips = null;
        try {
            // Build a FRESH instance from the loaded container rather than cloning a mesh: a
            // clone shares the source's animation groups, so every peer would drive the SAME
            // skeleton and they would all animate in lockstep. Model3D.build gives each peer its
            // own meshes, skeleton and Clips3D.
            const source = g.app?.location?.objects?.find(o => o.def && o.def.name === 'character');
            const built = source && source.mesh;
            const loaded = this.ensureCharacterModel();
            if (loaded && typeof Model3D !== 'undefined' && Model3D.build) {
                model = Model3D.build(loaded, scene, { name: 'peer-model-' + shortId });
                model.scaling.setAll(0.25);
                peerClips = Model3D.clips(model);
            } else if (built && typeof Model3D !== 'undefined' && Model3D.clips) {
                // Fallback: show the source body itself is not safe (it is the player's), so a
                // capsule is used instead of cloning shared animation state.
                model = null;
            }
        } catch (err) { model = null; }

        try {
            if (model) {
                // The clone is the visible body; a thin capsule is not needed.
                mesh = model;
            } else {
                (/** @type {any} */ (BABYLON)).MeshBuilder = BABYLON.MeshBuilder || {};
                mesh = BABYLON.MeshBuilder.CreateCapsule('peer-' + shortId,
                    { height: 76, radius: 22, tessellation: 10 }, scene);
                const material = new BABYLON.StandardMaterial('peer-mat-' + shortId, scene);
                material.diffuseColor = new BABYLON.Color3(0.24, 0.45, 0.52);
                material.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
                mesh.material = material;
            }
            mesh.isPickable = false;
        } catch (err) {
            return null;
        }

        const peer = {
            id: player.id, mesh, model,
            x: player.x, y: player.y, h: player.h, heading: player.heading || 0,
            fromX: player.x, fromY: player.y, fromH: player.h, fromHeading: player.heading || 0,
            targetX: player.x, targetY: player.y, targetH: player.h, targetHeading: player.heading || 0,
            lerp: 1, hp: player.hp, maxHp: player.maxHp, lastSeen: 0, disconnected: false,
            // Posture is server state: a crouching teammate must not stand up on our screen.
            posture: player.posture || 'stand', lean: player.lean || 0,
            eyeHeight: 64, dead: false,
        };
        peer.clips = peerClips && peerClips.has('idle') ? peerClips : null;
        if (peer.clips) { try { peer.clips.play('idle'); } catch (err) { peer.clips = null; } }
        // World registration: the kit owns materials, shadows and outlines through addObject.
        if (!model && typeof World3D !== 'undefined' && World3D.addObject) {
            try { World3D.addObject(g.app.location.view, mesh, 'actor', { ink: false, outline: false }); }
            catch (err) { /* a peer body must never break the frame */ }
        }
        this.peers.set(player.id, peer);
        return peer;
    },

    // Apply the parts of a peer's state that are NOT position: stance, lean, damage and death.
    // These are presentation of server facts, so they snap rather than interpolate.
    applyPeerState(peer, player) {
        if (!peer || !peer.mesh) return;
        const hp = typeof player.hp === 'number' ? player.hp : peer.hp;
        const applyHp = (peer.hp !== hp);
        peer.hp = hp;
        if (typeof player.shield === 'number') peer.shield = player.shield;
        if (typeof player.maxShield === 'number') peer.maxShield = player.maxShield;
        if (typeof player.pitch === 'number') peer.pitch = player.pitch;
        peer.posture = player.posture || peer.posture || 'stand';
        peer.lean = typeof player.lean === 'number' ? player.lean : (peer.lean || 0);
        peer.disconnected = !!player.disconnected;
        peer.downed = !!player.downed;
        peer.downedHp = player.downedHp || 0;
        peer.downedTimer = player.downedTimer || 0;
        peer.reviveProgress = player.reviveProgress || 0;
        peer.revivingTargetId = player.revivingTargetId || null;

        // A dead or dropped teammate stays in the world but stops looking alive.
        const shouldShow = hp > 0 || peer.downed || !peer.dead;
        peer.mesh.setEnabled(shouldShow);
        if (peer.downed) {
            peer.dead = false;
            peer.mesh.rotation.x = -Math.PI / 2.3;
        } else if (hp <= 0 && !peer.dead) {
            peer.dead = true;
            // A corpse lies down instead of standing to attention.
            peer.mesh.rotation.x = -Math.PI / 2;
        } else if (hp > 0 && peer.dead) {
            peer.dead = false;
            peer.mesh.rotation.x = 0;
        }
        // Crouching and prone lower the body so the pose matches what the server believes.
        // The factors are MULTIPLIERS of the body's own base height: the GLB is authored at
        // 1/4 scale, so writing an absolute 0.7 here would have made a crouching teammate
        // taller than a standing one.
        const baseY = peer.baseScaleY != null ? peer.baseScaleY : (peer.mesh.scaling ? peer.mesh.scaling.y : 1);
        if (peer.baseScaleY == null) peer.baseScaleY = baseY;
        const factor = peer.posture === 'crouch' ? 0.7 : peer.posture === 'prone' ? 0.35 : 1;
        if (peer.mesh.scaling) peer.mesh.scaling.y = baseY * factor;
        // Leaning shifts the body sideways, matching the eye offset the server uses.
        peer.leanOffset = peer.lean * 18;
    },

    // Smooth remote motion: snapshots are far rarer than frames, so ease toward the target.    // Smooth remote motion: snapshots are far rarer than frames, so ease toward the target.
    // Interpolation is presentation only — it never feeds back into gameplay decisions.
    interpolatePeers(dt) {
        if (!this.peers || this.peers.size === 0) return;
        const k = Math.min(1, Math.max(0, this.INTERP) * (dt > 0 ? dt * 60 : 1));
        for (const peer of this.peers.values()) {
            if (!peer.mesh) continue;

            // Play back the jitter buffer. The renderer advances one snapshot interval per
            // SNAPSHOT PERIOD of real time, so a body moves at the correct speed while staying
            // a fixed depth behind the newest sample. Without this the ease was driven by packet
            // ARRIVAL, and a late packet made the body stall then surge.
            const samples = peer.samples || [];
            if (samples.length >= 2) {
                peer.playhead = (peer.playhead || 0) + Math.max(0, dt) * this.SNAPSHOT_HZ;
                // Hold a fixed depth BEHIND the newest sample. That depth is the whole point of
                // the buffer: it is the slack that absorbs a late packet. Rendering the newest
                // sample would put us back at the mercy of arrival timing.
                const target = Math.max(0, samples.length - 1 - this.JITTER_SAMPLES);
                // A playhead that has fallen too far behind catches up gradually instead of
                // teleporting; one that has run ahead waits.
                if (peer.playhead > target) peer.playhead = Math.max(target, peer.playhead - Math.max(0, dt) * this.SNAPSHOT_HZ * 2);
                else if (peer.playhead < target - 1) peer.playhead = target - 1;
                const maxPlayhead = Math.max(0, samples.length - 2);
                if (peer.playhead > maxPlayhead) peer.playhead = maxPlayhead;
                if (peer.playhead < 0) peer.playhead = 0;
                const i = Math.min(Math.floor(peer.playhead), samples.length - 2);
                const frac = Math.min(1, Math.max(0, peer.playhead - i));
                const a = samples[i], b = samples[i + 1];
                peer.targetX = a.x + (b.x - a.x) * frac;
                peer.targetY = a.y + (b.y - a.y) * frac;
                peer.targetH = a.h + (b.h - a.h) * frac;
                // Heading interpolates on the shortest arc between the two samples.
                let hd = b.heading - a.heading;
                while (hd > Math.PI) hd -= Math.PI * 2;
                while (hd < -Math.PI) hd += Math.PI * 2;
                peer.targetHeading = a.heading + hd * frac;
                // Place the body exactly on the buffered sample: it is already smooth, so the
                // extra ease would lag it further behind for no benefit.
                peer.x = peer.targetX;
                peer.y = peer.targetY;
                peer.h = peer.targetH;
                peer.heading = peer.targetHeading;
            } else {
                // Not enough samples yet (a peer that just appeared): fall back to the ease.
                peer.x += (peer.targetX - peer.x) * k;
                peer.y += (peer.targetY - peer.y) * k;
                peer.h += (peer.targetH - peer.h) * k;
                let delta = peer.targetHeading - peer.heading;
                while (delta > Math.PI) delta -= Math.PI * 2;
                while (delta < -Math.PI) delta += Math.PI * 2;
                peer.heading += delta * k;
            }
            // Normalise back into [-PI, PI]. Without this the heading drifts outside the
            // protocol range over a long raid: the server rejects headings beyond PI, and the
            // value would eventually accumulate enough float error to spin the model.
            while (peer.heading > Math.PI) peer.heading -= Math.PI * 2;
            while (peer.heading < -Math.PI) peer.heading += Math.PI * 2;
            // Leaning shifts the body sideways, matching the eye offset the server uses for the
            // muzzle. Without it a leaning teammate looks like they are standing still.
            const leanX = -(peer.leanOffset || 0) * Math.sin(peer.heading);
            const leanY = (peer.leanOffset || 0) * Math.cos(peer.heading);
            peer.mesh.position.set(peer.x + leanX, peer.h, peer.y + leanY);
            // Kit convention: nose along +X. A dead peer lies down, so the yaw must not fight
            // the pitch that `applyPeerState` applied.
            if (!peer.dead) peer.mesh.rotation.y = -peer.heading;

            // Animation follows actual displacement, not the input axes: the snapshot carries
            // no "moving" flag, and a sliding idle pose is the most obvious tell that a body is
            // remote. Fell back to idle when the peer is dead or not moving.
            if (peer.clips) {
                const moved = Math.hypot(peer.x - (peer.prevX != null ? peer.prevX : peer.x),
                    peer.y - (peer.prevY != null ? peer.prevY : peer.y));
                peer.prevX = peer.x;
                peer.prevY = peer.y;
                // A sprinting peer covers noticeably more ground per frame than a walking one.
                const speed = dt > 0 ? moved / dt : 0;
                const want = peer.dead ? 'idle' : speed > 220 ? 'run' : speed > 12 ? 'run' : 'idle';
                if (peer.clip !== want) {
                    try { if (peer.clips.play(want)) peer.clip = want; } catch (err) { /* keep the old clip */ }
                }
                // NOTE: Clips3D advances itself from a scene observer (Gltf3D.js), so calling
                // _tick here would double the animation speed — the clips are only SELECTED here.
            }
        }
    },

    // --- spectator ------------------------------------------------------------

    /**
     * Returns an array of active, alive teammates.
     * @returns {Array<any>}
     */
    getAlivePeers() {
        if (!this.peers) return [];
        return [...this.peers.values()].filter(p => (p.hp > 0 || p.downed || !p.dead) && !p.disconnected);
    },

    /**
     * Cycles the spectated peer target to the next/prev alive teammate.
     * @param {number} step +1 for next, -1 for prev
     * @returns {any|null} the newly spectated peer
     */
    cycleSpectateTarget(step = 1) {
        const alive = this.getAlivePeers();
        if (alive.length === 0) {
            this.spectating = false;
            this.spectateTargetId = null;
            return null;
        }
        let idx = alive.findIndex(p => p.id === this.spectateTargetId);
        if (idx === -1) {
            idx = 0;
        } else {
            idx = (idx + step + alive.length) % alive.length;
        }
        this.spectateTargetId = alive[idx].id;
        return alive[idx];
    },

    /**
     * Retrieves the currently spectated peer, auto-cycling if current target is dead/gone.
     * @returns {any|null}
     */
    getSpectatedPeer() {
        if (!this.spectating || !this.spectateTargetId) return null;
        let peer = this.peers.get(this.spectateTargetId);
        if (!peer || (!peer.downed && (peer.dead || peer.hp <= 0)) || peer.disconnected) {
            peer = this.cycleSpectateTarget(1);
        }
        return peer;
    },

    // --- events ---------------------------------------------------------------

    // Server events are facts, not requests: play the feedback, never re-decide the outcome.
    applyEvents(events) {
        const g = this.game;
        for (const event of events) {
            if (event.type === 'enemyHit' && event.point) {
                if (g.hitMarker != null) g.hitMarker = event.headshot ? 0.28 : 0.14;
                if (typeof g.impactBlocker === 'function' && event.point) {
                    try { g.impactBlocker(event.point, { x: 0, y: 0, h: 1 }); } catch (err) { /* vfx only */ }
                }
            } else if (event.type === 'enemyKill') {
                g.kills = (g.kills || 0) + 1;
                if (g.hitMarker != null) g.hitMarker = 0.22;
            } else if (event.type === 'fire') {
                // A shot that resolves inside a single tick — point blank, or a hit on the very
                // first step — never appears in any snapshot, so drawing only from `projectiles`
                // makes close-range fire invisible. The `fire` event is the server confirming
                // the shot happened, so a brief muzzle flash is drawn from it.
                this.showMuzzleFlash(event);
            } else if (event.type === 'hit' && event.targetId !== this.client.id && event.point) {
                // A teammate taking a hit: show the impact where the bullet landed, so a squad
                // can see each other being shot at even when the tracer was too short-lived.
                if (typeof g.impactBlocker === 'function') {
                    try { g.impactBlocker(event.point, { x: 0, y: 0, h: 1 }); } catch (err) { /* vfx only */ }
                }
            } else if (event.type === 'hit' && event.targetId === this.client.id) {
                if (g.damageFlash != null) g.damageFlash = 0.2;
            } else if (event.type === 'surrender' && event.playerId === this.client.id) {
                g.onlineSurrendered = true;
            } else if (event.type === 'disconnect' || event.type === 'reconnect') {
                // Peer presence is already reflected by the snapshot; nothing to apply here.
            }
        }
    },

    // --- explicit actions -----------------------------------------------------

    /** Give up. The server decides the outcome; the game reacts to it in the next snapshot. */
    async surrender() {
        if (!this.client) return null;
        try {
            if (typeof this.client.sendActionSocket === 'function') return await this.client.sendActionSocket('surrender');
            return await this.client.surrender();
        } catch (err) { this.error = String(err && err.message || err); return null; }
    },

    /** Call the transport from wherever the player is standing. */
    async requestExtraction() {
        if (!this.client) return null;
        try {
            if (typeof this.client.sendActionSocket === 'function') return await this.client.sendActionSocket('extract');
            return await this.client.requestExtraction();
        } catch (err) { this.error = String(err && err.message || err); return null; }
    },

    /** Read-only view for the HUD and for tests. */
    status() {
        return {
            enabled: !!this.enabled,
            active: this.active(),
            connected: !!this.client?.token,
            transport: this.transport || 'http',
            lastTick: this.lastTick,
            peers: this.peers ? this.peers.size : 0,
            // Prediction telemetry: the numbers that say whether it is helping or guessing.
            prediction: !!this.prediction,
            pendingInput: this.history ? this.history.length : 0,
            lastCorrection: this.lastCorrection || 0,
            maxCorrection: this.maxCorrection || 0,
            mismatches: this.mismatches || 0,
            latencyMs: this.latencyMs || 0,
            error: this.error,
        };
    },
};

// --- helpers ----------------------------------------------------------------

// Point a tracer's long axis along its velocity. The cylinder is built along +Y, so its
// world axis must be rotated onto the velocity vector; without this the streak lies flat and
// the shot reads as a sideways smear.
function orientTracer(mesh, vx, vh, vy) {
    if (!mesh) return;
    try {
        const vel = new BABYLON.Vector3(vx, vh, vy);
        const speed = vel.length();
        if (!(speed > 1e-6)) return;
        vel.scaleInPlace(1 / speed);
        mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
        BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Axis.Y, vel, mesh.rotationQuaternion);
    } catch (err) { /* a tracer must never break the frame */ }
}

function clampAxis(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-1, Math.min(1, n));
}

function clampHeading(value) {
    let n = Number(value);
    if (!Number.isFinite(n)) return 0;
    // The protocol takes [-PI, PI]; wrap instead of rejecting a valid direction.
    while (n > Math.PI) n -= Math.PI * 2;
    while (n < -Math.PI) n += Math.PI * 2;
    return n;
}

function clampPitch(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, n));
}

if (typeof module !== 'undefined' && module.exports) module.exports = OnlineBridge;
if (typeof window !== 'undefined') /** @type {any} */ (window).OnlineBridge = OnlineBridge;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).OnlineBridge = OnlineBridge;