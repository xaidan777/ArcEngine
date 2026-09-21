import { spawn } from 'node:child_process';
import fs from 'node:fs';

async function main() {
    const PORT = 9750 + Math.floor(Math.random() * 200);
    const profileDir = fs.mkdtempSync('/tmp/arcaudit-editor-');
    const url = 'http://127.0.0.1:8090/_utils/editor/?map=forest_map';

    console.log('Launching headless Chrome on', url, 'port', PORT);
    const chrome = spawn('/usr/bin/google-chrome', [
        '--headless=new',
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${profileDir}`,
        '--disable-extensions',
        '--no-sandbox',
        '--enable-unsafe-swiftshader',
        '--disable-dev-shm-usage',
        '--mute-audio',
        '--window-size=1600,900',
        url
    ], { stdio: 'ignore' });

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let targets = null;
    for (let i = 0; i < 60; i++) {
        await sleep(250);
        try {
            targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            if (targets?.some(t => t.type === 'page' && t.url.includes('_utils/editor'))) break;
        } catch {}
    }

    const target = targets?.find(t => t.type === 'page' && t.url.includes('_utils/editor'));
    if (!target) throw new Error('no page target for editor');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 1;
    const pending = new Map();
    ws.onmessage = evt => {
        const d = JSON.parse(evt.data);
        if (d.id && pending.has(d.id)) {
            const p = pending.get(d.id);
            pending.delete(d.id);
            d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result);
        }
        else if (d.method === 'Runtime.consoleAPICalled') {
            console.log('[BROWSER]', d.params.type, d.params.args.map(a => a.value ?? a.description ?? '').join(' '));
        } else if (d.method === 'Runtime.exceptionThrown') {
            console.log('[EXCEPTION]', d.params.exceptionDetails.text, d.params.exceptionDetails.exception?.description);
        }
    };

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const mid = id++;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });

    const evaluate = async expr => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval failed');
        return r.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Waiting for editor Lab to boot...');
    let booted = false;
    for (let i = 0; i < 60; i++) {
        await sleep(500);
        try {
            if (await evaluate('Boolean(typeof Lab !== "undefined" && Lab.location && Lab.location.terrain)')) {
                booted = true;
                break;
            }
        } catch {}
    }
    if (!booted) throw new Error('Editor did not boot in time');

    console.log('Triggering MapEditor.load("forest_map")...');
    const loadResult = await evaluate(`
        (async function() {
            try {
                window.confirm = () => true;
                await MapEditor.load("forest_map", true);
                return { ok: true, id: MapEditor.id, props: Lab.location.objects.length };
            } catch (err) {
                return { ok: false, error: err.message, stack: err.stack };
            }
        })()
    `);
    console.log('LOAD RESULT:', JSON.stringify(loadResult, null, 2));

    const diag = await evaluate(`
        (function() {
            return {
                mapId: typeof MapEditor !== 'undefined' ? MapEditor.id : null,
                propsCount: typeof Lab !== 'undefined' && Lab.location ? Lab.location.objects.length : null,
                hasLiveAgent: typeof LiveAgent !== 'undefined',
                liveStatus: document.getElementById('arc-live-status')?.textContent,
                liveCounter: document.getElementById('arc-live-counter')?.textContent,
                sunEnabled: Lab.location?.opts?.level?.lighting?.sunEnabled,
                sunIntensity: Lab.location?.opts?.level?.lighting?.sunIntensity
            };
        })()
    `);

    const firstObj = await evaluate(`
        (function() {
            const first = Lab.location.objects[0];
            return {
                name: first?.def?.name,
                model: first?.def?.model,
                hasMesh: !!first?.mesh,
                meshPos: first?.mesh ? [first.mesh.position.x, first.mesh.position.y, first.mesh.position.z] : null,
                meshScaling: first?.mesh ? [first.mesh.scaling.x, first.mesh.scaling.y, first.mesh.scaling.z] : null,
                meshChildren: first?.mesh ? first.mesh.getChildMeshes().length : null,
                error: first?.error,
                terrainH: Lab.location.terrain ? Lab.location.terrain.heightAt(2125, 995) : null
            };
        })()
    `);
    console.log('FIRST OBJECT DETAILS:', JSON.stringify(firstObj, null, 2));

    // Focus camera on survivor camp and zoom out to see wide forest
    await evaluate(`
        if (typeof Lab !== "undefined" && Lab.camera) {
            Lab.camera.lookAt(2135, 983);
            Lab.camera.zoom = 0.35;
            Lab.camera.zoomTarget = 0.35;
        }
    `);
    await sleep(2500);

    const ss = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/home/aggregate/Desktop/ArcEngine/scratch/forest_editor_screenshot.png', Buffer.from(ss.data, 'base64'));
    console.log('Saved screenshot 1 to scratch/forest_editor_screenshot.png');

    // Focus camera on Pine Ridge & Watchtower with good zoom
    await evaluate(`
        if (typeof Lab !== "undefined" && Lab.camera) {
            Lab.camera.lookAt(3050, 2150);
            Lab.camera.zoom = 0.35;
            Lab.camera.zoomTarget = 0.35;
        }
    `);
    await sleep(2000);

    const ss2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/home/aggregate/Desktop/ArcEngine/scratch/forest_ridge_screenshot.png', Buffer.from(ss2.data, 'base64'));
    console.log('Saved screenshot 2 to scratch/forest_ridge_screenshot.png');

    try { ws.close(); } catch {}
    chrome.kill('SIGKILL');
}

main().catch(console.error);
