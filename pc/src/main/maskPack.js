'use strict';
// "Estradas mais nítidas" do jogo por baixo das Texturas HD: os pacotes do jogo (estradas, céus, carros, cidade)
// continuam entrando, mas sem as texturas que o modpack escolhido já tem. O app entrega uma cópia do pacote do site
// com essas entradas escondidas (largura original 0: o jogo não acha a textura e fica com a do modpack); o resto vem
// do site, byte a byte. Nada é gravado no disco.

const PACKS = ['TEXPACKS/roads.pak', 'TEXPACKS/skies.pak', 'TEXPACKS/cars.pak', 'TEXPACKS/city.pak'];
const MAX_ENTRIES = 65536;

const keyOf = (crc, adler) => `${crc >>> 0}:${adler >>> 0}`;

function hashOf(keys) {
  const text = [...keys].sort().join(',');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % 1000000;
}

// Posições (dentro do pacote) dos 2 bytes de largura original das entradas a esconder. `head`: começo do pacote.
function maskOffsets(head, mask) {
  if (head.length < 16 || head.toString('latin1', 0, 4) !== 'NTXP') throw new Error('pacote do jogo sem cabeçalho NTXP');
  const ver = head.readUInt32LE(4), n = head.readUInt32LE(8);
  if (ver !== 1 && ver !== 2) throw new Error(`pacote do jogo com versão ${ver}`);
  if (n > MAX_ENTRIES) throw new Error(`pacote do jogo com ${n} texturas`);
  if (head.length < 16 + 40 * n) return { n, need: 16 + 40 * n };
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = 16 + 40 * i;
    if (mask.has(keyOf(head.readUInt32LE(o), head.readUInt32LE(o + 4)))) out.push(o + 8);
  }
  return { n, offs: out };
}

// Zera, em `buf` (trecho [a, …) do pacote), os bytes de largura das entradas escondidas.
function applyMask(buf, a, offs) {
  for (const o of offs) for (const k of [o, o + 1]) if (k >= a && k < a + buf.length) buf[k - a] = 0;
  return buf;
}

async function fetchSpan(ctx, url, a, b) {
  const res = await ctx.fetch(url, { headers: { range: `bytes=${a}-${b - 1}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`site respondeu ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (res.status === 200) buf = buf.subarray(a, b); // site sem Range: veio inteiro
  else {
    const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
    if (!m || Number(m[1]) !== ctx.size) throw new Error('o pacote do site mudou de tamanho');
  }
  if (buf.length !== b - a) throw new Error('trecho incompleto do site');
  return buf;
}

// Mod "a ligar": só vira arquivo entregue quando a lista do site tem o pacote (bind recebe a entrada da lista).
function maskedMod(p, mask) {
  const h = hashOf(mask);
  const bound = new Map(); // "tamanho.data" do site -> mod (o índice é lido uma vez por versão do pacote)
  return {
    p, mask,
    bind(f) {
      const id = `${f.s}.${f.m}`;
      if (bound.has(id)) return bound.get(id);
      let index = null;
      const mod = {
        p, s: f.s, m: (Number(f.m) || 0) + 1 + h, masked: true,
        check: () => true,
        async read(a, b, ctx) {
          const c = { ...ctx, size: f.s };
          const url = `${ctx.origin}/data/${p.split('/').map(encodeURIComponent).join('/')}`;
          if (!index) {
            index = (async () => {
              let r = maskOffsets(await fetchSpan(c, url, 0, Math.min(16, f.s)), mask);
              if (r.need) r = maskOffsets(await fetchSpan(c, url, 0, Math.min(r.need, f.s)), mask);
              if (!r.offs) throw new Error('índice do pacote incompleto');
              return r.offs;
            })();
            index.catch(() => { index = null; });
          }
          const offs = await index;
          return applyMask(await fetchSpan(c, url, a, b), a, offs);
        },
      };
      bound.set(id, mod);
      return mod;
    },
  };
}

module.exports = { PACKS, keyOf, hashOf, maskOffsets, applyMask, maskedMod };
