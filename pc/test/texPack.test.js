'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tp = require('../src/main/texPack');

// Pacote versão 2 de teste: cada textura { crc, w, name, data, base? } (base = índice de outra entrada do mesmo pacote).
function writePak(file, list) {
  const n = list.length;
  const names = Buffer.concat(list.map((x) => Buffer.from(`${x.name}\0`, 'latin1')));
  const namesAt = 16 + 48 * n;
  const dataAt = Math.ceil((namesAt + names.length) / 16) * 16;
  const head = Buffer.alloc(dataAt);
  head.write('NTXP', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(n, 8);
  names.copy(head, namesAt);
  let pos = dataAt, nameOff = namesAt;
  const offs = [];
  list.forEach((x, i) => {
    const o = 16 + 40 * i;
    head.writeUInt32LE(x.crc, o); head.writeUInt32LE(7, o + 4); head.writeUInt16LE(64, o + 8); head.writeUInt16LE(64, o + 10); head.writeUInt32LE(21, o + 12);
    head.writeUInt16LE(x.w, o + 16); head.writeUInt16LE(x.w, o + 18); head.writeUInt32LE(21, o + 20); head.writeUInt32LE(1, o + 24);
    head.writeUInt32LE(pos, o + 28); head.writeUInt32LE(x.data.length, o + 32); head.writeUInt32LE(nameOff, o + 36);
    offs.push(pos); pos += x.data.length; nameOff += x.name.length + 1;
  });
  list.forEach((x, i) => {
    if (x.base === undefined) return;
    const bo = 16 + 40 * n + 8 * i;
    head.writeUInt32LE(offs[x.base], bo); head.writeUInt32LE(list[x.base].data.length, bo + 4);
  });
  fs.writeFileSync(file, Buffer.concat([head, ...list.map((x) => x.data)]));
}
const d = (s) => Buffer.from(s, 'latin1');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texpack-'));
  writePak(path.join(dir, 'site.pak'), [
    { crc: 1, w: 2048, name: 'TRACKS/TRACKMAP4000', data: d('SITE-MAPA-0') },
    { crc: 2, w: 2048, name: 'TRACKS/TRACKMAP4001', data: d('SITE-MAPA-1'), base: 0 },
    { crc: 9, w: 64, name: 'TRACKS/PEQUENA', data: d('SITE-PEQ') },
  ]);
  writePak(path.join(dir, 'redux.pak'), [
    { crc: 1, w: 1024, name: 'TRACKMAP4000', data: d('R-MAPA') },        // site maior: fica a do site
    { crc: 9, w: 512, name: 'TRACKS_PEQUENA', data: d('R-PEQ') },         // mod maior que a do site: fica a do mod
    { crc: 10, w: 512, name: 'RDP_ROADSTRIP_MA', data: d('R-ASFALTO') },
    { crc: 11, w: 512, name: 'ARC_SIDEWALK_A', data: d('R-CALCADA') },
  ]);
  writePak(path.join(dir, 'definitive.pak'), [
    { crc: 10, w: 1024, name: 'RDP_ROADSTRIP_MA', data: d('D-ASFALTO-MOLHADO') },
    { crc: 12, w: 512, name: 'RDP_LANEA_YS_AA_KT', data: d('D-FAIXA') },
  ]);
  writePak(path.join(dir, 'nextgen.pak'), [
    { crc: 20, w: 512, name: 'SKY_NIGHT_A', data: d('N-CEU') },
    { crc: 12, w: 2048, name: 'RDP_LANEA_YS_AA_KT', data: d('N-FAIXA') },
  ]);
  return dir;
}
// Lê o pacote virtual inteiro e devolve { nome: dados } de cada entrada.
async function unpack(v) {
  const b = await v.read(0, v.s);
  const n = b.readUInt32LE(8);
  const out = {};
  for (let i = 0; i < n; i++) {
    const o = 16 + 40 * i, at = b.readUInt32LE(o + 36);
    const name = b.toString('latin1', at, b.indexOf(0, at));
    const off = b.readUInt32LE(o + 28), size = b.readUInt32LE(o + 32);
    const bo = 16 + 40 * n + 8 * i;
    out[name] = { data: b.toString('latin1', off, off + size), base: b.readUInt32LE(bo + 4) ? b.toString('latin1', b.readUInt32LE(bo), b.readUInt32LE(bo) + b.readUInt32LE(bo + 4)) : null };
  }
  return out;
}

test('texturas por partes: classificação pelo nome do jogo', () => {
  assert.equal(tp.partOf('RDP_ROADSTRIP_MA'), 'asfalto');
  assert.equal(tp.partOf('RDP_ROADSTRIP_COBBLEROA'), 'calcadas');
  assert.equal(tp.partOf('ARC_SIDEWALKPAVE1'), 'calcadas');
  assert.equal(tp.partOf('ARC_CONCFREEWAY'), 'asfalto');
  assert.equal(tp.partOf('SHRM_ROAD'), 'asfalto');
  assert.equal(tp.partOf('SHRM_SKY'), 'ceu');
  assert.equal(tp.partOf('SHRM_BRICK'), 'cenario');
  assert.equal(tp.partOf('ORG_PALMTREEBARK'), 'natureza');
  assert.equal(tp.partOf('350Z_NEON'), 'carros');
  assert.equal(tp.partOf('SGN_NEON_OUTLINE'), 'cenario');
  assert.equal(tp.partOf('SFX_SMOKE_A_CS'), 'efeitos');
  assert.equal(tp.partOf('U2_MENU_ARROW'), 'menus');
  assert.equal(tp.partOf('TRACKMAP4000'), 'menus');
});

test('texturas por partes: padrão = só o primeiro mod de cada parte, nada completa sozinho; mapa do site maior vence', async () => {
  const src = tp.findSources(fixture());
  const v = tp.virtualMod(src, {});
  assert.deepEqual(v.virtual.eff.asfalto, ['redux']);
  assert.deepEqual(v.virtual.eff.ceu, ['nextgen'], 'o Redux não tem céu');
  const got = await unpack(v);
  assert.equal(got.RDP_ROADSTRIP_MA.data, 'R-ASFALTO', 'Redux vence mesmo menor');
  assert.equal(got.RDP_LANEA_YS_AA_KT, undefined, 'o Redux não tem e não há 2ª escolha: fica a original');
  assert.equal(got.SKY_NIGHT_A.data, 'N-CEU');
  assert.equal(got['TRACKS/TRACKMAP4000'].data, 'SITE-MAPA-0', 'mapa do site maior');
  assert.equal(got['TRACKS/TRACKMAP4001'].base, 'SITE-MAPA-0', 'a base do site continua apontando certo');
  assert.equal(got.TRACKS_PEQUENA.data, 'R-PEQ', 'textura do mod maior que a do site');
  assert.equal(Object.keys(got).length, 6);
});

test('texturas por partes: ordem do jogador (1ª, 2ª, 3ª), "original" e escolha da 3.0.4', async () => {
  const src = tp.findSources(fixture());
  const a = await unpack(tp.virtualMod(src, { asfalto: ['nextgen', 'redux'] }));
  assert.equal(a.RDP_LANEA_YS_AA_KT.data, 'N-FAIXA', '1ª escolha');
  assert.equal(a.RDP_ROADSTRIP_MA.data, 'R-ASFALTO', 'o NextGen não tem: vem da 2ª');
  const b = await unpack(tp.virtualMod(src, { asfalto: ['nextgen', 'definitive', 'redux'] }));
  assert.equal(b.RDP_ROADSTRIP_MA.data, 'D-ASFALTO-MOLHADO', 'a 2ª vem antes da 3ª');
  const c = await unpack(tp.virtualMod(src, { asfalto: ['definitive', 'nextgen'] }));
  assert.equal(c.RDP_LANEA_YS_AA_KT.data, 'D-FAIXA', 'a 1ª vence mesmo menor');
  const so = await unpack(tp.virtualMod(src, { asfalto: ['nextgen'] }));
  assert.equal(so.RDP_ROADSTRIP_MA, undefined, 'sem 2ª escolha: o que falta fica original');
  const leg = await unpack(tp.virtualMod(src, { asfalto: 'nextgen' }));
  assert.equal(leg.RDP_LANEA_YS_AA_KT.data, 'N-FAIXA', 'escolha da 3.0.4 vira a 1ª');
  assert.equal(leg.RDP_ROADSTRIP_MA, undefined, 'e não ganha 2ª sozinha');
  for (const orig of ['original', []]) {
    const o = await unpack(tp.virtualMod(src, { asfalto: orig, calcadas: orig }));
    assert.equal(o.RDP_ROADSTRIP_MA, undefined);
    assert.equal(o.ARC_SIDEWALK_A, undefined);
    assert.equal(o.SKY_NIGHT_A.data, 'N-CEU');
  }
  const avail = tp.partsAvailable(src);
  // Mod que não tem a parte (a tela nem oferece): escolha antiga vai ao primeiro que tem; na lista, sai dela.
  assert.deepEqual(tp.effectiveChoice({ ceu: 'redux' }, avail).ceu, ['nextgen']);
  assert.deepEqual(tp.effectiveChoice({ ceu: ['redux'] }, avail).ceu, []);
  assert.deepEqual(tp.effectiveChoice({ asfalto: ['nextgen', 'nextgen', 'redux'] }, avail).asfalto, ['nextgen', 'redux']);
});

test('texturas por partes: data própria para cada escolha, sem o mod desmarcado no instalador', async () => {
  const dir = fixture();
  const src = tp.findSources(dir);
  const a = tp.virtualMod(src, {}), b = tp.virtualMod(src, { asfalto: ['definitive'] });
  assert.notEqual(a.m, b.m, 'escolhas diferentes: o jogo não pode usar a cópia da outra');
  assert.equal(a.m, tp.virtualMod(src, {}).m, 'a mesma escolha: a mesma data');
  assert.equal(await a.check(), true);
  // Trechos do meio (como o jogo pede) batem com a leitura inteira.
  const all = await a.read(0, a.s);
  for (const [x, y] of [[0, 10], [5, a.s - 3], [a.s - 1, a.s]]) assert.deepEqual(await a.read(x, y), all.subarray(x, y));
  fs.rmSync(path.join(dir, 'definitive.pak'));
  assert.equal(await a.check(), false, 'pacote de origem sumiu: recusa');
  const sem = tp.findSources(dir);
  assert.equal(sem.definitive, undefined);
  assert.deepEqual(tp.partsAvailable(sem).asfalto, ['redux', 'nextgen']);
});

test('texturas por partes: escolha guardada só com partes e mods conhecidos', () => {
  assert.deepEqual(tp.sanitizeChoice({ asfalto: 'redux', ceu: 'original', x: 'redux', menus: 'outro' }), { asfalto: 'redux', ceu: 'original' });
  assert.deepEqual(tp.sanitizeChoice(null), {});
  assert.deepEqual(tp.sanitizeChoice({ asfalto: ['nextgen', 'x', 'nextgen', 'redux'], ceu: [], carros: [1] }), { asfalto: ['nextgen', 'redux'], ceu: [], carros: [] });
  const s = require('../src/main/settings');
  assert.deepEqual(s.sanitize({ version: 8, texParts: { asfalto: 'definitive', y: 1 } }).texParts, { asfalto: 'definitive' });
  assert.deepEqual(s.sanitize({ version: 9, texParts: { asfalto: ['nextgen', 'definitive'] } }).texParts, { asfalto: ['nextgen', 'definitive'] });
});

test('texturas por partes: TexWizard é o padrão onde tem; a escolha do jogador fica, e a antiga volta ao padrão uma vez', async () => {
  const dir = fixture();
  writePak(path.join(dir, 'texwizard.pak'), [
    { crc: 10, w: 256, name: 'RDP_ROADSTRIP_MA', data: d('T-ASFALTO') },
    { crc: 30, w: 256, name: 'ECLIPSE_SHADOWFE', data: d('T-SOMBRA') },
  ]);
  const src = tp.findSources(dir);
  const v = tp.virtualMod(src, {});
  assert.deepEqual(v.virtual.eff.asfalto, ['texwizard']);
  assert.deepEqual(v.virtual.eff.carros, ['texwizard'], 'a sombra dos carros fica em Carros');
  assert.deepEqual(v.virtual.eff.ceu, ['nextgen'], 'onde o TexWizard não tem: o primeiro que tem');
  const got = await unpack(v);
  assert.equal(got.RDP_ROADSTRIP_MA.data, 'T-ASFALTO', 'TexWizard vence mesmo menor');
  assert.equal(got.ARC_SIDEWALK_A.data, 'R-CALCADA', 'parte que ele não tem: o Redux');
  assert.equal(got.RDP_LANEA_YS_AA_KT, undefined, 'o que ele não tem na parte: fica original (sem 2ª escolha)');
  const s = require('../src/main/settings');
  const saved = s.sanitize({ version: 8, texParts: { asfalto: 'redux' } });
  assert.equal(saved.texParts.asfalto, 'redux', 'quem escolheu depois continua com a escolha ao reiniciar');
  assert.equal((await unpack(tp.virtualMod(src, saved.texParts))).RDP_ROADSTRIP_MA.data, 'R-ASFALTO');
  assert.deepEqual(s.sanitize({ version: 7, texParts: { asfalto: 'redux' } }).texParts, {}, 'escolha de antes do TexWizard: volta ao padrão uma vez');
});

test('texturas por partes: faixas do estacionamento são uma parte à parte do asfalto', () => {
  assert.equal(tp.partOf('RDP_PARKING_WL_AA_KT'), 'estacionamento');
  assert.equal(tp.partOf('RDP_ROADSTRIP_MA'), 'asfalto');
  const ent = (name, w) => ({ name, key: name, crc: 1, adler: 1, w, h: w });
  const src = {
    nextgen: { entries: [ent('RDP_PARKING_WL_AA_KT', 2048), ent('RDP_ROADSTRIP_MA', 2048)] },
    definitive: { entries: [ent('RDP_PARKING_WL_AA_KT', 1024), ent('RDP_ROADSTRIP_MA', 1024)] },
  };
  const got = Object.fromEntries(tp.choose(src, { asfalto: ['nextgen'], estacionamento: ['definitive'] }).list.map((x) => [x.e.name, x.src]));
  assert.deepEqual(got, { RDP_PARKING_WL_AA_KT: 'definitive', RDP_ROADSTRIP_MA: 'nextgen' });
});
