// Conta as texturas do jogo na cópia guardada pelo app (só leitura, app fechado) e quantas o pacote já troca.
// Uso: node contar.js <pasta File System\000\t> <pacote.pak>
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { jdlz, chunks } = require('./dyn.js');
const [, , root, pakFile] = process.argv;

const pak = fs.readFileSync(pakFile);
const inPak = new Set();
for (let i = 0; i < pak.readUInt32LE(8); i++) { const o = 16 + 40 * i; inPak.add(`${pak.readUInt32LE(o)}:${pak.readUInt32LE(o + 4)}`); }
const adler = (b) => { let a = 1, s = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; };
const FOURCC = { 0x31545844: 8, 0x33545844: 16, 0x35545844: 16 };
const lv0 = (fmt, w, h) => (fmt === 21 ? w * h * 4 : FOURCC[fmt] ? Math.max(1, w >> 2) * Math.max(1, h >> 2) * FOURCC[fmt] : fmt === 41 ? w * h : 0);

const tex = new Map(); // hash do jogo -> { name, w, h, fmt, key }
function* deep(b, a, e, d = 0) { for (const c of chunks(b, a, e)) { yield c; if ((c.id & 0x80000000) && d < 6) yield* deep(b, c.s, c.e, d + 1); } }
function scan(b) {
  const all = [...deep(b, 0, b.length)];
  for (let i = 0; i < all.length; i++) {
    if (all[i].id !== 0xB3300000) continue;
    const t = all[i];
    const inT = all.filter((c) => c.s >= t.s && c.e <= t.e);
    const recs = inT.find((c) => c.id === 0x33310004), plat = inT.find((c) => c.id === 0x33310005), data = inT.find((c) => c.id === 0x33320002);
    if (recs && plat && data) {
      const n = Math.floor((recs.e - recs.s) / 0x7C);
      for (let k = 0; k < n; k++) {
        const r = recs.s + k * 0x7C, p = plat.s + k * 0x20;
        if (p + 0x20 > plat.e) break;
        const h = b.readUInt32LE(r + 0x24), w = b.readUInt16LE(r + 0x44), hh = b.readUInt16LE(r + 0x46), fmt = b.readUInt32LE(p + 0x14);
        const name = b.toString('latin1', r + 0x0C, r + 0x24).replace(/\0.*$/s, '');
        const size = lv0(fmt, w, hh), off = b.readUInt32LE(r + 0x30);
        let key = null;
        for (const s of [data.s, (data.s + 0x7F) & ~0x7F]) {
          if (!size || s + off + size > data.e) continue;
          const px = b.subarray(s + off, s + off + size);
          const kk = `${zlib.crc32(px) >>> 0}:${adler(px)}`;
          if (inPak.has(kk)) { key = kk; break; }
          if (!key) key = kk;
        }
        if (!tex.has(h) || (key && inPak.has(key))) tex.set(h, { name, w, h: hh, fmt, key });
      }
    }
    const list = inT.find((c) => c.id === 0x33310003);
    if (list) for (let at = list.s; at + 24 <= list.e; at += 24) {
      const h = b.readUInt32LE(at);
      if (!tex.has(h)) tex.set(h, { name: '(céu e luzes do mapa)', dyn: true });
    }
  }
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? (x.name === 'Paths' ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
for (const f of walk(root)) {
  if (fs.statSync(f).size < 4096) continue;
  let b = fs.readFileSync(f);
  if (b.toString('latin1', 0, 4) === 'JDLZ') { b = jdlz(b); if (!b) continue; }
  try { scan(b); } catch { /* não é do jogo */ }
}
const vals = [...tex.values()];
const done = vals.filter((v) => v.key && inPak.has(v.key)).length;
console.log(`texturas diferentes no jogo: ${vals.length}; o pacote troca ${done}; P8 (paleta): ${vals.filter((v) => v.fmt === 41).length}`);
const group = {};
for (const v of vals) {
  const g = v.dyn ? 'CEU' : /^[0-9A-F]{8}$/.test(v.name) || /VINYL|DECAL|SPONSOR/.test(v.name) ? 'VINIL/DECAL' : (v.name.match(/^[A-Z0-9]+/) || ['outros'])[0];
  const x = (group[g] = group[g] || { total: 0, troca: 0 });
  x.total++; if (v.key && inPak.has(v.key)) x.troca++;
}
console.log(Object.entries(group).sort((a, b) => b[1].total - a[1].total).slice(0, 25).map(([g, x]) => `${g}: ${x.troca}/${x.total}`).join('  '));
