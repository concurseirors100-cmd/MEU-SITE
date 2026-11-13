// ===== LEI SECA (13/11, pedido do Anderson) =====
// Motivo: 60 questões em 2 horas não deixam tempo para ler a lei, e procurar à mão
// os artigos errados é atrito. Esta aba junta sozinha os artigos em que houve erro
// ou "Difícil" e mostra o texto do artigo na hora — SEM relógio, sem ciclo e sem
// meta: é uma seção para navegar quando quiser.
//
//  1) Meus erros: questões com erro ou "Difícil" (e itens da Lupa errados) agrupados
//     por artigo ("CTN, art. 138"), usando a mesma detecção da revisão com variante
//     (varDispDe). Sem artigo identificado, agrupa por assunto e mostra o comentário.
//  2) Lei inteira: navegar pelo texto carregado, com os artigos de erro marcados.
//  3) Textos: a lei é colada/importada UMA vez (texto copiado do Planalto) e o site
//     separa por artigo. Nada é escrito de memória: sem texto carregado, o card
//     mostra só o material das próprias questões e o link da lei.
//
// Não mexe no SM-2, na fila, nos contadores nem no registro de respostas. Guarda só:
//  - marcas de leitura (localStorage 'questia_leiseca_marcas' → entram no backup);
//  - textos das leis (IndexedDB, meta 'leiseca_textos' → entram no backup).

const LS_MARCAS_KEY='questia_leiseca_marcas';
const LS_LIMITE_LISTA=60;
// Chaves iguais às que varLeiDoContexto devolve, para o texto casar com a detecção.
const LS_LEIS=[
  {k:'CTN',nome:'CTN (Lei 5.172/1966)',url:'https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm'},
  {k:'CF/88',nome:'Constituição Federal',url:'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm'},
  {k:'LC 87/1996',nome:'LC 87/1996 (Lei Kandir)',url:'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm'},
  {k:'LC 214/2025',nome:'LC 214/2025 (IBS/CBS/IS)',url:'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm'},
  {k:'LC 227/2026',nome:'LC 227/2026',url:''},
  {k:'EC 132/2023',nome:'EC 132/2023',url:'https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm'},
  {k:'Lei 6.830/1980',nome:'Lei 6.830/1980 (execução fiscal)',url:'https://www.planalto.gov.br/ccivil_03/leis/l6830.htm'}
];
const lsLeiInfo=k=>LS_LEIS.find(l=>l.k===k)||{k,nome:k,url:''};

let lsTextos={},lsTextosOk=false;
let LSV={aba:'erros',filtro:'pend',mat:'',busca:'',lei:'',buscaLei:'',mais:false};
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
function lsMarcas(){try{const v=JSON.parse(localStorage.getItem(LS_MARCAS_KEY)||'{}');return v&&typeof v==='object'?v:{};}catch(e){return{};}}
function lsSalvarMarcas(m){try{localStorage.setItem(LS_MARCAS_KEY,JSON.stringify(m));}catch(e){notify('❌ Não consegui salvar a marcação','err');}}

// ---------- separar a lei em artigos ----------
// Entrada: texto corrido copiado da página da lei. Saída: {arts:{'138':'Art. 138. ...'},ordem:[...]}.
// Regras: um artigo começa em linha iniciada por "Art."; termina no próximo artigo ou
// num título de divisão (LIVRO/TÍTULO/CAPÍTULO/SEÇÃO). Número repetido (artigo de
// outra lei citado entre aspas, ADCT) fica com a PRIMEIRA ocorrência.
const LS_RX_ART=/^Art\.?\s*(\d{1,2}(?:\.\d{3})|\d{1,4})\s*(?:º|°|o(?=[\s.\-–]))?\s*(?:[-–]\s*([A-Z])(?![A-Za-zÀ-ú]))?/;
const LS_RX_DIV=/^(LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O|PARTE)\b/;
const LS_RX_NOTA=/\s*\((?:Reda[cç][aã]o dada|Inclu[ií]d[oa]|Acrescid[oa]|Vide|Regulamento|Vig[eê]ncia|Produ[cç][aã]o de efeitos?|Renumerad[oa]|Promulga[cç][aã]o)[^()]*\)/gi;
function lsNumArt(m){return m[1].replace(/\./g,'').replace(/^0+(?=\d)/,'')+(m[2]?'-'+m[2]:'');}
function lsParseLei(txt){
  const linhas=String(txt||'').replace(/\r/g,'').replace(/ /g,' ').split('\n').map(l=>l.replace(/[ \t]+/g,' ').trim());
  const arts={},ordem=[];let cur=null,buf=[],repetidos=0,parou=false;
  const fechar=()=>{
    if(cur!==null){
      const t=buf.join('\n').replace(LS_RX_NOTA,'').replace(/[ \t]+\n/g,'\n').replace(/ {2,}/g,' ').trim();
      if(arts[cur]===undefined){arts[cur]=t;ordem.push(cur);}else repetidos++;
    }
    cur=null;buf=[];
  };
  for(const l of linhas){
    if(!l)continue;
    if(/^ATO DAS DISPOSI[ÇC][ÕO]ES CONSTITUCIONAIS TRANSIT[ÓO]RIAS/.test(l)){fechar();parou=true;break;}
    const m=l.match(LS_RX_ART);
    if(m){fechar();cur=lsNumArt(m);buf=[l];continue;}
    if(LS_RX_DIV.test(l)&&l===l.toUpperCase()){fechar();continue;}
    if(cur!==null)buf.push(l);
  }
  fechar();
  return{arts,ordem,repetidos,parouNoADCT:parou};
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
  if(r.repetidos)lin.push(`• ${r.repetidos} artigo(s) com número repetido ignorado(s) — ficou a primeira ocorrência`);
  if(r.parouNoADCT)lin.push('• Parei no ADCT (os artigos transitórios não entram)');
  if(lsTextos[k])lin.push(`• Substitui o texto já carregado (${lsTextos[k].ordem.length} artigos, de ${lsTextos[k].em})`);
  if(!confirm('Gravar o texto da lei?\n\n'+lin.join('\n')+'\n\nConfira os números antes de confirmar.'))return;
  await lsCarregarTextos();
  lsTextos[k]={em:today(),arts:r.arts,ordem:r.ordem};
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
  if(!confirm(`Apagar o texto de "${k}" (${lsTextos[k].ordem.length} artigos)?\n\nSó o texto da lei sai. Marcações de leitura, questões e histórico não mudam.`))return;
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
    const d=(typeof varDispDe==='function')?varDispDe(q):null;
    const temArt=d&&lsSepararChave(d);
    const g=temArt?get(d,'art',mat):get('ass:'+mat+'§'+((q.subtema||'—').trim()||'—'),'ass',mat,((q.subtema||'').trim()||'(sem subtema)'));
    g.qs.push({q,erros:er,dif:lg.dif,ult:lg.ult});
    g.erros+=er;g.dif+=lg.dif;if(lg.ult>g.ult)g.ult=lg.ult;
    if(typeof ehLeech==='function'&&ehLeech(q))g.leech++;
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
  lista.sort((a,b)=>(b.pend-a.pend)||((b.leech>0)-(a.leech>0))||(b.fragil-a.fragil)||(b.erros-a.erros)||(b.dif-a.dif)||(b.ult-a.ult)||a.k.localeCompare(b.k,'pt-BR'));
  lsGrupos=lista;lsPorChave=new Map(lista.map(g=>[g.k,g]));
  return lista;
}

// ---------- desenho ----------
function lsFmtData(ts){if(!ts)return'';const d=new Date(ts);return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0');}
function lsTextoArtigo(lei,art){const t=lsTextos[lei];return t&&t.arts?t.arts[art]:undefined;}
// Destaques: parágrafos citados nos itens da Lupa errados daquele artigo.
function lsMarcasDeParagrafo(g){
  const s=new Set();
  (g?g.frags:[]).forEach(f=>{
    const d=String(f.dispositivo||'');
    let m;const rx=/§\s*(\d+)/g;while((m=rx.exec(d)))s.add('§'+m[1]);
    if(/par[aá]grafo [úu]nico/i.test(d))s.add('pu');
  });
  return s;
}
function lsHtmlArtigo(txt,g){
  const dest=lsMarcasDeParagrafo(g);
  return String(txt).split('\n').map(l=>{
    let cls='ls-l',h=esc(l);
    const mp=l.match(/^§\s*(\d+)/);
    if(mp&&dest.has('§'+mp[1]))cls+=' ls-dest';
    if(/^Par[aá]grafo [úu]nico/i.test(l)&&dest.has('pu'))cls+=' ls-dest';
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
    const txt=lsTextoArtigo(g.lei,g.art),info=lsLeiInfo(g.lei);
    if(txt!==undefined)h+=`<div class="ls-artigo">${lsHtmlArtigo(txt,g)}</div>`;
    else if(lsTextos[g.lei])h+=`<div class="ls-aviso">O texto carregado de ${esc(g.lei)} não tem o art. ${esc(g.art)} (pode ser artigo de outra lei citado no comentário).</div>`;
    else h+=`<div class="ls-aviso">O texto de <b>${esc(g.lei)}</b> ainda não foi carregado. ${info.url?`<a href="${esc(info.url)}" target="_blank" rel="noopener">Abrir a lei no Planalto ↗</a> · `:''}<a href="#" onclick="lsAba('textos');return false">Carregar o texto</a></div>`;
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
function lsAoAbrir(det){
  if(!det.open)return;
  const corpo=det.querySelector(':scope > .ls-corpo');if(!corpo||corpo.dataset.ok)return;
  const g=lsPorChave.get(det.dataset.k);if(!g)return;
  corpo.innerHTML=lsCorpoGrupo(g);corpo.dataset.ok='1';
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
    <div><b>${ass.length}</b><span>assuntos sem artigo identificado</span></div>`;
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
    if(LSV.filtro==='lidos'&&g.pend)return false;
    if(LSV.mat&&!g.mats.has(LSV.mat))return false;
    if(b){const alvo=(typeof normFrag==='function'?normFrag(g.k+' '+g.rot+' '+g.mat):(g.k+' '+g.rot+' '+g.mat).toLowerCase());if(!alvo.includes(b))return false;}
    return true;
  });
}
function lsHtmlErrosView(){
  const mats=[...new Set(lsGrupos.flatMap(g=>[...g.mats]))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const chips=[['pend','Não lidos'],['todos','Todos'],['fragil','Frágeis e leeches'],['ne','Não entendi'],['semart','Sem artigo'],['lidos','Lidos']];
  const lista=lsFiltrar(),mostra=LSV.mais?lista:lista.slice(0,LS_LIMITE_LISTA);
  const semTexto=[...new Set(lsGrupos.filter(g=>g.tipo==='art'&&!lsTextos[g.lei]).map(g=>g.lei))];
  return `<div class="lupa-nums ls-cont" id="ls-cont"></div>
    ${semTexto.length?`<div class="ls-aviso" style="margin-bottom:12px">Sem texto carregado: <b>${semTexto.map(esc).join(', ')}</b>. Os cards dessas leis mostram só as questões e o link. <a href="#" onclick="lsAba('textos');return false">Carregar textos</a></div>`:''}
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
// Lei inteira
function lsHtmlLeiView(){
  const leis=Object.keys(lsTextos);
  if(!leis.length)return `<div class="ls-aviso">Nenhum texto de lei carregado ainda. <a href="#" onclick="lsAba('textos');return false">Carregar o texto de uma lei</a> (uma vez só por lei).</div>`;
  if(!LSV.lei||!lsTextos[LSV.lei])LSV.lei=leis[0];
  const t=lsTextos[LSV.lei];
  const comErro=t.ordem.filter(a=>lsPorChave.has(LSV.lei+', art. '+a)).length;
  return `<div class="ls-filtros">
      <select class="config-select" onchange="lsSet('lei',this.value)" style="min-width:200px">${leis.map(k=>`<option value="${esc(k)}" ${LSV.lei===k?'selected':''}>${esc(lsLeiInfo(k).nome)}</option>`).join('')}</select>
      <input class="config-input" placeholder="Artigo ou palavra: 150, anterioridade…" value="${esc(LSV.buscaLei)}" oninput="lsBuscarLei(this.value)" style="width:260px">
      <label class="dash-chk"><input type="checkbox" ${LSV.soErro?'checked':''} onchange="lsSet('soErro',this.checked)"> só artigos com erro</label>
    </div>
    <div class="lupa-sub" style="margin:0 0 10px">${t.ordem.length} artigos · ${comErro} com erro ou Difícil · texto carregado em ${esc(t.em||'')}</div>
    <div id="ls-lei-lista">${lsHtmlLeiLista()}</div>`;
}
function lsHtmlLeiLista(){
  const t=lsTextos[LSV.lei];if(!t)return'';
  const b=String(LSV.buscaLei||'').trim();
  const num=/^\d{1,4}(-[A-Za-z])?$/.test(b)?b.toUpperCase():null;
  const nb=(!num&&b&&typeof normFrag==='function')?normFrag(b):'';
  const arts=t.ordem.filter(a=>{
    const g=lsPorChave.get(LSV.lei+', art. '+a);
    if(LSV.soErro&&!g)return false;
    if(num)return a===num||a.startsWith(num+'-');
    if(nb)return normFrag(t.arts[a]).includes(nb);
    return true;
  });
  if(!arts.length)return '<div class="lupa-sub" style="padding:14px 0">Nenhum artigo encontrado.</div>';
  return arts.map(a=>{
    const g=lsPorChave.get(LSV.lei+', art. '+a);
    const ini=String(t.arts[a]).split('\n')[0].replace(/^Art\.?\s*[\d.]+\s*(?:º|°|o)?(?:\s*[-–]\s*[A-Z])?\.?\s*/,'');
    return `<details class="ls-card ls-art${g?' ls-temerro':''}" data-lei="${esc(LSV.lei)}" data-art="${esc(a)}" ontoggle="lsAoAbrirArtigo(this)"${num&&arts.length===1?' open':''}>
      <summary><span class="ls-tit">Art. ${esc(a)}</span><span class="ls-ini">${esc(ini.slice(0,110))}${ini.length>110?'…':''}</span>${g?` <span class="ls-b ls-b-novo">${g.erros} erro${g.erros===1?'':'s'}${g.dif?' · '+g.dif+' difícil':''}</span> ${lsSelos(g)}`:''}</summary><div class="ls-corpo"></div></details>`;
  }).join('');
}
function lsAoAbrirArtigo(det){
  if(!det.open)return;
  const corpo=det.querySelector(':scope > .ls-corpo');if(!corpo||corpo.dataset.ok)return;
  const lei=det.dataset.lei,art=det.dataset.art,g=lsPorChave.get(lei+', art. '+art);
  const txt=lsTextoArtigo(lei,art);
  corpo.innerHTML=`<div class="ls-artigo">${lsHtmlArtigo(txt||'',g)}</div>${g?lsHtmlErros(g):''}`;
  corpo.dataset.ok='1';
}
let lsBuscaLeiT=null;
function lsBuscarLei(v){
  LSV.buscaLei=v;clearTimeout(lsBuscaLeiT);
  lsBuscaLeiT=setTimeout(()=>{const el=document.getElementById('ls-lei-lista');if(el){el.innerHTML=lsHtmlLeiLista();el.querySelectorAll('details[open]').forEach(lsAoAbrirArtigo);}},200);
}
// Textos
function lsHtmlTextosView(){
  const usadas=new Map();lsGrupos.forEach(g=>{if(g.tipo==='art')usadas.set(g.lei,(usadas.get(g.lei)||0)+1);});
  const chaves=[...new Set([...LS_LEIS.map(l=>l.k),...Object.keys(lsTextos),...usadas.keys()])];
  return `<div class="card lupa-card">
      <div class="lupa-h">📚 Leis</div>
      <table class="lupa-tab"><thead><tr><th>Lei</th><th>Artigos com erro</th><th>Texto</th><th></th></tr></thead><tbody>
      ${chaves.map(k=>{const i=lsLeiInfo(k),t=lsTextos[k];const kk=esc(k).replace(/'/g,'&#39;');return `<tr><td>${esc(i.nome)}</td><td>${usadas.get(k)||'—'}</td><td>${t?`<span class="ls-b ls-b-li">${t.ordem.length} artigos · ${esc(t.em||'')}</span>`:'<span style="color:var(--muted)">não carregado</span>'}</td><td style="white-space:nowrap">${i.url?`<a href="${esc(i.url)}" target="_blank" rel="noopener">Planalto ↗</a>`:''}${t?` · <a href="#" data-k="${kk}" onclick="lsApagarTexto(this.dataset.k);return false">apagar</a>`:''}</td></tr>`;}).join('')}
      </tbody></table>
    </div>
    <div class="card lupa-card" style="margin-top:14px">
      <div class="lupa-h">📥 Carregar o texto de uma lei</div>
      <div class="lupa-sub" style="margin-top:0">Abra a lei no Planalto (versão compilada), selecione tudo (Ctrl+A), copie e cole aqui. O site separa por artigo e mostra a contagem antes de gravar. É uma vez só por lei; importar de novo substitui o texto.</div>
      <div class="ls-filtros" style="margin-top:10px">
        <select class="config-select" id="ls-imp-lei" onchange="lsTrocaLeiImp()" style="min-width:220px"><option value="">De qual lei é o texto?</option>${LS_LEIS.map(l=>`<option value="${esc(l.k)}">${esc(l.nome)}</option>`).join('')}<option value="__outra">Outra lei…</option></select>
        <input class="config-input" id="ls-imp-outra" placeholder="Nome curto, ex.: LC 116/2003" style="display:none;width:220px">
        <label class="btn btn-outline btn-sm" style="cursor:pointer">📄 Abrir arquivo .txt<input type="file" accept=".txt,text/plain" style="display:none" onchange="lsImportarArquivo(event)"></label>
      </div>
      <textarea id="ls-imp-txt" class="ls-ta" placeholder="Cole aqui o texto da lei inteira…" oninput="lsAoColar()"></textarea>
      <button class="btn btn-primary" onclick="lsImportarTexto()">Importar texto</button>
      <div class="lupa-sub">Outras leis só aparecem em “Meus erros” se a detecção de artigo reconhecer a lei no comentário; mesmo assim dá para navegar por elas em “Lei inteira”.</div>
    </div>`;
}
async function renderLeiSeca(semRecoleta){
  const el=document.getElementById('ls-corpo');if(!el)return;
  if(!semRecoleta||!lsGrupos.length){
    if(!el.innerHTML)el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px 0">Lendo o histórico…</div>';
    await lsCarregarTextos();
    try{await lsColetar();}catch(e){console.warn('[QuestIA] lei seca:',e);lsGrupos=[];lsPorChave=new Map();}
  }
  const abas=[['erros','Meus erros'],['lei','Lei inteira'],['textos','Textos das leis']];
  el.innerHTML=`<div class="ls-abas">${abas.map(([v,r])=>`<button class="ls-aba${LSV.aba===v?' on':''}" onclick="lsAba('${v}')">${r}</button>`).join('')}</div>`
    +(LSV.aba==='lei'?lsHtmlLeiView():LSV.aba==='textos'?lsHtmlTextosView():lsHtmlErrosView());
  lsAtualizarContadores();
  el.querySelectorAll('details.ls-art[open]').forEach(lsAoAbrirArtigo);
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
.ls-card.ls-temerro{border-left:3px solid var(--accent)}
.ls-tit{font-weight:700;font-size:14px;color:var(--ink)}
.ls-mat,.ls-n,.ls-ini{font-size:12px;color:var(--muted)}
.ls-ini{flex:1 1 220px;min-width:0}
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
