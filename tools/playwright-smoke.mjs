// Optional end-to-end smoke test. Install Playwright outside the project, then set PLAYWRIGHT_PATH.
// Example: PLAYWRIGHT_PATH=/tmp/arcengine-playwright/node_modules/playwright node tools/playwright-smoke.mjs
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_PATH;
if (!modulePath) throw new Error('Set PLAYWRIGHT_PATH to an installed Playwright package directory.');
const { chromium } = await import(pathToFileURL(modulePath + '/index.mjs').href);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8080/', { waitUntil: 'networkidle' });
assert.equal(await page.title(), 'Blackwater Protocol');
await page.waitForFunction(() => window.app && window.app.game && document.querySelector('#loading-screen')?.style.display === 'none', null, { timeout: 120000 });
// Enter the raid the way a player does: the menu boots to the HUB, so the deploy button goes
// through the pre-raid dispatcher. `startExpedition` is async (it may load a map from the pool
// and await terrain/assets), so the phase is polled rather than read immediately.
await page.evaluate(() => {
  const game = window.app.game;
  MenuSystem.isDirectPlay = true;
  MenuSystem.setScreen('MAP_SELECT');
  MenuSystem.startExpedition();
});
await page.waitForFunction(() => window.app.game.phase === 'raid', null, { timeout: 90000 });
await page.waitForFunction(() => {
  const app = window.app;
  return Math.hypot(app.location.view.camera.position.x - app.game.player.x,
    app.location.view.camera.position.z - app.game.player.y) < 0.01;
});
const initial = await page.evaluate(() => ({
  phase: window.app.game.phase,
  position: { x: window.app.game.player.x, y: window.app.game.player.y },
  firstPerson: window.app.camera.firstPersonObj === window.app.game.player,
  pointerOwnedByGame: window.app.camera.pointerEnabled === false,
  movementOwnedByGame: window.app.camera.movementEnabled === false,
  camera: { x: window.app.location.view.camera.position.x, z: window.app.location.view.camera.position.z }
}));
assert.equal(initial.phase, 'raid');
assert.equal(initial.firstPerson, true);
assert.equal(initial.pointerOwnedByGame, true);
assert.equal(initial.movementOwnedByGame, true);
assert.ok(Math.hypot(initial.camera.x - initial.position.x, initial.camera.z - initial.position.y) < 8, 'camera eye must remain at the player aside from temporary damage shake');
await page.evaluate(() => { window.app.camera.azimuth = -Math.PI / 2; window.app.camera.pitch = 0; });
await page.keyboard.down('KeyW');
await page.waitForTimeout(300);
await page.keyboard.up('KeyW');
const moved = await page.evaluate(() => ({ x: window.app.game.player.x, y: window.app.game.player.y }));
const dx = moved.x - initial.position.x, dy = moved.y - initial.position.y;
assert.ok(dy < -20 && Math.abs(dx) < 5, 'at north-facing azimuth, W must move north rather than merely move somewhere');

const beforeReload = await page.evaluate(() => {
  window.app.game.ammo = window.app.game.c.mag - 1;
  window.app.camera.azimuth = 0.37;
  window.app.camera.pitch = -0.12;
  return { azimuth: window.app.camera.azimuth, pitch: window.app.camera.pitch };
});
await page.keyboard.press('KeyR');
const afterReload = await page.evaluate(() => ({
  azimuth: window.app.camera.azimuth, pitch: window.app.camera.pitch, reload: window.app.game.reloadTimer
}));
assert.ok(afterReload.reload > 0, 'R starts reload');
assert.equal(afterReload.azimuth, beforeReload.azimuth, 'reload must not reset camera azimuth');
assert.equal(afterReload.pitch, beforeReload.pitch, 'reload must not reset camera pitch');

// Position first, then let real frames run, then fire: `fire()` reads the CAMERA's world
// position, and the camera only follows the player on the next frame. Firing in the same
// evaluate call traced the ray from the pre-move eye and always missed.
await page.evaluate(() => {
  const game = window.app.game;
  game.reloadTimer = 0; game.fireCooldown = 0; game.ammo = game.c.mag;
  game.player.x = 280; game.player.y = 1660;
  // A grounded, torso-height machine: the flying Spotter sits above the sight line.
  const enemy = game.enemies.find(e => !['spotter', 'cricket', 'screamer', 'pop'].includes(e.archetype)) || game.enemies[0];
  enemy.x = 280; enemy.y = 1450; enemy.alert = 1; enemy.dormant = false; enemy.dead = false;
  window.__smokeEnemy = enemy;
  window.app.camera.azimuth = -Math.PI / 2;
});
await page.waitForFunction(() => {
  const cam = window.app.location.view.camera;
  return Math.abs(cam.position.x - window.app.game.player.x) < 0.5 &&
    Math.abs(cam.position.z - window.app.game.player.y) < 0.5;
});
const combat = await page.evaluate(() => {
  const game = window.app.game;
  const enemy = window.__smokeEnemy;
  const hp = enemy.hp;
  game.fire();
  return { before: hp, ammo: game.ammo };
});
// Ballistics are projectiles, not hitscan: the round has to fly before it can land, so the
// damage arrives over the next frames rather than inside fire().
await page.waitForFunction(() => window.__smokeEnemy.hp < window.__smokeEnemy.maxHp, null, { timeout: 5000 })
  .catch(() => {});
combat.after = await page.evaluate(() => window.__smokeEnemy.hp);
assert.ok(combat.after < combat.before, 'centered shot damages exposed enemy');
assert.equal(combat.ammo, 19);
const pauseSettings = await page.evaluate(() => {
  const game = window.app.game;
  const before = game.time;
  game.setPaused(true); game.update(0.1);
  const pausedTime = game.time;
  game.settings.quality = 0; game.saveSettings();
  const low = { ssao: game.ssao ? game.ssao.totalStrength : 0, glow: game.glow ? game.glow.intensity : 0, dust: game.dust ? game.dust.emitRate : 0 };
  game.setPaused(false);
  return { before, pausedTime, low, saved: JSON.parse(Store.get('arcengine.raider.settings')) };
});
assert.equal(pauseSettings.pausedTime, pauseSettings.before, 'pause freezes simulation');
assert.equal(pauseSettings.low.ssao, 0);
assert.equal(pauseSettings.low.glow, 0);
assert.equal(pauseSettings.low.dust, 0);
assert.equal(pauseSettings.saved.quality, 0);

const ads = await page.evaluate(() => {
  const game = window.app.game;
  game.aiming = true;
  const before = game.app.location.view.camera.fov;
  game.updateVisuals(0.25);
  const aimed = game.app.location.view.camera.fov;
  game.aiming = false;
  game.updateVisuals(0.25);
  return { before, aimed, released: game.app.location.view.camera.fov };
});
assert.ok(ads.aimed < ads.before, 'ADS narrows FOV');
assert.ok(ads.released > ads.aimed, 'releasing ADS restores FOV');

const resources = await page.evaluate(() => {
  const game = window.app.game;
  game.ammo = 5; game.reserveAmmo = 7; game.reloadTimer = game.c.reload;
  for (let i = 0; i < 70; i++) game.update(game.c.reload / 60);
  const reload = { ammo: game.ammo, reserve: game.reserveAmmo };
  for (const enemy of game.enemies) { enemy.x = 100; enemy.y = 100; enemy.alert = 0; }
  game.player.hp = 50; game.medkits = 1; game.healTimer = game.c.healSec;
  for (let i = 0; i < 65; i++) game.update(game.c.healSec / 60);
  return { reload, hp: game.player.hp, medkits: game.medkits };
});
assert.deepEqual(resources.reload, { ammo: 12, reserve: 0 }, 'reload transfers only available reserve');
assert.equal(resources.hp, 85, 'healing restores configured health');
assert.equal(resources.medkits, 0, 'healing consumes one medkit');

const containerLoot = await page.evaluate(() => {
  const game = window.app.game;
  // The reload/heal checks just above left timed actions running, and a live raid is required
  // for `simulate()` to do anything. Start a clean raid and clear the locks first.
  game.reset();
  game.deploy();
  game.reloadTimer = 0; game.healTimer = 0; game.useItemTimer = 0;
  const box = game.containers[0];
  game.player.x = box.x; game.player.y = box.y;
  const before = { reserve: game.reserveAmmo, medkits: game.medkits, slots: game.backpack.filter(Boolean).length, value: game.raidValue };
  const started = game.startInteract();
  for (let i = 0; i < Math.ceil(game.c.searchSec / Game.SIM_DT) + 1; i++) game.simulate(Game.SIM_DT);
  const afterSearch = { searchOpened: box.opened, type: box.item ? box.item.type : null, panelOpen: !!(game.raidInventory && game.raidInventory.visible) };
  // A NON-instant crate hands off to the inventory panel, which is where the player takes the
  // item; an ammo/medkit crate transfers directly. Complete whichever path this crate uses.
  if (box.item && game.raidInventory && game.raidInventory.visible) {
    game.raidInventory.takeAllFromContainer();
  }
  return {
    // NOTE: read `opened` AFTER the take, and spread the pre-take snapshot FIRST — writing
    // `opened` before the spread let the stale value overwrite the fresh one.
    ...afterSearch,
    started,
    opened: box.opened,
    before,
    after: { reserve: game.reserveAmmo, medkits: game.medkits, slots: game.backpack.filter(Boolean).length, value: game.raidValue }
  };
});
assert.equal(containerLoot.started, true, 'the crate is in reach and the search starts');
assert.equal(containerLoot.opened, true,
  `a searched container must end up opened (type=${containerLoot.type}, panelOpen=${containerLoot.panelOpen})`);
assert.ok(containerLoot.after.reserve !== containerLoot.before.reserve || containerLoot.after.medkits !== containerLoot.before.medkits || containerLoot.after.slots !== containerLoot.before.slots, 'container grants a resource or backpack item');

const objectives = await page.evaluate(() => {
  const game = window.app.game;
  // Start a clean raid: `canAct` requires phase 'raid' with no timed action in flight, and the
  // steps above leave both in flux.
  game.reset();
  game.deploy();
  game.reloadTimer = 0; game.healTimer = 0; game.useItemTimer = 0; game.searchTimer = 0;
  game.searchTarget = null;
  for (const pickup of game.pickups) {
    let dx = game.player.x - pickup.x, dy = game.player.y - pickup.y;
    if (!dx && !dy) dx = 1;
    const blocker = game.blockers.find(b => ShooterRules.distanceSq(pickup, b) < (b.radius + game.player.radius) ** 2);
    if (blocker) {
      dx = pickup.x - blocker.x; dy = pickup.y - blocker.y;
      const n = ShooterRules.normalize(dx, dy);
      game.player.x = blocker.x + n.x * (blocker.radius + game.player.radius + 1);
      game.player.y = blocker.y + n.y * (blocker.radius + game.player.radius + 1);
    } else { game.player.x = pickup.x; game.player.y = pickup.y; }
    game.updateObjectives(Game.SIM_DT);
  }
  return { loot: game.loot, target: game.c.lootTarget, state: game.extractState };
});
assert.equal(objectives.loot, objectives.target, 'all mandatory objectives must be physically collectible');
assert.equal(objectives.state, 'available');

const extraction = await page.evaluate(() => {
  const game = window.app.game;
  // The main extraction is gated on the raid objective, so make the requirement explicit here
  // rather than depending on the state the previous block happened to leave behind. Timed
  // actions are cleared for the same reason: `canAct` rejects while one is in flight.
  game.reloadTimer = 0; game.healTimer = 0; game.useItemTimer = 0;
  game.searchTimer = 0; game.searchTarget = null;
  // A visible inventory or tactical map swallows EVERY key press at the top of onKey
  // (`if (this.tacticalMap?.visible || this.raidInventory?.visible) return;`), and the loot
  // check above opens the inventory. Close any full-screen panel before pressing keys.
  if (game.raidInventory && game.raidInventory.visible) game.raidInventory.close();
  if (game.tacticalMap && game.tacticalMap.visible) game.tacticalMap.close();
  game.loot = game.c.lootTarget;
  game.extract.visual.setEnabled(true);
  game.player.x = game.extract.x; game.player.y = game.extract.y;
  // Press the key the game actually binds to interact (KeyBindings defaults it to F; E is
  // lean-right now), so this exercises the same path a player's hands do.
  const interactCode = (typeof KeyBindings !== 'undefined') ? KeyBindings.get('interact') : 'KeyF';
  const extractionsBefore = game.profile.extractions;
  game.onKey({ code: interactCode || 'KeyF', ctrlKey: false, metaKey: false, altKey: false, repeat: false, preventDefault() {} }, true);
  const called = game.extractState;
  const callDiag = {
    canAct: RaidRules.canAct(game), busy: RaidRules.busy(game),
    phase: game.phase, paused: game.paused, loot: game.loot, target: game.c.lootTarget,
    inZone: ShooterRules.distanceSq(game.player, game.extract) <= game.extract.radius ** 2,
    disabled: !!game.extract.disabled, key: interactCode
  };
  game.updateVisuals(0);
  const transportFar = { x: game.extract.transport.position.x, y: game.extract.transport.position.y, z: game.extract.transport.position.z, enabled: game.extract.transport.isEnabled() };
  const dormantBefore = game.enemies.filter(e => e.dormant).length;
  // `update(dt)` feeds a FIXED-STEP accumulator (Game.SIM_DT), so one 0.04 s call advances
  // roughly 0.033 s of simulation. Advance until the state actually changes instead of trusting
  // a frame count, with a bound so a stuck state fails the assertion rather than hanging.
  const advanceUntil = (predicate, seconds) => {
    const maxCalls = Math.ceil(seconds / 0.02) + 10;
    for (let i = 0; i < maxCalls && !predicate(); i++) game.update(0.04);
  };
  advanceUntil(() => game.extractState !== 'inbound', game.c.inboundSec + 5);
  const dormantAfter = game.enemies.filter(e => e.dormant).length;
  game.updateVisuals(0);
  const arrived = game.extractState;
  const transportNear = { x: game.extract.transport.position.x, y: game.extract.transport.position.y, z: game.extract.transport.position.z };
  // Boarding to completion. Winning hands the player to the RETURN screen, which parks
  // `phase` at 'menu' by design — so the outcome is read from the career record, not the flag.
  advanceUntil(() => game.phase !== 'raid', game.c.extractSec + 5);
  return {
    called, callDiag, arrived, phase: game.phase, credits: game.profile.credits,
    extractionsBefore, extractionsAfter: game.profile.extractions,
    onReturnScreen: typeof MenuSystem !== 'undefined' && MenuSystem.currentScreen === 'RETURN',
    zone: { x: game.extract.x, y: game.extract.y },
    transportFar, transportNear, dormantBefore, dormantAfter
  };
});
assert.equal(extraction.called, 'inbound', 'the beacon must start inbound: ' + JSON.stringify(extraction.callDiag));
assert.equal(extraction.arrived, 'boarding');
// Winning moves the player to the RETURN screen, which parks `phase` at 'menu'; the raid was
// won if the career extraction counter advanced.
assert.equal(extraction.extractionsAfter, extraction.extractionsBefore + 1, 'boarding completes the raid as a win');
assert.ok(extraction.onReturnScreen, 'a successful extraction shows the return screen');
assert.ok(extraction.credits >= 0);
assert.equal(extraction.transportFar.enabled, true);
assert.ok(extraction.dormantBefore > 0 && extraction.dormantAfter === 0, 'inbound event activates reserve robots');
// The transport flies in from +700/+480 and touches down ON the extraction zone, so at
// boarding its XZ must equal the zone centre (it used to stop at a hardcoded offset).
assert.ok(Math.hypot(extraction.transportNear.x - extraction.zone.x, extraction.transportNear.z - extraction.zone.y) < 5,
  'transport arrives at extraction zone');

const progression = await page.evaluate(() => {
  const game = window.app.game;
  game.profile.credits = 500;
  const before = game.profile.ammoLevel;
  game.buyUpgrade('ammo');
  const saved = JSON.parse(localStorage.getItem('arcengine.raider.profile'));
  return { before, after: game.profile.ammoLevel, credits: game.profile.credits, saved };
});
assert.equal(progression.after, progression.before + 1);
assert.equal(progression.credits, 300);
assert.equal(progression.saved.ammoLevel, progression.after);
assert.ok('kills' in progression.saved && 'bestValue' in progression.saved && 'streak' in progression.saved, 'career stats persist in profile');
assert.ok(await page.locator('[data-ui="inventory"]').count());
assert.ok(await page.locator('[data-ui="buyAmmo"]').count());
const visuals = await page.evaluate(() => ({
  weaponParts: window.app.location.view.scene.meshes.filter(mesh => mesh.name.startsWith('rifle-')).length,
  robots: window.app.location.view.scene.meshes.filter(mesh => mesh.name.startsWith('raider-drone-')).length,
  containers: window.app.game.containers.length,
  // The loaded LEVEL decides how many crates a raid has, so the expectation is derived from it
  // rather than from a hardcoded count that only matched the built-in fallback layout.
  expectedContainers: (window.app.game.level && Array.isArray(window.app.game.level.containers))
    ? window.app.game.level.containers.length
    : window.app.game.containers.length,
  backpackSlots: window.app.game.backpack.length,
  profile: window.app.game.profile
}));
assert.ok(visuals.weaponParts >= 5, 'first-person weapon must have multiple rendered parts');
const resetResources = await page.evaluate(() => {
  const scene = window.app.location.view.scene, game = window.app.game;
  const before = { materials: scene.materials.length, textures: scene.textures.length };
  game.reset(); game.reset(); game.reset();
  return { before, after: { materials: scene.materials.length, textures: scene.textures.length }, shotSerial: game.shotSerial, accumulator: game._simAccumulator };
});
assert.ok(resetResources.after.materials <= resetResources.before.materials + 3, 'restarts must not leak raid materials');
assert.ok(resetResources.after.textures <= resetResources.before.textures + 1, 'restarts must not leak raid textures');
assert.equal(resetResources.shotSerial, 0);
assert.equal(resetResources.accumulator, 0);
assert.ok(visuals.robots >= 9, 'all guards use multi-part industrial robot visuals');
assert.equal(visuals.containers, visuals.expectedContainers, 'every crate in the level is spawned');
assert.ok(visuals.containers >= 5, 'a raid hosts a meaningful number of crates');
assert.ok(visuals.backpackSlots >= 6, 'the backpack grid holds loot');
assert.equal(visuals.profile.version, 1);
const ai = await page.evaluate(() => {
  const game = window.app.game;
  // The extraction check above ended the raid and parked the player on the RETURN screen,
  // where phase is 'menu' and `simulate()` is inert. Start a fresh raid first so the AI has a
  // live raid to act in.
  MenuSystem.isDirectPlay = true;
  MenuSystem.setScreen('MAP_SELECT');
  game.reset();
  game.deploy();
  const a = game.enemies[0], b = game.enemies[1];
  game.player.x = a.x - 120; game.player.y = a.y;
  for (let i = 0; i < 30; i++) game.simulate(1 / 60);
  return { state: a.state, allyState: b.state, alert: a.alert, robotParts: a.visual.getChildMeshes().length };
});
assert.equal(ai.state, 'engage');
assert.ok(ai.alert >= 0.35);
assert.ok(ai.robotParts >= 8);

await page.waitForFunction(() => window.app.game.industrialModels.length >= 6);
const pixels = await page.evaluate(async () => {
  const engine = World3D.engine;
  World3D.renderFrame();
  const w = Math.min(320, engine.getRenderWidth()), h = Math.min(180, engine.getRenderHeight());
  const data = await engine.readPixels(0, 0, w, h);
  let sum = 0, sumSq = 0, dark = 0, bright = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += luma; sumSq += luma * luma;
    if (luma < 8) dark++; if (luma > 247) bright++;
  }
  const n = data.length / 4, mean = sum / n;
  return { mean, variance: sumSq / n - mean * mean, darkRatio: dark / n, brightRatio: bright / n };
});
assert.ok(pixels.mean > 8 && pixels.mean < 247, 'frame is not blank black or white');
assert.ok(pixels.variance > 5, 'frame contains visible scene detail');
assert.ok(pixels.darkRatio < 0.98 && pixels.brightRatio < 0.98, 'frame is not uniformly clipped');
await page.screenshot({ path: process.env.SCREENSHOT_PATH || '/tmp/arcengine-playwright.png' });
// The desktop page above is still holding a WebGL context. Software rendering (SwiftShader)
// serves both pages from one CPU rasteriser, so leaving it running starves the mobile boot
// past any sane timeout. It has been fully asserted by now, so close it first.
await page.close();
const mobileContext = await browser.newContext({ viewport: { width: 720, height: 1280 }, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/153 Mobile Safari/537.36' });
const portrait = await mobileContext.newPage();
const portraitErrors = [];
portrait.on('pageerror', error => portraitErrors.push(String(error)));
await portrait.goto(process.env.GAME_URL || 'http://127.0.0.1:8080/', { waitUntil: 'networkidle' });
await portrait.waitForFunction(() => window.app?.game && document.querySelector('#loading-screen')?.style.display === 'none', null, { timeout: 120000 });
await portrait.evaluate(() => {
  MenuSystem.isDirectPlay = true;
  MenuSystem.setScreen('MAP_SELECT');
  MenuSystem.startExpedition();
});
await portrait.waitForFunction(() => window.app.game.phase === 'raid', null, { timeout: 90000 });
const mobileControls = await portrait.evaluate(() => ({
  fire: UI.get('mobileFire')?.visible, use: UI.get('mobileUse')?.visible,
  heal: UI.get('mobileHeal')?.visible, reload: UI.get('mobileReload')?.visible,
  aim: UI.get('mobileAim')?.visible, pause: UI.get('mobilePause')?.visible,
  touchMove: !!window.app.game.touchMove,
  semanticButtons: [...document.querySelectorAll('.arc-ui [data-ui]')].filter(el => ['deploy','resume','restart','quality','sensitivity','buyAmmo','buyMedkit','buyArmor','mobileFire','mobileUse','mobileHeal','mobileReload','mobileAim','mobilePause'].includes(el.dataset.ui)).every(el => el.tagName === 'BUTTON')
}));
assert.equal(mobileControls.fire, true);
assert.equal(mobileControls.use, true);
assert.equal(mobileControls.heal, true);
assert.equal(mobileControls.reload, true);
assert.equal(mobileControls.aim, true);
assert.equal(mobileControls.pause, true);
assert.equal(mobileControls.touchMove, true);
assert.equal(mobileControls.semanticButtons, true);
const overflow = await portrait.evaluate(() => [...document.querySelectorAll('.arc-ui > [data-ui]')]
  .filter(el => getComputedStyle(el).display !== 'none')
  .map(el => ({ id: el.dataset.ui, rect: el.getBoundingClientRect() }))
  .filter(x => x.id !== 'damageFlash' && (x.rect.left < -1 || x.rect.right > innerWidth + 1 || x.rect.top < -1 || x.rect.bottom > innerHeight + 1))
  .map(x => x.id));
assert.deepEqual(overflow, [], 'visible HUD must fit portrait viewport');
await portrait.screenshot({ path: '/tmp/arcengine-playwright-portrait.png' });
await mobileContext.close();
errors.push(...portraitErrors);
await browser.close();
if (errors.length) throw new Error('Browser errors:\n' + errors.join('\n'));
console.log('Playwright smoke passed:', { initial, moved });
