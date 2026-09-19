// Debug3D.js — the kit's dev tools: scene lint, a held debug view, a synchronous benchmark
// and debug render modes. Inert until called: nothing here runs in a normal frame, so the
// script may stay in a release build.
//
//   await Debug3D.lint()                          findings of the active view (World3D.view)
//   Debug3D.hold({ eye: [x, y, h], target: [x, y, h] })   look from here, whatever the camera
//   Debug3D.release()                             controller does; release() hands it back
//   Debug3D.bench()                               ms per frame, GPU-synchronised
//   Debug3D.benchToggle(mesh)                     what one mesh costs (A/B/A/B)
//   Debug3D.setMode('backfaces' | 'normals' | 'wireframe' | 'off')
//
// WHY LINT. Every check below is a defect that once reached the screen unnoticed by the
// author and was found by eye: a mesh with the opposite winding draws its inside (the
// silhouette is the same, so it looks plausible — but the light comes from the wrong side and
// textures are mirrored); an OpenGL normal map in this right-handed scene lights the grooves
// from the back; one light too many silently drops the LAST light of the scene, which is the
// sun; a shader one uniform block over the WebGL2 limit fails to link and the mesh vanishes.
//
// WINDING RULE (measured on Babylon's own primitives and on glTF imports, the same in a
// left- and a right-handed scene). Take the triangle normal as cross(b - a, c - a):
//   - it points AGAINST the vertex normals for ClockWiseSideOrientation (0, Babylon's default:
//     MeshBuilder, Terrain3D, Model3D),
//   - and ALONG them for CounterClockWiseSideOrientation (1: glTF and most ported generators).
// The side is material.sideOrientation when set, else mesh.sideOrientation; a mirrored world
// matrix (negative determinant) flips it. A mesh that disagrees needs the other sideOrientation,
// not a rewrite of its indices.

/** @satisfies {Record<string, any>} */
const Debug3D = {
    /** @type {{ heightAt(x: number, y: number): number } | null} */
    terrain: null,          // for hold(): keeps the eye above the ground; defaults to window.app's
    /** @type {{ view: View3D, observer: any, pose: any } | null} */
    _hold: null,
    _mode: 'off',
    /** @type {Map<BABYLON.AbstractMesh, BABYLON.Material | null>} */
    _saved: new Map(),
    /** @type {BABYLON.ShaderMaterial | null} */
    _modeMaterial: null,
    /** @type {View3D | null} */
    _modeView: null,

    // copies — separate meshes that look like one model before instancing is advised; meshes —
    // separate meshes in a scene at all. A mesh costs the CPU 2 µs per frame bare and 10–15 µs
    // with shadow, outline and ink edges (World3D.addObject): 1000 such meshes ≈ 13 ms.
    LIMITS: { meshTriangles: 300000, sampleTriangles: 20000, copies: 200, meshes: 1000 },

    // --- Lint: pure parts (tests/debug3d.test.mjs) ----------------------------------------

    // Share of triangles whose winding normal points against the vertex normals (0..1), over at
    // most maxTris evenly spaced triangles. total = 0 — nothing to judge by.
    windingAgainstNormals(positions, normals, indices, maxTris) {
        const P = positions, N = normals, I = indices;
        const count = Math.floor(I.length / 3), step = Math.max(1, Math.ceil(count / (maxTris || count || 1)));
        let against = 0, total = 0;
        for (let t = 0; t < count; t += step) {
            const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
            const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
            const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
            const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
            const d = gx * (N[a] + N[b] + N[c]) + gy * (N[a + 1] + N[b + 1] + N[c + 1]) + gz * (N[a + 2] + N[b + 2] + N[c + 2]);
            if (Math.abs(d) < 1e-12) continue;      // degenerate triangle or zero normals
            total++;
            if (d < 0) against++;
        }
        return { against: total ? against / total : 0, total };
    },

    // against — from windingAgainstNormals; side — effective side orientation (0 CW, 1 CCW);
    // mirrored — negative world determinant. Returns the share of triangles facing the wrong
    // way and the verdict: 'ok', 'mixed' (double-sided cards are fine, a half-flipped hull is
    // not) or 'inverted'.
    sideVerdict(against, side, mirrored) {
        const ccw = (side === 1) !== !!mirrored;
        const wrong = ccw ? against : 1 - against;
        return { wrong, verdict: wrong >= 0.9 ? 'inverted' : wrong >= 0.25 ? 'mixed' : 'ok' };
    },

    // A normal map's convention cannot be read from its pixels, only from its name: Poly Haven
    // and glTF maps are OpenGL (Y up), DirectX maps are Y down. A right-handed Babylon scene
    // wants invertNormalMapY = true for OpenGL maps (that is what the glTF loader sets) and
    // false for DirectX ones. Returns 'ok', 'wrong' or 'unknown'.
    normalMapVerdict(url, invertY, rightHanded) {
        if (!rightHanded) return 'unknown';
        const name = String(url || '').toLowerCase();
        const gl = /(_nor_gl|_normal_gl|[_-]gl)\.[a-z]+$|_nor_gl_|normalgl|opengl/.test(name) || /\.(glb|gltf)/.test(name);
        const dx = /(_nor_dx|_normal_dx|[_-]dx)\.[a-z]+$|_nor_dx_|normaldx|directx/.test(name);
        if (gl === dx) return 'unknown';
        return (gl ? !!invertY : !invertY) ? 'ok' : 'wrong';
    },

    // Separate meshes that are copies of one model: list — [{ name, key }], key — what makes two
    // meshes "the same" (vertex and index counts: a model built twice has two geometries, but
    // the same counts). Returns the groups of at least limit meshes, the biggest first.
    copyGroups(list, limit) {
        /** @type {Map<string, { key: string, name: string, count: number }>} */
        const groups = new Map();
        for (const m of list) {
            const g = groups.get(m.key);
            if (g) g.count++;
            else groups.set(m.key, { key: m.key, name: m.name, count: 1 });
        }
        return [...groups.values()].filter(g => g.count >= limit).sort((a, b) => b.count - a.count);
    },

    // Map pose -> Babylon vectors. pose: { eye: [x, y, h], target: [x, y, h] } or
    // { eye, yaw, pitch } (yaw — heading in map radians, pitch — up is positive). The eye is
    // lifted to clearance px above the ground when a terrain is known.
    poseFrom(pose, terrain, clearance) {
        const e = pose.eye, eye = { x: e[0], y: e[1], h: e[2] };
        let clamped = false;
        if (terrain) {
            const floor = terrain.heightAt(eye.x, eye.y) + (clearance == null ? 4 : clearance);
            if (eye.h < floor) { eye.h = floor; clamped = true; }
        }
        let target;
        if (pose.target) target = { x: pose.target[0], y: pose.target[1], h: pose.target[2] };
        else {
            const yaw = pose.yaw || 0, pitch = pose.pitch || 0, cp = Math.cos(pitch);
            target = { x: eye.x + Math.cos(yaw) * cp * 100, y: eye.y + Math.sin(yaw) * cp * 100, h: eye.h + Math.sin(pitch) * 100 };
        }
        return { eye, target, clamped };
    },

    // --- Lint --------------------------------------------------------------------------------

    // Findings of a view: [{ level: 'error' | 'warn' | 'info', code, target, message }], worst
    // first, plus scene totals. opts.silent — no console output; opts.frame = false — skip the
    // blank-frame probe (it renders one frame).
    async lint(view, opts) {
        view = view || World3D.view;
        const o = opts || {};
        /** @type {{ level: string, code: string, target: string, message: string }[]} */
        const out = [];
        if (!view || !view.scene) return { findings: out, stats: null };
        const scene = view.scene, engine = scene.getEngine();
        const add = (level, code, target, message) => out.push({ level, code, target, message });
        const stats = { meshes: 0, triangles: 0, materials: scene.materials.length, lights: scene.lights.length };

        this._lintLights(view, add);
        const seenMaterials = new Set(), seenPrograms = new Set();
        /** @type {Map<string, string[]>} */
        const overLimit = new Map();          // 'lights/limit' -> mesh names
        /** @type {{ mat: BABYLON.Material, mesh: BABYLON.Mesh }[]} */
        const notReady = [];
        /** @type {{ name: string, key: string }[]} */
        const separate = [];                  // meshes drawn one by one: candidates for instancing
        for (const m of scene.meshes) {
            const mesh = /** @type {BABYLON.Mesh} */ (m);
            if (!mesh.isEnabled() || !mesh.isVisible || mesh.isAnInstance || !mesh.getTotalVertices || !mesh.getTotalVertices()) continue;
            if (this._saved.has(mesh) && mesh.material === this._modeMaterial) continue;   // a debug mode is on
            stats.meshes++;
            const copies = mesh.hasThinInstances ? mesh.thinInstanceCount : 1 + (mesh.instances ? mesh.instances.length : 0);
            const tris = mesh.getTotalIndices() / 3;
            stats.triangles += tris * Math.max(1, copies);
            if (tris > this.LIMITS.meshTriangles) {
                add('warn', 'heavy-mesh', mesh.name, Math.round(tris / 1000) + 'K triangles in one mesh (x' + copies + ' copies): decimate or add a LOD');
            }
            if (!mesh.hasThinInstances && !mesh.skeleton) separate.push({ name: mesh.name, key: mesh.getTotalVertices() + '/' + mesh.getTotalIndices() });
            this._lintWinding(mesh, add);
            this._lintMeshLights(mesh, overLimit);
            for (const mat of this._materialsOf(mesh)) {
                if (seenMaterials.has(mat)) continue;
                seenMaterials.add(mat);
                this._lintMaterial(mat, mesh, scene, add, notReady);
            }
            this._lintPrograms(mesh, engine, seenPrograms, add);
        }
        for (const [key, names] of overLimit) {
            const [n, max] = key.split('/').map(Number);
            add('error', 'light-limit', names.length + ' mesh(es)', n + ' lights reach ' + names.slice(0, 4).join(', ') + (names.length > 4 ? ', …' : '') +
                ', their materials take ' + max + ': the last ' + (n - max) + ' (the sun first) are dropped. Raise maxSimultaneousLights, narrow lights with includedOnlyMeshes or move them into a ClusteredLightContainer');
        }
        for (const g of this.copyGroups(separate, this.LIMITS.copies)) {
            add('warn', 'many-copies', g.name, g.count + ' separate meshes look like copies of one model (' + g.key + ' vertices/indices): each is a draw call of its own in the main pass, ' +
                'the shadow map, the outline mask and the ink edges — 2 to 15 µs of CPU per frame. Draw them with World3D.addInstances(view, mesh, kind, items) — one draw call for all');
        }
        if (separate.length > this.LIMITS.meshes) {
            const n = separate.length;
            add('warn', 'many-meshes', n + ' meshes', 'per-mesh work takes about ' + Math.round(n * 0.002) + '–' + Math.round(n * 0.015) + ' ms of CPU per frame (bare — with shadow, outline and ink edges). ' +
                'Draw copies with World3D.addInstances, merge static parts of one material (BABYLON.Mesh.MergeMeshes), freeze what never moves (mesh.freezeWorldMatrix())');
        }
        // Shaders compile in parallel: a material changed a moment ago is not a finding yet.
        if (notReady.length) {
            await new Promise(r => setTimeout(r, 1200));
            for (const p of notReady) {
                if (p.mesh.isDisposed() || p.mat.isReady(p.mesh, p.mesh.hasInstances || p.mesh.hasThinInstances)) continue;
                add('warn', 'material-not-ready', p.mat.name, 'not ready on "' + p.mesh.name + '": a texture is still loading or failed, or the shader did not compile');
            }
        }
        if (o.frame !== false) await this._lintFrame(view, add);

        const rank = { error: 0, warn: 1, info: 2 };
        out.sort((a, b) => rank[a.level] - rank[b.level]);
        if (!o.silent) {
            const n = (l) => out.filter(f => f.level === l).length;
            console.log('Debug3D.lint: ' + n('error') + ' error(s), ' + n('warn') + ' warning(s), ' + n('info') + ' note(s); ' +
                stats.meshes + ' meshes, ' + Math.round(stats.triangles / 1000) + 'K triangles, ' + stats.lights + ' lights');
            if (out.length) console.table(out);
        }
        return { findings: out, stats };
    },

    _materialsOf(mesh) {
        const m = mesh.material;
        if (!m) return [];
        const subs = /** @type {BABYLON.MultiMaterial} */ (m).subMaterials;
        return subs ? subs.filter(Boolean) : [m];
    },

    _lintWinding(mesh, add) {
        const K = BABYLON.VertexBuffer;
        const P = mesh.getVerticesData(K.PositionKind), N = mesh.getVerticesData(K.NormalKind), I = mesh.getIndices();
        if (!P || !N || !I || !I.length) return;
        const w = this.windingAgainstNormals(P, N, I, this.LIMITS.sampleTriangles);
        if (!w.total) return;
        const mats = this._materialsOf(mesh);
        const own = mats.length === 1 && mats[0].sideOrientation != null ? mats[0].sideOrientation : mesh.sideOrientation;
        const v = this.sideVerdict(w.against, own, mesh.getWorldMatrix().determinant() < 0);
        if (v.verdict === 'ok') return;
        const culled = mats.length === 0 || mats.some(m => m.backFaceCulling);
        const want = own === 1 ? 'ClockWiseSideOrientation' : 'CounterClockWiseSideOrientation';
        const share = Math.round(v.wrong * 100) + '% of triangles face inward';
        if (v.verdict === 'inverted') {
            add(culled ? 'error' : 'warn', 'inverted-winding', mesh.name, share + (culled
                ? ': the mesh draws its INSIDE (far wall, mirrored texture, light from the wrong side)'
                : ': back-face lighting is wrong') + ' — set mesh.sideOrientation = BABYLON.Material.' + want);
        } else if (culled) {
            add('warn', 'mixed-winding', mesh.name, share + ' while back-face culling is on: holes from one side — fix the index order of those parts or turn culling off for cards');
        }
    },

    _lintLights(view, add) {
        const lights = view.scene.lights.filter(l => l.isEnabled());
        if (view.sun && lights.length && lights[lights.length - 1] !== view.sun) {
            add('warn', 'sun-not-last', view.sun.name, 'the sun must stay the LAST light of the scene: the toon plugin reads the shadow of the last light, and a light limit drops lights from the end. After adding lights: scene.removeLight(sun); scene.addLight(sun)');
        }
    },

    _lintMeshLights(mesh, overLimit) {
        const n = mesh.lightSources ? mesh.lightSources.filter(l => l.isEnabled()).length : 0;
        for (const mat of this._materialsOf(mesh)) {
            const max = /** @type {BABYLON.StandardMaterial} */ (mat).maxSimultaneousLights;
            if (max == null || /** @type {BABYLON.StandardMaterial} */ (mat).disableLighting || n <= max) continue;
            const key = n + '/' + max;
            if (!overLimit.has(key)) overLimit.set(key, []);
            overLimit.get(key).push(mesh.name);
            return;
        }
    },

    _lintMaterial(mat, mesh, scene, add, notReady) {
        if (!mat.isReady(mesh, mesh.hasInstances || mesh.hasThinInstances)) notReady.push({ mat, mesh });
        const bump = /** @type {BABYLON.StandardMaterial} */ (mat).bumpTexture;
        if (!bump) return;
        const invY = /** @type {BABYLON.StandardMaterial} */ (mat).invertNormalMapY;
        const url = /** @type {BABYLON.Texture} */ (bump).url || bump.name;
        const verdict = this.normalMapVerdict(url, invY, scene.useRightHandedSystem);
        if (verdict === 'wrong') {
            add('error', 'normal-map-y', mat.name, 'normal map "' + url + '" with invertNormalMapY = ' + !!invY + ': grooves are lit from the back. In this right-handed scene OpenGL maps (Poly Haven, glTF) need true, DirectX maps false');
        } else if (verdict === 'unknown' && scene.useRightHandedSystem && !invY) {
            add('info', 'normal-map-y', mat.name, 'normal map "' + url + '" with invertNormalMapY = false: right only for a DirectX map. OpenGL maps (Poly Haven, glTF) need true in this right-handed scene');
        }
    },

    // Link errors and the two hard WebGL2 limits a growing scene runs into: uniform blocks per
    // stage (Scene, Material and one per light) and texture units.
    _lintPrograms(mesh, engine, seen, add) {
        const gl = /** @type {any} */ (engine)._gl;
        if (!gl || !mesh.subMeshes) return;
        for (const sm of mesh.subMeshes) {
            const effect = sm.effect;
            if (!effect || seen.has(effect)) continue;
            seen.add(effect);
            const err = effect.getCompilationError();
            if (err) { add('error', 'shader', mesh.name, 'shader failed: ' + String(err).slice(0, 300)); continue; }
            const ctx = /** @type {any} */ (effect.getPipelineContext());
            const program = ctx && ctx.program;
            if (!program || !gl.getProgramParameter || !gl.MAX_FRAGMENT_UNIFORM_BLOCKS) continue;
            const blocks = gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS), maxBlocks = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS);
            if (blocks >= maxBlocks) {
                add('warn', 'uniform-blocks', mesh.name, blocks + ' of ' + maxBlocks + ' uniform blocks used (one per light): one more light on this mesh and its shader will not link');
            }
            let samplers = 0;
            const uniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
            for (let i = 0; i < uniforms; i++) {
                const u = gl.getActiveUniform(program, i);
                if (u && (u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_CUBE || u.type === gl.SAMPLER_2D_ARRAY || u.type === gl.SAMPLER_3D ||
                    u.type === gl.SAMPLER_2D_SHADOW || u.type === gl.SAMPLER_CUBE_SHADOW || u.type === gl.SAMPLER_2D_ARRAY_SHADOW)) samplers += u.size;
            }
            const maxTex = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
            if (samplers >= maxTex - 1) {
                add('warn', 'texture-units', mesh.name, samplers + ' of ' + maxTex + ' texture units used: every shadow map and texture takes one');
            }
        }
    },

    // A NaN in an HDR pass (normalize of a zero vector, pow of a negative) spreads through bloom
    // and whites out the WHOLE frame; a shader writing zeros blacks it out.
    async _lintFrame(view, add) {
        const engine = view.scene.getEngine();
        try {
            World3D.renderFrame();
            const w = engine.getRenderWidth(), h = engine.getRenderHeight();
            const px = /** @type {Uint8Array} */ (await engine.readPixels(0, 0, w, h));
            let white = 0, black = 0, n = 0;
            for (let i = 0; i + 3 < px.length; i += 4 * 61) {
                n++;
                if (px[i] >= 250 && px[i + 1] >= 250 && px[i + 2] >= 250) white++;
                else if (px[i] <= 4 && px[i + 1] <= 4 && px[i + 2] <= 4) black++;
            }
            if (n && white / n > 0.98) add('warn', 'blank-frame', 'frame', 'the frame is fully white: a NaN in an HDR pass spreads through bloom — look for normalize() of a zero vector or pow() of a negative in custom shaders');
            if (n && black / n > 0.98) add('warn', 'blank-frame', 'frame', 'the frame is fully black: no light reaches the scene, exposure is zero or a shader writes zeros');
        } catch (e) { /* readPixels is unavailable — skip the probe */ }
    },

    // --- Held view -----------------------------------------------------------------------------

    // Holds the Babylon camera at a pose whatever the CameraController does: the pose is applied
    // right before every render, after the controller's own update. Returns the pose in use
    // ({ eye, target, clamped }); clamped — the eye was under the ground and has been lifted.
    hold(pose, view) {
        view = view || World3D.view;
        this.release();
        const app = /** @type {any} */ (window).app;
        const terrain = this.terrain || (app && app.location && app.location.terrain) || null;
        const p = this.poseFrom(pose, terrain, pose.clearance);
        const cam = /** @type {BABYLON.TargetCamera} */ (view.camera);
        const target = new BABYLON.Vector3(p.target.x, p.target.h, p.target.y);
        const apply = () => { cam.position.set(p.eye.x, p.eye.h, p.eye.y); cam.setTarget(target); };
        const observer = view.scene.onBeforeRenderObservable.add(apply);
        this._hold = { view, observer, pose: p };
        apply();
        return p;
    },

    // Hands the camera back to its controller (its next update() restores its own pose).
    release() {
        const h = this._hold;
        if (!h) return;
        if (h.view.scene) h.view.scene.onBeforeRenderObservable.remove(h.observer);
        this._hold = null;
    },

    // n frames right now, without waiting for requestAnimationFrame (a hidden or background
    // tab gets a few frames per second at best): for "move, then look" in one script.
    frames(n) {
        for (let i = 0; i < (n || 1); i++) World3D.renderFrame();
    },

    // --- Benchmark -----------------------------------------------------------------------------

    // Milliseconds per frame with the GPU drained (gl.finish) before and after: the FPS counter
    // of a throttled tab says nothing. Same view, same size, nothing else rendering nearby —
    // a second 3D tab halves the GPU.
    bench(opts) {
        const o = opts || {}, engine = World3D.engine, gl = /** @type {any} */ (engine)._gl;
        const finish = () => { if (gl && gl.finish) gl.finish(); };
        this.frames(o.warmup == null ? 10 : o.warmup);
        finish();
        const n = o.frames || 60, t0 = performance.now();
        this.frames(n);
        finish();
        const ms = (performance.now() - t0) / n;
        return { ms: Math.round(ms * 100) / 100, fps: Math.round(1000 / ms), width: engine.getRenderWidth(), height: engine.getRenderHeight() };
    },

    // Cost of one thing: target — a mesh (enabled on/off) or { on(), off() }. Alternates A/B
    // rounds times and compares the best runs — one-off spikes (shader compiles) drop out.
    benchToggle(target, opts) {
        const o = opts || {}, rounds = o.rounds || 3;
        const t = target.setEnabled ? { on: () => target.setEnabled(true), off: () => target.setEnabled(false) } : target;
        const on = [], off = [];
        for (let i = 0; i < rounds; i++) {
            t.on(); on.push(this.bench(o).ms);
            t.off(); off.push(this.bench(o).ms);
        }
        t.on();
        const best = (a) => Math.min(...a);
        return { on: best(on), off: best(off), delta: Math.round((best(on) - best(off)) * 100) / 100, runs: { on, off } };
    },

    // --- Debug render modes ----------------------------------------------------------------------

    // 'backfaces' — faces Babylon treats as back are RED (an inside-out mesh turns red from the
    // outside), 'normals' — world normals as color, 'wireframe', 'off'. Materials are swapped
    // for the time of the mode and restored by 'off'; meshes added meanwhile keep their own.
    setMode(mode, view) {
        view = view || this._modeView || World3D.view;
        const scene = view.scene;
        for (const [mesh, mat] of this._saved) if (!mesh.isDisposed()) mesh.material = mat;
        this._saved.clear();
        scene.forceWireframe = false;
        this._mode = mode === 'backfaces' || mode === 'normals' || mode === 'wireframe' ? mode : 'off';
        this._modeView = this._mode === 'off' ? null : view;
        if (this._mode === 'off') return this._mode;
        if (this._mode === 'wireframe') { scene.forceWireframe = true; return this._mode; }
        const mat = this._facesMaterial(scene);
        mat.setFloat('mode', this._mode === 'normals' ? 1 : 0);
        for (const mesh of scene.meshes) {
            if (!mesh.getTotalVertices || !mesh.getTotalVertices() || mesh.isAnInstance) continue;
            this._saved.set(mesh, mesh.material);
            mesh.material = mat;
        }
        return this._mode;
    },

    _facesMaterial(scene) {
        if (this._modeMaterial && this._modeMaterial.getScene() === scene) return this._modeMaterial;
        const S = BABYLON.Effect.ShadersStore;
        S.debug3dFacesVertexShader = [
            'precision highp float;',
            'attribute vec3 position;',
            'attribute vec3 normal;',
            '#include<instancesDeclaration>',
            'uniform mat4 viewProjection;',
            'varying vec3 vN;',
            'void main(void) {',
            '#include<instancesVertex>',
            '    vN = mat3(finalWorld) * normal;',
            '    gl_Position = viewProjection * finalWorld * vec4(position, 1.0);',
            '}'].join('\n');
        S.debug3dFacesFragmentShader = [
            'precision highp float;',
            'varying vec3 vN;',
            'uniform float mode;',
            'void main(void) {',
            '    vec3 n = normalize(vN + vec3(0.0, 1e-5, 0.0));',
            '    if (mode > 0.5) { gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); return; }',
            '    float l = 0.3 + 0.7 * abs(dot(n, normalize(vec3(0.4, 0.8, 0.45))));',
            '    gl_FragColor = gl_FrontFacing ? vec4(vec3(l) * 0.75, 1.0) : vec4(l, 0.07, 0.05, 1.0);',
            '}'].join('\n');
        const mat = new BABYLON.ShaderMaterial('debug3dFaces', scene, { vertex: 'debug3dFaces', fragment: 'debug3dFaces' }, {
            attributes: ['position', 'normal'],
            uniforms: ['world', 'viewProjection', 'mode']
        });
        mat.backFaceCulling = false;
        this._modeMaterial = mat;
        return mat;
    }
};
