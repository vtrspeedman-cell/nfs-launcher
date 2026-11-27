// Reduz um pacote versão 2 (o mapa detalhado do site, 4x as originais) a no máximo ESCALA_MAX vezes o lado da
// original, tirando os níveis maiores (pedido do Bruno, 06/11, celular: nada fica de fora, tudo no máximo 2x).
// Cada entrada é descomprimida (e, com base, desfeito o XOR com ela, como o texrep_web.c), cortada e guardada de novo
// em deflate cru; quem tinha base continua como XOR com a base cortada do mesmo jeito (fica pequeno).
// Entrada que não descomprime (cópia incompleta do cache) é listada e fica fora.
// mod-escala.js (08/11, celular, pacotes do GitHub): igual ao site-2x.js, mas a mesma imagem usada por vários nomes
// (ex.: a sombra de cada carro no TexWizard) vai uma vez só, como no pacote de origem. ESCALA_MAX=1: o tamanho da
// original; ESCALA_MAX=2: até 2x o lado dela.
// Uso: ESCALA_MAX=1 node mod-escala.js <entrada.pak> <saida.pak>
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const [, , inFile, outFile] = process.argv;
const K = Number(process.env.ESCALA_MAX || 2);
const b = fs.readFileSync(inFile);
if (b.toString('latin1', 0, 4) !== 'NTXP' || b.readUInt32LE(4) !== 2) throw new Error('precisa de um pacote versão 2');
const n = b.readUInt32LE(8), baseAt = 16 + 40 * n;
const BLK = { 0x31545844: 8, 0x33545844: 16, 0x35545844: 16 };
const lvl = (f, w, h) => (f === 21 ? w * h * 4 : Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * BLK[f]);

const ents = [];
const byOff = new Map();
for (let i = 0; i < n; i++) {
  const o = 16 + 40 * i;
  const e = {
    i, crc: b.readUInt32LE(o), adler: b.readUInt32LE(o + 4), ow: b.readUInt16LE(o + 8), oh: b.readUInt16LE(o + 10), ofmt: b.readUInt32LE(o + 12),
    w: b.readUInt16LE(o + 16), h: b.readUInt16LE(o + 18), fmt: b.readUInt32LE(o + 20), levels: b.readUInt32LE(o + 24),
    off: b.readUInt32LE(o + 28), size: b.readUInt32LE(o + 32), boff: b.readUInt32LE(baseAt + 8 * i), bsize: b.readUInt32LE(baseAt + 8 * i + 4),
  };
  e.name = b.toString('latin1', b.readUInt32LE(o + 36), b.indexOf(0, b.readUInt32LE(o + 36)));
  ents.push(e);
  byOff.set(e.off, e);
}
const inflate = (off, size) => { try { return zlib.inflateRawSync(b.subarray(off, off + size)); } catch { return null; } };
// Quantos níveis tirar para caber em K vezes a original.
const drop = (e) => { let d = 0; while ((e.w >> d) > e.ow * K || (e.h >> d) > e.oh * K) d++; return Math.min(d, e.levels - 1); };
const bytesBefore = (e, d) => { let s = 0; for (let k = 0; k < d; k++) s += lvl(e.fmt, Math.max(1, e.w >> k), Math.max(1, e.h >> k)); return s; };
const total = (e) => bytesBefore(e, e.levels);

const out = [], bad = [];
const cut = new Map(); // off do stream de origem -> { buf (níveis já cortados, sem XOR), d }
function plain(e) {
  // níveis completos da entrada e (sem base aplicada a ela)
  const raw = inflate(e.off, e.size);
  if (!raw || raw.length !== total(e)) return null;
  if (!e.bsize) return raw;
  const base = inflate(e.boff, e.bsize);
  if (!base || base.length !== raw.length) return null;
  for (let k = 0; k < raw.length; k++) raw[k] ^= base[k];
  return raw;
}
const same = new Map(); // off:size:d da origem -> x já feito
for (const e of ents) {
  const k0 = `${e.off}:${e.size}:${e.boff}:${drop(e)}`;
  if (same.has(k0)) { const s = same.get(k0); out.push({ ...s, i: e.i, crc: e.crc, adler: e.adler, ow: e.ow, oh: e.oh, ofmt: e.ofmt, name: e.name, src: e, dup: s }); continue; }
  const full = plain(e);
  if (!full) { bad.push(e.name); continue; }
  const d = drop(e);
  const mine = full.subarray(bytesBefore(e, d));
  const x = { ...e, w: Math.max(1, e.w >> d), h: Math.max(1, e.h >> d), levels: e.levels - d, d, src: e };
  let delta = null;
  if (e.bsize) {
    const be = byOff.get(e.boff);
    const bfull = be && !be.bsize ? inflate(be.off, be.size) : null;
    if (bfull && drop(be) === d && be.w === e.w && be.h === e.h && be.fmt === e.fmt && be.levels === e.levels) {
      const bm = bfull.subarray(bytesBefore(be, d));
      delta = Buffer.alloc(mine.length);
      for (let k = 0; k < mine.length; k++) delta[k] = mine[k] ^ bm[k];
      x.baseOf = be.off;
    }
  }
  x.z = zlib.deflateRawSync(delta || mine, { level: 9 });
  if (!delta) x.baseOf = 0;
  out.push(x);
  same.set(k0, x);
}
// As bases precisam estar no pacote: entrada cuja base ficou fora vira inteira.
const kept = new Map(out.filter((x) => !x.bsize).map((x) => [x.off, x]));
for (const x of out) {
  if (x.baseOf && !kept.has(x.baseOf)) {
    const full = plain(x.src);
    x.z = zlib.deflateRawSync(full.subarray(bytesBefore(x.src, x.d)), { level: 9 });
    x.baseOf = 0;
  }
}
out.sort((p, q) => (p.crc - q.crc) || (p.adler - q.adler));
const m = out.length;
const names = Buffer.concat(out.map((x) => Buffer.from(x.name + '\0', 'latin1')));
const namesAt = 16 + 48 * m;
const dataAt = Math.ceil((namesAt + names.length) / 16) * 16;
const head = Buffer.alloc(dataAt);
head.write('NTXP', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(m, 8);
names.copy(head, namesAt);
let pos = dataAt;
for (const x of out) if (!x.dup) { x.at = pos; pos += x.z.length; }
for (const x of out) if (x.dup) { x.at = x.dup.at; x.z = x.dup.z; }
let nameOff = namesAt;
out.forEach((x, i) => {
  const o = 16 + 40 * i, bo = 16 + 40 * m + 8 * i;
  head.writeUInt32LE(x.crc, o); head.writeUInt32LE(x.adler, o + 4); head.writeUInt16LE(x.ow, o + 8); head.writeUInt16LE(x.oh, o + 10);
  head.writeUInt32LE(x.ofmt, o + 12); head.writeUInt16LE(x.w, o + 16); head.writeUInt16LE(x.h, o + 18); head.writeUInt32LE(x.fmt, o + 20);
  head.writeUInt32LE(x.levels, o + 24); head.writeUInt32LE(x.at, o + 28); head.writeUInt32LE(x.z.length, o + 32); head.writeUInt32LE(nameOff, o + 36);
  if (x.baseOf) { const bx = kept.get(x.baseOf); head.writeUInt32LE(bx.at, bo); head.writeUInt32LE(bx.z.length, bo + 4); }
  nameOff += Buffer.byteLength(x.name, 'latin1') + 1;
});
fs.writeFileSync(outFile, Buffer.concat([head, ...out.filter((x) => !x.dup).map((x) => x.z)]));
const esc = {};
for (const x of out) { const k = `${x.ow}x${x.oh} -> ${x.w}x${x.h}`; esc[k] = (esc[k] || 0) + 1; }
console.log(`${m} de ${n} entradas, ${out.filter((x) => x.baseOf).length} com base, ${(pos / 2 ** 20).toFixed(1)} MB`, JSON.stringify(esc));
if (bad.length) console.log(`fora (não descomprimem): ${bad.length}:`, bad.join(' '));
