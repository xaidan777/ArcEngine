// social.mjs — friends, invites and parties. Zero dependencies, fully in-memory, and
// deliberately testable without a network: every method takes ids and returns plain data.
//
// Design rules that matter for an online game:
//   * friendship is SYMMETRIC and must be accepted by both sides — a request is not a friend;
//   * a party has ONE leader, a hard member cap, and the leader is the only one who may
//     invite or kick;
//   * every operation is idempotent where that is meaningful (inviting twice does not queue
//     two invites) because the client may retry after a dropped response;
//   * nothing here reads the network or the clock beyond Date.now() for display fields.

export const PARTY_MAX = 4;
export const PARTY_MIN_TO_DEPLOY = 2;
export const FRIEND_MAX = 100;
export const INVITE_TTL_MS = 60 * 1000;

export class SocialGraph {
    // accounts: an AccountStore (or anything with get/accounts/save). When absent the graph
    // still works — it just keeps social state only for the lifetime of the process.
    constructor({ accounts = null, now = () => Date.now() } = {}) {
        this.accounts = accounts;
        this.now = now;
        /** @type {Map<string, any>} partyId -> party */
        this.parties = new Map();
        /** @type {Map<string, string>} accountId -> partyId */
        this.memberOf = new Map();
        /** @type {Map<string, any>} inviteId -> invite (pending party invites) */
        this.invites = new Map();
        /** @type {Map<string, {from: string, to: string, at: number}>} friend request key */
        this.requests = new Map();
    }

    // --- helpers -------------------------------------------------------------

    _account(id) {
        if (this.accounts && this.accounts.get) {
            const a = this.accounts.get(id);
            if (a) return a;
        }
        // Fall back to a lazily created stub so the graph is usable without accounts.
        if (!this._stubs) this._stubs = new Map();
        if (!this._stubs.has(id)) this._stubs.set(id, { id, name: id, friends: [], incoming: [], outgoing: [], partyId: null });
        return this._stubs.get(id);
    }

    _persist() { if (this.accounts && this.accounts.save) this.accounts.save(); }

    static pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

    // --- friends -------------------------------------------------------------

    friends(id) {
        const account = this._account(id);
        return (account.friends || []).map(fid => {
            const other = this.accounts && this.accounts.get ? this.accounts.get(fid) : null;
            return other
                ? { id: other.id, name: other.name, online: this.accounts.isOnline?.(other.id) || false, lastSeen: other.lastSeen }
                : { id: fid, name: fid, online: false, lastSeen: 0 };
        });
    }

    // Send a friend request. Returns a stable code so the transport maps it to HTTP.
    requestFriend(fromId, toName) {
        if (fromId === toName) return { ok: false, error: 'self' };
        const target = this.accounts && this.accounts.byName_ ? this.accounts.byName_(toName) : null;
        if (!target) return { ok: false, error: 'no-such-player' };
        if (target.id === fromId) return { ok: false, error: 'self' };
        const from = this._account(fromId);
        if ((from.friends || []).includes(target.id)) return { ok: false, error: 'already-friends' };
        if ((from.friends || []).length >= FRIEND_MAX) return { ok: false, error: 'friend-limit' };
        if ((target.friends || []).length >= FRIEND_MAX) return { ok: false, error: 'target-full' };

        // If they already asked us, this is an acceptance: no second request to accept.
        const reverse = SocialGraph.pairKey(fromId, target.id);
        const existing = this.requests.get(reverse);
        if (existing && existing.from === target.id) return this.acceptFriend(fromId, target.name);

        this.requests.set(reverse, { from: fromId, to: target.id, at: this.now() });
        from.outgoing = [...new Set([...(from.outgoing || []), target.id])];
        target.incoming = [...new Set([...(target.incoming || []), fromId])];
        this._persist();
        return { ok: true, status: 'requested', target: { id: target.id, name: target.name } };
    }

    acceptFriend(id, fromName) {
        const requester = this.accounts && this.accounts.byName_ ? this.accounts.byName_(fromName) : null;
        if (!requester) return { ok: false, error: 'no-such-player' };
        const key = SocialGraph.pairKey(id, requester.id);
        const request = this.requests.get(key);
        if (!request || request.from !== requester.id) return { ok: false, error: 'no-request' };
        this.requests.delete(key);

        const me = this._account(id);
        me.friends = [...new Set([...(me.friends || []), requester.id])];
        requester.friends = [...new Set([...(requester.friends || []), id])];
        me.incoming = (me.incoming || []).filter(x => x !== requester.id);
        requester.outgoing = (requester.outgoing || []).filter(x => x !== id);
        this._persist();
        return { ok: true, status: 'friends', friend: { id: requester.id, name: requester.name } };
    }

    declineFriend(id, fromName) {
        const requester = this.accounts && this.accounts.byName_ ? this.accounts.byName_(fromName) : null;
        if (!requester) return { ok: false, error: 'no-such-player' };
        this.requests.delete(SocialGraph.pairKey(id, requester.id));
        const me = this._account(id);
        me.incoming = (me.incoming || []).filter(x => x !== requester.id);
        requester.outgoing = (requester.outgoing || []).filter(x => x !== id);
        this._persist();
        return { ok: true, status: 'declined' };
    }

    removeFriend(id, friendName) {
        const other = this.accounts && this.accounts.byName_ ? this.accounts.byName_(friendName) : null;
        if (!other) return { ok: false, error: 'no-such-player' };
        const me = this._account(id);
        me.friends = (me.friends || []).filter(x => x !== other.id);
        other.friends = (other.friends || []).filter(x => x !== id);
        this._persist();
        return { ok: true, status: 'removed' };
    }

    pendingRequests(id) {
        const me = this._account(id);
        const nameOf = (fid) => {
            const a = this.accounts && this.accounts.get ? this.accounts.get(fid) : null;
            return a ? a.name : fid;
        };
        return {
            incoming: (me.incoming || []).map(fid => ({ id: fid, name: nameOf(fid) })),
            outgoing: (me.outgoing || []).map(fid => ({ id: fid, name: nameOf(fid) })),
        };
    }

    // --- parties -------------------------------------------------------------

    createParty(leaderId, automatic = false) {
        if (this.memberOf.has(leaderId)) return { ok: false, error: 'already-in-party' };
        const id = 'party_' + Math.random().toString(36).slice(2, 10);
        const party = { id, leaderId, members: [leaderId], createdAt: this.now(), queued: false, automatic, ready: { [leaderId]: true } };
        this.parties.set(id, party);
        this.memberOf.set(leaderId, id);
        const account = this._account(leaderId);
        account.partyId = id;
        this._persist();
        return { ok: true, party };
    }

    getParty(partyId) { return this.parties.get(partyId) || null; }
    partyOf(id) { const pid = this.memberOf.get(id); return pid ? this.parties.get(pid) || null : null; }

    // Invite a player. Only the leader may invite; the target must not already be in a party.
    invite(leaderId, targetName) {
        const party = this.partyOf(leaderId);
        if (!party) return { ok: false, error: 'no-party' };
        if (party.leaderId !== leaderId) return { ok: false, error: 'not-leader' };
        if (party.members.length >= PARTY_MAX) return { ok: false, error: 'party-full' };
        if (party.queued) return { ok: false, error: 'party-queued' };
        const target = this.accounts && this.accounts.byName_ ? this.accounts.byName_(targetName) : null;
        if (!target) return { ok: false, error: 'no-such-player' };
        const targetParty = this.partyOf(target.id);
        if (targetParty && !(targetParty.automatic && targetParty.members.length === 1 && !targetParty.queued && targetParty.id !== party.id)) return { ok: false, error: 'already-in-party' };

        // One live invite per (party, player): retrying must not stack duplicates.
        for (const inv of this.invites.values()) {
            if (inv.partyId === party.id && inv.to === target.id && !inv.accepted) {
                return { ok: true, invite: inv, repeat: true };
            }
        }
        const invite = {
            id: 'inv_' + Math.random().toString(36).slice(2, 10),
            partyId: party.id,
            from: leaderId,
            to: target.id,
            at: this.now(),
            accepted: false,
        };
        this.invites.set(invite.id, invite);
        return { ok: true, invite };
    }

    // Invites for a player, with expired ones dropped.
    invitesFor(id) {
        this.reapInvites();
        return [...this.invites.values()]
            .filter(i => i.to === id && !i.accepted)
            .map(i => {
                const from = this.accounts && this.accounts.get ? this.accounts.get(i.from) : null;
                return { id: i.id, partyId: i.partyId, from: i.from, fromName: from ? from.name : i.from, at: i.at };
            });
    }

    reapInvites() {
        const now = this.now();
        for (const [id, invite] of this.invites) {
            if (!invite.accepted && now - invite.at > INVITE_TTL_MS) this.invites.delete(id);
        }
    }

    declineInvite(id, inviteId) {
        const invite = this.invites.get(inviteId);
        if (!invite || invite.to !== id) return { ok: false, error: 'no-invite' };
        this.invites.delete(inviteId);
        return { ok: true };
    }

    acceptInvite(id, inviteId) {
        this.reapInvites();
        const invite = this.invites.get(inviteId);
        if (!invite || invite.to !== id || invite.accepted) return { ok: false, error: 'no-invite' };
        const party = this.parties.get(invite.partyId);
        if (!party) { this.invites.delete(inviteId); return { ok: false, error: 'party-gone' }; }
        const currentParty = this.partyOf(id);
        if (currentParty && !(currentParty.automatic && currentParty.members.length === 1 && !currentParty.queued && currentParty.id !== party.id)) return { ok: false, error: 'already-in-party' };
        if (party.members.length >= PARTY_MAX) return { ok: false, error: 'party-full' };
        if (party.queued) return { ok: false, error: 'party-queued' };

        if (currentParty) this.leaveParty(id);
        party.members.push(id);
        party.ready = party.ready || {};
        party.ready[id] = false;
        this.memberOf.set(id, party.id);
        const account = this._account(id);
        account.partyId = party.id;
        invite.accepted = true;
        this.invites.delete(inviteId);
        // Any other pending invite for this player is now moot.
        for (const [otherId, other] of this.invites) if (other.to === id) this.invites.delete(otherId);
        this._persist();
        return { ok: true, party };
    }

    leaveParty(id) {
        const party = this.partyOf(id);
        if (!party) return { ok: false, error: 'no-party' };
        party.members = party.members.filter(m => m !== id);
        if (party.ready) delete party.ready[id];
        this.memberOf.delete(id);
        const account = this._account(id);
        account.partyId = null;

        // The leader leaving hands over, so a party is never leaderless while it has members.
        if (party.leaderId === id) {
            party.leaderId = party.members[0] || null;
            if (party.leaderId && party.ready) party.ready[party.leaderId] = true;
        }
        if (party.members.length === 0) {
            this.parties.delete(party.id);
            for (const [inviteId, inv] of this.invites) if (inv.partyId === party.id) this.invites.delete(inviteId);
            this._persist();
            return { ok: true, disbanded: true };
        }
        this._persist();
        return { ok: true, party };
    }

    kick(leaderId, memberId) {
        const party = this.partyOf(leaderId);
        if (!party) return { ok: false, error: 'no-party' };
        if (party.leaderId !== leaderId) return { ok: false, error: 'not-leader' };
        if (memberId === leaderId) return { ok: false, error: 'cannot-kick-self' };
        if (!party.members.includes(memberId)) return { ok: false, error: 'not-a-member' };
        return this.leaveParty(memberId);
    }

    // Transfer squad leadership. Only current leader can transfer to an existing member.
    transferLeadership(leaderId, targetId) {
        const party = this.partyOf(leaderId);
        if (!party) return { ok: false, error: 'no-party' };
        if (party.leaderId !== leaderId) return { ok: false, error: 'not-leader' };
        if (leaderId === targetId) return { ok: true, party };
        if (!party.members.includes(targetId)) return { ok: false, error: 'not-a-member' };
        if (party.queued) return { ok: false, error: 'party-queued' };

        party.leaderId = targetId;
        party.ready = party.ready || {};
        party.ready[targetId] = true;
        this._persist();
        return { ok: true, party };
    }

    // Member toggles ready/not ready. Leader is always considered ready.
    setMemberReady(memberId, ready = true) {
        const party = this.partyOf(memberId);
        if (!party) return { ok: false, error: 'no-party' };
        if (party.queued) return { ok: false, error: 'party-queued' };
        if (!party.members.includes(memberId)) return { ok: false, error: 'not-a-member' };

        party.ready = party.ready || {};
        party.ready[memberId] = memberId === party.leaderId ? true : !!ready;
        this._persist();
        return { ok: true, party };
    }

    // The party as the client sees it, with names resolved.
    partyView(party) {
        if (!party) return null;
        const nameOf = (id) => {
            const a = this.accounts && this.accounts.get ? this.accounts.get(id) : null;
            return a ? a.name : id;
        };
        party.ready = party.ready || {};
        const nonLeaders = party.members.filter(id => id !== party.leaderId);
        const allReady = nonLeaders.length === 0 || nonLeaders.every(id => !!party.ready[id]);
        return {
            id: party.id,
            leaderId: party.leaderId,
            queued: !!party.queued,
            members: party.members.map(id => ({
                id,
                name: nameOf(id),
                leader: id === party.leaderId,
                ready: id === party.leaderId ? true : !!party.ready[id],
            })),
            minToDeploy: PARTY_MIN_TO_DEPLOY,
            maxSize: PARTY_MAX,
            allReady,
            canDeploy: party.members.length >= PARTY_MIN_TO_DEPLOY,
        };
    }
}
