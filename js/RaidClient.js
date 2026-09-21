// Transport adapter for the authoritative raid. No rendering or UI.
//
// The client sends INTENT ONLY (movement axes, heading, trigger, posture) and accepts
// versioned snapshots. It never writes game state directly: server positions, HP, kills and
// loot are the only truth, and `RaidWorld` is fetched from the server so local collision
// uses the same map the server arbitrates on.
class RaidClient {
    constructor(url) {
        this.url = url.replace(/\/$/, '');
        this.token = '';
        this.id = '';
        this.sequence = 0;
        this.tick = -1;
        this.snapshot = null;
        /** @type {any} the public account view once registered or logged in */
        this.account = null;
        /** @type {any} the authoritative map definition, from GET /world */
        this.world = null;
        this.seed = null;
        this.protocol = 2;
        /** @type {Array<{type: string, [key: string]: any}>} events not yet consumed */
        this._pending = [];
        this._seenEventAt = -1;
        // --- push transport (WebSocket) ---
        /** @type {any} the live socket, or null while polling over HTTP */
        this.socket = null;
        /** 'ws' when the server pushes snapshots, 'http' when they are polled */
        this.transport = 'http';
        /** @type {string | null} why the socket is not being used, for diagnostics */
        this.socketError = null;
        this.lastPushAt = 0;
        /** @type {((message: any) => void) | null} called for every pushed snapshot */
        this.onSnapshot = null;
        /** @type {((message: any) => void) | null} called for pushed action replies */
        this.onAction = null;
        /** @type {((payout: any) => void) | null} called when the server pays out a raid */
        this.onPayout = null;
        /** @type {((match: any) => void) | null} called when the matchmaker forms a raid */
        this.onMatched = null;
        /** @type {any} the server's authoritative payout for the last raid, or null */
        this.payout = null;
        /** @type {any} the formed match, pushed over the socket, or null */
        this.match = null;
    }

    async request(path, method = 'GET', body = undefined) {
        const response = await fetch(this.url + path, {
            method, headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'network-error');
        return result;
    }

    async connect() {
        if (this.token) throw new Error('already-connected');
        const result = await this.request('/sessions', 'POST');
        this.token = result.token;
        this.id = result.id;
        this.sequence = 0;
        this.tick = -1;
        // Fetch the world before accepting gameplay state: a snapshot is meaningless without
        // the map it describes, and pulling it here means collision can never drift.
        try {
            const worldReply = await this.request('/world');
            this.world = worldReply.world;
            this.seed = worldReply.seed;
            if (worldReply.version) this.protocol = worldReply.version;
        } catch (e) {
            this.world = null;
        }
        return this.accept(result.snapshot);
    }

    // --- WebSocket transport ------------------------------------------------
    //
    // The server pushes snapshots over /ws, so the client stops polling for state. HTTP stays
    // as the fallback: if the socket cannot open (blocked, unsupported, server without WS) the
    // game keeps working exactly as before. Both transports share `accept()` and the same
    // reconciliation path, so they cannot disagree about the world.

    /** True when a live socket is carrying snapshots. */
    isLive() {
        return !!this.socket && this.socket.readyState === 1;
    }

    /**
     * Open the push transport and authenticate. Resolves to true when the socket is live.
     * Never throws: a failure here must degrade to polling, not break the game.
     */
    async connectSocket({ timeoutMs = 4000 } = {}) {
        if (!this.token) throw new Error('not-connected');
        if (typeof WebSocket === 'undefined') return false;
        if (this.isLive()) return true;
        const url = this.url.replace(/^http/, 'ws') + '/ws';
        return new Promise((resolve) => {
            let settled = false;
            let socket = null;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                resolve(ok);
            };
            try { socket = new WebSocket(url); }
            catch (err) { this.socketError = String(err && err.message || err); return finish(false); }

            const timer = setTimeout(() => {
                this.socketError = 'timeout';
                try { if (socket) socket.close(); } catch (err) { /* already gone */ }
                finish(false);
            }, timeoutMs);

            socket.onopen = () => {
                try { socket.send(JSON.stringify({ type: 'auth', token: this.token })); }
                catch (err) { this.socketError = String(err && err.message || err); }
            };
            socket.onmessage = (event) => {
                let message = null;
                try { message = JSON.parse(event.data); } catch (err) { return; }
                if (!message) return;

                if (message.type === 'ready') {
                    clearTimeout(timer);
                    this.socket = socket;
                    this.transport = 'ws';
                    if (message.world) { this.world = message.world; this.seed = message.seed; }
                    if (message.protocol) this.protocol = message.protocol;
                    if (message.id) this.id = message.id;
                    finish(true);
                    return;
                }
                if (message.type === 'snapshot') {
                    // ALWAYS accept first. Recording the snapshot and invoking the handler are
                    // two different jobs: the handler lets the bridge reconcile immediately,
                    // while accept() keeps `client.snapshot` (and therefore me(), enemies(),
                    // objective()) truthful. Skipping accept() left every reader of
                    // `client.snapshot` looking at a stale world.
                    this.lastPushAt = Date.now();
                    try { this.accept(message.snapshot); }
                    catch (err) { this.socketError = String(err && err.message || err); }
                    if (this.onSnapshot) {
                        try { this.onSnapshot(message); } catch (err) { /* a handler must not kill the stream */ }
                    }
                    return;
                }
                // The server's own payout for a finished raid. The client must DISPLAY this, not
                // compute one: a locally calculated reward is not authoritative online.
                if (message.type === 'payout') {
                    this.payout = { raidId: message.raidId, credits: message.credits, stats: message.stats, value: message.value, extracted: !!message.extracted };
                    if (this.onPayout) { try { this.onPayout(this.payout); } catch (err) { /* ignore */ } }
                    return;
                }
                // The matchmaker formed a raid for us: told explicitly instead of being
                // discovered by noticing the tick change.
                if (message.type === 'matched') {
                    this.match = { raidId: message.raidId, seed: message.seed, players: message.players };
                    if (message.world) { this.world = message.world; this.seed = message.seed; }
                    if (this.onMatched) { try { this.onMatched(this.match); } catch (err) { /* ignore */ } }
                    return;
                }
                if (message.type === 'action' && this.onAction) {
                    try { this.onAction(message); } catch (err) { /* ignore */ }
                }
            };
            socket.onerror = () => { this.socketError = 'socket-error'; };
            socket.onclose = () => {
                clearTimeout(timer);
                const wasLive = this.socket === socket;
                this.socket = null;
                if (wasLive) this.transport = 'http';
                finish(false);
            };
        });
    }

    /** Send one command over the socket, or fall back to HTTP when it is not live. */
    async sendInputSocket(command) {
        if (this.isLive()) {
            const sequence = this.sequence++;
            try {
                this.socket.send(JSON.stringify({ type: 'input', command: { version: this.protocol, sequence, ...command } }));
                return null;
            } catch (err) {
                this.socketError = String(err && err.message || err);
            }
        }
        // No socket: the HTTP path keeps the game playable.
        return this.sendInput(command);
    }

    /** A raid action (surrender, extract, reconnect) over whichever transport is live. */
    async sendActionSocket(type) {
        if (this.isLive()) {
            try { this.socket.send(JSON.stringify({ type })); return { ok: true, via: 'ws' }; }
            catch (err) { this.socketError = String(err && err.message || err); }
        }
        if (type === 'surrender') return this.surrender();
        if (type === 'extract') return this.requestExtraction();
        if (type === 'reconnect') return this.reconnect();
        return { ok: false, error: 'unknown-action' };
    }

    closeSocket() {
        if (!this.socket) return;
        try { this.socket.close(); } catch (err) { /* already closed */ }
        this.socket = null;
        this.transport = 'http';
    }

    accept(snapshot) {
        if (!snapshot) return this.snapshot;
        if (snapshot.version !== this.protocol) throw new Error('protocol-version');
        if (snapshot.tick >= this.tick) {
            this.tick = snapshot.tick;
            this.snapshot = snapshot;
            // Queue only NEW events: an event carries a tick, and applying one twice would
            // double-count a kill or an impact on the client.
            for (const event of snapshot.events || []) {
                if (event.tick >= this._seenEventAt) this._pending.push(event);
            }
            this._seenEventAt = snapshot.tick + 1;
        }
        return this.snapshot;
    }

    /** Events received since the last drain. The caller applies them once, then discards. */
    drainEvents() {
        const out = this._pending;
        this._pending = [];
        return out;
    }

    /** Local player as the server sees it, or null. */
    me() {
        if (!this.snapshot || !this.snapshot.players) return null;
        return this.snapshot.players.find(p => p.id === this.id) || null;
    }

    /** Machines the server reports. Read-only: the client never decides these. */
    enemies() {
        return (this.snapshot && this.snapshot.enemies) || [];
    }

    /** Server-owned objectives (drives collected, raid timer, extraction zones). */
    objective() {
        return (this.snapshot && this.snapshot.objective) || null;
    }

    async sendInput({ forward, right, heading, sprint = false, fire = false, pitch = 0, posture, lean }) {
        if (!this.token) throw new Error('not-connected');
        const body = {
            version: this.protocol, sequence: this.sequence++, forward, right, heading, sprint, fire, pitch,
        };
        if (posture !== undefined) body.posture = posture;
        if (lean !== undefined) body.lean = lean;
        return this.accept(await this.request('/input', 'POST', body));
    }

    async poll() {
        if (!this.token) throw new Error('not-connected');
        return this.accept(await this.request('/snapshot'));
    }

    // --- online lobby -------------------------------------------------------
    // Account, friends, party and matchmaking. Every call resolves the player from the
    // bearer token on the server, so these methods never send an identity — only intent.

    /** Register and stay connected. Returns the public account view. */
    async register(name, password) {
        const result = await this.request('/register', 'POST', { name, password });
        this.token = result.token;
        this.account = result.account;
        this.id = result.account.id;
        this.sequence = 0;
        this.tick = -1;
        await this._fetchWorld();
        return this.account;
    }

    /** Log in and stay connected. */
    async login(name, password) {
        const result = await this.request('/login', 'POST', { name, password });
        this.token = result.token;
        this.account = result.account;
        this.id = result.account.id;
        this.sequence = 0;
        this.tick = -1;
        await this._fetchWorld();
        return this.account;
    }

    /** Restore a persisted bearer token and verify it against the server. */
    async restore(token) {
        this.token = String(token || '');
        if (!this.token) throw new Error('session');
        try {
            const result = await this.request('/account');
            this.account = result.account;
            this.id = result.account.id;
            this.sequence = 0;
            this.tick = -1;
            await this._fetchWorld();
            return this.account;
        } catch (error) {
            this.token = '';
            this.account = null;
            this.id = '';
            throw error;
        }
    }

    async _fetchWorld() {
        try {
            const reply = await this.request('/world');
            this.world = reply.world;
            this.seed = reply.seed;
            if (reply.version) this.protocol = reply.version;
        } catch (e) { this.world = null; }
    }

    /** What the lobby needs to render itself before joining a raid. */
    async health() { return this.request('/health'); }

    async refreshAccount() {
        const result = await this.request('/account');
        this.account = result.account;
        return this.account;
    }

    // Friends: a request is not a friendship until the other side accepts.
    async friends() { return this.request('/friends'); }
    async addFriend(name) { return this.request('/friends/request', 'POST', { name }); }
    async acceptFriend(name) { return this.request('/friends/accept', 'POST', { name }); }
    async declineFriend(name) { return this.request('/friends/decline', 'POST', { name }); }
    async removeFriend(name) { return this.request('/friends', 'DELETE', { name }); }

    // Party: one leader, a hard cap, matched whole or not at all.
    async party() { return this.request('/party'); }
    async createParty() { return this.request('/party', 'POST'); }
    async ensureParty() { return this.request('/party', 'POST', { automatic: true }); }
    async leaveParty() { return this.request('/party', 'DELETE'); }
    async inviteToParty(name) { return this.request('/party/invite', 'POST', { name }); }
    async acceptPartyInvite(inviteId) { return this.request('/party/accept', 'POST', { inviteId }); }
    async declinePartyInvite(inviteId) { return this.request('/party/decline', 'POST', { inviteId }); }
    async kickFromParty(name) { return this.request('/party/kick', 'POST', { name }); }
    async promotePartyLeader(name) { return this.request('/party/promote', 'POST', { name }); }
    async setPartyReady(ready = true) { return this.request('/party/ready', 'POST', { ready }); }

    // Matchmaking.
    async queue() { return this.request('/match/queue', 'POST'); }
    async cancelQueue() { return this.request('/match/queue', 'DELETE'); }
    async matchStatus() { return this.request('/match/status'); }

    // Authoritative inventory and trading.
    async inventory() { return this.request('/inventory'); }
    async moveInventoryItem(from, to) { return this.request('/inventory/move', 'POST', { from, to }); }
    async buyTraderItem(traderId, slotIndex) { return this.request('/traders/buy', 'POST', { traderId, slotIndex }); }
    async sellInventoryItem(ref, instId) {
        const body = {};
        if (ref && typeof ref === 'object') { body.area = ref.area; body.index = ref.index; }
        if (instId) body.instId = instId;
        return this.request('/inventory/sell', 'POST', body);
    }
    async sellJunk() { return this.request('/inventory/sell-junk', 'POST'); }

    /**
     * Ask the server to search a loot crate. The server checks the range and owns the contents,
     * so the item and its value are authoritative — this is what makes the payout real.
     * Sent over the socket when it is live, HTTP otherwise.
     */
    async searchCrate(containerId) {
        if (this.isLive()) {
            try {
                this.socket.send(JSON.stringify({ type: 'search', containerId }));
                return { ok: true, via: 'ws', pending: true };
            } catch (err) {
                this.socketError = String(err && err.message || err);
            }
        }
        return this.request('/raid/search', 'POST', { containerId });
    }

    /** Poll until a raid is found, or the timeout elapses. Returns the raid or null. */
    async waitForRaid({ timeoutMs = 120000, intervalMs = 1000 } = {}) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const status = await this.matchStatus();
            if (status.raid) return status.raid;
            await new Promise(r => setTimeout(r, intervalMs));
        }
        return null;
    }

    // --- progression, skills, contracts, and workshop -------------------------

    async progression() {
        return this.request('/progression');
    }

    async allocateSkill(branchId, skillId) {
        return this.request('/progression/skill', 'POST', { branchId, skillId });
    }

    async respecSkills() {
        return this.request('/progression/respec', 'POST');
    }

    async contracts() {
        return this.request('/contracts');
    }

    async acceptContract(contractId) {
        return this.request('/contracts/accept', 'POST', { contractId });
    }

    async claimContract(contractId) {
        return this.request('/contracts/claim', 'POST', { contractId });
    }

    async upgradeWorkshopStation(stationId) {
        return this.request('/workshop/upgrade', 'POST', { stationId });
    }

    async craftItem(recipeId) {
        return this.request('/workshop/craft', 'POST', { recipeId });
    }

    async claimFreeKit() {
        return this.request('/inventory/free-kit', 'POST');
    }

    // --- raid lifecycle -----------------------------------------------------
    // The raid's outcome is the server's decision. These calls ask the server to act and
    // report what it decided; the client never sets `phase` from its own guess.

    /** Give up. The server records a casualty and answers with the raid outcome. */
    async surrender() {
        const reply = await this.request('/raid/surrender', 'POST');
        if (reply.snapshot) this.accept(reply.snapshot);
        return reply;
    }

    /** Call the transport. Only valid while standing in the zone with the drives collected. */
    async requestExtraction() {
        const reply = await this.request('/raid/extract', 'POST');
        if (reply.snapshot) this.accept(reply.snapshot);
        return reply;
    }

    /** Reclaim a body after a dropped connection, inside the server's grace window. */
    async reconnect() {
        const reply = await this.request('/raid/reconnect', 'POST');
        if (reply.snapshot) this.accept(reply.snapshot);
        return reply;
    }

    /** True once the server has closed the raid. Read from the snapshot, never guessed. */
    isRaidOver() {
        return !!this.snapshot && this.snapshot.state === 'ended';
    }

    /** The single shared outcome of this raid, or null while it is running. */
    outcome() {
        return (this.snapshot && this.snapshot.outcome) || null;
    }

    /** True when the local player has been killed or has surrendered. */
    isDead() {
        const me = this.me();
        return !!(me && me.hp <= 0);
    }

    async disconnect() {
        if (!this.token) return;
        try { await this.request('/session', 'DELETE'); }
        finally { this.token = ''; this.id = ''; this.account = null; this.snapshot = null; this.tick = -1; this._pending = []; this._seenEventAt = -1; }
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = RaidClient;
if (typeof window !== 'undefined') /** @type {any} */ (window).RaidClient = RaidClient;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).RaidClient = RaidClient;
