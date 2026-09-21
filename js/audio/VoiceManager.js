// ============================================================================
//  ArcEngine — VoiceManager
// ----------------------------------------------------------------------------
//  Audio polyphony management and priority-based voice stealing in Web Audio API.
//  Maintains active voice limits, pre-empts lower priority / older voices when
//  capacity is exceeded, and tracks real-time polyphony metrics.
//
//  Priority tiers:
//    - CRITICAL (3): Player weapons, player impact/damage, close explosions.
//    - HIGH (2):     Enemy weapons, spotter alarms, close hits.
//    - NORMAL (1):   Player footsteps, bullet whizzes, shell casing clatter.
//    - LOW (0):      Distant ambience creaks, wind gusts, distant foley.
//
//  Safe in Node.js test environment without Web Audio API.
// ============================================================================

/**
 * Priority levels for audio voice management.
 * Higher values indicate higher priority sound sources.
 *
 * @readonly
 * @enum {number}
 */
const VoicePriority = Object.freeze({
    CRITICAL: 3,
    HIGH: 2,
    NORMAL: 1,
    LOW: 0
});

/**
 * Information passed to onStealCallback when a voice is stolen.
 * @typedef {Object} StealInfo
 * @property {number} fadeOutTime - Duration in seconds over which the voice should fade out (0.015s).
 */

/**
 * Callback invoked when a voice is preempted / stolen.
 * @callback VoiceStealCallback
 * @param {StealInfo} info
 * @returns {void}
 */

/**
 * Voice token returned upon successful voice allocation.
 * @typedef {Object} VoiceToken
 * @property {string | number} id - Identifier of the sound or sound type.
 * @property {number} priority - Voice priority level.
 * @property {number} token - Unique numeric token handle for the allocated voice.
 * @property {number} timestamp - High-resolution timestamp when allocated.
 */

/**
 * Voice allocation and polyphony statistics.
 * @typedef {Object} VoiceStats
 * @property {number} activeVoices - Number of currently active voices.
 * @property {number} maxVoices - Configured voice capacity.
 * @property {number} stolenCount - Total count of voices stolen.
 * @property {number} droppedCount - Total count of voice allocation requests dropped.
 */

/**
 * Internal record representing an active voice in the polyphony table.
 * @typedef {Object} ActiveVoiceRecord
 * @property {string | number} id - Sound identifier.
 * @property {number} priority - Voice priority level.
 * @property {number} token - Unique numeric token handle.
 * @property {number} timestamp - High-resolution timestamp.
 * @property {VoiceStealCallback | null} onStealCallback - Steal callback.
 * @property {number} _seq - Sequence number for deterministic tie-breaking.
 */

/**
 * Configuration options for VoiceManager constructor.
 * @typedef {Object} VoiceManagerOptions
 * @property {number} [maxVoices=24] - Maximum concurrent active voices.
 */

class VoiceManager {
    /**
     * @param {number | VoiceManagerOptions} [options=24] - Maximum concurrent voices or options object.
     */
    constructor(options = 24) {
        let maxVoices = 24;
        if (typeof options === 'number') {
            maxVoices = options;
        } else if (options && typeof options.maxVoices === 'number') {
            maxVoices = options.maxVoices;
        }

        /** @type {number} Maximum allowed concurrent active voices */
        this.maxVoices = Math.max(0, Math.floor(maxVoices));

        /**
         * Map of active voices indexed by unique token number.
         * @type {Map<number, ActiveVoiceRecord>}
         * @private
         */
        this._voices = new Map();

        /** @type {number} Monotonic token counter */
        this._tokenCounter = 0;

        /** @type {number} Monotonic sequence counter for tie-breaking */
        this._seqCounter = 0;

        /** @type {number} Count of voices stolen due to capacity exhaustion */
        this._stolenCount = 0;

        /** @type {number} Count of voice requests dropped when no stealable voice was available */
        this._droppedCount = 0;

        /** @type {number} Total count of voices successfully allocated */
        this._totalAllocated = 0;
    }

    /**
     * High-resolution current time helper safe in Node.js and browser environments.
     * @private
     * @returns {number}
     */
    _now() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    /**
     * Normalizes and validates the requested priority level.
     * @private
     * @param {number | string} priority
     * @returns {number}
     */
    _resolvePriority(priority) {
        if (typeof priority === 'string' && Object.prototype.hasOwnProperty.call(VoicePriority, priority)) {
            return VoicePriority[/** @type {keyof typeof VoicePriority} */ (priority)];
        }
        if (typeof priority === 'number' && Number.isFinite(priority)) {
            return priority;
        }
        return VoicePriority.NORMAL;
    }

    /**
     * Allocates a voice slot for an audio event.
     *
     * - If active voices < maxVoices: registers voice and returns token `{ id, priority, token, timestamp }`.
     * - If at capacity: finds lowest priority active voice. If lower than requested priority
     *   (or same priority but older), steals it by invoking `onStealCallback({ fadeOutTime: 0.015 })`
     *   and unregistering it, then registers new voice.
     * - If no stealable voice can be found, returns null.
     *
     * @param {string | number} id - Voice / sound effect identifier.
     * @param {number} [priority=VoicePriority.NORMAL] - Priority level.
     * @param {VoiceStealCallback | null} [onStealCallback=null] - Callback invoked when voice is stolen.
     * @returns {VoiceToken | null} Voice token if allocated, or null if dropped.
     */
    allocateVoice(id, priority = VoicePriority.NORMAL, onStealCallback = null) {
        const resolvedPriority = this._resolvePriority(priority);
        const stealCb = typeof onStealCallback === 'function' ? onStealCallback : null;

        // If active voices < maxVoices: register voice immediately
        if (this._voices.size < this.maxVoices) {
            const token = ++this._tokenCounter;
            const timestamp = this._now();
            /** @type {ActiveVoiceRecord} */
            const voiceEntry = {
                id,
                priority: resolvedPriority,
                token,
                timestamp,
                onStealCallback: stealCb,
                _seq: ++this._seqCounter
            };
            this._voices.set(token, voiceEntry);
            this._totalAllocated++;
            return {
                id,
                priority: resolvedPriority,
                token,
                timestamp
            };
        }

        // At capacity: if maxVoices is 0, cannot allocate any voices
        if (this.maxVoices <= 0) {
            this._droppedCount++;
            return null;
        }

        // Find the lowest priority active voice.
        // If multiple active voices share the lowest priority, pick the oldest (smallest timestamp / sequence).
        /** @type {ActiveVoiceRecord | null} */
        let victim = null;
        for (const activeVoice of this._voices.values()) {
            if (!victim) {
                victim = activeVoice;
                continue;
            }
            if (activeVoice.priority < victim.priority) {
                victim = activeVoice;
            } else if (activeVoice.priority === victim.priority) {
                if (activeVoice.timestamp < victim.timestamp ||
                    (activeVoice.timestamp === victim.timestamp && activeVoice._seq < victim._seq)) {
                    victim = activeVoice;
                }
            }
        }

        // A voice can be stolen if it has strictly lower priority than requested,
        // or same priority (since it is already active, it is strictly older than the incoming voice).
        const canSteal = victim !== null && (
            victim.priority < resolvedPriority ||
            victim.priority === resolvedPriority
        );

        if (!canSteal || !victim) {
            this._droppedCount++;
            return null;
        }

        // Steal the victim voice: invoke onStealCallback({ fadeOutTime: 0.015 })
        if (typeof victim.onStealCallback === 'function') {
            try {
                victim.onStealCallback({ fadeOutTime: 0.015 });
            } catch (err) {
                // Safeguard against client callback throwing
            }
        }

        // Unregister victim
        this._voices.delete(victim.token);
        this._stolenCount++;

        // Register new voice
        const token = ++this._tokenCounter;
        const timestamp = this._now();
        /** @type {ActiveVoiceRecord} */
        const voiceEntry = {
            id,
            priority: resolvedPriority,
            token,
            timestamp,
            onStealCallback: stealCb,
            _seq: ++this._seqCounter
        };
        this._voices.set(token, voiceEntry);
        this._totalAllocated++;

        return {
            id,
            priority: resolvedPriority,
            token,
            timestamp
        };
    }

    /**
     * Marks a voice as finished and frees its slot.
     *
     * @param {VoiceToken | { token: number | string } | number | string} token - Voice token object or handle.
     * @returns {boolean} True if the voice was found and released, false if not active.
     */
    releaseVoice(token) {
        if (token === null || token === undefined) {
            return false;
        }

        let key = token;
        if (typeof token === 'object' && token !== null && 'token' in token) {
            key = token.token;
        }

        if (typeof key === 'number') {
            return this._voices.delete(key);
        }

        if (typeof key === 'string') {
            const numericKey = Number(key);
            if (!isNaN(numericKey) && this._voices.has(numericKey)) {
                return this._voices.delete(numericKey);
            }
        }

        return false;
    }

    /**
     * Returns the number of currently playing / active voices.
     * @returns {number}
     */
    getActiveCount() {
        return this._voices.size;
    }

    /**
     * Returns current voice statistics: `{ activeVoices, maxVoices, stolenCount, droppedCount, totalAllocated }`.
     * @returns {VoiceStats & { totalAllocated: number }}
     */
    getStats() {
        return {
            activeVoices: this._voices.size,
            maxVoices: this.maxVoices,
            stolenCount: this._stolenCount,
            droppedCount: this._droppedCount,
            totalAllocated: this._totalAllocated
        };
    }

    /**
     * Releases all currently playing voices and frees all polyphony slots.
     * Invokes onStealCallback for each active voice to ensure clean audio ramp-down.
     * @returns {void}
     */
    clear() {
        for (const voice of this._voices.values()) {
            if (typeof voice.onStealCallback === 'function') {
                try {
                    voice.onStealCallback({ fadeOutTime: 0.015 });
                } catch (err) {
                    // Ignore client callback errors
                }
            }
        }
        this._voices.clear();
    }

    /**
     * Checks if a specific voice token is currently active.
     * @param {VoiceToken | { token: number | string } | number | string} token
     * @returns {boolean}
     */
    hasVoice(token) {
        if (token === null || token === undefined) return false;
        let key = token;
        if (typeof token === 'object' && token !== null && 'token' in token) {
            key = token.token;
        }
        if (typeof key === 'number') {
            return this._voices.has(key);
        }
        if (typeof key === 'string') {
            const numericKey = Number(key);
            if (!isNaN(numericKey)) {
                return this._voices.has(numericKey);
            }
        }
        return false;
    }

    /**
     * Resets cumulative statistics counters (totalAllocated, stolenCount and droppedCount).
     * @returns {void}
     */
    resetStats() {
        this._stolenCount = 0;
        this._droppedCount = 0;
        this._totalAllocated = 0;
    }
}

// Static reference to VoicePriority enum on VoiceManager class
/** @type {typeof VoicePriority} */
VoiceManager.VoicePriority = VoicePriority;

// Universal exports
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).VoiceManager = VoiceManager;
    /** @type {any} */ (window).VoicePriority = VoicePriority;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).VoiceManager = VoiceManager;
    /** @type {any} */ (globalThis).VoicePriority = VoicePriority;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VoiceManager, VoicePriority };
}
