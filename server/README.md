# Online raid server

Zero-dependency Node server for the online raid. It owns the world, the clock, the actors
and every outcome; clients send intent and receive snapshots.

```
node server/main.mjs                              # in-memory accounts, port 8787
ACCOUNTS_DIR=./var/accounts node server/main.mjs  # persistent accounts
PORT=8787 CLIENT_ORIGIN=http://127.0.0.1:8080 RAID_SEED=7419 node server/main.mjs
```

`CLIENT_ORIGIN` must match the browser origin exactly. Node 22 or newer. Run the game dev
server separately.

## What the server owns

| System | File | Notes |
|---|---|---|
| World & map | `js/RaidWorld.js` (shared) | bounds, blockers with collision height, terrain height, spawns, loot, objectives |
| Simulation | `server/simulation.mjs` | fixed 60 Hz: players, machines, ballistics, shields, objectives |
| Accounts | `server/accounts.mjs` | scrypt-hashed passwords, bearer sessions, JSON persistence |
| Social | `server/social.mjs` | friends (symmetric, accepted), party (one leader, cap 4) |
| Matchmaking | `server/matchmaking.mjs` | FIFO queue, party matched whole, min 2 / max 8 |
| Transport | `server/main.mjs` | HTTP JSON, routing, status codes, raid rooms |

`js/RaidWorld.js` is the single source of truth for the map. The browser and the server load
the same file, so collision cannot drift; the server also serves it from `GET /world` so a
client can reproduce the map locally.

## Rules the server enforces

- **Nothing is trusted from the request body.** Player id, position, HP, kills, loot and match
  result are never read from a request. `POST /input` accepts movement axes, heading, trigger,
  posture and lean — nothing else. Forged fields are dropped, not merged.
- **The client never dictates its own state.** `GET /snapshot` returns server-owned players,
  machines and objectives; the raid clock advances on server ticks only.
- **Friendship needs both sides.** A request is not a friend until accepted; asking back
  accepts instead of stacking a second request.
- **A party has one leader and a cap of 4.** Only the leader invites or kicks; a leader
  leaving hands leadership over; the last member out disbands it.
- **A party is matched whole or not at all.** Splitting a squad across two raids is a bug.
- **Minimum to deploy is 2 players**, maximum 8. Below the minimum the queue waits.
- **The server owns the raid lifecycle.** Surrender, extraction, the raid timer and the final
  outcome are decided server-side and broadcast identically to every player. A client cannot
  declare itself extracted, alive or victorious.
- **A dropped player keeps their body for 90 s.** Reconnecting inside the window restores the
  player and their gear; past it they are evicted. An explicit logout is immediate.

## HTTP API

Auth is `Authorization: Bearer <token>` everywhere except the public routes.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | lobby state: protocol, seed, queue, raids, limits |
| GET | `/world` | the authoritative map (public, seed-derived) |
| POST | `/register` | `{name, password}` -> `{token, account}` |
| POST | `/login` | `{name, password}` -> `{token, account}` |
| GET | `/account` | restore and verify a persisted bearer session |
| DELETE | `/session` | leave everything: queue, party, raid |
| GET | `/friends` | friends + pending requests |
| POST | `/friends/request` | `{name}` |
| POST | `/friends/accept` | `{name}` |
| POST | `/friends/decline` | `{name}` |
| DELETE | `/friends` | `{name}` |
| GET | `/party` | party view + invites for me |
| POST | `/party` | create a party (leader) |
| DELETE | `/party` | leave (leadership transfers) |
| POST | `/party/invite` | `{name}` (leader only) |
| POST | `/party/accept` | `{inviteId}` |
| POST | `/party/kick` | `{name}` (leader only) |
| POST | `/match/queue` | queue solo or as the party leader |
| DELETE | `/match/queue` | leave the queue |
| GET | `/match/status` | queue position + the raid I am in |
| GET | `/snapshot` | authoritative world state, incl. `state`, `outcome`, objectives |
| POST | `/input` | intent for one tick |
| POST | `/raid/surrender` | give up; the server records a casualty and returns the outcome |
| POST | `/raid/extract` | call the transport (range and unlock validated server-side) |
| POST | `/raid/reconnect` | reclaim a dropped body inside the grace window |

`POST /sessions` still exists for the anonymous movement sandbox and for tests; it is not part
of the online player journey.

Error codes are stable strings (`bad-credentials`, `not-leader`, `party-full`, …) mapped to
HTTP statuses in one table in `server/main.mjs`.

## Browser client

`js/RaidClient.js` wraps the API and is the only network code the game needs:

```js
const client = new RaidClient('http://127.0.0.1:8787');
await client.register('Operator', 'secret123');   // or client.login(...)
await client.addFriend('Wingman');
await client.createParty();
await client.inviteToParty('Wingman');
await client.queue();
const raid = await client.waitForRaid();          // null on timeout
await client.sendInput({ forward: 1, right: 0, heading: 0, sprint: true });
const snap = await client.poll();
client.enemies();      // server-reported machines
client.objective();    // drives collected, raid timer, extraction
client.drainEvents();  // events applied exactly once
await client.disconnect();
```

## Verification

```
node --test tests/online-social.test.mjs   # accounts, friends, parties, matchmaking rules
node --test tests/online-api.test.mjs      # the HTTP API end to end
node --test tests/online-client.test.mjs   # the shipped browser client against a real server
node --test tests/raid-lifecycle.test.mjs  # surrender, extraction, raid end, reconnect
node --test tests/server-simulation.test.mjs tests/server-raid.test.mjs
node tools/check.mjs                       # types and the whole suite
```

## Still to do

- **Lobby UI.** The API and the client exist; the in-game screens for friends, party and
  matchmaking are partly built (`js/OnlineLobby.js`, `MenuSystem` squad panel). UI only.

Everything else on this list is done and covered by tests — see the table below.

## Authority: what the server owns

Nothing a client sends can change these; the server computes each from its own state and
its own clock, and the client only displays the result.

| Fact | Owned by | How a client could otherwise cheat |
|---|---|---|
| Position and collision | `simulation.step` | Sending `x`/`y` in input is ignored; input carries intent only |
| Health, shields, ammo, reload | `simulation.step`, `stepFiring` | The local weapon is gated off while the bridge is active |
| Kills, deaths, drives, loot | `simulation.tallies` | Counted from server ballistics, never from a client claim |
| Loot contents and value | `simulation.search` | Range and line of sight checked against the server's map |
| Raid outcome | `simulation.endRaid` | Win/loss, reason, survivors and casualties |
| Credits and career stats | `server/progression.mjs`, `AccountStore.applyRaidResult` | Idempotent by raidId; a replay pays nothing |
| Access to a ranked raid | `POST /sessions` is lobby-only | An anonymous guest can never enter a live raid |

## Done and verified

| Feature | Where | Proof |
|---|---|---|
| WebSocket push transport | `server/ws.mjs`, `RaidClient.connectSocket` | `tests/ws-protocol.test.mjs`, `tests/ws-transport.test.mjs`, `tests/online-visibility.test.mjs` |
| Client-side prediction + reconciliation | `OnlineBridge.predict`, `applyLocalPlayer` | `tests/online-prediction.test.mjs` (replay lands within 0.0000 px) |
| Remote bodies (model, pose, lean, death) | `OnlineBridge.createPeer`, `applyPeerState` | `tests/online-bridge.test.mjs` |
| Remote projectiles + muzzle flashes | `OnlineBridge.applyProjectiles`, `showMuzzleFlash` | `tests/online-bridge.test.mjs` |
| Server-owned weapons (fire rate, reload, reserve) | `simulation.stepFiring` | `tests/server-weapons.test.mjs` |
| Death is a game state, not just a HUD state | `simulation.step` | `tests/server-weapons.test.mjs` |
| Raid outcome ends the online raid | `OnlineBridge.settleOnlineRaid` | `tests/online-bridge.test.mjs` |
| Server-authoritative payout | `server/progression.mjs` | `tests/server-progression.test.mjs` |
| Authoritative loot search | `simulation.search` | `tests/server-weapons.test.mjs` |
| Jitter buffer for remote bodies | `OnlineBridge.interpolatePeers` | `tests/online-bridge.test.mjs` |
| Match push notification | `main.mjs:onMatch` | `tests/ws-transport.test.mjs` |
| Spectator Mode & Squad Lifecycle | `OnlineBridge.spectating`, `CameraControl.follow` | `tests/online-bridge.test.mjs`, `docs/SPECTATOR_SYSTEM_HANDOFF.md` |
| DBNO (Down But Not Out) & Field Revive | `simulation.step`, `OnlineBridge.downed` | `tests/dbno-revive.test.mjs`, `docs/DBNO_REVIVE_HANDOFF.md` |
| No forged state from a client | — | `tests/online-anticheat.test.mjs` |


## The browser bridge (js/OnlineBridge.js)

The one place where the server meets the rendered game. `Game.js` calls it in three spots
(`update`, `reset`, `dispose`) and everything else lives in the bridge:

| Responsibility | Detail |
|---|---|
| Send intent | One `/input` per frame at 20 Hz: axes, heading, trigger, posture, lean. Never a position, HP, kill or loot value. |
| Apply truth | A snapshot overwrites the local player, the garrison, the objectives and the raid state. Stale ticks are dropped. |
| Render peers | Every other player gets a body, eased toward the snapshot position and turning the short way across ±PI. |
| React to events | Hit markers, damage flash and kill counts come from server events, applied exactly once. |

While the bridge is active the local player simulation, the machine AI and the objective
timers are **skipped**: two sources of truth would fight each frame. With no client attached
the bridge is inert and the game runs exactly as it does offline.
