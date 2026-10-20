// ===== FÓRMULAS (LaTeX) =====
// O TEC mostra as fórmulas renderizadas (MathJax), mas o coletor guarda o código
// LaTeX cru ("\lambda = {12 \over 3}", "e^{-4}", "\times"). Aqui cada trecho de
// fórmula é achado no texto já na tela e desenhado com o KaTeX (carregado sob
// demanda do cdnjs). Sem internet, o texto continua como estava. O código original
// fica guardado em data-tex — é ele que vai para os botões de copiar.
const TEX_SINAL=/\\[a-zA-Z]{2,}|\\[,;:! ]|[A-Za-z0-9)}]\^\{|_\{/;
let katexPromessa=null;
function carregarKatex(){
  if(window.katex)return Promise.resolve(true);
  if(katexPromessa)return katexPromessa;
  katexPromessa=new Promise(res=>{
    const css=document.createElement('link');css.rel='stylesheet';
    css.href='https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css';document.head.appendChild(css);
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js';
    s.onload=()=>res(!!window.katex);s.onerror=()=>{katexPromessa=null;res(false);};document.head.appendChild(s);
  });
  return katexPromessa;
}
function texPreparar(t){
  return String(t)
    .replace(/ /g,' ')
    .replace(/(^|[^\\])%/g,'$1\\%').replace(/(^|[^\\])%/g,'$1\\%')
    .replace(/(^|[^\\])&(?![^{}]*\\end)/g,'$1\\&').replace(/(^|[^\\{])#(?![0-9a-fA-F]{3,6}\})/g,'$1\\#')
    .replace(/(\d),(?=\d)/g,'$1{,}')               // 0,018 sem espaço depois da vírgula
    .replace(/\\(large|Large|LARGE|huge|Huge|small|normalsize)\b\s*/g,'')
    .replace(/–|−/g,'-');
}
// Divide um trecho de texto em pedaços [texto, fórmula, texto…]. Uma fórmula é uma
// sequência de "palavras de fórmula" (comando \x, ^{, _{, chaves, números, operadores,
// letra isolada) que contém pelo menos um sinal de LaTeX; chave aberta puxa palavras
// até fechar (\mbox{Ativo Circulante}).
function texSegmentar(txt){
  const toks=txt.split(/(\s+)/);
  const mathy=w=>/[\\{}^_]/.test(w)||/^[=+\-*/×÷<>≤≥≠()\[\].,:;|!~0-9%]+$/.test(w)||/^[A-Z]{1,3}[=]?$/.test(w)||/^\(?[A-Za-z]\)?[,.;:]?$/.test(w)||/^[A-Za-z]\d*$/.test(w)||/^[A-Za-z]?\(?[A-Za-z0-9]{0,3}[=()+\-][A-Za-z0-9=()+\-.,]*$/.test(w);
  const out=[];let i=0,buf='';
  const bal=s=>(s.match(/\{/g)||[]).length-(s.match(/\}/g)||[]).length;
  while(i<toks.length){
    const w=toks[i];
    if(/\S/.test(w)&&mathy(w)){
      let j=i,seg='',ultimoBom=-1,segBom='',d=0;
      while(j<toks.length){
        const t=toks[j];
        if(/\S/.test(t)&&!mathy(t)&&d<=0)break;
        seg+=t;d=bal(seg);
        if(/\S/.test(t)&&d===0){ultimoBom=j;segBom=seg;}
        j++;
      }
      if(ultimoBom>=0&&TEX_SINAL.test(segBom)&&d>=0){
        // não engole pontuação final de frase
        const m=segBom.match(/^([\s\S]*?)([.,;:]?)$/);
        if(buf)out.push({t:buf});buf='';
        out.push({m:m[1].trim()});if(m[2])buf+=m[2];
        i=ultimoBom+1;continue;
      }
    }
    buf+=w;i++;
  }
  if(buf)out.push({t:buf});
  return out;
}
function texProcessarNo(no){
  const txt=no.nodeValue;
  if(!TEX_SINAL.test(txt))return;
  const partes=texSegmentar(txt);
  if(!partes.some(p=>p.m))return;
  const so=partes.filter(p=>p.m||(p.t&&p.t.trim())).length===1;
  const frag=document.createDocumentFragment();
  partes.forEach(p=>{
    if(p.t!==undefined){frag.appendChild(document.createTextNode(p.t));return;}
    const sp=document.createElement('span');sp.className='tex'+(so?' tex-bloco':'');
    sp.dataset.tex=p.m;sp.textContent=p.m;frag.appendChild(sp);
  });
  no.parentNode.replaceChild(frag,no);
}
function texVarrer(raiz){
  if(!raiz||raiz.nodeType!==1)return;
  if(raiz.closest&&raiz.closest('.tex,.katex,textarea,input,script,style,code,pre,[contenteditable]'))return;
  if(!TEX_SINAL.test(raiz.textContent||''))return;
  const w=document.createTreeWalker(raiz,NodeFilter.SHOW_TEXT,{acceptNode:n=>{
    const p=n.parentElement;if(!p||p.closest('.tex,.katex,textarea,script,style,code,pre,[contenteditable]'))return NodeFilter.FILTER_REJECT;
    return TEX_SINAL.test(n.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP;}});
  const nos=[];while(w.nextNode())nos.push(w.currentNode);
  nos.forEach(texProcessarNo);
  const pend=raiz.querySelectorAll?raiz.querySelectorAll('span.tex:not([data-ok])'):[];
  if(pend.length)carregarKatex().then(ok=>{if(!ok)return;pend.forEach(sp=>{
    if(sp.dataset.ok)return;sp.dataset.ok='1';
    try{katex.render(texPreparar(sp.dataset.tex),sp,{displayMode:sp.classList.contains('tex-bloco'),throwOnError:true,strict:'ignore',output:'html',macros:{'\\mbox':'\\text','\\hbox':'\\text','\\cancel':'\\bcancel'}});}
    catch(e){sp.textContent=sp.dataset.tex;sp.classList.add('tex-falhou');}
  });});
}
let texFila=new Set(),texAgendado=false;
new MutationObserver(ms=>{
  ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)texFila.add(n);else if(n.nodeType===3&&n.parentElement)texFila.add(n.parentElement);}));
  if(texAgendado)return;texAgendado=true;
  requestAnimationFrame(()=>{texAgendado=false;const f=[...texFila];texFila.clear();f.forEach(n=>{if(n.isConnected)texVarrer(n);});});
}).observe(document.body,{childList:true,subtree:true});
setTimeout(()=>texVarrer(document.body),300);
