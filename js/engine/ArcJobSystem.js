// ============================================================================
//  ArcEngine — ArcJobSystem (Multi-Core Thread Pool Orchestrator)
// ----------------------------------------------------------------------------
//  Distributes heavy computation (terrain generation, raycasts, AI pathfinding,
//  and physics) across all available CPU cores via Web Workers and Transferables.
//  Includes transparent synchronous fallback for environments without Web Workers.
// ============================================================================

/**
 * @typedef {Object} JobStats
 * @property {number} dispatched
 * @property {number} completed
 * @property {number} failed
 * @property {number} totalTimeMs
 * @property {number} activeWorkers
 * @property {number} concurrency
 * @property {'workers' | 'sync'} backend
 */

class ArcJobSystemCore {
    constructor() {
        /** @type {Worker[]} */
        this.workers = [];
        this.workerCount = 0;
        this.nextWorkerIdx = 0;
        /** @type {Map<number, { resolve: Function, reject: Function, startTime: number, worker?: Worker }>} */
        this.pending = new Map();
        this.nextJobId = 1;
        this.initialized = false;

        /** @type {JobStats} */
        this.stats = {
            dispatched: 0,
            completed: 0,
            failed: 0,
            totalTimeMs: 0,
            activeWorkers: 0,
            concurrency: typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4,
            backend: 'sync'
        };

        this._workerScriptUrl = (typeof location !== 'undefined' && location.origin)
            ? new URL('/js/engine/workers/ArcJobWorker.js', location.origin).href
            : '/js/engine/workers/ArcJobWorker.js';
    }

    /**
     * Initializes the thread pool.
     * @param {Object} [options]
     * @param {number|'auto'} [options.threads='auto']
     * @param {string} [options.workerUrl]
     * @returns {this}
     */
    init(options = {}) {
        if (this.initialized) return this;

        const hw = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
        this.stats.concurrency = hw;

        let threadCount = 2;
        if (typeof options.threads === 'number' && options.threads > 0) {
            threadCount = Math.min(16, Math.max(1, options.threads));
        } else {
            // Reserve 1 core for the main UI/render thread
            threadCount = Math.min(16, Math.max(2, hw > 2 ? hw - 1 : 2));
        }

        if (options.workerUrl) {
            this._workerScriptUrl = options.workerUrl;
        }

        // Check for Web Worker availability
        if (typeof Worker !== 'undefined') {
            try {
                this.workers = [];
                for (let i = 0; i < threadCount; i++) {
                    const worker = new Worker(this._workerScriptUrl);
                    worker.onmessage = (e) => this._onWorkerMessage(e);
                    worker.onerror = (err) => this._onWorkerError(err, worker);
                    worker.onmessageerror = (err) => this._onWorkerError(err, worker);
                    this.workers.push(worker);
                }
                this.workerCount = this.workers.length;
                this.stats.activeWorkers = this.workerCount;
                this.stats.backend = 'workers';
            } catch (e) {
                console.warn('[ArcJobSystem] Web Worker initialization failed, falling back to synchronous execution:', e);
                for (const worker of this.workers) worker.terminate();
                this.workers = [];
                this.workerCount = 0;
                this.stats.backend = 'sync';
            }
        } else {
            this.stats.backend = 'sync';
        }

        this.initialized = true;
        return this;
    }

    /**
     * Internal handler for incoming worker messages.
     * @param {MessageEvent} e
     */
    _onWorkerMessage(e) {
        const { id, result, error } = e.data || {};
        const job = this.pending.get(id);
        if (!job) return;

        this.pending.delete(id);
        const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - job.startTime;
        this.stats.totalTimeMs += elapsed;

        if (error) {
            this.stats.failed++;
            job.reject(new Error(`[ArcJobSystem] Worker task error: ${error}`));
        } else {
            this.stats.completed++;
            job.resolve(result);
        }
    }

    /**
     * Internal handler for unexpected worker errors.
     * @param {ErrorEvent | MessageEvent} err
     * @param {Worker} worker
     */
    _onWorkerError(err, worker) {
        for (const [id, job] of this.pending) {
            if (job.worker !== worker) continue;
            this.pending.delete(id);
            const errMsg = ('message' in err && err.message) ? err.message : 'message decoding error';
            job.reject(new Error("Worker failed: " + errMsg));
        }
        worker.terminate();
        this.workers = this.workers.filter(item => item !== worker);
        this.workerCount = this.workers.length;
        this.nextWorkerIdx = 0;
        this.stats.activeWorkers = this.workerCount;
        if (!this.workerCount) this.stats.backend = "sync";
        console.error('[ArcJobSystem] Worker execution error:', err);
    }

    /**
     * Dispatches a single task to the worker pool (or runs synchronously in fallback).
     * @param {string} type Task identifier (e.g. 'TERRAIN_GEN', 'BATCH_RAYCAST')
     * @param {*} payload Task arguments
     * @param {Transferable[]} [transferables=[]] Array of transferable buffers (e.g. [Float32Array.buffer])
     * @returns {Promise<*>}
     */
    dispatch(type, payload, transferables = []) {
        if (!this.initialized) this.init();

        this.stats.dispatched++;
        const id = this.nextJobId++;
        const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

        // Multi-threaded execution via Web Worker
        if (this.stats.backend === 'workers' && this.workerCount > 0) {
            return new Promise((resolve, reject) => {
                const worker = this.workers[this.nextWorkerIdx];
                this.pending.set(id, { resolve, reject, startTime, worker });
                this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workerCount;
                try {
                    worker.postMessage({ id, type, payload }, transferables);
                } catch (err) {
                    this.pending.delete(id);
                    this.stats.failed++;
                    reject(err);
                }
            });
        }

        // Synchronous fallback runner
        return new Promise((resolve, reject) => {
            try {
                let handler = null;
                if (typeof ArcJobWorker !== 'undefined' && ArcJobWorker.HANDLERS) {
                    handler = ArcJobWorker.HANDLERS[type];
                }
                if (!handler && typeof globalThis !== 'undefined' && (/** @type {any} */ (globalThis)).ArcJobWorker?.HANDLERS) {
                    handler = (/** @type {any} */ (globalThis)).ArcJobWorker.HANDLERS[type];
                }
                if (!handler) {
                    throw new Error(`[ArcJobSystem] Unknown task type or ArcJobWorker not loaded: ${type}`);
                }

                const { result } = handler(payload);
                this.stats.completed++;
                this.stats.totalTimeMs += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
                resolve(result);
            } catch (err) {
                this.stats.failed++;
                reject(err);
            }
        });
    }

    /**
     * Executes a batch of items in parallel across the thread pool.
     * Divides array into chunks and maps across workers.
     * @template T, R
     * @param {T[]} items
     * @param {number} chunkSize
     * @param {string} taskType
     * @param {Object} [context={}]
     * @returns {Promise<R[]>}
     */
    async parallelFor(items, chunkSize, taskType, context = {}) {
        if (!Array.isArray(items) || items.length === 0) return [];
        const size = Math.max(1, chunkSize || Math.ceil(items.length / Math.max(1, this.workerCount)));
        const promises = [];

        for (let i = 0; i < items.length; i += size) {
            const chunk = items.slice(i, i + size);
            promises.push(this.dispatch(taskType, { ...context, chunk, chunkIndex: i / size }));
        }

        const chunkResults = await Promise.all(promises);
        const flattened = [];
        for (const res of chunkResults) {
            if (Array.isArray(res)) {
                for (let k = 0; k < res.length; k++) flattened.push(res[k]);
            } else if (res) {
                flattened.push(res);
            }
        }
        return flattened;
    }

    /**
     * Terminates all worker threads and resets state.
     */
    terminate() {
        for (const worker of this.workers) {
            try { worker.terminate(); } catch (_) {}
        }
        this.workers = [];
        this.workerCount = 0;
        for (const job of this.pending.values()) {
            this.stats.failed++;
            job.reject(new Error("Worker pool terminated"));
        }
        this.pending.clear();
        this.stats.backend = "sync";
        this.stats.activeWorkers = 0;
        this.initialized = false;
    }

    /**
     * Returns current concurrency and telemetry statistics.
     * @returns {JobStats}
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Formatted telemetry for HUD and debug inspector.
     */
    getTelemetry() {
        const s = this.stats;
        const avg = s.completed > 0 ? (s.totalTimeMs / s.completed).toFixed(2) : '0.00';
        return {
            backend: s.backend,
            activeWorkers: s.activeWorkers,
            concurrency: s.concurrency,
            dispatched: s.dispatched,
            completed: s.completed,
            failed: s.failed,
            avgTimeMs: avg,
            summary: s.backend === 'workers'
                ? `⚡ ${s.activeWorkers} Workers | ${s.completed} jobs (${avg}ms avg)`
                : `Synchronous Fallback | ${s.completed} jobs`
        };
    }
}

// Global Singleton Instance
const ArcJobSystem = new ArcJobSystemCore();

// Universal module exports
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ArcJobSystem = ArcJobSystem;
    /** @type {any} */ (window).ArcJobSystemCore = ArcJobSystemCore;
}
if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).ArcJobSystem = ArcJobSystem;
    /** @type {any} */ (globalThis).ArcJobSystemCore = ArcJobSystemCore;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ArcJobSystem, ArcJobSystemCore };
}
