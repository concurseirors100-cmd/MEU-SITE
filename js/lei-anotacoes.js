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
.lsa-status{margin-left:auto;color:var(--muted);font-size:11px}
.lsa-mark{border-radius:2px;cursor:pointer}
.lsa-mark[data-kind="underline"]{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px;background:transparent}
.lsa-mark[data-kind="note"]{border-bottom:2px dotted var(--accent2);background:rgba(99,102,241,.08)}
.lsa-mark[data-color="yellow"]{background:#fff1a8}.lsa-mark[data-color="green"]{background:#c9f2d0}
.lsa-mark[data-color="blue"]{background:#cce5ff}.lsa-mark[data-color="pink"]{background:#ffd6e7}.lsa-mark[data-color="purple"]{background:#e7d7ff}
.lsa-help{font-size:11px;color:var(--muted);margin:0 0 8px}
.lsa-note-visible{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin:0 3px;border:1px solid #b9a4e8;border-radius:50%;background:#f1ebff;color:#60449a;font:14px system-ui;vertical-align:middle;cursor:pointer}
.lsa-note-pop{position:fixed;z-index:99999;width:min(360px,calc(100vw - 28px));padding:12px;border:1px solid #c9b9e8;border-radius:10px;background:#fff;color:#222;box-shadow:0 8px 28px #0003;font:13px system-ui}
.lsa-note-pop strong{display:block;margin-bottom:8px}
.lsa-note-pop textarea{box-sizing:border-box;width:100%;min-height:110px;resize:vertical;padding:9px;border:1px solid #ccc;border-radius:7px;font:13px/1.45 system-ui;color:#222;background:#fff}
.lsa-note-pop .lsa-note-actions{display:flex;gap:7px;justify-content:flex-end;margin-top:9px}
.lsa-note-pop button{padding:6px 10px;border:1px solid #ccc;border-radius:6px;background:#f7f7f7;color:#222;cursor:pointer}
.lsa-note-pop button.primary{background:#60449a;color:white;border-color:#60449a}
.lsa-note-pop .lsa-note-delete{margin-right:auto;color:#a22}
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
function record(el,a){stack(el);undoStack.get(el).push(a);if(undoStack.get(el).length>100)undoStack.get(el).shift();redoStack.get(el).length=0;}
function findAnnotation(el,id){return el.querySelector('[data-annotation="'+CSS.escape(id)+'"]');}
function findNote(el,id){return el.querySelector('[data-note-for="'+CSS.escape(id)+'"]');}
function showNote(mark,a){if(!a.note)return;const box=document.createElement('button');box.type='button';box.className='lsa-note-visible';box.dataset.noteFor=a.id;box.textContent='💬';box.title='Abrir comentário';mark.after(box);}
function closeNoteEditor(article){article.querySelector('.lsa-note-pop')?.remove();}
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
 const a={id:makeId(),doc_key:article.dataset.lsaDoc,quote:sel.quote,prefix:ctx.prefix,suffix:ctx.suffix,kind,color,note:note||''};
 if(!wrapRange(article,range,a)){alert('Não foi possível marcar essa seleção. Tente selecionar um trecho menor, dentro do mesmo parágrafo.');return;}
 getSelection()?.removeAllRanges();
 record(article,a);
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
  const visibleNote=e.target.closest('.lsa-note-visible');
  if(visibleNote&&article.contains(visibleNote)){const id=visibleNote.dataset.noteFor;const a=loaded.get(article)?.find(x=>x.id===id);if(a)openNoteEditor(article,{annotation:a});return;}
  const mark=e.target.closest('.lsa-mark');if(!mark||!article.contains(mark))return;
  const id=mark.dataset.annotation;
  if(mark.dataset.kind==='note'){const a=loaded.get(article)?.find(x=>x.id===id);if(a)openNoteEditor(article,{annotation:a});return;}
  if(confirm('Apagar esta marcação?'))await remove(article,id,mark);
 });
 load(article);
}

async function remove(article,id,el){
 const a=loaded.get(article)?.find(x=>x.id===id);
 try{await request('DELETE',{id});if(a)record(article,a);findNote(article,id)?.remove();el.replaceWith(...el.childNodes);status(article,'Sincronizado');}
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
