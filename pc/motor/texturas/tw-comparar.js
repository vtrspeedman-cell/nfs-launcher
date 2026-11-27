// Compara lado a lado (PNG) a textura original do jogo e a do pack do TexWizard, no mesmo tamanho de tela.
// Uso: node tw-comparar.js <arquivo do jogo (TPK)> <pasta dds do pack (tw-lista.js)> <meta.json> <saida-pasta> NOME [NOME ...]
// Mostra o trecho de cima (até 1/4 da altura nas texturas compridas), a 384 px de largura.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const [, , gameFile, ddsDir, metaFile, outDir, ...names] = process.argv;
const g = fs.readFileSync(gameFile);
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, ''));
const to = new Map(meta.textures);

const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
function dxt(d, at, w, h, four) { // -> RGBA
  const out = new Uint8Array(w * h * 4), bs = four === 'DXT1' ? 8 : 16;
  for (let by = 0; by < Math.ceil(h / 4); by++) for (let bx = 0; bx < Math.ceil(w / 4); bx++, at += bs) {
    const a = new Array(16).fill(255);
    let cb = at;
    if (four === 'DXT3') { for (let i = 0; i < 16; i++) a[i] = ((d[at + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17; cb = at + 8; }
    else if (four === 'DXT5') {
      const a0 = d[at], a1 = d[at + 1], t = [a0, a1];
      if (a0 > a1) for (let i = 1; i < 7; i++) t.push(((7 - i) * a0 + i * a1) / 7);
      else { for (let i = 1; i < 5; i++) t.push(((5 - i) * a0 + i * a1) / 5); t.push(0, 255); }
      let bits = 0n; for (let i = 0; i < 6; i++) bits |= BigInt(d[at + 2 + i]) << BigInt(8 * i);
      for (let i = 0; i < 16; i++) a[i] = t[Number((bits >> BigInt(3 * i)) & 7n)];
      cb = at + 8;
    }
    const c0 = d.readUInt16LE(cb), c1 = d.readUInt16LE(cb + 2), p0 = c565(c0), p1 = c565(c1), pal = [p0, p1];
    if (four !== 'DXT1' || c0 > c1) pal.push(p0.map((v, k) => (2 * v + p1[k]) / 3), p0.map((v, k) => (v + 2 * p1[k]) / 3));
    else pal.push(p0.map((v, k) => (v + p1[k]) / 2), [0, 0, 0]);
    const idx = d.readUInt32LE(cb + 4);
    for (let i = 0; i < 16; i++) {
      const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
      if (x >= w || y >= h) continue;
      const k = (idx >>> (2 * i)) & 3, o = (y * w + x) * 4;
      out[o] = pal[k][0]; out[o + 1] = pal[k][1]; out[o + 2] = pal[k][2]; out[o + 3] = a[i];
    }
  }
  return out;
}
const FOURCC = { 0x31545844: 'DXT1', 0x33545844: 'DXT3', 0x35545844: 'DXT5' };
const blk = (f, w, h) => (f === 'DXT1' ? 8 : 16) * Math.ceil(w / 4) * Math.ceil(h / 4);
// Original: procura o registro pelo nome nos TPK do arquivo do jogo.
function original(name) {
  const key = Buffer.from(name + '\0', 'latin1');
  let at = 0;
  while ((at = g.indexOf(key, at)) >= 0) {
    const r = at - 0x0C;
    // Acha os blocos do TPK em volta: lista de registros (33310004), plataforma (33310005), dados (33320002).
    let s = g.lastIndexOf(Buffer.from([0x04, 0x00, 0x31, 0x33]), r);
    if (s >= 0 && (r - (s + 8)) % 0x7C === 0) {
      const i = (r - (s + 8)) / 0x7C, plat = g.indexOf(Buffer.from([0x05, 0x00, 0x31, 0x33]), r);
      const data = g.indexOf(Buffer.from([0x02, 0x00, 0x32, 0x33]), r);
      const w = g.readUInt16LE(r + 0x44), h = g.readUInt16LE(r + 0x46), off = g.readUInt32LE(r + 0x30);
      const fc = g.readUInt32LE(plat + 8 + i * 0x20 + 0x14);
      for (const ds of [((data + 8) + 0x7F) & ~0x7F]) { // dados alinhados a 0x80
        const src = ds + off;
        if (FOURCC[fc]) return { w, h, px: dxt(g, src, w, h, FOURCC[fc]) };
        if (fc === 41) {
          const pal = ds + g.readUInt32LE(r + 0x34), px = new Uint8Array(w * h * 4);
          for (let k = 0; k < w * h; k++) { const p = pal + g[src + k] * 4; px[k * 4] = g[p + 2]; px[k * 4 + 1] = g[p + 1]; px[k * 4 + 2] = g[p]; px[k * 4 + 3] = g[p + 3]; }
          return { w, h, px };
        }
      }
    }
    at += key.length;
  }
  return null;
}
function fromDds(file) {
  const d = fs.readFileSync(file), h = d.readUInt32LE(12), w = d.readUInt32LE(16), four = FOURCC[d.readUInt32LE(84)];
  return { w, h, px: dxt(d, 128, w, h, four) };
}
function sample(t, W, H, frac) { // área (média) do trecho de cima, para W x H
  const out = Buffer.alloc(W * H * 3), sh = Math.max(1, Math.round(t.h * frac));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.floor(x * t.w / W), x1 = Math.max(x0 + 1, Math.floor((x + 1) * t.w / W));
    const y0 = Math.floor(y * sh / H), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / H));
    const s = [0, 0, 0]; let n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const o = (yy * t.w + xx) * 4; s[0] += t.px[o]; s[1] += t.px[o + 1]; s[2] += t.px[o + 2]; n++; }
    for (let k = 0; k < 3; k++) out[(y * W + x) * 3 + k] = s[k] / n;
  }
  return out;
}
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
fs.mkdirSync(outDir, { recursive: true });
for (const name of names) {
  const o = original(name), n = fromDds(path.join(ddsDir, to.get(name).slice(0, 23) + '.dds'));
  if (!o) { console.log('original não achada:', name); continue; }
  const frac = n.h > n.w * 2 ? 0.25 : 1, W = 384, H = Math.round(W * (n.h * frac) / n.w), gap = 12;
  const a = sample(o, W, H, frac), b = sample(n, W, H, frac), all = Buffer.alloc((W * 2 + gap) * H * 3, 40);
  for (let y = 0; y < H; y++) { a.copy(all, y * (W * 2 + gap) * 3, y * W * 3, (y + 1) * W * 3); b.copy(all, (y * (W * 2 + gap) + W + gap) * 3, y * W * 3, (y + 1) * W * 3); }
  png(path.join(outDir, name + '.png'), W * 2 + gap, H, all);
  console.log(name, `original ${o.w}x${o.h}, pack ${n.w}x${n.h}`);
}
