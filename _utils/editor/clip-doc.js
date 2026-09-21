// clip-doc.js — the animation DOCUMENT: keyframed tracks, interpolation curves and the sampler
// that turns them into values at a point in time.
//
// WHY a separate model instead of using Babylon's AnimationGroup directly: an editor has to be
// able to SHOW the curve, let a designer drag a tangent, and CHECK the result before it ever
// reaches the GPU. Babylon's groups are a playback format — you can start them, not inspect them.
// This file is the source of truth; ClipPlayer (below in this file) pushes it into Babylon.
//
// The shape, deliberately close to what glTF stores so an export stays possible:
//   clip   { name, fps, duration, loop, tracks: { [trackId]: track } }
//   track  { id, target, path, keys: [key], }
//          target — the node/bone name, path — 'x' | 'y' | 'h' | 'rotX' | 'rotY' | 'rotZ' |
//          'scaleX' | 'scaleY' | 'scaleZ'
//   key    { time, value, ease }
//          ease — 'linear' | 'step' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier',
//          plus `out`/`in` tangent slopes for 'bezier'.
//
// The evaluator is PURE: same clip + same time => same value, always. That is what makes a
// "crooked animation" detectable in a test rather than only visible on screen.

/** @satisfies {Record<string, any>} */
const ClipDoc = {
    /**
     * How far above the median a segment must be to be worth flagging as a spike. 4 is high
     * enough that an intentional fast move is not reported, low enough to catch a mistyped key.
     */
    SPIKE_FACTOR: 4,
    /** Supported interpolation modes. 'step' holds the previous value until the next key. */
    EASES: ['linear', 'step', 'easeIn', 'easeOut', 'easeInOut', 'bezier'],
    /** Animation paths that exist on a scene node. */
    PATHS: ['x', 'y', 'h', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ'],

    /** A new, empty clip. `duration` is seconds; fps decides the frame grid the timeline shows. */
    create(name = 'New Clip', fps = 30, duration = 1) {
        return {
            version: 1,
            name,
            fps: Number(fps) > 0 ? Number(fps) : 30,
            duration: Number(duration) > 0 ? Number(duration) : 1,
            loop: true,
            /** @type {Record<string, any>} */
            tracks: {},
            /** Bumped by every command; a panel compares it to know it must redraw. */
            revision: 0,
            dirty: false,
        };
    },

    /** Track key: one target + one path, which is exactly one animated channel. */
    trackId(target, path) {
        return String(target) + '|' + String(path);
    },

    /**
     * Make (or return) the track for a target and path. A track with no keys is useless, so the
     * caller is expected to add one — `keyframe()` does it in a single call.
     */
    track(clip, target, path) {
        const id = this.trackId(target, path);
        let t = clip.tracks[id];
        if (!t) {
            t = { id, target, path, keys: [] };
            clip.tracks[id] = t;
        }
        return t;
    },

    /** All tracks, in a stable order so a panel and a file agree. */
    allTracks(clip) {
        return Object.keys(clip.tracks).map(id => clip.tracks[id])
            .sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : (a.path < b.path ? -1 : 1)));
    },

    // --- commands -------------------------------------------------------------

    /**
     * Run `mutate` as one undoable step, exactly like SceneDoc.command. Captures the tracks map
     * before and after; the map is small and this is exact.
     */
    command(clip, label, mutate, key) {
        if (!clip || typeof mutate !== 'function') return false;
        const before = JSON.stringify(clip.tracks);
        mutate();
        const after = JSON.stringify(clip.tracks);
        if (before === after) return false;
        clip.revision++;
        clip.dirty = true;
        if (typeof EditHistory !== 'undefined' && EditHistory.record) {
            EditHistory.record(key || ('clip:' + label), () => this.restore(clip, before), () => this.restore(clip, after));
        }
        return true;
    },

    /** Write a captured tracks snapshot back, syncing objects IN PLACE so panels stay valid. */
    restore(clip, snapshot) {
        /** @type {Record<string, any>} */
        let next;
        try { next = JSON.parse(snapshot); } catch (err) { return false; }
        for (const id of Object.keys(clip.tracks)) if (!next[id]) delete clip.tracks[id];
        for (const id of Object.keys(next)) {
            const incoming = next[id];
            const existing = clip.tracks[id];
            if (!existing) { clip.tracks[id] = incoming; continue; }
            existing.target = incoming.target;
            existing.path = incoming.path;
            // Keys are replaced as a list: a panel holds the track, not the individual keys.
            existing.keys = incoming.keys;
        }
        clip.revision++;
        clip.dirty = true;
        return true;
    },

    /**
     * Set (or replace) the key at `time` on one channel. Replacing rather than appending is what
     * a designer expects: posing at a time and pressing K overwrites that frame, it does not
     * stack a second key on the same frame.
     */
    keyframe(clip, target, path, time, value, ease = 'linear') {
        const t = Number(time);
        const v = Number(value);
        if (!Number.isFinite(t) || !Number.isFinite(v)) return false;
        return this.command(clip, 'Key ' + target + '.' + path, () => {
            const track = this.track(clip, target, path);
            const at = track.keys.findIndex(k => Math.abs(k.time - t) < 1e-6);
            const entry = { time: Math.max(0, t), value: v, ease: this.EASES.indexOf(ease) >= 0 ? ease : 'linear' };
            if (at >= 0) track.keys[at] = entry;
            else track.keys.push(entry);
            track.keys.sort((a, b) => a.time - b.time);
        }, 'key:' + this.trackId(target, path));
    },

    /** Remove the key at `time`. Returns false when there was none. */
    removeKey(clip, target, path, time) {
        const track = clip.tracks[this.trackId(target, path)];
        if (!track) return false;
        if (!track.keys.some(k => Math.abs(k.time - time) < 1e-6)) return false;
        return this.command(clip, 'Unkey ' + target + '.' + path, () => {
            track.keys = track.keys.filter(k => Math.abs(k.time - time) >= 1e-6);
            // A track with no keys is noise in the timeline and in a saved file.
            if (!track.keys.length) delete clip.tracks[track.id];
        });
    },

    /** Move a key in time (a timeline drag). Keeps the track sorted. */
    moveKey(clip, target, path, from, to) {
        const track = clip.tracks[this.trackId(target, path)];
        if (!track) return false;
        const at = track.keys.findIndex(k => Math.abs(k.time - from) < 1e-6);
        const time = Math.max(0, Number(to));
        if (at < 0 || !Number.isFinite(time) || Math.abs(time - from) < 1e-6) return false;
        return this.command(clip, 'Move key', () => {
            track.keys[at].time = time;
            track.keys.sort((a, b) => a.time - b.time);
        }, 'movekey:' + track.id);
    },

    /** Change one key's interpolation. `handles` carries bezier tangents when needed. */
    setEase(clip, target, path, time, ease, handles) {
        const track = clip.tracks[this.trackId(target, path)];
        if (!track || this.EASES.indexOf(ease) < 0) return false;
        const key = track.keys.find(k => Math.abs(k.time - time) < 1e-6);
        if (!key) return false;
        return this.command(clip, 'Ease ' + ease, () => {
            key.ease = ease;
            if (ease === 'bezier' && handles) {
                key.out = Number(handles.out) || 0;
                key.in = Number(handles.in) || 0;
            } else {
                delete key.out;
                delete key.in;
            }
        });
    },

    /** Rename a clip. */
    rename(clip, name) {
        const clean = String(name == null ? '' : name).trim();
        if (!clean || clean === clip.name) return false;
        clip.name = clean;
        clip.dirty = true;
        clip.revision++;
        return true;
    },

    /** Change the length. A live clip keeps every key; a shorter one is not silently truncated. */
    setDuration(clip, seconds) {
        const value = Number(seconds);
        if (!Number.isFinite(value) || value <= 0 || value === clip.duration) return false;
        clip.duration = value;
        clip.dirty = true;
        clip.revision++;
        return true;
    },

    // --- evaluation -----------------------------------------------------------

    /**
     * Ease a normalised 0..1 segment. Every mode is defined for t in [0,1] and returns [0,1] for
     * a monotone input, which is what keeps a curve from overshooting into a "crooked" pose.
     * 'bezier' uses the key's tangent slopes for a cubic Hermite segment.
     */
    ease(ease, t, out = 0, into = 0) {
        const x = Math.max(0, Math.min(1, t));
        if (ease === 'step') return 0;
        if (ease === 'easeIn') return x * x;
        if (ease === 'easeOut') return 1 - (1 - x) * (1 - x);
        if (ease === 'easeInOut') return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
        if (ease === 'bezier') {
            // Cubic Hermite between the two KEY VALUES, which are always 0 and 1 in this
            // normalised form: p0 = 0, p1 = 1, with the tangents `out` (leaving the first key)
            // and `into` (arriving at the second). h00..h11 are the Hermite basis functions.
            const x2 = x * x, x3 = x2 * x;
            const h10 = x3 - 2 * x2 + x;
            const h01 = -2 * x3 + 3 * x2;
            const h11 = x3 - x2;
            // h00 * 0 is omitted: p0 is zero by construction.
            return h10 * out + h01 + h11 * into;
        }
        return x;   // linear
    },

    /**
     * The value of one channel at `time`. Outside the keyed range the curve HOLDS the first or
     * last value: extrapolating would invent motion the designer never authored.
     */
    evaluate(clip, target, path, time) {
        const track = clip.tracks[this.trackId(target, path)];
        if (!track || !track.keys.length) return null;
        const keys = track.keys;
        if (keys.length === 1 || time <= keys[0].time) return keys[0].value;
        const last = keys[keys.length - 1];
        if (time >= last.time) return last.value;
        for (let i = 0; i < keys.length - 1; i++) {
            const a = keys[i], b = keys[i + 1];
            if (time < a.time || time > b.time) continue;
            const span = b.time - a.time;
            if (span <= 0) return b.value;
            const f = this.ease(a.ease, (time - a.time) / span, a.out, b.in);
            return a.value + (b.value - a.value) * f;
        }
        return last.value;
    },

    /** Every channel at a time, as `{ 'target|path': value }`. The player consumes this. */
    sample(clip, time) {
        /** @type {Record<string, number>} */
        const out = {};
        for (const id of Object.keys(clip.tracks)) {
            const track = clip.tracks[id];
            const value = this.evaluate(clip, track.target, track.path, time);
            if (value != null) out[id] = value;
        }
        return out;
    },

    /**
     * The clip as dense per-frame samples, which is what a GLB export and a naive player need.
     * `step` defaults to one frame at the clip's fps.
     */
    bake(clip, step) {
        const dt = Number(step) > 0 ? Number(step) : 1 / clip.fps;
        const frames = Math.max(1, Math.round(clip.duration / dt));
        /** @type {Array<{ time: number, values: Record<string, number> }>} */
        const out = [];
        // Inclusive of the end: a loop that stops one frame short visibly hitches.
        for (let i = 0; i <= frames; i++) {
            const time = Math.min(clip.duration, i * dt);
            out.push({ time, values: this.sample(clip, time) });
        }
        return out;
    },

    // --- quality checks ("no crooked animations") ------------------------------

    /**
     * Inspect a clip for the faults that make an animation look wrong, and return them as data so
     * a panel can list them. This is the whole point of keeping the curve as our own model: these
     * are undetectable once the clip is only a Babylon AnimationGroup.
     *
     * Checks:
     *   empty        — a track with no keys, or a clip with no tracks at all;
     *   out-of-range — a key beyond the clip's duration (silently never played);
     *   unsorted     — keys out of time order (the evaluator would sample the wrong segment);
     *   duplicate    — two keys on the same time (the later silently wins);
     *   hitch        — a 'step' key mid-clip, which reads as a pop on a moving channel;
     *   loop-seam    — a looping clip whose first and last values differ on a channel, which
     *                  shows as a snap every cycle unless the designer wanted it;
     *   spike        — a single frame whose speed is far above its neighbours: the classic
     *                  "crooked" twitch caused by one mistyped key.
     * @returns {Array<{ level: string, code: string, track: string, time: number, message: string }>}
     */
    validate(clip) {
        const out = [];
        const add = (level, code, track, time, message) => out.push({ level, code, track, time, message });
        const tracks = this.allTracks(clip);
        if (!tracks.length) add('warn', 'empty', '', 0, 'the clip has no tracks');

        for (const track of tracks) {
            const keys = track.keys;
            const label = track.target + '.' + track.path;
            if (!keys.length) { add('warn', 'empty', label, 0, 'the track has no keys'); continue; }
            for (let i = 0; i < keys.length; i++) {
                if (keys[i].time > clip.duration + 1e-6) {
                    add('error', 'out-of-range', label, keys[i].time,
                        'key at ' + keys[i].time.toFixed(3) + 's is past the clip end (' + clip.duration + 's) and never plays');
                }
                if (i > 0 && keys[i].time < keys[i - 1].time) {
                    add('error', 'unsorted', label, keys[i].time, 'keys are out of time order');
                }
                if (i > 0 && Math.abs(keys[i].time - keys[i - 1].time) < 1e-6) {
                    add('error', 'duplicate', label, keys[i].time, 'two keys share this time; one is ignored');
                }
                if (keys[i].ease === 'step' && i < keys.length - 1) {
                    add('info', 'hitch', label, keys[i].time, 'a step key mid-clip holds then jumps — intended for a pose change, not for motion');
                }
            }
            // Loop seam: only meaningful when the channel actually moves.
            if (clip.loop && keys.length > 1) {
                const first = keys[0].value, last = keys[keys.length - 1].value;
                if (Math.abs(first - last) > 1e-6) {
                    add('info', 'loop-seam', label, clip.duration,
                        'a looping clip starts at ' + first + ' and ends at ' + last + ': unless that jump is intended, the loop snaps');
                }
            }
            // Spike: compare each segment's speed with the median of the others.
            const speeds = [];
            for (let i = 1; i < keys.length; i++) {
                const dt = keys[i].time - keys[i - 1].time;
                if (dt > 1e-6) speeds.push(Math.abs(keys[i].value - keys[i - 1].value) / dt);
            }
            if (speeds.length >= 3) {
                const sorted = speeds.slice().sort((a, b) => a - b);
                const median = sorted[Math.floor(sorted.length / 2)] || 0;
                if (median > 1e-6) {
                    for (let i = 0; i < speeds.length; i++) {
                        if (speeds[i] > median * this.SPIKE_FACTOR) {
                            add('warn', 'spike', label, keys[i + 1].time,
                                'this segment moves ' + (speeds[i] / median).toFixed(1) + 'x faster than the clip median — a likely mistyped key');
                        }
                    }
                }
            }
        }
        return out;
    },

    /** True when a clip has no error-level findings — what a "ready to ship" check asserts. */
    isClean(clip) {
        return !this.validate(clip).some(f => f.level === 'error');
    },

    // --- serialisation --------------------------------------------------------

    toJSON(clip) {
        return {
            version: 1,
            name: clip.name,
            fps: clip.fps,
            duration: clip.duration,
            loop: clip.loop,
            tracks: clip.tracks,
        };
    },

    /**
     * Rebuild a clip from a parsed file. Tracks are validated on the way in: a hand-edited file
     * with keys out of order is SORTED rather than trusted, because an unsorted track would make
     * the evaluator silently sample a wrong segment.
     */
    fromJSON(data) {
        if (!data || typeof data !== 'object' || !data.tracks || typeof data.tracks !== 'object') return null;
        const clip = this.create(data.name || 'Clip', data.fps, data.duration);
        clip.loop = data.loop !== false;
        for (const id of Object.keys(data.tracks)) {
            const raw = data.tracks[id];
            if (!raw || !Array.isArray(raw.keys)) continue;
            const keys = raw.keys
                .filter(k => k && Number.isFinite(Number(k.time)) && Number.isFinite(Number(k.value)))
                .map(k => ({
                    time: Math.max(0, Number(k.time)),
                    value: Number(k.value),
                    ease: this.EASES.indexOf(k.ease) >= 0 ? k.ease : 'linear',
                    ...(k.ease === 'bezier' ? { out: Number(k.out) || 0, in: Number(k.in) || 0 } : {}),
                }))
                .sort((a, b) => a.time - b.time);
            if (!keys.length) continue;
            const target = String(raw.target != null ? raw.target : id.split('|')[0]);
            const path = String(raw.path != null ? raw.path : id.split('|')[1] || 'x');
            clip.tracks[this.trackId(target, path)] = { id: this.trackId(target, path), target, path, keys };
        }
        clip.revision = 1;
        clip.dirty = false;
        return clip;
    },

    /** Mark saved (a panel calls this after a successful write). */
    markSaved(clip) {
        if (!clip) return;
        clip.dirty = false;
    },
};

/**
 * Push a clip onto a live node. Kept in this file because it is the only part that needs
 * Babylon, while everything above is pure and testable headlessly.
 *
 * It writes node.transform each frame, so it composes with anything else that reads the same
 * transform — there is no hidden Babylon animation state to fight.
 */
class ClipPlayer {
    /**
     * @param {any} clip
     * @param {any} node a scene node with a `transform`
     * @param {any} [targets] optional map of bone name -> object with x/y/h style fields
     */
    constructor(clip, node, targets) {
        this.clip = clip;
        this.node = node;
        this.targets = targets || null;
        this.time = 0;
        this.speed = 1;
        this.playing = false;
    }

    play() { this.playing = true; return this; }
    pause() { this.playing = false; return this; }
    stop() { this.playing = false; this.time = 0; this.apply(); return this; }

    /** Advance by dt seconds and apply. Looping wraps; a non-looping clip holds the end pose. */
    update(dt) {
        if (!this.playing || !this.clip) return;
        this.time += Math.max(0, dt) * this.speed;
        if (this.time > this.clip.duration) {
            if (this.clip.loop) this.time = this.time % this.clip.duration;
            else { this.time = this.clip.duration; this.playing = false; }
        }
        this.apply();
    }

    /** Write the sampled values into the target object's transform. */
    apply() {
        if (!this.clip || !this.node) return;
        const values = ClipDoc.sample(this.clip, this.time);
        for (const id of Object.keys(values)) {
            const track = this.clip.tracks[id];
            const holder = this.holderFor(track.target);
            if (holder && holder.transform) holder.transform[track.path] = values[id];
        }
    }

    holderFor(target) {
        if (this.targets && this.targets[target]) return this.targets[target];
        return this.node;
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ClipDoc, ClipPlayer };
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ClipDoc = ClipDoc;
    /** @type {any} */ (window).ClipPlayer = ClipPlayer;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).ClipDoc = ClipDoc;
    /** @type {any} */ (globalThis).ClipPlayer = ClipPlayer;
}