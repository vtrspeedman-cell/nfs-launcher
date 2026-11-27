// Junta pacotes de textura num só, no formato versão 2 do texrep_web.c (entradas de 40 bytes, depois as "bases" de
// 8 bytes, os nomes e os dados; cada entrada em deflate cru). Uso: node merge-pak.js <saida.pak> <a.pak> [b.pak ...]
// O jogo lê só 2 pacotes (menus e mapa), e o de mapa (detailed.pak) já vem ligado com o HUD melhorado: juntar o
// nosso a ele faz as texturas valerem sem mudar o settings.ini. Mesma textura em dois pacotes: fica a de maior
// resolução (empate: o primeiro da lista). As entradas da versão 1 entram em deflate "guardado" (sem compressão:
// o jogo só copia ao abrir, sem custo no jogo); as da versão 2 são copiadas como estão, com as bases (diferenças
// de outra entrada) apontando para os mesmos dados.
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const [, , outFile, ...inputs] = process.argv;
// EXCLUIR=<chaves.json> (de hud-igual.js): texturas que o uhud.pak do site também troca ficam fora. Com o HUD
// melhorado ligado, o jogo junta os dois pacotes e, com a mesma chave nos dois, qualquer um pode valer; fora do
// nosso, vale sempre o do site (o HUD fica como o jogador escolheu).
const skipKeys = new Set(process.env.EXCLUIR ? JSON.parse(fs.readFileSync(process.env.EXCLUIR, 'utf8')) : []);
let skipped = 0;

const all = new Map(); // "crc:adler:ow:oh:ofmt" -> entrada escolhida
const blobs = [];      // dados copiados de cada pacote: { buf, from, to } (posições no pacote de origem)
let pos = 0;           // posição de cada blob na área de dados da saída (relativa)
for (const file of inputs) {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'NTXP') throw new Error(`${file}: não é um pacote`);
  const ver = b.readUInt32LE(4), n = b.readUInt32LE(8);
  if (ver !== 1 && ver !== 2) throw new Error(`${file}: versão ${ver}`);
  const baseAt = 16 + 40 * n;
  let first = Infinity;
  const ents = [];
  for (let i = 0; i < n; i++) {
    const o = 16 + 40 * i;
    const e = {
      crc: b.readUInt32LE(o), adler: b.readUInt32LE(o + 4), ow: b.readUInt16LE(o + 8), oh: b.readUInt16LE(o + 10), ofmt: b.readUInt32LE(o + 12),
      w: b.readUInt16LE(o + 16), h: b.readUInt16LE(o + 18), fmt: b.readUInt32LE(o + 20), levels: b.readUInt32LE(o + 24),
      off: b.readUInt32LE(o + 28), size: b.readUInt32LE(o + 32), name: b.readUInt32LE(o + 36), ver, file,
    };
    e.text = b.toString('latin1', e.name, b.indexOf(0, e.name));
    if (ver === 2) { e.boff = b.readUInt32LE(baseAt + 8 * i); e.bsize = b.readUInt32LE(baseAt + 8 * i + 4); if (e.bsize) first = Math.min(first, e.boff); }
    first = Math.min(first, e.off);
    ents.push(e);
  }
  if (ver === 2) {
    // Área de dados da versão 2 copiada inteira (as bases apontam para dentro dela); deslocamento: pos - first.
    const shift = pos - first;
    for (const e of ents) { e.dataOff = e.off + shift; e.dataBoff = e.bsize ? e.boff + shift : 0; }
    blobs.push(b.subarray(first));
    pos += b.length - first;
  } else {
    for (const e of ents) { e.raw = b.subarray(e.off, e.off + e.size); }
  }
  for (const e of ents) {
    const k = `${e.crc}:${e.adler}:${e.ow}:${e.oh}:${e.ofmt}`;
    if (skipKeys.has(k)) { skipped++; continue; }
    const had = all.get(k);
    if (!had || e.w * e.h > had.w * had.h) all.set(k, e);
  }
  console.log(`${file}: versão ${ver}, ${n} texturas`);
}
// Entradas da versão 1 escolhidas: deflate cru "guardado" (nível 0), depois dos dados copiados.
// A mesma imagem em várias entradas (ex.: sombra e neon de cada carro no pack do celular) vai uma vez só.
const sameData = new Map();
for (const e of all.values()) {
  if (e.ver !== 1) continue;
  const key = `${e.file}:${e.off}:${e.raw.length}`;
  const had = sameData.get(key);
  if (had) { e.dataOff = had.dataOff; e.dataBoff = 0; e.size = had.size; e.bsize = 0; continue; }
  const z = zlib.deflateRawSync(e.raw, { level: process.env.NIVEL ? Number(process.env.NIVEL) : 0 });
  e.dataOff = pos; e.dataBoff = 0; e.size = z.length; e.bsize = 0;
  sameData.set(key, e);
  blobs.push(z); pos += z.length;
}
const list = [...all.values()].sort((x, y) => (x.crc - y.crc) || (x.adler - y.adler));
const n = list.length;
const names = Buffer.concat(list.map((e) => Buffer.from(e.text + '\0', 'latin1')));
const namesAt = 16 + 48 * n;
const dataAt = Math.ceil((namesAt + names.length) / 16) * 16;
const head = Buffer.alloc(dataAt);
head.write('NTXP', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(n, 8);
names.copy(head, namesAt);
let nameOff = namesAt;
list.forEach((e, i) => {
  const o = 16 + 40 * i, bo = 16 + 40 * n + 8 * i;
  head.writeUInt32LE(e.crc, o); head.writeUInt32LE(e.adler, o + 4); head.writeUInt16LE(e.ow, o + 8); head.writeUInt16LE(e.oh, o + 10);
  head.writeUInt32LE(e.ofmt, o + 12); head.writeUInt16LE(e.w, o + 16); head.writeUInt16LE(e.h, o + 18); head.writeUInt32LE(e.fmt, o + 20);
  head.writeUInt32LE(e.levels, o + 24); head.writeUInt32LE(dataAt + e.dataOff, o + 28); head.writeUInt32LE(e.size, o + 32);
  head.writeUInt32LE(nameOff, o + 36);
  head.writeUInt32LE(e.bsize ? dataAt + e.dataBoff : 0, bo); head.writeUInt32LE(e.bsize || 0, bo + 4);
  nameOff += Buffer.byteLength(e.text, 'latin1') + 1;
});
const fd = fs.openSync(outFile, 'w');
fs.writeSync(fd, head);
for (const x of blobs) fs.writeSync(fd, x);
fs.closeSync(fd);
const by = {};
for (const e of list) by[e.file] = (by[e.file] || 0) + 1;
console.log(`pronto: ${n} texturas`, JSON.stringify(by), `${(fs.statSync(outFile).size / 2 ** 20).toFixed(1)} MB`, skipped ? `(${skipped} fora: o HUD do site já troca)` : '');
