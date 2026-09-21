import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

test('ArcToon shader definitions: pitch-black zero light and no glowing rims in dark', () => {
    const worldSrc = readFileSync('js/World3D.js', 'utf8');
    
    // Verify arcToonLevel handles zero-light pitch darkness
    assert.ok(worldSrc.includes('if (v <= 0.001) return 0.0;'), 'arcToonLevel must return 0.0 for zero light');
    assert.ok(worldSrc.includes('lo = arcToonA.z * smoothstep(0.0, 0.08, v);'), 'arcToonLevel lowest band smoothly fades to zero in darkness');

    // Verify diffuseBase is clamped to pitch black when unlit
    assert.ok(worldSrc.includes('diffuseBase = vec3(0.0);'), 'diffuseBase is set to vec3(0.0) when arcV <= 1e-4');

    // Verify rim light is suppressed in pitch darkness
    assert.ok(worldSrc.includes('arcToonLum > 0.01'), 'Rim light is gated by scene luminance');
});

test('Material and Lighting configurations: maxSimultaneousLights=16 and non-physical falloff', () => {
    const worldSrc = readFileSync('js/World3D.js', 'utf8');
    assert.ok(worldSrc.includes('m.maxSimultaneousLights < 16) m.maxSimultaneousLights = 16;'), 'World3D allows up to 16 lights');
    assert.ok(worldSrc.includes('m.usePhysicalLightFalloff = false;'), 'World3D disables physical falloff for PBR materials');

    const matEditorSrc = readFileSync('_utils/editor/material-editor.js', 'utf8');
    assert.ok(matEditorSrc.includes('mat.maxSimultaneousLights = 16;'), 'MaterialEditor ground PBR material sets max 16 lights');
    assert.ok(matEditorSrc.includes('mat.usePhysicalLightFalloff = false;'), 'MaterialEditor ground PBR material uses standard linear falloff');

    const raidEnvSrc = readFileSync('js/RaidEnvironment.js', 'utf8');
    assert.ok(raidEnvSrc.includes('m.maxSimultaneousLights = 16;'), 'RaidEnvironment surface sets max 16 lights');
    assert.ok(raidEnvSrc.includes('m.usePhysicalLightFalloff = false;'), 'RaidEnvironment surface sets standard falloff');
});

test('LightManager and Location3D: SpotLight and PointLight standard falloff and inner angle', () => {
    // Mock BABYLON environment for LightManager
    const dummyScene = {
        _terrain: { heightAt: (x, y) => 25 }
    };
    const BABYLON = {
        Light: {
            FALLOFF_STANDARD: 0
        },
        Vector3: class Vector3 {
            constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
            normalize() { return this; }
            copyFrom(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
            scale(s) { return new Vector3(this.x * s, this.y * s, this.z * s); }
            lengthSquared() { return this.x * this.x + this.y * this.y + this.z * this.z; }
            static Cross(a, b) { return new Vector3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
            static Dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
        },
        Quaternion: {
            RotationAxis: () => ({}),
            Identity: () => ({})
        },
        Color3: class Color3 {
            constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
            static FromHexString(hex) { return new Color3(); }
        },
        Color4: class {
            constructor(r, g, b, a) { this.r = r; this.g = g; this.b = b; this.a = a; }
        },
        MeshBuilder: {
            CreateSphere: (name) => ({ position: { copyFrom: () => {} } }),
            CreateTorus: () => ({}),
            CreateCylinder: () => ({
                position: { set: () => {} },
                enableEdgesRendering: () => {}
            })
        },
        StandardMaterial: class {
            constructor() {}
        },
        SpotLight: class {
            constructor(id, pos, dir, angle, exponent, scene) {
                this.id = id; this.position = pos; this.direction = dir;
                this.angle = angle; this.exponent = exponent; this.scene = scene;
            }
        },
        PointLight: class {
            constructor(id, pos, scene) {
                this.id = id; this.position = pos; this.scene = scene;
            }
        }
    };

    globalThis.BABYLON = BABYLON;

    const LightManager = require('../_utils/editor/light-manager.js');
    LightManager.init(dummyScene);

    // 1. Create SpotLight with missing/undefined height (must resolve terrain height + 120)
    const spotDef = LightManager.createLight('spot', 100, 200, undefined, { angle: 60 });
    assert.equal(spotDef.type, 'spot');
    assert.equal(spotDef.x, 100);
    assert.equal(spotDef.y, 200);
    assert.equal(spotDef.h, 25 + 120); // 145

    const spotRec = LightManager.lights.get(spotDef.id);
    assert.ok(spotRec);
    assert.equal(spotRec.light.falloffType, BABYLON.Light.FALLOFF_STANDARD);
    assert.ok(Math.abs(spotRec.light.innerAngle - (60 * 0.6 * Math.PI / 180)) < 1e-4);

    // 2. Create PointLight (must resolve terrain height + 60)
    const ptDef = LightManager.createLight('point', 100, 200, undefined);
    assert.equal(ptDef.type, 'point');
    assert.equal(ptDef.h, 25 + 60); // 85

    const ptRec = LightManager.lights.get(ptDef.id);
    assert.ok(ptRec);
    assert.equal(ptRec.light.falloffType, BABYLON.Light.FALLOFF_STANDARD);

    // 3. Location3D source check
    const locSrc = readFileSync('js/Location3D.js', 'utf8');
    assert.ok(locSrc.includes('spot.falloffType = BABYLON.Light.FALLOFF_STANDARD;'));
    assert.ok(locSrc.includes('spot.innerAngle = (angle * 0.6);'));
    assert.ok(locSrc.includes('pt.falloffType = BABYLON.Light.FALLOFF_STANDARD;'));
});

test('RaidEnvironment: procedural starry night skybox and crossfade', () => {
    const raidEnvSrc = readFileSync('js/RaidEnvironment.js', 'utf8');
    assert.ok(raidEnvSrc.includes('this.nightSky = this.scene.createDefaultSkybox(nightCube'), 'RaidEnvironment creates starry night skybox');
    assert.ok(raidEnvSrc.includes('this.nightSky.visibility = !sunEnabled ? 1 : Math.max(0, Math.min(1, nightFactor));'), 'Night skybox becomes visible at night');
    assert.ok(raidEnvSrc.includes('this.scene.environmentIntensity = baseEnv;'), 'syncSky controls environmentIntensity for PBR ambient darkness');
});
