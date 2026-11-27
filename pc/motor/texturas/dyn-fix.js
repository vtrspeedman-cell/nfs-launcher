// Refaz um TRACKS\LOC*DYNTEX.BIN de mod: textura sem compressão que não cabe na fila do jogo (registro > 32 MB,
// RQ_CAP/2 em gpu_web.c) é reduzida à metade em cada lado (média de 2x2) até caber. As outras ficam como estão.
// Uso: node dyn-fix.js <entrada.BIN> <saida.BIN>
'use strict';
const fs = require('fs');
const { jdlz } = require('./dyn.js');

const LIMIT = 32 * 2 ** 20 - 64; // cabe com folga no registro (cabeçalho de 32 bytes, múltiplo de 16)
const [, , inFile, outFile] = process.argv;
const b = fs.readFileSync(inFile);

// Estrutura esperada (conferida neste arquivo): B3300000 > B3310000 (33310001..3) e B3320000 > 33320002 com os blocos.
const u32 = (o) => b.readUInt32LE(o);
if (u32(0) !== 0xB3300000) throw new Error('não começa com um TPK');
let list = null, data = null, dataBox = null;
for (let a = 8; a + 8 <= 8 + u32(4);) {
  const id = u32(a), size = u32(a + 4);
  if (id === 0xB3310000) for (let c = a + 8; c + 8 <= a + 8 + size;) { if (u32(c) === 0x33310003) list = { at: c, s: c + 8, e: c + 8 + u32(c + 4) }; c += 8 + u32(c + 4); }
  if (id === 0xB3320000) { dataBox = a; for (let c = a + 8; c + 8 <= a + 8 + size;) { if (u32(c) === 0x33320002) data = { at: c, s: c + 8, e: c + 8 + u32(c + 4) }; c += 8 + u32(c + 4); } }
  a += 8 + size;
}
if (!list || !data) throw new Error('sem a lista de blocos (33310003) ou os dados (33320002)');

const ents = [];
for (let at = list.s; at + 24 <= list.e; at += 24) ents.push({ at, hash: u32(at), off: u32(at + 4), comp: u32(at + 8), full: u32(at + 12) });
const byOff = [...ents].sort((x, y) => x.off - y.off);
const first = byOff[0].off, last = byOff[byOff.length - 1];
if (last.off + last.comp !== data.e) throw new Error('os blocos não terminam no fim dos dados');
for (let i = 1; i < byOff.length; i++) if (byOff[i].off !== byOff[i - 1].off + byOff[i - 1].comp) throw new Error('blocos com folga entre eles');

// JDLZ só com literais: o jogo descomprime normalmente (um byte de sinal a cada 8 bytes).
function stored(u) {
  const n = u.length, out = Buffer.alloc(16 + 1 + n + Math.ceil(n / 8));
  out.write('JDLZ', 0, 'latin1'); out[4] = 2; out[5] = 0x10; out.writeUInt32LE(n, 8);
  let o = 16, i = 0;
  out[o++] = 0; // primeiro sinal de "repetição" (nunca usado)
  while (i < n) { out[o++] = 0; const k = Math.min(8, n - i); u.copy(out, o, i, i + k); o += k; i += k; }
  const res = out.subarray(0, o);
  res.writeUInt32LE(o, 12);
  return res;
}
const half = (src, w, h) => {
  const W = w >> 1, H = h >> 1, dst = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = ((2 * y) * w + 2 * x) * 4, c = a + w * 4, o = (y * W + x) * 4;
    for (let k = 0; k < 4; k++) dst[o + k] = (src[a + k] + src[a + 4 + k] + src[c + k] + src[c + 4 + k] + 2) >> 2;
  }
  return dst;
};

const blocks = [];
for (const e of byOff) {
  const raw = b.subarray(e.off, e.off + e.comp);
  if (e.full - 156 <= LIMIT) { blocks.push({ e, buf: raw, full: e.full }); continue; }
  const u = jdlz(raw);
  if (!u) throw new Error(`bloco ${e.hash.toString(16)} não descomprime`);
  const r = u.length - 156, rec = Buffer.from(u.subarray(r)); // registro 0x7C + plataforma 0x20
  const name = rec.toString('latin1', 0x0C, 0x24).replace(/\0.*$/s, '');
  const fmt = rec.readUInt32LE(0x7C + 0x14), levels = rec[0x4E];
  let w = rec.readUInt16LE(0x44), h = rec.readUInt16LE(0x46);
  if (fmt !== 21 || levels !== 1 || r !== w * h * 4) throw new Error(`${name}: só sei reduzir ARGB de 1 nível (formato ${fmt}, níveis ${levels})`);
  let px = u.subarray(0, r);
  const was = `${w}x${h}`;
  while (px.length > LIMIT) { px = half(px, w, h); w >>= 1; h >>= 1; }
  rec.writeUInt16LE(w, 0x44); rec.writeUInt16LE(h, 0x46);
  rec[0x48] = Math.log2(w); rec[0x49] = Math.log2(h);
  rec.writeUInt32LE(px.length, 0x38); rec.writeUInt32LE(px.length, 0x40);
  rec.writeUInt32LE(rec.readUInt32LE(0x30) + px.length, 0x34);
  const nu = Buffer.concat([px, rec]);
  console.log(`${name}: ${was} -> ${w}x${h} (${(px.length / 2 ** 20).toFixed(0)} MB)`);
  blocks.push({ e, buf: stored(nu), full: nu.length });
}

const head = Buffer.from(b.subarray(0, first));
const tail = b.subarray(data.e);
let pos = first;
for (const k of blocks) {
  const at = k.e.at;
  head.writeUInt32LE(pos, at + 4); head.writeUInt32LE(k.buf.length, at + 8); head.writeUInt32LE(k.full, at + 12);
  pos += k.buf.length;
}
const delta = pos - data.e;
head.writeUInt32LE(u32(4) + delta, 4);
head.writeUInt32LE(u32(dataBox + 4) + delta, dataBox + 4);
head.writeUInt32LE(u32(data.at + 4) + delta, data.at + 4);
const fd = fs.openSync(outFile, 'w');
fs.writeSync(fd, head);
for (const k of blocks) fs.writeSync(fd, k.buf);
fs.writeSync(fd, tail);
fs.closeSync(fd);
console.log('pronto:', fs.statSync(outFile).size, 'bytes (antes', b.length + ')');
