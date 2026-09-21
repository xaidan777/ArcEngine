import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './browser-scripts.mjs';

// ============================================================================
//  Setup: Load Procedural Systems scripts in node:vm
// ============================================================================
const scripts = loadScripts([
    'js/Constants.js',
    'js/audio/AudioCore.js',
    'js/audio/WeaponSynth.js',
    'js/audio/AmbienceSynth.js',
    'js/audio/FoleySynth.js',
    'js/audio/CombatSynth.js',
    'js/audio/ArcMachineSynth.js',
    'js/ProceduralAudio.js',
    'js/DayNightCycle.js',
    'js/WeatherSystem.js'
]);

const ProceduralAudioCore = scripts.get('ProceduralAudioCore');
const ProceduralWeaponSynth = scripts.get('ProceduralWeaponSynth');
const ProceduralFoleySynth = scripts.get('ProceduralFoleySynth');
const ProceduralCombatSynth = scripts.get('ProceduralCombatSynth');
const ProceduralArcSynth = scripts.get('ProceduralArcSynth');
const ProceduralAudio = scripts.get('ProceduralAudio');
const DayNightCycle = scripts.get('DayNightCycle');
const WeatherSystem = scripts.get('WeatherSystem');

// ============================================================================
//  Helper: Web Audio Context Mock for Node.js
// ============================================================================
function createMockAudioContext(sampleRate = 44100) {
    let currentTime = 0;

    class MockAudioParam {
        constructor(defaultValue = 0) {
            this.value = defaultValue;
            this.events = [];
        }
        setValueAtTime(val, time) {
            this.value = val;
            this.events.push({ type: 'setValueAtTime', val, time });
            return this;
        }
        linearRampToValueAtTime(val, time) {
            this.value = val;
            this.events.push({ type: 'linearRampToValueAtTime', val, time });
            return this;
        }
        exponentialRampToValueAtTime(val, time) {
            this.value = val;
            this.events.push({ type: 'exponentialRampToValueAtTime', val, time });
            return this;
        }
        setTargetAtTime(val, time, constant) {
            this.value = val;
            this.events.push({ type: 'setTargetAtTime', val, time, constant });
            return this;
        }
        cancelScheduledValues(time) {
            this.events.push({ type: 'cancelScheduledValues', time });
            return this;
        }
    }

    class MockAudioNode {
        constructor() {
            this.connectedTo = [];
        }
        connect(target) {
            this.connectedTo.push(target);
            return target;
        }
        disconnect(target) {
            if (!target) this.connectedTo.length = 0;
            else {
                const idx = this.connectedTo.indexOf(target);
                if (idx >= 0) this.connectedTo.splice(idx, 1);
            }
        }
    }

    class MockGainNode extends MockAudioNode {
        constructor() {
            super();
            this.gain = new MockAudioParam(1.0);
        }
    }

    class MockBiquadFilterNode extends MockAudioNode {
        constructor() {
            super();
            this.type = 'lowpass';
            this.frequency = new MockAudioParam(1000);
            this.Q = new MockAudioParam(1.0);
            this.gain = new MockAudioParam(0);
        }
    }

    class MockOscillatorNode extends MockAudioNode {
        constructor() {
            super();
            this.type = 'sine';
            this.frequency = new MockAudioParam(440);
            this.started = false;
            this.stopped = false;
            this.onended = null;
        }
        start(when = 0) { this.started = true; }
        stop(when = 0) { this.stopped = true; }
    }

    class MockBufferSourceNode extends MockAudioNode {
        constructor() {
            super();
            this.buffer = null;
            this.loop = false;
            this.playbackRate = new MockAudioParam(1.0);
            this.started = false;
            this.stopped = false;
            this.onended = null;
        }
        start(when = 0) { this.started = true; }
        stop(when = 0) { this.stopped = true; }
    }

    class MockStereoPannerNode extends MockAudioNode {
        constructor() {
            super();
            this.pan = new MockAudioParam(0);
        }
    }

    class MockDynamicsCompressorNode extends MockAudioNode {
        constructor() {
            super();
            this.threshold = new MockAudioParam(-1.5);
            this.knee = new MockAudioParam(3.0);
            this.ratio = new MockAudioParam(16.0);
            this.attack = new MockAudioParam(0.003);
            this.release = new MockAudioParam(0.15);
        }
    }

    class MockConvolverNode extends MockAudioNode {
        constructor() {
            super();
            this.buffer = null;
        }
    }

    class MockWaveShaperNode extends MockAudioNode {
        constructor() {
            super();
            this.curve = null;
            this.oversample = 'none';
        }
    }

    class MockAudioBuffer {
        constructor(channels, length, sRate) {
            this.numberOfChannels = channels;
            this.length = length;
            this.sampleRate = sRate;
            this.duration = length / sRate;
            this._channels = [];
            for (let i = 0; i < channels; i++) {
                this._channels.push(new Float32Array(length));
            }
        }
        getChannelData(ch) {
            return this._channels[ch] || this._channels[0];
        }
    }

    const destination = new MockAudioNode();
    const listener = {
        positionX: new MockAudioParam(0),
        positionY: new MockAudioParam(0),
        positionZ: new MockAudioParam(0),
        forwardX: new MockAudioParam(0),
        forwardY: new MockAudioParam(0),
        forwardZ: new MockAudioParam(-1),
        upX: new MockAudioParam(0),
        upY: new MockAudioParam(1),
        upZ: new MockAudioParam(0),
        setPosition(x, y, z) {
            this.positionX.value = x;
            this.positionY.value = y;
            this.positionZ.value = z;
        },
        setOrientation(fx, fy, fz, ux, uy, uz) {
            this.forwardX.value = fx;
            this.forwardY.value = fy;
            this.forwardZ.value = fz;
            this.upX.value = ux;
            this.upY.value = uy;
            this.upZ.value = uz;
        }
    };

    return {
        sampleRate,
        get currentTime() { return currentTime; },
        set currentTime(t) { currentTime = t; },
        state: 'running',
        destination,
        listener,
        createGain: () => new MockGainNode(),
        createBiquadFilter: () => new MockBiquadFilterNode(),
        createOscillator: () => new MockOscillatorNode(),
        createBufferSource: () => new MockBufferSourceNode(),
        createStereoPanner: () => new MockStereoPannerNode(),
        createDynamicsCompressor: () => new MockDynamicsCompressorNode(),
        createConvolver: () => new MockConvolverNode(),
        createWaveShaper: () => new MockWaveShaperNode(),
        createBuffer: (ch, len, sr) => new MockAudioBuffer(ch, len, sr),
        resume: async () => 'running',
        suspend: async () => 'suspended',
        close: async () => 'closed',
        addEventListener: () => {},
        removeEventListener: () => {}
    };
}

// ============================================================================
//  1. ProceduralAudio Modules Tests
// ============================================================================

test('ProceduralAudio: headless Node compatibility and graceful fallback', () => {
    assert.ok(ProceduralAudioCore, 'ProceduralAudioCore must be defined');
    assert.ok(ProceduralWeaponSynth, 'ProceduralWeaponSynth must be defined');
    assert.ok(ProceduralFoleySynth, 'ProceduralFoleySynth must be defined');
    assert.ok(ProceduralCombatSynth, 'ProceduralCombatSynth must be defined');
    assert.ok(ProceduralArcSynth, 'ProceduralArcSynth must be defined');
    assert.ok(ProceduralAudio, 'ProceduralAudio master facade must be defined');

    // Without AudioContext, synth constructors should not crash and indicate unreadiness
    const foley = new ProceduralFoleySynth();
    assert.equal(foley.isSupported, false);
    const step = foley.playFootstep('concrete');
    assert.equal(step.played, false);

    const combat = new ProceduralCombatSynth(null);
    const mag = combat.playMagOut();
    assert.equal(mag, null, 'Combat synth returns null when context is not ready');

    const arc = new ProceduralArcSynth(null);
    const chitter = arc.playCricketChitter();
    assert.ok(chitter === null || chitter.started === false, 'Arc synth returns null or dummy handle without context');
});

test('ProceduralAudioCore: buffer generation for White, Pink, and Brown noise', () => {
    const mockCtx = createMockAudioContext(44100);
    const duration = 1.0;
    const expectedSamples = 44100;

    // 1. White Noise
    const whiteBuf = ProceduralAudioCore.generateNoiseBuffer(mockCtx, 'white', duration, 1);
    assert.equal(whiteBuf.numberOfChannels, 1);
    assert.equal(whiteBuf.length, expectedSamples);
    assert.equal(whiteBuf.sampleRate, 44100);
    const whiteData = whiteBuf.getChannelData(0);
    let nonZeroWhite = 0;
    for (let i = 0; i < whiteData.length; i++) {
        assert.ok(whiteData[i] >= -1.0 && whiteData[i] <= 1.0, 'White noise samples must be in [-1, 1]');
        if (Math.abs(whiteData[i]) > 1e-4) nonZeroWhite++;
    }
    assert.ok(nonZeroWhite > expectedSamples * 0.9, 'White noise must have active non-zero samples');

    // 2. Pink Noise (1/f filter)
    const pinkBuf = ProceduralAudioCore.generateNoiseBuffer(mockCtx, 'pink', duration, 2);
    assert.equal(pinkBuf.numberOfChannels, 2);
    assert.equal(pinkBuf.length, expectedSamples);
    const pinkL = pinkBuf.getChannelData(0);
    const pinkR = pinkBuf.getChannelData(1);
    let nonZeroPink = 0;
    for (let i = 0; i < pinkL.length; i++) {
        assert.ok(pinkL[i] >= -1.0 && pinkL[i] <= 1.0, 'Pink noise L must be in [-1, 1]');
        assert.ok(pinkR[i] >= -1.0 && pinkR[i] <= 1.0, 'Pink noise R must be in [-1, 1]');
        if (Math.abs(pinkL[i]) > 1e-4) nonZeroPink++;
    }
    assert.ok(nonZeroPink > expectedSamples * 0.8, 'Pink noise must have active non-zero samples');

    // 3. Brown / Brownian Noise (leaky integrated 1/f^2)
    const brownBuf = ProceduralAudioCore.generateNoiseBuffer(mockCtx, 'brown', duration, 1);
    assert.equal(brownBuf.numberOfChannels, 1);
    assert.equal(brownBuf.length, expectedSamples);
    const brownData = brownBuf.getChannelData(0);
    let nonZeroBrown = 0;
    for (let i = 0; i < brownData.length; i++) {
        assert.ok(brownData[i] >= -1.0 && brownData[i] <= 1.0, 'Brown noise must be in [-1, 1]');
        if (Math.abs(brownData[i]) > 1e-4) nonZeroBrown++;
    }
    assert.ok(nonZeroBrown > expectedSamples * 0.8, 'Brown noise must have active non-zero samples');

    // 4. Unknown noise type rejection
    assert.throws(() => {
        ProceduralAudioCore.generateNoiseBuffer(mockCtx, 'violet');
    }, /Unknown noise type/);

    // 5. Procedural Wasteland Impulse Response
    const irBuf = ProceduralAudioCore.generateWastelandIR(mockCtx, { duration: 1.5, decay: 2.0 });
    assert.equal(irBuf.numberOfChannels, 2);
    assert.ok(irBuf.length > 0);
});

test('ProceduralWeaponSynth: method existence and parameter handling for each caliber', () => {
    const mockCtx = createMockAudioContext();
    const core = new ProceduralAudioCore({ autoInit: false });
    core.init({ audioCtx: mockCtx });
    core.ctx = mockCtx;
    core.weaponGain = mockCtx.createGain();

    const weaponSynth = new ProceduralWeaponSynth(core);

    // Verify required caliber methods exist
    assert.equal(typeof weaponSynth.playAssaultRifle, 'function');
    assert.equal(typeof weaponSynth.playShotgun, 'function');
    assert.equal(typeof weaponSynth.playRevolver, 'function');
    assert.equal(typeof weaponSynth.playSMG, 'function');
    assert.equal(typeof weaponSynth.playPlasma, 'function');

    // 1. Assault Rifle (Рубеж-76 line / Tempest II/III)
    const arPlayer = weaponSynth.playAssaultRifle(null, true, 2);
    assert.equal(arPlayer.played, true);
    assert.ok(arPlayer.id.startsWith('ar_'));
    assert.ok(arPlayer.duration > 0);

    const arTier4 = weaponSynth.playAssaultRifle({ x: 200, y: 150 }, false, 'IV');
    assert.equal(arTier4.played, true);

    const arTier1 = weaponSynth.playAssaultRifle({ x: 10, y: 10, z: 2 }, false, 1);
    assert.equal(arTier1.played, true);

    // 2. Shotgun (Vulcano)
    const sgPlayer = weaponSynth.playShotgun(null, true);
    assert.equal(sgPlayer.played, true);
    assert.ok(sgPlayer.id.startsWith('sg_'));
    assert.ok(sgPlayer.duration > 0);

    const sgSpatial = weaponSynth.playShotgun({ x: 120, y: -80 }, false);
    assert.equal(sgSpatial.played, true);

    // 3. Revolver (Revolver I / II)
    const revPlayer = weaponSynth.playRevolver(null, true);
    assert.equal(revPlayer.played, true);
    assert.ok(revPlayer.id.startsWith('rev_'));
    assert.ok(revPlayer.duration > 0);

    const revSpatial = weaponSynth.playRevolver({ x: -90, y: 40 }, false);
    assert.equal(revSpatial.played, true);

    // 4. SMG (Rattler)
    const smgPlayer = weaponSynth.playSMG(null, true);
    assert.equal(smgPlayer.played, true);
    assert.ok(smgPlayer.id.startsWith('smg_'));
    assert.ok(smgPlayer.duration > 0);

    const smgSpatial = weaponSynth.playSMG({ x: 300, y: 100 }, false);
    assert.equal(smgSpatial.played, true);

    // 5. Plasma (ARC Energy Weapon)
    const plasmaPlayer = weaponSynth.playPlasma(null, true);
    assert.equal(plasmaPlayer.played, true);
    assert.ok(plasmaPlayer.id.startsWith('pls_'));
    assert.ok(plasmaPlayer.duration > 0);

    const plasmaSpatial = weaponSynth.playPlasma({ x: 400, y: -200 }, false);
    assert.equal(plasmaSpatial.played, true);

    // Out of audible range handling (> 3500 units)
    const outOfRange = weaponSynth.playAssaultRifle({ x: 10000, y: 10000 }, false);
    assert.equal(outOfRange.played, false);
});

test('ProceduralFoleySynth: surface type routing and alias resolution', () => {
    const mockCtx = createMockAudioContext();
    const foley = new ProceduralFoleySynth();
    foley.init(mockCtx);

    // 1. Surface alias routing
    assert.equal(ProceduralFoleySynth.normalizeSurface('dirt'), 'dirt');
    assert.equal(ProceduralFoleySynth.normalizeSurface('soil'), 'dirt');
    assert.equal(ProceduralFoleySynth.normalizeSurface('mud'), 'dirt');
    assert.equal(ProceduralFoleySynth.normalizeSurface('grass'), 'dirt');

    assert.equal(ProceduralFoleySynth.normalizeSurface('gravel'), 'gravel');
    assert.equal(ProceduralFoleySynth.normalizeSurface('rubble'), 'gravel');
    assert.equal(ProceduralFoleySynth.normalizeSurface('stone'), 'gravel');

    assert.equal(ProceduralFoleySynth.normalizeSurface('metal'), 'metal');
    assert.equal(ProceduralFoleySynth.normalizeSurface('gantry'), 'metal');
    assert.equal(ProceduralFoleySynth.normalizeSurface('steel'), 'metal');

    assert.equal(ProceduralFoleySynth.normalizeSurface('concrete'), 'concrete');
    assert.equal(ProceduralFoleySynth.normalizeSurface('asphalt'), 'concrete');
    assert.equal(ProceduralFoleySynth.normalizeSurface('unknown_terrain'), 'concrete');

    // 2. Footstep execution across surfaces
    for (const surface of ['dirt', 'gravel', 'metal', 'concrete']) {
        const walk = foley.playFootstep(surface, { velocity: 0.5, sprint: false });
        assert.equal(walk.played, true);
        assert.equal(walk.surface, surface);
        assert.equal(walk.type, 'footstep');

        const sprint = foley.playFootstep(surface, { velocity: 1.0, sprint: true, volume: 1.2 });
        assert.equal(sprint.played, true);
        assert.equal(sprint.surface, surface);
    }

    // Footstep with alias ('gantry' -> 'metal')
    const gantryStep = foley.playFootstep('gantry', { velocity: 0.7 });
    assert.equal(gantryStep.played, true);
    assert.equal(gantryStep.surface, 'metal');

    // 3. Tactical movement foley
    const rustle = foley.playGearRustle({ intensity: 0.8 });
    assert.equal(rustle.played, true);
    assert.equal(rustle.type, 'gear_rustle');

    const launch = foley.playJumpLaunch({ velocity: 1.2, surface: 'dirt' });
    assert.equal(launch.played, true);
    assert.equal(launch.type, 'jump_launch');

    const land = foley.playJumpLand('gravel', { impactVelocity: 1.8 });
    assert.equal(land.played, true);
    assert.equal(land.type, 'jump_land');
    assert.equal(land.surface, 'gravel');
});

test('ProceduralCombatSynth and ProceduralArcSynth: API surface and sound generation', () => {
    const mockCtx = createMockAudioContext();

    // 1. ProceduralCombatSynth
    const combat = new ProceduralCombatSynth(mockCtx);
    combat.setListenerPosition(0, 0, 0);

    // Weapon handling
    assert.equal(combat.playMagOut(), true);
    assert.equal(combat.playMagIn(), true);
    assert.equal(combat.playBoltRack(), true);
    assert.equal(combat.playDryFire(), true);

    // Projectile ballistics and impacts
    assert.equal(combat.playBulletWhiz({ x: 50, y: 10 }), true);
    assert.equal(combat.playRicochet({ x: 100, y: 20 }), true);
    for (const mat of ['concrete', 'metal', 'dirt']) {
        assert.equal(combat.playImpact(mat, { x: 30, y: -40 }), true);
    }

    // Tactical shield audio
    assert.equal(combat.playShieldHit(), true);
    assert.equal(combat.playShieldBreak(), true);
    assert.ok(combat.playShieldRecharge(true) !== null);
    assert.equal(combat.playShieldRecharge(false), null);

    // 2. ProceduralArcSynth
    const arc = new ProceduralArcSynth(mockCtx);

    // ARC Cricket (Jumper)
    const cricketChitter = arc.playCricketChitter({ x: 150, y: 100 });
    assert.ok(cricketChitter && cricketChitter.started === true);

    const cricketLeap = arc.playCricketLeapCharge({ x: 150, y: 100 });
    assert.ok(cricketLeap && cricketLeap.started === true);

    const cricketLanding = arc.playCricketLanding({ x: 200, y: 120 });
    assert.ok(cricketLanding && cricketLanding.started === true);

    // ARC Screamer (EW Unit)
    const screamerStep = arc.playScreamerStiltStep({ x: 300, y: 250 });
    assert.ok(screamerStep && screamerStep.started === true);

    const screamerScream = arc.playScreamerScream({ x: 300, y: 250 });
    assert.ok(screamerScream && screamerScream.started === true);

    // ARC Spotter (Drone)
    const spotterHover = arc.playSpotterHover({ x: 100, y: 50 }, 2.0);
    assert.ok(spotterHover && spotterHover.started === true);

    const spotterSiren = arc.playSpotterSiren({ x: 100, y: 50 });
    assert.ok(spotterSiren && spotterSiren.started === true);

    // ARC Sentinel (Walker)
    const sentinelStep = arc.playSentinelStep({ x: 500, y: 400 });
    assert.ok(sentinelStep && sentinelStep.started === true);

    const sentinelHorn = arc.playSentinelHorn({ x: 500, y: 400 });
    assert.ok(sentinelHorn && sentinelHorn.started === true);
});

// ============================================================================
//  2. DayNightCycle Tests
// ============================================================================

test('DayNightCycle: continuous 24h time progression and formatting', () => {
    const cycle = new DayNightCycle({ dayDurationSec: 720, initialTime: 12.0 });

    assert.equal(cycle.getTime(), 12.0);
    assert.equal(cycle.getTimeFormatted(), '12:00');

    // Advance 30 seconds: 30s / 720s * 24h = 1.0 hour -> 13.0h
    cycle.update(30);
    assert.equal(Math.abs(cycle.getTime() - 13.0) < 1e-5, true);
    assert.equal(cycle.getTimeFormatted(), '13:00');

    // Half-hour test (13.5h -> 13:30)
    cycle.setTime(13.5);
    assert.equal(cycle.getTimeFormatted(), '13:30');

    // Test 24h wrap-around: 23.5h + 1.0h -> 0.5h
    cycle.setTime(23.5);
    cycle.update(30); // +1.0h
    assert.equal(Math.abs(cycle.getTime() - 0.5) < 1e-5, true);
    assert.equal(cycle.getTimeFormatted(), '00:30');

    // Negative hours wrap around: setTime(-3) -> 21.0
    cycle.setTime(-3);
    assert.equal(cycle.getTime(), 21.0);

    // Paused state prevents progression
    cycle.paused = true;
    cycle.update(60);
    assert.equal(cycle.getTime(), 21.0);
    cycle.paused = false;
});

test('DayNightCycle: solar azimuth and elevation math at Dawn, Noon, Dusk, Midnight', () => {
    const cycle = new DayNightCycle({ azimuthOffset: 0.0 });

    // 1. Dawn (05:00)
    // Azimuth: (5/24) * 360 = 75°
    // Elevation: 0° (horizon)
    cycle.setTime(5.0);
    assert.ok(Math.abs(cycle.sunAz - 75.0) < 1e-4, `Dawn azimuth expected 75°, got ${cycle.sunAz}`);
    assert.ok(Math.abs(cycle.sunEl - 0.0) < 1e-4, `Dawn elevation expected 0°, got ${cycle.sunEl}`);

    // 2. Noon (12:00)
    // Azimuth: (12/24) * 360 = 180°
    // Elevation: 65° (zenith peak)
    cycle.setTime(12.0);
    assert.ok(Math.abs(cycle.sunAz - 180.0) < 1e-4, `Noon azimuth expected 180°, got ${cycle.sunAz}`);
    assert.ok(Math.abs(cycle.sunEl - 65.0) < 1e-4, `Noon elevation expected 65°, got ${cycle.sunEl}`);

    // 3. Dusk (19:00)
    // Azimuth: (19/24) * 360 = 285°
    // Elevation: 0° (horizon)
    cycle.setTime(19.0);
    assert.ok(Math.abs(cycle.sunAz - 285.0) < 1e-4, `Dusk azimuth expected 285°, got ${cycle.sunAz}`);
    assert.ok(Math.abs(cycle.sunEl - 0.0) < 1e-4, `Dusk elevation expected 0°, got ${cycle.sunEl}`);

    // 4. Midnight (00:00 / 24:00)
    // Azimuth: 0° / 360°
    // Elevation: -30° (nadir below horizon)
    cycle.setTime(0.0);
    assert.ok(Math.abs(cycle.sunAz - 0.0) < 1e-4, `Midnight azimuth expected 0°, got ${cycle.sunAz}`);
    assert.ok(Math.abs(cycle.sunEl - (-30.0)) < 1e-4, `Midnight elevation expected -30°, got ${cycle.sunEl}`);
});

test('DayNightCycle: color transitions and night mode detection', () => {
    const cycle = new DayNightCycle();

    // 1. isNight() detection (night is 20:00 to 05:00)
    assert.equal(cycle.setTime(0.0).isNight(), true, '00:00 is night');
    assert.equal(cycle.setTime(4.0).isNight(), true, '04:00 is night');
    assert.equal(cycle.setTime(4.99).isNight(), true, '04:59 is night');
    assert.equal(cycle.setTime(5.0).isNight(), false, '05:00 is not night (dawn)');
    assert.equal(cycle.setTime(7.0).isNight(), false, '07:00 is not night (midday)');
    assert.equal(cycle.setTime(12.0).isNight(), false, '12:00 is not night (noon)');
    assert.equal(cycle.setTime(18.0).isNight(), false, '18:00 is not night (dusk)');
    assert.equal(cycle.setTime(19.99).isNight(), false, '19:59 is not night');
    assert.equal(cycle.setTime(20.0).isNight(), true, '20:00 is night');
    assert.equal(cycle.setTime(23.5).isNight(), true, '23:30 is night');

    // 2. getNightFactor()
    assert.equal(cycle.setTime(12.0).getNightFactor(), 0.0, 'Noon night factor is 0.0');
    assert.equal(cycle.setTime(0.0).getNightFactor(), 1.0, 'Midnight night factor is 1.0');
    assert.ok(cycle.setTime(18.5).getNightFactor() > 0.0 && cycle.getNightFactor() < 1.0, 'Dusk night factor is between 0 and 1');

    // 3. getPeriod()
    assert.equal(cycle.setTime(6.0).getPeriod(), 'dawn');
    assert.equal(cycle.setTime(12.0).getPeriod(), 'midday');
    assert.equal(cycle.setTime(18.5).getPeriod(), 'dusk');
    assert.equal(cycle.setTime(22.0).getPeriod(), 'night');

    // 4. Lighting state keyframe interpolation
    const noonState = cycle.setTime(12.0).getLightingState();
    assert.ok(noonState, 'Lighting state must exist');
    assert.equal(typeof noonState.sky, 'number', 'Noon sky is numeric hex color');
    assert.ok(noonState.skyHex.startsWith('#'), 'Noon skyHex is formatted string');
    assert.equal(typeof noonState.sunColor, 'number', 'Noon sunColor is numeric hex color');
    assert.ok(noonState.sunIntensity > 1.5, 'Noon sun should be intense');
    assert.ok(noonState.fog < 0.001, 'Noon fog should be minimal');

    const dawnState = cycle.setTime(6.0).getLightingState();
    assert.ok(dawnState.fog > noonState.fog, 'Dawn mist should be denser than midday');

    const nightState = cycle.setTime(0.0).getLightingState();
    assert.ok(nightState.sunIntensity < noonState.sunIntensity, 'Night moon intensity must be lower than sun');
    assert.equal(nightState.isNight, true);
});

// ============================================================================
//  3. WeatherSystem Tests
// ============================================================================

test('WeatherSystem: weather state transitions across CLEAR, DUST_STORM, ACID_RAIN, DENSE_FOG', () => {
    assert.ok(WeatherSystem.STATES, 'WeatherSystem.STATES must be defined');
    assert.equal(WeatherSystem.STATES.CLEAR, 'CLEAR');
    assert.equal(WeatherSystem.STATES.DUST_STORM, 'DUST_STORM');
    assert.equal(WeatherSystem.STATES.ACID_RAIN, 'ACID_RAIN');
    assert.equal(WeatherSystem.STATES.DENSE_FOG, 'DENSE_FOG');

    const ws = new WeatherSystem(null, { initialState: 'CLEAR' });
    assert.equal(ws.getState(), 'CLEAR');

    // 1. CLEAR: standard visibility, calm/moderate breeze
    const clearAtm = ws.getCurrentAtmosphere();
    assert.equal(clearAtm.rainActive, false);
    assert.equal(clearAtm.dustActive, false);
    assert.equal(clearAtm.muffledAcoustics, false);

    // 2. DUST_STORM: high winds, rust fog, dust particles
    ws.setWeather('DUST_STORM', 0); // Instant transition
    assert.equal(ws.getState(), 'DUST_STORM');
    const dustAtm = ws.getCurrentAtmosphere();
    assert.equal(dustAtm.dustActive, true);
    assert.equal(dustAtm.rainActive, false);
    assert.ok(dustAtm.windBaseSpeed > clearAtm.windBaseSpeed, 'Dust storm wind must exceed clear wind');

    // 3. ACID_RAIN: rain streaks, lightning generator active
    ws.setWeather('ACID_RAIN', 0);
    assert.equal(ws.getState(), 'ACID_RAIN');
    const rainAtm = ws.getCurrentAtmosphere();
    assert.equal(rainAtm.rainActive, true);
    assert.equal(rainAtm.lightningActive, true);
    assert.equal(rainAtm.dustActive, false);

    // 4. DENSE_FOG: dense fog (density >= 0.008), calm wind, muffled acoustics
    ws.setWeather('DENSE_FOG', 0);
    assert.equal(ws.getState(), 'DENSE_FOG');
    const fogAtm = ws.getCurrentAtmosphere();
    assert.ok(fogAtm.fogDensity >= 0.008, 'Dense fog density must be >= 0.008');
    assert.equal(fogAtm.muffledAcoustics, true);
    assert.equal(fogAtm.rainActive, false);
    assert.equal(fogAtm.dustActive, false);

    // 5. Smooth transition over time
    ws.setWeather('CLEAR', 2.0);
    assert.ok(ws.transitionProgress < 1.0, 'Transition is in progress');
    ws.update(1.0); // Halfway
    assert.ok(ws.transitionProgress < 1.0, 'Transition is still in progress halfway');
    ws.update(1.1); // Completed
    assert.ok(ws.transitionProgress >= 1.0, 'Transition has completed');
    assert.equal(ws.getState(), 'CLEAR');
});

test('WeatherSystem: wind vector simulation and gust calculation', () => {
    const ws = new WeatherSystem(null, { initialState: 'CLEAR', seed: 1337 });

    // Initial wind vector and strength
    const v0 = ws.getWindVector();
    assert.ok(typeof v0.x === 'number' && Number.isFinite(v0.x));
    assert.ok(typeof v0.z === 'number' && Number.isFinite(v0.z));

    const strength0 = ws.getWindStrength();
    assert.ok(strength0 >= 0, 'Wind strength must be non-negative');
    assert.ok(Math.abs(strength0 - Math.hypot(v0.x, v0.z)) < 1e-4, 'Wind strength matches vector magnitude');

    const gust0 = ws.getGustFactor();
    assert.ok(gust0 >= 0, 'Gust factor must be non-negative');

    // Advance simulation: wind drifts smoothly
    ws.update(0.5);
    const v1 = ws.getWindVector();
    assert.ok(Number.isFinite(v1.x) && Number.isFinite(v1.z));

    // Multiple updates produce continuous evolution without NaN
    for (let i = 0; i < 20; i++) {
        ws.update(0.1);
        const v = ws.getWindVector();
        assert.ok(!Number.isNaN(v.x) && !Number.isNaN(v.z));
    }

    // Different seed produces different wind trajectory
    const ws2 = new WeatherSystem(null, { initialState: 'CLEAR', seed: 9999 });
    const vDiff = ws2.getWindVector();
    assert.ok(vDiff.x !== v0.x || vDiff.z !== v0.z, 'Different seeds produce different wind vectors');
});
