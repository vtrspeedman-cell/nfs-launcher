'use strict';
// Verificações estáticas do projeto (rodam em qualquer sistema, sem Electron). Uso: npm run verify
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const p = (...a) => path.join(root, ...a);
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✔ ${name}`); } catch (e) { failed++; console.log(`  ✘ ${name}\n      → ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const read = (f) => fs.readFileSync(p(f), 'utf8');

console.log('Verificando o projeto…');
const pkg = JSON.parse(read('package.json'));
check('package.json: entrada e scripts', () => {
  assert(fs.existsSync(p(pkg.main)), `main ausente: ${pkg.main}`);
  for (const s of ['start', 'dist', 'test', 'postinstall']) assert(pkg.scripts[s], `script ausente: ${s}`);
});
check('Sintaxe de todos os .js', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (['node_modules', 'dist', 'build', '.gradle'].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  for (const f of walk(root).filter((f) => f.endsWith('.js'))) execFileSync(process.execPath, ['--check', f]);
});
// Deixa só o código: comentários, textos e expressões regulares viram espaço (o que fica dentro de ${…} continua sendo código).
function soCodigo(s) {
  let out = '';
  const pilha = []; // profundidade de chaves de cada ${ aberto dentro de texto com crase
  let i = 0;
  let ultimo = ''; // último caractere de código que não é espaço (para saber se "/" abre uma expressão regular)
  const abreRegex = () => !ultimo || '(,=:[!&|?{};+-*%<>~^'.includes(ultimo) || /\b(?:return|typeof|case|in|of)\s*$/.test(out);
  const texto = () => { // dentro de crase, até a crase final ou um ${
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '`') { i++; out += ' 0 '; ultimo = '0'; return; }
      if (s[i] === '$' && s[i + 1] === '{') { i += 2; pilha.push(0); out += ' ('; ultimo = '('; return; }
      i++;
    }
  };
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; out += ' '; continue; }
    if (c === '\'' || c === '"') { i++; while (i < s.length && s[i] !== c && s[i] !== '\n') i += s[i] === '\\' ? 2 : 1; i++; out += ' 0 '; ultimo = '0'; continue; }
    if (c === '`') { i++; texto(); continue; }
    if (c === '/' && abreRegex()) {
      i++; let classe = false;
      while (i < s.length && s[i] !== '\n' && (classe || s[i] !== '/')) { if (s[i] === '\\') i++; else if (s[i] === '[') classe = true; else if (s[i] === ']') classe = false; i++; }
      i++; while (/[a-z]/.test(s[i] || '')) i++;
      out += ' 0 '; ultimo = '0'; continue;
    }
    if (pilha.length && c === '{') pilha[pilha.length - 1]++;
    if (pilha.length && c === '}') { if (pilha[pilha.length - 1] === 0) { pilha.pop(); i++; out += ') '; ultimo = ')'; texto(); continue; } pilha[pilha.length - 1]--; }
    out += c; if (!/\s/.test(c)) ultimo = c; i++;
  }
  return out;
}
// Erro da 2.0.4: um nome em MAIÚSCULAS removido continuou citado num caminho que só rodava com uma opção desmarcada,
// e o app não abria. A checagem de sintaxe não pega isso: aqui, todo nome em MAIÚSCULAS usado precisa estar declarado no arquivo.
check('Nomes em MAIÚSCULAS declarados antes de usar (erro da 2.0.4)', () => {
  const GLOBAIS = new Set(['JSON', 'URL', 'NaN', 'BOOLS', 'CSS', 'DOM']);
  const faltando = [];
  const files = ['src/main', 'src/renderer'].flatMap((d) => fs.readdirSync(p(d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));
  for (const f of files) {
    const code = soCodigo(read(f));
    const declared = new Set([
      ...[...code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
      ...[...code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((s) => s.split(':').pop().trim())),
    ]);
    for (const m of code.matchAll(/(^|[^.\w$])([A-Z][A-Z0-9_]{2,})\b(?!\s*:)/g)) {
      if (!declared.has(m[2]) && !GLOBAIS.has(m[2])) faltando.push(`${f}: ${m[2]}`);
    }
  }
  assert(!faltando.length, `usados mas não declarados: ${[...new Set(faltando)].join(', ')}`);
});
check('Arquivos referenciados pela interface existem', () => {
  const html = read('src/renderer/ui.html');
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) assert(fs.existsSync(path.join(p('src/renderer'), m[1])), `não encontrado: ${m[1]}`);
});
check('IDs usados pela interface existem no HTML', () => {
  const html = read('src/renderer/ui.html');
  const js = read('src/renderer/ui.js');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of js.matchAll(/\$\('([^']+)'\)/g)) assert(ids.has(m[1]), `id ausente no HTML: ${m[1]}`);
  for (const m of js.matchAll(/const BOOLS = \[([^\]]+)\]/g)) {
    for (const k of m[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1))) assert(ids.has(`s-${k}`), `checkbox ausente: s-${k}`);
  }
});
check('Interface com CSP restritiva e sem scripts/estilos inline', () => {
  const html = read('src/renderer/ui.html');
  assert(/Content-Security-Policy/.test(html), 'CSP ausente');
  assert(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'script inline encontrado');
  assert(!/\sstyle="/.test(html), 'style inline encontrado');
});
check('Ícone .ico válido (inclui 256x256)', () => {
  const b = fs.readFileSync(p('build/icon.ico'));
  assert(b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1, 'cabeçalho ICO inválido');
  const sizes = Array.from({ length: b.readUInt16LE(4) }, (_, i) => b[6 + i * 16] || 256);
  assert(sizes.includes(256), `tamanhos: ${sizes.join(',')}`);
});
check('Configuração do electron-builder', () => {
  const b = pkg.build;
  assert(b.win.icon && fs.existsSync(p(b.win.icon)), 'ícone do build ausente');
  assert(b.nsis.include && fs.existsSync(p(b.nsis.include)), 'installer.nsh ausente');
  assert(b.files.includes('src/**/*'), '"src/**/*" não está em build.files');
  assert(/\.exe$/.test(b.nsis.artifactName), 'artefato não é .exe');
  for (const [key, w, h] of [['installerSidebar', 164, 314], ['uninstallerSidebar', 164, 314], ['installerHeader', 150, 57]]) {
    const img = fs.readFileSync(p(b.nsis[key]));
    assert(img.toString('latin1', 0, 2) === 'BM' && img.readInt32LE(18) === w && Math.abs(img.readInt32LE(22)) === h && img.readUInt16LE(28) === 24, `${key}: precisa ser BMP ${w}×${h} de 24 bits`);
  }
});
check('Segurança do processo principal', () => {
  const m = read('src/main/main.js');
  assert(!/nodeIntegration:\s*true/.test(m), 'nodeIntegration habilitado');
  assert(!/contextIsolation:\s*false/.test(m), 'contextIsolation desabilitado');
  assert(!/sandbox:\s*false/.test(m), 'sandbox desabilitado');
  assert(!/webSecurity:\s*false/.test(m), 'webSecurity desabilitado');
  assert(/will-navigate/.test(m) && /setWindowOpenHandler/.test(m), 'restrição de navegação ausente');
});
check('Saves protegidos: a cópia antiga sai antes de abrir os dados', () => {
  const m = read('src/main/main.js');
  const a = m.indexOf('profileLock.acquire(');
  assert(a > 0, 'espera pela cópia antiga ausente');
  assert(a < m.indexOf('session.fromPartition(') && a < m.indexOf('createWindow();'), 'dados abertos antes da espera');
  assert(/if \(!onlyCopy\)[\s\S]{0,300}app\.exit\(0\);\s*return;/.test(m), 'abre os dados mesmo com a cópia antiga viva');
  assert(!/clearStorageData\(\s*\)|clearData\(/.test(m), 'o app não pode apagar os dados do jogo');
  const limpezas = m.match(/clearStorageData\([^)]*\)/g) || [];
  assert(limpezas.every((c) => /storages:\s*\['shadercache'\]/.test(c)), 'limpeza além do cache de gráficos');
});
check('Cópia do save: uma vez, antes de abrir os dados, sem internet e sem tocar nos dados do jogo', () => {
  const m = read('src/main/main.js');
  const a = m.indexOf('await copySaveAtStart()');
  assert(a > m.indexOf('profileLock.acquire(') && a < m.indexOf('session.fromPartition('), 'cópia fora do momento certo');
  assert((m.match(/copySaveAtStart\(\)/g) || []).length === 2 && (m.match(/saveCopy\.run\(/g) || []).length === 1, 'cópia em mais de um lugar');
  const s = read('src/main/saveCopy.js');
  assert(!/require\('(electron|child_process|http|https|net|tls|dns)'\)/.test(s), 'cópia com internet ou outro programa');
  const dest = (s.match(/fs\.(unlink|rm|rename|writeFile|mkdir|truncate|copyFile|appendFile)\(([^,)]+)/g) || []);
  assert(dest.length && dest.every((c) => /\(path\.join\(dest|\(`\$\{file\}|\(file|\(lastFile|\(dest/.test(c)), `escrita fora da pasta das cópias: ${dest.join(' | ')}`);
  assert(/if \(e\.name !== 'Paths'\)/.test(s), 'cópia entra no banco do navegador');
});
check('Motor próprio na montagem', () => {
  assert(pkg.build.electronDist === 'C:/e/motor-final', 'instalador sem o motor próprio');
});
check('Barra própria: em janela no topo, na tela cheia some', () => {
  const m = read('src/main/main.js');
  const css = read('src/renderer/ui.css');
  assert(/titleBarStyle:\s*'hidden'/.test(m) && /titleBarOverlay:/.test(m), 'barra do Windows de volta');
  assert(/titleH = \(\) => \(NO_UI \|\| isFullscreen\(\) \? 0 : TITLE_H\)/.test(m), 'a barra precisa sumir na tela cheia');
  const f = m.slice(m.indexOf('function refresh()'));
  assert(f.indexOf('applyNativeLock(isLocked)') < f.indexOf('layout();'), 'o layout precisa vir depois da troca de estilo (senão sobra faixa na borda)');
  assert(/body\.windowed \.corner[^}]*-webkit-app-region:\s*drag/.test(css), 'barra sem arrastar');
});
check('Sem bandeja e sem processo em segundo plano', () => {
  const m = read('src/main/main.js');
  assert(!/\bTray\b/.test(m), 'ícone de bandeja encontrado');
  assert(/window-all-closed',\s*\(\)\s*=>\s*app\.quit\(\)/.test(m), 'app não encerra ao fechar a janela');
  assert(!/\.(once|on)\('ready-to-show'/.test(m), 'janela depende de ready-to-show (nunca dispara com WebContentsView)');
});
check('Gráficos iguais ao Chrome (sem flags que mudam a composição)', () => {
  const m = read('src/main/main.js');
  for (const f of ['ignore-gpu-blocklist', 'enable-zero-copy', 'enable-gpu-rasterization', 'CalculateNativeWinOcclusion', 'force-device-scale-factor']) {
    assert(!new RegExp(`sw\\('${f}`).test(m) && !m.includes(`'disable-features', '${f}`), `flag ativa: ${f}`);
  }
  assert(!/backgroundThrottling:\s*false/.test(m), 'backgroundThrottling:false (página nunca fica "escondida", diferente do Chrome)');
  // O app não mexe no VSync: só o --uncapped, digitado à mão, tira.
  assert(/if \(VSYNC_OFF\) \{ sw\('disable-frame-rate-limit'\); sw\('disable-gpu-vsync'\); \}/.test(m) &&
    (m.match(/sw\('disable-gpu-vsync'\)/g) || []).length === 1, 'disable-gpu-vsync fora do --uncapped');
  assert(!('lowLatency' in require('../src/main/settings').DEFAULTS) && /const VSYNC_OFF = UNCAPPED;/.test(m), 'opção de VSync de volta');
});
check('Prioridade e teclado: processo de GPU intocado, teclas do jogo sem trabalho extra', () => {
  const m = read('src/main/main.js');
  const prio = m.slice(m.indexOf('function applyPriority'), m.indexOf('// ───', m.indexOf('function applyPriority')));
  assert(!/'GPU'/.test(prio), 'applyPriority mexe no processo de GPU (o Chromium já cuida dele)');
  assert(/function onInput\(event, input[^)]*\) \{\s*if \(!mayBeShortcut\(input\)\) return;/.test(m), 'onInput sem o filtro rápido');
  // Atalhos globais só em dois casos: saída do modo protegido e Alt+Espaço com a janela em foco (liberado no blur).
  const regs = [...m.matchAll(/globalShortcut\.register\(([^,]+),/g)].map((x) => x[1].trim());
  assert(regs.length === 2 && regs.includes('accel'), `globalShortcut.register inesperado: ${regs.join(', ')}`);
  assert(/win\.on\('blur', \(\) => \{\s*syncAltSpaceCatch\(\);/.test(m), 'Alt+Espaço não é liberado quando a janela perde o foco');
});
check('Janela flutuante (guia): arquivos, isolamento e não roubam o teclado do jogo', () => {
  for (const f of ['guide.html']) {
    const html = read(`src/renderer/${f}`);
    assert(/Content-Security-Policy/.test(html) && !/<script(?![^>]*\bsrc=)[^>]*>/.test(html) && !/\sstyle="/.test(html), `${f} sem CSP ou com inline`);
    for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) assert(fs.existsSync(path.join(p('src/renderer'), m[1])), `${f}: não encontrado ${m[1]}`);
  }
  const m = read('src/main/main.js');
  const block = m.slice(m.indexOf('function openPanel'), m.indexOf('function closePanel'));
  assert(/focusable: false/.test(block), 'janela flutuante focável (tiraria o teclado do jogo)');
  assert(/sandbox: true/.test(block) && /contextIsolation: true/.test(block) && !/nodeIntegration: true/.test(block), 'janela flutuante sem isolamento');
  const pre = read('src/main/panelPreload.js');
  assert(!/require\((?!'electron')/.test(pre), 'preload das janelas flutuantes carrega algo além do electron');
});
check('Relatório de diagnóstico sem dados pessoais', () => {
  const d = read('src/main/diagnostics.js') + read('src/main/main.js');
  assert(!/os\.(hostname|userInfo)\(/.test(d), 'nome do PC ou do usuário no relatório');
});
check('Sem menu e sem aceleradores', () => {
  const m = read('src/main/main.js');
  assert(/Menu\.setApplicationMenu\(null\)/.test(m), 'menu da aplicação não removido');
  assert(!/accelerator\s*:/.test(m), 'há accelerator definido em menu');
});
check('App instalado sem painel de inspeção (F12) nem depuração', () => {
  const m = read('src/main/main.js');
  assert(/const DEV = !app\.isPackaged && argv\.includes\('--dev'\)/.test(m), 'DevTools disponível no app instalado');
  assert(/remote-debugging-port/.test(m), 'depuração remota aceita no app instalado');
  assert(!/chrome:\/\//.test(m), 'página chrome:// aberta pelo app');
  assert(!/devTools:\s*true/.test(m), 'devTools ligado');
  const f = pkg.build.electronFuses;
  assert(f && f.runAsNode === false && f.enableNodeOptionsEnvironmentVariable === false && f.enableNodeCliInspectArguments === false, 'executável aceita rodar como Node ou --inspect');
});
check('Permissões do site: só as necessárias (pasta de músicas só leitura)', () => {
  const { allowPermission } = require('../src/main/permissions');
  for (const perm of ['media', 'geolocation', 'notifications', 'hid', 'usb', 'serial', 'display-capture', 'clipboard-read', 'openExternal']) {
    assert(!allowPermission(perm, { fileAccessType: 'readable' }), `permissão perigosa liberada: ${perm}`);
  }
  assert(!allowPermission('fileSystem', { fileAccessType: 'writable' }), 'escrita em arquivos liberada');
  const m = read('src/main/main.js');
  // Todas as pastas de dados dos jogos (NFSU2 e NFSU2 Modded) com as mesmas regras, e nenhuma sessão aberta fora do laço.
  assert(/for \(const p of PARTITIONS\) \{\s*const ses = session\.fromPartition\(p\);\s*ses\.setPermissionRequestHandler\([^\n]*allowPermission[^\n]*\n\s*ses\.setPermissionCheckHandler\([^\n]*allowPermission/.test(m) &&
    (m.match(/session\.fromPartition\(/g) || []).length === 1, 'sessão do jogo não usa allowPermission');
});
check('Domínios permitidos', () => {
  const { ALLOWED_HOSTS, isAllowedUrl } = require('../src/main/config');
  // Só os sites do catálogo: NFSU2 (nfsu2.xyz), NFSU2 Modded (nfsu2mod.xyz), NFSMW (nfsmwo.com e subdomínios, para
  // cadastro/login) e NFSC (nfscrb.xyz).
  assert([...ALLOWED_HOSTS].every((h) => /(^|\.)nfsu2\.xyz$|(^|\.)nfsu2mod\.xyz$|(^|\.)nfsmwo\.com$|(^|\.)nfscrb\.xyz$/.test(h)), 'host extra inesperado');
  assert(isAllowedUrl('https://nfsu2mod.xyz/', 'nfsu2mod') && !isAllowedUrl('https://nfsu2.xyz/', 'nfsu2mod') &&
    !isAllowedUrl('https://nfsu2mod.xyz/', 'nfsu2') && !isAllowedUrl('https://evilnfsu2mod.xyz/', 'nfsu2mod'), 'o NFSU2 Modded só navega no próprio site');
  assert(isAllowedUrl('https://nfscrb.xyz/', 'nfsc') && isAllowedUrl('https://nfscrb.xyz/online/', 'nfsc') &&
    !isAllowedUrl('https://evilnfscrb.xyz/', 'nfsc') && !isAllowedUrl('https://nfsu2.xyz/', 'nfsc') &&
    !isAllowedUrl('https://nfscrb.xyz/', 'nfsu2'), 'o Carbon só navega no próprio site');
  assert(isAllowedUrl('https://nfsu2.xyz/') && !isAllowedUrl('http://nfsu2.xyz/') && !isAllowedUrl('https://evil.example/') &&
    !isAllowedUrl('https://nfsu2.xyz.evil.example/') && !isAllowedUrl('file:///C:/x'), 'regra de URL incorreta');
  assert(isAllowedUrl('https://web.nfsmwo.com/', 'nfsmw') && isAllowedUrl('https://login.nfsmwo.com/x', 'nfsmw') &&
    !isAllowedUrl('https://evilnfsmwo.com/', 'nfsmw') && !isAllowedUrl('https://nfsmwo.com.evil.example/', 'nfsmw') &&
    !isAllowedUrl('https://nfsu2.xyz/', 'nfsmw') && !isAllowedUrl('https://web.nfsmwo.com/', 'nfsu2'), 'cada jogo só navega no próprio site');
  // START abre o convite da equipe (nunca room); Recarregar usa o endereço sem "#", senão a página não recarrega.
  const { GAMES } = require('../src/main/config');
  assert(GAMES.nfsu2.startUrl === 'https://nfsu2.xyz/#crew=U2BR' && isAllowedUrl(GAMES.nfsu2.startUrl, 'nfsu2') && !GAMES.nfsu2.url.includes('#'), 'convite da equipe incorreto');
  const mainJs = read('src/main/main.js');
  assert(/const gameUrl = \(\) => gameOf\(currentGame \|\| cfg\.game\)\.url;/.test(mainJs), 'Recarregar não pode usar o endereço com #');
  assert((mainJs.match(/openSite\(startUrl\(id\)\)/g) || []).length === 2 && /startUrlOf\(id, cfg\.lang, cfg\.crewInvites\)/.test(mainJs),
    'o START precisa respeitar o idioma e o limite de convites');
});
check('Internet só para o jogo e para o GitHub do app (atualização e texturas); um único link externo fixo', () => {
  const m = read('src/main/main.js');
  const opens = [...m.matchAll(/shell\.openExternal\(([^)]*)\)/g)].map((x) => x[1].trim());
  assert(opens.length === 2 && [...opens].sort().join() === 'github.RELEASES_URL,url', `openExternal inesperado: ${opens.join(', ')}`);
  // O segundo é só o link de nova aba do jogo que passa por isExternalUrl (hoje só open.spotify.com, 11/11).
  assert(/else if \(isExternalUrl\(url\)\) shell\.openExternal\(url\)/.test(m), 'openExternal(url) sem isExternalUrl');
  assert(JSON.stringify(require('../src/main/config').EXTERNAL_HOSTS) === '["open.spotify.com","fm.bot"]', 'EXTERNAL_HOSTS mudou');
  assert(JSON.stringify(require('../src/main/config').LOGIN_HOSTS) === '["www.last.fm","last.fm"]', 'LOGIN_HOSTS mudou');
  assert((m.match(/action: 'allow'/g) || []).length === 1 && m.includes("if (isLoginUrl(url)) return { action: 'allow'"), 'janela nova liberada fora do login do Last.fm');
  const fetches = [...m.matchAll(/net\.fetch\(([\w.]+(?:\(\))?)/g)].map((x) => x[1].trim());
  assert(fetches.every((f) => ['gameUrl()', 'url'].includes(f)), `net.fetch inesperado: ${fetches.join(', ')}`);
  // net.fetch(url) só em fetchJson, e fetchJson só com os dois arquivos do repositório. Os downloads passam pelo
  // downloader (endereços aprovados por github.okAsset, arquivo conferido pelo SHA-256).
  const jsonCalls = [...m.matchAll(/fetchJson\(([^)]*)\)/g)].map((x) => x[1].trim()).filter((x) => x !== 'url');
  assert(jsonCalls.length && jsonCalls.every((x) => ['github.UPDATE_URL', 'github.TEXTURES_URL'].includes(x)), `fetchJson inesperado: ${jsonCalls.join(', ')}`);
  assert((m.match(/fetch: net\.fetch/g) || []).length === 2 && (m.match(/downloader\.download\(/g) || []).length === 2, 'download fora do downloader');
  // Mods (modFiles.js): o app só responde endereços do próprio NFSU2; o resto segue para o site sem mudança.
  const mods = read('src/main/modFiles.js');
  // Desde 09/11, os dois NFSU2 (nfsu2.xyz e o Modded), cada um na própria sessão; o Most Wanted e o Carbon nunca.
  const cfgMod = require('../src/main/config');
  assert(JSON.stringify(cfgMod.TEX_GAMES) === '["nfsu2","nfsu2mod"]' && cfgMod.GAMES.nfsu2mod.partition !== cfgMod.GAMES.nfsu2.partition &&
    cfgMod.GAMES.nfsmw.partition === cfgMod.PARTITION && cfgMod.GAMES.nfsc.partition === cfgMod.PARTITION, 'texturas ou pastas de dados dos jogos trocadas');
  assert(/const texAllowed = \(partition\) => \(u\) => TEX_GAMES\.some\(\(id\) => GAMES\[id\]\.partition === partition && isAllowedUrl\(u, id\)\);/.test(m) &&
    /modFiles\.install\(ses, \{ mods, allowed, log: modLog \}\)/.test(m) && (m.match(/modFiles\.install\(/g) || []).length === 1 &&
    /const r = allowed\(req\.url\) && route\(req\.url, served\);\s*if \(!r\) return pass\(req\);/.test(mods) &&
    /x\.h\.active\(cfg\.hdTextures && x\.allowed\(url\)\)/.test(m), 'mods: só os NFSU2 podem passar pelo app, e só com "Texturas melhores" ligada');
  const g = require('../src/main/github');
  assert(g.REPO === 'vtrspeedman-cell/nfs-launcher' && g.RELEASES_URL === `https://github.com/${g.REPO}/releases`, 'repositório do app trocado');
});
check('Botão de versão nova sempre na tela inicial (sem "Depois" e sem opção de desligar)', () => {
  const html = read('src/renderer/ui.html');
  assert(/id="update-box"/.test(html) && /id="update-get"/.test(html), 'botão de atualização ausente');
  assert(!/update-later|s-checkUpdates/.test(html), 'dá para esconder o aviso de versão nova');
  assert(!/cfg\.checkUpdates/.test(read('src/main/main.js')), 'verificação depende de uma opção');
  assert(/\$\('update-box'\)\.hidden = !found;/.test(read('src/renderer/ui.js')), 'aviso escondido mesmo com versão nova');
});
check('Abrir o jogo: carga normal, sem recarga sem cache e sem apagar dados', () => {
  const m = read('src/main/main.js');
  assert(!/reloadIgnoringCache/.test(m), 'recarga sem cache voltou (saiu a pedido do Bruno, 06/11)');
  const start = m.slice(m.indexOf('function startGame'), m.indexOf('// Reconexão automática'));
  assert(!/\.loadURL\((?!'about:blank')/.test(start), 'o jogo abre sem passar por openSite');
  const open = m.slice(m.indexOf('function openSite'), m.indexOf('// START com o jogo'));
  assert(!/clearCache|clearStorageData/.test(open), 'abrir o jogo apaga dados');
});
check('Opções de desempenho e qualidade ligadas por padrão (DX12); no DX11 só sai o que pesa; Discord só no canal local', () => {
  const m = read('src/main/main.js');
  const s = require('../src/main/settings').DEFAULTS;
  // Pedido do Bruno (08/11): todas ligadas por padrão no DirectX 12 (também o filtro de imagem); o modo DirectX 11
  // desmarca só as que pesam na placa de vídeo e põe os gráficos do jogo no mínimo.
  assert(s.prepareGame === true && s.highPriority === true && s.imageFilter === true && s.antiAlias === true, 'opção de desempenho ou qualidade desligada por padrão');
  const st = require('../src/main/settings');
  for (const k of ['hdTextures', 'newDrawing', 'antiAlias', 'imageFilter']) assert(st.DX11_OFF.includes(k), k + ' continua ligado no modo DirectX 11');
  for (const k of ['highPriority', 'prepareGame', 'lighterGpu']) assert(st.DX11_KEEP.includes(k) && !st.DX11_OFF.includes(k), k + ' desligado no DirectX 11 (alivia o processador)');
  assert(st.dx11Basic({}).dx11GameMin === true && /await dx11MinAtStart\(\)/.test(m), 'DirectX 11 sem os gráficos mínimos do jogo');
  assert((m.match(/sw\('js-flags'/g) || []).length === 1 && /if \(PREPARE_ON\) sw\('js-flags'/.test(m), 'js-flags fora da opção');
  assert(s.lighterGpu === true, 'aliviar o processador desligado por padrão');
  assert((m.match(/sw\('enable-dawn-features'/g) || []).length === 1 && /if \(LIGHTER_ON\) sw\('enable-dawn-features', 'skip_validation'\)/.test(m), 'opção do motor gráfico fora do teste');
  assert(s.unblockGpu === false, 'liberar a placa ligado por padrão');
  assert((m.match(/sw\('disable-dawn-features'/g) || []).length === 1 && /if \(UNBLOCK_ON\) sw\('disable-dawn-features', 'adapter_blocklist'\)/.test(m), 'liberar a placa fora da opção');
  assert((m.match(/sw\('use-webgpu-adapter'/g) || []).length === 1 && /if \(UNBLOCK_ON\) sw\('use-webgpu-adapter', 'd3d11'\)/.test(m), 'DirectX 11 fora da opção');
  assert(s.newDrawing === true, 'Graphite e Delegated deveriam vir ligados por padrão');
  assert(/NEW_DRAWING_ON && '[^']*SkiaGraphite[^']*DelegatedCompositing'/.test(m), 'Graphite e Delegated deveriam ligar juntos, na mesma opção');
  assert(s.antiAlias === true && s.imageFilter === true, 'anti-serrilhado ou filtro de imagem desligado por padrão');
  assert((m.match(/insertCSS\(/g) || []).length === 1 && /imageFilter\.css\(cfg\.imageFilter, cfg\.imageMode, cfg\.antiAlias && !gameAaNow\(currentGame\)\)/.test(m), 'CSS no jogo fora do pacote de imagem, ou FXAA por cima do anti-serrilhado do próprio jogo');
  assert((m.match(/sw\('enable-features'/g) || []).length === 1 && /if \(NEW_DRAWING_ON\) sw\('enable-features', DRAW_FEATURES\)/.test(m), 'desenho da tela fora da opção');
  // Pacotes de imagem: o motor só age com a linha --nfs-image que o app põe por CSS; sem ela, nada roda.
  const inc = read('motor/nfs-imagem.inc');
  assert(/"--nfs-image"/.test(inc) && /if \(\(!nfs_fxaa_ && !nfs_grade_\) \|\| nfs_unsupported_\) \{\s*return;/.test(inc) && !/NfsAntiAlias/.test(m), 'efeitos do motor fora da opção');
  {
    const img = require('../src/main/imageFilter');
    const wgsl = read('motor/nfs-imagem.wgsl');
    assert(img.FX_KEYS.length === 14 && /std::array<float, 14> kNeutral/.test(inc), 'app e motor com quantidades diferentes de valores');
    for (const e of ['fs_fxaa', 'fs_down', 'fs_blur_h', 'fs_blur_v', 'fs_blur_h2', 'fs_blur_v2', 'fs_grade']) assert(wgsl.includes('fn ' + e + '(') && inc.includes('"' + e + '"'), 'efeito sem par no motor: ' + e);
    const lim = (nome) => inc.match(new RegExp('k' + nome + ' = \\{\\s*([^}]+)\\}'))[1].split(',').map((x) => parseFloat(x));
    const mn = lim('Min'); const mx = lim('Max'); const ne = lim('Neutral');
    img.FX_KEYS.forEach((k, i) => assert(img.RANGE[k][0] === mn[i] && img.RANGE[k][1] === mx[i] && img.NEUTRAL[k] === ne[i], 'limite ou neutro diferente no motor: ' + k));
    for (const id of img.MODE_IDS) for (const [k, v] of Object.entries(img.MODES[id].fx)) assert(img.RANGE[k] && v >= img.RANGE[k][0] && v <= img.RANGE[k][1], id + ': valor fora do limite do motor (' + k + ')');
  }
  assert(!/g_FSAALevel=1/.test(read('src/main/gameSettings.js').replace(/\/\/.*$/gm, '')), 'o app não liga o anti-serrilhado do jogo: só lê');
  const d = read('src/main/discord.js');
  assert(/\\\\\\\\\?\\\\pipe\\\\discord-ipc-/.test(d) && !/https?:|require\('(http|https|tls|dns)'\)/.test(d), 'Discord fora do canal local');
  assert(/s\.settings\.sounds && s\.screen !== 'none'/.test(read('src/renderer/ui.js')), 'sons ligados durante o jogo');
});
check('Personalização: imagens refeitas pelo app, só PNG/JPG, nomes fixos', () => {
  const c = require('../src/main/custom');
  assert(c.EXTS.every((e) => ['png', 'jpg', 'jpeg'].includes(e)), 'formato extra aceito');
  assert(c.fileFor('x', '../a', 'bg') === null && c.fileFor('x', 'nfsu2', '__proto__') === null, 'caminho vindo de fora aceito');
  const m = read('src/main/main.js');
  const pick = m.slice(m.indexOf('async function pickCustom'), m.indexOf('function resetCustom'));
  assert(/nativeImage\.createFromPath/.test(pick) && /toJPEG|toPNG/.test(pick) && !/copyFile/.test(pick), 'imagem guardada sem ser refeita');
});
console.log(failed ?`\n${failed} verificação(ões) falharam.` : '\nTudo certo.');
process.exit(failed ? 1 : 0);
