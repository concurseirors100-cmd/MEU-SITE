// Intermediário entre o QuestIA e a API da Anthropic.
//
// A chave fica na variável de ambiente ANTHROPIC_API_KEY do Netlify e nunca chega
// ao navegador. Para o link público do site não virar uma torneira aberta dos seus
// créditos, toda chamada precisa trazer a senha definida em QUESTIA_SENHA.
// Sem QUESTIA_SENHA configurada, a função se recusa a funcionar.

const LIMITE_TOKENS = 16000;
const CAMPOS_PERMITIDOS = ['model', 'max_tokens', 'system', 'messages', 'tools', 'tool_choice', 'temperature'];

const json = (status, mensagem) =>
  new Response(JSON.stringify({ error: { message: mensagem } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Comparação em tempo constante, para a senha não poder ser descoberta medindo o tempo de resposta.
function senhaConfere(recebida, esperada) {
  const a = new TextEncoder().encode(recebida || '');
  const b = new TextEncoder().encode(esperada);
  let dif = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) dif |= (a[i] ?? 0) ^ b[i];
  return dif === 0;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, 'Use POST.');

  // trim: espaço ou quebra de linha colados junto com o valor no painel do Netlify
  // faziam a chave ser recusada pela Anthropic e a senha nunca conferir.
  const chave = (process.env.ANTHROPIC_API_KEY || '').trim();
  const senha = (process.env.QUESTIA_SENHA || '').trim();
  if (!chave || !senha) {
    return json(500, 'Servidor sem configuração: defina ANTHROPIC_API_KEY e QUESTIA_SENHA nas variáveis de ambiente do Netlify.');
  }
  if (!senhaConfere((req.headers.get('x-questia-senha') || '').trim(), senha)) {
    return json(401, 'Senha do servidor incorreta. Confira o campo da chave no topo do QuestIA.');
  }

  let pedido;
  try {
    pedido = await req.json();
  } catch {
    return json(400, 'Corpo da requisição inválido.');
  }

  // Repassa só o que o app usa, com teto de tokens e só modelos Claude.
  const corpo = {};
  for (const campo of CAMPOS_PERMITIDOS) if (pedido[campo] !== undefined) corpo[campo] = pedido[campo];
  if (typeof corpo.model !== 'string' || !corpo.model.startsWith('claude-')) return json(400, 'Modelo inválido.');
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

  if (resposta.status === 401) {
    // Impressão digital sem revelar a chave: tamanho, prefixo e os 4 últimos caracteres
    // (o console da Anthropic mostra esse mesmo final), para saber qual chave está no ar.
    const digital = `tem ${chave.length} caracteres, ${chave.startsWith('sk-ant-') ? 'começa com sk-ant-' : 'NÃO começa com sk-ant-'} e termina em "…${chave.slice(-4)}"`;
    return json(502, `A Anthropic recusou a chave guardada no Netlify (ANTHROPIC_API_KEY). A chave que o servidor está usando ${digital}. Compare com a lista de chaves no console da Anthropic.`);
  }
  return new Response(await resposta.text(), {
    status: resposta.status,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/api/claude' };
