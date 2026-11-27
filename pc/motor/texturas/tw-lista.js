// Pack do TexWizard (TexturePacks\<nome>\TEXTURES.BIN + meta.json): lista cada troca (original -> nova), com o
// tamanho da original (catalogo.json) e o da nova, e grava a nova em DDS numa pasta, para conferir.
// Uso: node tw-lista.js <TEXTURES.BIN> <meta.json> <catalogo.json> [pasta-dds]
'use strict';
const fs = require('fs');
const path = require('path');
const [, , binFile, metaFile, catFile, outDir] = process.argv;
const b = fs.readFileSync(binFile);
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, ''));
const cat = JSON.parse(fs.readFileSync(catFile, 'utf8').replace(/^﻿/, ''));
const orig = new Map();
for (const c of cat) if (!orig.has(c.name)) orig.set(c.name, c);

const FOURCC = { 0x31545844: 'DXT1', 0x33545844: 'DXT3', 0x35545844: 'DXT5' };
function* chunks(a, e) {
  while (a + 8 <= e) {
    const id = b.readUInt32LE(a), size = b.readUInt32LE(a + 4);
    if (a + 8 + size > e) return;
    yield { id, s: a + 8, e: a + 8 + size };
    a += 8 + size;
  }
}
function* inside(c, depth = 0) {
  for (const d of chunks(c.s, c.e)) { yield d; if ((d.id & 0x80000000) && depth < 3) yield* inside(d, depth + 1); }
}
const lvSize = (f, w, h) => (f === 'DXT1' ? 8 : f === 'DXT3' || f === 'DXT5' ? 16 : 0) * Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) || (f === '21' ? w * h * 4 : 0);
const tex = new Map();
for (const top of chunks(0, b.length)) {
  if (top.id !== 0xB3300000) continue;
  let recs = null, plat = null, data = null;
  for (const c of inside(top)) {
    if (c.id === 0x33310004) recs = c; else if (c.id === 0x33310005) plat = c; else if (c.id === 0x33320002) data = c;
  }
  if (!recs || !plat || !data) continue;
  const n = Math.floor((recs.e - recs.s) / 0x7C);
  for (let i = 0; i < n; i++) {
    const r = recs.s + i * 0x7C, p = plat.s + i * 0x20;
    const name = b.toString('latin1', r + 0x0C, r + 0x24).replace(/\0.*$/s, '');
    const w = b.readUInt16LE(r + 0x44), h = b.readUInt16LE(r + 0x46), off = b.readUInt32LE(r + 0x30), size = b.readUInt32LE(r + 0x38);
    const mips = b[r + 0x4A] || 1;
    const fc = b.readUInt32LE(p + 0x14);
    const fmt = FOURCC[fc] || String(fc);
    tex.set(name, { name, w, h, fmt, fc, off, size, mips: b[r + 0x4E] || 1, dataS: (data.s + 0x7F) & ~0x7F, dataE: data.e }); // dados alinhados a 0x80
  }
}
console.log('texturas no BIN:', tex.size);
if (outDir) fs.mkdirSync(outDir, { recursive: true });
let sumNew = 0, sumOld = 0;
const seen = new Set();
for (const [from, to] of meta.textures) {
  const t = tex.get(to) || tex.get(to.slice(0, 23)), o = orig.get(from); // no BIN, o nome vem cortado em 23 letras
  const line = `${from} ${o ? `${o.w}x${o.h} ${o.fmt}` : '(não está no jogo)'} -> ${to} ${t ? `${t.w}x${t.h} ${t.fmt} níveis ${t.mips}` : '(não está no BIN)'}`;
  console.log(line + (t && o ? `  ${(t.w / o.w).toFixed(2)}x` : ''));
  if (t && !seen.has(to)) {
    seen.add(to);
    sumNew += t.size;
    if (outDir && FOURCC[t.fc]) {
      // DDS simples com todos os níveis guardados (o começo dos dados pode estar alinhado a 0x80).
      let at = t.dataS + t.off;
      const h = Buffer.alloc(128);
      h.write('DDS ', 0, 'latin1'); h.writeUInt32LE(124, 4); h.writeUInt32LE(0x1007 | 0x20000 | 0x80000, 8);
      h.writeUInt32LE(t.h, 12); h.writeUInt32LE(t.w, 16); h.writeUInt32LE(lvSize(t.fmt, t.w, t.h), 20); h.writeUInt32LE(t.mips, 28);
      h.writeUInt32LE(32, 76); h.writeUInt32LE(4, 80); h.writeUInt32LE(t.fc, 84); h.writeUInt32LE(0x1000 | 0x400008, 108);
      fs.writeFileSync(path.join(outDir, t.name + '.dds'), Buffer.concat([h, b.subarray(at, Math.min(at + t.size, t.dataE))]));
    }
  }
  if (t && o) sumOld += lvSize(o.fmt, o.w, o.h);
}
console.log('trocas', meta.textures.length, 'imagens novas', seen.size, 'MB das novas', (sumNew / 2 ** 20).toFixed(1));
