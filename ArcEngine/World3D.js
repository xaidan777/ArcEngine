// World3D.js — 3D-движок набора: Babylon на канвасе, вид сцены (View3D: камера,
// свет, тени, проекции экран <-> мир), константы рендера (cfg), toon-шейдер
// (ArcToonPlugin), контур рёбер и обводка силуэта, регистрация объектов мира.
//
// Координаты: карта (x вправо, y вниз, px) -> Babylon (X = x, Z = y,
// Y = высота). Сцена ПРАВОСТОРОННЯЯ (useRightHandedSystem): при виде сверху с
// севером (−y) вверху восток (+x) справа; в левосторонней тот же мир выходил
// зеркальным. Курс heading (рад, atan2(vy, vx)) -> rotation.y = -heading.
// «Вправо на экране» при азимуте камеры az — (−sin az, cos az).
//
// Кадр рисует владелец цикла: World3D.renderFrame() из своего
// requestAnimationFrame (main.js игры, lab.js редактора), после camera.update().
//
// Свет один на весь мир: азимут WORLD3D_SUN_AZIMUTH_DEG задаёт, КУДА падает
// тень, высота солнца — WORLD3D_SUN_ELEVATION_DEG. Тени настоящие
// (ShadowGenerator, ортокадр солнца ездит за камерой).
//
// ТЕНИ — ОДИН ЦВЕТ НА ВСЁ. Babylon даёт только видимость солнца (darkness
// генератора = 0); красит тень плагин ArcToonPlugin (define ARCSHADOW): свет
// поверхности в тени = свет без тени × mix(1, WORLD3D_SHADOW_COLOR,
// WORLD3D_SHADOW_STRENGTH). Свет без тени восстанавливается из суммы (солнце
// — ПОСЛЕДНИЙ свет сцены: hemi создаётся первым, `shadow` шейдера после
// цикла света — его; направление и цвет солнца — uniform'ы плагина из
// scene.metadata.arcSun).
//
// КОНСТАНТЫ РЕНДЕРА читает одно место — World3D.cfg() (в игре это лексические
// const, отсюда typeof-проверки). applyRenderConstants(view) применяет их к
// живой сцене без пересборки: свет, небо, туман и тени (View3D.applyLighting),
// материалы по группам (metadata.toonGroup: 'ground' | 'prop' | 'actor'),
// toon (uniform'ы — сразу, вкл/выкл — пересборка шейдеров), контур и обводка.
//
// ОБЪЕКТЫ МИРА регистрирует addObject(view, mesh, kind): группа материалов,
// тень, контур рёбер и обводка. kind: 'actor' — главные объекты кадра
// (персонажи, машины), 'prop' — окружение (кубы, стены, деревья).
//
// Toon-шейдер — ArcToonPlugin (BABYLON.MaterialPluginBase, регистрируется на
// ВСЕ StandardMaterial при World3D.init): после суммирования света всех
// источников яркость diffuseBase квантуется в WORLD3D_TOON_BANDS ступеней
// между WORLD3D_TOON_LOW и 1, блик — порогом, по краю силуэта — ободок.
// Точка врезки — строка `aggShadow=aggShadow/numLights;` шейдера
// default.fragment (регулярка в getCustomCode; если строки нет — код не
// врезается и шейдер не ломается, просто нет ступеней). Unlit-материалы
// (disableLighting) плагин не трогает.

const World3D = {
    engine: null,
    canvas: null,
    view: null,             // активный View3D (его рисует renderFrame)
    _bg: null,

    // Слои рендера (renderingGroupId Babylon), буфер глубины ОБЩИЙ (см. View3D):
    //   WORLD   — земля и всё, что на ней стоит;
    //   OVERLAY — метки поверх мира (выделение, пути): их материалам ставят
    //             depthFunction = ALWAYS и disableDepthWrite — рельеф их не режет,
    //             а глубина мира остаётся целой;
    //   ACTOR   — объекты, которые идут последними: краска OVERLAY не ложится на
    //             них сверху, но за стенами они прячутся честно.
    LAYER: { WORLD: 0, OVERLAY: 1, ACTOR: 2 },

    available() {
        return typeof BABYLON !== 'undefined' && !!this.engine;
    },

    // Поднимает движок на канвасе (один на страницу). false — нет Babylon или WebGL.
    init(canvas) {
        if (typeof BABYLON === 'undefined') {
            console.warn('World3D: libs/babylon.js не загружен — 3D-мир недоступен.');
            return false;
        }
        if (this.engine) return true;
        this.canvas = canvas;
        try {
            this.engine = new BABYLON.Engine(canvas, true, {
                preserveDrawingBuffer: false,
                stencil: true,     // нужен HighlightLayer обводки силуэта (needStencil)
                antialias: true,
                adaptToDeviceRatio: false,
                powerPreference: 'high-performance',
                doNotHandleContextLost: true
            }, false);
        } catch (e) {
            console.error('World3D: WebGL недоступен', e);
            this.engine = null;
            return false;
        }
        // Чёткость на HiDPI: рендерим в физические пиксели (на мобильных —
        // не дороже 1.5x, иначе заливка съедает кадр).
        const dpr = window.devicePixelRatio || 1;
        const cap = IS_MOBILE ? 1.5 : 2;
        this.engine.setHardwareScalingLevel(1 / Math.min(dpr, cap));
        this._bg = new BABYLON.Color4(0.133, 0.133, 0.133, 1);
        // Toon-плагин вешается на материалы при их СОЗДАНИИ — регистрировать
        // до первой сцены.
        this.toon.register();
        this.resize();
        return true;
    },

    resize() {
        if (this.engine) this.engine.resize();
    },

    renderFrame() {
        const e = this.engine;
        if (!e) return;
        const v = this.view;
        if (v && v.active && v.scene && v.scene.activeCamera) {
            v.beforeRender();
            this.outlineFog(v);
            v.scene.render();
        } else {
            e.clear(this._bg, true, true, true);
        }
    },

    createView(opts) {
        if (!this.available()) return null;
        return new View3D(this, opts || {});
    },

    // --- Константы рендера ----------------------------------------------------

    // Все константы рендера с дефолтами (Constants.js может быть старше кода).
    // В игре константы — лексические const: их нельзя прочитать по имени через
    // window, только typeof по идентификатору.
    cfg() {
        const U = 'undefined';
        return {
            sunAz: typeof WORLD3D_SUN_AZIMUTH_DEG !== U ? WORLD3D_SUN_AZIMUTH_DEG : 53,
            sunEl: typeof WORLD3D_SUN_ELEVATION_DEG !== U ? WORLD3D_SUN_ELEVATION_DEG : 48,
            sunIntensity: typeof WORLD3D_SUN_INTENSITY !== U ? WORLD3D_SUN_INTENSITY : 0.8,
            sunColor: typeof WORLD3D_SUN_COLOR !== U ? WORLD3D_SUN_COLOR : 0xfff7e6,
            skyIntensity: typeof WORLD3D_SKYLIGHT_INTENSITY !== U ? WORLD3D_SKYLIGHT_INTENSITY : 0.45,
            skyLight: typeof WORLD3D_SKYLIGHT_COLOR !== U ? WORLD3D_SKYLIGHT_COLOR : 0xf2f7ff,
            groundLight: typeof WORLD3D_GROUNDLIGHT_COLOR !== U ? WORLD3D_GROUNDLIGHT_COLOR : 0x4f6b52,
            sky: typeof WORLD3D_SKY_COLOR !== U ? WORLD3D_SKY_COLOR : 0x8fc3e0,
            fog: typeof WORLD3D_FOG_DENSITY !== U ? WORLD3D_FOG_DENSITY : 0.00032,
            shadowMap: typeof WORLD3D_SHADOW_MAP !== U ? WORLD3D_SHADOW_MAP : 2048,
            shadowColor: typeof WORLD3D_SHADOW_COLOR !== U ? WORLD3D_SHADOW_COLOR : 0x012d3c,
            shadowStrength: typeof WORLD3D_SHADOW_STRENGTH !== U ? WORLD3D_SHADOW_STRENGTH : 0.36,
            shadowSoft: typeof WORLD3D_SHADOW_SOFT !== U ? WORLD3D_SHADOW_SOFT : 2,
            shadowRadius: typeof WORLD3D_SHADOW_RADIUS !== U ? WORLD3D_SHADOW_RADIUS : 720,
            shadowBias: typeof WORLD3D_SHADOW_BIAS !== U ? WORLD3D_SHADOW_BIAS : 0.0005,
            shadowNormalBias: typeof WORLD3D_SHADOW_NORMAL_BIAS !== U ? WORLD3D_SHADOW_NORMAL_BIAS : 0.8,
            groundSpecular: typeof WORLD3D_GROUND_SPECULAR !== U ? WORLD3D_GROUND_SPECULAR : 0.04,
            groundSpecPower: typeof WORLD3D_GROUND_SPEC_POWER !== U ? WORLD3D_GROUND_SPEC_POWER : 24,
            outerTint: typeof WORLD3D_OUTER_TINT !== U ? WORLD3D_OUTER_TINT : 1,
            propSpecular: typeof WORLD3D_PROP_SPECULAR !== U ? WORLD3D_PROP_SPECULAR : 0.05,
            propSpecPower: typeof WORLD3D_PROP_SPEC_POWER !== U ? WORLD3D_PROP_SPEC_POWER : 32,
            actorSpecular: typeof WORLD3D_ACTOR_SPECULAR !== U ? WORLD3D_ACTOR_SPECULAR : 0.22,
            actorSpecPower: typeof WORLD3D_ACTOR_SPEC_POWER !== U ? WORLD3D_ACTOR_SPEC_POWER : 28,
            toon: typeof WORLD3D_TOON !== U ? WORLD3D_TOON : 1,
            toonBands: typeof WORLD3D_TOON_BANDS !== U ? WORLD3D_TOON_BANDS : 3,
            toonSoft: typeof WORLD3D_TOON_SOFT !== U ? WORLD3D_TOON_SOFT : 0.06,
            toonLow: typeof WORLD3D_TOON_LOW !== U ? WORLD3D_TOON_LOW : 0.35,
            toonGround: typeof WORLD3D_TOON_GROUND !== U ? WORLD3D_TOON_GROUND : 1,
            toonSpec: typeof WORLD3D_TOON_SPEC !== U ? WORLD3D_TOON_SPEC : 1,
            toonSpecSize: typeof WORLD3D_TOON_SPEC_SIZE !== U ? WORLD3D_TOON_SPEC_SIZE : 0.12,
            toonRim: typeof WORLD3D_TOON_RIM !== U ? WORLD3D_TOON_RIM : 0.25,
            toonRimWidth: typeof WORLD3D_TOON_RIM_WIDTH !== U ? WORLD3D_TOON_RIM_WIDTH : 0.35,
            outline: typeof WORLD3D_TOON_OUTLINE !== U ? WORLD3D_TOON_OUTLINE : 2,
            outlineActorWidth: typeof WORLD3D_TOON_OUTLINE_ACTOR_WIDTH !== U ? WORLD3D_TOON_OUTLINE_ACTOR_WIDTH : 2,
            outlinePropWidth: typeof WORLD3D_TOON_OUTLINE_PROP_WIDTH !== U ? WORLD3D_TOON_OUTLINE_PROP_WIDTH : 0.5,
            ink: typeof WORLD3D_TOON_INK !== U ? WORLD3D_TOON_INK : 2,
            inkWidth: typeof WORLD3D_TOON_INK_WIDTH !== U ? WORLD3D_TOON_INK_WIDTH : 100,
            inkColor: typeof WORLD3D_TOON_INK_COLOR !== U ? WORLD3D_TOON_INK_COLOR : 0x10141a,
            inkAngle: typeof WORLD3D_TOON_INK_ANGLE !== U ? WORLD3D_TOON_INK_ANGLE : 40
        };
    },

    // Живое применение констант рендера к сцене вида (редактор): свет, тени,
    // небо, материалы по группам, toon, контуры. Ничего не пересобирает.
    applyRenderConstants(view) {
        if (!view || !view.scene) return;
        const c = this.cfg();
        view.applyLighting(c);
        this.toon.apply(c);
        for (const m of view.scene.materials) this.applyMaterialConstants(m, c);
        this.applyInk(view.scene, c);
        this.applyOutlines(view, c);
        view.scene.resetCachedMaterial();
    },

    // Блик материала по группе (metadata.toonGroup): земля, окружение, главные
    // объекты. Кольцо земли за краем (metadata.outer) — ещё и яркость WORLD3D_OUTER_TINT.
    applyMaterialConstants(m, c) {
        const g = m && m.metadata && m.metadata.toonGroup;
        if (!g || !(m instanceof BABYLON.StandardMaterial)) return;
        c = c || this.cfg();
        let spec = 0, power = m.specularPower;
        if (g === 'ground') { spec = c.groundSpecular; power = c.groundSpecPower; }
        else if (g === 'prop') { spec = c.propSpecular; power = c.propSpecPower; }
        else if (g === 'actor') { spec = c.actorSpecular; power = c.actorSpecPower; }
        m.specularColor = new BABYLON.Color3(spec, spec, spec);
        m.specularPower = Math.max(1, power);
        if (m.metadata.outer) {
            const t = Math.max(0, c.outerTint);
            m.diffuseColor = new BABYLON.Color3(t, t, t);
        }
    },

    // --- Объекты мира ------------------------------------------------------------

    // Регистрация объекта: материалы (и дочерних мешей) — в группу kind (блик из
    // констант, toon), корень — в карту теней, рёбра — в контур, силуэт — в
    // обводку. Корень и дети получают СВОЙ metadata: clone() копирует его по
    // ссылке, и контур/обводка клонов писали бы в общий объект.
    // kind: 'actor' | 'prop'. opts: { castShadow, receiveShadows, ink, outline } — по умолчанию все true.
    addObject(view, mesh, kind, opts) {
        if (!view || !mesh) return mesh;
        const o = opts || {};
        const k = kind === 'prop' ? 'prop' : 'actor';
        const c = this.cfg();
        const parts = [mesh].concat(mesh.getChildMeshes ? mesh.getChildMeshes(false) : []);
        for (const m of parts) {
            m.metadata = Object.assign({}, m.metadata);
            m.receiveShadows = o.receiveShadows !== false;
            const mat = m.material;
            const mats = mat ? (mat.subMaterials || [mat]) : [];
            for (const sm of mats) {
                if (!sm) continue;
                sm.metadata = Object.assign({ toonGroup: k }, sm.metadata);
                this.applyMaterialConstants(sm, c);
            }
            const solid = m.getTotalVertices && m.getTotalVertices() > 0;
            if (solid && o.ink !== false) this.inkMesh(m, k, c);
            // Все части — в ОДИН слой обводки: линия идёт по общему силуэту, а не по детали.
            if (solid && o.outline !== false) this.outlineAdd(view, m, k, c);
        }
        if (o.castShadow !== false) view.addShadowCaster(mesh, true);
        return mesh;
    },

    // Снять объект: обводка, тени, меш с детьми. Материалы остаются владельцу.
    removeObject(view, mesh) {
        if (!mesh) return;
        const parts = [mesh].concat(mesh.getChildMeshes ? mesh.getChildMeshes(false) : []);
        for (const m of parts) this.outlineRemove(view, m);
        if (view) view.removeShadowCaster(mesh);
        mesh.dispose(false, false);
    },

    // --- Контур чернилами (EdgesRenderer) --------------------------------------

    // Рёбра меша, изломанные круче WORLD3D_TOON_INK_ANGLE, рисуются линиями цвета
    // чернил. group: 'actor' (уровень 1) | 'prop' (уровень 2). Цена: ~5 мс на
    // меш в 1300 треугольников, один раз.
    inkMesh(mesh, group, c) {
        if (!mesh || !mesh.enableEdgesRendering) return;
        c = c || this.cfg();
        const md = mesh.metadata || (mesh.metadata = {});
        md.ink = group;
        const want = c.ink >= (group === 'prop' ? 2 : 1) && c.inkWidth > 0;
        if (!want) {
            if (mesh.edgesRenderer) mesh.disableEdgesRendering();
            md.inkEps = null;
            return;
        }
        const eps = Math.cos(Math.max(1, Math.min(89, c.inkAngle)) * Math.PI / 180);
        if (!mesh.edgesRenderer || md.inkEps !== eps) {
            // checkVerticesInsteadOfIndices: у lowpoly с плоским затенением
            // треугольники разъединены, смежность ищется по координатам вершин.
            mesh.enableEdgesRendering(eps, true);
            md.inkEps = eps;
        }
        mesh.edgesWidth = c.inkWidth;
        const col = this.hexColor3(c.inkColor);
        mesh.edgesColor = new BABYLON.Color4(col.r, col.g, col.b, 1);
        if (group === 'prop') mesh.edgesShareWithInstances = true;
    },

    applyInk(scene, c) {
        c = c || this.cfg();
        for (const m of scene.meshes) {
            if (m.metadata && m.metadata.ink && !m.isAnInstance) this.inkMesh(m, m.metadata.ink, c);
        }
    },

    // --- Обводка силуэта: постэффект по маске -----------------------------------
    //
    // «Stroke как в фотошопе»: объекты рисуются в отдельную МАСКУ (RTT), она
    // расширяется и накладывается на кадр цветом чернил. Линия идёт по ВНЕШНЕЙ
    // границе силуэта и ОДНА на объект целиком. Толщина — в экранных пикселях,
    // от расстояния до камеры не зависит. Своего шейдера нет: штатный
    // BABYLON.HighlightLayer с isStroke (#define STROKE в glowMapMerge даёт
    // жёсткую кромку вместо свечения). Уровни — WORLD3D_TOON_OUTLINE. Обводка —
    // часть toon-вида: при WORLD3D_TOON = 0 (галочка «toon shader» редактора)
    // её нет. Контур рёбер (inkMesh) от WORLD3D_TOON не зависит.
    //
    // У вида объектов ('actor' / 'prop') своя толщина, а у слоя она одна на
    // всех — поэтому разным видам нужны разные слои.
    //
    // Туман сцены линию не касается (она ложится на готовый кадр) — тон по
    // туману каждому мешу даёт outlineFog раз в кадр.
    //
    // ЛОВУШКА: слою нужен буфер трафарета (needStencil() = true) — движок
    // поднимается с stencil: true, иначе обводка залезает на сам объект.
    // ЛОВУШКА: обводка рисуется ПОВЕРХ кадра и глубины не знает — объект
    // перед обведённым её не перекроет. При виде сверху это незаметно.

    outlineKind(kind) { return kind === 'prop' ? 'prop' : 'actor'; },

    // Толщина обводки вида объектов в экранных px (пикселях кадра).
    outlineWidthOf(kind, c) {
        c = c || this.cfg();
        return this.outlineKind(kind) === 'prop' ? c.outlinePropWidth : c.outlineActorWidth;
    },

    // Разрешение слоя: маска — доля кадра, размытие — доля маски. Маску ниже
    // кадра не опускать: линию тоньше текселя не нарисовать, а тексель
    // 0.5 × 0.5 — это 4 px кадра. На мобильных дешевле только размытие.
    outlineRatios() {
        return { main: 1, blur: IS_MOBILE ? 0.5 : 1 };
    },

    // Толщина в px кадра -> ядро размытия слоя.
    // ЛОВУШКА: blurHorizontalSize у HighlightLayer — в ТЕКСЕЛЯХ текстуры
    // размытия (кадр × mainTextureRatio × blurTextureSizeRatio), а не в px
    // кадра. Без пересчёта на мобильных (0.5 × 0.5) та же константа давала
    // линию вчетверо толще, чем на ПК.
    outlineKernel(width) {
        const r = this.outlineRatios();
        return width * r.main * r.blur;
    },

    // Слой обводки: СВОЙ на каждую пару «вид объектов × группа рендера меша»
    // (`view._outlines['actor@2']` и т.п.). Вид задаёт толщину, группа — момент
    // наложения.
    //
    // ЛОВУШКА (обводка только у части объектов). Слой даёт линию ТОЛЬКО тем
    // мешам, которые рисуются в его группе рендера. При дефолтном
    // renderingGroupId = −1 наложение попадало между группами: объекты другой
    // группы заливались маской целиком, а у части объектов линии не было вовсе.
    // Поэтому слой заводится на КАЖДУЮ группу, в которой есть обводимый меш.
    outlineLayer(view, kind, renderGroup, c) {
        if (!view || !view.scene || typeof BABYLON.HighlightLayer !== 'function') return null;
        c = c || this.cfg();
        const k = this.outlineKind(kind);
        const g = renderGroup || 0;
        const key = k + '@' + g;
        const store = view._outlines || (view._outlines = {});
        let rec = store[key];
        const width = this.outlineWidthOf(k, c);
        if (!(c.toon > 0) || !(c.outline >= (k === 'prop' ? 2 : 1)) || !(width > 0)) return rec ? rec.hl : null;
        const kernel = this.outlineKernel(width);
        if (!rec) {
            const r = this.outlineRatios();
            const hl = new BABYLON.HighlightLayer('arcOutline-' + key, view.scene, {
                isStroke: true,
                camera: view.camera,
                mainTextureRatio: r.main,
                blurTextureSizeRatio: r.blur,
                blurHorizontalSize: kernel,
                blurVerticalSize: kernel,
                renderingGroupId: g
            });
            hl.innerGlow = false;     // только наружу — это обводка, не свечение
            hl.outerGlow = true;
            // ЛОВУШКА (тёмный «призрак» контура в тумане). В режиме STROKE шейдер
            // слияния (glowMapMerge) уже умножает цвет на альфу, а смешивание слоя
            // по умолчанию, ALPHA_COMBINE (SRC_ALPHA), умножает второй раз:
            // цвет·α² + кадр·(1−α). Чёрной линии это не видно, а линия цвета
            // тумана (outlineFog) получала кромку на четверть темнее фона: объект
            // вдали растворялся, контур оставался. Нужен ALPHA_PREMULTIPLIED
            // (ONE, ONE_MINUS_SRC_ALPHA) — но ТОЛЬКО на время склейки. Режим
            // лежит в приватных опциях тонкого слоя, и их же слой читает, когда
            // пересоздаёт текстуры при смене размера канваса: с PREMULTIPLIED он
            // собирал другую цепочку размытия (2 прохода вместо 3), текстура
            // размытия оставалась пустой, и обводка пропадала совсем (редактор
            // ArcTrack после смены размера вида). Опцией конструктора нельзя по
            // той же причине. Поле приватное: при апгрейде Babylon проверить.
            const thin = hl._thinEffectLayer;
            if (thin && thin._options) {
                const C = BABYLON.Constants;
                hl.onBeforeComposeObservable.add(() => { thin._options.alphaBlendingMode = C.ALPHA_PREMULTIPLIED; });
                hl.onAfterComposeObservable.add(() => { thin._options.alphaBlendingMode = C.ALPHA_COMBINE; });
            }
            // ЛОВУШКА (тёмная кайма у светлой линии). Маску слой чистит
            // neutralColor — по умолчанию чёрным (0,0,0,0). Размытие берёт цвет
            // самого яркого отсчёта, а отсчёт у края маски билинейно смешан с
            // этим чёрным: при дробном ядре (толщина 1.5 или 0.5 px) и на
            // мобильных (размытие в половину кадра) линия цвета тумана получала
            // тёмную кайму. Фон маски — самый тёмный тон мешей слоя с альфой 0
            // (outlineFog): смешение с ним цвет не темнит, а светлее нельзя —
            // размытие перекрасило бы им линию ближнего объекта. Объект свой:
            // по умолчанию все слои делят статический HighlightLayer.NeutralColor.
            hl.neutralColor = new BABYLON.Color4(0, 0, 0, 0);
            // meshes: меш -> его цвет линии (Color3, тон по туману правит outlineFog).
            rec = store[key] = { hl: hl, group: g, kind: k, meshes: new Map(), ink: null };
        }
        rec.hl.blurHorizontalSize = kernel;
        rec.hl.blurVerticalSize = kernel;
        rec.ink = this.hexColor3(c.inkColor);
        return rec.hl;
    },

    // Поставить меш в обводку. kind: 'actor' (уровень 1) | 'prop' (уровень 2).
    // Меш запоминает вид — applyOutlines пересобирает набор при правке
    // констант. Инстансы (thin и обычные) обводятся вместе с исходным мешем.
    outlineAdd(view, mesh, kind, c) {
        if (!view || !mesh) return;
        c = c || this.cfg();
        const k = this.outlineKind(kind);
        const md = mesh.metadata || (mesh.metadata = {});
        md.outline = k;
        this.outlineRemove(view, mesh);   // мог висеть в слое другой группы
        // Toon выключен — обводки нет; снятый меш вернёт applyOutlines, когда toon включат.
        const want = c.toon > 0 && c.outline >= (k === 'prop' ? 2 : 1) && this.outlineWidthOf(k, c) > 0;
        if (!want) return;
        const g = mesh.renderingGroupId || 0;
        const hl = this.outlineLayer(view, k, g, c);
        if (!hl) return;
        const tone = this.hexColor3(c.inkColor);   // свой объект у каждого меша: outlineFog правит его на месте
        hl.addMesh(mesh, tone);
        const rec = view._outlines[k + '@' + g];
        if (rec) rec.meshes.set(mesh, tone);
    },

    // Снять меш со всех слоёв обводки; опустевший слой сносится (пустая маска
    // всё равно стоит прохода рендера).
    outlineRemove(view, mesh) {
        const store = view && view._outlines;
        if (!store || !mesh) return;
        for (const key of Object.keys(store)) {
            const rec = store[key];
            if (!rec || !rec.hl || !rec.meshes.has(mesh)) continue;
            try { rec.hl.removeMesh(mesh); } catch (e) { /* ok */ }
            rec.meshes.delete(mesh);
            if (!rec.meshes.size) {
                try { rec.hl.dispose(); } catch (e) { /* ok */ }
                delete store[key];
            }
        }
    },

    // Правка констант: толщина — на живые слои, уровни и цвет — пересбор набора.
    applyOutlines(view, c) {
        if (!view || !view.scene) return;
        c = c || this.cfg();
        for (const m of view.scene.meshes) {
            if (m.metadata && m.metadata.outline && !m.isAnInstance) this.outlineAdd(view, m, m.metadata.outline, c);
        }
    },

    // Тон обводки по туману — раз в кадр, до scene.render() (renderFrame).
    // Линия ложится на готовый кадр, и без тона объект вдали растворялся в
    // тумане, а чёрный контур вокруг него оставался. Цвет линии меша смешивается
    // с туманом ТОЙ ЖЕ формулой, что Babylon применяет к поверхности
    // (fogFragment: mix(fogColor, цвет, f)), на расстоянии от камеры до центра
    // меша. Своих констант нет: туман — сцены (WORLD3D_FOG_DENSITY,
    // WORLD3D_SKY_COLOR, переопределения opts вида). Тон один на меш. У меша с
    // инстансами (thin или обычными — например, лес одним мешем) центр
    // габарита — середина всей россыпи, и тон по нему врал бы у копий рядом с
    // камерой: им тон — по расстоянию до точки взгляда камеры.
    outlineFog(view) {
        const store = view && view._outlines;
        if (!store || !view.scene || !view.camera) return;
        const scene = view.scene, fog = scene.fogColor, cam = view.camera;
        cam.getViewMatrix();   // globalPosition пересчитывается с матрицей вида, а рендер кадра ещё впереди
        const eye = cam.globalPosition;
        const focus = BABYLON.Vector3.Distance(eye, cam.getTarget());
        for (const key in store) {
            const rec = store[key], ink = rec.ink;
            if (!ink) continue;
            let darkest = Infinity;
            for (const [m, tone] of rec.meshes) {
                let d = focus;
                if (!m.hasThinInstances && !(m.instances && m.instances.length)) {
                    m.computeWorldMatrix();   // объект могли сдвинуть после прошлого кадра
                    d = BABYLON.Vector3.Distance(eye, m.getBoundingInfo().boundingSphere.centerWorld);
                }
                const f = m.applyFog === false ? 1 : this.fogFactor(scene, d);
                rec.hl.addMesh(m, tone.set(fog.r + (ink.r - fog.r) * f, fog.g + (ink.g - fog.g) * f, fog.b + (ink.b - fog.b) * f));
                // Яркость — как у выбора отсчёта в размытии (glowBlurPostProcess).
                const lum = 0.2126 * tone.r + 0.7152 * tone.g + 0.0722 * tone.b;
                if (lum < darkest) { darkest = lum; rec.hl.neutralColor.set(tone.r, tone.g, tone.b, 0); }
            }
        }
    },

    // Доля цвета поверхности, которую оставляет туман сцены на расстоянии d
    // (1 — тумана нет, 0 — только туман). Формулы — CalcFogFactor из
    // fogFragmentDeclaration Babylon.
    fogFactor(scene, d) {
        if (!scene.fogEnabled) return 1;
        const S = BABYLON.Scene, rho = scene.fogDensity;
        let f = 1;
        if (scene.fogMode === S.FOGMODE_EXP) f = Math.exp(-d * rho);
        else if (scene.fogMode === S.FOGMODE_EXP2) f = Math.exp(-(d * rho) * (d * rho));
        else if (scene.fogMode === S.FOGMODE_LINEAR) f = (scene.fogEnd - d) / (scene.fogEnd - scene.fogStart);
        return Math.max(0, Math.min(1, f));
    },

    // --- Утилиты ---------------------------------------------------------------

    // Вектор «куда светит солнце» (единичный, вниз): азимут по карте (0 — вправо,
    // 90 — вниз), высота над горизонтом.
    sunDirection(c) {
        c = c || this.cfg();
        const az = c.sunAz * Math.PI / 180;
        const el = c.sunEl * Math.PI / 180;
        const ce = Math.cos(el);
        return new BABYLON.Vector3(Math.cos(az) * ce, -Math.sin(el), Math.sin(az) * ce);
    },

    hexColor3(v) {
        if (typeof v === 'string') return BABYLON.Color3.FromHexString(v);
        const n = (v >>> 0) & 0xffffff;
        return new BABYLON.Color3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    }
};

// --- Toon-плагин материалов -----------------------------------------------------

// Плагин StandardMaterial. Живёт на каждом материале (material.arcToon). Два
// независимых define:
//   ARCSHADOW — цветная тень (см. шапку файла): на всех освещённых материалах
//               сцены, у которой есть scene.metadata.arcSun (ставит
//               View3D.applyLighting);
//   ARCTOON   — ступени света (World3D.toon.s.on).
// Значения уходят uniform'ами на каждой привязке (без пересборки шейдера),
// define — при markAllDefinesAsDirty. Материалы группы 'ground' получают
// bands = 0 при выключенном WORLD3D_TOON_GROUND и ободок 0 — ветвление в
// шейдере, не в define, чтобы переключатели редактора не компилировали
// шейдеры заново. metadata.toon = false выключает ступени на материале.
class ArcToonPlugin extends BABYLON.MaterialPluginBase {
    constructor(material) {
        super(material, 'ArcToon', 500, { ARCTOON: false, ARCSHADOW: false }, true, true);
    }

    getClassName() { return 'ArcToonPlugin'; }

    prepareDefines(defines, scene, mesh) {
        const s = World3D.toon.s;
        const m = this._material;
        const lit = !m.disableLighting;
        defines.ARCTOON = !!(s.on && lit && !(m.metadata && m.metadata.toon === false));
        defines.ARCSHADOW = !!(lit && scene.metadata && scene.metadata.arcSun);
    }

    getUniforms() {
        return {
            ubo: [
                { name: 'arcToonA', size: 4, type: 'vec4' },
                { name: 'arcToonB', size: 4, type: 'vec4' },
                { name: 'arcShadowColor', size: 4, type: 'vec4' },
                { name: 'arcSunDir', size: 4, type: 'vec4' },
                { name: 'arcSunColor', size: 4, type: 'vec4' }
            ],
            fragment: '#ifdef ARCTOON\nuniform vec4 arcToonA;\nuniform vec4 arcToonB;\n#endif\n' +
                '#ifdef ARCSHADOW\nuniform vec4 arcShadowColor;\nuniform vec4 arcSunDir;\nuniform vec4 arcSunColor;\n#endif'
        };
    }

    bindForSubMesh(ubo, scene, engine, subMesh) {
        const s = World3D.toon.s;
        const m = this._material;
        const md = scene.metadata;
        if (md && md.arcSun) {
            const sun = md.arcSun, sh = md.arcShadow || {};
            const col = sh.color || World3D.hexColor3(0x012d3c);
            ubo.updateFloat4('arcShadowColor', col.r, col.g, col.b, sh.strength != null ? sh.strength : 0.36);
            ubo.updateFloat4('arcSunDir', sun.dir.x, sun.dir.y, sun.dir.z, 0);
            ubo.updateFloat4('arcSunColor', sun.color.r, sun.color.g, sun.color.b, 0);
        }
        const ground = !!(m.metadata && m.metadata.toonGroup === 'ground');
        const bands = (ground && !s.ground) ? 0 : s.bands;
        ubo.updateFloat4('arcToonA', bands, s.soft, s.low, s.spec);
        ubo.updateFloat4('arcToonB', s.specSize, ground ? 0 : s.rim, s.rimWidth, 0);
    }

    getCustomCode(shaderType) {
        return shaderType === 'fragment' ? ArcToonPlugin.CODE : null;
    }
}

// arcToonA = (ступени, мягкость, нижняя ступень, сила блика),
// arcToonB = (порог блика, сила ободка, ширина ободка, —),
// arcShadowColor = (цвет тени, сила), arcSunDir = к солнцу, arcSunColor =
// диффуз солнца × интенсивность (как vLightDiffuse Babylon).
ArcToonPlugin.CODE = {
    CUSTOM_FRAGMENT_DEFINITIONS: `
#ifdef ARCTOON
float arcToonLevel(float v) {
    float bands = arcToonA.x;
    float lo = arcToonA.z;
    float t = clamp((v - lo) / max(1e-4, 1.0 - lo), 0.0, 1.0);
    float x = t * (bands - 1.0);
    float k = floor(x + 0.5);
    float d = x - k;
    float s = max(1e-3, arcToonA.y);
    float q = k + smoothstep(0.5 - s, 0.5 + s, d) - smoothstep(0.5 - s, 0.5 + s, -d);
    return lo + clamp(q / (bands - 1.0), 0.0, 1.0) * (1.0 - lo);
}
#endif
`,
    // Доля тени в точке — общая для цветной тени и ободка toon.
    CUSTOM_FRAGMENT_MAIN_BEGIN: `
float arcShadowA = 0.0;
`,
    // Сразу после суммирования света всех источников (default.fragment):
    // diffuseBase и specularBase ещё не умножены на цвет/текстуру. Сначала
    // цветная тень: видимость солнца — переменная shadow ПОСЛЕДНЕГО света
    // (солнце; darkness генератора 0), свет без тени восстанавливается
    // добавкой скрытой доли солнца.
    '!!aggShadow=aggShadow/numLights;': `$0
#ifdef ARCSHADOW
{
    float arcV = clamp(shadow, 0.0, 1.0);
    vec3 arcSunD = arcSunColor.rgb * max(0.0, dot(normalW, arcSunDir.xyz));
    vec3 arcU = max(vec3(0.0), diffuseBase + arcSunD * (1.0 - arcV));
    arcShadowA = 1.0 - arcV;
    diffuseBase = arcU * mix(vec3(1.0), arcShadowColor.rgb, arcShadowA * arcShadowColor.a);
#ifdef SPECULARTERM
    specularBase *= 1.0 - arcShadowA;
#endif
}
#endif
#ifdef ARCTOON
if (arcToonA.x >= 1.5) {
    float arcV = max(diffuseBase.r, max(diffuseBase.g, diffuseBase.b));
    float arcQ = arcToonLevel(arcV);
    diffuseBase = arcV > 1e-4 ? diffuseBase * (arcQ / arcV) : vec3(arcQ);
#ifdef SPECULARTERM
    float arcS = max(specularBase.r, max(specularBase.g, specularBase.b));
    float arcW = max(0.005, arcToonA.y * 0.25);
    float arcH = smoothstep(arcToonB.x - arcW, arcToonB.x + arcW, arcS) * arcToonA.w;
    specularBase = (arcS > 1e-5 ? specularBase / arcS : vec3(0.0)) * arcH;
#endif
}
#endif
`,
    // Ободок по краю силуэта — светлее базового цвета, гаснет в тени.
    CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef ARCTOON
if (arcToonB.y > 0.0) {
    float arcF = 1.0 - max(0.0, dot(normalW, viewDirectionW));
    float arcE = 1.0 - arcToonB.z;
    float arcR = smoothstep(arcE - 0.05, arcE + 0.05, arcF) * arcToonB.y * (1.0 - arcShadowA);
    color.rgb += baseColor.rgb * arcR;
}
#endif
`
};

World3D.toon = {
    s: { on: true, bands: 3, soft: 0.06, low: 0.35, ground: true, spec: 1, specSize: 0.12, rim: 0.25, rimWidth: 0.35 },
    registered: false,

    // Раз на страницу: фабрика вешает плагин на каждый новый StandardMaterial
    // (событие создания материала). Только GLSL (WebGL) — как и весь мир.
    register() {
        if (this.registered || typeof BABYLON === 'undefined' || !BABYLON.MaterialPluginBase ||
            typeof BABYLON.RegisterMaterialPlugin !== 'function') return;
        this.registered = true;
        this.load(World3D.cfg());
        BABYLON.RegisterMaterialPlugin('ArcToon', (material) => {
            if (!(material instanceof BABYLON.StandardMaterial)) return null;
            if (material.shaderLanguage != null && material.shaderLanguage !== 0) return null;
            material.arcToon = new ArcToonPlugin(material);
            return material.arcToon;
        });
    },

    load(c) {
        this.s = {
            on: c.toon > 0,
            bands: Math.max(2, Math.min(8, Math.round(c.toonBands))),
            soft: Math.max(0, Math.min(0.5, c.toonSoft)),
            low: Math.max(0, Math.min(0.95, c.toonLow)),
            ground: c.toonGround > 0,
            spec: Math.max(0, c.toonSpec),
            specSize: Math.max(0.005, c.toonSpecSize),
            rim: Math.max(0, c.toonRim),
            rimWidth: Math.max(0.02, Math.min(0.95, c.toonRimWidth))
        };
    },

    // Новые константы: значения — uniform'ами на следующей привязке; вкл/выкл
    // — пересборка шейдеров всех материалов с плагином во всех движках страницы.
    apply(c) {
        const wasOn = this.s.on;
        this.load(c || World3D.cfg());
        if (wasOn === this.s.on || !BABYLON.EngineStore) return;
        for (const eng of BABYLON.EngineStore.Instances) {
            for (const sc of eng.scenes) {
                for (const m of sc.materials) if (m.arcToon) m.arcToon.markAllDefinesAsDirty();
                sc.resetCachedMaterial();
            }
        }
    }
};

// Один 3D-вид: своя Babylon-сцена, камера, свет и тени.
class View3D {
    // opts: { sky?, groundTint?, shadowColor?, fogDensity?, shadowRadius? } — переопределения констант
    constructor(world, opts) {
        this.world = world;
        this.opts = opts;
        this.active = false;
        this.engine = world.engine;

        const scene = new BABYLON.Scene(this.engine);
        this.scene = scene;
        // Правосторонняя система: X = x, Z = y карты (y вниз) при виде сверху
        // даёт восток СПРАВА; в левосторонней тот же мир выходил зеркальным.
        scene.useRightHandedSystem = true;
        scene.detachControl();
        scene.skipPointerMovePicking = true;
        scene.skipFrustumClipping = false;
        scene.autoClear = true;
        scene.autoClearDepthAndStencil = true;
        // Слои OVERLAY и ACTOR глубину НЕ сбрасывают (World3D.LAYER): метки поверх
        // мира пускает тест ALWAYS их материала, а ACTOR по-прежнему проверяется о
        // глубину мира. Сброс глубины вместо ALWAYS уже пробовали — объекты ACTOR
        // начинали просвечивать сквозь стены.
        scene.setRenderingAutoClearDepthStencil(World3D.LAYER.OVERLAY, false);
        scene.setRenderingAutoClearDepthStencil(World3D.LAYER.ACTOR, false);
        scene.ambientColor = new BABYLON.Color3(0.35, 0.35, 0.38);
        // Туман прячет край земли на низком угле камеры.
        scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;

        const c = World3D.cfg();

        // --- Камера: TargetCamera без встроенных инпутов, ведёт CameraController ---
        this.camera = new BABYLON.TargetCamera('cam', new BABYLON.Vector3(0, 600, 0), scene);
        this.camera.fov = ((typeof CAMERA_FOV_DEG !== 'undefined') ? CAMERA_FOV_DEG : 52) * Math.PI / 180;
        this.camera.minZ = 6;
        this.camera.maxZ = 9000;
        this.camera.setTarget(new BABYLON.Vector3(1, 0, 1));
        scene.activeCamera = this.camera;

        // --- Свет: небо (полусфера) + солнце; значения — applyLighting ---
        this.hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
        this.hemi.specular = new BABYLON.Color3(0, 0, 0);

        this.sun = new BABYLON.DirectionalLight('sun', World3D.sunDirection(c), scene);
        this.sun.specular = new BABYLON.Color3(0.25, 0.25, 0.25);
        this.sun.autoUpdateExtends = false;
        // Глубина карты теней — от позиции солнца (LIGHT_DIST от цели):
        // узкий диапазон = точность, широкий (1..6000) тени терял.
        this.sun.shadowMinZ = View3D.LIGHT_DIST - 1200;
        this.sun.shadowMaxZ = View3D.LIGHT_DIST + 1200;
        this._shadowRadius = opts.shadowRadius || (IS_MOBILE ? Math.min(520, c.shadowRadius) : c.shadowRadius);

        const mapSize = IS_MOBILE ? Math.max(512, c.shadowMap / 2) : c.shadowMap;
        this._mapSize = mapSize;
        this.shadow = new BABYLON.ShadowGenerator(mapSize, this.sun);
        this.shadow.transparencyShadow = false;
        this.applyLighting(c);
        this.updateLightFrustum(0, 0, 0);

        this._syncFns = [];   // функции, дёргаемые перед каждым кадром 3D
        this.active = true;
        world.view = this;
    }

    // Свет, небо, туман и тени из констант рендера (opts вида их переопределяют).
    // Сюда же — данные плагина цветной тени (scene.metadata.arcSun, arcShadow):
    // плотность и цвет тени считает шейдер, darkness Babylon — 0.
    // Свет подобран так, чтобы ровная земля выходила ≈1.0 (краска текстуры без
    // изменений), склоны и тени темнели; суммы больше ~1.2 клампятся в белый.
    applyLighting(c) {
        c = c || World3D.cfg();
        const o = this.opts || {};
        const scene = this.scene;
        const sky = World3D.hexColor3(o.sky != null ? o.sky : c.sky);
        scene.clearColor = new BABYLON.Color4(sky.r, sky.g, sky.b, 1);
        scene.fogColor = sky;
        scene.fogDensity = Math.max(0, o.fogDensity != null ? o.fogDensity : c.fog);

        this.hemi.intensity = Math.max(0, c.skyIntensity);
        this.hemi.diffuse = World3D.hexColor3(c.skyLight);
        this.hemi.groundColor = World3D.hexColor3(o.groundTint != null ? o.groundTint : c.groundLight);

        this.sun.direction = World3D.sunDirection(c);
        this.sun.intensity = Math.max(0, c.sunIntensity);
        this.sun.diffuse = World3D.hexColor3(c.sunColor);

        const md = scene.metadata || (scene.metadata = {});
        md.arcSun = {
            dir: this.sun.direction.negate().normalize(),
            color: this.sun.diffuse.scale(this.sun.intensity)
        };
        md.arcShadow = {
            color: World3D.hexColor3(o.shadowColor != null ? o.shadowColor : c.shadowColor),
            strength: Math.max(0, Math.min(1, c.shadowStrength))
        };

        const sg = this.shadow;
        sg.setDarkness(0);   // цвет и силу тени даёт плагин (ARCSHADOW), Babylon — только видимость
        sg.bias = c.shadowBias;
        // Край тени: 0 — жёсткий (одна выборка карты), иначе PCF (WebGL2) или
        // Пуассон (WebGL1); на мобильных — не выше низкого качества.
        let soft = Math.max(0, Math.min(3, Math.round(c.shadowSoft)));
        if (IS_MOBILE && soft > 1) soft = 1;
        const webgl2 = this.engine.webGLVersion >= 2;
        if (webgl2) {
            sg.usePoissonSampling = false;
            sg.usePercentageCloserFiltering = soft > 0;
            if (soft > 0) {
                sg.filteringQuality = soft >= 3 ? BABYLON.ShadowGenerator.QUALITY_HIGH
                    : (soft === 2 ? BABYLON.ShadowGenerator.QUALITY_MEDIUM : BABYLON.ShadowGenerator.QUALITY_LOW);
            }
        } else {
            sg.usePercentageCloserFiltering = false;
            sg.usePoissonSampling = soft > 0;
        }
        // Смещение по нормали — в ТЕКСЕЛЯХ карты: «акне» (полосы и «пила» на гранях
        // под острым углом к солнцу) растёт с текселем, а кадр теней ужимается и
        // растёт (fitShadowFrustum). Фильтр края сравнивает глубину и на соседних
        // текселях — к константе прибавляется его радиус (PCF 1/3/5 выборок —
        // 0.5/1.5/2.5 текселя, Пуассон — 1), иначе при мягком крае «пила»
        // возвращается. В мировые px переводит updateLightFrustum.
        const filter = soft === 0 ? 0 : (webgl2 ? [0, 0.5, 1.5, 2.5][soft] : 1);
        this._normalBiasTexels = Math.max(0, c.shadowNormalBias) + filter;
        // Позиция солнца зависит от направления — ортокадр пересчитать.
        if (this._lightAt) this.updateLightFrustum(this._lightAt.x, this._lightAt.y, this._lightAt.h, this._lightAt.r);
    }

    // Ортокадр солнца ездит за точкой интереса (обычно цель камеры): тени
    // чёткие там, куда смотрит игрок, а не размазаны на весь мир.
    // radius — переопределение полуразмера кадра.
    updateLightFrustum(x, y2d, h, radius) {
        const R = radius || this._shadowRadius;
        const d = this.sun.direction;
        const L = View3D.LIGHT_DIST;
        this._lightAt = { x: x, y: y2d, h: h || 0, r: radius };
        this.sun.position = new BABYLON.Vector3(x - d.x * L, (h || 0) - d.y * L, y2d - d.z * L);
        this.sun.orthoLeft = -R;
        this.sun.orthoRight = R;
        this.sun.orthoTop = R;
        this.sun.orthoBottom = -R;
        // Тексель карты в мировых px: Babylon расширяет кадр на shadowOrthoScale с каждой стороны.
        const texel = 2 * R * (1 + 2 * this.sun.shadowOrthoScale) / this._mapSize;
        this.shadow.normalBias = (this._normalBiasTexels || 0) * texel;
    }

    // Ортокадр солнца по КАСТЕРАМ в пределах maxR от точки интереса: чем кадр
    // меньше, тем больше текселей карты на мировой px и чётче тень (кадр 720 px
    // при карте 1024 давал 0.7 текселя на px — тень расплывалась в пятно).
    //   • центр — середина ГАБАРИТОВ кастеров (bounding box в мире), попавших в
    //     maxR (остальные дальше края экрана, их тень не видна). По позициям
    //     кадр резал тень большой модели: у здания позиция — одна точка;
    //   • к полуразмеру — высота кастеров над точкой интереса, как её видит
    //     солнце (× cos высоты солнца: на столько верх объекта уходит в кадре
    //     солнца), но не меньше PAD;
    //   • радиус квантуется шагом 32 px, центр — по сетке текселей: иначе
    //     кромка тени «ползёт» по текселям при каждом сдвиге камеры;
    //   • кастер с thin instances стоит в начале координат и габарит бы врал —
    //     с ним кадр берётся по maxR.
    fitShadowFrustum(x, y2d, h, maxR) {
        const R0 = Math.min(maxR || this._shadowRadius, this._shadowRadius);
        const list = this.shadow ? this.shadow.getShadowMap().renderList : null;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, top = h, bottom = h, n = 0, wide = false;
        for (let i = 0; list && i < list.length; i++) {
            const m = list[i];
            if (m.hasThinInstances) { wide = true; break; }
            if (!m.isEnabled(false)) continue;
            m.computeWorldMatrix();
            const bb = m.getBoundingInfo().boundingBox, a = bb.minimumWorld, b = bb.maximumWorld;
            if (Math.abs((a.x + b.x) / 2 - x) > R0 || Math.abs((a.z + b.z) / 2 - y2d) > R0) continue;
            if (a.x < x0) x0 = a.x;
            if (b.x > x1) x1 = b.x;
            if (a.z < y0) y0 = a.z;
            if (b.z > y1) y1 = b.z;
            if (b.y > top) top = b.y;
            if (a.y < bottom) bottom = a.y;
            n++;
        }
        if (wide || !n) { this.updateLightFrustum(x, y2d, h, R0); return; }
        const PAD = 64;   // запас: кромка мягкой тени и углы габарита в кадре солнца
        const dy = this.sun.direction.y;
        const rise = Math.max(top - h, h - bottom) * Math.sqrt(Math.max(0, 1 - dy * dy));
        let R = Math.max(View3D.SHADOW_MIN_RADIUS, Math.max(x1 - x0, y1 - y0) / 2 + Math.max(PAD, rise));
        R = Math.min(R0, Math.ceil(R / 32) * 32);
        // Гистерезис: пока прежний радиус годится и не шире нужного больше чем на
        // шаг, держим его — иначе на границе шага R щёлкал бы между двумя
        // значениями через кадр, и кромка тени дрожала бы текселем.
        const prev = this._fitR;
        if (prev != null && prev <= R0 && prev >= R && prev - R <= 32) R = prev;
        this._fitR = R;
        const q = 2 * R / Math.max(64, this._mapSize);
        const cx = Math.round((x0 + x1) / 2 / q) * q, cy = Math.round((y0 + y1) / 2 / q) * q;
        this.updateLightFrustum(cx, cy, h, R);
    }

    addShadowCaster(mesh, includeDescendants) {
        if (this.shadow && mesh) this.shadow.addShadowCaster(mesh, includeDescendants !== false);
    }

    removeShadowCaster(mesh) {
        if (this.shadow && mesh) this.shadow.removeShadowCaster(mesh, true);
    }

    onBeforeFrame(fn) {
        this._syncFns.push(fn);
    }

    beforeRender() {
        for (const fn of this._syncFns) {
            try { fn(); } catch (e) { console.error('World3D sync:', e); }
        }
    }

    // --- Экран <-> мир ------------------------------------------------------

    // Камеру подвинули, кадр ещё не рисовался — матрицы для проекций обновить
    // сейчас (зум к курсору, панорама «за указателем»).
    refreshMatrices() {
        const cam = this.camera;
        this.scene.setTransformMatrix(cam.getViewMatrix(true), cam.getProjectionMatrix(true));
    }

    _renderScale() {
        const cw = this.world.canvas.clientWidth || 1;
        return this.engine.getRenderWidth() / cw;
    }

    // Точка экрана (CSS px канваса) -> точка карты ({x, y}) под курсором.
    // С terrain — пересечение луча с РЕЛЬЕФОМ, без него — плоскость Y = h.
    // null — луч смотрит в небо.
    pointerToGround(px, py, h, terrain) {
        // createPickingRay ждёт CSS-пиксели канваса: масштаб рендера
        // (hardwareScalingLevel) он учитывает САМ. Умножение на _renderScale()
        // уводило точку от курсора тем дальше, чем дальше от левого верхнего угла.
        const ray = this.scene.createPickingRay(px, py, BABYLON.Matrix.Identity(), this.camera, false);
        const o = ray.origin, d = ray.direction;
        if (Math.abs(d.y) < 1e-6) return null;
        const planeT = (yy) => (yy - o.y) / d.y;
        if (terrain && terrain.hgrid && Number.isFinite(terrain.hMin)) {
            // Марш по лучу от уровня выше максимума рельефа до уровня ниже
            // минимума; первый шаг под поверхностью уточняется бисекцией.
            let t0 = planeT(terrain.hMax + 1), t1 = planeT(terrain.hMin - 1);
            if (t1 > 0) {
                if (t0 < 0) t0 = 0;
                if (t1 > t0) {
                    const steps = Math.min(200, Math.max(48, Math.ceil((t1 - t0) / 4)));
                    const dt = (t1 - t0) / steps;
                    const under = (t) => (o.y + d.y * t) < terrain.heightAt(o.x + d.x * t, o.z + d.z * t);
                    let ta = t0;
                    for (let i = 1; i <= steps; i++) {
                        const t = t0 + dt * i;
                        if (under(t)) {
                            let a = ta, b = t;
                            for (let j = 0; j < 10; j++) {
                                const m = (a + b) / 2;
                                if (under(m)) b = m; else a = m;
                            }
                            const tm = (a + b) / 2;
                            return { x: o.x + d.x * tm, y: o.z + d.z * tm };
                        }
                        ta = t;
                    }
                }
            }
        }
        const t = planeT(h || 0);
        if (t <= 0) return null;
        return { x: o.x + d.x * t, y: o.z + d.z * t };
    }

    // Точка карты (x, y и высота) -> экранные CSS-пиксели канваса.
    // visible — точка внутри вьюпорта и перед камерой. Vector3.Project отдаёт
    // РЕНДЕР-пиксели — отсюда деление на _renderScale().
    projectToScreen(x, y2d, h) {
        const k = this._renderScale();
        const w = this.engine.getRenderWidth(), hh = this.engine.getRenderHeight();
        const p = BABYLON.Vector3.Project(
            new BABYLON.Vector3(x, h || 0, y2d),
            BABYLON.Matrix.Identity(),
            this.scene.getTransformMatrix(),
            this.camera.viewport.toGlobal(w, hh));
        const sx = p.x / k, sy = p.y / k;
        const behind = p.z > 1 || p.z < 0;
        return {
            x: sx, y: sy, behind: behind,
            visible: !behind && sx >= 0 && sy >= 0 && sx <= w / k && sy <= hh / k
        };
    }

    // Всё, что создано в сцене (меши, материалы, слои обводки), умирает вместе с ней.
    dispose() {
        this.active = false;
        if (this.world.view === this) this.world.view = null;
        this._syncFns = [];
        try { this.scene.dispose(); } catch (e) { /* уже снесена */ }
        this.scene = null;
    }
}

// Расстояние от цели камеры до «солнца» (центр ортокадра теней), px.
View3D.LIGHT_DIST = 2200;
// Минимальный полуразмер ортокадра теней: один объект со своей тенью.
View3D.SHADOW_MIN_RADIUS = 140;
