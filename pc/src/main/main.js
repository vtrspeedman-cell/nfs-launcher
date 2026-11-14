'use strict';
const {
  app, BrowserWindow, WebContentsView, Menu, powerSaveBlocker, session, globalShortcut,
  ipcMain, dialog, Notification, net, powerMonitor, screen: displays, shell, nativeImage,
} = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { GAMES, GAME_IDS, isAllowedUrl, isExternalUrl, isLoginUrl, gameOf, startUrlOf, PARTITION, PARTITIONS, TEX_GAMES, SAVE_GAMES } = require('./config');
const settings = require('./settings');
const combo = require('./combo');
const { toChromeUA } = require('./ua');
const imageFilter = require('./imageFilter');
const gpuFallback = require('./gpuFallback');
const { inTopZone } = require('./corner');
const { mayBeShortcut, decideKey, shouldCancelClose, wantAltSpaceCatch, ALT_SPACE_ACCELS } = require('./lockPolicy');
const { allowPermission } = require('./permissions');
const diagnostics = require('./diagnostics');
const crashLog = require('./crashLog');
const custom = require('./custom');
const github = require('./github');
const downloader = require('./downloader');
const { errorKind, offersSecureDns } = require('./connError');
const { SECURE_DNS } = require('./config');
const { Presence } = require('./discord');
const profileLock = require('./profileLock');
const saveCopy = require('./saveCopy');
const modFiles = require('./modFiles');
const cacheClean = require('./cacheClean');
const texPack = require('./texPack');
const gameSettings = require('./gameSettings');

// ───────────────────────── Argumentos de linha de comando ─────────────────────────
const argv = process.argv.slice(1);
// Conferência da montagem: o executável abre, o pacote é aceito e o código carrega. Sai antes de tocar em qualquer dado.
if (argv.includes('--conferir')) app.exit(73);
const SAFE_MODE = argv.includes('--safe-mode');           // ignora "iniciar em tela cheia"
const RESET_SETTINGS = argv.includes('--reset-settings'); // apaga preferências salvas
const DEV = !app.isPackaged && argv.includes('--dev');    // DevTools só no `npm run dev`; o app instalado nunca abre
// O app instalado não aceita depuração remota (daria acesso ao mesmo painel do F12 por fora). As opções --inspect são
// desligadas no próprio executável (electronFuses, no package.json).
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe'].some((s) => app.commandLine.hasSwitch(s))) app.exit(0);
const UNCAPPED = argv.includes('--uncapped');             // FPS sem VSync (teste; pode causar tearing)
// Modo de teste: só o jogo, sem a camada da interface local (para isolar engasgos causados por ela).
const NO_UI_FLAG = '--sem-interface';
const NO_UI = argv.includes(NO_UI_FLAG);

// ───────────────────────── GPU / WebGPU ─────────────────────────
// Mesma configuração gráfica do Chrome: nenhuma flag que mude como os quadros são desenhados ou compostos.
// (A v1.1 usava ignore-gpu-blocklist, zero-copy, rasterização forçada e oclusão desligada; elas desativam
// proteções do Chrome contra bugs de driver e podem causar quadros misturados. Foram removidas.)
// Visibilidade igual ao Chrome: sem foco (mas visível) o jogo roda a 100%; minimizado ou coberto, a página
// fica "escondida" e o próprio jogo decide pela opção background = pause|run do settings.ini.
const sw = (name, value) => app.commandLine.appendSwitch(name, value);
sw('autoplay-policy', 'no-user-gesture-required');  // áudio do jogo sem clique extra (não afeta gráficos)
// O app não mexe no VSync. Só o --uncapped, digitado à mão para diagnóstico, tira o VSync e o limite de FPS.
// O app virou "NFS Launcher" (mais de um jogo), mas a pasta de dados continua a antiga: preferências, login e
// saves de quem já usava não se perdem. Precisa vir antes de qualquer uso do userData.
app.setPath('userData', path.join(app.getPath('appData'), 'NFSU2 Launcher'));
const savedAtStart = RESET_SETTINGS ? settings.DEFAULTS : settings.load(path.join(app.getPath('userData'), 'settings.json'));
const VSYNC_OFF = UNCAPPED;
if (VSYNC_OFF) { sw('disable-frame-rate-limit'); sw('disable-gpu-vsync'); }
if (argv.includes('--unsafe-webgpu')) sw('enable-unsafe-webgpu'); // drivers fora da lista oficial
// "Preparar o jogo ao carregar" (opção, desligada por padrão): o código do jogo é otimizado todo de uma vez, em segundo
// plano, em vez de só quando cada parte é usada. Mais processador nos primeiros segundos, menos trabalho durante a corrida.
const PREPARE_ON = savedAtStart.prepareGame && !SAFE_MODE;
if (PREPARE_ON) sw('js-flags', '--no-wasm-lazy-compilation --no-wasm-dynamic-tiering');
// "Aliviar o processador" (opção de teste, desligada por padrão): o motor gráfico deixa de conferir cada comando do jogo.
// Medido com 1.600 desenhos por quadro: cerca de 10% a menos nesse trabalho. Se o jogo mandar um comando errado, pode travar em vez de só avisar.
const LIGHTER_ON = savedAtStart.lighterGpu && !SAFE_MODE;
if (LIGHTER_ON) sw('enable-dawn-features', 'skip_validation');
// Modo DirectX 11, para placa sem DirectX 12: só com erro de WebGPU (gpuFallback.js). O DX11 está na lista de bloqueio, por isso as duas juntas.
const UNBLOCK_ON = savedAtStart.unblockGpu && !SAFE_MODE;
if (UNBLOCK_ON) sw('disable-dawn-features', 'adapter_blocklist');
if (UNBLOCK_ON) sw('use-webgpu-adapter', 'd3d11');
// Desenho da tela (opções de teste, desligadas por padrão): o que o Chrome liga por teste de campo e o Electron não recebe.
// Medido fora da tela: o desenho novo sem ganho, o Windows juntando a imagem com ~0,3 ms a menos por quadro. Só o F8 no jogo decide.
// Um único switch: appendSwitch repetido sobrescreve o anterior, inclusive o que veio na linha de comando.
// No modo DirectX 11 fica desligado: placa antiga, e esse desenho só foi medido numa RTX 4060.
const NEW_DRAWING_ON = savedAtStart.newDrawing && !SAFE_MODE && !UNBLOCK_ON;
const DRAW_FEATURES = [
  app.commandLine.getSwitchValue('enable-features'),
  NEW_DRAWING_ON && 'SkiaGraphite:dawn_backend_validation/false/dawn_skip_validation/true/dawn_use_persistent_cache/true,SkiaGraphiteWinIntel,DelegatedCompositing',
].filter(Boolean).join(',');
if (NEW_DRAWING_ON) sw('enable-features', DRAW_FEATURES);
// Anti-serrilhado (FXAA) e pacotes de imagem: efeitos do nosso motor (motor/nfs-imagem.wgsl) sobre a imagem pronta,
// escolhidos por CSS no canvas do jogo (imageFilter.js), na hora e por jogo. O motor oficial do `npm start` ignora.
// O NFSU2 tem anti-serrilhado próprio desde 08/11 (MSAA 4x, escolha do jogador no jogo): com ele ligado, o FXAA não
// entra por cima (pedido do Bruno, 10/11). O app só lê essa opção (registry.txt), nunca a muda.
const GAME_AA_KEY = { nfsu2: ['gameAa', 'gameReg'], nfsu2mod: ['gameAaMod', 'gameRegMod'] };

// ───────────────────────── Caminhos ─────────────────────────
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ICON = path.join(RENDERER_DIR, 'icon.png');
const UI_FILE = path.join(RENDERER_DIR, 'ui.html');
const PRELOAD = path.join(__dirname, 'preload.js');
const CORNER = { w: 272, h: 40, margin: 10 }; // início, recarregar, filtro com o nome do modo, tela cheia, configurações
const TITLE_H = 32;
const HINT = { w: 520, h: 86, ms: 6000 }; // faixa "como sair da tela cheia" embaixo dos botões do topo

// ───────────────────────── Estado ─────────────────────────
let cfg = { ...settings.DEFAULTS };
let cfgPath = '';
let win = null;
let gameView = null;   // site do jogo escolhido (sandbox, sem preload)
let uiView = null;     // interface local (tela inicial, configurações, erros, botão discreto)

let gameStarted = false;
let currentGame = null;         // id do jogo aberto (config.GAMES); null antes do START
let screen = 'launcher';        // 'launcher' | 'settings' | 'error' | 'none' (jogando)
let connError = null;
let uiReady = false;
let quitting = false;
let capturing = false;
let wantFullscreen = false;     // tela cheia pedida PELO APP (a do próprio site não trava)
let intentionalLeave = false;
let nativeLocked = null;
let registeredAccel = null;
let retryTimer = null;
let psbId = null;
let lastNotify = 0;
let lastGpuReload = 0;
let fsRetries = [];
let crashes = [];
let customRev = 0;               // muda quando o jogador troca/restaura uma imagem (a interface busca de novo)
let updateInfo = { status: 'idle', version: null }; // 'idle' | 'checking' | 'new' | 'none' | 'error'
let saveCopyInfo = { count: 0, last: 0 };
let playingSince = 0;            // hora em que o jogo aberto começou (aparece no Discord)
const presence = new Presence();
// Registro de quedas (crashLog.js): só no PC, sai no relatório de diagnóstico, nunca é enviado.
const crashFile = () => path.join(app.getPath('userData'), 'quedas.json');
function logCrash(kind, details = {}) {
  try {
    const e = crashLog.entry({
      kind, reason: details.reason, exitCode: details.exitCode, game: currentGame, dx11: UNBLOCK_ON,
      playedMs: gameStarted && playingSince ? Date.now() - playingSince : null,
    });
    crashLog.save(crashFile(), crashLog.add(crashLog.load(crashFile()), e));
  } catch { /* o registro nunca atrapalha o jogo */ }
}

const gameUrl = () => gameOf(currentGame || cfg.game).url;
const isFullscreen = () => !!win && !win.isDestroyed() && win.isFullScreen();
const locked = () => isFullscreen() && wantFullscreen && cfg.protectFullscreen && gameStarted;
// Em janela o topo é a nossa barra; o jogo fica logo abaixo dela. Na tela cheia a barra sai e o jogo ocupa tudo.
const titleH = () => (NO_UI || isFullscreen() ? 0 : TITLE_H);
function gameRect() {
  const b = win.getContentBounds();
  const bar = titleH();
  return { x: b.x, y: b.y + bar, width: b.width, height: b.height - bar };
}

// ───────────────────────── Instância única ─────────────────────────
// Na conferência dos mods nada do app abre (nem a trava, nem a janela): só ela roda e sai.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // RECUPERAÇÃO: abrir o app de novo sai do modo protegido e traz a janela para a frente.
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (locked()) exitProtected();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

// ───────────────────────── Utilidades ─────────────────────────
// Textos do processo principal (avisos e confirmações) no idioma escolhido pelo jogador.
const tr = (pt, en) => (cfg && cfg.lang === 'en' ? en : pt);
function notify(body) {
  try {
    if (Notification.isSupported()) new Notification({ title: 'NFS Launcher', body, silent: true, icon: ICON }).show();
  } catch { /* sem notificação */ }
}
function notifyLocked() {
  const now = Date.now();
  if (now - lastNotify < 4000) return;
  lastNotify = now;
  notify(tr(`Modo protegido ativo. Para sair da tela cheia: ${cfg.toggleCombo} (ou ${cfg.exitCombo})`,
    `Protected mode is on. To leave fullscreen: ${cfg.toggleCombo} (or ${cfg.exitCombo})`));
}
function saveCfg() { settings.save(cfgPath, cfg); }
// Endereço do START. Quando ele leva o convite da equipe, conta mais uma vez (no máximo 2, config.CREW_MAX).
function startUrl(id) {
  const u = startUrlOf(id, cfg.lang, cfg.crewInvites);
  if (u !== gameOf(id).url) { cfg = { ...cfg, crewInvites: cfg.crewInvites + 1 }; saveCfg(); }
  return u;
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  cfg.bounds = win.getNormalBounds();
  cfg.maximized = win.isMaximized();
  saveCfg();
}
function boundsVisible(b) {
  if (!b) return false;
  return displays.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width - 80 && b.x + b.width > w.x + 80 && b.y < w.y + w.height - 80 && b.y + b.height > w.y);
}

// Prioridade do processo do jogo (opcional). O próprio Chromium já põe o processo de GPU em "acima do normal"
// e cuida do renderer (normal visível, baixa escondido), como no Chrome. Por isso o app NUNCA mexe na GPU
// (até a v1.4 a opção desligada rebaixava a GPU para "normal") e, ao desligar a opção, devolve ao renderer
// a prioridade que ele tinha. (Não usa "alta"/"tempo real", que podem deixar o Windows sem resposta.)
let boosted = null; // { pid, from }
function applyPriority() {
  if (process.platform !== 'win32' || !gameView || gameView.webContents.isDestroyed()) return;
  const P = os.constants.priority;
  const pid = gameView.webContents.getOSProcessId();
  if (boosted && (boosted.pid !== pid || !cfg.highPriority)) {
    try { os.setPriority(boosted.pid, boosted.from); } catch { /* processo já encerrado */ }
    boosted = null;
  }
  if (!cfg.highPriority || pid <= 0) return;
  try {
    const now = os.getPriority(pid);
    if (now === P.PRIORITY_LOW) return; // página escondida (minimizada): o Chromium baixou de propósito
    if (!boosted) boosted = { pid, from: now };
    if (now !== P.PRIORITY_ABOVE_NORMAL) os.setPriority(pid, P.PRIORITY_ABOVE_NORMAL);
  } catch { /* sem permissão: ignora */ }
}

// ───────────────────────── Estado enviado à interface ─────────────────────────
function buildState() {
  return {
    screen, gameStarted, connError,
    fullscreen: isFullscreen(),
    locked: locked(),
    settings: {
      startFullscreen: cfg.startFullscreen, showHome: cfg.showHome, protectFullscreen: cfg.protectFullscreen,
      blockAltSpace: cfg.blockAltSpace, highPriority: cfg.highPriority, showCorner: cfg.showCorner,
      toggleCombo: cfg.toggleCombo, exitCombo: cfg.exitCombo, lang: cfg.lang, game: cfg.game,
      prepareGame: cfg.prepareGame, lighterGpu: cfg.lighterGpu, unblockGpu: cfg.unblockGpu, newDrawing: cfg.newDrawing, antiAlias: cfg.antiAlias, imageFilter: cfg.imageFilter, imageMode: cfg.imageMode, hdTextures: cfg.hdTextures, sounds: cfg.sounds, discord: cfg.discord,
    },
    customRev, custom: customFlags(),   // quais jogos têm fundo/capa próprios (as imagens vêm por custom:get)
    update: updateInfo,
    saveCopies: saveCopyInfo,
    lowDiskGb: lowDiskGb(),
    game: currentGame,  // jogo aberto (null antes do START); o último iniciado fica em settings.game
    texturesAvail: !!modsOn, // pacote de texturas carregado (baixado ou pasta de mods)
    texDl: texDlState(),     // o que dá para baixar e o que já está no PC (janela Texturas HD)
    // Partes das texturas (texPack.js): o que cada parte oferece e o que vale agora. null = nenhum mod baixado.
    texParts: texSources ? {
      parts: texPack.PARTS.map((p) => ({ id: p.id, pt: p.pt, en: p.en, mods: texAvail[p.id] })),
      mods: texPack.MODS.filter((m) => texSources[m.id]).map((m) => ({ id: m.id, name: m.name })),
      choice: texPack.effectiveChoice(cfg.texParts, texAvail),
    } : null,
    games: GAME_IDS.map((id) => { const g = GAMES[id]; return { id, short: g.short, name: g.name, disc: g.disc, textures: !!g.textures, saves: !!g.saves, host: new URL(g.url).host }; }),
    fsHint: hintOn, // dica piscando no topo: "para sair da tela cheia: <atalho>"
    // "Preparar o jogo" e "aliviar o processador" só valem ao reabrir (as flags são lidas antes do app iniciar).
    restartNeeded: !SAFE_MODE && (cfg.prepareGame !== PREPARE_ON || cfg.lighterGpu !== LIGHTER_ON || cfg.unblockGpu !== UNBLOCK_ON || (cfg.newDrawing && !cfg.unblockGpu) !== NEW_DRAWING_ON),
    versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome },
  };
}
function sendState() {
  if (uiReady && uiView && !uiView.webContents.isDestroyed()) uiView.webContents.send('state:update', buildState());
}

// ───────────────────────── Disco e cópia do save ─────────────────────────
// Espaço livre no disco do jogo, conferido no máximo uma vez por minuto. O número só aparece com menos de 3 GB, o que o maior jogo baixa.
const LOW_DISK_BYTES = 3 * 1024 ** 3;
let diskCheckedAt = 0;
let diskLow = null;
function lowDiskGb() {
  if (Date.now() - diskCheckedAt < 60000) return diskLow;
  diskCheckedAt = Date.now();
  try {
    const s = fs.statfsSync(app.getPath('userData'));
    const free = s.bavail * s.bsize;
    diskLow = free < LOW_DISK_BYTES ? Math.round(free / 1024 ** 3 * 10) / 10 : null;
  } catch { diskLow = null; }
  return diskLow;
}
// Fora da pasta de dados do jogo: se ela se perder, as cópias continuam.
const saveCopyDir = () => path.join(app.getPath('appData'), 'NFS Launcher Saves');
// Pasta de dados de cada jogo (o NFSU2 Modded tem a dele; os outros dividem a do NFSU2).
const gameFsRoot = (partition = PARTITION) => path.join(app.getPath('userData'), 'Partitions', partition.replace('persist:', ''), 'File System');
// Cópias do NFSU2 Modded numa subpasta própria: a "última cópia" de cada site não se confunde com a do outro.
const savesDirOf = (id) => (GAMES[id].savesDir ? path.join(saveCopyDir(), GAMES[id].savesDir) : saveCopyDir());
// O que o app guarda por jogo nas preferências: a linha que trocou no settings.ini e o "gráficos no mínimo" a fazer.
const TEX_PREV_KEY = { nfsu2: 'texUiPrev', nfsu2mod: 'texUiPrevMod' };
const ROAD_PREV_KEY = { nfsu2: 'texRoadPrev', nfsu2mod: 'texRoadPrevMod' }; // "Estradas mais nítidas" desligada pelo app
const DX11_MIN_KEY = { nfsu2: 'dx11GameMin', nfsu2mod: 'dx11GameMinMod' };

// Texturas HD (gameSettings.js): com a opção ligada, deixa "ui_textures = map" no settings.ini do jogo, para o pacote
// entrar sem o jogador ligar nada; desligada, desfaz só o que o app trocou. Antes de o navegador abrir os dados.
// Cada NFSU2 (o do site principal e o Modded) tem o seu settings.ini, na sua pasta.
const texUiOnBy = {};  // id -> o jogo vai carregar o pacote de mapa (falso: ligar Texturas HD só vale reabrindo o app)
let texUiNote = '';    // vai para o registro dos mods
async function texturesSettingAtStart() {
  // Sem pacote (instalado sem as texturas, escolha do instalador): só desfaz a linha que o app tinha gravado antes,
  // para o jogo não continuar carregando o mapa detalhado do site num PC que escolheu ficar sem texturas.
  const hasPack = fs.existsSync(modsDir()) || texPack.MOD_IDS.some((id) => fs.existsSync(path.join(texSourcesDir(), `${id}.pak`)));
  const notes = [];
  for (const id of TEX_GAMES) {
    const key = TEX_PREV_KEY[id];
    const roadKey = ROAD_PREV_KEY[id];
    texUiOnBy[id] = true;
    if (SAFE_MODE || !key || (!hasPack && cfg[key] === null && cfg[roadKey] === null)) continue;
    const on = cfg.hdTextures && hasPack;
    try {
      const r = await gameSettings.run({ root: gameFsRoot(GAMES[id].partition), backupDir: savesDirOf(id), on, prev: cfg[key], prevRoad: cfg[roadKey] });
      // Só pede para reabrir quando reabrir resolve: com o mapa escolhido pelo jogador ou sem achar o arquivo certo, não.
      texUiOnBy[id] = !!r.uiOn || (!!r.why && r.why !== 'sem settings.ini');
      notes.push(`settings.ini do ${GAMES[id].short}: ${r.changed ? (on ? `"${gameSettings.UI_LINE}" gravada` : 'linha do app desfeita') : 'sem mudança'}${r.why ? ` (${r.why})` : ''}`);
      if (r.roadChanged) notes.push(`settings.ini do ${GAMES[id].short}: ${on ? `"${gameSettings.ROAD_LINE}" gravada` : 'estradas do jogo devolvidas'}`);
      if (r.prev !== cfg[key] || r.prevRoad !== cfg[roadKey]) { cfg = { ...cfg, [key]: r.prev, [roadKey]: r.prevRoad }; saveCfg(); }
    } catch (e) {
      notes.push(`settings.ini do ${GAMES[id].short}: não deu para conferir (${e && e.message})`);
    }
  }
  texUiNote = notes.join('; ');
}
// Modo leve (pedido do Bruno, 14/11): mods pesados do jogo e o anti-serrilhado dele desligados (gameSettings.lightMode);
// desligado, devolve só o que o app trocou e continua como o app deixou.
const LIGHT_PREV_KEY = { nfsu2: 'lightPrev', nfsu2mod: 'lightPrevMod' };
let lightNote = '';
async function lightModeAtStart() {
  const notes = [];
  for (const id of TEX_GAMES) {
    const key = LIGHT_PREV_KEY[id];
    if (SAFE_MODE || !key || (!cfg.lightMode && !cfg[key])) continue;
    try {
      const r = await gameSettings.lightMode({ root: gameFsRoot(GAMES[id].partition), backupDir: savesDirOf(id), on: cfg.lightMode, prev: cfg[key] });
      notes.push(`modo leve no ${GAMES[id].short}: ${r.changed ? (cfg.lightMode ? 'mods pesados desligados' : 'opções do jogo devolvidas') : 'sem mudança'}${r.why ? ` (${r.why})` : ''}`);
      if (JSON.stringify(r.prev) !== JSON.stringify(cfg[key])) { cfg = { ...cfg, [key]: r.prev }; saveCfg(); }
    } catch (e) {
      notes.push(`modo leve no ${GAMES[id].short}: não deu para conferir (${e && e.message})`);
    }
  }
  lightNote = notes.join('; ');
}
// Modo DirectX 11 (pedido do Bruno, 08/11): uma vez, com o jogo fechado, os gráficos do próprio jogo vão ao mínimo
// (registry.txt, gameSettings.minGraphics). Sem o arquivo ainda (jogo nunca aberto), tenta na próxima abertura.
// Um pedido por jogo: o NFSU2 Modded pode ser aberto pela 1ª vez bem depois do NFSU2.
let dx11MinApplied = false;
async function dx11MinAtStart() {
  if (SAFE_MODE || !UNBLOCK_ON) return;
  for (const id of TEX_GAMES) {
    const key = DX11_MIN_KEY[id];
    if (!key || !cfg[key]) continue;
    try {
      const r = await gameSettings.minGraphics({ root: gameFsRoot(GAMES[id].partition), backupDir: savesDirOf(id) });
      if (r.done) { cfg = { ...cfg, [key]: false }; saveCfg(); dx11MinApplied = dx11MinApplied || !!r.changed; }
    } catch { /* tenta na próxima abertura */ }
  }
}
// Anti-serrilhado do próprio jogo (gameSettings.gameAa): guarda se está ligado e onde fica o registry.txt, para a próxima
// abertura decidir o FXAA sem procurar na pasta. Só leitura; não segura a abertura.
async function gameAaAtStart() {
  for (const id of TEX_GAMES) {
    const k = GAME_AA_KEY[id];
    if (!k) continue;
    try {
      const r = await gameSettings.gameAa({ root: gameFsRoot(GAMES[id].partition) });
      if (r && (r.on !== cfg[k[0]] || r.rel !== cfg[k[1]])) { cfg = { ...cfg, [k[0]]: r.on, [k[1]]: r.rel }; saveCfg(); }
    } catch { /* fica o que estava */ }
  }
}
function dx11Warning() {
  dialog.showMessageBox(win, {
    type: 'info', buttons: ['OK'], noLink: true, title: tr('Modo DirectX 11', 'DirectX 11 mode'),
    message: tr('Os gráficos do jogo foram colocados no mínimo.', 'The game graphics were set to the minimum.'),
    detail: tr('Sua placa de vídeo usa o modo DirectX 11. Para rodar melhor, o app desligou as opções que pesam e colocou os gráficos do jogo no mínimo. Se a tela do jogo ficar preta, diminua mais os gráficos do jogo (Options > Display) até a imagem carregar. Se estiver rodando bem, pode subir aos poucos.',
      'Your graphics card uses DirectX 11 mode. To run better, the app turned off the heavy options and set the game graphics to the minimum. If the game screen goes black, lower the game graphics further (Options > Display) until the picture loads. If it runs well, you can raise them little by little.'),
  }).catch(() => {});
}
// Antes de o navegador abrir os dados do jogo. Disco muito lento não segura a abertura: a cópia termina sozinha logo depois.
// Uma cópia por site (NFSU2 em "NFS Launcher Saves", o Modded na subpasta dele); a tela mostra a do NFSU2.
async function copySaveAtStart() {
  const job = Promise.all(SAVE_GAMES.map((id) => saveCopy.run({ root: gameFsRoot(GAMES[id].partition), dest: savesDirOf(id) }).catch(() => null)))
    .then(() => saveCopy.info(saveCopyDir()))
    .then((i) => { saveCopyInfo = i; sendState(); })
    .catch(() => {});
  await Promise.race([job, new Promise((r) => setTimeout(r, 2000))]);
}

// ───────────────────────── Mods de textura do NFSU2 (modFiles.js) ─────────────────────────
// Duas fontes: os pacotes baixados pelo app (um de cada mod, texPack.js, juntados na hora conforme as partes
// escolhidas) e a pasta do jogador com a mesma árvore do jogo (%APPDATA%\NFS Launcher Mods\NFSU2, ex.:
// TEXPACKS\detailed.pak), que vale por cima. Sem nenhuma: nada muda, nenhum pedido passa pelo app.
// Com mods, os pedidos do site passam pelo app só enquanto o NFSU2 está aberto (openSite).
const modsDir = () => path.join(app.getPath('appData'), 'NFS Launcher Mods', 'NFSU2');
// Desde a 3.0.3 (pedido do Bruno, 08/11): as texturas não vêm no instalador; o jogador baixa cada mod pelo app
// (GitHub, pc/texturas.json) e elas ficam aqui, fora da pasta do programa (atualizar o app não as apaga).
const texSourcesDir = () => path.join(app.getPath('userData'), 'texturas');
let texSources = null; // { site, redux, definitive, nextgen } presentes (null = nenhum mod instalado)
let texAvail = {};     // parte -> mods que têm texturas nela
function loadTexSources() {
  if (SAFE_MODE || !fs.existsSync(texSourcesDir())) return;
  const s = texPack.findSources(texSourcesDir(), (t) => modLog(t));
  if (!texPack.MOD_IDS.some((id) => s[id])) return; // só o mapa do site: é o que o jogo já tem, nada a fazer
  texSources = s;
  texAvail = texPack.partsAvailable(s);
}
// Pacote virtual (TEXPACKS/detailed.pak) com a escolha atual, ou nenhum.
function texVirtualMods() {
  if (!texSources) return [];
  try {
    const v = texPack.virtualMod(texSources, cfg.texParts);
    modLog(`texturas por partes: ${JSON.stringify(v.virtual.eff)}, ${v.virtual.count} texturas ${JSON.stringify(v.virtual.counts)}`);
    return [v];
  } catch (e) { modLog(`não deu para montar as texturas: ${e && e.message}`); return []; }
}
// Mods do jogador (pasta própria) valem por cima dos do app, pelo caminho.
function allMods() {
  const by = new Map();
  for (const m of [...texVirtualMods(), ...modFiles.scanAll([modsDir()])]) by.set(m.p.toLowerCase(), m);
  return [...by.values()];
}
// Os mods passam pela sessão de cada jogo com texturas (o NFSU2 e o Modded têm pastas de dados, e sessões, separadas).
// Em cada sessão, só os pedidos do próprio site do jogo; o Most Wanted e o Carbon, que dividem a sessão do NFSU2,
// nunca passam pelo app.
const texAllowed = (partition) => (u) => TEX_GAMES.some((id) => GAMES[id].partition === partition && isAllowedUrl(u, id));
const isTexUrl = (u) => TEX_GAMES.some((id) => isAllowedUrl(u, id));
const gameSessions = new Map(); // partição -> sessão do jogo
// Um modFiles.install por sessão, por trás de um objeto só: setMods vale para todas; active(url) liga só a sessão
// cujo site é o que está abrindo, e só com "Texturas HD" ligada.
function installMods(mods) {
  const hs = [];
  for (const [p, ses] of gameSessions) {
    if (!TEX_GAMES.some((id) => GAMES[id].partition === p)) continue;
    const allowed = texAllowed(p);
    const h = modFiles.install(ses, { mods, allowed, log: modLog });
    if (h) hs.push({ h, allowed });
  }
  if (!hs.length) return null;
  return {
    setMods: (m) => { for (const x of hs) x.h.setMods(m); },
    active: (url) => { for (const x of hs) x.h.active(cfg.hdTextures && x.allowed(url)); },
  };
}
let modsOn = null; // installMods (null = sem mods)
let texReturn = null; // tela de onde a janela de texturas foi aberta (Voltar/Aplicar voltam para ela)
// Registro curto do que houve com os mods (refeito a cada abertura, no máximo 300 linhas): NFS Launcher Mods\registro.txt
// para quem tem a pasta; senão (ou se ela não aceitar gravação), na pasta temporária (nfs-mods-registro.txt).
let modLogLines = 0;
let modLogFile = null;
function modLog(text) {
  if (!modLogFile || modLogLines++ > 300) return;
  try { fs.appendFileSync(modLogFile, `${new Date().toLocaleTimeString()} ${text}\r\n`); } catch { /* sem como gravar: segue */ }
}
function setupMods() {
  const dir = modsDir();
  const userHas = fs.existsSync(path.dirname(dir));
  if (!userHas && !fs.existsSync(texSourcesDir())) return; // nada a fazer nem a registrar
  const head = `NFS Launcher ${app.getVersion()}, aberto ${new Date().toLocaleString()}\r\n`;
  for (const f of [userHas && path.join(dir, '..', 'registro.txt'), path.join(os.tmpdir(), 'nfs-mods-registro.txt')].filter(Boolean)) {
    try { fs.writeFileSync(f, head); modLogFile = f; break; } catch { /* tenta o próximo */ }
  }
  if (SAFE_MODE) { modLog('modo seguro: mods desligados'); return; }
  if (texUiNote) modLog(texUiNote);
  if (lightNote) modLog(lightNote);
  loadTexSources();
  const mods = allMods();
  modLog(`baixadas em ${texSourcesDir()}, do jogador ${dir}: ${mods.length} arquivo(s)`);
  if (!mods.length) return;
  modsOn = installMods(mods);
}
// Texturas baixadas ou removidas com o app aberto: monta de novo e vale na próxima vez que o jogo carregar.
function reloadTextures() {
  if (SAFE_MODE) return;
  texSources = null;
  texAvail = {};
  loadTexSources();
  const mods = allMods();
  if (modsOn) modsOn.setMods(mods);
  else if (mods.length && gameSessions.size) {
    modsOn = installMods(mods);
    if (modsOn && gameStarted) modsOn.active(gameView.webContents.getURL());
  }
  refresh();
}

// ───────────────────────── Baixar texturas (GitHub, pc/texturas.json) ─────────────────────────
// Pedido do Bruno (08/11): as texturas saíram do instalador. Na janela "Texturas HD", cada mod tem Baixar e Remover;
// o mapa detalhado do site vem junto com o primeiro mod (o pacote do jogo precisa dele). Cada arquivo só vale com o
// SHA-256 publicado; Remover manda para a Lixeira.
const TEX_IDS = [texPack.SITE, ...texPack.MOD_IDS];
let texOffer = {};           // id -> { url, size, sha256 } publicados
let texOfferStatus = 'idle'; // 'idle' | 'checking' | 'ok' | 'error'
let texJob = null;           // { id, pct, ctl } download em andamento
let texError = null;
const texFile = (id) => path.join(texSourcesDir(), `${id}.pak`);
async function loadTexOffer() {
  if (texOfferStatus === 'checking') return;
  texOfferStatus = 'checking';
  sendState();
  try { texOffer = github.texturesList(await fetchJson(github.TEXTURES_URL), TEX_IDS); texOfferStatus = 'ok'; } catch { texOfferStatus = 'error'; }
  sendState();
}
function texDlState() {
  const files = TEX_IDS.map((id) => {
    const have = fs.existsSync(texFile(id));
    const o = texOffer[id];
    const mod = texPack.MODS.find((m) => m.id === id);
    return { id, name: mod ? mod.name : null, have, size: o ? o.size : null, offered: !!o, outdated: have && !!o && downloader.savedSha(texFile(id)) !== o.sha256 };
  });
  return { status: texOfferStatus, files, job: texJob && { id: texJob.id, pct: texJob.pct }, error: texError };
}
async function downloadTextures(id) {
  if (!texPack.MOD_IDS.includes(id)) return { ok: false, error: tr('Mod desconhecido.', 'Unknown mod.') };
  if (texJob) return { ok: false, error: tr('Espere o download que está em andamento.', 'Wait for the download in progress.') };
  if (texOfferStatus !== 'ok') await loadTexOffer();
  if (!texOffer[id]) return { ok: false, error: tr('Não deu para achar esse mod agora (sem internet?).', 'Could not find this mod now (no internet?).') };
  const need = [texPack.SITE, id].filter((x) => texOffer[x] && (!fs.existsSync(texFile(x)) || downloader.savedSha(texFile(x)) !== texOffer[x].sha256));
  texError = null;
  try {
    for (const x of need) {
      const o = texOffer[x];
      texJob = { id: x, pct: 0, ctl: new AbortController() };
      sendState();
      let last = 0;
      await downloader.download({
        url: o.url, dest: texFile(x), size: o.size, sha256: o.sha256, fetch: net.fetch, signal: texJob.ctl.signal,
        onProgress: (have, total) => { const now = Date.now(); if (now - last < 300) return; last = now; texJob.pct = Math.floor(have / total * 100); sendState(); },
      });
    }
  } catch (e) {
    texError = e && e.name === 'AbortError' ? null : tr('O download falhou. Confira a internet e tente de novo: ele continua de onde parou.', 'The download failed. Check the internet and try again: it resumes where it stopped.');
    return { ok: false, error: texError || '' };
  } finally { texJob = null; sendState(); }
  reloadTextures();
  if (texSources) askTexturesRestart(); // o jogo aberto só pega as texturas ao carregar de novo
  return { ok: true };
}
async function removeTextures(id) {
  if (!texPack.MOD_IDS.includes(id) || (texJob && texJob.id === id)) return { ok: false, error: tr('Não dá para remover agora.', 'Cannot remove now.') };
  const left = texPack.MOD_IDS.filter((m) => m !== id && fs.existsSync(texFile(m)));
  try {
    for (const x of left.length ? [id] : [id, texPack.SITE]) { // sem mod nenhum, o mapa do site também sai
      for (const f of [texFile(x), downloader.shaFileOf(texFile(x)), downloader.partOf(texFile(x))]) if (fs.existsSync(f)) await shell.trashItem(f);
    }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  reloadTextures();
  if (gameStarted && gameOf(currentGame).textures) askTexturesRestart(true);
  return { ok: true };
}

// ───────────────────────── Personalização: fundo e capa de cada jogo ─────────────────────────
const customDir = () => path.join(app.getPath('userData'), 'custom');
function customFlags() {
  const out = {};
  for (const id of GAME_IDS) out[id] = { bg: fs.existsSync(custom.fileFor(customDir(), id, 'bg')), disc: fs.existsSync(custom.fileFor(customDir(), id, 'disc')) };
  return out;
}
// Escolher uma imagem do PC. Ela é decodificada e REGRAVADA pelo app (JPG para fundo, PNG quadrado para capa):
// o que fica guardado é sempre uma imagem limpa, no tamanho certo, nunca o arquivo original.
async function pickCustom(gameId, kind) {
  if (!custom.valid(gameId, kind)) return { ok: false, error: tr('Opção inválida.', 'Invalid option.') };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: kind === 'bg' ? tr('Escolher a imagem de fundo', 'Choose the background image') : tr('Escolher a capa (CD)', 'Choose the cover (disc)'),
    properties: ['openFile'],
    filters: [{ name: tr('Imagens PNG ou JPG', 'PNG or JPG images'), extensions: custom.EXTS }],
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, error: 'Cancelado.' };
  const src = filePaths[0];
  const bad = { ok: false, error: tr('Não deu para abrir essa imagem. Use um arquivo PNG ou JPG.', 'Could not open this image. Use a PNG or JPG file.') };
  try {
    if (!custom.extOk(src)) return bad;
    if (fs.statSync(src).size > custom.MAX_BYTES) return { ok: false, error: tr('Imagem grande demais (máximo 30 MB).', 'Image too large (30 MB max).') };
    let img = nativeImage.createFromPath(src);
    if (img.isEmpty()) return bad;
    const { width, height } = img.getSize();
    const K = custom.KINDS[kind];
    let data;
    if (kind === 'bg') {
      data = img.resize({ ...custom.fitWithin(width, height, K.maxW, K.maxH), quality: 'best' }).toJPEG(88);
    } else {
      img = img.crop(custom.squareCrop(width, height));
      data = img.resize({ width: K.size, height: K.size, quality: 'best' }).toPNG();
    }
    fs.mkdirSync(customDir(), { recursive: true });
    fs.writeFileSync(custom.fileFor(customDir(), gameId, kind), data);
    customRev++;
    refresh();
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
}
function resetCustom(gameId, kind) {
  if (!custom.valid(gameId, kind)) return { ok: false, error: tr('Opção inválida.', 'Invalid option.') };
  try { fs.rmSync(custom.fileFor(customDir(), gameId, kind), { force: true }); } catch (err) { return { ok: false, error: String(err.message || err) }; }
  customRev++;
  refresh();
  return { ok: true };
}
// As imagens vão para a interface como data: (a CSP da página local só aceita 'self' e data:).
function customImages() {
  const out = {};
  for (const id of GAME_IDS) {
    out[id] = {};
    for (const kind of Object.keys(custom.KINDS)) {
      const f = custom.fileFor(customDir(), id, kind);
      try { out[id][kind] = `data:image/${kind === 'bg' ? 'jpeg' : 'png'};base64,${fs.readFileSync(f).toString('base64')}`; } catch { out[id][kind] = null; }
    }
  }
  return out;
}

// ───────────────────────── Atualização automática (GitHub, github.js) ─────────────────────────
// Pedido do Bruno (08/11): o app se atualiza sozinho. Ao abrir, ao voltar à tela inicial e de hora em hora fora do jogo,
// lê pc/atualizacao.json do repositório. Versão nova: baixa o instalador em segundo plano (nunca durante o jogo: para
// e continua depois de onde parou), confere o SHA-256 e mostra "Atualizar agora" na tela inicial. Se o jogador
// fechar o app sem clicar, a atualização é instalada ao fechar, sem abrir nada. Nada do PC é enviado.
const UPDATE_EVERY_MS = 60 * 60 * 1000;
let updateTimer = null;
let updateChecking = false;
let updateCtl = null;   // download em andamento
let updateFile = null;  // instalador baixado e conferido
let updateSpawned = false;
const updateDir = () => path.join(app.getPath('userData'), 'atualizacao');
async function fetchJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await net.fetch(url, { signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
// Só o instalador da versão nova fica na pasta; os antigos (já instalados ou trocados) saem.
function cleanUpdateDir(keep) {
  let list = [];
  try { list = fs.readdirSync(updateDir()); } catch { return; }
  for (const f of list) {
    if (keep && (f === path.basename(keep) || f.startsWith(`${path.basename(keep)}.`))) continue;
    try { fs.rmSync(path.join(updateDir(), f), { force: true }); } catch { /* em uso: fica para a próxima */ }
  }
}
async function checkUpdates(manual) {
  if (updateChecking || ['downloading', 'ready'].includes(updateInfo.status)) { if (updateInfo.status === 'new') downloadUpdate(); return updateInfo; }
  updateChecking = true;
  const known = updateInfo.status === 'new' ? updateInfo : null;
  if (!known) { updateInfo = { status: 'checking', version: null }; sendState(); }
  try {
    const u = github.newerApp(await fetchJson(github.UPDATE_URL), app.getVersion());
    updateInfo = u ? { status: 'new', version: u.version, notes: u.notes, pct: 0, info: u } : { status: 'none', version: null };
    if (!u) cleanUpdateDir(null);
  } catch {
    updateInfo = known || { status: 'error', version: null };
  } finally { updateChecking = false; }
  sendState();
  if (updateInfo.status === 'new') downloadUpdate();
  return updateInfo;
}
async function downloadUpdate() {
  if (updateCtl || gameStarted || updateInfo.status !== 'new' || !updateInfo.info) return;
  const u = updateInfo.info;
  const dest = path.join(updateDir(), `NFS-Launcher-Setup-${u.version}.exe`);
  cleanUpdateDir(dest);
  updateCtl = new AbortController();
  updateInfo = { ...updateInfo, status: 'downloading' };
  let last = 0;
  try {
    await downloader.download({
      url: u.url, dest, size: u.size, sha256: u.sha256, fetch: net.fetch, signal: updateCtl.signal,
      onProgress: (have, total) => {
        const now = Date.now();
        if (now - last < 400) return;
        last = now;
        updateInfo = { ...updateInfo, pct: Math.floor(have / total * 100) };
        sendState();
      },
    });
    updateFile = dest;
    updateInfo = { ...updateInfo, status: 'ready', pct: 100 };
    if (screen === 'none') notify(tr(`A versão ${u.version} do NFS Launcher está pronta. Ela é instalada quando você fechar o app.`, `NFS Launcher ${u.version} is ready. It installs when you close the app.`));
  } catch (e) {
    // Parou por causa do jogo (ou da rede): continua de onde parou na próxima verificação.
    updateInfo = { ...updateInfo, status: 'new', failed: !(e && e.name === 'AbortError') };
  } finally { updateCtl = null; sendState(); }
}
function pauseUpdateDownload() { if (updateCtl) updateCtl.abort(); }
// Roda o instalador baixado sem janelas (/S). --updated: o instalador espera o app fechar (installer.nsh);
// --force-run: abre o app de novo no fim (só no "Atualizar agora").
function installUpdate(reopen) {
  // Só o app instalado se atualiza: npm start e o motor de treino nunca instalam por cima do app do Bruno.
  if (!app.isPackaged || !updateFile || updateSpawned || !fs.existsSync(updateFile)) return false;
  try {
    const { spawn } = require('child_process');
    spawn(updateFile, ['/S', '--updated', ...(reopen ? ['--force-run'] : [])], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    updateSpawned = true;
    return true;
  } catch { return false; }
}

// ───────────────────────── Layout das views ─────────────────────────
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const bar = titleH();
  gameView.setBounds({ x: 0, y: bar, width, height: height - bar });
  if (screen === 'none' && bar) {
    uiView.setBounds({ x: 0, y: 0, width, height: bar }); // só a barra: nada fica por cima do jogo
  } else if (screen === 'none') {
    // Com a dica de tela cheia piscando, a área cresce para caber a faixa de texto embaixo dos botões.
    const w = hintOn ? HINT.w : CORNER.w;
    const h = hintOn ? HINT.h : CORNER.h;
    // No meio do topo: o jogo limita o mouse e ele não chega aos cantos da tela.
    uiView.setBounds({ x: Math.round((width - w) / 2), y: CORNER.margin, width: w, height: h });
  } else {
    uiView.setBounds({ x: 0, y: 0, width, height });
  }
}

// Camada nativa: com o "Fechar" desabilitado, o próprio Windows ignora Alt+F4 e o item Fechar do menu do sistema.
function applyNativeLock(on) {
  if (nativeLocked === on || !win || win.isDestroyed()) return;
  nativeLocked = on;
  try { win.setClosable(!on); win.setMinimizable(!on); } catch { /* ignora */ }
}

// Atalho GLOBAL de saída: registrado somente enquanto o modo protegido está ativo.
function syncGlobalShortcut(on) {
  const accel = combo.toAccelerator(cfg.exitCombo);
  if (registeredAccel && (!on || registeredAccel !== accel)) {
    try { globalShortcut.unregister(registeredAccel); } catch { /* ignora */ }
    registeredAccel = null;
  }
  if (on && !registeredAccel) {
    try { if (globalShortcut.register(accel, exitProtected)) registeredAccel = accel; } catch { /* ignora */ }
  }
}

function refresh() {
  if (!win || win.isDestroyed()) return;
  const isLocked = locked();
  // Em janela, os botões ficam na barra do topo. Na tela cheia:
  // botão discreto, que aparece só com o cursor no meio do topo (também no modo protegido, para sair da tela cheia).
  // Exceção: a dica de como sair da tela cheia pisca alguns segundos quando ele sai do jogo (tecla Windows, Alt+Tab) e quando volta.
  const showUi = !NO_UI && (screen !== 'none' || (gameStarted && (titleH() > 0 || hintOn || (cfg.showCorner && cornerHot))));
  gameView.setVisible(gameStarted);
  uiView.setVisible(showUi);
  syncIdentity();
  applyNativeLock(isLocked); // antes do layout: trocar o estilo muda o tamanho do conteúdo (a moldura invisível entra na conta)
  layout();
  syncGlobalShortcut(isLocked);
  syncAltSpaceCatch();
  sendState();
  syncCornerPoller();
  if (win.isFocused()) focusedView().webContents.focus();
}
// Nome do jogo aberto no título da janela (barra de tarefas e Alt+Tab) e no Discord.
function syncIdentity() {
  const g = gameStarted ? gameOf(currentGame) : null;
  if (!NO_UI) {
    const title = g ? g.name : 'NFS Launcher';
    if (win.getTitle() !== title) win.setTitle(title);
  }
  presence.set(g && g.discordId && cfg.discord ? {
    clientId: g.discordId, details: g.short, title: g.name, start: playingSince,
    linkLabel: tr('Baixar o NFS Launcher', 'Download NFS Launcher'), linkUrl: github.RELEASES_URL,
  } : null);
}
function focusedView() { return NO_UI || screen === 'none' ? gameView : uiView; }
function setScreen(s) { screen = s; refresh(); }
// Janela de texturas aberta pelas Configurações volta para elas; pelo botão da barra, para o jogo.
const texBackScreen = () => (texReturn === 'settings' ? 'settings' : backScreen());
// Para onde "Voltar" leva: o jogo (ou o erro/carregamento dele) se já foi iniciado, senão a tela inicial.
function backScreen() {
  if (!gameStarted) return 'launcher';
  return connError ? 'error' : gameLoading ? 'loading' : 'none';
}

// Dica "como sair da tela cheia": pisca no meio do topo (onde ficam os botões) por alguns segundos quando o jogador
// sai do jogo em tela cheia (tecla Windows, Alt+Tab, tentar minimizar) e quando volta para ele.
let hintOn = false;
let hintTimer = null;
let leftInFullscreen = false;
function flashFsHint() {
  if (NO_UI || !gameStarted || screen !== 'none' || !isFullscreen() || !win || win.isDestroyed()) return;
  hintOn = true;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hintOn = false; refresh(); }, HINT.ms);
  refresh();
}

// O processo principal olha a posição do cursor (5x por segundo, custo desprezível) só enquanto o jogo roda
// com o botão ligado. Nada é injetado na página do jogo.
let cornerHot = false;
let cornerTimer = null;
function syncCornerPoller() {
  const need = !NO_UI && !!win && !win.isDestroyed() && gameStarted && screen === 'none' && cfg.showCorner && isFullscreen();
  if (need && !cornerTimer) cornerTimer = setInterval(checkCorner, 200);
  if (!need && cornerTimer) { clearInterval(cornerTimer); cornerTimer = null; cornerHot = false; }
}
function checkCorner() {
  if (!win || win.isDestroyed() || win.isMinimized() || !win.isVisible()) return;
  const hot = inTopZone(displays.getCursorScreenPoint(), win.getContentBounds());
  if (hot !== cornerHot) { cornerHot = hot; refresh(); }
}

// ───────────────────────── Ações ─────────────────────────
function enterFullscreen() { if (!win) return; wantFullscreen = true; win.setFullScreen(true); }
function exitFullscreen() { if (!win) return; wantFullscreen = false; intentionalLeave = true; win.setFullScreen(false); }
function toggleFullscreen() { if (isFullscreen()) exitFullscreen(); else enterFullscreen(); }
function exitProtected() {
  if (!locked()) return;
  exitFullscreen();
  notify(tr('Modo protegido desativado.', 'Protected mode turned off.'));
}
function quitApp() { quitting = true; applyNativeLock(false); app.quit(); }
// Reabrir o app (opções que só valem ao abrir): a atualização pronta não é instalada nessa saída.
let relaunching = false;
function relaunchApp() { relaunching = true; app.relaunch({ args: process.argv.slice(1) }); quitApp(); }

// Tela "Carregando…" entre o clique e a página do site aparecer (antes ficava uma tela preta).
// Sai no dom-ready da página, num erro ou em 20 s; depois disso nada do app fica por cima do jogo.
let gameLoading = false;
let loadingTimer = null;
function beginLoading() {
  gameLoading = true;
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(endLoading, 20000);
}
function endLoading() {
  reloadConfirmed = false;
  clearTimeout(loadingTimer);
  loadingTimer = null;
  if (!gameLoading) return;
  gameLoading = false;
  if (screen === 'loading') { screen = 'none'; refresh(); }
}

// O anti-serrilhado do próprio jogo está ligado? Lê o registry.txt achado na abertura do app (só leitura, um arquivo);
// se ele mudou de lugar, vale o que estava guardado.
function gameAaNow(id) {
  const k = GAME_AA_KEY[id];
  if (!k) return false;
  const now = gameSettings.gameAaSync(gameFsRoot(GAMES[id].partition), cfg[k[1]]);
  return now === null ? cfg[k[0]] : now;
}
// Pacote de imagem e anti-serrilhado: CSS no canvas do jogo, nunca script. Vale na hora e volta sozinho a cada carga da
// página (dom-ready). No NFSU2 o CSS só leva os valores (--nfs-image) e o motor do app faz os efeitos.
let imageCssKey = null;
let imageCssRun = 0;
async function applyImageFilter() {
  if (!gameStarted) return;
  const wc = gameView.webContents;
  const run = ++imageCssRun;
  const old = imageCssKey;
  imageCssKey = null;
  if (old) wc.removeInsertedCSS(old).catch(() => {});
  const css = SAFE_MODE ? null : imageFilter.css(cfg.imageFilter, cfg.imageMode, cfg.antiAlias && !gameAaNow(currentGame));
  if (!css) return;
  try {
    const key = await wc.insertCSS(css);
    if (run === imageCssRun) imageCssKey = key;
    else wc.removeInsertedCSS(key).catch(() => {});
  } catch { /* a página mudou no meio: o dom-ready da nova aplica de novo */ }
}

// Abrir o jogo: carga normal, como no Chrome (a recarga sem cache a cada abertura saiu a pedido do Bruno, 06/11:
// o site já entrega as versões novas sozinho). Login, saves e configurações do jogo não são tocados.
function openSite(url) {
  try { modLog(`abrindo ${new URL(url).host}${modsOn ? (cfg.hdTextures ? '' : ' (texturas desligadas nas configurações)') : ' (sem mods carregados)'}`); } catch { /* endereço inválido: segue */ }
  // "Texturas melhores" desligada: nada passa pelo app e o jogo recebe a lista do site como ela é.
  if (modsOn) { try { modsOn.active(url); } catch (e) { modLog(`não deu para ligar os mods: ${e && e.message}`); } }
  const wc = gameView.webContents;
  cleanGameCache(url, wc.getURL()).finally(() => {
    if (!wc.isDestroyed()) wc.loadURL(url).catch(() => {}); // erros de carga vão para o did-fail-load
  });
}
// Antes de abrir o NFSU2 (ou o Modded), apaga as cópias velhas que o jogo deixa no disco (cacheClean.js). Só quando a
// página do mesmo site não está aberta (nada em uso) e com no máximo 10 s, para nunca segurar o jogo.
async function cleanGameCache(url, fromUrl) {
  const id = TEX_GAMES.find((g) => isAllowedUrl(url, g));
  if (!id || SAFE_MODE) return;
  let origin;
  try { origin = new URL(url).origin; if (new URL(fromUrl).origin === origin) return; } catch { if (!origin) return; }
  const w = new BrowserWindow({
    show: false, focusable: false, width: 200, height: 200,
    webPreferences: { partition: GAMES[id].partition, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  try {
    const job = (async () => {
      await w.webContents.loadURL(`${origin}/data-manifest`);
      return w.webContents.executeJavaScript(cacheClean.pageCode, true);
    })();
    const r = await Promise.race([job, new Promise((res) => setTimeout(() => res({ erro: 'demorou demais' }), 10000))]);
    if (r && r.erro) modLog(`limpeza das cópias velhas não rodou: ${r.erro}`);
    else if (r && r.apagados) modLog(`limpeza: ${r.apagados} cópias velhas apagadas (${Math.round(r.bytes / 1048576)} MB)`);
  } catch (e) { modLog(`limpeza das cópias velhas não rodou: ${e && e.message}`); } finally { if (!w.isDestroyed()) w.destroy(); }
}
// Uma view do jogo por pasta de dados (partição): o NFSU2 Modded tem a dele; os outros jogos dividem a do NFSU2.
// Só a do jogo aberto fica visível (gameView); a outra fica em branco e escondida.
const gameViews = new Map(); // partição -> WebContentsView
function makeGameView(partition) {
  const v = new WebContentsView({
    webPreferences: {
      partition, contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, devTools: DEV,
    },
  });
  v.setBackgroundColor('#000000');
  v.webContents.setUserAgent(app.userAgentFallback);
  win.contentView.addChildView(v, 0); // sempre embaixo da interface
  v.setVisible(false);
  wireGameContents(v.webContents);
  gameViews.set(partition, v);
  return v;
}
function useViewOf(id) {
  const p = gameOf(id).partition;
  if (gameView && gameViews.get(p) === gameView) return;
  const old = gameView;
  gameView = gameViews.get(p) || makeGameView(p);
  if (old) {
    old.setVisible(false);
    if (!old.webContents.isDestroyed() && old.webContents.getURL() !== 'about:blank') old.webContents.loadURL('about:blank').catch(() => {});
  }
  layout();
}
// Troca para um jogo de outra pasta de dados: a página atual fecha antes (o site pode pedir confirmação, como no
// "início"); se o jogador cancelar, continua no jogo.
async function switchAcross(id) {
  const wc = gameView.webContents;
  leavingGame = true;
  try { await wc.loadURL('about:blank'); } catch { /* cancelado pelo jogador */ }
  leavingGame = false;
  if (wc.isDestroyed() || wc.getURL() !== 'about:blank') return;
  useViewOf(id);
  startGame(id);
}
// START com o jogo escolhido nos CDs da tela inicial (sem id: o último iniciado). O app lembra o último iniciado.
function startGame(gameId) {
  const id = GAMES[gameId] ? gameId : cfg.game;
  if (gameStarted && id !== currentGame && gameViews.get(gameOf(id).partition) !== gameView) {
    if (!leavingGame) switchAcross(id).catch(() => {});
    return;
  }
  if (cfg.game !== id) { cfg.game = id; saveCfg(); }
  if (gameStarted && id !== currentGame) {
    // Troca de jogo: o site atual pode pedir confirmação (partida aberta) antes de sair.
    currentGame = id;
    playingSince = Date.now();
    connError = null;
    stopRetry();
    beginLoading();
    screen = 'loading';
    refresh();
    openSite(startUrl(id));
    return;
  }
  if (!gameStarted) {
    useViewOf(id);
    pauseUpdateDownload(); // nada de download do app durante o jogo: continua ao voltar à tela inicial
    gameStarted = true;
    currentGame = id;
    playingSince = Date.now();
    psbId = powerSaveBlocker.start('prevent-display-sleep');
    beginLoading();
    openSite(startUrl(id));
  } else if (connError) {
    reloadGame();
  }
  screen = connError ? 'error' : gameLoading ? 'loading' : 'none';
  refresh();
}
// Botão "início" (barra do topo): fecha o jogo aberto e volta aos CDs. Com partida aberta o site pede
// confirmação (beforeunload); se o jogador cancelar, continua no jogo.
let leavingGame = false;
async function goHome() {
  if (!gameStarted) { setScreen('launcher'); return; }
  const wc = gameView.webContents;
  leavingGame = true;
  try { await wc.loadURL('about:blank'); } catch { /* cancelado pelo jogador (ou já em branco) */ }
  leavingGame = false;
  if (wc.isDestroyed() || wc.getURL() !== 'about:blank') return; // cancelou: segue no jogo
  gameStarted = false;
  currentGame = null;
  connError = null;
  stopRetry();
  endLoading();
  hintOn = false;
  if (psbId !== null) { try { powerSaveBlocker.stop(psbId); } catch { /* ignora */ } psbId = null; }
  screen = 'launcher';
  refresh();
  checkUpdates(false);
}
// Pedido pelo jogador (botão do topo ou Configurações): lembra de salvar antes. Quem confirma aqui não é perguntado de novo.
let reloadConfirmed = false;
async function askReloadGame() {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: [tr('Cancelar', 'Cancel'), tr('Recarregar', 'Reload')], defaultId: 0, cancelId: 0, noLink: true,
    title: tr('Recarregar o jogo', 'Reload the game'),
    message: tr('Já salvou o jogo na garagem?', 'Have you saved the game in the garage?'),
    detail: tr('Vá para a garagem e salve o jogo antes de recarregar. O progresso que não foi salvo será perdido.',
      'Go to the garage and save the game before reloading. Progress that was not saved will be lost.'),
  });
  if (response !== 1) return;
  reloadConfirmed = true;
  reloadGame();
}
// Texturas melhores ligadas ou desligadas (botão da barra ou Configurações): só valem quando o jogo carrega de novo.
// Com o NFSU2 aberto, pergunta se reinicia agora, lembrando de salvar na garagem.
async function askTexturesRestart(partChanged = false) {
  if (!modsOn) return;
  const on = cfg.hdTextures;
  if (partChanged && !on) return; // trocou uma parte com as texturas desligadas: vale quando ligar
  // Ligou e o jogo ainda está sem o mapa detalhado no settings.ini: a linha só é trocada ao abrir o app (com o jogo
  // fechado), então quem precisa reabrir é o app, não só o jogo.
  if (on && texUiOnBy[gameStarted && gameOf(currentGame).textures ? currentGame : 'nfsu2'] === false) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', buttons: [tr('Depois', 'Later'), tr('Reabrir o app', 'Reopen the app')], defaultId: 1, cancelId: 0, noLink: true,
      title: tr('Texturas HD', 'HD textures'),
      message: tr('Texturas HD ligadas. Reabra o app para valer.', 'HD textures on. Reopen the app to apply.'),
      detail: tr('Ao abrir, o app liga o mapa detalhado do jogo, por onde as texturas entram (o HUD continua o mesmo). Vá para a garagem e salve o jogo antes: o progresso que não foi salvo será perdido.',
        'When it opens, the app turns on the game\'s detailed map, which is how the textures come in (the HUD stays the same). Go to the garage and save the game first: progress that was not saved will be lost.'),
    });
    if (response !== 1) return;
    relaunchApp();
    return;
  }
  if (!gameStarted || !gameOf(currentGame).textures) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'info', buttons: [tr('Depois', 'Later'), tr('Reiniciar o jogo', 'Restart the game')], defaultId: 1, cancelId: 0, noLink: true,
    title: tr('Texturas melhores', 'Better textures'),
    message: partChanged ? tr('Texturas trocadas. Reinicie o jogo para valer.', 'Textures changed. Restart the game to apply.')
      : on ? tr('Texturas melhores ligadas. Reinicie o jogo para valer.', 'Better textures on. Restart the game to apply.')
      : tr('Texturas melhores desligadas. Reinicie o jogo para valer.', 'Better textures off. Restart the game to apply.'),
    detail: tr('Vá para a garagem e salve o jogo antes de reiniciar. O progresso que não foi salvo será perdido.',
      'Go to the garage and save the game before restarting. Progress that was not saved will be lost.'),
  });
  if (response !== 1) return;
  reloadConfirmed = true;
  reloadGame();
}
function reloadGame() {
  if (!gameView || gameView.webContents.isDestroyed()) return;
  if (!gameStarted) { startGame(); return; }
  // Sai das configurações/erro e mostra "Carregando…" até a página voltar.
  beginLoading();
  screen = 'loading';
  refresh();
  openSite(gameUrl());
}

// Reconexão automática (a cada 5 s) enquanto a tela de erro estiver ativa.
function startRetry() {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await net.fetch(gameUrl(), { method: 'HEAD', signal: ctl.signal });
      clearTimeout(t);
      if (r.status < 500 && gameView && !gameView.webContents.isDestroyed()) openSite(gameUrl());
    } catch { /* ainda offline */ }
  }, 5000);
}
function stopRetry() { if (retryTimer) { clearInterval(retryTimer); retryTimer = null; } }
// DNS seguro (pedido do Bruno): por clique na tela de erro, tenta Cloudflare, depois Google. O que abrir o jogo fica ligado
// nas próximas aberturas. Se nenhum abrir, volta ao DNS normal nesta execução e pede para conferir a rede: assim uma rede
// que bloqueia o DNS seguro não prende o jogador fora do jogo.
let dnsActive = null;  // provedor em uso nesta execução
let dnsQueue = [];     // próximos a tentar
let dnsFailed = false; // nenhum abriu
function useSecureDns(id) {
  dnsActive = id;
  app.configureHostResolver(id ? { secureDnsMode: 'secure', secureDnsServers: [...SECURE_DNS[id]] } : { secureDnsMode: 'automatic' });
}
function showConnError(code) {
  const kind = errorKind(code);
  if (dnsActive && offersSecureDns(kind)) {
    const next = dnsQueue.shift();
    try {
      useSecureDns(next || null);
      if (next) { reloadGame(); return; }
    } catch { dnsActive = null; }
    dnsFailed = true;
  }
  connError = { kind, dnsOffer: offersSecureDns(kind) && !dnsFailed, dnsFailed };
  screen = 'error';
  startRetry();
  refresh();
}

// ───────────────────────── Teclado ─────────────────────────
// Alt+Espaço: o Windows abre o menu da janela (Restaurar/Mover/Tamanho…) quando a página não trata a tecla.
// O app segura o Alt+Espaço original (assim o menu não abre) e entrega uma cópia idêntica ao jogo, para nitro +
// freio de mão funcionarem juntos. A cópia é enviada logo depois (dentro deste evento o Electron a descartaria)
// e passa de novo por aqui: a marca abaixo deixa a cópia seguir. A marca expira sozinha em 250 ms, então uma
// cópia perdida nunca faz o próximo Alt+Espaço de verdade escapar para o Windows.
const altCopies = { n: 0, until: 0 };
function isAltSpaceCopy(input) {
  if (altCopies.n <= 0 || Date.now() > altCopies.until || input.code !== 'Space' || !input.alt) return false;
  altCopies.n -= 1;
  return true;
}
function forwardAltSpaceToGame(input) {
  const modifiers = ['alt'];
  if (input.shift) modifiers.push('shift');
  if (input.control) modifiers.push('control');
  if (input.isAutoRepeat) modifiers.push('isAutoRepeat');
  setImmediate(() => {
    if (!gameView || gameView.webContents.isDestroyed()) return;
    altCopies.n = Date.now() > altCopies.until ? 1 : altCopies.n + 1;
    altCopies.until = Date.now() + 250;
    try { gameView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space', modifiers }); } catch { altCopies.n -= 1; }
  });
}

// Camada principal (Windows): o Chromium abre o menu da janela ao ver o Alt+Espaço mesmo com a tecla segurada
// acima. Enquanto a janela está em foco com o jogo na tela, o app registra Alt+Espaço (e Alt+Shift+Espaço) como
// atalho: o Windows entrega a tecla ao app em vez de gerar o menu, e o app passa a cópia ao jogo. Soltar o Espaço
// chega ao jogo normalmente. Ao sair do foco (Alt+Tab, outro programa) o atalho é liberado na hora.
// Se outro programa já usa Alt+Espaço (ex.: um lançador), o registro falha e fica só a camada acima.
let altSpaceCatching = false;
function syncAltSpaceCatch() {
  const want = wantAltSpaceCatch({
    win32: process.platform === 'win32', blockAltSpace: cfg.blockAltSpace, capturing,
    focused: !!win && !win.isDestroyed() && win.isFocused(), playing: gameStarted && screen === 'none',
  });
  if (want === altSpaceCatching) return;
  altSpaceCatching = want;
  for (const accel of ALT_SPACE_ACCELS) {
    try {
      if (want) globalShortcut.register(accel, () => forwardAltSpaceToGame({ shift: accel.includes('Shift') }));
      else globalShortcut.unregister(accel);
    } catch { /* ignora */ }
  }
}

function onInput(event, input, fromGame = false) {
  if (!mayBeShortcut(input)) return; // tecla do jogo: segue direto para a página
  if (isAltSpaceCopy(input)) return; // a cópia entregue ao jogo segue direto
  const action = decideKey(input, {
    locked: locked(), capturing, toggleCombo: cfg.toggleCombo, exitCombo: cfg.exitCombo,
    blockAltSpace: cfg.blockAltSpace, playing: gameStarted && screen === 'none',
  });
  switch (action) {
    case 'block': event.preventDefault(); break;
    case 'altspace-to-game':
      event.preventDefault();
      if (fromGame) forwardAltSpaceToGame(input); // nas telas do app só segura (lá não há jogo para receber)
      break;
    case 'block-notify': event.preventDefault(); notifyLocked(); break;
    case 'toggle-fullscreen': event.preventDefault(); toggleFullscreen(); break;
    case 'exit-protected': event.preventDefault(); exitProtected(); break;
    case 'open-settings': event.preventDefault(); if (NO_UI) break; if (screen === 'settings') setScreen(backScreen()); else setScreen('settings'); break;
    default: break;
  }
}

// ───────────────────────── Janela ─────────────────────────
function createWindow() {
  const b = boundsVisible(cfg.bounds) ? cfg.bounds : null;
  win = new BrowserWindow({
    width: b ? b.width : 1280, height: b ? b.height : 720, x: b ? b.x : undefined, y: b ? b.y : undefined,
    minWidth: 960, minHeight: 540, show: false, backgroundColor: '#0b0d17',
    title: NO_UI ? 'NFS Launcher (modo de teste: só o jogo)' : 'NFS Launcher',
    icon: ICON, autoHideMenuBar: true, fullscreenable: true,
    // Sem a barra do Windows: minimizar, maximizar e fechar continuam sendo os dele (com o encaixe nos cantos), sobre a nossa barra.
    ...(NO_UI ? {} : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e1018', symbolColor: '#c9cde6', height: TITLE_H } }),
  });
  win.removeMenu();

  gameView = makeGameView(gameOf(cfg.game).partition);

  uiView = new WebContentsView({
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: DEV },
  });
  uiView.setBackgroundColor('#00000000');

  if (!NO_UI) win.contentView.addChildView(uiView); // no modo de teste a interface nem entra na janela

  wireUiContents(uiView.webContents);

  win.on('close', (e) => {
    if (shouldCancelClose({ locked: locked(), quitting })) { e.preventDefault(); notifyLocked(); return; }
    saveBounds();
  });
  win.on('system-context-menu', (e) => { if (locked()) e.preventDefault(); }); // clique direito no título
  win.on('minimize', () => {
    if (locked()) setImmediate(() => { if (win && !win.isDestroyed()) { win.restore(); win.focus(); } });
  });
  win.on('session-end', () => { quitting = true; }); // desligar/reiniciar o Windows nunca é impedido

  win.on('enter-full-screen', () => refresh());
  win.on('leave-full-screen', () => {
    hintOn = false; // saiu da tela cheia: a dica de como sair não faz mais sentido
    const unintended = !intentionalLeave && wantFullscreen && gameStarted && cfg.protectFullscreen && !quitting;
    intentionalLeave = false;
    const now = Date.now();
    fsRetries = fsRetries.filter((t) => now - t < 5000);
    if (unintended && fsRetries.length < 3) {
      fsRetries.push(now);
      setTimeout(() => { if (win && !win.isDestroyed() && !quitting) win.setFullScreen(true); }, 150);
    } else {
      wantFullscreen = false;
    }
    refresh();
  });
  win.on('resize', layout);
  win.on('maximize', refresh);
  win.on('unmaximize', refresh);
  win.on('focus', () => {
    focusedView().webContents.focus(); applyPriority(); syncAltSpaceCatch();
    if (leftInFullscreen) { leftInFullscreen = false; flashFsHint(); } // voltou ao jogo: lembra o atalho mais uma vez
  });
  win.on('blur', () => {
    syncAltSpaceCatch(); // outro programa em foco: Alt+Espaço volta a ser do Windows na hora
    if (isFullscreen() && gameStarted && screen === 'none') { leftInFullscreen = true; flashFsHint(); }
  });
  win.on('closed', () => { win = null; });

  if (NO_UI) {
    showWindow();
    notify(tr('Modo de teste: só o jogo, sem a interface do app. Feche e abra o app normalmente para voltar.',
      'Test mode: only the game, without the app interface. Close and reopen the app to go back to normal.'));
    return;
  }
  uiView.webContents.loadFile(UI_FILE);

  // A página fica numa view filha, então o "ready-to-show" da janela nunca dispara.
  // A janela aparece quando a interface local termina de carregar (ou em 1,5 s, o que vier antes).
  const fallback = setTimeout(showWindow, 1500);
  uiView.webContents.once('did-finish-load', () => { clearTimeout(fallback); showWindow(); });
}

let shown = false;
function showWindow() {
  if (shown || !win || win.isDestroyed()) return;
  shown = true;
  if (cfg.maximized && !(cfg.startFullscreen && !SAFE_MODE)) win.maximize();
  win.show();
  win.focus();
  if (cfg.startFullscreen && !SAFE_MODE) enterFullscreen();
  if (!cfg.showHome || NO_UI) startGame();
  refresh();
  if (NO_UI) return;
  if (dx11MinApplied) dx11Warning();
  setTimeout(() => checkUpdates(false), 4000); // depois da janela, sem atrasar a abertura
  updateTimer = setInterval(() => { if (!gameStarted) checkUpdates(false); }, UPDATE_EVERY_MS);
}

function wireUiContents(wc) {
  wc.on('before-input-event', onInput);
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('did-finish-load', () => { uiReady = true; sendState(); });
  if (DEV) wc.openDevTools({ mode: 'detach' });
}

// Janelinha do login do Last.fm (isLoginUrl): fica sobre o app, só navega no Last.fm e na volta para o site do jogo
// (lastfm.html, que se fecha sozinha). Mesma partição do jogo, herdada de quem abriu.
function loginWindowOptions() {
  return {
    parent: win, width: 480, height: 720, minimizable: false, fullscreenable: false, autoHideMenuBar: true,
    backgroundColor: '#111111', icon: ICON, webPreferences: { devTools: DEV },
  };
}
function wireLoginWindow(child) {
  child.setMenu(null);
  const cwc = child.webContents;
  cwc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (e, url) => { if (!isLoginUrl(url) && !isAllowedUrl(url, currentGame)) e.preventDefault(); };
  cwc.on('will-navigate', guard);
  cwc.on('will-redirect', guard);
}

function wireGameContents(wc) {
  // A view escondida (a do outro jogo, em branco) não mexe no carregamento, nos erros nem no filtro do jogo aberto.
  const mine = () => !!gameView && gameView.webContents === wc;
  wc.on('before-input-event', (event, input) => onInput(event, input, true));

  // Zoom sempre em 100%: zoom diferente muda a escala de pixels e reduz a resolução do canvas.
  wc.on('did-finish-load', () => {
    wc.setZoomFactor(1);
    wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
    if (mine()) applyPriority();
  });
  wc.on('zoom-changed', () => wc.setZoomFactor(1));

  // Navegação só dentro do site do jogo aberto (o login/cadastro pode passar por outro endereço do mesmo site).
  wc.setWindowOpenHandler(({ url }) => {
    if (isLoginUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: loginWindowOptions() };
    if (isAllowedUrl(url, currentGame)) wc.loadURL(url);
    else if (isExternalUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('did-create-window', wireLoginWindow);
  const guard = (e, url) => { if (!isAllowedUrl(url, currentGame)) e.preventDefault(); };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);

  // Com uma partida aberta, o site pede confirmação antes de sair da página ("beforeunload").
  // O Electron cancela o recarregamento em silêncio nesse caso (era por isso que "Recarregar" não fazia nada).
  // Aqui o app pergunta, como o Chrome faz, e recarrega se o usuário confirmar.
  wc.on('will-prevent-unload', (event) => {
    if (quitting || reloadConfirmed) { event.preventDefault(); return; }
    const choice = dialog.showMessageBoxSync(win, leavingGame ? {
      type: 'question', buttons: [tr('Cancelar', 'Cancel'), tr('Fechar o jogo', 'Close the game')], defaultId: 1, cancelId: 0, noLink: true,
      title: tr('Voltar ao início', 'Back to home'),
      message: tr('Há uma partida em andamento. Fechar o jogo e voltar ao início?', 'A session is in progress. Close the game and go back to home?'),
      detail: tr('O progresso que não foi salvo no jogo será perdido.', 'Progress not saved in the game will be lost.'),
    } : {
      type: 'question', buttons: [tr('Cancelar', 'Cancel'), tr('Reiniciar', 'Restart')], defaultId: 1, cancelId: 0, noLink: true,
      title: tr('Reiniciar o jogo', 'Restart the game'),
      message: tr('Há uma partida em andamento. Reiniciar mesmo assim?', 'A session is in progress. Restart anyway?'),
      detail: tr('O progresso que não foi salvo no jogo (Garage > Save) será perdido.', 'Progress not saved in the game (Garage > Save) will be lost.'),
    });
    if (choice === 1) { event.preventDefault(); return; } // ignora o beforeunload e recarrega
    endLoading();         // volta direto para a partida
  });
  wc.on('dom-ready', () => { if (mine()) endLoading(); });
  wc.on('dom-ready', () => { if (mine()) { imageCssKey = null; applyImageFilter(); } });

  wc.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (!isMainFrame || !mine()) return;
    if (code === -3) return; // -3 = navegação cancelada (normal)
    endLoading();
    showConnError(code);
  });
  wc.on('did-navigate', (_e, url, status) => {
    if (!isAllowedUrl(url) || !mine()) return;
    if (status >= 500) { showConnError(status); return; }
    connError = null;
    dnsFailed = false;
    if (dnsActive && cfg.secureDns !== dnsActive) { cfg.secureDns = dnsActive; saveCfg(); }
    stopRetry();
    if (screen === 'error') { screen = 'none'; refresh(); }
  });

  wc.on('render-process-gone', (_e, details) => {
    if (quitting || details.reason === 'clean-exit' || !mine()) return;
    logCrash('jogo', details);
    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 60000);
    crashes.push(now);
    if (crashes.length <= 3) setTimeout(() => { if (!wc.isDestroyed()) wc.reload(); }, 1000);
    else showConnError(-1);
  });
  wc.on('unresponsive', () => {
    if (!mine()) return;
    if (gameStarted && !quitting) logCrash('jogo', { reason: 'unresponsive' });
    if (locked()) { exitProtected(); notify(tr('O jogo parou de responder. Modo protegido desativado.', 'The game stopped responding. Protected mode turned off.')); }
  });
}

// ───────────────────────── IPC (somente da interface local) ─────────────────────────
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!uiView || event.sender !== uiView.webContents) return { ok: false, error: 'Origem não autorizada.' };
    return fn(...args);
  });
}
const PRIORITY_NAMES = { [-14]: 'alta', [-7]: 'acima do normal', 0: 'normal', 10: 'abaixo do normal', 19: 'baixa' };
// Nomes dos processos abertos, só para procurar os programas conhecidos por causar engasgo (diagnostics.KNOWN_TOOLS).
function runningProcessNames() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 4 * 2 ** 20 }, (err, out) => {
      resolve(err ? [] : String(out).split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean));
    });
  });
}
async function collectDiagnostics() {
  let gpu = null;
  try { gpu = await app.getGPUInfo('complete'); } catch { /* ignora */ }
  const current = win && !win.isDestroyed() ? displays.getDisplayMatching(win.getBounds()).id : null;
  const cpus = os.cpus();
  const { bounds, ...settingsShown } = cfg; // posição da janela não interessa
  // O uso de CPU é medido entre duas leituras: a primeira só zera o contador.
  app.getAppMetrics();
  const [names] = await Promise.all([runningProcessNames(), new Promise((r) => setTimeout(r, 1000))]);
  const pidOf = (v) => (v && !v.webContents.isDestroyed() ? v.webContents.getOSProcessId() : -1);
  const procName = (m) => (m.pid === pidOf(gameView) ? 'Jogo' : m.pid === pidOf(uiView) ? 'Interface' : m.type);
  return {
    when: new Date().toISOString(),
    app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    os: `${os.version()} (${os.release()})`, cpu: cpus.length ? `${cpus[0].model.trim()} · ${cpus.length} threads` : null,
    ramGB: Math.round(os.totalmem() / 2 ** 30),
    onBattery: powerMonitor.isOnBatteryPower(),
    tools: diagnostics.detectTools(names),
    crashes: crashLog.load(crashFile()),
    flags: { uncapped: VSYNC_OFF, prepareGame: PREPARE_ON, lighterGpu: LIGHTER_ON, unblockGpu: UNBLOCK_ON, newDrawing: NEW_DRAWING_ON, antiAlias: cfg.antiAlias && !SAFE_MODE && !gameAaNow(currentGame || cfg.game), imageFilter: cfg.imageFilter ? cfg.imageMode : false, unsafeWebgpu: argv.includes('--unsafe-webgpu'), safeMode: SAFE_MODE, noUi: NO_UI, dev: DEV },
    settings: settingsShown,
    window: {
      fullscreen: isFullscreen(), protegido: locked(), maximizada: !!win && win.isMaximized(),
      tamanho: win ? win.getContentSize().join('×') : null, jogoIniciado: gameStarted,
    },
    displays: displays.getAllDisplays().map((x) => ({
      label: x.label, hz: Math.round(x.displayFrequency) || 0, scale: x.scaleFactor,
      pixels: `${Math.round(x.size.width * x.scaleFactor)}×${Math.round(x.size.height * x.scaleFactor)}`,
      primary: x.id === displays.getPrimaryDisplay().id, current: x.id === current,
    })),
    gpuFeatures: app.getGPUFeatureStatus(),
    gpuDevices: gpu && Array.isArray(gpu.gpuDevice) ? gpu.gpuDevice : [],
    gpuAux: gpu ? { ...gpu.auxAttributes } : null,
    metrics: app.getAppMetrics().map((m) => {
      let priority = 'n/d';
      try { const p = os.getPriority(m.pid); priority = PRIORITY_NAMES[p] || String(p); } catch { /* ignora */ }
      return { type: procName(m), cpu: m.cpu.percentCPUUsage || 0, memMB: Math.round((m.memory.workingSetSize || 0) / 1024), priority };
    }),
  };
}
async function clearCache() {
  for (const ses of gameSessions.size ? gameSessions.values() : [gameView.webContents.session]) {
    await ses.clearCache();
    await ses.clearCodeCaches({});
    await ses.clearStorageData({ storages: ['shadercache'] }); // nunca toca em saves (IndexedDB/OPFS/localStorage)
  }
}
function registerIpc() {
  handle('state:get', () => buildState());
  handle('game:home', async () => { await goHome(); return { ok: true }; });
  handle('game:start', (id) => { startGame(GAMES[id] ? id : undefined); return { ok: true }; });
  handle('game:reload', () => { reloadGame(); return { ok: true }; });
  handle('game:secure-dns', () => {
    if (!connError || !connError.dnsOffer) return { ok: false };
    const [first, ...rest] = Object.keys(SECURE_DNS);
    try { useSecureDns(first); } catch { dnsActive = null; return { ok: false }; }
    dnsQueue = rest;
    reloadGame();
    return { ok: true };
  });
  handle('game:reload-ask', async () => { await askReloadGame(); return { ok: true }; });
  handle('window:toggle-fullscreen', () => { if (!locked()) toggleFullscreen(); return { ok: true }; });
  handle('window:exit-protected', () => { exitProtected(); return { ok: true }; });
  handle('screen:settings', () => { if (!locked()) setScreen('settings'); return { ok: true }; });
  handle('screen:back', () => { setScreen(screen === 'textures' ? texBackScreen() : backScreen()); return { ok: true }; });
  handle('capture:set', (on) => { capturing = !!on; syncAltSpaceCatch(); return { ok: true }; });
  handle('settings:set', (key, value) => {
    const r = settings.applyChange(cfg, key, value);
    if (!r.ok) return r;
    cfg = r.cfg;
    saveCfg();
    if (key === 'highPriority' || key === 'lightMode') applyPriority();
    if (key === 'imageFilter' || key === 'imageMode' || key === 'antiAlias' || key === 'unblockGpu' || key === 'lightMode') applyImageFilter(); // DX11 e modo leve desligam o filtro
    refresh();
    if (key === 'hdTextures') askTexturesRestart();
    return { ok: true };
  });
  // Janela de texturas (botão "Texturas HD" da barra e Configurações > Texturas): volta para onde estava.
  handle('screen:textures', () => {
    if (NO_UI) return { ok: false };
    if (screen !== 'textures') texReturn = screen;
    loadTexOffer();
    setScreen('textures');
    return { ok: true };
  });
  handle('textures:download', (id) => downloadTextures(String(id)));
  handle('textures:remove', (id) => removeTextures(String(id)));
  handle('textures:cancel', () => { if (texJob) texJob.ctl.abort(); return { ok: true }; });
  // "Aplicar" da janela: a opção geral e o mod de cada parte de uma vez (texPack.js); só então pergunta se reinicia.
  handle('textures:apply', (draft) => {
    if (!draft || typeof draft !== 'object' || typeof draft.on !== 'boolean') return { ok: false, error: tr('Escolha inválida.', 'Invalid choice.') };
    const parts = texSources ? texPack.sanitizeChoice(draft.parts) : cfg.texParts;
    for (const [p, list] of Object.entries(parts)) {
      if (!Array.isArray(list) || list.some((mod) => !(texAvail[p] || []).includes(mod))) return { ok: false, error: tr('Esse pacote não tem essa parte.', 'That pack does not have this part.') };
    }
    const onChanged = draft.on !== cfg.hdTextures;
    const before = JSON.stringify(texPack.effectiveChoice(cfg.texParts, texAvail));
    cfg = { ...cfg, hdTextures: draft.on, texParts: parts };
    saveCfg();
    const partsChanged = JSON.stringify(texPack.effectiveChoice(cfg.texParts, texAvail)) !== before;
    if (partsChanged && modsOn) modsOn.setMods(allMods());
    setScreen(texBackScreen());
    if (onChanged || (partsChanged && cfg.hdTextures)) askTexturesRestart(!onChanged);
    return { ok: true };
  });
  handle('image:next', () => {
    const n = imageFilter.next(cfg.imageFilter, cfg.imageMode);
    cfg = { ...cfg, imageFilter: n.on, imageMode: n.mode };
    saveCfg();
    applyImageFilter();
    refresh();
    return { ok: true };
  });
  handle('cache:reset', async () => {
    try { await clearCache(); return { ok: true }; } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  handle('saves:open', async () => {
    try {
      fs.mkdirSync(saveCopyDir(), { recursive: true });
      const error = await shell.openPath(saveCopyDir());
      return error ? { ok: false, error } : { ok: true };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  handle('gpu:status', async () => {
    let info = null;
    try { info = await app.getGPUInfo('basic'); } catch { /* ignora */ }
    return {
      ok: true,
      features: app.getGPUFeatureStatus(),
      devices: info && Array.isArray(info.gpuDevice)
        ? info.gpuDevice.map((d) => ({ vendorId: d.vendorId, deviceId: d.deviceId, active: !!d.active }))
        : [],
      uncapped: VSYNC_OFF,
    };
  });
  // Monitor onde a janela está: pixels reais e taxa de atualização (a recomendação depende dos dois).
  handle('diag:save', async () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: tr('Salvar relatório de diagnóstico', 'Save diagnostic report'),
      defaultPath: path.join(app.getPath('downloads'), `nfsu2-launcher-diagnostico-${stamp}.txt`),
      filters: [{ name: tr('Texto', 'Text'), extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { ok: false, error: 'Cancelado.' };
    try {
      fs.writeFileSync(filePath, `﻿${diagnostics.formatReport(await collectDiagnostics())}`, 'utf8');
      return { ok: true, name: path.basename(filePath) };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  handle('app:restart', () => {
    relaunchApp();
    return { ok: true };
  });
  // Resultado do teste de WebGPU da tela inicial: placa sem DirectX 12 tenta o modo DirectX 11 sozinha, uma vez.
  handle('gpu:report', (r) => {
    const action = gpuFallback.decide({
      supported: !!(r && r.supported), software: !!(r && r.software),
      unblockOn: UNBLOCK_ON, tried: cfg.unblockTried, safeMode: SAFE_MODE, gameStarted,
    });
    if (action === 'try') {
      cfg = { ...settings.dx11Basic(cfg), unblockTried: true }; // modo DirectX 11 com o jogo "cru"
      saveCfg();
      relaunchApp();
    } else if (action === 'failed') {
      cfg = { ...cfg, unblockGpu: false, unblockTried: true };
      saveCfg();
      refresh();
    }
    return { ok: true, action };
  });
  handle('app:quit', () => { quitApp(); return { ok: true }; });
  handle('custom:pick', (gameId, kind) => pickCustom(gameId, kind));
  handle('custom:reset', (gameId, kind) => resetCustom(gameId, kind));
  handle('custom:get', () => customImages());
  handle('update:check', () => checkUpdates(true));
  handle('update:install', () => {
    if (updateInfo.status !== 'ready') return { ok: false, error: tr('A atualização ainda não está pronta.', 'The update is not ready yet.') };
    if (!installUpdate(true)) return { ok: false, error: tr('Não deu para abrir o instalador. Feche o app: ele tenta de novo ao fechar.', 'Could not start the installer. Close the app: it tries again when closing.') };
    quitApp();
    return { ok: true };
  });
  // Abre SEMPRE a mesma pasta fixa no navegador padrão (nunca um endereço vindo da interface ou do site).
  handle('update:open', async () => {
    try { await shell.openExternal(github.RELEASES_URL); return { ok: true }; } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
}

// ───────────────────────── Ciclo de vida ─────────────────────────
if (gotLock) {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault()); // nenhuma <webview>
  });

  // Se o processo de GPU cair (contexto WebGPU perdido), recarrega o jogo.
  app.on('child-process-gone', (_e, details) => {
    if (!quitting && details.reason !== 'clean-exit') {
      const net = /network/i.test(`${details.serviceName || ''} ${details.name || ''}`);
      logCrash(details.type === 'GPU' ? 'GPU' : net ? 'rede' : String(details.name || details.type), details);
    }
    if (details.type !== 'GPU' || !gameStarted || quitting) return;
    const now = Date.now();
    if (now - lastGpuReload < 30000) return;
    lastGpuReload = now;
    setTimeout(() => { if (gameView && !gameView.webContents.isDestroyed()) gameView.webContents.reload(); }, 1500);
  });

  app.whenReady().then(async () => {
    // Identidade da barra de tarefas só no app instalado: testes com electron.exe usando a mesma identidade fazem o
    // Windows mostrar o app instalado como "Electron", sem ícone (PC do Bruno, 08/11).
    if (app.isPackaged) app.setAppUserModelId('xyz.nfsu2.launcher');
    // O site detecta o navegador pelo User-Agent: o app se apresenta exatamente como o Chrome equivalente.
    app.userAgentFallback = toChromeUA(app.userAgentFallback);

    cfgPath = path.join(app.getPath('userData'), 'settings.json');
    if (RESET_SETTINGS) { try { fs.unlinkSync(cfgPath); } catch { /* nada a apagar */ } }
    cfg = settings.load(cfgPath);
    if (SAFE_MODE) cfg = { ...cfg, startFullscreen: false, showHome: true };
    if (cfg.secureDns !== 'off' && !SAFE_MODE) {
      try {
        useSecureDns(cfg.secureDns);
        dnsQueue = Object.keys(SECURE_DNS).filter((id) => id !== cfg.secureDns);
      } catch { dnsActive = null; } // segue com o DNS normal
    }

    Menu.setApplicationMenu(null); // sem menu e sem atalhos de navegador

    // Antes de tocar nos dados do jogo: a cópia que está fechando precisa ter saído, senão os saves são apagados.
    const onlyCopy = await profileLock.acquire({ pidFile: path.join(app.getPath('userData'), 'nfs.pid') });
    if (!onlyCopy) {
      dialog.showErrorBox('NFS Launcher', tr('O jogo ainda está fechando. Espere alguns segundos e abra de novo.', 'The game is still closing. Wait a few seconds and open it again.'));
      app.exit(0);
      return;
    }
    // Inteiras antes da sessão: as únicas escritas nos dados do jogo. As duas mexem em road_textures: o modo leve ligado
    // vem depois (fica desligada); desligado, vem antes (as Texturas HD ligadas a deixam desligada).
    if (!cfg.lightMode) await lightModeAtStart();
    await texturesSettingAtStart();
    if (cfg.lightMode) await lightModeAtStart();
    await dx11MinAtStart();
    await copySaveAtStart();
    gameAaAtStart().catch(() => {}); // só leitura, depois do modo DirectX 11 (que zera o anti-serrilhado do jogo)

    // Uma sessão por pasta de dados (a do NFSU2, que o Most Wanted e o Carbon dividem, e a do NFSU2 Modded), com as mesmas regras.
    for (const p of PARTITIONS) {
      const ses = session.fromPartition(p);
      ses.setPermissionRequestHandler((_wc, perm, cb, details) => cb(allowPermission(perm, details)));
      ses.setPermissionCheckHandler((_wc, perm, _origin, details) => allowPermission(perm, details));
      gameSessions.set(p, ses);
    }
    const gameSession = gameSessions.get(gameOf(cfg.game).partition);
    try { setupMods(); } catch (e) { modLog(`mods fora nesta abertura: ${e && e.message}`); } // não impede o jogo de abrir
    // Abre a conexão com o site enquanto a tela inicial aparece: o jogo carrega mais rápido ao clicar INICIAR.
    try { gameSession.preconnect({ url: gameOf(cfg.game).url, numSockets: 2 }); } catch { /* sem rede: ignora */ }
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    registerIpc();
    createWindow();
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    // Atualização baixada e o jogador fechou o app: instala agora, sem reabrir (não ao reabrir por uma opção).
    if (!relaunching && updateInfo.status === 'ready') installUpdate(false);
    globalShortcut.unregisterAll();
    presence.set(null);
    if (psbId !== null && powerSaveBlocker.isStarted(psbId)) powerSaveBlocker.stop(psbId);
    stopRetry();
    if (cornerTimer) clearInterval(cornerTimer);
    if (updateTimer) clearInterval(updateTimer);
    clearTimeout(loadingTimer);
  });
  // Fechar a janela encerra o app por completo: nada fica rodando em segundo plano.
  app.on('window-all-closed', () => app.quit());
}
