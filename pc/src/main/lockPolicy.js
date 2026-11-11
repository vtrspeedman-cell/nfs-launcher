'use strict';
// Política de teclas do modo protegido — lógica PURA (sem Electron), coberta por testes.
// O jogo usa Alt = nitro, Espaço = freio de mão, Ctrl/Shift = marchas, W = acelerar,
// Esc = pausa, F8/F12 = FPS/foto. O bloqueio foi desenhado para não roubar essas teclas.
// Regra: teclas sem Ctrl+Alt (F5, F1–F10, F12, letras…) SEMPRE vão para o jogo. Só F11 é do app (tela cheia).
//  - Alt+Enter: tela cheia, como o atalho configurado (Enter sozinho e o Alt do nitro continuam indo para o jogo).
//  - Alt+F4 e F11: não são teclas do jogo → bloqueados no modo protegido.
//  - Alt+Espaço (nitro + freio de mão): durante o jogo, em tela cheia ou janela, o app impede o menu do Windows
//    (Restaurar/Mover/Tamanho…) e entrega a tecla ao jogo ('altspace-to-game'). Opção para deixar o Windows tratar.
//  - Ctrl+W: não interceptado. O app não tem menu/abas, então Ctrl+W já não fecha nada.
const { fromEvent } = require('./combo');

const SETTINGS_COMBO = 'Ctrl+Alt+O'; // abre/fecha as configurações (fora do modo protegido)
const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight']);

// Filtro rápido: cada tecla do jogo passa pelo processo principal antes de chegar à página, então a grande
// maioria (WASD, setas, Espaço, Shift, soltar teclas, repetição do Alt do nitro) sai aqui sem nenhum outro trabalho.
// Todo atalho do app tem Ctrl ou Alt, ou é F11, e termina numa tecla que não é modificadora.
function mayBeShortcut(input) {
  if (!input || input.type !== 'keyDown' || MODIFIER_CODES.has(input.code)) return false;
  return !!(input.control || input.alt) || input.code === 'F11';
}

function isAltEnter(input) {
  return input.alt && !input.control && !input.shift && !input.meta && (input.code === 'Enter' || input.code === 'NumpadEnter');
}

function decideKey(input, ctx) {
  if (!input || input.type !== 'keyDown') return 'pass';
  if (ctx.capturing) return 'pass';
  // Segurar o Enter repete a tecla: só a primeira vale, senão a tela cheia ficaria abrindo e fechando.
  if (isAltEnter(input)) return input.isAutoRepeat ? 'block' : ctx.locked ? 'exit-protected' : 'toggle-fullscreen';
  const combo = fromEvent(input);
  if (ctx.locked) {
    // O atalho de tela cheia (padrão Ctrl+F) também tira da tela cheia no modo protegido.
    if (combo && (combo === ctx.exitCombo || combo === ctx.toggleCombo)) return 'exit-protected';
    if (input.alt && input.code === 'F4') return 'block-notify';
    if (input.alt && input.code === 'Space' && ctx.blockAltSpace) return 'altspace-to-game';
    if (input.code === 'F11') return 'block';
    return 'pass';
  }
  // No modo janela, durante o jogo: Alt+Espaço abriria o menu do Windows e tiraria o foco do jogo.
  if (ctx.playing && ctx.blockAltSpace && input.alt && input.code === 'Space') return 'altspace-to-game';
  if (combo && combo === ctx.toggleCombo) return 'toggle-fullscreen';
  if (combo === SETTINGS_COMBO) return 'open-settings';
  if (input.code === 'F11' && !input.control && !input.alt && !input.shift && !input.meta) return 'toggle-fullscreen';
  return 'pass';
}

function shouldCancelClose({ locked, quitting }) {
  return !!locked && !quitting;
}

// Segurar a tecla na página não impede o menu: o próprio Chromium abre o menu do Windows ao ver o Alt+Espaço.
// Então, enquanto a janela do app está EM FOCO com o jogo na tela, o app pega o Alt+Espaço antes do Windows
// (atalho registrado só nesse período; ao trocar de programa ele é liberado e os outros apps não são afetados).
// Alt+Shift+Espaço também abre o menu (Shift = marcha); com Ctrl o Windows não abre menu.
const ALT_SPACE_ACCELS = ['Alt+Space', 'Alt+Shift+Space'];
function wantAltSpaceCatch({ win32, blockAltSpace, focused, playing, capturing }) {
  return !!(win32 && blockAltSpace && focused && playing && !capturing);
}

module.exports = { mayBeShortcut, decideKey, shouldCancelClose, wantAltSpaceCatch, ALT_SPACE_ACCELS, SETTINGS_COMBO };
