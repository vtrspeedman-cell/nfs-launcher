'use strict';
const fs = require('fs');
const path = require('path');
const combo = require('./combo');

const DEFAULTS = Object.freeze({
  version: 9,
  startFullscreen: false,   // iniciar direto em tela cheia
  showHome: true,           // mostrar tela inicial antes do jogo
  protectFullscreen: true,  // tela cheia = modo protegido
  blockAltSpace: true,      // engole Alt+Espaço durante o jogo (menu do Windows)
  highPriority: true,       // prioridade "acima do normal" para o jogo e a GPU. Ligadas por padrão, menos no DX11 (pedido do Bruno, 06/11)
  showCorner: true,         // botão discreto (semitransparente) sobre o jogo
  prepareGame: true,        // prepara todo o código do jogo ao carregar, em vez de aos poucos na corrida. Vale ao reabrir
  lighterGpu: true,         // tira as checagens de cada comando gráfico (teste; o Chrome não faz isso). Vale ao reabrir
  unblockGpu: false,        // modo DirectX 11, para placa sem DirectX 12. Só oferecido a quem tem erro de WebGPU. Vale ao reabrir
  unblockTried: false,      // o app já tentou o modo DirectX 11 sozinho (tenta uma vez só)
  newDrawing: true,         // Skia Graphite + Delegated Compositing, juntos e ligados por padrão (decisão do Bruno, depois dos logs jogando). Vale ao reabrir
  secureDns: 'off',         // DNS seguro que fez o jogo abrir: fica ligado nas próximas aberturas (fora das configurações)
  antiAlias: true,          // anti-serrilhado do nosso motor (teste). Vale ao reabrir
  imageFilter: true,        // filtro de cor e nitidez sobre a imagem do jogo, ligado por padrão (pedido do Bruno, 08/11: tudo de qualidade ligado). Vale na hora
  imageMode: 'vivido',      // modo do filtro (imageFilter.js)
  hdTextures: true,         // texturas melhores do NFSU2 (pacote do instalador e pasta de mods). Vale ao iniciar ou recarregar o jogo
  texUiPrev: null,          // linha "ui_textures" que o app trocou no settings.ini do jogo (gameSettings.js); null = não trocou
  texUiPrevMod: null,       // o mesmo, no settings.ini do NFSU2 Modded (pasta de dados própria)
  texRoadPrev: null,        // linha "road_textures" que o app trocou (Estradas mais nítidas sai com as Texturas HD)
  texRoadPrevMod: null,
  texParts: {},             // ordem dos mods de cada parte das texturas (texPack.js), ex.: { asfalto: ['nextgen', 'redux'], ceu: [] }; vazio = padrão
  dx11GameMin: false,       // gráficos do jogo no mínimo ainda por fazer (entrou no modo DirectX 11; gameSettings.minGraphics)
  dx11GameMinMod: false,    // o mesmo, no NFSU2 Modded (feito à parte: ele pode ser aberto pela 1ª vez bem depois)
  gameAa: false,            // o anti-serrilhado do próprio NFSU2 estava ligado na última leitura (gameSettings.gameAa): o FXAA não entra por cima
  gameAaMod: false,         // o mesmo, no NFSU2 Modded
  gameReg: '',              // onde fica o registry.txt do NFSU2 dentro da pasta de dados (para ler direto ao abrir)
  gameRegMod: '',           // o mesmo, no NFSU2 Modded
  sounds: true,             // sons nas telas do app (nunca durante o jogo)
  discord: true,            // mostra "Jogando NFS Launcher" no Discord aberto neste PC
  toggleCombo: 'Ctrl+F',    // entra E sai da tela cheia (também sai do modo protegido)
  exitCombo: 'Ctrl+Alt+Shift+P',
  bounds: null,
  maximized: false,
  lang: 'pt',               // idioma do app e das dicas ('pt' ou 'en'), escolhido na tela inicial ou nas configurações
  game: 'nfsu2',            // último jogo iniciado (vem selecionado na tela inicial; 1ª vez: NFSU2)
  crewInvites: 0,           // quantas vezes o START abriu com o convite da equipe (config.CREW_MAX)
});
const { GAME_IDS, SECURE_DNS } = require('./config');
const { MODE_IDS } = require('./imageFilter');
const LANGS = ['pt', 'en'];
const USER_BOOLS = ['startFullscreen', 'highPriority', 'prepareGame', 'lighterGpu', 'unblockGpu', 'newDrawing', 'antiAlias', 'imageFilter', 'hdTextures'];
// Sempre ligadas e fora das configurações (pedido do Bruno): vale também para quem tinha desligado antes.
const ALWAYS_ON = ['showHome', 'protectFullscreen', 'blockAltSpace', 'showCorner', 'sounds', 'discord'];
const BOOLS = [...USER_BOOLS, 'maximized', 'unblockTried', 'dx11GameMin', 'dx11GameMinMod', 'gameAa', 'gameAaMod'];
const OPACITY = (v, d) => (Number.isFinite(v) && v >= 0.3 && v <= 1 ? Math.round(v * 100) / 100 : d);

function sanitizeBounds(b, minW = 640, minH = 360) {
  if (!b || typeof b !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  const out = { x: n(b.x), y: n(b.y), width: n(b.width), height: n(b.height) };
  if (Object.values(out).some((v) => v === null)) return null;
  if (out.width < minW || out.height < minH || out.width > 16000 || out.height > 16000) return null;
  return out;
}
function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULTS };
  for (const k of BOOLS) if (typeof r[k] === 'boolean') out[k] = r[k];
  for (const k of ALWAYS_ON) out[k] = true;
  if (combo.validate(r.toggleCombo).ok) out.toggleCombo = r.toggleCombo;
  if (combo.validate(r.exitCombo).ok) out.exitCombo = r.exitCombo;
  if (out.toggleCombo === out.exitCombo) { out.toggleCombo = DEFAULTS.toggleCombo; out.exitCombo = DEFAULTS.exitCombo; }
  out.bounds = sanitizeBounds(r.bounds);
  if (LANGS.includes(r.lang)) out.lang = r.lang;
  if (MODE_IDS.includes(r.imageMode)) out.imageMode = r.imageMode;
  if (GAME_IDS.includes(r.game)) out.game = r.game;
  if (Object.hasOwn(SECURE_DNS, r.secureDns)) out.secureDns = r.secureDns;
  if (Number.isInteger(r.crewInvites) && r.crewInvites >= 0) out.crewInvites = Math.min(r.crewInvites, 99);
  out.texParts = require('./texPack').sanitizeChoice(r.texParts);
  for (const k of ['texUiPrev', 'texUiPrevMod', 'texRoadPrev', 'texRoadPrevMod']) if (typeof r[k] === 'string' && r[k].length <= 200 && !/[\r\n]/.test(r[k])) out[k] = r[k];
  // Caminho do registry.txt: só pastas e nomes simples, dentro da pasta de dados do jogo.
  for (const k of ['gameReg', 'gameRegMod']) if (typeof r[k] === 'string' && r[k].length <= 200 && /^[\w-]+([\\/][\w.-]+)*$/.test(r[k]) && !r[k].includes('..')) out[k] = r[k];
  // NFSU2 Modded (09/11): quem já estava no modo DirectX 11 recebe os gráficos mínimos nele também, uma vez.
  if (typeof r.dx11GameMinMod !== 'boolean' && out.unblockGpu) out.dx11GameMinMod = true;
  // Preferências de antes da versão 4 guardavam os padrões antigos: 
  // tela cheia Ctrl+Alt+F -> Ctrl+F (só se a pessoa não tinha trocado o atalho).
  if (!(Number(r.version) >= 4)) {
    if (out.toggleCombo === 'Ctrl+Alt+F' && out.exitCombo !== DEFAULTS.toggleCombo) out.toggleCombo = DEFAULTS.toggleCombo;
  }
  // Antes da versão 6, o arquivo guardava Graphite e Delegated separados, ou desligados só por serem o padrão antigo:
  // a opção única passa a ligada uma vez. Depois disso, quem desmarcar continua desmarcado.
  if (!(Number(r.version) >= 6)) out.newDrawing = true;
  // Versão 8 (pedido do Bruno, 06/11): o TexWizard vira o padrão de cada parte que ele tem. Quem tinha aplicado uma
  // escolha (a janela guarda todas as partes, mesmo sem mudar nada) volta ao padrão uma vez; depois, o que escolher fica.
  if (!(Number(r.version) >= 8)) out.texParts = {};
  // Versão 8 (pedido do Bruno, 06/11): Prioridade, Preparar o jogo, Aliviar o processador, desenho novo e FXAA ligados
  // por padrão no DirectX 12; quem tinha o app passa uma vez. No modo DirectX 11, tudo desligado (dx11Basic).
  if (!(Number(r.version) >= 8)) {
    if (out.unblockGpu) return dx11Basic(out);
    for (const k of PERF_ON) out[k] = true;
  }
  // Versão 7: quem já estava no modo DirectX 11 passa uma vez para o jogo "cru" (dx11Basic). Depois, o que religar fica.
  if (!(Number(r.version) >= 7) && out.unblockGpu) return dx11Basic(out);
  // Versão 9 (pedido do Bruno, 08/11): o filtro de imagem também vem ligado. No DirectX 11, só fica desligado o que
  // costuma pesar numa placa fraca (dx11Basic), Prioridade, Preparar o jogo e Aliviar o processador voltam, e os gráficos
  // do jogo vão ao mínimo uma vez. Quem já tinha a versão 9 fica com o que escolheu.
  if (!(Number(r.version) >= 9)) {
    if (out.unblockGpu) return dx11Basic(out);
    out.imageFilter = true;
  }
  return out;
}
// Modo DirectX 11 = placa fraca ou antiga (depois da tela preta numa Intel gen-7). Pedido do Bruno (08/11): ao entrar
// nele, desliga só o que provavelmente traz lag numa placa assim (texturas HD, desenho novo, FXAA e filtro de imagem,
// que pesam na placa de vídeo); Prioridade, Preparar o jogo e Aliviar o processador aliviam o processador e ficam
// ligadas. E os gráficos do próprio jogo vão ao mínimo uma vez (dx11GameMin, feito ao abrir o app). Quem quiser pode
// religar cada opção depois; sair do modo não as liga de volta.
const PERF_ON = ['highPriority', 'prepareGame', 'lighterGpu', 'newDrawing', 'antiAlias'];
const DX11_KEEP = ['highPriority', 'prepareGame', 'lighterGpu'];
const DX11_OFF = ['hdTextures', 'newDrawing', 'antiAlias', 'imageFilter'];
function dx11Basic(cfg) {
  const out = { ...cfg, unblockGpu: true, dx11GameMin: true, dx11GameMinMod: true };
  for (const k of DX11_OFF) out[k] = false;
  for (const k of DX11_KEEP) out[k] = true;
  return out;
}
function load(file) {
  try { return sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return { ...DEFAULTS }; }
}
function save(file, cfg) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}
function applyChange(cfg, key, value) {
  if (USER_BOOLS.includes(key)) {
    if (typeof value !== 'boolean') return { ok: false, error: 'Valor inválido.' };
    if (key === 'unblockGpu' && value && !cfg.unblockGpu) return { ok: true, cfg: dx11Basic(cfg) };
    return { ok: true, cfg: { ...cfg, [key]: value } };
  }
  if (key === 'toggleCombo' || key === 'exitCombo') {
    const v = combo.validate(value);
    if (!v.ok) return { ok: false, error: v.reason };
    const other = key === 'toggleCombo' ? cfg.exitCombo : cfg.toggleCombo;
    if (value === other) return { ok: false, error: 'Os dois atalhos não podem ser iguais.' };
    return { ok: true, cfg: { ...cfg, [key]: value } };
  }
  if (key === 'lang') {
    if (!LANGS.includes(value)) return { ok: false, error: 'Idioma inválido.' };
    return { ok: true, cfg: { ...cfg, lang: value } };
  }
  if (key === 'imageMode') {
    if (!MODE_IDS.includes(value)) return { ok: false, error: 'Modo inválido.' };
    return { ok: true, cfg: { ...cfg, imageMode: value } };
  }
  return { ok: false, error: 'Configuração desconhecida.' };
}
module.exports = { DEFAULTS, LANGS, sanitize, load, save, applyChange, OPACITY, dx11Basic, DX11_OFF, DX11_KEEP, PERF_ON };
