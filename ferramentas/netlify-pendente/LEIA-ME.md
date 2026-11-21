# Mudanças que estão só no site da Cloudflare (para levar à Netlify um dia)

O último deploy feito na Netlify (`claude/beautiful-ritchie-deumqg`) foi o do commit `7cd17a9` (13/11);
depois disso os créditos acabaram. Os commits `847e61f` e `3eef3ff` estão na branch da Netlify, mas
nunca foram publicados lá. O resto da tabela existe só na branch `cloudflare-pages`.

| Data | Commit / arquivo | O que é | Leva para a Netlify? |
|---|---|---|---|
| 13/11 | `847e61f`, `3eef3ff` | Lei seca: várias leis por questão, artigos por assunto, destaque, LC 116, Lei 8.429, Lei 14.133, assuntos fracos | Já estão na branch; falta só um deploy |
| 14/11 | `454963f` | Anotações na Lei seca (usa a função `functions/api/lei-anotacoes.js` e o banco D1 da Cloudflare) | **Não sem adaptar**: a Netlify não tem D1 |
| 16/11 | `127ddfe` | Sublinhado ⟪ ⟫ das questões de Português | Sim |
| 21/11 | `2026-11-21-fila-pular-pincel.patch` | Fila de Matemática/Estatística/RL, ordem de Civil/Empresarial, ⏭ Pular sem loop, grifo do pincel preso ao texto | Sim (só `js/app.js`, `js/variante.js`, `index.html`, `sw.js`) |

## Como aplicar na Netlify

1. Fazer a Netlify ficar igual à Cloudflare nos arquivos do site (`index.html`, `js/`, `css/`, `leis/`),
   **sem** levar `functions/`, `_headers` nem o leitor de anotações, que dependem da Cloudflare.
   O jeito mais seguro é copiar esses arquivos da branch `cloudflare-pages` e tirar a linha
   `<script src="js/lei-anotacoes.js">` do `index.html`.
2. Na ordem da tabela, o patch de 21/11 entra por cima (`git apply ...patch`); se o contexto não bater,
   aplicar à mão: as mudanças estão comentadas no código com "(21/11)".
3. Subir o número do cache em `sw.js` (`questia-vNN`) acima do que estiver no ar.
4. Publicar só com crédito disponível na Netlify e com autorização do Anderson.
