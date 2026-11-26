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
      <!-- NFS Launcher: volta do app do Discord ao jogo (vincular o Discord). -->
      <activity android:name="org.chromium.chrome.browser.customtabs.CustomTabActivity$NfsDiscordBack"
          android:exported="true"
          android:excludeFromRecents="true"
          android:noHistory="true"
          android:taskAffinity=""
          android:theme="@android:style/Theme.NoDisplay">
          <intent-filter>
              <action android:name="android.intent.action.VIEW" />
              <category android:name="android.intent.category.DEFAULT" />
              <category android:name="android.intent.category.BROWSABLE" />
              <data android:scheme="https" android:host="nfsu2.xyz" android:path="/names/discord/back" />
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
            // NFS Launcher: opção "Preparar o jogo ao carregar" (Configurações > Desempenho), desligada por padrão desde 24/11.
            if (context.getSharedPreferences("nfs", 0).getBoolean("prepareGame", false)) {
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
    # - falha ao abrir ou jogo caído: volta à tela inicial, que mostra o erro em frase simples;
    # - vincular o Discord no NFSU2: login aqui mesmo ou pelo app do Discord (a volta chega pelo NfsDiscordBack).
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
        nfsDiscordResume();
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
        sNfsGame = new java.lang.ref.WeakReference<>(this);
        sNfsTab = new java.lang.ref.WeakReference<>(tab);
        nfsApplyDns();
        tab.addObserver(
                new org.chromium.chrome.browser.tab.TabObserver() {
                    @Override
                    public void onDidFinishNavigationInPrimaryMainFrame(
                            Tab t, org.chromium.content_public.browser.NavigationHandle nav) {
                        if (nav.isSameDocument()) return;
                        // Login do Discord: erro nas páginas dele não fecha o jogo.
                        if (nfsDiscordHost(nav.getUrl().getHost())) {
                            if (nav.hasCommitted() && nav.errorCode() == 0) nfsDiscordSeen(nav.getUrl());
                            return;
                        }
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
                        // Volta do login do Last.fm: a página do site grava a conta; depois, de volta ao jogo.
                        if (nfsGameHost(url.getHost()) && "/lastfm.html".equals(url.getPath())) {
                            String home = "https://" + url.getHost() + "/";
                            getWindow().getDecorView().postDelayed(() -> {
                                if (!t.isDestroyed()) {
                                    t.loadUrl(new org.chromium.content_public.browser.LoadUrlParams(home));
                                }
                            }, 3000);
                        }
                    }

                    @Override
                    public void onCrash(Tab t) {
                        if (nfsVisible) nfsFail(-1);
                    }
                });
    }

    private static boolean nfsGameHost(String h) {
        return "nfsu2.xyz".equals(h) || "www.nfsu2.xyz".equals(h)
                || "nfsu2mod.xyz".equals(h) || "www.nfsu2mod.xyz".equals(h);
    }

    // NFS Launcher: vincular o Discord. O login abre aqui mesmo (discord.com é origem confiável da TWA);
    // quem tem o app do Discord pode usar ele, e a volta (/names/discord/back) chega pelo NfsDiscordBack.
    private static java.lang.ref.WeakReference<CustomTabActivity> sNfsGame;
    private static java.lang.ref.WeakReference<Tab> sNfsTab;
    private static String sNfsDiscordState;
    private static long sNfsDiscordAt;
    private static String sNfsForwarded;
    private static long sNfsForwardedAt;
    private static final long NFS_DISCORD_MS = 10 * 60 * 1000;
    private @Nullable String nfsDiscordWaiting;

    static boolean nfsDiscordHost(@Nullable String h) {
        if (h == null) return false;
        return "discord.com".equals(h) || h.endsWith(".discord.com")
                || "discordapp.com".equals(h) || h.endsWith(".discordapp.com");
    }

    private boolean nfsEn() {
        return "en".equals(getSharedPreferences("nfs", 4 /* MODE_MULTI_PROCESS */).getString("lang", "pt"));
    }

    /** Página de autorização do Discord aberta no jogo: guarda o pedido e oferece o app do Discord. */
    @SuppressWarnings("deprecation")
    private void nfsDiscordSeen(org.chromium.url.GURL g) {
        android.net.Uri u = android.net.Uri.parse(g.getSpec());
        String path = u.getPath();
        if ("/login".equals(path)) {
            String to = u.getQueryParameter("redirect_to");
            if (to == null || !to.startsWith("/oauth2/authorize")) return;
            u = android.net.Uri.parse("https://discord.com" + to);
        } else if (!"/oauth2/authorize".equals(path)) {
            return;
        }
        String state = u.getQueryParameter("state");
        if (state == null || state.isEmpty() || state.equals(sNfsDiscordState)) return;
        sNfsDiscordState = state;
        sNfsDiscordAt = System.currentTimeMillis();
        nfsDiscordFile(state + "\\n" + sNfsDiscordAt);
        Intent app = new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)
                .setPackage("com.discord");
        if (getPackageManager().queryIntentActivities(app, 0).isEmpty()) return;
        final String url = u.toString();
        boolean en = nfsEn();
        new android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(en ? "Link Discord" : "Vincular o Discord")
                .setMessage(en ? "Use the Discord app on this phone, or sign in right here?"
                        : "Usar o app do Discord deste celular ou entrar aqui mesmo?")
                .setPositiveButton(en ? "Discord app" : "App do Discord", (d, w) -> nfsUseDiscordApp(url))
                .setNegativeButton(en ? "Sign in here" : "Entrar aqui", null)
                .show();
    }

    private void nfsDiscordFile(String s) {
        try {
            java.nio.file.Files.write(new java.io.File(getFilesDir(), "nfs-discord").toPath(),
                    s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (java.io.IOException e) {
            // Sem o arquivo: só a volta com o jogo aberto funciona.
        }
    }

    private void nfsUseDiscordApp(String url) {
        if (nfsLinksAllowed()) {
            nfsLaunchDiscord(url);
            return;
        }
        nfsDiscordWaiting = url;
        boolean en = nfsEn();
        new android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(en ? "Link Discord" : "Vincular o Discord")
                .setMessage(en
                        ? "For Discord to bring you back to the game, NFS Launcher needs to open the game's links: on the next screen, turn on \\"Open supported links\\", tap \\"Add link\\", check what shows up and confirm. Then come back here."
                        : "Para o Discord trazer você de volta ao jogo, o NFS Launcher precisa abrir os links do jogo: na próxima tela, ligue \\"Abrir links compatíveis\\", toque em \\"Adicionar link\\", marque o que aparecer e confirme. Depois, volte aqui.")
                .setPositiveButton(en ? "Open settings" : "Abrir configurações", (d, w) -> nfsOpenLinkSettings())
                .setNegativeButton(en ? "Sign in here" : "Entrar aqui", (d, w) -> nfsDiscordWaiting = null)
                .setOnCancelListener(d -> nfsDiscordWaiting = null)
                .show();
    }

    private void nfsOpenLinkSettings() {
        android.net.Uri pkg = android.net.Uri.parse("package:" + getPackageName());
        try {
            startActivity(new Intent(android.provider.Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS, pkg));
        } catch (RuntimeException e) {
            try {
                startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg));
            } catch (RuntimeException e2) {
                nfsDiscordWaiting = null;
            }
        }
    }

    /** Volta das configurações: com a permissão, segue pelo app do Discord; sem, fica o login aqui. */
    private void nfsDiscordResume() {
        final String url = nfsDiscordWaiting;
        if (url == null) return;
        nfsDiscordWaiting = null;
        getWindow().getDecorView().post(() -> {
            if (nfsLinksAllowed()) {
                nfsLaunchDiscord(url);
            } else {
                boolean en = nfsEn();
                android.widget.Toast.makeText(this, en
                        ? "Without this permission, Discord can't bring you back to the game. Sign in to Discord right here."
                        : "Sem essa permissão, o Discord não traz você de volta ao jogo. Entre no Discord aqui mesmo.",
                        android.widget.Toast.LENGTH_LONG).show();
            }
        });
    }

    private void nfsLaunchDiscord(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))
                    .addCategory(Intent.CATEGORY_BROWSABLE).setPackage("com.discord")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException e) {
            // Sem o app do Discord: o login continua aqui.
        }
    }

    private boolean nfsLinksAllowed() {
        try {
            android.content.pm.verify.domain.DomainVerificationManager m =
                    getSystemService(android.content.pm.verify.domain.DomainVerificationManager.class);
            if (m == null) return false;
            android.content.pm.verify.domain.DomainVerificationUserState s =
                    m.getDomainVerificationUserState(getPackageName());
            if (s == null || !s.isLinkHandlingAllowed()) return false;
            Integer st = s.getHostToStateMap().get("nfsu2.xyz");
            return st != null
                    && st != android.content.pm.verify.domain.DomainVerificationUserState.DOMAIN_STATE_NONE;
        } catch (Exception e) {
            return false;
        }
    }

    /** NFS Launcher: volta do app do Discord (/names/discord/back) para o jogo que pediu o vínculo. */
    public static class NfsDiscordBack extends android.app.Activity {
        @Override
        protected void onCreate(@Nullable android.os.Bundle b) {
            super.onCreate(b);
            try {
                nfsBack(getIntent() == null ? null : getIntent().getData());
            } catch (RuntimeException e) {
                // Nada a fazer: a tela some.
            }
            finish();
        }

        @SuppressWarnings("deprecation")
        private void nfsBack(@Nullable android.net.Uri u) {
            if (u == null || !"https".equals(u.getScheme()) || !"nfsu2.xyz".equals(u.getHost())
                    || u.getPort() != -1 || u.getUserInfo() != null
                    || !"/names/discord/back".equals(u.getPath())) {
                return;
            }
            String state = u.getQueryParameter("state");
            long now = System.currentTimeMillis();
            boolean en = "en".equals(getSharedPreferences("nfs", 4).getString("lang", "pt"));
            CustomTabActivity game = sNfsGame == null ? null : sNfsGame.get();
            Tab tab = sNfsTab == null ? null : sNfsTab.get();
            java.io.File f = new java.io.File(getFilesDir(), "nfs-discord");
            if (state != null && state.equals(sNfsDiscordState) && now - sNfsDiscordAt < NFS_DISCORD_MS
                    && game != null && !game.isFinishing() && !game.isDestroyed()
                    && tab != null && !tab.isDestroyed()) {
                sNfsDiscordState = null;
                nfsClear(f);
                tab.loadUrl(new LoadUrlParams(u.toString()));
                android.app.ActivityManager am = getSystemService(android.app.ActivityManager.class);
                if (am != null) am.moveTaskToFront(game.getTaskId(), 0);
                return;
            }
            String[] saved = nfsRead(f).split("\\n");
            long at = 0;
            try {
                if (saved.length == 2) at = Long.parseLong(saved[1].trim());
            } catch (NumberFormatException e) {
                at = 0;
            }
            if (state != null && saved.length == 2 && state.equals(saved[0].trim())
                    && now - at >= 0 && now - at < NFS_DISCORD_MS) {
                nfsClear(f);
                android.widget.Toast.makeText(this, en
                        ? "The game had been closed. Open it again and link Discord once more."
                        : "O jogo tinha sido fechado. Abra de novo e vincule o Discord outra vez.",
                        android.widget.Toast.LENGTH_LONG).show();
                startActivity(new Intent().setClassName(getPackageName(), "xyz.nfs.launcher.MainActivity")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            }
            // Não foi o jogo que pediu: segue para o navegador padrão do celular.
            String url = u.toString();
            if (url.equals(sNfsForwarded) && now - sNfsForwardedAt < 5000) return;
            sNfsForwarded = url;
            sNfsForwardedAt = now;
            android.content.pm.PackageManager pm = getPackageManager();
            Intent probe = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://nfsu2.xyz/"))
                    .addCategory(Intent.CATEGORY_BROWSABLE);
            String browser = null;
            android.content.pm.ResolveInfo def =
                    pm.resolveActivity(probe, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
            if (def != null && def.activityInfo != null && !"android".equals(def.activityInfo.packageName)
                    && !getPackageName().equals(def.activityInfo.packageName)) {
                browser = def.activityInfo.packageName;
            }
            if (browser == null) {
                Intent any = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://example.org/"))
                        .addCategory(Intent.CATEGORY_BROWSABLE);
                for (android.content.pm.ResolveInfo r : pm.queryIntentActivities(any, 0)) {
                    if (r.activityInfo != null && !getPackageName().equals(r.activityInfo.packageName)) {
                        browser = r.activityInfo.packageName;
                        break;
                    }
                }
            }
            if (browser == null) return;
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)
                    .setPackage(browser).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }

        private static String nfsRead(java.io.File f) {
            try {
                return new String(java.nio.file.Files.readAllBytes(f.toPath()),
                        java.nio.charset.StandardCharsets.UTF_8);
            } catch (java.io.IOException e) {
                return "";
            }
        }

        private static void nfsClear(java.io.File f) {
            try {
                java.nio.file.Files.write(f.toPath(), new byte[0]);
            } catch (java.io.IOException e) {
                // Fica velho: passa dos 10 minutos e não vale mais.
            }
        }
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
        nfsSongButton();
        View box = nfsLoading;
        if (box == null) return;
        nfsLoading = null;
        ((android.animation.ObjectAnimator) box.getTag()).cancel();
        ((android.view.ViewGroup) box.getParent()).removeView(box);
    }

    private @Nullable View nfsSong;
    private @Nullable View nfsDronePad;
    private boolean nfsDrawerLeft;
    private float nfsDrawerY = 0.5f;

    /**
     * NFS Launcher: gaveta opcional de atalhos (teclas F do NFSU2), desligada por padrão, presa na borda que o
     * jogador escolheu nas Configurações, como o Game Turbo: puxa ou toca na alça e ela abre. Manda as teclas
     * como um teclado de verdade; não mexe no site.
     */
    private void nfsSongButton() {
        if (nfsSong != null) return;
        android.content.SharedPreferences p = getSharedPreferences("nfs", 4 /* MODE_MULTI_PROCESS */);
        String game = p.getString("game", "nfsu2");
        if (!p.getBoolean("keyDrawer", false) || !("nfsu2".equals(game) || "nfsu2mod".equals(game))) return;
        boolean en = "en".equals(p.getString("lang", "pt"));
        boolean left = p.getInt("drawerX", 100) < 50;
        float fy = Math.max(0, Math.min(100, p.getInt("drawerY", 50))) / 100f;
        nfsDrawerLeft = left;
        nfsDrawerY = fy;
        float d = getResources().getDisplayMetrics().density;
        int[] keys = {
            android.view.KeyEvent.KEYCODE_F7, android.view.KeyEvent.KEYCODE_F9, android.view.KeyEvent.KEYCODE_L,
            android.view.KeyEvent.KEYCODE_F6,
            android.view.KeyEvent.KEYCODE_F12, android.view.KeyEvent.KEYCODE_F10, android.view.KeyEvent.KEYCODE_F8};
        String[] names = en
                ? new String[] {"\\u266B Next song", "\\u2630 Menu", "\\u25AD Skateboard", "\\u2708 Drone", "\\u25A3 Photo", "\\u25CC Hide HUD", "FPS"}
                : new String[] {"\\u266B Próxima música", "\\u2630 Menu", "\\u25AD Skate", "\\u2708 Drone", "\\u25A3 Foto", "\\u25CC Esconder HUD", "FPS"};
        String[] fk = {"F7", "F9", "L", "F6", "F12", "F10", "F8"};
        android.widget.LinearLayout panel = new android.widget.LinearLayout(this);
        panel.setOrientation(android.widget.LinearLayout.VERTICAL);
        int pad = (int) (6 * d);
        panel.setPadding(pad, pad, pad, pad);
        android.graphics.drawable.GradientDrawable pbg = new android.graphics.drawable.GradientDrawable();
        pbg.setColor(Color.argb(215, 8, 10, 20));
        pbg.setStroke((int) d, Color.argb(110, 255, 255, 255));
        pbg.setCornerRadius(12 * d);
        panel.setBackground(pbg);
        Runnable[] close = new Runnable[1];
        for (int i = 0; i < keys.length; i++) {
            final int code = keys[i];
            android.widget.TextView b = new android.widget.TextView(this);
            b.setText(names[i] + "   " + fk[i]);
            b.setTextColor(Color.WHITE);
            b.setTextSize(14);
            b.setGravity(android.view.Gravity.CENTER_VERTICAL);
            b.setPadding((int) (12 * d), 0, (int) (12 * d), 0);
            b.setFocusable(false);
            android.graphics.drawable.GradientDrawable bbg = new android.graphics.drawable.GradientDrawable();
            bbg.setColor(Color.argb(60, 255, 255, 255));
            bbg.setCornerRadius(8 * d);
            b.setBackground(bbg);
            b.setOnTouchListener(
                    (v, e) -> {
                        int a = e.getActionMasked();
                        if (a == android.view.MotionEvent.ACTION_DOWN) {
                            v.setAlpha(0.6f);
                            v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);
                            if (code != android.view.KeyEvent.KEYCODE_F6) nfsKey(code, android.view.KeyEvent.ACTION_DOWN);
                        } else if (a == android.view.MotionEvent.ACTION_UP
                                || a == android.view.MotionEvent.ACTION_CANCEL) {
                            v.setAlpha(1f);
                            panel.removeCallbacks(close[0]);
                            if (code == android.view.KeyEvent.KEYCODE_F6) {
                                if (a == android.view.MotionEvent.ACTION_UP) nfsDrone(nfsDronePad == null);
                                close[0].run();
                                return true;
                            }
                            nfsKey(code, android.view.KeyEvent.ACTION_UP);
                            panel.postDelayed(close[0], 5000);
                        }
                        return true;
                    });
            android.widget.LinearLayout.LayoutParams lp =
                    new android.widget.LinearLayout.LayoutParams(-1, (int) (40 * d));
            if (i > 0) lp.topMargin = (int) (5 * d);
            panel.addView(b, lp);
        }
        panel.setVisibility(View.GONE);
        android.widget.TextView handle = new android.widget.TextView(this);
        handle.setTextColor(Color.argb(220, 255, 255, 255));
        handle.setTextSize(20);
        handle.setGravity(android.view.Gravity.CENTER);
        handle.setFocusable(false);
        android.graphics.drawable.GradientDrawable hbg = new android.graphics.drawable.GradientDrawable();
        hbg.setColor(Color.argb(130, 8, 10, 20));
        float r = 10 * d;
        hbg.setCornerRadii(left ? new float[] {0, 0, r, r, r, r, 0, 0} : new float[] {r, r, 0, 0, 0, 0, r, r});
        handle.setBackground(hbg);
        int hw = (int) (20 * d), hh = (int) (64 * d), gap = (int) (4 * d), pw = (int) (190 * d);
        android.widget.FrameLayout layer = new android.widget.FrameLayout(this);
        layer.addView(handle, new android.widget.FrameLayout.LayoutParams(hw, hh));
        layer.addView(panel, new android.widget.FrameLayout.LayoutParams(pw, -2));
        Runnable place =
                () -> {
                    int w = layer.getWidth(), h = layer.getHeight();
                    boolean open = panel.getVisibility() == View.VISIBLE;
                    int ph = panel.getHeight() > 0 ? panel.getHeight() : (int) (keys.length * 45 * d + 12 * d);
                    float hy = fy * Math.max(0, h - hh);
                    handle.setX(open ? (left ? gap + pw : w - gap - pw - hw) : (left ? 0 : w - hw));
                    handle.setY(hy);
                    handle.setText(open == left ? "\\u2039" : "\\u203A");
                    panel.setX(left ? gap : w - gap - pw);
                    panel.setY(Math.max(gap, Math.min(h - ph - gap, hy + hh / 2f - ph / 2f)));
                };
        close[0] = () -> {
            panel.setVisibility(View.GONE);
            layer.post(place);
        };
        float[] down = new float[1];
        handle.setOnTouchListener(
                (v, e) -> {
                    int a = e.getActionMasked();
                    if (a == android.view.MotionEvent.ACTION_DOWN) {
                        down[0] = e.getRawX();
                    } else if (a == android.view.MotionEvent.ACTION_UP) {
                        float dx = e.getRawX() - down[0];
                        boolean open = panel.getVisibility() == View.VISIBLE;
                        // Toque abre ou fecha; puxar para dentro abre, empurrar para a borda fecha.
                        boolean want = Math.abs(dx) < 8 * d ? !open : (left ? dx > 0 : dx < 0);
                        panel.setVisibility(want ? View.VISIBLE : View.GONE);
                        panel.removeCallbacks(close[0]);
                        if (want) {
                            v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);
                            panel.postDelayed(close[0], 5000);
                        }
                        layer.post(place);
                    }
                    return true;
                });
        // Camada do tamanho da tela que não pega toque: só a alça e a gaveta pegam; o resto vai para o jogo.
        layer.addOnLayoutChangeListener((v, l, t, rr, bt, ol, ot, or, ob) -> place.run());
        ((android.view.ViewGroup) getWindow().getDecorView()).addView(layer, -1, -1);
        nfsSong = layer;
    }

    private void nfsKey(int code, int action) {
        Tab tab = sNfsTab == null ? null : sNfsTab.get();
        View v = tab == null ? null : tab.getContentView();
        if (v == null) return;
        long now = android.os.SystemClock.uptimeMillis();
        // O site lê KeyboardEvent.code, que o Chromium tira do scancode (evdev); sem ele o code vem vazio.
        int sc = code == android.view.KeyEvent.KEYCODE_F6 ? 64
                : code == android.view.KeyEvent.KEYCODE_F7 ? 65
                : code == android.view.KeyEvent.KEYCODE_F8 ? 66
                : code == android.view.KeyEvent.KEYCODE_F9 ? 67
                : code == android.view.KeyEvent.KEYCODE_F10 ? 68
                : code == android.view.KeyEvent.KEYCODE_F12 ? 88
                : code == android.view.KeyEvent.KEYCODE_L ? 38
                : code == android.view.KeyEvent.KEYCODE_W ? 17
                : code == android.view.KeyEvent.KEYCODE_A ? 30
                : code == android.view.KeyEvent.KEYCODE_S ? 31
                : code == android.view.KeyEvent.KEYCODE_D ? 32
                : code == android.view.KeyEvent.KEYCODE_SHIFT_LEFT ? 42
                : code == android.view.KeyEvent.KEYCODE_DPAD_UP ? 103
                : code == android.view.KeyEvent.KEYCODE_DPAD_LEFT ? 105
                : code == android.view.KeyEvent.KEYCODE_DPAD_RIGHT ? 106
                : code == android.view.KeyEvent.KEYCODE_DPAD_DOWN ? 108
                : code == android.view.KeyEvent.KEYCODE_F ? 33
                : code == android.view.KeyEvent.KEYCODE_G ? 34
                : code == android.view.KeyEvent.KEYCODE_MINUS ? 12
                : code == android.view.KeyEvent.KEYCODE_EQUALS ? 13
                : code == android.view.KeyEvent.KEYCODE_ESCAPE ? 1 : 0;
        v.dispatchKeyEvent(
                new android.view.KeyEvent(now, now, action, code, 0, 0,
                        android.view.KeyCharacterMap.VIRTUAL_KEYBOARD, sc,
                        android.view.KeyEvent.FLAG_FROM_SYSTEM, android.view.InputDevice.SOURCE_KEYBOARD));
        if (action == android.view.KeyEvent.ACTION_UP && nfsDronePad == null) nfsTouchBack();
    }

    /** NFS Launcher: tecla esconde os controles de toque do site; um toque de dedo (logo cancelado) na borda da alça os traz de volta. */
    private void nfsTouchBack() {
        Tab tab = sNfsTab == null ? null : sNfsTab.get();
        View v = tab == null ? null : tab.getContentView();
        if (v == null) return;
        long now = android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent.PointerProperties pp = new android.view.MotionEvent.PointerProperties();
        pp.id = 0;
        pp.toolType = android.view.MotionEvent.TOOL_TYPE_FINGER;
        android.view.MotionEvent.PointerCoords pc = new android.view.MotionEvent.PointerCoords();
        pc.x = nfsDrawerLeft ? 0 : v.getWidth() - 1;
        pc.y = nfsDrawerY * v.getHeight();
        pc.pressure = 1;
        pc.size = 1;
        for (int a : new int[] {android.view.MotionEvent.ACTION_DOWN, android.view.MotionEvent.ACTION_CANCEL}) {
            android.view.MotionEvent m = android.view.MotionEvent.obtain(now, now, a, 1,
                    new android.view.MotionEvent.PointerProperties[] {pp},
                    new android.view.MotionEvent.PointerCoords[] {pc}, 0, 0, 1, 1, 0, 0,
                    android.view.InputDevice.SOURCE_TOUCHSCREEN, 0);
            v.dispatchTouchEvent(m);
            m.recycle();
        }
    }

    /**
     * NFS Launcher: o site só libera o drone no celular com um controle conectado (não tem comandos de toque para ele).
     * Liga um controle de mentira (GamepadList, propriedade "nfs.pad"), aperta F6 e mostra WASD e setas na tela.
     */
    private void nfsDrone(boolean on) {
        android.view.ViewGroup root = (android.view.ViewGroup) getWindow().getDecorView();
        int f6 = android.view.KeyEvent.KEYCODE_F6;
        if (on) {
            if (nfsDronePad != null) return;
            if (nfsRealPad()) {
                // Com controle de verdade o site já libera o drone e o jogador voa pelo controle: só o F6.
                nfsKey(f6, android.view.KeyEvent.ACTION_DOWN);
                nfsKey(f6, android.view.KeyEvent.ACTION_UP);
                return;
            }
            // O Blink só mostra o controle depois de um "toque" nele: o eixo pisca por 2 s para não passar batido.
            System.setProperty("nfs.padPulse", String.valueOf(android.os.SystemClock.uptimeMillis() + 150));
            System.setProperty("nfs.pad", "1");
            View pad = nfsDronePadView();
            nfsDronePad = pad;
            root.addView(pad, -1, -1);
        } else {
            View pad = nfsDronePad;
            if (pad == null) return;
            nfsKey(android.view.KeyEvent.KEYCODE_ESCAPE, android.view.KeyEvent.ACTION_DOWN);
            nfsKey(android.view.KeyEvent.KEYCODE_ESCAPE, android.view.KeyEvent.ACTION_UP);
            root.removeView(pad);
            nfsDronePad = null;
            root.postDelayed(
                    () -> {
                        if (nfsDronePad != null) return;
                        System.clearProperty("nfs.pad");
                        nfsTouchBack();
                    },
                    500);
        }
    }

    private static boolean nfsRealPad() {
        for (int id : android.view.InputDevice.getDeviceIds()) {
            android.view.InputDevice dev = android.view.InputDevice.getDevice(id);
            if (dev == null || dev.isVirtual()) continue;
            int src = dev.getSources();
            String name = dev.getName();
            if (name != null && name.startsWith("uinput")) continue;
            if ((src & android.view.InputDevice.SOURCE_JOYSTICK) == android.view.InputDevice.SOURCE_JOYSTICK
                    && (src & android.view.InputDevice.SOURCE_GAMEPAD) == android.view.InputDevice.SOURCE_GAMEPAD
                    && dev.hasKeys(android.view.KeyEvent.KEYCODE_BUTTON_A)[0]) {
                return true;
            }
        }
        return false;
    }

    private View nfsDronePadView() {
        float d = getResources().getDisplayMetrics().density;
        boolean en = "en".equals(getSharedPreferences("nfs", 4 /* MODE_MULTI_PROCESS */).getString("lang", "pt"));
        int s = (int) (58 * d), m = (int) (18 * d);
        android.widget.FrameLayout layer = new android.widget.FrameLayout(this);
        int[][] keys = {
            {android.view.KeyEvent.KEYCODE_W, android.view.KeyEvent.KEYCODE_A,
                    android.view.KeyEvent.KEYCODE_S, android.view.KeyEvent.KEYCODE_D},
            {android.view.KeyEvent.KEYCODE_DPAD_UP, android.view.KeyEvent.KEYCODE_DPAD_LEFT,
                    android.view.KeyEvent.KEYCODE_DPAD_DOWN, android.view.KeyEvent.KEYCODE_DPAD_RIGHT}};
        String[][] names = {{"W", "A", "S", "D"}, {"\\u25B2", "\\u25C0", "\\u25BC", "\\u25B6"}};
        int[] cx = {1, 0, 1, 2}, cy = {0, 1, 2, 1};
        int shift = android.view.KeyEvent.KEYCODE_SHIFT_LEFT;
        for (int side = 0; side < 2; side++) {
            android.widget.FrameLayout cross = new android.widget.FrameLayout(this);
            // No WASD, o Shift fica em cima do W (uma linha a mais), e puxar o W para cima também liga o Shift.
            int row = side == 0 ? 1 : 0;
            for (int i = 0; i < 4; i++) {
                android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(s, s);
                lp.leftMargin = cx[i] * s;
                lp.topMargin = (cy[i] + row) * s;
                android.widget.TextView k = nfsHoldKey(names[side][i], keys[side][i], d);
                if (side == 0 && i == 0) {
                    // W fica apertado; puxar para cima soma o Shift, para a esquerda o A, para a direita o D.
                    int w = keys[0][0];
                    int[] extra = {shift, keys[0][1], keys[0][3]};
                    boolean[] on = {false, false, false};
                    k.setOnTouchListener(
                            (v, e) -> {
                                int a = e.getActionMasked();
                                if (a == android.view.MotionEvent.ACTION_DOWN) {
                                    nfsKey(w, android.view.KeyEvent.ACTION_DOWN);
                                } else if (a == android.view.MotionEvent.ACTION_MOVE) {
                                    float x = e.getX(), y = e.getY(), t = s * 0.3f;
                                    boolean[] want = {y < -t, x < -t, x > v.getWidth() + t};
                                    for (int j = 0; j < 3; j++) {
                                        if (want[j] != on[j]) {
                                            on[j] = want[j];
                                            nfsKey(extra[j], on[j] ? android.view.KeyEvent.ACTION_DOWN : android.view.KeyEvent.ACTION_UP);
                                        }
                                    }
                                } else if (a == android.view.MotionEvent.ACTION_UP || a == android.view.MotionEvent.ACTION_CANCEL) {
                                    for (int j = 0; j < 3; j++) {
                                        if (on[j]) nfsKey(extra[j], android.view.KeyEvent.ACTION_UP);
                                        on[j] = false;
                                    }
                                    nfsKey(w, android.view.KeyEvent.ACTION_UP);
                                }
                                return true;
                            });
                }
                cross.addView(k, lp);
            }
            if (side == 0) {
                android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(s, s);
                lp.leftMargin = s;
                android.widget.TextView f = nfsHoldKey("\\u21E7 Shift", shift, d);
                f.setTextSize(13);
                cross.addView(f, lp);
            }
            android.widget.FrameLayout.LayoutParams cp = new android.widget.FrameLayout.LayoutParams(3 * s, (3 + row) * s,
                    android.view.Gravity.BOTTOM | (side == 0 ? android.view.Gravity.START : android.view.Gravity.END));
            cp.setMargins(m, m, m, m);
            layer.addView(cross, cp);
        }
        // Barra de baixo, no meio: F, G, -, = e L, cada um uma tecla. Sair do drone = tocar de novo no Drone da gaveta.
        android.widget.LinearLayout bar = new android.widget.LinearLayout(this);
        bar.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        int[] bk = {android.view.KeyEvent.KEYCODE_F, android.view.KeyEvent.KEYCODE_G, android.view.KeyEvent.KEYCODE_MINUS,
            android.view.KeyEvent.KEYCODE_EQUALS, android.view.KeyEvent.KEYCODE_L};
        String[] bn = {"F", "G", "-", "=", "L"};
        int bs = (int) (44 * d);
        for (int i = 0; i < bk.length; i++) {
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(bs, bs);
            lp.leftMargin = lp.rightMargin = (int) (4 * d);
            bar.addView(nfsHoldKey(bn[i], bk[i], d), lp);
        }
        android.widget.FrameLayout.LayoutParams bp = new android.widget.FrameLayout.LayoutParams(-2, -2,
                android.view.Gravity.BOTTOM | android.view.Gravity.CENTER_HORIZONTAL);
        bp.bottomMargin = m;
        layer.addView(bar, bp);
        // O F6 não liga o drone no celular: caixa que explica ativar pelo menu; só fecha depois de marcar "Li".
        android.widget.LinearLayout box = new android.widget.LinearLayout(this);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        int bpad = (int) (16 * d);
        box.setPadding(bpad, bpad, bpad, bpad);
        android.graphics.drawable.GradientDrawable xbg = new android.graphics.drawable.GradientDrawable();
        xbg.setColor(Color.argb(235, 8, 10, 20));
        xbg.setStroke((int) d, Color.argb(120, 255, 255, 255));
        xbg.setCornerRadius(12 * d);
        box.setBackground(xbg);
        box.setClickable(true);
        android.widget.TextView tip = new android.widget.TextView(this);
        tip.setText(en
                ? "To start the drone: drive a little with these on-screen controls, then open the menu (\\u2630) and turn on the Drone.\\nTo leave, tap Drone in the drawer again."
                : "Para ligar o drone: ande um pouco com estes controles da tela, depois abra o menu (\\u2630) e ative o Drone.\\nPara sair, toque de novo em Drone na gaveta.");
        tip.setTextColor(Color.WHITE);
        tip.setTextSize(15);
        box.addView(tip);
        android.widget.CheckBox read = new android.widget.CheckBox(this);
        read.setText(en ? "I have read it" : "Li e entendi");
        read.setTextColor(Color.WHITE);
        read.setButtonTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        android.widget.LinearLayout.LayoutParams rp = new android.widget.LinearLayout.LayoutParams(-2, -2);
        rp.topMargin = (int) (10 * d);
        box.addView(read, rp);
        android.widget.TextView close = nfsHoldKey(en ? "Close" : "Fechar", 0, d);
        close.setAlpha(0.4f);
        close.setOnTouchListener(
                (v, e) -> {
                    if (e.getActionMasked() == android.view.MotionEvent.ACTION_UP && read.isChecked()) {
                        box.setVisibility(View.GONE);
                    }
                    return true;
                });
        read.setOnCheckedChangeListener((c, on) -> close.setAlpha(on ? 1f : 0.4f));
        android.widget.LinearLayout.LayoutParams clp = new android.widget.LinearLayout.LayoutParams(-1, (int) (44 * d));
        clp.topMargin = (int) (10 * d);
        box.addView(close, clp);
        android.widget.FrameLayout.LayoutParams xp = new android.widget.FrameLayout.LayoutParams((int) (380 * d), -2,
                android.view.Gravity.TOP | android.view.Gravity.CENTER_HORIZONTAL);
        xp.topMargin = m;
        layer.addView(box, xp);
        return layer;
    }

    private android.widget.TextView nfsHoldKey(String label, int code, float d) {
        android.widget.TextView b = new android.widget.TextView(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(16);
        b.setGravity(android.view.Gravity.CENTER);
        b.setFocusable(false);
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.argb(110, 8, 10, 20));
        bg.setStroke((int) d, Color.argb(120, 255, 255, 255));
        bg.setCornerRadius(10 * d);
        b.setBackground(bg);
        b.setOnTouchListener(
                (v, e) -> {
                    int a = e.getActionMasked();
                    if (a == android.view.MotionEvent.ACTION_DOWN) {
                        v.setAlpha(0.6f);
                        nfsKey(code, android.view.KeyEvent.ACTION_DOWN);
                    } else if (a == android.view.MotionEvent.ACTION_UP || a == android.view.MotionEvent.ACTION_CANCEL) {
                        v.setAlpha(1f);
                        nfsKey(code, android.view.KeyEvent.ACTION_UP);
                    }
                    return true;
                });
        return b;
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


def patch_gamepad(t):
    # Controle de mentira para o drone do NFSU2 (ver nfsDrone no CustomTabActivity): só existe com a
    # propriedade "nfs.pad", no último lugar livre; um puxão curto no analógico direito conta como o
    # primeiro uso (sem ele o Chromium não mostra o controle à página).
    return sub1(t, '''                } else {
                    GamepadListJni.get()''', '''                } else if (i == MAX_GAMEPADS - 1 && System.getProperty("nfs.pad") != null) {
                    long now = android.os.SystemClock.uptimeMillis();
                    float[] axes = new float[4];
                    String pulse = System.getProperty("nfs.padPulse");
                    if (pulse != null && now < Long.parseLong(pulse)) axes[3] = 0.6f;
                    GamepadListJni.get()
                            .setGamepadData(webGamepadsPtr, i, true, true, "NFS Launcher", 0, 0, now,
                                    axes, new float[17], 17, false);
                } else {
                    GamepadListJni.get()''')


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
    # Exceções iguais ao PC: Spotify e .fmbot abrem no navegador do aparelho; o login do Last.fm abre na própria
    # tela do jogo (a volta cai no site do jogo, que guarda a conta, e o app volta ao jogo).
    t = sub1(t, '''        return mDelegate.shouldCreateWebContents(targetUrl);''',
             '''        nfsOpen(targetUrl);
        return false; // NFS Launcher: sem abas/janelas novas.
    }

    private void nfsOpen(GURL u) {
        if (!"https".equals(u.getScheme()) || !u.getPort().isEmpty() || !u.getUsername().isEmpty()
                || !u.getPassword().isEmpty()) return;
        String h = u.getHost();
        String spec = u.getSpec();
        if ("open.spotify.com".equals(h) || "fm.bot".equals(h)) {
            try {
                ContextUtils.getApplicationContext()
                        .startActivity(
                                new android.content.Intent(
                                                android.content.Intent.ACTION_VIEW, android.net.Uri.parse(spec))
                                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (RuntimeException e) {
                // Sem navegador no aparelho: não abre nada.
            }
        } else if ("www.last.fm".equals(h) || "last.fm".equals(h)) {
            ThreadUtils.postOnUiThread(() -> {
                if (!mTab.isDestroyed()) {
                    mTab.loadUrl(new org.chromium.content_public.browser.LoadUrlParams(spec));
                }
            });
        }''')
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
        ('components/translate/core/browser/translate_prefs.cc', patch_no_translate),
        ('device/gamepad/android/java/src/org/chromium/device/gamepad/GamepadList.java', patch_gamepad)]),
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
