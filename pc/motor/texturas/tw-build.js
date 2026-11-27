// Monta TEXPACKS/<nome>.pak (NTXP versão 1, como o build.js) a partir de um pack do TexWizard (TEXTURES.BIN):
// a textura nova de cada original achada (found-tw.json, de scan2.js com QUERO=). Pedido do Bruno (06/11), celular:
// ESCALA_MAX=2 usa o maior nível do pack com até 2x o lado da original (os níveis já vêm no BIN); nunca aumenta.
// Uso: node tw-build.js <found-tw.json> <TEXTURES.BIN> <saida.pak>
'use strict';
const fs = require('fs');
const [, , foundFile, binFile, outFile] = process.argv;
const b = fs.readFileSync(binFile);
const found = JSON.parse(fs.readFileSync(foundFile, 'utf8'));
const FOURCC = { DXT1: 0x31545844, DXT3: 0x33545844, DXT5: 0x35545844 };
const blockBytes = (fmt) => (fmt === FOURCC.DXT1 ? 8 : fmt === FOURCC.DXT3 || fmt === FOURCC.DXT5 ? 16 : 0);
const levelSize = (fmt, w, h) => (fmt === 21 ? w * h * 4 : Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * blockBytes(fmt));

function* chunks(a, e) {
  while (a + 8 <= e) {
    const id = b.readUInt32LE(a), size = b.readUInt32LE(a + 4);
    if (a + 8 + size > e) return;
    yield { id, s: a + 8, e: a + 8 + size };
    a += 8 + size;
  }
}
function* inside(c, depth = 0) {
  for (const d of chunks(c.s, c.e)) { yield d; if ((d.id & 0x80000000) && depth < 3) yield* inside(d, depth + 1); }
}
// Texturas do BIN pelo nome (no BIN, cortado em 23 letras). Dados alinhados a 0x80 depois do cabeçalho do bloco.
const tex = new Map();
for (const top of chunks(0, b.length)) {
  if (top.id !== 0xB3300000) continue;
  let recs = null, plat = null, data = null;
  for (const c of inside(top)) {
    if (c.id === 0x33310004) recs = c; else if (c.id === 0x33310005) plat = c; else if (c.id === 0x33320002) data = c;
  }
  if (!recs || !plat || !data) continue;
  const base = (data.s + 0x7F) & ~0x7F;
  for (let i = 0; i < Math.floor((recs.e - recs.s) / 0x7C); i++) {
    const r = recs.s + i * 0x7C, p = plat.s + i * 0x20;
    const name = b.toString('latin1', r + 0x0C, r + 0x24).replace(/\0.*$/s, '');
    const w = b.readUInt16LE(r + 0x44), h = b.readUInt16LE(r + 0x46);
    const fmt = b.readUInt32LE(p + 0x14), mips = b[r + 0x4E] || 1; // 0x4E: número de níveis
    let at = base + b.readUInt32LE(r + 0x30);
    const levels = [];
    for (let k = 0; k < mips; k++) {
      const lw = Math.max(1, w >> k), lh = Math.max(1, h >> k), n = levelSize(fmt, lw, lh);
      if (!n || at + n > data.e) break;
      levels.push({ w: lw, h: lh, data: b.subarray(at, at + n) });
      at += n;
    }
    tex.set(name, { name, fmt, levels });
  }
}

const k = Number(process.env.ESCALA_MAX || 0);
const LIMIT = 32 * 2 ** 20 - 256;
const ents = [], skip = {};
for (const [, f] of found) {
  const t = tex.get(f.file);
  if (!t || !t.levels.length) { skip['sem no BIN'] = (skip['sem no BIN'] || 0) + 1; continue; }
  const total = (i) => t.levels.slice(i, i + 13).reduce((s, l) => s + l.data.length, 0);
  const fits = (l) => !k || (l.w <= f.w * k && l.h <= f.h * k);
  const first = t.levels.findIndex((l, i) => l.w <= 4096 && l.h <= 4096 && total(i) <= LIMIT && fits(l));
  if (first < 0) { skip['grande demais'] = (skip['grande demais'] || 0) + 1; continue; }
  const use = t.levels.slice(first, first + 13);
  if (use[0].w < f.w || use[0].h < f.h) { skip['menor que a original'] = (skip['menor que a original'] || 0) + 1; continue; }
  ents.push({ f, w: use[0].w, h: use[0].h, fmt: t.fmt, levels: use, name: f.name, src: t.name + ':' + first });
}
ents.sort((a, c) => (a.f.crc - c.f.crc) || (a.f.adler - c.f.adler));

const n = ents.length;
const names = Buffer.concat(ents.map((x) => Buffer.from(x.name + '\0', 'latin1')));
const namesAt = 16 + 40 * n;
const dataAt = Math.ceil((namesAt + names.length) / 4096) * 4096;
const head = Buffer.alloc(dataAt);
head.write('NTXP', 0, 'latin1'); head.writeUInt32LE(1, 4); head.writeUInt32LE(n, 8);
names.copy(head, namesAt);
const fd = fs.openSync(outFile, 'w');
let pos = dataAt, nameOff = namesAt;
const shared = new Map(); // mesma imagem (ex.: sombra e neon de todos os carros): os dados vão uma vez só
ents.forEach((x, i) => {
  const body = Buffer.concat(x.levels.map((l) => l.data));
  let at = shared.get(x.src);
  if (at === undefined) { pos = Math.ceil(pos / 16) * 16; fs.writeSync(fd, body, 0, body.length, pos); at = pos; shared.set(x.src, at); pos += body.length; }
  const o = 16 + 40 * i;
  head.writeUInt32LE(x.f.crc, o); head.writeUInt32LE(x.f.adler, o + 4);
  head.writeUInt16LE(x.f.w, o + 8); head.writeUInt16LE(x.f.h, o + 10); head.writeUInt32LE(x.f.fmt, o + 12);
  head.writeUInt16LE(x.w, o + 16); head.writeUInt16LE(x.h, o + 18); head.writeUInt32LE(x.fmt, o + 20);
  head.writeUInt32LE(x.levels.length, o + 24); head.writeUInt32LE(at, o + 28); head.writeUInt32LE(body.length, o + 32);
  head.writeUInt32LE(nameOff, o + 36);
  nameOff += Buffer.byteLength(x.name, 'latin1') + 1;
});
fs.writeSync(fd, head, 0, head.length, 0);
fs.closeSync(fd);
console.log('entradas', n, 'puladas', JSON.stringify(skip), 'MB', (pos / 2 ** 20).toFixed(1));
for (const x of ents.slice(0, 6)) console.log(' ', x.name, `${x.f.w}x${x.f.h} -> ${x.w}x${x.h}`, 'níveis', x.levels.length);
