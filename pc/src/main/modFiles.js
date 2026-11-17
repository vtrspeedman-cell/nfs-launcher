'use strict';
// Mods de textura do NFSU2 (pedido do Bruno, 06/11): visuais e só no PC de quem instalou.
// O jogo lê os arquivos pela lista do site (/data-manifest) e os baixa em blocos de 1 MiB
// (/data-blocks/<v>/<caminho>?b=&n=&m=&s=, ou /data/<caminho> com Range). Ele aceita qualquer arquivo da lista.
// O app acrescenta à lista os arquivos da pasta de mods (ou troca o tamanho e a data de um que já existe)
// e entrega só esses. O resto vem do site como sempre: nada de script na página e nenhum arquivo do jogo alterado.
// O jogo guarda o que baixa numa cópia própria com nome caminho.tamanho.data: trocar o arquivo do mod gera outro nome,
// e o jogo não apaga a antiga: quem limpa é o cacheClean.js, antes de abrir o jogo.
const fs = require('fs');
const path = require('path');

const BLOCK = 1 << 20;
const MAX_FILES = 500;
// Só a raiz da árvore do jogo: um nome de pasta ou arquivo comum, sem "..", sem barra invertida, sem ":".
const SEGMENT = /^[A-Za-z0-9 _.()+-]{1,96}$/;
const okSegment = (s) => SEGMENT.test(s) && s !== '.' && s !== '..';

// Arquivos da pasta de mods, com o caminho como o jogo usa ("TEXPACKS/meu.pak").
function scan(root) {
  const out = [];
  const walk = (dir, rel) => {
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      if (out.length >= MAX_FILES || !okSegment(d.name)) continue;
      const full = path.join(dir, d.name);
      const p = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { if (p.split('/').length < 8) walk(full, p); continue; }
      if (!d.isFile()) continue; // atalhos e ligações ficam de fora
      try {
        const st = fs.statSync(full);
        if (st.size > 0 && st.size < 0xFFFFFFFF) out.push({ p, file: full, s: st.size, m: Math.floor(st.mtimeMs / 1000) });
      } catch { /* sumiu no meio: ignora */ }
    }
  };
  walk(root, '');
  return out;
}

// Várias pastas de mods (a que vem no instalador e a do jogador): mesmo caminho em duas, vale a da pasta que vem
// depois na lista (sem diferenciar maiúsculas).
function scanAll(roots) {
  const by = new Map();
  for (const root of roots) for (const m of scan(root)) by.set(m.p.toLowerCase(), m);
  return [...by.values()].slice(0, MAX_FILES);
}

// Lista do site com os mods: arquivo que já existe (sem diferenciar maiúsculas) troca de tamanho e data e mantém o
// nome do site; arquivo novo entra com as pastas que faltarem. Devolve a lista e o caminho final de cada mod.
function patchManifest(manifest, mods) {
  if (!manifest || !Array.isArray(manifest.files)) throw new Error('lista de arquivos do jogo sem "files"');
  const files = manifest.files.map((f) => ({ ...f }));
  const byLower = new Map(files.map((f, i) => [String(f.p).toLowerCase(), i]));
  const served = new Map();
  for (const mod of mods) {
    const key = mod.p.toLowerCase();
    if (mod.bind) {
      // Cópia filtrada de um pacote do site (maskPack.js): só existe se o site tem o pacote.
      const f = byLower.has(key) && files[byLower.get(key)];
      if (!f || f.d || !Number.isInteger(f.s) || f.s <= 0) continue;
      const b = mod.bind(f);
      f.m = b.m;
      served.set(f.p, b);
      continue;
    }
    if (byLower.has(key)) {
      const f = files[byLower.get(key)];
      if (f.d) continue; // pasta do site com o mesmo nome de um arquivo do mod
      f.s = mod.s; f.m = mod.m;
      served.set(f.p, mod);
      continue;
    }
    const parts = mod.p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!byLower.has(dir.toLowerCase())) { byLower.set(dir.toLowerCase(), files.length); files.push({ p: dir, d: 1 }); }
      else if (!files[byLower.get(dir.toLowerCase())].d) { parts.length = 0; break; } // arquivo do site no lugar da pasta
    }
    if (!parts.length) continue;
    byLower.set(key, files.length);
    files.push({ p: mod.p, s: mod.s, m: mod.m });
    served.set(mod.p, mod);
  }
  return { manifest: { ...manifest, files }, served };
}

// Mesmo formato do jogo (datacache.ts): cada parte do caminho com encodeURIComponent.
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

// Pedido do jogo -> o que entregar. null = não é nosso (segue para o site).
function route(url, served) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.pathname === '/data-manifest') return { kind: 'manifest' };
  let rest = null, kind = null;
  const blocks = /^\/data-blocks\/[^/]+\/(.+)$/.exec(u.pathname);
  if (blocks) { rest = blocks[1]; kind = 'blocks'; } else if (u.pathname.startsWith('/data/')) { rest = u.pathname.slice(6); kind = 'file'; }
  if (!rest) return null;
  let p;
  try { p = rest.split('/').map(decodeURIComponent).join('/'); } catch { return null; }
  const mod = served.get(p);
  if (!mod) return null;
  if (kind === 'file') return { kind, p };
  const b = Number(u.searchParams.get('b')), n = Number(u.searchParams.get('n'));
  if (!Number.isInteger(b) || !Number.isInteger(n) || b < 0 || n < 1 || n > 64) return { kind: 'bad', p };
  return { kind, p, b, n, m: Number(u.searchParams.get('m')), s: Number(u.searchParams.get('s')) };
}

// Trecho [início, fim) do arquivo para um pedido de blocos; null se o pedido não bate com o arquivo de agora.
function blockSpan(r, mod) {
  if (r.m !== mod.m || r.s !== mod.s) return null; // lista antiga: o jogo pede de novo com a nova
  const start = r.b * BLOCK;
  if (start >= mod.s) return null;
  return { start, end: Math.min(mod.s, (r.b + r.n) * BLOCK) };
}

// Cabeçalho Range "bytes=a-b" (ou "bytes=a-"). null = sem Range (arquivo inteiro); false = inválido.
function rangeSpan(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(String(header).trim());
  if (!m) return false;
  const start = Number(m[1]);
  const end = m[2] === '' ? size : Math.min(size, Number(m[2]) + 1);
  if (start >= size || end <= start) return false;
  return { start, end };
}

function readSpan(file, start, end) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(end - start);
    let got = 0;
    while (got < b.length) {
      const n = fs.readSync(fd, b, got, b.length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    return got === b.length ? b : null;
  } finally { fs.closeSync(fd); }
}

// Opções do fetch que leva ao site um pedido que não é de mod. Pelo fetch do app, o pedido sai sem "Origin" e o
// Chromium o marca como vindo de fora (Sec-Fetch-Site "none"): o site recusa as chamadas da nuvem (/vault: 403, e a
// parte "Jogos salvos na nuvem" some). Para pedidos da própria página ao próprio site, o Origin volta, e o Chromium
// marca "same-origin", como sem o app no meio (testado: GET e PUT em /vault iguais com e sem mods).
function passInit(req, allowed) {
  const init = { bypassCustomProtocolHandlers: true };
  if (req.mode !== 'navigate' && allowed(req.url) && !req.headers.has('origin')) {
    init.headers = new Headers(req.headers);
    init.headers.set('origin', new URL(req.url).origin);
  }
  return init;
}

// Liga os mods na sessão do jogo, respondendo os endereços https do site (protocol.handle). Não dá para só desviar a
// lista para um esquema próprio: o service worker do site busca a lista, e nele um esquema próprio não existe
// (ERR_UNKNOWN_URL_SCHEME; ele então usa a cópia antiga, ou o jogo nem abre). Por isso, com mods e o NFSU2 aberto
// (`active(true)`), cada pedido https da sessão passa por aqui: a lista e os arquivos dos mods são respondidos
// pelo app; o resto segue para o site sem mudança (`fetch` da própria sessão, sem passar por aqui de novo).
// `allowed(url)`: o endereço é do site do NFSU2. `log(texto)`: registro curto para o jogador (e para nós) ver o que houve.
// `mods`: arquivos do disco ({ p, file, s, m }) ou virtuais ({ p, s, m, read(a, b), check() }, texPack.js).
const sizeOf = (m) => (m.bind ? 'do site, sem as texturas do modpack' : `${m.s} bytes`);
const direct = (mods) => new Map(mods.filter((m) => !m.bind).map((m) => [m.p, m]));

function install(ses, { mods, allowed, log = () => {} }) {
  if (!mods.length) return null;
  log(`mods encontrados: ${mods.map((m) => `"${m.p}" (${sizeOf(m)})`).join(', ')}`);
  const HEAD = { 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin' };
  const fail = (status, why) => { log(`recusado (${status}): ${why}`); return new Response(null, { status, headers: HEAD }); };
  const sent = new Set();
  const pass = (req) => ses.fetch(req, passInit(req, allowed));
  let served = direct(mods);
  let on = false;
  const handler = async (req) => {
    const r = allowed(req.url) && route(req.url, served);
    if (!r) return pass(req);
    try {
      if (r.kind === 'manifest') {
        const res = await pass(req);
        if (!res.ok) { log(`lista do site com erro ${res.status}: segue sem mods`); return res; }
        const out = patchManifest(await res.json(), mods);
        served = out.served;
        log(`lista entregue ao jogo com ${served.size} de ${mods.length} mods: ${[...served.keys()].join(', ')}`);
        // Mesmos cabeçalhos do site (COEP, CORP...), sem os de compressão: o corpo vai sem compressão.
        const headers = new Headers(res.headers);
        for (const h of ['content-encoding', 'content-length', 'etag']) headers.delete(h);
        return new Response(JSON.stringify(out.manifest), { status: 200, headers });
      }
      const mod = served.get(r.p);
      if (!mod || r.kind === 'bad') return fail(400, `pedido inválido ${req.url}`);
      // O arquivo mudou com o app aberto: não entrega pedaço misturado (vale ao reabrir). Pacote virtual (texPack.js):
      // confere os pacotes de origem.
      if (mod.check ? !mod.check() : (() => { const st = fs.statSync(mod.file); return st.size !== mod.s || Math.floor(st.mtimeMs / 1000) !== mod.m; })()) {
        return fail(409, `"${r.p}" mudou com o app aberto (vale ao reabrir)`);
      }
      let span, status = 200;
      const headers = { ...HEAD, 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes' };
      if (r.kind === 'blocks') {
        span = blockSpan(r, mod);
        if (!span) return fail(409, `"${r.p}": pedido de uma lista antiga`);
      } else {
        span = rangeSpan(req.headers.get('range'), mod.s);
        if (span === false) return fail(416, `"${r.p}": trecho inválido`);
        if (span) { status = 206; headers['content-range'] = `bytes ${span.start}-${span.end - 1}/${mod.s}`; } else span = { start: 0, end: mod.s };
      }
      const ctx = { origin: new URL(req.url).origin, url: r.kind === 'blocks' ? req.url : null, fetch: (u, i) => ses.fetch(u, { ...i, bypassCustomProtocolHandlers: true }) };
      const body = mod.read ? await mod.read(span.start, span.end, ctx) : readSpan(mod.file, span.start, span.end);
      if (body && !sent.has(r.p)) { sent.add(r.p); log(`o jogo começou a ler "${r.p}"`); }
      return body ? new Response(body, { status, headers }) : fail(409, `"${r.p}": não deu para ler o arquivo`);
    } catch (e) { return fail(500, String((e && e.message) || e)); }
  };
  return {
    served: () => served,
    // Troca a lista de mods (escolha de partes das texturas): vale na próxima vez que o jogo pedir a lista.
    setMods(next) {
      mods = next;
      served = direct(mods);
      log(`mods trocados: ${mods.map((m) => `"${m.p}" (${sizeOf(m)})`).join(', ')}`);
    },
    // Liga só com o NFSU2 aberto: nos outros jogos (mesma sessão) nada passa pelo app.
    active(want) {
      if (want === on) return;
      if (want) ses.protocol.handle('https', handler); else ses.protocol.unhandle('https');
      on = want;
      log(want ? 'NFSU2 aberto: mods ligados' : 'outro jogo: mods desligados');
    },
  };
}

module.exports = { BLOCK, scan, scanAll, patchManifest, route, blockSpan, rangeSpan, readSpan, encodePath, passInit, install };
