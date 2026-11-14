// Cloudflare Pages Function equivalente a netlify/functions/claude.mjs.
// Mantém a mesma rota pública (/api/claude), os mesmos segredos e as mesmas
// validações. Este arquivo existe apenas na branch cloudflare-pages.

const LIMITE_TOKENS = 16000;
const CAMPOS_PERMITIDOS = ['model', 'max_tokens', 'system', 'messages', 'tools', 'tool_choice', 'temperature'];

const json = (status, mensagem) =>
  new Response(JSON.stringify({ error: { message: mensagem } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Comparação em tempo constante, equivalente à função usada no Netlify.
function senhaConfere(recebida, esperada) {
  const a = new TextEncoder().encode(recebida || '');
  const b = new TextEncoder().encode(esperada);
  let dif = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) dif |= (a[i] ?? 0) ^ b[i];
  return dif === 0;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, 'Use POST.');

  const chave = (env.ANTHROPIC_API_KEY || '').trim();
  const senha = (env.QUESTIA_SENHA || '').trim();

  if (!chave || !senha) {
    return json(500, 'Servidor sem configuração: defina ANTHROPIC_API_KEY e QUESTIA_SENHA nas variáveis de ambiente do Cloudflare Pages.');
  }

  if (!senhaConfere((request.headers.get('x-questia-senha') || '').trim(), senha)) {
    return json(401, 'Senha do servidor incorreta. Confira o campo da chave no topo do QuestIA.');
  }

  let pedido;
  try {
    pedido = await request.json();
  } catch {
    return json(400, 'Corpo da requisição inválido.');
  }

  const corpo = {};
  for (const campo of CAMPOS_PERMITIDOS) {
    if (pedido[campo] !== undefined) corpo[campo] = pedido[campo];
  }

  if (typeof corpo.model !== 'string' || !corpo.model.startsWith('claude-')) {
    return json(400, 'Modelo inválido.');
  }

  corpo.max_tokens = Math.min(Number(corpo.max_tokens) || 1024, LIMITE_TOKENS);

  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(corpo),
  });

  let texto;
  try {
    texto = await resposta.text();
  } catch {
    return json(502, 'Não foi possível ler a resposta da API da Anthropic.');
  }

  // Nunca devolver detalhes da chave armazenada no servidor ao navegador.
  // Mantém status e corpo originais para o frontend tratar erros da Anthropic.
  return new Response(texto, {
    status: resposta.status,
    headers: { 'Content-Type': resposta.headers.get('Content-Type') || 'application/json' },
  });
}
