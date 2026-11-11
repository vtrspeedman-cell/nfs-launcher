'use strict';
require('node:test')('idioma do app: pt por padrão, só pt/en aceitos', () => {
  const assert = require('node:assert/strict');
  const s = require('../src/main/settings');
  assert.equal(s.sanitize({}).lang, 'pt');
  assert.equal(s.sanitize({ lang: 'en' }).lang, 'en');
  assert.equal(s.sanitize({ lang: 'pt-BR' }).lang, 'pt');
  assert.equal(s.applyChange(s.DEFAULTS, 'lang', 'en').cfg.lang, 'en');
  assert.equal(s.applyChange(s.DEFAULTS, 'lang', 'xx').ok, false);
  // Jogo lembrado: NFSU2 na primeira vez; guarda o último iniciado; id desconhecido volta ao padrão.
  assert.equal(s.sanitize({}).game, 'nfsu2');
  assert.equal(s.sanitize({ game: 'nfsmw' }).game, 'nfsmw');
  assert.equal(s.sanitize({ game: 'xx' }).game, 'nfsu2');
  const fs = require('fs');
  const { GAMES } = require('../src/main/config');
  for (const g of Object.values(GAMES)) {
    assert.ok(fs.existsSync(require('path').join(__dirname, '..', 'src', 'renderer', g.disc)), `CD ausente: ${g.disc}`);
  }
  assert.equal(s.sanitize({ game: 'nfsc' }).game, 'nfsc');
  for (const g of Object.values(GAMES)) {
    assert.ok(fs.existsSync(require('path').join(__dirname, '..', 'src', 'renderer', 'bg', `${g.id}.jpg`)), `fundo ausente: ${g.id}`);
  }
  // Todo texto em inglês do ui.html tem tradução, e toda tradução é usada.
  const html = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'renderer', 'ui.html'), 'utf8');
  const keys = new Set([...html.matchAll(/data-t[ta]?="([^"]+)"/g)].map((m) => m[1]));
  const { EN } = require('../src/renderer/i18n');
  for (const k of keys) assert.ok(k in EN, `sem inglês: ${k}`);
  for (const k of Object.keys(EN)) assert.ok(keys.has(k), `tradução sem uso: ${k}`);
});
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const s = require('../src/main/settings');

test('padrões: modo janela, tela inicial, proteção e prioridade ativas', () => {
  const d = s.sanitize({});
  assert.equal(d.startFullscreen, false);
  assert.equal(d.showHome, true);
  assert.equal(d.protectFullscreen, true);
  assert.equal(d.blockAltSpace, true);
  assert.equal(d.highPriority, true);
  for (const k of ['prepareGame', 'lighterGpu', 'newDrawing', 'antiAlias']) assert.equal(d[k], true, k);
  assert.equal(d.imageFilter, true, 'qualidade também ligada por padrão (pedido do Bruno, 08/11)');
  assert.equal(d.showCorner, true);
  assert.equal('lowLatency' in d, false, 'o app não mexe no VSync');
});
test('quem tinha a baixa latência ligada volta ao normal e a opção não existe mais', () => {
  assert.equal('lowLatency' in s.sanitize({ lowLatency: true }), false);
  assert.equal(s.applyChange(s.sanitize({}), 'lowLatency', true).ok, false);
});
test('Graphite e Delegated: uma opção só, ligada por padrão, também para quem já tinha o app; desmarcar fica guardado', () => {
  const d = s.sanitize({});
  assert.equal(d.newDrawing, true);
  assert.equal('windowsCompose' in d, false);
  const old = s.sanitize({ version: 5, newDrawing: false, windowsCompose: false });
  assert.equal(old.newDrawing, true);
  assert.equal('windowsCompose' in old, false);
  assert.equal(s.applyChange(d, 'windowsCompose', false).ok, false);
  const off = s.sanitize(s.applyChange(d, 'newDrawing', false).cfg);
  assert.equal(off.newDrawing, false);
});
test('modo DirectX 11: entrar nele desliga só o que pesa, mantém o que alivia e pede os gráficos mínimos; religar fica', () => {
  const tudo = { hdTextures: true, prepareGame: true, lighterGpu: true, antiAlias: true, imageFilter: true, highPriority: true };
  const on = s.applyChange(s.sanitize({ ...tudo, version: 7 }), 'unblockGpu', true).cfg;
  assert.equal(on.unblockGpu, true);
  for (const k of s.DX11_OFF) assert.equal(on[k], false, k);
  for (const k of s.DX11_KEEP) assert.equal(on[k], true, `alivia o processador, fica ligada: ${k}`);
  assert.deepEqual([...s.DX11_OFF].sort(), ['antiAlias', 'hdTextures', 'imageFilter', 'newDrawing']);
  assert.equal(on.dx11GameMin, true, 'gráficos do jogo no mínimo ao abrir');
  assert.equal(s.sanitize(on).dx11GameMin, true, 'o pedido fica guardado até ser feito');
  const v7 = s.sanitize({ version: 7, prepareGame: false, antiAlias: false, highPriority: false });
  for (const k of ['highPriority', 'prepareGame', 'lighterGpu', 'newDrawing', 'antiAlias']) assert.equal(v7[k], true, `quem tinha o app passa a ligado: ${k}`);
  const v7dx = s.sanitize({ version: 7, unblockGpu: true, prepareGame: true });
  for (const k of s.DX11_OFF) assert.equal(v7dx[k], false, `DX11 continua desligado: ${k}`);
  const desmarcou = s.sanitize(s.applyChange(v7, 'antiAlias', false).cfg);
  assert.equal(desmarcou.antiAlias, false, 'desmarcar depois fica');
  const antigo = s.sanitize({ ...tudo, version: 6, unblockGpu: true });
  for (const k of s.DX11_OFF) assert.equal(antigo[k], false, `migração: ${k}`);
  assert.equal(antigo.version, 9);
  assert.equal(antigo.dx11GameMin, true, 'quem já estava no DX11 também recebe os gráficos mínimos uma vez');
  const v8dx = s.sanitize({ version: 8, unblockGpu: true, highPriority: false, prepareGame: false, lighterGpu: false });
  for (const k of s.DX11_KEEP) assert.equal(v8dx[k], true, `versão 9 religa no DX11: ${k}`);
  assert.equal(s.sanitize({ version: 8, imageFilter: false }).imageFilter, true, 'filtro ligado uma vez para quem tinha o app');
  assert.equal(s.sanitize({ version: 9, imageFilter: false }).imageFilter, false, 'depois, desmarcar fica');
  const fora = s.sanitize({ ...tudo, version: 6, unblockGpu: false });
  assert.equal(fora.hdTextures, true, 'quem não está no DX11 não muda');
  const religou = s.sanitize(s.applyChange({ ...antigo }, 'hdTextures', true).cfg);
  assert.equal(religou.hdTextures, true, 'depois da migração, o que ele religar fica');
  const deNovo = s.applyChange(religou, 'unblockGpu', true).cfg;
  assert.equal(deNovo.hdTextures, true, 'marcar de novo o que já está marcado não desliga nada');
});
test('DNS seguro: oferecido só em falha de conexão', () => {
  const { errorKind, offersSecureDns } = require('../src/main/connError');
  assert.equal(offersSecureDns(errorKind(-105)), true, 'nome não resolvido');
  assert.equal(offersSecureDns(errorKind(-118)), true, 'tempo esgotado');
  assert.equal(offersSecureDns(errorKind(503)), false, 'site fora do ar');
  assert.equal(offersSecureDns(errorKind(-1)), false, 'jogo caído');
  const d = s.sanitize({});
  assert.equal(d.secureDns, 'off', 'desligado por padrão');
  assert.equal(s.sanitize({ secureDns: 'google' }).secureDns, 'google', 'fica guardado entre aberturas');
  assert.equal(s.sanitize({ secureDns: 'constructor' }).secureDns, 'off');
  assert.equal(s.applyChange(d, 'secureDns', 'google').ok, false, 'fora das configurações');
  assert.deepEqual(Object.keys(require('../src/main/config').SECURE_DNS), ['cloudflare', 'google'], 'ordem de tentativa');
});
test('sanitize descarta lixo e combinações inválidas', () => {
  const c = s.sanitize({ startFullscreen: 'sim', exitCombo: 'Alt+F4', bounds: { x: 1 } });
  assert.equal(c.startFullscreen, false);
  assert.equal(c.exitCombo, s.DEFAULTS.exitCombo);
  assert.equal(c.bounds, null);
});
test('preferências da versão anterior continuam válidas', () => {
  const c = s.sanitize({ version: 1, startFullscreen: true, exitCombo: 'Ctrl+Alt+K' });
  assert.equal(c.startFullscreen, true);
  assert.equal(c.exitCombo, 'Ctrl+Alt+K');
  assert.equal(c.highPriority, true);
});
test('atalhos iguais voltam ao padrão (evita ficar sem saída)', () => {
  const c = s.sanitize({ toggleCombo: 'Ctrl+Alt+K', exitCombo: 'Ctrl+Alt+K' });
  assert.equal(c.toggleCombo, s.DEFAULTS.toggleCombo);
  assert.equal(c.exitCombo, s.DEFAULTS.exitCombo);
});
test('applyChange valida', () => {
  const c = s.sanitize({});
  assert.equal(s.applyChange(c, 'exitCombo', 'F11').ok, false);
  assert.equal(s.applyChange(c, 'exitCombo', c.toggleCombo).ok, false);
  assert.equal(s.applyChange(c, 'exitCombo', 'Ctrl+Alt+K').cfg.exitCombo, 'Ctrl+Alt+K');
  assert.equal(s.applyChange(c, 'startFullscreen', 1).ok, false);
  assert.equal(s.applyChange(c, 'highPriority', true).cfg.highPriority, true);
  assert.equal(s.applyChange(c, 'showCorner', false).ok, false, 'opção fora das configurações');
  assert.equal(s.applyChange(c, 'maximized', true).ok, false);
  assert.equal(s.applyChange(c, 'foo', true).ok, false);
});
test('opções fora das configurações ficam sempre ligadas, mesmo em quem tinha desligado', () => {
  const c = s.sanitize({ showHome: false, protectFullscreen: false, blockAltSpace: false, showCorner: false, sounds: false, discord: false });
  for (const k of ['showHome', 'protectFullscreen', 'blockAltSpace', 'showCorner', 'sounds', 'discord']) {
    assert.equal(c[k], true, k);
    assert.equal(s.applyChange(c, k, false).ok, false, k);
  }
});
test('save/load persistem e arquivo corrompido volta ao padrão', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfsu2-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true })); // nada fica no %TEMP%
  const f = path.join(dir, 'settings.json');
  const c = { ...s.sanitize({}), startFullscreen: true, bounds: { x: 10, y: 20, width: 1280, height: 720 } };
  assert.ok(s.save(f, c));
  assert.deepEqual(s.load(f), c);
  fs.writeFileSync(f, '{corrompido');
  assert.deepEqual(s.load(f), s.DEFAULTS);
});

require('node:test')('anti-serrilhado do jogo: guarda ligado/desligado e o caminho do registry.txt, só se for simples', () => {
  const assert = require('node:assert/strict');
  const settings = require('../src/main/settings');
  const B = String.fromCharCode(92); // barra invertida
  const d = settings.sanitize({});
  assert.strictEqual(d.gameAa, false);
  assert.strictEqual(d.gameReg, '');
  const win = ['000', 't', '00', '00000007'].join(B);
  const ok = settings.sanitize({ gameAa: true, gameAaMod: true, gameReg: win, gameRegMod: '001/t/00/00000012' });
  assert.strictEqual(ok.gameAa, true);
  assert.strictEqual(ok.gameAaMod, true);
  assert.strictEqual(ok.gameReg, win);
  assert.strictEqual(ok.gameRegMod, '001/t/00/00000012');
  for (const ruim of [`..${B}fora`, `C:${B}Windows${B}x`, '/etc/x', `000${B}..${B}x`, 7, 'a\nb']) assert.strictEqual(settings.sanitize({ gameReg: ruim }).gameReg, '', String(ruim));
});
