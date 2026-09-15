// Location3D.js — локация: 3D-вид (свет, небо, туман, тени), земля (Terrain3D)
// размером LOCATION_WIDTH × LOCATION_HEIGHT с текстурой LOCATION_GROUND и
// объекты — модели из Objects.js (LOCATION_OBJECTS), их расставляет редактор.
// Общая для игры (main.js) и редактора (_utils/editor/lab.js): оба зовут
// update(dt) каждый кадр — вращение частей моделей (def.anim). Свои объекты игра
// создаёт в location.view.scene и регистрирует World3D.addObject(location.view,
// mesh, 'actor' | 'prop'); ставить на землю — по location.terrain.heightAt(x, y).

class Location3D {
    // opts: { assetBase?: '' — игра (пути от index.html) | '/' — редактор (от корня сервера),
    //         objects?: записи LOCATION_OBJECTS }
    constructor(opts) {
        this.opts = opts || {};
        this.view = World3D.createView({});
        this.terrain = null;
        this.objects = [];   // { def, mesh, error, loaded } — см. addObject
        this._groundImage = null;
        this._groundIndex = -1;
        this.buildTerrain();
        const models = (this.opts.objects || []).map(def => this.addObject(def).loaded);
        // Готова — текстура земли и модели объектов пришли (или не нашлись) и шейдеры сцены собраны.
        this.ready = Promise.all([this.loadGround()].concat(models))
            .then(() => new Promise(resolve => this.view.scene.executeWhenReady(resolve)));
    }

    get width() { return Math.max(64, (typeof LOCATION_WIDTH !== 'undefined') ? LOCATION_WIDTH : 2048); }
    get height() { return Math.max(64, (typeof LOCATION_HEIGHT !== 'undefined') ? LOCATION_HEIGHT : 2048); }

    // (Пере)собрать землю по размерам локации и TERRAIN_* (редактор — живо).
    // Объекты локации встают на новую землю; свои объекты игры — забота владельца.
    buildTerrain() {
        if (this.terrain) this.terrain.dispose();
        this.terrain = new Terrain3D(this.view, {
            worldW: this.width,
            worldH: this.height,
            groundImage: this._groundImage
        });
        this.placeObjects();
        return this.terrain;
    }

    // --- Объекты локации ------------------------------------------------------------

    // Запись LOCATION_OBJECTS -> объект: { def, mesh, error, loaded }. Запись
    // возвращается сразу, меш появляется, когда модель догрузится (loaded —
    // промис). Нет файла — объект без меша (error), сцена не падает.
    // def: { name, model, kind, x, y, h, rot, scale, anim? } — поля живые: правка +
    // placeObject; anim читается каждый кадр (spinPart).
    addObject(def) {
        const rec = { def, mesh: null, error: null, loaded: null };
        this.objects.push(rec);
        rec.loaded = Model3D.load((this.opts.assetBase || '') + def.model).then((model) => {
            if (this.objects.indexOf(rec) < 0 || !this.view) return rec;   // сняли, пока грузилась
            rec.mesh = Model3D.build(model, this.view.scene, { name: def.name || 'object' });
            rec.mesh.metadata = { locationObject: rec };
            World3D.addObject(this.view, rec.mesh, def.kind);
            this.placeObject(rec);
            return rec;
        }).catch((e) => {
            rec.error = (e && e.message) || String(e);
            console.warn('Location3D: не загрузилась модель ' + def.model + ' — ' + rec.error);
            return rec;
        });
        return rec;
    }

    // Меш — по полям def: позиция на земле + h; rot — [x, y, z] градусы (y — курс по
    // карте, как heading: rotation.y = −y; x, z — наклон); scale — [x, y, z]. Старая
    // запись с числами (rot — только курс, scale — равномерный) тоже читается.
    placeObject(rec) {
        const m = rec.mesh, d = rec.def;
        if (!m) return;
        const x = Number(d.x) || 0, y = Number(d.y) || 0, D = Math.PI / 180;
        const r = Array.isArray(d.rot) ? d.rot : [0, d.rot, 0];
        const s = Array.isArray(d.scale) ? d.scale : [d.scale, d.scale, d.scale];
        const k = (v) => (Number(v) > 0 ? Number(v) : 1);
        m.position.set(x, (this.terrain ? this.terrain.heightAt(x, y) : 0) + (Number(d.h) || 0), y);
        m.rotationQuaternion = null;   // кватернион (его может поставить гизмо) перекрыл бы rotation
        m.rotation.set((Number(r[0]) || 0) * D, -(Number(r[1]) || 0) * D, (Number(r[2]) || 0) * D);
        m.scaling.set(k(s[0]), k(s[1]), k(s[2]));
    }

    placeObjects() {
        for (const rec of this.objects) this.placeObject(rec);
    }

    // Кадр анимации объектов — до World3D.renderFrame().
    update(dt) {
        dt = Math.min(0.1, Math.max(0, dt || 0));
        for (const rec of this.objects) this.spinPart(rec, dt);
    }

    // def.anim = { part, axis, speed, dir }: часть модели (объект FBX) вращается вокруг
    // своего центра (origin из Blender) по своей оси axis — 'x' | 'y' | 'z', с минусом —
    // обратный конец; speed — об/мин; dir — 'cw' | 'ccw', по/против часовой, если
    // смотреть с конца оси. Сняли анимацию или сменили часть — прежняя встаёт на место.
    spinPart(rec, dt) {
        const a = rec.def.anim;
        const name = a && rec.mesh ? String(a.part || '') : '';
        let s = rec.spin;
        if (s && (s.name !== name || s.root !== rec.mesh)) {
            if (s.mesh && !s.mesh.isDisposed()) {
                s.mesh.rotationQuaternion = null;
                s.mesh.setPivotPoint(BABYLON.Vector3.Zero());
            }
            s = rec.spin = null;
        }
        if (!name) return;
        if (!s) {
            const mesh = rec.mesh.getChildMeshes(true).find(m => m.metadata && m.metadata.part === name) || null;
            s = rec.spin = { name, root: rec.mesh, mesh, angle: 0, axis: new BABYLON.Vector3(), q: new BABYLON.Quaternion() };
            if (mesh) mesh.setPivotPoint(BABYLON.Vector3.FromArray(mesh.metadata.pivot));
        }
        if (!s.mesh) return;
        const axis = String(a.axis || 'y'), dirs = s.mesh.metadata.axes;
        const v = dirs[axis.slice(-1)] || dirs.y, sign = axis[0] === '-' ? -1 : 1;
        s.axis.set(v[0] * sign, v[1] * sign, v[2] * sign);
        // Сцена правосторонняя: положительный угол — против часовой с конца оси.
        const turn = Math.max(0, Number(a.speed) || 0) * Math.PI / 30 * (a.dir === 'ccw' ? 1 : -1);
        s.angle = (s.angle + turn * dt) % (2 * Math.PI);
        BABYLON.Quaternion.RotationAxisToRef(s.axis, s.angle, s.q);
        s.mesh.rotationQuaternion = s.q;
    }

    removeObject(rec) {
        const i = this.objects.indexOf(rec);
        if (i >= 0) this.objects.splice(i, 1);
        if (rec.mesh && this.view) Model3D.dispose(this.view, rec.mesh);
        rec.mesh = null;
    }

    // Текстура земли по LOCATION_GROUND. Пути — ЛИТЕРАЛАМИ в GROUNDS: сканер
    // сборщика (tools/asset-scan.mjs) находит ассеты только так. Нет файла —
    // земля остаётся ровного цвета, сцена не падает.
    loadGround() {
        const list = Location3D.GROUNDS;
        const n = (typeof LOCATION_GROUND !== 'undefined') ? LOCATION_GROUND : 0;
        const idx = Math.max(0, Math.min(list.length - 1, Math.round(n) || 0));
        if (idx === this._groundIndex && this._groundImage) return Promise.resolve(this._groundImage);
        this._groundIndex = idx;
        const url = (this.opts.assetBase || '') + list[idx];
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                if (this._groundIndex === idx) {
                    this._groundImage = img;
                    if (this.terrain) this.terrain.setGroundImage(img);
                }
                resolve(img);
            };
            img.onerror = () => {
                console.warn('Location3D: не загрузилась текстура земли ' + url);
                resolve(null);
            };
            img.src = url;
        });
    }

    applyRenderConstants() {
        World3D.applyRenderConstants(this.view);
    }

    dispose() {
        this.objects = [];   // меши и материалы умирают со сценой
        if (this.terrain) this.terrain.dispose();
        this.terrain = null;
        if (this.view) this.view.dispose();
        this.view = null;
    }
}

// Текстуры земли по LOCATION_GROUND: 0 — трава, 1 — песок, 2 — снег.
Location3D.GROUNDS = [
    'assets/ground_texture_g.jpg',
    'assets/ground_texture_d.jpg',
    'assets/ground_texture_s.jpg'
];
