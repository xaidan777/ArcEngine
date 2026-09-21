// Constants.js — ALL the kit's numbers: location, camera, render. Loaded FIRST:
// the other modules read these globals. Edited by the editor (_utils/editor): the server
// patches only lines of the form `const NAME = <number>;` — keep values as numeric
// literals (colors — 0xRRGGBB); the editor won't touch a formula.
const GAME_VERSION = '0.6.0'; // build version: ?v= on scripts (tools/build.mjs) and the archive name

// localStorage shim: in a sandbox iframe and when site data is blocked, direct access throws SecurityError.
// All storage access goes through Store only.
/** @satisfies {Record<string, any>} */
const Store = {
    get(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
        try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch (e) { /* nothing to remove */ }
    },
    // JSON parsing that never throws: a broken value = as if there were no save.
    getJSON(key, fallback = null) {
        const raw = Store.get(key);
        if (raw === null) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : fallback;
        } catch (e) {
            console.warn('Store: повреждённое значение "' + key + '", сбрасываю.');
            Store.remove(key);
            return fallback;
        }
    }
};

// Phone or tablet: user agent, iPad posing as a Mac, touch on a small screen.
const IS_MOBILE = (() => {
    const userAgentMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const hasTouchScreen = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isSmallScreen = Math.max(window.innerWidth, window.innerHeight) <= 1366 &&
        Math.min(window.innerWidth, window.innerHeight) <= 1024;
    const isiPad = /iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return userAgentMobile || isiPad || (hasTouchScreen && isSmallScreen);
})();

// --- LOCATION (Location3D.js, Terrain3D.js). World units are px: x to the right, y down
// the map, height up (skill world3d, §Coordinates). ---
const LOCATION_WIDTH = 4096;            // px: location width (the area the game camera stays within)
const LOCATION_HEIGHT = 4096;           // px: location height
const LOCATION_GROUND = 0;              // ground texture: 0 — grass, 1 — sand, 2 — snow (Location3D.GROUNDS)
const GROUND_TILE_SIZE = 512;           // world px per one repeat of the ground texture
const TERRAIN_NOISE_AMP = 24;           // px: hill amplitude (0 — flat ground)
const TERRAIN_NOISE_SCALE = 1400;       // px: hill size
const TERRAIN_NOISE_SEED = 4;           // terrain noise seed
const TERRAIN_BASE = 0;                 // px: mean ground level
const TERRAIN_CELL = 12;                // px: terrain grid step (mobile — no finer than 12)

// --- MODELS (Gltf3D.js) and UI (UI.js) ---
const MODEL_BOT_MOVE_THRESHOLD = 2;    // cm/s: ignore stationary position noise
const MODEL_BOT_STRIDE = 16.8;         // cm per walking cycle at model scale 1 (scales with the bot)
const MODEL_CLIP_BLEND_SEC = 0.2;       // s: cross-fade between animation clips of a .glb model (idle -> run); 0 — instant
const UI_REF_HEIGHT = 720;              // px: the screen height the UI layout (UILayout.js) is drawn for; the UI scales with the screen height, 0 — no scaling

// --- EXTRACTION SHOOTER (Game.js): deterministic 2D gameplay tuning ---
const GAME_PLAYER_SPEED = 260;           // px/s: player movement speed
const GAME_PLAYER_RADIUS = 24;           // px: player collision radius
const GAME_PLAYER_HP = 100;              // maximum player health
const GAME_FIRE_INTERVAL = 0.16;         // s: rifle delay between shots
const GAME_FIRE_DAMAGE = 34;             // damage per hit
const GAME_FIRE_RANGE = 900;              // px: hitscan range
// Audible ranges for combat feedback. Attenuation reaches zero exactly AT its range, so each
// value sits ABOVE the distance the sound can physically occur at or the tail of its reach is
// silent. Hitscan tops out at 1600 px (Game.fire), hence 2400 for impacts.
const GAME_IMPACT_AUDIO_RANGE = 2400;     // px: how far a bullet impact stays audible
const GAME_WHIZ_AUDIO_RANGE = 1200;       // px: supersonic near-miss snap
const GAME_RICOCHET_AUDIO_RANGE = 1800;   // px: ricochet zing
const GAME_SHOT_AUDIO_RANGE = 3500;       // px: gunfire carries across the location
const GAME_FIRE_SPREAD_DEG = 1.1;          // degrees: standing hip-fire spread
const GAME_ADS_FOV_DEG = 38;               // vertical FOV while aiming
const GAME_MAG_SIZE = 20;                 // rounds per magazine
const GAME_RESERVE_AMMO = 60;              // rounds carried outside the magazine
const GAME_RELOAD_SEC = 1.8;               // s: reload duration
const GAME_MEDKIT_HEAL = 35;                // health restored by a field dressing
const GAME_HEAL_SEC = 2.6;                  // s: uninterrupted healing time
const GAME_STAMINA_MAX = 100;              // stamina points
const GAME_STAMINA_DRAIN = 22;             // points/s while sprinting
const GAME_STAMINA_REGEN = 18;             // points/s after recovery delay
const GAME_STAMINA_DELAY = 1.2;            // s before recovery
const GAME_STAMINA_RESTART = 30;           // points to recover from exhaustion
const GAME_NOISE_SHOT = 750;               // px: gunshot hearing range
const GAME_NOISE_SPRINT = 320;             // px: running footstep hearing range
const GAME_NOISE_WALK = 100;               // px: walking footstep hearing range
const GAME_INTERACT_RANGE = 70;            // px: container interaction range
const GAME_BACKPACK_SLOTS = 18;            // valuable item capacity (18 slots)
const GAME_RESERVE_CAPACITY = 120;         // reserve ammunition capacity
const GAME_MEDKIT_CAPACITY = 4;            // carried medkit capacity
const GAME_SEARCH_SEC = 1.2;                // s: hold interact to search a container
const GAME_ENEMY_COUNT = 9;               // guards spawned in the raid
const GAME_ENEMY_SPEED = 105;             // px/s: guard chase speed
const GAME_ENEMY_HP = 68;                  // guard health
const GAME_ENEMY_AGGRO = 480;              // px: guard detection radius
const GAME_ENEMY_DAMAGE = 9;               // damage per guard attack
const GAME_ENEMY_ATTACK_SEC = 0.8;          // s: delay between guard attacks
const GAME_LOOT_TARGET = 3;                 // data drives needed to unlock extraction
const GAME_EXTRACT_INBOUND_SEC = 15;         // s: transport arrival after extraction call
const GAME_EXTRACT_SEC = 6;                  // s: uninterrupted boarding time
const GAME_RAID_DURATION_SEC = 1200;         // s: match duration (20 minutes)
const GAME_RAID_WARN_5MIN_SEC = 300;         // s: 5-minute warning before extraction window closes
const GAME_RAID_WARN_1MIN_SEC = 60;          // s: 1-minute warning before lethal orbital barrage
const GAME_BARRAGE_DAMAGE_PER_SEC = 1000;    // damage per second from lethal orbital barrage at 00:00
const GAME_EXTRACT_BEACON_SIREN_RADIUS = 380;// px: acoustic siren radius of public evac beacon
const GAME_EXTRACT_BEACON_INBOUND_SEC = 20;  // s: public transport inbound arrival delay
const GAME_EXTRACT_BEACON_HOLD_SEC = 6;      // s: public transport contested boarding time
const GAME_EXTRACT_HATCH_HOLD_SEC = 3;       // s: silent raider bunker hatch interaction time
const GAME_EXTRACT_HATCH_NOISE_RADIUS = 25;  // px: silent hatch pressure release sound radius

// --- CAMERA (CameraControl.js): target on the map, azimuth, pitch and zoom. Zoom is
// screen px per world px at the look-at point; distance is derived from it. Flight
// (WASD, Q/E) lifts the look-at point off the ground. ---
const CAMERA_FOV_DEG = 52;              // vertical field of view
const CAMERA_AZIMUTH_DEG = -90;         // where the camera looks on the map: −90 — north up, 0 — east up
const CAMERA_PITCH_DEG = 57;            // pitch toward the ground: 90 — straight from above, less — more perspective
const CAMERA_ZOOM = 1;                  // starting zoom: PC and tablets
const CAMERA_ZOOM_MOBILE = 0.7;         // starting zoom: phones (longer screen side < 1024)
const CAMERA_ZOOM_MIN = 0.5;            // wheel and pinch won't zoom out further (below this the ground edge gets into the frame)
const CAMERA_ZOOM_MAX = 3;              // won't zoom in closer
const CAMERA_ZOOM_WHEEL_STEP = 0.12;    // fraction of zoom per one wheel notch
const CAMERA_ZOOM_LERP = 0.18;          // zoom smoothing: fraction of the remainder per frame
const CAMERA_FOLLOW_LERP = 0.05;        // following an object (follow): fraction of the remainder per frame
const CAMERA_FLY_SPEED = 900;           // flight on WASD, arrows and Q/E: screen px/s (over the world — divided by zoom)
const CAMERA_LIMITS = 0;                // game camera limits: 0 — free flight, 1 — pitch within CAMERA_ORBIT_PITCH_*, target inside the location, flight ceiling; the ground edge stays out of the frame
const CAMERA_LIFT_MAX = 600;            // px, with limits: how high above the ground flight lifts the look-at point (higher — the ground edge gets into the frame)
const CAMERA_ORBIT = 1;                 // camera rotation by the player (RMB: look-around, orbit while following an object): 0 — orientation fixed, 1 — allowed
const CAMERA_ORBIT_DEG_PER_PX = 0.3;    // degrees of rotation per screen px of drag
const CAMERA_ORBIT_PITCH_MIN_DEG = 35;  // with limits: won't go lower toward the ground (the limit also rises on its own — ground edge stays out of the frame)
const CAMERA_ORBIT_PITCH_MAX_DEG = 88;  // with limits: higher — almost straight from above

// --- RENDER (World3D.js): light, shadows, sky, materials, toon and ink edges. Read by
// World3D.cfg(); the editor applies edits to the live scene. ---
// One sun for the whole world. Azimuth — WHERE the shadow falls on the map (0 — right, 90 — down).
const WORLD3D_SUN_AZIMUTH_DEG = 53;
const WORLD3D_SUN_ELEVATION_DEG = 48;   // sun elevation above the horizon
const WORLD3D_SUN_INTENSITY = 1;      // sun strength (with the sky it sums to ~1.0 on flat ground — texture colors unchanged)
const WORLD3D_SUN_COLOR = 0xfff7e6;     // sun color
const WORLD3D_SKYLIGHT_INTENSITY = 0.6; // diffuse sky light (hemispheric light source)
const WORLD3D_SKYLIGHT_COLOR = 0x8bb5d9; // sky light color (faces looking up)
const WORLD3D_GROUNDLIGHT_COLOR = 0x3d362d; // fill light from below (reflection off the ground)
const WORLD3D_SKY_COLOR = 0x8bb5d9;     // sky and fog color
const WORLD3D_FOG_DENSITY = 0.00078;    // exponential fog toward the horizon (0 — off)
// Shadows: one color for all (painted by the toon plugin, Babylon only provides sun visibility)
const WORLD3D_SHADOW_COLOR = 0x0f3a4d;  // shadow color
const WORLD3D_SHADOW_STRENGTH = 0.52;    // shadow strength 0..1: a surface in shadow is multiplied by a blend of white and the shadow color
const WORLD3D_SHADOW_SOFT = 1;          // edge: 0 — hard (for toon), 1..3 — PCF low/medium/high (mobile — no higher than 1)
const WORLD3D_SHADOW_MAP = 2048;        // shadow map size (mobile — half as large); takes effect with a new scene
const WORLD3D_SHADOW_RADIUS = 840;      // px: LIMIT of the shadow ortho frustum half-size; the frustum itself shrinks to the objects in the frame
const WORLD3D_SHADOW_BIAS = 0.001;     // depth bias against shadow acne (shadow stripes on lit faces)
const WORLD3D_SHADOW_NORMAL_BIAS = 0.25; // bias along the normal against shadow acne (stripes and sawtooth on faces at an acute angle to the sun), in shadow map texels on top of the edge smoothing radius (the engine adds it)
// Materials by group (specular highlight — fraction 0..1, size — exponent: larger — smaller highlight)
const WORLD3D_GROUND_SPECULAR = 0;      // ground specular highlight (0 — matte)
const WORLD3D_GROUND_SPEC_POWER = 1;    // ground specular highlight size
const WORLD3D_OUTER_TINT = 1;           // ground brightness BEYOND the location edge (less than 1 — the location boundary is visible)
const WORLD3D_PROP_SPECULAR = 0.22;     // environment specular highlight (group 'prop')
const WORLD3D_PROP_SPEC_POWER = 7;     // environment specular highlight size
const WORLD3D_ACTOR_SPECULAR = 0.25;       // main objects specular highlight (group 'actor'); with toon — toon glint brightness
const WORLD3D_ACTOR_SPEC_POWER = 23;    // main objects specular highlight size
// Toon shader (ArcToonPlugin): light from all sources (sun + sky, with shadow) is quantized into bands
const WORLD3D_TOON = 0;                 // 1 — toon shading and silhouette outline, 0 — regular smooth shading without outline
const WORLD3D_TOON_BANDS = 4;           // number of light bands (2..6)
const WORLD3D_TOON_SOFT = 0.02;         // band boundary softness (0 — sharp, 0.5 — almost smooth)
const WORLD3D_TOON_LOW = 0.48;          // brightness of the darkest band (fraction of full)
const WORLD3D_TOON_GROUND = 1;          // 1 — bands on the ground too, 0 — ground is shaded smoothly
const WORLD3D_TOON_SPEC = 0.25;            // toon glint highlight strength (0 — no highlight)
const WORLD3D_TOON_SPEC_SIZE = 0.075;    // highlight threshold (smaller — larger spot)
const WORLD3D_TOON_RIM = 0.28;           // bright rim light along the objects' silhouette edge (0 — none)
const WORLD3D_TOON_RIM_WIDTH = 0.24;    // rim light width
// Ink edges (EdgesRenderer): edges creased more sharply than the threshold
const WORLD3D_TOON_INK = 0;             // 0 — none, 1 — main objects, 2 — environment too
const WORLD3D_TOON_INK_WIDTH = 25;      // line thickness (≈ world px × 100; thinner as the camera moves away)
const WORLD3D_TOON_INK_COLOR = 0x171717; // ink color: ink edges and silhouette outline
const WORLD3D_TOON_INK_ANGLE = 40;      // °: an edge is drawn if the faces are creased more sharply
// Outer silhouette outline: post-effect (HighlightLayer, isStroke), thickness — in screen px
const WORLD3D_TOON_OUTLINE = 2;         // 0 — none, 1 — main objects, 2 — environment too (only when WORLD3D_TOON = 1)
const WORLD3D_TOON_OUTLINE_ACTOR_WIDTH = 1.5;   // screen px: main objects outline
const WORLD3D_TOON_OUTLINE_PROP_WIDTH = 1;  // screen px: environment outline (there is a lot of it in the frame — thinner)

// --- ARC RAIDERS GEAR & SURVIVAL RULES (ArcEngine Modular Balancing) ---
const GAME_SHIELD_LIGHT_HP = 50;         // Light shield core maximum HP
const GAME_SHIELD_MEDIUM_HP = 100;       // Medium shield core maximum HP
const GAME_SHIELD_HEAVY_HP = 175;        // Heavy shield core maximum HP
const GAME_SHIELD_RECHARGE_RATE = 20;    // shield points recovered per second
const GAME_SHIELD_BREAK_DELAY = 4.5;     // s: delay after shield break before recharge begins
const GAME_WEIGHT_LIGHT_MAX = 15;        // kg: upper limit for Light encumbrance tier
const GAME_WEIGHT_MEDIUM_MAX = 30;       // kg: upper limit for Medium encumbrance tier
const GAME_WEIGHT_HEAVY_MAX = 40;        // kg: upper limit for Heavy encumbrance tier
const GAME_SAFE_POCKET_SLOTS = 2;        // slots in secure container preserved on death
const GAME_QUICK_SLOTS_COUNT = 4;        // quick consumable action slots
const GAME_EXTRACT_ALARM_RADIUS = 300;   // px: extraction siren acoustic alert radius
const GAME_SPOTTER_SIREN_RADIUS = 220;   // px: spotter drone detection acoustic siren

// Tactical Movement & Jump Constants
const GAME_JUMP_IMPULSE = 240;           // units/s: initial vertical jump impulse
const GAME_JUMP_GRAVITY = 680;           // units/s²: vertical gravity
const GAME_JUMP_STAMINA_COST = 15;       // stamina units consumed per jump
const GAME_FALL_SAFE_SPEED = 420;        // units/s: threshold above which fall damage is dealt
const GAME_FALL_DAMAGE_FACTOR = 0.28;    // damage per unit/s exceeding safe landing velocity
const GAME_LEAN_OFFSET = 18;             // px: lateral camera shift while leaning
const GAME_LEAN_ROLL = 0.07;             // rad: camera roll tilt while leaning (~4 degrees)

/** @satisfies {Record<string, any>} */
const POSTURE_STAND = { id: 'stand', eyeHeight: 64, speedMult: 1.00, noiseMult: 1.00, spreadMult: 1.00, recoilMult: 1.00 };
/** @satisfies {Record<string, any>} */
const POSTURE_CROUCH = { id: 'crouch', eyeHeight: 38, speedMult: 0.62, noiseMult: 0.35, spreadMult: 0.65, recoilMult: 0.75 };
/** @satisfies {Record<string, any>} */
const POSTURE_PRONE = { id: 'prone', eyeHeight: 18, speedMult: 0.28, noiseMult: 0.15, spreadMult: 0.35, recoilMult: 0.50 };

/** @satisfies {Record<string, any>} */
const ARC_SHIELD_CORES = {
    LIGHT: { id: 'shield_light', name: 'LIGHT SHIELD CORE', nameRu: 'ЛЕГКИЙ СИЛОВОЙ ЩИТ', tier: 'I', rarity: 'Common', weight: 3.0, value: 1500, maxHp: GAME_SHIELD_LIGHT_HP, rechargeDelay: 3.5, rechargeRate: 25 },
    MEDIUM: { id: 'shield_medium', name: 'MEDIUM SHIELD CORE', nameRu: 'СРЕДНИЙ СИЛОВОЙ ЩИТ', tier: 'II', rarity: 'Rare', weight: 5.5, value: 3200, maxHp: GAME_SHIELD_MEDIUM_HP, rechargeDelay: 5.0, rechargeRate: 20 },
    HEAVY: { id: 'shield_heavy', name: 'HEAVY SHIELD CORE', nameRu: 'ТЯЖЕЛЫЙ СИЛОВОЙ ЩИТ', tier: 'III', rarity: 'Epic', weight: 9.0, value: 6800, maxHp: GAME_SHIELD_HEAVY_HP, rechargeDelay: 7.0, rechargeRate: 15 },
};

/** @satisfies {Record<string, any>} */
const ARC_ENCUMBRANCE_TIERS = {
    LIGHT: { id: 'light', nameRu: 'ЛЕГКИЙ', nameEn: 'LIGHT', maxWeight: GAME_WEIGHT_LIGHT_MAX, speedMult: 1.05, sprintMult: 1.05, staminaDrainMult: 0.85, staminaRegenMult: 1.15, noiseMult: 0.7, jumpBlocked: false, grappleBlocked: false, sprintBlocked: false },
    MEDIUM: { id: 'medium', nameRu: 'СРЕДНИЙ', nameEn: 'MEDIUM', maxWeight: GAME_WEIGHT_MEDIUM_MAX, speedMult: 1.00, sprintMult: 1.00, staminaDrainMult: 1.00, staminaRegenMult: 1.00, noiseMult: 1.0, jumpBlocked: false, grappleBlocked: false, sprintBlocked: false },
    HEAVY: { id: 'heavy', nameRu: 'ТЯЖЕЛЫЙ', nameEn: 'HEAVY', maxWeight: GAME_WEIGHT_HEAVY_MAX, speedMult: 0.88, sprintMult: 0.85, staminaDrainMult: 1.30, staminaRegenMult: 0.70, noiseMult: 1.4, jumpBlocked: false, grappleBlocked: false, sprintBlocked: false },
    OVERENCUMBERED: { id: 'overencumbered', nameRu: 'ПЕРЕГРУЗ', nameEn: 'OVERBURDENED', maxWeight: Infinity, speedMult: 0.50, sprintMult: 0.50, staminaDrainMult: 2.00, staminaRegenMult: 0.35, noiseMult: 1.8, jumpBlocked: true, grappleBlocked: true, sprintBlocked: true },
};

/** @satisfies {Record<string, any>} */
const ARC_CONSUMABLES = {
    STIM: { id: 'consumable_stim', name: 'COMBAT STIM', nameRu: 'БОЕВОЙ СТИМУЛЯТОР', castSec: 1.0, staminaBuff: 2.0, healTotal: 25, healDuration: 5.0, weight: 0.4, value: 350 },
    SMALL_BATTERY: { id: 'consumable_small_battery', name: 'SHIELD BATTERY', nameRu: 'БАТАРЕЯ ЩИТА', castSec: 2.5, shieldRestore: 50, weight: 0.8, value: 400 },
    OVERCHARGER: { id: 'consumable_overcharger', name: 'HEAVY OVERCHARGER', nameRu: 'СВЕРХЗАРЯДНИК', castSec: 5.0, shieldRestore: 150, weight: 1.8, value: 1200 },
    MEDKIT: { id: 'consumable_medkit', name: 'FIELD MEDKIT', nameRu: 'ПОЛЕВАЯ АПТЕЧКА', castSec: 4.0, hpRestore: 60, weight: 1.5, value: 500 },
    BANDAGE: { id: 'consumable_bandage', name: 'HEMOSTATIC BANDAGE', nameRu: 'ГЕМОСТАТИК', castSec: 1.8, hpRestore: 25, weight: 0.3, value: 150 },
};

/** @satisfies {Record<string, any>} */
const ARC_MACHINE_TYPES = {
    SPOTTER: { id: 'spotter', nameRu: 'ДРОН-СПОТТЕР', nameEn: 'SPOTTER DRONE', hp: 45, radius: 44, height: 95, flyAltitude: 110, alertSpeed: 160, sirenRadius: GAME_SPOTTER_SIREN_RADIUS, flareHeight: 380, dropPodCallTime: 2.0, reinforcements: 2, visionAngleDeg: 140, visionRange: 750, hearingRadius: 160 },
    POP: { id: 'pop', nameRu: 'ПОП-КАМИКАДЗЕ', nameEn: 'POP RUNNER', hp: 35, radius: 32, height: 58, speed: 180, fuseRadius: 75, fuseTime: 1.2, explodeRadius: 110, explodeDamage: 75, visionAngleDeg: 85, visionRange: 450, hearingRadius: 140 },
    TICK: { id: 'tick', nameRu: 'КЛЕЩ', nameEn: 'TICK SWARM', hp: 25, radius: 24, height: 35, speed: 200, leapDist: 130, leapCooldown: 2.5, attackDamage: 14, shieldDisrupt: 25, visionAngleDeg: 120, visionRange: 400, hearingRadius: 180 },
    SENTINEL: { id: 'sentinel', nameRu: 'ЧАСОВОЙ СЕНТИНЕЛ', nameEn: 'SENTINEL WALKER', hp: 220, radius: 62, height: 165, speed: 80, frontKineticResist: 0.90, rearCoreMultiplier: 3.0, rearCoreAngleDeg: 110, gunDamage: 22, visionAngleDeg: 100, visionRange: 650, hearingRadius: 180 },
    GUARD: { id: 'guard', nameRu: 'ПАТРУЛЬНЫЙ', nameEn: 'ARC PATROL', hp: 68, radius: 38, height: 120, speed: 105, gunDamage: 9, visionAngleDeg: 90, visionRange: 520, hearingRadius: 150 },
    CRICKET: { id: 'cricket', nameRu: 'ПРЫГУН КРИКЕТ', nameEn: 'CRICKET JUMPER', hp: 75, radius: 38, height: 75, speed: 175, leapSpeed: 390, leapDist: 280, leapCooldown: 3.8, pounceDamage: 45, dropLoot: 'arc_catalyst', visionAngleDeg: 110, visionRange: 480, hearingRadius: 200 },
    SCREAMER: { id: 'screamer', nameRu: 'СИРЕНА СКРИМЕР', nameEn: 'SCREAMER EW UNIT', hp: 160, radius: 52, height: 160, speed: 75, sirenRadius: 750, screamCooldown: 6.0, screamDisrupt: 35, dropLoot: 'arc_sensor', visionAngleDeg: 120, visionRange: 600, hearingRadius: 220 },
    STALKER: { id: 'stalker', nameRu: 'ГОНЧАЯ СТАЛКЕР', nameEn: 'STALKER HOUND', hp: 130, radius: 46, height: 110, speed: 135, flankAngleDeg: 55, burstCount: 5, burstInterval: 0.08, burstCooldown: 2.2, gunDamage: 11, dropLoot: 'arc_sensor', visionAngleDeg: 100, visionRange: 580, hearingRadius: 240 },
    BOMBARD: { id: 'bombard', nameRu: 'БОМБАРДИР МОРТИРА', nameEn: 'BOMBARD MORTAR', hp: 310, radius: 65, height: 180, speed: 40, deployTime: 1.8, mortarRangeMin: 300, mortarRangeMax: 1800, mortarCooldown: 5.5, mortarDamage: 85, mortarRadius: 150, dropLoot: 'arc_power_core', visionAngleDeg: 90, visionRange: 700, hearingRadius: 140 },
    SCOUT: { id: 'scout', nameRu: 'РАЗВЕДЧИК', nameEn: 'ARC SCOUT', hp: 44, radius: 32, height: 90, speed: 140, gunDamage: 8, visionAngleDeg: 110, visionRange: 580, hearingRadius: 160 },
    HEAVY: { id: 'heavy', nameRu: 'ТЯЖЕЛЫЙ ПАТРУЛЬНЫЙ', nameEn: 'HEAVY ENFORCER', hp: 140, radius: 52, height: 150, speed: 75, gunDamage: 16, visionAngleDeg: 95, visionRange: 550, hearingRadius: 180 },
};

/** @satisfies {Record<string, any>} */
const ARC_ITEMS = {
    // Weapons
    tempest_ii: { id: 'tempest_ii', name: 'TEMPEST II', nameRu: 'ТЕМПЕСТ II', category: 'weapons', slotType: 'primary', archetype: 'assault_rifle', fireMode: 'auto', tier: 'II', rarity: 'Rare', weight: 6.2, value: 7500, caliber: 'heavy_kinetic', damage: 54, fireRate: 85, range: 75, magSize: 20, compatibleSlots: ['optic', 'muzzle', 'mag', 'stock'], desc: 'High fire-rate assault rifle for medium engagements.' },
    revolver_i: { id: 'revolver_i', name: 'REVOLVER I', nameRu: 'РЕВОЛЬВЕР I', category: 'weapons', slotType: 'sidearm', archetype: 'revolver', fireMode: 'semi', tier: 'I', rarity: 'Common', weight: 3.1, value: 2500, caliber: 'heavy_kinetic', damage: 62, fireRate: 30, range: 50, magSize: 6, compatibleSlots: ['optic', 'muzzle'], desc: 'Reliable high-impact sidearm revolver.' },
    vulcano_i: { id: 'vulcano_i', name: 'VULCANO I', nameRu: 'ВУЛКАНО I', category: 'weapons', slotType: 'primary', archetype: 'shotgun', fireMode: 'semi', tier: 'I', rarity: 'Epic', weight: 8.0, value: 10000, caliber: 'shotgun_shell', damage: 78, fireRate: 45, range: 45, magSize: 8, compatibleSlots: ['optic', 'muzzle', 'mag', 'stock'], desc: 'Semi-automatic shotgun with heavy pellet spread.' },
    rattler_smg: { id: 'rattler_smg', name: 'RATTLER SMG', nameRu: 'РАТТЛЕР ПП', category: 'weapons', slotType: 'primary', archetype: 'smg', fireMode: 'auto', tier: 'I', rarity: 'Uncommon', weight: 4.0, value: 4200, caliber: 'light_kinetic', damage: 32, fireRate: 110, range: 40, magSize: 30, compatibleSlots: ['optic', 'muzzle', 'mag', 'stock'], desc: 'Rapid-fire compact SMG.' },
    lance_sniper: { id: 'lance_sniper', name: 'LANCE DMR', nameRu: 'ЛАНС ДМР', category: 'weapons', slotType: 'primary', archetype: 'sniper', fireMode: 'semi', tier: 'III', rarity: 'Epic', weight: 7.5, value: 12500, caliber: 'high_caliber', damage: 115, fireRate: 18, range: 120, magSize: 5, compatibleSlots: ['optic', 'muzzle', 'stock'], desc: 'Precision long-range kinetic rifle.' },

    // Ammunition
    ammo_light: { id: 'ammo_light', name: 'LIGHT AMMO', nameRu: 'ЛЕГКИЕ ПАТРОНЫ', category: 'ammo', caliber: 'light_kinetic', count: 80, weight: 1.2, value: 200, desc: 'Standard compact kinetic rounds.' },
    ammo_heavy: { id: 'ammo_heavy', name: 'HEAVY AMMO', nameRu: 'ТЯЖЕЛЫЕ ПАТРОНЫ', category: 'ammo', caliber: 'heavy_kinetic', count: 60, weight: 2.0, value: 300, desc: '7.62mm rifle caliber.' },
    ammo_shotgun: { id: 'ammo_shotgun', name: 'SHOTGUN SHELLS', nameRu: 'КАРТЕЧЬ 12G', category: 'ammo', caliber: 'shotgun_shell', count: 24, weight: 1.8, value: 250, desc: '12-gauge heavy buckshot shells.' },
    ammo_high_cal: { id: 'ammo_high_cal', name: 'HIGH-CALIBER', nameRu: 'КРУПНОКАЛИБЕРНЫЕ', category: 'ammo', caliber: 'high_caliber', count: 15, weight: 2.2, value: 450, desc: '12.7mm armor-piercing kinetic rounds.' },
    ammo_energy: { id: 'ammo_energy', name: 'ENERGY CELL', nameRu: 'ЭНЕРГОЯЧЕЙКА', category: 'ammo', caliber: 'energy_cell', count: 50, weight: 1.5, value: 600, desc: 'ARC plasma power cells.' },

    // Shield Cores
    shield_light: { id: 'shield_light', name: 'LIGHT SHIELD CORE', nameRu: 'ЛЕГКИЙ СИЛОВОЙ ЩИТ', category: 'armor', slotType: 'shieldCore', tier: 'I', rarity: 'Common', weight: 3.0, value: 1500, shieldHp: GAME_SHIELD_LIGHT_HP, rechargeDelay: 3.5, rechargeRate: 25, desc: 'Nimble tactical shield with quick recovery delay.' },
    shield_medium: { id: 'shield_medium', name: 'MEDIUM SHIELD CORE', nameRu: 'СРЕДНИЙ СИЛОВОЙ ЩИТ', category: 'armor', slotType: 'shieldCore', tier: 'II', rarity: 'Rare', weight: 5.5, value: 3200, shieldHp: GAME_SHIELD_MEDIUM_HP, rechargeDelay: 5.0, rechargeRate: 20, desc: 'Standard issue Speranza balanced tactical shield.' },
    shield_heavy: { id: 'shield_heavy', name: 'HEAVY SHIELD CORE', nameRu: 'ТЯЖЕЛЫЙ СИЛОВОЙ ЩИТ', category: 'armor', slotType: 'shieldCore', tier: 'III', rarity: 'Epic', weight: 9.0, value: 6800, shieldHp: GAME_SHIELD_HEAVY_HP, rechargeDelay: 7.0, rechargeRate: 15, desc: 'Reinforced heavy-duty shield plating.' },

    // Consumables
    consumable_stim: { id: 'consumable_stim', name: 'COMBAT STIM', nameRu: 'БОЕВОЙ СТИМУЛЯТОР', category: 'consumables', slotType: 'quick', count: 2, weight: 0.4, value: 350, castSec: 1.0, staminaBuff: 2.0, healTotal: 25, desc: 'Quick-acting adrenaline injector restoring stamina.' },
    consumable_small_battery: { id: 'consumable_small_battery', name: 'SHIELD BATTERY', nameRu: 'БАТАРЕЯ ЩИТА', category: 'consumables', slotType: 'quick', count: 2, weight: 0.8, value: 400, castSec: 2.5, shieldRestore: 50, desc: 'Emergency battery restoring 50 points of tactical shield.' },
    consumable_overcharger: { id: 'consumable_overcharger', name: 'HEAVY OVERCHARGER', nameRu: 'СВЕРХЗАРЯДНИК', category: 'consumables', slotType: 'quick', count: 1, weight: 1.8, value: 1200, castSec: 5.0, shieldRestore: 150, desc: 'Industrial grade battery restoring 150 shield points.' },
    consumable_medkit: { id: 'consumable_medkit', name: 'FIELD MEDKIT', nameRu: 'ПОЛЕВАЯ АПТЕЧКА', category: 'consumables', slotType: 'quick', count: 2, weight: 1.5, value: 500, castSec: 4.0, hpRestore: 60, desc: 'Trauma kit restoring 60 health points.' },
    consumable_bandage: { id: 'consumable_bandage', name: 'HEMOSTATIC BANDAGE', nameRu: 'ГЕМОСТАТИК', category: 'consumables', slotType: 'quick', count: 3, weight: 0.3, value: 150, castSec: 1.8, hpRestore: 25, desc: 'Quick medical dressing.' },

    // Gadgets
    gadget_grapple: { id: 'gadget_grapple', name: 'GRAPPLING HOOK', nameRu: 'КРЮК-КОШКА', category: 'gadgets', slotType: 'gadget', tier: 'II', rarity: 'Rare', weight: 2.5, value: 4500, desc: 'Pneumatic launcher for rapid vertical repositioning.' },
    gadget_jump_pad: { id: 'gadget_jump_pad', name: 'DEPLOYABLE JUMP PAD', nameRu: 'ДЖАМП-ПАД', category: 'gadgets', slotType: 'gadget', tier: 'II', rarity: 'Rare', weight: 3.5, value: 4000, desc: 'High-impulse kinetic launch platform.' },
    gadget_pulse_radar: { id: 'gadget_pulse_radar', name: 'PULSE RADAR', nameRu: 'ИМПУЛЬСНЫЙ СКАНЕР', category: 'gadgets', slotType: 'gadget', tier: 'II', rarity: 'Rare', weight: 1.5, value: 3800, desc: 'Emits a 360 acoustic scan highlighting moving ARC.' },
    gadget_emp_grenade: { id: 'gadget_emp_grenade', name: 'EMP GRENADE', nameRu: 'ЭМИ-ГРАНАТА', category: 'gadgets', slotType: 'gadget', tier: 'II', rarity: 'Epic', weight: 1.2, value: 2800, desc: 'Disrupts robotic circuitry and disables shields.' },

    arc_battery: { id: 'arc_battery', name: 'ARC POWER BATTERY', nameRu: 'БАТАРЕЯ ARC', category: 'materials', tier: 'III', rarity: 'Epic', count: 1, weight: 8.5, value: 3200, safePocketBlacklist: true, desc: 'Heavy volatile power source salvaged from downed ARC walkers.' },
    arc_sensor: { id: 'arc_sensor', name: 'ARC SENSOR ARRAY', nameRu: 'СЕНСОРНЫЙ БЛОК ARC', category: 'materials', type: 'sensor', tier: 'II', rarity: 'Rare', count: 1, weight: 0.8, value: 1400, desc: 'Micro-radar module from Spotter drone.' },
    arc_power_core: { id: 'arc_power_core', name: 'ARC POWER CORE', nameRu: 'ЭНЕРГОЯДРО ARC', category: 'materials', type: 'core', tier: 'III', rarity: 'Epic', count: 1, weight: 3.5, value: 850, desc: 'Heavy glowing core from Sentinel walker.' },
    arc_catalyst: { id: 'arc_catalyst', name: 'ARC CATALYST', nameRu: 'КАТАЛИЗАТОР ARC', category: 'materials', type: 'explosive', tier: 'II', rarity: 'Rare', count: 1, weight: 0.8, value: 280, desc: 'Volatile explosive catalyst from Pop runner.' },
    data_drive: { id: 'data_drive', name: 'DATA DRIVE', nameRu: 'НАКОПИТЕЛЬ ДАННЫХ', category: 'materials', tier: 'III', rarity: 'Epic', count: 1, weight: 0.5, value: 2500, desc: 'Classified ARC behavioral algorithms.' },
    steel_scrap: { id: 'steel_scrap', name: 'REFINED ALLOY SCRAP', nameRu: 'СПЛАВ МЕТАЛЛА', category: 'materials', tier: 'I', rarity: 'Common', count: 20, weight: 2.0, value: 400, desc: 'Structural alloy for workbench modifications.' },
    scrap: { id: 'scrap', name: 'ROBOT PARTS', nameRu: 'ДЕТАЛИ РОБОТА', category: 'materials', type: 'scrap', tier: 'I', rarity: 'Common', count: 1, weight: 1.5, value: 65, desc: 'Scrap metal and chassis hardware salvaged from robots.' },
    electronics: { id: 'electronics', name: 'CIRCUITRY', nameRu: 'ЭЛЕКТРОНИКА', category: 'materials', type: 'electronics', tier: 'I', rarity: 'Common', count: 1, weight: 0.5, value: 120, desc: 'Microcircuits and wiring harnesses.' },
    fabric: { id: 'fabric', name: 'BALLISTIC FABRIC', nameRu: 'БАЛЛИСТИЧЕСКАЯ ТКАНЬ', category: 'materials', type: 'fabric', tier: 'I', rarity: 'Common', count: 1, weight: 0.4, value: 90, desc: 'Reinforced synthetic fibers.' },
    chemicals: { id: 'chemicals', name: 'SYNTH CHEMICALS', nameRu: 'СИНТ-ХИМИКАТЫ', category: 'materials', type: 'chemicals', tier: 'I', rarity: 'Common', count: 1, weight: 0.6, value: 110, desc: 'Refined medical reagents and stimulants.' },
    memory_core: { id: 'memory_core', name: 'ARC MEMORY CORE', nameRu: 'КВАНТОВОЕ ЯДРО ARC', category: 'materials', tier: 'III', rarity: 'Legendary', count: 1, weight: 1.0, value: 6500, desc: 'Quantum crystalline logic unit from heavy ARC boss.' },

    // Upgraded Weapon Tiers (Weapon Refinements)
    tempest_iii: { id: 'tempest_iii', name: 'TEMPEST III', nameRu: 'ТЕМПЕСТ III', category: 'weapons', slotType: 'primary', archetype: 'assault_rifle', fireMode: 'auto', tier: 'III', rarity: 'Epic', weight: 5.8, value: 12000, caliber: 'heavy_kinetic', damage: 68, fireRate: 90, range: 85, magSize: 28, compatibleSlots: ['optic', 'muzzle', 'mag', 'stock'], desc: 'Advanced modified assault rifle with integrated Spotter sensor targeting.' },
    vulcano_ii: { id: 'vulcano_ii', name: 'VULCANO II', nameRu: 'ВУЛКАНО II', category: 'weapons', slotType: 'primary', archetype: 'shotgun', fireMode: 'semi', tier: 'II', rarity: 'Epic', weight: 7.6, value: 14000, caliber: 'shotgun_shell', damage: 96, fireRate: 50, range: 50, magSize: 10, compatibleSlots: ['optic', 'muzzle', 'mag', 'stock'], desc: 'Overcharged semi-auto shotgun tuned with ARC Sentinel power core.' },
    revolver_ii: { id: 'revolver_ii', name: 'REVOLVER II', nameRu: 'РЕВОЛЬВЕР II', category: 'weapons', slotType: 'sidearm', archetype: 'revolver', fireMode: 'semi', tier: 'II', rarity: 'Epic', weight: 2.9, value: 6000, caliber: 'heavy_kinetic', damage: 78, fireRate: 35, range: 60, magSize: 6, headshotMultiplier: 2.2, compatibleSlots: ['optic', 'muzzle'], desc: 'Precision magnum hand-cannon modified with ARC Catalyst core.' },

    // Rubezh-76 Assault Rifle Line (AK-Pattern Modular Weapon Evolution)
    rubezh_t1: { id: 'rubezh_t1', name: 'RUBEZH-76 T1', nameRu: 'РУБЕЖ-76 [КУСТАРНЫЙ]', category: 'weapons', slotType: 'primary', archetype: 'assault_rifle', fireMode: 'auto', tier: 'I', rarity: 'Common', weight: 4.8, value: 3400, caliber: 'heavy_kinetic', damage: 44, fireRate: 70, range: 75, magSize: 20, compatibleSlots: ['optic', 'muzzle', 'mag', 'stock'], desc: 'Crude stamped steel AK-pattern rifle wrapped in electrical tape.' },
    rubezh_t2: { id: 'rubezh_t2', name: 'RUBEZH-76 T2', nameRu: 'РУБЕЖ-76 [ПОЛЕВОЙ]', category: 'weapons', slotType: 'primary', archetype: 'assault_rifle', fireMode: 'auto', tier: 'II', rarity: 'Uncommon', weight: 5.2, value: 6200, caliber: 'heavy_kinetic', damage: 54, fireRate: 75, range: 80, magSize: 25, compatibleSlots: ['optic', 'muzzle', 'mag', 'stock'], desc: 'Field-modified assault rifle with walnut stock and slotted muzzle brake.' },
    rubezh_t3: { id: 'rubezh_t3', name: 'RUBEZH-76 T3', nameRu: 'РУБЕЖ-76 [ВОЕННЫЙ]', category: 'weapons', slotType: 'primary', archetype: 'assault_rifle', fireMode: 'auto', tier: 'III', rarity: 'Rare', weight: 5.5, value: 9800, caliber: 'heavy_kinetic', damage: 64, fireRate: 80, range: 90, magSize: 30, compatibleSlots: ['optic', 'muzzle', 'mag', 'stock'], desc: 'Military surplus rifle equipped with analog prism optic and folding skeleton stock.' },
    rubezh_t4: { id: 'rubezh_t4', name: 'RUBEZH-76 T4', nameRu: 'РУБЕЖ-76 [ГИБРИД ARC]', category: 'weapons', slotType: 'primary', archetype: 'assault_rifle', fireMode: 'auto', tier: 'IV', rarity: 'Legendary', weight: 6.0, value: 16500, caliber: 'heavy_kinetic', damage: 76, fireRate: 85, range: 100, magSize: 35, compatibleSlots: ['optic', 'muzzle', 'mag', 'stock'], desc: 'Experimental machine-hybrid battle rifle with integral suppressor, heatsink, CRT ammo counter, and ARC accelerator coils.' },

    // Keys & Extraction Utilities
    raider_hatch_key: { id: 'raider_hatch_key', name: 'RAIDER BUNKER KEY', nameRu: 'КЛЮЧ БУНКЕРА', category: 'materials', slotType: 'key', tier: 'II', rarity: 'Rare', weight: 0.2, value: 4000, desc: 'Single-use hydraulic keycard to unlock silent surface bunker hatches.' },

    // Blueprints (Permanent Schematics)
    bp_tempest_ii: { id: 'bp_tempest_ii', name: 'BLUEPRINT: TEMPEST II', nameRu: 'ЧЕРТЕЖ: ТЕМПЕСТ II', category: 'blueprints', slotType: 'blueprint', targetItem: 'tempest_ii', targetRecipe: 'craft_tempest_ii', tier: 'II', rarity: 'Rare', weight: 0.1, value: 4500, desc: 'Schematics required to manufacture the Tempest II assault rifle.' },
    bp_lance_sniper: { id: 'bp_lance_sniper', name: 'BLUEPRINT: LANCE DMR', nameRu: 'ЧЕРТЕЖ: ЛАНС ДМР', category: 'blueprints', slotType: 'blueprint', targetItem: 'lance_sniper', targetRecipe: 'craft_lance_sniper', tier: 'III', rarity: 'Epic', weight: 0.1, value: 7000, desc: 'Schematics required to manufacture the Lance high-caliber DMR.' },
    bp_shield_heavy: { id: 'bp_shield_heavy', name: 'BLUEPRINT: HEAVY SHIELD', nameRu: 'ЧЕРТЕЖ: ТЯЖЕЛЫЙ ЩИТ', category: 'blueprints', slotType: 'blueprint', targetItem: 'shield_heavy', targetRecipe: 'craft_shield_heavy', tier: 'III', rarity: 'Epic', weight: 0.1, value: 5000, desc: 'Schematics required to construct Heavy Shield Core.' },
    bp_emp_grenade: { id: 'bp_emp_grenade', name: 'BLUEPRINT: EMP GRENADE', nameRu: 'ЧЕРТЕЖ: ЭМИ-ГРАНАТА', category: 'blueprints', slotType: 'blueprint', targetItem: 'gadget_emp_grenade', targetRecipe: 'craft_emp_grenade', tier: 'II', rarity: 'Epic', weight: 0.1, value: 3500, desc: 'Schematics required to manufacture electromagnetic pulse grenades.' },
    bp_hatch_key: { id: 'bp_hatch_key', name: 'BLUEPRINT: BUNKER KEY', nameRu: 'ЧЕРТЕЖ: КЛЮЧ БУНКЕРА', category: 'blueprints', slotType: 'blueprint', targetItem: 'raider_hatch_key', targetRecipe: 'craft_hatch_key', tier: 'II', rarity: 'Rare', weight: 0.1, value: 6000, desc: 'Schematics required to forge hydraulic bunker keys.' },

    // Augment / Exoskeleton Frames
    frame_scout: { id: 'frame_scout', name: 'SCOUT FRAME «STRIZH»', nameRu: 'ФРЕЙМ «СКАУТ»', category: 'augment', slotType: 'augment', tier: 'I', rarity: 'Common', weight: 2.0, value: 2000, maxWeight: 25.0, safePocketSlots: 1, noiseMult: 0.70, sprintSpeedMult: 1.10, desc: 'Lightweight agile frame. Max weight: 25kg, 1 safe pocket slot, -30% footstep noise, +10% sprint speed.' },
    frame_looter: { id: 'frame_looter', name: 'LOOTER FRAME «MURAVEY»', nameRu: 'ФРЕЙМ «МАРОДЕР»', category: 'augment', slotType: 'augment', tier: 'II', rarity: 'Rare', weight: 4.5, value: 5500, maxWeight: 45.0, safePocketSlots: 3, noiseMult: 1.00, sprintSpeedMult: 1.00, desc: 'Industrial scavenger frame. Max weight: 45kg, 3 safe pocket slots.' },
    frame_enforcer: { id: 'frame_enforcer', name: 'ENFORCER FRAME «SHTURMOVIK»', nameRu: 'ФРЕЙМ «ШТУРМОВИК»', category: 'augment', slotType: 'augment', tier: 'III', rarity: 'Epic', weight: 9.0, value: 9500, maxWeight: 55.0, safePocketSlots: 2, bonusHp: 25, noiseMult: 1.35, sprintSpeedMult: 0.90, desc: 'Heavy combat armor frame. Max weight: 55kg, 2 safe pocket slots, +25 Max HP, -10% sprint speed.' },

    // Weapon Attachments (Optics, Muzzles, Magazines, Stocks)
    optic_kobra: { id: 'optic_kobra', name: 'KOBRA REFLEX SIGHT', nameRu: 'КОЛЛИМАТОР «КОБРА»', category: 'attachments', slotType: 'optic', tier: 'I', rarity: 'Common', weight: 0.35, value: 1200, zoom: 1.25, adsTimeMult: 0.90, desc: 'Holographic illuminated red dot reflex sight for rapid target acquisition.' },
    optic_prism_4x: { id: 'optic_prism_4x', name: 'PSO-4X PRISM SCOPE', nameRu: 'ПРИЦЕЛ ПСО-4X', category: 'attachments', slotType: 'optic', tier: 'III', rarity: 'Rare', weight: 0.65, value: 3800, zoom: 4.0, adsTimeMult: 1.25, rangeBonus: 30, desc: '4x magnification analog prism scope with rangefinder stadiametric reticle.' },
    muzzle_brake: { id: 'muzzle_brake', name: 'TACTICAL COMPENSATOR', nameRu: 'ДУЛЬНЫЙ ТОРМОЗ-КОМПЕНСАТОР', category: 'attachments', slotType: 'muzzle', tier: 'I', rarity: 'Common', weight: 0.25, value: 900, recoilMult: 0.75, noiseMult: 1.15, desc: 'Slotted steel muzzle brake directing gases to reduce vertical muzzle rise.' },
    muzzle_suppressor: { id: 'muzzle_suppressor', name: 'INTEGRAL SUPPRESSOR', nameRu: 'ТАКТИЧЕСКИЙ ГЛУШИТЕЛЬ', category: 'attachments', slotType: 'muzzle', tier: 'II', rarity: 'Rare', weight: 0.60, value: 3200, noiseMult: 0.40, muzzleFlash: false, adsTimeMult: 1.10, desc: 'Baffled acoustic suppressor dampening gunshot sound by 60% and concealing muzzle flash.' },
    mag_extended: { id: 'mag_extended', name: 'EXTENDED DRUM MAG', nameRu: 'УВЕЛИЧЕННЫЙ МАГАЗИН', category: 'attachments', slotType: 'mag', tier: 'II', rarity: 'Uncommon', weight: 0.85, value: 1800, magCapacityMult: 1.5, reloadTimeMult: 1.15, desc: 'High-capacity magazine increasing ammo capacity by 50%.' },
    mag_quick: { id: 'mag_quick', name: 'TACTICAL QUICK MAG', nameRu: 'БЫСТРОСЪЕМНЫЙ МАГАЗИН', category: 'attachments', slotType: 'mag', tier: 'II', rarity: 'Uncommon', weight: 0.30, value: 1600, reloadTimeMult: 0.70, desc: 'Flared magwell adapter and rubber pull-tab reducing reload time by 30%.' },
    stock_folding: { id: 'stock_folding', name: 'SKELETON FOLDING STOCK', nameRu: 'СКЛАДНОЙ ПРИКЛАД', category: 'attachments', slotType: 'stock', tier: 'I', rarity: 'Common', weight: 0.45, value: 1100, adsTimeMult: 0.85, recoilMult: 1.10, desc: 'Lightweight wireframe folding stock accelerating ADS speed.' },
    stock_heavy: { id: 'stock_heavy', name: 'HEAVY RECOIL STOCK', nameRu: 'ТЯЖЕЛЫЙ ПРИКЛАД', category: 'attachments', slotType: 'stock', tier: 'III', rarity: 'Rare', weight: 1.10, value: 2700, recoilMult: 0.75, swayMult: 0.70, adsTimeMult: 1.10, desc: 'Padded counterweight stock drastically reducing weapon kick and idle sway.' },
};

const ARC_ATTACHMENT_SLOTS = ['optic', 'muzzle', 'mag', 'stock'];

/** @satisfies {Record<string, any>} */
const ARC_ATTACHMENTS = {
    optic_kobra: ARC_ITEMS.optic_kobra,
    optic_prism_4x: ARC_ITEMS.optic_prism_4x,
    muzzle_brake: ARC_ITEMS.muzzle_brake,
    muzzle_suppressor: ARC_ITEMS.muzzle_suppressor,
    mag_extended: ARC_ITEMS.mag_extended,
    mag_quick: ARC_ITEMS.mag_quick,
    stock_folding: ARC_ITEMS.stock_folding,
    stock_heavy: ARC_ITEMS.stock_heavy,
};

/** @satisfies {Record<string, any>} */
const ARC_CRAFTING_RECIPES = {
    refine_mechanical_component: {
        id: 'refine_mechanical_component', category: 'materials', station: 'station_refiner', resultId: 'mechanical_component',
        nameRu: 'Механический компонент', nameEn: 'Mechanical Component', count: 1, credits: 0,
        materials: [{ type: 'metal_parts', count: 5 }],
        result: { type: 'mechanical_component', name: 'Mechanical Component', nameRu: 'Механический компонент', category: 'materials', tier: 'I', rarity: 'Common', value: 50, weight: 0.5 }
    },
    craft_ammo_light: {
        id: 'craft_ammo_light',
        category: 'munitions',
        resultId: 'ammo_light',
        count: 80,
        nameRu: 'Легкие патроны (x80)',
        nameEn: 'Light Ammo (x80)',
        credits: 50,
        materials: [{ type: 'scrap', count: 1 }]
    },
    craft_ammo_heavy: {
        id: 'craft_ammo_heavy',
        category: 'munitions',
        resultId: 'ammo_heavy',
        count: 60,
        nameRu: 'Тяжелые патроны (x60)',
        nameEn: 'Heavy Ammo (x60)',
        credits: 75,
        materials: [{ type: 'scrap', count: 2 }]
    },
    craft_ammo_shotgun: {
        id: 'craft_ammo_shotgun',
        category: 'munitions',
        resultId: 'ammo_shotgun',
        count: 24,
        nameRu: 'Картечь 12G (x24)',
        nameEn: 'Shotgun Shells (x24)',
        credits: 60,
        materials: [{ type: 'scrap', count: 2 }]
    },
    craft_medkit: {
        id: 'craft_medkit',
        category: 'consumables',
        resultId: 'consumable_medkit',
        count: 1,
        nameRu: 'Полевая аптечка',
        nameEn: 'Field Medkit',
        credits: 100,
        materials: [{ type: 'scrap', count: 1 }, { type: 'fabric', count: 1 }]
    },
    craft_shield_battery: {
        id: 'craft_shield_battery',
        category: 'consumables',
        resultId: 'consumable_small_battery',
        count: 1,
        nameRu: 'Батарея щита',
        nameEn: 'Shield Battery',
        credits: 120,
        materials: [{ type: 'scrap', count: 1 }, { type: 'electronics', count: 1 }]
    },
    craft_stim: {
        id: 'craft_stim',
        category: 'consumables',
        resultId: 'consumable_stim',
        count: 1,
        nameRu: 'Боевой стимулятор',
        nameEn: 'Combat Stim',
        credits: 90,
        materials: [{ type: 'chemicals', count: 1 }]
    },
    upgrade_tempest_3: {
        id: 'upgrade_tempest_3',
        category: 'weapons',
        resultId: 'tempest_iii',
        count: 1,
        nameRu: 'Модификация: TEMPEST III',
        nameEn: 'Weapon Refinement: TEMPEST III',
        baseWeaponId: 'tempest_ii',
        credits: 800,
        materials: [{ type: 'scrap', count: 2 }, { type: 'sensor', count: 1 }]
    },
    upgrade_vulcano_2: {
        id: 'upgrade_vulcano_2',
        category: 'weapons',
        resultId: 'vulcano_ii',
        count: 1,
        nameRu: 'Модификация: VULCANO II',
        nameEn: 'Weapon Refinement: VULCANO II',
        baseWeaponId: 'vulcano_i',
        credits: 1000,
        materials: [{ type: 'scrap', count: 3 }, { type: 'core', count: 1 }]
    },
    upgrade_revolver_2: {
        id: 'upgrade_revolver_2',
        category: 'weapons',
        resultId: 'revolver_ii',
        count: 1,
        nameRu: 'Модификация: REVOLVER II',
        nameEn: 'Weapon Refinement: REVOLVER II',
        baseWeaponId: 'revolver_i',
        credits: 600,
        materials: [{ type: 'scrap', count: 2 }, { type: 'explosive', count: 1 }]
    },
    upgrade_rubezh_2: {
        id: 'upgrade_rubezh_2',
        category: 'weapons',
        resultId: 'rubezh_t2',
        count: 1,
        nameRu: 'Модификация: РУБЕЖ-76 (Полевой)',
        nameEn: 'Weapon Refinement: RUBEZH-76 (Field Mod)',
        baseWeaponId: 'rubezh_t1',
        credits: 350,
        materials: [{ type: 'scrap', count: 2 }]
    },
    upgrade_rubezh_3: {
        id: 'upgrade_rubezh_3',
        category: 'weapons',
        resultId: 'rubezh_t3',
        count: 1,
        nameRu: 'Модификация: РУБЕЖ-76 (Военный)',
        nameEn: 'Weapon Refinement: RUBEZH-76 (Military)',
        baseWeaponId: 'rubezh_t2',
        credits: 650,
        materials: [{ type: 'scrap', count: 2 }, { type: 'electronics', count: 1 }]
    },
    upgrade_rubezh_4: {
        id: 'upgrade_rubezh_4',
        category: 'weapons',
        resultId: 'rubezh_t4',
        count: 1,
        nameRu: 'Модификация: РУБЕЖ-76 (Гибрид ARC)',
        nameEn: 'Weapon Refinement: RUBEZH-76 (Machine Hybrid)',
        baseWeaponId: 'rubezh_t3',
        credits: 1400,
        materials: [{ type: 'scrap', count: 3 }, { type: 'sensor', count: 1 }, { type: 'core', count: 1 }]
    },
    craft_tempest_ii: {
        id: 'craft_tempest_ii',
        category: 'weapons',
        station: 'station_armory',
        resultId: 'tempest_ii',
        blueprintRequired: 'bp_tempest_ii',
        count: 1,
        nameRu: 'Штурмовая винтовка TEMPEST II',
        nameEn: 'Assault Rifle TEMPEST II',
        credits: 1200,
        materials: [{ type: 'scrap', count: 4 }, { type: 'electronics', count: 2 }]
    },
    craft_lance_sniper: {
        id: 'craft_lance_sniper',
        category: 'weapons',
        station: 'station_armory',
        resultId: 'lance_sniper',
        blueprintRequired: 'bp_lance_sniper',
        count: 1,
        nameRu: 'Снайперская винтовка LANCE DMR',
        nameEn: 'Precision Rifle LANCE DMR',
        credits: 2200,
        materials: [{ type: 'scrap', count: 5 }, { type: 'sensor', count: 2 }, { type: 'electronics', count: 2 }]
    },
    craft_shield_heavy: {
        id: 'craft_shield_heavy',
        category: 'armor',
        station: 'station_gear',
        resultId: 'shield_heavy',
        blueprintRequired: 'bp_shield_heavy',
        count: 1,
        nameRu: 'Тяжелый силовой щит',
        nameEn: 'Heavy Shield Core',
        credits: 1500,
        materials: [{ type: 'scrap', count: 4 }, { type: 'core', count: 1 }]
    },
    craft_emp_grenade: {
        id: 'craft_emp_grenade',
        category: 'gadgets',
        station: 'station_explosives',
        resultId: 'gadget_emp_grenade',
        blueprintRequired: 'bp_emp_grenade',
        count: 1,
        nameRu: 'ЭМИ-граната',
        nameEn: 'EMP Grenade',
        credits: 800,
        materials: [{ type: 'scrap', count: 2 }, { type: 'electronics', count: 2 }, { type: 'explosive', count: 1 }]
    },
    craft_hatch_key: {
        id: 'craft_hatch_key',
        category: 'materials',
        station: 'station_electronics',
        resultId: 'raider_hatch_key',
        blueprintRequired: 'bp_hatch_key',
        count: 1,
        nameRu: 'Ключ от бункера рейдеров',
        nameEn: 'Raider Bunker Key',
        credits: 1800,
        materials: [{ type: 'scrap', count: 3 }, { type: 'electronics', count: 3 }]
    },
    craft_frame_scout: {
        id: 'craft_frame_scout',
        category: 'augment',
        station: 'station_gear',
        resultId: 'frame_scout',
        count: 1,
        nameRu: 'Фрейм «Скаут»',
        nameEn: 'Scout Frame',
        credits: 1000,
        materials: [{ type: 'scrap', count: 3 }, { type: 'fabric', count: 2 }]
    },
    craft_frame_looter: {
        id: 'craft_frame_looter',
        category: 'augment',
        station: 'station_gear',
        resultId: 'frame_looter',
        count: 1,
        nameRu: 'Фрейм «Мародер»',
        nameEn: 'Looter Frame',
        credits: 2000,
        materials: [{ type: 'scrap', count: 5 }, { type: 'fabric', count: 3 }]
    }
};

/** @satisfies {Record<string, any>} */
const ARC_TRADERS = {
    marco: {
        id: 'marco',
        nameRu: 'Марко «Арсенал»',
        nameEn: 'Marco · The Armorer',
        roleRu: 'Оружейник Сперанцы',
        roleEn: 'Weapons & Munitions',
        descRu: 'Тяжелые стволы, надежные калибры и полевой ремонт.',
        descEn: 'Heavy kinetic firepower, reliable calibers and field maintenance.',
        inventory: [
            { id: 'buy_rubezh_t1', itemId: 'rubezh_t1', name: 'RUBEZH-76 T1', price: 3400, arcCores: 0, category: 'weapons' },
            { id: 'buy_tempest_ii', itemId: 'tempest_ii', name: 'TEMPEST II', price: 7500, arcCores: 0, category: 'weapons' },
            { id: 'buy_vulcano_i', itemId: 'vulcano_i', name: 'VULCANO I', price: 9500, arcCores: 0, category: 'weapons' },
            { id: 'buy_revolver_i', itemId: 'revolver_i', name: 'REVOLVER I', price: 2500, arcCores: 0, category: 'weapons' },
            { id: 'buy_ammo_heavy_60', itemId: 'ammo_heavy', name: 'HEAVY AMMO (x60)', count: 60, price: 300, arcCores: 0, category: 'ammo' },
            { id: 'buy_ammo_shotgun_24', itemId: 'ammo_shotgun', name: 'SHOTGUN SHELLS (x24)', count: 24, price: 250, arcCores: 0, category: 'ammo' },
            { id: 'buy_ammo_light_80', itemId: 'ammo_light', name: 'LIGHT AMMO (x80)', count: 80, price: 200, arcCores: 0, category: 'ammo' },
        ]
    },
    elena: {
        id: 'elena',
        nameRu: 'Д-р Елена',
        nameEn: 'Dr. Elena · Med-Corps',
        roleRu: 'Главврач мед-корпуса',
        roleEn: 'Trauma & Shield Tech',
        descRu: 'Биостимуляторы, реанимационные наборы и батареи щита.',
        descEn: 'Biostimulants, trauma kits and tactical shield overchargers.',
        inventory: [
            { id: 'buy_stim', itemId: 'consumable_stim', name: 'COMBAT STIM (x2)', count: 2, price: 350, arcCores: 0, category: 'consumables' },
            { id: 'buy_medkit', itemId: 'consumable_medkit', name: 'FIELD MEDKIT (x2)', count: 2, price: 500, arcCores: 0, category: 'consumables' },
            { id: 'buy_small_battery', itemId: 'consumable_small_battery', name: 'SHIELD BATTERY (x2)', count: 2, price: 400, arcCores: 0, category: 'consumables' },
            { id: 'buy_overcharger', itemId: 'consumable_overcharger', name: 'HEAVY OVERCHARGER', count: 1, price: 1200, arcCores: 0, category: 'consumables' },
        ]
    },
    bruno: {
        id: 'bruno',
        nameRu: 'Бруно «Скрап»',
        nameEn: 'Bruno · Scrap Syndicate',
        roleRu: 'Снабженец Синдиката',
        roleEn: 'Armored Cores & Rigging',
        descRu: 'Экспедиционные рюкзаки, силовые ядра и скупка трофеев с Поверхности.',
        descEn: 'Expedition backpacks, armored shield plates and surface salvage buyback.',
        inventory: [
            { id: 'buy_shield_light', itemId: 'shield_light', name: 'LIGHT SHIELD CORE', price: 1500, arcCores: 0, category: 'armor' },
            { id: 'buy_shield_medium', itemId: 'shield_medium', name: 'MEDIUM SHIELD CORE', price: 3200, arcCores: 0, category: 'armor' },
            { id: 'buy_shield_heavy', itemId: 'shield_heavy', name: 'HEAVY BULWARK CORE', price: 6800, arcCores: 2, category: 'armor' },
        ]
    },
    sofia: {
        id: 'sofia',
        nameRu: 'Инженер София',
        nameEn: 'Sofia · Omega Lab',
        roleRu: 'Главный инженер «Омега»',
        roleEn: 'Advanced Gadgets & Safe Pockets',
        descRu: 'Экспериментальные гаджеты, сонары и расширение защищенного кармана.',
        descEn: 'Experimental gadgets, acoustic pulse sonars and safe pocket expansions.',
        inventory: [
            { id: 'buy_gadget_grapple', itemId: 'gadget_grapple', name: 'GRAPPLING HOOK', price: 4500, arcCores: 1, category: 'gadgets' },
            { id: 'buy_gadget_pulse', itemId: 'gadget_pulse_radar', name: 'PULSE RADAR', price: 3800, arcCores: 0, category: 'gadgets' },
            { id: 'buy_safe_pocket_tier2', itemId: 'upgrade_pocket_2', name: 'SAFE POCKET (TIER 2: 2 SLOTS)', price: 3000, arcCores: 1, category: 'upgrade' },
            { id: 'buy_safe_pocket_tier3', itemId: 'upgrade_pocket_3', name: 'SAFE POCKET (TIER 3: 3 SLOTS)', price: 6500, arcCores: 3, category: 'upgrade' },
        ]
    }
};

/** @satisfies {Record<string, any>} */
const ARC_AUGMENTS = {
    FRAME_SCOUT: {
        id: 'frame_scout', name: 'SCOUT FRAME «STRIZH»', nameRu: 'ФРЕЙМ «СКАУТ»', tier: 'I', weight: 2.0, value: 2000,
        maxWeight: 25.0, safePocketSlots: 1, allowedShieldTier: 'I',
        noiseMultiplier: 0.70, sprintSpeedMultiplier: 1.10
    },
    FRAME_LOOTER: {
        id: 'frame_looter', name: 'LOOTER FRAME «MURAVEY»', nameRu: 'ФРЕЙМ «МАРОДЕР»', tier: 'II', weight: 4.5, value: 5500,
        maxWeight: 45.0, safePocketSlots: 3, allowedShieldTier: 'II',
        noiseMultiplier: 1.00, sprintSpeedMultiplier: 1.00, quickSlotBonus: 1
    },
    FRAME_ENFORCER: {
        id: 'frame_enforcer', name: 'ENFORCER FRAME «SHTURMOVIK»', nameRu: 'ФРЕЙМ «ШТУРМОВИК»', tier: 'III', weight: 9.0, value: 9500,
        maxWeight: 55.0, safePocketSlots: 2, allowedShieldTier: 'III',
        noiseMultiplier: 1.35, sprintSpeedMultiplier: 0.90, bonusMaxHp: 25
    }
};

/** @satisfies {Record<string, any>} */
const ARC_WORKSHOP_STATIONS = {
    REFINER: {
        id: 'station_refiner', nameRu: 'РАФИНЕР', nameEn: 'REFINER', maxLevel: 3, icon: 'recycle',
        descRu: 'Переработка пяти металлических деталей в один механический компонент.',
        descEn: 'Refines five metal parts into one mechanical component.',
        upgradeCosts: { 3: { credits: 0, materials: [{ type: 'queen_reactor', count: 1 }] } },
        recipes: ['refine_mechanical_component']
    },
    UTILITY: {
        id: 'station_utility', nameRu: 'СТАНЦИЯ ГАДЖЕТОВ', nameEn: 'UTILITY STATION', maxLevel: 3, icon: 'chip',
        descRu: 'Тактические устройства и инструменты доступа.', descEn: 'Tactical devices and access tools.',
        recipes: ['craft_hatch_key']
    },
    ARMORY: {
        id: 'station_armory', nameRu: 'ОРУЖЕЙНАЯ', nameEn: 'ARMORY', maxLevel: 3,
        icon: 'rifle',
        upgradeCosts: {
            2: { credits: 0, materials: [{ type: 'rusted_tools', count: 3 }, { type: 'mechanical_component', count: 5 }, { type: 'wasp_driver', count: 8 }] },
            3: { credits: 0, materials: [{ type: 'rusted_gears', count: 3 }, { type: 'advanced_mechanical_component', count: 5 }, { type: 'sentinel_firing_core', count: 4 }] }
        },
        descRu: 'Сборка огнестрельного оружия и многоуровневая модификация автоматов «РУБЕЖ-76».',
        descEn: 'Firearm fabrication and multi-tier refinement for «RUBEZH-76» assault rifles.',
        recipes: ['craft_tempest_ii', 'craft_lance_sniper', 'upgrade_tempest_3', 'upgrade_vulcano_2', 'upgrade_revolver_2', 'upgrade_rubezh_2', 'upgrade_rubezh_3', 'upgrade_rubezh_4']
    },
    GEAR: {
        id: 'station_gear', nameRu: 'МОДУЛЬНАЯ И БРОНЯ', nameEn: 'GEAR & ARMOR', maxLevel: 3,
        icon: 'shield',
        descRu: 'Производство энергощитов, защитных экзоскелетов и тактических фреймов оператора.',
        descEn: 'Shield core fabrication, protective exoskeletons, and operator tactical frames.',
        recipes: ['craft_shield_battery', 'craft_shield_heavy', 'craft_frame_scout', 'craft_frame_looter']
    },
    MUNITIONS: {
        id: 'station_munitions', nameRu: 'БОЕПРИПАСЫ', nameEn: 'MUNITIONS', maxLevel: 3,
        icon: 'ammo',
        descRu: 'Синтез порохов и штамповка легких, тяжелых патронов и картечи 12-го калибра.',
        descEn: 'Propellant synthesis and stamping of light, heavy, and 12-gauge shotgun ammunition.',
        recipes: ['craft_ammo_light', 'craft_ammo_heavy', 'craft_ammo_shotgun']
    },
    MEDLAB: {
        id: 'station_medlab', nameRu: 'МЕДЛАБОРАТОРИЯ', nameEn: 'MED-LAB', maxLevel: 3,
        icon: 'medkit',
        descRu: 'Фармацевтический синтез полевых стимуляторов и армейских инъекторов.',
        descEn: 'Pharmaceutical compounding of field combat stims and military medkits.',
        recipes: ['craft_medkit', 'craft_stim']
    },
    EXPLOSIVES: {
        id: 'station_explosives', nameRu: 'ВЗРЫВЧАТКА', nameEn: 'EXPLOSIVES', maxLevel: 3,
        upgradeCosts: { 3: { credits: 0, materials: [{ type: 'laboratory_reagents', count: 3 }, { type: 'explosive_compounds', count: 5 }, { type: 'rocketeer_driver', count: 3 }] } },
        icon: 'explosive',
        descRu: 'Сборка тактических ЭМИ-гранат и направленных противопехотных зарядов.',
        descEn: 'Tactical assembly of EMP grenades and directional shaped anti-personnel charges.',
        recipes: ['craft_emp_grenade']
    },
    ELECTRONICS: {
        id: 'station_electronics', nameRu: 'ЭЛЕКТРОНИКА', nameEn: 'ELECTRONICS', maxLevel: 3,
        icon: 'chip',
        descRu: 'Прошивка электронных ключей доступа к секретным бункерам рейдеров.',
        descEn: 'Firmware decoding and encoding of master keys for sealed raider bunker hatches.',
        recipes: ['craft_hatch_key']
    },
    RECYCLER: {
        id: 'station_recycler', nameRu: 'ПЕРЕРАБОТЧИК', nameEn: 'RECYCLER', maxLevel: 3,
        icon: 'recycle',
        descRu: 'Утилизация трофейного снаряжения в сырьевые детали роботов, ткани и микросхемы.',
        descEn: 'Salvage processing of recovered gear into raw robot alloys, fabrics, and microchips.',
        yieldMultiplier: [1.0, 1.25, 1.50]
    },
    SCRAPPY: {
        id: 'station_scrappy', nameRu: 'СКРАППИ (ДРОН-СБОРЩИК)', nameEn: 'SCRAPPY DRONE', maxLevel: 3,
        icon: 'drone',
        descRu: 'Автономный дрон-сборщик. Патрулирует внешнюю зону Сперанцы и собирает металлолом.',
        descEn: 'Autonomous scavenger drone. Patrols Speranza exterior perimeter for salvaged scrap.',
        baseDrop: { scrap: 15, credits: 100 }
    }
};

/** @satisfies {Record<number, { credits: number, materials: Array<{ type: string, count: number }> }>} */
const ARC_STATION_UPGRADE_COSTS = {
    2: { credits: 600, materials: [{ type: 'scrap', count: 4 }] },
    3: { credits: 1500, materials: [{ type: 'scrap', count: 8 }, { type: 'electronics', count: 2 }] }
};

/** @satisfies {Record<string, any>} */
const ARC_BLUEPRINTS = {
    bp_tempest_ii: { id: 'bp_tempest_ii', targetItem: 'tempest_ii', targetRecipe: 'craft_tempest_ii', station: 'station_armory', value: 4500 },
    bp_lance_sniper: { id: 'bp_lance_sniper', targetItem: 'lance_sniper', targetRecipe: 'craft_lance_sniper', station: 'station_armory', value: 7000 },
    bp_shield_heavy: { id: 'bp_shield_heavy', targetItem: 'shield_heavy', targetRecipe: 'craft_shield_heavy', station: 'station_gear', value: 5000 },
    bp_emp_grenade: { id: 'bp_emp_grenade', targetItem: 'gadget_emp_grenade', targetRecipe: 'craft_emp_grenade', station: 'station_explosives', value: 3500 },
    bp_hatch_key: { id: 'bp_hatch_key', targetItem: 'raider_hatch_key', targetRecipe: 'craft_hatch_key', station: 'station_electronics', value: 6000 }
};

/** @satisfies {Record<string, any>} */
const ARC_ENV_OBJECTS = {
    FUEL_BARREL: { hp: 25, explodeRadius: 160, explodeDamage: 120, burnDurationSec: 8.0, soundRadius: 500 },
    EMP_JUNCTION: { hp: 20, empRadius: 180, stunDurationSec: 5.0, shieldDrain: 150 },
    RAIDER_HATCH: { requiredKey: 'raider_hatch_key', interactionSec: 3.0, noiseRadius: 25 }
};
