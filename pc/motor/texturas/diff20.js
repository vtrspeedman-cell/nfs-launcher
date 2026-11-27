// As texturas que mudaram entre dois .tpf: tamanho, formato e níveis de cada lado.
'use strict';
const fs = require('fs');
const tpf = require('./list.js');
function load(file) {
  const buf = tpf.unxor(fs.readFileSync(file));
  const ents = tpf.entries(buf);
  const def = ents.find((e) => /texmod\.def$/i.test(e.name));
  const byName = new Map(ents.map((e) => [e.name.toLowerCase(), e]));
  const map = new Map();
  for (const l of tpf.read(buf, def).toString('latin1').split('\n')) {
    const [h, f] = l.replace('\r', '').split('|');
    if (f && byName.has(f.toLowerCase())) map.set(parseInt(h, 16) >>> 0, tpf.read(buf, byName.get(f.toLowerCase())));
  }
  return map;
}
const info = (d) => {
  const pf = d.readUInt32LE(80), fmt = (pf & 4) ? d.toString('latin1', 84, 88) : `${d.readUInt32LE(88)}bpp`;
  const mips = (d.readUInt32LE(8) & 0x20000) ? d.readUInt32LE(28) : 1;
  return `${d.readUInt32LE(16)}x${d.readUInt32LE(12)} ${fmt} níveis ${mips}`;
};
const found = new Map(JSON.parse(fs.readFileSync(process.argv[4], 'utf8')));
const A = load(process.argv[2]), B = load(process.argv[3]);
for (const [h, b] of B) {
  const a = A.get(h);
  if (a && !a.equals(b)) {
    const f = found.get(h);
    console.log(`${h.toString(16).padStart(8, '0')} ${f ? `${f.name} (${f.w}x${f.h})` : '(original não achada)'}: Redux ${info(a)} | Definitive ${info(b)}`);
  }
}
