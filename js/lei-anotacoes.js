// Leitor interativo da Lei Seca — camada de anotações independente do texto oficial.
(function(){
'use strict';
const API='/api/lei-anotacoes';
const COLORS={yellow:'#fff1a8',green:'#c9f2d0',blue:'#cce5ff',pink:'#ffd6e7',purple:'#e7d7ff'};
const undoStack=new WeakMap(),redoStack=new WeakMap(),loaded=new WeakMap(),activeTool=new WeakMap();
const css=`
.lsa-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;margin:0 0 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);font:12px system-ui}
.lsa-tools button{border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--ink);padding:5px 8px;cursor:pointer}
.lsa-tools button:disabled{opacity:.4;cursor:default}
.lsa-tools button.lsa-active{outline:2px solid var(--accent);outline-offset:1px;background:var(--surface)}
.lsa-tools .lsa-color{width:22px;height:22px;padding:0;border:1px solid #999}
.lsa-status{flex:1 0 100%;order:9;min-height:15px;line-height:15px;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lsa-mark{border-radius:2px;cursor:pointer}
.lsa-mark[data-kind="underline"]{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px;background:transparent}
.lsa-mark[data-kind="note"]{border-bottom:2px dotted var(--accent2);background:rgba(99,102,241,.08)}
.lsa-mark[data-color="yellow"]{background:#fff1a8}.lsa-mark[data-color="green"]{background:#c9f2d0}
.lsa-mark[data-color="blue"]{background:#cce5ff}.lsa-mark[data-color="pink"]{background:#ffd6e7}.lsa-mark[data-color="purple"]{background:#e7d7ff}
.lsa-help{font-size:11px;color:var(--muted);margin:0 0 8px}
.lsa-note-visible{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:0 3px;border:1px solid #b9a4e8;border-radius:50%;background:#f1ebff;color:#60449a;font:13px system-ui;vertical-align:middle;cursor:pointer}
.lsa-note-box{position:absolute;z-index:20;box-sizing:border-box;min-width:170px;min-height:90px;width:260px;height:145px;resize:both;overflow:auto;border:1px solid #b9a4e8;border-radius:7px;background:#fff9df;color:#302b20;box-shadow:0 3px 12px #0002;font:13px/1.45 system-ui}
.lsa-note-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 8px;background:#f3e6b8;color:#49376e;font-size:11px;font-weight:700;cursor:move;user-select:none;touch-action:none}
.lsa-note-head button{border:0;background:transparent;color:#49376e;cursor:pointer;font-size:15px}
.lsa-note-body{min-height:45px;padding:8px;outline:none;white-space:pre-wrap;overflow-wrap:anywhere}
.lsa-note-box.lsa-saving{opacity:.72}.lsa-note-box.lsa-error{border-color:#c33}
.lsa-typewriter{position:absolute;z-index:25;box-sizing:border-box;min-width:28px;width:max-content;padding:2px 4px;border:1px solid transparent;border-radius:3px;color:#0645d8;background:transparent;font-family:Arial,Helvetica,sans-serif;line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere;cursor:text}
.lsa-typewriter>.lsa-tw-text{outline:none;min-height:1.35em;min-width:12px;caret-color:#0645d8}
.lsa-typewriter>.lsa-tw-text:empty::before{content:'Digite…';color:#7d9ae6;pointer-events:none}
.lsa-typewriter:hover{border-color:#c6d4fb}
.lsa-typewriter.lsa-selected{z-index:40;border:1px dashed #5b82f0;background:rgba(255,255,255,.92)}
.lsa-typewriter.lsa-dragging{opacity:.85;box-shadow:0 4px 14px #0645d833}
.lsa-typewriter.lsa-error{border-color:#c33}
.lsa-tw-bar{position:absolute;z-index:60;display:none;align-items:stretch;gap:0;height:32px;border:1px solid #5b82f0;border-radius:7px;background:#fff;box-shadow:0 3px 10px #0645d833;font:13px/1 Arial,Helvetica,sans-serif;color:#1d3f9e;white-space:nowrap;user-select:none;-webkit-user-select:none}
.lsa-tw-bar.lsa-on{display:flex}
.lsa-tw-bar>*{display:flex;align-items:center;justify-content:center;min-width:34px;padding:0 8px;border:0;border-right:1px solid #dbe4fd;background:transparent;color:inherit;font:inherit;cursor:pointer}
.lsa-tw-bar>*:last-child{border-right:0}
.lsa-tw-bar .lsa-tw-move{cursor:grab;touch-action:none;font-weight:700;gap:5px;background:#eef3ff;border-radius:6px 0 0 6px}
.lsa-tw-bar .lsa-tw-move:active{cursor:grabbing}
.lsa-tw-bar .lsa-tw-del{color:#a22}
.lsa-tw-bar .lsa-tw-tam{min-width:30px;color:#667;cursor:default;font-size:12px}
.lsa-article-tw-mode{cursor:text}
.lsa-article-tw-mode .ls-l{cursor:text}
.lsa-note-pop{position:fixed;z-index:99999;width:min(360px,calc(100vw - 28px));padding:12px;border:1px solid #c9b9e8;border-radius:10px;background:#fff;color:#222;box-shadow:0 8px 28px #0003;font:13px system-ui}
.lsa-note-pop strong{display:block;margin-bottom:8px}
.lsa-note-pop textarea{box-sizing:border-box;width:100%;min-height:110px;resize:vertical;padding:9px;border:1px solid #ccc;border-radius:7px;font:13px/1.45 system-ui;color:#222;background:#fff}
.lsa-note-pop .lsa-note-actions{display:flex;gap:7px;justify-content:flex-end;margin-top:9px}
.lsa-note-pop button{padding:6px 10px;border:1px solid #ccc;border-radius:6px;background:#f7f7f7;color:#222;cursor:pointer}
.lsa-note-pop button.primary{background:#60449a;color:white;border-color:#60449a}
.lsa-note-pop .lsa-note-delete{margin-right:auto;color:#a22}
`;
function styles(){if(document.getElementById('lsa-style'))return;const s=document.createElement('style');s.id='lsa-style';s.textContent=css;document.head.appendChild(s);}
// 14/11: no card de assunto o título é "CF/88, art. 150 · citado em 4 questões".
// A contagem mudava a chave e as anotações sumiam. Agora vale só o texto do título,
// sem a contagem: o mesmo artigo tem a mesma chave no card próprio e no de assunto.
function tituloSemContagem(sm){if(!sm)return'';return [...sm.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s*·\s*citado em.*$/i,'').trim();}
function docKey(el){
 const fonte=el.querySelector('.ls-fonte')?.textContent||tituloSemContagem(el.closest('details.ls-outra')?.querySelector(':scope>summary'));
 const card=el.closest('details.ls-card')?.dataset.k||'';
 let s=fonte.replace(/^Ver também:\s*/i,'').trim();
 if(!s){const m=card.match(/^(.*),\s*art\.\s*(\S+)$/);s=m?m[1]+', art. '+m[2]:card;}
 if(!s||s.startsWith('ass:'))s=card+'|'+(el.textContent||'').slice(0,80);
 return s.slice(0,240);
}
// 14/11: a API passou a exigir a senha do servidor (a mesma da IA, gravada no painel 🔑).
function senhaServidor(){try{return localStorage.getItem('questia_senha_servidor')||'';}catch(e){return'';}}
async function request(method,data,url){
 const r=await fetch(url||API,{method,headers:{'Content-Type':'application/json','x-questia-senha':senhaServidor()},body:data?JSON.stringify(data):undefined,cache:'no-store'});
 const j=await r.json().catch(()=>({}));
 if(!r.ok){const e=new Error(j.error||'Erro ao sincronizar.');e.status=r.status;throw e;}
 return j;
}
function falhaMsg(e,padrao){return e&&e.status===401?'Sem sincronização: informe a senha do servidor no painel 🔑 do topo':padrao;}
function stack(el){if(!undoStack.has(el))undoStack.set(el,[]);if(!redoStack.has(el))redoStack.set(el,[]);}
function record(el,a){stack(el);undoStack.get(el).push(a);if(undoStack.get(el).length>100)undoStack.get(el).shift();redoStack.get(el).length=0;}
function findAnnotation(el,id){return el.querySelector('[data-annotation="'+CSS.escape(id)+'"]');}
function findNote(el,id){return el.querySelector('[data-note-for="'+CSS.escape(id)+'"]');}
function showNote(mark,a){
 if(!a.note)return;const article=mark.closest('.ls-artigo');if(!article)return;
 if(getComputedStyle(article).position==='static')article.style.position='relative';
 if(findNote(article,a.id))return;
 const pin=document.createElement('button');pin.type='button';pin.className='lsa-note-visible';pin.dataset.noteFor=a.id;pin.textContent='💬';pin.title='Localizar comentário';mark.after(pin);
 const box=document.createElement('div');box.className='lsa-note-box';box.dataset.noteBox=a.id;
 box.style.left=(Number.isFinite(Number(a.x))?a.x:24)+'px';box.style.top=(Number.isFinite(Number(a.y))?a.y:70)+'px';
 box.style.width=Math.max(170,Math.min(700,Number(a.width)||260))+'px';box.style.height=Math.max(90,Math.min(700,Number(a.height)||145))+'px';
 const head=document.createElement('div');head.className='lsa-note-head';head.innerHTML='<span>MEU COMENTÁRIO · arraste para mover</span>';
 const del=document.createElement('button');del.type='button';del.textContent='×';del.title='Excluir comentário';head.append(del);
 const body=document.createElement('div');body.className='lsa-note-body';body.contentEditable='true';body.spellcheck=true;body.textContent=a.note;
 box.append(head,body);article.append(box);
 let timer;
 const persist=async()=>{const next={...a,note:body.innerText.trim(),x:Math.round(box.offsetLeft),y:Math.round(box.offsetTop),width:Math.round(box.getBoundingClientRect().width),height:Math.round(box.getBoundingClientRect().height)};
  box.classList.add('lsa-saving');try{await request('POST',next);Object.assign(a,next);const list=loaded.get(article)||[];const i=list.findIndex(v=>v.id===a.id);if(i>=0)list[i]=next;else list.push(next);loaded.set(article,list);box.classList.remove('lsa-error');status(article,'Comentário sincronizado');}
  catch(e){box.classList.add('lsa-error');status(article,'Falha ao sincronizar comentário');console.error(e);}finally{box.classList.remove('lsa-saving');}};
 body.addEventListener('blur',persist);body.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(persist,700);});
 const ro=new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(persist,500);});ro.observe(box);
 del.onclick=async()=>{if(confirm('Excluir este comentário?'))await remove(article,a.id,mark);};
 head.addEventListener('pointerdown',e=>{if(e.target===del)return;e.preventDefault();head.setPointerCapture(e.pointerId);const sx=e.clientX,sy=e.clientY,l=box.offsetLeft,t=box.offsetTop;
  const move=ev=>{box.style.left=Math.max(0,l+ev.clientX-sx)+'px';box.style.top=Math.max(0,t+ev.clientY-sy)+'px';};
  const up=()=>{head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',up);persist();};
  head.addEventListener('pointermove',move);head.addEventListener('pointerup',up,{once:true});});
 pin.onclick=()=>{box.scrollIntoView({block:'nearest',behavior:'smooth'});body.focus();};
}

const freeNoteMode=new WeakMap();
function renderFreeNote(article,a){
 if(article.querySelector('[data-note-box="'+CSS.escape(a.id)+'"]'))return;
 if(getComputedStyle(article).position==='static')article.style.position='relative';
 const box=document.createElement('div');box.className='lsa-note-box';box.dataset.noteBox=a.id;
 box.style.left=(Number(a.x)||24)+'px';box.style.top=(Number(a.y)||70)+'px';
 box.style.width=Math.max(170,Math.min(700,Number(a.width)||260))+'px';
 box.style.height=Math.max(90,Math.min(700,Number(a.height)||145))+'px';
 const head=document.createElement('div');head.className='lsa-note-head';
 const label=document.createElement('span');label.textContent='COMENTÁRIO LIVRE · arraste para mover';
 const del=document.createElement('button');del.type='button';del.textContent='×';del.title='Excluir comentário';
 head.append(label,del);
 const body=document.createElement('div');body.className='lsa-note-body';body.contentEditable='true';body.spellcheck=true;body.textContent=a.note||'';
 body.dataset.placeholder='Digite seu comentário…';box.append(head,body);article.append(box);
 let timer;
 const persist=async()=>{
  const next={...a,note:body.innerText.trim(),x:Math.round(box.offsetLeft),y:Math.round(box.offsetTop),width:Math.round(box.getBoundingClientRect().width),height:Math.round(box.getBoundingClientRect().height)};
  box.classList.add('lsa-saving');
  try{await request('POST',next);Object.assign(a,next);const list=loaded.get(article)||[];const i=list.findIndex(v=>v.id===a.id);if(i<0)list.push(next);else list[i]=next;loaded.set(article,list);status(article,'Comentário sincronizado');}
  catch(e){box.classList.add('lsa-error');status(article,'Falha ao sincronizar comentário');console.error(e);}
  finally{box.classList.remove('lsa-saving');}
 };
 body.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(persist,700);});
 body.addEventListener('blur',persist);
 const ro=new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(persist,500);});ro.observe(box);
 del.addEventListener('click',async()=>{if(!confirm('Excluir esta caixa de comentário?'))return;try{await request('DELETE',{id:a.id});box.remove();loaded.set(article,(loaded.get(article)||[]).filter(v=>v.id!==a.id));status(article,'Comentário excluído');}catch(e){alert('Não foi possível excluir: '+e.message);}});
 head.addEventListener('pointerdown',e=>{
  if(e.target===del)return;e.preventDefault();head.setPointerCapture(e.pointerId);
  const sx=e.clientX,sy=e.clientY,l=box.offsetLeft,t=box.offsetTop;
  const move=ev=>{box.style.left=Math.max(0,l+ev.clientX-sx)+'px';box.style.top=Math.max(0,t+ev.clientY-sy)+'px';};
  const up=()=>{head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',up);persist();};
  head.addEventListener('pointermove',move);head.addEventListener('pointerup',up,{once:true});
 });
 if(!a.note)body.focus();
}
async function createFreeNote(article,x,y){
 const a={id:makeId(),doc_key:article.dataset.lsaDoc,quote:'',prefix:'',suffix:'',kind:'note',color:'purple',note:'',x:Math.max(0,Math.round(x)),y:Math.max(0,Math.round(y)),width:260,height:145};
 try{await request('POST',a);const list=loaded.get(article)||[];list.push(a);loaded.set(article,list);renderFreeNote(article,a);status(article,'Caixa criada e sincronizada');}
 catch(e){alert('Não foi possível criar a caixa: '+e.message);status(article,'Falha ao criar caixa');}
}
// ===== Caixa de texto livre (estilo editor de PDF) — reescrita em 14/11 =====
// Causas corrigidas:
//  1) A posição era gravada em pixels a partir do canto do artigo. No celular o texto
//     quebra em outras linhas e a caixa caía em outro lugar. Agora a caixa fica presa
//     ao parágrafo (linha .ls-l) em que foi criada: grava-se qual parágrafo, um trecho
//     do começo dele (para achá-lo de novo) e a posição: horizontal em fração da
//     largura do texto; vertical em fração da altura do parágrafo quando o clique é
//     dentro dele, ou em distância fixa da borda quando é acima ou abaixo dele.
//  2) O clique virava o canto da caixa e o texto nascia abaixo e à direita. Agora o
//     ponto gravado é o do cursor: o meio da primeira linha de texto fica no clique.
//  3) Cada caixa tinha a sua barra de controles, presa acima dela. Agora há UMA barra
//     por artigo, que se encaixa acima (ou abaixo, sem espaço) da caixa selecionada.
// Formato no D1 (sem mudar o banco): prefix='tw2|<parágrafo>|<começo do parágrafo>',
// x = fração horizontal × 10000, y = (fração vertical + 5) × 1000. Caixas antigas
// (sem 'tw2|') aparecem onde estavam e passam ao formato novo quando forem movidas.
const TW_BORDA=1,TW_PAD_X=4,TW_PAD_Y=2,TW_LH=1.35,TW_FONTE=16;
const twBar=new WeakMap(),twSel=new WeakMap();
const twLinhas=article=>[...article.querySelectorAll(':scope>.ls-l')];
const twNorm=t=>String(t||'').replace(/\s+/g,' ').trim().slice(0,40);
// Topo de um elemento em relação à caixa de preenchimento do artigo (a mesma base de
// left/top dos filhos absolutos). Não usa offsetTop: ele depende de qual ancestral é a
// referência, e no 1º clique o artigo ainda não era — daí a caixa nascer deslocada.
function twTopo(article,el){return el.getBoundingClientRect().top-article.getBoundingClientRect().top-article.clientTop;}
function twMetrica(article){
 const cs=getComputedStyle(article);
 const pl=parseFloat(cs.paddingLeft)||0,pr=parseFloat(cs.paddingRight)||0;
 return{esq:pl,larg:Math.max(40,article.clientWidth-pl-pr),dir:article.clientWidth-pr};
}
// Converte um ponto (em px, relativo ao artigo) para âncora e de volta.
function twAncorar(article,px,py){
 const L=twLinhas(article);const m=twMetrica(article);
 const tops=L.map(l=>twTopo(article,l));
 let i=0;for(let k=0;k<L.length;k++){if(tops[k]<=py)i=k;else break;}
 const l=L[i];const fx=Math.max(0,Math.min(1,(px-m.esq)/m.larg));
 // dentro do parágrafo: proporção da altura (0 a 1). Fora dele: distância em px/100
 // a partir da borda (acima: negativo; abaixo: 1 + px/100), que não muda com a largura.
 let fy=0;
 if(l){const t=tops[i],h=Math.max(1,l.getBoundingClientRect().height);
  fy=py<t?(py-t)/100:py<=t+h?(py-t)/h:1+(py-t-h)/100;}
 fy=Math.max(-5,Math.min(95,fy));
 return{i,fp:l?twNorm(l.textContent):'',fx,fy};
}
function twPonto(article,an){
 const L=twLinhas(article);const m=twMetrica(article);
 let l=L[an.i];
 if(an.fp&&(!l||twNorm(l.textContent)!==an.fp)){const k=L.findIndex(x=>twNorm(x.textContent)===an.fp);if(k>=0)l=L[k];}
 if(!l)l=L[Math.min(an.i,L.length-1)];
 const top=l?twTopo(article,l):0,alt=l?l.getBoundingClientRect().height:0;
 const fy=an.fy;
 return{x:m.esq+an.fx*m.larg,y:fy<0?top+fy*100:fy<=1?top+fy*alt:top+alt+(fy-1)*100};
}
function twLerAncora(a){
 const m=/^tw2\|(\d+)\|(.*)$/.exec(a.prefix||'');
 if(!m)return null;
 return{i:+m[1],fp:m[2],fx:(Number(a.x)||0)/10000,fy:(Number(a.y)||5000)/1000-5};
}
function twGravarAncora(a,an){a.prefix=('tw2|'+an.i+'|'+an.fp).slice(0,100);a.x=Math.round(an.fx*10000);a.y=Math.round((an.fy+5)*1000);}
function twFonte(box){return parseInt(box.style.fontSize,10)||TW_FONTE;}
// Coloca a caixa de modo que o cursor (meio da 1ª linha) fique no ponto da âncora.
function twPosicionar(article,box,a){
 const fs=twFonte(box),m=twMetrica(article);
 let cx,cy;
 const an=twLerAncora(a);
 if(an){const p=twPonto(article,an);cx=p.x;cy=p.y;}
 else{cx=(Number(a.x)||0)+TW_BORDA+TW_PAD_X;cy=(Number(a.y)||0)+TW_BORDA+TW_PAD_Y+fs*TW_LH/2;} // caixa antiga
 const left=Math.round(cx-TW_BORDA-TW_PAD_X),top=Math.round(cy-TW_BORDA-TW_PAD_Y-fs*TW_LH/2);
 box.style.left=left+'px';box.style.top=Math.max(0,top)+'px';
 box.style.maxWidth=Math.max(80,Math.round(m.dir-left))+'px';   // cresce para a direita até a margem do texto
 if(twSel.get(article)===box)twBarraPosicionar(article);
}
function twCursorDaCaixa(box){const fs=twFonte(box);return{x:box.offsetLeft+TW_BORDA+TW_PAD_X,y:box.offsetTop+TW_BORDA+TW_PAD_Y+fs*TW_LH/2};}
// ---- a barra única do artigo ----
function twBarra(article){
 let bar=twBar.get(article);if(bar)return bar;
 bar=document.createElement('div');bar.className='lsa-tw-bar';bar.setAttribute('contenteditable','false');
 bar.innerHTML='<span class="lsa-tw-move" title="Arraste para mover">⠿ Mover</span><button type="button" data-tw="menos" title="Diminuir letra">A−</button><span class="lsa-tw-tam"></span><button type="button" data-tw="mais" title="Aumentar letra">A+</button><button type="button" data-tw="apagar" class="lsa-tw-del" title="Apagar este texto">🗑</button>';
 article.append(bar);twBar.set(article,bar);
 bar.addEventListener('pointerdown',e=>{if(!e.target.closest('.lsa-tw-move'))e.preventDefault();}); // não tira o foco do texto
 bar.addEventListener('click',e=>{
  const b=e.target.closest('[data-tw]');const box=twSel.get(article);if(!b||!box)return;
  if(b.dataset.tw==='apagar'){box._twApagar();return;}
  const fs=twFonte(box)+(b.dataset.tw==='mais'?2:-2);
  box._twFonte(Math.max(8,Math.min(48,fs)));
 });
 const mv=bar.querySelector('.lsa-tw-move');
 mv.addEventListener('pointerdown',e=>{
  const box=twSel.get(article);if(!box)return;
  e.preventDefault();mv.setPointerCapture(e.pointerId);
  const sx=e.clientX,sy=e.clientY,l=box.offsetLeft,t=box.offsetTop,m=twMetrica(article);
  box.classList.add('lsa-dragging');
  const andar=ev=>{
   const nl=Math.max(0,Math.min(article.clientWidth-30,l+ev.clientX-sx)),nt=Math.max(0,t+ev.clientY-sy);
   box.style.left=nl+'px';box.style.top=nt+'px';box.style.maxWidth=Math.max(80,Math.round(m.dir-nl))+'px';
   twBarraPosicionar(article);
  };
  const soltar=()=>{mv.removeEventListener('pointermove',andar);mv.removeEventListener('pointerup',soltar);mv.removeEventListener('pointercancel',soltar);
   box.classList.remove('lsa-dragging');const c=twCursorDaCaixa(box);box._twMovida(c.x,c.y);};
  mv.addEventListener('pointermove',andar);mv.addEventListener('pointerup',soltar);mv.addEventListener('pointercancel',soltar);
 });
 return bar;
}
function twBarraPosicionar(article){
 const bar=twBar.get(article),box=twSel.get(article);if(!bar||!box)return;
 bar.classList.add('lsa-on');
 const h=bar.offsetHeight||32,w=bar.offsetWidth||200;
 let top=box.offsetTop-h-6;if(top<0)top=box.offsetTop+box.offsetHeight+6;   // sem espaço acima: vai para baixo
 let left=Math.min(box.offsetLeft,Math.max(0,article.clientWidth-w));
 bar.style.top=top+'px';bar.style.left=Math.max(0,left)+'px';
 bar.querySelector('.lsa-tw-tam').textContent=twFonte(box);
}
function twSelecionar(article,box){
 const ant=twSel.get(article)||null;box=box||null;
 if(ant===box){if(box)twBarraPosicionar(article);return;}
 twSel.set(article,box);                       // troca antes de avisar a anterior (evita laço ao apagar caixa vazia)
 const bar=twBarra(article);
 if(box){box.classList.add('lsa-selected');twBarraPosicionar(article);}else bar.classList.remove('lsa-on');
 if(ant){ant.classList.remove('lsa-selected');ant._twSaiu&&ant._twSaiu();}
}
function renderTypewriter(article,a,{novo=false}={}){
 if(article.querySelector('[data-typewriter="'+CSS.escape(a.id)+'"]'))return;
 article.style.setProperty('position','relative','important');
 const box=document.createElement('div');box.className='lsa-typewriter';box.dataset.typewriter=a.id;
 box.style.fontSize=Math.max(8,Math.min(48,Number(a.font_size)||TW_FONTE))+'px';
 const txt=document.createElement('div');txt.className='lsa-tw-text';txt.contentEditable='true';txt.spellcheck=true;txt.textContent=a.note||'';
 box.append(txt);article.append(box);box._twA=a;
 let timer=null,salvo=!novo;
 const lista=()=>loaded.get(article)||[];
 const gravar=async()=>{
  clearTimeout(timer);timer=null;
  const texto=txt.innerText.replace(/\n$/,'');
  if(!texto.trim())return;                          // caixa vazia não vai para o servidor
  a.note=texto;a.font_size=twFonte(box);
  try{await request('POST',a);salvo=true;box.classList.remove('lsa-error');
   const L=lista();const i=L.findIndex(v=>v.id===a.id);if(i<0)L.push(a);loaded.set(article,L);status(article,'Texto sincronizado');}
  catch(e){box.classList.add('lsa-error');status(article,falhaMsg(e,'Falha ao sincronizar texto'));console.error(e);}
 };
 const agendar=()=>{clearTimeout(timer);timer=setTimeout(gravar,600);};
 box._twFonte=fs=>{box.style.fontSize=fs+'px';twPosicionar(article,box,a);agendar();};
 box._twMovida=(cx,cy)=>{twGravarAncora(a,twAncorar(article,cx,cy));twPosicionar(article,box,a);twAltura(article);if(txt.innerText.trim())gravar();};
 box._twApagar=async()=>{
  if(box._twIndo)return;box._twIndo=true;clearTimeout(timer);
  if(salvo){try{await request('DELETE',{id:a.id});}catch(e){box._twIndo=false;alert('Não foi possível apagar: '+e.message);return;}}
  if(twSel.get(article)===box)twSelecionar(article,null);box.remove();twAltura(article);loaded.set(article,lista().filter(v=>v.id!==a.id));status(article,'Texto apagado');
 };
 box._twSaiu=()=>{if(!txt.innerText.trim()){box._twApagar();return;}if(timer)gravar();};
 txt.addEventListener('input',()=>{twBarraPosicionar(article);twAltura(article);agendar();});
 txt.addEventListener('paste',e=>{e.preventDefault();const t=(e.clipboardData||window.clipboardData).getData('text/plain');document.execCommand('insertText',false,t);});
 txt.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();txt.blur();twSelecionar(article,null);}});
 box.addEventListener('pointerdown',e=>{e.stopPropagation();twSelecionar(article,box);});
 txt.addEventListener('focus',()=>twSelecionar(article,box));
 twPosicionar(article,box,a);twAltura(article);
 if(novo){twSelecionar(article,box);requestAnimationFrame(()=>{txt.focus({preventScroll:true});});}
 return box;
}
function createTypewriter(article,cx,cy){
 const a={id:makeId(),doc_key:article.dataset.lsaDoc,quote:'',prefix:'',suffix:'',kind:'note',color:'blue',note:'',x:0,y:0,width:260,height:145,font_size:TW_FONTE};
 twGravarAncora(a,twAncorar(article,cx,cy));
 renderTypewriter(article,a,{novo:true});
 status(article,'Digite o texto; ele é salvo sozinho');
}
function twReposicionarTodas(article){
 article.querySelectorAll(':scope>.lsa-typewriter').forEach(box=>{const a=(loaded.get(article)||[]).find(v=>v.id===box.dataset.typewriter)||box._twA;if(a)twPosicionar(article,box,a);});
 twAltura(article);
}
// Caixa levada abaixo da última linha: o fundo do artigo cresce até ela, para não
// ficar por cima do que vem depois na página.
function twAltura(article){
 let fundo=0;article.querySelectorAll(':scope>.lsa-typewriter').forEach(b=>{fundo=Math.max(fundo,b.offsetTop+b.offsetHeight);});
 const cs=getComputedStyle(article),pt=parseFloat(cs.paddingTop)||0,pb=parseFloat(cs.paddingBottom)||0;
 const borda=(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.borderBottomWidth)||0);
 const alvo=!fundo?0:Math.ceil(cs.boxSizing==='border-box'?fundo+10+pb+borda:fundo+10-pt);
 const atual=parseFloat(article.style.minHeight)||0;
 if(Math.abs(alvo-atual)>1)article.style.minHeight=alvo?alvo+'px':'';
}
function closeNoteEditor(article){document.querySelector('.lsa-note-pop')?.remove();}
function openNoteEditor(article,{annotation=null,range=null}={}){
 closeNoteEditor(article);
 const pop=document.createElement('div');pop.className='lsa-note-pop';
 const title=document.createElement('strong');title.textContent=annotation?'Comentário':'Novo comentário';
 const area=document.createElement('textarea');area.placeholder='Digite sua observação sobre o trecho selecionado…';area.value=annotation?.note||'';
 const actions=document.createElement('div');actions.className='lsa-note-actions';
 const del=document.createElement('button');del.className='lsa-note-delete';del.textContent='Excluir';del.hidden=!annotation;
 const cancel=document.createElement('button');cancel.textContent='Cancelar';
 const saveBtn=document.createElement('button');saveBtn.className='primary';saveBtn.textContent='Salvar';
 actions.append(del,cancel,saveBtn);pop.append(title,area,actions);document.body.append(pop);
 const rect=annotation?findAnnotation(article,annotation.id)?.getBoundingClientRect():range?.getBoundingClientRect();
 pop.style.left=Math.max(14,Math.min((rect?.left||20),innerWidth-pop.offsetWidth-14))+'px';
 pop.style.top=Math.max(14,Math.min((rect?.bottom||100)+8,innerHeight-pop.offsetHeight-14))+'px';
 area.focus();
 cancel.onclick=()=>closeNoteEditor(article);
 saveBtn.onclick=async()=>{
  const value=area.value.trim();if(!value){area.focus();return;}
  saveBtn.disabled=true;saveBtn.textContent='Salvando…';
  if(annotation){const mark=findAnnotation(article,annotation.id);const a={...annotation,note:value};
   try{await request('POST',a);const list=loaded.get(article)||[];const i=list.findIndex(x=>x.id===a.id);if(i>=0)list[i]=a;else list.push(a);loaded.set(article,list);if(mark){mark.dataset.kind='note';mark.title='Comentário';}findNote(article,a.id)?.remove();if(mark)showNote(mark,a);record(article,a);status(article,'Comentário sincronizado');closeNoteEditor(article);}
   catch(e){saveBtn.disabled=false;saveBtn.textContent='Salvar';status(article,'Falha ao salvar');alert('Não foi possível salvar o comentário: '+e.message);}
  }else{closeNoteEditor(article);await addMark(article,'note','purple',value,range);}
 };
 del.onclick=async()=>{if(!annotation)return;const mark=findAnnotation(article,annotation.id);await remove(article,annotation.id,mark);closeNoteEditor(article);};
}
async function undo(el){stack(el);const a=undoStack.get(el).pop();if(!a)return;const mark=findAnnotation(el,a.id);findNote(el,a.id)?.remove();if(mark)mark.replaceWith(...mark.childNodes);redoStack.get(el).push(a);try{await request('DELETE',{id:a.id});status(el,'Desfeito e sincronizado');}catch(e){status(el,'Erro ao sincronizar');alert('A marcação foi desfeita nesta tela, mas não foi possível sincronizar a exclusão: '+e.message);}}
async function redo(el){stack(el);const a=redoStack.get(el).pop();if(!a)return;if(!findAndWrap(el,a)){redoStack.get(el).push(a);alert('Não localizei o trecho original para refazer a marcação. O texto não foi alterado.');return;}undoStack.get(el).push(a);await save(el,a);}
function status(el,msg){const s=el.querySelector('.lsa-status');if(s)s.textContent=msg;}
function makeId(){return (crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));}
function textContext(node,start,end){const p=node.textContent||'';return{prefix:p.slice(Math.max(0,start-60),start),suffix:p.slice(end,end+60)};}
function selectedRange(article){
 const sel=getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount)return null;
 const r=sel.getRangeAt(0);if(!article.contains(r.commonAncestorContainer))return null;
 const quote=sel.toString().trim();if(!quote)return null;
 return{range:r,quote};
}
async function save(article,a){
 status(article,'Salvando…');
 try{await request('POST',a);status(article,'Sincronizado');}
 catch(e){status(article,'Falha ao salvar');console.error('[QuestIA anotações]',e);alert('Não foi possível salvar a anotação no servidor: '+e.message);}
}
function wrapRange(article,range,a){
 const span=document.createElement('span');span.className='lsa-mark';span.dataset.annotation=a.id;span.dataset.kind=a.kind;span.dataset.color=a.color||'yellow';
 if(a.note)span.title='Comentário: '+a.note;
 try{span.appendChild(range.extractContents());range.insertNode(span);showNote(span,a);return span;}catch(e){return null;}
}
async function addMark(article,kind,color,note,providedRange=null){
 const sel=providedRange?{range:providedRange,quote:providedRange.toString().trim()}:selectedRange(article);if(!sel||!sel.quote){alert('Selecione primeiro um trecho do texto da lei.');return;}
 const range=sel.range.cloneRange();
 const node=range.startContainer.nodeType===3?range.startContainer:null;
 const ctx=node?textContext(node,range.startOffset,range.endOffset):{prefix:'',suffix:''};
 const a={id:makeId(),doc_key:article.dataset.lsaDoc,quote:sel.quote,prefix:ctx.prefix,suffix:ctx.suffix,kind,color,note:note||'',x:24,y:70,width:260,height:145};
 if(!wrapRange(article,range,a)){alert('Não foi possível marcar essa seleção. Tente selecionar um trecho menor, dentro do mesmo parágrafo.');return;}
 getSelection()?.removeAllRanges();
 record(article,a);
 await save(article,a);
}
function toolbar(article){
 if(article.dataset.lsaReady)return;article.dataset.lsaReady='1';
 article.dataset.lsaDoc=docKey(article);stack(article);
 article.style.setProperty('position','relative','important');
 const bar=document.createElement('div');bar.className='lsa-tools';
 bar.innerHTML='<strong>✍️ Anotações</strong><span>Grifar:</span>'+
 Object.entries(COLORS).map(([k,v])=>'<button class="lsa-color" data-color="'+k+'" title="Grifar ('+k+')" style="background:'+v+'"></button>').join('')+
 '<button data-action="underline">Sublinhar</button><button data-action="note">💬 Comentário</button><button data-action="typewriter">T Caixa de texto</button><button data-action="undo">↶ Desfazer</button><button data-action="redo">↷ Refazer</button><span class="lsa-status">Carregando…</span>';
 article.prepend(bar);
 const help=document.createElement('div');help.className='lsa-help';help.textContent='Grifar e sublinhar: escolha a ferramenta e selecione o trecho (ela fica ativa até você clicar de novo). Caixa de texto: clique em “T Caixa de texto” e depois no ponto onde quer escrever; para mover, toque no texto e arraste por “⠿ Mover”.';bar.after(help);
 function setTool(tool){
  activeTool.set(article,tool);
  bar.querySelectorAll('[data-color],[data-action="underline"]').forEach(x=>x.classList.toggle('lsa-active',!!tool&&((x.dataset.color&&tool.kind==='highlight'&&x.dataset.color===tool.color)||(x.dataset.action==='underline'&&tool.kind==='underline'))));
  status(article,tool?'Ferramenta ativa — selecione o texto':'Selecione uma ferramenta');
 }
 bar.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.color){const next={kind:'highlight',color:b.dataset.color};const cur=activeTool.get(article);setTool(cur?.kind===next.kind&&cur.color===next.color?null:next);return;}
  if(b.dataset.action==='underline'){const cur=activeTool.get(article);setTool(cur?.kind==='underline'?null:{kind:'underline',color:'yellow'});return;}
  if(b.dataset.action==='note'){setTool(null);const sel=selectedRange(article);if(!sel){alert('Selecione primeiro o trecho que receberá o comentário.');return;}return openNoteEditor(article,{range:sel.range.cloneRange()});}
  if(b.dataset.action==='typewriter'){const on=!freeNoteMode.get(article);freeNoteMode.set(article,on);setTool(null);b.classList.toggle('lsa-active',on);article.classList.toggle('lsa-article-tw-mode',on);status(article,on?'Caixa de texto: toque ou clique no ponto onde quer escrever':'Caixa de texto desativada');return;}
  if(b.dataset.action==='undo'){setTool(null);await undo(article);return;}
  if(b.dataset.action==='redo'){setTool(null);await redo(article);return;}
 });
 let applyPending=false;
 const applyActive=()=>{
  if(applyPending)return;applyPending=true;
  setTimeout(async()=>{
   applyPending=false;const tool=activeTool.get(article);if(!tool)return;
   const sel=selectedRange(article);if(!sel)return;
   await addMark(article,tool.kind,tool.color,'');
  },0);
 };
 article.addEventListener('mouseup',applyActive);
 article.addEventListener('touchend',applyActive);
 article.addEventListener('mouseleave',()=>setTool(null));
 article.addEventListener('click',async e=>{
  if(freeNoteMode.get(article)&&!e.target.closest('.lsa-tools,.lsa-note-box,.lsa-typewriter,.lsa-mark,.lsa-note-visible')){
   const sel=getSelection();if(sel&&!sel.isCollapsed&&article.contains(sel.anchorNode))return;   // estava selecionando texto
   // ponto do clique no sistema de coordenadas dos filhos absolutos (caixa de preenchimento do artigo)
   const r=article.getBoundingClientRect();
   const x=e.clientX-r.left-article.clientLeft+article.scrollLeft,y=e.clientY-r.top-article.clientTop+article.scrollTop;
   freeNoteMode.set(article,false);article.classList.remove('lsa-article-tw-mode');
   bar.querySelector('[data-action="typewriter"]')?.classList.remove('lsa-active');
   createTypewriter(article,x,y);return;
  }
  if(!e.target.closest('.lsa-typewriter,.lsa-tw-bar'))twSelecionar(article,null);
  const visibleNote=e.target.closest('.lsa-note-visible');
  if(visibleNote&&article.contains(visibleNote)){const box=article.querySelector('[data-note-box="'+CSS.escape(visibleNote.dataset.noteFor)+'"]');box?.scrollIntoView({block:'nearest',behavior:'smooth'});return;}
  const mark=e.target.closest('.lsa-mark');if(!mark||!article.contains(mark))return;
  const id=mark.dataset.annotation;
  if(mark.dataset.kind==='note'){article.querySelector('[data-note-box="'+CSS.escape(id)+'"] .lsa-note-body')?.focus();return;}
  if(confirm('Apagar esta marcação?'))await remove(article,id,mark);
 });
  // texto reflui (giro do celular, largura da janela): as caixas acompanham o parágrafo
  let rz=null;new ResizeObserver(()=>{cancelAnimationFrame(rz);rz=requestAnimationFrame(()=>twReposicionarTodas(article));}).observe(article);
  load(article);
}

async function remove(article,id,el){
 const a=loaded.get(article)?.find(x=>x.id===id);
 try{await request('DELETE',{id});if(a)record(article,a);findNote(article,id)?.remove();article.querySelector('[data-note-box="'+CSS.escape(id)+'"]')?.remove();el.replaceWith(...el.childNodes);status(article,'Sincronizado');}
 catch(e){alert('Não foi possível apagar: '+e.message);}
}
function findAndWrap(article,a){
 const walker=document.createTreeWalker(article,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement?.closest('.lsa-tools,.lsa-mark,.lsa-help,.lsa-typewriter,.lsa-tw-bar,.lsa-note-box,.lsa-note-visible')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
 let node;while((node=walker.nextNode())){const i=node.nodeValue.indexOf(a.quote);if(i<0)continue;
  const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+a.quote.length);
  wrapRange(article,range,a);return true;
 }return false;
}
async function load(article){
 if(loaded.has(article))return;
 loaded.set(article,[]);
 try{
  const doc=article.dataset.lsaDoc;
  const q=await request('GET',null,API+'?doc='+encodeURIComponent(doc)+'&antigas=1');
  // anotações gravadas com a chave antiga ("... · citado em N questões") passam para a chave nova
  (q.annotations||[]).forEach(a=>{if(a.doc_key!==doc){a.doc_key=doc;request('POST',a).catch(e=>console.warn('[QuestIA anotações] migração',e));}});
  loaded.set(article,q.annotations||[]);
  (q.annotations||[]).forEach(a=>{if(a.kind==='note'&&!a.quote){if(a.color==='blue')renderTypewriter(article,a);else renderFreeNote(article,a);}else findAndWrap(article,a);});
  status(article,'Sincronizado');
 }catch(e){status(article,falhaMsg(e,'Sem sincronização'));console.warn('[QuestIA anotações]',e);}
}

document.addEventListener('pointerdown',e=>{
 if(e.target.closest&&e.target.closest('.lsa-typewriter,.lsa-tw-bar'))return;
 document.querySelectorAll('.lsa-typewriter.lsa-selected').forEach(b=>{const art=b.closest('.ls-artigo');if(art&&!art.contains(e.target))twSelecionar(art,null);});
},true);
function scan(root){
 styles();
 (root.matches?.('.ls-artigo')?[root]:[]).concat([...root.querySelectorAll?.('.ls-artigo')||[]]).forEach(toolbar);
}
function start(){
 scan(document);
 new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n);}))).observe(document.body,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
