// material-editor.js — Material, Texture & UV Studio for ArcEngine Editor.
// Allows inspecting, assigning, uploading textures and tuning UV mapping
// (U/V scale tiling, U/V offset, rotation, roughness, metallic, color tint)
// for both the Ground (Terrain) and any selected 3D Object.

/** @satisfies {Record<string, any>} */
const MaterialEditor = {
    scene: null,
    terrain: null,
    target: null, // { mesh, material, childMeshes, isTerrain: boolean, name: string }
    forcedTarget: null, // 'terrain' | 'selected' | null

    // Preset PBR textures available in assets/textures/pbr/
    PRESETS: {
        'mud': {
            name: 'Brown Mud & Leaves (Game Ground)',
            nameRu: 'Грязь и листья (Земля игры)',
            diff: '/assets/textures/pbr/brown_mud_leaves_01_diff_2k.jpg',
            nor: '/assets/textures/pbr/brown_mud_leaves_01_nor_gl_2k.jpg',
            rough: '/assets/textures/pbr/brown_mud_leaves_01_rough_2k.jpg',
            color: '#d1c9b7',
            repeat: 16,
        },
        'asphalt': {
            name: 'Asphalt & Road',
            nameRu: 'Асфальт и дорога',
            diff: '/assets/textures/pbr/asphalt_02_diff_1k.jpg',
            nor: '/assets/textures/pbr/asphalt_02_nor_gl_1k.jpg',
            rough: '/assets/textures/pbr/asphalt_02_rough_1k.jpg',
            color: '#a0a09a',
            repeat: 8,
        },
        'concrete': {
            name: 'Worn Concrete Floor',
            nameRu: 'Бетонный пол',
            diff: '/assets/textures/pbr/concrete_floor_worn_001_diff_1k.jpg',
            nor: '/assets/textures/pbr/concrete_floor_worn_001_nor_gl_1k.jpg',
            rough: '/assets/textures/pbr/concrete_floor_worn_001_rough_1k.jpg',
            color: '#bcb9a8',
            repeat: 10,
        },
        'metal': {
            name: 'Rusty Industrial Metal',
            nameRu: 'Ржавый металл',
            diff: '/assets/textures/pbr/rusty_metal_02_diff_1k.jpg',
            nor: '/assets/textures/pbr/rusty_metal_02_nor_gl_1k.jpg',
            rough: '/assets/textures/pbr/rusty_metal_02_rough_1k.jpg',
            color: '#985e44',
            repeat: 4,
        },
    },

    currentGroundConfig: {
        preset: 'mud',
        diff: '/assets/textures/pbr/brown_mud_leaves_01_diff_2k.jpg',
        nor: '/assets/textures/pbr/brown_mud_leaves_01_nor_gl_2k.jpg',
        rough: '/assets/textures/pbr/brown_mud_leaves_01_rough_2k.jpg',
        color: '#d1c9b7',
        uScale: 16,
        vScale: 16,
        uOffset: 0,
        vOffset: 0,
        rot: 0,
        roughness: 0.95,
        metallic: 0
    },

    init(scene, terrain) {
        this.scene = scene;
        this.terrain = terrain;
        if (this.terrain) {
            // Guard against async default ground image loader overriding the PBR material
            this.terrain.setGroundImage = () => {};
        }
        this.setupDefaultGround();
    },

    /** Apply saved ground configuration or default PBR mud ground material to terrain on startup. */
    setupDefaultGround() {
        if (!this.terrain || !this.scene) return;
        let saved = null;
        try {
            if (typeof RAID_CUSTOM_LEVEL !== 'undefined' && RAID_CUSTOM_LEVEL && RAID_CUSTOM_LEVEL.ground) {
                saved = RAID_CUSTOM_LEVEL.ground;
            } else if (typeof window !== 'undefined' && window.localStorage) {
                const raw = localStorage.getItem('arc_custom_ground');
                if (raw) saved = JSON.parse(raw);
            }
        } catch (_) {}

        if (saved && (saved.preset || saved.diff || saved.color)) {
            this.applyGroundConfig(saved);
        } else {
            this.applyPresetToTerrain('mud');
        }
    },

    /** Apply full ground configuration to terrain */
    applyGroundConfig(cfg) {
        if (!this.terrain || !this.scene) return;
        this.currentGroundConfig = Object.assign({}, this.currentGroundConfig, cfg);

        const mat = new BABYLON.PBRMaterial('terrain_pbr_custom', this.scene);
        mat.albedoColor = BABYLON.Color3.FromHexString(this.currentGroundConfig.color || '#d1c9b7');
        mat.metallic = this.currentGroundConfig.metallic != null ? this.currentGroundConfig.metallic : 0;
        mat.roughness = this.currentGroundConfig.roughness != null ? this.currentGroundConfig.roughness : 0.95;
        mat.environmentIntensity = 0.38;
        mat.maxSimultaneousLights = 16;
        mat.usePhysicalLightFalloff = false;

        const uScale = this.currentGroundConfig.uScale || 16;
        const vScale = this.currentGroundConfig.vScale || 16;
        const uOffset = this.currentGroundConfig.uOffset || 0;
        const vOffset = this.currentGroundConfig.vOffset || 0;
        const rad = (this.currentGroundConfig.rot || 0) * Math.PI / 180;

        if (this.currentGroundConfig.diff) {
            const tex = new BABYLON.Texture(this.currentGroundConfig.diff, this.scene);
            tex.uScale = uScale; tex.vScale = vScale;
            tex.uOffset = uOffset; tex.vOffset = vOffset;
            tex.wAng = rad;
            tex.anisotropicFilteringLevel = 8;
            mat.albedoTexture = tex;
        }
        if (this.currentGroundConfig.nor) {
            const norTex = new BABYLON.Texture(this.currentGroundConfig.nor, this.scene, true);
            norTex.gammaSpace = false;
            norTex.uScale = uScale; norTex.vScale = vScale;
            norTex.uOffset = uOffset; norTex.vOffset = vOffset;
            norTex.wAng = rad;
            mat.bumpTexture = norTex;
            mat.bumpTexture.level = 0.45;
            mat.invertNormalMapY = true;
        }
        if (this.currentGroundConfig.rough) {
            const rTex = new BABYLON.Texture(this.currentGroundConfig.rough, this.scene, true);
            rTex.gammaSpace = false;
            rTex.uScale = uScale; rTex.vScale = vScale;
            rTex.uOffset = uOffset; rTex.vOffset = vOffset;
            rTex.wAng = rad;
            mat.metallicTexture = rTex;
            mat.useRoughnessFromMetallicTextureAlpha = false;
            mat.useRoughnessFromMetallicTextureGreen = true;
            mat.useMetallnessFromMetallicTextureBlue = false;
        }

        if (this.terrain.mesh) this.terrain.mesh.material = mat;
        if (this.terrain.outer) this.terrain.outer.material = mat;
        this.terrain.material = mat;
        this.terrain.outerMaterial = mat;
    },

    /** Apply one of the presets to the terrain. */
    applyPresetToTerrain(presetKey) {
        const p = this.PRESETS[presetKey] || this.PRESETS['mud'];
        if (!this.terrain || !this.scene) return;

        this.applyGroundConfig({
            preset: presetKey,
            diff: p.diff,
            nor: p.nor,
            rough: p.rough,
            color: p.color,
            uScale: p.repeat,
            vScale: p.repeat,
            uOffset: 0,
            vOffset: 0,
            rot: 0,
            roughness: 0.95,
            metallic: 0
        });
        this.syncGroundPersistence();
    },

    /** Sync ground changes to localStorage and RaidLayer */
    syncGroundPersistence() {
        try {
            if (typeof RaidLayer !== 'undefined' && RaidLayer.levelData) {
                RaidLayer.levelData.ground = JSON.parse(JSON.stringify(this.currentGroundConfig));
            }
        } catch (_) {}
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const safeCfg = Object.assign({}, this.currentGroundConfig);
                if (safeCfg.diff && safeCfg.diff.length > 200000) safeCfg.diff = '';
                localStorage.setItem('arc_custom_ground', JSON.stringify(safeCfg));
            }
        } catch (_) {}
    },

    /** Save ground configuration to file and localStorage */
    async saveGround() {
        this.syncGroundPersistence();
        if (typeof RaidLayer !== 'undefined' && RaidLayer.saveLevel) {
            await RaidLayer.saveLevel();
            if (typeof Toast !== 'undefined') {
                Toast.show(typeof I18N !== 'undefined' && I18N.lang === 'ru' ? 'Пол локации успешно сохранён!' : 'Ground floor saved successfully!');
            }
        } else {
            if (typeof Toast !== 'undefined') Toast.show('Ground saved locally!');
        }
    },

    /** Apply a callback function to all materials of the given target (including child meshes). */
    applyToMeshMaterials(target, fn) {
        if (!target) return;
        const wrap = (m) => {
            if (!m) return;
            if (m.maxSimultaneousLights != null && m.maxSimultaneousLights < 16) m.maxSimultaneousLights = 16;
            if (m.usePhysicalLightFalloff !== undefined) m.usePhysicalLightFalloff = false;
            fn(m);
        };
        if (target.isTerrain) {
            if (this.terrain && this.terrain.mesh && this.terrain.mesh.material) wrap(this.terrain.mesh.material);
            if (this.terrain && this.terrain.outer && this.terrain.outer.material) wrap(this.terrain.outer.material);
        } else {
            if (target.material) wrap(target.material);
            if (target.childMeshes && target.childMeshes.length > 0) {
                target.childMeshes.forEach(cm => {
                    if (cm.material) wrap(cm.material);
                });
            }
        }
    },

    /** Get current target (selected object mesh, or terrain). */
    resolveTarget() {
        const hasSelectedObject = typeof ObjectsPanel !== 'undefined' && ObjectsPanel.selected && ObjectsPanel.selected.mesh;

        if (this.forcedTarget === 'terrain' || (!hasSelectedObject && this.forcedTarget !== 'selected')) {
            if (this.terrain && this.terrain.mesh) {
                return {
                    name: (typeof I18N !== 'undefined' && I18N.lang === 'ru') ? 'Земля / Пол локации' : 'Ground / Terrain',
                    mesh: this.terrain.mesh,
                    childMeshes: this.terrain.outer ? [this.terrain.outer] : [],
                    material: this.terrain.mesh.material || this.terrain.material,
                    isTerrain: true,
                };
            }
        }

        if (hasSelectedObject) {
            const mesh = ObjectsPanel.selected.mesh;
            const childMeshes = (mesh.getChildMeshes ? mesh.getChildMeshes(false) : []).filter(m => m.material);
            const mat = mesh.material || (childMeshes[0] && childMeshes[0].material);
            return {
                name: (ObjectsPanel.selected.def && ObjectsPanel.selected.def.name) || mesh.name,
                mesh,
                childMeshes,
                material: mat,
                isTerrain: false,
            };
        }

        if (this.terrain && this.terrain.mesh) {
            return {
                name: (typeof I18N !== 'undefined' && I18N.lang === 'ru') ? 'Земля / Пол локации' : 'Ground / Terrain',
                mesh: this.terrain.mesh,
                childMeshes: this.terrain.outer ? [this.terrain.outer] : [],
                material: this.terrain.mesh.material || this.terrain.material,
                isTerrain: true,
            };
        }
        return null;
    },

    /** Render the Material & UV inspector UI into a container element. */
    render(container) {
        if (!container) return;
        const target = this.resolveTarget();
        if (!target) return;
        this.target = target;

        const isRu = typeof I18N !== 'undefined' && I18N && I18N.lang === 'ru';
        const hasSelectedObject = typeof ObjectsPanel !== 'undefined' && ObjectsPanel.selected && ObjectsPanel.selected.mesh;
        const mat = target.material;

        // Get current texture and UVs
        const mainTex = (mat && (mat.albedoTexture || mat.diffuseTexture)) || null;
        let uScale = mainTex ? mainTex.uScale : 1;
        let vScale = mainTex ? mainTex.vScale : 1;
        let uOffset = mainTex ? mainTex.uOffset : 0;
        let vOffset = mainTex ? mainTex.vOffset : 0;
        let uAng = mainTex ? (mainTex.wAng * 180 / Math.PI) : 0;

        let curColor = '#ffffff';
        if (mat) {
            const col = mat.albedoColor || mat.diffuseColor;
            if (col && typeof col.toHexString === 'function') curColor = col.toHexString();
        }
        const roughness = mat ? (mat.roughness != null ? mat.roughness : 0.8) : 0.8;
        const metallic = mat ? (mat.metallic != null ? mat.metallic : 0.1) : 0.1;

        // Clean up previous instance in container
        const existing = container.querySelector('.material-studio-section');
        if (existing) existing.remove();
        if (container.id === 'materials-host') container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'props-section material-studio-section';
        section.innerHTML = `
            <div class="material-studio-head">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="mat-badge">🎨 ${isRu ? 'Материал и UV' : 'Material & UV'}</span>
                </div>
                ${hasSelectedObject ? `
                    <select id="mat-target-selector" class="panel-select" style="width: auto; max-width: 180px; font-size: 11px; padding: 3px 6px;">
                        <option value="terrain" ${target.isTerrain ? 'selected' : ''}>🌍 ${isRu ? 'Земля (Пол)' : 'Ground (Floor)'}</option>
                        <option value="selected" ${!target.isTerrain ? 'selected' : ''}>📦 ${target.name}</option>
                    </select>
                ` : `
                    <span class="mat-target-name">${target.name}</span>
                `}
            </div>

            <div class="field">
                <div class="field-head">
                    <label>${isRu ? 'Готовый пресет' : 'Material Preset'}</label>
                </div>
                <select id="mat-preset-select" class="panel-select">
                    <option value="">${isRu ? '— Выбрать текстуру —' : '— Select Preset —'}</option>
                    ${Object.entries(this.PRESETS).map(([k, v]) => `
                        <option value="${k}">${isRu ? v.nameRu : v.name}</option>
                    `).join('')}
                </select>
            </div>

            <div class="field">
                <div class="field-head">
                    <label>${isRu ? 'Загрузить свою текстуру (Файл)' : 'Custom Texture (File)'}</label>
                </div>
                <div style="display: flex; gap: 8px;">
                    <input type="file" id="mat-file-upload" accept="image/*" style="display: none;">
                    <button type="button" id="btn-mat-upload" class="panel-button" style="flex: 1;">
                        📁 ${isRu ? 'Выбрать картинку…' : 'Upload Image…'}
                    </button>
                </div>
            </div>

            <div class="field">
                <div class="field-head">
                    <label>${isRu ? 'Цвет / Оттенок' : 'Tint Color'}</label>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="color" id="mat-color-picker" value="${curColor}" style="width: 44px; height: 28px; padding: 0; border: 1px solid var(--line); border-radius: 4px; cursor: pointer;">
                    <input type="text" id="mat-color-hex" value="${curColor}" style="width: 90px; font-family: monospace;">
                </div>
            </div>

            <!-- UV CONTROLS -->
            <div class="uv-controls-box">
                <div class="uv-box-title">📐 ${isRu ? 'Настройка UV (Тайлинг и сдвиг)' : 'UV Mapping (Tiling & Offset)'}</div>
                
                <div class="field">
                    <div class="field-head">
                        <label>${isRu ? 'Повторение U (Scale X)' : 'Tiling U (Scale X)'}</label>
                        <span id="lbl-uv-scale-u" class="axis-val">${Math.round(uScale * 10) / 10}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="range" id="mat-uv-scale-u" min="0.1" max="64" step="0.1" value="${uScale}" style="flex: 1;">
                        <input type="number" id="num-uv-scale-u" min="0.01" max="256" step="0.5" value="${Math.round(uScale * 10) / 10}" style="width: 65px;">
                    </div>
                </div>

                <div class="field">
                    <div class="field-head">
                        <label>${isRu ? 'Повторение V (Scale Y)' : 'Tiling V (Scale Y)'}</label>
                        <span id="lbl-uv-scale-v" class="axis-val">${Math.round(vScale * 10) / 10}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="range" id="mat-uv-scale-v" min="0.1" max="64" step="0.1" value="${vScale}" style="flex: 1;">
                        <input type="number" id="num-uv-scale-v" min="0.01" max="256" step="0.5" value="${Math.round(vScale * 10) / 10}" style="width: 65px;">
                    </div>
                </div>

                <div class="field">
                    <label class="panel-check">
                        <input type="checkbox" id="mat-uv-link" checked>
                        <span>${isRu ? 'Связать пропорции (U = V)' : 'Link Proportions (U = V)'}</span>
                    </label>
                </div>

                <div class="field">
                    <div class="field-head">
                        <label>${isRu ? 'Сдвиг U (Offset X)' : 'Offset U (Offset X)'}</label>
                        <span id="lbl-uv-offset-u" class="axis-val">${Math.round(uOffset * 100) / 100}</span>
                    </div>
                    <input type="range" id="mat-uv-offset-u" min="-2" max="2" step="0.02" value="${uOffset}">
                </div>

                <div class="field">
                    <div class="field-head">
                        <label>${isRu ? 'Сдвиг V (Offset Y)' : 'Offset V (Offset Y)'}</label>
                        <span id="lbl-uv-offset-v" class="axis-val">${Math.round(vOffset * 100) / 100}</span>
                    </div>
                    <input type="range" id="mat-uv-offset-v" min="-2" max="2" step="0.02" value="${vOffset}">
                </div>

                <div class="field">
                    <div class="field-head">
                        <label>${isRu ? 'Поворот UV' : 'UV Rotation'}</label>
                        <span id="lbl-uv-rot" class="axis-val">${Math.round(uAng)}°</span>
                    </div>
                    <input type="range" id="mat-uv-rot" min="0" max="360" step="1" value="${Math.round(uAng)}">
                </div>
            </div>

            <!-- PBR PROPERTIES -->
            <div class="field">
                <div class="field-head">
                    <label>${isRu ? 'Шероховатость (Roughness)' : 'Roughness'}</label>
                    <span id="lbl-mat-rough" class="axis-val">${Math.round(roughness * 100) / 100}</span>
                </div>
                <input type="range" id="mat-roughness" min="0" max="1" step="0.02" value="${roughness}">
            </div>

            <div class="field">
                <div class="field-head">
                    <label>${isRu ? 'Металличность (Metallic)' : 'Metallic'}</label>
                    <span id="lbl-mat-metal" class="axis-val">${Math.round(metallic * 100) / 100}</span>
                </div>
                <input type="range" id="mat-metallic" min="0" max="1" step="0.02" value="${metallic}">
            </div>

            ${target.isTerrain ? `
                <div class="field" style="margin-top: 14px;">
                    <button type="button" id="btn-save-ground" class="panel-button" style="width: 100%; background: #1c4b36; border-color: #38a169; color: #fff; font-weight: bold; padding: 8px 12px; font-size: 12px;">
                        💾 ${isRu ? 'Сохранить пол локации' : 'Save Ground Floor'}
                    </button>
                </div>
            ` : ''}
        `;

        container.appendChild(section);
        this.bindEvents(section, target);
    },

    bindEvents(section, target) {
        const mat = target.material;

        const btnSave = section.querySelector('#btn-save-ground');
        if (btnSave) {
            btnSave.addEventListener('click', () => this.saveGround());
        }

        // Target selector (switch between Terrain and Selected Object)
        const targetSel = section.querySelector('#mat-target-selector');
        if (targetSel) {
            targetSel.addEventListener('change', () => {
                this.forcedTarget = targetSel.value;
                this.refreshAllHosts();
            });
        }

        // Preset selection
        const presetSel = section.querySelector('#mat-preset-select');
        if (presetSel) {
            presetSel.addEventListener('change', () => {
                const key = presetSel.value;
                if (!key) return;
                if (target.isTerrain) {
                    this.applyPresetToTerrain(key);
                } else {
                    const p = this.PRESETS[key];
                    if (p) {
                        const tex = new BABYLON.Texture(p.diff, this.scene);
                        tex.uScale = tex.vScale = p.repeat;
                        tex.anisotropicFilteringLevel = 8;
                        const c = p.color ? BABYLON.Color3.FromHexString(p.color) : null;
                        this.applyToMeshMaterials(target, (m) => {
                            if (m.albedoTexture !== undefined) m.albedoTexture = tex;
                            else m.diffuseTexture = tex;
                            if (c) {
                                if (m.albedoColor) m.albedoColor = c;
                                else if (m.diffuseColor) m.diffuseColor = c;
                            }
                        });
                    }
                }
                this.refreshAllHosts();
            });
        }

        // Custom File Upload
        const fileIn = section.querySelector('#mat-file-upload');
        const uploadBtn = section.querySelector('#btn-mat-upload');
        if (uploadBtn && fileIn) {
            uploadBtn.addEventListener('click', () => fileIn.click());
            fileIn.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;

                let finalTextureUrl = null;
                // Try uploading to server first so the image is saved to disk
                try {
                    const res = await fetch('/api/upload-texture?name=' + encodeURIComponent(file.name), {
                        method: 'POST',
                        body: file
                    });
                    const data = await res.json();
                    if (data && data.ok && data.path) {
                        finalTextureUrl = data.path;
                    }
                } catch (_) {}

                const applyTextureUrl = (url) => {
                    const u = Number(section.querySelector('#mat-uv-scale-u').value) || 1;
                    const v = Number(section.querySelector('#mat-uv-scale-v').value) || 1;
                    const tex = new BABYLON.Texture(url, this.scene);
                    tex.uScale = u;
                    tex.vScale = v;
                    tex.anisotropicFilteringLevel = 8;
                    this.applyToMeshMaterials(target, (m) => {
                        if (m.albedoTexture !== undefined) m.albedoTexture = tex;
                        else m.diffuseTexture = tex;
                    });
                    if (target.isTerrain) {
                        this.currentGroundConfig.diff = url;
                        this.currentGroundConfig.nor = '';
                        this.currentGroundConfig.rough = '';
                        this.currentGroundConfig.preset = 'custom';
                        this.syncGroundPersistence();
                    }
                    if (typeof Toast !== 'undefined') Toast.show(typeof I18N !== 'undefined' && I18N.lang === 'ru' ? 'Текстура успешно наложена и сохранена!' : 'Texture applied and saved!');
                    this.refreshAllHosts();
                };

                if (finalTextureUrl) {
                    applyTextureUrl(finalTextureUrl);
                } else {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        applyTextureUrl(ev.target.result);
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        // Color picker
        const colorPicker = section.querySelector('#mat-color-picker');
        const colorHex = section.querySelector('#mat-color-hex');
        const onColor = (hex) => {
            if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
            const c = BABYLON.Color3.FromHexString(hex);
            this.applyToMeshMaterials(target, (m) => {
                if (m.albedoColor) m.albedoColor = c;
                else if (m.diffuseColor) m.diffuseColor = c;
            });
            if (target.isTerrain) {
                this.currentGroundConfig.color = hex;
                this.syncGroundPersistence();
            }
        };
        if (colorPicker && colorHex) {
            colorPicker.addEventListener('input', () => {
                colorHex.value = colorPicker.value;
                onColor(colorPicker.value);
            });
            colorHex.addEventListener('change', () => {
                colorPicker.value = colorHex.value;
                onColor(colorHex.value);
            });
        }

        // UV Tiling
        const scaleU = section.querySelector('#mat-uv-scale-u');
        const numScaleU = section.querySelector('#num-uv-scale-u');
        const scaleV = section.querySelector('#mat-uv-scale-v');
        const numScaleV = section.querySelector('#num-uv-scale-v');
        const linkCheck = section.querySelector('#mat-uv-link');
        const lblU = section.querySelector('#lbl-uv-scale-u');
        const lblV = section.querySelector('#lbl-uv-scale-v');

        const applyUVScale = (u, v) => {
            this.applyToMeshMaterials(target, (m) => {
                const tex = m.albedoTexture || m.diffuseTexture;
                if (tex) { tex.uScale = u; tex.vScale = v; }
                if (m.bumpTexture) { m.bumpTexture.uScale = u; m.bumpTexture.vScale = v; }
                if (m.metallicTexture) { m.metallicTexture.uScale = u; m.metallicTexture.vScale = v; }
            });
            if (target.isTerrain) {
                this.currentGroundConfig.uScale = u;
                this.currentGroundConfig.vScale = v;
                this.syncGroundPersistence();
            }
        };

        const onScaleU = (val) => {
            lblU.textContent = Math.round(val * 10) / 10;
            numScaleU.value = Math.round(val * 10) / 10;
            if (linkCheck && linkCheck.checked) {
                scaleV.value = val;
                numScaleV.value = Math.round(val * 10) / 10;
                lblV.textContent = Math.round(val * 10) / 10;
            }
            applyUVScale(Number(val), Number(scaleV.value));
        };

        const onScaleV = (val) => {
            lblV.textContent = Math.round(val * 10) / 10;
            numScaleV.value = Math.round(val * 10) / 10;
            if (linkCheck && linkCheck.checked) {
                scaleU.value = val;
                numScaleU.value = Math.round(val * 10) / 10;
                lblU.textContent = Math.round(val * 10) / 10;
            }
            applyUVScale(Number(scaleU.value), Number(val));
        };

        scaleU.addEventListener('input', (e) => onScaleU(e.target.value));
        numScaleU.addEventListener('change', (e) => { scaleU.value = e.target.value; onScaleU(e.target.value); });
        scaleV.addEventListener('input', (e) => onScaleV(e.target.value));
        numScaleV.addEventListener('change', (e) => { scaleV.value = e.target.value; onScaleV(e.target.value); });

        // UV Offset
        const offU = section.querySelector('#mat-uv-offset-u');
        const offV = section.querySelector('#mat-uv-offset-v');
        const lblOffU = section.querySelector('#lbl-uv-offset-u');
        const lblOffV = section.querySelector('#lbl-uv-offset-v');

        const applyOffset = () => {
            const u = Number(offU.value) || 0;
            const v = Number(offV.value) || 0;
            lblOffU.textContent = Math.round(u * 100) / 100;
            lblOffV.textContent = Math.round(v * 100) / 100;
            this.applyToMeshMaterials(target, (m) => {
                const tex = m.albedoTexture || m.diffuseTexture;
                if (tex) { tex.uOffset = u; tex.vOffset = v; }
                if (m.bumpTexture) { m.bumpTexture.uOffset = u; m.bumpTexture.vOffset = v; }
                if (m.metallicTexture) { m.metallicTexture.uOffset = u; m.metallicTexture.vOffset = v; }
            });
            if (target.isTerrain) {
                this.currentGroundConfig.uOffset = u;
                this.currentGroundConfig.vOffset = v;
                this.syncGroundPersistence();
            }
        };
        offU.addEventListener('input', applyOffset);
        offV.addEventListener('input', applyOffset);

        // UV Rotation
        const rot = section.querySelector('#mat-uv-rot');
        const lblRot = section.querySelector('#lbl-uv-rot');
        if (rot) {
            rot.addEventListener('input', () => {
                const deg = Number(rot.value) || 0;
                lblRot.textContent = Math.round(deg) + '°';
                const rad = deg * Math.PI / 180;
                this.applyToMeshMaterials(target, (m) => {
                    const tex = m.albedoTexture || m.diffuseTexture;
                    if (tex) tex.wAng = rad;
                    if (m.bumpTexture) m.bumpTexture.wAng = rad;
                    if (m.metallicTexture) m.metallicTexture.wAng = rad;
                });
                if (target.isTerrain) {
                    this.currentGroundConfig.rot = deg;
                    this.syncGroundPersistence();
                }
            });
        }

        // Roughness & Metallic
        const roughIn = section.querySelector('#mat-roughness');
        const lblRough = section.querySelector('#lbl-mat-rough');
        if (roughIn) {
            roughIn.addEventListener('input', () => {
                const val = Number(roughIn.value);
                lblRough.textContent = Math.round(val * 100) / 100;
                this.applyToMeshMaterials(target, (m) => {
                    if (m.roughness !== undefined) m.roughness = val;
                });
                if (target.isTerrain) {
                    this.currentGroundConfig.roughness = val;
                    this.syncGroundPersistence();
                }
            });
        }
        const metalIn = section.querySelector('#mat-metallic');
        const lblMetal = section.querySelector('#lbl-mat-metal');
        if (metalIn) {
            metalIn.addEventListener('input', () => {
                const val = Number(metalIn.value);
                lblMetal.textContent = Math.round(val * 100) / 100;
                this.applyToMeshMaterials(target, (m) => {
                    if (m.metallic !== undefined) m.metallic = val;
                });
                if (target.isTerrain) {
                    this.currentGroundConfig.metallic = val;
                    this.syncGroundPersistence();
                }
            });
        }
    },

    refreshAllHosts() {
        const matHost = document.getElementById('materials-host');
        if (matHost && !/** @type {HTMLElement} */ (document.querySelector('.pane-panel[data-tab="materials"]')).hidden) {
            setTimeout(() => this.render(matHost), 30);
        }
        const objProps = document.getElementById('object-props');
        if (objProps && !/** @type {HTMLElement} */ (document.querySelector('.pane-panel[data-tab="objects"]')).hidden) {
            if (typeof ObjectsPanel !== 'undefined') ObjectsPanel.renderProps();
        }
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = MaterialEditor;
if (typeof window !== 'undefined') window.MaterialEditor = MaterialEditor;
if (typeof globalThis !== 'undefined') /** @type {any} */ (globalThis).MaterialEditor = MaterialEditor;
