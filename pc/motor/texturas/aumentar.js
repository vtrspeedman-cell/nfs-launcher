// Aumenta texturas do mod que são menores que a original (pedido do Bruno, 06/11: "aumenta pra deixar no tamanho
// da original"). Lê o maior nível do DDS (DXT1/3/5 ou 32 bits), põe cada lado entre o da original e 2x ele (o que
// ficou menor estica, o que passou reduz; ex.: barreira 2048x256 do NextGen -> 512x128 para a de 256x128) e grava
// BGRA em <pasta>/<hash>.bgra; a lista sai em <saida.json>, no formato do EXTRA do build.js.
// Uso: node aumentar.js <found2.json> <mod.tpf> <pasta> <saida.json> <NOME> [NOME ...]
'use strict';
const fs = require('fs');
const path = require('path');
const tpf = require('./list.js');
const [, , foundFile, tpfFile, outDir, outJson, ...names] = process.argv;
const found = JSON.parse(fs.readFileSync(foundFile, 'utf8').replace(/^﻿/, ''));
const buf = tpf.unxor(fs.readFileSync(tpfFile));
const ents = tpf.entries(buf);
const byName = new Map(ents.map((e) => [e.name.toLowerCase(), e]));
const def = ents.find((e) => /texmod\.def$/i.test(e.name));
const byHash = new Map();
for (const l of tpf.read(buf, def).toString('latin1').split('\n')) {
  const [h, f] = l.replace('\r', '').split('|');
  if (f && byName.has(f.toLowerCase())) byHash.set(parseInt(h, 16) >>> 0, byName.get(f.toLowerCase()));
}
const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
// Devolve RGBA (Uint8Array) do maior nível.
function decode(d) {
  const h = d.readUInt32LE(12), w = d.readUInt32LE(16), pf = d.readUInt32LE(80);
  const four = (pf & 4) ? d.toString('latin1', 84, 88) : '';
  const out = new Uint8Array(w * h * 4);
  if (!four) {
    for (let i = 0; i < w * h; i++) { // BGRA
      out[i * 4] = d[128 + i * 4 + 2]; out[i * 4 + 1] = d[128 + i * 4 + 1];
      out[i * 4 + 2] = d[128 + i * 4]; out[i * 4 + 3] = d[128 + i * 4 + 3];
    }
    return { w, h, px: out };
  }
  const bs = four === 'DXT1' ? 8 : 16;
  let at = 128;
  for (let by = 0; by < Math.ceil(h / 4); by++) for (let bx = 0; bx < Math.ceil(w / 4); bx++, at += bs) {
    const a = new Array(16).fill(255);
    let cb = at;
    if (four === 'DXT3') {
      for (let i = 0; i < 16; i++) a[i] = ((d[at + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
      cb = at + 8;
    } else if (four === 'DXT5') {
      const a0 = d[at], a1 = d[at + 1], t = [a0, a1];
      if (a0 > a1) for (let i = 1; i < 7; i++) t.push(((7 - i) * a0 + i * a1) / 7);
      else { for (let i = 1; i < 5; i++) t.push(((5 - i) * a0 + i * a1) / 5); t.push(0, 255); }
      let bits = 0n;
      for (let i = 0; i < 6; i++) bits |= BigInt(d[at + 2 + i]) << BigInt(8 * i);
      for (let i = 0; i < 16; i++) a[i] = t[Number((bits >> BigInt(3 * i)) & 7n)];
      cb = at + 8;
    }
    const c0 = d.readUInt16LE(cb), c1 = d.readUInt16LE(cb + 2), p0 = c565(c0), p1 = c565(c1);
    const pal = [p0, p1];
    if (four !== 'DXT1' || c0 > c1) pal.push(p0.map((v, k) => (2 * v + p1[k]) / 3), p0.map((v, k) => (v + 2 * p1[k]) / 3));
    else pal.push(p0.map((v, k) => (v + p1[k]) / 2), [0, 0, 0]);
    const idx = d.readUInt32LE(cb + 4);
    for (let i = 0; i < 16; i++) {
      const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
      if (x >= w || y >= h) continue;
      const k = (idx >>> (2 * i)) & 3, o = (y * w + x) * 4;
      out[o] = pal[k][0]; out[o + 1] = pal[k][1]; out[o + 2] = pal[k][2];
      out[o + 3] = four === 'DXT1' && c0 <= c1 && k === 3 ? 0 : a[i];
    }
  }
  return { w, h, px: out };
}
function resize(src, sw, sh, w, h) { // bilinear, RGBA -> BGRA
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.max(0, (x + 0.5) * sw / w - 0.5), fy = Math.max(0, (y + 0.5) * sh / h - 0.5);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    for (let k = 0; k < 4; k++) {
      const v = (src[(y0 * sw + x0) * 4 + k] * (1 - tx) + src[(y0 * sw + x1) * 4 + k] * tx) * (1 - ty) +
        (src[(y1 * sw + x0) * 4 + k] * (1 - tx) + src[(y1 * sw + x1) * 4 + k] * tx) * ty;
      out[(y * w + x) * 4 + [2, 1, 0, 3][k]] = Math.round(v);
    }
  }
  return out;
}
fs.mkdirSync(outDir, { recursive: true });
const list = [];
for (const name of names) {
  const hit = found.find(([, x]) => x.name === name);
  if (!hit) { console.log('não achada no jogo:', name); continue; }
  const [hash, f] = hit;
  if (!byHash.has(hash)) { console.log('não está no mod:', name); continue; }
  const d = tpf.read(buf, byHash.get(hash));
  let { w: sw, h: sh, px } = decode(d);
  // Cada lado entre o da original e ESCALA_MAX vezes ele (padrão 2): nunca menor que a original.
  const k = Number(process.env.ESCALA_MAX || 2);
  const w = Math.min(Math.max(sw, f.w), f.w * k), h = Math.min(Math.max(sh, f.h), f.h * k);
  // Reduzindo, primeiro média de 2 em 2 (sem serrilhar), depois o ajuste fino.
  while (sw >= w * 2 || sh >= h * 2) {
    const dx = sw >= w * 2 ? 2 : 1, dy = sh >= h * 2 ? 2 : 1, nw = sw / dx, nh = sh / dy, n = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let j = 0; j < dy; j++) for (let i = 0; i < dx; i++) s += px[((y * dy + j) * sw + x * dx + i) * 4 + c];
      n[(y * nw + x) * 4 + c] = Math.round(s / (dx * dy));
    }
    px = n; sw = nw; sh = nh;
  }
  const file = path.join(outDir, hash.toString(16).toUpperCase() + '.bgra');
  fs.writeFileSync(file, resize(px, sw, sh, w, h));
  list.push([hash, { w, h, fmt: 21, file }]);
  console.log(`${name}: original ${f.w}x${f.h}, mod ${d.readUInt32LE(16)}x${d.readUInt32LE(12)} -> ${w}x${h}`);
}
fs.writeFileSync(outJson, JSON.stringify(list));
