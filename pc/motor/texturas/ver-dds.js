// Gera PNG de uma textura (pelo hash do Texmod) de cada .tpf, lado a lado, para comparar. DXT1/DXT5, nível 0.
// Uso: node ver-dds.js <hash hex> <saida.png> <a.tpf> <b.tpf> [escala]
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const tpf = require('./list.js');
const [hx, out, ...rest] = process.argv.slice(2);
const scale = Number(rest.find((x) => /^\d+$/.test(x)) || 4);
const files = rest.filter((x) => !/^\d+$/.test(x));
const want = parseInt(hx, 16) >>> 0;
function getDds(file) {
  const buf = tpf.unxor(fs.readFileSync(file));
  const ents = tpf.entries(buf);
  const def = ents.find((e) => /texmod\.def$/i.test(e.name));
  const byName = new Map(ents.map((e) => [e.name.toLowerCase(), e]));
  for (const l of tpf.read(buf, def).toString('latin1').split('\n')) {
    const [h, f] = l.replace('\r', '').split('|');
    if (f && (parseInt(h, 16) >>> 0) === want) return tpf.read(buf, byName.get(f.toLowerCase()));
  }
  throw new Error(`${file}: sem ${hx}`);
}
const c565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
function decode(d) {
  const h = d.readUInt32LE(12), w = d.readUInt32LE(16), fcc = d.toString('latin1', 84, 88);
  const bs = fcc === 'DXT1' ? 8 : 16;
  const px = Buffer.alloc(w * h * 3);
  let p = 128;
  for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4) {
    const cb = p + (bs === 16 ? 8 : 0);
    const a = d.readUInt16LE(cb), b = d.readUInt16LE(cb + 2), bits = d.readUInt32LE(cb + 4);
    const A = c565(a), B = c565(b);
    const pal = [A, B, a > b || bs === 16 ? A.map((v, i) => (2 * v + B[i]) / 3) : A.map((v, i) => (v + B[i]) / 2),
      a > b || bs === 16 ? A.map((v, i) => (v + 2 * B[i]) / 3) : [0, 0, 0]];
    for (let i = 0; i < 16; i++) {
      const x = bx + (i & 3), y = by + (i >> 2);
      if (x >= w || y >= h) continue;
      const c = pal[(bits >>> (2 * i)) & 3];
      px.set(c.map(Math.round), (y * w + x) * 3);
    }
    p += bs;
  }
  return { w, h, px };
}
function shrink(im, s) {
  const w = Math.floor(im.w / s), h = Math.floor(im.h / s), px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    let t = 0;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) t += im.px[((y * s + j) * im.w + x * s + i) * 3 + k];
    px[(y * w + x) * 3 + k] = t / (s * s);
  }
  return { w, h, px };
}
const ims = files.map((f) => shrink(decode(getDds(f)), scale));
const gap = 16, W = ims.reduce((t, m) => t + m.w, 0) + gap * (ims.length - 1), H = Math.max(...ims.map((m) => m.h));
const rows = Buffer.alloc((W * 3 + 1) * H, 40);
for (let y = 0; y < H; y++) rows[y * (W * 3 + 1)] = 0;
let x0 = 0;
for (const m of ims) {
  for (let y = 0; y < m.h; y++) m.px.copy(rows, y * (W * 3 + 1) + 1 + x0 * 3, y * m.w * 3, (y + 1) * m.w * 3);
  x0 += m.w + gap;
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${W}x${H}`);
