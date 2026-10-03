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
```

Os scripts são clássicos (não módulos) e compartilham escopo global, por isso a ordem em `index.html` importa.

## Rodar localmente

Abra `index.html` no navegador, ou sirva a pasta: `python3 -m http.server`.
