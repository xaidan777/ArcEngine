// ============================================================================
//  ArcEngine — local dev server (Node, no dependencies)
// ----------------------------------------------------------------------------
//  Why not python -m http.server:
//   1. no-store on EVERYTHING. There is no build step, scripts are included as is,
//      and the browser happily serves a cached old .js after an edit;
//   2. correct MIME types (.mjs, .mp3, .ttf, .webp, .glb);
//   3. Range requests — Chrome sends them for audio;
//   4. at startup — an asset check: missing files are visible right away;
//   5. quiet console: /favicon.ico gets 204 instead of 404.
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
// Port: --port=N > the PORT environment variable (set by the Claude Code browser
// pane with autoPort) > 8080. A busy port is changed to +1 by the server itself.
const argPort = process.argv.find(a => /^--port=\d+$/.test(a));
const envPort = /^\d+$/.test(process.env.PORT || '') ? Number(process.env.PORT) : null;
const PORT_BASE = argPort ? Number(argPort.split('=')[1]) : (envPort ?? 8080);
const NO_OPEN = process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ico':  'image/x-icon',
  '.glb':  'model/gltf-binary',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
};

const C = {
  r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m',
};

// --- preflight asset check -------------------------------------------------
// The same scanner as in build.mjs, but here it only warns.
async function preflight() {
  const { collectRefs } = await import('./asset-scan.mjs');
  const { refs, missing } = await collectRefs(ROOT);
  if (missing.length) {
    console.log(`${C.red}${C.b}  !! Не хватает ассетов (${missing.length}):${C.r}`);
    for (const m of missing) console.log(`     ${C.red}x${C.r} ${m}`);
    console.log(`${C.dim}     Игра запустится, но этих файлов в ней не будет.${C.r}\n`);
  } else {
    console.log(`${C.grn}  ok${C.r} ${C.dim}все ${refs.length} ассетов на месте${C.r}\n`);
  }
}

function send(res, code, headers, body) {
  res.writeHead(code, headers);
  if (body === undefined) res.end(); else res.end(body);
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad URL');
  }
  if (pathname === '/') pathname = '/index.html';

  // guard against escaping the root
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden');
  }

  let st;
  try {
    st = await fsp.stat(filePath);
  } catch {
    // The browser requests the icon on its own; the game has none.
    if (pathname === '/favicon.ico') return send(res, 204, { 'Cache-Control': 'no-store' });
    console.log(`  ${C.red}404${C.r} ${pathname}`);
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found: ' + pathname);
  }
  if (st.isDirectory()) return send(res, 403, { 'Content-Type': 'text/plain' }, 'Directory listing off');

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  // no-store, not no-cache: no-cache still allows a 304 via If-Modified-Since,
  // and Chrome keeps running the old .js. Local development needs exactly no-store.
  const base = {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  };

  // Range — Chrome sends it for <audio>/decodeAudioData
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end   = m[2] === '' ? null : Number(m[2]);
      if (start === null) { start = st.size - (end || 0); end = st.size - 1; }
      if (end === null || end >= st.size) end = st.size - 1;
      if (start < 0 || start > end) {
        return send(res, 416, { ...base, 'Content-Range': `bytes */${st.size}` });
      }
      res.writeHead(206, {
        ...base,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, { ...base, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
});

// port busy -> try the next one, up to +20
function listen(port, attempt = 0) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && attempt < 20) {
      console.log(`${C.dim}  порт ${port} занят, пробую ${port + 1}${C.r}`);
      return listen(port + 1, attempt + 1);
    }
    console.error(`${C.red}Не удалось поднять сервер: ${err.message}${C.r}`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', async () => {
    const addr = `http://localhost:${port}/`;
    console.log(`\n${C.cyn}${C.b}  ArcEngine${C.r} ${C.dim}— dev server${C.r}`);
    console.log(`${C.dim}  ${'-'.repeat(46)}${C.r}`);
    console.log(`  ${C.grn}${C.b}${addr}${C.r}`);
    console.log(`${C.dim}  корень: ${ROOT}${C.r}`);
    console.log(`${C.dim}  кэш: no-store — правку .js видно после F5, без Ctrl+Shift+R${C.r}`);
    console.log(`${C.dim}  Ctrl+C — остановить${C.r}\n`);
    await preflight().catch(e => console.log(`${C.ylw}  (проверка ассетов пропущена: ${e.message})${C.r}\n`));
    if (!NO_OPEN) {
      const cmd = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
      const args = process.platform === 'win32' ? ['/c', 'start', '', addr] : [addr];
      execFile(cmd, args, () => {});
    }
  });
}

listen(PORT_BASE);
