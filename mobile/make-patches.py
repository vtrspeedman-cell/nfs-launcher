#!/usr/bin/env python3
"""Gera mobile/patches/*.patch a partir do código do Chromium (~/chromium/src, sem mudanças).

Uso (no Linux do WSL):  python3 make-patches.py
Cada mudança é feita por busca de texto; se o Chromium mudar e um trecho não for achado, o script para
com erro (melhor parar aqui do que compilar horas um Motor sem a mudança).
"""
import pathlib
import re
import subprocess
import sys

SRC = pathlib.Path.home() / 'chromium' / 'src'
OUT = pathlib.Path(__file__).resolve().parent / 'patches'

# Chave do NFS Launcher (android/nfs-launcher.jks): SHA-256 do certificado, no formato do PackageUtils do Chromium.
LAUNCHER_PKG = 'xyz.nfs.launcher'
LAUNCHER_CERT = '3353a38fab224a522541d8b2179b23dd97bee7e37f4514e690ef39a48a69dff3'
CERT_COLONS = ':'.join(LAUNCHER_CERT[i:i + 2] for i in range(0, 64, 2)).upper()


def edit(rel, fn):
    p = SRC / rel
    old = p.read_text()
    new = fn(old)
    if new == old:
        sys.exit(f'nada mudou em {rel}')
    p.write_text(new)


def sub1(text, old, new):
    if text.count(old) != 1:
        sys.exit(f'trecho não achado (ou repetido): {old[:70]!r}')
    return text.replace(old, new)


def patch_origin_verifier(t):
    t = sub1(t, '''        if (mPackageName != null
                && mVerificationResultStore.shouldOverride(mPackageName, origin, mRelation)) {''',
             '''        // NFS Motor: o NFS Launcher (pacote + assinatura própria) é confiável para qualquer site https,
        // no lugar do arquivo de autorização (assetlinks.json) que os sites dos jogos não publicam.
        if (isNfsLauncher() && UrlConstants.HTTPS_SCHEME.equals(scheme.toLowerCase(Locale.US))) {
            Log.i(TAG, "Verification succeeded for %s, trusted NFS Launcher.", origin);
            PostTask.runOrPostTask(
                    TaskTraits.UI_DEFAULT, new VerifiedCallback(origin, true, TriState.NOT_SET));
            return;
        }

        if (mPackageName != null
                && mVerificationResultStore.shouldOverride(mPackageName, origin, mRelation)) {''')
    t = sub1(t, '''    /** Cleanup native dependencies on this object. */''',
             f'''    private static final String NFS_LAUNCHER_PACKAGE = "{LAUNCHER_PKG}";
    private static final String NFS_LAUNCHER_CERT_SHA256 =
            "{CERT_COLONS}";

    /** O app que pede é o NFS Launcher assinado com a nossa chave (e só ela)? */
    private boolean isNfsLauncher() {{
        return NFS_LAUNCHER_PACKAGE.equals(mPackageName)
                && mSignatureFingerprints != null
                && mSignatureFingerprints.size() == 1
                && NFS_LAUNCHER_CERT_SHA256.equalsIgnoreCase(mSignatureFingerprints.get(0));
    }}

    /** Cleanup native dependencies on this object. */''')
    return t


def patch_fre(t):
    t = sub1(t, '''        if (CommandLine.getInstance().hasSwitch(ChromeSwitches.DISABLE_FIRST_RUN_EXPERIENCE)
                ||''', '''        if (NFS_MOTOR_SKIP_FRE
                || CommandLine.getInstance().hasSwitch(ChromeSwitches.DISABLE_FIRST_RUN_EXPERIENCE)
                ||''')
    m = re.search(r'\npublic (abstract )?class FirstRunFlowSequencer[^{]*\{\n', t)
    if not m:
        sys.exit('classe FirstRunFlowSequencer não achada')
    return t[:m.end()] + ('    // NFS Motor: sem telas de boas-vindas, termos e conta do Google (o Motor só abre os jogos).\n'
                          '    private static final boolean NFS_MOTOR_SKIP_FRE = true;\n\n') + t[m.end():]


def patch_disclosure(t):
    return sub1(t, '''        /* Has a disclosure been dismissed for this client package before? */
        return !BrowserServicesStore''', '''        // NFS Motor: sem o aviso "Executando no Chromium" (o Motor só abre os jogos do NFS Launcher).
        if (true) return false;
        /* Has a disclosure been dismissed for this client package before? */
        return !BrowserServicesStore''')


def patch_names(t):
    # App único (desde o launcher 1.3.0): o navegador e a tela inicial são o mesmo app, "NFS Launcher".
    t = sub1(t, '>Chromium</string>', '>NFS Launcher</string>')
    return t.replace('>Chromium ', '>NFS Launcher ')


def patch_manifest(t):
    # 1) IntentDispatcher: sem receber links (http/https/about/googlechrome), textos compartilhados, buscas, NFC.
    #    Fica só o filtro MAIN (preferências de notificação) e o do glic (só apps do Google). O NFS Launcher abre
    #    o Motor pelo nome exato da tela (intent explícita), que não precisa de filtro.
    a = t.index('<activity-alias android:name="com.google.android.apps.chrome.IntentDispatcher"')
    b = t.index('</activity-alias>', a)
    block = t[a:b]
    filters = list(re.finditer(r'[ \t]*<intent-filter[^>]*>.*?</intent-filter>\n', block, re.S))
    kept = [f for f in filters if 'action.MAIN' in f.group(0) or 'glic' in f.group(0)]
    if len(filters) < 8 or len(kept) != 2:
        sys.exit(f'IntentDispatcher inesperado: {len(filters)} filtros, {len(kept)} mantidos')
    for f in reversed(filters):
        if f not in kept:
            block = block[:f.start()] + block[f.end():]
    if 'android:scheme="http' in block or 'common_view_intent_shared_filter_body' in block:
        sys.exit('IntentDispatcher ainda recebe links')
    t = t[:a] + block + t[b:]

    # 2) Main: sem ícone na lista de apps e sem se oferecer como navegador.
    a = t.index('<activity-alias android:name="com.google.android.apps.chrome.Main"')
    b = t.index('</intent-filter>', a)
    main = t[a:b]
    for cat in ('LAUNCHER', 'BROWSABLE', 'APP_BROWSER', 'MULTIWINDOW_LAUNCHER'):
        main, n = re.subn(rf'[ \t]*<category android:name="android.intent.category.{cat}" />\n', '', main)
        if n != 1:
            sys.exit(f'categoria {cat} não achada no Main')
    t = t[:a] + main + t[b:]

    # 3) Abrir PDF/imagem/vídeo/áudio e busca pela web: só por dentro do próprio Motor.
    for name in ('org.chromium.chrome.browser.document.PdfLauncherActivityAlias',
                 'org.chromium.chrome.browser.media.MediaLauncherActivity',
                 'org.chromium.chrome.browser.media.AudioLauncherActivity',
                 'org.chromium.chrome.browser.searchwidget.SearchActivity'):
        a = t.index(f'android:name="{name}"')
        b = t.index('>', t.index('android:exported=', a))
        head = t[a:b]
        if 'android:exported="true"' not in head:
            sys.exit(f'{name}: exported="true" não achado')
        t = t[:a] + head.replace('android:exported="true"', 'android:exported="false"') + t[b:]

    # 4) App único: a tela inicial do NFS Launcher (ícone na lista de apps), num processo próprio
    #    (":nfs"), longe do processo do navegador/jogo.
    t = sub1(t, '''      {% block base_application_definitions %}
      {% endblock %}''', '''      <!-- NFS Launcher: tela inicial. -->
      <activity android:name="xyz.nfs.launcher.MainActivity"
          android:process=":nfs"
          android:label="NFS Launcher"
          android:exported="true"
          android:launchMode="singleTask"
          android:screenOrientation="sensorLandscape"
          android:theme="@android:style/Theme.DeviceDefault.NoActionBar.Fullscreen"
          android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboard|keyboardHidden|navigation|uiMode|density">
          <intent-filter>
              <action android:name="android.intent.action.MAIN" />
              <category android:name="android.intent.category.LAUNCHER" />
          </intent-filter>
      </activity>
      <!-- Modo de jogo do Android 13+: o app cuida do próprio desempenho; o sistema não reduz resolução nem FPS. -->
      <meta-data android:name="android.game_mode_config" android:resource="@xml/nfs_game_mode_config" />

      {% block base_application_definitions %}
      {% endblock %}''')

    # 5) É um JOGO para o Android: os otimizadores de jogos dos celulares (Game Booster, Game Turbo, Game Space)
    #    reconhecem o app, liberam desempenho/RAM e seguram notificações enquanto ele está aberto.
    return sub1(t, '''        android:largeHeap="false"\n''', '''        android:largeHeap="false"
        android:appCategory="game"
        android:isGame="true"\n''')


def patch_apk_deps(t):
    t = sub1(t, '''    deps += [ "//chrome/android:base_module_java" ]\n''',
             '''    deps += [ "//chrome/android:base_module_java" ]
    deps += [ "//chrome/android/nfs:java" ]  # NFS Launcher (tela inicial)\n''')
    return sub1(t, '''    asset_deps = [ "//chrome/android:chrome_public_non_pak_assets" ]\n''',
                '''    asset_deps = [ "//chrome/android:chrome_public_non_pak_assets" ]
    asset_deps += [ "//chrome/android/nfs:assets" ]  # NFS Launcher (assets/nfs/)\n''')


# Idiomas: só português do Brasil e inglês (os textos do navegador quase não aparecem: o app não tem telas dele).
# Corte só na hora de EMPACOTAR (a lista global de idiomas, build/config/locales.gni, mexe na tradução de tudo e
# até no código nativo). Celular em outro idioma usa o inglês, como o Chrome faz com idioma que ele não tem.
NFS_LOCALES = '[ "en-US", "pt-BR" ]'  # em ordem alfabética (o Java procura com busca binária)


def patch_aapt_locales(t):
    return sub1(t, '    aapt_locale_allowlist = platform_pak_locales\n',
                f'    aapt_locale_allowlist = {NFS_LOCALES}  # NFS Launcher\n')


def patch_pak_locales(t):
    a = t.index('android_assets("${_variant}_locale_pak_assets") {')
    b = t.index('foreach(_locale, platform_pak_locales) {', a)
    return t[:b] + f'foreach(_locale, {NFS_LOCALES}) {{  # NFS Launcher' + \
        t[b + len('foreach(_locale, platform_pak_locales) {'):]


def patch_app_startup(t):
    t = sub1(t, 'ResourceBundle.setAvailablePakLocales(ProductConfig.LOCALES);',
             'ResourceBundle.setAvailablePakLocales(new String[] {"en-US", "pt-BR"}); // NFS Launcher')
    # Navegador quieto por baixo do jogo: sem baixar componentes/atualizações do Google em segundo plano,
    # sem relatórios de rede, sem dicas de otimização e sem procurar Chromecast (só gastariam CPU/rede/RAM).
    return sub1(t, '''            PathUtils.setPrivateDataDirectorySuffix(PRIVATE_DATA_DIRECTORY_SUFFIX);\n''',
                '''            PathUtils.setPrivateDataDirectorySuffix(PRIVATE_DATA_DIRECTORY_SUFFIX);
            // NFS Launcher: o navegador por baixo do jogo fica quieto (nada de rede/CPU em segundo plano).
            org.chromium.base.CommandLine.getInstance()
                    .appendSwitchesAndArguments(
                            new String[] {
                                "--disable-background-networking",
                                "--disable-component-update",
                                "--disable-domain-reliability",
                                "--disable-features=OptimizationHints,MediaRouter",
                                // Sem a lista de chips bloqueados do WebGPU: Samsung com Xclipse (ex.: A56) só
                                // funcionava ligando uma opção escondida no Chrome. Quem já era aceito não muda.
                                "--disable-dawn-features=adapter_blocklist"
                            });
            // NFS Launcher: opção "Preparar o jogo ao carregar" (Configurações > Desempenho), ligada por padrão.
            if (context.getSharedPreferences("nfs", 0).getBoolean("prepareGame", true)) {
                org.chromium.base.CommandLine.getInstance()
                        .appendSwitchWithValue(
                                "js-flags",
                                "--no-wasm-lazy-compilation --no-wasm-dynamic-tiering");
            }
            // NFS Launcher: "Texturas HD" ligada e pacote montado pelo app (files/texturas): o motor o entrega (patch 0007).
            java.io.File nfsTex = new java.io.File(context.getFilesDir(), "texturas/texturas.ntxp");
            if (context.getSharedPreferences("nfs", 0).getBoolean("hdTextures", true) && nfsTex.isFile()) {
                org.chromium.base.CommandLine.getInstance()
                        .appendSwitchWithValue("nfs-texturas", nfsTex.getAbsolutePath());
            }\n''')


def patch_textures(t):
    # Texturas HD do NFSU2 (1.6.4): a lista do site e o pacote passam pelo motor (mobile/nfs_texturas.cc).
    code = (pathlib.Path(__file__).resolve().parent / 'nfs_texturas.cc').read_text()
    t = sub1(t, '''void ChromeContentBrowserClient::WillCreateURLLoaderFactory(''',
             code + '''void ChromeContentBrowserClient::WillCreateURLLoaderFactory(''')
    return sub1(t, '''    bool is_for_network_service) {
#if BUILDFLAG(ENABLE_EXTENSIONS_CORE)
  auto* web_request_api =''', '''    bool is_for_network_service) {
  // NFS Launcher: texturas HD do NFSU2, só nas páginas e workers do site do jogo.
  if (nfs_tex::Wanted(request_initiator)) {
    auto [nfs_receiver, nfs_target] = factory_builder.Append();
    new nfs_tex::Factory(std::move(nfs_receiver), std::move(nfs_target));
  }
#if BUILDFLAG(ENABLE_EXTENSIONS_CORE)
  auto* web_request_api =''')


def patch_game_activity(t):
    # A tela do jogo (Trusted Web Activity):
    # - aberta: tela não apaga; minimizada: o jogo continua lá;
    # - fechada de vez (voltar, "Voltar ao início", outro jogo, tirada da lista de apps abertos): encerra o
    #   navegador INTEIRO (página, GPU, áudio), para nada ficar rodando e o próximo jogo abrir limpo;
    # - ao abrir: CD girando até o jogo aparecer e recarga sem cache (versão nova do site, login e saves ficam);
    # - falha ao abrir ou jogo caído: volta à tela inicial, que mostra o erro em frase simples.
    t = sub1(t, '''        if (tab != null) maybeCreateHistoryTabHelper(tab);
''', '''        if (tab != null) maybeCreateHistoryTabHelper(tab);
        if (tab != null) nfsWatch(tab);
''')
    t = sub1(t, '''    public void onStart() {
        super.onStart();
        if (mTimeoutHandler != null) mTimeoutHandler.onStart();
    }''', '''    public void onStart() {
        super.onStart();
        if (mTimeoutHandler != null) mTimeoutHandler.onStart();
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Jogos de corrida: sempre deitado (qualquer um dos dois lados).
        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        nfsVisible = true;
        nfsShowLoading();
        nfsGameState(true);
    }

    private boolean nfsVisible;
    private boolean nfsWatching;
    private boolean nfsFresh;
    private boolean nfsFailed;
    private boolean nfsLoadingDone;
    private boolean nfsRetried;
    private String nfsDns = "";
    private @Nullable View nfsLoading;

    /** NFS Launcher: DNS seguro pedido na tela de erro, ou o que já fez o jogo abrir antes; senão o padrão. */
    private void nfsApplyDns() {
        String t = getSharedPreferences("nfs", 4 /* MODE_MULTI_PROCESS */).getString("dnsTry", "");
        if ("cloudflare".equals(t) || "google".equals(t)) {
            nfsDns = t;
        } else if ("none".equals(t)) {
            nfsDns = "";
        } else {
            nfsDns = nfsSavedDns();
        }
        org.chromium.chrome.browser.privacy.secure_dns.SecureDnsBridge.nfsUse(
                "cloudflare".equals(nfsDns)
                        ? "https://1.1.1.1/dns-query https://1.0.0.1/dns-query"
                        : "google".equals(nfsDns)
                                ? "https://8.8.8.8/dns-query https://8.8.4.4/dns-query"
                                : "");
    }

    private String nfsSavedDns() {
        try {
            String s =
                    new String(
                                    java.nio.file.Files.readAllBytes(
                                            new java.io.File(getFilesDir(), "nfs-dns").toPath()),
                                    java.nio.charset.StandardCharsets.UTF_8)
                            .trim();
            return "cloudflare".equals(s) || "google".equals(s) ? s : "";
        } catch (java.io.IOException e) {
            return "";
        }
    }

    /** NFS Launcher: o jogo abriu com este DNS seguro: fica ligado nas próximas vezes. */
    private void nfsSaveDns() {
        if (nfsDns.isEmpty() || nfsDns.equals(nfsSavedDns())) return;
        try {
            java.nio.file.Files.write(
                    new java.io.File(getFilesDir(), "nfs-dns").toPath(),
                    nfsDns.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (java.io.IOException e) {
            // Sem gravar: na próxima vez o botão aparece de novo.
        }
    }

    /** NFS Launcher: abre o jogo como Ctrl+F5 (login e saves ficam) e cuida da tela de carregar e dos erros. */
    private void nfsWatch(Tab tab) {
        if (nfsWatching) return;
        nfsWatching = true;
        nfsApplyDns();
        tab.addObserver(
                new org.chromium.chrome.browser.tab.TabObserver() {
                    @Override
                    public void onDidFinishNavigationInPrimaryMainFrame(
                            Tab t, org.chromium.content_public.browser.NavigationHandle nav) {
                        if (nav.isSameDocument()) return;
                        int code = nav.errorCode();
                        if (code != 0 && code != -3) { // -3 = interrompida (a própria recarga faz isso)
                            // Uma segunda tentativa: a troca de DNS pode ainda não valer na primeira carga.
                            if (nfsRetried) {
                                nfsFail(code);
                            } else {
                                nfsRetried = true;
                                getWindow().getDecorView().postDelayed(() -> {
                                    if (!t.isDestroyed()) t.reloadIgnoringCache();
                                }, 500);
                            }
                        } else if (nav.hasCommitted() && nav.httpStatusCode() >= 500) {
                            nfsFail(nav.httpStatusCode());
                        } else if (nav.hasCommitted()) {
                            nfsSaveDns();
                            if (!nfsFresh) {
                                nfsFresh = true;
                                t.reloadIgnoringCache();
                            }
                        }
                    }

                    @Override
                    public void didFirstVisuallyNonEmptyPaint(Tab t) {
                        if (nfsFresh) nfsHideLoading();
                    }

                    @Override
                    public void onPageLoadFinished(Tab t, org.chromium.url.GURL url) {
                        if (nfsFresh) nfsHideLoading();
                    }

                    @Override
                    public void onCrash(Tab t) {
                        if (nfsVisible) nfsFail(-1);
                    }
                });
    }

    /** NFS Launcher: fecha o jogo e volta à tela inicial, que mostra o erro em frase simples. */
    private void nfsFail(int code) {
        if (nfsFailed) return;
        nfsFailed = true;
        startActivity(
                new Intent()
                        .setClassName(getPackageName(), "xyz.nfs.launcher.MainActivity")
                        .putExtra("error", code)
                        .addFlags(
                                Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finishAndRemoveTask();
    }

    /** NFS Launcher: CD do jogo girando, por cima de tudo, até o jogo aparecer (no máximo 20 s). */
    private void nfsShowLoading() {
        if (nfsLoading != null || nfsLoadingDone) return;
        android.content.SharedPreferences p = getSharedPreferences("nfs", 4 /* MODE_MULTI_PROCESS */);
        String game = p.getString("game", "nfsu2");
        boolean en = "en".equals(p.getString("lang", "pt"));
        android.widget.FrameLayout box = new android.widget.FrameLayout(this);
        box.setBackgroundColor(Color.parseColor("#0B0D17"));
        box.setClickable(true);
        android.widget.ImageView bg = new android.widget.ImageView(this);
        bg.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
        bg.setImageBitmap(nfsImage("custom/" + game + "-bg.jpg", "bg/" + game + ".jpg"));
        bg.setColorFilter(Color.argb(170, 8, 10, 20));
        box.addView(bg, new android.widget.FrameLayout.LayoutParams(-1, -1));
        android.widget.LinearLayout col = new android.widget.LinearLayout(this);
        col.setOrientation(android.widget.LinearLayout.VERTICAL);
        col.setGravity(android.view.Gravity.CENTER);
        float d = getResources().getDisplayMetrics().density;
        android.widget.ImageView disc = new android.widget.ImageView(this);
        disc.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
        disc.setImageBitmap(nfsImage("custom/" + game + "-disc.png", "games/" + game + ".png"));
        disc.setOutlineProvider(
                new android.view.ViewOutlineProvider() {
                    @Override
                    public void getOutline(View v, android.graphics.Outline o) {
                        o.setOval(0, 0, v.getWidth(), v.getHeight());
                    }
                });
        disc.setClipToOutline(true);
        col.addView(disc, new android.widget.LinearLayout.LayoutParams((int) (110 * d), (int) (110 * d)));
        android.widget.TextView title = new android.widget.TextView(this);
        title.setText(en ? "Loading the game…" : "Carregando o jogo…");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setPadding(0, (int) (14 * d), 0, (int) (4 * d));
        col.addView(title);
        android.widget.TextView name = new android.widget.TextView(this);
        name.setText(p.getString("gameName", ""));
        name.setTextColor(Color.parseColor("#A4AAD0"));
        col.addView(name);
        android.widget.TextView note = new android.widget.TextView(this);
        note.setText(
                en
                        ? "The first time, the game files are downloaded; after that they stay on this phone."
                        : "Na primeira vez os arquivos do jogo são baixados; depois ficam guardados neste celular.");
        note.setTextColor(Color.parseColor("#A4AAD0"));
        note.setTextSize(12);
        note.setPadding(0, (int) (6 * d), 0, 0);
        col.addView(note);
        box.addView(col, new android.widget.FrameLayout.LayoutParams(-1, -1));
        android.animation.ObjectAnimator spin =
                android.animation.ObjectAnimator.ofFloat(disc, View.ROTATION, 0f, 360f);
        spin.setDuration(1600);
        spin.setRepeatCount(android.animation.ValueAnimator.INFINITE);
        spin.setInterpolator(new android.view.animation.LinearInterpolator());
        spin.start();
        box.setTag(spin);
        // Na janela, acima de todo o conteúdo: fica por cima também enquanto o navegador monta a tela dele.
        ((android.view.ViewGroup) getWindow().getDecorView()).addView(box, -1, -1);
        nfsLoading = box;
        box.postDelayed(this::nfsHideLoading, 20000);
    }

    private void nfsHideLoading() {
        nfsLoadingDone = true;
        View box = nfsLoading;
        if (box == null) return;
        nfsLoading = null;
        ((android.animation.ObjectAnimator) box.getTag()).cancel();
        ((android.view.ViewGroup) box.getParent()).removeView(box);
    }

    /** NFS Launcher: a imagem escolhida pelo jogador, se houver; senão a que vem no app. */
    private android.graphics.Bitmap nfsImage(String own, String asset) {
        java.io.File f = new java.io.File(getFilesDir(), own);
        if (f.exists()) return android.graphics.BitmapFactory.decodeFile(f.getPath());
        try (java.io.InputStream in = getAssets().open("nfs/" + asset)) {
            return android.graphics.BitmapFactory.decodeStream(in);
        } catch (java.io.IOException e) {
            return null;
        }
    }''')
    t = sub1(t, '''    @Override
    public void onStop() {
        super.onStop();
        if (mTimeoutHandler != null) mTimeoutHandler.onStop(this);
    }''', '''    @Override
    public void onStop() {
        super.onStop();
        if (mTimeoutHandler != null) mTimeoutHandler.onStop(this);
        nfsVisible = false;
        nfsGameState(false);
    }

    /**
     * NFS Launcher: avisa o Android 13+ que há um jogo em andamento (não interromper) ou que ele parou. O sistema e
     * os otimizadores de jogos usam isso para dar prioridade ao app.
     */
    private void nfsGameState(boolean playing) {
        if (android.os.Build.VERSION.SDK_INT < 33) return;
        try {
            android.app.GameManager gm = getSystemService(android.app.GameManager.class);
            if (gm == null) return;
            gm.setGameState(
                    new android.app.GameState(
                            false,
                            playing
                                    ? android.app.GameState.MODE_GAMEPLAY_UNINTERRUPTIBLE
                                    : android.app.GameState.MODE_NONE));
        } catch (Exception ignored) {
            // Celular sem o serviço de jogos: segue normal.
        }
    }''')
    return sub1(t, '''    protected void onDestroyInternal() {
        if (mTimeoutHandler != null) mTimeoutHandler.onDestroy();
        super.onDestroyInternal();
    }''', '''    protected void onDestroyInternal() {
        if (mTimeoutHandler != null) mTimeoutHandler.onDestroy();
        super.onDestroyInternal();
        if (isFinishing() && !isChangingConfigurations()) {
            // NFS Launcher: o jogo foi fechado de vez; encerra os processos do navegador (GPU incluída).
            int me = android.os.Process.myPid();
            android.app.ActivityManager am =
                    (android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE);
            java.util.List<android.app.ActivityManager.RunningAppProcessInfo> ps =
                    am == null ? null : am.getRunningAppProcesses();
            if (ps != null) {
                for (android.app.ActivityManager.RunningAppProcessInfo p : ps) {
                    if (p.pid != me && !p.processName.endsWith(":nfs")) {
                        android.os.Process.killProcess(p.pid);
                    }
                }
            }
            android.os.Process.killProcess(me);
        }
    }''')


def patch_secure_dns(t):
    # A tela do jogo liga o DNS seguro por aqui (a classe só era visível para a tela de ajustes). Só Java: o motor não muda.
    t = sub1(t, 'class SecureDnsBridge {', 'public class SecureDnsBridge {')
    t = sub1(t, '''    /**
     * @return The current Secure DNS mode (off, automatic, or secure).''', '''    /** NFS Launcher: com endereços, só o DNS seguro; vazio, volta ao padrão. */
    public static void nfsUse(String config) {
        if (config.isEmpty()) {
            setMode(SecureDnsMode.AUTOMATIC);
        } else if (setConfig(config)) {
            setMode(SecureDnsMode.SECURE);
        }
    }

    /**
     * @return The current Secure DNS mode (off, automatic, or secure).''')
    return t


def patch_media(t):
    # Sem o "player" de mídia na barra de notificações (ele segurava o jogo vivo depois de fechado).
    return sub1(t, '''        ChromeMediaNotificationManager.show(notificationInfo);''',
                '''        if (true) return; // NFS Launcher: sem player de mídia na notificação.
        ChromeMediaNotificationManager.show(notificationInfo);''')


def patch_no_tabs(t):
    # Sem abas/janelas novas: o app abre uma página só (a do jogo). Links "_blank" e window.open não abrem nada.
    t = sub1(t, '''        return mDelegate.shouldCreateWebContents(targetUrl);''',
             '''        return false; // NFS Launcher: sem abas/janelas novas.''')
    return sub1(t, '''        mDelegate.openNewTab(url, extraHeaders, postData, disposition, isRendererInitiated);''',
                '''        // NFS Launcher: sem abas novas.''')


def patch_no_jobs(t):
    # Sem tarefas agendadas no Android (o navegador acordava sozinho em segundo plano para elas).
    return sub1(t, '''        ThreadUtils.assertOnUiThread();

        JobInfo jobInfo = createJobInfoFromTaskInfo(context, taskInfo);''', '''        ThreadUtils.assertOnUiThread();
        if (true) return false; // NFS Launcher: nada agendado em segundo plano.

        JobInfo jobInfo = createJobInfoFromTaskInfo(context, taskInfo);''')


def patch_no_translate(t):
    # Sem o "Traduzir esta página?" por cima do jogo (site em inglês, celular em português).
    return sub1(t, '''  return prefs_->GetBoolean(prefs::kOfferTranslateEnabled);''',
                '''  return false;  // NFS Launcher: sem oferecer tradução por cima do jogo.''')


def patch_skia_icu(t):
    # Com minSdk 31 (Android 12+), o gerenciador de fontes do Skia chama a ICU do próprio Android direto
    # (u_strFoldCase etc.) em vez de abrir a libicu.so na hora: o link precisa da libicu.so do NDK.
    return sub1(t, '''    sources += skia_ports_fontmgr_android_ndk_sources\n''',
                '''    sources += skia_ports_fontmgr_android_ndk_sources
    libs = [ "icu" ]  # NFS Launcher: ICU do Android (NDK, API 31+), usada direto pelo Skia com minSdk 31\n''')


def patch_xr(t):
    # Sem as bibliotecas de realidade virtual/aumentada (~20 MB): só são usadas em óculos XR e WebXR.
    a = t.index('  loadable_modules_64_bit = [')
    b = t.index(']\n', a) + 2
    return t[:a] + '  # NFS Launcher: sem as bibliotecas nativas de XR/ARCore (~20 MB; só óculos XR e WebXR).\n' + \
        '  loadable_modules_64_bit = []\n' + t[b:]


PATCHES = [
    ('0001-confia-no-nfs-launcher.patch', [
        ('components/content_relationship_verification/android/java/src/org/chromium/components/'
         'content_relationship_verification/OriginVerifier.java', patch_origin_verifier)]),
    ('0002-sem-boas-vindas-e-avisos.patch', [
        ('chrome/android/java/src/org/chromium/chrome/browser/firstrun/FirstRunFlowSequencer.java', patch_fre),
        ('chrome/android/java/src/org/chromium/chrome/browser/browserservices/ui/controller/trustedwebactivity/'
         'TrustedWebActivityDisclosureController.java', patch_disclosure)]),
    ('0003-nome-nfs-motor.patch', [
        ('chrome/android/java/res_chromium_base/values/channel_constants.xml', patch_names)]),
    ('0004-fora-da-lista-de-navegadores.patch', [
        ('chrome/android/java/AndroidManifest.xml', patch_manifest)]),
    ('0005-app-unico-e-leve.patch', [
        ('chrome/android/chrome_public_apk_tmpl.gni', lambda t: patch_aapt_locales(patch_apk_deps(t))),
        ('chrome/android/BUILD.gn', patch_pak_locales),
        ('chrome/android/java/src/org/chromium/chrome/browser/base/SplitCompatApplication.java', patch_app_startup),
        ('chrome/android/modules/xr/xr_module.gni', patch_xr),
        ('skia/BUILD.gn', patch_skia_icu)]),
    ('0006-um-jogo-por-vez-e-nada-em-segundo-plano.patch', [
        ('chrome/android/java/src/org/chromium/chrome/browser/customtabs/CustomTabActivity.java', patch_game_activity),
        ('chrome/browser/privacy/java/src/org/chromium/chrome/browser/privacy/secure_dns/SecureDnsBridge.java', patch_secure_dns),
        ('chrome/android/java/src/org/chromium/chrome/browser/media/ui/MediaSessionTabHelper.java', patch_media),
        ('chrome/android/java/src/org/chromium/chrome/browser/tab/TabWebContentsDelegateAndroidImpl.java', patch_no_tabs),
        ('components/background_task_scheduler/internal/android/java/src/org/chromium/components/'
         'background_task_scheduler/internal/BackgroundTaskSchedulerJobService.java', patch_no_jobs),
        ('components/translate/core/browser/translate_prefs.cc', patch_no_translate)]),
    ('0007-texturas-hd-do-nfsu2.patch', [
        ('chrome/browser/chrome_content_browser_client.cc', patch_textures)]),
]


def git(*args):
    return subprocess.run(['git', *args], cwd=SRC, check=True, capture_output=True, text=True).stdout


if git('status', '--porcelain', '--untracked-files=no').strip():
    sys.exit('o código do Chromium já tem mudanças: rode "git checkout -- ." em ~/chromium/src antes')
OUT.mkdir(exist_ok=True)
for old in OUT.glob('*.patch'):
    old.unlink()
try:
    for name, files in PATCHES:
        for rel, fn in files:
            edit(rel, fn)
        diff = git('diff', '--', *[rel for rel, _ in files])
        (OUT / name).write_text(diff)
        print(f'{name}: {diff.count(chr(10))} linhas')
finally:
    git('checkout', '--', '.')
