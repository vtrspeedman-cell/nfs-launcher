'use strict';
// Ponte mínima entre a interface LOCAL (ui.html) e o processo principal.
// A página do jogo (nfsu2.xyz) não recebe preload nem acesso a estas funções.
const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('launcher', {
  getState: () => call('state:get'),
  onState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('state:update', h);
    return () => ipcRenderer.removeListener('state:update', h);
  },
  start: (gameId) => call('game:start', String(gameId || '')),
  reload: () => call('game:reload'),
  reloadAsk: () => call('game:reload-ask'),
  trySecureDns: () => call('game:secure-dns'),
  nextImageMode: () => call('image:next'),
  openTextures: () => call('screen:textures'),
  applyTextures: (draft) => call('textures:apply', draft && typeof draft === 'object' ? { on: !!draft.on, parts: { ...draft.parts } } : null),
  downloadTextures: (id) => call('textures:download', String(id)),
  removeTextures: (id) => call('textures:remove', String(id)),
  cancelTextures: () => call('textures:cancel'),
  goHome: () => call('game:home'),
  toggleFullscreen: () => call('window:toggle-fullscreen'),
  exitProtected: () => call('window:exit-protected'),
  openSettings: () => call('screen:settings'),
  back: () => call('screen:back'),
  setSetting: (key, value) => call('settings:set', key, value),
  setCapturing: (on) => call('capture:set', !!on),
  resetCache: () => call('cache:reset'),
  openSaveCopies: () => call('saves:open'),
  gpuStatus: () => call('gpu:status'),
  reportGpu: (result) => call('gpu:report', result),
  saveDiagnostics: () => call('diag:save'),
  restart: () => call('app:restart'),
  pickCustom: (gameId, kind) => call('custom:pick', String(gameId), String(kind)),
  resetCustom: (gameId, kind) => call('custom:reset', String(gameId), String(kind)),
  customImages: () => call('custom:get'),
  checkUpdates: () => call('update:check'),
  openUpdates: () => call('update:open'),
  installUpdate: () => call('update:install'),
  quit: () => call('app:quit'),
});
