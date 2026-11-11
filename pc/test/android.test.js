'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const motor = (...p) => fs.readFileSync(path.join(__dirname, '../../mobile', ...p), 'utf8');
const main = motor('app/java/xyz/nfs/launcher/MainActivity.java');

const java = (name) => motor(`app/java/xyz/nfs/launcher/${name}.java`);

test('celular: versão nova e texturas só do mesmo repositório do PC, na pasta mobile/', () => {
  const gh = require('../src/main/github');
  const dl = java('Downloads');
  assert.equal(dl.match(/REPO = "(.+?)"/)[1], gh.REPO);
  assert.match(dl, /RAW = "https:\/\/raw\.githubusercontent\.com\/" \+ REPO \+ "\/main\/mobile\/"/);
  assert.match(java('AppUpdate'), /Downloads\.RAW \+ "atualizacao\.json"/);
  assert.match(java('Textures'), /Downloads\.RAW \+ "texturas\.json"/);
  assert.doesNotMatch(main + java('AppUpdate'), /drive\.google|FOLDER_ID/, 'o Drive saiu do aviso de versão nova');
  for (const f of ['atualizacao.json', 'texturas.json']) {
    const p = path.join(__dirname, '../../mobile', f);
    if (fs.existsSync(p)) JSON.parse(fs.readFileSync(p, 'utf8'));
  }
});

test('celular: mesmas partes de textura do PC', () => {
  const { PARTS } = require('../src/main/texPack');
  const src = java('Textures');
  const got = [...src.matchAll(/new Part\("(\w+)", "[^"]*", "[^"]*", "((?:[^"\\]|\\.)*)"\)/g)].map((m) => [m[1], m[2].replace(/\\\\/g, '\\')]);
  assert.deepEqual(got, PARTS.map((p) => [p.id, p.re.source]));
});

test('celular: texturas fora do APK, baixadas pelo app em 1x e 2x, só TexWizard e NextGen', () => {
  const setup = motor('app/setup.py');
  assert.doesNotMatch(setup, /\/mnt\/c\/e\/texturas|texturas_assets/);
  const src = java('Textures');
  assert.match(src, /MODS = \{"texwizard", "nextgen"\}/);
  assert.match(src, /SCALES = \{"1x", "2x"\}/);
  assert.doesNotMatch(motor('patches/0007-texturas-hd-do-nfsu2.patch'), /OpenApkAsset/);
});

test('celular: sem dicas, guias nem bolha (o jogo foi corrigido, 11/11)', () => {
  assert.doesNotMatch(main, /BubbleService|GuideView|canDrawOverlays|openGuide/);
  assert.doesNotMatch(motor('make-patches.py'), /SYSTEM_ALERT_WINDOW|BubbleService|nfsBubble/);
});

test('celular: tipos de erro iguais aos do PC, sem código técnico na tela', () => {
  const { errorKind } = require('../src/main/connError');
  const expected = (code) => errorKind(code);
  // A mesma lista de códigos de "sem internet" nos dois apps.
  for (const code of [-21, -105, -106, -109, -137]) {
    assert.equal(expected(code), 'offline');
    assert.match(main, new RegExp(`code == ${code}\\b`));
  }
  const home = motor('app/assets/home.js');
  assert.doesNotMatch(home, /ERR_|errorCode/);
});

test('celular: arquivos que a tela usa entram no APK', () => {
  const setup = motor('app/setup.py');
  for (const name of ['sounds.js', 'icon.png']) assert.ok(setup.includes(`'${name}'`), name);
  assert.ok(setup.includes("renderer / 'bg'"), 'fundos');
  const html = motor('app/assets/home.html');
  assert.ok(html.includes('src="sounds.js"'));
  assert.match(html, /img-src 'self' data:/, 'imagens próprias do jogador');
});

test('celular: patches com recarga sem cache, tela de carregar, erro e WebGPU nos chips bloqueados', () => {
  const p6 = motor('patches/0006-um-jogo-por-vez-e-nada-em-segundo-plano.patch');
  for (const s of ['reloadIgnoringCache', 'nfsShowLoading', 'nfsFail']) assert.ok(p6.includes(s), s);
  const p5 = motor('patches/0005-app-unico-e-leve.patch');
  assert.ok(p5.includes('--disable-dawn-features=adapter_blocklist'));
  assert.ok(p5.includes('getBoolean("prepareGame", true)'), 'Preparar o jogo ao carregar ligada por padrão (pedido do Bruno, 08/11)');
  assert.match(p5, /nfs-texturas/);
  assert.ok(!p5.includes('SkiaGraphite') && !p5.includes('skip_validation'), 'desempenho do celular só muda se o Bruno pedir');
  assert.ok(!p5.includes('enable-unsafe-webgpu'), 'só a lista de chips, nunca a opção insegura inteira');
});

test('celular: sem doação, tela inicial e sons sempre ligados, igual ao PC', () => {
  const all = motor('app/assets/home.js') + motor('app/assets/home.html') + motor('app/assets/home.css') + main;
  assert.doesNotMatch(all, /donate|doação|\bPIX\b|PAYPAL/i);
  assert.doesNotMatch(all, /s-showHome|s-sounds/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../scripts/export-catalog.js'), 'utf8'), /DONATE/);
});

test('celular: DNS seguro na mesma ordem do PC, só em falha de conexão', () => {
  const { SECURE_DNS } = require('../src/main/config');
  const { offersSecureDns } = require('../src/main/connError');
  const script = motor('make-patches.py');
  assert.equal(main.match(/DNS_FIRST = "(.+?)"/)[1], Object.keys(SECURE_DNS)[0]);
  assert.equal(main.match(/DNS_SECOND = "(.+?)"/)[1], Object.keys(SECURE_DNS)[1]);
  for (const id of Object.keys(SECURE_DNS)) assert.ok(script.includes(SECURE_DNS[id].join(' ')), id);
  for (const kind of ['offline', 'other', 'server', 'crash']) assert.equal(new RegExp(`"${kind}"\\.equals\\(kind\\)`).test(main), offersSecureDns(kind), kind);
});

test('celular: nada de mapa, endereço de site ou Game Turbo na tela inicial', () => {
  const home = motor('app/assets/home.js') + motor('app/assets/home.html');
  assert.doesNotMatch(home, /nfsu2\.xyz|nfsmwo\.com|Game Turbo|Dicas e mapa/);
});
