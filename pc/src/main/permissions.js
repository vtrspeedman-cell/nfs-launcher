'use strict';
// Permissões que o site do jogo pode receber — lógica PURA (sem Electron), coberta por testes.
// Baseado no código aberto do port (github.com/th0mk/nfsu2-web):
//  - app/checks.ts chama navigator.storage.persist(): sem "persistent-storage" o navegador pode apagar
//    saves e os ~2 GB de dados do jogo quando o disco fica quase cheio.
//  - radio-folder.ts usa showDirectoryPicker({ mode: 'read' }) para a pasta de músicas da Rádio:
//    "fileSystem" é liberado SOMENTE para leitura (nunca escrita).
//  - WebHID (25/11): o site liga o controle da Steam e a força do volante pelo navigator.hid. Só nos sites dos
//    jogos; o aparelho escolhido fica lembrado por fabricante:modelo (como o Chrome lembra), no máximo HID_MAX.
const { isAllowedUrl } = require('./config');

const ALWAYS = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write', 'persistent-storage']);
const HID_MAX = 16;

function allowPermission(perm, details) {
  if (ALWAYS.has(perm)) return true;
  if (perm === 'fileSystem') return !!details && details.fileAccessType === 'readable';
  if (perm === 'hid') return !!details && isAllowedUrl(String(details.requestingUrl || details.securityOrigin || ''));
  return false;
}

const hidKey = (d) => (d && Number.isInteger(d.vendorId) && Number.isInteger(d.productId) ? `${d.vendorId}:${d.productId}` : null);
function sanitizeHidGrants(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((k) => typeof k === 'string' && /^\d{1,5}:\d{1,5}$/.test(k)))].slice(0, HID_MAX);
}
// O mais recente primeiro.
function addHidGrant(list, d) {
  const k = hidKey(d);
  const cur = sanitizeHidGrants(list);
  return k ? [k, ...cur.filter((x) => x !== k)].slice(0, HID_MAX) : cur;
}
function hidGranted(list, d) {
  const k = hidKey(d);
  return !!k && Array.isArray(list) && list.includes(k);
}

module.exports = { allowPermission, ALWAYS, HID_MAX, hidKey, sanitizeHidGrants, addHidGrant, hidGranted };
