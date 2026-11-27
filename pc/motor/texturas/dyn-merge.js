// Junta LOC*DYNTEX.BIN de mods (pedido do Bruno, 06/11): parte do <base> (já com as texturas que mudam) e acrescenta,
// de cada <extra>, só as texturas que o <base> deixou iguais às do <original> do jogo. Nada do <base> é substituído.
// Uso: node dyn-merge.js <original> <saida> <base> <extra> [extra2 ...]
'use strict';
const fs = require('fs');
const { jdlz, find } = require('./dyn.js');
const [, , origFile, outFile, baseFile, ...extras] = process.argv;
const LIMIT = 32 * 2 ** 20 - 256;

function open(file) {
  const b = fs.readFileSync(file);
  const list = find(b, 0, b.length, 0x33310003);
  if (!list) throw new Error(`${file}: sem lista de blocos`);
  const map = new Map();
  for (let at = list.s; at + 24 <= list.e; at += 24) {
    const e = { at, hash: b.readUInt32LE(at), off: b.readUInt32LE(at + 4), comp: b.readUInt32LE(at + 8), full: b.readUInt32LE(at + 12) };
    e.raw = b.subarray(e.off, e.off + e.comp);
    map.set(e.hash, e);
  }
  return { b, list, map };
}
// Conteúdo da textura sem o registro (o registro guarda posições que mudam de um arquivo para outro), mais os lados.
const body = (e) => {
  const u = jdlz(e.raw);
  if (!u) throw new Error(`bloco ${e.hash.toString(16)} não descomprime`);
  const r = u.length - 156;
  return { px: u.subarray(0, r), w: u.readUInt16LE(r + 0x44), h: u.readUInt16LE(r + 0x46) };
};
const same = (x, y) => x.w === y.w && x.h === y.h && x.px.equals(y.px);

const O = open(origFile), B = open(baseFile);
const take = new Map(); // hash -> bloco de um extra
const changedInBase = new Set();
for (const [h, e] of B.map) { const o = O.map.get(h); if (!o || !same(body(e), body(o))) changedInBase.add(h); }
console.log(`base muda ${changedInBase.size} de ${B.map.size}`);
for (const file of extras) {
  const X = open(file);
  let n = 0;
  for (const [h, e] of X.map) {
    if (changedInBase.has(h) || take.has(h) || !B.map.has(h)) continue;
    const o = O.map.get(h);
    if (o && same(body(e), body(o))) continue; // o extra também não mudou
    if (e.full - 156 > LIMIT) { console.log(`${h.toString(16)}: grande demais, ficou de fora`); continue; }
    take.set(h, e); n++;
  }
  console.log(`${file}: ${n} texturas novas`);
}

// Regrava o base com os blocos trocados, na mesma ordem.
const b = B.b, u32 = (o) => b.readUInt32LE(o);
const data = find(b, 0, b.length, 0x33320002);
let dataBox = null;
for (let a = 8; a + 8 <= 8 + u32(4); a += 8 + u32(a + 4)) if (u32(a) === 0xB3320000) dataBox = a;
const dataAt = data.s - 8;
const order = [...B.map.values()].sort((x, y) => x.off - y.off);
const first = order[0].off;
const head = Buffer.from(b.subarray(0, first));
let pos = first;
const parts = [];
for (const e of order) {
  const k = take.get(e.hash) || e;
  head.writeUInt32LE(pos, e.at + 4); head.writeUInt32LE(k.comp, e.at + 8); head.writeUInt32LE(k.full, e.at + 12);
  parts.push(k.raw); pos += k.raw.length;
}
const delta = pos - data.e;
head.writeUInt32LE(u32(4) + delta, 4);
head.writeUInt32LE(u32(dataBox + 4) + delta, dataBox + 4);
head.writeUInt32LE(u32(dataAt + 4) + delta, dataAt + 4);
fs.writeFileSync(outFile, Buffer.concat([head, ...parts, b.subarray(data.e)]));
console.log('pronto:', fs.statSync(outFile).size, 'bytes');
