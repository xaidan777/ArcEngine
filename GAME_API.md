# Gameplay integration API, version 1

The live controller is `window.app.game`. Wait for it to exist before binding a
menu. `await game.ready` additionally waits for environment assets.
The renderer and existing UI remain adapters; `js/RaidRules.js` contains pure
rules that can be exercised without a browser or Babylon.

Client/server ownership and the runnable movement sandbox are described in
[server/README.md](server/README.md). Local movement and stamina already use
the same rules as the server. Full raid authority is not yet migrated.

## HUD state

Call `game.getSnapshot()` at the HUD's refresh rate (for example 10 Hz). It returns
detached data: editing the snapshot does not change the simulation. Do not call
it once per mesh or subscribe via the render loop for every UI element.

- `version`: API version, currently 1.
- `phase`: `briefing`, `raid`, `won`, `lost`; `paused`: independent pause flag.
- `seed`, `time` (raid seconds), `player`: position, HP and maximum HP.
- `stamina`: `value`, `max`, `delay` (seconds), `exhausted`, `sprinting`.
- `weapon`: `ammo`, `reserve`, `magazine`; `medkits`: count.
- `action`: `type` (`reload`, `heal`, `search`, or null), `remaining` seconds,
  `progress` from 0 to 1. Pausing freezes all actions.
- `inventory`: item copies, including `type`, bilingual `label` and `value`;
  `inventoryCapacity`, `raidValue`, `kills`.
- `extraction`: `state`, `drives`, `target`, `inbound` seconds,
  `progress` (boarding seconds), `contested`.
- `profile`: copy of persistent credits, upgrade levels and career counters.

## Commands

`game.command(name)` accepts `reload`, `heal`, `interact`, `cancel-action`,
`pause`, `resume`. It returns true when accepted and false when unavailable or
unknown. Action commands reject requests outside a live, unpaused raid, when
dead, or while another timed action is running. Cancellation consumes nothing.

`interact` starts a container search or calls the extraction transport.
Keyboard E release cancels search; touch USE completes automatically if still.
Movement on either input device, damage, range or loss of line of sight cancels
search. Partial ammo pickups leave unused rounds in the container.

Existing menu entry points remain available: `deploy()`, `reset()`,
`buyUpgrade('ammo' | 'medkit')`, `buyArmor()`, `setPaused(boolean)`.
Reset starts a new attempt and discards the current raid. Bind it to an explicit
new-raid/retry choice, not a menu open or HUD refresh.

## New mechanics and UI hooks

Forward + Shift consumes stamina. Exhaustion requires recovery before sprint
can resume. Walking and gunshots attract active guards to the last heard
position, including around obstacles; sound does not grant line of sight or
activate the reserved extraction wave. Walking is quieter than sprinting.

The interface owner can bind a stamina bar to `stamina.value / stamina.max`, an
exhaustion indicator to `stamina.exhausted`, and a shared action bar to
`action.progress`. No new menu layout or visual styling is required by the core.

Balance constants live in `js/Constants.js` and the editor's game settings.
They are read at raid reset. Checks: `node tools/check.mjs`.
Build: `node tools/build.mjs` produces the distributable archive in `dist/`.
