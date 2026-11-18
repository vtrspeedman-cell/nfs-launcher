package xyz.nfs.launcher;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import org.json.JSONObject;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Texturas HD do NFSU2 no celular (1.6.4, igual ao PC, src/main/gameSettings.js): o jogo só carrega o pacote de mapa
 * (TEXPACKS/detailed.pak, onde o motor entrega as texturas) com "ui_textures" em map ou uhud no settings.ini dele.
 * Com a opção ligada, troca SÓ essa linha para "ui_textures = map"; desligada, desfaz só o que o app trocou.
 * Vale para os dois NFSU2 (o do site principal e o Modded), cada um no seu arquivo. Roda com o jogo fechado (antes de abrir o motor), guarda cópia do arquivo antes e nunca mexe com
 * NFSU2_MAP_TEXTURES escrito pelo jogador nem com "map"/"uhud" que ele já tinha. Nunca lança erro.
 */
final class GameSettings {
    private static final String UI_LINE = "ui_textures = map";
    private static final Pattern KEY = Pattern.compile("^\\s*ui_textures\\s*=\\s*([^\\s#;]*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern MAP_KEY = Pattern.compile("^\\s*NFSU2_MAP_TEXTURES\\s*=", Pattern.CASE_INSENSITIVE);
    private static final String BACKUP = "settings.ini-antes-das-texturas-HD.txt";
    private static final String PREV = "texUiPrev"; // linha que o app trocou ("" = não havia); ausente = nada trocado

    private static final Pattern OFF = Pattern.compile("^(off|0|false|no)$");

    // Modo leve (PC 3.0.15 a 3.0.18, gameSettings.js LIGHT e MIN_GRAPHICS): aplica uma vez só ao ligar; o que o jogador
    // religar no jogo fica. Desligando, devolve só o que ainda está como o app deixou.
    private static final String[][] LIGHT = {
        {"crash_damage", "off"}, {"stance", "off"}, {"others_mod_parts", "original"}, {"hq_vinyls", "off"},
        {"road_textures", "off"}, {"daytime", "off"}, {"skateboard", "off"}, {"show_offcar", "off"},
        {"seed_registry", "off"}, {"fov_scale", "original"}, {"render", "scale:0.5"}, {"roam_max_cars", "16"},
        {"other_headlights", "off"}, {"anisotropic", "off"},
    };
    private static final String[] MIN_GRAPHICS = {
        "g_CarEnvironmentMapEnable", "g_CarEnvironmentMapUpdateData", "g_CarShadowEnable", "g_CarHeadlightEnable", "g_CrowdEnable",
        "g_RoadReflectionEnable", "g_FogEnable", "g_MotionBlurEnable", "g_LightStreaksEnable", "g_LightGlowEnable",
        "g_AnimatedTextureEnable", "g_ParticleSystemEnable", "g_DepthOfFieldEnable", "g_WorldLodLevel", "g_CarLodLevel",
        "g_OverBrightEnable", "g_BleachByPassEnable", "g_TintingEnable", "g_FSAALevel", "g_HorizonFogEnable", "g_RainEnable",
        "g_TextureFiltering",
    };
    private static final Pattern DWORD = Pattern.compile("^d ([^=\\r\\n]+)=(\\d+)$");
    private static final String LIGHT_PREV = "lightPrev"; // JSON por pasta: {ini:{chave:linha}, reg:{nome:valor}}
    private static final String LIGHT_BACKUP = "-antes-do-modo-leve.txt";

    private GameSettings() { }

    private static boolean active(String l) { return !l.matches("^\\s*[#;].*"); }

    private static void walk(File dir, List<File> out) {
        File[] kids = dir.listFiles();
        if (kids == null) return;
        for (File k : kids) {
            if (k.isDirectory()) { if (!k.getName().equals("Paths")) walk(k, out); } // Paths: o banco do navegador, nunca tocado
            else out.add(k);
        }
    }

    /**
     * Cada NFSU2 (nfsu2.xyz e o Modded, 09/11) tem o seu settings.ini, numa pasta do navegador (SaveCopy.siteDirs):
     * a linha é tratada em cada um, e o que o app trocou fica guardado por pasta ("texUiPrev:000").
     */
    static void run(Context c, boolean on) {
        try {
            SharedPreferences prefs = c.getSharedPreferences("nfs", Context.MODE_PRIVATE);
            Map<String, String> dirs = SaveCopy.siteDirs(c);
            // Até a 1.6.6 havia um só (o do NFSU2): o que o app tinha trocado passa para a pasta dele.
            if (prefs.contains(PREV)) {
                List<String> u2 = new ArrayList<>();
                for (Map.Entry<String, String> e : dirs.entrySet()) if ("nfsu2".equals(e.getValue())) u2.add(e.getKey());
                if (u2.size() == 1) prefs.edit().putString(PREV + ":" + u2.get(0), prefs.getString(PREV, "")).remove(PREV).commit();
            }
            for (File o : SaveCopy.originDirs(c)) {
                if (!dirs.containsKey(o.getName())) continue;
                try { runDir(c, prefs, o, on); } catch (Exception | OutOfMemoryError ignored) { }
            }
        } catch (Exception | OutOfMemoryError ignored) { }
    }

    private static void runDir(Context c, SharedPreferences prefs, File origin, boolean on) throws IOException {
        String key = PREV + ":" + origin.getName();
        String prev = prefs.contains(key) ? prefs.getString(key, "") : null;
        if (!on && prev == null) return; // desligada e nada trocado: nem procura
        File file = findOne(origin, "settings.ini");
        if (file == null) return;
        String text = read(file);
        List<String> lines = split(text);
        SharedPreferences.Editor ed = prefs.edit();
        // ui_textures = map (o mapa escolhido pelo jogador, NFSU2_MAP_TEXTURES, não se toca)
        boolean mapByPlayer = false;
        for (String l : lines) if (active(l) && MAP_KEY.matcher(l).find()) { mapByPlayer = true; break; }
        if (!mapByPlayer) {
            int i = find(lines, KEY);
            String val = i >= 0 ? value(KEY, lines.get(i)) : "";
            if (on) {
                if (!val.equals("map") && !val.equals("uhud")) { ed.putString(key, i >= 0 ? lines.get(i) : ""); put(lines, i, UI_LINE); }
            } else if (prev != null) {
                if (val.equals("map")) { if (prev.isEmpty()) lines.remove(i); else lines.set(i, prev); }
                ed.remove(key); // o jogador mudou depois: fica o dele
            }
        }
        // "Estradas mais nítidas" (road_textures) fica como o jogador deixou: o motor esconde nos pacotes do jogo só as
        // texturas que o modpack já tem (patch 0007, igual ao PC 3.0.19).
        String out = String.join(nl(text), lines);
        if (!out.equals(text)) {
            // A cópia do NFSU2 continua com o nome de antes; a do Modded ganha o número da pasta.
            backupAndWrite(c, origin, file, text, out, BACKUP);
        }
        ed.commit();
    }

    /** Modo leve ligado ou desligado, nos dois NFSU2; roda com o jogo fechado. Nunca lança erro. */
    static void light(Context c, boolean on) {
        try {
            SharedPreferences prefs = c.getSharedPreferences("nfs", Context.MODE_PRIVATE);
            Map<String, String> dirs = SaveCopy.siteDirs(c);
            for (File o : SaveCopy.originDirs(c)) {
                if (!dirs.containsKey(o.getName())) continue;
                try { lightDir(c, prefs, o, on); } catch (Exception | OutOfMemoryError ignored) { }
            }
        } catch (Exception | OutOfMemoryError ignored) { }
    }

    private static void lightDir(Context c, SharedPreferences prefs, File origin, boolean on) throws Exception {
        String key = LIGHT_PREV + ":" + origin.getName();
        JSONObject prev = new JSONObject(prefs.getString(key, "{}"));
        JSONObject ini = prev.optJSONObject("ini"), reg = prev.optJSONObject("reg");
        if (ini == null) ini = new JSONObject();
        if (!on && ini.length() == 0 && reg == null) return;
        File sf = findOne(origin, "settings.ini");
        if (sf != null) {
            String text = read(sf);
            List<String> lines = split(text);
            for (String[] kv : LIGHT) {
                Pattern re = Pattern.compile("^\\s*" + kv[0] + "\\s*=\\s*([^\\s#;]*)", Pattern.CASE_INSENSITIVE);
                int i = find(lines, re);
                String got = i >= 0 ? value(re, lines.get(i)) : null;
                boolean has = got != null && (kv[1].equals("off") ? OFF.matcher(got).matches() : got.equals(kv[1]));
                if (on) {
                    if (ini.has(kv[0])) continue; // uma vez só: se o jogador religou no jogo, fica o dele
                    ini.put(kv[0], i >= 0 ? lines.get(i) : "");
                    if (!has) put(lines, i, kv[0] + " = " + kv[1]);
                } else if (ini.has(kv[0])) {
                    if (has) { String p = ini.getString(kv[0]); if (p.isEmpty()) lines.remove(i); else lines.set(i, p); }
                    ini.remove(kv[0]);
                }
            }
            String out = String.join(nl(text), lines);
            if (!out.equals(text)) backupAndWrite(c, origin, sf, text, out, "settings.ini" + LIGHT_BACKUP);
        }
        File rf = findOne(origin, "registry.txt");
        if (rf != null && (on ? reg == null : reg != null)) {
            String text = read(rf);
            List<String> lines = split(text);
            Map<String, Integer> at = new LinkedHashMap<>();
            for (int k = 0; k < lines.size(); k++) {
                Matcher m = DWORD.matcher(lines.get(k));
                if (m.matches()) at.putIfAbsent(m.group(1).toLowerCase(java.util.Locale.ROOT), k);
            }
            List<Integer> drop = new ArrayList<>();
            if (on) {
                reg = new JSONObject();
                List<String> add = new ArrayList<>();
                for (String g : MIN_GRAPHICS) {
                    Integer k = at.get(g.toLowerCase(java.util.Locale.ROOT));
                    if (k == null) { reg.put(g, ""); add.add("d " + g + "=0"); continue; }
                    Matcher m = DWORD.matcher(lines.get(k));
                    m.matches();
                    reg.put(g, m.group(2));
                    lines.set(k, "d " + m.group(1) + "=0");
                }
                if (!add.isEmpty()) {
                    while (!lines.isEmpty() && lines.get(lines.size() - 1).isEmpty()) lines.remove(lines.size() - 1);
                    lines.addAll(add);
                    lines.add("");
                }
            } else {
                for (String g : MIN_GRAPHICS) {
                    Integer k = at.get(g.toLowerCase(java.util.Locale.ROOT));
                    if (k == null || !reg.has(g)) continue;
                    Matcher m = DWORD.matcher(lines.get(k));
                    if (!m.matches() || !m.group(2).equals("0")) continue; // o jogador mudou: fica o dele
                    String p = reg.getString(g);
                    if (p.isEmpty()) drop.add(k); else lines.set(k, "d " + m.group(1) + "=" + p);
                }
                drop.sort(java.util.Collections.reverseOrder());
                for (int k : drop) lines.remove(k);
                reg = null;
            }
            String out = String.join(nl(text), lines);
            if (!out.equals(text)) backupAndWrite(c, origin, rf, text, out, "registry.txt" + LIGHT_BACKUP);
        } else if (!on) reg = null; // sem o arquivo: nada a devolver
        if (ini.length() == 0 && reg == null) prefs.edit().remove(key).commit();
        else {
            JSONObject p = new JSONObject().put("ini", ini);
            if (reg != null) p.put("reg", reg);
            prefs.edit().putString(key, p.toString()).commit();
        }
    }

    private static File findOne(File origin, String kind) {
        List<File> files = new ArrayList<>();
        walk(new File(origin, "t"), files);
        List<File> found = new ArrayList<>();
        for (File f : files) if (f.length() >= 2 && f.length() <= 200000 && kind.equals(SaveCopy.kindOf(f))) found.add(f);
        return found.size() == 1 ? found.get(0) : null; // nenhum (jogo nunca aberto) ou mais de um: não escreve nada
    }

    private static String read(File f) throws IOException { return new String(Files.readAllBytes(f.toPath()), StandardCharsets.ISO_8859_1); }
    private static String nl(String text) { return text.contains("\r\n") ? "\r\n" : "\n"; }
    private static List<String> split(String text) { return new ArrayList<>(java.util.Arrays.asList(text.split("\r?\n", -1))); }

    private static int find(List<String> lines, Pattern re) {
        for (int k = 0; k < lines.size(); k++) if (active(lines.get(k)) && re.matcher(lines.get(k)).find()) return k;
        return -1;
    }

    private static String value(Pattern re, String line) {
        Matcher m = re.matcher(line);
        return m.find() ? m.group(1).toLowerCase(java.util.Locale.ROOT) : "";
    }

    /** Troca a linha i, ou acrescenta no fim (antes da linha vazia final) se não havia. */
    private static void put(List<String> lines, int i, String line) {
        if (i >= 0) { lines.set(i, line); return; }
        while (!lines.isEmpty() && lines.get(lines.size() - 1).isEmpty()) lines.remove(lines.size() - 1);
        lines.add(line);
        lines.add("");
    }

    private static void backupAndWrite(Context c, File origin, File file, String text, String out, String name) throws IOException {
        File backup = new File(c.getFilesDir(), "nfsu2".equals(SaveCopy.siteDirs(c).get(origin.getName())) ? name : origin.getName() + "-" + name);
        Files.write(backup.toPath(), text.getBytes(StandardCharsets.ISO_8859_1));
        // Grava ao lado e troca de uma vez: um arquivo pela metade nunca fica no lugar do original.
        File tmp = new File(file.getParentFile(), file.getName() + ".nfs-novo");
        Files.write(tmp.toPath(), out.getBytes(StandardCharsets.ISO_8859_1));
        Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }
}
