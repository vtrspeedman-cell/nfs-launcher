// Mostra o registro (0x7C) e a parte de plataforma (0x20) do fim de cada bloco, em palavras de 32 bits.
'use strict';
const fs = require('fs');
const { textures } = require('./dyn.js');
const b = fs.readFileSync(process.argv[2]);
const t = textures(b).filter((x) => x.u);
t.sort((a, c) => c.u.length - a.u.length);
const pick = [t[0], t[1], t[2], t[3], t.find((x) => x.u.length < 100000)];
for (const x of pick) {
  const u = x.u, n = u.length, r = n - 156;
  const name = u.toString('latin1', r + 0x0C, r + 0x24).replace(/\0.*$/s, '');
  const words = [];
  for (let o = 0x24; o < 0x7C; o += 4) words.push(`${o.toString(16)}:${u.readUInt32LE(r + o).toString(16)}`);
  const plat = [];
  for (let o = 0; o < 0x20; o += 4) plat.push(u.readUInt32LE(r + 0x7C + o).toString(16));
  console.log(name, 'bloco', n, 'dados', n - 156, '\n  ', words.join(' '), '\n   plat', plat.join(' '));
}
