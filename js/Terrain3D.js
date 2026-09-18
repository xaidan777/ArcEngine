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
        this._noise = (typeof SimplexNoise !== U) ? new SimplexNoise(String(this.noiseSeed)) : null;
        // The camera pitch limit reads the ring width: the ring edge must not get into the frame.
        this.outerRing = Terrain3D.OUTER_RING;
        this.meshes = [];
        this.texture = null;
        this._buildMaterials();
        this._buildField();
        this._buildGeometry();
        this._buildOuterRing();
        if (cfg.groundImage) this.setGroundImage(cfg.groundImage);
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
        if (fx < 0 || fy < 0 || fx > n - 1 || fy > this.ny - 1) return this.terrainNoise(x, y);
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
        vd.applyToMesh(mesh, false);
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        mesh.freezeWorldMatrix();
        mesh.material = this.material;
        this.mesh = mesh;
        this.triangles = idx.length / 3;
        this.meshes.push(mesh);
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
                positions[k * 3] = x; positions[k * 3 + 1] = this.terrainNoise(x, y) - 1; positions[k * 3 + 2] = y;
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
        vd.applyToMesh(mesh, false);
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.freezeWorldMatrix();
        mesh.material = this.outerMaterial;
        this.outer = mesh;
        this.meshes.push(mesh);
    }

    dispose() {
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
