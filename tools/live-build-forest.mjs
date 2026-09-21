// ============================================================================
//  tools/live-build-forest.mjs — Ultra-Optimized Live Forest Map Builder
//  Generates clean, professional level design (~70 deliberate single-mesh props)
//  and streams live to ArcEngine editor over SSE (/api/live-action).
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const MAP_PATH = path.join(ROOT, 'assets', 'levels', 'forest_map.json');
const LIVE_API = 'http://127.0.0.1:8090/api/live-action';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendLive(action) {
    try {
        await fetch(LIVE_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action)
        });
    } catch (_) {}
}

function createRng(seed = 101) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function() {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

const rng = createRng(101);
const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;

async function run() {
    console.log('🌲 [ArcEngine Live Builder] Starting Ultra-Optimized Forest Assembly...');

    // 1. Load map template
    const raw = await fs.readFile(MAP_PATH, 'utf8');
    const level = JSON.parse(raw);

    // 2. Setup Crisp Atmospheric Forest Lighting
    const forestLighting = {
        timeOfDay: 14.0,
        cycleEnabled: false,
        cycleSpeed: 15,
        sunEnabled: true,
        sunAzimuth: 220,
        sunElevation: 45,
        sunIntensity: 1.25,
        sunColor: '#FFF8E7',
        ambientIntensity: 0.5,
        skyColor: '#6BA3D6',
        groundColor: '#2E3B23'
    };

    level.lighting = forestLighting;
    level.environment = {
        skyline: false,
        roads: false,
        structures: false,
        rubble: false
    };
    level.ground = {
        preset: 'mud',
        diff: '/assets/textures/pbr/brown_mud_leaves_01_diff_2k.jpg',
        nor: '/assets/textures/pbr/brown_mud_leaves_01_nor_gl_2k.jpg',
        rough: '/assets/textures/pbr/brown_mud_leaves_01_rough_2k.jpg',
        color: '#ffffff',
        uScale: 4.0,
        vScale: 4.0,
        uOffset: 0,
        vOffset: 0,
        rot: 0,
        roughness: 0.88,
        metallic: 0
    };
    level.noEnemies = true;
    level.spawn = { x: 2135, y: 983, heading: 0 };
    level.extraction = { x: 2080, y: 3600, radius: 140 };

    // Broadcast live initialization
    await sendLive({ type: 'STATUS', text: '🌲 Начинаем сборку оптимизированного леса...', toast: true });
    await sleep(400);

    await sendLive({ type: 'CLEAR_PROPS' });
    await sendLive({ type: 'SET_LIGHTING', lighting: forestLighting });
    await sleep(400);

    const allProps = [];
    let propId = 1;

    function addProp(name, model, x, y, options = {}) {
        const scale = options.scale || [1, 1, 1];
        const rot = options.rot || [0, r1(rng() * 360), 0];
        const h = options.h || 0;
        const def = {
            name: `${name}_${propId++}`,
            model: `assets/models/forest/${model}`,
            kind: 'prop',
            x: r1(x),
            y: r1(y),
            h: r1(h),
            rot: rot,
            scale: scale
        };
        allProps.push(def);
        return def;
    }

    // ------------------------------------------------------------------------
    // ZONE 1: Survivor Camp / Spawn Area (X: 2135, Y: 983)
    // ------------------------------------------------------------------------
    console.log('📍 [Zone 1] Building Survivor Camp...');
    await sendLive({ type: 'STATUS', text: '⛺ Зона 1: Лагерь выживших у спавна...', toast: true });
    await sendLive({ type: 'FOCUS_CAMERA', x: 2135, y: 983 });
    await sleep(400);

    const campBatch = [
        addProp('Campfire', 'campfire_ring.glb', 2125, 995, { rot: [0, 45, 0], scale: [1.2, 1.2, 1.2] }),
        addProp('CampLog_N', 'log_mossy.glb', 2125, 1006, { rot: [0, 0, 0] }),
        addProp('CampLog_S', 'log_mossy.glb', 2125, 984, { rot: [0, 180, 0] }),
        addProp('CampLog_W', 'log_mossy.glb', 2112, 995, { rot: [0, 90, 0] }),
        addProp('CampShelter', 'cabin_shelter.glb', 2148, 998, { rot: [0, -90, 0], scale: [1.1, 1.1, 1.1] }),
        addProp('CampCrates', 'wood_crates_stack.glb', 2146, 1008, { rot: [0, 15, 0] }),
        addProp('CampFence_1', 'wood_fence.glb', 2102, 970, { rot: [0, 30, 0] }),
        addProp('CampFence_2', 'wood_fence.glb', 2158, 972, { rot: [0, -25, 0] }),
        addProp('CampBirch_1', 'birch_tall.glb', 2095, 992, { scale: [1.1, 1.1, 1.1] }),
        addProp('CampBirch_2', 'birch_twin.glb', 2106, 1022, { scale: [1, 1, 1] }),
        addProp('CampBirch_3', 'birch_tall.glb', 2136, 1028, { scale: [1.15, 1.15, 1.15] }),
        addProp('CampSpruce_1', 'spruce_young.glb', 2085, 972, { scale: [1, 1, 1] }),
        addProp('CampSpruce_2', 'spruce_young.glb', 2142, 962, { scale: [1, 1, 1] }),
        addProp('CampBush_1', 'bush_fern.glb', 2115, 1010, { scale: [1.2, 1.2, 1.2] }),
        addProp('CampBush_2', 'bush_dense.glb', 2155, 1014, { scale: [1.1, 1.1, 1.1] })
    ];

    await sendLive({ type: 'BATCH_ADD_PROPS', defs: campBatch });
    await sleep(500);

    // ------------------------------------------------------------------------
    // ZONE 2: Main Forest Trail & Winding Paths
    // ------------------------------------------------------------------------
    console.log('📍 [Zone 2] Building Main Forest Trail...');
    await sendLive({ type: 'STATUS', text: '🪵 Зона 2: Лесная тропа и гати через низины...', toast: true });
    await sendLive({ type: 'FOCUS_CAMERA', x: 2110, y: 1500 });
    await sleep(400);

    const trailBatch = [
        addProp('Plank_1', 'wood_planks_path.glb', 2120, 1160, { rot: [0, 5, 0] }),
        addProp('Plank_2', 'wood_planks_path.glb', 2115, 1340, { rot: [0, -8, 0] }),
        addProp('Plank_3', 'wood_planks_path.glb', 2100, 1540, { rot: [0, 12, 0] }),
        addProp('Plank_4', 'wood_planks_path.glb', 2085, 1780, { rot: [0, -6, 0] }),
        addProp('Plank_5', 'wood_planks_path.glb', 2090, 2040, { rot: [0, 8, 0] }),
        addProp('Plank_6', 'wood_planks_path.glb', 2110, 2350, { rot: [0, -10, 0] }),
        addProp('Plank_7', 'wood_planks_path.glb', 2125, 2620, { rot: [0, 6, 0] }),
        addProp('TrailMarker_1', 'rock_cluster.glb', 2132, 1155, { scale: [1.1, 1.1, 1.1] }),
        addProp('TrailMarker_2', 'rock_cluster.glb', 2072, 1775, { scale: [1.2, 1.2, 1.2] }),
        addProp('TrailLog_1', 'log_mossy.glb', 2136, 1335, { rot: [0, 30, 0] }),
        addProp('TrailLog_2', 'log_mossy.glb', 2070, 2045, { rot: [0, -40, 0] })
    ];

    await sendLive({ type: 'BATCH_ADD_PROPS', defs: trailBatch });
    await sleep(500);

    // ------------------------------------------------------------------------
    // ZONE 3: Pine Ridge & Forestry Watchtower (East Hill, X: 3050, Y: 2150)
    // ------------------------------------------------------------------------
    console.log('📍 [Zone 3] Building Pine Ridge & Watchtower...');
    await sendLive({ type: 'STATUS', text: '🌲 Зона 3: Смотровая вышка и Сосновый кряж...', toast: true });
    await sendLive({ type: 'FOCUS_CAMERA', x: 3050, y: 2150 });
    await sleep(400);

    const ridgeBatch = [
        addProp('Watchtower', 'watchtower_wood.glb', 3050, 2150, { rot: [0, 40, 0], scale: [1.25, 1.25, 1.25] }),
        addProp('TowerFence_1', 'wood_fence.glb', 3036, 2145, { rot: [0, 90, 0] }),
        addProp('TowerFence_2', 'wood_fence.glb', 3064, 2145, { rot: [0, 90, 0] }),
        addProp('TowerCrates', 'wood_crates_stack.glb', 3042, 2155, { rot: [0, 20, 0] }),
        addProp('RidgeBoulder_1', 'rock_boulder.glb', 3010, 2120, { scale: [1.5, 1.5, 1.5] }),
        addProp('RidgeBoulder_2', 'rock_boulder.glb', 3080, 2130, { scale: [1.6, 1.6, 1.6] }),
        addProp('RidgeBoulder_3', 'rock_boulder.glb', 3040, 2100, { scale: [1.3, 1.3, 1.3] }),
        addProp('RidgeRocks_1', 'rock_cluster.glb', 3020, 2115, { scale: [1.2, 1.2, 1.2] }),
        addProp('RidgePine_1', 'pine_tall.glb', 3000, 2160, { scale: [1.2, 1.2, 1.2] }),
        addProp('RidgePine_2', 'pine_crooked.glb', 3025, 2185, { scale: [1.1, 1.1, 1.1] }),
        addProp('RidgePine_3', 'pine_tall.glb', 3085, 2165, { scale: [1.25, 1.25, 1.25] }),
        addProp('RidgePine_4', 'pine_crooked.glb', 3070, 2195, { scale: [1.15, 1.15, 1.15] }),
        addProp('RidgePine_5', 'pine_tall.glb', 3045, 2220, { scale: [1.3, 1.3, 1.3] }),
        addProp('RidgePine_6', 'pine_tall.glb', 3015, 2100, { scale: [1.1, 1.1, 1.1] })
    ];

    await sendLive({ type: 'BATCH_ADD_PROPS', defs: ridgeBatch });
    await sleep(500);

    // ------------------------------------------------------------------------
    // ZONE 4: Ancient Oak Grove (West Wilds, X: 1250, Y: 2100)
    // ------------------------------------------------------------------------
    console.log('📍 [Zone 4] Building Ancient Oak Grove...');
    await sendLive({ type: 'STATUS', text: '🌳 Зона 4: Реликтовая дубрава и древняя чаща...', toast: true });
    await sendLive({ type: 'FOCUS_CAMERA', x: 1250, y: 2100 });
    await sleep(400);

    const groveBatch = [
        addProp('Oak_1', 'oak_ancient.glb', 1250, 2100, { scale: [1.4, 1.4, 1.4] }),
        addProp('Oak_2', 'oak_ancient.glb', 1190, 2030, { scale: [1.3, 1.3, 1.3] }),
        addProp('Oak_3', 'oak_ancient.glb', 1315, 2060, { scale: [1.35, 1.35, 1.35] }),
        addProp('Oak_4', 'oak_ancient.glb', 1230, 2180, { scale: [1.25, 1.25, 1.25] }),
        addProp('OakBoulder_1', 'rock_boulder.glb', 1265, 2090, { scale: [1.4, 1.4, 1.4] }),
        addProp('OakBoulder_2', 'rock_boulder.glb', 1205, 2045, { scale: [1.3, 1.3, 1.3] }),
        addProp('OakLog', 'log_mossy.glb', 1238, 2110, { rot: [0, 45, 0] }),
        addProp('GroveSpruce_1', 'spruce_dense.glb', 1285, 2125, { scale: [1.2, 1.2, 1.2] }),
        addProp('GroveSpruce_2', 'spruce_dense.glb', 1170, 2075, { scale: [1.15, 1.15, 1.15] }),
        addProp('GroveSpruce_3', 'spruce_dense.glb', 1220, 2220, { scale: [1.25, 1.25, 1.25] }),
        addProp('GroveBush_1', 'bush_dense.glb', 1255, 2075, { scale: [1.3, 1.3, 1.3] }),
        addProp('GroveBush_2', 'bush_fern.glb', 1215, 2160, { scale: [1.2, 1.2, 1.2] })
    ];

    await sendLive({ type: 'BATCH_ADD_PROPS', defs: groveBatch });
    await sleep(500);

    // ------------------------------------------------------------------------
    // ZONE 5: Lumberjack Logging Site (Central-North, X: 2300, Y: 2850)
    // ------------------------------------------------------------------------
    console.log('📍 [Zone 5] Building Logging Site...');
    await sendLive({ type: 'STATUS', text: '🪵 Зона 5: Вырубка и лагерь лесорубов...', toast: true });
    await sendLive({ type: 'FOCUS_CAMERA', x: 2300, y: 2850 });
    await sleep(400);

    const loggingBatch = [
        addProp('LogShelter', 'cabin_shelter.glb', 2335, 2855, { rot: [0, -110, 0] }),
        addProp('LogCrates_1', 'wood_crates_stack.glb', 2295, 2835, { rot: [0, 15, 0] }),
        addProp('LogCrates_2', 'wood_crates_stack.glb', 2315, 2875, { rot: [0, -30, 0] }),
        addProp('LogFence', 'wood_fence.glb', 2245, 2825, { rot: [0, 25, 0] }),
        addProp('Timber_1', 'log_mossy.glb', 2280, 2840, { rot: [0, 20, 0], scale: [1.2, 1.2, 1.2] }),
        addProp('Timber_2', 'log_mossy.glb', 2284, 2844, { rot: [0, 22, 0], scale: [1.2, 1.2, 1.2] }),
        addProp('Timber_3', 'log_mossy.glb', 2315, 2865, { rot: [0, -25, 0], scale: [1.2, 1.2, 1.2] }),
        addProp('Stump_1', 'stump_old.glb', 2270, 2860, { scale: [1.2, 1.2, 1.2] }),
        addProp('Stump_2', 'stump_old.glb', 2300, 2820, { scale: [1.1, 1.1, 1.1] }),
        addProp('Stump_3', 'stump_old.glb', 2330, 2885, { scale: [1.15, 1.15, 1.15] }),
        addProp('BorderSpruce_1', 'spruce_dense.glb', 2240, 2870, { scale: [1.2, 1.2, 1.2] }),
        addProp('BorderSpruce_2', 'spruce_dense.glb', 2360, 2830, { scale: [1.25, 1.25, 1.25] })
    ];

    await sendLive({ type: 'BATCH_ADD_PROPS', defs: loggingBatch });
    await sleep(500);

    // ------------------------------------------------------------------------
    // ZONE 6: North Extraction LZ (X: 2080, Y: 3600)
    // ------------------------------------------------------------------------
    console.log('📍 [Zone 6] Building Extraction Zone...');
    await sendLive({ type: 'STATUS', text: '🚁 Зона 6: Зона эвакуации на севере...', toast: true });
    await sendLive({ type: 'FOCUS_CAMERA', x: 2080, y: 3600 });
    await sleep(400);

    const extractBatch = [
        addProp('LZMarker_N', 'rock_cluster.glb', 2080, 3730, { scale: [1.3, 1.3, 1.3] }),
        addProp('LZMarker_S', 'rock_cluster.glb', 2080, 3470, { scale: [1.3, 1.3, 1.3] }),
        addProp('LZMarker_E', 'rock_cluster.glb', 2210, 3600, { scale: [1.3, 1.3, 1.3] }),
        addProp('LZMarker_W', 'rock_cluster.glb', 1950, 3600, { scale: [1.3, 1.3, 1.3] }),
        addProp('LZBarrier_1', 'wood_fence.glb', 2085, 3480, { rot: [0, 90, 0] }),
        addProp('LZBarrier_2', 'wood_fence.glb', 2075, 3720, { rot: [0, 90, 0] }),
        addProp('LZPine_1', 'pine_tall.glb', 1930, 3650, { scale: [1.3, 1.3, 1.3] }),
        addProp('LZPine_2', 'pine_tall.glb', 2230, 3650, { scale: [1.35, 1.35, 1.35] }),
        addProp('LZPine_3', 'pine_tall.glb', 2030, 3760, { scale: [1.25, 1.25, 1.25] }),
        addProp('LZPine_4', 'pine_tall.glb', 2130, 3760, { scale: [1.25, 1.25, 1.25] }),
        addProp('LZPine_5', 'pine_tall.glb', 1980, 3490, { scale: [1.2, 1.2, 1.2] }),
        addProp('LZPine_6', 'pine_tall.glb', 2180, 3490, { scale: [1.2, 1.2, 1.2] })
    ];

    await sendLive({ type: 'BATCH_ADD_PROPS', defs: extractBatch });
    await sleep(500);

    console.log(`✅ [Level Complete] Placed total ${allProps.length} clean single-mesh props!`);

    // ------------------------------------------------------------------------
    // FINALIZE & SAVE
    // ------------------------------------------------------------------------
    level.props = allProps;

    console.log('💾 Saving forest_map.json...');
    const tmp = MAP_PATH + '.' + Date.now() + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(level, null, 2), 'utf8');
    await fs.rename(tmp, MAP_PATH);

    // Notify Editor Live Agent
    await sendLive({ type: 'FINISH_BUILD' });

    console.log('🎉 [Success] Forest Map level design fully constructed and saved!');
}

run().catch(console.error);
