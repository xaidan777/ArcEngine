// main.js — точка входа: 3D-движок -> локация с объектами из Objects.js -> камера ->
// цикл кадров. window.app = { location, camera } — для консоли и для кода игры,
// который строится поверх набора.

function updateLoadingProgress(percent) {
    const bar = document.querySelector('.loading-progress');
    if (bar) bar.style.width = percent + '%';
}

// Экран загрузки уходит, когда локация готова.
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

function startGame() {
    if (window.app) return;                 // защита от повторного запуска
    if (typeof SimplexNoise === 'undefined') { showBootError('Нет libs/simplex-noise.js'); return; }
    const canvas = document.getElementById('world3d');
    updateLoadingProgress(40);
    if (!World3D.init(canvas)) { showBootError('3D недоступен: нет libs/babylon.js или WebGL'); return; }

    const location = new Location3D({ objects: typeof LOCATION_OBJECTS !== 'undefined' ? LOCATION_OBJECTS : [] });
    const camera = new CameraController(location.view, {
        terrain: location.terrain,
        bounds: { w: location.width, h: location.height }
    });
    camera.attach(canvas);
    window.app = { location, camera };
    console.log('ArcEngine: локация запущена, объектов ' + location.objects.length + '.');
    updateLoadingProgress(70);

    let last = performance.now();
    World3D.engine.runRenderLoop(() => {
        const now = performance.now(), dt = (now - last) / 1000;
        last = now;
        location.update(dt);
        camera.update(dt);
        World3D.renderFrame();
    });
    window.addEventListener('resize', () => World3D.resize());
    location.ready.then(hideLoader);
}

window.onload = () => startGame();
