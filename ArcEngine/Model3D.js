// Model3D.js — модели: бинарный FBX (7.x: Blender, Maya, Unity) -> меши Babylon.
// Объекты локации (Objects.js) ставит Location3D: load(url) -> build() ->
// World3D.addObject. Модели лежат в assets/models/.
//
// Берётся: узлы Model с геометрией — трансформ (Lcl Translation/Rotation/Scaling,
// Pre/PostRotation, пивоты, Geometric*, родители), полигоны веером в
// треугольники, нормали, цвет материала (DiffuseColor), центр и оси узла (по
// ним Location3D вращает часть — def.anim). Не берётся: текстуры, UV, вершинные
// цвета, кости, анимация, ASCII-FBX.
//
// ЕДИНИЦЫ: сантиметры (UnitScaleFactor файла учтён) = px мира: модель из Blender
// ростом 2 м — 200 px при scale 1. Начало координат модели — начало файла.
// ОСИ: FBX по умолчанию правосторонний с Y вверх — как сцена набора; другие оси
// файла (GlobalSettings: UpAxis, FrontAxis, CoordAxis) приводятся к этим.
// ОБХОД: лицевая грань FBX — против часовой, а у мешей Babylon (MeshBuilder,
// Terrain3D) нормаль по обходу смотрит в обратную сторону — треугольники
// пишутся задом наперёд, иначе backFaceCulling срежет лицевые грани.
// ЦВЕТ: DiffuseColor в файле линейный (так пишет Blender), StandardMaterial
// ждёт гамма-пространство — без toGammaSpace краски темнее, чем в Blender.
// Матрицы Babylon — под вектор-строку: A.multiply(B) — сначала A, потом B.

const Model3D = {
    _cache: new Map(),   // url -> Promise разбора: файл качается и разбирается раз на страницу

    // url -> Promise<модель> (см. parse).
    load(url) {
        let p = this._cache.get(url);
        if (!p) {
            p = fetch(url)
                .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                .then((buf) => this.parse(buf));
            this._cache.set(url, p);
            p.catch(() => this._cache.delete(url));   // ошибку не кэшируем: файл могут положить позже
        }
        return p;
    },

    // Модель -> меш-корень без геометрии, части — его дети; у каждого вызова свои
    // меши и материалы. opts: { name }.
    build(model, scene, opts) {
        const o = opts || {};
        const root = new BABYLON.Mesh(o.name || 'model', scene);
        const mats = [];
        const material = (i) => {
            if (!mats[i]) {
                const m = model.materials[i];
                mats[i] = new BABYLON.StandardMaterial(root.name + '/' + m.name, scene);
                mats[i].diffuseColor = new BABYLON.Color3(m.color[0], m.color[1], m.color[2]).toGammaSpace();
            }
            return mats[i];
        };
        for (const part of model.parts) {
            const mesh = new BABYLON.Mesh(root.name + '/' + part.name, scene);
            mesh.metadata = { part: part.name, pivot: part.pivot, axes: part.axes };
            const pos = part.positions.slice(), count = pos.length / 3;
            const vd = new BABYLON.VertexData();
            vd.positions = pos;
            vd.indices = new Uint32Array(count).map((_, i) => i);
            vd.normals = part.normals ? part.normals.slice() : new Float32Array(pos.length);
            if (!part.normals) BABYLON.VertexData.ComputeNormals(pos, vd.indices, vd.normals);
            vd.applyToMesh(mesh);
            if (part.groups.length > 1) {
                const multi = new BABYLON.MultiMaterial(mesh.name, scene);
                multi.subMaterials = part.groups.map((g) => material(g.material));
                mesh.material = multi;
                mesh.subMeshes = [];
                part.groups.forEach((g, i) => new BABYLON.SubMesh(i, g.start, g.count, g.start, g.count, mesh));
            } else {
                mesh.material = material(part.groups[0].material);
            }
            mesh.parent = root;
        }
        return root;
    },

    // Снять построенную модель со сцены вместе с её материалами
    // (World3D.removeObject материалы оставляет владельцу).
    dispose(view, root) {
        const mats = new Set();
        for (const m of [root].concat(root.getChildMeshes(false))) {
            if (!m.material) continue;
            mats.add(m.material);
            for (const sm of m.material.subMaterials || []) if (sm) mats.add(sm);
        }
        World3D.removeObject(view, root);
        for (const mat of mats) mat.dispose();
    },

    // ArrayBuffer -> { materials: [{ name, color: [r, g, b] }], parts: [{ name,
    // positions, normals | null, groups: [{ material, start, count }], pivot: [x, y, z],
    // axes: { x, y, z } }], min, max }. Координаты — мир файла в осях сцены; вершины
    // части идут группами по материалу; pivot и axes — начало и единичные локальные
    // оси узла (origin и оси объекта в Blender).
    async parse(buffer) {
        const tree = await this._readTree(buffer);
        const objects = new Map(), parents = new Map(), children = new Map();
        for (const n of (this._child(tree, 'Objects') || { nodes: [] }).nodes) objects.set(n.props[0], n);
        // Связи «объект -> родитель» в порядке файла: по нему нумеруются материалы модели.
        for (const c of (this._child(tree, 'Connections') || { nodes: [] }).nodes) {
            if (c.name !== 'C' || c.props[0] !== 'OO') continue;
            const from = c.props[1], to = c.props[2];
            if (!parents.has(from)) parents.set(from, []);
            if (!children.has(to)) children.set(to, []);
            parents.get(from).push(to);
            children.get(to).push(from);
        }
        const kind = (id) => (objects.has(id) ? objects.get(id).name : '');
        const nameOf = (n) => String(n.props[1]).split('\0')[0];   // "house\0\x01Model" -> "house"

        const worlds = new Map();
        const worldOf = (id) => {
            let m = worlds.get(id);
            if (!m) {
                m = this._localMatrix(this._props70(objects.get(id)));
                const parent = (parents.get(id) || []).find((p) => kind(p) === 'Model');
                if (parent) m = m.multiply(worldOf(parent));
                worlds.set(id, m);
            }
            return m;
        };

        // Оси файла -> оси сцены, единицы файла -> см (UnitScaleFactor — сантиметров в единице).
        const gs = this._props70(this._child(tree, 'GlobalSettings'));
        const unit = gs.UnitScaleFactor && gs.UnitScaleFactor[0] > 0 ? gs.UnitScaleFactor[0] : 1;
        const axes = this._axisMatrix(gs).multiply(BABYLON.Matrix.Scaling(unit, unit, unit));
        const model = { materials: [], parts: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        const matIndex = new Map();
        const materialIndex = (id) => {
            if (!matIndex.has(id)) {
                const n = objects.get(id), p = n ? this._props70(n) : {};
                const c = p.DiffuseColor || p.Diffuse || [0.8, 0.8, 0.8];
                matIndex.set(id, model.materials.length);
                model.materials.push({ name: n ? nameOf(n) : 'default', color: [c[0], c[1], c[2]] });
            }
            return matIndex.get(id);
        };
        for (const [id, node] of objects) {
            if (node.name !== 'Model') continue;
            const links = children.get(id) || [];
            const geo = links.map((l) => objects.get(l)).find((n) => n && n.name === 'Geometry' && n.props[2] === 'Mesh');
            if (!geo) continue;
            const mats = links.filter((l) => kind(l) === 'Material').map(materialIndex);
            if (!mats.length) mats.push(materialIndex('default'));
            const world = this._geometricMatrix(this._props70(node)).multiply(worldOf(id)).multiply(axes);
            const part = this._triangulate(geo, world, mats, model);
            if (part) {
                part.name = nameOf(node);
                // Узел без Geometric*: они сдвигают только геометрию, центр объекта остаётся.
                const frame = worldOf(id).multiply(axes), V = BABYLON.Vector3;
                part.pivot = V.TransformCoordinates(V.Zero(), frame).asArray();
                part.axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
                for (const k in part.axes) part.axes[k] = V.TransformNormal(V.FromArray(part.axes[k]), frame).normalize().asArray();
                model.parts.push(part);
            }
        }
        if (!model.parts.length) throw new Error('no meshes in FBX');
        return model;
    },

    // Полигоны Geometry -> треугольники в мире файла, группами по материалу; габарит — в model.
    _triangulate(geo, world, mats, model) {
        const V = this._value(geo, 'Vertices'), P = this._value(geo, 'PolygonVertexIndex');
        if (!V || !P) return null;
        const N = this._layer(this._child(geo, 'LayerElementNormal'), 'Normals', 'NormalsIndex');
        const ml = this._child(geo, 'LayerElementMaterial');
        const matIds = this._value(ml, 'Materials');
        const byPoly = matIds && this._value(ml, 'MappingInformationType') === 'ByPolygon';
        const normalMatrix = world.clone().invert().transpose();
        const mirror = world.determinant() < 0;   // зеркальный трансформ сам разворачивает обход
        const groups = new Map();                  // материал -> { pos: [], nrm: [] }
        const a = new BABYLON.Vector3(), lo = model.min, hi = model.max;

        // Угол полигона: pv — номер в PolygonVertexIndex (последний угол записан как ~индекс).
        const corner = (g, pv, poly) => {
            const v = P[pv] < 0 ? ~P[pv] : P[pv];
            BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(V[3 * v], V[3 * v + 1], V[3 * v + 2], world, a);
            g.pos.push(a.x, a.y, a.z);
            if (a.x < lo[0]) lo[0] = a.x; if (a.x > hi[0]) hi[0] = a.x;
            if (a.y < lo[1]) lo[1] = a.y; if (a.y > hi[1]) hi[1] = a.y;
            if (a.z < lo[2]) lo[2] = a.z; if (a.z > hi[2]) hi[2] = a.z;
            if (!N) return;
            const i = 3 * N.at(pv, v, poly);
            BABYLON.Vector3.TransformNormalFromFloatsToRef(N.data[i], N.data[i + 1], N.data[i + 2], normalMatrix, a);
            a.normalize();
            g.nrm.push(a.x, a.y, a.z);
        };

        for (let start = 0, poly = 0, i = 0; i < P.length; i++) {
            if (P[i] >= 0) continue;
            const mi = matIds ? matIds[byPoly ? poly : 0] : 0;
            const key = mi < mats.length ? mats[mi] : mats[0];
            let g = groups.get(key);
            if (!g) groups.set(key, (g = { pos: [], nrm: [] }));
            for (let k = start + 1; k < i; k++) {
                // Веер (start, k, k+1) задом наперёд — обход Babylon (шапка файла).
                corner(g, start, poly);
                corner(g, mirror ? k : k + 1, poly);
                corner(g, mirror ? k + 1 : k, poly);
            }
            poly++;
            start = i + 1;
        }

        let total = 0;
        for (const g of groups.values()) total += g.pos.length;
        if (!total) return null;
        const positions = new Float32Array(total), normals = N ? new Float32Array(total) : null, list = [];
        let at = 0;
        for (const [material, g] of groups) {
            positions.set(g.pos, at);
            if (normals) normals.set(g.nrm, at);
            list.push({ material, start: at / 3, count: g.pos.length / 3 });
            at += g.pos.length;
        }
        return { positions, normals, groups: list };
    },

    // Слой геометрии (нормали): данные и индекс данных для угла полигона —
    // pv: номер угла в PolygonVertexIndex, v: вершина, poly: полигон.
    _layer(el, dataName, indexName) {
        const data = this._value(el, dataName);
        if (!data) return null;
        const mapping = this._value(el, 'MappingInformationType');
        const index = this._value(el, 'ReferenceInformationType') === 'Direct' ? null : this._value(el, indexName);
        return {
            data,
            at: (pv, v, poly) => {
                const i = mapping === 'ByPolygonVertex' ? pv : mapping === 'ByPolygon' ? poly : mapping === 'AllSame' ? 0 : v;
                return index ? index[i] : i;
            }
        };
    },

    // Локальный трансформ узла. У FBX (вектор-столбец):
    //   T · Roff · Rp · Rpre · R · Rpost⁻¹ · Rp⁻¹ · Soff · Sp · S · Sp⁻¹
    // у Babylon (вектор-строка) — тот же ряд справа налево.
    _localMatrix(p) {
        const M = BABYLON.Matrix, Z = [0, 0, 0];
        const T = (t, k) => M.Translation(t[0] * k, t[1] * k, t[2] * k);
        const order = ['XYZ', 'XZY', 'YZX', 'YXZ', 'ZXY', 'ZYX'][(p.RotationOrder || [0])[0]] || 'XYZ';
        const s = p['Lcl Scaling'] || [1, 1, 1], rp = p.RotationPivot || Z, sp = p.ScalingPivot || Z;
        return T(sp, -1)
            .multiply(M.Scaling(s[0], s[1], s[2]))
            .multiply(T(sp, 1))
            .multiply(T(p.ScalingOffset || Z, 1))
            .multiply(T(rp, -1))
            .multiply(this._euler(p.PostRotation || Z, 'XYZ').transpose())   // обратная к повороту — транспонированная
            .multiply(this._euler(p['Lcl Rotation'] || Z, order))
            .multiply(this._euler(p.PreRotation || Z, 'XYZ'))
            .multiply(T(rp, 1))
            .multiply(T(p.RotationOffset || Z, 1))
            .multiply(T(p['Lcl Translation'] || Z, 1));
    },

    // Сдвиг геометрии относительно своего узла (детям не наследуется): Gt · Gr · Gs.
    _geometricMatrix(p) {
        const M = BABYLON.Matrix, s = p.GeometricScaling || [1, 1, 1], t = p.GeometricTranslation || [0, 0, 0];
        return M.Scaling(s[0], s[1], s[2])
            .multiply(this._euler(p.GeometricRotation || [0, 0, 0], 'XYZ'))
            .multiply(M.Translation(t[0], t[1], t[2]));
    },

    // Углы в градусах -> поворот; order — оси в порядке применения (XYZ: сначала X).
    _euler(deg, order) {
        const M = BABYLON.Matrix, r = Math.PI / 180;
        let m = M.Identity();
        for (const ax of order) {
            m = m.multiply(ax === 'X' ? M.RotationX(deg[0] * r) : ax === 'Y' ? M.RotationY(deg[1] * r) : M.RotationZ(deg[2] * r));
        }
        return m;
    },

    // Оси файла -> оси сцены: CoordAxis -> X, UpAxis -> Y, FrontAxis -> Z, со знаками.
    _axisMatrix(gs) {
        const get = (name, def) => (gs[name] ? gs[name][0] : def);
        const c = get('CoordAxis', 0), u = get('UpAxis', 1), f = get('FrontAxis', 2);
        if (new Set([c, u, f]).size !== 3 || Math.min(c, u, f) < 0 || Math.max(c, u, f) > 2) return BABYLON.Matrix.Identity();
        const m = new Array(16).fill(0);
        m[c * 4] = get('CoordAxisSign', 1);
        m[u * 4 + 1] = get('UpAxisSign', 1);
        m[f * 4 + 2] = get('FrontAxisSign', 1);
        m[15] = 1;
        return BABYLON.Matrix.FromArray(m);
    },

    // Properties70 узла -> { имя: [значения] } (запись P: имя, тип, два флага, значения).
    _props70(node) {
        const out = {}, p70 = this._child(node, 'Properties70');
        if (p70) for (const p of p70.nodes) out[p.props[0]] = p.props.slice(4);
        return out;
    },

    _child(node, name) {
        return node ? node.nodes.find((n) => n.name === name) : undefined;
    },

    _value(node, name) {
        const n = this._child(node, name);
        return n ? n.props[0] : undefined;
    },

    // Бинарный FBX -> дерево узлов { name, props, nodes }. int64 — строкой (это
    // id объектов), массивы — типизированные: сжатые (zlib) распаковывает
    // DecompressionStream, все разом после обхода.
    async _readTree(buffer) {
        const bytes = new Uint8Array(buffer), dv = new DataView(buffer), text = new TextDecoder();
        const str = (at, n) => text.decode(bytes.subarray(at, at + n));
        if (bytes.length < 27 || str(0, 18) !== 'Kaydara FBX Binary') throw new Error('not a binary FBX (ASCII FBX is not supported)');
        const W = dv.getUint32(23, true) >= 7500 ? 8 : 4;   // с версии 7.5 поля записи 64-битные
        const num = (at) => (W === 8 ? Number(dv.getBigUint64(at, true)) : dv.getUint32(at, true));
        const ARRAYS = { f: Float32Array, d: Float64Array, i: Int32Array, l: BigInt64Array, b: Uint8Array };
        const pending = [];

        const readNode = (at) => {
            const end = num(at), count = num(at + W), nameLen = bytes[at + 3 * W];
            if (end === 0) return null;   // нулевая запись — конец списка
            const node = { name: str(at + 3 * W + 1, nameLen), props: [], nodes: [], end };
            let p = at + 3 * W + 1 + nameLen;
            for (let i = 0; i < count; i++) {
                const t = String.fromCharCode(bytes[p++]);
                switch (t) {
                    case 'Y': node.props.push(dv.getInt16(p, true)); p += 2; break;
                    case 'C': node.props.push(bytes[p] !== 0); p += 1; break;
                    case 'I': node.props.push(dv.getInt32(p, true)); p += 4; break;
                    case 'F': node.props.push(dv.getFloat32(p, true)); p += 4; break;
                    case 'D': node.props.push(dv.getFloat64(p, true)); p += 8; break;
                    case 'L': node.props.push(dv.getBigInt64(p, true).toString()); p += 8; break;
                    case 'S': case 'R': {
                        const n = dv.getUint32(p, true);
                        node.props.push(t === 'S' ? str(p + 4, n) : bytes.subarray(p + 4, p + 4 + n));
                        p += 4 + n;
                        break;
                    }
                    default: {
                        if (!ARRAYS[t]) throw new Error('FBX: unknown property type ' + t);
                        const n = dv.getUint32(p, true), zip = dv.getUint32(p + 4, true) === 1, len = dv.getUint32(p + 8, true);
                        pending.push({ props: node.props, at: node.props.length, T: ARRAYS[t], n, zip, data: bytes.subarray(p + 12, p + 12 + len) });
                        node.props.push(null);
                        p += 12 + len;
                    }
                }
            }
            while (p < end) {
                const child = readNode(p);
                if (!child) break;
                node.nodes.push(child);
                p = child.end;
            }
            return node;
        };

        const tree = { name: '', props: [], nodes: [] };
        for (let at = 27; at + 3 * W + 1 <= bytes.length;) {
            const node = readNode(at);
            if (!node) break;
            tree.nodes.push(node);
            at = node.end;
        }
        await Promise.all(pending.map(async (a) => {
            // Своя копия байтов: типизированному массиву нужно выравнивание буфера.
            const raw = a.zip
                ? new Uint8Array(await new Response(new Blob([a.data]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
                : a.data.slice();
            a.props[a.at] = new a.T(raw.buffer, 0, a.n);
        }));
        return tree;
    },
};
