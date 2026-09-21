// Online layer: accounts, friends, parties and matchmaking. These are the rules an online
// game lives or dies by, so they are pinned BEFORE any transport touches them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountStore, ACCOUNT_RULES } from '../server/accounts.mjs';
import { SocialGraph, PARTY_MAX, PARTY_MIN_TO_DEPLOY, INVITE_TTL_MS } from '../server/social.mjs';
import { Matchmaker, MIN_PLAYERS, MAX_PLAYERS, QUEUE_TIMEOUT_MS } from '../server/matchmaking.mjs';

// --- accounts ---------------------------------------------------------------

test('accounts: register, login and rejections are stable codes', () => {
    const store = new AccountStore();
    assert.equal(store.register('Raider_1', 'hunter2').ok, true);
    assert.equal(store.register('Raider_1', 'hunter2').error, 'name-taken', 'names are unique case-insensitively');
    assert.equal(store.register('raider_1', 'hunter2').error, 'name-taken');
    assert.equal(store.register('ab', 'hunter2').error, 'invalid-name', 'too short');
    assert.equal(store.register('has space', 'hunter2').error, 'invalid-name');
    assert.equal(store.register('GoodName', '123').error, 'invalid-password', 'too short');
    assert.equal(store.login('Raider_1', 'wrong').error, 'bad-credentials');
    assert.equal(store.login('nobody', 'hunter2').error, 'bad-credentials', 'no user enumeration');
    const ok = store.login('raider_1', 'hunter2');
    assert.equal(ok.ok, true);
    assert.ok(ok.token && ok.token.length > 10);
});

test('accounts: passwords are salted and never stored in clear', () => {
    const store = new AccountStore();
    store.register('Alpha', 'secret123');
    store.register('Bravo', 'secret123');
    const a = store.byName_('Alpha'), b = store.byName_('Bravo');
    assert.notEqual(a.hash, b.hash, 'identical passwords must not share a hash');
    assert.notEqual(a.salt, b.salt, 'salts must differ');
    assert.equal(JSON.stringify(a).includes('secret123'), false, 'the password must not be serialised');
});

test('accounts: sessions resolve, expire and do not leak between users', () => {
    let now = 1000;
    const store = new AccountStore({ sessionTtlMs: 100, now: () => now });
    store.register('Alpha', 'secret123');
    store.register('Bravo', 'secret123');
    const a = store.login('Alpha', 'secret123');
    const b = store.login('Bravo', 'secret123');
    assert.equal(store.resolve(a.token).name, 'Alpha');
    assert.equal(store.resolve(b.token).name, 'Bravo');
    assert.equal(store.resolve('garbage'), null);
    now += 101;
    assert.equal(store.resolve(a.token), null, 'an idle session must expire');
});

test('accounts: persistence round-trips through disk', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-accounts-'));
    try {
        const first = new AccountStore({ dir });
        first.register('Persisted', 'secret123');
        first.register('Friend', 'secret123');
        const graph = new SocialGraph({ accounts: first });
        graph.requestFriend(first.byName_('Persisted').id, 'Friend');
        graph.acceptFriend(first.byName_('Friend').id, 'Persisted');

        const reopened = new AccountStore({ dir });
        const account = reopened.byName_('Persisted');
        assert.ok(account, 'the account must survive a restart');
        assert.equal(account.friends.length, 1, 'friendship must survive a restart');
        // The password still verifies after a round trip.
        assert.equal(reopened.login('Persisted', 'secret123').ok, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('accounts: name rule is enforced as documented', () => {
    assert.ok(ACCOUNT_RULES.NAME_RE.test('Raider_1'));
    assert.ok(ACCOUNT_RULES.NAME_RE.test('abc'));
    assert.ok(!ACCOUNT_RULES.NAME_RE.test('ab'));
    assert.ok(!ACCOUNT_RULES.NAME_RE.test('<script>'));
});

// --- friends ----------------------------------------------------------------

function socialFixture() {
    const store = new AccountStore();
    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) store.register(name, 'secret123');
    const graph = new SocialGraph({ accounts: store });
    const id = (n) => store.byName_(n).id;
    return { store, graph, id };
}

test('friends: a request is not a friendship until it is accepted', () => {
    const { graph, id } = socialFixture();
    assert.equal(graph.requestFriend(id('Alpha'), 'Bravo').status, 'requested');
    assert.equal(graph.friends(id('Alpha')).length, 0, 'a pending request is not a friend');
    assert.equal(graph.friends(id('Bravo')).length, 0);
    const pending = graph.pendingRequests(id('Bravo'));
    assert.equal(pending.incoming.length, 1);
    assert.equal(pending.incoming[0].name, 'Alpha');

    assert.equal(graph.acceptFriend(id('Bravo'), 'Alpha').status, 'friends');
    assert.equal(graph.friends(id('Alpha')).length, 1);
    assert.equal(graph.friends(id('Bravo')).length, 1, 'friendship is symmetric');
});

test('friends: asking back accepts instead of stacking a second request', () => {
    const { graph, id } = socialFixture();
    graph.requestFriend(id('Alpha'), 'Bravo');
    const back = graph.requestFriend(id('Bravo'), 'Alpha');
    assert.equal(back.status, 'friends', 'a mutual ask completes the friendship');
    assert.equal(graph.friends(id('Alpha')).length, 1);
    assert.equal(graph.pendingRequests(id('Alpha')).outgoing.length, 0);
});

test('friends: unknown players, self-adds and duplicates are refused', () => {
    const { graph, id } = socialFixture();
    assert.equal(graph.requestFriend(id('Alpha'), 'Ghost').error, 'no-such-player');
    assert.equal(graph.requestFriend(id('Alpha'), 'Alpha').error, 'self');
    graph.requestFriend(id('Alpha'), 'Bravo');
    graph.acceptFriend(id('Bravo'), 'Alpha');
    assert.equal(graph.requestFriend(id('Alpha'), 'Bravo').error, 'already-friends');
});

test('friends: decline and remove both clean up both sides', () => {
    const { graph, id } = socialFixture();
    graph.requestFriend(id('Alpha'), 'Bravo');
    graph.declineFriend(id('Bravo'), 'Alpha');
    assert.equal(graph.pendingRequests(id('Bravo')).incoming.length, 0);
    assert.equal(graph.pendingRequests(id('Alpha')).outgoing.length, 0);

    graph.requestFriend(id('Alpha'), 'Bravo');
    graph.acceptFriend(id('Bravo'), 'Alpha');
    graph.removeFriend(id('Alpha'), 'Bravo');
    assert.equal(graph.friends(id('Alpha')).length, 0);
    assert.equal(graph.friends(id('Bravo')).length, 0);
});

// --- parties ----------------------------------------------------------------

test('parties: create, invite, accept, and the leader is enforced', () => {
    const { graph, id } = socialFixture();
    const created = graph.createParty(id('Alpha'));
    assert.equal(created.ok, true);
    assert.equal(created.party.leaderId, id('Alpha'));
    assert.equal(created.party.members.length, 1);

    // A player outside a party cannot invite at all; a NON-LEADER member is the case that
// reaches the 'not-leader' path, so put Bravo in the party before asserting that.
    assert.equal(graph.invite(id('Bravo'), 'Charlie').error, 'no-party', 'an outsider has no party to invite to');
    const firstInvite = graph.invite(id('Alpha'), 'Bravo');
    graph.acceptInvite(id('Bravo'), firstInvite.invite.id);
    assert.equal(graph.invite(id('Bravo'), 'Charlie').error, 'not-leader', 'only the leader invites');

    const inv = graph.invite(id('Alpha'), 'Charlie');
    assert.equal(inv.ok, true);
    assert.equal(graph.invitesFor(id('Charlie')).length, 1);

    assert.equal(graph.acceptInvite(id('Charlie'), inv.invite.id).ok, true);
    const view = graph.partyView(graph.partyOf(id('Alpha')));
    assert.equal(view.members.length, 3);
    assert.equal(view.canDeploy, true, 'three players may deploy');
    assert.equal(view.minToDeploy, PARTY_MIN_TO_DEPLOY);
});

test('parties: a solo party cannot deploy, and the cap is enforced', () => {
    const { graph, id } = socialFixture();
    graph.createParty(id('Alpha'));
    const solo = graph.partyView(graph.partyOf(id('Alpha')));
    assert.equal(solo.canDeploy, false, 'one player is below the minimum');

    for (const name of ['Bravo', 'Charlie', 'Delta']) {
        const inv = graph.invite(id('Alpha'), name);
        assert.equal(inv.ok, true, 'invite ' + name);
        graph.acceptInvite(id(name), inv.invite.id);
    }
    const full = graph.partyOf(id('Alpha'));
    assert.equal(full.members.length, PARTY_MAX);
    assert.equal(graph.invite(id('Alpha'), 'Alpha').ok, false, 'a full party cannot invite');
});

test('parties: leaving hands leadership over instead of leaving it leaderless', () => {
    const { graph, id } = socialFixture();
    graph.createParty(id('Alpha'));
    const inv = graph.invite(id('Alpha'), 'Bravo');
    graph.acceptInvite(id('Bravo'), inv.invite.id);

    const left = graph.leaveParty(id('Alpha'));
    assert.equal(left.ok, true);
    assert.equal(left.disbanded, undefined);
    assert.equal(left.party.leaderId, id('Bravo'), 'the remaining member leads');
    // And the last one out disbands the party entirely.
    const last = graph.leaveParty(id('Bravo'));
    assert.equal(last.disbanded, true);
    assert.equal(graph.getParty(left.party.id), null);
});

test('parties: invites expire and a queued party cannot be changed', () => {
    let now = 5000;
    const store = new AccountStore();
    store.register('Alpha', 'secret123');
    store.register('Bravo', 'secret123');
    const graph = new SocialGraph({ accounts: store, now: () => now });
    const id = (n) => store.byName_(n).id;
    graph.createParty(id('Alpha'));
    const inv = graph.invite(id('Alpha'), 'Bravo');
    now += INVITE_TTL_MS + 1;
    assert.equal(graph.invitesFor(id('Bravo')).length, 0, 'a stale invite disappears');
    assert.equal(graph.acceptInvite(id('Bravo'), inv.invite.id).error, 'no-invite');

    const fresh = graph.invite(id('Alpha'), 'Charlie');
    assert.equal(fresh.error, 'no-such-player');
});

test('parties: commander can transfer leadership and non-commander cannot', () => {
    const { graph, id } = socialFixture();
    graph.createParty(id('Alpha'));
    const inv = graph.invite(id('Alpha'), 'Bravo');
    graph.acceptInvite(id('Bravo'), inv.invite.id);

    // Non-commander cannot transfer
    assert.equal(graph.transferLeadership(id('Bravo'), id('Alpha')).error, 'not-leader');
    // Cannot transfer to someone not in party
    assert.equal(graph.transferLeadership(id('Alpha'), id('Charlie')).error, 'not-a-member');

    // Commander transfers to Bravo
    const res = graph.transferLeadership(id('Alpha'), id('Bravo'));
    assert.equal(res.ok, true);
    assert.equal(res.party.leaderId, id('Bravo'));

    const view = graph.partyView(graph.partyOf(id('Bravo')));
    const bravoMember = view.members.find(m => m.id === id('Bravo'));
    const alphaMember = view.members.find(m => m.id === id('Alpha'));
    assert.equal(bravoMember.leader, true);
    assert.equal(alphaMember.leader, false);
});

test('parties: member ready toggle and allReady status', () => {
    const { graph, id } = socialFixture();
    graph.createParty(id('Alpha'));
    const invB = graph.invite(id('Alpha'), 'Bravo');
    graph.acceptInvite(id('Bravo'), invB.invite.id);

    let view = graph.partyView(graph.partyOf(id('Alpha')));
    // Newly joined member is not ready by default
    assert.equal(view.allReady, false);
    const b1 = view.members.find(m => m.id === id('Bravo'));
    assert.equal(b1.ready, false);

    // Member sets ready = true
    const r1 = graph.setMemberReady(id('Bravo'), true);
    assert.equal(r1.ok, true);
    view = graph.partyView(graph.partyOf(id('Alpha')));
    assert.equal(view.allReady, true);
    const b2 = view.members.find(m => m.id === id('Bravo'));
    assert.equal(b2.ready, true);

    // Member sets ready = false
    graph.setMemberReady(id('Bravo'), false);
    view = graph.partyView(graph.partyOf(id('Alpha')));
    assert.equal(view.allReady, false);
});

// --- matchmaking ------------------------------------------------------------

test('matchmaking: solo players queue, wait for the minimum, then match together', () => {
    const mm = new Matchmaker();
    assert.equal(mm.enqueue('a').ok, true);
    assert.equal(mm.tryForm(), null, 'one player is below the minimum');
    assert.equal(mm.enqueue('a').error, 'already-queued', 'queueing twice is refused');
    assert.equal(mm.enqueue('b').ok, true);
    const match = mm.tryForm();
    assert.ok(match, 'two players must form a match');
    assert.equal(match.size, MIN_PLAYERS);
    assert.deepEqual(match.players.sort(), ['a', 'b']);
    assert.equal(mm.stats().tickets, 0, 'matched tickets leave the queue');
});

test('matchmaking: a party is matched whole or waits', () => {
    const mm = new Matchmaker({ minPlayers: 4 });
    const party = { id: 'p1', members: ['a', 'b', 'c'] };
    assert.equal(mm.enqueue('a', { party }).ok, true);
    // Queueing a party makes EVERY member queued, so re-queueing one is 'already-queued'
    // (not 'member-already-queued', which is the partial-overlap case below).
    assert.equal(mm.enqueue('b').error, 'already-queued', 'a queued party blocks its members');
    const overlap = new Matchmaker({ minPlayers: 4 });
    overlap.enqueue('x', { party: { id: 'p2', members: ['x', 'y'] } });
    assert.equal(overlap.enqueue('z', { party: { id: 'p3', members: ['z', 'y'] } }).error, 'member-already-queued');
    assert.equal(mm.tryForm(), null, '3 < min 4');
    mm.enqueue('d');
    const match = mm.tryForm();
    assert.ok(match);
    assert.equal(match.size, 4);
    assert.ok(match.players.includes('a') && match.players.includes('c'), 'the whole party is in the match');
});

test('matchmaking: the player cap is never exceeded, and a big party waits instead of splitting', () => {
    const mm = new Matchmaker({ minPlayers: 2, maxPlayers: 4 });
    const big = { id: 'p1', members: ['a', 'b', 'c', 'd'] };
    mm.enqueue('a', { party: big });
    mm.enqueue('e');
    const match = mm.tryForm();
    assert.ok(match);
    assert.equal(match.size, 4);
    assert.equal(match.players.includes('e'), false, 'a 5th player must not be crammed in');
    // The leftover solo player forms the next match once someone else arrives.
    mm.enqueue('f');
    const second = mm.tryForm();
    assert.ok(second, 'leftovers match on the next pass');
    assert.deepEqual(second.players.sort(), ['e', 'f']);
});

test('matchmaking: queue is FIFO and position is reported', () => {
    const mm = new Matchmaker({ minPlayers: 5 });
    mm.enqueue('first'); mm.enqueue('second'); mm.enqueue('third');
    assert.equal(mm.position('first').position, 1);
    assert.equal(mm.position('third').position, 3);
    assert.equal(mm.position('stranger'), null);
    assert.equal(mm.stats().players, 3);
});

test('matchmaking: cancelling frees the player, and timeouts drain the queue', () => {
    let now = 0;
    const mm = new Matchmaker({ minPlayers: 5, now: () => now });
    mm.enqueue('a');
    assert.equal(mm.cancel('a').ok, true);
    assert.equal(mm.position('a'), null);
    assert.equal(mm.cancel('a').error, 'not-queued');

    mm.enqueue('b'); mm.enqueue('c');
    now += QUEUE_TIMEOUT_MS + 1;
    const dropped = mm.reapExpired();
    assert.deepEqual(dropped.sort(), ['b', 'c']);
    assert.equal(mm.stats().players, 0);
    // A timed-out player must be able to queue again.
    assert.equal(mm.enqueue('b').ok, true);
});

test('matchmaking: an onMatch hook fires exactly once per formed match', () => {
    const seen = [];
    const mm = new Matchmaker({ onMatch: (m) => seen.push(m.id) });
    mm.enqueue('a'); mm.enqueue('b');
    mm.tryForm();
    assert.equal(seen.length, 1);
    assert.equal(mm.tryForm(), null, 'an empty queue forms nothing');
    assert.equal(seen.length, 1);
});