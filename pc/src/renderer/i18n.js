'use strict';
(function () {
// Textos da interface em inglês. O português fica no próprio ui.html; cada elemento traduzível tem uma chave:
// data-t (conteúdo), data-tt (dica do mouse, "title") e data-ta (rótulo de acessibilidade).
// Os textos são constantes deste arquivo (nada vindo de fora), então podem ter <b>, <i> e <small>.
const EN = {
  cFsA: 'Toggle fullscreen',
  cHomeT: 'Back to home (closes the game)', cHomeA: 'Back to home',
  cReloadA: 'Reload the game',
  settings: 'Settings', close: 'Close',
  tagline: 'Pick the game and press <b>START</b>',
  hWindow: 'Window and fullscreen',
  sStartFs: 'Start in fullscreen',
  hTextures: 'Textures (NFSU2)', cTexN: 'HD textures',
  texTitle: 'HD textures',
  texOn: 'Better textures <small>(when off, the game keeps its original textures)</small>',
  texHint: 'Nothing changes until you apply · Esc goes back',
  texCancel: 'Back',
  texApply: 'Apply',
  texChoose: 'HD textures…',
  texChooseNote: 'Download the mods and choose which one each part comes from (asphalt, sky, buildings and more).',
  texDlNote: 'The mods stay on your PC after downloading. The site\'s detailed map comes with the first one.',
  texPartsNote:'Click the mods in the order you want: the 1st choice comes first; what it lacks comes from the 2nd, then the 3rd. What none of the chosen ones has stays original. Click again to remove. “Original” leaves the whole part as in the game.',
  sHdTextures: 'Better textures <small>(more detailed asphalt, buildings, trees and sky, from the TexWizard, Redux, Definitive Edition and NextGen mods, together with the detailed map. Download the mods in “HD textures…”. The app turns on the game\'s detailed map when it opens; the HUD stays as you left it. Applies when the game starts or reloads)</small>',
  sUnblock: 'DirectX 11 mode (Dawn D3D11) <small>(for graphics without DirectX 12. Turns off HD textures, the new drawing, FXAA and the image filter and sets the game graphics to the minimum; you can turn them back on later. If the screen goes black, lower the game graphics. It may cause picture errors or freezes)</small>',
  sLighter: 'Ease the processor (Dawn skip_validation) <small>(stops checking each graphics command. Small gain, ~0.1 ms per frame. If the game has a graphics error, it may freeze)</small>',
  sNewDrawing: 'Draw the screen the new way (Graphite + Delegated Compositing) <small>(another way of drawing the picture, and Windows assembles the final picture. While playing on an RTX 4060: frames 3% to 10% faster and up to 30% fewer missed frames)</small>',
  sLightMode: 'Light mode <small>(for weak PCs or low FPS. In the game, turns off the heavy mods: crash damage, stance, parts on other cars, HQ vinyls, sharper roads, daytime, skateboard and skater, and the 4x anti-aliasing. Tunnel, garage and HUD stay as they are. In the app, turns off HD Textures, FXAA and the image pack, and turns on the options that ease the processor. Applies when the app is reopened; turning it off puts the game back as it was)</small>',
  sAntiAlias: 'Anti-aliasing (FXAA) <small>(makes edges smoother, right away. Costs ~0.2 ms per frame and takes a little sharpness from text and details. Stays out when the game\'s own anti-aliasing is on)</small>',
  hImage: 'Game picture',
  sImage: 'Picture pack (CAS sharpening, bloom, color and vignette, done by the app engine) <small>(changes the picture right away, without reopening the app. In NFSU2 it costs little, ~0.15 to 0.3 ms per frame; check with F8. In Most Wanted and Carbon only color and sharpness apply, through CSS filter)</small>',
  imgMode: 'Pack', imgNeon: 'Neon (glowing lights)', imgReal: 'Realistic',imgSoft: 'Soft', imgVivid: 'Vivid', imgStrong: 'Intense', imgSharp: 'Sharp', imgVividSharp: 'Vivid and sharp', imgCinema: 'Cinema', imgBw: 'Black and white', imgSunset: 'Sunset',
  advanced: 'Advanced',
  sPrepare: 'Prepare the game while loading <small>(optimizes the whole game at the start, not during the race. Heavier in the first seconds and may reduce stutters later)</small>',
  hPerf: 'Performance',
  perfNote: 'Priority applies right away; the others when the app is reopened. The numbers come from tests on an RTX 4060 at 1440p, outside the game: compare while playing, with F8.',
  restart: 'Reopen the app to apply', restartNote: 'The open session will be closed (save in the game first).',
  sPrio: '“Above normal” priority for the game <small>(Windows favors the game. It only helps with other heavy programs open)</small>',
  hKeys: 'Shortcuts',
  kToggle: 'Enter and leave fullscreen <small class="muted">(also leaves protected mode; Alt+Enter does the same)</small>',
  kExit: 'Leave protected mode <small class="muted">(works even when the window is not focused)</small>',
  kNote: 'Use Ctrl or Alt (Shift optional) + a key the game does not use (F, G, K, L, Q, T, U, V, Y, Z, 5–0, F1–F7…). Game keys (WASD, arrows, Space, C, B, R, M, P, 1–4…) only with Ctrl+Alt+Shift, because Ctrl/Shift change gears and Alt is nitrous. F11 also enters fullscreen in window mode. <b>Ctrl+Alt+O</b> opens and closes these settings; <b>Esc</b> goes back. F5 and the other function keys go to the game.',
  hGpu: 'WebGPU and GPU', gpuTest: 'Test again',
  hDiag: 'Stutter diagnostics',
  diagNote: '<b>Report</b>: saves a text file with the versions, graphics card and driver, monitors (resolution and Hz) and app options, plus the known problems the app can detect. It stays on your PC; send it to whoever is helping. Create it with the game open, right after a stutter.',
  diag: 'Save diagnostic report',
  hMaint: 'Maintenance', reload: 'Restart the game', cache: 'Clear cache',
  maintNote: '“Clear cache” does not touch your saves.',
  escBack: 'Esc also goes back',
  loading: 'Loading the game…',
  errTitle: 'Could not load the game', errRetry: 'Trying to reconnect automatically every 5 seconds.',
  retry: 'Try now', dnsTry: 'Try with secure DNS', exitProt: 'Leave protected mode', quitApp: 'Close the app',
  hCustom: 'Customization',
  customNote: 'Replace the home screen <b>background</b> and the <b>cover</b> (the disc) of each game with a PNG or JPG image from your PC. The cover is round: the app uses the middle square of the image. “Default” goes back to the original image.',
  hUpdate: 'Updates',
  updNote: 'The app downloads new versions by itself, outside the game, and checks the file. It installs when you click <b>Update now</b> on the home screen or when you close the app. Nothing from your PC is sent.',
  updCheck: 'Check now', updOpen: 'Open the versions page', updGet: 'Update now',
  hSaves: 'Save copies (NFSU2)',
  savesNote: 'When it opens, the app keeps a copy of your save, only if it changed. The last 2 versions stay, only on your PC, and nothing is sent. The app never puts a copy back by itself. <b>Only restore if you lost your save:</b> a copy may be older than your game and replaces what is in it. To bring one back: in the game, under <b>Saved games &gt; Restore</b>, pick the newest file in the folder.',
  savesOpen: 'Open the copies folder', mySaves: 'My saves',
};

const orig = new Map(); // português original de cada elemento (lido do ui.html na primeira troca)
function apply(lang) {
  const en = lang === 'en';
  document.documentElement.lang = en ? 'en' : 'pt-BR';
  const swap = (sel, attr, get, set) => {
    for (const n of document.querySelectorAll(sel)) {
      const k = n.getAttribute(attr);
      const id = `${attr}:${k}`;
      if (!orig.has(n)) orig.set(n, {});
      const o = orig.get(n);
      if (!(id in o)) o[id] = get(n);
      set(n, en && EN[k] !== undefined ? EN[k] : o[id]);
    }
  };
  swap('[data-t]', 'data-t', (n) => n.innerHTML, (n, v) => { n.innerHTML = v; });
  swap('[data-tt]', 'data-tt', (n) => n.title, (n, v) => { n.title = v.replace(/<[^>]+>/g, ''); });
  swap('[data-ta]', 'data-ta', (n) => n.getAttribute('aria-label'), (n, v) => { n.setAttribute('aria-label', v.replace(/<[^>]+>/g, '')); });
}

// Mensagens de atalho inválido vêm do combo.js em português: tradução para o inglês.
const COMBO_EN = {
  'Combinação vazia.': 'Empty combination.',
  'Tecla não suportada.': 'Key not supported.',
  'Use apenas Ctrl, Alt e Shift (a tecla Windows é reservada pelo sistema).': 'Use only Ctrl, Alt and Shift (the Windows key is reserved by the system).',
  'Modificador repetido.': 'Repeated modifier.',
  'Inclua Ctrl ou Alt para evitar disparos acidentais durante o jogo.': 'Include Ctrl or Alt to avoid accidental triggers during the game.',
  'Formato inválido.': 'Invalid format.',
  'Combinação reservada pelo Windows ou bloqueada pelo app.': 'Combination reserved by Windows or blocked by the app.',
  'Os dois atalhos não podem ser iguais.': 'The two shortcuts cannot be the same.',
};
function comboError(msg, lang) {
  if (lang !== 'en' || !msg) return msg;
  if (COMBO_EN[msg]) return COMBO_EN[msg];
  const m = /^(\S+) é tecla do jogo/.exec(msg);
  if (m) return `${m[1]} is a game key: with Ctrl (gear) or Alt (nitrous) it fires by accident during a race. Use a key the game does not use (F, G, K, L, Q, T, U, V, Y, Z, 5–0, F1–F7) or Ctrl+Alt+Shift.`;
  return msg;
}

const api = { EN, apply, comboError };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.I18n = api;
})();
