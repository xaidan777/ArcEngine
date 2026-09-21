// Game.js — a compact extraction-shooter vertical slice.
// Gameplay is deterministic 2D map state; Babylon meshes only present that state.

class Game {
    /** @param {{ location: Location3D, camera: CameraController }} app */
    constructor(app) {
        this.app = app;
        this.scene = app.location.view.scene;
        this.canvas = app.location.view.world.canvas;
        this.keys = new Set();
        this.visuals = [];
        this.effects = [];
        this.seed = 7419 + ShooterRules.metaInteger(Store.get('arcengine.raider.raid') ? Number(Store.get('arcengine.raider.raid')) : 0);
        this.firing = false;
        this.aiming = false;
        this.shotSerial = 0;
        this.touchMove = { x: 0, y: 0 };
        this.touchLookId = null;
        this.touchLook = null;
        this.paused = false;
        this.settings = Object.assign({ quality: IS_MOBILE ? 0 : 2, sensitivity: 1 }, Store.getJSON('arcengine.raider.settings', {}));
        this.settings.quality = Math.max(0, Math.min(2, Math.round(Number(this.settings.quality) || 0)));
        this.settings.sensitivity = Math.max(0.5, Math.min(2, Number(this.settings.sensitivity) || 1));
        const savedLang = Store.get('arcengine.game.lang');
        this.lang = savedLang === 'ru' || savedLang === 'en' ? savedLang
            : ((navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en');
        this._fpsTimer = 0;
        this._hudTimer = 0;
        this._hudElapsed = 0;
        this._simAccumulator = 0;
        this.tacticalMap = (typeof TacticalMap !== 'undefined') ? new TacticalMap() : null;
        this.tacticalRange = (typeof TacticalRange !== 'undefined') ? new TacticalRange() : null;
        this.raidInventory = (typeof RaidInventory !== 'undefined') ? new RaidInventory() : null;
        this._bound = {
            down: (e) => this.onKey(e, true),
            up: (e) => this.onKey(e, false),
            blur: () => { this.keys.clear(); this.firing = false; this._semiFired = false; },
            mouseMove: (e) => this.onMouseMove(e),
            mouseDown: (e) => this.onMouseDown(e),
            mouseUp: (e) => { if (e.button === 0) { this.firing = false; this._semiFired = false; } if (e.button === 2) this.aiming = false; },
            touchStart: (e) => this.onTouchStart(e),
            touchMove: (e) => this.onTouchMove(e),
            touchEnd: (e) => this.onTouchEnd(e),
            lock: () => {
                if (typeof MenuSystem !== 'undefined' && MenuSystem.currentScreen !== 'IN_RAID') {
                    if (document.exitPointerLock && document.pointerLockElement === this.canvas) document.exitPointerLock();
                    return;
                }
                if (document.pointerLockElement !== this.canvas) { this.firing = false; this.aiming = false; }
                this.app.camera.setPointerEnabled(document.pointerLockElement !== this.canvas && !this.canvas.requestPointerLock);
                this.updateHud(true);
            }
        };
        window.addEventListener('keydown', this._bound.down);
        window.addEventListener('keyup', this._bound.up);
        window.addEventListener('blur', this._bound.blur);
        document.addEventListener('mousemove', this._bound.mouseMove);
        document.addEventListener('mouseup', this._bound.mouseUp);
        document.addEventListener('pointerlockchange', this._bound.lock);
        this.canvas.addEventListener('mousedown', this._bound.mouseDown);
        this.canvas.addEventListener('touchstart', this._bound.touchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this._bound.touchMove, { passive: false });
        this.canvas.addEventListener('touchend', this._bound.touchEnd, { passive: false });
        app.camera.setMovementEnabled(false);
        app.camera.setPointerEnabled(!this.canvas.requestPointerLock);
        if (typeof ArcPerformanceOverlay !== 'undefined') {
            ArcPerformanceOverlay.init(app?.location?.view?.engine, typeof ArcEngine !== 'undefined' ? ArcEngine : null);
        }
        const restart = UI.get('restart');
        if (restart) restart.onClick(() => {
            this.hideResult();
            if (typeof MenuSystem !== 'undefined') {
                MenuSystem.finishRaid({
                    extracted: this.phase === 'won',
                    dead: this.phase === 'lost',
                    credits: this.raidValue,
                    loot: this.phase === 'won' ? this.backpack.slice() : []
                });
            } else {
                this.reset();
                this.deploy();
            }
        });
        const buyAmmo = UI.get('buyAmmo');
        if (buyAmmo) buyAmmo.onClick(() => this.buyUpgrade('ammo'));
        const buyMedkit = UI.get('buyMedkit');
        if (buyMedkit) buyMedkit.onClick(() => this.buyUpgrade('medkit'));
        const buyArmor = UI.get('buyArmor');
        if (buyArmor) buyArmor.onClick(() => this.buyArmor());
        const deploy = UI.get('deploy');
        if (deploy) deploy.onClick(() => this.deploy());
        const quality = UI.get('quality'); if (quality) quality.onClick(() => { this.settings.quality = (this.settings.quality + 1) % 3; this.saveSettings(); });
        const sensitivity = UI.get('sensitivity'); if (sensitivity) sensitivity.onClick(() => { this.settings.sensitivity = this.settings.sensitivity >= 2 ? 0.5 : this.settings.sensitivity + 0.25; this.saveSettings(); });
        const resume = UI.get('resume'); if (resume) resume.onClick(() => this.setPaused(false));
        const controlsBtn = UI.get('controlsBtn');
        if (controlsBtn) controlsBtn.onClick(() => {
            if (typeof ControlsMenu !== 'undefined') ControlsMenu.open(this);
        });
        const surrender = UI.get('surrender');
        if (surrender) {
            surrender.onClick(async () => {
                this.setPaused(false);
                if (this.onlineBridge && typeof this.onlineBridge.surrender === 'function') {
                    await this.onlineBridge.surrender();
                }
                if (this.phase === 'raid') {
                    this.finish(false);
                }
            });
        }
        const mobileFire = UI.get('mobileFire');
        // Each tap is a fresh trigger pull. The semi-auto latch is otherwise cleared only by
        // the desktop mouseup/blur events, so on touch a semi weapon fired exactly once per raid.
        if (mobileFire) { mobileFire.show(IS_MOBILE); mobileFire.onClick(() => { this._semiFired = false; this.fire(); }); }
        const mobileUse = UI.get('mobileUse');
        if (mobileUse) { mobileUse.show(IS_MOBILE); mobileUse.onClick(() => this.startInteract()); }
        const mobileHeal = UI.get('mobileHeal');
        if (mobileHeal) { mobileHeal.show(IS_MOBILE); mobileHeal.onClick(() => this.startHeal()); }
        const mobileReload = UI.get('mobileReload');
        if (mobileReload) { mobileReload.show(IS_MOBILE); mobileReload.onClick(() => this.startReload()); }
        const mobileAim = UI.get('mobileAim');
        if (mobileAim) { mobileAim.show(IS_MOBILE); mobileAim.onClick(() => { this.aiming = !this.aiming; }); }
        const mobilePause = UI.get('mobilePause');
        if (mobilePause) { mobilePause.show(IS_MOBILE); mobilePause.onClick(() => this.setPaused(!this.paused)); }
        this.setupAtmosphere();
        this.environment = new RaidEnvironment(this);
        this.setupAudio();
        if (typeof DayNightCycle !== 'undefined') {
            this.dayNightCycle = new DayNightCycle({
                dayDurationSec: 720,
                initialTime: 14.0
            });
        }
        if (typeof WeatherSystem !== 'undefined') {
            this.weatherSystem = new WeatherSystem(this.app?.location?.view || this.scene, {
                dayNightCycle: this.dayNightCycle,
                proceduralAudio: typeof ProceduralAudio !== 'undefined' ? ProceduralAudio : null,
                initialState: 'CLEAR'
            });
            this.weatherSystem.game = this;
            this.weatherSystem.app = this.app;
        }
        this.applyQuality();
        this.industrialModels = [];
        // RaidEnvironment owns the authored props. Keep one load promise and expose
        // its model list for gameplay/debug consumers; loading the same high-poly GLBs
        // here a second time doubled draw calls and GPU memory.
        this.environmentAssets = this.environment.loadAssets();
        // Everything the menu and the raid host need before the loading screen may hide. The bot
        // GLBs are deliberately NOT here: they only have to be ready by the time a bot spawns,
        // which is at least one raid entry later. Waiting for them held the whole game behind
        // ~13 MB of skinned meshes (measured: 22 s of a 49 s boot on a software rasteriser).
        this.environmentAssetsReady = Promise.all([this.loadIndustrialModels(), this.environment.ready, this.environmentAssets]).catch(() => null);
        this.setReadyPromise();
        this.createWeaponViewmodel();
        this.reset();
        if (typeof MenuSystem !== 'undefined') {
            MenuSystem.init(app, this);
        }
    }

    // Bind `ready` to the promises that exist right now. reset() re-runs on every raid entry,
    // and a `this.ready = …` written there replaced the promise the loading screen was already
    // awaiting with a stand-in that never resolved on the same objects.
    setReadyPromise() {
        this.ready = this.environmentAssetsReady || Promise.resolve();
        return this.ready;
    }

    static cfg() {
        const U = 'undefined';
        return {
            speed: typeof GAME_PLAYER_SPEED !== U ? GAME_PLAYER_SPEED : 260,
            radius: typeof GAME_PLAYER_RADIUS !== U ? GAME_PLAYER_RADIUS : 24,
            hp: typeof GAME_PLAYER_HP !== U ? GAME_PLAYER_HP : 100,
            fireInterval: typeof GAME_FIRE_INTERVAL !== U ? GAME_FIRE_INTERVAL : 0.16,
            damage: typeof GAME_FIRE_DAMAGE !== U ? GAME_FIRE_DAMAGE : 34,
            range: typeof GAME_FIRE_RANGE !== U ? GAME_FIRE_RANGE : 900,
            spreadDeg: typeof GAME_FIRE_SPREAD_DEG !== U ? GAME_FIRE_SPREAD_DEG : 1.1,
            adsFov: typeof GAME_ADS_FOV_DEG !== U ? GAME_ADS_FOV_DEG : 38,
            mag: typeof GAME_MAG_SIZE !== U ? GAME_MAG_SIZE : 20,
            reserveAmmo: typeof GAME_RESERVE_AMMO !== U ? GAME_RESERVE_AMMO : 60,
            reload: typeof GAME_RELOAD_SEC !== U ? GAME_RELOAD_SEC : 1.8,
            medkitHeal: typeof GAME_MEDKIT_HEAL !== U ? GAME_MEDKIT_HEAL : 35,
            healSec: typeof GAME_HEAL_SEC !== U ? GAME_HEAL_SEC : 2.6,
            searchSec: typeof GAME_SEARCH_SEC !== U ? GAME_SEARCH_SEC : 1.2,
            enemyCount: typeof GAME_ENEMY_COUNT !== U ? GAME_ENEMY_COUNT : 9,
            enemySpeed: typeof GAME_ENEMY_SPEED !== U ? GAME_ENEMY_SPEED : 105,
            enemyHp: typeof GAME_ENEMY_HP !== U ? GAME_ENEMY_HP : 68,
            aggro: typeof GAME_ENEMY_AGGRO !== U ? GAME_ENEMY_AGGRO : 480,
            enemyDamage: typeof GAME_ENEMY_DAMAGE !== U ? GAME_ENEMY_DAMAGE : 9,
            enemyAttack: typeof GAME_ENEMY_ATTACK_SEC !== U ? GAME_ENEMY_ATTACK_SEC : 0.8,
            lootTarget: typeof GAME_LOOT_TARGET !== U ? GAME_LOOT_TARGET : 3,
            inboundSec: typeof GAME_EXTRACT_INBOUND_SEC !== U ? GAME_EXTRACT_INBOUND_SEC : 15,
            extractSec: typeof GAME_EXTRACT_SEC !== U ? GAME_EXTRACT_SEC : 6,
            raidDuration: typeof GAME_RAID_DURATION_SEC !== U ? GAME_RAID_DURATION_SEC : 1200,
            warn5min: typeof GAME_RAID_WARN_5MIN_SEC !== U ? GAME_RAID_WARN_5MIN_SEC : 300,
            warn1min: typeof GAME_RAID_WARN_1MIN_SEC !== U ? GAME_RAID_WARN_1MIN_SEC : 60,
            barrageDps: typeof GAME_BARRAGE_DAMAGE_PER_SEC !== U ? GAME_BARRAGE_DAMAGE_PER_SEC : 1000,
            beaconSirenRadius: typeof GAME_EXTRACT_BEACON_SIREN_RADIUS !== U ? GAME_EXTRACT_BEACON_SIREN_RADIUS : 380,
            beaconInboundSec: typeof GAME_EXTRACT_BEACON_INBOUND_SEC !== U ? GAME_EXTRACT_BEACON_INBOUND_SEC : 20,
            beaconHoldSec: typeof GAME_EXTRACT_BEACON_HOLD_SEC !== U ? GAME_EXTRACT_BEACON_HOLD_SEC : 6,
            hatchHoldSec: typeof GAME_EXTRACT_HATCH_HOLD_SEC !== U ? GAME_EXTRACT_HATCH_HOLD_SEC : 3,
            hatchNoiseRadius: typeof GAME_EXTRACT_HATCH_NOISE_RADIUS !== U ? GAME_EXTRACT_HATCH_NOISE_RADIUS : 25
        };
    }

    text(ru, en) { return this.lang === 'ru' ? ru : en; }

    setupAtmosphere() {
        const image = this.scene.imageProcessingConfiguration;
        image.toneMappingEnabled = true;
        image.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
        image.exposure = 0.95;
        image.contrast = 1.08;
        image.vignetteEnabled = true;
        image.vignetteWeight = 0.65;
        image.vignetteStretch = 0.25;
        image.vignetteColor = new BABYLON.Color4(0.015, 0.025, 0.03, 1);
        if (!IS_MOBILE && BABYLON.ParticleSystem) {
            const dustTexture = new BABYLON.DynamicTexture('dust-particle', { width: 32, height: 32 }, this.scene, false);
            const ctx = dustTexture.getContext();
            const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
            gradient.addColorStop(0, 'rgba(220,205,170,0.7)'); gradient.addColorStop(1, 'rgba(220,205,170,0)');
            ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32); dustTexture.update();
            const dust = new BABYLON.ParticleSystem('industrial-dust', 280, this.scene);
            dust.particleTexture = dustTexture;
            dust.emitter = new BABYLON.Vector3(1024, 80, 1024);
            dust.minEmitBox = new BABYLON.Vector3(-950, -60, -950);
            dust.maxEmitBox = new BABYLON.Vector3(950, 180, 950);
            dust.color1 = new BABYLON.Color4(0.62, 0.56, 0.44, 0.16);
            dust.color2 = new BABYLON.Color4(0.38, 0.42, 0.4, 0.08);
            dust.minSize = 1.2; dust.maxSize = 4.5;
            dust.minLifeTime = 8; dust.maxLifeTime = 16; dust.emitRate = 18;
            dust.direction1 = new BABYLON.Vector3(-2, 0.2, -1); dust.direction2 = new BABYLON.Vector3(3, 1.2, 2);
            dust.minEmitPower = 0.15; dust.maxEmitPower = 0.5;
            dust.gravity = new BABYLON.Vector3(0, 0.02, 0);
            dust.start();
            this.dust = dust;
        }
        const unifiedGraphics = typeof ArcPostProcess !== 'undefined' && ArcPostProcess._activeInstance?.scene === this.scene;
        if (!unifiedGraphics && !IS_MOBILE && BABYLON.GlowLayer) {
            this.glow = new BABYLON.GlowLayer('industrial-glow', this.scene, { blurKernelSize: 24 });
            this.glow.intensity = 0.38;
        }
        if (!unifiedGraphics && !IS_MOBILE && BABYLON.SSAO2RenderingPipeline && BABYLON.SSAO2RenderingPipeline.IsSupported) {
            this.ssao = new BABYLON.SSAO2RenderingPipeline('contact-ao', this.scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.app.location.view.camera], true);
            this.ssao.samples = 8;
            this.ssao.radius = 12;
            this.ssao.totalStrength = 0.72;
            this.ssao.maxZ = 2400;
            this.ssao.expensiveBlur = false;
        }
        if (!unifiedGraphics && !IS_MOBILE && BABYLON.DefaultRenderingPipeline) {
            this.pipeline = new BABYLON.DefaultRenderingPipeline('bodycam', true, this.scene, [this.app.location.view.camera]);
            this.pipeline.fxaaEnabled = true;
            this.pipeline.grainEnabled = true;
            this.pipeline.grain.intensity = 1.2;
            this.pipeline.grain.animated = true;
            this.pipeline.chromaticAberrationEnabled = false;
            this.pipeline.chromaticAberration.aberrationAmount = 7;
            this.pipeline.sharpenEnabled = true;
            this.pipeline.sharpen.edgeAmount = 0.18;
        }
    }

    createWeaponViewmodel() {
        this.scene.setRenderingAutoClearDepthStencil(3, true, true, true);
        const root = new BABYLON.TransformNode('rifle-vm', this.scene);
        root.parent = this.app.location.view.camera;
        const gunmetal = this.environment.surface('rifle-gunmetal', 0x414d50, 0.75, 0.35);
        const polymer = this.environment.surface('rifle-polymer', 0x26332f, 0.05, 0.83);
        const accent = this.environment.surface('rifle-accent', 0x827250, 0.4, 0.58);
        for (const mat of [gunmetal, polymer, accent]) { mat.fogEnabled = false; mat.emissiveColor = mat.albedoColor.scale(0.08); }
        const part = (name, size, position, material) => {
            const mesh = World3D.createBeveledBox(name, size, this.scene);
            mesh.parent = root;
            mesh.position.set(position[0], position[1], position[2]);
            mesh.material = material;
            mesh.renderingGroupId = 3;
            mesh.receiveShadows = false;
            mesh.isPickable = false;
            mesh.alwaysSelectAsActiveMesh = true;
            return mesh;
        };
        part('rifle-receiver', [0.18, 0.14, 0.46], [0, 0, -0.35], gunmetal);
        part('rifle-handguard', [0.16, 0.12, 0.38], [0, 0.01, -0.75], polymer);
        part('rifle-stock', [0.16, 0.16, 0.28], [0, 0.01, -0.02], polymer);
        for (let i = 0; i < 9; i++) part('rifle-rail-' + i, [0.18, 0.025, 0.022], [0, 0.09, -0.24 - i * 0.068], gunmetal);
        for (const side of [-1, 1]) for (let i = 0; i < 5; i++) part('rifle-vent-' + side + '-' + i, [0.012, 0.042, 0.035], [side * 0.083, 0.022, -0.63 - i * 0.055], gunmetal);
        part('rifle-optic-base', [0.12, 0.03, 0.12], [0, 0.12, -0.36], accent);
        for (const side of [-1, 1]) part('rifle-optic-side', [0.018, 0.10, 0.075], [side * 0.052, 0.17, -0.36], gunmetal);
        part('rifle-optic-hood', [0.12, 0.018, 0.075], [0, 0.22, -0.36], gunmetal);

        // Collimator reflex sight glass lens
        const lensMat = this.material('optic-lens', 0x14282e, 0.15);
        lensMat.alpha = 0.35;
        lensMat.disableLighting = true;
        lensMat.fogEnabled = false;
        const lens = BABYLON.MeshBuilder.CreatePlane('optic-lens', { width: 0.086, height: 0.082 }, this.scene);
        lens.parent = root;
        lens.position.set(0, 0.17, -0.36);
        lens.material = lensMat;
        lens.renderingGroupId = 3;
        lens.isPickable = false;
        lens.alwaysSelectAsActiveMesh = true;

        // Illuminated holographic red dot reticle (centered at 0, 0.17, -0.362)
        const redDotMat = this.material('optic-red-dot', 0xff1e28, 1);
        redDotMat.emissiveColor = new BABYLON.Color3(1.0, 0.08, 0.08);
        redDotMat.disableLighting = true;
        redDotMat.fogEnabled = false;
        const redDot = BABYLON.MeshBuilder.CreateDisc('optic-red-dot', { radius: 0.0036, tessellation: 16 }, this.scene);
        redDot.parent = root;
        redDot.position.set(0, 0.17, -0.362);
        redDot.material = redDotMat;
        redDot.renderingGroupId = 3;
        redDot.isPickable = false;
        redDot.alwaysSelectAsActiveMesh = true;

        const ringMat = this.material('optic-reticle-ring', 0xff2838, 0.4);
        ringMat.emissiveColor = new BABYLON.Color3(0.9, 0.1, 0.1);
        ringMat.disableLighting = true;
        ringMat.fogEnabled = false;
        ringMat.alpha = 0.4;
        const ring = BABYLON.MeshBuilder.CreateTorus('optic-reticle-ring', { diameter: 0.024, thickness: 0.0016, tessellation: 20 }, this.scene);
        ring.parent = root;
        ring.position.set(0, 0.17, -0.362);
        ring.rotation.x = Math.PI / 2;
        ring.material = ringMat;
        ring.renderingGroupId = 3;
        ring.isPickable = false;
        ring.alwaysSelectAsActiveMesh = true;

        this.brassMat = this.material('brass-casing', 0xd4a838, 0.35);
        this.brassMat.fogEnabled = false;
        this.casings = [];

        const mag = part('rifle-magazine', [0.1, 0.25, 0.14], [0, -0.17, -0.38], accent);
        mag.rotation.x = -0.18;
        const barrel = BABYLON.MeshBuilder.CreateCylinder('rifle-barrel', { height: 0.48, diameter: 0.045, tessellation: 12 }, this.scene);
        barrel.parent = root; barrel.position.set(0, 0.025, -1.02); barrel.rotation.x = Math.PI / 2;
        barrel.material = gunmetal; barrel.renderingGroupId = 3; barrel.isPickable = false; barrel.alwaysSelectAsActiveMesh = true;

        // Tactical Suppressor attachment mesh
        const suppressorMat = this.environment.surface('rifle-suppressor-mat', 0x222a2c, 0.45, 0.65);
        suppressorMat.fogEnabled = false;
        const suppressor = BABYLON.MeshBuilder.CreateCylinder('rifle-suppressor', { height: 0.38, diameter: 0.082, tessellation: 16 }, this.scene);
        suppressor.parent = root; suppressor.position.set(0, 0.025, -1.36); suppressor.rotation.x = Math.PI / 2;
        suppressor.material = suppressorMat; suppressor.renderingGroupId = 3; suppressor.isPickable = false; suppressor.alwaysSelectAsActiveMesh = true;
        suppressor.setEnabled(false);

        // Extended Drum Magazine attachment mesh
        const extendedMag = part('rifle-mag-extended', [0.14, 0.34, 0.22], [0, -0.22, -0.38], accent);
        extendedMag.rotation.x = -0.18;
        extendedMag.setEnabled(false);

        // High-Power 4X Prism Scope body
        const prismScope = new BABYLON.TransformNode('rifle-optic-prism', this.scene);
        prismScope.parent = root;
        const scopeTube = BABYLON.MeshBuilder.CreateCylinder('prism-tube', { height: 0.32, diameter: 0.072, tessellation: 16 }, this.scene);
        scopeTube.parent = prismScope; scopeTube.position.set(0, 0.17, -0.36); scopeTube.rotation.x = Math.PI / 2;
        scopeTube.material = gunmetal; scopeTube.renderingGroupId = 3; scopeTube.isPickable = false;
        const scopeBell = BABYLON.MeshBuilder.CreateCylinder('prism-bell', { height: 0.10, diameterTop: 0.095, diameterBottom: 0.072, tessellation: 16 }, this.scene);
        scopeBell.parent = prismScope; scopeBell.position.set(0, 0.17, -0.52); scopeBell.rotation.x = Math.PI / 2;
        scopeBell.material = gunmetal; scopeBell.renderingGroupId = 3; scopeBell.isPickable = false;
        const turretH = BABYLON.MeshBuilder.CreateCylinder('prism-turret-h', { height: 0.03, diameter: 0.035, tessellation: 10 }, this.scene);
        turretH.parent = prismScope; turretH.position.set(0, 0.22, -0.36); turretH.material = accent; turretH.renderingGroupId = 3; turretH.isPickable = false;
        prismScope.setEnabled(false);

        const flashMat = this.material('muzzle-flash', 0xffa72f, 1);
        flashMat.disableLighting = true; flashMat.fogEnabled = false;
        const flash = BABYLON.MeshBuilder.CreateCylinder('muzzle-flash', { height: 0.18, diameterTop: 0, diameterBottom: 0.13, tessellation: 8 }, this.scene);
        flash.parent = root; flash.position.set(0, 0.025, -1.34); flash.rotation.x = Math.PI / 2;
        flash.material = flashMat; flash.renderingGroupId = 3; flash.isPickable = false; flash.alwaysSelectAsActiveMesh = true;
        flash.setEnabled(false);
        root.scaling.setAll(35);
        root.position.set(10, -11, -24);
        this.weapon = {
            root, flash, suppressor, extendedMag, magStandard: mag, prismScope,
            opticKobraGroup: [lens, redDot, ring],
            recoil: 0, recoilRotX: 0, recoilRotZ: 0,
            swayX: 0, swayY: 0,
            flashLife: 0, bob: 0, moving: false, sprinting: false
        };

        if (this.scene) {
            this.muzzleLight = new BABYLON.PointLight('muzzle-flash-light', new BABYLON.Vector3(0, 0, 0), this.scene);
            this.muzzleLight.diffuse = new BABYLON.Color3(1.0, 0.72, 0.25);
            this.muzzleLight.intensity = 0;
            this.muzzleLight.range = 220;

            this.tracerMatFriendly = this.material('tracer-mat-f', 0xffcc33);
            this.tracerMatFriendly.disableLighting = true;
            this.tracerMatFriendly.emissiveColor = new BABYLON.Color3(1, 0.85, 0.25);

            this.tracerMatHostile = this.material('tracer-mat-h', 0xff4422);
            this.tracerMatHostile.disableLighting = true;
            this.tracerMatHostile.emissiveColor = new BABYLON.Color3(1, 0.25, 0.1);

            this.decalMat = this.material('bullet-decal-mat', 0x121416);
            this.decalMat.disableLighting = true;
        }
    }

    saveSettings() {
        Store.set('arcengine.raider.settings', JSON.stringify(this.settings));
        this.applyQuality();
        this.updateHud(true);
    }

    applyQuality() {
        const q = this.settings.quality;
        if (this.pipeline) {
            this.pipeline.grainEnabled = q >= 1;
            this.pipeline.chromaticAberrationEnabled = false;
            this.pipeline.sharpenEnabled = q >= 1;
            this.pipeline.fxaaEnabled = q >= 1;
        }
        if (this.ssao) this.ssao.totalStrength = q >= 2 ? 0.38 : q === 1 ? 0.22 : 0;
        if (this.glow) this.glow.intensity = q >= 2 ? 0.38 : q === 1 ? 0.2 : 0;
        if (this.dust) this.dust.emitRate = q >= 2 ? 18 : q === 1 ? 7 : 0;

        if (typeof ArcPostProcess !== 'undefined' && ArcPostProcess._activeInstance) {
            const pp = ArcPostProcess._activeInstance;
            const rtxMode = this.settings.rtx || (q >= 2 ? 'ultra' : q === 1 ? 'medium' : 'off');
            const dlssMode = this.settings.dlss || (q >= 2 ? 'quality' : q === 1 ? 'balanced' : 'performance');
            pp.setRtxMode(rtxMode);
            pp.setDlssMode(dlssMode);
        }
    }

    ensureBackpack18() {
        if (!Array.isArray(this.backpack) || this.backpack.length < 18) {
            const oldBp = this.backpack || [];
            this.backpack = Array(18).fill(null);
            for (let i = 0; i < oldBp.length && i < 18; i++) {
                this.backpack[i] = oldBp[i];
            }
        }
        return this.backpack;
    }

    // --- backpack capacity ---------------------------------------------------
    // One rule for the HUD, the in-raid inventory and the loot gates, measured in the same
    // unit: how many items THIS raid may add. The crate and drive paths take one slot each,
    // exactly like the authoritative server's `carried` counter.
    lootCapacity() {
        const configured = Number(this.mechanics?.slots);
        return Number.isFinite(configured) && configured > 0 ? configured : 18;
    }

    lootedItems() {
        return Number.isFinite(this.lootedCount) ? Math.max(0, this.lootedCount) : 0;
    }

    // Throwable grenades the operator starts the raid with, read from the equipped gadgets,
    // the quick slots and the backpack. A grenade gadget is one throw; anything explicitly
    // counted carries its own `count`.
    countStartingGrenades() {
        const items = [];
        const loadout = (typeof MenuSystem !== 'undefined' && MenuSystem.loadout) ? MenuSystem.loadout : {};
        for (const key of ['gadget1', 'gadget2']) if (loadout[key]) items.push(loadout[key]);
        if (Array.isArray(loadout.quickSlots)) for (const it of loadout.quickSlots) if (it) items.push(it);
        if (Array.isArray(this.backpack)) for (const it of this.backpack) if (it) items.push(it);
        let total = 0;
        for (const item of items) {
            const isGrenade = item.category === 'grenades' || item.type === 'grenade' ||
                (typeof item.id === 'string' && item.id.includes('grenade')) ||
                (typeof item.name === 'string' && /GRENADE/i.test(item.name));
            if (!isGrenade) continue;
            const count = Number(item.count);
            total += Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
        }
        return total;
    }

    backpackIsFull() {
        return this.lootedItems() >= this.lootCapacity();
    }

    noteLootTaken() {
        this.lootedCount = this.lootedItems() + 1;
        return this.lootedCount;
    }

    setPaused(on) {
        this.paused = !!on;
        this.firing = false; this.aiming = false; this.keys.clear();
        if (this.paused && document.exitPointerLock && document.pointerLockElement === this.canvas) document.exitPointerLock();
        for (const id of ['settingsPanel','settingsTitle','quality','sensitivity','controlsBtn','resume','surrender']) { const el = UI.get(id); if (el) el.show(this.paused); }
        const pauseBtn = document.getElementById('arc-pause-controls-btn');
        if (pauseBtn) {
            pauseBtn.style.display = this.paused ? 'flex' : 'none';
            pauseBtn.textContent = this.text('НАСТРОЙКИ УПРАВЛЕНИЯ', 'CONTROLS SETTINGS');
        }
        const pauseFpsBtn = document.getElementById('arc-pause-fps-btn');
        if (pauseFpsBtn) {
            pauseFpsBtn.style.display = this.paused ? 'flex' : 'none';
            const isVis = typeof ArcPerformanceOverlay !== 'undefined' && ArcPerformanceOverlay.isVisible();
            pauseFpsBtn.textContent = `FPS: [${isVis ? 'ВКЛ' : 'ВЫКЛ'}] (F3)`;
        }
        const pauseDlssBtn = document.getElementById('arc-pause-dlss-btn');
        if (pauseDlssBtn) {
            pauseDlssBtn.style.display = this.paused ? 'flex' : 'none';
            const curDlss = (typeof ArcPostProcess !== 'undefined' && ArcPostProcess._activeInstance)
                ? ArcPostProcess._activeInstance.getDlssMode()
                : (this.settings.dlss || 'quality');
            const labels = { off: 'ВЫКЛ', dlaa: 'DLAA (1.0x)', quality: 'КАЧЕСТВО (0.75x)', balanced: 'БАЛАНС (0.66x)', performance: 'СКОРОСТЬ (0.50x)' };
            pauseDlssBtn.textContent = `DLSS: [${labels[curDlss] || curDlss.toUpperCase()}]`;
        }
        const pauseRtxBtn = document.getElementById('arc-pause-rtx-btn');
        if (pauseRtxBtn) {
            pauseRtxBtn.style.display = this.paused ? 'flex' : 'none';
            const curRtx = (typeof ArcPostProcess !== 'undefined' && ArcPostProcess._activeInstance)
                ? ArcPostProcess._activeInstance.getRtxMode()
                : (this.settings.rtx || 'ultra');
            const labels = { off: 'ВЫКЛ', medium: 'СРЕДНЕЕ', ultra: 'УЛЬТРА' };
            pauseRtxBtn.textContent = `ПСЕВДО-RTX: [${labels[curRtx] || curRtx.toUpperCase()}]`;
        }
        if (!this.paused && typeof ControlsMenu !== 'undefined' && ControlsMenu.isOpen()) {
            ControlsMenu.close();
        }
        this.updateMobileControls();
        this.updateHud(true);
    }

    updateMobileControls() {
        const active = IS_MOBILE && this.phase === 'raid' && !this.paused;
        if (typeof UI !== 'undefined' && UI.get) {
            for (const id of ['mobileFire','mobileUse','mobileHeal','mobileReload','mobileAim']) { const el = UI.get(id); if (el) el.show(active); }
            const pause = UI.get('mobilePause'); if (pause) pause.show(IS_MOBILE && this.phase === 'raid');
        }
    }

    async loadIndustrialModels() {
        await this.environmentAssets;
        this.industrialModels = this.environment.models || [];
    }

    setupAudio() {
        this.audio = typeof ProceduralAudio !== 'undefined' ? ProceduralAudio : null;
        if (this.audio && typeof this.audio.init === 'function') {
            this.audio.init();
        }
        this._footstepTimer = 0;
        this._audioIndex = 0;
        this._lastSoundPick = {};
    }

    pickSound(list, key = 'default') {
        if (!list || !list.length) return null;
        if (list.length === 1) return list[0];
        if (!this._lastSoundPick) this._lastSoundPick = {};
        const last = this._lastSoundPick[key];
        let idx = Math.floor(Math.random() * list.length);
        if (idx === last) {
            idx = (idx + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
        }
        this._lastSoundPick[key] = idx;
        return list[idx];
    }

    playSound(sound, volume = 0.2, pitchVariance = 0.08) {
        if (this.audio && typeof this.audio.playSound === 'function') {
            this.audio.playSound(sound, volume, pitchVariance);
        } else if (sound && typeof sound.play === 'function') {
            try {
                sound.currentTime = 0;
                sound.volume = Math.max(0, Math.min(1, volume));
                if (pitchVariance > 0) {
                    const pitch = 1.0 + (Math.random() * 2 - 1) * pitchVariance;
                    sound.playbackRate = Math.max(0.5, Math.min(2.0, pitch));
                }
                const playing = sound.play();
                if (playing && playing.catch) playing.catch(() => {});
            } catch (e) {}
        }
    }

    playPositionalSound(sound, x, y, baseVol = 0.3, maxDist = 550) {
        if (!sound || !this.player) return;
        const dx = x - this.player.x, dy = y - this.player.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= maxDist) return;
        const factor = Math.max(0, 1 - dist / maxDist);
        const falloff = baseVol * factor * factor;
        if (falloff > 0.01) {
            this.playSound(sound, falloff, 0.08);
        }
    }

    async startRaid(mapId = 'default_raid') {
        const level = await MapPool.load(mapId);
        const loc = this.app.location;
        if (level.id !== loc.opts.level?.id || JSON.stringify(level) !== JSON.stringify(loc.opts.level)) {
            await this.environmentAssets;
            this.environment.dispose();
            for (const rec of loc.objects.slice()) loc.removeObject(rec);
            loc.opts.level = level; MapPool.activate(level);
            loc.buildTerrain(); await loc.terrain.ready;
            loc.buildLights(level.lights || []);
            for (const def of level.props || []) loc.addObject(def);
            await Promise.all(loc.objects.map(r => r.loaded));
            this.app.camera.setTerrain(loc.terrain, { w: loc.width, h: loc.height });
            this.environment = new RaidEnvironment(this);
            this._environmentBuilt = false;
            this.environmentAssets = this.environment.loadAssets();
            await this.environmentAssets;
        }
        this.reset(); this.deploy();
    }

    reset() {
        this.level = this.app.location.opts?.level || null;
        if (this.dayNightCycle && Number.isFinite(this.level?.lighting?.timeOfDay)) {
            this.dayNightCycle.setTime(this.level.lighting.timeOfDay);
        }
        this.updateMapLighting(0);
        this.raidWorld = RaidWorld.build(this.seed);
        this.seed = 7419 + ShooterRules.metaInteger(Store.get('arcengine.raider.raid') ? Number(Store.get('arcengine.raider.raid')) : 0);
        const raidMaterials = new Set();
        for (const rec of this.visuals) {
            if (rec.material) raidMaterials.add(rec.material);
            const parts = [rec.mesh].concat(rec.mesh.getChildMeshes ? rec.mesh.getChildMeshes(false) : []);
            for (const part of parts) if (part.material) raidMaterials.add(part.material);
        }
        for (const rec of this.visuals) World3D.removeObject(this.app.location.view, rec.mesh);
        for (const material of raidMaterials) material.dispose(false, true);
        for (const rec of this.effects) {
            rec.mesh.dispose();
            if (rec.material) rec.material.dispose();
        }
        this.visuals = [];
        this.effects = [];
        this.keys.clear();
        this.firing = false;
        this.aiming = false;
        this.shotSerial = 0;
        this._simAccumulator = 0;
        this.c = Game.cfg();
        this.phase = (typeof MenuSystem !== 'undefined' && MenuSystem.currentScreen !== 'IN_RAID') ? 'menu' : (Store.get('arcengine.raider.briefed') ? 'raid' : 'briefing');
        this.time = 0;
        this.kills = 0;
        this.shots = 0;
        this.hits = 0;
        this.damageTaken = 0;
        this.hitMarker = 0;
        this.hitMarkerCrit = false;
        this.weaponSpreadBloom = 0;
        this.jumpVelocity = 0;
        this.jumpOffset = 0;
        this.jumpGround = true;
        this.posture = 'stand';
        this.lean = 0;
        this.leanLeft = false;
        this.leanRight = false;
        /** @type {boolean} true while a held KeyE is acting as "interact" rather than "lean right" */
        this._eInteracts = false;
        this.bobPhase = 0;
        this.burstCount = 0;
        this.timeSinceLastShot = 1.0;
        this._semiFired = false;
        this.grenadeCooldown = 0;
        this.meleeCooldown = 0;
        if (this.grenades) {
            for (const g of this.grenades) { if (g.mesh && g.mesh.dispose) g.mesh.dispose(); }
            this.grenades = [];
        }
        if (this.decals) {
            for (const d of this.decals) { if (d.mesh && d.mesh.dispose) d.mesh.dispose(); }
            this.decals = [];
        }
        if (this.activeProjectiles) {
            for (const p of this.activeProjectiles) {
                if (p.mesh && p.mesh.dispose) p.mesh.dispose();
                if (p.trail && p.trail.dispose) p.trail.dispose();
            }
        }
        this.activeProjectiles = [];
        if (this.casings) {
            for (const c of this.casings) { if (c.mesh && c.mesh.dispose) c.mesh.dispose(); }
            this.casings = [];
        }
        this.damageFlash = 0;
        this.damageDirection = 0;
        this.lootFeedTimer = 0;
        this.lootFeedText = '';
        this.loot = 0;
        this.extractProgress = 0;
        this.extractContested = false;
        this.extractState = 'available';
        this.inboundTimer = 0;
        this.reinforcementsSent = false;
        this.fireCooldown = 0;
        this.reloadTimer = 0;
        this.healTimer = 0;
        this.searchTimer = 0;
        this.searchTarget = null;
        const savedRaw = Store.getJSON('arcengine.raider.profile', {});
        this.profile = ShooterRules.sanitizeMeta(savedRaw);
        this.profile.armorLevel = Math.min(3, this.profile.armorLevel);
        this.medkits = 1 + Math.min(3, this.profile.medkitLevel);
        // Grenades are counted further down, AFTER the backpack is populated from the pre-raid
        // loadout — counting here would always read an empty grid.
        this.grenadesLeft = 0;
        this.raidValue = 0;
        this._footstepTimer = 0;
        this.jumpVelocity = 0;
        this.jumpOffset = 0;
        this.jumpGround = true;
        const bonuses = (typeof ProgressionSystem !== 'undefined') ? ProgressionSystem.getActiveBonuses() : {};
        const maxHp = this.c.hp + this.profile.armorLevel * 5 + (bonuses.maxHp || 0);
        this.mechanics = this.readMechanics();

        const shieldCore = /** @type {any} */ ((typeof MenuSystem !== 'undefined' && MenuSystem.loadout?.shieldCore) ||
            (typeof ARC_SHIELD_CORES !== 'undefined' ? ARC_SHIELD_CORES.MEDIUM : null));
        const maxShield = shieldCore?.maxHp || shieldCore?.shieldHp || (typeof GAME_SHIELD_MEDIUM_HP !== 'undefined' ? GAME_SHIELD_MEDIUM_HP : 100);
        const shieldRechargeDelay = shieldCore?.rechargeDelay || (typeof GAME_SHIELD_BREAK_DELAY !== 'undefined' ? GAME_SHIELD_BREAK_DELAY : 4.5);
        const shieldRechargeRate = (shieldCore?.rechargeRate || (typeof GAME_SHIELD_RECHARGE_RATE !== 'undefined' ? GAME_SHIELD_RECHARGE_RATE : 20)) * (1 + (bonuses.shieldRegenMult || 0));

        this.player = {
            x: 350, y: 3600, radius: this.c.radius,
            hp: maxHp, maxHp,
            shield: maxShield, maxShield,
            shieldTimer: 0,
            shieldRechargeDelay, shieldRechargeRate,
            heading: -Math.PI / 2,
            jumpOffset: 0,
            eyeHeight: 64,
            leanOffset: 0,
            leanRoll: 0,
            bobX: 0,
            bobY: 0
        };
        if (this.level) {
            const p = this.level.spawn || { x: this.app.location.width / 2, y: this.app.location.height / 2 };
            this.player.x = p.x; this.player.y = p.y; this.player.heading = p.heading || 0;
        }
        this.progressionBonuses = bonuses;

        this.posture = 'stand';
        this.lean = 0;
        this.leanLeft = false;
        this.leanRight = false;
        this._eInteracts = false;
        this.bobPhase = 0;
        this.burstCount = 0;
        this.timeSinceLastShot = 1.0;
        this._semiFired = false;
        this.grenadeCooldown = 0;
        this.meleeCooldown = 0;
        this.grenades = [];
        this.decals = [];
        this._decalSeq = 0;

        const loadoutObj = typeof MenuSystem !== 'undefined' ? MenuSystem.loadout : {};
        const backpackArr = (typeof MenuSystem !== 'undefined' && Array.isArray(MenuSystem.loadout?.backpack)) ? MenuSystem.loadout.backpack : (typeof MenuSystem !== 'undefined' && Array.isArray(MenuSystem.backpack) ? MenuSystem.backpack : []);
        this.totalWeight = typeof RaidRules !== 'undefined' && RaidRules.calculateLoadoutWeight ? RaidRules.calculateLoadoutWeight(loadoutObj, backpackArr) : 18.5;
        this.encumbrance = typeof RaidRules !== 'undefined' && RaidRules.getEncumbrance ? RaidRules.getEncumbrance(this.totalWeight) : { id: 'medium', speedMult: 1.0, staminaDrainMult: 1.0, noiseMult: 1.0 };

        this.quickSlots = (typeof MenuSystem !== 'undefined' && Array.isArray(MenuSystem.loadout?.quickSlots)) ?
            MenuSystem.loadout.quickSlots.slice() : [
                typeof ARC_ITEMS !== 'undefined' ? ARC_ITEMS.consumable_stim : null,
                typeof ARC_ITEMS !== 'undefined' ? ARC_ITEMS.consumable_small_battery : null,
                typeof ARC_ITEMS !== 'undefined' ? ARC_ITEMS.consumable_medkit : null,
                null
            ];
        this.useItemTimer = 0;
        this.useItemDuration = 0;
        this.activeItemIndex = -1;

        const maxStam = (this.mechanics.stamina?.max || 100) + (bonuses.maxStamina || 0);
        this.stamina = { value: maxStam, max: maxStam, delay: 0, exhausted: false };
        this.sessionKills = { spotter: 0, sentinel: 0, turret: 0, cricket: 0, screamer: 0, total: 0 };
        this.aim = { x: this.player.x + 300, y: this.player.y - 300 };
        // Storage vessels. The radius is the collision footprint; `height` is the vessel height
// from RaidEnvironment.build() — a tank is 220..340 px tall, so an 80 px default let every
// shot pass straight through the visible steel.
        this.blockers = [
            { x: 610, y: 1440, radius: 120, height: 260 }, { x: 980, y: 1070, radius: 150, height: 330 },
            { x: 1390, y: 1360, radius: 130, height: 220 }, { x: 1500, y: 600, radius: 145, height: 340 },
            { x: 720, y: 570, radius: 110, height: 250 },
            { x: 2900, y: 1100, radius: 125, height: 280 }, { x: 3400, y: 950, radius: 145, height: 320 },
            { x: 2850, y: 2600, radius: 120, height: 240 }, { x: 3350, y: 3100, radius: 140, height: 300 },
            { x: 1100, y: 2800, radius: 125, height: 250 }
        ];
        // Static cover. Every record carries an explicit height: ShooterRules defaults a blocker
        // with no height to 80 px, which made low cover taller than it looks.
        this.coverBlockers = this.blockers.concat([
            { x: 520, y: 1310, radius: 52, height: 90 }, { x: 1340, y: 1300, radius: 58, height: 90 },
            { x: 1450, y: 1270, radius: 58, height: 90 }, { x: 1320, y: 910, radius: 42, height: 70 },
            { x: 1730, y: 270, radius: 54, height: 90 },
            { x: 280, y: 2500, radius: 45, height: 70 }, { x: 1800, y: 1400, radius: 45, height: 70 },
            { x: 3200, y: 1400, radius: 45, height: 70 }, { x: 3450, y: 700, radius: 40, height: 70 },
            { x: 3650, y: 1250, radius: 40, height: 70 }
        ]);
        if (this.level) { this.blockers = this.raidWorld.blockers.slice(); this.coverBlockers = this.raidWorld.cover.slice(); }
        this.enemies = [];
        this.pickups = [];
        this.containers = [];
        if (this.hazards) {
            for (const h of this.hazards) {
                if (h.root && h.root.dispose) h.root.dispose();
                if (h.barrel) World3D.removeObject(this.app.location.view, h.barrel);
                if (h.box) World3D.removeObject(this.app.location.view, h.box);
            }
        }
        const loadoutPrimary = (typeof MenuSystem !== 'undefined' && MenuSystem.loadout?.primary) ? MenuSystem.loadout.primary : null;
        this.backpack = Array(18).fill(null);
        if (Array.isArray(backpackArr)) {
            for (let i = 0; i < backpackArr.length && i < 18; i++) {
                this.backpack[i] = backpackArr[i];
            }
        }
        // Grenades come from the equipped gadget slots and the bag, the same way medkits come
        // from the profile, so the count happens once the bag is populated. Each EMP grenade
        // gadget is one throwable; without this the only limit was the cooldown.
        this.grenadesLeft = this.countStartingGrenades();
        // Loot carried OUT of this raid. The pre-raid bag is 18 physical cells holding ammo,
        // materials and gear; the rules capacity (GAME_BACKPACK_SLOTS) limits how many items a
        // raid search may add. Measuring "full" from the whole array, which is padded to 18,
        // made the game announce a full backpack over an almost empty one.
        this.lootedCount = 0;
        const stats = (loadoutPrimary && typeof RaidRules !== 'undefined' && RaidRules.getWeaponEffectiveStats) ? RaidRules.getWeaponEffectiveStats(loadoutPrimary) : null;
        if (stats) {
            this.c.mag = stats.magSize;
            this.c.damage = stats.damage;
            this.c.dmg = stats.damage;
        } else if (loadoutPrimary?.damage) {
            this.c.damage = loadoutPrimary.damage;
            this.c.dmg = loadoutPrimary.damage;
        }
        const isDirect = (typeof window !== 'undefined' && window.location?.search?.includes('directPlay')) || this.infiniteAmmo;
        this.ammo = isDirect ? 99 : this.c.mag;
        this.reserveAmmo = isDirect ? 9999 : (this.c.reserveAmmo + this.profile.ammoLevel * 20);
        this.extract = { x: 3680, y: 520, radius: 130 };
        this.extractState = 'available';
        this.extractProgress = 0;
        this.inboundTimer = this.c.inboundSec;
        this.beaconSirenAlertSent = false;
        this.metroExtract = { x: 650, y: 1150, radius: 130, state: 'available', inboundTimer: 0, extractProgress: 0, contested: false };
        this.raidTimer = this.c.raidDuration;
        this.barrageActive = false;
        this.barrageShakeTimer = 0;
        this.barrageExplosionTimer = 0;
        this.hatchExtract = { x: 780, y: 1250, radius: 60 };
        if (this.level) {
            // A level that authors no exit does NOT mean "this raid cannot be won". An authored
            // map normally places its own extraction and hatch, but a fresh map from the editor
            // has neither yet, and disabling the exit made the raid unwinnable — the player could
            // fight and loot with no way to leave. Fall back to the built-in locations, and only
            // treat an EXPLICIT false/disabled flag as "no exit here".
            const builtinExtract = { x: 3680, y: 520, radius: 130 };
            const builtinHatch = { x: 780, y: 1250, radius: 60 };
            this.extract = (this.level.extraction && this.level.extraction.disabled !== true)
                ? { ...this.level.extraction }
                : { ...builtinExtract };
            this.hatchExtract = (this.level.hatch && this.level.hatch.disabled !== true)
                ? { ...this.level.hatch }
                : { ...builtinHatch };
            // The secondary metro exit only exists on the built-in layout; an authored map uses
            // whatever it placed above.
            if (this.level.metroExtraction && this.level.metroExtraction.disabled !== true) {
                this.metroExtract = { state: 'available', inboundTimer: 0, extractProgress: 0, contested: false, ...this.level.metroExtraction };
            }
            // The objective is however many drives the map actually contains. Reading `.length`
            // straight off an EMPTY authored list made it ZERO, which both voided the objective
            // (the extraction gate `loot >= 0` passed immediately) and told the HUD to expect no
            // drives. A map that authors none gets the built-in layout's count instead.
            const authoredDrives = (Array.isArray(this.level.drives) && this.level.drives.length) ? this.level.drives.length : 0;
            this.c.lootTarget = authoredDrives > 0 ? authoredDrives : (typeof GAME_LOOT_TARGET !== 'undefined' ? GAME_LOOT_TARGET : 3);
        }
        this.buildIndustrialYard();
        this.spawnEnemies();
        this.spawnLootContainers();
        if (!this.level) this.spawnHazards();
        // The navigation grid is built AFTER everything that adds collision. Building it first
        // left all 8 loot crates and the hazards out of the grid, so bot pathfinding routed
        // straight through cover the player cannot walk through.
        if (typeof NavGrid !== 'undefined' && this.app?.location) {
            this.navGrid = new NavGrid(this.app.location, 64);
            if (typeof ArcJobSystem !== 'undefined' && ArcJobSystem.stats?.backend === 'workers') {
                this.navGrid.buildAsync(this.blockers);
            } else {
                this.navGrid.build(this.blockers);
            }
        }
        this.createPlayerVisual();
        this.createExtractionVisual();
        this.createHatchVisual();
        this.app.camera.setFirstPerson(this.player, 62);
        this.app.camera.pitch = 0;
        this.app.camera.azimuth = -Math.PI / 2;
        // The lobby sets game.onlineClient before deploy(); attach the network bridge here
        // so every raid entry path (menu, restart, direct) picks it up.
        if (typeof OnlineBridge !== 'undefined') {
            if (this.onlineClient) OnlineBridge.attach(this, this.onlineClient);
            else if (OnlineBridge.enabled) OnlineBridge.detach();
        }
        this.hideResult();
        this.showBriefing(this.phase === 'briefing');
        this.updateMobileControls();
        this.updateHud(true);
    }

    showBriefing(on) {
        for (const id of ['briefingPanel','briefingTitle','briefingText','raidSeed','deploy']) { const el = UI.get(id); if (el) el.show(on); }
        const title = UI.get('briefingTitle'); if (title) title.setText(this.text('РЕЙД: BLACKWATER', 'BLACKWATER RAID'));
        const text = UI.get('briefingText'); if (text) text.setText(this.text('Найдите 3 накопителя данных\nВызовите эвакуацию и выживите', 'Recover 3 data drives\nCall extraction and survive'));
        const seed = UI.get('raidSeed'); if (seed) seed.setText(this.text('РЕЙД ', 'RAID ') + this.seed);
        const deploy = UI.get('deploy'); if (deploy) deploy.setText(this.text('ВЫСАДИТЬСЯ', 'DEPLOY'));
    }

    deploy() {
        this.phase = 'raid';
        if (typeof MenuSystem !== 'undefined') {
            MenuSystem.currentScreen = 'IN_RAID';
            if (UI.root) {
                UI.root.dataset.mode = 'raid';
                UI.root.dataset.screen = 'IN_RAID';
            }
        }
        Store.set('arcengine.raider.briefed', '1');
        this.showBriefing(false);
        this.updateMobileControls();
        const defaultRaidHud = [
            'topShade', 'objective', 'loot', 'lootValue', 'inventory',
            'crosshair'
        ];
        for (const id of defaultRaidHud) {
            const el = UI.get(id);
            if (el) el.show(true);
        }
        if (this.tacticalMap && !this.tacticalMap.initialized) {
            this.tacticalMap.init();
        }
        if (this.raidInventory && !this.raidInventory.initialized) {
            this.raidInventory.init();
        }
        this.initTacticalHudDOM();
        this.updateHud(true);
        if (this.canvas.requestPointerLock) {
            const locking = this.canvas.requestPointerLock();
            if (locking && locking.catch) locking.catch(() => {});
        }
    }

    material(name, hex, emissive) {
        const mat = new BABYLON.StandardMaterial(name, this.scene);
        mat.diffuseColor = World3D.hexColor3(hex);
        mat.specularColor = new BABYLON.Color3(0.12, 0.12, 0.12);
        if (emissive) mat.emissiveColor = World3D.hexColor3(hex).scale(emissive);
        mat.metadata = { toon: false };
        return mat;
    }

    addVisual(mesh, material, kind = 'prop', opts) {
        mesh.material = material;
        World3D.addObject(this.app.location.view, mesh, kind, opts || {});
        const rec = { mesh, material };
        this.visuals.push(rec);
        return rec;
    }

    place(mesh, x, y, lift) {
        mesh.position.set(x, this.app.location.terrain.heightAt(x, y) + (lift || 0), y);
    }

    preloadSpotterModel() {
        if (!this.scene || typeof Model3D === 'undefined' || !Model3D.load) return null;
        if (!this.spotterModelPromise) {
            this.spotterModelPromise = Model3D.load('assets/models/rigged/spotter.glb', this.scene).catch(err => {
                console.warn('Failed to load spotter.glb:', err);
                return null;
            });
        }
        return this.spotterModelPromise;
    }

    preloadCricketModel() {
        if (!this.scene || typeof Model3D === 'undefined' || !Model3D.load) return null;
        if (!this.cricketModelPromise) {
            this.cricketModelPromise = Model3D.load('assets/models/rigged/cricket.glb', this.scene).catch(err => {
                console.warn('Failed to load cricket.glb:', err);
                return null;
            });
        }
        return this.cricketModelPromise;
    }

    preloadScreamerModel() {
        if (!this.scene || typeof Model3D === 'undefined' || !Model3D.load) return null;
        if (!this.screamerModelPromise) {
            this.screamerModelPromise = Model3D.load('assets/models/rigged/screamer.glb', this.scene).catch(err => {
                console.warn('Failed to load screamer.glb:', err);
                return null;
            });
        }
        return this.screamerModelPromise;
    }

    preloadRubezhModel() {
        if (!this.scene || typeof Model3D === 'undefined' || !Model3D.load) return null;
        if (!this.rubezhModelPromise) {
            this.rubezhModelPromise = Model3D.load('assets/models/weapons/rubezh76_tier4.glb', this.scene).catch(err => {
                console.warn('Failed to load rubezh76_tier4.glb:', err);
                return null;
            });
        }
        return this.rubezhModelPromise;
    }

    // Swap an archetype's procedural placeholder for its real rigged GLB, when the file is
    // present. `onReady` runs after the model is parented, so the caller can hide the boxes.
    // A missing or broken asset is not an error: the placeholder keeps rendering (invariant 6).
    // The attach is retried on a frame boundary: at spawn time the GLB may still be in flight,
    // and a bot that spawned mid-load must not be stuck with boxes for the whole raid.
    attachRiggedModel(root, archetype, scale, onReady, attempt = 0) {
        if (!root || !this.scene || typeof Model3D === 'undefined' || !Model3D.load) return null;
        if (root.isDisposed && root.isDisposed()) return null;
        if (root.metadata && root.metadata.botRig) return null;   // already has its model
        const loaders = { spotter: 'preloadSpotterModel', cricket: 'preloadCricketModel', screamer: 'preloadScreamerModel' };
        const loader = loaders[archetype];
        if (!loader || typeof this[loader] !== 'function') return null;
        const pending = this[loader]();
        if (!pending || !pending.then) return null;
        const retry = () => {
            // ~30 s budget. A 12 MB skinned GLB with 4K textures can take several seconds to
            // parse on a software rasteriser, so a short deadline would leave loaded-but-slow
            // bots on their box placeholder. Past the budget the asset is genuinely gone.
            if (attempt >= 100 || (this.phase !== 'raid' && this.phase !== 'briefing')) return null;
            setTimeout(() => this.attachRiggedModel(root, archetype, scale, onReady, attempt + 1), 300);
            return null;
        };
        // Race the load against a soft deadline so a never-settling loader cannot hang the bot.
        const deadline = new Promise(resolve => setTimeout(() => resolve('__pending'), 250));
        return Promise.race([pending, deadline]).then(model => {
            if (model === '__pending') return retry();
            if (!model || !root || (root.isDisposed && root.isDisposed())) return null;
            const built = Model3D.build(model, this.scene, { name: archetype + '-model-' + root.name });
            built.parent = root;
            built.position.set(0, 0, 0);
            if (scale) built.scaling.setAll(scale);
            built.rotation.y = -Math.PI / 2;
            BotRig3D.attach(root, built, this.app.location.view, false);
            // Dispose procedural placeholder meshes that are now replaced by the GLB model
            const view = this.app?.location?.view;
            const shadow = view?.shadow;
            const builtMeshes = new Set([built, ...(built.getChildMeshes ? built.getChildMeshes(false) : [])]);
            for (const m of root.getChildMeshes(false)) {
                if (builtMeshes.has(m)) continue;
                if (m.name && (m.name.includes('-cone-') || m.name.includes('-light-'))) continue;
                try {
                    if (shadow && shadow.removeShadowCaster) shadow.removeShadowCaster(m, true);
                    m.dispose(false, true);
                } catch (_) {}
            }
            if (typeof onReady === 'function') onReady(built);
            return built;
        }).catch(err => {
            console.warn('Failed to attach rigged ' + archetype + ' model:', err);
            return retry();
        });
    }

    // Turn a bot to face a world point and return the muzzle position in map coordinates.
    // Bots used to fire from their CENTRE while the model faced wherever it happened to be
    // turned, so tracers visibly left the body sideways. Both the shot origin and the facing
    // now come from the same place: the weapon mesh when it exists, the chest otherwise.
    aimEnemyAt(enemy, targetX, targetY) {
        if (!enemy || !enemy.visual) return null;
        const dir = ShooterRules.normalize(targetX - enemy.x, targetY - enemy.y);
        enemy.visual.rotation.y = -Math.atan2(dir.y, dir.x);
        enemy.heading = Math.atan2(dir.y, dir.x);
        const ground = this.app?.location?.terrain ? this.app.location.terrain.heightAt(enemy.x, enemy.y) : 0;
        let muzzle = { x: enemy.x, y: enemy.y, h: ground + 40 };
        const gun = enemy.visual.getChildMeshes
            ? enemy.visual.getChildMeshes(false).find(m => m.isEnabled(false) && /rifle|snout|mortar|barrel|weapon/.test(m.name))
            : null;
        if (gun) {
            // Do NOT read the mesh's absolute position here: gameplay (simulate) runs before
            // presentation (updateVisuals), so the bot's mesh still sits at last frame's
            // location and the muzzle would land hundreds of px away — that is exactly why
            // bot tracers used to appear beside the bot. Use the mesh's LOCAL offset instead
            // and rotate it by the heading we just set.
            const local = gun.position;
            const cos = Math.cos(-enemy.visual.rotation.y), sin = Math.sin(-enemy.visual.rotation.y);
            const scale = enemy.visual.scaling ? enemy.visual.scaling.x : 1;
            const lx = local.x * scale, lz = local.z * scale;
            // Babylon: local +Z is the model's forward after the -90 deg turn; rotate into map.
            const mapDx = lx * cos - lz * sin;
            const mapDy = lx * sin + lz * cos;
            muzzle = { x: enemy.x + mapDx, y: enemy.y + mapDy, h: ground + (enemy.height || 64) * 0.62 };
        } else {
            muzzle = {
                x: enemy.x + dir.x * (enemy.radius || 24) * 0.7,
                y: enemy.y + dir.y * (enemy.radius || 24) * 0.7,
                h: ground + (enemy.height || 64) * 0.62
            };
        }
        return muzzle;
    }

    buildIndustrialYard() {
        if (!this._environmentBuilt) {
            this.environment.build();
            this._environmentBuilt = true;
        } else if (this.environment.obstacles) {
            for (const obs of this.environment.obstacles) {
                this.blockers.push(obs);
                this.coverBlockers.push(obs);
            }
        }
    }

    createEnemyRobot(index, archetype) {
        const root = new BABYLON.Mesh('raider-drone-' + index, this.scene);
        const isBombard = archetype === 'bombard';
        const isStalker = archetype === 'stalker';
        const heavy = archetype === 'heavy' || archetype === 'sentinel' || isBombard;
        const scout = archetype === 'scout' || archetype === 'spotter' || archetype === 'pop';
        const armorKey = 'drone-armor-' + (isBombard ? 'bombard' : isStalker ? 'stalker' : heavy ? 'heavy' : scout ? 'scout' : (index % 2 ? 'alt' : 'main'));
        const armor = this.environment.surface(armorKey, isBombard ? 0xb87d28 : isStalker ? 0x323e42 : heavy ? 0x8c6245 : scout ? 0x597682 : (index % 2 ? 0x737863 : 0x546566), 0.5, 0.5);
        const dark = this.material('drone-joint-shared', 0x171d20);
        root.scaling.setAll(isBombard ? 2.85 : archetype === 'sentinel' ? 2.75 : heavy ? 2.35 : archetype === 'pop' ? 1.65 : (archetype === 'spotter' || archetype === 'cricket' || archetype === 'screamer') ? 1.0 : isStalker ? 1.85 : scout ? 1.55 : 1.85);
        const eyeMat = this.material('drone-eye-' + index, isStalker ? 0xff2e1f : archetype === 'spotter' ? 0xff2222 : 0xf05239, 0.9);
        const add = (mesh, mat, x, y, z) => {
            mesh.parent = root; mesh.material = mat; mesh.position.set(x, y, z);
            mesh.isPickable = false; return mesh;
        };
        const torso = add(World3D.createBeveledBox('drone-torso-' + index, [34, 38, 24], this.scene), armor, 0, 47, 0);
        const core = add(BABYLON.MeshBuilder.CreateBox('drone-core-' + index, { width: 20, height: 18, depth: 28 }, this.scene), dark, 0, 31, 0);
        const head = add(BABYLON.MeshBuilder.CreateSphere('drone-head-' + index, { diameter: 21, segments: 10 }, this.scene), armor, 0, 72, 0);
        const eye = add(BABYLON.MeshBuilder.CreateSphere('drone-eye-' + index, { diameter: 7, segments: 8 }, this.scene), eyeMat, 0, 72, 9);
        const legs = [];
        const arms = [];
        for (const side of [-1, 1]) {
            const leg = add(BABYLON.MeshBuilder.CreateCylinder('drone-leg-' + index + '-' + side, { height: 31, diameter: 8, tessellation: 8 }, this.scene), dark, side * 11, 12, 0);
            const foot = add(BABYLON.MeshBuilder.CreateBox('drone-foot-' + index + '-' + side, { width: 12, height: 7, depth: 22 }, this.scene), armor, side * 11, -5, 4);
            legs.push({ leg, foot, side });
            const arm = add(BABYLON.MeshBuilder.CreateCylinder('drone-arm-' + index + '-' + side, { height: 35, diameter: 7, tessellation: 8 }, this.scene), dark, side * 24, 44, 0);
            arm.rotation.z = side * 0.18;
            arms.push({ arm, side });
        }
        const weapon = add(BABYLON.MeshBuilder.CreateBox('drone-rifle-' + index, { width: 9, height: 9, depth: 42 }, this.scene), dark, 19, 42, 13);
        weapon.rotation.x = -0.1;

        let searchlightCone = null;
        let searchlightMat = null;
        let spotterModel = null;
        let stalkerSpine = null;
        let stalkerGun = null;
        let mortarTube = null;
        let stabilizerLegs = null;

        if (archetype === 'sentinel') {
            // Front Riot Shield (in front of Sentinel along +Z)
            const shieldMat = this.environment.surface('sentinel-shield-' + index, 0x2e353b, 0.2, 0.7);
            add(BABYLON.MeshBuilder.CreateBox('sentinel-riot-shield-' + index, { width: 44, height: 58, depth: 7 }, this.scene), shieldMat, 0, 44, 22);
            // Rear glowing Power Core (weakspot on the back along -Z)
            const coreMat = this.material('sentinel-weak-core-' + index, 0xffaa00, 0.95);
            add(BABYLON.MeshBuilder.CreateSphere('sentinel-power-core-' + index, { diameter: 14, segments: 8 }, this.scene), coreMat, 0, 48, -14);
        } else if (archetype === 'spotter') {
            const domeMat = this.material('spotter-dome-' + index, 0xff2222, 0.95);
            const dish = add(BABYLON.MeshBuilder.CreateCylinder('spotter-dish-' + index, { height: 4, diameter: 36, tessellation: 12 }, this.scene), armor, 0, 42, 0);
            const sensor = add(BABYLON.MeshBuilder.CreateSphere('spotter-sensor-' + index, { diameter: 14, segments: 8 }, this.scene), domeMat, 0, 44, 4);

            // Red searching spotter spotlight cone projecting to ground
            searchlightMat = this.material('spotter-cone-mat-' + index, 0xff1111, 0.95);
            searchlightMat.alpha = 0.32;
            searchlightCone = BABYLON.MeshBuilder.CreateCylinder('spotter-light-cone-' + index, { height: 160, diameterTop: 18, diameterBottom: 170, tessellation: 16 }, this.scene);
            searchlightCone.material = searchlightMat;
            searchlightCone.parent = root;
            searchlightCone.position.set(0, -55, 18);
            searchlightCone.rotation.x = -0.15;
            searchlightCone.isPickable = false;

            // Load and instantiate real 3D spotter.glb model
            const p = this.preloadSpotterModel();
            if (p && p.then) {
                p.then(model => {
                    if (model && root && !root.isDisposed()) {
                        spotterModel = Model3D.build(model, this.scene, { name: 'spotter-model-' + index });
                        spotterModel.parent = root;
                        spotterModel.position.set(0, 18, 0);
                        spotterModel.scaling.setAll(2.40);
                        spotterModel.rotation.y = -Math.PI / 2;
                        BotRig3D.attach(root, spotterModel, this.app.location.view, false);

                        // Dispose placeholder humanoid meshes for authentic flying drone appearance
                        const view = this.app?.location?.view;
                        const shadow = view?.shadow;
                        const placeholders = [torso, head, core, eye, weapon, dish, sensor];
                        for (const l of legs) { placeholders.push(l.leg, l.foot); }
                        for (const a of arms) { placeholders.push(a.arm); }
                        for (const ph of placeholders) {
                            if (ph && (!ph.isDisposed || !ph.isDisposed())) {
                                try {
                                    if (shadow && shadow.removeShadowCaster) shadow.removeShadowCaster(ph, false);
                                    ph.dispose(false, true);
                                } catch (_) {}
                            }
                        }
                    }
                }).catch(err => {
                    console.warn('Failed to attach 3D spotter model:', err);
                });
            }
        } else if (archetype === 'pop') {
            const popMat = this.material('pop-core-' + index, 0xff7700, 0.9);
            add(BABYLON.MeshBuilder.CreateSphere('pop-sphere-' + index, { diameter: 36, segments: 10 }, this.scene), popMat, 0, 42, 0);
        } else if (archetype === 'cricket') {
            // Compact, spring-loaded cricket jumper chassis
            torso.scaling.set(0.9, 0.7, 1.1);
            torso.position.set(0, 32, 0);
            head.position.set(0, 48, 6);
            eye.position.set(0, 48, 14);
            const springMat = this.material('cricket-spring-' + index, 0xffa500, 0.95);
            // Coiled hydraulic spring canisters on legs
            for (const side of [-1, 1]) {
                add(BABYLON.MeshBuilder.CreateCylinder('cricket-coil-' + index + '-' + side, { height: 20, diameter: 10, tessellation: 8 }, this.scene), springMat, side * 14, 18, -4);
            }
            // Real rigged model when it loads; the boxes above stay as the fallback look.
            this.attachRiggedModel(root, 'cricket', 2.1, () => {
                for (const m of root.getChildMeshes(false)) {
                    if (m.name.indexOf('cricket-model-') === 0) continue;
                    m.setEnabled(false);
                }
            });
        } else if (archetype === 'screamer') {
            // Tall, spindly electronic warfare frame
            torso.scaling.set(0.7, 1.3, 0.7);
            torso.position.set(0, 60, 0);
            head.position.set(0, 88, 0);
            eye.position.set(0, 88, 8);
            // Giant acoustic siren dish / EW transmitter on back
            const sirenMat = this.material('screamer-siren-' + index, 0x00e1d9, 0.95);
            const sirenCone = add(BABYLON.MeshBuilder.CreateCylinder('screamer-dish-' + index, { height: 18, diameterTop: 36, diameterBottom: 8, tessellation: 12 }, this.scene), sirenMat, 0, 75, -14);
            sirenCone.rotation.x = -Math.PI / 3;
            // Lengthen spindly stilt legs
            for (const l of legs) {
                l.leg.scaling.set(0.8, 1.6, 0.8);
                l.leg.position.y += 10;
            }
            this.attachRiggedModel(root, 'screamer', 2.2, () => {
                for (const m of root.getChildMeshes(false)) {
                    if (m.name.indexOf('screamer-model-') === 0) continue;
                    m.setEnabled(false);
                }
            });
        } else if (isStalker) {
            // Quadrupedal predatory stalker chassis
            torso.scaling.set(1.15, 0.65, 1.4);
            torso.position.set(0, 44, 4);
            head.position.set(0, 58, 18);
            eye.position.set(0, 58, 28);
            const snoutMat = this.environment.surface('stalker-snout-' + index, 0x1f2629, 0.6, 0.4);
            add(BABYLON.MeshBuilder.CreateBox('stalker-snout-' + index, { width: 14, height: 12, depth: 22 }, this.scene), snoutMat, 0, 55, 24);
            const eyeMat2 = this.material('stalker-eye-r-' + index, 0xff3b1a, 0.95);
            add(BABYLON.MeshBuilder.CreateSphere('stalker-eye2-' + index, { diameter: 5, segments: 8 }, this.scene), eyeMat2, 4, 59, 27);
            add(BABYLON.MeshBuilder.CreateSphere('stalker-eye3-' + index, { diameter: 5, segments: 8 }, this.scene), eyeMat2, -4, 59, 27);

            // Exposed rear cooling spine weakspot
            const spineMat = this.material('stalker-spine-' + index, 0x00e1d9, 0.95);
            stalkerSpine = add(BABYLON.MeshBuilder.CreateCylinder('stalker-spine-' + index, { height: 26, diameter: 8, tessellation: 8 }, this.scene), spineMat, 0, 48, -12);
            stalkerSpine.rotation.x = Math.PI / 2;

            // Underslung rotary burst gun
            if (weapon) weapon.dispose();
            const gunMat = this.environment.surface('stalker-gun-mat-' + index, 0x181c1e, 0.8, 0.2);
            stalkerGun = add(BABYLON.MeshBuilder.CreateCylinder('stalker-gun-' + index, { height: 38, diameter: 7, tessellation: 8 }, this.scene), gunMat, 0, 32, 22);
            stalkerGun.rotation.x = Math.PI / 2;
            const drumMat = this.environment.surface('stalker-drum-' + index, 0x6e4e2a, 0.4, 0.6);
            add(BABYLON.MeshBuilder.CreateCylinder('stalker-drum-' + index, { height: 8, diameter: 14, tessellation: 10 }, this.scene), drumMat, 0, 26, 16);
        } else if (archetype === 'bombard') {
            // Reinforced industrial chassis
            torso.scaling.set(1.4, 1.2, 1.5);
            torso.position.set(0, 52, 0);
            if (head) head.position.set(0, 78, 8);
            if (eye) eye.position.set(0, 78, 17);

            // Heavy Artillery Mortar Cannon mounted on upper back (angled 62° upwards)
            const tubeMat = this.environment.surface('bombard-tube-' + index, 0x222a2e, 0.8, 0.25);
            mortarTube = add(BABYLON.MeshBuilder.CreateCylinder('bombard-mortar-' + index, { height: 56, diameterTop: 16, diameterBottom: 22, tessellation: 14 }, this.scene), tubeMat, 0, 85, -6);
            mortarTube.rotation.x = -Math.PI / 2.9;

            const rimMat = this.environment.surface('bombard-rim-' + index, 0x8c4b1b, 0.4, 0.5);
            const rim = add(BABYLON.MeshBuilder.CreateTorus('bombard-rim-' + index, { diameter: 16, thickness: 3, tessellation: 16 }, this.scene), rimMat, 0, 108, -19);
            rim.rotation.x = -Math.PI / 2.9;

            // Rear Heat Exhaust Vent (weakspot)
            const ventMat = this.material('bombard-vent-' + index, 0xff7700, 0.95);
            add(BABYLON.MeshBuilder.CreateBox('bombard-vent-' + index, { width: 16, height: 18, depth: 6 }, this.scene), ventMat, 0, 48, -20);

            // Tripod stabilizer outriggers (2 front-sides, 1 rear anchor)
            const stabMat = this.environment.surface('bombard-stab-' + index, 0x3d494d, 0.6, 0.4);
            const outriggers = [
                { name: 'rear', pos: [0, 22, -28], rot: [0.45, 0, 0] },
                { name: 'left', pos: [-24, 22, 12], rot: [-0.2, 0, 0.5] },
                { name: 'right', pos: [24, 22, 12], rot: [-0.2, 0, -0.5] }
            ];
            stabilizerLegs = [];
            for (const out of outriggers) {
                const strut = add(BABYLON.MeshBuilder.CreateCylinder('bombard-strut-' + index + '-' + out.name, { height: 38, diameter: 9, tessellation: 8 }, this.scene), stabMat, out.pos[0], out.pos[1], out.pos[2]);
                strut.rotation.set(out.rot[0], out.rot[1], out.rot[2]);
                const pad = add(BABYLON.MeshBuilder.CreateBox('bombard-pad-' + index + '-' + out.name, { width: 14, height: 6, depth: 16 }, this.scene), dark, out.pos[0] * 1.35, -4, out.pos[2] * 1.35);
                stabilizerLegs.push({ strut, pad, basePos: [...out.pos] });
            }
        }

        World3D.addObject(this.app.location.view, root, 'actor', { ink: false, outline: false });
        this.visuals.push({ mesh: root, material: null });
        return { root, eye, head, torso, legs, arms, weapon, searchlightCone, searchlightMat, mortarTube, stabilizerLegs, stalkerSpine, stalkerGun };
    }

    spawnEnemies() {
        const pointSets = [
            [
                [780, 2950], [920, 2450], [1040, 3100], [1450, 1850], [1850, 1550],
                [3200, 1100], [3450, 750], [1200, 1400], [2100, 2200], [2900, 2800],
                [3350, 3100], [3650, 1250], [980, 1070], [3150, 3450], [2250, 1350], [2650, 3350]
            ],
            [
                [760, 2850], [950, 2350], [1120, 3050], [1520, 1750], [1950, 1450],
                [3100, 1050], [3350, 800], [1300, 1300], [2200, 2100], [2800, 2700],
                [3250, 3000], [3550, 1200], [1080, 1170], [3050, 3350], [2350, 1450], [2750, 3250]
            ],
            [
                [820, 3050], [900, 2550], [1080, 3150], [1400, 1950], [1750, 1650],
                [3300, 1150], [3550, 700], [1100, 1500], [2000, 2300], [3000, 2900],
                [3450, 3200], [3750, 1300], [880, 970], [3250, 3550], [2150, 1250], [2550, 3450]
            ]
        ];
        // Peaceful / No Enemies mode: if the map explicitly specifies `noEnemies: true` or `peaceful: true`,
        // or if `enemies: []` is authored with `noEnemies: true`, do not spawn any enemies at all.
        const isPeaceful = !!(this.level?.noEnemies || this.level?.peaceful);
        // An EMPTY authored list means "this map defines no spawns", not "spawn nothing". A
        // truthiness test treated `[]` as authored and produced a raid with zero enemies (unless isPeaceful).
        const authoredEnemies = isPeaceful ? [] : ((Array.isArray(this.level?.enemies) && this.level.enemies.length) ? this.level.enemies : null);
        const points = isPeaceful ? [] : (authoredEnemies ? authoredEnemies.map(e => [e.x, e.y]) : pointSets[Math.abs(this.seed) % pointSets.length]);
        const spawnCount = isPeaceful ? 0 : (authoredEnemies ? points.length : Math.min(Math.max(this.c.enemyCount, 12), points.length));
        for (let i = 0; i < spawnCount; i++) {
            const p = points[i];
            let archetype = 'guard';
            if (i === 0 || i === 7) archetype = 'spotter';
            else if (i === 5 || i === 11) archetype = 'screamer';
            else if (i === 2 || i === 8) archetype = 'cricket';
            else if (i === 4 || i === 12) archetype = 'sentinel';
            else if (i === 1 || i === 10) archetype = 'stalker';
            else if (i === 6 || i === 13) archetype = 'bombard';
            else if (i === 3 || i === 14) archetype = 'pop';
            else if (i % 3 === 1) archetype = 'scout';
            else if (i % 5 === 4) archetype = 'heavy';

            if (authoredEnemies) archetype = authoredEnemies[i].archetype || 'stalker';
            const typeKey = archetype.toUpperCase();
            const machineDef = (typeof ARC_MACHINE_TYPES !== 'undefined' && ARC_MACHINE_TYPES[typeKey])
                ? ARC_MACHINE_TYPES[typeKey]
                : (typeof ARC_MACHINE_TYPES !== 'undefined' ? ARC_MACHINE_TYPES.GUARD : null);

            const radius = machineDef ? machineDef.radius : (archetype === 'bombard' ? 65 : 38);
            const height = machineDef ? machineDef.height : (archetype === 'bombard' ? 180 : archetype === 'sentinel' ? 165 : archetype === 'screamer' ? 160 : archetype === 'heavy' ? 150 : archetype === 'guard' ? 120 : archetype === 'stalker' ? 110 : 80);
            const hp = machineDef ? machineDef.hp : this.c.enemyHp;
            const visionAngleDeg = machineDef?.visionAngleDeg || 90;
            const visionAngle = (visionAngleDeg * Math.PI) / 180;
            const visionRange = machineDef?.visionRange || this.c.aggro;
            const hearingRadius = machineDef?.hearingRadius || 160;
            const speed = machineDef?.speed || 105;

            const dormant = authoredEnemies ? !!authoredEnemies[i].dormant : i >= Math.min(this.c.enemyCount, 10);
            const enemy = {
                id: i + 1, archetype, x: p[0], y: p[1], radius, height, hp, maxHp: hp, speed,
                visionAngle, visionAngleDeg, visionRange, hearingRadius,
                cooldown: i * 0.12, alert: 0, shotSerial: 0, dormant, dead: false,
                path: null, pathIndex: 0, pathTimer: 0
            };
            const robot = this.createEnemyRobot(i, archetype);
            enemy.visual = robot.root;
            enemy.eye = robot.eye;
            enemy.head = robot.head;
            enemy.torso = robot.torso;
            enemy.legs = robot.legs;
            enemy.arms = robot.arms;
            enemy.weapon = robot.weapon;
            enemy.searchlightCone = robot.searchlightCone;
            enemy.searchlightMat = robot.searchlightMat;
            if (archetype === 'spotter') {
                enemy.flyAltitude = 95;
                enemy.flyPhase = i * 1.7;
                enemy.height = 65;
            }
            if (archetype === 'cricket') {
                enemy.leapCooldown = 1.5 + (i % 3) * 0.8;
                enemy.isLeaping = false;
                enemy.leapProgress = 0;
            }
            if (archetype === 'screamer') {
                enemy.screamCooldown = 3.0 + (i % 2) * 2.0;
                enemy.screamTimer = 0;
            }
            if (archetype === 'stalker') {
                enemy.flankSide = (i % 2 === 0) ? 1 : -1;
                enemy.burstCooldown = 1.2 + (i % 3) * 0.4;
                enemy.bursting = false;
                enemy.burstTimer = 0;
                enemy.burstRoundsLeft = 0;
                enemy.burstInterval = 0.08;
                enemy.stalkerSpine = robot.stalkerSpine;
            }
            if (archetype === 'bombard') {
                enemy.isDeployed = false;
                enemy.deployTimer = 0;
                enemy.deployProgress = 0;
                enemy.mortarCooldown = 2.5 + (i % 2) * 2.0;
                enemy.mortarTube = robot.mortarTube;
                enemy.stabilizerLegs = robot.stabilizerLegs;
            }
            enemy.stagger = 0;
            enemy.walkTime = 0;
            enemy.strafeDir = (i % 2 === 0) ? 1 : -1;
            enemy.strafeTimer = 1.0 + (i % 3) * 0.5;
            enemy.baseEyeColor = robot.eye.material.emissiveColor.clone();
            enemy.hitFlash = 0;
            enemy.homeX = p[0]; enemy.homeY = p[1];
            enemy.patrolRadius = 140 + (i % 4) * 45;
            enemy.patrolSpeed = archetype === 'scout' || archetype === 'cricket' || archetype === 'stalker' ? 75 : archetype === 'sentinel' || archetype === 'screamer' ? 45 : archetype === 'bombard' ? 35 : 55;
            enemy.state = 'patrol'; enemy.lastX = p[0]; enemy.lastY = p[1];
            enemy.patrolPhase = i * 1.37;
            this.enemies.push(enemy);
        }
        const lootSets = [
            [[1150, 2950], [2150, 1650], [3300, 2800]],
            [[980, 2450], [2150, 1650], [3450, 850]],
            [[750, 2200], [2100, 2200], [3650, 1200]]
        ];
        // Same empty-list rule as the enemy spawns: a map with no authored drives gets the built-in
        // layout. An empty authored list previously produced ZERO drives, and because the loop
        // bound below also keyed off `this.level`, the fallback layout was lost as well — the
        // raid objective became impossible to complete.
        const authoredDrives = (Array.isArray(this.level?.drives) && this.level.drives.length) ? this.level.drives : null;
        const lootSpots = authoredDrives ? authoredDrives.map(d => [d.x, d.y]) : lootSets[this.seed % lootSets.length];
        for (let i = 0; i < (authoredDrives ? lootSpots.length : this.c.lootTarget); i++) {
            const p = lootSpots[i % lootSpots.length];
            const mesh = BABYLON.MeshBuilder.CreateBox('data-drive-' + i, { size: 28 }, this.scene);
            const mat = this.material('drive-mat-' + i, 0x00e5ff, 0.9);
            mat.emissiveColor = new BABYLON.Color3(0, 0.9, 1.0);
            this.addVisual(mesh, mat, 'actor', { castShadow: false, ink: false, outline: false });
            this.place(mesh, p[0], p[1], 18);

            const beam = BABYLON.MeshBuilder.CreateCylinder('data-beam-' + i, { height: 160, diameterTop: 4, diameterBottom: 16, tessellation: 16 }, this.scene);
            const beamMat = this.material('data-beam-mat-' + i, 0x00e5ff, 0.85);
            beamMat.alpha = 0.35;
            this.addVisual(beam, beamMat, 'prop', { castShadow: false, receiveShadows: false, ink: false, outline: false });
            this.place(beam, p[0], p[1], 80);

            this.pickups.push({ x: p[0], y: p[1], radius: 48, taken: false, visual: mesh, beam, phase: i * 2 });
        }
    }

    spawnLootContainers() {
        // Empty authored list -> built-in crate layout, for the same reason as the spawns and
        // the drives: a map with no crates must still host lootable containers.
        const authoredContainers = (Array.isArray(this.level?.containers) && this.level.containers.length) ? this.level.containers : null;
        const spots = authoredContainers ? authoredContainers.map(c => [c.x, c.y]) : [
            [430, 2930], [1180, 2520], [930, 1470], [1890, 1820],
            [2850, 1120], [3450, 850], [3300, 2850], [2750, 3350]
        ];
        const typeByName = {
            ammo: { type: 'ammo', label: ['Боеприпасы', 'Ammo'], value: 20 },
            scrap: { type: 'scrap', label: ['Металлолом', 'Scrap'], value: 35 },
            medkit: { type: 'medkit', label: ['Аптечка', 'Medkit'], value: 55 },
            electronics: { type: 'electronics', label: ['Электроника', 'Electronics'], value: 75 },
            intel: { type: 'intel', label: ['Разведданные', 'Intel'], value: 120 }
        };
        for (let i = 0; i < spots.length; i++) {
            const p = spots[i], item = typeByName[authoredContainers?.[i]?.type || ShooterRules.rollLoot(this.seed, i)] || typeByName.scrap;
            const mesh = BABYLON.MeshBuilder.CreateBox('loot-container-' + i, { width: 54, height: 34, depth: 40 }, this.scene);
            const mat = this.material('loot-container-mat-' + i, 0x46564d);
            this.addVisual(mesh, mat, 'prop', { castShadow: false, ink: false, outline: false });
            this.place(mesh, p[0], p[1], 16);
            this.containers.push({ id: i, x: p[0], y: p[1], radius: 48, opened: false, item, visual: mesh });
            // A crate is real cover: register its collision footprint with its ACTUAL height
            // (34 px box lifted 16 px), not the 80 px default, or bullets fly through it while
            // a taller invisible cylinder blocks the air above.
            const crate = { x: p[0], y: p[1], radius: 34, height: 34 + 16 };
            this.blockers.push(crate);
            this.coverBlockers.push(crate);
        }
    }

    showLootFeed(item, taken) {
        // Items reach here from several paths; some (data drives, server loot results) carry
        // name/nameRu instead of the bilingual `label` pair, so the label is derived, never
        // assumed. Reading item.label[0] on those threw and killed the loot feed.
        const ru = Array.isArray(item?.label) ? item.label[0] : (item?.nameRu || item?.name || item?.type || '');
        const en = Array.isArray(item?.label) ? item.label[1] : (item?.name || item?.type || ru);
        this.lootFeedText = taken ? this.text('ПОЛУЧЕНО: ', 'ACQUIRED: ') + this.text(ru, en) + ' +' + (item?.value || 0)
            : this.text('РЮКЗАК ПОЛОН', 'BACKPACK FULL');
        this.lootFeedTimer = 2.2;
    }

    readMechanics() {
        return {
            stamina: {
                max: typeof GAME_STAMINA_MAX !== 'undefined' ? GAME_STAMINA_MAX : 100,
                drain: typeof GAME_STAMINA_DRAIN !== 'undefined' ? GAME_STAMINA_DRAIN : 22,
                regen: typeof GAME_STAMINA_REGEN !== 'undefined' ? GAME_STAMINA_REGEN : 18,
                delay: typeof GAME_STAMINA_DELAY !== 'undefined' ? GAME_STAMINA_DELAY : 1.2,
                restart: typeof GAME_STAMINA_RESTART !== 'undefined' ? GAME_STAMINA_RESTART : 30,
            },
            shotNoise: typeof GAME_NOISE_SHOT !== 'undefined' ? GAME_NOISE_SHOT : 750,
            sprintNoise: typeof GAME_NOISE_SPRINT !== 'undefined' ? GAME_NOISE_SPRINT : 320,
            walkNoise: typeof GAME_NOISE_WALK !== 'undefined' ? GAME_NOISE_WALK : 100,
            interactRange: typeof GAME_INTERACT_RANGE !== 'undefined' ? GAME_INTERACT_RANGE : 70,
            slots: typeof GAME_BACKPACK_SLOTS !== 'undefined' ? GAME_BACKPACK_SLOTS : 18,
            reserveCapacity: typeof GAME_RESERVE_CAPACITY !== 'undefined' ? GAME_RESERVE_CAPACITY : 120,
            medkitCapacity: typeof GAME_MEDKIT_CAPACITY !== 'undefined' ? GAME_MEDKIT_CAPACITY : 4,
        };
    }

    emitNoise(radius) {
        for (const enemy of this.enemies) RaidRules.hear(enemy, this.player, radius);
    }

    // UI adapters consume copies and issue commands instead of mutating simulation fields.
    getSnapshot() {
        const action = this.reloadTimer > 0 ? 'reload' : this.healTimer > 0 ? 'heal' : this.searchTimer > 0 ? 'search' : null;
        const remaining = action === 'reload' ? this.reloadTimer : action === 'heal' ? this.healTimer : action === 'search' ? this.searchTimer : 0;
        const duration = action === 'reload' ? this.c.reload : action === 'heal' ? this.c.healSec : action === 'search' ? this.c.searchSec : 0;
        return {
            version: 1, phase: this.phase, paused: this.paused, seed: this.seed, time: this.time,
            player: { ...this.player },
            stamina: { ...this.stamina, max: this.mechanics.stamina.max, sprinting: !!this.weapon.sprinting },
            weapon: { ammo: this.ammo, reserve: this.reserveAmmo, magazine: this.c.mag },
            medkits: this.medkits,
            action: { type: action, remaining, progress: duration ? ShooterRules.clamp(1 - remaining / duration, 0, 1) : 0 },
            // Every item needs a two-element bilingual label. A data drive is built from the
            // objective path and has only name/nameRu, so spreading it and reading `.label`
            // threw "item.label is not iterable" and broke the whole snapshot contract.
            inventory: this.backpack.map(item => ({
                ...item,
                label: Array.isArray(item.label)
                    ? [...item.label]
                    : [item.nameRu || item.name || item.type || 'ITEM', item.name || item.type || 'ITEM']
            })),
            inventoryCapacity: this.mechanics.slots,
            extraction: { state: this.extractState, drives: this.loot, target: this.c.lootTarget,
                inbound: this.inboundTimer, progress: this.extractProgress, contested: this.extractContested },
            raidValue: this.raidValue, kills: this.kills, profile: { ...this.profile },
        };
    }

    command(name) {
        if (name === 'reload') return this.startReload();
        if (name === 'heal') return this.startHeal();
        if (name === 'interact') return this.startInteract();
        if (name === 'cancel-action' && RaidRules.canAct(this)) {
            this.reloadTimer = 0;
            this.healTimer = 0;
            this.cancelSearch();
            return true;
        }
        if ((name === 'pause' || name === 'resume') && this.phase === 'raid') {
            this.setPaused(name === 'pause');
            return true;
        }
        return false;
    }

    nearestContainer() {
        let best = null, bestD = this.mechanics.interactRange ** 2;
        for (const box of this.containers) {
            if (!RaidRules.canSearch(this.player, box, this.coverBlockers, this.mechanics.interactRange)) continue;
            const d = ShooterRules.distanceSq(this.player, box);
            if (d < bestD) { best = box; bestD = d; }
        }
        return best;
    }

    startReload() {
        if (!RaidRules.canAct(this) || RaidRules.busy(this) || this.ammo >= this.c.mag || this.reserveAmmo <= 0) return false;
        const loadoutPrimary = (typeof MenuSystem !== 'undefined' && MenuSystem.loadout?.primary) ? MenuSystem.loadout.primary : null;
        const stats = (loadoutPrimary && typeof RaidRules !== 'undefined' && RaidRules.getWeaponEffectiveStats) ? RaidRules.getWeaponEffectiveStats(loadoutPrimary) : null;
        const reloadMult = stats ? stats.reloadTimeMult : 1.0;
        this.reloadDuration = this.c.reload * reloadMult;
        this.reloadTimer = this.reloadDuration;
        this.aiming = false;
        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
            ProceduralAudio.combat.playMagOut();
            setTimeout(() => {
                if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
                    ProceduralAudio.combat.playMagIn();
                }
            }, Math.min(600, (this.reloadDuration * 0.4) * 1000));
            setTimeout(() => {
                if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
                    ProceduralAudio.combat.playBoltRack();
                }
            }, Math.min(1200, (this.reloadDuration * 0.8) * 1000));
        }
        return true;
    }

    startHeal() {
        if (!RaidRules.canAct(this) || RaidRules.busy(this) || this.medkits <= 0 || this.player.hp >= this.player.maxHp) return false;
        this.healTimer = this.c.healSec;
        this.reloadTimer = 0;
        this.firing = false;
        this.aiming = false;
        return true;
    }

    startInteract() {
        if (!RaidRules.canAct(this) || RaidRules.busy(this)) return false;
        // 1. Primary Extraction Alpha: Cargo Elevator. This is the MAIN objective exit, so it only
        // opens once the raid objective is met. The authoritative server gates it the same way
        // (`extractionState === 'locked'` until `collectedDrives >= target`); without the gate a
        // player could walk to the elevator with 0 of 3 drives, hold six seconds and win.
        if (this.extractState === 'available' && ShooterRules.distanceSq(this.player, this.extract) <= this.extract.radius ** 2) {
            if ((this.loot || 0) < (this.c.lootTarget || 3)) {
                // Say why, then FALL THROUGH to the other interactions instead of returning:
                // the elevator zone overlaps loot crates and drives, and a terminal `return
                // false` here made every one of them unusable while the player stood in it.
                this.lootFeedText = this.text(
                    `НУЖНЫ НАКОПИТЕЛИ: ${this.loot || 0} / ${this.c.lootTarget || 3}`,
                    `DRIVES REQUIRED: ${this.loot || 0} / ${this.c.lootTarget || 3}`);
                this.lootFeedTimer = 2.2;
            } else {
                this.extractState = 'inbound';
                this.inboundTimer = this.c.inboundSec;
                this.beaconSirenAlertSent = false;
                return true;
            }
        }
        // 2. Secondary Extraction Beta: Metro Station
        if (this.metroExtract && this.metroExtract.state === 'available' && ShooterRules.distanceSq(this.player, this.metroExtract) <= this.metroExtract.radius ** 2) {
            this.metroExtract.state = 'inbound';
            this.metroExtract.inboundTimer = this.c.inboundSec;
            this.metroExtract.sirenAlertSent = false;
            return true;
        }
        // 3. Data Drive pickups nearby
        if (Array.isArray(this.pickups)) {
            for (const pickup of this.pickups) {
                if (!pickup.taken && ShooterRules.distanceSq(this.player, pickup) <= (this.player.radius + pickup.radius + 30) ** 2) {
                    this.ensureBackpack18();
                    const bpIdx = this.backpack.findIndex(s => !s);
                    if (bpIdx === -1) {
                        this.showLootFeed({ name: this.text('РЮКЗАК ПОЛОН', 'BACKPACK FULL') }, false);
                        return false;
                    }
                    pickup.taken = true;
                    if (pickup.visual) pickup.visual.setEnabled(false);
                    if (pickup.beam) pickup.beam.setEnabled(false);
                    this.loot++;
                    this.noteLootTaken();
                    this.raidValue += 300;
                    const driveItem = {
                        id: 'data_drive_' + this.loot,
                        name: 'Encrypted Data Drive #' + this.loot,
                        nameRu: 'Зашифрованный накопитель данных #' + this.loot,
                        type: 'intel',
                        category: 'intel',
                        rarity: 'rare',
                        value: 300,
                        weight: 1.2,
                        description: 'ARC memory storage cylinder recovered from industrial telemetry terminal.'
                    };
                    this.backpack[bpIdx] = driveItem;
                    this.lootFeedTimer = 3.0;
                    this.lootFeedText = this.text('+ НАКОПИТЕЛЬ ДАННЫХ [300 CR]', '+ DATA DRIVE ACQUIRED [300 CR]');
                    this.playSound('loot', 0.6, 0.05);
                    this.updateHud(true);
                    return true;
                }
            }
        }
        // 4. Container Search
        const box = this.nearestContainer();
        if (!box) return false;
        this.searchTarget = box;
        this.searchTimer = this.c.searchSec;
        this.firing = false;
        this.aiming = false;
        return true;
    }

    cancelSearch() {
        this.searchTimer = 0;
        this.searchTarget = null;
    }

    completeSearch() {
        const box = this.searchTarget;
        this.searchTimer = 0;
        this.searchTarget = null;
        if (!box) return;
        if (!RaidRules.canAct(this) || !RaidRules.canSearch(this.player, box, this.coverBlockers, this.mechanics.interactRange)) return;

        if (typeof OnlineBridge !== 'undefined' && OnlineBridge.active() && box && box.id != null) {
            OnlineBridge.searchCrate(box.id);
            return;
        }
        const item = box.item;
        if (!item) return;

        const instant = item.type === 'ammo' || item.type === 'medkit';
        if (instant) {
            const ammo = item.type === 'ammo';
            const available = box.remaining == null ? (ammo ? 20 : 1) : box.remaining;
            const transfer = RaidRules.transferResource(ammo ? this.reserveAmmo : this.medkits, available,
                ammo ? this.mechanics.reserveCapacity : this.mechanics.medkitCapacity);
            if (!transfer.moved) return;
            if (ammo) this.reserveAmmo = transfer.current;
            else this.medkits = transfer.current;
            box.remaining = transfer.remaining;
            box.opened = transfer.remaining === 0;
            if (box.opened && box.visual && box.visual.scaling) box.visual.scaling.y = 0.35;
            this.showLootFeed(item, true);
            this.updateHud(true);
        } else {
            // Non-instant loot is transferred through the inventory panel, which opens on the
            // searched crate. The crate is NOT marked opened and its visual is NOT collapsed
            // here: if the player closes the panel without taking the item, the container still
            // holds it, and collapsing the mesh early made an unlooted crate look searched.
            // `RaidInventory.takeAllFromContainer` (and the online applySearchResult path) own
            // both the `opened` flag and the collapse, once the item has actually moved.
            if (this.raidInventory && !this.raidInventory.visible && typeof document !== 'undefined' && document.createElement) {
                this.raidInventory.open(this, box);
            } else {
                // No inventory panel available (headless/tests): complete the transfer directly so
                // a search always has an observable result instead of silently doing nothing.
                this.raidInventoryTake(box);
            }
        }
    }

    /**
     * Move a searched container's item into the backpack without the inventory panel.
     * Shared by the headless path; the panel has its own equivalent.
     * @param {any} box
     * @returns {boolean}
     */
    raidInventoryTake(box) {
        if (!box || !box.item) return false;
        if (this.backpackIsFull()) {
            this.showLootFeed(box.item, false);
            return false;
        }
        this.ensureBackpack18();
        const idx = this.backpack.findIndex(s => !s);
        if (idx === -1) {
            this.showLootFeed(box.item, false);
            return false;
        }
        const taken = box.item;
        this.backpack[idx] = taken;
        this.raidValue += (taken.value || 0);
        box.item = null;
        box.opened = true;
        if (box.visual && box.visual.scaling) box.visual.scaling.y = 0.35;
        this.noteLootTaken();
        this.showLootFeed(taken, true);
        if (typeof RaidRules !== 'undefined' && RaidRules.calculateLoadoutWeight) {
            const loadoutObj = typeof MenuSystem !== 'undefined' ? MenuSystem.loadout : {};
            this.totalWeight = RaidRules.calculateLoadoutWeight(loadoutObj, this.backpack);
            this.encumbrance = RaidRules.getEncumbrance(this.totalWeight);
        }
        this.updateHud(true);
        return true;
    }

    createPlayerVisual() {
        const hero = this.app.location.objects.find(o => o.def.name === 'character');
        this.hero = hero || null;
        if (hero) {
            hero.def.x = this.player.x;
            hero.def.y = this.player.y;
            hero.def.scale = [0.25, 0.25, 0.25];
            this.app.location.placeObject(hero);
        }
        if (!hero) {
            const mesh = BABYLON.MeshBuilder.CreateCapsule('operator', { height: 76, radius: 22, tessellation: 12 }, this.scene);
            this.addVisual(mesh, this.material('operator-mat', 0x263b34), 'actor', { ink: false, outline: false });
            this.playerVisual = mesh;
        } else this.playerVisual = null;
    }

    createExtractionVisual() {
        if (this.extract.disabled) return;
        const mesh = BABYLON.MeshBuilder.CreateCylinder('extract-zone', { height: 3, diameter: this.extract.radius * 2, tessellation: 48 }, this.scene);
        const mat = this.material('extract-mat', 0x38c77a, 0.35);
        mat.alpha = 0.35;
        this.addVisual(mesh, mat, 'prop', { castShadow: false, receiveShadows: false, ink: false, outline: false });
        const beam = BABYLON.MeshBuilder.CreateCylinder('extract-beam', { height: 180, diameterTop: 12, diameterBottom: this.extract.radius * 1.2, tessellation: 32 }, this.scene);
        const beamMat = this.material('extract-beam-mat', 0x38c77a, 0.55);
        beamMat.alpha = 0.12;
        this.addVisual(beam, beamMat, 'prop', { castShadow: false, receiveShadows: false, ink: false, outline: false });
        beam.setEnabled(true);
        this.extract.beam = beam;
        const transport = new BABYLON.Mesh('extract-transport', this.scene);
        const hullMat = this.material('transport-hull', 0x26363a);
        const engineMat = this.material('transport-engine', 0x54d6c0, 0.9);
        const hull = BABYLON.MeshBuilder.CreateBox('transport-hull', { width: 120, height: 38, depth: 220 }, this.scene);
        hull.parent = transport; hull.material = hullMat;
        const cabin = BABYLON.MeshBuilder.CreateBox('transport-cabin', { width: 90, height: 35, depth: 70 }, this.scene);
        cabin.parent = transport; cabin.position.z = -55; cabin.position.y = 28; cabin.material = hullMat;
        for (const side of [-1, 1]) {
            const wing = BABYLON.MeshBuilder.CreateBox('transport-wing', { width: 95, height: 8, depth: 50 }, this.scene);
            wing.parent = transport; wing.position.x = side * 75; wing.material = hullMat;
            const engine = BABYLON.MeshBuilder.CreateCylinder('transport-engine', { height: 46, diameter: 26, tessellation: 12 }, this.scene);
            engine.parent = transport; engine.position.x = side * 92; engine.rotation.x = Math.PI / 2; engine.material = engineMat;
        }
        const skidMat = this.material('transport-skid', 0x182022);
        for (const side of [-1, 1]) {
            const skid = BABYLON.MeshBuilder.CreateBox('transport-skid-' + side, { width: 14, height: 12, depth: 190 }, this.scene);
            skid.parent = transport; skid.position.set(side * 52, -24, 0); skid.material = skidMat;
            const strut1 = BABYLON.MeshBuilder.CreateCylinder('transport-strut-1-' + side, { height: 16, diameter: 8 }, this.scene);
            strut1.parent = transport; strut1.position.set(side * 52, -14, -50); strut1.material = skidMat;
            const strut2 = BABYLON.MeshBuilder.CreateCylinder('transport-strut-2-' + side, { height: 16, diameter: 8 }, this.scene);
            strut2.parent = transport; strut2.position.set(side * 52, -14, 50); strut2.material = skidMat;
        }
        const rampMat = this.material('transport-ramp', 0x223034);
        const ramp = BABYLON.MeshBuilder.CreateBox('transport-ramp', { width: 70, height: 6, depth: 75 }, this.scene);
        ramp.parent = transport; ramp.position.set(0, -16, 110); ramp.material = rampMat;
        this.extract.ramp = ramp;
        World3D.addObject(this.app.location.view, transport, 'prop', { castShadow: true, ink: false, outline: false });
        this.visuals.push({ mesh: transport, material: hullMat });
        transport.setEnabled(false);
        this.extract.transport = transport;
        this.extract.visual = mesh;
        mesh.setEnabled(true);

        // Metro Station B (West)
        if (this.metroExtract) {
            const mMesh = BABYLON.MeshBuilder.CreateCylinder('metro-extract-zone', { height: 3, diameter: this.metroExtract.radius * 2, tessellation: 48 }, this.scene);
            const mMat = this.material('metro-extract-mat', 0x06b6d4, 0.45);
            mMat.alpha = 0.45;
            this.addVisual(mMesh, mMat, 'prop', { castShadow: false, receiveShadows: false, ink: false, outline: false });
            mMesh.setEnabled(true);
            this.place(mMesh, this.metroExtract.x, this.metroExtract.y, 2);
            this.metroExtract.visual = mMesh;

            const mBeam = BABYLON.MeshBuilder.CreateCylinder('metro-extract-beam', { height: 180, diameterTop: 12, diameterBottom: this.metroExtract.radius * 1.2, tessellation: 32 }, this.scene);
            const mBeamMat = this.material('metro-extract-beam-mat', 0x06b6d4, 0.65);
            mBeamMat.alpha = 0.18;
            this.addVisual(mBeam, mBeamMat, 'prop', { castShadow: false, receiveShadows: false, ink: false, outline: false });
            mBeam.setEnabled(true);
            this.place(mBeam, this.metroExtract.x, this.metroExtract.y, 90);
            this.metroExtract.beam = mBeam;
        }
    }

    createHatchVisual() {
        if (!this.hatchExtract) return;
        const terrain = this.app?.location?.terrain;
        const h = terrain ? terrain.heightAt(this.hatchExtract.x, this.hatchExtract.y) : 0;
        const root = new BABYLON.TransformNode('raider-bunker-hatch', this.scene);
        root.position.set(this.hatchExtract.x, h, this.hatchExtract.y);

        const steelMat = this.material('hatch-steel', 0x222a2e, 0.4);
        const rimMat = this.material('hatch-rim', 0x985e44, 0.6);
        const ledMat = this.material('hatch-led', 0x35d6c6, 0.95);
        ledMat.emissiveColor = new BABYLON.Color3(0.2, 0.84, 0.77);

        // Concrete base pad
        const pad = BABYLON.MeshBuilder.CreateBox('hatch-pad', { width: 90, height: 6, depth: 90 }, this.scene);
        pad.parent = root; pad.position.y = 3; pad.material = steelMat;

        // Outer reinforced vault ring
        const rim = BABYLON.MeshBuilder.CreateCylinder('hatch-rim-mesh', { height: 10, diameter: 74, tessellation: 32 }, this.scene);
        rim.parent = root; rim.position.y = 8; rim.material = rimMat;

        // Armored hatch door
        const door = BABYLON.MeshBuilder.CreateCylinder('hatch-door-mesh', { height: 8, diameter: 58, tessellation: 32 }, this.scene);
        door.parent = root; door.position.y = 12; door.material = steelMat;

        // Heavy locking wheel
        const wheel = BABYLON.MeshBuilder.CreateTorus('hatch-wheel', { diameter: 22, thickness: 4, tessellation: 20 }, this.scene);
        wheel.parent = root; wheel.position.y = 17; wheel.rotation.x = Math.PI / 2; wheel.material = steelMat;

        // Hydraulic terminal / Card reader pedestal
        const pedestal = BABYLON.MeshBuilder.CreateBox('hatch-terminal', { width: 14, height: 26, depth: 10 }, this.scene);
        pedestal.parent = root; pedestal.position.set(38, 14, 0); pedestal.material = steelMat;

        // Status LED light
        const led = BABYLON.MeshBuilder.CreateSphere('hatch-status-led', { diameter: 6 }, this.scene);
        led.parent = root; led.position.set(38, 28, 0); led.material = ledMat;

        World3D.addObject(this.app.location.view, pad, 'prop', { castShadow: true, ink: false, outline: false });
        World3D.addObject(this.app.location.view, rim, 'prop', { castShadow: true, ink: false, outline: false });
        World3D.addObject(this.app.location.view, door, 'prop', { castShadow: true, ink: false, outline: false });
        World3D.addObject(this.app.location.view, pedestal, 'prop', { castShadow: true, ink: false, outline: false });

        this.hatchExtract.visual = root;
        this.hatchExtract.ledMat = ledMat;
    }

    spawnHazards() {
        this.hazards = [];
        const barrelPoints = [[473, 1510], [1080, 1200], [1580, 730], [850, 1100]];
        const breakerPoints = [[720, 1530], [1270, 875]];
        const terrain = this.app?.location?.terrain;

        const barrelMat = this.material('barrel-hazard-red', 0x991b1b, 0.5);
        barrelMat.emissiveColor = new BABYLON.Color3(0.2, 0.03, 0.03);
        const stripeMat = this.material('barrel-stripe-yellow', 0xf59e0b, 0.7);

        barrelPoints.forEach((p, idx) => {
            const h = terrain ? terrain.heightAt(p[0], p[1]) : 0;
            const root = new BABYLON.TransformNode('fuel-barrel-' + idx, this.scene);
            root.position.set(p[0], h + 18, p[1]);

            const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel-mesh-' + idx, { height: 36, diameter: 22, tessellation: 18 }, this.scene);
            barrel.parent = root; barrel.material = barrelMat;

            const stripe = BABYLON.MeshBuilder.CreateCylinder('barrel-stripe-' + idx, { height: 8, diameter: 22.4, tessellation: 18 }, this.scene);
            stripe.parent = root; stripe.material = stripeMat;

            World3D.addObject(this.app.location.view, barrel, 'prop', { castShadow: true, ink: false, outline: false });

            const hazard = {
                id: 'barrel_' + idx,
                type: 'fuel_barrel',
                x: p[0], y: p[1], h: h + 18,
                radius: 18,
                hp: 25, maxHp: 25,
                root, barrel,
                destroyed: false
            };
            this.hazards.push(hazard);
            this.coverBlockers.push({ x: p[0], y: p[1], radius: 18, height: 36 });
        });

        const breakerMat = this.material('breaker-box-mat', 0x334155, 0.3);
        const sparkMat = this.material('breaker-spark-mat', 0x38bdf8, 0.95);
        sparkMat.emissiveColor = new BABYLON.Color3(0.22, 0.74, 0.97);

        breakerPoints.forEach((p, idx) => {
            const h = terrain ? terrain.heightAt(p[0], p[1]) : 0;
            const root = new BABYLON.TransformNode('emp-breaker-' + idx, this.scene);
            root.position.set(p[0], h + 30, p[1]);

            const box = BABYLON.MeshBuilder.CreateBox('breaker-box-' + idx, { width: 24, height: 34, depth: 16 }, this.scene);
            box.parent = root; box.material = breakerMat;

            const light = BABYLON.MeshBuilder.CreateSphere('breaker-light-' + idx, { diameter: 8 }, this.scene);
            light.parent = root; light.position.set(0, 10, 9); light.material = sparkMat;

            World3D.addObject(this.app.location.view, box, 'prop', { castShadow: true, ink: false, outline: false });

            const hazard = {
                id: 'breaker_' + idx,
                type: 'emp_junction',
                x: p[0], y: p[1], h: h + 30,
                radius: 20,
                hp: 20, maxHp: 20,
                root, box, light,
                destroyed: false
            };
            this.hazards.push(hazard);
            this.coverBlockers.push({ x: p[0], y: p[1], radius: 20, height: 60 });
        });
    }

    triggerBarrelExplosion(hazard) {
        if (!hazard || hazard.destroyed) return;
        hazard.destroyed = true;
        if (hazard.root) hazard.root.setEnabled(false);

        if (this.app?.camera?.shake) this.app.camera.shake(180, 0.025);
        this.emitNoise(500);

        const radius = 160;
        const damage = 120;
        const pDist = Math.hypot(this.player.x - hazard.x, this.player.y - hazard.y);
        if (pDist <= radius) {
            const falloff = 1 - (pDist / radius) * 0.5;
            this.applyPlayerDamage(Math.round(damage * falloff), hazard);
        }

        for (const enemy of this.enemies) {
            if (enemy.dead) continue;
            const dist = Math.hypot(enemy.x - hazard.x, enemy.y - hazard.y);
            if (dist <= radius) {
                const falloff = 1 - (dist / radius) * 0.5;
                enemy.hp -= Math.round(damage * falloff);
                enemy.stagger = 0.8;
                enemy.alert = 1;
                enemy.lastX = hazard.x; enemy.lastY = hazard.y;
                if (enemy.hp <= 0) this.killEnemy(enemy);
            } else if (dist <= 500) {
                if (typeof RaidRules !== 'undefined' && RaidRules.hear) {
                    RaidRules.hear(enemy, hazard, 500);
                }
            }
        }
    }

    triggerMortarExplosion(x, y, h, maxDamage = 85, radius = 150) {
        if (this.app?.camera?.shake) this.app.camera.shake(350, 0.045);
        this.emitNoise(800);

        if (this.scene) {
            // Expanding shockwave ring
            const ring = BABYLON.MeshBuilder.CreateTorus('mortar-ring-' + Date.now(), { diameter: 24, thickness: 4, tessellation: 24 }, this.scene);
            const ringMat = this.material('mortar-ring-mat-' + Date.now(), 0xff4411, 0.95);
            ring.material = ringMat;
            ring.position.set(x, h + 2, y);
            this.effects.push({
                mesh: ring,
                life: 0.9,
                update: (fxDt) => {
                    ring.scaling.x += 22 * fxDt;
                    ring.scaling.z += 22 * fxDt;
                    ringMat.alpha = Math.max(0, ringMat.alpha - fxDt * 1.1);
                }
            });

            // Fiery explosion sparks
            for (let i = 0; i < 12; i++) {
                const angle = i * 0.52 + Math.random() * 0.3;
                const spd = 40 + Math.random() * 80;
                const spark = BABYLON.MeshBuilder.CreateLines('mortar-spark-' + i, {
                    points: [
                        new BABYLON.Vector3(x, h + 2, y),
                        new BABYLON.Vector3(x + Math.cos(angle) * spd, h + 8 + Math.random() * 45, y + Math.sin(angle) * spd)
                    ]
                }, this.scene);
                spark.color = new BABYLON.Color3(1.0, 0.45, 0.1);
                this.effects.push({ mesh: spark, life: 0.45 + Math.random() * 0.25 });
            }
        }

        const pDist = Math.hypot(this.player.x - x, this.player.y - y);
        if (pDist <= radius) {
            const falloff = 1 - (pDist / radius) * 0.65;
            const dealt = Math.round(maxDamage * falloff);
            this.applyPlayerDamage(dealt, { x, y, name: 'BOMBARD MORTAR' });
        }

        if (this.hazards) {
            for (const hz of this.hazards) {
                if (hz.destroyed) continue;
                if (Math.hypot(hz.x - x, hz.y - y) <= radius) {
                    hz.hp -= maxDamage;
                    if (hz.hp <= 0) {
                        if (hz.type === 'fuel_barrel') this.triggerBarrelExplosion(hz);
                        else if (hz.type === 'emp_junction') this.triggerEmpDischarge(hz);
                    }
                }
            }
        }
    }

    triggerEmpDischarge(hazard) {
        if (!hazard || hazard.destroyed) return;
        hazard.destroyed = true;
        if (hazard.light) hazard.light.setEnabled(false);

        if (this.app?.camera?.shake) this.app.camera.shake(120, 0.015);

        const radius = 180;
        const pDist = Math.hypot(this.player.x - hazard.x, this.player.y - hazard.y);
        if (pDist <= radius) {
            this.player.shield = Math.max(0, this.player.shield - 150);
            this.player.shieldTimer = 5.0;
            this.damageFlash = 0.3;
        }

        for (const enemy of this.enemies) {
            if (enemy.dead) continue;
            const dist = Math.hypot(enemy.x - hazard.x, enemy.y - hazard.y);
            if (dist <= radius) {
                enemy.stagger = 5.0;
                enemy.empStunned = 5.0;
                if (enemy.searchlightMat) {
                    enemy.searchlightMat.alpha = 0.05;
                }
            }
        }
    }

    triggerLethalBarrage(dt) {
        this.barrageActive = true;
        this.barrageShakeTimer = (this.barrageShakeTimer || 0) + dt;

        if (this.app?.camera?.shake && this.barrageShakeTimer >= 0.08) {
            this.barrageShakeTimer = 0;
            this.app.camera.shake(80, 0.035);
        }

        const dps = this.c.barrageDps || 1000;
        this.applyPlayerDamage(dps * dt, { x: this.player.x, y: this.player.y });
    }

    onKey(e, down) {
        if (e.code === 'Tab') {
            e.preventDefault();
        }
        if (typeof ControlsMenu !== 'undefined' && ControlsMenu.isOpen()) {
            if (down && e.code === 'Escape') {
                ControlsMenu.close();
                e.preventDefault();
            }
            return;
        }
        if (this.phase !== 'raid') return;
        if (down && e.code === 'Escape' && !e.repeat) {
            if (typeof ControlsMenu !== 'undefined' && ControlsMenu.isOpen()) {
                ControlsMenu.close();
                e.preventDefault();
                return;
            }
            if (this.tacticalMap && this.tacticalMap.visible) {
                this.tacticalMap.close();
                e.preventDefault();
                return;
            }
            if (this.raidInventory && this.raidInventory.visible) {
                this.raidInventory.close(true);
                e.preventDefault();
                return;
            }
            this.setPaused(!this.paused);
            return;
        }

        const isMapKey = typeof KeyBindings !== 'undefined' ? KeyBindings.isAction(e.code, 'map') : (e.code === 'KeyM');
        if (down && isMapKey && !e.repeat) {
            if (this.tacticalMap) {
                if (this.raidInventory && this.raidInventory.visible) this.raidInventory.close();
                this.tacticalMap.toggle(this);
            }
            e.preventDefault();
            return;
        }

        const isInvKey = typeof KeyBindings !== 'undefined' ? (KeyBindings.isAction(e.code, 'inventory') || e.code === 'Tab') : (e.code === 'Tab' || e.code === 'KeyI');
        if (down && isInvKey && !e.repeat) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (this.raidInventory) {
                if (this.tacticalMap && this.tacticalMap.visible) this.tacticalMap.close();
                if (this.raidInventory.visible) this.raidInventory.close(true);
                else this.raidInventory.open(this);
            }
            return;
        }

        if (down && e.code === 'F2' && !e.repeat) {
            e.preventDefault();
            if (this.tacticalRange) {
                if (!this.tacticalRange.container) this.tacticalRange.init(this);
                this.tacticalRange.toggle();
            }
            return;
        }

        if (down && (e.code === 'F3' || (e.code === 'Backquote' && !e.ctrlKey && !e.altKey && !e.metaKey)) && !e.repeat) {
            e.preventDefault();
            if (typeof ArcPerformanceOverlay !== 'undefined') {
                ArcPerformanceOverlay.toggle();
            }
            return;
        }
        if (this.tacticalMap?.visible || this.raidInventory?.visible) return;
        if (this.paused) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (typeof OnlineBridge !== 'undefined' && OnlineBridge.spectating) {
            if (down && !e.repeat) {
                if (e.code === 'KeyA' || e.code === 'ArrowLeft' || e.code === 'KeyQ') {
                    const prev = OnlineBridge.cycleSpectateTarget(-1);
                    if (prev && this.app?.camera) {
                        this.app.camera.follow(prev);
                        if (typeof prev.heading === 'number') this.app.camera.azimuth = prev.heading;
                        this.app.camera.pitch = 20 * Math.PI / 180;
                    }
                    e.preventDefault();
                    return;
                }
                if (e.code === 'KeyD' || e.code === 'ArrowRight' || e.code === 'KeyE') {
                    const next = OnlineBridge.cycleSpectateTarget(1);
                    if (next && this.app?.camera) {
                        this.app.camera.follow(next);
                        if (typeof next.heading === 'number') this.app.camera.azimuth = next.heading;
                        this.app.camera.pitch = 20 * Math.PI / 180;
                    }
                    e.preventDefault();
                    return;
                }
            }
            return;
        }

        const slotKeys = ['slot1', 'slot2', 'slot3', 'slot4'];
        for (let i = 0; i < slotKeys.length; i++) {
            const matchesSlot = typeof KeyBindings !== 'undefined' ? KeyBindings.isAction(e.code, slotKeys[i]) : (e.code === `Digit${i + 1}`);
            if (down && !e.repeat && matchesSlot) {
                this.useQuickSlot(i);
                e.preventDefault();
                return;
            }
        }

        if (down) this.keys.add(e.code); else this.keys.delete(e.code);

        const isAct = (action) => typeof KeyBindings !== 'undefined' ? KeyBindings.isAction(e.code, action) : false;

        if (down && !e.repeat && (isAct('jump') || e.code === 'Space')) this.tryJump();
        if (down && !e.repeat && (isAct('reload') || e.code === 'KeyR')) {
            if (this.phase !== 'raid') this.reset();
            else this.startReload();
        }
        if (down && !e.repeat && (isAct('heal') || e.code === 'KeyH')) this.startHeal();

        // Posture controls
        if (down && !e.repeat && (isAct('crouch') || e.code === 'KeyC')) {
            this.posture = (this.posture === 'crouch') ? 'stand' : 'crouch';
            this.updateHud(false);
        }
        if (down && !e.repeat && (isAct('prone') || e.code === 'KeyZ')) {
            this.posture = (this.posture === 'prone') ? 'stand' : 'prone';
            this.updateHud(false);
        }

        // Leaning
        if (isAct('leanLeft') || (typeof KeyBindings === 'undefined' && e.code === 'KeyQ')) {
            this.leanLeft = down;
            this.lean = (this.leanRight ? 1 : 0) - (this.leanLeft ? 1 : 0);
        }
        if (isAct('leanRight') || (typeof KeyBindings === 'undefined' && e.code === 'KeyE')) {
            this.leanRight = down;
            this.lean = (this.leanRight ? 1 : 0) - (this.leanLeft ? 1 : 0);
        }

        // Interact / Loot
        if (isAct('interact') || (typeof KeyBindings === 'undefined' && e.code === 'KeyF')) {
            if (down && !e.repeat) this.startInteract();
        }

        // Combat verbs
        if (down && !e.repeat && (isAct('grenade') || e.code === 'KeyG')) this.throwGrenade();
        if (down && !e.repeat && (isAct('melee') || e.code === 'KeyV')) this.meleeAttack();

        if (down && e.code === 'KeyL' && !e.repeat) {
            this.lang = this.lang === 'ru' ? 'en' : 'ru';
            Store.set('arcengine.game.lang', this.lang);
            this.updateHud(true);
        }
        e.preventDefault();
    }

    useQuickSlot(slotIndex) {
        if (!RaidRules.canAct(this) || RaidRules.busy(this) || this.useItemTimer > 0) return false;
        if (!this.quickSlots || slotIndex < 0 || slotIndex >= this.quickSlots.length) return false;
        const item = this.quickSlots[slotIndex];
        if (!item) return false;

        let duration = 2.0;
        if (item.castSec) duration = item.castSec;
        else if (item.id === 'consumable_stim') duration = 1.0;
        else if (item.id === 'consumable_small_battery') duration = 2.5;
        else if (item.id === 'consumable_overcharger') duration = 5.0;
        else if (item.id === 'consumable_medkit') duration = 4.0;

        this.useItemDuration = duration;
        this.useItemTimer = duration;
        this.activeItemIndex = slotIndex;
        this.aiming = false;
        this.firing = false;
        return true;
    }

    tryJump() {
        if (!RaidRules.canAct(this) || RaidRules.busy(this)) return;
        if (!this.jumpGround) return;            // already airborne
        if (this.aiming) return;                 // no jump while ADS
        if (this.posture === 'prone') {
            this.posture = 'stand';
            return;
        }
        if (this.encumbrance?.jumpBlocked) return;
        const cost = typeof GAME_JUMP_STAMINA_COST !== 'undefined' ? GAME_JUMP_STAMINA_COST : 15;
        if (this.stamina) {
            if (this.stamina.value < cost) return;
            this.stamina.value = Math.max(0, this.stamina.value - cost);
        }
        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.foley?.playJumpLaunch) {
            ProceduralAudio.foley.playJumpLaunch({ sprint: this.weapon?.sprinting });
        }
        this.jumpVelocity = typeof GAME_JUMP_IMPULSE !== 'undefined' ? GAME_JUMP_IMPULSE : 240;
        this.jumpGround = false;
        this.jumpOffset = 0.1;
        if (this.player) this.player.jumpOffset = 0.1;
    }

    updateJump(dt) {
        if (this.jumpGround && this.jumpOffset <= 0) return;
        const gravity = typeof GAME_JUMP_GRAVITY !== 'undefined' ? GAME_JUMP_GRAVITY : 680;
        this.jumpVelocity -= gravity * dt;
        this.jumpOffset += this.jumpVelocity * dt;
        if (this.jumpOffset <= 0) {
            // Landed
            const landingSpeed = Math.abs(this.jumpVelocity);
            this.jumpOffset = 0;
            this.jumpVelocity = 0;
            this.jumpGround = true;

            let surface = 'dirt';
            if (this.coverBlockers) {
                for (const b of this.coverBlockers) {
                    const dx = this.player.x - b.x;
                    const dy = this.player.y - b.y;
                    if (dx * dx + dy * dy <= (b.radius + 28) * (b.radius + 28)) {
                        surface = 'metal';
                        break;
                    }
                }
            }

            if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.foley?.playJumpLand) {
                ProceduralAudio.foley.playJumpLand(surface, {
                    velocity: Math.min(1.0, landingSpeed / 350),
                    heavy: landingSpeed > 400
                });
            }

            const thudIntensity = Math.min(0.02, 0.003 + landingSpeed * 0.00003);
            if (this.app?.camera?.shake) this.app.camera.shake(80, thudIntensity);

            const safeSpeed = typeof GAME_FALL_SAFE_SPEED !== 'undefined' ? GAME_FALL_SAFE_SPEED : 420;
            if (landingSpeed > safeSpeed) {
                const dmgFactor = typeof GAME_FALL_DAMAGE_FACTOR !== 'undefined' ? GAME_FALL_DAMAGE_FACTOR : 0.28;
                const fallDmg = Math.round((landingSpeed - safeSpeed) * dmgFactor);
                if (fallDmg > 0) {
                    this.applyPlayerDamage(fallDmg, { x: this.player.x, y: this.player.y });
                    this.lootFeedText = this.lang === 'ru' ? `УРОН ОТ ПАДЕНИЯ: -${fallDmg} HP` : `FALL DAMAGE: -${fallDmg} HP`;
                    this.lootFeedTimer = 2.0;
                }
            }
        }
        if (this.player) this.player.jumpOffset = this.jumpOffset;
    }

    throwGrenade() {
        if (!RaidRules.canAct(this) || RaidRules.busy(this) || this.grenadeCooldown > 0) return;
        // Grenades are a finite resource. Without this counter the only limit was the 2.5 s
        // cooldown, so EMP grenades could be thrown forever and the gadget never entered the
        // loadout maths at all.
        const available = this.grenadesLeft != null
            ? this.grenadesLeft
            : (this.grenadeCapacity != null ? this.grenadeCapacity : 0);
        if (available <= 0) {
            this.lootFeedText = this.text('ГРАНАТ НЕТ', 'NO GRENADES');
            this.lootFeedTimer = 1.6;
            return;
        }
        this.grenadesLeft = available - 1;
        this.grenadeCooldown = 2.5;

        const fwd = this.app?.camera?.forward3D ? this.app.camera.forward3D() : {
            x: Math.cos(this.app?.camera?.azimuth || 0),
            y: Math.sin(this.app?.camera?.azimuth || 0),
            h: -Math.sin(this.app?.camera?.pitch || 0),
        };
        const eyeH = (this.app?.location?.terrain ? this.app.location.terrain.heightAt(this.player.x, this.player.y) : 0) + (this.player.eyeHeight || 62);
        const start = {
            x: this.player.x + fwd.x * 20,
            y: this.player.y + fwd.y * 20,
            h: eyeH + fwd.h * 20
        };

        const throwSpeed = 680;
        const vx = fwd.x * throwSpeed;
        const vy = fwd.y * throwSpeed;
        const vh = fwd.h * throwSpeed + 160;

        let mesh = null;
        if (this.scene) {
            mesh = BABYLON.MeshBuilder.CreateSphere('emp-grenade-' + performance.now(), { diameter: 7, segments: 8 }, this.scene);
            const mat = this.material('emp-grenade-mat', 0x35d6c6, 0.85);
            mesh.material = mat;
            mesh.position.set(start.x, start.h, start.y);
        }

        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.foley?.playJumpLaunch) {
            ProceduralAudio.foley.playJumpLaunch({ sprint: false });
        }

        this.lootFeedText = this.lang === 'ru' ? 'БРОШЕНА ЭМИ-ГРАНАТА!' : 'EMP GRENADE THROWN!';
        this.lootFeedTimer = 2.0;

        this.grenades = this.grenades || [];
        this.grenades.push({
            x: start.x, y: start.y, h: start.h,
            vx, vy, vh,
            mesh,
            fuse: 1.8,
            exploded: false
        });
    }

    explodeGrenade(g) {
        if (g.exploded) return;
        g.exploded = true;
        if (g.mesh) g.mesh.dispose();

        const blastRadius = 240;
        const blastDamage = 85;

        if (this.scene) {
            const sphere = BABYLON.MeshBuilder.CreateSphere('emp-blast', { diameter: 14, segments: 10 }, this.scene);
            const mat = this.material('emp-blast-mat', 0x22eeff, 0.9);
            mat.wireframe = true;
            sphere.material = mat;
            sphere.position.set(g.x, g.h + 10, g.y);
            this.effects.push({
                mesh: sphere,
                life: 0.45,
                totalLife: 0.45,
                update: (fxDt, rem, tot) => {
                    const scale = 1 + (1 - rem / tot) * 28;
                    sphere.scaling.set(scale, scale, scale);
                }
            });

            for (let i = 0; i < 16; i++) {
                const angle = (i / 16) * Math.PI * 2;
                const dist = 60 + Math.random() * 80;
                const spark = BABYLON.MeshBuilder.CreateLines('emp-spark', {
                    points: [
                        new BABYLON.Vector3(g.x, g.h + 12, g.y),
                        new BABYLON.Vector3(g.x + Math.cos(angle) * dist, g.h + 5 + Math.random() * 30, g.y + Math.sin(angle) * dist)
                    ]
                }, this.scene);
                spark.color = new BABYLON.Color3(0.2, 0.9, 1.0);
                this.effects.push({ mesh: spark, life: 0.35 });
            }
        }

        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc?.playDroneExplosion) {
            ProceduralAudio.arc.playDroneExplosion({ x: g.x, y: g.y });
        } else if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat?.playShieldBreak) {
            ProceduralAudio.combat.playShieldBreak();
        }

        if (this.app?.camera?.shake) {
            const distToPlayer = Math.hypot(this.player.x - g.x, this.player.y - g.y);
            if (distToPlayer < 600) {
                this.app.camera.shake(180, Math.min(0.025, 0.005 + (1 - distToPlayer / 600) * 0.02));
            }
        }

        for (const enemy of this.enemies) {
            if (enemy.dead || enemy.dormant) continue;
            const edx = enemy.x - g.x;
            const edy = enemy.y - g.y;
            const edist = Math.hypot(edx, edy);
            if (edist <= blastRadius) {
                if (enemy.shield) enemy.shield = 0;
                enemy.hp = Math.max(0, enemy.hp - blastDamage);
                enemy.hitFlash = 0.5;
                // A blinded sensor, not a lobotomy: this was a boolean set to true and never
                // cleared, so one EMP blast left every machine that survived it unable to
                // notice the player for the rest of the raid.
                enemy.suppressed = 3.5;
                enemy.alert = 0;
                enemy.cooldown = Math.max(enemy.cooldown, 3.5);
                if (enemy.hp <= 0) {
                    this.killEnemy(enemy);
                }
            }
        }
    }

    updateGrenades(dt) {
        if (!this.grenades || this.grenades.length === 0) return;
        const gravity = 750;
        for (let i = this.grenades.length - 1; i >= 0; i--) {
            const g = this.grenades[i];
            g.fuse -= dt;
            if (g.fuse <= 0) {
                this.explodeGrenade(g);
                this.grenades.splice(i, 1);
                continue;
            }

            g.vh -= gravity * dt;
            g.x += g.vx * dt;
            g.y += g.vy * dt;
            g.h += g.vh * dt;

            const terrH = this.app?.location?.terrain ? this.app.location.terrain.heightAt(g.x, g.y) : 0;
            if (g.h <= terrH + 3) {
                g.h = terrH + 3;
                g.vh = -g.vh * 0.45;
                g.vx *= 0.65;
                g.vy *= 0.65;
            }

            if (this.blockers) {
                for (const b of this.blockers) {
                    const dx = g.x - b.x, dy = g.y - b.y;
                    const dist = Math.hypot(dx, dy);
                    const rad = (b.radius || 24) + 6;
                    if (dist < rad && dist > 0.001) {
                        const nx = dx / dist, ny = dy / dist;
                        g.x = b.x + nx * rad;
                        g.y = b.y + ny * rad;
                        const dot = g.vx * nx + g.vy * ny;
                        if (dot < 0) {
                            g.vx = (g.vx - 2 * dot * nx) * 0.55;
                            g.vy = (g.vy - 2 * dot * ny) * 0.55;
                        }
                    }
                }
            }

            if (g.mesh) {
                g.mesh.position.set(g.x, g.h, g.y);
            }
        }
    }

    meleeAttack() {
        if (!RaidRules.canAct(this) || RaidRules.busy(this) || this.meleeCooldown > 0) return;
        this.meleeCooldown = 0.65;

        if (this.weapon) {
            this.weapon.recoil = 2.2;
            this.weapon.recoilRotX = 0.35;
            this.weapon.recoilRotZ = 0.18;
        }

        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.foley?.playJumpLaunch) {
            ProceduralAudio.foley.playJumpLaunch({ sprint: false });
        }

        if (this.app?.camera?.applyRecoil) {
            this.app.camera.applyRecoil(0.035, -0.012);
        }
        if (this.app?.camera?.shake) {
            this.app.camera.shake(60, 0.006);
        }

        const fwdAz = this.app?.camera?.azimuth || 0;
        const fwdVec = { x: Math.cos(fwdAz), y: Math.sin(fwdAz) };
        const reach = 80;
        const meleeDamage = 65;
        let hitAny = false;

        for (const enemy of this.enemies) {
            if (enemy.dead || enemy.dormant) continue;
            const dx = enemy.x - this.player.x;
            const dy = enemy.y - this.player.y;
            const dist = Math.hypot(dx, dy);
            // Cover stops a swing, exactly as it stops a bullet or a search. Without this the
            // melee sweep was the one reach-based verb that ignored obstacles.
            if (dist <= reach + enemy.radius && ShooterRules.hasLineOfSight(this.player, enemy, this.coverBlockers)) {
                const dirToEnemy = ShooterRules.normalize(dx, dy);
                const dot = fwdVec.x * dirToEnemy.x + fwdVec.y * dirToEnemy.y;
                if (dot > 0.45) {
                    hitAny = true;
                    enemy.hp = Math.max(0, enemy.hp - meleeDamage);
                    enemy.hitFlash = 0.35;
                    enemy.cooldown = Math.max(enemy.cooldown, 0.85);

                    if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat?.playImpact) {
                        ProceduralAudio.combat.playImpact('metal', { x: enemy.x, y: enemy.y, h: (enemy.h || 0) + 30 });
                    }

                    if (this.scene) {
                        const h = (enemy.h != null ? enemy.h : 0) + 35;
                        for (let i = 0; i < 8; i++) {
                            const angle = Math.random() * Math.PI * 2;
                            const spark = BABYLON.MeshBuilder.CreateLines('melee-spark', {
                                points: [
                                    new BABYLON.Vector3(enemy.x, h, enemy.y),
                                    new BABYLON.Vector3(enemy.x + Math.cos(angle) * 18, h + (Math.random() - 0.5) * 20, enemy.y + Math.sin(angle) * 18)
                                ]
                            }, this.scene);
                            spark.color = new BABYLON.Color3(1, 0.8, 0.2);
                            this.effects.push({ mesh: spark, life: 0.15 });
                        }
                    }

                    if (enemy.hp <= 0) {
                        this.killEnemy(enemy);
                    }
                }
            }
        }

        if (hitAny) {
            this.hitMarker = 0.22;
        }
    }

    onMouseMove(e) {
        if (document.pointerLockElement !== this.canvas || this.phase !== 'raid') return;
        this.app.camera.lookDelta((e.movementX || 0) * this.settings.sensitivity, (e.movementY || 0) * this.settings.sensitivity);
        this.app.camera.pitch = ShooterRules.clamp(this.app.camera.pitch, -75 * Math.PI / 180, 78 * Math.PI / 180);
    }

    onTouchStart(e) {
        if (!IS_MOBILE || !e.changedTouches.length) return;
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.clientX < window.innerWidth * 0.45) {
                this.touchMove = { x: touch.clientX, y: touch.clientY, id: touch.identifier, startX: touch.clientX, startY: touch.clientY };
            } else if (this.touchLookId == null) {
                this.touchLookId = touch.identifier;
                this.touchLook = { x: touch.clientX, y: touch.clientY };
            }
        }
    }

    onTouchMove(e) {
        if (!IS_MOBILE) return;
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (this.touchMove.id === touch.identifier) { this.touchMove.x = touch.clientX; this.touchMove.y = touch.clientY; }
            if (this.touchLookId === touch.identifier && this.touchLook) {
                this.app.camera.lookDelta((touch.clientX - this.touchLook.x) * 0.7, (touch.clientY - this.touchLook.y) * 0.7);
                this.touchLook.x = touch.clientX; this.touchLook.y = touch.clientY;
            }
        }
    }

    onTouchEnd(e) {
        if (!IS_MOBILE) return;
        for (const touch of e.changedTouches) {
            if (this.touchMove.id === touch.identifier) this.touchMove = { x: 0, y: 0 };
            if (this.touchLookId === touch.identifier) { this.touchLookId = null; this.touchLook = null; }
        }
    }

    onMouseDown(e) {
        if (this.phase !== 'raid') return;
        if (this.tacticalMap?.visible || this.raidInventory?.visible || (typeof ControlsMenu !== 'undefined' && ControlsMenu.isOpen())) return;
        if (typeof OnlineBridge !== 'undefined' && OnlineBridge.spectating) {
            if (e.button === 0) {
                const next = OnlineBridge.cycleSpectateTarget(1);
                if (next && this.app?.camera) {
                    this.app.camera.follow(next);
                    if (typeof next.heading === 'number') this.app.camera.azimuth = next.heading;
                    this.app.camera.pitch = 20 * Math.PI / 180;
                }
            } else if (e.button === 2) {
                const prev = OnlineBridge.cycleSpectateTarget(-1);
                if (prev && this.app?.camera) {
                    this.app.camera.follow(prev);
                    if (typeof prev.heading === 'number') this.app.camera.azimuth = prev.heading;
                    this.app.camera.pitch = 20 * Math.PI / 180;
                }
            }
            return;
        }
        if (e.button === 2) { this.aiming = true; return; }
        if (e.button !== 0) return;
        if (document.pointerLockElement !== this.canvas && this.canvas?.requestPointerLock) {
            const locking = this.canvas.requestPointerLock();
            if (locking && locking.catch) locking.catch(() => this.app?.camera?.setPointerEnabled(true));
        }
        this.firing = true;
        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.ambience) {
            ProceduralAudio.ambience.start();
        } else if (this.audio?.ambience?.paused) {
            this.playSound(this.audio.ambience, 0.08);
        }
        this.fire();
    }

    fire() {
        if (!RaidRules.canAct(this) || RaidRules.busy(this) || this.fireCooldown > 0) return;
        if (this.ammo <= 0) {
            if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
                ProceduralAudio.combat.playDryFire();
            }
            if (this.reserveAmmo > 0) this.startReload();
            return;
        }

        // Weapon Archetype & Effective Stats
        const loadoutPrimary = (typeof MenuSystem !== 'undefined' && MenuSystem.loadout?.primary) ? MenuSystem.loadout.primary : null;
        const stats = (loadoutPrimary && typeof RaidRules !== 'undefined' && RaidRules.getWeaponEffectiveStats) ? RaidRules.getWeaponEffectiveStats(loadoutPrimary) : null;
        const weaponName = (loadoutPrimary && loadoutPrimary.name) ? loadoutPrimary.name : 'TEMPEST II';
        const isShotgun = weaponName.includes('VULCANO') || weaponName.includes('SHOTGUN');
        const isRevolver = weaponName.includes('REVOLVER');
        const isSniper = weaponName.includes('SNIPER') || weaponName.includes('R-45') || weaponName.includes('PRECISION');
        const isSMG = weaponName.includes('RATTLER') || weaponName.includes('SMG');
        const archetype = stats?.archetype || (isShotgun ? 'shotgun' : isRevolver ? 'revolver' : isSniper ? 'sniper' : isSMG ? 'smg' : 'assault_rifle');
        const fireMode = stats?.fireMode || (archetype === 'assault_rifle' || archetype === 'smg' ? 'auto' : 'semi');

        // Semi-auto trigger latch: single shot per mouse click
        if (fireMode === 'semi' && this._semiFired) {
            return;
        }
        if (fireMode === 'semi') {
            this._semiFired = true;
        }

        const isDirect = (typeof window !== 'undefined' && window.location?.search?.includes('directPlay')) || this.infiniteAmmo;
        if (!isDirect) {
            this.ammo--;
        } else {
            this.reserveAmmo = 9999;
        }
        this.shots++;

        // Fire rate & cadence
        const fireRate = stats?.fireRate || (isShotgun ? 115 : isRevolver ? 170 : 600);
        const fireInterval = (typeof ShooterRules !== 'undefined' && ShooterRules.calculateFireInterval)
            ? ShooterRules.calculateFireInterval(fireRate)
            : (60 / fireRate);
        this.fireCooldown = fireInterval;

        // Posture modifiers
        const postureMods = (typeof RaidRules !== 'undefined' && RaidRules.getPostureModifiers)
            ? RaidRules.getPostureModifiers(this.posture)
            : { speedMult: 1, noiseMult: 1, eyeHeight: 64, recoilMult: 1, spreadMult: 1 };

        const noiseMult = (stats ? stats.noiseMult : 1.0) * (postureMods.noiseMult || 1.0);
        this.emitNoise(this.mechanics.shotNoise * noiseMult);

        const pelletCount = isShotgun ? 8 : 1;
        const baseDamage = stats ? stats.damage : (loadoutPrimary ? loadoutPrimary.damage : this.c.damage);
        const damagePerPellet = isShotgun ? Math.max(12, Math.round(baseDamage / 5.5)) : baseDamage;
        const muzzleSpeed = isShotgun ? 4200 : isRevolver ? 4800 : 5400;
        const moving = this.weapon ? this.weapon.moving : false;
        const sprinting = this.weapon ? this.weapon.sprinting : false;

        const baseRecoilMult = (stats ? stats.recoilMult : 1.0) * (postureMods.recoilMult || 1.0);

        // First-shot reset check
        const isFirst = (typeof ShooterRules !== 'undefined' && ShooterRules.isFirstShot)
            ? ShooterRules.isFirstShot(this.timeSinceLastShot, 0.32)
            : (this.burstCount === 0);

        if (isFirst) {
            this.burstCount = 0;
            this.weaponSpreadBloom = 0;
        }
        this.timeSinceLastShot = 0;

        // Recoil pattern per archetype
        const pattern = (typeof ShooterRules !== 'undefined' && ShooterRules.getRecoilPattern)
            ? ShooterRules.getRecoilPattern(archetype, this.burstCount, baseRecoilMult)
            : { pitchKick: 0.024 * baseRecoilMult, yawKick: 0.004 * baseRecoilMult, bloomIncrease: 0.015 * baseRecoilMult, viewmodelKick: 0.9 * baseRecoilMult };

        this.burstCount = (this.burstCount || 0) + 1;
        this.weaponSpreadBloom = Math.min(0.09, (this.weaponSpreadBloom || 0) + pattern.bloomIncrease);

        const baseSpreadDeg = (isShotgun ? 3.8 : isRevolver ? 0.8 : this.c.spreadDeg) *
            (this.aiming ? 0.28 : 1) * (sprinting ? 2.8 : moving ? 1.6 : 1) * (postureMods.spreadMult || 1.0) * (stats ? stats.recoilMult : 1.0);

        const kickPitch = pattern.pitchKick * (this.aiming ? 0.55 : 1);
        const kickYaw = pattern.yawKick * (this.aiming ? 0.5 : 1);

        // True 3D camera position and look direction in world coordinates
        const cam = this.app?.location?.view?.camera;
        const camPos = cam ? {
            x: cam.position.x,
            y: cam.position.z, // Babylon Z is world Y
            h: cam.position.y  // Babylon Y is world H
        } : {
            x: this.player.x,
            y: this.player.y,
            h: (this.app?.location?.terrain ? this.app.location.terrain.heightAt(this.player.x, this.player.y) : 0) + (this.player.eyeHeight || 62) + (this.player.jumpOffset || 0)
        };

        // Complete 3D camera basis (Forward, Right, Up) in world space
        let fwd, camRight, camUp;
        if (cam && typeof cam.getDirection === 'function') {
            const isRH = !!(this.scene?.useRightHandedSystem || (typeof cam.getScene === 'function' && cam.getScene()?.useRightHandedSystem));
            const fwdB = cam.getDirection(BABYLON.Vector3.Forward(isRH));
            const rightB = cam.getDirection(BABYLON.Vector3.Right());
            const upB = cam.getDirection(BABYLON.Vector3.Up());
            fwd = { x: fwdB.x, y: fwdB.z, h: fwdB.y };
            camRight = { x: rightB.x, y: rightB.z, h: rightB.y };
            camUp = { x: upB.x, y: upB.z, h: upB.y };
        } else {
            const camAz = this.app?.camera?.azimuth || 0;
            const camPi = this.app?.camera?.pitch || 0;
            const leanRoll = this.player?.leanRoll || 0;
            const cp = Math.cos(camPi), sp = Math.sin(camPi);
            const ca = Math.cos(camAz), sa = Math.sin(camAz);
            fwd = { x: ca * cp, y: sa * cp, h: -sp };
            const rX = -sa, rY = ca, rH = 0;
            const uX = -ca * sp, uY = -sa * sp, uH = -cp;
            const cR = Math.cos(leanRoll), sR = Math.sin(leanRoll);
            camRight = { x: rX * cR + uX * sR, y: rY * cR + uY * sR, h: rH * cR + uH * sR };
            camUp = { x: -rX * sR + uX * cR, y: -rY * sR + uY * cR, h: -rH * sR + uH * cR };
        }

        // Real world muzzle origin in front of camera:
        // When ADS (aiming), barrel is aligned with camera sight axis (rightOffset = 0).
        // When hip firing, weapon is held to the right (+10px) and slightly lower (-6px).
        const forwardOffset = 22;
        const rightOffset = this.aiming ? 0 : 10;
        const upOffset = this.aiming ? -2 : -6;
        const muzzle = {
            x: camPos.x + fwd.x * forwardOffset + camRight.x * rightOffset + camUp.x * upOffset,
            y: camPos.y + fwd.y * forwardOffset + camRight.y * rightOffset + camUp.y * upOffset,
            h: camPos.h + fwd.h * forwardOffset + camRight.h * rightOffset + camUp.h * upOffset,
        };

        // Determine focal point: raycast from camera center into world
        const maxRange = 1600;
        let focalPoint = {
            x: camPos.x + fwd.x * maxRange,
            y: camPos.y + fwd.y * maxRange,
            h: camPos.h + fwd.h * maxRange,
        };
        let focalDist = maxRange;

        const livingEnemies = this.enemies ? this.enemies.filter(e => !e.dead && !e.dormant) : [];
        const activeHazards = this.hazards ? this.hazards.filter(h => !h.destroyed) : [];
        const rangeActors = (this.tacticalRange && this.tacticalRange.active && this.tacticalRange.getTargetActors)
            ? this.tacticalRange.getTargetActors()
            : [];
        const rangeBlockers = (this.tacticalRange && this.tacticalRange.active && this.tacticalRange.getCoverBlockers)
            ? this.tacticalRange.getCoverBlockers()
            : [];
        const allTargets = livingEnemies.concat(activeHazards, rangeActors);
        const allBlockers = (this.coverBlockers || []).concat(rangeBlockers);
        const terrainFn = (x, y) => this.app?.location?.terrain ? this.app.location.terrain.heightAt(x, y) : 0;

        if (typeof ShooterRules !== 'undefined' && ShooterRules.raycastHitscan) {
            // Ignore near-clipping obstacles, player body, and prompts (minDistance: 75)
            const crosshairTrace = ShooterRules.raycastHitscan(
                camPos, fwd, maxRange,
                allTargets,
                allBlockers,
                terrainFn,
                { minDistance: 75, shooterId: 'player' }
            );
            if (crosshairTrace.hit && crosshairTrace.distance >= 75 && crosshairTrace.point) {
                focalPoint = crosshairTrace.point;
                focalDist = crosshairTrace.distance;
            }
        }

        this.player.heading = Math.atan2(fwd.y, fwd.x);

        for (let i = 0; i < pelletCount; i++) {
            // Screen-space spread in camera local coordinates:
            const spreadRad = (baseSpreadDeg * Math.PI / 180) + this.weaponSpreadBloom;
            const spreadX = ShooterRules.shotSpread(this.seed, 'sx_' + i, this.shotSerial, spreadRad);
            const spreadY = ShooterRules.shotSpread(this.seed, 'sy_' + i, this.shotSerial, spreadRad * 0.75);

            // Perturb target point on the screen focal plane:
            const targetX = focalPoint.x + (camRight.x * spreadX + camUp.x * spreadY) * focalDist;
            const targetY = focalPoint.y + (camRight.y * spreadX + camUp.y * spreadY) * focalDist;
            const targetH = focalPoint.h + (camRight.h * spreadX + camUp.h * spreadY) * focalDist;

            // Direct ballistic impulse vector from muzzle to perturbed target:
            const dirX = targetX - muzzle.x;
            const dirY = targetY - muzzle.y;
            const dirH = targetH - muzzle.h;
            const dirLen = Math.hypot(dirX, dirY, dirH);
            const invLen = dirLen > 1e-6 ? 1 / dirLen : 1;

            const vx = dirX * invLen * muzzleSpeed;
            const vy = dirY * invLen * muzzleSpeed;
            const vh = dirH * invLen * muzzleSpeed;

            const proj = ShooterRules.createProjectile({
                id: 'p_' + this.shots + '_' + i,
                shooterId: 'player',
                x: muzzle.x,
                y: muzzle.y,
                h: muzzle.h,
                vx, vy, vh,
                damage: damagePerPellet,
                speed: muzzleSpeed,
                gravity: isShotgun ? 1400 : 980,
                drag: 0.035,
                maxRange: isShotgun ? 950 : 1600,
                falloffNear: (stats?.range || 75) * 15,
                falloffFar: (stats?.range || 75) * 25,
                minDamage: damagePerPellet * 0.45,
                headshotMultiplier: 1.85,
            });

            this.spawnTracer(proj, false);
        }
        this.shotSerial++;

        if (this.app?.camera?.applyRecoil) {
            this.app.camera.applyRecoil(kickPitch, kickYaw);
        }
        if (this.app?.camera?.shake) {
            this.app.camera.shake(90, isShotgun ? 0.008 : isRevolver ? 0.006 : 0.004);
        }

        if (this.weapon) {
            this.weapon.recoil = Math.min(2.5, (this.weapon.recoil || 0) + pattern.viewmodelKick);
            this.weapon.recoilRotX = Math.min(0.28, (this.weapon.recoilRotX || 0) + pattern.viewmodelKick * 0.08);
            this.weapon.recoilRotZ = (this.shots % 2 ? 1 : -1) * 0.015 * baseRecoilMult;
            const showFlash = stats ? stats.muzzleFlash : true;
            if (showFlash) {
                this.weapon.flashLife = 0.045;
                if (this.weapon.flash) {
                    this.weapon.flash.setEnabled(true);
                    this.weapon.flash.rotation.z = (this.ammo * 1.71) % Math.PI;
                }
                if (this.muzzleLight) {
                    this.muzzleLight.intensity = 2.5;
                    this.muzzleLight.position.set(muzzle.x, muzzle.h, muzzle.y);
                    this.muzzleLightLife = 0.045;
                }
            } else {
                this.weapon.flashLife = 0;
                if (this.weapon.flash) this.weapon.flash.setEnabled(false);
                if (this.muzzleLight) this.muzzleLight.intensity = 0;
            }

            // Eject spent brass casing
            if (this.scene && this.brassMat) {
                const casing = BABYLON.MeshBuilder.CreateCylinder('casing-' + this.shots, {
                    height: 0.045, diameter: 0.012, tessellation: 8
                }, this.scene);
                casing.parent = this.weapon.root;
                casing.position.set(0.12, 0.02, -0.38);
                casing.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                casing.material = this.brassMat;
                casing.renderingGroupId = 3;
                casing.isPickable = false;
                casing.alwaysSelectAsActiveMesh = true;
                this.casings = this.casings || [];
                this.casings.push({
                    mesh: casing,
                    vx: 0.04 + Math.random() * 0.03,
                    vy: 0.035 + Math.random() * 0.025,
                    vz: -0.015 - Math.random() * 0.02,
                    rx: 15 + Math.random() * 10,
                    ry: 12 + Math.random() * 10,
                    rz: 10 + Math.random() * 10,
                    life: 0.65
                });
                if (this.casings.length > 12) {
                    const old = this.casings.shift();
                    if (old && old.mesh) old.mesh.dispose();
                }
            }
        }

        const caliber = (loadoutPrimary && loadoutPrimary.caliber) ? loadoutPrimary.caliber
            : (isShotgun ? 'shotgun_shell' : isRevolver ? 'heavy_kinetic' : 'heavy_kinetic');

        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.weapon) {
            const tier = (loadoutPrimary && loadoutPrimary.tier) ? loadoutPrimary.tier : 2;
            ProceduralAudio.weapon.play(caliber, { x: this.player.x, y: this.player.y }, true, tier);
        } else if (this.audio) {
            const sound = isShotgun ? this.audio.rifle[0] : isRevolver ? this.audio.rifle[1] : (this.pickSound ? this.pickSound(this.audio.rifle, 'rifle') : this.audio.rifle[this._audioIndex++ % this.audio.rifle.length]);
            this.playSound(sound, isShotgun ? 0.42 : isRevolver ? 0.38 : 0.32, 0.06);
        }

        if (this.ammo <= 0) this.startReload();
    }

    spawnTracer(proj, hostile) {
        if (!this.scene) return;
        const mesh = BABYLON.MeshBuilder.CreateCylinder('tracer-' + proj.id, {
            height: hostile ? 20 : 28,
            diameter: hostile ? 2.0 : 1.6,
            tessellation: 8,
        }, this.scene);
        const mat = hostile ? (this.tracerMatHostile || this.material('tracer-mat-h', 0xff4422)) : (this.tracerMatFriendly || this.material('tracer-mat-f', 0xffcc33));
        mesh.material = mat;
        mesh.isPickable = false;
        mesh.position.set(proj.x, proj.h, proj.y);

        // Align cylinder's length (Axis.Y) with 3D velocity vector via quaternion
        const velB = new BABYLON.Vector3(proj.vx, proj.vh, proj.vy);
        const spd = velB.length();
        if (spd > 1e-6) {
            velB.scaleInPlace(1 / spd);
            mesh.rotationQuaternion = new BABYLON.Quaternion();
            BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Axis.Y, velB, mesh.rotationQuaternion);
        }

        // The trail must be created AFTER the mesh has a valid world matrix. TrailMesh
        // samples its generator's transform on construction; with a stale matrix the first
        // ribbon section was written at the mesh's PREVIOUS position — the world origin for a
        // fresh mesh — so every tracer appeared to stream in from (0,0) instead of the muzzle.
        mesh.computeWorldMatrix(true);

        let trail = null;
        if (typeof BABYLON.TrailMesh !== 'undefined') {
            try {
                trail = new BABYLON.TrailMesh('trail-' + proj.id, mesh, this.scene, hostile ? 1.4 : 1.8, 12, false);
                trail.material = mat;
                trail.isPickable = false;
                // Seed the ribbon at the muzzle so the first section does not stretch from
                // wherever the mesh happened to be created.
                trail.start();
            } catch (err) {
                trail = null;
            }
        }

        this.activeProjectiles = this.activeProjectiles || [];
        this.activeProjectiles.push({ proj, mesh, trail, hostile: !!hostile });
    }

    killEnemy(enemy) {
        if (enemy.dead) return;
        enemy.dead = true;
        BotRig3D.update(enemy, 0);
        this.kills++;

        // Natural mechanical collapse
        if (enemy.legs) {
            for (const l of enemy.legs) {
                l.leg.rotation.x = -1.0;
                l.foot.rotation.x = -0.5;
            }
        }
        if (enemy.arms) {
            for (const a of enemy.arms) {
                a.arm.rotation.x = 0.8;
                a.arm.rotation.z = a.side * 0.45;
            }
        }
        if (enemy.torso) {
            enemy.torso.position.y = 26;
            enemy.torso.rotation.x = 0.55;
            enemy.torso.rotation.z = 0.25;
        }
        if (enemy.head) {
            enemy.head.position.y = 44;
            enemy.head.rotation.x = 0.7;
        }
        if (enemy.weapon) {
            enemy.weapon.position.y = 18;
            enemy.weapon.rotation.set(0.9, 0.4, 0.6);
        }
        if (enemy.visual) {
            enemy.visual.rotation.x = 0.25;
            enemy.visual.position.y -= 4;
        }

        this.sessionKills = this.sessionKills || { spotter: 0, sentinel: 0, turret: 0, cricket: 0, screamer: 0, total: 0 };
        if (enemy.archetype) {
            this.sessionKills[enemy.archetype] = (this.sessionKills[enemy.archetype] || 0) + 1;
        }
        this.sessionKills.total = (this.sessionKills.total || 0) + 1;

        if (enemy.archetype === 'spotter') {
            if (enemy.searchlightCone) enemy.searchlightCone.setEnabled(false);
            if (enemy.visual) {
                const groundH = this.app?.location?.terrain ? this.app.location.terrain.heightAt(enemy.x, enemy.y) : 0;
                enemy.h = groundH + 6;
                enemy.visual.position.set(enemy.x, enemy.h, enemy.y);
                enemy.visual.rotation.set(0.6, 0.4, 0.9);
            }
        }

        if (this.scene) {
            const h = (this.app?.location?.terrain ? this.app.location.terrain.heightAt(enemy.x, enemy.y) : 0) + 35;
            for (let i = 0; i < 12; i++) {
                const angle = i * 0.52 + Math.random() * 0.3;
                const dist = 20 + Math.random() * 30;
                const spark = BABYLON.MeshBuilder.CreateLines('death-spark', { points: [
                    new BABYLON.Vector3(enemy.x, h, enemy.y),
                    new BABYLON.Vector3(enemy.x + Math.cos(angle) * dist, h - 8 + Math.random() * 26, enemy.y + Math.sin(angle) * dist),
                ] }, this.scene);
                spark.color = new BABYLON.Color3(1, 0.4 + (i % 3) * 0.2, 0.05);
                this.effects.push({ mesh: spark, life: 0.22 + (i % 4) * 0.04 });
            }
        }
        let lootItem = null;
        if (enemy.archetype === 'spotter' || enemy.archetype === 'stalker') {
            lootItem = { id: 'arc_sensor', type: 'sensor', label: ['Сенсор дрона ARC', 'ARC Sensor'], value: 1400, weight: 1.2 };
        } else if (enemy.archetype === 'sentinel' || enemy.archetype === 'bombard') {
            lootItem = { id: 'arc_power_core', type: 'core', label: ['Энергоядро ARC', 'ARC Power Core'], value: 850, weight: 3.5 };
        } else if (enemy.archetype === 'pop' || enemy.archetype === 'cricket') {
            lootItem = { id: 'arc_catalyst', type: 'explosive', label: ['Катализатор ARC', 'ARC Catalyst'], value: 280, weight: 0.8 };
        } else if (enemy.id % 2 === 0) {
            lootItem = { id: 'scrap', type: 'scrap', label: ['Детали робота', 'Robot parts'], value: 65, weight: 1.5 };
        }
        if (lootItem) {
            const mesh = BABYLON.MeshBuilder.CreateBox('enemy-drop-' + enemy.id, { size: 18 }, this.scene);
            const dropColor = (enemy.archetype === 'sentinel' || enemy.archetype === 'bombard') ? 0xffaa00 : (enemy.archetype === 'spotter' || enemy.archetype === 'stalker') ? 0x35d6c6 : (enemy.archetype === 'pop' || enemy.archetype === 'cricket') ? 0xff3333 : 0xe1b85c;
            const mat = this.material('enemy-drop-mat-' + enemy.id, dropColor, 0.55);
            this.addVisual(mesh, mat, 'actor', { castShadow: false, ink: false, outline: false });
            this.place(mesh, enemy.x, enemy.y, 22);
            this.containers.push({ id: 100 + enemy.id, x: enemy.x, y: enemy.y, radius: 42, opened: false,
                item: lootItem, visual: mesh });
        }
    }

    impactTerrain(point) {
        if (!this.scene) return;
        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
            ProceduralAudio.combat.playImpact('dirt', point);
        }
        const disc = BABYLON.MeshBuilder.CreateDisc('bullet-mark', { radius: 6, tessellation: 12, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, this.scene);
        disc.position.set(point.x, point.h + 0.5, point.y);
        disc.rotation.x = Math.PI / 2;
        disc.material = this.decalMat || this.material('bullet-mark-mat', 0x151718);
        disc.isPickable = false;
        this.decals = this.decals || [];
        this.decals.push(disc);
        if (this.decals.length > 24) {
            const old = this.decals.shift();
            if (old && old.dispose) old.dispose();
        }
        this.effects.push({ mesh: disc, life: 8 });

        for (let i = 0; i < 4; i++) {
            const angle = i * 1.57 + Math.random() * 0.4;
            const dist = 6 + Math.random() * 12;
            const line = BABYLON.MeshBuilder.CreateLines('dust-puff', { points: [
                new BABYLON.Vector3(point.x, point.h + 1, point.y),
                new BABYLON.Vector3(point.x + Math.cos(angle) * dist, point.h + 8 + Math.random() * 8, point.y + Math.sin(angle) * dist),
            ] }, this.scene);
            line.color = new BABYLON.Color3(0.65, 0.6, 0.5);
            line.alpha = 0.7;
            this.effects.push({ mesh: line, life: 0.18 });
        }
    }

    impactBlocker(point, normal) {
        if (!this.scene) return;
        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
            ProceduralAudio.combat.playImpact('metal', point);
        } else if (this.audio?.metal) {
            this.playSound(this.pickSound ? this.pickSound(this.audio.metal, 'metal') : this.audio.metal[this._audioIndex++ % this.audio.metal.length], 0.28, 0.08);
        }

        const disc = BABYLON.MeshBuilder.CreateDisc('metal-mark', { radius: 5, tessellation: 12, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, this.scene);
        const nx = normal ? normal.x : 0;
        const ny = normal ? normal.y : 0;
        disc.position.set(point.x + nx * 0.5, point.h, point.y + ny * 0.5);
        if (normal) {
            disc.lookAt(new BABYLON.Vector3(point.x + nx, point.h, point.y + ny));
        } else {
            disc.rotation.x = Math.PI / 2;
        }
        disc.material = this.decalMat || this.material('bullet-decal-mat', 0x121416);
        disc.isPickable = false;
        this.decals = this.decals || [];
        this.decals.push(disc);
        if (this.decals.length > 24) {
            const old = this.decals.shift();
            if (old && old.dispose) old.dispose();
        }
        this.effects.push({ mesh: disc, life: 8 });

        for (let i = 0; i < 6; i++) {
            const spark = BABYLON.MeshBuilder.CreateLines('metal-spark', { points: [
                new BABYLON.Vector3(point.x, point.h + 1, point.y),
                new BABYLON.Vector3(
                    point.x + (normal ? normal.x * 12 : 0) + (Math.random() - 0.5) * 16,
                    point.h + 5 + Math.random() * 14,
                    point.y + (normal ? normal.y * 12 : 0) + (Math.random() - 0.5) * 16
                ),
            ] }, this.scene);
            spark.color = new BABYLON.Color3(1, 0.75, 0.15);
            this.effects.push({ mesh: spark, life: 0.12 });
        }
    }

    impactHeadshot(point) {
        if (!this.scene) return;
        for (let i = 0; i < 8; i++) {
            const spark = BABYLON.MeshBuilder.CreateLines('crit-spark', { points: [
                new BABYLON.Vector3(point.x, point.h, point.y),
                new BABYLON.Vector3(point.x + (Math.random() - 0.5) * 28, point.h + 10 + Math.random() * 20, point.y + (Math.random() - 0.5) * 28),
            ] }, this.scene);
            spark.color = new BABYLON.Color3(1, 0.15, 0.05);
            this.effects.push({ mesh: spark, life: 0.22 });
        }
    }

    impactEffect(point, hostile) {
        this.impactTerrain(point);
    }

    tracer(a, b, hostile) {
        if (!this.scene) return;
        const h1 = this.app?.location?.terrain ? this.app.location.terrain.heightAt(a.x, a.y) + (hostile ? 45 : 58) : 58;
        const h2 = this.app?.location?.terrain ? this.app.location.terrain.heightAt(b.x, b.y) + (hostile ? 52 : 34) : 34;
        const mesh = BABYLON.MeshBuilder.CreateLines('tracer', { points: [new BABYLON.Vector3(a.x, h1, a.y), new BABYLON.Vector3(b.x, h2, b.y)] }, this.scene);
        mesh.color = hostile ? new BABYLON.Color3(1, 0.18, 0.08) : new BABYLON.Color3(1, 0.72, 0.28);
        mesh.alpha = 0.9;
        this.effects.push({ mesh, life: 0.055 });
        this.impactEffect(b, hostile);
    }

    updateMapLighting(dt) {
        const location = this.app?.location;
        if (!location?.view) return;
        const settings = this.level?.lighting;
        const authored = settings && Object.keys(settings).length > 0;
        let state;
        if (authored && !settings.cycleEnabled) {
            state = location.applyLightingSettings(settings);
        } else if (this.dayNightCycle) {
            const speed = authored ? Math.max(0, Number(settings.cycleSpeed) || 0) : 1;
            this.dayNightCycle.update(dt * speed);
            state = this.dayNightCycle.applyToScene(location.view);
        }
        if (state) this.environment?.syncSky(state.sunAz, state.nightFactor, state.sunEnabled !== false);
    }

    update(dt) {
        dt = Math.min(0.1, Math.max(0, dt || 0));
        if (typeof ArcPerformanceOverlay !== 'undefined' && ArcPerformanceOverlay.initialized) {
            ArcPerformanceOverlay.update(dt);
        }
        if (this.paused) { this.updateVisuals(0); this.updateHud(false); return; }

        this.updateMapLighting(dt);
        if (this.weatherSystem && typeof this.weatherSystem.update === 'function') {
            this.weatherSystem.update(dt);
        }

        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.updateListener && this.player) {
            const az = this.app?.camera?.azimuth || 0;
            ProceduralAudio.updateListener({
                x: this.player.x,
                y: this.app?.location?.terrain ? this.app.location.terrain.heightAt(this.player.x, this.player.y) : 0,
                z: this.player.y,
                forwardX: Math.cos(az),
                forwardY: 0,
                forwardZ: Math.sin(az)
            });
        }

        // Online: send intent and apply the authoritative snapshot before we simulate.
        // With no client attached this is a no-op and the game runs exactly as offline.
        if (typeof OnlineBridge !== 'undefined') OnlineBridge.update(dt);

        const isSpectating = typeof OnlineBridge !== 'undefined' && OnlineBridge.spectating;
        const isDowned = typeof OnlineBridge !== 'undefined' && OnlineBridge.downed;
        if (isSpectating) {
            const spectated = OnlineBridge.getSpectatedPeer();
            if (spectated) {
                if (this.app?.camera?.firstPersonObj) this.app.camera.setFirstPerson(null);
                if (this.app?.camera && this.app.camera.followObj !== spectated) {
                    this.app.camera.follow(spectated);
                    if (typeof spectated.heading === 'number') this.app.camera.azimuth = spectated.heading;
                    this.app.camera.pitch = 20 * Math.PI / 180;
                    if (this.app.camera.zoomTarget < 2.0) {
                        this.app.camera.zoomTarget = 2.4;
                        this.app.camera.zoom = 2.4;
                    }
                }
            }
            if (this.weapon && this.weapon.root) {
                this.weapon.root.setEnabled(false);
            }
        } else if (isDowned) {
            if (this.weapon && this.weapon.root) {
                this.weapon.root.setEnabled(false);
            }
            if (this.app?.camera?.firstPersonObj) {
                this.app.camera.firstPersonOffset = { x: 0, y: 0.25, z: 0 };
            }
        }

        this._simAccumulator = Math.min(0.1, this._simAccumulator + dt);
        let steps = 0;
        while (this._simAccumulator >= Game.SIM_DT && steps++ < 6) {
            this.simulate(Game.SIM_DT);
            this._simAccumulator -= Game.SIM_DT;
        }
        this.updateVisuals(dt);
        this._hudElapsed += dt;
        this.updateHud(false);
    }

    simulate(dt) {
        if (typeof OnlineBridge !== 'undefined' && (OnlineBridge.spectating || OnlineBridge.downed)) {
            this.firing = false;
            this.aiming = false;
            if (OnlineBridge.spectating) return;
        }
        if (!RaidRules.canAct(this)) return;
        this.time += this.phase === 'raid' ? dt : 0;
        this.fireCooldown = Math.max(0, this.fireCooldown - dt);
        this.timeSinceLastShot = (this.timeSinceLastShot || 0) + dt;
        if (typeof ShooterRules !== 'undefined' && ShooterRules.isFirstShot && ShooterRules.isFirstShot(this.timeSinceLastShot, 0.32)) {
            this.burstCount = 0;
        }
        if (this.weaponSpreadBloom > 0) {
            this.weaponSpreadBloom = Math.max(0, this.weaponSpreadBloom - 0.25 * dt);
        }
        if (this.grenadeCooldown > 0) this.grenadeCooldown = Math.max(0, this.grenadeCooldown - dt);
        if (this.meleeCooldown > 0) this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);

        // WEAPONS ARE SERVER-OWNED ONLINE. With the bridge active the server fires on its own
        // clock, spends its own ammo and reloads its own magazine; letting the local path run
        // as well double-spent every round (local fire + server fire + local reload), which is
        // how a full reserve disappeared during a single reload.
        const weaponsLocal = !(typeof OnlineBridge !== 'undefined' && OnlineBridge.active());
        if (weaponsLocal) {
            if (this.firing && this.phase === 'raid') this.fire();
            if (this.reloadTimer > 0) {
                this.reloadTimer -= dt;
                if (this.reloadTimer <= 0) {
                    const needed = this.c.mag - this.ammo;
                    const moved = Math.min(needed, this.reserveAmmo);
                    this.ammo += moved;
                    this.reserveAmmo -= moved;
                }
            }
        }
        if (this.searchTimer > 0) {
            const moving = RaidRules.movement(this.keys, this.touchMove).moving;
            if (moving || this.firing || !RaidRules.canSearch(this.player, this.searchTarget, this.coverBlockers, this.mechanics.interactRange)) this.cancelSearch();
            else { this.searchTimer -= dt; if (this.searchTimer <= 0) this.completeSearch(); }
        }
        if (this.healTimer > 0) {
            const interrupted = this.firing || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
            if (interrupted) this.healTimer = 0;
            else {
                this.healTimer -= dt;
                if (this.healTimer <= 0) {
                    this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.c.medkitHeal);
                    this.medkits--;
                }
            }
        }
        if (this.useItemTimer > 0) {
            const interrupted = this.firing || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
            if (interrupted) {
                this.useItemTimer = 0;
                this.activeItemIndex = -1;
            } else {
                this.useItemTimer -= dt;
                if (this.useItemTimer <= 0 && this.activeItemIndex >= 0) {
                    const item = this.quickSlots[this.activeItemIndex];
                    if (item) {
                        if (item.id === 'consumable_stim') {
                            this.stamina.value = this.mechanics.stamina.max;
                            this.stamina.exhausted = false;
                            this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
                        } else if (item.id === 'consumable_small_battery') {
                            this.player.shield = Math.min(this.player.maxShield, this.player.shield + 50);
                            this.player.shieldTimer = 0;
                        } else if (item.id === 'consumable_overcharger') {
                            this.player.shield = Math.min(this.player.maxShield, this.player.shield + 150);
                            this.player.shieldTimer = 0;
                        } else if (item.id === 'consumable_medkit') {
                            this.player.hp = Math.min(this.player.maxHp, this.player.hp + 60);
                        } else if (item.id === 'consumable_bandage') {
                            this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
                        }
                        this.lootFeedText = this.lang === 'ru' ? ('ИСПОЛЬЗОВАНО: ' + item.name) : ('USED: ' + item.name);
                        this.lootFeedTimer = 2.2;
                    }
                    this.activeItemIndex = -1;
                    this.updateHud(true);
                }
            }
        }
        if (this.phase === 'raid') {
            // ONCE THE BRIDGE IS LIVE THE SERVER IS THE AUTHORITY. Running the local player
            // simulation, the machine AI and the objective timers alongside it would give two
            // sources of truth fighting each frame: the position would snap back and forth and
            // a drive could be "collected" twice. In an online raid the snapshot drives all of
            // it, and the local systems are skipped entirely.
            const online = typeof OnlineBridge !== 'undefined' && OnlineBridge.active();
            if (!online) {
                this.updatePlayer(dt);
                this.updateJump(dt);
                this.updateGrenades(dt);
                this.updateEnemies(dt);
                if (this.phase === 'raid') this.updateObjectives(dt);
            } else {
                // Local, presentation-only work that never decides an outcome.
                this.updateJump(dt);
            }
        }
        this.hitMarker = Math.max(0, this.hitMarker - dt);
        this.damageFlash = Math.max(0, this.damageFlash - dt);
        this.lootFeedTimer = Math.max(0, this.lootFeedTimer - dt);
    }

    updatePlayer(dt) {
        if (this.player.shieldTimer > 0) {
            this.player.shieldTimer = Math.max(0, this.player.shieldTimer - dt);
            if (this._shieldRecharging) {
                this._shieldRecharging = false;
                if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
                    ProceduralAudio.combat.playShieldRecharge(false);
                }
            }
        } else if (this.player.shield < this.player.maxShield) {
            if (!this._shieldRecharging) {
                this._shieldRecharging = true;
                if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
                    ProceduralAudio.combat.playShieldRecharge(true);
                }
            }
            const rate = this.player.shieldRechargeRate || 20;
            this.player.shield = Math.min(this.player.maxShield, this.player.shield + rate * dt);
            if (this.player.shield >= this.player.maxShield && this._shieldRecharging) {
                this._shieldRecharging = false;
                if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
                    ProceduralAudio.combat.playShieldRecharge(false);
                }
            }
        }

        const { forward, right, moving } = RaidRules.movement(this.keys, this.touchMove);
        const wantsSprint = moving && forward > 0 && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !this.encumbrance?.sprintBlocked;
        if (wantsSprint && this.posture !== 'stand') {
            this.posture = 'stand';
        }

        const staminaConfig = this.encumbrance ? {
            ...this.mechanics.stamina,
            drain: this.mechanics.stamina.drain * (this.encumbrance.staminaDrainMult || 1.0),
            regen: this.mechanics.stamina.regen * (this.encumbrance.staminaRegenMult || 1.0),
        } : this.mechanics.stamina;
        const sprinting = RaidRules.tickStamina(this.stamina, wantsSprint && !this.aiming && !RaidRules.busy(this), dt, staminaConfig);
        this.weapon.moving = moving;
        this.weapon.sprinting = sprinting;

        // Tactical Posture modifiers
        const postureMods = (typeof RaidRules !== 'undefined' && RaidRules.getPostureModifiers)
            ? RaidRules.getPostureModifiers(this.posture)
            : { speedMult: 1, noiseMult: 1, eyeHeight: 64, recoilMult: 1, spreadMult: 1 };

        // Smooth eyeHeight lerp
        const targetEyeH = postureMods.eyeHeight || 64;
        this.player.eyeHeight = (this.player.eyeHeight != null ? this.player.eyeHeight : 64) + (targetEyeH - (this.player.eyeHeight != null ? this.player.eyeHeight : 64)) * Math.min(1, 12 * dt);
        // The hit cylinder follows the posture. Only eyeHeight used to change — and only the
        // camera reads that — so a prone operator occupied a standing 64 px collider and
        // crouching gave no protection at all offline.
        this.player.height = this.player.eyeHeight;
        this.player.h = this.app?.location?.terrain ? this.app.location.terrain.heightAt(this.player.x, this.player.y) : 0;

        // Smooth lean offset and roll lerp
        const targetLeanOffset = (this.lean || 0) * (typeof GAME_LEAN_OFFSET !== 'undefined' ? GAME_LEAN_OFFSET : 18);
        const targetLeanRoll = (this.lean || 0) * (typeof GAME_LEAN_ROLL !== 'undefined' ? GAME_LEAN_ROLL : 0.07);
        this.player.leanOffset = (this.player.leanOffset || 0) + (targetLeanOffset - (this.player.leanOffset || 0)) * Math.min(1, 14 * dt);
        this.player.leanRoll = (this.player.leanRoll || 0) + (targetLeanRoll - (this.player.leanRoll || 0)) * Math.min(1, 14 * dt);

        // Camera head bobbing
        if (moving) {
            const bobFreq = sprinting ? 14 : (this.posture === 'crouch' ? 7 : this.posture === 'prone' ? 5 : 10);
            this.bobPhase = (this.bobPhase || 0) + dt * bobFreq;
            const bobAmp = sprinting ? 1.6 : (this.posture === 'crouch' ? 0.7 : this.posture === 'prone' ? 0.4 : 1.0);
            this.player.bobX = Math.sin(this.bobPhase * 0.5) * 1.8 * bobAmp;
            this.player.bobY = Math.abs(Math.sin(this.bobPhase)) * 1.5 * bobAmp;
        } else {
            this.player.bobX = (this.player.bobX || 0) * Math.max(0, 1 - 10 * dt);
            this.player.bobY = (this.player.bobY || 0) * Math.max(0, 1 - 10 * dt);
        }

        if (moving) {
            const moveConfig = {
                ...this.c,
                speed: this.c.speed * (this.encumbrance?.speedMult || 1.0),
                postureSpeedMult: postureMods.speedMult
            };
            RaidRules.movePlayer(this.player, { forward, right, heading: this.app.camera.azimuth },
                sprinting, dt, moveConfig, this.coverBlockers, this.app.location);
            this._footstepTimer -= dt;
            if (this._footstepTimer <= 0) {
                this._footstepTimer = sprinting ? 0.3 : (this.posture === 'crouch' ? 0.55 : this.posture === 'prone' ? 0.75 : 0.43);
                let surface = 'dirt';
                if (this.coverBlockers) {
                    for (const b of this.coverBlockers) {
                        const dx = this.player.x - b.x;
                        const dy = this.player.y - b.y;
                        if (dx * dx + dy * dy <= (b.radius + 25) * (b.radius + 25)) {
                            surface = 'metal';
                            break;
                        }
                    }
                }
                const noiseMult = (this.encumbrance?.noiseMult || 1.0) * (postureMods.noiseMult || 1.0);
                if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.foley) {
                    ProceduralAudio.foley.playFootstep(surface, {
                        velocity: sprinting ? 1.0 : (this.posture === 'crouch' ? 0.35 : this.posture === 'prone' ? 0.2 : 0.5),
                        sprint: sprinting,
                        volume: (sprinting ? 0.35 : (this.posture === 'crouch' ? 0.12 : this.posture === 'prone' ? 0.06 : 0.22)) * noiseMult
                    });
                } else {
                    this.playSound(this.pickSound ? this.pickSound(this.audio?.footsteps, 'step') : null, 0.2 * noiseMult, 0.08);
                }
                this.emitNoise((sprinting ? this.mechanics.sprintNoise : this.mechanics.walkNoise) * noiseMult);
            }
        }
        this.player.heading = this.app.camera.azimuth;
        this.aim.x = this.player.x + Math.cos(this.player.heading) * this.c.range;
        this.aim.y = this.player.y + Math.sin(this.player.heading) * this.c.range;
        const clips = this.hero && this.hero.mesh ? Model3D.clips(this.hero.mesh) : null;
        if (clips) clips.play(moving ? 'run' : 'idle');
    }

    applyPlayerDamage(amount, source) {
        let dealt = Math.max(0, amount || 0);
        if (!dealt || this.phase !== 'raid') return;
        if (this.progressionBonuses?.damageReduction) {
            dealt = Math.max(1, Math.round(dealt * (1 - this.progressionBonuses.damageReduction)));
        }

        let result;
        if (typeof RaidRules !== 'undefined' && RaidRules.applyDamage) {
            result = RaidRules.applyDamage(this.player, dealt);
        } else {
            this.player.hp = Math.max(0, this.player.hp - dealt);
            result = { dealtToShield: 0, dealtToHp: dealt, shieldBroken: false, isDead: this.player.hp <= 0 };
        }

        this.damageTaken += dealt;
        this.damageFlash = result.shieldBroken ? 0.45 : 0.2;
        this.damageDirection = Math.atan2(source.y - this.player.y, source.x - this.player.x) - this.player.heading;
        this.healTimer = 0;
        this.useItemTimer = 0;
        this.activeItemIndex = -1;
        this.searchTimer = 0;
        this.searchTarget = null;
        this.player.shieldTimer = this.player.shieldRechargeDelay || 4.5;

        if (result.shieldBroken) {
            this.app?.camera?.shake(240, 0.02);
            if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
                ProceduralAudio.combat.playShieldBreak();
            } else if (this.audio?.shieldBreak) {
                this.playSound(this.audio.shieldBreak, 0.6);
            }
        } else {
            this.app?.camera?.shake(150, 0.01);
            if (result.dealtToShield > 0 && typeof ProceduralAudio !== 'undefined' && ProceduralAudio.combat) {
                ProceduralAudio.combat.playShieldHit();
            }
        }

        if (this.player.hp <= 0) {
            if (typeof MenuSystem !== 'undefined' && typeof RaidRules !== 'undefined' && RaidRules.resolveDeathDrop) {
                const dropResult = RaidRules.resolveDeathDrop(MenuSystem.loadout, MenuSystem.backpack);
                MenuSystem.loadout.primary = null;
                MenuSystem.loadout.secondary = null;
                MenuSystem.loadout.shieldCore = null;
                MenuSystem.backpack = Array(18).fill(null);
                MenuSystem.saveState();
            }
            this.finish(false);
        }
    }

    updateEnemies(dt) {
        let shooters = 0;
        const occupiedCover = this.enemies.filter(enemy => !enemy.dead && enemy.cover).map(enemy => ({ x: enemy.cover.x, y: enemy.cover.y, radius: 55 }));
        const postureMods = (typeof RaidRules !== 'undefined' && RaidRules.getPostureModifiers)
            ? RaidRules.getPostureModifiers(this.posture)
            : { noiseMult: 1.0 };
        const isPlayerMoving = this.weapon ? this.weapon.moving : false;
        const isPlayerSprinting = this.weapon ? this.weapon.sprinting : false;

        for (const enemy of this.enemies) {
            if (enemy.dead || enemy.dormant) { if (enemy.dormant && enemy.visual) enemy.visual.setEnabled(false); continue; }
            if (enemy.visual) enemy.visual.setEnabled(true);
            enemy.cooldown -= dt;
            enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
            // Timed statuses tick down here, next to the other per-frame enemy timers.
            if (enemy.suppressed > 0) enemy.suppressed = Math.max(0, enemy.suppressed - dt);
            if (enemy.empStunned > 0) enemy.empStunned = Math.max(0, enemy.empStunned - dt);
            const dx = this.player.x - enemy.x, dy = this.player.y - enemy.y;
            const dist = Math.hypot(dx, dy);

            // Vision cone & perception check
            const heading = (enemy.visual && typeof enemy.visual.rotation?.y === 'number') ? -enemy.visual.rotation.y : (enemy.heading || 0);
            const visionRange = enemy.visionRange || this.c.aggro || 650;
            // The authored cone, in degrees, is what the machine table declares (a Spotter sees
            // 140°, a Guard 90°). Reading only `visionAngleDeg` and falling back to 90 threw
            // away the value spawnEnemies stored under `visionAngle`, so every machine on the
            // map behaved like a generic 90° guard.
            const visionAngleRad = enemy.visionAngle != null
                ? enemy.visionAngle
                : ((enemy.visionAngleDeg != null ? enemy.visionAngleDeg : 90) * Math.PI) / 180;
            const visionAngleDeg = visionAngleRad * 180 / Math.PI;
            const inCone = (enemy.state === 'engage') || (visionAngleDeg >= 360) ||
                (typeof ShooterRules !== 'undefined' && ShooterRules.isInVisionCone
                    ? ShooterRules.isInVisionCone(enemy, heading, this.player, visionAngleRad, visionRange)
                    : (dist < visionRange));
            const hasLoS = (dist < visionRange) && inCone && ShooterRules.hasLineOfSight(enemy, this.player, this.coverBlockers, enemy.radius * 0.2);
            const visible = inCone && hasLoS;

            // Passive hearing detection when player moves nearby without direct LoS
            if (isPlayerMoving && enemy.state === 'patrol') {
                const noiseRadius = (isPlayerSprinting ? 460 : 260) * (postureMods.noiseMult || 1.0) * (this.encumbrance?.noiseMult || 1.0);
                const hearingDist = Math.min(enemy.hearingRadius || 500, noiseRadius);
                if (dist <= hearingDist) {
                    enemy.state = 'investigate';
                    enemy.alert = Math.max(enemy.alert, 0.45);
                    enemy.lastX = this.player.x;
                    enemy.lastY = this.player.y;
                }
            }

            if ((enemy.suppressed || 0) <= 0) enemy.alert = ShooterRules.clamp(enemy.alert + (visible ? dt * 3.5 : -dt * 0.18), 0, 1);
            else enemy.alert = 0;
            if (visible) {
                enemy.lastX = this.player.x; enemy.lastY = this.player.y;
                if (enemy.alert >= 0.35 && enemy.state !== 'engage' && enemy.state !== 'retreat') {
                    enemy.state = 'engage';
                    if (enemy.archetype === 'spotter' && !enemy.flareLaunched) {
                        enemy.flareLaunched = true;
                        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc) {
                            ProceduralAudio.arc.playSpotterSiren({ x: enemy.x, y: enemy.y });
                        }
                        this.lootFeedText = this.lang === 'ru' ? 'ВНИМАНИЕ: ARC SPOTTER ЗАПУСТИЛ РАКЕТУ!' : 'ALERT: ARC SPOTTER LAUNCHED FLARE!';
                        this.lootFeedTimer = 3.5;
                        if (this.scene) {
                            const enemyH = (enemy.h != null ? enemy.h : ((this.app?.location?.terrain ? this.app.location.terrain.heightAt(enemy.x, enemy.y) : 0) + 75)) + 18;
                            const flare = BABYLON.MeshBuilder.CreateSphere('spotter-flare-' + enemy.id, { diameter: 10, segments: 8 }, this.scene);
                            const flareMat = this.material('flare-mat-' + enemy.id, 0xff2200, 0.95);
                            flare.material = flareMat;
                            flare.position.set(enemy.x, enemyH, enemy.y);
                            this.effects.push({
                                mesh: flare,
                                material: flareMat,
                                life: 4.5,
                                update: (fxDt) => {
                                    flare.position.y += 320 * fxDt;
                                }
                            });
                        }

                        // Reinforcement wave: awaken dormant reserves
                        for (const reserve of this.enemies) {
                            if (reserve.dormant) {
                                reserve.dormant = false;
                                if (reserve.visual) reserve.visual.setEnabled(true);
                                reserve.alert = 1.0;
                                reserve.state = 'investigate';
                                reserve.lastX = this.player.x;
                                reserve.lastY = this.player.y;
                            }
                        }
                    }
                    const alertRadiusSq = enemy.archetype === 'spotter' ? 950 * 950 : enemy.archetype === 'screamer' ? 850 * 850 : 520 * 520;
                    let flankToggle = 1;
                    for (const ally of this.enemies) if (!ally.dead && ShooterRules.distanceSq(enemy, ally) < alertRadiusSq) {
                        ally.alert = Math.max(ally.alert, 0.6);
                        if (ally.state === 'patrol') ally.state = 'investigate';
                        ally.lastX = this.player.x; ally.lastY = this.player.y;
                        if (ally.archetype === 'stalker') {
                            ally.flankSide = flankToggle;
                            flankToggle = -flankToggle;
                            if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc?.playStalkerGrowl && Math.random() < 0.4) {
                                ProceduralAudio.arc.playStalkerGrowl({ x: ally.x, y: ally.y });
                            }
                        }
                    }
                }
            } else if (enemy.state === 'engage') enemy.state = 'investigate';
            if ((enemy.state === 'retreat' || (enemy.state === 'engage' && enemy.archetype !== 'heavy' && enemy.hp < enemy.maxHp * 0.65)) && !enemy.cover) {
                enemy.coverSearchCooldown = (enemy.coverSearchCooldown || 0) - dt;
                if (enemy.coverSearchCooldown <= 0) {
                    const maxCoverDistSq = 600 * 600;
                    const nearbyBlockers = (this.blockers || []).filter(b => ShooterRules.distanceSq(enemy, b) < maxCoverDistSq);
                    enemy.cover = ShooterRules.chooseCover(enemy, this.player, nearbyBlockers, occupiedCover,
                        { minX: 40, minY: 40, maxX: this.app.location.width - 40, maxY: this.app.location.height - 40 });
                    if (enemy.cover) enemy.state = 'cover';
                    else enemy.coverSearchCooldown = 1.0;
                }
            }
            if (enemy.state === 'cover' && enemy.cover && ShooterRules.distanceSq(enemy, enemy.cover) < 28 * 28) {
                enemy.state = enemy.hp < enemy.maxHp * 0.35 ? 'retreat' : 'engage';
                enemy.cooldown = Math.max(enemy.cooldown, 0.25);
            }
            let effectiveTargetX = enemy.state === 'investigate' ? enemy.lastX : enemy.state === 'cover' && enemy.cover ? enemy.cover.x : this.player.x;
            let effectiveTargetY = enemy.state === 'investigate' ? enemy.lastY : enemy.state === 'cover' && enemy.cover ? enemy.cover.y : this.player.y;

            if (enemy.archetype === 'stalker' && enemy.state === 'engage') {
                const flankRad = 0.95 * (enemy.flankSide || 1);
                const flankDist = Math.max(160, Math.min(360, dist * 0.85));
                const flankPos = (typeof RaidRules !== 'undefined' && RaidRules.calculateFlankPosition) ?
                    RaidRules.calculateFlankPosition(enemy, this.player, flankRad, flankDist) :
                    { x: this.player.x + Math.cos(flankRad) * flankDist, y: this.player.y + Math.sin(flankRad) * flankDist };
                effectiveTargetX = flankPos.x;
                effectiveTargetY = flankPos.y;
            }
            const targetX = effectiveTargetX;
            const targetY = effectiveTargetY;
            const dir = ShooterRules.normalize(targetX - enemy.x, targetY - enemy.y);
            enemy.visual.rotation.y = -Math.atan2(dir.y, dir.x);
            if (enemy.archetype === 'cricket') {
                enemy.leapCooldown = Math.max(0, (enemy.leapCooldown || 0) - dt);
                if (enemy.isLeaping) {
                    enemy.leapProgress += dt / 0.7;
                    const t = Math.min(1.0, enemy.leapProgress);
                    enemy.x = enemy.leapStartX + (enemy.leapTargetX - enemy.leapStartX) * t;
                    enemy.y = enemy.leapStartY + (enemy.leapTargetY - enemy.leapStartY) * t;
                    enemy.leapHeight = Math.sin(t * Math.PI) * 95;
                    enemy.walkTime = (enemy.walkTime || 0) + dt * 12;
                    if (t >= 1.0) {
                        enemy.isLeaping = false;
                        enemy.leapHeight = 0;
                        enemy.leapCooldown = 3.8;
                        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc) {
                            ProceduralAudio.arc.playCricketLanding({ x: enemy.x, y: enemy.y });
                        }
                        if (this.scene) {
                            const groundH = (this.app?.location?.terrain ? this.app.location.terrain.heightAt(enemy.x, enemy.y) : 0);
                            for (let k = 0; k < 8; k++) {
                                const angle = k * 0.78;
                                const spark = BABYLON.MeshBuilder.CreateLines('leap-dust', { points: [
                                    new BABYLON.Vector3(enemy.x, groundH + 1, enemy.y),
                                    new BABYLON.Vector3(enemy.x + Math.cos(angle) * 35, groundH + 3, enemy.y + Math.sin(angle) * 35),
                                ] }, this.scene);
                                spark.color = new BABYLON.Color3(0.6, 0.55, 0.45);
                                this.effects.push({ mesh: spark, life: 0.28 });
                            }
                        }
                        if (ShooterRules.distanceSq(enemy, this.player) < 65 * 65) {
                            this.applyPlayerDamage(45, enemy);
                            this.app?.camera?.shake(200, 0.025);
                        }
                    }
                    continue;
                } else if (visible && dist >= 120 && dist <= 350 && enemy.leapCooldown <= 0) {
                    enemy.isLeaping = true;
                    if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc) {
                        ProceduralAudio.arc.playCricketLeapCharge({ x: enemy.x, y: enemy.y });
                    }
                    enemy.leapProgress = 0;
                    enemy.leapStartX = enemy.x;
                    enemy.leapStartY = enemy.y;
                    enemy.leapTargetX = this.player.x;
                    enemy.leapTargetY = this.player.y;
                    continue;
                }
            }

            if (enemy.archetype === 'screamer') {
                enemy.screamCooldown = Math.max(0, (enemy.screamCooldown || 0) - dt);
                if (visible && dist <= 750 && enemy.screamCooldown <= 0) {
                    enemy.screamCooldown = 6.5;
                    BotRig3D.signal(enemy.visual, 'scream');
                    if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc) {
                        ProceduralAudio.arc.playScreamerScream({ x: enemy.x, y: enemy.y });
                    }
                    this.lootFeedText = this.lang === 'ru' ? 'ВНИМАНИЕ: АКУСТИЧЕСКИЙ УДАР SCREAMER (-35 ЩИТ)!' : 'WARNING: SCREAMER EW SONIC STRIKE (-35 SHIELD)!';
                    this.lootFeedTimer = 3.0;
                    if (this.player.shield > 0) {
                        this.player.shield = Math.max(0, this.player.shield - 35);
                        this.player.shieldTimer = 4.5;
                    }
                    this.app?.camera?.shake(300, 0.03);
                    if (this.scene) {
                        const groundH = (this.app?.location?.terrain ? this.app.location.terrain.heightAt(enemy.x, enemy.y) : 0) + 12;
                        const ring = BABYLON.MeshBuilder.CreateTorus('sonic-ring-' + enemy.id, { diameter: 20, thickness: 3, tessellation: 24 }, this.scene);
                        const ringMat = this.material('sonic-ring-mat-' + enemy.id, 0x00f0ff, 0.9);
                        ringMat.alpha = 0.65;
                        ring.material = ringMat;
                        ring.position.set(enemy.x, groundH, enemy.y);
                        this.effects.push({
                            mesh: ring,
                            life: 1.2,
                            update: (fxDt) => {
                                ring.scaling.x += 18 * fxDt;
                                ring.scaling.z += 18 * fxDt;
                                ringMat.alpha = Math.max(0, ringMat.alpha - fxDt * 0.6);
                            }
                        });
                    }
                    for (const ally of this.enemies) {
                        if (!ally.dead && ShooterRules.distanceSq(enemy, ally) < 850 * 850) {
                            ally.alert = 1.0;
                            ally.state = 'engage';
                            ally.lastX = this.player.x; ally.lastY = this.player.y;
                        }
                    }
                }
            }

            if (enemy.archetype === 'stalker') {
                enemy.burstCooldown = Math.max(0, (enemy.burstCooldown || 0) - dt);
                if (enemy.bursting) {
                    enemy.burstTimer -= dt;
                    if (enemy.burstTimer <= 0) {
                        enemy.burstTimer = enemy.burstInterval || 0.08;
                        enemy.burstRoundsLeft--;
                        const spread = ShooterRules.shotSpread(this.seed, enemy.id, enemy.shotSerial++, 3.5 * Math.PI / 180);
                        const angle = Math.atan2(dy, dx) + spread;
                        const playerH = (this.app?.location?.terrain ? this.app.location.terrain.heightAt(this.player.x, this.player.y) : 0) + 38;
                        // Same rule as the other archetypes: face first, fire from the muzzle.
                        const muzzle = this.aimEnemyAt(enemy, this.player.x, this.player.y) ||
                            { x: enemy.x, y: enemy.y, h: (this.app?.location?.terrain ? this.app.location.terrain.heightAt(enemy.x, enemy.y) : 0) + 32 };
                        const enemyH = muzzle.h;
                        const distH = Math.max(1, Math.hypot(this.player.x - muzzle.x, this.player.y - muzzle.y));
                        const pitch = Math.atan2(enemyH - playerH, distH);
                        const cp = Math.cos(pitch);
                        const speed = 4400;
                        const proj = ShooterRules.createProjectile({
                            id: 'stalker_' + enemy.id + '_' + (enemy.shotSerial || 0),
                            shooterId: enemy.id,
                            x: muzzle.x, y: muzzle.y, h: enemyH,
                            vx: Math.cos(angle) * cp * speed,
                            vy: Math.sin(angle) * cp * speed,
                            vh: -Math.sin(pitch) * speed,
                            damage: 11,
                            gravity: 980,
                            drag: 0.035,
                            maxRange: 1400
                        });
                        this.spawnTracer(proj, true);
                        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.weapon) {
                            ProceduralAudio.weapon.play('light_kinetic', { x: enemy.x, y: enemy.y }, false, 1);
                        }
                        if (enemy.burstRoundsLeft <= 0) {
                            enemy.bursting = false;
                            enemy.burstCooldown = 2.2;
                        }
                    }
                } else if (visible && dist <= 550 && enemy.burstCooldown <= 0) {
                    enemy.bursting = true;
                    enemy.burstRoundsLeft = 5;
                    enemy.burstTimer = 0;
                    if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc?.playStalkerPounce) {
                        ProceduralAudio.arc.playStalkerPounce({ x: enemy.x, y: enemy.y });
                    }
                }
            }

            if (enemy.archetype === 'bombard') {
                enemy.mortarCooldown = Math.max(0, (enemy.mortarCooldown || 0) - dt);
                if (visible && dist >= 260 && dist <= 1800) {
                    if (!enemy.isDeployed) {
                        enemy.deployTimer = (enemy.deployTimer || 0) + dt;
                        enemy.deployProgress = Math.min(1.0, enemy.deployTimer / 1.8);
                        if (enemy.deployTimer >= 1.8) {
                            enemy.isDeployed = true;
                            if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc?.playBombardDeploy) {
                                ProceduralAudio.arc.playBombardDeploy({ x: enemy.x, y: enemy.y });
                            }
                        }
                    } else if (enemy.mortarCooldown <= 0) {
                        enemy.mortarCooldown = 5.5;
                        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc?.playBombardLaunch) {
                            ProceduralAudio.arc.playBombardLaunch({ x: enemy.x, y: enemy.y });
                        }
                        enemy.mortarRecoil = 0.55;
                        const bTargetX = this.player.x + (this.player.vx || 0) * 0.7;
                        const bTargetY = this.player.y + (this.player.vy || 0) * 0.7;
                        const bGroundH = this.app?.location?.terrain ? this.app.location.terrain.heightAt(bTargetX, bTargetY) : 0;

                        let targetDecal = null;
                        let decalMat = null;
                        if (this.scene) {
                            decalMat = this.material('mortar-target-mat-' + Date.now(), 0xff2200, 0.85);
                            decalMat.alpha = 0.25;
                            targetDecal = BABYLON.MeshBuilder.CreateDisc('mortar-target-' + Date.now(), { radius: 140, tessellation: 32 }, this.scene);
                            targetDecal.material = decalMat;
                            targetDecal.position.set(bTargetX, bGroundH + 1.2, bTargetY);
                            targetDecal.rotation.x = Math.PI / 2;
                        }

                        const shellOriginX = enemy.x;
                        const shellOriginY = enemy.y;
                        const shellOriginH = (enemy.h || 0) + 70;
                        const flightDuration = 2.2;
                        const shellMesh = this.scene ? BABYLON.MeshBuilder.CreateSphere('mortar-shell-' + Date.now(), { diameter: 14, segments: 8 }, this.scene) : null;
                        if (shellMesh) {
                            shellMesh.material = this.material('mortar-shell-mat', 0xff5500, 1.0);
                        }

                        this.effects.push({
                            life: flightDuration,
                            totalLife: flightDuration,
                            mesh: shellMesh,
                            decal: targetDecal,
                            update: (fxDt, remaining, total) => {
                                const prog = 1 - (remaining / total);
                                if (targetDecal && decalMat) {
                                    decalMat.alpha = 0.2 + prog * 0.6;
                                    const pulse = 1.0 + Math.sin(prog * 18) * 0.08;
                                    targetDecal.scaling.set(pulse, pulse, pulse);
                                }
                                if (shellMesh) {
                                    const curX = shellOriginX + (bTargetX - shellOriginX) * prog;
                                    const curY = shellOriginY + (bTargetY - shellOriginY) * prog;
                                    const arcHeight = Math.sin(prog * Math.PI) * 420;
                                    const curH = shellOriginH + (bGroundH - shellOriginH) * prog + arcHeight;
                                    shellMesh.position.set(curX, curH, curY);
                                }
                                if (remaining <= fxDt) {
                                    if (targetDecal) targetDecal.dispose();
                                    if (shellMesh) shellMesh.dispose();
                                    if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc?.playBombardImpact) {
                                        ProceduralAudio.arc.playBombardImpact({ x: bTargetX, y: bTargetY });
                                    }
                                    this.app?.camera?.shake(350, 0.045);
                                    this.triggerMortarExplosion(bTargetX, bTargetY, bGroundH, 85, 140);
                                }
                            }
                        });
                    }
                } else if (dist < 200 && enemy.isDeployed) {
                    enemy.isDeployed = false;
                    enemy.deployTimer = 0;
                    enemy.deployProgress = 0;
                }
            }

            if (enemy.alert < 0.35) {
                enemy.state = 'patrol';
                enemy.patrolPhase = (enemy.patrolPhase || 0) + dt * 0.4;
                const pr = enemy.patrolRadius || 180;
                const px = enemy.homeX + Math.cos(enemy.patrolPhase) * pr + Math.sin(enemy.patrolPhase * 0.5) * (pr * 0.35);
                const py = enemy.homeY + Math.sin(enemy.patrolPhase) * pr + Math.cos(enemy.patrolPhase * 0.5) * (pr * 0.35);
                const patrol = ShooterRules.normalize(px - enemy.x, py - enemy.y);
                const pSpeed = enemy.patrolSpeed || 55;
                const moved = ShooterRules.resolveCircleMovement(enemy, { x: patrol.x * pSpeed * dt, y: patrol.y * pSpeed * dt }, enemy.radius, this.coverBlockers);
                enemy.x = moved.x; enemy.y = moved.y;
                enemy.walkTime = (enemy.walkTime || 0) + dt * 4.5;
                continue;
            }

            const staggerMult = enemy.stagger > 0 ? 0.35 : 1.0;
            const targetDist = Math.hypot(targetX - enemy.x, targetY - enemy.y);
            if ((enemy.state === 'cover' || !visible || dist > 450) && targetDist > 50) {
                let steerX = dir.x;
                let steerY = dir.y;
                if (this.navGrid) {
                    enemy.pathTimer = (enemy.pathTimer || 0) - dt;
                    const targetMoved = !enemy.lastNavTarget || Math.hypot(enemy.lastNavTarget.x - targetX, enemy.lastNavTarget.y - targetY) > 80;
                    if ((!enemy.path || enemy.pathTimer <= 0 || targetMoved) && !enemy.pathPending) {
                        enemy.pathTimer = 0.65 + (enemy.id % 4) * 0.15;
                        enemy.lastNavTarget = { x: targetX, y: targetY };
                        enemy.pathPending = true;
                        const enemyRef = enemy;
                        this.navGrid.findPathAsync(
                            { x: enemy.x, y: enemy.y },
                            { x: targetX, y: targetY }
                        ).then(path => {
                            enemyRef.pathPending = false;
                            if (path && path.length > 0) {
                                enemyRef.path = path;
                                enemyRef.pathIndex = 0;
                            }
                        }).catch(() => {
                            enemyRef.pathPending = false;
                        });
                    }
                    if (enemy.path && enemy.pathIndex < enemy.path.length) {
                        while (enemy.pathIndex < enemy.path.length && Math.hypot(enemy.path[enemy.pathIndex].x - enemy.x, enemy.path[enemy.pathIndex].y - enemy.y) < 36) {
                            enemy.pathIndex++;
                        }
                        if (enemy.pathIndex < enemy.path.length) {
                            const wp = enemy.path[enemy.pathIndex];
                            const pdir = ShooterRules.normalize(wp.x - enemy.x, wp.y - enemy.y);
                            steerX = pdir.x;
                            steerY = pdir.y;
                        }
                    }
                }
                const moveSpeed = (enemy.archetype === 'bombard' && enemy.isDeployed) ? 0 :
                    this.c.enemySpeed * (enemy.archetype === 'scout' ? 1.45 : enemy.archetype === 'stalker' ? 1.35 : enemy.archetype === 'heavy' ? 0.65 : enemy.archetype === 'bombard' ? 0.38 : 1) * staggerMult;
                const moved = ShooterRules.resolveCircleMovement(enemy,
                    { x: steerX * moveSpeed * dt, y: steerY * moveSpeed * dt },
                    enemy.radius, this.coverBlockers);
                enemy.x = moved.x; enemy.y = moved.y;
                enemy.walkTime = (enemy.walkTime || 0) + dt * 7.5;
                enemy.heading = Math.atan2(steerY, steerX);
                if (enemy.visual) enemy.visual.rotation.y = -Math.atan2(steerY, steerX);
                if (enemy.state === 'investigate' && targetDist < 55) enemy.alert = Math.max(0, enemy.alert - dt * 1.5);
            } else if (visible && dist > 140 && dist <= 450) {
                // Medium range tactical combat sweet spot: stop & strafe laterally!
                enemy.strafeTimer = (enemy.strafeTimer || 1.5) - dt;
                if (enemy.strafeTimer <= 0) {
                    enemy.strafeDir = (Math.random() < 0.5 ? 1 : -1);
                    enemy.strafeTimer = 1.0 + Math.random() * 1.6;
                }
                const perp = { x: -dir.y * enemy.strafeDir, y: dir.x * enemy.strafeDir };
                const strafeSpeed = (enemy.archetype === 'bombard' && enemy.isDeployed) ? 0 : this.c.enemySpeed * 0.55 * staggerMult;
                const moved = ShooterRules.resolveCircleMovement(enemy,
                    { x: perp.x * strafeSpeed * dt, y: perp.y * strafeSpeed * dt },
                    enemy.radius, this.coverBlockers);
                enemy.x = moved.x; enemy.y = moved.y;
                enemy.walkTime = (enemy.walkTime || 0) + dt * 5.5;

                if (enemy.archetype === 'sentinel' && enemy.state === 'engage' && !enemy.hornTriggered) {
                    enemy.hornTriggered = true;
                    if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc) {
                        ProceduralAudio.arc.playSentinelHorn({ x: enemy.x, y: enemy.y });
                    }
                }

                // An EMP-stunned machine cannot fire. `empStunned` used to be written once and
                // never read, which made the whole gadget cosmetic.
                if ((enemy.empStunned || 0) <= 0 && shooters < 3 && enemy.cooldown <= 0) {
                    shooters++;
                    enemy.cooldown = this.c.enemyAttack * (enemy.archetype === 'scout' ? 0.72 : enemy.archetype === 'heavy' ? 1.5 : 1) + (enemy.id % 3) * 0.12;
                    const spreadDeg = enemy.archetype === 'scout' ? 6 : enemy.archetype === 'heavy' ? 2.5 : 4.5;
                    const spread = ShooterRules.shotSpread(this.seed, enemy.id, enemy.shotSerial++, spreadDeg * Math.PI / 180);
                    const angle = Math.atan2(dy, dx) + spread;
                    const playerH = (this.app?.location?.terrain ? this.app.location.terrain.heightAt(this.player.x, this.player.y) : 0) + 38;
                    // Face the target BEFORE firing, then shoot from the weapon: the tracers
                    // and the model now agree, so shots no longer leave the body sideways.
                    const muzzle = this.aimEnemyAt(enemy, this.player.x, this.player.y) ||
                        { x: enemy.x, y: enemy.y, h: (this.app?.location?.terrain ? this.app.location.terrain.heightAt(enemy.x, enemy.y) : 0) + 40 };
                    const enemyH = muzzle.h;
                    const distH = Math.max(1, Math.hypot(this.player.x - muzzle.x, this.player.y - muzzle.y));
                    const pitch = Math.atan2(enemyH - playerH, distH);
                    const cp = Math.cos(pitch);
                    const speed = 3600;
                    const dealt = this.c.enemyDamage * (enemy.archetype === 'heavy' ? 1.6 : enemy.archetype === 'scout' ? 0.7 : 1);
                    const proj = ShooterRules.createProjectile({
                        id: 'e_' + enemy.id + '_' + (enemy.shotSerial || 0),
                        shooterId: enemy.id,
                        x: muzzle.x,
                        y: muzzle.y,
                        h: enemyH,
                        vx: Math.cos(angle) * cp * speed,
                        vy: Math.sin(angle) * cp * speed,
                        vh: -Math.sin(pitch) * speed,
                        damage: dealt,
                        gravity: 980,
                        drag: 0.04,
                        maxRange: 1200,
                    });
                    this.spawnTracer(proj, true);
                    if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.weapon) {
                        const enemyCal = enemy.archetype === 'screamer' ? 'plasma' : (enemy.archetype === 'cricket' ? 'light_kinetic' : 'heavy_kinetic');
                        ProceduralAudio.weapon.play(enemyCal, { x: enemy.x, y: enemy.y }, false, 1);
                    } else if (this.audio?.enemyShot) {
                        if (this.playPositionalSound) this.playPositionalSound(this.audio.enemyShot, enemy.x, enemy.y, 0.2, 700);
                        else this.playSound(this.audio.enemyShot, 0.14);
                    }
                }
            } else if (visible && dist <= 140 && dist > 68) {
                const backDir = enemy.archetype === 'heavy' ? 0.8 : -0.6;
                const moveSpeed = this.c.enemySpeed * 0.7 * backDir * staggerMult;
                const moved = ShooterRules.resolveCircleMovement(enemy,
                    { x: dir.x * moveSpeed * dt, y: dir.y * moveSpeed * dt }, enemy.radius, this.coverBlockers);
                enemy.x = moved.x; enemy.y = moved.y;
                enemy.walkTime = (enemy.walkTime || 0) + dt * 5;
            } else if (dist <= 68 && enemy.cooldown <= 0) {
                enemy.cooldown = this.c.enemyAttack;
                this.applyPlayerDamage(this.c.enemyDamage, enemy);
            }
        }
    }

    updateObjectives(dt) {
        // Raid Match Timer & Lethal Barrage Countdown
        if (this.phase === 'raid' && !this.paused && typeof this.raidTimer === 'number') {
            this.raidTimer = Math.max(0, this.raidTimer - dt);
            if (this.raidTimer <= 0) {
                this.triggerLethalBarrage(dt);
            } else {
                this.barrageActive = false;
            }
        }

        if (Array.isArray(this.pickups)) {
            for (const pickup of this.pickups) {
                if (!pickup.taken && this.player && ShooterRules.distanceSq(this.player, pickup) <= (this.player.radius + pickup.radius) ** 2) {
                    pickup.taken = true;
                    if (pickup.visual) pickup.visual.setEnabled(false);
                    if (pickup.beam) pickup.beam.setEnabled(false);
                    this.loot = (this.loot || 0) + 1;
                    this.noteLootTaken();
                    this.raidValue = (this.raidValue || 0) + 300;
                    const intelItem = {
                        id: 'data_drive_' + this.loot,
                        name: 'Encrypted Data Drive #' + this.loot,
                        type: 'intel',
                        rarity: 'rare',
                        value: 300,
                        weight: 1.2,
                        description: 'ARC memory storage cylinder recovered from industrial telemetry terminal.'
                    };
                    // The drive is raid progress, so it rides in the bag regardless of the loot
                    // capacity: an empty-cell test against a hardcoded 12 both overfilled an
                    // 18-cell grid and ignored the 6-item rule the HUD and the server use.
                    this.ensureBackpack18();
                    const driveIdx = this.backpack.findIndex(s => !s);
                    if (driveIdx !== -1) this.backpack[driveIdx] = intelItem;
                    this.lootFeedTimer = 3.0;
                    this.lootFeedText = '+ DATA DRIVE ACQUIRED [300 CR]';
                    if (this.playSound) this.playSound('loot', 0.6, 0.05);
                }
            }
        }

        // 1. Public Evac Beacon (Alpha - Cargo Elevator)
        const inZone = (this.player && this.extract) ? ShooterRules.distanceSq(this.player, this.extract) <= this.extract.radius ** 2 : false;
        const enemiesList = this.enemies || [];
        const extractSec = (this.c && (this.c.extractSec || this.c.extractHoldSec)) || 6;
        if (this.extractState === 'inbound') {
            this.inboundTimer = Math.max(0, this.inboundTimer - dt);
            if (!this.beaconSirenAlertSent) {
                this.beaconSirenAlertSent = true;
                if (this.emitNoise) this.emitNoise(this.c?.beaconSirenRadius || 380);
                for (const enemy of enemiesList) {
                    if (!enemy.dead) {
                        enemy.dormant = false;
                        enemy.state = 'investigate';
                        enemy.alert = 1.0;
                        if (this.extract) {
                            enemy.lastX = this.extract.x;
                            enemy.lastY = this.extract.y;
                        }
                    }
                }
            }
            if (!this.reinforcementsSent && this.inboundTimer <= (this.c?.inboundSec || 20) * 0.72) {
                this.reinforcementsSent = true;
                for (const enemy of enemiesList) if (enemy.dormant && !enemy.dead) {
                    enemy.dormant = false; enemy.state = 'investigate'; enemy.alert = 0.7;
                    if (this.extract) {
                        enemy.lastX = this.extract.x; enemy.lastY = this.extract.y;
                    }
                }
            }
            if (this.inboundTimer <= 0) this.extractState = 'boarding';
        } else if (this.extractState === 'boarding') {
            const contested = this.extract ? enemiesList.some(enemy => !enemy.dead && !enemy.dormant && ShooterRules.distanceSq(enemy, this.extract) <= (this.extract.radius + 20) ** 2) : false;
            this.extractContested = contested;
            if (inZone && !contested) {
                this.extractProgress = (this.extractProgress || 0) + dt;
                if (this.extractProgress >= extractSec) this.finish(true);
            } else this.extractProgress = Math.max(0, (this.extractProgress || 0) - dt);
        }

        // 2. Secondary Evac: Metro Station (Beta)
        if (this.metroExtract) {
            const inMetroZone = (this.player && this.metroExtract) ? ShooterRules.distanceSq(this.player, this.metroExtract) <= this.metroExtract.radius ** 2 : false;
            if (this.metroExtract.state === 'inbound') {
                this.metroExtract.inboundTimer = Math.max(0, (this.metroExtract.inboundTimer || 0) - dt);
                if (!this.metroExtract.sirenAlertSent) {
                    this.metroExtract.sirenAlertSent = true;
                    if (this.emitNoise) this.emitNoise(this.c?.beaconSirenRadius || 380);
                    for (const enemy of enemiesList) {
                        if (!enemy.dead) {
                            enemy.dormant = false;
                            enemy.state = 'investigate';
                            enemy.alert = 1.0;
                            enemy.lastX = this.metroExtract.x;
                            enemy.lastY = this.metroExtract.y;
                        }
                    }
                }
                if (this.metroExtract.inboundTimer <= 0) {
                    this.metroExtract.state = 'boarding';
                }
            } else if (this.metroExtract.state === 'boarding') {
                const contested = enemiesList.some(enemy => !enemy.dead && !enemy.dormant && ShooterRules.distanceSq(enemy, this.metroExtract) <= (this.metroExtract.radius + 20) ** 2);
                this.metroExtract.contested = contested;
                if (inMetroZone && !contested) {
                    this.metroExtract.extractProgress = (this.metroExtract.extractProgress || 0) + dt;
                    if (this.metroExtract.extractProgress >= extractSec) this.finish(true);
                } else {
                    this.metroExtract.extractProgress = Math.max(0, (this.metroExtract.extractProgress || 0) - dt);
                }
            }
        }

        // 2. Silent Raider Bunker Hatch
        if (this.hatchExtract) {
            const inHatchZone = ShooterRules.distanceSq(this.player, this.hatchExtract) <= this.hatchExtract.radius ** 2;
            const hasKey = typeof RaidRules !== 'undefined' && RaidRules.canOpenRaiderHatch ?
                RaidRules.canOpenRaiderHatch(this.backpack, typeof MenuSystem !== 'undefined' ? MenuSystem.loadout?.safePocket : []) : false;

            if (this.hatchExtract.ledMat) {
                this.hatchExtract.ledMat.emissiveColor = hasKey ? new BABYLON.Color3(0.2, 0.9, 0.3) : new BABYLON.Color3(0.9, 0.4, 0.1);
            }

            // The hatch is an interaction like any other: it waits for the action lock, so it can no
            // longer be cranked open in the middle of a reload that locks every other verb.
            const hatchReady = typeof RaidRules !== 'undefined'
                ? (RaidRules.canAct(this) && !RaidRules.busy(this))
                : true;
            if (inHatchZone && hasKey && hatchReady && this.keys.has('KeyE')) {
                this.hatchProgress = Math.min(this.c.hatchHoldSec, (this.hatchProgress || 0) + dt);
                if (this.hatchProgress >= this.c.hatchHoldSec) {
                    if (typeof RaidRules !== 'undefined' && RaidRules.consumeHatchKey) {
                        RaidRules.consumeHatchKey(this.backpack, typeof MenuSystem !== 'undefined' ? MenuSystem.loadout?.safePocket : []);
                    }
                    this.emitNoise(this.c.hatchNoiseRadius);
                    this.finish(true);
                }
            } else if (!inHatchZone || !this.keys.has('KeyE')) {
                this.hatchProgress = Math.max(0, (this.hatchProgress || 0) - dt * 2.5);
            }
        }
    }

    updateVisuals(dt) {
        const terrain = this.app.location.terrain;
        const playerMesh = this.hero && this.hero.mesh ? this.hero.mesh : this.playerVisual;
        if (playerMesh) {
            playerMesh.position.set(this.player.x, terrain.heightAt(this.player.x, this.player.y), this.player.y);
            playerMesh.rotation.y = -this.player.heading;
            playerMesh.setEnabled(false); // never render the local body through the first-person camera
        }
        for (const enemy of this.enemies) {
            if (enemy.dead) {
                if (enemy.visual) {
                    enemy.visual.metadata = enemy.visual.metadata || {};
                    enemy.visual.metadata.cullShadow = true;
                }
                BotRig3D.update(enemy, 0);
                continue;
            }
            if (enemy.visual) {
                const distToPlayer = Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y);
                enemy.visual.metadata = enemy.visual.metadata || {};
                enemy.visual.metadata.cullShadow = !!(enemy.dormant || distToPlayer > 750);
            }
            const rigged = BotRig3D.update(enemy, dt);
            if (enemy.archetype === 'spotter') {
                enemy.hoverSoundTimer = (enemy.hoverSoundTimer || 0) - dt;
                if (enemy.hoverSoundTimer <= 0 && !enemy.dormant) {
                    enemy.hoverSoundTimer = 3.5;
                    if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc) {
                        ProceduralAudio.arc.playSpotterHover({ x: enemy.x, y: enemy.y });
                    }
                }
                enemy.flyPhase = (enemy.flyPhase || 0) + dt * 2.5;
                const groundH = terrain ? terrain.heightAt(enemy.x, enemy.y) : 0;
                const bobbing = Math.sin(enemy.flyPhase) * 6;
                const currentAlt = (enemy.flyAltitude || 75) + bobbing;
                enemy.h = groundH + currentAlt;
                if (enemy.visual) enemy.visual.position.set(enemy.x, enemy.h, enemy.y);

                // Flight physics: gentle roll and forward pitch
                const vx = enemy.x - (enemy.lastVisualX ?? enemy.x);
                const vy = enemy.y - (enemy.lastVisualY ?? enemy.y);
                enemy.lastVisualX = enemy.x;
                enemy.lastVisualY = enemy.y;
                const moveDist = Math.hypot(vx, vy);

                if (enemy.visual) {
                    enemy.visual.rotation.z = Math.sin(enemy.flyPhase * 0.8) * 0.08;
                    enemy.visual.rotation.x = 0.06 + Math.min(0.22, moveDist * 0.05);
                }

                // Dynamic searchlight cone: cyan on patrol, amber on alert, flashing red on engage
                if (enemy.searchlightMat) {
                    if (enemy.state === 'engage' || enemy.alert >= 0.8) {
                        const flash = (Math.sin(this.time * 16) > 0) ? 1 : 0.2;
                        enemy.searchlightMat.emissiveColor = new BABYLON.Color3(1, 0.08, 0.02);
                        enemy.searchlightMat.alpha = 0.45 * flash;
                    } else if (enemy.state === 'investigate') {
                        enemy.searchlightMat.emissiveColor = new BABYLON.Color3(1, 0.65, 0.1);
                        enemy.searchlightMat.alpha = 0.32;
                    } else {
                        enemy.searchlightMat.emissiveColor = new BABYLON.Color3(0.2, 0.85, 0.8);
                        enemy.searchlightMat.alpha = 0.22 + Math.sin(enemy.flyPhase * 1.5) * 0.06;
                    }
                }
            } else {
                let lift = 5;
                if (enemy.archetype === 'cricket') {
                    lift = (enemy.leapHeight || 0) + (rigged ? 0 : 4);
                    enemy.chitterTimer = (enemy.chitterTimer || (2.0 + (enemy.id % 5) * 0.5)) - dt;
                    if (enemy.chitterTimer <= 0 && !enemy.dormant) {
                        enemy.chitterTimer = 3.0 + Math.random() * 3.5;
                        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc) {
                            ProceduralAudio.arc.playCricketChitter({ x: enemy.x, y: enemy.y });
                        }
                    }
                    if (enemy.visual) {
                        if (rigged) {
                            enemy.visual.rotation.x = 0;
                            enemy.visual.rotation.z = 0;
                        } else if (enemy.isLeaping) {
                            enemy.visual.rotation.x = -Math.sin(enemy.leapProgress * Math.PI) * 0.45;
                        } else {
                            enemy.visual.rotation.x = Math.sin(enemy.walkTime * 8) * 0.08;
                            enemy.visual.rotation.z = Math.cos(enemy.walkTime * 6) * 0.05;
                        }
                    }
                } else if (enemy.archetype === 'screamer') {
                    lift = rigged ? 0 : 8 + Math.abs(Math.sin(enemy.walkTime * 3)) * 6;
                    enemy.stiltTimer = (enemy.stiltTimer || 0.8) - dt;
                    if (enemy.stiltTimer <= 0 && !enemy.dormant && enemy.state !== 'cover') {
                        enemy.stiltTimer = 1.3;
                        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc) {
                            ProceduralAudio.arc.playScreamerStiltStep({ x: enemy.x, y: enemy.y });
                        }
                    }
                    if (enemy.visual) {
                        enemy.visual.rotation.z = rigged ? 0 : Math.sin(enemy.walkTime * 1.5) * 0.06;
                        enemy.visual.rotation.x = rigged ? 0 : Math.sin(enemy.walkTime * 2.0) * 0.04;
                    }
                } else if (enemy.archetype === 'sentinel') {
                    lift = 6 + Math.abs(Math.sin(enemy.walkTime * 2.5)) * 4;
                    enemy.sentinelStepTimer = (enemy.sentinelStepTimer || 1.2) - dt;
                    if (enemy.sentinelStepTimer <= 0 && !enemy.dormant && enemy.state !== 'cover') {
                        enemy.sentinelStepTimer = 1.5;
                        if (typeof ProceduralAudio !== 'undefined' && ProceduralAudio.arc) {
                            ProceduralAudio.arc.playSentinelStep({ x: enemy.x, y: enemy.y });
                        }
                    }
                    if (enemy.visual) {
                        enemy.visual.rotation.z = Math.sin(enemy.walkTime * 2.5) * 0.05;
                    }
                }
                this.place(enemy.visual, enemy.x, enemy.y, lift);
                enemy.h = (terrain ? terrain.heightAt(enemy.x, enemy.y) : 0) + lift;
            }

            const eyeMat = enemy.eye ? enemy.eye.material : null;
            if (eyeMat) eyeMat.emissiveColor = enemy.hitFlash > 0 ? new BABYLON.Color3(1, 1, 1)
                : enemy.state === 'engage' ? new BABYLON.Color3(1, 0.04, 0.01)
                : enemy.state === 'investigate' ? new BABYLON.Color3(1, 0.45, 0.03)
                : enemy.state === 'cover' || enemy.state === 'retreat' ? new BABYLON.Color3(0.35, 0.55, 1)
                : enemy.baseEyeColor;

            // Stagger flinch recovery
            if (enemy.stagger > 0) {
                enemy.stagger = Math.max(0, enemy.stagger - dt);
                if (enemy.torso) enemy.torso.rotation.x = -enemy.stagger * 1.6;
                if (enemy.head) enemy.head.rotation.x = -enemy.stagger * 2.2;
            } else {
                if (enemy.torso) enemy.torso.rotation.x = 0;
                if (enemy.head) enemy.head.rotation.x = 0;
            }

            // Procedural walking limb swing
            if (enemy.legs && enemy.arms) {
                const speedMoving = enemy.state !== 'dormant' && !enemy.dead;
                const swing = speedMoving ? Math.sin(enemy.walkTime || 0) : 0;
                for (const l of enemy.legs) {
                    l.leg.rotation.x = swing * (l.side === 1 ? 0.42 : -0.42);
                    l.foot.rotation.x = swing * (l.side === 1 ? 0.22 : -0.22);
                }
                for (const a of enemy.arms) {
                    a.arm.rotation.x = -swing * (a.side === 1 ? 0.35 : -0.35);
                }
            }
        }
        for (const pickup of this.pickups) if (!pickup.taken) {
            pickup.phase += dt * 2.2;
            this.place(pickup.visual, pickup.x, pickup.y, 35 + Math.sin(pickup.phase) * 7);
            pickup.visual.rotation.y += dt;
            if (pickup.beam) {
                this.place(pickup.beam, pickup.x, pickup.y, 90);
                pickup.beam.rotation.y -= dt * 0.5;
            }
        }
        if (this.extract.visual && this.extract.visual.isEnabled && this.extract.visual.isEnabled()) {
            this.place(this.extract.visual, this.extract.x, this.extract.y, 2);
            if (this.extract.beam) {
                this.place(this.extract.beam, this.extract.x, this.extract.y, 90);
                const pulse = 1 + Math.sin(this.time * (this.extractState === 'boarding' ? 7 : 3)) * 0.035;
                this.extract.visual.scaling.setAll(pulse);
                this.extract.beam.scaling.x = this.extract.beam.scaling.z = pulse;
                this.extract.beam.rotation.y += dt * 0.25;
            }
        }
        if (this.metroExtract && this.metroExtract.visual && this.metroExtract.visual.isEnabled && this.metroExtract.visual.isEnabled()) {
            this.place(this.metroExtract.visual, this.metroExtract.x, this.metroExtract.y, 2);
            if (this.metroExtract.beam) {
                this.place(this.metroExtract.beam, this.metroExtract.x, this.metroExtract.y, 90);
                const pulse = 1 + Math.sin(this.time * (this.metroExtract.state === 'boarding' ? 7 : 3)) * 0.035;
                this.metroExtract.visual.scaling.setAll(pulse);
                this.metroExtract.beam.scaling.x = this.metroExtract.beam.scaling.z = pulse;
                this.metroExtract.beam.rotation.y += dt * 0.25;
            }
        }
        const transport = this.extract?.transport;
        if (transport) {
            if (this.extractState === 'inbound' || this.extractState === 'boarding') {
                transport.setEnabled(true);
                const progress = this.extractState === 'boarding' ? 1 : 1 - this.inboundTimer / this.c.inboundSec;
                const approach = Math.max(0, Math.min(1, progress));
                const tx = this.extract.x + (1 - approach) * 700;
                const ty = this.extract.y + (1 - approach) * 480;
                // Descend smoothly to ground touchdown height 25 (skids resting firmly on terrain)
                const baseH = terrain ? terrain.heightAt(this.extract.x, this.extract.y) : 0;
                const height = 25 + (1 - approach) * 360 + (approach < 1 ? Math.sin(this.time * 2.2) * 2 * (1 - approach) : 0);
                transport.position.set(tx, baseH + height, ty);
                transport.rotation.y = -2.15 + (1 - approach) * 0.4 + Math.sin(this.time * 0.7) * 0.02;

                // Deploy rear boarding ramp when touching down
                if (this.extract.ramp) {
                    const rampDeploy = approach >= 0.92 ? Math.min(1, (approach - 0.92) / 0.08) : 0;
                    this.extract.ramp.rotation.x = rampDeploy * 0.42;
                    this.extract.ramp.position.y = -16 - rampDeploy * 10;
                    this.extract.ramp.position.z = 110 + rampDeploy * 24;
                }

                // Ground thruster dust kickup during descent
                if (approach > 0.85 && approach < 1.0 && Math.random() < 0.35 && this.effects) {
                    const side = Math.random() < 0.5 ? -1 : 1;
                    const dustX = tx + side * 85 + (Math.random() - 0.5) * 40;
                    const dustY = ty + (Math.random() - 0.5) * 40;
                    const dustH = terrain ? terrain.heightAt(dustX, dustY) : 0;
                    const p = BABYLON.MeshBuilder.CreateLines('thruster-dust', {
                        points: [
                            new BABYLON.Vector3(dustX, dustH + 1, dustY),
                            new BABYLON.Vector3(dustX + (Math.random() - 0.5) * 35, dustH + 6 + Math.random() * 8, dustY + (Math.random() - 0.5) * 35)
                        ]
                    }, this.scene);
                    p.color = new BABYLON.Color3(0.55, 0.5, 0.42);
                    p.alpha = 0.5;
                    this.effects.push({ mesh: p, life: 0.22 });
                }
            } else transport.setEnabled(false);
        }
        const weapon = this.weapon;
        if (weapon && weapon.root) {
            const loadoutPrimary = (typeof MenuSystem !== 'undefined' && MenuSystem.loadout?.primary) ? MenuSystem.loadout.primary : null;
            const stats = (loadoutPrimary && typeof RaidRules !== 'undefined' && RaidRules.getWeaponEffectiveStats) ? RaidRules.getWeaponEffectiveStats(loadoutPrimary) : null;
            const mods = loadoutPrimary?.attachments || {};

            // Dynamic attachment mesh visibility
            if (weapon.suppressor) {
                weapon.suppressor.setEnabled(!!(mods.muzzle && mods.muzzle.id && mods.muzzle.id.includes('suppressor')));
            }
            const hasExtendedMag = !!(mods.mag && mods.mag.id && mods.mag.id.includes('extended'));
            if (weapon.extendedMag) weapon.extendedMag.setEnabled(hasExtendedMag);
            if (weapon.magStandard) weapon.magStandard.setEnabled(!hasExtendedMag);

            const hasPrism = !!(mods.optic && mods.optic.id && mods.optic.id.includes('prism'));
            if (weapon.prismScope) weapon.prismScope.setEnabled(hasPrism);
            if (weapon.opticKobraGroup) {
                for (const part of weapon.opticKobraGroup) part.setEnabled(!hasPrism);
            }

            // Dynamic camera FOV Zoom. `stats.zoom` is always a number (1 for iron sights), so the
            // old `stats && stats.zoom` test was always true and the iron-sight fallback below
            // it was unreachable: aiming with no optic produced targetFov === baseFovDeg, i.e.
            // no change at all. Iron sights now narrow to the authored GAME_ADS_FOV_DEG, and an
            // optic magnifies by its own zoom factor instead.
            const baseFovDeg = typeof CAMERA_FOV_DEG !== 'undefined' ? CAMERA_FOV_DEG : 52;
            const opticZoom = (stats && Number(stats.zoom) > 1) ? Number(stats.zoom) : 0;
            const adsFovDeg = typeof GAME_ADS_FOV_DEG !== 'undefined' ? GAME_ADS_FOV_DEG : 38;
            const zoom = this.aiming ? (opticZoom > 1 ? opticZoom : baseFovDeg / Math.max(1, adsFovDeg)) : 1.0;
            const targetFov = (baseFovDeg / zoom) * Math.PI / 180;
            if (this.app?.location?.view?.camera) {
                this.app.location.view.camera.fov += (targetFov - this.app.location.view.camera.fov) * (1 - Math.exp(-14 * dt));
            }

            weapon.recoil *= Math.exp(-22 * dt);
            weapon.recoilRotX = (weapon.recoilRotX || 0) * Math.exp(-24 * dt);
            weapon.recoilRotZ = (weapon.recoilRotZ || 0) * Math.exp(-22 * dt);
            this.weaponSpreadBloom = Math.max(0, (this.weaponSpreadBloom || 0) - 3.5 * dt);

            // ADS transition with attachment speed modifier
            const adsSpeed = 20 / (stats ? stats.adsTimeMult : 1.0);
            this.adsAmount = (this.adsAmount || 0) + ((this.aiming ? 1 : 0) - (this.adsAmount || 0)) * (1 - Math.exp(-adsSpeed * dt));
            const a = this.adsAmount;

            // Mouse look sway (lagging weapon motion relative to camera angular velocity)
            const camAz = this.app?.camera?.azimuth || 0;
            const camPi = this.app?.camera?.pitch || 0;
            if (this._lastCamAz === undefined) { this._lastCamAz = camAz; this._lastCamPi = camPi; }
            let dAz = camAz - this._lastCamAz;
            while (dAz > Math.PI) dAz -= Math.PI * 2;
            while (dAz < -Math.PI) dAz += Math.PI * 2;
            const dPi = camPi - this._lastCamPi;
            this._lastCamAz = camAz;
            this._lastCamPi = camPi;

            const swayFactor = stats ? stats.swayMult : 1.0;
            const targetSwayX = Math.max(-0.6, Math.min(0.6, -dAz * 8.0 * swayFactor));
            const targetSwayY = Math.max(-0.6, Math.min(0.6, dPi * 8.0 * swayFactor));
            weapon.swayX = (weapon.swayX || 0) + (targetSwayX - (weapon.swayX || 0)) * (1 - Math.exp(-18 * dt));
            weapon.swayY = (weapon.swayY || 0) + (targetSwayY - (weapon.swayY || 0)) * (1 - Math.exp(-18 * dt));

            // Tactical sprint pose (lowering weapon across chest when sprinting)
            const isSprinting = weapon.sprinting && !this.aiming;
            this.sprintPose = (this.sprintPose || 0) + ((isSprinting ? 1 : 0) - (this.sprintPose || 0)) * (1 - Math.exp(-12 * dt));
            const sp = this.sprintPose;

            const bobAmount = weapon.moving ? 1 : 0;
            if (weapon.moving) weapon.bob += dt * (weapon.sprinting ? 11.5 : 8.5);

            const swayDamp = 1 - a * 0.85;
            // Hip position vs ADS position
            const hipX = 10;
            const hipY = -11;
            const adsX = 0;
            const adsY = -5.95;

            const posX = (hipX * (1 - a) + adsX * a)
                + Math.sin(weapon.bob) * 0.3 * bobAmount * (1 - a * 0.85)
                + (weapon.swayX || 0) * swayDamp
                - 2.5 * sp * (1 - a);

            const posY = (hipY * (1 - a) + adsY * a)
                + Math.abs(Math.cos(weapon.bob)) * 0.35 * bobAmount * (1 - a * 0.85)
                + (weapon.swayY || 0) * swayDamp
                - 3.2 * sp * (1 - a);

            const posZ = -24 + weapon.recoil * 3.2 + 1.2 * sp * (1 - a);
            weapon.root.position.set(posX, posY, posZ);

            const reloadDur = this.reloadDuration || this.c.reload;
            const action = this.reloadTimer > 0 ? Math.sin((1 - this.reloadTimer / reloadDur) * Math.PI) :
                this.healTimer > 0 ? Math.sin((1 - this.healTimer / this.c.healSec) * Math.PI) :
                this.searchTimer > 0 ? 0.55 : 0;

            weapon.root.rotation.set(
                -weapon.recoil * 0.045 - (weapon.recoilRotX || 0) + action * 0.32 - 0.32 * sp * (1 - a) - (weapon.swayY || 0) * 0.08 * swayDamp,
                action * 0.18 + (weapon.swayX || 0) * 0.08 * swayDamp + 0.12 * sp * (1 - a),
                (weapon.recoilRotZ || 0) + Math.sin(weapon.bob * 0.5) * 0.008 * bobAmount * (1 - a * 0.8) + action * 0.28 - 0.42 * sp * (1 - a)
            );
            weapon.flashLife -= dt;
            if (weapon.flashLife <= 0 && weapon.flash) weapon.flash.setEnabled(false);
            if (this.muzzleLight) {
                if (this.muzzleLightLife > 0) {
                    this.muzzleLightLife -= dt;
                    if (this.muzzleLightLife <= 0) this.muzzleLight.intensity = 0;
                }
            }
        }

        // Update ejecting spent brass casings
        if (this.casings && this.casings.length > 0) {
            for (let i = this.casings.length - 1; i >= 0; i--) {
                const c = this.casings[i];
                c.life -= dt;
                if (c.life <= 0) {
                    if (c.mesh) c.mesh.dispose();
                    this.casings.splice(i, 1);
                    continue;
                }
                c.vy -= 0.15 * dt;
                c.mesh.position.x += c.vx * dt * 35;
                c.mesh.position.y += c.vy * dt * 35;
                c.mesh.position.z += c.vz * dt * 35;
                c.mesh.rotation.x += c.rx * dt;
                c.mesh.rotation.y += c.ry * dt;
                c.mesh.rotation.z += c.rz * dt;
            }
        }

        // Active 3D ballistic projectiles
        if (this.activeProjectiles && this.activeProjectiles.length > 0) {
            const livingEnemies = this.enemies ? this.enemies.filter(e => !e.dead && !e.dormant) : [];
            const activeHazards = this.hazards ? this.hazards.filter(h => !h.destroyed) : [];
            const rangeActors = (this.tacticalRange && this.tacticalRange.active && this.tacticalRange.getTargetActors)
                ? this.tacticalRange.getTargetActors()
                : [];
            const rangeBlockers = (this.tacticalRange && this.tacticalRange.active && this.tacticalRange.getCoverBlockers)
                ? this.tacticalRange.getCoverBlockers()
                : [];
            const friendlyTargets = livingEnemies.concat(activeHazards, rangeActors);
            const blockers = (this.coverBlockers || []).concat(rangeBlockers);
            const terrainFn = (x, y) => this.app?.location?.terrain ? this.app.location.terrain.heightAt(x, y) : 0;
            for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
                const item = this.activeProjectiles[i];
                const { proj, mesh, trail, hostile } = item;
                const targets = hostile ? [this.player] : friendlyTargets;
                const hit = ShooterRules.stepProjectile(
                    proj,
                    dt,
                    targets,
                    blockers,
                    terrainFn
                );

                if (hit.hit) {
                    if (hit.type === 'actor') {
                        if (hostile) {
                            this.applyPlayerDamage(hit.damage, hit.target);
                        } else if (hit.target.isDummy) {
                            this.hits++;
                            const isWeakspot = !!hit.headshot;
                            this.hitMarker = isWeakspot ? 0.28 : 0.15;
                            this.hitMarkerCrit = isWeakspot;
                            this.hitMarkerKill = false;
                            this.playSound(this.audio?.hit, isWeakspot ? 0.5 : 0.28, 0.06);
                            if (isWeakspot) {
                                this.impactHeadshot(hit.point);
                            }
                            if (this.tacticalRange && this.tacticalRange.onTargetHit) {
                                this.tacticalRange.onTargetHit(hit.target, hit);
                            }
                        } else if (hit.target.type === 'fuel_barrel' || hit.target.type === 'emp_junction') {
                            const hazard = hit.target;
                            hazard.hp -= hit.damage;
                            this.hits++;
                            this.hitMarker = 0.15;
                            this.playSound(this.audio?.hit, 0.28);
                            if (hazard.hp <= 0) {
                                if (hazard.type === 'fuel_barrel') this.triggerBarrelExplosion(hazard);
                                else if (hazard.type === 'emp_junction') this.triggerEmpDischarge(hazard);
                            }
                        } else {
                            this.hits++;
                            const enemy = hit.target;
                            let finalDamage = hit.damage;
                            let isWeakspot = !!hit.headshot;
                            let isFrontArmor = false;

                            // Every armoured ARC machine has an authored weak spot on its back and, where the
            // model has one, a front plate. Only the Sentinel was wired up, so the Stalker's
            // rear cooling spine (1.75x) and the Bombard's rear vent (2x) did nothing at all.
                            const zoneCheck = enemy.archetype === 'sentinel' ? RaidRules?.checkSentinelHitZone
                                : enemy.archetype === 'stalker' ? RaidRules?.checkStalkerHitZone
                                : enemy.archetype === 'bombard' ? RaidRules?.checkBombardHitZone
                                : null;
                            if (zoneCheck) {
                                const zone = zoneCheck(hit.point, enemy);
                                if (zone.isWeakspot) {
                                    finalDamage = Math.round(hit.damage * zone.multiplier);
                                    isWeakspot = true;
                                } else if (zone.isFrontArmor) {
                                    finalDamage = Math.max(1, Math.round(hit.damage * zone.multiplier));
                                    isFrontArmor = true;
                                }
                            }

                            enemy.hp -= finalDamage;
                            enemy.hitFlash = 0.15;
                            enemy.stagger = isFrontArmor ? 0.06 : 0.28;
                            enemy.cover = null;
                            enemy.state = enemy.hp < enemy.maxHp * 0.35 ? 'retreat' : 'engage';
                            enemy.alert = 1;
                            enemy.lastX = this.player.x; enemy.lastY = this.player.y;
                            this.hitMarker = isWeakspot ? 0.28 : (enemy.hp <= 0 ? 0.22 : 0.12);
                            this.hitMarkerCrit = isWeakspot;
                            this.hitMarkerKill = enemy.hp <= 0;
                            this.playSound(this.audio?.hit, isWeakspot ? 0.5 : (enemy.hp <= 0 ? 0.42 : 0.26), 0.06);
                            if (isWeakspot) {
                                this.impactHeadshot(hit.point);
                            }
                            if (isFrontArmor) {
                                this.impactBlocker(hit.point, hit.normal);
                            }
                            if (enemy.hp <= 0) this.killEnemy(enemy);
                        }
                    } else if (hit.type === 'blocker') {
                        this.impactBlocker(hit.point, hit.normal);
                    } else if (hit.type === 'terrain') {
                        this.impactTerrain(hit.point);
                    }
                    if (this.tacticalRange && this.tacticalRange.active) {
                        this.tacticalRange.recordShotTelemetry(hit, 64 - proj.h, proj.speed);
                    }
                    if (trail && trail.dispose) trail.dispose();
                    if (mesh && mesh.dispose) mesh.dispose();
                    this.activeProjectiles.splice(i, 1);
                } else if (hit.expired) {
                    if (trail && trail.dispose) trail.dispose();
                    if (mesh && mesh.dispose) mesh.dispose();
                    this.activeProjectiles.splice(i, 1);
                } else {
                    if (mesh) {
                        mesh.position.set(proj.x, proj.h, proj.y);
                        const velB = new BABYLON.Vector3(proj.vx, proj.vh, proj.vy);
                        const spd = velB.length();
                        if (spd > 1e-6) {
                            velB.scaleInPlace(1 / spd);
                            mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
                            BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Axis.Y, velB, mesh.rotationQuaternion);
                        }
                    }
                }
            }
        }
        if (this.tacticalRange && this.tacticalRange.active) {
            this.tacticalRange.update(dt);
        }

        for (let i = this.effects.length - 1; i >= 0; i--) {
            const e = this.effects[i];
            e.life -= dt;
            // Effects that need to know how far through they are get the remaining and total
            // life. Passing only dt left `remaining`/`total` undefined, so the mortar's
            // `1 - remaining/total` was NaN and its `remaining <= fxDt` terminal branch could
            // never fire — Bombard shells flew and then vanished without ever exploding.
            if (e.update) e.update(dt, e.life, e.totalLife != null ? e.totalLife : Math.max(e.life, 1e-6));
            if (e.life <= 0) {
                e.mesh.dispose();
                if (e.material) e.material.dispose();
                this.effects.splice(i, 1);
            }
        }
    }

    dispose() {
        if (typeof OnlineBridge !== 'undefined') OnlineBridge.detach();
        if (typeof MenuSystem !== 'undefined' && MenuSystem.dispose) MenuSystem.dispose();
        if (this.activeProjectiles) {
            for (const p of this.activeProjectiles) { if (p.mesh && p.mesh.dispose) p.mesh.dispose(); }
            this.activeProjectiles = [];
        }
        window.removeEventListener('keydown', this._bound.down);
        window.removeEventListener('keyup', this._bound.up);
        window.removeEventListener('blur', this._bound.blur);
        document.removeEventListener('mousemove', this._bound.mouseMove);
        document.removeEventListener('mouseup', this._bound.mouseUp);
        document.removeEventListener('pointerlockchange', this._bound.lock);
        this.canvas.removeEventListener('mousedown', this._bound.mouseDown);
        this.canvas.removeEventListener('touchstart', this._bound.touchStart);
        this.canvas.removeEventListener('touchmove', this._bound.touchMove);
        this.canvas.removeEventListener('touchend', this._bound.touchEnd);
        this.app.camera.setFirstPerson(null);
        this.app.camera.setMovementEnabled(true);
        if (this.audio) {
            if (typeof this.audio.dispose === 'function') this.audio.dispose();
            else if (this.audio.ambience) {
                if (typeof this.audio.ambience.stop === 'function') this.audio.ambience.stop();
                else if (typeof this.audio.ambience.pause === 'function') { this.audio.ambience.pause(); this.audio.ambience.src = ''; }
            }
        }
        if (this.tacticalMap && this.tacticalMap.close) this.tacticalMap.close();
        if (this.raidInventory && this.raidInventory.close) this.raidInventory.close();
        // The debug range owns its own DOM panel and meshes; without this it survived into the
        // next raid and its full-width panel kept stealing clicks from the canvas.
        if (this.tacticalRange && this.tacticalRange.active && this.tacticalRange.deactivate) this.tacticalRange.deactivate();
        if (typeof document !== 'undefined' && document.getElementById) {
            ['arc-compass-wrap', 'arc-hud-mission-banner', 'arc-tactical-vitals', 'arc-tactical-weapon-card', 'arc-interact-prompt-box', 'arc-spectator-banner', 'arc-downed-banner'].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.parentNode) el.parentNode.removeChild(el);
            });
            this._tacticalHudInitialized = false;
        }
        if (this.weatherSystem && typeof this.weatherSystem.dispose === 'function') this.weatherSystem.dispose();
        if (this.ssao) this.ssao.dispose();
        if (this.glow) this.glow.dispose();
        if (this.pipeline) this.pipeline.dispose();
        if (this.weapon && this.weapon.root) this.weapon.root.dispose(false, true);
        for (const mesh of this.industrialModels) Model3D.dispose(this.app.location.view, mesh);
        this.industrialModels = [];
    }

    buyArmor() {
        if (this.phase === 'raid' || this.profile.armorLevel >= 3 || this.profile.credits < 250) return;
        this.profile.credits -= 250;
        this.profile.armorLevel++;
        Store.set('arcengine.raider.profile', JSON.stringify(this.profile));
        this.updateHud(true);
    }

    buyUpgrade(type) {
        if (this.phase === 'raid') return;
        const bought = ShooterRules.purchaseUpgrade(this.profile, type, 200, 3);
        if (!bought.ok) return;
        this.profile = Object.assign(bought.meta, { armorLevel: this.profile.armorLevel });
        Store.set('arcengine.raider.profile', JSON.stringify(this.profile));
        this.updateHud(true);
    }

    finish(won) {
        if (this.phase !== 'raid') return;
        if (typeof OnlineBridge !== 'undefined') {
            OnlineBridge.spectating = false;
            OnlineBridge.spectateTargetId = null;
        }
        if (this.weapon && this.weapon.root) {
            this.weapon.root.setEnabled(true);
        }
        if (this.app?.camera) {
            this.app.camera.follow(null);
        }
        this.phase = won ? 'won' : 'lost';
        this.firing = false;
        this.aiming = false;
        this.reloadTimer = 0;
        this.healTimer = 0;
        this.cancelSearch();
        if (this.tacticalMap && this.tacticalMap.close) this.tacticalMap.close();
        if (this.raidInventory && this.raidInventory.close) this.raidInventory.close();
        if (this.tacticalRange && this.tacticalRange.active && this.tacticalRange.deactivate) this.tacticalRange.deactivate();
        this.updateTacticalHud(false);
        this.profile.raids++;
        this.profile.kills += this.kills;
        const safePocket = (typeof MenuSystem !== 'undefined' && Array.isArray(MenuSystem.loadout?.safePocket)) ? MenuSystem.loadout.safePocket : [];
        const loadoutObj = typeof MenuSystem !== 'undefined' ? MenuSystem.loadout : {};
        const settlement = (typeof RaidRules !== 'undefined' && RaidRules.resolveRaidSettlement) ?
            RaidRules.resolveRaidSettlement(won, loadoutObj, this.backpack, safePocket) : null;
        if (settlement) {
            settlement.sentinelKilled = !!(this.sessionKills?.sentinel > 0);
            settlement.spotterKilled = !!(this.sessionKills?.spotter > 0);
            settlement.kills = this.kills;
            settlement.drives = this.loot;
            settlement.hpPercent = this.player?.maxHp ? Math.round((this.player.hp / this.player.maxHp) * 100) : 100;
            settlement.weight = this.totalWeight;
        }

        // ONLINE THE SERVER ALREADY PAID. Adding the local estimate on top would double the
        // reward and credit a number the client invented. The wallet shown is the one the
        // server pushed; offline nothing changes.
        const onlineSettled = !!(typeof OnlineBridge !== 'undefined' && OnlineBridge.active() && this.onlinePayout);
        if (won) {
            this.profile.extractions++;
            if (!onlineSettled) this.profile.credits += this.raidValue;
            this.profile.bestValue = Math.max(this.profile.bestValue, this.raidValue);
            this.profile.streak++;
        } else {
            this.profile.streak = 0;
            this.backpack = [];
            this.raidValue = settlement ? settlement.extractedValue : 0;
        }
        Store.set('arcengine.raider.profile', JSON.stringify(this.profile));
        Store.set('arcengine.raider.raid', String(ShooterRules.metaInteger((this.seed - 7419) + 1)));
        if (typeof MenuSystem !== 'undefined' && MenuSystem.finishRaid) {
            MenuSystem.finishRaid(settlement || { won, savedLoot: won ? this.backpack : safePocket });
        }
        if (document.exitPointerLock && document.pointerLockElement === this.canvas) document.exitPointerLock();
        this.updateMobileControls();
        if (won && typeof MenuSystem !== 'undefined' && MenuSystem.currentScreen === 'RETURN') return;
        if (typeof UI !== 'undefined' && UI.get) {
            const result = UI.get('result');
            const panel = UI.get('resultPanel');
            const restart = UI.get('restart');
            if (panel) panel.show(true);
            if (restart) restart.setText(this.text('ЗАНОВО', 'RESTART')).show(true);
            for (const id of ['buyAmmo', 'buyMedkit', 'buyArmor']) { const el = UI.get(id); if (el) el.show(true); }
            const mc = UI.get('metaCredits'); if (mc) mc.show(false);
            const car = UI.get('career'); if (car) car.show(false);
            if (result) {
                result.show(true);
                const accuracy = this.shots ? Math.round(this.hits / this.shots * 100) : 0;
                const safeNotice = (!won && settlement && settlement.safePocketProtectedCount > 0) ?
                    '\n' + this.text(`[SAFE POCKET]: ${settlement.safePocketProtectedCount} ценных предмета сохранены на склад!`, `[SAFE POCKET]: ${settlement.safePocketProtectedCount} item(s) preserved to stash!`) :
                    (won ? '\n' + this.text(`[ДОБЫЧА]: ${this.backpack.length} предметов успешно вывезено в Сперанцу`, `[LOOT]: ${this.backpack.length} items successfully extracted to Speranza`) : '');

                result.setText((won
                    ? this.text('ЭВАКУАЦИЯ УСПЕШНА', 'EXTRACTION SUCCESSFUL')
                    : this.text('ОПЕРАТОР ПОТЕРЯН', 'OPERATOR LOST')) + '\n' +
                    this.text('Ценность ', 'Value ') + this.raidValue + '  ·  ' +
                    this.text('Уничтожено ', 'Destroyed ') + this.kills + '  ·  ' +
                    this.text('Точность ', 'Accuracy ') + accuracy + '%\n' +
                    this.text('Рейды ', 'Raids ') + this.profile.raids + '  ·  ' +
                    this.text('Эвакуации ', 'Extractions ') + this.profile.extractions + '  ·  ' +
                    this.text('Серия ', 'Streak ') + this.profile.streak + safeNotice);
            }
        }
    }

    hideResult() {
        for (const id of ['resultPanel', 'result', 'restart', 'metaCredits', 'career', 'buyAmmo', 'buyMedkit', 'buyArmor']) { const el = UI.get(id); if (el) el.show(false); }
    }

    updateHud(force) {
        if (typeof MenuSystem !== 'undefined' && MenuSystem.currentScreen !== 'IN_RAID') return;
        if (!force && this._hudElapsed < 0.08) return;
        this._hudElapsed = 0;
        const isRaid = this.phase === 'raid';

        const hudSuppressed = !isRaid ||
            (this.raidInventory && this.raidInventory.visible) ||
            (this.tacticalMap && this.tacticalMap.visible) ||
            (typeof ControlsMenu !== 'undefined' && ControlsMenu.isOpen()) ||
            this.paused;

        const hasTacticalHud = typeof document !== 'undefined' && !!document.getElementById('arc-hud-mission-banner');
        const showLegacyRaidHud = isRaid && !hudSuppressed && !hasTacticalHud;

        const damage = UI.get('damageFlash'); if (damage) damage.show(!hudSuppressed && this.damageFlash > 0);
        const direction = UI.get('damageDirection'); if (direction) {
            direction.show(!hudSuppressed && this.damageFlash > 0);
            const a = Math.atan2(Math.sin(this.damageDirection), Math.cos(this.damageDirection));
            direction.setText(Math.abs(a) < Math.PI / 4 ? '▲' : Math.abs(a) > Math.PI * 3 / 4 ? '▼' : a > 0 ? '▶' : '◀');
        }
        const marker = UI.get('hitMarker');
        if (marker) {
            marker.show(!hudSuppressed && this.hitMarker > 0);
            marker.setText(this.hitMarkerCrit ? '<span style="color:#ff3344;font-size:28px">✦</span>'
                : this.hitMarkerKill ? '<span style="color:#e63946;font-size:24px">✕</span>'
                : '<span style="color:#ffffff;font-size:20px">✕</span>');
        }
        const useItemBar = UI.get('useItemBar');
        if (useItemBar) {
            useItemBar.show(!hudSuppressed && this.useItemTimer > 0);
            if (this.useItemTimer > 0 && this.useItemDuration > 0) {
                useItemBar.setValue(1 - this.useItemTimer / this.useItemDuration);
            }
        }
        const value = UI.get('lootValue'); if (value) value.setText(this.text('ЦЕННОСТЬ ', 'VALUE ') + this.raidValue).show(showLegacyRaidHud);
        // Counted in the same unit as the capacity: loot carried out of THIS raid. The
        // padded grid length is not a count of anything the player did.
        const inventory = UI.get('inventory');
        if (inventory) {
            inventory.setText(this.text('РЮКЗАК ', 'BACKPACK ') + this.lootedItems() + ' / ' + this.lootCapacity()).show(showLegacyRaidHud);
        }
        const topShade = UI.get('topShade'); if (topShade) topShade.show(showLegacyRaidHud);
        const isSpectating = typeof OnlineBridge !== 'undefined' && OnlineBridge.spectating;
        const crosshair = UI.get('crosshair');
        if (crosshair) {
            crosshair.show(isRaid && !hudSuppressed && !this.aiming && !isSpectating);
            if ((this.weaponSpreadBloom || 0) > 0.02) {
                crosshair.setText('⟨ · ⟩');
            } else {
                crosshair.setText('·');
            }
        }
        const lootFeed = UI.get('lootFeed'); if (lootFeed) { lootFeed.show(!hudSuppressed && this.lootFeedTimer > 0); lootFeed.setText(this.lootFeedText); }
        const reload = UI.get('reload'); if (reload) { reload.show(!hudSuppressed && this.reloadTimer > 0); reload.setValue(this.reloadTimer > 0 ? 1 - this.reloadTimer / this.c.reload : 0); }
        const heal = UI.get('heal'); if (heal) { heal.show(!hudSuppressed && this.healTimer > 0); heal.setValue(this.healTimer > 0 ? 1 - this.healTimer / this.c.healSec : 0); }
        const search = UI.get('search'); if (search) { search.show(!hudSuppressed && this.searchTimer > 0); search.setValue(this.searchTimer > 0 ? 1 - this.searchTimer / this.c.searchSec : 0); }
        const loot = UI.get('loot'); if (loot) loot.setText(this.text('ДАННЫЕ ', 'DATA ') + this.loot + ' / ' + this.c.lootTarget).show(showLegacyRaidHud);
        const objective = UI.get('objective');
        if (objective) {
            objective.setText(this.text('Эвакуация доступна (Сектор A и B) | Накопители: ' + this.loot + '/' + this.c.lootTarget,
                                        'Extraction available (Zone A & B) | Data drives: ' + this.loot + '/' + this.c.lootTarget)).show(showLegacyRaidHud);
        }
        const extract = UI.get('extract'); if (extract) { extract.show(!hudSuppressed && this.extractState === 'boarding'); extract.setValue(this.extractProgress / this.c.extractSec); }
        const inbound = UI.get('extractInbound'); if (inbound) { inbound.show(!hudSuppressed && this.extractState === 'inbound'); inbound.setValue(this.inboundTimer > 0 ? 1 - this.inboundTimer / this.c.inboundSec : 0); }

        const barrageEl = UI.get('barrageWarning');
        if (barrageEl) {
            const warn = isRaid && !hudSuppressed && (this.raidTimer <= 60 || this.barrageActive);
            barrageEl.show(warn);
            if (warn) {
                barrageEl.setText(this.barrageActive
                    ? this.text('⚠ СМЕРТЕЛЬНЫЙ ОБСТРЕЛ ПОВЕРХНОСТИ ⚠', '⚠ LETHAL SURFACE BARRAGE ⚠')
                    : this.text('⚠ ВНИМАНИЕ: ОРБИТАЛЬНЫЙ ОБСТРЕЛ ЧЕРЕЗ ' + Math.ceil(this.raidTimer) + 'С ⚠', '⚠ WARNING: ORBITAL BARRAGE IN ' + Math.ceil(this.raidTimer) + 'S ⚠'));
            }
        }

        // Silent Raider Bunker Hatch HUD
        const hatchProgressEl = UI.get('hatchProgress');
        if (this.hatchExtract && isRaid && !hudSuppressed) {
            const inHatchZone = ShooterRules.distanceSq(this.player, this.hatchExtract) <= this.hatchExtract.radius ** 2;
            if (hatchProgressEl) {
                hatchProgressEl.show(inHatchZone && (this.hatchProgress || 0) > 0);
                hatchProgressEl.setValue((this.hatchProgress || 0) / this.c.hatchHoldSec);
            }
        } else {
            if (hatchProgressEl) hatchProgressEl.show(false);
        }
        const credits = UI.get('metaCredits'); if (credits) credits.setText(this.text('КРЕДИТЫ ', 'CREDITS ') + this.profile.credits);
        const career = UI.get('career'); if (career) career.setText(this.text('РЕЙДЫ ', 'RAIDS ') + this.profile.raids + ' · ' + this.text('ЭВАК. ', 'EXTRACTS ') + this.profile.extractions + ' · ' + this.text('СЕРИЯ ', 'STREAK ') + this.profile.streak);
        const buyAmmo = UI.get('buyAmmo'); if (buyAmmo) buyAmmo.setText(this.profile.ammoLevel >= 3 ? this.text('БОЕЗАПАС: МАКС', 'AMMO: MAX') : this.text('БОЕЗАПАС +20 — 200', 'AMMO +20 — 200'));
        const buyMedkit = UI.get('buyMedkit'); if (buyMedkit) buyMedkit.setText(this.profile.medkitLevel >= 3 ? this.text('АПТЕЧКИ: МАКС', 'MEDKITS: MAX') : this.text('АПТЕЧКА +1 — 200', 'MEDKIT +1 — 200'));
        const buyArmor = UI.get('buyArmor'); if (buyArmor) buyArmor.setText(this.profile.armorLevel >= 3 ? this.text('БРОНЯ: МАКС', 'ARMOR: MAX') : this.text('БРОНЯ +5 HP — 250', 'ARMOR +5 HP — 250'));
        const quality = UI.get('quality'); if (quality) quality.setText(this.text('КАЧЕСТВО: ', 'QUALITY: ') + [this.text('НИЗКОЕ','LOW'), this.text('СРЕДНЕЕ','MEDIUM'), this.text('ВЫСОКОЕ','HIGH')][this.settings.quality]);
        const sensitivity = UI.get('sensitivity'); if (sensitivity) sensitivity.setText(this.text('ЧУВСТВИТЕЛЬНОСТЬ: ', 'SENSITIVITY: ') + this.settings.sensitivity.toFixed(2));
        const settingsTitle = UI.get('settingsTitle'); if (settingsTitle) settingsTitle.setText(this.text('ПАУЗА', 'PAUSED'));
        const controlsBtn = UI.get('controlsBtn'); if (controlsBtn) controlsBtn.setText(this.text('УПРАВЛЕНИЕ', 'CONTROLS'));
        const resume = UI.get('resume'); if (resume) resume.setText(this.text('ПРОДОЛЖИТЬ', 'RESUME'));
        const surrender = UI.get('surrender'); if (surrender) surrender.setText(this.text('СДАТЬСЯ (ПОКИНУТЬ РЕЙД)', 'SURRENDER (ABANDON RAID)'));
        this.updateTacticalHud(isRaid);
    }

    initTacticalHudDOM() {
        if (typeof document === 'undefined' || !document.createElement) return;
        if (this._tacticalHudInitialized) return;
        this._tacticalHudInitialized = true;

        // Tactical HUD uses viewport pixels. Nesting it in the transformed 1280x720
        // UI root made every element oversized on a 1080p desktop display.
        const parent = document.body;

        // 1. Compass ribbon
        if (!document.getElementById('arc-compass-wrap')) {
            const compassWrap = document.createElement('div');
            compassWrap.id = 'arc-compass-wrap';
            compassWrap.className = 'arc-compass-ribbon-wrap';
            compassWrap.innerHTML = `
                <canvas id="arc-compass-canvas" class="arc-compass-ribbon-canvas" width="420" height="24"></canvas>
                <div class="arc-compass-center-notch"></div>
            `;
            parent.appendChild(compassWrap);
        }

        // 2. Mission status banner
        if (!document.getElementById('arc-hud-mission-banner')) {
            const banner = document.createElement('div');
            banner.id = 'arc-hud-mission-banner';
            banner.className = 'arc-hud-mission-banner';
            banner.innerHTML = `
                <div class="arc-hud-status-timer" id="arc-tactical-timer">20:00</div>
                <div class="arc-hud-status-title" id="arc-tactical-status-title">СЕКТОР 01 // CALIDUM</div>
                <div class="arc-hud-status-sub" id="arc-tactical-status-sub">ЭВАКУАЦИЯ ДОСТУПНА</div>
                <div class="arc-hud-drives-tracker" id="arc-tactical-drives">ДАННЫЕ: 0/3 [□□□]</div>
            `;
            parent.appendChild(banner);
        }

        // 3. Tactical Vitals (health, shield, stamina, load, quickslots)
        if (!document.getElementById('arc-tactical-vitals')) {
            const vitals = document.createElement('div');
            vitals.id = 'arc-tactical-vitals';
            vitals.className = 'arc-tactical-vitals';
            vitals.innerHTML = `
                <div class="arc-vitals-callsign" id="arc-vitals-callsign">РАЙДЕР // ОПЕРАТИВНИК</div>
                <div class="arc-shield-bar-wrap" title="Защитный щит">
                    <div class="arc-shield-bar-fill" id="arc-tactical-shield-fill" style="width: 100%;"></div>
                </div>
                <div class="arc-health-bar-wrap" title="Здоровье">
                    <div class="arc-health-bar-fill" id="arc-tactical-health-fill" style="width: 100%;"></div>
                </div>
                <div class="arc-vitals-meta">
                    <span id="arc-tactical-shield-num">ЩИТ 100/100</span>
                    <span id="arc-tactical-hp-num">HP 100/100</span>
                    <span id="arc-tactical-weight">18.5 KG</span>
                </div>
                <div class="arc-hud-quickslots" id="arc-hud-quickslots">
                    <div class="arc-quick-pill" id="arc-quick-0"><span class="k">1</span><span class="v" id="arc-quick-val-0">—</span></div>
                    <div class="arc-quick-pill" id="arc-quick-1"><span class="k">2</span><span class="v" id="arc-quick-val-1">—</span></div>
                    <div class="arc-quick-pill" id="arc-quick-2"><span class="k">3</span><span class="v" id="arc-quick-val-2">—</span></div>
                    <div class="arc-quick-pill" id="arc-quick-3"><span class="k">4</span><span class="v" id="arc-quick-val-3">—</span></div>
                </div>
            `;
            parent.appendChild(vitals);
        }

        // 4. Tactical Weapon Card
        if (!document.getElementById('arc-tactical-weapon-card')) {
            const wepCard = document.createElement('div');
            wepCard.id = 'arc-tactical-weapon-card';
            wepCard.className = 'arc-tactical-weapon-card';
            wepCard.innerHTML = `
                <div class="arc-wep-title" id="arc-tactical-wep-title">RUBEZH-76</div>
                <div class="arc-wep-mode-badge" id="arc-tactical-wep-mode">АВТО · 7.62x39</div>
                <div style="display:flex;align-items:baseline;gap:4px;">
                    <span class="arc-wep-ammo-large" id="arc-tactical-ammo-cur">30</span>
                    <span class="arc-wep-ammo-reserve" id="arc-tactical-ammo-res">/ 120</span>
                </div>
                <div class="arc-wep-sockets" id="arc-tactical-wep-sockets">
                    <span class="arc-wep-socket" id="arc-sock-optic">OPT</span>
                    <span class="arc-wep-socket" id="arc-sock-muzzle">MUZ</span>
                    <span class="arc-wep-socket" id="arc-sock-mag">MAG</span>
                    <span class="arc-wep-socket" id="arc-sock-stock">STK</span>
                </div>
                <div class="arc-wep-hotkeys-strip" id="arc-tactical-hotkeys-strip">
                    <span id="arc-hotkey-map"><strong>M</strong> КАРТА</span>
                    <span id="arc-hotkey-inv"><strong>TAB</strong> РЮКЗАК</span>
                    <span id="arc-hotkey-slots"><strong>1-4</strong> СЛОТЫ</span>
                </div>
            `;
            parent.appendChild(wepCard);
        }

        // 5. Contextual Interact Prompt
        if (!document.getElementById('arc-interact-prompt-box')) {
            const promptBox = document.createElement('div');
            promptBox.id = 'arc-interact-prompt-box';
            promptBox.className = 'arc-interact-prompt-box';
            promptBox.style.display = 'none';
            promptBox.innerHTML = `
                <span class="arc-prompt-key" id="arc-tactical-prompt-key">F</span>
                <span class="arc-prompt-text" id="arc-tactical-prompt-text">ДЕЙСТВИЕ</span>
            `;
            parent.appendChild(promptBox);
        }

        // 6. Spectator Mode Banner
        if (!document.getElementById('arc-spectator-banner')) {
            const specBanner = document.createElement('div');
            specBanner.id = 'arc-spectator-banner';
            specBanner.className = 'arc-spectator-banner';
            specBanner.style.display = 'none';
            specBanner.innerHTML = `
                <div class="arc-spec-badge">РЕЖИМ НАБЛЮДЕНИЯ // SPECTATING</div>
                <div class="arc-spec-target-name" id="arc-spec-name">БОЕЦ: RAIDER_BETA</div>
                <div class="arc-spec-target-stats" id="arc-spec-stats">HP 100/100 · ЩИТ 50/50</div>
                <div class="arc-spec-controls-hint">◄ [ЛКМ / Q] ПРЕДЫДУЩИЙ · [ПКМ / E] СЛЕДУЮЩИЙ ►</div>
            `;
            parent.appendChild(specBanner);
        }

        // 7. DBNO Downed Banner
        if (!document.getElementById('arc-downed-banner')) {
            const downedBanner = document.createElement('div');
            downedBanner.id = 'arc-downed-banner';
            downedBanner.className = 'arc-downed-banner';
            downedBanner.style.display = 'none';
            downedBanner.innerHTML = `
                <div class="arc-downed-badge">⚠ КРИТИЧЕСКОЕ РАНЕНИЕ // DBNO</div>
                <div class="arc-downed-timer" id="arc-downed-timer">ИСТЕЧЕНИЕ КРОВИ: 60с</div>
                <div class="arc-downed-hint">ПОЛЗИТЕ К УКРЫТИЮ · ОЖИДАЙТЕ ПОМОЩИ СОЮЗНИКА</div>
            `;
            parent.appendChild(downedBanner);
        }

        // 8. In-raid Pause Controls Button
        if (!document.getElementById('arc-pause-controls-btn')) {
            const pauseBtn = document.createElement('button');
            pauseBtn.id = 'arc-pause-controls-btn';
            pauseBtn.className = 'arc-pause-controls-btn';
            pauseBtn.style.display = 'none';
            pauseBtn.textContent = 'НАСТРОЙКИ УПРАВЛЕНИЯ';
            pauseBtn.onclick = () => {
                if (typeof ControlsMenu !== 'undefined') ControlsMenu.open(this);
            };
            parent.appendChild(pauseBtn);
        }

        // 9. Pause FPS Overlay Toggle Button
        if (!document.getElementById('arc-pause-fps-btn')) {
            const fpsBtn = document.createElement('button');
            fpsBtn.id = 'arc-pause-fps-btn';
            fpsBtn.className = 'arc-pause-controls-btn';
            fpsBtn.style.display = 'none';
            fpsBtn.style.right = '240px';
            fpsBtn.textContent = 'FPS: [ВКЛ] (F3)';
            fpsBtn.onclick = () => {
                if (typeof ArcPerformanceOverlay !== 'undefined') {
                    const v = ArcPerformanceOverlay.toggle();
                    fpsBtn.textContent = `FPS: [${v ? 'ВКЛ' : 'ВЫКЛ'}] (F3)`;
                }
            };
            parent.appendChild(fpsBtn);
        }

        // 10. Pause DLSS Mode Button
        if (!document.getElementById('arc-pause-dlss-btn')) {
            const dlssBtn = document.createElement('button');
            dlssBtn.id = 'arc-pause-dlss-btn';
            dlssBtn.className = 'arc-pause-controls-btn';
            dlssBtn.style.display = 'none';
            dlssBtn.style.right = '400px';
            dlssBtn.textContent = 'DLSS: [КАЧЕСТВО]';
            dlssBtn.onclick = () => {
                if (typeof ArcPostProcess !== 'undefined' && ArcPostProcess._activeInstance) {
                    const modes = ['off', 'dlaa', 'quality', 'balanced', 'performance'];
                    const current = ArcPostProcess._activeInstance.getDlssMode();
                    const next = modes[(modes.indexOf(current) + 1) % modes.length];
                    ArcPostProcess._activeInstance.setDlssMode(next);
                    this.settings.dlss = next;
                    this.saveSettings();
                    const labels = { off: 'ВЫКЛ', dlaa: 'DLAA (1.0x)', quality: 'КАЧЕСТВО (0.75x)', balanced: 'БАЛАНС (0.66x)', performance: 'СКОРОСТЬ (0.50x)' };
                    dlssBtn.textContent = `DLSS: [${labels[next] || next}]`;
                }
            };
            parent.appendChild(dlssBtn);
        }

        // 11. Pause Pseudo-RTX Mode Button
        if (!document.getElementById('arc-pause-rtx-btn')) {
            const rtxBtn = document.createElement('button');
            rtxBtn.id = 'arc-pause-rtx-btn';
            rtxBtn.className = 'arc-pause-controls-btn';
            rtxBtn.style.display = 'none';
            rtxBtn.style.right = '600px';
            rtxBtn.textContent = 'ПСЕВДО-RTX: [УЛЬТРА]';
            rtxBtn.onclick = () => {
                if (typeof ArcPostProcess !== 'undefined' && ArcPostProcess._activeInstance) {
                    const modes = ['off', 'medium', 'ultra'];
                    const current = ArcPostProcess._activeInstance.getRtxMode();
                    const next = modes[(modes.indexOf(current) + 1) % modes.length];
                    ArcPostProcess._activeInstance.setRtxMode(next);
                    this.settings.rtx = next;
                    this.saveSettings();
                    const labels = { off: 'ВЫКЛ', medium: 'СРЕДНЕЕ', ultra: 'УЛЬТРА' };
                    rtxBtn.textContent = `ПСЕВДО-RTX: [${labels[next] || next}]`;
                }
            };
            parent.appendChild(rtxBtn);
        }
    }

    renderTacticalCompass(azimuth) {
        if (typeof document === 'undefined' || !document.getElementById) return;
        const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('arc-compass-canvas'));
        if (!canvas || !canvas.getContext) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const currentDeg = ((azimuth * 180 / Math.PI) % 360 + 360) % 360;
        const fov = 120;
        const pxPerDeg = w / fov;
        const centerX = w / 2;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.font = '10px monospace';

        const minDeg = Math.floor(currentDeg - fov / 2);
        const maxDeg = Math.ceil(currentDeg + fov / 2);

        for (let d = minDeg; d <= maxDeg; d++) {
            if (d % 5 !== 0) continue;
            const normDeg = (d % 360 + 360) % 360;
            const x = centerX + (d - currentDeg) * pxPerDeg;

            if (normDeg % 90 === 0) {
                const dirs = this.lang === 'ru' ? { 0: 'С', 90: 'В', 180: 'Ю', 270: 'З' } : { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
                ctx.fillStyle = '#00e5ff';
                ctx.font = 'bold 11px sans-serif';
                ctx.fillText(dirs[normDeg] || '', x, 12);
                ctx.beginPath();
                ctx.moveTo(x, 15);
                ctx.lineTo(x, 24);
                ctx.stroke();
                ctx.font = '10px monospace';
                ctx.fillStyle = '#94a3b8';
            } else if (normDeg % 45 === 0) {
                const dirs = this.lang === 'ru' ? { 45: 'СВ', 135: 'ЮВ', 225: 'ЮЗ', 315: 'СЗ' } : { 45: 'NE', 135: 'SE', 225: 'SW', 315: 'NW' };
                ctx.fillStyle = '#f8fafc';
                ctx.font = '9px sans-serif';
                ctx.fillText(dirs[normDeg] || '', x, 11);
                ctx.beginPath();
                ctx.moveTo(x, 16);
                ctx.lineTo(x, 24);
                ctx.stroke();
                ctx.font = '10px monospace';
                ctx.fillStyle = '#94a3b8';
            } else if (normDeg % 15 === 0) {
                ctx.fillStyle = '#64748b';
                ctx.fillText(String(normDeg), x, 10);
                ctx.beginPath();
                ctx.moveTo(x, 17);
                ctx.lineTo(x, 24);
                ctx.stroke();
                ctx.fillStyle = '#94a3b8';
            } else {
                ctx.beginPath();
                ctx.moveTo(x, 20);
                ctx.lineTo(x, 24);
                ctx.stroke();
            }
        }

        const drawMarker = (tx, ty, label, color) => {
            if (!this.player) return;
            const dx = tx - this.player.x;
            const dy = ty - this.player.y;
            const targetAngle = Math.atan2(dx, dy) * 180 / Math.PI;
            const camAngle = ((azimuth * 180 / Math.PI) % 360 + 360) % 360;
            let diff = (targetAngle - camAngle + 540) % 360 - 180;
            if (Math.abs(diff) < fov / 2) {
                const mx = centerX + diff * pxPerDeg;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(mx, 5, 3.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.font = 'bold 8px sans-serif';
                ctx.fillText(label, mx, 16);
            }
        };

        if (this.extract) drawMarker(this.extract.x, this.extract.y, 'A', '#10b981');
        if (this.metroExtract) drawMarker(this.metroExtract.x, this.metroExtract.y, 'B', '#06b6d4');
        if (this.hatchExtract) drawMarker(this.hatchExtract.x, this.hatchExtract.y, 'H', '#f59e0b');
        if (Array.isArray(this.pickups)) {
            for (let i = 0; i < this.pickups.length; i++) {
                const p = this.pickups[i];
                if (!p.taken) drawMarker(p.x, p.y, 'D' + (i + 1), '#a855f7');
            }
        }
    }

    updateTacticalHud(isRaid) {
        if (typeof document === 'undefined' || !document.getElementById) return;

        const compassWrap = document.getElementById('arc-compass-wrap');
        const banner = document.getElementById('arc-hud-mission-banner');
        const vitals = document.getElementById('arc-tactical-vitals');
        const wepCard = document.getElementById('arc-tactical-weapon-card');
        const promptBox = document.getElementById('arc-interact-prompt-box');
        const specBanner = document.getElementById('arc-spectator-banner');
        const downedBanner = document.getElementById('arc-downed-banner');
        const isSpectating = typeof OnlineBridge !== 'undefined' && OnlineBridge.spectating;
        const isDowned = typeof OnlineBridge !== 'undefined' && OnlineBridge.downed;

        const shouldHide = !isRaid ||
            (this.raidInventory && this.raidInventory.visible) ||
            (this.tacticalMap && this.tacticalMap.visible) ||
            (typeof ControlsMenu !== 'undefined' && ControlsMenu.isOpen()) ||
            this.paused;

        if (shouldHide) {
            if (compassWrap) compassWrap.style.display = 'none';
            if (banner) banner.style.display = 'none';
            if (vitals) vitals.style.display = 'none';
            if (wepCard) wepCard.style.display = 'none';
            if (promptBox) promptBox.style.display = 'none';
            if (specBanner) specBanner.style.display = 'none';
            if (downedBanner) downedBanner.style.display = 'none';
            return;
        }

        if (downedBanner) {
            if (isDowned) {
                downedBanner.style.display = 'flex';
                const timerEl = document.getElementById('arc-downed-timer');
                if (timerEl) {
                    const sec = Math.max(0, Math.ceil(OnlineBridge.downedTimer || 0));
                    timerEl.textContent = this.text(`ИСТЕЧЕНИЕ КРОВИ: ${sec}с`, `BLEEDOUT: ${sec}s`);
                }
            } else {
                downedBanner.style.display = 'none';
            }
        }

        if (specBanner) {
            if (isSpectating) {
                specBanner.style.display = 'flex';
                const specPeer = OnlineBridge.getSpectatedPeer();
                const specName = document.getElementById('arc-spec-name');
                const specStats = document.getElementById('arc-spec-stats');
                if (specName) {
                    const label = specPeer?.label || (specPeer?.id ? ('РАЙДЕР ' + String(specPeer.id).slice(0, 6).toUpperCase()) : 'СОЮЗНИК');
                    specName.textContent = this.text('БОЕЦ: ' + label, 'OPERATOR: ' + label);
                }
                if (specStats && specPeer) {
                    const hp = Math.max(0, Math.ceil(specPeer.hp || 0));
                    const maxHp = specPeer.maxHp || 100;
                    const shield = Math.max(0, Math.ceil(specPeer.shield || 0));
                    const maxShield = specPeer.maxShield || 100;
                    specStats.textContent = `HP: ${hp}/${maxHp}  ·  ${this.text('ЩИТ', 'SHIELD')}: ${shield}/${maxShield}`;
                }
            } else {
                specBanner.style.display = 'none';
            }
        }

        if (compassWrap) {
            compassWrap.style.display = 'flex';
            this.renderTacticalCompass(this.app?.camera ? this.app.camera.azimuth : 0);
        }

        if (banner) {
            banner.style.display = 'flex';
            const timer = document.getElementById('arc-tactical-timer');
            if (timer) {
                const timeVal = Math.max(0, this.raidTimer || 0);
                const minutes = Math.floor(timeVal / 60);
                const seconds = Math.floor(timeVal % 60);
                timer.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
                timer.classList.toggle('warning', timeVal <= 300);
                timer.classList.toggle('critical', timeVal <= 60 || this.barrageActive);
            }
            const sub = document.getElementById('arc-tactical-status-sub');
            if (sub) {
                if (this.extractState === 'inbound') {
                    sub.textContent = this.text('ЭВАКУАЦИЯ А: ТРАНСПОРТ В ПУТИ [' + Math.ceil(this.inboundTimer) + 'с]', 'EXTRACTION A: INBOUND [' + Math.ceil(this.inboundTimer) + 's]');
                    sub.style.color = '#f59e0b';
                } else if (this.extractState === 'boarding') {
                    sub.textContent = this.extractContested ?
                        this.text('ЭВАКУАЦИЯ А: ЗОНА ОСПАРИВАЕТСЯ!', 'EXTRACTION A: CONTESTED!') :
                        this.text('ЭВАКУАЦИЯ А: ПОСАДКА (' + Math.round((this.extractProgress / this.c.extractSec) * 100) + '%)', 'EXTRACTION A: BOARDING (' + Math.round((this.extractProgress / this.c.extractSec) * 100) + '%)');
                    sub.style.color = this.extractContested ? '#ef4444' : '#10b981';
                } else if (this.metroExtract && this.metroExtract.state === 'inbound') {
                    sub.textContent = this.text('ЭВАКУАЦИЯ В: ПОЕЗД В ПУТИ [' + Math.ceil(this.metroExtract.inboundTimer) + 'с]', 'EXTRACTION B: INBOUND [' + Math.ceil(this.metroExtract.inboundTimer) + 's]');
                    sub.style.color = '#06b6d4';
                } else if (this.metroExtract && this.metroExtract.state === 'boarding') {
                    sub.textContent = this.metroExtract.contested ?
                        this.text('ЭВАКУАЦИЯ В: ЗОНА ОСПАРИВАЕТСЯ!', 'EXTRACTION B: CONTESTED!') :
                        this.text('ЭВАКУАЦИЯ В: ПОСАДКА (' + Math.round((this.metroExtract.extractProgress / this.c.extractSec) * 100) + '%)', 'EXTRACTION B: BOARDING (' + Math.round((this.metroExtract.extractProgress / this.c.extractSec) * 100) + '%)');
                    sub.style.color = this.metroExtract.contested ? '#ef4444' : '#06b6d4';
                } else {
                    const mapKey = typeof KeyBindings !== 'undefined' ? KeyBindings.getKeyLabel('map', this.lang) : 'M';
                    const invKey = typeof KeyBindings !== 'undefined' ? KeyBindings.getKeyLabel('inventory', this.lang) : 'TAB';
                    sub.textContent = this.text(`ВЫХОДЫ ОТКРЫТЫ · [${mapKey}] ТАКТ. КАРТА · [${invKey}] РЮКЗАК`, `EXFILS OPEN · [${mapKey}] TACTICAL MAP · [${invKey}] INVENTORY`);
                    sub.style.color = '#38bdf8';
                }
            }
            const drivesEl = document.getElementById('arc-tactical-drives');
            if (drivesEl) {
                const target = this.c?.lootTarget || 3;
                const cur = this.loot || 0;
                drivesEl.textContent = this.text(
                    `ДАННЫЕ: ${cur}/${target} [${'■'.repeat(Math.min(target, cur))}${'□'.repeat(Math.max(0, target - cur))}]`,
                    `DRIVES: ${cur}/${target} [${'■'.repeat(Math.min(target, cur))}${'□'.repeat(Math.max(0, target - cur))}]`
                );
            }
        }

        if (vitals && (this.player || isSpectating)) {
            vitals.style.display = 'flex';
            const specPeer = isSpectating ? OnlineBridge.getSpectatedPeer() : null;
            const currentActor = specPeer || this.player;
            const sFill = document.getElementById('arc-tactical-shield-fill');
            const hFill = document.getElementById('arc-tactical-health-fill');
            const sNum = document.getElementById('arc-tactical-shield-num');
            const hNum = document.getElementById('arc-tactical-hp-num');
            const wNum = document.getElementById('arc-tactical-weight');
            const callsign = document.getElementById('arc-vitals-callsign');

            const curShield = currentActor ? (currentActor.shield || 0) : 0;
            const maxShield = currentActor ? (currentActor.maxShield || 100) : 100;
            const curHp = currentActor ? (currentActor.hp || 0) : 0;
            const maxHp = currentActor ? (currentActor.maxHp || 100) : 100;

            const sPct = maxShield > 0 ? Math.max(0, Math.min(100, (curShield / maxShield) * 100)) : 0;
            const hPct = maxHp > 0 ? Math.max(0, Math.min(100, (curHp / maxHp) * 100)) : 0;
            if (sFill) sFill.style.width = sPct + '%';
            if (hFill) hFill.style.width = hPct + '%';
            if (sNum) sNum.textContent = this.text('ЩИТ ', 'SHIELD ') + Math.ceil(curShield) + '/' + maxShield;
            if (hNum) hNum.textContent = 'HP ' + Math.ceil(curHp) + '/' + maxHp;
            if (callsign) {
                if (isSpectating && specPeer) {
                    const label = specPeer.label || ('РАЙДЕР ' + String(specPeer.id).slice(0, 6).toUpperCase());
                    callsign.textContent = this.text('НАБЛЮДЕНИЕ // ', 'SPECTATING // ') + label;
                } else {
                    callsign.textContent = this.text('РАЙДЕР // ОПЕРАТИВНИК', 'RAIDER // OPERATOR');
                }
            }
            if (wNum) {
                if (isSpectating) {
                    const aliveCount = (typeof OnlineBridge !== 'undefined' && OnlineBridge.getAlivePeers) ? OnlineBridge.getAlivePeers().length : 0;
                    wNum.textContent = this.text('В ЖИВЫХ: ', 'ALIVE: ') + aliveCount;
                } else {
                    const tier = this.encumbrance?.id ? this.encumbrance.id.toUpperCase() : 'MED';
                    wNum.textContent = (this.totalWeight || 0).toFixed(1) + 'kg [' + tier + ']';
                }
            }

            const quickSlots = (typeof MenuSystem !== 'undefined' && Array.isArray(MenuSystem.loadout?.quickSlots)) ? MenuSystem.loadout.quickSlots : [];
            for (let i = 0; i < 4; i++) {
                const el = document.getElementById('arc-quick-val-' + i);
                if (el) {
                    if (isSpectating) {
                        el.textContent = '—';
                    } else {
                        const it = quickSlots[i];
                        if (it) {
                            const cnt = it.count ? ` x${it.count}` : '';
                            const name = (this.lang === 'ru' && it.nameRu) ? it.nameRu : (it.name || 'ITEM');
                            el.textContent = name.slice(0, 8) + cnt;
                        } else {
                            el.textContent = '—';
                        }
                    }
                }
            }
        }

        if (wepCard) {
            if (isSpectating || isDowned) {
                wepCard.style.display = 'none';
            } else {
                wepCard.style.display = 'flex';
                const title = document.getElementById('arc-tactical-wep-title');
                const mode = document.getElementById('arc-tactical-wep-mode');
                const cur = document.getElementById('arc-tactical-ammo-cur');
                const res = document.getElementById('arc-tactical-ammo-res');

                const loadoutPrimary = (typeof MenuSystem !== 'undefined' && MenuSystem.loadout?.primary) ? MenuSystem.loadout.primary : null;
                if (title) title.textContent = loadoutPrimary?.name || 'RUBEZH-76';
                if (mode) {
                    const wepMode = (loadoutPrimary && loadoutPrimary.fireMode === 'semi') ? 'SEMI' : 'AUTO';
                    mode.textContent = wepMode + ' · CALIBER 7.62';
                }
                if (cur) cur.textContent = String(this.ammo != null ? this.ammo : 0);
                if (res) res.textContent = '/ ' + (this.reserveAmmo != null ? this.reserveAmmo : 0);

                const mods = loadoutPrimary?.attachments || {};
                const opt = document.getElementById('arc-sock-optic');
                const muz = document.getElementById('arc-sock-muzzle');
                const mag = document.getElementById('arc-sock-mag');
                const stk = document.getElementById('arc-sock-stock');
                if (opt) opt.classList.toggle('installed', !!mods.optic);
                if (muz) muz.classList.toggle('installed', !!mods.muzzle);
                if (mag) mag.classList.toggle('installed', !!mods.mag);
                if (stk) stk.classList.toggle('installed', !!mods.stock);

                const mapKey = typeof KeyBindings !== 'undefined' ? KeyBindings.getKeyLabel('map', this.lang) : 'M';
                const invKey = typeof KeyBindings !== 'undefined' ? KeyBindings.getKeyLabel('inventory', this.lang) : 'TAB';
                const hotkeyMap = document.getElementById('arc-hotkey-map');
                const hotkeyInv = document.getElementById('arc-hotkey-inv');
                if (hotkeyMap) hotkeyMap.innerHTML = `<strong>${mapKey}</strong> ${this.text('КАРТА', 'MAP')}`;
                if (hotkeyInv) hotkeyInv.innerHTML = `<strong>${invKey}</strong> ${this.text('РЮКЗАК', 'INVENTORY')}`;
            }
        }

        if (promptBox) {
            if (isSpectating) {
                promptBox.style.display = 'none';
            } else if (isDowned) {
                promptBox.style.display = 'flex';
                const promptText = document.getElementById('arc-tactical-prompt-text');
                if (promptText) {
                    promptText.textContent = this.text('ВЫ ОБЕЗДВИЖЕНЫ · ОЖИДАЙТЕ ПОДЪЕМА НАПАРНИКОМ', 'INCAPACITATED · AWAITING TEAMMATE REVIVE');
                }
            } else {
                const promptText = document.getElementById('arc-tactical-prompt-text');
                const promptKeyEl = document.getElementById('arc-tactical-prompt-key');
                const interactKey = typeof KeyBindings !== 'undefined' ? KeyBindings.getKeyLabel('interact', this.lang) : 'F';
                if (promptKeyEl) promptKeyEl.textContent = interactKey;
                let promptMsg = null;

                const nearbyDowned = (typeof OnlineBridge !== 'undefined' && OnlineBridge.findNearbyDownedPeer) ? OnlineBridge.findNearbyDownedPeer() : null;
                if (nearbyDowned) {
                    const label = nearbyDowned.label || (nearbyDowned.id ? ('БОЕЦ ' + String(nearbyDowned.id).slice(0, 6).toUpperCase()) : 'СОЮЗНИК');
                    const pct = nearbyDowned.reviveProgress ? ` (${Math.round((nearbyDowned.reviveProgress / 5.0) * 100)}%)` : '';
                    promptMsg = this.text(`РЕАНИМИРОВАТЬ [${interactKey}] // ${label}${pct}`, `REVIVE [${interactKey}] // ${label}${pct}`);
                } else if (this.extract && this.extractState === 'available' && ShooterRules.distanceSq(this.player, this.extract) <= this.extract.radius ** 2) {
                    promptMsg = this.text('ВЫЗВАТЬ ГРУЗОВОЙ ЛИФТ (ALPHA)', 'CALL CARGO ELEVATOR (ALPHA)');
                } else if (this.metroExtract && this.metroExtract.state === 'available' && ShooterRules.distanceSq(this.player, this.metroExtract) <= this.metroExtract.radius ** 2) {
                    promptMsg = this.text('ВЫЗВАТЬ ПОЕЗД МЕТРО (BETA)', 'CALL METRO TRAIN (BETA)');
                } else if (this.hatchExtract && ShooterRules.distanceSq(this.player, this.hatchExtract) <= this.hatchExtract.radius ** 2) {
                    const hasKey = typeof RaidRules !== 'undefined' && RaidRules.canOpenRaiderHatch ?
                        RaidRules.canOpenRaiderHatch(this.backpack, typeof MenuSystem !== 'undefined' ? MenuSystem.loadout?.safePocket : []) : false;
                    promptMsg = hasKey ? this.text('УДЕРЖИВАТЬ: ОТКРЫТЬ ЛЮК', 'HOLD: UNLOCK BUNKER HATCH') : this.text('ТРЕБУЕТСЯ КЛЮЧ ОТ БУНКЕРА', 'BUNKER KEY REQUIRED');
                } else {
                    const box = this.nearestContainer ? this.nearestContainer() : null;
                    if (box) {
                        const label = Array.isArray(box.item.label) ? (this.lang === 'ru' ? box.item.label[0] : box.item.label[1]) : (box.item.name || 'КОНТЕЙНЕР');
                        promptMsg = this.text('ОБЫСКАТЬ [' + label + ']', 'SEARCH [' + label + ']');
                    } else if (Array.isArray(this.pickups)) {
                        for (const p of this.pickups) {
                            if (!p.taken && ShooterRules.distanceSq(this.player, p) <= (this.player.radius + p.radius + 30) ** 2) {
                                promptMsg = this.text('ПОДОБРАТЬ ДАННЫЕ (+300 CR)', 'COLLECT DATA DRIVE (+300 CR)');
                                break;
                            }
                        }
                    }
                }

                if (promptMsg) {
                    promptBox.style.display = 'flex';
                    if (promptText) promptText.textContent = promptMsg;
                } else {
                    promptBox.style.display = 'none';
                }
            }
        }
    }
}

Game.SIM_DT = 1 / 60;
