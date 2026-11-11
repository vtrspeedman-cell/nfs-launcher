package xyz.nfs.launcher;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.trusted.ScreenOrientation;
import androidx.browser.trusted.TrustedWebActivityDisplayMode;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * NFS Launcher para Android, app ÚNICO: esta tela fica dentro do próprio navegador do app (o "motor", Chromium
 * compilado para o NFS Launcher). Roda num processo separado (":nfs") para não pesar no processo do jogo.
 * - Tela inicial local (assets/nfs/home.html): abertura, CDs, START, Português/English,
 *   Configurações e a versão nova (baixada do GitHub, AppUpdate) e as texturas HD (Textures).
 * - START abre o site do jogo no motor do próprio app como Trusted Web Activity: tela cheia, sem barra nenhuma.
 * - Sem dicas, guias, bolha nem mapa no celular (o jogo foi corrigido, 11/11).
 */
public class MainActivity extends Activity {

    static final class Game {
        final String id, shortName, name, url, startUrl, disc; // startUrl: o START com o convite da equipe; em inglês, url
        final boolean textures; // textures: Texturas HD (os dois NFSU2: nfsu2.xyz e o Modded)
        Game(String id, String shortName, String name, String url, String startUrl, String disc, boolean textures) {
            this.id = id; this.shortName = shortName; this.name = name; this.url = url; this.startUrl = startUrl; this.disc = disc;
            this.textures = textures;
        }
        String host() { return Uri.parse(url).getHost(); }
    }
    // Catálogo: o mesmo do app de PC (src/main/config.js), exportado na montagem para assets/nfs/catalog.json.
    static Game[] GAMES = new Game[0];
    static String DEFAULT_GAME = "nfsu2";
    static Game gameOf(String id) {
        for (Game g : GAMES) if (g.id.equals(id)) return g;
        return GAMES[0];
    }
    static final String ASSETS = "nfs/"; // tudo do app fica em assets/nfs/, longe dos arquivos do navegador

    static String readAsset(Context c, String name) throws IOException {
        try (InputStream in = c.getAssets().open(ASSETS + name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void loadCatalog() {
        try {
            JSONObject o = new JSONObject(readAsset(this, "catalog.json"));
            DEFAULT_GAME = o.optString("defaultGame", "nfsu2");
            JSONArray a = o.getJSONArray("games");
            Game[] list = new Game[a.length()];
            for (int i = 0; i < a.length(); i++) {
                JSONObject g = a.getJSONObject(i);
                list[i] = new Game(g.getString("id"), g.getString("short"), g.getString("name"), g.getString("url"),
                        g.optString("startUrl", g.getString("url")), g.getString("disc"),
                        g.optBoolean("textures", "nfsu2".equals(g.getString("id"))));
            }
            if (list.length > 0) GAMES = list;
        } catch (Exception ignored) { }
        if (GAMES.length == 0) {
            GAMES = new Game[]{ new Game("nfsu2", "NFSU2", "Need for Speed: Underground 2", "https://nfsu2.xyz", "https://nfsu2.xyz/#crew=U2BR", "games/nfsu2.png", true) };
        }
    }
    static final String VERSION = "1.6.9"; // também dá o nome do APK (quick.sh/build.sh leem daqui)
    static final long LOW_DISK_BYTES = 3L * 1024 * 1024 * 1024; // o maior jogo baixa cerca de 3 GB
    // Tela de entrada do motor (o mesmo pacote deste app). Pelo nome exato: o motor não recebe links de fora.
    static final String MOTOR_ENTRY = "com.google.android.apps.chrome.IntentDispatcher";
    static final long UPDATE_EVERY_MS = 3600000; // de hora em hora, só com a tela inicial na frente
    static final long RETRY_MS = 5000;           // tela de erro: tenta de novo a cada 5 s
    static final int REQ_IMAGE = 41;
    static final int MAX_IMAGE_BYTES = 30 * 1024 * 1024; // imagem original até 30 MB (como no PC)

    private SharedPreferences prefs;
    private FrameLayout root;
    private WebView home;
    private boolean homeGone;          // a página da tela inicial foi fechada pelo Android e precisa ser refeita
    private String pendingGame = null; // START esperando a volta da tela de permissão
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean resumed;
    private boolean dnsFailed;         // nem o DNS seguro abriu o jogo
    private String error = null;       // tipo do erro mostrado (offline, server, crash, other)
    private String updateStatus = "";  // checking, none, error, new, downloading, ready
    private AppUpdate.Info updateInfo = null;
    private int updatePct = 0;
    private AtomicBoolean updateCancel = null;
    private long updateCheckedAt = 0;
    // Texturas: lista publicada, download em andamento (um por vez, numa fila) e o último erro.
    private Map<String, Textures.Offer> texOffer = null;
    private String texOfferStatus = "";  // loading, ok, error
    private final List<String> texQueue = new java.util.concurrent.CopyOnWriteArrayList<>(); // a tela lê de outra linha
    private String texJob = null;        // id do arquivo baixando (ex.: "texwizard-2x")
    private int texPct = 0;
    private AtomicBoolean texCancel = null;
    private String texError = "";
    private int customRev = 0;
    private String pickGame, pickKind; // imagem sendo escolhida na personalização

    private float dp(float v) { return v * getResources().getDisplayMetrics().density; }
    private String lang() { return prefs.getString("lang", "pt"); }
    private String tr(String pt, String en) { return "en".equals(lang()) ? en : pt; }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.parseColor("#0B0D17")));
        getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        prefs = getSharedPreferences("nfs", MODE_PRIVATE);
        migrate();
        loadCatalog();
        // Nova execução: "DNS normal só desta vez" acaba e o DNS seguro que já funcionou é tentado de novo.
        if (state == null && !getIntent().hasExtra("error")) prefs.edit().remove("dnsTry").remove("dnsQueue").commit();
        handleIntent(getIntent());
        // Uma vez ao abrir, fora da tela: guarda o save se ele mudou (só lê os arquivos do jogo).
        if (state == null) {
            Context app = getApplicationContext();
            new Thread(() -> { SaveCopy.run(app); ui.post(this::refreshHome); }).start();
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0B0D17"));
        home = newLocalView();
        root.addView(home, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        home.loadUrl("file:///android_asset/" + ASSETS + "home.html");
        setContentView(root);
        immersive();
    }

    /**
     * Uma vez por mudança de padrão (pedido do Bruno, 08/11): "Preparar o jogo ao carregar" ligada para todos, inclusive
     * quem tinha desmarcado; sem bolha desde 11/11.
     * As texturas que vinham no APK (até a 1.6.4 de teste) saem: agora são baixadas pelo app.
     */
    private void migrate() {
        if (prefs.getInt("prefsVersion", 0) >= 2) return;
        SharedPreferences.Editor e = prefs.edit().putBoolean("prepareGame", true);
        e.remove("overlayAsked").putInt("prefsVersion", 2).commit(); // commit: o motor lê este arquivo em outro processo
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** O jogo pediu para voltar: com erro (o motor manda o código) ou "Reiniciar o jogo". */
    private void handleIntent(Intent i) {
        if (i == null) return;
        if (AppUpdate.ACTION_INSTALLED.equals(i.getAction())) { installResult(i); i.setAction(null); return; }
        if (i.hasExtra("error")) {
            int code = i.getIntExtra("error", 0);
            String kind = errorKind(code);
            i.removeExtra("error");
            CrashLog.gameError(this, code, prefs.getString("game", DEFAULT_GAME));
            error = kind;
            // Falhou com DNS seguro: tenta o próximo; se nenhum abrir, volta ao DNS normal e pede para conferir a rede.
            String active = offersDns(kind) ? activeDns() : "";
            if (!active.isEmpty()) {
                String next = prefs.getString("dnsTry", "").isEmpty()
                        ? (DNS_FIRST.equals(active) ? DNS_SECOND : DNS_FIRST) : prefs.getString("dnsQueue", "");
                if (next.isEmpty()) {
                    useDns("none", "");
                    dnsFailed = true;
                } else {
                    useDns(next, "");
                    error = null;
                    pendingGame = prefs.getString("game", DEFAULT_GAME);
                }
            }
        }
        if (i.getBooleanExtra("restart", false)) {
            i.removeExtra("restart");
            pendingGame = prefs.getString("game", DEFAULT_GAME);
        }
    }

    // ───────────────────────── DNS seguro ─────────────────────────
    // Como no PC: por botão na tela de erro, Cloudflare e depois Google. O motor aplica ao abrir (lê "dnsTry" ou o arquivo
    // nfs-dns) e grava o arquivo quando o jogo abre, e aí ele fica ligado nas próximas vezes. "none" = DNS normal só desta vez.
    static final String DNS_FIRST = "cloudflare";
    static final String DNS_SECOND = "google";
    static boolean offersDns(String kind) { return "offline".equals(kind) || "other".equals(kind); }
    private String savedDns() {
        try {
            String s = new String(Files.readAllBytes(new File(getFilesDir(), "nfs-dns").toPath()), StandardCharsets.UTF_8).trim();
            return DNS_FIRST.equals(s) || DNS_SECOND.equals(s) ? s : "";
        } catch (IOException e) { return ""; }
    }
    private String activeDns() {
        String t = prefs.getString("dnsTry", "");
        if ("none".equals(t)) return "";
        return t.isEmpty() ? savedDns() : t;
    }
    private void useDns(String id, String queue) {
        prefs.edit().putString("dnsTry", id).putString("dnsQueue", queue).commit(); // commit: o motor lê em outro processo
    }
    private void trySecureDns() {
        ui.removeCallbacks(retryTick);
        error = null;
        dnsFailed = false;
        useDns(DNS_FIRST, DNS_SECOND);
        refreshHome();
        launchGame(prefs.getString("game", DEFAULT_GAME));
    }

    // Mesma classificação do PC (src/main/connError.js): uma frase simples, nunca o código técnico.
    static String errorKind(int code) {
        if (code == -1) return "crash";
        if (code >= 500) return "server";
        return code == -21 || code == -105 || code == -106 || code == -109 || code == -137 ? "offline" : "other";
    }

    /**
     * Um jogo por vez: fecha qualquer jogo aberto. Tira da lista de apps abertos as outras telas do app (menos a
     * {@code keepTaskId}) e encerra os processos do navegador (página, GPU), deixando só o desta tela (":nfs").
     * @return se havia algum processo do navegador rodando.
     */
    static boolean closeGame(Context c, int keepTaskId) {
        ActivityManager am = c.getSystemService(ActivityManager.class);
        if (am == null) return false;
        try {
            for (ActivityManager.AppTask t : am.getAppTasks()) {
                if (t.getTaskInfo().taskId != keepTaskId) t.finishAndRemoveTask();
            }
        } catch (Exception ignored) { }
        boolean any = false;
        List<ActivityManager.RunningAppProcessInfo> ps = am.getRunningAppProcesses();
        if (ps != null) {
            for (ActivityManager.RunningAppProcessInfo p : ps) {
                if (p.pid != Process.myPid() && !p.processName.endsWith(":nfs")) {
                    Process.killProcess(p.pid);
                    any = true;
                }
            }
        }
        return any;
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        immersive();
        // A tela inicial está na frente: nenhum jogo pode ficar rodando por trás (menos o que acabou de ser aberto,
        // enquanto a tela dele ainda está entrando).
        if (SystemClock.uptimeMillis() - launchedAt > 5000) closeGame(this, getTaskId());
        home.onResume();
        home.evaluateJavascript("window.audioOn && audioOn(true); window.showHome && showHome()", null);
        if (pendingGame != null) { String g = pendingGame; pendingGame = null; launchGame(g); }
        refreshHome();
        // Quedas que o Android anotou enquanto o jogo rodava (CrashLog): lidas fora da tela, sem atrasar a volta.
        Context app = getApplicationContext();
        String game = prefs.getString("game", DEFAULT_GAME);
        new Thread(() -> { CrashLog.readExits(app, prefs, game); ui.post(this::refreshHome); }).start();
        // Versão nova: ao abrir, ao voltar à tela inicial e de hora em hora com ela na frente (durante o jogo, nada).
        if (SystemClock.uptimeMillis() - updateCheckedAt > 60000 || updateCheckedAt == 0) checkUpdate();
        ui.removeCallbacks(hourlyCheck);
        ui.postDelayed(hourlyCheck, UPDATE_EVERY_MS);
        scheduleRetry();
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        ui.removeCallbacks(hourlyCheck);
        ui.removeCallbacks(retryTick);
        // Saiu da tela inicial: sem áudio local e sem a página rodando por baixo do jogo.
        home.evaluateJavascript("window.audioOn && audioOn(false)", null);
        home.onPause();
    }

    // Com o jogo na frente, a tela inicial não roda nada: relógios do JavaScript parados (só existe esta página no
    // processo ":nfs") e, pela regra de newLocalView, o Android pode liberar a memória dela antes da do jogo.
    @Override
    protected void onStart() {
        super.onStart();
        if (home != null) home.resumeTimers();
        if (homeGone) rebuildHome();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (home != null) home.pauseTimers();
    }

    private void refreshHome() { if (home != null) home.evaluateJavascript("window.refresh && refresh()", null); }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }

    // ───────────────────────── Versão nova ─────────────────────────
    private final Runnable hourlyCheck = new Runnable() {
        @Override public void run() {
            checkUpdate();
            ui.postDelayed(this, UPDATE_EVERY_MS);
        }
    };

    // Compara versões número a número ("1.10.0" é maior que "1.9.9").
    static int compareVersions(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < 3; i++) {
            int d = Integer.parseInt(x[i]) - Integer.parseInt(y[i]);
            if (d != 0) return d;
        }
        return 0;
    }

    // Versão nova pelo GitHub (AppUpdate): verifica ao abrir, ao voltar à tela inicial e de hora em hora com ela na frente.
    // No Wi-Fi baixa sozinho; nos dados móveis, só pelo botão. Instalar: só pelo botão "Atualizar agora".
    private void checkUpdate() {
        if ("checking".equals(updateStatus) || "downloading".equals(updateStatus)) return;
        updateCheckedAt = SystemClock.uptimeMillis();
        boolean had = updateInfo != null;
        if (!had) updateStatus = "checking"; // o botão não some enquanto verifica de novo
        refreshHome();
        Context app = getApplicationContext();
        new Thread(() -> {
            AppUpdate.Info u;
            boolean failed = false;
            try { u = AppUpdate.check(VERSION); } catch (Exception e) { u = null; failed = true; }
            AppUpdate.Info got = failed ? updateInfo : u;
            if (!failed) AppUpdate.clean(app, got);
            boolean ready = AppUpdate.ready(app, got), fail = failed;
            ui.post(() -> {
                updateInfo = got;
                updateStatus = got == null ? (fail ? "error" : "none") : ready ? "ready" : "new";
                refreshHome();
                if ("new".equals(updateStatus) && resumed && AppUpdate.freeNetwork(this)) downloadUpdate();
            });
        }).start();
    }

    private void downloadUpdate() {
        AppUpdate.Info u = updateInfo;
        if (u == null || !"new".equals(updateStatus)) return;
        updateStatus = "downloading";
        updatePct = 0;
        AtomicBoolean cancel = new AtomicBoolean(false);
        updateCancel = cancel;
        refreshHome();
        Context app = getApplicationContext();
        new Thread(() -> {
            boolean ok;
            try {
                Downloads.fetch(u.url, AppUpdate.fileOf(app, u), u.size, u.sha256, cancel,
                        (d, t) -> ui.post(() -> { updatePct = (int) (d * 100 / Math.max(1, t)); refreshHome(); }));
                ok = true;
            } catch (Exception e) { ok = false; }
            boolean done = ok;
            ui.post(() -> {
                if (updateCancel == cancel) updateCancel = null;
                if (updateInfo != u) return;
                updateStatus = done ? "ready" : "new";
                if (!done && !cancel.get()) toast(tr("Não deu para baixar a versão nova agora. Tente de novo mais tarde.", "Could not download the new version now. Try again later."));
                refreshHome();
            });
        }).start();
    }

    /** Para o download (continua depois de onde parou): o jogo não divide a internet com ele. */
    private void pauseDownloads() {
        if (updateCancel != null) updateCancel.set(true);
        texQueue.clear();
        if (texCancel != null) texCancel.set(true);
    }

    private void installUpdate() {
        AppUpdate.Info u = updateInfo;
        if (u == null || !"ready".equals(updateStatus)) return;
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(tr("Atualizar para a " + u.version, "Update to " + u.version))
                .setMessage(tr("O app fecha e a versão nova entra por cima. Seus saves, o login e as texturas ficam. Depois, é só abrir o app de novo.",
                        "The app closes and the new version installs over it. Your saves, login and textures stay. Then just open the app again."))
                .setPositiveButton(tr("Atualizar", "Update"), (d, w) -> {
                    Activity a = this;
                    new Thread(() -> {
                        try { AppUpdate.install(a, u); }
                        catch (Exception e) { ui.post(() -> toast(tr("Não deu para instalar. Tente de novo.", "Could not install. Try again."))); }
                    }).start();
                })
                .setNegativeButton(tr("Agora não", "Not now"), null)
                .show();
    }

    /** Resposta do instalador do Android: pede a confirmação dele, ou avisa se não deu. */
    @SuppressWarnings("deprecation") // getParcelableExtra(nome, classe) só existe no Android 13+
    private void installResult(Intent i) {
        int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                try { startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; } catch (Exception ignored) { }
            }
        }
        if (status == PackageInstaller.STATUS_SUCCESS) return;
        if (status != PackageInstaller.STATUS_FAILURE_ABORTED) {
            toast(tr("A versão nova não foi instalada. Tente de novo; se o Android pedir, permita instalar apps do NFS Launcher.",
                    "The new version was not installed. Try again; if Android asks, allow installing apps from NFS Launcher."));
        }
    }

    private void openUpdates() {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(Downloads.RELEASES_URL)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            toast(tr("Nenhum navegador encontrado neste celular.", "No browser found on this phone."));
        }
    }

    // ───────────────────────── Texturas HD (Textures) ─────────────────────────
    private void loadTexOffer() {
        if ("loading".equals(texOfferStatus)) return;
        texOfferStatus = "loading";
        new Thread(() -> {
            Map<String, Textures.Offer> o = null;
            try { o = Textures.parseOffer(Downloads.text(Textures.MANIFEST_URL, 64 * 1024)); } catch (Exception ignored) { }
            Map<String, Textures.Offer> got = o;
            ui.post(() -> { if (got != null) texOffer = got; texOfferStatus = got != null ? "ok" : "error"; refreshHome(); });
        }).start();
    }

    /** Estado de um arquivo: ok (igual ao publicado), update (publicado outro), have (baixado, sem lista), get, none. */
    private String texFileState(String id) {
        File f = Textures.fileOf(this, id);
        Textures.Offer o = texOffer == null ? null : texOffer.get(id);
        if (f.isFile()) {
            if (o == null) return "have";
            return o.sha256.equals(Downloads.savedSha(f)) ? "ok" : "update";
        }
        return o == null ? "none" : "get";
    }

    /** Baixa o mod no tamanho escolhido (e o mapa do site antes, se faltar ou mudou). */
    private void texDownload(String mod) {
        if (!Textures.knownMod(mod) || texOffer == null) return;
        String scale = Textures.scale(prefs);
        String site = texFileState(Textures.SITE);
        if ("get".equals(site) || "update".equals(site)) queueTex(Textures.SITE);
        queueTex(Textures.idOf(mod, scale));
        nextTex();
    }
    private void queueTex(String id) { if (!texQueue.contains(id) && !id.equals(texJob)) texQueue.add(id); }

    private void nextTex() {
        if (texJob != null) return;
        while (!texQueue.isEmpty()) {
            String id = texQueue.remove(0);
            Textures.Offer o = texOffer == null ? null : texOffer.get(id);
            if (o == null) continue;
            texJob = id;
            texPct = 0;
            texError = "";
            AtomicBoolean cancel = new AtomicBoolean(false);
            texCancel = cancel;
            refreshHome();
            Context app = getApplicationContext();
            new Thread(() -> {
                String err = "";
                try {
                    Downloads.fetch(o.url, Textures.fileOf(app, id), o.size, o.sha256, cancel,
                            (d, t) -> ui.post(() -> { texPct = (int) (d * 100 / Math.max(1, t)); refreshHome(); }));
                    Textures.build(app);
                } catch (Downloads.Failed f) { err = f.code; }
                catch (Exception e) { err = "net"; }
                String e2 = err;
                ui.post(() -> {
                    texJob = null;
                    texCancel = null;
                    if (!e2.isEmpty() && !"cancel".equals(e2)) { texError = e2; texQueue.clear(); }
                    refreshHome();
                    nextTex();
                });
            }).start();
            return;
        }
        refreshHome();
    }

    /** Tira o mod (os dois tamanhos); sem nenhum mod, o mapa do site também sai. */
    private void texRemove(String mod) {
        if (!Textures.knownMod(mod)) return;
        for (String s : Textures.SCALES) {
            String id = Textures.idOf(mod, s);
            texQueue.remove(id);
            if (id.equals(texJob) && texCancel != null) texCancel.set(true);
            Downloads.remove(Textures.fileOf(this, id));
        }
        boolean any = false;
        for (String m : Textures.MODS) for (String s : Textures.SCALES) any |= Textures.fileOf(this, Textures.idOf(m, s)).isFile();
        if (!any) Downloads.remove(Textures.fileOf(this, Textures.SITE));
        rebuildTextures();
    }

    /** Trocar o tamanho: os mods baixados no outro tamanho saem e são baixados de novo neste. */
    private void texScale(String scale) {
        if (!"1x".equals(scale) && !"2x".equals(scale) || scale.equals(Textures.scale(prefs))) return;
        String old = Textures.scale(prefs);
        prefs.edit().putString("texScale", scale).commit();
        if (texCancel != null) texCancel.set(true);
        texQueue.clear();
        List<String> again = new ArrayList<>();
        for (String m : Textures.MODS) {
            File f = Textures.fileOf(this, Textures.idOf(m, old));
            if (f.isFile() || Downloads.partOf(f).isFile()) { again.add(m); Downloads.remove(f); }
        }
        rebuildTextures();
        if (texOffer != null) for (String m : again) if (!Textures.fileOf(this, Textures.idOf(m, scale)).isFile()) texDownload(m);
    }

    private void texChoose(String part, String value) {
        boolean okPart = false;
        for (Textures.Part p : Textures.PARTS) okPart |= p.id.equals(part);
        if (!okPart || !(Textures.ORIGINAL.equals(value) || Textures.knownMod(value))) return;
        JSONObject c = Textures.choice(prefs);
        try { c.put(part, value); } catch (Exception ignored) { }
        prefs.edit().putString("texChoice", c.toString()).commit();
        rebuildTextures();
    }

    private void rebuildTextures() {
        refreshHome();
        Context app = getApplicationContext();
        new Thread(() -> { Textures.build(app); ui.post(this::refreshHome); }).start();
    }

    private JSONObject texState() throws Exception {
        JSONObject t = new JSONObject();
        String scale = Textures.scale(prefs);
        t.put("scale", scale);
        t.put("offer", texOfferStatus);
        t.put("job", texJob == null ? JSONObject.NULL : texJob);
        t.put("pct", texPct);
        t.put("queued", texQueue.size());
        t.put("error", texError);
        t.put("ready", Textures.ready(this));
        JSONArray mods = new JSONArray();
        for (int i = 0; i < Textures.MODS.length; i++) {
            String m = Textures.MODS[i], id = Textures.idOf(m, scale);
            JSONObject j = new JSONObject();
            j.put("id", m);
            j.put("name", Textures.MOD_NAMES[i]);
            j.put("state", texFileState(id));
            Textures.Offer o = texOffer == null ? null : texOffer.get(id);
            j.put("size", o == null ? 0 : o.size);
            j.put("busy", id.equals(texJob) || texQueue.contains(id));
            mods.put(j);
        }
        t.put("mods", mods);
        Textures.Offer so = texOffer == null ? null : texOffer.get(Textures.SITE);
        t.put("siteSize", so == null || Textures.fileOf(this, Textures.SITE).isFile() ? 0 : so.size);
        Map<String, Textures.Index> src = Textures.sources(this, scale);
        Map<String, List<String>> avail = Textures.partsAvailable(src);
        Map<String, String> eff = Textures.effective(Textures.choice(prefs), avail);
        JSONArray parts = new JSONArray();
        for (Textures.Part p : Textures.PARTS) {
            if (avail.get(p.id).isEmpty()) continue;
            JSONObject j = new JSONObject();
            j.put("id", p.id);
            j.put("name", "en".equals(lang()) ? p.en : p.pt);
            JSONArray opts = new JSONArray();
            for (String m : avail.get(p.id)) opts.put(m);
            j.put("options", opts);
            j.put("value", eff.get(p.id));
            parts.put(j);
        }
        t.put("parts", parts);
        return t;
    }

    // Abre Download/NFS Launcher no app de arquivos; quem não abrir pasta direto cai na lista de downloads.
    private void openSaves() {
        Uri dir = Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload%2FNFS%20Launcher");
        try {
            startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(dir, "vnd.android.document/directory")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION));
        } catch (ActivityNotFoundException | SecurityException e) {
            try {
                startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException e2) {
                toast(tr("Abra o app de arquivos: Download/NFS Launcher.", "Open the files app: Download/NFS Launcher."));
            }
        }
    }

    // ───────────────────────── Erro ao abrir o jogo ─────────────────────────
    // Quem falhou volta para cá; a cada 5 s vê se o site responde e, respondendo, abre o jogo sozinho.
    private final Runnable retryTick = () -> {
        String url = gameOf(prefs.getString("game", DEFAULT_GAME)).url;
        new Thread(() -> {
            boolean ok = false;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(4000);
                c.setReadTimeout(4000);
                c.setRequestMethod("HEAD");
                ok = c.getResponseCode() < 500;
                c.disconnect();
            } catch (Exception ignored) { }
            boolean back = ok;
            ui.post(() -> {
                if (error == null || !resumed) return;
                if (back) retryNow(); else scheduleRetry();
            });
        }).start();
    };
    private void scheduleRetry() {
        ui.removeCallbacks(retryTick);
        if (error != null && !"crash".equals(error) && resumed) ui.postDelayed(retryTick, RETRY_MS);
    }
    private void retryNow() {
        error = null;
        ui.removeCallbacks(retryTick);
        refreshHome();
        launchGame(prefs.getString("game", DEFAULT_GAME));
    }

    // ───────────────────────── Personalização ─────────────────────────
    // Fundo da tela inicial e capa (CD) de cada jogo. A imagem escolhida é REFEITA pelo app (como no PC) e o motor
    // lê os mesmos arquivos para a tela de carregar.
    private File customFile(String game, String kind) {
        return new File(new File(getFilesDir(), "custom"), game + "-" + kind + ("bg".equals(kind) ? ".jpg" : ".png"));
    }
    private boolean validCustom(String game, String kind) {
        if (!"bg".equals(kind) && !"disc".equals(kind)) return false;
        for (Game g : GAMES) if (g.id.equals(game)) return true;
        return false;
    }
    private void pickImage(String game, String kind) {
        pickGame = game; pickKind = kind;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*")
                .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/png", "image/jpeg"});
        try { startActivityForResult(i, REQ_IMAGE); }
        catch (ActivityNotFoundException e) { toast(tr("Nenhum app de arquivos encontrado.", "No files app found.")); }
    }
    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_IMAGE || result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        String game = pickGame, kind = pickKind;
        new Thread(() -> {
            boolean ok = saveImage(uri, game, kind);
            ui.post(() -> {
                if (ok) customRev++;
                toast(ok ? tr("Imagem salva.", "Image saved.") : tr("Não deu para usar essa imagem. Use PNG ou JPG de até 30 MB.", "Could not use this image. Use a PNG or JPG up to 30 MB."));
                refreshHome();
            });
        }).start();
    }
    // Fundo: cabe em 1920×1080 (sem aumentar). Capa: quadrado do meio em 320×320.
    private boolean saveImage(Uri uri, String game, String kind) {
        try {
            byte[] raw;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                for (int n; (n = in.read(buf)) > 0; ) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_IMAGE_BYTES) return false;
                }
                raw = out.toByteArray();
            }
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(raw, 0, raw.length, o);
            if (o.outWidth <= 0 || o.outHeight <= 0) return false;
            boolean bg = "bg".equals(kind);
            int maxW = bg ? 1920 : 320, maxH = bg ? 1080 : 320;
            o.inSampleSize = 1;
            while (o.outWidth / (o.inSampleSize * 2) >= maxW && o.outHeight / (o.inSampleSize * 2) >= maxH) o.inSampleSize *= 2;
            o.inJustDecodeBounds = false;
            Bitmap b = BitmapFactory.decodeByteArray(raw, 0, raw.length, o);
            if (b == null) return false;
            Bitmap done;
            if (bg) {
                float s = Math.min(1f, Math.min((float) maxW / b.getWidth(), (float) maxH / b.getHeight()));
                done = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(b.getWidth() * s)), Math.max(1, Math.round(b.getHeight() * s)), true);
            } else {
                int side = Math.min(b.getWidth(), b.getHeight());
                Bitmap sq = Bitmap.createBitmap(b, (b.getWidth() - side) / 2, (b.getHeight() - side) / 2, side, side);
                done = Bitmap.createScaledBitmap(sq, 320, 320, true);
            }
            File f = customFile(game, kind);
            File dir = f.getParentFile();
            if (dir != null && !dir.isDirectory() && !dir.mkdirs()) return false;
            File tmp = new File(f.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                if (!done.compress(bg ? Bitmap.CompressFormat.JPEG : Bitmap.CompressFormat.PNG, 85, out)) return false;
            }
            return tmp.renameTo(f);
        } catch (Exception | OutOfMemoryError e) {
            return false;
        }
    }

    private void immersive() {
        getWindow().setDecorFitsSystemWindows(false);
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) {
            c.hide(WindowInsets.Type.systemBars());
            c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        home.evaluateJavascript("window.goBack ? goBack() : 'exit'", v -> { if ("\"exit\"".equals(v)) finish(); });
    }

    // ───────────────────────── Tela inicial (página local) ─────────────────────────
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private WebView newLocalView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // idioma e letra das dicas (como no PC)
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false); // som da abertura, como no PC
        w.addJavascriptInterface(new HomeBridge(), "launcher");
        w.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
            // A página da tela inicial foi fechada (o Android liberou memória para o jogo, ou ela caiu). Sem isto o
            // Android fecharia o app inteiro. Fora da tela ela fica vazia e só é refeita quando o jogador voltar.
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                if (v != home) return true; // página velha, já trocada
                if (d.didCrash()) CrashLog.add(getApplicationContext(), System.currentTimeMillis(), "tela", "crash", 0, "");
                homeGone = true;
                if (resumed) rebuildHome(); else blankHome();
                return true;
            }
        });
        // Fora da tela, a página da tela inicial perde a prioridade: com pouca memória, o Android fecha ela antes do jogo.
        w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
        w.setWebChromeClient(new WebChromeClient());
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        w.setBackgroundColor(Color.parseColor("#0B0D17"));
        return w;
    }

    /** Troca a página da tela inicial por uma nova, vazia (sem página carregada não há processo gastando memória). */
    private void swapHome() {
        WebView old = home;
        home = newLocalView();
        root.addView(home, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (old != null) { root.removeView(old); old.destroy(); }
    }
    private void blankHome() { swapHome(); home.onPause(); home.pauseTimers(); }
    private void rebuildHome() {
        homeGone = false;
        if (home == null || home.getUrl() != null) swapHome();
        home.resumeTimers();
        home.loadUrl("file:///android_asset/" + ASSETS + "home.html");
    }

    private JSONObject state() {
        JSONObject o = new JSONObject();
        try {
            o.put("lang", lang());
            o.put("game", prefs.getString("game", DEFAULT_GAME));
            o.put("sounds", true); // sempre ligados, como no PC, mesmo para quem tinha desligado
            o.put("prepareGame", prefs.getBoolean("prepareGame", true));
            o.put("hdTextures", prefs.getBoolean("hdTextures", true));
            o.put("tex", texState());
            o.put("crashes", new JSONArray(CrashLog.lines(this, "en".equals(lang()))));
            if (error != null) {
                o.put("error", error);
                o.put("dnsFailed", dnsFailed);
                o.put("dnsOffer", offersDns(error) && !dnsFailed && activeDns().isEmpty());
            }
            JSONArray arr = new JSONArray();
            JSONObject custom = new JSONObject();
            for (Game g : GAMES) {
                JSONObject j = new JSONObject();
                j.put("id", g.id); j.put("short", g.shortName); j.put("name", g.name);
                j.put("disc", g.disc); j.put("textures", g.textures);
                arr.put(j);
                JSONObject c = new JSONObject();
                c.put("bg", customFile(g.id, "bg").exists());
                c.put("disc", customFile(g.id, "disc").exists());
                custom.put(g.id, c);
            }
            o.put("games", arr);
            o.put("custom", custom);
            o.put("customRev", customRev);
            JSONObject u = new JSONObject();
            u.put("status", updateStatus);
            u.put("version", updateInfo == null ? "" : updateInfo.version);
            u.put("size", updateInfo == null ? 0 : updateInfo.size);
            u.put("pct", updatePct);
            u.put("notes", updateInfo == null ? "" : tr(updateInfo.notesPt, updateInfo.notesEn));
            o.put("update", u);
            o.put("version", VERSION);
            long free = getFilesDir().getUsableSpace();
            if (free > 0 && free < LOW_DISK_BYTES) o.put("lowDiskGb", Math.round(free / 107374182.4) / 10.0);
            o.put("lastCopy", SaveCopy.lastCopy(this));
        } catch (Exception ignored) { }
        return o;
    }

    final class HomeBridge {
        @JavascriptInterface public String state() { return MainActivity.this.state().toString(); }
        @JavascriptInterface public void start(String id) { runOnUiThread(() -> startGame(id)); }
        @JavascriptInterface public void setLang(String l) {
            if (!"pt".equals(l) && !"en".equals(l)) return;
            prefs.edit().putString("lang", l).apply();
            runOnUiThread(() -> home.evaluateJavascript("window.refresh && refresh()", null));
        }
        @JavascriptInterface public void setOption(String key, boolean on) {
            if (!"prepareGame".equals(key) && !"hdTextures".equals(key)) return;
            prefs.edit().putBoolean(key, on).commit(); // commit: o processo do jogo lê este arquivo ao abrir
            runOnUiThread(MainActivity.this::refreshHome);
        }
        @JavascriptInterface public void checkUpdate() { runOnUiThread(MainActivity.this::checkUpdate); }
        @JavascriptInterface public void openUpdates() { runOnUiThread(MainActivity.this::openUpdates); }
        @JavascriptInterface public void downloadUpdate() { runOnUiThread(MainActivity.this::downloadUpdate); }
        @JavascriptInterface public void installUpdate() { runOnUiThread(MainActivity.this::installUpdate); }
        @JavascriptInterface public void texLoad() { runOnUiThread(MainActivity.this::loadTexOffer); }
        @JavascriptInterface public void texDownload(String mod) { runOnUiThread(() -> MainActivity.this.texDownload(mod)); }
        @JavascriptInterface public void texRemove(String mod) { runOnUiThread(() -> MainActivity.this.texRemove(mod)); }
        @JavascriptInterface public void texCancel() {
            runOnUiThread(() -> { texQueue.clear(); if (texCancel != null) texCancel.set(true); refreshHome(); });
        }
        @JavascriptInterface public void texScale(String s) { runOnUiThread(() -> MainActivity.this.texScale(s)); }
        @JavascriptInterface public void texChoose(String part, String value) { runOnUiThread(() -> MainActivity.this.texChoose(part, value)); }
        @JavascriptInterface public void copyCrashes() {
            runOnUiThread(() -> {
                List<String> l = CrashLog.lines(MainActivity.this, "en".equals(lang()));
                android.content.ClipboardManager cm = getSystemService(android.content.ClipboardManager.class);
                if (cm == null || l.isEmpty()) return;
                String head = "NFS Launcher " + VERSION + " · Android " + Build.VERSION.RELEASE + " · " + Build.MANUFACTURER + " " + Build.MODEL;
                cm.setPrimaryClip(android.content.ClipData.newPlainText("NFS Launcher", head + "\n" + String.join("\n", l)));
                toast(tr("Copiado: cole no Discord para quem for ajudar.", "Copied: paste it on Discord for whoever is helping."));
            });
        }
        @JavascriptInterface public void openSaves() { runOnUiThread(MainActivity.this::openSaves); }
        @JavascriptInterface public void openAppSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                } catch (ActivityNotFoundException ignored) { }
            });
        }
        @JavascriptInterface public void retry() { runOnUiThread(MainActivity.this::retryNow); }
        @JavascriptInterface public void trySecureDns() { runOnUiThread(MainActivity.this::trySecureDns); }
        @JavascriptInterface public void clearError() {
            runOnUiThread(() -> { error = null; dnsFailed = false; ui.removeCallbacks(retryTick); refreshHome(); });
        }
        @JavascriptInterface public void pickImage(String game, String kind) {
            if (validCustom(game, kind)) runOnUiThread(() -> MainActivity.this.pickImage(game, kind));
        }
        @JavascriptInterface public void resetImage(String game, String kind) {
            if (!validCustom(game, kind)) return;
            runOnUiThread(() -> { if (customFile(game, kind).delete()) customRev++; refreshHome(); });
        }
        @JavascriptInterface public String customImage(String game, String kind) {
            if (!validCustom(game, kind)) return "";
            try {
                byte[] b = Files.readAllBytes(customFile(game, kind).toPath());
                return "data:image/" + ("bg".equals(kind) ? "jpeg" : "png") + ";base64," + Base64.encodeToString(b, Base64.NO_WRAP);
            } catch (IOException e) { return ""; }
        }
        @JavascriptInterface public void quit() {
            runOnUiThread(() -> { closeGame(MainActivity.this, getTaskId()); finishAndRemoveTask(); });
        }
    }

    private void toast(String t) { Toast.makeText(this, t, Toast.LENGTH_SHORT).show(); }

    // ───────────────────────── START ─────────────────────────
    private void startGame(String id) {
        Game g = gameOf(id);
        prefs.edit().putString("game", g.id).apply(); // o próximo START já vem com este jogo marcado
        if (prefs.getBoolean("remindOff", false)) { launchGame(g.id); return; }
        // Lembrete (pedido do Bruno, 08/11): modo jogo do celular e o jogo baixado por completo antes de carregar.
        String download = g.textures // os dois NFSU2 têm a mesma página
                ? tr("Na primeira vez, baixe o jogo inteiro antes de carregar: no site, na aba Game, toque em \"Game data on this device\" e espere terminar. Assim ele não fica baixando no meio da corrida.",
                     "The first time, download the whole game before loading: on the site, in the Game tab, tap \"Game data on this device\" and wait for it to finish. That way it does not download in the middle of a race.")
                : tr("Na primeira vez, deixe o jogo baixar por completo antes de começar a jogar.",
                     "The first time, let the game download completely before you start playing.");
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(tr("Antes de jogar", "Before you play"))
                .setMessage(tr("• Coloque o NFS Launcher no modo jogo do seu celular (Game Turbo, Game Booster ou Game Space): o jogo roda melhor.\n\n• ",
                               "• Add NFS Launcher to your phone’s game mode (Game Turbo, Game Booster or Game Space): the game runs better.\n\n• ") + download)
                .setPositiveButton(tr("Jogar", "Play"), (d, w) -> launchGame(g.id))
                .setNeutralButton(tr("Não lembrar mais", "Don’t remind me"), (d, w) -> {
                    prefs.edit().putBoolean("remindOff", true).apply();
                    launchGame(g.id);
                })
                .show();
    }

    private void launchGame(String id) {
        Game g = gameOf(id);
        // A tela de carregar do motor lê estes valores em outro processo: precisam estar no arquivo antes de abrir.
        prefs.edit().putString("game", g.id).putString("gameName", g.name).commit();
        home.evaluateJavascript("window.showLoading && showLoading('" + g.id + "')", null);
        // Só um jogo por vez: o anterior é encerrado por completo antes (e o motor espera ele sair).
        boolean wasOpen = closeGame(this, getTaskId());
        pauseDownloads(); // durante o jogo, nada baixa (continua depois de onde parou)
        root.postDelayed(() -> {
            // Texturas HD (os dois NFSU2): com o jogo fechado, monta o pacote com a escolha atual (só se mudou) e liga (ou
            // desfaz) o mapa detalhado no settings.ini de cada um, por onde elas entram. O motor abre o pacote ao começar
            // (patch 0005). Antes de abrir qualquer jogo, as pastas novas do navegador ficam com o jogo anterior
            // (SaveCopy.launched): é assim que o app sabe qual pasta é de qual NFSU2.
            Context app = getApplicationContext();
            boolean want = prefs.getBoolean("hdTextures", true);
            new Thread(() -> {
                if (g.textures) {
                    if (want) Textures.build(app);
                    GameSettings.run(app, want && Textures.ready(app));
                }
                SaveCopy.launched(app, g.id);
                ui.post(() -> launchInMotor(g));
            }).start();
        }, wasOpen ? 500 : 0);
    }

    /**
     * Abre o site como Trusted Web Activity no motor deste mesmo app (sem barra nenhuma, tela cheia imersiva).
     * O motor confia neste app (mesmo pacote e mesma assinatura) no lugar do arquivo de autorização do site.
     */
    private CustomTabsServiceConnection motorConn;
    private long launchedAt = -10000;
    /** O convite da equipe aparece no máximo 2 vezes (pedido do Bruno, 10/11), como no PC (config.CREW_MAX). */
    private static final int CREW_MAX = 2;
    private String startUrlOf(Game g) {
        int invites = prefs.getInt("crewInvites", 0);
        if ("en".equals(lang()) || g.startUrl.equals(g.url) || invites >= CREW_MAX) return g.url;
        prefs.edit().putInt("crewInvites", invites + 1).apply();
        return g.startUrl;
    }
    private void launchInMotor(Game g) {
        launchedAt = SystemClock.uptimeMillis();
        final String startUrl = startUrlOf(g);
        if (motorConn != null) { try { unbindService(motorConn); } catch (Exception ignored) { } motorConn = null; }
        motorConn = new CustomTabsServiceConnection() {
            @Override
            public void onCustomTabsServiceConnected(@NonNull ComponentName name, @NonNull CustomTabsClient client) {
                client.warmup(0);
                CustomTabsSession session = client.newSession(null);
                if (session == null) { motorFailed(); return; }
                Intent twa = new TrustedWebActivityIntentBuilder(Uri.parse(startUrl))
                        .setScreenOrientation(ScreenOrientation.LANDSCAPE) // jogos de corrida: deitado
                        .setDisplayMode(new TrustedWebActivityDisplayMode.ImmersiveMode(false,
                                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES))
                        .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder()
                                .setToolbarColor(Color.parseColor("#0B0D17"))
                                .setNavigationBarColor(Color.BLACK).build())
                        .build(session)
                        .getIntent();
                twa.setComponent(new ComponentName(getPackageName(), MOTOR_ENTRY));
                try { startActivity(twa); } catch (ActivityNotFoundException e) { motorFailed(); }
            }
            @Override public void onServiceDisconnected(ComponentName name) { }
        };
        if (!CustomTabsClient.bindCustomTabsService(this, getPackageName(), motorConn)) { motorConn = null; motorFailed(); }
    }

    private void motorFailed() {
        home.evaluateJavascript("window.showHome && showHome()", null);
        toast(tr("Não consegui abrir o jogo. Feche o app e tente de novo.", "Could not open the game. Close the app and try again."));
    }


    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (motorConn != null) { try { unbindService(motorConn); } catch (Exception ignored) { } motorConn = null; }
        if (home != null) home.destroy();
        super.onDestroy();
    }
}
