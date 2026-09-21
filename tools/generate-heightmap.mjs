// tools/generate-heightmap.mjs
// Generates a 16-bit grayscale PNG heightmap for ArcEngine terrain and level design.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

// --- Simplex-like Perlin noise implementation for standalone execution ---
class FastNoise {
  constructor(seed = 1337) {
    this.p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    // Fisher-Yates shuffle with seed
    let s = seed;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }

  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(t, a, b) { return a + t * (b - a); }
  grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
  }

  noise2D(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = this.fade(xf), v = this.fade(yf);
    const aa = this.p[this.p[X] + Y], ab = this.p[this.p[X] + Y + 1];
    const ba = this.p[this.p[X + 1] + Y], bb = this.p[this.p[X + 1] + Y + 1];
    return this.lerp(v,
      this.lerp(u, this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf)),
      this.lerp(u, this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1))
    );
  }

  fbm(x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let total = 0, frequency = 1.0, amplitude = 1.0, maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxAmp += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }
    return total / maxAmp;
  }
}

// --- 16-bit Grayscale PNG Writer ---
function create16BitGrayscalePNG(width, height, getPixel) {
  const scanlineLength = 1 + width * 2; // 1 filter byte + 2 bytes (16-bit) per pixel
  const rawData = Buffer.alloc(height * scanlineLength);

  for (let y = 0; y < height; y++) {
    const offset = y * scanlineLength;
    rawData[offset] = 0; // Filter Type: None
    for (let x = 0; x < width; x++) {
      const val = Math.max(0, Math.min(65535, Math.round(getPixel(x, y))));
      rawData.writeUInt16BE(val, offset + 1 + x * 2);
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(typeStr, dataBuf) {
    const typeBuf = Buffer.from(typeStr, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(dataBuf.length, 0);
    const toCrc = Buffer.concat([typeBuf, dataBuf]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(toCrc), 0);
    return Buffer.concat([lenBuf, typeBuf, dataBuf, crcBuf]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16; // 16-bit
  ihdr[9] = 0;  // Grayscale
  ihdr[10] = 0; // Deflate
  ihdr[11] = 0; // Filter 0
  ihdr[12] = 0; // Non-interlaced

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Procedural Raid Landscape Generator ---
const noise = new FastNoise(4281);
const detailNoise = new FastNoise(9923);

const WIDTH = 1024;
const HEIGHT = 1024;

function generateElevation(x, y) {
  const u = x / (WIDTH - 1);
  const v = y / (HEIGHT - 1);

  // Centered normalized coordinates [-1..1]
  const nx = (u - 0.5) * 2.0;
  const ny = (v - 0.5) * 2.0;
  const dist = Math.sqrt(nx * nx + ny * ny);

  // 1. Natural mountain perimeter ring (higher elevation near edges so map has natural boundaries)
  const edgeRidge = Math.pow(Math.min(1.0, dist * 1.05), 3.2) * 0.45;

  // 2. Base mountain & valley topology (low frequency fBm)
  const baseTerrain = noise.fbm(u * 3.2, v * 3.2, 5, 2.0, 0.52);

  // 3. Central plateau & depression for combat zones
  const centralDepression = Math.exp(-dist * dist * 4.0) * 0.15;

  // 4. Terracing (stepped plateaus suitable for buildings and outposts)
  let raw = 0.35 + baseTerrain * 0.38 + edgeRidge - centralDepression;
  const steps = 7.0;
  const stepped = Math.floor(raw * steps) / steps;
  const blend = 0.25; // blend between smooth and terraced
  raw = raw * (1 - blend) + stepped * blend;

  // 5. Winding canyon / road depression through the map
  const roadCurve = Math.sin(u * 6.28 + 0.5) * 0.18;
  const distToRoad = Math.abs((v - 0.5) - roadCurve);
  if (distToRoad < 0.12) {
    const roadDepth = (1.0 - distToRoad / 0.12) * 0.08;
    raw -= roadDepth;
  }

  // 6. High frequency surface micro-roughness
  const micro = detailNoise.fbm(u * 18.0, v * 18.0, 3, 2.1, 0.45) * 0.03;
  raw += micro;

  // Clamp normalized height [0..1]
  const clamped = Math.max(0.02, Math.min(0.98, raw));

  // Map to 16-bit integer range [0..65535]
  return clamped * 65535;
}

const outPath = path.resolve('assets/levels/heightmap_16bit.png');
console.log(`Generating 16-bit heightmap ${WIDTH}x${HEIGHT}...`);
const pngBuffer = create16BitGrayscalePNG(WIDTH, HEIGHT, generateElevation);
fs.writeFileSync(outPath, pngBuffer);

console.log(`✓ 16-bit Heightmap successfully written to: ${outPath} (${(pngBuffer.length / 1024).toFixed(1)} KB)`);
