package xyz.nfs.launcher;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Editor de save (UNPSY, do Psy), igual ao do PC (src/main/saveEdit.js). Antes de abrir o editor, o save atual vai para
 * "antes-do-editor-*.zip" (+ .json com onde cada arquivo fica). O que o editor salva só entra no jogo com o clique do
 * jogador, e só por cima dos mesmos arquivos (perfil e GARAGE.DAT, mesmo tamanho e mesmo tipo). Nada aqui roda sozinho.
 */
final class SaveEdit {
    static final int KEEP = 3;
    private static final String SNAP = "antes-do-editor-\\d{8}-\\d{6}\\.zip";

    private SaveEdit() { }

    static final class Result {
        final boolean ok; final String why; final byte[] zip; final int written; final File file;
        Result(boolean ok, String why, byte[] zip, int written, File file) {
            this.ok = ok; this.why = why; this.zip = zip; this.written = written; this.file = file;
        }
        static Result no(String why) { return new Result(false, why, null, 0, null); }
    }

    static File dir(Context c, String game) { return new File(c.getFilesDir(), "editor/" + game); }
    private static File root(Context c) { return new File(c.getApplicationInfo().dataDir, "app_chrome/Default/File System"); }

    private static List<String> snapshots(File dest) {
        String[] n = dest.list((d, s) -> s.matches(SNAP));
        List<String> out = new ArrayList<>(n == null ? List.of() : Arrays.asList(n));
        out.sort((a, b) -> b.compareTo(a));
        return out;
    }

    private static File json(File zip) { return new File(zip.getPath().replaceAll("\\.zip$", ".json")); }

    /** Cópia mais nova que tem o mapa, ou null. */
    static File latest(Context c, String game) {
        File dest = dir(c, game);
        for (String n : snapshots(dest)) {
            File z = new File(dest, n);
            if (json(z).isFile()) return z;
        }
        return null;
    }

    static Result snapshot(Context c, String game) throws Exception {
        SaveCopy.Collected got = SaveCopy.collect(c, game, SaveCopy.siteDirs(c));
        if (got.profiles.isEmpty()) return Result.no("sem-save");
        String rootPath = root(c).getCanonicalPath() + File.separator;
        JSONObject map = new JSONObject();
        for (int i = 0; i < got.names.size(); i++) {
            String p = got.files.get(i).getCanonicalPath();
            if (p.startsWith(rootPath) && !map.has(got.names.get(i))) map.put(got.names.get(i), p.substring(rootPath.length()));
        }
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(buf)) {
            for (int i = 0; i < got.names.size(); i++) {
                ZipEntry e = new ZipEntry(got.names.get(i));
                e.setTime(got.files.get(i).lastModified());
                zip.putNextEntry(e);
                zip.write(got.datas.get(i));
                zip.closeEntry();
            }
        }
        byte[] zipBuf = buf.toByteArray();
        File dest = dir(c, game);
        if (!dest.isDirectory() && !dest.mkdirs()) throw new IOException("sem pasta");
        String base = "antes-do-editor-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date());
        File z = new File(dest, base + ".zip");
        Files.write(new File(dest, base + ".json").toPath(), new JSONObject().put("files", map).toString().getBytes(StandardCharsets.UTF_8));
        File tmp = new File(dest, base + ".zip.tmp");
        Files.write(tmp.toPath(), zipBuf);
        if (!tmp.renameTo(z)) throw new IOException("sem gravar");
        List<String> all = snapshots(dest);
        for (int i = KEEP; i < all.size(); i++) {
            new File(dest, all.get(i)).delete();
            json(new File(dest, all.get(i))).delete();
        }
        return new Result(true, null, zipBuf, 0, z);
    }

    private static final class Entry {
        final String name; final byte[] data;
        Entry(String name, byte[] data) { this.name = name; this.data = data; }
    }

    private static List<Entry> unzip(byte[] buf) throws IOException {
        List<Entry> out = new ArrayList<>();
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(buf))) {
            ZipEntry e;
            byte[] chunk = new byte[16384];
            while ((e = in.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                int n;
                while ((n = in.read(chunk)) > 0) {
                    b.write(chunk, 0, n);
                    if (b.size() > 4_000_000) throw new IOException("grande demais");
                }
                out.add(new Entry(e.getName().replace('\\', '/'), b.toByteArray()));
            }
        }
        if (out.isEmpty()) throw new IOException("zip vazio");
        return out;
    }

    // Só perfil e garagem; configurações do jogo ficam como estão.
    private static String kindOfData(String name, byte[] d) {
        if (SaveCopy.isProfile(d)) return "perfil";
        boolean garage = name.matches("(?i)(.*/)?GARAGE\\.DAT") && d.length == SaveCopy.GARAGE_SIZE
            && d[0] == 'N' && d[1] == '2' && d[2] == 'G' && d[3] == 'A';
        return garage ? "garagem" : null;
    }

    private static Map<String, String> mapOf(JSONObject files) {
        Map<String, String> m = new java.util.HashMap<>();
        for (Iterator<String> it = files.keys(); it.hasNext(); ) { String k = it.next(); m.put(k, files.optString(k)); }
        return m;
    }

    /** Confere tudo antes de gravar qualquer coisa: ou entra tudo, ou nada. */
    static Result apply(Context c, byte[] zipBuf, Map<String, String> map, File tmpDir) throws IOException {
        List<Entry> list;
        try { list = unzip(zipBuf); } catch (Exception e) { return Result.no("zip"); }
        String rootPath = root(c).getCanonicalPath() + File.separator;
        List<File> files = new ArrayList<>();
        List<byte[]> datas = new ArrayList<>();
        boolean any = false;
        for (Entry e : list) {
            String rel = map.get(e.name);
            if (rel == null || !e.name.startsWith("NFS Underground 2/")) continue;
            String kind = kindOfData(e.name, e.data);
            if (kind == null) return Result.no("estragado"); // perfil ou garagem fora do formato: nada entra
            any = true;
            File f = new File(root(c), rel).getCanonicalFile();
            if (!f.getPath().startsWith(rootPath)) continue;
            if (!f.isFile()) return Result.no("sumiu");
            byte[] cur = Files.readAllBytes(f.toPath());
            if (cur.length != e.data.length || !kind.equals(kindOfData(e.name, cur))) return Result.no("diferente");
            if (!Arrays.equals(cur, e.data)) { files.add(f); datas.add(e.data); }
        }
        if (!any) return Result.no("nada");
        if (!tmpDir.isDirectory() && !tmpDir.mkdirs()) throw new IOException("sem pasta");
        for (int i = 0; i < files.size(); i++) {
            File tmp = new File(files.get(i).getParentFile(), files.get(i).getName() + ".editor-novo");
            Files.write(tmp.toPath(), datas.get(i));
            if (!tmp.renameTo(files.get(i))) { tmp.delete(); throw new IOException("sem gravar"); }
        }
        return new Result(true, null, null, files.size(), null);
    }

    /** Aplica o zip que o editor salvou, pelo mapa da cópia feita ao abrir o editor. */
    static Result applyEdited(Context c, String game, File snap, byte[] zipBuf) throws Exception {
        JSONObject j = new JSONObject(new String(Files.readAllBytes(json(snap).toPath()), StandardCharsets.UTF_8));
        return apply(c, zipBuf, mapOf(j.optJSONObject("files") == null ? new JSONObject() : j.getJSONObject("files")), dir(c, game));
    }

    static Result restoreLast(Context c, String game) throws Exception {
        File z = latest(c, game);
        if (z == null) return Result.no("sem-copia");
        Result r = applyEdited(c, game, z, Files.readAllBytes(z.toPath()));
        return new Result(r.ok, r.why, null, r.written, z);
    }
}
