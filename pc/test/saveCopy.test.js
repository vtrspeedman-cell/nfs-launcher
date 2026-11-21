'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const saveCopy = require('../src/main/saveCopy');

const NAME_AT = 36 + 53761;
function profile(name, fill = 7) {
  const b = Buffer.alloc(saveCopy.PROFILE_SIZE, 0);
  b.write('20CM', 0, 'latin1');
  b.writeUInt32LE(saveCopy.PROFILE_SIZE, 4);
  b[100] = fill;
  b.write(name, NAME_AT, 'latin1');
  return b;
}
const pad = (text, size) => { const b = Buffer.alloc(size, 0x20); b.write(text, 0, 'latin1'); return b; };
function put(root, rel, data) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
}
// Lê o zip como um programa de fora leria: índice no fim, nome, tamanho, CRC e conteúdo sem compressão.
function readZip(file) {
  const b = fs.readFileSync(file);
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4B, 5, 6]));
  const count = b.readUInt16LE(end + 10);
  let at = b.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.strictEqual(b.readUInt32LE(at), 0x02014B50);
    const crc = b.readUInt32LE(at + 16), size = b.readUInt32LE(at + 24), nlen = b.readUInt16LE(at + 28), off = b.readUInt32LE(at + 42);
    const name = b.toString('utf8', at + 46, at + 46 + nlen);
    assert.strictEqual(b.readUInt32LE(off), 0x04034B50);
    const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const data = b.subarray(start, start + size);
    assert.strictEqual(saveCopy.crc32(data), crc, name);
    out[name] = data;
    at += 46 + nlen + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
  }
  return out;
}
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); }); // nada fica no %TEMP%
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfs-savecopy-'));
  made.push(dir);
  return { root: path.join(dir, 'File System'), dest: path.join(dir, 'copias') };
}
const zips = (dest) => fs.readdirSync(dest).filter((n) => n.endsWith('.zip'));

test('CRC igual ao do zip padrão', () => {
  assert.strictEqual(saveCopy.crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('reconhece garagem e opções pelo começo do arquivo', () => {
  assert.strictEqual(saveCopy.kindOf(Buffer.from('N2GA....')), 'garage');
  assert.strictEqual(saveCopy.kindOf(Buffer.from('# NFSU2 settings, read at')), 'settings.ini');
  assert.strictEqual(saveCopy.kindOf(Buffer.from('d NotFirstTime=1\n')), 'registry.txt');
  assert.strictEqual(saveCopy.kindOf(Buffer.from('# Profiles the page has')), 'autosave-profiles.txt');
  assert.strictEqual(saveCopy.kindOf(Buffer.from('MOIR....')), null);
});

test('um perfil: sai o backup inteiro, no formato que o Restaurar do jogo aceita', async () => {
  const { root, dest } = setup();
  const prof = profile('Iskanda');
  put(root, '000/t/74/00007461', prof);
  put(root, '000/t/74/00007459', pad('N2GAgaragem', saveCopy.GARAGE_SIZE));
  put(root, '000/t/74/00007467', pad('# NFSU2 settings, read at every launch.\n', 16770));
  put(root, '000/t/75/00007563', pad('d NotFirstTime=1\n', 701));
  put(root, '000/t/74/00007463', pad('# Profiles the page has looked at\n', 246));
  put(root, '001/t/01/00000001', pad('N2GA de outro site', saveCopy.GARAGE_SIZE)); // o outro jogo nunca entra
  put(root, '000/t/Paths/000004.log', prof); // o banco do navegador nunca entra
  const r = await saveCopy.run({ root, dest });
  assert.strictEqual(r.copied, true);
  const z = readZip(r.file);
  assert.deepStrictEqual(Object.keys(z).sort(), ['NFS Underground 2/Iskanda/GARAGE.DAT', 'NFS Underground 2/Iskanda/Iskanda', 'autosave-profiles.txt', 'registry.txt', 'settings.ini'].sort());
  assert.ok(z['NFS Underground 2/Iskanda/Iskanda'].equals(prof));
  assert.strictEqual(z['NFS Underground 2/Iskanda/GARAGE.DAT'].toString('latin1', 0, 11), 'N2GAgaragem');
});

test('save igual não grava nada; save novo grava; só as 2 últimas versões ficam', async () => {
  const { root, dest } = setup();
  const file = put(root, '000/t/74/00007461', profile('Iskanda'));
  const day = (n) => new Date(2026, 10, n, 12, 0, 0);
  assert.strictEqual((await saveCopy.run({ root, dest, now: day(1) })).copied, true);
  const again = await saveCopy.run({ root, dest, now: day(2) });
  assert.deepStrictEqual([again.copied, again.why], [false, 'igual']);
  assert.strictEqual(zips(dest).length, 1);
  for (let n = 2; n <= 8; n++) {
    fs.writeFileSync(file, profile('Iskanda', n));
    assert.strictEqual((await saveCopy.run({ root, dest, now: day(n) })).copied, true);
  }
  assert.strictEqual(zips(dest).length, saveCopy.KEEP);
  assert.ok(zips(dest).sort().at(-1).includes('20261108'));
  assert.ok(!zips(dest).some((n) => n.includes('20261101')));
});

test('sem save: guarda as cópias antigas e não apaga nada', async () => {
  const { root, dest } = setup();
  const file = put(root, '000/t/74/00007461', profile('Iskanda'));
  await saveCopy.run({ root, dest });
  fs.unlinkSync(file);
  const r = await saveCopy.run({ root, dest });
  assert.deepStrictEqual([r.copied, r.why], [false, 'sem-save']);
  assert.strictEqual(zips(dest).length, 1);
});

test('arquivo do tamanho do perfil que não é perfil fica de fora', async () => {
  const { root, dest } = setup();
  put(root, '000/t/10/00001000', Buffer.alloc(saveCopy.PROFILE_SIZE, 1));
  assert.strictEqual((await saveCopy.run({ root, dest })).why, 'sem-save');
  assert.ok(!fs.existsSync(dest));
});

test('dois perfis: cada um com a garagem de data mais perto', async () => {
  const { root, dest } = setup();
  const t = (f, s) => { const d = new Date(2026, 10, 21, 12, 0, s); fs.utimesSync(f, d, d); };
  t(put(root, '000/t/74/1', profile('Um')), 0);
  t(put(root, '000/t/74/2', profile('Dois')), 40);
  t(put(root, '000/t/74/3', pad('N2GAum', saveCopy.GARAGE_SIZE)), 1);
  t(put(root, '000/t/74/4', pad('N2GAdois', saveCopy.GARAGE_SIZE)), 41);
  const r = await saveCopy.run({ root, dest });
  const z = readZip(r.file);
  assert.deepStrictEqual(Object.keys(z).sort(), ['NFS Underground 2/Dois/Dois', 'NFS Underground 2/Dois/GARAGE.DAT', 'NFS Underground 2/Um/GARAGE.DAT', 'NFS Underground 2/Um/Um']);
  assert.strictEqual(z['NFS Underground 2/Um/GARAGE.DAT'].toString('latin1', 0, 6), 'N2GAum');
  assert.strictEqual(z['NFS Underground 2/Dois/GARAGE.DAT'].toString('latin1', 0, 8), 'N2GAdois');
});

test('garagem entra mesmo sem as configurações, e mudar só ela faz cópia nova', async () => {
  const { root, dest } = setup();
  put(root, '000/t/74/1', profile('Solo'));
  const g = put(root, '000/t/74/2', pad('N2GAa', saveCopy.GARAGE_SIZE));
  const r = await saveCopy.run({ root, dest, now: new Date(2026, 10, 21, 10) });
  assert.ok(readZip(r.file)['NFS Underground 2/Solo/GARAGE.DAT']);
  fs.writeFileSync(g, pad('N2GAb', saveCopy.GARAGE_SIZE));
  assert.ok((await saveCopy.run({ root, dest, now: new Date(2026, 10, 21, 11) })).copied);
});

test('não mexe nos dados do jogo nem falha com pasta ausente', async () => {
  const { root, dest } = setup();
  assert.strictEqual((await saveCopy.run({ root, dest })).why, 'sem-save');
  const file = put(root, '000/t/74/00007461', profile('Iskanda'));
  const before = fs.statSync(file).mtimeMs;
  await saveCopy.run({ root, dest });
  assert.strictEqual(fs.statSync(file).mtimeMs, before);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, '000', 't', '74')), ['00007461']);
});
