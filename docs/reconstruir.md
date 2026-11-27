# Remontar o ambiente de montagem

O ambiente de compilação foi desmontado em 27/11/2026, depois do PC 3.2.3 e do Android 1.7.6. Aqui está o que é preciso para voltar.

## Só o app do PC (sem mexer no motor), cerca de 30 min
1. Instalar o Node.js LTS e o Git.
2. Baixar `motor-final-3.2.3.zip` da release `motor-156.0.8078.49` e extrair em `C:\e\motor-final`. É o motor do instalador da 3.2.3 (`electronDist` no `pc/package.json`).
3. Em `pc/`, rodar `npm install`, depois `npm test` e `npm run dist`.

## Motor do PC (Chromium), cerca de 100 GB e muitas horas
- Electron v45.1.0 (`45d20ec03000aac41e73b2abdb707936b4f98ed0`), Chromium 156.0.8078.49 (`caff2238dd24d0389777c0186ffbd76c8fa06541`).
- Visual Studio 2026 com C++ e Windows SDK 10.0.28000. Ferramentas: `pc/motor/instalar-ferramentas.ps1`, `baixar.cmd` (`.gclient` em `pc/motor/gclient.txt`).
- Correções: `pc/motor/aplicar-correcoes.py`. Para conferir o estado final, ver `estado-chromium.diff` e `estado-electron.diff`.
- PGO: `pgo-nfs-jogo.zip` da mesma release vira `src\out\nfs-jogo.profdata`. Isso evita refazer o treino (`args-final.gn`).
- Compilar: `pc/motor/compilar.cmd final`.

## Android, cerca de 150 GB e cerca de 4 h na primeira montagem
- WSL Ubuntu, usuário `builder`, Chromium em `~/chromium/src` na revisão `29eb03535d5f2f4f899b95f22a92413ffde5284e` (156.0.8078.49), `target_os = ["android"]`.
- `mobile/args.gn` vai em `out/Motor/args.gn`. Patches 0001–0007 em `mobile/patches`. Montagem completa por `mobile/build.sh` ou `watch.sh`; depois, `quick.sh`.
- A chave `android/nfs-launcher.jks` e o `keystore.properties` não estão no GitHub. Sem eles, a atualização por cima no celular não funciona: guardar uma cópia fora do PC.

## Texturas HD
Os pacotes prontos estão na release `texturas-1`. Os scripts que os montam estão em `pc/motor/texturas` (eram de `C:\e\texturas`). Os mods originais não ficam no GitHub, porque os direitos são dos autores: para refazer, baixar os mods de novo.
