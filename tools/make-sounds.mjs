// make-sounds.mjs — the kit's sample sounds in assets/sounds/, synthesized from numbers:
//   step.wav — a footstep: a short thump with a gritty tail (Game.js, while the character runs).
// Generated — no source file, no licence questions; replace it with a recording. Other files in
// assets/sounds are ordinary assets — this tool does not touch them.
// An effect of your own is a few lines here: an oscillator or noise() × an envelope -> writeWav.
// A LOOPED sound must not click at the seam: make the noise and the envelope periodic over the
// loop and run the filter one loop ahead of the part you keep (see loopedNoise).
//
//   node tools/make-sounds.mjs          # writes the files
//   node tools/make-sounds.mjs --check  # exit 1 if a file on disk differs
//
// WAV: PCM 16 bit, mono, 22050 Hz — small files, plenty for effects.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'sounds');
const RATE = 22050;

// White noise −1..1 from a seed: the same bytes on every run (a plain LCG, 32 bit).
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

// One-pole low-pass: k 0..1, smaller — duller.
function lowpass(k) {
  let y = 0;
  return (x) => (y += k * (x - y));
}

// A footstep, 0.14 s: a sine thump sliding 110 -> 55 Hz plus dull noise, both dying fast.
function step() {
  const n = Math.round(RATE * 0.14), out = new Float64Array(n);
  const rnd = noise(7), lp = lowpass(0.25);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    phase += 2 * Math.PI * (55 + 55 * Math.exp(-t * 40)) / RATE;
    const attack = Math.min(1, t / 0.004);
    out[i] = attack * (0.8 * Math.sin(phase) * Math.exp(-t * 38) + 0.5 * lp(rnd()) * Math.exp(-t * 55));
  }
  return out;
}

// A looped ambience (wind, blades, a machine), seconds long: dull noise that swells twice per
// loop. The noise sequence and the swell are periodic over the loop, and the filter runs one
// loop ahead of the part that is kept — its state at the end equals its state at the start,
// so the loop point is inaudible.
export function loopedNoise(seconds = 2, seed = 11, cutoff = 0.06, gain = 3.2) {
  const n = Math.round(RATE * seconds), out = new Float64Array(n), seq = new Float64Array(n);
  const rnd = noise(seed), lp = lowpass(cutoff);
  for (let i = 0; i < n; i++) seq[i] = rnd();
  for (let i = 0; i < 2 * n; i++) {
    const v = lp(seq[i % n]);
    if (i < n) continue;
    const swell = Math.sin(2 * Math.PI * (i - n) / n);
    out[i - n] = v * (0.35 + 0.65 * swell * swell) * gain;
  }
  return out;
}

// Samples −1..1 -> the bytes of a WAV file.
function writeWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'latin1');
  head.writeUInt32LE(16, 16);          // fmt chunk size
  head.writeUInt16LE(1, 20);           // PCM
  head.writeUInt16LE(1, 22);           // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);    // bytes per second
  head.writeUInt16LE(2, 32);           // bytes per sample frame
  head.writeUInt16LE(16, 34);          // bits
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// File name -> bytes. Only what this tool owns: other files in assets/sounds are left alone.
function buildSounds() {
  return { 'step.wav': writeWav(step()) };
}

export { buildSounds, OUT_DIR, RATE };

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const sounds = buildSounds(), check = process.argv.includes('--check');
  let differs = false;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, bytes] of Object.entries(sounds)) {
    const file = path.join(OUT_DIR, name);
    if (check) {
      const same = fs.existsSync(file) && fs.readFileSync(file).equals(bytes);
      console.log(name + (same ? ' is up to date' : ' differs from the generator'));
      differs = differs || !same;
    } else {
      fs.writeFileSync(file, bytes);
      console.log(`${path.relative(ROOT, file).split(path.sep).join('/')}: ${bytes.length} bytes, ${((bytes.length - 44) / 2 / RATE).toFixed(2)} s`);
    }
  }
  if (check) process.exit(differs ? 1 : 0);
}
