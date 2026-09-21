import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadScripts } from './browser-scripts.mjs';

const require = createRequire(import.meta.url);
const DayNightCycle = require('../js/DayNightCycle.js');

test('DayNightCycle loads properly in Node.js and browser-script VM environments', () => {
    // 1. Direct Node.js require
    assert.ok(DayNightCycle, 'DayNightCycle exported via module.exports');
    const directCycle = new DayNightCycle();
    assert.ok(directCycle instanceof DayNightCycle);

    // 2. VM loadScripts environment (simulating browser script tag)
    const { get } = loadScripts(['js/DayNightCycle.js']);
    const VmDayNightCycle = get('DayNightCycle');
    assert.ok(VmDayNightCycle, 'DayNightCycle available in VM global');
    const vmCycle = new VmDayNightCycle();
    assert.equal(typeof vmCycle.update, 'function');
    assert.equal(typeof vmCycle.setTime, 'function');
    assert.equal(typeof vmCycle.getTime, 'function');
    assert.equal(typeof vmCycle.getLightingState, 'function');
});

test('24-hour diurnal cycle: 12-minute default loop and customizable speed', () => {
    const cycle = new DayNightCycle({
        dayDurationSec: 720, // 12 minutes = 720 seconds
        initialTime: 12.0
    });

    assert.equal(cycle.getTime(), 12.0);
    assert.equal(cycle.getTimeFormatted(), '12:00');

    // In 720s, a full 24 hours passes: 1 second = 24 / 720 = 1 / 30 hours = 2 minutes.
    // 30 seconds = 1 hour.
    cycle.update(30);
    assert.ok(Math.abs(cycle.getTime() - 13.0) < 1e-5, 'After 30s at 12min loop, exactly 1 hour passes');
    assert.equal(cycle.getTimeFormatted(), '13:00');

    // 360 seconds = 12 hours -> should reach 01:00 (13 + 12 = 25 -> 1)
    cycle.update(360);
    assert.ok(Math.abs(cycle.getTime() - 1.0) < 1e-5, 'Wraps past midnight accurately');
    assert.equal(cycle.getTimeFormatted(), '01:00');

    // Test setTime and wrapping
    cycle.setTime(5.5);
    assert.equal(cycle.getTime(), 5.5);
    assert.equal(cycle.getTimeFormatted(), '05:30');

    cycle.setTime(26.25);
    assert.ok(Math.abs(cycle.getTime() - 2.25) < 1e-5, 'Wraps > 24 correctly');
    assert.equal(cycle.getTimeFormatted(), '02:15');

    cycle.setTime(-1.5);
    assert.ok(Math.abs(cycle.getTime() - 22.5) < 1e-5, 'Wraps negative numbers correctly');
    assert.equal(cycle.getTimeFormatted(), '22:30');

    // Test speed multiplier
    cycle.setTime(10.0);
    cycle.setSpeedMultiplier(2.0);
    cycle.update(15); // 15s * 2x speed = 30s effective = 1 hour
    assert.ok(Math.abs(cycle.getTime() - 11.0) < 1e-5, 'Speed multiplier works');

    // Test pause
    cycle.pause();
    cycle.update(60);
    assert.ok(Math.abs(cycle.getTime() - 11.0) < 1e-5, 'Paused cycle does not advance');
    cycle.resume();
    cycle.update(15);
    assert.ok(cycle.getTime() > 11.0, 'Resumed cycle advances');
});

test('Solar position calculation: Azimuth 360° and Elevation curve', () => {
    const cycle = new DayNightCycle();

    // 1. Azimuth rotates 360 degrees
    cycle.setTime(0.0);
    assert.ok(Math.abs(cycle.sunAz - 0.0) < 1e-5, 'Midnight azimuth 0°');
    cycle.setTime(6.0);
    assert.ok(Math.abs(cycle.sunAz - 90.0) < 1e-5, '06:00 azimuth 90°');
    cycle.setTime(12.0);
    assert.ok(Math.abs(cycle.sunAz - 180.0) < 1e-5, 'Noon azimuth 180°');
    cycle.setTime(18.0);
    assert.ok(Math.abs(cycle.sunAz - 270.0) < 1e-5, '18:00 azimuth 270°');

    // 2. Elevation:
    // Dawn (05:00): rises at 0°
    cycle.setTime(5.0);
    assert.ok(Math.abs(cycle.sunEl - 0.0) < 1e-5, `Dawn (05:00) elevation must be 0°, got ${cycle.sunEl}`);

    // Noon (12:00): zenith at 65°
    cycle.setTime(12.0);
    assert.ok(Math.abs(cycle.sunEl - 65.0) < 1e-5, `Noon (12:00) elevation must be 65°, got ${cycle.sunEl}`);

    // Dusk (19:00): sets at 0°
    cycle.setTime(19.0);
    assert.ok(Math.abs(cycle.sunEl - 0.0) < 1e-5, `Dusk (19:00) elevation must be 0°, got ${cycle.sunEl}`);

    // Night (00:00 / midnight): dips below horizon at -30°
    cycle.setTime(0.0);
    assert.ok(Math.abs(cycle.sunEl - (-30.0)) < 1e-5, `Midnight (00:00) elevation must be -30°, got ${cycle.sunEl}`);

    // Test intermediate elevation smoothness
    // 08:30 (quarter day): elevation should be positive and between 0 and 65
    cycle.setTime(8.5);
    assert.ok(cycle.sunEl > 0 && cycle.sunEl < 65, 'Morning elevation is between 0 and 65');

    // 21:30 (night): elevation should be negative and between -30 and 0
    cycle.setTime(21.5);
    assert.ok(cycle.sunEl < 0 && cycle.sunEl >= -30, 'Night elevation is between -30 and 0');

    // 3. getSunDirection()
    cycle.setTime(12.0);
    const noonDir = cycle.getSunDirection();
    assert.ok(noonDir.y < 0, 'Noon sun vector points downward');
    assert.ok(Math.abs(noonDir.y - (-Math.sin(65 * Math.PI / 180))) < 1e-4);

    cycle.setTime(0.0);
    const nightDir = cycle.getSunDirection();
    assert.ok(nightDir.y > 0, 'Midnight sun below horizon produces y > 0');
});

test('Sky and Lighting color gradients across diurnal phases', () => {
    const cycle = new DayNightCycle();

    // 1. Dawn (05:00 - 07:00): soft golden-rose sky, warm low-angle sunlight, long shadows, dense morning mist
    cycle.setTime(5.5);
    const dawnState = cycle.getLightingState();
    assert.equal(dawnState.period, 'dawn');
    assert.ok(dawnState.fog >= 0.0014, `Dawn mist should be dense, got ${dawnState.fog}`);
    assert.ok(dawnState.shadowStrength >= 0.60, 'Dawn has long strong shadows');
    assert.ok(dawnState.sunIntensity > 0.7 && dawnState.sunIntensity < 1.5, 'Warm low-angle sunlight intensity');

    // 2. Midday (07:00 - 17:00): harsh desaturated wasteland sun, sharp dark shadows, clear horizon
    cycle.setTime(12.0);
    const middayState = cycle.getLightingState();
    assert.equal(middayState.period, 'midday');
    assert.ok(middayState.sunIntensity >= 2.0, `Harsh wasteland sun intensity >= 2.0, got ${middayState.sunIntensity}`);
    assert.ok(middayState.fog <= 0.0004, `Clear horizon mist <= 0.0004, got ${middayState.fog}`);
    assert.ok(middayState.shadowSoft <= 1.0, `Sharp shadows soft <= 1.0, got ${middayState.shadowSoft}`);

    // 3. Dusk (17:00 - 20:00): crimson-copper apocalyptic sunset, deep violet shadows
    cycle.setTime(18.3);
    const duskState = cycle.getLightingState();
    assert.equal(duskState.period, 'dusk');
    assert.ok(duskState.shadowStrength >= 0.68, 'Dusk deep shadows');
    // Check crimson-copper sunset sky color: red component dominates blue
    const duskSkyR = (duskState.sky >> 16) & 255;
    const duskSkyB = duskState.sky & 255;
    assert.ok(duskSkyR > duskSkyB * 2, 'Dusk sky is fiery crimson-copper');

    // 4. Night (20:00 - 05:00): dark midnight blue/black sky, pale moonlight, deep shadows
    cycle.setTime(0.0);
    const nightState = cycle.getLightingState();
    assert.equal(nightState.period, 'night');
    assert.equal(nightState.isNight, true);
    assert.ok(nightState.sunIntensity <= 0.3, `Pale moonlight intensity <= 0.3, got ${nightState.sunIntensity}`);
    assert.ok(nightState.shadowStrength >= 0.80, `Deep night shadows >= 0.80, got ${nightState.shadowStrength}`);
    // Sky is dark midnight blue/black: all components very low
    const nightSkyR = (nightState.sky >> 16) & 255;
    const nightSkyG = (nightState.sky >> 8) & 255;
    const nightSkyB = nightState.sky & 255;
    assert.ok(nightSkyR < 30 && nightSkyG < 30 && nightSkyB < 35, 'Night sky is dark midnight black/blue');
});

test('Night mode enhancements: isNight, getLightingState for World3D, and searchlight/emissive boosting', () => {
    const cycle = new DayNightCycle();

    // 1. isNight() checks
    cycle.setTime(4.9);
    assert.equal(cycle.isNight(), true, '04:54 is night');
    cycle.setTime(5.0);
    assert.equal(cycle.isNight(), false, '05:00 is dawn (not night)');
    cycle.setTime(12.0);
    assert.equal(cycle.isNight(), false, '12:00 is midday (not night)');
    cycle.setTime(19.9);
    assert.equal(cycle.isNight(), false, '19:54 is dusk (not night)');
    cycle.setTime(20.0);
    assert.equal(cycle.isNight(), true, '20:00 is night');
    cycle.setTime(23.5);
    assert.equal(cycle.isNight(), true, '23:30 is night');

    // 2. getLightingState() produces all fields expected by World3D.applyLighting
    const state = cycle.getLightingState();
    const requiredFields = [
        'sunAz', 'sunEl', 'sunIntensity', 'sunColor',
        'skyIntensity', 'skyLight', 'groundLight', 'sky', 'fog',
        'shadowColor', 'shadowStrength', 'shadowSoft',
        'shadowRadius', 'shadowBias', 'shadowNormalBias'
    ];
    for (const field of requiredFields) {
        assert.ok(field in state, `getLightingState must provide field '${field}'`);
    }

    // 3. Searchlight and emissive boosting
    const mockSearchlightMat = {
        name: 'spotter-light-mat-1',
        alpha: 0.25,
        emissiveColor: { r: 0.2, g: 0.8, b: 0.8 }
    };
    const mockEyeMat = {
        name: 'robot-eye-mat',
        emissiveColor: { r: 1.0, g: 0.1, b: 0.1 }
    };
    const mockScene = {
        materials: [mockSearchlightMat, mockEyeMat]
    };

    // Daytime: applyToScene should keep baseline values
    cycle.setTime(12.0);
    cycle.applyToScene(mockScene);
    assert.equal(mockSearchlightMat.alpha, 0.25, 'Searchlight alpha at midday stays at base');
    assert.equal(mockSearchlightMat.emissiveColor.r, 0.2, 'Searchlight emissive at midday stays at base');
    assert.equal(mockEyeMat.emissiveColor.r, 1.0, 'Eye emissive at midday stays at base');

    // Nighttime: applyToScene should boost searchlight alpha and emissive
    cycle.setTime(0.0);
    cycle.applyToScene(mockScene);
    assert.ok(mockSearchlightMat.alpha > 0.5, `Searchlight alpha boosted at night: ${mockSearchlightMat.alpha}`);
    assert.ok(mockSearchlightMat.emissiveColor.g > 1.5, `Searchlight emissive boosted at night: ${mockSearchlightMat.emissiveColor.g}`);
    assert.ok(mockEyeMat.emissiveColor.r > 1.5, `Eye emissive boosted at night: ${mockEyeMat.emissiveColor.r}`);

    // Return to daytime: should restore baseline
    cycle.setTime(12.0);
    cycle.applyToScene(mockScene);
    assert.ok(Math.abs(mockSearchlightMat.alpha - 0.25) < 1e-4, 'Searchlight alpha restored on day');
    assert.ok(Math.abs(mockSearchlightMat.emissiveColor.g - 0.8) < 1e-4, 'Searchlight emissive restored on day');
    assert.ok(Math.abs(mockEyeMat.emissiveColor.r - 1.0) < 1e-4, 'Eye emissive restored on day');
});

test('applyToScene works seamlessly with View3D.applyLighting', () => {
    const cycle = new DayNightCycle();
    cycle.setTime(12.0);

    let appliedConfig = null;
    const mockView3D = {
        scene: { materials: [] },
        applyLighting: (c) => { appliedConfig = c; }
    };

    const returnedState = cycle.applyToScene(mockView3D);
    assert.ok(appliedConfig, 'view3d.applyLighting called');
    assert.equal(appliedConfig.sunEl, 65.0);
    assert.equal(appliedConfig.timeFormatted, '12:00');
    assert.equal(returnedState, appliedConfig);
});
