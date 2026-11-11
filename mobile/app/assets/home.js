(() => {
  'use strict';
  // Tela inicial do app de celular. Fala com o app pela ponte `launcher` (Java). Os sons vêm do app de PC (o mesmo arquivo).
  const $ = (id) => document.getElementById(id);
  const api = window.launcher;
  let st = JSON.parse(api.state());
  let lang = st.lang;
  let sel = st.game;
  let screen = 'home';
  const SCREENS = ['home', 'settings', 'loading', 'error'];
  const t = (pt, en) => (lang === 'en' ? en : pt);
  const NAMES = { pt: 'Português', en: 'English' };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const info = (id) => st.games.find((g) => g.id === id) || st.games[0];

  function toast(msg) {
    const n = $('toast'); n.textContent = msg; n.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { n.hidden = true; }, 3500);
  }
  const LANGS = ['pt', 'en'];
  function chooseLang(l) { if (l === lang) return; api.setLang(l); }
  function langButtons(box) {
    box.replaceChildren(...LANGS.map((l) => {
      const b = el('button', '', NAMES[l]);
      b.setAttribute('aria-pressed', String(l === lang));
      b.onclick = () => chooseLang(l);
      return b;
    }));
  }

  // Personalização: fundo e capa escolhidos pelo jogador (imagens já refeitas pelo app, como data:).
  let customImgs = {};
  let customRev = -1;
  let customKey = '';
  function loadCustom() {
    if (st.customRev === customRev) return;
    customRev = st.customRev;
    customKey = '';
    customImgs = {};
    for (const g of st.games) {
      customImgs[g.id] = {};
      for (const kind of ['bg', 'disc']) {
        if ((st.custom[g.id] || {})[kind]) customImgs[g.id][kind] = api.customImage(g.id, kind);
      }
    }
  }
  const discOf = (g) => (customImgs[g.id] || {}).disc || g.disc;
  // O fundo próprio substitui a imagem do jogo (o escurecido por cima continua, para o texto ficar legível).
  function applyBg() {
    document.body.dataset.game = sel;
    const bg = (customImgs[sel] || {}).bg;
    if (bg) document.body.style.setProperty('--bgimg', `url("${bg}")`);
    else document.body.style.removeProperty('--bgimg');
  }

  function renderHome() {
    langButtons($('home-lang'));
    $('tagline').textContent = t('Escolha o jogo e toque em START', 'Pick the game and tap START');
    const box = $('games');
    if (box.children.length !== st.games.length) {
      box.replaceChildren(...st.games.map((g) => {
        const b = el('button', 'disc');
        b.dataset.id = g.id;
        const img = el('img'); img.alt = '';
        b.append(img, el('span', 'disc-name', g.short));
        b.onclick = () => { sel = g.id; renderHome(); };
        return b;
      }));
    }
    for (const b of box.children) {
      const g = info(b.dataset.id);
      const img = b.querySelector('img');
      if (img.getAttribute('src') !== discOf(g)) img.src = discOf(g);
      b.setAttribute('aria-pressed', String(g.id === sel));
    }
    applyBg();
    $('btn-start').textContent = 'START';
    $('btn-saves').textContent = t('Meus saves', 'My saves');
    $('btn-saves').hidden = !info(sel).textures; // só os NFSU2 têm cópia do save (a pasta é a mesma)
    $('btn-settings').textContent = t('Configurações', 'Settings');
    $('btn-quit').textContent = t('Fechar', 'Close');
    $('versions').textContent = `v${st.version}`;
    renderUpdate();
    const gb = st.lowDiskGb;
    $('disk-box').hidden = gb === undefined;
    if (gb !== undefined) $('disk-text').textContent = t(`Pouco espaço no celular: ${String(gb).replace('.', ',')} GB livres. O jogo pode precisar de até 3 GB para baixar e de espaço para salvar.`, `Low storage on this phone: ${gb} GB free. The game may need up to 3 GB to download and room to save.`);
  }

  const mb = (n) => `${Math.max(1, Math.round(n / 1048576))} MB`;
  // Versão nova (GitHub): no Wi-Fi baixa sozinho; nos dados móveis, o botão baixa; pronta, o botão instala.
  function renderUpdate() {
    const u = st.update || {};
    const found = ['new', 'downloading', 'ready'].includes(u.status);
    $('update-box').hidden = !found;
    if (found) {
      $('update-text').textContent = u.status === 'downloading'
        ? t(`Baixando a versão ${u.version}: ${u.pct}%`, `Downloading version ${u.version}: ${u.pct}%`)
        : u.status === 'ready'
          ? t(`Versão ${u.version} pronta para instalar (você tem a ${st.version}).`, `Version ${u.version} is ready to install (you have ${st.version}).`)
          : t(`Nova versão ${u.version} disponível (você tem a ${st.version}).`, `Version ${u.version} is available (you have ${st.version}).`);
    }
    $('update-get').hidden = u.status === 'downloading';
    $('update-get').textContent = u.status === 'ready' ? t('Atualizar agora', 'Update now') : t(`Baixar (${mb(u.size || 0)})`, `Download (${mb(u.size || 0)})`);
    $('update-status').textContent = {
      checking: t('Verificando…', 'Checking…'),
      new: t(`Versão ${u.version} disponível!`, `Version ${u.version} available!`),
      downloading: t(`Baixando a versão ${u.version}: ${u.pct}%`, `Downloading version ${u.version}: ${u.pct}%`),
      ready: t(`Versão ${u.version} pronta para instalar.`, `Version ${u.version} ready to install.`),
      none: t(`Você já tem a versão mais nova (${st.version}).`, `You have the latest version (${st.version}).`),
      error: t('Não deu para verificar agora (sem internet?).', 'Could not check now (no internet?).'),
    }[u.status] || t(`Versão instalada: ${st.version}`, `Installed version: ${st.version}`);
    $('b-update').disabled = u.status === 'checking' || u.status === 'downloading';
  }

  // Texturas HD (NFSU2): baixadas pelo app, em 1x ou 2x; cada parte escolhe TexWizard, NextGen ou Original.
  const MOD_LABEL = { texwizard: 'TexWizard', nextgen: 'NextGen' };
  let texWant = true; // pede a lista publicada ao abrir as Configurações (e de novo se falhou)
  function renderTextures() {
    const x = st.tex || {};
    if (texWant && x.offer !== 'loading') { texWant = false; if (x.offer !== 'ok') api.texLoad(); }
    $('set-tex-h').textContent = t('Texturas HD (NFSU2 e NFSU2 Modded)', 'HD textures (NFSU2 and NFSU2 Modded)');
    $('s-hdTextures').checked = !!st.hdTextures;
    $('s-hdTextures-l').textContent = t('Usar as texturas HD baixadas. Vale na próxima vez que o jogo abrir', 'Use the downloaded HD textures. Applies the next time the game opens');
    $('tex-note').textContent = t('Baixe um ou os dois mods. TexWizard: asfalto, faixas, calçadas, grama e terra do próprio jogo refeitos em alta resolução, mais sombra e neon dos carros. NextGen: mais partes da cidade. Junto com o primeiro vem o mapa detalhado do site. Use o Wi-Fi: são arquivos grandes.',
      'Download one or both mods. TexWizard: the game’s own asphalt, lane lines, sidewalks, grass and dirt remade in high resolution, plus car shadows and neon. NextGen: more parts of the city. The site’s detailed map comes with the first one. Use Wi-Fi: these are big files.');
    $('tex-scale-l').textContent = t('Tamanho:', 'Size:');
    const scales = [['1x', t('1x (original, mais leve)', '1x (original, lighter)')], ['2x', t('Até 2x (mais nítido)', 'Up to 2x (sharper)')]];
    $('tex-scale').replaceChildren(...scales.map(([id, label]) => {
      const btn = el('button', '', label);
      btn.setAttribute('aria-pressed', String(x.scale === id));
      btn.onclick = () => {
        if (x.scale === id) return;
        api.texScale(id);
        if ((x.mods || []).some((m) => m.state !== 'get' && m.state !== 'none')) toast(t('Os mods baixados são trocados pelos deste tamanho.', 'The downloaded mods are replaced by the ones in this size.'));
      };
      return btn;
    }));
    const busy = !!x.job;
    $('tex-mods').replaceChildren(...(x.mods || []).map((m) => {
      const row = el('div', 'custom-row');
      row.append(el('b', 'tex-name', m.name));
      const extra = m.state === 'get' || m.state === 'update' ? (x.siteSize || 0) : 0;
      const info = {
        ok: t('Baixado', 'Downloaded'), have: t('Baixado', 'Downloaded'),
        update: t(`Versão nova (${mb(m.size + extra)})`, `New version (${mb(m.size + extra)})`),
        get: mb(m.size + extra),
        none: x.offer === 'loading' ? t('Buscando…', 'Looking…') : t('Sem internet agora', 'No internet now'),
      }[m.state];
      const doing = m.busy && x.job
        ? (x.job.startsWith(m.id) ? `${t('Baixando', 'Downloading')} ${x.pct}%` : t('Baixando o mapa do site…', 'Downloading the site map…'))
        : m.busy ? t('Na fila', 'Queued') : info;
      row.append(el('span', 'tex-info', doing));
      if (m.busy) {
        const stop = el('button', 'small', t('Parar', 'Stop'));
        stop.onclick = () => api.texCancel();
        row.append(stop);
      } else {
        if (m.state === 'get' || m.state === 'update') {
          const get = el('button', 'primary small', m.state === 'update' ? t('Atualizar', 'Update') : t('Baixar', 'Download'));
          get.disabled = busy;
          get.onclick = () => api.texDownload(m.id);
          row.append(get);
        }
        if (m.state === 'ok' || m.state === 'have' || m.state === 'update') {
          const rm = el('button', 'small', t('Remover', 'Remove'));
          rm.disabled = busy;
          rm.onclick = () => api.texRemove(m.id);
          row.append(rm);
        }
      }
      return row;
    }));
    const err = {
      sha: t('O arquivo veio diferente do publicado e foi descartado. Tente de novo.', 'The file did not match the published one and was discarded. Try again.'),
      size: t('O arquivo veio com tamanho errado. Tente de novo.', 'The file came with the wrong size. Try again.'),
    }[x.error] || (x.error ? t('O download parou (internet?). Toque em Baixar para continuar de onde parou.', 'The download stopped (internet?). Tap Download to continue where it stopped.') : '');
    const noList = x.offer === 'error' && !(x.mods || []).some((m) => m.state === 'have');
    $('tex-status').textContent = err
      || (noList ? t('Não deu para ver as texturas disponíveis agora (sem internet?).', 'Could not check the available textures now (no internet?).')
        : x.ready ? t('Pronto: as texturas entram na próxima vez que o jogo abrir.', 'Ready: the textures apply the next time the game opens.') : '');
    const parts = x.parts || [];
    $('tex-parts-box').hidden = !parts.length;
    $('tex-parts-note').textContent = t('De qual mod vem cada parte. “Original” deixa a parte como no jogo. Os outros mods completam o que o escolhido não tem.',
      'Which mod each part comes from. “Original” keeps the part as in the game. The other mods fill in what the chosen one lacks.');
    $('tex-parts').replaceChildren(...parts.map((p) => {
      const row = el('div', 'custom-row');
      row.append(el('span', 'tex-info', p.name));
      const g = el('div', 'lang');
      for (const id of [...p.options, 'original']) {
        const btn = el('button', '', id === 'original' ? 'Original' : MOD_LABEL[id] || id);
        btn.setAttribute('aria-pressed', String(p.value === id));
        btn.onclick = () => { if (p.value !== id) api.texChoose(p.id, id); };
        g.append(btn);
      }
      row.append(g);
      return row;
    }));
  }

  function renderCustom() {
    const key = `${lang}|${customRev}`;
    if (key === customKey) return;
    customKey = key;
    $('custom-list').replaceChildren(...st.games.map((g) => {
      const row = el('div', 'custom-row');
      row.append(el('b', 'custom-name', g.short));
      for (const kind of ['bg', 'disc']) {
        const cell = el('div', 'custom-cell');
        const thumb = el('img', kind === 'bg' ? 'thumb-bg' : 'thumb-disc');
        thumb.alt = '';
        thumb.src = (customImgs[g.id] || {})[kind] || (kind === 'disc' ? g.disc : `bg/${g.id}.jpg`);
        const pick = el('button', 'small', kind === 'bg' ? t('Trocar fundo', 'Change background') : t('Trocar capa', 'Change cover'));
        pick.onclick = () => api.pickImage(g.id, kind);
        const reset = el('button', 'small', t('Padrão', 'Default'));
        reset.disabled = !(st.custom[g.id] || {})[kind];
        reset.onclick = () => api.resetImage(g.id, kind);
        cell.append(thumb, pick, reset);
        row.append(cell);
      }
      return row;
    }));
  }

  function renderSettings() {
    $('set-h').textContent = t('Configurações', 'Settings');
    langButtons($('set-lang'));
    $('set-game-h').textContent = t('Jogo', 'Game');
    $('set-custom-h').textContent = t('Personalização', 'Personalization');
    $('custom-note').textContent = t('Troque o fundo da tela inicial e a capa (o CD) de cada jogo por uma imagem PNG ou JPG do seu celular. A capa fica redonda: o app usa o quadrado do meio da imagem. “Padrão” volta à imagem original.',
      'Change the home background and the cover (the CD) of each game to a PNG or JPG image from your phone. The cover is round: the app uses the square in the middle of the image. “Default” goes back to the original image.');
    $('set-update-h').textContent = t('Atualizações', 'Updates');
    $('update-note').textContent = t('O app procura versões novas. No Wi-Fi ele baixa sozinho; nos dados móveis, só pelo botão. Instalar é sempre pelo botão “Atualizar agora” na tela inicial. Nada do seu celular é enviado.',
      'The app looks for new versions. On Wi-Fi it downloads by itself; on mobile data, only by the button. Installing is always by the “Update now” button on the home screen. Nothing from your phone is sent.');
    $('b-update').textContent = t('Verificar agora', 'Check now');
    $('b-update-open').textContent = t('Abrir a página de versões', 'Open the versions page');
    $('set-saves-h').textContent = t('Cópias do save (NFSU2)', 'Save copies (NFSU2)');
    $('saves-note').textContent = t('Ao abrir, o app guarda uma cópia do seu save em Download/NFS Launcher, só se ele mudou. Ficam as 2 últimas versões e nada é enviado. O app nunca coloca uma cópia de volta sozinho. Só restaure se perdeu o save: a cópia pode estar mais antiga que o seu jogo e substitui o que estiver nele. Para voltar: no jogo, em Jogos salvos > Restaurar, escolha o arquivo mais novo da pasta.',
      'When it opens, the app keeps a copy of your save in Download/NFS Launcher, only if it changed. The last 2 versions stay and nothing is sent. The app never puts a copy back by itself. Only restore if you lost your save: a copy may be older than your game and replaces what is in it. To bring one back: in the game, under Saved games > Restore, pick the newest file in the folder.');
    $('b-saves-open').textContent = t('Abrir a pasta das cópias', 'Open the copies folder');
    $('saves-status').textContent = st.lastCopy
      ? t(`Última cópia: ${new Date(st.lastCopy).toLocaleString('pt-BR')}`, `Last copy: ${new Date(st.lastCopy).toLocaleString('en-US')}`)
      : t('Nenhuma cópia ainda: ela é feita ao abrir o app, depois de você salvar no jogo.', 'No copy yet: it is made when the app opens, after you save in the game.');
    $('advanced-h').textContent = t('Avançado', 'Advanced');
    $('set-perf-h').textContent = t('Desempenho', 'Performance');
    $('s-prepareGame').checked = !!st.prepareGame;
    $('s-prepareGame-l').textContent = t('Preparar o jogo ao carregar: otimiza o jogo todo no início, não durante a corrida. Pesa mais nos primeiros segundos e pode reduzir engasgos depois',
      'Prepare the game while loading: optimizes the whole game at the start, not during the race. Heavier in the first seconds and may reduce stutters later');
    renderTextures();
    $('set-maint-h').textContent = t('Manutenção', 'Maintenance');
    $('maint-note').textContent = t('Limpar o cache fica nos ajustes do Android, em Armazenamento, e não toca nos seus saves. Atenção: nunca use “Limpar dados” ali: ele apaga o login, as configurações e os saves do jogo neste app.',
      'Clearing the cache is in the Android settings, under Storage, and does not touch your saves. Warning: never use “Clear data” there: it erases the login, settings and game saves in this app.');
    $('b-app-settings').textContent = t('Abrir os ajustes do app', 'Open app settings');
    $('set-crash-h').textContent = t('Quedas recentes', 'Recent crashes');
    $('crash-note').textContent = t('Quando o jogo cai ou volta para cá com erro, o app anota só o motivo e a hora. Fica neste celular e nada é enviado. Para pedir ajuda, copie e cole no Discord.',
      'When the game crashes or comes back here with an error, the app writes down only the reason and the time. It stays on this phone and nothing is sent. To ask for help, copy and paste it on Discord.');
    const crashes = st.crashes || [];
    $('crash-list').replaceChildren(...(crashes.length ? crashes : [t('Nenhuma queda registrada.', 'No crashes recorded.')])
      .map((x) => { const li = document.createElement('li'); li.textContent = x; return li; }));
    $('b-crash-copy').textContent = t('Copiar', 'Copy');
    $('b-crash-copy').hidden = !crashes.length;
    $('s-back').textContent = t('Voltar', 'Back');
    renderCustom();
    renderUpdate();
  }

  // Carregando: o CD do jogo girando, igual à tela que continua por cima do jogo até ele aparecer.
  let loadingTimer = null;
  function renderLoading() {
    const g = info(sel);
    $('loading-h').textContent = t('Carregando o jogo…', 'Loading the game…');
    if ($('loading-disc').getAttribute('src') !== discOf(g)) $('loading-disc').src = discOf(g);
    $('loading-name').textContent = g.name;
    $('loading-note').textContent = t('Na primeira vez os arquivos do jogo são baixados; depois ficam guardados neste celular.', 'The first time, the game files are downloaded; after that they stay on this phone.');
    applyBg();
  }

  // Tela de erro: uma frase simples, sem código técnico.
  function renderError() {
    $('err-h').textContent = t('Não foi possível carregar o jogo', 'Could not load the game');
    $('err-detail').textContent = st.dnsFailed
      ? t('Não abriu nem com DNS seguro. Confira sua rede; se continuar, relate o problema à equipe.', 'It did not open even with secure DNS. Check your network; if it continues, report the problem to the team.')
      : {
      offline: t('Parece que você está sem internet. Confira o Wi-Fi ou os dados móveis.', 'It looks like you are offline. Check your Wi-Fi or mobile data.'),
      server: t('O site do jogo está fora do ar agora. Não é problema no seu celular.', 'The game site is down right now. It is not a problem on your phone.'),
      crash: t('O jogo fechou sozinho. Tente de novo; se continuar, feche outros apps e reinicie o celular.', 'The game closed by itself. Try again; if it continues, close other apps and restart your phone.'),
    }[st.error] || t('Não deu para abrir o site do jogo. Confira a internet; o site também pode estar fora do ar.', 'Could not open the game site. Check your internet; the site may also be down.');
    $('err-retrying').textContent = st.error === 'crash' ? '' : t('Tentando reconectar automaticamente a cada 5 segundos.', 'Trying to reconnect automatically every 5 seconds.');
    $('e-retry').textContent = t('Tentar agora', 'Try now');
    $('e-dns').textContent = t('Tentar com DNS seguro', 'Try with secure DNS');
    $('e-dns').hidden = !st.dnsOffer;
    $('e-home').textContent = t('Voltar ao início', 'Back to home');
  }

  function setScreen(s) {
    screen = s;
    for (const id of SCREENS) $(id).hidden = id !== s;
    clearTimeout(loadingTimer);
    if (s === 'loading') loadingTimer = setTimeout(() => { if (screen === 'loading') setScreen('home'); }, 20000);
    window.refresh();
    window.scrollTo(0, 0);
  }

  // Abertura do app: logo por pouco mais de um segundo. Tocar pula.
  let introDone = false;
  function endIntro() { if (!introDone) { introDone = true; $('intro').hidden = true; } }
  function startIntro() {
    if (st.error) { endIntro(); return; } // voltou com erro: sem abertura
    window.Sounds.play('intro');
    $('intro').onanimationend = (e) => { if (e.target === $('intro')) endIntro(); };
    $('intro').onclick = endIntro;
    setTimeout(endIntro, 2000); // garantia, se as animações estiverem desligadas no celular
  }

  // Chamadas pelo app (Java): estado novo, abrindo o jogo, voltando, botão "voltar" do Android.
  window.refresh = () => {
    st = JSON.parse(api.state());
    if (st.lang !== lang) lang = st.lang;
    document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';
    window.Sounds.setEnabled(st.sounds);
    loadCustom();
    if (st.error && screen !== 'error') { screen = 'error'; for (const id of SCREENS) $(id).hidden = id !== 'error'; }
    if (!st.error && screen === 'error') { screen = 'home'; for (const id of SCREENS) $(id).hidden = id !== 'home'; }
    renderHome();
    if (screen === 'settings') renderSettings();
    if (screen === 'loading') renderLoading();
    if (screen === 'error') renderError();
  };
  window.showLoading = (id) => { if (id) sel = id; setScreen('loading'); };
  window.showHome = () => { if (screen === 'loading') setScreen('home'); };
  window.goBack = () => {
    if (screen === 'error') { api.clearError(); return 'ok'; }
    if (screen === 'settings') { setScreen('home'); return 'ok'; }
    return 'exit';
  };
  // App em segundo plano ou com o jogo aberto: sem áudio local (o mesmo cuidado do PC).
  window.audioOn = (on) => { window.Sounds.setEnabled(on && st.sounds); };

  $('btn-start').onclick = () => api.start(sel);
  const openSaves = () => { api.openSaves(); toast(t('Só restaure se perdeu o save: no jogo, Jogos salvos > Restaurar.', 'Only restore if you lost your save: in the game, Saved games > Restore.')); };
  $('btn-saves').onclick = openSaves;
  $('b-saves-open').onclick = openSaves;
  $('btn-settings').onclick = () => { texWant = true; setScreen('settings'); };
  $('update-get').onclick = () => ((st.update || {}).status === 'ready' ? api.installUpdate() : api.downloadUpdate());
  $('btn-quit').onclick = () => api.quit();
  $('s-back').onclick = () => window.goBack();
  $('b-update').onclick = () => api.checkUpdate();
  $('b-update-open').onclick = () => api.openUpdates();
  $('b-app-settings').onclick = () => api.openAppSettings();
  $('b-crash-copy').onclick = () => api.copyCrashes();
  $('e-retry').onclick = () => api.retry();
  $('e-dns').onclick = () => api.trySecureDns();
  $('e-home').onclick = () => api.clearError();
  for (const key of ['prepareGame', 'hdTextures']) {
    $(`s-${key}`).onchange = (e) => {
      api.setOption(key, e.target.checked);
      toast(t('Vale na próxima vez que o jogo abrir.', 'Applies the next time the game opens.'));
    };
  }
  window.Sounds.attach(document);
  window.refresh();
  startIntro();
})();
