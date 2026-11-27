// Nomes originais (found.json) das texturas que o nosso pacote e o do site têm em comum.
'use strict';
const fs = require('fs');
const found = new Map();
for (const f of ['found.json', 'found-nextgen.json']) for (const [h, v] of JSON.parse(fs.readFileSync(f, 'utf8'))) found.set(h >>> 0, v);
const b = fs.readFileSync('redux-de-ng.pak'), s = fs.readFileSync('site-detailed.pak');
const keys = (buf) => { const n = buf.readUInt32LE(8), m = new Map(); for (let i = 0; i < n; i++) { const o = 16 + 40 * i; m.set(`${buf.readUInt32LE(o)}:${buf.readUInt32LE(o + 4)}`, buf.toString('latin1', buf.readUInt32LE(o + 36), buf.indexOf(0, buf.readUInt32LE(o + 36)))); } return m; };
const A = keys(b), S = keys(s);
const out = {};
for (const [k, name] of A) {
  if (!S.has(k)) continue;
  const h = parseInt(/0x([0-9A-F]+)/i.exec(name)[1], 16) >>> 0;
  const f = found.get(h);
  const nm = f ? f.name : '?';
  const grp = nm.replace(/_?\d+[A-Z]?$/,'').slice(0, 14);
  (out[grp] = out[grp] || []).push(nm);
}
for (const [g, l] of Object.entries(out)) console.log(`${l.length} ${g}: ${l.slice(0, 6).join(', ')}`);
console.log('site (exemplos de nome):', [...S.values()].slice(0, 3).join(', '));
