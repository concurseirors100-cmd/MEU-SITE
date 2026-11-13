// ===== LEI SECA (13/11, pedido do Anderson) =====
// Motivo: 60 questões em 2 horas não deixam tempo para ler a lei, e procurar à mão
// os artigos errados é atrito. Esta aba junta sozinha os artigos em que houve erro
// ou "Difícil" e mostra o texto do artigo na hora — SEM relógio, sem ciclo e sem
// meta: é uma seção para navegar quando quiser.
//
//  1) Meus erros: questões com erro ou "Difícil" (e itens da Lupa errados) agrupados
//     por artigo ("CTN, art. 138"), usando a mesma detecção da revisão com variante
//     (varDispDe). Sem artigo identificado, agrupa por assunto e mostra o comentário.
//  2) Textos: as leis mais cobradas já vêm com o site (pasta leis/, geradas do texto
//     do Planalto por ferramentas/gerar-leis.js) e são baixadas só quando um card
//     daquela lei é aberto. Outras leis (as locais, quando sair o edital) podem ser
//     coladas na aba "Textos das leis"; a colada vence a que vem com o site.
//     Nada é escrito de memória: sem texto, o card mostra só o material das
//     próprias questões e o link da lei.
//  (A visão "Lei inteira" foi retirada a pedido: o foco são os artigos errados.)
//
// Não mexe no SM-2, na fila, nos contadores nem no registro de respostas. Guarda só:
//  - marcas de leitura (localStorage 'questia_leiseca_marcas' → entram no backup);
//  - textos colados à mão (IndexedDB, meta 'leiseca_textos' → entram no backup).

const LS_MARCAS_KEY='questia_leiseca_marcas';
const LS_LIMITE_LISTA=60;
// Chaves iguais às que varLeiDoContexto devolve, para o texto casar com a detecção.
const LS_LEIS=[
  {k:'CTN',nome:'CTN (Lei 5.172/1966)',url:'https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm'},
  {k:'CF/88',nome:'Constituição Federal',url:'https://www.planalto.gov.br/ccivil_03/constituicao/ConstituicaoCompilado.htm'},
  {k:'LC 87/1996',nome:'LC 87/1996 (Lei Kandir)',url:'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm'},
  {k:'LC 214/2025',nome:'LC 214/2025 (IBS/CBS/IS)',url:'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm'},
  {k:'LC 227/2026',nome:'LC 227/2026 (Comitê Gestor, ITCMD)',url:'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm'},
  {k:'EC 132/2023',nome:'EC 132/2023',url:'https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm'},
  {k:'Lei 6.830/1980',nome:'Lei 6.830/1980 (execução fiscal)',url:'https://www.planalto.gov.br/ccivil_03/leis/l6830.htm'},
  {k:'ADCT',nome:'ADCT',url:'https://www.planalto.gov.br/ccivil_03/constituicao/ConstituicaoCompilado.htm'},
  {k:'LC 116/2003',nome:'LC 116/2003 (ISS)',url:'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm'},
  {k:'LC 24/1975',nome:'LC 24/1975 (benefícios de ICMS)',url:''},
  {k:'LC 123/2006',nome:'LC 123/2006 (Simples Nacional)',url:''},
  {k:'Lei 8.429/1992',nome:'Lei 8.429/1992 (improbidade)',url:'https://www.planalto.gov.br/ccivil_03/leis/l8429.htm'},
  {k:'Lei 14.133/2021',nome:'Lei 14.133/2021 (licitações)',url:'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/L14133.htm'},
  {k:'Lei 9.784/1999',nome:'Lei 9.784/1999 (processo administrativo)',url:''},
  {k:'Lei 12.527/2011',nome:'Lei 12.527/2011 (acesso à informação)',url:''}
];
// ---------- quais artigos uma questão cita (14/11) ----------
// A detecção da revisão com variante (varDispDe) fica com UM artigo por questão e
// trata como CTN todo "art. N" de Direito Tributário sem lei por perto. Medido no
// banco: 74 das 103 questões erradas de Tributário citam mais de um artigo, e quase
// metade das citações não tinha a lei ao lado (muitas eram da Constituição). Aqui a
// Lei seca usa uma leitura própria: TODOS os artigos citados no comentário, cada um
// com a lei mais provável. A varDispDe não muda (a fila e as variantes dependem dela).
const LS_NUM='(?:n[ºo°.]*\\s*)?';
const LS_RX_LEIS=[
  [/\bCTN\b|c[óo]digo tribut[áa]rio(?! municipal| estadual| do munic| do estado)|5\.172/i,'CTN'],
  [/\bADCT\b|disposi[çc][õo]es constitucionais transit/i,'ADCT'],
  [new RegExp('(?:\\bLC|complementar)\\s*'+LS_NUM+'214\\b|214\\/2025','i'),'LC 214/2025'],
  [new RegExp('(?:\\bLC|complementar)\\s*'+LS_NUM+'227\\b|227\\/2026','i'),'LC 227/2026'],
  [new RegExp('(?:\\bEC|emenda constitucional)\\s*'+LS_NUM+'132\\b','i'),'EC 132/2023'],
  [/\bCF\b|CF\/88|\bCRFB\b|constitui[çc][ãa]o(?! estadual| do estado)/i,'CF/88'],
  [new RegExp('(?:\\bLC|complementar)\\s*'+LS_NUM+'87\\b|kandir','i'),'LC 87/1996'],
  [/6\.830|\bLEF\b/i,'Lei 6.830/1980'],
  [new RegExp('(?:\\bLC|complementar)\\s*'+LS_NUM+'116\\b','i'),'LC 116/2003'],
  [new RegExp('(?:\\bLC|complementar)\\s*'+LS_NUM+'24\\b','i'),'LC 24/1975'],
  [new RegExp('(?:\\bLC|complementar)\\s*'+LS_NUM+'123\\b','i'),'LC 123/2006'],
  [/8\.429|\bLIA\b/i,'Lei 8.429/1992'],
  [/14\.133/,'Lei 14.133/2021'],
  [/9\.784/,'Lei 9.784/1999'],
  [/12\.527|\bLAI\b/,'Lei 12.527/2011']
];
const LS_PADRAO_MAT=[[/^Direito Tributário$/,'CTN'],[/^Reforma Tributária$/,'LC 214/2025'],[/^Direito Constitucional \(/,'CF/88']];
// primeira (ou última) lei citada num trecho
function lsLeiEm(t,ultima){
  let best=null,pos=ultima?-1:1e9;
  for(const [rx,k] of LS_RX_LEIS){
    if(ultima){const g=new RegExp(rx.source,rx.flags.includes('g')?rx.flags:rx.flags+'g');let m;while((m=g.exec(t))){if(m.index>pos){pos=m.index;best=k;}if(!m[0].length)g.lastIndex++;}}
    else{const m=rx.exec(t);if(m&&m.index<pos){pos=m.index;best=k;}}
  }
  return best;
}
const lsArtCache=new Map();
// Devolve [{k:'CF/88, art. 150',p:peso}], do mais citado para o menos, no máximo `max`.
function lsArtigosDe(q,max){
  if(!q)return[];
  let lista=lsArtCache.get(q.id);
  if(!lista){
    const limpa=x=>String(x||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ');
    const mat=(q.materia||'').trim();
    const pad=(LS_PADRAO_MAT.find(([rx])=>rx.test(mat))||[])[1]||null;
    const cont=new Map();let ordem=0;
    const ler=(texto,peso)=>{
      const t=limpa(texto);if(!t.trim())return;
      const rx=/\bart(?:igo)?s?\.?\s*(\d{1,3}(?:-[A-Z])?)\s*(?:º|°|o\b)?((?:\s*(?:,|e|a)\s+(?:o\s+)?\d{1,3}(?:-[A-Z])?\s*(?:º|°)?(?![\d.]*\s*(?:%|de \d|dias|anos|meses)))*)/gi;
      let m,ultimaLei=null;const leiDoNum=new Map();
      while((m=rx.exec(t))){
        const fim=m.index+m[0].length;
        const depois=t.slice(fim,fim+110),antes=t.slice(Math.max(0,m.index-70),m.index);
        // 1) "art. 150, VI, a, da CF": lei logo depois, antes de outro artigo ou do fim da frase
        const perto=depois.split(/\bart(?:igo)?s?\.?\s*\d|[.;]\s+[A-ZÀ-Ú]|\n/)[0];
        let lei=/^[\s,;§º°\dIVXLa-z"“”'()–-]{0,45}?\b(?:d[aoe]s?|na|no|em seu|todos? d[ao])\b/i.test(perto)?lsLeiEm(perto.slice(0,90)):null;
        // 2) "CTN, art. 138" / "a CF, em seu art. 150": lei logo antes
        if(!lei){const a=antes.split(/[.;]\s+[A-ZÀ-Ú]|\n/).pop();lei=lsLeiEm(a.slice(-45),true);}
        // 3) a lei mais próxima na mesma frase
        if(!lei)lei=lsLeiEm(perto)||lsLeiEm(antes.split(/[.;]\s+[A-ZÀ-Ú]|\n/).pop(),true);
        const explicita=!!lei;
        // 4) o mesmo número já veio com lei neste texto ("art. 150 da CF ... art. 150, § 2º")
        if(!lei)lei=leiDoNum.get(m[1])||null;
        // 5) a última lei citada no texto; 6) a da matéria
        if(!lei)lei=ultimaLei||lsLeiEm(t.slice(0,m.index),true)||pad;
        if(!lei)continue;
        ultimaLei=lei;if(explicita)leiDoNum.set(m[1],lei);
        const nums=[m[1]];(m[2].match(/\d{1,3}(?:-[A-Z])?/g)||[]).forEach(n=>nums.push(n));
        // parágrafo/inciso citado junto ("art. 150, VI, a" · "§ 2º do art. 150"): vira destaque no texto
        const marcas=[];
        if(nums.length===1){
          const cab=perto.split(/\b(?:d[aoe]s?|na|no)\s+(?:CTN|CF|Constitui|Lei|LC|C[óo]digo|ADCT|EC|Emenda)/i)[0].slice(0,48);
          const iPar=cab.search(/§|par[áa]grafo/i);
          let r;const rxR=/(?:^|[,\s(])([IVXL]{1,7})(?=[,\s.;)]|$)/g;
          while((r=rxR.exec(iPar<0?cab:cab.slice(0,iPar))))marcas.push('i'+r[1]);
          const rxP=/§+\s*(\d{1,2})/g;while((r=rxP.exec(cab)))marcas.push('§'+r[1]);
          if(/par[áa]grafo [úu]nico/i.test(cab))marcas.push('pu');
          const at=antes.match(/(?:§\s*(\d{1,2})\s*[ºo°]?|inciso\s+([IVXL]{1,7})|(par[áa]grafo [úu]nico))[^.;]{0,22}$/i);
          if(at)marcas.push(at[1]?'§'+at[1]:at[2]?'i'+at[2].toUpperCase():'pu');
        }
        nums.forEach(n=>{const k=lei+', art. '+n.toUpperCase();const o=cont.get(k)||{k,p:0,o:ordem++,m:new Set()};o.p+=peso;marcas.forEach(x=>o.m.add(x));cont.set(k,o);});
      }
    };
    ler(q.comentario,2);ler(q.gabTexto,1);ler(q.questao,1);ler((q.alternativas||[]).join(' \n '),1);
    lista=[...cont.values()].sort((a,b)=>(b.p-a.p)||(a.o-b.o));
    lsArtCache.set(q.id,lista);
  }
  return max?lista.slice(0,max):lista;
}
const LS_MAX_ART_Q=4;      // artigos por questão que viram card
// Para um assunto sem artigo nas questões erradas: os artigos mais citados por TODAS
// as questões daquele assunto no banco (o recorte sai do próprio material).
let lsPorAssunto=null;   // 'matéria§subtema' -> questões (refeito a cada coleta)
function lsIndexarAssuntos(){
  lsPorAssunto=new Map();
  questions.forEach(q=>{const k=((q.materia||'—').trim()||'—')+'§'+((q.subtema||'—').trim()||'—');if(!lsPorAssunto.has(k))lsPorAssunto.set(k,[]);lsPorAssunto.get(k).push(q);});
}
// Assunto fraco (14/11, pedido do Anderson): acerto abaixo de LS_FRACO_PCT com pelo
// menos LS_FRACO_MIN respostas no site. Ganha card próprio com os artigos mais
// citados do assunto, mesmo que cada questão errada já tenha o seu card de artigo.
const LS_FRACO_PCT=70, LS_FRACO_MIN=5;
function lsArtigosDoAssunto(mat,sub){
  const cont=new Map();let n=0;
  if(!lsPorAssunto)lsIndexarAssuntos();
  (lsPorAssunto.get(mat+'§'+sub)||[]).forEach(q=>{
    n++;
    lsArtigosDe(q,LS_MAX_ART_Q).forEach(a=>{const o=cont.get(a.k)||{c:0,m:new Set()};o.c++;a.m.forEach(x=>o.m.add(x));cont.set(a.k,o);});
  });
  const arts=[...cont.entries()].filter(([k,o])=>o.c>=2).sort((a,b)=>b[1].c-a[1].c).slice(0,6).map(([k,o])=>Object.assign({k,c:o.c,m:o.m},lsSepararChave(k)));
  return{n,arts};
}
const lsLeiInfo=k=>LS_LEIS.find(l=>l.k===k)||{k,nome:k,url:''};

let lsTextos={},lsTextosOk=false;
let LSV={aba:'erros',filtro:'pend',mat:'',busca:'',mais:false};
// Leis que vêm com o site: leis/indice.json lista {chave:{arquivo,n,em,fonte}}.
let lsIndice=null,lsEmbutidas={},lsBaixando={};
let lsGrupos=[],lsPorChave=new Map();

// ---------- armazenamento ----------
async function lsCarregarTextos(forcar){
  if(lsTextosOk&&!forcar)return;
  try{
    if(typeof idbOk!=='undefined'&&idbOk)lsTextos=(await idbLer(ST_META,'leiseca_textos'))||{};
    else lsTextos=JSON.parse(localStorage.getItem('questia_leiseca_textos')||'{}');
    if(!lsTextos||typeof lsTextos!=='object'||Array.isArray(lsTextos))lsTextos={};
  }catch(e){lsTextos={};}
  lsTextosOk=true;
}
async function lsSalvarTextos(){
  try{
    if(typeof idbOk!=='undefined'&&idbOk)await idbGravar(ST_META,lsTextos,'leiseca_textos');
    else localStorage.setItem('questia_leiseca_textos',JSON.stringify(lsTextos));
    return true;
  }catch(e){notify('❌ Falha ao salvar o texto da lei: '+(e&&e.message||e),'err');return false;}
}
async function lsCarregarIndice(){
  if(lsIndice)return lsIndice;
  try{const r=await fetch('leis/indice.json');lsIndice=r.ok?await r.json():{};}catch(e){lsIndice={};}
  if(!lsIndice||typeof lsIndice!=='object')lsIndice={};
  return lsIndice;
}
function lsTemTexto(k){return !!(lsTextos[k]||(lsIndice&&lsIndice[k]));}
// Devolve o texto da lei (colado à mão ou o que vem com o site), baixando se preciso.
async function lsGarantirLei(k){
  if(lsTextos[k])return lsTextos[k];
  if(lsEmbutidas[k])return lsEmbutidas[k];
  const i=lsIndice&&lsIndice[k];if(!i)return null;
  if(!lsBaixando[k])lsBaixando[k]=fetch('leis/'+i.arquivo).then(r=>r.ok?r.json():null).then(d=>{if(d&&d.arts){lsEmbutidas[k]=d;}return lsEmbutidas[k]||null;}).catch(()=>null).finally(()=>{delete lsBaixando[k];});
  return lsBaixando[k];
}
function lsLeiCarregada(k){return lsTextos[k]||lsEmbutidas[k]||null;}
// Leis de que um artigo pode precisar. A EC 132 quase sempre é citada pelos artigos
// que ela pôs na Constituição (156-A, 149-B...) ou no ADCT; e "CF, art. 125" numa
// questão de reforma costuma ser o art. 125 do ADCT, que a detecção não distingue.
function lsLeisDoGrupo(g){
  if(g.lei==='EC 132/2023')return['EC 132/2023','CF/88','ADCT'];
  if(g.lei==='CF/88')return['CF/88','ADCT'];
  if(g.lei==='ADCT')return['ADCT'];
  return[g.lei];
}
function lsMarcas(){try{const v=JSON.parse(localStorage.getItem(LS_MARCAS_KEY)||'{}');return v&&typeof v==='object'?v:{};}catch(e){return{};}}
function lsSalvarMarcas(m){try{localStorage.setItem(LS_MARCAS_KEY,JSON.stringify(m));}catch(e){notify('❌ Não consegui salvar a marcação','err');}}

// ---------- separar a lei em artigos ----------
// Entrada: texto corrido da página da lei. Saída: {arts:{'138':'Art. 138. ...'},ordem:[...]}.
// Um artigo começa em linha iniciada por "Art." e termina no próximo artigo, num
// título de divisão (LIVRO/TÍTULO/CAPÍTULO/SEÇÃO) ou no fecho da lei. Cuidados:
//  - artigo de OUTRA lei citado entre aspas (“Art. 12. ...” até o ”) fica dentro do
//    artigo que o cita, mesmo quando as linhas seguintes da citação não trazem aspas;
//  - os artigos da própria lei só crescem: o que quebra a ordem é citação sem aspas;
//  - trecho riscado (redação antiga) precisa ser tirado ANTES: no Planalto ele vem
//    em <strike> ou em span com text-decoration:line-through, e some no texto colado;
//  - na Constituição, o ADCT sai separado (adct), para o art. 125 do ADCT não
//    tomar o lugar do art. 125 do corpo.
const LS_RX_ART=/^Art\.?\s*(\d{1,2}\.\d{3}|\d{1,4})\s*(?:º|°|o(?=[\s.\-–]))?(?:-([A-Z])(?![A-Za-zÀ-ú]))?/;
const LS_RX_DIV=/^(LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O|PARTE)\b/;
const LS_RX_FIM=/^(Bras[íi]lia,\s|Este texto n[ãa]o substitui|ANEXO\b|Senado Federal, em|Rio de Janeiro,\s)/;
const LS_RX_NOTA=/\s*\((?:Reda[cç][aã]o dada|Inclu[ií]d[oa]|Acrescid[oa]|Vide|Regulamento|Vig[eê]ncia|Produ[cç][aã]o de efeitos?|Renumerad[oa]|Promulga[cç][aã]o)[^()]*\)/gi;
// fecho de citação: aspas no fim da linha, logo depois de pontuação (." ;" )" e o
// (NR) opcional). Aspas depois de letra (alínea "b") não fecham.
const LS_RX_FECHA=/[.;:)\]]\s*[”"]\s*(?:\(NR\))?\s*[.;]?\s*$/;
const LS_RX_ADCT=/^ATO DAS DISPOSI[ÇC][ÕO]ES CONSTITUCIONAIS TRANSIT[ÓO]RIAS\s*$/;
function lsNumArt(m){return m[1].replace(/\./g,'').replace(/^0+(?=\d)/,'')+(m[2]?'-'+m[2]:'');}
// Maior sequência não decrescente: dos candidatos a artigo, quais são da própria lei.
function lsSeqPropria(v){
  const n=v.length,len=new Array(n).fill(1),ant=new Array(n).fill(-1);let fim=-1;
  for(let i=0;i<n;i++){
    for(let j=0;j<i;j++)if(v[j]<=v[i]&&len[j]+1>len[i]){len[i]=len[j]+1;ant[i]=j;}
    if(fim<0||len[i]>=len[fim])fim=i;
  }
  const fica=new Set();for(let i=fim;i>=0;i=ant[i])fica.add(i);
  return fica;
}
function lsFechaAspas(l){
  // tira do fim da linha as notas entre parênteses ("(NR)", "(Vide Lei...)") e marcas soltas
  let t=l,ant;
  do{ant=t;t=t.replace(/\s*\([^()]*\)\s*$/,'').replace(/\s*(?:Produ[cç][aã]o de efeitos?|Vig[eê]ncia)\s*$/i,'');}while(t!==ant);
  return LS_RX_FECHA.test(t);
}
function lsParseBloco(linhas){
  // 1) marca cada linha: candidata a artigo, divisão, fecho ou texto (citação conta como texto)
  const tok=[];let aspas=false;
  for(const l of linhas){
    if(!l)continue;
    if(aspas){tok.push({l,t:'txt'});if(lsFechaAspas(l)||/^\(NR\)/.test(l))aspas=false;continue;}
    if(/^[“"]/.test(l)){tok.push({l,t:'txt'});if(!lsFechaAspas(l.slice(1)))aspas=true;continue;}
    const m=l.match(LS_RX_ART);
    if(m){tok.push({l,t:'art',base:parseInt(m[1].replace(/\./g,''),10),num:lsNumArt(m)});continue;}
    if(LS_RX_FIM.test(l)){tok.push({l,t:'fim'});continue;}
    if(LS_RX_DIV.test(l)&&l===l.toUpperCase()){tok.push({l,t:'div'});continue;}
    tok.push({l,t:'txt'});
  }
  // 2) os artigos da própria lei crescem; o que quebra a ordem é citação sem aspas
  const cand=tok.filter(x=>x.t==='art'),fica=lsSeqPropria(cand.map(x=>x.base));
  let citados=0;cand.forEach((x,i)=>{if(!fica.has(i)){x.t='txt';citados++;}});
  // 3) monta os artigos. Número repetido (redação antiga sem risco no texto colado):
  //    vale a ÚLTIMA ocorrência, que é a redação mais nova.
  const arts={},ordem=[];let cur=null,buf=[],repetidos=0;
  const fechar=()=>{
    if(cur!==null){
      const t=buf.join('\n').replace(LS_RX_NOTA,'').replace(/([:.;])\s*(?:Produção de efeitos?|Vigência)$/gm,'$1').replace(/[ \t]+\n/g,'\n').replace(/ {2,}/g,' ').trim();
      if(arts[cur]===undefined)ordem.push(cur);else repetidos++;
      arts[cur]=t;
    }
    cur=null;buf=[];
  };
  for(const x of tok){
    if(x.t==='art'){fechar();cur=x.num;buf=[x.l];}
    else if(x.t==='fim'||x.t==='div')fechar();
    else if(cur!==null)buf.push(x.l);
  }
  fechar();
  return{arts,ordem,repetidos,citados};
}
function lsParseLei(txt){
  const linhas=String(txt||'').replace(/\r/g,'').replace(/ /g,' ').split('\n').map(l=>l.replace(/[ \t]+/g,' ').trim());
  const i=linhas.findIndex(l=>LS_RX_ADCT.test(l));
  const r=lsParseBloco(i>=0?linhas.slice(0,i):linhas);
  r.adct=i>=0?lsParseBloco(linhas.slice(i+1)):null;
  return r;
}
function lsDetectarLei(txt){
  const ini=String(txt||'').slice(0,1500);
  if(/CONSTITUI[ÇC][ÃA]O DA REP[ÚU]BLICA FEDERATIVA/i.test(ini))return 'CF/88';
  if(/5\.172/.test(ini))return 'CTN';
  if(/complementar\s+n[ºo°.]*\s*214/i.test(ini))return 'LC 214/2025';
  if(/complementar\s+n[ºo°.]*\s*227/i.test(ini))return 'LC 227/2026';
  if(/complementar\s+n[ºo°.]*\s*87\b/i.test(ini))return 'LC 87/1996';
  if(/emenda constitucional\s+n[ºo°.]*\s*132/i.test(ini))return 'EC 132/2023';
  if(/6\.830/.test(ini))return 'Lei 6.830/1980';
  return '';
}
async function lsImportarTexto(){
  const ta=document.getElementById('ls-imp-txt'),sel=document.getElementById('ls-imp-lei'),outro=document.getElementById('ls-imp-outra');
  const txt=(ta&&ta.value)||'';
  if(txt.trim().length<200){notify('Cole o texto da lei inteiro antes de importar','err');return;}
  let k=(sel&&sel.value)||'';
  if(k==='__outra')k=((outro&&outro.value)||'').trim();
  if(!k){notify('Escolha de qual lei é o texto','err');return;}
  const r=lsParseLei(txt);
  if(r.ordem.length<3){alert('Não encontrei artigos neste texto (procuro linhas começando por "Art.").\n\nCopie o texto da página da lei inteira e cole de novo.');return;}
  const det=lsDetectarLei(txt);
  const lin=[`• Lei: ${k}`,`• ${r.ordem.length} artigos (do art. ${r.ordem[0]} ao art. ${r.ordem[r.ordem.length-1]})`];
  if(det&&det!==k)lin.push(`• ATENÇÃO: o cabeçalho do texto parece ser de "${det}", não de "${k}"`);
  if(r.repetidos)lin.push(`• ${r.repetidos} artigo(s) com número repetido ignorado(s) — ficou a última ocorrência (redação mais nova)`);
  if(r.citados)lin.push(`• ${r.citados} artigo(s) de outras leis citados no texto ficaram dentro do artigo que os cita`);
  if(r.adct&&r.adct.ordem.length)lin.push(`• ADCT separado: ${r.adct.ordem.length} artigos, gravados como "ADCT"`);
  if(lsTextos[k])lin.push(`• Substitui o texto que você colou antes (${lsTextos[k].ordem.length} artigos, de ${lsTextos[k].em})`);
  else if(lsIndice&&lsIndice[k])lin.push(`• Passa a valer no lugar do texto que vem com o site (${lsIndice[k].n} artigos)`);
  if(!confirm('Gravar o texto da lei?\n\n'+lin.join('\n')+'\n\nConfira os números antes de confirmar.'))return;
  await lsCarregarTextos();
  lsTextos[k]={em:today(),arts:r.arts,ordem:r.ordem};
  if(r.adct&&r.adct.ordem.length)lsTextos['ADCT']={em:today(),arts:r.adct.arts,ordem:r.adct.ordem};
  if(await lsSalvarTextos()){notify(`📖 ${k}: ${r.ordem.length} artigos gravados`,'ok');if(ta)ta.value='';renderLeiSeca();}
}
function lsImportarArquivo(event){
  const input=event.target,file=input.files&&input.files[0];if(!file)return;
  const rd=new FileReader();
  rd.onload=e=>{try{input.value='';}catch(_){ }const ta=document.getElementById('ls-imp-txt');if(ta){ta.value=String(e.target.result||'');lsAoColar();notify('Arquivo carregado na caixa. Confira a lei e clique em Importar.','ok');}};
  rd.readAsText(file);
}
function lsAoColar(){
  const ta=document.getElementById('ls-imp-txt'),sel=document.getElementById('ls-imp-lei');if(!ta||!sel)return;
  const d=lsDetectarLei(ta.value);if(d&&!sel.value)sel.value=d;
  lsTrocaLeiImp();
}
function lsTrocaLeiImp(){
  const sel=document.getElementById('ls-imp-lei'),o=document.getElementById('ls-imp-outra');
  if(sel&&o)o.style.display=sel.value==='__outra'?'inline-block':'none';
}
async function lsApagarTexto(k){
  if(!lsTextos[k])return;
  if(!confirm(`Apagar o texto de "${k}" que você colou (${lsTextos[k].ordem.length} artigos)?\n\n${lsIndice&&lsIndice[k]?'Volta a valer o texto que vem com o site. ':''}Só o texto da lei sai. Marcações de leitura, questões e histórico não mudam.`))return;
  delete lsTextos[k];
  if(await lsSalvarTextos())renderLeiSeca();
}

// ---------- coleta dos erros ----------
function lsSepararChave(k){const m=String(k).match(/^(.*), art\. (\S+)$/);return m?{lei:m[1],art:m[2]}:null;}
// Itens da Lupa guardam só o dia do erro: conta como início do dia, para a leitura
// feita no mesmo dia já cobrir aquele erro.
function lsDiaTs(d){const t=Date.parse(d+'T00:00:00');return isNaN(t)?0:t;}
async function lsColetar(){
  if(typeof carregarFragmentos==='function')await carregarFragmentos();
  const L=(typeof lerLog==='function')?await lerLog():[];
  const porQ=new Map();
  L.forEach(r=>{
    if(r.nota!==0&&r.nota!==1)return;
    const o=porQ.get(r.qid)||{dif:0,ult:0};
    if(r.nota===1)o.dif++;
    if(r.ts>o.ult)o.ult=r.ts;
    porQ.set(r.qid,o);
  });
  let frageis=new Set();
  try{if(typeof varCalcularFrageis==='function'){await varCalcularFrageis();frageis=new Set((window.__varFrageis||[]).map(x=>x.k));}}catch(e){}
  const G=new Map();
  const get=(k,tipo,mat,rot)=>{
    if(!G.has(k)){const s=tipo==='art'?lsSepararChave(k):null;G.set(k,{k,tipo,lei:s?s.lei:'',art:s?s.art:'',rot:rot||k,mats:new Set(),qs:[],frags:[],erros:0,dif:0,ult:0,leech:0,fragil:frageis.has(k)});}
    const g=G.get(k);if(mat)g.mats.add(mat);return g;
  };
  questions.forEach(q=>{
    if(q.suspensa)return;
    const lg=porQ.get(q.id)||{dif:0,ult:0};
    const er=q.erros||0;
    if(!er&&!lg.dif)return;
    const mat=(q.materia||'—').trim()||'—';
    const arts=lsArtigosDe(q,LS_MAX_ART_Q).filter(a=>lsSepararChave(a.k));
    const sub=(q.subtema||'—').trim()||'—';
    const gs=arts.length?arts.map(a=>{const g=get(a.k,'art',mat);(g.marc||(g.marc=new Set()));a.m.forEach(x=>g.marc.add(x));return g;}):[get('ass:'+mat+'§'+sub,'ass',mat,((q.subtema||'').trim()||'(sem subtema)'))];
    gs.forEach(g=>{
      if(g.tipo==='ass'){g.matNome=mat;g.subNome=sub;}
      g.qs.push({q,erros:er,dif:lg.dif,ult:lg.ult});
      g.erros+=er;g.dif+=lg.dif;if(lg.ult>g.ult)g.ult=lg.ult;
      if(typeof ehLeech==='function'&&ehLeech(q))g.leech++;
    });
  });
  // assuntos fracos: card por assunto, com as questões erradas dele
  lsIndexarAssuntos();
  lsPorAssunto.forEach((qs,chave)=>{
    let ac=0,er=0;const ativas=qs.filter(q=>!q.suspensa);
    ativas.forEach(q=>{ac+=q.acertos||0;er+=q.erros||0;});
    const resp=ac+er;if(resp<LS_FRACO_MIN||!er)return;
    const pct=Math.round(100*ac/resp);if(pct>=LS_FRACO_PCT)return;
    const i=chave.indexOf('§'),mat=chave.slice(0,i),sub=chave.slice(i+1),k='ass:'+chave;
    const novo=!G.has(k);
    if(novo&&!lsArtigosDoAssunto(mat,sub).arts.length)return;   // sem artigo para mostrar: não cria card vazio
    const g=get(k,'ass',mat,sub==='—'?'(sem subtema)':sub);
    g.matNome=mat;g.subNome=sub;g.fraco={pct,resp};
    const ja=new Set(g.qs.map(x=>x.q.id));
    ativas.forEach(q=>{
      const lg=porQ.get(q.id)||{dif:0,ult:0},e=q.erros||0;
      if((!e&&!lg.dif)||ja.has(q.id))return;
      g.qs.push({q,erros:e,dif:lg.dif,ult:lg.ult});
      g.erros+=e;g.dif+=lg.dif;if(lg.ult>g.ult)g.ult=lg.ult;
      if(typeof ehLeech==='function'&&ehLeech(q))g.leech++;
    });
  });
  (typeof fragmentos!=='undefined'?fragmentos:[]).forEach(f=>{
    if(!(f.erros>0))return;
    const k=(typeof varChaveDisp==='function')?varChaveDisp(f.dispositivo):null;
    if(!k||!lsSepararChave(k))return;
    const g=get(k,'art',(f.materia||'').trim());
    g.frags.push(f);g.erros+=f.erros;
    const ue=(f.hist||[]).filter(h=>h.r==='erro').map(h=>h.d).sort().pop();
    if(ue){const t=lsDiaTs(ue);if(t>g.ult)g.ult=t;}
  });
  // regra frágil vem da detecção antiga (1 artigo por questão): marca o card se a chave bater
  const marcas=lsMarcas();
  const lista=[...G.values()].map(g=>{
    const m=marcas[g.k]||{};
    g.mat=[...g.mats].join(' · ');
    g.li=m.li||0;g.ne=!!m.ne;
    // pendente = nunca lido, ou houve erro/Difícil depois da última leitura
    g.pend=!g.li||(g.ult&&g.ult>g.li);
    g.erroNovo=!!(g.li&&g.ult&&g.ult>g.li);
    return g;
  });
  lista.sort((a,b)=>(b.pend-a.pend)||((b.leech>0)-(a.leech>0))||((b.fraco?1:0)-(a.fraco?1:0))||(b.fragil-a.fragil)||(b.erros-a.erros)||(b.dif-a.dif)||(b.ult-a.ult)||a.k.localeCompare(b.k,'pt-BR'));
  lsGrupos=lista;lsPorChave=new Map(lista.map(g=>[g.k,g]));
  return lista;
}

// ---------- desenho ----------
function lsFmtData(ts){if(!ts)return'';const d=new Date(ts);return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0');}
function lsTextoArtigo(lei,art){const t=lsLeiCarregada(lei);return t&&t.arts?t.arts[art]:undefined;}
// Destaques: parágrafos e incisos citados nas questões erradas e nos itens da Lupa
// errados daquele artigo ('§2', 'pu' = parágrafo único, 'iVI' = inciso VI do caput).
function lsMarcasDeParagrafo(g){
  const s=new Set(g&&g.marc?g.marc:[]);
  (g?g.frags:[]).forEach(f=>{
    const d=String(f.dispositivo||'').replace(/^.*?art\.?\s*\d+(?:-[A-Z])?\s*[ºo°]?/i,'');
    let m;const rx=/§\s*(\d+)/g;while((m=rx.exec(d)))s.add('§'+m[1]);
    if(/par[aá]grafo [úu]nico/i.test(d))s.add('pu');
    const ip=d.search(/§|par[aá]grafo/i),rr=/(?:^|[,\s])([IVXL]{1,7})(?=[,\s.;)]|$)/g;
    while((m=rr.exec(ip<0?d:d.slice(0,ip))))s.add('i'+m[1]);
  });
  return s;
}
function lsHtmlArtigo(txt,dest){
  dest=dest||new Set();let passouPar=false;
  return String(txt).split('\n').map(l=>{
    let cls='ls-l',h=esc(l);
    const mp=l.match(/^§\s*(\d+)/),pu=/^Par[aá]grafo [úu]nico/i.test(l);
    if(mp||pu)passouPar=true;
    if(mp&&dest.has('§'+mp[1]))cls+=' ls-dest';
    if(pu&&dest.has('pu'))cls+=' ls-dest';
    const mi=!passouPar&&l.match(/^([IVXL]{1,7})\s*[-–]/);
    if(mi&&dest.has('i'+mi[1]))cls+=' ls-dest';
    h=h.replace(/^(Art\.?\s*[\d.]+\s*(?:º|°|o)?(?:\s*[-–]\s*[A-Z])?\.?|§\s*\d+\s*(?:º|°|o)?\.?|Par[aá]grafo [úu]nico\.?)/,'<b>$1</b>');
    return `<div class="${cls}">${h}</div>`;
  }).join('');
}
function lsHtmlComentario(c){
  try{
    const limpo=(typeof limparCabecalhoGabaritoComentario==='function')?limparCabecalhoGabaritoComentario(c):c;
    return (typeof formatQuestionText==='function')?formatQuestionText(limpo):esc(limpo);
  }catch(e){return esc(String(c||''));}
}
function lsHtmlErros(g){
  if(!g)return'';
  let h='';
  if(g.frags.length){
    h+=`<div class="ls-sec">Regras que você errou na Lupa</div>`+g.frags.slice().sort((a,b)=>(b.erros||0)-(a.erros||0)).map(f=>
      `<div class="ls-regra"><span class="ls-disp">📍 ${esc(f.dispositivo)}</span> <span class="ls-n">${f.erros}✗${f.acertos?' '+f.acertos+'✓':''}</span><div>${esc(f.explicacao||f.enunciado||'')}</div></div>`).join('');
  }
  if(g.qs.length){
    h+=`<div class="ls-sec">Questões (${g.qs.length})</div>`+g.qs.slice().sort((a,b)=>(b.erros-a.erros)||(b.ult-a.ult)).map(x=>{
      const q=x.q,gi=(typeof indiceGabarito==='function')?indiceGabarito(q):(q.gabarito??0);
      const gab=(q.alternativas||[])[gi];
      const info=[x.erros?`errou ${x.erros}x`:'',x.dif?`Difícil ${x.dif}x`:'',x.ult?'último '+lsFmtData(x.ult):''].filter(Boolean).join(' · ');
      return `<details class="ls-q"><summary><span class="ls-qmeta">${esc([q.banca,q.subtema].filter(Boolean).join(' · ')||'questão')}</span> <span class="ls-n">${esc(info)}</span>${(typeof ehLeech==='function'&&ehLeech(q))?' <span class="ls-b ls-b-leech">🔥 leech</span>':''}</summary>
        <div class="ls-qcorpo" data-qid="${esc(String(q.id))}"></div></details>`;
    }).join('');
  }
  return h;
}
function lsAbrirQuestao(det){
  const box=det.querySelector('.ls-qcorpo');if(!box||box.dataset.ok)return;
  const q=questions.find(x=>String(x.id)===box.dataset.qid);if(!q)return;
  const gi=(typeof indiceGabarito==='function')?indiceGabarito(q):(q.gabarito??0);
  const L=i=>String.fromCharCode(65+i);
  box.innerHTML=`<div class="ls-enun">${(typeof formatQuestionText==='function')?formatQuestionText(q.questao):esc(q.questao)}</div>
    ${(q.alternativas||[]).map((a,i)=>`<div class="ls-alt${i===gi?' ls-certa':''}"><b>${L(i)})</b> ${esc((typeof praticaTextoPuro==='function'?praticaTextoPuro(a):String(a)).replace(/^\s*[A-Ea-e]\)\s*/,''))}</div>`).join('')}
    ${q.comentario?`<div class="ls-sec">Comentário do professor</div><div class="ls-coment">${lsHtmlComentario(q.comentario)}</div>`:''}`;
  box.dataset.ok='1';
}
function lsCorpoGrupo(g){
  let h='';
  if(g.tipo==='art'){
    const info=lsLeiInfo(g.lei);
    // blocos de texto: a própria lei e, nos casos da EC 132 e da CF, as leis irmãs
    const blocos=lsLeisDoGrupo(g).map(k=>({k,txt:lsTextoArtigo(k,g.art)})).filter(b=>b.txt!==undefined);
    if(blocos.length){
      blocos.forEach((b,i)=>{
        const rot=(b.k!==g.lei||blocos.length>1)?`<div class="ls-fonte">${esc(b.k)}, art. ${esc(g.art)}</div>`:'';
        if(i===0)h+=`${rot}<div class="ls-artigo">${lsHtmlArtigo(b.txt,lsMarcasDeParagrafo(g))}</div>`;
        else h+=`<details class="ls-outra"><summary>Ver também: ${esc(b.k)}, art. ${esc(g.art)}</summary><div class="ls-artigo">${lsHtmlArtigo(b.txt,null)}</div></details>`;
      });
    }
    else if(lsLeiCarregada(g.lei))h+=`<div class="ls-aviso">O texto de ${esc(g.lei)} não tem o art. ${esc(g.art)} (pode estar revogado, ou ser artigo de outra lei citado no comentário).${info.url?` <a href="${esc(info.url)}" target="_blank" rel="noopener">Abrir a lei no Planalto ↗</a>`:''}</div>`;
    else h+=`<div class="ls-aviso">O texto de <b>${esc(g.lei)}</b> não está no site${lsTemTexto(g.lei)?' (não consegui baixar agora; tente de novo com internet)':''}. ${info.url?`<a href="${esc(info.url)}" target="_blank" rel="noopener">Abrir a lei no Planalto ↗</a> · `:''}<a href="#" onclick="lsAba('textos');return false">Colar o texto</a></div>`;
  }
  if(g.tipo==='ass'){
    const s=g.sug||(g.sug=lsArtigosDoAssunto(g.matNome,g.subNome));
    if(s.arts.length){
      h+=`<div class="ls-sec">Artigos mais citados neste assunto <span style="text-transform:none;font-weight:400">(nas ${s.n} questões do banco)</span></div>`;
      s.arts.forEach((a,i)=>{
        const txt=lsTextoArtigo(a.lei,a.art),info=lsLeiInfo(a.lei);
        const corpo=txt!==undefined?`<div class="ls-artigo">${lsHtmlArtigo(txt,a.m)}</div>`
          :`<div class="ls-aviso">${lsTemTexto(a.lei)?`O texto de ${esc(a.lei)} não tem o art. ${esc(a.art)} (pode estar revogado).`:`O texto de <b>${esc(a.lei)}</b> não está no site.`}${info.url?` <a href="${esc(info.url)}" target="_blank" rel="noopener">Abrir no Planalto ↗</a>`:''}</div>`;
        h+=`<details class="ls-outra"${i<2&&txt!==undefined?' open':''}><summary>${esc(a.k)} <span class="ls-n">· citado em ${a.c} questões</span></summary>${corpo}</details>`;
      });
    }else h+=`<div class="ls-aviso">As questões deste assunto não citam artigo de lei nos comentários${s.n?` (${s.n} no banco)`:''}. Fica o comentário do professor em cada questão abaixo.</div>`;
  }
  h+=lsHtmlErros(g);
  const kk=esc(g.k).replace(/'/g,'&#39;');
  h+=`<div class="ls-acoes">
    <button class="btn btn-primary btn-sm" data-k="${kk}" onclick="lsMarcar(this.dataset.k,'li')">✓ Li</button>
    <button class="btn btn-outline btn-sm" data-k="${kk}" onclick="lsMarcar(this.dataset.k,'ne')">${g.ne?'Tirar o “não entendi”':'❓ Não entendi'}</button>
    ${g.li?`<button class="btn btn-ghost btn-sm" data-k="${kk}" onclick="lsMarcar(this.dataset.k,'limpar')">desmarcar leitura</button>`:''}
  </div>`;
  return h;
}
function lsSelos(g){
  const s=[];
  if(g.leech)s.push('<span class="ls-b ls-b-leech">🔥 leech</span>');
  if(g.fragil)s.push('<span class="ls-b ls-b-fragil">⚠️ regra frágil</span>');
  if(g.fraco)s.push(`<span class="ls-b ls-b-fragil" title="Acerto no assunto, pelos contadores das questões">assunto fraco · ${g.fraco.pct}% em ${g.fraco.resp}</span>`);
  if(g.ne)s.push('<span class="ls-b ls-b-ne">❓ não entendi</span>');
  if(g.erroNovo)s.push('<span class="ls-b ls-b-novo">erro depois da leitura</span>');
  else if(g.li)s.push(`<span class="ls-b ls-b-li">✓ lido ${lsFmtData(g.li)}</span>`);
  return s.join(' ');
}
function lsResumoGrupo(g){
  const n=[g.erros?`${g.erros} erro${g.erros===1?'':'s'}`:'',g.dif?`${g.dif} difícil`:'',g.ult?'último '+lsFmtData(g.ult):''].filter(Boolean).join(' · ');
  const tit=g.tipo==='art'?esc(g.k):esc(g.rot);
  return `<span class="ls-tit">${tit}</span><span class="ls-mat">${esc(g.mat)}</span><span class="ls-n">${esc(n)}</span> ${lsSelos(g)}`;
}
async function lsAoAbrir(det){
  if(!det.open)return;
  const corpo=det.querySelector(':scope > .ls-corpo');if(!corpo||corpo.dataset.ok)return;
  const g=lsPorChave.get(det.dataset.k);if(!g)return;
  corpo.dataset.ok='1';
  let leis=[];
  if(g.tipo==='art')leis=lsLeisDoGrupo(g);
  else{g.sug=g.sug||lsArtigosDoAssunto(g.matNome,g.subNome);leis=[...new Set(g.sug.arts.map(a=>a.lei))];}
  if(leis.some(k=>!lsLeiCarregada(k)&&lsIndice&&lsIndice[k])){
    corpo.innerHTML='<div class="lupa-sub">Carregando o texto da lei…</div>';
    await Promise.all(leis.map(lsGarantirLei));
  }
  corpo.innerHTML=lsCorpoGrupo(g);
}
function lsMarcar(k,acao){
  const m=lsMarcas(),o=m[k]||{};
  if(acao==='li')o.li=Date.now();
  else if(acao==='ne')o.ne=!o.ne;
  else if(acao==='limpar')delete o.li;
  if(!o.li&&!o.ne)delete m[k];else m[k]=o;
  lsSalvarMarcas(m);
  const g=lsPorChave.get(k);
  if(g){g.li=o.li||0;g.ne=!!o.ne;g.pend=!g.li||(g.ult&&g.ult>g.li);g.erroNovo=!!(g.li&&g.ult&&g.ult>g.li);}
  // atualiza só o card, sem reordenar a lista embaixo do dedo
  document.querySelectorAll('details.ls-card').forEach(det=>{
    if(det.dataset.k!==k||!g)return;
    const sm=det.querySelector(':scope > summary');if(sm)sm.innerHTML=lsResumoGrupo(g);
    const corpo=det.querySelector(':scope > .ls-corpo');if(corpo&&det.open){corpo.innerHTML=lsCorpoGrupo(g);corpo.dataset.ok='1';}
    det.classList.toggle('ls-lido',!g.pend);
  });
  lsAtualizarContadores();
  if(acao==='li')notify('✓ Marcado como lido','ok');
}
function lsAtualizarContadores(){
  const el=document.getElementById('ls-cont');if(!el)return;
  const arts=lsGrupos.filter(g=>g.tipo==='art'),ass=lsGrupos.filter(g=>g.tipo==='ass');
  el.innerHTML=`<div><b>${arts.length}</b><span>artigos com erro ou Difícil</span></div>
    <div><b>${lsGrupos.filter(g=>g.pend).length}</b><span>ainda não lidos</span></div>
    <div><b>${lsGrupos.filter(g=>g.ne).length}</b><span>não entendi</span></div>
    <div><b>${ass.filter(g=>g.fraco).length}</b><span>assuntos fracos (abaixo de ${LS_FRACO_PCT}%)</span></div>`;
}
function lsAba(a){LSV.aba=a;LSV.mais=false;renderLeiSeca();}
function lsSet(k,v){LSV[k]=v;LSV.mais=false;renderLeiSeca(true);}
function lsFiltrar(){
  const b=(typeof normFrag==='function'?normFrag(LSV.busca):String(LSV.busca||'').toLowerCase());
  return lsGrupos.filter(g=>{
    if(LSV.filtro==='pend'&&!g.pend)return false;
    if(LSV.filtro==='ne'&&!g.ne)return false;
    if(LSV.filtro==='fragil'&&!g.fragil&&!g.leech)return false;
    if(LSV.filtro==='semart'&&g.tipo!=='ass')return false;
    if(LSV.filtro==='fraco'&&!g.fraco)return false;
    if(LSV.filtro==='lidos'&&g.pend)return false;
    if(LSV.mat&&!g.mats.has(LSV.mat))return false;
    if(b){const alvo=(typeof normFrag==='function'?normFrag(g.k+' '+g.rot+' '+g.mat):(g.k+' '+g.rot+' '+g.mat).toLowerCase());if(!alvo.includes(b))return false;}
    return true;
  });
}
function lsHtmlErrosView(){
  const mats=[...new Set(lsGrupos.flatMap(g=>[...g.mats]))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const chips=[['pend','Não lidos'],['todos','Todos'],['fragil','Frágeis e leeches'],['fraco','Assuntos fracos'],['semart','Por assunto'],['ne','Não entendi'],['lidos','Lidos']];
  const lista=lsFiltrar(),mostra=LSV.mais?lista:lista.slice(0,LS_LIMITE_LISTA);
  const semTexto=[...new Set(lsGrupos.filter(g=>g.tipo==='art'&&!lsTemTexto(g.lei)).map(g=>g.lei))];
  return `<div class="lupa-nums ls-cont" id="ls-cont"></div>
    ${semTexto.length?`<div class="ls-aviso" style="margin-bottom:12px">Sem texto no site: <b>${semTexto.map(esc).join(', ')}</b>. Os cards dessas leis mostram só as questões e o link. <a href="#" onclick="lsAba('textos');return false">Colar o texto</a></div>`:''}
    <div class="lupa-sub" style="margin:0 0 10px">Trecho com fundo amarelo = parágrafo ou inciso citado nas suas questões erradas.</div>
    <div class="ls-filtros">
      ${chips.map(([v,r])=>`<button class="chip ${LSV.filtro===v?'active':''}" onclick="lsSet('filtro','${v}')">${r}</button>`).join('')}
      <select class="config-select" onchange="lsSet('mat',this.value)" style="min-width:150px"><option value="">Todas as matérias</option>${mats.map(m=>`<option value="${esc(m)}" ${LSV.mat===m?'selected':''}>${esc(m)}</option>`).join('')}</select>
      <input class="config-input" id="ls-busca" placeholder="Buscar: 138, CTN, decadência…" value="${esc(LSV.busca)}" oninput="lsBuscar(this.value)" style="width:220px">
    </div>
    <div id="ls-lista">${lsHtmlLista(mostra,lista.length)}</div>`;
}
function lsHtmlLista(mostra,total){
  if(!mostra.length)return `<div class="lupa-sub" style="padding:18px 0">${lsGrupos.length?'Nada neste filtro.':'Nenhum erro ou “Difícil” registrado ainda. Os artigos aparecem aqui conforme você estuda.'}</div>`;
  return mostra.map(g=>`<details class="ls-card${g.pend?'':' ls-lido'}" data-k="${esc(g.k)}" ontoggle="lsAoAbrir(this)"><summary>${lsResumoGrupo(g)}</summary><div class="ls-corpo"></div></details>`).join('')
    +(total>mostra.length?`<div style="text-align:center;margin-top:12px"><button class="btn btn-outline btn-sm" onclick="LSV.mais=true;renderLeiSeca(true)">Mostrar os outros ${total-mostra.length}</button></div>`:'');
}
let lsBuscaT=null;
function lsBuscar(v){
  LSV.busca=v;clearTimeout(lsBuscaT);
  lsBuscaT=setTimeout(()=>{const el=document.getElementById('ls-lista');if(!el)return;const lista=lsFiltrar();el.innerHTML=lsHtmlLista(LSV.mais?lista:lista.slice(0,LS_LIMITE_LISTA),lista.length);},180);
}
// Textos
function lsHtmlTextosView(){
  const usadas=new Map();lsGrupos.forEach(g=>{if(g.tipo==='art')usadas.set(g.lei,(usadas.get(g.lei)||0)+1);});
  const chaves=[...new Set([...LS_LEIS.map(l=>l.k),...Object.keys(lsIndice||{}),...Object.keys(lsTextos),...usadas.keys()])];
  return `<div class="card lupa-card">
      <div class="lupa-h">📚 Leis</div>
      <table class="lupa-tab"><thead><tr><th>Lei</th><th>Artigos com erro</th><th>Texto</th><th></th></tr></thead><tbody>
      ${chaves.map(k=>{const i=lsLeiInfo(k),t=lsTextos[k],e=lsIndice&&lsIndice[k];const kk=esc(k).replace(/'/g,'&#39;');
        const st=t?`<span class="ls-b ls-b-li">colado por você · ${t.ordem.length} artigos · ${esc(t.em||'')}</span>`:e?`<span class="ls-b ls-b-li">vem com o site · ${e.n} artigos · Planalto em ${esc(e.em||'')}</span>`:'<span style="color:var(--muted)">sem texto</span>';
        return `<tr><td>${esc(i.nome)}</td><td>${usadas.get(k)||'—'}</td><td>${st}</td><td style="white-space:nowrap">${i.url?`<a href="${esc(i.url)}" target="_blank" rel="noopener">Planalto ↗</a>`:''}${t?` · <a href="#" data-k="${kk}" onclick="lsApagarTexto(this.dataset.k);return false">apagar o colado</a>`:''}</td></tr>`;}).join('')}
      </tbody></table>
      <div class="lupa-sub">Os textos que vêm com o site são uma cópia do Planalto na data indicada. Lei alterada depois disso precisa ser atualizada (ou cole o texto novo abaixo).</div>
    </div>
    <div class="card lupa-card" style="margin-top:14px">
      <div class="lupa-h">📥 Colar o texto de outra lei</div>
      <div class="lupa-sub" style="margin-top:0">Para leis que não vêm com o site (as locais, quando sair o edital): abra a lei, selecione tudo (Ctrl+A), copie e cole aqui. O site separa por artigo e mostra a contagem antes de gravar. Atenção: no texto colado, a redação antiga (riscada na página) vem junto com a nova; prefira a versão compilada da lei.</div>
      <div class="ls-filtros" style="margin-top:10px">
        <select class="config-select" id="ls-imp-lei" onchange="lsTrocaLeiImp()" style="min-width:220px"><option value="">De qual lei é o texto?</option>${LS_LEIS.map(l=>`<option value="${esc(l.k)}">${esc(l.nome)}</option>`).join('')}<option value="__outra">Outra lei…</option></select>
        <input class="config-input" id="ls-imp-outra" placeholder="Nome curto, ex.: LC 116/2003" style="display:none;width:220px">
        <label class="btn btn-outline btn-sm" style="cursor:pointer">📄 Abrir arquivo .txt<input type="file" accept=".txt,text/plain" style="display:none" onchange="lsImportarArquivo(event)"></label>
      </div>
      <textarea id="ls-imp-txt" class="ls-ta" placeholder="Cole aqui o texto da lei inteira…" oninput="lsAoColar()"></textarea>
      <button class="btn btn-primary" onclick="lsImportarTexto()">Importar texto</button>
      <div class="lupa-sub">Um artigo só aparece em “Meus erros” com o texto se a detecção reconhecer a lei no comentário da questão. Hoje ela reconhece: CTN, CF, ADCT, EC 132, LC 24, LC 87, LC 116, LC 123, LC 214, LC 227 e as Leis 6.830, 8.429, 9.784, 12.527 e 14.133.</div>
    </div>`;
}
async function renderLeiSeca(semRecoleta){
  const el=document.getElementById('ls-corpo');if(!el)return;
  if(!semRecoleta||!lsGrupos.length){
    if(!el.innerHTML)el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px 0">Lendo o histórico…</div>';
    await lsCarregarTextos();await lsCarregarIndice();
    try{await lsColetar();}catch(e){console.warn('[QuestIA] lei seca:',e);lsGrupos=[];lsPorChave=new Map();}
  }
  const abas=[['erros','Meus erros'],['textos','Textos das leis']];
  el.innerHTML=`<div class="ls-abas">${abas.map(([v,r])=>`<button class="ls-aba${LSV.aba===v?' on':''}" onclick="lsAba('${v}')">${r}</button>`).join('')}</div>`
    +(LSV.aba==='textos'?lsHtmlTextosView():lsHtmlErrosView());
  lsAtualizarContadores();
}
document.addEventListener('toggle',e=>{const t=e.target;if(t&&t.classList&&t.classList.contains('ls-q')&&t.open)lsAbrirQuestao(t);},true);

// estilos (ficam aqui, como na Lupa, para não mexer no style.css)
(function(){const s=document.createElement('style');s.textContent=`
.ls-abas{display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--border)}
.ls-aba{background:none;border:none;border-bottom:2.5px solid transparent;padding:9px 14px;font-family:'Outfit',sans-serif;font-size:13.5px;font-weight:600;color:var(--muted);cursor:pointer}
.ls-aba.on{color:var(--ink);border-bottom-color:var(--accent2)}
.ls-cont{flex-wrap:wrap;gap:22px!important}
.ls-filtros{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.ls-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px}
.ls-card>summary{cursor:pointer;padding:12px 14px;display:flex;gap:8px 12px;align-items:baseline;flex-wrap:wrap;list-style:none}
.ls-card>summary::-webkit-details-marker{display:none}
.ls-card[open]>summary{border-bottom:1px solid var(--border)}
.ls-card.ls-lido>summary .ls-tit{color:var(--muted);font-weight:600}
.ls-tit{font-weight:700;font-size:14px;color:var(--ink)}
.ls-mat,.ls-n{font-size:12px;color:var(--muted)}
.ls-fonte{font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px}
.ls-outra{margin-bottom:12px}.ls-outra>summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--accent2);margin-bottom:6px}
.ls-corpo{padding:14px}
.ls-artigo{font-family:Georgia,'Times New Roman',serif;font-size:15.5px;line-height:1.65;color:var(--ink);background:var(--surface2);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.ls-l{margin:0 0 7px}.ls-l:last-child{margin-bottom:0}
.ls-dest{background:var(--yellow-light);border-left:3px solid var(--yellow);padding:4px 8px;border-radius:4px}
.ls-aviso{font-size:12.5px;color:var(--ink2);background:var(--yellow-light);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:12px}
.ls-aviso a,.lupa-tab a{color:var(--accent2);font-weight:600}
.ls-sec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 0 6px}
.ls-regra{font-size:13px;line-height:1.5;padding:8px 0;border-bottom:1px solid var(--border)}
.ls-disp{font-weight:700;font-size:12px;color:var(--indigo-text)}
.ls-q{border-bottom:1px solid var(--border)}
.ls-q>summary{cursor:pointer;padding:8px 0;font-size:13px}
.ls-qmeta{font-weight:600;color:var(--ink2)}
.ls-qcorpo{padding:4px 0 12px;font-size:13.5px;line-height:1.55}
.ls-enun{margin-bottom:8px}
.ls-alt{padding:5px 8px;border-radius:6px;margin-bottom:3px}
.ls-alt.ls-certa{background:var(--green-light);font-weight:600}
.ls-coment{font-size:13px;line-height:1.6;color:var(--ink2)}
.ls-acoes{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.ls-b{display:inline-block;font-size:11px;font-weight:700;border-radius:6px;padding:1px 7px;border:1px solid var(--border)}
.ls-b-leech,.ls-b-novo{background:var(--red-light);color:var(--red-text);border-color:var(--red-border)}
.ls-b-fragil,.ls-b-ne{background:var(--yellow-light);color:var(--yellow-text,var(--yellow))}
.ls-b-li{background:var(--green-light);color:var(--green)}
.ls-ta{width:100%;min-height:150px;margin:4px 0 10px;padding:10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--ink);font-family:ui-monospace,Menlo,monospace;font-size:12px;box-sizing:border-box}
`;document.head.appendChild(s);})();
