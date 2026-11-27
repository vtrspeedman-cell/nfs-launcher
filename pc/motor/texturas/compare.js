// Compara dois .tpf: quantas texturas, quantas em comum (mesmo hash do Texmod) e quais são iguais byte a byte.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const tpf = require('./list.js');
function load(file) {
  const buf = tpf.unxor(fs.readFileSync(file));
  const ents = tpf.entries(buf);
  const def = ents.find((e) => /texmod\.def$/i.test(e.name));
  const byName = new Map(ents.map((e) => [e.name.toLowerCase(), e]));
  const map = new Map();
  for (const l of tpf.read(buf, def).toString('latin1').split('\n')) {
    const [h, f] = l.replace('\r', '').split('|');
    if (f) map.set(parseInt(h, 16) >>> 0, { f, e: byName.get(f.toLowerCase()) });
  }
  return { buf, map };
}
const [, , a, b] = process.argv;
const A = load(a), B = load(b);
const common = [...A.map.keys()].filter((k) => B.map.has(k));
let same = 0;
const sha = (T, x) => crypto.createHash('sha1').update(tpf.read(T.buf, x.e)).digest('hex');
for (const k of common) if (A.map.get(k).e && B.map.get(k).e && sha(A, A.map.get(k)) === sha(B, B.map.get(k))) same++;
console.log('A', A.map.size, 'B', B.map.size, 'em comum', common.length, 'iguais', same, 'só em B', B.map.size - common.length);
