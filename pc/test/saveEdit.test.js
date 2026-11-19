'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const saveCopy = require('../src/main/saveCopy');
const saveEdit = require('../src/main/saveEdit');

const NAME_AT = 36 + 53761;
function profile(name, fill = 7) {
  const b = Buffer.alloc(saveCopy.PROFILE_SIZE, 0);
  b.write('20CM', 0, 'latin1'); b.writeUInt32LE(saveCopy.PROFILE_SIZE, 4); b[100] = fill; b.write(name, NAME_AT, 'latin1');
  return b;
}
const pad = (text, size) => { const b = Buffer.alloc(size, 0x20); b.write(text, 0, 'latin1'); return b; };
function put(root, rel, data) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; }
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfs-saveedit-'));
  made.push(dir);
  const root = path.join(dir, 'File System');
  const prof = put(root, '000/t/74/00007461', profile('Iskanda'));
  const gar = put(root, '000/t/74/00007459', pad('N2GAgaragem', saveCopy.GARAGE_SIZE));
  const ini = put(root, '000/t/74/00007467', pad('# NFSU2 settings, read at every launch.\n', 16770));
  return { root, dest: path.join(dir, 'copias'), prof, gar, ini };
}
const day = (n) => new Date(2026, 10, n, 12, 0, 0);
// O editor devolve um zip comprimido (DEFLATE), com os mesmos nomes.
function deflateZip(entries) {
  const z = saveCopy.zip(entries.map((e) => ({ ...e, mtime: day(1) })));
  const list = saveEdit.unzip(z);
  assert.deepStrictEqual(list.map((e) => e.name), entries.map((e) => e.name));
  const parts = [], central = []; let at = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), comp = zlib.deflateRawSync(e.data);
    const h = Buffer.alloc(26); h.writeUInt16LE(20, 0); h.writeUInt16LE(8, 4);
    h.writeUInt32LE(saveCopy.crc32(e.data), 10); h.writeUInt32LE(comp.length, 14); h.writeUInt32LE(e.data.length, 18); h.writeUInt16LE(name.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4B, 3, 4]), h, name, comp]);
    const tail = Buffer.alloc(14); tail.writeUInt32LE(at, 10);
    central.push(Buffer.concat([Buffer.from([0x50, 0x4B, 1, 2, 20, 0]), h, tail, name])); parts.push(local); at += local.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, dir, end]);
}

test('cópia antes do editor e edição aplicada só no perfil e na garagem', async () => {
  const s = setup();
  const snap = await saveEdit.snapshot({ root: s.root, dest: s.dest, now: day(1) });
  assert.strictEqual(snap.ok, true);
  assert.ok(fs.existsSync(snap.file));
  const novo = profile('Iskanda', 99), garagem = pad('N2GAeditada', saveCopy.GARAGE_SIZE);
  const zipBuf = deflateZip([
    { name: 'NFS Underground 2/Iskanda/Iskanda', data: novo },
    { name: 'NFS Underground 2/Iskanda/GARAGE.DAT', data: garagem },
    { name: 'settings.ini', data: pad('# NFSU2 settings, mudado\n', 16770) },
  ]);
  const r = await saveEdit.apply({ root: s.root, zipBuf, map: snap.map, tmpDir: s.dest });
  assert.deepStrictEqual(r, { ok: true, written: 2 });
  assert.ok(fs.readFileSync(s.prof).equals(novo));
  assert.ok(fs.readFileSync(s.gar).equals(garagem));
  assert.ok(fs.readFileSync(s.ini).toString('latin1').includes('every launch')); // configurações ficam
  const back = await saveEdit.restoreLast({ root: s.root, dest: s.dest });
  assert.strictEqual(back.ok, true);
  assert.ok(fs.readFileSync(s.prof).equals(profile('Iskanda')));
  assert.strictEqual(fs.readFileSync(s.gar).toString('latin1', 0, 11), 'N2GAgaragem');
});

test('arquivo estragado não entra: nada é gravado', async () => {
  const s = setup();
  const snap = await saveEdit.snapshot({ root: s.root, dest: s.dest, now: day(1) });
  const torto = profile('Iskanda', 5).subarray(0, 1000);
  const r = await saveEdit.apply({ root: s.root, zipBuf: deflateZip([
    { name: 'NFS Underground 2/Iskanda/GARAGE.DAT', data: pad('N2GAoutra', saveCopy.GARAGE_SIZE) },
    { name: 'NFS Underground 2/Iskanda/Iskanda', data: torto },
  ]), map: snap.map, tmpDir: s.dest });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(fs.readFileSync(s.gar).toString('latin1', 0, 11), 'N2GAgaragem');
  assert.strictEqual((await saveEdit.apply({ root: s.root, zipBuf: Buffer.from('lixo'), map: snap.map, tmpDir: s.dest })).why, 'zip');
});

test('guarda só as 3 últimas cópias; sem cópia, restaurar não faz nada', async () => {
  const s = setup();
  assert.strictEqual((await saveEdit.restoreLast({ root: s.root, dest: s.dest })).why, 'sem-copia');
  for (let n = 1; n <= 5; n++) await saveEdit.snapshot({ root: s.root, dest: s.dest, now: day(n) });
  const zips = fs.readdirSync(s.dest).filter((n) => n.endsWith('.zip'));
  assert.strictEqual(zips.length, saveEdit.KEEP);
  assert.ok((await saveEdit.latest(s.dest)).includes('20261105'));
});
