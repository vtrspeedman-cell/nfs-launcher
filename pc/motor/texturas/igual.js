// Confere se cada textura do pacote A (versão 1) está igual no pacote final (versão 2, deflate cru).
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const [fa, ff] = process.argv.slice(2);
const a = fs.readFileSync(fa), f = fs.readFileSync(ff);
const idx = (b) => { const n = b.readUInt32LE(8), m = new Map(); for (let i = 0; i < n; i++) { const o = 16 + 40 * i; m.set(`${b.readUInt32LE(o)}:${b.readUInt32LE(o + 4)}`, { i, off: b.readUInt32LE(o + 28), size: b.readUInt32LE(o + 32), w: b.readUInt16LE(o + 16), base: b.readUInt32LE(4) === 2 ? b.readUInt32LE(16 + 40 * n + 8 * i + 4) : 0 }); } return m; };
const A = idx(a), F = idx(f);
let same = 0, diff = 0, miss = 0, other = 0;
for (const [k, e] of A) {
  const g = F.get(k);
  if (!g) { miss++; continue; }
  if (g.w !== e.w || g.base) { other++; continue; }
  const raw = zlib.inflateRawSync(f.subarray(g.off, g.off + g.size));
  if (raw.equals(a.subarray(e.off, e.off + e.size))) same++; else diff++;
}
console.log(`iguais ${same}, diferentes ${diff}, faltando ${miss}, trocadas pela do site ${other}`);
