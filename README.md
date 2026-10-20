# QuestIA — Gerador de Questões Fiscais

App de estudo para concursos fiscais que roda inteiro no navegador (HTML + JS, sem build).

- Gera questões a partir de texto/PDF com a API da Anthropic
- Importa cadernos do TecConcursos (.md, .txt, .docx)
- Revisão espaçada (SM-2 adaptado), meta por edital, estatísticas, dashboard, flashcards
- Dados guardados localmente (IndexedDB + localStorage) — use **Backup → Baixar backup** com frequência

## Estrutura

```
index.html                  marcação das telas
css/style.css               estilos (tema claro/escuro)
js/app.js                   núcleo: armazenamento, SM-2, fila, importação, geração, estatísticas
js/calculadora-revisao.js   calculadora, flashcards de revisão, aviso de reta final, barra da chave
js/dashboard.js             dashboard por disciplina/assunto
js/formulas.js              renderização de fórmulas LaTeX (KaTeX)
netlify/functions/claude.mjs  guarda a chave da API no servidor (opcional)
ferramentas/exportar-tudo.html  gera backup completo a partir de uma instalação antiga
versao-antiga/              versão anterior, em arquivo único
```

Os scripts são clássicos (não módulos) e compartilham escopo global, por isso a ordem em `index.html` importa.

## Rodar localmente

Abra `index.html` no navegador, ou sirva a pasta: `python3 -m http.server`.

## Backup

**Backup → Baixar backup** gera um .json com tudo: questões, histórico por dia, tempo
estudado, registro de respostas, resumos, flashcards, ranking e configurações (a chave
da API fica de fora). Para levar os dados a outro aparelho ou endereço, importe esse
arquivo com **Mesclar**.

Backups feitos antes desta versão levam só as questões. Para recuperar o histórico de
uma instalação antiga, abra `ferramentas/exportar-tudo.html` no mesmo navegador em que
ela era usada e importe o arquivo que ele gerar.
