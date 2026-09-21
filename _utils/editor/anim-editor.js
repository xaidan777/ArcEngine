// anim-editor.js — the animation TIMELINE: the panel that makes an animation editable and, more
// importantly, VISIBLE. ClipDoc holds the curves; this file draws them and lets a designer fix
// what the quality checks report.
//
// The three things a designer needs and a plain keyframe list does not give:
//   * a CURVE VIEW — the shape between two keys, so an ease can be judged, not guessed;
//   * ONION SKIN — the previous and next frame drawn faintly over the current pose, which is the
//     only way to see whether a motion arcs or snaps;
//   * the FINDINGS list from ClipDoc.validate, next to the curve they belong to, so a spike is a
//     click away from the key that caused it.
//
// All of the maths lives in ClipDoc and is tested headlessly; this panel is the drawing and the
// pointer handling. Panel geometry is computed in PURE helpers (`frameToX`, `xToFrame`,
// `curvePoints`) so it can be tested without a DOM.

/** @satisfies {Record<string, any>} */
const AnimEditor = {
    ROOT_ID: 'anim-editor',
    /** Height of the curve area, px. */
    CURVE_HEIGHT: 120,
    /** Radius of a keyframe marker, px. */
    KEY_RADIUS: 4,
    /** Onion skin colours: previous frame and next frame. */
    ONION_PREV: '#4aa3ff',
    ONION_NEXT: '#ff9f4a',

    /** @type {any} */
    clip: null,
    /** Currently selected track id ('' — the whole clip). */
    selectedTrack: '',
    /** Playhead in seconds. */
    time: 0,
    playing: false,
    /** Whether auto-keying is active when transforming nodes/bones */
    autoKey: false,
    /** Draw the neighbouring frames faintly over the current pose. */
    onionSkin: true,
    /** Frames either side to draw when onion skin is on. */
    onionFrames: 1,
    /** Pixels per second, i.e. the timeline zoom. */
    zoom: 200,
    /** Cached findings from the last validate(), so the panel does not recompute per frame. */
    findings: [],
    onSeek: null,

    onTransform(node) {
        if (!this.autoKey || !this.clip || !node) return;
        this.keyAll(node);
        if (typeof EditorPanels !== 'undefined') EditorPanels.refreshAnim();
    },

    init(root) {
        this.root = root || (typeof document !== 'undefined' ? document.getElementById(this.ROOT_ID) : null);
        return !!this.root;
    },

    setClip(clip) {
        this.clip = clip;
        this.time = 0;
        this.selectedTrack = clip ? (this.trackIds()[0] || '') : '';
        this.revalidate();
        return this;
    },

    // --- pure geometry (tested without a DOM) ---------------------------------

    /** The seconds-to-pixels scale, guarded so a bad zoom cannot divide by zero. */
    pixelsPerSecond() {
        const z = Number(this.zoom);
        return Number.isFinite(z) && z > 0 ? z : 200;
    },

    /** Time -> x within the curve area. */
    frameToX(time) {
        return Number(time || 0) * this.pixelsPerSecond();
    },

    /** x -> time. The inverse of frameToX, so a click lands on the pixel the user aimed at. */
    xToFrame(x) {
        return Number(x || 0) / this.pixelsPerSecond();
    },

    /** The time of frame `n`, for the timeline ruler. */
    frameTime(frame) {
        const fps = this.clip && this.clip.fps > 0 ? this.clip.fps : 30;
        return Number(frame) / fps;
    },

    /** The frame index at a time — what the ruler labels and what snapping uses. */
    timeToFrame(time) {
        const fps = this.clip && this.clip.fps > 0 ? this.clip.fps : 30;
        return Math.round(Number(time || 0) * fps);
    },

    /**
     * Snap a time to the frame grid. A timeline that does not snap produces keys at 0.0333 s and
     * 0.0334 s, which then read as duplicates and produce a twitch — the exact fault the quality
     * checks report. Snapping here is what keeps a clip clean by construction.
     */
    snapTime(time) {
        return this.frameTime(this.timeToFrame(time));
    },

    /**
     * The polyline of a channel's curve, sampled finely enough that an ease's shape is visible.
     * Returns points in panel space with the value normalised into the curve height, so tracks
     * with wildly different ranges can share one view.
     * @returns {Array<{ x: number, y: number, time: number, value: number }>}
     */
    curvePoints(track, samples) {
        if (!track || !track.keys || !this.clip) return [];
        const keys = track.keys;
        if (!keys.length) return [];
        let lo = Infinity, hi = -Infinity;
        for (const key of keys) { lo = Math.min(lo, key.value); hi = Math.max(hi, key.value); }
        // A constant channel has no range: draw it through the middle instead of dividing by zero.
        const span = hi - lo;
        const count = Number(samples) > 0 ? Number(samples) : 60;
        const duration = this.clip.duration > 0 ? this.clip.duration : 1;
        const points = [];
        for (let i = 0; i <= count; i++) {
            const time = (i / count) * duration;
            const value = ClipDoc.evaluate(this.clip, track.target, track.path, time);
            const normalised = span > 1e-9 ? (value - lo) / span : 0.5;
            points.push({
                x: this.frameToX(time),
                // y grows downward in a panel, so the value is flipped.
                y: this.CURVE_HEIGHT - normalised * this.CURVE_HEIGHT,
                time,
                value,
            });
        }
        return points;
    },

    /** Where a key's marker sits, in panel space. */
    keyPoint(track, key) {
        const keys = (track && track.keys) || [];
        let lo = Infinity, hi = -Infinity;
        for (const k of keys) { lo = Math.min(lo, k.value); hi = Math.max(hi, k.value); }
        const span = hi - lo;
        const normalised = span > 1e-9 ? (key.value - lo) / span : 0.5;
        return {
            x: this.frameToX(key.time),
            y: this.CURVE_HEIGHT - normalised * this.CURVE_HEIGHT,
        };
    },

    /** Track ids in a stable order, for the channel list beside the curve. */
    trackIds() {
        if (!this.clip) return [];
        return ClipDoc.allTracks(this.clip).map(t => t.id);
    },

    /**
     * The onion-skin times to draw: `onionFrames` steps before and after `time`, clamped to the
     * clip. Returns `[{ time, kind: 'prev' | 'next' }]`. Nothing when the feature is off.
     */
    onionTimes() {
        if (!this.onionSkin || !this.clip) return [];
        const step = 1 / (this.clip.fps > 0 ? this.clip.fps : 30);
        const depth = Math.max(1, Math.min(5, Number(this.onionFrames) || 1));
        const out = [];
        for (let i = 1; i <= depth; i++) {
            const before = this.time - i * step;
            const after = this.time + i * step;
            if (before >= 0) out.push({ time: before, kind: 'prev' });
            if (after <= this.clip.duration) out.push({ time: after, kind: 'next' });
        }
        return out;
    },

    /** The findings that belong to the selected track (or all of them when none is selected). */
    findingsFor(trackId) {
        if (!trackId) return this.findings.slice();
        const track = this.clip && this.clip.tracks[trackId];
        const label = track ? track.target + '.' + track.path : '';
        return this.findings.filter(f => f.track === label);
    },

    revalidate() {
        this.findings = this.clip ? ClipDoc.validate(this.clip) : [];
        return this.findings;
    },

    /** Findings grouped by severity — what the panel's badge shows. */
    summary() {
        const out = { error: 0, warn: 0, info: 0 };
        for (const f of this.findings) if (out[f.level] != null) out[f.level]++;
        return out;
    },

    // --- playback -------------------------------------------------------------

    play() { this.playing = true; return this; },
    pause() { this.playing = false; return this; },

    /** Advance the playhead, honouring the clip's loop setting. */
    update(dt) {
        if (!this.playing || !this.clip) return;
        this.time += Math.max(0, dt);
        if (this.time > this.clip.duration) {
            if (this.clip.loop) this.time = this.time % this.clip.duration;
            else { this.time = this.clip.duration; this.playing = false; }
        }
        if (this.onSeek) this.onSeek(this.time);
    },

    seek(time) {
        if (!this.clip) return 0;
        this.time = Math.max(0, Math.min(this.clip.duration, Number(time) || 0));
        if (this.onSeek) this.onSeek(this.time);
        return this.time;
    },

    /**
     * Step `delta` frames, which is how a designer inspects a motion frame by frame.
     *
     * The step goes through the FRAME INDEX, not through repeated float addition: stepping 1/30 s
     * thirty times accumulates a rounding error, and over a long scrub the playhead drifts off the
     * grid — which then makes a keyed frame land on a neighbouring frame.
     */
    stepFrame(delta) {
        if (!this.clip) return 0;
        const steps = Number(delta) || 0;
        const frame = this.timeToFrame(this.time) + steps;
        return this.seek(this.frameTime(frame));
    },

    // --- editing --------------------------------------------------------------

    /** Key every path of a node at the current time, the way a pose-and-press-K flow works. */
    keyAll(node, paths) {
        if (!this.clip || !node || !node.transform) return 0;
        const list = Array.isArray(paths) && paths.length ? paths : ClipDoc.PATHS.filter(p => node.transform[p] != null);
        let count = 0;
        const time = this.snapTime(this.time);
        for (const path of list) {
            if (node.transform[path] == null) continue;
            if (ClipDoc.keyframe(this.clip, node.name || node.id, path, time, node.transform[path])) count++;
        }
        this.revalidate();
        return count;
    },

    /** Add a key at `time` on the selected track with the value evaluated there (a split). */
    keyAt(trackId, time) {
        if (!this.clip) return false;
        const track = this.clip.tracks[trackId];
        if (!track) return false;
        const value = ClipDoc.evaluate(this.clip, track.target, track.path, time);
        if (value == null) return false;
        const added = ClipDoc.keyframe(this.clip, track.target, track.path, this.snapTime(time), value);
        this.revalidate();
        return added;
    },

    dispose() {
        this.clip = null;
        this.selectedTrack = '';
        this.findings = [];
        this.playing = false;
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = AnimEditor;
if (typeof window !== 'undefined') /** @type {any} */ (window).AnimEditor = AnimEditor;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).AnimEditor = AnimEditor;