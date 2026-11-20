package xyz.nfs.launcher;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Cópia do save do NFSU2 (a mesma do PC, src/main/saveCopy.js): uma vez ao abrir o app, só se o save mudou, sem internet e
 * sem script no jogo. Só LÊ os arquivos do jogo e nunca coloca nada de volta: restaurar é sempre pelo botão do próprio jogo,
 * a pedido da pessoa, porque a cópia pode estar desatualizada. O zip vai para Download/NFS Launcher.
 */
final class SaveCopy {
    static final int PROFILE_SIZE = 54966;
    private static final int NAME_AT = 36 + 53761;
    static final int GARAGE_SIZE = 10202;
    private static final int KEEP = 2; // pedido do Bruno: as 2 últimas versões
    private static final String FOLDER = "Download/NFS Launcher/";

    private static final class Found {
        final File file; final byte[] data;
        Found(File file, byte[] data) { this.file = file; this.data = data; }
    }

    private SaveCopy() { }

    // O NFSU2 continua com o arquivo de antes; o Modded tem o dele.
    private static File stateFile(Context c, String game) {
        return new File(c.getFilesDir(), "nfsu2".equals(game) ? "save-copy.txt" : "save-copy-" + game + ".txt");
    }

    /** Data da cópia mais nova (milissegundos), ou 0 se ainda não houve nenhuma. */
    static long lastCopy(Context c) {
        File f = stateFile(c, "nfsu2");
        return f.exists() ? f.lastModified() : 0;
    }

    private static void walk(File dir, List<File> out) {
        File[] kids = dir.listFiles();
        if (kids == null) return;
        for (File k : kids) {
            if (k.isDirectory()) { if (!k.getName().equals("Paths")) walk(k, out); } // Paths: o banco do navegador, nunca tocado
            else out.add(k);
        }
    }

    static boolean isProfile(byte[] b) {
        return b.length == PROFILE_SIZE && b[0] == '2' && b[1] == '0' && b[2] == 'C' && b[3] == 'M';
    }

    private static String profileName(byte[] b, int i) {
        int n = 0;
        while (n < 31 && b[NAME_AT + n] != 0) n++;
        String name = new String(b, NAME_AT, n, StandardCharsets.ISO_8859_1);
        return name.matches("[A-Za-z0-9]+") ? name : "Perfil" + (i + 1); // nome estranho: o "Restaurar" do jogo conserta
    }

    static String kindOf(File f) {
        byte[] head = new byte[32];
        int n;
        try (FileInputStream in = new FileInputStream(f)) { n = in.read(head); } catch (IOException e) { return null; }
        if (n <= 0) return null;
        String s = new String(head, 0, n, StandardCharsets.ISO_8859_1);
        if (s.startsWith("N2GA")) return "garage";
        if (s.startsWith("# NFSU2 settings")) return "settings.ini";
        if (s.startsWith("# Profiles the page")) return "autosave-profiles.txt";
        if (s.matches("(?s)d [A-Za-z_]\\w*=.*")) return "registry.txt";
        return null;
    }

    private static boolean mayBeExtra(long size) {
        return size == GARAGE_SIZE || (size >= 100 && size <= 4000) || (size >= 12000 && size <= 24000);
    }

    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x));
        return s.toString();
    }

    // ───────────── Pasta de cada site (NFSU2 Modded, 09/11) ─────────────
    // Os dois NFSU2 (nfsu2.xyz e nfsu2mod.xyz) guardam os arquivos em pastas numeradas do navegador (000, 001...), sem
    // dizer qual é de qual site. Uma pasta nova com arquivos do NFSU2 é do último jogo aberto pelo START (o único que
    // pode tê-la criado); as que já existiam antes desta versão são do NFSU2 (o Modded não abria antes).
    static final String LAST = "lastLaunched";
    private static final String DIR_KEY = "siteDir:";

    static File[] originDirs(Context c) {
        File root = new File(c.getApplicationInfo().dataDir, "app_chrome/Default/File System");
        File[] o = root.listFiles((d, n) -> n.matches("\\d{3}"));
        return o == null ? new File[0] : o;
    }

    static List<File> filesOf(File origin) {
        List<File> files = new ArrayList<>();
        walk(new File(origin, "t"), files);
        return files;
    }

    private static boolean hasNfsu2(List<File> files) {
        for (File f : files) {
            if (f.length() == PROFILE_SIZE || (f.length() >= 20 && f.length() <= 200000 && "settings.ini".equals(kindOf(f)))) return true;
        }
        return false;
    }

    /** Pasta (000, 001...) com arquivos do NFSU2 -> jogo ("nfsu2" ou "nfsu2mod"). Nunca lança erro. */
    static synchronized Map<String, String> siteDirs(Context c) {
        Map<String, String> out = new HashMap<>();
        try {
            SharedPreferences prefs = c.getSharedPreferences("nfs", Context.MODE_PRIVATE);
            SharedPreferences.Editor ed = prefs.edit();
            String last = prefs.getString(LAST, "nfsu2");
            if (!last.startsWith("nfsu2")) last = "nfsu2"; // Most Wanted e Carbon não criam arquivos do NFSU2
            for (File o : originDirs(c)) {
                String key = DIR_KEY + o.getName();
                if (!prefs.contains(key)) {
                    if (!hasNfsu2(filesOf(o))) continue;
                    ed.putString(key, last);
                }
                out.put(o.getName(), prefs.getString(key, last));
            }
            ed.commit();
        } catch (Exception | OutOfMemoryError ignored) { }
        return out;
    }

    /** START: as pastas novas ficam com o jogo anterior antes de marcar o que vai abrir. */
    static void launched(Context c, String gameId) {
        siteDirs(c);
        c.getSharedPreferences("nfs", Context.MODE_PRIVATE).edit().putString(LAST, gameId).commit();
    }

    /** Nunca lança erro: sem save ou sem conseguir ler, as cópias antigas continuam como estão. Uma cópia por site. */
    static void run(Context c) {
        Map<String, String> dirs = siteDirs(c);
        for (String game : new String[]{"nfsu2", "nfsu2mod"}) {
            try { runFor(c, game, dirs); } catch (Exception | OutOfMemoryError ignored) { }
        }
    }

    /** O que vai no zip de um site: nome no zip, conteúdo e arquivo de onde veio (o editor de save usa o mesmo). */
    static final class Collected {
        final List<String> names = new ArrayList<>();
        final List<byte[]> datas = new ArrayList<>();
        final List<File> files = new ArrayList<>();
        final List<byte[]> profiles = new ArrayList<>();
        private void add(String n, byte[] d, File f) { names.add(n); datas.add(d); files.add(f); }
    }

    static Collected collect(Context c, String game, Map<String, String> dirs) throws IOException {
        Collected out = new Collected();
        List<Found> profiles = new ArrayList<>();
        List<File> originFiles = new ArrayList<>();
        for (File o : originDirs(c)) {
            if (!game.equals(dirs.get(o.getName()))) continue;
            List<File> files = filesOf(o);
            for (File f : files) {
                if (f.length() != PROFILE_SIZE) continue;
                byte[] data = Files.readAllBytes(f.toPath());
                if (isProfile(data)) { profiles.add(new Found(f, data)); originFiles = files; }
            }
        }
        if (profiles.isEmpty()) return out;
        profiles.sort(Comparator.comparingLong((Found p) -> -p.file.lastModified()));
        for (Found p : profiles) out.profiles.add(p.data);
        for (int i = 0; i < profiles.size(); i++) {
            String n = profileName(profiles.get(i).data, i);
            String entry = "NFS Underground 2/" + n + "/" + n;
            if (out.names.contains(entry)) continue; // mesmo nome duas vezes: fica o mais novo (o zip não aceita repetido)
            out.add(entry, profiles.get(i).data, profiles.get(i).file);
        }
        // Com um perfil só, sai o backup inteiro; com mais de um não dá para saber de quem é a garagem.
        if (profiles.size() == 1) {
            originFiles.sort(Comparator.comparingLong((File f) -> -f.lastModified()));
            File garage = null, settings = null, registry = null, autosave = null;
            for (File f : originFiles) {
                if (!mayBeExtra(f.length())) continue;
                String k = kindOf(f);
                if (k == null) continue;
                if (k.equals("garage") && garage == null) garage = f;
                else if (k.equals("settings.ini") && settings == null) settings = f;
                else if (k.equals("registry.txt") && registry == null) registry = f;
                else if (k.equals("autosave-profiles.txt") && autosave == null) autosave = f;
            }
            if (garage != null && (settings != null || registry != null)) {
                String n = profileName(profiles.get(0).data, 0);
                out.add("NFS Underground 2/" + n + "/GARAGE.DAT", Files.readAllBytes(garage.toPath()), garage);
                if (settings != null) out.add("settings.ini", Files.readAllBytes(settings.toPath()), settings);
                if (registry != null) out.add("registry.txt", Files.readAllBytes(registry.toPath()), registry);
                if (autosave != null) out.add("autosave-profiles.txt", Files.readAllBytes(autosave.toPath()), autosave);
            }
        }
        return out;
    }

    private static void runFor(Context c, String game, Map<String, String> dirs) throws Exception {
        Collected got = collect(c, game, dirs);
        if (got.profiles.isEmpty()) return;
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        List<byte[]> sorted = new ArrayList<>(got.profiles);
        sorted.sort(Arrays::compareUnsigned);
        for (byte[] d : sorted) md.update(d);
        String sum = hex(md.digest());
        File state = stateFile(c, game);
        if (state.exists() && sum.equals(new String(Files.readAllBytes(state.toPath()), StandardCharsets.UTF_8).trim())) return;
        write(c, game, got.names, got.datas);
        Files.write(state.toPath(), sum.getBytes(StandardCharsets.UTF_8));
        prune(c, game);
    }

    /** Arquivo que o editor de save salvou, em Download/NFS Launcher (pelo botão "Salvar arquivo"). */
    static void saveFile(Context c, String name, byte[] data) throws IOException {
        ContentResolver cr = c.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.Downloads.DISPLAY_NAME, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
        v.put(MediaStore.Downloads.RELATIVE_PATH, FOLDER);
        v.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (uri == null) throw new IOException("sem acesso a Downloads");
        try (OutputStream out = cr.openOutputStream(uri)) {
            out.write(data);
        } catch (IOException e) {
            cr.delete(uri, null, null);
            throw e;
        }
        v.clear();
        v.put(MediaStore.Downloads.IS_PENDING, 0);
        cr.update(uri, v, null, null);
    }

    private static void write(Context c, String game, List<String> names, List<byte[]> datas) throws IOException {
        ContentResolver cr = c.getContentResolver();
        ContentValues v = new ContentValues();
        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date());
        v.put(MediaStore.Downloads.DISPLAY_NAME, game + "-saves-" + stamp + ".zip");
        v.put(MediaStore.Downloads.MIME_TYPE, "application/zip");
        v.put(MediaStore.Downloads.RELATIVE_PATH, FOLDER);
        v.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (uri == null) throw new IOException("sem acesso a Downloads");
        try (OutputStream out = cr.openOutputStream(uri); ZipOutputStream zip = new ZipOutputStream(out)) {
            for (int i = 0; i < names.size(); i++) {
                zip.putNextEntry(new ZipEntry(names.get(i)));
                zip.write(datas.get(i));
                zip.closeEntry();
            }
        } catch (IOException e) {
            cr.delete(uri, null, null); // zip pela metade não fica na pasta
            throw e;
        }
        v.clear();
        v.put(MediaStore.Downloads.IS_PENDING, 0);
        cr.update(uri, v, null, null);
    }

    // Só as 2 cópias mais novas de cada site feitas por este app. Nunca outro arquivo da pasta.
    private static void prune(Context c, String game) {
        ContentResolver cr = c.getContentResolver();
        String[] cols = {MediaStore.Downloads._ID};
        String where = MediaStore.Downloads.RELATIVE_PATH + "=? AND " + MediaStore.Downloads.DISPLAY_NAME + " LIKE ?";
        String[] args = {FOLDER, game + "-saves-%.zip"};
        try (Cursor q = cr.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cols, where, args, MediaStore.Downloads.DISPLAY_NAME + " DESC")) {
            if (q == null) return;
            for (int i = 0; q.moveToNext(); i++) {
                if (i < KEEP) continue;
                cr.delete(Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, q.getString(0)), null, null);
            }
        } catch (Exception ignored) { }
    }
}
