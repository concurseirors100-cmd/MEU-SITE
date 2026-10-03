// ===== CALCULADORA FLUTUANTE =====
// Painel simples que abre ao lado da questão. A expressão só é construída
// pelos próprios botões (nunca por digitação livre), então o conjunto de
// caracteres que chega no avaliador é sempre conhecido — por isso um parser
// manual (em vez de eval) é suficiente e seguro.
let calcExpr='';
function toggleCalculadora(){
  const p=document.getElementById('calc-panel');
  const btn=document.getElementById('fc-calc-btn');
  const abrindo=!p.classList.contains('show');
  p.classList.toggle('show',abrindo);
  if(btn)btn.classList.toggle('ativo',abrindo);
}
// Fecha a calculadora sem abrir — chamada ao trocar de questão, pra não ficar
// flutuando um painel de uma conta que já não tem mais nada a ver com o cartão novo.
function fecharCalculadora(){
  const p=document.getElementById('calc-panel');if(!p)return;
  const btn=document.getElementById('fc-calc-btn');
  p.classList.remove('show');
  if(btn)btn.classList.remove('ativo');
}
function calcRenderDisplay(texto){
  document.getElementById('calc-display').textContent=texto||'0';
}
function calcRenderExpr(){
  document.getElementById('calc-expr').innerHTML=calcExpr?calcExpr.replace(/</g,'&lt;'):'&nbsp;';
}
function calcPress(v){
  // "0" sozinho no visor é só o estado inicial — o próximo dígito substitui em
  // vez de grudar do lado ("05" em vez de "5").
  if(calcExpr==='0'&&/[0-9(]/.test(v)&&v!=='(')calcExpr='';
  calcExpr+=v;
  calcRenderExpr();
  calcRenderDisplay(calcExpr||'0');
}
function calcClear(){
  calcExpr='';
  calcRenderExpr();
  calcRenderDisplay('0');
}
function calcBackspace(){
  calcExpr=calcExpr.slice(0,-1);
  calcRenderExpr();
  calcRenderDisplay(calcExpr||'0');
}
function calcEquals(){
  if(!calcExpr){return;}
  try{
    const resultado=calcAvaliar(calcExpr);
    calcRenderExpr();
    document.getElementById('calc-expr').innerHTML=calcExpr.replace(/</g,'&lt;')+' =';
    calcExpr=String(resultado);
    calcRenderDisplay(calcExpr);
  }catch(e){
    calcRenderDisplay('Erro');
    calcExpr='';
  }
}
// Parser recursivo pequeno — só entende o que os botões conseguem gerar:
// dígitos, + - × ÷ ^ % √( ) π. Precedência: parênteses/√ > ^ (dir. p/ esq.) >
// × ÷ > + -. "%" é pós-fixo (divide por 100 o que vem antes, tipo calculadora
// de bolso: "50%" = 0.5, "200+10%" seria melhor com contexto, mas numa
// calculadora básica o padrão universal é 50% -> 0.5).
function calcAvaliar(expr){
  const limpo=expr.replace(/×/g,'*').replace(/÷/g,'/').replace(/√/g,'sqrt').replace(/π/g,'(3.141592653589793)');
  let i=0;
  function peek(){return limpo[i];}
  function erro(msg){throw new Error(msg);}
  function parseExpr(){
    let v=parseTerm();
    while(true){
      skipEsp();
      if(peek()==='+'){i++;v+=parseTerm();}
      else if(peek()==='-'){i++;v-=parseTerm();}
      else break;
    }
    return v;
  }
  function parseTerm(){
    let v=parsePow();
    while(true){
      skipEsp();
      if(peek()==='*'){i++;v*=parsePow();}
      else if(peek()==='/'){i++;const d=parsePow();if(d===0)erro('div0');v/=d;}
      else break;
    }
    return v;
  }
  function parsePow(){
    let v=parseUnario();
    skipEsp();
    if(peek()==='^'){i++;const exp=parsePow();v=Math.pow(v,exp);}
    return v;
  }
  function parseUnario(){
    skipEsp();
    if(peek()==='-'){i++;return-parseUnario();}
    if(peek()==='+'){i++;return parseUnario();}
    return parsePosFixo();
  }
  function parsePosFixo(){
    let v=parsePrimario();
    skipEsp();
    while(peek()==='%'){i++;v=v/100;skipEsp();}
    return v;
  }
  function parsePrimario(){
    skipEsp();
    if(peek()==='('){i++;const v=parseExpr();skipEsp();if(peek()!==')')erro('paren');i++;return v;}
    if(limpo.slice(i,i+4)==='sqrt'){
      i+=4;skipEsp();
      if(peek()!=='(')erro('sqrt');
      i++;const v=parseExpr();skipEsp();if(peek()!==')')erro('paren');i++;
      if(v<0)erro('neg-sqrt');
      return Math.sqrt(v);
    }
    const m=/^[0-9]*\.?[0-9]+/.exec(limpo.slice(i));
    if(!m)erro('num');
    i+=m[0].length;
    return parseFloat(m[0]);
  }
  function skipEsp(){while(limpo[i]===' ')i++;}
  const resultado=parseExpr();
  skipEsp();
  if(i<limpo.length)erro('sobra');
  if(!isFinite(resultado))erro('inf');
  // Corta ruído de ponto flutuante (0.1+0.2 etc.) sem forçar casas fixas.
  return Math.round(resultado*1e10)/1e10;
}
// ===== TECLADO DA CALCULADORA =====
// Só age quando o painel está com a classe "show" (checado no listener de
// atalhos principal também, pra ele ceder a vez em vez de disputar a mesma
// tecla). Fora de um campo de texto/select, senão ia comer digitação normal.
document.addEventListener('keydown',e=>{
  const painel=document.getElementById('calc-panel');
  if(!painel||!painel.classList.contains('show'))return;
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const t=e.target,tag=(t.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select'||t.isContentEditable)return;
  const k=e.key;
  if(k>='0'&&k<='9'){e.preventDefault();calcPress(k);return;}
  if(k==='.'||k===','){e.preventDefault();calcPress('.');return;}
  if(k==='+'){e.preventDefault();calcPress('+');return;}
  if(k==='-'){e.preventDefault();calcPress('-');return;}
  if(k==='*'){e.preventDefault();calcPress('×');return;}
  if(k==='/'){e.preventDefault();calcPress('÷');return;}          // no Firefox '/' abriria a busca rápida — por isso o preventDefault
  if(k==='('){e.preventDefault();calcPress('(');return;}
  if(k===')'){e.preventDefault();calcPress(')');return;}
  if(k==='%'){e.preventDefault();calcPress('%');return;}
  if(k==='^'){e.preventDefault();calcPress('^');return;}
  if(k==='Enter'||k==='='){e.preventDefault();calcEquals();return;}
  if(k==='Backspace'){e.preventDefault();calcBackspace();return;}
  if(k==='Delete'){e.preventDefault();calcClear();return;}
  if(k==='Escape'){e.preventDefault();toggleCalculadora();return;}
});

// ============================================================================
// REVISÃO — flashcards curtos, com meta diária e sem bola de neve
//
// Por que existe: responder questão nova é fácil de manter; VOLTAR no que já
// errou é o que trava. Duas decisões de projeto seguram isso:
//
//  1) O dia tem TETO FIXO (cfgRev().meta). Não existe fila de atrasados: se
//     você sumir uma semana, ao voltar continuam sendo N cards, os N mais
//     urgentes. O contador vermelho de "1.482 atrasados" é exatamente o que
//     faz a pessoa desistir, então ele não é exibido em lugar nenhum.
//  2) O card é CURTO por construção — frente e verso truncados, e anotação
//     curta demais nem vira card. Card volumoso é card pulado.
//
// Os cards não são inventados: saem do que você já escreveu (Resumos) e do
// que você já errou muito (leech). Nenhuma geração de texto — só recorte.
// ============================================================================
const REV_PADRAO={meta:15, minErros:3, tetoDias:180};
function cfgRev(){try{return Object.assign({},REV_PADRAO,JSON.parse(localStorage.getItem('questia_rev_cfg')||'{}'));}catch(e){return Object.assign({},REV_PADRAO);}}
function salvarCfgRev(c){localStorage.setItem('questia_rev_cfg',JSON.stringify(c));}
let cards=[];
function loadCards(){try{cards=JSON.parse(localStorage.getItem('questia_cards')||'[]');}catch(e){cards=[];}}
function saveCards(){try{localStorage.setItem('questia_cards',JSON.stringify(cards));}catch(e){notify('❌ Falha ao salvar os cards (armazenamento cheio?)','err');}}
function histRev(){try{return JSON.parse(localStorage.getItem('questia_rev_hist')||'{}');}catch(e){return{};}}
function salvarHistRev(h){localStorage.setItem('questia_rev_hist',JSON.stringify(h));}

const REV_LIM_FRENTE=280, REV_LIM_VERSO=600, REV_MIN_NOTA=15;
function revLimpar(t){return String(t||'').replace(/\[\[IMG-URL:[^\]]*\]\]/g,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
function revCortar(t,lim){t=revLimpar(t);if(t.length<=lim)return t;
  // corta na última frase inteira quando ela existe perto do limite; senão trunca
  // reservando o caractere das reticências, para o resultado nunca passar de `lim`.
  const corte=t.slice(0,lim);const p=corte.lastIndexOf('. ');
  return p>lim*0.6 ? corte.slice(0,p+1) : (t.slice(0,lim-1).trim()+'…');}

// ===== GERAÇÃO =====
// Recorte puro: a frente é o gancho (assunto + trecho da questão) e o verso é
// texto que VOCÊ escreveu, ou o gabarito + o trecho do professor. Idempotente:
// roda quantas vezes quiser, cada resumo/leech vira no máximo um card.
function gerarCardsDisponiveis(){
  const jaTem=new Set(cards.map(c=>c.origem));
  const novos=[];
  (resumos||[]).forEach(r=>{
    const chave='resumo:'+r.id;
    if(jaTem.has(chave))return;
    const nota=revLimpar(r.nota);
    if(nota.length<REV_MIN_NOTA)return;                 // anotação curta demais não vira card
    novos.push({origem:chave, tipo:'resumo',
      materia:r.materia||'', subtema:r.subtema||'',
      frente:revCortar(r.questaoTrecho||r.subtema||r.materia,REV_LIM_FRENTE),
      verso:revCortar(nota,REV_LIM_VERSO), refId:r.questaoId});
  });
  const lim=cfgRev().minErros;
  (questions||[]).forEach(q=>{
    const chave='leech:'+q.id;
    if(jaTem.has(chave))return;
    if(q.suspensa)return;
    if((q.erros||0)<lim)return;
    const gab=revLimpar(q.gabTexto||(q.alternativas||[])[q.gabarito]||'');
    if(!gab)return;
    const com=revLimpar(q.comentario||'');
    novos.push({origem:chave, tipo:'leech',
      materia:q.materia||'', subtema:q.subtema||'',
      frente:revCortar(q.questao,REV_LIM_FRENTE),
      verso:revCortar('✔ '+gab+(com?'\n\n'+com:''),REV_LIM_VERSO), refId:q.id, errosOrigem:q.erros||0});
  });
  return novos;
}
function criarCards(){
  const novos=gerarCardsDisponiveis();
  if(!novos.length){notify('Nenhum card novo — anote mais durante o estudo e volte aqui','ok');renderRevisao();return;}
  const hoje=today();
  novos.forEach(n=>cards.push(Object.assign({
    id:'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
    criado:hoje, reps:0, ef:2.5, interval:0, nextDue:hoje, acertos:0, erros:0, arquivado:false
  },n)));
  saveCards();renderRevisao();
  const nR=novos.filter(n=>n.tipo==='resumo').length, nL=novos.length-nR;
  notify(`✓ ${novos.length} cards criados (${nR} de resumos, ${nL} de questões que você mais erra)`,'ok');
}

// ===== AGENDAMENTO =====
// SM-2 enxuto, com três botões em vez de cinco: num card de 10 segundos, cinco
// graus é decisão demais. Teto próprio, independente do teto das questões.
function revAgendar(c,nota){
  const cfg=cfgRev();
  const n=diasAteProva();
  const teto=(n!==null&&n>0)?Math.min(cfg.tetoDias,Math.max(1,n)):cfg.tetoDias;
  if(nota===0){c.ef=Math.max(1.3,c.ef-0.20);c.interval=1;c.reps=0;c.erros=(c.erros||0)+1;}
  else{
    c.acertos=(c.acertos||0)+1;c.reps=(c.reps||0)+1;
    if(nota===1){c.ef=Math.max(1.3,c.ef-0.15);c.interval=c.reps===1?2:Math.max(2,Math.round((c.interval||1)*1.3));}
    else{c.ef=Math.min(3.0,c.ef+0.10);c.interval=c.reps===1?3:Math.max(3,Math.round((c.interval||1)*c.ef));}
  }
  c.interval=Math.min(c.interval,teto);
  const d=new Date(today()+'T00:00:00');d.setDate(d.getDate()+c.interval);
  c.nextDue=ymd(d);
}
// Prioridade: mesmo espírito da fila de questões — peso do edital manda,
// atraso e histórico de erro no card modulam. Nunca passa da meta.
function filaRevisao(){
  const cfg=cfgRev();
  const hoje=today();
  const vencidos=cards.filter(c=>!c.arquivado&&(!c.nextDue||c.nextDue<=hoje));
  const score=c=>{
    const atraso=c.nextDue?Math.max(0,Math.round((new Date(hoje+'T00:00:00')-new Date(c.nextDue+'T00:00:00'))/86400000)):999;
    const erroMod=0.6+Math.min(1,(c.erros||0)/3)*0.8;
    return pesoDaMateria(c.materia)*erroMod*(1+Math.min(atraso,30)/30*0.5)+(c.reps===0?0.15:0);
  };
  vencidos.sort((a,b)=>score(b)-score(a));
  const feitos=(histRev()[hoje]||0);
  return vencidos.slice(0,Math.max(0,cfg.meta-feitos));
}
function streakRev(){
  const h=histRev(),cfg=cfgRev();let n=0;const d=new Date(today()+'T00:00:00');
  for(;;){const k=ymd(d);if((h[k]||0)>=cfg.meta){n++;d.setDate(d.getDate()-1);}
    else if(k===today()){d.setDate(d.getDate()-1);}   // o dia de hoje ainda não conta contra
    else break;
    if(n>999)break;}
  return n;
}

// ===== TELA =====
let revFila=[],revIdx=0,revAberto=false;
function renderRevisao(){
  loadResumos();
  const cfg=cfgRev();
  const hoje=today(),h=histRev();
  const feitos=h[hoje]||0;
  revFila=filaRevisao();revIdx=0;revAberto=false;
  const disp=gerarCardsDisponiveis().length;
  const ativos=cards.filter(c=>!c.arquivado).length;
  document.getElementById('rev-meta-feitos').textContent=feitos;
  document.getElementById('rev-meta-alvo').textContent=cfg.meta;
  document.getElementById('rev-barra').style.width=Math.min(100,100*feitos/cfg.meta)+'%';
  document.getElementById('rev-streak').textContent=streakRev();
  document.getElementById('rev-total').textContent=ativos;
  const br=document.getElementById('rev-refinar-btn');
  if(br){const pend=cards.filter(c=>!c.arquivado&&!c.refinado).length;
    br.textContent=pend?`✨ Refinar ${pend} com IA`:(cards.filter(c=>!c.arquivado).length?'✨ Tudo refinado':'✨ Refinar com IA');
    br.disabled=!pend||!getApiKey();
    br.title=getApiKey()?'Reescreve com IA os cards ainda não refinados':'Configure a chave da Anthropic no topo para habilitar';}
  const bt=document.getElementById('rev-gerar-btn');
  bt.textContent=disp?`✨ Criar ${disp} card(s) novo(s)`:'✨ Nenhum card novo disponível';
  bt.disabled=!disp;
  // tirinha dos últimos 7 dias
  const pontos=[];const d=new Date(hoje+'T00:00:00');d.setDate(d.getDate()-6);
  for(let i=0;i<7;i++){const k=ymd(d);const n=h[k]||0;
    pontos.push(`<span title="${k}: ${n}" style="width:16px;height:16px;border-radius:5px;display:inline-block;background:${n>=cfg.meta?'var(--green)':n?'var(--yellow)':'var(--surface2)'};border:1px solid var(--border2)"></span>`);
    d.setDate(d.getDate()+1);}
  document.getElementById('rev-semana').innerHTML=pontos.join('');
  mostrarCard();
}
function mostrarCard(){
  const box=document.getElementById('rev-card');
  const cfg=cfgRev();
  if(revIdx>=revFila.length){
    const feitos=histRev()[today()]||0;
    box.innerHTML=feitos>=cfg.meta
      ? `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">Meta de hoje batida</div>
         <div class="empty-sub">${feitos} cards. Volte amanhã — o que você revisou hoje já tem data marcada para voltar sozinho.</div></div>`
      : (cards.filter(c=>!c.arquivado).length
        ? `<div class="empty-state"><div class="empty-icon">🌱</div><div class="empty-title">Nada vencido agora</div>
           <div class="empty-sub">Seus cards estão em dia. Os próximos voltam conforme o agendamento — não precisa forçar.</div></div>`
        : `<div class="empty-state"><div class="empty-icon">🎴</div><div class="empty-title">Nenhum card ainda</div>
           <div class="empty-sub">Clique em <strong>Criar cards</strong> acima. Eles saem das suas anotações em Resumos e das questões que você mais erra.</div></div>`);
    return;
  }
  const c=revFila[revIdx];
  const tag=c.tipo==='resumo'
    ?'<span class="tag" style="background:var(--blue-light);color:var(--blue-text);border:1px solid var(--blue-border)">🗒️ seu resumo</span>'
    :'<span class="tag" style="background:var(--yellow-light);color:var(--yellow-text);border:1px solid rgba(217,119,6,.3)">🔁 questão que você erra'+(c.errosOrigem?' ('+c.errosOrigem+'×)':'')+'</span>';
  const cabecalho=`
    <div class="rev-tags">
      ${c.materia?`<span class="tag tag-materia">${esc(c.materia)}</span>`:''}
      ${c.subtema?`<span class="tag" style="background:var(--surface2);color:var(--ink2);border:1px solid var(--border2)">${esc(c.subtema)}</span>`:''}
      ${tag}
      ${c.refinado?'<span class="tag" style="background:var(--surface2);color:var(--green);border:1px solid var(--border2)">✨ refinado</span>':''}
    </div>`;
  box.innerHTML=`
    <div class="rev-contador">${revIdx+1} de ${revFila.length}</div>
    <div class="rev-palco" id="rev-palco" onclick="virarCard(event)" title="Clique para virar (ou tecle espaço)">
      <div class="rev-flip ${revAberto?'virado':''}" id="rev-flip">
        <div class="rev-face rev-frente" id="rev-face-frente">
          ${cabecalho}
          <div class="rev-texto">${esc(c.frente)}</div>
          <div class="rev-dica">clique para ver a resposta <kbd>espaço</kbd></div>
        </div>
        <div class="rev-face rev-verso" id="rev-face-verso">
          ${cabecalho}
          <div class="rev-texto rev-texto-verso">${esc(c.verso)}</div>
        </div>
      </div>
    </div>
    <div class="rev-acoes ${revAberto?'on':''}">
      <button class="btn btn-danger" onclick="responderCard(0)">Errei <kbd>1</kbd></button>
      <button class="btn btn-outline" onclick="responderCard(1)">Difícil <kbd>2</kbd></button>
      <button class="btn btn-primary" onclick="responderCard(2)">Fácil <kbd>3</kbd></button>
      <span style="flex:1"></span>
      ${c.refinado
        ?`<button class="btn btn-outline btn-sm" onclick="desfazerRefino()" title="Volta ao texto original do card">↩ Desfazer refino</button>`
        :`<button class="btn btn-outline btn-sm" onclick="refinarCardAtual()" title="Reescreve como pergunta curta + resposta direta, com a sua chave da Anthropic">✨ Refinar</button>`}
      <button class="btn btn-outline btn-sm" onclick="arquivarCard()" title="Tira este card da rotação para sempre — sem apagar o resumo">🎓 Dominei</button>
    </div>`;
  ajustarAlturaCard();
}
// As duas faces ficam sobrepostas (position:absolute), então o palco não herda
// altura de nenhuma delas. Sem isto o card colapsa ou fica com um vão enorme:
// mede as duas e usa a maior, para o giro não mudar de tamanho no meio.
function ajustarAlturaCard(){
  const palco=document.getElementById('rev-palco');
  const f=document.getElementById('rev-face-frente'), v=document.getElementById('rev-face-verso');
  if(!palco||!f||!v)return;
  const h=Math.max(f.scrollHeight,v.scrollHeight,260);
  palco.style.height=h+'px';
}
function virarCard(ev){
  if(ev&&ev.target&&ev.target.closest('button'))return;   // clique num botão não vira
  revAberto=!revAberto;
  const fl=document.getElementById('rev-flip');
  const ac=document.querySelector('.rev-acoes');
  if(fl)fl.classList.toggle('virado',revAberto);
  if(ac)ac.classList.toggle('on',revAberto);
}

function revelarCard(){if(!revAberto)virarCard();}
function responderCard(nota){
  const c=revFila[revIdx];if(!c)return;
  const real=cards.find(x=>x.id===c.id);if(real)revAgendar(real,nota);
  const h=histRev(),k=today();h[k]=(h[k]||0)+1;salvarHistRev(h);
  saveCards();
  revIdx++;revAberto=false;
  const cfg=cfgRev(),feitos=h[k]||0;
  document.getElementById('rev-meta-feitos').textContent=feitos;
  document.getElementById('rev-barra').style.width=Math.min(100,100*feitos/cfg.meta)+'%';
  if(feitos===cfg.meta){document.getElementById('rev-streak').textContent=streakRev();notify('🔥 Meta de hoje batida — '+cfg.meta+' cards','ok');}
  mostrarCard();
}
function arquivarCard(){
  const c=revFila[revIdx];if(!c)return;
  const real=cards.find(x=>x.id===c.id);if(real)real.arquivado=true;
  saveCards();revIdx++;revAberto=false;mostrarCard();
  notify('Card arquivado — não volta mais','ok');
}
function salvarMetaRev(){
  const v=parseInt(document.getElementById('rev-meta-input').value,10);
  const e=parseInt(document.getElementById('rev-erros-input').value,10);
  const c=cfgRev();
  if(v>=1&&v<=60)c.meta=v;
  if(e>=2&&e<=15)c.minErros=e;
  salvarCfgRev(c);renderRevisao();notify('✓ Ajustes salvos','ok');
}
document.addEventListener('keydown',e=>{
  if(!document.getElementById('page-revisao')||!document.getElementById('page-revisao').classList.contains('active'))return;
  if(/^(INPUT|TEXTAREA|SELECT)$/.test((e.target||{}).tagName||''))return;
  if(e.key===' '&&!revAberto&&revIdx<revFila.length){e.preventDefault();revelarCard();return;}
  if(revAberto&&['1','2','3'].includes(e.key)){e.preventDefault();responderCard(+e.key-1);}
});


// ===== REFINO COM IA (opcional) =================================================
// O recorte mecânico já entrega um card utilizável, mas o verso é a sua frase
// solta — às vezes sem a pergunta que a provoca. Aqui a mesma chave que gera
// questões transforma o material bruto num par pergunta/resposta enxuto.
//
// Três garantias, por causa da regra de nunca ensinar coisa errada:
//  1) o modelo só pode REESCREVER o que está no material; se não der para
//     formular sem inventar, ele devolve null e o card fica como estava;
//  2) o original é guardado em frenteOrig/versoOrig — dá para desfazer sempre;
//  3) tudo é opcional: sem chave configurada, a aba funciona igual.
const IA_LIM_FRENTE=140, IA_LIM_VERSO=320;
let refinoCancelado=false;
async function refinarUmCardIA(c){
  const apiKey=getApiKey();
  if(!apiKey)throw new Error('sem-chave');
  const material=c.tipo==='resumo'
    ? `Anotação do candidato: ${c.verso}\n\nContexto (trecho da questão que gerou a anotação): ${c.frente}`
    : `Questão que o candidato erra com frequência: ${c.frente}\n\nGabarito e comentário do professor: ${c.verso}`;
  const system='Você monta flashcards de revisão para concurso fiscal. Responde só JSON.';
  const prompt=`Matéria: ${c.materia||'—'}\nSubtema: ${c.subtema||'—'}\n\n${material}\n\n`
    +`Transforme isso em UM flashcard.\n`
    +`REGRAS:\n`
    +`- Use SOMENTE informação contida no material acima. É proibido acrescentar dispositivo, número, prazo ou conceito que não esteja lá.\n`
    +`- "frente": uma pergunta direta, no máximo ${IA_LIM_FRENTE} caracteres. Deve dar para responder de cabeça.\n`
    +`- "verso": a resposta, no máximo ${IA_LIM_VERSO} caracteres. Sem preâmbulo, sem "a resposta é". Vá direto ao conceito e, se houver, ao número/prazo/artigo que a banca cobra.\n`
    +`- Se o material não permitir formular uma pergunta honesta sem inventar, devolva {"frente":null,"verso":null}.\n\n`
    +`JSON PURO: {"frente":"...","verso":"..."}`;
  const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify({model:getModelo(),max_tokens:400,system,messages:[{role:'user',content:prompt}]})});
  if(res.status===429)throw new Error('429');
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error((e.error&&e.error.message)||('HTTP '+res.status));}
  const j=await res.json();
  const txt=((j.content||[]).map(b=>b.text||'').join('')||'').trim();
  const m=txt.match(/\{[\s\S]*\}/);
  if(!m)throw new Error('resposta sem JSON');
  const d=JSON.parse(m[0]);
  if(!d.frente||!d.verso)return false;              // o modelo recusou — card intacto
  const real=cards.find(x=>x.id===c.id); if(!real)return false;
  if(real.frenteOrig===undefined){real.frenteOrig=real.frente;real.versoOrig=real.verso;}
  real.frente=revCortar(d.frente,IA_LIM_FRENTE);
  real.verso=revCortar(d.verso,IA_LIM_VERSO);
  real.refinado=true;
  return true;
}
async function refinarCardAtual(){
  const c=revFila[revIdx]; if(!c)return;
  if(!getApiKey()){notify('Configure a chave da Anthropic no topo da tela para usar o refino','err');return;}
  showLoading('Refinando o card...','1 chamada à API');
  try{
    const ok=await refinarUmCardIA(c);
    saveCards();
    const real=cards.find(x=>x.id===c.id); if(real){revFila[revIdx]=real;}
    hideLoading(); revAberto=true; mostrarCard();
    notify(ok?'✓ Card refinado':'O modelo não conseguiu formular sem inventar — card mantido','ok');
  }catch(e){hideLoading();notify('Falha no refino: '+e.message,'err');}
}
function desfazerRefino(){
  const c=revFila[revIdx]; if(!c)return;
  const real=cards.find(x=>x.id===c.id); if(!real||real.frenteOrig===undefined)return;
  real.frente=real.frenteOrig; real.verso=real.versoOrig;
  delete real.frenteOrig; delete real.versoOrig; delete real.refinado;
  saveCards(); revFila[revIdx]=real; mostrarCard(); notify('Refino desfeito','ok');
}
async function refinarLoteIA(){
  if(!getApiKey()){notify('Configure a chave da Anthropic no topo da tela para usar o refino','err');return;}
  const pend=cards.filter(c=>!c.arquivado&&!c.refinado);
  if(!pend.length){notify('Todos os cards já foram refinados','ok');return;}
  if(!confirm(`Refinar ${pend.length} card(s) com IA?\n\n`
    +`É uma chamada à API por card, com a sua chave. Cada card vira uma pergunta curta `
    +`(até ${IA_LIM_FRENTE} caracteres) e uma resposta direta (até ${IA_LIM_VERSO}).\n\n`
    +`O texto original de cada card fica guardado — dá para desfazer um a um.\n`
    +`Pode fechar o aviso a qualquer momento: o que já foi refinado permanece.`))return;
  refinoCancelado=false;
  let feitos=0,recusados=0,falhas=0,espera=700;
  for(let i=0;i<pend.length;i++){
    if(refinoCancelado)break;
    showLoading(`Refinando ${i+1} de ${pend.length}...`,`${feitos} prontos · ${recusados} recusados · ${falhas} falhas`);
    try{
      const ok=await refinarUmCardIA(pend[i]);
      ok?feitos++:recusados++;
      espera=700;
    }catch(e){
      if(String(e.message)==='429'){espera=Math.min(espera*2,30000);i--;}   // repete o mesmo card
      else falhas++;
    }
    if(i%5===0)saveCards();
    await new Promise(r=>setTimeout(r,espera));
  }
  saveCards();hideLoading();renderRevisao();
  notify(`✓ ${feitos} refinados`+(recusados?` · ${recusados} mantidos (material insuficiente)`:'')+(falhas?` · ${falhas} falharam`:''),'ok');
}


// ===== AVISO DE RETA FINAL DESLIGADA =========================================
// A reta final (teto de intervalo menor + im=1,00 perto da prova) só liga quando
// existe DATA DA PROVA. Sem ela, diasAteProva() devolve null e schedCfg() nunca
// aperta nada: o teto fica em 365 dias e o app agenda revisões para depois do
// concurso sem avisar. Como é um campo que não dá sinal de vazio, o aviso mora
// aqui, na tela que você abre todo dia, e some sozinho quando a data é salva.
function renderAvisoReta(){
  const el=document.getElementById('aviso-reta'); if(!el)return;
  const d=dataProva(), n=diasAteProva();
  if(d&&n!==null&&n>0){
    const cfg=schedCfg('tec');
    const esc=retaCfg().escopo;
    const alvo=esc==='todas'?'todas as questões':esc==='tec'?'só as de banca':'nenhuma';
    el.style.display='';
    el.innerHTML=`<div style="margin-bottom:16px;padding:10px 14px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius);font-size:12.5px;color:var(--ink2)">
      ⏳ <strong>${n} dia(s)</strong> para a prova · reta final ativa em <strong>${alvo}</strong> · teto de intervalo: <strong>${cfg.tetoDias} dias</strong></div>`;
    return;
  }
  el.style.display='';
  el.innerHTML=`<div style="margin-bottom:16px;padding:14px 16px;background:var(--yellow-light);border:1px solid rgba(217,119,6,.35);border-radius:var(--radius)">
    <div style="font-size:13px;font-weight:700;color:var(--yellow-text);margin-bottom:6px">⚠️ A data da prova está em branco — a reta final está desligada</div>
    <div style="font-size:12.5px;color:var(--yellow-text);line-height:1.7;margin-bottom:10px">
      Sem a data, o teto de intervalo fica em <strong>365 dias</strong> e o espaçamento continua 20% mais largo que o Anki puro.
      Na prática o app pode marcar revisões para <strong>depois do concurso</strong> — e elas não voltam a tempo.
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="date" id="reta-data-rapida" style="padding:7px 9px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--ink)">
      <button class="btn btn-primary btn-sm" onclick="salvarDataProvaRapida()">Salvar data da prova</button>
      <span style="font-size:12px;color:var(--muted)">o ajuste fino (escopo e fração) fica em Estatísticas → Agendamento</span>
    </div>
  </div>`;
}
function salvarDataProvaRapida(){
  const v=(document.getElementById('reta-data-rapida')||{}).value||'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)){notify('Escolha uma data válida','err');return;}
  const c=schedCfgBruto(); c.provaEm=v; salvarSchedCfg(c);
  renderAvisoReta();
  const n=diasAteProva(), t=schedCfg('tec').tetoDias;
  notify(`✓ Data salva — ${n} dia(s) para a prova. Teto de intervalo agora: ${t} dias`,'ok');
  initStudy();
}


// ===== ATALHO ALTERNATIVA -> COMENTÁRIO =====
// Rede de segurança: 1 em cada 3 comentários nunca escreve a letra. Nesses,
// tenta casar o PRÓPRIO TEXTO da alternativa dentro do comentário — professor
// costuma repetir a assertiva antes de justificar.
function acharTextoNoComentario(txt){
  const box=document.getElementById('fc-ans-gabarito'); if(!box)return null;
  const norm=t=>String(t||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  const alvo=norm(txt).slice(0,50); if(alvo.length<18)return null;
  const w=document.createTreeWalker(box,NodeFilter.SHOW_TEXT);
  let buf='',nos=[];
  while(w.nextNode()){nos.push({no:w.currentNode,ini:buf.length});buf+=norm(w.currentNode.nodeValue)+' ';}
  const pos=buf.indexOf(alvo); if(pos<0)return null;
  for(let k=nos.length-1;k>=0;k--) if(nos[k].ini<=pos) return nos[k].no.parentElement||null;
  return null;
}
function piscar(el,ms){
  document.querySelectorAll('.pisca').forEach(e=>e.classList.remove('pisca'));
  void el.offsetWidth;   // reinicia a animação se a mesma letra for clicada 2x
  el.classList.add('pisca');
  setTimeout(()=>el.classList.remove('pisca'),ms||1600);
}
function irParaComentario(i){
  const btn=document.getElementById('alt-'+i); if(!btn)return;
  if(!document.getElementById('fc-ans')?.classList.contains('show'))return;
  const letra=btn.getAttribute('data-orig')||String.fromCharCode(65+i);
  let alvo=document.getElementById('com-alt-'+letra);
  if(!alvo)alvo=acharTextoNoComentario(btn.children[1]?.textContent||'');
  if(!alvo&&btn.classList.contains('correct'))alvo=document.querySelector('#fc-ans-gabarito .gabarito-header');
  if(!alvo){notify('Este comentário não trata a letra '+letra+' em trecho separado','err');return;}
  btn.classList.add('tremeu'); setTimeout(()=>btn.classList.remove('tremeu'),420);
  alvo.scrollIntoView({behavior:'smooth',block:'center'});
  piscar(alvo,1600);
}
// ===== BARRA DE CHAVE/MODELO =====
// Ela ocupa duas linhas no topo de TODAS as telas e só serve na hora de gerar
// questão. Fica recolhida por padrão quando já existe chave salva.
// Sem preferência gravada, o padrão é: aberta se ainda não há chave (é preciso
// digitar uma), recolhida se já existe. Uma vez que ele escolhe, a escolha vale.
function apiBarAberta(){
  let v=null; try{v=localStorage.getItem('questia_apibar');}catch(e){}
  if(v===null)return !getApiKey();
  return v==='1';
}
function aplicarApiBar(){
  const bar=document.getElementById('apikey-banner'), bt=document.getElementById('apikey-abrir');
  if(!bar||!bt)return;
  const aberta=apiBarAberta();
  // display:'' devolveria o valor da folha de estilo (que é none no botão),
  // então o estado aberto precisa de um valor explícito.
  bar.style.display=aberta?'flex':'none';
  bt.style.display=aberta?'none':'inline-block';
}
function toggleApiBar(){
  try{localStorage.setItem('questia_apibar',apiBarAberta()?'0':'1');}catch(e){}
  aplicarApiBar();
}
document.addEventListener('DOMContentLoaded',aplicarApiBar);
setTimeout(aplicarApiBar,300);
