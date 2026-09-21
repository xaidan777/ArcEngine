import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { RaidRoom, TICK_RATE, PROTOCOL_VERSION } from './simulation.mjs';
import { AccountStore } from './accounts.mjs';
import { SocialGraph, PARTY_MAX } from './social.mjs';
import { Matchmaker, MIN_PLAYERS, MAX_PLAYERS } from './matchmaking.mjs';
import { attachWebSocket } from './ws.mjs';
import { summarizeRaid, PROGRESSION_RULES } from './progression.mjs';
import { validateAndMove, executeTraderBuy, executeSell, executeSellJunk } from './inventory.mjs';

// HTTP JSON transport for the online raid. Loopback development only.
//
// Layering: accounts/social/matchmaking hold the rules and know nothing about HTTP;
// this file only maps those rules onto routes, tokens and status codes. Every route that
// touches a player's own state resolves the ACCOUNT FROM THE BEARER TOKEN — no route accepts
// an account id, a position, HP, loot or a match result from the request body.
const MAX_BODY = 4096;

// How long a dropped player keeps their body (and their gear) in a live raid.
const RECONNECT_GRACE_MS = 90 * 1000;

// How long a finished raid stays queryable so every client can read the same outcome.
const RAID_RESULT_TTL_MS = 5 * 60 * 1000;

// Stable error code -> HTTP status. Keeping this table in one place means a new error code
// can never accidentally answer 200.
const STATUS = {
    'invalid-name': 400, 'invalid-password': 400, 'name-taken': 409, 'too-many-accounts': 503,
    'bad-credentials': 401, 'self': 400, 'no-such-player': 404, 'already-friends': 409,
    'friend-limit': 409, 'target-full': 409, 'no-request': 404,
    'no-party': 404, 'not-leader': 403, 'party-full': 409, 'party-queued': 409,
    'already-in-party': 409, 'no-invite': 404, 'party-gone': 404, 'not-a-member': 404,
    'cannot-kick-self': 400, 'already-queued': 409, 'not-queued': 404,
    'member-already-queued': 409, 'party-too-large': 409, 'invalid-input': 400,
    'members-not-ready': 409,
    'invalid-slots': 400, 'source-empty': 400, 'slot-incompatible': 400,
    'unknown-trader': 404, 'item-not-found': 404, 'not-enough-credits': 400, 'not-enough-cores': 400,
    'no-container': 404, 'already-searched': 409, 'out-of-range': 400,
    'no-skill-points': 400, 'invalid-branch': 400, 'invalid-skill': 400, 'already-learned': 409,
    'missing-prerequisite': 400, 'no-skills-to-reset': 400, 'insufficient-credits': 400,
    'invalid-contract': 404, 'already-active': 409, 'active-contracts-limit-reached': 409,
    'contract-not-active': 404, 'contract-not-completed': 400, 'invalid-station': 404,
    'max-level': 409, 'no-upgrade-cost': 400, 'missing-materials': 400, 'invalid-recipe': 404,
    'station-level-too-low': 400, 'not-eligible-for-free-kit': 400,
};

export function createGameServer({
    origin = ['http://localhost:8080', 'http://127.0.0.1:9378', 'http://localhost:9378'],
    seed = 7419,
    accountsDir = null,
    sessionTtlMs = 24 * 60 * 60 * 1000,
    minPlayers = MIN_PLAYERS,
    maxPlayers = MAX_PLAYERS,
} = {}) {
    const allowedOrigins = new Set((Array.isArray(origin) ? origin : String(origin).split(','))
        .map(value => value.trim()).filter(Boolean));
    const accounts = new AccountStore({ dir: accountsDir, sessionTtlMs });
    const social = new SocialGraph({ accounts });
    // Matches are formed by the tick loop, which then opens a raid room for them.
    const matchmaker = new Matchmaker({ minPlayers, maxPlayers });
    /** @type {Map<string, {room: RaidRoom, match: any, createdAt: number}>} */
    const raids = new Map();
    /** @type {Map<string, string>} accountId -> raidId of the raid they are in */
    const inRaid = new Map();
    // Legacy anonymous sessions (a client that never registered). Kept so the movement
    // sandbox and its tests still work while the online lobby grows around it.
    const anonymous = new Map();

    const server = http.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
        if (req.headers.origin && !allowedOrigins.has('*') && !allowedOrigins.has(req.headers.origin)) return reply(403, { error: 'origin' });
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin || (allowedOrigins.has('*') ? '*' : [...allowedOrigins][0] || 'null'));
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        const url = new URL(req.url, 'http://localhost');
        const route = url.pathname;
        const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
        const account = bearer ? accounts.resolve(bearer) : null;
        const needAuth = () => { if (!account) { reply(401, { error: 'session' }); return true; } return false; };

        // Read a bounded JSON body. Oversized or malformed input never reaches the rules.
        const readBody = async () => {
            let body = '';
            for await (const chunk of req) {
                body += chunk.toString();
                if (body.length > MAX_BODY) return { tooLarge: true };
            }
            try { return { value: body ? JSON.parse(body) : {} }; }
            catch { return { bad: true }; }
        };
        const fail = (code) => reply(STATUS[code] || 400, { error: code });

        // --- public ----------------------------------------------------------

        if (req.method === 'GET' && route === '/health') {
            const mm = matchmaker.stats();
            return reply(200, {
                ok: true, protocol: PROTOCOL_VERSION, seed, mode: 'authoritative-raid',
                accounts: accounts.accounts.size, online: anonymous.size,
                queue: mm, raids: raids.size,
                party: { max: PARTY_MAX, minToDeploy: MIN_PLAYERS },
                match: { minPlayers: mm.minPlayers, maxPlayers: mm.maxPlayers },
            });
        }

        if (req.method === 'GET' && route === '/world') {
            // The map a client must reproduce locally for collision. Public and seed-derived,
            // so serving it leaks nothing and removes a class of client/server desync.
            const room = ensureLobbyRoom();
            return reply(200, { version: PROTOCOL_VERSION, seed: room.seed, world: room.map });
        }

        // --- accounts --------------------------------------------------------

        if (req.method === 'POST' && route === '/register') {
            const parsed = await readBody();
            if (parsed.tooLarge) return reply(413, { error: 'body-too-large' });
            if (parsed.bad) return reply(400, { error: 'invalid-json' });
            const result = accounts.register(parsed.value.name, parsed.value.password);
            if (!result.ok) return fail(result.error);
            const token = accounts.createSession(result.account.id);
            return reply(201, { token, account: AccountStore.publicView(result.account) });
        }

        if (req.method === 'POST' && route === '/login') {
            const parsed = await readBody();
            if (parsed.tooLarge) return reply(413, { error: 'body-too-large' });
            if (parsed.bad) return reply(400, { error: 'invalid-json' });
            const result = accounts.login(parsed.value.name, parsed.value.password);
            if (!result.ok) return fail(result.error);
            return reply(200, { token: result.token, account: AccountStore.publicView(result.account) });
        }

        if (req.method === 'GET' && route === '/account') {
            if (needAuth()) return;
            return reply(200, { account: AccountStore.publicView(account) });
        }

        if (req.method === 'DELETE' && route === '/session') {
            if (account) {
                leaveEverything(account.id, { hard: true });
                accounts.logout(bearer);
                return reply(200, { ok: true });
            }
            // Anonymous movement-sandbox session: keep the old behaviour working.
            const session = anonymous.get(bearer);
            if (!session) return reply(401, { error: 'session' });
            session.room.players.delete(session.id);
            anonymous.delete(bearer);
            return reply(200, { ok: true });
        }

        // --- friends ---------------------------------------------------------

        if (route.startsWith('/friends')) {
            if (needAuth()) return;
            const id = account.id;

            if (req.method === 'GET' && route === '/friends') {
                return reply(200, {
                    friends: social.friends(id),
                    requests: social.pendingRequests(id),
                });
            }
            if (req.method === 'POST' && route === '/friends/request') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = social.requestFriend(id, parsed.value.name);
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/friends/accept') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = social.acceptFriend(id, parsed.value.name);
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/friends/decline') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = social.declineFriend(id, parsed.value.name);
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'DELETE' && route === '/friends') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = social.removeFriend(id, parsed.value.name);
                return result.ok ? reply(200, result) : fail(result.error);
            }
        }

        // --- party -----------------------------------------------------------

        if (route.startsWith('/party')) {
            if (needAuth()) return;
            const id = account.id;

            if (req.method === 'GET' && route === '/party') {
                const party = social.partyOf(id);
                return reply(200, {
                    party: social.partyView(party),
                    invites: social.invitesFor(id),
                    minToDeploy: MIN_PLAYERS,
                });
            }
            if (req.method === 'POST' && route === '/party') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const existing = social.partyOf(id);
                if (parsed.value.automatic && existing) return reply(200, { party: social.partyView(existing) });
                const result = social.createParty(id, parsed.value.automatic === true);
                return result.ok ? reply(201, { party: social.partyView(result.party) }) : fail(result.error);
            }
            if (req.method === 'DELETE' && route === '/party') {
                const result = social.leaveParty(id);
                return result.ok ? reply(200, { ok: true, party: result.party ? social.partyView(result.party) : null }) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/party/decline') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = social.declineInvite(id, parsed.value.inviteId);
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/party/invite') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = social.invite(id, parsed.value.name);
                return result.ok ? reply(200, { invite: result.invite }) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/party/accept') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = social.acceptInvite(id, parsed.value.inviteId);
                return result.ok ? reply(200, { party: social.partyView(result.party) }) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/party/kick') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const target = accounts.byName_(parsed.value.name);
                if (!target) return fail('no-such-player');
                const result = social.kick(id, target.id);
                return result.ok ? reply(200, { ok: true }) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/party/promote') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const target = accounts.byName_(parsed.value.name);
                if (!target) return fail('no-such-player');
                const result = social.transferLeadership(id, target.id);
                return result.ok ? reply(200, { ok: true, party: social.partyView(result.party) }) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/party/ready') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const ready = parsed.value.ready !== undefined ? !!parsed.value.ready : true;
                const result = social.setMemberReady(id, ready);
                return result.ok ? reply(200, { ok: true, party: social.partyView(result.party) }) : fail(result.error);
            }
        }

        // --- inventory & economy ---------------------------------------------

        if (route.startsWith('/inventory')) {
            if (needAuth()) return;

            if (req.method === 'GET' && route === '/inventory') {
                return reply(200, AccountStore.inventoryView(account));
            }
            if (req.method === 'POST' && route === '/inventory/move') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = validateAndMove(account, parsed.value.from, parsed.value.to);
                if (result.ok) accounts.save();
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/inventory/sell') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = executeSell(account, parsed.value);
                if (result.ok) accounts.save();
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/inventory/sell-junk') {
                const result = executeSellJunk(account);
                if (result.ok) accounts.save();
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/inventory/free-kit') {
                const result = accounts.claimFreeKit(account.id);
                return result.ok ? reply(200, result) : fail(result.error);
            }
        }

        if (route.startsWith('/progression')) {
            if (needAuth()) return;

            if (req.method === 'GET' && route === '/progression') {
                return reply(200, AccountStore.progressionView(account));
            }
            if (req.method === 'POST' && route === '/progression/skill') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = accounts.allocateSkill(account.id, parsed.value.branchId, parsed.value.skillId);
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/progression/respec') {
                const result = accounts.respecSkills(account.id);
                return result.ok ? reply(200, result) : fail(result.error);
            }
        }

        if (route.startsWith('/contracts')) {
            if (needAuth()) return;

            if (req.method === 'GET' && route === '/contracts') {
                return reply(200, {
                    active: account.contracts?.active || [],
                    completed: account.contracts?.completed || [],
                    available: Object.values(PROGRESSION_RULES.CONTRACT_DEFINITIONS || {})
                });
            }
            if (req.method === 'POST' && route === '/contracts/accept') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = accounts.acceptContract(account.id, parsed.value.contractId);
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/contracts/claim') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = accounts.claimContract(account.id, parsed.value.contractId);
                return result.ok ? reply(200, result) : fail(result.error);
            }
        }

        if (route.startsWith('/workshop')) {
            if (needAuth()) return;

            if (req.method === 'POST' && route === '/workshop/upgrade') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = accounts.upgradeWorkshopStation(account.id, parsed.value.stationId);
                return result.ok ? reply(200, result) : fail(result.error);
            }
            if (req.method === 'POST' && route === '/workshop/craft') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = accounts.craftItem(account.id, parsed.value.recipeId);
                return result.ok ? reply(200, result) : fail(result.error);
            }
        }

        if (route.startsWith('/traders')) {
            if (needAuth()) return;

            if (req.method === 'POST' && route === '/traders/buy') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const result = executeTraderBuy(account, parsed.value.traderId, parsed.value.slotIndex);
                if (result.ok) accounts.save();
                return result.ok ? reply(200, result) : fail(result.error);
            }
        }

        // --- matchmaking -----------------------------------------------------

        if (route.startsWith('/match')) {
            if (needAuth()) return;
            const id = account.id;

            if (req.method === 'POST' && route === '/match/queue') {
                const parsed = await readBody();
                if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
                const party = social.partyOf(id);
                if (party) {
                    if (party.leaderId !== id) return fail('not-leader');
                    const view = social.partyView(party);
                    if (!view.allReady) return fail('members-not-ready');
                }
                // The party queues whole; a solo player is a party of one.
                const result = party
                    ? matchmaker.enqueue(id, { party })
                    : matchmaker.enqueue(id);
                if (!result.ok) return fail(result.error);
                if (party) { party.queued = true; accounts.save(); }
                return reply(200, { ticket: result.ticket, queue: matchmaker.stats() });
            }

            if (req.method === 'DELETE' && route === '/match/queue') {
                const result = matchmaker.cancel(id);
                const party = social.partyOf(id);
                if (party && party.leaderId === id) { party.queued = false; accounts.save(); }
                return result.ok ? reply(200, { ok: true }) : fail(result.error);
            }

            if (req.method === 'GET' && route === '/match/status') {
                const raidId = inRaid.get(id);
                const raid = raidId ? raids.get(raidId) : null;
                return reply(200, {
                    position: matchmaker.position(id),
                    queue: matchmaker.stats(),
                    raid: raid ? { id: raid.match.id, seed: raid.match.seed, players: raid.match.players.length, state: 'active' } : null,
                });
            }
        }

        // --- in-raid ---------------------------------------------------------

        // Surrender. The player gives up; the server marks the casualty and answers with the
        // raid's state, so the client never decides by itself that the raid is over.
        if (route === '/raid/surrender' && req.method === 'POST') {
            if (needAuth()) return;
            const raidId = inRaid.get(account.id);
            const raid = raidId ? raids.get(raidId) : null;
            if (!raid) return reply(200, { ok: true, raid: null, outcome: null, note: 'not-in-raid' });
            const result = raid.room.surrender(account.id);
            if (!result.ok) return fail(result.error);
            return reply(200, { ok: true, ended: !!result.ended, outcome: result.outcome, snapshot: raid.room.snapshot() });
        }

        // Call the transport. Range and availability are validated by the room.
        if (route === '/raid/extract' && req.method === 'POST') {
            if (needAuth()) return;
            const raidId = inRaid.get(account.id);
            const raid = raidId ? raids.get(raidId) : null;
            if (!raid) return reply(200, { ok: false, error: 'not-in-raid' });
            // Distinguish 'the raid is over' from 'you are not in it': the room has already
            // evicted a finished player's body, so the raw error would say 'no-player'.
            if (raid.room.state !== 'active') return reply(409, { ok: false, error: 'raid-over' });
            const result = raid.room.requestExtraction(account.id);
            return reply(result.ok ? 200 : 409, result.ok ? result : { error: result.error });
        }

        // The authoritative result of the raid a player is in (or was last in): the outcome the
        // server decided, plus the payout it applied. A client reads its reward from here
        // instead of computing one, and a client that never played the raid has no raid to read.
        if (route === '/raid/result' && req.method === 'GET') {
            if (needAuth()) return;
            const raidId = inRaid.get(account.id);
            const raid = raidId ? raids.get(raidId) : null;
            if (!raid) return reply(404, { ok: false, error: 'not-in-raid', result: null });
            const record = (raid.room.outcome && raid.room.outcome.tallies && raid.room.outcome.tallies[account.id]) || null;
            return reply(200, {
                ok: true,
                raidId,
                state: raid.room.state,
                outcome: raid.room.outcome || null,
                // The wallet after settlement, so a client can render the result screen from
                // server truth even if it missed the socket push.
                credits: account.credits,
                stats: account.stats,
                tally: record,
                settled: !!raid.settled,
            });
        }

        // Search a loot crate. The server owns the contents and the range check, so the value
        // that ends up in the payout is one the client could not have invented.
        if (route === '/raid/search' && req.method === 'POST') {
            if (needAuth()) return;
            const parsed = await readBody();
            if (parsed.bad || parsed.tooLarge) return reply(400, { error: 'invalid-json' });
            const raidId = inRaid.get(account.id);
            const raid = raidId ? raids.get(raidId) : null;
            if (!raid) return fail('not-in-raid');
            const containerId = parsed.value && parsed.value.containerId;
            const result = raid.room.search(account.id, Number(containerId));
            // `lootType` rather than `type`: the HTTP body has no envelope to protect, but the
            // client reads one shape from both transports, so the field name must match.
            if (!result.ok) return fail(result.error);
            const { type: lootType, ...rest } = result;
            return reply(200, { ...rest, lootType });
        }

        if (route === '/raid/reconnect' && req.method === 'POST') {
            if (needAuth()) return;
            const raidId = inRaid.get(account.id);
            const raid = raidId ? raids.get(raidId) : null;
            if (!raid) return reply(200, { ok: false, error: 'no-raid' });
            if (raid.room.state !== 'active') return reply(409, { ok: false, error: 'raid-over' });
            const player = raid.room.reconnect(account.id, Date.now());
            if (!player) return reply(410, { ok: false, error: 'grace-expired' });
            return reply(200, { ok: true, snapshot: raid.room.snapshot() });
        }

        if (route === '/snapshot' && req.method === 'GET') {
            const room = roomFor(account, bearer);
            if (!room) return reply(401, { error: 'session' });
            return reply(200, room.snapshot());
        }

        if (route === '/input' && req.method === 'POST') {
            const room = roomFor(account, bearer);
            if (!room) return reply(401, { error: 'session' });
            const parsed = await readBody();
            if (parsed.tooLarge) return reply(413, { error: 'input-too-large' });
            if (parsed.bad) return reply(400, { error: 'invalid-json' });
            const id = account ? account.id : anonymous.get(bearer).id;
            const accepted = room.input(id, parsed.value);
            return reply(accepted ? 200 : 400, accepted ? room.snapshot() : { error: 'invalid-input' });
        }

        // Anonymous join for the movement sandbox / tests: no account required.
        //
        // ALWAYS THE LOBBY. This used to take `[...raids.values()][0]?.room` — the first ACTIVE
        // RAID — so one unauthenticated POST /sessions inserted a guest body into a live ranked
        // match: it could move, fire real projectiles, and stand on drives to steal the squad's
        // objective. A guest is not in `inRaid`, so it could not be paid or end the raid, but
        // "an extra gun that steals your drives" is a griefing vector, not a sandbox.
        if (req.method === 'POST' && route === '/sessions') {
            const room = ensureLobbyRoom();
            if (anonymous.size >= MAX_PLAYERS) return reply(409, { error: 'room-full' });
            const token = 'anon_' + Math.random().toString(36).slice(2, 12);
            const id = 'guest_' + Math.random().toString(36).slice(2, 10);
            const snapshot = room.join(id);
            anonymous.set(token, { id, room, lastSeen: Date.now() });
            return reply(201, { token, id, snapshot });
        }

        return reply(404, { error: 'route' });
    });

    // The sandbox room used by anonymous clients and by tests that never log in.
    let lobbyRoom = null;
    function ensureLobbyRoom() {
        if (!lobbyRoom) lobbyRoom = new RaidRoom({ seed });
        return lobbyRoom;
    }

    // Resolve the room a caller should talk to: their raid if matched, the lobby otherwise.
    function roomFor(account, token) {
        if (account) {
            const raidId = inRaid.get(account.id);
            if (raidId && raids.has(raidId)) return raids.get(raidId).room;
            // Not matched yet: let them exist in the lobby so a solo client still moves.
            const lobby = ensureLobbyRoom();
            if (!lobby.players.has(account.id)) { try { lobby.join(account.id); } catch { /* full */ } }
            return lobby;
        }
        const session = anonymous.get(token);
        return session ? session.room : null;
    }

    // Remove a player from every system they may be sitting in.
    // A player's session ended. Queue and party are released immediately because they are lobby
// state, but a RAID body is kept for a grace window: a dropped connection should not cost
// someone their gear the instant their network blinks. `hard` (an explicit surrender or a
// finished raid) evicts at once.
    function leaveEverything(id, { hard = false, nowMs = Date.now() } = {}) {
        matchmaker.cancel(id);
        const party = social.partyOf(id);
        if (party) {
            if (party.leaderId === id) party.queued = false;
            social.leaveParty(id);
        }
        const raidId = inRaid.get(id);
        if (raidId) {
            const raid = raids.get(raidId);
            if (raid) {
                if (hard || raid.room.state !== 'active') {
                    raid.room.players.delete(id);
                    raid.match.players = raid.match.players.filter(p => p !== id);
                } else {
                    // Keep the body; mark it dropped so the room stops taking its input.
                    raid.room.markDisconnected(id, RECONNECT_GRACE_MS, nowMs);
                }
                if (raid.match.players.length === 0) raids.delete(raidId);
            }
            if (hard) inRaid.delete(id);
        }
        if (lobbyRoom) lobbyRoom.players.delete(id);
    }

    // Turn a finished raid into credits and career stats for every participant. Called on the
    // tick loop, but guarded twice: the room must have an outcome, and the ledger refuses a
    // raidId it has already applied. A raid is therefore paid exactly once, no matter how many
    // ticks pass or how many clients poll the result.
    function settleRaid(raidId, raid) {
        const outcome = raid.room.outcome;
        if (!outcome) return;
        if (raid.settled) return;
        raid.settled = true;

        // A minute of grace: a raid can end while a player is mid-reconnect, and their tally is
        // still in the outcome. Paying on the first pass keeps the wallet in step with the
        // result the client is about to be shown.
        // Computed ONCE for the whole raid: the rows do not depend on which player is being
        // credited, and doing it per player made this O(players^2).
        const rows = summarizeRaid(outcome, outcome.tallies || {});
        for (const playerId of raid.match.players) {
            const account = accounts.accounts.get(playerId);
            if (!account) continue;   // an anonymous session has no wallet to credit
            const row = rows.find(r => r.playerId === playerId);
            if (!row) continue;
            const applied = accounts.applyRaidResult(playerId, {
                raidId,
                extracted: row.extracted,
                kills: row.kills,
                deaths: row.deaths,
                value: row.value,
            });
            if (applied && applied.ok && !applied.duplicate) {
                const ws = socketsByPlayer.get(playerId);
                if (ws && !ws.closed) {
                    // Push the result so the client never has to compute its own reward.
                    sendWs(ws, { type: 'payout', raidId, credits: applied.account.credits, stats: applied.account.stats, value: row.value, extracted: row.extracted });
                }
            }
        }
        accounts.save();
    }

    // A formed match becomes a raid that clients can immediately talk to.
    matchmaker.onMatch = (match) => {
        const raidSeed = seed + match.id.length + match.players.length;
        const room = new RaidRoom({ seed: raidSeed });
        match.seed = raidSeed;
        for (const playerId of match.players) {
            try { room.join(playerId); } catch { /* already in or full */ }
        }
        raids.set(match.id, { room, match, createdAt: Date.now() });
        for (const playerId of match.players) {
            inRaid.set(playerId, match.id);
            const partyId = social.memberOf.get(playerId);
            if (partyId) { const p = social.parties.get(partyId); if (p) p.queued = false; }
            // A player leaving the lobby must not be simulated twice.
            if (lobbyRoom) lobbyRoom.players.delete(playerId);
        }
        // The departing squad stops being queued.
        for (const playerId of match.players) {
            const party = social.partyOf(playerId);
            if (party) party.queued = false;
        }
        accounts.save();

        // Tell the matched clients immediately over their socket. Without this a queued player
        // only discovers the raid by noticing the tick change on the next snapshot — up to a
        // second of the raid lost, and no clear "your match is ready" moment for the client to
        // act on (deploy, hide the queue screen, reset the local world).
        for (const playerId of match.players) {
            const ws = socketsByPlayer.get(playerId);
            if (ws && !ws.closed) {
                sendWs(ws, {
                    type: 'matched',
                    raidId: match.id,
                    seed: raidSeed,
                    players: match.players,
                    // The map is resent so the client cannot be left without the world it is
                    // about to be simulated in, even if its earlier fetch failed.
                    world: room.map,
                    at: Date.now(),
                });
            }
        }
    };

    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    let last = performance.now(), accumulator = 0;
    const timer = setInterval(() => {
        const now = performance.now();
        accumulator += Math.min(0.1, (now - last) / 1000); last = now;
        while (accumulator >= 1 / TICK_RATE) {
            for (const raid of raids.values()) raid.room.step();
            if (lobbyRoom) lobbyRoom.step();
            // Form matches on the simulation clock so queueing is deterministic under load.
            matchmaker.tryForm();
            accumulator -= 1 / TICK_RATE;
        }
        matchmaker.reapExpired();
        // A timed-out party queue must release the party itself, not only its players. The
        // `queued` flag otherwise stayed set and every party action (ready-up, invite,
        // leadership transfer) answered `party-queued`, so the squad could never launch again.
        for (const partyId of matchmaker.reapedParties || []) {
            const party = social.parties.get(partyId);
            if (party && party.queued) party.queued = false;
        }
        accounts.reapSessions();
        // Grace windows and finished raids. A raid that has ended and lost every player, or
        // whose bodies have all timed out, is collected here so memory cannot creep.
        const nowMs = Date.now();
        for (const [raidId, raid] of raids) {
            for (const id of raid.room.reapDisconnected(nowMs)) {
                raid.match.players = raid.match.players.filter(p => p !== id);
                inRaid.delete(id);
            }
            // PAY OUT as soon as the raid has an outcome. This runs on the server's own clock,
            // from the server's own outcome — the client cannot influence what it earns, and
            // `applyRaidResult` is idempotent by raidId so a repeated pass cannot pay twice.
            settleRaid(raidId, raid);
            // A finished raid is collected once every player has read the outcome. The TTL is
            // a backstop: without it a client that stops polling would pin the room forever.
            const age = nowMs - (raid.room.outcome ? raid.room.outcome.at : raid.createdAt);
            if (raid.room.state === 'ended' && (raid.match.players.length === 0 || age > RAID_RESULT_TTL_MS)) {
                for (const id of raid.match.players) inRaid.delete(id);
                raids.delete(raidId);
            }
        }
        for (const [token, session] of anonymous) {
            if (Date.now() - session.lastSeen > 30000) {
                session.room.players.delete(session.id);
                anonymous.delete(token);
            }
        }
    }, 1000 / TICK_RATE);
    timer.unref();
    server.on('close', () => clearInterval(timer));

    // --- WebSocket transport -------------------------------------------------
    // The same rooms, the same rules, a push instead of a poll. A client opens ONE socket,
    // authenticates once, and from then on sends INPUT and receives SNAPSHOTS as they are
    // produced by the tick loop — no per-tick HTTP request and no request/response latency.
    //
    // HTTP is kept: it is the fallback transport, what the tests use, and what a client with
    // a blocked WebSocket falls back to. The two share `roomFor`, so they cannot disagree.
    const socketsByPlayer = new Map();   // accountId -> WsSocket

    const wsHub = attachWebSocket(server, {
        path: '/ws',
        onConnect: (ws) => { ws.meta = { account: null, playerId: null, lastError: null }; },
        onClose: (ws) => {
            const id = ws.meta && ws.meta.playerId;
            if (!id) return;
            if (socketsByPlayer.get(id) === ws) socketsByPlayer.delete(id);
            // A dropped socket keeps the body for the grace window (same rule as HTTP).
            leaveEverything(id, { nowMs: Date.now() });
        },
        onMessage: (ws, text) => {
            let message = null;
            try { message = JSON.parse(text); }
            catch { return sendWs(ws, { type: 'error', error: 'invalid-json' }); }
            if (!message || typeof message.type !== 'string') {
                return sendWs(ws, { type: 'error', error: 'invalid-message' });
            }

            // 1. Authentication. A token in the FIRST message only; later frames are bound to
            //    the resolved account, so a client cannot switch identity mid-raid.
            if (message.type === 'auth') {
                const account = accounts.resolve(String(message.token || ''));
                if (!account) return sendWs(ws, { type: 'error', error: 'session' });
                ws.meta.account = account;
                ws.meta.playerId = account.id;
                // One live socket per player: a second connection evicts the first.
                const existing = socketsByPlayer.get(account.id);
                if (existing && existing !== ws) existing.close(1000, 'superseded');
                socketsByPlayer.set(account.id, ws);
                const room = roomFor(account, null);
                return sendWs(ws, {
                    type: 'ready', protocol: PROTOCOL_VERSION, id: account.id,
                    seed: room ? room.seed : seed, world: room ? room.map : null,
                });
            }

            if (!ws.meta.playerId) return sendWs(ws, { type: 'error', error: 'not-authenticated' });

            // 2. Intent. Identical validation path to POST /input.
            if (message.type === 'input') {
                const room = roomFor(ws.meta.account, null);
                if (!room) return sendWs(ws, { type: 'error', error: 'no-room' });
                const accepted = room.input(ws.meta.playerId, message.command);
                // Rejected input is reported, never silently dropped: a desynced client must
                // be able to see that its sequence went backwards.
                if (!accepted) sendWs(ws, { type: 'inputRejected', sequence: message.command && message.command.sequence });
                return;
            }

            // 3. Raid actions.
            // A loot search is an ACTION, validated against the room's own map. The client asks;
            // the server decides whether the crate is in reach and what it contained.
            if (message.type === 'search') {
                const raidId = inRaid.get(ws.meta.playerId);
                const raid = raidId ? raids.get(raidId) : null;
                if (!raid) return sendWs(ws, { type: 'action', action: 'search', ok: false, error: 'not-in-raid' });
                const result = raid.room.search(ws.meta.playerId, Number(message.containerId));
                // The loot TYPE must be nested, not spread: the room result carries its own
                // `type` (the item kind), and spreading it here overwrote the envelope's
                // `type: 'action'`, so the client never recognised the reply at all.
                const { type: lootType, ...rest } = result;
                return sendWs(ws, { type: 'action', action: 'search', containerId: message.containerId, lootType, ...rest });
            }

            if (message.type === 'surrender' || message.type === 'extract' || message.type === 'reconnect') {
                const raidId = inRaid.get(ws.meta.playerId);
                const raid = raidId ? raids.get(raidId) : null;
                if (!raid) return sendWs(ws, { type: 'action', action: message.type, ok: false, error: 'not-in-raid' });
                if (raid.room.state !== 'active') {
                    return sendWs(ws, { type: 'action', action: message.type, ok: false, error: 'raid-over' });
                }
                if (message.type === 'surrender') {
                    const result = raid.room.surrender(ws.meta.playerId);
                    return sendWs(ws, { type: 'action', action: 'surrender', ...result });
                }
                if (message.type === 'extract') {
                    const result = raid.room.requestExtraction(ws.meta.playerId);
                    return sendWs(ws, { type: 'action', action: 'extract', ...result });
                }
                const player = raid.room.reconnect(ws.meta.playerId, Date.now());
                return sendWs(ws, { type: 'action', action: 'reconnect', ok: !!player, error: player ? null : 'grace-expired' });
            }

            // 4. An explicit snapshot request, for a client that wants one immediately.
            if (message.type === 'snapshot') {
                const room = roomFor(ws.meta.account, null);
                if (room) sendWs(ws, { type: 'snapshot', snapshot: room.snapshot() });
                return;
            }

            sendWs(ws, { type: 'error', error: 'unknown-type' });
        },
        // A game snapshot fits comfortably; the protocol cap protects the server.
        heartbeatMs: 30000,
    });

    function sendWs(ws, payload) {
        if (!ws || ws.closed) return false;
        const ok = ws.send(JSON.stringify(payload));
        if (!ok && !ws.closed) {
            ws.meta.lastError = 'send-failed';
        }
        return ok;
    }

    // Push the world to every authenticated socket. Runs on the SAME tick loop that advances
    // the rooms, so a snapshot always describes the tick it was taken on.
    const PUSH_EVERY_TICKS = Math.max(1, Math.round(TICK_RATE / 20));   // 20 Hz
    let pushCounter = 0;
    const pushTimer = setInterval(() => {
        if (++pushCounter % PUSH_EVERY_TICKS !== 0) return;
        const nowMs = Date.now();
        for (const [playerId, ws] of socketsByPlayer) {
            if (ws.closed) { socketsByPlayer.delete(playerId); continue; }
            const raidId = inRaid.get(playerId);
            const raid = raidId ? raids.get(raidId) : null;
            const room = raid ? raid.room : null;
            if (!room) continue;   // queued or idle: nothing to stream yet
            sendWs(ws, {
                type: 'snapshot',
                snapshot: room.snapshot(),
                // The client compares this against its own clock to estimate latency.
                sentAt: nowMs,
            });
        }
    }, 1000 / TICK_RATE);
    pushTimer.unref();
    server.on('close', () => clearInterval(pushTimer));

    // Expose the internals for tests and for the transports.
    server.arc = {
        accounts, social, matchmaker, raids, inRaid,
        get lobbyRoom() { return lobbyRoom; },
        leaveEverything, wsHub, socketsByPlayer, sendWs,
    };
    return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const host = process.env.HOST || '0.0.0.0';
    const port = Number(process.env.PORT || 8787);
    const server = createGameServer({
        origin: process.env.CLIENT_ORIGIN || '*',
        seed: Number(process.env.RAID_SEED || 7419),
        accountsDir: process.env.ACCOUNTS_DIR || null,
    });
    server.listen(port, host, () => {
        console.log(`ArcEngine raid server: http://${host}:${port}`);
        console.log('  accounts: ' + (process.env.ACCOUNTS_DIR || 'in-memory (set ACCOUNTS_DIR to persist)'));
    });
}
