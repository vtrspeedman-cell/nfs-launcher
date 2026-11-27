// Lê o .tpf do Texmod dentro do zip do mod (sem extrair nada no disco) e lista o conteúdo.
// Formato (uMod, GPL): XOR 0x3FA43FA4 por palavra de 32 bits, depois zip com ZipCrypto e senha fixa.
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const PW = Buffer.from([0x73, 0x2A, 0x63, 0x7D, 0x5F, 0x0A, 0xA6, 0xBD, 0x7D, 0x65, 0x7E, 0x67, 0x61, 0x2A, 0x7F, 0x7F,
  0x74, 0x61, 0x67, 0x5B, 0x60, 0x70, 0x45, 0x74, 0x5C, 0x22, 0x74, 0x5D, 0x6E, 0x6A, 0x73, 0x41,
  0x77, 0x6E, 0x46, 0x47, 0x77, 0x49, 0x0C, 0x4B, 0x46, 0x6F]);
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crcByte = (c, b) => (CRC[(c ^ b) & 0xFF] ^ (c >>> 8)) >>> 0;

function unxor(b) {
  const n = b.length >>> 2;
  const dv = new DataView(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < n; i++) dv.setUint32(i * 4, (dv.getUint32(i * 4, true) ^ 0x3FA43FA4) >>> 0, true);
  for (let i = n * 4; i < b.length; i++) b[i] ^= 0xA4;
  return b;
}
function zipDecrypt(data) {
  let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
  const upd = (c) => { k0 = crcByte(k0, c); k1 = (Math.imul((k1 + (k0 & 0xFF)) >>> 0, 134775813) + 1) >>> 0; k2 = crcByte(k2, k1 >>> 24); };
  for (const c of PW) upd(c);
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    const t = (k2 | 2) & 0xFFFF;
    const c = data[i] ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xFF);
    out[i] = c; upd(c);
  }
  return out.subarray(12); // cabeçalho de 12 bytes do ZipCrypto
}
function entries(b) {
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4B, 5, 6]));
  const count = b.readUInt16LE(end + 10);
  let at = b.readUInt32LE(end + 16);
  const list = [];
  for (let i = 0; i < count; i++) {
    const flags = b.readUInt16LE(at + 8), method = b.readUInt16LE(at + 10), crc = b.readUInt32LE(at + 16);
    const csize = b.readUInt32LE(at + 20), usize = b.readUInt32LE(at + 24), nlen = b.readUInt16LE(at + 28);
    const off = b.readUInt32LE(at + 42), name = b.toString('latin1', at + 46, at + 46 + nlen);
    list.push({ name, flags, method, crc, csize, usize, off });
    at += 46 + nlen + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
  }
  return list;
}
function read(b, e) {
  const start = e.off + 30 + b.readUInt16LE(e.off + 26) + b.readUInt16LE(e.off + 28);
  let d = b.subarray(start, start + e.csize);
  if (e.flags & 1) d = zipDecrypt(d);
  return e.method === 8 ? zlib.inflateRawSync(d) : e.method === 0 ? d : null;
}
module.exports = { unxor, entries, read };

if (require.main === module) {
  const tpf = unxor(fs.readFileSync(process.argv[2]));
  const list = entries(tpf);
  console.log('arquivos', list.length, 'métodos', [...new Set(list.map((e) => e.method))], 'cifrados', list.filter((e) => e.flags & 1).length);
  const exts = {}; for (const e of list) { const x = e.name.split('.').pop().toLowerCase(); exts[x] = (exts[x] || 0) + 1; }
  console.log('tipos', JSON.stringify(exts));
  const def = list.find((e) => /texmod\.def$/i.test(e.name));
  const txt = read(tpf, def).toString('latin1');
  const lines = txt.split('\n').filter((l) => l.includes('|'));
  console.log('linhas do def', lines.length); console.log(lines.slice(0, 5).join('\n'));
  // Formatos e tamanhos das imagens (cabeçalho DDS).
  const fmt = {};
  for (const e of list.filter((x) => /\.dds$/i.test(x.name)).slice(0, 4000)) {
    const d = read(tpf, e);
    const four = d.toString('latin1', 84, 88).replace(/\0/g, '') || ('rgb' + d.readUInt32LE(88));
    const k = `${four} ${d.readUInt32LE(16)}x${d.readUInt32LE(12)}`;
    fmt[k] = (fmt[k] || 0) + 1;
  }
  console.log('formatos', JSON.stringify(Object.entries(fmt).sort((a, b) => b[1] - a[1]).slice(0, 25)));
  console.log('crc ok', zlib.crc32 ? (zlib.crc32(read(tpf, def)) >>> 0) === def.crc : 'sem zlib.crc32');
}
