// ===== PERFIL PRÉ-EDITAL SEFAZ: MANUTENÇÃO LEVE + ALARME (07/11) =====
// Matérias marcadas "man" no perfil (Auditoria, TI/SQL, Segurança/LGPD) entram no dia
// com cota SEMANAL (PERF_MAN_SEMANA por disciplina, contando o que você já respondeu
// nos últimos 7 dias). O que passa da cota não é apagado nem reagendado: só fica fora
// da fila de hoje, e a vaga vai para as matérias de foco/base.
// ALARME: se o acerto das últimas PERF_ALARME_N respostas da disciplina cair
// PERF_ALARME_QUEDA p.p. ou mais abaixo da SUA média histórica nela, a cota cai
// (a disciplina volta a disputar a fila normalmente) até o acerto se recuperar.
// A referência é você mesmo, não um número fixo: TI no site dá ~60% e na prova FCC
// você faz 10/10 — um corte de 85% dispararia sempre.
const PERF_MAN_SEMANA=6, PERF_ALARME_N=20, PERF_ALARME_QUEDA=15;

function perfilDisciplinasManutencao(){return perfilAtivo()==='sefaz'?EDITAL.filter(d=>d.man):[];}
async function perfilStatusManutencao(){
  const ds=perfilDisciplinasManutencao();if(!ds.length)return[];
  const L=(typeof lerLog==='function')?await lerLog():[];
  L.sort((a,b)=>a.ts-b.ts);
  const semana=Date.now()-7*86400000;
  return ds.map(d=>{
    const mats=new Set(d.m);
    let ac=0,er=0;questions.forEach(q=>{if(mats.has((q.materia||'').trim())){ac+=q.acertos||0;er+=q.erros||0;}});
    const base=ac+er?Math.round(100*ac/(ac+er)):null;
    const meus=L.filter(r=>mats.has((r.materia||'').trim()));
    const comClique=meus.filter(r=>r.acertouClique!==null&&r.acertouClique!==undefined);
    const ult=comClique.slice(-PERF_ALARME_N);
    const recente=ult.length?Math.round(100*ult.filter(r=>r.acertouClique).length/ult.length):null;
    const nSemana=meus.filter(r=>r.ts>=semana).length;
    const alarme=base!==null&&recente!==null&&ult.length>=PERF_ALARME_N&&recente<=base-PERF_ALARME_QUEDA;
    return{n:d.n,mats,base,recente,nUlt:ult.length,nSemana,alarme,cota:alarme?null:Math.max(0,PERF_MAN_SEMANA-nSemana)};
  });
}
async function perfilLimitarManutencao(fila,statsMap){
  const st=await perfilStatusManutencao();if(!st.length)return fila;
  const disc=q=>st.find(s=>s.mats.has((q.materia||'').trim()));
  const usados=new Map();let cortadas=0;
  const out=fila.filter(q=>{
    const s=disc(q);if(!s||s.alarme)return true;
    const u=usados.get(s.n)||0;
    if(u<s.cota){usados.set(s.n,u+1);return true;}
    cortadas++;return false;
  });
  // devolve as vagas às matérias de foco/base (revisões vencidas que ficaram de fora)
  if(cortadas){
    const naFila=new Set(out.map(q=>q.id));
    const pool=questions.filter(q=>naSessao(q)&&!naFila.has(q.id)&&!disc(q));
    const extra=(typeof ordenarRevisoes==='function'?ordenarRevisoes(pool,statsMap||estatisticasPorAssunto()):pool).slice(0,cortadas);
    out.push(...extra);
  }
  const al=st.filter(s=>s.alarme);
  if(al.length){
    const k='questia_perfil_alarme_'+today();
    try{if(!localStorage.getItem(k)){localStorage.setItem(k,'1');notify(`🚨 Manutenção: ${al.map(s=>`${s.n} caiu para ${s.recente}% (sua média: ${s.base}%)`).join(' · ')} — voltou a disputar a fila até se recuperar`,'err');}}catch(e){}
  }
  return out;
}
function perfilTrocar(p){
  if(p===perfilAtivo())return;
  const txt=p==='sefaz'
    ?'Ativar o perfil PRÉ-EDITAL SEFAZ (FCC)?\n\n• Foco: Direito Tributário + reforma; base: Contabilidade, Português, Economia...\n• Manutenção leve: Auditoria, TI/SQL, Segurança/LGPD (cota semanal + alarme)\n• Matérias fora do perfil (LTM, ZFM, Penal, Processo Civil, Inglês, AFO...) ficam pausadas\n\nNada é apagado nem reagendado. Dá para voltar ao perfil ISS Manaus a qualquer momento.'
    :'Voltar ao perfil ISS MANAUS (edital antigo)?\n\nAs matérias pausadas pelo perfil SEFAZ voltam à fila.';
  if(!confirm(txt))return;
  try{localStorage.setItem(CHAVE_PERFIL,p);}catch(e){notify('Não foi possível salvar o perfil','err');return;}
  location.reload();
}
async function perfilRenderCard(){
  const wrap=document.getElementById('meta-body');if(!wrap)return;
  let el=document.getElementById('perfil-card');
  if(!el){el=document.createElement('div');el.id='perfil-card';el.className='card';el.style.cssText='padding:16px 18px;margin-bottom:14px';wrap.parentNode.insertBefore(el,wrap);}
  const p=perfilAtivo();
  const st=await perfilStatusManutencao();
  const foraN=p==='sefaz'?new Set(questions.filter(q=>materiaForaDoEdital(q.materia)).map(q=>(q.materia||'').trim())):new Set();
  el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><div style="font-weight:700;font-size:14px">🧭 Perfil de preparação</div>
      <div style="font-size:12px;color:var(--muted)">${p==='sefaz'?'Pré-edital SEFAZ (FCC) — pesos estimados das provas recentes; troque pelo edital real quando sair.':'ISS Manaus AFTM (edital de 01/11/2026).'}</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn ${p==='sefaz'?'btn-primary':'btn-outline'} btn-sm" onclick="perfilTrocar('sefaz')">Pré-edital SEFAZ</button>
        <button class="btn ${p==='manaus'?'btn-primary':'btn-outline'} btn-sm" onclick="perfilTrocar('manaus')">ISS Manaus</button>
      </div>
    </div>
    ${p==='sefaz'?`
    <table class="lupa-tab" style="margin-top:12px"><thead><tr><th>Disciplina</th><th>Faixa</th><th>Peso</th></tr></thead><tbody>
      ${EDITAL.slice().sort((a,b)=>b.pts-a.pts).map(d=>`<tr><td>${esc(d.n)}</td><td>${d.man?'🔧 manutenção':d.foco?'🎯 foco':'📘 base (mínimo)'}</td><td>${d.pts}</td></tr>`).join('')}
    </tbody></table>
    ${st.length?`<div style="font-weight:700;font-size:13px;margin-top:14px">🔧 Manutenção (cota de ${PERF_MAN_SEMANA}/semana · alarme: −${PERF_ALARME_QUEDA} p.p. da sua média nas últimas ${PERF_ALARME_N})</div>
    <table class="lupa-tab"><thead><tr><th>Disciplina</th><th>Sua média</th><th>Últimas ${PERF_ALARME_N}</th><th>Esta semana</th><th>Situação</th></tr></thead><tbody>
      ${st.map(s=>`<tr><td>${esc(s.n)}</td><td>${s.base===null?'—':s.base+'%'}</td><td>${s.recente===null?'—':s.recente+'% <small>('+s.nUlt+')</small>'}</td><td>${s.nSemana}</td><td class="${s.alarme?'ruim':'bom'}">${s.alarme?'🚨 alarme — fila normal':s.nUlt<PERF_ALARME_N?'ok (poucos dados p/ alarme)':'ok'}</td></tr>`).join('')}
    </tbody></table>`:''}
    <div style="font-size:11.5px;color:var(--muted);margin-top:10px">Pausadas pelo perfil (${foraN.size}): ${[...foraN].sort().map(esc).join(', ')||'—'}.</div>`:''}`;
}
