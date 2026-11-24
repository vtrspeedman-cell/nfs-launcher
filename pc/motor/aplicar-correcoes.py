# Correções no código do Electron em C:\e\src\electron. Rodar de novo não muda nada (compilar.cmd chama sempre).
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(r"C:\e\src\electron")

CORRECOES = [
    # Electron 45.1.0 não monta com enable_pdf_viewer = false: o arquivo pede o leitor de PDF com ENABLE_PDF,
    # que continua ligado por causa da impressão, mas o BUILD.gn só inclui o leitor com enable_pdf_viewer.
    ("shell/browser/extensions/electron_component_extension_resource_manager.cc", [
        ('#include "pdf/buildflags.h"', '#include "electron/buildflags/buildflags.h"\n#include "pdf/buildflags.h"'),
        ("#if BUILDFLAG(ENABLE_PDF)\n#include <utility>", "#if BUILDFLAG(ENABLE_PDF_VIEWER)\n#include <utility>"),
        ("#endif  // BUILDFLAG(ENABLE_PDF)", "#endif  // BUILDFLAG(ENABLE_PDF_VIEWER)"),
        ("#if BUILDFLAG(ENABLE_PDF)\n  AddComponentResourceEntries", "#if BUILDFLAG(ENABLE_PDF_VIEWER)\n  AddComponentResourceEntries"),
    ]),
]

COPIA = 'AddExtensionASCII("guardado-" + base::NumberToString(base::Time::Now().InMillisecondsSinceUnixEpoch()))'
SO_CORRUPCAO = (
    "  // NFS: erro de trava ou de disco nunca apaga nada; so a falta do MANIFEST e corrupcao de verdade.\n"
    "  if (!status.IsCorruption() &&\n"
    '      status.ToString().find("MANIFEST") == std::string::npos) {\n'
    "    return false;\n"
    "  }\n"
    "  // NFS: reparar e limpar apagam arquivos, entao antes fica uma copia. Sem copia, falha.\n"
    "  if (recovery_option != FAIL_ON_CORRUPTION &&\n"
    "      !base::CopyDirectory(PASTA, PASTA." + COPIA + ",\n"
    "                           true)) {\n"
    "    return false;\n"
    "  }\n\n"
    "  switch (recovery_option) {"
)
# O Chromium apaga os saves (OPFS) quando acha que o banco esta com defeito. Pedido do Bruno: nunca apagar.
# O caminho "..\storage" sai da pasta electron para o codigo do Chromium.
CORRECOES += [
    ("../storage/browser/file_system/sandbox_directory_database.cc", [
        ("  switch (recovery_option) {", SO_CORRUPCAO.replace("PASTA", "filesystem_data_directory_")),
    ]),
    ("../storage/browser/file_system/sandbox_origin_database.cc", [
        ("  switch (recovery_option) {", SO_CORRUPCAO.replace("PASTA", "file_system_directory_")),
    ]),
    # Pasta sem registro no banco nao e lixo: fica guardada com outro nome.
    ("../storage/browser/file_system/obfuscated_file_util.cc", [
        # Banco ocupado por outra copia fechando responde "nao tem" sem ter olhado. Com ele aberto, a resposta e verdadeira.
        ("  bool exists_in_db = origin_database_->HasOriginPath(id);",
         "  // NFS: banco ocupado (outra copia fechando): falha em vez de achar que a pasta e orfa.\n"
         "  std::vector<SandboxOriginDatabaseInterface::OriginRecord> origins;\n"
         "  if (!origin_database_->ListAllOrigins(&origins)) {\n"
         "    return base::unexpected(base::File::FILE_ERROR_FAILED);\n"
         "  }\n"
         "  bool exists_in_db = origin_database_->HasOriginPath(id);"),
        ("  if (!exists_in_db && exists_in_fs) {\n    if (!delegate_->DeleteFileOrDirectory(path, true)) {",
         "  if (!exists_in_db && exists_in_fs) {\n    // NFS: nunca apaga save; guarda com outro nome.\n"
         "    if (is_incognito() ? !delegate_->DeleteFileOrDirectory(path, true)\n"
         "                       : !base::Move(path, path." + COPIA + ")) {"),
    ]),
    # Configuracoes do site (localStorage): mesma regra. Sem banco nesta sessao, fica so na memoria e o disco nao muda.
    ("../components/services/storage/dom_storage/local_storage_impl.cc", [
        ('#include "base/files/file_path.h"', '#include "base/files/file_path.h"\n#include "base/files/file_util.h"'),
        ('#include "base/strings/strcat.h"',
         '#include "base/strings/strcat.h"\n#include "base/strings/string_number_conversions.h"\n#include "base/time/time.h"'),
        ("  if (!outcome.open_status.ok()) {\n",
         "  if (!outcome.open_status.ok()) {\n"
         "    // NFS: erro de trava ou de disco nunca apaga: nesta sessao fica so na memoria.\n"
         "    if (!in_memory_ && !outcome.open_status.IsCorruption()) {\n"
         "      database_.reset();\n"
         "      tried_to_recreate_during_open_ = true;\n"
         "      InitiateConnection(/*in_memory_only=*/true,\n"
         "                         /*destroy_existing_db_for_recovery=*/false);\n"
         "      return;\n"
         "    }\n"),
        ("  InitiateConnection(recreate_in_memory,\n                     /*destroy_existing_db_for_recovery=*/!in_memory_);",
         "  // NFS: destruir o banco apaga as configuracoes do site; antes fica uma copia. Sem copia, so na memoria.\n"
         "  bool destroy = !in_memory_;\n"
         "  if (destroy) {\n"
         '    const base::FilePath pasta = storage_partition_directory_.AppendASCII("Local Storage");\n'
         "    if (!base::CopyDirectory(pasta, pasta." + COPIA + ",\n"
         "                             true)) {\n"
         "      recreate_in_memory = true;\n"
         "      destroy = false;\n"
         "    }\n"
         "  }\n"
         "  InitiateConnection(recreate_in_memory, destroy);"),
    ]),
    # Placa sem DirectX 12 e com DirectX 11 nivel 11_0 (ex.: GTX 550 Ti, Fermi): o Dawn so da o WebGPU completo em 11_1,
    # e no 11_0 so o de compatibilidade, que o jogo nao pede. Aqui o 11_0 tambem entra no completo. So vale no modo
    # DirectX 11 do app (--use-webgpu-adapter=d3d11), que so liga sozinho quando a placa nao tem DirectX 12.
    # Jogador com GTX 550 Ti jogou com isto em 05/11 (versao de teste separada). O minimo de buffers do modo completo
    # cabe: buffer so de leitura usa SRV, nao UAV.
    ("../third_party/dawn/src/dawn/native/d3d11/PhysicalDeviceD3D11.cpp", [
        ("        case wgpu::FeatureLevel::Core: {\n            return mFeatureLevel >= D3D_FEATURE_LEVEL_11_1;",
         "        case wgpu::FeatureLevel::Core: {\n            return mFeatureLevel >= D3D_FEATURE_LEVEL_11_0;  // NFS: 11_0 tambem"),
        ("    limits->v1.maxStorageBuffersPerShaderStage = maxUAVsPerStage / 2;\n",
         "    limits->v1.maxStorageBuffersPerShaderStage = maxUAVsPerStage / 2;\n"
         "    // NFS: minimo do modo completo no nivel 11_0; buffer so de leitura usa SRV, nao UAV.\n"
         "    limits->v1.maxStorageBuffersPerShaderStage = std::max(limits->v1.maxStorageBuffersPerShaderStage, 8u);\n"),
    ]),
    # Disco quase cheio: o Chromium apagaria os dados do jogo sozinho. Melhor falhar ao gravar.
    ("../storage/browser/quota/quota_manager_impl.cc", [
        ("  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);\n\n  if (eviction_disabled_) {",
         "  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);\n\n"
         "  eviction_disabled_ = true;  // NFS: nunca apaga save para liberar disco.\n  if (eviction_disabled_) {"),
    ]),
]

# Pacotes de imagem do NFS Launcher (10/11, no lugar do FXAA sozinho de 03/11): anti-serrilhado (FXAA), nitidez (CAS),
# bloom, cor e vinheta sobre a imagem pronta do jogo, logo antes do passo de alfa. Os efeitos estao em nfs-imagem.wgsl
# e o codigo em nfs-imagem.inc, ao lado deste arquivo. O app escolhe os valores por CSS no canvas do jogo
# (--nfs-image, 14 numeros), sem script e na hora; sem a linha, nada roda. Tudo dentro do escopo de erro do ClearAlpha:
# se falhar, o quadro sai sem efeito e o alfa continua.
AQUI = pathlib.Path(__file__).parent
CRLF = chr(13) + chr(10)
IMAGEM_WGSL = (AQUI / "nfs-imagem.wgsl").read_text(encoding="utf-8").replace(CRLF, chr(10))
PARTES = {}
for bloco in (AQUI / "nfs-imagem.inc").read_text(encoding="utf-8").replace(CRLF, chr(10)).split("//@@ ")[1:]:
    nome, _, corpo = bloco.partition("\n")
    PARTES[nome.strip()] = corpo
assert ')NFS"' not in IMAGEM_WGSL
CLEARER_H = '#include "third_party/blink/renderer/platform/graphics/gpu/webgpu_texture_alpha_clearer.h"\n\n'
# Arquivos que tinham a versao antiga (so FXAA, ligada por NfsAntiAlias): voltam ao original antes de receber a nova.
VERSAO_ANTIGA = {
    "../third_party/blink/renderer/platform/graphics/gpu/webgpu_texture_alpha_clearer.h": "wgpu::RenderPipeline fxaa_pipeline_",
    "../third_party/blink/renderer/platform/graphics/gpu/webgpu_texture_alpha_clearer.cc": "kNfsAntiAlias",
}
CORRECOES += [
    ("../third_party/blink/renderer/platform/graphics/gpu/webgpu_texture_alpha_clearer.h", [
        ("#include <dawn/webgpu.h>\n", "#include <dawn/webgpu.h>\n\n#include <array>\n#include <string>\n"),
        ("  void ClearAlpha(const wgpu::Texture& texture);\n", PARTES["h-publico"]),
        ("  wgpu::RenderPipeline alpha_to_one_pipeline_ = nullptr;\n", PARTES["h-privado"]),
    ]),
    ("../third_party/blink/renderer/platform/graphics/gpu/webgpu_texture_alpha_clearer.cc", [
        (CLEARER_H + "namespace blink {\n",
         CLEARER_H + "#include <string_view>\n#include <vector>\n\n"
         '#include "base/strings/string_number_conversions.h"\n#include "base/strings/string_split.h"\n\n'
         "namespace blink {\n\nnamespace {\n\n"
         "// NFS: efeitos do pacote de imagem do NFS Launcher (nfs-imagem.wgsl).\n"
         'constexpr char kNfsImageShader[] = R"NFS(' + IMAGEM_WGSL + ')NFS";\n\n'
         "}  // namespace\n"),
        ("void WebGPUTextureAlphaClearer::ClearAlpha(const wgpu::Texture& texture) {\n", PARTES["cc-funcoes"]),
        ("  wgpu::TextureView attachment_view = texture.CreateView();\n",
         "  wgpu::TextureView attachment_view = texture.CreateView();\n"
         "  NfsImage(texture, attachment_view);\n"),
    ]),
    ("../third_party/blink/renderer/modules/webgpu/gpu_canvas_context.cc", [
        ('#include "third_party/blink/renderer/core/offscreencanvas/offscreen_canvas.h"\n',
         '#include "third_party/blink/renderer/core/offscreencanvas/offscreen_canvas.h"\n'
         '#include "third_party/blink/renderer/core/css/css_variable_data.h"\n'
         '#include "third_party/blink/renderer/core/html/canvas/html_canvas_element.h"\n'
         '#include "third_party/blink/renderer/core/style/computed_style.h"\n'
         '#include "third_party/blink/renderer/platform/wtf/std_lib_extras.h"\n'
         '#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"\n'),
        ("  mailbox_texture->SetAlphaClearer(alpha_clearer_);\n", PARTES["canvas"]),
    ]),
]

# Windows 11 sem aviso decide sozinho economizar energia (EcoQoS) no processo sem janela: em Intel com nucleos de
# economia e em notebook, o jogo pode ir para o nucleo lento. Jogo na frente e processo grafico: sempre HighQoS.
CORRECOES += [
    ("../base/process/process_win.cc", [
        ("                                   ? win::ProcessPowerState::kUnset\n",
         "                                   ? win::ProcessPowerState::kDisabled  // NFS: HighQoS\n"),
    ]),
    ("../content/gpu/gpu_main.cc", [
        ("      base::GetCurrentProcessHandle(), base::win::ProcessPowerState::kDisabled);\n\n  // COM",
         "      base::GetCurrentProcessHandle(), base::win::ProcessPowerState::kDisabled);\n"
         "  // NFS: processo grafico nunca em modo de economia (EcoQoS).\n"
         "  base::win::SetProcessEcoQoSState(base::GetCurrentProcessHandle(),\n"
         "                                   base::win::ProcessPowerState::kDisabled);\n\n  // COM"),
    ]),
]


def main():
    for nome, marca in VERSAO_ANTIGA.items():
        caminho = (ROOT / nome).resolve()
        if marca in caminho.read_text(encoding="utf-8"):
            subprocess.run(["git", "checkout", "--", str(caminho)], cwd=caminho.parent, check=True)
            print(f"voltou ao original: {nome}")
    for nome, trocas in CORRECOES:
        caminho = ROOT / nome
        with open(caminho, encoding="utf-8", newline="") as f:
            texto = f.read()
        fim = "\r\n" if "\r\n" in texto else "\n"
        novo = texto
        for antes, depois in trocas:
            antes, depois = antes.replace("\n", fim), depois.replace("\n", fim)
            if depois in novo:
                continue
            if novo.count(antes) != 1:
                sys.exit(f"Trecho nao encontrado em {nome}: {antes!r}")
            novo = novo.replace(antes, depois)
        if novo != texto:
            with open(caminho, "w", encoding="utf-8", newline="") as f:
                f.write(novo)
            print(f"corrigido: {nome}")
        else:
            print(f"ja estava: {nome}")


main()
