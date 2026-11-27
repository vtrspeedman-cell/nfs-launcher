// Compara dois pacotes NTXP: texturas em comum (mesmo crc+adler) e quem tem maior resolução.
'use strict';
const fs = require('fs');
function read(file) {
  const b = fs.readFileSync(file);
  const ver = b.readUInt32LE(4), n = b.readUInt32LE(8), m = new Map();
  for (let i = 0; i < n; i++) {
    const o = 16 + 40 * i;
    const e = { crc: b.readUInt32LE(o), adler: b.readUInt32LE(o + 4), ow: b.readUInt16LE(o + 8), oh: b.readUInt16LE(o + 10),
      w: b.readUInt16LE(o + 16), h: b.readUInt16LE(o + 18), fmt: b.readUInt32LE(o + 20).toString(16), name: b.readUInt32LE(o + 36) };
    e.text = b.toString('latin1', e.name, b.indexOf(0, e.name));
    m.set(`${e.crc}:${e.adler}`, e);
  }
  return { ver, n, m };
}
const [a, b, c] = process.argv.slice(2).map(read);
console.log(`A v${a.ver} ${a.n}, B v${b.ver} ${b.n}`);
let both = 0;
for (const [k, x] of a.m) {
  const y = b.m.get(k);
  if (!y) continue;
  both++;
  const z = c && c.m.get(k);
  console.log(`${x.text} | A ${x.w}x${x.h} ${x.fmt} | B ${y.w}x${y.h} ${y.fmt} (orig ${x.ow}x${x.oh})${z ? ` | final ${z.w}x${z.h} ${z.fmt}` : ''}`);
}
console.log(`em comum: ${both}`);
