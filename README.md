# NFS Launcher — Windows 10/11 e Android

App que abre **só** os jogos do catálogo (`pc/src/main/config.js`), numa janela própria com cara de jogo instalado:
- **NFSU2** em <https://nfsu2.xyz>;
- **NFSU2 Modded** em <https://nfsu2mod.xyz> (o mesmo jogo com carros e mods a mais; Texturas HD como no NFSU2 e cópia dos saves própria; desde a PC 3.0.8 e a Android 1.6.7);
- **Most Wanted** em <https://web.nfsmwo.com>;
- **Carbon** em <https://nfscrb.xyz>.

No PC (pasta `pc/`) é Electron 45.1.0 / Chromium 156, com motor próprio. No Android (pasta `mobile/`) é Chromium 156 compilado.

Os sites carregam pela internet, sem cópia nem alteração, e nenhum script é injetado (a única exceção são os mods de textura do NFSU2, abaixo). Cada jogo só navega no próprio site.

Download, novidades e SHA-256 de cada versão: <https://claude.ai/artifact/RKw9JHnui62my5XSLXEZGB>.

## Comandos (PC)

Na pasta `pc`, um comando por vez:

```powershell
npm install        # também baixa o Electron
npm start          # abre o app com o motor oficial do Electron
npm test           # 141 testes
npm run verify     # 27 verificações estáticas (travam erros já corrigidos)
npm run pack       # monta dist\win-unpacked para examinar, sem instalador
npm run dist       # instalador dist\NFS-Launcher-Setup-<versão>.exe (na raiz), com o motor próprio de C:\e\motor-final
npm run manifestos # tamanho e SHA-256 nas listas que os apps leem no GitHub (pc/ e mobile/)
```

Se o download do Electron travar:
```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules\electron\install.js
```

- **Conferir uma montagem sem tocar nos dados:** `"NFS Launcher.exe" --conferir` sai com o código 73.
- **Assinatura:** o instalador não é assinado. O SmartScreen avisa; é só clicar em Mais informações > Executar assim mesmo.

## O que o app faz

- **Janela:**
  - Abre na barra de tarefas, sem ícone na bandeja. Nada roda em segundo plano nem inicia com o Windows.
  - Fechar a janela encerra tudo. Instância única.
  - Em janela, tem uma barra própria de 32 px. Na tela cheia, os botões só aparecem com o mouse no meio do topo.
- **Teclas do jogo:**
  - F5, as teclas de função, Ctrl+W e Alt+Espaço vão para o jogo.
  - Atalhos do app: `Ctrl+F` ou `Alt+Enter` (tela cheia), `Ctrl+Alt+O` (configurações), `Ctrl+Alt+Shift+P` (sair do modo protegido).
- **Modo protegido** (tela cheia pedida pelo app):
  - Bloqueia Alt+F4, F11 e minimizar.
  - Desligar o Windows nunca é bloqueado.
- **Gráficos iguais ao Chrome:** nenhuma flag que mude a composição dos quadros.
  - Avançado tem:
    - Prioridade "acima do normal", "Preparar o jogo ao carregar", "Aliviar o processador", Graphite + Delegated e FXAA do motor próprio, todos ligados por padrão (no modo DirectX 11, todos desligados). O FXAA liga e desliga na hora e fica de fora quando o anti-serrilhado do próprio NFSU2 (MSAA 4x, opção do jogo) está ligado: o app só lê essa opção, nunca a muda;
    - pacotes de imagem (10): Suave, Vívido, Intenso, Nítido, Vívido e nítido, Cinema, Preto e branco, Pôr do sol, Neon e Realista. No NFSU2 e no NFSU2 Modded os efeitos (nitidez CAS, bloom, cor e vinheta) rodam no motor próprio (`pc/motor/nfs-imagem.wgsl`), sobre a imagem pronta; o app só passa os valores por CSS no canvas (`--nfs-image`), sem script, e a troca vale na hora. No Most Wanted e no Carbon continua o filtro CSS (cor e nitidez).
  - Placa sem DirectX 12: liga sozinho o modo DirectX 11, inclusive no nível 11_0, com "Desfazer e reabrir". Nesse modo sai o que pesa na placa (texturas HD, desenho novo, FXAA e filtro de imagem; Prioridade, Preparar o jogo e Aliviar o processador ficam), e os gráficos do próprio jogo vão ao mínimo uma vez (`registry.txt`, com cópia antes). Um aviso explica: com tela preta, baixe os gráficos do jogo até a imagem aparecer. Dá para religar tudo.
- **Saves:**
  - Nada apaga a pasta de dados nem os saves.
  - `profileLock.js` evita a perda ao fechar e abrir rápido.
  - O NFSU2 ganha uma cópia ao abrir (2 últimas versões) em `%APPDATA%\NFS Launcher Saves`.
  - A cópia nunca volta sozinha: restaurar é pelo "Restaurar" do jogo.
- **Conexão:**
  - O jogo abre com carga normal, como no Chrome (sem recarga sem cache), mantendo login e saves.
  - A tela de erro tem um botão de DNS seguro (Cloudflare, depois Google).
- **Convite da equipe:** o START do NFSU2, com o app em português, abre `#crew=U2BR`, no máximo 2 vezes (`crewInvites`). O site pergunta antes de entrar.
- **Atualizações (GitHub):**
  - O app lê `pc/atualizacao.json` deste repositório e baixa o instalador só das releases dele, conferindo o tamanho e o SHA-256 (`github.js`, `downloader.js`). Baixa fora do jogo e continua de onde parou.
  - Pronto, a tela inicial mostra "Atualizar agora" (instala e reabre). Ao fechar o app, a versão baixada se instala sozinha, sem janela.
- **Discord:** "Jogando NFS Launcher", só pelo canal local do PC.
- **Mods de textura (NFSU2, PC, `modFiles.js`; Android abaixo):**
  - Não vêm no instalador. Na janela "Texturas HD", cada mod da comunidade (TexWizard, o padrão de cada parte que ele tem; Redux; Definitive Edition; NextGen) tem Baixar, Atualizar e Remover. Os pacotes vêm das releases deste repositório (`pc/texturas.json`), com o mapa detalhado do site (`site.pak`) junto do primeiro, e ficam em `%APPDATA%\NFSU2 Launcher\texturas`. São montados fora do repositório (os arquivos dos mods não entram no código).
  - A pasta do jogador, com a mesma árvore do jogo (`%APPDATA%\NFS Launcher Mods\NFSU2`), vale por cima. Os arquivos entram na lista de arquivos que o jogo recebe do site e são entregues pelo app.
  - **Partes (`texPack.js`):** cada parte (asfalto, calçadas, prédios, árvores, céu, carros, efeitos, menus) segue a ordem que o jogador escolher (1ª, 2ª, 3ª...): o que a 1ª não tem vem da 2ª, e assim por diante; o que nenhum escolhido tem fica original (nada é completado sozinho). Sem escolha, só o primeiro mod que tem a parte; a escolha da 3.0.4 (um mod) vira a 1ª. O app não grava pacote novo: monta `TEXPACKS\detailed.pak` virtual (cabeçalho em memória e trechos dos pacotes, lidos quando o jogo pede), com uma data própria para cada escolha (o jogo guarda cópia por tamanho e data). Mesma textura no site e num mod: fica a maior (empate: a do site).
  - Os pacotes têm também as texturas de rua, calçada e pista guardadas com paleta de cores e as que ficam em blocos comprimidos (HUFF e JDLZ) dos carros e do céu. As que o HUD melhorado do site também troca ficam fora: com ele ligado, vale sempre o do site.
  - Com mods e o NFSU2 aberto, os pedidos do site passam pelo app: a lista e os arquivos dos mods são respondidos por ele, o resto segue para o site sem mudança. Sem script na página.
  - O jogo só carrega o pacote com `ui_textures` em `map` ou `uhud` no `settings.ini` dele. Com Texturas HD ligada, o app troca só essa linha para `ui_textures = map` (mapa detalhado; menus e HUD continuam), ao abrir e antes de o navegador abrir os dados (`gameSettings.js`). Só mexe se estiver em `original` ou ausente, nunca com `NFSU2_MAP_TEXTURES` escrito pelo jogador, guarda cópia em `%APPDATA%\NFS Launcher Saves` e, com a opção desligada, desfaz só o que ele trocou.
  - O botão "Texturas HD" da barra (com o NFSU2 aberto) e "Texturas HD…" em Configurações abrem a janela. Escolhas de parte valem ao "Aplicar"; a troca vale quando o jogo carrega de novo (o app pergunta se reinicia, lembrando de salvar na garagem).
- **Android (1.6.4):**
  - **Texturas HD:** nada vem no APK. Em Configurações > Texturas HD o jogador baixa o TexWizard e o NextGen (`mobile/texturas.json`) em "1x" (o tamanho das texturas originais, mais leve) ou "Até 2x" (até 2x o lado delas), e escolhe o mod de cada parte, como no PC. O mapa do site vem junto com o primeiro. Trocar o tamanho baixa de novo os mods no outro tamanho. Antes do START, com o jogo fechado, `Textures.java` grava `files/texturas/texturas.ntxp` com a escolha (só se mudou). O motor recebe o caminho em `--nfs-texturas` (patch `0005`) e responde, só para o site do NFSU2, a lista de arquivos e os pedidos do pacote (patch `0007`, `mobile/nfs_texturas.cc`). `GameSettings.java` faz o mesmo que o `gameSettings.js` do PC.
  - **Atualizações:** `mobile/atualizacao.json`; no Wi-Fi o APK baixa sozinho (dados móveis: só pelo botão), e "Atualizar agora" o entrega ao instalador do Android (`AppUpdate.java`).
  - **Ligado por padrão:** "Preparar o jogo ao carregar" (para todos, uma vez).
  - **START:** lembra de pôr o app no modo jogo do celular (Game Turbo, Game Booster, Game Space) e de baixar o jogo inteiro antes (no NFSU2, aba Game > "Game data on this device"), com "Não lembrar mais".

## Publicar uma versão

1. Montar (`npm run dist` no PC; `mobile/quick.sh` no WSL) e rodar `npm run manifestos` na pasta `pc`.
2. Criar a release no GitHub com o arquivo (`pc-<versão>`: `NFS-Launcher-Setup-<versão>.exe`; `android-<versão>`: `NFS-Launcher-Android-<versão>.apk`; texturas: `texturas-1`). Em `pc`: `node scripts/releases.js pc android` (usa o login do git) e, depois do passo 3, `node scripts/conferir-github.js`.
3. Enviar as listas (`pc/*.json`, `mobile/*.json`) ao ramo `main`. Só depois disso os apps veem a versão nova.

## Dicas para o jogador

- **Driver de vídeo atualizado:** é o que mais pesa no WebGPU.
- **Placas abaixo do DirectX 11 nível 11_0** (só DirectX 10) não rodam o jogo.
- **Para o app, deixe desligados:**
  - geração de quadros (NVIDIA Smooth Motion, AMD AFMF, Lossless Scaling);
  - overlays como RivaTuner.
  - O relatório de diagnóstico avisa quando Lossless Scaling ou RivaTuner estão abertos.
- **Quedas:** desde a 3.0.6, o app anota quando o jogo, a placa de vídeo ou a rede caem (`quedas.json` na pasta de dados, só local) e o relatório de diagnóstico lista as últimas, com dicas quando se repetem. No celular (1.6.6), Configurações > Avançado > Quedas recentes, com Copiar.
- **Links externos:** desde a 3.0.11, só `open.spotify.com` (o botão do Spotify nas músicas do NFSU2) e, desde a 3.0.12, `fm.bot` (link do .fmbot) abre no navegador do Windows (`EXTERNAL_HOSTS` em `config.js`, travado no `verify.js`); o resto continua bloqueado.
- **Login do Last.fm (3.0.12):** `www.last.fm` abre numa janela do próprio app, na partição do jogo (`LOGIN_HOSTS`, `wireLoginWindow`), porque a volta (`lastfm.html` do site) grava o resultado no armazenamento do site e fecha a janela; a janela só navega no Last.fm e no site do jogo.
- **Monitor de 144/165 Hz:** com `fps = auto` o jogo roda a 120 fps. Use G-SYNC/FreeSync ou o monitor a 120 Hz.
- **Qualidade:** é decidida no próprio jogo (Settings), e o `settings.ini` fica no perfil do app, separado do Chrome. `F8` mostra o FPS.
- **Engasgo:** em Configurações > Avançado, salve o relatório de diagnóstico. Compare com o Chrome no mesmo trecho, com `F9` > Download log.
- **Save do navegador:** "Baixar backup" no navegador e "Restaurar" no app.

## Estrutura

```
pc/src/main/   main.js e a lógica pura coberta por testes (config, settings, profileLock, saveCopy, gpuFallback, imageFilter, discord…)
pc/src/renderer/  ui.html/css/js, i18n.js (inglês), bg/ e games/ (fundos e CDs)
pc/build/      ícones, installer.nsh e imagens do instalador
pc/scripts/    verify.js, manifestos.js, releases.js e conferir-github.js (publicar no GitHub), export-catalog.js (catálogo do celular), make-discs.ps1, make-icons.ps1, make-installer-art.ps1
pc/arte/       imagens de origem dos CDs e do fundo
pc/motor/      compilação do motor próprio do PC (código em C:\e)
pc/test/       testes (node:test)
pc/*.json      atualizacao.json e texturas.json, lidos pelo app no GitHub
mobile/        app Android: app/ (Java e telas), patches/ do Chromium, scripts de montagem (WSL NFSMotor), *.json
docs/          TESTES.md, post-divulgacao.md, relatos
```

Checklist de testes manuais: [`docs/TESTES.md`](docs/TESTES.md).

## Licença

O código está sob a licença MIT ([`LICENSE`](LICENSE)). Need for Speed e a arte dos jogos (capas e CDs) pertencem aos seus donos e não entram na licença. Este app não é oficial e não tem ligação com a EA nem com os autores dos sites.
