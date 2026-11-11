# NFS Launcher para Android

Um app só (`xyz.nfs.launcher`, Android 12+, arm64): o Chromium 156 compilado por nós (o "motor") com a tela inicial,
o NFS Launcher dentro dele.

**Por que um motor próprio:** o navegador embutido dos apps de Android (WebView) não deixa a página ficar "isolada", e
o jogo exige isso (erro PAGE-NOT-ISOLATED). O Chromium completo deixa. O START abre o jogo como "Trusted Web
Activity" no próprio app, sem barra nenhuma e em tela cheia.

## Como montar (WSL `NFSMotor`, usuário `builder`, código em `~/chromium/src`)
- **Só o app** (Java, telas, patches que não mudam C++): `quick.sh`, ~5–8 min; mudança em C++ (ex.: `nfs_texturas.cc`)
  recompila também a parte nativa e demora mais. Registro em `~/motor-quick.log`, termina em `FIM codigo=N`.
- **Completa** (~4 h): sempre pelo `watch.sh` (registro em `~/motor-build.log`).
- O APK sai em `dist/NFS-Launcher-Android-<versão>.apk` (versão em `MainActivity.VERSION`), assinado com a chave de
  `android/` na raiz (fora do repositório; **nunca apagar**: sem ela a equipe não atualiza por cima).

## Arquivos
- `app/`: Java (`MainActivity`, `Textures`, `AppUpdate`, `Downloads`, `SaveCopy`,
  `GameSettings`), telas (`assets/home.*`) e `setup.py`, que copia tudo para `chrome/android/nfs` (sons, CDs e
  fundos vêm de `pc/src/renderer`).
- `patches/0001`–`0007`: mudanças no Chromium, geradas por `make-patches.py` (com o código do Chromium limpo; não
  rodar com compilação em andamento). `nfs_texturas.cc` é o código do patch 0007.
- `atualizacao.json` e `texturas.json`: o que o app lê no GitHub (montados por `npm run manifestos` em `pc/`).
- `args.gn`, `build.sh`, `watch.sh`, `quick.sh`, `make-icons.ps1`.
