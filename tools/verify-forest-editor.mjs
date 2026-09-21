import { launch } from '../scratch/audit/cdp.mjs';
import fs from 'node:fs';

async function main() {
    console.log('Connecting to editor via CDP...');
    // We launch Chrome pointing directly to editor on forest_map
    const cdp = await launch('http://127.0.0.1:8090/_utils/editor/?map=forest_map', { settle: 4500 });
    console.log('Editor page loaded, checking state...');

    const diag = await cdp.evaluate(`
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

    console.log('DIAGNOSTICS:', JSON.stringify(diag, null, 2));

    // Focus camera on survivor camp
    await cdp.evaluate(`
        if (typeof Lab !== 'undefined' && Lab.camera) {
            Lab.camera.lookAt(2135, 983);
        }
    `);

    // Wait a bit for models and textures to settle
    await new Promise(r => setTimeout(r, 2500));

    const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/home/aggregate/Desktop/ArcEngine/scratch/forest_editor_screenshot.png', Buffer.from(ss.data, 'base64'));
    console.log('Screenshot saved to scratch/forest_editor_screenshot.png');

    // Also look at the pine ridge / watchtower
    await cdp.evaluate(`
        if (typeof Lab !== 'undefined' && Lab.camera) {
            Lab.camera.lookAt(3050, 2150);
        }
    `);
    await new Promise(r => setTimeout(r, 2000));
    const ss2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/home/aggregate/Desktop/ArcEngine/scratch/forest_ridge_screenshot.png', Buffer.from(ss2.data, 'base64'));
    console.log('Screenshot saved to scratch/forest_ridge_screenshot.png');

    cdp.close();
}

main().catch(console.error);
