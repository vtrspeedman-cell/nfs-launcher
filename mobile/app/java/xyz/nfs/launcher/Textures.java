package xyz.nfs.launcher;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Texturas HD do NFSU2 no celular (pedido do Bruno, 08/11): nada vem no APK. O jogador baixa pelo app, das releases do
 * GitHub (mobile/texturas.json), o TexWizard e o NextGen em dois tamanhos: "1x" (o mesmo tamanho das texturas originais
 * do jogo, mais leve) ou "2x" (até 2x o lado delas). Junto com o primeiro vem o mapa detalhado do site, sem mudança.
 * Como no PC (src/main/texPack.js), cada parte (asfalto, carros...) escolhe o mod ou "Original"; os outros completam.
 * Aqui o pacote é gravado de verdade (files/texturas/texturas.ntxp), com o jogo fechado, e o motor o entrega no lugar
 * de TEXPACKS/detailed.pak (patch 0007, "--nfs-texturas", passado pelo patch 0005).
 *
 * Formato NTXP versão 2 (texrep_web.c): "NTXP", versão, quantidade, 4 bytes livres; 40 bytes por textura (crc, adler,
 * largura/altura/formato originais, largura/altura/formato novos, níveis, posição, tamanho, posição do nome); 8 bytes de
 * "base" por textura; os nomes; os dados. O jogo reconhece cada textura pelos 5 primeiros campos.
 */
final class Textures {
    static final String MANIFEST_URL = Downloads.RAW + "texturas.json";
    static final String SITE = "site";
    static final String ORIGINAL = "original";
    static final String[] MODS = {"texwizard", "nextgen"}; // nesta ordem: o primeiro que tem é o padrão de cada parte
    static final String[] MOD_NAMES = {"TexWizard", "NextGen"};
    static final String[] SCALES = {"1x", "2x"};
    static final long MAX_PAK = 600L * 1024 * 1024;
    static final String OUT = "texturas.ntxp";

    static final class Part {
        final String id, pt, en;
        final String notePt, noteEn;
        final Pattern re;
        Part(String id, String pt, String en, String re) { this(id, pt, en, re, null, null); }
        Part(String id, String pt, String en, String re, String notePt, String noteEn) {
            this.id = id; this.pt = pt; this.en = en; this.re = Pattern.compile(re); this.notePt = notePt; this.noteEn = noteEn;
        }
    }
    // As mesmas partes do PC (texPack.js PARTS). A primeira que casa vale; "menus" fica com o resto.
    static final Part[] PARTS = {
        new Part("estacionamento", "Faixas do estacionamento", "Parking lot lines", "^RDP_PARKING",
                "No NextGen as faixas somem. A do TexWizard é a mais parecida com a original.",
                "With NextGen the lines disappear. TexWizard is closest to the original."),
        new Part("asfalto", "Asfalto e pistas", "Asphalt and tracks", "^(RDP_(?!ROADSTRIP_COBBLE)|SHRM_ROAD$|ARC_CONCFREEWAY$)"),
        new Part("calcadas", "Calçadas e paralelepípedo", "Sidewalks and cobblestone", "^(ARC_SIDEWALK|RDP_ROADSTRIP_COBBLE|RDT_|ARC_BOARDWALK|ARC_COURTGD|ARC_PRESSED_CONCRETE|ARC_UC_BOARKWALK)"),
        new Part("cenario", "Prédios, muros e objetos", "Buildings, walls and objects", "^(ARC_|ARK_|OBJ_|SGN_|SHRM_(?!SKY$)|SHR_|GRG_|GFE_|CRLOT_|PNT_|PRTSHP_|MARBLEFLOOR|SHADOWRAMP)"),
        new Part("natureza", "Árvores, grama e terreno", "Trees, grass and terrain", "^(ORG_|TRN_)"),
        new Part("ceu", "Céu", "Sky", "^(SKY_|SHRM_SKY$)"),
        new Part("carros", "Carros (neon, faróis e sombra)", "Cars (neon, headlights and shadow)", "(^[0-9A-Z]+_NEON$|^[0-9A-Z]+_SHADOW(FE|IG)$|^NEONBLUR$|^HEADLIGHTGLOW$|^CARBONFIBRE$)"),
        new Part("efeitos", "Efeitos (fogo, fumaça e brilhos)", "Effects (fire, smoke and glows)", "^SFX_"),
        new Part("menus", "Menus, HUD e mapa", "Menus, HUD and map", "."),
    };
    static String partOf(String name) {
        for (Part p : PARTS) if (p.re.matcher(name == null ? "" : name).find()) return p.id;
        return "menus";
    }

    private Textures() { }

    static File dir(Context c) { return new File(c.getFilesDir(), "texturas"); }
    static File output(Context c) { return new File(dir(c), OUT); }
    static File fileOf(Context c, String id) { return new File(dir(c), id + ".pak"); }
    static String idOf(String mod, String scale) { return mod + "-" + scale; }
    static boolean knownId(String id) {
        if (SITE.equals(id)) return true;
        for (String m : MODS) for (String s : SCALES) if (idOf(m, s).equals(id)) return true;
        return false;
    }
    static boolean knownMod(String id) { return Arrays.asList(MODS).contains(id); }
    static String scale(SharedPreferences p) { return "1x".equals(p.getString("texScale", "2x")) ? "1x" : "2x"; }
    static String otherScale(String s) { return "1x".equals(s) ? "2x" : "1x"; }

    /** Algum mod do tamanho escolhido baixado (sem ele não há o que entregar). */
    static boolean anyMod(Context c, String scale) {
        for (String m : MODS) if (fileOf(c, idOf(m, scale)).isFile()) return true;
        return false;
    }
    static boolean ready(Context c) { return output(c).isFile() && output(c).length() > 64; }

    // ───────────── Lista publicada (texturas.json) ─────────────
    static final class Offer { final String url, sha256; final long size; Offer(String u, long s, String h) { url = u; size = s; sha256 = h; } }

    /** {id: arquivo} só com ids conhecidos, endereço das releases, tamanho e SHA-256 válidos (o primeiro de cada id). */
    static Map<String, Offer> parseOffer(String json) throws Exception {
        Map<String, Offer> out = new LinkedHashMap<>();
        JSONArray a = new JSONObject(json).optJSONArray("arquivos");
        if (a == null) return out;
        for (int i = 0; i < a.length(); i++) {
            JSONObject f = a.optJSONObject(i);
            if (f == null) continue;
            String id = f.optString("id"), url = f.optString("arquivo"), sha = f.optString("sha256");
            long size = f.optLong("tamanho", 0);
            if (!knownId(id) || out.containsKey(id) || !Downloads.okAsset(url, ".pak") || size <= 0 || size > MAX_PAK
                    || !Downloads.SHA.matcher(sha).matches()) continue;
            out.put(id, new Offer(url, size, sha.toLowerCase(java.util.Locale.ROOT)));
        }
        return out;
    }

    // ───────────── Índice de um pacote ─────────────
    static final class Entry {
        long crc, adler, off, size, boff, bsize;
        int ow, oh, w, h;
        long ofmt, fmt, levels;
        String name;
        String key() { return crc + ":" + adler + ":" + ow + ":" + oh + ":" + ofmt; }
    }
    static final class Index { File file; long size; long dataStart; List<Entry> entries = new ArrayList<>(); }

    private static final Map<String, Index> CACHE = new HashMap<>();

    static Index readIndex(File f) throws IOException {
        synchronized (CACHE) { return readIndexLocked(f); }
    }
    private static Index readIndexLocked(File f) throws IOException {
        String ck = f.getPath() + "|" + f.length() + "|" + f.lastModified();
        Index cached = CACHE.get(ck);
        if (cached != null) return cached;
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            long fileSize = r.length();
            byte[] h16 = new byte[16];
            r.readFully(h16);
            ByteBuffer hb = ByteBuffer.wrap(h16).order(ByteOrder.LITTLE_ENDIAN);
            if (!"NTXP".equals(new String(h16, 0, 4, StandardCharsets.ISO_8859_1)) || hb.getInt(4) != 2) throw new IOException("não é pacote versão 2");
            int n = hb.getInt(8);
            if (n < 0 || n > 100000) throw new IOException("índice grande demais");
            int len = (int) Math.min(fileSize, 16L + 48L * n + 8L * 1024 * 1024);
            byte[] all = new byte[len];
            r.seek(0);
            r.readFully(all);
            ByteBuffer b = ByteBuffer.wrap(all).order(ByteOrder.LITTLE_ENDIAN);
            int baseAt = 16 + 40 * n;
            Index idx = new Index();
            idx.file = f;
            idx.size = fileSize;
            idx.dataStart = fileSize;
            for (int i = 0; i < n; i++) {
                int o = 16 + 40 * i;
                Entry e = new Entry();
                e.crc = b.getInt(o) & 0xffffffffL; e.adler = b.getInt(o + 4) & 0xffffffffL;
                e.ow = b.getShort(o + 8) & 0xffff; e.oh = b.getShort(o + 10) & 0xffff; e.ofmt = b.getInt(o + 12) & 0xffffffffL;
                e.w = b.getShort(o + 16) & 0xffff; e.h = b.getShort(o + 18) & 0xffff; e.fmt = b.getInt(o + 20) & 0xffffffffL;
                e.levels = b.getInt(o + 24) & 0xffffffffL;
                e.off = b.getInt(o + 28) & 0xffffffffL; e.size = b.getInt(o + 32) & 0xffffffffL;
                e.boff = b.getInt(baseAt + 8 * i) & 0xffffffffL; e.bsize = b.getInt(baseAt + 8 * i + 4) & 0xffffffffL;
                int nameAt = b.getInt(o + 36);
                int end = nameAt;
                while (end >= 0 && end < len && all[end] != 0) end++;
                e.name = nameAt > 0 && end < len && end > nameAt ? new String(all, nameAt, end - nameAt, StandardCharsets.ISO_8859_1) : "";
                if (e.off + e.size > fileSize || (e.bsize > 0 && e.boff + e.bsize > fileSize)) throw new IOException("entrada fora do arquivo");
                idx.dataStart = Math.min(idx.dataStart, e.off);
                if (e.bsize > 0) idx.dataStart = Math.min(idx.dataStart, e.boff);
                idx.entries.add(e);
            }
            CACHE.put(ck, idx);
            return idx;
        }
    }

    /** Pacotes presentes: o do site e os mods do tamanho escolhido (pacote com defeito fica de fora). */
    static Map<String, Index> sources(Context c, String scale) {
        Map<String, Index> out = new LinkedHashMap<>();
        File site = fileOf(c, SITE);
        try { if (site.isFile()) out.put(SITE, readIndex(site)); } catch (IOException ignored) { }
        for (String m : MODS) {
            File f = fileOf(c, idOf(m, scale));
            try { if (f.isFile()) out.put(m, readIndex(f)); } catch (IOException ignored) { }
        }
        return out;
    }

    /** Quais mods têm texturas em cada parte. */
    static Map<String, List<String>> partsAvailable(Map<String, Index> src) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (Part p : PARTS) out.put(p.id, new ArrayList<>());
        for (String m : MODS) {
            Index idx = src.get(m);
            if (idx == null) continue;
            java.util.Set<String> has = new java.util.HashSet<>();
            for (Entry e : idx.entries) has.add(partOf(e.name));
            for (Part p : PARTS) if (has.contains(p.id)) out.get(p.id).add(m);
        }
        return out;
    }

    static JSONObject choice(SharedPreferences p) {
        try { return new JSONObject(p.getString("texChoice", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** A escolha que vale: a do jogador, se aquele mod existe na parte; senão o primeiro que existe; ou "original". */
    static Map<String, String> effective(JSONObject choice, Map<String, List<String>> avail) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Part p : PARTS) {
            List<String> list = avail.get(p.id);
            String c = choice.optString(p.id, "");
            out.put(p.id, ORIGINAL.equals(c) ? ORIGINAL : list.contains(c) ? c : list.isEmpty() ? ORIGINAL : list.get(0));
        }
        return out;
    }

    static final class Pick { final Entry e; final String src; Pick(Entry e, String src) { this.e = e; this.src = src; } }

    /**
     * Mapa do site sempre; em cada parte só o mod escolhido (o que ele não tem fica original: nada de mod não escolhido entra
     * sozinho, igual ao PC desde 08/11); mesma textura: a maior (empate: o site).
     */
    static List<Pick> choose(Map<String, Index> src, Map<String, String> eff) {
        Map<String, Pick> picked = new LinkedHashMap<>();
        Index site = src.get(SITE);
        if (site != null) for (Entry e : site.entries) picked.put(e.key(), new Pick(e, SITE));
        Map<String, Pick> fromMods = new LinkedHashMap<>();
        for (Part p : PARTS) {
            String chosen = eff.get(p.id);
            if (ORIGINAL.equals(chosen)) continue;
            for (String m : new String[] {chosen}) {
                Index idx = src.get(m);
                if (idx == null) continue;
                for (Entry e : idx.entries) {
                    if (!p.id.equals(partOf(e.name)) || fromMods.containsKey(e.key()) || e.bsize > 0) continue; // mods sem base
                    fromMods.put(e.key(), new Pick(e, m));
                }
            }
        }
        for (Map.Entry<String, Pick> x : fromMods.entrySet()) {
            Pick had = picked.get(x.getKey());
            Entry e = x.getValue().e;
            if (had == null || (long) e.w * e.h > (long) had.e.w * had.e.h) picked.put(x.getKey(), x.getValue());
        }
        List<Pick> list = new ArrayList<>(picked.values());
        Collections.sort(list, (a, b) -> a.e.crc != b.e.crc ? Long.compare(a.e.crc, b.e.crc) : Long.compare(a.e.adler, b.e.adler));
        return list;
    }

    // ───────────── Pacote para o motor ─────────────
    /**
     * Grava files/texturas/texturas.ntxp com a escolha atual (só se algo mudou). Sem nenhum mod do tamanho escolhido, apaga o
     * pacote (o jogo usa o mapa do próprio site). Sempre com o jogo fechado: o motor só abre o arquivo ao começar.
     */
    static synchronized void build(Context c) {
        File out = output(c);
        File stampFile = new File(dir(c), OUT + ".info");
        try {
            SharedPreferences prefs = c.getSharedPreferences("nfs", Context.MODE_PRIVATE);
            String scale = scale(prefs);
            Map<String, Index> src = sources(c, scale);
            boolean mods = false;
            for (String m : MODS) mods |= src.containsKey(m);
            if (!mods) { //noinspection ResultOfMethodCallIgnored
                out.delete(); //noinspection ResultOfMethodCallIgnored
                stampFile.delete(); return; }
            Map<String, String> eff = effective(choice(prefs), partsAvailable(src));
            StringBuilder stamp = new StringBuilder("v1");
            for (Map.Entry<String, Index> s : src.entrySet()) stamp.append('|').append(s.getKey()).append(':').append(s.getValue().size).append(':').append(s.getValue().file.lastModified());
            for (Map.Entry<String, String> e : eff.entrySet()) stamp.append('|').append(e.getKey()).append('=').append(e.getValue());
            String want = stamp.toString();
            try {
                if (ready(c) && want.equals(new String(Files.readAllBytes(stampFile.toPath()), StandardCharsets.UTF_8))) return;
            } catch (IOException ignored) { }
            write(src, choose(src, eff), new File(dir(c), OUT + ".novo"), out);
            Files.write(stampFile.toPath(), want.getBytes(StandardCharsets.UTF_8));
        } catch (Exception | OutOfMemoryError e) {
            // Falhou: sem pacote, o jogo abre com o mapa do site (nunca com um pacote pela metade).
            //noinspection ResultOfMethodCallIgnored
            out.delete();
            //noinspection ResultOfMethodCallIgnored
            stampFile.delete();
        }
    }

    private static void write(Map<String, Index> src, List<Pick> list, File tmp, File out) throws IOException {
        int n = list.size();
        ByteArrayOutputStreamEx names = new ByteArrayOutputStreamEx();
        for (Pick x : list) { byte[] nb = x.e.name.getBytes(StandardCharsets.ISO_8859_1); names.write(nb, 0, nb.length); names.write(0); }
        int namesAt = 16 + 48 * n;
        int dataAt = (namesAt + names.size() + 15) / 16 * 16;
        ByteBuffer head = ByteBuffer.allocate(dataAt).order(ByteOrder.LITTLE_ENDIAN);
        head.put("NTXP".getBytes(StandardCharsets.ISO_8859_1)).putInt(2).putInt(n).putInt(0);
        System.arraycopy(names.buf(), 0, head.array(), namesAt, names.size());
        Index site = src.get(SITE);
        boolean useSite = false;
        for (Pick x : list) useSite |= SITE.equals(x.src);
        long pos = dataAt;
        long siteShift = 0;
        if (useSite) { siteShift = pos - site.dataStart; pos += site.size - site.dataStart; }
        Map<String, Long> placed = new HashMap<>(); // a mesma imagem de um mod (ex.: sombra de vários carros) vai uma vez só
        List<Pick> copies = new ArrayList<>();
        int nameOff = namesAt;
        for (int i = 0; i < n; i++) {
            Entry e = list.get(i).e;
            long off, boff = 0, bsize = 0;
            if (SITE.equals(list.get(i).src)) {
                off = e.off + siteShift;
                if (e.bsize > 0) { boff = e.boff + siteShift; bsize = e.bsize; }
            } else {
                String k = list.get(i).src + ":" + e.off + ":" + e.size;
                Long at = placed.get(k);
                if (at == null) { at = pos; placed.put(k, at); copies.add(list.get(i)); pos += e.size; }
                off = at;
            }
            if (pos > 0xffffffffL) throw new IOException("pacote grande demais");
            int o = 16 + 40 * i, bo = 16 + 40 * n + 8 * i;
            head.putInt(o, (int) e.crc).putInt(o + 4, (int) e.adler).putShort(o + 8, (short) e.ow).putShort(o + 10, (short) e.oh)
                .putInt(o + 12, (int) e.ofmt).putShort(o + 16, (short) e.w).putShort(o + 18, (short) e.h).putInt(o + 20, (int) e.fmt)
                .putInt(o + 24, (int) e.levels).putInt(o + 28, (int) off).putInt(o + 32, (int) e.size).putInt(o + 36, nameOff);
            head.putInt(bo, (int) boff).putInt(bo + 4, (int) bsize);
            nameOff += e.name.getBytes(StandardCharsets.ISO_8859_1).length + 1;
        }
        File d = tmp.getParentFile();
        if (d != null && !d.isDirectory() && !d.mkdirs()) throw new IOException("pasta");
        Map<String, FileChannel> open = new HashMap<>();
        try (FileOutputStream fo = new FileOutputStream(tmp); FileChannel to = fo.getChannel()) {
            head.position(0);
            while (head.hasRemaining()) to.write(head);
            if (useSite) copy(open, site.file, site.dataStart, site.size - site.dataStart, to);
            for (Pick x : copies) copy(open, src.get(x.src).file, x.e.off, x.e.size, to);
            if (to.position() != pos) throw new IOException("tamanho errado");
            fo.getFD().sync();
        } finally {
            for (FileChannel ch : open.values()) try { ch.close(); } catch (IOException ignored) { }
        }
        Files.move(tmp.toPath(), out.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    @SuppressWarnings("resource")
    private static void copy(Map<String, FileChannel> open, File f, long from, long len, FileChannel to) throws IOException {
        FileChannel ch = open.get(f.getPath());
        if (ch == null) { ch = new RandomAccessFile(f, "r").getChannel(); open.put(f.getPath(), ch); }
        long done = 0;
        while (done < len) {
            long k = ch.transferTo(from + done, len - done, to);
            if (k <= 0) throw new IOException("leitura");
            done += k;
        }
    }

    /** ByteArrayOutputStream com acesso ao buffer (sem cópia). */
    private static final class ByteArrayOutputStreamEx extends java.io.ByteArrayOutputStream {
        byte[] buf() { return buf; }
    }
}
