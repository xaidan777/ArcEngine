import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { loadScripts } from './browser-scripts.mjs';
import { ArcPostProcess } from '../js/engine/ArcPostProcess.js';

const require = createRequire(import.meta.url);
const BABYLON = require('../libs/babylon.js');

test('ArcPostProcess: exports on window, globalThis, and module.exports', () => {
    assert.ok(ArcPostProcess, 'ArcPostProcess is exported from module');
    assert.ok(ArcPostProcess.PRESETS, 'ArcPostProcess.PRESETS is defined');
    assert.equal(typeof ArcPostProcess.detectHeadless, 'function');

    // Test in simulated browser scripts environment
    const { ctx } = loadScripts(['js/engine/ArcPostProcess.js']);
    assert.ok(ctx.ArcPostProcess, 'ArcPostProcess attached to window');
    assert.equal(typeof ctx.ArcPostProcess, 'function');
});

test('ArcPostProcess: headless resilience and NullEngine safety', () => {
    // 1. Instantiation with null scene
    const nullPp = new ArcPostProcess(null);
    assert.equal(nullPp.isHeadless, true);
    assert.equal(nullPp.glowLayer, null);
    assert.equal(nullPp.exposure, 1.05);
    nullPp.exposure = 1.25;
    assert.equal(nullPp.exposure, 1.25);
    nullPp.dispose();

    // 2. Instantiation with BABYLON.NullEngine
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const pp = new ArcPostProcess(scene);

    assert.equal(pp.isHeadless, true);
    assert.ok(pp.scene === scene);
    assert.ok(scene.imageProcessingConfiguration.toneMappingEnabled, 'Tone mapping enabled on scene');
    assert.equal(
        scene.imageProcessingConfiguration.toneMappingType,
        BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES,
        'ACES filmic tone mapping set'
    );

    pp.dispose();
    scene.dispose();
    engine.dispose();
});

test('ArcPostProcess: GlowLayer creation, controls, and selective emissive masking', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const pp = new ArcPostProcess(scene, {
        intensity: 0.5,
        blurKernelSize: 32,
        selectiveMasking: true
    });

    assert.ok(pp.glowLayer, 'GlowLayer created in Babylon scene');
    assert.equal(pp.intensity, 0.5);
    assert.equal(pp.blurKernelSize, 32);

    // Test setters
    pp.intensity = 0.75;
    assert.equal(pp.intensity, 0.75);
    assert.equal(pp.glowLayer.intensity, 0.75);

    pp.blurKernelSize = 48;
    assert.equal(pp.blurKernelSize, 48);
    assert.equal(pp.glowLayer.blurKernelSize, 48);

    // Selective emissive selector test
    assert.ok(typeof pp.glowLayer.customEmissiveColorSelector === 'function');
    const selector = pp.glowLayer.customEmissiveColorSelector;
    const resultColor = new BABYLON.Color4(0, 0, 0, 0);

    // 1. Non-emissive scenery prop should be rejected (color = 0,0,0,0)
    const sceneryMesh = { name: 'concrete-barrier-01', metadata: null };
    const sceneryMat = { name: 'concrete-mat', emissiveColor: new BABYLON.Color3(0, 0, 0) };
    selector(sceneryMesh, null, sceneryMat, resultColor);
    assert.equal(resultColor.r, 0);
    assert.equal(resultColor.g, 0);
    assert.equal(resultColor.b, 0);

    // 2. Spotlight cone should be selectively masked for bloom
    const spotterConeMesh = { name: 'spotter-light-cone-3', metadata: null };
    const spotterConeMat = { name: 'spotter-cone-mat-3', emissiveColor: new BABYLON.Color3(1.0, 0.1, 0.1) };
    selector(spotterConeMesh, null, spotterConeMat, resultColor);
    assert.ok(resultColor.r > 0.9, 'Spotter cone red channel glows');

    // 3. Laser tracer should be selectively masked
    const tracerMesh = { name: 'tracer-proj-42', metadata: null };
    const tracerMat = { name: 'tracer-mat-h', emissiveColor: new BABYLON.Color3(1.0, 0.25, 0.1) };
    selector(tracerMesh, null, tracerMat, resultColor);
    assert.ok(resultColor.r > 0.9, 'Tracer glows');

    // 4. Glowing robot eye / sensor / weakspot core
    const eyeMesh = { name: 'spotter-sensor-1', metadata: null };
    const eyeMat = { name: 'sensor-dome', emissiveColor: new BABYLON.Color3(0.1, 0.8, 1.0) };
    selector(eyeMesh, null, eyeMat, resultColor);
    assert.ok(resultColor.b > 0.9, 'Robot sensor eye glows');

    // 5. Explicitly registered mesh via addEmissiveMesh
    const customMesh = { name: 'custom-beacon', metadata: null };
    pp.addEmissiveMesh(customMesh, { r: 0.2, g: 0.9, b: 0.3, a: 1.0 });
    assert.equal(pp.hasEmissiveMesh(customMesh), true);
    selector(customMesh, null, null, resultColor);
    assert.equal(resultColor.g, 0.9);

    pp.removeEmissiveMesh(customMesh);
    assert.equal(pp.hasEmissiveMesh(customMesh), false);

    // 6. Disabling selective masking allows any emissive material
    pp.setSelectiveMasking(false);
    const ordinaryEmissiveMat = { name: 'screen-mat', emissiveColor: new BABYLON.Color3(0.4, 0.4, 0.4) };
    selector(sceneryMesh, null, ordinaryEmissiveMat, resultColor);
    assert.equal(resultColor.r, 0.4);

    pp.dispose();
    scene.dispose();
    engine.dispose();
});

test('ArcPostProcess: ACES Filmic Tone Mapping and Cinematic Vignette configuration', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const pp = new ArcPostProcess(scene);

    const ipc = scene.imageProcessingConfiguration;

    // ACES Tone Mapping
    pp.exposure = 1.15;
    pp.contrast = 1.25;
    assert.equal(pp.exposure, 1.15);
    assert.equal(pp.contrast, 1.25);
    assert.equal(ipc.exposure, 1.15);
    assert.equal(ipc.contrast, 1.25);

    // Vignette
    pp.setVignette(true, 0.72, { r: 0.02, g: 0.03, b: 0.04, a: 1.0 }, 0.30);
    assert.equal(pp.vignetteEnabled, true);
    assert.equal(pp.vignetteWeight, 0.72);
    assert.equal(pp.vignetteStretch, 0.30);
    assert.equal(ipc.vignetteEnabled, true);
    assert.equal(ipc.vignetteWeight, 0.72);
    assert.equal(ipc.vignetteColor.r, 0.02);

    pp.dispose();
    scene.dispose();
    engine.dispose();
});

test('ArcPostProcess: atmospheric presets and smooth transitions', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const pp = new ArcPostProcess(scene);

    // Check that all 5 required presets exist
    const presets = pp.getAvailablePresets();
    assert.ok(presets.includes('wasteland_noon'));
    assert.ok(presets.includes('wasteland_sunset'));
    assert.ok(presets.includes('radioactive_night'));
    assert.ok(presets.includes('dust_storm'));
    assert.ok(presets.includes('acid_rain'));

    // Instant preset switch (duration = 0)
    pp.setPreset('radioactive_night', 0);
    assert.equal(pp.currentPreset, 'radioactive_night');
    assert.equal(pp.exposure, 0.70);
    assert.equal(pp.contrast, 1.35);
    assert.equal(pp.intensity, 0.85);

    // Smooth transition from radioactive_night to wasteland_sunset over 1.0s
    pp.setPreset('wasteland_sunset', 1.0);
    assert.equal(pp.currentPreset, 'wasteland_sunset');

    // Step halfway (0.5s)
    pp.update(0.5);
    assert.ok(pp.exposure > 0.70 && pp.exposure < 0.92, 'Exposure is blending');
    assert.ok(pp.intensity < 0.85 && pp.intensity > 0.65, 'Glow intensity is blending');

    // Step to completion (+0.6s -> 1.1s total)
    pp.update(0.6);
    assert.equal(pp.exposure, 0.92);
    assert.equal(pp.contrast, 1.30);
    assert.equal(pp.intensity, 0.65);

    pp.dispose();
    scene.dispose();
    engine.dispose();
});

test('ArcPostProcess: syncWithDayNight integration', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const pp = new ArcPostProcess(scene);

    // 1. Clear weather with night phase
    pp.syncWithDayNight('night', 'CLEAR', 0);
    assert.equal(pp.currentPreset, 'radioactive_night');

    // 2. Clear weather with midday
    pp.syncWithDayNight('midday', 'CLEAR', 0);
    assert.equal(pp.currentPreset, 'wasteland_noon');

    // 3. Clear weather with sunset / dusk
    pp.syncWithDayNight('dusk', 'CLEAR', 0);
    assert.equal(pp.currentPreset, 'wasteland_sunset');

    // 4. Weather overrides: Dust storm
    pp.syncWithDayNight('midday', 'DUST_STORM', 0);
    assert.equal(pp.currentPreset, 'dust_storm');

    // 5. Weather overrides: Acid rain
    pp.syncWithDayNight('dusk', 'ACID_RAIN', 0);
    assert.equal(pp.currentPreset, 'acid_rain');

    // 6. Object inputs (mock DayNightCycle and WeatherSystem)
    const mockDayNight = { getPeriod: () => 'night' };
    const mockWeather = { currentState: 'CLEAR' };
    pp.syncWithDayNight(mockDayNight, mockWeather, 0);
    assert.equal(pp.currentPreset, 'radioactive_night');

    pp.dispose();
    scene.dispose();
    engine.dispose();
});

test('ArcPostProcess: getSettings and applySettings serialization', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const pp = new ArcPostProcess(scene);

    // Export settings
    const settings = pp.getSettings();
    assert.equal(typeof settings, 'object');
    assert.equal(settings.preset, 'wasteland_noon');
    assert.equal(settings.toneMapping.type, 'ACES');
    assert.ok(settings.glow.enabled);
    assert.equal(typeof settings.vignette.weight, 'number');

    // Apply partial settings from object
    pp.applySettings({
        exposure: 1.32,
        contrast: 1.45,
        intensity: 0.9,
        vignetteWeight: 0.88
    });

    assert.equal(pp.exposure, 1.32);
    assert.equal(pp.contrast, 1.45);
    assert.equal(pp.intensity, 0.9);
    assert.equal(pp.vignetteWeight, 0.88);

    // Apply settings from JSON string
    const jsonPayload = JSON.stringify({
        preset: 'acid_rain',
        transitionDuration: 0,
        exposure: 0.82
    });
    pp.applySettings(jsonPayload);
    assert.equal(pp.currentPreset, 'acid_rain');
    assert.equal(pp.exposure, 0.82);

    pp.dispose();
    scene.dispose();
    engine.dispose();
});

test('ArcPostProcess: DLSS / DLAA upscaling and adaptive sharpening (CAS)', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 0, 0), scene);
    const pp = new ArcPostProcess(scene, camera);

    // Initial state
    assert.equal(pp.getDlssMode(), 'off');
    assert.equal(pp.getRenderScale(), 1.0);

    // DLAA Mode (1.0x native + CAS sharpening)
    pp.setDlssMode('dlaa');
    assert.equal(pp.getDlssMode(), 'dlaa');
    assert.equal(pp.getRenderScale(), 1.0);

    // DLSS Quality Mode (0.75x resolution + CAS sharpening)
    pp.setDlssMode('quality');
    assert.equal(pp.getDlssMode(), 'quality');
    assert.equal(pp.getRenderScale(), 0.75);

    // DLSS Balanced Mode (0.66x resolution)
    pp.setDlssMode('balanced');
    assert.equal(pp.getDlssMode(), 'balanced');
    assert.equal(pp.getRenderScale(), 0.66);

    // DLSS Performance Mode (0.50x resolution)
    pp.setDlssMode('performance');
    assert.equal(pp.getDlssMode(), 'performance');
    assert.equal(pp.getRenderScale(), 0.50);

    // Revert to off
    pp.setDlssMode('off');
    assert.equal(pp.getDlssMode(), 'off');
    assert.equal(pp.getRenderScale(), 1.0);

    pp.dispose();
    scene.dispose();
    engine.dispose();
});

test('ArcPostProcess: Pseudo-RTX (SSAO 2.0 and SSR) and telemetry status', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 0, 0), scene);
    const pp = new ArcPostProcess(scene, camera);

    // Initial status
    const initialStatus = pp.getRtxStatus();
    assert.equal(initialStatus.rtxMode, 'off');
    assert.equal(initialStatus.ssao, false);
    assert.equal(initialStatus.ssr, false);

    // Set RTX Ultra
    pp.setRtxMode('ultra');
    assert.equal(pp.getRtxMode(), 'ultra');
    const ultraStatus = pp.getRtxStatus();
    assert.equal(ultraStatus.rtxMode, 'ultra');

    // Serialization in getSettings
    const settings = pp.getSettings();
    assert.ok(settings.rtx, 'rtx settings defined');
    assert.equal(settings.rtx.mode, 'ultra');
    assert.ok(settings.dlss, 'dlss settings defined');

    // Set RTX Off
    pp.setRtxMode('off');
    assert.equal(pp.getRtxMode(), 'off');

    // Test static helpers
    ArcPostProcess.setRtxMode('medium');
    assert.equal(pp.getRtxMode(), 'medium');
    ArcPostProcess.setDlssMode('quality');
    assert.equal(pp.getDlssMode(), 'quality');

    pp.dispose();
    scene.dispose();
    engine.dispose();
});

