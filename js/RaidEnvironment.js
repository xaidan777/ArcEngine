// RaidEnvironment.js — authored industrial district, shared PBR surfaces and sky lighting.
// Geometry stays inside the existing cover footprints; distant architecture is outside the arena.
class RaidEnvironment {
    constructor(game, opts = {}) {
        this.game = game;
        this.scene = game.scene;
        this.view = game.app.location.view;
        this.terrain = game.app.location.terrain;
        this.opts = opts;
        this.level = opts.level || game.app.location.opts?.level || (typeof RAID_CUSTOM_LEVEL !== 'undefined' ? RAID_CUSTOM_LEVEL : {}) || {};
        this.flags = this.level.environment || {};
        this._partIds = new Map();
        this.isEditor = !!opts.isEditor || (typeof RaidLayer !== 'undefined' && this.game.app && (!this.game.app.canvas || this.game.app.canvas.id === 'lab-canvas'));
        this.skipProps = !!opts.skipProps;
        this.skipRubble = !!opts.skipRubble;
        this.models = [];
        this.rubbleMeshes = [];
        this.setupSky();
        this.setupGround();
    }

    async loadAssets() {
        const definitions = [
            {url:'assets/models/polyhaven/modular_factory_facade.glb', points:[[40,400,0.5,0]]},
            {url:'assets/models/polyhaven/barrel_03.glb', points:[[473,1510,0.65,0],[496,1490,0.7,45],[475,1470,0.65,-20],[1080,1200,0.7,0],[1118,1210,0.65,40],[1580,730,0.6,15]]},
            {url:'assets/models/polyhaven/concrete_road_barrier.glb', points:[[125,1450,0.52,0],[125,1240,0.52,0],[450,1530,0.5,0],[450,1230,0.5,0]]},
            {url:'assets/models/polyhaven/portable_generator.glb', points:[[720,1530,0.55,0],[1270,875,0.6,75]]}
        ];
        const hasManagedProps = this.isEditor || this.skipProps || (typeof LOCATION_OBJECTS !== 'undefined');

        if (!hasManagedProps) {
            await Promise.all(definitions.map(async def => {
                try {
                    const model=await Model3D.load(def.url,this.scene);
                    for(const [x,z,scale,rotation] of def.points) {
                        const root=Model3D.build(model,this.scene,{name:'district-asset'});
                        root.scaling.setAll(scale);root.rotation.y=rotation*Math.PI/180;
                        this.game.place(root,x,z,0);
                        World3D.addObject(this.view,root,'prop',{ink:false,outline:false});
                        // These props never move after placement. Freezing their world matrices
                        // removes a per-frame hierarchy walk without changing culling or pixels.
                        for (const part of root.getChildMeshes(false)) part.freezeWorldMatrix();
                        if (def.url.includes('factory')) {
                            // Collapse repeated modules into five material draws after placement.
                            root.computeWorldMatrix(true);
                            const groups=new Map();
                            for (const mesh of root.getChildMeshes(false)) {
                                if (!mesh.getTotalVertices())continue;
                                mesh.computeWorldMatrix(true);
                                if(!groups.has(mesh.material))groups.set(mesh.material,[]);
                                groups.get(mesh.material).push(mesh);
                            }
                            const combined=new BABYLON.Mesh('factory-assembled',this.scene);
                            this.view.removeShadowCaster(root);
                            for(const [material,parts] of groups) {
                                const merged=BABYLON.Mesh.MergeMeshes(parts,true,true,undefined,false,true);
                                if(merged){merged.material=material;merged.parent=combined;}
                            }
                            root.dispose(false,false);
                            World3D.addObject(this.view,combined,'prop',{ink:false,outline:false});
                            for (const part of combined.getChildMeshes(false)) part.freezeWorldMatrix();
                            this.models.push(combined);
                        } else this.models.push(root);
                    }
                } catch(e) {console.warn('District asset unavailable:',def.url,e);}
            }));
        }

        const rubbleDisabled = this.flags.rubble === false || this.skipRubble || this.isEditor || this.level.rubble === false || (this.level.rubble && this.level.rubble.enabled === false);
        if (rubbleDisabled) return;
        try {
            const loadPromise = Model3D.load('assets/models/polyhaven/grass_medium_01.glb', this.scene);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Grass load timeout')), 3500));
            const model = await Promise.race([loadPromise, timeoutPromise]);
            // The source pack contains separate clumps. Instance one clump with baked transforms.
            if (this.disposed) return;
            const source=model.container.meshes.find(m=>m.name.includes('tiny_c_LOD0') && m.getTotalVertices()>0);
            const base=source.clone('meadow-grass',null,true);
            base.position.set(0,0,0);base.rotationQuaternion=null;base.rotation.set(0,0,0);base.scaling.setAll(1);
            base.material=source.material.clone('meadow-grass-material');
            const rng=ShooterRules.createRng(2468),matrices=[];
            const bounds=base.getBoundingInfo().boundingBox;
            const height=Math.max(0.01,bounds.maximum.y-bounds.minimum.y);
            for(let i=0;i<(IS_MOBILE?250:900);i++) {
                const x=80+rng()*3930,z=120+rng()*3850;
                if(Math.abs(x-280)<124 || this.game.blockers.some(b=>ShooterRules.distanceSq(b,{x,y:z})<(b.radius+15)**2))continue;
                const scale=(9+rng()*15)/height;
                const matrix=BABYLON.Matrix.Compose(new BABYLON.Vector3(scale,scale,scale),BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y,rng()*Math.PI*2),
                    new BABYLON.Vector3(x,this.terrain.heightAt(x,z)-bounds.minimum.y*scale-1,z));
                matrices.push(...matrix.asArray());
            }
            base.thinInstanceSetBuffer('matrix',new Float32Array(matrices),16,true);
            base.thinInstanceRefreshBoundingInfo();
            World3D.addObject(this.view,base,'prop',{castShadow:false,ink:false,outline:false});
            base.freezeWorldMatrix();
            base.metadata = { environmentLayer: 'rubble', environmentId: 'meadow-grass' };
            if ((this.level.environmentDeleted || []).includes('meadow-grass')) base.dispose();
            else this.models.push(base);
        } catch(e) {console.warn('Grass asset unavailable:',e);}
    }

    surface(name, color, metallic = 0, roughness = 0.8, maps = null, repeat = 1) {
        const m = new BABYLON.PBRMaterial(name, this.scene);
        m.albedoColor = World3D.hexColor3(color);
        m.metallic = metallic; m.roughness = roughness;
        m.environmentIntensity = 0.38;
        m.maxSimultaneousLights = 16;
        m.usePhysicalLightFalloff = false;
        if (maps) {
            const texture = (url, linear = false) => {
                if (!url) return null;
                const t = new BABYLON.Texture(url, this.scene);
                t.uScale = t.vScale = repeat;
                t.anisotropicFilteringLevel = 8;
                if (linear) t.gammaSpace = false;
                return t;
            };
            if (maps[0]) m.albedoTexture = texture(maps[0]);
            if (maps[1]) {
                const bt = texture(maps[1], true);
                if (bt) {
                    m.bumpTexture = bt;
                    m.bumpTexture.level = 0.45;
                    m.invertNormalMapY = true;
                }
            }
            if (maps[2]) {
                const mt = texture(maps[2], true);
                if (mt) {
                    m.metallicTexture = mt;
                    m.useRoughnessFromMetallicTextureAlpha = false;
                    m.useRoughnessFromMetallicTextureGreen = true;
                    m.useMetallnessFromMetallicTextureBlue = false;
                }
            }
        }
        return m;
    }

    setupSky() {
        // A small local radiance cube supplies reflections without an external HDR dependency.
        const size = 32, faces = [];
        for (let f = 0; f < 6; f++) {
            const data = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const t = f === 2 ? 1 : f === 3 ? 0 : 1 - y / (size - 1);
                const sky = [0.23, 0.34, 0.42], ground = [0.17, 0.14, 0.10];
                const i = (y * size + x) * 4;
                for (let c = 0; c < 3; c++) data[i + c] = 255 * (ground[c] * (1 - t) + sky[c] * t);
                data[i + 3] = 255;
            }
            faces.push(data);
        }
        const env = new BABYLON.RawCubeTexture(this.scene, faces, size, BABYLON.Constants.TEXTUREFORMAT_RGBA,
            BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
        env.gammaSpace = false;
        this.scene.environmentTexture = env;
        // The local cube is immediately usable. HDR loading is deliberately fire-and-forget:
        // a slow texture must never hold the game on its loading screen.
        this.ready = Promise.resolve();
        /** @type {Set<any>} */
        this._skyTextures = new Set([env]);
        // Bind a ready local cube first: an optional HDR must not leave the sky's
        // material waiting forever if the asset is missing or still downloading.
        this.sky = this.scene.createDefaultSkybox(env, true, 8000, 0, false);
        this.sky.name = 'daySkyBox';
        const hdr = new BABYLON.HDRCubeTexture('assets/environment/industrial_sunset_02_puresky_2k.hdr',
            this.scene, IS_MOBILE ? 64 : 128, false, true, false, false,
            () => {
                if (this.disposed) { hdr.dispose(); return; }
                const material = this.sky.material;
                const previous = material.reflectionTexture;
                const reflection = hdr.clone();
                reflection.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
                material.reflectionTexture = reflection;
                this.scene.environmentTexture = hdr;
                previous?.dispose();
                env.dispose();
                this._skyTextures.delete(env);
            },
            () => { hdr.dispose(); this._skyTextures.delete(hdr); console.warn('HDR sky unavailable; retaining local sky lighting.'); });
        this._skyTextures.add(hdr);
        this.sky.isPickable = false;
        this.sky.applyFog = false;

        // Procedural starry nocturnal skybox for night and dark scenes
        const nightSize = 128, nightFaces = [];
        let seed = 12345;
        const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
        for (let f = 0; f < 6; f++) {
            const data = new Uint8Array(nightSize * nightSize * 4);
            for (let i = 0; i < nightSize * nightSize * 4; i += 4) {
                data[i] = 1;      // R: #01040a deep navy
                data[i + 1] = 4;  // G
                data[i + 2] = 10; // B
                data[i + 3] = 255;
            }
            // Scatter bright nocturnal stars
            for (let s = 0; s < 90; s++) {
                const sx = Math.floor(rng() * nightSize);
                const sy = Math.floor(rng() * nightSize);
                const b = Math.floor(190 + rng() * 65);
                const idx = (sy * nightSize + sx) * 4;
                data[idx] = b;
                data[idx + 1] = b;
                data[idx + 2] = Math.min(255, b + 30);
                if (rng() > 0.65) {
                    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                    for (const [dx, dy] of neighbors) {
                        const nx = sx + dx, ny = sy + dy;
                        if (nx >= 0 && nx < nightSize && ny >= 0 && ny < nightSize) {
                            const nidx = (ny * nightSize + nx) * 4;
                            data[nidx] = Math.max(data[nidx], Math.floor(b * 0.45));
                            data[nidx + 1] = Math.max(data[nidx + 1], Math.floor(b * 0.45));
                            data[nidx + 2] = Math.max(data[nidx + 2], Math.floor((b + 30) * 0.45));
                        }
                    }
                }
            }
            nightFaces.push(data);
        }
        const nightCube = new BABYLON.RawCubeTexture(this.scene, nightFaces, nightSize,
            BABYLON.Constants.TEXTUREFORMAT_RGBA, BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
            true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
        nightCube.gammaSpace = false;
        this.nightSky = this.scene.createDefaultSkybox(nightCube, true, 8000, 0, false);
        this.nightSky.name = 'nightSkyBox';
        this.nightSky.isPickable = false;
        this.nightSky.applyFog = false;
        this.nightSky.visibility = 0;
    }

    syncSky(sunAz, nightFactor = 0, sunEnabled = true) {
        nightFactor = Math.max(0, Math.min(1, Number(nightFactor) || 0));
        if (this.sky && !this.sky.isDisposed()) {
            if (sunAz != null) this.sky.rotation.y = -sunAz * Math.PI / 180;
            this.sky.visibility = sunEnabled ? Math.max(0, Math.min(1, 1.0 - nightFactor)) : 0;
        }
        if (this.nightSky && !this.nightSky.isDisposed()) {
            if (sunAz != null) this.nightSky.rotation.y = -sunAz * Math.PI / 180;
            this.nightSky.visibility = !sunEnabled ? 1 : Math.max(0, Math.min(1, nightFactor));
        }
        if (this.scene) {
            const baseEnv = (this.scene.environmentTexture && sunEnabled) ? Math.max(0.05, 1.0 - nightFactor * 0.95) : 0;
            this.scene.environmentIntensity = baseEnv;
        }
    }

    setupGround() {
        let custom = null;
        try {
            if (this.level.ground) {
                custom = this.level.ground;
            } else if (!this.level.id && typeof window !== 'undefined' && window.localStorage) {
                const raw = localStorage.getItem('arc_custom_ground');
                if (raw) custom = JSON.parse(raw);
            }
        } catch (_) {}

        if (custom && (custom.diff || custom.color || custom.preset)) {
            const hex = custom.color ? (custom.color.startsWith('#') ? parseInt(custom.color.slice(1), 16) : Number(custom.color)) : 0xd1c9b7;
            const maps = custom.diff ? [custom.diff, custom.nor || null, custom.rough || null] : RaidEnvironment.GROUND;
            const uScale = custom.uScale || 16;
            const vScale = custom.vScale || uScale;
            const ground = this.surface('district-ground', hex, custom.metallic != null ? custom.metallic : 0, custom.roughness != null ? custom.roughness : 0.95, maps, uScale);
            const alb = /** @type {any} */ (ground.albedoTexture);
            if (alb) {
                alb.uScale = uScale;
                alb.vScale = vScale;
                if (custom.uOffset) alb.uOffset = custom.uOffset;
                if (custom.vOffset) alb.vOffset = custom.vOffset;
                if (custom.rot) alb.wAng = custom.rot * Math.PI / 180;
            }
            const bump = /** @type {any} */ (ground.bumpTexture);
            if (bump) {
                bump.uScale = uScale;
                bump.vScale = vScale;
                if (custom.uOffset) bump.uOffset = custom.uOffset;
                if (custom.vOffset) bump.vOffset = custom.vOffset;
                if (custom.rot) bump.wAng = custom.rot * Math.PI / 180;
            }
            const met = /** @type {any} */ (ground.metallicTexture);
            if (met) {
                met.uScale = uScale;
                met.vScale = vScale;
                if (custom.uOffset) met.uOffset = custom.uOffset;
                if (custom.vOffset) met.vOffset = custom.vOffset;
                if (custom.rot) met.wAng = custom.rot * Math.PI / 180;
            }
            if (this.terrain) {
                this.terrain.setGroundImage = () => {};
                this.terrain.material = ground;
                this.terrain.outerMaterial = ground;
                if (this.terrain.mesh) this.terrain.mesh.material = ground;
                if (this.terrain.outer) this.terrain.outer.material = ground;
            }
            this.ground = ground;
            return;
        }

        if (this.terrain) {
            this.terrain.setGroundImage = () => {};
        }
        const ground = this.surface('district-ground', 0xd1c9b7, 0, 0.95, RaidEnvironment.GROUND, 16);
        if (this.terrain) {
            this.terrain.material = ground;
            this.terrain.outerMaterial = ground;
            if (this.terrain.mesh) this.terrain.mesh.material = ground;
            if (this.terrain.outer) this.terrain.outer.material = ground;
        }
        this.ground = ground;
    }

    build() {
        this.groups = new Map();
        const objList = this.level.props || ((typeof LOCATION_OBJECTS !== 'undefined') ? LOCATION_OBJECTS : null);
        for (const [x, y, radius] of [[125, 1450, 30], [125, 1240, 30], [450, 1530, 28], [450, 1230, 28], [720, 1530, 35], [1270, 875, 38],
            [473, 1510, 18], [496, 1490, 18], [475, 1470, 18], [1080, 1200, 18], [1118, 1210, 18], [1580, 730, 18]]) {
            if (objList && !objList.some(o => Math.hypot(o.x - x, o.y - y) < 40)) {
                continue;
            }
            // District assets: barriers and generators are waist- to chest-high, barrels knee-high.
            const low = radius <= 20;
            this.obstacle(x, y, radius, low ? 55 : 110);
        }
        const concrete = this.surface('district-concrete', 0xbcb9a8, 0, 0.92, RaidEnvironment.CONCRETE, 2);
        const rust = this.surface('district-oxidized-steel', 0x985e44, 0.32, 0.8, RaidEnvironment.RUST, 2);
        const steel = this.surface('district-steel', 0x48545a, 0.65, 0.43);
        const paint = this.surface('district-ochre', 0xb18a48, 0.35, 0.65);
        const white = this.surface('district-ivory', 0xbebdb0, 0.25, 0.63);
        const black = this.surface('district-recess', 0x202e31, 0.2, 0.75);
        const road = this.surface('district-asphalt', 0xa0a09a, 0.05, 0.92, RaidEnvironment.ASPHALT, 1);
        const light = this.surface('district-lamp', 0xffcd83, 0, 0.4);
        light.emissiveColor = BABYLON.Color3.FromHexString('#ffbd68').scale(2);
        const box = (name, p, s, mat, root = currentRoot) => registerPart(BABYLON.MeshBuilder.CreateBox(name, {width:s[0],height:s[1],depth:s[2]},this.scene),p,mat,root);
        const cylinder = (name, p, diameter, height, mat, root = currentRoot) => registerPart(BABYLON.MeshBuilder.CreateCylinder(name,{diameter,height,tessellation:32},this.scene),p,mat,root);
        const isEditor = true; // Stable structure roots in both editor and game.
        let currentRoot = null;
        const finalizeRoot = (root) => {
            if (!root) return;
            root.metadata.environmentId = root.name;
            root.metadata.environmentLayer = 'structures';
            if (!this.applyLevelObject(root, 'structures')) return;
            root.alwaysSelectAsActiveMesh = true;
            root.computeWorldMatrix(true);
            for (const child of root.getChildMeshes()) {
                child.alwaysSelectAsActiveMesh = true;
                child.computeWorldMatrix(true);
                if (child.refreshBoundingInfo) child.refreshBoundingInfo();
            }
        };
        const registerPart = (mesh, p, mat, root = currentRoot) => {
            if (isEditor && root) {
                mesh.parent = root;
                mesh.position.set(p[0], p[1], p[2]);
                mesh.material = mat;
                mesh.isPickable = true;
                mesh.metadata = { districtPropRoot: root };
                mesh.alwaysSelectAsActiveMesh = true;
                mesh.computeWorldMatrix(true);
                return mesh;
            }
            return this.part(mesh, p, mat);
        };
        // A continuous network of ground-conforming industrial access roads
        this.groundStrip('service-road-north', 280, 1000, 230, 1800, road);
        this.groundStrip('service-road-south', 280, 2700, 230, 1800, road);
        this.groundStrip('arterial-road', 2048, 1400, 3600, 220, road);
        this.groundStrip('east-depot-road', 3200, 2600, 220, 2200, road);
        for (let z = 200; z < 3800; z += 120) {
            this.groundStrip('worn-center-line', 280, z, 4, 50, paint);
            for (const x of [178, 382]) this.groundStrip('road-edge-line', x, z, 3, 100, white);
        }
        for (let x = 400; x < 3800; x += 120) {
            this.groundStrip('worn-center-line-art', x, 1400, 50, 4, paint);
        }

        // Left factory facade: deep window reveals, pillars, lintels and a broken roofline.
        const fy = this.terrain.heightAt(0, 1030);
        if (isEditor) {
            currentRoot = new BABYLON.Mesh('env_west_factory', this.scene);
            currentRoot.position.set(-100, fy + 150, 1030);
            currentRoot.metadata = { isDistrictStructure: true, structureType: 'factory', name: 'West Factory Facade', root: currentRoot };
            currentRoot.alwaysSelectAsActiveMesh = true;
            World3D.addObject(this.view, currentRoot, 'prop', { ink: false, outline: false });
            if (this.models) this.models.push(currentRoot);
            box('west-factory', [0, 0, 0], [250, 340, 1220], concrete);
            box('factory-plinth', [132, -126, 0], [18, 54, 1220], black);
            finalizeRoot(currentRoot);
            currentRoot = null;
        } else {
            box('west-factory', [-100, fy + 150, 1030], [250, 340, 1220], concrete);
            box('factory-plinth', [32, fy + 24, 1030], [18, 54, 1220], black);
        }

        // Cylindrical storage tanks and silos across sectors
        let tankIdx = 0;
        for (const [x, z, r, h] of [
            [610, 1440, 114, 260], [980, 1070, 144, 330], [1390, 1360, 124, 220], [1500, 600, 139, 340], [720, 570, 104, 250],
            [2900, 1100, 120, 280], [3400, 950, 140, 320], [2850, 2600, 115, 240], [3350, 3100, 135, 300], [1100, 2800, 120, 250]
        ]) {
            tankIdx++;
            const base = this.terrain.heightAt(x, z);
            // The vessel is a solid cylinder of height h: bullets must stop at its shell.
            this.obstacle(x, z, r, h);
            if (isEditor) {
                currentRoot = new BABYLON.Mesh('env_tank_' + tankIdx, this.scene);
                currentRoot.position.set(x, base, z);
                currentRoot.metadata = { isDistrictStructure: true, structureType: 'tank', name: `Storage Tank #${tankIdx} (VESSEL ${String(Math.round(x / 100)).padStart(2, '0')})`, root: currentRoot };
                currentRoot.alwaysSelectAsActiveMesh = true;
                World3D.addObject(this.view, currentRoot, 'prop', { ink: false, outline: false });
                if (this.models) this.models.push(currentRoot);

                cylinder('tank-foundation', [0, 9, 0], r * 2.2, 26, concrete);
                cylinder('storage-vessel', [0, h / 2, 0], r * 2, h, white);
                const dome = BABYLON.MeshBuilder.CreateSphere('tank-dome', { diameter: r * 2, segments: 24 }, this.scene);
                dome.scaling.y = 0.25; registerPart(dome, [0, h, 0], white);
                for (const y of [26, h * 0.48, h - 12]) cylinder('tank-band', [0, y, 0], r * 2 + 3, 7, paint);
                for (let y = 20; y < h + 10; y += 17) box('ladder-rung', [-r - 8, y, 0], [6, 3, 26], steel);
                for (const side of [-1, 1]) cylinder('ladder-rail', [-r - 8, h / 2, side * 15], 3, h, steel);
                const pipe = cylinder('tank-outlet', [0, 23, r + 18], 15, 70, rust); pipe.rotation.x = Math.PI / 2;
                this.sign('VESSEL  ' + String(Math.round(x / 100)).padStart(2, '0'), [0, h * 0.67, r + 0.8], r * 1.25, 30, 0, currentRoot);
                finalizeRoot(currentRoot);
                currentRoot = null;
            } else {
                cylinder('tank-foundation', [x, base + 9, z], r * 2.2, 26, concrete);
                cylinder('storage-vessel', [x, base + h / 2, z], r * 2, h, white);
                const dome = BABYLON.MeshBuilder.CreateSphere('tank-dome', { diameter: r * 2, segments: 24 }, this.scene);
                dome.scaling.y = 0.25; this.part(dome, [x, base + h, z], white);
                for (const y of [26, h * 0.48, h - 12]) cylinder('tank-band', [x, base + y, z], r * 2 + 3, 7, paint);
                for (let y = 20; y < h + 10; y += 17) box('ladder-rung', [x - r - 8, base + y, z], [6, 3, 26], steel);
                for (const side of [-1, 1]) cylinder('ladder-rail', [x - r - 8, base + h / 2, z + side * 15], 3, h, steel);
                const pipe = cylinder('tank-outlet', [x, base + 23, z + r + 18], 15, 70, rust); pipe.rotation.x = Math.PI / 2;
                this.sign('VESSEL  ' + String(Math.round(x / 100)).padStart(2, '0'), [x, base + h * 0.67, z + r + 0.8], r * 1.25, 30, 0);
            }
        }

        // Gantry checkpoints across arterial roads
        let archIdx = 0;
        for (const [gx, gz, angle] of [[280, 1150, 0], [280, 550, 0], [280, 2500, 0], [1800, 1400, Math.PI / 2], [3200, 1400, Math.PI / 2], [3200, 2500, 0]]) {
            archIdx++;
            const base = this.terrain.heightAt(gx, gz);
            const isH = angle !== 0;
            if (isEditor) {
                currentRoot = new BABYLON.Mesh('env_arch_' + archIdx, this.scene);
                currentRoot.position.set(gx, base, gz);
                currentRoot.rotation.y = angle;
                currentRoot.metadata = { isDistrictStructure: true, structureType: 'arch', name: `Sector Arch / Gate #${archIdx}`, root: currentRoot };
                currentRoot.alwaysSelectAsActiveMesh = true;
                World3D.addObject(this.view, currentRoot, 'prop', { ink: false, outline: false });
                if (this.models) this.models.push(currentRoot);

                for (const offset of [-148, 148]) {
                    const ox = isH ? gx : gx + offset;
                    const oz = isH ? gz + offset : gz;
                    this.obstacle(ox, oz, 23, 280);
                    box('gantry-foot', [offset, 20, 0], [42, 42, 55], concrete);
                    box('gantry-upright', [offset, 160, 0], [16, 280, 24], rust);
                }
                box('gantry-crossbeam', [0, 298, 0], [340, 25, 30], rust);
                box('gantry-crossbeam2', [0, 247, 0], [340, 12, 24], rust);
                this.sign('SECTOR GATE', [0, 206, 17], 230, 43, 0, currentRoot);
                finalizeRoot(currentRoot);
                currentRoot = null;
            } else {
                for (const offset of [-148, 148]) {
                    const ox = isH ? gx : gx + offset;
                    const oz = isH ? gz + offset : gz;
                    this.obstacle(ox, oz, 23, 280);
                    box('gantry-foot', [ox, base + 20, oz], [42, 42, 55], concrete);
                    box('gantry-upright', [ox, base + 160, oz], [16, 280, 24], rust);
                }
                const beam = box('gantry-crossbeam', [gx, base + 298, gz], [340, 25, 30], rust);
                if (isH) beam.rotation.y = Math.PI / 2;
                const beam2 = box('gantry-crossbeam2', [gx, base + 247, gz], [340, 12, 24], rust);
                if (isH) beam2.rotation.y = Math.PI / 2;
                this.sign('SECTOR GATE', [gx, base + 206, gz + (isH ? 0 : 17)], 230, 43, angle);
            }
        }

        // Raised utility pipes have circular sections, flange joints and structural supports.
        let pipeIdx = 0;
        for (const z of [900, 410, 2200]) {
            pipeIdx++;
            const base = this.terrain.heightAt(700, z);
            if (isEditor) {
                currentRoot = new BABYLON.Mesh('env_pipe_' + pipeIdx, this.scene);
                currentRoot.position.set(1400, base, z);
                currentRoot.metadata = { isDistrictStructure: true, structureType: 'pipe', name: `Overhead Pipe Run #${pipeIdx} (Z=${z})`, root: currentRoot };
                currentRoot.alwaysSelectAsActiveMesh = true;
                World3D.addObject(this.view, currentRoot, 'prop', { ink: false, outline: false });
                if (this.models) this.models.push(currentRoot);

                for (const x of [480, 880, 1260, 1630, 2400, 2900]) {
                    this.obstacle(x, z, 13, 250);
                    box('pipe-rack', [x - 1400, 125, 0], [13, 250, 18], steel);
                    box('pipe-saddle', [x - 1400, 250, 0], [65, 12, 100], steel);
                }
                for (const dz of [-27, 27]) {
                    const p = cylinder('utility-main', [0, 268, dz], 28, 1800, rust); p.rotation.z = Math.PI / 2;
                    for (let x = 490; x < 2900; x += 165) {
                        const flange = cylinder('pipe-flange', [x - 1400, 268, dz], 38, 6, steel); flange.rotation.z = Math.PI / 2;
                    }
                }
                finalizeRoot(currentRoot);
                currentRoot = null;
            } else {
                for (const x of [480, 880, 1260, 1630, 2400, 2900]) {
                    this.obstacle(x, z, 13, 250);
                    box('pipe-rack', [x, base + 125, z], [13, 250, 18], steel);
                    box('pipe-saddle', [x, base + 250, z], [65, 12, 100], steel);
                }
                for (const dz of [-27, 27]) {
                    const p = cylinder('utility-main', [1400, base + 268, z + dz], 28, 1800, rust); p.rotation.z = Math.PI / 2;
                    for (let x = 490; x < 2900; x += 165) {
                        const flange = cylinder('pipe-flange', [x, base + 268, z + dz], 38, 6, steel); flange.rotation.z = Math.PI / 2;
                    }
                }
            }
        }

        // Radar Dish Relay Station in North-East (Screamer territory)
        let radarIdx = 0;
        for (const [rx, rz] of [[3450, 700], [3650, 1250]]) {
            radarIdx++;
            const base = this.terrain.heightAt(rx, rz);
            this.obstacle(rx, rz, 35, 280);
            if (isEditor) {
                currentRoot = new BABYLON.Mesh('env_radar_' + radarIdx, this.scene);
                currentRoot.position.set(rx, base, rz);
                currentRoot.metadata = { isDistrictStructure: true, structureType: 'radar', name: `Radar Relay Station #${radarIdx}`, root: currentRoot };
                currentRoot.alwaysSelectAsActiveMesh = true;
                World3D.addObject(this.view, currentRoot, 'prop', { ink: false, outline: false });
                if (this.models) this.models.push(currentRoot);

                cylinder('relay-pylon', [0, 140, 0], 18, 280, steel);
                const dish = cylinder('relay-dish', [0, 285, 0], 120, 10, paint);
                dish.rotation.x = 0.65;
                box('relay-hut', [35, 25, 0], [60, 50, 70], concrete);
                finalizeRoot(currentRoot);
                currentRoot = null;
            } else {
                cylinder('relay-pylon', [rx, base + 140, rz], 18, 280, steel);
                const dish = cylinder('relay-dish', [rx, base + 285, rz], 120, 10, paint);
                dish.rotation.x = 0.65;
                box('relay-hut', [rx + 35, base + 25, rz], [60, 50, 70], concrete);
            }
        }

        // Distant skyline establishes scale outside map bounds
        if (this.flags.skyline !== false) {
            const W = this.level.dimensions?.width || 4096;
            const H = this.level.dimensions?.height || 4096;
            for (const [x, z, w, h, d] of [
                [W * 0.2, -450, 500, 380, 350], [W * 0.5, -500, 550, 480, 400], [W * 0.8, -450, 460, 360, 420],
                [W + 350, H * 0.3, 440, 420, 550], [W + 400, H * 0.65, 520, 340, 550],
                [W * 0.8, H + 350, 600, 390, 450], [W * 0.37, H + 400, 550, 350, 420],
                [-500, H * 0.37, 500, 420, 450], [-500, H * 0.73, 550, 370, 420]
            ]) {
                box('skyline-building', [x, h / 2 - 30, z], [w, h, d], concrete);
                for (let y = 80; y < h; y += 68) box('skyline-window-band', [x, y, z + d / 2 + 1], [w - 30, 19, 3], black);
                box('skyline-roof', [x, h - 20, z], [w + 16, 16, d + 16], rust);
            }
            for (const [x, z, h] of [[W * 0.44, -550, 950], [W * 0.68, -520, 820], [W + 300, H * 0.44, 880], [W + 280, H * 0.78, 780]]) {
                cylinder('chimney', [x, h / 2 - 20, z], 60, h, concrete);
                for (const y of [h - 160, h - 80]) cylinder('chimney-stripe', [x, y, z], 62, 32, rust);
                cylinder('chimney-crown', [x, h - 10, z], 70, 12, steel);
            }
        }
        // Cable runs and lamps
        let lampIdx = 0;
        for (const [x, z] of [[405, 1600], [405, 1020], [405, 430], [1640, 400], [2400, 1400], [3200, 1400], [3200, 2200], [3600, 600]]) {
            lampIdx++;
            const base = this.terrain.heightAt(x, z);
            if (isEditor) {
                currentRoot = new BABYLON.Mesh('env_lamp_' + lampIdx, this.scene);
                currentRoot.position.set(x, base, z);
                currentRoot.metadata = { isDistrictStructure: true, structureType: 'lamp', name: `Street Lamp #${lampIdx}`, root: currentRoot };
                currentRoot.alwaysSelectAsActiveMesh = true;
                World3D.addObject(this.view, currentRoot, 'prop', { ink: false, outline: false });
                if (this.models) this.models.push(currentRoot);

                cylinder('lamp-mast', [0, 135, 0], 5, 270, steel);
                box('lamp-arm', [-18, 269, 0], [42, 5, 5], steel);
                box('lamp-housing', [-37, 263, 0], [25, 9, 13], black);
                box('lamp-lens', [-37, 257, 0], [20, 2, 9], light);
                finalizeRoot(currentRoot);
                currentRoot = null;
            } else {
                cylinder('lamp-mast', [x, base + 135, z], 5, 270, steel);
                box('lamp-arm', [x - 18, base + 269, z], [42, 5, 5], steel);
                box('lamp-housing', [x - 37, base + 263, z], [25, 9, 13], black);
                box('lamp-lens', [x - 37, base + 257, z], [20, 2, 9], light);
            }
        }
        this.scatter(concrete, rust);
        // Merge repeated static parts by material: hundreds of details, a handful of draws.
        for(const [material,parts] of this.groups) {
            for(const part of parts) part.computeWorldMatrix(true);
            const merged=BABYLON.Mesh.MergeMeshes(parts,true,true,undefined,false,false);
            if(merged) {
                merged.name=material.name+'-architecture';
                merged.material=material;
                merged.alwaysSelectAsActiveMesh = true;
                World3D.addObject(this.view,merged,'prop',{ink:false,outline:false});
                merged.freezeWorldMatrix();
                if (this.models) this.models.push(merged);
            }
        }
    }

    // Register a collision footprint. `height` is the blocker's height ABOVE THE GROUND:
// without it ShooterRules falls back to 80 px for every obstacle, so low crates became
// "solid air" above the mesh while tall tanks could be shot straight through.
    obstacle(x, y, radius, height) {
        if (Array.isArray(this.level.districtStructures) || this.flags.structures === false) return null;
        const obstacle = { x, y, radius };
        if (height != null) obstacle.height = height;
        if (!this.obstacles) this.obstacles = [];
        this.obstacles.push(obstacle);
        this.game.blockers.push(obstacle);
        this.game.coverBlockers.push(obstacle);
        return obstacle;
    }

    part(mesh,p,mat) {
        mesh.position.set(p[0],p[1],p[2]);mesh.material=mat;mesh.isPickable=false;
        // Physical texture scale prevents long steel beams from looking like stretched wood.
        if (mat instanceof BABYLON.PBRMaterial && mat.albedoTexture) {
            const pos=mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const normals=mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
            const uv=[];
            for(let i=0;i<pos.length;i+=3) {
                const n=[Math.abs(normals[i]),Math.abs(normals[i+1]),Math.abs(normals[i+2])];
                const x=pos[i]*mesh.scaling.x,y=pos[i+1]*mesh.scaling.y,z=pos[i+2]*mesh.scaling.z;
                if(n[1]>=n[0] && n[1]>=n[2])uv.push(x/150,z/150);
                else if(n[0]>n[2])uv.push(z/150,y/150);
                else uv.push(x/150,y/150);
            }
            mesh.setVerticesData(BABYLON.VertexBuffer.UVKind,uv);
        }
        const layer = /skyline|chimney/.test(mesh.name) ? 'skyline' : /road|center-line|edge-line/.test(mesh.name) ? 'roads' : 'structures';
        const count = this._partIds.get(mesh.name) || 0; this._partIds.set(mesh.name, count + 1);
        mesh.metadata = { environmentId: mesh.name + ':' + count, environmentLayer: layer, isDistrictStructure: true };
        if (!this.applyLevelObject(mesh, layer)) return mesh;
        if (this.isEditor) {
            mesh.isPickable = true;
            this.models.push(mesh);
            World3D.addObject(this.view, mesh, 'prop', { ink: false, outline: false });
        } else {
            if(!this.groups.has(mat))this.groups.set(mat,[]);
            this.groups.get(mat).push(mesh);
        }
        return mesh;
    }

    groundStrip(name,x,z,width,length,mat) {
        const mesh=BABYLON.MeshBuilder.CreateGround(name,{width,height:length,subdivisions: length > 500 ? 48 : 3},this.scene);
        const positions=mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        for(let i=0;i<positions.length;i+=3) positions[i+1]=this.terrain.heightAt(x+positions[i],z+positions[i+2])+0.65;
        mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,positions);
        const normals=[];BABYLON.VertexData.ComputeNormals(positions,mesh.getIndices(),normals);
        mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind,normals);
        this.part(mesh,[x,0,z],mat);
    }

    sign(label,p,w,h,rotation,root=null) {
        const texture=new BABYLON.DynamicTexture('district-sign-'+label,{width:1024,height:256},this.scene,true);
        const c=/** @type {CanvasRenderingContext2D} */ (texture.getContext());c.fillStyle='#243332';c.fillRect(0,0,1024,256);
        c.fillStyle='#c7a265';c.fillRect(0,0,15,256);c.fillRect(26,224,970,3);
        c.font='bold 70px sans-serif';c.textAlign='center';c.fillStyle='#e6e1c8';c.fillText(label,520,129);
        c.font='25px monospace';c.fillStyle='#b4b6a4';c.fillText('B W A   /   INDUSTRIAL AUTHORITY',520,190);
        texture.update();
        const m=new BABYLON.StandardMaterial('sign-'+label,this.scene);
        m.diffuseTexture=texture;m.emissiveColor=new BABYLON.Color3(0.13,0.13,0.13);m.specularColor=BABYLON.Color3.Black();
        const mesh=BABYLON.MeshBuilder.CreatePlane('wayfinding',{width:w,height:h,sideOrientation:BABYLON.Mesh.DOUBLESIDE},this.scene);
        mesh.rotation.y=rotation;
        if (root) {
            mesh.parent = root;
            mesh.position.set(p[0], p[1], p[2]);
            mesh.material = m;
            mesh.isPickable = true;
            mesh.metadata = { districtPropRoot: root };
            mesh.alwaysSelectAsActiveMesh = true;
            return mesh;
        }
        this.part(mesh,p,m);
    }

    scatter(concrete, rust) {
        const rubbleDisabled = this.level.rubble?.enabled === false;
        if (this.skipRubble || this.flags.rubble === false || rubbleDisabled) return;

        this.rubbleMeshes = [];
        const rng = ShooterRules.createRng(9934);
        for (let i = 0; i < 180; i++) {
            const x = 120 + rng() * 3850, z = 120 + rng() * 3850;
            if (Math.abs(x - 280) < 105 || Math.abs(z - 1400) < 105) continue;
            const rock = BABYLON.MeshBuilder.CreatePolyhedron('rubble_' + i, { type: 1, size: 3 + rng() * 8 }, this.scene);
            rock.scaling.set(1.7, 0.6, 1); rock.rotation.set(rng(), rng() * 6, rng());
            if (true) {
                rock.position.set(x, this.terrain.heightAt(x, z) + 2, z);
                rock.material = (i % 4 ? concrete : rust);
                rock.isPickable = true;
                rock.metadata = { isRubble: true, rubbleIndex: i };
                rock.metadata.environmentId = rock.name; rock.metadata.environmentLayer = 'rubble';
                if (!this.applyLevelObject(rock, 'rubble')) continue;
                this.rubbleMeshes.push(rock);
                this.models.push(rock);
            } else {
                this.part(rock, [x, this.terrain.heightAt(x, z) + 2, z], i % 4 ? concrete : rust);
            }
        }
    }

    applyLevelObject(mesh, layer) {
        const id = mesh.metadata.environmentId;
        const authored = this.level.districtStructures;
        const record = Array.isArray(authored) ? authored.find(r => r.id === id) : null;
        if (this.flags[layer] === false || (this.level.environmentDeleted || []).includes(id) ||
            (layer === 'structures' && Array.isArray(authored) && !record)) {
            mesh.dispose(); return false;
        }
        if (record) {
            if (record.position) mesh.position.fromArray(record.position);
            if (record.rotation) { mesh.rotationQuaternion = null; mesh.rotation.fromArray(record.rotation); }
            if (record.scale) mesh.scaling.fromArray(record.scale);
        }
        return true;
    }

    dispose() {
        this.disposed = true;
        this.sky?.dispose(false, true);
        this.nightSky?.dispose(false, true);
        for (const texture of this._skyTextures || []) {
            if (this.scene.environmentTexture === texture) this.scene.environmentTexture = null;
            texture.dispose();
        }
        this._skyTextures?.clear();
        for (const mesh of this.models || []) if (!mesh.isDisposed()) {
            this.view.removeShadowCaster(mesh); mesh.dispose();
        }
        this.models = []; this.clearRubble();
    }

    clearRubble() {
        if (this.rubbleMeshes) {
            for (const r of this.rubbleMeshes) {
                try { r.dispose(); } catch (_) {}
            }
            this.rubbleMeshes = [];
        }
    }
}
RaidEnvironment.CONCRETE = ['assets/textures/pbr/concrete_floor_worn_001_diff_1k.jpg','assets/textures/pbr/concrete_floor_worn_001_nor_gl_1k.jpg','assets/textures/pbr/concrete_floor_worn_001_rough_1k.jpg'];
RaidEnvironment.RUST = ['assets/textures/pbr/rusty_metal_02_diff_1k.jpg','assets/textures/pbr/rusty_metal_02_nor_gl_1k.jpg','assets/textures/pbr/rusty_metal_02_rough_1k.jpg'];
RaidEnvironment.ASPHALT = ['assets/textures/pbr/asphalt_02_diff_1k.jpg','assets/textures/pbr/asphalt_02_nor_gl_1k.jpg','assets/textures/pbr/asphalt_02_rough_1k.jpg'];

RaidEnvironment.GROUND = ['assets/textures/pbr/brown_mud_leaves_01_diff_2k.jpg','assets/textures/pbr/brown_mud_leaves_01_nor_gl_2k.jpg','assets/textures/pbr/brown_mud_leaves_01_rough_2k.jpg'];
