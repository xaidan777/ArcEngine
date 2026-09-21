// ============================================================================
//  ArcEngine — ArcEventBus
// ----------------------------------------------------------------------------
//  High-performance type-safe event system with:
//    - Namespaced events: 'combat.hit', 'player.death', 'weather.change'
//    - Priority ordering: higher-priority handlers execute first
//    - Once listeners: auto-unsubscribe after first invocation
//    - Wildcard matching: 'combat.*' subscribes to all combat events
//    - Event queuing: deferred dispatch on next flush (frame)
//    - Event history: last N events for debugging
//    - Channel isolation: separate buses for 'ui', 'gameplay', 'audio'
//    - Dead listener detection: warns on potential leaks
//    - O(1) dispatch per listener, minimal allocations
// ============================================================================

/**
 * @typedef {Object} EventListenerEntry
 * @property {Function} fn
 * @property {number} priority
 * @property {boolean} once
 * @property {*} [context]
 */

/**
 * @typedef {Object} EventHistoryEntry
 * @property {string} event
 * @property {*} data
 * @property {number} timestamp
 */

class ArcEventBusCore {
    /**
     * @param {Object} [options]
     * @param {number} [options.maxHistory=100] Maximum history entries
     * @param {number} [options.leakThreshold=50] Listener count that triggers leak warning
     */
    constructor(options = {}) {
        /** @type {Map<string, Array<EventListenerEntry>>} */
        this._listeners = new Map();

        /** @type {Array<{event: string, data: *}>} */
        this._queue = [];

        /** @type {Array<EventHistoryEntry>} */
        this._history = [];

        /** @type {number} */
        this._maxHistory = options.maxHistory ?? 100;

        /** @type {number} */
        this._leakThreshold = options.leakThreshold ?? 50;

        /** @type {boolean} */
        this._flushing = false;

        /** @type {number} */
        this._totalEmitted = 0;

        /** @type {number} */
        this._totalListeners = 0;
    }

    // =========================================================================
    //  Subscribe
    // =========================================================================

    /**
     * Subscribe to an event.
     * @param {string} event - Event name (supports 'namespace.*' wildcard)
     * @param {Function} fn - Handler function
     * @param {Object} [options]
     * @param {number} [options.priority=0] Higher = executes first
     * @param {boolean} [options.once=false] Auto-unsubscribe after first call
     * @param {*} [options.context] `this` context for the handler
     * @returns {{ unsubscribe: () => boolean }} Subscription handle
     */
    on(event, fn, options = {}) {
        if (typeof fn !== 'function') throw new TypeError('Handler must be a function');
        const eventStr = String(event);

        /** @type {EventListenerEntry} */
        const entry = {
            fn,
            priority: options.priority ?? 0,
            once: options.once ?? false,
            context: options.context ?? null
        };

        if (!this._listeners.has(eventStr)) {
            this._listeners.set(eventStr, []);
        }

        const list = this._listeners.get(eventStr);
        list.push(entry);
        this._totalListeners++;

        // Sort by priority descending (higher priority first)
        list.sort((a, b) => b.priority - a.priority);

        // Leak detection
        if (list.length > this._leakThreshold) {
            console.warn(`ArcEventBus: "${eventStr}" has ${list.length} listeners — possible memory leak`);
        }

        return {
            unsubscribe: () => this._removeEntry(eventStr, entry)
        };
    }

    /**
     * Subscribe once — automatically unsubscribed after first invocation.
     * @param {string} event
     * @param {Function} fn
     * @param {Object} [options]
     * @returns {{ unsubscribe: () => boolean }}
     */
    once(event, fn, options = {}) {
        return this.on(event, fn, { ...options, once: true });
    }

    /**
     * Unsubscribe a specific handler from an event.
     * @param {string} event
     * @param {Function} fn
     * @returns {boolean}
     */
    off(event, fn) {
        const list = this._listeners.get(event);
        if (!list) return false;
        const idx = list.findIndex(e => e.fn === fn);
        if (idx === -1) return false;
        list.splice(idx, 1);
        this._totalListeners--;
        if (list.length === 0) this._listeners.delete(event);
        return true;
    }

    // =========================================================================
    //  Emit
    // =========================================================================

    /**
     * Emit an event immediately (synchronous dispatch).
     * @param {string} event
     * @param {*} [data]
     * @returns {number} Number of handlers invoked
     */
    emit(event, data) {
        this._totalEmitted++;
        const eventStr = String(event);

        // Record history
        this._recordHistory(eventStr, data);

        let invoked = 0;

        // Direct listeners
        invoked += this._dispatch(eventStr, data);

        // Wildcard listeners: 'combat.*' matches 'combat.hit'
        if (eventStr.includes('.')) {
            const parts = eventStr.split('.');
            for (let i = parts.length - 1; i >= 1; i--) {
                const wildcard = parts.slice(0, i).join('.') + '.*';
                invoked += this._dispatch(wildcard, data);
            }
        }

        // Global wildcard '*'
        invoked += this._dispatch('*', data);

        return invoked;
    }

    /**
     * Queue an event for deferred dispatch (call flush() to process).
     * @param {string} event
     * @param {*} [data]
     */
    enqueue(event, data) {
        this._queue.push({ event: String(event), data });
    }

    /**
     * Process all queued events. Call once per frame.
     * @returns {number} Number of events processed
     */
    flush() {
        if (this._flushing) return 0;
        this._flushing = true;

        const queued = this._queue.slice();
        this._queue.length = 0;

        let processed = 0;
        for (const item of queued) {
            this.emit(item.event, item.data);
            processed++;
        }

        this._flushing = false;
        return processed;
    }

    // =========================================================================
    //  Internal dispatch
    // =========================================================================

    /**
     * @param {string} key
     * @param {*} data
     * @returns {number}
     * @private
     */
    _dispatch(key, data) {
        const list = this._listeners.get(key);
        if (!list || list.length === 0) return 0;

        let invoked = 0;
        /** @type {Array<EventListenerEntry>} */
        const toRemove = [];

        for (const entry of list) {
            // Counted BEFORE the call: the contract is "handlers invoked", so a handler that
            // throws still counts — it ran, and the error is isolated below.
            invoked++;
            try {
                if (entry.context) {
                    entry.fn.call(entry.context, data);
                } else {
                    entry.fn(data);
                }
            } catch (err) {
                console.error(`ArcEventBus: error in handler for "${key}"`, err);
            }

            if (entry.once) {
                toRemove.push(entry);
            }
        }

        // Clean up once listeners
        for (const entry of toRemove) {
            this._removeEntry(key, entry);
        }

        return invoked;
    }

    /**
     * @param {string} key
     * @param {EventListenerEntry} entry
     * @returns {boolean}
     * @private
     */
    _removeEntry(key, entry) {
        const list = this._listeners.get(key);
        if (!list) return false;
        const idx = list.indexOf(entry);
        if (idx === -1) return false;
        list.splice(idx, 1);
        this._totalListeners--;
        if (list.length === 0) this._listeners.delete(key);
        return true;
    }

    /**
     * @param {string} event
     * @param {*} data
     * @private
     */
    _recordHistory(event, data) {
        this._history.push({
            event,
            data,
            timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now()
        });
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }
    }

    // =========================================================================
    //  Channels (isolated buses)
    // =========================================================================

    /**
     * Create an isolated channel (separate event bus).
     * @param {string} name
     * @returns {ArcEventBusCore}
     */
    channel(name) {
        if (!this._channels) this._channels = new Map();
        if (!this._channels.has(name)) {
            this._channels.set(name, new ArcEventBusCore({
                maxHistory: this._maxHistory,
                leakThreshold: this._leakThreshold
            }));
        }
        return this._channels.get(name);
    }

    // =========================================================================
    //  Utilities
    // =========================================================================

    /**
     * Remove all listeners for an event, or all listeners entirely.
     * @param {string} [event] If omitted, clears everything
     * @returns {number} Number of listeners removed
     */
    clear(event) {
        if (event) {
            const list = this._listeners.get(event);
            if (!list) return 0;
            const count = list.length;
            this._totalListeners -= count;
            this._listeners.delete(event);
            return count;
        }

        const total = this._totalListeners;
        this._listeners.clear();
        this._queue.length = 0;
        this._totalListeners = 0;
        if (this._channels) this._channels.clear();
        return total;
    }

    /**
     * Get event history for debugging.
     * @param {number} [count] Last N events
     * @returns {Array<EventHistoryEntry>}
     */
    getHistory(count) {
        if (count) return this._history.slice(-count);
        return this._history.slice();
    }

    /**
     * Check if an event has any listeners.
     * @param {string} event
     * @returns {boolean}
     */
    hasListeners(event) {
        const list = this._listeners.get(event);
        return !!list && list.length > 0;
    }

    /**
     * Get listener count for a specific event or all events.
     * @param {string} [event]
     * @returns {number}
     */
    listenerCount(event) {
        if (event) {
            const list = this._listeners.get(event);
            return list ? list.length : 0;
        }
        return this._totalListeners;
    }

    /**
     * Get diagnostics.
     * @returns {{ totalListeners: number, totalEmitted: number, eventNames: string[], queueLength: number, historyLength: number }}
     */
    getStats() {
        return {
            totalListeners: this._totalListeners,
            totalEmitted: this._totalEmitted,
            eventNames: Array.from(this._listeners.keys()),
            queueLength: this._queue.length,
            historyLength: this._history.length
        };
    }
}

// Singleton global event bus
const ArcEventBus = new ArcEventBusCore();

// Universal exports. The casts are the kit's idiom for attaching to the page globals
// (invariant 8): the modules are classic scripts, and `window` here is the same object as
// `globalThis`, which the narrowed lib.dom types do not know.
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ArcEventBus = ArcEventBus;
    /** @type {any} */ (window).ArcEventBusCore = ArcEventBusCore;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).ArcEventBus = ArcEventBus;
    /** @type {any} */ (globalThis).ArcEventBusCore = ArcEventBusCore;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ArcEventBus, ArcEventBusCore };
}
