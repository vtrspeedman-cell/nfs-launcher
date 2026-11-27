// Cria no GitHub as releases da versão atual (pc-<versão de pc/package.json>, android-<MainActivity.VERSION>)
// e a das texturas (texturas-1), e envia os arquivos. Pula o que já foi enviado com o mesmo tamanho.
// Usa o login que o git já guardou no Windows (não imprime o token). Uso, em pc/: node scripts/releases.js [pc] [android] [texturas]
// Depois: enviar o main (git push) e conferir com node scripts/conferir-github.js.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'vtrspeedman-cell/nfs-launcher';
const ROOT = path.join(__dirname, '..', '..');
const GIT = 'C:/Program Files/Git/cmd/git.exe';
const cred = execFileSync(GIT, ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n' }).toString();
const TOKEN = (cred.match(/^password=(.*)$/m) || [])[1];
if (!TOKEN) throw new Error('sem login do GitHub no git');

const pcV = require(path.join(ROOT, 'pc', 'package.json')).version;
const anV = fs.readFileSync(path.join(ROOT, 'mobile/app/java/xyz/nfs/launcher/MainActivity.java'), 'utf8').match(/VERSION\s*=\s*"([^"]+)"/)[1];
const notes = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')).novidades.pt;
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').toUpperCase();
const D = path.join(ROOT, 'dist');
const T = 'C:/e/texturas/';
const ALL = {
  texturas: { tag: 'texturas-1', name: 'Texturas HD (pacote 1)', latest: 'false',
    body: () => 'Pacotes de texturas HD do NFSU2 baixados pelo próprio NFS Launcher (janela "Texturas HD" no PC, Configurações > Texturas HD no celular). Não precisa baixar à mão.\n\nMods da comunidade: TexWizard, Redux, Definitive Edition e NextGen, com o mapa detalhado do site. Os direitos são dos autores de cada mod.',
    files: ['fontes/site.pak', 'fontes/texwizard.pak', 'fontes/redux.pak', 'fontes/definitive.pak', 'fontes/nextgen.pak',
      'celular-github/texwizard-1x.pak', 'celular-github/texwizard-2x.pak', 'celular-github/nextgen-1x.pak', 'celular-github/nextgen-2x.pak'].map(f => T + f) },
  android: { tag: 'android-' + anV, name: 'NFS Launcher Android ' + anV, latest: 'false', files: [path.join(D, `NFS-Launcher-Android-${anV}.apk`)],
    body: () => notes('mobile/atualizacao.json') + '\n\nSHA-256: ' + sha(path.join(D, `NFS-Launcher-Android-${anV}.apk`)) },
  pc: { tag: 'pc-' + pcV, name: 'NFS Launcher PC ' + pcV, latest: 'true', files: [path.join(D, `NFS-Launcher-Setup-${pcV}.exe`)],
    body: () => notes('pc/atualizacao.json') + '\n\nSHA-256: ' + sha(path.join(D, `NFS-Launcher-Setup-${pcV}.exe`)) },
};
ALL.motor = { tag: 'motor-156.0.8078.49', name: 'Motor do PC (backup para montar)', latest: 'false',
  body: () => 'Backup para remontar o app do PC sem compilar o Chromium: motor-final (Electron 45.1.0 / Chromium 156.0.8078.49 com as correções de pc/motor) e o perfil PGO nfs-jogo.profdata. Como usar: docs/reconstruir.md.',
  files: ['C:/e/backup/motor-final-3.2.3.zip', 'C:/e/backup/pgo-nfs-jogo.zip'] };
const pick = process.argv.slice(2);
const RELEASES = (pick.length ? pick : ['texturas', 'android', 'pc']).map(k => ALL[k]);

function api(method, url, body) {
  return fetch(url, { method, headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'nfs-launcher-release', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
}

function upload(uploadUrl, file) {
  const size = fs.statSync(file).size;
  const u = new URL(uploadUrl.replace(/\{.*\}$/, '') + '?name=' + encodeURIComponent(path.basename(file)));
  return new Promise((ok, fail) => {
    const req = https.request(u, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'nfs-launcher-release',
      'Content-Type': 'application/octet-stream', 'Content-Length': size } }, res => {
      let t = ''; res.on('data', c => (t += c)); res.on('end', () => (res.statusCode === 201 ? ok() : fail(new Error(`${path.basename(file)}: ${res.statusCode} ${t.slice(0, 300)}`))));
    });
    req.on('error', fail);
    let sent = 0, last = 0;
    const s = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    s.on('data', c => { sent += c.length; const p = Math.floor(sent * 100 / size); if (p >= last + 25) { last = p; console.log(`  ${path.basename(file)} ${p}%`); } });
    s.pipe(req);
  });
}

(async () => {
  for (const r of RELEASES) {
    let rel = await api('GET', `https://api.github.com/repos/${REPO}/releases/tags/${r.tag}`);
    if (rel.status === 404) {
      rel = await api('POST', `https://api.github.com/repos/${REPO}/releases`, { tag_name: r.tag, target_commitish: 'main', name: r.name, body: r.body(), make_latest: r.latest });
      if (rel.status !== 201) throw new Error(`${r.tag}: ${rel.status} ${JSON.stringify(rel.data).slice(0, 300)}`);
      console.log('release criada:', r.tag);
    } else console.log('release já existe:', r.tag);
    const have = new Map((rel.data.assets || []).map(a => [a.name, a]));
    for (const f of r.files) {
      const name = path.basename(f), size = fs.statSync(f).size, a = have.get(name);
      if (a && a.size === size && a.state === 'uploaded') { console.log('  já enviado:', name); continue; }
      if (a) await api('DELETE', a.url);
      for (let tent = 1; ; tent++) {
        try { await upload(rel.data.upload_url, f); console.log('  enviado:', name); break; } catch (e) {
          console.log('  falhou:', e.message);
          if (tent >= 3) throw e;
          const again = await api('GET', `https://api.github.com/repos/${REPO}/releases/${rel.data.id}/assets`);
          for (const x of again.data || []) if (x.name === name) await api('DELETE', x.url);
        }
      }
    }
  }
  console.log('FIM ok');
})().catch(e => { console.log('FIM erro:', e.message); process.exit(1); });
