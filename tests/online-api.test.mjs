// The online HTTP API end to end: register, login, friends, party, matchmaking and the raid.
// This exercises the REAL transport, so it also proves the routes, status codes and tokens
// are wired to the rules rather than only testing the rules in isolation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameServer } from '../server/main.mjs';

async function withServer(fn, opts = {}) {
    const server = createGameServer({ accountsDir: null, ...opts });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const api = async (path, { method = 'GET', token, body } = {}) => {
        const res = await fetch(url + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        let json = null;
        try { json = await res.json(); } catch { /* empty body */ }
        return { status: res.status, body: json };
    };
    try { await fn(api, server, url); }
    finally { await new Promise(r => { server.close(r); server.closeAllConnections(); }); }
}

const reg = async (api, name) => {
    const r = await api('/register', { method: 'POST', body: { name, password: 'secret123' } });
    assert.equal(r.status, 201, 'register ' + name + ': ' + JSON.stringify(r.body));
    return r.body.token;
};

test('online: register and login return a token, and bad credentials are refused', async () => {
    await withServer(async (api) => {
        const token = await reg(api, 'Operator');
        assert.ok(token);
        const account = await api('/account', { token });
        assert.equal(account.status, 200);
        assert.equal(account.body.account.name, 'Operator');
        assert.equal((await api('/account')).status, 401, 'account restore must require a valid session');
        assert.equal((await api('/register', { method: 'POST', body: { name: 'Operator', password: 'secret123' } })).status, 409);
        assert.equal((await api('/login', { method: 'POST', body: { name: 'Operator', password: 'nope' } })).status, 401);
        assert.equal((await api('/login', { method: 'POST', body: { name: 'Ghost', password: 'secret123' } })).status, 401);
        const login = await api('/login', { method: 'POST', body: { name: 'operator', password: 'secret123' } });
        assert.equal(login.status, 200, 'login is case-insensitive on the name');
        assert.ok(login.body.account.id);
    });
});

test('online: protected routes require a token', async () => {
    await withServer(async (api) => {
        for (const [path, method] of [['/friends', 'GET'], ['/party', 'GET'], ['/match/status', 'GET']]) {
            assert.equal((await api(path, { method })).status, 401, path + ' must require auth');
        }
        assert.equal((await api('/friends', { token: 'bogus' })).status, 401);
    });
});

test('online: friend presence follows sessions and invitations can be declined only by recipient', async () => {
    await withServer(async (api) => {
        const a = await reg(api, 'PresenceA');
        const b = await reg(api, 'PresenceB');
        await api('/friends/request', { method: 'POST', token: a, body: { name: 'PresenceB' } });
        await api('/friends/accept', { method: 'POST', token: b, body: { name: 'PresenceA' } });
        assert.equal((await api('/friends', { token: a })).body.friends[0].online, true);
        await api('/party', { method: 'POST', token: a });
        const invite = await api('/party/invite', { method: 'POST', token: a, body: { name: 'PresenceB' } });
        const body = { inviteId: invite.body.invite.id };
        assert.equal((await api('/party/decline', { method: 'POST', token: a, body })).status, 404);
        assert.equal((await api('/party/decline', { method: 'POST', token: b, body })).status, 200);
        assert.equal((await api('/party', { token: b })).body.invites.length, 0);
        await api('/session', { method: 'DELETE', token: b });
        assert.equal((await api('/friends', { token: a })).body.friends[0].online, false);
    });
});

test('online: a friend request must be accepted, and both sides see it', async () => {
    await withServer(async (api) => {
        const a = await reg(api, 'Alpha');
        const b = await reg(api, 'Bravo');

        const req = await api('/friends/request', { method: 'POST', token: a, body: { name: 'Bravo' } });
        assert.equal(req.status, 200);
        assert.equal((await api('/friends', { token: a })).body.friends.length, 0, 'pending is not a friend yet');

        const bList = await api('/friends', { token: b });
        assert.equal(bList.body.requests.incoming.length, 1);
        assert.equal(bList.body.requests.incoming[0].name, 'Alpha');

        assert.equal((await api('/friends/accept', { method: 'POST', token: b, body: { name: 'Alpha' } })).status, 200);
        assert.equal((await api('/friends', { token: a })).body.friends[0].name, 'Bravo');
        assert.equal((await api('/friends', { token: b })).body.friends[0].name, 'Alpha');

        assert.equal((await api('/friends/request', { method: 'POST', token: a, body: { name: 'Ghost' } })).status, 404);
    });
});

test('online: party invite flow over HTTP, with the leader rule enforced', async () => {
    await withServer(async (api) => {
        const a = await reg(api, 'Leader');
        const b = await reg(api, 'Wingman');
        const c = await reg(api, 'Outsider');

        const made = await api('/party', { method: 'POST', token: a });
        assert.equal(made.status, 201);
        assert.equal(made.body.party.canDeploy, false, 'a solo party cannot deploy');
        assert.equal(made.body.party.minToDeploy, 2);

        // Only the leader may invite.
        assert.equal((await api('/party/invite', { method: 'POST', token: c, body: { name: 'Wingman' } })).status, 404);

        const inv = await api('/party/invite', { method: 'POST', token: a, body: { name: 'Wingman' } });
        assert.equal(inv.status, 200);
        const inviteId = inv.body.invite.id;

        const inbox = await api('/party', { token: b });
        assert.equal(inbox.body.invites.length, 1);
        assert.equal(inbox.body.invites[0].fromName, 'Leader');

        assert.equal((await api('/party/accept', { method: 'POST', token: b, body: { inviteId } })).status, 200);
        const view = await api('/party', { token: a });
        assert.equal(view.body.party.members.length, 2);
        assert.equal(view.body.party.canDeploy, true, 'two players may deploy');

        // The other member cannot invite, and cannot be kicked by a non-leader.
        assert.equal((await api('/party/invite', { method: 'POST', token: b, body: { name: 'Outsider' } })).status, 403);
        assert.equal((await api('/party/kick', { method: 'POST', token: b, body: { name: 'Leader' } })).status, 403);
        assert.equal((await api('/party/kick', { method: 'POST', token: a, body: { name: 'Wingman' } })).status, 200);
        assert.equal((await api('/party', { token: b })).body.party, null, 'a kicked player is free');
    });
});

test('online: queueing needs a token, a leader for a party, and reports position', async () => {
    await withServer(async (api) => {
        assert.equal((await api('/match/queue', { method: 'POST' })).status, 401);

        const solo = await reg(api, 'Solo');
        const q = await api('/match/queue', { method: 'POST', token: solo });
        assert.equal(q.status, 200);
        const status = await api('/match/status', { token: solo });
        assert.ok(status.body.position, 'a queued player has a position');
        assert.equal(status.body.queue.players, 1);
        assert.equal((await api('/match/queue', { method: 'DELETE', token: solo })).status, 200);
        assert.equal((await api('/match/status', { token: solo })).body.position, null);
        assert.equal((await api('/match/queue', { method: 'DELETE', token: solo })).status, 404);
    });
});

test('online: two queued players are matched into a raid they can both talk to', async () => {
    await withServer(async (api, server) => {
        const a = await reg(api, 'Duo_A');
        const b = await reg(api, 'Duo_B');
        assert.equal((await api('/match/queue', { method: 'POST', token: a })).status, 200);
        assert.equal((await api('/match/queue', { method: 'POST', token: b })).status, 200);

        // The tick loop forms the match; wait for it rather than assuming a tick count.
        let raid = null;
        for (let i = 0; i < 60 && !raid; i++) {
            await new Promise(r => setTimeout(r, 50));
            const s = await api('/match/status', { token: a });
            raid = s.body.raid;
        }
        assert.ok(raid, 'the matchmaker must form a raid from two queued players');
        assert.equal(raid.players, 2);
        assert.equal(server.arc.raids.size, 1);

        // Both clients now see the SAME authoritative raid, with the garrison in it.
        const [snapA, snapB] = await Promise.all([
            api('/snapshot', { token: a }),
            api('/snapshot', { token: b })
        ]);
        assert.equal(snapA.status, 200);
        assert.equal(snapB.status, 200);
        assert.ok(Math.abs(snapA.body.tick - snapB.body.tick) <= 2, 'one raid, one clock');
        assert.equal(snapA.body.players.length, 2, 'both players are in the same room');
        assert.ok(snapA.body.enemies.length > 0, 'the raid has machines');
        assert.ok(snapA.body.objective, 'the raid has objectives');

        // They left the queue and the party bookkeeping is clean.
        assert.equal((await api('/match/status', { token: a })).body.position, null);
    });
});

test('online: a party queues as one ticket and enters the same raid', async () => {
    await withServer(async (api, server) => {
        const lead = await reg(api, 'SquadLead');
        const mate = await reg(api, 'SquadMate');
        const other = await reg(api, 'Pug');

        await api('/party', { method: 'POST', token: lead });
        const inv = await api('/party/invite', { method: 'POST', token: lead, body: { name: 'SquadMate' } });
        await api('/party/accept', { method: 'POST', token: mate, body: { inviteId: inv.body.invite.id } });

        // The leader queues the whole party; a member queueing alone is refused.
        assert.equal((await api('/match/queue', { method: 'POST', token: mate })).status, 403);

        // A squad cannot deploy until every member has confirmed readiness: queueing with an
        // unready member is refused, so nobody is dragged into a raid they did not accept.
        const blocked = await api('/match/queue', { method: 'POST', token: lead });
        assert.equal(blocked.status, 409);
        assert.equal(blocked.body.error, 'members-not-ready');

        // The member marks ready, and now the leader can queue the squad.
        assert.equal((await api('/party/ready', { method: 'POST', token: mate, body: { ready: true } })).status, 200);
        // Queue the party and the third player together so they enter the same match.
        const [qLead, qOther] = await Promise.all([
            api('/match/queue', { method: 'POST', token: lead }),
            api('/match/queue', { method: 'POST', token: other })
        ]);
        assert.equal(qLead.status, 200);
        assert.equal(qOther.status, 200);

        let snap = null;
        for (let i = 0; i < 100 && !snap; i++) {
            await new Promise(r => setTimeout(r, 50));
            const s = await api('/snapshot', { token: mate });
            if (s.status === 200 && s.body.players.length >= 3) snap = s.body;
        }
        assert.ok(snap, 'all three must end up in one raid');
        assert.equal(snap.players.length, 3);
        // The party is no longer queued once it is in a raid.
        const party = await api('/party', { token: lead });
        assert.equal(party.body.party.queued, false);
    });
});

test('online: a client cannot forge match results, loot or position over HTTP', async () => {
    await withServer(async (api, server) => {
        const a = await reg(api, 'Cheater');
        await api('/match/queue', { method: 'POST', token: a });
        await new Promise(r => setTimeout(r, 80));

        // Try to inject state through both the input route and a bogus route.
        const forged = await api('/input', {
            method: 'POST', token: a,
            body: { version: 2, sequence: 0, forward: 0, right: 0, heading: 0, sprint: false, x: 4000, y: 4000, hp: 9999, credits: 999999, extracted: true },
        });
        assert.ok(forged.status === 200 || forged.status === 400, 'the input route never writes forged state');
        const snap = await api('/snapshot', { token: a });
        const me = snap.body.players.find(p => p.id !== undefined);
        assert.ok(me.hp <= 100, 'HP stays server-owned');
        assert.ok(me.x < 4000, 'position stays server-owned');
        assert.equal(snap.body.objective.collected, 0, 'objective progress stays server-owned');

        // There is no route that accepts a declared raid outcome.
        assert.equal((await api('/raid/finish', { method: 'POST', token: a, body: { won: true } })).status, 404);
    });
});

test('online: leaving cleans up party, queue and raid membership', async () => {
    await withServer(async (api, server) => {
        const a = await reg(api, 'Leaver');
        const b = await reg(api, 'Stayer');
        const party = await api('/party', { method: 'POST', token: a });
        assert.equal(party.status, 201);
        await api('/match/queue', { method: 'POST', token: a });
        // b is not in a match; log out a and confirm nothing dangles.
        assert.equal((await api('/session', { method: 'DELETE', token: a })).status, 200);
        assert.equal(server.arc.matchmaker.byPlayer.has(party.body.party.members[0]), false, 'queue entry released');
        assert.equal(server.arc.social.parties.size, 0, 'party disbanded');
        // The token is dead.
        assert.equal((await api('/friends', { token: a })).status, 401);
    });
});

test('online: /health reports the lobby state a client needs before joining', async () => {
    await withServer(async (api) => {
        const health = await api('/health');
        assert.equal(health.status, 200);
        assert.equal(health.body.mode, 'authoritative-raid');
        assert.equal(health.body.match.minPlayers, 2);
        assert.equal(health.body.match.maxPlayers, 8);
        assert.equal(health.body.party.max, 4);
        assert.ok(health.body.accounts >= 0);
    });
});

test('online: the anonymous sandbox join still works for the legacy client', async () => {
    await withServer(async (api) => {
        const join = await api('/sessions', { method: 'POST' });
        assert.equal(join.status, 201);
        assert.ok(join.body.token && join.body.id);
        const snap = await api('/snapshot', { token: join.body.token });
        assert.equal(snap.status, 200);
        assert.ok(snap.body.players.length >= 1);
        assert.equal((await api('/session', { method: 'DELETE', token: join.body.token })).status, 200);
    });
});
