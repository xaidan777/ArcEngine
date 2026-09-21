// Server-authoritative progression: the payout rules and the account ledger.
//
// Online, the client used to compute its own reward (js/RaidRules.js), so a modified client
// could claim any payout it liked. These tests pin the properties that make the server the
// only source of money: a win beats a loss for the same raid, a raidId pays exactly once,
// the career accumulates, garbage input cannot mint or destroy credits, and the public
// profile exposes the wallet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountStore, ACCOUNT_RULES } from '../server/accounts.mjs';
import { raidPayout, summarizeRaid, PAYOUT, MAX_PAYOUT_CREDITS, safeInt } from '../server/progression.mjs';

// A store with one registered account, addressed by name for readability.
function storeWith(name = 'Raider_1') {
    const store = new AccountStore();
    store.register(name, 'hunter2');
    return { store, id: store.byName_(name).id, account: store.byName_(name) };
}

// A settled win, as the transport would forward it.
const winResult = (raidId = 'raid-1', extra = {}) =>
    ({ raidId, won: true, extracted: true, kills: 2, deaths: 0, drives: 1, value: 600, ...extra });

// --- pure payout rules ------------------------------------------------------

test('payout: a win beats a loss for the same raid, and the floor is the survival bonus', () => {
    const won = raidPayout({ won: true, drives: 2, kills: 3, extracted: true, backpackValue: 900 });
    const lost = raidPayout({ won: false, drives: 2, kills: 3, extracted: false, backpackValue: 900 });
    assert.ok(won.credits > lost.credits, 'extracting must always beat dying');
    assert.ok(lost.credits > 0, 'a loss still pays a consolation for the kills');
    // The loss pays kills only: no loot, no drives, no survival bonus.
    assert.equal(lost.breakdown.lootPayout, 0, 'loot dropped with the body is worth nothing');
    assert.equal(lost.breakdown.drivePayout, 0, 'drives are only banked on a win');
    assert.equal(lost.breakdown.extraction, 0);
    assert.equal(won.breakdown.extraction, PAYOUT.extractionBonus);
    assert.equal(won.credits, won.breakdown.total, 'credits is the itemised total');
    // Losing the same kill-building raid and extracting it must not pay the same: the gap is
    // the survival bonus plus the drives plus the loot, all of which a death forfeits.
    assert.equal(won.credits - lost.credits,
        PAYOUT.extractionBonus + 2 * PAYOUT.driveValue + 900 + 3 * (PAYOUT.killValue - PAYOUT.lossKillValue));
});

test('payout: each unit of extraction value is worth at least one unit of consolation', () => {
    // The economic invariant: one credit of loot carried out can never be worth less than
    // one credit paid for dying, so a client has no incentive to prefer a loss.
    const loss = raidPayout({ won: false, drives: 9, kills: 20, extracted: false, backpackValue: 50000 });
    const win = raidPayout({ won: true, drives: 9, kills: 20, extracted: true, backpackValue: 0 });
    assert.ok(win.credits > loss.credits, 'the same raid pays strictly more when extracted');
    assert.equal(loss.breakdown.lootPayout, 0);
    assert.equal(win.breakdown.killPayout, 20 * PAYOUT.killValue);
});

test('payout: credits are always a non-negative integer, even for absurd input', () => {
    const nasty = raidPayout({ won: true, drives: NaN, kills: -5, extracted: true, backpackValue: -1000 });
    assert.equal(nasty.credits, PAYOUT.extractionBonus, 'NaN and negatives are coerced to 0');
    assert.ok(Number.isInteger(nasty.credits));
    assert.ok(nasty.credits >= 0);
    // Infinity and strings are handled the same way, and the result is capped.
    const huge = raidPayout({ won: true, drives: Infinity, kills: '3', extracted: true, backpackValue: Infinity });
    assert.ok(Number.isInteger(huge.credits) && huge.credits >= 0);
    assert.ok(huge.credits <= MAX_PAYOUT_CREDITS, 'a corrupted room cannot mint unbounded money');
    assert.equal(raidPayout().credits, 0, 'no argument at all is a lootless loss');
    assert.equal(raidPayout(null).credits, 0);
    assert.equal(safeInt(-3), 0);
    assert.equal(safeInt('7'), 7);
    assert.equal(safeInt(NaN), 0);
});

test('summarizeRaid: only survivors are paid, and drives go to those who extracted', () => {
    const outcome = { won: true, reason: 'extraction', survivors: ['a'], casualties: ['b'], drives: 3 };
    const share = summarizeRaid(outcome, [{ id: 'a', kills: 4, deaths: 0 }, { id: 'b', kills: 1, deaths: 1 }]);
    assert.equal(share.length, 2);
    const a = share.find(r => r.playerId === 'a');
    const b = share.find(r => r.playerId === 'b');
    assert.equal(a.won, true);
    assert.equal(a.extracted, true);
    assert.equal(a.drives, 3, 'the survivor banks the objective');
    assert.equal(a.value, raidPayout({ won: true, drives: 3, kills: 4, extracted: true }).credits);
    assert.equal(b.won, false, 'a casualty of a won raid still lost their kit');
    assert.equal(b.extracted, false);
    assert.equal(b.drives, 0);
    assert.ok(b.value < a.value);
    assert.equal(b.deaths, 1);
});

test('summarizeRaid: it survives a corrupted room instead of throwing', () => {
    assert.deepEqual(summarizeRaid(), []);
    assert.deepEqual(summarizeRaid(null, null), []);
    const share = summarizeRaid({ won: true, drives: NaN, survivors: 'not-an-array', casualties: [null] }, { a: { kills: -2, deaths: 'x' } });
    assert.equal(share.length, 1);
    assert.equal(share[0].playerId, 'a');
    assert.equal(share[0].kills, 0);
    assert.equal(share[0].deaths, 0, 'a NaN death count is not a death');
    assert.ok(share[0].value >= 0);
});

// --- the account ledger -----------------------------------------------------

test('ledger: a win credits the wallet and records the career', () => {
    const { store, id, account } = storeWith();
    assert.equal(account.credits, 0, 'a fresh account starts broke');
    assert.deepEqual(account.stats, { raids: 0, extractions: 0, kills: 0, deaths: 0 });

    const applied = store.applyRaidResult(id, winResult('raid-1', { kills: 3, drives: 2, value: 700 }));
    assert.equal(applied.ok, true);
    assert.equal(applied.duplicate, false);
    assert.equal(account.credits, 700);
    assert.equal(account.stats.raids, 1);
    assert.equal(account.stats.extractions, 1);
    assert.equal(account.stats.kills, 3);
    assert.equal(account.stats.deaths, 0);
    assert.deepEqual(account.appliedRaids, ['raid-1']);
});

test('ledger: the same raidId settles exactly once, however often it is replayed', () => {
    const { store, id, account } = storeWith();
    const first = store.applyRaidResult(id, winResult('raid-dup'));
    const second = store.applyRaidResult(id, winResult('raid-dup'));
    const third = store.applyRaidResult(id, winResult('raid-dup'));
    assert.equal(first.duplicate, false);
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true, 'a replay is acknowledged, not paid');
    assert.equal(third.duplicate, true);
    assert.equal(account.credits, 600, 'the raid paid once');
    assert.equal(account.stats.raids, 1, 'and counted once');
    assert.equal(account.appliedRaids.length, 1);
});

test('ledger: kills and deaths accumulate across raids', () => {
    const { store, id, account } = storeWith();
    store.applyRaidResult(id, { raidId: 'r1', won: true, extracted: true, kills: 2, deaths: 0, drives: 1, value: 500 });
    store.applyRaidResult(id, { raidId: 'r2', won: false, extracted: false, kills: 4, deaths: 1, drives: 2, value: 160 });
    store.applyRaidResult(id, { raidId: 'r3', won: true, extracted: true, kills: 1, deaths: 0, drives: 0, value: 250 });
    assert.equal(account.stats.raids, 3);
    assert.equal(account.stats.extractions, 2, 'two of three raids were carried out');
    assert.equal(account.stats.kills, 7);
    assert.equal(account.stats.deaths, 1);
    assert.equal(account.credits, 500 + 160 + 250);
});

test('ledger: a loss records the raid but never an extraction', () => {
    const { store, id, account } = storeWith();
    const applied = store.applyRaidResult(id, { raidId: 'loss-1', won: false, extracted: false, kills: 5, deaths: 1, drives: 3, value: 200 });
    assert.equal(applied.ok, true);
    assert.equal(account.stats.raids, 1, 'a death is still a raid played');
    assert.equal(account.stats.extractions, 0);
    assert.equal(account.stats.deaths, 1);
    // A lie on the wire cannot turn a loss into an extraction: `extracted` is what counts.
    store.applyRaidResult(id, { raidId: 'loss-2', won: true, extracted: false, kills: 0, deaths: 1, drives: 0, value: 0 });
    assert.equal(account.stats.extractions, 0, 'won:true with extracted:false is not an extraction');
    assert.equal(account.stats.raids, 2);
});

test('ledger: appliedRaids is capped so an account file cannot grow forever', () => {
    const { store, id, account } = storeWith();
    const total = ACCOUNT_RULES.MAX_APPLIED_RAIDS + 25;
    for (let i = 0; i < total; i++) {
        const applied = store.applyRaidResult(id, { raidId: 'raid-' + i, won: false, extracted: false, kills: 0, deaths: 1, drives: 0, value: 0 });
        assert.equal(applied.ok, true);
    }
    assert.equal(account.stats.raids, total, 'every raid was still counted');
    assert.equal(account.appliedRaids.length, ACCOUNT_RULES.MAX_APPLIED_RAIDS, 'the replay guard stays bounded');
    // The most recent ids are kept and the oldest are evicted.
    assert.equal(account.appliedRaids[account.appliedRaids.length - 1], 'raid-' + (total - 1));
    assert.equal(account.appliedRaids.includes('raid-0'), false);
});

test('ledger: bad input is refused with a stable code and never throws', () => {
    const { store, id, account } = storeWith();
    assert.equal(store.applyRaidResult('no-such-account', winResult()).error, 'no-such-account');
    assert.equal(store.applyRaidResult(id, null).error, 'invalid-result');
    assert.equal(store.applyRaidResult(id, 'raid-1').error, 'invalid-result');
    assert.equal(store.applyRaidResult(id, [1, 2]).error, 'invalid-result');
    assert.equal(store.applyRaidResult(id, { won: true }).error, 'invalid-raid-id');
    assert.equal(store.applyRaidResult(id, { raidId: '   ' }).error, 'invalid-raid-id');
    assert.equal(account.credits, 0, 'a rejected settlement changes nothing');
    assert.equal(account.stats.raids, 0);
});

test('ledger: a corrupted value cannot mint negative or non-integer credits', () => {
    const { store, id, account } = storeWith();
    store.applyRaidResult(id, { raidId: 'garbage', won: true, extracted: true, kills: -4, deaths: NaN, drives: -1, value: -9999 });
    assert.equal(account.credits, 0, 'a negative payout is clamped to zero');
    assert.ok(Number.isInteger(account.credits));
    assert.equal(account.stats.kills, 0);
    assert.equal(account.stats.deaths, 0);
    assert.equal(account.stats.raids, 1, 'the raid is still on the record');
    // A fractional value is floored, never rounded up into free money.
    store.applyRaidResult(id, { raidId: 'fractional', won: true, extracted: true, kills: 0, deaths: 0, drives: 0, value: 12.9 });
    assert.equal(account.credits, 12);
    assert.ok(Number.isInteger(account.credits));
});

test('ledger: publicView exposes the wallet and the full career, not internal fields', () => {
    const { store, id } = storeWith();
    store.applyRaidResult(id, winResult('pub-1', { kills: 2, value: 400 }));
    const view = AccountStore.publicView(store.get(id));
    assert.equal(view.credits, 400);
    assert.deepEqual(view.stats, { raids: 1, extractions: 1, kills: 2, deaths: 0 });
    assert.equal(view.name, 'Raider_1');
    assert.equal('hash' in view, false, 'the password hash must never leave the server');
    assert.equal('salt' in view, false);
    assert.equal('appliedRaids' in view, false, 'the replay guard is server-internal');
    assert.equal(AccountStore.publicView(null), null);
});

test('ledger: settlement survives a restart, and a stale account file is upgraded in place', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-progression-'));
    try {
        const first = new AccountStore({ dir });
        first.register('Persisted', 'secret123');
        const id = first.byName_('Persisted').id;
        first.applyRaidResult(id, winResult('disk-1', { kills: 2, value: 750 }));

        const reopened = new AccountStore({ dir });
        const account = reopened.get(id);
        assert.equal(account.credits, 750, 'the wallet survives a restart');
        assert.equal(account.stats.kills, 2);
        assert.deepEqual(account.appliedRaids, ['disk-1']);
        // The replay guard survives too: the same raid cannot be paid again after a restart.
        assert.equal(reopened.applyRaidResult(id, winResult('disk-1', { value: 750 })).duplicate, true);
        assert.equal(account.credits, 750);

        // An account written by an older server has no ledger fields at all. Loading it must
        // not crash, and the first settlement must fill the missing pieces in.
        const raw = JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8'));
        delete raw.accounts[0].credits;
        delete raw.accounts[0].appliedRaids;
        fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify(raw));
        const upgraded = new AccountStore({ dir });
        const stale = upgraded.get(id);
        const applied = upgraded.applyRaidResult(id, winResult('disk-2', { kills: 1, value: 250 }));
        assert.equal(applied.ok, true);
        assert.equal(stale.credits, 250);
        assert.equal(stale.stats.raids, 2, 'the old careers keep counting');
        assert.equal(stale.stats.kills, 3);
        assert.deepEqual(stale.appliedRaids, ['disk-2'], 'missing ledger fields are created on demand');
        assert.equal(AccountStore.publicView(stale).credits, 250);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});