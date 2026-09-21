// Terrain3D.js — the location's ground: a height field from noise, one grid over the rectangle
// [0..W]×[0..H] and a coarse ground ring beyond the edge (otherwise, at a low camera angle,
// the sky would gape beyond the edge).
//
// Height — TERRAIN_BASE + noise (SimplexNoise(TERRAIN_NOISE_SEED), two octaves,
// amplitude TERRAIN_NOISE_AMP, hill size TERRAIN_NOISE_SCALE). heightAt()
// reads THE SAME triangles the mesh draws: objects stand exactly on the
// surface. Do not replace it with bilinear interpolation — on slopes objects
// would start to sink or float.
//
// Material — a texture tile (setGroundImage), repeated every GROUND_TILE_SIZE px. The grid and
// the ring share the same UVs — (x/W, y/H), so the tile continues beyond the edge without a
// seam. The ring is tinted by WORLD3D_OUTER_TINT (less than 1 — the location boundary is visible).
//
// THE TERRAIN IS A PICTURE. Game logic does not ask 3D for height: the grid cell depends
// on the device (mobile — larger), and the computation would diverge between them.

class Terrain3D {
    // cfg: { worldW, worldH, groundImage?, cell?, noise?: { amp, scale, seed, base } }
    constructor(view, cfg) {
        const U = 'undefined';
        this.view = view;
        this.scene = view.scene;
        this.worldW = Math.max(64, cfg.worldW);
        this.worldH = Math.max(64, cfg.worldH);
        this.cell = Math.max(4, cfg.cell || (typeof TERRAIN_CELL !== U ? TERRAIN_CELL : 8));
        if (IS_MOBILE) this.cell = Math.max(this.cell, 12);
        const nz = cfg.noise || {};
        this.noiseAmp = nz.amp != null ? nz.amp : (typeof TERRAIN_NOISE_AMP !== U ? TERRAIN_NOISE_AMP : 28);
        this.noiseScale = Math.max(40, nz.scale != null ? nz.scale : (typeof TERRAIN_NOISE_SCALE !== U ? TERRAIN_NOISE_SCALE : 800));
        this.noiseBase = nz.base != null ? nz.base : (typeof TERRAIN_BASE !== U ? TERRAIN_BASE : 0);
        this.noiseSeed = nz.seed != null ? nz.seed : (typeof TERRAIN_NOISE_SEED !== U ? TERRAIN_NOISE_SEED : 5);
        // ONE noise implementation for the whole engine. The worker carries the canonical
        // Simplex2D; this main-thread copy feeds terrainNoise() (outer ring, out-of-grid
        // samples) and the synchronous fallback. Using libs/simplex-noise.js here while the
        // worker used its own copy made the worker's world differ from the drawn world by up
        // to ~47 px, and the 1 px ring offset could not hide the 6 px seam that opened up.
        // The library stays as a last-resort fallback only (no worker script on the page).
        this._noise = (typeof ArcJobWorker !== U && ArcJobWorker.Simplex2D)
            ? new ArcJobWorker.Simplex2D(this.noiseSeed)
            : ((typeof SimplexNoise !== U) ? new SimplexNoise(String(this.noiseSeed)) : null);
        // The camera pitch limit reads the ring width: the ring edge must not get into the frame.
        this.outerRing = typeof cfg.outerRing === 'number' ? cfg.outerRing : (cfg.outerRing ? Terrain3D.OUTER_RING : 0);
        this.outerRingMode = cfg.outerRingMode || (cfg.outerRing === 'mountains' ? 'mountains' : (cfg.outerRing === 'flat' ? 'flat' : 'auto'));
        this.hasHeightmap = !!cfg.heightmap;
        this._fieldRevision = 0;
        this._normalRevision = 0;
        this.meshes = [];
        this.texture = null;
        this._buildMaterials();
        this._buildField();
        this._buildGeometry();
        if (this.outerRing > 0) this._buildOuterRing();
        this.ready = cfg.heightmap
            ? this.setHeightmap(cfg.heightmap, cfg.heightmapOptions || {})
            : Promise.resolve();
        if (cfg.groundImage) this.setGroundImage(cfg.groundImage);
    }

    /**
     * Asynchronously generates the procedural height field across CPU worker threads.
     * @returns {Promise<void>}
     */
    async buildFieldAsync() {
        const revision = (this._fieldRevision = (this._fieldRevision || 0) + 1);
        const cs = this.cell;
        this.nx = Math.ceil(this.worldW / cs) + 1;
        this.ny = Math.ceil(this.worldH / cs) + 1;

        if (typeof ArcJobSystem !== 'undefined') {
            try {
                const res = await ArcJobSystem.dispatch('TERRAIN_GEN', {
                    nx: this.nx,
                    ny: this.ny,
                    cell: cs,
                    seed: this.noiseSeed,
                    amp: this.noiseAmp,
                    scale: this.noiseScale,
                    base: this.noiseBase,
                    startRow: 0,
                    endRow: this.ny
                });
                if (revision !== this._fieldRevision || !this.mesh) return;
                if (res && res.heights) {
                    this.hgrid = res.heights;
                    this.hMin = res.lo;
                    this.hMax = res.hi;
                    return;
                }
            } catch (err) {
                console.warn('[Terrain3D] ArcJobSystem terrain generation failed, falling back to sync:', err);
            }
        }
        if (revision === this._fieldRevision && this.mesh) this._buildField();
    }

    // Typed arrays contain absolute world heights; images contain normalized luminance.
    async setHeightmap(source, options = {}) {
        const revision = (this._fieldRevision = (this._fieldRevision || 0) + 1);
        const min = options.minHeight ?? -50, max = options.maxHeight ?? 300;
        const blend = Math.max(0, Math.min(1, options.blendNoise ?? 0));
        let data, width, height, normalized = false;
        if (ArrayBuffer.isView(source) || Array.isArray(source)) {
            data = source; width = options.width || this.nx; height = options.height || this.ny;
        } else {
            let img = source;
            if (typeof source === 'string' || source instanceof Blob) {
                const blob = typeof source === 'string' ? await fetch(source).then(r => { if (!r.ok) throw new Error('Heightmap: ' + r.status); return r.blob(); }) : source;
                const png = await Terrain3D.readGray16(await blob.arrayBuffer());
                if (png) { ({ data, width, height } = png); normalized = true; }
                else img = await createImageBitmap(blob);
            }
            if (!data) {
                width = img.width; height = img.height;
                const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
                const rgba = ctx.getImageData(0, 0, width, height).data;
                data = new Float32Array(width * height);
                for (let i = 0; i < data.length; i++) data[i] = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 765;
                normalized = true;
                if (img.close) img.close();
            }
        }
        if (!width || !height || data.length !== width * height || !Array.from(data).every(Number.isFinite)) throw new Error('Invalid heightmap dimensions or samples');
        if (revision !== this._fieldRevision || !this.mesh || this.mesh.isDisposed()) return;
        if (typeof ArcJobSystem !== 'undefined') {
            try {
                const srcData = new Float32Array(data);
                const transferList = [srcData.buffer];
                const res = await ArcJobSystem.dispatch('HEIGHTMAP_RESAMPLE', {
                    data: srcData,
                    srcWidth: width,
                    srcHeight: height,
                    nx: this.nx,
                    ny: this.ny,
                    min,
                    max,
                    normalized,
                    blend,
                    seed: this.noiseSeed,
                    amp: this.noiseAmp,
                    scale: this.noiseScale,
                    base: this.noiseBase,
                    cell: this.cell
                }, transferList);
                if (revision !== this._fieldRevision || !this.mesh) return;
                if (res && res.heights) {
                    this.hgrid = res.heights;
                    this.hMin = res.lo;
                    this.hMax = res.hi;
                    this.hasHeightmap = true;
                    await this.updateHeights();
                    return;
                }
            } catch (err) {
                console.warn('[Terrain3D] ArcJobSystem heightmap resample fallback:', err);
            }
        }
        if (revision !== this._fieldRevision || !this.mesh) return;
        for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
            const x = i / (this.nx - 1) * (width - 1), y = j / (this.ny - 1) * (height - 1);
            const a = Math.floor(x), b = Math.floor(y), c = Math.min(width - 1, a + 1), d = Math.min(height - 1, b + 1);
            const u = x - a, v = y - b;
            let h = (data[b * width + a] * (1 - u) + data[b * width + c] * u) * (1 - v) + (data[d * width + a] * (1 - u) + data[d * width + c] * u) * v;
            if (normalized) h = min + h * (max - min);
            this.hgrid[j * this.nx + i] = h * (1 - blend) + this.terrainNoise(i * this.cell, j * this.cell) * blend;
        }
        this.hasHeightmap = true;
        await this.updateHeights();
    }

    // PNG's 16-bit grayscale samples must not pass through an 8-bit Canvas.
    static async readGray16(buffer) {
        const bytes = new Uint8Array(buffer), view = new DataView(buffer);
        if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47) return null;
        const width = view.getUint32(16), height = view.getUint32(20), depth = bytes[24], color = bytes[25];
        if (depth !== 16) return null;
        if (color !== 0 || bytes[28] !== 0) throw new Error('16-bit PNG must be non-interlaced grayscale');
        if (width * height > 16777216) throw new Error('Heightmap too large');
        const chunks = [];
        for (let p = 8; p + 12 <= bytes.length;) {
            const n = view.getUint32(p), type = view.getUint32(p + 4);
            if (p + n + 12 > bytes.length) throw new Error('Truncated PNG');
            if (type === 0x49444154) chunks.push(bytes.slice(p + 8, p + 8 + n));
            p += n + 12;
        }
        const raw = new Uint8Array(await new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
        const stride = width * 2, decoded = new Uint8Array(stride * height);
        if (raw.length !== (stride + 1) * height) throw new Error('Invalid PNG data');
        for (let y = 0; y < height; y++) {
            const filter = raw[y * (stride + 1)];
            if (filter > 4) throw new Error('Invalid PNG filter');
            for (let x = 0; x < stride; x++) {
                const k = y * stride + x, a = x >= 2 ? decoded[k - 2] : 0, b = y ? decoded[k - stride] : 0, c = y && x >= 2 ? decoded[k - stride - 2] : 0;
                const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
                decoded[k] = raw[y * (stride + 1) + x + 1] + predictor;
            }
        }
        const data = new Float32Array(width * height);
        for (let i = 0; i < data.length; i++) data[i] = (decoded[i * 2] * 256 + decoded[i * 2 + 1]) / 65535;
        return { data, width, height };
    }

    updateHeights() {
        const revision = (this._normalRevision = (this._normalRevision || 0) + 1);
        if (!this.mesh || this.mesh.isDisposed()) return;
        const positions = this.mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        if (!positions) return;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < this.hgrid.length; i++) {
            const h = this.hgrid[i]; positions[i * 3 + 1] = h;
            lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
        this.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions, true);
        this.mesh.refreshBoundingInfo(); this.hMin = lo; this.hMax = hi;
        if (this.outer && this.outerRing > 0) this._updateOuterRing();

        if (typeof ArcJobSystem !== 'undefined' && ArcJobSystem.stats?.backend === 'workers') {
            const indices = this.mesh.getIndices();
            if (indices && indices.length > 0) {
                const posCopy = new Float32Array(positions);
                const indCopy = new Uint32Array(indices);
                return ArcJobSystem.dispatch('COMPUTE_NORMALS', {
                    positions: posCopy,
                    indices: indCopy
                }, [posCopy.buffer, indCopy.buffer]).then(res => {
                    if (revision === this._normalRevision && res && res.normals && this.mesh && !this.mesh.isDisposed()) {
                        this.mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, res.normals);
                    }
                }).catch(() => {
                    if (revision !== this._normalRevision || !this.mesh || this.mesh.isDisposed()) return;
                    const normals = new Float32Array(positions.length);
                    BABYLON.VertexData.ComputeNormals(positions, this.mesh.getIndices(), normals);
                    if (this.mesh && !this.mesh.isDisposed()) {
                        this.mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
                    }
                });
            }
        }
        const normals = new Float32Array(positions.length);
        BABYLON.VertexData.ComputeNormals(positions, this.mesh.getIndices(), normals);
        this.mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    }

    brush(x, y, { mode = 'raise', radius = 100, strength = 10, height = 0 } = {}) {
        if (!(radius > 0) || ![x, y, strength, height].every(Number.isFinite)) return;
        const old = mode === 'smooth' ? this.hgrid.slice() : this.hgrid;
        const i0 = Math.max(0, Math.floor((x - radius) / this.cell)), i1 = Math.min(this.nx - 1, Math.ceil((x + radius) / this.cell));
        const j0 = Math.max(0, Math.floor((y - radius) / this.cell)), j1 = Math.min(this.ny - 1, Math.ceil((y + radius) / this.cell));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const r = Math.hypot(i * this.cell - x, j * this.cell - y) / radius;
            if (r >= 1) continue;
            const k = j * this.nx + i, falloff = (Math.exp(-4 * r * r) - Math.exp(-4)) / (1 - Math.exp(-4));
            const amount = strength * falloff;
            if (mode === 'flatten') this.hgrid[k] += (height - old[k]) * Math.min(1, Math.abs(amount) / 10);
            else if (mode === 'smooth') {
                let sum = 0, count = 0;
                for (let b = Math.max(0, j - 1); b <= Math.min(this.ny - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(this.nx - 1, i + 1); a++) { sum += old[b * this.nx + a]; count++; }
                this.hgrid[k] += (sum / count - old[k]) * Math.min(1, Math.abs(amount) / 10);
            } else this.hgrid[k] += amount * (mode === 'lower' ? -1 : mode === 'noise' ? Math.random() * 2 - 1 : 1);
        }
        this.updateHeights();
    }

    exportHeightmap(minHeight = this.hMin, maxHeight = this.hMax) {
        const canvas = document.createElement('canvas'); canvas.width = this.nx; canvas.height = this.ny;
        const ctx = canvas.getContext('2d'), img = ctx.createImageData(this.nx, this.ny);
        const range = maxHeight - minHeight || 1;
        for (let i = 0; i < this.hgrid.length; i++) {
            const v = Math.round(Math.max(0, Math.min(1, (this.hgrid[i] - minHeight) / range)) * 255);
            img.data.set([v, v, v, 255], i * 4);
        }
        ctx.putImageData(img, 0, 0); return canvas;
    }

    // --- Material ------------------------------------------------------------------

    // Two materials on one texture: the location grid and the ring beyond the edge (the ring
    // has its own brightness). Until there is a texture — flat green.
    _buildMaterials() {
        const mat = new BABYLON.StandardMaterial('terrainMat', this.scene);
        mat.metadata = { toonGroup: 'ground' };
        mat.diffuseColor = new BABYLON.Color3(0.25, 0.4, 0.18);
        World3D.applyMaterialConstants(mat);
        this.material = mat;
        const outer = new BABYLON.StandardMaterial('terrainOuterMat', this.scene);
        outer.metadata = { toonGroup: 'ground' };
        outer.diffuseColor = new BABYLON.Color3(0.25, 0.4, 0.18);
        World3D.applyMaterialConstants(outer);
        this.outerMaterial = outer;
    }

    // Ground texture tile (Image or Canvas). DynamicTexture with invertY = false:
    // V goes down the map, like y.
    setGroundImage(img) {
        if (!img || !(img.width > 0)) return;
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const tex = new BABYLON.DynamicTexture('groundTile', c, this.scene, true,
            BABYLON.Texture.TRILINEAR_SAMPLINGMODE, BABYLON.Constants.TEXTUREFORMAT_RGBA, false);
        tex.update(false);
        tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.anisotropicFilteringLevel = IS_MOBILE ? 2 : 8;
        const old = this.texture;
        this.texture = tex;
        this.applyTileSize();
        // With a texture the material color is a multiplier: white for the grid, for the ring —
        // brightness WORLD3D_OUTER_TINT (metadata.outer is read by applyMaterialConstants).
        this.material.diffuseTexture = tex;
        this.material.diffuseColor = new BABYLON.Color3(1, 1, 1);
        this.outerMaterial.diffuseTexture = tex;
        this.outerMaterial.metadata.outer = true;
        World3D.applyMaterialConstants(this.outerMaterial);
        if (old) { try { old.dispose(); } catch (e) { /* ok */ } }
    }

    // Tile repeat — via the texture scale: u' = (x/W)·(W/tile) = x/tile.
    // GROUND_TILE_SIZE changed (editor) — only this.
    applyTileSize() {
        if (!this.texture) return;
        const tile = Math.max(16, (typeof GROUND_TILE_SIZE !== 'undefined') ? GROUND_TILE_SIZE : 512);
        this.texture.uScale = this.worldW / tile;
        this.texture.vScale = this.worldH / tile;
    }

    // --- Height field ----------------------------------------------------------------

    terrainNoise(x, y) {
        if (!this._noise || !(this.noiseAmp > 0)) return this.noiseBase;
        const s = this.noiseScale;
        const n = this._noise.noise2D(x / s, y / s) * 0.72 +
                  this._noise.noise2D(x / s * 2.3 + 17.1, y / s * 2.3 - 9.7) * 0.28;
        return this.noiseBase + n * this.noiseAmp;
    }

    // Heights at the nodes of the grid [0..W]×[0..H] with step cell. The last cell may
    // extend beyond the edge (UV there > 1 — the tile simply continues).
    _buildField() {
        const cs = this.cell;
        this.nx = Math.ceil(this.worldW / cs) + 1;
        this.ny = Math.ceil(this.worldH / cs) + 1;
        const nx = this.nx, ny = this.ny;
        const H = new Float32Array(nx * ny);
        let lo = Infinity, hi = -Infinity;
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const h = this.terrainNoise(i * cs, j * cs);
                H[j * nx + i] = h;
                if (h < lo) lo = h;
                if (h > hi) hi = h;
            }
        }
        this.hgrid = H;
        // Height range — for the pointer ray (View3D.pointerToGround) and the camera limit.
        this.hMin = lo;
        this.hMax = hi;
    }

    // Surface height under a point — exactly the one that is drawn: the cell is split by
    // the diagonal (i,j)-(i+1,j+1) into triangles (00,10,11) and (00,11,01), as in the
    // mesh. Beyond the grid edge — noise, as for the ring.
    heightAt(x, y) {
        const cs = this.cell, n = this.nx;
        const fx = x / cs, fy = y / cs;
        if (fx < 0 || fy < 0 || fx > n - 1 || fy > this.ny - 1) {
            if (this.hasHeightmap && this.outerRingMode !== 'flat') return this._sampleOuterHeight(x, y);
            return this.terrainNoise(x, y);
        }
        const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(this.ny - 2, Math.floor(fy));
        const tx = fx - i, ty = fy - j;
        const g = this.hgrid;
        const h00 = g[j * n + i], h10 = g[j * n + i + 1];
        const h01 = g[(j + 1) * n + i], h11 = g[(j + 1) * n + i + 1];
        if (tx >= ty) return h00 + (h10 - h00) * tx + (h11 - h10) * ty;
        return h00 + (h01 - h00) * ty + (h11 - h01) * tx;
    }

    // Surface tilt along the heading (rad): longitudinal and lateral slope from the
    // four points of the object's base — for the body's pitch and roll.
    tiltAt(x, y, headingRad, halfLen, halfWid) {
        const cx = Math.cos(headingRad), sy = Math.sin(headingRad);
        const hf = this.heightAt(x + cx * halfLen, y + sy * halfLen);
        const hb = this.heightAt(x - cx * halfLen, y - sy * halfLen);
        const hl = this.heightAt(x - sy * halfWid, y + cx * halfWid);
        const hr = this.heightAt(x + sy * halfWid, y - cx * halfWid);
        return {
            pitch: Math.atan2(hf - hb, halfLen * 2),   // nose higher than stern -> positive
            roll: Math.atan2(hl - hr, halfWid * 2)     // left side higher -> positive
        };
    }

    // --- Grids --------------------------------------------------------------------

    // Indices of a regular nx×ny grid: triangles (a,b,d)(a,d,c) along the diagonal
    // a-d; swap — reversed winding.
    static gridIndices(nx, ny, swap) {
        const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
        let p = 0;
        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
                if (swap) { idx[p++] = a; idx[p++] = d; idx[p++] = b; idx[p++] = a; idx[p++] = c; idx[p++] = d; }
                else { idx[p++] = a; idx[p++] = b; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = c; }
            }
        }
        return idx;
    }

    // Location grid. ORIENTATION: the ground needs a +Y normal. ComputeNormals takes the
    // face normal (p1−p2)×(p3−p2) — the winding is chosen by it, and a safeguard
    // after ComputeNormals flips it if the engine computed otherwise. Do not
    // "fix" the order by hand: the right-handed scene already cost an iteration.
    _buildGeometry() {
        const nx = this.nx, ny = this.ny, cs = this.cell, NV = nx * ny, H = this.hgrid;
        const W = this.worldW, HH = this.worldH;
        const pos = new Float32Array(NV * 3), uvs = new Float32Array(NV * 2);
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const k = j * nx + i, x = i * cs, y = j * cs;
                pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = y;
                uvs[k * 2] = x / W; uvs[k * 2 + 1] = y / HH;
            }
        }
        // Normal of the first triangle (a, b, d): (a − b) × (d − b), Y component.
        const b = 3, d = (nx + 1) * 3;
        const ax = pos[0] - pos[b], az = pos[2] - pos[b + 2];
        const qx = pos[d] - pos[b], qz = pos[d + 2] - pos[b + 2];
        let swap = (az * qx - ax * qz) < 0;
        let idx = Terrain3D.gridIndices(nx, ny, swap);
        const normals = new Float32Array(pos.length);
        BABYLON.VertexData.ComputeNormals(pos, idx, normals);
        if (normals[1] < 0) {
            swap = !swap;
            idx = Terrain3D.gridIndices(nx, ny, swap);
            BABYLON.VertexData.ComputeNormals(pos, idx, normals);
        }
        this._swap = swap;   // same winding — for the ring

        const mesh = new BABYLON.Mesh('terrain', this.scene);
        const vd = new BABYLON.VertexData();
        vd.positions = pos;
        vd.indices = idx;
        vd.normals = normals;
        vd.uvs = uvs;
        vd.applyToMesh(mesh, true);
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        mesh.freezeWorldMatrix();
        mesh.material = this.material;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
        this.mesh = mesh;
        this.triangles = idx.length / 3;
        this.meshes.push(mesh);
    }

    _sampleOuterHeight(x, y) {
        const W = this.worldW, H = this.worldH;
        const cx = Math.max(0, Math.min(W, x)), cy = Math.max(0, Math.min(H, y));
        if (!this.hasHeightmap || this.outerRingMode === 'flat') {
            return this.terrainNoise(x, y) - 1;
        }
        const cs = this.cell, n = this.nx;
        const fx = Math.max(0, Math.min(n - 1, cx / cs)), fy = Math.max(0, Math.min(this.ny - 1, cy / cs));
        const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(this.ny - 2, Math.floor(fy));
        const tx = fx - i, ty = fy - j;
        const g = this.hgrid;
        const h00 = g[j * n + i], h10 = g[j * n + i + 1];
        const h01 = g[(j + 1) * n + i], h11 = g[(j + 1) * n + i + 1];
        const baseH = tx >= ty ? h00 + (h10 - h00) * tx + (h11 - h10) * ty : h00 + (h01 - h00) * ty + (h11 - h01) * tx;

        const dx = x < 0 ? -x : (x > W ? x - W : 0);
        const dy = y < 0 ? -y : (y > H ? y - H : 0);
        const dist = Math.hypot(dx, dy);
        const extent = this.outerRing || Terrain3D.OUTER_RING;
        const blend = Math.min(1, dist / 200);
        // Natural mountain ridge rising beyond map borders to enclose the sector:
        const rise = Math.pow(Math.min(1, dist / extent), 1.2) * 80;
        const distantNoise = this.terrainNoise(x, y);
        return baseH + rise + (distantNoise - this.noiseBase) * 1.5 * blend - 0.5;
    }

    _updateOuterRing() {
        if (!this.outer || this.outer.isDisposed()) return;
        const extent = this.outerRing, cell = Terrain3D.RING_CELL;
        const W = this.worldW, H = this.worldH;
        const x0 = -extent, y0 = -extent;
        const nx = Math.ceil((W + 2 * extent) / cell) + 1, ny = Math.ceil((H + 2 * extent) / cell) + 1;
        const pos = this.outer.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        if (!pos || pos.length !== nx * ny * 3) return;
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const k = j * nx + i, x = x0 + i * cell, y = y0 + j * cell;
                pos[k * 3 + 1] = this._sampleOuterHeight(x, y);
            }
        }
        this.outer.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
        const normals = new Float32Array(pos.length);
        BABYLON.VertexData.ComputeNormals(pos, this.outer.getIndices(), normals);
        this.outer.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    }

    // Ground ring around the location: pure noise, cell RING_CELL. The hole in it is the location
    // grid; the ring cells at its edge stay and lie 1 px LOWER (under the grid, no further than one
    // and a half cells) — the T-junction of the coarse and fine grids doesn't let the sky show.
    _buildOuterRing() {
        const extent = this.outerRing, cell = Terrain3D.RING_CELL;
        const W = this.worldW, H = this.worldH;
        const x0 = -extent, y0 = -extent;
        const nx = Math.ceil((W + 2 * extent) / cell) + 1, ny = Math.ceil((H + 2 * extent) / cell) + 1;
        const positions = new Float32Array(nx * ny * 3), uvs = new Float32Array(nx * ny * 2);
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const k = j * nx + i, x = x0 + i * cell, y = y0 + j * cell;
                positions[k * 3] = x; positions[k * 3 + 1] = this._sampleOuterHeight(x, y); positions[k * 3 + 2] = y;
                uvs[k * 2] = x / W; uvs[k * 2 + 1] = y / H;
            }
        }
        // Cells — only outside the location grid (with a one-cell margin at its edge).
        const X1 = (this.nx - 1) * this.cell, Y1 = (this.ny - 1) * this.cell;
        const inside = (x, y) => x > 0 && x < X1 && y > 0 && y < Y1;
        const indices = [];
        for (let j = 0; j < ny - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const cx = x0 + (i + 0.5) * cell, cy = y0 + (j + 0.5) * cell;
                if (inside(cx, cy) && inside(cx - cell, cy - cell) && inside(cx + cell, cy + cell)) continue;
                const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
                if (this._swap) indices.push(a, d, b, a, c, d); else indices.push(a, b, d, a, d, c);
            }
        }
        const normals = new Float32Array(positions.length);
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
        const mesh = new BABYLON.Mesh('terrainOuter', this.scene);
        const vd = new BABYLON.VertexData();
        vd.positions = positions;
        vd.indices = indices;
        vd.normals = normals;
        vd.uvs = uvs;
        vd.applyToMesh(mesh, true);
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.freezeWorldMatrix();
        mesh.material = this.outerMaterial;
        this.outer = mesh;
        this.meshes.push(mesh);
    }

    dispose() {
        ++this._fieldRevision;
        ++this._normalRevision;
        for (const m of this.meshes) { try { m.dispose(false, false); } catch (e) { /* ok */ } }
        this.meshes = [];
        this.mesh = null;
        this.outer = null;
        for (const mat of [this.material, this.outerMaterial]) {
            if (mat) { try { mat.dispose(false, false); } catch (e) { /* ok */ } }
        }
        if (this.texture) { try { this.texture.dispose(); } catch (e) { /* ok */ } this.texture = null; }
    }
}

// Width of the ground ring beyond the location edge (px) and its cell.
Terrain3D.OUTER_RING = 2400;
Terrain3D.RING_CELL = 64;
