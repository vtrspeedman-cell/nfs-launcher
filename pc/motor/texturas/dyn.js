// Lê um TPK com texturas em blocos JDLZ (lista 33310003: hash, início, tamanho comprimido, tamanho final, 0x100, 0).
'use strict';
const fs = require('fs');

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

function* chunks(b, a, e) {
  while (a + 8 <= e) {
    const id = b.readUInt32LE(a), size = b.readUInt32LE(a + 4);
    if (a + 8 + size > e) return;
    yield { id, s: a + 8, e: a + 8 + size };
    a += 8 + size;
  }
}
function find(b, a, e, id, depth = 0) {
  for (const c of chunks(b, a, e)) {
    if (c.id === id) return c;
    if ((c.id & 0x80000000) && depth < 6) { const r = find(b, c.s, c.e, id, depth + 1); if (r) return r; }
  }
  return null;
}

// Cada textura: { hash, name, w, h, fmt, data (nível 0 em diante), rec, plat }
function textures(b) {
  const list = find(b, 0, b.length, 0x33310003);
  if (!list) return null;
  const out = [];
  for (let at = list.s; at + 24 <= list.e; at += 24) {
    const hash = b.readUInt32LE(at), off = b.readUInt32LE(at + 4), comp = b.readUInt32LE(at + 8), full = b.readUInt32LE(at + 12);
    const u = jdlz(b.subarray(off, off + comp));
    if (!u || u.length !== full) { out.push({ hash, bad: true }); continue; }
    out.push({ hash, u });
  }
  return out;
}
module.exports = { jdlz, textures, chunks, find };

if (require.main === module) {
  const b = fs.readFileSync(process.argv[2]);
  const t = textures(b);
  console.log('texturas', t.length, 'com erro', t.filter((x) => x.bad).length);
  const big = t.filter((x) => x.u && x.u.length > 60e6);
  for (const x of [big[0], t.find((y) => y.u && y.u.length < 400000)]) {
    if (!x) continue;
    const u = x.u, n = u.length;
    console.log('hash', x.hash.toString(16), 'tamanho', n);
    console.log(' início', u.subarray(0, 48).toString('hex'));
    console.log(' fim-156', u.subarray(n - 156, n - 156 + 64).toString('hex'), JSON.stringify(u.toString('latin1', n - 156 + 0x0C, n - 156 + 0x24)));
    console.log(' fim-32', u.subarray(n - 32).toString('hex'));
  }
}
