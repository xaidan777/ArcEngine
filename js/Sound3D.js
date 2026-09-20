// Sound3D.js — the game's sound on the Web Audio API: effects, music and sounds that stand in
// the world. No dependencies; files — .wav, .mp3, .ogg from assets/sounds/.
//
//     Sound3D.play(src);                                  // an effect, as is
//     Sound3D.play(src, { x, y, volume: 0.8 });           // at a map point
//     Sound3D.play(src, { at: car, loop: true });         // follows car.x, car.y
//     Sound3D.music(src);                                 // the one looped background track
//     const wind = Sound3D.play(src, { loop: true });
//     wind.setVolume(0.3);  wind.stop();
//
// src — a path written in game code as a quoted LITERAL (assets/sounds/step.wav): the builder's
// asset scanner archives only files referenced that way (and reads comments too — hence no
// quoted paths here).
//
// play() returns a handle AT ONCE: the file loads in the background (once per path) and starts
// when it arrives; stop() before that simply cancels the start. A missing file is a console
// warning and a silent handle — the game goes on. The browser keeps sound locked until the
// first press or key: what was started earlier begins at that moment.
//
// A sound with a place (x, y or at) is heard from WHERE THE CAMERA IS (update(camera), every
// frame) — not from the point it looks at: moving away makes it quieter, turning around does
// not silence it. The audible region is a SPHERE around the source: full volume within the
// falloff MIN radius, fading linearly to silence at the falloff MAX one (AUDIO_FALLOFF_MIN /
// AUDIO_FALLOFF_MAX, or the sound's own pair — an object of the location carries one, and the
// editor draws both spheres around the selected object). Panned left/right by where it is on
// the screen. No obstacles and no echo.
// Channels 'sfx' (default) and 'music' have volumes of their own: AUDIO_*_VOLUME in Constants.js.
// An object of the location sounds by itself — the sound field of its Objects.js record
// (Location3D.updateSound).

/**
 * @typedef {Object} SoundOptions
 * @property {number} [volume] 0..1, 1 by default
 * @property {boolean} [loop]
 * @property {string} [channel] 'sfx' (default) | 'music'
 * @property {number} [x] map px — a sound at a fixed point (with y)
 * @property {number} [y]
 * @property {{ x: number, y: number, h?: number }} [at] an object with live x, y (and h) fields — the sound follows it
 * @property {number} [falloffMin] px: full volume within this radius, then it fades; none — AUDIO_FALLOFF_MIN
 * @property {number} [falloffMax] px: silent from here on; none — AUDIO_FALLOFF_MAX
 * @property {BABYLON.AbstractMesh | null} [node] the mesh the sound sits on — its world position wins over x/y
 */

/** @satisfies {Record<string, any>} */
const Sound3D = {
    CHANNELS: ['sfx', 'music'],
    FADE: 0.03,              // s: time constant of volume changes and of the fade on stop() — no clicks

    /** @type {AudioContext | null} */
    ctx: null,
    /** @type {GainNode | null} */
    master: null,
    /** @type {Record<string, GainNode>} */
    buses: {},
    /** @type {Map<string, Promise<AudioBuffer | null>>} */
    buffers: new Map(),
    /** @type {Set<SoundHandle>} */
    playing: new Set(),
    /** @type {{ x: number, y: number, h: number, azimuth: number } | null} */
    listener: null,          // where sounds are heard from; null — no camera yet: no fading
    muted: false,
    /** @type {SoundHandle | null} */
    _music: null,
    _warned: false,

    cfg() {
        const U = 'undefined';
        return {
            master: typeof AUDIO_MASTER_VOLUME !== U ? AUDIO_MASTER_VOLUME : 0.8,
            music: typeof AUDIO_MUSIC_VOLUME !== U ? AUDIO_MUSIC_VOLUME : 0.6,
            sfx: typeof AUDIO_SFX_VOLUME !== U ? AUDIO_SFX_VOLUME : 1,
            min: typeof AUDIO_FALLOFF_MIN !== U ? AUDIO_FALLOFF_MIN : 150,
            max: typeof AUDIO_FALLOFF_MAX !== U ? AUDIO_FALLOFF_MAX : 1024,
            pan: typeof AUDIO_PAN !== U ? AUDIO_PAN : 0.7,
        };
    },

    // The audio context and the mixer: source -> handle gain -> pan -> channel bus -> master.
    // Created by the first play() or load(); false — the browser has no Web Audio.
    init() {
        if (this.ctx) return true;
        const Ctx = typeof AudioContext !== 'undefined' ? AudioContext : /** @type {any} */ (window).webkitAudioContext;
        try {
            this.ctx = Ctx ? new Ctx() : null;
        } catch (e) {
            this.ctx = null;
        }
        if (!this.ctx) {
            if (!this._warned) console.warn('Sound3D: Web Audio недоступен — игра без звука');
            this._warned = true;
            return false;
        }
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        for (const name of this.CHANNELS) {
            this.buses[name] = this.ctx.createGain();
            this.buses[name].connect(this.master);
        }
        this.applyConstants();

        // Autoplay policy: the context runs only after a user gesture.
        const unlock = () => { if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {}); };
        for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, unlock, true);
        // A hidden tab is silent: the frame loop is stopped there anyway.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.ctx.suspend().catch(() => {});
            else this.ctx.resume().catch(() => {});
        });
        return true;
    },

    // Volumes from AUDIO_* (the editor — live) and the mute flag.
    applyConstants() {
        if (!this.ctx) return;
        const c = this.cfg(), unit = (v) => Math.max(0, Math.min(1, Number(v) || 0));
        this.master.gain.value = this.muted ? 0 : unit(c.master);
        this.buses.music.gain.value = unit(c.music);
        this.buses.sfx.gain.value = unit(c.sfx);
    },

    setMuted(on) {
        this.muted = !!on;
        this.applyConstants();
    },

    // The decoded file, once per path; missing or broken — null and a warning.
    /** @param {string} src @returns {Promise<AudioBuffer | null>} */
    load(src) {
        let p = this.buffers.get(src);
        if (!p) {
            p = !this.init() ? Promise.resolve(null) : fetch(src)
                .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                .then(data => this.ctx.decodeAudioData(data))
                .catch((e) => {
                    console.warn('Sound3D: не загрузился звук ' + src + ' — ' + ((e && e.message) || e));
                    return null;
                });
            this.buffers.set(src, p);
        }
        return p;
    },

    /** @param {string} src @param {SoundOptions} [opts] @returns {SoundHandle} */
    play(src, opts) {
        const handle = new SoundHandle(src, opts || {});
        this.playing.add(handle);
        this.load(src).then((buffer) => {
            if (buffer && handle.playing) handle._start(buffer);
            else handle.stop();
        });
        return handle;
    },

    // The background track: looped, on the 'music' channel, replaces the previous one.
    // music(null) — silence. The same track again keeps playing.
    /** @param {string | null} src @param {SoundOptions} [opts] @returns {SoundHandle | null} */
    music(src, opts) {
        const cur = this._music;
        if (cur && cur.playing && cur.src === src) return cur;
        if (cur) cur.stop();
        this._music = src ? this.play(src, Object.assign({ loop: true }, opts, { channel: 'music' })) : null;
        return this._music;
    },

    stopAll() {
        for (const handle of [...this.playing]) handle.stop();
    },

    // Every frame, before the render: the listener stands WHERE THE CAMERA IS (not where it
    // looks), so moving away makes a sound quieter and merely turning around does not silence
    // it. camera — a CameraController; cam.position is the world point: x, height, map y.
    /** @param {CameraController | null} camera */
    update(camera) {
        if (camera && camera.cam) {
            const p = camera.cam.position;
            const l = this.listener || (this.listener = { x: 0, y: 0, h: 0, azimuth: 0 });
            l.x = p.x;
            l.y = p.z;
            l.h = p.y;
            l.azimuth = camera.azimuth;
        }
        if (!this.ctx || !this.listener) return;
        const c = this.cfg();
        for (const handle of this.playing) if (handle.at && handle.gain) handle._place(c, false);
    },

    // --- Distance and pan math (no audio — tests/sound.test.mjs) ----------------------

    // source and listener — world points { x, y (map px), h (height) }; the listener also
    // carries the camera azimuth. The distance is the straight 3D one, so the audible region is
    // a SPHERE of radius `max` around the source — that is what the editor draws around a
    // selected object.
    // `min` px — the flat core: full volume within it, then linearly down to 0 at `max` px.
    // A core AT LEAST as big as the audible radius (a quiet sound in a world with a wide
    // AUDIO_FALLOFF_MIN) leaves no room to fade, so it becomes 0 — the sound fades from the
    // source outward instead of jumping to silence at the edge.
    // Pan: −1 (left) … 1 (right) by the screen side, taken on the map plane, no wider than
    // `width`, and none right at the listener (no flip when a source passes through the
    // center) — "right on the screen" is (−sin az, cos az).
    spatial(source, listener, min, max, width) {
        const dx = source.x - listener.x, dy = source.y - listener.y, dh = (source.h || 0) - (listener.h || 0);
        const d = Math.hypot(dx, dy, dh), flat = Math.hypot(dx, dy);
        const far = Math.max(0, max), near = min < far ? Math.max(0, min) : 0;
        const gain = d <= near ? 1 : far > near ? Math.max(0, (far - d) / (far - near)) : 0;
        const az = listener.azimuth || 0;
        const side = flat > 0 ? (-dx * Math.sin(az) + dy * Math.cos(az)) / flat : 0;
        return { gain, pan: side * Math.min(1, d / Math.max(1, near || far)) * width };
    },
};

// One started sound: what play() returns.
class SoundHandle {
    /** @param {string} src @param {SoundOptions} opts */
    constructor(src, opts) {
        this.src = src;
        this.channel = opts.channel === 'music' ? 'music' : 'sfx';
        this.loop = !!opts.loop;
        this.volume = opts.volume == null ? 1 : Math.max(0, Math.min(1, Number(opts.volume) || 0));
        /** @type {{ x: number, y: number, h?: number } | null} */
        this.at = opts.at || (opts.x != null && opts.y != null ? { x: Number(opts.x) || 0, y: Number(opts.y) || 0, h: 0 } : null);
        this.falloffMin = Number(opts.falloffMin) > 0 ? Number(opts.falloffMin) : 0;   // 0 — AUDIO_FALLOFF_MIN
        this.falloffMax = Number(opts.falloffMax) > 0 ? Number(opts.falloffMax) : 0;   // 0 — AUDIO_FALLOFF_MAX
        /** @type {BABYLON.AbstractMesh | null} */
        this.node = opts.node || null;     // the mesh the sound sits on: its world position wins over at.x/y
        this.playing = true;     // until stop() or the end of a sound that is not looped
        /** @type {AudioBufferSourceNode | null} */
        this.source = null;
        /** @type {GainNode | null} */
        this.gain = null;
        /** @type {StereoPannerNode | null} */
        this.panner = null;
        this._level = -1;        // what the nodes were last told: a still sound schedules nothing
        this._pan = 0;
    }

    /** @param {AudioBuffer} buffer */
    _start(buffer) {
        const ctx = Sound3D.ctx;
        const source = this.source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = this.loop;
        this.gain = ctx.createGain();
        source.connect(this.gain);
        /** @type {AudioNode} */
        let out = this.gain;
        if (this.at && ctx.createStereoPanner) {
            this.panner = ctx.createStereoPanner();
            out.connect(this.panner);
            out = this.panner;
        }
        out.connect(Sound3D.buses[this.channel]);
        this._place(Sound3D.cfg(), true);
        source.onended = () => this.stop();
        source.start();
    }

    // Where the sound stands, in world px: the node's own position when it has one (a location
    // object's mesh — it already sits on the terrain), otherwise the given map point.
    where() {
        const n = this.node;
        if (n && !n.isDisposed()) return { x: n.position.x, y: n.position.z, h: n.position.y };
        return { x: this.at.x, y: this.at.y, h: Number(this.at.h) || 0 };
    }

    // Volume × distance -> the gain node, the side -> the panner; now — at once (the start).
    _place(c, now) {
        let level = this.volume, pan = 0;
        const l = Sound3D.listener;
        if (this.at && l) {
            const s = Sound3D.spatial(this.where(), l, this.falloffMin || c.min, this.falloffMax || c.max, c.pan);
            level *= s.gain;
            pan = s.pan;
        }
        if (!now && Math.abs(level - this._level) < 0.002 && Math.abs(pan - this._pan) < 0.002) return;
        this._level = level;
        this._pan = pan;
        const t = Sound3D.ctx.currentTime;
        if (now) {
            this.gain.gain.value = level;
            if (this.panner) this.panner.pan.value = pan;
        } else {
            this.gain.gain.setTargetAtTime(level, t, Sound3D.FADE);
            if (this.panner) this.panner.pan.setTargetAtTime(pan, t, Sound3D.FADE);
        }
    }

    setVolume(v) {
        const volume = Math.max(0, Math.min(1, Number(v) || 0));
        if (volume === this.volume) return this;
        this.volume = volume;
        if (this.gain) this._place(Sound3D.cfg(), false);
        return this;
    }

    // A short fade instead of a cut: a wave stopped mid-swing clicks.
    stop() {
        if (!this.playing) return;
        this.playing = false;
        Sound3D.playing.delete(this);
        const source = this.source, ctx = Sound3D.ctx;
        if (!source || !ctx) return;
        source.onended = null;
        this.gain.gain.setTargetAtTime(0, ctx.currentTime, Sound3D.FADE);
        try { source.stop(ctx.currentTime + Sound3D.FADE * 5); } catch (e) { /* ended by itself */ }
    }
}
