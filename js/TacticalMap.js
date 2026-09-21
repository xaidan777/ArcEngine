// TacticalMap.js — In-raid full-screen tactical sector map for ArcEngine / Blackwater Protocol.
// Renders sector topography, public extraction points (Elevator A, Metro B), bunker hatch,
// data drive intel packets, containers, and live player position with heading frustum.

class TacticalMap {
    constructor() {
        this.container = null;
        /** @type {HTMLCanvasElement|null} */
        this.canvas = null;
        /** @type {CanvasRenderingContext2D|null} */
        this.ctx = null;
        this.visible = false;
        this.game = null;
    }

    init(root) {
        if (this.container) return;
        // Viewport overlays must live outside `.arc-ui`: that root is scaled from
        // the 1280x720 reference canvas and would scale this full-screen map twice.
        const parent = document.body;

        const mapDiv = document.createElement('div');
        mapDiv.id = 'arc-tactical-map-overlay';
        mapDiv.className = 'arc-tactical-map-overlay';
        mapDiv.style.display = 'none';

        mapDiv.innerHTML = `
            <div class="arc-tactical-map-window">
                <div class="arc-map-header">
                    <div class="arc-map-title-block">
                        <span class="arc-map-tag">TACTICAL RECONNAISSANCE</span>
                        <h2 class="arc-map-title">СЕКТОР 01 // ПРОМЫШЛЕННЫЙ ПЕРИМЕТР</h2>
                        <span class="arc-map-sub">GRID 04-B · 4096×4096 M · EXTRACTION OPERATIONAL</span>
                    </div>
                    <div class="arc-map-status-block">
                        <div class="arc-map-timer-box">
                            <span class="arc-map-timer-label">ВРЕМЯ ДО ЗАКРЫТИЯ СЕКТОРА</span>
                            <span class="arc-map-timer-val" id="arc-map-timer">20:00</span>
                        </div>
                        <button class="arc-map-surrender-btn" id="arc-map-surrender-btn" title="Сдаться и покинуть рейд">СДАТЬСЯ</button>
                        <button class="arc-map-close-btn" id="arc-map-close-btn">ESC ЗАКРЫТЬ [M]</button>
                    </div>
                </div>

                <div class="arc-map-body">
                    <div class="arc-map-canvas-wrap">
                        <canvas id="arc-map-canvas" width="680" height="680"></canvas>
                    </div>
                    <div class="arc-map-sidebar">
                        <div class="arc-map-legend-card">
                            <h3 class="arc-sidebar-heading">ОБОЗНАЧЕНИЯ НА КАРТЕ</h3>
                            <div class="arc-legend-item">
                                <span class="arc-legend-icon arc-ico-player">▲</span>
                                <div class="arc-legend-text">
                                    <strong>ВЫ (ОПЕРАТОР)</strong>
                                    <span>Текущая позиция и азимут</span>
                                </div>
                            </div>
                            <div class="arc-legend-item">
                                <span class="arc-legend-icon arc-ico-extract">▲</span>
                                <div class="arc-legend-text">
                                    <strong>ВЫХОД А: ГРУЗОВОЙ ЛИФТ</strong>
                                    <span>Северо-Восток · Консоль вызова</span>
                                </div>
                            </div>
                            <div class="arc-legend-item">
                                <span class="arc-legend-icon arc-ico-metro">▲</span>
                                <div class="arc-legend-text">
                                    <strong>ВЫХОД B: СТАНЦИЯ МЕТРО</strong>
                                    <span>Западный перрон · Консоль вызова</span>
                                </div>
                            </div>
                            <div class="arc-legend-item">
                                <span class="arc-legend-icon arc-ico-hatch">🔒</span>
                                <div class="arc-legend-text">
                                    <strong>БУНКЕРНЫЙ ЛЮК</strong>
                                    <span>Скрытый выход · Нужен ключ Люка</span>
                                </div>
                            </div>
                            <div class="arc-legend-item">
                                <span class="arc-legend-icon arc-ico-data">◆</span>
                                <div class="arc-legend-text">
                                    <strong>НАКОПИТЕЛЬ ДАННЫХ</strong>
                                    <span>Опционально · +300 CR · Световой маяк</span>
                                </div>
                            </div>
                            <div class="arc-legend-item">
                                <span class="arc-legend-icon arc-ico-cache">■</span>
                                <div class="arc-legend-text">
                                    <strong>КОНТЕЙНЕР С ПРИПАСАМИ</strong>
                                    <span>Патроны, аптечки, компоненты</span>
                                </div>
                            </div>
                        </div>

                        <div class="arc-map-intel-card">
                            <h3 class="arc-sidebar-heading">СТАТУС МИССИИ</h3>
                            <div class="arc-intel-row">
                                <span>ЭВАКУАЦИЯ:</span>
                                <span class="arc-text-avail" id="arc-map-extract-status">ДОСТУПНА (ВЫЗОВ)</span>
                            </div>
                            <div class="arc-intel-row">
                                <span>ДАННЫЕ РЕЙДА:</span>
                                <span id="arc-map-intel-count">0 / 3 НАЙДЕНО</span>
                            </div>
                            <div class="arc-intel-row">
                                <span>ЦЕННОСТЬ ДОБЫЧИ:</span>
                                <span class="arc-text-gold" id="arc-map-loot-value">0 CREDITS</span>
                            </div>
                            <div class="arc-intel-row">
                                <span>АКТИВНОСТЬ ARC:</span>
                                <span class="arc-text-danger">ВЫСОКАЯ (ПАТРУЛИ)</span>
                            </div>
                        </div>

                        <div class="arc-map-hint-card">
                            <p><strong>СОВЕТ ОПЕРАТОРУ:</strong> Вызов грузового лифта активирует громкую сирену и стягивает дронов ARC. Займите укрытие за ящиками до посадки транспорта.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        parent.appendChild(mapDiv);
        this.container = mapDiv;
        this.canvas = /** @type {HTMLCanvasElement|null} */ (mapDiv.querySelector('#arc-map-canvas'));
        if (this.canvas) this.ctx = this.canvas.getContext('2d');

        const closeBtn = mapDiv.querySelector('#arc-map-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', () => this.close());

        const surrenderBtn = mapDiv.querySelector('#arc-map-surrender-btn');
        if (surrenderBtn) {
            surrenderBtn.addEventListener('click', async () => {
                this.close();
                if (this.game) {
                    if (this.game.onlineBridge && typeof this.game.onlineBridge.surrender === 'function') {
                        await this.game.onlineBridge.surrender();
                    }
                    if (this.game.phase === 'raid') {
                        this.game.finish(false);
                    }
                }
            });
        }
    }

    toggle(game) {
        if (this.visible) this.close();
        else this.open(game);
    }

    open(game) {
        if (!this.container) this.init();
        this.game = game;
        this.visible = true;
        this.container.style.display = 'flex';
        if (document.exitPointerLock && document.pointerLockElement) {
            document.exitPointerLock();
        }
        this.render();
    }

    close() {
        if (!this.visible) return;
        this.visible = false;
        if (this.container) this.container.style.display = 'none';
    }

    isOpen() {
        return this.visible;
    }

    render() {
        if (!this.visible || !this.ctx || !this.canvas || !this.game) return;
        const ctx = this.ctx;
        const g = this.game;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const worldSize = 4096;
        const toMapX = (wx) => (wx / worldSize) * w;
        const toMapY = (wy) => (wy / worldSize) * h;

        // 1. Dark high-tech background
        ctx.fillStyle = '#0a0f14';
        ctx.fillRect(0, 0, w, h);

        // 2. Coordinate Grid Lines
        ctx.strokeStyle = '#142028';
        ctx.lineWidth = 1;
        const step = w / 8;
        for (let x = 0; x <= w; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0; y <= h; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Concentric radar circles
        ctx.strokeStyle = '#162832';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, w * 0.22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, w * 0.44, 0, Math.PI * 2);
        ctx.stroke();

        // 3. Sector Landmarks & Industrial zones
        // Factory Complex
        ctx.fillStyle = 'rgba(28, 48, 56, 0.45)';
        ctx.strokeStyle = '#284650';
        ctx.lineWidth = 1.5;
        const fX = toMapX(380), fY = toMapY(1200), fW = toMapX(700), fH = toMapY(600);
        ctx.fillRect(fX, fY, fW, fH);
        ctx.strokeRect(fX, fY, fW, fH);
        ctx.fillStyle = '#48727d';
        ctx.font = '10px monospace';
        ctx.fillText('ЗАВОДСКОЙ ЦЕХ // СЕКЦИЯ 4', fX + 8, fY + 18);

        // Warehouses
        const wX = toMapX(1800), wY = toMapY(1600), wW = toMapX(600), wH = toMapY(500);
        ctx.fillStyle = 'rgba(28, 48, 56, 0.45)';
        ctx.fillRect(wX, wY, wW, wH);
        ctx.strokeRect(wX, wY, wW, wH);
        ctx.fillStyle = '#48727d';
        ctx.fillText('СКЛАДСКОЙ ХАБ // АРЕНА', wX + 8, wY + 18);

        // Power Substation
        const sX = toMapX(2900), sY = toMapY(2500), sW = toMapX(550), sH = toMapY(450);
        ctx.fillStyle = 'rgba(28, 48, 56, 0.45)';
        ctx.fillRect(sX, sY, sW, sH);
        ctx.strokeRect(sX, sY, sW, sH);
        ctx.fillStyle = '#48727d';
        ctx.fillText('ТРАНСФОРМАТОРНАЯ ПОДСТАНЦИЯ', sX + 8, sY + 18);

        // Dam & Water Reservoir (South)
        ctx.fillStyle = 'rgba(15, 38, 45, 0.6)';
        ctx.beginPath();
        ctx.ellipse(toMapX(1200), toMapY(3300), toMapX(750), toMapY(450), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#32606e';
        ctx.fillText('ВОДОХРАНИЛИЩЕ // ДАМБА', toMapX(850), toMapY(3320));

        // 4. Draw Supply Containers
        if (Array.isArray(g.containers)) {
            for (const c of g.containers) {
                const cx = toMapX(c.x);
                const cy = toMapY(c.y);
                ctx.fillStyle = c.opened ? '#404c50' : '#f59e0b';
                ctx.fillRect(cx - 3, cy - 3, 6, 6);
                if (!c.opened) {
                    ctx.strokeStyle = '#fbbf24';
                    ctx.strokeRect(cx - 4, cy - 4, 8, 8);
                }
            }
        }

        // 5. Draw Optional Data Drives (pickups)
        if (Array.isArray(g.pickups)) {
            for (let i = 0; i < g.pickups.length; i++) {
                const p = g.pickups[i];
                if (p.taken) continue;
                const px = toMapX(p.x);
                const py = toMapY(p.y);

                // Pulsing diamond
                ctx.save();
                ctx.translate(px, py);
                ctx.fillStyle = '#00e5ff';
                ctx.shadowColor = '#00e5ff';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.moveTo(0, -7);
                ctx.lineTo(6, 0);
                ctx.lineTo(0, 7);
                ctx.lineTo(-6, 0);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                ctx.fillStyle = '#5eead4';
                ctx.font = '9px monospace';
                ctx.fillText(`ДАННЫЕ #${i + 1}`, px + 8, py + 3);
            }
        }

        // 6. Extraction Points
        // Primary Extraction Alpha: Cargo Elevator (3680, 520)
        const ex = toMapX(g.extract ? g.extract.x : 3680);
        const ey = toMapY(g.extract ? g.extract.y : 520);
        ctx.save();
        ctx.strokeStyle = g.extractState === 'boarding' ? '#22c55e' : '#10b981';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
        ctx.beginPath();
        ctx.arc(ex, ey, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#10b981';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('▲ ВЫХОД A', ex, ey - 22);
        ctx.font = '9px monospace';
        ctx.fillText(g.extractState === 'inbound' ? `[В ПУТИ ${Math.ceil(g.inboundTimer)}c]` :
            g.extractState === 'boarding' ? '[ПОСАДКА]' : '[ЛИФТ ГОТОВ]', ex, ey + 28);
        ctx.restore();

        // Secondary Extraction Beta: Metro Station (650, 1150)
        const mx = toMapX(g.metroExtract ? g.metroExtract.x : 650);
        const my = toMapY(g.metroExtract ? g.metroExtract.y : 1150);
        ctx.save();
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(6, 182, 212, 0.18)';
        ctx.beginPath();
        ctx.arc(mx, my, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#06b6d4';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('▲ ВЫХОД B', mx, my - 20);
        ctx.font = '9px monospace';
        const mState = g.metroExtract ? g.metroExtract.state : 'available';
        ctx.fillText(mState === 'inbound' ? `[В ПУТИ]` : mState === 'boarding' ? '[ПОСАДКА]' : '[МЕТРО ГОТОВО]', mx, my + 26);
        ctx.restore();

        // Bunker Hatch (2100, 2450)
        const hx = toMapX(g.hatchExtract ? g.hatchExtract.x : 2100);
        const hy = toMapY(g.hatchExtract ? g.hatchExtract.y : 2450);
        ctx.save();
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(234, 179, 8, 0.15)';
        ctx.beginPath();
        ctx.arc(hx, hy, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('🔒 ЛЮК БУНКЕРА', hx, hy - 18);
        ctx.font = '8px monospace';
        ctx.fillText('[НУЖЕН КЛЮЧ]', hx, hy + 22);
        ctx.restore();

        // 7. Live Player Marker with Orientation and FOV cone
        const px = toMapX(g.player.x);
        const py = toMapY(g.player.y);
        const heading = (g.app && g.app.camera) ? g.app.camera.azimuth - Math.PI / 2 : (g.player.heading || 0);

        ctx.save();
        ctx.translate(px, py);

        // View frustum cone
        ctx.fillStyle = 'rgba(245, 166, 35, 0.15)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 36, heading - 0.35, heading + 0.35);
        ctx.closePath();
        ctx.fill();

        // Direction Arrow
        ctx.rotate(heading);
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-6, -6);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();

        // Player label
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('ВЫ (ОПЕРАТОР)', px, py - 12);

        // 8. Update sidebar status values
        const timerEl = this.container.querySelector('#arc-map-timer');
        if (timerEl && typeof g.raidTimer === 'number') {
            const m = Math.floor(g.raidTimer / 60);
            const s = Math.floor(g.raidTimer % 60);
            timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        const extStatusEl = this.container.querySelector('#arc-map-extract-status');
        if (extStatusEl) {
            extStatusEl.textContent = g.extractState === 'inbound' ? `ТРАНСПОРТ В ПУТИ (${Math.ceil(g.inboundTimer)}с)` :
                g.extractState === 'boarding' ? 'ПОСАДКА В ЗОНЕ' : 'ДОСТУПНА ДЛЯ ВЫЗОВА';
        }
        const intelCountEl = this.container.querySelector('#arc-map-intel-count');
        if (intelCountEl) {
            intelCountEl.textContent = `${g.loot || 0} / 3 НАЙДЕНО`;
        }
        const lootValEl = this.container.querySelector('#arc-map-loot-value');
        if (lootValEl) {
            lootValEl.textContent = `${g.raidValue || 0} CREDITS`;
        }
    }
}

if (typeof window !== 'undefined') {
    window.TacticalMap = TacticalMap;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TacticalMap;
}
