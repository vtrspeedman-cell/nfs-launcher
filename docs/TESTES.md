# Checklist de testes (Windows 11)

Automatizados, na pasta `pc`: `npm test` (141 testes) e `npm run verify` (27 verificações). Conferir a montagem: `"NFS Launcher.exe" --conferir` sai com 73.

## PC

| # | Teste | Esperado |
|---|---|---|
| 1 | Abrir o app | Logo "NFS Launcher" por pouco mais de 1 s (clique ou tecla pulam), depois a tela inicial. Aparece na barra de tarefas; sem ícone na bandeja. |
| 2 | Fechar a janela (X) | O app encerra; no Gerenciador de Tarefas não sobra processo dele. |
| 3 | Tela inicial | 4 CDs (NFSU2, NFSU2 Modded com a faixa laranja "MODDED", Most Wanted, Carbon), cada um com seu fundo. Sem endereço, sem "site", sem nome de navegador. Rodapé só com a versão. Indicador de WebGPU só se houver problema. |
| 4 | Tela inicial: passar o mouse, clicar num CD, START | Sons curtos. Durante o jogo, nenhum som do app. |
| 5 | START em cada jogo | "Carregando o jogo…" com o CD girando até o jogo aparecer; título da janela com o nome do jogo. |
| 6 | START do NFSU2 com o app em português | O jogo pergunta "Join crew?" (U2BR). Join entra; Not now não entra. Em inglês, nenhum convite. Recarregar não repete o convite. Só nos 2 primeiros START com convite; do 3º em diante, abre sem convite (PC: `crewInvites` nas configurações; celular: prefs `crewInvites`). |
| 7 | App instalado: Ctrl+Shift+I, Ctrl+Shift+J, clique direito | Nada de painel de inspeção ou menu de navegador; F12 tira a foto do jogo. |
| 8 | Jogar | Alt, Espaço, Ctrl, Shift, WASD, Tab, Esc, F5, F8 e F12 vão para o jogo. Ctrl+W não fecha nada. |
| 9 | Em janela | Barra própria de 32 px: arrastar, dois cliques, encaixe, bordas, minimizar, maximizar e fechar funcionam; o jogo fica logo abaixo; reabrir mantém o tamanho. |
| 10 | Alt+Espaço com o jogo na tela (janela e tela cheia) | O menu do Windows não abre; nitro e freio de mão funcionam juntos. Nas telas do app, o menu abre. |
| 11 | Ctrl+F e Alt+Enter | Entram e saem da tela cheia, uma vez só, sem barulho do Windows. Enter sozinho vai para o jogo. |
| 12 | Tela cheia protegida: Alt+F4, F11, Win+D | Não fecha; a janela volta se for minimizada; aparece o atalho de saída. |
| 13 | Ctrl+Alt+Shift+P / abrir o app de novo | Sai do modo protegido. |
| 14 | Tela cheia: mouse no meio do topo / longe dele | Os botões aparecem só ali; longe, nada fica sobre o jogo. Tecla Windows ou Alt+Tab: pisca "Para sair da tela cheia: Ctrl+F" por ~6 s. |
| 15 | Botão de casinha (início) com partida aberta | Pergunta antes; volta aos CDs e fecha o jogo. |
| 16 | Recarregar (meio do topo ou Configurações) | Lembra de salvar na garagem. Cancelar ou Enter: nada muda. Confirmar: volta com save e configurações, sem segunda pergunta. Não existe atalho de teclado. |
| 17 | Fechar e abrir o app logo em seguida, várias vezes (também com o PC ocupado) | Pode demorar uns segundos; save e configurações continuam iguais. |
| 18 | Fechar e abrir logado | Continua logado, com saves; o jogo pega a versão nova. |
| 19 | Desligar o Wi-Fi e religar | Erro em frase simples; volta sozinho em ~5 s. |
| 20 | Erro de conexão com Wi-Fi funcionando | Botão "Tentar com DNS seguro": Cloudflare, depois Google, depois o padrão com pedido para conferir a rede. O que abrir fica ligado nas próximas vezes. |
| 21 | NFSU2 com save, abrir o app | "Meus saves" na tela inicial abre a pasta com o zip (2 últimas versões). Só com o NFSU2 escolhido. Nada é restaurado sozinho. |
| 22 | Disco com menos de 3 GB livres | Aviso na tela inicial. |
| 23 | Configurações | Idioma, Desempenho, atalhos e Personalização; o resto em "Avançado". Sem Qualidade, VSync, modo leve, mapa nem doação. |
| 24 | Trocar Português/English | Tela inicial, configurações e avisos mudam. |
| 25 | Avançado > Desenhar a tela do jeito novo (Graphite + Delegated), desmarcar e reabrir | O app abre normalmente (erro da 2.0.4). Ligado por padrão. |
| 26 | Avançado > Preparar o jogo ao carregar / Aliviar o processador / Anti-serrilhado (FXAA) / filtro de imagem | Todos ligados por padrão (no DirectX 12). Preparar o jogo e Aliviar o processador pedem para reabrir; o anti-serrilhado e o pacote de imagem valem na hora. Comparar no F8 com a opção ligada e desligada. Sem travamento nem erro de gráficos. FXAA: com o anti-serrilhado do próprio NFSU2 ligado (Options > Display), o do app fica de fora (o relatório de diagnóstico mostra o anti-serrilhado do app desligado); desligando o do jogo e recarregando o jogo, o FXAA volta. O app nunca muda essa opção do jogo. |
| 27 | Botão de pacote de imagem na barra e no topo da tela cheia | Cada clique troca o pacote (Suave, Vívido, Intenso, Nítido, Vívido e nítido, Cinema, Preto e branco, Pôr do sol, Neon, Realista) e por fim desliga; o nome aparece ao lado. Vale nos 4 jogos e na hora. No NFSU2 e no Modded: Neon deixa um brilho em volta das luzes, Cinema e Realista escurecem os cantos, Nítido realça os detalhes sem contorno branco. No Most Wanted e no Carbon muda só cor e nitidez. Comparar no F8: o pacote deve custar menos que o filtro da 3.0.8. |
| 28 | PC sem DirectX 12 (ou lista de bloqueio simulada: `--enable-features=WebGPUService:AdapterBlockList/%2A`) | Na tela inicial, o app liga o modo DirectX 11 e reabre sozinho, uma vez, com Texturas HD, desenho novo, FXAA e filtro desmarcados (Prioridade, Preparar o jogo e Aliviar o processador ligados). Ao abrir, um aviso explica que os gráficos do jogo foram ao mínimo e que, com tela preta, é para baixar os gráficos até a imagem aparecer; o `registry.txt` do jogo fica com as opções de Options > Display no mínimo (cópia em `%APPDATA%\NFS Launcher Saves\registry.txt-antes-do-DirectX-11.txt`), uma vez só. Funcionando: aviso com "Desfazer e reabrir". Falhando: desliga e mostra o erro com tentar de novo. |
| 29 | Placa de nível 11_0 (ex.: GTX 550 Ti) | No modo DirectX 11, o jogo abre e roda. Comparar o FPS no F8. |
| 35 | Glitches com o Toyota Corolla | Aviso no início para ir direto às 3 barras. |
| 36 | Discord aberto, jogar cada jogo | "Jogando NFS Launcher", o nome curto do jogo embaixo, o tempo e o botão "Baixar o NFS Launcher" (conferir pelo perfil visto por outra pessoa). Ao voltar ao início, some. |
| 37 | Versão nova publicada (release no GitHub e `pc/atualizacao.json` no `main`) | Com a tela inicial aberta, o app baixa sozinho (nunca durante o jogo; continua de onde parou) e mostra "Atualizar agora": instala e reabre, com login e saves. Sem clicar, fechar o app instala sem janela. |
| 38 | Configurações > Personalização: trocar fundo e capa | PNG ou JPG; aparece na tela inicial e no carregamento; "Padrão" volta. |
| 39 | Limpar cache | Limpa sem perder saves. Não existe botão de apagar dados do jogo. |
| 40 | Salvar relatório de diagnóstico | Pede onde salvar; o .txt tem monitores, GPU, driver e "Pontos de atenção" (RivaTuner e Lossless Scaling, se abertos). |
| 40b | Com o jogo aberto, fechar o processo "GPU" pelo Gerenciador de Tarefas; salvar o relatório de diagnóstico | Seção "Quedas recentes" com a queda da placa de vídeo (jogo e há quanto tempo jogava). Duas em 7 dias: dica de atualizar o driver. Nada é enviado. |
| 41 | Rádio do jogo > escolher pasta de músicas | A janela de pasta abre e as músicas aparecem. |
| 42 | Minimizar com o jogo rodando | Com `background = pause`, o jogo pausa e continua ao voltar. |
| 43 | Gerenciador de Tarefas > Detalhes | GPU "Acima do normal" (o Chromium faz). Com Prioridade ligada, o jogo também; desligando, volta a Normal. |
| 44 | Mesmo trecho no Chrome e no app, F8 detalhado | Tempo de quadro e FPS iguais ou melhores; sem quadros misturados. |
| 45 | Instalar por cima da versão anterior | Sem admin, imagem própria na lateral, sem página de texturas; login, saves e texturas baixadas continuam. Desinstala limpo. |
| 45b | Abrir a janela "Texturas HD" sem nenhum mod baixado | Uma linha por mod (TexWizard, Redux, Definitive Edition, NextGen) com o tamanho e "Baixar"; o primeiro traz o mapa do site junto. Baixando: porcentagem e "Parar"; parar e baixar de novo continua de onde parou. Baixado: "Remover" (vai para a Lixeira; sem nenhum mod, o mapa do site também sai). |
| 46 | Com os mods baixados, `settings.ini` sem `NFSU2_MAP_TEXTURES`, HUD melhorado ligado (`ui_textures = uhud`) | Texturas dos mods (asfalto, pátio de pedra, árvores, céu) e o mapa detalhado aparecem; o log do F9 mostra `TEXPACKS/detailed.pak` com as texturas. Saves continuam. |
| 45c | Jogo com `ui_textures = original` (ou sem a linha), Texturas HD ligada, abrir o app | O `settings.ini` passa a ter `ui_textures = map` e as texturas entram; cópia em `%APPDATA%\NFS Launcher Saves\settings.ini-antes-das-texturas-HD.txt`; o registro dos mods diz "gravada". Com `uhud`, nada muda. Desligar Texturas HD e reabrir: a linha volta a `original`, e o HUD HD de quem usa `uhud` continua. |
| 45d | Com Texturas HD ligada e uma frase da nuvem salva, abrir o NFSU2 na aba Jogos salvos | "Jogos salvos na nuvem" aparece igual ao de Texturas HD desligada, com "Sincronizado". |
| 46a | Com o NFSU2 aberto, clicar em "Texturas HD" na barra (em janela) ou no ícone da barra (tela cheia) | Abre a janela "Texturas HD" no estilo das telas do app, com os downloads, a caixa de ligar e uma linha por parte; "Aplicar" fica apagado até mudar algo. Desmarcar a caixa deixa as partes mais escuras. Voltar ou Esc: volta ao jogo sem mudar nada e sem pergunta. Aplicar: volta ao jogo e pergunta uma vez "Reinicie o jogo para valer" com Depois e Reiniciar o jogo; Reiniciar recarrega e as texturas mudam. Ícone colorido quando ligado. Com Most Wanted ou Carbon, o botão não aparece. |
| 46b | Pasta `%APPDATA%\NFS Launcher Mods\NFSU2` com um arquivo do mesmo caminho | Vale o da pasta do jogador; com o app aberto, trocar o arquivo só vale ao reabrir. |
| 46c | Texturas HD ligada, com os mods baixados: andar no free roam por avenidas com faixa amarela, calçadas, ruas de paralelepípedo, a pista de drift e o aeroporto; olhar o neon do 240SX, 350Z ou Escalade | Faixas, asfalto, calçadas e pistas com detalhe (antes ficavam as originais, borradas); neon do carro mais nítido. Com o HUD HD (`uhud`), os ícones de menu e o HUD são sempre os do HUD HD, iguais a cada abertura. |
| 46d | Na janela "Texturas HD" (também por Configurações > Texturas HD…), trocar várias partes de uma vez (ex.: Asfalto e pistas = Definitive, Céu = Original) e Aplicar, com o NFSU2 aberto | Só aparecem os mods instalados que têm aquela parte. Uma pergunta só para reiniciar; reiniciando, as partes mudam (Original = como no jogo). Aberta pelas Configurações, volta para elas. Voltar à escolha anterior não baixa nada de novo. |
| 46f | Na janela "Texturas HD", em Asfalto e pistas clicar NextGen, Definitive e Redux nessa ordem; clicar de novo no Definitive; Aplicar e jogar | Os botões mostram "1ª NextGen", "2ª Definitive"..., e tirar um renumera os outros. Asfalto do NextGen; o que ele não tem vem da 2ª; o que nenhum escolhido tem fica original (nada de mod não escolhido). "Original" limpa a ordem. |
| 46e | Baixar o TexWizard; abrir a janela "Texturas HD"; depois baixar o Redux, trocar Asfalto e pistas para Redux, Aplicar e reabrir o app | Asfalto, calçadas, grama e terra, sombra e neon dos carros com o TexWizard por padrão. Depois da troca, o Redux continua ao reabrir. Os mapas das corridas aparecem detalhados. |
| 46g | Texturas HD ligada, com mods baixados: START no NFSU2 Modded, jogar até o settings.ini existir, fechar e abrir o app de novo; andar na cidade | Asfalto, cenário e céu com as texturas escolhidas, como no NFSU2; carros novos do site ficam como o site fez. Os saves do Modded não aparecem no NFSU2 nem o contrário. A cópia do save do Modded fica em `NFS Launcher Saves\NFSU2 Modded`. Trocar do NFSU2 para o Modded com a partida aberta pede confirmação antes. |
| 46h | NFSU2: Options > Audio (músicas), clicar no botão do Spotify | A playlist oficial abre no navegador do Windows; o jogo continua aberto no app. Outros links continuam sem abrir. |
| 46i | NFSU2: Options > Audio, Last.fm > Conectar; depois clicar em .fmbot > Adicionar | Abre uma janela do app com o login do Last.fm; depois de entrar e autorizar, ela fecha sozinha e o jogo mostra a conta ligada. O .fmbot abre no navegador do Windows. |

## Celular (Android)

| # | Teste | Esperado |
|---|---|---|
| A1 | Instalar por cima da versão anterior | Login e saves continuam (mesma chave). |
| A2 | Abrir o app | Logo por pouco mais de 1 s com som, depois a tela inicial com os 3 CDs e o fundo do jogo marcado. Sem endereço. |
| A3 | START em cada jogo | CD girando até o jogo aparecer, sem tela preta; sem som do app durante o jogo. No NFSU2 em português, "Join crew?". |
| A4 | Fechar e abrir logado | Continua logado, com saves; o jogo pega a versão nova. |
| A5 | Abrir sem internet | Frase simples; ao voltar a internet, abre sozinho em até ~5 s. |
| A6 | Erro de conexão com rede ruim | Botão de DNS seguro, como no PC. |
| A7 | NFSU2 com save | Zip do save em Download/NFS Launcher (2 últimas versões); botão "Meus saves". |
| A8 | Versão nova publicada (release no GitHub e `mobile/atualizacao.json` no `main`) | No Wi-Fi, baixa sozinho com a tela inicial aberta; nos dados móveis, botão "Baixar (N MB)". Pronta: "Atualizar agora", o Android confirma, o app fecha e a versão nova entra por cima com login, saves e texturas. Na primeira vez, o Android pede para permitir instalar apps do NFS Launcher. |
| A9 | Configurações > Trocar fundo e capa | Aparece na tela inicial e no carregamento; "Padrão" volta. |
| A13 | Samsung A56 (Xclipse) | Sem GPU-ADAPTER-ANDROID; o jogo abre e roda. |
| A14 | Configurações > Desempenho > Preparar o jogo ao carregar | Ligada por padrão, inclusive para quem tinha desligado (uma vez). Vale na próxima abertura. |
| A15 | Configurações > Texturas HD: baixar TexWizard e NextGen em "Até 2x"; free roam por avenidas com faixa, calçadas e grama; olhar a sombra e o neon do carro | Mapa do site baixa junto com o primeiro. Asfalto, faixas, calçadas e grama mais nítidos que no Chrome; cada parte pode vir do TexWizard, do NextGen ou ser "Original". O jogo não fica mais lento nem fecha sozinho. Trocar para "1x": os mods baixam de novo no tamanho original (mais leves). |
| A16 | Desligar Texturas HD (ou remover os mods) e abrir o NFSU2 de novo | Texturas originais; o mapa do jogo volta ao que era antes. Quem usa HUD HD continua com ele. |
| A17 | START | Antes de abrir: lembrete de pôr o app no modo jogo do celular e de baixar o jogo inteiro (no NFSU2, aba Game > "Game data on this device"). "Jogar" abre; "Não lembrar mais" abre e não mostra de novo. |
| A18 | Jogar uns minutos, voltar à tela inicial | A tela inicial volta na hora, sem tela branca; se o Android tiver fechado a página dela, ela é refeita sozinha. |
| A19 | Configurações > Avançado > Quedas recentes | "Nenhuma queda registrada." ou a lista (jogo, tela, motor, GPU, com data). Copiar põe na área de transferência com versão e modelo do celular. |
| A20 | Texturas HD ligada: START no NFSU2 e depois no NFSU2 Modded (o Modded pela primeira vez depois de instalar a 1.6.7), jogar até salvar; voltar e abrir o NFSU2 de novo | No Modded, cenário com as texturas escolhidas, como no NFSU2. O save de um não aparece no outro. Em Download/NFS Launcher, cópias `nfsu2-saves-…` e `nfsu2mod-saves-…` separadas. |
