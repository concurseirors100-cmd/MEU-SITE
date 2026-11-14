// Leitor interativo da Lei Seca — camada de anotações independente do texto oficial.
(function(){
'use strict';
const API='/api/lei-anotacoes';
const COLORS={yellow:'#fff1a8',green:'#c9f2d0',blue:'#cce5ff',pink:'#ffd6e7',purple:'#e7d7ff'};
const undoStack=new WeakMap(),redoStack=new WeakMap(),loaded=new WeakMap(),busy=new WeakSet();
const css=`
.lsa-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;margin:0 0 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);font:12px system-ui}
.lsa-tools button{border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--ink);padding:5px 8px;cursor:pointer}
.lsa-tools button:disabled{opacity:.4;cursor:default}
.lsa-tools .lsa-color{width:22px;height:22px;padding:0;border:1px solid #999}
.lsa-status{margin-left:auto;color:var(--muted);font-size:11px}
.lsa-mark{border-radius:2px;cursor:pointer}
.lsa-mark[data-kind="underline"]{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px;background:transparent}
.lsa-mark[data-kind="note"]{border-bottom:2px dotted var(--accent2);background:rgba(99,102,241,.08)}
.lsa-mark[data-color="yellow"]{background:#fff1a8}.lsa-mark[data-color="green"]{background:#c9f2d0}
.lsa-mark[data-color="blue"]{background:#cce5ff}.lsa-mark[data-color="pink"]{background:#ffd6e7}.lsa-mark[data-color="purple"]{background:#e7d7ff}
.lsa-help{font-size:11px;color:var(--muted);margin:0 0 8px}
`;
function styles(){if(document.getElementById('lsa-style'))return;const s=document.createElement('style');s.id='lsa-style';s.textContent=css;document.head.appendChild(s);}
function docKey(el){
 const fonte=el.querySelector('.ls-fonte')?.textContent||el.closest('details.ls-outra')?.querySelector(':scope>summary')?.textContent||'';
 const card=el.closest('details.ls-card')?.dataset.k||'';
 let s=fonte.replace(/^Ver também:\s*/i,'').trim();
 if(!s){const m=card.match(/^(.*),\s*art\.\s*(\S+)$/);s=m?m[1]+', art. '+m[2]:card;}
 if(!s||s.startsWith('ass:'))s=card+'|'+(el.textContent||'').slice(0,80);
 return s.slice(0,240);
}
async function request(method,data,url){
 const r=await fetch(url||API,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,cache:'no-store'});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(j.error||'Erro ao sincronizar.');
 return j;
}
function stack(el){if(!undoStack.has(el))undoStack.set(el,[]);if(!redoStack.has(el))redoStack.set(el,[]);}
function snapshot(el){stack(el);undoStack.get(el).push(el.innerHTML);if(undoStack.get(el).length>30)undoStack.get(el).shift();redoStack.get(el).length=0;}
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
 if(a.note)span.title='Comentário: '+a.note+' (clique para editar)';
 try{span.appendChild(range.extractContents());range.insertNode(span);return span;}catch(e){return null;}
}
async function addMark(article,kind,color,note){
 const sel=selectedRange(article);if(!sel){alert('Selecione primeiro um trecho do texto da lei.');return;}
 const range=sel.range.cloneRange();
 const node=range.startContainer.nodeType===3?range.startContainer:null;
 const ctx=node?textContext(node,range.startOffset,range.endOffset):{prefix:'',suffix:''};
 const a={id:makeId(),doc_key:article.dataset.lsaDoc,quote:sel.quote,prefix:ctx.prefix,suffix:ctx.suffix,kind,color,note:note||''};
 snapshot(article);
 if(!wrapRange(article,range,a)){alert('Não foi possível marcar essa seleção. Tente selecionar um trecho menor, dentro do mesmo parágrafo.');return;}
 getSelection()?.removeAllRanges();
 await save(article,a);
}
function toolbar(article){
 if(article.dataset.lsaReady)return;article.dataset.lsaReady='1';
 article.dataset.lsaDoc=docKey(article);stack(article);
 const bar=document.createElement('div');bar.className='lsa-tools';
 bar.innerHTML='<strong>✍️ Anotações</strong><span>Grifar:</span>'+
 Object.entries(COLORS).map(([k,v])=>'<button class="lsa-color" data-color="'+k+'" title="Grifar ('+k+')" style="background:'+v+'"></button>').join('')+
 '<button data-action="underline">Sublinhar</button><button data-action="note">💬 Comentário</button><button data-action="undo">↶ Desfazer</button><button data-action="redo">↷ Refazer</button><span class="lsa-status">Carregando…</span>';
 article.prepend(bar);
 const help=document.createElement('div');help.className='lsa-help';help.textContent='Selecione um trecho e escolha uma ferramenta. As marcações são sincronizadas entre dispositivos.';bar.after(help);
 bar.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.color)return addMark(article,'highlight',b.dataset.color,'');
  if(b.dataset.action==='underline')return addMark(article,'underline','yellow','');
  if(b.dataset.action==='note'){const n=prompt('Comentário sobre o trecho selecionado:');if(n!==null&&n.trim())return addMark(article,'note','purple',n.trim());return;}
  if(b.dataset.action==='undo'){const u=undoStack.get(article),r=redoStack.get(article);if(u.length){r.push(article.innerHTML);article.innerHTML=u.pop();toolbarReset(article);await reload(article);}return;}
  if(b.dataset.action==='redo'){const u=undoStack.get(article),r=redoStack.get(article);if(r.length){u.push(article.innerHTML);article.innerHTML=r.pop();toolbarReset(article);await reload(article);}return;}
 });
 article.addEventListener('click',async e=>{
  const mark=e.target.closest('.lsa-mark');if(!mark||!article.contains(mark))return;
  const id=mark.dataset.annotation;
  if(mark.dataset.kind==='note'){const next=prompt('Editar comentário (deixe vazio para remover):',mark.title.replace(/^Comentário: /,'').replace(/ \(clique para editar\)$/,''));if(next===null)return;if(!next.trim()){await remove(article,id,mark);return;}mark.title='Comentário: '+next.trim()+' (clique para editar)';const a=loaded.get(article)?.find(x=>x.id===id);if(a){a.note=next.trim();await save(article,a);}return;}
  if(confirm('Apagar esta marcação?'))await remove(article,id,mark);
 });
 load(article);
}
function toolbarReset(article){article.dataset.lsaReady='';toolbar(article);}
async function remove(article,id,el){
 try{await request('DELETE',{id});el.remove();status(article,'Sincronizado');}
 catch(e){alert('Não foi possível apagar: '+e.message);}
}
function findAndWrap(article,a){
 const walker=document.createTreeWalker(article,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement?.closest('.lsa-tools,.lsa-mark')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
 let node;while((node=walker.nextNode())){const i=node.nodeValue.indexOf(a.quote);if(i<0)continue;
  const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+a.quote.length);
  wrapRange(article,range,a);return true;
 }return false;
}
async function load(article){
 if(loaded.has(article))return;
 loaded.set(article,[]);
 try{
  const q=await request('GET',null,API+'?doc='+encodeURIComponent(article.dataset.lsaDoc));
  loaded.set(article,q.annotations||[]);
  (q.annotations||[]).forEach(a=>findAndWrap(article,a));
  status(article,'Sincronizado');
 }catch(e){status(article,'Sem sincronização');console.warn('[QuestIA anotações]',e);}
}
async function reload(article){loaded.delete(article);const old=article.dataset.lsaReady;article.dataset.lsaReady='';const bar=article.querySelector('.lsa-tools');if(bar)bar.remove();toolbar(article);}
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
