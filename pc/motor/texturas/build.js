// Monta TEXPACKS/<nome>.pak (formato NTXP versão 1 do texrep_web.c) com as texturas do .tpf achadas no jogo.
'use strict';
const fs = require('fs');
const tpf = require('./list.js');
// Uso: node build.js <found.json[,outro.json]> <saida.pak> <a.tpf> [b.tpf ...] [+c.tpf ...]
// Sem "+": entre esses, a maior resolução vence (empate: o último). Com "+" (pedido do Bruno, 06/11): o .tpf só
// acrescenta texturas que nenhum dos outros troca; nunca substitui.
// PULADAS=1 lista as texturas que ficaram fora e por quê. PROPORCAO=1 aceita imagem do mod com proporção diferente
// da original (o jogo desenha de 0 a 1 na mesma superfície, como o Texmod faz no PC); EXTRA=<arquivo.json> junta
// imagens já convertidas (ex.: JPG do mod), [hash, { w, h, fmt: 21, file: "<arquivo .bgra>" }].
// PREFERIR=<arquivo.tpf>=<regex> (pedido do Bruno, 06/11: asfalto do Redux, o do Definitive parece sempre molhado):
// nas texturas cujo nome casa com a regex, vale a imagem desse .tpf quando ele a tem, mesmo menor ou empatada.
const [, , foundFiles, outFile, ...tpfArgs] = process.argv;
const prefer = process.env.PREFERIR ? (() => {
  const i = process.env.PREFERIR.indexOf('=');
  return { file: process.env.PREFERIR.slice(0, i).toLowerCase(), re: new RegExp(process.env.PREFERIR.slice(i + 1), 'i') };
})() : null;
const preferred = [];
const packs = tpfArgs.map((arg) => {
  const addOnly = arg.startsWith('+');
  const file = addOnly ? arg.slice(1) : arg;
  const buf = tpf.unxor(fs.readFileSync(file));
  const ents = tpf.entries(buf);
  const byName = new Map(ents.map((e) => [e.name.toLowerCase(), e]));
  const def = ents.find((e) => /texmod\.def$/i.test(e.name));
  const byHash = new Map();
  for (const l of tpf.read(buf, def).toString('latin1').split('\n')) {
    const [h, f] = l.replace('\r', '').split('|');
    if (f && byName.has(f.toLowerCase())) byHash.set(parseInt(h, 16) >>> 0, byName.get(f.toLowerCase()));
  }
  return { file, buf, byHash, addOnly };
});
const found = new Map(foundFiles.split(',').flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
const extra = new Map(process.env.EXTRA ? JSON.parse(fs.readFileSync(process.env.EXTRA, 'utf8')) : []);
const from = {};
const FOURCC = { DXT1: 0x31545844, DXT3: 0x33545844, DXT5: 0x35545844 };
const blockBytes = (fmt) => (fmt === FOURCC.DXT1 ? 8 : fmt === FOURCC.DXT3 || fmt === FOURCC.DXT5 ? 16 : 0);
const levelSize = (fmt, w, h) => (fmt === 21 ? w * h * 4 : Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * blockBytes(fmt));

const ents = [], skip = {}, skipList = [];
const no = (why, f, info) => {
  skip[why] = (skip[why] || 0) + 1;
  if (f) skipList.push(`${why}: ${f.name} ${f.w}x${f.h} (${f.file})${info ? ' ' + info : ''}`);
};
// Níveis menores de uma imagem BGRA (média de 2x2), para as imagens convertidas fora (EXTRA).
function bgraLevels(px, w, h) {
  const out = [{ w, h, data: px }];
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), dx = w > 1 ? 1 : 0, dy = h > 1 ? 1 : 0;
    const d = Buffer.alloc(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const a = ((y << dy) * w + (x << dx)) * 4, b = a + dx * 4, c = a + dy * w * 4, e = c + dx * 4;
      for (let k = 0; k < 4; k++) d[(y * nw + x) * 4 + k] = (px[a + k] + px[b + k] + px[c + k] + px[e + k] + 2) >> 2;
    }
    out.push({ w: nw, h: nh, data: d });
    px = d; w = nw; h = nh;
  }
  return out;
}
for (const [hash, f] of found) {
  // Pedido do Bruno (melhor imagem): entre os .tpf que têm a textura, a de maior resolução; no empate, o último (mais novo).
  let pk = null, d = null;
  const main = packs.some((p) => !p.addOnly && p.byHash.has(hash));
  for (const p of packs) {
    if (!p.byHash.has(hash) || (main && p.addOnly)) continue;
    if (p.addOnly && pk) continue; // entre os de "só acrescentar", fica o primeiro
    const x = tpf.read(p.buf, p.byHash.get(hash));
    if (x.toString('latin1', 0, 4) !== 'DDS ') { if (!d) { pk = p; d = x; } continue; }
    if (!d || d.toString('latin1', 0, 4) !== 'DDS ' || x.readUInt32LE(12) * x.readUInt32LE(16) >= d.readUInt32LE(12) * d.readUInt32LE(16)) { pk = p; d = x; }
  }
  if (prefer && prefer.re.test(f.name)) {
    const p = packs.find((q) => require('path').basename(q.file).toLowerCase() === prefer.file && q.byHash.has(hash));
    if (p && p !== pk) {
      const x = tpf.read(p.buf, p.byHash.get(hash));
      if (x.toString('latin1', 0, 4) === 'DDS ') { pk = p; d = x; preferred.push(f.name); }
    }
  }
  if (!pk) { no('sem arquivo no tpf', f); continue; }
  const tag = require('path').basename(pk.file);
  let w, h, fmt, levels;
  // EXTRA também troca uma imagem DDS do mod (aumentar.js: as menores que a original, esticadas até ela).
  if (d.toString('latin1', 0, 4) !== 'DDS ' || extra.has(hash)) {
    const x = extra.get(hash);
    if (!x) { no('não é DDS', f, d.toString('latin1', 0, 4).replace(/[^\x20-\x7e]/g, '.')); continue; }
    const px = fs.readFileSync(x.file);
    levels = bgraLevels(px, x.w, x.h);
    fmt = 21;
  } else {
    h = d.readUInt32LE(12); w = d.readUInt32LE(16);
    const flags = d.readUInt32LE(8);
    const mips = (flags & 0x20000) ? Math.max(1, d.readUInt32LE(28)) : 1;
    const pfFlags = d.readUInt32LE(80);
    fmt = (pfFlags & 4) ? d.readUInt32LE(84) : (d.readUInt32LE(88) === 32 ? 21 : 0);
    if (fmt === 0x30315844) { no('DX10', f); continue; }
    if (!levelSize(fmt, w, h)) { no('formato ' + fmt.toString(16), f); continue; }
    // Níveis do arquivo, em ordem.
    let at = 128;
    levels = [];
    for (let i = 0; i < mips; i++) {
      const lw = Math.max(1, w >> i), lh = Math.max(1, h >> i), n = levelSize(fmt, lw, lh);
      if (at + n > d.length) break;
      levels.push({ w: lw, h: lh, data: d.subarray(at, at + n) });
      at += n;
    }
  }
  // O jogo aceita até 4096 de lado, e cada envio à placa vai até 32 MB (metade da fila de 64 MB, gpu_web.c).
  // Pedido do Bruno: reduzir o mínimo possível. Começa no maior nível em que o lado cabe e a textura inteira
  // (com os níveis menores) fica abaixo de 32 MB, valendo também se o jogo mandar tudo de uma vez.
  const LIMIT = 32 * 2 ** 20 - 256;
  const total = (i) => levels.slice(i, i + 13).reduce((s, l) => s + l.data.length, 0);
  // Celular (pedido do Bruno, 06/11): ESCALA_MAX=2 usa o maior nível do mod com até 2x o lado da original (os níveis
  // já vêm no arquivo, sem comprimir de novo); se o mod já é menor que isso, fica como está (nunca aumenta).
  const k = Number(process.env.ESCALA_MAX || 0);
  // ESCALA_LIVRE=<regex>: nomes fora do limite (pedido do Bruno, 06/11: céu do NextGen inteiro no celular).
  const free = process.env.ESCALA_LIVRE && new RegExp(process.env.ESCALA_LIVRE, 'i').test(f.name || '');
  const fits = (l) => !k || free || (l.w <= f.w * k && l.h <= f.h * k);
  const first = levels.findIndex((l, i) => l.w <= 4096 && l.h <= 4096 && total(i) <= LIMIT && fits(l));
  if (first > 0 && levels[0].w <= 4096) console.log('diminuída pela fila:', f.file, `${levels[0].w}x${levels[0].h} -> ${levels[first].w}x${levels[first].h}`, 'formato', fmt);
  if (first < 0) { no('grande demais e sem níveis menores', f); continue; }
  const use = levels.slice(first, first + 13);
  w = use[0].w; h = use[0].h;
  // Regra do texpacks.py do jogo: mesma proporção e não menor que a original. Com PROPORCAO=1, a proporção pode
  // mudar (fica como o autor do mod viu no PC).
  if (w * f.h !== h * f.w && process.env.PROPORCAO !== '1') { no('proporção diferente', f, `mod ${w}x${h}`); continue; }
  if (w < f.w || h < f.h) { no('menor que a original', f, `mod ${w}x${h}`); continue; }
  from[tag] = (from[tag] || 0) + 1;
  // Nome do jogo (ex.: RDP_ROADSTRIP_MA) desde 06/11: o app separa as texturas em partes (asfalto, céu...) por ele.
  ents.push({ f, w, h, fmt, levels: use, name: f.name || f.file, cut: first });
}
ents.sort((a, b) => (a.f.crc - b.f.crc) || (a.f.adler - b.f.adler));

const n = ents.length;
const names = Buffer.concat(ents.map((x) => Buffer.from(x.name + '\0', 'latin1')));
const namesAt = 16 + 40 * n;
const dataAt = Math.ceil((namesAt + names.length) / 4096) * 4096;
const head = Buffer.alloc(dataAt);
head.write('NTXP', 0, 'latin1'); head.writeUInt32LE(1, 4); head.writeUInt32LE(n, 8);
names.copy(head, namesAt);
const fd = fs.openSync(outFile, 'w');
let pos = dataAt, nameOff = namesAt;
ents.forEach((x, i) => {
  const body = Buffer.concat(x.levels.map((l) => l.data));
  pos = Math.ceil(pos / 16) * 16;
  fs.writeSync(fd, body, 0, body.length, pos);
  const o = 16 + 40 * i;
  head.writeUInt32LE(x.f.crc, o); head.writeUInt32LE(x.f.adler, o + 4);
  head.writeUInt16LE(x.f.w, o + 8); head.writeUInt16LE(x.f.h, o + 10); head.writeUInt32LE(x.f.fmt, o + 12);
  head.writeUInt16LE(x.w, o + 16); head.writeUInt16LE(x.h, o + 18); head.writeUInt32LE(x.fmt, o + 20);
  head.writeUInt32LE(x.levels.length, o + 24); head.writeUInt32LE(pos, o + 28); head.writeUInt32LE(body.length, o + 32);
  head.writeUInt32LE(nameOff, o + 36);
  nameOff += Buffer.byteLength(x.name, 'latin1') + 1;
  pos += body.length;
});
fs.writeSync(fd, head, 0, head.length, 0);
fs.closeSync(fd);
console.log('de cada tpf', JSON.stringify(from));
console.log('entradas', n, 'cortadas para caber', ents.filter((x) => x.cut).length, 'puladas', JSON.stringify(skip), 'MB', (pos / 2 ** 20).toFixed(1));
const ex = ents.slice(0, 5).map((x) => `${x.f.name} ${x.f.w}x${x.f.h} -> ${x.w}x${x.h} níveis ${x.levels.length}`);
console.log(ex.join('\n'));
if (process.env.PULADAS) console.log(skipList.join('\n'));
if (prefer) console.log(`trocadas para ${prefer.file} (${preferred.length}):`, preferred.sort().join(' '));
