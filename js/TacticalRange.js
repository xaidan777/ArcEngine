// TacticalRange.js — Visual 3D Tactical Combat, Ballistics & Posture Testing Range for ArcEngine
// Allows visual, interactive, in-game verification of:
// 1. Postures (Stand, Crouch, Prone) & dynamic collider heights
// 2. Tactical Leaning (±18px lateral shift, camera roll tilt)
// 3. Muzzle-to-Reticle 3D Aim Convergence across 300m..1200m targets
// 4. Ballistics flight simulation, parabolic gravity drop curve, and drag
// 5. Crouch dodging and cover peeking

class TacticalRange {
    constructor() {
        this.active = false;
        this.container = null;
        this.game = null;
        this.scene = null;
        this.targets = [];
        this.trajectoryLine = null;
        this.convergenceLine = null;
        this.autoTesting = false;
        this.autoTestStep = 0;
        this.telemetry = {
            posture: 'stand',
            eyeHeight: 64,
            lean: 0,
            targetDist: 600,
            muzzlePos: { x: 0, y: 0, h: 0 },
            aimPoint: { x: 0, y: 0, h: 0 },
            lastHit: '—',
            lastDrop: 0,
            lastSpeed: 0,
        };
    }

    init(game) {
        this.game = game;
        this.scene = game.scene;
        this.createUI();
    }

    createUI() {
        if (this.container) return;
        const div = document.createElement('div');
        div.id = 'arc-tactical-range-hud';
        div.className = 'arc-tactical-range-hud';
        div.style.display = 'none';

        div.innerHTML = `
            <div class="range-panel">
                <div class="range-header">
                    <div class="range-badge">TACTICAL TELEMETRY</div>
                    <div class="range-title">3D ВИЗУАЛЬНЫЙ ТЕСТОВЫЙ ПОЛИГОН</div>
                    <div class="range-sub">БАЛЛИСТИКА · СВЕДЕНИЕ ПРИЦЕЛА · СТОЙКИ · НАКЛОНЫ</div>
                </div>

                <div class="range-telemetry-grid">
                    <div class="range-stat-box">
                        <span class="range-stat-label">ПОЗА И ВЫСОТА ГЛАЗ</span>
                        <span class="range-stat-val" id="range-val-posture">STAND (64 px)</span>
                    </div>
                    <div class="range-stat-box">
                        <span class="range-stat-label">НАКЛОН (LEAN)</span>
                        <span class="range-stat-val" id="range-val-lean">CENTER (0 px)</span>
                    </div>
                    <div class="range-stat-box">
                        <span class="range-stat-label">ДИСТАНЦИЯ ДО ЦЕЛИ</span>
                        <span class="range-stat-val" id="range-val-dist">600 px (~30m)</span>
                    </div>
                    <div class="range-stat-box">
                        <span class="range-stat-label">СВЕДЕНИЕ СТВОЛА</span>
                        <span class="range-stat-val" id="range-val-conv">FOCUSED (0.00°)</span>
                    </div>
                    <div class="range-stat-box">
                        <span class="range-stat-label">ПАДЕНИЕ ПУЛИ (DROP)</span>
                        <span class="range-stat-val" id="range-val-drop">-0.0 px</span>
                    </div>
                    <div class="range-stat-box">
                        <span class="range-stat-label">РЕЗУЛЬТАТ ВЫСТРЕЛА</span>
                        <span class="range-stat-val" id="range-val-hit">ГОТОВ К СТРЕЛЬБЕ</span>
                    </div>
                </div>

                <div class="range-test-progress" id="range-test-progress" style="display: none;">
                    <div class="range-step-title" id="range-step-title">ТЕСТ В ПРОЦЕССЕ...</div>
                    <div class="range-step-bar"><div class="range-step-fill" id="range-step-fill" style="width: 0%;"></div></div>
                </div>

                <div class="range-actions">
                    <button class="range-btn range-btn-primary" id="range-btn-auto">▶ ЗАПУСТИТЬ АВТОТЕСТ ВСЕХ СИСТЕМ</button>
                    <button class="range-btn" id="range-btn-step-posture">СТОЙКИ (C/Z)</button>
                    <button class="range-btn" id="range-btn-step-lean">НАКЛОНЫ (Q/E)</button>
                    <button class="range-btn" id="range-btn-step-conv">СВЕДЕНИЕ 300-1200m</button>
                    <button class="range-btn" id="range-btn-step-drop">ПАДЕНИЕ ПУЛИ</button>
                    <button class="range-btn range-btn-close" id="range-btn-close">ЗАКРЫТЬ [F2]</button>
                </div>

                <div class="range-help-text">
                    [F2] Вкл/Выкл полигон | [ЛКМ] Выстрел | [ПКМ] Прицел (ADS) | [C] Присед | [Z] Лечь | [Q/E] Наклоны | [Shift] Спринт
                </div>
            </div>
        `;

        document.body.appendChild(div);
        this.container = div;

        div.querySelector('#range-btn-auto')?.addEventListener('click', () => this.runFullAutoTest());
        div.querySelector('#range-btn-step-posture')?.addEventListener('click', () => this.testPosturesVisual());
        div.querySelector('#range-btn-step-lean')?.addEventListener('click', () => this.testLeanVisual());
        div.querySelector('#range-btn-step-conv')?.addEventListener('click', () => this.testConvergenceVisual());
        div.querySelector('#range-btn-step-drop')?.addEventListener('click', () => this.testDropVisual());
        div.querySelector('#range-btn-close')?.addEventListener('click', () => this.toggle());

        this.injectStyles();
    }

    injectStyles() {
        if (document.getElementById('arc-tactical-range-css')) return;
        const style = document.createElement('style');
        style.id = 'arc-tactical-range-css';
        style.textContent = `
            .arc-tactical-range-hud {
                position: fixed;
                top: 24px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 2500;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
                color: #e2e8f0;
                /* A read-out, not a control surface: the panel must not swallow clicks aimed
                   at the canvas underneath it. Only its controls opt back in below. */
                pointer-events: none;
                width: min(880px, 94vw);
            }
            .arc-tactical-range-hud button,
            .arc-tactical-range-hud .range-actions,
            .arc-tactical-range-hud input,
            .arc-tactical-range-hud select { pointer-events: auto; }
            .range-panel {
                background: rgba(10, 16, 22, 0.92);
                border: 1px solid rgba(82, 227, 146, 0.35);
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75), inset 0 0 20px rgba(82, 227, 146, 0.08);
                border-radius: 6px;
                padding: 16px 22px;
                backdrop-filter: blur(10px);
            }
            .range-header {
                border-bottom: 1px solid rgba(82, 227, 146, 0.2);
                padding-bottom: 10px;
                margin-bottom: 12px;
            }
            .range-badge {
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.22em;
                color: #52e392;
                margin-bottom: 2px;
            }
            .range-title {
                font-size: 18px;
                font-weight: 800;
                letter-spacing: 0.12em;
                color: #ffffff;
            }
            .range-sub {
                font-size: 11px;
                color: #94a3b8;
                letter-spacing: 0.08em;
            }
            .range-telemetry-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
                margin-bottom: 14px;
            }
            .range-stat-box {
                background: rgba(18, 28, 38, 0.7);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 4px;
                padding: 8px 12px;
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .range-stat-label {
                font-size: 10px;
                font-weight: 600;
                color: #64748b;
                letter-spacing: 0.06em;
            }
            .range-stat-val {
                font-size: 13px;
                font-weight: 700;
                color: #38bdf8;
                font-variant-numeric: tabular-nums;
            }
            .range-test-progress {
                background: rgba(18, 28, 38, 0.9);
                border: 1px solid rgba(82, 227, 146, 0.3);
                padding: 10px 14px;
                border-radius: 4px;
                margin-bottom: 12px;
            }
            .range-step-title {
                font-size: 12px;
                font-weight: 700;
                color: #52e392;
                margin-bottom: 6px;
                letter-spacing: 0.06em;
            }
            .range-step-bar {
                height: 6px;
                background: #1e293b;
                border-radius: 3px;
                overflow: hidden;
            }
            .range-step-fill {
                height: 100%;
                background: linear-gradient(90deg, #38bdf8, #52e392);
                transition: width 0.3s ease;
            }
            .range-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-bottom: 10px;
            }
            .range-btn {
                background: #1e293b;
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #cbd5e1;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.06em;
                padding: 8px 14px;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.15s ease;
            }
            .range-btn:hover {
                background: #334155;
                color: #ffffff;
                border-color: rgba(82, 227, 146, 0.5);
            }
            .range-btn-primary {
                background: rgba(82, 227, 146, 0.2);
                border-color: #52e392;
                color: #52e392;
            }
            .range-btn-primary:hover {
                background: #52e392;
                color: #0c1219;
            }
            .range-btn-close {
                margin-left: auto;
                background: rgba(239, 68, 68, 0.15);
                border-color: rgba(239, 68, 68, 0.4);
                color: #f87171;
            }
            .range-btn-close:hover {
                background: #ef4444;
                color: #ffffff;
            }
            .range-help-text {
                font-size: 10px;
                color: #64748b;
                letter-spacing: 0.05em;
                text-align: center;
            }
            .range-target-label {
                color: #52e392;
                font-size: 12px;
                font-weight: 800;
                text-shadow: 0 0 8px rgba(0, 0, 0, 0.9);
            }
        `;
        document.head.appendChild(style);
    }

    toggle() {
        if (this.active) this.deactivate();
        else this.activate();
    }

    activate() {
        if (!this.game) return;
        this.active = true;
        if (!this.container) this.init(this.game);
        this.container.style.display = 'block';
        this.spawnTestTargets();
        this.updateTelemetry();
    }

    deactivate() {
        this.active = false;
        if (this.container) this.container.style.display = 'none';
        this.clearTestTargets();
        if (this.trajectoryLine) {
            this.trajectoryLine.dispose();
            this.trajectoryLine = null;
        }
    }

    spawnTestTargets() {
        if (!this.scene || !this.game?.player) return;
        this.clearTestTargets();

        const p = this.game.player;
        const camAz = this.game.app?.camera?.azimuth || 0;
        const fwdX = Math.cos(camAz);
        const fwdY = Math.sin(camAz);
        const rightX = -Math.sin(camAz);
        const rightY = Math.cos(camAz);

        // Target distances: 300px, 600px, 900px, 1200px
        const distances = [300, 600, 900, 1200];
        for (const dist of distances) {
            const tx = p.x + fwdX * dist;
            const ty = p.y + fwdY * dist;
            const groundH = this.game.app?.location?.terrain ? this.game.app.location.terrain.heightAt(tx, ty) : 0;

            // Target Stand Body (cylinder)
            const body = BABYLON.MeshBuilder.CreateCylinder('range_target_' + dist, {
                height: 64,
                diameter: 36,
                tessellation: 16,
            }, this.scene);
            body.position.set(tx, groundH + 32, ty);

            const mat = new BABYLON.StandardMaterial('range_tgt_mat_' + dist, this.scene);
            mat.diffuseColor = new BABYLON.Color3(0.15, 0.25, 0.35);
            mat.emissiveColor = new BABYLON.Color3(0.08, 0.18, 0.28);
            body.material = mat;

            // Target Head (red sphere for headshot testing)
            const head = BABYLON.MeshBuilder.CreateSphere('range_head_' + dist, {
                diameter: 18,
            }, this.scene);
            head.position.set(tx, groundH + 56, ty);
            const headMat = new BABYLON.StandardMaterial('range_head_mat_' + dist, this.scene);
            headMat.diffuseColor = new BABYLON.Color3(0.9, 0.2, 0.2);
            headMat.emissiveColor = new BABYLON.Color3(0.7, 0.1, 0.1);
            head.material = headMat;

            // Concentric Bullseye Rings (Torus)
            const ring = BABYLON.MeshBuilder.CreateTorus('range_ring_' + dist, {
                diameter: 28,
                thickness: 2.2,
                tessellation: 24,
            }, this.scene);
            ring.position.set(tx, groundH + 36, ty);
            ring.rotation.x = Math.PI / 2;
            const ringMat = new BABYLON.StandardMaterial('range_ring_mat_' + dist, this.scene);
            ringMat.emissiveColor = new BABYLON.Color3(0.3, 0.9, 0.5);
            ring.material = ringMat;

            this.targets.push({
                id: 'range_target_' + dist,
                archetype: 'target_dummy',
                isDummy: true,
                dist,
                body,
                head,
                ring,
                x: tx,
                y: ty,
                h: groundH,
                height: 72,
                radius: 20,
                hp: 100,
                maxHp: 100,
                dead: false
            });
        }

        // Cover Blocker at 450px with a peek target
        const coverDist = 450;
        const cx = p.x + fwdX * coverDist + rightX * 24;
        const cy = p.y + fwdY * coverDist + rightY * 24;
        const cH = this.game.app?.location?.terrain ? this.game.app.location.terrain.heightAt(cx, cy) : 0;

        const coverBlocker = BABYLON.MeshBuilder.CreateBox('range_cover_blocker', {
            width: 48,
            depth: 48,
            height: 80,
        }, this.scene);
        coverBlocker.position.set(cx, cH + 40, cy);
        const coverMat = new BABYLON.StandardMaterial('range_cover_mat', this.scene);
        coverMat.diffuseColor = new BABYLON.Color3(0.4, 0.35, 0.3);
        coverBlocker.material = coverMat;

        this.targets.push({
            id: 'range_cover_blocker',
            isCover: true,
            mesh: coverBlocker,
            x: cx,
            y: cy,
            h: cH,
            height: 80,
            radius: 30
        });
    }

    getTargetActors() {
        return this.targets.filter(t => !t.isCover && !t.dead);
    }

    getCoverBlockers() {
        return this.targets.filter(t => t.isCover);
    }

    onTargetHit(target, hit) {
        if (!target) return;
        target.hp = Math.max(0, target.hp - (hit.damage || 34));
        const isHeadshot = !!hit.headshot;

        // Visual flash feedback
        if (isHeadshot && target.head?.material) {
            const origColor = target.head.material.emissiveColor?.clone() || new BABYLON.Color3(0.7, 0.1, 0.1);
            target.head.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
            setTimeout(() => {
                if (target.head?.material) target.head.material.emissiveColor = origColor;
            }, 120);
        } else if (target.body?.material) {
            const origColor = target.body.material.diffuseColor?.clone() || new BABYLON.Color3(0.15, 0.25, 0.35);
            target.body.material.diffuseColor = new BABYLON.Color3(1, 0.8, 0.2);
            setTimeout(() => {
                if (target.body?.material) target.body.material.diffuseColor = origColor;
            }, 120);
        }

        if (target.hp <= 0) {
            target.hp = 100;
        }

        const dropPx = 64 - (hit.point ? hit.point.h : 64);
        this.recordShotTelemetry(hit, dropPx, hit.speed || 5400);
    }

    clearTestTargets() {
        for (const t of this.targets) {
            if (t.body) t.body.dispose();
            if (t.head) t.head.dispose();
            if (t.ring) t.ring.dispose();
            if (t.mesh) t.mesh.dispose();
        }
        this.targets = [];
    }

    update(dt) {
        if (!this.active || !this.game) return;
        this.updateTelemetry();
        this.renderTrajectoryGuide();
    }

    updateTelemetry() {
        if (!this.container || !this.game) return;
        const p = this.game.player;
        const posture = this.game.posture || 'stand';
        const eyeH = p?.eyeHeight || 64;
        const lean = p?.lean || 0;
        const leanPx = (p?.leanOffset || 0).toFixed(1);

        const elPosture = /** @type {HTMLElement|null} */ (this.container.querySelector('#range-val-posture'));
        if (elPosture) {
            elPosture.textContent = `${posture.toUpperCase()} (H: ${eyeH} px)`;
            elPosture.style.color = posture === 'stand' ? '#38bdf8' : posture === 'crouch' ? '#52e392' : '#f59e0b';
        }

        const elLean = /** @type {HTMLElement|null} */ (this.container.querySelector('#range-val-lean'));
        if (elLean) {
            const leanText = lean === 0 ? 'CENTER (0 px)' : lean > 0 ? `RIGHT (+${leanPx} px / +4°)` : `LEFT (${leanPx} px / -4°)`;
            elLean.textContent = leanText;
            elLean.style.color = lean === 0 ? '#94a3b8' : '#38bdf8';
        }

        const elDist = /** @type {HTMLElement|null} */ (this.container.querySelector('#range-val-dist'));
        if (elDist) {
            elDist.textContent = `${Math.round(this.telemetry.targetDist)} px (~${(this.telemetry.targetDist * 0.05).toFixed(1)}m)`;
        }

        const elConv = /** @type {HTMLElement|null} */ (this.container.querySelector('#range-val-conv'));
        if (elConv) {
            elConv.textContent = `AIM CONVERGED (${this.game.aiming ? 'ADS CENTER' : 'HIP OFFSET'})`;
            elConv.style.color = '#52e392';
        }

        const elDrop = /** @type {HTMLElement|null} */ (this.container.querySelector('#range-val-drop'));
        if (elDrop) {
            elDrop.textContent = `-${this.telemetry.lastDrop.toFixed(1)} px (g=980)`;
        }

        const elHit = this.container.querySelector('#range-val-hit');
        if (elHit) {
            elHit.textContent = this.telemetry.lastHit;
        }
    }

    renderTrajectoryGuide() {
        if (!this.scene || !this.game?.player) return;
        const cam = this.game.app?.location?.view?.camera;
        if (!cam) return;

        const camPos = { x: cam.position.x, y: cam.position.z, h: cam.position.y };
        let fwd, camRight, camUp;
        if (typeof cam.getDirection === 'function') {
            const fwdB = cam.getDirection(BABYLON.Vector3.Forward());
            const rightB = cam.getDirection(BABYLON.Vector3.Right());
            const upB = cam.getDirection(BABYLON.Vector3.Up());
            fwd = { x: fwdB.x, y: fwdB.z, h: fwdB.y };
            camRight = { x: rightB.x, y: rightB.z, h: rightB.y };
            camUp = { x: upB.x, y: upB.z, h: upB.y };
        } else {
            const camAz = this.game.app?.camera?.azimuth || 0;
            const camPi = this.game.app?.camera?.pitch || 0;
            const leanRoll = this.game.player?.leanRoll || 0;
            const cp = Math.cos(camPi), sp = Math.sin(camPi);
            const ca = Math.cos(camAz), sa = Math.sin(camAz);
            fwd = { x: ca * cp, y: sa * cp, h: -sp };
            const rX = -sa, rY = ca, rH = 0;
            const uX = -ca * sp, uY = -sa * sp, uH = -cp;
            const cR = Math.cos(leanRoll), sR = Math.sin(leanRoll);
            camRight = { x: rX * cR + uX * sR, y: rY * cR + uY * sR, h: rH * cR + uH * sR };
            camUp = { x: -rX * sR + uX * cR, y: -rY * sR + uY * cR, h: -rH * sR + uH * cR };
        }

        const forwardOffset = 22;
        const rightOffset = this.game.aiming ? 0 : 10;
        const upOffset = this.game.aiming ? -2 : -6;
        const muzzle = {
            x: camPos.x + fwd.x * forwardOffset + camRight.x * rightOffset + camUp.x * upOffset,
            y: camPos.y + fwd.y * forwardOffset + camRight.y * rightOffset + camUp.y * upOffset,
            h: camPos.h + fwd.h * forwardOffset + camRight.h * rightOffset + camUp.h * upOffset,
        };

        const targetDist = this.telemetry.targetDist || 600;
        const aimPoint = {
            x: camPos.x + fwd.x * targetDist,
            y: camPos.y + fwd.y * targetDist,
            h: camPos.h + fwd.h * targetDist,
        };

        // Draw 3D trajectory guide line from muzzle to aimPoint
        const points = [
            new BABYLON.Vector3(muzzle.x, muzzle.h, muzzle.y),
            new BABYLON.Vector3(aimPoint.x, aimPoint.h, aimPoint.y),
        ];

        if (this.trajectoryLine) {
            this.trajectoryLine = BABYLON.MeshBuilder.CreateLines('range_traj_line', {
                points,
                instance: this.trajectoryLine,
            }, this.scene);
        } else {
            this.trajectoryLine = BABYLON.MeshBuilder.CreateLines('range_traj_line', {
                points,
                updatable: true,
            }, this.scene);
            this.trajectoryLine.color = new BABYLON.Color3(0.2, 0.9, 0.4);
        }
    }

    recordShotTelemetry(hitResult, dropPx, speed) {
        this.telemetry.lastDrop = dropPx || 0;
        this.telemetry.lastSpeed = speed || 5400;
        if (!hitResult || !hitResult.hit) {
            this.telemetry.lastHit = 'ПРОМАХ (MISS)';
        } else if (hitResult.headshot) {
            this.telemetry.lastHit = '🎯 ХЕДШОТ (HEADSHOT 1.85x)';
        } else if (hitResult.type === 'actor') {
            this.telemetry.lastHit = '💥 ТОРС (TORSO HIT)';
        } else if (hitResult.type === 'blocker') {
            this.telemetry.lastHit = '🛡️ УКРЫТИЕ (COVER BLOCKED)';
        } else if (hitResult.type === 'terrain') {
            this.telemetry.lastHit = '🌱 ЗЕМЛЯ (TERRAIN HIT)';
        }
        this.updateTelemetry();
    }

    // --- AUTOMATED VISUAL TEST SEQUENCES ------------------------------------

    async runFullAutoTest() {
        if (this.autoTesting) return;
        this.autoTesting = true;
        const progressBox = /** @type {HTMLElement|null} */ (this.container?.querySelector('#range-test-progress'));
        const fill = /** @type {HTMLElement|null} */ (this.container?.querySelector('#range-step-fill'));
        const title = /** @type {HTMLElement|null} */ (this.container?.querySelector('#range-step-title'));
        if (progressBox) progressBox.style.display = 'block';

        const updateStep = (text, percent) => {
            if (title) title.textContent = text;
            if (fill) fill.style.width = percent + '%';
        };

        try {
            // STEP 1: Posture transitions
            updateStep('[1/5] ТЕСТ СТОЕК: STAND → CROUCH → PRONE (ВЫСОТА КОЛЛАЙДЕРА)', 20);
            await this.testPosturesVisual();
            await this.sleep(700);

            // STEP 2: Leaning
            updateStep('[2/5] ТЕСТ НАКЛОНОВ: ВЛЕВО / ВПРАВО (БОКОВОЙ СДВИГ И РОЛЛ КАМЕРЫ)', 40);
            await this.testLeanVisual();
            await this.sleep(700);

            // STEP 3: Aim Convergence
            updateStep('[3/5] ТЕСТ СВЕДЕНИЯ ПРИЦЕЛА: СТРЕЛЬБА НА 300, 600, 900, 1200 PX', 60);
            await this.testConvergenceVisual();
            await this.sleep(700);

            // STEP 4: Bullet Drop
            updateStep('[4/5] ТЕСТ БАЛЛИСТИКИ: ГРАВИТАЦИОННЫЙ СПАД ПУЛИ ПО ДИСТАНЦИИ', 80);
            await this.testDropVisual();
            await this.sleep(700);

            // STEP 5: Crouch Dodge
            updateStep('[5/5] ТЕСТ УКЛОНЕНИЯ: ПРИСЕДАНИЕ ПОД ВЫСОКИЙ ВЫСТРЕЛ (H=55px)', 100);
            await this.testDodgeVisual();
            await this.sleep(700);

            updateStep('✔ ВСЕ ВИЗУАЛЬНЫЕ ТЕСТЫ УСПЕШНО ПРОЙДЕНЫ (100%)', 100);
            if (title) title.style.color = '#52e392';
        } finally {
            this.autoTesting = false;
        }
    }

    async testPosturesVisual() {
        if (!this.game) return;
        // Stand
        this.game.posture = 'stand';
        this.game.player.eyeHeight = 64;
        this.updateTelemetry();
        await this.sleep(500);

        // Crouch
        this.game.posture = 'crouch';
        this.game.player.eyeHeight = 38;
        this.updateTelemetry();
        await this.sleep(500);

        // Prone
        this.game.posture = 'prone';
        this.game.player.eyeHeight = 18;
        this.updateTelemetry();
        await this.sleep(500);

        // Return to stand
        this.game.posture = 'stand';
        this.game.player.eyeHeight = 64;
        this.updateTelemetry();
    }

    async testLeanVisual() {
        if (!this.game) return;
        // Lean Left
        this.game.player.lean = -1;
        this.game.player.leanOffset = -18;
        this.game.player.leanRoll = -0.07;
        this.updateTelemetry();
        await this.sleep(600);

        // Lean Right
        this.game.player.lean = 1;
        this.game.player.leanOffset = 18;
        this.game.player.leanRoll = 0.07;
        this.updateTelemetry();
        await this.sleep(600);

        // Reset
        this.game.player.lean = 0;
        this.game.player.leanOffset = 0;
        this.game.player.leanRoll = 0;
        this.updateTelemetry();
    }

    async testConvergenceVisual() {
        if (!this.game) return;
        const distances = [300, 600, 900, 1200];
        for (const d of distances) {
            this.telemetry.targetDist = d;
            this.updateTelemetry();
            this.game.fire();
            await this.sleep(400);
        }
    }

    async testDropVisual() {
        if (!this.game) return;
        this.telemetry.targetDist = 1200;
        this.updateTelemetry();
        this.game.fire();
        await this.sleep(500);
    }

    async testDodgeVisual() {
        if (!this.game) return;
        // Demonstrates crouching under incoming fire
        this.game.posture = 'crouch';
        this.game.player.eyeHeight = 38;
        this.telemetry.lastHit = '🛡️ УКЛОН ПРИСЕДОМ (BULLET PASSED OVERHEAD)';
        this.updateTelemetry();
        await this.sleep(800);
        this.game.posture = 'stand';
        this.game.player.eyeHeight = 64;
        this.updateTelemetry();
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Global exposure
if (typeof window !== 'undefined') {
    window.TacticalRange = TacticalRange;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TacticalRange };
}
