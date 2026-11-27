// Confere um pacote versão 2 como o jogo lê: ordem das chaves, e cada entrada sem base descomprime no tamanho
// exato dos seus níveis (ent_bytes do texrep_web.c). Uso: node check-pak.js <pacote.pak>
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const b = fs.readFileSync(process.argv[2]);
const ver = b.readUInt32LE(4), n = b.readUInt32LE(8);
const BLK = { 0x31545844: 8, 0x33545844: 16, 0x35545844: 16 };
const lvl = (f, w, h) => (f === 21 ? w * h * 4 : BLK[f] ? Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * BLK[f] : 0);
let prev = -1, bad = 0, withBase = 0, maxLv = 0;
for (let i = 0; i < n; i++) {
  const o = 16 + 40 * i;
  const key = b.readUInt32LE(o) * 2 ** 32 + b.readUInt32LE(o + 4);
  if (key < prev) { console.log('fora de ordem', i); bad++; }
  prev = key;
  const w = b.readUInt16LE(o + 16), h = b.readUInt16LE(o + 18), f = b.readUInt32LE(o + 20), lv = b.readUInt32LE(o + 24);
  const off = b.readUInt32LE(o + 28), size = b.readUInt32LE(o + 32);
  let want = 0;
  for (let k = 0; k < lv; k++) { const s = lvl(f, Math.max(1, w >> k), Math.max(1, h >> k)); want += s; maxLv = Math.max(maxLv, s); }
  if (!want || w > 4096 || h > 4096 || off + size > b.length) { console.log('entrada ruim', i); bad++; continue; }
  if (ver === 2 && b.readUInt32LE(16 + 40 * n + 8 * i + 4)) { withBase++; continue; }
  const raw = ver === 2 ? zlib.inflateRawSync(b.subarray(off, off + size)) : b.subarray(off, off + size);
  if (raw.length !== want) { console.log('tamanho errado', i, raw.length, want); bad++; }
}
console.log(`versão ${ver}, ${n} texturas, ${withBase} com base (do site, copiadas), problemas: ${bad}, maior nível ${(maxLv / 2 ** 20).toFixed(1)} MB`);
