// Testa conversÃµes de textura de paleta (P8) para os formatos do PC, procurando o hash do Texmod que falta.
// Uso: node p8-probe.js <raiz> <hashes,separados> [nome-para-mostrar]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { jdlz } = require('./dyn.js');
const { huff } = require('./huff.js');
const [, , root, hashArg, showName] = process.argv;
const want = new Set(hashArg.split(',').map((h) => parseInt(h, 16) >>> 0));
const tm = (b) => (zlib.crc32(b) ^ 0xFFFFFFFF) >>> 0;

function* chunks(b, a, e) {
  while (a + 8 <= e) {
    const id = b.readUInt32LE(a), size = b.readUInt32LE(a + 4);
    if (a + 8 + size > e) return;
    yield { id, at: a, s: a + 8, e: a + 8 + size };
    a += 8 + size;
  }
}
function* inside(b, c, depth = 0) { for (const d of chunks(b, c.s, c.e)) { yield d; if ((d.id & 0x80000000) && depth < 3) yield* inside(b, d, depth + 1); } }
function* allTpks(b) {
  const sig = Buffer.from([0x00, 0x00, 0x30, 0xB3]);
  let at = 0;
  while ((at = b.indexOf(sig, at)) >= 0) {
    if (at % 4 === 0 && at + 8 <= b.length) {
      const size = b.readUInt32LE(at + 4);
      let ok = false;
      if (size >= 16 && at + 8 + size <= b.length) for (const c of chunks(b, at + 8, at + 8 + size)) if (c.id === 0xB3310000) { ok = true; break; }
      if (ok) { yield { at, s: at + 8, e: at + 8 + size }; at += 8 + size; continue; }
    }
    at += 4;
  }
}
// VariaÃ§Ãµes de cor e de alfa; formatos de 32 e 16 bits.
const alphaFns = {
  asis: (a) => a, x2: (a) => Math.min(255, a * 2), x2m1: (a) => (a >= 128 ? 255 : a * 2), ff: () => 255, zero: () => 0,
  scale: (a) => Math.min(255, Math.round(a * 255 / 128)), shl: (a) => Math.min(255, (a << 1) | (a >> 6)),
};
function variants(idx, pal) {
  const out = [];
  for (const order of ['0123', '2103']) {
    for (const [an, af] of Object.entries(alphaFns)) {
      const lut = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        const p = pal.subarray(i * 4, i * 4 + 4);
        if (p.length < 4) break;
        lut[i * 4] = p[+order[0]]; lut[i * 4 + 1] = p[+order[1]]; lut[i * 4 + 2] = p[+order[2]]; lut[i * 4 + 3] = af(p[3]);
      }
      const px = Buffer.alloc(idx.length * 4);
      for (let i = 0; i < idx.length; i++) { const q = idx[i] * 4; px[i * 4] = lut[q]; px[i * 4 + 1] = lut[q + 1]; px[i * 4 + 2] = lut[q + 2]; px[i * 4 + 3] = lut[q + 3]; }
      out.push([`argb-${order}-${an}`, px]);
      if (an === 'asis' || an === 'x2' || an === 'scale') {
        // 16 bits: a partir do BGRA (b=px[0], g=px[1], r=px[2], a=px[3]).
        const f565 = Buffer.alloc(idx.length * 2), f1555 = Buffer.alloc(idx.length * 2), f4444 = Buffer.alloc(idx.length * 2);
        for (let i = 0; i < idx.length; i++) {
          const b = px[i * 4], g = px[i * 4 + 1], r = px[i * 4 + 2], a = px[i * 4 + 3];
          f565.writeUInt16LE(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3), i * 2);
          f1555.writeUInt16LE((a >= 128 ? 0x8000 : 0) | ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3), i * 2);
          f4444.writeUInt16LE(((a >> 4) << 12) | ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4), i * 2);
        }
        out.push([`565-${order}-${an}`, f565], [`1555-${order}-${an}`, f1555], [`4444-${order}-${an}`, f4444]);
      }
    }
  }
  return out;
}
const hits = new Map(), howCount = {};
let shown = false, n = 0;
function texture(rec, plat, src, where, palSrc) {
  const fmt = plat.readUInt32LE(0x14);
  if (fmt !== 41) return;
  const w = rec.readUInt16LE(0x44), h = rec.readUInt16LE(0x46);
  const name = rec.toString('latin1', 0x0C, 0x24).replace(/\0.*$/s, '');
  const idx = src(0, w * h);
  const palOff = rec.readUInt32LE(0x34) - rec.readUInt32LE(0x30), palSize = rec.readUInt32LE(0x3C) || 1024;
  const pal = palSrc ? palSrc(rec.readUInt32LE(0x34), Math.min(1024, palSize)) : src(palOff, Math.min(1024, palSize));
  if (!idx || !pal) return;
  n++;
  if (showName && !shown && name.startsWith(showName)) {
    shown = true;
    console.log('textura', name, w, h, 'registro', rec.subarray(0x30, 0x7C).toString('hex'));
    console.log('plataforma', plat.toString('hex'));
    console.log('paleta (16 primeiras)', [...Array(16)].map((_, i) => pal.subarray(i * 4, i * 4 + 4).toString('hex')).join(' '));
    const alphas = {}; for (let i = 0; i < pal.length / 4; i++) alphas[pal[i * 4 + 3]] = (alphas[pal[i * 4 + 3]] || 0) + 1;
    console.log('alfas', JSON.stringify(alphas));
  }
  for (const [how, px] of variants(idx, pal)) {
    const t = tm(px);
    if (want.has(t) && !hits.has(t)) { hits.set(t, { name, w, h, how, where }); howCount[how] = (howCount[how] || 0) + 1; }
  }
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? (x.name === 'Paths' ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
for (const f of walk(root)) {
  if (fs.statSync(f).size < 4096) continue;
  let b = fs.readFileSync(f);
  if (b.toString('latin1', 0, 4) === 'NTXP') continue;
  if (b.toString('latin1', 0, 4) === 'JDLZ') { const u = jdlz(b); if (!u) continue; b = u; }
  const where = path.relative(root, f);
  for (const t of allTpks(b)) {
    let recs = null, plat = null, data = null, list = null, hdr = null;
    for (const c of inside(b, t)) {
      if (c.id === 0x33310004) recs = c; else if (c.id === 0x33310005) plat = c; else if (c.id === 0x33320002) data = c;
      else if (c.id === 0x33310003) list = c; else if (c.id === 0x33310001) hdr = c;
    }
    const tpkName = hdr ? b.toString('latin1', hdr.s + 4, hdr.s + 0x24).replace(/\0.*$/s, '') : '';
    if (tpkName === 'VINYL') continue;
    if (recs && plat && data) {
      const cnt = Math.floor((recs.e - recs.s) / 0x7C);
      for (let i = 0; i < cnt; i++) {
        const r = recs.s + i * 0x7C, p = plat.s + i * 0x20;
        if (p + 0x20 > plat.e) break;
        const off = b.readUInt32LE(r + 0x30);
        for (const s of [data.s, (data.s + 0x7F) & ~0x7F]) {
          texture(b.subarray(r, r + 0x7C), b.subarray(p, p + 0x20), (o, k) => (o >= 0 && s + off + o + k <= data.e ? b.subarray(s + off + o, s + off + o + k) : null), where, (o, k) => (o >= 0 && s + o + k <= data.e ? b.subarray(s + o, s + o + k) : null));
        }
      }
    }
    if (list) {
      for (let at = list.s; at + 24 <= list.e; at += 24) {
        const off = b.readUInt32LE(at + 4), csize = b.readUInt32LE(at + 8), full = b.readUInt32LE(at + 12);
        if (off + csize > b.length) continue;
        const blk = b.subarray(off, off + csize), m = blk.toString('latin1', 0, 4);
        let u = null;
        try { u = m === 'JDLZ' ? jdlz(blk) : m === 'HUFF' ? huff(blk) : null; } catch (e) { u = null; }
        if (!u || u.length !== full || u.length < 156) continue;
        const rr = u.length - 156;
        texture(u.subarray(rr, rr + 0x7C), u.subarray(rr + 0x7C, rr + 156), (o, k) => (o >= 0 && o + k <= rr ? u.subarray(o, o + k) : null), where);
      }
    }
  }
}
console.log('texturas P8 testadas', n, 'achadas', hits.size, JSON.stringify(howCount));
for (const [h, v] of hits) console.log(h.toString(16).toUpperCase().padStart(8, '0'), v.name, `${v.w}x${v.h}`, v.how, v.where);
