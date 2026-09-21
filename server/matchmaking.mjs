// matchmaking.mjs — queueing and match formation for the online raid.
//
// Rules encoded here (all of them are gameplay decisions, so they are exported as data):
//   * SOLO and PARTY queue into the same pool;
//   * a match needs at least MIN_PLAYERS and admits at most MAX_PLAYERS;
//   * a party is matched WHOLE or not at all — splitting a squad across two raids would be
//     a bug, not a feature;
//   * the queue is drained oldest-first, so a patient player is not starved by a fresh one;
//   * a ticket can time out, and a party whose ticket is dropped must be marked un-queued or
//     it could never queue again.
//
// The matcher never touches sessions, sockets or the room: it hands back a ticket and lets
// the transport create the raid. That keeps it unit-testable with no network at all.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_PARTY = 4;
export const QUEUE_TIMEOUT_MS = 5 * 60 * 1000;

export class Matchmaker {
    // opts: { minPlayers, maxPlayers, now, onMatch }
    constructor({ minPlayers = MIN_PLAYERS, maxPlayers = MAX_PLAYERS, now = () => Date.now(), onMatch = null } = {}) {
        this.minPlayers = minPlayers;
        this.maxPlayers = maxPlayers;
        this.now = now;
        this.onMatch = onMatch;
        /** @type {Map<string, any>} ticketId -> ticket */
        this.tickets = new Map();
        /** @type {Map<string, string>} accountId -> ticketId (a player queues once) */
        this.byPlayer = new Map();
        this._seq = 0;
        this.matches = [];
        /** @type {string[]} party ids whose ticket was just reaped; the caller clears their flag */
        this.reapedParties = [];
    }

    /** Queue a single player. Returns the ticket, or a stable error code. */
    enqueue(playerId, { party = null, mode = 'raid', rating = 0 } = {}) {
        if (this.byPlayer.has(playerId)) return { ok: false, error: 'already-queued' };
        if (party) {
            // The whole party queues under one ticket; every member must be free.
            const members = party.members || [];
            if (members.length > MAX_PARTY) return { ok: false, error: 'party-too-large' };
            for (const m of members) if (this.byPlayer.has(m)) return { ok: false, error: 'member-already-queued' };
            const ticket = this._ticket(members, { mode, rating, partyId: party.id });
            for (const m of members) this.byPlayer.set(m, ticket.id);
            return { ok: true, ticket };
        }
        const ticket = this._ticket([playerId], { mode, rating, partyId: null });
        this.byPlayer.set(playerId, ticket.id);
        return { ok: true, ticket };
    }

    _ticket(members, { mode, rating, partyId }) {
        const ticket = {
            id: 'q_' + (++this._seq),
            members: [...members],
            size: members.length,
            mode,
            rating,
            partyId,
            queuedAt: this.now(),
            state: 'queued',
        };
        this.tickets.set(ticket.id, ticket);
        return ticket;
    }

    cancel(playerId) {
        const ticketId = this.byPlayer.get(playerId);
        if (!ticketId) return { ok: false, error: 'not-queued' };
        const ticket = this.tickets.get(ticketId);
        if (ticket) {
            ticket.state = 'cancelled';
            this.tickets.delete(ticketId);
            for (const m of ticket.members) this.byPlayer.delete(m);
        }
        return { ok: true };
    }

    position(playerId) {
        const ticketId = this.byPlayer.get(playerId);
        if (!ticketId) return null;
        const ordered = this._ordered();
        const index = ordered.findIndex(t => t.id === ticketId);
        return { ticketId, position: index + 1, waiting: ordered.length, queuedAt: this.tickets.get(ticketId)?.queuedAt };
    }

    // Oldest first: FIFO keeps waiting times honest.
    _ordered() {
        return [...this.tickets.values()]
            .filter(t => t.state === 'queued')
            .sort((a, b) => a.queuedAt - b.queuedAt || (a.id < b.id ? -1 : 1));
    }

    // Try to form ONE match from the current queue. Returns the match or null.
    // Called from the server tick; deterministic given the same queue.
    tryForm() {
        const queue = this._ordered();
        if (queue.length === 0) return null;

        const totalPlayers = queue.reduce((n, t) => n + t.size, 0);
        if (totalPlayers < this.minPlayers) return null;

        const picked = [];
        let players = 0;
        for (const ticket of queue) {
            // Never exceed the cap; a party that would overflow waits for the next raid.
            if (players + ticket.size > this.maxPlayers) continue;
            picked.push(ticket);
            players += ticket.size;
            if (players >= this.maxPlayers) break;
        }
        // Not enough AFTER respecting party integrity (e.g. a 4-stack and a cap of 4 with a
        // 5th player waiting): form what we can only if it meets the minimum.
        if (players < this.minPlayers) return null;

        const match = {
            id: 'match_' + (++this._seq),
            tickets: picked.map(t => t.id),
            players: picked.flatMap(t => t.members),
            createdAt: this.now(),
            size: players,
        };
        for (const ticket of picked) {
            ticket.state = 'matched';
            this.tickets.delete(ticket.id);
            for (const m of ticket.members) this.byPlayer.delete(m);
        }
        this.matches.push(match);
        if (this.onMatch) this.onMatch(match);
        return match;
    }

    // Drop tickets that waited too long, and release their players. Returns the dropped ids.
    // Each dropped ticket also reports the party it belonged to, so the caller can clear the
    // party's `queued` flag — without that the party stayed "queued" forever after a timeout,
    // and `SocialGraph` refuses every recovery action (ready-up, invite, transfer) with
    // `party-queued`, leaving the squad permanently unable to launch.
    reapExpired() {
        const now = this.now();
        const dropped = [];
        this.reapedParties = [];
        for (const [id, ticket] of this.tickets) {
            if (now - ticket.queuedAt > QUEUE_TIMEOUT_MS) {
                dropped.push(...ticket.members);
                if (ticket.partyId) this.reapedParties.push(ticket.partyId);
                this.tickets.delete(id);
                for (const m of ticket.members) this.byPlayer.delete(m);
            }
        }
        return dropped;
    }

    stats() {
        const queue = this._ordered();
        return {
            tickets: queue.length,
            players: queue.reduce((n, t) => n + t.size, 0),
            parties: queue.filter(t => t.partyId).length,
            minPlayers: this.minPlayers,
            maxPlayers: this.maxPlayers,
            matchesFormed: this.matches.length,
        };
    }
}