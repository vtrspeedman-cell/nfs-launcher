// Acha, na cópia do jogo (só leitura, app fechado), o LOC*DYNTEX.BIN original: arquivo TPK com lista de blocos
// (33310003) com os mesmos hashes do arquivo do mod. Uso: node dyn-orig.js <BIN do mod> <pasta File System\000\t> <saida>
'use strict';
const fs = require('fs');
const path = require('path');
const { find } = require('./dyn.js');
const [, , modFile, root, outFile] = process.argv;
const hashes = (b) => {
  const l = find(b, 0, b.length, 0x33310003);
  const s = new Set();
  if (l) for (let at = l.s; at + 24 <= l.e; at += 24) s.add(b.readUInt32LE(at));
  return s;
};
const want = hashes(fs.readFileSync(modFile));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? (x.name === 'Paths' ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
let best = null;
for (const f of walk(root)) {
  const st = fs.statSync(f);
  if (st.size < 1e6 || st.size > 200e6) continue;
  const fd = fs.openSync(f, 'r'); const h = Buffer.alloc(4); fs.readSync(fd, h, 0, 4, 0); fs.closeSync(fd);
  if (h.readUInt32LE(0) !== 0xB3300000) continue;
  const got = hashes(fs.readFileSync(f));
  const same = [...want].filter((x) => got.has(x)).length;
  if (same && (!best || same > best.same)) best = { f, same, n: got.size, size: st.size };
}
if (!best) { console.log('não achei'); process.exit(1); }
console.log(`achado: ${best.f} (${best.size} bytes), ${best.same} de ${want.size} hashes iguais, ${best.n} no original`);
fs.copyFileSync(best.f, outFile);
