// main.js — entry point: 3D engine -> location with objects from Objects.js -> camera ->
// UI (UILayout.js) -> game (Game.js) -> frame loop. window.app = { location, camera, game } —
// for the console and for game code built on top of the kit.

function updateLoadingProgress(percent) {
    const bar = /** @type {HTMLElement | null} */ (document.querySelector('.loading-progress'));
    if (bar) bar.style.width = percent + '%';
}

// The loading screen goes away when the location is ready.
function hideLoader() {
    updateLoadingProgress(100);
    setTimeout(() => {
        const screen = document.getElementById('loading-screen');
        if (screen) screen.style.display = 'none';
    }, 300);
}

function showBootError(text) {
    console.error(text);
    const el = document.querySelector('.loading-text');
    if (el) el.textContent = text;
}

async function startGame() {
    if (window.app) return;                 // guard against a repeated start
    if (typeof SimplexNoise === 'undefined') { showBootError('Нет libs/simplex-noise.js'); return; }
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('world3d'));
    updateLoadingProgress(40);
    if (typeof ArcJobSystem !== 'undefined') {
        ArcJobSystem.init();
    }
    if (!(await World3D.initAsync(canvas))) { showBootError('3D недоступен: нет libs/babylon.js или WebGL/WebGPU'); return; }

    const level = await MapPool.load(new URLSearchParams(window.location.search).get('map') || 'default_raid');
    MapPool.activate(level);
    const location = new Location3D({ level, objects: level.props || (typeof LOCATION_OBJECTS !== 'undefined' ? LOCATION_OBJECTS : []) });
    await location.terrain.ready;
    const camera = new CameraController(location.view, {
        terrain: location.terrain,
        bounds: { w: location.width, h: location.height }
    });
    camera.attach(canvas);
    UI.init(canvas);
    window.app = { location, camera, game: null };
    if (typeof ArcEngine !== 'undefined') {
        ArcEngine.init({
            scene: location.view.scene,
            camera: camera.cam,
            canvas
        });
    }
    if (typeof ArcPerformanceOverlay !== 'undefined') {
        ArcPerformanceOverlay.init(World3D.engine, typeof ArcEngine !== 'undefined' ? ArcEngine : null);
    }
    const game = window.app.game = new Game(window.app);
    console.log('Blackwater Protocol: raid environment ready, objects ' + location.objects.length + '.');
    updateLoadingProgress(70);

    let last = performance.now();
    World3D.engine.runRenderLoop(() => {
        const now = performance.now(), dt = (now - last) / 1000;
        last = now;
        game.update(Math.min(0.1, dt));
        location.update(dt);
        camera.update(dt);
        World3D.renderFrame();
    });
    window.addEventListener('resize', () => World3D.resize());
    const readyPromises = Promise.all([location.ready, game.ready || Promise.resolve()]);
    const timeoutFallback = new Promise(resolve => setTimeout(resolve, 2000));
    Promise.race([readyPromises, timeoutFallback]).then(hideLoader);
}

window.onload = () => startGame().catch(e => showBootError(e.message));
