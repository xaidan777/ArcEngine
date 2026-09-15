// CameraControl.js — камера 3D-мира: цель на карте + азимут + наклон + зум.
// Зум — экранных px на мировой px в точке взгляда; расстояние выводится из
// него: dist = H / (2·tan(fov/2)·zoom), H — высота канваса в CSS px. Один и
// тот же зум даёт один масштаб при любом FOV и размере окна.
//
// Режимы:
//   игровой (по умолчанию) — вращение ПКМ только при CAMERA_ORBIT = 1; наклон
//       в пределах CAMERA_ORBIT_PITCH_MIN/MAX_DEG и не такой, чтобы край земли
//       за локацией попал в кадр; цель не выходит за локацию; ЛКМ камере не
//       отдаётся — это ввод игры;
//   свободный (setFree) — редактор: ЛКМ тоже орбита (Shift+ЛКМ — панорама),
//       наклон, зум и цель без игровых пределов.
//
// Ввод (DOM, без движка): колесо — зум к курсору; средняя кнопка — панорама
// «за указателем» (точка земли остаётся под курсором); WASD и стрелки —
// панорама; ПКМ — орбита; палец — панорама, два пальца — щипок (зум и
// панорама серединой); R — исходное положение (home). Клавиши не
// перехватываются, пока фокус в поле ввода.
//
// Кадр: update(dt) из цикла владельца ПЕРЕД World3D.renderFrame().
// follow(obj) — слежение за объектом {x, y} (читается каждый кадр) с лерпом
// CAMERA_FOLLOW_LERP; ручная панорама слежение снимает.

class CameraController {
    // opts: { terrain?, bounds?: { w, h }, free? }
    constructor(view, opts) {
        const o = opts || {};
        this.view = view;
        this.cam = view.camera;
        this.terrain = o.terrain || null;
        this.bounds = o.bounds || null;
        this.free = !!o.free;
        this.target = { x: 0, y: 0, h: 0 };
        this.azimuth = 0;
        this.pitch = 1;
        this.zoom = 1;
        this.zoomTarget = 1;
        this.followObj = null;
        this.ignorePointer = null;     // (e) => true — нажатие не для камеры (редактор: гизмо под курсором)
        this.viewVersion = 0;          // растёт при каждом сдвиге камеры (перепроецировать оверлеи)
        this._lastCam = null;
        this._pointers = new Map();    // pointerId -> { x, y, mode: 'pan' | 'orbit' | 'touch', anchor }
        this._pinch = null;
        this._keys = new Set();
        this._zoomAnchor = null;       // зум к курсору: { px, py, x, y, h } — точка земли под курсором
        this._shakeUntil = 0;
        this._shakeAmp = 0;
        this._canvas = null;
        this._bound = null;
        this.applyConstants();
        this.home();
    }

    // Константы камеры с дефолтами. В игре это лексические const — только typeof.
    static cfg() {
        const U = 'undefined';
        return {
            fov: typeof CAMERA_FOV_DEG !== U ? CAMERA_FOV_DEG : 52,
            azimuth: typeof CAMERA_AZIMUTH_DEG !== U ? CAMERA_AZIMUTH_DEG : -90,
            pitch: typeof CAMERA_PITCH_DEG !== U ? CAMERA_PITCH_DEG : 57,
            zoom: typeof CAMERA_ZOOM !== U ? CAMERA_ZOOM : 1,
            zoomMobile: typeof CAMERA_ZOOM_MOBILE !== U ? CAMERA_ZOOM_MOBILE : 0.7,
            zoomMin: typeof CAMERA_ZOOM_MIN !== U ? CAMERA_ZOOM_MIN : 0.5,
            zoomMax: typeof CAMERA_ZOOM_MAX !== U ? CAMERA_ZOOM_MAX : 3,
            wheelStep: typeof CAMERA_ZOOM_WHEEL_STEP !== U ? CAMERA_ZOOM_WHEEL_STEP : 0.12,
            zoomLerp: typeof CAMERA_ZOOM_LERP !== U ? CAMERA_ZOOM_LERP : 0.18,
            followLerp: typeof CAMERA_FOLLOW_LERP !== U ? CAMERA_FOLLOW_LERP : 0.05,
            panKeySpeed: typeof CAMERA_PAN_KEY_SPEED !== U ? CAMERA_PAN_KEY_SPEED : 900,
            orbit: typeof CAMERA_ORBIT !== U ? CAMERA_ORBIT : 1,
            orbitDegPerPx: typeof CAMERA_ORBIT_DEG_PER_PX !== U ? CAMERA_ORBIT_DEG_PER_PX : 0.3,
            pitchMin: typeof CAMERA_ORBIT_PITCH_MIN_DEG !== U ? CAMERA_ORBIT_PITCH_MIN_DEG : 35,
            pitchMax: typeof CAMERA_ORBIT_PITCH_MAX_DEG !== U ? CAMERA_ORBIT_PITCH_MAX_DEG : 88
        };
    }

    // Перечитать константы (редактор — живо). FOV и пределы действуют сразу;
    // ориентация и стартовый зум — при home().
    applyConstants() {
        this.c = CameraController.cfg();
        this.cam.fov = Math.max(10, Math.min(120, this.c.fov)) * Math.PI / 180;
        this.zoomTarget = this._clampZoom(this.zoomTarget);
        this.zoom = this._clampZoom(this.zoom);
        this.pitch = this._clampPitch(this.pitch);
    }

    // Исходное положение: ориентация и зум из констант, цель — объект слежения
    // или центр локации.
    home() {
        const c = this.c, D = Math.PI / 180;
        const small = IS_MOBILE && Math.max(window.innerWidth || 0, window.innerHeight || 0) < 1024;
        this.zoomTarget = this._clampZoom(small ? c.zoomMobile : c.zoom);
        this.zoom = this.zoomTarget;
        this._zoomAnchor = null;
        this.azimuth = c.azimuth * D;
        const f = this.followObj;
        this.lookAt(f ? f.x : (this.bounds ? this.bounds.w / 2 : 0), f ? f.y : (this.bounds ? this.bounds.h / 2 : 0));
        this.pitch = this._clampPitch(c.pitch * D);
        this._apply();
    }

    lookAt(x, y) {
        this.target.x = x;
        this.target.y = y;
        this._clampTarget();
        this.target.h = this._groundH(this.target.x, this.target.y);
    }

    follow(obj) { this.followObj = obj || null; }

    setFree(on) {
        this.free = !!on;
        this.zoomTarget = this._clampZoom(this.zoomTarget);
        this.zoom = this._clampZoom(this.zoom);
        this._clampTarget();
        this.pitch = this._clampPitch(this.pitch);
    }

    // Локация пересобрана (редактор): новый террейн и размеры.
    setTerrain(terrain, bounds) {
        this.terrain = terrain || null;
        if (bounds) this.bounds = bounds;
        this._clampTarget();
        this.target.h = this._groundH(this.target.x, this.target.y);
    }

    // --- Экран <-> мир ------------------------------------------------------------

    distance() {
        const h = (this.view.world.canvas && this.view.world.canvas.clientHeight) || 600;
        return h / (2 * Math.tan(this.cam.fov / 2) * Math.max(0.02, this.zoom));
    }

    // Мировых px на экранный px в точке взгляда.
    worldPerScreenPx() {
        return 1 / Math.max(0.02, this.zoom);
    }

    // Экранный сдвиг (dx вправо, dy вниз) -> сдвиг по карте с учётом азимута.
    // Вперёд по взгляду = (cos az, sin az); вправо на экране в правосторонней
    // сцене — (−sin az, cos az). При азимуте −90° (север вверх) это (dx, dy) / zoom.
    screenDeltaToWorld(dx, dy) {
        const k = this.worldPerScreenPx();
        const ca = Math.cos(this.azimuth), sa = Math.sin(this.azimuth);
        return { x: (-sa * dx - ca * dy) * k, y: (ca * dx - sa * dy) * k };
    }

    // Обратное: сдвиг по карте -> экранные px.
    worldDeltaToScreen(wx, wy) {
        const k = this.worldPerScreenPx();
        const ca = Math.cos(this.azimuth), sa = Math.sin(this.azimuth);
        return { x: (-sa * wx + ca * wy) / k, y: -(ca * wx + sa * wy) / k };
    }

    // Тряска: intensity — доля кадра (0.01 — лёгкая), переводится в мировые px.
    shake(ms, intensity) {
        const amp = Math.min(40, (intensity || 0.01) * 600);
        this._shakeAmp = Math.max(this._shakeAmp * (this._shakeUntil > performance.now() ? 1 : 0), amp);
        this._shakeUntil = performance.now() + (ms || 200);
    }

    // --- Пределы ------------------------------------------------------------------

    _clampZoom(z) {
        const c = this.c;
        const lo = this.free ? Math.min(c.zoomMin, 0.12) : c.zoomMin;
        const hi = Math.max(lo, this.free ? Math.max(c.zoomMax, 6) : c.zoomMax);
        return Math.max(lo, Math.min(hi, Number.isFinite(z) ? z : 1));
    }

    _clampTarget() {
        if (this.free || !this.bounds) return;
        this.target.x = Math.max(0, Math.min(this.bounds.w, this.target.x));
        this.target.y = Math.max(0, Math.min(this.bounds.h, this.target.y));
    }

    _clampPitch(p) {
        const D = Math.PI / 180;
        if (this.free) return Math.max(8 * D, Math.min(88 * D, p));   // у 90° вырождается setTarget
        const top = Math.max(1, Math.min(89, this.c.pitchMax)) * D;
        const floor = Math.min(top, Math.max(1, this.c.pitchMin) * D);
        return Math.max(this._edgePitchMin(floor, top), Math.min(top, p));
    }

    // Нижний предел наклона игровой камеры: дальние (верхние) углы кадра ложатся
    // на землю ближе края кольца за локацией (Terrain3D.outerRing) — обрыв земли
    // и небо под ним не видны. Цель внутри локации, значит до края кольца от неё
    // не меньше его ширины в любую сторону. Луч угла кадра пересекается с
    // плоскостью самого низкого рельефа; дальность монотонно падает с ростом
    // наклона — бисекция. Зум меняет дистанцию, поэтому предел живой.
    _edgePitchMin(floor, top) {
        const t = this.terrain;
        if (!t || !(t.outerRing > 0)) return floor;
        const reach = t.outerRing * 0.85;   // запас: кольцо грубое, рельеф вдали выше/ниже
        const dist = this.distance();
        const drop = Math.max(0, this.target.h - (Number.isFinite(t.hMin) ? t.hMin : 0));
        const tV = Math.tan(this.cam.fov / 2);
        const tH = tV * this.view.engine.getAspectRatio(this.cam);
        const far = (p) => {
            const sp = Math.sin(p), cp = Math.cos(p);
            const fall = sp - tV * cp;          // спуск луча верхнего угла кадра
            if (fall <= 1e-4) return Infinity;  // луч в горизонт — в кадре небо
            const s = (dist * sp + drop) / fall;
            return Math.hypot(s * (cp + tV * sp) - dist * cp, s * tH);
        };
        if (far(floor) <= reach) return floor;
        if (far(top) > reach) return top;
        let lo = floor, hi = top;
        for (let i = 0; i < 16; i++) {
            const mid = (lo + hi) / 2;
            if (far(mid) > reach) lo = mid; else hi = mid;
        }
        return hi;
    }

    _groundH(x, y) {
        return this.terrain ? this.terrain.heightAt(x, y) : 0;
    }

    // --- Ввод -----------------------------------------------------------------------

    attach(canvas) {
        this.detach();
        this._canvas = canvas;
        const b = this._bound = {
            down: (e) => this._onDown(e),
            move: (e) => this._onMove(e),
            up: (e) => this._onUp(e),
            wheel: (e) => this._onWheel(e),
            menu: (e) => e.preventDefault(),
            key: (e) => this._onKey(e, true),
            keyUp: (e) => this._onKey(e, false),
            blur: () => this._keys.clear()
        };
        canvas.addEventListener('pointerdown', b.down);
        canvas.addEventListener('pointermove', b.move);
        canvas.addEventListener('pointerup', b.up);
        canvas.addEventListener('pointercancel', b.up);
        canvas.addEventListener('wheel', b.wheel, { passive: false });
        canvas.addEventListener('contextmenu', b.menu);
        window.addEventListener('keydown', b.key);
        window.addEventListener('keyup', b.keyUp);
        window.addEventListener('blur', b.blur);
        canvas.style.touchAction = 'none';
    }

    detach() {
        const c = this._canvas, b = this._bound;
        if (c && b) {
            c.removeEventListener('pointerdown', b.down);
            c.removeEventListener('pointermove', b.move);
            c.removeEventListener('pointerup', b.up);
            c.removeEventListener('pointercancel', b.up);
            c.removeEventListener('wheel', b.wheel);
            c.removeEventListener('contextmenu', b.menu);
            window.removeEventListener('keydown', b.key);
            window.removeEventListener('keyup', b.keyUp);
            window.removeEventListener('blur', b.blur);
        }
        this._canvas = null;
        this._bound = null;
        this._pointers.clear();
        this._pinch = null;
        this._keys.clear();
    }

    isDragging() { return this._pointers.size > 0; }

    _local(e) {
        const r = this._canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // Точка земли под экранной точкой (по рельефу) — якорь панорамы и зума.
    _pick(px, py) {
        this._syncCamera();
        this.view.refreshMatrices();
        const hit = this.view.pointerToGround(px, py, this.target.h, this.terrain);
        return hit ? { x: hit.x, y: hit.y, h: this._groundH(hit.x, hit.y) } : null;
    }

    // Сдвинуть цель так, чтобы точка земли anchor оказалась под экранной точкой.
    // Пересечение — с плоскостью высоты якоря: иначе точка скакала бы по склонам.
    // Два прохода: сдвиг цели меняет высоту земли под ней, а с ней и камеру —
    // один проход на рывке в сотню px оставлял ошибку в несколько px.
    _dragTo(anchor, px, py) {
        for (let pass = 0; pass < 2; pass++) {
            this._syncCamera();
            this.view.refreshMatrices();
            const hit = this.view.pointerToGround(px, py, anchor.h, null);
            if (!hit) return;
            this.target.x += anchor.x - hit.x;
            this.target.y += anchor.y - hit.y;
            this._clampTarget();
            this.target.h = this._groundH(this.target.x, this.target.y);
        }
    }

    _onDown(e) {
        if (this.ignorePointer && this.ignorePointer(e)) return;
        let mode = null;
        if (e.pointerType === 'touch') mode = 'touch';
        else if (e.button === 1 || (e.button === 0 && this.free && e.shiftKey)) mode = 'pan';
        else if ((e.button === 2 && (this.free || this.c.orbit > 0)) || (e.button === 0 && this.free)) mode = 'orbit';
        if (!mode) return;
        e.preventDefault();
        try { this._canvas.setPointerCapture(e.pointerId); } catch (err) { /* синтетическое событие */ }
        const p = this._local(e);
        const rec = { x: p.x, y: p.y, mode: mode, anchor: null };
        if (mode !== 'orbit') {
            rec.anchor = this._pick(p.x, p.y);
            this.followObj = null;
        }
        this._pointers.set(e.pointerId, rec);
        this._zoomAnchor = null;
        if (mode === 'touch' && this._touches().length === 2) this._startPinch();
    }

    _onMove(e) {
        const rec = this._pointers.get(e.pointerId);
        if (!rec) return;
        const p = this._local(e);
        if (rec.mode === 'orbit') {
            const k = this.c.orbitDegPerPx * Math.PI / 180;
            this.azimuth += (p.x - rec.x) * k;
            this.pitch = this._clampPitch(this.pitch + (p.y - rec.y) * k);
        } else if (this._pinch && rec.mode === 'touch') {
            rec.x = p.x;
            rec.y = p.y;
            this._applyPinch();
        } else if (rec.anchor) {
            this._dragTo(rec.anchor, p.x, p.y);
        }
        rec.x = p.x;
        rec.y = p.y;
        this._apply();
    }

    _onUp(e) {
        if (!this._pointers.delete(e.pointerId)) return;
        if (this._pinch && this._touches().length < 2) {
            this._pinch = null;
            // Оставшийся палец продолжает панораму от своей текущей точки.
            for (const rec of this._touches()) rec.anchor = this._pick(rec.x, rec.y);
        }
    }

    _touches() {
        return [...this._pointers.values()].filter(r => r.mode === 'touch');
    }

    _startPinch() {
        const [a, b] = this._touches();
        this._pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), anchor: this._pick((a.x + b.x) / 2, (a.y + b.y) / 2) };
    }

    // Щипок: расстояние между пальцами — зум (сразу, без лерпа), середина — панорама.
    _applyPinch() {
        const [a, b] = this._touches();
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinch.dist > 1 && d > 1) {
            this.zoomTarget = this._clampZoom(this.zoomTarget * d / this._pinch.dist);
            this.zoom = this.zoomTarget;
        }
        this._pinch.dist = d;
        if (this._pinch.anchor) this._dragTo(this._pinch.anchor, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }

    // Колесо: зум к курсору. Точка земли под курсором запоминается и держится под
    // ним, пока зум доезжает лерпом (update). При слежении — зум вокруг цели.
    _onWheel(e) {
        e.preventDefault();
        if (!e.deltaY) return;
        const notches = Math.max(-1, Math.min(1, e.deltaY / 100));   // мышь ~100 за щелчок, тачпад — мелко
        this.zoomTarget = this._clampZoom(this.zoomTarget * Math.pow(1 + this.c.wheelStep, -notches));
        if (this.followObj) { this._zoomAnchor = null; return; }
        const p = this._local(e);
        const hit = this._pick(p.x, p.y);
        this._zoomAnchor = hit ? { px: p.x, py: p.y, x: hit.x, y: hit.y, h: hit.h } : null;
    }

    _onKey(e, down) {
        const t = e.target;
        if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (CameraController.PAN_KEYS[e.code]) {
            if (down) this._keys.add(e.code); else this._keys.delete(e.code);
            e.preventDefault();
            return;
        }
        if (down && e.code === 'KeyR' && !e.repeat) this.home();
    }

    // --- Кадр -----------------------------------------------------------------------

    update(dt) {
        dt = Math.min(0.1, Math.max(0, dt || 0));
        const c = this.c, f60 = dt * 60;

        if (this._keys.size) {
            const k = this._keys, P = CameraController.PAN_KEYS;
            let dx = 0, dy = 0;
            for (const code of k) { dx += P[code][0]; dy += P[code][1]; }
            if (dx || dy) {
                const len = Math.hypot(dx, dy), step = c.panKeySpeed * dt;
                const w = this.screenDeltaToWorld(dx / len * step, dy / len * step);
                this.target.x += w.x;
                this.target.y += w.y;
                this._clampTarget();
                this.followObj = null;
                this._zoomAnchor = null;
            }
        }

        if (Math.abs(this.zoom - this.zoomTarget) > 1e-4) {
            this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.pow(1 - c.zoomLerp, f60));
        } else {
            this.zoom = this.zoomTarget;
        }

        const f = this.followObj;
        if (f) {
            const k = 1 - Math.pow(1 - c.followLerp, f60);
            this.target.x += (f.x - this.target.x) * k;
            this.target.y += (f.y - this.target.y) * k;
            this._clampTarget();
        }
        this.target.h = this._groundH(this.target.x, this.target.y);
        this.pitch = this._clampPitch(this.pitch);   // зум меняет дальность кадра — и предел наклона

        const a = this._zoomAnchor;
        if (a) {
            this._dragTo(a, a.px, a.py);
            if (this.zoom === this.zoomTarget) this._zoomAnchor = null;
        }
        this._apply();
    }

    // Позиция и цель камеры Babylon: от цели назад по азимуту на дистанцию из
    // зума, под углом pitch к земле, не ниже земли + 40.
    _syncCamera() {
        const dist = this.distance();
        const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
        const px = this.target.x - Math.cos(this.azimuth) * cp * dist;
        const pz = this.target.y - Math.sin(this.azimuth) * cp * dist;
        let py = this.target.h + sp * dist;
        const ground = this._groundH(px, pz);
        if (py < ground + 40) py = ground + 40;
        let sx = 0, sy = 0, sh = 0;
        const now = performance.now();
        if (this._shakeUntil > now) {
            const amp = this._shakeAmp * Math.min(1, (this._shakeUntil - now) / 200);
            sx = (Math.random() * 2 - 1) * amp;
            sy = (Math.random() * 2 - 1) * amp;
            sh = (Math.random() * 2 - 1) * amp * 0.5;
        } else {
            this._shakeAmp = 0;
        }
        this.cam.position.set(px + sx, py + sh, pz + sy);
        this.cam.setTarget(new BABYLON.Vector3(this.target.x + sx, this.target.h + sh, this.target.y + sy));
    }

    _apply() {
        this._syncCamera();
        // Кадр теней — по объектам в пределах видимой области: чем он теснее, тем чётче тень.
        const cv = this.view.world.canvas;
        const halfDiag = 0.5 * Math.hypot((cv && cv.clientWidth) || 800, (cv && cv.clientHeight) || 600) * this.worldPerScreenPx();
        this.view.fitShadowFrustum(this.target.x, this.target.y, this.target.h, halfDiag + 80);
        const p = this.cam.position, t = this.target, lc = this._lastCam;
        if (!lc || Math.abs(lc[0] - p.x) > 0.02 || Math.abs(lc[1] - p.y) > 0.02 || Math.abs(lc[2] - p.z) > 0.02 ||
            Math.abs(lc[3] - t.x) > 0.02 || Math.abs(lc[4] - t.y) > 0.02 || Math.abs(lc[5] - t.h) > 0.02) {
            this.viewVersion++;
            this._lastCam = [p.x, p.y, p.z, t.x, t.y, t.h];
        }
    }
}

// Клавиши панорамы: код клавиши -> экранное направление [dx, dy].
CameraController.PAN_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0]
};
