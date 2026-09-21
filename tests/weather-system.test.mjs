import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';
import { WeatherSystem } from '../js/WeatherSystem.js';

test('WeatherSystem: exports on window, globalThis, and module.exports', () => {
    assert.ok(WeatherSystem, 'WeatherSystem is exported from module');
    assert.ok(WeatherSystem.STATES, 'WeatherSystem.STATES is defined');
    assert.equal(WeatherSystem.STATES.CLEAR, 'CLEAR');
    assert.equal(WeatherSystem.STATES.DUST_STORM, 'DUST_STORM');
    assert.equal(WeatherSystem.STATES.ACID_RAIN, 'ACID_RAIN');
    assert.equal(WeatherSystem.STATES.DENSE_FOG, 'DENSE_FOG');

    // Test in simulated browser scripts environment
    const { ctx } = loadScripts(['js/Constants.js', 'js/WeatherSystem.js']);
    assert.ok(ctx.WeatherSystem, 'WeatherSystem attached to window');
    assert.equal(typeof ctx.WeatherSystem, 'function');
});

test('WeatherSystem: procedural weather states and configurations', () => {
    const ws = new WeatherSystem(null, { initialState: 'CLEAR' });
    assert.equal(ws.getState(), 'CLEAR');

    const clearAtm = ws.getCurrentAtmosphere();
    assert.equal(clearAtm.muffledAcoustics, false);
    assert.equal(clearAtm.rainActive, false);
    assert.equal(clearAtm.dustActive, false);

    // DUST_STORM
    ws.setWeather('DUST_STORM', 0);
    assert.equal(ws.getState(), 'DUST_STORM');
    const dustAtm = ws.getCurrentAtmosphere();
    assert.equal(dustAtm.dustActive, true);
    assert.equal(dustAtm.rainActive, false);
    assert.ok(dustAtm.windBaseSpeed > 80, 'Dust storm has high wind');
    assert.ok(dustAtm.fogDensity > 0.003, 'Dust storm has dense fog');

    // ACID_RAIN
    ws.setWeather('ACID_RAIN', 0);
    assert.equal(ws.getState(), 'ACID_RAIN');
    const rainAtm = ws.getCurrentAtmosphere();
    assert.equal(rainAtm.rainActive, true);
    assert.equal(rainAtm.lightningActive, true);
    assert.equal(rainAtm.dustActive, false);

    // DENSE_FOG
    ws.setWeather('DENSE_FOG', 0);
    assert.equal(ws.getState(), 'DENSE_FOG');
    const fogAtm = ws.getCurrentAtmosphere();
    assert.ok(fogAtm.fogDensity >= 0.008, 'Dense fog density must be 0.008+');
    assert.equal(fogAtm.muffledAcoustics, true, 'Dense fog has muffled acoustics');
    assert.ok(fogAtm.windBaseSpeed <= 12, 'Dense fog has low wind');
});

test('WeatherSystem: 2D Simplex wind simulation', () => {
    const ws = new WeatherSystem(null, { initialState: 'CLEAR', seed: 42 });

    // Initial wind
    const v0 = ws.getWindVector();
    assert.ok(typeof v0.x === 'number' && Number.isFinite(v0.x));
    assert.ok(typeof v0.z === 'number' && Number.isFinite(v0.z));
    assert.ok(typeof ws.getWindStrength() === 'number' && ws.getWindStrength() > 0);
    assert.ok(typeof ws.getGustFactor() === 'number' && ws.getGustFactor() >= 0 && ws.getGustFactor() <= 1);

    // Advance time and verify continuous drift
    ws.update(0.1);
    const v1 = ws.getWindVector();
    const str1 = ws.getWindStrength();
    assert.ok(Number.isFinite(v1.x) && Number.isFinite(v1.z));
    assert.ok(Number.isFinite(str1));

    // Verify magnitude consistency
    const calcMagnitude = Math.hypot(v1.x, v1.z);
    assert.ok(Math.abs(calcMagnitude - str1) < 1e-4, 'Wind vector magnitude matches getWindStrength');

    // Verify DUST_STORM yields stronger wind than DENSE_FOG
    ws.setWeather('DUST_STORM', 0);
    ws.update(0.01);
    const dustStrength = ws.getWindStrength();

    ws.setWeather('DENSE_FOG', 0);
    ws.update(0.01);
    const fogStrength = ws.getWindStrength();

    assert.ok(dustStrength > fogStrength * 4, 'Dust storm wind is much stronger than dense fog wind');
});

test('WeatherSystem: smooth state transition', () => {
    const ws = new WeatherSystem(null, { initialState: 'CLEAR' });
    ws.setWeather('DENSE_FOG', 2.0); // 2-second transition

    assert.equal(ws.getState(), 'DENSE_FOG');
    assert.ok(ws.transitionProgress === 0);

    // Update 1 second (halfway)
    ws.update(1.0);
    assert.ok(ws.transitionProgress > 0.4 && ws.transitionProgress < 0.6);
    const midAtm = ws.getCurrentAtmosphere();
    assert.ok(midAtm.fogDensity > 0.00032 && midAtm.fogDensity < 0.0092, 'Fog density smoothly interpolates');

    // Update another 1.1 seconds (complete)
    ws.update(1.1);
    assert.equal(ws.transitionProgress, 1.0);
    const finalAtm = ws.getCurrentAtmosphere();
    assert.ok(finalAtm.fogDensity >= 0.008);
    assert.equal(finalAtm.muffledAcoustics, true);
});

test('WeatherSystem: integration with DayNightCycle and ProceduralAudio', () => {
    let audioState = null;
    let audioOptions = null;
    let windHowlCalled = false;
    let thunderTriggered = false;
    let muffledSet = null;

    const mockAudio = {
        setWeather(state, opts) {
            audioState = state;
            audioOptions = opts;
        },
        setWind(strength, gust) {},
        setWindHowl(gust, strength) {
            windHowlCalled = true;
        },
        modulateWind(params) {
            if (params && params.howling) windHowlCalled = true;
        },
        triggerThunder(params) {
            thunderTriggered = true;
        },
        setMuffled(m) {
            muffledSet = m;
        },
        setAcoustics(params) {
            if (params && typeof params.muffled === 'boolean') muffledSet = params.muffled;
        }
    };

    let dncWeatherNotified = null;
    const mockDayNight = {
        getAmbientMultiplier() { return 0.85; },
        getSunMultiplier() { return 0.75; },
        getSkyTint() { return { r: 0.9, g: 0.95, b: 1.0 }; },
        setWeather(state, modifiers) {
            dncWeatherNotified = { state, modifiers };
        }
    };

    const ws = new WeatherSystem(null, {
        initialState: 'CLEAR',
        dayNightCycle: mockDayNight,
        proceduralAudio: mockAudio
    });

    assert.equal(audioState, 'CLEAR');
    assert.equal(muffledSet, false);

    // Switch to DUST_STORM
    ws.setWeather('DUST_STORM', 0);
    ws.update(0.1);
    assert.equal(audioState, 'DUST_STORM');
    assert.equal(windHowlCalled, true);
    assert.equal(dncWeatherNotified.state, 'DUST_STORM');

    // Switch to DENSE_FOG
    ws.setWeather('DENSE_FOG', 0);
    ws.update(0.1);
    assert.equal(audioState, 'DENSE_FOG');
    assert.equal(muffledSet, true);

    // Switch to ACID_RAIN and test thunder trigger
    ws.setWeather('ACID_RAIN', 0);
    ws._triggerLightningFlash();
    assert.ok(ws._pendingThunders.length > 0, 'Thunder event queued');

    // Advance time until thunder triggers (up to 5s in 0.1s steps)
    for (let i = 0; i < 50; i++) {
        ws.update(0.1);
        if (thunderTriggered) break;
    }
    assert.equal(thunderTriggered, true, 'Thunder triggered on procedural audio');
});
