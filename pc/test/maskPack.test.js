'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mp = require('../src/main/maskPack');
const modFiles = require('../src/main/modFiles');

// Pacote NTXP v1 de mentira: n entradas (crc, adler), dados depois.
function pack(entries, ver = 1) {
  const n = entries.length;
  const b = Buffer.alloc(16 + 40 * n + (ver === 2 ? 8 * n : 0) + 64, 0xab);
  b.write('NTXP', 0, 'latin1'); b.writeUInt32LE(ver, 4); b.writeUInt32LE(n, 8); b.writeUInt32LE(0, 12);
  entries.forEach(([crc, adler], i) => { const o = 16 + 40 * i; b.writeUInt32LE(crc, o); b.writeUInt32LE(adler, o + 4); b.writeUInt16LE(256, o + 8); });
  return b;
}
// "Site" que responde Range como o de verdade.
function site(buf) {
  const calls = [];
  return {
    calls,
    fetch: async (u, i) => {
      const m = /bytes=(\d+)-(\d+)/.exec(i.headers.range);
      const a = Number(m[1]), b = Math.min(buf.length - 1, Number(m[2]));
      calls.push([a, b]);
      const body = buf.subarray(a, b + 1);
      return { status: 206, headers: new Map([['content-range', `bytes ${a}-${b}/${buf.length}`]]), arrayBuffer: async () => body };
    },
  };
}

test('cópia filtrada: esconde só as texturas do modpack, o resto igual ao site', async () => {
  const buf = pack([[1, 2], [3, 4], [0xffffffff, 5]]);
  const s = site(buf);
  const mod = mp.maskedMod('TEXPACKS/roads.pak', new Set([mp.keyOf(3, 4), mp.keyOf(0xffffffff, 5)]));
  const b = mod.bind({ p: 'TEXPACKS/roads.pak', s: buf.length, m: 1000 });
  assert.strictEqual(b.s, buf.length);
  assert.notStrictEqual(b.m, 1000);
  assert.strictEqual(mod.bind({ s: buf.length, m: 1000 }), b);
  const ctx = { origin: 'https://nfsu2.xyz', fetch: s.fetch };
  const all = await b.read(0, buf.length, ctx);
  const want = Buffer.from(buf);
  want.writeUInt16LE(0, 16 + 40 + 8); want.writeUInt16LE(0, 16 + 80 + 8);
  assert.deepStrictEqual(all, want);
  // Trecho que corta a largura no meio: só o byte de dentro muda.
  const part = await b.read(16 + 40 + 9, 16 + 40 + 12, ctx);
  assert.deepStrictEqual(part, want.subarray(16 + 40 + 9, 16 + 40 + 12));
});

test('cópia filtrada: pacote v2 e cabeçalho errado', async () => {
  const buf = pack([[7, 8]], 2);
  const b = mp.maskedMod('TEXPACKS/city.pak', new Set([mp.keyOf(7, 8)])).bind({ s: buf.length, m: 1 });
  const out = await b.read(0, 30, { origin: 'https://x', fetch: site(buf).fetch });
  assert.strictEqual(out.readUInt16LE(24), 0);
  const bad = Buffer.from(buf); bad.write('XXXX', 0, 'latin1');
  const c = mp.maskedMod('TEXPACKS/city.pak', new Set()).bind({ s: bad.length, m: 1 });
  await assert.rejects(c.read(0, 10, { origin: 'https://x', fetch: site(bad).fetch }));
});

test('lista do jogo: cópia filtrada só entra se o site tem o pacote, com data nova', () => {
  const mod = mp.maskedMod('TEXPACKS/roads.pak', new Set(['1:2']));
  const skies = mp.maskedMod('TEXPACKS/skies.pak', new Set(['1:2']));
  const out = modFiles.patchManifest({ files: [{ p: 'TEXPACKS', d: 1 }, { p: 'TEXPACKS/roads.pak', s: 500, m: 10 }] }, [mod, skies]);
  const roads = out.manifest.files.find((f) => f.p === 'TEXPACKS/roads.pak');
  assert.strictEqual(roads.s, 500);
  assert.ok(roads.m > 10);
  assert.ok(out.served.get('TEXPACKS/roads.pak').masked);
  assert.ok(!out.served.has('TEXPACKS/skies.pak'));
  assert.ok(!out.manifest.files.some((f) => f.p === 'TEXPACKS/skies.pak'));
});

test('pedido de blocos do jogo: pede ao site os mesmos blocos, com a versão do site', async () => {
  const buf = pack([[1, 2], [3, 4]]);
  const urls = [];
  const fetch = async (u) => {
    urls.push(u);
    const q = new URL(u).searchParams, b = Number(q.get('b')), n = Number(q.get('n'));
    const body = buf.subarray(b << 20, Math.min(buf.length, (b + n) << 20));
    return { status: 200, headers: new Map(), arrayBuffer: async () => body };
  };
  const mod = mp.maskedMod('TEXPACKS/roads.pak', new Set([mp.keyOf(3, 4)])).bind({ p: 'TEXPACKS/roads.pak', s: buf.length, m: 1000 });
  const url = `https://nfsu2.xyz/data-blocks/v9/TEXPACKS/roads.pak?b=0&n=1&m=${mod.m}&s=${buf.length}`;
  const out = await mod.read(0, buf.length, { origin: 'https://nfsu2.xyz', url, fetch });
  assert.strictEqual(out.readUInt16LE(16 + 40 + 8), 0);
  assert.strictEqual(out.readUInt16LE(16 + 8), 256);
  for (const u of urls) { assert.match(u, /\/data-blocks\/v9\//); assert.match(u, /m=1000/); }
});

test('pedido parado: desiste e tenta de novo', async () => {
  const buf = pack([[1, 2]]);
  let n = 0;
  const fetch = async (u, i) => {
    if (n++ === 0) throw new Error('tempo esgotado');
    return site(buf).fetch(u, i);
  };
  const mod = mp.maskedMod('TEXPACKS/roads.pak', new Set()).bind({ p: 'TEXPACKS/roads.pak', s: buf.length, m: 1 });
  const out = await mod.read(0, 20, { origin: 'https://x', fetch });
  assert.strictEqual(out.length, 20);
});
