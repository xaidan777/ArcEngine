// Terrain3D.js — земля локации: поле высот из шума, одна сетка на прямоугольник
// [0..W]×[0..H] и грубое кольцо земли за краем (на низком угле камеры за краем
// иначе зияло бы небо).
//
// Высота — TERRAIN_BASE + шум (SimplexNoise(TERRAIN_NOISE_SEED), две октавы,
// амплитуда TERRAIN_NOISE_AMP, размер холма TERRAIN_NOISE_SCALE). heightAt()
// читает ТЕ ЖЕ треугольники, что рисует меш: объекты стоят ровно на
// поверхности. Не заменяй на билинейную интерполяцию — на склонах объекты
// начнут тонуть или висеть.
//
// Материал — тайл текстуры (setGroundImage), повтор каждые GROUND_TILE_SIZE px.
// UV у сетки и кольца одни — (x/W, y/H), поэтому тайл продолжается за край без
// шва. Кольцо красится WORLD3D_OUTER_TINT (меньше 1 — граница локации видна).
//
// ТЕРРЕЙН — КАРТИНКА. Логика игры высоту у 3D не спрашивает: клетка сетки
// зависит от устройства (мобильные — крупнее), и расчёт разошёлся бы между ними.

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
        // Ширину кольца читает предел наклона камеры: край кольца не должен попасть в кадр.
        this.outerRing = Terrain3D.OUTER_RING;
        this.meshes = [];
        this.texture = null;
        this._buildMaterials();
        this._buildField();
        this._buildGeometry();
        this._buildOuterRing();
        if (cfg.groundImage) this.setGroundImage(cfg.groundImage);
    }

    // --- Материал ------------------------------------------------------------------

    // Два материала на одну текстуру: сетка локации и кольцо за краем (у кольца
    // своя яркость). Пока текстуры нет — ровный зелёный.
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

    // Тайл текстуры земли (Image или Canvas). DynamicTexture с invertY = false:
    // V идёт вниз по карте, как y.
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
        // С текстурой цвет материала — множитель: у сетки белый, у кольца — яркость
        // WORLD3D_OUTER_TINT (metadata.outer читает applyMaterialConstants).
        this.material.diffuseTexture = tex;
        this.material.diffuseColor = new BABYLON.Color3(1, 1, 1);
        this.outerMaterial.diffuseTexture = tex;
        this.outerMaterial.metadata.outer = true;
        World3D.applyMaterialConstants(this.outerMaterial);
        if (old) { try { old.dispose(); } catch (e) { /* ok */ } }
    }

    // Повтор тайла — масштабом текстуры: u' = (x/W)·(W/tile) = x/tile.
    // GROUND_TILE_SIZE сменился (редактор) — только это.
    applyTileSize() {
        if (!this.texture) return;
        const tile = Math.max(16, (typeof GROUND_TILE_SIZE !== 'undefined') ? GROUND_TILE_SIZE : 512);
        this.texture.uScale = this.worldW / tile;
        this.texture.vScale = this.worldH / tile;
    }

    // --- Поле высот ------------------------------------------------------------------

    terrainNoise(x, y) {
        if (!this._noise || !(this.noiseAmp > 0)) return this.noiseBase;
        const s = this.noiseScale;
        const n = this._noise.noise2D(x / s, y / s) * 0.72 +
                  this._noise.noise2D(x / s * 2.3 + 17.1, y / s * 2.3 - 9.7) * 0.28;
        return this.noiseBase + n * this.noiseAmp;
    }

    // Высоты в узлах сетки [0..W]×[0..H] с шагом cell. Последняя клетка может
    // выйти за край (UV там > 1 — тайл просто продолжается).
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
        // Диапазон высот — для луча указателя (View3D.pointerToGround) и предела камеры.
        this.hMin = lo;
        this.hMax = hi;
    }

    // Высота поверхности под точкой — ровно та, что рисуется: клетка разбита
    // диагональю (i,j)-(i+1,j+1) на треугольники (00,10,11) и (00,11,01), как в
    // меше. За краем сетки — шум, как у кольца.
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

    // Наклон поверхности вдоль курса (рад): продольный и поперечный уклон по
    // четырём точкам базы объекта — для тангажа и крена корпуса.
    tiltAt(x, y, headingRad, halfLen, halfWid) {
        const cx = Math.cos(headingRad), sy = Math.sin(headingRad);
        const hf = this.heightAt(x + cx * halfLen, y + sy * halfLen);
        const hb = this.heightAt(x - cx * halfLen, y - sy * halfLen);
        const hl = this.heightAt(x - sy * halfWid, y + cx * halfWid);
        const hr = this.heightAt(x + sy * halfWid, y - cx * halfWid);
        return {
            pitch: Math.atan2(hf - hb, halfLen * 2),   // нос выше кормы -> положительный
            roll: Math.atan2(hl - hr, halfWid * 2)     // левый борт выше -> положительный
        };
    }

    // --- Сетки --------------------------------------------------------------------

    // Индексы регулярной сетки nx×ny: треугольники (a,b,d)(a,d,c) по диагонали
    // a-d; swap — обратный обход.
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

    // Сетка локации. ОРИЕНТАЦИЯ: земле нужна нормаль +Y. ComputeNormals берёт
    // нормаль грани (p1−p2)×(p3−p2) — по ней выбирается обход, а страховка
    // после ComputeNormals переворачивает его, если движок посчитал иначе. Не
    // «чинить» порядок вручную: правосторонняя сцена уже стоила итерации.
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
        // Нормаль первого треугольника (a, b, d): (a − b) × (d − b), компонента Y.
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
        this._swap = swap;   // тот же обход — у кольца

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

    // Кольцо земли вокруг локации: чистый шум, клетка RING_CELL. Дыра в нём —
    // сетка локации; клетки кольца у её края остаются и лежат на 1 px НИЖЕ (под
    // сеткой, не дальше полутора клеток) — T-стык грубой и мелкой сеток не светит небом.
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
        // Клетки — только вне сетки локации (с запасом в клетку у её края).
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

// Ширина кольца земли за краем локации (px) и его клетка.
Terrain3D.OUTER_RING = 2400;
Terrain3D.RING_CELL = 64;
