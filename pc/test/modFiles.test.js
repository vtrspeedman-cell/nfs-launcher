'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mf = require('../src/main/modFiles');

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-')); made.push(d); return d; };
// Pastas temporárias dos testes saem no fim (antes ficavam no %TEMP% a cada execução).
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function put(root, rel, data) {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
}
const SITE = {
  v: 1,
  files: [
    { p: 'CARS', d: 1 }, { p: 'CARS/240SX', d: 1 }, { p: 'CARS/240SX/TEXTURES.BIN', s: 100, m: 5 },
    { p: 'TEXPACKS', d: 1 }, { p: 'TEXPACKS/uhud.pak', s: 9, m: 7 },
  ],
  blocks: { url: '/data-blocks/v2/', size: 1048576, max: 8 },
};

test('scan: árvore do jogo, sem pastas vazias, nomes estranhos ou arquivo vazio', () => {
  const d = tmp();
  put(d, 'TEXPACKS/meu.pak', 'abc');
  put(d, 'CARS/240SX/textures.bin', 'xyz1');
  put(d, 'vazio.txt', '');
  put(d, 'ru:im.txt', 'x');
  fs.mkdirSync(path.join(d, 'PASTA'));
  const got = mf.scan(d).map((x) => [x.p, x.s]).sort();
  assert.deepStrictEqual(got, [['CARS/240SX/textures.bin', 4], ['TEXPACKS/meu.pak', 3]]);
  assert.deepStrictEqual(mf.scan(path.join(d, 'nao-existe')), []);
});

test('scanAll: a pasta do jogador vale por cima da do instalador, sem diferenciar maiúsculas', () => {
  const inst = tmp(), user = tmp();
  put(inst, 'TEXPACKS/detailed.pak', 'instalador');
  put(inst, 'TRACKS/LOC4DYNTEX.BIN', 'ceu');
  put(user, 'texpacks/DETAILED.pak', 'meu');
  const got = mf.scanAll([inst, user, path.join(user, 'nao-existe')]).map((x) => [x.p, x.s]).sort();
  assert.deepStrictEqual(got, [['TRACKS/LOC4DYNTEX.BIN', 3], ['texpacks/DETAILED.pak', 3]]);
  assert.strictEqual(mf.scanAll([inst, user]).find((x) => /detailed/i.test(x.p)).file, path.join(user, 'texpacks', 'DETAILED.pak'));
});

test('patchManifest: troca arquivo do site (mantém o nome dele) e acrescenta novo com as pastas', () => {
  const mods = [
    { p: 'CARS/240SX/textures.bin', file: 'a', s: 4, m: 50 },
    { p: 'TEXPACKS/meu.pak', file: 'b', s: 3, m: 60 },
    { p: 'MODS/X/novo.bin', file: 'c', s: 2, m: 70 },
  ];
  const { manifest, served } = mf.patchManifest(SITE, mods);
  const by = Object.fromEntries(manifest.files.map((f) => [f.p, f]));
  assert.deepStrictEqual(by['CARS/240SX/TEXTURES.BIN'], { p: 'CARS/240SX/TEXTURES.BIN', s: 4, m: 50 });
  assert.deepStrictEqual(by['TEXPACKS/meu.pak'], { p: 'TEXPACKS/meu.pak', s: 3, m: 60 });
  assert.ok(by.MODS.d && by['MODS/X'].d && by['MODS/X/novo.bin'].s === 2);
  assert.deepStrictEqual([...served.keys()].sort(), ['CARS/240SX/TEXTURES.BIN', 'MODS/X/novo.bin', 'TEXPACKS/meu.pak']);
  assert.strictEqual(by['TEXPACKS/uhud.pak'].s, 9, 'o resto da lista fica igual');
  assert.strictEqual(SITE.files[2].s, 100, 'a lista original não é alterada');
  assert.deepStrictEqual(manifest.blocks, SITE.blocks);
});

test('patchManifest: não troca pasta por arquivo nem arquivo por pasta', () => {
  const { served } = mf.patchManifest(SITE, [
    { p: 'CARS/240SX', file: 'a', s: 1, m: 1 },
    { p: 'TEXPACKS/uhud.pak/x.bin', file: 'b', s: 1, m: 1 },
  ]);
  assert.strictEqual(served.size, 0);
  assert.throws(() => mf.patchManifest({}, []));
});

test('encodePath: igual ao jogo (cada parte do caminho codificada)', () => {
  assert.strictEqual(mf.encodePath('TEXPACKS/meu pack.pak'), 'TEXPACKS/meu%20pack.pak');
});

test('install: sem mods não liga nada; com mods, liga e desliga o https só quando pedido', () => {
  assert.strictEqual(mf.install({}, { mods: [], allowed: () => true }), null);
  const calls = [];
  const ses = { protocol: { handle: (s) => calls.push('on ' + s), unhandle: (s) => calls.push('off ' + s) } };
  const m = mf.install(ses, { mods: [{ p: 'TEXPACKS/a.pak', file: 'x', s: 1, m: 1 }], allowed: () => true });
  m.active(false); m.active(true); m.active(true); m.active(false);
  assert.deepStrictEqual(calls, ['on https', 'off https']);
});

test('route: só o que é do mod; resto segue para o site', () => {
  const served = new Map([['TEXPACKS/meu pack.pak', { s: 3, m: 60 }]]);
  assert.deepStrictEqual(mf.route('https://nfsu2.xyz/data-manifest', served), { kind: 'manifest' });
  assert.deepStrictEqual(mf.route('https://nfsu2.xyz/data-blocks/v2/TEXPACKS/meu%20pack.pak?b=0&n=1&m=60&s=3', served),
    { kind: 'blocks', p: 'TEXPACKS/meu pack.pak', b: 0, n: 1, m: 60, s: 3 });
  assert.deepStrictEqual(mf.route('https://nfsu2.xyz/data/TEXPACKS/meu%20pack.pak', served), { kind: 'file', p: 'TEXPACKS/meu pack.pak' });
  assert.strictEqual(mf.route('https://nfsu2.xyz/data/TEXPACKS/uhud.pak', served), null);
  assert.strictEqual(mf.route('https://nfsu2.xyz/data-blocks/v2/TEXPACKS/meu%20pack.pak?b=-1&n=1', served).kind, 'bad');
  assert.strictEqual(mf.route('https://nfsu2.xyz/data/%E0%A4%A', served), null);
  assert.strictEqual(mf.route('nada', served), null);
});

test('blockSpan e rangeSpan', () => {
  const mod = { s: mf.BLOCK * 2 + 10, m: 9 };
  assert.deepStrictEqual(mf.blockSpan({ b: 1, n: 8, m: 9, s: mod.s }, mod), { start: mf.BLOCK, end: mod.s });
  assert.deepStrictEqual(mf.blockSpan({ b: 0, n: 1, m: 9, s: mod.s }, mod), { start: 0, end: mf.BLOCK });
  assert.strictEqual(mf.blockSpan({ b: 0, n: 1, m: 8, s: mod.s }, mod), null, 'lista antiga');
  assert.strictEqual(mf.blockSpan({ b: 3, n: 1, m: 9, s: mod.s }, mod), null, 'depois do fim');
  assert.strictEqual(mf.rangeSpan(null, 10), null);
  assert.deepStrictEqual(mf.rangeSpan('bytes=2-4', 10), { start: 2, end: 5 });
  assert.deepStrictEqual(mf.rangeSpan('bytes=2-', 10), { start: 2, end: 10 });
  assert.deepStrictEqual(mf.rangeSpan('bytes=8-99', 10), { start: 8, end: 10 });
  assert.strictEqual(mf.rangeSpan('bytes=10-', 10), false);
  assert.strictEqual(mf.rangeSpan('bytes=-5', 10), false);
});

test('readSpan lê o trecho exato', async () => {
  const d = tmp();
  const f = put(d, 'a.bin', Buffer.from('0123456789'));
  assert.strictEqual((await mf.readSpan(f, 2, 5)).toString(), '234');
  assert.strictEqual(await mf.readSpan(f, 8, 12), null, 'arquivo menor que o esperado');
});

test('Passagem ao site: pedido da página volta com Origin (nuvem do jogo); navegação e outros sites ficam iguais', () => {
  const allowed = (u) => u.startsWith('https://nfsu2.xyz/');
  const req = (url, mode, headers = {}) => ({ url, mode, headers: new Headers(headers) });
  const a = mf.passInit(req('https://nfsu2.xyz/vault', 'cors'), allowed);
  assert.strictEqual(a.bypassCustomProtocolHandlers, true);
  assert.strictEqual(a.headers.get('origin'), 'https://nfsu2.xyz');
  assert.strictEqual(mf.passInit(req('https://nfsu2.xyz/', 'navigate'), allowed).headers, undefined);
  assert.strictEqual(mf.passInit(req('https://outro.site/x', 'cors'), allowed).headers, undefined);
  assert.strictEqual(mf.passInit(req('https://nfsu2.xyz/vault', 'cors', { origin: 'https://nfsu2.xyz' }), allowed).headers, undefined);
});
