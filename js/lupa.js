// ===== LUPA: "como acertei?" + itens curtos por dispositivo =====
// Ideia: a questão inteira esconde lacunas. Quem acerta porque a alternativa certa
// era a mais forte, ou por eliminação, conta como "acertou" — mas a regra da
// alternativa ao lado continua desconhecida (o caso do TRUNCATE). Aqui:
//  1) depois de cada acerto, um clique diz COMO acertou (certeza/eliminação/chute);
//     eliminação e chute marcam a questão como lacuna. Não mexe no SM-2.
//  2) as questões erradas ou com lacuna das matérias do escopo são exportadas em
//     lote (mesmo fluxo do "Na prática"); a resposta volta como ITENS curtos —
//     múltipla escolha direta ou Certo/Errado — cada um com o dispositivo legal.
//  3) os itens têm revisão espaçada própria e um painel de acerto POR DISPOSITIVO.
// Os itens ficam num registro próprio (meta 'fragmentos'), fora do banco de
// questões: não entram na fila do Estudar, na projeção de nota nem nas estatísticas.

const LUPA_MATERIAS=['Direito Tributário','Reforma Tributária','Legislação Tributária Federal'];
const LUPA_SESSAO_MAX=30;
const FRAG_LOTES_KEY='questia_frag_lotes', FRAG_SEQ_KEY='questia_frag_seq';

let fragmentos=[], fragCarregado=false;
async function carregarFragmentos(forcar){
  if(fragCarregado&&!forcar)return;
  try{
    if(idbOk)fragmentos=(await idbLer(ST_META,'fragmentos'))||[];
    else fragmentos=JSON.parse(localStorage.getItem('questia_fragmentos')||'[]');
    if(!Array.isArray(fragmentos))fragmentos=[];
  }catch(e){fragmentos=[];}
  fragCarregado=true;
}
async function salvarFragmentos(){
  try{
    if(idbOk)await idbGravar(ST_META,fragmentos,'fragmentos');
    else localStorage.setItem('questia_fragmentos',JSON.stringify(fragmentos));
  }catch(e){notify('❌ Falha ao salvar os itens da Lupa: '+(e&&e.message||e),'err');}
}

// ---------- 1) "Como acertei?" ----------
let lupaComo=null;
function lupaEsconderComo(){lupaComo=null;const el=document.getElementById('fc-como');if(el)el.style.display='none';}
// 07/11: as fichas "Como acertei?" saíram do card — responder duas vezes era atrito.
// A dúvida agora vem do botão de avaliação (Difícil / Bom repetido, ver lupaNotas).
// As marcações antigas (q.comoAcertei/q.lacunas) continuam valendo.
function lupaMostrarComo(acertou){
  lupaComo=null;
  const el=document.getElementById('fc-como');if(!el)return;
  el.style.display='none';
  el.querySelectorAll('button').forEach(b=>b.classList.remove('on'));
}
function lupaEscolherComo(v){
  lupaComo=(lupaComo===v)?null:v;
  document.querySelectorAll('#fc-como button').forEach(b=>b.classList.toggle('on',b.dataset.v===lupaComo));
}
// Chamado por rate(): grava na questão e devolve o valor para o registro de respostas.
function lupaConsumirComo(q,acertou){
  const v=acertou?lupaComo:null;
  lupaEsconderComo();
  if(!v||!q)return null;
  q.comoAcertei=v;
  if(v!=='certeza'){q.lacunas=(q.lacunas||0)+1;q.lacunaEm=today();}
  return v;
}

// ---------- 2) Exportar / importar fragmentação ----------
function lerLotesFrag(){try{const v=JSON.parse(localStorage.getItem(FRAG_LOTES_KEY)||'[]');return Array.isArray(v)?v:[];}catch(e){return[];}}
function salvarLotesFrag(l){try{localStorage.setItem(FRAG_LOTES_KEY,JSON.stringify(l));}catch(e){}}
function idsPendentesFrag(){const s=new Set();lerLotesFrag().forEach(l=>(l.ids||[]).forEach(id=>s.add(String(id))));return s;}
function liberarLoteFrag(nome){
  if(!confirm(`Liberar o lote "${nome}"?\n\nAs questões dele voltam para a fila de fragmentação. Use só se o arquivo de resposta não vai mais voltar.`))return;
  salvarLotesFrag(lerLotesFrag().filter(l=>l.nome!==nome));renderLupa();
}
// Dúvida pelo botão de avaliação, lida do registro de respostas (vale para o passado):
// Difícil = acertou com dúvida forte; Bom = desempenho mediano (conta só se repetido,
// 2+ vezes na mesma questão, para não inundar a Lupa). Fácil/Dominada = certeza.
let lupaNotas=new Map();
async function lupaCarregarNotas(){
  const L=(typeof lerLog==='function')?await lerLog():[];
  const m=new Map();
  L.forEach(r=>{if(r.nota!==1&&r.nota!==2)return;const o=m.get(r.qid)||{d:0,b:0,ultD:'',ultB:''};
    if(r.nota===1){o.d++;if(r.dia>o.ultD)o.ultD=r.dia;}else{o.b++;if(r.dia>o.ultB)o.ultB=r.dia;}m.set(r.qid,o);});
  lupaNotas=m;return m;
}
const LUPA_BOM_MIN=2;
function lupaDuvida(q){
  const o=lupaNotas.get(q.id);
  const d=o?o.d:0, b=o&&o.b>=LUPA_BOM_MIN?o.b:0;
  const ult=[o&&o.d?o.ultD:'',o&&b?o.ultB:'',q.lacunaEm||''].sort().pop();
  return{d,b,ult,tem:d>0||b>0||(q.lacunas||0)>0};
}
// Candidata: matéria do escopo, com comentário, não suspensa, e com erro ou lacuna
// ainda não fragmentada (ou com lacuna NOVA depois da última fragmentação).
function motivoFrag(q){
  const m=[];
  if((q.erros||0)>0)m.push(`errou ${q.erros}x`);
  const du=lupaDuvida(q);
  if(du.d)m.push(`acertou com dúvida (Difícil) ${du.d}x`);
  if(du.b)m.push(`desempenho mediano (Bom) ${du.b}x`);
  if((q.lacunas||0)>0)m.push(q.comoAcertei==='chute'?'acertou no chute':'acertou por eliminação/chute');
  return m.join(' · ');
}
function candidatasFrag(){
  const pend=idsPendentesFrag();
  return questions.filter(q=>{
    if(q.suspensa||!q.comentario||!LUPA_MATERIAS.includes((q.materia||'').trim()))return false;
    if(pend.has(String(q.id)))return false;
    const temErro=(q.erros||0)>0, du=lupaDuvida(q);
    if(!temErro&&!du.tem)return false;
    if(!q.fragmentadaEm)return true;
    return !!(du.ult&&du.ult>q.fragmentadaEm);
  }).sort((a,b)=>{
    // prioridade: erro > Difícil > Bom repetido/ficha antiga; dentro, o mais recente
    const pr=q=>{const du=lupaDuvida(q);return (q.erros||0)>0?0:du.d>0?1:2;};
    return pr(a)-pr(b)||String(lupaDuvida(b).ult).localeCompare(String(lupaDuvida(a).ult))||((b.erros||0)-(a.erros||0));
  });
}
function exportarLoteFrag(){
  const n=Math.max(1,Math.min(300,+(document.getElementById('frag-n')||{}).value||60));
  const alvo=candidatasFrag().slice(0,n);
  if(!alvo.length){notify('Nada para fragmentar agora: nenhuma questão do escopo com erro ou lacuna pendente','ok');return;}
  const seq=(+(localStorage.getItem(FRAG_SEQ_KEY)||0))+1;try{localStorage.setItem(FRAG_SEQ_KEY,String(seq));}catch(e){}
  const nome=`Fragmentos ${seq}`;
  const lotes=lerLotesFrag();lotes.push({nome,criadoEm:new Date().toISOString(),ids:alvo.map(q=>q.id)});salvarLotesFrag(lotes);
  const itens=alvo.map(q=>{const {blocoIrmas,notas}=praticaMaterialExtra(q);
    return {id:q.id,impressao:impressaoQuestao(q),materia:q.materia||'',subtema:q.subtema||'',motivo:motivoFrag(q),
      material:montarTextoDeQuestao(q),apoio:blocoIrmas||'',anotacoes:notas||''};});
  const payload={tipo:'questia-fragmentos-pedido',versao:1,lote:nome,geradoEm:new Date().toISOString(),total:itens.length,
    instrucoes:'Para cada questão, gerar itens curtos (1 lacuna = 1 item): a regra do gabarito e os distratores que distorcem uma regra real; ignorar distratores absurdos. Formato: múltipla escolha curta e direta, ou Certo/Errado quando não houver alternativas plausíveis. Cada item com o dispositivo legal e explicação curta. Nada fora do material.',
    formatoResposta:{tipo:'questia-fragmentos-resposta',versao:1,itens:[{id:'<id da questão>',impressao:'<a mesma do pedido>',fragmentos:[{dispositivo:'LC 214/2025, art. 447, § 1º',tipo:'mc|ce',enunciado:'...',alternativas:['...','...'],correta:0,explicacao:'...'}]}]},
    itens};
  const blob=new Blob([JSON.stringify(payload,null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`questia-fragmentos-pedido-${seq}-${itens.length}q-${today()}.json`;document.body.appendChild(a);a.click();a.remove();
  notify(`📤 ${nome}: ${itens.length} questões exportadas para fragmentar`,'ok');
  renderLupa();
}
function normFrag(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function fragValido(f){
  if(!f||typeof f!=='object'||typeof f.enunciado!=='string'||!f.enunciado.trim())return false;
  if(!Array.isArray(f.alternativas)||f.alternativas.length<2||f.alternativas.length>6)return false;
  if(!f.alternativas.every(x=>typeof x==='string'&&x.trim()))return false;
  return Number.isInteger(f.correta)&&f.correta>=0&&f.correta<f.alternativas.length;
}
function importarLoteFrag(event){
  const input=event.target;const file=input.files&&input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try{input.value='';}catch(_){}
    let d;try{d=lerRespostaPratica(e.target.result);}catch(err){notify('JSON inválido','err');return;}
    await aplicarLoteFrag(d);
  };
  reader.readAsText(file);
}
// Fonte "lei nova": itens gerados direto do texto de uma lei (sem questão de origem),
// para cobrir lei recente que ainda não tem questão no banco (caso da LC 227/2026).
async function aplicarLoteLei(d){
  const itens=Array.isArray(d.itens)?d.itens:[];
  const lei=String(d.lei||'').trim();
  if(!lei||!itens.length){notify('Arquivo de lei sem "lei" ou sem itens','err');return;}
  const materia=String(d.materia||'Reforma Tributária').trim();
  const chaves=new Set(fragmentos.map(f=>normFrag(f.dispositivo)+'|'+normFrag(f.enunciado)));
  const novos=[];let repetidos=0,invalidos=0;
  itens.forEach(f=>{
    if(!fragValido(f)){invalidos++;return;}
    const disp=String(f.dispositivo||'').trim()||lei;
    const ch=normFrag(disp)+'|'+normFrag(f.enunciado);
    if(chaves.has(ch)){repetidos++;return;}
    chaves.add(ch);
    novos.push({id:`lei#${normFrag(lei).replace(/ /g,'')}#${Date.now().toString(36)}${novos.length}`,qid:null,origem:'lei',lei,materia,subtema:String(d.subtema||'').trim(),
      dispositivo:disp,tipo:f.tipo==='ce'?'ce':'mc',enunciado:f.enunciado.trim(),alternativas:f.alternativas.map(x=>x.trim()),correta:f.correta,
      explicacao:String(f.explicacao||'').trim(),criadoEm:today(),reps:0,interval:0,nextDue:null,acertos:0,erros:0});
  });
  const lin=[`• ${novos.length} itens novos de ${lei}`];
  if(repetidos)lin.push(`• ${repetidos} ignorados: já existem`);
  if(invalidos)lin.push(`• ${invalidos} recusados: formato incompleto`);
  if(!novos.length){alert('Nada a gravar:\n\n'+lin.join('\n'));return;}
  if(!confirm('Importar itens de lei nova?\n\n'+lin.join('\n')))return;
  fragmentos.push(...novos);await salvarFragmentos();
  notify(`🔬 ${novos.length} itens de ${lei} gravados na Lupa`,'ok');
  renderLupa();
}
async function aplicarLoteFrag(d){
  await carregarFragmentos();
  if(d&&d.tipo==='questia-fragmentos-lei')return aplicarLoteLei(d);
  if(d&&d.tipo==='questia-variantes-resposta'&&typeof varAplicarLote==='function')return varAplicarLote(d);
  const itens=d&&(d.itens||(Array.isArray(d)?d:null));
  if(!Array.isArray(itens)||!itens.length){notify('Arquivo sem itens','err');return;}
  const porId=new Map(questions.map(q=>[q.id,q]));
  const chaves=new Set(fragmentos.map(f=>normFrag(f.dispositivo)+'|'+normFrag(f.enunciado)));
  const rec={semQuestao:[],textoMudou:[],semItens:[]};let novos=[],repetidos=0,invalidos=0;const okIds=[];
  itens.forEach(it=>{
    const q=porId.get(it.id)??porId.get(Number(it.id));
    if(!q){rec.semQuestao.push(it.id);return;}
    if(!it.impressao||it.impressao!==impressaoQuestao(q)){rec.textoMudou.push(it.id);return;}
    const fr=Array.isArray(it.fragmentos)?it.fragmentos:[];
    let k=0;
    fr.forEach(f=>{
      if(!fragValido(f)){invalidos++;return;}
      const ch=normFrag(f.dispositivo)+'|'+normFrag(f.enunciado);
      if(chaves.has(ch)){repetidos++;return;}
      chaves.add(ch);k++;
      novos.push({id:`${q.id}#${Date.now().toString(36)}${novos.length}`,qid:q.id,materia:(q.materia||'').trim(),subtema:(q.subtema||'').trim(),
        dispositivo:String(f.dispositivo||'').trim()||'(sem dispositivo)',tipo:f.tipo==='ce'?'ce':'mc',
        enunciado:f.enunciado.trim(),alternativas:f.alternativas.map(x=>x.trim()),correta:f.correta,
        explicacao:String(f.explicacao||'').trim(),criadoEm:today(),reps:0,interval:0,nextDue:null,acertos:0,erros:0});
    });
    if(!fr.length)rec.semItens.push(it.id);
    okIds.push({q,k});
  });
  const lin=[`• ${novos.length} itens novos, de ${okIds.length} questões`];
  if(repetidos)lin.push(`• ${repetidos} itens ignorados: já existem (mesmo dispositivo e enunciado)`);
  if(invalidos)lin.push(`• ${invalidos} itens recusados: formato incompleto`);
  if(rec.textoMudou.length)lin.push(`• ${rec.textoMudou.length} questões recusadas: o texto/gabarito mudou desde a exportação`);
  if(rec.semQuestao.length)lin.push(`• ${rec.semQuestao.length} questões recusadas: não estão no banco`);
  if(!novos.length&&!okIds.length){alert('Nada a gravar:\n\n'+lin.join('\n'));return;}
  if(!confirm('Importar itens da Lupa?\n\n'+lin.join('\n')+'\n\nAs questões originais não são alteradas (só ganham a marca "fragmentada").'))return;
  fragmentos.push(...novos);await salvarFragmentos();
  const agora=today();
  okIds.forEach(({q,k})=>{q.fragmentadaEm=agora;q.fragmentosN=(q.fragmentosN||0)+k;});
  save();
  const saiu=new Set(okIds.map(o=>String(o.q.id)));
  salvarLotesFrag(lerLotesFrag().map(l=>({...l,ids:(l.ids||[]).filter(id=>!saiu.has(String(id)))})).filter(l=>l.ids.length));
  notify(`🔬 ${novos.length} itens gravados na Lupa`,'ok');
  renderLupa();
}

// ---------- 3) Estudo dos itens ----------
function somarDiasYmd(n){const d=new Date();d.setDate(d.getDate()+n);return ymd(d);}
function fragVencido(f){return !f.nextDue||f.nextDue<=today();}
let fragFila=[],fragIdx=0,fragResp=null,fragSess={ok:0,er:0};
// Irmãos de erro: um item do mesmo dispositivo de cada erro dos últimos
// FRAG_IRMA_JANELA dias, não respondido ontem/hoje — entra antes do prazo dele.
function fragIrmasDeErro(jaNaFila){
  const lim=somarDiasYmd(-FRAG_IRMA_JANELA), recente=somarDiasYmd(-1);
  const errPorDisp=new Map();
  fragmentos.forEach(f=>{if(f.ultima==='erro'&&f.ultimaEm&&f.ultimaEm>=lim){if(!errPorDisp.has(f.dispositivo))errPorDisp.set(f.dispositivo,new Set());errPorDisp.get(f.dispositivo).add(f.id);}});
  const out=[];
  errPorDisp.forEach((ids,disp)=>{
    const c=fragmentos.find(g=>g.dispositivo===disp&&!ids.has(g.id)&&!jaNaFila.has(g.id)&&g.ultima!=='erro'&&!(g.ultimaEm&&g.ultimaEm>=recente));
    if(c)out.push(c);
  });
  return out;
}
function fragMontarFila(){
  const venc=fragmentos.filter(fragVencido);
  const errados=venc.filter(f=>f.ultima==='erro'),novos=venc.filter(f=>!f.reps&&f.ultima!=='erro'),resto=venc.filter(f=>f.reps&&f.ultima!=='erro');
  resto.sort((a,b)=>String(a.nextDue).localeCompare(String(b.nextDue)));
  // intercala por dispositivo para não emendar 10 itens do mesmo artigo
  const irmas=fragIrmasDeErro(new Set(venc.map(f=>f.id)));
  const base=[...errados,...irmas,...resto,...novos];
  // 12/11: a mesma questão de origem rendia 3–5 itens que saíam quase colados (um
  // entregava o outro). Por sessão: no máximo 1 item por questão de origem e 2 por
  // dispositivo; o resto fica vencido para as próximas sessões.
  const chaveOrig=f=>f.qid!=null?'q'+f.qid:'d'+f.dispositivo;
  const usadosO=new Set(),nDisp=new Map(),escolhidos=[];
  for(const f of base){
    if(escolhidos.length>=LUPA_SESSAO_MAX)break;
    const o=chaveOrig(f),d=f.dispositivo;
    if(usadosO.has(o)||(nDisp.get(d)||0)>=2)continue;
    usadosO.add(o);nDisp.set(d,(nDisp.get(d)||0)+1);escolhidos.push(f);
  }
  const porDisp=new Map();
  escolhidos.forEach(f=>{const k=f.dispositivo;if(!porDisp.has(k))porDisp.set(k,[]);porDisp.get(k).push(f);});
  const out=[];let restou=true;
  while(restou&&out.length<LUPA_SESSAO_MAX){restou=false;for(const arr of porDisp.values()){if(arr.length){out.push(arr.shift());restou=true;if(out.length>=LUPA_SESSAO_MAX)break;}}}
  return out;
}
async function lupaIniciarSessao(){
  await carregarFragmentos();
  fragFila=fragMontarFila();fragIdx=0;fragSess={ok:0,er:0};
  if(!fragFila.length){notify('Nenhum item vencido agora 🎉','ok');return;}
  document.getElementById('lupa-painel').style.display='none';
  document.getElementById('lupa-sessao').style.display='block';
  lupaMostrarItem();
}
function lupaSairSessao(){
  document.getElementById('lupa-sessao').style.display='none';
  document.getElementById('lupa-painel').style.display='block';
  renderLupa();
}
function lupaMostrarItem(){
  const box=document.getElementById('lupa-item');
  const f=fragFila[fragIdx];fragResp=null;
  if(!f){
    box.innerHTML=`<div class="lupa-fim">Sessão concluída: <b>${fragSess.ok}</b> certos, <b>${fragSess.er}</b> errados.<div style="margin-top:14px"><button class="btn btn-primary" onclick="lupaSairSessao()">Voltar ao painel</button></div></div>`;
    return;
  }
  const L=i=>String.fromCharCode(65+i);
  box.innerHTML=`
    <div class="lupa-top"><span class="lupa-disp">📍 ${esc(f.dispositivo)}</span><span class="lupa-cont">${fragIdx+1}/${fragFila.length}</span></div>
    <div class="lupa-enun">${esc(f.enunciado)}</div>
    <div class="lupa-alts">${f.alternativas.map((a,i)=>`<button class="lupa-alt" data-i="${i}" onclick="lupaResponder(${i})"><b>${f.tipo==='ce'?'':L(i)+')'}</b> ${esc(a)}</button>`).join('')}</div>
    <div id="lupa-fb"></div>`;
}
function lupaResponder(i){
  if(fragResp!==null)return;
  const f=fragFila[fragIdx];if(!f)return;
  fragResp=i;const ok=i===f.correta;
  document.querySelectorAll('.lupa-alt').forEach((b,j)=>{b.disabled=true;if(j===f.correta)b.classList.add('certa');else if(j===i)b.classList.add('errada');else b.classList.add('apagada');});
  const q=f.qid!=null?questions.find(x=>x.id===f.qid):null;
  const orig=f.origem==='lei'?`Fonte: texto da ${esc(f.lei||'lei')}${f.subtema?' · '+esc(f.subtema):''}`
    :`Questão de origem: ${esc((q&&q.banca)||'')} · ${esc(f.subtema||f.materia)} · id ${esc(String(f.qid))}`;
  document.getElementById('lupa-fb').innerHTML=`
    <div class="lupa-exp ${ok?'ok':'er'}"><b>${ok?'✓ Certo':'✗ Errado'}</b> — ${esc(f.explicacao||'')}</div>
    <div class="lupa-orig">${orig}</div>
    <div class="lupa-acoes">${ok
      ?`<button class="btn btn-outline btn-sm" onclick="lupaAvaliar('duvida')">~ Acertei na dúvida <span class="lupa-k">2</span></button><button class="btn btn-primary btn-sm" onclick="lupaAvaliar('sabia')">✓ Sabia → <span class="lupa-k">Enter</span></button>`
      :`<button class="btn btn-primary btn-sm" onclick="lupaAvaliar('erro')">Próximo → <span class="lupa-k">Enter</span></button>`}</div>`;
}
// Agendamento próprio e simples (não usa o SM-2 das questões).
// 12/11 (pedido do Anderson): o erro voltava no DIA SEGUINTE — errava 15, no outro
// dia via as mesmas 15 com a resposta fresca e acertava de memória curta. Agora:
// errou → o MESMO item só volta em FRAG_ERRO_ESPERA dias; no meio-tempo a sessão
// traz um item IRMÃO (mesmo dispositivo, outro enunciado), que treina a regra sem
// a resposta decorada. Acertou na dúvida cresce devagar; sabia cresce ×2,5.
const FRAG_ERRO_ESPERA=4, FRAG_IRMA_JANELA=FRAG_ERRO_ESPERA;
function fragAgendar(f,res){
  const iv=f.interval||0;let n;
  if(res==='erro'){n=FRAG_ERRO_ESPERA;f.erros=(f.erros||0)+1;f.reps=0;}
  else{
    f.acertos=(f.acertos||0)+1;
    if(res==='duvida')n=Math.max(1,Math.round(iv*1.3)||1);
    else n=(f.reps&&iv)?Math.max(iv+1,Math.round(iv*2.5)):3;
    f.reps=(f.reps||0)+1;
  }
  n=Math.min(n,180);f.interval=n;f.nextDue=somarDiasYmd(n);f.ultima=res;f.ultimaEm=today();
  (f.hist||(f.hist=[])).push({d:today(),r:res});if(f.hist.length>30)f.hist=f.hist.slice(-30);
}
async function lupaAvaliar(res){
  const f=fragFila[fragIdx];if(!f||fragResp===null)return;
  fragAgendar(f,res);if(res==='erro')fragSess.er++;else fragSess.ok++;
  await salvarFragmentos();
  fragIdx++;lupaMostrarItem();
}
document.addEventListener('keydown',e=>{
  const s=document.getElementById('lupa-sessao');
  if(!s||s.style.display==='none'||!document.getElementById('page-lupa').classList.contains('active'))return;
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const tag=(e.target.tagName||'').toLowerCase();if(tag==='input'||tag==='textarea')return;
  const f=fragFila[fragIdx];if(!f)return;
  const k=(e.key||'').toLowerCase();
  if(fragResp===null){
    let i=-1;if(k>='1'&&k<='6')i=+k-1;else if(k.length===1&&k>='a'&&k<='f')i=k.charCodeAt(0)-97;
    if(i>=0&&i<f.alternativas.length){e.preventDefault();lupaResponder(i);}
  }else{
    const ok=fragResp===f.correta;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();lupaAvaliar(ok?'sabia':'erro');}
    else if(ok&&k==='2'){e.preventDefault();lupaAvaliar('duvida');}
  }
});

// ---------- 4) Painel ----------
function pct(a,b){return b?Math.round(100*a/b):null;}
async function renderLupa(){
  await carregarFragmentos();
  await lupaCarregarNotas();
  const el=document.getElementById('lupa-painel');if(!el)return;
  const venc=fragmentos.filter(fragVencido).length;
  // por dispositivo
  const disp=new Map();
  fragmentos.forEach(f=>{const k=f.dispositivo;const o=disp.get(k)||{n:0,a:0,e:0,v:0,mat:f.origem==='lei'?(f.materia+' · lei nova'):f.materia};o.n++;o.a+=f.acertos||0;o.e+=f.erros||0;if(fragVencido(f))o.v++;disp.set(k,o);});
  const linhas=[...disp.entries()].map(([k,o])=>({k,...o,p:pct(o.a,o.a+o.e)}))
    .sort((x,y)=>(x.p===null)-(y.p===null)||(x.p??0)-(y.p??0)||y.e-x.e);
  // escopo: candidatas, como acertei
  const esc0=questions.filter(q=>LUPA_MATERIAS.includes((q.materia||'').trim())&&!q.suspensa);
  const cand=candidatasFrag();
  const frag=esc0.filter(q=>q.fragmentadaEm).length;
  const como={erro:0,dificil:0,bom:0};esc0.forEach(q=>{const du=lupaDuvida(q);if((q.erros||0)>0)como.erro++;else if(du.d)como.dificil++;else if(du.b)como.bom++;});
  const lotes=lerLotesFrag();
  el.innerHTML=`
  <div class="lupa-grid">
    <div class="card lupa-card">
      <div class="lupa-h">▶ Itens para revisar</div>
      <div class="lupa-big">${venc}<span> vencidos de ${fragmentos.length}</span></div>
      <button class="btn btn-primary" ${venc?'':'disabled'} onclick="lupaIniciarSessao()">Estudar itens (até ${LUPA_SESSAO_MAX})</button>
      <div class="lupa-sub">Teclas: 1–6 ou A–F respondem · Enter = próximo · 2 = acertei na dúvida</div>
    </div>
    <div class="card lupa-card">
      <div class="lupa-h">✂️ Fragmentar questões</div>
      <div class="lupa-sub" style="margin-top:0">Escopo: ${LUPA_MATERIAS.join(', ')}.</div>
      <div class="lupa-nums"><div><b>${cand.length}</b><span>prontas para fragmentar</span></div><div><b>${lotes.reduce((s,l)=>s+l.ids.length,0)}</b><span>aguardando retorno</span></div><div><b>${frag}</b><span>já fragmentadas</span></div></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="number" id="frag-n" class="config-input" value="60" min="1" max="300" style="width:90px">
        <button class="btn btn-outline btn-sm" onclick="exportarLoteFrag()">📤 Exportar pedido</button>
        <label class="btn btn-outline btn-sm" style="cursor:pointer">📥 Importar resposta<input type="file" accept=".json,application/json" style="display:none" onchange="importarLoteFrag(event)"></label>
      </div>
      <div class="lupa-sub">O mesmo 📥 importa itens de <b>lei nova</b> (gerados do texto da lei, sem questão de origem).${(()=>{const l={};fragmentos.forEach(f=>{if(f.origem==='lei')l[f.lei]=(l[f.lei]||0)+1;});const k=Object.keys(l);return k.length?' Já na Lupa: '+k.map(x=>esc(x)+' ('+l[x]+')').join(', ')+'.':'';})()}</div>
      ${lotes.length?`<div class="lupa-lotes">${lotes.map(l=>`<div><span><b>${esc(l.nome)}</b> · ${l.ids.length} questões · ${new Date(l.criadoEm).toLocaleDateString('pt-BR')}</span><button class="btn btn-ghost btn-sm" onclick="liberarLoteFrag('${esc(l.nome).replace(/'/g,"\\'")}')">liberar</button></div>`).join('')}</div>`:''}
    </div>
    <div class="card lupa-card">
      <div class="lupa-h">🎯 De onde vêm as candidatas (escopo)</div>
      <div class="lupa-nums"><div><b>${como.erro}</b><span>com erro</span></div><div><b>${como.dificil}</b><span>acertou no Difícil</span></div><div><b>${como.bom}</b><span>Bom ${LUPA_BOM_MIN}x ou mais</span></div></div>
      <div class="lupa-sub">Vem do botão de avaliação: Errei → Difícil → Bom repetido. Fácil e Dominada contam como certeza.</div>
    </div>
  </div>
  <div class="card lupa-card" style="margin-top:14px">
    <div class="lupa-h">🔬 Acerto por dispositivo <span class="lupa-sub" style="font-weight:400">— pior primeiro</span></div>
    ${linhas.length?`<table class="lupa-tab"><thead><tr><th>Dispositivo</th><th>Matéria</th><th>Itens</th><th>Acerto</th><th>Vencidos</th></tr></thead><tbody>
      ${linhas.slice(0,60).map(o=>`<tr><td>${esc(o.k)}</td><td>${esc(o.mat||'')}</td><td>${o.n}</td><td class="${o.p===null?'':o.p<60?'ruim':o.p<85?'medio':'bom'}">${o.p===null?'—':o.p+'%'} <small>(${o.a}✓ ${o.e}✗)</small></td><td>${o.v}</td></tr>`).join('')}
    </tbody></table>${linhas.length>60?`<div class="lupa-sub">+${linhas.length-60} dispositivos</div>`:''}`
    :`<div class="lupa-sub">Nenhum item ainda. Exporte um pedido acima, gere os itens e importe a resposta.</div>`}
  </div>`;
  if(typeof varPainelHTML==='function'){try{el.insertAdjacentHTML('beforeend',await varPainelHTML());}catch(e){console.warn('[QuestIA] painel de variantes:',e);}}
}

// estilos da Lupa (ficam aqui para não mexer no style.css)
(function(){const s=document.createElement('style');s.textContent=`
#fc-como{display:none;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0 10px;font-size:12px;color:var(--muted)}
#fc-como button{background:var(--surface2);border:1.5px solid var(--border);border-radius:20px;padding:5px 12px;font-family:'Outfit',sans-serif;font-size:12px;color:var(--ink2);cursor:pointer}
#fc-como button.on{border-color:var(--accent2);background:var(--blue-light);color:var(--blue-text);font-weight:700}
.lupa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.lupa-card{padding:18px}
.lupa-h{font-weight:700;font-size:14px;margin-bottom:10px}
.lupa-big{font-size:34px;font-weight:800;margin-bottom:10px}.lupa-big span{font-size:13px;font-weight:400;color:var(--muted)}
.lupa-sub{font-size:11.5px;color:var(--muted);margin-top:8px}
.lupa-nums{display:flex;gap:16px;margin:8px 0 12px}.lupa-nums div{display:flex;flex-direction:column}.lupa-nums b{font-size:20px}.lupa-nums span{font-size:11px;color:var(--muted)}
.lupa-lotes{margin-top:10px;font-size:12px}.lupa-lotes div{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-top:1px solid var(--border)}
.lupa-tab{width:100%;border-collapse:collapse;font-size:12.5px}.lupa-tab th{text-align:left;color:var(--muted);font-weight:600;padding:6px;border-bottom:1px solid var(--border)}
.lupa-tab td{padding:6px;border-bottom:1px solid var(--border)}.lupa-tab td.ruim{color:var(--red-text);font-weight:700}.lupa-tab td.medio{color:var(--yellow-text);font-weight:700}.lupa-tab td.bom{color:var(--green);font-weight:700}
#lupa-item{max-width:760px;margin:0 auto;padding:22px}
.lupa-top{display:flex;justify-content:space-between;gap:10px;margin-bottom:12px}.lupa-disp{font-size:12px;font-weight:700;color:var(--indigo-text);background:var(--indigo-light);border:1px solid var(--indigo-border);border-radius:6px;padding:3px 8px}.lupa-cont{font-size:12px;color:var(--muted)}
.lupa-enun{font-size:15.5px;line-height:1.5;margin-bottom:14px}
.lupa-alts{display:flex;flex-direction:column;gap:8px}
.lupa-alt{text-align:left;background:var(--surface2);border:1.5px solid var(--border);border-radius:8px;padding:10px 12px;font-family:'Outfit',sans-serif;font-size:14px;color:var(--ink);cursor:pointer}
.lupa-alt:hover:not(:disabled){border-color:var(--ink2)}.lupa-alt.certa{border-color:var(--green);background:var(--green-light)}.lupa-alt.errada{border-color:var(--accent);background:var(--red-light)}.lupa-alt.apagada{opacity:.55}
.lupa-exp{margin-top:14px;padding:10px 12px;border-radius:8px;font-size:13.5px;line-height:1.5}.lupa-exp.ok{background:var(--green-light)}.lupa-exp.er{background:var(--red-light)}
.lupa-orig{font-size:11px;color:var(--muted);margin-top:6px}
.lupa-acoes{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}.lupa-k{font-size:10px;opacity:.6;margin-left:4px}
.lupa-fim{text-align:center;padding:30px;font-size:15px}
`;document.head.appendChild(s);})();
