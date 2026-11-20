'use strict';
// "Reportar problema": junta o texto do jogador, o diagnóstico e o log do jogo (só com a caixa marcada) e manda ao
// intermediário (relatos/worker.js, Cloudflare), que abre a issue no GitHub. O app não tem token nenhum.

const RELAY_URL = 'https://nfs-relatos.vtrspeedman.workers.dev/relato';
const WORLD = 1078;            // mundo isolado só para ler a cópia do log (fpsWatch usa o 1077)
const LOG_MAX = 180000;
const LOG_HEAD = 30000;        // de um log grande vai o começo (versão, placa) e o fim (onde deu o erro)
const TEXT_MAX = 4000;

// O jogo (nfsu2-web) guarda no localStorage uma cópia curta e já limpa do log da última partida de cada save.
const readCode = `(() => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i);
  if (k && k.startsWith('nfsu2.lastgame.')) out.push(localStorage.getItem(k)); } } catch (e) {} return out; })()`;

const when = (r) => Number(new Date(r.saved || r.started || 0)) || 0;

// A partida mais recente que já terminou ou que começou antes desta página abrir (a de agora ainda está rodando).
// Registro sem log (partida recém-começada) não conta.
function pickLast(raw, before = Infinity) {
  let best = null;
  for (const s of raw || []) {
    let r;
    try { r = JSON.parse(s); } catch { continue; }
    if (!r || typeof r.log !== 'string' || !r.log.trim()) continue;
    if (!r.ended && !(Number(new Date(r.started)) < before)) continue;
    if (!best || when(r) > when(best)) best = r;
  }
  return best;
}

const ERR = /TRAP in thread|\[watchdog\] no Present|device lost|GPU-[A-Z]|DEVICE_HUNG|out of memory|SAVES-|STORAGE-|\bfailed\b|\berror\b|exception|\bpanic\b|\babort/i;
const BENIGN = /\b(no|0) errors?\b|without errors?/i;
function errorLines(log, max = 40) {
  const out = [];
  for (const l of String(log || '').split(/\r?\n/)) {
    if (ERR.test(l) && !BENIGN.test(l)) { out.push(l.slice(0, 300)); if (out.length >= max) break; }
  }
  return out;
}

// Deu erro? Saída normal = "exit" com código 0/-1 ou página fechada. Sem fim gravado só conta se o log tem erro
// (fechar o app nem sempre deixa o jogo gravar o fim).
function endedBadly(r) {
  if (!r) return false;
  const e = r.ended;
  if (!e) return errorLines(r.log, 1).length > 0;
  if (e.why === 'page closed') return false;
  if (e.why === 'exit') return !(e.code === 0 || e.code === -1);
  return true;
}

// Mais uma limpeza por cima da do jogo: nome de usuário do Windows e e-mails.
const scrub = (s) => String(s || '')
  .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, '$1<usuario>')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');

function trimLog(log) {
  const s = scrub(log);
  if (s.length <= LOG_MAX) return s;
  return `${s.slice(0, LOG_HEAD)}\n\n[... ${s.length - LOG_MAX} caracteres cortados ...]\n\n${s.slice(-(LOG_MAX - LOG_HEAD))}`;
}

function payload({ texto, jogo, app, origem, diag, rec, withDiag, withLog }) {
  const p = { texto: String(texto || '').slice(0, TEXT_MAX), jogo: String(jogo || ''), app: String(app || ''), origem: String(origem || '') };
  if (withDiag && diag) p.diag = scrub(diag);
  if (withLog && rec) {
    p.log = trimLog(rec.log);
    p.erros = scrub(errorLines(rec.log).join('\n'));
  }
  return p;
}

module.exports = { RELAY_URL, WORLD, readCode, when, pickLast, errorLines, endedBadly, scrub, trimLog, payload, LOG_MAX, TEXT_MAX };
