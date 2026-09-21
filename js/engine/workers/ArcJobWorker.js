// ============================================================================
//  ArcEngine — ArcJobWorker (Universal Multi-Threaded Task Worker)
// ----------------------------------------------------------------------------
//  Executes heavy CPU computations (terrain generation, batch raycasting,
//  pathfinding, and physics) off the main thread. Supports zero-copy
//  memory transfer via Transferable ArrayBuffers.
// ============================================================================

(function() {
    'use strict';

    // --- Deterministic PRNG (Alea) & 2D Simplex Noise --------------------------
    // THIS IS THE ONLY SOURCE OF TRUTH for procedural noise in the engine, for the worker
    // AND for the main thread (Terrain3D uses `ArcJobWorker` noise helpers when the script
    // is present, and libs/simplex-noise.js otherwise). The permutation and alea routine
    // below deliberately mirror libs/simplex-noise.js (Jonas Wagner, MIT) EXACTLY: a
    // divergence here makes the worker generate a different world than the synchronous path,
    // which silently moves every object placed by terrain.heightAt(). Do not "optimise" the
    // loop bounds, the mash() call order or the RNG without keeping
    // tests/multithreading.test.mjs parity green.
    function masher() {
        let n = 0xefc8249d;
        return function(data) {
            data = String(data);
            for (let i = 0; i < data.length; i++) {
                n += data.charCodeAt(i);
                let h = 0.02519603282416938 * n;
                n = h >>> 0;
                h -= n;
                h *= n;
                n = h >>> 0;
                h -= n;
                n += h * 0x100000000;
            }
            return (n >>> 0) * 2.3283064365386963e-10;
        };
    }

    // alea(...args): one masher for the whole seeding, exactly as the library does it.
    function alea(...args) {
        let s0 = 0, s1 = 0, s2 = 0, c = 1;
        const mash = masher();
        s0 = mash(' '); s1 = mash(' '); s2 = mash(' ');
        for (let i = 0; i < args.length; i++) {
            s0 -= mash(args[i]); if (s0 < 0) s0 += 1;
            s1 -= mash(args[i]); if (s1 < 0) s1 += 1;
            s2 -= mash(args[i]); if (s2 < 0) s2 += 1;
        }
        return function() {
            const t = 2091639 * s0 + c * 2.3283064365386963e-10;
            s0 = s1; s1 = s2;
            return s2 = t - (c = t | 0);
        };
    }

    // Fisher-Yates over 256 entries, 0..254, i + ~~(random() * (256 - i)) — the library's
    // exact shuffle. 255..1 or a different pivot produces a different permutation.
    function buildPermutationTable(random) {
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 0; i < 255; i++) {
            const r = i + ~~(random() * (256 - i));
            const aux = p[i];
            p[i] = p[r];
            p[r] = aux;
        }
        return p;
    }

    // Mirrors SimplexNoise(randomOrSeed): a function is used as-is, any truthy seed goes
    // through alea, anything falsy falls back to Math.random. A numeric seed and its string
    // form are equivalent because mash() stringifies.
    function noiseRandom(seed) {
        if (typeof seed === 'function') return seed;
        if (seed) return alea(seed);
        return Math.random;
    }

    const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

    class Simplex2D {
        constructor(seed) {
            const random = noiseRandom(seed);
            this.p = buildPermutationTable(random);
            this.perm = new Uint8Array(512);
            this.permMod12 = new Uint8Array(512);
            for (let i = 0; i < 512; i++) {
                this.perm[i] = this.p[i & 255];
                this.permMod12[i] = this.perm[i] % 12;
            }
            this.grad3 = new Float32Array([
                1, 1, 0,  -1, 1, 0,   1,-1, 0,  -1,-1, 0,
                1, 0, 1,  -1, 0, 1,   1, 0,-1,  -1, 0,-1,
                0, 1, 1,   0,-1, 1,   0, 1,-1,   0,-1,-1
            ]);
        }

        noise2D(xin, yin) {
            const permMod12 = this.permMod12;
            const perm = this.perm;
            const grad3 = this.grad3;
            let n0 = 0, n1 = 0, n2 = 0;
            const s = (xin + yin) * F2;
            const i = Math.floor(xin + s);
            const j = Math.floor(yin + s);
            const t = (i + j) * G2;
            const X0 = i - t;
            const Y0 = j - t;
            const x0 = xin - X0;
            const y0 = yin - Y0;

            let i1, j1;
            if (x0 > y0) { i1 = 1; j1 = 0; }
            else { i1 = 0; j1 = 1; }

            const x1 = x0 - i1 + G2;
            const y1 = y0 - j1 + G2;
            const x2 = x0 - 1.0 + 2.0 * G2;
            const y2 = y0 - 1.0 + 2.0 * G2;

            const ii = i & 255;
            const jj = j & 255;

            let t0 = 0.5 - x0 * x0 - y0 * y0;
            if (t0 >= 0) {
                const gi0 = permMod12[ii + perm[jj]] * 3;
                t0 *= t0;
                n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0);
            }

            let t1 = 0.5 - x1 * x1 - y1 * y1;
            if (t1 >= 0) {
                const gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
                t1 *= t1;
                n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1);
            }

            let t2 = 0.5 - x2 * x2 - y2 * y2;
            if (t2 >= 0) {
                const gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;
                t2 *= t2;
                n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2);
            }

            return 70.0 * (n0 + n1 + n2);
        }
    }

    // --- Task Handlers ---------------------------------------------------------

    /**
     * Generates a slice or full grid of procedural terrain heights.
     */
    function handleTerrainGen(payload) {
        const { nx, ny, cell, seed, amp, scale, base, startRow = 0, endRow = ny } = payload;
        const simplex = new Simplex2D(seed != null ? seed : 5);
        const rowCount = endRow - startRow;
        const count = nx * rowCount;
        const heights = new Float32Array(count);

        let lo = Infinity, hi = -Infinity;
        let idx = 0;
        const s = Math.max(40, scale || 800);
        const a = amp != null ? amp : 28;
        const b = base != null ? base : 0;

        for (let j = startRow; j < endRow; j++) {
            const y = j * cell;
            for (let i = 0; i < nx; i++) {
                const x = i * cell;
                let h = b;
                if (a > 0) {
                    const n = simplex.noise2D(x / s, y / s) * 0.72 +
                              simplex.noise2D(x / s * 2.3 + 17.1, y / s * 2.3 - 9.7) * 0.28;
                    h += n * a;
                }
                heights[idx++] = h;
                if (h < lo) lo = h;
                if (h > hi) hi = h;
            }
        }

        return {
            result: { heights, startRow, endRow, nx, ny, lo, hi },
            transferables: [heights.buffer]
        };
    }

    /**
     * Intersection between segment and circle
     */
    function segmentCircleHit(start, end, circle, padding = 0) {
        const radius = Math.max(0, (circle.radius || 0) + padding);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const ox = start.x - circle.x;
        const oy = start.y - circle.y;
        const a = dx * dx + dy * dy;
        const c = ox * ox + oy * oy - radius * radius;

        if (c <= -1e-9) {
            const len = Math.sqrt(ox * ox + oy * oy) || 1;
            return { t: 0, x: start.x, y: start.y, normalX: ox / len, normalY: oy / len };
        }
        if (a <= 1e-9) return null;

        const b = ox * dx + oy * dy;
        if (Math.abs(c) <= 1e-9 && b >= -1e-9) return null;
        const discriminant = b * b - a * c;
        if (discriminant < -1e-9) return null;
        const t = (-b - Math.sqrt(Math.max(0, discriminant))) / a;
        if (t < -1e-9 || t > 1 + 1e-9) return null;

        const hitT = Math.max(0, Math.min(1, t));
        const x = start.x + dx * hitT;
        const y = start.y + dy * hitT;
        const nx = x - circle.x;
        const ny = y - circle.y;
        const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
        return { t: hitT, x, y, normalX: nx / nlen, normalY: ny / nlen };
    }

    /**
     * Batch Raycast & Line-of-Sight verification against blockers.
     */
    function handleBatchRaycast(payload) {
        const { rays, blockers, padding = 0 } = payload;
        const count = rays.length;
        const results = new Array(count);

        for (let r = 0; r < count; r++) {
            const ray = rays[r];
            const start = { x: ray.startX, y: ray.startY };
            const end = { x: ray.endX, y: ray.endY };
            const rayPad = ray.padding != null ? ray.padding : padding;

            let nearest = null;
            for (let b = 0; b < blockers.length; b++) {
                const hit = segmentCircleHit(start, end, blockers[b], rayPad);
                if (hit && (!nearest || hit.t < nearest.t - 1e-9)) {
                    nearest = { ...hit, blockerIndex: b };
                }
            }

            results[r] = {
                id: ray.id,
                hasLoS: !nearest,
                hit: nearest
            };
        }

        return { result: results, transferables: [] };
    }

    /**
     * A* Pathfinding on a discrete 2D grid with diagonal support, obstacle clearance, and smoothing.
     */
    function handleBatchPathfind(payload) {
        const { queries, grid, width, height, cols = width, rows = height, cellSize, blockers = [], maxIterations = 1200 } = payload;
        const results = [];
        const isWorld = typeof cellSize === 'number' && cellSize > 0;

        for (const q of queries) {
            let sx, sy, ex, ey;
            let goalWorld = null;

            if (isWorld) {
                const startPt = { x: q.startX, y: q.startY };
                const endPt = { x: q.endX, y: q.endY };
                goalWorld = endPt;

                let directBlocked = false;
                for (let b = 0; b < blockers.length; b++) {
                    if (segmentCircleHit(startPt, endPt, blockers[b], 14)) {
                        directBlocked = true;
                        break;
                    }
                }
                if (!directBlocked) {
                    results.push({ id: q.id, path: [{ x: q.endX, y: q.endY }], found: true });
                    continue;
                }

                sx = Math.max(0, Math.min(cols - 1, Math.floor(q.startX / cellSize)));
                sy = Math.max(0, Math.min(rows - 1, Math.floor(q.startY / cellSize)));
                ex = Math.max(0, Math.min(cols - 1, Math.floor(q.endX / cellSize)));
                ey = Math.max(0, Math.min(rows - 1, Math.floor(q.endY / cellSize)));
            } else {
                sx = Math.max(0, Math.min(cols - 1, Math.round(q.startX)));
                sy = Math.max(0, Math.min(rows - 1, Math.round(q.startY)));
                ex = Math.max(0, Math.min(cols - 1, Math.round(q.endX)));
                ey = Math.max(0, Math.min(rows - 1, Math.round(q.endY)));
            }

            if (sx === ex && sy === ey) {
                const pt = goalWorld || { x: ex, y: ey };
                results.push({ id: q.id, path: [pt], found: true });
                continue;
            }

            const totalCells = cols * rows;
            const startIndex = sy * cols + sx;
            const goalIndex = ey * cols + ex;

            const gScore = new Float32Array(totalCells).fill(Infinity);
            const fScore = new Float32Array(totalCells).fill(Infinity);
            const parent = new Int32Array(totalCells).fill(-1);
            const inOpen = new Uint8Array(totalCells);
            const closed = new Uint8Array(totalCells);

            gScore[startIndex] = 0;
            const initialH = Math.hypot(ex - sx, ey - sy);
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

                openList[lowestIdx] = openList[openList.length - 1];
                openList.pop();
                inOpen[current] = 0;
                closed[current] = 1;

                const currCol = current % cols;
                const currRow = Math.floor(current / cols);

                const currentH = Math.hypot(ex - currCol, ey - currRow);
                if (currentH < closestH) {
                    closestH = currentH;
                    closestIndex = current;
                }

                for (let d = 0; d < 8; d++) {
                    const [dx, dy, cost] = DIRS[d];
                    const ncol = currCol + dx;
                    const nrow = currRow + dy;
                    if (ncol < 0 || ncol >= cols || nrow < 0 || nrow >= rows) continue;

                    const nIndex = nrow * cols + ncol;
                    if (closed[nIndex] || (grid && grid[nIndex] > 0)) continue;

                    if (dx !== 0 && dy !== 0 && grid) {
                        if (grid[currRow * cols + ncol] > 0 || grid[nrow * cols + currCol] > 0) {
                            continue;
                        }
                    }

                    const tentativeG = gScore[current] + cost;
                    if (tentativeG < gScore[nIndex]) {
                        parent[nIndex] = current;
                        gScore[nIndex] = tentativeG;
                        const h = Math.hypot(ex - ncol, ey - nrow);
                        fScore[nIndex] = tentativeG + h * 1.05;

                        if (!inOpen[nIndex]) {
                            openList.push(nIndex);
                            inOpen[nIndex] = 1;
                        }
                    }
                }
            }

            const rawPath = [];
            let curr = closestIndex;
            while (curr !== -1) {
                const col = curr % cols;
                const row = Math.floor(curr / cols);
                if (isWorld) {
                    rawPath.push({ x: (col + 0.5) * cellSize, y: (row + 0.5) * cellSize });
                } else {
                    rawPath.push({ x: col, y: row });
                }
                curr = parent[curr];
            }
            rawPath.reverse();

            if (isWorld && goalWorld) {
                if (rawPath.length > 0) {
                    rawPath[rawPath.length - 1] = { x: goalWorld.x, y: goalWorld.y };
                } else {
                    rawPath.push({ x: goalWorld.x, y: goalWorld.y });
                }
            }

            let finalPath = rawPath;
            if (isWorld && rawPath.length > 2 && blockers.length > 0) {
                const smoothed = [rawPath[0]];
                let currentIdx = 0;
                while (currentIdx < rawPath.length - 1) {
                    let furthestIdx = currentIdx + 1;
                    for (let testIdx = rawPath.length - 1; testIdx > currentIdx + 1; testIdx--) {
                        let hitAny = false;
                        for (let b = 0; b < blockers.length; b++) {
                            if (segmentCircleHit(rawPath[currentIdx], rawPath[testIdx], blockers[b], 14)) {
                                hitAny = true;
                                break;
                            }
                        }
                        if (!hitAny) {
                            furthestIdx = testIdx;
                            break;
                        }
                    }
                    smoothed.push(rawPath[furthestIdx]);
                    currentIdx = furthestIdx;
                }
                finalPath = smoothed;
            }

            results.push({ id: q.id, path: finalPath, found: closestIndex === goalIndex });
        }

        return { result: results, transferables: [] };
    }

    /**
     * Batch ballistic physics step for projectiles.
     */
    function handleBatchPhysics(payload) {
        // Flat array of particles: [x, y, vx, vy, life, ...]
        const { buffer, count, dt, stride = 5 } = payload;
        const data = new Float32Array(buffer);

        for (let i = 0; i < count; i++) {
            const base = i * stride;
            if (data[base + 4] > 0) { // life > 0
                data[base] += data[base + 2] * dt;     // x += vx * dt
                data[base + 1] += data[base + 3] * dt; // y += vy * dt
                data[base + 4] -= dt;                 // life -= dt
            }
        }

        return {
            result: { count, buffer: data.buffer },
            transferables: [data.buffer]
        };
    }

    /**
     * Resamples heightmap data to nx*ny grid with optional noise blending.
     */
    function handleHeightmapResample(payload) {
        const {
            data: srcBuffer,
            srcWidth,
            srcHeight,
            nx,
            ny,
            min = -50,
            max = 300,
            normalized = true,
            blend = 0,
            seed = 5,
            amp = 28,
            scale = 800,
            base = 0,
            cell = 8
        } = payload;

        const srcData = srcBuffer instanceof Float32Array ? srcBuffer : new Float32Array(srcBuffer);
        const count = nx * ny;
        const heights = new Float32Array(count);
        let lo = Infinity, hi = -Infinity;

        let simplex = null;
        if (blend > 0 && amp > 0) {
            simplex = new Simplex2D(seed);
        }

        const s = Math.max(40, scale || 800);
        let idx = 0;

        for (let j = 0; j < ny; j++) {
            const y = j / (ny - 1) * (srcHeight - 1);
            const b = Math.floor(y);
            const d = Math.min(srcHeight - 1, b + 1);
            const v = y - b;
            const worldY = j * cell;

            for (let i = 0; i < nx; i++) {
                const x = i / (nx - 1) * (srcWidth - 1);
                const a = Math.floor(x);
                const c = Math.min(srcWidth - 1, a + 1);
                const u = x - a;

                let h = (srcData[b * srcWidth + a] * (1 - u) + srcData[b * srcWidth + c] * u) * (1 - v) +
                        (srcData[d * srcWidth + a] * (1 - u) + srcData[d * srcWidth + c] * u) * v;

                if (normalized) h = min + h * (max - min);

                if (simplex && blend > 0) {
                    const worldX = i * cell;
                    const n = simplex.noise2D(worldX / s, worldY / s) * 0.72 +
                              simplex.noise2D(worldX / s * 2.3 + 17.1, worldY / s * 2.3 - 9.7) * 0.28;
                    h = h * (1 - blend) + (base + n * amp) * blend;
                }

                heights[idx++] = h;
                if (h < lo) lo = h;
                if (h > hi) hi = h;
            }
        }

        return {
            result: { heights, nx, ny, lo, hi },
            transferables: [heights.buffer]
        };
    }

    /**
     * Fast multi-threaded normal computation for triangle meshes / terrain grids.
     *
     * NORMAL CONVENTION: this MUST match BABYLON.VertexData.ComputeNormals, because the
     * terrain winding is chosen for Babylon (Terrain3D._buildGeometry flips `swap` until
     * normals[1] > 0) and the toon shader darkens any surface with dot(normal, light) <= 0.
     * Babylon uses the face normal (p1 - p2) x (p3 - p2); for a triangle (a, b, c) that is
     * (a - b) x (c - b), which is the NEGATIVE of the naive (b - a) x (c - a). Passing the
     * naive form to the mesh flipped every terrain normal downward and unlit the ground.
     * The parity is asserted against real Babylon in tests/multithreading.test.mjs.
     */
    function handleComputeNormals(payload) {
        const { positions: posData, indices: indData } = payload;
        const positions = posData instanceof Float32Array ? posData : new Float32Array(posData);
        const indices = (indData instanceof Int32Array || indData instanceof Uint32Array) ? indData : new Int32Array(indData);

        const vertexCount = Math.floor(positions.length / 3);
        const normals = new Float32Array(positions.length);

        const triCount = Math.floor(indices.length / 3);
        for (let t = 0; t < triCount; t++) {
            const i0 = indices[t * 3] * 3;
            const i1 = indices[t * 3 + 1] * 3;
            const i2 = indices[t * 3 + 2] * 3;

            const p0x = positions[i0], p0y = positions[i0 + 1], p0z = positions[i0 + 2];
            const p1x = positions[i1], p1y = positions[i1 + 1], p1z = positions[i1 + 2];
            const p2x = positions[i2], p2y = positions[i2 + 1], p2z = positions[i2 + 2];

            // Scalene-ish form of (p1 - p2) x (p3 - p2), i.e. (v0 - v1) x (v2 - v1).
            const e1x = p0x - p1x, e1y = p0y - p1y, e1z = p0z - p1z;
            const e2x = p2x - p1x, e2y = p2y - p1y, e2z = p2z - p1z;

            let nx = e1y * e2z - e1z * e2y;
            let ny = e1z * e2x - e1x * e2z;
            let nz = e1x * e2y - e1y * e2x;
            const faceLength = Math.hypot(nx, ny, nz) || 1;
            nx /= faceLength; ny /= faceLength; nz /= faceLength;

            normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
            normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
            normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
        }

        for (let v = 0; v < vertexCount; v++) {
            const idx = v * 3;
            const nx = normals[idx], ny = normals[idx + 1], nz = normals[idx + 2];
            const len = Math.hypot(nx, ny, nz);
            if (len > 0) {
                const inv = 1.0 / len;
                normals[idx] = nx * inv;
                normals[idx + 1] = ny * inv;
                normals[idx + 2] = nz * inv;
            }
        }

        return {
            result: { normals },
            transferables: [normals.buffer]
        };
    }

    /**
     * Rasterizes blockers into a discrete navigation byte grid.
     */
    function handleNavgridRasterize(payload) {
        const { cols, rows, cellSize, blockers = [], padding = 14 } = payload;
        const grid = new Uint8Array(cols * rows);

        for (const b of blockers) {
            const r = (b.radius || 24) + padding;
            const minCol = Math.max(0, Math.floor((b.x - r) / cellSize));
            const maxCol = Math.min(cols - 1, Math.floor((b.x + r) / cellSize));
            const minRow = Math.max(0, Math.floor((b.y - r) / cellSize));
            const maxRow = Math.min(rows - 1, Math.floor((b.y + r) / cellSize));
            const rSq = r * r;

            for (let row = minRow; row <= maxRow; row++) {
                const cy = (row + 0.5) * cellSize;
                const rowOffset = row * cols;
                for (let col = minCol; col <= maxCol; col++) {
                    const cx = (col + 0.5) * cellSize;
                    const dx = cx - b.x;
                    const dy = cy - b.y;
                    if (dx * dx + dy * dy <= rSq) {
                        grid[rowOffset + col] = 1;
                    }
                }
            }
        }

        return {
            result: { grid, cols, rows },
            transferables: [grid.buffer]
        };
    }

    /**
     * Generates transforms and performs blocker culling for thousands of foliage instances.
     */
    function handleFoliageScatter(payload) {
        const {
            count = 500,
            seed = 2468,
            bounds = { minX: 80, maxX: 4010, minY: 120, maxY: 3970 },
            blockers = [],
            clearanceDist = 124,
            padding = 15,
            scaleRange = [9, 24],
            meshHeight = 1.0,
            heightmap = null,
            baseHeight = 0
        } = payload;

        const random = alea(seed);
        const matrices = [];

        const minX = bounds.minX, rangeX = bounds.maxX - minX;
        const minY = bounds.minY, rangeY = bounds.maxY - minY;
        const minScale = scaleRange[0], scaleDelta = scaleRange[1] - minScale;
        const hData = heightmap?.data ? (heightmap.data instanceof Float32Array ? heightmap.data : new Float32Array(heightmap.data)) : null;
        const hNx = heightmap?.nx || 0, hNy = heightmap?.ny || 0, hCell = heightmap?.cell || 8;

        function sampleH(x, z) {
            if (!hData || hNx < 2 || hNy < 2) return baseHeight;
            const fx = Math.max(0, Math.min(hNx - 1, x / hCell));
            const fy = Math.max(0, Math.min(hNy - 1, z / hCell));
            const i = Math.min(hNx - 2, Math.floor(fx)), j = Math.min(hNy - 2, Math.floor(fy));
            const tx = fx - i, ty = fy - j;
            const h00 = hData[j * hNx + i], h10 = hData[j * hNx + i + 1];
            const h01 = hData[(j + 1) * hNx + i], h11 = hData[(j + 1) * hNx + i + 1];
            return tx >= ty ? h00 + (h10 - h00) * tx + (h11 - h10) * ty
                : h00 + (h01 - h00) * ty + (h11 - h01) * tx;
        }

        for (let i = 0; i < count; i++) {
            const x = minX + random() * rangeX;
            const z = minY + random() * rangeY;

            if (clearanceDist > 0 && Math.abs(x - 280) < clearanceDist) continue;

            let blocked = false;
            for (let b = 0; b < blockers.length; b++) {
                const blk = blockers[b];
                const r = (blk.radius || 24) + padding;
                const dx = blk.x - x, dy = blk.y - z;
                if (dx * dx + dy * dy < r * r) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;

            const rawScale = minScale + random() * scaleDelta;
            const scale = rawScale / (meshHeight || 1.0);
            const rotY = random() * Math.PI * 2;
            const y = sampleH(x, z);

            const cos = Math.cos(rotY), sin = Math.sin(rotY);
            matrices.push(
                cos * scale, 0, -sin * scale, 0,
                0, scale, 0, 0,
                sin * scale, 0, cos * scale, 0,
                x, y, z, 1
            );
        }

        const buffer = new Float32Array(matrices);
        return {
            result: { buffer, instanceCount: matrices.length / 16 },
            transferables: [buffer.buffer]
        };
    }

    /**
     * Asynchronously serializes level data off the main thread.
     */
    function handleLevelSerialize(payload) {
        const { levelData } = payload;
        const json = JSON.stringify(levelData, null, 2);
        return {
            result: { json, size: json.length },
            transferables: []
        };
    }

    // --- Message Dispatcher ----------------------------------------------------

    const HANDLERS = {
        TERRAIN_GEN: handleTerrainGen,
        BATCH_RAYCAST: handleBatchRaycast,
        BATCH_PATHFIND: handleBatchPathfind,
        BATCH_PHYSICS: handleBatchPhysics,
        HEIGHTMAP_RESAMPLE: handleHeightmapResample,
        COMPUTE_NORMALS: handleComputeNormals,
        NAVGRID_RASTERIZE: handleNavgridRasterize,
        FOLIAGE_SCATTER: handleFoliageScatter,
        LEVEL_SERIALIZE: handleLevelSerialize
    };

    if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
        self.onmessage = function(e) {
            const { id, type, payload } = e.data || {};
            const handler = HANDLERS[type];
            if (!handler) {
                self.postMessage({ id, type, error: `Unknown task type: ${type}` });
                return;
            }

            try {
                const { result, transferables } = handler(payload);
                self.postMessage({ id, type, result }, transferables || []);
            } catch (err) {
                self.postMessage({ id, type, error: err?.message || String(err) });
            }
        };
    }

    // Export handlers and the noise helpers. The noise helpers are exported on purpose:
    // the main thread (Terrain3D) uses Simplex2D here so the terrain grid, the outer ring
    // and the worker all sample ONE implementation and cannot drift apart.
    const ArcJobWorker = {
        HANDLERS,
        Simplex2D,
        alea,
        buildPermutationTable,
        noiseRandom,
        handleTerrainGen,
        handleBatchRaycast,
        handleBatchPathfind,
        handleBatchPhysics,
        handleHeightmapResample,
        handleComputeNormals,
        handleNavgridRasterize,
        handleFoliageScatter,
        handleLevelSerialize
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ArcJobWorker;
    }
    if (typeof globalThis !== 'undefined') {
        /** @type {any} */ (globalThis).ArcJobWorker = ArcJobWorker;
    }
})();
