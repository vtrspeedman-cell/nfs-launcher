#!/usr/bin/env bash
# Monta o NFS Motor (Chromium para Android) dentro do Linux do Windows (WSL2).
# Uso:  bash /mnt/c/Users/bruno/Desktop/nfsu2-launcher/mobile/build.sh
# Etapas (cada uma pula sozinha se já foi feita): ferramentas -> código -> patches -> compilação -> assinatura -> dist.
# O código do Chromium fica em ~/chromium (disco do Linux; NUNCA em /mnt/c, que é lento demais).
set -euo pipefail

TAG="${CHROMIUM_TAG:-156.0.8078.49}"          # mesma família do Electron 45 do app de PC
HERE="$(cd "$(dirname "$0")" && pwd)"         # .../mobile
PROJ="$(dirname "$HERE")"                     # pasta do projeto no Windows
WORK="$HOME/chromium"
OUT="out/Motor"
log() { echo; echo "=== $(date '+%H:%M:%S') $* ==="; }

log "1/6 ferramentas"
export DEBIAN_FRONTEND=noninteractive
if ! command -v git >/dev/null || ! command -v python3 >/dev/null; then
  apt-get update -y && apt-get install -y git python3 curl lsb-release file sudo
fi
if [ ! -d "$HOME/depot_tools" ]; then
  git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "$HOME/depot_tools"
fi
export PATH="$HOME/depot_tools:$PATH"
# Primeira vez: o depot_tools baixa o próprio Python/ferramentas (sem isso o fetch falha).
if [ ! -f "$HOME/depot_tools/python3_bin_reldir.txt" ]; then update_depot_tools; fi
export DEPOT_TOOLS_UPDATE=0

log "2/6 código do Chromium $TAG (demora: dezenas de GB)"
mkdir -p "$WORK" && cd "$WORK"
if [ ! -d src ]; then fetch --nohooks --no-history android; fi
cd src
if [ "$(cat "$WORK/.synced-tag" 2>/dev/null)" != "$TAG" ]; then
  git checkout -- . 2>/dev/null || true
  # O servidor do Google às vezes recusa por excesso de pedidos (erro 429): espera e tenta de novo, do ponto onde parou.
  for i in 1 2 3 4 5 6; do
    if gclient sync -D --force --reset --no-history --with_tags --revision "src@refs/tags/$TAG" -j 4; then break; fi
    [ "$i" = 6 ] && exit 1
    echo "sync falhou (tentativa $i); nova tentativa em 10 min"; sleep 600
  done
  ./build/install-build-deps.sh --android --no-prompt
  gclient runhooks
  echo "$TAG" > "$WORK/.synced-tag"
fi

log "3/6 patches do NFS Motor"
git checkout -- . 2>/dev/null || true
shopt -s nullglob
for p in "$HERE"/patches/*.patch; do
  echo "aplicando $(basename "$p")"
  git apply --whitespace=nowarn "$p"
done
# Ícones do NFS Motor (gerados no Windows por make-icons.ps1) por cima dos do Chromium.
cp -r "$HERE"/res/. chrome/android/java/res_chromium_base/
# App único: tela inicial do NFS Launcher dentro do motor (chrome/android/nfs).
python3 "$HERE/app/setup.py"

log "4/6 configuração"
mkdir -p "$OUT"
cp "$HERE/args.gn" "$OUT/args.gn"
gn gen "$OUT"

log "5/6 compilação (6 a 10 h na primeira vez; depois bem menos)"
autoninja -C "$OUT" chrome_public_apk

log "6/6 assinatura com a chave do NFS Launcher e cópia para dist"
KEY_PROPS="$PROJ/android/keystore.properties"
pass="$(grep '^storePassword=' "$KEY_PROPS" | cut -d= -f2-)"
alias_="$(grep '^keyAlias=' "$KEY_PROPS" | cut -d= -f2-)"
apksigner="$(ls -d third_party/android_sdk/public/build-tools/*/ | sort -V | tail -1)apksigner"
export PATH="$PWD/third_party/jdk/current/bin:$PATH"   # o apksigner precisa do Java (o Linux não tem um próprio)
mkdir -p "$PROJ/dist"
APP_VERSION="$(grep -o 'VERSION = "[0-9.]*"' "$HERE/app/java/xyz/nfs/launcher/MainActivity.java" | grep -o '[0-9.]\+')"
DEST="$PROJ/dist/NFS-Launcher-Android-$APP_VERSION.apk"
"$apksigner" sign --ks "$PROJ/android/nfs-launcher.jks" --ks-key-alias "$alias_" \
  --ks-pass "pass:$pass" --key-pass "pass:$pass" --out "$DEST" "$OUT/apks/ChromePublic.apk"
"$apksigner" verify "$DEST"
ls -lh "$DEST"
log "pronto: $DEST"
