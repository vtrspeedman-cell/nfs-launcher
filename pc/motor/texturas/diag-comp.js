// Diagnóstico: TPKs com lista 33310003 (texturas comprimidas): quantas entradas, tipo de compressão e tamanhos.
'use strict';
const fs = require('fs');
const path = require('path');
const { jdlz } = require('./dyn.js');
const [, , root] = process.argv;
function* chunks(b, a, e) {
  while (a + 8 <= e) {
    const id = b.readUInt32LE(a), size = b.readUInt32LE(a + 4);
    if (a + 8 + size > e) return;
    yield { id, at: a, s: a + 8, e: a + 8 + size };
    a += 8 + size;
  }
}
function* inside(b, c, depth = 0) {
  for (const d of chunks(b, c.s, c.e)) { yield d; if ((d.id & 0x80000000) && depth < 3) yield* inside(b, d, depth + 1); }
}
function* allTpks(b) {
  const sig = Buffer.from([0x00, 0x00, 0x30, 0xB3]);
  let at = 0;
  while ((at = b.indexOf(sig, at)) >= 0) {
    if (at % 4 === 0 && at + 8 <= b.length) {
      const size = b.readUInt32LE(at + 4);
      let ok = false;
      if (size >= 16 && at + 8 + size <= b.length) for (const c of chunks(b, at + 8, at + 8 + size)) if (c.id === 0xB3310000) { ok = true; break; }
      if (ok) { yield { at, s: at + 8, e: at + 8 + size }; at += 8 + size; continue; }
    }
    at += 4;
  }
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? (x.name === 'Paths' ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
for (const f of walk(root)) {
  if (fs.statSync(f).size < 4096) continue;
  let b = fs.readFileSync(f);
  if (b.toString('latin1', 0, 4) === 'NTXP') continue;
  if (b.toString('latin1', 0, 4) === 'JDLZ') { const u = jdlz(b); if (!u) continue; b = u; }
  for (const t of allTpks(b)) {
    let list = null, recs = null, hdr = null, data = null;
    for (const c of inside(b, t)) {
      if (c.id === 0x33310003) list = c;
      if (c.id === 0x33310004) recs = c;
      if (c.id === 0x33310001) hdr = c;
      if (c.id === 0x33320002) data = c;
    }
    if (!list) continue;
    const n = (list.e - list.s) / 24;
    const mag = {};
    let sample = '';
    for (let at = list.s; at + 24 <= list.e; at += 24) {
      const off = b.readUInt32LE(at + 4);
      let m = '?';
      for (const base of [0, t.at, data ? data.s : -1]) {
        if (base < 0 || base + off + 4 > b.length) continue;
        const s = b.toString('latin1', base + off, base + off + 4);
        if (s === 'JDLZ' || s === 'HUFF' || s === 'RAWW' || s === 'COMP') { m = s + '@' + (base === 0 ? 'arq' : base === t.at ? 'tpk' : 'dados'); break; }
      }
      mag[m] = (mag[m] || 0) + 1;
      if (!sample) sample = [0, 4, 8, 12, 16, 20].map((k) => b.readUInt32LE(at + k).toString(16)).join(' ');
    }
    const name = hdr ? b.toString('latin1', hdr.s + 4, hdr.s + 0x24).replace(/\0.*$/s, '') : '?';
    console.log(path.relative(root, f), 'tpk@' + t.at, name, 'entradas', n, 'recs', recs ? (recs.e - recs.s) / 0x7C : 0, JSON.stringify(mag), 'ex:', sample);
  }
}
