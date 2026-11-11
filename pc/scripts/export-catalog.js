'use strict';
// Catálogo de jogos para o app Android: o mesmo do app de PC (src/main/config.js). Jogo novo = só mexer lá.
// Uso: node scripts/export-catalog.js <catalogo.json>
const fs = require('fs');
const path = require('path');
const { GAMES, GAME_IDS, DEFAULT_GAME } = require('../src/main/config');

const file = process.argv[2];
if (!file) { console.error('uso: node scripts/export-catalog.js <catalogo.json>'); process.exit(1); }
const games = GAME_IDS.map((id) => {
  const g = GAMES[id];
  return { id, short: g.short, name: g.name, url: g.url, startUrl: g.startUrl || g.url, hosts: g.hosts, disc: g.disc, textures: !!g.textures, host: new URL(g.url).host };
});
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ defaultGame: DEFAULT_GAME, games }));
console.log(`catálogo exportado: ${games.map((g) => g.short).join(', ')} -> ${file}`);
