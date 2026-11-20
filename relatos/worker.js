// Intermediário dos relatos do NFS Launcher (Cloudflare Workers, plano grátis).
// Recebe o relato do app e abre uma issue no GitHub. Não guarda nada: o token fica só como segredo do Worker.
// Segredos/variáveis (Settings > Variables): GITHUB_TOKEN (fine-grained, só Issues: read/write do repositório) e REPO ("dono/nome").

const MAX = { texto: 4000, diag: 60000, log: 190000, corpo: 300000 };
const PEDACO = 60000;              // limite de uma issue/comentário é 65.536
const POR_HORA = 5;                // por IP, melhor esforço (memória de cada instância)
const vistos = new Map();

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function limitar(ip) {
  const agora = Date.now();
  const lista = (vistos.get(ip) || []).filter((t) => agora - t < 3600e3);
  if (lista.length >= POR_HORA) return false;
  lista.push(agora);
  vistos.set(ip, lista);
  if (vistos.size > 5000) vistos.clear();
  return true;
}

// Texto livre do jogador: sem marcar ninguém (@) e sem HTML.
const limpo = (s, n) => String(s || '').slice(0, n).replace(/@/g, '@​').replace(/</g, '&lt;');
// Bloco de código: o conteúdo não fecha o bloco.
const bloco = (s) => '~~~~text\n' + String(s).replace(/~{4,}/g, '~~~') + '\n~~~~';

async function gh(env, caminho, corpo) {
  const r = await fetch(`https://api.github.com/repos/${env.REPO}${caminho}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
      'user-agent': 'nfs-relatos', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json',
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/relato') return json({ ok: false }, 404);
    if (req.headers.get('x-nfs-launcher') !== '1') return json({ ok: false }, 403);
    const tam = Number(req.headers.get('content-length') || 0);
    if (!tam || tam > MAX.corpo) return json({ ok: false, erro: 'grande' }, 413);
    if (!limitar(req.headers.get('cf-connecting-ip') || '?')) return json({ ok: false, erro: 'limite' }, 429);

    let d;
    try { d = await req.json(); } catch { return json({ ok: false }, 400); }
    const texto = limpo(d.texto, MAX.texto).trim();
    const log = String(d.log || '').slice(0, MAX.log);
    const diag = String(d.diag || '').slice(0, MAX.diag);
    if (texto.length < 5 && !log) return json({ ok: false, erro: 'vazio' }, 400);
    const app = limpo(d.app, 40), jogo = limpo(d.jogo, 40), origem = limpo(d.origem, 40);

    const titulo = `[${app || '?'}] ${jogo || '?'}: ${(texto || 'erro no jogo').split('\n')[0].slice(0, 80)}`;
    let corpo = `**App:** ${app}\n**Jogo:** ${jogo}\n**Origem:** ${origem || 'botão'}\n\n${texto || '_(sem texto)_'}\n`;
    const erros = limpo(d.erros, 6000);
    if (erros) corpo += `\n### Linhas de erro do log\n${bloco(erros)}\n`;
    if (diag && corpo.length + diag.length < PEDACO) corpo += `\n### Diagnóstico\n${bloco(diag)}\n`;

    try {
      const issue = await gh(env, '/issues', { title: titulo, body: corpo });
      const extras = [];
      if (diag && !corpo.includes('### Diagnóstico')) extras.push(['Diagnóstico', diag]);
      for (let i = 0, n = 1; i < log.length; i += PEDACO, n++) extras.push([`Log do jogo (parte ${n})`, log.slice(i, i + PEDACO)]);
      for (const [nome, s] of extras) await gh(env, `/issues/${issue.number}/comments`, { body: `### ${nome}\n${bloco(s)}` });
      return json({ ok: true, numero: issue.number });
    } catch {
      return json({ ok: false, erro: 'github' }, 502);
    }
  },
};
