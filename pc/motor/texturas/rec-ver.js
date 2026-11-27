// Mostra o registro (0x7C) e a plataforma (0x20) de uma textura pelo nome, num arquivo do jogo (TPK sem compressão).
'use strict';
const fs = require('fs');
const [, , file, prefix] = process.argv;
const b = fs.readFileSync(file);
function* chunks(a, e) { while (a + 8 <= e) { const id = b.readUInt32LE(a), size = b.readUInt32LE(a + 4); if (a + 8 + size > e) return; yield { id, at: a, s: a + 8, e: a + 8 + size }; a += 8 + size; } }
function* inside(c, d = 0) { for (const x of chunks(c.s, c.e)) { yield x; if ((x.id & 0x80000000) && d < 3) yield* inside(x, d + 1); } }
const sig = Buffer.from([0, 0, 0x30, 0xB3]);
let at = 0, shown = 0;
while ((at = b.indexOf(sig, at)) >= 0 && shown < 3) {
  if (at % 4 || at + 8 > b.length) { at += 4; continue; }
  const t = { s: at + 8, e: at + 8 + b.readUInt32LE(at + 4) };
  if (t.e > b.length) { at += 4; continue; }
  let recs = null, plat = null, data = null;
  for (const c of inside(t)) { if (c.id === 0x33310004) recs = c; if (c.id === 0x33310005) plat = c; if (c.id === 0x33320002) data = c; }
  if (recs && plat && data) {
    const n = (recs.e - recs.s) / 0x7C;
    for (let i = 0; i < n; i++) {
      const r = recs.s + i * 0x7C;
      const name = b.toString('latin1', r + 0x0C, r + 0x24).replace(/\0.*$/s, '');
      if (!name.startsWith(prefix)) continue;
      const u32 = (o) => b.readUInt32LE(r + o);
      console.log(name, 'tpk@', at, 'dados', data.s, '-', data.e, '(tamanho', data.e - data.s + ')');
      console.log(' 0x30 dados', u32(0x30), '0x34 paleta', u32(0x34), '0x38 tam', u32(0x38), '0x3C tampal', u32(0x3C), '0x40', u32(0x40));
      console.log(' w h', b.readUInt16LE(r + 0x44), b.readUInt16LE(r + 0x46), 'bytes 0x48..0x58', b.subarray(r + 0x48, r + 0x58).toString('hex'));
      console.log(' registro', b.subarray(r, r + 0x7C).toString('hex'));
      console.log(' plataforma', b.subarray(plat.s + i * 0x20, plat.s + i * 0x20 + 0x20).toString('hex'));
      shown++;
    }
  }
  at = t.e;
}
