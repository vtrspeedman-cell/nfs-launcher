// Procura, na cópia do jogo guardada pelo app (só leitura), as texturas originais que o pacote do Texmod troca.
// Hash do Texmod (uMod, GPL): CRC-32 sem inversão final do nível 0, com bpp*w*h/8 bytes.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const tpf = require('./list.js');

const [, , tpfFile, root, outFile] = process.argv;
const buf = tpf.unxor(fs.readFileSync(tpfFile));
const def = tpf.entries(buf).find((e) => /texmod\.def$/i.test(e.name));
const want = new Map();
for (const l of tpf.read(buf, def).toString('latin1').split('\n')) {
  const [h, f] = l.replace('\r', '').split('|');
  if (f) want.set(parseInt(h, 16) >>> 0, f);
}

function jdlz(b) {
  const outLen = b.readUInt32LE(8);
  const out = Buffer.alloc(outLen);
  let f1 = 1, f2 = 1, i = 16, o = 0;
  while (i < b.length && o < outLen) {
    if (f1 === 1) f1 = b[i++] | 0x100;
    if (f2 === 1) f2 = b[i++] | 0x100;
    if (f1 & 1) {
      let len, t;
      if (f2 & 1) { len = (b[i + 1] | ((b[i] & 0xF0) << 4)) + 3; t = (b[i] & 0x0F) + 1; }
      else { t = (b[i + 1] | ((b[i] & 0xE0) << 3)) + 17; len = (b[i] & 0x1F) + 3; }
      i += 2;
      for (let k = 0; k < len && o < outLen; k++, o++) out[o] = out[o - t];
      f2 >>>= 1;
    } else out[o++] = b[i++];
    f1 >>>= 1;
  }
  return o === outLen ? out : null;
}

// Pedaços (id, tamanho) entre a e e; contêiner = bit alto ligado.
function* chunks(b, a, e) {
  while (a + 8 <= e) {
    const id = b.readUInt32LE(a), size = b.readUInt32LE(a + 4);
    if (a + 8 + size > e) return;
    yield { id, s: a + 8, e: a + 8 + size };
    a += 8 + size;
  }
}
function* tpks(b, a, e, depth = 0) {
  for (const c of chunks(b, a, e)) {
    if (c.id === 0xB3300000) yield c;
    else if ((c.id & 0x80000000) && depth < 6) yield* tpks(b, c.s, c.e, depth + 1);
  }
}
const FOURCC = { DXT1: 0x31545844, DXT3: 0x33545844, DXT5: 0x35545844 };
function lv0Size(fmt, w, h) {
  if (fmt === FOURCC.DXT1) return Math.max(1, w >> 2) * Math.max(1, h >> 2) * 8;
  if (fmt === FOURCC.DXT3 || fmt === FOURCC.DXT5) return Math.max(1, w >> 2) * Math.max(1, h >> 2) * 16;
  if (fmt === 21) return w * h * 4;
  return 0;
}
const texmodBytes = (fmt, w, h) => (fmt === FOURCC.DXT1 ? 4 : fmt === 21 ? 32 : 8) * w * h / 8;

const found = new Map();
const stats = { files: 0, tpk: 0, tex: 0, p8: 0, other: 0, jdlz: 0 };
function scanBuffer(b, label) {
  for (const t of tpks(b, 0, b.length)) {
    stats.tpk++;
    let recs = null, plat = null, data = null;
    for (const c of tpks2(b, t)) {
      if (c.id === 0x33310004) recs = c;
      else if (c.id === 0x33310005) plat = c;
      else if (c.id === 0x33320002) data = c;
    }
    if (!recs || !plat || !data) continue;
    const n = Math.floor((recs.e - recs.s) / 0x7C);
    const starts = [data.s, (data.s + 0x7F) & ~0x7F];
    for (let i = 0; i < n; i++) {
      const r = recs.s + i * 0x7C, p = plat.s + i * 0x20;
      if (p + 0x20 > plat.e) break;
      const off = b.readUInt32LE(r + 0x30), w = b.readUInt16LE(r + 0x44), h = b.readUInt16LE(r + 0x46);
      const fmt = b.readUInt32LE(p + 0x14);
      stats.tex++;
      if (fmt === 41) { stats.p8++; continue; }
      const size = lv0Size(fmt, w, h);
      if (!size) { stats.other++; continue; }
      for (const s of starts) {
        const a = s + off;
        if (a + size > data.e) continue;
        const lv0 = b.subarray(a, a + size);
        const tm = (zlib.crc32(b.subarray(a, a + texmodBytes(fmt, w, h))) ^ 0xFFFFFFFF) >>> 0;
        if (want.has(tm) && !found.has(tm)) {
          found.set(tm, { file: want.get(tm), w, h, fmt, crc: zlib.crc32(lv0) >>> 0, adler: adler32(lv0), name: b.toString('latin1', r + 0x0C, r + 0x24).replace(/\0.*$/s, ''), where: label });
        }
      }
    }
  }
}
// Pedaços dentro de um TPK (até 2 níveis): info (B3310000) e dados (B3320000).
function* tpks2(b, t) {
  for (const c of chunks(b, t.s, t.e)) {
    if (c.id & 0x80000000) for (const d of chunks(b, c.s, c.e)) yield d;
    else yield c;
  }
}
function adler32(b) { let a = 1, s = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; }

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? (x.name === 'Paths' ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
for (const f of walk(root)) {
  const st = fs.statSync(f);
  if (st.size < 4096) continue;
  stats.files++;
  let b = fs.readFileSync(f);
  if (b.toString('latin1', 0, 4) === 'JDLZ') { const u = jdlz(b); if (u) { stats.jdlz++; b = u; } else continue; }
  try { scanBuffer(b, path.relative(root, f)); } catch (e) { /* arquivo que não é do jogo */ }
}
console.log(JSON.stringify(stats));
console.log('achadas', found.size, 'de', want.size);
const byFile = {}; for (const v of found.values()) byFile[v.where] = (byFile[v.where] || 0) + 1;
console.log(JSON.stringify(byFile));
console.log([...found.values()].slice(0, 6).map((v) => `${v.name} ${v.w}x${v.h} ${v.fmt.toString(16)} -> ${v.file}`).join('\n'));
fs.writeFileSync(outFile, JSON.stringify([...found.entries()]));
