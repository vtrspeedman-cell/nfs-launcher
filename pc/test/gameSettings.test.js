'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gs = require('../src/main/gameSettings');

const HEAD = '# NFSU2 settings\r\n# texto do jogo, com acento: ação\r\n';

test('Texturas HD: original vira map; desligar volta ao que era', () => {
  const t = `${HEAD}fps = 120\r\nui_textures = original\r\nrender = scale:1\r\n`;
  const a = gs.plan(t, { on: true });
  assert.ok(a.changed && a.uiOn);
  assert.strictEqual(a.prev, 'ui_textures = original');
  assert.strictEqual(a.text, t.replace('ui_textures = original', 'ui_textures = map'));
  const b = gs.plan(a.text, { on: false, prev: a.prev });
  assert.ok(b.changed);
  assert.strictEqual(b.prev, null);
  assert.strictEqual(b.text, t);
});

test('Texturas HD: sem a linha, acrescenta no fim; desligar tira', () => {
  const t = `${HEAD}#ui_textures = original\r\nfps = 60\r\n`;
  const a = gs.plan(t, { on: true });
  assert.strictEqual(a.prev, '');
  assert.ok(a.text.endsWith('fps = 60\r\nui_textures = map\r\n'));
  assert.strictEqual(gs.plan(a.text, { on: false, prev: '' }).text, t);
});

test('Texturas HD: HUD HD (uhud) e map do jogador nunca mudam, ligando ou desligando', () => {
  for (const v of ['uhud', 'map', 'UHUD']) {
    const t = `${HEAD}ui_textures = ${v}\r\n`;
    for (const on of [true, false]) {
      const r = gs.plan(t, { on, prev: null });
      assert.ok(!r.changed, `${v} ${on}`);
      assert.ok(r.uiOn);
    }
  }
  // O jogador trocou depois para uhud: desligar não desfaz nada e esquece a linha antiga.
  const r = gs.plan(`${HEAD}ui_textures = uhud\r\n`, { on: false, prev: 'ui_textures = original' });
  assert.ok(!r.changed);
  assert.strictEqual(r.prev, null);
});

test('Texturas HD: mapa escolhido à mão (NFSU2_MAP_TEXTURES) fica como está', () => {
  const t = `${HEAD}NFSU2_MAP_TEXTURES = original\r\nui_textures = original\r\n`;
  const r = gs.plan(t, { on: true });
  assert.ok(!r.changed);
  assert.strictEqual(r.text, t);
});

test('Texturas HD: grava no lugar, com cópia antes; sem arquivo ou com dois, não escreve', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfs-gs-'));
  const bak = path.join(root, 'copias');
  const put = (rel, data) => { const p = path.join(root, 'fs', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
  try {
    assert.strictEqual((await gs.run({ root: path.join(root, 'fs'), backupDir: bak, on: true })).why, 'sem settings.ini');
    const text = `${HEAD}ui_textures = original\r\n`;
    const file = put('000/t/00/00000012', Buffer.from(text, 'latin1'));
    put('000/t/00/00000013', 'outro arquivo do jogo');
    const r = await gs.run({ root: path.join(root, 'fs'), backupDir: bak, on: true });
    assert.ok(r.changed && r.uiOn);
    assert.strictEqual(fs.readFileSync(file, 'latin1'), `${text.replace('original', 'map')}road_textures = off\r\n`);
    assert.strictEqual(fs.readFileSync(path.join(bak, gs.BACKUP), 'latin1'), text);
    assert.deepStrictEqual(fs.readdirSync(bak), [gs.BACKUP]); // nada pela metade
    // De novo ligado: nada muda. Desligado com a linha do app: volta ao original.
    assert.ok(!(await gs.run({ root: path.join(root, 'fs'), backupDir: bak, on: true, prev: r.prev, prevRoad: r.prevRoad })).changed);
    const off = await gs.run({ root: path.join(root, 'fs'), backupDir: bak, on: false, prev: r.prev, prevRoad: r.prevRoad });
    assert.ok(off.changed);
    assert.strictEqual(fs.readFileSync(file, 'latin1'), text);
    put('001/t/00/00000001', Buffer.from(text, 'latin1'));
    const two = await gs.run({ root: path.join(root, 'fs'), backupDir: bak, on: true });
    assert.strictEqual(two.why, 'mais de um settings.ini');
    assert.strictEqual(fs.readFileSync(file, 'latin1'), text);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DirectX 11: gráficos do jogo no mínimo, resolução e VSync como estão, o resto do registry igual', () => {
  const reg = 'd NotFirstTime=1\r\nd g_CarShadowEnable=2\r\nd g_RoadReflectionEnable=3\r\nd g_RacingResolution=3\r\nd g_VSyncOn=0\r\ns Outro=abc\r\n';
  const r = gs.minGraphicsText(reg);
  assert.ok(r.changed);
  assert.match(r.text, /^d g_CarShadowEnable=0\r$/m);
  assert.match(r.text, /^d g_RoadReflectionEnable=0\r$/m);
  assert.match(r.text, /^d g_RacingResolution=3\r$/m, 'resolução fica');
  assert.match(r.text, /^s Outro=abc\r$/m);
  for (const k of Object.keys(gs.MIN_GRAPHICS)) assert.match(r.text, new RegExp(`^d ${k}=0\r$`, 'm'), `${k} no mínimo (o que faltava entra no fim)`);
  assert.ok(!gs.minGraphicsText(r.text).changed, 'de novo: nada muda');
});

test('DirectX 11: grava no registry.txt com cópia antes; sem o arquivo, tenta depois', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfs-gs-'));
  const bak = path.join(root, 'copias');
  try {
    assert.strictEqual((await gs.minGraphics({ root: path.join(root, 'fs'), backupDir: bak })).done, false);
    const p = path.join(root, 'fs', '000', 't', '00', '00000007');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const reg = 'd NotFirstTime=1\nd g_CarShadowEnable=2\nd g_FogEnable=1\n';
    fs.writeFileSync(p, reg, 'latin1');
    const r = await gs.minGraphics({ root: path.join(root, 'fs'), backupDir: bak });
    assert.ok(r.done && r.changed);
    assert.match(fs.readFileSync(p, 'latin1'), /^d g_FogEnable=0$/m);
    assert.strictEqual(fs.readFileSync(path.join(bak, gs.REG_BACKUP), 'latin1'), reg);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('anti-serrilhado do jogo: 1 = ligado; 0, nunca ligado (4294967295) e ausente = desligado', () => {
  assert.strictEqual(gs.gameAaOn('d g_CarLodLevel=1\r\nd g_FSAALevel=1\r\nd FsaaAsked=1\r\n'), true);
  assert.strictEqual(gs.gameAaOn('d g_FSAALevel=0\n'), false);
  assert.strictEqual(gs.gameAaOn('d g_FSAALevel=4294967295\r\nd FsaaAsked=1\r\n'), false);
  assert.strictEqual(gs.gameAaOn('d g_CarLodLevel=1\n'), false);
  assert.strictEqual(gs.gameAaOn(''), false);
});

test('anti-serrilhado do jogo: acha o registry.txt, lê direto na abertura seguinte e nunca escreve', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfs-aa-'));
  const dir = path.join(root, '000', 't', '00');
  fs.mkdirSync(dir, { recursive: true });
  const reg = path.join(dir, '00000007');
  const text = 'd g_WorldLodLevel=3\r\nd g_FSAALevel=1\r\n';
  fs.writeFileSync(reg, text, 'latin1');
  fs.writeFileSync(path.join(dir, '00000008'), `${HEAD}fps = 120\r\n`, 'latin1');
  const r = await gs.gameAa({ root });
  assert.deepStrictEqual(r, { rel: path.join('000', 't', '00', '00000007'), on: true });
  assert.strictEqual(gs.gameAaSync(root, r.rel), true);
  assert.strictEqual(fs.readFileSync(reg, 'latin1'), text, 'só leitura');
  fs.writeFileSync(reg, 'd g_FSAALevel=4294967295\r\nd FsaaAsked=1\r\n', 'latin1');
  assert.strictEqual(gs.gameAaSync(root, r.rel), false, 'o jogador desligou no jogo: vale já na abertura seguinte');
  assert.strictEqual(gs.gameAaSync(root, path.join('000', 't', '00', '00000008')), null, 'outro arquivo no lugar: fica o guardado');
  assert.strictEqual(gs.gameAaSync(root, path.join('000', 't', '00', 'sumiu')), null);
  assert.strictEqual(gs.gameAaSync(root, path.join('..', 'fora')), null);
  assert.strictEqual(gs.gameAaSync(root, ''), null);
  fs.writeFileSync(path.join(dir, '00000009'), 'd g_WorldLodLevel=0\r\nd g_FSAALevel=0\r\n', 'latin1');
  assert.strictEqual(await gs.gameAa({ root }), null, 'dois registry.txt: não escolhe');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Estradas mais nítidas: Texturas HD desligam; desligar as texturas devolve', () => {
  for (const t of [`${HEAD}fps = 60\r\n`, `${HEAD}road_textures = on\r\nfps = 60\r\n`]) {
    const a = gs.planRoad(t, { on: true });
    assert.ok(a.changed);
    assert.ok(a.text.includes('road_textures = off'));
    assert.ok(!gs.planRoad(a.text, { on: true, prev: a.prev }).changed);
    assert.strictEqual(gs.planRoad(a.text, { on: false, prev: a.prev }).text, t);
  }
  // Já desligada pelo jogador: nada muda, e desligar as texturas não liga.
  const off = `${HEAD}road_textures = off\r\n`;
  assert.ok(!gs.planRoad(off, { on: true }).changed);
  assert.ok(!gs.planRoad(off, { on: false, prev: null }).changed);
  // O jogador religou depois: fica o dele.
  assert.ok(!gs.planRoad(`${HEAD}road_textures = on\r\n`, { on: false, prev: '' }).changed);
});

test('modo leve: desliga os mods pesados e devolve só o que o app trocou', () => {
  const ini = 'render = scale:1\r\ncrash_damage = on\r\nopen_tunnel = on\r\nskateboard = off\r\n';
  const a = gs.planLight(ini, { on: true });
  assert.ok(a.changed);
  assert.match(a.text, /^crash_damage = off\r$/m);
  assert.match(a.text, /^open_tunnel = on\r$/m);
  assert.match(a.text, /^others_mod_parts = original\r$/m);
  assert.equal(a.prev.crash_damage, 'crash_damage = on');
  assert.ok(!('skateboard' in a.prev));
  assert.equal(gs.planLight(a.text, { on: true, prev: a.prev }).changed, false);
  // O jogador religou o dano no jogo: fica o dele.
  const mexido = a.text.replace('crash_damage = off', 'crash_damage = on');
  const b = gs.planLight(mexido, { on: false, prev: a.prev });
  assert.equal(b.prev, null);
  assert.match(b.text, /^crash_damage = on\r$/m);
  assert.doesNotMatch(b.text, /daytime|others_mod_parts|hq_vinyls/);
  assert.equal(gs.planLight(a.text, { on: false, prev: a.prev }).text, ini);
});

test('modo leve: anti-serrilhado do jogo vai a 0 e volta', () => {
  const reg = 'd g_FSAALevel=4\r\nd g_FogEnable=1\r\n';
  const a = gs.planLightReg(reg, { on: true });
  assert.equal(a.prev, '4');
  assert.match(a.text, /^d g_FSAALevel=0\r$/m);
  assert.equal(gs.planLightReg(a.text, { on: false, prev: a.prev }).text, reg);
  assert.equal(gs.planLightReg('d g_FSAALevel=4294967295\n', { on: true }).changed, false);
  assert.equal(gs.planLightReg('d g_FSAALevel=2\n', { on: false, prev: '4' }).changed, false);
});

test('modo leve: sem arquivos do jogo, não grava nada', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leve-'));
  try {
    const r = await gs.lightMode({ root, backupDir: path.join(root, 'bk'), on: true });
    assert.equal(r.changed, false);
    assert.equal(r.prev, null);
    assert.ok(!fs.existsSync(path.join(root, 'bk')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
