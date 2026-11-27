// Procura melhor as originais (só leitura): TPK em qualquer posição do arquivo, TPK com texturas comprimidas
// (lista 33310003), arquivo inteiro em JDLZ e textura de paleta (P8) convertida para 32 bits como o jogo de PC faz.
// Uso: node scan2.js <raiz do File System> <saida-achadas.json> <catalogo.json> <a.tpf> [b.tpf ...]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const tpf = require('./list.js');
const { jdlz } = require('./dyn.js');
const { huff } = require('./huff.js');
const WITH_VINYL = process.env.VINIL === '1'; // vinis: ~70 mil texturas por carro, só se pedir

const [, , root, outFile, catFile, ...tpfs] = process.argv;
const want = new Map();
// QUERO=<arquivo.json> ([[hash, nome], ...]): procura esses hashes do Texmod (ex.: do catalogo.json), além dos .tpf.
if (process.env.QUERO) for (const [h, f] of JSON.parse(fs.readFileSync(process.env.QUERO, 'utf8'))) want.set(h >>> 0, f);
for (const file of tpfs) {
  const buf = tpf.unxor(fs.readFileSync(file));
  const def = tpf.entries(buf).find((e) => /texmod\.def$/i.test(e.name));
  for (const l of tpf.read(buf, def).toString('latin1').split('\n')) {
    const [h, f] = l.replace('\r', '').split('|');
    if (f) want.set(parseInt(h, 16) >>> 0, f);
  }
}

const FOURCC = { DXT1: 0x31545844, DXT3: 0x33545844, DXT5: 0x35545844 };
const BPP = { 21: 32, 22: 32, 23: 16, 24: 24, 25: 16, 26: 16, 28: 8, 50: 8, 51: 16, 41: 8 };
function lv0Size(fmt, w, h) {
  if (fmt === FOURCC.DXT1) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 8;
  if (fmt === FOURCC.DXT3 || fmt === FOURCC.DXT5) return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 16;
  if (BPP[fmt]) return w * h * BPP[fmt] / 8;
  return 0;
}
const texmodBits = (fmt) => (fmt === FOURCC.DXT1 ? 4 : fmt === FOURCC.DXT3 || fmt === FOURCC.DXT5 ? 8 : BPP[fmt] || 0);
const tm = (b) => (zlib.crc32(b) ^ 0xFFFFFFFF) >>> 0;
function adler32(b) { let a = 1, s = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; }

function* chunks(b, a, e) {
  while (a + 8 <= e) {
    const id = b.readUInt32LE(a), size = b.readUInt32LE(a + 4);
    if (a + 8 + size > e) return;
    yield { id, at: a, s: a + 8, e: a + 8 + size };
    a += 8 + size;
  }
}
function* inside(b, c, depth = 0) {
  for (const d of chunks(b, c.s, c.e)) {
    yield d;
    if ((d.id & 0x80000000) && depth < 3) yield* inside(b, d, depth + 1);
  }
}
// Todos os TPK do arquivo: procura a assinatura em qualquer posição alinhada a 4 bytes e confere o tamanho.
function* allTpks(b) {
  const sig = Buffer.from([0x00, 0x00, 0x30, 0xB3]);
  let at = 0;
  while ((at = b.indexOf(sig, at)) >= 0) {
    if (at % 4 === 0 && at + 8 <= b.length) {
      const size = b.readUInt32LE(at + 4);
      let ok = false;
      if (size >= 16 && at + 8 + size <= b.length) for (const c of chunks(b, at + 8, at + 8 + size)) if (c.id === 0xB3310000) { ok = true; break; }
      if (ok) {
        yield { at, s: at + 8, e: at + 8 + size };
        at += 8 + size; continue;
      }
    }
    at += 4;
  }
}

const found = new Map(), cat = [];
const stats = { files: 0, jdlzFiles: 0, tpk: 0, tpkComp: 0, tex: 0, compTex: 0, compBad: 0, fmts: {}, compMagic: {}, p8: 0, p8hit: 0 };
const via = {};
function hit(hash, info, how) {
  if (!want.has(hash) || found.has(hash)) return false;
  found.set(hash, { file: want.get(hash), ...info });
  via[how] = (via[how] || 0) + 1;
  return true;
}
// Paleta (P8): o jogo de PC cria a textura em A8R8G8B8 (formato 21), com as cores da paleta como estão guardadas
// (B, G, R, A). Conferido: 37 de rua e 3 do HUD batem com o Texmod assim, e o uhud.pak do site usa o formato 21.
function p8ToArgb(idx, pal) {
  const px = Buffer.alloc(idx.length * 4);
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i] * 4;
    if (p + 4 > pal.length) return null;
    px[i * 4] = pal[p]; px[i * 4 + 1] = pal[p + 1]; px[i * 4 + 2] = pal[p + 2]; px[i * 4 + 3] = pal[p + 3];
  }
  return px;
}
// palSrc(o, n): a paleta no deslocamento o do registro (0x34): no TPK normal, contado do começo dos dados; no
// comprimido, cada bloco tem a própria paleta logo depois da imagem.
function texture(rec, plat, lv0src, where, comp, palSrc) {
  const w = rec.readUInt16LE(0x44), h = rec.readUInt16LE(0x46);
  const fmt = plat.readUInt32LE(0x14);
  const name = rec.toString('latin1', 0x0C, 0x24).replace(/\0.*$/s, '');
  stats.tex++; if (comp) stats.compTex++;
  const fk = fmt > 0xFFFF ? Buffer.from([fmt & 255, (fmt >> 8) & 255, (fmt >> 16) & 255, fmt >>> 24]).toString('latin1') : String(fmt);
  stats.fmts[fk] = (stats.fmts[fk] || 0) + 1;
  const size = lv0Size(fmt, w, h);
  const entry = { name, w, h, fmt: fk, where, comp: !!comp };
  cat.push(entry);
  if (!size) return;
  const lv0 = lv0src(0, size);
  if (!lv0) { entry.short = true; return; }
  const bits = texmodBits(fmt);
  const t = tm(lv0.subarray(0, bits * w * h / 8));
  entry.tm = t.toString(16).toUpperCase().padStart(8, '0');
  const info = () => ({ w, h, fmt, crc: zlib.crc32(lv0) >>> 0, adler: adler32(lv0), name, where });
  if (want.has(t)) { entry.want = true; if (hit(t, info(), comp ? 'comprimido' : 'normal')) entry.novo = true; }
  if (fmt === 41) {
    stats.p8++;
    const palSize = Math.min(1024, rec.readUInt32LE(0x3C) || 1024);
    const pal = comp ? lv0src(rec.readUInt32LE(0x34) - rec.readUInt32LE(0x30), palSize) : palSrc(rec.readUInt32LE(0x34), palSize);
    if (!pal) { entry.semPaleta = true; return; }
    const px = p8ToArgb(lv0, pal);
    if (!px) return;
    const h2 = tm(px);
    entry.tm = h2.toString(16).toUpperCase().padStart(8, '0');
    if (want.has(h2)) {
      stats.p8hit++; entry.want = true;
      // Chave do texrep: CRC-32 e Adler-32 do nível 0 como o jogo envia (32 bits), formato 21.
      if (hit(h2, { w, h, fmt: 21, crc: zlib.crc32(px) >>> 0, adler: adler32(px), name, where, p8: true }, 'paleta')) entry.novo = true;
    }
  }
}

function scanBuffer(b, label) {
  for (const t of allTpks(b)) {
    stats.tpk++;
    let recs = null, plat = null, data = null, list = null, hdr = null;
    for (const c of inside(b, t)) {
      if (c.id === 0x33310004) recs = c;
      else if (c.id === 0x33310005) plat = c;
      else if (c.id === 0x33320002) data = c;
      else if (c.id === 0x33310003) list = c;
      else if (c.id === 0x33310001) hdr = c;
    }
    const tpkName = hdr ? b.toString('latin1', hdr.s + 4, hdr.s + 0x24).replace(/\0.*$/s, '') : '';
    if (tpkName === 'VINYL' && !WITH_VINYL) { stats.vinylSkipped = (stats.vinylSkipped || 0) + 1; continue; }
    if (recs && plat && data) {
      const n = Math.floor((recs.e - recs.s) / 0x7C);
      for (let i = 0; i < n; i++) {
        const r = recs.s + i * 0x7C, p = plat.s + i * 0x20;
        if (p + 0x20 > plat.e) break;
        const rec = b.subarray(r, r + 0x7C), pl = b.subarray(p, p + 0x20);
        const off = rec.readUInt32LE(0x30);
        // O começo dos dados pode estar alinhado a 0x80; vale o que der a textura procurada.
        let best = null;
        const srcAt = (s) => (o, n2) => (s + off + o + n2 <= data.e && o >= 0 ? b.subarray(s + off + o, s + off + o + n2) : null);
        const palAt = (s) => (o, n2) => (s + o + n2 <= data.e && o >= 0 ? b.subarray(s + o, s + o + n2) : null);
        for (const s of [data.s, (data.s + 0x7F) & ~0x7F]) {
          const before = found.size;
          texture(rec, pl, srcAt(s), label, false, palAt(s));
          if (found.size > before) { best = s; break; }
          cat.pop(); stats.tex--;
        }
        if (best === null) texture(rec, pl, srcAt(data.s), label, false, palAt(data.s));
      }
    }
    if (list) {
      stats.tpkComp++;
      for (let at = list.s; at + 24 <= list.e; at += 24) {
        const off = b.readUInt32LE(at + 4), csize = b.readUInt32LE(at + 8), full = b.readUInt32LE(at + 12);
        let u = null;
        for (const base of [0, t.at, data ? data.s : -1]) {
          if (base < 0) continue;
          const a = base + off;
          if (a + csize > b.length || csize < 16) continue;
          const magic = b.toString('latin1', a, a + 4);
          const blk = b.subarray(a, a + csize);
          if (magic === 'JDLZ') u = jdlz(blk);
          else if (magic === 'HUFF') { try { u = huff(blk); } catch (e) { u = null; } stats.huff = (stats.huff || 0) + 1; if (u && u.length === full) stats.huffOk = (stats.huffOk || 0) + 1; }
          else if (magic === 'RAWW') u = Buffer.from(blk.subarray(16, 16 + blk.readUInt32LE(8)));
          else continue;
          if (u && u.length === full) break;
          u = null;
        }
        if (!u || u.length < 156) { stats.compBad++; continue; }
        const r = u.length - 156;
        const rec = u.subarray(r, r + 0x7C), pl = u.subarray(r + 0x7C, r + 156);
        texture(rec, pl, (o, n2) => (o >= 0 && o + n2 <= r ? u.subarray(o, o + n2) : null), label, true);
      }
    }
  }
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? (x.name === 'Paths' ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
for (const f of walk(root)) {
  const st = fs.statSync(f);
  if (st.size < 4096) continue;
  const fd = fs.openSync(f, 'r'); const head = Buffer.alloc(4); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
  if (head.toString('latin1') === 'NTXP') continue; // pacote de texturas nosso, guardado pelo jogo
  stats.files++;
  let b = fs.readFileSync(f);
  if (b.toString('latin1', 0, 4) === 'JDLZ') { const u = jdlz(b); if (u) { stats.jdlzFiles++; b = u; } else continue; }
  try { scanBuffer(b, path.relative(root, f)); } catch (e) { console.log('erro em', f, e.message); }
}
console.log(JSON.stringify(stats));
console.log('via', JSON.stringify(via));
console.log('achadas', found.size, 'de', want.size);
if (process.env.OLD) {
  const old = new Map(process.env.OLD.split(',').flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
  const lost = [...old.keys()].filter((h) => !found.has(h));
  const fresh = [...found.keys()].filter((h) => !old.has(h));
  console.log('antes achadas e agora não:', lost.length, lost.map((h) => `${old.get(h).name} ${old.get(h).w}x${old.get(h).h} (${old.get(h).where})`).join('; '));
  console.log('novas:', fresh.length);
  for (const h of fresh) { const v = found.get(h); console.log('  ', h.toString(16).toUpperCase().padStart(8, '0'), v.name, `${v.w}x${v.h}`, v.fmt.toString(16), v.where, v.p8 || ''); }
  const still = [...want.keys()].filter((h) => !found.has(h));
  console.log('ainda faltam:', still.length, still.map((h) => h.toString(16).toUpperCase().padStart(8, '0')).join(' '));
}
fs.writeFileSync(outFile, JSON.stringify([...found.entries()]));
fs.writeFileSync(catFile, JSON.stringify(cat));
