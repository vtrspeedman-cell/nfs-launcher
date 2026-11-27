// Olha o catálogo do scan2: texturas de rua (nome) e de proporção 1:8, achadas ou não, e de que arquivo vêm.
'use strict';
const fs = require('fs');
const cat = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const re = new RegExp(process.argv[3] || 'ROAD|LANE|STREET|ASPH|CROSS|PAVE|CURB|SIDEWALK', 'i');
const byFile = {};
for (const t of cat) byFile[t.where] = (byFile[t.where] || 0) + 1;
console.log('arquivos com textura:', Object.keys(byFile).length);
const pick = cat.filter((t) => re.test(t.name) || (t.w * 8 === t.h) || (t.w * 4 === t.h && t.h >= 256));
const seen = new Set();
for (const t of pick) {
  const k = t.name + t.w + t.h + t.tm;
  if (seen.has(k)) continue; seen.add(k);
  console.log(t.want ? 'ACHADA' : '      ', t.name.padEnd(26), `${t.w}x${t.h}`.padEnd(10), t.fmt.padEnd(5), t.tm || '-', t.where, t.comp ? 'comp' : '');
}
