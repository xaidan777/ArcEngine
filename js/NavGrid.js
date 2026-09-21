// NavGrid.js — 2D spatial grid for waypoint and A* navigation around obstacles.
// Zero-dependency pure JavaScript: deterministic, portable across Node.js and browser.

/**
 * @typedef {{ x: number, y: number }} Point2D
 */

class NavGrid {
  /**
   * @param {{ width?: number, height?: number }} [bounds]
   * @param {number} [cellSize=64]
   */
  constructor(bounds = { width: 4096, height: 4096 }, cellSize = 64) {
    this.width = bounds.width || 4096;
    this.height = bounds.height || 4096;
    this.cellSize = cellSize;
    this.cols = Math.ceil(this.width / cellSize);
    this.rows = Math.ceil(this.height / cellSize);
    /** @type {Uint8Array} 0 = passable, 1 = blocked */
    this.grid = new Uint8Array(this.cols * this.rows);
    this.blockers = [];
    this._buildRevision = 0;
  }

  /**
   * Rasterize blockers into the grid.
   * @param {Array<{ x: number, y: number, radius?: number }>} blockers
   * @param {number} [padding=14]
   */
  build(blockers = [], padding = 14) {
    ++this._buildRevision;
    this.blockers = blockers || [];
    this.grid.fill(0);

    for (const b of this.blockers) {
      const r = (b.radius || 24) + padding;
      const minCol = Math.max(0, Math.floor((b.x - r) / this.cellSize));
      const maxCol = Math.min(this.cols - 1, Math.floor((b.x + r) / this.cellSize));
      const minRow = Math.max(0, Math.floor((b.y - r) / this.cellSize));
      const maxRow = Math.min(this.rows - 1, Math.floor((b.y + r) / this.cellSize));
      const rSq = r * r;

      for (let row = minRow; row <= maxRow; row++) {
        const cy = (row + 0.5) * this.cellSize;
        for (let col = minCol; col <= maxCol; col++) {
          const cx = (col + 0.5) * this.cellSize;
          const dx = cx - b.x;
          const dy = cy - b.y;
          if (dx * dx + dy * dy <= rSq) {
            this.grid[row * this.cols + col] = 1;
          }
        }
      }
    }
  }

  /**
   * Asynchronously rasterize blockers into the grid using worker pool.
   * @param {Array<{ x: number, y: number, radius?: number }>} blockers
   * @param {number} [padding=14]
   * @returns {Promise<void>}
   */
  async buildAsync(blockers = [], padding = 14) {
    const revision = ++this._buildRevision;
    this.blockers = blockers || [];
    if (typeof ArcJobSystem !== 'undefined') {
      try {
        const res = await ArcJobSystem.dispatch('NAVGRID_RASTERIZE', {
          cols: this.cols,
          rows: this.rows,
          cellSize: this.cellSize,
          blockers: this.blockers,
          padding
        });
        if (revision !== this._buildRevision) return;
        if (res && res.grid) {
          this.grid = res.grid;
          return;
        }
      } catch (err) {
        console.warn('[NavGrid] ArcJobSystem rasterize failed, falling back to sync:', err);
      }
    }
    if (revision === this._buildRevision) this.build(blockers, padding);
  }

  /**
   * Batch asynchronous pathfinding for multiple queries simultaneously.
   * @param {Array<{ id: number|string, start: Point2D, goal: Point2D }>} queries
   * @param {number} [maxIterations=1200]
   * @returns {Promise<Map<number|string, Point2D[]>>}
   */
  async findPathsBatchAsync(queries, maxIterations = 1200) {
    const results = new Map();
    if (!queries || queries.length === 0) return results;

    const remainingQueries = [];
    for (const q of queries) {
      if (typeof ShooterRules !== 'undefined' && ShooterRules.hasLineOfSight(q.start, q.goal, this.blockers, 14)) {
        results.set(q.id, [{ x: q.goal.x, y: q.goal.y }]);
      } else {
        remainingQueries.push({
          id: q.id,
          startX: q.start.x,
          startY: q.start.y,
          endX: q.goal.x,
          endY: q.goal.y
        });
      }
    }

    if (remainingQueries.length === 0) return results;

    if (typeof ArcJobSystem !== 'undefined') {
      try {
        const res = await ArcJobSystem.dispatch('BATCH_PATHFIND', {
          queries: remainingQueries,
          grid: this.grid,
          width: this.cols,
          height: this.rows,
          cols: this.cols,
          rows: this.rows,
          cellSize: this.cellSize,
          blockers: this.blockers,
          maxIterations
        });
        if (Array.isArray(res)) {
          for (const item of res) {
            results.set(item.id, item.path || []);
          }
          return results;
        }
      } catch (err) {
        console.warn('[NavGrid] ArcJobSystem batch pathfind fallback:', err);
      }
    }

    for (const q of remainingQueries) {
      results.set(q.id, this.findPath({ x: q.startX, y: q.startY }, { x: q.endX, y: q.endY }, maxIterations));
    }
    return results;
  }

  /**
   * Check if a cell coordinate is within grid bounds.
   * @param {number} col
   * @param {number} row
   * @returns {boolean}
   */
  inBounds(col, row) {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  /**
   * Check if a world point is walkable.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isWalkable(x, y) {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    if (!this.inBounds(col, row)) return false;
    return this.grid[row * this.cols + col] === 0;
  }

  /**
   * Check if a world point is blocked.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isBlocked(x, y) {
    return !this.isWalkable(x, y);
  }

  /**
   * Convert grid column/row to world center coordinate.
   * @param {number} col
   * @param {number} row
   * @returns {Point2D}
   */
  gridToWorld(col, row) {
    return {
      x: (col + 0.5) * this.cellSize,
      y: (row + 0.5) * this.cellSize,
    };
  }

  /**
   * Find the nearest walkable cell to the given world point.
   * @param {number} x
   * @param {number} y
   * @param {number} [maxSearchRadius=6]
   * @returns {{ col: number, row: number } | null}
   */
  findNearestWalkableCell(x, y, maxSearchRadius = 6) {
    let targetCol = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));
    let targetRow = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));

    if (this.grid[targetRow * this.cols + targetCol] === 0) {
      return { col: targetCol, row: targetRow };
    }

    let nearest = null;
    let nearestDistSq = Infinity;

    for (let r = 1; r <= maxSearchRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const c = targetCol + dx;
          const row = targetRow + dy;
          if (this.inBounds(c, row) && this.grid[row * this.cols + c] === 0) {
            const distSq = dx * dx + dy * dy;
            if (distSq < nearestDistSq) {
              nearestDistSq = distSq;
              nearest = { col: c, row };
            }
          }
        }
      }
      if (nearest) return nearest;
    }
    return null;
  }

  /**
   * Asynchronous multi-threaded A* pathfinding via ArcJobSystem.
   * Runs the path search in background worker threads without stalling the main UI loop.
   * @param {Point2D} start
   * @param {Point2D} goal
   * @param {number} [maxIterations=1200]
   * @returns {Promise<Point2D[]>}
   */
  async findPathAsync(start, goal, maxIterations = 1200) {
    if (typeof ShooterRules !== 'undefined' && ShooterRules.hasLineOfSight(start, goal, this.blockers, 14)) {
      return [{ x: goal.x, y: goal.y }];
    }

    if (typeof ArcJobSystem !== 'undefined') {
      try {
        const res = await ArcJobSystem.dispatch('BATCH_PATHFIND', {
          queries: [{ id: 1, startX: start.x, startY: start.y, endX: goal.x, endY: goal.y }],
          grid: this.grid,
          width: this.cols,
          height: this.rows,
          cols: this.cols,
          rows: this.rows,
          cellSize: this.cellSize,
          blockers: this.blockers,
          maxIterations
        });
        if (Array.isArray(res) && res[0]?.path) {
          return res[0].path;
        }
      } catch (err) {
        console.warn('[NavGrid] ArcJobSystem pathfinding failed, falling back to sync:', err);
      }
    }

    return this.findPath(start, goal, maxIterations);
  }

  /**
   * A* pathfinding from start to goal in world coordinates.
   * @param {Point2D} start
   * @param {Point2D} goal
   * @param {number} [maxIterations=1200]
   * @returns {Point2D[]} Array of waypoints from start to goal
   */
  findPath(start, goal, maxIterations = 1200) {
    // If direct line of sight exists, no search needed
    if (typeof ShooterRules !== 'undefined' && ShooterRules.hasLineOfSight(start, goal, this.blockers, 14)) {
      return [{ x: goal.x, y: goal.y }];
    }

    const startCell = this.findNearestWalkableCell(start.x, start.y);
    const goalCell = this.findNearestWalkableCell(goal.x, goal.y);
    if (!startCell || !goalCell) return [{ x: goal.x, y: goal.y }];

    if (startCell.col === goalCell.col && startCell.row === goalCell.row) {
      return [{ x: goal.x, y: goal.y }];
    }

    const startIndex = startCell.row * this.cols + startCell.col;
    const goalIndex = goalCell.row * this.cols + goalCell.col;

    // Open set: min-heap or priority array
    const gScore = new Float32Array(this.cols * this.rows).fill(Infinity);
    const fScore = new Float32Array(this.cols * this.rows).fill(Infinity);
    const parent = new Int32Array(this.cols * this.rows).fill(-1);
    const inOpen = new Uint8Array(this.cols * this.rows);
    const closed = new Uint8Array(this.cols * this.rows);

    gScore[startIndex] = 0;
    const initialH = Math.hypot(goalCell.col - startCell.col, goalCell.row - startCell.row);
    fScore[startIndex] = initialH;

    const openList = [startIndex];
    inOpen[startIndex] = 1;

    let iterations = 0;
    let closestIndex = startIndex;
    let closestH = initialH;

    const DIRS = [
      [1, 0, 1.0], [-1, 0, 1.0], [0, 1, 1.0], [0, -1, 1.0],
      [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]
    ];

    while (openList.length > 0 && iterations++ < maxIterations) {
      // Find lowest fScore in open list
      let lowestIdx = 0;
      let lowestF = fScore[openList[0]];
      for (let i = 1; i < openList.length; i++) {
        const f = fScore[openList[i]];
        if (f < lowestF) {
          lowestF = f;
          lowestIdx = i;
        }
      }

      const current = openList[lowestIdx];
      if (current === goalIndex) {
        closestIndex = current;
        break;
      }

      // Remove current from openList
      openList[lowestIdx] = openList[openList.length - 1];
      openList.pop();
      inOpen[current] = 0;
      closed[current] = 1;

      const currCol = current % this.cols;
      const currRow = Math.floor(current / this.cols);

      // Track closest point reached in case search is exhausted
      const currentH = Math.hypot(goalCell.col - currCol, goalCell.row - currRow);
      if (currentH < closestH) {
        closestH = currentH;
        closestIndex = current;
      }

      for (let d = 0; d < 8; d++) {
        const [dx, dy, cost] = DIRS[d];
        const ncol = currCol + dx;
        const nrow = currRow + dy;
        if (!this.inBounds(ncol, nrow)) continue;

        const nIndex = nrow * this.cols + ncol;
        if (closed[nIndex] || this.grid[nIndex] === 1) continue;

        // Diagonal clearance check (prevent corner cutting through walls)
        if (dx !== 0 && dy !== 0) {
          if (this.grid[currRow * this.cols + ncol] === 1 || this.grid[nrow * this.cols + currCol] === 1) {
            continue;
          }
        }

        const tentativeG = gScore[current] + cost;
        if (tentativeG < gScore[nIndex]) {
          parent[nIndex] = current;
          gScore[nIndex] = tentativeG;
          const h = Math.hypot(goalCell.col - ncol, goalCell.row - nrow);
          fScore[nIndex] = tentativeG + h * 1.05; // slight tie-breaker

          if (!inOpen[nIndex]) {
            openList.push(nIndex);
            inOpen[nIndex] = 1;
          }
        }
      }
    }

    // Reconstruct raw path from closestIndex
    const rawPath = [];
    let curr = closestIndex;
    while (curr !== -1) {
      const col = curr % this.cols;
      const row = Math.floor(curr / this.cols);
      rawPath.push(this.gridToWorld(col, row));
      curr = parent[curr];
    }
    rawPath.reverse();

    // Append exact target endpoint
    if (rawPath.length > 0) {
      rawPath[rawPath.length - 1] = { x: goal.x, y: goal.y };
    } else {
      rawPath.push({ x: goal.x, y: goal.y });
    }

    // Smooth path using line of sight
    return this.smoothPath(rawPath);
  }

  /**
   * Smooth waypoints using raycast line-of-sight pruning.
   * @param {Point2D[]} waypoints
   * @returns {Point2D[]}
   */
  smoothPath(waypoints) {
    if (waypoints.length <= 2) return waypoints;
    if (typeof ShooterRules === 'undefined' || !ShooterRules.hasLineOfSight) return waypoints;

    const smoothed = [waypoints[0]];
    let currentIdx = 0;

    while (currentIdx < waypoints.length - 1) {
      let nextIdx = waypoints.length - 1;
      let foundLOS = false;

      while (nextIdx > currentIdx + 1) {
        if (ShooterRules.hasLineOfSight(waypoints[currentIdx], waypoints[nextIdx], this.blockers, 14)) {
          smoothed.push(waypoints[nextIdx]);
          currentIdx = nextIdx;
          foundLOS = true;
          break;
        }
        nextIdx--;
      }

      if (!foundLOS) {
        currentIdx++;
        smoothed.push(waypoints[currentIdx]);
      }
    }

    return smoothed;
  }
}

if (typeof module !== 'undefined') module.exports = NavGrid;
if (typeof window !== 'undefined') window.NavGrid = NavGrid;
if (typeof globalThis !== 'undefined') globalThis.NavGrid = NavGrid;
