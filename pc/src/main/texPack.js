'use strict';
// Texturas HD do NFSU2 por partes (pedido do Bruno, 06/11): o instalador traz um pacote de cada mod (TexWizard,
// Redux, Definitive Edition, NextGen) e o mapa detalhado do site, em resources\texturas. O jogador escolhe, para cada parte
// (asfalto, céu, prédios...), de qual mod ela vem, ou "Original". O app NÃO grava um pacote novo no disco: monta
// TEXPACKS/detailed.pak "de mentira", um cabeçalho em memória e trechos lidos dos pacotes de origem na hora em que o
// jogo pede (modFiles.js entrega). Trocar a escolha é instantâneo e não ocupa disco a mais.
//
// Formato NTXP versão 2 (texrep_web.c): "NTXP", versão, quantidade, 4 bytes livres; uma entrada de 40 bytes por textura
// (crc, adler, largura/altura/formato originais, largura/altura/formato novos, níveis, posição, tamanho, posição do
// nome); depois 8 bytes de "base" por entrada (posição e tamanho de outra imagem da qual esta é diferença, ou 0); os
// nomes; e os dados (cada entrada em deflate cru). O jogo reconhece cada textura pelos 5 primeiros campos (a chave).
const fs = require('fs');
const path = require('path');

// TexWizard (pack "02 - Optional - Texture": o visual do próprio jogo em alta resolução) na frente: é o padrão de cada
// parte que ele tem (pedido do Bruno, 06/11). A escolha que o jogador aplicar fica guardada e não volta sozinha.
const MODS = Object.freeze([
  { id: 'texwizard', name: 'TexWizard' },
  { id: 'redux', name: 'Redux' },
  { id: 'definitive', name: 'Definitive Edition' },
  { id: 'nextgen', name: 'NextGen' },
]);
const MOD_IDS = MODS.map((m) => m.id);
const ORIGINAL = 'original';
const SITE = 'site'; // mapa detalhado do site: sempre entra (é o que o jogo já carrega com o mapa detalhado ligado)

// Partes, pelo nome da textura no jogo. A primeira que casa vale; "menus" fica com o resto.
const PARTS = Object.freeze([
  { id: 'asfalto', pt: 'Asfalto e pistas', en: 'Asphalt and tracks', re: /^(RDP_(?!ROADSTRIP_COBBLE)|SHRM_ROAD$|ARC_CONCFREEWAY$)/ },
  { id: 'calcadas', pt: 'Calçadas e paralelepípedo', en: 'Sidewalks and cobblestone', re: /^(ARC_SIDEWALK|RDP_ROADSTRIP_COBBLE|RDT_|ARC_BOARDWALK|ARC_COURTGD|ARC_PRESSED_CONCRETE|ARC_UC_BOARKWALK)/ },
  { id: 'cenario', pt: 'Prédios, muros e objetos', en: 'Buildings, walls and objects', re: /^(ARC_|ARK_|OBJ_|SGN_|SHRM_(?!SKY$)|SHR_|GRG_|GFE_|CRLOT_|PNT_|PRTSHP_|MARBLEFLOOR|SHADOWRAMP)/ },
  { id: 'natureza', pt: 'Árvores, grama e terreno', en: 'Trees, grass and terrain', re: /^(ORG_|TRN_)/ },
  { id: 'ceu', pt: 'Céu', en: 'Sky', re: /^(SKY_|SHRM_SKY$)/ },
  { id: 'carros', pt: 'Carros (neon, faróis e sombra)', en: 'Cars (neon, headlights and shadow)', re: /(^[0-9A-Z]+_NEON$|^[0-9A-Z]+_SHADOW(FE|IG)$|^NEONBLUR$|^HEADLIGHTGLOW$|^CARBONFIBRE$)/ },
  { id: 'efeitos', pt: 'Efeitos (fogo, fumaça e brilhos)', en: 'Effects (fire, smoke and glows)', re: /^SFX_/ },
  { id: 'menus', pt: 'Menus, HUD e mapa', en: 'Menus, HUD and map', re: /./ },
]);
const PART_IDS = PARTS.map((p) => p.id);
const partOf = (name) => (PARTS.find((p) => p.re.test(String(name || ''))) || PARTS[PARTS.length - 1]).id;

const keyOf = (e) => `${e.crc}:${e.adler}:${e.ow}:${e.oh}:${e.ofmt}`;

// Lê o índice de um pacote versão 2 (só o começo do arquivo). Recusa o que não for pacote válido.
function readIndex(file) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    if (head.toString('latin1', 0, 4) !== 'NTXP' || head.readUInt32LE(4) !== 2) throw new Error(`${path.basename(file)}: não é pacote versão 2`);
    const n = head.readUInt32LE(8);
    if (n > 100000) throw new Error(`${path.basename(file)}: índice grande demais`);
    // Índice + bases + nomes cabem bem antes do primeiro dado; lê até o primeiro dado (no máximo 8 MB).
    const idxLen = Math.min(st.size, 16 + 48 * n + 8 * 2 ** 20);
    const b = Buffer.alloc(idxLen);
    fs.readSync(fd, b, 0, idxLen, 0);
    const baseAt = 16 + 40 * n;
    const entries = [];
    let dataStart = st.size;
    for (let i = 0; i < n; i++) {
      const o = 16 + 40 * i;
      const e = {
        crc: b.readUInt32LE(o), adler: b.readUInt32LE(o + 4), ow: b.readUInt16LE(o + 8), oh: b.readUInt16LE(o + 10), ofmt: b.readUInt32LE(o + 12),
        w: b.readUInt16LE(o + 16), h: b.readUInt16LE(o + 18), fmt: b.readUInt32LE(o + 20), levels: b.readUInt32LE(o + 24),
        off: b.readUInt32LE(o + 28), size: b.readUInt32LE(o + 32),
        boff: b.readUInt32LE(baseAt + 8 * i), bsize: b.readUInt32LE(baseAt + 8 * i + 4),
      };
      const nameAt = b.readUInt32LE(o + 36);
      const end = b.indexOf(0, nameAt);
      e.name = nameAt < idxLen && end > nameAt ? b.toString('latin1', nameAt, end) : '';
      if (e.off + e.size > st.size || (e.bsize && e.boff + e.bsize > st.size)) throw new Error(`${path.basename(file)}: entrada fora do arquivo`);
      dataStart = Math.min(dataStart, e.off, e.bsize ? e.boff : Infinity);
      e.key = keyOf(e);
      entries.push(e);
    }
    return { file, size: st.size, mtime: Math.floor(st.mtimeMs / 1000), entries, dataStart };
  } finally { fs.closeSync(fd); }
}

// Pacotes presentes na pasta (site.pak, redux.pak...). Os que faltam (desmarcados no instalador) ficam de fora.
function findSources(dir, log = () => {}) {
  const out = {};
  for (const id of [SITE, ...MOD_IDS]) {
    const f = path.join(dir, `${id}.pak`);
    if (!fs.existsSync(f)) continue;
    try { out[id] = readIndex(f); } catch (e) { log(`pacote "${id}" ignorado: ${e.message}`); }
  }
  return out;
}

// Quais mods têm texturas em cada parte (para a tela só oferecer o que existe).
function partsAvailable(sources) {
  const out = Object.fromEntries(PART_IDS.map((p) => [p, []]));
  for (const id of MOD_IDS) {
    if (!sources[id]) continue;
    const parts = new Set(sources[id].entries.map((e) => partOf(e.name)));
    for (const p of PART_IDS) if (parts.has(p)) out[p].push(id);
  }
  return out;
}

// Ordem que vale de fato em cada parte (pedido do Bruno, 08/11): uma lista com a 1ª escolha, a 2ª... Só entram os mods
// que o jogador pôs na lista e que existem na parte; o que nenhum deles tiver fica original (nada é completado sozinho,
// para não entrar textura "feia" de um mod que ele não quis). Lista vazia = "Original".
// Sem escolha guardada: só a 1ª, o primeiro mod que tem a parte (TexWizard, Redux, Definitive, NextGen).
// Escolha da 3.0.4 (um mod só, texto): vira a 1ª, sem 2ª.
function effectiveChoice(choice, avail) {
  const c = choice && typeof choice === 'object' ? choice : {};
  const out = {};
  for (const p of PART_IDS) {
    const list = avail[p] || [];
    const v = c[p];
    out[p] = Array.isArray(v) ? [...new Set(v)].filter((id) => list.includes(id))
      : v === ORIGINAL ? []
        : list.includes(v) ? [v]
          : list.slice(0, 1);
  }
  return out;
}

// Escolhe as entradas. Mapa do site: sempre. Em cada parte, a 1ª escolha vem primeiro e as seguintes só completam as
// texturas que as anteriores não têm; lista vazia = nada daquela parte. Mesma textura no site e num mod:
// fica a de maior resolução (empate: a do site), como na 3.0.0.
function choose(sources, choice) {
  const eff = effectiveChoice(choice, partsAvailable(sources));
  const picked = new Map();
  for (const e of (sources[SITE] && sources[SITE].entries) || []) picked.set(e.key, { e, src: SITE });
  const fromMods = new Map();
  for (const p of PART_IDS) {
    for (const id of eff[p]) {
      if (!sources[id]) continue;
      for (const e of sources[id].entries) {
        if (partOf(e.name) !== p || fromMods.has(e.key)) continue;
        fromMods.set(e.key, { e, src: id });
      }
    }
  }
  for (const [k, x] of fromMods) {
    const had = picked.get(k);
    if (!had || x.e.w * x.e.h > had.e.w * had.e.h) picked.set(k, x);
  }
  return { eff, list: [...picked.values()].sort((a, b) => (a.e.crc - b.e.crc) || (a.e.adler - b.e.adler)) };
}

// Monta o pacote virtual. Dados: a área inteira do site (as bases apontam para dentro dela) e, de cada mod, só o
// trecho de cada entrada escolhida (os pacotes dos mods não usam base). Devolve tamanho, cabeçalho e trechos.
function compose(sources, choice) {
  const { eff, list } = choose(sources, choice);
  const n = list.length;
  const names = Buffer.concat(list.map(({ e }) => Buffer.from(`${e.name}\0`, 'latin1')));
  const namesAt = 16 + 48 * n;
  const dataAt = Math.ceil((namesAt + names.length) / 16) * 16;
  const head = Buffer.alloc(dataAt);
  head.write('NTXP', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(n, 8);
  names.copy(head, namesAt);
  const segs = [{ start: 0, end: dataAt, buf: head }];
  let pos = dataAt;
  const site = sources[SITE];
  let siteShift = 0;
  if (site && list.some((x) => x.src === SITE)) {
    siteShift = pos - site.dataStart;
    segs.push({ start: pos, end: pos + site.size - site.dataStart, file: site.file, from: site.dataStart });
    pos += site.size - site.dataStart;
  }
  let nameOff = namesAt;
  const counts = {};
  list.forEach(({ e, src }, i) => {
    counts[src] = (counts[src] || 0) + 1;
    let off, boff = 0, bsize = 0;
    if (src === SITE) { off = e.off + siteShift; if (e.bsize) { boff = e.boff + siteShift; bsize = e.bsize; } } else {
      if (e.bsize) throw new Error(`textura "${e.name}" do ${src} usa base (não suportado)`);
      off = pos;
      segs.push({ start: pos, end: pos + e.size, file: sources[src].file, from: e.off });
      pos += e.size;
    }
    const o = 16 + 40 * i, bo = 16 + 40 * n + 8 * i;
    head.writeUInt32LE(e.crc, o); head.writeUInt32LE(e.adler, o + 4); head.writeUInt16LE(e.ow, o + 8); head.writeUInt16LE(e.oh, o + 10);
    head.writeUInt32LE(e.ofmt, o + 12); head.writeUInt16LE(e.w, o + 16); head.writeUInt16LE(e.h, o + 18); head.writeUInt32LE(e.fmt, o + 20);
    head.writeUInt32LE(e.levels, o + 24); head.writeUInt32LE(off, o + 28); head.writeUInt32LE(e.size, o + 32);
    head.writeUInt32LE(nameOff, o + 36);
    head.writeUInt32LE(boff, bo); head.writeUInt32LE(bsize, bo + 4);
    nameOff += Buffer.byteLength(e.name, 'latin1') + 1;
  });
  // Texturas que vêm de um mod: os pacotes do jogo entram sem elas (maskPack.js).
  const modKeys = new Set(list.filter((x) => x.src !== SITE).map(({ e }) => `${e.crc >>> 0}:${e.adler >>> 0}`));
  return { size: pos, segs, count: n, counts, eff, modKeys };
}

// Lê [start, end) do pacote virtual, juntando cabeçalho e trechos dos arquivos de origem.
function readVirtual(v, start, end) {
  const out = Buffer.alloc(end - start);
  const fds = new Map();
  try {
    for (const s of v.segs) {
      if (s.end <= start || s.start >= end) continue;
      const a = Math.max(start, s.start), b = Math.min(end, s.end);
      if (s.buf) { s.buf.copy(out, a - start, a - s.start, b - s.start); continue; }
      if (!fds.has(s.file)) fds.set(s.file, fs.openSync(s.file, 'r'));
      let got = 0;
      while (got < b - a) {
        const k = fs.readSync(fds.get(s.file), out, a - start + got, b - a - got, s.from + (a - s.start) + got);
        if (k <= 0) return null;
        got += k;
      }
    }
    return out;
  } finally { for (const fd of fds.values()) fs.closeSync(fd); }
}

// Data "de mentira" do pacote: o jogo guarda a cópia como caminho.tamanho.data, então cada escolha precisa de uma data
// própria (senão, com o mesmo tamanho, usaria a cópia de outra escolha). Sempre a mesma para a mesma escolha.
function stamp(sources, eff) {
  const ids = Object.keys(sources).sort();
  const text = JSON.stringify([ids.map((id) => [id, sources[id].size, sources[id].mtime]), PART_IDS.map((p) => eff[p])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const newest = Math.max(...ids.map((id) => sources[id].mtime));
  return newest + (h % 1000000);
}

// O "arquivo" que modFiles entrega no lugar de TEXPACKS/detailed.pak. check(): os pacotes de origem continuam iguais.
function virtualMod(sources, choice, p = 'TEXPACKS/detailed.pak') {
  const v = compose(sources, choice);
  const files = Object.values(sources).map((s) => ({ file: s.file, size: s.size, mtime: s.mtime }));
  return {
    p, s: v.size, m: stamp(sources, v.eff), virtual: v,
    read: (a, b) => readVirtual(v, a, b),
    check: () => files.every((f) => { try { const st = fs.statSync(f.file); return st.size === f.size && Math.floor(st.mtimeMs / 1000) === f.mtime; } catch { return false; } }),
  };
}

// Escolha guardada nas configurações: só partes e mods conhecidos, sem repetir. Lista (ordem do jogador) ou, da 3.0.4,
// um mod só ou "original" (effectiveChoice entende os dois).
function sanitizeChoice(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const p of PART_IDS) {
    const v = raw[p];
    if (Array.isArray(v)) out[p] = [...new Set(v)].filter((id) => MOD_IDS.includes(id));
    else if ([ORIGINAL, ...MOD_IDS].includes(v)) out[p] = v;
  }
  return out;
}

module.exports = { MODS, MOD_IDS, ORIGINAL, SITE, PARTS, PART_IDS, partOf, readIndex, findSources, partsAvailable, effectiveChoice, choose, compose, readVirtual, stamp, virtualMod, sanitizeChoice };
