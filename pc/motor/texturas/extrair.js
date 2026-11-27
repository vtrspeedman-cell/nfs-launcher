// Tira um arquivo de dentro de um .tpf (pelo nome) e grava numa pasta. Uso: node extrair.js <a.tpf> <nome> <saida>
'use strict';
const fs = require('fs');
const tpf = require('./list.js');
const [, , file, name, out] = process.argv;
const buf = tpf.unxor(fs.readFileSync(file));
const e = tpf.entries(buf).find((x) => x.name.toLowerCase() === name.toLowerCase());
if (!e) { console.log('sem', name, 'em', file); process.exit(1); }
const d = tpf.read(buf, e);
fs.writeFileSync(out, d);
console.log(out, d.length, 'bytes');
