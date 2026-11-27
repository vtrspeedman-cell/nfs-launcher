// Lista as texturas dos .tpf cuja original ainda não foi achada no jogo (nome, tamanho e formato do DDS do mod).
'use strict';
const fs = require('fs');
const path = require('path');
const tpf = require('./list.js');
// Uso: node faltam.js <found.json[,outro.json]> <a.tpf> [b.tpf ...]
const [, , foundFiles, ...tpfs] = process.argv;
const found = new Map(foundFiles.split(',').flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
const miss = new Map();
for (const file of tpfs) {
  const buf = tpf.unxor(fs.readFileSync(file));
  const ents = tpf.entries(buf);
  const byName = new Map(ents.map((e) => [e.name.toLowerCase(), e]));
  const def = ents.find((e) => /texmod\.def$/i.test(e.name));
  for (const l of tpf.read(buf, def).toString('latin1').split('\n')) {
    const [h, f] = l.replace('\r', '').split('|');
    if (!f) continue;
    const hash = parseInt(h, 16) >>> 0;
    if (found.has(hash)) continue;
    const e = byName.get(f.toLowerCase());
    let info = 'sem arquivo';
    if (e) {
      const d = tpf.read(buf, e);
      const four = d.toString('latin1', 84, 88).replace(/\0/g, '') || ('rgb' + d.readUInt32LE(88));
      info = `${four} ${d.readUInt32LE(16)}x${d.readUInt32LE(12)}`;
    }
    const m = miss.get(hash) || { hash: hash.toString(16).toUpperCase().padStart(8, '0'), names: [], info: [] };
    m.names.push(`${path.basename(file)}:${f}`); m.info.push(info);
    miss.set(hash, m);
  }
}
console.log('faltam', miss.size);
for (const m of miss.values()) console.log(m.hash, m.info[0], m.names.join('  '));
