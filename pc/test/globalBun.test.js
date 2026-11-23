'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const globalBun = require('../src/main/globalBun');

const S = 2 << 20;
const manifest = { files: [{ p: 'global/globalb.bun', s: S, m: 7 }, { p: 'X', s: 5, m: 1 }] };
function fakeFetch(calls) {
  return async (url) => {
    calls.push(url);
    if (url.endsWith('/data-manifest')) return { status: 200, json: async () => manifest };
    return { status: 200, arrayBuffer: async () => new Uint8Array(S).buffer };
  };
}

test('entryOf acha o GLOBALB.BUN e recusa tamanho estranho', () => {
  assert.deepStrictEqual(globalBun.entryOf(manifest), { s: S, m: 7 });
  assert.strictEqual(globalBun.entryOf({ files: [{ p: 'GLOBAL/GLOBALB.BUN', s: 10, m: 1 }] }), null);
  assert.strictEqual(globalBun.entryOf(null), null);
});

test('load baixa uma vez e depois usa a cópia', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbun-'));
  try {
    const calls = [];
    const a = await globalBun.load({ id: 'nfsu2', origin: 'https://x', dir, fetchFn: fakeFetch(calls) });
    assert.strictEqual(a.length, S);
    const b = await globalBun.load({ id: 'nfsu2', origin: 'https://x', dir, fetchFn: fakeFetch(calls) });
    assert.strictEqual(b.length, S);
    assert.strictEqual(calls.filter((u) => u.includes('/data/')).length, 1);
    assert.ok(fs.existsSync(path.join(dir, `nfsu2-${S}-7.bun`)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('load sem rede devolve null', async () => {
  const r = await globalBun.load({ id: 'nfsu2', origin: 'https://x', dir: os.tmpdir(), fetchFn: async () => { throw new Error('off'); } });
  assert.strictEqual(r, null);
});
