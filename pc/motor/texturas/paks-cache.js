// Lista os pacotes NTXP guardados pelo jogo (só leitura): versão, quantas texturas, tamanho e algumas entradas.
'use strict';
const fs = require('fs');
const path = require('path');
const [, , root] = process.argv;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? (x.name === 'Paths' ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
for (const f of walk(root)) {
  const st = fs.statSync(f);
  if (st.size < 64) continue;
  const fd = fs.openSync(f, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  if (head.toString('latin1', 0, 4) !== 'NTXP') { fs.closeSync(fd); continue; }
  const ver = head.readUInt32LE(4), n = head.readUInt32LE(8);
  const ents = Buffer.alloc(40 * n);
  fs.readSync(fd, ents, 0, ents.length, 16);
  // nomes: logo depois das entradas (e das bases na versão 2)
  const namesAt = 16 + (ver === 2 ? 48 : 40) * n;
  const nb = Buffer.alloc(Math.min(200000, st.size - namesAt));
  fs.readSync(fd, nb, 0, nb.length, namesAt);
  fs.closeSync(fd);
  const fmts = {};
  const sample = [];
  for (let i = 0; i < n; i++) {
    const o = 40 * i, of = ents.readUInt32LE(o + 12);
    const k = of > 0xFFFF ? Buffer.from([of & 255, (of >> 8) & 255, (of >> 16) & 255, of >>> 24]).toString('latin1') : String(of);
    fmts[k] = (fmts[k] || 0) + 1;
    const nameOff = ents.readUInt32LE(o + 36) - namesAt;
    if (i % Math.max(1, Math.floor(n / 6)) === 0 && nameOff >= 0 && nameOff < nb.length) sample.push(nb.toString('latin1', nameOff, nb.indexOf(0, nameOff)));
  }
  console.log(path.relative(root, f), `v${ver}`, n, 'texturas', (st.size / 2 ** 20).toFixed(1), 'MB', 'formatos originais', JSON.stringify(fmts), sample.join(', '));
}
