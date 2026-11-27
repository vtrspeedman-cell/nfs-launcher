// Para cada textura que o nosso pacote e o uhud.pak do site trocam (mesma chave), diz se a imagem é a mesma.
// Uso: node hud-igual.js <nosso.pak (v1)> <uhud.pak (v1)> [saida-chaves.json]
'use strict';
const fs = require('fs');
function read(file) {
  const b = fs.readFileSync(file);
  const ver = b.readUInt32LE(4), n = b.readUInt32LE(8), m = new Map();
  if (ver !== 1) throw new Error(file + ': só versão 1');
  for (let i = 0; i < n; i++) {
    const o = 16 + 40 * i;
    const e = { crc: b.readUInt32LE(o), adler: b.readUInt32LE(o + 4), ow: b.readUInt16LE(o + 8), oh: b.readUInt16LE(o + 10), ofmt: b.readUInt32LE(o + 12),
      w: b.readUInt16LE(o + 16), h: b.readUInt16LE(o + 18), fmt: b.readUInt32LE(o + 20), off: b.readUInt32LE(o + 28), size: b.readUInt32LE(o + 32), name: b.readUInt32LE(o + 36) };
    e.text = b.toString('latin1', e.name, b.indexOf(0, e.name));
    e.data = b.subarray(e.off, e.off + e.size);
    m.set(`${e.crc}:${e.adler}:${e.ow}:${e.oh}:${e.ofmt}`, e);
  }
  return m;
}
const [, , ours, site, out] = process.argv;
const a = read(ours), b = read(site);
let same = 0, diff = 0;
const keys = [];
for (const [k, x] of a) {
  const y = b.get(k);
  if (!y) continue;
  keys.push(k);
  if (x.w === y.w && x.h === y.h && x.fmt === y.fmt && x.data.equals(y.data)) same++;
  else { diff++; console.log('diferente:', x.text, `nosso ${x.w}x${x.h}`, '|', y.text, `site ${y.w}x${y.h}`); }
}
console.log('em comum', keys.length, 'iguais', same, 'diferentes', diff);
if (out) fs.writeFileSync(out, JSON.stringify(keys));
