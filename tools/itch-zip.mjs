// After every build (`npm run build`), the game ready to upload, at the top of the project:
//  - upload-to-itch.zip: for itch.io, the built game (app/dist) with index.html at the top of the zip;
//  - upload-to-crazygames/: for CrazyGames, which takes the files themselves (not a zip): drag everything
//    inside this folder into CrazyGames' upload box.
// Not on GitHub's build (CI), and not kept in git.
// No extra packages: a plain zip writer using Node's own zlib.
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

if (process.env.CI) process.exit(0);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'app', 'dist');
const OUT = join(ROOT, 'upload-to-itch.zip');
const CRAZY = join(ROOT, 'upload-to-crazygames');
const OLD = join(ROOT, 'build-that-wall-zip.zip');   // what the itch.io zip used to be called
const ITCH_MAX_FILES = 1000;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path); else files.push(path);
  }
})(DIST);
if (!files.some(f => relative(DIST, f) === 'index.html')) throw new Error('app/dist has no index.html: build the game first');
if (files.length > ITCH_MAX_FILES) throw new Error(`itch.io takes at most ${ITCH_MAX_FILES} files; the game has ${files.length}`);

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

const parts = [], central = [];
let offset = 0;
for (const path of files) {
  const name = Buffer.from(relative(DIST, path).split(sep).join('/'));
  const data = readFileSync(path);
  const packed = deflateRawSync(data, { level: 9 });
  const stored = packed.length >= data.length;            // pictures and sounds that don't shrink are stored as they are
  const body = stored ? data : packed, method = stored ? 0 : 8, crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(0x00210000, 10);                    // a fixed date (1 Jan 1980): the same game makes the same zip
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  parts.push(local, name, body);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10);
  cen.writeUInt32LE(0x00210000, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
  central.push(cen, name);
  offset += 30 + name.length + body.length;
}
const cenSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);
writeFileSync(OUT, Buffer.concat([...parts, ...central, end]));
rmSync(OLD, { force: true });
console.log(`itch.io: upload-to-itch.zip (${files.length} files, ${(statSync(OUT).size / 1048576).toFixed(1)} MB)`);

// CrazyGames: the same files, unzipped
rmSync(CRAZY, { recursive: true, force: true });
cpSync(DIST, CRAZY, { recursive: true });
console.log('CrazyGames: upload-to-crazygames/ (drag everything inside it into the upload box)');
