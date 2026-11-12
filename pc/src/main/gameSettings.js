'use strict';
// Texturas HD do NFSU2 (pedido do Bruno, 06/11): o jogo só carrega o pacote de mapa (TEXPACKS/detailed.pak, onde estão
// as texturas HD) com "ui_textures" em map ou uhud no settings.ini dele. Muita gente não sabe ligar, então, com a opção
// "Texturas HD" ligada, o app troca SÓ essa linha para "ui_textures = map" (mapa detalhado; menus e HUD continuam os do
// jogo). Única escrita do app nos dados do jogo, e só nesta linha:
//   - ao abrir o app, antes de o navegador abrir os dados (com o jogo aberto, o arquivo podia se estragar);
//   - só se a linha estiver em "original" ou ausente: "map" e "uhud" (HUD HD) ficam como o jogador deixou;
//   - nunca com "NFSU2_MAP_TEXTURES" escrito pelo jogador (ele escolheu o mapa à mão);
//   - cópia do arquivo antes, fora da pasta do jogo;
//   - com a opção desligada, volta a linha ao que era, só se foi o app que trocou e ela continua "map".
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const saveCopy = require('./saveCopy');

const UI_LINE = 'ui_textures = map';
const KEY = /^\s*ui_textures\s*=\s*([^\s#;]*)/i;
const MAP_KEY = /^\s*NFSU2_MAP_TEXTURES\s*=/i;
const active = (l) => !/^\s*[#;]/.test(l);
const BACKUP = 'settings.ini-antes-das-texturas-HD.txt';

// Só o texto: o que muda no settings.ini. prev = linha que o app trocou (null: o app não trocou nada; '': não havia linha).
// Devolve { text, prev, changed, uiOn } — uiOn: o jogo vai carregar o pacote de mapa com este texto.
function plan(text, { on, prev = null }) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => active(l) && KEY.test(l)); // a primeira linha de cada opção é a que vale
  const val = i >= 0 ? KEY.exec(lines[i])[1].toLowerCase() : '';
  const uiOn = val === 'map' || val === 'uhud';
  if (lines.some((l) => active(l) && MAP_KEY.test(l))) return { text, prev: null, changed: false, uiOn: false, why: 'mapa escolhido pelo jogador' };
  if (on) {
    if (uiOn) return { text, prev, changed: false, uiOn: true };
    const before = i >= 0 ? lines[i] : '';
    if (i >= 0) lines[i] = UI_LINE;
    else {
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push(UI_LINE, '');
    }
    return { text: lines.join(nl), prev: before, changed: true, uiOn: true };
  }
  if (prev === null || prev === undefined) return { text, prev: null, changed: false, uiOn };
  if (val !== 'map') return { text, prev: null, changed: false, uiOn }; // o jogador mudou depois: fica o dele
  if (prev) lines[i] = prev; else lines.splice(i, 1);
  return { text: lines.join(nl), prev: null, changed: true, uiOn: false }; // o app só troca o que estava em original
}

// "Estradas mais nítidas" (aba Mods do jogo, 12/11): troca as texturas das estradas e briga com as Texturas HD. Com elas
// ligadas, o app grava "road_textures = off" (no PC o jogo liga sozinho; linha ausente = ligada); desligadas, devolve a
// linha que trocou, só se ela continua "off". Mesmas regras da linha do mapa.
const ROAD_LINE = 'road_textures = off';
const ROAD_KEY = /^\s*road_textures\s*=\s*([^\s#;]*)/i;
const OFF = /^(off|0|false|no)$/;
function planRoad(text, { on, prev = null }) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => active(l) && ROAD_KEY.test(l));
  const off = i >= 0 && OFF.test(ROAD_KEY.exec(lines[i])[1].toLowerCase());
  if (on) {
    if (off) return { text, prev, changed: false };
    const before = i >= 0 ? lines[i] : '';
    if (i >= 0) lines[i] = ROAD_LINE;
    else {
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push(ROAD_LINE, '');
    }
    return { text: lines.join(nl), prev: before, changed: true };
  }
  if (prev === null || prev === undefined || !off) return { text, prev: null, changed: false };
  if (prev) lines[i] = prev; else lines.splice(i, 1);
  return { text: lines.join(nl), prev: null, changed: true };
}

// Acha o settings.ini do NFSU2 (pelo começo do arquivo, como a cópia do save) e aplica os dois planos.
// Desiste sem escrever se achar mais de um, se não achar, ou se a procura passar de budgetMs.
async function run({ root, backupDir, on, prev = null, prevRoad = null, budgetMs = 3000 }) {
  const t0 = Date.now();
  const late = () => Date.now() - t0 > budgetMs;
  const found = [];
  for (const f of await saveCopy.listFiles(root)) {
    if (f.size < 20 || f.size > 200000) continue;
    if (late()) return { prev, prevRoad, uiOn: false, why: 'demorou' };
    let head;
    try { head = await saveCopy.readHead(f.path, 32); } catch { continue; }
    if (saveCopy.kindOf(head) === 'settings.ini') found.push(f.path);
  }
  if (found.length !== 1) return { prev, prevRoad, uiOn: false, why: found.length ? 'mais de um settings.ini' : 'sem settings.ini' };
  const file = found[0];
  const text = await fsp.readFile(file, 'latin1'); // byte a byte: o resto do arquivo volta igual
  const ui = plan(text, { on, prev });
  const road = planRoad(ui.text, { on, prev: prevRoad });
  const p = { ...ui, text: road.text, prevRoad: road.prev, roadChanged: road.changed, changed: ui.changed || road.changed };
  if (!p.changed) return { ...p, text: undefined };
  if (late()) return { prev, prevRoad, uiOn: false, why: 'demorou' };
  await fsp.mkdir(backupDir, { recursive: true });
  await fsp.writeFile(path.join(backupDir, BACKUP), text, 'latin1');
  // Grava ao lado da cópia e troca de uma vez: um arquivo pela metade nunca fica no lugar do settings.ini.
  const tmp = path.join(backupDir, `${BACKUP}.novo`);
  await fsp.writeFile(tmp, p.text, 'latin1');
  await fsp.rename(tmp, file);
  return { ...p, text: undefined, file };
}

// ───────────── Modo DirectX 11: gráficos do jogo no mínimo (pedido do Bruno, 08/11) ─────────────
// As opções de Options > Display ficam no registry.txt do jogo, uma por linha ("d g_Nome=valor", como no próprio
// código do jogo: phonegraphics.ts). Ao entrar no modo DirectX 11 (placa fraca ou antiga), o app as põe no mínimo uma
// vez, com o jogo fechado e cópia antes. Resolução e VSync ficam como estão. O jogador pode subir depois no jogo.
const MIN_GRAPHICS = Object.freeze({
  g_CarEnvironmentMapEnable: 0, g_CarEnvironmentMapUpdateData: 0, g_CarShadowEnable: 0, g_CarHeadlightEnable: 0,
  g_CrowdEnable: 0, g_RoadReflectionEnable: 0, g_FogEnable: 0, g_MotionBlurEnable: 0, g_LightStreaksEnable: 0,
  g_LightGlowEnable: 0, g_AnimatedTextureEnable: 0, g_ParticleSystemEnable: 0, g_DepthOfFieldEnable: 0,
  g_WorldLodLevel: 0, g_CarLodLevel: 0, g_OverBrightEnable: 0, g_BleachByPassEnable: 0, g_TintingEnable: 0,
  g_FSAALevel: 0, g_HorizonFogEnable: 0, g_RainEnable: 0, g_TextureFiltering: 0,
});
const DWORD = /^d ([^=\r\n]+)=(\d+)(\r?)$/gm;
const REG_BACKUP = 'registry.txt-antes-do-DirectX-11.txt';
// Só o texto: cada opção trocada onde está; as que faltam entram no fim. changed = algo mudou.
function minGraphicsText(text) {
  const left = new Map(Object.entries(MIN_GRAPHICS).map(([k, v]) => [k.toLowerCase(), [k, v]]));
  let out = text.replace(DWORD, (line, name, _v, cr) => {
    const kv = left.get(name.toLowerCase());
    if (!kv) return line;
    left.delete(name.toLowerCase());
    return `d ${name}=${kv[1]}${cr}`;
  });
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  if (left.size && out && !out.endsWith('\n')) out += nl;
  for (const [k, v] of left.values()) out += `d ${k}=${v}${nl}`;
  return { text: out, changed: out !== text };
}
// Acha o registry.txt do NFSU2 (um só) e grava. done = feito (ou nada a mudar); sem o arquivo (jogo nunca aberto), tenta
// na próxima abertura.
async function minGraphics({ root, backupDir, budgetMs = 3000 }) {
  const t0 = Date.now();
  const found = [];
  for (const f of await saveCopy.listFiles(root)) {
    if (f.size < 20 || f.size > 200000) continue;
    if (Date.now() - t0 > budgetMs) return { done: false, why: 'demorou' };
    let head;
    try { head = await saveCopy.readHead(f.path, 32); } catch { continue; }
    if (saveCopy.kindOf(head) === 'registry.txt') found.push(f.path);
  }
  if (found.length !== 1) return { done: false, why: found.length ? 'mais de um registry.txt' : 'sem registry.txt' };
  const file = found[0];
  const text = await fsp.readFile(file, 'latin1');
  const p = minGraphicsText(text);
  if (!p.changed) return { done: true, changed: false };
  await fsp.mkdir(backupDir, { recursive: true });
  await fsp.writeFile(path.join(backupDir, REG_BACKUP), text, 'latin1');
  const tmp = path.join(backupDir, `${REG_BACKUP}.novo`);
  await fsp.writeFile(tmp, p.text, 'latin1');
  await fsp.rename(tmp, file);
  return { done: true, changed: true, file };
}

// ───────────── Anti-serrilhado do próprio jogo (pedido do Bruno, 10/11) ─────────────
// Desde 08/11 o NFSU2 tem o dele (MSAA 4x): "d g_FSAALevel=1" no registry.txt. Jogador novo no PC começa com ele ligado; a
// quem já jogava, o jogo pergunta uma vez (4294967295 = nunca ligado; phonegraphics.ts do jogo). Com ele ligado, o FXAA
// do app não entra por cima. O app só LÊ: a escolha é do jogador, feita no jogo.
const FSAA = /^d g_FSAALevel=(\d+)\r?$/im;
function gameAaOn(text) {
  const m = FSAA.exec(String(text || ''));
  const v = m ? Number(m[1]) : 0;
  return v >= 1 && v <= 16;
}
// Acha o registry.txt (um só). Devolve o caminho dentro da pasta de dados e se o anti-serrilhado do jogo está ligado.
async function gameAa({ root, budgetMs = 3000 }) {
  const t0 = Date.now();
  const found = [];
  for (const f of await saveCopy.listFiles(root)) {
    if (f.size < 20 || f.size > 200000) continue;
    if (Date.now() - t0 > budgetMs) return null;
    let head;
    try { head = await saveCopy.readHead(f.path, 32); } catch { continue; }
    if (saveCopy.kindOf(head) === 'registry.txt') found.push(f.path);
  }
  if (found.length !== 1) return null;
  return { rel: path.relative(root, found[0]), on: gameAaOn(await fsp.readFile(found[0], 'latin1')) };
}
// Ao abrir o app, antes de tudo: lê só o arquivo achado na abertura anterior (sem procurar na pasta).
// Devolve true/false, ou null se o arquivo mudou de lugar (vale então o que estava guardado).
function gameAaSync(root, rel) {
  if (!rel) return null;
  try {
    const file = path.join(root, rel);
    if (path.relative(root, file).startsWith('..')) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size < 20 || st.size > 200000) return null;
    const text = fs.readFileSync(file, 'latin1');
    return saveCopy.kindOf(Buffer.from(text.slice(0, 32), 'latin1')) === 'registry.txt' ? gameAaOn(text) : null;
  } catch { return null; }
}

module.exports = { plan, planRoad, ROAD_LINE, run, UI_LINE, BACKUP, MIN_GRAPHICS, minGraphicsText, minGraphics, REG_BACKUP, gameAaOn, gameAa, gameAaSync };
