// ============================================================================
//  ArcEngine — ArcStateMachine
// ----------------------------------------------------------------------------
//  Hierarchical Finite State Machine (HFSM) + Behaviour Trees:
//    - State: onEnter, onUpdate, onExit hooks
//    - Transitions: conditional with guard functions
//    - Blackboard: shared data for AI decision making
//    - History: transition recording for debugging
//    - Serialization: save/load AI state
//    - AI presets: patrol, chase, attack, flee, search, idle
//    - Behaviour Tree nodes: sequence, selector, decorator
//    - Visual debug: getDebugInfo() for ArcInspector
// ============================================================================

/**
 * @typedef {Object} StateConfig
 * @property {string} name
 * @property {((sm: ArcStateMachineCore) => void)} [onEnter]
 * @property {((sm: ArcStateMachineCore, dt: number) => void)} [onUpdate]
 * @property {((sm: ArcStateMachineCore) => void)} [onExit]
 * @property {Object} [data] Extra state-local data
 */

/**
 * @typedef {Object} TransitionConfig
 * @property {string} from
 * @property {string} to
 * @property {((sm: ArcStateMachineCore) => boolean)|Function} guard
 * @property {number} [priority=0]
 */

/**
 * @typedef {Object} TransitionRecord
 * @property {string} from
 * @property {string} to
 * @property {number} timestamp
 */

// =========================================================================
//  Blackboard — shared AI data store
// =========================================================================

class Blackboard {
    constructor() {
        /** @type {Map<string, *>} */
        this._data = new Map();
    }

    /**
     * @param {string} key
     * @param {*} value
     * @returns {this}
     */
    set(key, value) {
        this._data.set(key, value);
        return this;
    }

    /**
     * @param {string} key
     * @param {*} [defaultValue]
     * @returns {*}
     */
    get(key, defaultValue) {
        return this._data.has(key) ? this._data.get(key) : (defaultValue ?? null);
    }

    /** @param {string} key @returns {boolean} */
    has(key) { return this._data.has(key); }

    /** @param {string} key @returns {boolean} */
    delete(key) { return this._data.delete(key); }

    clear() { this._data.clear(); }

    /** @returns {Record<string, *>} */
    toJSON() {
        const obj = {};
        for (const [k, v] of this._data) obj[k] = v;
        return obj;
    }

    /** @param {Record<string, *>} obj */
    fromJSON(obj) {
        this._data.clear();
        if (obj && typeof obj === 'object') {
            for (const [k, v] of Object.entries(obj)) this._data.set(k, v);
        }
    }
}

// =========================================================================
//  State Machine Core
// =========================================================================

class ArcStateMachineCore {
    /**
     * @param {Object} [options]
     * @param {string} [options.id] Machine identifier
     * @param {number} [options.maxHistory=50]
     */
    constructor(options = {}) {
        /** @type {string} */
        this.id = options.id || 'fsm_' + (++ArcStateMachineCore._seq);

        /** @type {Map<string, StateConfig>} */
        this._states = new Map();

        /** @type {Array<TransitionConfig>} */
        this._transitions = [];

        /** @type {StateConfig|null} */
        this._current = null;

        /** @type {string|null} */
        this._currentName = null;

        /** @type {string|null} */
        this._previousName = null;

        /** @type {Blackboard} */
        this.blackboard = new Blackboard();

        /** @type {Array<TransitionRecord>} */
        this._history = [];

        /** @type {number} */
        this._maxHistory = options.maxHistory ?? 50;

        /** @type {number} */
        this._elapsedInState = 0;

        /** @type {boolean} */
        this.active = true;
    }

    // =========================================================================
    //  State definition
    // =========================================================================

    /**
     * Add a state.
     * @param {string} name
     * @param {StateConfig|Object} config
     * @returns {this}
     */
    addState(name, config = {}) {
        this._states.set(name, {
            name,
            onEnter: config.onEnter || null,
            onUpdate: config.onUpdate || null,
            onExit: config.onExit || null,
            data: config.data || {}
        });
        return this;
    }

    /**
     * Add a transition.
     * @param {string} from
     * @param {string} to
     * @param {((sm: ArcStateMachineCore) => boolean)|Function} guard - Returns true when transition should fire
     * @param {number} [priority=0]
     * @returns {this}
     */
    addTransition(from, to, guard, priority = 0) {
        this._transitions.push({ from, to, guard, priority });
        // Sort by priority descending
        this._transitions.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        return this;
    }

    // =========================================================================
    //  Control
    // =========================================================================

    /**
     * Set initial state (or force-switch).
     * @param {string} name
     * @returns {this}
     */
    setState(name) {
        const state = this._states.get(name);
        if (!state) {
            console.warn(`ArcStateMachine: unknown state "${name}"`);
            return this;
        }

        // Exit current
        if (this._current && typeof this._current.onExit === 'function') {
            try { this._current.onExit(this); } catch (e) { console.error('FSM onExit error:', e); }
        }

        this._previousName = this._currentName;

        // Record transition
        if (this._currentName !== null) {
            this._recordTransition(this._currentName, name);
        }

        this._current = state;
        this._currentName = name;
        this._elapsedInState = 0;

        // Enter new
        if (typeof state.onEnter === 'function') {
            try { state.onEnter(this); } catch (e) { console.error('FSM onEnter error:', e); }
        }

        return this;
    }

    /**
     * Update: run onUpdate of current state and check transitions.
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.active || !this._current) return;

        this._elapsedInState += dt;

        // Check transitions (priority-sorted)
        for (const t of this._transitions) {
            if (t.from !== this._currentName && t.from !== '*') continue;
            try {
                if (t.guard(this)) {
                    this.setState(t.to);
                    return; // State changed, skip update for this frame
                }
            } catch (e) {
                console.error('FSM guard error:', e);
            }
        }

        // Update current state
        if (typeof this._current.onUpdate === 'function') {
            try { this._current.onUpdate(this, dt); } catch (e) { console.error('FSM onUpdate error:', e); }
        }
    }

    // =========================================================================
    //  Query
    // =========================================================================

    /** @returns {string|null} Current state name */
    get currentState() { return this._currentName; }

    /** @returns {string|null} Previous state name */
    get previousState() { return this._previousName; }

    /** @returns {number} Seconds spent in current state */
    get timeInState() { return this._elapsedInState; }

    /**
     * Check if machine is in a specific state.
     * @param {string} name
     * @returns {boolean}
     */
    isInState(name) { return this._currentName === name; }

    /**
     * Get all registered state names.
     * @returns {string[]}
     */
    getStates() { return Array.from(this._states.keys()); }

    // =========================================================================
    //  History & Debug
    // =========================================================================

    /**
     * @param {string} from
     * @param {string} to
     * @private
     */
    _recordTransition(from, to) {
        this._history.push({
            from, to,
            timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now()
        });
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }
    }

    /**
     * Get transition history.
     * @param {number} [count]
     * @returns {Array<TransitionRecord>}
     */
    getHistory(count) {
        if (count) return this._history.slice(-count);
        return this._history.slice();
    }

    /**
     * Debug info for ArcInspector.
     * @returns {{ id: string, currentState: string|null, previousState: string|null, timeInState: number, states: string[], transitionCount: number, blackboard: Record<string, *> }}
     */
    getDebugInfo() {
        return {
            id: this.id,
            currentState: this._currentName,
            previousState: this._previousName,
            timeInState: Math.round(this._elapsedInState * 1000) / 1000,
            states: this.getStates(),
            transitionCount: this._history.length,
            blackboard: this.blackboard.toJSON()
        };
    }

    // =========================================================================
    //  Serialization
    // =========================================================================

    /** @returns {Record<string, *>} */
    toJSON() {
        return {
            id: this.id,
            currentState: this._currentName,
            previousState: this._previousName,
            elapsedInState: this._elapsedInState,
            blackboard: this.blackboard.toJSON(),
            active: this.active
        };
    }

    /**
     * Restore from serialized data (states and transitions must already be registered).
     * @param {Record<string, *>} json
     * @returns {this}
     */
    fromJSON(json) {
        if (!json) return this;
        this.active = json.active !== false;
        this._elapsedInState = json.elapsedInState || 0;
        this._previousName = json.previousState || null;
        if (json.blackboard) this.blackboard.fromJSON(json.blackboard);
        if (json.currentState && this._states.has(json.currentState)) {
            this._current = this._states.get(json.currentState);
            this._currentName = json.currentState;
            // Don't call onEnter when restoring
        }
        return this;
    }

    /** Destroy and clean up. */
    dispose() {
        this.active = false;
        this._current = null;
        this._currentName = null;
        this._states.clear();
        this._transitions.length = 0;
        this._history.length = 0;
        this.blackboard.clear();
    }
}

/** @type {number} */
ArcStateMachineCore._seq = 0;

// =========================================================================
//  Behaviour Tree Nodes
// =========================================================================

/** @enum {string} */
const BTStatus = {
    SUCCESS: 'success',
    FAILURE: 'failure',
    RUNNING: 'running'
};

/** Base node */
class BTNode {
    constructor(name = 'node') {
        this.name = name;
    }
    /** @param {Blackboard} bb @param {number} dt @returns {string} */
    tick(bb, dt) { return BTStatus.FAILURE; }
    reset() {}
}

/** Runs children in order; fails on first failure. */
class BTSequence extends BTNode {
    /** @param {string} name @param {BTNode[]} children */
    constructor(name, children = []) {
        super(name);
        this.children = children;
        this._runningIndex = 0;
    }
    tick(bb, dt) {
        for (let i = this._runningIndex; i < this.children.length; i++) {
            const status = this.children[i].tick(bb, dt);
            if (status === BTStatus.RUNNING) {
                this._runningIndex = i;
                return BTStatus.RUNNING;
            }
            if (status === BTStatus.FAILURE) {
                this._runningIndex = 0;
                return BTStatus.FAILURE;
            }
        }
        this._runningIndex = 0;
        return BTStatus.SUCCESS;
    }
    reset() {
        this._runningIndex = 0;
        for (const c of this.children) c.reset();
    }
}

/** Runs children in order; succeeds on first success. */
class BTSelector extends BTNode {
    /** @param {string} name @param {BTNode[]} children */
    constructor(name, children = []) {
        super(name);
        this.children = children;
        this._runningIndex = 0;
    }
    tick(bb, dt) {
        for (let i = this._runningIndex; i < this.children.length; i++) {
            const status = this.children[i].tick(bb, dt);
            if (status === BTStatus.RUNNING) {
                this._runningIndex = i;
                return BTStatus.RUNNING;
            }
            if (status === BTStatus.SUCCESS) {
                this._runningIndex = 0;
                return BTStatus.SUCCESS;
            }
        }
        this._runningIndex = 0;
        return BTStatus.FAILURE;
    }
    reset() {
        this._runningIndex = 0;
        for (const c of this.children) c.reset();
    }
}

/** Action leaf node: runs a function. */
class BTAction extends BTNode {
    /**
     * @param {string} name
     * @param {(bb: Blackboard, dt: number) => string} fn Returns BTStatus
     */
    constructor(name, fn) {
        super(name);
        this._fn = fn;
    }
    tick(bb, dt) {
        try { return this._fn(bb, dt) || BTStatus.FAILURE; }
        catch (e) { console.error('BTAction error:', e); return BTStatus.FAILURE; }
    }
}

/** Condition leaf node: checks a predicate. */
class BTCondition extends BTNode {
    /**
     * @param {string} name
     * @param {(bb: Blackboard) => boolean} predicate
     */
    constructor(name, predicate) {
        super(name);
        this._predicate = predicate;
    }
    tick(bb, dt) {
        try { return this._predicate(bb) ? BTStatus.SUCCESS : BTStatus.FAILURE; }
        catch (e) { return BTStatus.FAILURE; }
    }
}

/** Decorator: inverts child result. */
class BTInverter extends BTNode {
    /** @param {BTNode} child */
    constructor(child) {
        super('inverter');
        this.child = child;
    }
    tick(bb, dt) {
        const s = this.child.tick(bb, dt);
        if (s === BTStatus.SUCCESS) return BTStatus.FAILURE;
        if (s === BTStatus.FAILURE) return BTStatus.SUCCESS;
        return BTStatus.RUNNING;
    }
    reset() { this.child.reset(); }
}

/** Decorator: repeats child N times. */
class BTRepeater extends BTNode {
    /** @param {BTNode} child @param {number} times */
    constructor(child, times = 3) {
        super('repeater');
        this.child = child;
        this.times = times;
        this._count = 0;
    }
    tick(bb, dt) {
        while (this._count < this.times) {
            const s = this.child.tick(bb, dt);
            if (s === BTStatus.RUNNING) return BTStatus.RUNNING;
            this._count++;
            if (s === BTStatus.FAILURE) { this._count = 0; return BTStatus.FAILURE; }
        }
        this._count = 0;
        return BTStatus.SUCCESS;
    }
    reset() { this._count = 0; this.child.reset(); }
}

// =========================================================================
//  AI Preset Factory
// =========================================================================

/**
 * Create a preset FSM for common AI behaviors.
 * @param {string} preset - 'patrol', 'chase', 'attack', 'flee', 'search', 'idle', 'guard'
 * @param {Object} [config] - Custom parameters for the preset
 * @returns {ArcStateMachineCore}
 */
function createAIPreset(preset, config = {}) {
    const sm = new ArcStateMachineCore({ id: config.id || `ai_${preset}` });
    const bb = sm.blackboard;

    switch (preset) {
        case 'idle':
            sm.addState('idle', { onEnter: () => bb.set('alert', false) });
            sm.setState('idle');
            break;

        case 'patrol':
            bb.set('waypointIndex', 0);
            bb.set('waypoints', config.waypoints || []);
            bb.set('detectRange', config.detectRange || 200);
            bb.set('targetDist', Infinity);

            sm.addState('patrol', {
                onUpdate: (m, dt) => {
                    const wps = bb.get('waypoints');
                    if (!wps || wps.length === 0) return;
                    const idx = bb.get('waypointIndex') || 0;
                    bb.set('waypointIndex', (idx + 1) % wps.length);
                }
            });
            sm.addState('alert', {
                onEnter: () => bb.set('alertTimer', 0),
                onUpdate: (m, dt) => bb.set('alertTimer', (bb.get('alertTimer') || 0) + dt)
            });
            sm.addState('chase', {});
            sm.addState('return_patrol', {});

            sm.addTransition('patrol', 'alert', (m) => (bb.get('targetDist') || Infinity) < bb.get('detectRange'));
            sm.addTransition('alert', 'chase', (m) => (bb.get('alertTimer') || 0) > 1.5);
            sm.addTransition('chase', 'return_patrol', (m) => (bb.get('targetDist') || Infinity) > bb.get('detectRange') * 1.5);
            sm.addTransition('return_patrol', 'patrol', (m) => m.timeInState > 3);

            sm.setState('patrol');
            break;

        case 'guard':
            bb.set('detectRange', config.detectRange || 150);
            bb.set('attackRange', config.attackRange || 50);
            bb.set('targetDist', Infinity);

            sm.addState('guard', {});
            sm.addState('alert', {
                onEnter: () => bb.set('alertTimer', 0),
                onUpdate: (m, dt) => bb.set('alertTimer', (bb.get('alertTimer') || 0) + dt)
            });
            sm.addState('engage', {});

            sm.addTransition('guard', 'alert', (m) => (bb.get('targetDist') || Infinity) < bb.get('detectRange'));
            sm.addTransition('alert', 'engage', (m) => (bb.get('targetDist') || Infinity) < bb.get('attackRange'));
            sm.addTransition('engage', 'guard', (m) => (bb.get('targetDist') || Infinity) > bb.get('detectRange'));
            sm.addTransition('alert', 'guard', (m) => m.timeInState > 5 && (bb.get('targetDist') || Infinity) > bb.get('detectRange'));

            sm.setState('guard');
            break;

        default:
            sm.addState('idle', {});
            sm.setState('idle');
    }

    return sm;
}

// Universal exports (invariant 8: the cast is how a classic script attaches to page globals).
if (typeof window !== 'undefined') {
    const w = /** @type {any} */ (window);
    w.ArcStateMachine = ArcStateMachineCore;
    w.Blackboard = Blackboard;
    w.BTStatus = BTStatus;
    w.BTNode = BTNode;
    w.BTSequence = BTSequence;
    w.BTSelector = BTSelector;
    w.BTAction = BTAction;
    w.BTCondition = BTCondition;
    w.BTInverter = BTInverter;
    w.BTRepeater = BTRepeater;
    w.createAIPreset = createAIPreset;
}
if (typeof globalThis !== 'undefined') {
    const g = /** @type {any} */ (globalThis);
    g.ArcStateMachine = ArcStateMachineCore;
    g.Blackboard = Blackboard;
    g.BTStatus = BTStatus;
    g.BTNode = BTNode;
    g.BTSequence = BTSequence;
    g.BTSelector = BTSelector;
    g.BTAction = BTAction;
    g.BTCondition = BTCondition;
    g.BTInverter = BTInverter;
    g.BTRepeater = BTRepeater;
    g.createAIPreset = createAIPreset;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ArcStateMachine: ArcStateMachineCore,
        ArcStateMachineCore,
        Blackboard,
        BTStatus, BTNode, BTSequence, BTSelector,
        BTAction, BTCondition, BTInverter, BTRepeater,
        createAIPreset
    };
}
