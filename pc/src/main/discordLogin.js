'use strict';
// Vínculo com o Discord da aba Names do site do NFSU2 (25/11): lógica PURA, coberta por testes.
// O botão do site ("Link Discord" / "Log in with Discord") guarda uma marca no sessionStorage da aba e vai a
// /names/discord/start, que grava um cookie e manda ao login do Discord (discord.com/oauth2/authorize). O Discord
// volta a /names/discord/back, que confere o cookie e manda ao início do site com #discord=<bilhete> (ou
// #discord-error=…). O site só lê esse # ao abrir a página, na mesma aba do clique, e aí conclui o vínculo.
// No app, o login abre numa janela própria com uma partição só dela (o jogo fica na página, com a marca, e o atalho
// das Texturas HD não atrapalha os redirecionamentos); a volta fecha a janela e é aberta na view do jogo.
const { isAllowedUrl } = require('./config');

const PATH = '/names/discord/';
const LOGIN_HOSTS = Object.freeze(['discord.com']);

function parse(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !x.username && !x.password && !x.port ? x : null;
  } catch {
    return null;
  }
}
// O botão do site do jogo aberto.
function isStart(u, game) {
  const x = parse(u);
  return !!x && isAllowedUrl(u, game) && x.pathname === `${PATH}start`;
}
// Endereços da janela do login: o Discord e o caminho do vínculo no site do jogo.
function isFlow(u, game) {
  const x = parse(u);
  return !!x && (LOGIN_HOSTS.includes(x.hostname) || (isAllowedUrl(u, game) && x.pathname.startsWith(PATH)));
}
// A volta: qualquer endereço do site do jogo fora do caminho do vínculo.
function isReturn(u, game) {
  const x = parse(u);
  return !!x && isAllowedUrl(u, game) && !x.pathname.startsWith(PATH);
}
// Abrir na view um endereço que só muda no "#" não recarrega a página (o Chromium só troca o #), e o site só lê o
// bilhete ao abrir: nesse caso o app recarrega depois.
function sameDocument(cur, next) {
  const a = parse(cur);
  const b = parse(next);
  if (!a || !b || !String(next).includes('#')) return false;
  a.hash = '';
  b.hash = '';
  return a.href === b.href;
}

module.exports = { PATH, LOGIN_HOSTS, isStart, isFlow, isReturn, sameDocument };
