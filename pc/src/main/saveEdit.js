'use strict';
// Editor de save (UNPSY, do PsyGARAGE, só PC, NFSU2 e Modded). Antes de abrir o editor, o save atual vai para
// "antes-do-editor-*.zip" (+ .json com onde cada arquivo fica no disco). O que o editor salva só entra no jogo
// com o clique do jogador, e só por cima dos mesmos arquivos (perfil e GARAGE.DAT, mesmo tamanho e mesmo tipo).
// "Restaurar último save" põe de volta a cópia mais nova, pelo mesmo caminho. Nada aqui roda sozinho.
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const saveCopy = require('./saveCopy');

const KEEP = 3;
const SNAP = /^antes-do-editor-\d{8}-\d{6}\.zip$/;
const APPLY = /(^|\/)GARAGE\.DAT$/i;

function unzip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054B50) { end = i; break; }
  if (end < 0) throw new Error('zip inválido');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(at) !== 0x02014B50) throw new Error('zip inválido');
    const method = buf.readUInt16LE(at + 10), csize = buf.readUInt32LE(at + 20), size = buf.readUInt32LE(at + 24);
    const nl = buf.readUInt16LE(at + 28), xl = buf.readUInt16LE(at + 30), cl = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nl).split('\\').join('/');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('compressão não suportada');
    if (data.length !== size) throw new Error('zip com defeito');
    out.push({ name, data });
    at += 46 + nl + xl + cl;
  }
  return out;
}

// Só perfil e garagem; configurações do jogo ficam como estão.
const kindOfData = (name, data) => (saveCopy.isProfile(data) ? 'perfil'
  : APPLY.test(name) && data.length === saveCopy.GARAGE_SIZE && data.toString('latin1', 0, 4) === 'N2GA' ? 'garagem' : null);

async function snapshots(dest) {
  try { return (await fs.readdir(dest)).filter((n) => SNAP.test(n)).sort().reverse(); } catch { return []; }
}
async function latest(dest) {
  for (const n of await snapshots(dest)) {
    try { await fs.access(path.join(dest, n.replace(/\.zip$/, '.json'))); return path.join(dest, n); } catch { /* sem mapa */ }
  }
  return null;
}

async function snapshot({ root, dest, now = new Date() }) {
  const { profiles, entries } = await saveCopy.collect(root);
  if (!profiles.length) return { ok: false, why: 'sem-save' };
  const map = {};
  for (const e of entries) if (!map[e.name]) map[e.name] = path.relative(root, e.path);
  await fs.mkdir(dest, { recursive: true });
  const base = path.join(dest, `antes-do-editor-${saveCopy.stamp(now)}`);
  const zipBuf = saveCopy.zip(entries.map(({ name, data, mtime }) => ({ name, data, mtime })));
  await fs.writeFile(`${base}.json`, JSON.stringify({ files: map }));
  await fs.writeFile(`${base}.zip.tmp`, zipBuf);
  await fs.rename(`${base}.zip.tmp`, `${base}.zip`);
  for (const old of (await snapshots(dest)).slice(KEEP)) {
    await fs.unlink(path.join(dest, old)).catch(() => {});
    await fs.unlink(path.join(dest, old.replace(/\.zip$/, '.json'))).catch(() => {});
  }
  return { ok: true, file: `${base}.zip`, zip: zipBuf, map };
}

// Confere tudo antes de gravar qualquer coisa: ou entra tudo, ou nada.
async function apply({ root, zipBuf, map, tmpDir }) {
  let list;
  try { list = unzip(zipBuf); } catch { return { ok: false, why: 'zip' }; }
  const plan = [];
  for (const e of list) {
    const kind = kindOfData(e.name, e.data);
    const rel = map[e.name];
    if (!rel || !e.name.startsWith('NFS Underground 2/')) continue;
    if (!kind) return { ok: false, why: 'estragado' }; // perfil ou garagem fora do formato: nada entra
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root) + path.sep)) continue;
    let cur;
    try { cur = await fs.readFile(file); } catch { return { ok: false, why: 'sumiu' }; }
    if (cur.length !== e.data.length || kindOfData(e.name, cur) !== kind) return { ok: false, why: 'diferente' };
    if (!cur.equals(e.data)) plan.push({ file, data: e.data, kind });
  }
  if (!list.some((e) => kindOfData(e.name, e.data) && map[e.name])) return { ok: false, why: 'nada' };
  await fs.mkdir(tmpDir, { recursive: true });
  for (const [i, p] of plan.entries()) {
    const tmp = path.join(tmpDir, `editor-${i}.novo`);
    await fs.writeFile(tmp, p.data);
    await fs.rename(tmp, p.file);
  }
  return { ok: true, written: plan.length };
}

async function restoreLast({ root, dest }) {
  const file = await latest(dest);
  if (!file) return { ok: false, why: 'sem-copia' };
  let map;
  try { map = JSON.parse(await fs.readFile(file.replace(/\.zip$/, '.json'), 'utf8')).files || {}; } catch { return { ok: false, why: 'sem-copia' }; }
  const r = await apply({ root, zipBuf: await fs.readFile(file), map, tmpDir: dest });
  return { ...r, file };
}

module.exports = { unzip, snapshot, apply, restoreLast, latest, KEEP };
