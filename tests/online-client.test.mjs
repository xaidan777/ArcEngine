// The browser transport against a real server: the whole online player journey.
// `loadScripts` runs the REAL js/RaidClient.js in a vm context, so this tests the shipped
// client, not a re-implementation of it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameServer } from '../server/main.mjs';
import { loadScripts } from './browser-scripts.mjs';

async function withServer(fn) {
    const server = createGameServer({ accountsDir: null });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const Client = loadScripts(['js/RaidClient.js'], { fetch, AbortSignal }).get('RaidClient');
    try { await fn(Client, url, server); }
    finally { await new Promise(r => { server.close(r); server.closeAllConnections(); }); }
}

test('client: register, fetch the world and read the lobby state', async () => {
    await withServer(async (Client, url) => {
        const c = new Client(url);
        const account = await c.register('Client_One', 'secret123');
        assert.equal(account.name, 'Client_One');
        assert.ok(c.token, 'a successful register leaves the client authenticated');
        assert.ok(c.world, 'the map must be fetched on connect');
        assert.equal(c.world.blockers.length > 20, true);
        assert.ok(c.seed !== null);

        c.account.credits = 999999;
        const authoritative = await c.refreshAccount();
        assert.equal(authoritative.credits, 0, 'refresh replaces client values with the server balance');
        assert.equal(c.account.credits, 0);

        const restored = new Client(url);
        const restoredAccount = await restored.restore(c.token);
        assert.equal(restoredAccount.id, account.id);
        assert.equal(restored.account.name, 'Client_One');
        assert.ok(restored.world, 'restoring a session must also restore the authoritative world');

        const health = await c.health();
        assert.equal(health.mode, 'authoritative-raid');
        assert.equal(health.match.minPlayers, 2);
    });
});

test('client: friends round trip through the transport', async () => {
    await withServer(async (Client, url) => {
        const a = new Client(url), b = new Client(url);
        await a.register('Friend_A', 'secret123');
        await b.register('Friend_B', 'secret123');

        await a.addFriend('Friend_B');
        let list = await a.friends();
        assert.equal(list.friends.length, 0, 'a request is not yet a friend');
        assert.equal(list.requests.outgoing.length, 1);

        const inbox = await b.friends();
        assert.equal(inbox.requests.incoming.length, 1);
        await b.acceptFriend('Friend_A');

        list = await a.friends();
        assert.equal(list.friends.length, 1);
        assert.equal(list.friends[0].name, 'Friend_B');
        assert.equal((await b.friends()).friends[0].name, 'Friend_A');

        await a.removeFriend('Friend_B');
        assert.equal((await a.friends()).friends.length, 0);
    });
});

test('client: automatic solo squads merge through an invitation without manual leave', async () => {
    await withServer(async (Client, url) => {
        const a = new Client(url), b = new Client(url);
        await a.register('AutoLead', 'secret123');
        await b.register('AutoMate', 'secret123');
        await a.ensureParty();
        await b.ensureParty();
        const original = (await a.party()).party.id;
        await a.ensureParty();
        assert.equal((await a.party()).party.id, original);
        const invite = await a.inviteToParty('AutoMate');
        await b.acceptPartyInvite(invite.invite.id);
        assert.equal((await b.party()).party.id, original);
        assert.equal((await a.party()).party.members.length, 2);
    });
});

test('client: party invite, accept and the deploy gate', async () => {
    await withServer(async (Client, url) => {
        const lead = new Client(url), mate = new Client(url);
        await lead.register('PartyLead', 'secret123');
        await mate.register('PartyMate', 'secret123');

        const created = await lead.createParty();
        assert.equal(created.party.canDeploy, false, 'solo cannot deploy');
        assert.equal(created.party.maxSize, 4);

        const invite = await lead.inviteToParty('PartyMate');
        assert.ok(invite.invite.id);
        const inbox = await mate.party();
        assert.equal(inbox.invites.length, 1);
        assert.equal(inbox.invites[0].fromName, 'PartyLead');

        await mate.acceptPartyInvite(invite.invite.id);
        const view = await lead.party();
        assert.equal(view.party.members.length, 2);
        assert.equal(view.party.canDeploy, true, 'two players unlock deployment');
        assert.equal(view.party.members.find(m => m.name === 'PartyLead').leader, true);

        await mate.leaveParty();
        assert.equal((await lead.party()).party.members.length, 1);
        assert.equal((await mate.party()).party, null);
    });
});

test('client: queue, get matched, then receive the shared authoritative raid', async () => {
    await withServer(async (Client, url) => {
        const a = new Client(url), b = new Client(url);
        await a.register('Raid_A', 'secret123');
        await b.register('Raid_B', 'secret123');

        await a.queue();
        const status = await a.matchStatus();
        assert.ok(status.position, 'a queued client knows its place in line');

        await b.queue();

        const raid = await a.waitForRaid({ timeoutMs: 8000, intervalMs: 100 });
        assert.ok(raid, 'two queued clients must be matched');
        assert.equal(raid.players, 2);

        // Both clients poll the same room and see each other plus the garrison.
        const [snapA, snapB] = await Promise.all([a.poll(), b.poll()]);
        assert.ok(Math.abs(snapA.tick - snapB.tick) <= 1, 'one authoritative clock');
        assert.equal(snapA.players.length, 2);
        assert.ok(snapA.enemies.length > 0, 'the raid reports its machines');
        assert.ok(a.objective(), 'the raid reports its objectives');
        assert.equal(a.me().id, a.id, 'me() resolves the local player from the token');
        assert.equal(a.me().id === b.me().id, false);

        // Input moves the player on the server.
        const before = a.me().y;
        for (let i = 0; i < 5; i++) await a.sendInput({ forward: 1, right: 0, heading: -Math.PI / 2 });
        await new Promise(r => setTimeout(r, 250));
        await a.poll();
        assert.notEqual(a.me().y, before, 'authoritative movement must happen server-side');
    });
});

test('client: disconnect releases the player from the raid', async () => {
    await withServer(async (Client, url, server) => {
        const a = new Client(url);
        await a.register('Leaver_Client', 'secret123');
        await a.queue();
        // A solo player is below the minimum, so waitForRaid would block; assert the queue
        // state directly and keep the test fast.
        const status = await a.matchStatus();
        assert.equal(status.raid, null, 'one player is below the minimum');
        assert.ok(status.position, 'but they are queued');
        assert.equal(server.arc.matchmaker.byPlayer.size, 1);

        await a.disconnect();
        assert.equal(a.token, '', 'disconnect clears the token');
        assert.equal(server.arc.matchmaker.byPlayer.size, 0, 'the queue entry is released');
        await assert.rejects(() => a.poll(), /not-connected/);
    });
});

test('client: a bad password surfaces as an error, not a silent success', async () => {
    await withServer(async (Client, url) => {
        const c = new Client(url);
        await c.register('Auth_Test', 'secret123');
        const other = new Client(url);
        await assert.rejects(() => other.login('Auth_Test', 'wrong-password'), /bad-credentials/);
        assert.equal(other.token, '', 'a failed login must not authenticate');
    });
});
