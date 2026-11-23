'use strict';
// GLOBALB.BUN do jogo para o editor de save (0-100, 1/4 de milha, potência e curva). O app pede ao site do jogo
// escolhido (NFSU2 e Modded têm arquivos diferentes) e guarda uma cópia por "tamanho.data" da lista do site.
// Sem rede ou com erro: devolve null e o jogador carrega o arquivo à mão, como antes.
const fs = require('fs');
const path = require('path');

const FILE = 'GLOBAL/GLOBALB.BUN';
const MIN = 1 << 20;
const MAX = 64 << 20;
const WAIT_MS = 30000;

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { cache: 'no-store', signal: AbortSignal.timeout(WAIT_MS) });
  if (res.status !== 200) throw new Error(`site respondeu ${res.status}`);
  return res.json();
}

function entryOf(manifest) {
  const files = Array.isArray(manifest && manifest.files) ? manifest.files : [];
  const f = files.find((x) => x && typeof x.p === 'string' && x.p.toUpperCase() === FILE);
  if (!f || !(f.s >= MIN && f.s <= MAX)) return null;
  return { s: f.s, m: Number(f.m) || 0 };
}

async function load({ id, origin, dir, fetchFn }) {
  try {
    const f = entryOf(await getJson(fetchFn, `${origin}/data-manifest`));
    if (!f) return null;
    const keep = path.join(dir, `${id}-${f.s}-${f.m}.bun`);
    try { const b = fs.readFileSync(keep); if (b.length === f.s) return b; } catch { /* baixa */ }
    let buf = null;
    for (let t = 0; t < 2 && !buf; t++) {
      try {
        const res = await fetchFn(`${origin}/data/${FILE}`, { signal: AbortSignal.timeout(WAIT_MS) });
        if (res.status !== 200) continue;
        const b = Buffer.from(await res.arrayBuffer());
        if (b.length === f.s) buf = b;
      } catch { /* tenta de novo */ }
    }
    if (!buf) return null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const old of fs.readdirSync(dir)) if (old.startsWith(`${id}-`) && old.endsWith('.bun')) fs.rmSync(path.join(dir, old), { force: true });
      fs.writeFileSync(keep, buf);
    } catch { /* sem cópia: baixa de novo na próxima */ }
    return buf;
  } catch { return null; }
}

module.exports = { FILE, entryOf, load };
