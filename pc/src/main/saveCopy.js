'use strict';
// Cópia do save do NFSU2: uma vez ao abrir o app, antes de os dados do jogo serem abertos. Sem internet e sem script no jogo.
// Leve de propósito (pedido do Bruno: nada de ficar copiando, senão o antivírus acusa): só olha tamanho e data dos arquivos,
// abre o que tem o tamanho exato de um perfil e, só se o save mudou, grava um zip pequeno. Nunca altera os dados do jogo.
// O zip tem o formato do "Baixar backup" do jogo, então volta pelo botão "Restaurar" do próprio jogo.
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const PROFILE_SIZE = 54966;     // tamanho fixo do perfil (web/src/app/profile.ts do jogo)
const NAME_AT = 36 + 53761;     // onde fica o nome do perfil dentro do arquivo
const GARAGE_SIZE = 10202;      // tamanho da garagem (GARAGE.DAT), igual nos dois perfis conferidos
const KEEP = 2;                 // pedido do Bruno: as 2 últimas versões
const COPY_NAME = /^nfsu2-saves-\d{8}-\d{6}\.zip$/;

async function walk(dir, out) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'Paths') await walk(p, out); continue; } // Paths: o banco do navegador, nunca tocado
    if (!e.isFile()) continue;
    try { const st = await fs.stat(p); out.push({ path: p, size: st.size, mtime: st.mtime }); } catch { /* sumiu */ }
  }
}

// Todo arquivo do armazenamento do jogo, de qualquer site (cada um é uma pasta 000, 001...). Só tamanho e data.
async function listFiles(root) {
  const out = [];
  let dirs = [];
  try { dirs = await fs.readdir(root); } catch { return out; }
  for (const d of dirs) {
    if (!/^\d{3}$/.test(d)) continue;
    try { await walk(path.join(root, d, 't'), out); } catch { /* origem sem a pasta t */ }
  }
  return out;
}

const isProfile = (b) => b.length === PROFILE_SIZE && b.toString('latin1', 0, 4) === '20CM' && b.readUInt32LE(4) === PROFILE_SIZE;

function profileName(b, i) {
  let n = 0;
  while (n < 31 && b[NAME_AT + n]) n++;
  const name = b.toString('latin1', NAME_AT, NAME_AT + n);
  return /^[A-Za-z0-9]+$/.test(name) ? name : `Perfil${i + 1}`; // nome estranho: o "Restaurar" do jogo conserta
}

// Pelo começo do arquivo: os nomes verdadeiros estão no banco do navegador, que não é aberto.
function kindOf(head) {
  const s = head.toString('latin1');
  if (s.startsWith('N2GA')) return 'garage';
  if (s.startsWith('# NFSU2 settings')) return 'settings.ini';
  if (s.startsWith('# Profiles the page')) return 'autosave-profiles.txt';
  if (/^d [A-Za-z_]\w*=/.test(s)) return 'registry.txt';
  return null;
}

async function readHead(file, n) {
  const h = await fs.open(file, 'r');
  try { const b = Buffer.alloc(n); const { bytesRead } = await h.read(b, 0, n, 0); return b.subarray(0, bytesRead); } finally { await h.close(); }
}

// Garagem e opções do jogo. Sem elas o perfil volta igual, mas perde os carros das vagas 6 a 10.
// Só quando o save mudou, e só o começo dos poucos arquivos com o tamanho certo (cerca de 150 de 2.400 no PC do Bruno).
const mayBeExtra = (size) => size === GARAGE_SIZE || (size >= 100 && size <= 4000) || (size >= 12000 && size <= 24000);
async function findExtras(files) {
  const found = {};
  for (const f of files.filter((x) => mayBeExtra(x.size)).sort((a, b) => b.mtime - a.mtime)) {
    let kind = null;
    try { kind = kindOf(await readHead(f.path, 32)); } catch { /* ignora */ }
    if (!kind || (found[kind] && kind !== 'garage')) continue;
    let item;
    try { item = { data: await fs.readFile(f.path), mtime: f.mtime, path: f.path }; } catch { continue; }
    if (kind === 'garage') { if (item.data.length === GARAGE_SIZE) (found.garages = found.garages || []).push(item); } else found[kind] = item;
  }
  return found;
}

const CRC = new Int32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; return c; });
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function zip(entries) {
  const parts = [], central = [];
  let at = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const d = e.mtime;
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0); common.writeUInt16LE(0x0800, 2); common.writeUInt16LE(0, 4); // UTF-8, sem compressão
    common.writeUInt16LE(time, 6); common.writeUInt16LE(date, 8);
    common.writeUInt32LE(crc32(e.data), 10); common.writeUInt32LE(e.data.length, 14); common.writeUInt32LE(e.data.length, 18);
    common.writeUInt16LE(name.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4B, 3, 4]), common, name, e.data]);
    const tail = Buffer.alloc(14); tail.writeUInt32LE(at, 10); // sem comentário, sem atributos
    central.push(Buffer.concat([Buffer.from([0x50, 0x4B, 1, 2, 20, 0]), common, tail, name]));
    parts.push(local);
    at += local.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, dir, end]);
}

const two = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;

async function copies(dest) {
  try { return (await fs.readdir(dest)).filter((n) => COPY_NAME.test(n)).sort().reverse(); } catch { return []; }
}

// Data da cópia mais nova e quantas há, para a tela de Configurações.
async function info(dest) {
  const names = await copies(dest);
  if (!names.length) return { count: 0, last: 0 };
  try { return { count: names.length, last: (await fs.stat(path.join(dest, names[0]))).mtimeMs }; } catch { return { count: names.length, last: 0 }; }
}

// Perfis (mais novo primeiro), a garagem de cada um e as configurações do mesmo site; cada item com o caminho no disco.
// O jogo grava perfil e garagem juntos: cada perfil fica com a garagem de data mais perto da dele (uma garagem por perfil).
async function collect(root) {
  const files = await listFiles(root);
  const profiles = [];
  for (const f of files.filter((x) => x.size === PROFILE_SIZE)) {
    try { const data = await fs.readFile(f.path); if (isProfile(data)) profiles.push({ data, mtime: f.mtime, path: f.path }); } catch { /* ignora */ }
  }
  profiles.sort((a, b) => b.mtime - a.mtime);
  const entries = profiles.map((p, i) => { const n = profileName(p.data, i); return { name: `NFS Underground 2/${n}/${n}`, data: p.data, mtime: p.mtime, path: p.path }; });
  if (!profiles.length) return { profiles, entries };
  const site = (f) => path.relative(root, f.path).split(path.sep)[0]; // só o site do perfil: o outro jogo não conta
  const bySite = {};
  for (const p of profiles) (bySite[site(p)] = bySite[site(p)] || []).push(p);
  const extras = {};
  for (const o of Object.keys(bySite)) extras[o] = await findExtras(files.filter((f) => site(f) === o));
  for (const o of Object.keys(bySite)) {
    const free = [...(extras[o].garages || [])];
    const pairs = [];
    for (const p of bySite[o]) for (const g of free) pairs.push({ p, g, d: Math.abs(p.mtime - g.mtime) });
    pairs.sort((a, b) => a.d - b.d);
    const usedP = new Set(), usedG = new Set();
    for (const { p, g } of pairs) {
      if (usedP.has(p) || usedG.has(g)) continue;
      usedP.add(p); usedG.add(g);
      const n = profileName(p.data, profiles.indexOf(p));
      entries.push({ name: `NFS Underground 2/${n}/GARAGE.DAT`, ...g });
    }
  }
  const x = extras[site(profiles[0])];
  for (const k of ['settings.ini', 'registry.txt', 'autosave-profiles.txt']) if (x[k]) entries.push({ name: k, ...x[k] });
  return { profiles, entries };
}

async function run({ root, dest, now = new Date() }) {
  const { profiles, entries } = await collect(root);
  if (!profiles.length) return { copied: false, why: 'sem-save' }; // nunca troca uma cópia boa por nada

  const hash = crypto.createHash('sha256');
  for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) { hash.update(e.name); hash.update(e.data); }
  const sum = hash.digest('hex');
  const lastFile = path.join(dest, 'ultima.txt');
  let last = '';
  try { last = (await fs.readFile(lastFile, 'utf8')).trim(); } catch { /* primeira vez */ }
  if (last === sum && (await copies(dest)).length) return { copied: false, why: 'igual' };

  await fs.mkdir(dest, { recursive: true });
  const file = path.join(dest, `nfsu2-saves-${stamp(now)}.zip`);
  await fs.writeFile(`${file}.tmp`, zip(entries.map(({ name, data, mtime }) => ({ name, data, mtime }))));
  await fs.rename(`${file}.tmp`, file);
  await fs.writeFile(lastFile, sum);
  for (const old of (await copies(dest)).slice(KEEP)) await fs.unlink(path.join(dest, old)).catch(() => {});
  return { copied: true, file, entries: entries.map((e) => e.name) };
}

module.exports = { run, collect, stamp, info, zip, crc32, kindOf, isProfile, listFiles, readHead, PROFILE_SIZE, GARAGE_SIZE, KEEP };
