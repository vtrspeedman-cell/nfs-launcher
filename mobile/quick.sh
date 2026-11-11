#!/usr/bin/env bash
# Montagem rápida: aplica patches, ícones e o app (tela inicial) e recompila em out/Motor só o que mudou
# (Java, manifesto, telas, idiomas: minutos; o libchrome.so já compilado é reaproveitado). Registro em ~/motor-quick.log.
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(dirname "$HERE")"
LOG="$HOME/motor-quick.log"
exec >"$LOG" 2>&1
set -uo pipefail
export PATH="$HOME/depot_tools:$PATH" DEPOT_TOOLS_UPDATE=0
cd "$HOME/chromium/src"
rm -rf chrome/android/nfs
git checkout -- . && for p in "$HERE"/patches/*.patch; do echo "aplicando $(basename "$p")"; git apply --whitespace=nowarn "$p" || { echo "FIM codigo=90"; exit 90; }; done
cp -r "$HERE"/res/. chrome/android/java/res_chromium_base/
python3 "$HERE/app/setup.py" || { echo "FIM codigo=91"; exit 91; }
cp "$HERE/args.gn" out/Motor/args.gn
gn gen out/Motor || { echo "FIM codigo=92"; exit 92; }
autoninja -C out/Motor chrome_public_apk; code=$?
if [ $code = 0 ]; then
  KEY_PROPS="$PROJ/android/keystore.properties"
  pass="$(grep '^storePassword=' "$KEY_PROPS" | cut -d= -f2-)"; alias_="$(grep '^keyAlias=' "$KEY_PROPS" | cut -d= -f2-)"
  BT="$(ls -d third_party/android_sdk/public/build-tools/*/ | sort -V | tail -1)"
  export PATH="$PWD/third_party/jdk/current/bin:$PATH"
  APP_VERSION="$(grep -o 'VERSION = "[0-9.]*"' "$HERE/app/java/xyz/nfs/launcher/MainActivity.java" | grep -o '[0-9.]\+')"
  DEST="$PROJ/dist/NFS-Launcher-Android-$APP_VERSION.apk"
  "${BT}apksigner" sign --ks "$PROJ/android/nfs-launcher.jks" --ks-key-alias "$alias_" \
    --ks-pass "pass:$pass" --key-pass "pass:$pass" --out "$DEST" out/Motor/apks/ChromePublic.apk; code=$?
  ls -l "$DEST"
fi
echo "FIM codigo=$code"
