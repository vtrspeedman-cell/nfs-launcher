# Relatos do NFS Launcher

O botão "Reportar problema" do app manda o relato para este Worker, que abre uma issue no GitHub. Nada fica guardado no Worker.

1. GitHub: criar o repositório dos relatos (privado) e um token fine-grained só para ele, com permissão "Issues: Read and write".
2. Cloudflare (conta grátis): Workers & Pages > Create > Worker, nome `nfs-relatos`, colar `worker.js` e publicar.
3. No Worker, Settings > Variables and Secrets: `GITHUB_TOKEN` (Secret, o token) e `REPO` (texto, `dono/nome` do repositório).
4. O endereço fica `https://nfs-relatos.<sua-conta>.workers.dev/relato`; ele vai em `RELAY_URL` de `pc/src/main/report.js`.
