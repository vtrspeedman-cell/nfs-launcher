// Descompressor do formato "HUFF" dos jogos da EA (cabeçalho de 16 bytes: 'HUFF', versão 1, tamanho final em +8).
// Huffman canônico com um símbolo "pista" (clue) para repetição e literal escapado; tipos 0x32FB e 0x34FB com delta.
// Escrito a partir do formato descrito na decompilação pública do NFS Most Wanted (LZCompress.cpp).
'use strict';

class Bits {
  constructor(b, at) { this.b = b; this.at = at; this.acc = 0; this.n = 0; }
  fill() {
    while (this.n <= 24) {
      const byte = this.at < this.b.length ? this.b[this.at] : 0;
      this.at++;
      this.acc = ((this.acc << 8) | byte) >>> 0;
      this.n += 8;
    }
  }
  peek(k) { this.fill(); return (this.acc >>> (this.n - k)) & ((1 << k) - 1); }
  skip(k) { this.n -= k; this.acc &= this.n >= 32 ? 0xFFFFFFFF : ((1 << this.n) >>> 0) - 1; }
  read(k) {
    if (k === 0) return 0;
    if (k > 16) { const hi = this.read(k - 16); return ((hi << 16) | this.read(16)) >>> 0; }
    const v = this.peek(k); this.skip(k); return v;
  }
  // Número no formato da EA: z zeros, um 1, depois z+2 bits; valor = bits + 2^(z+2) - 4.
  num() {
    let z = 0;
    while (this.read(1) === 0) { z++; if (z > 30) throw new Error('número inválido'); }
    const n = z + 2;
    return this.read(n) + (2 ** n) - 4;
  }
}

function huff(src) {
  if (src.toString('latin1', 0, 4) !== 'HUFF') return null;
  const want = src.readUInt32LE(8);
  const r = new Bits(src, 16);
  let type = r.read(16);
  let ulen;
  if (type & 0x8000) {
    if (type & 0x100) { r.read(16); r.read(16); }
    ulen = ((r.read(16) << 16) | r.read(16)) >>> 0;
  } else {
    if (type & 0x100) { r.read(8); r.read(16); }
    ulen = ((r.read(8) << 16) | r.read(16)) >>> 0;
  }
  type &= ~0x100;
  if (ulen !== want) return null;
  const clue = r.read(8);
  // Quantos códigos de cada tamanho (1, 2, ...) até completar o espaço de códigos.
  const count = [0], base = [0], before = [0];
  let numchars = 0, basecmp = 0, len = 1;
  for (;;) {
    basecmp = (basecmp << 1) >>> 0;
    base[len] = basecmp; before[len] = numchars;
    const bitnum = r.num();
    count[len] = bitnum;
    numchars += bitnum; basecmp += bitnum;
    const full = bitnum && ((basecmp << (16 - len)) & 0xFFFF) === 0;
    len++;
    if (bitnum && full) break;
    if (len > 24) return null;
  }
  const mostbits = len - 1;
  if (numchars > 256 || numchars === 0) return null;
  // Lista dos símbolos: cada um é o k-ésimo ainda não usado depois do anterior (em círculo).
  const used = new Uint8Array(256), syms = new Uint8Array(numchars);
  let next = 255;
  for (let i = 0; i < numchars; i++) {
    let leap = r.num() + 1;
    do { next = (next + 1) & 255; if (!used[next]) leap--; } while (leap);
    used[next] = 1; syms[i] = next;
  }
  // Tabela direta de mostbits bits: símbolo e tamanho do código.
  const L = mostbits;
  if (L > 20) return null;
  const tSym = new Uint8Array(1 << L), tLen = new Uint8Array(1 << L);
  let k = 0;
  for (let l = 1; l <= L; l++) {
    for (let c = 0; c < count[l]; c++) {
      const code = base[l] + c;
      const lo = code << (L - l), hi = (code + 1) << (L - l);
      for (let x = lo; x < hi; x++) { tSym[x] = syms[k]; tLen[x] = l; }
      k++;
    }
  }
  const out = Buffer.alloc(ulen);
  let o = 0;
  while (o <= ulen) {
    const p = r.peek(L);
    const l = tLen[p];
    if (!l) return null;
    r.skip(l);
    const s = tSym[p];
    if (s !== clue) { if (o >= ulen) return null; out[o++] = s; continue; }
    const run = r.num();
    if (run) {
      if (o === 0 || o + run > ulen) return null;
      out.fill(out[o - 1], o, o + run); o += run; continue;
    }
    if (r.read(1)) break; // fim
    if (o >= ulen) return null;
    out[o++] = r.read(8);
  }
  if (o !== ulen) return null;
  if (type === 0x32FB || type === 0xB2FB) {
    let i = 0; for (let x = 0; x < ulen; x++) { i = (i + out[x]) & 255; out[x] = i; }
  } else if (type === 0x34FB || type === 0xB4FB) {
    let i = 0, c = 0; for (let x = 0; x < ulen; x++) { i = (i + out[x]) & 255; c = (c + i) & 255; out[x] = c; }
  }
  return out;
}
module.exports = { huff };
