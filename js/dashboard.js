// ===== DASHBOARD POR DISCIPLINA / ASSUNTO (v2) =====
// Lê o banco em memória (questions) e o registro datado de respostas (lerLog).
//  - Resolvidas / % de acerto: contadores da própria questão (mesmo número das Estatísticas).
//  - Faltam ver: questões de BANCA importadas nunca respondidas aqui / total de banca importado.
//  - Curva: respostas do log em ordem cronológica, agrupadas em pontos (grupos de respostas seguidas).
//    Melhora/queda só é declarada se a diferença entre a 1ª e a 2ª metade for >= 5 pontos
//    percentuais e estatisticamente provável (teste de duas proporções, ~80% de confiança).
const DASH_PAD={crit:'nota',escopo:'todas',origem:'todas',ord:'faltam',incSusp:false,min:8};
let DASH=Object.assign({},DASH_PAD);
try{Object.assign(DASH,JSON.parse(localStorage.getItem('questia_dash_cfg')||'{}'));}catch(e){}
if(DASH.soBanca)DASH.origem='banca';   // migra a caixinha da versão anterior
delete DASH.soBanca;
window.__dashT=[];

function dashSet(k,v){
  DASH[k]=v;
  try{localStorage.setItem('questia_dash_cfg',JSON.stringify(DASH));}catch(e){}
  renderDashboard();
}
function dashAbrirTodas(abrir){document.querySelectorAll('#dash-corpo details').forEach(d=>d.open=!!abrir);}
function dashPct(a){return a.length?a.filter(x=>x.ok).length/a.length*100:null;}
function dashDia(ts){const d=new Date(ts);return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0');}

function dashTend(arr,min){
  const v=arr.filter(x=>x.ok!==null&&x.ok!==undefined);
  const n=v.length;
  if(n<min)return{n,tipo:'poucos',pts:[],b:[]};
  const h=Math.floor(n/2),A=v.slice(0,h),B=v.slice(h);
  const pa=dashPct(A),pb=dashPct(B),d=pb-pa;
  const pool=v.filter(x=>x.ok).length/n;
  const se=Math.sqrt(pool*(1-pool)*(1/A.length+1/B.length));
  const z=se>0?Math.abs(d)/100/se:0;
  let tipo='estavel';
  if(Math.abs(d)>=5&&z>=1.28)tipo=d>0?'melhora':'queda';
  const k=Math.max(2,Math.min(14,Math.floor(n/5)));
  const b=[];
  for(let i=0;i<k;i++){
    const seg=v.slice(Math.floor(i*n/k),Math.floor((i+1)*n/k));
    b.push({pct:dashPct(seg),n:seg.length,ini:seg[0].ts,fim:seg[seg.length-1].ts});
  }
  // reta de tendência (mínimos quadrados) sobre os pontos
  let sx=0,sy=0,sxy=0,sxx=0;
  b.forEach((p,i)=>{sx+=i;sy+=p.pct;sxy+=i*p.pct;sxx+=i*i;});
  const den=k*sxx-sx*sx,slope=den?(k*sxy-sx*sy)/den:0,inter=(sy-slope*sx)/k;
  return{n,tipo,d,pa,pb,pts:b.map(p=>p.pct),b,reg:{a:inter,s:slope}};
}
function dashSpark(pts,tipo,w,h){
  w=w||84;h=h||24;
  if(!pts||pts.length<2)return'<span style="color:var(--muted)">—</span>';
  const cor=tipo==='melhora'?'var(--green)':tipo==='queda'?'var(--accent)':'var(--muted)';
  const px=i=>2+i*(w-4)/(pts.length-1),py=v=>h-2-(v/100)*(h-4);
  const path=pts.map((v,i)=>(i?'L':'M')+px(i).toFixed(1)+' '+py(v).toFixed(1)).join(' ');
  const u=pts.length-1;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle"><path d="${path}" fill="none" style="stroke:${cor}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${px(u).toFixed(1)}" cy="${py(pts[u]).toFixed(1)}" r="2.4" style="fill:${cor}"/></svg>`;
}
// Gráfico grande: eixo de 0 a 100%, pontos com valor, reta de tendência,
// volume de respostas ao fundo e as linhas de piso e meta da aba Meta.
function dashGrafico(t,H){
  if(!t.b||t.b.length<2)return`<div class="dash-vazio">Poucos dados para desenhar a curva (${t.n||0} resposta${t.n===1?'':'s'} contabilizada${t.n===1?'':'s'}; o mínimo é ${DASH.min}).</div>`;
  H=H||190;
  const W=640,ml=38,mr=16,mt=18,mb=24,pw=W-ml-mr,ph=H-mt-mb,k=t.b.length;
  const X=i=>ml+i*pw/(k-1),Y=v=>mt+ph-(Math.max(0,Math.min(100,v))/100)*ph;
  const cor=t.tipo==='melhora'?'var(--green)':t.tipo==='queda'?'var(--accent)':'var(--accent2)';
  const cfg=metaCfg();
  let s=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;overflow:visible" role="img" aria-label="Evolução do acerto ao longo do tempo">`;
  [0,25,50,75,100].forEach(g=>{
    s+=`<line x1="${ml}" x2="${W-mr}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}" style="stroke:var(--border)" stroke-width="1"/>`
      +`<text x="${ml-7}" y="${(Y(g)+3).toFixed(1)}" text-anchor="end" font-size="10" style="fill:var(--muted)">${g}%</text>`;
  });
  const maxN=Math.max(...t.b.map(x=>x.n)),bw=Math.min(30,pw/k*0.55);
  t.b.forEach((x,i)=>{
    const h=(x.n/maxN)*ph*0.24;
    s+=`<rect x="${(X(i)-bw/2).toFixed(1)}" y="${(mt+ph-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" style="fill:var(--border2)" opacity=".55"><title>${x.n} respostas neste ponto</title></rect>`;
  });
  [[cfg.pisoProva,'piso','var(--yellow)'],[cfg.alvo,'meta','var(--accent2)']].forEach(([v,r,c])=>{
    const y=Y(v*100).toFixed(1);
    s+=`<line x1="${ml}" x2="${W-mr}" y1="${y}" y2="${y}" stroke-dasharray="4 4" style="stroke:${c}" opacity=".75"/>`
      +`<text x="${W-mr}" y="${(y-4)}" text-anchor="end" font-size="9.5" style="fill:${c}">${r} ${Math.round(v*100)}%</text>`;
  });
  const linha=t.b.map((p,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(p.pct).toFixed(1)).join(' ');
  s+=`<path d="${linha} L${X(k-1).toFixed(1)} ${(mt+ph)} L${X(0).toFixed(1)} ${(mt+ph)} Z" style="fill:${cor}" opacity=".10"/>`;
  s+=`<path d="${linha}" fill="none" style="stroke:${cor}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  if(t.reg)s+=`<line x1="${X(0).toFixed(1)}" y1="${Y(t.reg.a).toFixed(1)}" x2="${X(k-1).toFixed(1)}" y2="${Y(t.reg.a+t.reg.s*(k-1)).toFixed(1)}" stroke-dasharray="6 4" stroke-width="1.6" style="stroke:var(--ink2)" opacity=".8"/>`;
  const passo=Math.ceil(k/7);
  t.b.forEach((p,i)=>{
    const rot=dashDia(p.ini)===dashDia(p.fim)?dashDia(p.fim):dashDia(p.ini)+'–'+dashDia(p.fim);
    s+=`<circle cx="${X(i).toFixed(1)}" cy="${Y(p.pct).toFixed(1)}" r="4" style="fill:var(--surface);stroke:${cor}" stroke-width="2.2"><title>${rot} · ${Math.round(p.pct)}% de acerto · ${p.n} respostas</title></circle>`;
    if(k<=10){
      const yy=Y(p.pct)<mt+10?Y(p.pct)+16:Y(p.pct)-9;
      s+=`<text x="${X(i).toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" style="fill:var(--ink)">${Math.round(p.pct)}</text>`;
    }
    if(i%passo===0||i===k-1)s+=`<text x="${X(i).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="9.5" style="fill:var(--muted)">${dashDia(p.fim)}</text>`;
  });
  return s+'</svg>';
}
function dashLegenda(t){
  if(!t.b||t.b.length<2)return'';
  return `Cada ponto = cerca de ${Math.round(t.n/t.b.length)} respostas seguidas (${t.n} no total, de ${dashDia(t.b[0].ini)} a ${dashDia(t.b[t.b.length-1].fim)}). Linha tracejada escura = tendência. Barras cinza = quantas respostas há em cada ponto.`;
}
// selo: mostra o acerto de antes e de agora (a diferença em "pontos percentuais" fica no balão)
function dashBadge(t){
  if(t.tipo==='poucos')return`<span class="dash-b dash-b-n">poucos dados${t.n?' ('+t.n+')':''}</span>`;
  const dd=Math.round(t.d),txt=Math.round(t.pa)+'% → '+Math.round(t.pb)+'%';
  const dica=`Acerto na 1ª metade das respostas: ${Math.round(t.pa)}%. Na 2ª metade: ${Math.round(t.pb)}%. Diferença: ${dd>0?'+':''}${dd} pontos percentuais.`;
  if(t.tipo==='melhora')return`<span class="dash-b dash-b-up" title="${dica}">▲ ${txt}</span>`;
  if(t.tipo==='queda')return`<span class="dash-b dash-b-dn" title="${dica}">▼ ${txt}</span>`;
  return`<span class="dash-b dash-b-eq" title="${dica} — variação pequena demais para valer como mudança.">▬ estável (${txt})</span>`;
}
function dashCorAcerto(p){return p===null?'var(--muted)':p<50?'var(--accent)':p<75?'var(--yellow)':'var(--green)';}
function dashFmt(p){return p===null?'—':Math.round(p)+'%';}
function dashToggleCurva(i){
  const tr=document.getElementById('dashx-'+i);if(!tr)return;
  const abre=tr.style.display==='none';
  tr.style.display=abre?'table-row':'none';
  const box=document.getElementById('dashxc-'+i);
  if(abre&&box&&!box.innerHTML){const t=window.__dashT[i];box.innerHTML=dashGrafico(t,170)+'<div class="dash-cap">'+dashLegenda(t)+'</div>';}
}

async function renderDashboard(){
  const el=document.getElementById('dash-corpo');if(!el)return;
  const set=(id,v,chk)=>{const e=document.getElementById(id);if(e){if(chk)e.checked=!!v;else e.value=v;}};
  set('dash-crit',DASH.crit);set('dash-escopo',DASH.escopo);set('dash-ord',DASH.ord);set('dash-min',DASH.min);set('dash-origem',DASH.origem);
  set('dash-incsusp',DASH.incSusp,true);
  el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px 0">Lendo o histórico…</div>';
  window.__dashT=[];

  let L=(await lerLog()).slice().sort((a,b)=>a.ts-b.ts);
  const temLog=L.length>0;
  if(DASH.origem==='banca')L=L.filter(x=>x.fonte==='tec');
  else if(DASH.origem==='ia')L=L.filter(x=>x.fonte!=='tec');
  if(DASH.escopo==='primeira'){const vistos=new Set();L=L.filter(x=>{if(vistos.has(x.qid))return false;vistos.add(x.qid);return true;});}
  const okDe=x=>{
    if(DASH.crit==='clique')return(x.acertouClique===null||x.acertouClique===undefined)?null:!!x.acertouClique;
    return(x.nota===null||x.nota===undefined)?null:x.nota!==0;
  };

  const porId=new Map(questions.map(q=>[q.id,q]));
  const EDT=new Map(EDITAL.map(d=>[d.n,d]));
  const grupos=new Map();
  const getG=n=>{if(!grupos.has(n)){const e=EDT.get(n);grupos.set(n,{nome:n,pts:e?e.pts:0,prova:e?e.p:'',ass:new Map(),log:[],tot:0,vistas:0,resp:0,ac:0});}return grupos.get(n);};
  const getA=(g,materia,subtema)=>{const k=materia+'§'+subtema;if(!g.ass.has(k))g.ass.set(k,{materia,subtema,tot:0,vistas:0,resp:0,ac:0,log:[]});return g.ass.get(k);};

  questions.forEach(q=>{
    const ehTec=(q.fonte||'ia')==='tec';
    if(DASH.origem==='banca'&&!ehTec)return;
    if(DASH.origem==='ia'&&ehTec)return;
    const materia=(q.materia||'—').trim()||'—',subtema=(q.subtema||'—').trim()||'—';
    const g=getG(disciplinaDaMateria(materia)),a=getA(g,materia,subtema);
    const resp=(q.acertos||0)+(q.erros||0);
    a.resp+=resp;a.ac+=q.acertos||0;
    if(ehTec&&(DASH.incSusp||!q.suspensa)){a.tot++;if(resp>0||(q.reps||0)>0)a.vistas++;}
  });
  L.forEach(x=>{
    const q=porId.get(x.qid);
    const materia=((q?q.materia:x.materia)||'—').trim()||'—',subtema=((q?q.subtema:x.subtema)||'—').trim()||'—';
    const g=getG(disciplinaDaMateria(materia)),a=getA(g,materia,subtema);
    const item={ok:okDe(x),ts:x.ts};
    a.log.push(item);g.log.push(item);
  });

  const lista=[...grupos.values()];
  lista.forEach(g=>{
    g.assArr=[...g.ass.values()].filter(a=>a.tot>0||a.resp>0||a.log.length>0);
    g.assArr.forEach(a=>{a.pct=a.resp?a.ac/a.resp*100:null;a.faltam=a.tot?(a.tot-a.vistas)/a.tot*100:null;a.t=dashTend(a.log,DASH.min);g.tot+=a.tot;g.vistas+=a.vistas;g.resp+=a.resp;g.ac+=a.ac;});
    g.pct=g.resp?g.ac/g.resp*100:null;
    g.faltam=g.tot?(g.tot-g.vistas)/g.tot*100:null;
    g.t=dashTend(g.log,DASH.min);
  });
  const visiveis=lista.filter(g=>g.assArr.length&&(g.prova||g.resp>0||g.tot>0));
  EDITAL.forEach(d=>{if(!visiveis.some(g=>g.nome===d.n))visiveis.push({nome:d.n,pts:d.pts,prova:d.p,assArr:[],tot:0,vistas:0,resp:0,ac:0,pct:null,faltam:null,t:{tipo:'poucos',n:0,pts:[],b:[]},vazia:true});});
  visiveis.sort((a,b)=>(a.prova?0:1)-(b.prova?0:1)||b.pts-a.pts||a.nome.localeCompare(b.nome,'pt-BR'));

  const todosAss=[];
  visiveis.forEach(g=>g.assArr.forEach(a=>todosAss.push({g,a})));
  const tRespTot=visiveis.reduce((s,g)=>s+g.resp,0),tAcTot=visiveis.reduce((s,g)=>s+g.ac,0);
  const tBanca=visiveis.reduce((s,g)=>s+g.tot,0),tVistas=visiveis.reduce((s,g)=>s+g.vistas,0);
  const nMel=todosAss.filter(x=>x.a.t.tipo==='melhora').length,nQue=todosAss.filter(x=>x.a.t.tipo==='queda').length,
        nEst=todosAss.filter(x=>x.a.t.tipo==='estavel').length,nPou=todosAss.filter(x=>x.a.t.tipo==='poucos').length;
  const tGeral=dashTend(L.map(x=>({ok:okDe(x),ts:x.ts})),DASH.min);
  const rotOrigem={todas:'banca + IA',banca:'só questões de banca',ia:'só questões geradas por IA'}[DASH.origem];

  let html='';
  if(!temLog)html+='<div class="import-warning" style="margin-bottom:18px"><strong>Sem registro datado de respostas.</strong> Resolvidas, acerto e "faltam ver" funcionam, mas a curva precisa do registro que o app grava a cada resposta — ele passa a existir conforme você estuda.</div>';
  html+=`<div style="font-size:12px;color:var(--muted);margin-bottom:12px">Mostrando: <strong style="color:var(--ink2)">${rotOrigem}</strong>${DASH.escopo==='primeira'?' · curva só com a 1ª resposta de cada questão':''}</div>`;
  html+=`<div class="dash-resumo">
    <div><b>${tRespTot.toLocaleString('pt-BR')}</b><span>respostas registradas</span></div>
    <div><b style="color:${dashCorAcerto(tRespTot?tAcTot/tRespTot*100:null)}">${dashFmt(tRespTot?tAcTot/tRespTot*100:null)}</b><span>acerto geral</span></div>
    <div><b>${tBanca?Math.round(100*tVistas/tBanca)+'%':'—'}</b><span>da banca já vista (${tVistas.toLocaleString('pt-BR')} de ${tBanca.toLocaleString('pt-BR')})</span></div>
    <div><b style="color:var(--yellow)">${tBanca?Math.round(100*(tBanca-tVistas)/tBanca)+'%':'—'}</b><span>da banca falta ver</span></div>
    <div><b><span style="color:var(--green)">${nMel}</span> <span style="color:var(--muted);font-size:20px">/</span> <span style="color:var(--accent)">${nQue}</span> <span style="color:var(--muted);font-size:20px">/</span> ${nEst}</b><span>assuntos: melhora / queda / estável (${nPou} sem dados)</span></div>
  </div>`;
  html+=`<div class="card dash-card" style="margin-bottom:18px">
    <div class="dash-card-head"><div><h3>Evolução geral do acerto</h3><small>Todas as disciplinas juntas</small></div><div style="white-space:nowrap">${dashBadge(tGeral)}</div></div>
    <div class="dash-grafico">${dashGrafico(tGeral,210)}<div class="dash-cap">${dashLegenda(tGeral)}</div></div>
  </div>`;

  const quedas=todosAss.filter(x=>x.a.t.tipo==='queda').sort((x,y)=>x.a.t.d-y.a.t.d).slice(0,6);
  const melhoras=todosAss.filter(x=>x.a.t.tipo==='melhora').sort((x,y)=>y.a.t.d-x.a.t.d).slice(0,6);
  const itemLista=x=>`<div class="dash-lista-item"><div>${esc(x.a.subtema)}<small>${esc(x.g.nome)}</small></div><div style="white-space:nowrap">${dashSpark(x.a.t.pts,x.a.t.tipo,64,20)}${dashBadge(x.a.t)}</div></div>`;
  html+=`<div class="dash-listas">
    <div class="card dash-lista"><h4>Assuntos que pioraram</h4>${quedas.length?quedas.map(itemLista).join(''):'<div style="font-size:12px;color:var(--muted)">Nenhum assunto com queda comprovada até agora.</div>'}</div>
    <div class="card dash-lista"><h4>Assuntos que melhoraram</h4>${melhoras.length?melhoras.map(itemLista).join(''):'<div style="font-size:12px;color:var(--muted)">Nenhum assunto com melhora comprovada ainda (mín. '+DASH.min+' respostas por assunto).</div>'}</div>
  </div>`;

  const ordena=arr=>{
    const c=arr.slice();
    if(DASH.ord==='alfa')c.sort((a,b)=>a.subtema.localeCompare(b.subtema,'pt-BR'));
    else if(DASH.ord==='acerto')c.sort((a,b)=>(a.pct===null)-(b.pct===null)||(a.pct-b.pct));
    else if(DASH.ord==='resp')c.sort((a,b)=>b.resp-a.resp);
    else if(DASH.ord==='queda')c.sort((a,b)=>((a.t.d===undefined)-(b.t.d===undefined))||(a.t.d-b.t.d));
    else c.sort((a,b)=>((b.faltam===null?-1:b.faltam)-(a.faltam===null?-1:a.faltam))||(b.tot-a.tot));
    return c;
  };
  const linhaAss=a=>{
    const i=window.__dashT.push(a.t)-1;
    return `<tr>
      <td>${esc(a.subtema)}<small>${esc(a.materia)}</small></td>
      <td>${a.tot||'—'}</td>
      <td>${a.tot?a.vistas:'—'}</td>
      <td>${a.faltam===null?'—':Math.round(a.faltam)+'%'+'<span class="dash-mini"><i style="width:'+a.faltam+'%"></i></span>'}</td>
      <td>${a.resp}</td>
      <td style="color:${dashCorAcerto(a.pct)};font-weight:700">${dashFmt(a.pct)}</td>
      <td style="white-space:nowrap">${dashSpark(a.t.pts,a.t.tipo,64,20)}${dashBadge(a.t)}${a.t.b&&a.t.b.length>1?`<button class="dash-btn-curva" onclick="dashToggleCurva(${i})" title="Abrir a curva completa deste assunto">📈</button>`:''}</td>
    </tr><tr id="dashx-${i}" style="display:none"><td colspan="7" style="text-align:left;padding:10px 4px 14px"><div id="dashxc-${i}"></div></td></tr>`;
  };

  html+='<div class="dash-grid">';
  visiveis.forEach(g=>{
    const seen=g.tot?100*g.vistas/g.tot:0;
    html+=`<div class="card dash-card">
      <div class="dash-card-head">
        <div><h3>${esc(g.nome)}</h3><small>${g.prova?'Prova '+g.prova+' · '+Math.round(g.pts)+' pts':'fora do edital'} · ${g.assArr.length} assunto${g.assArr.length===1?'':'s'}</small></div>
        <div style="white-space:nowrap">${dashBadge(g.t)}</div>
      </div>
      <div class="dash-tiles">
        <div class="dash-tile"><b>${g.resp.toLocaleString('pt-BR')}</b><span>resolvidas</span></div>
        <div class="dash-tile"><b style="color:${dashCorAcerto(g.pct)}">${dashFmt(g.pct)}</b><span>de acerto</span></div>
        <div class="dash-tile"><b>${g.tot?Math.round(seen)+'%':'—'}</b><span>da banca vista</span></div>
        <div class="dash-tile"><b style="color:${g.tot?'var(--yellow)':'var(--muted)'}">${g.tot?Math.round(100-seen)+'%':'—'}</b><span>falta ver</span></div>
      </div>
      <div class="dash-barra"><div style="width:${seen}%"></div></div>
      <div class="dash-barra-leg"><span>${g.tot?g.vistas.toLocaleString('pt-BR')+' vistas de '+g.tot.toLocaleString('pt-BR')+' questões de banca importadas':(g.vazia?'nenhuma questão importada desta disciplina':'sem questões de banca ativas neste filtro')}</span><span>${g.tot?(g.tot-g.vistas).toLocaleString('pt-BR')+' faltam':''}</span></div>
      <div class="dash-grafico"><div class="dash-gtitle">Evolução do acerto</div>${dashGrafico(g.t,180)}<div class="dash-cap">${dashLegenda(g.t)}</div></div>`;
    if(g.assArr.length){
      html+=`<details><summary>Ver ${g.assArr.length} assunto${g.assArr.length===1?'':'s'}</summary><div class="dash-scroll"><table class="dash-tab">
        <tr><th>Assunto</th><th>Banca</th><th>Vistas</th><th>Falta ver</th><th>Resolvidas</th><th>Acerto</th><th>Curva</th></tr>
        ${ordena(g.assArr).map(linhaAss).join('')}
      </table></div></details>`;
    }
    html+='</div>';
  });
  html+='</div>';

  html+=`<div class="dash-nota">
    <strong>Como ler.</strong> <em>Resolvidas</em> e <em>acerto</em> vêm dos contadores de cada questão (só "Errei" conta como erro, como nas Estatísticas).
    <em>Falta ver</em> = questões de banca importadas que você ainda não respondeu, sobre o total de banca importado — mede o seu banco, não o universo do TecConcursos.<br>
    <strong>Curva.</strong> As respostas do assunto são ordenadas no tempo e comparadas: 1ª metade contra 2ª metade. O selo <em>▲ 50% → 62%</em> diz o acerto de antes e o de agora.
    A diferença entre os dois é medida em <em>pontos percentuais</em> (50% → 62% = +12 pontos percentuais, e não "+12%"). Só vale como melhora ou queda se for de pelo menos 5 pontos e provável (não acaso); senão aparece "estável".<br>
    <strong>Cuidado.</strong> Com <em>Todas as respostas</em>, parte da melhora pode ser memorização das mesmas questões. Troque para <em>Só a 1ª vez de cada questão</em> para medir aprendizado real.
  </div>`;
  el.innerHTML=html;
}
