// ===== REVISÃO COM VARIANTE (06/11, pedido do Anderson) =====
// Diagnóstico que motivou: em Direito Tributário, questões FCC do TEC vistas pela
// 1ª vez no site davam 80% de acerto; nas provas reais (CE e Manaus), 50%. Boa parte
// do banco ele já tinha resolvido no TEC (90 mil questões): o acerto media
// reconhecimento da questão, não domínio da regra.
//
// Amplia a "questão irmã" (que só entrava depois de ERRO) em quatro pontos:
//  1. Também nas revisões de ACERTO, nas matérias do escopo: quando a original vence
//     e a última resposta foi acerto, entra no lugar dela uma irmã/variante da mesma
//     regra. A original não some: é adiada (metade do intervalo, mínimo 3 dias) e
//     volta sozinha depois de VAR_RODIZIO substituições seguidas — ou no dia
//     seguinte, se você errar a variante.
//  2. Irmã do MESMO ARTIGO: o dispositivo é lido do comentário/enunciado
//     ("art. 138 do CTN", "LC 214, art. 12"...). Sem irmã do artigo, cai para o subtema.
//  3. Variantes geradas da lei (lotes JSON, como o "Na prática"): entram no banco com
//     fonte 'variante' e soIrma=true — não aparecem como inéditas comuns, só no lugar
//     da original. Depois de respondidas, viram questão normal do SM-2.
//  4. Regras frágeis: por dispositivo, acerto nas REPETIDAS (questão já vista) contra
//     acerto nas NOVAS (1ª resposta de questão nunca vista + variantes). Diferença
//     grande = você acerta a questão que conhece e erra a regra com outra roupagem.
// Nada disso apaga histórico nem mexe em ef/interval/reps da original — só a data
// da próxima aparição (nextDue), como o rodízio pede.

const VAR_MATERIAS=['Direito Tributário','Reforma Tributária'];
// Reforma espalhada em outras matérias (IBS/CBS/IS na CF, na Leg. Federal...). ZFM fica de fora.
const VAR_RX_REFORMA=/reforma tribut|\bIBS\b|\bCBS\b|imposto seletivo|LC ?n?º? ?214|LC ?n?º? ?227|EC ?n?º? ?132|comit[eê] gestor|split payment|cashback/i;
const VAR_RODIZIO=2;        // substituições seguidas antes de a original voltar
const VAR_MAX_DIA=40;       // teto de substituições por montagem de fila
const VAR_ADIA_MIN=3;       // dias mínimos de adiamento da original quando a variante é acertada
const VAR_FRAGIL_GAP=25;    // p.p. de diferença repetidas × novas para marcar "frágil"
const VAR_FRAGIL_MIN=3;     // respostas mínimas em cada lado

function varNoEscopo(q){
  if(!q)return false;
  const m=(q.materia||'').trim();
  if(VAR_MATERIAS.includes(m))return true;
  if(m==='Zona Franca de Manaus')return false;
  return VAR_RX_REFORMA.test((q.subtema||'')+' '+m);
}

// ---------- dispositivo da questão ----------
const varDispCache=new Map();
function varLeiDoContexto(s,materia){
  const t=s.toLowerCase();
  if(/ctn|c[oó]digo tribut[aá]rio|5\.?172/.test(t))return 'CTN';
  if(/lc ?n?º? ?214|complementar n?º? ?214|214\/2025/.test(t))return 'LC 214/2025';
  if(/lc ?n?º? ?227|complementar n?º? ?227|227\/2026/.test(t))return 'LC 227/2026';
  if(/ec ?n?º? ?132|emenda constitucional n?º? ?132/.test(t))return 'EC 132/2023';
  if(/\bcf\b|cf\/88|constitui[cç][aã]o/.test(t))return 'CF/88';
  if(/lc ?n?º? ?87|kandir/.test(t))return 'LC 87/1996';
  if(/6\.?830|execu[cç][aã]o fiscal/.test(t))return 'Lei 6.830/1980';
  return null;
}
// chave de agrupamento: "CTN, art. 138" (parágrafos e incisos ficam no texto completo)
function varChaveDisp(d){
  if(!d)return null;
  const m=String(d).match(/^(.*?)[,\s]*\bart(?:igo)?s?\.?\s*(\d{1,3}(?:-[A-Z])?)/i);
  if(!m)return String(d).trim();
  const lei=varLeiDoContexto(m[1])||m[1].trim().replace(/[,\s]+$/,'');
  return (lei?lei+', ':'')+'art. '+m[2];
}
function varDispDe(q){
  if(!q)return null;
  if(q.varDisp)return varChaveDisp(q.varDisp);
  if(varDispCache.has(q.id))return varDispCache.get(q.id);
  const texto=[q.comentario||'',q.gabTexto||'',q.questao||''].join(' \n ').replace(/<[^>]+>/g,' ');
  const cont=new Map();
  const rx=/\bart(?:igo)?s?\.?\s*(\d{1,3}(?:-[A-Z])?)\s*(?:º|°|o)?/gi;let m;
  const padrao=(q.materia||'').trim()==='Reforma Tributária'?'LC 214/2025':((q.materia||'').trim()==='Direito Tributário'?'CTN':null);
  while((m=rx.exec(texto))){
    const viz=texto.slice(Math.max(0,m.index-40),m.index+90);
    const lei=varLeiDoContexto(viz)||padrao;if(!lei)continue;
    const k=lei+', art. '+m[1];
    // o comentário pesa mais que o enunciado
    const peso=m.index<(q.comentario||'').length?2:1;
    cont.set(k,(cont.get(k)||0)+peso);
  }
  let best=null,bv=0;cont.forEach((v,k)=>{if(v>bv){bv=v;best=k;}});
  varDispCache.set(q.id,best);
  return best;
}

// ---------- 1 e 2: substituição na fila de revisão ----------
let varSubst=new Map();   // id da substituta -> id da original (só nesta montagem)
function varEhVirgem(q){return !(q.acertos||0)&&!(q.erros||0)&&!(q.reps||0);}
function varSubstituir(fila){
  varSubst=new Map();
  if(typeof histResp==='undefined'||!histResp)return fila;
  const recente=Date.now()-(typeof QUAL_IRMA_RECENTE!=='undefined'?QUAL_IRMA_RECENTE:3)*86400000;
  // recebe a fila já montada do dia: nada que já esteja nela pode ser irmã
  const naFila=new Set(fila.map(q=>q.id));
  const filtroOk=q=>(typeof filtroSessao!=='function')||filtroSessao(q);
  // pool: todas as questões do escopo que podem servir de irmã
  const pool=questions.filter(q=>varNoEscopo(q)&&!q.suspensa&&!(typeof materiaPausada==='function'&&materiaPausada(q))&&filtroOk(q));
  const porDisp=new Map(),porAssunto=new Map();
  pool.forEach(q=>{
    const d=varDispDe(q);if(d){if(!porDisp.has(d))porDisp.set(d,[]);porDisp.get(d).push(q);}
    const k=chaveAssunto(q);if(!porAssunto.has(k))porAssunto.set(k,[]);porAssunto.get(k).push(q);
  });
  const usados=new Set(),dispUsado=new Set();
  const podeSer=(c,orig)=>c.id!==orig.id&&!usados.has(c.id)&&!naFila.has(c.id)
    &&!(typeof ehLeech==='function'&&ehLeech(c))&&!ultimaFoiErro(c)
    &&!((histResp.ultimoTs.get(c.id)||0)>recente)
    &&!(typeof consolidadaAteProva==='function'&&consolidadaAteProva(c));
  const escolher=(lst,orig)=>{
    const c=lst.filter(x=>podeSer(x,orig));if(!c.length)return null;
    return c.find(x=>x.soIrma&&x.varDe===orig.id&&varEhVirgem(x))   // variante feita para esta questão
      ||c.find(x=>x.soIrma&&varEhVirgem(x))                          // variante do mesmo artigo
      ||c.find(x=>x.fonte==='tec'&&varEhVirgem(x))                   // nunca vista no site
      ||c.find(varEhVirgem)
      ||c.slice().sort((a,b)=>(histResp.ultimoTs.get(a.id)||0)-(histResp.ultimoTs.get(b.id)||0))[0];
  };
  let n=0;const out=[];
  for(const q of fila){
    if(n<VAR_MAX_DIA&&varNoEscopo(q)&&!varEhVirgem(q)&&!ultimaFoiErro(q)&&(q.varCont||0)<VAR_RODIZIO){
      const d=varDispDe(q);
      let sub=null;
      if(d&&!dispUsado.has(d))sub=escolher(porDisp.get(d)||[],q);
      // sem irmã do artigo: o subtema, mas só com questões sem artigo identificado
      // ou do MESMO artigo (para não treinar outra regra no lugar desta)
      if(!sub&&!(d&&dispUsado.has(d)))sub=escolher((porAssunto.get(chaveAssunto(q))||[]).filter(c=>{const dc=varDispDe(c);return !dc||dc===d;}),q);
      if(sub){usados.add(sub.id);if(d)dispUsado.add(d);varSubst.set(sub.id,q.id);out.push(sub);n++;continue;}
    }
    out.push(q);
  }
  const vistos=new Set();
  return out.filter(q=>{if(vistos.has(q.id))return false;vistos.add(q.id);return true;});
}

// chamado em rate(), antes do save()
function varPosResposta(q,quality,acertouClique){
  if(!q)return;
  if(q.soIrma)q.soIrma=false;   // respondida, vira questão normal
  const origId=varSubst.get(q.id);
  if(origId!==undefined){
    const o=questions.find(x=>x.id===origId);
    if(o){
      const acertou=quality>0&&acertouClique!==false;
      const d=new Date();
      if(acertou){
        o.varCont=(o.varCont||0)+1;
        d.setDate(d.getDate()+Math.max(VAR_ADIA_MIN,Math.round((o.interval||0)/2)));
      }else{
        o.varCont=VAR_RODIZIO;          // errou a variante: a original volta amanhã, na forma conhecida
        d.setDate(d.getDate()+1);
      }
      o.nextDue=ymd(d);
    }
    varSubst.delete(q.id);
    return;
  }
  if(varNoEscopo(q))q.varCont=0;   // a original apareceu: reinicia o rodízio
}
function varPapel(q){
  if(!q)return null;
  if(varSubst.has(q.id))return q.fonte==='variante'?'variante':'irma';
  return null;
}
function varInfoLog(q){
  const p=varPapel(q);if(!p)return null;
  return{papel:p,orig:varSubst.get(q.id),disp:varDispDe(q)};
}
function varBadge(q){
  const el=document.getElementById('fc-meta');if(!el)return;
  const p=varPapel(q);if(!p)return;
  const s=document.createElement('span');
  s.className='var-badge';
  s.textContent=p==='variante'?'🔁 variante (gerada da lei)':'🔁 irmã no lugar de uma revisão';
  s.title='A questão que venceu hoje foi trocada por outra da mesma regra. Ela volta mais tarde.';
  el.appendChild(document.createTextNode(' '));el.appendChild(s);
}

// ---------- 3: lotes de variantes ----------
function varExportarPedido(){
  const n=Math.max(1,Math.min(300,parseInt((document.getElementById('var-n')||{}).value)||50));
  const frageis=new Set((window.__varFrageis||[]).map(x=>x.k));
  const jaTem=new Set(questions.filter(q=>q.varDe!==undefined).map(q=>q.varDe));
  const cand=questions.filter(q=>varNoEscopo(q)&&!q.suspensa&&!q.soIrma&&q.fonte!=='variante'&&!jaTem.has(q.id)&&(q.comentario||'').trim().length>40&&Array.isArray(q.alternativas)&&q.alternativas.length>=2);
  const score=q=>(frageis.has(varDispDe(q))?100:0)+(q.acertos||0)*3+(q.reps||0)-(q.erros||0)+(varDispDe(q)?5:0);
  cand.sort((a,b)=>score(b)-score(a));
  const sel=cand.slice(0,n);
  if(!sel.length){notify('Nenhuma questão do escopo disponível para gerar variantes','err');return;}
  const pedido={
    tipo:'questia-variantes-pedido',versao:1,geradoEm:new Date().toISOString(),
    instrucoes:'Para cada questão, gerar 2 variantes da MESMA regra (o mesmo dispositivo do gabarito), com roupagem diferente da original: (1) múltipla escolha no estilo FCC, 5 alternativas, distratores que distorcem regras reais (troca de número/prazo, de sujeito, exceção invertida, regra de outro tributo); (2) Certo/Errado ou caso prático curto. Nunca repetir frases da original. Base exclusiva: o comentário e o texto legal citado nele — se não houver base suficiente para uma variante, não gere. Gabarito sempre fundamentado no dispositivo, citado no comentário.',
    formatoResposta:{tipo:'questia-variantes-resposta',versao:1,itens:[{orig:'<id da questão>',variantes:[{dispositivo:'CTN, art. 138, parágrafo único',formato:'mc|ce',questao:'...',alternativas:['...','...'],gabarito:0,comentario:'fundamentação com o dispositivo'}]}]},
    itens:sel.map(q=>({id:q.id,materia:q.materia,subtema:q.subtema,banca:q.banca,dispositivoDetectado:varDispDe(q),questao:String(q.questao||'').slice(0,3000),alternativas:q.alternativas,gabarito:q.gabarito,comentario:String(q.comentario||'').slice(0,3500)}))
  };
  const blob=new Blob([JSON.stringify(pedido,null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`questia-variantes-pedido-${sel.length}q-${today()}.json`;a.click();
  notify(`📤 Pedido de variantes: ${sel.length} questões`,'ok');
}
function varValida(v){
  if(!v||typeof v.questao!=='string'||!v.questao.trim())return false;
  if(!Array.isArray(v.alternativas)||v.alternativas.length<2||v.alternativas.length>5)return false;
  if(!v.alternativas.every(x=>typeof x==='string'&&x.trim()))return false;
  if(!Number.isInteger(v.gabarito)||v.gabarito<0||v.gabarito>=v.alternativas.length)return false;
  return typeof v.comentario==='string'&&v.comentario.trim().length>=20;
}
async function varAplicarLote(d){
  const itens=Array.isArray(d.itens)?d.itens:[];
  const porId=new Map(questions.map(q=>[String(q.id),q]));
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const chaves=new Set(questions.filter(q=>q.fonte==='variante').map(q=>norm(q.questao)));
  const novas=[];let semOrig=0,invalidas=0,repetidas=0;
  itens.forEach(it=>{
    const o=porId.get(String(it.orig));if(!o){semOrig++;return;}
    (Array.isArray(it.variantes)?it.variantes:[]).forEach(v=>{
      if(!varValida(v)){invalidas++;return;}
      const ch=norm(v.questao);if(chaves.has(ch)){repetidas++;return;}chaves.add(ch);
      const q=mkQ({questao:v.questao.trim(),alternativas:v.alternativas.map(x=>x.trim()),gabarito:v.gabarito,comentario:v.comentario.trim(),materia:o.materia,subtema:o.subtema,origem:'variante',banca:'Inédita (variante)'});
      Object.assign(q,{fonte:'variante',soIrma:true,varDe:o.id,varDisp:String(v.dispositivo||'').trim()||varDispDe(o)||null,nextDue:null});
      novas.push(q);
    });
  });
  const lin=[`• ${novas.length} variantes novas`];
  if(repetidas)lin.push(`• ${repetidas} ignoradas: já existem`);
  if(invalidas)lin.push(`• ${invalidas} recusadas: formato incompleto ou sem fundamentação`);
  if(semOrig)lin.push(`• ${semOrig} itens sem a questão original no banco`);
  if(!novas.length){alert('Nada a gravar:\n\n'+lin.join('\n'));return;}
  if(!confirm('Importar variantes?\n\n'+lin.join('\n')+'\n\nElas só aparecem no lugar de uma revisão da mesma regra.'))return;
  if(typeof snapshotSeguranca==='function'){try{await snapshotSeguranca('antes de importar variantes');}catch(e){}}
  questions.push(...novas);save();updateSidebar();
  notify(`🔁 ${novas.length} variantes gravadas`,'ok');
  if(typeof renderLupa==='function')renderLupa();
}

// ---------- 4: regras frágeis ----------
async function varCalcularFrageis(){
  const L=(typeof lerLog==='function')?await lerLog():[];
  const porId=new Map(questions.map(q=>[q.id,q]));
  const by=new Map();L.sort((a,b)=>a.ts-b.ts).forEach(r=>{if(!by.has(r.qid))by.set(r.qid,[]);by.get(r.qid).push(r);});
  const D=new Map();const get=k=>{if(!D.has(k))D.set(k,{k,rn:0,ra:0,nn:0,na:0,vn:0,va:0,mat:''});return D.get(k);};
  by.forEach((lst,qid)=>{
    const q=porId.get(qid);if(!q||!varNoEscopo(q))return;
    const d=varDispDe(q);if(!d)return;
    const o=get(d);o.mat=o.mat||(q.materia||'');
    const hist=(q.acertos||0)+(q.erros||0);
    const antes=Math.max(0,hist-lst.length);   // respostas anteriores ao registro
    lst.forEach((r,i)=>{
      if(r.acertouClique===null||r.acertouClique===undefined)return;
      const ok=r.acertouClique?1:0;
      if(antes+i===0){ if(q.fonte==='variante'){o.vn++;o.va+=ok;} else {o.nn++;o.na+=ok;} }
      else {o.rn++;o.ra+=ok;}
    });
  });
  const lin=[...D.values()].map(o=>{
    const rep=o.rn?Math.round(100*o.ra/o.rn):null;
    const nn=o.nn+o.vn,na=o.na+o.va;const nov=nn?Math.round(100*na/nn):null;
    const gap=(rep!==null&&nov!==null)?rep-nov:null;
    return{...o,rep,nov,nnov:nn,gap,fragil:gap!==null&&o.rn>=VAR_FRAGIL_MIN&&nn>=VAR_FRAGIL_MIN&&gap>=VAR_FRAGIL_GAP};
  });
  window.__varFrageis=lin.filter(x=>x.fragil);
  return lin;
}
async function varPainelHTML(){
  const lin=await varCalcularFrageis();
  const esc0=questions.filter(varNoEscopo);
  const nVar=questions.filter(q=>q.fonte==='variante').length,nVarPend=questions.filter(q=>q.fonte==='variante'&&q.soIrma).length;
  const comDisp=esc0.filter(q=>varDispDe(q)).length;
  const frageis=lin.filter(x=>x.fragil).sort((a,b)=>b.gap-a.gap);
  const quase=lin.filter(x=>!x.fragil&&x.gap!==null&&x.gap>=10&&x.rn>=2&&x.nnov>=2).sort((a,b)=>b.gap-a.gap);
  const cel=(p,n)=>p===null?'—':`${p}% <small>(${n})</small>`;
  const tab=arr=>`<table class="lupa-tab"><thead><tr><th>Dispositivo</th><th>Matéria</th><th>Repetidas</th><th>Novas</th><th>Diferença</th></tr></thead><tbody>
    ${arr.slice(0,40).map(o=>`<tr><td>${esc(o.k)}</td><td>${esc(o.mat)}</td><td>${cel(o.rep,o.rn)}</td><td>${cel(o.nov,o.nnov)}</td><td class="${o.gap>=VAR_FRAGIL_GAP?'ruim':'medio'}">${o.gap>0?'+':''}${o.gap} p.p.</td></tr>`).join('')}</tbody></table>`;
  return `
  <div class="card lupa-card" style="margin-top:14px">
    <div class="lupa-h">🔁 Revisão com variante <span class="lupa-sub" style="font-weight:400">— ${VAR_MATERIAS.join(' + ')} + reforma em outras matérias (sem ZFM)</span></div>
    <div class="lupa-nums"><div><b>${esc0.length}</b><span>questões no escopo</span></div><div><b>${comDisp}</b><span>com artigo identificado</span></div><div><b>${nVar}</b><span>variantes geradas</span></div><div><b>${nVarPend}</b><span>variantes ainda não vistas</span></div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="number" id="var-n" class="config-input" value="50" min="1" max="300" style="width:90px">
      <button class="btn btn-outline btn-sm" onclick="varExportarPedido()">📤 Pedido de variantes</button>
      <label class="btn btn-outline btn-sm" style="cursor:pointer">📥 Importar variantes<input type="file" accept=".json,application/json" style="display:none" onchange="importarLoteFrag(event)"></label>
    </div>
    <div class="lupa-sub">Nas revisões de acerto dessas matérias, a questão vencida é trocada por uma irmã do mesmo artigo (ou variante gerada). A original volta depois de ${VAR_RODIZIO} trocas — ou amanhã, se você errar a variante. O pedido prioriza as regras frágeis.</div>
  </div>
  <div class="card lupa-card" style="margin-top:14px">
    <div class="lupa-h">⚠️ Regras frágeis <span class="lupa-sub" style="font-weight:400">— acerta a questão conhecida, erra a regra em questão nova (diferença ≥ ${VAR_FRAGIL_GAP} p.p., mín. ${VAR_FRAGIL_MIN} respostas de cada lado)</span></div>
    ${frageis.length?tab(frageis):`<div class="lupa-sub">Nenhuma regra frágil com dados suficientes ainda. Ela aparece conforme você responde irmãs e variantes.</div>`}
    ${quase.length?`<div class="lupa-h" style="margin-top:14px;font-size:13px">Em observação (diferença ≥ 10 p.p., poucos dados)</div>${tab(quase)}`:''}
    <div class="lupa-sub">"Novas" = primeira resposta a uma questão nunca vista no site (+ variantes). Questões do TEC podem já ter sido vistas lá — por isso as variantes geradas são a medida mais limpa.</div>
  </div>`;
}
(function(){const s=document.createElement('style');s.textContent=`.var-badge{display:inline-block;font-size:11px;font-weight:700;color:var(--indigo-text);background:var(--indigo-light);border:1px solid var(--indigo-border);border-radius:6px;padding:1px 7px;margin-left:6px}`;document.head.appendChild(s);})();
