// ============================================================================
//  ArcEngine — ArcSpatialGrid (High-Performance 2D Spatial Hash Grid)
// ----------------------------------------------------------------------------
//  Provides O(1) spatial partitioning for proximity checks, raycasting, sensor
//  systems (hearing, sight), and collision detection on large-scale maps (e.g. 4096x4096).
// ============================================================================

/**
 * @typedef {Object} SpatialGridStats
 * @property {number} entityCount
 * @property {number} activeCellCount
 * @property {number} cellSize
 */

/**
 * @typedef {Object} GridEntry
 * @property {*} entity
 * @property {number} x
 * @property {number} y
 * @property {number} radius
 * @property {number} minCx
 * @property {number} maxCx
 * @property {number} minCy
 * @property {number} maxCy
 */

class ArcSpatialGrid {
    /**
     * @param {number|{cellSize?: number}} [cellSize=128] Size of each grid cell in world units (default: 128 px)
     */
    constructor(cellSize = 128) {
        const size = typeof cellSize === 'number'
            ? cellSize
            : (cellSize && typeof cellSize === 'object' && typeof cellSize.cellSize === 'number' ? cellSize.cellSize : 128);
        this.cellSize = (typeof size === 'number' && size > 0 && !isNaN(size)) ? size : 128;
        this.invCellSize = 1 / this.cellSize;

        /** @type {Map<string, Set<*>>} cellKey -> Set<entity> */
        this.cells = new Map();

        /** @type {Map<*, GridEntry>} entity -> entry */
        this.entries = new Map();
    }

    /**
     * Converts world coordinate to cell coordinate
     * @param {number} val
     * @returns {number}
     */
    _toCell(val) {
        return Math.floor(val * this.invCellSize);
    }

    /**
     * Cell key generator
     * @param {number} cx
     * @param {number} cy
     * @returns {string}
     */
    _key(cx, cy) {
        return cx + ':' + cy;
    }

    /**
     * Inserts an entity into the grid. Handles entities with radius overlapping multiple cells.
     * Stores entity and bounds.
     * @param {*} entity The entity to track
     * @param {number} x World X coordinate
     * @param {number} y World Y coordinate (or 2D Z in 3D world)
     * @param {number} [radius=0] Bounding radius (default: 0)
     * @returns {this}
     */
    insert(entity, x, y, radius = 0) {
        if (!entity) return this;
        if (this.entries.has(entity)) {
            return this.update(entity, x, y, radius);
        }

        const r = Math.max(0, Number(radius) || 0);
        const minCx = this._toCell(x - r);
        const maxCx = this._toCell(x + r);
        const minCy = this._toCell(y - r);
        const maxCy = this._toCell(y + r);

        /** @type {GridEntry} */
        const entry = { entity, x: Number(x) || 0, y: Number(y) || 0, radius: r, minCx, maxCx, minCy, maxCy };
        this.entries.set(entity, entry);

        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                const key = this._key(cx, cy);
                let cell = this.cells.get(key);
                if (!cell) {
                    cell = new Set();
                    this.cells.set(key, cell);
                }
                cell.add(entity);
            }
        }

        return this;
    }

    /**
     * Updates an entity position in the grid. Checks if cells changed; only re-indexes if necessary.
     * @param {*} entity The entity to update
     * @param {number} newX World X coordinate
     * @param {number} newY World Y coordinate
     * @param {number} [radius] Optional new radius (defaults to current radius if omitted)
     * @returns {this}
     */
    update(entity, newX, newY, radius) {
        const entry = this.entries.get(entity);
        if (!entry) {
            return this.insert(entity, newX, newY, radius ?? 0);
        }

        const r = radius !== undefined ? Math.max(0, Number(radius) || 0) : entry.radius;
        const nx = Number(newX) || 0;
        const ny = Number(newY) || 0;

        const newMinCx = this._toCell(nx - r);
        const newMaxCx = this._toCell(nx + r);
        const newMinCy = this._toCell(ny - r);
        const newMaxCy = this._toCell(ny + r);

        // Check if bounding cells changed
        if (
            newMinCx === entry.minCx &&
            newMaxCx === entry.maxCx &&
            newMinCy === entry.minCy &&
            newMaxCy === entry.maxCy
        ) {
            // Cells haven't changed, only update coordinates and radius
            entry.x = nx;
            entry.y = ny;
            entry.radius = r;
            return this;
        }

        // Remove from old cells
        for (let cx = entry.minCx; cx <= entry.maxCx; cx++) {
            for (let cy = entry.minCy; cy <= entry.maxCy; cy++) {
                const key = this._key(cx, cy);
                const cell = this.cells.get(key);
                if (cell) {
                    cell.delete(entity);
                    if (cell.size === 0) {
                        this.cells.delete(key);
                    }
                }
            }
        }

        // Update entry
        entry.x = nx;
        entry.y = ny;
        entry.radius = r;
        entry.minCx = newMinCx;
        entry.maxCx = newMaxCx;
        entry.minCy = newMinCy;
        entry.maxCy = newMaxCy;

        // Insert into new cells
        for (let cx = newMinCx; cx <= newMaxCx; cx++) {
            for (let cy = newMinCy; cy <= newMaxCy; cy++) {
                const key = this._key(cx, cy);
                let cell = this.cells.get(key);
                if (!cell) {
                    cell = new Set();
                    this.cells.set(key, cell);
                }
                cell.add(entity);
            }
        }

        return this;
    }

    /**
     * Removes an entity from all cells it occupies
     * @param {*} entity The entity to remove
     * @returns {boolean} True if entity was removed, false if not found
     */
    remove(entity) {
        const entry = this.entries.get(entity);
        if (!entry) return false;

        for (let cx = entry.minCx; cx <= entry.maxCx; cx++) {
            for (let cy = entry.minCy; cy <= entry.maxCy; cy++) {
                const key = this._key(cx, cy);
                const cell = this.cells.get(key);
                if (cell) {
                    cell.delete(entity);
                    if (cell.size === 0) {
                        this.cells.delete(key);
                    }
                }
            }
        }

        this.entries.delete(entity);
        return true;
    }

    /**
     * Returns deduplicated array of entities within Euclidean radius of (x, y).
     * Checks bounding cells only (O(1) relative to total entities).
     * @param {number} x Center X
     * @param {number} y Center Y
     * @param {number} radius Query radius
     * @param {((entity: any) => boolean)|null} [filterFn=null] Optional filter predicate
     * @returns {Array<*>}
     */
    queryRadius(x, y, radius, filterFn = null) {
        if (radius < 0) return [];
        const r = Math.max(0, Number(radius) || 0);
        const minCx = this._toCell(x - r);
        const maxCx = this._toCell(x + r);
        const minCy = this._toCell(y - r);
        const maxCy = this._toCell(y + r);

        /** @type {Set<*>} */
        const matched = new Set();
        /** @type {Array<*>} */
        const result = [];

        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                const cell = this.cells.get(this._key(cx, cy));
                if (!cell) continue;

                for (const entity of cell) {
                    if (matched.has(entity)) continue;
                    matched.add(entity);

                    const entry = this.entries.get(entity);
                    if (!entry) continue;

                    // Euclidean circle-circle or circle-point test
                    const dx = entry.x - x;
                    const dy = entry.y - y;
                    const distSq = dx * dx + dy * dy;
                    const effectiveR = r + entry.radius;

                    if (distSq <= effectiveR * effectiveR) {
                        if (!filterFn || filterFn(entity)) {
                            result.push(entity);
                        }
                    }
                }
            }
        }

        return result;
    }

    /**
     * Returns entities overlapping the bounding box.
     * @param {number} minX Minimum X
     * @param {number} minY Minimum Y
     * @param {number} maxX Maximum X
     * @param {number} maxY Maximum Y
     * @param {((entity: any) => boolean)|null} [filterFn=null] Optional filter predicate
     * @returns {Array<*>}
     */
    queryBox(minX, minY, maxX, maxY, filterFn = null) {
        const bMinX = Math.min(minX, maxX);
        const bMaxX = Math.max(minX, maxX);
        const bMinY = Math.min(minY, maxY);
        const bMaxY = Math.max(minY, maxY);

        const minCx = this._toCell(bMinX);
        const maxCx = this._toCell(bMaxX);
        const minCy = this._toCell(bMinY);
        const maxCy = this._toCell(bMaxY);

        /** @type {Set<*>} */
        const matched = new Set();
        /** @type {Array<*>} */
        const result = [];

        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                const cell = this.cells.get(this._key(cx, cy));
                if (!cell) continue;

                for (const entity of cell) {
                    if (matched.has(entity)) continue;
                    matched.add(entity);

                    const entry = this.entries.get(entity);
                    if (!entry) continue;

                    // Exact circle vs AABB overlap test
                    const closestX = Math.max(bMinX, Math.min(bMaxX, entry.x));
                    const closestY = Math.max(bMinY, Math.min(bMaxY, entry.y));
                    const dx = entry.x - closestX;
                    const dy = entry.y - closestY;

                    if (dx * dx + dy * dy <= entry.radius * entry.radius) {
                        if (!filterFn || filterFn(entity)) {
                            result.push(entity);
                        }
                    }
                }
            }
        }

        return result;
    }

    /**
     * Traverses cells along ray (DDA / grid line traversal) and returns entities near the ray.
     * @param {number} startX Ray start X
     * @param {number} startY Ray start Y
     * @param {number} endX Ray end X
     * @param {number} endY Ray end Y
     * @param {((entity: any) => boolean)|null} [filterFn=null] Optional filter predicate
     * @returns {Array<*>} Deduplicated entities along the traversed ray path
     */
    queryRay(startX, startY, endX, endY, filterFn = null) {
        /** @type {Set<*>} */
        const matched = new Set();
        /** @type {Array<*>} */
        const result = [];

        const cellSize = this.cellSize;
        let cx = Math.floor(startX * this.invCellSize);
        let cy = Math.floor(startY * this.invCellSize);
        const endCX = Math.floor(endX * this.invCellSize);
        const endCY = Math.floor(endY * this.invCellSize);

        const dx = endX - startX;
        const dy = endY - startY;

        const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
        const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);

        let tMaxX = Infinity;
        let tDeltaX = Infinity;
        if (stepX !== 0) {
            const nextBoundaryX = stepX > 0 ? (cx + 1) * cellSize : cx * cellSize;
            tMaxX = (nextBoundaryX - startX) / dx;
            tDeltaX = cellSize / Math.abs(dx);
        }

        let tMaxY = Infinity;
        let tDeltaY = Infinity;
        if (stepY !== 0) {
            const nextBoundaryY = stepY > 0 ? (cy + 1) * cellSize : cy * cellSize;
            tMaxY = (nextBoundaryY - startY) / dy;
            tDeltaY = cellSize / Math.abs(dy);
        }

        const maxSteps = Math.abs(endCX - cx) + Math.abs(endCY - cy) + 2;
        let steps = 0;

        while (steps++ <= maxSteps) {
            const cell = this.cells.get(this._key(cx, cy));
            if (cell) {
                for (const entity of cell) {
                    if (matched.has(entity)) continue;
                    matched.add(entity);

                    if (!filterFn || filterFn(entity)) {
                        result.push(entity);
                    }
                }
            }

            if (cx === endCX && cy === endCY) break;

            if (tMaxX < tMaxY) {
                cx += stepX;
                tMaxX += tDeltaX;
            } else if (tMaxY < tMaxX) {
                cy += stepY;
                tMaxY += tDeltaY;
            } else {
                cx += stepX;
                cy += stepY;
                tMaxX += tDeltaX;
                tMaxY += tDeltaY;
            }
        }

        return result;
    }

    /**
     * Finds the closest entity to (x, y) within maxRadius
     * @param {number} x Center X
     * @param {number} y Center Y
     * @param {number} [maxRadius=1024] Search radius limit
     * @param {((entity: any) => boolean)|null} [filterFn=null] Optional filter predicate
     * @returns {*|null} Closest entity or null
     */
    findNearest(x, y, maxRadius = 1024, filterFn = null) {
        const candidates = this.queryRadius(x, y, maxRadius, filterFn);
        if (candidates.length === 0) return null;

        let nearest = null;
        let nearestDistSq = Infinity;

        for (const entity of candidates) {
            const entry = this.entries.get(entity);
            if (!entry) continue;

            const dx = entry.x - x;
            const dy = entry.y - y;
            const distSq = dx * dx + dy * dy;

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = entity;
            }
        }

        return nearest;
    }

    /**
     * Executes a batch of raycast queries asynchronously across CPU worker threads via ArcJobSystem.
     * @param {Array<{ id?: string|number, startX: number, startY: number, endX: number, endY: number, padding?: number }>} rays
     * @param {number} [padding=0]
     * @returns {Promise<Array<{ id: any, hasLoS: boolean, hit: any }>>}
     */
    async queryRayBatchAsync(rays, padding = 0) {
        if (!Array.isArray(rays) || rays.length === 0) return [];

        const blockers = [];
        for (const entry of this.entries.values()) {
            blockers.push({ x: entry.x, y: entry.y, radius: entry.radius });
        }

        if (typeof ArcJobSystem !== 'undefined') {
            try {
                const results = await ArcJobSystem.dispatch('BATCH_RAYCAST', {
                    rays,
                    blockers,
                    padding
                });
                if (Array.isArray(results)) return results;
            } catch (err) {
                console.warn('[ArcSpatialGrid] ArcJobSystem raycast failed, falling back to sync:', err);
            }
        }

        const fallbackResults = [];
        for (const ray of rays) {
            const near = this.queryRay(ray.startX, ray.startY, ray.endX, ray.endY);
            let nearestHit = null;
            for (const ent of near) {
                const entry = this.entries.get(ent);
                if (!entry) continue;
                const r = entry.radius + (ray.padding != null ? ray.padding : padding);
                const dx = ray.endX - ray.startX;
                const dy = ray.endY - ray.startY;
                const ox = ray.startX - entry.x;
                const oy = ray.startY - entry.y;
                const a = dx * dx + dy * dy;
                const b = ox * dx + oy * dy;
                const c = ox * ox + oy * oy - r * r;
                const disc = b * b - a * c;
                if (disc >= 0 && a > 1e-9) {
                    const t = (-b - Math.sqrt(disc)) / a;
                    if (t >= 0 && t <= 1) {
                        if (!nearestHit || t < nearestHit.t) {
                            nearestHit = { t, x: ray.startX + dx * t, y: ray.startY + dy * t, entity: ent };
                        }
                    }
                }
            }
            fallbackResults.push({ id: ray.id, hasLoS: !nearestHit, hit: nearestHit });
        }
        return fallbackResults;
    }

    /**
     * Clears all cells and entity references
     */
    clear() {
        this.cells.clear();
        this.entries.clear();
    }

    /**
     * Returns grid diagnostics and statistics
     * @returns {SpatialGridStats}
     */
    getStats() {
        return {
            entityCount: this.entries.size,
            activeCellCount: this.cells.size,
            cellSize: this.cellSize,
        };
    }
}

// Universal export
if (typeof window !== 'undefined') window.ArcSpatialGrid = ArcSpatialGrid;
if (typeof globalThis !== 'undefined') globalThis.ArcSpatialGrid = ArcSpatialGrid;
if (typeof module !== 'undefined' && module.exports) module.exports = { ArcSpatialGrid };
