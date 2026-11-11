'use strict';
// Configuração fixa do app (não é preferência do usuário).
// Catálogo de jogos: cada um abre o próprio site. Para acrescentar um jogo: id + site + hosts + imagem do CD em src/renderer/games/.
// App "NFS Launcher" no Discord Developer Portal (só o Application ID, que é público). Vazio = não aparece no Discord.
const DISCORD_APP = '1566579761193426986';
const GAMES = Object.freeze({
  nfsu2: Object.freeze({
    id: 'nfsu2', short: 'NFSU2', name: 'Need for Speed: Underground 2',
    // startUrl: só o START usa (convite da equipe; o site tira o "#" e pergunta se quer entrar). Recarregar usa `url`:
    // com a página aberta, o mesmo endereço com "#" só muda o "#", não recarrega nada e deixaria o "Carregando" preso.
    url: 'https://nfsu2.xyz', startUrl: 'https://nfsu2.xyz/#crew=U2BR', hosts: ['nfsu2.xyz', 'www.nfsu2.xyz'], disc: 'games/nfsu2.png',
    textures: true, saves: true, partition: 'persist:nfsu2',
    discordId: DISCORD_APP,
  }),
  // NFSU2 Modded (pedido do Bruno, 09/11): o mesmo nfsu2-web com carros e mods a mais. Mesma cidade, então as Texturas HD
  // valem nele. Pasta de dados própria: os saves e o settings.ini dos dois sites nunca se misturam (cópia do save e a
  // linha "ui_textures" procuram um arquivo só por pasta). Sem convite de equipe: não se sabe se as equipes são as mesmas.
  nfsu2mod: Object.freeze({
    id: 'nfsu2mod', short: 'NFSU2 Modded', name: 'Need for Speed: Underground 2 Modded',
    url: 'https://nfsu2mod.xyz', hosts: ['nfsu2mod.xyz', 'www.nfsu2mod.xyz'], disc: 'games/nfsu2mod.png',
    textures: true, saves: true, partition: 'persist:nfsu2mod', savesDir: 'NFSU2 Modded',
    discordId: DISCORD_APP,
  }),
  nfsmw: Object.freeze({
    id: 'nfsmw', short: 'NFSMW', name: 'Need for Speed: Most Wanted',
    // ".nfsmwo.com" = qualquer subdomínio (o cadastro/login pode passar por outro endereço do mesmo site e voltar).
    url: 'https://web.nfsmwo.com', hosts: ['nfsmwo.com', '.nfsmwo.com'], disc: 'games/nfsmw.png', partition: 'persist:nfsu2',
    discordId: DISCORD_APP,
  }),
  // Carbon (pedido do Bruno, 05/11): canvas #canvas, como o Most Wanted. Sem convite de equipe: o site não tem `#crew=`.
  nfsc: Object.freeze({
    id: 'nfsc', short: 'NFSC', name: 'Need for Speed: Carbon',
    url: 'https://nfscrb.xyz', hosts: ['nfscrb.xyz', '.nfscrb.xyz'], disc: 'games/nfsc.png', partition: 'persist:nfsu2',
    discordId: DISCORD_APP,
  }),
});
const GAME_IDS = Object.keys(GAMES);
const DEFAULT_GAME = 'nfsu2';

// Hosts para os quais a NAVEGAÇÃO é permitida (de todos os jogos, ou só do jogo aberto).
// Recursos carregados pela página (imagens, scripts, WebSockets, saves na nuvem) não passam por esta lista.
const ALLOWED_HOSTS = new Set(GAME_IDS.flatMap((id) => GAMES[id].hosts));

// Um host da lista vale exatamente; um que começa com "." vale para qualquer subdomínio dele.
const hostMatches = (host, list) => [...list].some((h) => (h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h));
function isAllowedUrl(u, gameId) {
  try {
    const x = new URL(u);
    const hosts = gameId && GAMES[gameId] ? GAMES[gameId].hosts : ALLOWED_HOSTS;
    return x.protocol === 'https:' && !x.username && !x.password && hostMatches(x.hostname, hosts);
  } catch {
    return false;
  }
}
// Links que o jogo abre em nova aba e que vão para o navegador do Windows (nunca dentro do app).
// open.spotify.com: botão "Open the official playlist" das músicas do NFSU2 (pedido do Bruno, 11/11).
// fm.bot: link ".fmbot" (estatísticas do Last.fm no Discord), embaixo do Last.fm nas músicas do NFSU2 (11/11).
const EXTERNAL_HOSTS = Object.freeze(['open.spotify.com', 'fm.bot']);
function isExternalUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !x.username && !x.password && !x.port && EXTERNAL_HOSTS.includes(x.hostname);
  } catch {
    return false;
  }
}
const gameOf = (id) => GAMES[id] || GAMES[DEFAULT_GAME];
// Endereço do START: em inglês, o normal, sem o convite da equipe brasileira (pedido do Bruno).
// O convite aparece no máximo CREW_MAX vezes (pedido do Bruno, 10/11); invites = quantas já abriram com ele.
const CREW_MAX = 2;
const startUrlOf = (id, lang, invites = 0) => {
  const g = gameOf(id);
  return lang === 'en' || !(invites < CREW_MAX) ? g.url : g.startUrl || g.url;
};

// DNS seguro, na ordem em que é tentado. Pelo IP: funciona mesmo quando o DNS da rede não resolve nome nenhum.
const SECURE_DNS = Object.freeze({
  cloudflare: Object.freeze(['https://1.1.1.1/dns-query', 'https://1.0.0.1/dns-query']),
  google: Object.freeze(['https://8.8.8.8/dns-query', 'https://8.8.4.4/dns-query']),
});

// A partição principal continua com o nome antigo para não perder os saves do NFSU2; cada site guarda os próprios dados.
// O NFSU2 Modded tem a dele (ver acima). PARTITIONS: todas, na ordem do catálogo, sem repetir.
const PARTITION = 'persist:nfsu2';
const PARTITIONS = Object.freeze([...new Set(GAME_IDS.map((id) => GAMES[id].partition))]);
// Jogos com Texturas HD (o pacote do app passa só pelo site deles) e com cópia do save (zip em "NFS Launcher Saves").
const TEX_GAMES = Object.freeze(GAME_IDS.filter((id) => GAMES[id].textures));
const SAVE_GAMES = Object.freeze(GAME_IDS.filter((id) => GAMES[id].saves));
// Login do Last.fm (botão "Conectar" nas músicas do NFSU2): abre numa janelinha do próprio app, na mesma partição do
// jogo, porque a volta (lastfm.html do site) grava o resultado no armazenamento do site e fecha a janela sozinha.
// No navegador do Windows a volta cairia lá e o jogo nunca saberia.
const LOGIN_HOSTS = Object.freeze(['www.last.fm', 'last.fm']);
function isLoginUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !x.username && !x.password && !x.port && LOGIN_HOSTS.includes(x.hostname);
  } catch {
    return false;
  }
}

module.exports = { LOGIN_HOSTS, isLoginUrl, SECURE_DNS, GAMES, GAME_IDS, DEFAULT_GAME, ALLOWED_HOSTS, isAllowedUrl, EXTERNAL_HOSTS, isExternalUrl, gameOf, startUrlOf, CREW_MAX, PARTITION, PARTITIONS, TEX_GAMES, SAVE_GAMES };
