// ============================================================================
//  Minimal deflate-based ZIP writer. No dependencies (node:zlib).
// ----------------------------------------------------------------------------
//  A plain ZIP with index.html at the root. The format is written by hand so as
//  not to pull in archiver/jszip: the project's principle is "zero dependencies".
//
//  ZIP64-compatible output is NOT written — the game archive is certainly smaller
//  than 4 GB and has fewer than 65535 files, plain records are enough.
// ============================================================================
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const deflateRaw = promisify(zlib.deflateRaw);

// CRC-32 (the table is computed once)
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// MS-DOS date/time. The time is taken from the argument — the build must be
// reproducible, not depend on the moment it is run.
function dosDateTime(date) {
  const y = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * @param {{name:string, data:Buffer}[]} entries — name with forward slashes, a relative path
 * @param {Date} mtime — one timestamp for the whole archive
 * @returns {Promise<Buffer>}
 */
export async function makeZip(entries, mtime = new Date(2025, 0, 1, 0, 0, 0)) {
  const { time, date } = dosDateTime(mtime);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    // level 9: the archive is uploaded once, build speed does not matter
    let comp = await deflateRaw(e.data, { level: 9 });
    let method = 8;
    // if deflate inflated the file (already compressed png/jpg/mp3) — store it as is
    if (comp.length >= e.data.length) { comp = e.data; method = 0; }

    // UTF-8 flag (bit 11) — file names are Latin, but let it be correct
    const flags = 0x0800;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);   // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra len
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comment
    central.writeUInt16LE(0, 34);         // disk
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // local header offset
    nameBuf.copy(central, 46);

    locals.push(local, comp);
    centrals.push(central);
    offset += local.length + comp.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);                    // disk
  end.writeUInt16LE(0, 6);                    // start disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);                   // comment len

  return Buffer.concat([...locals, centralBuf, end]);
}
